---
record: tt-workspage-frames
task: 头条作品页兜底判据改为跨 frame 匹配
date: 2026-10-23
---

## 本次执行记录：头条作品页跨 frame（tt-workspage-frames，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-workspage-frames` |
| 第一性原因（QM-5 ①） | ✅ | 前一版只把 `probe` 改跨 frame，但 `confirmPublished` 的**作品页兜底分支**另有一处独立的 `win.webContents.executeJavaScript`，仍只读主 frame ⇒ 端点未命中时必然 `works-page-timeout` |
| 逃逸分析（QM-5 ②） | ✅ | 两条判据路径各写一份读取逻辑（重复实现），改一处不覆盖另一处；测试 fake 无 mainFrame，跨 frame 分支在测试中不可见 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 兜底分支改为遍历 `framesInSubtree`，无 mainFrame 时回落到主 frame（保留 userGesture=true），并接受 `true` / `{hit:true}` 两种返回；`toutiao-artifact` **8 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 两处判据读取口径一致；后续新增判据应复用同一 frames 辅助函数 |
| 行尾与 diff 对账 | ✅ | 净增 9 行 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
