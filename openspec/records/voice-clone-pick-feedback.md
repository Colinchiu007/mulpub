---
record: voice-clone-pick-feedback
task: 音色克隆入口按钮在文件选择期间不提前显示进行中文案，并改为「正在添加…」
date: 2026-10-18
---

## 本次执行记录：音色克隆按钮文案时序修正（voice-clone-pick-feedback，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（renderer 模板 + locale + 测试）：worktree `<仓库父目录>/mp-worktrees/mp-voice-clone-pick-feedback`，裸分支 `voice-clone-pick-feedback`，基线 `origin/main` `fd1f43068`；文档（PRD/CHANGELOG/本记录）同 PR 落地 |
| 第一性原因（QM-5 ①） | PASS | 引入提交 `fc77ae661`（2026-08-13「音色克隆选择文件后加入进行中占位行与状态反馈」）：为提供进行中反馈，把入口按钮文案绑到共享忙碌态 `s2vVoiceCloneLoading`；该标志在 `chooseS2VVoiceCloneSamples` 调用 `chooseTtsVoiceCloneSamples`（主进程 `dialog.showOpenDialog` 的 IPC）**之前**置位（现行代码 `apps/desktop/src/views/video-creation/composables/tts-voices-clone.js:30-34`，该行由 `e11565b0a` 从 CreateView.vue 抽出，语义未变），因此系统文件选择器打开期间文案即为「正在克隆…」。同时该阶段实际动作是选定文件后的自动保存/添加，而非克隆本身 |
| 逃逸分析（QM-5 ②） | PASS | ① 单元层：composable 无「choose pending 期间」的时序用例；② 集成层：`CreateView.test.js:1045` 把 `chooseTtsVoiceCloneSamples` mock 成**立即 resolve**，只断言 `await` 之后的状态，永远观察不到文件对话框打开期间的渲染；③ 断言层：该用例把「正在克隆…」写成期望值，**把缺陷锁成了正确行为**；④ 审查层：PRD 原文写的是「选择本地音频文件后自动克隆期间」，实现提前到选择返回前，无测试能区分「后」与「前」 |
| 修复 + 回归保护（QM-5 ④） | PASS | 文案改由 `s2vVoiceClonePending` 驱动（该状态只在选定文件返回、`addTtsVoiceClone` 开始时置位；文件浏览期间为 null）。`S2vConfigPanels.vue` 入口按钮补 `data-testid=s2v-voice-clone-choose-button`；locale 文案改「正在添加…」/`Adding...`（zh/en 成对）。回归：`S2vConfigPanels.test.js` 4 条模板契约（仅 loading、无 pending ⇒ 文案保持「选择本地音频文件」；pending ⇒ 「正在添加…」且优先于「重新选择」；添加结束 ⇒ 恢复「重新选择」；已选样本重选期间（loading + selection + 无 pending）⇒ 保持「重新选择音频文件」，QM-6 评审 Info 采纳补锁）+ `CreateView.test.js` 2 条时序回归（deferred `choose` 期间文案不变且无状态行/占位行，resolve 后才切「正在添加…」；取消选择不进入添加态、不报错） |
| 防止再次发生（QM-5 ⑤） | PASS | ① PRD §7.1.4 两处补写显式时序（浏览期间不改文案、选定返回后才显示「正在添加…」）；② 模板内注释写明「文案只由 pending 驱动，不能用 loading」，防止后续维护者回退；③ 新增 6 条测试锁住「pick 期间的 deferred IPC 渲染」这一此前完全缺失的测试形态（其中重选边界由 QM-6 评审补出）；本记录登记逃逸链 |
| 行尾与 diff 对账 | PASS | 所有改动文件沿用仓库 CRLF 档（node 计数：bareLF=0）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径相等（见提交前实测） |
| 接线棘轮 | PASS | 未新增 `*.test.js` 文件，只扩充既有 `S2vConfigPanels.test.js` 与 `CreateView.test.js`（两者已在 `quality-gate.yml` 的 Desktop Shards 内执行），无需新增 workflow 点名 |
| TDD 两段实跑 | PASS | 红：`S2vConfigPanels.test.js` 3 条新用例因按钮 testid 不存在而红（3 failed / 11 passed）；`CreateView.test.js` 2 条时序用例同因红（2 failed / 300 skipped）。绿：实现后 `S2vConfigPanels` **15 passed**（含 QM-6 评审后补的重选边界锁）；克隆域相关 6 个测试文件 **346 passed / 0 failed** |
| QM-1 打包 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/`；纯渲染层模板 + locale |
| QM-4 视觉 | N/A | 默认/空闲态文案与布局逐字不变（仍为「选择本地音频文件」）；只改「选定文件后添加中」的瞬时文案与驱动状态，不新增/移动任何视觉元素，既有基线截图无对应状态 |
| QM-6 外部评审（decider=SINGLE） | 部分完成（如实登记） | 官方 `deep-review.sh` 因 `codeagent-wrapper.exe` 超时未闭环（artifact `status=error`）；降级由 opencode 单轴实审交付 2 Info（1 采纳补锁、1 有据驳回）；claude 直连三次挂起未交付，不冒充通过。详见「QM-6 现场」 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由主干历史（squash 尾注 `(#NNNN)`）推导归属 |

### 测试与实跑

- 红阶段（实现前）：`pnpm exec vitest run src/views/video-creation/S2vConfigPanels.test.js` ⇒ **3 failed / 11 passed**；`pnpm exec vitest run src/views/CreateView.test.js -t "浏览系统文件选择器期间按钮文案不变|取消本地文件选择时"` ⇒ **2 failed / 300 skipped**。
- 绿阶段（实现后）：`S2vConfigPanels.test.js` ⇒ **15 passed**；`CreateView.test.js + CreateView.voice-clone-delete-guard.test.js + s2v-options-autosave.test.js + useTtsVoices.test.js + s2v-panel-contract.parent-keys.test.js + S2vConfigPanels.test.js` ⇒ **346 passed / 0 failed**（6 files）。
- 关键断言：文件对话框打开期间（`choose` promise 未 resolve）`s2vVoiceCloneLoading=true` 但按钮文案仍为「选择本地音频文件」、无 `s2v-voice-clone-status` / `s2v-voice-clone-pending-row`；resolve 后 `s2vVoiceClonePending` 置位，按钮才切「正在添加…」。
- 取消路径按主进程真实合同构造：`tts-voice-clone:choose-samples` 在 `result.canceled===true` 时返回 `{ code: 0, data: { paths: [] } }`（`apps/desktop/electron/ipc-handlers/tts-voice-clone.js:170`）。

### QM-6 现场

**判定器**：`ccg-review-decider.js` ⇒ `SINGLE`（源码变更 140 行 ≤ 200、无敏感命中；`required=true`，期望 claude 单模型深度审查）。

**官方通道 `sh scripts/deep-review.sh`：失败，未闭环**。依赖体检通过（claude/opencode 均解析到绝对路径），但引擎调用 `codeagent-wrapper.exe`（`<HOME>/.claude/bin/codeagent-wrapper.exe`）在 600s 后 `spawnSync ... ETIMEDOUT`；判定产物 `.ccg/reviews/627ab65e….json` 的 `deepReview.status` = `error`（`error` 字段保留原始超时，本机 home 路径按本仓 Gate 12c 要求改写为 `<HOME>` 占位符）。另测得该 wrapper 对最小探活 `echo OK` 也挂起（120s 无返回，随后终止），属本机通道故障，不是本 PR 触发。**未把该产物改写为 PASS/cleared**。

**降级处置（AGENTS「子代理降级」：不盲等）**：
- **opencode（外部模型，plan agent，只读）**：交付 2 条 Info，无 Critical/Warning。
  - Info #1（采纳）：`S2vConfigPanels.test.js` 缺少「已有样本重选期间」（`loading=true`、`selection` 非空、`pending=null）文案保持「重新选择音频文件」的锁。已在 `S2vConfigPanels.test.js` 补 1 条用例，面板测试 14 → **15 passed**；反证：把模板条件退回 `loading` 驱动时该用例与其余 3 条原子句同时变红（红阶段基线已证）。
  - Info #2（不采纳，附可证伪理由）：称 `choose` 成功后 `loading=false` 到 `add` 置 `pending` 之间有「按钮短暂可点/文案回退」窗口。核实：`tts-voices-clone.js` 在该点之后**同一同步片段内**直接调用 `addS2VVoiceClone`，且后者的 `s2vVoiceCloneLoading=true` / `s2vVoiceClonePending=…` 写入都发生在其首个 `await addTtsVoiceClone(...)` 之前；Vue 的 DOM patch 在该任务结束后的微任务才执行，浏览器不可能在同步 JS 中间完成一次点击。无渲染中间态 ⇒ 不改。
- **claude（本机单模型通道）**：直连 `claude -p` 三次尝试均未交付结论，**不记为通过**：① 文件读取式提示：21 分钟无输出、CPU 近零后终止；② 内联 diff 提示 + `--permission-mode dontAsk`：10.7 分钟无输出、CPU 0.28s/6s 后终止；③ `--dangerously-skip-permissions`：15.7 分钟无输出、末次采样 CPU 0.03s/6s 后终止。另 `--setting-sources ""` 会报 `Not logged in`（清空设置同时清掉凭据），该变体不可用。
- **结论**：本 PR 的外部评审由 opencode 单轴实际完成（2 Info，1 采纳 1 有据驳回），claude 轴不可用且如实登记；`mode=single`，`check-pr-exec-record` 的闭环强制仅作用于 `mode=dual`（判据见 `scripts/check-pr-exec-record.js:evaluateDeepReviewDebt` 的 `if (rec.mode !== 'dual') continue`），故不构成合并阻断，但**不写成「双模型通过」**。

### 遗留（不假装已闭合）

- 真实系统文件对话框的打开/取消未在本机以真实 Electron 窗口手工复验；本轮证据止于渲染层 IPC mock 的时序契约与主进程返回形状对账。真实窗口复验需用户侧重启应用后按 PRD 时序自检。
- 本记录不包含 QM-6 之外的其他平台（macOS/Linux）差异；该 UI 文案与原生对话框行为跨平台一致，无平台分支。
- QM-6 官方 `deep-review` 通道未闭环（wrapper ETIMEDOUT）且 claude 直连不可用，两处均已留一手证据；若本机通道恢复，可对本分支补跑 `sh scripts/deep-review.sh` 并回写本记录。不阻塞本 PR 的依据：decider 判定 `SINGLE`，而 `check-pr-exec-record` 的深度审查闭环强制只作用于 `mode=dual`。
