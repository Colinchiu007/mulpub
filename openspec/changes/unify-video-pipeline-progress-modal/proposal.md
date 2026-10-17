## Why

视频流水线进度浮层在应用内存在两套互不一致的实现：视频创作页（`CreateView.vue` 的 `s2v-progress-modal`）用 `UiButton`（secondary 变体）承载【后台运行】，而热门选题页（`HotTopics.vue` 的 `hot-topics-gen-video-modal`）的 footer 仍是早期裸 `<button class="cohere-btn-*">`，与弹窗内 `StageProgress` 的视觉语言不一致。更关键的是**成功后的出口缺失**：两条路径在 run 成功后都立即 `router.push('/create/result')` 关闭浮层（`CreateView.applyOrchestrationOutcome` 与 `useHotTopicsGenVideo.finishGenVideoCompleted`），用户被强制带走，无法在确认「生成成功」的同一屏上直接决定下一步是**回看成片**、**去发布**，还是**先转后台**。

用户本次明确要求：以视频创作页浮层样式为主统一两页；底部固定 4 个按钮；新增【查看】【去发布】置于【后台运行】左侧且初始灰显，流水线结束并成功后转为可点；【查看】跳视频创作历史记录「已完成」标签，【去发布】跳视频内容发布页；原【后台运行】【取消】从链接样式改为同款按钮。

## What Changes

- **统一浮层视觉**：`HotTopics.vue` 的一键生成视频弹窗 footer 由 `cohere-btn-*` 裸按钮改为 `UiButton`（`variant="secondary"` / `variant="primary"`），与 `CreateView.vue` 的 `s2v-progress-modal` 完全同源；弹窗尺寸、`variant="progress"`、`StageProgress` 内容区保持不变。
- **四按钮契约（浮层底部，从左到右）**：【查看】→【去发布】→【后台运行】→【取消】。
  - 【查看】【去发布】初始 `disabled`（灰显不可点击）；仅当本次流水线 run 进入 `completed` 终态且拿到成片路径时解锁。
  - 【后台运行】沿用既有合同：仅 `running` 且持有 runId 时显示，点击 = renderer 脱离（不调 `pipelineCancel`、不释放并发槽位）。
  - 【取消】运行中/改写中可点；终态隐藏（终态由右上角关闭承接）。
- **成功后浮层保持打开（行为变更）**：流水线 `completed` 后**不再自动跳转结果页**，浮层保留并展示完成态（阶段全 completed + 100% + 完成汇总），由用户显式选择【查看】或【去发布】。这一改动同时覆盖 `CreateView` 与 `HotTopics` 两条路径，并同步改写既有 PRD/规格中「完成即跳转」的表述。
  - 【查看】→ 跳视频创作历史记录页的「已完成」标签（`/create?view=history` + 历史筛选态落到 `completed`），让用户在同页看到刚完成的成片卡片。
  - 【去发布】→ 用既有唯一真源 `buildPublishFromProject` + `publishDataToQuery` 构造 `/publish` 预填充 query（视频模式）。无 projectId 的 run-only 记录退化为只带 `video_path`（与 `ResultView` 的 `goPublish` 同语义）。
- **数据来源**：【查看】/【去发布】所需的 `videoPath` / `projectId` 从本次 run 的终态 context 提取（`extractOrchestrationVideoPath` / `context.story2videoProject.projectId`），成功后写入浮层状态；不得从历史列表反查（避免多 run 并行时拿错记录）。

## Capabilities

### New Capabilities

- `video-pipeline-progress-modal-actions`: 视频流水线进度浮层的统一样式契约、四按钮组成与状态门控（灰显/解锁条件）、成功后的用户决策出口（查看=历史已完成、去发布=发布页预填充）、文案与测试合同。

### Modified Capabilities

- `s2v-pipeline-background`: 浮层底部动作面扩展为四按钮；【后台运行】按钮样式由链接/裸按钮统一为 `UiButton`；可见性与脱离语义不变。
- `story2video-page-ux`: 「完成后自动跳转结果页」的行为描述改为「成功后浮层保持打开，由用户显式选择出口」。
- `s2v-pipeline-always-background`: 涉及「完成即跳转 / 后台 run 完成后自动跳转」的表述按同一口径修订。

## Impact

- **渲染端**：`apps/desktop/src/views/CreateView.vue`（浮层 footer + 成功后保留 + 两个新动作 + 路由）、`apps/desktop/src/views/HotTopics.vue`（footer 换 UiButton + 两个新动作）、`apps/desktop/src/composables/useHotTopicsGenVideo.js`（成功后保留浮层、记录终态产物、提供跳转方法）、`apps/desktop/src/locales/create/{zh,en}.js` 与 `locales/hot-topics/{zh,en}.js`、`01-docs/i18n-glossary.md`。
- **测试**：`CreateView.test.js`、`HotTopics.test.js` 既有文件内追加（无需新增 workflow 接线）；既有「完成即跳转」断言需按新口径改写并保留等价覆盖。
- **文档**：`01-docs/PRD.md`（视频创作后台运行与并发合同 / 完成出口）、`01-docs/PRD-video-creation.md`（版本表 + 完成跳转条款）、`01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md`（§6.6 按钮矩阵）、`01-docs/PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md`（弹窗按钮清单）、`01-docs/DESIGN.md`（弹窗 footer 契约）、`CHANGELOG.md`、`openspec/records/unify-video-pipeline-progress-modal.md`。
- **不触碰**：主进程、流水线引擎、平台适配器、IPC 契约、发布页装载逻辑。
- **风险面**：
  1. 「成功后不自动跳转」改变了用户肌肉记忆。缓解：浮层内【查看】一步到位到历史「已完成」标签，且完成态浮层信息量与结果页首屏一致（阶段全绿 + 汇总）。
  2. 【去发布】依赖终态 context 里的 projectId；run-only 记录（无项目）只能带 `video_path`，标题正文为空需用户补。缓解：按钮在此场景仍可点（与 `ResultView` 同语义），不伪造项目数据。
  3. 多 run 并行时浮层只跟踪当前 runId 的终态产物（沿用 runId 快照守卫），不会串用另一条 run 的成片。
