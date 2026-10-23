# Design — agnes-video-flash-quick-render

## 1. 上下文

「快速渲染」是本仓唯一直接调 AI 视频模型的入口。现状链路：

```
CreateView.vue (view==='quick')
  └─ startQuickRender()
       └─ renderStartAiVideo({ prompt })                 [api/publisher.js:202]
            └─ IPC 'render:start-ai-video'               [electron/ipc-handlers/render.js:42]
                 └─ generateSceneVideo({ prompt, size:{720,1280}, seconds:8, fps:30 })
                      └─ manager.callAdapter(providerId, 'generateVideo', { prompt, model, width, height, numFrames, frameRate })
                           └─ AgnesMultimodalAdapter.generateVideo()   [已实现 2.5 Flash 完整协议]
```

断点有两处：

1. **参数层**：`generateSceneVideo` 构造的 `submitParams` 只有 6 个字段，Agnes 适配器支持的 `mode` / `images` / `audios` / `first_frame` / `last_frame` / `seconds` / `aspect_ratio` / `seed` 一个都没传。
2. **契约层**：IPC 只接受 `{ prompt }`，宽高/时长在主进程写死。

## 2. 决策

### 决策 1：抽 `scene-video-generator.js`，而不是给 `story2video-stages.js` 抬天花板

**背景**：`.github/scripts/max-lines-baseline.json` 的 `targets` 机制对 `story2video-stages.js` 设了 **target=4081、容差 0**（"点名还账"），而该文件当前读数正好 4081 —— **加一行即主干红、required check 连带红、所有 open PR 被挡**。

**候选**：
| 方案 | 做法 | 评价 |
|---|---|---|
| A 抽模块（**选中**） | 把 `generateSceneVideo` + 专属依赖搬到新文件，原文件 require + re-export | 净减约 150 行 ⇒ 低于 target ⇒ **债务还清**，target 条目保持不动（机制本意是继续盯零增长） |
| B 上调 target | 在本 PR 里把 target 抬到新实测值 | 合法但把债推给下一个人；且本仓的既有做法是「谁撑大谁在自己的 PR 里抬」，抬之前应先问「能不能不撑大」 |
| C 就地加行 | 直接改 | ❌ 立刻打红主干 |

**选 A。** 且抽取本身是**纯搬移不改行为**（`generateSceneVideo` 的现有语义、错误消息、返回值形状全部保持），符合仓内「还债路径优先于抬基线」的既有做法。

**搬移边界**（按依赖闭包切分，确保 story2video-stages.js 侧不留悬空引用）：

| 迁出 | 原位置 | 迁出理由 |
|---|---|---|
| `generateSceneVideo` | :798 | 本 change 的扩展目标 |
| `pickFrameCountForSceneDuration` | :670 | 仅被 `generateSceneVideo` 调用（:801） |
| `downloadVideoToFile` | :741 | 仅被 `generateSceneVideo` 调用（:855） |
| `MAX_VIDEO_FILE_BYTES` | :82 | 仅被 `downloadVideoToFile` 的调用点使用（:855） |
| `probeVideoFile` | :874 | 仅被 `generateSceneVideo` 调用（:862） |
| `runTool` | :913 | 被 `probeVideoFile` 与 `probeAudioFile` 共用 ⇒ **留在原文件**，新模块反向 require 它 |

`sleep`（:1377）在原文件被用 7 次 ⇒ 留在原文件；新模块自持一个 3 行局部实现（仓内 `prompt-eval/store.js`、`identity/secure-token-storage.js` 等处同样是局部实现，与仓内现状一致，不算新增重复概念）。

`story2video-stages.js` 保留 `module.exports.generateSceneVideo`（re-export），**对外 API 形状不变** ⇒ 既有 3 个调用点（`render.js:10`、`story2video-stages.js` 内部 2 处）与既有测试**零改动**。

### 决策 2：模型能力用「能力描述表」，不用散落的模型名单

**问题**：Flash 与非 Flash 的差异有 5 项（size 档位、参考图上限、参考音频上限、参考视频支持与否、画幅集合）。若在 UI / IPC / 适配器三处各写一遍 `if (model === 'agnes-video-2.5-flash')`，就会出现「三处不同步 ⇒ 某个模型多传了服务端拒收的字段 ⇒ 每次白跑一次 400」。

**选**：新增 `electron/services/adapters/agnes-video-models.js` 作为**单一真源**，每个模型一条能力描述；适配器与 UI 都从它读。

```
describeVideoModel(modelId) → {
  id, name, description,
  sizes: [...], defaultSize,
  maxImages, maxAudios, maxVideos,
  supportsReferenceVideo,
  aspectRatios: [...],
}
```

**未知模型 → 保守回落**（fail-closed）：取 Flash 的最严能力集（720P / ≤5 图 / ≤3 音频 / 不支持参考视频）。理由：宁可在客户端拒收一个配置错了的模型，也不发一个必然 400 的请求。

> 与仓内既有纪律一致：判据落在**模型的能力属性**上，而不是散落的 `modelId === ...` 名单。

### 决策 3：参数透传用「有值才写」，不写 undefined 字段

`submitParams` 只在参数有值时才写入对应键。理由：其它 provider 适配器（kling / veo / seedance / minimax / wan …）虽然都显式构造请求体、不会盲传 `params`，但多写 `mode: undefined` 这类键会让**日志与断言**多出噪声，也增加将来某个适配器改成展开式构造时的风险。

### 决策 4：进度走主进程 push，**不改**成前端轮询

