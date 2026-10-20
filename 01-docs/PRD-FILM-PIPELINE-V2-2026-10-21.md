# PRD — 影视工程流水线 v2（提示词三分 / 生成就绪度 / 单镜锁定 / 出站安全 / 身份锚点）

> **文档编号**：PRD-FILM-PIPELINE-V2-2026-10-21
> **分支**：`film-pipeline-prompt-triple-and-guards` ｜ **依据**：`01-docs/RESEARCH-AI-FILM-OPENSOURCE-2026-10-19.md`（19 个 AI 影视开源项目调研）§4.2 梯队 + §5.2 批次二/三
> **前序**：`01-docs/PRD-FILM-PROMPT-ASSETS-2026-10-20.md`（批次一，PR #4052）
> **OpenSpec**：`openspec/changes/film-pipeline-prompt-triple-and-guards/`
> **状态**：方案已定稿（CCG 决策层评审中），实现按 PR-1 ~ PR-5 分批落地
> **分层判定**：混合 PR（改 `apps/desktop/electron/` 运行时代码）→ 走完整质量节拍，隔离 worktree 实施

---

## 一、为什么要做（问题陈述）

批次一（2026-10-20 落地）把**提示词资产层**补齐了：镜头语法枚举、剧本合规清单、剧组色盘、任务级提示词库、方法论扩容、单镜时长来源链。

**但资产层只是"弹药"，流水线本身仍有 8 处实测确认的缺口**。本 PRD 只处理其中落在「自动」标签与「提示词优化」阶段的那几处。

| # | 缺口 | 实测证据 | 用户能感知到的后果 |
|---|------|---------|------------------|
| G-1 | 分镜提示词一段到底 | `shot-library.json:5` 只有单一 `prompt`；`kit-loader.js:121` 校验该字段 ≤50000；全目录 grep `imagePrompt\|videoPrompt\|endFramePrompt` **零命中** | 单镜提示词最长 **13,922 字符**。模型注意力衰减 → **画面"看着对却不对味"，重试也没用**。用户只能自己删提示词试错 |
| G-2 | 成本闸是全批次级，无逐镜就绪度 | `video-gen.js:279-307`；`costCheck.shots[]` 仅 `{index, shotId, title, aspect, seconds}`（`:297-303`） | 有一镜提示词是空的/参考图坏了，**用户先勾选确认、然后等生成失败**才知道。白等一轮，还可能白扣一次费 |
| G-3 | 成片下载出站完全裸奔 | `video-gen.js:116-145 downloadToFile`：**允许 http**、3xx **无限递归跟随**、**无私网段拦截**、**无 DNS 校验**、**无大小上限**、**直接写目标文件** | 恶意/异常 provider 返回内网地址会**打穿本机网络**；下载中断会**留下半成品 mp4 被当成品** |
| G-4 | 缺 ffmpeg 到合成期才暴露 | `film-render.js:278-279` `findFfmpeg()` 失败 → 到合成阶段才返回「FFmpeg 不可用，无法合成成片」 | 用户跑完 8 镜才发现环境缺件，**全部白跑** |
| G-5 | 重跑覆盖人工精修过的镜 | `auto-project.js:295` patch 白名单仅 `prompt/refPaths/seconds/title`；全目录无 `locked` | 手动调好的那一镜，**下次批量重跑被冲回默认值** |
| G-6 | 并发写无版本保护 | `auto-project.js:246-259 writeProject` 直接覆盖；`auto-plan-fingerprint.js` 是**审计指纹**不是锁 | 两个窗口同时改同一任务，**后写的把先写的抹掉**，且无提示 |
| G-7 | 提示词优化阶段无身份锚点 | `story2video-stages.js:1747-1798` 只有 `negativeAnchors`/`characters` 文本锚点；story2video 主管线**不传参考图** | **角色跨镜漂移、多人同框串脸**——业界唯一没解决的连续性难题（报告 §3.21 武器 2） |
| G-8 | 逐镜时长断在项目文件 | `auto-project.js:209-221` 的 shot 结构**不落** `durationMs`/`durationSource` | 规划阶段算好的台词时长，**续跑/重生成时丢失**，回落全局固定秒数 |

---

## 二、目标与非目标

### 2.1 目标

1. **提示词按用途分离**：首帧图 / 视频运动 / 尾帧约束三份，各有职责；**存量 153 条分镜零迁移**。
2. **生成前就能看出哪一镜不行**：成本闸内联逐镜就绪度，不新增第二道闸。
3. **人工精修结果受保护**：`locked` 镜不被批量重跑覆盖，但单镜重生成仍可用。
4. **并发写有版本保护**：`expectedRevision` 乐观锁，冲突 fail-closed。
5. **出站下载有合同**：复用本仓既有原片下载合同 + 补 IP pinning。
6. **环境缺件提前说**：出片前体检 ffmpeg/ffprobe。
7. **角色跨镜不漂**：提示词优化阶段注入角色身份锚点与参考图优先级。

### 2.2 非目标（明确不做）

