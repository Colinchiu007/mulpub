# PRD-S2V-RESULT-VIEW-PERF-2026-10-20

> **标题**：视频任务编辑页（ResultView）失败任务进入性能与占位优化
> **日期**：2026-10-20
> **分支**：`s2v-result-view-perf`（worktree `D:/Data/projects/mp-worktrees/mp-s2v-result-view-perf`，D 盘非 C 盘）
> **主 PRD 章节**：`01-docs/PRD.md` §7.1.40
> **用户现场**：历史记录页点击进入失败任务（项目 ID `mvfbqtio_3wwu`，169 段）的编辑页；截图显示视频预览区持续加载、未生成图片区先呈现「错误链接样式」、数秒后才显示「未生成」。

---

## 一、背景与问题定义

### 1.1 用户可观察的三个缺陷

| # | 现象（用户原话/截图） | 用户感知 |
| --- | --- | --- |
| P1 | 「刚进入页面时，视频预览区域一直加载的状态，加载了很久。因为没有生成成品视频，最后这个区域显示空白。」 | 页面卡住，不知道在等什么，最后什么都没有 |
| P2 | 「未生成的图片区域，在刚进入页面的时候，因为没有加载完，仍然显示出一张错误链接样式的图片样式，过了几秒刷新完，才显示出背景色和文字『未生成』。」 | 界面像坏了（破图），随后才恢复正常 |
| P3 | 「这个页面进入时非常慢，是不是因为分段太多的原因（169 段）。」 | 进页面要等很久 |

用户的三条明确诉求：

1. **没有生成成品视频时，应该从一开始就快速判断出来，不要再进行相应的视频加载。**
2. **视频预览区域是否设定了占位区块；布局是否应该预先处理，省得加载后有变化。**
3. **元素非常多的情况下，整体页面加载应如何优化体验（懒加载或其他技术方式）。**

### 1.2 根因（已核实到代码行）

三个缺陷是**同一条链路**的三个表现，不是三个独立 bug。

`ResultView.vue` 的 `loadProject()`（修复前 `1300-1345` 行）顺序执行：

```
story2videoGetProject(projectId)
  → this.loadVoiceCatalog()                      // 不 await，但会发 IPC
  → await this.refreshSegmentImageUrls()         // 全量 169 段
      → 每段 refreshSceneMaterialUrls() 申请 5 个媒体位 URL
        （image1 / image2 / video1 / video2 / audio）
  → await resolveLocalUrl(audioPath)             // 无条件（audioPath 为 null 时也走）
  → await resolveLocalUrl(videoPath)             // 无条件（videoPath 为 null 时也走）
  → finally { this.loading = false }
```

| 缺陷 | 直接根因 | 代码位置（修复前） |
| --- | --- | --- |
| P1 | `loading` 要等**全部分段素材 URL 解析完**才置 false；而失败任务 `videoPath` 为 null，`<video>` 因 `v-if="videoPath"` 根本不渲染 ⇒ 用户看到 loading 骨架挂很久，然后空白 | `ResultView.vue:1321` `await this.refreshSegmentImageUrls()` 全量；`:1330-1337` 无条件 `resolveLocalUrl` |
| P2 | `<img>` 无 `loading="lazy"`、无错误兜底。169 张图**同时**发起 HTTP 请求，未加载完时浏览器渲染破图占位 | `ResultView.vue:215` `<img v-if="segment.imageUrl" ...>` |
| P3 | 169 段 × 5 媒体位 ≈ **845 次 IPC**（`story2video:create-share-url`）全部串在 `await` 上，且每次 IPC 内部做 `realpathSync`/`lstatSync`/`statSync` 与令牌登记 | `ResultView.vue:952-1036` `refreshSegmentImageUrls` / `refreshSceneMaterialUrls` |

**量化**：169 段 ×（image1 + image2 + video1 + video2 + audio）≈ 845 次 IPC。即使每次 5ms，串行也要 ~4.2s；真实场景（含主进程文件系统校验）远高于此。

---

## 二、方案对比与取舍

### 2.1 三个候选

