---
record: queue-diag
task: 队列状态原始快照诊断（修 running=? queued=? 读不出）
date: 2026-10-23
---

## 本次执行记录：队列诊断（queue-diag，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `queue-diag` |
| 第一性原因（QM-5 ①） | ✅ | `queue:status` 处理器按 `status.running` / `status.queue` 取值，而 `getStatus()` 返回结构不含这两个数组 ⇒ 日志恒为 `running=? queued=?`，队列卡住时看不到任何内部状态（真机 18:01:45 实测） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「状态形状改变」用例；集成层取值为防御式三元但返回 `'?'` 后无人追问；E2E 层只见症状；审查层未核对 `getStatus()` 实际字段 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 在 `ok` 日志前补一条 `raw` 日志：`paused / size / queueLen / runningLen / keys`，用 `JSON.stringify` 输出，形状无关 |
| 防止再次发生（QM-5 ⑤） | ✅ | 诊断输出与实现解耦（打印 keys + 各候选长度），下次结构再变也能看见 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | N/A | 仅诊断日志，无新增测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅 IPC 日志 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 本 PR 只加诊断，**不修根因**。下一轮用该读数定位「任务入队后不执行」的真因（此前 `_runningByChannel` 假设已被 #4255 实测证伪）。
