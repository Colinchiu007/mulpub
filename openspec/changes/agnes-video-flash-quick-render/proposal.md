## Why

视频创作页的「快速渲染」是本仓唯一一处**绕过流水线编排、直接调 AI 视频模型**的入口，但它的能力被压缩到了只剩「文生视频」一种：

- 后端适配器 `agnes-multimodal.js` **已完整实现 Agnes Video 2.5 Flash 协议**（text / keyframe / reference 三模式、首尾帧、参考图 ≤5、参考音频 ≤3、seconds、aspect_ratio、seed），但**没有任何一条路径把这些参数送到模型**。
- `electron/services/story2video-stages.js` 的 `generateSceneVideo` 提交时只传 `{ prompt, model, width, height, numFrames, frameRate }`——`images` / `audios` / `first_frame` / `last_frame` / `mode` / `seconds` / `aspect_ratio` / `seed` **全部丢弃**。适配器写得再好也用不上。
- `electron/ipc-handlers/render.js` 的 `render:start-ai-video` 契约只有 `{ prompt }`，且**硬编码** `size={width:720,height:1280}` / `seconds=8` / `fps=30`。
- 快速渲染视图只有「文案生成 / 图片轮播」两个 tab；**「输出平台」下拉在 AI 视频路径上完全失效**（选了 YouTube 横屏也出竖屏，因为它压根没传进 IPC）。
- AI 视频的**进度条永远停在 1%**——主进程只在提交前推了一次进度，轮询期间没有回调，用户要盯着 1% 熬 2–10 分钟。

结果是：Agnes Video 2.5 Flash 已具备的能力（角色/商品/风格一致性参考、首尾帧构图锁、节奏参考）在产品上**一个都不可见**；而「输出平台失效」「进度假死」两个缺陷是当前就在冒烟的。

## What Changes

- **打通参数链路**（根）：`generateSceneVideo` 参数契约扩展为 `{ mode, images, audios, firstFrame, lastFrame, videos, aspectRatio, seconds, seed, onProgress }`，新增的媒体与参数**透传到 provider 适配器**（`callAdapter('generateVideo', …)`）。
- **抽模块还债**：`generateSceneVideo` 及其依赖（`downloadVideoToFile` / `probeVideoFile` / `pickFrameCountForSceneDuration` / `MAX_VIDEO_FILE_BYTES`）从 `story2video-stages.js` 抽到新文件 `electron/services/scene-video-generator.js`。
  **动因是硬约束**：`story2video-stages.js` 当前 4081 行，正好等于「点名还账」清单的 target（容差 0）——**加一行就把主干打红、全仓 PR 被挡**。抽出后该文件降到约 3930 行（低于 target ⇒ 债务已还，target 条目保持不动）。
- **IPC 契约扩展**：`render:start-ai-video` 入参从 `{ prompt }` 扩为 `{ prompt, mode, images, audios, firstFrame, lastFrame, aspectRatio, seconds, seed, model, size }`，并做**模式相关的 fail-closed 校验**（text 禁媒体 / keyframe 至少一首尾帧 / reference 至少一类素材）。
- **真实进度**：轮询期间经既有 `render:progress` 通道推送 `{ percent, stage }`；进度来源是**主进程 push**，不是前端轮询（理由见 design.md §4）。
- **前端**：「快速渲染」视图抽成独立组件 `src/views/video-creation/QuickRenderPanel.vue`，内部 mode tab 扩为 4 个（文生视频 / 首尾帧 / 参考素材 / 图片轮播），新增参数区（时长 4–12 秒、输出平台→画幅、seed）与素材上传区（参考图 ≤5、参考音频 ≤3、首帧/尾帧）。
- **输出平台生效**：`profileOptions`（6 个平台）映射到 Agnes 的 6 个合法 `aspect_ratio` 值，**修掉「选了平台不生效」的功能性缺陷**。
- **Flash 约束前置**：`size` 固定 720P、参考图 ≤5、参考音频 ≤3、**不支持参考视频**——在客户端预校验并给出人话提示，不浪费一次 400 往返。

## Capabilities

### New Capabilities

- `agnes-video-quick-render`: 快速渲染页的 AI 视频生成能力契约——模式集合与各自的媒体要求、参数区（时长/画幅/seed/分辨率）、素材上限与客户端预校验、进度与结果呈现、输出平台→画幅映射。
- `s2v-video-generation-contract`: `generateSceneVideo` 的参数契约（模式与媒体透传、进度回调）、模块归属（抽到 `scene-video-generator.js`）。

## Impact

- **主进程**：
  - 新增 `apps/desktop/electron/services/scene-video-generator.js`（从 `story2video-stages.js` 抽出 + 扩展）
  - `apps/desktop/electron/services/story2video-stages.js`（改为 require + re-export，净减约 150 行）
  - `apps/desktop/electron/ipc-handlers/render.js`（IPC 契约扩展 + 轮询期进度推送）
  - `apps/desktop/electron/services/adapters/agnes-multimodal.js`（媒体上限与 size 改读模型能力描述）
  - 新增 `apps/desktop/electron/services/adapters/agnes-video-models.js`（**模型能力单一真源**）
- **渲染端**：
  - 新增 `apps/desktop/src/views/video-creation/QuickRenderPanel.vue`
  - `apps/desktop/src/views/CreateView.vue`（快速渲染视图改为渲染子组件，净减约 100 行）
  - `apps/desktop/src/locales/create/ui/{zh,en}.js`（成对文案）
- **测试**：`scene-video-generator.test.js`（新增）、`render.test.js`、`agnes-multimodal.test.js`、`CreateView.test.js`、`QuickRenderPanel.test.js`（新增）
- **视觉回归**：`apps/desktop/tests/visual-testing/workflows/supplementary-workflows.visual.test.js` 有「快速渲染模式」截图步骤 ⇒ **基线图需同批更新**
- **不触碰**：主流水线编排语义、Story2Video 各阶段、发布链路、模型设置页结构、preload 暴露面（IPC 通道名不变）
- **风险面**：
  1. **`story2video-stages.js` 触碰即可能打红主干** ⇒ 抽模块是前置动作，且必须用 merge preview 口径量行数（见 tasks §5）
  2. **Agnes 是否接受 base64 data URI 作为参考图**——官方文档只写「公网可访问 URL」，第三方 SKILL 称可收 Base64，仓内 `film-engineering` 已有 dataURL 先例。**未实测**；本 change 的参考图**先按 dataURL 交付**，并在 design.md §5 写明「若被拒则改走公网托管」的回退路径
  3. **进度粒度失真**——服务端 `progress` 只有 10 → 100 两档（第三方 FAQ），故进度条采用「阶段文案 + 真实百分比」表达，不伪造连续增长
  4. **既有 spec 约束**：`openspec/changes/archive/2026-09-13-s2v-start-foreground-tracking/spec.md:27` 规定切到「快速渲染」tab 视为离开创作页、须停前端轮询 ⇒ 进度**必须**走主进程 push
