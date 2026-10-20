# PRD：文案改写字数区间控制（2026-09-12）

> ⚠️ **部分口径已被取代（2026-10-20，change `rewrite-segment-and-finish-reason`）**：
> 输出区间上界 6000 已随 rewrite-limits-50000 放开到 **50000**（真源 `packages/rewrite-engine/src/rewrite-engine-core.js` 的 `MAX_OUTPUT_CHARS`）；
> 输入上限、输出截断可见化（`outputTruncated` / `modelTruncated`）、Python 链路上界对齐见
> `01-docs/PRD-REWRITE-LIMITS-50000-2026-10-19.md` 与 `openspec/changes/rewrite-segment-and-finish-reason/proposal.md`。
> 本文其余部分（三档语义、注入优先级、默认值）仍然有效。
>
> ⚠️ **采集页一节（§2.2 F3/F4、§3 采集页相关行、§4.2、§5.2）已过时（2026-10-20，change `collect-rewrite-wordcount`）**：
> ① 采集页改写**早已 Node 化**（走 `aiRewrite` → `packages/rewrite-engine`），
>    §2.2 F4 / §4.2 描述的 `aggregationRewrite` + Python `AggregationService.rewrite` 链路**不是当前主链路**；
> ② 采集页曾把区间下发给一个引擎**不认识的键** `targetWordCount`（引擎只认 `wordCountRange`），
>    导致「字数」设置**静默失效**；本次已修正，详见
>    `01-docs/PRD-COLLECTION-REWRITE-WORD-COUNT-2026-10-20.md`；
> ③ §3 / §5.2 里采集页的合法域「0-5999 / 1-6000」是过期值，现为 **0-49999 / 1-50000**
>    （与 `/rewrite` 页一致，2026-10-20 校正）。


## 1. 背景与目标

### 1.1 背景

文案改写页（RewriteView）与 AI 写作面板（AiWriterPanel）的输入提示包含"至少 20 字"的最小字数限制；采集页（Collection）改写区域使用 keep（保持原文）/ compress（精简）/ expand（扩写）三档长度下拉，粒度粗、不直观。用户希望：

1. 移除最少字数限制——只保留最大字数（6000 字）上限；
2. 两个页面统一字数区间控制——通过最小/最大两个数字输入框精确控制改写结果字数，默认 800-2000；
3. 无字数控制场景的默认上限——3000 字（输出不超过 3000）。

### 1.2 目标

- 输入侧：非空即可提交（无最小字数），上限维持 6000 字；
- 输出侧：用户可精确设定改写结果的字数区间 [min, max]；
- 兜底：未提供字数控制的调用路径，输出默认不超过 3000 字；
- 校验：前端实时校验 + 后端模型校验双层防护，max ≥ min 强制。

### 1.3 非目标

- 不做字数设置的持久化（会话内保持，后续可单独迭代）；
- 不改后端 length 三档 API 契约（保留给旧客户端兼容，新前端不再传）；
- 不涉及视频创作/Story2Video 的字数控制。

## 2. 功能需求

### 2.1 文案改写页（RewriteView）

**F1 移除最小字数限制**

- 输入框 placeholder 从「至少 20 字，最多 6000 字」改为「最多 6000 字」；
- 前端校验：内容非空（trim 后 length > 0）即可启用改写按钮；空内容显示"请输入文案内容"；
- 热门选题带入（/rewrite?topic=xxx）：短选题直接填入，不再补引导语前缀；
- 后端（rewrite-engine）：_validate() 移除 len < 20 的 TOO_SHORT 分支；保留空内容（EMPTY_CONTENT）与超 6000（TOO_LONG）。

**F2 字数区间控制**

- 位置：改写设置卡片内、改写模式下方面板新增「字数控制」行；
- 控件：两个 number 输入框，标签"字数控制"，中间"-"分隔符，后缀"字"；
- 默认值：min=800，max=2000；
- 提交时通过 userSettings.wordCountRange = { min, max } 传给改写引擎；
- 引擎行为：systemPrompt 注入「【字数要求】改写后的文本长度必须控制在 {min} 到 {max} 字之间。」；后处理截断上限优先级 wordCountRange.max > 策略 postProcess.maxLength > 默认 3000。

### 2.2 采集页（Collection）

**F3 三档长度替换为字数区间**

- 移除 keep/compress/expand 下拉；
- 改写按钮区域新增：标签"字数" + min/max 两个数字输入框（默认 800/2000）+ 单位"字"；
- 三个调用入口全部传新参数：rewriteCollected()（手动改写）、collectAndRewrite() 文章路径、collectAndRewrite() 视频转写路径；
- 传参：{ content, style, min_word_count, max_word_count }（不再传 length）。

