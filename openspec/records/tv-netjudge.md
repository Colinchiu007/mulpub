---
record: tv-netjudge
task: 视频号判据改用网络响应取证（页面导航不生效）
date: 2026-10-23
---

## 本次执行记录：视频号响应取证（tv-netjudge，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-netjudge` |
| 第一性原因（QM-5 ①） | ✅ | 真机 23:36:54 诊断：`url=https://channels.weixin.qq.com/platform/post/create readyState=complete` ⇒ **判据的导航根本没发生**（不是白屏、不是加载慢）；此前基于"页面内容"的三种猜测全部被否证。同时发布期网络捕获已有 `responses=5`，故改走响应取证 |
| 逃逸分析（QM-5 ②） | ✅ | 判据只依赖 DOM 文本；无「导航未生效」用例；真机从未打印过捕获到的响应清单 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 超时分支前追加：`publish captured responses n=<条数> :: url [status] | …`（最多 8 条）；`rpa-view-platforms` **79 例**通过；行数 1483 |
| 防止再次发生（QM-5 ⑤） | ✅ | 判据失败时必带"本应发生的网络证据"，可区分「平台没收到」与「页面读不到」 |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅日志 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
