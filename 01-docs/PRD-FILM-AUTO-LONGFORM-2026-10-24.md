# 影视工程「自动」模式长篇化改造 · 实施落地方案

> **文档类型**：PRD + 实施落地方案（先文档后代码的输入件）
> **版本**：v1.0
> **日期**：2026-10-24
> **代码基线**：`Colinchiu007/mulpub` @ `ceef6e74e`（2026-10-24 拉取，已 `--unshallow` 补全 5626 提交历史）
> **上游文档**：`01-docs/PRD-FILM-AUTO-MODE-2026-10-09.md`（自动模式 v3 定稿）、`01-docs/PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md`（全量出片）
> **状态**：待评审。评审通过后方可进入 M1 编码。

---

## 〇、一页纸

### 0.1 结论

**「视频创作 → 影视工程 → 自动」这条链路，目前不具备「输入剧本文案 → 自动产出 30 分钟以上短剧成片」的能力。**

不是「差一个时长开关」，而是**七层能力里有五层缺位或只到一半**。把时长常量从 600 改成 1800 只能得到「一条更长的、缺内容骨架的、花几倍 API 费且容易被限流打断的镜片段合集」。

### 0.2 必须先做的三个前置取证（M0 门，未过不得进入 M1）

| # | 前置事实 | 为什么它是「门」 | 判据 |
|---|---|---|---|
| **F-1** | **目标视频 Provider 是否真的产出对白音轨？** | 9 个视频适配器（`agnes-video / cogvideo / ltx / seedance / veo / kling / grok-video / wan / runway`）**全部没有任何 audio / dialogue / speech / voice 参数**（实测 grep 命中 0）。若 provider 需显式开关才出音轨，则**当前链路是哑的**，整个「对白交给视频模型」的前提不成立 | 用目标 provider 跑一镜带对白提示词，`ffprobe -show_streams` 看 `codec_type=audio` 流是否存在 |
| **F-2** | **目标视频 Provider 是否接受应用下发的镜长？** | `buildShotSubmitPayload` 下发 `numFrames/width/height/frameRate`，但**只有 `agnes-video` 与 `ltx` 消费**（frames 命中 4/3，其余 7 个为 0）。`seedance.js:113-116` 的 body 只有 `{model, prompt}`，`veo.js:117-122` 只有 `{instances, parameters.sampleCount}` ⇒ **镜长由 provider 默认决定，应用管不了** | 提交后比对 provider 返回的成片实际时长 vs 下发档位 |
| **F-3** | **出片成功路径从未在真机跑通** | 上游 PRD 自列 G8：「出片成功路径未验证（环境）」——开发机默认视频模型无可用通道，`plan → start → ledger → manifest → final.mp4` 这一段**从未成功产出过** | 真机跑通一次 12 镜出片 + 合成 `final.mp4`，并断言成片有音轨、时长符合预期 |

> **F-1 / F-2 的结论直接改写方案形态**，不是走过场。详见 §三。
> 特别提示：**F-1 若为「否」，本方案中 R3/R4/R5 全部作废**，须改为「先补适配器的音轨开关能力，再谈长篇化」。

### 0.3 五层地基（缺一不可）

| 层 | 现状 | 目标 |
|---|---|---|
| **① 规模域** | 时长 10–600s / 镜数 ≤120 / 剧本 ≤10000 字 | 1800s / ≤360 镜 / ≤30000 字 |
| **② 内容密度** | 台词与镜长无契约（逐镜时长算了但没接到出片） | 台词-镜长强契约 + 溢出即拆镜 |
| **③ 叙事结构** | 无分集/无集钩子/无全剧终，扁平镜列表 | 分集大纲 + 每集结构 + 全剧终 |
| **④ 角色与声画** | 4 个固定槽位（且是参考片的角色）；提示词无结构化台词 | N 个用户角色 + 角色-声音锚 + 结构化台词块 |
| **⑤ 经济性与治理** | 无金额/无限流/无熔断/无重试；绕开引擎连带绕开 governor | 成本闸 + 限流 + 熔断 + 有界重试 |

### 0.4 里程碑总览

```
M0 取证与打通  ──► M1 规模域与护栏 ──► M2 台词-镜长契约
                                              │
        M6 可观测与端到端 ◄── M5 模板中立化 ◄── M4 分集结构 ◄── M3 角色与声画锚
```

**M0 不过 ⇒ 全案不动。** 这是本方案最重要的一条。

---

## 一、目标与边界

### 1.1 目标

把「自动」模式从「一段文案 → 一条 10 分钟以内的无声镜片段合集」升级为
「一部剧本文案 → 一部 30 分钟以上、有对白、有分集结构的短剧成片」，
且该过程**在用户侧是一次确认 + 一次点「开始」**，全程可停可续、失败可见、成本可预估。

### 1.2 硬约束

| # | 约束 | 落实方式 | 对应需求 |
|---|---|---|---|
| C1 | **越简单越好**：用户只给「剧本文案 + 可选人物/场景参考图 + 横竖屏 + 大概时长」 | 5 项输入不变；分集数、镜数、角色数全部由程序推导 | R1 / R6 / R12 |
| C2 | **全部复用影视工程既有底层资产** | kit 模板块结构、剧本套用引擎、角色槽位机制、参考令牌、参考图注入、分批驱动 + 台账 + 磁盘双核续跑、film_render 合成、原文直送合同 | 全部 |
| C3 | **对白与声音由视频生成模型统一完成**（不再单独做 TTS/旁白/BGM 音轨层） | 应用侧不产出音频流；**改为确保「提示词里台词结构化 + 镜长装得下台词 + 角色声音锚一致」** | R3 / R4 / R5 |
| C4 | **生成后可修改调整某个片段** | 保留现有单镜编辑 + 原子覆盖重生成 | R12 |
| C5 | **成本可预估、可控** | 补单价表 → 确认卡显示金额 → 接入 governor → 任务级算力闸 | R8 |
| C6 | **产物可验证** | 端到端集成测试必须真跑出 `final.mp4` 并断言音轨/时长 | R11 |

### 1.3 非目标

- **不做 TTS / 旁白 / BGM / 音效 / 字幕层**（C3 已定：音画由视频模型统一产出）。
  - 例外：若后续要「字幕」，它属画面元素而非声音，且可复用 `story2video-compose-engine.js:589+` 的 drawtext 烧录能力，列为 P2 可选项，不进本方案主干。
- **不做视频剪辑**（时间线、多机位、关键帧编辑）：沿用上游 PRD §14.8 的既定边界，仍只做「改提示词 → 重生成单镜」。
- **不扩 provider 参考输入能力**：仍限既有能力表（`video-reference-inputs.js:30-34`）。
- **不改 kit / schema / 六阶段语义 / checkpoint 语义**。
- **不做多语言/多配音版本**。
- **不改「不经 pipeline 引擎执行出片」这条架构选择**（上游 PRD §14.8 明确列为不做）：
  改为**在自动模式自己的出片出口补上与引擎同等的治理装置**（R8），而不是把执行搬回引擎。

---

## 二、现状取证：能力分层矩阵

### 2.1 七层能力分层（逐层判有无）

| # | 能力层 | 问的问题 | 现状 | 判定 |
|---|---|---|---|---|
| L1 | **时长/规模** | 能出多长的片子？ | 时长 10–600s；镜数 ≤120；剧本 ≤10000 字 | ❌ **阻断** |
| L2 | **内容密度** | 30 分钟的台词装得下吗？ | 10,000 字 ÷ 1800s = **5.6 字/秒**，低于 `normal` 档（8 字/秒）30% | ❌ **阻断** |
| L3 | **台词-镜长契约** | 台词念得完吗？ | 逐镜 `durationSec` **算出来了但没接到出片**（`auto-runner.js:163` 用的是全局 `shot.seconds`）；W9 溢出只警告不阻断 | ❌ **缺位** |
| L4 | **叙事结构** | 有集、有钩子、有全剧终吗？ | 全目录 grep `episode\|分集\|幕\|全剧终` = **0 命中**；扁平镜列表 | ❌ **缺位** |
| L5 | **角色与声画** | 角色够多吗？声音跨镜一致吗？ | 4 个固定槽位（`ROKO/JAXX/LULU/REIN`，**是参考片的角色**）；提示词无结构化台词；无角色-声音锚 | ❌ **缺位** |
| L6 | **提示词质量** | 提示词是「你的剧本」还是「参考片模板 + 你的文案」？ | `auto-plan.js:249` `templates[i % len]` 轮转 153 个模板；模板块原样保留（含 `EXACT 2 CHARACTERS` 等原片约束）；LLM 已下线 | ❌ **半缺位** |
| L7 | **经济性与治理** | 知道要花多少钱吗？会被限流打断吗？ | 无金额（无单价表）；无限流/无熔断/无重试；绕开 governor | ❌ **缺位** |

