---
record: prd-publish-queue
task: 补写发布队列频控与判据 PRD
date: 2026-10-23
---

## 本次执行记录：发布队列与判据 PRD（prd-publish-queue，2026-10-23）【docs-only】

- 判定：新增 `01-docs/PRD-PUBLISH-QUEUE-AND-JUDGE-2026-10-23.md`，纯文档
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅
- 内容：频控两档 + 日配额数据校验、完整链路流程、强制可观测字段（含「console 不入日志」约束）、入队前预检返回码与提示文字、四平台判据表、验收标准
- 备注：来源为 2026-10-22~23 真机排查（`[queue] blocked bucket=account reason=interval remainingMs≈74min`）

| 远程同步 | 由门禁推导 |
