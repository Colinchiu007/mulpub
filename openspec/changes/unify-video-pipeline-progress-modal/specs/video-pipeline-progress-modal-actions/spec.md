## ADDED Requirements

### Requirement: 浮层样式统一

所有展示视频流水线阶段进度的浮层（视频创作页 `s2v-progress-modal` 与热门选题页 `hot-topics-gen-video-modal`）SHALL 使用同一套视觉实现：外层 `UiModal`（`variant="progress"`、`width="960px"`、遮罩与 Escape 不可关闭）、内容区 `StageProgress`、footer 动作一律 `UiButton`（主动作 `variant="primary"`，次动作 `variant="secondary"`）。任何一页 SHALL NOT 在 footer 使用页面私有按钮类（如 `cohere-btn-*`）承载流水线动作。

#### Scenario: 两页 footer 按钮同源

- **WHEN** 分别打开视频创作页与热门选题页的流水线进度浮层
- **THEN** 两者的 footer 按钮都由 `UiButton` 渲染，尺寸/圆角/主次色一致，且弹窗宽度、标题栏与内容区结构相同

#### Scenario: 样式回归锁

- **WHEN** 对任一浮层的 footer 做样式私有化改动
- **THEN** 组件结构测试失败（两个弹窗的 footer 首元素均为 `UiButton`，且不含 `cohere-btn-` 类名）

### Requirement: 底部四按钮组成与顺序

流水线进度浮层的 footer SHALL 从左到右固定包含【查看】【去发布】【后台运行】【取消】四个按钮；其中【后台运行】仅在运行中（持有 runId 且 `status === 'running'`）时渲染，【取消】仅在非终态时渲染，【查看】【去发布】在任何状态下都渲染但初始为灰显不可点击。浮层右上角关闭按钮保持既有语义（普通运行态 = 后台脱离；人工检查点 = 禁用）。

#### Scenario: 运行中的按钮集合

- **WHEN** 流水线 `running` 且持有 runId
- **THEN** footer 渲染 4 个按钮：【查看】【去发布】为 disabled，【后台运行】【取消】可点击

#### Scenario: 改写/启动阶段

- **WHEN** 尚处于文案改写或流水线启动阶段（无 runId）
- **THEN** 【查看】【去发布】灰显；【取消】可点击；【后台运行】不渲染

#### Scenario: 终态

- **WHEN** 流水线进入 `completed`
- **THEN** 【查看】【去发布】变为可点击，【后台运行】与【取消】不再渲染（终态后由右上角关闭承接）

### Requirement: 成功后的出口按钮解锁

【查看】与【去发布】SHALL 仅在本次流水线 run 成功完成（`status === 'completed'`）且已取得成片路径时解除灰显。失败、取消、人工检查点暂停态 SHALL 保持灰显。解锁判据 SHALL 使用本次 run 的终态 context（runId 快照守卫下的 `videoPath`），不得从历史列表反查，避免多 run 并行时取错记录。

#### Scenario: 成功后解锁

- **WHEN** 轮询/推送确认 run `completed` 且终态 context 含成片 `videoPath`
- **THEN** 【查看】【去发布】变为可点击，浮层保持打开并展示完成态（阶段全部 completed、100%、完成汇总）

#### Scenario: 失败不解锁

- **WHEN** run 进入 `failed` 或 `cancelled`
- **THEN** 【查看】【去发布】保持灰显，【重试】（既有）与【关闭】承接后续操作

#### Scenario: 无成片路径

- **WHEN** run 报 `completed` 但终态 context 提取不到 `videoPath`
- **THEN** 两个按钮保持灰显，浮层展示既有「成片缺失」错误提示，不得伪造可点击状态

### Requirement: 成功后不自动跳转，由用户显式选择出口

流水线 run 成功后，浮层 SHALL 保持打开且 SHALL NOT 自动跳转视频结果页；用户显式点击【查看】或【去发布】才发生路由跳转。该口径适用于视频创作页与热门选题页两条路径。

#### Scenario: 成功后浮层保留