| 方案 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A. 只加占位区块 | 无 `videoPath` 时渲染占位，不动 IPC | 改动最小 | P3 完全没解决；845 次 IPC 仍阻塞 loading | ❌ 不完整 |
| B. 分批 + 占位 + 懒加载 | 见 §3 | 三个缺陷全修；纯函数策略可单测 | 需要抽组件（ResultView 是 max-lines 点名还账对象） | ✅ **采用** |
| C. 服务端批量签 URL | 新增 IPC 一次签 N 个路径 | 根治 IPC 次数 | 改 IPC 契约 + 主进程 + preload + 三层测试；影响面远超本 PR | ❌ 本轮不做，记入 §9 |

### 2.2 为什么必须抽组件

`ResultView.vue` 在 `.github/scripts/max-lines-baseline.json` 的 `targets` 里登记为 **1890 行、零增长容差**（`TARGET_GREW` 规则：超过点名目标即红）。本 PR 第一版把逻辑直接写进 ResultView，实测 **2062 行、超 172 行**，被门禁当场拦下。

因此采用分层：

```
composables/useResultPreviewMedia.js   ← 纯函数策略（可单测，无 Vue/DOM 依赖）
video-creation/ResultSegmentCard.vue   ← 单个分段卡片（174 行）
video-creation/ResultSegmentEditor.vue ← 分段编辑区（列表/窗口/哨兵，210 行）
views/ResultView.vue                   ← 宿主，只留 props/emits 接线（1741 行，低于 1890 目标）
```

抽组件后 ResultView 反而**下降 119 行**，从「还账对象」变成「有空间的普通文件」。

---

## 三、功能逻辑（详述）

### 3.1 预览区三态（核心修复）

`resolveSegmentMediaPlan({ project, segments })` 返回 `previewState`：

| 状态 | 判据 | 行为 |
| --- | --- | --- |
| `loading` | `project.videoPath` 非空 | 渲染 `<video>`；首屏只申请**成片一个** URL |
| `empty` | `project.videoPath` 为空 | 渲染**占位区块**；**不发起任何预览相关 IPC** |

宿主 `hasFinalVideo` = `Boolean(this.videoPath) || previewPlan.shouldLoadPreview`。

> **两条入口都要看**：`project.videoPath`（持久化项目模式）与 `this.videoPath`（纯文件预览模式，路由 `?path=`）。只判 project 会让文件预览模式退化成占位区块 —— 本轮被既有用例「loads video path and shows video player」等 5 条当场抓出。

同理 `shouldLoadNarration` 门控完整旁白的 URL 申请：无 `audioPath` 时不再走 `resolveLocalUrl`。

**关键语义变化**：无成片时**不再弹**「预览缺失」通知。那是「加载失败」，不是「没有成片」——旧实现把两者混为一谈，用户明明没有成片却收到错误提示。

### 3.2 分段素材 URL 分批

`SEGMENT_URL_BATCH_SIZE = 20`。

- 首屏只解析前 20 段的媒体 URL（≈100 次 IPC，相比 845 次降 **88%**）；
- 未进入渲染窗口的分段**不需要提前拿 URL**（它还没渲染，拿了也看不见）；
- 顺序稳定（不得重排）：分段编辑区依赖 `segments` 的 index 与 DOM 顺序，重排会让「上移/下移」与滚动高亮指向错位。

### 3.3 渲染窗口（追加式展开）

`resolveSegmentRenderWindow({ total, batch, renderedCount })`：

```
窗口 = [0, min(total, renderedCount + batch))
```

**必须是「追加式」而不是「滑窗式」**：窗口始终从 0 开始。滑窗会让已渲染段从 DOM 消失，导致滚动高亮、`segmentItemRefs`、政策徽标全部错位。本轮第一版写成滑窗（`from = renderedCount`），被自建哨兵用例当场抓出（`expected 20 to be greater than 20`）。

推进入口有两个，行为一致：

1. **哨兵**：列表尾 `div[ref=segmentListSentinel]` 进入视口（`rootMargin: 240px`）⇒ `IntersectionObserver` 触发；
2. **手动兜底按钮**：`data-testid="segment-load-more-button"`（无 `IntersectionObserver` 环境如 jsdom 时唯一入口）。

两者都只解析**新增那一批**的 URL，不重解析已渲染段。

