# Design — agnes-video-scene-reference-pipeline

## 1. 落点：为什么不是主流水线

上一轮规划里写的「主流水线每段视频用分镜图做参考」，**前提是错的**。核实代码后发现：

| 事实 | 证据 |
|---|---|
| 视频场景**根本不生成图片** | `imageTargetCount = optimizedPrompts.length - videosTotal`（`story2video-stages.js`）⇒ 图片**只是视频失败时的回退** |
| 视频提交**早于**该分镜图片的生成请求 | 视频循环 `videoPromise = _mapWithConcurrency(...)`（:2959）先于图片循环 `imagePromise = _mapWithConcurrency(...)`（:3194）启动 |
| manual 模式同理 | manual 走 `buildManualSceneCandidates`：先出候选（含视频），再在 `scene_asset_selection` 检查点等用户挑 |

⇒ **在任何模式下，视频生成时该分镜的图都不存在**。

要让它存在，得把资产策略改成「每个视频场景也先生成图 + 该段视频等这张图」——那是：
- 多出 V 次图片生成（真实成本）；
- 阶段内串行化（与 2026-08-13「视频与图片/旁白并行启动、避免『视频 4/5 · 图片 0/16』长期无进展」的优化**直接冲突**）。

**这是产品决策，不是机械扩展。** 本 change 不做，改做**真正落点成立**的那条路径。

## 2. 落点：视频任务编辑页的「生成 AI 视频」

`story2video-project-service.js` 的 `generateSceneAiVideo(projectId, segmentId)`：用户从**视频任务编辑页**对某个场景重新生成 AI 视频。此时：

- 该场景**已选定的图片一定存在**（用户在编辑页挑过，`segment.imagePath`）；
- 零额外图片生成、零串行化、零额外成本；
- 直接服务真实诉求：**人物/商品跨镜头保持一致**（用户挑好的那张图，AI 视频应当长得像它）。

⇒ 本 change 只把「该场景已选定的图片」接成 provider 的参考输入。

## 3. 决策

### 决策 1：按模型能力选择模式，不猜

`buildSceneVideoReference` 用 `describeVideoCapabilities(model)`（**模型的能力属性**，非 providerId 名单）判定：

| 能力 | 模式 | 参数 |
|---|---|---|
| 支持 `keyframe` | `keyframe` | `firstFrame`（该图作为首帧，锁构图） |
| 只支持 `reference` | `reference` | `images: [该图]` |
| 都不支持 | — | 不传任何媒体（**纯文本**，行为与今天一致） |

未知模型 ⇒ 保守回落（纯文本）。**不猜、不试**——试错会变成一次必然 400 的请求。

### 决策 2：读图要过三道关

1. **受控媒体根**：`resolveReadableMediaFile(path, { kind: 'image', allowedRoots: [projectDir, ...getAllowedMediaRoots()] })`
   —— 拒绝越界路径、软链接、非文件、扩展名不符、体积超限；
2. **体积上限 5MB**（参考图上限，Base64 膨胀约 33%，为上游单请求 50MB 留余量）；
3. **魔数嗅探**：只信内容不信扩展名 —— 一个声明为 `.png` 的字节流**不能**当图片发出去。

任一关不过 ⇒ **降级为纯文本**（不阻断该段生成），并记 warning + reason（可归因）。

### 决策 3：形态是 Data URI

与仓内既有做法一致（`film-engineering/video-reference-inputs.js`：本地图片 → dataURL → provider 参考输入）。
**未实测**上游是否接受 Data URI 形态的参考图（官方文档只写「公网可访问 URL」）⇒ 记在待实测清单；
若被拒，改走公网素材托管（`agnes-video-nonflash-reference-video` 已预留该原语）。

## 4. 风险与回退

| 风险 | 回退 |
|---|---|
| 上游拒收 Data URI 形态 | 改走公网托管；参考构造层是唯一改动点（`buildSceneVideoReference` 的输出形态） |
| provider 不认 `images`/`first_frame` | 已由能力判定拦在客户端（未知模型 ⇒ 纯文本） |
| 图太大 | 已按 5MB 上限跳过（降级纯文本） |
| 参考图被 provider **重新构图** | `reference` 模式的语义是「内容/风格参考」而非「像素级保持」；`keyframe` 才承诺首帧一致 ⇒ 优先用 `keyframe`（能力允许时） |

## 5. 不做什么

- ❌ 不改主流水线的资产策略（多生成图片 + 串行化）——**产品决策**，见 §1
- ❌ 不做多图参考（只传该场景用到的 1 张，避免逼近单请求体积上限）
- ❌ 不把旁白音频当参考音频（语义混淆：旁白是「要播出来的内容」，不是「节奏参考」）
- ❌ 不改 UI（用户侧无变化）
