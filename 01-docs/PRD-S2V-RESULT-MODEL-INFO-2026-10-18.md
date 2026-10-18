# PRD — 视频创作·历史记录·任务详情页「模型信息」展示（s2v-result-model-info）

> **版本**: v1.0
> **日期**: 2026-10-18
> **状态**: 已实现
> **关联分支**: `s2v-result-model-info`
> **关联页面**: 视频创作 → 历史记录 → 任务详情页（视频任务编辑页），路由 `/create/result?project=<projectId>`；纯文件预览模式 `/create/result?path=<videoPath>`
> **关联代码**: `apps/desktop/src/views/ResultView.vue`、`apps/desktop/src/locales/create/{zh,en}.js`、`apps/desktop/electron/services/story2video-stages.js`、`apps/desktop/electron/services/story2video-project-service.js`

---

## 一、需求背景与问题定义

### 1.1 用户诉求

> 视频创作-历史记录页-任务详情页中，需要在视频预览下方的视频信息区（格式、位置），增加关于本视频生成时调用的相应模型信息，包括：文本模型、语音模型、图片模型、视频模型（如果使用了视频模型则显示，没有则不显示）。
>
> 显示的地方，可以放在"格式：MP4"的后面（同一行里。如果放得下不用折行的话）。

### 1.2 现状与缺口

任务详情页 `ResultView.vue` 的视频信息区当前只有两项：

```
格式: MP4
位置: C:\Users\...\video.mp4
```

用户无法从这个页面回答三个高频问题：

1. **这条视频的文案/提示词是哪个文本模型生成的？** —— 用于判断质量归因、排查"为什么这条效果差"。
2. **旁白、配图、视频片段分别走了哪家 provider / 哪个模型？** —— 用于对比不同 provider 的出图/出片质量，也是"额度用在哪"的可见性。
3. **这条视频到底用没用视频模型？** —— 视频增强模式（`videoMode=fixed/ai-judged`）下用户常忘记自己开过，成片里出现 AI 视频片段时会困惑来源。

### 1.3 数据源核实结论（本次实现的第一性依据）

需求能不能做，取决于**模型信息是否在任务创建时被固化到项目里**。本次对 `story2video-compose` 主链做了逐段核实，结论如下：

| 模型类别 | 计划消费的数据源 | 核实结论 | 处置 |
|---|---|---|---|
| **文本模型** | `run.context.optimize[i].model_used`（prompt-engine 返回，已存在于 run context） | ⚠️ **未透传到项目**：`story2video-stages.js` 的 `pairedScenes` 构造处（约 L3500）未携带 `promptOptimizationMeta`，`Story2VideoProjectService._persistComposeArtifacts`（L949）虽已定义 `promptOptimizationMeta` 白名单字段，但上游从不填值 | **本期补落盘**（见 §3.1） |
| **语音模型** | `project.options.voiceProvider` / `project.options.voiceModel` | ✅ 已固化（`_safeOptions` 白名单，`saveRun` → `_safeOptions(run.params, projectId)`） | 直接消费 |
| **图片模型** | `project.options.imageProvider` / `project.options.imageModel`；补充 `segments[].imageMeta.provider` / `.model`（provider 实际返回值） | ✅ 已固化 | 直接消费 |
| **视频模型** | `project.options.videoMode` / `videoProvider` / `videoModel`；补充 `segments[].videoMeta.provider` / `.model` | ✅ 已固化 | 直接消费 |

**关键判断**：文本模型是唯一没有现成落盘的字段。若不做落盘改造，本次需求只能显示 3/4 项，且"文本模型"会恒为空——那等于交付一个残缺功能。因此本期把「补文本模型落盘」纳入同一变更，作为需求成立的前置条件。

### 1.4 术语

