# design — film-pipeline-prompt-triple-and-guards

> 决策记录。每条给出：决策 / 备选与否决理由 / 代价。

## D1 分镜提示词拆三份，存量数据零迁移

**决策**：Shot 增加 `imagePrompt` / `videoPrompt` / `endFramePrompt` 三个**可选**字段；`prompt` 字段保留不动。加载期（`kit-loader.loadFilmKit`）一次性归一化：

```
imagePrompt  ??= prompt
videoPrompt  ??= prompt
endFramePrompt ??= ''
```

消费方一律读归一化后的三字段，**不再有 `?? prompt` 分支**。

**备选与否决**：
- ❌ 迁移 153 条存量 `shot-library.json`：改存量即改 fail-closed 资产，改坏整个影视工程不可用（研究报告 §5.2 F6 兼容方案③，自评"风险最高，不推荐"）。
- ❌ 保持可选 + 下游各自 `??` 兜底：N 个消费点重复实现，遗漏即静默降级（研究报告 §5.2 方案②）。

**代价**：多一层归一化（`kit-loader.js` +45 行）；`prompt` 与 `imagePrompt` 在存量数据上同值，属**已知冗余**，靠归一化消除分支而非消除字段。

## D2 三分逐字段校验；单字段上限不动，**不设合计上限**

**决策**：
- 单字段上限沿用既有 `FILM_PROMPT_MAX_LEN = 50000`（**不改常量**，避免破既有锁），三分**各自**都受它约束。
- **不设**「三分合计上限」（原草案的 `FILM_PROMPT_BUNDLE_MAX_LEN = 50000` **已删除** —— 验证层评审 i4）。
- 三分字段存在即必须是字符串；字段非法或超单字段上限 ⇒ kit 加载 **fail-closed**（`FILM_KIT_UNAVAILABLE`），**不静默截断**。

**理由**：研究报告 §5.2 F6 点名"单字段口径需明确三字段口径（是各 50000 还是合计 50000）"。**答：各 50000**。原草案的合计上限取 50000，与单字段上限同值 ⇒ 三段各自顶格的**合法**资产会被误判死；而在单字段上限已约束的前提下，三段各自不超过 50000 时合计上限**永远不会触发**（除非法输入）⇒ 该判据既误杀合法资产、又对真正超长的输入不早暴露，是装饰性判据。改取 150000 则与真实 provider 承载同值、不早暴露问题，同样不解决问题。结论：**逐字段校验 + 不设合计上限**。

**代价**：不再有"资产损坏在加载期暴露"的**合计级**护栏 —— 但该护栏在单字段上限下本就无法触发，等价于没有；长提示词的真实治理见 PRD §3.1 的后续项（一次性重算 + 人工审核）。

## D3 尾帧提示词只产出、不消费

**决策**：`endFramePrompt` 本批次**只派生与展示**，**不送进任何 provider 请求**。

**理由**：
1. 参考图注入目前只有 3 家 provider 支持（`video-reference-inputs.js:30-34` 的 `VIDEO_REFERENCE_PARAM_BY_PROVIDER`：minimax / agnes-video / agnes-multimodal），尾帧传递是**硬前置**（研究报告审核记录 §五）。
2. 影视工程「自动」标签的参考图来自**本地文件**（`film-engineering:upload-reference`），不是公网 URL；国内视频模型要求公网地址（F28，报告 §4.2 v3 新增）——该阻塞未解决前，尾帧传递无法跑通。
3. 产出但不用 = 可验证的"数据已就绪"，且不产生无效请求。

**代价**：`endFramePrompt` 短期是"只写不读"的字段。缓解：它在规划确认卡与 ShotNode 上可见，用户能检查质量；后续批次（F24 尾帧传递）可直接消费。

## D4 就绪度**内联进既有 costCheck**，不新增第二道闸

**决策**：在 `video-gen.js` 的 `costCheck` 对象内新增 `readiness` 字段，与既有 `references` 汇总（`:293-296`）同级：

```
costCheck: {
  totalShots, maxBatch, aspect, seconds, providerId, model,
  references: {...},          // 既有
  readiness: {                // 新增
    readyCount, notReadyCount,
    shots: [ { index, shotId, ready: boolean, reason: string|null, reasonCode: string|null } ]
  }
}
```

**理由**：
1. 成本闸已被测试锁死——`film-video-checkpoint-integration.test.js:140-172` 断言"任何恢复路径都须重过闸"。新增第二道 checkpoint 会与该锁打架，且用户会被拦两次（研究报告 §5.2 批次三 F11c 的明确口径）。
2. `costCheck` 的产生点唯一（`video-gen.js:279-307`），manifest 直通（`:241-248`）与 shot 校验（`:256-260`）都在同一函数内，**内联是最小改动面**。

**就绪判据（只取"必然失败"项，不做主观质量判断）**：

| reasonCode | 判据 |
|-----------|------|
| `SHOT_PROMPT_EMPTY` | 归一化后 `imagePrompt` trim 为空 |
| `SHOT_REFERENCE_UNRESOLVED` | 该镜声明了参考图但无法解析出 provider 参数 |
| `SHOT_DURATION_OUT_OF_RANGE` | `durationMs` 非法（≤0 或超过单镜上限） |
| `SHOT_ASPECT_UNSUPPORTED` | provider 不支持该 aspect |
| `SHOT_SECONDS_UNSUPPORTED` | provider 不支持该秒数档位 |

**就绪度是三态，不是两态**（回应第 3 轮 i5）：`ready` / `notReady`（**阻止类**）/ `skipped`（**本次不参与，但不阻止**）。

