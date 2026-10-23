---
record: queue-delay-cap
task: 频控等待加上限与可观测日志（任务不再无限等待）
date: 2026-10-23
---

## 本次执行记录：频控等待上限（queue-delay-cap，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `queue-delay-cap` |
| 第一性原因（QM-5 ①） | ✅ | 频控未到窗口时任务被移出 `_queue` 放进 `_delayed` 并设 `setTimeout(requeue, waitMs)`；若 `waitMs` 异常大（时钟漂移/配置错误）任务会等到数小时甚至数天，而外部只看到 `running=0`、无报错、无 history |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「异常 waitMs」用例；集成层等待无上限；E2E 层把「不执行」当平台问题；审查层未核对 `waitMs` 的来源与边界 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①设 `MAX_FREQ_WAIT_MS = 15min` 并对 `setTimeout` 的 `waitMs` 取 `Math.min`；②进 `_delayed` 前打 `console.warn('[task-queue] 频控等待 task … Ns')`，让等待可观测；队列相关测试 **11 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 等待必须同时具备「上限」与「日志」；后续若再出现不执行，日志会直接给出等待秒数 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用既有队列测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 纯 JS 库 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机未验证；判据：日志出现 `[task-queue] 频控等待 task … Ns`，且 15 分钟内任务必被重新判定。
- 若日志显示等待值正常（如 60s）但任务仍不执行，则问题不在频控，需回到 `_processNext` 驱动链。
