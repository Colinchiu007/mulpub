# Design — hot-topics-pipeline-picker

## 1. 问题与约束

| 约束 | 影响 |
| --- | --- |
| 流水线清单的唯一真源是主进程 `pipelineList`（`PipelineEngine.listPipelines()`），前端不得另造枚举 | 下拉数据源必须走 IPC；本地只做「可执行性分类」的展示层映射 |
| 媒体型流水线（talking-head / cinematic / clip-factory / localization-dub / podcast-repurpose）的 stage 执行器要求 `params.video` 或音频素材 | 从「热门选题」只有一段改写文本，放开它们必然启动失败 ⇒ 必须禁用并解释原因 |
| `story2video-compose` 与其它文本驱动流水线的启动参数不同 | 启动参数按流水线类型分支，且把分支逻辑做成可单测的纯函数 |
| 弹窗阶段固定写死 8 阶段会与非 S2V 流水线的真实阶段错位 | 阶段列表、总进度、终态合并、失败阶段标注全部改为动态 |
| 行内按钮区在 flex 行中，列表可能很长 | 下拉浮层必须绝对定位、可点外关闭、一次只开一个，且不改变行高（避免列表跳动） |
| 现有 `HotTopics.vue` 已 832 行，逼近 1000 行债务阈值 | 选择器 UI 独立成组件、目录逻辑独立成纯函数模块，`HotTopics.vue` 只增加极少模板与状态 |
| 前端已按需注册 Element Plus 组件（`plugins/element-plus.js` 机械锁） | 不新增 `el-dropdown`/`el-popover`：自建轻量菜单，零新增组件注册与样式导入 |
| 现有 `extractOrchestrationVideoPath` 已覆盖 publish/compose/export/render/report | 抽成共享纯函数，`CreateView` 委托调用，热门选题复用，避免两份口径漂移 |

## 2. 备选方案对比

### 方案 A：复用视频创作页的流水线卡片/弹窗选择

- 做法：点击下箭头后跳 `/create` 或弹一个流水线卡片弹窗，选完再回来。
- 拒绝原因：多一次路由/弹窗层级；仍要用户手动确认文案；与「点击某一个流水线后开始生成视频流程」的目标相反（用户要的是一步到位）。热门选题已有的改写产物不应丢失。

### 方案 B：原生 `<select>`（或 UiSelect）直接放在行内

- 做法：把流水线名做成原生下拉，选中即生成。
- 拒绝原因：① 行内右侧按钮区空间很窄，原生 select 会把行撑高、破坏列表节奏；② 无法在选项内表达「默认/禁用原因」这类富信息；③ 用户明确要求「下箭头图标按钮 + 下拉选择层」的形态。保留为备选（若后续要求键盘原生行为可降级）。

### 方案 C（采用）：自建按钮组 + 轻量浮层菜单

- 主按钮保持原样（默认流水线），下箭头按钮打开绝对定位菜单；菜单项用原生 `<button role="menuitem">`，天然可聚焦/可禁用/可回车触发。
- 优点：零新依赖、零 Element Plus 注册、可完全控制禁用原因与默认徽标、可做外点/Esc/方向键、移动端/窄行不撑高。
- 代价：需自己实现焦点管理与外点监听（约 30 行），用组件级测试锁住。

## 3. 模块划分

```
features/hot-topics/gen-video-pipelines.js     纯函数：分类/排序/标签/启动参数/阶段名
features/pipeline/run-context-video-path.js     纯函数：run context → videoPath（CreateView + 热门选题共享）
components/HotTopicsGenVideoPicker.vue          按钮组 + 下拉菜单（唯一 UI 实现，热门/收藏复用）
composables/useHotTopicsGenVideo.js             编排：动态阶段、按流水线启动、终态提取
views/HotTopics.vue                             接入选择器、弹窗流水线标识、defineExpose
components/HotTopicsFavorites.vue               接入选择器（emit 带 pipelineName）
locales/hot-topics/{zh,en}.js                   zh/en 成对文案
```

### 3.1 纯函数契约（`gen-video-pipelines.js`）