| 术语 | 定义 |
|---|---|
| 文本模型 | 负责文案分句后的**图片提示词优化**（`optimize` 阶段）与**视频场景 AI 选择**（`select_video_scenes`，`videoMode=ai-judged`）的 LLM。本产品中该角色由 `prompt-engine`（PromptBridge / 8013）承载，其 `model_used` 即实际调用的文本模型标识 |
| 语音模型 | `generate_assets` 阶段逐段生成旁白的 TTS provider + model（`voiceProvider` / `voiceModel`） |
| 图片模型 | `generate_assets` 阶段逐场景生成配图的图片 provider + model（`imageProvider` / `imageModel`） |
| 视频模型 | 视频增强模式下生成 AI 视频片段的视频 provider + model（`videoProvider` / `videoModel`） |
| 模型信息条 | 本文新增的 UI 元素：视频信息区内、与「格式」同行的模型摘要文本 |
| 纯文件预览模式 | 无 `project` 对象、仅有 `path` query 的结果页入口（历史记录渲染卡片、快速结果【查看】等） |

---

## 二、目标与非目标

### 2.1 目标（P0）

| ID | 目标 |
|---|---|
| G-1 | 任务详情页视频信息区新增「模型信息」展示，覆盖文本模型、语音模型、图片模型、视频模型四类 |
| G-2 | 视频模型在未启用视频增强（`videoMode=off` 或空）时**整项不显示**，而非显示"未使用/无" |
| G-3 | 模型信息优先与「格式：MP4」同行展示；容器宽度不足时自动折行，不撑破布局、不横向溢出 |
| G-4 | 补齐 `optimize` 阶段 `model_used` 到 `segments[].promptOptimizationMeta` 的落盘链路，使文本模型对新任务可见 |
| G-5 | 老项目（缺 `promptOptimizationMeta`）不报错、不显示空壳文本模型项 |
| G-6 | 纯文件预览模式（无 `project`）下模型信息条整体不渲染，不留空行 |

### 2.2 非目标

- **不做**模型信息的点击交互（如"跳转到模型设置"、"切换模型重跑"）——那是独立需求。
- **不做**历史列表卡片（`CreateViewHistory.vue`）的模型展示，只做任务详情页。
- **不改** `CreateView` 创作页的模型选择 UI。
- **不做**视频模型在"用户开启增强但全部场景回退为图片"这种情况的额外文案说明（显示已配置的 provider/model 即足够，回退原因见分段卡片自身的降级提示）。
- **不引入**新的 IPC 通道；全部数据经既有 `story2video:get-project` 返回的项目对象读取。

---

## 三、功能逻辑详设

### 3.1 数据层：补文本模型落盘

#### 3.1.1 改动点一：`story2video-stages.js` — optimize entry 透传到 scene

`generate_assets` 阶段构造 `pairedScenes` 时，把 `optimize` 阶段该场景的 entry（含 `model_used` / `strategy_used` 等）挂到 scene 上，键名与 `story2video-project-service.js` 既有的 `promptOptimizationMeta` 白名单一致：

```js
// story2video-stages.js · generate_assets · pairedScenes 构造处
scenes.push({
  index: i,
  prompt: ...,
  text: ...,
  // 新增：把 optimize 阶段的模型元数据带到 scene，供项目落盘 promptOptimizationMeta
  promptOptimizationMeta: promptOptimizationMetaOf(i),
  ...
})
```

其中 `promptOptimizationMetaOf(i)` 从 `context.optimize` / `context.optimized_prompts`（数组或 `{ results }` 包装）取第 `i` 项，只输出**白名单字段**（与 `safePromptOptimizationMeta` 对齐）：

| 字段 | 来源 | 说明 |
|---|---|---|
| `strategy_used` | entry.strategy_used | `llm` / `template`；非二者不输出 |
| `key_source` | entry.key_source | `caller` / `none`；非二者不输出 |
| `cache_hit` | entry.cache_hit | 仅 boolean |
| `model_used` | entry.model_used | 非空字符串才输出；**这是文本模型的唯一权威来源** |
| `caller` | entry.caller | 非空字符串才输出 |
| `platform` | entry.platform | 非空字符串才输出 |
| `style` | entry.style | 非空字符串才输出 |

**不输出的字段**：`optimized_prompt`（已由 scene.prompt 承载）、`truncated`、`optimize_note`、`degraded`、`index`、`prompt`。这些是流水线内部状态，不属于"模型身份"，且 `safePromptOptimizationMeta` 本来就会丢弃它们——在上游就收窄，可避免把无用数据带进 run context。

