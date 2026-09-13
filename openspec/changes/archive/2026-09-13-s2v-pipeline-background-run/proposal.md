## Why

运行流水线状态下，流水线详情页只有【取消】入口。用户若想在后台继续跑当前流水线、同时在前台准备/启动另一条流水线，只能留在详情页等待，或取消（终止）后重新发起。前端详情页与主进程 run 本已解耦（`autoAdvance+background` 后台推进、历史记录含运行中可重挂），但缺少「前台脱离」交互，且轮询写回缺少 runId 快照守卫（detach 后在飞响应会僵尸重挂/污染新 run）。

## What Changes

- **【后台运行】按钮**：运行流水线状态下（编排流水线 `orchestrationRunId` 存在且 `status==='running'`），在【取消】按钮旁新增【后台运行】。点击后前端脱离：停止 3s 轮询 + 重置前端运行态（`resetPipelineUiState()`，与取消共用），**不调 `pipelineCancel()`**；主进程 run 继续后台执行、仍占并发槽位；历史记录「运行中」置顶可点击重挂；UI 恢复初始化（【启动流水线】重新出现），可在并发上限内再次启动。
- **轮询竞态守卫**：`updateOrchestrationStatus` 发起时捕获 runId 快照，await 返回后校验 `orchestrationRunId === runId` 才写回（catch 同守卫），杜绝 detach/取消/切换 run 后在飞响应写回状态或误跳结果页。
- **检查点守卫**：`sceneAssetSelectionActive` / `needsCheckpoint` 时禁止转后台（需人工输入的 run 不得转入后台无人处理）。
- **并发上限说明**：并行上限 `maxConcurrentRuns` = deps 注入 > `STORY2VIDEO_MAX_CONCURRENT_RUNS`(1-8) > 机器自适应(1-4)，非固定 2；并发门禁统一在引擎（`_assertConcurrencyBudget` → `PIPELINE_CONCURRENCY_LIMIT`）。

## Capabilities

### New Capabilities
- `s2v-pipeline-background-run`: 视频创作流水线前台/后台切换契约——【后台运行】按钮可见性与点击语义（前端脱离不取消、run 继续后台、仍占并发槽位、历史可重挂）、`resetPipelineUiState` 重置范围、轮询 runId 快照守卫、检查点禁止转后台、并发上限来源与提示文案。

### Modified Capabilities
（无。既有 `story2video-compose-progress` / `story2video-creation-mode` 不受影响；引擎 `autoAdvance+background`、历史重挂、并发门禁为既有行为，本 change 仅固化前端脱离交互与竞态守卫。）

## Impact

- `apps/desktop/src/views/CreateView.vue`：running-controls 新增按钮；`resetPipelineUiState()` 抽取；`detachPipelineToBackground()`；`updateOrchestrationStatus` runId 快照守卫；`showS2VOptionsToast` 可选时长。
- `apps/desktop/src/locales/zh.js` / `en.js`：`create.story2video.backgroundRun` / `backgroundRunToast` 成对。
- `apps/desktop/src/views/CreateView.test.js`：+6 用例。
- 文档：PRD.md「视频创作后台运行与并发合同 §3a」、PRD-video-creation.md 版本表、CHANGELOG、learnings、i18n-glossary、CJK 基线重排。
- 交付：PR #753 merged（merge commit d537e243，2026-08-13），CI 全绿（electron-tests/QG 全项/Build/GUI/Visual/agent-judge）。