- ❌ 不做 VLM 质检闭环（本仓无视觉适配器，自动重试会绕过被测试锁死的成本闸）。
- ❌ 不做 Scene 视角变体 `viewpointId`（**无消费方 = 死代码**）。
- ❌ 不做剪映草稿导出（需前置 spike）。
- ❌ 不做音频三件套（需 `tpad`/`loudnorm`，打包滤镜白名单仅 11 个）。
- ❌ 不做场次并发 / 跨集 Series Bible / 组级多镜头提示词 / 时长双向归一 / 分片渲染 / checkpoint。
- ❌ 不动 `packages/python-backend/`。
- ❌ 不动「画布」「快速渲染」「历史记录」标签。

---

## 三、数据模型

### 3.1 Shot 三分提示词

| 字段 | 类型 | 必填 | 默认 | 语义 | 长度上限 |
|------|------|------|------|------|---------|
| `prompt` | string | 是（存量） | — | **保留不动**。存量分镜的原始提示词 | 50000（既有 `FILM_PROMPT_MAX_LEN`） |
| `imagePrompt` | string | 否 | `??= prompt` | **首帧图**提示词：静态画面描述（主体/场景/光线/构图/风格） | 单字段 50000 |
| `videoPrompt` | string | 否 | `??= ''`（**空**，不回落 prompt） | **视频运动**提示词：只保留「运镜 + 主体 + 时长内的变化」，**不含**静态画面全量 | 单字段 50000 |
| `endFramePrompt` | string | 否 | `??= ''` | **尾帧约束**：末帧应当是什么（衔接下一镜的起点） | 单字段 50000 |

**合计上限**：`imagePrompt + videoPrompt + endFramePrompt` ≤ `FILM_PROMPT_BUNDLE_MAX_LEN = 50000`。
- **单位**：字符（`String.length`，**不是字节**）；
- **计量对象**：三字段**之和**（旧字段 `prompt` 不计入）；
- **超限处置**：**kit 加载 fail-closed**（`FILM_KIT_UNAVAILABLE`），**不静默截断**；错误文案含文件名、镜 id、实测长度与上限。
- 数值/单位/口径同步写进 `apps/desktop/electron/film-kit/SCHEMA.md`。

> 为什么要合计上限：三段各 5 万 = 15 万字符送进 provider 必然被拒且难定位。合计上限与真实承载一致。`prompt` 字段保留是为了既有消费方（分镜库 UI、剧本套用）零改动。
>
> **存量与新分镜的区别（重要，不要误读）**：
> - **自动模式新规划的分镜**：`videoPrompt` 是**重算**出来的（显著短于 `imagePrompt`），这才是本字段的主战场。
> - **存量 153 条分镜**：`prompt` 是**无块标记的自由文本**（实测 `shot[0].prompt` 13,922 字符，没有可机械切分的块标记），**无法机械重算**；`videoPrompt` 归一化为空串，视频请求回落到 `imagePrompt`，**行为与本次变更前逐字一致**。存量长 prompt 的治理（一次性 LLM 重算 + 人工审核）列为后续项，**不阻塞本批次**。

### 3.2 Project 修订号

| 字段 | 类型 | 语义 |
|------|------|------|
| `revision` | integer ≥ 0 | 项目文件每次写入 +1 |
| （入参）`expectedRevision` | integer，可选 | 调用方读到的修订号；缺省 ⇒ **不比对**（向后兼容） |

### 3.3 就绪度（内联在既有 `costCheck`）

```jsonc
costCheck: {
  totalShots, maxBatch, aspect, seconds, providerId, model,
  references: { /* 既有，不动 */ },
  readiness: {
    readyCount: 7,
    notReadyCount: 1,
    shots: [
      { "index": 0, "shotId": "S001", "ready": true,  "reason": null, "reasonCode": null },
      { "index": 1, "shotId": "S002", "ready": false,
        "reason": "本镜提示词为空，请补写或删除该镜",
        "reasonCode": "SHOT_PROMPT_EMPTY" }
    ]
  }
}
```

### 3.4 角色身份锚点

```jsonc
{
  "characterAnchors": [
    { "name": "老张", "bone": "方脸 · 下颌宽", "features": "单眼皮 · 鹰钩鼻 · 厚唇",
      "hair": "花白短发 · 深褐瞳", "lip": "暗红唇" }
  ],
  "anchorTruncated": false,          // 被截断时为 true
  "anchorTruncatedNames": ["王五"],   // 被截断的角色名
  "referencePriority": [
    { "index": 0, "role": "identity", "note": "身份锚" },
    { "index": 1, "role": "environment", "note": "仅场景/光线/构图/情绪" }
  ]
}
```

**硬上限 4 条**（提示词越长模型越容易丢约束）。超限时取前 4 条并显式回传 `anchorTruncated` + 被截角色名。

---

## 四、数据校验（逐条）

### 4.1 规划期（`auto-plan`）