**取值优先级**（与既有 `optimizedPrompts` 解析口径一致，避免两处漂移）：

```
context.optimize（数组）
  → context.optimized_prompts（数组）
    → context.optimize.results（数组）
      → null
```

**fail-open 语义**：`optimize` 结果缺失/越界/非对象时返回 `null`，**不抛错、不阻塞** `generate_assets`。模型信息是展示层增强，绝不能因为取不到 meta 就让整条流水线失败。同理，`strategy_used === 'template'`（限流降级）时 `model_used` 为 `'template'`——此时文本模型显示 `template`（模板策略），如实反映"这条没走 LLM"，**不粉饰为具体模型名**。

#### 3.1.2 改动点二：`story2video-project-service.js` — 无需改动（已就绪）

`_persistComposeArtifacts` L949 已有：

```js
promptOptimizationMeta: safePromptOptimizationMeta(segment.promptOptimizationMeta || fallbackSegment.promptOptimizationMeta),
```

`safePromptOptimizationMeta`（L123-134）已是白名单 + 长度上限（`model_used` ≤ 160 字符）实现。**上游一填值，落盘即通**，不需要改 service。

#### 3.1.3 兼容性

| 场景 | 表现 |
|---|---|
| 新任务（本期后创建） | `promptOptimizationMeta.model_used` 有值 → 显示文本模型 |
| 老任务（无 `promptOptimizationMeta`） | `safePromptOptimizationMeta` 返回 `null` → 前端不渲染文本模型项 |
| 用户手动点过「重新生成图片优化词」的任务 | `regenerateScenePrompt`（L1944）已写 `promptOptimizationMeta` → 显示文本模型（既有能力，无需改） |
| run-only 记录（`ensureProjectFromRun` 重建，`options: {}`） | 无 options、无 meta → 模型信息条整体不渲染 |
| optimize 降级为 template | `model_used='template'` → 显示「文本模型: template」 |

### 3.2 展示层：模型信息条

#### 3.2.1 显示位置

```
┌─────────────────────────────────────────────────────────────┐
│  [视频播放器]                                                │
├─────────────────────────────────────────────────────────────┤
│  完成时间共 2 分 5 秒 · 文件大小 3.0 M        （既有）        │
│  格式: MP4 · 文本模型: deepseek · 语音模型: speech-02-hd ·   │
│  图片模型: MiniMax Image · 视频模型: MiniMax Hailuo          │
│  位置: C:\Users\...\video.mp4                               │
└─────────────────────────────────────────────────────────────┘
```

**与「格式」同行的实现方式**：把「格式」与模型摘要放进同一个 `<p>`，用内联分隔符连接。这样做的好处是**天然同行**——浏览器在容器宽度不足时按需折行，不需要 JS 测量宽度，也不需要 CSS 媒体查询猜测断点。

该行由独立组件 `ResultModelInfoRow.vue` 承载；取值逻辑在同目录纯函数模块 `composables/useResultModelInfo.js`（无 Vue 依赖，可脱离挂载直接单测）。这样拆的理由见 §8.1（`ResultView.vue` 是 `check-max-lines` 零容差点名对象，宿主只留接线）：

```html
<!-- ResultModelInfoRow.vue -->
<p data-testid="video-format-models">
  <span data-testid="video-format">格式: {{ formatLabel }}</span><template v-if="modelSummaryText"> · </template><span v-if="modelSummaryText" data-testid="video-models">{{ modelSummaryText }}</span>
</p>
```

```js
// useResultModelInfo.js
resolveModelSummaryParts(project, segments, label) // => ['文本模型: deepseek', '语音模型: speech-02-hd', ...]
resolveModelSummaryText(project, segments, label)  // => '文本模型: deepseek · 语音模型: speech-02-hd'
```

#### 3.2.2 显示项与取值口径

模型摘要文本由四个可选项按固定顺序拼装：**文本模型 → 语音模型 → 图片模型 → 视频模型**。

