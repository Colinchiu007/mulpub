# Change Proposal: rewrite-segment-and-finish-reason（rewrite-limits-50000 遗留收口）

> 状态：proposal v2（已按决策层双轴评审修订）
> 上游：rewrite-limits-50000（PR #4032，merge 5c8d9b610）执行记录 §遗留 三项
> 评审结论：双轴（codex + 独立审查）3 CRITICAL / 4 MAJOR / 5 MINOR，本版已全部响应

## 评审驱动的三项重大修订

1. **`_rewriteOnce` 不存在**（C1，两轴一致）：`rewrite-engine-core.js` 的 `rewrite()` 是单体方法，无单次改写子方法可复用 ⇒ **本 change 拆成两刀，第一刀先做抽取重构**（自带回归锁），分段刀依赖它。
2. **llmClient 契约变更会击穿空结果判空**（C2）：`!result || !result.trim()` 在 `{text,finishReason}` 形态下直接 TypeError，且空 text 会漏判 ⇒ 必须显式归一化 + 归一化后判空 + 双态测试。
3. **分段检测若插在 `_validate` 之后永不可达**（M1）：50001 字会被 `TOO_LONG` 先拦 ⇒ 检测点必须前移到 `_validate` 之前。

## 评审驱动的重大修订（第三轴补充）

