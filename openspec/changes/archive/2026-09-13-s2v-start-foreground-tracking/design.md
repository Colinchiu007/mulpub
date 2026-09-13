## Context

`PipelineEngine.startOrchestrated` 始终以 `autoAdvance: true, background: true` 在主进程异步推进并立即返回 runId；`pipeline:update` 实时事件 + 3s `pipeline:getRunContext` 轮询已具备前台跟踪能力（`updateOrchestrationStatus` 同时处理 completed/failed/cancelled 终态并自动跳结果页）。历史续跑路径 `openRunningPipeline` 已实现前台跟踪。本 change 把「新启动」接到同一前台跟踪语义，并移除与之矛盾的后台监听分支。

## Goals

- 启动流水线后在创作页实时轮询展示阶段进度；离开页面自动转后台、仅历史可见；重进为全新新建状态。
- 启动与续跑前台语义统一，删除「启动纯后台 + 续跑前台」的不对称机器。
- 保留主进程并发门禁、scene_asset_selection 检查点例外、runId 快照竞态守卫。
- 独立历史页与「已中断」状态语义对齐。

## Non-Goals

- 不新增 Electron IPC 或运行持久化字段；不改变 `maxConcurrentRuns` 来源、并发计数、取消释放槽位或错误码。
- 不改变「已中断」状态的后端归一化来源（PR #1070）与 30 分钟 stale 阈值。
- 不添加第三方 provider 完成通知。
- 不把需要人工输入的 paused 检查点伪装成 running。

## Design

### 1. 启动前台跟踪 helper

新增 `startOrchestrationForeground(runId, pipelineName, outcome)`：

- 校验 runId 为非空 trim 后字符串，否则返回 false 且不改变当前运行态。
- `stopPipelinePolling()` 只清旧轮询；**不得调用 `resetPipelineUiState()`**（会清空 runId）。
- 设置 `orchestrationRunId`、清 `orchestrationResultPath/orchestrationError`、以 outcome.context/stages 为可选初始占位、选中流水线并切到 pipelines 视图。
- toast 使用 `create.story2video.startForegroundToast`（仍提示占用并发名额）。
- `await updateOrchestrationStatus()`；组件存活（`_s2vAlive !== false`）、runId 未变、非 failed 终态时开启 3s 轮询。

三个编排启动入口在 `applyOrchestrationOutcome` 未收尾且 outcome.paused 不为 true 时调用该 helper 取代原 `runOrchestrationInBackground`。

### 2. 移除后台监听

删除 `runOrchestrationInBackground` / `startBackgroundCompletionWatch` / `checkBackgroundRunCompletion` 与 `s2vBackgroundTracking` 标志（data / resetPipelineUiState / applyOrchestrationOutcome / openRunningPipeline / handlePipelinePush 中的引用一并清理）。完成跳转由前台 `updateOrchestrationStatus` → `applyOrchestrationOutcome` 覆盖，离开页面后不再跳转。

### 3. 卸载竞态守卫

`updateOrchestrationStatus` 在 runId 快照守卫后追加 `_s2vAlive === false` 直接 return；`applyOrchestrationOutcome` 开头追加 `_s2vAlive === false` 返回 false，杜绝已卸载组件写状态或触发 `router.push`。

### 4. 独立历史页对齐

`CreateHistory.vue`：stale running（updatedAt 存在且 >30 分钟）归入 interrupted；statusLabel 增加 `interrupted: '已中断'`；openPipeline 将 interrupted 纳入 `/create` 路由；提示复用 locale key（不再新增硬编码中文）；`history-page.css` 增加紫色 dot/status/card/hint 样式。

### 5. 回归测试策略

- CreateView.test.js：启动前台跟踪 / 无效 runId 不污染 / runId 快照守卫 / 完成跳结果页 / 卸载后不跳转 / 离开页面停轮询保留 runId / 重进初始态。
- CreateHistory.test.js：statusLabel interrupted、stale running → interrupted。
- locale 成对 + CJK 基线：zh/en 成对 key；行号位移按脚本文档显式 `--update-baseline`。