| 显示项 | 取值口径（优先级从高到低） | 缺失时 |
|---|---|---|
| 文本模型 | ① `segments[].promptOptimizationMeta.model_used`（首个非空） | 整项不渲染 |
| 语音模型 | ① `project.options.voiceModel` ② `segments[].audioMeta.model` ③ `project.options.voiceProvider` | 整项不渲染 |
| 图片模型 | ① `segments[].imageMeta.model` ② `project.options.imageModel` ③ `project.options.imageProvider` | 整项不渲染 |
| 视频模型 | ① `segments[].videoMeta.model` ② `project.options.videoModel` ③ `project.options.videoProvider` | 整项不渲染 |

**取值口径说明（为什么这么排）**：

- **segments 的 meta 优先于 options**：`options` 是**用户在下拉里选的**（提交时的意图），`segments[].imageMeta.model` 是 **provider 实际返回的**（真实执行的模型）。两者在"provider 把 model 参数忽略/改写"或"多模态 provider 内部路由到别的模型"时会不一致，展示真实执行的更有诊断价值。
- **model 优先于 provider**：用户问的是"用了什么模型"，不是"接了哪家"。`provider` 只在 `model` 缺失时兜底（老项目、provider 未返回 model 的场景）。
- **视频模型的显隐门控**（见 §3.2.3）：即使 `videoProvider` 有值，`videoMode=off` 也不显示。

#### 3.2.3 视频模型显隐门控（需求的硬性条款）

> 如果使用了视频模型则显示，没有则不显示。

实现为**双重门控**，满足任一即不显示：

```js
// useResultModelInfo.js · resolveModelSummaryParts 内
const VIDEO_ENABLED_MODES = new Set(['fixed', 'ai-judged'])
const videoMode = cleanText(options.videoMode).toLowerCase()
if (VIDEO_ENABLED_MODES.has(videoMode)) {
  const videoModel = resolveModel('videoMeta', 'videoModel', 'videoProvider')
  if (videoModel) parts.push(label('videoModel') + ': ' + videoModel)
}
```

| `videoMode` | 表现 |
|---|---|
| `'off'` / `''` / `undefined` | 不显示视频模型项（未启用视频增强） |
| `'fixed'` / `'ai-judged'` | 显示（取 videoModel → videoProvider） |

**为什么门控 `videoMode` 而不是只看 `videoProvider` 有没有值**：`story2video-text-config.js` 的 `videoConfig` 会把 `provider` 归一为 `''` 当未选，但**兼容旧扁平参数**路径（`params.videoProvider`）与「用户曾选过 provider 后又把 mode 切回 off」都会留下非空 `videoProvider`。只按 provider 有无判断会把"没启用"误显示成"启用了"。`videoMode` 才是用户意图的权威字段（与 `pipeline-model-preflight.js` 的 `video` 能力需求判定同源：`off` 或其他模式不要求视频模型）。

**反向边界**：`videoMode='fixed'` 但 `videoProvider`/`videoModel` 都为空（配置了模式但没选 provider，主进程会 fail-closed 阻断启动）——此时显示空壳。实现上取值为空串时同样不渲染该项，不留「视频模型: 」这种残缺文本。

#### 3.2.4 格式化规则

| 规则 | 说明 |
|---|---|
| 分隔符 | 各项之间用 ` · `（空格-间隔号-空格）连接；「格式」与第一项之间同样用 ` · ` |
| 顺序固定 | 文本模型 → 语音模型 → 图片模型 → 视频模型。顺序固定保证同类视频的信息位置一致，便于扫读 |
| 全空时不渲染分隔符 | 四项全空时 `modelSummaryText === ''`，模板用 `v-if` 不输出 ` · `，页面只剩「格式: MP4」，与改动前完全一致（零视觉回归） |
| 不做长度截断 | provider/model 名通常 < 40 字符；超长由 `.video-info` 的 `overflow-wrap` 与容器自然折行处理 |
| 不做 HTML 转义说明 | Vue 模板插值自动转义，provider/model 中的特殊字符不会注入 |

#### 3.2.5 交互逻辑

