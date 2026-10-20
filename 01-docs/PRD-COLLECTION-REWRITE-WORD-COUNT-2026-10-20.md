# PRD：采集页 AI 改写字数区间真实生效（2026-10-20）

> **变更类型**：运行时代码缺陷修复（渲染层参数契约 + 引擎字数语义 + 结果可见性）
> **分支**：`fix-collect-rewrite-wordcount`　**worktree**：`<仓库父目录>/mp-worktrees/mp-fix-collect-rewrite-wordcount`
> **相关历史**：`01-docs/PRD-REWRITE-WORD-COUNT-CONTROL-2026-09-12.md`（字数区间控制初版）、
> `01-docs/PRD-REWRITE-LIMITS-50000-2026-10-19.md`（上下限放开到 50000）、
> `openspec/records/rewrite-segment-contract.md`（本缺陷当时被登记为「遗留」，见 §2.3）

---

## 1. 背景与事故形态

### 1.1 用户实测

采集页采集到一篇文章后，把「字数」区间设成 **0 - 6000**，点击「AI 改写」，得到的改写结果
**只有 1229 字**，而原文是 **3515 字**（按 Unicode 码点计），改写结果读起来像一份**摘要**，
"像是没有写完"。用户看不到任何字数提示、任何截断提示、任何异常。

实测数据（用户提供原文/改写结果，脚本按码点计数）：

| 指标 | 数值 |
|------|------|
| 原文长度 | 3515 码点 |
| 改写结果长度 | 1229 码点（原文的 35%） |
| 结果结尾 | 完整句（`…才是明朝最该有的底色。`）⇒ **不是被砍尾**，是模型主动压缩 |
| 用户可见提示 | **0 条**（无字数、无截断、无异常） |

### 1.2 为什么"不是被砍尾"这件事很关键

引擎的输出截断上限只有三个候选值：策略 `postProcess.maxLength`（800 / 1500 / 1500 / 2000 / 3000）
或默认 3000。1229 **不落在任何一个**上 ⇒ 稿子不是被 `_postProcess` 砍短的，
而是**模型自己写短了**。这决定了修复方向是"让字数要求真的进到 prompt 里"，
而不是"放宽截断上限"。

### 1.3 目标

1. 采集页的「字数」设置**真的生效**：区间进 prompt、约束后处理上限、决定 max_tokens；
2. `min=0`（"不设下限"）被正确表达，**不得**被渲染成"可以任意短"；
3. 用户在界面上**看得见**改写结果的实际字数，以及稿子是否被截断（引擎砍尾 / 模型侧截断）分型可见；
4. 采集页字数区间的**错误提示文案**与真实合法域一致。

### 1.4 非目标（明确不做什么）

- **不改** `/rewrite` 页（RewriteView）已有的字数区间行为——它本来就传对了 `wordCountRange`；
  本次只让引擎的 `min=0` 语义对两个页面**同时**变得正确（共用同一份引擎实现，不做页面级补丁）。
- **不改** Python 旁路（`aggregationRewrite` / `AggregationService.rewrite`）——
  桌面主链路早已 Node 化（`aiRewrite`），Python 链路不是采集页当前走的路。
- **不做**字数区间的持久化（会话内有效；跨会话记忆是独立需求）。
- **不做**知乎收藏批量改写（`BatchCollectPanel` / `zhihuFavBatchRun`）的字数区间入口——
  该面板**没有**字数区间 UI，本就不存在"设置不生效"的问题；引擎回落策略上限属既有设计，不在本次范围。
- **不做**"自动把结果补长到目标字数"——那需要二次生成，成本与语义风险都高；
  本次只保证**指令正确下发 + 结果可见**，让用户能判断并自行调大区间。
- **不把** `targetLength` 三档（short/medium/long）当成字数区间——它在 `imitate` 模式下根本不被 prompt 消费
  （见 §5.4），只保留为兼容字段。

---

## 2. 根因分析

### 2.1 缺陷 1（根因）：采集页下发的是引擎不认识的键

| 位置 | 事实 |
|------|------|
| `apps/desktop/src/views/Collection.vue` `rewriteViaEngine()` | 下发 `userSettings.targetWordCount = { min, max }` |
| `packages/rewrite-engine/src/rewrite-engine-core.js` `_getWordCountInstruction()` | 只读 `userSettings.wordCountRange` |
| 全仓检索 | `targetWordCount` 在 `packages/rewrite-engine/` 内 **0 处引用**（只出现在 Collection.vue 与一份 openspec 记录里） |