### 3.4 focusScenes 点名段强制并入首屏

内容政策失败的任务从历史跳转时带 `focusScenes`（1-based 场景号，逗号分隔），用户进页面就是要改那几段。

`resolveFirstPaintSegments` 把点名段**并入首屏批次**（不占满 20 段配额时）：

| 输入 | 输出 |
| --- | --- |
| 80 段 + `{49,73,74,999}` | 首屏 = 前 20 段 + `seg-48` + `seg-72` + `seg-73`（999 越界忽略，无重复） |

**为什么必须**：若点名段落在窗口外，政策徽标与定位能力等于失效。本轮被既有用例「focusScenes 定位内容政策场景并渲染徽标，越界号码不渲染」**当场抓出**（80 段任务、场景 49/73/74 全部不在前 20 段 ⇒ `expected [] to have a length of 3`）。

### 3.5 图片懒加载与错误兜底

- 所有分段图/素材槽图加 `loading="lazy" decoding="async"`：未进入视口的图不发起请求（P2 的「同时 169 张」）；
- 保留 `@error` 兜底：URL 失效时清掉坏 URL + 标记该素材位不可用，**保留来源路径**（供重新生成/后续刷新恢复）；
- 空素材继续显示「未生成」占位（`.scene-material-empty-text` / `.segment-thumb` 的 `asset-placeholder`）。

### 3.6 占位区块与布局预分配

预览占位区块与 `<video>` **同构**：

| 属性 | `<video>` | 占位区块 |
| --- | --- | --- |
| 容器 | `.video-section` | `.video-section.video-section--placeholder` |
| 圆角 | `8px` | `8px` |
| 高度上限 | `max-height: 68vh` | `min-height: 240px; max-height: 68vh` |
| 底色 | `var(--ink)` | `var(--bg)` + 虚线边框 |

「加载出成片」与「本来就没有成片」两种终态的页面高度一致，不产生布局跳变。

---

## 四、数据校验

| 项 | 规则 | 失败行为 |
| --- | --- | --- |
| `project.videoPath` | 非空字符串才申请预览 URL | 空 ⇒ 占位区块，零 IPC |
| `project.audioPath` | 非空字符串才申请旁白 URL | 空 ⇒ 保留占位，零 IPC |
| 分批大小 | `Number.isInteger(batchSize) && batchSize > 0`，否则回落 20 | 非法值不抛错，走默认 |
| `renderedCount` | 非有限数或 ≤0 视为 0；上界收敛到 `total` | 越界不产生负长度窗口 |
| `total` | ≤0 时窗口为 `{from:0,to:0}` | 空数组不抛错 |
| `focusScenes` 场景号 | 仅十进制正整数；`0x10`/`1e2`/`007` 忽略；越界忽略 | 非法形式不渲染徽标（既有契约不变） |
| 分段媒体路径 | `imagePath`/`audioPath`/`videoPath`/`videoMeta.sceneVideoPath`/`videoMeta.altSceneVideoPath`/`altVideoPath`/`alternateImages[].path` 任一非空才申请 | 无路径 ⇒ 零 IPC |
| 槽位 `selectable` | 该槽位有可用路径才可选中 | 无路径的槽位按钮与 radio 均禁用，宿主不放行 IPC |

---

## 五、交互逻辑

### 5.1 进入页面（失败任务，无成片）

```
历史记录页点击「编辑并重新合成」
  → 路由 /create/result?project=mvfbqtio_3wwu
  → ResultView.mounted()
      ├─ loadProject()  [IPC #1：get-project]
      ├─ loadVoiceCatalog()（不阻塞首帧）
      ├─ refreshSegmentImageUrls(前 20 段)  [≈100 次 IPC，并行]
      ├─ 无 audioPath  ⇒ 不申请旁白 URL
      ├─ 无 videoPath  ⇒ 不申请成片 URL，渲染占位区块
      └─ loading = false
  → 用户看到：占位区块 + 前 20 段分段卡 + 「显示更多分段」按钮
```

### 5.2 滚动 / 点击展开更多分段

