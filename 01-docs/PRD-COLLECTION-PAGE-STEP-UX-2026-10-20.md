# PRD：采集页「一键改写」流程可视化与字数区间放开（collection-ux-step-flow）

- 日期：2026-10-20
- 分支：`collection-ux-step-flow`
- 涉及模块：`apps/desktop`（采集页 Collection.vue / WordCountRangeInput / useWordCountValidation / collection locale）、`packages/rewrite-engine`（输出上限契约）、`apps/desktop/src/features/collection`（采集页样式层）
- 状态：实现中（本文件是实现前写下的规格，代码以本文件为准）

---

## 1. 背景与问题（用户真机反馈，2026-10-20）

用户在采集页点「一键改写」后，真实走查提出 5 条问题：

| 编号 | 用户原话 | 现象 | 性质 |
|---|---|---|---|
| P1 | 「点击『一键改写』按钮后，『一键改写』按钮变为运行状态，『采集』按钮也跟着一起改变状态。『采集』按钮应该没有变化才对。」 | 采集中途，页面顶部「采集」按钮也变成「采集中…」 | 状态耦合（bug） |
| P2 | 「当采集成功后，有文字提示采集成功，同时显示出采集到的文字。用户会误以为整个操作已经全部完成。实际上只是完成了采集，正在进行第 2 步：改写。」 | 采集成功 toast + 原文出现 ⇒ 用户以为流程结束 | 流程反馈不足（UX） |
| P3 | 「采集到的文字，和下方的选项内容，接在了一起，像是一段文字。非常不合理。」 | 原文与改写选项在同一段落里连排 | 信息分区缺失（UX） |
| P4 | 「当完成改写后，显示出的两个文本框，显示的尺寸非常小，应该是个 bug。修复为正常的尺寸。」 | 「采集原文 / 改写内容」两个 textarea 退化成浏览器默认的迷你框 | 样式失效（bug） |
| P5 | 「把上限字数输入框的数字限制放宽（当前为最大字数需为 1-6000 的整数）……如果没有，就尽量给一个非常大的值，比如 50000。」 | 采集页字数校验文案仍写 1-6000，与引擎真实上限 50000 不一致 | 契约漂移（bug） |
| P6 | 「改写的字数控制的两个数字输入框，调整为不给默认值，为空。默认让改写引擎自由发挥，不给限制。除非用户自己填写数字。」 | 默认预填 800-2000，强制窄区间改写 | 交互契约变更（UX） |

---

## 2. 根因分析

### 2.1 P4 文本框尺寸失效 —— CSS `@import` 位置（真根因）

2026-10-17 的 `collection-page-ui-ue-refine` 把采集页散落的样式从 `Collection.vue` 的 `<style scoped>` 拆到两个共享文件：

```
apps/desktop/src/features/collection/collection-page.css        （规范层）
  └─ @import './collection-page-legacy.css';                   （历史类名收编，448 行）
```

`.compare-textarea`（原文/改写对比框的尺寸规则）就在 `collection-page-legacy.css` 里。

**问题出在 `@import` 的位置**：`collection-page.css` 把 `@import './collection-page-legacy.css';` 写在**文件末尾（第 381 行，前面已有约 380 行规则）**。按 CSS 规范（CSS Syntax L3 / CSS Cascade L4），`@import` 必须出现在样式表的**所有限定规则之前**，否则**浏览器直接忽略这条 `@import`，且不报错**。

实测佐证（`@vue/compiler-sfc` 编译 `Collection.vue` 样式块）：

```
scoped= true
errors: （空）
--- imports ---
@import '../features/collection/collection-page.css';
--- compare-textarea ctx ---
（编译产物里没有任何 compare-textarea 规则 —— 它在被 import 的文件里）
```

即：Vue 的 scoped 编译**不会内联 `@import`**，样式交给构建/浏览器链路解析；而浏览器对后置 `@import` 的处理是「静默忽略」。

⇒ **结果**：`collection-page-legacy.css` 整块没进浏览器。`collection-page-legacy.css` 承载的类集体失效：

