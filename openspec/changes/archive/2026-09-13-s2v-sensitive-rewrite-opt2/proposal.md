# Proposal: 图片敏感内容改写策略增强（优化点 1-8）

## Why

图片生成的内容安全改写（`story2video-image-retry.js`）已具备信号识别、敏感类型分级、模板/LLM 改写、语义保留度、审计统计等基础能力（PRD §7.1.5）。但存在 8 个可优化点：语义保留度算法对中文/同义词失真、改写后缺少预检闭环、敏感类型识别依赖错误文本、改写指令未联动 negative_prompt、LLM 改写无成本预算、审计统计只产出未消费、改写指令语言与原文不匹配、严重度未差异化改写强度。这些直接影响改写成功率与语义保留度两个核心指标。

## What Changes

- **优化点 1 — 语义保留度算法增强**：`estimateSemanticRetention` 从纯关键词重叠率升级为中文 n-gram + 英文词干化，提升中文/同义词场景的保留度估算准确性（`story2video-image-retry.js`）。
- **优化点 2 — 改写后预检闭环**：新增本地扩展敏感词库预检（覆盖供应商审核规则之外的常见敏感词），改写版发送前先预检，减少无效重试次数。
- **优化点 3 — 敏感类型识别映射表**：新增「provider → 错误信号 → 敏感类型」映射表，提升 `classifyContentPolicyType` 对 `unknown` 兜底率的降低。
- **优化点 4 — negative_prompt 联动**：改写时同步生成 negative_prompt（排除敏感元素），正向保留原文语义，负向排除敏感内容，兼顾保留度与安全性。
- **优化点 5 — LLM 改写成本预算控制**：为 LLM 改写设置每场景调用上限与结果缓存（同 prompt 哈希命中复用），避免无谓消耗 LLM 额度。
- **优化点 6 — 审计统计反哺机制**：`aggregateContentPolicyStats` 输出接入调优建议（低成功率类型增强改写指令、高频 unknown 补充信号词），形成「统计 → 调优」闭环。
- **优化点 7 — 改写指令语言与原文匹配**：按原文语言自动选择改写指令语言（已有 `_ZH` 表，改为自动检测而非硬编码）。
- **优化点 8 — 严重度差异化改写强度**：`CONTENT_POLICY_SEVERITY` 的 severe/mild 差异化改写指令强度（severe 更强改写，mild 更保守保留）。

## Capabilities

### New Capabilities
- `story2video-sensitive-rewrite`: 图片敏感内容改写策略增强（语义保留度算法、改写预检、敏感类型映射、negative_prompt 联动、LLM 成本预算、审计反哺、语言匹配、严重度差异化）

### Modified Capabilities
<!-- 无既有 spec 覆盖该能力域，本次为新增 -->

## Impact

- 代码：`apps/desktop/electron/services/story2video-image-retry.js`、`apps/desktop/electron/services/story2video-stages.js`、`apps/desktop/electron/services/asset-generator.js`、`apps/desktop/electron/services/adapters/_base/provider-error.js`
- 测试：`apps/desktop/electron/services/story2video-image-retry.test.js`、`apps/desktop/electron/services/story2video-stages.test.js`、`apps/desktop/electron/services/adapters/_base/provider-error.test.js`
- 文档：`01-docs/PRD.md` §7.1.5、`CHANGELOG.md`、learnings
- 无契约破坏；无新依赖。