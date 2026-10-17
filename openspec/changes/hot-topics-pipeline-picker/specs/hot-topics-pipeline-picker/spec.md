## ADDED Requirements

### Requirement: 行内生成视频按钮组入口

热门选题列表行（热门 tab 与收藏 tab）的【生成视频】按钮右侧 SHALL 渲染一个紧凑的下箭头图标按钮。该按钮 SHALL 具备 `aria-haspopup="menu"`、反映开关状态的 `aria-expanded`，以及「选择视频创作流水线」的可访问名称。主按钮与下箭头按钮 SHALL 共享同一 busy 闸门：编排在途（`genVideoBusy === true`）时两者同时禁用。

#### Scenario: 热门行渲染按钮组

- **WHEN** 热门选题列表渲染出 N 条选题
- **THEN** 每一行都同时存在 `hot-topic-generate-video-{id}` 主按钮与 `hot-topic-gen-video-picker-{id}` 下箭头按钮，后者带 `aria-haspopup="menu"` 且 `aria-expanded="false"`

#### Scenario: 收藏行渲染同一按钮组

- **WHEN** 用户切到收藏选题 tab 且收藏列表非空
- **THEN** 每一收藏行同时存在 `hot-topic-favorite-generate-video-{key}` 与 `hot-topic-favorite-gen-video-picker-{key}`，且复用与热门行相同的选择器组件

#### Scenario: busy 时禁用

- **WHEN** 某条视频生成编排处于改写/启动/运行阶段
- **THEN** 所有行的主按钮和下箭头按钮均为 disabled，且已打开的下拉面板被关闭

### Requirement: 下拉面板列出全部视频创作流水线

点击下箭头后 SHALL 打开一个绝对定位的下拉面板，列出主进程 `pipelineList` 返回的**全部**视频创作流水线；面板 SHALL 首开懒加载一次并在组件生命周期内缓存结果。面板项 SHALL 展示本地化流水线名，默认流水线（`story2video-compose`）SHALL 带「默认」徽标，不可执行项 SHALL 保持可见但 disabled 并给出原因。

#### Scenario: 首开按主进程清单渲染

- **WHEN** 用户首次点击某一行的下箭头且 `pipelineList` 返回 `code === 0` 的数组
- **THEN** 面板列出全部条目；文本驱动流水线可点击并排在前面，媒体型/专属页/内部/未实现流水线 disabled 并显示对应原因；可执行顺序保持主进程返回顺序且 `story2video-compose` 在首位

#### Scenario: 加载中与缓存

- **WHEN** 面板首次打开且 IPC 尚未返回
- **THEN** 面板展示「正在加载流水线…」；同一次打开/关闭再打开不重复调用 `pipelineList`

#### Scenario: 加载失败回退

- **WHEN** `pipelineList` 返回非 0、抛错或结构非法
- **THEN** 面板展示「流水线列表加载失败」+【重试】，并保留可点击的回退项「故事讲述（默认）」；主【生成视频】按钮不受影响

#### Scenario: 空清单

- **WHEN** `pipelineList` 返回空数组
- **THEN** 面板展示「暂无可用的视频创作流水线」，且不产生任何可点击项

### Requirement: 选择流水线即启动生成流程

点击面板中某个可执行流水线 SHALL 关闭面板并以该流水线启动本次一键生成视频编排；点击禁用项 SHALL NOT 产生任何启动副作用。主【生成视频】按钮 SHALL 继续使用默认流水线 `story2video-compose`。

#### Scenario: 选择文本驱动流水线

- **WHEN** 用户点击 `animated-explainer`
- **THEN** 面板关闭，`startGenerateVideo(topic, 'animated-explainer')` 被调用；改写完成后调用 `pipelineStartOrchestrated('animated-explainer', params)`，`params.text` 为改写产物且包含 `inputMode/text/checkpointPolicy/autoAdvance/background/uiLocale` 与输出参数

#### Scenario: 选择默认流水线

- **WHEN** 用户点击面板中的「故事讲述」
- **THEN** 与点击主按钮等价：调用 `pipelineStartOrchestrated('story2video-compose', params)`，`params.story2videoTextConfig` 与既有契约一致

#### Scenario: 禁用项不可启动

