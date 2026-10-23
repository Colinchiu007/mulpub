---
record: tt-add-video
task: 头条视频发布前先点「添加视频」，使 file input 出现
date: 2026-10-23
---

## 本次执行记录：头条附加视频（tt-add-video，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-add-video` |
| 第一性原因（QM-5 ①） | ✅ | 真机按钮 dump：`url=.../xigua/upload-video` 且**「添加视频」仍存在且 enabled** ⇒ 视频文件从未附加。该页 file input 只在点「添加视频」后出现，直接查 `input[type=file]` 必然为空 ⇒ 上传整段被跳过 ⇒ 标题/正文/发布全部落空 ⇒ `no work ID` + `no-endpoint-hit` |
| 逃逸分析（QM-5 ②） | ✅ | `publish-precondition.js` L10-11 已记录同形态（`file input hasVideo=true selectorCount=0`）但未对 toutiao 视频 fail-fast；单元层无「按钮先出现/后出现」用例 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 在 `_runVideoUpload` 之前，对 `toutiao` 先点「添加视频/上传视频」并等 1.5s；无按钮时不阻塞主流程；`rpa-view-platforms` **79 例**通过；行数 1483 |
| 防止再次发生（QM-5 ⑤） | ✅ | 打点 `[toutiao] add-video CLICKED|NO_BTN`，下次一眼可见是否点到 |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