**约束**：`openspec/changes/archive/2026-09-13-s2v-start-foreground-tracking/spec.md:27` 规定——切到「快速渲染」/「历史记录」tab 视为离开创作页，须**停止前端轮询**，但主进程 run 继续执行。

若把进度改成前端轮询 `getVideoStatus`，用户一切 tab 进度就断了（而任务还在跑），与该 spec 冲突。故沿用既有的 `render:progress` 通道：主进程在轮询循环里 push `{ percent, stage }`。

**阶段划分**（stage 文案）：
| 阶段 | percent | 说明 |
|---|---|---|
| 提交视频生成任务 | 2 | 提交前 |
| 排队中 | 10 | 服务端 `queued` |
| 生成中 | 10 | 服务端 `progress` 只有 10/100 两档 ⇒ **不伪造连续增长**，用文案表达 |
| 下载成片 | 90 | 轮询到 URL 后 |
| 完成 | 100 | 落盘 + ffprobe 校验通过 |

### 决策 5：参考图走 dataURL，且**明确标记为未实测**

Agnes 官方文档写「所有媒体 URL 都应可由 Agnes AI 服务公开访问」，而第三方 SKILL 称 `first_frame` / `images` 可收 Base64 data URI；仓内 `film-engineering/video-reference-inputs.js` 已有「本地图片 → dataURL → provider 参考输入」的成例（且其映射表把 `agnes-multimodal` 映射到 `params.image`）。

**本 change 的选择**：先用 dataURL 交付（零新基建、当天可验证）。
**回退路径**（写入 design §风险）：若服务端拒收 data URI ⇒ 改走公网托管（复用 `podcast-hosting-upload.js` 的 OSS PUT 原语），该部分已在 `agnes-video-nonflash-reference-video` change 预留。

**客户端体积护栏**（dataURL 会膨胀约 33%，Agnes 限单请求 <50MB）：
| 素材 | 单文件上限 | 理由 |
|---|---|---|
| 参考图 | 5MB | 5 张 × 5MB × 1.33 ≈ 33MB，留足余量 |
| 参考音频 | 10MB | 单段 <15MB（官方），留余量 |

### 决策 6：前端抽 `QuickRenderPanel.vue`，CreateView.vue 只做编排

`CreateView.vue` 读数 5528、target 5656（容差 0），**余量仅 128 行**；而新增的 4 个 mode + 参数区 + 素材区远超 128 行。

**选**：把整个「快速渲染」视图（含 state / computed / methods）抽成 `src/views/video-creation/QuickRenderPanel.vue`（与既有 `S2vConfigPanels.vue` / `SceneAssetSelection.vue` 同构），CreateView.vue 只保留一行 `<QuickRenderPanel @view-result="..." />`。

**结果**：CreateView.vue 从 5527 行降到约 5420 行（**净减**，且低于 target ⇒ 不触发还债机制），新组件独立成文件、不受 target 约束。

### 决策 7：mode 只有 3 个 AI 模式 + 1 个本地模式，不做 6 个平铺 tab

Agnes 的三种 mode（text / keyframe / reference）语义互斥且有各自的媒体要求；「参考图 / 参考音频 / 参考视频」是**同一个 reference 模式下的不同素材类型**，不是三个模式。平铺成 6 个 tab 会让「参考图」和「参考音频」看起来像两种生成方式，实际服务端走的是同一条 `mode=reference`。故 4 个 tab：

| tab | mode | 素材要求 |
|---|---|---|
| 文生视频 | `text` | 无 |
| 首尾帧 | `keyframe` | 首帧 / 尾帧至少一个 |
| 参考素材 | `reference` | 参考图 / 参考音频 / 参考视频至少一类 |
| 图片轮播 | —（本地 Remotion） | 图片 ≥1 |

「参考视频」**不在 tab 层**，而是 reference 模式下的**第三个素材类型**，且**仅当当前模型支持时**才出现（由能力描述驱动，见决策 2）——本 change 只做 Flash，Flash 不支持，故 reference 模式当前只有图 + 音频两类。

## 3. 风险与回退

| 风险 | 触发判据 | 回退 |
|---|---|---|
| 主干被行数门禁打红 | `node .github/scripts/check-max-lines.js` 在 merge preview 上红 | 抽模块后必然低于 target；仍红则检查是否有别的文件被顺带撑大 |
| 服务端拒收 dataURL | 参考图请求返回 400 且文案指向媒体 URL | 改走 OSS 公网托管（`agnes-video-nonflash-reference-video` 已预留） |
| 进度百分比长期停在 10 | 用户反馈「进度不动」 | 改用 stage 文案为主、百分比为辅（决策 4 已按此设计） |
| 「输出平台」映射到非法画幅 | profile → aspect_ratio 映射表漏项 | 映射表以适配器的 `aspectRatios` 为准，缺省回落 `16:9` |
| 既有 spec 冲突 | 切 tab 后进度停更 | 决策 4 已规避（主进程 push，不受 tab 切换影响） |

## 4. 不做什么

- ❌ 不动 Story2Video 主流水线的编排语义（每段视频用分镜图做参考属独立 change）
- ❌ 不实现参考视频（Flash 不支持；需非 Flash 模型 + 公网上传基建）
- ❌ 不改 preload 暴露面（IPC 通道名 `render:start-ai-video` 与 `render:progress` 均不变）
- ❌ 不实现「取消远端任务」（Agnes 未公开取消端点）——「取消」只停本地等待，并明示远端可能仍在生成
- ❌ 不做 `n > 1`（服务端仅支持 1）