```
哨兵进入视口（或点击「显示更多分段」）
  → loadNextSegmentBatch()
      ├─ segmentRenderCount += 20（窗口 [0, renderCount+20)）
      ├─ refreshSegmentImageUrls(新增 20 段)  [≈100 次 IPC]
      └─ 批次完成后重新挂哨兵
  → 全部分段渲染完后哨兵与按钮消失
```

### 5.3 占位区块的「重新合成」

```
点击 data-testid="preview-placeholder-recompose"
  → recomposeProject()（与底部操作条的「重新合成」同一方法）
      ├─ segmentsDirty 时先保存分段
      ├─ story2videoRecomposeProject(projectId)
      ├─ 成功后 videoPath 有值 ⇒ 三态切到 loading ⇒ ready，渲染 <video>
      └─ 失败走通知归一化（额度/素材缺失等）
```

按钮禁用条件与底部操作条一致：`recomposing || anySegmentBusy`。

### 5.4 分段卡片内所有编辑动作

卡片是**纯展示 + emit**，不直接调 IPC：

| 交互 | emit | 宿主动作 |
| --- | --- | --- |
| 改文案/提示词/语音设置 | `dirty` | `segmentsDirty = true` |
| 改字幕 | `update-subtitle-blocks` | 覆盖 `subtitleBlocks` + 清空 `subtitleTimeline` + dirty |
| 上移/下移/删除 | `move-segment` / `remove-segment` | 重排 + 重置 refs + 重算滚动高亮 |
| 选素材 | `select-material` | 校验槽位 selectable ⇒ IPC ⇒ 刷新 URL |
| 生成新图/AI 视频 | `generate-image` / `generate-ai-video` | busy 态 + IPC + 刷新 |
| 重新生成字幕/提示词/旁白 | `regenerate-*` | 先落盘未保存编辑（W3 语义）⇒ IPC |
| 替换旁白 | `replace-audio` | 导入媒体 ⇒ IPC ⇒ 刷新 |
| 下载 | `download-artifact` | 主进程保存对话框 |
| 预览素材 | `preview-material` | 打开预览弹窗 |
| 素材 URL 失效 | `mark-material-unavailable` | 登记不可用位（保留来源路径） |
| 批次加载 | `load-next-batch` | 只解析该批 URL |

---

## 六、显示项与提示文字（zh/en 成对）

### 6.1 新增 locale 键

全部落在 `story2video.sceneMaterial`：

| 键 | zh | en |
| --- | --- | --- |
| `previewPlaceholderTitle` | 尚未生成成品视频 | Final video has not been generated yet |
| `previewPlaceholderDescription` | 当前任务没有可播放的成片，可先编辑分段内容，再重新合成。 | This task has no playable video yet. Edit the segments first, then recompose. |
| `loadMoreSegments` | 显示更多分段 | Show more segments |
| `loading` | 加载中... | Loading... |
| `segmentEditTitle` | 分段编辑 | Segment editor |
| `segmentCountSuffix` | 个分段 | segments |
| `promptTranslationLabelZh` | 中文翻译 | Chinese translation |
| `promptTranslationLabelOther` | 翻译 | Translation |
| `narrationTextLabel` | 旁白文字 | Narration text |
| `imagePromptLabel` | 画面提示词 | Image prompt |
| `replaceNarration` | 替换旁白 | Replace narration |
| `downloadImage` | 下载图片 | Download image |
| `downloadAudio` | 下载音频 | Download audio |
| `downloadVideo` | 下载视频 | Download video |

### 6.2 无成片时的预览区显示

```
┌─────────────────────────────────────────┐
│            （虚线边框区块）               │
│                                          │
│         尚未生成成品视频                  │
│   当前任务没有可播放的成片，可先编辑       │
│   分段内容，再重新合成。                  │
│                                          │
│         [ 重新合成 ]                     │  ← 仅 projectId + 可编辑内容时显示
└──────────────────────────────────────────┘
```

- 标题：`previewPlaceholderTitle`
- 说明：`previewPlaceholderDescription`
- 行动位：`recompose`（复用既有键「重新合成 / Recompose」）
- `projectId` 为空或无可编辑内容时**不显示**行动位（不可编辑也就无法重新合成）

### 6.3 分段区标题行

```
分段编辑
169 个分段 · 修改文案、字幕、语音或优化词后，点击「保存分段」，再点击「重新合成」生成新视频  [有未保存修改]
```