| 状态 | 含义 | 是否阻止出片 |
|------|------|------------|
| `ready` | 可生成 | 否 |
| `notReady` | 必然失败（空提示词/参考图不可解析/时长越界/画幅或秒数不支持） | **是**（用户改或删该镜） |
| `skipped` | 本次批量不参与，但**沿用已有产物**——目前只有 `SHOT_LOCKED` | **否** |

> 第 3 轮 i5 指出："锁镜判 `ready=false` 会把已定妆的镜挡在出片之外，与『跳过而非阻止』自相矛盾"——**该批评成立**。锁镜的语义是"用户已确认、批量重跑跳过它"，它**不是缺陷**。故锁镜归入 `skipped`，`reason` 说明「沿用已有产物，本次不重新生成」；`notReady` 只留给真正的阻止类。

**代价**：就绪判定引入一层间接（`shot-readiness.js` 纯函数）。缓解：该模块零 IO、纯函数、可单测。

## D5 出站合同**复用**既有实现，不新建模块

**决策**：把 `shot-downloader.js` 里的出站合同抽成 `egress-guard.js`（新建），`shot-downloader.js` 与 `video-gen.js` **共用**。

**理由**：调研报告 F11b 的前提（"本仓无等价防护"）被实测推翻——`shot-downloader.js` 已实现 https-only + 私网段 + **每次请求前 DNS 解析校验 IP** + 3xx 手动逐跳重校验 + 500MB 上限 + `.part` → ffprobe → rename（`:6-15` 的安全合同、`:54-90` 的 URL 校验、`:126-166` 的逐跳）。新建 `shared-utils/src/net/safe-fetch.js` 等于造第二份真相源（D-12）。

**与研究报告的分歧（显式记录）**：报告把 F11b 归为"waoowaoo / Elastic 2.0 第一梯队可抄"。本次不抄——本仓自有实现更完整，且报告 §6.1 自己强调"先查目标仓"。本次复用自身资产，外部仅作思路参照。

**`allowedHosts` 白名单在两条路径上的差异（必须显式处理）**：
- 原片下载（`shot-downloader`）：URL 来自 **kit 元数据**，域名集合有限 ⇒ `allowedHosts` 精确白名单成立。
- 成片下载（`video-gen`）：URL 来自 **provider 轮询响应**，域名随 provider/CDN 变化，**无法用固定白名单**。

⇒ 成片下载的**最终口径**：**缺省 fail-closed + 同源自动预填 + 放宽需显式勾选（运行期一次性令牌，不落盘）**（详见 proposal §4.2.1）：

| 要素 | 规则 |
|------|------|
| 可信主机集合 | = { provider **API base URL 主机（自动派生）** } ∪ { `assetDownloadHosts`（运营可配） } |
| 允许端口集 | 随可信域配置声明（`assetDownloadPorts`，缺省 `{443}`） |
| 缺省行为 | 主机不在可信集合 ⇒ **拒绝下载**，错误文案指明去哪儿配 |
| 放宽通道 | 用户在成本确认卡**显式勾选**「本次允许从外部素材域名下载」；勾选产生**运行期一次性令牌**（**只存内存、任务结束失效、SHALL NOT 落盘**）；项目文件 SHALL NOT 存放任何可用于放行的授权位；审计只记「发生过一次外部域名授权」这一**事实**；**未勾选 ⇒ 拒绝** |
| 其余合同 | S-1 https / S-3 私网段 / S-4' DNS 校验 + IP pinning / S-5 逐跳重校验 / S-6 体积上限 / S-7 `.part`+ffprobe→rename —— **无条件生效，放宽通道也不豁免** |

**代价**：素材与 API 不同源的 provider 需要运营配一次 `assetDownloadHosts`（一次性）。**这个代价换来的是"缺省不会从任意公网主机下载"**——第 3 轮评审指出的正是这一点（"仅提示可见而非阻断 ⇒『不是静默放开』只在文案层面成立"）。**显式记录该取舍**：宁可让非同源 provider 首次下载失败并给出可操作指引，也不默认放开出站面。

**D5.0 IP pinning：消除"检查用 A 解析、连接用 B 解析"的 TOCTOU 窗口（回应评审 i1，Critical）**

评审 i1 指出：既有实现用系统解析器（`dns.promises.lookup`，含 `/etc/hosts`）校验 IP，但**校验与实际连接是两次独立解析**——攻击者可在两次之间改变解析结果（DNS rebinding），使"校验通过"落空。评审建议改用固定公共 DNS 解析器。

**本方案采纳问题、但不用"固定公共 DNS"这条对策**：

| 对策 | 评估 |
|------|------|
| 固定公共 DNS（如 DoH） | ❌ 桌面端用户可能有本地 DNS / hosts / 企业内网 / 本地 mock 站点；强制公共 DNS 会**制造新的不可用**，且公共 DNS 本身仍可能被投毒（DoH 只防中间人，不防权威端） |
| **把已校验的解析结果 pin 到 socket** | ✅ 采纳。`https.request(url, { lookup })` 的 `lookup` 覆写让 socket **使用校验时的同一个 IP**，TOCTOU 窗口被物理消除；解析器仍用系统默认（不牺牲可用性） |

⇒ `egress-guard.js` 的合同升级为 **S-4'**：解析一次 → 校验全部解析结果均非内网 → **把该解析结果集 pin 进 socket 的 `lookup` 覆写**。测试用注入的 `lookupImpl` 返回**两组不同 IP**（第一次校验用 A、第二次应被 pin 为 A）断言 socket 实际连接的是已校验的 A（验收 V-24）。

**代价与口径澄清**（回应评审 i3）：`shot-downloader` 重构后，**既有 23 条用例断言的可观察行为全部不变**（回归保证）；但**实现层新增了 IP pinning**——这是**有意的安全增强**，不是"逐字不变"（增强保证由独立用例覆盖）。二者分开记账，缺一不可。

