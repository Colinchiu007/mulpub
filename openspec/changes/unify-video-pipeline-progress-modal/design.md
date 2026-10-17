## Context

两条视频流水线进度浮层已存在且都已用 `UiModal variant="progress"` + `StageProgress`：

| 路径 | 文件 | 浮层 testid | footer 实现 | 成功后行为 |
| --- | --- | --- | --- | --- |
| 视频创作页 | `apps/desktop/src/views/CreateView.vue` | `s2v-progress-modal` | `UiButton`（secondary） | `applyOrchestrationOutcome` → `router.push('/create/result')` 并 `closePipelineProgressModal()` |
| 热门选题页 | `apps/desktop/src/views/HotTopics.vue` | `hot-topics-gen-video-modal` | 裸 `<button class="cohere-btn-*">` | `useHotTopicsGenVideo.finishGenVideoCompleted` → `router.push('/create/result')` 并 `genVideoModalOpen = false` |

热门选题的 composable 已把编排状态/方法整体抽离（`useHotTopicsGenVideo.js`），本次的动作扩展也应落在 composable 内，避免 `HotTopics.vue` 继续膨胀（该文件已有 filesOver1000 债务阈值约束）。

## Goals / Non-Goals

**Goals**

1. footer 视觉统一（`UiButton` 单一来源），两页四按钮组成、顺序、状态门控完全一致。
2. 成功后浮层保留，用户显式选择【查看】/【去发布】。
3. 【查看】= 历史记录「已完成」标签；【去发布】= 发布页视频模式预填充（复用既有唯一真源）。
4. 既有合同不回退：后台运行不取消、检查点禁止后台化、并发槽位语义、runId 快照守卫。

**Non-Goals**

- 不改结果页（`/create/result`）本身；用户从历史记录仍可进入。
- 不改发布页装载逻辑与 `buildPublishFromProject` / `publishDataToQuery` 实现。
- 不改主进程、IPC、平台适配器。
- 不为「无 projectId 的 run-only 记录」伪造发布数据。

## Decisions

### D1：四按钮顺序与状态门控放在一处定义

两页各有一个浮层，但按钮集合与门控条件必须逐字一致。做法：各自在视图/composable 内定义同构 computed，规格与测试锁住「集合 + 顺序 + 门控」三元组，而不是抽一个共享组件。

理由：两页的状态载体不同（Options API `data/computed` vs composable `ref/computed`），强行共享组件要引入跨范式适配层；而本次真正需要一致的是**契约**，不是代码复用。测试对两页分别断言同一组判据即达到目的。

### D2：终态产物（videoPath / projectId）在 run 完成时一次性落进浮层态

- `CreateView`：`applyOrchestrationOutcome` 的 completed 分支不再 `closePipelineProgressModal()` + `router.push`，改为保留 `pipelineRunStatus.status === 'completed'`、写入 `pipelineProgressCompletedVideoPath` / `pipelineProgressCompletedProjectId`，并 `openPipelineProgressModal()`。
- `useHotTopicsGenVideo`：`finishGenVideoCompleted` 同样不再关闭弹窗/跳转，改为写 `genVideoCompletedVideoPath` / `genVideoCompletedProjectId`，`genVideoPhase = 'completed'`，弹窗保持打开。

判据来源与既有 `extractOrchestrationVideoPath` / `context.story2videoProject.projectId` 完全一致（HotTopics 侧沿用其现有 `finishGenVideoCompleted` 的提取式），不引入第二套提取逻辑。

### D3：【查看】的路由与历史筛选态

`/create?view=history` 已由 `$route.query.view` watcher 消费（`CreateView` mounted 与 watch 两条路径）。历史筛选 `historyFilter` 是 `CreateView` 的 data（`'all' | 'running' | 'recoverable' | 'failed' | 'completed' | 'cancelled'`，单一来源 `HISTORY_STATUSES`）。

做法：跳转目标为 `/create?view=history&filter=completed`，并在 `CreateView` 的 `$route.query` 处理处读取 `filter`，命中 `HISTORY_STATUSES` 时写入 `historyFilter`（不命中则忽略，保持既有行为）。这样从浮层点【查看】与用户在历史页手动点「已完成」标签落到同一状态。

热门选题页此时不在 `/create` 路由，直接 `router.push` 同一目标即可（`CreateView` 的 mounted/watch 分支负责消费）。

### D4：【去发布】的数据契约复用