| 交互 | 行为 |
|---|---|
| 静态展示 | 无点击、无 hover、无 tooltip。模型信息是只读事实陈述 |
| 数据加载 | 随 `loadProject()` 一次性就绪；项目对象变化时 computed 自动重算 |
| 素材重生成后 | 用户点【重新生成图片】/【生成AI视频】等按钮后 `this.project = result.data`，computed 重算 → 模型信息实时更新（例如图片 provider 被主进程按当前设置改解析，展示值跟随实际结果） |
| 加载态/空态 | `loading` 时整页 skeleton，不渲染模型信息条；无 `videoPath` 时视频信息区整体不渲染（既有逻辑） |

---

## 四、数据校验

### 4.1 输入校验（前端读取项目对象时）

项目对象来自 IPC `story2video:get-project`，主进程已做白名单与长度校验（`safeAssetMeta` / `safePromptOptimizationMeta`）。前端仍需防御性处理，因为：

1. **IPC 边界不保证 schema**：老版本主进程写的项目、测试夹具、跨版本兼容都可能缺字段。
2. **`ensureProjectFromRun` 重建的项目 `options: {}`**：字段直接不存在。

| 字段路径 | 校验规则 |
|---|---|
| `project` | 非空对象才进入解析；`null`/`undefined`/非对象 → 返回全空摘要 |
| `project.options` | 非对象 → 当 `{}` 处理 |
| `project.options.videoMode` | `String(...).trim().toLowerCase()`，仅 `'fixed'` / `'ai-judged'` 视为启用 |
| `project.options.*Model` / `*Provider` | 非字符串或空串 → 视为缺失；`.trim()` 后使用 |
| `segments` | 非数组 → 当 `[]` 处理 |
| `segments[i].imageMeta` / `.audioMeta` / `.videoMeta` | 非对象 → 当 `null`（与 `safeAssetMeta` 的返回契约一致） |
| `segments[i].promptOptimizationMeta.model_used` | 非字符串或空串 → 视为缺失 |

### 4.2 输出校验（`modelSummaryText`）

| 场景 | 期望输出 |
|---|---|
| 四项全空 | `''`（空串） |
| 仅图片模型 | `'图片模型: MiniMax Image'` |
| 文本 + 语音 | `'文本模型: deepseek · 语音模型: speech-02-hd'` |
| 全四项 | `'文本模型: deepseek · 语音模型: speech-02-hd · 图片模型: MiniMax Image · 视频模型: MiniMax Hailuo'` |

**断言要点**：摘要内**不得**出现连续分隔符（`·  ·`）、**不得**以分隔符开头或结尾、**不得**出现空标签（如「文本模型: 」后无值）。

---

## 五、提示文字与文案（i18n）

### 5.1 文案清单

新增键全部挂在既有 `create.story2video` 命名空间下（避免新建命名空间触发额外同步面），zh/en 成对维护（CI Gate 7 `check-locale-sync.js --pair` 硬拦截）。

| 键 | 中文 | 英文 |
|---|---|---|
| `create.story2video.modelInfo.textModel` | `文本模型` | `Text model` |
| `create.story2video.modelInfo.voiceModel` | `语音模型` | `Voice model` |
| `create.story2video.modelInfo.imageModel` | `图片模型` | `Image model` |
| `create.story2video.modelInfo.videoModel` | `视频模型` | `Video model` |
| `create.story2video.modelInfo.format` | `格式` | `Format` |

最后一项 `format` 是**顺带收口**：原 `ResultView.vue` 里的「格式: 」是硬编码（在 CJK 基线内、历来如此），抽成 `ResultModelInfoRow.vue` 后按文件匹配的 CJK 基线会失配 ⇒ Gate 7 `--cjk` 报「新增 1 处硬编码」。一并收口到 locale 既符合「用户可见文案必须走 locale」的规则，也避免为它去改基线。

**分隔符** ` · ` 为标点，不属于可本地化文案，硬编码在模板/computed 中（同 `completionSummary` 的既有做法）。

### 5.2 命名空间选择的理由

