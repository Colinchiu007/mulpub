## Purpose

让视频创作编排流水线的「启动」与「续跑」统一为前台跟踪语义：启动成功后创作页实时展示阶段进度；离开页面自动转后台、仅历史可见；重新进入回到全新新建状态。「已中断」状态保留，独立历史页与其语义对齐。

## CHANGED Requirements

### Requirement: 启动前台跟踪（取代「启动即后台」）

当编排流水线启动接口返回合法 runId 且 outcome 未完成、未失败时，系统 SHALL 在创作页前台跟踪该 run：保留 runId、立即 `updateOrchestrationStatus()` 拉取全量快照并开启 3s 轮询，展示阶段进度与 running-controls（暂停/取消）。系统 SHALL NOT 调用 `resetPipelineUiState()`、SHALL NOT 调用 pipelineCancel。

#### Scenario: 启动成功前台跟踪
- WHEN pipelineStartOrchestrated 返回 code=0、success=true、非空 runId 且 outcome.paused 不为 true
- THEN 创作页展示 StageProgress，3s 轮询开启，toast 显示 startForegroundToast 文案，【启动流水线】入口隐藏

#### Scenario: 启动响应无效
- WHEN 启动响应缺少非空 runId 或 success=false
- THEN 不进入前台跟踪、不清理既有运行态、不调用取消，按现有错误流程提示

#### Scenario: 启动回检查点
- WHEN 启动响应 paused=true 且 checkpoint 为 scene_asset_selection
- THEN 进入素材选择交互面板，保持 paused，不当作 running 前台跟踪

### Requirement: 离开页面自动转后台 / 重进初始态（新增）

当用户离开创作页时，系统 SHALL 停止前端轮询与 `pipeline:update` 事件订阅，run 继续在后台执行并占用并发槽位，仅历史记录可见；再次进入创作页 SHALL 为全新新建状态，不重挂任何 run。

同一 `/create` 页面切换到「历史记录」或「快速渲染」tab SHALL 视为离开创作页：停止前端轮询与实时事件订阅，清理 renderer 当前 run 展示态，但 MUST NOT 调用取消 IPC；主进程 run 继续执行并占用并发槽位。切回「流水线创作」tab SHALL 回到全新新建列表，不自动重挂之前的 run。

当启动 IPC 仍在途时，切 tab、切换流水线、取消或重置 SHALL 使该启动请求的 generation token 失效；返回响应仅在 token 仍有效且当前视图仍为流水线创作时才可挂回 run。失效响应 MUST 被丢弃，不得重新开启轮询、写入旧错误或触发导航。

#### Scenario: 离开页面
- WHEN 用户在运行中离开创作页
- THEN beforeUnmount 清空 pollTimer 并置 `_s2vAlive = false`，run 继续执行，历史列表按 5s 轮询展示运行中进度，且不弹结果页跳转

#### Scenario: 重新进入
- WHEN 用户再次进入创作页
- THEN mounted 不恢复/不重挂任何 run；并发门禁允许时可再次启动

#### Scenario: 同页切换 tab
- WHEN 用户在运行中从「流水线创作」切换到「历史记录」或「快速渲染」
- THEN 停止轮询与事件订阅、清理 renderer run 展示态且不调用 pipelineCancel；主进程 run 继续运行并占用并发槽位
- AND WHEN 用户切回「流水线创作」
- THEN 显示新建任务列表，不自动重挂刚才的 run

#### Scenario: 启动响应在途时切 tab
- WHEN pipelineStartOrchestrated 尚未返回且用户切换 tab
- THEN 使启动 generation token 失效；即使随后返回合法 runId，也不得重新挂回 run、开启轮询或改变当前视图

### Requirement: 续跑前台跟踪（修订「历史续跑即后台」）

当历史任务卡片的【继续】或【从断点继续】成功恢复并进入 running 时，系统 SHALL 跳转创作页前台跟踪该 run（`openRunningPipeline`，3s 轮询），与启动语义一致；`alreadyRunning=true` 只做幂等确认。

#### Scenario: 失败任务从断点继续
- WHEN pipelineResumeOrchestration 返回 success=true、非空 runId 且 paused 不为 true
- THEN 创作页持有 runId 实时跟踪进度，历史列表不再作为唯一观察入口

#### Scenario: 分镜素材选择恢复
- WHEN 恢复结果 paused=true 且 checkpoint 为 scene_asset_selection
- THEN 创作页进入素材选择面板，状态保持 paused，等待用户确认

### Requirement: 历史显示与「已中断」对齐

独立历史页 `CreateHistory.vue` SHALL 与创作页内嵌历史记录使用同一「已中断」规则：running 且 `updatedAt` 存在并超过 30 分钟 → interrupted；interrupted 有独立标签、路由与紫色样式；提示文案走 locale（不得新增硬编码中文）。

#### Scenario: 独立历史页 stale running
- WHEN 独立历史页加载含 updatedAt>30min 的 running 记录
- THEN 显示「已中断」标签与中断环节提示，点击路由 /create

#### Scenario: 已中断恢复
- WHEN interrupted 卡片的 run 走「从断点继续」
- THEN 沿用 resumeOrchestration 链路（磁盘快照 status 仍为 running）恢复推进