同一个错误键导致**三处**下游同时失效：

| 环节 | 期望 | 实际（缺陷态） |
|------|------|---------------|
| `_getWordCountInstruction()` | systemPrompt 注入「【字数要求】…{min} 到 {max} 字之间。」 | 返回 `''` ⇒ **prompt 里根本没有字数要求** |
| `_postProcess()` | 截断上限 = `wordCountRange.max` | 回落 `strategy.postProcess.maxLength`（800/1500/1500/2000/3000）⇒ 用户设的 6000 变成 1500 |
| `apps/desktop/electron/services/rewrite-engine.js` `llmClient.chat()` | `max_tokens = min(64000, max(1024, ceil(max×2)))`，max 取 `wordCountRange.max` | `_lastWordCountRangeMax = undefined` ⇒ 回落到 3000 口径 ⇒ `max_tokens = 6000` |

**引入时间**：commit `83ac2706a`（2026-09-13，`fix: 合并后适配——length 下拉已移除，字数区间直控 targetLength`）。
该提交把三档下拉换成 min/max 输入框时，**新造了 `targetWordCount` 这个键**，
而同期引擎的契约键是 `wordCountRange`（见 2026-09-12 PRD §2.1 F2）。
两套键名从此并存，采集页一直发的是那套没人读的。

### 2.2 缺陷 2：合法下限 `0` 被假值吞掉

```js
const minW = Number(rewriteWordCountMin.value) || 800   // ← 0 是假值 ⇒ 被吞成 800
const maxW = Number(rewriteWordCountMax.value) || 2000
```

`useWordCountValidation` 明确允许 `min = 0`（合法域 0-49999），
但这一行 `|| 800` 会把用户设的 **0 改写成 800**。用户以为设的是"0-6000"，
实际发出去的是"800-6000"。修掉缺陷 1 之后，这一行仍会让下限语义失真，必须同时修。

### 2.3 缺陷 3：`min=0` 的指令形态本身是错的

即使区间正确送达，引擎把 `min=0` 渲染成：

> 【字数要求】改写后的文本长度必须控制在 **0 到 6000** 字之间。

这句话把"**不设下限**"说成了"**可以任意短**"。模型面对一个下限为 0 的区间，
最稳的策略就是贴着下限写——于是改写被做成摘要。
**「0 到 6000」是一个语法合法、语义有害的指令。**

> 该缺陷当时已被登记：`openspec/records/rewrite-segment-contract.md` 的「遗留」节写着
> 「Collection 路径传 `targetWordCount` 而非 `wordCountRange` ⇒ 桥接层 max_tokens 回落 3000 口径」——
> 登记了**症状（max_tokens）**，没有登记**机制（区间从未送达）**，也没有登记 `min=0` 语义。

### 2.4 缺陷 4：结果元信息在采集页从不展示

引擎早就会回传 `outputLength` / `outputTruncated` / `modelTruncated` / `truncatedSegments`，
采集页的 `rewriteViaEngine()` 也**确实**把它们收进了 `meta`（评审 M5 的功劳），
但**五个调用点没有一个读 `meta`**，`/rewrite` 页的 `deriveOutputTruncatedInfo` /
`deriveModelTruncatedInfo` 也**只在 RewriteView 引用**。
结果：稿子被砍尾、稿子被模型截断，采集页**零提示**。

### 2.5 缺陷 5：采集页字数区间的错误文案是过期值

`collection.wordCountMinInvalid` 写着「0-5999」、`collection.wordCountMaxInvalid` 写着「1-6000」，
而真实合法域自 `rewrite-limits-50000` 起已是 **0-49999 / 1-50000**
（`/rewrite` 页的同款文案在 2026-10-19 已更新，采集页漏改）。
用户按提示理解合法域，会以为自己能用 60000。

---

## 3. 功能需求

### F1 采集页下发引擎真契约 `wordCountRange`

- `rewriteViaEngine()` 的 `userSettings` 必须携带 `wordCountRange: { min, max }`；
- **删除**死键 `targetWordCount`（保留它只会让人误以为设置生效）；
- 五个调用点（手动改写 / 一键采集改写 / 视频转写 / stealth 采集 / 文案库改写）**共用同一个漏斗**
  `rewriteViaEngine()`，因此**只改一处**即覆盖全部路径。

### F2 `min=0` 原样透传