| 校验项 | 判据 | 失败形态 |
|--------|------|---------|
| 剧本非空 | `trim()` 后长度 ≥ 1 | `AUTO_SCRIPT_EMPTY` |
| 剧本长度 | ≤ 10000 字 | `AUTO_SCRIPT_TOO_LONG` |
| 参考图数量 | 人物 ≤ 8、场景 ≤ 8 | `AUTO_REFS_TOO_MANY` |
| 参考图单张 | ≤ 10MB | `AUTO_REF_TOO_LARGE` |
| 参考图格式 | PNG/JPEG/WEBP（**主进程以魔数嗅探为准**） | `AUTO_REF_BAD_TYPE` |
| 画面方向 | `16x9` \| `9x16` | `AUTO_BAD_PARAM` |
| 目标时长 | 10–600 整数秒 | `AUTO_BAD_PARAM` |
| 单镜秒数 | `5` \| `8` \| `10`（默认 5） | `AUTO_BAD_PARAM` |

> **本次新增**：派生三分后，若 `imagePrompt` 为空 ⇒ 该镜 `ready=false`（不阻断规划，规划本身仍出预览）。

### 4.2 Kit 加载期（`kit-loader`）

| 校验项 | 判据 | 失败形态 |
|--------|------|---------|
| 三分归一化 | `imagePrompt ??= prompt`；`videoPrompt ??= prompt`；`endFramePrompt ??= ''` | — |
| 单字段长度 | ≤ 50000 | `FILM_KIT_UNAVAILABLE` |
| **三分合计长度** | ≤ 50000 | `FILM_KIT_UNAVAILABLE`（**不截断**） |
| 尾帧格式 | 空串或非空字符串 | `FILM_KIT_UNAVAILABLE` |

### 4.3 生成前

就绪度为**三态**：`ready`（可生成）/ `notReady`（必然失败，**阻止**）/ `skipped`（本次不参与、**不阻止**）。

| 校验项 | 判据 | 就绪度 reasonCode | 状态 |
|--------|------|------------------|------|
| 提示词非空 | `imagePrompt.trim()` 非空 | `SHOT_PROMPT_EMPTY` | `notReady` |
| 参考图可解析 | 声明了参考图的镜能解析出 provider 参数 | `SHOT_REFERENCE_UNRESOLVED` | `notReady` |
| 时长合法 | `0 < durationMs ≤ 单镜上限` | `SHOT_DURATION_OUT_OF_RANGE` | `notReady` |
| 画幅支持 | provider 支持该 aspect | `SHOT_ASPECT_UNSUPPORTED` | `notReady` |
| 秒数支持 | provider 支持该秒数档位 | `SHOT_SECONDS_UNSUPPORTED` | `notReady` |
| 锁镜 | 该镜 `locked` ⇒ 本次批量不参与、**沿用已有产物** | `SHOT_LOCKED` | `skipped`（**不阻止**，且**不计入成本汇总**——预计调用次数与费用只统计 `ready` 的镜） |

### 4.4 出站下载（`egress-guard`）

| 校验项 | 判据 | 失败文案要点 |
|--------|------|------------|
| 协议 | 仅 `https` | 「下载通道仅允许 https 协议」 |
| 端口 | 仅**可信清单声明的端口**（`assetDownloadPorts`，缺省 `{443}`；省略端口按 443） | 「下载通道仅允许 {ports} 端口」 |
| 主机名 | 非空 | 「URL 缺少主机名」 |
| **可信主机**（缺省 fail-closed） | 可信集合 = { provider **API base URL 主机（自动派生）** } ∪ { `assetDownloadHosts`（运营可配） }；不在集合内且**未显式授权** ⇒ 拒绝 | 「素材域名 {host} 不在可信清单内。请在『模型提供商 → {provider}』中配置『素材下载可信域』，或本次显式允许外部素材域名。」 |
| 显式授权 | 只能来自用户在成本确认卡勾选「本次允许从外部素材域名下载」；留痕 `project.json` 的 `egressAllowAnyHost` | 未勾选 ⇒ 拒绝（不弹权限框） |
| 内网段 | `isPrivateAddress` 覆盖面：IPv4 私网段（`10./8`、`172.16/12`、`192.168/16`）、`127/8`、`0.0.0.0/8`、`100.64/10`（CGNAT）、链路本地 `169.254/16`；IPv6 `::1`、`fc00::/7`、`fe80::/10`；**IPv4-mapped IPv6**（`::ffff:10.x` 先还原再判）；**纯十进制/八进制 IP 字面量**（`http://2130706433/`）先**规范化**再判 | 「不允许访问内网地址（SSRF 防护）」——**即使已显式授权也拒绝** |
| DNS 解析结果 | **全部**解析结果均非内网 | 「主机解析到内网地址，拒绝下载（SSRF/DNS 重绑定防护）」 |
| IP pinning | socket 的 `lookup` 被覆写为**已校验的解析结果**（消除「校验用 A 解析、连接用 B 解析」的 TOCTOU 窗口） | （失败时表现为连接错误） |
| 重定向跳数 | ≤ `MAX_REDIRECTS` | 「跳转次数超过上限」 |
| 每跳重校验 | 每一跳重过协议/端口/主机/内网/DNS 五项 | 「跳转目标未通过下载合同校验」 |
| 文件体积 | ≤ `MAX_DOWNLOAD_BYTES`（500MB） | 「下载超过体积上限」 |
| 落盘目录 | 位于受控媒体根内 | 「落盘目录不在受控媒体根内」 |
| 临时文件 | 先写 `.part`，ffprobe 通过才 `rename`；失败清理 `.part` | 「视频下载失败，探测未通过」 |