---

## 七、组件契约

### 7.1 `composables/useResultPreviewMedia.js`（纯函数）

| 导出 | 签名要点 | 用途 |
| --- | --- | --- |
| `PREVIEW_LOADING_STATES` | `{LOADING, EMPTY, READY}` | 三态枚举 |
| `SEGMENT_URL_BATCH_SIZE` / `SEGMENT_RENDER_STEP` | `20` | 批量与步长 |
| `shouldRequestSegmentMedia(segment)` | → boolean | 单段是否有媒体路径 |
| `splitSegmentBatches(segments, batchSize)` | → `{firstBatch, deferred}` | 纯分批 |
| `resolveFirstPaintSegments(segments, {policySceneNumbers, batchSize})` | → `{firstBatch, deferred}` | 分批 + 政策点名段强制入首屏 |
| `resolveSegmentRenderWindow({total, batch, renderedCount})` | → `{from, to}` | 追加式窗口 |
| `resolveSegmentMediaPlan({project, segments})` | → `{previewState, shouldLoadPreview, shouldLoadNarration, firstPaintMediaPaths, ...}` | 预览三态 + 首屏媒体路径 |
| `resolveResultPreviewLayout({segments, project, ownVideoPath, renderedCount, policySceneNumbers, batchSize})` | → `{visibleSegments, firstBatch, pendingBatch, hasFinalVideo, shouldLoadPreview, shouldLoadNarration, previewState, urlBatchCursor, renderWindow}` | 渲染层统一入口 |
| `resolveSceneMaterialSlots(segment, {label, unavailable})` | → 四槽位数组 | 宿主与卡片共用同一真源 |
| `effectiveSelectedMaterial(segment)` | → `'image1'\|'image2'\|'video'\|null` | 选中态归一 |
| `resolveSubtitleBlocksText(segment)` | → string | 字幕文本（不回退旧 timeline） |
| `parseSubtitleBlocksInput(value)` | → string[] | 字幕编辑解析 |
| `resolveSegmentStatusReason(segment, {resolveNotification, truncate})` | → string | failed 段可读原因 |
| `buildPreviewPlaceholder({translate, projectId, hasEditableContent})` | → `{testId, title, description, actionLabel, actionEnabled}` | 占位区块文案 |
| `PREVIEW_PLACEHOLDER_KEYS` | 三个 i18n 键 | 文案键集中声明 |

### 7.2 `ResultSegmentCard.vue`（props / emits）

**props**：`segment`（必填 Object）、`absoluteIndex`（必填 Number，全量下标）、`totalCount`、`policyFlagged`、`busyKind`、`voiceOptions`、`voiceCatalogError`、`voiceSelectable`、`voiceContext`、`unavailableMaterialKinds`

**内部状态**：`segmentDraft`（`segment` 的浅拷贝）+ `watch(segment, deep)` 同步。

> ⚠️ **上述为第一版设计，已被 QM-6 审查项 A1 实测否证，现行实现见下**。浅拷贝 + deep watch 看似能同步，实际不能：宿主的 `refreshSegmentImageUrls()` 会**原地改** `segment.imageUrl/audioUrl/videoUrl/...`，而宿主改的是它自己 data 数组里的对象，卡片侧的 deep watch 不触发；且浅拷贝展开拿到的还是旧值快照 ⇒ 保存/重试/重新合成后用户看到旧图或空白。

**现行实现**：`draft` 是 getter 直接返回 prop `segment`（setter 为空操作，模板从不整体赋值）。代价是 `v-model="draft.text"` 实际写在 prop 上——这在语义上正确：宿主把 segments 数组元素作为**可编辑对象**传进来，本就期望字段被改写，随后经 `story2video:update-segments` 落盘并整体替换 segments。`@input` 同时 emit `dirty` 让宿主知道要保存。

回归锁：`ResultSegmentCard.test.js` 的 A1 用例用 `reactive()` 包裹 segment（**必须**，普通对象上改属性不触发子组件重渲染，会造出假红），断言宿主原地刷新 URL 后卡片显示新值。

