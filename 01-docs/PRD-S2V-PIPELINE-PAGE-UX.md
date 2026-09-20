# Story2Video 流水线启动页、历史记录与视频任务编辑页 UX 统一 PRD

> 状态：已实现，待合并验收
> 日期：2026-08-17
> 关联 OpenSpec：openspec/changes/s2v-pipeline-page-ux/
> 适用范围：桌面端“视频创作”中的流水线启动页、历史记录视图、视频任务编辑页

## 1. 目标与术语

### 1.1 用户目标

用户在配置长流水线、等待多阶段执行、查看多分段视频任务时，不应因为页面滚动而失去主要操作入口，也不应通过技术错误文本猜测任务对象和失败原因。本迭代的目标是让用户始终知道：当前在哪个页面、正在处理哪个视频、任务处于什么状态、下一步可以做什么。

### 1.2 统一术语

| 术语 | 定义 | 路由/入口 |
|------|------|-----------|
| 流水线启动页 | 进入“视频创作”后选择一条流水线，展示配置、启动和运行进度的页面 | /create |
| 视频任务编辑页 | 某个流水线任务的内容查看与编辑页面；不再另设“详情弹窗” | /create/result?project=projectId |
| 历史记录页 | 展示流水线任务及状态筛选的页面 | /create?view=history |
| 运行记录 | 没有 Story2Video projectId、只有 PipelineEngine run 快照的记录 | 历史记录内的纯 run 卡片 |

旧文案“视频任务详情页”“任务详情弹窗”“编辑并重新合成”不再作为用户可见名称。用户可见动作统一为“编辑”；编辑页返回动作统一为“返回”，返回目标为历史记录。

## 2. 页面布局与固定操作

### 2.1 流水线启动页

1. 配置内容位于可滚动内容区。
2. 页面底部固定操作条始终显示当前可用的“启动流水线”“暂停”“继续”“取消”等动作。
3. 操作条左侧与易效侧栏宽度对齐，不能遮挡侧栏；窄屏必须保持可点击和可换行。
4. 流水线运行后，阶段进度不再嵌入启动页正文，而是由统一进度弹窗承载；页面正文不渲染重复的完整阶段区。
5. 2026-08-21 起：启动流水线成功进入 running 后，创作页即作为该任务的“前台跟踪页”——stage 进度区、暂停/取消动作、完成自动跳结果页均在此页生效；离开此页自动停止前端跟踪，任务转后台运行，仅在历史记录可见；再次进入创作页为全新新建状态，不自动重挂任何 run。
6. 内容区与操作条为互不重叠的两个独立区域：内容区（）使用  独立滚动，操作条（）使用  位于正常流底部，不脱离文档流。此方案替代了原先的  +  补偿方案，避免操作条因内容换行、多按钮等场景高度变化时遮挡底部配置项。
   - 实现日期：2026-09-05
   - 关联 PR：#1405
7. 暂停、继续、取消和【后台运行】仍位于底部固定操作条；素材选择检查点、内容政策等待态不重复显示普通暂停动作。

### 2.1.1 启动前模型能力前置校验（2026-08-28）

点击「启动流水线」时，系统按「流水线 → 所需模型能力」映射在创建运行之前统一校验模型配置；缺失时立即拦截并弹出可操作的缺失清单，不再等到运行到模型阶段才提示。

**能力映射（静态流水线）：**

| 流水线 | 所需模型能力 |
| --- | --- |
| animated-explainer（AI 解释视频） | 推理模型 + 图片生成 |
| animation / avatar-spokesperson / character-animation / hybrid（AI 视频） | 推理模型 + 视频模型 |
| documentary-montage（纪录片剪辑） | 推理模型 + 图片生成 |
| localization-dub（本地化配音） | 推理模型（显式选择非 Edge 语音 provider 时 +TTS 语音） |
| podcast-repurpose（播客转视频） | 图片生成（无文案输入时 +语音识别） |
| talking-head / cinematic / clip-factory / framework-smoke / screen-demo（纯本地） | 无 |
| film-engineering（影视工程） | 无（启用 LLM 增强开关时 +推理模型） |

> 映射与阶段执行器的实际模型调用点互注维护：修改阶段执行器模型调用的 PR 必须同步本表与 openspec/specs/pipeline-model-preflight 规格。

**story2video-compose（故事讲述）按模式动态判断：**

- 图片生成：恒必需（generate_assets 必生成图片素材）。
- 视频模型：仅当视频增强模式为「固定比例 / AI 智能选择」（video.mode=fixed/ai-judged）时必需；纯图片轮播（mode=off/缺省）不要求。
- 推理模型：仅当「AI 智能选择」（ai-judged）时必需（AI 场景评估；文案优化走外部 prompt-engine 服务，不占本地模型）。
- TTS 语音：仅当显式选择非空语音 provider 时校验（内置 Edge TTS 免配置）。

**校验语义：** 未显式选择 provider 时按模型设置页的默认能力解析（含多模态能力默认与视频能力开关）；显式选择 provider 时校验该供应商凭据可用（可解密 API Key 或本地免 Key 供应商）。批量创作的每一条任务复用同一启动入口，逐项执行同一前置校验，失败项标记为失败并携带同一错误码。

**错误与引导：** 拦截时返回错误码 PIPELINE_MODEL_REQUIREMENTS_MISSING 与缺失能力清单；弹窗正文按界面语言列出缺失能力标签，并提供「去模型设置」按钮直达 /model-providers 页面；断点续跑不做前置拦截，保持既有恢复语义。

### 2.2 视频任务编辑页

1. 顶部标题为“视频预览”，下一行显示任务标题。
2. 任务标题回退链为：发布标题/项目标题 → 原文案前 60 个字符 → projectId。
3. “返回”跳转 /create?view=history，不回到旧的详情弹窗。
4. 分段卡片顺序为：分段标题与状态 → 图片/视频预览 → 场景素材 → 旁白文字 → 提示词 → 语音设置 → 分段素材动作。
5. “第 N 段”必须在该段图片上方显示；分段操作条不再把标题放在图片下方。
6. “保存分段”“重新合成”“再次合成视频”固定在页面底部操作条；页面内容预留底部安全空间。
7. 窄屏下三个按钮按单列排列，不能发生覆盖；保存/合成状态和未保存提示仍可见。
8. 当编辑页携带运行中的 runId 时，标题区域显示“暂停”动作；暂停沿用同一受校验 IPC，只更新 run 状态，不改变分段编辑数据。

## 3. 历史记录信息合同

### 3.1 统一卡片结构

全部、进行中、可恢复、执行失败、已完成、已取消标签共用同一卡片 DOM 结构、宽度、内边距和操作区。状态差异只通过数据项和状态色体现，不复制状态专属 CSS。可恢复聚合已暂停和已中断两个子状态（2026-08-31 修订，见 5.1.1）。

每张卡片统一显示：

- 任务标题：优先发布标题；为空时显示原文案前 60 字；再为空显示流水线名称或“未命名任务”。
- 文案预览：任务原文案前 120 个 JavaScript 字符，超长追加 …；不读取图片/视频提示词代替任务文案。
- 首场景缩略图：第一场景有合法图片时取第一张；无合法图片时取第一个合法视频的第 0 秒首帧；失败保留空背景并显示“未生成”。
- 更新时间；若有创建时间，同时显示创建时间。
- 耗时：使用任务实际 duration，按当前语言格式化分钟/秒；无有效值显示本地化“暂无”。
- 任务/run ID 和 project ID：短显示，完整值放在 title/可访问性属性中。
- 流水线名称：使用 locale 映射，不显示内部枚举值。
- 视频时长：只读取明确的成片/视频时长字段并按分钟/秒格式化；流水线执行耗时单独显示为“耗时”，不能互相替代。
- 状态标签与状态图标。
- 操作区：按记录类型提供编辑、恢复、删除等动作；动作点击必须阻止卡片导航冒泡。

状态附加字段：

- 进行中：当前阶段/阶段进度。
- 可恢复：聚合已暂停（用户手动暂停与 scene_asset_selection 检查点）和已中断（应用退出/崩溃/强杀或 >30 分钟无更新）两个子状态。卡片内仍通过图标和提示文字区分暂停原因，筛选栏统一为单一可恢复 tab。

- 执行失败：失败环节、失败原因；失败原因统一使用“失败原因”标签，不使用“错误摘要”。
- 已完成：编辑和预览入口。
- 已取消：有有效 projectId 且流水线已经启动时可进入视频任务编辑页；可修改和保存，但不允许从断点继续。

### 3.1.1 数据与交互校验

- 标题回退顺序固定为 `title → params.title/publishTitle → sourceText/text/场景文案 → 流水线名称 → 未命名任务`；空白字符串视为缺失；run-only 记录（无 project 匹配）在合并时用快照 `params` 回填 title/sourceText，避免卡片显示流水线名与「未生成」占位（2026-08-20 修订，见 PRD-video-creation §3.1.34）。
- project/run 合并先用 projectId、项目 runId、legacy id 建索引。项目内容字段（标题、文案、分段、素材）优先，run 字段（状态、阶段、检查点、错误、运行耗时、runId）补充；只有 runId 的记录不能伪造编辑页项目。
- running 卡片保留暂停、后台运行、取消等流水线控制；paused、interrupted、failed、completed、cancelled 项目卡片进入 `/create/result` 编辑页时不触发任何恢复或取消 IPC。
- 图片、视频、提示词、翻译、字幕和语音任一字段缺失、失败、文件不存在或不可读，详情页保留固定槽位，空背景文字为“未生成”；其他场景仍可编辑。
- `updatedAt` 是操作时间：内容保存、素材/提示词/翻译/语音成功更新，以及暂停、继续、取消、失败、完成状态写回均刷新；合并时取双方最新有效时间。

### 3.2 失败原因显示

主进程/历史记录可保存技术错误，但 renderer 不直接回显 provider JSON、HTTP code、堆栈、token 或内部 prompt-engine 前缀。formatPipelineError 按稳定错误码或已知错误模式映射为自然语言：

| 错误类型 | 中文提示 | English |
|----------|----------|---------|
| 配额/余额不足 | 当前模型额度不足，请检查模型账户余额或更换已配置的模型后重试。 | The selected model has insufficient quota. Check the model account or choose another configured model, then try again. |
| 内容政策拦截 | 部分场景内容未通过生成服务的安全检查，请修改对应文案后重新合成。 | Some scenes were rejected by the provider safety check. Edit the affected text and recompose. |
| 网络/超时 | 生成服务响应超时，请检查网络后重试。 | The generation service timed out. Check the network and try again. |
| 未知失败 | 任务执行失败，请检查配置后重试。 | The task failed. Check the configuration and try again. |

必要时可在错误对话框提供“查看建议”，但历史卡片只展示自然语言摘要，避免卡片布局被技术细节撑宽。

### 3.3 删除合同

