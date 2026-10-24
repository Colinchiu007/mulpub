## Why

主流水线（`story2video-compose`）的每个分镜视频段，生成时**只带文字提示词**——即使该分镜的**分镜图已经生成好了**，那张图也**不会**参与视频生成。

这直接浪费了 Agnes Video 2.5 系列已具备的三种能力：

| 能力 | 当前流水线能否用 | 实际 |
|---|---|---|
| `keyframe`（首尾帧锁构图） | ❌ | 只有文字，没有分镜图可锁 |
| `reference`（参考图保外观/风格） | ❌ | 分镜图就在手边，却不传 |
| `reference`（参考音频保节奏） | ❌ | 该段的 TTS 旁白已生成，也不传 |

对「人物要跨镜头保持一致」「商品图要保持同一形态」这类需求，这直接决定了成片能不能用。

**前置**：本 change 依赖 `agnes-video-flash-quick-render`（把 `generateSceneVideo` 的参数契约打通）。本 change **只负责把流水线已有的分镜图/旁白接上去**，不重复实现契约。

## What Changes

- **分镜图 → 该段视频的参考输入**：每段视频生成时，把该分镜**已选定的图片**作为参考素材传给 provider。
  - 优先用**用户已选定**的素材（manual 模式下用户挑的那张）；
  - 无用户选择时用该段的**首张候选图**；
  - 都没有 ⇒ 该段保持**纯文本生成**（不报错、不阻断，行为与今天一致）。
- **模式选择按能力**：provider 支持 `keyframe` ⇒ 用「首帧锁构图」；只支持 `reference` ⇒ 用「参考图」；都不支持 ⇒ 纯文本。
- **旁白音频 → 参考音频（可选）**：该段 TTS 已生成且用户未替换时，把旁白作为参考音频传入（`reference` 模式支持时）。
  **默认关闭**：旁白是「要播出来的内容」，把它当「节奏参考」会引入语义混淆，且部分 provider 的参考音频有格式/时长限制。做成**可配置开关**，默认关。
- **失败不降级成静默**：参考素材导致 provider 拒收时，该段**回退为纯文本生成**并记录 warning（与既有「视频生成失败 → 回退图片轮播」的失败语义一致），不整条流水线崩掉。

## Capabilities

### New Capabilities

- `s2v-scene-video-reference`: 分镜视频生成时的参考素材来源与选择（分镜图 / 旁白音频）、按 provider 能力选择模式、失败回退语义。

### Modified Capabilities

（无 —— 模式与媒体的契约由 `agnes-video-flash-quick-render` 的 `s2v-video-generation-contract` 承载，本 change 不改那份契约。）

## Impact

- **主进程**：`electron/services/story2video-stages.js`（`generate_assets` 阶段调用 `generateSceneVideo` 的两处之一：`:3167` 附近的每段视频生成）
- **数据**：该段分镜的候选图与已选图、该段 TTS 产物路径（均为既有数据，本 change 只读取）
- **配置**：新增一个开关（是否把旁白作为参考音频），默认关
- **不触碰**：图片生成阶段、TTS 阶段、合成阶段、UI（用户侧无变化）、preload 暴露面
- **风险面**：
  1. **参考图可能被 provider 重新构图**（`reference` 模式的语义是「内容/风格参考」，不是「像素级保持」）——需在 UI 文案上如实说明，避免用户预期偏差
  2. **上传体积**：分镜图若以 Data URI 形式传给 provider，5 张 × 体积会逼近单请求上限 ⇒ 只传**该段用到的 1–2 张**，不做多图
  3. **provider 差异**：非 Agnes 的 provider 可能不认 `images` 参数 ⇒ 必须按能力探测，未声明支持的 provider 一律走纯文本（保守）
