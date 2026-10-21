# PRD — 改写页视图解耦（RewriteView.vue 拆 composable + 外置样式）

> **文档编号**: PRD-REWRITE-VIEW-DECOMPOSITION-2026-10-21
> **立项日期**: 2026-10-21
> **关联分支**: `rewrite-view-decompose`
> **影响页面**: 文案改写页（`/rewrite`，`apps/desktop/src/views/RewriteView.vue`）
> **类型**: 重构（架构级变更，**用户可见行为不变**）
> **复杂度**: 中（1 个视图 + 3 个 composable + 1 个外置 CSS + 3 个新测试 + 2 个既有测试文件更新）

---

## 一、背景与问题

### 1.1 现象

`apps/desktop/src/views/RewriteView.vue` 实测 **1430 行**，正好等于行数门禁的**登记值**。
门禁 `growthAllowance = 200` ⇒ 该文件的硬天花板是 **1430 + 200 = 1630 行**。

也就是说：**这个文件此刻没有任何余量**。任何一次给改写页加功能（哪怕只加 201 行），
都会撞上 `LEDGER_GREW` 阻断：

```
LEDGER_GREW: apps/desktop/src/views/RewriteView.vue 较登记值 1430 膨胀 201 行（容差 200），请拆分或经审阅后 --update
```

这不是「将来可能有问题」，是**下一次改写页迭代就会红**。

### 1.2 门禁语义（先讲清，否则「减行数」这件事会被误读）

判据本体：`.github/scripts/check-max-lines.js`（逐文件行数门禁），基线：
`.github/scripts/max-lines-baseline.json`。

| 概念 | 含义 | 本文件的现状 |
|---|---|---|
| `limit` | 500 行。**超过它的源文件必须挂账登记**（`files` 表） | — |
| `files["apps/desktop/src/views/RewriteView.vue"]` | 本文件的登记值 = **1430** | 已挂账 |
| `growthAllowance` | 200。登记值 + 200 = 硬天花板 | 天花板 **1630** |
| `LEDGER_GREW` | 当前行数 − 登记值 > 200 ⇒ 阻断 | 再加 201 行即红 |
| `DEBT_REPAID_LEDGER` | 行数降到 500 以下 ⇒ 阻断（要求 `--prune` 清账） | 本次**达不到**（视图不可能压到 500 行） |
| `NEW_OVER_LIMIT` | 新文件 ≥500 行且未登记 ⇒ 阻断 | 新拆出的文件必须都 < 500 行 |

**关键结论（决定了本方案的做法）**：

1. 登记值 1430 **不能靠 `--update` 下调**（该命令只做增量登记，不动已有值；清账走 `--prune`，而 `--prune` 要求文件已降到 500 行以下）；
2. 因此「把文件写短」这件事，**收益不在于降低天花板，而在于把实际行数拉回天花板之下**：
   - 现状：实际 1430 / 天花板 1630 ⇒ **余量 200 行**；
   - 目标：实际 **977** / 天花板 1630 ⇒ **余量 653 行**；
3. 拆出的新文件必须 **< 500 行**，否则会触发 `NEW_OVER_LIMIT`（本次三个 composable + 一个 CSS 全部满足）。

### 1.3 另一个被这次重构顺带解决的账

聚合债务门禁 `scripts/check-debt-budget.js` 持有另一份账：

| 指标 | 现状 | 本次之后 |
|---|---|---|
| `filesOver1000` | 29 | **28**（RewriteView.vue 降到 1000 行以下） |
| `maxFileLines` | 5359（`CreateView.vue`） | 不变 |

即：本次改动让「≥1000 行的文件数」这个**全仓聚合债务指标**实打实降了 1。
（该门禁是棘轮式：只挡增长，改善不报错。）

### 1.4 仓库里已有的同类先例

| 先例 | 做法 | 本次沿用 |
|---|---|---|
| `composables/useRewriteCancel.js` | 取消通道（runId 生命周期）从视图拆出 | ✅ 同一形状：composable + 视图只留守卫 |
| `components/RewriteStrategyPicker.vue` | 策略选择的**展示层**已拆出 | ✅ 本次补上它的**数据层** |
| `components/WordCountRangeInput.vue` | 字数区间的**输入控件**已拆出 | ✅ 本次补上它的**状态层** |
| `views/HotTopics.vue` / `views/film-auto/FilmAutoPanel.vue` | `<style scoped src="./xxx.css">` | ✅ 本次外置样式 |

`useRewriteCancel.js` 的文件头注释已经写下了这条结论：

> 为什么独立：`RewriteView.vue` 已接近 max-lines 登记容差；取消逻辑……与视图的渲染职责无关。

**本次是把那句注释里的承诺兑现，并再拆三块。**

### 1.5 为什么现在做（触发点）

- PR #4141（`fix-rewrite-warning-severity`）的 CHANGELOG 已把结论写进仓库：
  「`RewriteView.vue` 持续贴住行数上限（1430/1630）的解法是**拆 composable**，本次已做 `useRewriteCancel`（本次 QM-4 审阅未通过，故 9 项失败未修），但 PR 未落地。」
- 也就是说：仓库自己已经记账说「下一刀该拆了」，只是那一刀被 QM-4 打回没落地。本次把那一刀补上。

---

## 二、目标与非目标

### 2.1 目标

