## Purpose

运行中编排流水线（story2video-compose 等）在【取消】旁 SHALL 提供【后台运行】入口：点击后前端脱离（停止轮询 + 重置运行态），run 在主进程继续后台执行、仍占用并发槽位；前端恢复初始化（【启动流水线】重新出现），用户可在并发上限内再次启动。轮询写回 SHALL 带 runId 快照守卫；检查点等待态 SHALL 禁止转后台。

## ADDED Requirements

### Requirement: 按钮可见性

运行中编排流水线（`orchestrationRunId` 非空且 `pipelineRunStatus.status === 'running'`）在 running-controls 操作区【取消】左侧 SHALL 显示【后台运行】按钮（secondary 变体）。idle、paused（检查点等待）、非编排（无 runId）SHALL 不显示。

#### Scenario: 运行中显示后台运行按钮
- **WHEN** 流水线运行中且 `orchestrationRunId = 'run-x'`、`pipelineRunStatus.status = 'running'`
- **THEN** 【后台运行】按钮与【取消】按钮同时可见

#### Scenario: 非运行态不显示
- **WHEN** 状态为 idle、paused，或 orchestrationRunId 为空
- **THEN** 不显示【后台运行】按钮

### Requirement: 点击 = 前端脱离，不取消

点击【后台运行】SHALL：停止 3s 轮询；执行 `resetPipelineUiState()` 重置前端运行态（`pipelineRunStatus`/`orchestrationRunId`/`orchestrationContext`/`orchestrationError`/`providerWarnings`/`orchestrationResultPath`/`story2videoRunMeta`/`sceneAsset*`/`cancelConfirmDialog`/`orchestrationStages` 等）；**不调用 `pipelineCancel()`**（主进程 run 继续执行）；显示轻提示 toast（3s，提示仍占用并发名额）；刷新历史列表。UI SHALL 恢复初始化状态（【启动流水线】重新出现）。

#### Scenario: 转后台不取消流水线
- **WHEN** 用户点击【后台运行】
- **THEN** `pipelineCancel` 未被调用，前端状态恢复初始化，toast 显示「流水线已转入后台运行（仍占用并发名额）…」，【启动流水线】按钮重新出现

#### Scenario: 重复点击幂等
- **WHEN** 连续两次点击【后台运行】
- **THEN** 第二次因 `orchestrationRunId` 已清空直接返回，无副作用

### Requirement: 并发槽位与再次启动

转后台 SHALL 不释放并发槽位（主进程 `_countActiveRuns` 仍计入该 run）。再次启动 SHALL 受引擎并发门禁约束：`maxConcurrentRuns` 优先级 = `deps.maxConcurrentRuns` > `STORY2VIDEO_MAX_CONCURRENT_RUNS`(1-8，非法回退自适应) > 机器资源自适应(1-4)；超限时引擎 SHALL 返回 `PIPELINE_CONCURRENCY_LIMIT`（含 count/max 参数化友好文案），前端弹窗展示。

#### Scenario: 并发满时启动被拒
- **WHEN** 运行中编排 run 数已达 `maxConcurrentRuns`，用户再次启动流水线
- **THEN** 引擎拒绝并返回 `PIPELINE_CONCURRENCY_LIMIT`，前端展示「当前已有 N 条流水线正在后台运行，最多同时运行 M 条…」

### Requirement: 轮询竞态守卫

`updateOrchestrationStatus` SHALL 在发起请求时捕获 runId 快照；await 返回后（含 catch 分支）SHALL 校验当前 `orchestrationRunId === runId` 才写回 context/stages 或触发 `applyOrchestrationOutcome`。detach/取消/切换 run 后的在飞响应 SHALL 一律丢弃，不得僵尸重挂或污染新 run。

#### Scenario: 在飞响应不写回
- **WHEN** 用户点击【后台运行】清空 runId 后，之前发起的 `pipelineGetRunContext` 响应才返回 running 数据
- **THEN** 该响应被丢弃：`orchestrationRunId`/`pipelineRunStatus`/`orchestrationContext` 保持空，不触发结果页跳转

### Requirement: 检查点禁止转后台

方法内 SHALL 重校验 `sceneAssetSelectionActive` 与 `needsCheckpoint`；任一为真时点击【后台运行】SHALL 无效（防止需人工输入的 run 转入后台无人处理）。

#### Scenario: 检查点等待态点击无效
- **WHEN** `sceneAssetSelectionActive = true`（或 `needsCheckpoint = true`）时点击【后台运行】
- **THEN** 点击被忽略，runId 与运行状态保持不变

### Requirement: 历史重挂闭环

转后台的 run SHALL 继续显示在历史记录「运行中」置顶（5s 轮询刷新阶段状态）；点击卡片 SHALL 经 `resumeHistoryItem → pipelineResumeOrchestration`（幂等 `alreadyRunning`）重新挂回并恢复轮询；同会话切页返回时 `resumeRunningOrchestration`（mounted）SHALL 重新挂起首个运行中编排 run（既有合同，不因转后台改变）。

#### Scenario: 历史重挂恢复查看
- **WHEN** 用户把运行中流水线转后台后，在历史记录点击该「运行中」卡片
- **THEN** 切回创作视图并恢复该 run 的阶段进度与轮询

### Requirement: 数据安全与本地化

新增用户可见文案（按钮/toast）SHALL 写入 `apps/desktop/src/locales/zh.js` 与 `en.js` 成对（CI Gate 7）；i18n-glossary SHALL 登记「后台运行 / Run in background」；渲染端 SHALL 不新增硬编码中文字符串（CJK 基线扫描）。toast 文案 SHALL 提示仍占用并发名额。

#### Scenario: 文案成对
- **WHEN** 新增 `create.story2video.backgroundRun` / `backgroundRunToast`
- **THEN** zh/en 两语言文件同时存在且含义一致，CJK 基线扫描无新增硬编码

### Requirement: 测试

CreateView.test.js SHALL 覆盖：运行中+runId 显示按钮；idle/paused/无 runId 不显示；点击后 `pipelineCancel` 未被调用、状态恢复初始化、启动按钮重新出现、toast 显示；在飞轮询过期响应不写回；检查点等待态点击无效；取消路径回归（`pipelineCancel` 仍被调用）。

#### Scenario: 测试覆盖
- **WHEN** 提交本 change 相关代码
- **THEN** CreateView.test.js 新增用例全绿，既有取消/恢复用例无回归
