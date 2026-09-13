# s2v-start-foreground-tracking

视频创作流水线启动即前台跟踪：启动后创作页实时展示进度，离开转后台，重进初始态。

## Tasks

- [x] CreateView.vue：新增 `startOrchestrationForeground`，三条启动入口替换 `runOrchestrationInBackground`。
- [x] CreateView.vue：删除后台监听机器（`runOrchestrationInBackground` / `startBackgroundCompletionWatch` / `checkBackgroundRunCompletion` / `s2vBackgroundTracking`）。
- [x] CreateView.vue：`_s2vAlive` 卸载守卫 + `beforeUnmount` 清 `pollTimer` 置空。
- [x] CreateHistory.vue + history-page.css：interrupted 标签/路由/stale 规则/紫色样式（文案走 locale）。
- [x] locales zh/en：`startForegroundToast` 新增、`backgroundResumeToast` 修订、`backgroundRunToast` 删除。
- [x] 测试：CreateView/CreateHistory/history-utils 定向回归全绿。
- [x] 门禁：locale pair + CJK 基线（行号位移重锚）。
- [x] 文档：PRD-video-creation §3.1.35、总 PRD §3a.2、S2V-UX §5/5.2.1、CHANGELOG、i18n-glossary、本 change。
- [ ] 双模型审查 + PR 推送合并 + CCG 任务归档 + memory 更新。