**emits**：`dirty`、`card-ref(el, absoluteIndex)`、`move-segment`、`remove-segment`、`select-material`、`generate-image`、`generate-ai-video`、`regenerate-subtitle`、`regenerate-prompt`、`regenerate-audio`、`replace-audio`、`download-artifact`、`preview-material`、`mark-material-unavailable`、`update-subtitle-blocks`

### 7.3 `ResultSegmentEditor.vue`（props / emits）

**props**：`segments`、`segmentsDirty`、`segmentBusy`、`policySceneNumbers`、`voiceCatalogOptions`、`voiceCatalogError`、`voiceContext`、`unavailableMaterialKinds`、`batchLoading`

**内部状态**：`segmentRenderCount`（窗口下界）+ `IntersectionObserver` 哨兵

**emits**（透传到宿主）：`dirty`、`segment-ref`、`move-segment`、`remove-segment`、`select-material`、`generate-image`、`generate-ai-video`、`regenerate-subtitle`、`regenerate-prompt`、`regenerate-audio`、`replace-audio`、`download-artifact`、`preview-material`、`mark-material-unavailable`、`update-subtitle-blocks`、`load-next-batch(batch)`

### 7.4 宿主 `ResultView.vue` 接线

```vue
<ResultSegmentEditor
  v-if="projectId && segments.length"
  :segments="segments" :segments-dirty="segmentsDirty" :segment-busy="segmentBusy"
  :policy-scene-numbers="policyFlagSceneNumbers"
  :voice-catalog-options="voiceCatalogOptions" :voice-catalog-error="voiceCatalogError"
  :voice-context="voiceContext" :unavailable-material-kinds="unavailableMaterialKinds"
  :batch-loading="segmentBatchLoading"
  @dirty="segmentsDirty = true"
  @move-segment="moveSegment" @remove-segment="removeSegment"
  @select-material="selectSceneMaterial" @generate-image="generateSceneImage"
  @generate-ai-video="generateSceneAiVideo" @regenerate-subtitle="regenerateSceneSubtitle"
  @regenerate-prompt="regenerateScenePrompt" @regenerate-audio="regenerateSceneAudio"
  @replace-audio="replaceSegmentAudio" @download-artifact="downloadArtifact"
  @preview-material="previewSceneMaterial"
  @mark-material-unavailable="markMaterialUnavailableFromEditor"
  @update-subtitle-blocks="updateSegmentSubtitleBlocks"
  @load-next-batch="onSegmentBatchLoaded" @segment-ref="setSegmentItemRef"
/>
```

宿主保留的薄包装（供既有调用与测试沿用）：`previewPlaceholder`、`previewLayout`、`segmentFirstBatch`、`pendingSegmentBatch`、`visibleSegments`、`hasFinalVideo`、`sceneMaterialSlots`、`segmentStatusReason`、`subtitleBlocksText`、`segmentVoiceSpeedText`、`clearSceneMaterialUrl`、`markMaterialUnavailableFromEditor`、`onSegmentBatchLoaded`。

---

## 八、验收标准

| # | 判据 | 验证方式 |
| --- | --- | --- |
| A1 | 无 `videoPath` 时**不申请**任何成片/旁白媒体 URL | 单测：`story2videoCreateShareUrl` 未被以 `null`/`undefined` 调用 |
| A2 | 无成片时渲染占位区块（标题/说明/行动位），且不渲染 `<video>` | 单测：`result-preview-placeholder` 存在、`.video-player` 不存在 |
| A3 | 占位区块「重新合成」按钮走 `recomposeProject` | 单测：IPC 被调用 |
| A4 | 169 段任务首屏 IPC ≤ 40 次（原 845 次） | 单测：mock 调用计数 |
| A5 | 哨兵/按钮触发后只解析新增批（≤40 次增量） | 单测：前后调用计数差 |
| A6 | 分段渲染窗口为追加式（不丢已渲染段） | 单测：推进后 item 数严格递增 |
| A7 | `focusScenes` 点名段（含窗口外）强制可见并带徽标 | 既有用例 80 段 + `{49,73,74,999}` |
| A8 | 有成片任务行为完全不变（仍渲染播放器 + 旁白） | 既有 122 条 ResultView 用例 |
| A9 | 文案 zh/en 成对，无硬编码中文 | `check-locale-sync.js --cjk` / `--pair-base` |
| A10 | 无新增超大文件；ResultView 低于点名目标 | `check-max-lines.js` |
| A11 | 全部改动文件 eslint 0 error | `pnpm exec eslint` |
| A12 | 消费方并集全绿 | ResultView / model-info / ue-contract / views-deep(2) / coverage(2) / CreateViewHistory / CreateView / i18n |
| A13 | **宿主原地刷新 URL 后卡片显示新值**（QM-6 审查项 A1 的回归锁） | `ResultSegmentCard.test.js`：`reactive()` 包裹 segment，原地改 `imageUrl` 后断言 `img.src` 为新值 |

