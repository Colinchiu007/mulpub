---
record: tv-resolve-host
task: 视频号上传主机改为从 Step1 响应动态解析（平台自身即如此）
date: 2026-10-23
---

## 本次执行记录：动态解析上传主机（tv-resolve-host，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-resolve-host` |
| 第一性原因（QM-5 ①） | ✅ | ①直连探测：`finder.video.qq.com/applyuploaddfs` → `Parse Error: Expected HTTP/`；逆向给的 `finderassistancea/d` → **404**（已失效）。②抓取创作者页自身 `chunk-common.7dbff146.js`（2.5MB）实证：平台用 `setHost(e){this.HOST="//"+…}` **运行时设置**上传主机，URL 由 `this.HOST` 动态拼接 ⇒ **主机不是常量**，硬编码必错 |
| 逃逸分析（QM-5 ②） | ✅ | 我方实现把主机写成常量（原 `DEFAULT_CDN_BASE`），Step1 响应只取 `authKey` 而丢弃其它字段；单测注入假客户端，主机差异不可见 |
| 修复 + 回归保护（QM-5 ④） | ✅ | Step1 解析 `cdnHost/host/uploadHost`（含 `data.*` 嵌套），带 scheme 归一化，赋值 `this.cdnHost` 并打日志；三处上传 URL 改为 `this.cdnHost + '/path'`（为空时保持原相对路径行为）；`shipinhao` **15 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 主机来源单一（Step1），不再散落常量；日志可观测解析结果 |
| 行尾与 diff 对账 | ✅ | 净增 11 行 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