> **判读**：L1/L2 是「规模」，L3–L6 是「内容」，L7 是「经济」。
> **只解 L1 得到的是「更长的空壳」**——内容层（L2–L6）缺位时，多出的 20 分钟是重复模板 + 无对白 + 无结构的镜头流。

### 2.2 端到端链路解剖

```
【输入】FilmAutoPanel.vue:118 runPlan()
   │  script / characterRefs / sceneRefs / aspect / seconds / targetDurationSec
   ▼
【规划】ipc-handlers/film-engineering-auto.js:162 auto-plan
   │  └→ auto-plan.js:195 planAutoShots()      ← 纯函数、零 provider 调用、零落盘
   │       ├ validateAutoInputs()  :84        ← 时长 10-600s / 镜数 ≤120 / 剧本 ≤10000 字
   │       ├ splitAutoBeats()      :118       ← 按空行分场
   │       ├ expandBeatsToCount()  :149       ← 只拆（按句末标点）★ 拆不动就静默少产出
   │       ├ mergeBeatsToCount()   :177       ← 只并（均分）
   │       ├ detectCharacters()              ← 启发式：对话动词前名词 + 频次≥2 + 停用词
   │       ├ buildCharacterMap()              ← 只填 4 个槽
   │       ├ bindReferencePaths()             ← 人物命中 + 场景轮转，单镜 ≤2 张
   │       ├ resolveShotDurationMs()          ← 逐镜 durationMs ★ 算完没人用
   │       └ buildTemplatePrompt()            ← 模板原文 + 你的文案
   ▼ 落盘 plan.json（planId ↔ taskId 绑定，服务端唯一真源）
【执行】auto-start  :266
   │  └→ void(async)  :361-404   ★ 立即返回，进度经事件 + auto-status 轮询
   │      └→ production-driver.js:212 runProduction()
   │           ├ planBatches(10) / resolveResumePlan(磁盘复核)
   │           └ 每批 → auto-runner.js:114 runAutoBatch()
   │                └ 每镜 → video-gen.js:158 generateShotVideo()
   │                     submit → poll(≤10min) → download → shot_NNN.mp4
   ▼
【收口】auto-compose → useFilmAutoRun.js:253 compose()   ★ 需用户点一次按钮
   │  └→ pipelineStartOrchestrated('film-engineering', { initialContext:{ renderManifest } })
   ▼
【合成】film-render.js:209 registerFilmRenderStage
   │  ffprobe 全片规格 → 一致则 concat -c copy；不一致则 scale+pad 归一（-c:a aac）
   ▼
   final.mp4  →  <mediaRoot>/<runId>/final.mp4
```

### 2.3 关键取证：规模域的硬算术

**语速常量**（`shot-duration.js:37`）：`ZH_CHARS_PER_SECOND = { normal: 8, argument: 10, tender: 5 }`（字/秒）

| 目标时长 | 纯对白所需字数（normal 档） | 所需镜数（5s/8s/10s/12s 档） | 撞现有上限？ |
|---|---|---|---|
| 600s（现状上限） | 4,800 字 | 120 / 75 / 60 / 50 | 镜数刚好卡 120 |
| **1800s（目标）** | **14,400 字** | 360 / 225 / 180 / 150 | **镜数与字数双双超** |

**镜数下限**（30 分钟最少需要多少镜）：
- 5s 档 → 360 镜
- 8s 档 → 225 镜
- 10s 档 → 180 镜
- 12s 档 → 150 镜
⇒ **无论选哪档，都超 `MAX_AUTO_SHOTS = 120`**。必须提到 ≥180（10s 档）才能覆盖 30 分钟。

**字数上限才是更紧的那道锁**（这是最容易漏算的一条）：
- 30 分钟纯对白 = **14,400 字**（与镜数无关，只与总时长有关）
- 短剧对白占比通常 40–60%，其余是动作/场景描述 ⇒ **剧本总量 ≈ 24,000–36,000 字**
- 现状 `MAX_AUTO_SCRIPT_LENGTH = 10000` ⇒ **差 2.4–3.6 倍**
- 反向看：10,000 字 ÷ 1800 秒 = **5.6 字/秒**，比 `normal` 档慢 30%、比 `tender` 档只快 12%
  ⇒ **若不抬字数上限，30 分钟成片的台词密度将低到近乎旁白/静场，而不是短剧**

> **结论**：R1 必须同时放开**时长、镜数、字数**三项，且**字数上限的倍数（3×）大于时长上限的倍数（3×）但绝对增量（+20,000 字）远大于时长增量（+1200 秒）**。
> 剧本输入框的交互形态（`el-input type=textarea :maxlength=10000`）也要跟着改，否则前端先卡死。

### 2.4 关键取证：模板质量现状（实测随包 kit）

`apps/desktop/electron/film-kit/shot-library.json` 实测：**153 镜**，162 场景，4 个角色（`ROKO/JAXX/LULU/REIN`），`filmMeta.durationSec = 5706`（95 分钟）。

**模板块结构分布**（153 镜中）：

| 块 | 命中数 | 占比 | 归属 | 后果 |
|---|---|---|---|---|
| `EXACT …` | 29 | 19% | 静态（不进 allParts 之外的额外约束） | 原片角色/形象硬约束被带进用户剧 |
| `AUDIO` | 24 | 16% | **静态**（`script-adapt.js:101`） | **被 `buildMotionPrompt` 剔除** |
| `POSITIVE CONSTRAINTS` | 5 | 3% | 静态 | 同上 |
| `GEO SPATIAL LAYOUT` | 1 | 0.7% | 静态 | 同上 |
| `ACTION TIMING` | 3 | 2% | 运动 | **只有 3 个模板有运动块** |
| `CHARACTER ACTING` | **0** | **0%** | 运动 | **没有模板有「表演」块** |

**两条推论**：

1. **「三分提示词」机制在随包 kit 上基本空转。** `buildMotionPrompt`（`script-adapt.js:147-150`）只保留 `head + characterLines + motionParts`，而 153 个模板里 150 个没有 `ACTION TIMING`、0 个有 `CHARACTER ACTING` ⇒ 对绝大多数镜，**videoPrompt ≈ imagePrompt**。
   ⇒ 这也意味着：**用户的中文台词在 videoPrompt 里是安全的**（`head` 含剧情行，`script-adapt.js:78-79`），不会因为静态块剔除而丢失。
2. **16% 的模板带 `AUDIO` 块，而它被归为静态类、从 videoPrompt 里剔除。** 在 C3 前提（视频模型负责对白与声音）下，**AUDIO 块恰恰是最该给视频模型的语义**，却被当成「静态空间地图」剔掉了。
   ⇒ 这是 C3 前提与既有三分规则的一处**直接冲突**，必须在 R4 处理（见 §四 R4）。

### 2.5 关键取证：适配器能力矩阵（实测 9 个视频适配器）

| 适配器 | 消费 `numFrames` | 消费 `width/height` | 有 audio/dialogue 参数 | 备注 |
|---|---|---|---|---|
| `agnes-video` | ✅ (4 处) | ✅ (4 处) | ❌ | `num_frames` 须满足 8n+1，最大 441 |
| `ltx` | ✅ (3 处) | ✅ (4 处) | ❌ | 读下划线命名 |
| `cogvideo` | ❌ | ❌ | ❌ | |
| `seedance` | ❌ | ❌ | ❌ | body 仅 `{model, prompt}`（`seedance.js:113-116`） |
| `veo` | ❌ | ❌ | ❌ | body 仅 `{instances, parameters.sampleCount}`（`veo.js:117-122`） |
| `kling` | ❌ | ❌ | ❌ | |
| `grok-video` | ❌ | ❌ | ❌ | |
| `wan` | ❌ | ❌ | ❌ | |
| `runway` | ❌ | ❌ | ❌ | |

**这决定了 R3 必须分两档实现**（详见 §四 R3）。

### 2.6 关键取证：合成层对带音轨片段的处理

好消息：**合成层已经能正确处理带音轨的片段**，不需要改。

- `film-render.js:41-62` `probeClip` 读 `codec_type=audio` 流，产出 `hasAudio / sampleRate / channels`；
- `film-render.js:74-78` `specKey` 把 `hasAudio|sampleRate|channels` 纳入一致性判据；
- ⇒ 音轨参数不一致 ⇒ 走 normalize 分支（`:285-293`，`-c:a aac` + scale/pad + `-r 24`）⇒ 音轨统一，concat 可用；
- 音轨参数一致 ⇒ `concat -c copy` 直拷（`:308`），零重编码。