- 有 projectId：`buildPublishFromProject(context 组装的最小 project 对象)` → `publishDataToQuery(data)`。
  - `CreateView` 侧终态 context 里的 `story2videoProject` 是主进程 `saveRun` 落盘后的完整项目对象（含 `title/sourceText/segments/story2videoTextConfig/videoPath`），可直接喂给 `buildPublishFromProject`——与 `CreateViewHistory.publishable` → `publishHistoryItem` 同源。
  - `HotTopics` 侧终态 context 同样带 `story2videoProject`（E2E mock 与既有 `finishGenVideoCompleted` 已消费该字段）。
- 无 projectId：退化为 `{ type: 'video', video_path }`（与 `ResultView.goPublish` 的「仅文件路径模式」同语义），按钮仍可点，不伪造标题正文。

`publishDataToQuery` 已对路径/文案做 `encodeURIComponent`，无需额外处理。

### D5：跳转前统一「脱离」语义

【查看】/【去发布】点击后都需要让 renderer 不再跟踪该 run（终态 run 已在主进程收尾，但前端轮询/定时器必须停）。

- `CreateView`：复用既有 `resetPipelineToNewTaskState()`（不传 toastKey，避免成功后再弹「已转入后台」造成误导）——它已封装停轮询 + `resetPipelineUiState` + `view='pipelines'` + 刷新历史。随后再 `router.push` 目标。
  - 注意顺序：先脱离再跳转。`resetPipelineToNewTaskState` 内部会 `loadHistory()`，跳到历史视图后 watcher 会再次 `loadHistory()`，两次调用由 `historyRequestId` 代际隔离，无副作用。
- `HotTopics`：复用既有 `resetGenVideoFrontendState()`（停跟踪 + 复位 + 释放 busy），再 `router.push`。

### D6：热门选题 footer 的 UiButton 化

`HotTopics.vue` 的 4 个按钮改为 `UiButton`，需在 `<script setup>` 内 import 并注册（该文件未使用 `components` 自动注册的全局开关，`UiModal` 是显式 import 的，同法处理）。

按钮变体分工：主动作（【重试】）`primary`，次动作（【查看】【去发布】【后台运行】【取消】【关闭】）`secondary`。既有 `data-testid` 全部保留（E2E 驱动 `hot-topics-one-click-video-driver.js` 依赖 `hot-topics-gen-video-background`），新增两个 testid：`hot-topics-gen-video-view` / `hot-topics-gen-video-publish`。

`CreateView` 侧新增 testid：`s2v-progress-view` / `s2v-progress-publish`。

### D7：成功后不再自动跳转的影响面

需要同步改写（代码）：
- `CreateView.applyOrchestrationOutcome` completed 分支（D2）。
- `useHotTopicsGenVideo.finishGenVideoCompleted`（D2）。
- 既有测试断言：`CreateView.test.js` 中「完成即跳转 / durationMs / 后台 run 完成后自动跳转 / startPipeline 完成跳转」等约 6 处，`HotTopics.test.js` 中「completes and navigates to result page」1 处——按新口径改写为「浮层保留 + 按钮解锁」，并保留对 query 构造（durationMs 等）的等价覆盖（通过直接触发新按钮或断言不再跳转）。

需要同步改写（文档）：PRD「完成即跳转」表述、PRD-video-creation 版本表、PRD-HOT-TOPICS §6.6 按钮矩阵、DESIGN.md 弹窗 footer 契约、CHANGELOG。

## Risks / Open Questions

1. **用户肌肉记忆**：成功后不再自动跳结果页。缓解：【查看】一步到历史「已完成」标签；完成态浮层展示全完成阶段 + 汇总（时长/大小），信息量不低于结果页首屏。若后续要恢复自动跳转，应做成可配置项而非硬编码。
2. **run-only 记录去发布只有 video_path**：标题正文空。与 `ResultView` 的既有退化一致，不新增特殊处理。
3. **`CreateView` 的 `openPipelineProgressModal` 当前拒绝终态**（`PIPELINE_TERMINAL_STATUSES` 早退）。成功后保留浮层必须放开 `completed` 这一格，但要继续拒绝 `failed`/`cancelled`/`idle`（那些状态走错误对话框/关闭）。这是本改动的唯一一处既有门禁松动，需用测试锁住「仅 completed 可保留」。
4. **多 run 并行**：浮层只跟踪当前 `orchestrationRunId` / `genVideoRunId` 的终态产物；既有 runId 快照守卫已覆盖，不新增机制。
