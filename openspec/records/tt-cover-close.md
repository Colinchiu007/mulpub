---
record: tt-cover-close
task: 头条封面失败后关闭弹窗，避免遮挡发布按钮
date: 2026-10-23
---

## 本次执行记录：封面弹窗关闭（tt-cover-close，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tt-cover-close` |
| 第一性原因（QM-5 ①） | ✅ | 真机 `cover path failed: no-next`（下一步 20s 不可点）后**直接 return，未关闭弹窗**；随后 `publishing...` 与「确定」点击均发生在弹窗仍打开的状态下。用户核对：**头条作品列表无新内容** ⇒ 点击落在遮罩上，未真正提交 |
| 逃逸分析（QM-5 ②） | ✅ | 失败分支只返回状态码，无「失败后必须恢复到可交互状态」的约束；测试只覆盖成功路径 |
| 修复 + 回归保护（QM-5 ④） | ✅ | `no-next` 分支追加：点「取消/关闭/×」关闭弹窗 + 800ms 等待，再返回失败；`toutiao-cover` **7 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 任何「打开弹窗后失败」的路径都必须先关闭再返回，避免污染后续步骤 |
| 行尾与 diff 对账 | ✅ | 净增 7 行 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |
## R5 结构锁与债务登记（2026-10-23 追加）

- 新增 `apps/desktop/tests/toutiao-cover-r5-lock.test.js`（2 例）：断言 `no-next` 失败分支返回前存在 `取消/关闭/×` 动作，并断言 `cover dialog closed after failure` 日志存在（防改名真空通过）。
- **债务**：同一文件另有 **8 处** `return { ok: false }` 尚未补齐「失败前关闭弹窗」。锁暂只覆盖 `no-next`；补齐后将判据扩展为「全部失败返回」。
- 该债务与逆向风险清单 R5「失败分支不复位 UI 状态」同型（R5 原审计面只覆盖 Vue 组件，未覆盖 `rpa-view-*`）。
## R5 补齐（2026-10-23 第二轮）

- 9 处失败返回逐一判定：**只有 3 处发生时弹窗必然已打开**（`no-next` ×2 / `no-local-tab` / `set-file-failed`），其余 5 处（`clicked-trigger` ×2、`no-dialog` ×2、`no-cover-path`）发生时弹窗尚未打开，不要求关闭。
- 新增模块级 `closeCoverDialog(win, log, platform)`：点「取消/关闭/×」+ 800ms 等待 + 记 `cover dialog closed after failure`。
- 4 处（`no-next` 两处 + 另两处）全部接入。
- 锁扩展为「三类必关失败 ⇒ 必须有 closeCoverDialog」，并保留「辅助函数存在」防真空通过。
- 结果：`toutiao-cover-r5-lock` **2 例** + `toutiao-cover` **7 例** = **9 例全过**。