| # | 目标 | 可验证的判据 |
|---|---|---|
| G1 | `RewriteView.vue` 降到 **1000 行以下** | 实测 **977 行**；`filesOver1000` 29 → 28 |
| G2 | 为后续改写页迭代腾出 **≥ 600 行**余量 | 1630 − 977 = **653 行** |
| G3 | **用户可见行为零变化** | 既有 `RewriteView.test.js`（含 4+1 条视觉契约）与 3 个专项测试文件全绿；**模板一行未改** ⇒ 渲染结果按定义不变 |
| G4 | 拆出的每一块都有**独立回归锁** | 3 个新测试文件，共 **29 例**（7 + 14 + 8） |
| G5 | 门禁账目真实改善 | `check-max-lines.js` 与 `check-debt-budget.js` 双 rc=0，且聚合 `filesOver1000` 下降 |

### 2.2 非目标（明确**不做**什么）

| # | 不做的事 | 理由 |
|---|---|---|
| N1 | **不**改任何用户可见行为、文案、交互顺序、视觉 | 本次是纯重构。改行为属另开 PRD 的事 |
| N2 | **不**把 `aiRewrite` 调用与归因链（`extractRewriteHistoryId` / `attachRewriteLineage`）搬进 composable | `utils/rewrite-lineage.test.js` 的「单一实现结构锁」要求四个改写入口文件里能读到 `aiRewrite(` 与 `utils/rewrite-lineage` 的引用。搬走 = 结构锁失效 |
| N3 | **不**把「文本出期（播客）入口」搬走 | `views/CopyLibraryView.test.js` 的结构合同要求 `RewriteView.vue` 源码里能读到 `podcast.activeChannelId.value`，并禁止出现 `\|\| await ensureChannel()` 死分支 |
| N4 | **不**拆模板成子组件 | 父组件的 `scoped` 样式**不作用于子组件内部元素**（只对父组件模板里的元素加 scope id）。把 `.mode-chip` / `.config-switch` 等样式留在父级、模板搬进子组件 ⇒ 样式直接失效。要拆模板就得连样式一起搬，等于把一次重构变成一次视觉重写，风险与收益不成比例 |
| N5 | **不**改全局设计系统（`styles/cohere-design-system.css`） | 那是另一个共享面，改它会波及全站 |
| N6 | **不**下调 `max-lines-baseline.json` 里本文件的登记值 | 登记值下调超出工具能力（`--update` 不降已有值、`--prune` 要求 <500 行），手工改基线属「改谁来守门」，需人工过目。本次靠「把文件写短」拿到余量，效果等价且不动门禁数据 |
| N7 | **不**新增/删除任何 i18n key | 提示文字零变化（见 §五 / §六 / §七的「提示文字」小节） |
| N8 | **不**改 djb2 回写 key 算法 | 改了会让历史上按 djb2 写入的文案库记录全部失联 |
| N9 | **不**全局抬高 `testTimeout` | 会让真正挂死的用例也跟着放宽（见 §十.3） |

---

## 三、现状：文件的四段构成

| 段 | 行范围 | 行数 | 职责 | 问题 |
|---|---|---|---|---|
| `<template>` | 1–366 | 366 | 输入区 / 配置区 / 结果区三段渲染 | 结构清晰，**不动**（N4） |
| `<script setup>` | 368–1106 | 739 | 状态 + 副作用 + IPC | 混装四类职责，是本次主要动刀处 |
| `<style scoped>` | 1108–1428 | 321 | 纯展示 | 与逻辑零耦合，却占了 22% 的行数 |
| 合计 | — | **1430** | — | 触顶 |

`<script setup>` 内部实际混装的四类职责：

| 职责 | 现状位置 | 归属模块（本次） |
|---|---|---|
| 字数区间（状态 + 校验 + 自适应） | 456–460、720–721、735–740、752–756 | → `useRewriteWordCount` |
| 策略（列表 + 预览 + 竞态 + 防抖） | 462–467、595–650 | → `useRewriteStrategy` |
| 文案库回写（两条互斥写入路径） | 528–584、912–916 | → `useRewriteLibrarySync` |
| 改写执行 / 结果解析 / 归因链 / 目的地跳转 | 其余 | **留在视图**（N2 / N3） |

---

## 四、方案总览

### 4.1 拆分清单

| 新文件 | 内容 | 实测行数 | 视图减少 |
|---|---|---|---|
| `apps/desktop/src/views/rewrite-view.css` | 全部 `<style scoped>` 内容（原样迁移） | 320 | −320 |
| `apps/desktop/src/composables/useRewriteWordCount.js` | 字数区间状态 + 校验接线 + 自适应推导 | 67 | −15 |
| `apps/desktop/src/composables/useRewriteStrategy.js` | 策略列表 + 预览 + 竞态守卫 + 防抖（i1 修复后含 effectScope 归属） | 142 | −58 |
| `apps/desktop/src/composables/useRewriteLibrarySync.js` | 文案库两条回写路径 + djb2 哈希 | 94 | −60 |
| — | 视图内的 import / 调用接线 | — | +11 |
| **合计** | — | — | **≈ −453** |

> 行数口径与门禁一致：`split('\n').length`（`check-max-lines.js` 的同一算法），含末行空行。

**实测 `RewriteView.vue` 从 1430 行降到 977 行**（余量从 200 行扩大到 653 行）。

