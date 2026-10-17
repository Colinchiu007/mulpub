# PRD — 视频流水线进度浮层统一与完成出口（2026-10-17）

- 变更标识：`unify-video-pipeline-progress-modal`
- 影响模块：【视频创作】流水线启动页 / 视频任务编辑页之前置流程；【热门选题】一键生成视频
- 规格来源：`openspec/changes/unify-video-pipeline-progress-modal/`
- 关联总 PRD：「视频创建后台运行与并发合同」§3a；`01-docs/PRD-video-creation.md` §1.6；`01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md` §6.6；`01-docs/DESIGN.md` 弹窗契约

---

## 1. 背景与问题

应用内存在两处「视频流水线阶段进度浮层」：

| 入口 | 组件 | 浮层 testid | 旧 footer 实现 |
| --- | --- | --- | --- |
| 视频创作页（流水线启动页） | `CreateView.vue` | `s2v-progress-modal` | `UiButton`（secondary）：仅【后台运行】 |
| 热门选题页（一键生成视频） | `HotTopics.vue` | `hot-topics-gen-video-modal` | 裸 `<button class="cohere-btn-primary/secondary">`：【重试】【后台运行】【取消】【关闭】 |

三个问题：

1. **样式不统一**：热门选题页 footer 用的是页面私有 `cohere-btn-*` 类，与弹窗内 `StageProgress`、视频创作页的 `UiButton` 视觉语言不一致（圆角、内边距、禁用态、主次色都不同）。
2. **成功后没有决策点**：两条路径在 run 成功后都立即 `router.push('/create/result')` 并关闭浮层（`CreateView.applyOrchestrationOutcome`、`useHotTopicsGenVideo.finishGenVideoCompleted`）。用户被强制带走，"生成成功"这一瞬间既不能回看成片、也不能直接去发布，只能等结果页加载后再找按钮。
3. **底部动作不成体系**：视频创作页浮层只有【后台运行】，没有【取消】；热门选题页有四个按钮但样式各异、语义混在 footer 里，两页的用户心智不一致。

---

## 2. 目标与非目标

### 2.1 目标

1. 两处浮层样式完全同源（`UiModal variant="progress"` + `StageProgress` + `UiButton` footer）。
2. 底部固定四按钮，顺序统一：**【查看】【去发布】【后台运行】【取消】**。
3. 【查看】【去发布】初始灰显不可点，**视频流水线结束并成功后**转为可点。
4. 【查看】→ 视频创作-历史记录页「已完成」标签；【去发布】→ 视频内容发布页（视频模式预填充）。
5. 原来的【后台运行】【取消】从链接/私有按钮样式改为同款 `UiButton`。
6. 成功后浮层保持打开（用户决策：不自动跳转），浮层成为成功后的决策中枢。

### 2.2 非目标

- 不改结果页 `/create/result` 本身（用户仍可从历史记录进入）。
- 不改发布页装载逻辑、`buildPublishFromProject` / `publishDataToQuery` 实现。
- 不改主进程、流水线引擎、IPC 契约、平台适配器。
- 不为「无项目」的 run-only 记录伪造标题/正文。

---

## 3. 状态与数据模型

### 3.1 浮层状态机

```
                 ┌──────────────┐
   启动/改写 ───► │   running    │ ──【后台运行】──► 脱离（浮层关闭，run 继续）
                 └──────┬───────┘
                        │ 失败/取消
                        ▼
                 ┌──────────────┐
                 │ failed/      │  浮层关闭或展示重试（沿用既有）
                 │ cancelled    │
                 └──────────────┘
                        │ 成功
                        ▼
                 ┌──────────────┐
                 │  completed   │  浮层**保留**，【查看】【去发布】解锁
                 └──────────────┘
```

### 3.2 两个视图各自的终态产物字段