- 读取用户输入时**不再自行折算**：改用共享 composable `useWordCountValidation` 新增的 `range` computed
  （error 非空 ⇒ `null`；error 为空 ⇒ 就是该下发的 `{min, max}`）；
- 旧写法 `Number(min) || 800` 会把**合法下限 0** 吞成 800（0 是假值），必须移除；
- 非法输入（空 / 非数字 / 浮点 / max<min）⇒ `range` 为 `null` ⇒ **早退，不发任何区间**，
  绝不"发一个看起来合法的兜底值"（那正是本缺陷最初那一类静默走样）；
- 注意：`max` 的合法域是 1-50000（不含 0），`min` 的合法域是 0-49999（**含 0**）；
- 空输入必须先判空再取数：`Number('') === 0`（不是 NaN），直接 `Number()` 会把"清空"变成"下限 0"。

### F3 引擎 `min=0` 的指令语义

- `min > 0`：指令形态**不变**（「改写后的文本长度必须控制在 {min} 到 {max} 字之间。」）；
- `min = 0`：改为**只给上限 + 给一个与原文相当的目标篇幅**：

  > 【字数要求】改写后的文本长度不得超过 {max} 字。目标篇幅约 {target} 字（与原文篇幅相当）；不要把原文压缩成摘要，不得省略原文的信息点。

- `target = min(原文码点数, max)`：
  - 原文短于上限 ⇒ target = 原文长度 ⇒ "与原文篇幅相当"（改写不该凭空缩水）；
  - 上限低于原文 ⇒ target = max ⇒ 目标与硬上限一致，**两句话不会自相矛盾**
    （若 target 取原文长度，就会出现"目标 3000 字"却"不得超过 2000 字"的自冲突指令）。
- 指令仍挂在 systemPrompt 的**末尾**（`[hardConstraints, strategy.systemPrompt, modeInstructions, wordCountInstruction]`），
  与既有注入位置一致，不改拼接顺序。

### F4 采集页展示改写结果的实际字数

- 结果区下方新增一行：`改写后 {length} 字（原文 {original} 字）`；
- **两个数并排**才可判断"短了多少"——只给改写后字数是单边数字，读者无法与原文比；
- 文案放在 `rewritePage` 命名空间（与 `outputTruncated` / `outputTruncatedByModel` / `segmentedMeta` 同族），
  **不放在 `collection` 命名空间**：后者的 `zh.js`/`en.js` 已在 498/497 行、正卡在 500 行天花板，
  再加会触发全仓债务棘轮 `filesOver500` 红（实测：加 5 行 ⇒ 97 > baseline 95）。

### F5 采集页展示两类截断横幅（分型）

| 类型 | 触发字段 | 文案 key | 为什么必须分型 |
|------|---------|---------|-------------|
| 引擎砍尾 | `outputTruncated === true` | `rewritePage.outputTruncated` | 引擎按区间/策略上限截断 ⇒ **调大「字数控制」有效** |
| 模型侧截断 | `modelTruncated === true` | `rewritePage.outputTruncatedByModel` | provider 自身生成上限截断 ⇒ 调大区间**不一定有效** |
| 分段局部截断 | `truncatedSegments` 非空 | `rewritePage.outputTruncatedByModelSegments` | 必须点名段号，否则用户以为全文残缺 |

- 复用 `apps/desktop/src/utils/rewrite-truncation.js` 的三个纯函数（`/rewrite` 页同一份，**不复制实现**）；
- 横幅里的"上限"取本次生效的区间上限；区间非法时回落引擎上限 `REWRITE_ENGINE_MAX_OUTPUT_CHARS`（50000）。

### F6 采集页字数区间错误文案校正

- `collection.wordCountMinInvalid`：「最小字数需为 0-**49999** 的整数」；
- `collection.wordCountMaxInvalid`：「最大字数需为 1-**50000** 的整数」；
- 与 `/rewrite` 页文案对齐（CI 的 locale 一致性测试锁 zh/en 成对）。

---

## 4. 数据校验规则

### 4.1 前端（`useWordCountValidation`，采集页与 `/rewrite` 页共用）

