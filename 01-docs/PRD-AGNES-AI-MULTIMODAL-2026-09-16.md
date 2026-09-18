# PRD：模型设置新增 Agnes-AI 多模态模型（文字推理 + 图片生成 + 视频生成）

**日期**：2026-09-16
**状态**：已实现（feature 分支 `mp-agnes-multimodal`）
**关联**：`CHANGELOG.md` 2026-09-16 feat(model-providers) 条目；既有服务商 `agnes-llm` / `agnes-image` / `agnes-video`（国际站）保留不动
**官方文档**：
- 文字推理：https://www.agnes-ai.cn/zh-Hans/docs/agnes-30-flash
- 图片生成：https://www.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash
- 视频生成：https://www.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash

---

## 1. 背景与目标

Agnes 原先在应用中以三个独立预设服务商接入（文字推理 `agnes-llm`、图片生成 `agnes-image`、视频生成 `agnes-video`，均指向国际站 `https://apihub.agnes-ai.com/v1`），用户需要分别配置 3 个 API Key、分别维护。Agnes 中国站（agnes-ai.cn）提供统一端点与统一 Key，并推出新一代模型。

**目标**：在模型设置中新增一个多模态服务商 **Agnes-AI**（provider id：`agnes-multimodal`），一次配置即可在「文字推理 / 图片生成 / 视频生成」三类能力中使用 Agnes 模型；端点切换为中国站。

**非目标（本次不做）**：
- 不删除/不禁用既有国际站三个预设（存量用户配置不受影响）；
- 不支持 Agnes TTS / 语音识别能力（中国站本次未提供对应模型）；
- 不改动 ops-center 运营侧预设目录（运营可在后台按需同步）。

## 2. 服务商定义（数据结构）

### 2.1 预设种子（`apps/desktop/electron/services/model-provider-seeds.js`）

| 字段 | 值 | 说明 |
|------|-----|------|
| id | `agnes-multimodal` | 服务商唯一标识 |
| name | `Agnes-AI` | 用户可见名称 |
| category | `multimodal` | 多模态类别（复用既有类别，中文标签「多模态模型」） |
| base_url | `https://api.agnes-ai.cn/v1` | **中国站统一端点**（注意：与既有国际站预设的 `apihub.agnes-ai.com` 不同） |
| models | `['agnes-3.0-flash', 'agnes-image-2.5-flash', 'agnes-video-2.5-flash']` | 三个能力各一个模型 |
| is_preset | `1` | 预设服务商：不可删除，只能禁用 |
| capabilities | `['llm', 'image', 'video']` | 声明 3 项能力（≥ `MULTIMODAL_MIN_CAPABILITIES`=2，满足多模态契约） |
| capability_models | `{ llm: 'agnes-3.0-flash', image: 'agnes-image-2.5-flash', video: 'agnes-video-2.5-flash' }` | 按能力路由的默认模型 |
| rate_per_minute | `20` | 预设限流预算（与 minimax-multimodal 同级；多模态混合能力取中值） |

初始化通过 `INSERT OR IGNORE` 写入 `model_providers` 表；`_syncPresetCapabilities()` 会把 capabilities / capability_models diff-merge 回填到存量库（只增不覆盖用户配置），升级旧库无需迁移脚本。

### 2.2 能力 → 模型 → 接口对照

| 能力 | 模型 ID | 接口 | 认证 | 输出 |
|------|---------|------|------|------|
| 文字推理（llm） | `agnes-3.0-flash` | `POST {base_url}/chat/completions`（OpenAI 兼容；亦支持 /responses、/messages，本项目统一走 chat/completions） | `Authorization: Bearer <key>` | `choices[0].message.content`，流式 SSE 可选 |
| 图片生成（image） | `agnes-image-2.5-flash` | `POST {base_url}/images/generations` | 同上 | `data[0].url`（url 模式）或 `data[0].b64_json`（b64 模式） |
| 视频生成（video） | `agnes-video-2.5-flash` | `POST {base_url}/videos` 提交；`GET {域名根}/agnesapi?video_id=<ID>&model_name=<模型ID>` 轮询 | 同上 | 提交返回 `video_id`；完成时 `metadata.url` 为下载地址 |

### 2.3 Adapter（`apps/desktop/electron/services/adapters/agnes-multimodal.js`）

类 `AgnesMultimodalAdapter`，注册于 `model-provider-manager.js` 的内置工厂表（key：`agnes-multimodal`）。

