---
record: tt-artifact-frames
task: 头条作品页判据也改为跨 frame 读取（与视频号同型）
date: 2026-10-23
---

## 本次执行记录：头条判据跨 frame（tt-artifact-frames，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-artifact-frames` |
| 第一性原因（QM-5 ①） | ✅ | 真机 22:58 已完成「文件附加 → 点发布 → 确认弹窗(确定)」，但 `artifact 未命中：no-endpoint-hit / works-page-timeout` ⇒ 与视频号同型：发布成功但判据读不到页面内容 |
| 逃逸分析（QM-5 ②） | ✅ | 判据只在主 frame 执行；与视频号 `textLen=15` 完全同一类缺陷 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `probe` 改为遍历 `mainFrame.framesInSubtree`，任一 frame 命中即返回；主 frame 作为兜底保留；`toutiao-artifact` **8 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 与视频号同构的跨 frame 读法，后续新平台判据可直接复用该模式 |
| 行尾与 diff 对账 | ✅ | 净增 7 行 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