| 字段 | 视频创作页 | 热门选题页 | 说明 |
| --- | --- | --- | --- |
| 成片路径 | `pipelineProgressCompletedVideoPath` | `genVideoCompletedVideoPath` | 解锁判据的唯一依据 |
| 项目 ID | `pipelineProgressCompletedProjectId` | `genVideoCompletedProjectId` | 用于去发布；run-only 记录为空 |
| 项目对象 | 复用 `orchestrationContext.story2videoProject` | `genVideoCompletedProject` | 供 `buildPublishFromProject` 提取标题/正文/标签 |

### 3.3 解锁判据（唯一真源）

```
resultReady = (status === 'completed') && (videoPath 非空字符串)
```

- **不使用**「历史列表里能不能查到」作为判据：多 run 并行时可能取到别人的成片。
- **不使用** projectId 作为判据：run-only 记录（无项目）也应能去发布（纯文件路径模式）。
- 成片路径缺失（`PREVIEW_MISSING`）时不解锁，保留既有错误提示。
- **两个条件缺一不可**：实现上 `resultReady` 首行即判 `status === 'completed'`，否则「上一次 run 的成片路径残留 + 新 run 仍在跑」会提前解锁（第三轮深度评审 i1，已修并带回归）。

---

## 4. 功能逻辑

### 4.1 footer 四按钮（从左到右）

| # | 按钮 | 渲染条件 | 可用条件 | 点击行为 |
| --- | --- | --- | --- | --- |
| 1 | 【查看】 | 任何状态都渲染 | `resultReady === true` | 脱离 tracking → 切历史视图 → 筛选置「已完成」→ 路由 `/create?view=history&filter=completed` |
| 2 | 【去发布】 | 任何状态都渲染 | `resultReady === true` | 脱离 tracking → 路由 `/publish` + 预填充 query |
| 3 | 【后台运行】 | 运行中且持有 runId、非人工检查点 | 始终可点 | 既有语义：停止轮询、复位前端、**不取消**主进程 run、释放并发槽位否（仍占用） |
| 4 | 【取消】 | 非终态（`running/paused/pending/...`） | 始终可点 | 既有语义：`requestCancelPipeline()`（必要时先弹二次确认） |

终态（`completed`）下【后台运行】【取消】不再渲染 —— 无运行中任务可脱离/可取消，由右上角关闭承接收起动作。

### 4.2 【查看】的完整流程

1. 校验 `resultReady`，否则直接返回（灰显点击无副作用）。
2. `resetPipelineToNewTaskState()`：停轮询、复位运行态、`view='pipelines'`、刷新历史（**不**调 `pipelineCancel`）。
3. `view = 'history'`、`historyFilter = 'completed'`（就地写入，避免依赖路由异步）。
4. `router.push({ path:'/create', query:{ view:'history', filter:'completed' } })`（URL 可刷新/可深链）。
5. `CreateView.mounted` 与 `$route.query.view` / `$route.query.filter` 两个 watcher 消费这两个 query，二者与"用户在历史页手点已完成标签"落到同一状态。

### 4.3 【去发布】的完整流程

1. 校验 `resultReady`。
2. 取终态 context 的 `story2videoProject`：
   - **有项目** → `buildPublishFromProject({ ...project, videoPath })` → `publishDataToQuery(data)`，得到 `{ type:'video', video_path, title, content, tags? }`（均已 `encodeURIComponent`）。
   - **无项目（run-only）** → **不调用** `publishDataToQuery`，直接构造 `{ type:'video', video_path: encodeURIComponent(videoPath) }`。与结果页 `goPublish` 的纯文件路径模式同语义；若走 `publishDataToQuery` 会把空串编码成 `title=`/`content=`，等于伪造「有标题但为空」的项目。两页（视频创作页 / 热门选题页）**同一形状**，各由单测断言 `title === undefined`。
3. `resetPipelineToNewTaskState()` / `resetGenVideoFrontendState()`（同上，不取消任务）。
4. `router.push({ path:'/publish', query })`。

#### 4.3.1 热门选题页的标题生成与降级（fix-hot-topics-genvideo-title，2026-10-17 追加）

