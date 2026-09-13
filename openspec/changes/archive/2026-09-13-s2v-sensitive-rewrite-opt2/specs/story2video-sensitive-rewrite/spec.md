## Purpose

图片生成内容安全改写策略增强：提升语义保留度估算准确性、增加改写预检闭环、敏感类型识别映射、negative_prompt 联动、LLM 改写成本预算、审计统计反哺、改写指令语言匹配与严重度差异化改写强度，最终提升改写成功率与语义保留度。

## ADDED Requirements

### Requirement: 语义保留度估算支持中文与同义词
系统 SHALL 在估算改写前后语义保留度时，对中文文本采用 n-gram 切分、对英文采用词干化，使中文/同义词场景的保留度估算比纯关键词重叠更准确。保留度 MUST 为 0~1 数值，仅当改写成功且保留度有限时记录到审计。

#### Scenario: 中文改写保留度估算
- **WHEN** 原文为中文「一个老妇人在做饭」，改写为「一位老妇人在厨房做饭」
- **THEN** 语义保留度大于 0（n-gram 重叠），且高于纯整句切分的结果

#### Scenario: 同义词改写保留度估算
- **WHEN** 原文含 `child`，改写为 `kid`（同义词替换）
- **THEN** 语义保留度大于 0（词干化后 `child`/`kid` 归并为同一词根）

### Requirement: 改写后预检闭环
系统 SHALL 在改写版发送给供应商前，用本地扩展敏感词库预检改写结果；预检发现仍含高危敏感词时，该改写版 MUST 被弃用并触发下一轮改写（模板→LLM 升级），避免无效重试浪费尝试次数。

#### Scenario: 改写版仍含高危词被弃用
- **WHEN** 改写后的提示词仍含扩展敏感词库中的高危词
- **THEN** 该改写版被弃用，不发送给供应商，并触发下一轮改写

#### Scenario: 改写版通过预检
- **WHEN** 改写后的提示词通过扩展敏感词库预检
- **THEN** 该改写版被发送给供应商

### Requirement: 敏感类型识别映射表
系统 SHALL 依据「provider → 错误信号 → 敏感类型」映射表提升敏感类型识别准确率；未命中映射表的信号回退到现有 `classifyContentPolicyType` 文本分类，`unknown` 兜底率应降低。

#### Scenario: 已知 provider 信号命中映射表
- **WHEN** 某 provider 的错误信号命中映射表
- **THEN** 敏感类型按映射表返回，而非 `unknown`

#### Scenario: 未知信号回退文本分类
- **WHEN** 错误信号未命中映射表
- **THEN** 敏感类型回退到 `classifyContentPolicyType` 文本分类结果

### Requirement: negative_prompt 联动
系统 SHALL 在改写正向提示词时同步生成 negative_prompt（排除敏感元素），正向保留原文语义、负向排除敏感内容。negative_prompt MUST 与改写指令的敏感类型一致。

#### Scenario: 生成 negative_prompt
- **WHEN** 改写某敏感类型（如 violence）的提示词
- **THEN** 生成对应的 negative_prompt（如 no blood, no weapons），且与改写指令的敏感类型一致

### Requirement: LLM 改写成本预算控制
系统 SHALL 为 LLM 改写设置每场景调用上限，并对相同原始提示词哈希的改写结果做缓存复用，避免无谓消耗 LLM 额度。超过调用上限时 MUST 回退到模板改写或交用户兜底。

#### Scenario: 同提示词缓存复用
- **WHEN** 同一原始提示词哈希再次触发 LLM 改写
- **THEN** 直接复用缓存结果，不重复调用 LLM

#### Scenario: 超过调用上限
- **WHEN** LLM 改写调用次数超过每场景上限
- **THEN** 回退到模板改写或交用户兜底，不再调用 LLM

### Requirement: 审计统计反哺机制
系统 SHALL 使 `aggregateContentPolicyStats` 的聚合输出可反哺调优：低成功率类型可增强改写指令、高频 `unknown` 类型可补充信号词。反哺 MUST 为可选的调优建议，不改变既有审计数据。

#### Scenario: 统计输出反哺建议
- **WHEN** 某敏感类型成功率低于阈值
- **THEN** 生成该类型改写指令增强建议

### Requirement: 改写指令语言与原文匹配
系统 SHALL 依据原文语言自动选择改写指令语言（中文原文用中文指令，英文原文用英文指令），而非硬编码。改写指令语言 MUST 与原文语言一致。

#### Scenario: 中文原文用中文指令
- **WHEN** 原始提示词为中文
- **THEN** 改写指令使用中文（`CONTENT_POLICY_REWRITE_STRATEGIES_ZH`）

#### Scenario: 英文原文用英文指令
- **WHEN** 原始提示词为英文
- **THEN** 改写指令使用英文（provider 定制或通用表）

### Requirement: 严重度差异化改写强度
系统 SHALL 依据 `CONTENT_POLICY_SEVERITY` 的 severe/mild 差异化改写指令强度：severe 类型（political/minor/selfharm）使用更强改写，mild 类型（violence/sexual/portrait/unknown）使用更保守改写以保留语义。

#### Scenario: severe 类型更强改写
- **WHEN** 敏感类型为 severe（如 minor）
- **THEN** 改写指令使用更强改写（更明确排除敏感元素）

#### Scenario: mild 类型保守改写
- **WHEN** 敏感类型为 mild（如 violence）
- **THEN** 改写指令使用保守改写（保留更多原文语义）