4. **渲染层漏斗早于引擎截断，P3 在采集页是死代码**（第三轴 M1）：`prepareRewriteInput` 在 >50000 时**直接砍到 50000** 并弹 `collection.rewriteTruncated`——超长正文根本到不了引擎。处置：`prepareRewriteInput` **只保留空内容处理，移除长度截断**（引擎现在是分段的权威，渲染层不再预截断）；`Collection.rewrite-input-limit.test.js` 两条既有断言（50001 截断用例）改写为「放行全文 + 事前分段提示」；改写页 RewriteView 直接送全文（本就无预截断）。
5. **段级区间照搬 ratio 会让合计超上限**（第三轴 M3）：`deriveWordCountRange` ratio 0.6/1.2 × 12000 字段 = 14400/段，5 段合计 72000 > `MAX_OUTPUT_CHARS` 50000，合并必砍 22000 字——正是本方案自己批评的隐蔽截断同型。处置：新增 `deriveSegmentWordCountRange(segChars, totalChars, userRange)`：用户有显式区间 ⇒ 每段 clamp 到「全篇区间 ÷ 段数」的份额；无显式区间 ⇒ 段区间按 `SEGMENT_SIZE` 比例推导但**上限夹到 `剩余配额`**（已用段数 × 每段上限 ≤ 全篇 `MAX_OUTPUT_CHARS`），并加「各段上限之和 ≤ 50000」的单测。
6. **finish_reason 出口无保证**（第三轴 M2）：已核对 openai.js:158 / anthropic.js:174 / minimax-llm.js:137 有 `finish_reason`；gemini/doubao/deepseek/ollama/openrouter/agnes/sensenova/mimo（OpenAI 兼容基类）**继承 openai.js 的返回构造**（基类 `OpenAIAdapter.chatCompletion` 统一返回 `finish_reason`，子类薄包装）⇒ 覆盖清单 = 全部 adapter；仍按「缺字段静默 null」兼容，但**新增 adapter 契约测试**：每个 LLM adapter 的 chatCompletion 返回值必须含 `finish_reason` 键（null 也算有）。
7. **Collection 成功分支只挑两个字段**（第三轴 M5）：`Collection.vue:736` 显式只取 `{result_content, knowledgeRefs}`，`outputTruncated`/`modelTruncated`/`segmented` 会被静默丢弃。处置：`rewriteViaEngine` 返回增加 `meta`（四字段全带），成功分支透传到调用方；采集页 toast 分型复用 RewriteView 的横幅文案键。
8. **keyword-extractor 是第二个 chat 消费点，契约必须单点归一**（第四轴 C2）：`keyword-extractor.js:170-174` 的 `extractWithLLM` 直接消费 `llmClient.chat` 且 `typeof raw !== 'string'` 时 **fail-open 静默返回 []**——若主 llmClient 改返回 object 而不同步改它，关键词兜底静默失效无任何报错。处置：包内新增单点 `normalizeChatResult(raw)`（string ⇒ `{text:raw, finishReason:null}`；object ⇒ `{text:String(raw.text??''), finishReason:raw.finishReason??null}`；其它 ⇒ `{text:''}`），`RewriteEngine` 与 `extractWithLLM` **都走它**；契约锁定为「chat 可返回 string 或 `{text,finishReason}`，消费方一律先归一化再取 `.text`」。主进程 `rewrite-engine.js` 内两个 chatClient（主 llmClient:103 与 llmKeywords:163）**保持返回 string**（内置实现不动），契约兼容性由归一化层保证。
9. **Anthropic 已在 adapter 层归一化**（第四轴事实校正）：`anthropic.js:174` 已有 `finish_reason: data.stop_reason || null`，`max_tokens` 值直接透出 ⇒ 第一刀只需在**语义映射**处把 `max_tokens` 与 `length` 都视为「截断」，不需要再改 Anthropic adapter 的返回构造。原「改 openai.js/anthropic.js 返回构造」收窄为「基类 + minimax 已满足，补契约测试」。
10. **分流点与敏感词语义**（第四轴 M2）：segment 路径保留「空内容 + 敏感词前置」在**全篇执行一次**（与现行 `_validate`/`_sensitiveCheck(pre)` 语义一致），之后才切分；每段不再重复前置敏感词检测（后置检测逐段保留）。
11. **SEGMENT_SIZE 推导依据**（第四轴 M5）：`SEGMENT_SIZE=12000` 的约束 = `max_tokens 64000 ÷ 2`（输入 12000 字 ≈ 18K tokens + 输出 ≤12000 字 ≈ 18K tokens + prompt/知识库余量 ≈ 40K < 64K 安全线）；单段即触发模型侧截断 ⇒ `modelTruncated` 可见化（第一刀），**不做自动缩段重试**（成本翻倍且策略输出已被截，重试意义有限；PRD 明示）。
12. **governor 交互**（第四轴 M4）：分段串行 N 次调用连续占用同一 provider 排队槽 ⇒ 事前 toast 明示「分段期间其他 AI 功能可能变慢」；不做抢占/让让策略（复杂度不成比例）。
13. **失败语义补充**（第四轴 M1）：已成功段在失败时**丢弃且明确告知**「第 i/n 段失败，前 i−1 段进度未保留，重试将重新计费」；不做 `segmentRetryFrom` 断点续跑（段数 ≤6、串行耗时分钟级，续跑的状态管理成本超过收益；列为下期评估）。
14. **Python 外部库二次截断风险**（第四轴 m4）：验收标准加「50000 区间端到端不被 content-aggregator-shared 的 RewriteProcessor 二次夹小」——集成测试直穿 `AggregationService.rewrite()`，断言传入 `RewriteConfig.max_word_count === 50000`。
15. **影响面 × 工作区文件机械对账**（第五轴，全部已逐条打开核对）：
    - **C1（基类路径怀疑）不成立**：`apps/desktop/electron/services/adapters/_base/openai-compatible.js` 真实存在（44 行，`extends OpenAIAdapter`），`chatCompletion` 由 `openai.js` 的 `OpenAIAdapter` 提供并返回 `finish_reason`（openai.js:158）⇒ deepseek/gemini/doubao/ollama/openrouter/sensenova/mimo/tianyiyun/opencode-go/agnes 全部覆盖；基类自身**没有** chatCompletion（`_base/base.js` throw NotImplementedError 的那个是更上层基类）——「其余 adapter 继承 openai.js 返回构造」的命题为真。
    - **引擎侧 W3 测试必改**（第五轴 M2）：`packages/rewrite-engine/tests/rewrite-engine-core.test.js:104-114` 断言 50001 → TOO_LONG；第二刀落地时改写为「50001 走分段成功 + 更高值（如 200000）仍 TOO_LONG 兜底」。
    - **结构锁文件必改**（第五轴 M3）：`apps/desktop/src/utils/rewrite-engine-limits.test.js:53-88` 五条用例专锁 `prepareRewriteInput` 截断行为（含 emoji 50001）；移除截断后改写为「任意长度放行 + 只保空内容归一」，emoji 不劈用例迁移到引擎侧 segment-splitter 测试。
    - **Collection.vue:699-704 截断分支**（第五轴 M3）：`prepareRewriteInput` 不再截断 ⇒ 该 warning 分支变死代码，**删除调用点与 `collection.rewriteTruncated` key**（zh/en 同步删）。
    - **meta 透传含失败路径**（第五轴 M4）：`segmentIndex` 除结构化字段外，在 normalizeRewriteEngineError 里映射为 `userErrors.REWRITE_SEGMENT_FAILED` 文案（zh/en）「第 {index}/{total} 段改写失败，前面段的进度未保留」——采集页与改写页都走稳定码映射，不依赖 message 文本。