视频创作页沿用 §4.3 的既有契约（标题来自项目 `publish.title → title → sourceText` 回退链，语义不变）。**热门选题页**的【去发布】改为：标题由默认文字推理模型按爆款元素独立生成，三级降级到原始选题。

| 维度 | 视频创作页（不变） | 热门选题页（本期） |
| --- | --- | --- |
| 标题来源 | `buildPublishFromProject` 回退链（publish.title → project.title → sourceText 截断 100 字） | AI 爆款标题 → 原始选题 |
| 何时生成 | 不生成（提取） | 点击【去发布】时按需生成 |
| 无模型时 | 走回退链末端 | 原始选题 + `title_reason='no-model'` |
| run-only | 只带 `video_path`（标题空） | 带 `title` 与 `title_source` |

热门选题页流程（`useHotTopicsGenVideo.publishGenVideoResult`，已改 async）：

1. `genVideoBusy = true`（busy 守卫：重复点击不发起第二次 LLM 调用、不发生第二次跳转）。
2. `modelProviderGetDefault('llm')` 查默认文字推理模型；不可用 → 跳过 3，`titleSource='topic'`、`titleReason='no-model'`。
3. `aiGenerateGenVideoTitle({ topicText, bodyText, max:100 })`；`code!==0` / `success:false` / 抛错 → `titleSource='topic'`、`titleReason='failed'`。
4. `resolveGenVideoTitle({ topicText, aiTitle, aiAvailable, max })` 决策（纯函数，单一真源）。
5. 拼 query：有项目沿用 `publishDataToQuery`（`content/tags` 语义不变）；run-only 只带 `video_path`。两者都用决策结果覆盖 `title`，并写 `title_source` / `title_reason`（`title` 为空则不注入这三个字段）。
6. `resetGenVideoFrontendState()` + `router.push({ path:'/publish', query })`。

降级**不阻断**发布：任何降级路径都照常跳转。

弹窗完成态新增两行条件渲染（`data-testid` 分别为 `hot-topics-gen-video-title-hint` / `hot-topics-gen-video-title-generating`）：

| 状态 | 文案 key | zh |
| --- | --- | --- |
| 完成且未点击 | `hotTopics.genVideoTitleHint` | 点击「去发布」时，标题将由 AI 按爆款元素生成；若未配置文字推理模型或生成失败，将使用原始选题作为标题 |
| busy（生成中） | `hotTopics.genVideoTitleGenerating` | 正在生成标题… |

发布页在视频模式且 `title_source` 存在时，于标题输入框下方渲染三态来源提示（`data-testid="video-title-source-hint"`）：`ai` → 「标题由 AI 按爆款元素生成」；`topic+no-model` → 「未配置文字推理模型，标题已使用原始选题」；`topic+failed` → 「AI 标题生成失败，标题已使用原始选题」。无 `title_source` 不渲染、非视频模式忽略、`topic` 缺 `title_reason` 按失败态提示（不静默）。

> **设计取舍**：prompt 构造与 LLM 输出清洗放在**主进程**（`electron/ipc-handlers/gen-video-title.js`），渲染层只留降级链决策纯函数。原因：渲染层 `src/` 受 `--cjk` 门禁全量字符串扫描，中文 prompt 指令会撞门禁；且全仓渲染层此前没有任何 LLM prompt 构造先例（都在 `electron/services/*-stages.js`）。
>
> **为什么不改 `buildPublishFromProject`**：那是历史记录/结果页/播客三条入口共用的标题提取真源，改它的回退链会同时改变那三条链的语义。本期把标题决策放在调用方（热门选题 composable），爆炸半径收敛到一条链路。

### 4.4 成功后不自动跳转

