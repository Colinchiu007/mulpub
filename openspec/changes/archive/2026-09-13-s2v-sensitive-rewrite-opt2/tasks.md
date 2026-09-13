## 1. 语义保留度算法增强（优化点 1）

- [ ] 1.1 TDD：`story2video-image-retry.test.js` 新增中文 n-gram 保留度用例（中文改写保留度 > 0 且高于整句切分）
- [ ] 1.2 TDD：`story2video-image-retry.test.js` 新增同义词词干化保留度用例（child→kid 保留度 > 0）
- [ ] 1.3 实现 `estimateSemanticRetention` 中文 bigram + 英文词干化，保留原关键词重叠兜底

## 2. 改写预检闭环（优化点 2）

- [ ] 2.1 TDD：`story2video-image-retry.test.js` 新增改写版含扩展敏感词被弃用用例
- [ ] 2.2 TDD：`story2video-image-retry.test.js` 新增改写版通过预检用例
- [ ] 2.3 实现 `EXTENDED_SENSITIVE_WORDS` 扩展词库 + 预检函数，接入重试循环

## 3. 敏感类型识别映射表（优化点 3）

- [ ] 3.1 TDD：`provider-error.test.js` 新增已知 provider 信号命中映射表用例
- [ ] 3.2 TDD：`provider-error.test.js` 新增未知信号回退文本分类用例
- [ ] 3.3 实现 `SENSITIVE_TYPE_SIGNAL_MAP` 映射表，`classifyContentPolicyType` 先查表后文本分类

## 4. negative_prompt 联动（优化点 4）

- [ ] 4.1 TDD：`story2video-image-retry.test.js` 新增生成 negative_prompt 用例（violence → no blood/no weapons）
- [ ] 4.2 实现 `buildContentPolicySafePrompt` 返回 negative_prompt，按敏感类型生成

## 5. LLM 改写成本预算控制（优化点 5）

- [ ] 5.1 TDD：`story2video-image-retry.test.js` 新增同提示词缓存复用用例
- [ ] 5.2 TDD：`story2video-image-retry.test.js` 新增超过调用上限回退用例
- [ ] 5.3 实现 `LLM_REWRITE_MAX_CALLS_PER_SCENE` 上限 + 哈希缓存

## 6. 审计统计反哺机制（优化点 6）

- [ ] 6.1 TDD：`story2video-image-retry.test.js` 新增低成功率类型生成调优建议用例
- [ ] 6.2 实现 `aggregateContentPolicyStats` 增加 `suggestions` 字段

## 7. 改写指令语言与原文匹配（优化点 7）

- [ ] 7.1 TDD：`story2video-image-retry.test.js` 新增中文原文用中文指令用例
- [ ] 7.2 TDD：`story2video-image-retry.test.js` 新增英文原文用英文指令用例
- [ ] 7.3 实现原文语言自动检测，选择 `_ZH` 或 provider/通用指令

## 8. 严重度差异化改写强度（优化点 8）

- [ ] 8.1 TDD：`story2video-image-retry.test.js` 新增 severe 类型更强改写用例
- [ ] 8.2 TDD：`story2video-image-retry.test.js` 新增 mild 类型保守改写用例
- [ ] 8.3 实现 `buildContentPolicySafePrompt` 依据严重度差异化改写强度

## 9. 集成与验证

- [ ] 9.1 运行 `story2video-image-retry.test.js`、`provider-error.test.js`、`story2video-stages.test.js` 全量测试
- [ ] 9.2 代码审查（Step ④ 6 大专项 + CCG ccg-review）
- [ ] 9.3 文档更新：PRD §7.1.5、CHANGELOG、learnings
- [ ] 9.4 质量门禁自检 + 提交 + 推送 + 创建 PR