**但 normalize 分支在 30 分钟规模上是重成本**：360 镜全量重编码（解码 + 缩放 + 重编码 + 音频转码），逐镜串行会非常慢。
⇒ R10 需要评估「先统一规格再合成」与「逐镜归一」两种路径的成本差。

---

## 三、必须先做的三个前置取证（M0 门）

### F-1 目标 Provider 是否真的产出对白音轨？

**问题**：C3 假设「对白和声音交给视频生成模型统一完成」。但 9 个视频适配器**无任何 audio 参数**。
两种可能：
- (a) provider **隐式**产出音轨（模型自带原生音频能力，adapter 只需传 prompt）⇒ 前提成立；
- (b) provider 需要**显式开关**（如 `generate_audio: true` / `audio: true`）⇒ 前提不成立，**当前链路出的是哑片**。

**取证方法**（M0 阶段做，不进主干）：

```bash
# 1) 造一条带对白的提示词，走 film-engineering 的实际提交路径
#    （用 apps/desktop/electron/services/film-engineering/video-gen.js:158 generateShotVideo）
# 2) 产物落盘后探测音轨
ffprobe -v error -print_format json -show_streams shot_000.mp4 | \
  python3 -c "import json,sys; s=json.load(sys.stdin)['streams']; \
  a=[x for x in s if x['codec_type']=='audio']; \
  print('音轨流数 =', len(a), a[0] if a else '（无）')"
```

**判据**：
- 有 audio 流 ⇒ 前提 (a) 成立 ⇒ 走 §四 全套需求；
- 无 audio 流 ⇒ 前提不成立 ⇒ **本方案 R3/R4/R5 全部作废**，改为「先补适配器音轨开关 + 建 provider 音轨能力表」，长篇化降级为 P1。

**附带产出**：一张 `VIDEO_AUDIO_PARAM_BY_PROVIDER` 能力表（形态照抄 `video-reference-inputs.js:30-34` 的 `VIDEO_REFERENCE_PARAM_BY_PROVIDER`），
在规划期就告诉用户「你配的 provider 不产对白」，而不是等 15 小时跑完才发现。

### F-2 目标 Provider 是否接受应用下发的镜长？

**问题**：`buildShotSubmitPayload`（`video-gen.js:73-100`）下发 `numFrames / width / height / frameRate`，
但只有 2/9 的适配器消费。若 provider 忽略帧数，**镜长由 provider 默认决定**（通常 5s 或 10s 固定）。

**取证方法**：同一提示词，分别下发 121 / 201 / 241 帧，探测三次成片的实际时长。

**判据**：
- 三次时长不同 ⇒ 镜长可控 ⇒ R3 走「档 1」（严格台词-镜长契约）；
- 三次时长相同 ⇒ 镜长不可控 ⇒ R3 走「档 2」（把「镜长不可控」转成「镜数变多 + 台词主动拆镜」）。

**两种形态的 R3 实现差异见 §四 R3。**

### F-3 出片成功路径从未在真机跑通

**问题**：上游 PRD `01-docs/PRD-FILM-AUTO-MODE-2026-10-09.md:520,523` 自列 G8：
「出片成功路径未验证（环境）」——开发机默认视频模型无可用通道，出片必失败。
G5 同样未闭合：「`plan → start → 台账 → manifest → 真实 ffmpeg 出 final.mp4` 的端到端集成测试」。

**为什么这是「门」**：在 M0 之前，**所有关于「长篇化之后会怎样」的推演都建立在一条没跑通过的链路上**。
先证明 12 镜能跑通并合成出 `final.mp4`，再谈 360 镜。

**取证方法**：按上游 PRD §14.4 的证据表要求跑真机 E2E，产出：
- `plan.json` / `project.json` / `ledger.json` 三件套；
- 12 个 `shot_NNN.mp4`；
- 1 个 `final.mp4`，且断言：**有音轨流**（若 F-1 成立）、时长 = 12 × 档位 ± 容差、可播放。

**判据**：`final.mp4` 存在 + `ffprobe` 断言通过 + 截图/日志留证。

---

## 四、需求规格

> 每条规格给出：现状 → 规格 → 代码落点 → 验收判据（可断言）。
> 判据一律写成「能红的断言」，不接受恒真断言。

---

### R1 规模域：时长 / 镜数 / 字数

**现状**：`MAX_AUTO_DURATION_SEC = 600`、`MAX_AUTO_SHOTS = 120`、`MAX_AUTO_SCRIPT_LENGTH = 10000`（`auto-plan.js:38-41`），前端 `auto-constants.js:11-13` 同源。

**规格**：

| 参数 | 现状 | 目标 | 理由 |
|---|---|---|---|
| `MAX_AUTO_DURATION_SEC` | 600 | **1800** | 30 分钟 |
| `MIN_AUTO_DURATION_SEC` | 10 | 10（不变） | |
| `MAX_AUTO_SHOTS` | 120 | **360** | 5s 档 30 分钟所需 |
| `MAX_AUTO_SCRIPT_LENGTH` | 10000 | **30000** | 30 分钟纯对白 14,400 字 + 动作描述余量 |
| `AUTO_SHOT_SECONDS` | `[5,8,10]` | `[5,8,10,12]` | 12 秒档是长台词唯一解（见 R3） |
| `MAX_AUTO_SHOT_SEC` | 12（= `max(DEFAULT_TIERS)`，但用户选不到） | 与可选档一致 | 消除 `auto-plan.js:44-52` 自述的「档位不可达」 |

**落点**：
- `apps/desktop/electron/services/film-engineering/auto-plan.js:38-43`（后端唯一真源）
- `apps/desktop/src/views/film-auto/auto-constants.js:11-14`（前端镜像，**必须同改**）
- `apps/desktop/electron/ipc-handlers/film-engineering.js`（若另有校验副本）
- `apps/desktop/src/views/film-auto/FilmAutoPanel.vue:241`（`:maxlength="MAX_AUTO_SCRIPT_LENGTH"` 自动跟随常量）
- `openspec/changes/film-auto-mode/specs/film-engineering/spec.md`（规格同步）

**验收判据**：
- `auto-plan.test.js` 新增边界矩阵：`(600, 120)` 通过；`(601, 120)` 返回 `AUTO_BAD_PARAM`；`(1800, 360)` 通过；`(1801, 360)` 拒绝；`(1800, 361)` 返回 `AUTO_TOO_MANY_SHOTS`。
- `auto-constants.js` 与 `auto-plan.js` 的同名常量**逐值相等**（加一条契约测试锁死，防「改了前端没改后端」）。

---

### R2 内容密度：字数 / 时长的换算口径显性化

**现状**：三者（字数、时长、镜数）各自独立校验，**没有任何一处告诉用户「你要的 30 分钟需要多少字」**。
用户填 600 秒 + 10000 字，规划出 120 镜；W3 警告只说「实际时长与目标有差异」，不说「你内容不够」。

**规格**：
1. 规划期新增**内容密度判据**：由 `targetDurationSec` × 语速档（normal 8 / argument 10 / tender 5）推出**所需台词字数区间**；
2. 剧本字数显著低于下限 ⇒ 规划期**明确警告**「按目标时长 X 秒估算需约 N 字台词，当前剧本 M 字，成片将以静场/动作镜填充」；
3. 剧本字数超出下限 3× ⇒ 警告「台词密度过高，镜长可能装不下，将触发拆镜」。

**落点**：`auto-plan.js`（`planAutoShots` 尾部 warnings 汇总处 `:372-404`）+ `shot-duration.js` 的 `ZH_CHARS_PER_SECOND` 导出（`:388` 已在导出列表）。

**验收判据**：
- 规划 1800 秒 + 3000 字剧本 ⇒ 产出一条明确含「所需台词字数」与「当前字数」的 warning；
- 规划 1800 秒 + 30000 字剧本 ⇒ 产出密度过高 warning；
- 两类 warning 均可在 `FilmAutoPanel.vue:340-345` 的警告区渲染出（`plan.warnings` 已有渲染位）。

---

### R3 台词-镜长契约（**核心需求，分两档**）

**现状（三重断裂）**：
1. `auto-plan.js:267-279` 逐镜算了 `resolveShotDurationMs`（formula 按引号内台词字数 / 档位兜底），
   产出 `durationMs / durationSec / durationSource`（`:309-311`）；