### 4.2 视图与模块的依赖方向

```
RewriteView.vue（编排层：状态 → 动作 → 渲染）
   │
   ├─ useRewriteWordCount   ← 持有 min/max/error；不读其它状态
   ├─ useRewriteStrategy    ← 只读：platform / industry / purpose / tone / content / rewriting
   ├─ useRewriteLibrarySync ← 只读：rewriteResult / rewriteTitle / platform
   └─ useRewriteCancel（既有，本次不动）
```

**依赖方向是单向的**：模块不反向依赖视图，模块之间也不互相依赖。
视图是唯一的编排者。模块全部是「读入 ref、产出 ref 与动作」的无状态装配层。

---

## 五、模块一：`useRewriteWordCount`（字数区间）

**文件**：`apps/desktop/src/composables/useRewriteWordCount.js`
**单测**：`apps/desktop/src/composables/useRewriteWordCount.test.js`（7 例）

### 5.1 数据模型

| 名称 | 类型 | 初值 | 说明 |
|---|---|---|---|
| `wordCountMin` | `Ref<number>` | `800` | 最小字数（绑定 `WordCountRangeInput` 的 `v-model:min`） |
| `wordCountMax` | `Ref<number>` | `2000` | 最大字数（绑定 `v-model:max`） |
| `wordCountError` | `ComputedRef<string>` | `''` | 校验结论，空串 = 合法 |
| `wordCountManuallySet` | 模块内 `let` | `false` | 「用户手动改过」记忆位（**不导出**，只能经动作置位） |
| `markWordCountManuallySet()` | `() => void` | — | 置位记忆位 |
| `applyWordCountDefaults(trimmed)` | `(string) => void` | — | 按输入形态自适应（记忆位已置位则**不动**） |

### 5.2 数据校验（逐条：判据 → 阈值 → 错误 key → 提示文字）

校验实现在**共享的** `composables/useWordCountValidation.js`（与采集页同一份实现），
本模块只做接线。文案解析器由调用方注入：视图传 `(key) => t('rewritePage.' + key)`。

| # | 判据 | 阈值 | 错误 key | 中文提示 | 英文提示 |
|---|---|---|---|---|---|
| V1 | 最小值为空（`''` / `null` / `undefined`） | — | `wordCountMinInvalid` | 最小字数需为 0-49999 的整数 | Min must be an integer between 0 and 49999 |
| V2 | 最小值非整数 | `< 0` 或 `> 49999` 或非整数 | `wordCountMinInvalid` | 同上 | 同上 |
| V3 | 最大值为空 | — | `wordCountMaxInvalid` | 最大字数需为 1-50000 的整数 | Max must be an integer between 1 and 50000 |
| V4 | 最大值非整数 | `< 1` 或 `> 50000` 或非整数 | `wordCountMaxInvalid` | 同上 | 同上 |
| V5 | 最大值 < 最小值 | — | `wordCountMaxLtMin` | 最大字数不能小于最小字数 | Max cannot be less than min |

**阈值来源**：上界单一真源 = `REWRITE_ENGINE_MAX_OUTPUT_CHARS`（50000，来自
`utils/rewrite-engine-limits.js`），下限上界 = `REWRITE_ENGINE_MAX_INPUT_CHARS - 1`（49999）。
**不在本模块写死数字。**

**语义边界（写死，防回归）**：

- **严格模式**（`allowEmpty` 不开）：任一侧为空即非法。采集页的「留空 = 这一侧不设限」语义**不适用于**改写页，调用方不得顺手传 `allowEmpty`。
- **校验与下发同源**：`wordCountError` 与改写请求下发的 `wordCountRange` 取的是**同一对 ref**，不可能出现「校验用的值」与「下发用的值」是两套口径（`collect-rewrite-wordcount` 的同型教训：用户设的下限 0 被 `|| 800` 吞掉）。

### 5.3 流程（改写前的一次完整流转）

```
用户点「开始改写」
   │
   ├─ content 为空？ ── 是 ──▶ contentError = t('rewritePage.contentEmpty')，直接返回（不改写）
   │
   ├─ wordCountError 非空？ ── 是 ──▶ 直接返回（按钮本就是禁用的，这里是双保险）
   │
   ├─ ensureLogin() ── 未通过 ──▶ 返回
   │
   ├─ applyInputDerivedDefaults(trimmed)
   │     ├─ 未手动改过模式 ⇒ rewriteMode = deriveDefaultMode(trimmed)
   │     │     成稿（≥80 字，或 12–80 字带多段/≥2 个句号）⇒ imitate
   │     │     选题种子（≤12 字）⇒ create
   │     └─ 未手动改过字数 ⇒ applyWordCountDefaults(trimmed)
   │            原文 < 2000 字 ⇒ 固定 800-2000
   │            原文 ≥ 2000 字 ⇒ min = 原文长度 × 0.6（取整到百位），
   │                              max = 原文长度 × 1.2（取整到百位），
   │                              两者夹到 [200, 50000]，并保证 min ≤ max
   │
   ├─ 重新校验 wordCountError（推导后不得引入非法区间）─ 非空 ──▶ 返回
   │
   └─ 组装 aiRewrite 参数（见 §5.4）并发起
```

### 5.4 功能逻辑（与改写请求的接口）

改写请求中与字数相关的字段**只有一处**：

