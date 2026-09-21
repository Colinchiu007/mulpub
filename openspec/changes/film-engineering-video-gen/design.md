# Design: 电影工程流水线扩展——分镜视频生成与成片合成

## Context

电影工程现状：`pipeline-engine.js` 注册 4 阶段（film_load_template → film_adapt_script → film_select_shots → film_export_prompts，全部 `checkpointRequired: false`）；`FilmEngineeringView.vue` 三栏页面直连 `film-engineering-service.js`（IPC `withSenderCheck` + event-first 转发合同）；「勾选生成图片」走 `assetGenerator.generateImage` 的 service 直调模式（`MAX_GENERATE_BATCH = 20`，部分失败标 `partialFailure`）。视频侧既有基础设施：`videogen-stages.js` 的提交→轮询（10s 间隔、10min 上限）→下载范式与 FFmpeg concat 拼接；`model-provider-manager.getDefault('video')` + adapters 统一 `generateVideo`/`getVideoStatus` 契约；`VIDEO_MODEL_NOT_CONFIGURED` 错误码先例。kit 分镜模型字段为 Higgsfield 平台命名（seedance_2_0 等 4 种），与应用内 adapters 非同名对应。动机见 proposal.md - Why；行为合同见 specs delta。

本设计源自一次 grilling 会话（Q1-Q14 全部落定），下列 Decisions 即其结论的技术固化。

## Goals / Non-Goals

**Goals:**
- 6 阶段流水线贯通：选中分镜 → 成本确认 → 逐镜 mp4 → final.mp4，全链路可在电影工程页面内发起与回显
- 成本安全：批次上限 + checkpoint 双闸，任何路径（含恢复）不可绕过确认
- 提示词保真：直送文本与导出文本逐字符一致，可被 diff 测试证明

**Non-Goals:**
- 不做美学加工（转场/调色/字幕/TTS/BGM）、不做发布接线（二期评估「去发布」跳转按钮）
- 不改 videogen/story2video 既有阶段行为；不做 kit model→provider 映射；不做 refTokens 图生视频
- 不在默认 CI 真实计费调用视频 provider

## Decisions

### D1: 页面发起 + 底层 PipelineEngine（混合形态）
「生成视频」按钮在 FilmEngineeringView 内启动扩展流水线（`pipeline:start` 复用），页面订阅进度事件回显，用户不离开电影工程页。
- 备选 A（纯 service 直调）：实现快但长任务（最坏 10 镜×10min）无 checkpoint/恢复，关页面即悬空——否决。
- 备选 B（纯通用流水线 UI 发起）：用户要在两套 UI 间跳转，且页面已持有选中分镜上下文——否决。

### D2: 成本确认 = `film_generate_videos` 的 checkpoint（`checkpointRequired: true`）
流水线停在阶段入口，等待态 payload 携带逐镜清单+画幅+时长；页面渲染确认卡，advance 继续。恢复路径（resumeFromCheckpoint）天然重过此闸，无绕过。
- 备选（纯 UI 前置弹窗）：恢复路径不经过弹窗，成本闸可被 resume 绕过——否决。
- 这是电影工程首条启用 checkpoint 的阶段链：实现时验证通用进度事件对等待态的透传在该页接线（若 StageExecutor 等待态事件缺字段，补在流水线公共层而不是 film 侧特判）。

### D3: 提示词原文直送，绕过 prompt-engine
`film_generate_videos` 与单镜重试均不触碰 PromptBridge/optimizeVideoPromptsBatch。这是对 `video-prompt-engine` 既有"统一优化"合同的显式豁免（delta 已建，含"优化器被调用即违例"负向场景）。
- 理由：Hell Grind 方法论铁律"每次全量描述、逐字粘贴、永不缩写"；优化器会破坏七块结构与 `<<<uuid>>>` 令牌。
- 不留"启用 AI 优化"开关（避免双模式合同与烂片归因）；二期若做仅允许受控的 STYLE 块替换。
- 备选（复用 videogen_generate 全逻辑含优化）：违反保真合同——否决。

### D4: provider 统一 `getDefault('video')`，kit model 仅展示
不建 kit-model→adapter 映射表：seedance adapter 走通用网关，与 Higgsfield 原生 seedance_2_0 参考图协议不同，映射了也复刻不出同款；且逐镜 model 路由会把"未配置某 provider"变成逐镜失败源。未配置 → 阶段 fail-closed `VIDEO_MODEL_NOT_CONFIGURED` + 跳模型设置引导（与图片生成的既有引导同构）。

### D5: 参数提交合同
- 画幅：`16x9`（默认，请求 1280x720 档位）/ `9x16`（720x1280）/ `source`（不下发尺寸参数）；映射为 generateVideo 的 width/height（含 num_frames/frame_rate 双写命名兼容，沿用 videogen 提交载荷形状）。
- 时长：全局 5/8/10s（默认 5s），经既有帧数映射函数换算；不做逐镜时长（剧本套用产物无可靠时长字段，从提示词文学文本猜时长是错误源头——二期在确认卡内提供逐镜微调）。
- 批次：MAX_VIDEO_BATCH = 10（图片是 20；视频按成本与墙钟时间收紧）。