`create.story2video` 是 `ResultView` 已在用的命名空间（`story2video.view_script`、`create.story2video.pause`、`create.story2video.backToHistory`）。新增 `modelInfo` 子对象与既有的 `ui` / `sceneMaterial` 子对象并列，不破坏现有键路径。

---

## 六、验收标准

### 6.1 功能验收

| # | 场景 | 期望 |
|---|---|---|
| A-1 | 完成态 story2video 项目，四项模型齐备 | 视频信息区显示「格式: MP4 · 文本模型: X · 语音模型: Y · 图片模型: Z · 视频模型: W」 |
| A-2 | `videoMode='off'` 的项目 | 不显示「视频模型」项，其余三项正常 |
| A-3 | 纯图片轮播任务（老项目，无 `promptOptimizationMeta`） | 不显示「文本模型」项，其余正常；不报错 |
| A-4 | 纯文件预览模式（`/create/result?path=...`，无 project） | 视频信息区只有「格式」「位置」两行，无模型信息 |
| A-5 | 窗口宽度收窄至模型信息放不下 | 模型信息自然折行，不横向溢出、不遮挡其他元素 |
| A-6 | 点【重新生成图片】后 provider 改变 | 模型信息中的图片模型值随之更新 |
| A-7 | 四项全空 | 页面与改动前逐字节一致（只有「格式: MP4」） |

### 6.2 回归验收

| # | 场景 | 期望 |
|---|---|---|
| R-1 | `ResultView.test.js` 既有用例 | 全部通过，无因本次改动失败 |
| R-2 | `story2video-stages.test.js` / `story2video-project-service.test.js` | 全部通过；透传用例在新建的 `story2video-prompt-meta.test.js` |
| R-3 | `element-plus.test.js` 产物契约锁 | 通过（本次不新增 element-plus 组件） |
| R-4 | locales 同步门禁（Gate 7） | zh/en 键集合完全一致；`--cjk` 无新增硬编码（「格式」标签一并 locale 化） |
| R-5 | 视觉回归（create-result 视图） | 差异来自模型信息新增文本本身；布局无位移、无溢出 |
| R-6 | `check-max-lines` 逐文件行数门禁 | 四个点名/挂账文件（`ResultView.vue` 1890、`story2video-stages.js` 4006、两个测试文件登记值）全部回到目标内，无 `TARGET_GREW` / `TEST_LEDGER_GREW`；`locales/create/en.js` 不得顶到 500 行上限 |
| R-7 | `pnpm run build:vue`（Vite/Rollup 构建） | 构建成功。**这条必须有本地实跑记录**：renderer 侧新模块若误用 CJS `module.exports`，Vitest 因互操作会全绿而 Rollup 直接失败（本次实测），单测绿不构成构建通过 |
| R-8 | `check-doc-abs-paths` 文档绝对路径门禁 | 无新增本机绝对路径；`.ccg/reviews/` 下评审失败记录（含 wrapper 本机路径）不得进 PR |
| R-9 | 组件在无 i18n 上下文可渲染 | `ResultModelInfoRow` 对 `$t` 做 `typeof === 'function'` 防御（与 `ResultView.tOrKey` 同口径）。既有 3 个 `ResultView.test.js` 用例直接 mount 不注入 `$t`，组件若裸调 `this.$t` 会抛 `this.$t is not a function` 连带 9 个 error |

---

## 七、测试计划

### 7.1 单元测试（`ResultView.model-info.test.js`，新建）