```js
userSettings: {
  // …
  wordCountRange: {
    min: Number(wordCountMin.value),
    max: Number(wordCountMax.value),
  },
  // …
}
```

`Number(...)` 的作用是把 `v-model.number` 留下的字符串转回数字；**不得**再叠一层
`|| 800` 之类的假值兜底（`0` 是合法下限，会被 `||` 吞掉）。

### 5.5 交互逻辑

| 交互 | 行为 |
|---|---|
| 用户在「最小字数」框输入 | `v-model:min` 更新 `wordCountMin`；同时触发 `markWordCountManuallySet()`（模板上 `@update:min` / `@update:max` 绑定）⇒ 记忆位置位 |
| 用户在「最大字数」框输入 | 同上（`v-model:max` + `@update:max`） |
| 用户清空某一侧 | 该侧变 `''` ⇒ 校验立刻报 V1/V3 ⇒ 错误文案显示在输入组下方（独占一行），「开始改写」按钮禁用 |
| 改写进行中 | 整个字数控件 `:disabled="rewriting"`（不可编辑） |
| 用户手动改过之后又点「开始改写」 | 自适应推导**不再执行**（记忆位已置位）⇒ 用户设的上限不会被悄悄改回 |
| 用户一次都没改过就点「开始改写」 | 按原文长度自适应（长文不被硬截 60%） |

**「手动置位」的记忆位是单向的**：一旦置位不会自动解除（直到页面重新挂载）。
这是有意的——用户显式表达过的意图，任何后续启发式都不得覆盖。

### 5.6 显示项

| 位置 | 内容 | 来源 |
|---|---|---|
| 配置卡 · 字数控制 | 标签「字数控制」 | `t('rewritePage.wordCountLabel')` |
| 配置卡 · 字数控制 | 两个输入框，占位「最小」/「最大」，后缀单位「字」 | `wordCountMinPlaceholder` / `wordCountMaxPlaceholder` / `wordCountUnit` |
| 配置卡 · 字数控制 | 校验错误独占一行 | `wordCountError` |
| 结果卡 · 元信息 | 「原文 {original} 字 → 结果 {result} 字」 | `t('rewritePage.metaLength')`（`create` 模式改用 `metaLengthFromTopic`：「主题 {original} 字 → 结果 {result} 字」） |
| 结果卡 · 截断横幅 | 「改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字）……」 | `t('rewritePage.outputTruncated')` |

### 5.7 提示文字（本次**零改动**，逐条列出以备回归比对）

| key | 中文 | English |
|---|---|---|
| `rewritePage.wordCountLabel` | 字数控制 | — |
| `rewritePage.wordCountMinPlaceholder` | 最小 | — |
| `rewritePage.wordCountMaxPlaceholder` | 最大 | — |
| `rewritePage.wordCountUnit` | 字 | chars |
| `rewritePage.wordCountMinInvalid` | 最小字数需为 0-49999 的整数 | Min must be an integer between 0 and 49999 |
| `rewritePage.wordCountMaxInvalid` | 最大字数需为 1-50000 的整数 | Max must be an integer between 1 and 50000 |
| `rewritePage.wordCountMaxLtMin` | 最大字数不能小于最小字数 | Max cannot be less than min |
| `rewritePage.outputTruncated` | 改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字），原文后半部分未包含在结果中。如需完整改写，请调大「字数控制」上限。 | （en 见 `locales/rewrite-page/en.js`） |

---

## 六、模块二：`useRewriteStrategy`（策略选择）

**文件**：`apps/desktop/src/composables/useRewriteStrategy.js`
**单测**：`apps/desktop/src/composables/useRewriteStrategy.test.js`（14 例 = 12 例行为契约 + 2 例 i1 回归锁）

### 6.1 数据模型

| 名称 | 类型 | 初值 | 说明 |
|---|---|---|---|
| `strategyMode` | `Ref<'auto'\|'manual'>` | `'manual'` | 默认**手动选择**（2026-09-15 调整，降低发现成本；未选时仍传 `null` 走引擎自动匹配） |
| `rewriteStrategyId` | `Ref<string>` | `''` | 手动模式下选中的策略 id（空串 = 未选） |
| `rewriteStrategies` | `Ref<Array>` | `[]` | 启用策略列表（内置 + 远程下发） |
| `previewStrategyName` | `Ref<string>` | `'--'` | 自动模式下「将匹配策略」的预览名 |
| `loadRewriteStrategies()` | `() => Promise<void>` | — | 加载启用策略 |
| `refreshStrategyPreview()` | `() => Promise<void>` | — | 刷新自动匹配预览 |
| `previewSeq` | 模块内 `let` | `0` | 预览请求序列号（竞态守卫） |
| `contentPreviewTimer` | 模块内 `let` | `null` | 正文防抖定时器 |

**入参（只读）**：`platform` / `industry` / `purpose` / `tone` / `content` / `rewriting` 六个 ref。

### 6.2 数据校验

策略选择本身**无数值校验**，但有三条**取值合法性**判据：

| # | 判据 | 处理 |
|---|---|---|
| S1 | `aiListRewriteStrategies` 返回非 0 / 抛异常 | 策略列表保持 `[]`，**静默降级**（改写仍可用，走自动匹配） |
| S2 | `aiGetRecommendedStrategies` 返回空数组 / 非 0 / 抛异常 | 预览名降级为 `'--'`，**不阻塞改写** |
| S3 | 预览请求返回的 `data[0].name` 缺失/非字符串 | 预览名降级为 `'--'` |

