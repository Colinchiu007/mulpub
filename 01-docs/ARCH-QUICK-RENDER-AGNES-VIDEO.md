# ARCH — 快速渲染 × Agnes Video 2.5：模块归属与参数契约

> 配套规格：`openspec/changes/agnes-video-flash-quick-render/`（proposal / design / spec delta / tasks）
> 产品口径：`01-docs/PRD-video-creation.md` §3.1.42
> 执行记录：`openspec/records/agnes-video-flash-quick-render.md`

## 1. 为什么需要这份文档

本仓有两条**结构性**约束决定了「视频生成能力」不能随手写在页面里：

1. **「点名还账」行数天花板**：`.github/scripts/max-lines-baseline.json` 的 `targets` 对若干文件设了**容差 0** 的天花板（点名还债），其中与本议题相关的三个：
   | 文件 | target | 改动前 | 改动后 | 处置 |
   |---|---|---|---|---|
   | `electron/services/story2video-stages.js` | 4081 | 4081（**零余量**） | 3906 | 抽出 `scene-video-generator.js` |
   | `apps/desktop/src/views/CreateView.vue` | 5656 | 5528（余量 128） | 5419 | 抽出 `QuickRenderPanel.vue` |
   | `electron/services/model-provider-manager.js` | 1284 | 1284（**零余量**） | 1284（净零） | 能力查询外移到独立模块 |
2. **渲染端 CJK 门禁**：`check-locale-sync --cjk` 按 **file+content** 增量比对基线扫描 `apps/desktop/src` 的 `.js` 与 `.vue`（含 `<template>` 文本节点）⇒ **新文件里的任何中文字面量都是新增硬编码**。

⇒ 这两条直接决定了模块怎么切、代码怎么写。

## 2. 模块归属

```
apps/desktop/src/views/CreateView.vue            （视频创作页，只做编排）
  └─ views/video-creation/QuickRenderPanel.vue   （快速渲染面板：模式/参数/进度/结果）
       ├─ views/video-creation/QuickRenderMaterials.vue   （素材区：首尾帧 / 参考图 / 参考音频 / 轮播图）
       ├─ views/video-creation/useQuickRenderMaterials.js（文件读取 + 数量/体积护栏）
       ├─ views/video-creation/quick-render-constants.js （输出平台→画幅映射、体积护栏、时长范围）
       └─ @multi-publish/shared-utils/src/agnes-video-request.js（模式↔媒体契约，**与主进程共用**）

apps/desktop/electron/ipc-handlers/render.js
  └─ services/scene-video-generator.js            （提交 → 轮询 → 下载 → ffprobe 校验）
       └─ services/adapters/agnes-multimodal.js   （Agnes 协议适配器）
            ├─ services/adapters/agnes-video-models.js    （**模型能力单一真源**）
            └─ services/adapters/agnes-video-request.js  （请求体构造 + 本地预校验）
```

**为什么 `generateSceneVideo` 要抽出去**：它所在的 `story2video-stages.js` 在点名还账清单里且当时正好卡在 target 上；本次必须给它加参数（媒体透传 + 进度回调）⇒ 只能抽，不能加行。抽取按**依赖闭包**切分，保证原文件侧不留悬空引用：

| 迁出 | 留在原文件 | 理由 |
|---|---|---|
| `generateSceneVideo` / `pickFrameCountForSceneDuration` / `downloadVideoToFile` / `probeVideoFile` / `MAX_VIDEO_FILE_BYTES` | `probeAudioFile`（自带 `execFileAsync`，不用 `runTool`）、`sleep`（被 7 处使用） | 被迁出者仅被 `generateSceneVideo` 依赖；共用者留下 |

`story2video-stages.js` 保留 `module.exports.generateSceneVideo` 的 re-export ⇒ **对外 API 形状不变**，既有 3 个调用点与既有测试零改动。

## 3. 参数契约（三层各管一段，不得互相猜）

### 3.1 渲染层 → IPC