- 有 projectId 的记录：显示确认对话框，调用项目删除，清理项目及本地产物。
- 无 projectId 的纯 run 记录：调用 pipeline:delete-run。
- runId 必须是 trim 后非空字符串；非法入参返回结构化错误。
- 运行中的 run 不允许删除，避免删除活跃状态造成并发槽位和历史脱节。
- 成功删除必须同时清理：主 run、pipeline 名称索引、history 条目、run-state-store 快照。
- 持久化清理失败时 fail closed：不显示删除成功，不从可恢复状态中提前移除记录，提示用户重试。
- 删除按钮在所有状态标签均显示；点击删除不会触发卡片打开。

## 4. 视频任务编辑页交互

### 4.1 分段定位

当任务有多个 segments 时，在分段列表上方显示数字快捷跳转条以及“上一条”“下一条”。

- 点击数字：平滑滚动到对应分段，当前数字高亮。
- 点击上一条/下一条：以当前分段为基准移动；第一段禁用上一条，最后一段禁用下一条。
- 分段下标只用于 UI 定位，不改变 segments 数组顺序和持久化 ID。
- 单段任务仍可显示分段标题，但可隐藏无意义的导航按钮。

### 4.2 场景素材与 AI 视频

- 场景素材区的“生成 AI 视频”以当前分段 `videoPrompt || prompt || text` 为提示词源（与后端回退契约一致）；三者全为空或未保存时，按钮禁用并提示“请先编辑或重新生成视频优化词，再生成 AI 视频”。
- “生成新图”“生成 AI 视频”是场景级动作：生成新图显示在 `image1`/`image2` 卡内、生成 AI 视频显示在 `video1`/`video2` 卡内，各卡入口都是同一动作的重复暴露，不改变落点语义；`video1`/`video2` 仍是同一视频身份的视觉别名。
- “当前使用”读取服务端真实保存的 `selectedMaterial`，只接受 `image1 | image2 | video`；候选列表顺序变化、派生 URL 暂时失效或新增视觉别名时，禁止按第一个候选项猜测。
- 生成成功后替换对应场景素材并重新解析本地 URL；失败保留旧素材、清理本次产物并显示可操作失败提示。


### 4.2.1 场景素材视频显示优化（2026-08-18）

#### 需求概述
优化视频任务编辑页中场景素材区的视频显示逻辑，确保用户看到的是该场景在流水线过程中独立生成的视频片段，而非最终合成的成片视频。

#### 功能逻辑与数据来源
- **四个视觉卡位**：每个场景固定渲染 `image1`、`image2`、`video1`、`video2` 四张卡，顺序不可因素材缺失而改变。`image1` 来自 `segment.imagePath`，`image2` 来自 `segment.alternateImages[0].path`，`video1` 优先使用 `segment.videoMeta.sceneVideoPath`，缺失时兼容回退到场景分段字段 `segment.videoPath`，`video2` 仅使用可选的 `segment.videoMeta.altSceneVideoPath`。
- **视觉与持久化边界**：四个视觉卡不等于四个持久化身份。主进程和 `story2video:select-scene-material` IPC 继续只接受 `image1 | image2 | video`；`video1/video2` 是 renderer 视觉别名，任一有素材的视频 radio 发出的 kind 都归一为 `video`。`video` 的当前使用徽标只在 canonical `video1` 卡显示一次，避免两个视觉卡同时伪造两个持久化选择。
- **路径与 URL 校验**：服务端对项目/分段 ID 和素材 kind 做白名单校验，并拒绝不存在的目标槽位；renderer 用 `story2videoCreateShareUrl` 将受控本地路径解析为临时预览 URL。路径存在但 URL 解析失败时保留固定空框、禁止缩略图预览，radio 仍遵循路径存在的服务端选择合同。
- **不能显示成片替代场景素材**：有 `videoMeta.sceneVideoPath` 时始终优先显示场景独立视频；只有旧项目没有该字段时才允许使用 `segment.videoPath` 兼容历史场景视频数据。compose 输出的顶层成片路径不是本区域的数据源。

#### 当前使用状态
- **仅显式选择生效**：只有当用户通过 selectSceneMaterial IPC 显式选择了某个素材槽位（segment.selectedMaterial 被设置为 image1、image2 或 video）时，才在该槽位右上角显示"当前使用"标签。
- **默认无选中**：未显式选择时，所有槽位均不显示"当前使用"标签（effectiveSelectedMaterial 返回 null）。
- **数据校验**：selectedMaterial 必须是 MATERIAL_KINDS 数组中的合法值，否则视为未选择。

#### 空素材占位与四格布局
- **无素材也保留卡位**：任一素材路径缺失，仍渲染同样宽高的 media frame；图片和视频内容使用 `object-fit: cover`，空框使用与缩略图一致的背景色和 `aspect-ratio: 3 / 4` 几何，不压缩、不折叠、不把四列布局变成三列。
- **空态文案唯一且本地化**：空框只显示 locale 的 `emptySlot`（中文“未生成”，英文“Not generated”）一行；不得显示 `Video 1`、`Video 2`、`video1`、`video2` 或第二行未解释的英文 fallback。
- **交互**：没有可用路径和 URL 的缩略图按钮 disabled，不打开预览；没有路径的 radio disabled；空卡不触发选择 IPC。
- **生成按钮**：即使视频 1/视频 2 卡为空，“生成 AI 视频”仍可用，前提是 `videoPrompt`/`prompt`/`text` 任一非空（与后端回退契约一致）且该分段不忙。

#### 生成 AI 视频按钮
- **触发条件**：videoPrompt 非空且当前分段无正在进行的生成任务（isSegmentBusy 为 false）。
- **禁用条件**：videoPrompt 缺失、为空或 trim 后为空白时按钮禁用，title 属性显示提示文字"请先编辑或重新生成视频优化词，再生成 AI 视频"。
- **生成中状态**：按钮文字变为"AI 视频生成中..."，按钮禁用。
- **生成成功**：刷新场景素材 URL，视频槽位显示新生成的 AI 视频片段。
- **生成失败**：保留旧素材，显示可操作失败提示。

#### 媒体框与响应式布局
- **固定尺寸规则**：每个 thumbnail button 宽度为卡片内容区 100%，使用稳定 `aspect-ratio: 3 / 4` 和不小于 96px 的高度；图片、视频和空态共用同一背景框，媒体内容使用 `object-fit: cover`。
- **桌面端**：宽屏四列等宽排列；每张卡的单选项、标签、徽标和所属生成按钮均在自身背景框内，不覆盖相邻卡片。
- **窄屏**：`720px` 及以下改为两列，媒体框几何保持不变；长按钮文案允许换行，不能撑破卡片或遮挡 radio/标签。

#### 分段编辑侧栏
- **布局**：分段快捷定位栏（数字跳转 + 上一条/下一条）从分段编辑区域内提取出来，改为右侧固定竖条（position: fixed; right: 20px; top: 80px），不随页面滚动而移动。
- **宽度**：侧栏宽度 200px，最大高度 calc(100vh - 120px)，内容超出时可纵向滚动。
- **响应式**：窄屏（≤900px）下侧栏隐藏（display: none）。
- **操作条**：底部固定操作条保持在主内容区域底部，不受侧栏影响。

#### 交互逻辑与事件流
1. 页面加载项目后按固定顺序生成四个视觉 slot，并逐个解析 `imagePath`、备选图路径、`sceneVideoPath/videoPath` 和 `altSceneVideoPath` 的预览 URL；任一解析失败只影响该 slot。
2. 用户点击有 URL 的 thumbnail button，只执行 `previewSceneMaterial(slot)`，打开预览，不调用选择 IPC、不改变 `selectedMaterial`。article 不再是 ancestor `label`，避免点击预览被浏览器 label activation 误选 radio。
3. 用户点击 radio 或其紧邻的 label，才执行 `selectSceneMaterial`；renderer 将 `video1/video2` 归一为 `video`，服务端再次校验目标槽位并返回完整 project。成功后刷新 URL、dirty 状态和当前使用徽标；失败保持原选中态。
4. 用户点击空 thumbnail、空 radio 或正在 busy 的控件时不产生副作用。
5. 生成 AI 视频前，如果分段有未保存编辑，先执行 `saveSegments`；保存失败不发起生成。生成和选择共享 `segmentBusy[segmentId]`，防止重复请求。
6. 预览 modal 使用既有 `UiModal` 的 `xl` 尺寸；`image1/image2` 渲染 `<img>`，`video1/video2` 按 slot kind 渲染带 controls/autoplay 的 `<video>`，媒体最大高度受 `75vh` 约束。

#### 显示项
| 元素 | 显示条件 | 文案/内容 |
|------|----------|-----------|
| `image1` | `segment.imagePath` 与 URL 可用 | 图片缩略图；radio 在缩略图下、标签前；卡内显示“生成新图” |
| `image2` | `alternateImages[0].path` 与 URL 可用 | 图片缩略图；卡内显示“生成新图”（场景级动作入口） |
| `video1` | `sceneVideoPath` 或兼容 `videoPath` 与 URL 可用 | 视频缩略图；canonical `video` 选中徽标；卡内显示“生成 AI 视频” |
| `video2` | `altSceneVideoPath` 与 URL 可用 | 可选的视频视觉别名；预览按视频处理，不新增持久化 kind 或重复徽标 |
| 空 media frame | path 或 URL 缺失 | 与缩略图同尺寸背景 + 唯一一行“未生成” |
| 选择控件 | path 存在且分段不 busy | 单选项和本地化 `aria-label`；只有 radio 改变当前使用 |
| 预览 modal | thumbnail path + URL 均可用 | `UiModal size="xl"`，图片/视频分别按 kind 渲染 |

#### 数据校验、错误与边界
- `selectedMaterial`：renderer 和服务端都只接受 `image1 | image2 | video`；非法、空白或未知值按未选择处理，不自动猜测。目标槽不存在时服务端返回 `VALIDATION_ERROR`/可操作错误，不能落库。
- `alternateImages`：非数组、空数组或第一项缺少合法 path 时按空的 `image2` 处理；服务端继续限制最多一项并纳入项目文件引用清理。
- `videoMeta.sceneVideoPath`：有值时优先；缺失时仅兼容回退 `segment.videoPath`。`altSceneVideoPath` 缺失时 `video2` 保留空框，不借用 `video1` URL。
- `videoPrompt`：trim 后为空或缺失时禁用 AI 视频按钮并显示 title 提示；有未保存编辑时先保存，保存失败不进入生成阶段。
- 预览 URL：`story2videoCreateShareUrl` 返回非零 code、空 URL、失效路径或异常时，将该 slot URL 清空；固定 frame 和其他 slot 保持可用。
- 服务端生成失败：旧 image/video path、meta、`selectedMaterial` 保持不变，本次 attemptFiles 清理，用户只看到归一化的本地化提示，不回显路径、堆栈或 provider 原始 JSON。
- 测试至少覆盖：四卡固定顺序、radio-only selection、thumbnail-only preview、video kind 归一、`selectedMaterial` 非法值、path/URL 不一致、AI prompt guard、busy 防抖、旧字段缺省、空卡英文泄漏和 `xl` modal。
### 4.3 音色与语速