---

## 九、已知局限与后续

1. **IPC 次数本身未降**：本 PR 做的是「按需申请」（首屏 20 段、视口内懒加载），单段仍要 5 次 IPC。彻底方案是**服务端批量签 URL**（一次 IPC 签 N 个路径），需改 IPC 契约 + preload + 三层测试，超出本 PR 范围，已记入 backlog。
2. **窗口步长固定 20**：未做「按视口高度动态估算」。169 段场景下用户需点击约 8 次展开完全部分段；哨兵 `rootMargin: 240px` 已让滚动接近时自动追加。
3. **`ResultSegmentCard` 的 draft 直接返回 prop**：嵌套对象（`alternateImages`、`videoMeta`）与宿主共享引用。当前所有编辑动作都只改顶层字段，故安全；若未来要改嵌套字段，需改成结构化 emit（不要回到浅拷贝 + watch，那已被 A1 实测否证）。
4. **未做真实 169 段项目的端到端计时**：量化结论来自 IPC 次数的静态推算 + 单测计数。真实 wall-time 需在实机用失败任务复测（属外部验收）。

---

## 十、变更文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/desktop/src/views/video-creation/composables/useResultPreviewMedia.js` | 新增 | 纯函数策略层（21 条单测） |
| `apps/desktop/src/views/video-creation/composables/useResultPreviewMedia.test.js` | 新增 | 策略层回归测试 |
| `apps/desktop/src/views/video-creation/ResultSegmentCard.vue` | 新增 | 单个分段卡片（174 行） |
| `apps/desktop/src/views/video-creation/ResultSegmentEditor.vue` | 新增 | 分段编辑区 + 渲染窗口 + 哨兵（210 行） |
| `apps/desktop/src/views/ResultView.vue` | 修改 | 宿主接线、三态判据、占位区块、URL 分批 |
| `apps/desktop/src/views/ResultView.test.js` | 修改 | +7 条行为回归；2 条改为经宿主树断言 |
| `apps/desktop/src/locales/story2video/zh.js` | 修改 | +16 个键 |
| `apps/desktop/src/locales/story2video/en.js` | 修改 | +16 个键（成对） |

---

## 十一、质量节拍自检

- [x] **QM-2 首屏不阻塞在 IPC 返回之后**：首屏只申请 20 段 URL；慢而非必需的 `loadVoiceCatalog()` 不阻塞首帧；相互独立的数据源不串行。
- [x] **QM-2 详情函数复用到列表路径前核算单元素成本**：`refreshSegmentImageUrls` 从「全量 N 段」改为「显式传入批次」，缺省仍全量（写后刷新场景）。
- [x] **QM-5 Bug 反思 5 步**：根因（全量 IPC 串 await + 无成片仍走 resolveLocalUrl + img 无懒加载）→ 逃逸链（无「IPC 调用计数」类测试、无「无成片」场景测试、视觉回归对迟到结构性免疫）→ 系统性漏洞（性能类缺陷只能靠 wall-time / 调用计数守）→ 回归保护（7 条行为 + 21 条策略）→ 预防（`useResultPreviewMedia.js` 把策略变纯函数，天然可测）。
- [x] **TDD**：先写测试见 RED（模块不存在 / 哨兵未追加 / 政策徽标丢失），再实现转 GREEN。
- [x] **i18n 成对**：16 个新键 zh/en 成对；模板内硬编码中文全部收口（CJK 门禁 PASS）。
- [x] **无 console.log / 无 waitForTimeout / 无硬编码密钥**。