```js
export const DEFAULT_GEN_VIDEO_PIPELINE = 'story2video-compose'
export const STORY2VIDEO_PIPELINE = 'story2video-compose'

// 运行模式：决定启动参数分支与禁用原因
export function getPipelineRunMode(name) -> 'story2video' | 'text-auto' | 'needs-media'
  | 'dedicated' | 'internal' | 'unavailable' | 'unsupported'

export function isPipelineRunnableFromTopic(name, available) -> boolean
export function getPipelineDisabledReasonKey(name, available) -> string|null  // i18n key
export function getPipelineStageNames(name) -> string[]                        // 流水线真实阶段
export function buildGenVideoPipelineOptions(rawList, t) -> Array<{name,label,categoryLabel,description,enabled,reasonKey,isDefault}>
export function buildGenVideoStartParams({ pipelineName, text, snapshot, uiLocale }) -> object
```

排序规则：可执行项按主进程返回顺序（`story2video-compose` 天然第一）→ 不可执行项按主进程返回顺序。`buildGenVideoPipelineOptions` 保持稳定排序（不使用不稳定 sort 语义，按 index 兜底）。

### 3.2 UI 组件契约（`HotTopicsGenVideoPicker.vue`）

Props：`topicId: String`、`busy: Boolean`、`favorite: Boolean`（决定 testid 前缀；热门 `hot-topic-generate-video-{id}`，收藏 `hot-topic-favorite-generate-video-{key}`）。
Emits：`generate`（点主按钮）、`pick`（选中流水线，参数 `pipelineName`）。
内部状态：`open`、`loading`、`error`、`options`、`loaded`；模块级 `activePickerTopicId` 保证全局只有一个面板打开；文档级 `pointerdown` 外点关闭；`onBeforeUnmount` 清理监听。

菜单渲染分支：
1. `loading` → 「正在加载流水线…」
2. `error` → 「流水线列表加载失败」+【重试】+ 回退项「故事讲述（默认）」（仍可 pick）
3. `options.length === 0` → 「暂无可用的视频创作流水线」
4. 正常列表：可执行项（含默认徽标）→ 不可执行项（disabled + 原因）

### 3.3 编排契约（`useHotTopicsGenVideo`）

| 变更点 | 规则 |
| --- | --- |
| `startGenerateVideo(topic, pipelineName = DEFAULT)` | 校验 `topic.topic` 非空；`pipelineName` 必须是 `isPipelineRunnableFromTopic` 为真，否则直接 return（UI 已禁用，方法内再校验一次） |
| `genVideoPipelineName` | 本次编排的流水线名；`resetGenVideoFrontendState` 清空；重试沿用 |
| `genVideoPipelineLabel` | 由 `getPipelineName(t, name)` 计算；弹窗显示「流水线：{label}」 |
| `initGenVideoStages` | `['rewrite_copy', ...getPipelineStageNames(pipelineName)]`；空阶段兜底 `['rewrite_copy','compose']` |
| 阶段推进 | 启动前把第一个非 rewrite 阶段置 `running`；启动失败把它置 `failed`（不再写死 `split`） |
| `buildGenVideoStartParams` | `story2video-compose`：完整 `story2videoTextConfig`；text-auto：`text/inputMode/checkpointPolicy/autoAdvance/background/uiLocale/storyboardMode/style/resolution/aspectRatio/fps/format`（分辨率等来自 `resolveS2VConfigsFromSnapshot(snapshot).s2vOutputConfig`） |
| 总进度 | 分母 = `genVideoStages.length`（含 rewrite_copy），不再用常量 8 |
| 终态成片 | `extractRunContextVideoPath(context)`；无成片仍置 failed 保持两个出口灰显 |
| run-only 发布 | `story2videoProject` 缺失时【去发布】只带 `type=video` + `video_path`（既有语义，新增测试锚定） |

### 3.4 成片提取共享（`run-context-video-path.js`）

