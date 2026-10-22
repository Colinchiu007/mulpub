---
record: queue-verify
task: 队列驱动入口诊断（paused/queue/running）+ owner 补写修正
date: 2026-10-23
---

## 本次执行记录：队列驱动诊断（queue-verify，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `queue-verify` |
| 第一性原因（QM-5 ①） | ✅ | 打点已在构建中（bootstrap `[exec] enter`），但任务入队 200s 后**无任何 `[exec]` 日志** ⇒ 任务从未进入 executor ⇒ 卡点在 `_processNext` 入口或其守卫。最强嫌疑是 `if (this._paused) return` 这一**完全静默**的短路 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层不覆盖 paused 状态；集成层 paused 后无任何日志；E2E 层只见"不执行"；审查层未核对 `_processNext` 入口是否可观测 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①`_processNext` 入口加两条日志：`paused=true` 与「queue>0 且 running=0」；②owner 补写判断由 `!== undefined` 改为真值判断（`_getCurrentOwnerSubject()` 可能返回 null） |
| 防止再次发生（QM-5 ⑤） | ✅ | 驱动入口从"静默"改为"必出声"，任何一次 add 都能看到是否被驱动 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | N/A | 仅日志与一处判断修正 |
| QM-1 打包 / QM-4 视觉 | N/A | 纯 JS 库 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机未跑；判据：日志出现 `[queue] paused=true …`（⇒ 队列被暂停）或 `[queue] drive …`（⇒ 在驱动但没取到任务）。