| 用例 | 断言 |
|---|---|
| 四项齐备时渲染顺序与内容 | `resolveModelSummaryText` 等于 `文本模型: deepseek · 语音模型: speech-02-hd · 图片模型: MiniMax Image · 视频模型: MiniMax Hailuo` |
| `videoMode='off'` 不渲染视频模型 | 文本不含「视频模型」 |
| `videoMode` 缺省不渲染视频模型 | 文本不含「视频模型」 |
| `videoMode='fixed'` 渲染视频模型 | 文本含「视频模型: MiniMax Hailuo」 |
| `videoMode` 大写/带空白归一 | `'  AI-Judged '` 同样视为启用 |
| `videoMode` 启用但 provider/model 空 | 文本不含「视频模型」，且无「视频模型:」空壳 |
| 无 `promptOptimizationMeta` 不渲染文本模型 | 文本不含「文本模型」 |
| segments meta 优先于 options | options `imageModel: 'opt-model'`、segments `imageMeta.model: 'seg-model'` → 显示 `seg-model` |
| segments 的 provider 优先于 options 的 model | 显示 segments 的 provider |
| model 缺失时回退 provider | 仅 `imageProvider: 'p'` → 显示 `p` |
| 逐段扫描取首个非空 | 第一段空、第二段有值 → 取第二段 |
| `model_used='template'` 如实呈现 | 显示「文本模型: template」 |
| 无 project（纯文件模式） | 摘要为 `''`，parts 为 `[]` |
| 四项全空 | 摘要为 `''` |
| `segments` 非数组 | 不崩溃；options 的值仍生效（按 `[]` 处理，不是作废 options） |
| `project.options` 非对象 | 不崩溃且摘要为空 |
| segments 含非对象项 | 安全跳过 |
| 摘要不变量 | 不含连续分隔符、不以分隔符开头/结尾、无「标签: 」空值 |
| `VIDEO_ENABLED_MODES` 集合 | 恰为 `['ai-judged', 'fixed']` |
| DOM：与「格式」同一个 `<p>` | `video-format-models` 内同时含 `video-format` 与 `video-models`，tagName 为 `P` |
| DOM：四项全空 | `video-models` 不存在，`video-format-models` 文本恰为「格式: MP4」 |
| DOM：项目对象更新 | computed 重算，展示值跟随 |
| locale 成对 | zh/en 的 `create.story2video.modelInfo` 四键齐备且非空 |

### 7.2 主进程测试（`story2video-prompt-meta.test.js`，新建）

| 用例 | 断言 |
|---|---|
| 白名单与 service 侧对齐 | `PROMPT_OPTIMIZATION_META_KEYS` 恰为 7 个约定字段 |
| 白名单收窄 | `optimized_prompt`/`truncated`/`optimize_note`/`degraded`/`index` 不透传；字符串 trim、boolean 原样 |
| 畸形 entry | `null`/`undefined`/字符串/数字/数组 → `null` |
| 全空白字段 | 返回 `null`（不留空对象） |
| 越界/非法下标 | `promptOptimizationMetaOf` 对越界、负值、小数、非数组均返回 `null` |
| template 降级 | `model_used='template'` 如实保留，`tokens_used` 被白名单丢弃 |
| `optimizeItemPrompt` | 字符串原样；`prompt → optimized_prompt → optimized` 优先级；`null`/数组/数字 → `''` |
| 集成：meta 透传到 scene | `generate_assets` 输出 `scenes[0].promptOptimizationMeta` 等于 optimize entry 的 7 字段 |
| 集成：内部状态不透传 | 只含 `model_used`/`strategy_used` |
| 集成：纯字符串 optimize | meta 为 `null`，阶段成功 |
| 集成：null 项 fail-open | 阶段成功，`optimizedPrompts[0].prompt === ''`（两处 null 防御的回归锁） |
| 集成：template 降级透传 | `model_used='template'` |
| 集成：`{ results }` 包装 | 正确取到第 i 项 |
| 集成：多场景 | 逐场景各取自己的 meta |

### 7.3 端到端验证（手动，记录于 `.quality-gates.md` / `openspec/records/`）

启动应用 → 视频创作 → 历史记录 → 打开一个 completed 任务 → 核对视频信息区四项显示与实际模型设置一致；再打开一个 `videoMode=off` 的老任务 → 核对无视频模型项。

---

## 八、影响面与风险