| 校验项 | 规则（Unicode 码点口径） | 错误 key | 文案（zh / en） |
|--------|------------------------|---------|----------------|
| min 为空 | `''` / `null` / `undefined` | `collection.wordCountMinInvalid` | 最小字数需为 0-49999 的整数 / Min must be an integer between 0 and 49999 |
| min 非整数 | `!Number.isInteger(Number(min))` | 同上 | 同上 |
| min 越界 | `min < 0` 或 `min > 49999` | 同上 | 同上 |
| max 为空 | `''` / `null` / `undefined` | `collection.wordCountMaxInvalid` | 最大字数需为 1-50000 的整数 / Max must be an integer between 1 and 50000 |
| max 非整数 | `!Number.isInteger(Number(max))` | 同上 | 同上 |
| max 越界 | `max < 1` 或 `max > 50000` | 同上 | 同上 |
| max < min | 跨字段 | `collection.wordCountMaxLtMin` | 最大字数不能小于最小字数 / Max cannot be less than min |

上界真源：`REWRITE_ENGINE_MAX_INPUT_CHARS`（50000）/ `REWRITE_ENGINE_MAX_OUTPUT_CHARS`（50000），
经 `apps/desktop/src/utils/rewrite-engine-limits.js` 与引擎常量对齐
（`rewrite-engine-limits.test.js` 结构锁保证两处同值）。

### 4.2 引擎（`packages/rewrite-engine`）

| 校验项 | 规则 | 不满足时 |
|--------|------|---------|
| 区间存在 | `userSettings.wordCountRange` 且 min/max 均为 number | 不注入字数指令（后处理回落策略上限） |
| min 合法 | `0 ≤ min ≤ 49999` | 不注入字数指令 |
| max 合法 | `1 ≤ max ≤ 50000` | 不注入字数指令 |
| **整数性** | `Number.isInteger(min)` 且 `Number.isInteger(max)` | 不注入字数指令（外部评审 i1 补入） |
| max ≥ min | `max < min` 视为非法 | 不注入字数指令 |
| 区间合法 | 以上全过 | 注入字数指令，且 `_postProcess` 截断上限 = `max` |

**为什么"非法区间不注入指令"而不是"报错"**：引擎是主进程侧，可能被旧客户端、
第三方集成、或未来的新入口以未校验的参数调用；此时保持"无指令 + 策略上限兜底"
是 fail-safe（输出不会失控），而抛错会把一次改写整体打失败。**校验责任在调用方（前端）**，
引擎只做防御。

**为什么引擎也要守整数性（外部评审 i1）**：前端 `useWordCountValidation` 已拦浮点，
但引擎是**共享契约点**——Python 旁路、插件、未来新入口都可能绕过 UI 校验。
浮点区间若被注入，prompt 里会出现「1.5 到 6000 字之间」这种语义不成立的指令。
引擎侧的处置与其它非法区间一致：**不注入**（后处理回落策略上限，输出不失控）。

### 4.3 主进程桥接层（`electron/services/rewrite-engine.js`）

| 项 | 规则 |
|----|------|
| 生效输出上限 | `wordCountRange.max`（合法且 > 0）否则 3000 |
| `max_tokens` | `min(64000, max(1024, ceil(生效上限 × 2)))` |
| 系数 2 的理由 | CJK 约 1 字 ≈ 1~1.6 token，留 2 倍余量，宁可 token 略多不可被模型截断 |
| 无区间时 | 生效上限 = 3000 ⇒ `max_tokens = 6000`（与引擎兜底一致） |

---

## 5. 功能逻辑（端到端数据流）

### 5.1 单次路径（原文 ≤ 50000 码点）

```
用户设置 min/max
  → 前端校验（useWordCountValidation）
  → rewriteViaEngine() 组装 userSettings.wordCountRange = { min, max }
  → IPC ai:rewrite → rewriteEngineService.rewrite()
  → 桥接层按 wordCountRange.max 推导 max_tokens
  → RewriteEngine.rewrite()
       ├─ _validate（空内容 / 超长）
       ├─ _resolveStrategy（自动匹配 or 指定 id）
       ├─ _buildPrompt
       │    ├─ 硬约束（最高优先级）
       │    ├─ 策略 systemPrompt
       │    ├─ 模式指令（imitate / expand / create）
       │    └─ 【字数要求】← 本次修复的注入点
       │         min>0：「控制在 {min} 到 {max} 字之间」
       │         min=0：「不得超过 {max} 字。目标篇幅约 {target} 字…」
       │              target = min(原文码点数, max)
       ├─ LLM 调用
       ├─ _postProcess：去 AI 味 → 按 wordCountRange.max 截断 → 剥离结构标题
       │    （max 优先级：wordCountRange.max > 策略 postProcess.maxLength > 3000）
       └─ 返回 { result, outputLength, outputTruncated, modelTruncated, truncatedSegments, segmented }
  → 采集页 applyRewriteMeta()：派生字数 + 两类截断信息
  → 结果区展示
```