- 字段标签从“音色 ID”改为“音色”。
- 当项目 voiceProvider/voiceModel 上下文完整且目录返回非空时显示下拉选择。
- 当前已保存的 voiceId 即使不在最新目录，也必须作为保留选项，不能静默丢失。
- 目录加载失败、目录为空或上下文不完整时回退到文本框，并显示非阻断的“暂时无法获取音色列表”提示。
- 语速为 range：最小 0.5、最大 2.0、步长 0.1，右侧显示当前值；与流水线启动页的语速交互一致。
- 删除“重试图片”“重试视频”；保留“替换旁白”和下载图片/音频/视频动作。

#### 4.3.1 MiMo TTS 语音模型下拉隐藏（2026-09-18）

- 当「语音生成器」为 MiMo TTS（provider id `mimo-tts`）时，「语音模型」下拉选择栏**不显示**。
- 原因：`mimo-v2.5-tts` 与 `mimo-v2.5-tts-voiceclone` 两个模型由「语音 / 音色 ID」下拉区分——选择预置音色走 `mimo-v2.5-tts`，选择克隆音色走 `mimo-v2.5-tts-voiceclone`。
- 音色 ID 下拉显示 9 个官方预置音色（mimo_default/冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean）+ 用户克隆音色。
- 克隆面板显示（选择本地 mp3/wav 音频文件 → 自动克隆，默认名「音色XXX」）。
- 其他 provider（如 MiniMax）语音模型下拉保留（MiniMax 克隆音色自动切换 `speech-02-hd` 模型）。
- 前端判定：`s2vVoiceModelHidden` computed（provider 为 mimo-tts 时 true）；catalog 请求固定用 `mimo-v2.5-tts`，capability/克隆请求用 `mimo-v2.5-tts-voiceclone`。
- MiMo 克隆音色样本要求：mp3/wav、Base64 后 ≤10MB（本地校验按原始字节 ≤10MB 保守执行），由 `getRequirements` 数据驱动展示。


### 4.4 无成片任务编辑

只要存在 projectId 且 segments 非空，即使 videoPath 为空、任务为 failed/paused/尚未合成，也进入编辑区域。仅在既无可编辑 project 又无可预览 path 时显示空状态。

## 5. 状态与流程

### 5.1 暂停与中断来源

“已暂停”仅来自以下明确路径（用户手动动作或人工检查点，2026-08-20 修订）：

1. 用户在流水线启动页运行态点击“暂停”，主进程保存暂停 stage/checkpoint。
2. 用户在携带运行中 runId 的视频任务编辑页点击“暂停”，主进程保存暂停 stage/checkpoint，编辑数据保持不变。
3. 用户在场景素材选择检查点停留，任务等待人工确认。

“已中断”来自非用户主动的异常路径：

4. 应用重启/退出/崩溃/强杀后，持久化 running 快照无法确认仍活跃，归一化为 interrupted。
5. stale-running 展示层检测到长时间无更新（>30 分钟）时归一化为 interrupted。

两个历史 UI（创作页内嵌历史记录 CreateViewHistory.vue 与独立历史页 CreateHistory.vue，2026-08-21 对齐）使用同一规则：仅当 `updatedAt` 存在且超过 30 分钟阈值才翻转；活跃 run 快照不带 updatedAt 时不得误判。

可恢复记录（已暂停/已中断）显示暂停/中断阶段与环境；可恢复记录显示继续动作。暂停保存失败必须恢复原状态、阶段和 checkpoint。


### 5.1.1 可恢复聚合筛选 tab（2026-08-31）

展示层将已暂停和已中断归入同一个可恢复筛选 tab，降低筛选栏认知负担。底层 paused/interrupted 状态值不变，恢复链路、快照持久化、checkpoint 判定和卡片内图标（II/↯）、提示文字（暂停环节/中断环节）均保留差异化。

数据契约：

- HISTORY_STATUSES 新增 recoverable 枚举值，底层 RECOVERABLE_STATUSES = [paused, interrupted] 定义聚合关系。
- filterHistoryByStatus 接受 recoverable 时返回 status 为 paused 或 interrupted 的所有记录，精确匹配 paused/interrupted 仍可用。
- historyStatusCounts 新增 recoverable 计数，累加 paused 和 interrupted 的 count。
- locale tabs: zh/en 中 paused/interrupted 改为 recoverable（可恢复/Recoverable），statuses.interrupted 保留用于卡片内提示。

不可合并的理由：

- 已暂停和已中断的来源不同（用户主动 vs 环境异常），恢复路径和 checkpoint 处理逻辑有差异，合并底层状态需修改 run-state-store、pipeline-engine 和 IPC 合同，风险高、收益低。
- 展示层聚合即可同时满足降低认知负担和保留精确信息的双重目标。

### 5.2 历史进入编辑/恢复

1. 用户进入历史记录，默认展示全部并按有效更新时间倒序。
2. 点击有 projectId 且已启动流水线的 paused、interrupted、failed、completed 或 cancelled 卡片，进入视频任务编辑页；running 卡片回到流水线控制页，纯 run 记录不生成编辑路由。
3. failed/paused/interrupted 且有 runId 的纯运行记录优先显示恢复动作；内容政策失败不原样恢复。cancelled 记录不显示断点继续，但仍可进入有项目的编辑页修改内容。
4. 点击“从断点继续/继续生成”后：后端立即恢复推进该 run；前端跳转流水线启动页并持有该 runId 实时拉取运行态（3s 轮询），直到进入终态（failed/completed/cancelled）或用户离开页面；恢复动作不得停留在历史页等待，避免用户无法看到推进。
5. 无 projectId 的记录不伪造编辑页入口；可恢复或删除。
6. 编辑页保存分段后才清除未保存标记；离开时若有未保存修改，提供保存并离开、不保存离开、取消三个选择。

### 5.2.1 启动/续跑的前台跟踪生命周期（2026-08-21）

1. 启动成功后：`startOrchestrationForeground(runId, pipelineName, outcome)` 保留 runId、立即拉取全量运行快照并开启 3s 轮询；页面从「启动」转入「运行中控制」（暂停/取消），启动/批量入口隐藏；toast 文案为 startForegroundToast。
2. 续跑成功后：`openRunningPipeline` 语义与新启动一致（前台跟踪、toast 为修订后的 backgroundResumeToast），不再创建「启动纯后台、续跑前台」的不对称体验。
3. 检查点例外：scene_asset_selection 保持 paused 与素材选择面板交互；checkpoint 类型为手动暂停/内容政策时按既有规则展示。
4. 离开页面：beforeUnmount 停止 3s 轮询与实时事件订阅，主进程 run 继续自动推进并占用并发槽位；历史记录 5s 轮询展示运行中进度；不弹结果页跳转。
5. 同一 `/create` 页面切换到「历史记录」或「快速渲染」tab，等同于离开创作页：停止 3s 轮询和实时事件订阅，清空当前页面的 run 展示态但不调用取消 IPC；run 继续后台执行并占用并发槽位。切回「流水线创作」时回到新建任务初始态，不自动重挂该 run。
6. 重新进入：mounted 不恢复/不重挂任何 run，回到全新新建状态；在 maxConcurrentRuns 内可再次启动（超限提示由主进程 PIPELINE_CONCURRENCY_LIMIT 返回）。
7. 卸载竞态守卫：`updateOrchestrationStatus`/`applyOrchestrationOutcome` 在 `_s2vAlive === false` 时丢弃在飞响应，禁止已卸载组件触发结果页跳转。
8. 启动 IPC 在途竞态：切 tab、切换流水线、取消或重置会递增启动请求代际；返回响应只有在代际仍一致且当前仍为「流水线创作」tab 时才可挂回 run。失效响应必须静默丢弃，不得重新开启轮询、写入旧错误或改变当前 tab。

### 5.3 顶部地址导航

所有页面继续使用顶部地址栏左侧的后退/前进箭头。显式页面返回只改变目标：编辑页“返回”进入历史记录；浏览器式前进/后退仍由共享导航组件管理。

## 6. 数据校验与安全

- 所有数组字段在 renderer 读取前验证为数组；阶段字段必须是对象且不能是数组或 primitive。
- 数字 ID、duration、时间戳只在有限、可解析且范围合理时展示；无效值统一显示暂无。
- 所有 IPC 参数为纯 JSON 值，不传 Vue reactive proxy。
- delete/pause/resume 失败返回结构化错误，renderer 不把异常或技术堆栈作为成功提示。
- locale 新增/修改必须同步 zh.js 与 en.js；renderer 不新增硬编码中文用户文案。
- Story2Video 失败原因必须遵守“稳定键 + 安全参数 + locale 插值”合同：原始错误只用于分类，不能直接回显；{sceneText}、provider JSON、HTTP 状态码、堆栈、请求 ID、token 和 prompt-engine 前缀均不得进入卡片或对话框。
- 失败提示需要尽可能指出具体模型账号：已识别 minimax-multimodal 显示“MiniMax模型账号”，已识别 kling 显示“Kling模型账号”；未知 provider 显示“当前模型账号”，英文对应 current model account。禁止展示 provider account、account 或“对应模型账号”。
- 允许显示的上下文仅包括场景号、素材完成比例、图片/旁白生成类型等自然语言信息；没有上下文时省略括号，不留下 {context} 等未解析变量。
- 固定操作条不改变主进程任务生命周期，不释放运行中的并发槽位；编辑页仅可通过“暂停”调用既有受校验的 run 控制 IPC，保存和合成操作不修改 run 状态。

## 6.1 统一流水线进度弹窗与后台脱离（2026-08-23）

### 需求判断与产品优化

用户提出的“恢复【后台运行】、进度改为弹窗、关闭后恢复新建态”与现有主进程异步执行模型一致，能够同时解决长配置页被进度内容挤占、运行态与取消语义混淆两个问题。实现时增加一个必要的边界：**等待人工输入的任务不能被后台化**。素材选择、内容策略确认和旧快照中的 `waiting_approval` / `needs_user_input` 如果被隐藏，用户会失去继续任务所需的操作，任务会静默卡住。因此这些状态只允许完成操作、修改内容或取消。

历史页保留运行卡片的轻量进度摘要和 5 秒刷新，用于让用户知道后台任务仍存在；详细阶段观察统一从流水线控制页挂载进度弹窗，避免在多个页面复制一套可操作详情。

### 弹窗尺寸、层级与响应式

- 运行进度使用 `UiModal variant=progress`，桌面宽度上限 `960px`，对应 `xl` 尺寸；弹窗高度随视口计算，最大高度为视口减去固定底部操作条 `88px` 和安全间距。
- 弹窗标题栏与 footer 固定，阶段列表、提示和素材选择区域在 body 内纵向滚动；阶段数量、详情长度变化不得改变底部按钮条位置。
- 进度 overlay 使用 `z-index: 100`，固定 action bar 使用 `z-index: 110`；遮罩保持视觉阻隔，但不能拦截底部操作条的暂停、继续、取消、素材确认等点击。
- 窄屏使用移动操作条空间 `136px`，弹窗仍保持可滚动；长阶段名称和状态文案允许换行，不能溢出或覆盖关闭按钮。
- 弹窗离场同时使用透明度和 `scale(0.96) translateY(4px)` 缩小动画。

