---
record: queue-owner-fix
task: 修复身份模式下任务被恒判「非当前用户」而永不执行
date: 2026-10-23
---

## 本次执行记录：队列 owner 归属修复（queue-owner-fix，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `queue-owner-fix` |
| 第一性原因（QM-5 ①） | ✅ | `_isTaskOwnedByCurrentUser(task)`：注入 owner provider 时要求 `task.owner_subject === 当前 owner`；而 `publish:batch` 从不写该字段 ⇒ 恒为 false ⇒ `_processNext` 把任务推回队列 `continue`，永不执行、零报错。真机侧证：加 `[exec] enter` 打点后**一条都没有**（任务从未进 executor） |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「provider 已注入但任务无 owner」用例；集成层只测无 provider 的单用户路径；E2E 层把不执行当平台/队列问题；审查层未核对 `add()` 与 `_isTaskOwnedByCurrentUser` 的字段契约 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `add()` 入口补写 owner：`task.owner_subject ??= _getCurrentOwnerSubject()`（不可变式 `{...task}`）；新增 `tests/task-queue-owner-stamp.test.js` 2 例（provider 下两任务都执行 / 无 provider 行为不变），队列相关合计 **13 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 入队即固化归属，调用方无需感知；两条用例分别锁「有 provider」与「无 provider」，防止回归到任一极端 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | 新测试随 `packages/shared-utils/tests` 执行 |
| QM-1 打包 / QM-4 视觉 | N/A | 纯 JS 库 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 隔离验证（本轮已完成）

```
q.setOwnerSubjectProvider(() => 'user-A') 后 add 两个任务
→ ran: ["task_1_…","task_2_…"]
→ status: {"pending":0,"running":0,"delayed":0,"history":2,"paused":false}
→ PASS
```

### 遗留（不假装已闭合）

- 真机未复跑；判据：`publish:batch ok` 之后出现 `[exec] enter`（打点 PR #4262）与发布执行日志。