| 失效类 | 用户可见后果 |
|---|---|
| `.compare-textarea` | 两个对比文本框退化为浏览器默认尺寸（≈90×45px）—— **P4** |
| `.col-result-box` | 采集结果框没有底色/圆角，视觉上与页面连成一片 —— **P3 的帮凶** |
| `.col-chip-row` | 操作区缺少分组间距与换行 |
| `.col-compare-title` | 「采集原文 / 改写内容」小标题失去字重与间距 |

⇒ **P3 与 P4 是同一个根因的两个表现**：不是「排版没设计好」，而是「承载样式的那块 CSS 压根没加载」。

**为什么既有门禁没拦住**：`collection-page-css-contract.test.js` 的第 ③ 条判据是「消费的类必须有定义」——它只做**文本层面**的「类名在 CSS 文件里出现过」检查，**不检查这条规则会不会真的生效**。这是典型的「装饰性门禁」：门禁全绿，界面照样坏。

### 2.2 P1 状态耦合 —— `collecting` 复用

`Collection.vue` 的 `collectAndRewrite()` 在开头同时置位两个标志：

```js
oneClickRewriting.value = true
collecting.value = true   // ← 采集按钮的"运行态"由它驱动
```

而采集按钮的文案与禁用都挂在 `collecting` 上：

```html
<button data-testid="collection-collect-btn" ... :disabled="collecting || oneClickRewriting">
  {{ collecting ? $t('collection.collecting') : $t('collection.collect') }}
</button>
```

⇒ 一键改写的第 1 步（采集）复用了「采集按钮」的运行态，用户的 P1 观察完全成立。

### 2.3 P5 契约漂移 —— 文案未跟上引擎

真实上限早已统一到 **50000**（`packages/rewrite-engine` 的 `MAX_INPUT_CHARS` / `MAX_OUTPUT_CHARS`，渲染层镜像 `apps/desktop/src/utils/rewrite-engine-limits.js`），但**采集页 locale 的错误文案**仍停留在旧值：

| 位置 | 现值 | 应为 |
|---|---|---|
| `collection.wordCountMinInvalid` | 最小字数需为 **0-5999** 的整数 | 0-49999 |
| `collection.wordCountMaxInvalid` | 最大字数需为 **1-6000** 的整数 | 1-50000 |
| `rewrite-engine.contentPlaceholder` | 最多 6000 字 | 最多 50000 字 |
| `rewritePage.wordCountMinInvalid` | 0-49999（已改） | — |
| `rewritePage.wordCountMaxInvalid` | 1-50000（已改） | — |

⇒ 同一个上限，四个入口给出四种说法；用户看到的是最旧的那个。

---

## 3. 目标与非目标

### 3.1 目标

- **G1**：「一键改写」期间，「采集」按钮**不发生任何状态变化**（文案不变、仅禁用）。
- **G2**：页面上任何时刻都能看出**当前处于第几步、那一步是否完成、下一步是什么**。
- **G3**：采集到的原文与改写设置/改写结果在视觉上**分区**，不再连成一段。
- **G4**：改写完成后的两个文本框恢复到**正常可读尺寸**（≥180px 高、占满栏宽）。
- **G5**：字数区间默认**留空 = 不限制**，由引擎自由发挥；用户填写才生效。
- **G6**：全仓字数上限**统一为 50000**，文案、校验、引擎、渲染层四者一致。
- **G7**：上述每一条都有**机械判据**（测试）锁住，不靠「记得别改回去」。

### 3.2 非目标（明确不做）

- **N1**：不改「文案改写页」（`/rewrite`）的默认区间与自适应逻辑（那里是 800-2000 + 按原文长度自适应，且有 `wordCountManuallySet` 保护）。本轮只动采集页。
- **N2**：不改「批量采集」面板（`BatchCollectPanel`）的交互。
- **N3**：不改采集页其余布局（快捷区、结果列表、页签）。
- **N4**：不引入新的 UI 框架/组件库；步骤条用现有 token + 纯 CSS 实现。
- **N5**：不改策略（`strategy`）体系的 `postProcess.maxLength` 语义 —— 平台形态上限仍在，只是**用户显式填了区间时用户优先**（既有行为）。
- **N6**：不给「一键改写」增加进度百分比 —— 引擎不返回分步进度，编一个假进度比没有更糟。

---

## 4. 交互设计

### 4.1 顶部操作条