2. **但出片不消费它**：`auto-runner.js:163` 与 `:231` 都用 `seconds: Number(shot.seconds) || Number(project.seconds) || 5`，
   而 `shot.seconds` 是全局值（`auto-plan.js:308`）⇒ **逐镜时长是死数据**；
3. 溢出只警告不阻断：`auto-plan.js:344-365` 的 W9 汇总 overflow / truncated，**没有 fail-closed**。

**规格（档 1：provider 镜长可控 —— F-2 判定为「可控」）**：
- R3.1 出片**必须**消费逐镜 `durationSec`，不再用全局 `shot.seconds`；
- R3.2 `durationSec` 吸附到 provider 帧数档（`video-gen.js:53-60` `pickFilmFrameCount`：≤5→121 帧、≤8→201、≤10→241、else→441；`FILM_FRAME_RATE = 24`）；
- R3.3 台词溢出（`rawSec > maxSec`）⇒ **规划期 fail-closed**：该镜必须被拆解，否则拒绝出计划（把 W9 从 warning 升为 error）；
- R3.4 台词截断（`rawSec * 1000 > durationMs + 1`）⇒ 必须告警并给出「改大单镜秒数 / 拆台词」两个可操作出口。

**规格（档 2：provider 镜长不可控 —— F-2 判定为「不可控」）**：
- R3.1′ 不再尝试控制镜长；改为**按 provider 的实测固定镜长**（F-2 探测值）做内容规划；
- R3.2′ **主动拆镜**成为强制策略：一段台词若超过「实测镜长 × 语速」能装下的字数 ⇒ **在规划期就切成多个镜**（`expandBeatsToCount` 扩展为「按台词容量拆」而非「按句末标点拆」）；
- R3.3′ 提示词内显式约束「本镜台词必须完整念出，不得加快语速」；
- R3.4′ 出片后**逐镜校验音轨时长**：成片镜实际时长 < 推算台词时长 ⇒ 该镜标 `failed`（可重生成），不允许「念漏了也算成功」。

**落点**：
- `auto-runner.js:163`、`:231`（消费 `shot.durationSec`）
- `auto-plan.js:267-311`（产出侧：档 2 需要扩展 `expandBeatsToCount`）
- `auto-plan.js:344-365`（W9 → 阻断）
- `auto-plan.js:149-174` `expandBeatsToCount`（档 2 的拆镜策略）
- `shot-duration.js:129-144` `snapToTier`（档位吸附，需支持 12 秒档）

**验收判据**：
- 构造「一段 60 字台词 + 5 秒档」的剧本 ⇒ 规划**失败**并指出该镜（R3.3 档 1）/ 规划出 2 个镜（R3.2′ 档 2）；
- 出片提交的 `numFrames` 随逐镜 `durationSec` 变化（用注入的 `generateShotVideo` 桩断言 payload）；
- 档 1：断言 `generateShotVideo` 收到的 `seconds` 等于该镜 `durationSec` 而非全局值。

---

### R4 提示词契约：结构化台词块 + 冲突块处置

**现状**：
- 提示词 = 模板原文（`head` 换场景头 + 剧情行 + 角色行 + 模板块）+ 你的文案（`script-adapt.js:65-120`）；
- **没有结构化台词**：「谁说了什么」只以裸文本形式出现在 `head` 里；
- **模板原片约束会被带进来**：29/153 模板带 `EXACT 2 CHARACTERS` 之类硬约束；
- **16% 模板的 `AUDIO` 块被归为静态类、从 videoPrompt 剔除**（`script-adapt.js:101`）—— 在 C3 前提下这是**反向优化**；
- 模板是**参考片的**：153 镜全是同一部片（4 个角色、95 分钟）。

**规格**：
1. **结构化台词块**：每镜提示词追加一个显式块，把该镜台词解析成「角色 + 台词 + 情绪」结构，供视频模型识别发声者与情绪。
   ```
   [DIALOGUE]
   ROKO（小强）:「你到底要走到哪一步？」
   ```
   - 角色名取自 `characterMap`（用户标注优先）；
   - 台词来源：剧本中成对引号内文本（`shot-duration.js:98-110` `extractDialogueText` 已实现该抽取）；
   - 无引号 ⇒ 块内写明「本镜无台词」并触发 R2 的密度警告。
2. **`AUDIO` 块在自动模式下不再剔除**：C3 前提下音频语义是视频模型需要的输入。
   ⇒ 调整 `buildMotionPrompt` 的分类，或在自动模式专用的派生函数里把 `AUDIO` 块并入 motion 集。
   ⚠️ **注意**：这是对既有「三分提示词」契约的**局部例外**，必须只作用于自动模式，不改 `buildMotionPrompt` 的既有语义（画布/工程案例路径依赖它），否则会产生静默回归。
3. **原片硬约束块标记**：模板里的 `EXACT …` / 角色描述等**非用户内容**，在自动模式下应被**剥离或降级**——
   否则用户剧本会被强塞进「三米高恶魔、紫色皮肤」的世界观。

**落点**：
- 新增 `apps/desktop/electron/services/film-engineering/auto-prompt-dialogue.js`（新文件，**不要塞进 `script-adapt.js`** —— 该文件已在门禁点名清单边缘）
- `auto-plan.js:248-316`（shots 映射处派生 dialogue 块）
- `script-adapt.js:100-104`（AUDIO 块分类调整，仅限自动模式入口）

**验收判据**：
- 规划一份含两角色对话的剧本 ⇒ 每镜提示词含 `[DIALOGUE]` 块，且角色名与 `characterMap` 一致；
- 断言自动模式产出的 `videoPrompt` **包含**模板的 `AUDIO` 块文本（档 2 不再剔除）；
- 断言自动模式产出的提示词**不含**模板的 `EXACT …` 硬约束行（除非用户显式启用「沿用参考片风格」开关）；
- 回归锁：画布/工程案例路径的 `videoPrompt` **逐字不变**（既有测试已覆盖，加一条反向断言）。

---

### R5 角色与声音一致性

**现状**：
- 4 个固定槽位 `['ROKO','JAXX','LULU','REIN']`（`auto-plan-characters.js:16`），按频次填前 4 个，**超出的角色直接丢弃**（`:98-100`）；
- 槽位名是**参考片的角色名**；
- 无角色-声音锚：跨镜的音色/语速/情绪无任何约束。

**规格**：
1. **槽位可配置 + 可扩展**：角色槽位从固定 4 个改为「按需分配」，上限建议 12（与 `MAX_AUTO_REFS = 8` 的参考图数量错开，参考图仍是 8 张上限但角色数不设 4 的硬限）。
2. **槽位名来源化**：默认用**用户标注的角色名**（`characterRefs[].name`），参考片槽位名仅在用户未标注时作兜底，并明确标记为「参考片角色」。
3. **角色-声音锚（跨镜一致性）**：为每个角色生成一段**固定的「声音描述」**，在每一镜该角色发声的提示词里逐字重复。
   - 内容建议：音色、语速档（normal/argument/tender）、年龄感、情绪基调、口头禅；
   - 作用：在 provider 侧提升跨镜音色与语速的一致性（**能不能全靠 provider，应用侧只能提高提示词层面的约束强度**——这一条要在文档里写清，避免过度承诺）。
4. **超限处理**：角色数 > 上限 ⇒ 按「出场频次 + 台词字数」排序，**明确告警被丢弃的角色名**（不静默丢）。

**落点**：
- `auto-plan-characters.js:16`（`SLOT_ORDER`）、`:98-100`（填槽逻辑）
- 新增 `apps/desktop/electron/services/film-engineering/auto-voice-anchor.js`（声音锚生成与渲染）
- `auto-plan.js:224-225`（`detectCharacters` / `buildCharacterMap` 调用处）

**验收判据**：
- 剧本含 8 个角色 ⇒ `characterMap` 覆盖 8 个（不再是 4），且**无静默丢弃**（超限时 warnings 列出被丢角色名）；
- 同一角色出现在 3 个镜 ⇒ 3 个镜的提示词里该角色的声音锚文本**逐字相同**（加断言）；
- `SLOT_ORDER` 的既有 4 槽行为在「用户未标注任何角色」时**逐字不变**（回归锁）。

---

### R6 分集结构

**现状**：全目录 grep `episode | 分集 | 第.集 | 幕 | 全剧终` = **0 命中**。
自动模式把整部片子当作一个扁平镜列表，分场靠剧本里的空行（`auto-plan.js:118-121` `splitAutoBeats`）。

**规格**：
1. **分集为一级结构**：规划期先切「集」，每集再切「场」，每场再切「镜」。
   - 输入侧：新增可选「集数」输入（缺省由程序按目标时长与单集目标时长推导，单集目标时长缺省 3–5 分钟）；
   - 规划侧：`splitAutoBeats` 升级为「集 → 场」两级切分。
