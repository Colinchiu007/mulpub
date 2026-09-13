## 1. 实现

- [x] 1.1 RewriteView.vue：策略选择区块（radio + 下拉 + 策略列表加载）
- [x] 1.2 RewriteView.vue：自动匹配预览（挂载 + platform watch + 失败降级）
- [x] 1.3 RewriteView.vue：startRewrite 传 strategyId（手动=所选，自动=null）
- [x] 1.4 zh.js / en.js 成对新增 rewritePage 策略文案

## 2. 测试

- [x] 2.1 RewriteView.test.js：默认自动匹配、切换手动出现下拉
- [x] 2.2 RewriteView.test.js：预览显示与平台切换刷新、失败降级
- [x] 2.3 RewriteView.test.js：手动传 strategyId / 自动传 null
- [x] 2.4 本地运行 RewriteView 相关测试通过（24 passed，AiWriterPanel 回归 19 passed）

## 3. 文档与交付

- [x] 3.0 review.md 记录双模型审查结论与修复（见本目录 review.md）
- [x] 3.1 PRD-REWRITE-FRONTEND-ENTRY.md 补策略选择与预览规格（字段/交互/校验/提示文字）
- [x] 3.2 双模型审查（opencode + claude）并记录 review.md（Claude 完成，1 必修+4 应修已全部修复；opencode 首次未收到任务，已用最终 diff 重试复审）
- [ ] 3.3 push GitHub + PR + CI 通过后合并（PR #1717，CI 重跑中）
- [ ] 3.4 openspec archive + CCG task 归档 + 记忆沉淀