### 显示项与文案

进度弹窗保留原进度区域全部有效信息：

1. 流水线名称、总进度百分比、已用时和完成摘要。
2. 全部阶段的本地化名称、状态（等待/进行中/已完成/跳过/失败/取消）、阶段详情、阶段耗时和阶段子进度。
3. Story2Video 合成时间参考说明。
4. provider warning、BGM 跳过提示、状态暂不可用提示和加载提示。
5. `scene_asset_selection` 的候选素材、选择控件、确认动作；内容策略 checkpoint 的修改/取消提示与【编辑场景】入口。
6. 右上角关闭按钮的可访问名称：普通 running 编排任务为“关闭进度并转入后台运行”；内容政策检查点为“关闭并取消该任务”；普通 running 编排任务的 footer 显示【后台运行】。

用户主动脱离后 toast 固定为：

- 中文：`任务已转入后台运行，在历史记录中可查看`。
- English: `The task is now running in the background. You can view it in History.`

### 数据校验与生命周期

- `runId` 必须是 trim 后非空字符串；编排流水线缺少合法 `runId` 不打开按 run 绑定的前台跟踪。
- stages 必须是数组，stage 必须是非空对象；progress、阶段 percent 和 numeric string 只接受有限值并收敛到 `0..100`，非法值隐藏或使用安全回退。
- context、warning、BGM notice 和 checkpoint 只在字段类型正确时展示；原始技术错误、路径、请求 ID、token 和堆栈不进入用户文案。
- 启动、恢复、push、轮询和暂停请求都绑定 runId、request generation、action generation 与组件存活状态；过期响应不得重新打开弹窗、污染新建态或跳转结果页。
- 【后台运行】和右上角关闭共用同一个 renderer detach 方法：先失效请求代际、停止轮询、清理 renderer 运行态、关闭弹窗、恢复“启动流水线”初始页，再刷新历史；不调用 `pipelineCancel`，不释放主进程并发槽位。**内容政策检查点例外**：右上角关闭走 `handlePipelineProgressClose` → `cancelContentPolicyTask`，调用 `pipelineCancel` 取消主进程 run 并复位前端跟踪态，不后台化。
- 完成/失败/取消仍沿用既有终态处理；用户未主动脱离时完成可跳结果页，失败/取消显示既有安全提示。

### 人工检查点例外

当 `scene_asset_selection`、`content_policy`、`waiting_approval`、`needs_user_input` 或 `needsCheckpoint=true` 时：

- 不显示【后台运行】。
- `scene_asset_selection`、`waiting_approval`、非内容政策的 `needs_user_input`：右上关闭按钮 disabled，弹窗显示“当前任务需要完成用户操作后才能继续。”以及对应候选选择/修改/取消操作。
- `content_policy`（图片提示词被判定敏感且重试耗尽）：右上关闭按钮**可点击**，点击=取消任务并关闭弹窗（作为已取消/失败处理），**不是**后台化——内容政策任务不能后台化，否则会静默卡在 `needs_user_input` 无法继续。底部操作条额外显示【编辑场景】按钮，点击后取消任务并跳转 `/create/result?project=<projectId>&focusScenes=<受影响场景号>`，结果页自动定位并高亮受影响场景。
- 即使旧快照缺少 checkpoint 对象，也按状态枚举保护，不因元数据缺失开放后台化。

### 普通流水线能力边界

普通非编排流水线目前有按名称查询状态但没有稳定 run identity 的路径，因此只复用统一视觉弹窗、滚动、提示和 renderer 清理；不伪造按单任务恢复、取消或后台 run 控制。后续若主进程补充稳定 runId，再单独扩展其控制合同。

### 范围边界与废弃组件（2026-08-23 审计收口）

统一进度弹窗合同适用于“有可观察流水线阶段状态”的编排流水线前台跟踪、历史续跑前台跟踪，以及获得稳定 run identity 的普通流水线。以下状态不套用该壳：

- 快速渲染（Remotion）loading 保持该 tab 的轻量过程提示；它没有阶段/runId 合同，也没有历史恢复协议，因此不提供“后台运行/在历史记录中可查看”的声明。
- 发布 timeline 与独立分析状态不属于视频创作流水线阶段，保持各自原有展示。
- `CreateHistory.vue` 是废弃组件：`/create/history` 已重定向到 `/create?view=history`，无生产代码引用；其内嵌进度卡片不得重新接入。当前唯一的生产历史组件为 `CreateViewHistory.vue`（轻量摘要 + 恢复入口）。

## 7. 验收标准

### 功能验收

- 长配置页滚动时底部启动/暂停/继续/取消操作仍可用；运行进度在统一弹窗中可滚动查看。
- 运行中编排任务显示统一进度弹窗；遮罩和 Escape 不关闭，只有右上角关闭按钮可触发后台脱离。
- 点击【后台运行】或右上角关闭后，页面恢复新建态、toast 显示指定文案，历史记录仍能读取该 run。
- 人工检查点隐藏后台入口并禁用关闭，确认/修改/取消路径保持可操作；内容政策检查点例外：关闭按钮可点击（关闭=取消任务），底部提供【编辑场景】直达结果页并定位受影响场景。
- 历史所有状态卡片结构、宽度和通用字段一致，全部状态有删除。
- 失败原因显示自然语言；卡片能通过标题或文案摘要识别具体视频任务。
- 历史详情/编辑入口统一进入视频任务编辑页，旧详情弹窗不再出现。
- 多分段任务可通过数字、上一条、下一条定位；编辑底部操作条不遮挡内容。
- 无成片任务可编辑；视频提示词生成 AI 视频；音色下拉/回退与语速滑条可用。
- 顶部返回/前进和编辑页返回历史记录均可用。
- 模型缺失时点击「启动流水线」被前置拦截：弹窗列出缺失能力（zh/en 能力标签），并提供「去模型设置」直达 /model-providers；纯图片轮播（video 关闭）不因视频模型缺失被拦截；批量创作项逐项拦截并标记失败。

### 质量验收

- 定向桌面 Vitest 全绿。
- locale pair、CJK、lint、依赖解析通过。
- 修改 Electron 主进程后完成 QM-1 打包、asar require 链和 8 秒启动 stderr 验证。
- OpenSpec、CCG task、PRD、CHANGELOG、learnings 和 memory 完成同步；PR 合并后再归档 change/task。

### 7.2 失败提示详细验收

- 场景 22 限流提示显示“（场景 22）”或“(scene 22)”，且不显示 request ID。
- Image provider minimax-multimodal 的额度/API Key/空结果提示显示 MiniMax模型账号 或 MiniMax model account。
- Image provider kling 的限流提示显示 Kling模型账号；无法解析 provider 时显示 当前模型账号，不显示 provider 原词。
- 0/51 scenes have both image and audio 只转成“场景 0/51，图片和旁白生成”等自然语言，不显示原始异常句。
- 历史旧数据包含 sceneText 时仍可打开；渲染前忽略该内部字段，最终文案不得出现 {sceneText}。
- 点击恢复、重试、编辑和删除的状态门控与本次改造前一致；文案细化不改变 run 状态、并发槽位和持久化字段。

## 9. 选项控制模块（Pipeline Options Control）

> 状态：已实现，待合并验收
> 日期：2026-09-01
> 关联任务：ccg/tasks/s2v-option-reorg-ops-control/
> 适用范围：运营中心后台管理 + 桌面端视频创作页选项显隐与默认值

### 9.1 目标

运营管理员可通过运营中心后台，实时控制桌面端视频创作页中各选项的显示/隐藏及默认值，无需发布桌面端更新。桌面端启动时通过 bootstrap 接口拉取配置，运行时按配置渲染选项。

### 9.2 数据模型

#### 9.2.1 选项分组

| 分组 key | 分组名称 | 说明 |
|----------|---------|------|
| `basic` | 基础 | 分辨率、旁白语速、旁白音量 |
| `visual` | 画面 | 字幕样式、视觉风格、图片生成器、内容类型 |
| `videoEnhance` | 视频增强 | AI 视频增强、视频模式、动态强度 |
| `voice` | 声音 | 音色、音色克隆/复制、配音员 |
| `advanced` | 高级 | 优化风格、分段模式、检测场景切换 |
| `publish` | 发布 | 仅整组控制，无独立选项显隐 |

#### 9.2.2 选项字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `option_key` | string | 全局唯一键，格式 `group.field`（如 `basic.resolution`） |
| `group` | string | 所属分组 |
| `field` | string | 字段名（与前端 s2vConfig 字段对应） |
| `label` | string | 中文显示标签 |
| `visible` | int | 1=可见，0=隐藏 |
| `default_value` | string | 默认值（JSON 字符串或字面值） |
| `description` | string | 提示描述 |
| `sort_order` | int | 排序 |
| `updated_at` | datetime | 最后更新时间 |
| `updated_by` | string | 更新人 |

#### 9.2.3 选项目录（完整清单）

| option_key | group | 默认值 | 类型 |
|------------|-------|--------|------|
| `basic.resolution` | basic | `"1920x1080"` | 枚举 |
| `basic.voiceSpeed` | basic | `"1.0"` | 浮点 |
| `basic.voiceVolume` | basic | `"1.0"` | 浮点 |
| `visual.subtitleStyle` | visual | `"default"` | 枚举 |
| `visual.visualStyle` | visual | `"none"` | 枚举 |
| `visual.imageGenerator` | visual | `"minimax-multimodal"` | 枚举 |
| `visual.contentType` | visual | `"mixed"` | 枚举 |
| `videoEnhance.mode` | videoEnhance | `"off"` | 枚举 |
| `videoEnhance.dynamicIntensity` | videoEnhance | `"medium"` | 枚举 |
| `voice.voice` | voice | `""` | 字符串 |
| `voice.voiceClone` | voice | `""` | 字符串 |
| `voice.narrator` | voice | `"default"` | 枚举 |
| `advanced.optimizeStyle` | advanced | `"balanced"` | 枚举 |
| `advanced.splitMode` | advanced | `"auto"` | 枚举 |
| `advanced.detectSceneChanges` | advanced | `"true"` | 布尔 |
| `publish._group` | publish | — | 布尔（整组开关） |

### 9.3 数据校验规则

#### 9.3.1 后端校验（pipeline_option_service.py）