2. **每集有钩子**：每集最后一镜标注 `[EPISODE_END]`，供后续做集尾悬念（本期只标注，不生成特殊内容）。
3. **全剧终**：最后集标注 `[FINALE]`，作为质检锚点（质检脚本据此断言最后一集存在）。
4. **集间连续性**：跨集的角色、场景引用连续（现有 `bindReferencePaths` 已是「人物命中 + 场景轮转」，需保证跨集不重置）。

**落点**：
- `auto-plan.js:118-121`（`splitAutoBeats`）、`:149-187`（expand/merge）
- 新增 `apps/desktop/electron/services/film-engineering/auto-episode-plan.js`
- `auto-plan.js:248-316`（shots 映射处补 `episodeIndex / isEpisodeEnd / isFinale` 字段）
- `auto-project.js`（`project.json` 落集级结构）

**验收判据**：
- 规划 1800 秒 / 4 集 ⇒ `shots` 的 `episodeIndex` 覆盖 1..4 且每集非空；
- 断言每集最后一镜 `isEpisodeEnd === true`，且全集最后一镜 `isFinale === true`；
- 断言「每集镜数差 ≤ 目标镜数的 20%」（均分逻辑不得产生畸形集）。

---

### R7 模板中立化

**现状**（§2.4 已详述）：153 个模板全部来自同一部参考片，带原片角色与硬约束。

**规格**：
1. **模板来源可切换**：
   - `default`（当前）：沿用参考片模板（保留「影视工程方法论」体验）
   - `neutral`：使用**中性通用模板**（新增一套随包模板：无具体角色、只保留 `GEO/ACTION/CHARACTER` 块骨架 + 风格锁），供「用户要自己的短剧」场景
2. **切换开关**：自动模式表单新增一个「沿用参考片风格」开关，**默认关闭**（= 新手用户要的是自己的短剧，不是那部片）。
3. **模板分配去重**：不再用 `templates[i % len]` 轮转；改为按「场景 / 景别 / 角色出场」聚类分配，360 镜时同一模板复用次数 ≤ 2。

**落点**：
- `auto-plan.js:249`（`templates[i % templates.length]`）—— **这是本方案里最该被替换的一行**
- 新增中性模板资产（随包 `film-kit` 旁挂一份 `neutral-shot-library.json`）
- `auto-constants.js` / `auto-plan.js`（开关字段）
- `FilmAutoPanel.vue:280-305`（表单区新增开关）

**验收判据**：
- 规划 360 镜 ⇒ 任一模板被复用次数 ≤ 2（断言 `max(复用次数) <= 2`）；
- 开关关闭 ⇒ 产出提示词不含参考片角色名与 `EXACT …` 硬约束；
- 开关开启 ⇒ 产出**逐字等于**改造前（回归锁）。

---

### R8 经济性与治理：限流 / 熔断 / 成本闸 / 单价

**现状**：
- 自动模式**不经 pipeline 引擎**（`film-engineering-auto.js:20` 明写），而 governor 挂在引擎路径上：
  - 引擎路径 `film_generate_videos` 走 `withModelBudget({governor, type:'video'…})`（`video-gen.js:325, 337, 339`）；
  - 自动模式直接 `manager.callAdapter`（`video-gen.js:185-188`），而 `model-provider-manager.js:242-348` 的 `callAdapter` **不经过 `governor.run`**；
  - ⇒ **无 RPM 限流、无 5h/周额度窗口、无 429 冷却退避**；
- **无熔断**：自动模式不传 `providerRunContext`（`auto-runner.js:158-171`），对比 `model-provider-manager.js:245-247` 的 `PROVIDER_CIRCUIT_OPEN`；
- **无金额**：`base.js:120` `estimateCost()` 恒 `null` ⇒ 无单价表；确认卡是「清单式而非金额报价」（spec.md:115，这是上游的设计决策）；
- **无算力闸**：`design.md:126`（D20）「预算按 task 隔离、**无全局上限**」；`design.md:154` / `auto-project.js:361` 都写明 `providerCalls` 是「观测/对账计数器，**不是授权令牌**」。

**规格**：
1. **接 governor**（照抄 story2video 的做法，`story2video-stages.js:1071-1073`）：
   - `auto-runner.js` 的 `gen(...)` 调用包一层 `withModelBudget({ governor, type:'video', providerId, model }, …)`；
   - `governor` 从 `container.setup.js:144` 的 `apiUsageGovernor` 注入 IPC 依赖（**当前 `film-engineering-auto.js` 的 `deps` 里没有 governor，要新增**）。
2. **传 `providerRunContext`**：`auto-runner.js:158-171` 补传，使 `PROVIDER_CIRCUIT_OPEN` / 配额熔断生效。
3. **补单价表**：`adapters/_base/base.js:120` 的 `estimateCost()` 从恒 `null` 改为按 provider 查表（无表的 provider 显示「未知」而不是「0」）。
4. **确认卡显示金额**：规划期估算「镜数 × 单价」= 预计成本，与现有 `estimates`（`auto-plan.js:426-432`）并列展示。
   ⚠️ 上游 spec 明确说「清单式而非金额报价」⇒ **这是一次对上游决策的修订，必须在 spec 里显式改写，不能默默加字段**。
5. **任务级算力闸**：`auto-start` 准入时校验「本次预计消耗 ≤ 用户当前可用额度」；超限返回明确错误码（如 `AUTO_BUDGET_EXCEEDED`），并给出「缩短时长 / 改用更便宜的 provider / 分批」三个出口。
6. **零扣费点必须变成有扣费点**：接入会员积分计费（仅「生成」扣积分，「操作」不扣 —— 沿用既有计费边界）。

**落点**：
- `auto-runner.js:146-175`（包 governor / 传 providerRunContext）
- `ipc-handlers/film-engineering-auto.js:74-84`（deps 注入 governor）、`:266-426`（准入判据）
- `adapters/_base/base.js:120`（`estimateCost`）
- `auto-plan.js:426-432`（estimates 增金额字段）
- `FilmAutoPanel.vue:328-338`（确认卡增一行）
- `openspec/changes/film-auto-mode/specs/film-engineering/spec.md:115`（规格改写）

**验收判据**：
- 自动模式出片路径断言**经过** `governor.run`（注入假 governor，断言被调用次数 == 派发次数）；
- 注入一个会返回 429 的 provider ⇒ 断言该镜进入**冷却退避重试**而不是直接失败（依赖 R9）；
- 规划期返回 `estimates.estimatedCost`，且与单价表一致；无单价表的 provider 显示 `null` + 明确文案（**不是 0**）。

---

### R9 可靠性：有界重试

**现状**：
- `auto-runner.js:146-175`：每镜**恰好一次** `gen()`，失败即 `report(i,'failed',reason)`，**无 retry**；
- `production-driver.js:300-334`：批级 try/catch，失败批标 failed 继续下一批，**无批级重试**；
- 对照组：story2video 有 `withAssetTransientRetry(fn, {maxAttempts=3, rateLimitMaxAttempts=4})`（`story2video-stages.js:1481`）—— **自动模式无此物**。

**规格**：
1. 单镜级有界重试：瞬时错误（超时/网络/5xx）最多 3 次、指数退避；429 最多 4 次、遵守 `Retry-After`。
   ⇒ 直接复用 `story2video-stages.js:1481` 的 `withAssetTransientRetry`，**不要新写一套**。
2. 错误分类用 `adapters/_base/provider-error.js` 的 `classifyProviderFailure`（与 governor 同源）。
3. 重试计数必须**如实上报**（`onShotProgress` 的 reason 里带 `第 N 次重试`），让面板能显示「正在重试」而不是长时间无反馈。
4. 批级：批内全部镜失败 ⇒ 批标 failed 但**不阻断后续批**（保持现状），并在收口时点名缺镜。

**落点**：
- `auto-runner.js:146-175`（重试包裹）
- `story2video-stages.js:1481`（**复用源**，只读不改）

**验收判据**：
- 注入一个前 2 次失败第 3 次成功的桩 ⇒ 断言该镜最终 `status === 'done'`，且 provider 被调用 3 次；
- 注入一个恒定失败的桩 ⇒ 断言调用次数 == 3（不是无限），且 `error` 文案含「重试 3 次仍失败」。

---

### R10 收口自动化与合成成本

