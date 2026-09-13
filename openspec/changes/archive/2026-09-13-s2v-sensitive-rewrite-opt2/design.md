## Context

当前图片敏感内容改写实现（`story2video-image-retry.js`）已具备：信号识别（`isContentPolicyRejection`）、敏感类型分级（`classifyContentPolicyType` + `CONTENT_POLICY_SEVERITY`）、模板改写（`buildContentPolicySafePrompt`）、LLM 改写升级（`rewriteWithLLMFallback`）、语义保留度（`estimateSemanticRetention`）、审计统计（`aggregateContentPolicyStats`）。本次在其基础上做 8 项增强。详见 proposal.md。

## Goals / Non-Goals

**Goals:**
- 提升语义保留度估算准确性（中文 n-gram + 英文词干化）
- 增加改写预检闭环，减少无效重试
- 提升敏感类型识别准确率（provider 维度映射）
- 增加 negative_prompt 联动，兼顾保留度与安全性
- 控制 LLM 改写成本（调用上限 + 缓存）
- 审计统计反哺调优
- 改写指令语言与原文匹配
- 严重度差异化改写强度

**Non-Goals:**
- 不引入新依赖（分词/词干化用轻量自实现，不引第三方库）
- 不接入真实供应商 moderation API（依赖外部服务，超出纯代码范围）
- 不改动既有审计数据结构（向后兼容）
- 不做端到端真实 provider 评估（需真实 Key，超出本次范围）

## Decisions

### D1: 语义保留度算法 — 轻量自实现而非第三方分词库
**选择**：中文用双字 n-gram（bigram）+ 英文用词干化（简单后缀剥离），不引入 jieba/natural 等依赖。
**备选**：引入 jieba（中文分词）——增加依赖体积与维护成本；对提示词这种短文本，bigram 足够。
**理由**：提示词是短文本，bigram 重叠率比整句切分准确且零依赖；词干化用简单规则（-ing/-ed/-s/-es）覆盖常见同义词。

### D2: 改写预检 — 扩展敏感词库而非调用供应商 moderation
**选择**：新增本地扩展敏感词库（`EXTENDED_SENSITIVE_WORDS`），覆盖现有 `validateRewriteSafety` 之外的常见敏感词。
**备选**：调用供应商 moderation API——依赖外部服务、增加延迟与成本，且供应商规则不可控。
**理由**：本地词库零成本、可测试；与现有 `validateRewriteSafety` 互补（现有覆盖高危词，扩展覆盖更全）。

### D3: 敏感类型映射表 — provider 维度静态映射
**选择**：新增 `SENSITIVE_TYPE_SIGNAL_MAP`（provider → 信号 → 敏感类型），`classifyContentPolicyType` 先查映射表，未命中回退文本分类。
**备选**：LLM 分类——成本高、延迟大，对短错误信号过度设计。
**理由**：静态映射表零成本、可测试；覆盖已知 provider 信号，未知信号回退既有逻辑，不破坏兼容。

### D4: negative_prompt 联动 — 按敏感类型生成
**选择**：`buildContentPolicySafePrompt` 增加返回 negative_prompt 的能力，按敏感类型生成排除指令（如 violence → `no blood, no weapons`）。
**备选**：不生成 negative_prompt——丢失负向约束能力。
**理由**：图片模型普遍支持 negative_prompt，正向保留原文 + 负向排除敏感，兼顾保留度与安全性。

### D5: LLM 成本预算 — 每场景调用上限 + 哈希缓存
**选择**：新增 `LLM_REWRITE_MAX_CALLS_PER_SCENE`（默认 2）与模块级缓存（key=原始 prompt 哈希）。
**备选**：无限制调用——可能浪费 LLM 额度。
**理由**：上限 + 缓存控制成本，同提示词复用避免重复消耗。

### D6: 审计反哺 — 输出调优建议
**选择**：`aggregateContentPolicyStats` 增加 `suggestions` 字段，低成功率类型/高频 unknown 生成调优建议。
**备选**：自动改写模板——风险高，需人工确认。
**理由**：反哺为可选建议，不改变既有审计数据，安全可控。

### D7: 改写指令语言匹配 — 自动检测原文语言
**选择**：`buildContentPolicySafePrompt` 检测原文语言（中文占比 > 阈值则用 `_ZH` 表），而非硬编码。
**备选**：保持硬编码英文——中文原文适配差。
**理由**：自动检测零成本，中文原文用中文指令更贴合。

### D8: 严重度差异化 — 改写指令强度分级
**选择**：`buildContentPolicySafePrompt` 依据 `CONTENT_POLICY_SEVERITY` 对 severe 类型追加更强改写指令。
**备选**：统一强度——severe 类型可能改写不足。
**理由**：severe（political/minor/selfharm）需更强改写，mild 保守保留。

## Risks / Trade-offs

- [bigram 分词准确度有限] → 对提示词短文本足够；保留原关键词重叠作为兜底
- [词干化规则简单，可能误归并] → 仅用于保留度估算（非安全决策），影响有限
- [本地敏感词库可能不全] → 与现有 `validateRewriteSafety` 互补，且可随 learnings 扩充
- [映射表覆盖有限] → 未命中回退既有文本分类，不破坏兼容
- [negative_prompt 供应商支持差异] → 仅作为附加约束传递，不支持时忽略
- [LLM 缓存可能过期] → 缓存仅限单次运行内（模块级），不跨运行