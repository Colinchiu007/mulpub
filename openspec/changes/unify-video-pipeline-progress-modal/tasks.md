# Tasks — unify-video-pipeline-progress-modal

## 1. 规格与文档（先文档再代码）

- [x] `openspec/changes/unify-video-pipeline-progress-modal/`：proposal / design / spec delta
- [ ] `01-docs/PRD.md`：视频创作后台运行与并发合同补「进度浮层四按钮与完成出口」小节
- [ ] `01-docs/PRD-video-creation.md`：版本表追加一行 + 「完成即跳转」条款改写
- [ ] `01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md`：§6.6 按钮矩阵补两按钮 + §3.10 完成后语义
- [ ] `01-docs/PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md`：弹窗按钮清单更新
- [ ] `01-docs/DESIGN.md`：进度弹窗 footer 契约（UiButton 单一来源 + 四按钮顺序）
- [ ] `01-docs/i18n-glossary.md`：登记「查看 / View」「去发布 / Publish」
- [ ] `CHANGELOG.md` 未发布段

## 2. TDD：先写失败测试

- [ ] `CreateView.test.js`：四按钮组成与顺序（运行中 4 个、查看/去发布 disabled）
- [ ] `CreateView.test.js`：成功后两按钮 enabled 且**不**自动跳 `/create/result`
- [ ] `CreateView.test.js`：点【查看】→ `/create?view=history` + `historyFilter === 'completed'`
- [ ] `CreateView.test.js`：点【去发布】→ `/publish` + `video_path`/`title`/`content`（有 projectId）
- [ ] `CreateView.test.js`：run-only 退化只带 `video_path`
- [ ] `CreateView.test.js`：改写既有「完成即跳转 / durationMs / 后台 run 完成跳转」断言
- [ ] `CreateView.test.js`：`openPipelineProgressModal` 仅对 `completed` 放开终态保留
- [ ] `HotTopics.test.js`：footer 无 `cohere-btn-`、首元素为 UiButton；四按钮组成
- [ ] `HotTopics.test.js`：成功后弹窗保留、两按钮 enabled、不跳结果页
- [ ] `HotTopics.test.js`：点【查看】【去发布】的路由目标与参数
- [ ] `HotTopics.test.js`：改写「completes and navigates to result page」

## 3. 实现

- [ ] `CreateView.vue`：footer 增加【查看】【去发布】（`UiButton`，置于【后台运行】左侧，初始 disabled）
- [ ] `CreateView.vue`：新增 `pipelineProgressCompletedVideoPath` / `pipelineProgressCompletedProjectId` 状态
- [ ] `CreateView.vue`：`applyOrchestrationOutcome` completed 分支改为保留浮层 + 写终态产物（移除自动跳转）
- [ ] `CreateView.vue`：`openPipelineProgressModal` 放开 `completed`
- [ ] `CreateView.vue`：新增 `viewPipelineResultInHistory()` / `publishPipelineResult()` 两个动作方法
- [ ] `CreateView.vue`：`$route.query.filter` → `historyFilter` 消费
- [ ] `HotTopics.vue`：footer 4 按钮改 `UiButton`，新增两个 testid
- [ ] `useHotTopicsGenVideo.js`：`finishGenVideoCompleted` 改为保留弹窗 + 写终态产物；新增 `viewGenVideoInHistory()` / `publishGenVideoResult()`
- [ ] `locales/create/{zh,en}.js` + `locales/hot-topics/{zh,en}.js`：成对文案

## 4. 回归与质量门禁

- [ ] `CreateView.test.js` 全量绿
- [ ] `HotTopics.test.js` 全量绿
- [ ] locale-sync（zh/en 成对）+ CJK 基线扫描
- [ ] QM-2 自审（IPC 序列化、无同步阻塞、错误处理）
- [ ] 变异反证：把「成功后保留」改回「自动跳转」→ 新用例必须变红

## 5. 交付

- [ ] `openspec/records/unify-video-pipeline-progress-modal.md`（门禁证据表）
- [ ] commit → push → PR → CI 全绿 → squash 自动合并 → 回填 merge SHA 并销账