1. **option_key 校验**：必须存在于 `VALID_OPTION_KEYS` 白名单中，否则拒绝 upsert。
2. **visible 校验**：必须为 0 或 1。
3. **default_value 校验**：按字段类型校验：
   - 枚举型：必须在允许值列表中（如 resolution 只允许 `["1920x1080", "1280x720", "1080x1920", "720x1280", "1:1"]`）。
   - 浮点型：必须可解析为 float，且在范围内（如 voiceSpeed: 0.5-2.0, voiceVolume: 0.0-2.0）。
   - 布尔型：必须为 `"true"` 或 `"false"`。
   - 字符串型：允许任意非空字符串。
4. **group 校验**：必须存在于 `VALID_GROUPS` 中。
5. **批量 upsert**：事务性写入，任一校验失败则整批回滚。

#### 9.3.2 前端校验（PipelineOptions.vue）

1. 保存前本地校验类型格式（布尔值必须为 true/false，数值必须为有效数字）。
2. 枚举值提供下拉选择，防止输入非法值。
3. 重置按钮恢复为后端当前值（放弃本地修改）。

### 9.4 数据流

```
┌─────────────────────┐
│ 运营中心前端         │
│ PipelineOptions.vue  │ ── PUT /api/v1/pipeline-options ──→ ┌──────────────────┐
│ (管理员配置)         │ ←── GET /api/v1/pipeline-options ── │ 运营中心后端      │
└─────────────────────┘                                      │ FastAPI           │
                                                             │ pipeline_options  │
                                                             │ router            │
                                                             └────────┬─────────┘
                                                                      │
                                                             pipeline_option_service
                                                             ┌────────┴─────────┐
                                                             │ SQLite DB        │
                                                             │ pipeline_options │
                                                             │ table            │
                                                             └────────┬─────────┘
                                                                      │
                                                   runtime_service.get_runtime_bootstrap()
                                                   ┌────────┴─────────┐
                                                   │ _get_pipeline_    │
                                                   │ options()         │
                                                   │ → { visibility,   │
                                                   │     defaults }    │
                                                   └────────┬─────────┘
                                                            │
                               ┌────────────────────────────┴────────────────────────────┐
                               │ Desktop Electron (ops-center-sync.js)                   │
                               │ bootstrap → runtimeState.pipelineOptions                │
                               │ IPC: ops-center-sync:pipelineOptions                    │
                               └────────────────────────────┬────────────────────────────┘
                                                            │
                               ┌────────────────────────────┴────────────────────────────┐
                               │ Desktop Frontend (CreateView.vue)                       │
                               │ loadPipelineOptions() → s2vPipelineOptions              │
                               │ applyS2VPipelineDefaults() → s2vConfig / s2vOutputConfig│
                               │ s2vOptionVisible(key) → v-if 条件渲染                  │
                               └─────────────────────────────────────────────────────────┘
```

### 9.5 功能逻辑

#### 9.5.1 可见性判断（s2vOptionVisible）

```
s2vOptionVisible(optionKey):
  1. 如果 pipelineOptions.visibility 中存在 optionKey：
     → 返回 visibility[optionKey] === true
  2. 否则，解析 optionKey 的 group（如 "basic.resolution" → "basic"）：
     → 如果 visibility 中存在 group._group：
       → 返回 visibility[group._group] === true
     → 否则：返回 true（fail-open，未配置视为可见）
```

**特殊处理**：
- `publish` 组只有 `publish._group` 键，无独立选项可见性。发布组所有选项（标题、标签、分辨率等）统一由 `publish._group` 控制。
- 系统默认选项（如 `_group` 键）在种子数据中创建，`visible=1`。
- 隐藏选项对应字段不参与表单提交和校验。

#### 9.5.2 默认值应用（applyS2VPipelineDefaults）

```
applyS2VPipelineDefaults():
  遍历 pipelineOptions.defaults：
    keyMap 映射 option_key → s2vConfig/s2vOutputConfig 字段路径
    如果 keyMap 中不存在映射，跳过该选项
    如果字段类型为数值（float），转换为数字
    如果字段类型为布尔，转换为 boolean
    如果字段类型为枚举，直接赋值字符串
```

**keyMap 映射表**（option_key → 配置路径）：

| option_key | 目标字段 |
|------------|---------|
| `basic.resolution` | `s2vOutputConfig.resolution` |
| `basic.voiceSpeed` | `s2vConfig.voiceSpeed` |
| `basic.voiceVolume` | `s2vConfig.voiceVolume` |
| `visual.subtitleStyle` | `s2vConfig.subtitleStyle` |
| `visual.visualStyle` | `s2vConfig.visualStyle` |
| `visual.imageGenerator` | `s2vConfig.imageGenerator` |
| `visual.contentType` | `s2vConfig.contentType` |
| `videoEnhance.mode` | `s2vConfig.videoMode` |
| `videoEnhance.dynamicIntensity` | `s2vConfig.dynamicIntensity` |
| `voice.voice` | `s2vConfig.voice` |
| `voice.voiceClone` | `s2vConfig.voiceClone` |
| `voice.narrator` | `s2vConfig.narrator` |
| `advanced.optimizeStyle` | `s2vConfig.optimizeStyle` |
| `advanced.splitMode` | `s2vConfig.splitMode` |
| `advanced.detectSceneChanges` | `s2vConfig.detectSceneChanges` |

#### 9.5.3 加载与容错

```
loadPipelineOptions():
  1. 设置 s2vPipelineOptionsLoading = true
  2. 调用 opsCenterSyncPipelineOptions() IPC
  3. 成功：存储到 s2vPipelineOptions
     → 调用 applyS2VPipelineDefaults()
  4. 失败：fail-open，保持当前配置不变
     → 所有选项可见（s2vOptionVisible 返回 true）
  5. 设置 s2vPipelineOptionsLoading = false
```

**容错原则**：
- 加载失败不阻塞创建流程。
- 隐藏选项的配置值不参与表单提交（保留默认值）。
- 空 visibility map 等同于全部可见。
- 空 defaults map 等同于使用前端默认值。

### 9.6 交互规范

#### 9.6.1 桌面端选项显隐

- 隐藏选项完全从 DOM 移除（v-if="false"），不占用布局空间。
- CSS grid 使用 `auto-fill` + `minmax` 保证剩余选项自动填充空白。
- 分组完全无可见选项时，整组折叠且不显示标题。
- 分组摘要（s2vSectionSummary）仅统计可见选项的值。

#### 9.6.2 运营中心管理页

- 默认显示所有选项（含隐藏），按分组卡片排列。
- 可见性开关：点击切换 visible 状态，即时反映（无需保存）。
- 默认值输入：根据字段类型提供对应控件（下拉/输入框/开关）。
- 保存按钮：批量提交所有修改，成功后显示"保存成功"提示。
- 重置按钮：放弃本地修改，恢复为后端当前值。
- 过滤栏：支持按分组筛选、按可见性筛选、按关键字搜索。

#### 9.6.3 发布组特殊交互

- 发布组仅显示一个 `_group` 开关，控制整组显隐。
- 发布组开关关闭时，CreateView 中发布配置区域完全隐藏。
- 发布组无独立选项默认值（发布标题、标签等不通过选项控制设置默认值）。

### 9.7 显示项与提示文字

#### 9.7.1 桌面端 CreateView

| 显示项 | 位置 | 说明 |
|--------|------|------|
| 分组标题 | 各选项组顶部 | 基础/画面/视频增强/声音/高级/发布 |
| 分组摘要 | 折叠状态下的副标题 | 显示当前关键配置值（如"16:9横屏 1920x1080 / 语速 1.0x / 音量 100%"） |
| 选项标签 | 各选项左侧 | 中文标签（如"比例与分辨率"） |
| 选项控件 | 各选项右侧 | 下拉/输入框/滑条/开关 |
| 试听按钮 | 旁白语速/旁白音量旁 | 按当前语速+音量播放试听音频 |
| 空态提示 | 分组完全隐藏时 | 不显示该分组（整组从 DOM 移除） |

#### 9.7.2 运营中心 PipelineOptions

| 显示项 | 说明 |
|--------|------|
| 分组卡片 | 每个 group 一个卡片，标题为分组中文名 |
| 可见性开关 | 绿色=可见，灰色=隐藏 |
| 默认值控件 | 下拉框（枚举）、输入框（文本/数字）、开关（布尔） |
| 选项描述 | 灰色小字，显示 description 字段 |
| 过滤栏 | 下拉选择分组 + 关键字搜索 + 可见性筛选 |
| 保存按钮 | 右上角，蓝色主按钮 |
| 重置按钮 | 保存按钮旁，灰色次按钮 |
| 保存成功提示 | 绿色 toast "保存成功" |
| 保存失败提示 | 红色 toast "保存失败：{错误信息}" |

### 9.8 安全与权限

- 运营中心 pipeline-options 路由仅管理员可访问（`role: admin`）。
- API 接口 `GET /api/v1/pipeline-options` 和 `PUT /api/v1/pipeline-options` 均需 JWT 认证。
- 桌面端 IPC 通道 `ops-center-sync:pipelineOptions` 为公开通道（PUBLIC_CHANNELS），无需登录即可调用。
- bootstrap 接口不暴露 API Key 等敏感信息。

### 9.9 已知限制

- 选项默认值不覆盖用户已修改的值（仅在首次加载时应用）。
- 选项隐藏后，已配置的值在提交时保留（不参与校验但保留在 s2vConfig 中）。
- 运营中心前端 `typelabel` 占位符为静态文本，未从 API 动态获取（低优先级）。
- 发布组独立选项（标题、标签、分辨率等）不在选项目录中，仅通过 `_group` 整组控制。

## 11. 详情页视觉与交互精致化契约（2026-09-20）

> 本章是「故事讲述（story2video-compose）流水线详情页」的**视觉 + UE 实现合同**，
> 与 §2.1.6 滚动合同、§9 选项控制模块同级。落笔粒度到字段与像素级：任何后续改动若与本章
> 冲突，必须先改本章再改代码，不允许「代码先行、文档追认」。
> 范围：**详情页 + 共享骨架**。快速渲染页、历史记录页、流水线列表页的全量精致化不在本章内。

### 11.1 根因溯源（用户感知「粗糙、散乱、不精致」的可验证分解）

| # | 根因 | 证据 | 等级 | 本章小节 |
|---|------|------|------|---------|
| R1 | `.create-page` 缺 `width: 100%` → 列宽退化为 `fit-content`，设计列宽 1080px 实测约 500px，右侧大片死白 | `App.vue` 的 `.cohere-main` 为 flex column + `create-view.css` 的 `margin: 0 auto` | **P0** | 11.2 |
| R2 | `.back-btn` 位于 flex column 的 `.pipeline-detail` 内，被 `align-items: stretch` 拉成通栏灰条 | `create-view.css` `.back-btn` | **P0** | 11.2 |
| R3 | 全站零原生表单控件定制：`input[type=range]` / `accent-color` / `appearance: none` 在 `apps/desktop/src/styles/` 下 0 命中 → 滑条为浏览器默认亮蓝，与品牌紫冲突；`<select>` 是裸原生控件 | 改动前 `create-view.css` 的 `.form-range` 只有 `width: 100%` 一行 | **P0** | 11.3 / 11.4 |
| R4 | 令牌/组件双轨：`UiButton/UiSelect/UiInput` 消费 `@deprecated` 的 `--apple-*`（`--apple-accent → #007aff` Apple 蓝），与 `--color-primary: #5048E5` 不同源；详情页混用 `UiButton + .btn-start + .btn-secondary + .reset-options-link + 原生 button` | `UiButton.vue`、`apple-design-tokens.css`、`CreateView.vue` 详情页操作面 | P1 | 11.7 |