**实现策略（对齐 minimax-multimodal 范式）**：
- `chatCompletion()` / `streamChat()` → 委托 `AgnesLlmAdapter`（OpenAI 兼容，未指定模型时默认 `agnes-3.0-flash`）；
- `generateImage()` → 委托 `AgnesImageAdapter`（未指定模型时默认 `agnes-image-2.5-flash`；`response_format` 必须放 `extra_body`，顶层会被网关拒绝——该约定既有 adapter 已实现）；
- `generateVideo()` / `getVideoStatus()` → **本类内实现**（见 §4，视频 2.5 Flash 是全新协议，与 v2.0 adapter 不兼容）；
- `listModels()` → 静态列表（3 个模型，副本返回）；
- `testConnection()` → 委托 `_image.testConnection()`（仅校验 apiKey 存在，不做网络调用，与 minimax-multimodal 一致）；
- `validateConfig()` → apiKey + baseUrl 必填。

## 3. 数据校验

### 3.1 配置层
| 校验项 | 规则 | 失败行为 |
|--------|------|---------|
| apiKey | 非空（官方密钥 `sk-` 开头，但不强校验前缀） | `validateConfig` 返回 `valid:false, errors:['apiKey is required']`；测试连接失败 |
| baseUrl | 非空；预设默认注入 `https://api.agnes-ai.cn/v1` | `errors:['baseUrl is required']` |
| 能力声明 | `capabilities` ≥ 2 项且 ⊆ `MULTIMODAL_CAPABILITY_IDS`；`capability_models` 的值必须都在 `models` 内 | 由种子契约测试锁定（`agnes-multimodal.test.js`） |
| 限流预算 | `PRESET_RATE_LIMITS['agnes-multimodal']` 必须登记且 rpm ≥ 1 | 由 `model-provider-seeds.test.js` 契约锁定 |

### 3.2 请求层（视频 v2.5 Flash 专属硬校验，服务端 HTTP 400）
| 校验项 | 规则 | 客户端处理 |
|--------|------|-----------|
| size | 固定字符串 `"720P"`，其他值一律 400 `size must be 720P` | 客户端写死，不接受参数覆盖 |
| seconds | 字符串 `"4"`–`"12"` | `pickSeconds()`：numFrames/frameRate 推导 → 四舍五入 → clamp [4,12]；非法输入默认 `"5"` |
| aspect_ratio | `21:9` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` | `pickAspectRatio()`：由像素宽高取对数距离最近画幅；非法/缺失默认 `16:9`；显式传参优先 |
| mode | `text` / `keyframe` / `reference` | 缺省推导：有 `image`/`first_frame`/`last_frame` → keyframe；有 `images`/`audios` → reference；否则 text |
| keyframe 媒体 | `first_frame` 与 `last_frame` 至少一个 | 客户端预校验，缺失抛 `INVALID_CONFIG`（不发起请求） |
| reference 媒体 | `images` ≤ 5 张、`audios` ≤ 3 段、不支持 `videos` | 客户端透传，服务端 400 兜底；`videos` 不透传 |
| prompt | 必填 | 缺失抛 `INVALID_CONFIG` |

图片请求校验：`model`/`prompt`/`size` 必填；`size` 推荐档位 `1K/2K/3K/4K`（兼容 `1024x768` 历史写法，服务端会标准化）；`ratio` 支持 `1:1/3:4/4:3/16:9/9:16/2:3/3:2/21:9`；**顶层 `response_format` 禁止**，必须放 `extra_body.response_format`（`url` / `b64_json`）；图生图/多图合成需 `extra_body.image` 数组，且**不需要** `tags: ["img2img"]`。

### 3.3 客户端超时与重试
- 请求超时：默认 120s（官方建议图片 60–360s，可由 options.timeout 覆盖）；
- 视频提交重试：503（队列满载）/ 429（限流）/ 500 视为瞬时错误，最多 6 次递增退避（20s/30s/45s/60s/60s，测试可注入）；401/403/402/400 等非重试错误立即抛出；
- 状态查询重试：最多 3 次，退避 5s×attempt；
- callAdapter 层另有兜底超时（超时抛 TIMEOUT → 归为瞬时错误自动重试）。

## 4. 功能逻辑（视频生成流程）

```
用户选择 Agnes-AI 为视频默认（或能力路由命中）
        │
videogen-stages「videogen_generate」阶段
        │  callAdapter('generateVideo', { prompt, model, width, height, numFrames, frameRate, ... })
        ▼
AgnesMultimodalAdapter.generateVideo
        ├── 参数映射（v2.0 流水线参数 → v2.5 协议）：
        │     numFrames/frameRate → seconds（clamp 4–12，字符串）
        │     width/height        → aspect_ratio（最近画幅）
        │     image（如有）        → mode=keyframe + first_frame
        │     size 写死 "720P"
        ├── POST https://api.agnes-ai.cn/v1/videos
        ├── 503/429/500 → 有界重试（6 次）
        ├── 解析 taskId：video_id > id > task_id（兼容三种命名）
        └── 记录 taskId → model 映射（有界 200 条，供查询回传 model_name）
        │
轮询（每 10s，最长 10 分钟，videogen-stages 既有逻辑）
        │  callAdapter('getVideoStatus', { videoId, taskId })
        ▼