**下发合法性**（`startRewrite` 侧，本模块只提供状态）：

| 模式 | `strategyId` 下发值 |
|---|---|
| `manual` | `rewriteStrategyId.value \|\| null`（未选 ⇒ `null`） |
| `auto` | 恒为 `null`（走引擎匹配） |

### 6.3 流程

```
挂载
 ├─ loadRewriteStrategies()        → 写 rewriteStrategies（失败 ⇒ 保持 []）
 └─ refreshStrategyPreview()        → 写 previewStrategyName（失败 ⇒ '--'）

设置项变化（platform / industry / purpose / tone）
 └─ refreshStrategyPreview()        ← **立即**（离散低频动作，不防抖）
      └─ 请求序号 seq = ++previewSeq
      └─ await aiGetRecommendedStrategies(userSettings, content.trim())
      └─ if (seq !== previewSeq) return   ← 竞态守卫：过期结果不渲染

正文变化（content）
 └─ scheduleContentPreview()        ← **300ms 防抖**
      └─ 连续键入合并 → 停顿 300ms 后 refreshStrategyPreview() 一次

改写结束（finally）
 └─ refreshStrategyPreview()        ← 引擎的 userHistory 变了，推荐可能变
```

### 6.4 功能逻辑

**预览请求与改写请求必须用同一套 `userSettings`**（否则预览名与实际命中策略漂移）：

```js
aiGetRecommendedStrategies({
  platform: platform.value || undefined,
  industry: industry.value || undefined,
  purpose:  purpose.value  || undefined,
  tone:     tone.value     || undefined,
}, content.value.trim())
```

- `|| undefined` 的作用：空串表示「未指定」，**不得**把空串下发（空串不是「未指定」的同义词）；
- 第二个参数是 `content.trim()`，必须与 `startRewrite` 下发的正文口径一致。

**两条独立的节流机制，缺一不可**：

| 机制 | 防的是什么 | 实现 |
|---|---|---|
| 竞态守卫（`previewSeq`） | 快速切换平台时，**慢的旧响应覆盖快的新响应** | 请求前取号，响应回来先对号 |
| 正文防抖（300ms） | 逐字输入变成**逐字请求** | `watch(content)` → `setTimeout(…, 300)`，新输入重置定时器 |

⚠️ 竞态守卫**只保证「过期结果不渲染」，拦不住请求本身** —— 这正是需要防抖的原因。两者缺一都会出问题。

### 6.5 交互逻辑

| 交互 | 行为 |
|---|---|
| 选「自动匹配」 | 预览区出现，显示「将匹配策略：{名称}」；`strategyId` 下发 `null` |
| 选「手动选择」 | 策略下拉出现；未选时下发 `null`；选中后下发所选 id |
| 切换目标平台 / 行业 / 目的 / 语气 | 预览**立即**刷新（携带新的四项设置） |
| 连续键入正文 | 预览**延迟 300ms** 刷新（合并为一次请求） |
| 粘贴长文但没动下拉 | 预览仍会刷新（`content` 也在 watch 里）⇒ 预览名与实际命中策略不漂移 |
| 改写进行中 | `rewriting === true` ⇒ `refreshStrategyPreview()` **直接返回**，不发起请求（避免与改写请求抢 IPC） |
| 改写结束后 | 自动刷新一次（引擎的用户历史变了，推荐可能变） |
| 策略列表加载失败 | 下拉只剩占位项「-- 选择策略 --」，改写仍可发起 |
| 改写进行中 | 策略选择器整体 `:disabled="rewriting"` |

### 6.6 显示项

| 位置 | 内容 | 来源 |
|---|---|---|
| 配置卡 · 策略 | 标签「改写策略」 | `t('rewritePage.strategyLabel')` |
| 配置卡 · 策略 | 两个单选：「自动匹配」/「手动选择」 | `strategyAuto` / `strategyManual` |
| 配置卡 · 策略（auto 模式） | 「将匹配策略：{名称}」，名称为 `--` 时显示占位 | `strategyPreview` + `strategyPreviewColon` + `previewStrategyName` |
| 配置卡 · 策略（manual 模式） | 下拉，首项为占位「-- 选择策略 --」，其余为策略名 | `strategySelectPlaceholder` + `rewriteStrategies[].name` |

### 6.7 提示文字（本次**零改动**）

| key | 中文 | English |
|---|---|---|
| `rewritePage.strategyLabel` | 改写策略 | — |
| `rewritePage.strategyAuto` | 自动匹配 | — |
| `rewritePage.strategyManual` | 手动选择 | — |
| `rewritePage.strategyPreview` | 将匹配策略 | — |
| `rewritePage.strategyPreviewColon` | ： | — |
| `rewritePage.strategySelectPlaceholder` | -- 选择策略 -- | — |

---

## 七、模块三：`useRewriteLibrarySync`（文案库回写）

**文件**：`apps/desktop/src/composables/useRewriteLibrarySync.js`
**单测**：`apps/desktop/src/composables/useRewriteLibrarySync.test.js`（8 例）

### 7.1 数据模型

**入参（只读）**：`rewriteResult` / `rewriteTitle` / `platform` 三个 ref。