- `CreateView.applyOrchestrationOutcome` 的 completed 分支：**移除** `closePipelineProgressModal()` 与 `router.push('/create/result')`；改为写终态产物 + `openPipelineProgressModal()`。
- `useHotTopicsGenVideo.finishGenVideoCompleted`：**移除** `genVideoModalOpen = false` 与 `router.push`；改为写终态产物（弹窗保持打开）。
- `openPipelineProgressModal` 的终态门禁：由"拒绝所有终态"改为"仅对**已完成且有成片**放开"——`failed/cancelled/idle` 一律拒绝，`completed` 但 `resultReady === false` 同样拒绝（**不变量写成显式门禁，不依赖调用方"先写产物再 open"的顺序**）。无成片的 completed 走 `PREVIEW_MISSING` 错误对话框，不停在「浮层全灰显」的死态。
- 终态下右上角关闭：`handlePipelineProgressClose` 在 `status === 'completed'` 时走 `resetPipelineToNewTaskState()` 收起浮层（既不做后台脱离、也不取消）。

---

## 5. 数据校验

| 校验点 | 规则 | 违规表现 |
| --- | --- | --- |
| 成片路径类型 | 必须为字符串，`trim()` 后非空；非字符串按空处理 | 不解锁，按钮保持灰显 |
| 项目对象 | 必须是普通对象（非数组/null）才走 `buildPublishFromProject` | 退化为纯 `video_path` 模式 |
| 路由 filter 入参 | 必须是 `HISTORY_STATUSES` 之一（`all/running/recoverable/failed/completed/cancelled`），非法值静默忽略 | 保持当前筛选，不写入非法状态 |
| 视图 query | 仅 `history` 触发切视图，其它值忽略 | 停留在当前视图 |
| 重复点击 | 动作方法首行再校验 `resultReady` | 无重复跳转 |
| 多 run 并行 | 只读本次 runId 的终态 context（既有 runId 快照守卫） | 不会串用其它 run 的成片 |
| 浮层开启（完成态） | `openPipelineProgressModal` 对 `completed` 额外要求 `resultReady === true` | 返回 false，不进「全灰显」死态；由 `PREVIEW_MISSING` 错误对话框承接 |
| run-only 发布 query | 无项目对象时**不得**经过 `publishDataToQuery` | 直接构造 `{type, video_path}`，`title/content/tags` 均为 `undefined` |
| 热门选题标题入参 | `topicText` trim 后非空；`max` 默认 100，非有限数/≤0 回退默认 | 空 topicText → `VALIDATION_ERROR`，不浪费 LLM 调用 |
| 热门选题 LLM 输出 | 10 条清洗规则（思维链/围栏/首行/控制字符/前缀标签/编号/成对引号/尾标点/码点截断/空结果） | 清洗后为空 → `reason:'failed'`，降级原始选题 |
| 热门选题模型就绪性 | `getDefault('llm')` 有 id 且有可用模型才调 LLM | 无模型 → `reason:'no-model'`，**不发起网络调用** |

---

## 6. 交互逻辑

### 6.1 灰显态

- 使用原生 `disabled` + `aria-disabled="true"`，**保留可见文案**（不用 tooltip/title 替代可见文字）。
- 灰显点击不触发任何副作用（不跳转、不取消、不脱离）。
- 灰显样式由 `UiButton` 的 `:disabled` 统一提供，两页一致。

### 6.2 解锁瞬间

- run 进入 `completed` 且拿到成片后，浮层内容区保持展示（阶段全 `completed`、进度 100%、完成汇总「完成时间共 X · 文件大小 Y M」），footer 两个按钮在同一帧变为可点。
- 无额外 toast：状态本身即反馈，避免"成功弹窗 + 成功 toast"的双重打扰。

### 6.3 键盘与可访问性

- 浮层遮罩与 Escape 不可关闭（`variant="progress"` 既有契约，避免误关丢失进度视图）。
- 人工检查点态 `close-disabled` 与 `close-aria-label` 保持既有口径（仅视频创作页有检查点概念；热门选题的一键生成编排不含人工检查点，故不设 `close-disabled`）。

---

## 7. 显示项