> **为什么缺省 fail-closed 而不是"任意公网主机"**：成片 URL 来自 provider 响应，域名会漂移；但"仅在文案上提示"挡不住一次真实的越权下载。同源 provider **零配置可用**（API 主机自动进可信集合），非同源 provider 运营配一次 `assetDownloadHosts` 即可——宁可首次失败并给可操作指引，也不默认放开出站面。

### 4.5 外部工具

| 校验项 | 判据 | 是否阻断 |
|--------|------|---------|
| ffmpeg 存在 | `findFfmpeg()` 非空 | ✅ **阻断**（出片前） |
| ffprobe 存在 | 同上 | ✅ **阻断**（出片前） |
| 版本号 | 解析 `ffmpeg -version` 首行 | ❌ **不阻断**，仅提示 |

### 4.6 项目文件写入

| 校验项 | 判据 | 失败形态 |
|--------|------|---------|
| `expectedRevision` 比对 | 与当前 `revision` 相等 | 冲突错误，**原文件逐字不变** |
| `revision` 递增 | 每次写入 +1 | — |

---

## 五、功能逻辑

### 5.1 三分派生（规划期）

```
输入：kit 模板分镜（shot-library）+ 本镜 beat 文本 + 角色映射 + 角色/场景参考图
  │
  ├─ imagePrompt  = 模板「首帧块」+ 本镜静态画面描述 + 角色名 + 场景 + 风格行（色盘）
  ├─ videoPrompt  = 模板「动作/运镜块」+ 本镜动作描述
  │                 **只保留运镜 + 主体 + 时长内的变化，不复制 imagePrompt 的静态画面全量**
  │                 ⇒ 长度显著小于 imagePrompt（验收逐镜断言）
  └─ endFramePrompt = 模板「尾帧约束块」(frame_constraint 21 条) + 本镜末帧衔接描述
  │
  └─ 三者合计 ≤ 50000，否则本镜标记 SHOT_PROMPT_BUNDLE_TOO_LARGE（不进 kit，视为资产损坏）
```

**参考图优先级声明**（自动模式侧）：同一镜绑定多张参考图时，**最早的一张 = 身份锚**，其余仅用于场景/光线/构图/情绪。该声明随 `imagePrompt` 一同派生。

### 5.2 成本闸 + 就绪度

```
用户点「生成」
  │
  ├─ 未勾选确认
  │    └─ 零 provider 调用 → 返回 { awaitingConfirmation: true, costCheck: { ..., readiness } }
  │       前端渲染「就绪度」分区：7 镜可生成 / 1 镜暂不可生成（附可操作文案）
  │       → 用户可选择「只生成就绪的 7 镜」或「补写后重试」
  │
  └─ 已勾选确认
       └─ 仍按既有闸执行（**不新增第二道闸**），就绪度只影响"哪些镜实际提交"
```

**关键口径**：就绪度**不是新闸门**——它不产生 checkpoint、不改变"未确认即零调用"的既有契约（`film-video-checkpoint-integration.test.js:140-172` 锁死）。它只是**让用户在确认之前就看到问题**。

### 5.3 锁镜（`locked`）

| 场景 | `locked` 镜的行为 |
|------|------------------|
| 批量重跑 | **跳过**（不重生成、不覆盖 `outputPath`、不改提示词） |
| 单镜重生成（用户显式点击） | **照常执行**（保留逃生口） |
| 成本闸就绪度 | 标 `ready=false` + `reasonCode=SHOT_LOCKED`，文案「该镜已锁定，本次批量不参与」 |
| 续跑 | 已产出成品的锁镜视为 `done`（磁盘为真优先） |

> **口径澄清（回应评审）**：`SHOT_LOCKED` 放进就绪度**不与"锁镜只挡批量重跑"冲突**——就绪度里的 `ready` 语义是「**本批次能否被提交**」，锁镜的语义是「**不被批量重跑覆盖**」。两者层次不同。锁镜**仍可被单镜重生成**这一条独立于就绪度。

### 5.4 乐观锁

