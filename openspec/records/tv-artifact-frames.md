---
record: tv-artifact-frames
task: 视频号作品列表判据改为遍历所有子 frame（壳页 textLen=15 的根因）
date: 2026-10-23
---

## 本次执行记录：视频号判据跨 frame 读取（tv-artifact-frames，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-artifact-frames` |
| 第一性原因（QM-5 ①） | ✅ | 真机 `artifact 未命中（post-list-timeout:textLen=15）`；**15 恰等于壳页文本「视频号 · 助手 9 退出登录」的长度** ⇒ 判据读的是顶层壳页，而作品列表渲染在子 iframe 内（与发布页 `/micro/content/post/create` 同构） |
| 逃逸分析（QM-5 ②） | ✅ | 判据只在主 frame 执行 `executeJavaScript`；单元测试的 fake win 也没有子 frame，因此该缺陷在测试层完全不可见 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 轮询改为遍历 `mainFrame.framesInSubtree`，任一 frame 命中即成功，长度累加用于诊断；测试 fake 增加 `mainFrame.framesInSubtree`；`tencent-artifact` **5 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 判据与「壳页 + 子 iframe」结构对齐；诊断日志输出合计长度，可区分"全空"与"壳页非空" |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