| 元素 | 常态文案 | 运行态文案 | 禁用条件 |
|---|---|---|---|
| 采集按钮 | 采集 | **采集中…**（仅 `collecting`） | `collecting \|\| rewriting \|\| oneClickRewriting` |
| 一键改写按钮 | 一键改写 | **一键改写中…**（仅 `oneClickRewriting`） | 同上 |

**规则**：两个按钮的运行态**互斥且各自独立**。一键改写期间，采集按钮保持「采集」常态（只置灰），用户一眼能看出「现在是改写阶段，不是采集阶段」。

### 4.2 流程状态机（新增 `flowStage`）

```
        点「一键改写」                采集成功                 改写成功
idle ─────────────────► collecting ──────────► rewriting ──────────► done
                          │  失败 → error         │  失败 → error
                          └──────────────────────┴──► error
```

| flowStage | 含义 | 步骤条 | 采集按钮 | 一键改写按钮 | 改写按钮 |
|---|---|---|---|---|---|
| `idle` | 未开始 / 空闲 | 两步都是 pending | 采集 | 一键改写 | 按原有规则 |
| `collecting` | 正在采集原文 | 第 1 步 active | **采集中…** | 一键改写（禁用） | 禁用 |
| `rewriting` | 已采集完，正在改写 | 第 1 步 done，第 2 步 active | 采集（禁用） | 一键改写中…（禁用） | AI 改写中…（禁用） |
| `done` | 改写完成 | 两步都 done | 采集 | 一键改写 | 可用 |
| `error` | 本轮失败 | 停在失败的那一步并标红 | 采集 | 一键改写 | 可用（可重试） |

**普通「采集」按钮**（不含改写）走 `collecting` → 回到 `idle`（不进 `rewriting`），步骤条第 2 步保持 pending。

**手动「AI 改写」按钮**（采集完成后单独点）走 `rewriting` → `done`，第 1 步显示 done。

### 4.3 步骤条（新增区块，采集结果框顶部）

视觉：两个圆形序号 + 连接线 + 每步一行状态说明。

```
 ①  采集正文                                        ← 序号圆点（灰=未开始 / 主色=进行中 / 绿勾=完成）
 │  ────────────────────────────────────────────
 ②  AI 改写                                         ← 连接线（未到达时灰，已到达时主色）
    正在改写，请稍候…                                ← 步骤说明（随状态变化）
```

| 状态 | 序号圆点 | 步骤标题 | 步骤说明 |
|---|---|---|---|
| pending | 灰底灰字 | 正常 | — |
| active | 主色底 + 旋转指示 | 加粗 | `正在采集原文…` / `正在改写，请稍候…` |
| done | 绿底 + 对勾 | 正常 | `已采集 {count} 字` / `改写完成，可保存草稿或直接发布` |
| error | 红底 + 感叹号 | 正常 | `采集失败，请重试` / `改写失败，请重试` |

**显示条件**：有采集结果、或流程正在进行、或本次流程失败过 —— 三者任一成立即显示。空白态不显示步骤条（避免一进页面就看到"待办"）。

### 4.4 信息分区（采集结果框内部三块）