**D5.1 `endFramePrompt` 的读取点（回应评审 i2，Critical）**

评审 i2 指出：方案引入 `endFramePrompt` 却未列出读取函数，而同一标准下 `viewpointId` 以"无消费方"被排除——**标准不一致**。

**采纳**，并把判据统一为「**字段是否有明确的读取点**（消费或展示）」：

- `endFramePrompt`：
  - **展示点已定义**——规划确认卡的逐镜「尾帧」只读行 + 分镜节点详情，供用户核对首尾帧衔接质量；
  - **消费路径已定义但前置未就绪**——消费方是 `video-gen.js` 的尾帧提交，触发条件为 ① provider 支持参考图注入（`video-reference-inputs.js:30-34`，仅 3 家）② 该镜已绑定参考图 ③ 公网图床通道可用（报告 F28，未落地）。三项齐备前该字段**只产出、不入请求**，spec 显式写"SHALL NOT 被送入 provider"。
- `viewpointId`：**无任何读取点**——没有函数会读它，连展示位都没有 ⇒ 本批次不做。

两个字段都进 proposal §2.4「未消费字段台账」，不靠"暂时没接"含糊过去。**代价**：`endFramePrompt` 短期是只写字段，但其读取点与消费前置已写明、已排期，属"等前置"而非"无归属"。

## D6 工具体检只做**存在性**，不硬钉版本下限

**决策**：`tool-doctor.js` 检查 ffmpeg / ffprobe **存在性**并解析版本号用于展示；**不以版本号作为放行条件**。

**理由**：研究报告 §5.2 批次三 F11d 已警告"硬钉 ffmpeg ≥7.1.1 会误判大量环境，建议只做存在性校验"。本仓打包的 ffmpeg 由 `apps/desktop/scripts/stage-media-tools.js` 随包分发，版本由分发策略保证，用户侧的版本差异应**提示**而非**阻断**。

**落地位置**：**出片前**（`video-gen` 阶段入口），而不是合成期（现状 `film-render.js:278/304` 才报"FFmpeg 不可用"）。**不新增 checkpoint**——只是把同一阶段里的前置检查提前，并给出可操作错误文案。

**代价**：不拦截"版本过旧但存在"的环境；这类问题仍会在合成期暴露。

## D7 单镜锁定：`locked` 是**数据字段 + 跳过规则**，不是权限

**决策**：Shot 增加 `locked: boolean`；`auto-runner` 重跑时跳过 `locked` 镜（不重生成、不覆盖 `outputPath`）；`auto-project` 的 patch 白名单加 `locked`（可锁定/解锁）。

**理由**：报告 §4.2 第二梯队 #9 的消费方明确（"重跑分镜/导演审核时 `if (shot.locked) continue`"），不是死代码。字段源自 `ai-art-engine`（**GPL-3.0**）⇒ **仅思路，禁止复制代码**，实现自研。

**锁镜的语义边界**：锁定只影响"**批量重跑**"，不影响"**单镜重生成**"（用户显式点重试仍应生效）。否则用户会失去逃生口。

**代价**：`auto-runner` 增加一条分支；需一条"锁镜 + 单镜重生成"的交互用例。

## D8 乐观锁：只在**并发写同一任务**时生效

**决策**：`project.json` 增加 `revision`（整数，写入时 +1）。写入前若调用方携带的 `expectedRevision` 与当前 `revision` 不一致 ⇒ **fail-closed**，返回可操作错误码，**不覆盖**原文件。

**原子性要求**（回应第 3 轮 i2，Critical）：「读 revision → 比对 → 覆盖写」三步之间仍有窗口——两个会话都可能读到同一个 `revision`、都通过比对、先后写入，后写覆盖先写。**方案为 F-C 专门加了 IP pinning 消除同类 TOCTOU，此处却无对应手段**——该批评成立。

⇒ **写入必须是单次原子替换**：沿用既有 `auto-project.js:80-85` 的 `writeJsonAtomic`（tmp + rename），并把 **`revision` 自增与内容替换放进同一次 rename**：先在 tmp 文件里写好「旧 revision + 1」的新内容并 `fsync`，再一次 `rename` 覆盖。比对在写 tmp **之前**完成；一旦比对通过，替换本身是原子的，**不存在"比对通过但写到一半"的中间态**。补并发写用例断言「无半写文件」（目标文件要么是旧内容、要么是完整新内容）。

**关键口径**：
- **单会话串行写不产生冲突**——`expectedRevision` 缺省时视为"不检查"（向后兼容，既有 14 条测试零改动）。
- 只有显式携带 `expectedRevision` 的路径才触发比对。
- 冲突错误必须**保留原文件**，不得出现"半写"。

**理由**：报告 §4.2 第一梯队 #5（来源 Toonflow-app，MIT，可抄）。指纹（`auto-plan-fingerprint.js`）是**审计**用途不是锁——报告审核记录 §五已澄清"mulpub 用 expectedRevision 乐观锁防并发写入覆盖"。本仓现有 `needsReconfirm`（`auto-project.js:350-358`）是**重确认**机制，与**并发冲突**是两件事，不能互相替代。

**代价**：多一个字段 + 一条分支；`auto-start` 路径需要把 `revision` 带上（否则并发保护形同虚设）。

## D9 身份锚点：结构自研，**提示词文本**参考外部

**决策**：在 `story-context-engine.js` 增加角色身份锚点提取，输出结构：**骨相 / 五官 / 发色瞳色 / 唇色** 四类，**硬上限 4 条**；并在 optimize 阶段把「参考图优先级声明」与「多人同框防串脸约束」注入 prompt-engine 的 context。