8. **keyword-extractor 是第二个 chat 消费点，契约必须单点归一**（第四轴 C2）：`keyword-extractor.js:170-174` 的 `extractWithLLM` 直接消费 `llmClient.chat` 且 `typeof raw !== 'string'` 时 **fail-open 静默返回 []**——若主 llmClient 改返回 object 而不同步改它，关键词兜底静默失效无任何报错。处置：包内新增单点 `normalizeChatResult(raw)`（string ⇒ text=raw；object ⇒ text=String(raw.text??'')），`RewriteEngine` 与 `extractWithLLM` **都走它**；契约锁定「chat 可返回 string 或 `{text,finishReason}`，消费方一律先归一化再取 `.text`」。主进程 `rewrite-engine.js` 内两个 chatClient（主 llmClient 与 llmKeywords）**保持返回 string**（内置实现不动），兼容性由归一化层保证。
9. **Anthropic 已在 adapter 层归一化**（第四轴事实校正）：`anthropic.js:174` 已有 `finish_reason: data.stop_reason || null`，`max_tokens` 值直接透出 ⇒ 第一刀只需在**语义映射**处把 `max_tokens` 与 `length` 都视为「截断」，不需要再改 Anthropic adapter 的返回构造。原「改 openai.js/anthropic.js 返回构造」收窄为「基类 + minimax 已满足，补契约测试」。
10. **分流点与敏感词语义**（第四轴 M2）：segment 路径保留「空内容 + 敏感词前置」在**全篇执行一次**（与现行 `_validate`/`_sensitiveCheck(pre)` 语义一致），之后才切分；每段不再重复前置敏感词检测（后置检测逐段保留）。
11. **SEGMENT_SIZE 推导依据**（第四轴 M5）：`SEGMENT_SIZE=12000` 的约束 = `max_tokens 64000 ÷ 2`（输入 12000 字 ≈ 18K tokens + 输出 ≤12000 字 ≈ 18K tokens + prompt/知识库余量 ≈ 40K < 64K 安全线）；单段即触发模型侧截断 ⇒ `modelTruncated` 可见化（第一刀），**不做自动缩段重试**（成本翻倍且策略输出已被截，重试意义有限；PRD 明示）。
12. **governor 交互**（第四轴 M4）：分段串行 N 次调用连续占用同一 provider 排队槽 ⇒ 事前 toast 明示「分段期间其他 AI 功能可能变慢」；不做抢占/让让策略（复杂度不成比例）。
13. **失败语义补充**（第四轴 M1）：已成功段在失败时**丢弃且明确告知**「第 i/n 段失败，前 i−1 段进度未保留，重试将重新计费」；不做 `segmentRetryFrom` 断点续跑（段数 ≤6、串行耗时分钟级，续跑的状态管理成本超过收益；列为下期评估）。
14. **Python 外部库二次截断风险**（第四轴 m4）：验收标准加「50000 区间端到端不被 content-aggregator-shared 的 RewriteProcessor 二次夹小」——集成测试直穿 `AggregationService.rewrite()`，断言传入 `RewriteConfig.max_word_count === 50000`。

## 分期

### 第一刀：`rewrite-contract-and-align`（契约 + 对齐 + 抽取重构）

**范围**：

1. **finish_reason 全链路透传**：
   - adapter 已有 `finish_reason`（openai.js:158 `choices[0].finish_reason`、anthropic.js:174 `stop_reason`、minimax-llm.js:137；其余 OpenAI 兼容子类经 `_base/openai-compatible.js → openai.js OpenAIAdapter` 继承同一返回构造，第五轴已逐文件核对）⇒ **语义映射层**（不新增 adapter 归一化）：`isTruncatedFinishReason(reason)` = `reason === 'length' || reason === 'max_tokens'`；其余（`stop`/`content_filter`/null）为 false。
   - `llmClient.chat` 契约扩展：可返回 `string`（旧实现）或 `{text, finishReason}`（新实现）；**主进程 rewrite-engine.js 同步改造**为返回 `{text, finishReason}`（finishReason 从 `generateWithDefault` 结果透传）。
   - **兼容归一化**（C2 + 第四轴 C2）：包内新增单点 `packages/rewrite-engine/src/llm-result.js` 的 `normalizeChatResult(raw)`：string ⇒ `{text:raw, finishReason:null}`；object ⇒ `{text:String(raw.text??''), finishReason:raw.finishReason??null}`；其它 ⇒ `{text:''}`。`RewriteEngine.rewrite` 与 `extractWithLLM`（keyword-extractor.js:170）**共用它**。**归一化之后**才判空（空 text 仍走 `EMPTY_RESULT`；判空只在 `_rewriteOnce` 内一次）。
   - `rewrite()` 结果新增 `modelTruncated`（`isTruncatedFinishReason(finishReason)`，纯增量字段）。
   - **影响面清单**（C3 + 第四轴 C2 响应）：两处消费点——① `RewriteEngine.rewrite`；② `extractWithLLM` 关键词兜底。主进程两个内置 chatClient 保持返回 string。测试锁：string 不炸 / `{text:''}` 走 EMPTY_RESULT / extractWithLLM 仍提取到关键词。