### 5.2 分段路径（原文 > 50000 码点）

- `deriveSegmentRange(userRange, segmentCount)`：
  `max = floor(userMax / segmentCount)`；`min = userMin > 0 ? min(userMin, max) : 0`；
- 因此**用户 min=0 时，每段的 min 也是 0** ⇒ 每段都会拿到 F3 的"无下限"指令形态，
  且 `target = min(该段原文长度, 该段上限)` ⇒ 每段改写到与自身篇幅相当；
- 段级上限之和 ≤ 全篇上限 ⇒ 合并结果不会被 `_postProcess` 二次砍尾
  （否则"为避免截断而分段"会变成"分段反而制造截断"）。

### 5.3 截断的两条独立通路（必须分型）

| 通路 | 产生位置 | 可见字段 | 用户能做什么 |
|------|---------|---------|-------------|
| 引擎砍尾 | `_postProcess` 按上限切 | `outputTruncated` + `outputLength` | 调大「字数控制」上限 |
| 模型侧截断 | provider `finish_reason = length/max_tokens` | `modelTruncated`（分段时另有 `truncatedSegments`） | 缩短原文 / 拆成两次改写；调大区间不一定有效 |

### 5.4 `targetLength` 三档的去向（澄清）

- `targetLength` 只被 `_getModeInstructions()` 的 **expand** 分支消费（「目标长度：约500/2000/1000字」）；
- 采集页的 `mode` 恒为 `imitate` ⇒ **三档映射对采集页完全无效**，只是历史兼容字段；
- 保留它的唯一理由是兼容其他调用方；**字数区间的唯一有效载体是 `wordCountRange`**。

### 5.5 代码落点（含两处模块拆分）

| 文件 | 职责 | 本次变化 |
|------|------|---------|
| `packages/rewrite-engine/src/word-count-instruction.js` | **新增**：字数区间指令的措辞 + 目标篇幅推导 | 新模块 |
| `packages/rewrite-engine/src/structure-headings.js` | **新增**：结构标题行剥离 | 新模块（原 `_stripStructureHeadings` 逐字搬出） |
| `packages/rewrite-engine/src/rewrite-engine-core.js` | 编排 + **区间校验** + 两个上限常量 | 瘦身后 750 行 |
| `apps/desktop/src/composables/useWordCountValidation.js` | 字数区间的**唯一真源**：同时产出红字结论与可下发值 | 新增 `range` |
| `apps/desktop/src/views/Collection.vue` | 参数下发 + 元信息展示 | 改契约键 / 取 `range` / 新增字数行与横幅 |

**为什么必须拆这两个模块**：`rewrite-engine-core.js` 的行数挂账
（`check-max-lines.js` 的 LEDGER_GREW，登记值 **578** + 容差 **200** = **778 行天花板**）
在本次改动前**只剩 4 行余量**——主干已经把它推到 774 行。
本次 CI 实测：直接改核心文件 ⇒ 797 行 ⇒ `LEDGER_GREW` 红（且这条红会把**别人**的 PR 一起卡住，
因为门禁看的是文件当前行数，不是本 PR 的增量）。
同族先例：`segment-rewriter.js` 本身就是从核心文件拆出来的独立能力，核心文件头注释里记着同一条理由。

**拆分后的边界约束**（两条，踩了就会红）：
① 区间**校验**必须留在 `rewrite-engine-core.js` —— 渲染层结构锁
`apps/desktop/src/utils/rewrite-engine-limits.test.js` 直接读该文件源码，
断言 `const MAX_OUTPUT_CHARS = (\d+)` 与字面串 `range.max <= MAX_OUTPUT_CHARS` **逐字存在**；
② `MAX_INPUT_CHARS` / `MAX_OUTPUT_CHARS` 两个常量也必须定义在该文件（同上，结构锁直接读源码）。

---

## 6. 交互逻辑

### 6.1 采集页改写（手动按钮）

