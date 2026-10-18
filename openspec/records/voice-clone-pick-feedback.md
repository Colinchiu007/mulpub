---
record: voice-clone-pick-feedback
task: 音色克隆入口按钮在文件选择期间不提前显示进行中文案，并改为「正在添加…」
date: 2026-10-18
---

## 本次执行记录：音色克隆按钮文案时序修正（voice-clone-pick-feedback，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（renderer 模板 + locale + 测试）：worktree `D:/Data/projects/mp-worktrees/mp-voice-clone-pick-feedback`，裸分支 `voice-clone-pick-feedback`，基线 `origin/main` `fd1f43068`；文档（PRD/CHANGELOG/本记录）同 PR 落地 |
| 第一性原因（QM-5 ①） | PASS | 引入提交 `fc77ae661`（2026-08-13「音色克隆选择文件后加入进行中占位行与状态反馈」）：为提供进行中反馈，把入口按钮文案绑到共享忙碌态 `s2vVoiceCloneLoading`；该标志在 `chooseS2VVoiceCloneSamples` 调用 `chooseTtsVoiceCloneSamples`（主进程 `dialog.showOpenDialog` 的 IPC）**之前**置位（现行代码 `apps/desktop/src/views/video-creation/composables/tts-voices-clone.js:30-34`，该行由 `e11565b0a` 从 CreateView.vue 抽出，语义未变），因此系统文件选择器打开期间文案即为「正在克隆…」。同时该阶段实际动作是选定文件后的自动保存/添加，而非克隆本身 |
| 逃逸分析（QM-5 ②） | PASS | ① 单元层：composable 无「choose pending 期间」的时序用例；② 集成层：`CreateView.test.js:1045` 把 `chooseTtsVoiceCloneSamples` mock 成**立即 resolve**，只断言 `await` 之后的状态，永远观察不到文件对话框打开期间的渲染；③ 断言层：该用例把「正在克隆…」写成期望值，**把缺陷锁成了正确行为**；④ 审查层：PRD 原文写的是「选择本地音频文件后自动克隆期间」，实现提前到选择返回前，无测试能区分「后」与「前」 |
| 修复 + 回归保护（QM-5 ④） | PASS | 文案改由 `s2vVoiceClonePending` 驱动（该状态只在选定文件返回、`addTtsVoiceClone` 开始时置位；文件浏览期间为 null）。`S2vConfigPanels.vue` 入口按钮补 `data-testid=s2v-voice-clone-choose-button`；locale 文案改「正在添加…」/`Adding...`（zh/en 成对）。回归：`S2vConfigPanels.test.js` 3 条模板契约（仅 loading、无 pending ⇒ 文案保持「选择本地音频文件」；pending ⇒ 「正在添加…」且优先于「重新选择」；添加结束 ⇒ 恢复「重新选择」）+ `CreateView.test.js` 2 条时序回归（deferred `choose` 期间文案不变且无状态行/占位行，resolve 后才切「正在添加…」；取消选择不进入添加态、不报错） |
| 防止再次发生（QM-5 ⑤） | PASS | ① PRD §7.1.4 两处补写显式时序（浏览期间不改文案、选定返回后才显示「正在添加…」）；② 模板内注释写明「文案只由 pending 驱动，不能用 loading」，防止后续维护者回退；③ 新增 5 条测试锁住「per-pick 等价的 deferred IPC」这一此前完全缺失的测试形态；本记录登记逃逸链 |
| 行尾与 diff 对账 | PASS | 所有改动文件沿用仓库 CRLF 档（node 计数：bareLF=0）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径相等（见提交前实测） |
| 接线棘轮 | PASS | 未新增 `*.test.js` 文件，只扩充既有 `S2vConfigPanels.test.js` 与 `CreateView.test.js`（两者已在 `quality-gate.yml` 的 Desktop Shards 内执行），无需新增 workflow 点名 |
| TDD 两段实跑 | PASS | 红：`S2vConfigPanels.test.js` 3 条新用例因按钮 testid 不存在而红（3 failed / 11 passed）；`CreateView.test.js` 2 条时序用例同因红（2 failed / 300 skipped）。绿：实现后 `S2vConfigPanels` 14 passed；克隆域相关 5 个测试文件 **331 passed / 0 failed** |
| QM-1 打包 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`；纯渲染层模板 + locale |
| QM-4 视觉 | N/A | 默认/空闲态文案与布局逐字不变（仍为「选择本地音频文件」）；只改「选定文件后添加中」的瞬时文案与驱动状态，不新增/移动任何视觉元素，既有基线截图无对应状态 |
| QM-6 CCG 双模型外部评审 | 见下 | 见「QM-6 现场」 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由主干历史（squash 尾注 `(#NNNN)`）推导归属 |

### 测试与实跑

- 红阶段（实现前）：`pnpm exec vitest run src/views/video-creation/S2vConfigPanels.test.js` ⇒ **3 failed / 11 passed**；`pnpm exec vitest run src/views/CreateView.test.js -t "浏览系统文件选择器期间按钮文案不变|取消本地文件选择时"` ⇒ **2 failed / 300 skipped**。
- 绿阶段（实现后）：`S2vConfigPanels.test.js` ⇒ **14 passed**；`CreateView.test.js + CreateView.voice-clone-delete-guard.test.js + s2v-options-autosave.test.js + useTtsVoices.test.js + s2v-panel-contract.parent-keys.test.js` ⇒ **331 passed / 0 failed**（5 files）。
- 关键断言：文件对话框打开期间（`choose` promise 未 resolve）`s2vVoiceCloneLoading=true` 但按钮文案仍为「选择本地音频文件」、无 `s2v-voice-clone-status` / `s2v-voice-clone-pending-row`；resolve 后 `s2vVoiceClonePending` 置位，按钮才切「正在添加…」。
- 取消路径按主进程真实合同构造：`tts-voice-clone:choose-samples` 在 `result.canceled===true` 时返回 `{ code: 0, data: { paths: [] } }`（`apps/desktop/electron/ipc-handlers/tts-voice-clone.js:170`）。

### QM-6 现场

PENDING（提交前填写判定与实际执行结果；不以自审冒充通过）。

### 遗留（不假装已闭合）

- 真实系统文件对话框的打开/取消未在本机以真实 Electron 窗口手工复验；本轮证据止于渲染层 IPC mock 的时序契约与主进程返回形状对账。真实窗口复验需用户侧重启应用后按 PRD 时序自检。
- 本记录不包含 QM-6 之外的其他平台（macOS/Linux）差异；该 UI 文案与原生对话框行为跨平台一致，无平台分支。
