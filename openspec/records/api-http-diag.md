---
record: api-http-diag
task: http-base 失败信息补 method+url（视频号 API 轨 Parse Error 定位）
date: 2026-10-23
---

## 本次执行记录：HTTP 失败请求可定位（api-http-diag，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `api-http-diag` |
| 第一性原因（QM-5 ①） | ✅ | 视频号真机：`API publish tencent_video: http-base: request failed: Parse Error: Expected HTTP/, RTSP/ or ICE/` —— 传输层错误，但错误信息**不含是哪个请求**，无法定位是 base URL、分片上传 URL 还是代理注入 |
| 逃逸分析（QM-5 ②） | ✅ | `requestWithRetry` 的 catch 只拼 `e.message`，不拼 `requestConfig.method/url`；无「错误信息必须可定位请求」的约定 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 错误信息改为 `http-base: request failed at <METHOD> <URL>: <msg>`，保留原 errorCode；api-publish-engine http 相关测试 **6 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 后续所有 HTTP 失败都自带请求坐标，避免「知道失败但不知失败在哪」 |
| 行尾与 diff 对账 | ✅ | 单行替换 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅错误文案 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