| 区域 | 内容 |
| --- | --- |
| 标题 | `create.story2video.progressTitle` =「{流水线名} 进度」；热门选题 =「一键生成视频 · {选题}」 |
| 内容 | `StageProgress`：阶段清单、总进度百分比、已用时、完成汇总；检查点提示、错误提示、供应商告警、BGM 跳过提示（沿用既有）。**热门选题（2026-10-17 hot-topics-pipeline-picker）**：内容区顶部增加一行 `hotTopics.genVideoPipelineLabel` =「流水线：{名称}」；阶段清单 = `rewrite_copy` + 所选流水线的真实阶段（动态数量，如 AI 讲解 9 个、动画 5 个），总进度分母随阶段数变化。**热门选题（2026-10-17 fix-hot-topics-genvideo-title）**：完成态内容区底部增加标题来源说明行（未点击）/「正在生成标题…」（busy） |
| footer 左 | 人工检查点提示文字（仅检查点态） |
| footer 按钮 | 【查看】【去发布】【后台运行】【取消】（终态时仅前两个） |
| 右上角 | 关闭（×）：普通运行态=后台脱离；人工检查点=禁用；终态=收起浮层 |

---

## 8. 提示与文案

| key | 中文 | 英文 |
| --- | --- | --- |
| `create.story2video.progressView` | 查看 | View |
| `create.story2video.progressPublish` | 去发布 | Publish |
| `create.story2video.progressCancel` | 取消 | Cancel |
| `hotTopics.genVideoView` | 查看 | View |
| `hotTopics.genVideoPublish` | 去发布 | Publish |
| `hotTopics.genVideoPipelineLabel` | 流水线：{pipeline} | Pipeline: {pipeline} |
| `hotTopics.genVideoPipelineFailed`（既有） | 视频流水线启动失败，请点击重试 | Failed to start the video pipeline, please retry |
| `hotTopics.genVideoTitleHint`（2026-10-17 新增） | 点击「去发布」时，标题将由 AI 按爆款元素生成；若未配置文字推理模型或生成失败，将使用原始选题作为标题 | When you click Publish, the title is generated by AI with viral elements; if no text reasoning model is configured or generation fails, the original topic is used as the title |
| `hotTopics.genVideoTitleGenerating`（2026-10-17 新增） | 正在生成标题… | Generating title… |
| `publishPage.videoTitleFromAi`（2026-10-17 新增） | 标题由 AI 按爆款元素生成 | Title generated by AI with viral elements |
| `publishPage.videoTitleFromTopicNoModel`（2026-10-17 新增） | 未配置文字推理模型，标题已使用原始选题 | No text reasoning model configured; the original topic is used as the title |
| `publishPage.videoTitleFromTopicFailed`（2026-10-17 新增） | AI 标题生成失败，标题已使用原始选题 | AI title generation failed; the original topic is used as the title |

既有沿用：`create.story2video.backgroundRun`（后台运行 / Run in background）、`hotTopics.genVideoBackgroundRun`、`hotTopics.genVideoCancel`（取消 / Cancel）、`hotTopics.genVideoRetry`（重试 / Retry）、`hotTopics.genVideoClose`（关闭 / Close）。

文案纪律：zh/en 成对（CI Gate 7）；渲染端不新增硬编码中文（CJK 基线扫描）；新词登记 `01-docs/i18n-glossary.md`。

---

## 9. 验收标准