2. **Python 聚合链路字数上限对齐**：
   - `models.py` `min_word_count` 上界 5999 → 49999、`max_word_count` 上界 6000 → 50000（真源注释指向 JS `MAX_OUTPUT_CHARS`）。
   - 测试：`max_word_count=50000` 合法正控；`50001` 越界拒绝（m1 响应：验收数字对齐新边界）。

3. **`rewrite()` 抽取单次改写方法 `_rewriteOnce`**（C1 响应，分段刀的前置件）：
   - 把 `rewrite()` 的「校验→敏感词→策略→prompt→LLM→后处理→质量→viral」主体提为 `_rewriteOnce(params, {segmentContext})`；`rewrite()` 变为薄编排（segment 检测 + 调用 + 聚合）。
   - **副作用口径**（C1 附带）：`_rewriteOnce` 内**只保留**「知识库检索上下文构建」与「质量评估」；**移除**知识库 recordFeedback 写入与 viralScorer 调用（上移到 `rewrite()` 全篇级，只执行一次）。分段刀因此天然获得「全篇只写一次反馈、viralScorer 只跑一次」的正确语义。
   - 抽取过程**零行为变化**：既有 219 例引擎测试 + 380 例渲染层测试全绿即为回归锁（TDD 红灯不需要——这是保形重构，用全量测试当锁）。

### 第二刀：`rewrite-segment-long-input`（>50000 分段改写）

依赖第一刀的 `_rewriteOnce` 与已跑通的 llmClient 契约测试。

1. **segment 检测前移**（M1）：`rewrite()` 入口先算码点数，`> MAX_INPUT_CHARS` 走 segment 路径并**跳过 `_validate` 的长度分支**（只保留空内容校验）。
2. **切分**（新模块 `segment-splitter.js`）：段落边界（`\n\s*\n`）贪心合并到 `SEGMENT_SIZE=12000`；单段仍超长 ⇒ 句子边界（`[。！？；]`）二次切；**仍超长 ⇒ 码点硬切兜底**（第二轮评审 M 级：无段落无标点的英文/代码/URL 长文本必须保证 segment 永不超 SEGMENT_SIZE）。emoji 不劈（码点口径）。输出 `{segments, totalChars, segmentCount}`。
3. **逐段改写**：`_rewriteOnce(params, {segmentContext: {index, count}})`；prompt 注入「长文分片 i/n：仅改写本片段，不总结、不续写其他段落，保留段落边界」。
4. **wordCountRange 口径**（M3 + 第三轴 M3 响应）：新增 `deriveSegmentWordCountRange(segChars, totalChars, userRange)`——**用户显式区间优先且按全篇语义解释**：
   - 用户有显式区间 ⇒ 每段 clamp 到「全篇区间 ÷ 段数」的份额，**各段上限之和 ≤ 全篇上限**（杜绝 ratio 照搬导致 5 段合计 72000 > 50000、合并必砍 22000 字的同型隐蔽截断）；
   - 用户无显式区间 ⇒ 按 `SEGMENT_SIZE` 比例推导（ratio 同 rewrite-defaults），但每段上限再夹「剩余配额」`min(段比例上限, ceil((MAX_OUTPUT_CHARS − 已产出) / 剩余段数))`；
   - 单测：任意段数/段长下，各段上限之和 ≤ `MAX_OUTPUT_CHARS`。