**现状**：
- 收口合成需用户点一次按钮（`useFilmAutoRun.js:253-280`，`FilmAutoPanel.vue:434` `fa-compose`）；
- `canCompose` 要求 `phase==='done' && missingShots.length===0`（`useFilmAutoRun.js:70`）；
- 合成走引擎 manifest 直通 run（`film-engineering-auto.js` → `pipelineStartOrchestrated`），`film_generate_videos` 在 manifest 模式下**零 provider 调用**直通（`video-gen.js:244-256`），不产 `costCheck`；
- 合成用 `concat -c copy`（`film-render.js:308`），规格不一致则逐镜 normalize（`:285-293`，**全量重编码**）。

**规格**：
1. **收口自动化**：全部镜齐 ⇒ 自动起 compose run（不再等用户点）。用户仍可手动重合成。
2. **合成成本评估**：360 镜逐镜 normalize 的成本要实测（解码+缩放+重编码+音频转码）。若过慢，增加「两段式」策略：
   - 先用 `ffprobe` 批量探测（`film-render.js:261-268` 已在做），
   - 对**仅音频参数不同**的片段，用**纯音频转码 + 视频直拷**（`-c:v copy -c:a aac`）而不是全量重编码。
3. **可观测**：合成进度已有 `composePercent`（`useFilmAutoRun.js:239`），补「已完成/总镜数」与「当前阶段」。

**落点**：
- `useFilmAutoRun.js:253-280`（自动触发）、`FilmAutoPanel.vue:179-184`（`startRun` 的分支判定已存在 `renderManifest` 分支）
- `film-render.js:274-302`（normalize 策略）
- `film-engineering-auto.js:361-404`（出片完成事件已带 `ok`，可据此自动起 compose）

**验收判据**：
- 出片全部成功后 **无需用户点击**，成片自动出现在 `fa-final`（断言 `finalFileUrl` 在无点击情况下由事件驱动置位）；
- 规格不一致时，断言走的是「视频直拷 + 音频转码」而不是全量重编码（用桩断言 ffmpeg 参数含 `-c:v copy`）。

---

### R11 可观测与端到端验证

**现状**：
- 上游 G5 / G8 未闭合（§三 F-3）；
- 事件负载只带计数（`production-driver.js:19-20`，`EVENT_MERGE_MS = 500`），不给 `shotIds` 数组（IPC 负载守卫）；
- 成本只做事后归集（`usage-reporter.js`），桌面端不消费 `daily_limit`。

**规格**：
1. **端到端集成测试**（闭合 G5/G8）：真机跑 `plan → start → ledger → manifest → final.mp4`，断言：
   - 产物文件齐全（三件套 + N 个 shot + 1 个 final）；
   - `final.mp4` 有音轨流（若 F-1 成立）、时长 = 期望值 ± 容差、可解码；
   - 故意缺一镜 ⇒ 收口被拦（不产假成片）。
2. **成本归集接入**：把 `usage-reporter` 的成本读数接进 `auto-status`，让用户能看到「这次花了多少」。
3. **失败可诊断**：失败的镜必须带**可辨识原因**（已是现状，`auto-runner.js:137-144`），并在面板上给出「重试这镜 / 换 provider / 改提示词」三个出口。

**落点**：
- 新增 `apps/desktop/electron/ipc-handlers/film-engineering.e2e-longform.test.js`（沿用 `film-engineering.e2e-int.test.js` 的形态）
- `ipc-handlers/film-engineering-auto-inspect.js`（`auto-status` 增成本读数）

**验收判据**：
- 端到端测试在 CI 绿（用桩 provider 产出带音轨的合成片段，不需要真实 API）；
- 缺镜场景断言「不产出 `final.mp4`」。

---

### R12 前端交互（长篇化下的 UX 变化）

**现状**：面板是 4 步状态机（`FilmAutoPanel.vue:54`），输入 5 项，1 次确认。

**规格**：
1. **输入区新增**：
   - 集数（可选，缺省自动推导）；
   - 「沿用参考片风格」开关（默认关）；
   - 字数/密度实时提示（`scriptCount` 旁加「按目标时长 X 秒约需 N 字」）。
2. **确认卡新增**：
   - 集数 / 每集镜数；
   - 预计成本（金额或「未知」）；
   - **预计墙钟**（现有 `WALLCLOCK_SECONDS_PER_SHOT = 300` 是按单镜串行估的，批内并发 2 ⇒ 实际约 150s/镜，应改口径）；
   - 预计磁盘（现有 `8MB/镜` 口径在长篇下是 2.9GB，需确认是否含音轨）。
3. **运行期新增**：
   - 当前集/镜定位（长篇下用户需要知道「跑到第几集了」）；
   - 重试中状态；
   - 「成本已产生」实时读数。
4. **不做**：逐批确认（沿用上游「一次确认跑到底」的决策）。

**落点**：
- `apps/desktop/src/views/film-auto/FilmAutoPanel.vue:234-323`（输入区）、`:326-378`（确认卡）、`:390-426`（运行区）
- `apps/desktop/src/views/film-auto/useFilmAutoRun.js`（`stageList` / `progress` 结构扩字段）
- `apps/desktop/src/locales/film-engineering/zh.js` + `en.js`（**成对新增**，CI Gate 7 拦截不成对）

**验收判据**：
- 新增 locale 键 zh/en **成对**（CI `check-locale-sync` 绿）；
- 面板在 30 分钟规模下不出现横向溢出（`fa-shot-preview` 与 `fa-shots` 表格需分页或虚拟滚动——360 行全渲染会卡）。

---

## 五、实施计划

### 总原则

1. **M0 不过 ⇒ 全案不动。** 不在未验证的链路上叠加工期。
2. **每个里程碑独立可合并、独立可回滚**，不攒大 PR。
3. **新增逻辑进新文件**：`auto-plan.js` / `auto-runner.js` / `script-adapt.js` 都在逐文件行数门禁的视野内，**不要往里堆行**；新逻辑抽独立模块（先例：`tts-voice-id.js`、`auto-plan-characters.js`）。
4. **每个里程碑都要有「能红的断言」**，不接受恒真断言。
5. **改一条规则要同步四处**（本仓既有教训）：代码 / 规格（`openspec/changes/film-auto-mode/specs/`）/ 常量双端（前端+后端）/ 用户手册（`01-docs/USER-MANUAL-FILM-ENGINEERING-*.md`）。

---

### M0：取证与打通（**门**）

**目标**：证明这条链路能跑通，并把三个前置事实变成结论。

| # | 任务 | 产出 | 验收 |
|---|---|---|---|
| M0.1 | F-1：目标 provider 音轨能力取证 | 《provider 音轨能力实测表》 | 至少 1 个 provider 的 ffprobe 音轨证据 |
| M0.2 | F-2：目标 provider 镜长可控性取证 | 《provider 镜长可控性实测表》 | 121/201/241 帧三档的成片实测时长 |
| M0.3 | F-3：端到端出片跑通 | 12 镜 + `final.mp4` | ffprobe 断言 + 留证 |
| M0.4 | 产出 `VIDEO_AUDIO_PARAM_BY_PROVIDER` 能力表 | 新文件 + 规划期接入 | 规划期能对不支持的 provider 告警 |
| M0.5 | 依据 M0.1/M0.2 的结论，**冻结 R3 的档位形态** | 本文档 v1.1（补 R3 档 1/档 2 的最终选择） | 评审确认 |

**产出物**：`01-docs/PRD-FILM-AUTO-LONGFORM-2026-10-24.md` v1.1（含实测表）。

---

### M1：规模域放开 + 经济性护栏（**先护栏，后开门**）

> **顺序纪律**：R8 的 governor 接入必须与 R1 的上限放开**同一个里程碑**。
> 先放开 600→1800 再补限流，中间任何一天都可能把运营配的服务商额度打满。

| # | 任务 | 落点 |
|---|---|---|
| M1.1 | 时长/镜数/字数上限放开（R1） | `auto-plan.js:38-43`、`auto-constants.js:11-14` |
| M1.2 | 常量双端一致性契约测试 | 新增测试 |
| M1.3 | **接 governor + 传 providerRunContext**（R8.1/R8.2） | `auto-runner.js:146-175`、`film-engineering-auto.js:74-84` |
| M1.4 | 补单价表 + 成本估算 + 确认卡金额（R8.3/R8.4） | `base.js:120`、`auto-plan.js:426-432`、`FilmAutoPanel.vue:328-338` |
| M1.5 | 任务级算力闸（R8.5） | `film-engineering-auto.js:266-426` |
| M1.6 | 规格改写（把「清单式而非金额报价」改成「清单 + 金额」） | `openspec/changes/film-auto-mode/specs/film-engineering/spec.md:115` |
| M1.7 | 有界重试（R9） | `auto-runner.js:146-175`（复用 `story2video-stages.js:1481`） |