```js
export function extractRunContextVideoPath(context) {
  const publish = context?.publish?.data || context?.publish
  const compose = context?.compose?.data || context?.compose
  const exportOut = context?.export?.data || context?.export
  const render = context?.render?.data || context?.render
  const report = context?.report?.data || context?.report
  return publish?.videoPath || publish?.path || compose?.videoPath || compose?.path ||
    exportOut?.videoPath || exportOut?.path || render?.videoPath || render?.path ||
    report?.videoPath || report?.path || null
}
```

`CreateView.extractOrchestrationVideoPath(context)` 改为一行委托（行为逐字不变，既有测试继续覆盖）。这样非 S2V 流水线（documentary/animation/avatar/character/hybrid 的终态在 `render`、localization 在 `sync`）也能取到成片。

## 4. 数据校验与安全

1. `pipelineList()` 返回非 `{ code: 0, data: [...] }` 或 `data` 非数组 → 视为加载失败（回退默认项，不抛错）。
2. 列表条目缺 `name`/非字符串 → 丢弃；同 `name` 重复 → 去重保序。
3. `available` 非布尔值 → 按「需要进一步判定」处理：已知文本驱动项按可执行，其余按不可执行（fail-closed）。
4. 选择项点击前再校验 `enabled`（防 `trigger` 绕过 disabled）；`pick` 后再由编排层二次校验。
5. IPC 失败不阻断主按钮（主按钮不依赖流水线列表）。
6. 阶段名来自本地 `PIPELINE_REGISTRY`（与 `pipeline-labels.js` 单一来源）；未知流水线绝不进入可执行集合。
7. 不新增 IPC 参数、不改主进程；`pipelineList` 为只读调用。

## 5. 交互与可访问性

- 下箭头按钮：`aria-haspopup="menu"`、`aria-expanded`、`aria-label`/`title`；主按钮 `title` 说明默认流水线。
- 菜单：`role="menu"`，每项 `role="menuitem"`；打开后焦点到首个可执行项；`Esc` 关闭并回焦；`↑`/`↓` 在可执行项间循环；`Home`/`End` 到首/末项。
- 外点关闭：`document` 的 `pointerdown` 捕获，目标不在组件根内则关闭。
- 一次只开一个：模块级 `activePickerTopicId`；打开新的会关掉旧的。
- busy：`genVideoBusy === true` 时主按钮与下箭头同时 `disabled`，已打开的菜单强制关闭。
- 无闪烁行高：菜单 `position: absolute`，不参与 flex 布局。
- **空间自适应（2026-10-17 视觉取证后补，对应 §3.5）**：下方空间 < 理想高度（320px）+ 6px 时翻转到按钮上方；翻转后仍不足则压缩到可用高度（下限 160px，`overflow-y:auto`）。决策用纯函数 `computeGenVideoPickerPlacement` / `computeGenVideoPickerMenuSize`，避免在 jsdom 里无法验证的布局逻辑散落在组件内。
- **滚动即关闭**：捕获阶段监听 `window` scroll；面板绝对定位在行内，滚动后与按钮脱位或被滚动容器裁切。

## 6. 风险与回退

| 风险 | 回退策略 |
| --- | --- |
| 非 S2V 流水线参数与执行器预期不一致 | 参数完全对齐 `CreateView.startExplainerPipeline`；单测锁定关键字段；若某条实际启动失败，用户仍可在弹窗内【重试】或改用默认流水线 |
| 动态阶段名与推送阶段名不一致 | `mergeGenStages` 只合并同名阶段；终态时未完成阶段统一补 completed（既有逻辑） |
| 流水线列表接口变更 | 分类模块对未知名字 fail-closed 禁用，不崩溃；默认项兜底 |
| 组件引入后 HotTopics.vue 行数越界 | 组件独立、模板仅一行；提交前跑 `check-debt-budget.js` |
| 像素门禁未覆盖 hot-topics（既有盲区） | 用组件/集成测试 + 手动截图取证；记录中如实登记盲区，不伪称像素门禁已覆盖 |
| 面板被页面滚动容器裁切 | 翻转 + 按可用空间压缩（纯函数 + 组件测试）；滚动即关闭；视觉截图复核 |
