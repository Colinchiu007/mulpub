# Proposal: 电影工程流水线扩展——分镜视频生成与成片合成

## Why

电影工程（film-engineering）流水线目前止步于"分镜提示词包 + 勾选生成 pre-viz 图片"，用户无法在应用内把选定的分镜变成视频成片，"剧本 → 分镜 → 视频 → 成片"的短剧创作链路断在最后一环。应用内视频生成的全部基础设施（provider 适配器统一契约、`videogen_generate` 提交/轮询/下载范式、FFmpeg concat 拼接、`VIDEO_MODEL_NOT_CONFIGURED` 引导）已经存在且经 story2video/videogen 流水线验证，本变更将这条链路接入电影工程，打通端到端。

## What Changes

- 流水线阶段链从 4 阶段扩展为 6 阶段：追加 `film_generate_videos`（逐镜提交默认视频 provider → 轮询 → 下载 `shot_NNN.mp4`）与 `film_render`（按选中顺序拼接为 `final.mp4`）。
- `film_generate_videos` 是电影工程首条启用 **checkpoint** 的阶段链节点（`checkpointRequired: true`）：流水线停在阶段入口，页面渲染成本确认卡（逐镜清单 + 预估），用户 advance 后才继续；恢复路径同受此闸保护。
- 提示词**原文直送**：`<<<uuid>>>` 令牌与七块结构一字不改，不经过 prompt-engine 视频优化（对 `video-prompt-engine` 既有"统一优化"合同建立显式豁免边界）。
- 提交参数：provider 统一取 `getDefault('video')`（kit model 字段仅展示不路由）；画幅用户可选 16:9（默认）/ 9:16 / 保持源规格；时长全局 5/8/10s 可选（默认 5s）；单批上限 10 镜。
- 失败语义：部分成功继续，结果逐镜标注失败；新增页面级**单镜重试** service IPC（不碰流水线状态机）；`film_render` 以磁盘实际产物清单为准，不信任阶段内存态。
- 拼接可靠性兜底：片段规格一致时零损失直拷；不一致时仅做最小 scale+pad 归一到目标画幅（无转场、无调色、无叙事层）。
- 成片落 `film-engineering/<runId>/` 受控媒体根（沿用 `getAllowedMediaRoots` 合同）；页面提供「打开所在文件夹 / 另存」；provider 未配置时 fail-closed 引导跳模型设置。
- 前端：电影工程页操作面板新增「生成视频」发起入口（画幅/时长选择 + 成本确认由 checkpoint 卡承载）、逐镜结果列表与单镜重试按钮；全部文案进 locales（zh/en 成对）。

明确不做（二期清单见 design.md）：转场/调色/字幕烧录/TTS 旁白/BGM、prompt-engine 优化开关、refTokens 图生视频、kit model→provider 映射表、流水线级单镜重试、发布阶段链、CI 真实计费视频生成。

## Capabilities

### New Capabilities

（无——全部为既有能力的行为扩展）

### Modified Capabilities

- `film-engineering`：「film-engineering 流水线阶段契约」Requirement 从四阶段扩为六阶段并新增 checkpoint 语义；新增「分镜视频生成阶段」「成本确认 checkpoint」「单镜重试 IPC」「成片合成与产物合同」Requirements；「IPC 参数校验与 sender 校验」「前端交互契约」Requirement 扩展对应通道与界面行为。
- `video-prompt-engine`：「视频提示词统一经 prompt-engine 优化」Requirement 增加 film-engineering 原文直送豁免边界——通用禁令的适用范围明确为 videogen/Story2Video 生成路径，`film_generate_videos` 阶段的 kit/adapted 提示词直送 provider 不构成违规，且该阶段调用优化器本身即为合同违例（负向用例）。

## Impact

- **electron 主进程**：`apps/desktop/electron/services/film-engineering/`（新增 video-gen/render 编排）、`film-engineering-stages.js` 或同等注册点（新 stage executor ×2）、`pipeline-engine.js`（film-engineering stageDefs 追加）、`film-engineering-service.js`（单镜重试 IPC 承接）、IPC 通道注册。
- **复用不改**：`model-provider-manager`（getDefault/callAdapter）、adapters 的 `generateVideo`/`getVideoStatus` 契约、FFmpeg 拼接范式（参照 `videogen-stages.js`，电影工程侧独立实现避免侵入 videogen 合同）。
- **前端**：`FilmEngineeringView.vue` 操作面板与结果区、`src/locales/zh.js` + `en.js` 成对新增（CI Gate 7 拦截）。
- **测试/CI**：既有电影工程 24 项打包真实 E2E 门禁扩展不计费检查（按钮、确认卡、provider 引导、参数化 IPC）；单元/集成用 mock `callAdapter` + 本机临时 HTTP 假下载源；新增 opt-in 真实 provider 冒烟脚本（不进默认 CI）。
- **数据/成本**：真实调用视频 provider 产生费用，由 10 镜批次上限 + checkpoint 确认闸双重控制。
- **规范**：`openspec/specs/video-prompt-engine/spec.md` 的豁免措辞在归档时同步，防止后续会话把 film 直送当违规"修掉"。
