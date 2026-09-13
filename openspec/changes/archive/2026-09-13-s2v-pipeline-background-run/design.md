## Context

流水线引擎（`pipeline-engine.js`）在 Electron 主进程独立推进 run（`startOrchestrated(..., {autoAdvance:true, background:true})` 立即返回 runId，renderer 3s 轮询 `pipelineGetRunContext`）；历史记录含运行中 run 并可经 `resumeOrchestration`（幂等 alreadyRunning）重挂。`container.setup.js` 未注入 `maxConcurrentRuns`，并发上限 = `STORY2VIDEO_MAX_CONCURRENT_RUNS` 环境变量(1-8) 或 `computeDefaultMaxConcurrentRuns()` 自适应(1-4)。取消（`pipelineCancel`）会终止 run。

## Goals

- 运行中流水线可一键转后台（前端脱离 + 恢复初始化），run 继续执行、仍占并发槽位。
- 转后台后在飞轮询响应不得写回/跳转（竞态守卫）。
- 检查点等待态禁止转后台。
- 用户可见文案 zh/en 成对；并发上限行为与提示固化。

## Non-Goals

- 不改引擎（不新增 detach IPC / run.detached 标记）。
- 不新增「后台 run 完成通知」（历史页 5s 轮询已覆盖；停留创作视图的完成通知超出本次范围）。
- 不改变并发上限默认值（保持环境变量/自适应既有语义）。

## Design

### 1. 按钮可见性
模板 running-controls：【后台运行】（`variant="secondary"`，testid `s2v-background-trigger`）仅当 `orchestrationRunId` 存在且 `pipelineRunStatus?.status === 'running'` 时显示；位于【取消】左侧。idle / paused（检查点等待）/ 非编排（无 runId）不显示。

### 2. 点击语义（detachPipelineToBackground）
```
if (!orchestrationRunId || sceneAssetSelectionActive || needsCheckpoint) return   # 幂等 + 检查点守卫
resetPipelineUiState()      # 停轮询 + 清 pipelineRunStatus/needsCheckpoint/orchestrationRunId/context/error/
                            # providerWarnings/dismissed* /orchestrationResultPath/story2videoRunMeta/
                            # sceneAsset* /selectionGuided/sceneAssetAttention/cancelConfirmDialog/
                            # dismissedBgmSkippedNotice/orchestrationStages + closeStory2VideoErrorDialog
showS2VOptionsToast(backgroundRunToast, 3000)
await loadHistory()          # 历史「运行中」置顶刷新
```
不调 `pipelineCancel()`；主进程 run 继续执行，`_countActiveRuns` 仍计入（并发槽位不释放）。

### 3. 轮询竞态守卫
`updateOrchestrationStatus` 捕获 `const runId = this.orchestrationRunId`；`await pipelineGetRunContext(runId)` 返回后 `if (this.orchestrationRunId !== runId) return`（catch 同守卫）。detach/取消/切换 run 后的过期响应直接丢弃。

### 4. 文案（locales zh/en 成对）
- `create.story2video.backgroundRun`：后台运行 / Run in background
- `create.story2video.backgroundRunToast`：流水线已转入后台运行（仍占用并发名额），可在「流水线记录」中查看进度并继续操作。 / Pipeline moved to background (still occupies a run slot). Track progress under Pipeline history and resume there.
- i18n-glossary 登记「后台运行 / Run in background」；CJK 基线随 CreateView 行号重排（无新增硬编码）。

### 5. 并发上限契约（固化说明）
`maxConcurrentRuns` 优先级：`deps.maxConcurrentRuns` > `STORY2VIDEO_MAX_CONCURRENT_RUNS`(1-8, 非法回退自适应) > `computeDefaultMaxConcurrentRuns()`(1-4)。`_assertConcurrencyBudget()` 在 startOrchestrated/resumeOrchestration 统一拦截，超限返回 `PIPELINE_CONCURRENCY_LIMIT`（错误文案含 count/max 参数）。转后台不释放槽位——再次启动是否成功由引擎门禁决定。

## Risks

- **轮询竞态**（已修复）：无 runId 快照守卫 → 僵尸重挂/污染新 run。回归测试覆盖「在飞响应不写回」。
- **检查点误转后台**（已修复）：方法内重校验 sceneAssetSelectionActive/needsCheckpoint。
- **并发理解偏差**：用户以为上限固定 2；实际为自适应/可配置（1-4 或 env 1-8）——PRD §3a 与提示文案固化说明。
- **CJK 基线行号漂移**（已处理）：`--update-baseline` 权威重排（1531 条，无新增硬编码）。
- **审查降级**：antigravity 区域不可用、claude wrapper stdin 挂起 → codex 后端独立审查（产出 C1 竞态发现），降级已记录。