### D6: 逐镜生成实现为 film 侧独立 stage，不直接复用 videogen_generate
契约对齐（提交→轮询 10s/10min→下载 `shot_NNN.mp4`、`mapWithModelBudget` 并发控制、taskId 多字段兼容），但代码独立成 `film-engineering/video-gen.js`：videogen_generate 前置优化调用与场景（scenes）数据结构都不适用，强行参数化会污染两条流水线各自的合同。测试两侧各自覆盖。

### D7: 单镜重试 = service 直调 IPC，merge 信磁盘不信内存态
`film:retryShot`（withSenderCheck + 校验 runId/镜序号归属）单镜提交→下载→覆盖 shot_NNN.mp4，不动流水线状态机。副作用显式消化：film_render 以 run 目录实际产物清单为准（扫描 shot_*.mp4 + 期望序号对齐），解决"流水线记失败、磁盘已修复"的双轨状态。
- 备选（流水线级补件 run）：run 内补件 + merge 重触发状态机复杂度陡增——否决，页面级与既有「生成图片」同构。

### D8: 拼接策略 = 直拷优先，不一致时最小 scale+pad
先 ffprobe 全部片段（codec/宽高/帧率/时基），全一致走 concat demuxer `-c copy`；不一致按目标画幅 scale+pad 重编码后拼接（无转场/调色/音频处理，保留各镜原生音轨若有）。缺任一镜 → fail 并列出缺失清单，绝不输出缺镜假成片。
- 理由：Q2 砍掉的是美学后期；规格归一是工程可靠性。provider 可能无视尺寸参数返回异构片段，纯直拷会在最后一步烧完钱翻车。

### D9: 产物目录 `film-engineering/<runId>/`
沿用 run 目录约定与 `getAllowedMediaRoots` 受控媒体根（不新开白名单路径）；命名 shot_NNN.mp4 / final.mp4；完成后页面给「打开所在文件夹 / 另存」（走既有 shell/showSaveDialog IPC 能力）。

### D10: 测试与 CI 分层
- 单元/集成（默认 CI）：mock `manager.callAdapter` + 本机临时 HTTP 假 mp4 下载源（OPTIMIZE_BATCH 测试合同同款），覆盖：原文 diff 一致、优化器零调用（违例拦截）、批次上限、枚举校验、部分失败清单、checkpoint 等待/advance/恢复重确认、merge 规格预检与缺镜拒绝、重试 IPC 校验。
- E2E（打包真实、不计费）：扩电影工程既有门禁——「生成视频」按钮存在、provider 未配置引导、确认卡渲染、确认前无 provider 调用、选中分镜数组经参数化 IPC 不错位（withKit event-first 历史坑回归）。
- opt-in 冒烟脚本：真实 provider 出 1 镜 5s 片，手动触发，不进默认 CI。
- 视觉回归：FilmEngineeringView 新增区块需补/更新对应像素基线。

## Risks / Trade-offs

- [provider 返回规格与请求不符] → D8 预检+归一兜底；E2E 不计费层不掩盖该风险，冒烟脚本可验证真实规格
- [`<<<uuid>>>` 令牌原样送入模型产生噪音] → 接受为本期已知折损（Q5 决策）；提示词保真优先，二期评估图生视频
- [checkpoint 事件在电影工程页的回显链路未趟通过（该页首次）] → D2 注记：等待态字段缺失补公共层；集成测试覆盖"重启后恢复仍停闸"
- [单镜重试与流水线内存态双轨] → D7 已消化（merge 信磁盘）；结果列表状态以 run 目录扫描为单一来源渲染
- [成本失控] → 10 镜上限 + 确认卡逐镜清单；轮询 10min 硬上限沿用
- [超长 kit 提示词（数万字符）被 provider 截断或拒绝] → 提交失败计入逐镜失败清单可重试，不静默截断；冒烟脚本用最长 kit 分镜验证
- [video-prompt-engine 豁免措辞归档后与 film 合同漂移] → 归档三同步检查 + 两侧 spec 互引场景名

## Migration Plan

纯增量：不改既有 4 阶段行为、不动 videogen 流水线、DB 无迁移。回滚 = revert 单个 PR。老版本 run 记录无新阶段字段，恢复时按既有未知阶段容错处理（若存在历史 film run 快照，就不会被新阶段影响）。locales 成对新增，CI Gate 7 自然门禁。

## Open Questions

- 确认卡是否需要展示各 provider 的单价估算（取决于 ModelProviderManager 是否已有价格元数据）——不影响合同，实现期查证后定展示深度。
- `source` 画幅时是否请求任何尺寸参数（视 adapter 对缺省尺寸的实际行为，冒烟验证后固化）。