1. 两页浮层 footer 按钮全部由 `UiButton` 渲染，无 `cohere-btn-*`；顺序为 查看→去发布→后台运行→取消。
2. 运行中：【查看】【去发布】`disabled`；【后台运行】【取消】可点。
3. 改写/启动阶段（无 runId）：两按钮灰显，【后台运行】不渲染，【取消】可点。
4. 成功后：浮层**不关闭**、不跳 `/create/result`；两按钮 `disabled` 移除。
5. 点【查看】：路由到 `/create?view=history&filter=completed`，历史筛选为「已完成」，`pipelineCancel` 未被调用。
6. 点【去发布】：路由到 `/publish`，带 `type=video`、`video_path`、`title`、`content`（有项目时）；run-only 时**只带** `type` 与 `video_path`（`title/content/tags` 必须 `undefined`，两页一致）。
7. 失败/取消态：两按钮保持灰显；无成片路径时同样灰显，且完成态且无成片时**不得**打开浮层（走错误对话框）。
8. 后台运行语义不回退：不调 `pipelineCancel`、检查点禁止后台化、并发槽位语义不变。
9. 既有取消/脱离/并发/检查点回归全绿；两页测试文件全量通过（CreateView 296 + HotTopics 49 = 345；为满足测试账本行数容差，把 12 个用例合并为 8 个，断言项一条未减）。
10. **多流水线扩展（2026-10-17 hot-topics-pipeline-picker）**：热门选题弹窗阶段数 = `1 + 所选流水线真实阶段数`（故事讲述 8、AI 讲解 9、动画 5）；启动前第一个非改写阶段为 `running`、启动失败为 `failed`；内容区显示「流水线：{名称}」；非 S2V 流水线成片从 `context.render` 提取后【查看】【去发布】正常解锁。CreateView 既有 296 例仍全绿（成片提取改为共享纯函数委托）。


---

## 10. 测试与回归保护

| 文件 | 覆盖点 |
| --- | --- |
| `apps/desktop/src/views/CreateView.test.js` | 四按钮组成与顺序；灰显/解锁；成功后保留浮层；查看/去发布路由与参数；run-only 退化；无成片不解锁且不打开浮层；`openPipelineProgressModal` 终态门禁（含「completed 但无成片 → false」）；`?filter=` 深链消费；既有「完成即跳转」断言改写为「浮层保留」 |
| `apps/desktop/src/views/HotTopics.test.js` | footer 无 `cohere-btn-*`、四按钮顺序；运行中灰显；成功后弹窗保留+解锁；查看/去发布路由与参数；**run-only 发布 query 只含 type+video_path**；改写阶段灰显 |
| 变异反证 | ① 恢复「完成即关闭浮层」→ CreateView 3 例变红；② 恢复「完成后关闭弹窗」→ HotTopics 3 例变红 |
| `HotTopics.test.js`（2026-10-17 追加） | 流水线选择器 7 例：下箭头/全量清单与禁用原因、选择 `animated-explainer` 的动态 9 阶段 + 弹窗流水线标识、主按钮默认 S2V 8 阶段、禁用项无副作用、清单失败回退、非 S2V 成片从 `context.render` 提取并 run-only 去发布、收藏行选择流水线 |
| `HotTopicsGenVideoPicker.test.js` / `gen-video-*.test.js` / `run-context-video-path.test.js` | 选择器组件 13 例 + 纯函数 23 例（详见 `PRD-HOT-TOPICS-MODULE-2026-09-11.md` §9.1） |
| QM-6 双模型深度评审 | claude 作 critic 出 8 条意见 → 自扮演逐条裁决：**i3（run-only 发布 query 注入空 title/content）、i4（completed 无成片仍可开浮层）指控成立并已修**；i1/i2/i5/i6 判不成立（i2 指出的 PRD 重复块为插入误命中，已按行锚定重做，现为精确增量） |

---

## 11. 取舍与遗留

1. **肌肉记忆变更**：老用户习惯"完成即跳结果页"。本次改为浮层决策中枢；若后续要恢复自动跳转，应做成可配置项，而不是把两条路径的硬编码改回去。
2. **热点页"去发布"依赖项目对象**：`context.story2videoProject` 由主进程 `saveRun` 回填；若某条流水线不产出项目，则退化为纯路径模式（标题正文留空由用户补）。
3. **结果页入口收窄**：成功后的默认路径不再经过结果页；结果页仍需从历史记录进入（`openHistoryResult` 未改）。后续若要在浮层加「编辑成片」入口，应在同一位置扩展而不是恢复自动跳转。
4. **两页同构但未抽共享组件**：两页状态载体不同（Options API vs composable），本次以"契约一致 + 测试分别锁定"达成统一；后续若新增第三个入口，应抽 `PipelineProgressFooter` 组件。