```
auto-start / auto-regenerate-shot
  │
  ├─ 读当前 project.json → revision = R
  ├─ 入参带 expectedRevision = E
  │    ├─ E 缺省 → 直接写（向后兼容，单会话串行路径不受影响）
  │    └─ E ≠ R → 冲突，**不写**，返回可操作错误：
  │          「项目文件已被其他会话修改（修订号 E ≠ R），本次操作未写入。请刷新后重试。」
  └─ 取**独占锁**（`fs.open(lock, 'wx')`，项目目录下的锁文件）
  └─ 持锁期间：把「revision = R + 1」与新内容写进**同一份临时文件** → fsync → **一次 rename 覆盖**
  └─ 释放锁（正常与异常路径都释放）

> **为什么必须有锁**：rename 只保证**单次写**的原子性，**不提供 compare-and-swap 语义**——两个进程可各自读到 `revision=5`、都通过比对、再先后 rename，后写仍覆盖先写。**互斥靠锁，原子靠 rename，两者不可互换。**
> **陈旧锁**：锁文件带进程 PID；进程崩溃后残留的锁（PID 不存在）可被清理。锁只在单次写入事务内持有，不跨事务。
```

**与 `needsReconfirm` 并存不合并**：`needsReconfirm` 答「用户确认是否仍作数」（计划/内容改过），乐观锁答「有没有并发写覆盖」。合并会稀释任一语义。

### 5.5 出站下载

```
provider 轮询 → videoUrl
  │
  ├─ 合同校验：https / 端口（可信清单声明集，缺省 443）/ 主机名 / 可信主机（缺省 fail-closed）/ 私网段 / 体积 / 目录
  ├─ DNS 解析一次 → 全部结果非内网 → **pin 进 socket lookup**
  ├─ 请求（redirect: 'manual'）
  │    └─ 3xx → 每跳重过全部校验（含重新 DNS + pin）
  ├─ 流式写 shot_NNN.mp4.part，体积超限即中止
  ├─ ffprobe 探测通过 → rename 为 shot_NNN.mp4
  └─ 任一失败 → 清理 .part，**不留半成品**
```

**与原片下载的差异（显式取舍）**：原片下载 URL 来自 kit 元数据，域名有限 ⇒ 施加 `allowedHosts` 精确白名单。成片下载 URL 来自 provider 响应，域名不固定 ⇒ **可信主机集合 = provider API 主机（自动派生）∪ `assetDownloadHosts`（可配）**，缺省 fail-closed；用户可在确认卡**显式勾选**「本次允许从外部素材域名下载」放宽一次（留痕 `project.json`），**其余合同项（https / 端口 / 私网段 / DNS 校验 / pinning / 逐跳重校验 / 体积 / 落盘目录）全部无条件生效**。

**落地形态**：先由 PR-5 把 `downloadToFile` 原样抽成独立模块 `film-video-downloader.js`（**行为零变化**），PR-6a 再零行为抽出 `egress-guard` 并让 `shot-downloader` 改调它，PR-6b 才在 `egress-guard` 上加 pinning / 端口 / 主机策略并让 `film-video-downloader` 改走——避免「换实现」与「改成本闸」落在同一文件相邻位置、回归面重叠，也避免抽取方向变成循环依赖。

### 5.6 工具体检

```
视频生成阶段入口
  │
  ├─ 体检 ffmpeg / ffprobe 存在性
  │    ├─ 缺失 → 返回可操作错误（指明缺哪个、去哪装），**零 provider 调用**
  │    └─ 存在 → 解析版本号（仅提示），继续
  └─ 进入既有成本闸流程
```

**时机前移**：原为合成期（`film-render.js:278-279`）才暴露，现在出片前暴露。

### 5.7 身份锚点注入（提示词优化阶段）

```
split → scene_context（已有）
  │
  └─ optimize 阶段
       ├─ 从 scene_context 的角色识别结果 + 参考图元数据，提取角色身份锚点
       │    （骨相 / 五官 / 发色瞳色 / 唇色；硬上限 4 条；截断显式标记）
       ├─ 构造参考图优先级声明（最早=身份锚，其余=环境）
       └─ 注入 prompt-engine context
            + 多人同框防串脸约束（禁止交换身份/肢体/说话归属/动作归属）
```

**验证闭环（不依赖视觉模型）**：① 断言 context 含锚点与优先级声明；② 对参考图**内容哈希**排序，"最早参考图"判定与实际注入序号一致，不一致时**报错而非静默**。

---

## 六、交互逻辑

### 6.1 自动标签 · 规划确认卡

```
① 剧本输入区（既有）
② 人物参考图 / 场景参考图（既有）
③ 横竖屏 / 目标时长 / 单镜秒数（既有，高级折叠）
④ 【规划】按钮 → 预览卡（既有）
⑤ 预览卡新增：
   ├─ 「就绪度」行：✅ 7 镜可生成 · ⚠️ 1 镜暂不可生成
   ├─ 逐镜清单新增一列：状态（可生成 / 暂不可生成 / 已锁定）
   └─ 未就绪镜下方展开可操作提示（不弹窗打断）
⑥ 【生成】按钮（既有，勾选确认）
```

**交互约束**：
- 未就绪镜**不阻止**用户确认（用户可能就是要跑能跑的）；但确认卡上必须**可见**。
- 提供「只生成可生成的 N 镜」次级操作（默认**关闭**，避免用户误以为全部生成）。
- 就绪度为**只读**展示，不提供就地编辑。

### 6.2 自动标签 · 运行中逐镜表