**理由**：
1. 报告 §3.21 的七档武器分析：mulpub 已握武器 1（`refTokens` ★★★★★），武器 2（参考图优先级 ★★★★）是**成本最低**的一档；报告 §3.22.1 已把 F15 提级到批次一（"最低成本换最强档"），批次一未做。
2. 身份锚点硬上限 4 条的理由：提示词越长模型越容易丢约束（报告 §4.2 F19' 细节）。
3. 参考图优先级声明的语义：**最早的参考图 = 身份锚，后续参考图仅用于场景/光线/构图/情绪**。

**许可证**：来源 `moyin-creator` 为 **AGPL-3.0** ⇒ **禁止复制源码**。但**提示词文本不受版权保护**（报告 §7.1 结论 2 与审核记录 §六均确认），故三类**提示词**可参考重写；**实现结构自研**。落地时提示词一律外置到 `film-kit/prompts/tasks/generate_shot_prompt/{zh,en}/`，禁止内联进 `.js`（防膨胀硬约束）。

**代价**：`story-context-engine.js` 是成熟模块（多层上下文规则 + 成语误判守卫），加锚点必须**不破坏**既有 `detectDynasty` 等函数的语义——新增能力走独立函数，不改既有分支。

## D10 逐镜时长必须落进项目文件

**决策**：`auto-project.js` 的 shot 结构补 `durationMs` / `durationSource` / `durationRawSec`（与 `auto-plan` 派生值一致）。

**理由**：实测 G-8——`auto-project.js:209-221` 的 shot 结构不落时长，导致规划层算出的 `durationMs` 在续跑/重生成时丢失、回落全局 `seconds`。这是**已存在的数据丢失**，不是新功能。

**代价**：`createProject` / `touchShot` 的参数增加三个字段；既有测试断言的 shot 结构需同步（属**增量字段**，不改既有键的值）。

## D11 乐观锁与 `needsReconfirm` 是两件事，不合并

**决策**：两者并存，不互相替代。

| 机制 | 回答的问题 | 触发时机 |
|------|-----------|---------|
| `needsReconfirm`（既有） | 「计划/内容改过了，用户的确认还作数吗？」 | 启动前 |
| `expectedRevision`（新增） | 「有没有别人在我之后改了同一份项目文件？」 | 写入前 |

**理由**：报告审核记录 §五指出外部项目用 `expectedRevision` 解决"并发写入覆盖"；本仓的 `needsReconfirm` 解决"确认失效"。两者**问题域不同**，合并会让任一语义被稀释。

## D12 文档类变更与运行时代码分 PR

**决策**：方案文档（`openspec/changes/**`）与**第一期实现**同 PR（PR-1）落地；后续 PR 只带实现。

**理由**：本仓要求"先文档再代码"（AGENTS.md 核心原则），但**单独提一个只含方案的空 PR** 会产生一次无运行价值的合并，且方案文档若与实现分批落地，评审时无法对照。PR-1 同时含方案与 F-A 实现，评审可逐条对照。

## D13 不建 `packages/jianying-draft/`

**决策**：本次不做剪映草稿导出。

**理由**：报告 §5.2 批次三 F10 已上调为「大（混合 PR）」并要求**前置 spike**（先在目标版本实际生成并打开草稿，通过后才移植）。本次范围内无 spike 环境，且与两处目标面无关。写进 proposal §六 D-3 作为显式不做项，避免"看起来有遗漏"。

## D14 锁镜复用既有 patch 通道，不新增 IPC（回应评审 i4）

**决策**：锁镜/解锁走**既有** `film-engineering:auto-*` 的分镜 patch 通道——`auto-project.js` 的 `patch` 白名单（当前 `['prompt', 'refPaths', 'seconds', 'title']`）**新增 `locked`**，前端 `FilmAutoPanel.vue` 调同一条通道。

**理由**：
1. 不新增 IPC 通道 ⇒ preload 通道计数**不变**（`preload.test.js` 有计数断言），不需要动 `PUBLIC_CHANNELS` 与 `license-access-control` 清单；
2. 锁镜就是"分镜的一个属性"，走分镜属性通道语义最自然；
3. **失败回滚**：patch 返回错误时，UI 的锁标记**回滚为服务端返回的 `locked` 真值**（以服务端为准），并弹出可操作提示——不做"乐观置位后不回滚"。

**代价**：既有 patch 白名单断言（若存在"只接受 4 个字段"的测试）需同步放宽到 5 个字段——属**契约扩展**，不是放宽门禁。

## D15 出站下载实现先独立成模块，再换合同（回应评审 i6）

**决策**：拆两个 PR：
- **PR-5（纯重构）**：把 `video-gen.js` 里的 `downloadToFile` 原样搬进新模块 `film-video-downloader.js`，**行为完全不变**（仍是现有的裸 http + 无限跟随实现）。既有 `video-gen.test.js` 19+7 例必须全绿，新模块补等价性用例。
- **PR-6a（零行为抽取）**：把 `shot-downloader.js` 的出站合同**原样**抽成 `egress-guard.js`，`shot-downloader` 改调它（**行为零变化**），依赖单向。
- **PR-6b（加固）**：在 `egress-guard` 上加 IP pinning / 端口集 / 可信主机策略，并让 `film-video-downloader` 改走。