**里程碑验收**：
- 规划 1800 秒成功，且确认卡显示金额与预计墙钟；
- 出片路径断言经过 `governor.run`；
- 注入 429 桩 ⇒ 断言走冷却退避（不是直接失败）。

---

### M2：台词-镜长契约（**内容质量的地基**）

> 这一步做完，「对白由视频模型统一完成」才从「碰运气」变成「有约束」。

| # | 任务 | 落点 |
|---|---|---|
| M2.1 | 出片消费逐镜 `durationSec`（R3.1/R3.2） | `auto-runner.js:163`、`:231` |
| M2.2 | 台词溢出 fail-closed（R3.3） | `auto-plan.js:344-365` |
| M2.3 | 档 2 形态：按台词容量拆镜（R3.2′） | `auto-plan.js:149-174` |
| M2.4 | 12 秒档接入 | `auto-plan.js:43`、`auto-constants.js:14`、`shot-duration.js:129-144` |
| M2.5 | 出片后逐镜校验音轨时长（档 2）（R3.4′） | `auto-runner.js:76-94`（`syncProjectFromDisk` 扩展） |
| M2.6 | 密度判据与告警（R2） | `auto-plan.js:372-404` |

**里程碑验收**：
- 60 字台词 + 5 秒档 ⇒ 规划**失败并点名该镜**（档 1）或规划出 2 镜（档 2）；
- 出片 payload 的 `numFrames` 随逐镜变化。

---

### M3：提示词结构化 + 角色与声音锚

| # | 任务 | 落点 |
|---|---|---|
| M3.1 | `[DIALOGUE]` 结构化台词块（R4.1） | 新文件 `auto-prompt-dialogue.js` + `auto-plan.js:248-316` |
| M3.2 | `AUDIO` 块在自动模式下并入 videoPrompt（R4.2） | `script-adapt.js:100-104`（**仅自动模式入口**） |
| M3.3 | 原片硬约束块剥离（R4.3） | `auto-prompt-dialogue.js` |
| M3.4 | 角色槽位可配置可扩展（R5.1/R5.2） | `auto-plan-characters.js:16`、`:98-100` |
| M3.5 | 角色-声音锚生成与逐镜渲染（R5.3） | 新文件 `auto-voice-anchor.js` |
| M3.6 | 角色超限明确告警（R5.4） | `auto-plan.js:372-404` |

**里程碑验收**：
- 每镜提示词含 `[DIALOGUE]` 且角色名与 `characterMap` 一致；
- 同一角色跨 3 镜的声音锚文本逐字相同；
- 画布/工程案例路径的 `videoPrompt` 逐字不变（回归锁）。

---

### M4：分集结构

| # | 任务 | 落点 |
|---|---|---|
| M4.1 | 集 → 场 两级切分（R6.1） | `auto-plan.js:118-121` + 新文件 `auto-episode-plan.js` |
| M4.2 | 集尾钩子与全剧终标注（R6.2/R6.3） | `auto-episode-plan.js` |
| M4.3 | 跨集参考绑定连续（R6.4） | `auto-plan.js:226-231` |
| M4.4 | `project.json` 落集级结构 | `auto-project.js` |
| M4.5 | 集数输入项 | `auto-constants.js` / `FilmAutoPanel.vue:280-305` |

**里程碑验收**：
- 4 集规划 ⇒ `episodeIndex` 覆盖 1..4 且每集非空；
- 每集末镜 `isEpisodeEnd`；全集末镜 `isFinale`；
- 每集镜数差 ≤ 目标镜数 20%。

---

### M5：模板中立化

| # | 任务 | 落点 |
|---|---|---|
| M5.1 | 中性模板资产（随包） | `apps/desktop/electron/film-kit/neutral-shot-library.json` |
| M5.2 | 模板分配聚类去重（替换 `templates[i % len]`）（R7.3） | `auto-plan.js:249` |
| M5.3 | 「沿用参考片风格」开关（R7.1/R7.2） | `auto-plan.js` / `FilmAutoPanel.vue` / `auto-constants.js` |
| M5.4 | 模板加载器支持双库 | `kit-loader.js` / `film-engineering-service.js:262` |

**里程碑验收**：
- 360 镜 ⇒ 任一模板复用 ≤ 2；
- 开关关闭 ⇒ 提示词不含参考片角色名与 `EXACT …`；
- 开关开启 ⇒ 逐字等于改造前。

---

### M6：收口自动化 + 合成成本 + 端到端 + UX

| # | 任务 | 落点 |
|---|---|---|
| M6.1 | 收口自动触发（R10.1） | `useFilmAutoRun.js:253-280`、`film-engineering-auto.js:361-404` |
| M6.2 | 合成两段式策略（R10.2） | `film-render.js:274-302` |
| M6.3 | 端到端集成测试（R11.1，闭合 G5/G8） | 新增 e2e 测试 |
| M6.4 | 成本读数进 `auto-status`（R11.2） | `film-engineering-auto-inspect.js` |
| M6.5 | 前端长篇化 UX（R12 全部） | `FilmAutoPanel.vue`、`useFilmAutoRun.js`、locales zh/en 成对 |
| M6.6 | 用户手册同步 | `01-docs/USER-MANUAL-FILM-ENGINEERING-*.md` |
| M6.7 | 上游 PRD 与 spec 同步 | `01-docs/PRD-FILM-AUTO-MODE-2026-10-09.md`、`openspec/changes/film-auto-mode/` |

**里程碑验收**：
- 无点击自动出成片；
- 端到端测试在 CI 绿；
- 缺镜场景不产假成片。

---

### 依赖关系

```
M0 ──► M1 ──► M2 ──► M3 ──► M4
 │             │             │
 │             └─────────────┴──► M5 ──► M6
 └──────────────────────────────────────►
```

- **M1 与 M2 不可颠倒**：先放开规模再补台词契约 = 先造出一堆念不完的镜头。
- **M3 依赖 M2**：台词块要引用逐镜时长契约算出的结果。
- **M5 依赖 M3**：模板中立化要同时处理角色名与台词块。
- **M6 收尾**：可观测与端到端放在最后，但 **M0.3 已经做了一次最小端到端**——两者不重复，M0.3 是 12 镜打通，M6.3 是长篇规模 + 断言扩充。

---

## 六、验收标准（汇总，可测）

| # | 验收项 | 判据 |
|---|---|---|
| A1 | 30 分钟可规划 | `(1800, 12)` 规划成功，`shots.length >= 150` |
| A2 | 超限被拦 | `(1801, …)` → `AUTO_BAD_PARAM`；`(1800, 361)` → `AUTO_TOO_MANY_SHOTS` |
| A3 | 字数上限 | `MAX_AUTO_SCRIPT_LENGTH >= 24000`，且前后端常量逐值相等 |
| A4 | 密度可见 | 规划期产出「所需台词字数 vs 当前字数」警告 |
| A5 | 台词-镜长 | 60 字台词 + 5 秒档 ⇒ 规划失败并点名该镜（档 1）／拆成 2 镜（档 2） |
| A6 | 逐镜时长生效 | 出片 payload 的 `numFrames` 随逐镜 `durationSec` 变化 |
| A7 | 结构化台词 | 每镜提示词含 `[DIALOGUE]`，角色名与 `characterMap` 一致 |
| A8 | 声音锚一致 | 同一角色跨 3 镜的声音锚文本逐字相同 |
| A9 | 角色不静默丢 | 8 角色剧本 ⇒ `characterMap` 覆盖 8 个；超限时警告列出被丢角色名 |
| A10 | 分集完整 | 4 集规划 ⇒ `episodeIndex` 1..4、每集末镜 `isEpisodeEnd`、全集末镜 `isFinale` |
| A11 | 模板去重 | 360 镜 ⇒ 任一模板复用 ≤ 2 |
| A12 | 模板中立 | 开关关闭 ⇒ 提示词不含参考片角色名与 `EXACT …` |
| A13 | 回归不破 | 画布/工程案例路径的 `videoPrompt` 与 `buildTemplatePrompt` 逐字不变 |
| A14 | 限流生效 | 出片路径断言经过 `governor.run`，调用次数 == 派发次数 |
| A15 | 熔断生效 | 注入配额超限 ⇒ 断言返回 `PROVIDER_CIRCUIT_OPEN` 而非继续派发 |
| A16 | 成本可见 | `estimates.estimatedCost` 非空；无单价表时为 `null` + 明确文案（不是 0） |
| A17 | 算力闸 | 预计消耗超额度 ⇒ `auto-start` 拒绝并给出三个出口 |
| A18 | 有界重试 | 前 2 次失败第 3 次成功 ⇒ `done`；恒失败 ⇒ 调用 3 次后停 |
| A19 | 收口自动 | 无用户点击 ⇒ 成片自动出现 |
| A20 | 端到端 | CI 内端到端测试绿：`final.mp4` 存在 + 有音轨 + 时长符合预期；缺镜不产成片 |
| A21 | locale 成对 | 新增 zh/en 键成对（CI Gate 7 绿） |
| A22 | 门禁不红 | 逐文件行数门禁、品牌残留、编码完整性、门禁记录四条全绿 |