| 状态 | 显示 | 可用操作 |
|------|------|---------|
| 就绪待跑 | 「待生成」 | — |
| 不就绪 | 「暂不可生成」+ 原因 | 「查看原因」（展开行内文案） |
| 已锁定 | 锁图标 + 「已锁定」 | 「解锁」（二次确认后） |
| 生成中 / 失败 / 完成 | 既有 | 既有 |

### 6.2b 成本确认卡 · 素材域名显式授权

当成片下载的域名**不在可信集合**（provider API 主机 ∪ `assetDownloadHosts`）时，成本确认卡出现一个**默认不勾选**的勾选项：

| 项 | 文案 | 行为 |
|----|------|------|
| 勾选项 | 「本次允许从外部素材域名下载（{host}）」 | 勾选 ⇒ 写 `project.json` 的 `egressAllowAnyHost: true`（**仅本次任务**），该域名的下载放行到私网段检查；**私网地址即使勾选也拒绝** |
| 辅助链接 | 「在模型设置中配置素材下载可信域」 | 跳转到「模型提供商 → {provider}」的配置项 |
| 不勾选 | — | 出片时该域名**被拒绝**，错误文案指明去哪儿配置 |

> 勾选是**逐次授权**、**留痕**、**默认拒绝**三件事的组合：既不打死正常出片（同源 provider 根本不需要它），也不默认放开出站面。

### 6.3 视频创作 · 提示词优化阶段

- 阶段进度条与既有 `optimize_progress` **一致**，不新增用户可见阶段。
- 锚点与优先级声明**不单独展示**（对用户是内部机制），仅在"优化词"详情里提供**只读**的「角色锚点」折叠区，便于用户核对。
- 锚点被截断时，该折叠区显示「另有 N 个角色未纳入锚点（上限 4）」，**不静默**。

---

## 七、显示项

| 位置 | 新增/变更项 | 数据来源 |
|------|------------|---------|
| 自动标签 · 规划确认卡 | 「就绪度」汇总行 | `plan.readiness`（规划期即可给出） |
| 自动标签 · 规划确认卡 | 逐镜清单「状态」列 | `plan.shots[].readiness` |
| 自动标签 · 逐镜行 | 状态徽标（可生成/暂不可生成/已锁定） | `project.shots[].status` + `locked` |
| 自动标签 · 逐镜行 | 锁图标（可点，解锁需二次确认） | `project.shots[].locked` |
| 自动标签 · 逐镜行 | 未就绪原因（行内展开，非弹窗） | `readiness.reason` |
| 自动标签 · 确认卡 | 「只生成可生成的 N 镜」次级按钮 | `readiness.readyCount` |
| 视频创作 · 优化词详情 | 「角色锚点」只读折叠区 | `characterAnchors` + `anchorTruncated` |
| 出片前（错误态） | 缺工具提示（含工具名与安装指引） | `tool-doctor` 错误码 |

**不新增的显示项**：不新增顶部导航项、不新增标签页、不改既有「自动/画布/项目案例」三标签结构。

---

## 八、提示文字（可直接使用的文案表）

> i18n 键一律成对提交（`apps/desktop/src/locales/film-engineering/{zh,en}.js`）。

### 8.1 就绪度

| 键 | 中文 | English |
|----|------|---------|
| `auto.readiness.title` | 生成就绪度 | Generation readiness |
| `auto.readiness.summary` | {ready} 镜可生成，{notReady} 镜暂不可生成 | {ready} shots ready, {notReady} not ready |
| `auto.readiness.ready` | 可生成 | Ready |
| `auto.readiness.notReady` | 暂不可生成 | Not ready |
| `auto.readiness.locked` | 已锁定 | Locked |
| `auto.readiness.onlyReady` | 只生成可生成的 {n} 镜 | Generate only the {n} ready shots |

### 8.2 未就绪原因（`reason` 文案）

| reasonCode | 中文 | English |
|-----------|------|---------|
| `SHOT_PROMPT_EMPTY` | 本镜提示词为空，请补写或删除该镜 | This shot has no prompt; fill it in or remove the shot |
| `SHOT_REFERENCE_UNRESOLVED` | 本镜的参考图无法读取，将以纯文本生成 | A reference image for this shot could not be read; it will be generated from text only |
| `SHOT_DURATION_OUT_OF_RANGE` | 本镜时长 {value} 秒超出可用范围（{min}–{max} 秒） | Shot duration {value}s is out of range ({min}–{max}s) |
| `SHOT_ASPECT_UNSUPPORTED` | 当前模型不支持 {aspect} 画幅 | The selected model does not support {aspect} |
| `SHOT_SECONDS_UNSUPPORTED` | 当前模型不支持 {seconds} 秒时长 | The selected model does not support {seconds}s |
| `SHOT_LOCKED` | 该镜已锁定，本次批量不参与 | This shot is locked and will be skipped in this batch |

### 8.3 锁镜