**F4 后端（Python aggregation）**

- RewriteRequest 模型新增字段：min_word_count: int（默认 800，0 ≤ 值 ≤ 6000）、max_word_count: int（默认 2000，1 ≤ 值 ≤ 6000）；
- model_validator：max ≥ min，否则 422；content 校验 strip 后非空（移除 20 字下限）；
- AggregationService.rewrite()：字数优先级为显式 min/max_word_count > length 三档映射（兼容旧客户端）；target_word_count = (min + max) / 2 取整；输入校验仅拦截空内容。

### 2.3 默认输出上限 3000（JS 引擎）

**F5**

- rewrite-engine-core.js 常量 DEFAULT_MAX_OUTPUT_LENGTH = 3000；
- _postProcess() 截断上限：wordCountRange.max > 策略 postProcess.maxLength > 3000；
- 覆盖场景：AiWriterPanel 等未传字数区间的调用、内置策略未配置 maxLength 的情况。

## 3. 数据校验规则

| 校验项 | 规则 | 错误提示（zh） | 错误提示（en） |
|--------|------|----------------|----------------|
| 内容为空 | trim 后 length = 0 | 请输入文案内容 | Please enter some content |
| 内容超长 | > 6000 字（Unicode code point） | 内容过长，最多 6000 字 | Content too long (max 6000) |
| min 非法 | 非整数 / <0 / >5999 | 最小字数需为 0-5999 的整数 | Min must be an integer between 0 and 5999 |
| max 非法 | 非整数 / <1 / >6000 | 最大字数需为 1-6000 的整数 | Max must be an integer between 1 and 6000 |
| max < min | 跨字段校验 | 最大字数不能小于最小字数 | Max cannot be less than min |

校验时机：

- 前端实时：computed 属性 wordCountError / rewriteWordCountError，输入即校验，错误文案红色显示在输入框旁；
- 前端提交拦截：改写按钮 disabled（RewriteView）或入口函数早退 + notify warning（Collection）；
- 后端模型层：Pydantic field_validator + model_validator（422 拒绝）；
- JS 引擎层：_validate() 空内容/超长拒绝。

## 4. 交互流程

### 4.1 文案改写页流程

用户输入内容 → [非空?] ─否→ 按钮禁用 + "请输入文案内容"；是 → 用户设定字数区间 → [区间合法?] ─否→ 红字提示 + 按钮禁用；是 → 点击"开始改写" → aiRewrite({ mode, content, userSettings: { wordCountRange: {min,max}, ... } }) → IPC ai:rewrite → rewriteEngineService.rewrite → _validate（空/超长）→ systemPrompt 注入字数要求 → LLM → _postProcess（按 max 截断）→ 结果区显示（字数元信息）。

### 4.2 采集页流程

采集成功 → 改写区显示（风格下拉 + 字数 min/max 输入框 + 改写按钮）→ 设定区间 → [合法?] ─否→ 红字提示 + 改写按钮禁用 + 入口函数早退；是 → 点击"改写" / "一键采集+改写" → aggregationRewrite({ content, style, min_word_count, max_word_count }) → IPC aggregation:rewrite → Python /aggregation/rewrite → RewriteRequest 校验（422）→ AggregationService.rewrite → RewriteConfig(min_word_count, max_word_count, target=中值) → LLM → 结果。

## 5. 显示项与提示文字

### 5.1 文案改写页

| 位置 | 项 | 文案（zh / en） |
|------|-----|------------------|
| 输入框 placeholder | rewritePage.inputPlaceholder | 输入或粘贴需要改写的文案内容（最多 6000 字）... / Enter or paste content to rewrite (up to 6000 characters)... |
| 字数控制标签 | rewritePage.wordCountLabel | 字数控制 / Word count |
| min 输入框 placeholder | rewritePage.wordCountMinPlaceholder | 最小 / Min |
| max 输入框 placeholder | rewritePage.wordCountMaxPlaceholder | 最大 / Max |
| 单位后缀 | rewritePage.wordCountUnit | 字 / chars |
| 空内容错误 | rewritePage.contentEmpty | 请输入文案内容 / Please enter some content |
| min 非法 | rewritePage.wordCountMinInvalid | 最小字数需为 0-5999 的整数 / Min must be an integer between 0 and 5999 |
| max 非法 | rewritePage.wordCountMaxInvalid | 最大字数需为 1-6000 的整数 / Max must be an integer between 1 and 6000 |
| max < min | rewritePage.wordCountMaxLtMin | 最大字数不能小于最小字数 / Max cannot be less than min |

