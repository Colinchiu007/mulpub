---
record: tt-netjudge
task: 头条启用网络捕获并接入响应证据判定
date: 2026-10-23
---

## 本次执行记录：头条响应证据（tt-netjudge，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-netjudge` |
| 第一性原因（QM-5 ①） | ✅ | `rpa-view-platforms.js` L488 对头条**完全禁用**网络捕获（`platform === 'toutiao' ? null : …`）⇒ `requests` 恒空 ⇒ `no-endpoint-hit`、`responses=0`，只能靠页面判据；而页面判据在发布后 24 秒就超时（作品多半仍在审核） |
| 逃逸分析（QM-5 ②） | ✅ | 该行是历史特例，无注释说明原因；无「头条也必须采集响应」的用例；真机从未出现过头条的 `captured responses` 日志 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 去掉头条特例，与其他平台一致开启 `_startPublishNetworkCapture`，从而接入既有的「2xx + 发布类端点」响应判定；`rpa-view-platforms` **79 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 网络证据对所有平台统一采集；判据超时时必有响应读数，可区分「平台没收到」与「页面读不到」 |
| 行尾与 diff 对账 | ✅ | 单行替换 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 单行改动 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
