## 1. 前端（CreateView.vue / locales）

- [x] 1.1 running-controls 新增【后台运行】按钮（`v-if="orchestrationRunId && pipelineRunStatus?.status === 'running'"`，secondary，testid `s2v-background-trigger`，置于【取消】左侧）
- [x] 1.2 抽取 `resetPipelineUiState()`（与 cancelPipeline 共用：停轮询 + 重置运行态全量字段 + closeStory2VideoErrorDialog）
- [x] 1.3 `detachPipelineToBackground()`：守卫（runId/检查点）→ resetPipelineUiState → toast(3000ms) → loadHistory；不调 pipelineCancel
- [x] 1.4 `updateOrchestrationStatus` runId 快照守卫（await 后与 catch 均校验 `orchestrationRunId === runId`）
- [x] 1.5 `showS2VOptionsToast(text, durationMs=1600)` 可选时长
- [x] 1.6 locales zh/en 成对：`create.story2video.backgroundRun` / `backgroundRunToast`；i18n-glossary 登记

## 2. 测试

- [x] 2.1 CreateView.test.js +6：按钮可见性（运行中 / idle+paused+无 runId）、点击不取消+恢复初始化+toast+启动按钮恢复、在飞轮询过期响应不写回（竞态守卫）、检查点等待态禁止转后台、取消路径回归（pipelineCancel 仍被调用）
- [x] 2.2 全量验证：CreateView 175 + i18n/glossary/notifications 22 全绿；vite build exit 0；eslint 0 error；locale pair check PASS；CJK scan PASS（基线 1531 无新增）

## 3. 文档与交付

- [x] 3.1 PRD.md「视频创作后台运行与并发合同」§3a（数据校验/流程/交互/显示项/提示文字/验收标准）
- [x] 3.2 PRD-video-creation.md 版本表；CHANGELOG；learnings 复盘；i18n-glossary
- [x] 3.3 CCG task 归档 + review.md（codex 后端 C1 竞态修复闭环）
- [x] 3.4 PR #753 merged（merge commit d537e243，2026-08-13），CI 全绿（electron-tests / QG 全项 / Build win+linux / GUI / Visual / agent-judge / Gate Result）