5. **合并与后处理**（M4 响应）：段结果 `\n\n` 拼接后，**复用 `_postProcess`**（传全篇 userSettings.wordCountRange）——AI 味去除/截断/结构标题剥离/`outputTruncated` 契约全部走既有路径，不新造第三条。合并后超 `MAX_OUTPUT_CHARS` ⇒ `outputTruncated=true`（既有字段语义）。
6. **失败语义**（M2 响应）：任一段失败 ⇒ 整篇失败，errorCode 保持底层稳定码（`LLM_ERROR` 等）+ **结构化 `segmentIndex` 字段**（不把段号编进 errorCode 字符串，便于 UI 按稳定码映射）；已成功段结果**不入库、不返回**（不返回半成品）；错误 message 告知「第 i/n 段失败，前面段的进度未保留」。PRD 明写：串行 N 段、耗时 ≈ N×单段、失败即全丢（用户可预期）。
7. **渲染层不再预截断**（第三轴 M1 响应）：`prepareRewriteInput`（`apps/desktop/src/utils/rewrite-engine-limits.js`）**移除长度截断**，只保留空内容归一——引擎（分段路径）现在是长文的权威处理者，渲染层预砍会让 50001 字永远到不了分段。连带更新 `Collection.rewrite-input-limit.test.js` 的「50001 截断」既有断言 → 改为「放行全文 + 事前分段提示」；`collection.rewriteTruncated` toast 语义收窄为「不再触发」（key 保留兼容，无调用点）。
8. **全篇级副作用**：知识库 recordFeedback 一次、viralScorer 一次（第一刀已上移）。
9. **UI**：输入 >50000 时事前 toast「正文共 N 字，将分段改写（约 M 段），耗时与费用相应增加」（新增 `rewritePage.rewriteSegmented` 与 `collection.rewriteSegmented` 键，zh/en 成对，m4 响应）；RewriteView meta 行「分段改写 ×N」；`result.segmented` 纯增量。
10. **meta 全字段透传**（第三轴 M5 响应）：`rewriteViaEngine` 返回增加 `meta: {outputTruncated, outputLength, modelTruncated, segmented}`——`Collection.vue` 成功分支（当前只挑 `{result_content, knowledgeRefs}`）与 RewriteView 均补读，采集页 toast 与改写页横幅共用同一套分型文案键。
11. **模型截断展示**（第一刀已备）：RewriteView 横幅分型——`outputTruncated`（引擎截断，既有横幅）vs `modelTruncated`（模型截断，新文案「模型输出达到单次生成上限…」）。

## 验收标准

**第一刀**：
1. llmClient 返回 string（旧实现）⇒ 引擎正常、`finishReason=null`；
2. llmClient 返回 `{text:''}` ⇒ `EMPTY_RESULT`（不因新 shape 漏判）；
3. llmClient 返回 `{text:'x', finishReason:'length', truncated:true}` ⇒ `modelTruncated=true`；`{text:'x', truncated:false}` ⇒ 不置；
4. Anthropic `stop_reason='max_tokens'` 与 OpenAI `finish_reason='length'` 都归一化为 truncated=true；
5. `extractWithLLM`（string 实现）仍工作（契约边界锁）；
6. adapter 契约：全部 LLM adapter 的 chatCompletion 返回值含 `finish_reason` 键（第三轴 M2：OpenAI 兼容基类统一构造，null 也算有）；
7. Python `max_word_count=50000` 合法、`50001` 越界；
8. 抽取重构后引擎 229 + 渲染层 380 + Python 51 全绿（零行为变化；m4 已校正为实数 229）。

**第二刀**：
9. 50001 字输入走分段成功返回，`segmented.segmentCount ≥ 2`，不报 TOO_LONG（采集页主链路可达——`prepareRewriteInput` 已不预截断）；
10. 无段落无标点的 60000 字长文本也能切出 ≤12000 的段（硬切兜底）；
11. 任一段 LLM 失败 ⇒ 整篇失败 + `segmentIndex` 结构化字段 + 无半成品 + 无脏知识库记录；
12. 用户显式 wordCountRange 在分段路径不被覆盖，且各段上限之和 ≤ `MAX_OUTPUT_CHARS`（`deriveSegmentWordCountRange` 单测）；
13. 合并后处理复用 `_postProcess`（超 50000 ⇒ `outputTruncated`）；
14. 段切不劈 emoji（`chars` 字段为码点口径，m2）；
15. 知识库反馈与 viralScorer 全篇只执行一次（调用计数断言）；
16. `Collection.vue` 成功分支透传 `meta` 四字段（第三轴 M5：toast 分型与 RewriteView 同文案键）。

## 不做

- 段间上下文摘要/术语表对齐（成本再翻倍，列为下期评估项；UI 明示「分段改写可能有一致性折损」）。
- 失败续跑/断点缓存（M2 评估后判定：串行段数 ≤6，重试成本可接受；PRD 明写失败语义）。
- Python 侧分段（桌面主链路已 Node 化）。
- 分段进度条（无 IPC 进度通道；事前 toast 覆盖耗时预期）。