```
┌─ 采集结果框 ────────────────────────────────────────────────┐
│ [步骤条] ① 采集正文 ── ② AI 改写                            │
│ ┌─ 区块 A：采集到的原文 ──────────────────────────────────┐ │
│ │ 标题：采集到的原文        元信息：平台 · 字数 · 有封面   │ │
│ │ 正文预览（可滚动，固定高度 ≈120px，独立边框/底色）       │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ 区块 B：改写设置 ──────────────────────────────────────┐ │
│ │ 改写策略（自动/手动）                                     │ │
│ │ 创建草稿 / 加入爆款库 / 结合爆款库 / 结合个人经历 / 语气  │ │
│ │ 字数区间： [最小] - [最大] 字   （留空 = 不限）           │ │
│ │ [AI 改写] [存入草稿] [去发布] [取消]                      │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌─ 区块 C：改写结果（rewriteResult 非空时） ──────────────┐ │
│ │ 采集原文（只读）              │ 改写内容（可编辑）        │ │
│ │ [textarea 正常尺寸]           │ [textarea 正常尺寸]       │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**分区规则**：
- A / B 之间、B / C 之间必须有**可见的分隔**（区块各自有边框 + 底色 + 内边距，块间留白 ≥ `--spacing-3`）。
- 区块 A 的正文预览**必须自带边框与底色**（`--color-bg-inset`）并限制高度 + 纵向滚动 —— 这直接消灭 P3「连成一段」。
- 区块 C 的两个 textarea：**宽度 100%、最小高度 180px、可纵向拉伸**（P4 的验收口径）。

### 4.5 字数区间输入

- 两个输入框**默认留空**（不是 0，也不是 800/2000）。
- 占位符从「最小 / 最大」升级为「最小（选填） / 最大（选填）」，并在输入组旁给一行灰色提示：**「留空 = 由 AI 自由发挥（单次上限 50000 字）」**。
- 单位后缀「字」保留。
- 输入非法时（负数 / 非整数 / 超上限）输入组下方红字提示，同时「AI 改写」按钮禁用。

---

## 5. 数据校验规则

统一真源：`apps/desktop/src/utils/rewrite-engine-limits.js`（镜像 `packages/rewrite-engine` 的 `MAX_INPUT_CHARS` / `MAX_OUTPUT_CHARS`，由 `rewrite-engine-limits.test.js` 结构锁对齐）。

| 字段 | 合法域 | 空值语义 | 错误文案键 | 文案（zh） |
|---|---|---|---|---|
| `rewriteWordCountMin` | 整数 `0 … 49999` | 空 = 不限下限 | `collection.wordCountMinInvalid` | 最小字数需为 0-49999 的整数 |
| `rewriteWordCountMax` | 整数 `1 … 50000` | 空 = 不限上限 | `collection.wordCountMaxInvalid` | 最大字数需为 1-50000 的整数 |
| 区间顺序 | `max ≥ min`（两边都填时） | 任一为空则不校验顺序 | `collection.wordCountMaxLtMin` | 最大字数不能小于最小字数 |
| 提交前 | 上述任一不合法 ⇒ 阻止提交 | — | `collection.wordCountInvalid` | 请先修正字数设置 |

**新增的「允许留空」开关**：`useWordCountValidation(minRef, maxRef, resolveError, { allowEmpty })`。
- `allowEmpty: false`（默认）= 既有严格语义（改写页沿用，行为不变）。
- `allowEmpty: true` = 采集页使用；空值不再算非法。

**留空 ⇒ 传给引擎的 `wordCountRange`**：

| 用户输入 | 传给引擎 | prompt 是否注入字数要求 | 输出硬上限来源 |
|---|---|---|---|
| 都空 | **不传 `wordCountRange`**，传 `freeformOutput: true` | **不注入** | 统一上限 `MAX_OUTPUT_CHARS` = 50000（跳过策略级 `postProcess.maxLength`） |
| 只填上限 N | `{ min: 0, max: N }` | 注入「0 到 N 字之间」 | N |
| 只填下限 N | `{ min: N, max: 50000 }` | 注入「N 到 50000 字之间」 | 50000 |
| 都填 | `{ min, max }` | 注入「min 到 max 字之间」 | max |

> **为什么需要 `freeformOutput`**：引擎 `_postProcess` 的上限优先级是
> `wordCountRange.max > 策略 postProcess.maxLength > DEFAULT_MAX_OUTPUT_LENGTH(3000)`。
> 若「不传区间」直接落回现状，用户不填数字反而会被按策略形态（800-3000）或 3000 兜底砍尾，
> 并看到「已按字数上限截断」——这与「自由发挥、不给限制」的诉求**直接矛盾**。
> 所以新增一个**显式**开关 `userSettings.freeformOutput = true`：
> - 只在「用户明确留空」时由采集页下发；
> - 引擎据此把输出上限取统一上限 `MAX_OUTPUT_CHARS`（50000），并跳过策略级 `maxLength`；
> - 其他调用方（改写页、AiWriterPanel 等）**不传该开关，行为完全不变**。

---

## 6. 流程与功能逻辑

### 6.1 「一键改写」

1. 校验：链接非空 → 字数区间合法 → 采集能力可用。
2. `flowStage = collecting`，`oneClickRewriting = true`（**`collecting` 标志不再被置位**）。
3. 采集（视频 / 反爬 stealth / 聚合三条通道，与现状一致）。
4. 采集成功 → 落地 `collectedResult`、写入列表、`flowStage = rewriting`。
   - toast 改为 **「原文采集完成，正在进行第 2 步：AI 改写」**（新增 key `collection.oneClickCollectSuccess`），
     不再使用会被误读为「全部完成」的 `collection.collectSuccess`。
5. 改写：按 §5 的字数契约组装 `userSettings` → `rewriteViaEngine`。
6. 成功 → `rewriteResult` 落地、`flowStage = done`、toast「改写完成」。
   失败 → `flowStage = error`、toast 报错、步骤条第 2 步标红、保留原文供重试。
7. 收尾：`oneClickRewriting = false`。

### 6.2 「采集」（不含改写）

1. `flowStage = collecting`，`collecting = true` ⇒ 采集按钮显示「采集中…」。
2. 成功 → 落地结果、`flowStage = idle`、toast「内容采集成功」（保持原文案：这条流程确实到采集为止就是终态）。
3. 失败 → `flowStage = error`、错误横幅 + 重试按钮。

### 6.3 手动「AI 改写」（采集完成后）

1. 校验字数区间合法。
2. `flowStage = rewriting`，`rewriting = true`。
3. 成功 → `flowStage = done`；失败 → `flowStage = error`。

### 6.4 「取消 / 清空」

`clearResult()` 复位：`collectedResult`、`rewriteResult`、`rewriteError`、`collectError`、`flowStage = idle`。

### 6.5 引擎侧（`packages/rewrite-engine`）

- `_getWordCountInstruction`：不变（`wordCountRange` 缺省 ⇒ 不注入）。
- `_postProcess` 的上限取值新增一条分支：
  `wordCountRange.max > (freeformOutput ? MAX_OUTPUT_CHARS : 策略 postProcess.maxLength) > DEFAULT_MAX_OUTPUT_LENGTH`。
  `freeformOutput` 为真时**跳过策略级 maxLength**（平台形态上限在「用户明确不设限」时不应生效）。
- 截断仍然**可见**（`outputTruncated` / `outputLength` 照旧回传，采集页据此展示截断横幅）。

---

## 7. 显示项清单

| 编号 | 显示项 | 位置 | 条件 | 文案来源 |
|---|---|---|---|---|
| D1 | 步骤条 | 采集结果框顶部 | 有结果 / 流程进行中 / 本轮失败 | `collection.step*` |
| D2 | 步骤 ① 标题 | 步骤条 | 常驻 | `collection.stepCollect` |
| D3 | 步骤 ② 标题 | 步骤条 | 常驻 | `collection.stepRewrite` |
| D4 | 步骤状态说明 | 步骤条每步下方 | 随状态 | `collection.stepCollectRunning` / `collection.stepCollectDone` / `collection.stepRewriteRunning` / `collection.stepRewriteDone` / `collection.stepCollectFailed` / `collection.stepRewriteFailed` |
| D5 | 区块 A 标题「采集到的原文」 | 采集结果框 | 有结果 | `collection.collectedContentTitle` |
| D6 | 原文字数 | 区块 A 标题右侧 | 有结果 | `collection.collectedContentCount`（参数 `{count}`） |
| D7 | 原文预览（可滚动） | 区块 A | 有结果 | 原文正文 |
| D8 | 区块 B 标题「改写设置」 | 采集结果框 | 有结果 | `collection.rewriteSettingsTitle` |
| D9 | 字数区间提示 | 字数输入组旁 | 常驻 | `collection.wordCountFreeHint` |
| D10 | 区块 C 标题「改写结果」 | 采集结果框 | 有改写结果 | `collection.rewriteResultTitle` |
| D11 | 原文 / 改写双栏文本框 | 区块 C | 有改写结果 | `collection.originalContent` / `collection.rewrittenContent` |

---

## 8. 提示文字逐字表

> 新增/变更的键（zh 与 en 必须成对且非空；未列出的既有键不变）。
>
> **命名空间归属**：本轮新增的 14 个键放在**独立命名空间 `collectionFlow`**（`locales/collection-flow/{zh,en}.js`），
> 而不是继续加在 `collection` 域里 —— `collection` 域当时已 497/498 行，逼近 `check-max-lines` 的 500 行硬限，
> 加进去会被门禁以 `NEW_OVER_LIMIT` 判红（门禁处方即「按既有范式拆分」）。
> 只有**改值**（字数上限文案 5999/6000 → 49999/50000）留在 `collection` 域。

| 键路径 | zh | en |
| --- | --- | --- |
| `collectionFlow.stepCollect` | 采集正文 | Collect the article |
| `collectionFlow.stepRewrite` | AI 改写 | AI rewrite |
| `collectionFlow.stepCollectRunning` | 正在采集原文，请稍候… | Collecting the article… |
| `collectionFlow.stepRewriteRunning` | 正在改写，请稍候… | Rewriting, please wait… |
| `collectionFlow.stepCollectDone` | 已采集 {count} 字 | {count} characters collected |
| `collectionFlow.stepRewriteDone` | 改写完成，可保存草稿或直接发布 | Rewrite done — save a draft or publish it |
| `collectionFlow.stepCollectFailed` | 采集失败，请重试 | Collection failed, please retry |
| `collectionFlow.stepRewriteFailed` | 改写失败，请重试 | Rewrite failed, please retry |
| `collectionFlow.oneClickCollectSuccess` | 原文采集完成，正在进行第 2 步：AI 改写 | Article collected — now running step 2: AI rewrite |
| `collectionFlow.collectedContentTitle` | 采集到的原文 | Collected article |
| `collectionFlow.collectedContentCount` | 共 {count} 字 | {count} characters |
| `collectionFlow.rewriteSettingsTitle` | 改写设置 | Rewrite settings |
| `collectionFlow.rewriteResultTitle` | 改写结果 | Rewrite result |
| `collectionFlow.wordCountFreeHint` | 留空 = 由 AI 自由发挥（单次上限 50000 字） | Leave blank to let the AI decide (up to 50000 characters per rewrite) |
| `collection.wordCountMinInvalid`（**改**） | 最小字数需为 0-49999 的整数 | Min must be an integer between 0 and 49999 |
| `collection.wordCountMaxInvalid`（**改**） | 最大字数需为 1-50000 的整数 | Max must be an integer between 1 and 50000 |
| `collection.wordCountMinPlaceholder`（**改**） | 最小（选填） | Min (optional) |
| `collection.wordCountMaxPlaceholder`（**改**） | 最大（选填） | Max (optional) |
| `rewriteEngine.contentPlaceholder`（**改**） | 输入需要改写的文案内容（最多 50000 字） | Enter content to rewrite (up to 50000 characters) |

---

## 9. 测试与门禁（TDD，先红后绿）

| 文件 | 锁什么 |
|---|---|
| `apps/desktop/src/features/collection/collection-page-css-contract.test.js`（改） | ① **CSS 文件里的 `@import` 必须出现在任何限定规则之前**（否则浏览器静默忽略 ⇒ 整块样式失效）；② `.compare-textarea` 必须声明 `width: 100%` 与 `min-height ≥ 180px`（尺寸回归锁） |
| `apps/desktop/src/views/Collection.step-flow.test.js`（新） | ① 一键改写期间采集按钮文案不变、仅禁用；② 流程状态机各阶段的步骤条状态与按钮态；③ 字数框默认留空、留空时不传 `wordCountRange`、留空时传 `freeformOutput: true`；④ 填了非法值时阻止提交并给错误文案 |
| `packages/rewrite-engine/tests/rewrite-engine-core.test.js`（改） | `freeformOutput: true` ⇒ 输出上限取 50000（不被策略 `maxLength` 砍尾）、`wordCountRange` 缺省 ⇒ prompt 不注入字数要求；不传该开关时行为不变 |

---

## 10. 相关文档同步

- `01-docs/PRD-REWRITE-LIMITS-50000-2026-10-19.md`：补记「采集页留空 = 自由发挥」的新契约与 `freeformOutput` 开关。
- `openspec/specs/openspec-integration/spec.md`：分层分支策略不变，无需改。
- `openspec/records/collection-ux-step-flow.md`：本次执行记录（唯一强制载体）。
- `CHANGELOG.md`：按仓库惯例追加一条。