### 5.2 采集页

| 位置 | 项 | 文案（zh / en） |
|------|-----|------------------|
| 字数标签 | collection.wordCountLabel | 字数 / Word count |
| min/max placeholder | collection.wordCountMin/MaxPlaceholder | 最小/最大 / Min/Max |
| 单位 | collection.wordCountUnit | 字 / chars |
| 三条校验错误 | collection.wordCount*Invalid / MaxLtMin | 同文案改写页 |
| 入口拦截提示 | collection.wordCountInvalid | 请先修正字数设置 / Fix word count settings first |

### 5.3 AI 写作面板（AiWriterPanel）

| 位置 | 文案 |
|------|------|
| textarea placeholder | 输入需要改写的文案内容（最多 6000 字） |

该面板为发布页内嵌组件，placeholder 硬编码中文，随本次一并更新；未加区间输入，输出走默认 3000 上限。

## 6. 技术实现要点

### 6.1 JS 引擎（packages/rewrite-engine）

- DEFAULT_MAX_OUTPUT_LENGTH = 3000 模块常量；
- _getWordCountInstruction(userSettings)：生成「【字数要求】…{min} 到 {max} 字之间」指令，追加到 systemPrompt；
- _postProcess(text, strategy, wordCountRange)：max 优先级 wordCountRange > postProcess.maxLength > 3000；
- rewrite() 签名的 JSDoc 补充 wordCountRange。

### 6.2 Python 后端（packages/python-backend）

- models.py：新增两个 Field + content strip 校验 + model_validator 跨字段校验；
- service.py：rewrite() 中 min/max 优先于 _LENGTH_RANGES（旧映射保留，未传字数时兜底）；
- 兼容性：旧客户端只传 length → 走三档映射；新前端传 min/max → 精确控制。

### 6.3 前端（apps/desktop/src）

- RewriteView.vue：wordCountMin/Max ref（默认 800/2000）+ wordCountError computed + UI + 提交传参 + canStartRewrite 联动；
- Collection.vue：rewriteWordCountMin/Max ref + rewriteWordCountError computed + 三处调用传参替换 length + 按钮 disabled 联动 + 入口早退；
- locales zh/en 成对更新（CI Gate 7 check-locale-sync 拦截）：新增 rewritePage.wordCount* 系列、collection.wordCount* 系列；rewritePage.tooShort 改名为 contentEmpty（语义变更）。

## 7. 测试

### 7.1 JS 引擎（rewrite-engine-core.test.js，新增 6 例）

- W1 短内容（<20 字）不再被拒绝；
- W2 空内容仍被拒绝（EMPTY_CONTENT）；
- W3 超长（>6000）仍被拒绝（TOO_LONG）；
- W4 wordCountRange 注入 systemPrompt 字数指令；
- W5 无字数控制时默认输出上限 3000；
- W6 wordCountRange.max 覆盖 postProcess 上限。

### 7.2 Python（test_aggregation.py，新增 6 例 + 更新 1 例）

- 默认 min/max = 800/2000；
- 字数校验（整数/范围/max≥min）；
- 短内容不再被拒（走到 key 检查）；
- 空内容拒绝；
- service 消费 min/max_word_count；
- 原"内容过短先报错"测试更新为新行为。

### 7.3 前端组件（RewriteView.test.js / Collection.test.js）

- 字数输入框渲染 + 默认值 800/2000；
- max < min → 错误提示 + 按钮禁用/拦截；
- 超范围 → 错误提示；
- 短内容按钮启用（原禁用测试更新）；
- 短选题直接填入（原引导语测试更新）；
- collectAndRewrite 传参断言更新为 min/max_word_count。

## 8. 验收标准

- [x] 输入 1 个字也能发起改写（无最小字数拦截）；
- [x] 空内容被拦截，提示"请输入文案内容"；
- [x] 超 6000 字输入被拦截（前后端一致）；
- [x] 两页面字数输入框默认 800/2000；
- [x] min=2000, max=100 时显示错误且按钮禁用；
- [x] 非整数/超范围值显示对应错误；
- [x] 无字数控制场景输出不超过 3000 字；
- [x] locales zh/en 成对（check-locale-sync PASS）；
- [x] 所有相关测试通过。

## 9. 变更记录

| 日期 | 变更 | 说明 |
|------|------|------|
| 2026-09-12 | 初版 | 移除最小字数 + 字数区间控制 + 3000 默认上限 |
