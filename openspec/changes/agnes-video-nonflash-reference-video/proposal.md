## Why

`agnes-video-2.5-flash` 的能力边界里**明确不含参考视频**（服务端硬拒 `videos`，400 `videos is not supported`）。但**非 Flash 的 `agnes-video-2.5` 支持**：

| 维度 | `agnes-video-2.5-flash` | `agnes-video-2.5` |
|---|---|---|
| 参考视频 `videos[]` | ❌ 400 `videos is not supported` | ✅ ≤1 个，2–12 秒，24–60 FPS，<50MB |
| 视频对象字段 | — | `url`（必填）、`start_seconds`、`require_audio` |
| 分辨率档位 | 固定 720P | 720P / 1080P / 1K / 2K |
| 参考图 | ≤5 | ≤8 |
| 计费 | 当前 ¥0/秒（限时免费） | 720P ¥0.15/s、1080P 与 1K ¥0.24/s、2K ¥0.33/s |

⇒ **「参考视频生视频」这个能力在非 Flash 模型上是可用的，但产品上完全没露出来**：模型种子里没有 `agnes-video-2.5`、适配器的模型清单里没有、UI 里没有参考视频上传位。

同时暴露一个**计费可见性**问题：非 Flash 按秒计费，且**输入视频的秒数与输出秒数相加计费**（8 秒输出 + 3 秒参考视频 = 11 秒 × ¥0.15 = ¥1.65，比不带参考视频的 ¥1.20 多 37%）。不显示成本，用户会意外多付。

## What Changes

- **暴露非 Flash 模型**：`agnes-multimodal` 的模型清单与种子加入 `agnes-video-2.5`（能力描述已在 `agnes-video-models.js` 中定义）。端点仍由用户在「模型设置」里配置（官方文档标注非 Flash 在国际站上线）。
- **参考视频上传位**：参考素材模式新增第三个素材类型（参考视频），**仅当当前模型的能力声明 `supportsReferenceVideo` 时才渲染**——不写死「Agnes Flash 不支持」，而是由模型能力驱动。
- **参考视频以 Data URI 提交**：与参考图同源思路。官方文档对参考视频写的是「可公开访问的视频 URL」，但参考视频**时长受限（2–12 秒）**、短片 base64 后体积可控（≤20MB）⇒ 先按 Data URI 交付；体积上限与文件类型（mp4/mov/webm/mkv）由客户端把关。
- **成本可见**：参数区显示预计成本（输出秒数 × 档位单价）；有参考视频时明示「其时长另计」。免费模型显示「限时免费」。
- **能力描述携带计费口径**：`describeVideoCapabilities` 一并返回各档位的现行价与列表价（¥/秒），渲染层据此计算。

## Capabilities

### New Capabilities

- `agnes-video-reference-video`: 参考视频素材的来源与形态（Data URI）、能力门控（仅支持该能力的模型）、数量与体积上限、计费口径与成本可见性。

## Impact

- **主进程**：
  - `electron/services/adapters/agnes-video-models.js`（能力描述加计费口径 + 成本估算函数）
  - `electron/services/model-provider-video-capabilities.js`（能力响应带 `prices` / `listPrices`）
  - `electron/services/model-provider-seeds.js` + `adapters/agnes-multimodal.js`（暴露 `agnes-video-2.5`）
  - `electron/services/adapters/agnes-video-request.js`（`videos[]` 构造与上限校验，**已在 Change 1 就位**）
- **渲染端**：`QuickRenderPanel.vue` / `QuickRenderMaterials.vue` / `useQuickRenderMaterials.js` / `quick-render-constants.js` / locale zh+en
- **不触碰**：preload 暴露面（IPC 通道名不变）、流水线、发布链路
- **风险面**：
  1. **非 Flash 在中国站的可用性未实测**（文档标注「已在国际站上线」，本仓 base_url 是中国站）⇒ 端点由用户配置，模型暴露不绑定端点
  2. **参考视频的 Data URI 形态未实测**（官方文档只写公网 URL）⇒ 体积护栏 + 失败降级（该次请求失败，不影响其它能力）
  3. **计费不可预知**：参考视频的**时长**客户端读不到（需 ffprobe）⇒ 成本提示只显示输出部分，并明示「其时长另计」