次级粗糙源（同批修复）：`.view-tabs` 无宽度约束致尾部空灰；`.input-tab.active` 实心主色胶囊视觉重量压过主 CTA；`.reset-options-link` 把 3 个真实操作降级为下划线灰文字（可点击性不可见）；字符计数游离成灰药丸；`detail-header` 是卡片而「输入内容」是裸 `<h3>`（表面处理不统一）；硬编码文案「点击"启动流水线"即可进行流水线自动多个阶段，不需逐步确认。」语句不通顺。

### 11.2 布局与列宽合同（影响 CreateView 全部视图）

| 选择器 | 合同值 | 不可回退的理由 |
|--------|--------|---------------|
| `.create-page` | `width: 100%; max-width: 1080px; margin: 0 auto; padding: 24px 32px; min-height: 100%; display: flex; flex-direction: column` | **flex 交叉轴上的 auto margin 会抑制 `align-self: stretch`**，使宽度退化为 `fit-content(max-content)`——列宽由「最宽子元素」决定而非设计值。`width: 100%` 是唯一稳定解。`box-sizing` 由 `cohere-design-system.css` 的 `*,*::before,*::after` 全局 reset 提供，**禁止在此重复声明**（重复声明曾导致 `.rewrite-page` 内边距双算） |
| `.create-page--pipeline-detail` | `height: 100%; min-height: 0; min-width: 0; overflow: hidden; padding-bottom: 0` | `min-width: 0` 阻止子项内容把列撑破 1080px 预算；`padding-bottom: 0` 把底部安全空间交给 `.action-bar` |
| `.create-page--pipeline-list` | `max-width: 1600px`（≥1600px 视口时 `calc(100% - 64px)`） | 列表页刻意放宽以支持多列卡片，**不受 1080px 合同约束** |
| `.view-tabs` | `display: flex; gap: 4px; width: 100%; padding: 4px`，子项 `.view-tab { flex: 1 1 0; min-width: 0; text-align: center }` | 页签数量可变（当前 3 个），**禁止硬编码栅格列数**（`repeat(4, …)` 在 3 页签下会留 1/4 空灰）。等分用 `flex: 1 1 0 + min-width: 0` 达成，与「容器不溢出 + 文案可截断」同时成立 |
| `.view-tab.active` | 白底 + `box-shadow: var(--shadow-float)` + `font-weight: 600` + 底部 20×2 指示条 | 移除 `transform: scale(1.02)`：scale 在 flex 行内触发布局抖动，且与指示条位移打架 |
| `.back-btn` | `align-self: flex-start` + 描边胶囊 | 终止 `align-items: stretch` 的通栏拉伸（实测宽度从整列收敛到 71px） |
| `.page-header-nav` | 详情页态 `display: none`（`.create-page--pipeline-detail .page-header-nav`） | 顶部返回箭头与详情内 `.back-btn` 语义重复，去重后返回入口唯一 |
| `.view-pane` / `.pipeline-detail` / `.pipeline-detail-scroll` | `flex: 1; min-height: 0; overflow: hidden` / 内层 `overflow-y: auto` | **§2.1.6 滚动合同的实现基座**：正常流底部 + 内层独立滚动。`.action-bar` 必须在滚动容器之外 |
| `.action-bar` | `gap: var(--spacing-3)`；主 CTA 靠左，辅助操作组 `margin-left: auto` 靠右 | 操作分级：主/次操作在左、配置管理在右，不再同排混排 |
| `.detail-header` / `.input-section` / `.s2v-config-section` | **统一卡片表面**：`background: var(--color-bg-card)` + `border: 1px solid var(--color-border)` + `border-radius: 12px` + `padding: var(--spacing-5)` | 「头部是卡片、输入区是裸标题」的混用是散乱感主因；三块同规格后视觉重量可比 |
| `.s2v-field-grid` | `display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` | 替代固定列 `.config-grid`：窄容器自动折行，不出现 120px 挤压 |

### 11.3 新增复用组件契约

#### `UiSlider.vue`（`apps/desktop/src/components/`）

| 维度 | 合同 |
|------|------|
| props | `modelValue: Number`（受控，必填）、`min = 0`、`max = 100`、`step = 1`、`label: String`、`suffix: String`、`defaultValue: Number`（缺省回落 `(min+max)/2`）、`disabled: Boolean`、`format: Function`（受控格式化，优先于内置）、`hint: String`、`testid: String` |
| emits | `update:modelValue`（拖动实时）、`change`（值真正变化时） |
| 轨道 | 高 4px、`border-radius: var(--radius-full)`、底色 `var(--color-border)`；已填充段用 `linear-gradient(to right, var(--color-primary) 0 var(--pct), var(--color-border) var(--pct) 100%)`；`--pct` 由 computed 写入内联 `:style` —— **这是全页唯一允许的内联样式，且只有数值** |
| 滑块 | 16px 白底 + `1px solid var(--color-primary)` + `box-shadow: 0 1px 3px rgba(0,0,0,.15)`；`:hover:not(:disabled)` `scale(1.08)`；`:focus-visible` `outline: 2px solid var(--color-primary-dark-tint); outline-offset: 2px` |
| 值显示 | 与 label 同行、`justify-content: space-between`；`font-variant-numeric: tabular-nums`；小数位数由 `step` 推导（`decimalsFromStep`），**不写死** `toFixed(1)` |
| 复位 | 双击滑杆轨 → `resetToDefault()`；仅当 `min ≤ defaultValue ≤ max` 才写值并 emit；`disabled` 时直接 return |
| 键盘 | `↑/→` `+step`、`↓/←` `-step`、`PageUp` `+step*10`、`PageDown` `-step*10`，`End` → `max`；全部经 `normalize()` 做 `clamp` + 步长对齐 |
| 越界 | `normalize(v)`：非有限数 → `clamp(defaultDisplay, min, max)`；字符串 `'0.8'` → `0.8`；`NaN`/`Infinity` 不写入 |
| 降级 | `@media (prefers-reduced-motion: reduce)` 关闭 `:hover` 的 `transform` |
| 令牌 | 只消费 `tokens.css` 的 `--color-*` 与 `cohere-design-system.css` 的暗色感知别名（`--ink` / `--muted`）；**禁止 `--apple-*`** |

#### `UiField.vue`

| 维度 | 合同 |
|------|------|
| props | `label`、`hint`、`error`、`optionKey`、`required`、`inline`、`reserveError`（默认 **false**）、`for`（DOM id） |
| slots | `default`（控件）、`suffix`（值/操作） |
| 运营隐藏守卫 | `optionKey` 为空 → 始终渲染；非空 → 仅当 `ctx.visible(optionKey)` 为真才渲染。**fail-open 语义不得绕过**：`ctx` 缺失（未被 provide）时 `visible()` 返回 true，避免整块空白 |
| 错误态 | `aria-invalid="true"` + `.has-error` + `role="alert"` 文案；`reserveError` 为真时固定预留 18px 错误行（见 11.11 偏离 D5） |
| inline | `inline` → `data-inline="true"`，用 `grid-template-columns: max-content minmax(0,1fr)`，禁用控件列跨 2 列 |

#### `UiSelect.vue` 本次扩展

- 新增 `optionKey` prop：为空 → 不包裹（**向后兼容，既有调用方零改动**）；非空 → 内部套 `UiField`，由 `UiField` 统一处理显隐 + label + hint + 错误位。
- 新增 `hint` / `error` 透传；`suffix` slot 与 `#option` slot 行为不变。
- 组件内 `--apple-*` 消费点全部改为 `--color-*` + `--ink`（局部收敛，不动 `apple-design-tokens.css`）。
- 详情页 **27 个 `<select>` 全量迁移**，迁移后详情页裸 `<select>` 数 = 0（像素探针实测 `bareSelects: 0`）。

### 11.4 控件级显示项 / 取值范围 / 步长 / 默认值（逐字段，与代码同源）

分组归属与顺序严格保持 §9 目录：`basic / visual(外观) / videoEnhance / voice / advanced / publish`。

**滑杆（7 个，全部 `UiSlider`）**

| 显示项 | 绑定字段 | optionKey | min | max | step | 默认 | 后缀 | testid |
|--------|---------|-----------|-----|-----|------|------|------|--------|
| 旁白语速 | `s2vConfig.voiceSpeed` | `basic.voiceSpeed` | 0.5 | 2 | 0.1 | 1 | `x` | `s2v-voice-speed` |
| 旁白音量 | `s2vConfig.voiceVolume` | `basic.voiceVolume` | 0 | 2 | 0.05 | 1 | 无 | `s2v-voice-volume` |
| 背景音乐音量 | `s2vConfig.bgmVolume` | `voice.bgmVolume` | 0 | 10 | 1 | 5 | 无 | `s2v-bgm-volume` |
| AI 视频占比（前段） | `s2vConfig.videoFixedRatio` | —（随 `videoMode` 条件渲染） | 10 | 50 | 5 | 25 | `%` | `s2v-video-fixed-ratio` |
| AI 视频占比下限 | `s2vConfig.videoMinRatio` | — | 5 | 50 | 5 | 20 | `%` | `s2v-video-min-ratio` |
| AI 视频占比上限 | `s2vConfig.videoMaxRatio` | — | 10 | 80 | 5 | 40 | `%` | `s2v-video-max-ratio` |

- 三个占比滑杆仅在 `videoMode` 命中相应分支时渲染（`fixed` / `ai-judged`），故默认折叠态下 DOM 内 `UiSlider` 数为 3（探针实测 `uiSliders: 3`）。
- 语速/音量/背景音乐音量三项 `hint` 均挂 `create.story2video.ui.doubleResetHint`。
- 「旁白试听」按钮读取当前 `voiceSpeed` / `voiceVolume` 实时值，不与滑杆状态分离。

**下拉（27 个，全部 `UiSelect`；仅列 optionKey 守卫项）**

