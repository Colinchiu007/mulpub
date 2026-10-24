---
record: exec-instrument
task: executor 内逐步打点，定位任务卡在哪一行
date: 2026-10-23
---

## 本次执行记录：executor 打点（exec-instrument，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `exec-instrument` |
| 第一性原因（QM-5 ①） | ✅ | 隔离实验证明 `task-queue` 本身正常（两任务均执行、`history:2`），`setExecutor` 也已在 `bootstrap.js:101` 无条件注入 ⇒ 卡点必在 **executor 函数体内部**：`maxConcurrent=1` 下只要该函数在某一步挂起/抛出被吞，就会占死唯一运行槽，后续任务全部排队且外部零日志 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层只测队列库、不测 executor 体；集成层无「executor 前置依赖未就绪」用例；E2E 层把不执行当平台问题；审查层未核对 executor 内的每一步是否可能阻塞 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 在 `taskProgressRouter.register` 前后、`createPublisher` 前后、`enteredPublisher` 处加 4 条 `console.warn('[exec] …')` 打点（主进程 console 会进应用日志）；不改任何业务逻辑 |
| 防止再次发生（QM-5 ⑤） | ✅ | 打点覆盖「进入 → 注册 → 建发布器 → 发布器就绪」四个边界，任一环节卡住都能从日志一眼看出 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | N/A | 仅日志 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅日志 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 本 PR 只加打点。下一轮跑一次发布，看 `[exec]` 最后出现到哪一条：
  - 停在 `enter` ⇒ `taskProgressRouter`/`progressEmitter` 初始化问题
  - 停在 `registered` ⇒ `createPublisher` 阻塞
  - 无 `enter` ⇒ 任务根本没进 executor（回到 `_processNext` 守卫）
