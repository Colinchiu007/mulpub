# 热门选题一键生成视频 规格

## ADDED Requirements

### Requirement: 选题级生成视频入口

热门选题页每条选题 SHALL 提供【生成视频】按钮（与【创作文案】并列，data-testid=hot-topic-generate-video-{id}）。点击后系统 SHALL 弹出一键生成视频进度弹窗并自动开始编排：文案改写 → 故事讲述流水线。

#### Scenario: 按钮渲染
- WHEN 热门选题列表加载完成
- THEN 每条选题行显示【生成视频】按钮，与【创作文案】并列

#### Scenario: 一键启动
- WHEN 用户点击某条选题的【生成视频】
- THEN 弹出进度弹窗，stages=[文案改写, 文案拆分, 场景上下文, 提示词优化, AI视频场景选择, 素材生成, 视频合成, 发布]，文案改写阶段立即进入 running

### Requirement: 文案改写阶段

进度弹窗的文案改写阶段 SHALL 调用 aiRewrite(mode='create', content=buildRewriteInput(topic))，输入构造与现有发布流程一致（<20 字补引导前缀）。改写成功后 SHALL 将产物存入草稿箱（source='hot-topics'）并自动启动故事讲述流水线；改写失败 SHALL 标记该阶段 failed 并展示错误信息与【重试】。

#### Scenario: 改写成功流转
- WHEN aiRewrite 返回 code=0 且 data.success=true
- THEN 文案改写阶段 completed，产物 draftSave 入草稿箱，自动进入流水线启动

#### Scenario: 改写失败
- WHEN aiRewrite 返回失败或抛异常
- THEN 文案改写阶段 failed，显示错误摘要，弹窗提供【重试】

### Requirement: 自动启动故事讲述流水线

改写成功后系统 SHALL 读取 story2video.lastOptions.v1 快照（缺失/非法回退默认值），用 buildStory2VideoTextConfigFromSnapshot 构建 story2videoTextConfig，调用 pipelineStartOrchestrated('story2video-compose', params)。params 与 CreateView.startOrchestratedPipeline 一致（text=改写产物, inputMode='text', checkpointPolicy='none', autoAdvance=true, background=true, uiLocale）。

#### Scenario: 默认选项应用
- WHEN 用户此前在创作页保存过选项（lastOptions 快照合法）
- THEN 启动参数的 story2videoTextConfig 采用快照中的 s2vConfig/s2vOutputConfig 值

#### Scenario: 无保存选项
- WHEN lastOptions 快照缺失或结构非法
- THEN 回退内置默认值启动，不阻断流程

#### Scenario: 流水线启动失败
- WHEN pipelineStartOrchestrated 返回失败（含并发占用/模型缺失）
- THEN 流水线阶段标记 failed，显示错误，弹窗提供【重试】（重试从流水线启动开始，改写产物已缓存不重复改写）

### Requirement: 进度弹窗 UI

进度弹窗 SHALL 复用 UiModal(variant=progress, size=xl, width=960px) + StageProgress 组件，视觉与视频创作页流水线进度弹窗一致。stages 数组 = [rewrite_copy, ...STORY2VIDEO_STAGE_NAMES]；进度百分比、耗时、摘要按阶段状态计算。运行中禁遮罩/ESC 关闭；右上角关闭 = 后台运行（流水线继续，弹窗关闭，页面显示「后台运行中」提示条）；改写阶段运行中关闭 = 取消改写（不启动流水线）。

#### Scenario: 弹窗视觉一致
- WHEN 弹窗打开
- THEN 阶段列表渲染与 /create 页进度弹窗同款 StageProgress，文案改写行显示于最前

#### Scenario: 流水线阶段实时进度
- WHEN 流水线 run 运行中
- THEN onPipelineUpdate 推送 + 3s 轮询更新各阶段状态/子进度，runId 不匹配的推送被丢弃

#### Scenario: 完成
- WHEN 流水线 completed 且拿到 videoPath
- THEN 弹窗关闭，跳转 /create/result?path=...

### Requirement: 取消语义

改写阶段（含等待启动）用户取消 SHALL 仅中止前端编排（不调用流水线取消，因流水线未启动）。流水线已启动后取消/关闭 SHALL 调用 pipelineCancelRun；若该 API 不存在 SHALL 提示任务已转后台、可在创作页历史查看。

#### Scenario: 改写阶段取消
- WHEN 文案改写 running 中用户点击取消
- THEN 编排中止，弹窗关闭，无流水线启动

#### Scenario: 流水线阶段取消
- WHEN 流水线 running 中用户点击取消
- THEN 调用 pipelineCancelRun(runId)，阶段标记 cancelled

### Requirement: 国际化

所有新增用户可见文案 SHALL 在 locales zh.js 与 en.js 成对维护，带参文案用 Message Function。新增阶段名 rewrite_copy 注册于 pipeline-labels.js STAGES 与 locales pipelines.stages。

#### Scenario: 中英文渲染
- WHEN 界面语言为 zh/en
- THEN 按钮、弹窗标题、阶段名、提示文案均以对应语言渲染，无 key 泄漏