| 显示项 | 绑定字段 | optionKey | 允许值 / 校验 |
|--------|---------|-----------|--------------|
| 比例与分辨率 | `activeOutputConfig.resolution` | `basic.resolution` | 运营后台允许枚举；值变化只改输出配置，不触发流水线重置 |
| 图片风格 | `s2vConfig.imageStyle` | `visual.imageStyle` | `cinematic/realistic/anime/watercolor/minimalist` |
| 提示词风格 | `s2vConfig.promptStyle` | `visual.promptStyle` | 同上枚举 |
| 图片动效 | `s2vConfig.imageEffect` | `visual.imageEffect` | `none` + 8 种运镜；`none` 时不产生动效提示 |
| 转场 | `s2vConfig.transition` | `visual.transition` | `none/fade/slide-left/right/up/down` |
| 字幕 / 字幕字号 / 字幕样式 | `subtitleEnabled` / `subtitleSize` / `subtitleStyleName` | `visual.subtitle*` | 关闭字幕时下游不渲染字幕轨 |
| 背景音乐 | `s2vConfig.bgmPath` | `voice.bgm` | 允许「不使用背景音乐」+ 曲库项 + 未入库历史值 |
| 水印位置 / 字号 / 透明度 | `s2vConfig.watermarkConfig.*` | `visual.watermark*` | 字号 ∈ {16,24,32,40,48}；透明度 ∈ 0.1–1.0（步 0.1）；`moving` 为平滑循环漂移 |
| 图片生成器 / 视频生成器 / 语音生成器 | `imageProvider` / `videoProvider` / `voiceProvider` | `visual.imageProvider` / — / `voice.voiceProvider` | 由模型能力目录驱动；变更触发 `@change` 能力联动 |
| 视频增强模式 / 短视频处理 | `videoMode` / `shortVideoHandling` | `videoEnhance.videoMode` / — | 枚举受 `videoMode` 条件约束 |
| 内容类型 / 分句语言 / 分句模式 | `contentType` / `splitLanguage` / `splitMode` | `advanced.*` | 运营枚举 |
| 模板分类 / 视频模板 | `s2vTemplateCategory` / `s2vConfig.templateId` | `advanced.template*` | 选模板 → `applyS2VTemplate` 批量写回参数 |
| 帧率 / 格式 | `activeOutputConfig.fps` / `.format` | `advanced.fps` / `advanced.format` | fps ∈ {24,30,60}；format ∈ {mp4, webm} |
| 语音模型 / 音色 ID | `s2vConfig.voiceModel` / `voiceId` | —（受服务商能力驱动） | 目录加载失败显示 `inline-error`，不静默吞错 |

**数值输入与开关（保持原生，走 `.form-input` 统一外观）**

| 显示项 | 校验 | 边界 |
|--------|------|------|
| 目标字数 | `min="1"`、`max=s2vSceneCharsLimit` | 视图模式 `chars` 时显示 |
| 目标时长（秒） | `min="1"`、`max=s2vSplitMaxSeconds`、`step="0.5"` | 视图模式 `seconds` 时显示 |
| 最短场景时长 | 复选框启用 + `min="1" max="60" step="1"` | 未启用时不参与校验、不写入 payload |
| 分镜粒度视图切换 | `role="group"` + `aria-pressed` | 二选一，不出现双选 |

### 11.5 数据校验规则与边界

1. **数值一律 clamp，不抛错**：`UiSlider.normalize()` 与 `setS2VConfigValue` 组合保证越界值回落区间内；`Infinity` / `NaN` / 空串一律视为非法并回落默认显示值。
2. **运营显隐优先于用户态**：`s2vOptionVisible(key)` 为 false 时该字段**不渲染**，但其既有值保留在 `s2vConfig` 中（§9.9 行为），提交时不参与校验、仍随配置持久化 —— 防「隐藏即丢数据」。
3. **枚举值非法回落**：`UiSelect` 的 `v-model` 值不在 `options` 中时显示为浏览器默认首项，不伪造合法值；由 §2.1.1 启动前置校验（`PIPELINE_MODEL_REQUIREMENTS_MISSING`）兜底。
4. **字符计数上限**：`MAX_STORY2VIDEO_TEXT_CHARACTERS = 6000`；`textarea` 设 `maxlength` 禁止粘贴溢出；计数为**实时 `length`**，无 debounce。
5. **写路径唯一**：详情页子组件（`S2vConfigPanels.vue`）与父组件共享同一 `s2vConfig` / `s2vOutputConfig` 响应式对象引用，写操作全部经 `v-model` 直绑；**不新增第二数据源、不新建 store、不整体替换对象**（引用稳定性由 `cloneForIpc` / `applyS2VPipelineDefaults` / `pickS2VConfigProfileFields` 三处消费点依赖）。`s2vConfig` 的 `deep: true` watcher 与 `scheduleS2VLastOptionsSave()` 节流语义**逐字节保持不变**。
6. **折叠面板展开态**：走既有 `ui.expandedGroups` 持久化通道，读取失败 → 回落该组默认展开；不因持久化异常阻塞渲染。

### 11.6 交互逻辑（状态机与反馈）

| 交互 | 合同 |
|------|------|
| 启动流水线禁用 | `canStartPipeline === false` 时**不再静默禁用**：按钮 `:disabled` + `:title="pipelineBlockedReason"` + `:aria-describedby="pipeline-blocked-reason"`，并在下方常驻 `.s2v-start-hint`（`data-testid="pipeline-blocked-reason"`，`role="status"`）显示**首条**阻塞原因。原因优先级见 11.8 `blockedReason.*` |
| 成本/时长预估 | 容器 `.s2v-estimate-slot` 固定 `min-height: 44px`；`s2vEstimateSummary` 为空时显示占位文案而非塌陷 → 防布局跳动 |
| 折叠分组 | `<details>/<summary>`；`<summary>` 右侧显示 `.s2v-summary` 摘要值，未改动组追加 `（默认）` 后缀；展开态切换即写节流保存 |
| 配置管理三操作 | 「恢复默认选项 / 保存配置 / 我的配置」由下划线灰文字链接升级为 `.s2v-btn-ghost .s2v-btn-sm`，`data-testid` 全部保持（`reset-story2video-options`、`s2v-config-profile-save`、`s2v-config-profile-manage`） |
| 输入页签 | `.input-tab` 容器 `role="tablist"`，子项 `role="tab"` + `:aria-selected`；active 态由实心主色降级为浅底描边（不再压过主 CTA） |
| 入场动效 | `.s2v-config-section` 接入 Staggered Reveal：`style="--stagger-index: n"`（数组下标）+ `animation: s2v-reveal .32s cubic-bezier(0.33,1,0.68,1) both; animation-delay: calc(var(--stagger-index) * 0.08s)`；只动画 `transform` / `opacity` |
| 卡片悬停 | `.s2v-card:hover` → `translateY(-1px)` + 阴影抬升；`prefers-reduced-motion` 下 `transform: none; box-shadow: none` |
| 主 CTA 流光 | `.s2v-cta-shimmer::after` 2.6s 循环 `translateX`；`:disabled` 与 `prefers-reduced-motion` 下 `animation: none; opacity: 0`；`pointer-events: none`（不拦截点击） |
| 焦点 | 所有新增交互元素统一 `:focus-visible` outline；**禁止无替代的 `outline: none`** |

### 11.7 令牌与视觉一致性（D2 决策与其完成态）

**决策**：本批次详情页收敛到 `.s2v-btn-*` 品牌紫体系，**不改 `--color-apple-accent` 取值**。
理由：改 accent 会一次性改变全站所有 `UiButton` primary 颜色，导致全部视觉基线大面积重跑，把不可控范围混进本 PR。

**已完成收敛（详情页子树内 19 处双轨清零）**

| 位置 | 原实现 | 现实现 |
|------|--------|--------|
| 主 CTA「启动流水线」 | `<UiButton class="btn-start">`（Apple 蓝） | `<button class="s2v-btn-primary btn-start s2v-cta-shimmer">` |
| 「批量创作」 | `<UiButton class="btn-start">` | `<button class="s2v-btn-secondary btn-start s2v-batch-trigger">` |
| 配置管理三兄弟 | `.reset-options-link` | `.s2v-btn-ghost .s2v-btn-sm` |
| 运行控制（编辑场景 / 编排暂停 / 恢复 / 暂停 / 确认并继续 / 取消） | 6 个 `UiButton` | `.s2v-btn-secondary` / `.s2v-btn-resume` / `.s2v-btn-primary` / `.s2v-btn-danger` |
| 分镜素材横幅「去选择素材」 | `UiButton` | `.s2v-btn-primary .s2v-btn-sm` |
| 音色/背景音乐/模板等次操作 | 12 个 `.btn-secondary`（含 `.danger`） | `.s2v-btn-secondary` / `.s2v-btn-danger`（密集行加 `.s2v-btn-sm`） |

**为什么必须换元素而不是加类**：`UiButton` 的 scoped 样式 `.ui-btn-primary[data-v-x]` 特异性为 (0,2,0)，压过外部 `.s2v-btn-primary` 的 (0,1,0)，加类无效。

**排版承接**：`.s2v-btn-*` 不自带 `margin-top`，故 `video-creation-forms.css` 补 `.config-item > .s2v-btn-secondary { margin-top: 8px }` 与 `.template-editor .s2v-btn-secondary/.s2v-btn-danger { margin-top: 0; min-height: 38px }`，保证「换类名不换排版」。（规则放 forms 文件而非 `create-view.css`，因为后者已 496 行，再加会越过 `check-debt-budget.js` 的 500 行预算线。）

**边界（明确不在本批次）**：弹窗 `UiModal #footer` 内的 `UiButton`（后台运行 / 错误对话框 / 删除确认）属 §6.1 弹窗契约管辖，未改；全站 `UiButton/UiInput` 的 `--apple-* → --color-*` 收敛登记为 backlog change `ui-apple-token-retirement`。同时 `.s2v-btn-primary` 的 fallback 值已从 Element 蓝 `#409eff` 修正为 `var(--color-primary, #5048E5)`。

**特异性确定性**：`.btn-start` / `.s2v-batch-trigger` 全部抬为 `.action-bar X`（0,2,0），不依赖样式表引入顺序 —— 跨文件同优先级「后来者胜」在 Vite 构建顺序变化时会飘移。

### 11.8 提示文字（zh / en 成对，CI Gate 7 硬拦截）

| key（前缀 `create.story2video.ui.`） | zh | en |
|--------------------------------------|----|----|
| `doubleResetHint` | 双击滑杆可恢复默认值 | Double-click the slider to restore the default |
| `sectionDefaultSuffix` | （默认） | ` (default)`（前导空格） |
| `estimatePlaceholder` | 填写文案后自动预估分镜数、旁白时长与成本 | Scene count, narration duration and cost are estimated once you enter the text |
| `charLimitWarning` | 接近字数上限 | Close to the character limit |
| `charLimitReached` | （已达字数上限） | ` (character limit reached)`（前导空格） |
| `flowGuide` | 配置好参数后点击「启动流水线」，各阶段将自动串联执行，无需逐步确认。 | Once configured, clicking Start Pipeline runs all stages automatically — no step-by-step confirmation needed. |
| `voiceSpeedLabel` / `voiceVolumeLabel` | 旁白语速 / 旁白音量 | Narration speed / Narration volume |
| `bgmVolumeLabel` | 背景音乐音量 | Background music volume |
| `videoFixedRatioLabel` / `videoMinRatioLabel` / `videoMaxRatioLabel` | AI 视频占比（前段）/ AI 视频占比下限 / AI 视频占比上限 | AI video share (opening) / Minimum AI video share / Maximum AI video share |
| `blockedReason.noText` | 请先输入视频文案 | Enter the script text first |
| `blockedReason.noPipeline` | 请先选择一条流水线 | Select a pipeline first |
| `blockedReason.noAsset` | 请先添加素材文件 | Add the required material first |
| `blockedReason.unavailable` | 该流水线尚未实现执行引擎，暂不能启动 | This pipeline has no execution engine yet |
| `blockedReason.starting` | 启动请求处理中，请稍候 | Start request is in flight, please wait |
| `blockedReason.running` | 已有流水线任务在运行中 | A pipeline run is already active |
| `blockedReason.invalidRange` | 部分数值参数超出允许范围，请检查语速、音量与分镜长度 | Some numeric options are out of range; check speed, volume and scene length |

