## Why

2026-08-19 的 `s2v-pipeline-always-background` 把「启动」定义为纯后台：启动成功后 renderer 立即停止轮询、恢复初始态，观察入口只剩历史记录。2026-08-20 的断点续跑修复（PR #1072）让历史「继续/从断点继续」进入 running 时跳回创作页并 3s 轮询前台跟踪，从而形成「新启动无前台进度、续跑有前台进度」的不对称。

用户确认的目标模型：启动流水线后在创作页实时轮询展示进度；离开页面后任务继续后台运行，仅在历史记录可见；再次进入创作页回到全新新建状态，可在并发上限内再次启动。「已中断」状态（应用退出/崩溃残留）应继续保留，但独立历史页需与其语义对齐。

## What Changes

- 三个编排启动路径（文案 / 视频 / Story2Video）成功进入 running 后统一走 `startOrchestrationForeground`：保留 runId、立即 `updateOrchestrationStatus()` 拉取全量快照并开启 3s 轮询，创作页展示 StageProgress 与 running-controls（暂停/取消）。
- 删除旧「启动即后台」监听机器（`runOrchestrationInBackground` / `startBackgroundCompletionWatch` / `checkBackgroundRunCompletion` / `s2vBackgroundTracking` 标志）。
- 离开页面：`beforeUnmount` 停止轮询与事件订阅并清 `pollTimer`，主进程 run 继续后台执行；重新进入创作页为全新新建初始态。
- 卸载竞态守卫：`updateOrchestrationStatus` 与 `applyOrchestrationOutcome` 在 `_s2vAlive === false` 时丢弃在飞响应，禁止已卸载组件触发结果页跳转。
- 独立历史页 `CreateHistory.vue` 对齐「已中断」：stale running 归入 interrupted、状态标签与路由、紫色样式；提示文案复用 locale `stageProgress.interruptedStage/interruptedHint`。
- locale zh/en 成对：新增 `create.story2video.startForegroundToast`，修订 `backgroundResumeToast`，删除已无引用的 `backgroundRunToast`。

## Scope

本 change 覆盖 Story2Video/编排流水线前端运行态与两个历史 UI。「已中断」状态本身的来源定义（PR #1070 后端归一化 + 30 分钟 stale 规则）、主进程并发算法、真实 provider 行为不在本次可验证范围内。
