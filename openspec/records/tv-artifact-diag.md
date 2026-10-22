---
record: tv-artifact-diag
task: 视频号作品页判据加 URL/readyState 诊断并把等待提到 45s
date: 2026-10-23
---

## 本次执行记录：视频号判据诊断（tv-artifact-diag，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-artifact-diag` |
| 第一性原因（QM-5 ①） | ✅ | 真机 22:30:24 `[tencent_video] artifact 未命中（post-list-timeout:textLen=15）` —— 判据已执行但作品页正文仅 15 字；需区分「页面没跳转」与「跳转后白屏/未渲染」 |
| 逃逸分析（QM-5 ②） | ✅ | 判据只统计 textLen，未记录 URL 与 readyState；单元层无法覆盖真实站点渲染 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 默认等待 25s→45s；超时时追加一条诊断日志：`url=… readyState=… text=前80字`；`tencent-artifact` **5 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 诊断与判据解耦，超时必带 URL，下次可一眼区分两类失败 |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