GET https://api.agnes-ai.cn/agnesapi?video_id=<ID>&model_name=agnes-video-2.5-flash
        ├── 注意：/agnesapi 在域名根（base_url 之外），必须绝对 URL
        ├── 状态映射：queued/in_progress → processing；completed → completed；failed → failed
        └── 完成时 videoUrl = metadata.url（官方结构；兼容旧版顶层 url）
        │
下载视频 → FFmpeg 拼接 → 产出最终视频
```

**关键差异（相对旧 agnes-video-v2.0 adapter）**：
| 维度 | v2.0（旧） | v2.5 Flash（本预设） |
|------|-----------|---------------------|
| 尺寸参数 | width/height/num_frames/frame_rate（8n+1 帧规则） | `size:"720P"` + `aspect_ratio` + `seconds`（"4"–"12" 字符串） |
| 生成模式 | 单一（文生/图生靠 image 字段） | `mode`: text / keyframe / reference（首尾帧、多图、音频参考） |
| 任务查询 | `/agnesapi?video_id=`（可不带 model_name） | **必须带** `model_name=agnes-video-2.5-flash`（keyframe/reference 不带查不到） |
| taskId 字段 | id / task_id | video_id（官方推荐）/ id / task_id |

## 5. 交互逻辑与显示项

### 5.1 模型设置页（ModelProviders.vue）
- 「多模态模型」分组下出现卡片 **Agnes-AI**，能力徽章显示：`文字推理`、`图片生成`、`视频生成`（复用 `MULTIMODAL_CAPABILITY_LABELS`）；
- 「按能力设置默认」开关：开启后可分别把 llm / image / video 默认路由到 Agnes-AI（`capability_defaults` + `capability_enabled`，video 能力默认关闭、需显式开启——沿用既有交互）；
- 模型列表显示 3 个模型 ID；编辑 API Key 后启用；
- 与既有 `agnes-llm` / `agnes-image` / `agnes-video`（国际站）卡片并存，互不影响；用户可按需禁用旧卡片。

### 5.2 能力选择器与流水线路由
- `manager.listProviders('llm'|'image'|'video')` 会把「已启用且声明该能力」的 Agnes-AI 并入对应选择器（video 受 `capability_enabled.video` 开关控制）；
- 未显式选择时 `manager.getDefault(type)` 按 `capability_defaults` 路由，回退类别默认——多模态路由逻辑全部复用，无特殊分支；
- 流水线报错与通知中的服务商显示名：`agnes-multimodal → 'Agnes-AI'`（provider-name-map.js）。

### 5.3 提示文字（用户可见）
| 场景 | 文案/来源 |
|------|----------|
| 服务商卡片名 | `Agnes-AI` |
| 能力徽章 | `文字推理` / `图片生成` / `视频生成`（既有 locale 标签，无新增文案，不触发 locale 成对修改门禁） |
| 缺 API Key | `apiKey is required`（validateConfig，测试连接失败时展示） |
| 视频提交 4xx | 服务端 message/detail 原样透传（如 `size must be 720P`），经 provider-error 包装后由 pipeline-error-formatter 显示 `Agnes-AI` 前缀 |
| 队列满载/限流 | 503/429 自动重试，不向用户报错；重试耗尽后报最后一次错误 |

## 6. 数据与安全

- API Key 存储沿用 `model_providers.api_key_enc` 加密链路（`_migrateApiKeyEncryption` 既有机制），不落明文；
- 官方要求：不得在前端代码、日志、公开仓库暴露 API Key——本预设仅存配置，不硬编码；
- 视频参考媒体 URL 必须公网可访问（Agnes 服务端拉取），本地文件路径不适用（与旧版一致，由调用方保证）；
- 中国站端点为公网域名；本机 fake-IP 代理环境若触发 SSRF 守卫误报，参照 01-docs/BUGFIX-SSRF-FETCH-MODELS-FAKEIP-2026-09-16.md 的两条放行路径处理。

## 7. 测试与验证

- 新增 `agnes-multimodal.test.js`：23 用例全绿（构造/校验/委托/视频 v2.5 请求体契约/重试/状态查询/预设契约）；
- 回归：model-provider-seeds / model-provider-multimodal / agnes-llm / agnes-image / agnes-video / resolve-default / pipeline-error-formatter / provider-anomaly 全绿；
- `model-provider-multimodal.test.js` 一处索引断言修正（`listProviders('multimodal')[0]` → 按 id 查找），因新增第二个多模态预设后索引假设失效；
- `asset-generator.test.js` 5 个失败经 main 对照确认为存量环境依赖失败（edge-tts spawn），与本次无关。

## 8. 后续可选项（非本次范围）

- 运营后台（ops-center）预设目录同步 `agnes-multimodal`；
- 流水线 storyboard 支持首尾帧（keyframe）与音频参考（reference）模式透传 UI；
- 既有国际站三个 Agnes 预设的弃用评估（观察一段时间使用量后再定）。