| 动作 | 说明 |
|---|---|
| `syncHandoffToLibrary(handoff)` | 交接场景回写：按 `handoff.fromKey` 覆盖原记录 |
| `syncResultToLibrary()` | 普通场景回写：按 `rewrite:<正文哈希>` 写入 |
| `hashString(str)` | 模块内 djb2 哈希（不进 API） |

### 7.2 数据校验

| # | 判据 | 处理 |
|---|---|---|
| L1 | `handoff` 为 `null` / 无 `fromKey` | **不写**（不得落一条无主记录） |
| L2 | `rewriteResult` 为空 / 纯空白 | **不写**（不得把空串写进文案库） |
| L3 | 写入抛异常 | **静默吞掉**（改写已经成功了，不得把异常抛给主流程） |

### 7.3 流程（改写成功后的旁路）

```
改写成功（res.data.success）
   │
   ├─ handoffForRun 存在且有 fromKey？
   │     ├─ 是 ──▶ syncHandoffToLibrary(handoffForRun)   ← 按 fromKey 覆盖原记录
   │     └─ 否 ──▶ syncResultToLibrary()                  ← 按正文哈希写入
   │
   └─ 两条路径**互斥**（双模型评审 MAJOR-2/3：两条都走会让同一次改写落双份记录）
```

> 交接载荷在 `startRewrite` 发起时即被消费掉（无论成败），防止失败后残留的 `fromKey`
> 被后续无关改写静默覆盖文案库记录。

### 7.4 功能逻辑

| 场景 | `fromKey` | `fromTitle` | `title` | `content` | `platform` | `sourceUrl` |
|---|---|---|---|---|---|---|
| 交接场景 | `handoff.fromKey`（如 `collect:rec_1`） | `handoff.fromTitle \|\| ''` | `rewriteTitle \|\| handoff.title \|\| ''` | `rewriteResult` | `handoff.platform \|\| ''` | `handoff.sourceUrl \|\| ''` |
| 普通场景 | `'rewrite:' + djb2(rewriteResult)` | `''` | `rewriteTitle \|\| ''` | `rewriteResult` | `platform \|\| ''` | `''` |

**为什么普通场景用正文哈希做 key**：同一正文连续改写视为**更新（覆盖）**，不同正文**追加**新记录
—— 否则文案库会被同一篇原文的反复改写刷屏。

**为什么 djb2 而不是更强的哈希**：这里要的是「同一正文稳定同 key」的**幂等键**，不是抗碰撞的
密码学摘要；且这段逻辑必须与既有存储里的既有 key 形态保持一致（**改 key 算法 = 既有记录全部变孤儿**）。
⚠️ 这是本次**明确不改**的算法（N8）：改它会让历史上按 djb2 写入的记录失联。

### 7.5 交互逻辑

回写是**旁路**：不阻塞改写主流程、不弹提示、不影响结果区渲染。用户在改写成功提示
（`collection.rewriteSuccess`）之后自行去文案库查看。

### 7.6 显示项

本模块**不产生任何界面元素**。它的可观察面只有文案库面板里的记录列表。

### 7.7 提示文字

本模块**不产生任何提示文字**（失败静默）。

---

## 八、样式外置：`rewrite-view.css`

### 8.1 做法

```vue
<style scoped src="./rewrite-view.css"></style>
```

Vue SFC 编译器对 `src` 引用的样式文件**同样施加 scope id** ⇒ 作用域语义与内联 `<style scoped>` **完全一致**。
仓库已有 5 处同型用法（`HotTopics.vue` / `HotTopicsFavorites.vue` / `film-auto/FilmAutoPanel.vue` / `MpSidebar.vue` 等）。

### 8.2 迁移内容（320 行，**逐条原样迁移，零改写**）

| 组 | 选择器（节选） | 备注 |
|---|---|---|
| 卡片与标题 | `.rewrite-input-card` / `.rewrite-config-card` / `.rewrite-result-card` / `.cohere-section-title` | 含 `cursor: default` 等语义 |
| 内容依据开关 | `.config-switches` / `.config-switch` / `.switch-body` / `.switch-title` | 含勾选框固定尺寸修复 |
| 字段行 | `.rewrite-config-card :deep(.cohere-form-label)` / `.mode-chips` / `.mode-chip` | **含 `:deep()`** |
| 字数区间 | `.config-row :deep(.word-count-label:empty)` / `.config-row :deep(.word-count-error)` | **含 `:deep()`** |
| 网格布局 | `.config-grid` / `.config-grid--three` | 含两条 `@media` |
| 策略选择器 | `.rewrite-config-card :deep(.strategy-radio)` 等 3 条 | **含 `:deep()`** |
| 执行区 | `.rewrite-submit` | |
| 结果区 | `.rewrite-result-title*` / `.rewrite-output-truncated-banner` | |
| 质量评估 | `.rewrite-quality-report` / `.quality-accent-*` / `.rewrite-quality-metrics` / `.quality-metric` | 含三态配色 |
| 复制与动作行 | `.rewrite-copy-row` / `.rewrite-copy-btn` / `.rewrite-result-actions .cohere-btn-secondary` | |

**`:deep()` 的语义不变**：`:deep(.x)` 表示「匹配**后代**（含子组件内部）的 `.x`」。
`scoped` + `src` 与 `scoped` 内联对 `:deep()` 的编译结果相同。