| 步骤 | 界面反馈 | 数据 |
|------|---------|------|
| 1. 采集完成 | 改写区出现（风格下拉 / 策略选择 / 字数 min-max / 改写按钮） | `collectedResult` |
| 2. 用户改 min/max | 输入即校验：非法 → 红字提示 + **改写按钮 disabled** | `rewriteWordCountError` |
| 3. 点「改写」 | 按钮转「AI 改写中...」并 disabled | `rewriting = true` |
| 4. 区间非法时点入口 | `notifyWarning('collection.wordCountInvalid')`「请先修正字数设置」并早退 | 不发 IPC |
| 5. 引擎返回 | 结果区显示原文/改写双栏 + **改写后 N 字（原文 M 字）** | `rewriteResult` / `rewriteOutputLength` |
| 6. 引擎砍尾 | 追加「改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字）…」横幅 | `rewriteOutputTruncatedInfo` |
| 7. 模型侧截断 | 追加「模型输出达到单次生成上限而截断：实际输出 {length} 字…」横幅 | `rewriteModelTruncatedInfo` |
| 8. 点「清空」 | 结果区、字数行、**两条横幅一并消失** | `clearRewriteResult()` 复位四个 ref |

**为什么横幅用"追加"而不是"替换"结果区**：用户需要同时看到「结果本身」和「这个结果不完整」，
横幅承担"结果可信度"的元信息职责，不占用正文位置。

**为什么清空必须复位横幅**：横幅与正文是同一个产物的两半。分头复位会留下
「清空后仍显示『已按字数上限截断』」的假提示——用户会以为当前(空)结果被砍过。

### 6.2 一键采集+改写

`collectAndRewrite()` 内部同样走 `rewriteViaEngine()` ⇒ 同一套字数语义与元信息展示，
用户无需在两条路径间学习两套行为。

### 6.3 取消

协作式取消（当前片段完成后生效）不变；取消时**不写**字数元信息（没有结果就没有字数）。

---

## 7. 显示项与提示文字

### 7.1 新增/变更的显示项

| 位置 | 显示项 | 条件 | 文案 key |
|------|--------|------|---------|
| 采集页结果区下方 | 实际字数行 | `rewriteOutputLength > 0` | `rewritePage.rewriteOutputLength` |
| 采集页结果区下方 | 引擎砍尾横幅 | `outputTruncated === true` | `rewritePage.outputTruncated` |
| 采集页结果区下方 | 模型侧截断横幅 | `modelTruncated === true` | `rewritePage.outputTruncatedByModel` |
| 采集页结果区下方 | 分段局部截断横幅 | `truncatedSegments.length > 0` | `rewritePage.outputTruncatedByModelSegments` |
| 采集页字数输入框下 | min 非法红字 | min 非法 | `collection.wordCountMinInvalid`（**文案值修正**） |
| 采集页字数输入框下 | max 非法红字 | max 非法 | `collection.wordCountMaxInvalid`（**文案值修正**） |

### 7.2 提示文字全文

| key | zh | en |
|-----|----|----|
| `rewritePage.rewriteOutputLength`（新增） | 改写后 {length} 字（原文 {original} 字） | Rewritten: {length} chars (original: {original} chars) |
| `rewritePage.outputTruncated`（复用） | 改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字），原文后半部分未包含在结果中。如需完整改写，请调大「字数控制」上限。 | The rewrite was trimmed to the output limit: {length} chars written (limit {max}). The tail of the source text is not included. Raise the word-count cap for a full rewrite. |
| `rewritePage.outputTruncatedByModel`（复用） | 模型输出达到单次生成上限而截断：实际输出 {length} 字。这是模型侧的生成限制，调大「字数控制」不一定有效，建议分段改写。 | The model hit its own generation limit and stopped: {length} chars written. This is a provider-side limit; raising the word-count cap may not help — consider segmented rewriting. |
| `rewritePage.outputTruncatedByModelSegments`（复用） | 第 {segments} 段因模型单次生成上限被截断（合并后共 {length} 字）。这是模型侧的生成限制，建议缩短原文或拆成两次改写。 | Segment(s) {segments} were cut by the model per-response limit ({length} chars in total). This is a provider-side limit; shorten the source text or rewrite it in two passes. |
| `collection.wordCountMinInvalid`（**值修正**） | 最小字数需为 0-49999 的整数 | Min must be an integer between 0 and 49999 |
| `collection.wordCountMaxInvalid`（**值修正**） | 最大字数需为 1-50000 的整数 | Max must be an integer between 1 and 50000 |
| `collection.wordCountMaxLtMin`（不变） | 最大字数不能小于最小字数 | Max cannot be less than min |
| `collection.wordCountInvalid`（不变） | 请先修正字数设置 | Fix word count settings first |

### 7.3 引擎注入的提示文字（prompt 侧，用户不可见但决定结果）

