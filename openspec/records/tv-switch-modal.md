---
record: tv-switch-modal
task: 视频号发布后关闭「切换视频号」弹窗，避免抢走点击
date: 2026-10-23
---

## 本次执行记录：视频号切换弹窗（tv-switch-modal，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-switch-modal` |
| 第一性原因（QM-5 ①） | ✅ | 真机日志（10-23）：点「发布」后 `publish verify snapshot` 出现 `modals:["切换视频号 取消切换", …]`，页面文本退化为空壳 ⇒ 弹窗抢走点击，`publish verification timeout` |
| 逃逸分析（QM-5 ②） | ✅ | 单元层无「弹窗文案不在白名单」的用例；集成层 `_confirmPublishDialog` 的 MODAL_TEXTS 不含「取消切换」；E2E 层把超时当未发布；审查层未按平台补充弹窗词表 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `_confirmPublishDialog` 开头对 `tencent_video` 先点「取消切换」（无该弹窗时零副作用），并打日志；`rpa-view-platforms` **79 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 平台专属弹窗处理写成显式分支 + 命中日志，便于下次一眼看出是否命中 |
| 行尾与 diff 对账 | ✅ | 提交前 numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |
| 远程同步 | 由门禁推导 | 合并后按主干历史推导归属 |

### 遗留（不假装已闭合）

- 真机未复跑；判据：日志出现「已关闭「切换视频号」弹窗」且 `publish verification` 不再 timeout。
- 封面仍报 `No file input found`（需先触发封面弹窗再找 input），单独排期。