```js
{
  prompt: string,          // 必填
  mode?: 'text' | 'keyframe' | 'reference',
  images?: string[],       // reference
  audios?: string[],       // reference
  videos?: Array,          // reference（仅支持该能力的模型）
  firstFrame?: string,     // keyframe
  lastFrame?: string,      // keyframe
  aspectRatio?: string,    // 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9
  seconds?: number,        // 4–12
  seed?: number,           // 0 是合法值
}
```

### 3.2 IPC → 适配器

`generateSceneVideo` 收到的扩展参数**有值才写键**（`buildSubmitParams`）：不传扩展参数时，提交给适配器的参数集与扩展前**逐字段相同** ⇒ 既有调用方零影响。

`firstFrame` 同时写 `firstFrame` / `first_frame` / `image` 三个键：前两个是 2.5 协议用，第三个供只认单张 `image` 的旧版适配器（`agnes-video` v2.0 的 img2video）。

### 3.3 适配器 → 上游

`agnes-video-request.js` 构造请求体并做本地预校验。**本地预校验的理由**：上游在**创建任务前**就拒收并返回 400（`size must be 720P` / `images length must not exceed 5` / `audios length must not exceed 3` / `videos is not supported`）——不计费，但每次白跑一趟。判据来自能力描述，不另抄模型名单。

## 4. 能力判据：模型的属性，不是 provider 名单

`describeVideoModel(model)` 对已知模型返回能力描述，对未知模型返回**保守回落**（`id` 为空）：

| 模型 | 尺寸档位 | 参考图 | 参考音频 | 参考视频 |
|---|---|---|---|---|
| `agnes-video-2.5-flash` | 固定 720P | ≤5 | ≤3 | ❌（服务端 400） |
| `agnes-video-2.5` | 720P/1080P/1K/2K | ≤8 | ≤3 | ≤1 |
| 其它（kling / veo / …） | — | 0 | 0 | ❌ ⇒ **只支持文生视频** |

**为什么不用「providerId 名单」**：名单判据对新增对象默认不成立——将来换一个讲同一套协议的 provider，若判据是名单，就必须记得去改这张名单。改成模型属性后，模型被能力表收录即自动生效。

这也让 `model-provider-manager.js` **保持净零增长**（它在点名还账清单里、零余量）：能力查询的实现放在 `model-provider-video-capabilities.js`，manager 一行都不用加。

## 5. 进度：载荷形状是契约的一部分

主进程经 `render:progress` 推 `{ percent, stage }`；preload 的 `onRenderProgress` 把载荷**原样**交给回调（`(_e, p) => callback(p)`）。

⇒ 渲染层必须**按对象读**：`payload.percent` / `payload.stage`。历史实现按 `(pct, stg)` 两个位置参数解构，`pct` 拿到的是整个对象 ⇒ 进度条渲染成 `[object Object]%`。这是「进度条不动」的真实根因之一（另一个是轮询期没推）。

**百分比如实透传，不伪造连续增长**：上游 `progress` 只有 10 / 100 两档，进度条据此呈现；「排队中 / 生成中」靠上游**原始状态**区分（归一化后两者都是 `processing`），故适配器额外回传 `providerStatus`。

**进度由主进程 push，不改前端轮询**：切到其它 tab 视为离开创作页、须停前端轮询（既有 spec `s2v-start-foreground-tracking`）。

## 6. 取消语义

上游未公开任务取消端点 ⇒ `renderCancel` 只取消**本地 Remotion 渲染**（图片轮播路径）。AI 视频的【取消】只停本地等待，并**如实提示**「远端任务可能仍在生成」——不声称任务已终止。

## 7. 素材形态

参考图 / 参考音频以 **Data URI** 形式提交（免去二次托管，是本仓既有做法，见 `film-engineering/video-reference-inputs.js`）。体积护栏按 Base64 膨胀约 33% 折算：参考图 ≤5MB、参考音频 ≤10MB（上游单请求 <50MB）。

> ⚠️ 上游是否接受 Data URI 形态的参考图**尚未实测**（官方文档只写「公网可访问 URL」）。若被拒，改走公网素材托管（复用 `podcast-hosting-upload.js` 的 OSS PUT 原语）。