### 8.3 视觉契约测试的同步改造（必须做，否则门禁假红）

`apps/desktop/src/views/RewriteView.test.js` 的 `describe('RewriteView — 视觉契约')` 块
**直接读 `RewriteView.vue` 源码**并用正则匹配 CSS 规则体：

```js
const source = fs.readFileSync(path.resolve(process.cwd(), 'src/views/RewriteView.vue'), 'utf8')
function ruleBody (selector) { /* 正则抽规则体 */ }
```

样式外置后，CSS 不再在 `.vue` 里 ⇒ 这 4 条用例会**读不到规则体而红**。

**改造方案（保留锁的意图，只换读取对象）**：

1. 规则体匹配改为读 `src/views/rewrite-view.css`；
2. **额外加一条**「`.vue` 必须仍然引用该 CSS 文件」的断言 —— 防止样式文件被改成孤儿
   （CSS 文件还在、但 `.vue` 不引它 ⇒ 页面裸奔，而原来的锁会一直绿）；
3. **额外加一条**「`.vue` 里不得再有内联 `<style scoped>`」的断言 —— 防止出现两份真相。

> 这是本次唯一需要改动的既有测试文件。改动的是**读取对象**，不是**被锁的契约**：
> 4 条视觉契约（勾选框固定尺寸 / 卡片回归静态容器语义 / 质量评估左侧强调条 / 卡片标题字号层级）**一条不减**。

### 8.4 明确不做

- **不**改任何选择器、属性值、注释；
- **不**动 `styles/cohere-design-system.css`（全局面，N5）；
- **不**把 `:deep()` 改写成全局选择器（会扩大作用域 ⇒ 污染其它页面）。

---

## 九、视图的最终结构

```
apps/desktop/src/views/RewriteView.vue            （977 行）
├── <template>                                     （366 行，DOM 逐条不变）
│   ├── 输入区（标题参考 chip / textarea / 字数统计）
│   ├── 配置区（内容依据开关 / 改写模式 / 字数控制 + 目标平台 / 行业·目的·语气 / 策略选择 / 执行区）
│   └── 结果区（截断横幅 ×2 / 敏感词警告 / 元信息 / 质量报告 / 标题 / 结果框 / 动作行）
├── <script setup>                                 （≈ 609 行）
│   ├── 状态：content / rewriting / 结果态 / 归因链 / 弹窗 / 交接载荷
│   ├── 组合子：useRewriteCancel（既有）/ useRewriteWordCount / useRewriteStrategy / useRewriteLibrarySync
│   ├── 动作：startRewrite / cancelRewrite / copyResult / saveToDraft / goToPublish / goToVideoCreate / openScriptEntry
│   └── 副作用：watch(rewriteResult) / onMounted / onUnmounted
└── <style scoped src="./rewrite-view.css"></style> （1 行）
```

---

## 十、行为不变清单（回归锁）

### 10.1 既有测试（**必须全绿**）

| 文件 | 覆盖 | 本次是否改动 |
|---|---|---|
| `views/RewriteView.test.js` | 主流程、模式推导、字数区间、策略匹配与竞态、爆款信号、文案库交接、视觉契约（4 条） | **改了**（视觉契约改读 CSS + 加 1 条防孤儿断言；其余用例一字未动） |
| `views/RewriteView.sensitive-warning.test.js` | 敏感词 warning 级提示 | **改了**（加 `beforeAll` 编译预热，见 §10.3；3 条用例的断言一字未动） |
| `views/RewriteView.output-truncated.test.js` | 输出截断横幅 | 未改 |
| `views/RewriteView.cancel.test.js` | 取消通道 | 未改 |
| `utils/rewrite-lineage.test.js` | **结构锁**：四个改写入口必须能读到 `aiRewrite(` 与 `utils/rewrite-lineage` 引用（N2 的由来） | 未改 |
| `views/CopyLibraryView.test.js` | **结构锁**：`RewriteView.vue` 必须能读到 `podcast.activeChannelId.value`、不得有 `\|\| await ensureChannel()` 死分支（N3 的由来） | 未改 |
| `icon-usage.test.js` | 功能图标位禁 emoji（`RewriteView.vue` 在收敛名单内，模板未改 ⇒ 不受影响） | 未改 |

### 10.2 新增测试（本次，29 例）

| 文件 | 例数 | 锁住的契约 |
|---|---|---|
| `composables/useRewriteWordCount.test.js` | 7 | 默认值与三条校验错误；**手动置位后自适应不得覆盖用户值**；未置位时自适应必须生效；短文走固定区间 |
| `composables/useRewriteStrategy.test.js` | 12 | 默认态；列表加载成功/失败；预览取第一名/空列表降级/异常降级；改写中不刷新；预览与改写下发口径同源；未指定维度下发 `undefined`；**竞态守卫**；**正文 300ms 防抖**；设置项变化立即刷新 |
| `composables/useRewriteLibrarySync.test.js` | 8 | 交接场景六字段；无 `fromKey` 不写；载荷为 null 不写；普通场景 key 形态与幂等性；不同正文 key 不同；空白结果不写；写入失败静默 |

### 10.3 顺带修掉的一处脚手架脆弱点（`RewriteView.sensitive-warning.test.js`）

**现象**：7 个相关测试文件同场冷跑时，该文件首测**超时**（10s）失败；单独跑则通过。