- **WHEN** 用户对 `cinematic` / `talking-head` / `film-engineering` / `framework-smoke` 等禁用项发起点击（含程序化触发）
- **THEN** 不调用 `aiRewrite`、不打开弹窗、不启动任何流水线

### Requirement: 按流水线构造阶段、进度与终态

一键生成视频弹窗的阶段集合 SHALL 由「`rewrite_copy` + 所选流水线的真实阶段名」组成；总进度分母 SHALL 使用动态阶段数；启动失败 SHALL 标注第一个非改写阶段为 failed；完成时 SHALL 通过共享提取函数从 run context 的 `publish/compose/export/render/report` 中取成片路径。弹窗内 SHALL 显示「流水线：{名称}」。

#### Scenario: 非 S2V 流水线的阶段集合

- **WHEN** 以 `animated-explainer` 启动
- **THEN** 弹窗阶段依次为 `rewrite_copy, research, proposal, script, scenes, assets, editing, compose, publish`，总数为 9，改写阶段完成后第一个流水线阶段进入 running

#### Scenario: 非 S2V 成片提取

- **WHEN** run 以 `completed` 结束且成片出现在 `context.render.videoPath`（或 `context.compose.videoPath`）
- **THEN** 弹窗进入 completed，【查看】【去发布】解锁；无 `story2videoProject` 时【去发布】只带 `type=video` 与 `video_path`

#### Scenario: 启动失败标注动态阶段

- **WHEN** `pipelineStartOrchestrated` 返回非 0 或非法 runId
- **THEN** 改写阶段保持 completed，第一个非改写阶段变为 failed，展示「视频流水线启动失败，请点击重试」，重试不重新改写

### Requirement: 下拉面板交互与可访问性

同一时刻 SHALL 至多打开一个流水线面板；点击面板外部、再次点击下箭头、按 Esc、页面发生滚动 SHALL 关闭面板；Esc 关闭后焦点 SHALL 回到下箭头；↑/↓ SHALL 在可执行项之间移动焦点并环绕。面板与菜单项 SHALL 使用 `role="menu"` / `role="menuitem"`。面板 SHALL 根据可用空间自动选择向上/向下展开，并在空间不足时压缩高度（下限 160px）而不是被裁切。

#### Scenario: 外点与 Esc 关闭

- **WHEN** 面板打开时点击页面其它区域或按 Esc
- **THEN** 面板关闭，`aria-expanded` 回到 `false`

#### Scenario: 键盘导航

- **WHEN** 面板打开且用户按 ↓ / ↑
- **THEN** 焦点在可执行菜单项之间移动，禁用项不获得焦点；面板内保持一个可聚焦项

#### Scenario: 单面板约束

- **WHEN** 面板 A 打开时点击行 B 的下箭头
- **THEN** 面板 A 关闭、面板 B 打开

#### Scenario: 空间不足时翻转并压缩

- **WHEN** 面板下方可用高度不足以容纳理想面板（320px + 6px），且上方空间更大
- **THEN** 面板在按钮上方展开；若上方仍不足，面板高度压缩到可用高度（不低于 160px）并内部滚动，面板整体不被滚动容器裁切

#### Scenario: 页面滚动关闭面板

- **WHEN** 面板打开时页面（或页面内滚动容器）发生滚动
- **THEN** 面板关闭，避免与触发按钮脱位或被裁切

### Requirement: 文案与国际化

新增的用户可见文案 SHALL 写入 `locales/hot-topics/{zh,en}.js` 并保持 zh/en 成对；文案 SHALL 覆盖选择器 aria/标题、默认徽标、加载中、加载失败、重试、空列表、四类禁用原因、弹窗流水线标识，以及改写后启动提示的通用表述。禁止在组件内新增硬编码中文。

#### Scenario: 成对与无硬编码

- **WHEN** CI 运行 locale 成对检查与 CJK 基线扫描
- **THEN** 新增 key 在 zh/en 同时存在，且 `src/` 非 locales 文件没有新增中文字符串字面量

#### Scenario: 启动提示不再写死流水线

- **WHEN** 以任意流水线开始生成
- **THEN** 改写阶段的摘要文案为「已开始生成视频，改写文案后将自动启动所选流水线」，不出现「故事讲述」字样
