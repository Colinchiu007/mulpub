---
record: ux-audit-automation-notify-first
task: 自动化页后台通知的注册必须先于首屏请求（UX 审计 2.4）
date: 2026-10-20
branch: ux-audit-automation-notify-first
---

# 执行记录：AutomationView 通知注册时机

## 0. 变更类型与隔离

渲染层 `apps/desktop/src/views/AutomationView.vue` 一处顺序调整 + 新测试文件 + 文档。独立 worktree `mp-ux-audit-automation-notify-first`（起点 = 当时 `origin/main`），经 PR 落地。未触 electron 主进程 ⇒ QM-1 N/A；未触颜色/尺寸 ⇒ 像素不变。

## 1. QM-5 五步

1. **第一性原因**：`onMounted` 写成 `await load()` 之后才 `onAutomationNotification(...)`。通知是推送语义（不排队、不补发），首屏请求在飞的窗口内没有监听者 ⇒ 那一条永久丢失。
2. **测试逃逸链**：既有 `AutomationView.test.js` 只在 mount 之后（`await flushPromises()` 之后）才调 `mockState.notifier`，即它测的永远是"注册完成之后"的状态，**窗口期在测试里不可表示**；集成/E2E/视觉/审查四层同形漏过。分类：**测试场景缺失**（没人把"请求 pending 时来通知"当成一个场景）。
3. **系统性漏洞**：仓内对"事件监听注册必须先于任何 await"没有机械判据，只有 AGENTS 的两条散文（「宿主事件的置位与收口」「全局单例事件监听器生命周期」）。本批不新增全局门禁（属改"谁来守门"，需人工批准），改为在本视图落一条顺序行为锁。
4. **修复 + 回归保护**：注册移到 `await load()` 之前；新文件 4 条锁（顺序 + 窗口期内 error 档 + 窗口期内 recovered 档 + 空载荷负控）。
5. **防再犯**：PRD 新增《自动化页后台通知的注册时机合同》，把顺序、分档、空载荷、收口、"只注册一次"全部写成条款，并把本批方法学教训写进验收锚点段。

## 2. 本批最有价值的一条方法学（自己犯的错）

顺序锁第一版期望写成 `['list','register']` —— 那正是**被禁形态**。它在修复前红、修复后**也**红，看起来完全像"TDD 正常工作"；只有当我"让期望通过"时才会把缺陷永久钉成契约。当场暴露它的是**红之后去读实际读数**（`AssertionError: expected ['register','list'] to deeply equal ['list','register']`）并判断"是代码错还是期望错"。

口径：顺序/等值型断言首次变红时先归因（代码 vs 期望），再决定改哪一侧；改完必须重新做一次**取被禁形态本身**的反证，否则"改正期望"与"改宽判据"在现场完全同形。

## 3. 门禁读数

| 门禁 | 状态 | 证据 |
|---|---|---|
| TDD 红→绿 | PASS | 修复前 `4 failed`；修复后 `Test Files 2 passed`（新文件 4 条 + 既有 `AutomationView.test.js` 全量） |
| 反证 | PASS | 把 `await load()` 挪回注册之前（被禁形态原样重造）⇒ `RED_COUNT=4`，四条各自指名变红；`RESTORE byteEqual=true` |
| 消费者并集 | PASS | 该视图既有测试仅 `AutomationView.test.js` 一个，同跑通过 |
| QM-1 / QM-4 | N/A | 未触 electron / 未触颜色尺寸 |
| CJK / 品牌 / 绝对路径 / max-lines | PASS | 见 PR 当场读数 |
| 行尾两口径对账 | PASS | `--numstat` 与 `--ignore-cr-at-eol --numstat` 一致 |
| 旧载体冻结 | PASS | 只写本篇 |
| 远程同步 | 由门禁推导 | 不写状态词、不做回填提交 |
| QM-6 | 见 PR | 判级由 `ccg-review-decider.js` 自己落；非 `dual` 时无欠账，若判 `dual` 且未闭合则合并交回人工 |