| 键 | 中文 | English |
|----|------|---------|
| `auto.lock.lock` | 锁定该镜 | Lock this shot |
| `auto.lock.unlock` | 解锁该镜 | Unlock this shot |
| `auto.lock.confirmUnlock` | 解锁后，批量重跑会覆盖该镜的当前结果。确定解锁？ | Unlocking means a batch rerun will overwrite this shot. Unlock anyway? |
| `auto.lock.lockedBadge` | 已锁定 | Locked |

### 8.4 并发冲突

| 键 | 中文 | English |
|----|------|---------|
| `auto.conflict.title` | 项目文件已被其他会话修改 | The project file was changed in another session |
| `auto.conflict.detail` | 期望修订号 {expected}，实际 {actual}。本次操作未写入，请刷新后重试。 | Expected revision {expected}, found {actual}. Nothing was written; refresh and try again. |

### 8.5 环境缺件

| 键 | 中文 | English |
|----|------|---------|
| `auto.tools.missing` | 缺少 {tool}，无法出片。请先安装 {tool} 后重试（提示词与参数已保留）。 | {tool} is missing, so the video cannot be rendered. Install {tool} and retry; your script and settings are preserved. |
| `auto.tools.oldVersion` | {tool} 版本 {version} 较旧，可能影响合成质量 | {tool} {version} is old and may affect output quality |

### 8.6 素材域名与授权

| 键 | 中文 | English |
|----|------|---------|
| `auto.egress.allowExternal` | 本次允许从外部素材域名下载（{host}） | Allow downloads from an external media host this time ({host}) |
| `auto.egress.allowExternalHint` | 勾选后本次任务可从该域名下载素材，并会在项目文件中留痕。私网地址始终拒绝。 | When checked, this task may download media from that host and the choice is recorded in the project file. Private addresses are always rejected. |
| `auto.egress.untrustedHost` | 素材域名 {host} 不在可信清单内。请在「模型提供商 → {provider}」中配置「素材下载可信域」，或在上方显式允许。 | Media host {host} is not in the trusted list. Add it under Model Providers → {provider}, or allow it explicitly above. |
| `auto.egress.portNotAllowed` | 下载通道仅允许 {ports} 端口 | The download channel only allows port {ports} |
| `auto.egress.trustedHosts` | 素材下载可信域 | Trusted media hosts |

### 8.7 锚点（只读折叠区）

| 键 | 中文 | English |
|----|------|---------|
| `auto.anchor.title` | 角色锚点 | Character anchors |
| `auto.anchor.truncated` | 另有 {n} 个角色未纳入锚点（上限 {max}） | {n} more characters were left out (limit {max}) |
| `auto.anchor.empty` | 本场景未识别到角色锚点 | No character anchors were detected for this scene |

---

## 九、验收标准