| 区间 | 注入文本 |
|------|---------|
| `min > 0` | 【字数要求】改写后的文本长度必须控制在 {min} 到 {max} 字之间。 |
| `min = 0` | 【字数要求】改写后的文本长度不得超过 {max} 字。目标篇幅约 {target} 字（与原文篇幅相当）；不要把原文压缩成摘要，不得省略原文的信息点。 |

**为什么 min=0 的措辞要单独设计**：
- "不得超过 {max}" 是**硬约束**（可机检，模型不会超）；
- "目标篇幅约 {target} 字（与原文篇幅相当）" 是**软目标**（给模型一个具体的数，而不是一个区间）；
- "不要把原文压缩成摘要，不得省略原文的信息点" 是**反退化约束**——直接堵住"下限为 0 ⇒ 写短点"这条模型捷径；
- 三者合起来既不与硬上限自相矛盾（target ≤ max），又不会给模型"可以很短"的暗示。

---

## 8. 回归保护

### 8.1 引擎（`packages/rewrite-engine/tests/rewrite-engine-core.test.js`，新增 5 例）

| 编号 | 断言 |
|------|------|
| W7 | `min=0` ⇒ 指令含「不得超过」与上限，且**不含**「0 到 6000 字之间」 |
| W8 | `min=0` 且原文(1200)短于上限(6000) ⇒ 指令含目标篇幅 1200 + 「不要把原文压缩成摘要」 |
| W9 | `min=0` 且上限(2000)低于原文(3000) ⇒ 目标篇幅取 2000，**不得**出现 3000（避免自相矛盾指令） |
| W10 | `min>0` ⇒ 指令仍是「800 到 2000 字之间」（既有契约不变） |
| W11 | 浮点区间（min=1.5）⇒ **不注入**字数指令（外部评审 i1 补入） |

> **断言口径提醒**：硬约束文案里本身就含「字数要求」四字（"…模式指令或字数要求与本段有何冲突…"），
> 判定注入必须用带书名号的形态「【字数要求】」，否则该断言恒真。

### 8.2 采集页（`apps/desktop/src/views/Collection.rewrite-wordcount.test.js`，新增 9 例）

| 编号 | 断言 |
|------|------|
| ① | 下发 `userSettings.wordCountRange = {min:0,max:6000}`，且 `targetWordCount` **不存在** |
| ② | `min=0` 原样下发（不被吞成 800） |
| ③ | 区间非法（max<min）⇒ 不发 IPC |
| ④ | 浮点下限 1.5 ⇒ 判非法、不发 IPC（外部评审 i1 补入） |
| ⑤ | 结果区显示「改写后 N 字（原文 M 字）」（两个数都在） |
| ⑥ | `outputTruncated` ⇒ 显示引擎砍尾横幅，含实际字数，**且派生物形状**为 `{length:1500,max:1500}` |
| ⑦ | `modelTruncated` ⇒ 显示模型侧截断横幅，含实际字数，**且派生物形状**为 `{length:3000,truncatedSegments:[]}` |
| ⑧ | 未截断 ⇒ 两条横幅都不出现，但字数行存在 |
| ⑨ | 清空结果 ⇒ 字数行与横幅一并复位（不残留上一轮提示） |

> ⑥⑦ 断言**派生对象形状**而不只是渲染文案（外部评审 i6）：纯函数自身有单测，
> 但页面上的派生值形状隔着 `applyRewriteMeta` 这一层，此前没有任何东西锁它——
> 字段名漂移会让横幅静默不显示。

### 8.3 新增独立模块的单测（`packages/rewrite-engine/tests/word-count-instruction.test.js`，4 例）

| 编号 | 断言 |
|------|------|
| ① | `min>0` ⇒ 指令是「控制在 {min} 到 {max} 字之间」，且**不含**「不得超过」 |
| ② | `min=0` ⇒ 含「不得超过 {max} 字」+「目标篇幅约 {原文} 字」+「不要把原文压缩成摘要」，且**不含**「0 到 6000」 |
| ③ | 目标篇幅 = min(原文, 上限)；原文长度未知（undefined / 0 / 负数）⇒ 取上限 |
| ④ | 上限低于原文时，指令里**不得出现原文长度**（否则模型会写出超限稿） |

### 8.4 门禁

`check-debt-budget`（filesOver500 95 = 95）· `check-max-lines`（无新增超大文件）·
`check-unwired-tests` · `check-no-brand-residue` · `check-locale-button-name-sync` ·
`check-ui-wired` · `check-field-consumed` · `check-text-encoding-integrity` ·
`i18n.test.js`（zh/en 键成对）——全部 rc=0。