**实测分段计时**（本机 jsdom + vitest，探针跑完即删）：

| 段 | 原始代码 | 拆出 3 个 composable + 外置样式后 |
|---|---|---|
| `await import('./RewriteView.vue')`（一次性编译整张依赖图） | **3706ms** | **4190ms** |
| `mount()` 本体 | 92ms | 75ms |
| 首个 `nextTick` | 0ms | 0ms |

⇒ 首测那 5.8s 里**绝大部分不是产品行为慢，是 Vite 把 SFC 及其整张依赖图编译一遍的一次性成本**。
默认 `testTimeout = 10000` 在冷缓存 + 同片并发编译时会被它吃光。

**处置**（不靠「全局抬高 timeout」糊过去）：

- 加 `beforeAll(async () => { await import('./RewriteView.vue') }, 60_000)` ——
  把一次性编译挪到 setup 阶段并给这一段一份**显式**预算；
- **每条用例的断言窗口仍是默认 10s** —— 产品行为变慢照样 10s 内报错；
- 实测首测 **6235ms → 159ms**（39 倍），整个文件 **12.53s → 6.75s**。

**为什么不全局抬高 `testTimeout`**（N9）：那会让**真正挂死**的用例也跟着放宽，把缺陷藏进更长的等待里。
正解是把脚手架成本挪出断言窗口，而不是把断言窗口拉长。

### 10.4 门禁读数

| 门禁 | 期望 |
|---|---|
| `.github/scripts/check-max-lines.js` | rc=0，且 `apps/desktop/src/views/RewriteView.vue` 实测 977 行 < 1630 |
| `scripts/check-debt-budget.js` | rc=0，且 `filesOver1000` 由 29 降为 28 |
| `node --test .github/scripts/check-max-lines.test.js` | rc=0 |
| `pnpm --filter @multi-publish/desktop test` | 全绿 |
| `pnpm --filter @multi-publish/desktop lint` | rc=0 |

---

## 十一、验收标准

1. `RewriteView.vue` 实测行数 **≤ 1000**（实测 977）。
2. 三个新 composable + 一个新 CSS 文件均 **< 500 行**（实测 67 / 142 / 94 / 320）。
3. §10.1 的 7 个既有测试文件**全绿**，且 `rewrite-lineage.test.js` / `CopyLibraryView.test.js` 两条结构锁**未被削弱**。
4. 3 个新测试文件全绿（29 例）。
5. `check-max-lines.js` / `check-debt-budget.js` 双 rc=0。
6. **DOM 逐条比对无差异**：模板未改一行（本次只动 `<script>` 与 `<style>` 的宿主方式）⇒ 渲染结果按定义不变。
7. 提示文字零变化：本次不新增/不修改任何 i18n key。

---

## 十二、风险与回滚

| 风险 | 概率 | 影响 | 处置 |
|---|---|---|---|
| **外置 CSS 后 scoped 语义变化** | 低 | 样式泄漏或失效 | `scoped src` 是 Vue 官方支持的形态，仓库已有 5 处同型用法；视觉契约测试改为读 CSS 文件后仍锁 4 条规则 + 1 条防孤儿 |
| **`watch` 注册时机变化导致预览请求次数变化** | 中 | 「改写后刷新预览」用例的 `toHaveBeenCalledTimes(2)` 失败 | composable 在 setup 期注册 watch，注册顺序与原实现等价；该用例有精确计数断言，会第一时间暴露偏差 |
| **冷缓存下首测超时** | 中 | CI 假红 | §10.3：一次性编译挪进 `beforeAll` 并给显式预算；首测 6235ms → 159ms |
| **`onUnmounted` 在无组件实例时被调用**（独立单测） | 低 | Vue 警告噪音 | 用 `getCurrentInstance()` 守卫，单元测试里跳过注册 |
| **结构锁失效**（`aiRewrite` / `podcast.activeChannelId` 被搬走） | 中 | CI 红 | N2 / N3 明确列为非目标；两条结构锁本身会当场拦下 |
| **回写 key 算法被顺手改动** | 低 | 既有文案库记录失联 | N8 明确 djb2 不改；`useRewriteLibrarySync.test.js` 锁住 key 形态与幂等性 |

**回滚**：本 PR 是纯重构，回滚 = `git revert` 合并提交，无数据迁移、无存储格式变化、无协议变化。

---

## 十三、附：本次的「不做」清单（重申）

以下事项**明确不在本次范围内**，各自需要另开 PRD 与另一次评审：

1. 任何**用户可见行为**的改动（文案、顺序、默认值、视觉）；
2. 把**模板**拆成子组件（N4：scoped 样式不跨组件生效 ⇒ 必须连样式一起搬，等价于一次视觉重写）；
3. 把 `aiRewrite` 调用与**归因链**搬进 composable（N2：结构锁）；
4. 把**文本出期入口**搬走（N3：结构锁）；
5. **下调** `max-lines-baseline.json` 的登记值（N6：属「改谁来守门」，需人工过目）；
6. 改 djb2 **回写 key 算法**（N8：会让既有记录失联）；
7. **全局抬高** `testTimeout`（N9：会把真正挂死的用例一起放宽）；
8. 处理**其它** 28 个 ≥1000 行的文件（本次只解决 RewriteView.vue 一个）。