| # | 标准 | 命令 / 判据 |
|---|------|------------|
| V-1 | 存量 153 条加载后三分齐备、`prompt` 原值不变 | `kit-loader.test.js` 新增用例；`git diff --stat apps/desktop/electron/film-kit/shot-library.json` 为空 |
| V-2 | 三分合计超限 → fail-closed，不截断 | `kit-loader.test.js` |
| V-3 | 图片用 `imagePrompt`、视频用 `videoPrompt`、缺则回落 | `video-gen.test.js` |
| V-4 | 未确认时仍零 provider 调用，`costCheck` 带 `readiness` | `video-gen.test.js`；`film-video-checkpoint-integration.test.js` **不改且仍绿** |
| V-5 | 空提示词镜在确认前被标出 | `video-gen.test.js` |
| V-6 | 成片下载拒绝 `169.254.169.254` / `10.x` / `172.16-31.x` / `192.168.x` | `egress-guard.test.js` |
| V-7 | 成片下载拒绝明文 `http://` | `egress-guard.test.js` |
| V-8 | 跳转目标为内网时**在第二跳发起前**被拒 | `egress-guard.test.js` |
| V-9 | 下载中断不留半成品 | `egress-guard.test.js` |
| V-10 | 下载体积超限中止并清理 | `egress-guard.test.js` |
| V-11 | socket 连接到**已校验的 IP**（pinning 生效） | `egress-guard.test.js`：注入两组不同 IP，断言连接用第一组 |
| V-12 | 原片下载行为逐字不变 | `shot-downloader.test.js` 既有 23 例全绿 |
| V-13 | 缺 ffmpeg 在出片前给可操作提示 | `tool-doctor.test.js` + `video-gen.test.js` |
| V-14 | 锁镜不被批量重跑覆盖 | `auto-runner.test.js` |
| V-15 | 锁镜仍可单镜重生成 | `auto-runner.test.js` |
| V-16 | 陈旧 `expectedRevision` 写入被拒且原文件不变 | `auto-project.test.js` |
| V-17 | 缺省 `expectedRevision` 不阻断 | `auto-project.test.js` |
| V-18 | 逐镜时长落进项目文件 | `auto-project.test.js` |
| V-19 | 锚点硬上限 4 条 + 截断显式标记 | `story-context-engine` 相关测试 |
| V-20 | 参考图优先级声明进入优化上下文且序号一致 | `story2video-stages` 相关测试 |
| V-21 | 三类提示词未内联进 `.js` | 机械核对（`.js` 内零命中） |
| V-22 | i18n zh/en 成对 | `node scripts/check-locale-sync.js --keys` / `--cjk` |
| V-23 | 品牌残留 | `node scripts/check-no-brand-residue.js` rc=0 |
| V-24 | 门禁记录完整（两形态） | `node scripts/check-gate-record-debt.js` rc=0 |
| V-25 | 打包可用 | QM-1：`electron-builder --win --x64` exit 0 + asar 清单核对 |
| V-27 | 素材域名缺省拒绝 | `egress-guard.test.js`：① 主机 = provider API 主机 ⇒ 放行（零配置）；② 不在可信集合且未显式授权 ⇒ **拒绝**；③ 已显式授权 ⇒ 放行到私网段检查；④ 私网地址**即使显式授权也拒绝** |
| V-28 | 放宽授权留痕 | `auto-project.test.js`：勾选后 `project.json` 落 `egressAllowAnyHost: true`；未勾选 ⇒ 该字段不存在 |
| V-29 | 新分镜视频提示词显著更短 | `auto-plan.test.js`：逐镜断言 `videoPrompt.length < imagePrompt.length` 且 `videoPrompt` 非空 |
| V-30 | 存量 videoPrompt 为空（不假装已解决） | `kit-loader.test.js`：存量 153 条 `videoPrompt === ''`、`imagePrompt === prompt`；视频请求回落 `imagePrompt`，行为与变更前一致 |
| V-31 | 乐观锁写入原子 | `auto-project.test.js`：并发写用例断言无半写文件；`revision` 自增与内容替换在同一次 rename 内 |
| V-32 | 就绪度三态 | `shot-readiness.test.js`：锁镜 `skipped`（不阻断）；空提示词等 `notReady`（阻断） |
| V-33 | 端口随可信域声明 | `egress-guard.test.js`：声明含 8443 ⇒ `:8443` 放行；未声明 ⇒ 拒绝；`:443`/省略 ⇒ 放行 |
| V-34 | 尾帧只读行有真实承载 | `apps/desktop/src/views/film-auto/ShotTailFrameRow.vue` 存在且被规划确认卡渲染；**并断言 `.js` 中不存在把 `endFramePrompt` 送入 provider 的读取点** |
| V-26 | 文档与实现同源 | `SCHEMA.md` ↔ `kit-loader` 校验器；本 PRD 字段表 ↔ 代码字段 |

---

## 十、明确不做

见 OpenSpec `proposal.md` §六（D-1 ~ D-13）。本 PRD 不重复列举，只强调三条最容易被误认为"漏做"的：

1. **不做 VLM 质检**：本仓 `adapters/_base/base.js` 无任何视觉方法，且自动重试会绕过被测试锁死的成本闸。
2. **不做 Scene 视角变体**：`viewpointId` 无消费方 ⇒ 死代码。
3. **不做音频三件套**：打包 ffmpeg 滤镜白名单仅 11 个（`apps/desktop/scripts/stage-media-tools.js:10-22`），引入 `tpad`/`loudnorm` 须改 `media-tools-lock.json` + 重打包实测 ⇒ 混合 PR。

---

## 十一、风险与已知限制

| 风险 | 影响 | 缓解 |
|------|------|------|
| 三分后 `prompt` 与 `imagePrompt` 在存量数据上同值 | 冗余 | 靠归一化消除分支而非消除字段；`prompt` 保留不删 |
| 合计上限 50000 可能把合法资产判死 | 新 kit 导入失败 | 上限与单字段同值，最长现有单镜 13,922 字符 ⇒ 余量充足；超限报错文案直指"精简提示词" |
| 就绪度判据过严 → "永远不就绪" | 用户无法出片 | 只取"必然失败"项；每条 `reason` 给可操作文案；`SHOT_LOCKED` 不阻断单镜重生成 |
| 出站合同改造影响既有原片下载 | 回归 | `shot-downloader` 既有 23 例必须全绿；重构只改实现位置不改可观察行为 |
| IP pinning 需改 `shot-downloader` 现有解析逻辑 | 回归面扩大 | pinning 是**增强**（连接用已校验 IP），既有断言不应变化；新增 V-11 专测 |
| 乐观锁在单写路径误报冲突 | 自动模式跑不起来 | `expectedRevision` 缺省即不比对；单会话串行写不产生冲突 |
| 锚点硬上限 4 条截掉重要角色 | 多人同框仍串脸 | 截断显式标记 + 被截角色名回传，供用户知情 |
| **外置提示词的完整性** | 运行时提示词可能被篡改 | 随包 `asar` 内资产由打包链路保证；用户导入目录由用户自持；**不采用"应用内哈希清单"**（与提示词同仓同包，能改其一就能改其二，不构成安全措施） |
| 尾帧提示词短期无消费 | 字段只写不读 | 消费路径与三项前置已写明并排期（provider 参考图支持 / 该镜已绑参考图 / 公网图床 F28） |