- 阻塞原因按上表顺序取**首条命中**，与 `canStartPipeline` 判定同源，不允许出现「禁用但无原因」或「原因与实际阻塞项不符」。
- 术语对齐 `01-docs/i18n-glossary.md`（流水线 / 阶段 / 旁白 / 分镜 沿用既有译法，未另起）。
- `flowGuide` 取代原硬编码不通顺句；渲染层 `src/`（非 locales）**未新增任何中文字面量**（`--cjk` 扫描 0 新增命中）。

### 11.9 暗色模式与降级合同（本批次实测发现的双轨缺陷）

`tokens.css` 的 `[data-theme="dark"]` 只重定义 31 个槽，**未覆盖** `--color-text-strong` / `--color-text-primary` / `--color-text-secondary` / `--color-text-muted` / `--color-primary-light` / `--color-bg-muted` / `--color-danger` / `--color-warning` / `--color-error`；而 `cohere-design-system.css` 的暗色块提供**暗色感知别名层**：`--ink`（暗 `#e8e8ed`）、`--muted`（`#88889a`）、`--hairline`、`--surface`、`--action-blue/--focus-blue`、`--on-primary`。

**合同**：

1. **文字色一律走别名 + 保留 `--color-*` 作 fallback** —— `var(--ink, var(--color-text-strong))` / `var(--muted, var(--color-text-secondary))`。浅色下 `--ink → --color-text-primary`，与 `--color-text-strong` 同族，**零视觉回归**；暗色下才提亮。
2. 未定义槽（`--color-text` / `--color-bg-muted`）会导致 invalid-at-computed-value（整条声明失效）→ 必须改为已存在槽：`--color-bg-muted` → `var(--color-bg-inset, #f6f6f8)`。
3. `.input-tab.active` 的浅底 `--color-primary-light` 无暗色覆盖 → 就地补 `[data-theme="dark"] .input-tab.active { background: color-mix(in srgb, var(--color-primary-dark-tint) 18%, transparent); border-color: var(--color-primary-dark-tint) }` + `:focus-visible { outline-color }`，**不改全局令牌**。
4. `.s2v-btn-secondary` / `.s2v-btn-ghost` / `.s2v-btn-resume` 的文字与描边在暗色分支单独指定（实测修复：`--text` 暗色下为近黑 `#1a1a1e`，落在 `#232329` 卡片上不可读 → 改 `--ink`/`--muted`/`--color-primary-dark-tint(#7b74ff)`）。浅色分支不写覆盖 → 基线零影响。
5. **不得用改全局令牌的方式修暗色**：`--color-text-*` 缺暗色槽是设计系统级债务，登记在 `ui-apple-token-retirement`；本批次只做消费点收敛，避免全站视觉回归。
6. 审计工具：`.agent_context` 内 `_audit_dark.js` 比对 `tokens.css` 暗色槽集合与改动文件消费的 `--color-*`，输出未覆盖清单（暗色核对从「肉眼找」变「脚本清单」）。

`prefers-reduced-motion` 降级汇总：`.s2v-card:hover` 取消位移与阴影、`.s2v-cta-shimmer::after` 停动画并隐藏、`.s2v-config-section` 入场动画关闭、`UiSlider` thumb hover 缩放关闭、`.s2v-btn-*` 取消 `transform` 与 `transition`（保留色彩反馈）。

### 11.10 a11y 合同

| 元素 | 要求 |
|------|------|
| 输入页签 | `role="tablist"` + 每项 `role="tab"` + `:aria-selected`；键盘可切换 |
| 滑杆 | 原生 `<input type="range">`（自带 slider 语义）；无可见 label 时必须 `:aria-label`（三个占比滑杆即此情形）；`:focus-visible` outline |
| 字段错误 | `aria-invalid="true"` + `role="alert"` 文案 |
| 启动阻塞 | `:disabled` + `:title` + `:aria-describedby` 指向常驻提示节点 |
| 状态类提示 | 预估槽 / 阻塞原因 / 音色克隆状态均 `role="status"`（字符计数达上限时亦为 `aria-live="polite"`） |
| 折叠面板 | 原生 `<details>`（Enter/Space 可切换，无需自研键盘处理） |
| 视图切换 | `.view-tab:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px }` |

### 11.11 实现偏离登记（与批准计划的字段级差异，均已核验必要）

| # | 计划原文 | 实现终态 | 为什么 |
|---|---------|---------|--------|
| D1 | `provide` 一个含 `getConfig/setValue/…` 的 `s2vPanel` 访问器 | 抽取为**同名标识符投影 + 同一响应式对象引用**，不引入 `setValue(path, value)` | `s2vConfig` 的写点已是 `v-model` 直绑；加一层 path setter 需 40+ 代理声明且破坏引用稳定性（11.5 第 5 条）。deep watcher 与保存节流行为逐字节不变 |
| D2 | `UiField` 错误位「预留固定 18px 行高」 | 默认不预留，`reserveError` 显式开启 | 详情页仅 1 处真用错误态，无条件预留会给 27 个字段各加 18px 空洞，反而制造散乱 |
| D3 | 旁白音量「值后缀 `%`」 | 保持无后缀，小数位由 `step` 推导 | 该字段是 0–2 线性增益（默认 1），标 `%` 是错误语义；改动会误导用户 |
| D4 | 折叠态「新增 `s2vOpenSections` 字段并入保存 payload」 | 走既有 `ui.expandedGroups` 通道（已覆盖 6 个分组） | 已核验持久化通道存在且语义等价；新增字段 = 双源真相 |
| D5 | `view-tabs` → `grid repeat(4, minmax(0,1fr))` | `flex: 1 1 0` 等分 | 实际只有 3 个页签，硬编码 4 列会留 1/4 空灰 —— 正是要修的问题本身 |
| D6 | 暗色「各一遍」基线 | 像素套件无暗色通道（基线无 dark 命名、runner 不切主题）→ 改为探针注入 `data-theme="dark"` + 截图与计算样式人工核对，并把「缺暗色槽」登记 backlog | 补暗色基线通道是测试基建的独立变更，不该混进本 PR |
| D7 | 视觉基线路径 `apps/desktop/src/tests/...` 与 `pnpm test:visual:update-baseline` | 真实路径 `apps/desktop/tests/...`；`UPDATE_BASELINE` 对已存在基线**不生效**（只在缺失时创建）→ 须先删后建 | 代码事实；已在 11.12 写进操作合同避免重踩 |
| D8 | 只改 action-bar 按钮 | 详情页子树 19 处双轨全部收敛（11.7） | 计划 D2 的原文是「详情页主/次/幽灵/危险操作统一」，只改 action-bar 属未做完 |

### 11.12 测试与门禁合同

- 单元：`UiSlider.test.js`（受控 `--pct`、步长、`PageUp/Down`、双击复位、disabled、归一化边界、suffix、reduced-motion）、`UiField.test.js`（optionKey 显隐、fail-open、`aria-invalid`、`reserveError`）、`S2vConfigPanels.test.js`、`UiSelect.test.js`、`story2video-ue-contract.test.js`、`CreateView.test.js` —— **6 文件 329 例全绿为硬门槛**。
- 像素：`run-pixel-tests.js` 新增 `create-story2video-detail`。该视图无路由可直达（`selectedPipeline` 是组件态），须经 `prepare` 交互钩子：**先点回「流水线创作」页签**（hash 导航不重载文档，前序 `create-history` 用例会把视图留在 history），再点选 `story2video-compose` 卡片，等 `.s2v-config-section` 渲染。
- 基线重生成两步式（`UPDATE_BASELINE` 不覆盖已有基线）：先删该视图 png，再 `PIXEL_ONLY=<视图名> UPDATE_BASELINE=1`。**禁止全量重生成** —— 会把无关环境差烘进基线抬高 CI 误报（本地实测 home/accounts/dashboard/collection 存在 1.23%~3.53% 漂移）。
- 阈值：CI GATE-7 用 `PIXEL_THRESHOLD=0.06`；本地默认 0.01 会产生假失败，验证时必须对齐 0.06。
- 本批次基线：新增 `create-story2video-detail.png`，重生成 `create-editor / create-pipeline / create-history / create-result` 四张（R1 列宽修复的连带影响），逐张肉眼核对；全量 18/18 通过。
- 门禁清单（全部 rc=0）：`check-vue-style-parse`、`check-color-literals`、`check-font-size-scale`、`check-frontend-consistency`、`check-locale-sync --pair-base/--keys/--cjk`、`verify-worktree-deps`、`check-debt-budget`（`filesOver500` 92 < 基线 93）。
- 禁止把 `MAX_FILE_LINES` 基线上调：抽取后 `CreateView.vue` 5657 行，只允许继续下降。

### 11.13 验收标准

1. 详情页列宽实测 1080px（1920 视口），右侧无死白；`.back-btn` 宽度为内容宽度而非通栏。
2. 详情页裸 `<select>` = 0、`UiSelect` = 23（渲染态）、`UiSlider` 配置项 = 7、`UiField` = 23；详情页**按钮与表单面**无 `--apple-*` / `UiButton` 双轨残留（弹窗域 `.gen-video-modal-content` / `.pipeline-progress-modal-content` 仍剩 2 处 `--apple-surface-primary` 背景引用，归 §11.7 边界与 backlog）。
3. 所有滑杆可拖动/键盘调值/双击复位；旁白试听读取当前值；达上限字符计数转 danger 且 `aria-live` 播报。
4. 启动按钮禁用时可见首条阻塞原因；预估槽无内容时不塌陷；折叠组摘要 + 「（默认）」后缀正确。
5. 暗色模式下标题 / label / select 文字 / 按钮文字全部可读（计算样式实测：`rgb(232,232,237)` on `rgb(35,35,41)`）。
6. `prefers-reduced-motion` 下无位移与循环动画。
7. §2.1.6 滚动合同不回退：详情页整体不出现整页滚动条，`.pipeline-detail-scroll` 内层独立滚动，`.action-bar` 固定底部。
8. 单元 329 例、像素 18/18、上述 9 项门禁全绿；locale zh/en 成对、无新增中文字面量。