### 8.1 影响文件

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/views/ResultView.vue` | 模板（视频信息区改用 `ResultModelInfoRow` 组件）+ 1 行 import + 1 行 components |
| `apps/desktop/src/views/video-creation/ResultModelInfoRow.vue` | **新建**：「格式 + 模型」同一行的渲染组件 |
| `apps/desktop/src/views/video-creation/composables/useResultModelInfo.js` | **新建**：模型信息取值口径纯函数（无 Vue 依赖，可独立测） |
| `apps/desktop/src/locales/create/zh.js` | 新增 `story2video.modelInfo` 四项 |
| `apps/desktop/src/locales/create/en.js` | 同上（成对） |
| `apps/desktop/electron/services/story2video-stages.js` | `pairedScenes` 挂 `promptOptimizationMeta`；两处 optimize 项解析改用共享 `optimizeItemPrompt` |
| `apps/desktop/electron/services/story2video-prompt-meta.js` | **新建**：optimize 模型元数据白名单提取（含 `optimizeItemPrompt` null 防御） |
| `apps/desktop/src/views/ResultView.test.js` | 无改动（模型信息用例迁出） |
| `apps/desktop/src/views/ResultView.model-info.test.js` | **新建**：模型信息 UI + locale 成对 24 例 |
| `apps/desktop/electron/services/story2video-stages.test.js` | 无改动（透传用例迁出） |
| `apps/desktop/electron/services/story2video-prompt-meta.test.js` | **新建**：白名单/fail-open/null 防御 + 集成透传 17 例 |

**为什么拆成新文件而不是就地加**：`ResultView.vue`（点名目标 1890）与 `story2video-stages.js`（点名目标 4006）都是 `check-max-lines` 的**零容差**点名还账对象，两个测试文件也各有 200 行容差上限。就地新增会把 4 个文件同时判红。按仓内同族先例（`podcast-publish-entry` / `publish-add-account-entry` 等）的口径，正解是**结构性拆分**：逻辑主体进纯函数/组件模块，宿主只留接线；测试按"被测模块/场景"分文件。拆完四个点名/挂账文件全部回到目标内，且逻辑因脱离 Vue 挂载而更易测。

**模块格式约定**：`src/` 下的新模块一律用 ESM `export`/`import`（`useResultModelInfo.js`）；`electron/**` 下的保持 CJS `require`（`story2video-prompt-meta.js`）。两侧不得混用——Vitest 有 CJS/ESM 互操作所以单测会全绿，Rollup 没有，构建期才炸（本次实测，见 §6.2 R-7）。

### 8.2 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 模型信息过长导致视频信息区折行、挤压下方内容 | 低（纯展示） | 同行展示 + 自然折行；不设固定高度；视觉回归核对 |
| `promptOptimizationMeta` 透传引入 run context 体积增长 | 低（每场景 ~100 字节白名单字段） | 上游即收窄为白名单；`safePromptOptimizationMeta` 再有长度上限 |
| optimize 阶段未来改字段名导致 meta 取空 | 中（展示缺失，不崩） | 取值 fail-open；缺失即不渲染，不抛错 |
| 老项目无 meta 被误判为"功能坏了" | 中 | PRD/CHANGELOG 明确"老项目不显示文本模型"是有意行为；A-3 用例锁定 |
| 视觉基线因新增文本被判红 | 中 | 差异应仅来自新增文本；跑 `--single` 单独验证 create-result 视图并核对差异区域 |

---

## 九、与其他需求的关系

| 需求 | 关系 |
|---|---|
| 「查看文案」弹窗（`PRD-STORY2VIDEO-HISTORY-VIEW-SCRIPT-2026-09-13.md`） | 无交集；本需求只动视频信息区，不碰弹窗 |
| 素材多选（`story2video-history-material-selection` spec） | 无交集；本需求只读既有 meta 字段，不改素材选择逻辑 |
| 「从断点继续」当前模型解析（`ARCH-STORY2VIDEO-RESUME-CURRENT-MODELS-2026-08-19.md`） | **互补**：该需求规定"恢复时用当前设置重新解析 provider"；本需求展示的是**本次任务实际执行的**模型。两者语义不同但都服务于"模型可见性" |
| 历史状态标签 / 只读详情（`story2video-history-browsing` spec） | 无交集 |

---

## 十、变更记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-10-18 | v1.0 | 初版：需求背景、数据源核实结论、展示层详设、验收标准、测试计划 |