**理由**：`video-gen.js` 同时承载成本闸（PR-4 改 `costCheck`）与下载实现（PR-6 换合同）。若不先抽离，PR-6 的"换实现"与 PR-4 的"改闸"落在同一文件相邻位置，**回归面重叠、变红时无法定位是哪一个引入的**。6a 再把"抽取"与"加固"分开，解决第 3 轮 i8 指出的"抽取方向未定"（\`egress-guard\` 抽自 \`shot-downloader\` 又被 \`shot-downloader\` 反向调用）。

**代价**：PR 总数 8 → **9**。

## D16 就绪度的 `SHOT_LOCKED` 判据依赖 F-E（回应评审 i8）

**决策**：就绪度判据里的 `SHOT_LOCKED` 读的是 PR-3 引入的 `locked` 字段 ⇒ **PR-4 显式依赖 PR-3**，依赖图画出这条边。

**理由**：若 PR-4 先合并，判据要么悬空（读一个不存在的字段）、要么漏判锁镜（用户看不到"这镜被锁了"）。**依赖显式标注**，不靠"合并顺序恰好对"。

**替代方案（未采纳）**：把 `SHOT_LOCKED` 从 PR-4 挪到 PR-3——但那样 PR-3 就要先定义就绪度结构，PR-4 反而变成"往已有结构里加判据"，边界更糊。

**代价**：主链变长（PR-1 → PR-3 → PR-4 → PR-6b → PR-7）。这是**为可定位性付的代价**，值得。

## D17.5 乐观锁需要**锁**，rename 只管**原子**（回应第 4 轮 i3，Critical）

**决策**：并发正确性由**独占锁文件**保证，落盘原子性由 rename 保证，两者职责不可互换。

- 写入方先以 `fs.open(lock, 'wx')`（独占创建，已存在即失败）在项目目录取锁；
- **持锁期间**完成「读 revision → 比对 `expectedRevision` → 自增 → 写 tmp → fsync → rename」；
- 释放锁（正常与异常路径都要释放，避免死锁）。

**理由**：第 3 轮我把「比对 + 自增 + 写入在同一次原子替换内完成」当成并发正确性的答案，**这是错的**——rename 只保证**单次写**的原子性，不提供 compare-and-swap 语义。两个进程可各自读到 `revision=5`、都通过比对、再先后 rename 成 6，**后写仍覆盖先写**。第 4 轮评审抓到了这一点：**同一仓里我已经为 F-C 设计了 IP pinning 来消除同类 TOCTOU，却在写侧没做对应处理**——这是自相矛盾的。

**代价**：多一个锁文件 + 释放逻辑（异常路径也要覆盖）；锁文件本身要防「进程崩溃后残留」——采用「锁文件带进程 PID，陈旧锁（PID 不存在）可被清理」的策略，且**锁只保护单次写入事务**，不跨事务持有。

## D17 存量分镜的 `videoPrompt` 边界（回应第 3 轮 i1，Critical）

**决策**：
- kit 加载期归一化：\`imagePrompt ??= prompt\`、**\`videoPrompt ??= ''\`（空，不回落 prompt）**、\`endFramePrompt ??= ''\`；
- **自动模式新规划的分镜重算** \`videoPrompt\`：只保留「运镜 + 主体 + 时长内的变化」，**不复制 \`imagePrompt\` 的静态画面全量**；
- 视频请求时 \`videoPrompt\` 为空 ⇒ 回落 \`imagePrompt\`，**行为与变更前逐字一致**。

**理由**：第 3 轮 i1 指出「\`videoPrompt\` 回落 \`imagePrompt\` ⇒ G-1 在存量 153 条上根本不成立，F-A 收益只剩新写的分镜」——**问题成立**。但**不能靠机械重算存量解决**：实测 \`shot-library.json\` 的 \`shot[0].prompt\` 长 **13,922 字符**，且是**无块标记的自由文本**（开头 \`EXACT 2 CHARACTERS\` 后接角色长描述），没有可机械切分的块分隔标记。按运镜/机位关键词做启发式抽取会把 153 条行业分镜的运镜信息抽漏 ⇒ **画质回归比长 prompt 更糟**。

**为什么把口径改成空串而不是回落 prompt**：\`??= prompt\` 会让"存量没被解决"这件事**被掩盖成"已解决"**（字段非空、长度不减）。改成 \`??= ''\` 后，存量分镜的 \`videoPrompt\` 明确为空 ⇒ 回落 \`imagePrompt\` 的路径一眼可见，边界写在数据里而不是写在文档里。

**断言落点**：验收改为「**自动模式新规划分镜**的 \`videoPrompt.length < imagePrompt.length\`（逐镜）」+「**存量** \`videoPrompt === ''\`、\`imagePrompt === prompt\`」两条。后者把"存量未被重算"固化成可回归的断言。

**存量治理列为后续项**（不阻塞本批次）：用提示词优化引擎做**一次性批量重算 + 人工审核**（153 次调用），产出新的 \`videoPrompt\` 落库。这是一次性资产生成，范围独立。

**代价**：本批次**不解决**存量分镜的视频提示词过长问题（proposal §六 D-14 列入不做项），收益面收窄到"新规划/新套用的分镜"。**明确不假装已解决。**


## D18 PR-3：三项接线的**真实缺口**（实施期实测修正方案原文的三处口径）

背景：PR-1 的方案把 F-H/F-I/F-J 描述为「方法论标签页仍按 7 块渲染」「导入 IPC 未启用」。
实施期逐条核对现状后，三处口径都需要修正 —— **方案原文写的是"引用 PRD 的说法"，不是实测**。

### D18.1 F-H 的真实缺口不是「7 块 → 11 块」，而是「配方 + 失败台账两个分区没渲染」

- **实测**（`apps/desktop/src/views/FilmEngineeringView.vue:179-202`）：方法论标签页已经是 `v-for="b in doctrine.blocks"`
  ⇒ **11 块全渲**；另有 `doctrine.rules`（14 条）与 `doctrine.glossary`（10 条）。
- **实测**（`apps/desktop/electron/film-kit/prompt-doctrine.json` 顶层键）：`blocks` 11 / `rules` 14 /
  `recipes` 2 / `failureLedger` 8 / `glossary` 10 —— 数据**全都在**。
- **真实缺口**：`doctrine.recipes`（2 条配方，含 `blockKeys`）与 `doctrine.failureLedger`
  （8 条失败台账，含 `symptom` / `cause` / `fix` / `tags`）**在数据里但视图不渲染**。

⇒ **F-H 收窄为**：补这两个**只读**分区 + i18n zh/en 成对。**不改**既有四标签结构
（D13 口径：写操作一律走「自动」标签）。PRD 批次一那句"仍按 7 块渲染"已过期，**以本条为准**。

### D18.2 F-I 必须在「零 provider 调用」内落地 —— `generate_shot_prompt` 是 LLM 任务模板

- **实测**：`planAutoShots` 的契约是「**零 provider 调用、零落盘**」（`auto-plan.js:190`）；
  而 `prompts/tasks/generate_shot_prompt/{zh,en}/system.md` 是一份 **LLM 任务**：它规定 7 块结构，
  并要求模型输出 JSON（`image_prompt` / `video_prompt` / `end_frame_prompt` / `negative_prompt` / `warnings`）。
- **实测**：`getTaskPrompts` / `renderTemplate`（`prompt-library.js`）**只有测试、没有生产消费方**。
- ⇒ 「在规划期调用 LLM」与 `planAutoShots` 的契约冲突；且成本闸（F-B 就绪度）在 **PR-5** 才落地
  ⇒ 本 PR 调 LLM 就是「**没有闸的花钱**」。

**落地形态（两件事，都零 provider）**：

1. **补上 F-A 留空的 `endFramePrompt`**：来源是 `prompt-doctrine.json` 的 `frame_constraint` 块
   （**外置文本**，随 kit 更新，不硬编码进 `.js`）。这正是 F-A 规格里写的
   「尾帧约束文本来自任务级提示词库 / doctrine 的 `frame_constraint`」。
2. **每镜附带「任务级提示词包」**：用 `prompt-library` 的 `generate_shot_prompt` 任务模板 ——
   `system` 原文（7 块结构契约）+ `user` 模板按 **7 个变量**渲染
   （`shot_json` / `palette_line` / `style_prefix` / `geo_block` / `character_descriptors` /
   `duration_sec` / `model`，值来自 kit 资产与本镜信息）+ **未提供的变量名清单**
   （`renderTemplate` 的 `missing` —— 便于发现漏填，不静默填空串）。
   这就是「库与渲染器已就绪、规划流程未接」的最小闭环：接上之后 `getTaskPrompts` / `renderTemplate`
   有了生产消费方，**后续接 LLM 时零改造**。

**纯增量 + 缺失可见**：kit 缺 doctrine / promptLibrary / palette 时，
既有三分字段与 `prompt` **逐字不变**（`endFramePrompt` 仍为 ''、无 `promptTask`），
并在 `warnings` 里出声（W10 / W11）—— 资产缺失**可见**，不静默。

### D18.3 F-J 的前提不成立：产品里没有「导入」入口

- **实测**：`userData/film-kit` 只被**读**（`container.setup.js:463` 设 `userDataKitDir` →
  `loadFilmKitChain` 回退链首级），**没有任何代码写它**。
  ⇒ 两级回退链的首级至今是死代码；方案里「导入 IPC 未启用」的真实情况是**导入入口不存在**。
- ⇒ F-J 不是「加一个开关」，而是**新增一条写路径**（选目录 → 严格校验 → 落盘 → 失效缓存），
  它有**自己的安全面**：只拷白名单文件 / 不跟随符号链接 / 原子换目录。
  这与 F-I/F-H 的「只读接线」不是同一类风险。

⇒ **拆成独立 PR（PR-3b）**：本 PR 只做 F-I + F-H（只读 / 纯计算），F-J 单独走一轮写路径安全评审（见 D19）。

## D19 F-J 独立成 PR-3b：写路径要单独过安全评审，不与只读接线混在一笔

**理由**（三条，各自独立成立）：

1. **风险面不同**：F-I/F-H 是只读 / 纯计算（F-H 甚至只改渲染层）；F-J 会**写 userData**
   （用户可见的文件系统副作用），两类风险混在一笔时，评审注意力会被稀释。
2. **原子性要求不同**：落盘必须「写临时目录 → 严格校验 → 换名」，中途失败**不能留下半份 kit**
   （半份 kit 比没有更危险 —— 与 `prompt-library.js` 既有口径同型：半个库比没有危险）。
3. **评审粒度**：写路径的对抗性审查要逐条盯「符号链接逃逸 / 半份 kit / 覆盖既有导入 / 失败回滚」，
   与只读接线混在一笔会让评审载荷超长、两个风险面互相遮蔽（本仓「拆 PR 原则：体积小 →
   对抗性审查不被截断」）。

**依赖**：PR-3b 依赖 PR-3 —— 导入的严格校验要认 doctrine / promptLibrary / palette 这些增强资产，
⇒ 资产面先在只读路径上跑通，导入面再谈落盘。


## D20 PR-3 的字段契约与缺失分级（决策层第 1/2 轮收敛后的定稿）

D18 定了「做什么」，D20 定「做成什么样」—— 字段级契约，供实现与判据直接照抄。

### D20.1 `endFramePrompt`：只用 doctrine 的 `frame_constraint` 块

| 项 | 契约 |
|----|------|
| 类型 | `string`（`shot.endFramePrompt`） |
| 上限 | `FILM_PROMPT_MAX_LEN = 50000` 字符（与既有单字段上限同值，**不放宽**） |
| locale | doctrine 的 `zh` / `en`；**缺 en 回退 zh**（回落记进 `promptContext.fallbackLocales`） |
| 内容 | `frame_constraint` 块的 zh/en 文本（**外置**，随 kit 更新，不硬编码进 `.js`） |
| 与另两字段的关系 | **独立字段，不拼接**（F-A 规格：尾帧只产出不消费，消费侧不发送） |
| 缺 doctrine | `""`（**纯增量**：`prompt` 与三分字段逐字不变，F-A 零回归锁继续成立） |

**为什么不用 `generate_shot_prompt` 那条路径**：它的尾帧铁律要 **LLM 才产出**，
而本 PR 零 provider ⇒ 那条路径**不可达**；两条都写会得到「一个来源、两个真相」。

### D20.2 两类缺失必须**行为可区分**（不是同一种「空」）

| 类别 | 含义 | 渲染文本 | 清单 | 机器可判字段 |
|------|------|---------|------|-------------|
| `byDesign` | **设计上不填**（`style_prefix`） | 保留 `{{var}}` **原样** + 标注 `[不可直送LLM]` | 进 `missing` | `deliverable = false`，`blockedVars` 含该项 |
| `assetMissing` | **资产缺口**（`geo_block`） | 渲染为**空串**（不把占位符喂给下游） | 进 `missing` | `deliverable = false`，`blockedVars` 含该项 |

⇒ 未来的 LLM 消费方**必须**先校验 `deliverable === true` 才可直送；
「文档里写着别直送」不算机制 ⇒ 本 PR 用**测试锁死该字段**。

### D20.3 持久化口径统一（一条链，一种口径）

| 内容 | 落点 | 理由 |
|------|------|------|
| `promptContext` = `{ taskId, locale, sourceHash }` | **项目文件（plan 级）** | `system`/`user` 原文按 `taskId` 引用，不逐镜复制 |
| `promptVars` + `promptMissing` | **项目文件（逐镜）** | 每镜 ≤ 1KB；续跑/重生成据此**重渲染** |
| `renderText` + `deliverable` + `blockedVars` | **仅规划结果**（IPC 返回值，不落盘） | 可由 `vars` + 同版本库重渲染，存它是重复 |
| `system` / `user` 原文 | **不落** | 按 `taskId` 引用库；`sourceHash` 变了就是资产变了 |

### D20.4 确定性：`sourceHash` 与「同 kit ⇒ 重渲染逐字相同」

- `sourceHash` = sha256(doctrine 文本 + 该任务的 system/user 文本) —— 便宜且**正好覆盖**影响渲染的输入。
- 续跑时用**同一 kit**（`sourceHash` 相同）⇒ 重渲染结果**逐字相同**。
- `sourceHash` 变了 ⇒ 资产变了 ⇒ 续跑必须重渲染并**显式记录**，**不静默沿用**旧渲染结果。

### D20.5 W10/W11：规划不 fail-closed，但带机器可判的 `blockedExport`

- W10（缺 doctrine）/ W11（缺 promptLibrary）⇒ 规划**仍出结果**（拒绝会让老 kit 整个不可用），
  但警告携带 **`blockedExport = true`**（机器可判，测试直接断言该字段）。
- **导出执行留后续 PR**（本 PR 不开导出入口）—— 理由见 D19 的同类口径：提示词资产的导出面需单独权限评审。

### D20.6 F-I-2 在本 PR 内的真实消费方：只读「方法论接入状态」面板

自动模式**确认卡**新增一个 plan 级只读分区（不逐镜铺开）：

- 任务模板：`generate_shot_prompt`（+ locale）
- 变量命中：`5/7`（列出 `missing` 的分类与具体项）
- 可否直送 LLM：`deliverable`（false 时显示原因）
- 资产版本戳：`sourceHash` 前 8 位
- 资产缺失警告：W10 / W11

⇒ `promptTask` 从「只有测试碰到」变成**用户路径上可见**的一等信息。
它回答的是「我的自动分镜到底接上了多少方法论」—— 不是装饰面板。


## D21 第 3 轮收敛：长文本不逐镜复制 + 渲染确定性 + 缺失四分类

D20 定了字段契约；D21 是第 3 轮 critic（2 条 Critical）指出的**同一条原则的三处落地**：
「**同一段长文本不逐镜复制**」+「**渲染结果必须可归因**」。

### D21.1 尾帧约束落 **plan 级**，逐镜 `endFramePrompt` 仍为 `''`

`frame_constraint` 是**逐镜相同**的方法论原文（实测 505 字符）。逐镜各存一份 ⇒
同一段文本复制 N 份、项目文件随镜数线性膨胀 ⇒ 与 `system`/`user` 已有的处理自相矛盾。

| 内容 | 落点 | 说明 |
|------|------|------|
| `promptContext.frameConstraint` = `{ text, locale, fallback, truncated }` | plan 级项目文件 | 方法论原文，**存一次** |
| `shot.endFramePrompt` | 逐镜 | **仍为 `''`**（F-A 口径不变）—— 本批次**无法逐镜派生**尾帧文本（要 LLM），留空即「不发送」，不会把规则原文当正文喂给模型 |
| `promptContext.frameConstraintPending = true` | plan 级 | **如实标注**「尾帧规则已接入，逐镜派生待 LLM」 |

**字段契约**：`text` 为 string；上限 `FILM_PROMPT_MAX_LEN = 50000`（**不放宽**，超长截断并 `truncated=true`）；
locale 取 doctrine 的 `zh`/`en`，**缺该语种回退 zh**（回退记进 `promptContext.fallbackLocales`）；
与 `imagePrompt`/`videoPrompt` **不拼接**（F-A：尾帧只产出不消费）。

### D21.2 `sourceHash` 必须覆盖**所有**影响渲染结果的量

```
sourceHash = sha256( "v1" + locale + resolvedFallbacks + doctrine 文本 + system 原文 + user 原文 )
```

- `locale` 纳入：不同语种渲染结果不同。
- **locale 回退**纳入：`en` 缺 → 回落 `zh` 时渲染出来的是 `zh` 的文本 ⇒ 回退事实必须进哈希。
- `shot_json` **固定键序**（`index` / `shotId` / `title` / `beatIndex` / `characterNames` / `model`）⇒ 同一镜序列化稳定。
- `v1` 是**序列化版本号**：将来改键序/增字段时 +1 ⇒ 旧哈希不会与新哈希混淆。

⇒ 续跑时用**同一 kit + 同一 locale**（`sourceHash` 相同）⇒ 重渲染**逐字相同**；
哈希变了 ⇒ 资产或语种变了 ⇒ 必须重渲染并**显式记录**，不静默沿用旧结果。

### D21.3 缺失分**四类**（行为各不相同）

| 类别 | 触发 | 渲染文本 | 清单 | 机器可判 |
|------|------|---------|------|---------|
| `byDesign` | 设计上不填（`style_prefix`） | 保留 `{{var}}` **原样**（不提供该变量） | 进 `missing` | `deliverable=false` + `blockedVars` |
| `assetMissing` | 资产缺口（`geo_block`） | 渲染为**空串**（提供空值 ⇒ 不留占位符） | 进 `missing` | 同上 |
| `templateVar` | 模板要但我们没给（`renderTemplate.missing`） | 保留 `{{var}}` 原样 | 进 `missing` | 同上 |
| `badVarName` | 我们给的变量名不合规（`renderTemplate.unknownVars`） | —— | 进 `missing` | 同上（并视为实现缺陷） |

**locale 回退规则提为统一函数**（`pickLocaleText`），覆盖 doctrine（`frame_constraint`）、
palette（`paletteLine`）、任务模板（`getTaskPrompts` 的 en 缺失 → 回落 zh）三处；
回退事实统一记进 `promptContext.fallbackLocales`。

### D21.4 `blockedExport` 落 plan 级，并被面板消费

- 落点：`promptContext.blockedExport`（**plan 级、持久化**）—— W10/W11 触发时为 `true`。
- 消费方：接入状态面板显示「**导出已阻断**」。
- **本 PR 不开导出入口** ⇒ 该字段此刻只是**机器可判标记**；导出执行留后续 PR。

### D21.5 判据分两类：**合成夹具**（有阈值）与**真实 kit 巡检**（无阈值）

| 类别 | 断言什么 | 阈值 | 资产更新会不会变红 |
|------|---------|------|------------------|
| 合成夹具 | 行为（渲染 / 分级 / 体积 / 确定性） | **有**（固定数值） | **不会**（数据固定） |
| 真实 kit 巡检 | **一致性**（命中数与 `missing` 清单与实测一致）+ **打印读数** | **无** | **不会**（只断言一致性） |

⇒ 资产更新不会让这两类用例变红；「N/7」这个读数由巡检打印、由面板显示，**不写成阈值**。

## D22 第 4 轮收敛：哈希分两级 + 方法论原文不落盘 + 命名与计数对账

D21 定了「不逐镜复制长文本」；D22 补上它的三个漏洞：**同资产不同镜的渲染不同**（哈希要分两级）、
**方法论原文落进用户项目文件多一条外发面**（只留哈希）、**清单与计数对不上**（自检断言）。

### D22.1 确定性分两级：`promptAssetHash`（资产面）+ `promptRenderHash`（渲染面）

| 哈希 | 覆盖 | 回答什么 | 落点 |
|------|------|---------|------|
| `promptAssetHash` | doctrine + 任务 system/user 原文 + locale + 回退事实 | 「**资产**变没变」 | plan 级 |
| `promptRenderHash` | 固定键序的逐镜 vars + locale | 「**这一镜**的渲染变没变」 | 逐镜 |

- **两者不能合并**：同一资产的**不同镜**渲染本就不同（逐镜 vars 不同）⇒
  「资产哈希相同 ⇒ 渲染逐字相同」是**假命题**；逐镜相等只能靠 `promptRenderHash`。
- 拼接一律**长度前缀**（`len:key=len:value`）⇒ 杜绝 `a=bc` 与 `ab=c` 的碰撞。
- `shot_json` **固定键序**；`v1` 是**序列化版本号**（改键序/字段时 +1）。

### D22.2 方法论原文**不落**用户项目文件

`system` 原文已被判定「属提示词资产，导出面需单独权限评审」；同理，
`frame_constraint` 原文落进**用户项目文件**也多出一条外发/日志面（项目文件会随分享、日志、备份流出去）。
⇒ **只留哈希与长度**：`promptContext.frameConstraint` = `{ hash, length, locale, fallback, truncated, source }`。
原文本来就在用户**本地的 kit** 里，需要时按 kit 读 ⇒ 用户项目文件里**不含任何方法论原文**。
逐镜 `endFramePrompt` 仍为 `''`（本批次无法逐镜派生，要 LLM；留空即「不发送」）。

### D22.3 命名与计数必须对账

- `blockedExport` ⇒ 改名 **`assetsIncomplete`**：本 PR **没有导出入口**，
  叫「导出被阻断」会让人以为导出功能已存在。面板文案相应改为「资产不完整，请重新导入」。
- `fallbackLocales` ⇒ **按来源分组**（`{ doctrine: {}, palette: {}, task: {} }`）⇒ 消费方分得清是哪一处回退。
- i18n key 清单**逐条编号**列出，并在测试里**数一遍 locale 文件的 key 数**、断言等于清单条数 ⇒
  「清单写了几个」与「文件里实际有几个」对不上就是欠账。
- F-H 的「可单独回退这一笔」在 **squash 合并**下**无执行体** ⇒ 回退口径统一改为「**revert 整个 PR**」。