---

## 七、风险登记与回滚

| # | 风险 | 概率 | 影响 | 缓解 | 回滚 |
|---|---|---|---|---|---|
| K1 | **F-1 判定为「provider 不产音轨」** | 中 | 极高（C3 前提不成立 ⇒ R3/R4/R5 作废） | M0.1 提前暴露，不投入 M1 之前 | 方案降级为「先补适配器音轨能力」，长篇化回 P1 |
| K2 | **F-2 判定为「镜长不可控」** | 高 | 中（R3 走档 2，成本更高） | M0.2 提前暴露 | R3 切换档 2 形态（拆镜策略） |
| K3 | 放开规模后**运营服务商额度被打满** | 高 | 高（影响其它功能线） | **M1.3 与 M1.1 同里程碑**；M1.5 算力闸；`limit_per_5h` 生效 | 回滚上限常量（单一 PR 可退） |
| K4 | `script-adapt.js` 改动**波及画布/工程案例路径** | 中 | 高（既有功能回归） | M3.2 限定自动模式专用入口；A13 回归锁 | 回滚 M3.2 单个提交 |
| K5 | 逐文件行数门禁**把主干打红** | 中 | 高（挡住全仓 PR） | 新逻辑一律进新文件；M0 前先查 `.github/scripts/max-lines-baseline.json` 的 `targets` 名单 | 见「点名还账」纪律：降到目标以下优先于上调 |
| K6 | 360 镜**合成 normalize 成本过高** | 中 | 中 | M6.2 两段式策略 | 回退到 `-c copy`（代价：可能 concat 失败，需捕获并给出明确错误） |
| K7 | 长篇任务的**单飞锁被占 15 小时** | 高 | 中（其它自动任务无法启动） | R12.3 明确展示占用状态；提供「降级为后台任务」开关 | 拆成多个 taskId 分批跑（当前架构已支持 `taskId` 隔离） |
| K8 | **端到端始终无法在 CI 跑通**（需真实 provider） | 中 | 中 | M6.3 用**桩 provider 产出带音轨合成片段**，不依赖真实 API | 保持为人工 E2E + 文档化步骤（但 G5/G8 就无法闭合） |

---

## 八、附录

### A. 取证索引

| 主题 | 位置 |
|---|---|
| 自动模式 UI 面板 | `apps/desktop/src/views/film-auto/FilmAutoPanel.vue` |
| 自动模式常量（前端） | `apps/desktop/src/views/film-auto/auto-constants.js` |
| 规划（纯函数、零 IO） | `apps/desktop/electron/services/film-engineering/auto-plan.js` |
| 角色检出与槽位 | `apps/desktop/electron/services/film-engineering/auto-plan-characters.js` |
| 提示词拼装 / 三分 | `apps/desktop/electron/services/film-engineering/script-adapt.js` |
| 逐镜时长推算 | `apps/desktop/electron/services/film-engineering/shot-duration.js` |
| 批执行 | `apps/desktop/electron/services/film-engineering/auto-runner.js` |
| 分批驱动 + 台账 | `apps/desktop/electron/services/film-engineering/production-driver.js` |
| 视频生成 + 提交载荷 | `apps/desktop/electron/services/film-engineering/video-gen.js` |
| 合成 | `apps/desktop/electron/services/film-engineering/film-render.js` |
| kit 加载 / 模板源 | `apps/desktop/electron/services/film-engineering/kit-loader.js`、`film-engineering-service.js` |
| provider 参考输入能力表（能力表范式） | `apps/desktop/electron/services/film-engineering/video-reference-inputs.js:30-34` |
| IPC 通道 | `apps/desktop/electron/ipc-handlers/film-engineering-auto.js`（+ `-inspect` / `-projection`） |
| 适配器（9 个视频） | `apps/desktop/electron/services/adapters/{agnes-video,cogvideo,ltx,seedance,veo,kling,grok-video,wan,runway}.js` |
| 限流治理 | `apps/desktop/electron/services/api-usage-governor.js`、`model-call-scheduler.js` |
| 治理装配 | `apps/desktop/electron/core/container.setup.js:95-96, 144` |
| 可复用的重试器 | `apps/desktop/electron/services/story2video-stages.js:1481` |
| 可复用的限流包裹 | `apps/desktop/electron/services/story2video-stages.js:1071-1073` |
| 可复用的字幕/转场合成引擎 | `apps/desktop/electron/services/story2video-compose-engine.js:192-201, 589+, 670` |
| 随包 kit | `apps/desktop/electron/film-kit/shot-library.json`（153 镜）、`film-manifest.json`（162 场 / 4 角色 / 5706 秒） |
| 上游 PRD | `01-docs/PRD-FILM-AUTO-MODE-2026-10-09.md`（§14.7 已知缺口 G1–G8、§14.8 明确不做） |
| 上游全量出片 PRD | `01-docs/PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md`（6,558 镜 / 95.1 分钟 / 146 批 / ~51GB） |
| 变更提案与设计 | `openspec/changes/film-auto-mode/{proposal,design,tasks,specs}.md` |
| 仓库规范 | `AGENTS.md`（分支/门禁/执行记录/文档分层） |

### B. 实测数据表

**随包 kit 模板块分布（153 镜）**

| 块 | 命中 | 占比 | 分类 | 在 videoPrompt 中 |
|---|---|---|---|---|
| `EXACT …` | 29 | 19% | 硬约束 | 部分保留 |
| `AUDIO` | 24 | 16% | 静态 | ❌ 被剔除 |
| `POSITIVE CONSTRAINTS` | 5 | 3% | 静态 | ❌ 被剔除 |
| `GEO SPATIAL LAYOUT` | 1 | 0.7% | 静态 | ❌ 被剔除 |
| `ACTION TIMING` | 3 | 2% | 运动 | ✅ 保留 |
| `CHARACTER ACTING` | 0 | 0% | 运动 | — |

**视频适配器能力矩阵**

| 适配器 | `numFrames` | `width/height` | audio 参数 |
|---|---|---|---|
| `agnes-video` | ✅ | ✅ | ❌ |
| `ltx` | ✅ | ✅ | ❌ |
| `cogvideo` / `seedance` / `veo` / `kling` / `grok-video` / `wan` / `runway` | ❌ | ❌ | ❌ |

**镜长档位 → 帧数（`video-gen.js:53-60`，`FILM_FRAME_RATE = 24`）**

| 档位 | 帧数 | 实际时长 |
|---|---|---|
| ≤5s | 121 | 5.04s |
| ≤8s | 201 | 8.38s |
| ≤10s | 241 | 10.04s |
| else | 441 | 18.38s |

**30 分钟规模换算**

| 项 | 5s 档 | 8s 档 | 10s 档 | 12s 档 |
|---|---|---|---|---|
| 所需镜数 | 360 | 225 | 180 | 150 |
| 每镜可装台词（8 字/秒） | 40 字 | 64 字 | 80 字 | 96 字 |
| 30 分钟纯对白总量 | 14,400 字（与档位无关） | | | |
| 含动作描述的剧本量（对白占 40–60%） | 24,000–36,000 字 | | | |

### C. 与既有文档的关系

| 既有文档 | 关系 |
|---|---|
| `01-docs/PRD-FILM-AUTO-MODE-2026-10-09.md` | **本方案是它的长篇化续篇**。本方案 R8.6 与 R11.1 会修订它的 §14.7（G5/G8 未闭合）与 §14.8 明确不做清单（「不做视频剪辑」保留；「清单式而非金额报价」修订） |
| `01-docs/PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md` | **不冲突，是互补的另一条路**。它解决「既有 95 分钟片库的重生成」；本方案解决「新剧本文案的长篇化」。两条路的分批驱动、台账、磁盘复核、renderManifest 契约**完全同源** |
| `openspec/changes/film-auto-mode/` | 规格真源。M1/M2/M3 落地时须同步 `specs/film-engineering/spec.md` |
| `01-docs/USER-MANUAL-FILM-ENGINEERING-COMPLETE-2026-10-19.md` | M6.6 同步 |