---

## 9. 验收标准

- [x] 采集页把 0-6000 送进引擎的 `wordCountRange`（`targetWordCount` 不复存在）；
- [x] `min=0` 不被改写成 800（区间取自与校验同源的 `range`）；
- [x] 浮点区间在引擎侧与前端侧都被拒（外部评审 i1）；
- [x] 引擎 `min=0` 的指令不再出现「0 到 N 字之间」，改为上限 + 目标篇幅 + 反摘要约束；
- [x] `min>0` 的指令形态逐字不变（不回归 `/rewrite` 页）；
- [x] 采集页显示「改写后 N 字（原文 M 字）」；
- [x] 引擎砍尾 / 模型侧截断两条横幅分型可见，且派生物形状被测试锁住（外部评审 i6），清空后不复位残留；
- [x] 采集页字数错误文案与真实合法域（0-49999 / 1-50000）一致；
- [x] 引擎全量 268 例、桌面端采集/改写相关 116+ 例全绿；
- [x] 外部双家族评审（opencode proposer + claude critic）完成，5 条争议逐条裁定并回填裁决记录；
- [x] 全部门禁脚本 rc=0。

---

## 10. 外部双家族评审结论（QM-6）

| 项 | 值 |
|----|----|
| 评审入口 | `sh scripts/deep-review.sh`（pre-commit 的 `ccg-review-decider` 判定 mode=dual，变更 367 行 > 200 行阈值） |
| 跨家族校验 | proposer=**opencode** / critic=**claude**，两个后端均经 `codeagent-wrapper` 实际执行（`--check-deps` 体检通过） |
| critic 结论 | 4 个维度（correctness 7 / security 9 / performance 9 / maintainability 6），最低分 6，产出 6 条争议项（i1-i6） |
| 收敛判定 | status=self_play（引擎第三档出口），5/5 条待裁决（i4 为 Info，引擎自动闭合） |
| 裁决 | 逐条回源码核对后裁定：**upheld 2 条（i1、i6）**、**dismissed 3 条（i2、i3、i5）** |

### 10.1 两条成立项的处理

| 编号 | 指控 | 处置 |
|------|------|------|
| i1 | 引擎不校验区间整数性，浮点会注入「1.5 到 6000 字之间」 | **已修**：引擎防御加 `Number.isInteger`（W11 锁）；前端改为从 `useWordCountValidation.range` 取值，校验口径与下发口径合一，浮点直接判非法不发 IPC |
| i6 | 页面派生值的形状无任何锁，形状漂移会让横幅静默失效 | **已修**：补断言 `toEqual({length,max})` / `toEqual({length,truncatedSegments})` |

### 10.2 三条驳回项的取证依据

| 编号 | 指控 | 驳回依据 |
|------|------|---------|
| i2 | 测试 mock `window.electronAPI` 而真实调用走 `@/api/publisher`，可能假绿 | 调用链逐层可查：`api/publisher.js:44` → `api/electron-bridge.js:113` → `:41-45` `getApi()[method](...)`，`getApi()` 即 `window.electronAPI` ⇒ mock 命中的就是真实 IPC 缝；既有 `Collection.rewrite-input-limit.test.js` 同一模式已证明参数到达调用点 |
| i3 | 引擎 `[...content].length` 与页面 `countRewriteChars` 口径可能不同 | `utils/rewrite-engine-limits.js:23-25` 的 `countRewriteChars` 实现就是 `[...String(content ?? '')].length` —— 与引擎**同一种** Unicode 码点计数；且两个数本就代表不同的量（原文长度 vs 实际输出长度） |
| i5 | 采集页可能未加载 `rewrite-page` 命名空间 | i18n 是**单一全局实例**（`i18n/index.js:89-94`），`locales/zh.js:311` 把 `rewritePage` 注册进全局 messages；本页改动前就已在用 `rewritePage.cancellingBtn`；且新用例断言渲染文本含具体数字，key 缺失时 vue-i18n 渲染原始 key ⇒ 必红 |

> 另：i4（Info）指出 `.ccg/reviews` 记录的 `sha` 指向父提交——这是 pre-commit 写判定记录时的**预期行为**
> （新提交尚未生成），引擎脚本已显式说明，不作处理。

---

## 11. 变更记录

| 日期 | 变更 | 说明 |
|------|------|------|
| 2026-10-20 | 初版 | 采集页字数区间真实生效（契约键修正 + min=0 语义 + 结果可见性 + 文案校正） |