- **WHEN** 视频创作页编排流水线 run 完成
- **THEN** 不调用 `router.push('/create/result')`，浮层仍可见，阶段清单为全完成态，进度 100%

#### Scenario: 热门选题页同样保留

- **WHEN** 热门选题一键生成视频的 run 完成
- **THEN** 弹窗不关闭、不跳结果页，【查看】【去发布】可点击

### Requirement: 查看跳历史记录已完成标签

点击【查看】SHALL 跳转到视频创作历史记录视图（`/create?view=history`），并 SHALL 将历史筛选定位到「已完成」标签，使刚完成的任务在同一屏可见。跳转前 SHALL 释放当前 renderer 跟踪态（等同脱离：停止轮询、清理本次 run 的浮层态），不得取消主进程 run。

#### Scenario: 跳转到已完成标签

- **WHEN** 用户点击【查看】
- **THEN** 路由变为 `/create?view=history`，历史记录视图激活且状态筛选为 `completed`，列表刷新后可找到本次任务

#### Scenario: 跳转不取消任务

- **WHEN** 用户点击【查看】
- **THEN** `pipelineCancel` 未被调用（终态 run 已在主进程收尾，此处只做前端脱离）

### Requirement: 去发布跳发布页并预填充

点击【去发布】SHALL 跳转到视频内容发布页（`/publish`），并用 `buildPublishFromProject` + `publishDataToQuery` 构造视频模式预填充 query（`type=video`、`video_path`、`title`、`content`、可选 `tags`）。终态 context 无 `projectId`（run-only 记录）时 SHALL 退化为只带 `video_path` 的最小 query，与结果页 `goPublish` 同语义，不得伪造项目标题/正文。同样 SHALL 先释放 renderer 跟踪态再跳转。

#### Scenario: 有项目的完整预填充

- **WHEN** run 完成且终态 context 含 `story2videoProject.projectId`
- **THEN** 跳转 `/publish?type=video&video_path=…&title=…&content=…`，发布页装载该成片与改写文案

#### Scenario: run-only 退化

- **WHEN** run 完成但无 projectId，仅有成片路径
- **THEN** 跳转 `/publish?type=video&video_path=…`（标题正文为空，由用户补齐），不产生空项目卡片

### Requirement: 文案与本地化

新增用户可见文案 SHALL 成对写入 `apps/desktop/src/locales/create/{zh,en}.js` 与 `apps/desktop/src/locales/hot-topics/{zh,en}.js`（CI Gate 7）；i18n-glossary SHALL 登记「查看 / View」「去发布 / Publish」；渲染端 SHALL NOT 新增硬编码中文字符串（CJK 基线扫描）。灰显按钮 SHALL 保留可读标签（不用 `title` 代替可见文案），并带 `aria-disabled`。

#### Scenario: 文案成对

- **WHEN** 新增 `create.story2video.progressView` / `progressPublish` 与 `hotTopics.genVideoView` / `genVideoPublish`
- **THEN** zh/en 四文件同时存在且含义一致，CJK 基线扫描无新增硬编码

### Requirement: 测试

`CreateView.test.js` SHALL 覆盖：四按钮组成与顺序；运行中【查看】【去发布】disabled；成功后两者 enabled 且不自动跳结果页；点击【查看】跳 `/create?view=history` 且筛选 `completed`；点击【去发布】跳 `/publish` 且带 `video_path`；run-only 退化只带 `video_path`；【后台运行】仍不调 `pipelineCancel`；人工检查点仍禁用后台化。
`HotTopics.test.js` SHALL 覆盖：footer 由 `UiButton` 渲染（无 `cohere-btn-`）；成功后弹窗保留且两个按钮 enabled；点击【查看】【去发布】的路由目标；改写阶段两按钮灰显。
两文件均 SHALL 对「自动跳转被移除」做等价改写而非删除覆盖。

#### Scenario: 测试覆盖

- **WHEN** 提交本 change 相关代码
- **THEN** 上述用例全绿，既有取消/脱离/并发回归无回退
