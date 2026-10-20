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

## D2 三分合计有上限，单字段上限不动

**决策**：
- 单字段上限沿用既有 `FILM_PROMPT_MAX_LEN = 50000`（**不改常量**，避免破既有锁）。
- 新增**合计上限** `FILM_PROMPT_BUNDLE_MAX_LEN = 50000`：`imagePrompt + videoPrompt + endFramePrompt` 合计不得超过。
- 合计超限 ⇒ kit 加载 **fail-closed**（`FILM_KIT_UNAVAILABLE`），**不静默截断**。

**理由**：研究报告 §5.2 F6 明确点名"`FILM_PROMPT_MAX_LEN=50000` 的单字段口径需明确三字段口径（是各 50000 还是合计 50000）"。若各 50000，三段合计可达 15 万字符送进 provider，必然被拒且难以定位。合计上限与真实 provider 承载一致。

**代价**：新建 kit 若三段都写满会被拒——但这正是要暴露的问题。

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
| `SHOT_LOCKED` | 该镜被锁定，本次批量不参与 |
| `SHOT_SECONDS_UNSUPPORTED` | provider 不支持该秒数档位 |

**代价**：就绪判定引入一层间接（`shot-readiness.js` 纯函数）。缓解：该模块零 IO、纯函数、可单测。

## D5 出站合同**复用**既有实现，不新建模块

**决策**：把 `shot-downloader.js` 里的出站合同抽成 `egress-guard.js`（新建），`shot-downloader.js` 与 `video-gen.js` **共用**。

**理由**：调研报告 F11b 的前提（"本仓无等价防护"）被实测推翻——`shot-downloader.js` 已实现 https-only + 私网段 + **每次请求前 DNS 解析校验 IP** + 3xx 手动逐跳重校验 + 500MB 上限 + `.part` → ffprobe → rename（`:6-15` 的安全合同、`:54-90` 的 URL 校验、`:126-166` 的逐跳）。新建 `shared-utils/src/net/safe-fetch.js` 等于造第二份真相源（D-12）。

**与研究报告的分歧（显式记录）**：报告把 F11b 归为"waoowaoo / Elastic 2.0 第一梯队可抄"。本次不抄——本仓自有实现更完整，且报告 §6.1 自己强调"先查目标仓"。本次复用自身资产，外部仅作思路参照。

**`allowedHosts` 白名单在两条路径上的差异（必须显式处理）**：
- 原片下载（`shot-downloader`）：URL 来自 **kit 元数据**，域名集合有限 ⇒ `allowedHosts` 精确白名单成立。
- 成片下载（`video-gen`）：URL 来自 **provider 轮询响应**，域名随 provider/CDN 变化，**无法用固定白名单**。

⇒ 对成片下载采用**收紧但不封闭**的合同：**https-only + 私网段拦截 + 每次请求前 DNS 解析校验 + 3xx 逐跳重校验 + 体积上限 + `.part`/ffprobe/rename**，**不做域名白名单**。信任边界由"provider 响应须经已认证的轮询通道取得"承担。

**代价**：成片下载路径没有域名白名单这一层。比原来（裸 http + 无限跟随）严格得多，但弱于原片路径。**显式记录该取舍**，不假装两者等价。

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
