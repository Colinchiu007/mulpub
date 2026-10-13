---
record: docs-learnings-guard-reconcile
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：本轮教训沉淀（docs-learnings-guard-reconcile，2026-10-14）【docs-only】

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | PASS | 纯文档追加（`01-docs/learnings.md`），按 AGENTS.md 在共享主工作区就地改、经 PR 落地；**未创建 worktree**（共享根被他人改动占据，`-RequireClean` 拒建），故走 plumbing：临时索引 + tree/commit 组装，`.git/index` 指纹前后一致 |
| 第一性原因（QM-5 ①） | N/A | 本 PR 无代码缺陷可归因；承载体是本轮已合并的 guard 修复（PR #3491 / `74843fc40`）的教训沉淀 |
| 逃逸分析（QM-5 ②） | N/A | 同上：逃逸链已写在 #3491 的执行记录里（判据层/自愈层/取证层/观测层/审查层五层） |
| 修复 + 回归保护（QM-5 ④） | N/A | 修复与回归锁已在 #3491 落地（`session-write-guard.test.ps1` 50 checks、变异反证 rc=1） |
| 防止再次发生（QM-5 ⑤） | PASS | 本 PR 就是「防止再次发生」的载体：9 条教训写进 `01-docs/learnings.md`（含「无第二次机会的守护者」「行为用例证明不了调用发生」「变异没生效 ≠ 锁有效」「同一形态在函数边界重犯」「门禁的真实输入是生成的树」「plumbing 免 worktree 提交」「失败命令的空输出被读成通过」「R0 对目录无解」） |
| 远程同步 | PENDING | 合并后回填 merge SHA 并删除 ledger 登记项（同一次提交） |

- 保留门禁：行尾/编码对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING
