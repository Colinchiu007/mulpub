# PROJECT-003 Multi-Publish — 视频创作模块 PRD

> **版本**: v1.10
> **日期**: 2026-08-24
> **状态**: 实现基线已更新（持续迭代）
> **产品定位**: 将 OpenMontage 的视频生成能力集成到 Multi-Publish 桌面客户端，实现"创作→渲染→发布"完整闭环  
> **目标用户**: 自媒体创作者、内容运营、企业内容团队  

---

## 一、产品概述

### 1.1 背景

Multi-Publish 已实现 15 个平台的统一发布能力（RPA 驱动），并已在桌面端接入本地视频创作链路。

OpenMontage 资料仍作为能力参考；当前产品的权威实现是 Electron 主进程的
`story2video-compose` 混合编排：Python 后端提供清单和可选外部服务，Electron
`StageExecutor` 负责阶段编排，`Story2VideoComposeEngine` 通过 ffmpeg 生成成片。

旧版“仅移植 Remotion 前端、Python/编排完全缺失”的描述是历史状态，不再代表当前代码。

### 1.2 核心价值

| 价值 | 说明 |
|------|------|
| **零服务端成本** | 利用用户本地算力渲染，无需 ECS |
| **创作→发布闭环** | 一个桌面应用完成从视频制作到多平台发布 |
| **分层渲染能力** | Story2Video 默认走 Electron + ffmpeg；Remotion 提供独立快速渲染，Python `video_compose` 可选 HyperFrames runtime |
| **渐进式能力** | 从简单文字→视频到专业电影感制作逐步解锁 |
| **复用已有资产** | 已发布的图文内容可直接转为视频素材 |

### 1.3 与已有系统的关系

```
Multi-Publish 现有系统（发布侧）
    │
    ├── RPA 发布引擎（已上线 15 平台）
    ├── 账号/Cookie/定时发布（已上线）
    │
    └── ✅ 视频创作模块（本 PRD）
         │
         ├── CreateView.vue（流水线选择、图片轮播全自动编排〔通用 checkpoint 保留〕、历史入口）
         ├── story2video-compose（split → domain_enrich → optimize → generate_assets → compose → publish）
         ├── Electron ffmpeg 合成（字幕、动效、转场、BGM、水印、分辨率/FPS）
         └── PublisherRouter（显式开启且有平台时发布）
```

### 1.4 当前实现基线（2026-07-26）

| 能力 | 当前状态 | 说明 |
|------|----------|------|
| 文案分句 | 已接入（双层） | 场景层优先由 `smart-sentence-splitter` 决定；仅连接拒绝、超时、连接重置等服务不可用错误可降级到本地场景分句，无论桥接层以 reject 还是失败对象返回。字幕层始终在每个场景内部由本地逻辑二次切分 |
| 提示词优化 | 已接入（外部 sidecar；本地真实服务已验收） | **图片**：Multi-Publish 通过 `PromptBridge` 调用 `prompt-engine` 批量优化；平台/风格枚举和数值范围与其 Pydantic 合同一致，结果数量不一致会阻断。**视频（2026-08-12）**：新增 `domain=video` 领域，videogen `videogen_generate` 前批量优化、混合模式视频场景提示词改写后提交 `generateVideo`；结构化 video 字段（shot/camera/motion_intensity/scene_transition/continuity_token）；契约文件 `video-prompt-engine-contract.js` 与图片契约分文件分命名（详见 §3.1.2.2） |
| 历史领域增强 | 已接入 | `contentType=history` 自动识别时代/朝代并生成 `imagePromptSeed` |
| Story2Video 标准模式 | 已接入 | `story2video-compose` 只接受文案；图片、音频、视频素材模式不再属于该流水线 |
| TTS | 已接入 | text 标准模式通过已配置 TTS adapter 生成逐段旁白；edge-tts 优先，ffmpeg 静音音频作为离线降级。生成阶段时长可为估算值，compose 必须以 ffprobe 的真实音频时长生成字幕时间轴并避免截断。结果页仍可替换单段旁白，但上传音频不是该模式的创作输入 |
| 外部模型 Provider | 已接入（外部待验收） | `ModelProviderManager` 已把选择的图片/TTS/STT provider 接入资产链；豆包 App ID 与加密 Access Token 已映射到 adapter。真实凭据、网络和配额不属于本地自动化验收 |
| 图片 Provider 合同 | 已接入 | 使用注册 ID `dall-e`，兼容旧 `openai-image`；Imagen 将数量和宽高映射为 `sampleCount` 与宽高比；远程图片 URL 仅接受 HTTPS，解析结果必须是固定的可公开路由地址；仅已配置且主机名、协议、端口完全匹配的本机 loopback Provider endpoint 可下载；下载响应按流式 25MiB 上限读取，DNS 和远程下载共用 30 秒总预算；ComfyUI 因缺 workflow、轮询和下载输出合同而在 S2V 主链显式失败 |
| 合成 | 已接入 | Electron + ffmpeg；支持按场景多页定时字幕、图片动效、转场、BGM、水印和输出校验 |
| 模板 | 已接入 | 7 个模板预设和自定义模板库；CreateView 可将预设映射到运行参数（不等同于 7 个 Remotion Composition） |
| 发布 | 已接入 | 未选择平台时阶段状态为 `skipped`，流水线进度显示「未选发布，跳过」，不得显示「已完成」；开启发布但缺 router/凭据时失败，不报告假成功 |
| 结果交付/ZIP | 已接入 | 流水线执行完成（前台跟踪或离开页面转后台模式）自动跳转视频预览/结果页；本地播放 URL 由主进程生成，可下载、复制路径、打开目录，并以流式 ZIP 导出 |
| 本地项目历史 | 已接入 | 完成项目按用户隔离持久化，最多保留 100 项；重启后可恢复成片和分段媒体。失败运行断点续作与云历史不在本地合同内 |
| 分段项目编辑 | 已接入 | 结果页支持编辑、排序、删除、替换旁白、图片/视频重试和重新合成；不再把旧项目 `batch` 编辑器列为缺失 |
| 旁白与转录 | 已接入（TTS） | text 标准模式由配置的 TTS Provider 生成逐段旁白并交付完整旁白；上传音频和手动 STT 不属于该模式 |
| 成片裁剪 | 已接入 | 通过 Python `VideoTrimmer` + ffmpeg 真实裁剪；结果页提供双范围控件和区间预览 |
| 创作模式 | 已收敛 | `story2video-compose` 仅保留 `text`；`image/remix/gallery/audio/batch` 不再作为该流水线的创作模式 |
| 媒体安全约束 | 已接入 | text 标准模式只直接接收 BGM（<=15MB）；普通流水线与结果页使用的图片/旁白工具仍执行格式、大小和受控路径校验，不构成 Story2Video 创作模式 |
| 时长约束 | 已接入 | text 标准模式成片 <=50 分钟（默认上限，见 PRD §7.1.25a）；普通流水线/结果编辑使用旁白工具时仍执行总时长和单段时长限制，合成前通过 ffprobe 二次校验 |

运行前提：本地可执行 `ffmpeg`；`8002`（场景分句）和 `8013`（提示词）是外部服务边界。
8002 不可用时允许明确标记的本地场景降级，非法响应仍阻断；8013 不可用时阻断优化阶段。
2026-07-26 已在开发环境通过真实 `PipelineEngine` 六阶段 E2E，但安装包内 sidecar/依赖仍需目标环境验收。
真实多平台发布还需要已配置账号、凭据和
`PublisherRouter`，本地合成测试不等于发布验收。

### 1.5 语义服务维护与交付边界（已确认）

分句引擎和生图提示词优化引擎是与 Multi-Publish 并行维护的两个独立 Python 项目，
不是当前 Multi-Publish npm workspace 内的源码包：

| 项目 | 权威源码与算法 | Multi-Publish 侧责任 | 本地 REST 合同 |
|------|----------------|---------------------|----------------|
| `smart-sentence-splitter` | `D:\Data\projects\smart-sentence-splitter` | 进程生命周期、目录/端口配置、健康检查、错误边界、阶段编排 | `python -m splitter.api.rest_api`；`GET /health`；`POST /v1/split`；默认 `127.0.0.1:8002` |
| `prompt-engine` | `D:\Data\projects\prompt-engine` | 进程生命周期、目录/端口配置、请求字段映射、批量结果数量校验、错误边界、阶段编排 | `python -m prompt_engine.api`；`GET /health`；`POST /v1/optimize`、`POST /v1/optimize/batch`；默认 `127.0.0.1:8013` |

实际调用链为：

```text
StageExecutor
  -> ServiceBus
  -> SplitterBridge / PromptBridge
  -> 本地 Python sidecar REST API
```

`apps/desktop/electron/services/splitter-bridge.js` 和 `prompt-bridge.js` 使用
`SPLITTER_DIR`、`PROMPT_DIR` 指定两个独立项目根目录；未设置时回退到当前工作目录，
因此开发、部署和打包环境必须显式提供正确的目录与 Python 依赖。Bridge 支持
`start()` 启动子进程，也支持 `attach()` 连接已经运行的服务；当前 Electron 正常启动流程
默认调用 `start()`，外部服务模式必须由启动编排明确采用 attach 策略，不能仅因端口存在就
推断两个实现已经被应用内置。

Multi-Publish 中的 `packages/story2video-engine/src/text-segmentation.ts` 是独立的
TypeScript 文本/场景/字幕切分工具，`history-prompt.ts` 是本地领域增强和 `promptSeed`
生成逻辑；Electron 主链使用兼容 CommonJS 实现
`apps/desktop/electron/services/story2video-segmentation.js` 执行字幕二次切分和场景降级。
正常场景边界仍由 8002 决定，8013 仍是提示词优化主链；修改这些本地逻辑不会自动修改两个
Python sidecar 的算法行为。

当前 Electron 安装包的 `files`/`extraResources` 只包含应用代码、配置、Playwright 和
Remotion 资源，不包含上述两个项目源码、Python 运行时或其依赖。因此 8002/8013 当前仍是
独立运行时边界；不能把本地 Bridge 能够 `spawn` 理解为安装包已经完成 sidecar 分发。干净
Windows 安装环境中的 Python、依赖、服务启动和真实接口验收必须单独记录。

**维护决策规则：**

1. 调整正常场景分句算法/模型或 prompt 优化策略、模板、Provider 时，在对应独立 Python 仓库修改、测试、提交和推送。
2. 调整 Electron 启停、端口、超时、错误提示、阶段顺序、UI、参数归一化或结果适配时，在 Multi-Publish 修改。
3. 调整本地字幕二次切分、字幕时间轴或 8002 不可用时的场景降级算法时，在 Multi-Publish 修改，并保证服务正常路径不被本地算法改写。
4. 修改 REST 路径、请求/响应字段、枚举、默认值、错误码或批量结果语义时，必须同时修改两个仓库，并用真实 8002/8013 服务做跨仓库回归。
5. 发布前必须分别确认独立仓库的 commit/分支和 Multi-Publish 的适配 commit；禁止只更新一侧后宣称接口已完成。

---

### 1.6 近期迭代修订记录（2026-08-07 / 24）

> 本节汇总最近多轮针对【视频创作】-【图片轮播】的稳定性、体验与交付修复。
> 详细合同见 `01-docs/PRD.md` 7.1.12-7.1.15 与历史/后台运行章节；本模块 PRD 与总 PRD 以总 PRD 为准。

| 日期 | 范围 | 核心内容 | 主文档 |
|------|------|----------|--------|
| 2026-08-24 | 克隆音色跨运行恢复 + 图片轮播编码预算 | 供应商侧失效克隆音色重克隆成功后，只在当前用户、当前 provider/model 的本地目录中以新 ID 替换旧 ID；仍指向旧 ID 的偏好同步迁移，迁移故障不阻断本次旁白重试。图片轮播 zoompan 单段编码预算纳入 workScale² 工作画布成本，2x→1.5x→1x 每次降档独立重算。PR #1143。详见本节 3.1.4.2、3.1.36 | PRD 3.1.4.2 / 3.1.36 / story2video-voice-recovery |
| 2026-08-21 | 流水线启动前台跟踪 + 独立历史页「已中断」对齐 |
| 2026-09-04 | 历史记录下载视频 + 6 种排序方式 + 重复标题提示 | 详见 `01-docs/PRD-STORY2VIDEO-HISTORY-DOWNLOAD-SORT-DUPLICATE.md`。已完成任务卡片增加【下载视频】按钮（复用 `story2videoSaveAs` IPC）；工具栏增加排序下拉（更新时间/创建时间/视频时长 × 正/倒序，默认更新时间倒序）；相同显式标题的任务在标题右侧显示「有重复标题」标签（renderer 纯函数检测，完整列表范围）。 | 启动流水线后创作页实时轮询展示阶段进度；离开页面自动转后台运行、仅历史可见；重新进入创作页回到全新新建状态（并发门禁不变）。启动/续跑前台语义统一，移除旧「启动即后台」监听机器。独立历史页 CreateHistory.vue 同步「已中断」标签、stale running 规则与紫色样式。详见本节 3.1.35 | PRD 3.1.35 / S2V-PIPELINE-PAGE-UX §5 |
| 2026-08-21 | 发布跳过状态与完成跳转修复 | 未选择任何发布平台时，发布阶段以 `skipped` 收尾（不再误标 `completed`），流水线进度显示「未选发布，跳过」，完成态进度仍为 100%；自动后台运行的任务在创作页仍监听终态，执行完成后自动跳转视频预览/结果页（恢复「完成即跳转」）。回归覆盖引擎快照/进度、StageProgress skipped 渲染、历史卡片阶段状态与结果页跳转 | PRD-video-creation §1.6 / OpenSpec s2v-publish-skip-jump |
| 2026-08-20 | 历史状态语义修订：新增「已中断」状态 | 运行残留 running 快照（应用退出/崩溃/强杀）与 stale-running（>30 分钟无更新）归一化为「已中断（interrupted）」，不再误归「已暂停」；「已暂停」仅保留用户手动暂停与 scene_asset_selection 检查点；run-only 失败记录用快照 params 回填标题与原文案（卡片不再显示流水线名 +「未生成」）；筛选器 7 标签、↯ 图标、紫色系色条/徽章、中断环节提示。详见本节 3.1.34 | PRD 3.1.34 / S2V-PIPELINE-PAGE-UX §5 |
| 2026-08-15 | 长成片合成超时与错误提示 | 下游 ffmpeg concat/xfade/旁白/BGM/WebM/输出校验预算按对应媒体时长动态缩放并设最小值/硬上限；execFile 的 killed + SIGTERM/ETIMEDOUT 归一为阶段超时；新增中英文合成超时、成片总时长和单段时长稳定通知键，错误只展示可操作建议。回归覆盖短片、50 分钟、非法时长、上限和实际阶段传参 | PRD §7.1.25a / 本节 3.1.4.2 / OpenSpec s2v-timeout-notifications |
| 2026-08-14 | 水印四角边距调远 | 用户反馈左上/左下/右上/右下四角距边过近；水平/底部边距 20px→40px、顶部边距 40px→60px（center/moving 不受影响）；`buildWatermarkFilter` 坐标表达式与测试断言同步更新，真实 ffmpeg 渲染回归确认不越界。详见本节 3.1.24 | PRD 3.1.24 |
| 2026-08-14 | 水印坐标修复 + 位置/字号/透明度选项 | 全能创作水印成片不可见修复：根因 `buildWatermarkFilter` drawtext 坐标出画布（bottom-* 用 `y=h-20`、center 用 `y=(h+text_h)/2`，drawtext 按文字左上角定位），自 commit `e1b46eba0`（2026-07-23）引入，保存链路无断点；修复后六位置 + moving 帧级验证可见。新增位置 6 枚举（top-left/top-right/bottom-left/bottom-right/center/moving，moving 为确定性 Lissajous 平滑漂移非随机）、字号 5 档（16/24/32/40/48 默认 24）、透明度 10 档（10%-100% 步进 10% 默认 60%）；normalizer 白名单 fail-closed + compose clamp 二次防线；快照恢复陈旧枚举吸附合法档位；文案 locales zh/en 成对 14 键。详见本节 3.1.24 | PRD 3.1.24 / openspec watermark-options |
| 2026-08-13 | 视频克隆：入口卡 + 默认链接 + 自动复刻层级 | CreateView「流水线创作」新增「视频克隆」标准流水线卡（`[data-pipeline-id="video-clone"]`，紧随全能创作，点击直达 /video-clone）；视频克隆页输入来源默认「链接」（v1.14）；复刻层级下拉移除（v1.15），改为程序按拆解报告证据自动定级 L0/L1/L2（v1.16，驱动 generate/compose 分支 + F4 按层级验收，UI 展示「自动目标层级 → 达成 grade」）；打包 E2E 回捕修复（L0 封面负索引 + E2E 脚本适配默认链接）。详见 PRD-VIDEO-CLONE v1.14–v1.16 | PRD-VIDEO-CLONE-2026-08-12 |
| 2026-08-07 | 模型服务异常检测 | ProviderAnomalyBus（慢响应 llm/tts/audio 30s、image 60s、video 120s；超时/网络错误）→ `pipeline:getRunContext` 下发 `providerWarnings` → 前端非阻塞横幅；`callAdapter` 有界超时（视频 10min/其余 2min）；pipeline-engine 阶段/运行执行日志；提示词优化进度前置 `optimize_progress`。PR #397 | PRD 7.1.12 |
| 2026-08-08 | 提示与反馈规范 | 弹窗标题统一「提示」/「Notice」（去掉「{流水线名} 提示」）；选项保存 toast 改操作栏上方绝对定位（不挤占启动按钮）；媒体校验细分（格式/大小/不可读）+ 文件要求常驻提示（i18n）。PR #398 | PRD 7.1.13 |
| 2026-08-08 | 失败任务历史 | `RunStateStore.listFailed()` + `getHistory()` 合并持久化失败快照（重启后仍显示）；失败状态文案「生成失败」。PR #399 | PRD 历史章节 |
| 2026-08-08 | 视频预览修复 | 媒体服务 Content-Type 补齐图片类型（分段图片显示）；下载统一走主进程 `story2video:save-as`（系统保存对话框）。PR #400 | PRD 7.1.14 |
| 2026-08-08 | MiniMax 异步 T2A | `speech-2.8-*` 异步模型改走 `/t2a_async_v2` → 轮询 → 下载（修复图片/视频/旁白生成阶段整段失败）；资源进度前置 `assets_progress={0/N,0/M}`。PR #402 | PRD 7.1.15 |
| 2026-08-08 | 克隆音色 voice_id 合规 | `cloneVoice` 用 `buildMiniMaxCloneVoiceId` 生成合规 id（长度[8,256]/首字母英文字母）；存量非法克隆标记失效并自动回退默认音色（旁白 0/1 第一层根因）。PR #413 | PRD 7.1.16 |
| 2026-08-08 | 异步 T2A 查询层级 | 官方查询响应 `status/file_id` 在顶层、实现只读 `data.*` 致 90s 超时；轮询改为顶层与 data 双层兼容（旁白 0/1 第二层根因，真实验证 synthesize 13s 成片 20s）。PR #414 | PRD 7.1.15 |
| 2026-08-08 | 场景时长归一（其他会话） | 图片动效归一化到场景时长、移除单图轮播选项、UTF-8 manifest。PR #396 | PLAN-STORY2VIDEO-SCENE-DURATION-2026-08-08.md |
| 2026-08-09 | 视频合成子进度条 | compose 阶段子百分比进度条：引擎 `onProgress` 发射（preflight 0 → validated 3 → 逐片段 3+72·k/N → concat 87 → narration 89 → bgm 92 → webm 95 → verify 98 → done 100）；失败冻结 <100 杜绝假成功；执行器字段级 fail-closed 写入 `context.compose_progress`；前端 mini bar + 「正在合成片段 k/N · p%」/「视频合成 p%」。详见本节 3.1.10 与总 PRD 7.1.9.1 | PRD 7.1.9.1 / 3.1.10 |
| 2026-08-09 | 运行中任务持久化 + 托盘后台运行 | 运行中编排 run 阶段级落盘 running 快照（`saveRunning`）+ 退出兜底 `saveRunningState()`；`resumeOrchestration` 支持 running 快照断点续跑（内存中已运行幂等返回 `alreadyRunning`）；窗口关闭时有运行任务且托盘可用 → 隐藏到托盘后台继续（dev 图标缺失回退内嵌占位图）；历史 running 卡片新增「继续生成」按钮。详见总 PRD 7.1.21 | PRD 7.1.21 |
| 2026-08-09 | 本地克隆音色删除/设为默认 + 媒体导入反馈 | 删除本地克隆音色为本地管理语义：adapter 不支持 `deleteVoice`（如 MiniMax 官方 clone API 无删除端点）时跳过远端删除，直接清理本地 registry 记录/样本/偏好，不再误报「音色克隆服务暂时不可用」；新增 `ModelProviderManager.supportsAdapterMethod` 能力查询。克隆「设为默认」先同步下拉再保存偏好，默认克隆行显示「默认」徽标 + 高亮 + 「已设为默认」禁用态。媒体导入失败提示全部透传类别宾语（背景音乐等），新增 `MEDIA_PATH_UNRESOLVED` 细分（路径解析失败 vs 文件不可读/被占用），主进程复制文件对 Windows 占用做 ≤3 次有界重试。详见总 PRD 7.1.22 | PRD 7.1.22 |
| 2026-08-09 | 窗口关闭行为跨平台化（macOS 前瞻） | 平台决策收敛到 `services/window-close-policy.js`：darwin 关闭窗口不拦截（系统约定，进程留在 Dock、activate 重建窗口）、win32/linux 维持「运行任务+托盘可用→隐藏托盘」；托盘图标按平台回退（darwin 模板图标 setTemplateImage，其余占位图）；快照写入 POSIX rename 原子优先、Windows copy 回退。回归：window-close-policy 6 / window 51 / system-tray 28 / run-state-store 17 测试通过 | PRD 7.1.21（跨平台行） |
| 2026-08-11 | CreateView 历史记录已暂停状态支持 | CreateView.vue historyStatusLabel() 新增 paused 映射、过滤器新增「已暂停」选项、暂停环节提示、断点续跑按钮、CSS 样式。详见本节 3.1.12 | PRD 7.1.24 |
| 2026-08-11 | CreateView 历史记录组件拆分与 UI 优化 | 提取 CreateViewHistory.vue 独立组件、卡片式布局+状态色条、运行中脉冲动画、信息分层、失败原因展示、操作按钮分层、记录计数、空状态优化。详见 3.1.13 | PRD 7.1.25 |
| 2026-08-12 | 语音生成器默认多模态 TTS + 克隆自动保存/重命名 | 模型设置保存支持 TTS 能力的多模态模型（MiniMax `minimax-multimodal`）时，图片轮播「语音生成器」默认选中该多模态模型并按 `capability_models.tts` 带出语音模型（用户显式保存的选择优先）；选择本地音频文件后自动保存为克隆音色（默认名「音色001/音色XXX」递增），移除底部「名称输入 + 添加克隆音色」操作框，克隆列表新增「重命名」行内编辑（新 IPC `tts-voice-clone:rename`，仅更新本地 registry 展示名）；`minimax-multimodal` 克隆样本限制与 `minimax-tts` 对齐（单文件、10s–5min、≤20MB）。详见总 PRD 7.1.4 | PRD 7.1.4 |
| 2026-08-12 | 视频提示词统一走 prompt-engine video 领域 | videogen `videogen_generate` 前批量优化（数量/空项 fail-closed）、混合模式视频场景提示词改写、结构化 video 字段、契约文件 `video-prompt-engine-contract.js`（与图片契约分文件分命名）；详见 §3.1.2.2。PR #548 + prompt-engine #18 | PRD 7.1.33 |
| 2026-08-11 | CreateHistory.vue stale running 检测 | 独立历史页面 loadPipelines() 新增 stale running 检测（30 分钟阈值），与 CreateView.vue 一致。详见 3.1.14 | PRD 7.1.26 |
| 2026-08-11 | usePipelineHistory composable 提取 | 消除 CreateView/CreateHistory 历史记录逻辑重复，统一 stale 检测、轮询、辅助方法。详见 3.1.15 | PRD 7.1.27 |
| 2026-08-11 | CreateViewHistory 卡片 UI 增强 | 状态图标、运行脉冲、进度条光泽、流水线标签、状态阴影。详见 3.1.16 | PRD 7.1.28 |
| 2026-08-11 | failed 任务统一显示为已暂停 + UI 增强 | failed 状态统一转为 paused、暂停环节推导、阶段进度显示、筛选器优化、CSS 增强（左侧色边框/暂停脉冲/卡片圆角）。详见 3.1.17 | PRD 7.1.29 |
| 2026-08-11 | 视频创作模块 UI/UX 深度优化 | 视图切换胶囊化、流水线卡片悬停增强、返回按钮/详情头部卡片化、输入框聚焦效果、配置区展开动画、操作栏阴影、模式切换胶囊化、历史记录 fadeIn 动画/工具栏卡片化/状态徽章大写/时间图标、响应式断点。详见 3.1.18 | PRD 7.1.30 |
| 2026-08-11 | failed 状态保留原始值 + 暂停环节显示修正 | failed 不再统一转为 paused，保留原始状态；前端区分执行失败和已暂停；新增 historyStatusClass()；筛选器新增执行失败；失败提示显示 pausedStage；卡片 hover 增强。详见 3.1.19 | PRD 7.1.31 |
| 2026-08-10 | 历史记录已暂停状态 + UI 优化 | 后端 getHistory() 持久化 running 快照自动转为 paused 状态并记录 pausedStage（暂停环节名称）；前端历史记录流水线卡片重构：状态徽章前置、卡片左侧状态色条（running 蓝/failed 红/paused 橙/completed 绿/cancelled 灰）、运行中脉冲动画、暂停环节提示「暂停环节：xxx」、失败状态提示；openPipeline() 支持 paused 状态跳转恢复；CSS 全面优化（间距、圆角、字号、hover 效果）。详见本节 3.1.11 | PRD 7.1.23 |
| 2026-08-13 | 流水线矩阵文档 | 新增 [PIPELINE-MATRIX.md](./PIPELINE-MATRIX.md)：14 条流水线 × 阶段 × 执行引擎 × 可用性 × 供应商要求总览，含 JS stageDefs 与 Python YAML manifest 阶段命名漂移基线（§6）。commit f51bb852 | PIPELINE-MATRIX.md |
| 2026-08-13 | 流水线【后台运行】按钮 | 运行中流水线可一键转后台：前端脱离（停止轮询 + 恢复初始化），run 在主进程继续执行、仍占并发槽位；历史记录「运行中」可点击重挂；轮询竞态守卫（runId 快照）；检查点等待态禁止转后台。详见总 PRD「视频创作后台运行与并发合同 §3a」 | PRD 后台运行合同 §3a |
| 2026-08-19 | 流水线启动/断点续跑统一自动后台 | 运行中的编排任务不再依赖【后台运行】按钮：启动成功即停止 renderer 轮询、恢复创作页初始态并刷新历史；历史卡片【继续/从断点继续】恢复到 running 时留在历史后台执行；scene_asset_selection paused 仍进入素材选择交互；runId 类型、并发占槽、取消不调用和旧轮询响应丢弃均有回归保护。详见总 PRD「视频创作流水线启动即后台运行 §3a」 | OpenSpec s2v-pipeline-always-background-run |
| 2026-08-13 | 生成阶段三路并行 + 阶段改名 | **图片/视频/旁白并行生成**：非视频场景图片与 TTS 旁白在阶段启动时立即并行；AI 视频有界并发（请求值默认 2，受 provider 每分钟预算收敛）同步生成；视频失败场景在视频结束后补生成图片（`assets_progress.imagesTotal` 动态纳入，先更新计数再启动补图）；进度展示「图片 a/b · 视频 c/d · 旁白 e/f」（纯图模式回退「图片 a/b · 旁白 c/d」）。阶段名「生成图片与旁白」→「图片/视频/旁白生成」（zh）/「Generate Images/Videos/Voiceover」（en）。PR #717 | PRD 7.1.9.x |
| 2026-08-13 | 阶段进行中信息反馈颗粒度统一方案 | 整体梳理 14 条流水线各阶段「进行中」反馈现状：仅 compose/generate_assets/optimize 有子进度，其余阶段运行中无细节；提出统一 stage.progress 契约 + StageExecutor onProgress 通道 + UI 去特判 + 分期实施。详见本节 3.1.23 与总 PRD 7.1.9.3 | PRD 7.1.9.3 / 3.1.23 |
| 2026-08-13 | 阶段进行中信息反馈颗粒度统一实施 | stage.progress + stage.summary 统一契约（getRunSnapshot 下发，与 context.stage_progress 双写）；StageExecutor onProgress 通道 + normalizeStageProgress 校验；publish/finalize_assets/split/optimize 运行中/LLM 阶段逐项接入；StageProgress 去特判通用渲染 + 总进度加权。测试 8 文件 411/411 + Vite build + 打包冒烟通过。PR #756 | PRD 7.1.9.3 / 3.1.23 |
| 2026-08-13 | 阶段进度实时推送 + 快照裁剪（Phase 3） | `pipeline:update` 实时事件推送（500ms 节流合并、终态立即发送）+ `getRunSnapshot(runId, { progressOnly })` 轻量快照（不含 context）+ preload `onPipelineUpdate`（可取消）+ CreateView 事件驱动更新 + 3s 轮询兜底重置。测试 6 文件 659/659 + Vite build + 打包冒烟通过。PR #770 | PRD 7.1.9.3 Phase 3 |
| 2026-08-17 | 全流水线阶段反馈覆盖 | 所有视频创作流水线统一采用开始（0%）→可计数子项→完成（100% + 摘要）反馈；`messageKey`/`summaryKey` 由 zh/en locale 渲染，原始文案仅作兼容降级；Story2Video、explainer、talking-head、cinematic、clip-factory、documentary、localization-dub、podcast-repurpose、videogen 与 framework-smoke 均已接入。详见 3.1.23 | PRD 3.1.23 / OpenSpec pipeline-progress-feedback-coverage |
| 2026-08-13 | 视频创作首页卡片 UI：多列动态布局 + 内置静态背景 + 交互动效（方案 B） | `/create` 流水线选择视图容器放宽至 1600px + 显式 1-5 列断点；背景图由免费生图模型 Pollinations(flux) 一次性预生成 15 张（1024x576 JPEG，统一风格 + 主题意象）并提交仓库静态资源 `apps/desktop/src/assets/pipeline-card-bg/`；前端 `PipelineSelector` 直接引用静态映射，双层暗色遮罩 + 浅色前景保证可读性，渐变兜底 + 入场/悬停动效 + reduced-motion + ARIA；**彻底移除运行时生成链路**（主进程服务/IPC/preload/api/缓存/loopback 全部删除，不调用任何生成 API、不访问网络）。详见本节 3.1.24 | PRD 3.1.24 |

| 2026-08-14 | 全能创作 BGM 素材库管理 | 背景音乐升级为设备级素材库：添加（自动入库 + 选中）/ 重命名 / 删除，下拉选择，历史路径兼容；主进程 `story2video-bgm-library` 服务 + 4 个 IPC 通道 + PUBLIC_CHANNELS；详见本节 3.1.25 | PRD 3.1.25 |
| 2026-08-14 | 视频任务编辑页场景多素材与再次合成（初版，已由 2026-08-20 四视觉卡修订） | 初版每个场景 3 个素材身份（图1/图2/视频）+【生成新图】【生成视频】【再次合成视频】；后续在附录 A 固化为 4 个视觉卡、3 个持久化身份；其余生成、选择和重合成流程沿用。 | PRD 3.1.26 / openspec s2v-history-multi-materials |
| 2026-08-15 | 视频提示词引擎 Round3 B/C：跨镜承接状态包 + 导演分镜块骨架 | **Batch B**：`prev_final_frame`（≤1000 字符，句末截断）链式承接上一镜计划终态；`HIGGSFIELD_FMT_V4` 缓存盐（key 含 prev_final_frame 哈希）；连续性 advisory 评分 -5（英文实体 ≥40% + 角色名硬判据 / 中文白名单 ≥60% 或整句重合 ≥0.5）；Story2Video 视频提示词按场景串行优化、媒体生成保持并发、计划终态回写 scene.video.final_frame、checkpoint 终态恢复链、断链显式 degraded。**Batch C**：refined 12 块导演骨架（SCENE NOTE…FINAL FRAME，值 ≤4000，白名单）；FAIL CHECK 仅指令不出现在输出；尾行清理只认完整 trailer 尾段；块覆盖度 ≥0.8（advisory -5）；7 条 lock-gated 规则默认启用 dead_center/exposure_break/eye_line，否定感知（not overexposed / no waxy skin 不判罚）。详见本节 3.1.27 | PRD 3.1.27 / openspec higgsfield-round3b-cross-scene + higgsfield-round3c-refined-output | | 每个场景 3 素材槽（图1/图2/视频）+【生成新图】【生成视频】【再次合成视频】；流水线完成后可从详情页继续生成/选择素材并重新合成；manual 模式 saveRun 富化候选素材；`_scenesForCompose` 按选中态映射（缺失选中态保留遗留语义）；详见本节 3.1.26 | PRD 3.1.26 / openspec s2v-history-multi-materials |
| 2026-08-16 | 历史记录场景 AI 视频重新生成（W4 闭环） | 完成 3.1.29 的 W4 真缺口：结果页新增【生成 AI 视频】，以分段 videoPrompt（缺省回退 prompt/text）为提示词复用流水线 stages 契约（generateVideo→轮询→下载校验），成功替换分段 videoPath/videoMeta、失败保留旧视频回写 failed；IPC/权益/preload/api/locales/通知归一化全链路补齐；详见本节 3.1.29.1 | PRD 3.1.29.1 / openspec s2v-history-ai-video-regen |
| 2026-08-15 | 历史记录场景内容编辑/重新生成与整片重合成 | 已完成任务每个场景可修改文案/字幕块/视频优化词/语音设置（updateSegments 白名单透传 + 限长收敛，voiceSpeed/Pitch 收敛 [0.1,10]），重新生成字幕（本地重切清空时间轴、重置失败态与来源标记）/旁白（TTS 失败回滚保留旧音频 + 回写 failed）/图片与视频优化词（image 重写 prompt 清翻译、video 写 videoPrompt），配合既有【生成新图】【生成视频】与【重新合成】完成整片重合成；voiceSpeed 收敛 [0.5,2]、voicePitch 收敛 [-12,12]（与流水线契约对齐）；同项目写串行队列防并发覆盖；compose 回显缺省时 videoPrompt 按原值回填；历史卡片新增【编辑】入口并进入视频任务编辑页；详见本节 3.1.29 | PRD 3.1.29 / openspec s2v-history-scene-edit-recompose |
| 2026-08-16 | 视频提示词优化长度放宽（已实现） | 用户诉求：图片提示词上限放开后（PR #887），视频提示词优化也希望长度尽量放宽，避免长提示词被截断；方案沿用域级模式——Story2Video 域显式 max_length（流水线 stageDef/文本配置默认 + 各入口显式携带），共享 kernel 默认 500 与视频 legacy 8020 契约不变，执行器契约 [50,2000] 收敛不放松；PM 已确认放宽诉求；历史重生成视频优化词显式顶格（max_length=20000，8020 standalone [200,20000] / 8013 legacy [50,2000] 由契约 builder 各自收敛）。详见本节 3.1.29.5 | PRD 3.1.29.5 / openspec s2v-history-video-maxlength |
| 2026-08-16 | 视频任务编辑页图片提示词完整展示 + 未保存修改离开守卫 | 视频任务编辑页完整显示场景旁白与画面提示词（不再以 60 字符截断）；历史卡片预览仍为 120 字符摘要；编辑页新增「有未保存修改」标识与离开确认（保存并离开 / 不保存离开 / 取消），保存成功才放行、失败留页；明确保存语义为【保存分段】手动持久化 + 生成/重合成前自动保存；详见本节 3.1.29.3 | PRD 3.1.29.3 / openspec story2video-history-scene-prompt-persistence |
| 2026-08-18 | 页面名词统一与术语同步 | 统一使用「流水线启动页」术语（流水线创作视图中选择流水线后进入的页面）；注释、模板、i18n 同步更新。 | PRD 3.1.31 |
| 2026-08-18 | 历史记录卡片信息增强 | 历史记录卡片显示发布标题（回退到原文案前 60 字）；元数据区新增流水线名称显示；统一各状态标签下的卡片 CSS 样式。 | PRD 3.1.31 |
| 2026-08-18 | 页面导航箭头 + 返回按钮优化 | 视频创作页面顶部新增左右箭头按钮（历史导航）；流水线详情页「返回流水线列表」改为「返回」，点击后跳转历史记录。 | PRD 3.1.31 |
| 2026-08-18 | 流水线启动页底部按钮居右对齐 | action-bar 新增 `justify-content: flex-end`，启动流水线/恢复默认选项等按钮统一居右显示。 | PRD 3.1.31 |
| 2026-08-18 | 电影工程（film-engineering）流水线合并 | 合并 `codex/film-engineering-hell-grind` 分支：film-kit 资产/分镜库/剧本套用/一键复制/导出；pipeline-labels.js 新增 film-engineering 注册；Electron 主进程新增 film-engineering IPC 服务。详见 3.1.30 | PRD 3.1.30 |
**待真实验收项**（需真实 provider 账号/API，见 `E2E-PENDING.md`）：✅ MiniMax 异步 T2A 成片（2026-08-08 已通过：旁白 1/1、成片 20s）；分段图片/下载交互、失败任务历史展示、provider 异常横幅；真实克隆音色生成成片（待办 C-1，需重新克隆后验证）。

---

## 二、用户旅程

### 2.1 核心流程

```
用户输入（文字文案/主题）
    │
    ▼
场景构建器（自动或手动编排场景）
    │
    ▼
六阶段混合流水线（StageExecutor + Story2VideoComposeEngine/ffmpeg；Remotion 为独立快速路径）

> **视频+图片轮播混合能力（2026-08-11 新增）**：Story2Video 支持「视频增强」模式——AI 只生成最值得动态化的场景片段，其余场景图片轮播，控制成本/额度/耗时。两种模式：`fixed`（成片前段按顺序约 20%-30% 用 AI 视频，默认 25%）与 `ai-judged`（LLM 按场景精彩度选择，总占比钳制在 20%-40% 且 ≤ maxScenes）；`off` 保持纯图片轮播零变化。流水线在 optimize 与 generate_assets 之间新增 `select_video_scenes` 阶段；视频场景片段必须显式携带 TTS 旁白音频（见 PRD §7.1.25 旁白音频合同 W10）。完整的数据校验/流程/交互/提示文字/降级策略/验收标准见 [PRD.md §7.1.25](PRD.md)。
    │
    ▼
预览与调整
    │
    ▼
导出 → 直接进入发布流程（复用现有发布系统）
```

### 2.2 角色与权限

| 角色 | 能做什么 | 心智模型 |
|------|---------|---------|
| **新手创作者** | 输入文字→选主题→一键生成 | "像做 PPT 一样做视频" |
| **进阶创作者** | 选择模式、调整参数、叠加字幕和背景音乐 | "像剪映一样灵活" |
| **专业创作者** | 自定义场景/时长/叠层、选择模板预设和结果编辑；图片轮播仍固定自动执行 | "像 AE 一样精确" |

---

## 三、功能需求

### 3.1 创作模式（P0-P2）

| 优先级 | 模式 | 说明 | 输入 | 底层引擎 |
|--------|------|------|------|---------|
| **P0** | Story2Video 文字→视频 | 输入文案自动生成分镜、图片、旁白和成片 | 多行文本 + 参数 | `story2video-compose` 六阶段 + ffmpeg |
| **P1** | 说话头像 | 上传视频 + 文案，生成带字幕的讲话视频 | 视频文件 + 文本 | 独立 Remotion TalkingHead（与 S2V 主链分开） |
| **P1** | 电影感短片 | 素材视频 → 电影感渲染 | 视频素材 + 描述 | 独立 Remotion CinematicRenderer |
| **P1** | 标题叠加 | 视频 + 图文标题叠加 | 视频 + 标题文字 | 独立 Remotion TitledVideo |
| **P1** | 拼贴爆破 | 多段视频合成拼贴效果 | 多个视频片段 | 独立 Remotion CollageBurst |
| **P2** | 歌词同步 | 音乐视频歌词叠加 | 视频 + 歌词时间轴 | 独立 Remotion LyricOverlay |
| **P2** | 屏幕录制 | 录制屏幕 + 自动标注 | 屏幕操作 | 独立工具链（不属于 S2V 六阶段） |
| **P2** | AI 视频生成 | 文字→AI 生成视频片段 | 描述文字 | 第三方 AI（Hunyuan/Kling 等） |

### 3.1.1 Story2Video 标准模式合同

| 模式/能力 | 当前状态 | 当前合同 |
|-------------|----------|----------|
| `text` 文案成片（外显“图片轮播 / Image Carousel”） | 标准模式 | 分句 → 领域增强（可选）→ prompt-engine → 图片/TTS → ffmpeg |
| `image/remix/gallery/audio/batch` | 排除 | 不属于 `story2video-compose`；普通视频流水线和结果页编辑能力不因此删除 |
| 单图/单段重试 | 已实现 | 项目结果页可重生目标图片并重新渲染单段视频，也可仅重渲染视频；失败会回滚旧媒体并清理本次临时产物 |
| 本地结果交付 | 已实现 | 安全本地播放、下载、复制路径、打开目录、流式 ZIP |
| 合成音频下载 | 已实现 | 完整旁白轨持久化到项目目录并可单独下载；ZIP 同时包含成片、旁白和分段媒体 |
| 本地历史恢复 | 已实现 | 项目按用户隔离存储并限制为最近 100 项；可筛选、打开和删除，重启后仍可恢复完成项目 |
| 成片裁剪 | 已实现 | 结果页选择起止时间、预览区间并调用真实 ffmpeg 裁剪；输出必须是可读媒体文件 |
| 云端历史/分享链接 | 未实现 | 本地 file URL、复制路径和打开目录不是可对外访问的分享链接；失败运行也不支持云端断点续作 |
| 音色克隆/外部 Provider | 部分实现 | 常规 provider 的配置、凭据映射和 adapter 调用已接入；音色目录/偏好与克隆能力须按 provider/model 单独实现和验收，不能以本地静音降级冒充 |
| 会员/视频配额 | 外部产品边界 | 旧项目依赖独立 orchestrator 的 membership/quota；当前仅有通用 entitlement 基础，S2V 未按旧套餐扣减视频配额 |

### 3.1.2 Text 参数合同

| 参数组 | 兼容字段与默认值 | 六阶段映射 |
|--------|------------------|------------|
| 基础 | `mode=text`、`prompt` 必填、`size=720x1280`、`seconds=8` | 创建运行前校验；`size` 映射专属输出，`seconds` 保留为兼容目标时长 |
| 分句 | `language=auto`、`mode=balanced`、`maxSentenceLength=200`、`targetSeconds=6`、`speechRate=1`、`minWords=10`、`maxWords=50` | `split` stage options；发送 8002 前映射到 `SplitRequest.config.sentence_tokenizer/scene`，不得作为会被忽略的顶层扩展字段 |
| 提示词 | `platform=generic`、`style=realistic`、`creativeLevel=5`（1-10，运营受控默认）、`maxLength=null`（启用时 50-2000）、`negativePrompt<=500`、`numCandidates=1`（1-5）、`autoDetectStyle=true`、`context=''` | `optimize` stage options，字段转换为 prompt-engine snake_case；空 `maxLength/context` 不发送，文本上下文转换为 `{ synopsis }`，对象上下文按 JSON 字典透传；图片风格不参与提示词风格回退 |
| 图片 | `style=cinematic`、`effect=zoom-in`、Provider/模型可选 | `generate_assets` 与 `compose` |
| 旁白 | provider/model 绑定的 `voiceId`、`speed=1`、`volume=1`、`pitch=0`（运营受控默认）、`emotion=default` | `generate_assets` 与 `compose`；凭据仍由加密 Provider 管理器持有 |
| 字幕 | `enabled=false`、Noto Sans SC 字体栈、`size=size3`、`style=style1` | `compose`，兼容字号映射后交给 ffmpeg |
| BGM | `enabled=false`、`volume=5`（兼容范围 0-10） | 启用且有受控路径时转换为 ffmpeg `0-1` 音量 |
| 版本/效果 | `generateBase=true`、`generateMerged=true`、`transition=fade` | 至少选择一个版本；场景时长跟随旁白音频，音频时长不可探测时回退默认 6 秒 |
| 输出/发布 | 独立分辨率、FPS、格式；平台、标题、描述、标签、封面可选 | `compose` 与 `publish`，未启用发布时明确 `skipped` |

所有运行参数必须是纯 JSON；归一化器只接受白名单字段并在创建 run 之前拒绝非法值。API Key、Access Token 和 Provider Secret 不得写入运行参数、项目历史或结果清单。

### 3.1.2.4 Story2Video 提示词翻译与视频合成并行（自动/手动模式，2026-08-17）

**目标与范围**：提示词翻译是结果页/历史页的只读增强，不参与图片、视频、TTS、字幕或 ffmpeg 输入。自动模式与分镜素材自选模式均不再让翻译 LLM 阻塞素材生成或候选素材选择；翻译任务统一在视频合成阶段与 `composeVideo` 并行启动，以合成阶段的长耗时覆盖正常翻译耗时。手动模式的候选面板只依赖场景 `index`、候选 `candidateId` 和媒体路径，允许候选生成阶段暂时没有 `promptTranslation`；翻译完成后只回填翻译字段，不改变候选、选择或媒体数据。

**数据合同与校验**：

| 字段 | 类型/限制 | 规则 |
|------|-----------|------|
| `uiLocale` | 字符串，最多 16 字符 | `en`、缺失或空白不创建翻译任务；其他 locale 才进入翻译流程 |
| `prompt_translations_pending` | JSON 对象 | 仅允许 `{ uiLocale, items }`；不得写入 Promise、函数、Error、响应对象或凭据 |
| `items[].index` | 非负整数 | 使用稳定场景序号关联翻译；不按完成顺序、不按过滤后的数组位置回填 |
| `items[].prompt` | 非空字符串 | 从 `optimized_prompt`/`prompt` 读取并 trim；空项被丢弃，不调用翻译 |
| `items[].translation` | `null` 或非空字符串 | 成功结果 trim，最多 2,000 字符；等于原文、JSON 包装文本、代码围栏标记或空白均视为无效 |
| 超时预算 | 每批 25 秒；全任务约 60 秒 | 达到批次/总预算立即降级，不得让可选翻译无限延长流水线 |

**流程与时序**：

```text
自动模式
  optimize ──→ 写入 prompt_translations_pending（不调用翻译 LLM）
      └──────→ generate_assets ──→ compose 开始

手动模式
  optimize ──→ 写入 prompt_translations_pending（不调用翻译 LLM）
      └──────→ generate_assets 候选 ──→ scene_asset_selection checkpoint
                                      └─ 用户确认 index + candidateId
                                          └─ finalize_assets ──→ compose 开始

compose 开始后（两种模式相同）
  ├─ 同时启动 composeVideo
  └─ 同时启动 prompt translation
      └─ 合成成功后等待有限收尾窗口
          ├─ valid → 按 index 回填 segments/scenes
          └─ timeout/error → 保留原 prompt，translation=null，视频仍成功
```

1. `optimize` 只负责生成优化提示词和可序列化 pending payload；自动模式与手动模式的 LLM 调用都不会因翻译增加串行等待。
2. `StageExecutor` 仅对显式配置 `composeParallelTask` 的流水线启用并行钩子，其他流水线不启动翻译；合成失败始终优先返回合成错误。
3. 翻译任务按最多 3 个场景一批处理，单批失败/超时不影响其他已完成批次；已完成项与未完成项均以 stable `index` 保存。
4. 合成成功后，在有界收尾时间内 apply 结果；翻译 apply 失败只写诊断，不覆盖视频结果。合成成功但翻译降级时，`context.prompt_translation_diagnostic` 记录 locale、原因和项目数量。
5. 进程重启、阶段重试或 compose 重试只恢复 JSON 数据：已有非空翻译优先复用，未完成项从 pending 重试；pending 只在所有条目完成时清除，避免超时后丢失重试依据。

**功能逻辑与故障边界**：

- `en` 界面保持现状：不创建 pending，不发送翻译请求，不显示翻译栏。
- 非 `en` 自动/手动模式：翻译不可用、LLM 返回空响应、非法 JSON、响应缺项、网络错误、单批超时或总预算耗尽均 fail-open；原始英文提示词、候选素材、选中素材和成片保持可用。
- 部分成功：有效 index 持久化为翻译，缺失 index 为 `null`；不得用相邻场景或数组序号顶替。
- Compose 失败：返回 ffmpeg/媒体合成真实失败，不因翻译 Promise 成功而伪造视频成功；后台 Promise 绑定 catch，禁止未处理 rejection。
- 断点恢复：不恢复正在执行的 Promise；恢复后按 pending 重新发起有界任务，已完成结果不得被空响应覆盖。

**交互、显示项与提示文字**：

- 优化阶段：自动/手动模式均不新增翻译等待文案；用户直接看到后续素材生成。手动模式候选生成完成后直接进入既有素材选择面板，不显示“等待翻译”阻塞态。阶段清单仍按既有 `pending/running/completed/failed` 展示。
- 手动候选面板：候选选择仍以 `scene.index + candidateId` 为唯一提交合同；`promptTranslation` 缺失不禁用候选卡片、确认按钮或恢复选择。候选面板当前不把翻译作为排序、过滤或选择依据。
- 合成阶段：继续显示既有合成子进度、片段数和耗时；翻译为后台增强，不改变合成百分比，不额外创建第二条进度条。
- 结果页/历史页：非英文且 `promptTranslation` 为非空合法字符串时，在「画面提示词」下方显示只读「中文翻译」/「翻译」；缺失或降级时只显示原始提示词，不显示“翻译超时”、JSON 原文或空占位符。
- 本变更不新增用户操作按钮；不新增“重试翻译”按钮，不阻塞“查看结果”“重新合成”或历史记录加载。后续如需可见降级提示，须另行确认文案和 locale 合同。

**验收标准**：自动/手动模式 optimize 均不调用翻译 LLM；手动模式候选 checkpoint 在无翻译时仍可选择；合成与翻译请求在同一 compose 调用内启动；按乱序 index 正确回填；翻译超时/错误不阻塞成功成片且 pending 可恢复；候选、选择、媒体和 TTS 字段不被翻译 apply 覆盖；英文界面跳过；合成失败不被翻译结果掩盖；上下文快照可 JSON 序列化。

### 3.1.2.1 图片提示词统一走 prompt-engine 合同（2026-08-09 落地）

> 设计（manifest / PRD）与实现长期背离：manifest 与本文档早已声明 optimize 阶段走 prompt-engine，但
> `story2video_optimize` 实现直连默认 LLM。2026-08-09 起实现与契约对齐：**所有图片提示词优化统一经
> prompt-engine（PromptBridge / 127.0.0.1:8013）完成风格检测 → 改写 → 输出校验**，不再直连默认 LLM。

#### 1) 流程（数据流）

```
split（分句）→ domain_enrich（历史内容领域增强，可选）
  → scene_context（场景上下文增强中间层，2026-08-11：读完整文案提取全局故事背景并融合进每个场景，注入时代/地域/角色/道具/风格锚点与时代负面锚点，供 optimize 逐场景携带；详见 PRD-STORY2VIDEO-SCENE-CONTEXT-2026-08-11.md）
  → optimize（story2video_optimize）＝ 逐场景调用 prompt-engine POST /v1/optimize
       ├─ 1. 无实质内容守卫：纯数字/纯符号/过短文案直接透传原文（skipped_optimize=true），不调用服务
       ├─ 2. 请求构造：platform/style 别名归一 + 边界收敛 + auto_detect_style + context
       ├─ 3. 有界并发（默认 3）逐场景请求，瞬态错误有界重试（限流 2500ms×attempt，其他 800ms×attempt）
       ├─ 4. 输出校验 fail closed：error 优先 → 结构（422 detail/非法）→ 内容（空串/超长截断/拒绝文本）
       └─ 5. 结果写回 context.optimize（含 providerId='prompt-engine'、model_used、platform、style、
             detected_categories、candidates），断点续传 optimize_resume 与进度 optimize_progress
  → generate_assets（图片 + TTS）→ compose（ffmpeg）→ publish（可选）
```

#### 2) 数据校验（prompt-engine 请求/响应契约）

| 项 | 规则 | 边界/默认 |
|----|------|-----------|
| `prompt` | 必填非空 | ≤2000 字符（超长截断） |
| `platform` | 枚举 + 别名归一 | 7 项：midjourney / stable_diffusion / dalle / tongyi / yizhang / jimeng / generic；别名 dall-e(-2/-3)→dalle、stable-diffusion(-xl)/sdxl/stability→stable_diffusion、通义万相→tongyi、文心一格→yizhang、即梦→jimeng；非法回退 generic |
| `style` | 枚举 + 别名归一 | 14 项：realistic / cartoon / anime / oil_painting / watercolor / pixel / cyberpunk / fantasy / photography / 3d_render / minimalist / abstract / portrait / landscape；别名 cinematic→photography、3d-render→3d_render；非法回退 realistic |
| `creative_level` | 整数 1-10 | 默认 5；越界收敛 |
| `max_length` | 整数 50-2000 | 默认 300；越界收敛 |
| `num_candidates` | 整数 1-5 | 默认 1 |
| `auto_detect_style` | boolean | 默认 true；style 未指定且开启时省略 style 交由服务端检测，返回 detected_categories |
| `negative_prompt` | 字符串 | ≤500 字符，超长截断 |
| `context` | 字符串或对象 | 字符串→`{ synopsis }`；对象逐层检查敏感键（api_key/token/secret/password 等），命中即拒绝 |
| 输出 `optimized_prompt` | 非空字符串 | trim 后为空 → 阶段失败；超过 max_length → 截断并告警 |
| 输出 `error` | 优先检查 | 非空即失败（服务端配额/业务失败兜底返回原文+error，**忽略 error 会把未优化原文当成成功**） |
| 输出 `detail` | 422 形态 | FastAPI 校验拒绝返回 `{ detail: [...] }` → 阶段失败并展示 msg |
| 输出 `platform/style/model_used/key_source/detected_categories/candidates` | 元数据透传 | 保留到 optimize entry 供日志/后续 UI 展示 |

#### 3) 功能逻辑

- **统一契约**：`story2video_optimize`、通用 `OPTIMIZE`、`OPTIMIZE_BATCH` 三类图片提示词优化路径全部走 PromptBridge，共用 `prompt-engine-contract.js`（枚举/别名/请求构造/输出校验单一来源），杜绝三处漂移。
- **fail closed（服务不可用）**：prompt-engine（8013）未运行/连接失败/超时/配额错误时 optimize 阶段失败并给出可操作错误，**不静默回退默认 LLM，不把原文当优化结果**；瞬态网络错误走有界重试，业务错误（error 非空）不重试。
- **断点续传**：已完成场景结果按 index 写入 `optimize_resume`；重启复用已完成项，只优化未完成项；全部成功后清理。
- **进度上报**：阶段开始即写入 `optimize_progress = { done, total }`，前端展示「共 N 个场景，已完成 X 个」。
- **内容守卫**：纯数字/纯符号/过短文案跳过优化直接透传（避免模型编造）；prompt-engine 返回拒绝文本（cannot generate 等）且有实质内容时回退原文并标记 `optimize_note='llm_rejected_use_original'`；思考块 `<think>` 防御性剥离。
- **依赖**：PromptBridge 启动 prompt-engine（`PROMPT_DIR` 指向安装目录），bootstrap 用 allSettled 容错启动；manifest 契约要求「prompt-engine 未运行时返回明确错误」。

#### 4) 交互逻辑与显示项

| 显示项 | 位置 | 行为 |
|--------|------|------|
| 提示词风格（提示词写法） | 外观折叠区「提示词风格」下拉 | realistic/cinematic/anime/watercolor/minimalist；只控制提示词写法与组织，不替代图片风格 |
| 图片风格（视觉审美） | 外观折叠区「图片风格」下拉 | cinematic/realistic/anime/watercolor/minimalist；进入 generate_assets，不参与提示词风格回退 |
| 创意程度 | 受控默认（表单隐藏） | 版本化默认 5，1-10 |
| 负向提示词 | 高级折叠区「负向提示词」textarea | ≤500 字符，trim 后透传 negative_prompt |
| 平台（目标平台） | 受控默认（表单隐藏） | 默认 generic；后续可按图片生成服务商派生 |
| 阶段清单 | 运行页条目式阶段 | 「文案拆分 / 内容增强 / 画面提示词优化 / 图片/视频/旁白生成 / 合成轮播视频 / 发布（可选）」 |
| optimize 进度 | 运行页阶段详情 | 「共 N 个场景，已完成 X 个」 |
| 错误提示 | 阶段失败/检查点 | 区分「prompt-engine 未运行（检查 PROMPT_DIR / 8013）」「服务返回：<error>」「请求超时」「422：<detail>」「场景 #N 优化失败：<原因>」 |

#### 5) 服务依赖与验收边界

- prompt-engine（`D:\\Data\\projects\\prompt-engine`，FastAPI / 8013）为图片提示词优化的**前置依赖**；本地已可 import 且 `.env` 已配置 LLM/各 provider key。
- 真实优化质量（LLM 改写效果、风格检测准确率、配额）属于**外部验收边界**：单元/集成测试用 mock PromptBridge / 本地 HTTP stub 覆盖契约与 fail-closed 行为，不冒充真实 8013 + provider 验收通过（见 learnings 与 quality-gates 记录）。
`creative_level` 表示创意/细节强度，引擎不会根据文案自动判断该等级。`optimization_strategy` 只允许 `template` 或 `llm`，缺省为 `llm`；`template` 强制图片确定性模板，`llm` 强制使用桌面当前 BYOK 文字推理模型，`auto` 已删除且返回 422；video + template 返回 422。历史记录“重新生成图片优化词”固定 `llm + bypass_cache=true`，因此不会把模板或缓存命中伪装为新生成；结果可用 strategy_used/key_source/model_used/caller/cache_hit 诊断。

### 3.1.2.3 独立视频提示词优化引擎（video-prompt-engine，2026-08-12 规划）

**正式落点**：视频提示词优化引擎已独立为 `video_prompt_engine/`（prompt-engine 仓库，端口 8020），与图片引擎（8013）**完全分离**——独立包/知识库/策略/模型/配置，不 import `prompt_engine.*`。

- 端点：`POST /v1/video/optimize`、`/v1/video/optimize/batch`（≤20、并发 8）、`GET /v1/video/platforms`、`GET /v1/video/keywords`、`GET /health`
- 视频知识库：`keywords_video.json`（7 维度 2059 关键词，源自 img-prompt）+ `seed_video_prompts.json`（结构化种子，源自 awesome-video-prompts 等 7 个开源仓库）
- 策略：generic_video（六要素+Fact-Fidelity）/ seedance（@引用/多模态）；结构化输出 shot/camera/motion_intensity/scene_transition/continuity_token/duration_hint
- 与既有 §3.1.2.2（domain=video 分支，8013）并存兼容；**后续 videogen 集成将切换至 8020 独立引擎**（迁移任务，本版本文档标注，不强制）

### 3.1.2.2 视频提示词统一走 prompt-engine video 领域合同（2026-08-12 落地）

**目标**：项目内所有 AI 视频生成（videogen 流水线、Story2Video 混合模式）的提示词统一经 prompt-engine（8013）`domain=video` 完成改写与输出校验，不再裸传 provider、不再把图片优化提示词直接当视频提示词用。

#### 1) 数据流

```text
videogen：storyboard 场景提示词 → PromptBridge.optimizeVideosBatch（domain=video）→ 数量/空项校验 → callAdapter('generateVideo')
混合模式：select_video_scenes 选中场景 → optimizeVideo 改写 → generateSceneVideo；优化失败 → 该场景回退图片轮播（不中断整线）
```

#### 2) 请求/响应契约（对齐 prompt_engine/models.py video 领域）

- **请求**：`domain=video`（缺省 image 零回归）；`platform` 视频平台枚举（sora/kling/veo/runway/wan/seedance/minimax/hunyuan/cogvideo/ltx/higgsfield/grok/agnes/generic_video）；style/creativeLevel(1-10)/maxLength(50-2000，默认 500)/numCandidates(1-5)/negativePrompt(≤500)/context（对象透传 + 敏感凭据键拦截）。
- **批量契约**：`/v1/optimize/batch` 单批上限 **20 条**（prompt-engine `BatchOptimizeRequest.max_length`，2026-08-12 由 10 上调）；服务端有界并发 8（防 LLM 并发风暴，结果顺序与请求一致）；videogen 场景数 ≤12 单批通过，>20 由调用方分块兜底（videogen CHUNK_SIZE=20）。
- **响应**：`optimized_prompt` 渲染单串（provider 直用）+ 结构化 `video` 字段（shot/camera/motion_intensity 1-10/scene_transition/continuity_token/duration_hint）；`extractOptimizedVideoPrompt` 按 error→detail→空串 fail-closed，字段越界收敛、缺失给默认。

#### 3) 集成点

- **videogen**：`videogen_generate` 前批量优化；场景 ≤20 单批（覆盖 storyboard 上限 12），>20 按 ≤20 分块并合并；结果数量与场景数不一致、含空提示词、8013 未运行或 PromptBridge 未注入 → 阶段明确失败，不静默绕过。
- **混合模式**：`optimizeVideo` 改写后再 `generateSceneVideo`；优化失败按总 PRD 7.1.x 混合语义回退图片轮播（不中断整条流水线）。

#### 3.5) 内容保真：分镜-文案对齐（video-content-fidelity，2026-08-12）

**目标**：让视频画面与输入文案在人物、事件、时代、核心论点上对齐，同时保留"一句话 → LLM 完成整个视频创意"的原始能力。详见 PRD-video-content-fidelity.md / ARCH-video-content-fidelity.md / IMPLEMENTATION-ANALYSIS-video-content-fidelity.md。

**分镜双模式**：storyboardMode 显式参数或 auto 自动判定（段落≥3 或字≥300 或句≥8 → fidelity；字≤80 且句≤2 → creative；其余 hybrid）。

| 模式 | 语义 | 对齐门禁 | context 注入 |
|---|---|---|---|
| creative | LLM 自由拓展创意（原始机制） | 关闭 | 无 |
| fidelity | 按原文保真：人物/事件/时代/核心论点不得改变，关键事件必须有场景 | 启用 | 有 |
| hybrid | 保真主旨 + 允许可视化演绎 | 启用 | 有 |

**段落化**：fidelity/hybrid 下输入文案按空行/句号切分为有序段落，storyboard 每场景绑定 source_paras；全文 >6000 字截断并标记 truncated。

**对齐门禁**：从文案抽取关键实体（内置词典 + LLM 兜底），校验场景覆盖度 ≥ minCoverage(0.8)；不达标带缺失清单重试（≤2 次），耗尽 fail closed（STORYBOARD_ALIGNMENT_FAILED）；空场景 fail closed（STORYBOARD_EMPTY_SCENES）。

**优化 context 注入**：videogen 批量优化请求每项携带 context（白名单键 synopsis/character/setting/character_list/full_text，长度收敛 + 敏感键拦截），prompt-engine 视频策略追加 Fact-Fidelity 指令（不得改变主体身份/时代/事件）。

**对齐报告**：mode/coverage/matched/missing/retries 写入 run 上下文 videoContentFidelity；视觉层评估接口预留（返回 not_implemented，不冒充实现）。

**配置**：story2videoTextConfig.video_content_fidelity（enabled/minCoverage/maxRetries/llmExtractFallback/maxFullTextChars），越界 fail closed（与 scene_context 契约一致）。

#### 4) 验收边界

- 单元/集成测试不依赖真实 8013：mock PromptBridge 覆盖请求命中 domain=video、空/error/数量不匹配失败、结构化字段收敛。
- 真实 8013 smoke 与 LLM key 为外部验收边界：本机新代码实例已验证 MiniMax-M3 返回结构化字段（shot/camera/motion_intensity/scene_transition/continuity_token）；生产 8013 已重启新分支并端到端验证。

### 3.1.4.1 历史记录加载与本地模式合同（2026-08-09 完整落地）

> 覆盖三轮修复：① 未登录历史回退设备级本地命名空间（不再抛「无法识别当前用户」）；② 失败原因映射为可操作建议
> （不再只弹笼统「请稍后再试」）；③ IPC 访问控制层放行本地只读历史通道（真实端到端定位 code:-3 根因）。
> 视频创作历史是**设备本地数据**，未登录不可用属于可用性缺陷；fail-closed 仅适用于账号/评论等跨用户数据域。

#### 1) 流程（数据流）

```
用户打开「视频创作 → 历史记录」tab
  → CreateView.loadHistory() 并行两个只读请求（Promise.allSettled + 5s 竞速超时）：
       ├─ story2video:list-projects   → Story2VideoProjectService.listProjects()（本地 SQLite 项目索引，owner 隔离）
       └─ pipeline:history            → PipelineEngine.getHistory()（本会话内存 run + 持久化失败快照，设备级）
  → 合并：所有任务按有效更新时间倒序（字段优先级与无效值处理见 §3.1.28；按 projectId 去重，项目优先）
  → 未登录（localMode=true）时顶部显示「本地模式」提示条
  → 任一请求失败（code!=0 / 非数组 / 超时 / reject）：
       ├─ 收集失败 message → historyLoadFailureDetail() 按原因映射可操作建议
       └─ 弹「历史记录暂时无法加载」+ detail 建议行（不泄漏内部错误文本）
```

#### 2) 数据校验与边界

| 项 | 规则 |
|----|------|
| owner 解析 | `_ownerSubject()`：store 缺失 → fail-closed 抛「项目存储不可用」；身份解析无有效 sub（未登录）→ 回退设备级命名空间 `__legacy__`；有有效 sub → 按 sub 隔离（`user:<sha256(sub)>:` 键空间） |
| 读写透传 | `getUserSetting/setUserSetting` 显式传 owner（settings-store 第三参），legacy 键为原 key `story2video_projects_v1`，登录键带 `user:` 前缀——未登录读写真正落在本地空间，不静默丢弃 |
| localMode 标记 | `story2video:list-projects` 在 owner 为 `__legacy__` 时返回 `localMode: true`（仅用于提示条展示，不影响数据归属） |
| IPC 访问控制 | 只读历史通道 `story2video:list-projects` / `story2video:get-project` / `pipeline:history` 列入 PUBLIC_CHANNELS，未登录可调用（项目按 owner 隔离、run 历史设备级）；`story2video:delete-project` 等写/敏感通道保持 authenticated 收紧 |
| 已登录隔离 | 登录后项目在用户空间读写；未登录期间 legacy 数据不混入登录用户空间，反之亦然（不串写） |
| 存储不可用 | 保持 fail-closed：明确错误，不静默降级 |

#### 3) 功能逻辑

- **未登录可用**：身份服务启用但未登录（或未配置身份服务）时，历史读写回退 `__legacy__` 设备级命名空间，本地历史可用；已登录按 sub 隔离。
- **失败原因映射**（`historyLoadFailureDetail`，zh/en 双语、主进程中文错误也有 en 兜底）：未登录/登录过期 → 登录引导；本地存储异常 → 重启 + 磁盘检查；加载超时 → 重进历史重试 + 重启；无法识别的原因 → 返回空（不展示内部错误文本，弹窗保留通用文案）。
- **防御**：`ResultView.loadProject` 对 `get-project` code:-3 单独映射登录引导（避免未来收紧时落泛化失败）。
- **竞态**：并发 loadHistory 只保留最新请求（requestId）；进入历史 tab 必触发 loadHistory（localMode 不残留过期值）。

#### 4) 交互逻辑与显示项

| 显示项 | 位置 | 行为 |
|--------|------|------|
| 本地模式提示条 | 历史视图顶部（`data-testid="history-local-mode-banner"`） | 未登录（localMode=true）时显示；已登录/登录态变化后随下次 loadHistory 刷新 |
| 历史列表 | 历史视图 | 全部与状态筛选均按有效更新时间倒序；空时显示「暂无创作记录」 |
| 错误弹窗 | 应用内弹窗 | 标题「提示」+ 通用文案 + detail 建议行（仅当可映射原因时）+ 「知道了」按钮 |
| 空态 | 历史视图 | 「暂无创作记录」（无数据时） |

#### 5) 提示文字（zh / en）

| 场景 | 中文 | English |
|------|------|---------|
| 本地模式提示条 | 当前为本地模式，仅显示本机记录。 | Local mode — showing records on this device only. |
| 历史加载失败（通用） | 历史记录暂时无法加载，请稍后再试。 | History is unavailable right now. Please try again shortly. |
| 失败原因·未登录 | 当前未登录或登录已过期。请登录后重试；未登录时仅显示本机记录。 | You are not signed in or your session expired. Sign in to retry; local records remain available offline. |
| 失败原因·本地存储 | 本地存储异常。请重启应用后重试；若持续出现请检查本地磁盘空间与权限。 | Local storage is having issues. Restart the app to retry; if it persists, check local disk space and permissions. |
| 失败原因·超时 | 加载超时。请关闭后重新进入历史记录重试；若持续出现请重启应用。 | Loading timed out. Close and reopen the history list to retry; if it persists, restart the app. |

#### 6) 安全边界与已知边界

- 只读通道放行不扩大数据暴露：list-projects/get-project 返回面受 owner 隔离（未登录仅见 legacy 空间）；pipeline:history 为设备级 run 历史（不过滤 owner，本地数据），已注释限定。
- 边界：未登录创建的本地项目在登录后不可见（本地单用户通常持续登录或不登录），后续如需「登录后合并本地数据」另行设计；`pipeline:history` 若未来需按会话/owner 过滤，应先收紧通道再实现。

### 3.1.5 图片轮播全自动与多语言显示（P1）

以下是本轮任务的产品与验收合同，**不是**外部供应商能力、打包验证或 PR 已成功交付的声明；相应状态必须以实际
provider 验收、测试和发布证据为准。

`story2video-compose` 是历史、IPC、项目清单和编排使用的稳定机器 ID，**不得改名**。它的产品外显名称必须从 locale
资源读取：默认中文为“图片轮播”，英文为“Image Carousel”。所有已注册流水线的名称、描述、类别、阶段和状态都必须使用同一套
locale key；未知内部 ID 只能安全回退为原始 ID，不能以 slug 标题化伪造英文。

| 需求 | 合同 | 验收 |
|------|------|------|
| 默认语言 | 默认 `zh`，缺失 key 回退 `en`；切换语言后卡片、详情、历史和阶段清单同步更新 | 中英文渲染测试覆盖所有 pipeline registry ID 与六个 Story2Video 阶段 |
| 启动动作 | 创作者确认文案与参数后，按钮统一显示“启动流水线”；Story2Video 固定提交 `autoAdvance=true` 与 `checkpointPolicy='none'` | 从 `split` 连续执行到 `completed`、`failed` 或 `needs_user_input`，不得在 optimize/generate_assets/compose/publish 因默认 checkpoint 暂停 |
| 运行反馈 | 图片轮播只使用“文案拆分、内容增强、画面提示词优化、图片/视频/旁白生成、合成轮播视频、发布（可选）”的条目式阶段清单；显示当前项、完成、跳过、失败或需要处理，**不显示 S2V 百分比进度** | pipeline snapshot 顶层的 `stages` 能准确映射 `completed/running/pending/skipped/failed/needs_user_input`，错误保留可读摘要和取消入口 |
| 无人工检查点 | 图片轮播不暴露 guided/manual checkpoint、继续或推进操作；其他流水线的通用编排能力不因此删除 | 禁止只隐藏按钮却仍让后端因 `checkpointRequired` 暂停 |
| 内容政策耗尽 | `needs_user_input` 是不可在原 run 上继续的用户输入状态，不是人工 checkpoint；用户修改文案后必须取消旧运行并新建运行 | 无 resume/advance 路径、无占位图、无 `allowPartialAssets` 静默成功 |
| 受控默认 | 分句语言默认“自动识别”；音调、并发数和创意强度从图片轮播表单隐藏，只由版本化、可审计、可回滚的受控默认值决定 | 表单不发送用户随意填写的上述工程参数；无有效远程配置时使用本地已测试安全默认值 |

“图片风格”和“提示词风格”不得合并：前者用于图片供应商的最终视觉审美，后者用于提示词优化器的文本表达、组织和指令策略。
两项必须同时保留并有简短差异说明；不得因枚举名称相似而把其中一项作为另一项的回退值。

### 3.1.6 TTS 音色目录、个人音色与偏好（P1/P2）

创作端不再让用户任意输入“音色 ID”。用户先选择已启用的 TTS provider 与模型，再从与该组合匹配的音色目录选择。
目录、能力快照和选择偏好都必须存到**当前用户作用域**的本地 SQLite settings；新建运行恢复“用户 + provider + model”的
合法默认选择，历史项目只读取自己的版本化运行快照，**不得**被上次全局偏好覆盖。

#### 目录、状态、刷新和回退合同

| 数据/状态 | 约束 |
|------|------|
| `providerId` / `modelId` / `voiceId` | 三元组唯一；均须与已启用 provider、模型及能力版本匹配 |
| 内置目录与 adapter 目录 | 优先调用具备能力且已认证的 `ModelProviderManager.callAdapter(providerId, 'listVoices')`；静态内置音色也须规范化入库并带 catalog/version 来源 |
| SQLite 缓存 | 保存非敏感元数据、catalog/capability 版本和 `syncedAt`；有效缓存不重复请求 provider，显式刷新或失效才重新同步 |
| `catalogStatus` | 仅可为 `ready`、`cached`、`refreshing`、`stale`、`unavailable` 或 `unsupported`，并向用户说明当前来源与限制 |
| 刷新失败回退 | 仅可使用仍与 provider/model/capability 匹配的最后一次成功缓存或静态内置目录，并明确为 `stale`/`cached`；没有合法回退时禁用选择并显示错误，禁止伪造列表或接受任意 ID |
| 默认选择 | 每位用户、每个 provider/model 最多一个默认；音色删除、失效或模型不匹配时清除，选择 provider 默认项或要求用户重新选择 |
| 持久化禁止项 | 不得保存 API Key、Bearer token、原始 provider 错误体、原始 prompt、音频字节、renderer 文件路径或 data URL |

#### Provider 能力分层与个人音色

| 能力类型 | 用户体验 | 约束 |
|------|------|------|
| 内置/可列举音色 | provider/model 选择后显示缓存目录；支持时可显式刷新 | 只调用该 adapter 已实现、已认证且经能力注册的 `listVoices`；失败遵循目录回退合同 |
| ElevenLabs 用户克隆 | 仅在 capability 数据和专用 adapter 合同均验证后显示“新增克隆音色”；用户可新增、删除、设为默认 | 只有用户明确授权且远端 `cloneVoice` 成功后，可信主进程才把验证后的样本 `Buffer` 写入 owner-scoped 私有 `userData/voice-clone-samples`；SQLite registry 只保存受限相对目录和 `sampleCount` 等最小元数据，不保存源路径、文件名或音频字节。格式、大小、时长、模型、端点和删除语义由该 provider/model 的版本化 capability 数据驱动，不能统一猜测。**删除语义（2026-08-09）**：删除本地克隆音色 = 本地管理（registry 记录 + 本地样本 + 偏好清理）；仅当 adapter 支持 `deleteVoice`（如 ElevenLabs `DELETE /v1/voices/{id}`）时才先执行远端删除，不支持（如 MiniMax）时纯本地删除，不得报「服务不可用」（详见总 PRD 7.1.22）。 |
| Doubao provider personal slot | UI 明确提示用户先到供应商官方控制台创建/管理音色，再点“刷新音色目录”；只有存在官方 API 证据和已验证的 `listVoices` adapter 时才显示并允许选择返回项 | 当前配置和 adapter 的已注册/已验证 TTS 调用合同**不证明**个人槽位已同步到本地；本任务不创建、本地复制或伪造槽位。证据或 adapter 缺失时显示 `unsupported`/`unavailable`，不显示假列表 |
| 不支持克隆 | 仅可选择内置/本地模型音色，并说明不支持个人音色复制 | 不出现上传入口，不把用户文件伪装为音色 |

新增、删除、默认切换和目录选择都必须以当前用户、provider/model 能力和活动运行引用为边界。克隆样本受控持久化仅发生在
`consent=true`、远端 `cloneVoice` 成功和可信主进程完成样本校验之后：目录必须是
`userData/voice-clone-samples/<owner-hash>/<storage-id>`，registry 的 `sampleStorage` 只允许
`relativeDir` 与 `sampleCount`，不得加入源路径、源文件名、绝对路径、data URL 或样本字节。删除按
`active → pending → remote_deleted → 本地清理 → 移除 registry` 推进；本地清理失败时保留 `remote_deleted` 供重试，且重试只做本地清理，
不得重复删除远端音色。删除仍需记录最小化的审计结果并处理活动运行引用；clone 元数据与选择持久化不构成在授权范围外保存样本的授权。

### 3.1.7 图片内容拒绝恢复（P1）

图片 provider 的内容政策拒绝不应使整批任务无解释失败，也不得以占位图伪装为真实生成。系统**仅**对可识别的内容拒绝执行受控恢复：
结构化 `CONTENT_POLICY` 代码，或与该 provider 明确安全/政策字段对应的严格允许信号。认证、限流、网络、超时、非法配置、空响应和未知
4xx/5xx 一律不进入内容重写循环。

1. 每个场景独立进行，最多 **5 次总图片生成尝试**（首次加最多 4 次安全化重写）；并发场景之间不得共享计数或 prompt。
2. 重写器仅消除可能的暴力、性化、仇恨、违法、有害或可识别个人细节，不扩大主题，并保留安全的主题、时代、动作和构图；内容信号不明确或重写失败时立即停止自动尝试。
3. 每次尝试只持久化场景序号、尝试序号、结果类别、provider/model、提示词版本哈希和非敏感安全审计摘要；UI 与持久化记录都不得展示原始 prompt、密钥或完整 provider 错误体。
4. 第 5 次仍被明确拒绝时，阶段状态为 `needs_user_input`，显示“可能存在内容风险，请修改文案后重新启动”的友好建议。用户必须取消旧 run，以修改后的文案创建新 run；不得 `resume`/`advance` 原 run，不得生成 ffmpeg 占位图，`allowPartialAssets` 也不得把它静默视为成功。
5. **编辑直达（2026-08-30）**：内容政策检查点暂停时，进度弹窗右上角关闭按钮可点击（关闭=取消任务并关闭弹窗，作为已取消/失败处理，不后台化）；底部操作条显示【编辑场景】按钮，点击后取消当前 run 并跳转 `/create/result?project=<projectId>&focusScenes=<受影响场景号>`，结果页自动定位并高亮受影响场景，用户可直接修改对应场景文案后重新生成。`projectId` 来自 `getRunSnapshot` 透传的 `run.projectId`；受影响场景号来自 checkpoint 的 `scenes[].sceneNumber`（1-based）或 `sceneNumber`/`sceneIndex+1`。若缺少可编辑项目（run-only 记录或项目未落盘），不跳转编辑页，仅提示用户到历史记录处理。

### 3.1.8 创作端简化、运营配置与需求来源边界（P1）

创作端默认只暴露用户有意义的选择。音调、并发数和创意强度从默认表单隐藏，执行时使用版本化、受控默认值；分句语言默认“自动识别”。
这些值允许由未来运营配置覆盖，但来源必须可审计、可回滚，并在无法取得有效运营配置时 fail closed 到本地经过测试的安全默认值。

独立运营后台位于 `D:\Data\projects\ops-center`。截至 2026-08-03，未确认 Multi-Publish 与该项目之间已存在可用的
运行时配置分发 API、鉴权或回滚合同；本任务**不接入** OpsCenter，产品、验证和 PR 状态均不得表述为已联通或已交付。
后续必须在独立 OpsCenter 任务中定义版本、授权、分发、回滚和端到端验收后才能接入。

本任务的近期对话审计只记录到 **1 条**包含实质需求的用户消息及 **2 条**图像附件标记；不存在可如实归档为 20 条的用户需求。
用户清单中的第 11 项为空，保持 `TBD`；没有明确文本前，不据此新增功能、数据收集或外部调用。
### 3.1.3 双层分句与字幕同步合同

| 层级 | 权威实现 | 输出与降级合同 |
|------|----------|----------------|
| 场景层 | `smart-sentence-splitter` 8002 | 正常响应的 `scenes` 是图片、视频提示词和逐场景 TTS 的唯一边界；Multi-Publish 不得再次改写。仅 `ECONNREFUSED`、`ETIMEDOUT`、`ECONNRESET`、服务未运行等不可用错误可使用本地场景降级；业务错误或缺失 `scenes` 的非法响应必须失败 |
| 字幕层 | `smart-sentence-splitter` 8002（`config.subtitle`）+ 本地 v1.2.3 镜像 | 每个场景的 `text` 独立切分，目标每页 8-15 字；**词边界感知（v1.2.3）**：无标点切分/平衡切分优先不劈词（`扶余国`/`电视剧`/`复杂`/`空白一片`/`蒙古`/`江南`/`包税人`/`大汗` 等），`no_cut_bigrams` 项按任意长度短语解释，`subtitle_min_chars/subtitle_max_chars/subtitle_timing` 经 stage-executor 透传为 8002 `config.subtitle.min_chars_per_block/max_chars_per_block/time_calculation_method`；8002 在线字幕在归一化层必须先通过顺序连续覆盖与短语边界质量门，未通过时该场景整体回退本地并记录 `fallbackReason`；保护短语完整优先于 `max_chars` 超长配置；三端（Python/TS/JS）逐字一致；字幕不得跨越场景，按顺序拼接后必须等于该场景规范化文本；**语义引导词（v1.2.4）**：`已经`/`依然` 等成词副词优先在副词前切分，5-6 字语义短尾在共享向量 `short_block_exceptions` 声明 |
| 可观测性 | 运行结果与项目清单 | 每个场景持久化 `sceneSource`、`subtitleSource`、`degraded`、`fallbackReason`、`subtitleBlocks` 和 `subtitleTimeline`；`tier_used=tier3_rule` 仍表示经过 8002，只是 sidecar 内部选择规则层，不等于本地降级 |

Story2Video 的 `target_duration/base_words_per_second/speech_rate/min_words/max_words` 必须转换为
8002 实际消费的 `config.scene.target_seconds/base_words_per_second/speech_rate/min_words_per_segment/max_words_per_segment/enforce_sentence_boundary/allow_single_sentence_overflow`；
`max_sentence_length` 同步写入 `config.sentence_tokenizer`。`subtitle_min_chars/subtitle_max_chars/subtitle_timing`
（v1.2）必须转换为 8002 实际消费的 `config.subtitle.min_chars_per_block/max_chars_per_block/time_calculation_method`，
不得作为会被忽略的顶层扩展字段；8002 不可用时本地 v1.2 镜像消费同样的 min/max 参数。字幕页时间轴选项
（字号/样式等渲染配置）只由本地 compose 逻辑消费，不得混入 8002 请求。为兼容 sidecar 现有中文算法，
`min_words/max_words` 名称保留但计量单位是字数/字符数。

字幕时间轴必须在 compose 阶段基于 ffprobe 读取的逐场景真实音频时长生成，不能把
edge-tts 文件大小估算当作最终时长。每个场景的首个字幕从 `0` 开始，字幕区间连续且
不重叠，最后一页的 `endTime` 必须精确等于该场景有效时长；TTS 语速变化导致音频时长
变化时，时间轴按字幕可见字符和标点停顿权重等比例缩放。旧项目没有 `subtitleBlocks`
时，compose 需从场景文本现场生成，以保持重新合成兼容。

当前 TTS Provider 未统一提供词级/音素级时间戳，因此本合同保证“按真实总时长的分页近似同步”，
不宣称逐词精准对齐。未来 Provider 提供可信词级时间戳时，可在不改变场景边界的前提下替换页内分配算法。

### 3.1.4 媒体工具与时长限制

| 媒体 | 格式 | 大小 | 时长 |
|------|------|------|------|
| 图片（普通流水线/结果编辑） | JPEG / PNG / WebP | 单图 <=10MB | 不适用 |
| 旁白音频（结果编辑/STT 工具） | WAV / M4A / MP3 | 单文件 <=50MB | 总计 <=50 分钟；多文件时单段 <=3 分钟 |
| 背景音乐（text 标准模式） | WAV / M4A / MP3 | 单文件 <=15MB | 成片混音以视频结束为准 |
| 输出视频 | MP4 / WebM | 由本地磁盘决定 | Story2Video 成片 <=50 分钟 |

这些媒体工具不恢复 `image/audio/gallery/batch` 创作模式。前端先检查扩展名和文件大小；可信 preload 将用户选择的音频复制到应用临时目录，
主进程再做 canonical path、符号链接、大小和 ffprobe 时长检查。任意磁盘文件选择因此
无需把整个盘符加入白名单。流水线完成、失败或取消时删除导入的临时媒体。

#### 3.1.4.2 长成片合成预算与失败提示合同（2026-08-15）

Story2Video 的 50 分钟产品上限与下游 ffmpeg 执行预算是两个独立边界：前者决定输入是否可接受，后者决定本地处理最多等待多久。下游不得继续沿用面向短成片的固定全片超时。

| 阶段 | 时长基准 | 预算合同 |
|------|----------|----------|
| concat | 当前无损拼接输入片段总时长 | 按时长缩放，短片不低于 60s，阶段上限 30min |
| xfade | 当前转场计划输出时长 | 按时长缩放，短片不低于 120s，阶段上限 6h |
| 旁白合并 | ffprobe 实测旁白总时长 | 按时长缩放，短片不低于 120s，阶段上限 2h |
| BGM 混音 / 输出校验 | 预计最终成片时长 | 按时长缩放，短片分别不低于 120s / 60s，阶段上限 2h |
| WebM 转码 | 预计最终成片时长 | 按时长缩放，短片不低于 180s，阶段上限 6h |

**图片轮播单段编码预算（2026-08-24）**：带 zoompan 动效的图片片段按独立预算执行，estimatedMs = ceil((effectDuration × fps × workScale²) / 10) × 1000；再加 30 秒开销，并将最终预算钳制在 60 秒至 10 分钟。workScale 为 2x、1.5x、1x 时，像素处理量近似按平方增长；因此 2x → 1.5x → 1x 的每次降档重试都必须按自身倍率重新计算预算，不能沿用前一次的过短 timeout。该规则只适用于图片动效编码，AI 视频片段仍按目标分辨率处理。

预算使用 ceil(duration × factor × 1000) + overhead 后再执行阶段上下限钳制；时长缺失或非法时只使用该阶段最小预算，不把未知值伪装成长片。execFile 因 timeout 被终止时，主进程统一返回带阶段语义的 ETIMEDOUT 错误，renderer 再映射到 story2video.compose_timeout。

| 错误类型 | 稳定消息键 | 用户建议 |
|----------|------------|----------|
| 成片或旁白总时长超限 | story2video.compose_duration_exceeded | 缩短文案/减少场景；确认输入大小约束后重新启动 |
| 单段旁白超限 | story2video.compose_segment_duration_exceeded | 拆分过长段落或调整文案后重新启动 |
| 合成阶段 timeout | story2video.compose_timeout | 检查磁盘空间与设备负载，然后从断点继续；仍失败时稍后重试 |

未知技术错误仍使用通用本地化提示；任何错误提示不得展示 ffmpeg 命令、文件路径、stderr、token 或堆栈。

#### 3.1.4.3 合成可诊断日志合同（2026-08-15）

当长视频在 concat 87%-89% 区间停留较久时，系统必须能区分“正在重编码”“FFmpeg 未启动/异常退出”“输出不再增长”“阶段超时”和“输出文件未生成”，而不是只留下单个完成日志。

1. **关联与阶段**：每次合成生成内部 composeId；开始、阶段开始/成功/失败、最终成功/失败都携带该 ID。阶段覆盖片段编码、concat/xfade、旁白合并、BGM、WebM、输出校验和持久化。
2. **FFmpeg 结果**：每个 FFmpeg 阶段记录启动 PID、输入数量、预算、耗时、输出文件 basename 与输出字节数；正常退出、失败、超时（ETIMEDOUT 或 killed+SIGTERM）和“命令成功但无产物”必须是不同事件。
3. **分块合成**：每块记录 level、chunkIndex、totalChunks、输入数、开始/结束/失败；保留 merge_l{level}_chunk_{n} created 兼容文本。超过 10 秒的合并每 10 秒以 INFO 记录输出字节心跳，连续 30 秒无增长以 WARN 标记，确保桌面默认日志级别下可见。
4. **隐私与边界**：日志只记 basename、计数、时长、字节数、PID/退出状态和已清理的 stderr 摘要；不写绝对路径、完整命令、素材文本、prompt 或凭据。首版不解析 FFmpeg progress pipe，因此可定位“是否仍有输出”，但不承诺帧级 ETA 或提升实际耗时。
5. **验收**：一次 87% 长拼接可按 composeId 查到最后一个块、最近输出大小、是否 stalled、最终结果；现有进度百分比和 FFmpeg 参数不变。

### 3.1.9 场景时长与图片动效设计合同（2026-08-08 补充）

#### 分镜目标时长（splitTargetSeconds）语义

- **用途**：文本→分镜切分的规划目标，**不直接决定**成片每场景时长。
- **目标字数公式**：`每分镜目标字数 = splitTargetSeconds × baseWordsPerSecond(3.3) × speechRate(1)`，再夹在
  `[minWords=10, maxWords=50]` 之间；分镜数量 ≈ 文案总字数 ÷ 每分镜目标字数。
- **取值建议**：默认 6 秒（中文实际产出约 4~5 秒旁白）；推荐 4~8 秒；低于 3 秒会被 minWords 打断、
  约 15 秒触达 maxWords=50 封顶后不再增长（10s×3.3×1=33 字，封顶约 15.2s）。
- **与 TTS 的关系**：它是 TTS 时长的**预估器而非控制器**。TTS 实际时长由 Provider、音色、语速、语言共同决定，
  与预估值存在偏差；成片以 ffprobe 真实音频时长为准。

#### 场景实际时长与 defaultSceneDuration

- 每个场景成片时长 = ffprobe 探测的**真实旁白音频时长**（`-shortest` 跟随音频），不承诺强制截断旁白。
- `defaultSceneDuration` 是内部默认 6 秒（UI 不暴露，可被 `params.defaultSceneDuration` 等运行参数覆盖），
  仅在“音频时长不可探测”时作为字幕时间轴与动效归一化的回退（best-effort，不强制 `-t` 对齐以免截断旁白）。
- `perImageDuration`（单画面时长/无旁白场景时长）已随“无旁白/纯图片轮播模式”下线而从
  renderer、normalizer、模板库与 YAML 彻底移除；旧项目历史配置中的该字段被兼容忽略。

#### 图片动效合同（归一化）

- zoompan 必须 `d=总帧数（时长×帧率）`：`d=1` 且输入为单帧静态图时 zoom 状态不累积，动效完全不可见（关键修复）。
- 动效进度按**场景有效时长**归一化：`effectDuration = audioDuration || reportedDuration || defaultSceneDuration`，
  `T = round(effectDuration × fps)`，进度表达式 `min(1, on/T)`；效果是每个场景动效在末帧恰好完成——
  短场景不再“动效没做完被切走”，长场景不再“动效提前定格”。
- zoompan 亚像素采样会造成画面跳动：输入先上采样到 2× 工作分辨率，在 2× 画布执行 zoompan 后再下采样回目标分辨率。
- **工作分辨率上限（2026-08-09）**：中间分辨率长边封顶 3840 且按比例缩放（`computeWorkResolution`）——4K 输出按 2x 原本会产生 7680×4320（8K）中间画布，内存/编码时长爆炸；封顶后 4K 输出中间仍为 3840×2160，1080p 输出中间保持 3840×2160 不变。4K 输出本身受运营开关 `videoCreation.maxOutputResolution` 控制（详见 PRD.md 7.1.20）。

#### 场景时长模式（三层模型，已确认 2026-08-08）

**决策确认**：D1 双视图 + 默认时长视图（底层统一“每分镜目标字数”主控）；D2 最短场景时长 N=6；D3 开关默认关闭。

**现状**：跟随旁白（动态时长，场景长短随 TTS 实际音频）。「分镜目标时长」只是“每分镜字数”的间接换算
旋钮（`字数 = 秒 × baseWordsPerSecond × speechRate`），在有旁白时**不直接控制成片时长**，存在误导。

**三层模型（已实施，Batch 1-4，2026-08-08）**：

| 层 | 旋钮 | 语义 |
|----|------|------|
| ① 分镜粒度（split） | **每分镜目标字数**（`targetCharsPerScene` 主控，默认 20）；UI 提供「目标时长/目标字数」双视图，时长视图按 `baseWordsPerSecond × voice.speed` 反推字数并标注“估算” | 控制旁白内容密度与分镜数量 |
| ② 实际时长（compose） | 无旋钮：ffprobe 真实 TTS 音频为权威，不截断 | 成片真实时长 |
| ③ 节奏下限（compose） | **最短场景时长** `max(音频实际时长, N)` 静音补齐（UI 开关，默认关闭） | 唯一真正控制“展示时长”的旋钮 |

- **已实现（Batch 4）**：「分镜目标时长（秒）」误导性独立旋钮下线，改为**分镜粒度双视图**——
  时长视图编辑时由程序按 `baseWordsPerSecond(3.3) × voice.speed` 反推 `targetCharsPerScene` 并明示“估算，实际以旁白音频为准”；
  字数视图直接主控；两者换算 clamp 到 `[minWords, maxWords] ∩ [1,200]`，与 normalizer 幂等反推一致。
- **已实现（Batch 4）**：「启用最短场景时长」开关（默认关闭，即 `follow-audio`）+ N 输入（默认 6，1..60）；
  开启后提交 `sceneDurationMode='min-duration'` + `minSceneDuration=N`，短旁白场景以静音补齐。
- **保留并新增**「最短场景时长」作为节奏下限；补齐静音时，字幕时间轴、动效归一化、转场统一按
  `effectiveDuration = max(音频实际时长, N)` 计算，保证观感一致（Batch 3 已落地 compose 消费）。
- 已排除：**纯固定时长**（每个场景固定 N 秒）——会导致截断旁白，违反“不承诺强制截断旁白”合同。
- **已实现（Batch 5a）**：语言感知基准语速表（zh 4.5 字/s、en 2.8 词/s、其余含 auto 回退 3.3）——
  UI 估算与提交、normalizer 缺省值同源（renderer/主进程双副本 + 合同测试锁定一致）；
  时长↔字数换算按 `语言基准 × voice.speed` 进行（speechRate 单一来源延续）。
- **已实现（Batch 5a）**：TTS 时长样本采集点——compose 每场景记录真实旁白音频时长（`audioDuration`，
  与补齐后的视频片段 `duration` 分离），流水线 compose 成功后 best-effort 写入本地
  `story2video.ttsSamples.v1`（FIFO ≤500，样本含 language/provider/voiceId/speed/chars/durationSeconds，不存原文），
  为 5b 自适应校准提供数据源。
- **已实现（Batch 5b）**：自适应校准——按「语言 / 语言+provider / 语言+provider+voiceId」维度对 5a 样本滚动求
  实际字/s ÷ 静态基准的中位数系数（≥3 样本启用，冷启动回退静态表）；**en 单位口径（claude 5a W1）由校准自然吸收**：
  校准比基于字符口径，en 样本充足后系数 ≈ 4~5，估算自动纠偏为字/s 语义。
- **已实现（Batch 5b）**：创建页实时预估行——文案输入下方展示「预估分镜数 · 旁白时长区间（±15%）· 成本约 ¥X」
  （图片单价 0.1 元/张、TTS 0.05 元/秒为本地默认常量，标注估算仅供参考；无样本时静态估算并提示「样本积累后自动校准」）。
- ⚠️ 校准消费方说明：自适应校准当前仅驱动**创建页预估显示**；实际切分仍以用户配置的 targetCharsPerScene 为准（不改变成片行为）。
- ⚠️ 已知限制（显示层）：样本按 `split.language` 配置值归档——默认 `auto` 用户的 zh/en 样本会混入 auto 桶（3.3 基准）；
  「en 系数 ≈4~5」仅在显式选择 en 语言时成立；预估行时长与成本随校准自动修正，冷启动/跨语言切换以静态估算为准并提示。

**③ 节奏下限（compose）已实现（Batch 3，2026-08-08）**：

- 静音补齐启用条件（严格）：`sceneDurationMode === 'min-duration'` 且**真实探测到音频**（`audioDuration !== null && > 0`）
  且 `effectDuration = max(音频实际时长, N) > 音频实际时长` 时，才对该场景 `-t effectDuration` + 音频链 `apad` 静音 + 去掉 `-shortest`。
- **探测失败（audioDuration=null）一律走 follow-audio `-shortest` 路径**：不新增、不使用补齐 `-t`/`apad`，不保证节奏下限
  （best-effort；否则会把未知长度旁白硬截断到 N 秒，违反“不承诺强制截断旁白”合同——双模型审查 C1 要求）。
  注意：探测失败且场景携带上报 `duration` 时，沿用既有「`-t reportedDuration` + `-shortest`」上限语义（Batch 3 未改动），
  即补齐 `-t` 绝不会启用，但上报元数据超短时仍可能按上报值裁剪（旧语义，非本次引入）。
- 补齐语义统一：字幕时间轴末页停留到 `effectDuration`、动效归一化按 `effectDuration`、成片时长预检
  （`effectiveRequestedDuration`，上限 600s）计入补齐值，三者与场景循环共用同一 base 公式
  （`probed || reportedDuration || defaultSceneDuration`）；`renderSegment`（结果页单段重试）与 compose 同守卫。
- 补齐段动效帧数 `d = Math.ceil(effectDuration × fps)`（视频轨为 binding 流，向上取整避免尾部缺帧）；
  follow-audio 保持 `Math.round` 与历史一致。
- 旁白导出（完整 narration 音频）始终按原始音频拼接、**不补齐**；`data.duration`（成片）≥ `data.audioPath` 时长为正常现象。
- 行为副作用（预期）：min-duration 使片段变长 → 原本因“片段过短”被禁用的 xfade 转场会被启用；
  补齐静音吸收 acrossfade/amix 的过渡衰减，BGM 不再吞旁白尾音（利好，见 learnings）。

**进一步优化方向（候选，需逐项评估）**：
- voice-aware 估算表 + 真实 TTS 样本回填的**自适应校准**（“字数→实际时长”系数随音色滚动修正）；
- `voice.speed` 与 `split.speechRate` **单一来源联动**（切分估算与实际 TTS 语速一致，避免脱节）；
- 运营后台**实时预估**：文案总字数 → 预估分镜数 → 预估成片时长区间 + 预估成本（图片生成为主要成本）；
- 最短场景时长与 BGM：补齐静音段有 BGM 时自然填充，无 BGM 时接受静音。

### 3.1.10 视频合成子进度合同（2026-08-09）

**背景**：compose 阶段此前仅显示「进行中」+ 耗时；本变更新增子百分比进度条，解决耗时占比最大的合成环节无进度可感知的问题。

**数据契约**：`context.compose_progress = { phase, percent, segmentsDone, segmentsTotal, message? }`
- 引擎 `Story2VideoComposeEngine.compose(assetManifest, options, onProgress)` 新增可选回调（兼容 `options.onProgress`，第三参优先）；发射值经 `normalizeComposeProgressUpdate` 归一化（percent 取整钳制 [0,100]、segmentsTotal ≥1 整数、segmentsDone ∈ [0,total]、phase 非空）。
- 执行器 `StageExecutor.COMPOSE` 将 `options.onProgress` 透传，回调内字段级校验（phase 已知枚举、percent 有限且 [0,100]、计数整数且范围正确）通过后写入 `run.context.compose_progress`；非法值丢弃（fail-closed）。
- renderer 经既有 3s 轮询 `pipelineGetRunContext` 读取（无新增 IPC 通道）。

**阶段权重**：preflight 0 → validated 3 → segments（k/N）3+72·k/N（k=N 精确 75）→ concat 87 → narration 89 → bgm 92（可选）→ webm 95（可选）→ verify 98 → done 100。

**进度不变式**：
1. percent 单调不降、整数 0-100；
2. `percent === 100` ⟺ 合成成功（`code === 0`）；全部失败路径冻结在最后有效值（<100），杜绝假成功；
3. `segmentsTotal` 恒等于场景数（≥1）；
4. 结构为纯原始值对象（IPC structuredClone 安全）；
5. 与 `optimize_progress`/`assets_progress` 并存互不影响；成功后 `context.compose`（结果）与 `context.compose_progress` 同时存在，结果读取仍走 `context.compose`。

**前端展示与交互**：
- compose running 且 percent 合法时，阶段条目渲染子进度条（mini bar，`data-testid="story2video-stage-compose-progress"`，宽 100%/高 4px/`--primary` 填充，0.3s 过渡）。
- 详情文案：`phase === 'segments'` 且 `segmentsTotal > 0` 时「正在合成片段 k/N · p%」（en：`Composing segment k/N · p%`）；其余「视频合成 p%」（en：`Composing p%`）；无 `compose_progress`（历史 run/旧数据/引擎早退）→ 不渲染（安全降级）。
- 文案沿用 `translateWithLocaleFallback` 内联 fallback（`story2video.composeSegments` / `story2video.composeProgress`），不写入 locale 静态文件（规避 i18n 插值陷阱）。

**边界与后续**：失败冻结（片段 ≤75 / 拼接 87 / 旁白 89 / BGM 92 / webm 95 / 校验 98）；N=1 快速 3→75→100；暂停/恢复后 compose 重跑并重发进度；并发 run 按 context 隔离；`renderSegment` 单段重试不写进度。后续演进（v1 不做）：ffmpeg `-progress pipe:1` 段内实时百分比、chunked 拼接段级 onStep 插值。详细合同见总 PRD 7.1.9.1。


### 3.1.11 历史记录已暂停状态与 UI 优化（2026-08-10）

> ⚠️ **合同修订（2026-08-20）**：本节「running 快照归一化为 paused」已废弃——运行残留快照现归一化为「已中断（interrupted）」，仅用户手动暂停与 scene_asset_selection 检查点保留「已暂停」；「暂停环节」文案仅适用于用户手动暂停，中断场景改用「中断环节」。以 3.1.34 为准。

**背景**：此前应用重启后，持久化的 running 快照在历史记录中仍显示为「运行中」，用户无法区分"真正在运行"和"因关闭应用而中断"的任务。同时历史记录列表 UI 过于紧凑，信息层次不清晰。

**一、已暂停状态（后端）**

- **触发条件**：PipelineEngine.getHistory() 从 RunStateStore 加载持久化快照时，若 snapshot.status === running，自动将返回的 status 归一化为 paused（因为应用重启后该任务不再处于运行状态）。
- **暂停环节**：同时从快照的 currentStage 索引计算 pausedStage 字段（阶段名称字符串），记录任务在哪个环节被中断（如 nimate、compose 等）。
- **数据结构**：返回的 persisted 条目新增字段 pausedStage: string | null。
- **不影响的场景**：内存中真正在运行的 run（_runs Map）保持 status: running 不变；已终态的 _history 条目保持原 status 不变；RunStateStore 中的持久化快照本身不被修改（只读投影）。

**二、前端交互与显示逻辑**

| 场景 | 状态显示 | 状态徽章颜色 | 左侧色条 | 底部提示 | 点击行为 |
|------|----------|-------------|---------|---------|---------|
| 运行中（内存中真实运行） | 运行中 | 蓝底白字 | 蓝色 | 「实时同步」 | 跳转 /create 恢复查看 |
| 已暂停（重启后中断） | 已暂停 | 橙底深棕字 | 橙色 | 「暂停环节：xxx」 | 跳转 /create 断点续跑 |
| 生成失败 | 生成失败 | 红底深红字 | 红色 | 「生成失败」 | 跳转 /create 恢复查看 |
| 已完成 | 已完成 | 绿底深绿字 | 绿色 | 无 | 跳转结果页 |
| 已取消 | 已取消 | 灰底深灰字 | 灰色 | 无 | 跳转 /create |

**三、UI 布局重构**

- 卡片结构：状态徽章移至信息区右侧（第一行），阶段标签和提示移至第二行（pipeline-card-bottom），通过分割线视觉分隔。
- 状态色条：卡片左侧 3px 色条，颜色由 `:class="effectiveStatus(p)"` 动态绑定，一眼区分状态。
- 运行中脉冲：running 状态圆点带 pulse-dot 动画（1.5s 周期透明度闪烁）。
- 阶段标签：字号从 11px 增至 12px，padding 从 2px 6px 增至 3px 8px，新增 failed（红）、paused（橙）、cancelled（灰）三种状态色。
- 容器宽度：从 960px 拓宽至 1080px，内边距从 24px 增至 24px 32px。
- 列表间距：卡片间距从 8px 增至 12px。
- hover 效果：新增 translateY(-1px) 微位移 + 加深阴影。

**四、前端核心方法**

- **effectiveStatus(p)**：前端状态归一化方法。后端返回的 status 为 paused/failed/cancelled/completed 时直接透传；当 status === 'running' 时，遍历 p.stages 数组检查是否有 stage.status === 'failed'，若存在则返回 'paused'（表示后端标记为运行中但实际已中断）。所有模板绑定（状态徽章、色条、提示文案、计数器）均调用此方法而非直接读取 p.status。
- **pausedStageOf(p)**：获取暂停环节名称。优先读取 p.pausedStage（后端快照预计算值），fallback 到遍历 stages 数组找到第一个 status === 'failed' 的 stage，返回其 name || stage 字段。用于渲染"暂停环节：xxx"提示文字。

**五、数据校验**

- pausedStage 仅在 snapshot.currentStage 为有效索引且对应 stage 存在时填充，否则为 null。
- stageLabel() 函数对 pausedStage（字符串）调用时走 shortName() 路径（截断 10 字符 + ...）。
- statusLabel() 的 paused 映射为「已暂停」。
- effectiveStatus() 的 running→paused 判定仅基于 stages 数组中是否存在 failed 状态的 stage，不依赖其他字段。
- pausedStageOf() 返回值可能为 null（无失败环节时），模板中通过 v-if 控制提示文字的显示/隐藏。

**五、openPipeline 路由**

- paused 状态与 running/failed/cancelled 同等处理：跳转 /create 页面恢复。
- 由 CreateView.vue 通过 pipelineResumeOrchestration(runId) 执行断点续跑。

**六、相关文件**

- 后端：apps/desktop/electron/services/pipeline-engine.js（getHistory 方法）
- 前端：apps/desktop/src/views/CreateHistory.vue（模板 + 脚本 + 样式）
- 测试：apps/desktop/src/views/CreateHistory.test.js 22/22 通过；pipeline-engine.test.js 37/37 通过；run-state-store.test.js 19/19 通过。vite build 通过。
### 3.1.12 CreateView 历史记录视图已暂停状态支持（2026-08-11）

**背景**：3.1.11 仅覆盖了 CreateHistory.vue（独立历史记录页面）的已暂停状态支持，但 CreateView.vue 中的「历史记录」视图（创作页内嵌的历史列表）仍缺少 paused 状态的显示、过滤和交互支持。后端 getHistory() 已返回 paused 状态数据，但前端 CreateView 无法正确展示。

**一、问题**

- historyStatusLabel() 缺少 paused 映射：后端返回 status: paused 的条目在 CreateView 历史列表中显示为原始字符串 "paused" 而非「已暂停」。
- 过滤器下拉菜单缺少「已暂停」选项：用户无法按暂停状态筛选历史记录。
- 暂停环节信息缺失：CreateView 历史列表不显示 pausedStage（暂停在哪个阶段），用户无法直观了解任务中断位置。
- 断点续跑按钮缺失：failed 状态有「从断点继续」按钮，但 paused 状态没有。

**二、修复内容**

1. historyStatusLabel()（CreateView.vue methods）：新增映射 paused: '已暂停'。完整映射：{ completed: '已完成', failed: '已暂停', cancelled: '已取消', running: '进行中', paused: '已暂停', pending: '等待中' }
2. 过滤器选项（CreateView.vue 模板）：在状态过滤下拉菜单中新增 option value="paused"「已暂停」。filteredHistory 计算属性已通过 item.status === this.historyFilter 精确匹配，无需额外修改。
3. 暂停环节提示（CreateView.vue 模板）：新增暂停环节提示 span，条件为 h.status === 'paused' && h.pausedStage。仅在 status 为 paused 且 pausedStage 非空时显示。
4. 断点续跑按钮（CreateView.vue 模板）：原逻辑 v-if="h.status === 'failed' && historyItemResumable(h)" 修改为 v-if="(h.status === 'failed' || h.status === 'paused') && historyItemResumable(h)"。paused 状态与 failed 状态共享「从断点继续」按钮逻辑。
5. CSS 样式（CreateView.vue 样式）：.history-status.paused 使用 --status-waiting-bg/text 变量；.history-paused-hint 11px 字号琥珀色文字+浅黄背景。

**三、数据流**

后端 getHistory() 将 running 快照归一化为 paused 状态并附带 pausedStage 字段 → IPC pipeline:history → CreateView.vue loadHistory() → history 数组包含 paused 条目 → filteredHistory 支持 paused 过滤 → 模板渲染 historyStatusLabel 显示「已暂停」、暂停环节提示显示阶段名称、按钮显示「从断点继续」。

**四、交互逻辑**

| 场景 | 状态显示 | 过滤选项 | 提示 | 按钮 | 点击行为 |
|------|----------|---------|------|------|---------|
| 运行中 | 进行中 | 进行中 | 返回流水线创作查看进度 | 继续生成 | resumeHistoryItem |
| 已暂停 | 已暂停 | 已暂停 | 暂停环节：xxx | 从断点继续 | resumeHistoryItem |
| 生成失败 | 生成失败 | 生成失败 | 无 | 从断点继续（可恢复时） | resumeHistoryItem |
| 已完成 | 已完成 | 已完成 | 无 | 打开 | openHistory |
| 已取消 | 已取消 | 已取消 | 无 | 无 | openHistory |

**五、显示项**

- 状态徽章：.history-status + :class="h.status" 动态样式
- 暂停环节文字：琥珀色背景 + 深琥珀色文字
- 时间戳：formatTime(h.updatedAt || h.completedAt || h.createdAt)
- 操作按钮：打开 / 删除 / 从断点继续 / 继续生成（按状态条件显示）

**六、提示文字**

| 位置 | 文字 | 条件 |
|------|------|------|
| 状态过滤下拉 | 已暂停 | 新增选项 |
| 历史条目状态 | 已暂停 | status === paused |
| 历史条目提示 | 暂停环节：{stageName} | status === paused 且 pausedStage 非空 |
| 操作按钮 | 从断点继续 | (failed 或 paused) 且 historyItemResumable |

**七、相关文件**

- 前端：apps/desktop/src/views/CreateView.vue（historyStatusLabel、过滤器、模板、CSS）
- 后端（无变更）：apps/desktop/electron/services/pipeline-engine.js（getHistory 已返回 paused 数据）
- 测试：CreateHistory.test.js 22/22 通过；views-deep2.test.js 7/7 通过；pipeline-engine.test.js 37/37 通过。


### 3.1.13 CreateView 历史记录组件拆分与 UI 优化（2026-08-11）

**背景**：CreateView.vue 原为 3575 行的巨型单文件组件，历史记录视图与流水线创作、快速渲染混杂在同一文件中。本次重构将历史记录视图提取为独立组件 CreateViewHistory.vue，并全面优化 UI。

**一、组件拆分**

1. 新建 `apps/desktop/src/views/CreateViewHistory.vue`：独立的历史记录视图组件。
2. CreateView.vue 通过 props 传入数据，通过 events 传回用户操作。
3. 历史记录 CSS 从 CreateView.vue 迁移到 CreateViewHistory.vue。
4. CreateView.vue 从 3575 行减少到 3515 行。

**二、组件 API**

| 类型 | 名称 | 说明 |
|------|------|------|
| Prop | history | 历史记录数组 |
| Prop | historyLoading | 加载状态 |
| Prop | historyFilter | 过滤状态（v-model） |
| Event | update:historyFilter | 过滤状态变更 |
| Event | open-history | 打开历史项 |
| Event | resume-history | 恢复/继续 |
| Event | delete-history | 删除 |

**三、UI 优化**

1. 卡片式布局 + 左侧状态色条（completed=绿/failed=红/running=蓝/paused=橙/cancelled=灰）
2. 运行中脉冲动画（蓝色边框呼吸效果）
3. 信息分层：标题行 → 提示行 → 阶段进度 → 底部操作
4. 失败原因截断展示（最多 60 字符）
5. 操作按钮分层：主操作（恢复，蓝色）+ 次操作（打开/删除）
6. 记录计数显示
7. 空状态图标+引导提示

**四、相关文件**

- 新增：apps/desktop/src/views/CreateViewHistory.vue
- 修改：apps/desktop/src/views/CreateView.vue（引入组件、移除内联模板和样式）
- 构建：vite build 通过，CreateView chunk 141KB
### 3.1.14 CreateHistory.vue 独立页面 stale running 检测（2026-08-11）

> ⚠️ **合同修订（2026-08-20）**：本节 stale running（>30 分钟无更新）转为 paused 的逻辑已改为转为「已中断（interrupted）」；阈值与推导算法不变。以 3.1.34 为准。

**背景**：3.1.12 仅在 CreateView.vue 的 loadHistory() 中添加了 stale running 检测（updatedAt 超过 30 分钟的 running 任务自动标记为 paused），但 CreateHistory.vue（独立历史记录页面 `#/create/history`）的 loadPipelines() 缺少相同的检测逻辑。用户在独立历史页面看到的仍然是"运行中"而非"已暂停"。

**一、修复内容**

1. CreateHistory.vue loadPipelines()：在数据加载成功后、schedulePipelineRefresh() 之前，新增 stale running 检测循环。
2. 检测逻辑与 CreateView.vue 完全一致：
   - 阈值：STALE_RUNNING_THRESHOLD_MS = 30 * 60 * 1000（30 分钟）
   - 判断：updatedAt 存在且 (now - updatedAt) > 阈值
   - 处理：status 从 running 改为 paused；自动推断 pausedStage（从 stages 数组找到 running 状态的阶段，或取最后一个阶段）
3. 模板已有 paused 状态支持（暂停环节提示、状态徽章、CSS 样式），无需修改模板。

**二、数据流**

pipelineHistory() IPC 返回 → loadPipelines() 加载 → stale running 检测循环（mutate status/pausedStage） → schedulePipelineRefresh() → 模板渲染。

**三、与 CreateView.vue 的一致性**

两处 stale running 检测逻辑完全相同（阈值、推断算法、字段名），确保用户无论从哪个入口查看历史记录，看到的状态一致。

**四、相关文件**

- 修改：apps/desktop/src/views/CreateHistory.vue（loadPipelines 方法）
- 测试：CreateView.test.js 129/129 通过

### 3.1.15 usePipelineHistory composable 提取（2026-08-11）

**背景**：历史记录加载、stale running 检测、轮询刷新、辅助方法（状态标签、阶段状态、时间格式化）在 CreateView.vue 和 CreateHistory.vue 中存在重复实现。提取为共享 composable 消除重复、统一行为。

**一、composable 设计**

```javascript
// apps/desktop/src/composables/usePipelineHistory.js
export function usePipelineHistory(options = {}) {
  // 响应式状态
  history, historyLoading, historyLocalMode, historyFilter, filteredHistory, story2videoResuming
  // 方法
  loadHistory(callbacks), destroy()
  // 辅助方法
  historyItemResumable(item), historyStageState(stage), historyStageLabel(stage),
  historyStageTitle(stage), formatTime(iso), truncateError(error)
}
```

**二、接口说明**

| 类型 | 名称 | 说明 |
|------|------|------|
| Ref | history | 历史记录数组（运行中置顶） |
| Ref | historyLoading | 加载状态 |
| Ref | historyLocalMode | 本地模式标记 |
| Computed | historyLocalModeText | 本地模式提示文字 |
| Ref | historyFilter | 过滤状态 |
| Computed | filteredHistory | 过滤后的历史记录 |
| Ref | story2videoResuming | 恢复中状态 |
| Method | loadHistory(callbacks) | 加载历史记录，callbacks.onError 用于弹窗 |
| Method | destroy() | 清理轮询定时器 |
| Method | historyItemResumable(item) | 判断是否可断点恢复 |
| Method | historyStageState(stage) | 阶段状态分类 |
| Method | historyStageLabel(stage) | 阶段名称 |
| Method | historyStageTitle(stage) | 阶段标题（名称+状态） |
| Method | formatTime(iso) | 时间格式化 |
| Method | truncateError(error) | 错误信息截断 |

**三、依赖**

- API：pipelineHistory(), story2videoListProjects()（来自 @/api/publisher）
- 工具：historyLoadFailureDetail()（来自 @/i18n/story2video-locale）
- 超时：HISTORY_LOAD_TIMEOUT_MS = 5000

**四、消除的重复**

| 逻辑 | CreateView.vue 原实现 | CreateHistory.vue 原实现 | composable |
|------|----------------------|------------------------|------------|
| loadHistory/loadPipelines | ~60 行 | ~20 行 | 1 个方法 |
| stale running 检测 | ~15 行 | ~15 行（本次新增） | 内置于 loadHistory |
| scheduleHistoryRefresh | ~10 行 | ~8 行 | 内置 |
| refreshRunningHistory | ~30 行 | 无 | 内置 |
| historyStageState/Label/Title | ~15 行 | ~15 行（stageTitle） | 3 个方法 |
| formatTime | ~3 行 | ~3 行 | 1 个方法 |
| truncateError | ~3 行 | 无 | 1 个方法 |

**五、相关文件**

- 新增：apps/desktop/src/composables/usePipelineHistory.js（252 行）
- 待迁移（后续 PR）：CreateView.vue 和 CreateHistory.vue 改为使用 composable

### 3.1.16 CreateViewHistory 卡片 UI 增强（2026-08-11）

**背景**：在 3.1.13 组件拆分基础上，进一步优化历史记录卡片的视觉层次和交互反馈。

**一、视觉增强**

1. **状态图标**：状态徽章前增加图标（✓已完成/✕失败/—已取消/⟳进行中/⏸已暂停/○等待中），提升可扫描性。
2. **运行中脉冲**：状态徽章 running 样式增加 status-pulse 动画（2s 周期 opacity 闪烁）。
3. **进度条光泽**：运行中阶段的进度段增加 shimmer 光泽动画（2s 周期从左到右扫过），直观表示"正在处理"。
4. **流水线标签**：卡片标题行右侧新增流水线名称标签（浅灰背景），便于区分不同流水线的任务。
5. **状态阴影**：running 状态卡片增加蓝色微阴影，paused 状态增加琥珀色微阴影，增强状态感知。

**二、交互增强**

1. **操作按钮间距**：resume/open/delete 按钮增加 gap: 4px，提升可点击区域。
2. **按钮 hover**：保持原有 hover 效果（蓝色边框+文字色），delete 按钮 hover 变红。

**三、数据校验**

- historyStatusIcon() 方法：对未知 status 返回空字符串，不会崩溃。
- 流水线标签：仅在 h.pipeline 或 h.name 存在时显示，通过 pipelineName() 翻译。
- 所有新增样式使用 CSS 变量 + 回退值，兼容亮/暗主题。

**四、相关文件**

- 修改：apps/desktop/src/views/CreateViewHistory.vue（模板 + 脚本 + 样式）
### 3.2 参数配置（Remotion 快速路径）
### 3.1.17 failed 任务统一显示为"已暂停" + 暂停环节信息（2026-08-11）

**背景**：此前 failed 状态的任务在历史记录中显示为"生成失败"，与用户期望的"已暂停"不一致。用户希望所有因失败/超时/崩溃而中断的任务统一显示为"已暂停"，并显示暂停环节信息。

**一、数据校验**

1. 状态转换：usePipelineHistory.js 的 loadHistory() 中，failed 状态的任务统一转换为 paused。
2. 暂停环节推导：若 pausedStage 字段不存在，从 stages 数组中按优先级推导：
   - 优先取 status === 'failed' 的阶段
   - 其次取最后一个 status !== 'completed' 的阶段
   - 最后取数组最后一个阶段
3. 恢复按钮判断：historyItemResumable() 同时支持 failed 和 paused 状态，内容策略类错误仍不显示恢复按钮。

**二、流程**

```
用户打开历史记录
  -> loadHistory() 并行请求 projects + pipeline runs
  -> 对每个 run.status === 'failed' 的任务：
      1. run.status = 'paused'
      2. 若无 pausedStage -> 从 stages 推导
  -> 排序：running 置顶 -> projects -> 其余
  -> 渲染 CreateViewHistory 组件
```

**三、功能逻辑**

| 场景 | 原状态 | 显示状态 | 暂停环节 | 恢复按钮 |
|------|--------|----------|----------|----------|
| 超时/崩溃导致失败 | failed | 已暂停 | 从 stages 推导 | 显示 |
| 内容策略拒绝 | failed | 已暂停 | 从 stages 推导 | 不显示 |
| 30分钟无更新的 running | running->paused | 已暂停 | 从 running 阶段推导 | 显示 |
| 正常完成 | completed | 已完成 | - | 不显示 |

**四、交互逻辑**

1. 状态筛选：筛选器仅保留全部/已完成/已取消/进行中/已暂停五个选项，移除了生成失败。
2. 暂停提示：暂停状态的卡片显示 暂停环节：{pausedStage} 提示行。
3. 阶段进度：暂停任务同样显示阶段进度条，暂停阶段使用琥珀色柔和脉冲动画。
4. 恢复操作：点击从断点继续按钮触发 resume-history 事件。

**五、显示项**

| 元素 | 位置 | 内容 |
|------|------|------|
| 状态色条 | 卡片左侧 4px | paused 状态为琥珀色 |
| 状态徽章 | 标题行右侧 | 暂停 已暂停，琥珀色背景+边框 |
| 暂停环节提示 | 标题行下方 | 暂停环节：{阶段名}，琥珀色背景条 |
| 阶段进度条 | 提示行下方 | 暂停阶段为琥珀色 active 段+柔和脉冲 |
| 操作按钮 | 卡片底部 | 从断点继续+打开+删除 |
| 时间戳 | 卡片底部左侧 | updatedAt/completedAt/createdAt 格式化 |

**六、提示文字**

| 场景 | 文字 |
|------|------|
| 暂停有阶段名 | 暂停环节：optimize |
| 暂停无阶段名 | 暂停环节：（空） |
| 运行中 | 返回流水线创作查看进度 |
| 恢复按钮（可用） | 从断点继续 |
| 恢复按钮（恢复中） | 恢复中... |

**七、删除的重复代码**

- CreateView.vue 中内联的 stale running 检测逻辑（15行）已移除，统一由 usePipelineHistory.js composable 处理。

**八、相关文件**

- 修改：apps/desktop/src/composables/usePipelineHistory.js
- 修改：apps/desktop/src/views/CreateView.vue
- 修改：apps/desktop/src/views/CreateViewHistory.vue
- 修改：apps/desktop/src/views/CreateView.test.js

### 3.1.18 视频创作模块 UI/UX 深度优化（2026-08-11）

**背景**：在完成组件拆分和功能修复后，视频创作模块的 UI/UX 仍有优化空间。用户要求深度分析所有前端界面 UI 和交互体验，然后整体优化。

**一、优化范围**

1. **CreateView.vue** — 主视图（视图切换、流水线详情、配置区、操作栏）
2. **CreateViewHistory.vue** — 历史记录视图（工具栏、卡片列表、状态徽章）

**二、视图切换（view-tabs）优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| 容器样式 | border-bottom 分割线 | 圆角胶囊容器 + 背景色 + 边框 |
| 标签样式 | 无圆角，底部下划线 | 圆角 8px，背景色过渡 |
| 悬停效果 | 无 | 背景色变化 |
| 激活状态 | 底部下划线 | 背景色 + 阴影（凸起效果） |
| 过渡动画 | 无 | 0.2s ease 过渡 |

**三、流水线卡片（pipeline-card）优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| 边框 | 1px solid var(--border) | 1px solid var(--hairline, rgba(0,0,0,0.08)) |
| 内边距 | 16px 20px | 18px 22px |
| 过渡效果 | 0.2s | 0.25s cubic-bezier(0.4, 0, 0.2, 1) |
| 悬停阴影 | 0 4px 16px | 0 6px 20px |
| 悬停位移 | translateY(-2px) | translateY(-3px) |
| 按下效果 | 无 | translateY(-1px) + 更小阴影 |

**四、返回按钮（back-btn）优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| 样式 | 纯文本链接 | 带边框的按钮 |
| 交互 | 无过渡 | 边框色变化过渡 |

**五、详情头部（detail-header）优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| 容器 | 无背景 | 卡片式背景 + 圆角 + 边框 |
| 标题 | 无字间距 | letter-spacing: -0.01em |
| 描述 | 14px | 13px + line-height: 1.5 |

**六、输入区域优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| textarea 聚焦 | 无特殊样式 | 边框色变化 + 蓝色外发光 |
| textarea 背景 | 无 | var(--surface) |
| 输入框聚焦 | 无特殊样式 | 边框色变化 + 蓝色外发光 |
| 下拉框聚焦 | 无特殊样式 | 边框色变化 + 蓝色外发光 |
| 上传区域 | 基础虚线边框 | 更大圆角 + 背景色过渡 + 悬停蓝色 |
| 字符计数 | 纯文本 | 带背景色的标签样式 |
| 预估信息 | 纯文本 | 左侧蓝色边框 + 背景色 |

**七、配置区（s2v-config-section）优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| 折叠区边框 | var(--border) | var(--hairline) + 过渡 |
| 展开状态 | 无特殊样式 | 边框色变为蓝色 |
| 摘要行 | 无悬停效果 | 悬停背景色变化 |
| 字号 | 无 | 14px |

**八、操作栏（action-bar）优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| 内边距 | 12px 16px | 14px 20px |
| 圆角 | 无 | 底部圆角 10px |
| 阴影 | 无 | 顶部微阴影 |
| 启动按钮 | 基础样式 | 字重 600 + 圆角 8px + 悬停阴影/位移 |

**九、模式切换（mode-tabs）优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| 容器 | 无 | 胶囊容器 + 背景色 |
| 标签 | 圆角 20px 边框 | 圆角 8px 无边框 |
| 激活状态 | 实心背景 | 背景色 + 阴影（凸起效果） |

**十、历史记录视图（CreateViewHistory.vue）优化**

| 优化项 | 优化前 | 优化后 |
|--------|--------|--------|
| 容器 | 无动画 | fadeIn 入场动画 |
| 工具栏 | 无边框 | 卡片式背景 + 圆角 + 边框 |
| 卡片圆角 | 8px | 10px |
| 卡片悬停 | 2px 位移 | 1px 位移 + 更大阴影 |
| 卡片按下 | 无 | 回弹效果 |
| 状态徽章 | 11px 2px 8px | 10px 3px 10px + 大写 |
| 标题文字 | font-weight: 500 | font-weight: 600 + letter-spacing |
| 操作按钮 | 4px 10px | 5px 12px + font-weight: 600 |
| 恢复按钮悬停 | 无阴影 | 蓝色阴影 |
| 阶段进度段 | 3px 8px | 4px 10px + font-weight: 500 |
| 时间显示 | 纯文本 | 带 🕐 图标前缀 |
| 底部区域 | 无分隔线 | 顶部 1px 分隔线 |
| 流水线标签 | 11px | 10px + font-weight: 500 + 大写 |
| 卡片间距 | 8px | 10px |

**十一、响应式优化**

| 断点 | 优化内容 |
|------|----------|
| ≤720px | 减小页面内边距、视图切换横向滚动、配置网格单列、启动按钮全宽 |
| 721-1024px | 适中内边距、流水线网格最小宽度 260px |

**十二、交互逻辑**

1. 视图切换：点击标签切换视图，无额外逻辑
2. 卡片悬停：translateY 位移 + 阴影放大，0.2s 过渡
3. 卡片按下：回弹到 translateY(0)，更小阴影
4. 输入框聚焦：蓝色边框 + 外发光，0.15s 过渡
5. 配置区展开：边框色变为蓝色，摘要行背景色变化
6. 操作栏：底部固定，顶部微阴影分隔
7. 模式切换：胶囊容器，激活项凸起效果

**十三、显示项**

| 组件 | 显示项 |
|------|--------|
| 视图切换 | 胶囊容器内的 3 个标签（流水线创作/快速渲染/历史记录） |
| 流水线卡片 | 类型徽章 + 稳定性圆点 + 标题 + 描述 + 阶段数 + 成本 + 可用性 |
| 详情头部 | 卡片式容器 + 标题 + 描述 |
| 输入区域 | textarea + 字符计数 + 预估信息（带左侧蓝色边框） |
| 配置区 | 折叠式卡片 + 摘要行 + 展开内容 |
| 操作栏 | 启动按钮 + 进度条 + 控制按钮 |
| 历史记录工具栏 | 状态筛选下拉 + 记录计数 |
| 历史记录卡片 | 左侧色条 + 标题 + 流水线标签 + 状态徽章 + 提示信息 + 阶段进度 + 时间 + 操作按钮 |

**十四、提示文字**

| 场景 | 文字 |
|------|------|
| 空状态 | 暂无创作记录 / 开始创作后，记录将在此显示 |
| 加载中 | 加载中... |
| 本地模式提示 | 当前为本地模式（未登录），历史记录仅保存在本机 |
| 恢复按钮 | 从断点继续 / 继续生成 |
| 删除按钮 | 删除 |
| 打开按钮 | 打开 |

**十五、相关文件**

- 修改：apps/desktop/src/views/CreateView.vue（CSS 优化）
- 修改：apps/desktop/src/views/CreateViewHistory.vue（CSS 优化）

### 3.1.19 failed 状态保留原始值 + 暂停环节显示修正（2026-08-11）

> ⚠️ **合同修订（2026-08-20）**：本节「30 分钟无更新的 running → paused」（二、流程第 3 步与三、功能逻辑表第 3 行）已废弃，改为 →「已中断（interrupted）」，提示文案改用「中断环节」；failed 保留原始值、内容策略不恢复等条款不变。以 3.1.34 为准。

**背景**：3.1.17 将 failed 状态统一转换为 paused，导致用户无法区分"执行失败"和"用户暂停"。本次修正保留 failed 原始状态，在前端层区分显示。

**一、数据校验**

1. **状态保留**：usePipelineHistory.js 的 loadHistory() 中，failed 状态不再转换为 paused，保留原始值。
2. **暂停环节推导**：若 failed 任务无 pausedStage 字段，从 stages 数组中按优先级推导：
   - 优先取 `status === 'failed'` 的阶段
   - 其次取最后一个 `status !== 'completed'` 的阶段
   - 最后取数组最后一个阶段
3. **stale running 检测**：running 状态超过 30 分钟无更新的任务，标记 `_originalStatus = 'running'` 后转为 paused（此逻辑不变）。
4. **恢复按钮判断**：`historyItemResumable()` 同时支持 failed 和 paused 状态，内容策略类错误（`needs_user_input`/`content_policy`/`可能需要修改文案`）仍不显示恢复按钮。

**二、流程**

```
用户打开历史记录
  -> loadHistory() 并行请求 projects + pipeline runs
  -> 对每个 run.status === 'running' 且 updatedAt > 30min 的任务：
      1. run._originalStatus = 'running'
      2. run.status = 'paused'
      3. 若无 pausedStage -> 从 stages 推导
  -> 对每个 run.status === 'failed' 且无 pausedStage 的任务：
      1. 从 stages 推导 pausedStage（不改变 status）
  -> 排序：所有任务按有效更新时间倒序，状态严格筛选
  -> 渲染 CreateViewHistory 组件
```

**三、功能逻辑**

| 场景 | 原状态 | 显示状态 | 暂停/失败环节 | 恢复按钮 |
|------|--------|----------|---------------|----------|
| 超时/崩溃导致失败 | failed | 执行失败 | 从 stages 推导（显示为"失败环节"） | 显示 |
| 内容策略拒绝 | failed | 执行失败 | 从 stages 推导 | 不显示 |
| 30分钟无更新的 running | running->paused | 已暂停 | 从 running 阶段推导（显示为"暂停环节"） | 显示 |
| 用户手动暂停 | paused | 已暂停 | 使用已有 pausedStage | 显示 |
| 正常完成 | completed | 已完成 | - | 不显示 |

**四、交互逻辑**

1. **状态筛选**：筛选器包含全部/进行中/已暂停/执行失败/已完成/已取消六个选项。
2. **失败提示**：
   - 有 pausedStage：显示"失败环节：{阶段名}"
   - 无 pausedStage 有 error：显示截断的错误信息（60字符）
   - 无 pausedStage 无 error：显示"执行过程中出现错误"
3. **暂停提示**：暂停状态的卡片显示"暂停环节：{pausedStage}"提示行。
4. **阶段进度**：运行中和暂停任务显示阶段进度条；暂停阶段使用琥珀色柔和脉冲动画。
5. **恢复操作**：点击"从断点继续"按钮触发 resume-history 事件。
6. **卡片悬停**：hover 时 translateY(-1px) + box-shadow 增强，0.15s ease 过渡。

**五、显示项**

| 元素 | 位置 | 内容/样式 |
|------|------|-----------|
| 状态色条 | 卡片左侧 3px | running 蓝 / paused 橙 / failed 红 / completed 绿 / cancelled 灰 |
| 状态徽章 | 标题行右侧 | 图标 + 文本（✓已完成 / ✕执行失败 / —已取消 / ⟳进行中 / ⏸已暂停 / ○等待中） |
| 失败徽章 | 同上 | 红色背景 + 1px 红色半透明边框 |
| 暂停徽章 | 同上 | 琥珀色背景 + 1px 琥珀色半透明边框 |
| 失败环节提示 | 标题行下方 | ⚠ 失败环节：{阶段名}，红色背景条 |
| 暂停环节提示 | 标题行下方 | ⏸ 暂停环节：{阶段名}，琥珀色背景条 |
| 运行中提示 | 标题行下方 | 🔄 返回流水线创作查看进度，蓝色背景条 |
| 阶段进度条 | 提示行下方 | 各阶段小方块（done/active/failed/pending），暂停阶段琥珀色脉冲 |
| 操作按钮 | 卡片底部 | 从断点继续 + 打开 + 删除 |
| 时间戳 | 卡片底部左侧 | updatedAt/completedAt/createdAt 格式化 |

**六、提示文字**

| 场景 | 文字 |
|------|------|
| 失败有阶段名 | ⚠ 失败环节：optimize |
| 失败无阶段名有错误 | ⚠ {截断的错误信息} |
| 失败无阶段名无错误 | ⚠ 执行过程中出现错误 |
| 暂停有阶段名 | ⏸ 暂停环节：generate_assets |
| 运行中 | 🔄 返回流水线创作查看进度 |
| 恢复按钮（可用） | 从断点继续 |
| 恢复按钮（恢复中） | 恢复中... |
| 筛选器选项 | 全部 / 进行中 / 已暂停 / 执行失败 / 已完成 / 已取消 |

**七、CSS 增强**

| 选择器 | 样式 |
|--------|------|
| `.history-item` | border-radius: 10px; transition: all 0.15s ease |
| `.history-item:hover` | transform: translateY(-1px); box-shadow: 0 2px 12px rgba(0,0,0,0.06) |
| `.history-status.failed` | background: var(--status-failed-bg); border: 1px solid rgba(239,68,68,0.15) |
| `.history-status.paused` | background: rgba(217,119,6,0.1); border: 1px solid rgba(217,119,6,0.2) |
| `.history-item.status-failed` | border-left: 3px solid var(--status-failed-text, #991b1b) |
| `.history-item.status-paused` | border-left: 3px solid var(--status-waiting-text, #d97706) |
| `.history-failed-hint` | 失败环节提示行样式 |
| `.history-paused-hint` | 暂停环节提示行样式 |

**八、相关文件**

- 修改：apps/desktop/src/composables/usePipelineHistory.js（状态保留 + pausedStage 推导 + 排序）
- 修改：apps/desktop/src/views/CreateViewHistory.vue（状态显示 + 筛选器 + CSS 增强）
- 新增：apps/desktop/src/views/video-creation/（PipelineSelector + StageProgress + ConfigSummary + ErrorDialog）





### 3.1.20 代码-设计分离与历史记录卡片优化（2026-08-11）

#### 一、变更背景

历史记录卡片（CreateViewHistory.vue）原先将 ~512 行 CSS 内联在组件的 `<style scoped>` 中，与模板逻辑耦合。同时存在以下问题：

1. **CSS 语法错误**：`video-creation-tokens.css` 中 `[data-theme="dark"]` 块提前关闭，导致 `--banner-attention-text` 和 `--ep-*` 暗色模式变量悬空
2. **硬编码颜色**：部分样式直接使用 rgba 值而非 CSS 变量，暗色模式覆盖不完整
3. **信息密度不足**：卡片仅显示标题、状态、提示行、进度条和操作按钮，缺少时长、模式等元信息
4. **布局冗余**：时间信息放在底部 footer，与操作按钮挤在同一行

#### 二、代码-设计分离方案

##### 1) 文件结构

| 文件 | 职责 | 行数 |
|------|------|------|
| `apps/desktop/src/styles/history-panel.css` | 历史记录卡片全部样式（从 Vue 抽取） | ~101 |
| `apps/desktop/src/styles/video-creation-tokens.css` | Design Token 定义（含暗色模式） | ~189 |
| `apps/desktop/src/views/CreateViewHistory.vue` | 模板 + 逻辑（无内联样式） | ~235 |

##### 2) 引入方式

`CreateViewHistory.vue` 的 `<script>` 块顶部添加：

```js
import '@/styles/history-panel.css'
```

- 不使用 `<style scoped>`，样式通过 class 命名空间隔离（`.history-*` 前缀）
- 好处：样式可被 DevTools 全局审查、可被其他组件复用、Vite HMR 热更新更快

##### 3) CSS 变量使用规范

所有颜色值必须使用 CSS 变量，格式：`var(--token-name, fallback)`。禁止直接写 rgba/hex。

已定义的变量族：

| 变量族 | 用途 | 示例 |
|--------|------|------|
| `--status-*-bg/text` | 状态语义色 | `--status-failed-bg: #fee2e2` |
| `--history-*` | 历史记录专用 | `--history-running-border: #93c5fd` |
| `--hairline` | 边框线 | `rgba(0,0,0,0.06)` |
| `--surface` | 卡片背景 | `#fff` |

#### 三、历史记录卡片 UI 优化

##### 1) 卡片信息层次（从上到下）

| 层级 | 内容 | 样式 |
|------|------|------|
| 第一行 | 标题 + 流水线标签 + 状态徽章 | 标题 14px bold，标签 10px uppercase，徽章 10px 带边框 |
| 第二行 | 状态提示（运行中/已暂停/失败） | 带图标的小字提示，背景色区分 |
| 第三行 | 元信息（时间、时长、模式、项目ID） | 12px 灰色，图标 + 文字 |
| 第四行 | 阶段进度条（仅运行中/已暂停） | 圆角分段条，活跃段有 shimmer 动画 |
| 底部 | 操作按钮（从断点继续/打开/删除） | 按钮组右对齐 |

##### 2) 状态视觉映射

| 状态 | 左边框色 | 状态徽章背景 | 提示行 |
|------|----------|-------------|--------|
| running | `--status-running-text` (#1d4ed8) | rgba(29,78,216,0.08) | 🔵 返回流水线创作查看进度 |
| paused | `--status-waiting-text` (#92400e) | rgba(217,119,6,0.1) | 🟠 暂停环节：{stage} |
| failed | `--status-failed-text` (#991b1b) | #fee2e2 | 🔴 失败环节：{stage} |
| completed | `--status-completed-text` (#065f46) | rgba(6,95,70,0.08) | 无 |
| cancelled | `--status-cancelled-text` (#6b7280) | #f3f4f6 | 无 |

##### 3) 新增元信息行

```html
<div class="history-meta">
  <span class="history-meta-item">🕐 {时间}</span>
  <span class="history-meta-item">⏱ {时长}</span>
  <span class="history-meta-item">⚙ {模式}</span>
  <span class="history-meta-item">📁 {项目ID前8位}</span>
</div>
```

- `formatDuration(ms)`：毫秒转 "X 分钟 Y 秒" 或 "Y 秒"
- 时长来源于后端返回的 `duration` 字段
- 模式来源于 `mode` 字段（如"文字标准模式"）
- 项目ID仅显示前 8 位，hover 时 title 显示完整 ID

##### 4) 操作按钮逻辑

| 状态 | 可用操作 | 条件 |
|------|---------|------|
| running | 继续生成 | 始终可用 |
| paused | 从断点继续 | `historyItemResumable(h) === true` |
| failed | 从断点继续 | `historyItemResumable(h) === true` 且 error 不含 needs_user_input |
| completed | 打开 | `h.projectId` 存在 |
| * | 删除 | `h.projectId` 存在 |

#### 四、CSS 语法修复

`video-creation-tokens.css` 暗色模式修复：

- **问题**：`[data-theme="dark"]` 块在第 173 行提前关闭，`--banner-attention-text` 和 `--ep-*` 变量悬空
- **修复**：移除第 173 行的多余 `}`，将所有暗色模式变量正确嵌套在 `[data-theme="dark"]` 内
- **验证**：大括号计数 { = 2, } = 2，平衡

#### 五、数据校验

| 字段 | 类型 | 必填 | 校验规则 |
|------|------|------|---------|
| `h.status` | enum | 是 | running/paused/failed/completed/cancelled |
| `h.title` | string | 否 | 为空时 fallback 到 `pipelineName(h.pipeline)` |
| `h.pausedStage` | string | 否 | running 超时自动推导，failed 从 stages 推导 |
| `h.duration` | number(ms) | 否 | 非数字或 null 时不显示 |
| `h.mode` | string | 否 | 非空时显示 |
| `h.stages` | array | 否 | 仅 running/paused 时显示进度条 |

#### 六、相关文件

- **修改**：`apps/desktop/src/views/CreateViewHistory.vue`（移除内联 CSS，添加 CSS import，新增 meta 行和 formatDuration）
- **修改**：`apps/desktop/src/styles/video-creation-tokens.css`（修复暗色模式 CSS 语法）
- **新增**：`apps/desktop/src/styles/history-panel.css`（从 Vue 抽取的历史记录样式）


以下 Cut 参数属于独立 Remotion 快速路径，不等同于 `story2video-compose` 的 scene schema：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | string | 自动生成 | 场景唯一标识 |
| `type` | enum | `text_card` | 场景类型（15+ 种） |
| `text` | string | — | 场景文本内容 |
| `source` | string | — | 视频/图片源路径 |
| `in_seconds` | number | — | 开始时间（秒） |
| `out_seconds` | number | — | 结束时间（秒） |
| `animation` | string | `ken-burns` | 动画效果 |
| `chartData` | array | — | 图表数据 |
| `chartSeries` | array | — | 折线图序列 |


### 3.1.21 BasePythonBridge 懒启动自愈（2026-08-11）

#### 一、变更背景

视频创作流水线依赖 Python Bridge（SplitterBridge、PromptBridge）提供后台服务。此前当 Bridge 进程意外退出（崩溃、看门狗放弃、启动失败）后，业务调用方（如 optimize()、_post()）直接抛出 xxx is not running 错误，用户需要手动重启应用。本次在 BasePythonBridge 基类中新增 nsureRunning() 方法，实现懒启动自愈。

#### 二、实现方案

##### 1) ensureRunning() 方法（base-python-bridge.js:281-293）

`
async ensureRunning () {
  if (this.isRunning) return          // 已运行则跳过
  if (this._starting) return this._starting  // 并发调用共享同一 Promise
  this.log.info(this.name, ${this.name} is not running, attempting lazy-start...)
  this.restartCount = 0
  this._starting = this.start().catch((e) => {
    this.log.error(this.name, Lazy-start failed: )
    throw e
  }).finally(() => { this._starting = null })
  return this._starting
}
`

##### 2) _post() 方法改造（base-python-bridge.js:228-231）

原来 _post() 在 isRunning === false 时直接 reject。改造后：
`
if (!this.isRunning) {
  try { await this.ensureRunning() } catch (e) {
    throw new Error(${this.name} is not running and lazy-start failed: )
  }
}
`

##### 3) 子类显式调用

PromptBridge 的 optimize() 和 optimizeBatch() 方法在调用 _post() 前额外调用 wait this.ensureRunning()，确保 Bridge 可用。

#### 三、行为变化

| 场景 | 改造前 | 改造后 |
|------|--------|--------|
| Bridge 未启动时调用 optimize() | 抛出 "xxx is not running" | 自动尝试启动，成功则继续，失败则抛出 "lazy-start failed" |
| Bridge 启动中重复调用 | 无保护 | 共享同一 _starting Promise，不重复 spawn |
| Bridge 崩溃后首次调用 | 直接报错 | 自动重启 + 重试 |

#### 四、数据校验

- _starting 字段类型：Promise<void> | null
- nsureRunning() 返回值：Promise<void>
- 并发安全：多次调用共享同一个 _starting Promise

#### 五、错误处理

- 懒启动失败时，错误信息包含原始异常的 message
- 日志级别：启动尝试为 info，失败为 error
- 不影响看门狗和正常重启逻辑

#### 六、影响范围

| 文件 | 变更类型 |
|------|----------|
| ase-python-bridge.js | 新增 nsureRunning() 方法 + _post() 改造 |
| prompt-bridge.js | optimize() 和 optimizeBatch() 前置调用 |
| splitter-bridge.js | 同上模式 |

#### 七、回归验证

- ase-python-bridge.test.js：新增 ensureRunning 懒启动测试（并发调用共享 Promise、启动失败抛出、已运行跳过）
- 2e-full-pipeline.test.js：E2E 测试自动启动 Splitter Bridge 而非仅 attach


### 3.1.22 图片轮播模型下拉空白 / 新增模型后不刷新修复（2026-08-12）

#### 一、问题（用户 Bug 报告）

1. **空状态下拉空白**：进入视频创作 → 图片轮播，尚未新增任何模型时，「图片生成器」下拉为空（无任何选项），应显示「无」。
2. **新增模型后下拉不刷新**：打开「设置 → 模型设置」新增支持语音、生成图片的多模态模型（MiniMax）后关闭弹窗，回到创作页「图片生成器」下拉仍空白、「语音生成器」下拉仍无 MiniMax、「音色复制 / 克隆」选项不出现。

#### 二、根因

| 现象 | 根因 |
|------|------|
| 图片生成器下拉空白 | `CreateView.vue` 图片生成器 `<select>` 无「无」占位项；`s2vImageProviders` 为空时 `s2vConfig.imageProvider=''` 不在选项列表 → 渲染空白选中项 |
| 新增 MiniMax 后下拉不刷新 | `loadS2VProviders()` 仅在 `mounted()` 调用一次；「设置」弹窗（`SettingsDialog`，内嵌 `ModelProviders`）是覆盖层，**不卸载 CreateView**，关闭弹窗后无任何刷新信号 → `s2vImageProviders / s2vVoiceProviders / s2vVideoProviders` 停留在挂载时的旧列表 |
| 音色克隆选项不出现 | 音色克隆面板（`s2vVoiceCapability.type==='user_clone' && clone.enabled`）依赖已选语音 provider 的 `getTtsVoiceCapability` 结果；语音列表陈旧导致无法选中 MiniMax → 能力不加载 |
| 连带风险 | 用户在下拉空白/陈旧时启动流水线：提交 `image.provider=''` → 主进程 `story2video-stages.js:1298` 走 `resolveCapabilityProvider('image')`（`getDefault` 兜底）→ 可能解析到 enabled 但无有效 Key 的 provider → generate_assets 阶段逐场景重试/长时间停留，或解析不到 → ffmpeg 占位图降级（假图） |

#### 三、修复内容

1. **空状态占位（CreateView.vue 模板）**：图片生成器下拉在 `s2vImageProviders.length === 0` 时渲染 `<option value="">无</option>`，并新增配置引导提示「未找到可用的图片生成器，请先在「模型服务商」中配置并启用支持图片生成的模型（含多模态模型）。」+「前往配置 →」链接（`#/model-providers`，App 路由为 hash 模式，链接有效）。视频生成器对齐：空列表渲染「无」+ 引导提示 + 链接（2026-08-12 复审 M2/W2）。语音生成器因常驻「自动 Edge TTS」首项（id=''），下拉永不空白、**不加「无」占位**（避免重复空 value），仅补充空态引导提示「未配置 TTS 模型时将使用自动 Edge TTS（免费）；如需 MiniMax 等语音模型与音色克隆能力，请先在「模型服务商」中配置。」+ 链接（2026-08-12 复审 W1）。
2. **设置弹窗关闭刷新（App.vue + stores/settings-dialog.js + CreateView.vue）**：
   - 新增 `apps/desktop/src/stores/settings-dialog.js`：`settingsDialogRevision`（ref）与 `notifySettingsDialogClosed()`（关闭时 +1）。
   - `App.vue`：`<SettingsDialog @close>` 改为 `closeSettingsDialog()`（先 `showSettingsDialog=false`，再 `notifySettingsDialogClosed()`）。
   - `CreateView.vue`：`mounted()` 注册 `this.$watch(() => settingsDialogRevision.value, () => this.loadS2VProviders())`，`beforeUnmount()` 解除监听。弹窗关闭后自动重拉 `model-provider:list(image/tts/video)` 并刷新 `s2vVoiceCapability`（音色目录/克隆能力随之重载）。
3. **陈旧选中值归一化（CreateView.vue `loadS2VProviders`，2026-08-12 审查 M1/M2 加固）**：**仅当本次拉取成功**（`code===0 && Array.isArray(data)`）才替换列表并归一化——图片 `imageProvider/imageModel`、视频 `videoProvider/videoModel` 不在新列表时清空；**IPC 瞬时失败时保留旧列表与旧选中值**，禁止把「临时故障」误渲染成「未配置模型」并清空用户已选 provider。语音分支同样仅在成功时重选 provider/model 并重载音色能力。无显式选择时保持默认取第一个可用 provider。

#### 四、数据流

```
SettingsDialog 关闭（App.vue @close）
  → closeSettingsDialog() → notifySettingsDialogClosed() → settingsDialogRevision += 1
  → CreateView $watch 触发 → loadS2VProviders()
  → IPC model-provider:list(image/tts/video)（后端 listProviders 已合并多模态 + is_configured 过滤）
  → enabledProviders 过滤（enabled===true && is_configured===true）
  → s2vImageProviders / s2vVoiceProviders / s2vVideoProviders 更新
  → 图片生成器下拉出现「MiniMax（多模态）」；语音生成器默认选中首个可用 provider
  → loadS2VVoiceData() → getTtsVoiceCapability → s2vVoiceCapability=user_clone+enabled
  → 音色复制 / 克隆面板出现
```

#### 五、数据校验 / 边界条件

| 边界 | 行为 |
|------|------|
| 无任何已配置模型 | 图片生成器显示「无」+ 引导提示；语音生成器只有「自动 Edge TTS」；音色克隆面板不出现（无 provider 上下文） |
| 新增 MiniMax（multimodal，声明 tts+image）后关闭弹窗 | 下拉立即出现「MiniMax（多模态）」；语音默认选中 MiniMax + `speech-2.8-turbo`；音色克隆可用（`user_clone` + `clone.enabled=true`） |
| 已选 provider 被删除/停用后重载 | `imageProvider/imageModel`、`videoProvider/videoModel` 归一化清空；有可用项时自动选中首个 |
| IPC 返回异常/拒绝 | `Promise.allSettled` + 请求 id 守卫，旧请求不覆盖新结果；**拉取失败时保留旧列表与旧选中值**（2026-08-12 审查 M1），仅首次挂载无旧值时才显示「无」+ 引导提示 |
| 视频生成器空列表（videoMode≠off） | 下拉显示「无」+ 引导提示 + 前往配置链接（2026-08-12 审查 M2） |
| 语音生成器无 TTS 服务商 | 保留「自动 Edge TTS」常驻首项（下拉不空白），显示「未配置 TTS 模型时将使用自动 Edge TTS…」引导提示 + 链接（2026-08-12 复审 W1） |
| 弹窗关闭触发重拉时组件已卸载 | `_s2vAlive` 守卫：`loadS2VProviders` 顶部/恢复点与 `loadS2VVoiceData` 顶部均检查，不写已卸载组件（2026-08-12 审查 m3/I1） |
| 弹窗关闭时组件已卸载 | watcher 在 `beforeUnmount` 解除，无泄漏/无残留回调 |
| 多次打开/关闭弹窗 | 每次关闭均重拉；请求 id 递增保证最终一致 |

#### 六、交互逻辑

| 场景 | 交互 |
|------|------|
| 无模型进入图片轮播 | 图片生成器显示「无」；下方显示引导提示，用户可点击「前往配置」跳转模型设置 |
| 在设置弹窗新增 MiniMax 并关闭 | 回到创作页自动刷新：图片/语音下拉出现 MiniMax，语音自动选中并加载音色目录，克隆面板出现 |
| 用户主动切换语音 provider | 不变：`handleS2VVoiceProviderChange` 按新 provider 重载音色目录与能力 |
| 删除全部模型 | 图片生成器回到「无」+ 提示；语音回退「自动 Edge TTS」；克隆面板消失 |

#### 七、显示项与提示文字

| 位置 | 显示项 / 文字 | 条件 |
|------|--------------|------|
| 图片生成器下拉 | 「无」（option value=""） | `s2vImageProviders.length === 0` |
| 图片生成器下方 | 「未找到可用的图片生成器，请先在「模型服务商」中配置并启用支持图片生成的模型（含多模态模型）。」+「前往配置 →」链接 | `s2vImageProviders.length === 0` |
| 图片生成器下拉选项 | `{provider.name}（多模态）` 后缀 | `provider.category === 'multimodal'` |
| 视频生成器下拉 | 「无」（option value=""） | `s2vVideoProviders.length === 0` 且 `videoMode !== 'off'` |
| 视频生成器下方 | 「未找到可用的视频生成器，请先在「模型服务商」中配置并启用支持视频生成的模型。」+「前往配置 →」链接 | `s2vVideoProviders.length === 0` |
| 语音生成器下拉 | 「自动 Edge TTS」常驻首项 + 已配置 provider | 恒有首项（不显示「无」，避免重复空 value） |
| 语音生成器下方 | 「未配置 TTS 模型时将使用自动 Edge TTS（免费）；如需 MiniMax 等语音模型与音色克隆能力，请先在「模型服务商」中配置。」+「前往配置 →」链接 | `s2vVoiceProviders.length === 0` |
| 音色复制 / 克隆面板 | 展开按钮「音色复制 / 克隆」 | `s2vVoiceCapability.type==='user_clone' && clone.enabled===true` |

#### 八、相关文件

- 新增：`apps/desktop/src/stores/settings-dialog.js`
- 修改：`apps/desktop/src/App.vue`（closeSettingsDialog + notify）
- 修改：`apps/desktop/src/views/CreateView.vue`（「无」占位 + 引导提示 + 弹窗关闭 watcher + 陈旧 provider 归一化）
- 修改：`apps/desktop/src/views/CreateView.test.js`（3 个新回归测试 + 3 个 3.1.16 重构后过时断言同步为 `s2v-btn-resume`/`s2v-btn-secondary`）
- 后端（无变更）：`model-provider-manager.listProviders` 已合并多模态并过滤 `is_configured`

#### 九、回归测试

- 「Story2Video 无可用图片生成器时下拉显示「无」并给出配置提示」：空列表 → option「无」+ 提示文字 + `imageProvider=''`。
- 「Story2Video 设置弹窗关闭后重新加载服务商列表（新增多模态模型立即出现在下拉且音色克隆可用）」：空列表挂载 → `notifySettingsDialogClosed()` → 图片/语音下拉出现「MiniMax（多模态）」→ `s2vVoiceCapability=user_clone+enabled` → 克隆面板出现。
- 「Story2Video 重新加载时清空已不存在的图片生成器选中值」：陈旧 `imageProvider` → 重载后清空。
- 「重载时 IPC 失败保留旧列表与已选图片生成器」：reject 路径不清空旧值（2026-08-12 审查 M1 回归）。
- 「无可用视频生成器时下拉显示「无」」：视频空态对齐图片（2026-08-12 审查 M2 回归）。
- 「无 TTS 服务商时语音生成器保留「自动 Edge TTS」并给出配置引导」：语音空态提示 + 链接（2026-08-12 复审 W1 回归）。
- 完整 `CreateView.test.js` 137/137 通过；`vite build` 通过；Claude 双轮只读审查（首轮 M1/M2/m1/m3/m4 修复，复审 W1 闭合 + W2 验证 hash 路由链接有效）后 Approve。

#### 十、预防措施（QM-5）

- 逃逸链：该 Bug 未被拦截——CreateView 测试没有覆盖「设置弹窗关闭后刷新」的跨组件信号场景；下拉空状态无断言。
- 系统性漏洞：组件挂载后对**外部模型配置变更**（弹窗/路由）缺乏响应机制；空列表 UI 无占位断言。
- 落地：新增 settings-dialog revision 信号 + 空状态占位/提示断言；后续任何「弹窗/外部配置变更 → 页面刷新」需求复用该信号；PRD 7.4.1.1 合同补充「空能力下拉占位」「设置弹窗关闭刷新」。

### 3.1.23 流水线阶段进行中信息反馈颗粒度统一（2026-08-17 已实施）

> 完整方案：`01-docs/PLAN-VIDEO-PIPELINE-PROGRESS-FEEDBACK-2026-08-13.md`；主 PRD 合同：`01-docs/PRD.md` 7.1.9.3。

**需求**：进度清单列表中，每个阶段「进行中」的信息反馈应具备统一、可预期的颗粒度，消除「有的阶段有计数/百分比，有的阶段只有『运行中』」的落差。

**实施合同**：

1. **统一阶段生命周期**：每个阶段至少上报 `0%` 的开始事件与 `100%` 的完成事件；成功但未自行上报的执行器由 `PipelineEngine` 兜底补齐，避免清单只停留在笼统的“运行中”。
2. **统一 payload**：`getRunSnapshot().stages[i].progress = { percent, message, messageKey?, messageParams?, summary?, summaryKey?, summaryParams?, detail?, updatedAt }`，并与 `context.stage_progress` 双写。`detail` 使用 `{ done, total, kind }`，其中 `kind` 限定为 `scene/resource/image/video/tts/platform/segment`。
3. **单调与校验**：百分比必须在 `[0,100]` 且不可倒退；本地化 key 仅允许 `stageProgress.*`；参数、计数与种类不合法时 fail-closed 丢弃该更新，展示反馈不得阻断流水线本身。
4. **颗粒度**：可迭代工作使用 `done/total`（场景、资源、TTS、平台、片段）；不可细分的 LLM、校验、渲染和文件复制阶段提供开始文案和完成摘要。Story2Video 保留图片/视频/旁白多资源进度与断点恢复；videogen 将提示词优化映射为 `0–35%`、视频生成映射为 `35–100%`。
5. **全流水线覆盖**：Story2Video、animated-explainer、talking-head、cinematic、clip-factory、documentary-montage、localization-dub、podcast-repurpose、videogen 和 framework-smoke 均接入统一反馈；循环阶段必须有运行中与完成态回归。
6. **UI 与本地化**：StageProgress 优先按 `messageKey`/`summaryKey` 渲染 zh/en 文案，缺失 key 才回退 raw `message`/`summary`；完成态优先显示结构化摘要。总进度继续使用“已完成阶段数 + 当前阶段百分比”的加权计算。

**验收**：任一运行中阶段都能显示可理解的活动描述；可计数阶段显示一致的 `done/total` 与百分比；完成阶段显示摘要；不同流水线不再依赖 UI 按名称特判；locale 保持 zh/en 成对；受影响流水线有独立事件回归。

### 3.1.24 水印功能修复与选项扩展（2026-08-14）

> 需求来源：用户反馈「全能创作水印功能没生效，输入框填写了文字，但最终视频没有水印」，并要求新增透明度、字号、位置（含移动）选项。
> 机制合同：`openspec/changes/watermark-options/specs/story2video-watermark/spec.md`；实现 PR #792（边距调远见 PR #794）；测试：`story2video-compose-engine.test.js`（buildWatermarkFilter 契约 10 项）、`story2video-text-config.test.js`（位置枚举 fail-closed 4 项）、`CreateView.test.js`（恢复吸附 + 提交透传 3 项）、`pipeline-story2video-contract.test.js`（18 项）、真实 ffmpeg 渲染帧级验证。

**缺陷根因（QM-5 复盘）**：`buildWatermarkFilter`（`apps/desktop/electron/services/story2video-compose-engine.js`）坐标表达式错误。drawtext 的 `x/y` 是文字**左上角**坐标，而旧实现 bottom-* 用 `y=h-20`（基线贴底，文字主体在画面外）、center 用 `y=(h+text_h)/2`（把文字底部压到中线以下，`text_h` 语义错配），导致所有 bottom-* 与 center 位置的水印文字整体画出画布，成片无可见水印。该逻辑自 commit `e1b46eba0`（2026-07-23）引入；保存链路（UI 提交 → 快照持久化 → normalizer → compose 参数）经验证无断点，属渲染层坐标缺陷。逃逸链：既有单测只断言 top-left 位置 filter 存在，未断言 bottom-right/center 的坐标数值，坐标 bug 未被拦截。

**功能逻辑（位置坐标语义）**：以 drawtext 左上角定位（`x,y` = 文字左上角）；水平边距 40px、底部边距 40px、顶部边距 60px（2026-08-14 用户反馈四角距边过近后由 20/20/40 调远，center/moving 不受影响）：

| 位置 | x 表达式 | y 表达式 | 说明 |
|------|----------|----------|------|
| top-left | `40` | `60` | 左上角 |
| top-right | `w-text_w-40` | `60` | 右上角 |
| bottom-left | `40` | `h-text_h-40` | 左下角 |
| bottom-right | `w-text_w-40` | `h-text_h-40` | 右下角（默认） |
| center | `(w-text_w)/2` | `(h-text_h)/2` | 水平垂直居中 |
| moving | `'(w-text_w)/2*(1+0.9*sin(2*PI*t/100))'` | `'(h-text_h)/2*(1+0.9*sin(2*PI*t/140))'` | 确定性 Lissajous 平滑漂移（t=0 起点画面正中） |

**moving 语义（确定性漂移，非随机闪烁）**：用户期望「随机移动」，实现为确定性 Lissajous 曲线平滑循环漂移：t=0 位于画面正中（双轴均用 sin，sin(0)=0），x 周期 100s、y 周期 140s（2026-08-14 由 10s/14s 放慢 10 倍），幅度 0.9 倍中心区间，任意时刻不出画布；同参数重复渲染逐帧可复现（可回归、可测试），不用 `random()`（避免逐帧抖动与不可复现）。**起点居中的数学前提是双轴同用 sin**：y 轴曾误用 `cos(2πt/140)`（cos(0)=1 → t=0 起点在底部 95% 处，短视频全程滞留下半区），2026-08-27 已修正为 sin（详见 3.1.38）。

**透明度契约**：`opacity` 为 0-1 数值，drawtext 输出 `fontcolor=white@<opacity>`；UI 下拉 10%-100%（步进 10%）共 10 档，默认 60%。

**字号契约**：`fontSize` 为 10-96 整数，drawtext 输出 `fontsize=<size>`；UI 五档下拉 16/24/32/40/48，默认 24。

**数据校验（fail-closed 双层防线）**：
1. **normalizer 层**（`story2video-text-config.js`）：`WATERMARK_POSITIONS` 白名单（top-left/top-right/bottom-left/bottom-right/center/moving），白名单外值（middle/random/center-right/bottomright/TOP-LEFT 等）抛错拒绝（`Story2Video watermark.position 值无效: <值>`），不静默回退；`opacity` 越界（<0 或 >1）抛错；`fontSize` 越界（<10 或 >96）抛错。UI 提交路径（`story2videoTextConfig.watermark.*`）同样受白名单约束。
2. **compose 层二次防线**：`buildWatermarkFilter` 对 position 白名单外值 fail-closed 抛错；fontSize/opacity 经 `clampNumber` 收敛到合法边界，非法/NaN 回退默认（24 / 0.6）。
3. **恢复吸附**：加载「上次选项」快照时 `normalizeS2VWatermarkOptions()` 将陈旧枚举吸附到合法档位（position 非白名单吸附 bottom-right；fontSize 吸附最近档位；opacity 吸附最近档位），下拉框不出现空白选项。

**UI 交互逻辑（CreateView.vue 视频增强区水印块）**：
- **显示项**：水印开关（既有）+ 水印文字输入框 + 位置下拉（正中/左上/左下/右上/右下/移动，6 项）+ 字号下拉（16/24/32/40/48，5 项）+ 透明度下拉（10%/20%/…/100%，10 项）。
- **交互**：勾选水印开关并填写文字后启用水印；任一选项修改即自动保存「上次选项」快照（`buildS2VLastOptions`），下次进入自动恢复；顶部「恢复默认选项」重置为默认契约（bottom-right / 24 / 60%）；历史项目旧配置（如 position=middle）恢复时自动吸附，不报错。
- **提示文字**：全部走 locales（`create.story2video.watermark.*` 14 键 zh/en 成对），`src/` 无新增中文硬编码；CI 门禁（locale 成对 + CJK 基线扫描）守护。
- **测试钩子**：`data-testid` = `s2v-watermark-position` / `s2v-watermark-fontsize` / `s2v-watermark-opacity`。

**流程**：CreateView 水印块提交 `watermark: {enabled, text, position, fontSize, opacity}` → `buildS2VLastOptions` 持久化快照 → 六阶段编排 compose 阶段 → normalizer 校验（fail-closed）→ compose engine `buildWatermarkFilter` 生成 drawtext filter → ffmpeg 渲染 → 输出 ffprobe 校验。透传链路（`pipeline-story2video-contract`）已覆盖：watermarkConfig 从 params → stageOptions.compose 无损透传。

**兼容性**：旧项目快照中 position/fontSize/opacity 缺失或陈旧 → 恢复吸附默认/最近档位；快照中无 watermark 字段 → 保持既有默认（bottom-right/24/0.6）。`normalizeStory2VideoTextParams` 顶层 `watermark: true/false` 布尔透传不变（options-matrix E2E 参数 `watermark:true, watermarkText:'TEST-WM'` 契约保持）。

### 3.1.38 水印「移动」起点修正：从画面中心附近开始漂移（2026-08-27）

> 需求来源：用户反馈「故事讲述流水线水印位置选择“移动（平滑漂移）”时，生成视频后水印只在画面底部区域移动」，期望水印从画面中心附近开始移动。
> 机制合同：`openspec/changes/fix-watermark-drift-start-center/`；实现随 PR 合并；测试：`story2video-compose-engine.test.js`（moving 数学契约断言 + 字符串断言更新）、真实 ffmpeg 40s 渲染帧验证（t=0/15/35）。

**缺陷根因（QM-5 复盘）**：`buildWatermarkFilter`（`apps/desktop/electron/services/story2video-compose-engine.js`）的 moving 表达式 y 轴误用 `cos(2πt/140)`——`cos(0)=1` 使 t=0 时 y=0.95×(h-text_h)（画面底部 95% 处），与「起点居中」契约矛盾（x 轴用 sin，sin(0)=0 正确居中）。2026-08-14 slow-drift 修复把周期放慢 10 倍（x 10s→100s / y 14s→140s）后，短视频（10-40s）内余弦值仅从 1 缓慢下降（t=30s 时约 0.22），水印全程滞留下半区（y∈[0.61,0.95]×(h-text_h)），用户感知「只在底部移动」。公式引入于 commit `3c3835d1b`（PR #792，2026-08-14）；周期放慢见 `.ccg/tasks/archive/2026-08/story2video-watermark-slow-drift`。

**逃逸链**：
- 单元测试（`story2video-compose-engine.test.js`）只断言 filter 字符串包含 `cos(2*PI*t/140)`，把错误公式本身固化为断言（断言不精确，未验证数学语义）；
- 集成测试（text-config / pipeline-story2video-contract / CreateView）只覆盖枚举透传与快照吸附，无坐标数学断言；
- 真实 ffmpeg 渲染冒烟只验证「渲染成功 + 水印可见 + 不越界」，未核对起始位置（moving 从底部出发同样可见且不越界，视觉验证无法区分）；
- 代码审查复核「t=0 居中」时未核对 cos/sin 初值（三角函数初值盲区），`review.md` 声称 t=0 居中但公式不成立。

**系统性漏洞**：测试对「确定性漂移的数学性质」（t=0 位置、幅度区间、周期回原点）缺乏独立求值断言层，字符串包含断言锁定实现细节而非行为契约。

**功能逻辑（数学契约）**：moving 双轴均为确定性 sin 漂移（drawtext x/y = 文字包围盒左上角坐标）：
- x = `(w-text_w)/2*(1+0.9*sin(2πt/100))`：t=0 → x 居中；x 周期 100s
- y = `(h-text_h)/2*(1+0.9*sin(2πt/140))`：t=0 → y 居中；y 周期 140s
- 幅度 0.9：任意 t，坐标 ∈ [0.05, 0.95]×(画布-文字) 自由空间，不越界（sin∈[-1,1]，与旧 cos 版边界完全相同）
- 确定性：纯 t 函数、无 `random()`，同参数逐帧可复现；表达式无逗号（防滤镜链切分，`expr.not.toContain(',')` 断言继续覆盖）
- 起始 2-3 秒运动方向：从中心向右下起步（x/y 同向加速），无方向契约要求，属可接受的视觉变化
- 多镜头成片：**已由 3.1.39 架构升级**——moving 水印在 xfade 合并后统一烧录（成片级时间轴），跨镜头连续漂移、切点零跳变；本句「片段计时/中心吸附跳变」仅为 3.1.38 阶段的既定呈现描述，不再适用。详见 3.1.39

**数据校验**：`watermark.position` 枚举不变（moving 仍在 `WATERMARK_POSITIONS` 白名单）；normalizer fail-closed 行为不变；无新增字段、无快照结构变化——旧快照 `position: 'moving'` 直接生效，无需吸附迁移。

**UI 交互逻辑**：
- 显示项：位置下拉「移动（平滑漂移）」选项不变（`data-testid="s2v-watermark-position"`）。
- 交互：选择 moving 后展示提示文案（`create.story2video.watermark.movingHint`，zh/en 成对更新）：「水印从画面中心附近开始，沿正弦轨迹在画面内缓慢游走，避免逐帧随机导致的闪烁」。
- 其余（字号/透明度/恢复默认/快照恢复）与 3.1.24 一致，不受影响。

**流程**：CreateView 水印块提交 `watermark:{enabled,text,position,fontSize,opacity}` → 快照持久化 → normalizer 校验（fail-closed）→ compose engine `buildWatermarkFilter` 生成 drawtext filter（moving 双轴 sin）→ ffmpeg 渲染 → 输出校验。全链路与 3.1.24 相同，仅 filter 内 y 表达式与提示文案变化。

**测试（回归保护）**：
- `story2video-compose-engine.test.js` 新增「moving 数学契约」用例：从 filter 提取 x/y 表达式做数学求值——t=0 断言 x/y 均居中（旧 y=cos 求值得 988px ≠ 520px，必然拦截回退）；扫描 t∈[0,700] 步进 5s 断言坐标占比 ∈[0.05,0.95]；断言 x(100)=x(0)、y(140)=y(0) 周期回原点；字符串断言更新为双轴 sin 并追加 `not.toContain('cos(2*PI*t/140)')` 防回退。
- 真实 ffmpeg 冒烟：40s/1280x720/30fps 黑底 + moving filter，抽取 t=0（居中）、t=15（右下一带）、t=35（右下边界内）三帧目检，记录在任务 review.md。

**兼容性**：仅影响 moving 起始相位；center 与四角位置不受影响；Remotion 渲染路径（`Story2VideoSlideshow.tsx` Watermark）无 moving 分支、静默回退 bottom-right 静态，为已知双路径差异（休眠缺口，另立跟进项，不在本次范围）。

### 3.1.39 移动水印跨镜头连续漂移：成片级统一烧录（2026-08-28）

> 需求来源：用户反馈 moving 水印「只在画面底部区域移动」的第二层根因——3.1.38 修复「起点居中」后，多镜头成片每个镜头开头水印仍会跳回画面中心（片段级计时、每镜头从 t=0 起步），跨镜头不连续；本项将 moving 水印渲染提升到 xfade 合并后的成片级统一烧录，实现跨镜头连续漂移，水印从画面中心附近（成片 t=0）开始。
> 机制合同：`openspec/changes/watermark-cross-segment-continuous-drift/`（proposal / design / specs / tasks 四件套）。

**缺陷根因（QM-5 复盘）**：`buildWatermarkFilter` 在**单片段编码命令内**应用 drawtext——drawtext 的 `t` 是片段内时间轴，每段从 t=0 起步。多镜头下每个镜头开头水印回到起点（3.1.38 修复后为画面中心），镜头切换处出现一次「中心吸附」跳变；用户感知为水印「不连贯地在画面里来回跳」。根因是**渲染管线把成片级效果实现为片段级滤镜**（架构错误），不是表达式错误。
**逃逸链**：单测只断言片段 filter 字符串与单镜头 t=0 帧，无跨镜头连续性断言；真实 ffmpeg 冒烟（3.1.38）仅抽 40s 单镜头 3 帧；E2E 无多镜头切点帧对比——多镜头时间轴契约完全无测试层拦截。
**系统性漏洞**：视频渲染测试缺乏「成片级时间轴」断言层（多镜头切点采样对比）。

**功能逻辑（架构与流程）**：
- **触发条件**：`watermarkConfig.position === 'moving'` 且 `enabled === true` 且水印文字非空。仅多镜头成片（≥2 场景）触发后置烧录；单镜头（1 场景）不触发后置（零额外编码、无二次有损），维持片段内嵌——单镜头 t 成片=片段，轨迹与 3.1.38 逐帧一致，无需后置。
- **片段层去字**：`_encodeSegmentOnce`（image 路径）与 `_encodeVideoSegmentOnce`（video 路径，含 stop-at-end 分支的 overlayFilters）在 `position === 'moving'` 时跳过 `buildWatermarkFilter` 注入；静态位置（top-left/top-right/bottom-left/bottom-right/center）保持片段内嵌，零额外编码。
- **成片级烧录**：compose 在 narration（89）之后新增独立阶段 `phase:'watermark'`、percent 90（介于 narration 89 与 bgm 92 之间，percent 序列 87→89→90→92→95→98→100 单调）；输出路径链：xfade/concat 产物 `output.mp4` → `watermarked.mp4`（BGM 混音 `-c:v copy` 与水印后置顺序强约束：水印必须先于 BGM，否则 BGM 阶段不重编码视频会丢失水印）→ bgm/webm 消费。
- **烧录命令**（`_burnMovingWatermark`）：`-i composed.mp4 -vf drawtext（整片成片时间轴 moving 表达式） -map 0:v:0 -map 0:a:0? -c:v libx264 -pix_fmt yuv420p -crf 18 -c:a copy`。视频轨全量重编码（crf 18 保持质量），**音频轨 `-c:a copy` 不重编码**（显式 `-map` 会丢弃未映射流，必须同时 `-map 0:a:0?` 可选映射——冒烟实测缺此行会丢失全部音频流）。
- **drawtext 表达式**：与 `buildWatermarkFilter` moving 分支逐字一致（x 周期 100s / y 周期 140s、0.9 中心幅度、双轴 sin、t=0 起点画面正中）；表达式无逗号（防滤镜链切分）。
- **超时预算**：`FFMPEG_STAGE_TIMEOUT_PROFILES` 新增 `watermark` 条目，复用 xfade profile（minMs 120000 / factor 3 / overheadMs 120000 / maxMs 6h）——水印命令是「解码成片 + drawtext + 全量重编码」，工作量与 xfade 合并同级；冒烟实测 59.6s 成片水印阶段约 6s（约 10x 实时），5 分钟成片预计 +30-40s，预算宽裕。

**数据校验**：`watermark.position` 枚举不变（moving 仍在 `WATERMARK_POSITIONS` 白名单）；normalizer fail-closed 行为不变；无新增字段、无快照结构变化——旧快照 `position: 'moving'` 直接生效，无需吸附迁移。进度更新新增 `phase:'watermark'` 进入 `KNOWN_COMPOSE_PHASES` 单一来源（`stage-executor` fail-closed 校验自动复用）。

**UI 交互逻辑**：
- 显示项：位置下拉「移动（平滑漂移）」选项、字号、透明度、开关均不变（`data-testid="s2v-watermark-position"`）。
- 交互：无需新操作；选择 moving 后既有提示文案（`create.story2video.watermark.movingHint`）继续适用。
- 进度展示：水印烧录阶段进度条显示「视频合成 90%」（CreateView 对非 concat 子进度回退文案）；引擎进度 message「正在烧录移动水印」由 renderer 回退文案覆盖，无新增 renderer 字面量，locales 无需成对新增。

**流程**：CreateView 水印块提交 `watermark:{enabled,text,position,fontSize,opacity}` → 快照持久化 → normalizer 校验（fail-closed）→ compose engine 片段编码（moving 去字）→ xfade 合并 → narration → **watermark 后置烧录（percent 90）** → bgm（-c:v copy）→ webm（可选）→ 输出校验。

**测试（回归保护）**：
- 单元（`story2video-compose-engine.test.js` 新增 6 用例）：`KNOWN_COMPOSE_PHASES` 含 watermark + normalize 透传；image/video 片段 moving 去字、静态位置仍内嵌；compose moving 多镜头新增 watermark 阶段（percent 90 单调、命令含整片时间轴 sin 表达式、`-map 0:a:0?`、`-c:a copy`、超时=computeFfmpegStageTimeoutMs('watermark', 成片实际时长)）；静态位置与未启用不进 watermark 阶段。引擎全量 146 用例 + 相邻套件 5 文件 286 用例全绿。
- CI 测试环境契约（2026-08-28 补充）：electron-ci.yml 的 electron-tests 任务设置 SKIP_NATIVE_MEDIA_TOOL_TESTS=1，模块级 ffmpeg 探测为 null——凡断言 compose/renderSegment 成功路径的用例必须经构造参数 ffmpegBinary 注入实例级二进制（引擎默认仍取模块级探测结果，生产行为不变；compose/renderSegment 前置检查与 execFfmpegStage 均走实例值）。makeWmEngine 已显式注入 ffmpeg 并新增断言用例；本地复验：设置 SKIP_NATIVE_MEDIA_TOOL_TESTS=1 后运行 story2video-compose-engine.test.js。防止「本地无该 env 全绿、CI 全量单 worker 失败」的环境漂移。

- 真实 ffmpeg 冒烟（2026-08-28）：2×30s 成片，抽帧像素簇中心——t=0.5s (656,366.5)（画布中心 640,360 起点居中）、t=29.5s (1167.5,664.5)、t=30.5s (1156.5,668.0)，切点漂移 Δy=3.5px/Δx=11px（旧片段内嵌场景会跳 ~650px），0.5→29.5s 行程 298px 证明 Lissajous 全轨迹；时长 59.6s、音频流保留。

**兼容性**：仅影响 moving 位置渲染路径；center 与四角位置不受影响（片段内嵌语义不变）；Remotion 渲染路径（`Story2VideoSlideshow.tsx` Watermark）无 moving 分支、静默回退 bottom-right 静态，为已知双路径差异（休眠缺口，另立跟进项，不在本次范围）；视频编码质量（crf 18）与片段相位均为非破坏性变化。

### 3.1.25 背景音乐素材库管理（2026-08-14）
### 3.1.40 视频创作流水线「保存配置」：命名组合配置库（2026-08-28）

**需求**：视频创作模块（CreateView.vue）**所有流水线**新增「保存配置」：把当前流水线的全部选项保存为**有名字的组合配置（配置库条目）**；点击条目可把保存的选项**应用**回当前表单；支持**重命名**与**删除**管理。配置为**设备级本地持久化**（userData JSON），未登录可用；与「上次选项」自动恢复（story2video.lastOptions.v1）**并存**：应用配置不写入 lastOptions，下次打开仍恢复 lastOptions。

**合同**：

1. **数据模型与校验（主进程 services/story2video-config-profiles.js）**：记录仅允许 { id, name, pipelineId, snapshot, createdAt, updatedAt }；id = randomUUID，安全 id 校验 /^[A-Za-z0-9-]{8,64}$/；name trim 后按 Unicode code point 计数为 1..60（空/超长拒绝，不使用 JS UTF-16 length）；pipelineId 与流水线 name 一致，长度 1..64 且匹配 /^[A-Za-z0-9][A-Za-z0-9._-]*$/；snapshot 必须为普通 JSON 对象（不接受数组、Date 等特殊原型，写入前 JSON 深拷贝），UTF-8 序列化 ≤64KiB；**单流水线上限 50 条**，超出返回显式容量错误；同流水线+同名默认拒绝，overwrite=true 时覆盖旧条目并更新 updatedAt。持久化文件为 userData/story2video-config-profiles/config-profiles.json，临时文件使用独占创建后 rename 原子替换，Windows 文件占用最多有限重试；不可解析 JSON 的索引读取为空库并允许下一次合法 create 重建，可解析但根结构/条目含非法数据时仅列出合法项，create/rename/delete 全部停止写入并保留原始字节；其他写失败透出安全可读错误。
2. **快照捕获范围（renderer）**：编排流水线（story2video-compose）捕获 s2vConfig（深拷贝，与 data().s2vConfig 键一致）+ s2vOutputConfig + ui.expandedGroups（当前展开的配置分组）；非编排流水线捕获 legacy 段（inputMode（不含素材文件）、selectedStyle、llmConfig、budgetConfig、checkpointPolicy、storyboardMode、outputConfig）。快照含 schemaVersion=1、capturedAt、kind: orchestrated | legacy。**不捕获**：素材文件（图片/音频/视频路径、预览）、快速视图字段、运行态（runId/进度）、凭证与敏感字段。
3. **IPC 契约**：story2video:config-profile-list / create / rename / delete，入参 {} / { pipelineId, name, snapshot, overwrite } / { id, name } / { id }；全部 withSenderCheck 可信来源校验，参数非法返回校验错误且不进入服务；通道加入 preload PUBLIC_METHODS 与主进程 license PUBLIC_CHANNELS 白名单（设备级本地数据，语义同 BGM 素材库）。
4. **应用（apply）语义**：仅 pipelineId 与当前流水线匹配的配置可应用（跨流水线按钮禁用 + toast「该配置属于其他流水线，无法在当前流水线应用」）。应用走类型感知合并（null/undefined 跳过、object/array 深拷贝、标量同类型才回填）→ 枚举归一化（S2V_RESTORE_ENUM_OPTIONS：陈旧枚举回退默认合法值，避免下拉空白项）→ 数值归一化（normalizeResolution 超限回退最高档、applyS2VTargetChars 按主控字数自愈）→ provider 失效回退（voiceProvider 不在当前集合时删除 voice/model/id 三元组；imageProvider 失效回退首个可用 provider；videoMode !== off 时 videoProvider 失效同样清空；voiceProvider === 空串显式 Edge TTS 必须保留）→ 重载语音数据 → 按 ui.expandedGroups 白名单恢复折叠组 → toast「已应用配置」。表单已相对默认值改动时先弹「应用配置将覆盖当前已调整的选项，是否继续？」确认框；无改动直接应用。
   - legacy 快照应用为**整对象替换**（selectedStyle/llmConfig/budgetConfig/outputConfig 直接深拷贝覆盖；inputMode/checkpointPolicy/storyboardMode 白名单校验后赋值），再对 outputConfig.resolution 归一化——不适用 _applyS2VSnapshot 的原地合并语义（2026-08-28 单测暴露并修复）。
5. **UI 与交互（CreateView.vue、VideoCloneView.vue、FilmEngineeringView.vue）**：每个可打开的视频创作流水线都显示「保存配置」（data-testid *-config-profile-save）与「我的配置」（*-config-profile-manage）入口，仅在当前页面已有有效流水线/表单时可用；**保存弹窗**（UiModal sm，*-config-profile-save-dialog）：名称输入（*-config-profile-name-input，maxlength=60，提交时 trim 并按 Unicode code point 校验，打开时预填当前流水线显示名）、「保存」/「取消」（保存按钮 *-config-profile-save-confirm）；重名时进入覆盖态（按钮文案变「覆盖保存」）并提示「已存在同名配置，再次点击保存将覆盖它」，二次点击才发送 overwrite=true。**配置列表弹窗**（UiModal，*-config-profile-list-dialog）：按 updatedAt **倒序**平铺，每行显示「名称 + 所属流水线名 + 更新时间（MM-DD HH:mm）」；行内操作：应用（*-config-profile-apply，跨流水线 disabled）、重命名（行内编辑 *-config-profile-rename-input，Enter 保存 / Esc 取消）、删除（danger）；空态、加载态、错误态均有可读文案。**删除二次确认**（danger 弹窗，*-config-profile-delete-confirm，文案「确定删除该配置吗？此操作不可恢复。」）。**应用确认**（仅表单已修改时，*-config-profile-apply-confirm）；列表和保存请求在等待时仍可关闭，关闭后请求代际递增，迟到响应不得重开弹窗或覆盖新状态。
6. **提示文字（zh / en 成对，create.story2video.configProfile.*）**：saveButton 保存配置 / manageButton 我的配置 / saveTitle 保存配置 / listTitle 我的配置 / saveHint 保存当前流水线的所有选项，稍后可一键应用到新任务。 / namePlaceholder 配置名称（如：口播竖屏 1080p） / nameRequired 请输入配置名称 / duplicateName 已存在同名配置，再次点击保存将覆盖它 / overwriteSave 覆盖保存 / save 保存 / cancel 取消 / close 关闭 / apply 应用 / applyTitle 应用配置 / applyConfirm 应用配置将覆盖当前已调整的选项，是否继续？ / delete 删除 / deleteTitle 删除配置 / deleteConfirm 确定删除该配置吗？此操作不可恢复。 / empty 暂无保存的配置。在流水线页面点击『保存配置』即可创建。 / saved 配置已保存 / applied 已应用配置 / renamed 配置已重命名 / deleted 配置已删除 / wrongPipeline 该配置属于其他流水线，无法在当前流水线应用；后端校验失败与 IO 失败透出可读 message。
7. **测试与验收边界**：服务单测覆盖普通对象/Date 与数组拒绝、Unicode 名称、pipeline/profile ID、64KiB、容量 50、CRUD、原子写、不可解析索引重建、结构/条目部分损坏读合法写保护、重名覆盖；IPC 单测覆盖 4 通道参数非法、不可信 sender 无副作用、未登录可用；CreateView/专用页面组件测试覆盖保存弹窗/空名校验/重名两段确认/列表加载非空数据与倒序/应用含 provider 失效回退与枚举归一化/跨流水线禁用/重命名/删除确认/legacy、video-clone、film-engineering 快照与保留原有页面动作；publisher wrapper fallback 测试。**不覆盖**：跨设备云同步（明确排除）、真实第三方登录态下的保存行为（public 通道语义已由单测覆盖）、真实第三方 provider 接受或发布成功。真实桌面应用验收：各入口保存→改动选项→应用恢复；旧版本无存量数据、空库和可重建损坏索引均不崩溃。

### 3.1.41 快速渲染「文案生成」接入 AI 视频生成 + Remotion 进度解析修复（2026-09-18）

**需求来源**：用户反馈「视频创作 → 快速渲染 → 输入文案『夏天的风』→ 点击【开始渲染】→ 底部进度条一直 0%，几分钟后突然变成『渲染完成』；且完成后的视频是静态文字，没有调用视频生成模型生成视频」。

**根因**：

1. **进度条 0%**：`apps/desktop/electron/services/render-engine.js` 用正则 `/Rendered frame (\d+)\/(\d+)/` 解析 Remotion CLI 输出，但 Remotion CLI 实际输出格式为 `Rendered 45/900`（`getGuiProgressSubtitle`，无 "frame" 字样）或 `Rendered frames 45/900`（`makeRenderingProgress`，复数 "frames" 且带 ANSI 颜色码）。正则要求单数 "frame"，永远匹配不上 → 进度条一直 0%，直到渲染完成事件才跳到完成态。
2. **静态文字**：快速渲染「文案生成」模式（`CreateView.vue` 的 `startQuickRender`）把每行文案直接生成为 `text_card` cut，用本地 Remotion 静态渲染文字卡片，**完全不调用视频生成模型**。而流水线模式（story2video-compose）的 `generate_assets` 阶段会调用 `generateVideo` 生成真实 AI 视频。

**修复方案**：

1. **进度解析修复（render-engine.js）**：新增纯函数 `parseRenderProgress(text)`，剥离 ANSI 转义码后同时兼容 `Rendered 45/900`、`Rendered frames 45/900`、`Rendering frames 45/900`、`Encoded 45/900` 四种格式；`total=0` 时返回 0 而非 Infinity；stdout/stderr 两处进度解析统一调用该函数。函数导出供单元测试。
2. **快速渲染「文案生成」接入 AI 视频生成**：
   - 主进程新增 IPC `render:start-ai-video`（`apps/desktop/electron/ipc-handlers/render.js`）：入参 `{ prompt }`；复用 `story2video-stages.js` 导出的 `generateSceneVideo`（提交 `generateVideo` → 轮询 `getVideoStatus`（≤10 分钟）→ 下载落盘 → ffprobe 校验），返回 `{ success: true, outputPath }`；进度经 `render:progress` 事件推送（percent 0-100 + stage 文案）。视频供应商解析：`modelProviderManager.getDefault('video')` + `resolveProviderDefaultModel`（用户默认 > 运营默认 > capability_models.video > models[0]）。默认 9:16 竖屏（720×1280，长边封顶 1280）、fps 30、时长 8 秒、轮询间隔 10s。
   - preload 暴露 `renderStartAiVideo`（`electron/preload/publish.js`），renderer API 新增 `renderStartAiVideo`（`src/api/publisher.js`）。
   - `CreateView.vue` 的 `startQuickRender`：text 模式调用 `renderStartAiVideo({ prompt })`（多行文案以「。」合并为一段），成功即 `quickResult = res.data` 且复位 `quickRendering`；gallery 模式保持原有 Remotion 图片轮播路径（`renderStart`）。
3. **数据校验**：
   - `render:start-ai-video`：`prompt` 必须为非空字符串（trim 后非空），否则返回校验错误；`modelProviderManager` 不可用或未配置视频供应商时返回可读错误（不崩溃）。
   - `generateSceneVideo` 内部既有守卫：`prompt` 非空、提交 `code !== 0` 透传、任务 ID 缺失报错、轮询超时（≤10 分钟）报错、下载非空文件 + ffprobe 可解码校验。
4. **流程**：
   ```
   用户输入文案 → 点击【开始渲染】
     -> renderer startQuickRender（text 模式）
       -> IPC render:start-ai-video { prompt }
         -> 主进程解析默认 video provider + model
         -> generateSceneVideo：提交 generateVideo → 轮询 getVideoStatus（≤10 分钟）→ 下载 mp4 → ffprobe 校验
         -> render:progress 推送（提交 1% → 轮询中 → 完成 100%）
         -> render:complete 推送 { success: true, outputPath }
       -> renderer quickResult = outputPath，quickRendering = false
     -> 展示「视频渲染完成」+【查看视频】按钮
   ```
5. **交互逻辑**：
   - 渲染中：按钮显示「渲染中...」，进度条实时更新（percent + stage 文案），【取消】按钮可用（`renderCancel` 仅取消本地 Remotion 渲染，AI 视频生成轮询阶段取消不中断主进程任务——与既有 `render:cancel` 语义一致）。
   - 成功：进度条消失，展示「视频渲染完成」+【查看视频】。
   - 失败：展示可读错误 +【重试】按钮（点击清空错误）。
6. **显示项**：进度条（`quickProgress` 0-100%）+ 阶段文案（`quickStage`：开始渲染 / 提交视频生成任务 / 渲染中 / 编码中 / 计算中 / 启动渲染）；结果横幅「视频渲染完成」；错误横幅。
7. **提示文字**：复用既有 `quickStage` 文案（开始渲染 / 渲染中 / 编码中 / 计算中 / 启动渲染）与「视频渲染完成」「渲染失败」「渲染异常」等既有文案；新增主进程错误文案（「AI 视频生成服务不可用，请在模型设置中启用视频供应商」「未配置可用的视频供应商，请在模型设置中启用视频生成能力」）——这些是主进程侧错误消息，不进入 renderer locale（renderer 经 `formatUserError` 归一化展示）。
8. **测试**：
   - `render-engine.test.js`：`parseRenderProgress` 覆盖 `Rendered 45/900`、`Rendered frames 45/900`、`Rendering frames 45/900`、`Encoded 45/900`、ANSI 码剥离、total=0 边界、非进度文本返回 null（7 例）。
   - `render.test.js`：`render:start-ai-video` 覆盖缺少 prompt 校验、未配置视频供应商、成功路径（deps 注入 mock `generateSceneVideo`）、失败路径推送 `render:error`（4 例）。
   - `CreateView.test.js`：text 模式调用 `renderStartAiVideo`（断言 prompt 合并）、gallery 模式仍调用 `renderStart`、失败复位（3 例更新 + 1 例新增）。
   - `preload.test.js` / `publisher.test.js`：新增 `renderStartAiVideo` 键数断言与 API 元数据。
9. **验收边界**：真实 AI 视频生成（provider 提交/轮询/下载）依赖已配置的视频供应商与真实第三方服务，属外部验收；本地单测覆盖 IPC 契约、参数校验、错误处理与 renderer 行为。


**需求**：全能创作（Story2Video）的背景音乐从「每次选文件」升级为**设备级素材库**：可添加（自动入库并选中）、修改名称、删除；支持多个条目，通过下拉选择。库中条目的路径在媒体白名单内，继续受既有格式/大小/受控路径约束（WAV / M4A / MP3，单文件 ≤15MB）。

**合同**：

1. **库存储**：主进程 `services/story2video-bgm-library.js`，库目录 `userData/story2video-bgm/`，索引 `library.json` 临时文件 + rename 原子写；条目字段 `{ id, name, path, createdAt }`；该目录加入 `getAllowedMediaRoots()` 白名单（`story2video-paths.js`），compose 的 `resolveReadableMediaFile(path, { kind: 'bgm' })` 校验可过。
2. **IPC**：`story2video:bgm-library-list / add / rename / delete` 四个通道，均走 `withSenderCheck` + 参数校验（id/name 空串拒绝）；`add` 复用媒体导入的路径解析与受控目录复制语义（Windows 占用 ≤3 次有界重试），失败透传细分提示（格式 / 大小 / 不可读 / 路径未解析）。
3. **权限**：四通道加入 PUBLIC_CHANNELS（未登录可用，与媒体导入一致）；preload 暴露 `story2videoBgmLibraryList/Add/Rename/Delete`，`Add` 复用 `resolveFilePath`。
4. **UI（CreateView.vue）**：BGM 配置区改为 `<select data-testid="s2v-bgm-select">`——空选项「不使用背景音乐」+ 素材库条目 + 历史路径兼容选项（未入库时显示「已选音频（未入库）」）；「管理背景音乐」按钮打开素材库弹窗（UiModal，Teleport to body）：添加（隐藏 file input，成功后自动选中并清空 input 支持连续选择）、行内重命名（Enter 保存 / Esc 取消）、删除（二次确认弹窗，删除当前选中项时回退为「不使用背景音乐」）。
5. **i18n**：所有用户可见文案 zh/en 成对新增 `create.story2video.bgmLibrary.*` 与 `story2video.bgm_library_*`。
6. **验收**：添加 → 列表 +1 且自动选中；重命名 → 列表刷新且退出编辑态；删除 → 列表 -1，删除选中项时 `bgmPath` 回退空；历史 BGM 路径不在库时保留为独立选项、入库后不再显示；服务层单测（16 例）+ 渲染端用例 + preload/IPC 测试全部通过。

### 3.1.26 视频任务编辑页场景多素材选择与再次合成（2026-08-14；2026-08-20 布局与交互修订）

**需求**：「视频创作-历史记录 → 视频任务编辑页」每个场景固定展示 4 个视觉卡：**图1 / 图2（备选图）/ 视频1 / 视频2（两个视频显示位）**；底层仍只有 3 个持久化素材身份 `image1 | image2 | video`。新增按钮【生成新图】【生成 AI 视频】（生成更多素材供选择）与【再次合成视频】（用当前选定素材 + 已有 TTS 旁白/字幕/背景音乐重新合成成片）；流水线完成后即可从视频任务编辑页继续生成、预览、选择素材并重新合成。其余既有功能（分段编辑、替换旁白、重试、重新合成、导出等）保持不变。

#### 1) 数据模型与槽位身份

| 槽位 | 字段 | 说明 |
|------|------|------|
| 图1 | `segment.imagePath` | 既有主图，至少 1 张图 |
| 图2 | `segment.alternateImages[0].path` | 备选图；服务端强制 `length ≤ 1`（只存一张备选）；`meta` 与 `imageMeta` 同结构 |
| 视频 | `segment.videoPath` | 备选/当前分段视频 |
| 选中态 | `segment.selectedMaterial: 'image1' \| 'image2' \| 'video'` | 可选；缺失时按遗留语义：有 `videoPath` 视为 video，否则 image1（UI 展示与合成映射一致） |
| 视频1视觉卡 | `videoMeta.sceneVideoPath`，缺失时兼容 `segment.videoPath` | canonical 视频显示位；`selectedMaterial='video'` 时只在此卡显示「当前使用」 |
| 视频2视觉卡 | `videoMeta.altSceneVideoPath` | 可选 alternate 视频预览位，不新增持久化 kind，不重复显示选中徽标 |

- 槽位身份固定，**不支持交换/删除**；「生成新图」按规则替换具体槽位（见功能逻辑）。
- 兼容旧项目：无 `selectedMaterial` 的旧分段自动沿用遗留语义，`_scenesForCompose` 不剥离旧 `videoPath`（2026-08-14 测试回捕：实现曾误置空导致旧项目再次合成丢视频，已修复）。

#### 2) 数据校验（服务端 fail-closed）

- `alternateImages`：仅接受数组、截断取 1 项；每项 `{ path, meta }`，`path` 必须为可解析媒体（图片白名单/受控目录），`meta` 走 `safeAssetMeta` 白名单字段；非法项整体丢弃。
- `selectedMaterial`：白名单 `['image1','image2','video']`，非法值返回 null（沿用遗留语义）。
- `selectSceneMaterial(projectId, segmentId, kind)`：`kind` 不在白名单 → 抛「素材类型无效」；分段不存在 → 「分段不存在」；目标槽为空 → 「该素材槽位暂无素材，请先生成素材」，不落库。
- `generateSceneImage`：`assetGenerator.generateImage` 不可用 → 「图片生成服务不可用」；生成产物 `_copyRequired` 失败或结果无有效路径 → 失败回滚（回写 failed 状态、清理本次 attemptFiles，保留旧素材）。
- `generateSceneVideo`：无 `audioPath` → 「该场景没有旁白音频，无法生成视频」（**不写失败状态**）；`composeEngine.renderSegment` 不可用 → 「视频合成服务不可用」；渲染失败 → 回写 failed、**保留旧视频**、清理本次产物；无选中图 → 「该场景没有可用的图片素材，请先生成图片」。
- IPC 层：三个新通道 `story2video:generate-scene-image / generate-scene-video / select-scene-material` 均 `withSenderCheck` + `isSafeId`（projectId/segmentId）+ 参数类型校验，失败统一 `VALIDATION_ERROR`；license-access-control 均映射 `story2video_write`。

#### 3) 流程

```
历史记录 → 点击任务 → 视频任务编辑页（ResultView）
  ├─ 场景素材区：4 个视觉卡片（图1/图2/视频1/视频2），当前使用槽高亮 + 徽标；video1/video2 仍映射到一个持久化 video 身份
  ├─ 【生成新图】→ 主进程 generateSceneImage → 按槽位规则替换 → 返回最新项目 → 刷新缩略图 → 成功通知
  ├─ 【生成 AI 视频】→ 主进程 generateSceneAiVideo → 按 videoPrompt 生成/校验/保存新分段视频 → 刷新 video1 → 成功通知
  ├─ 点击 radio 或其 label → selectSceneMaterial → 持久化 image1/image2/video 选中态 → 刷新 → 成功通知
  ├─ 点击有 URL 的缩略图 → 仅打开预览弹窗（图片大图 / 视频播放器），不调用选择 IPC
  └─ 【再次合成视频】→ 复用 story2video:recompose-project（recomposeProject）→ 按选中态映射场景 → 整片重合成
```

#### 4) 功能逻辑（生成/选择/合成规则）

- **生成新图槽位规则**（用户确认规则）：
  1. 无备选图（只有图1）→ 补图2 槽，**不改变当前选中态**；
  2. 已有备选图且当前选中图1 → 替换图2（图1 选中时换图2）；
  3. 已有备选图且选中图2/视频/未选 → 替换图1（图1 未选中时换图1）。
- **生成视频规则**：始终以「当前选中的图片」为画面（图2 选中用备选图，否则图1），显式剥离旧 `videoPath` 避免引擎复用旧视频；成功后替换 `videoPath`，**不自动改变选中态**；失败保留旧视频。
- **合成映射 `_scenesForCompose`**（compose/renderSegment 引擎零改动）：`video` 选中 → 保留 videoPath；`image1`/`image2` 选中 → 传选中图片并置空 videoPath；无选中 → 遗留语义（videoPath 优先）。「再次合成视频」与既有「重新合成」共用此映射。
- **manual 模式富化（saveRun）**：流水线 manual 分镜自选完成后，从 `context.generate_assets`（finalManifest candidates/selection）恢复未选素材：选图 → 未选中的另一张候选图复制为图2 槽 + `selectedMaterial='image1'`；选视频 → 两张候选图补图1/图2 + `selectedMaterial='video'`；未选视频但存在视频候选 → 补 videoPath；auto 模式无候选不富化（字段缺省即旧行为）。

#### 5) 交互逻辑

- 每个视觉卡是独立 article；缩略图是独立 button type="button"，只负责预览。radio 位于缩略图下方、素材名称前，并通过稳定 id/name/value 与本地化 label、aria-label 关联。卡片本身没有选择 click handler，避免 ancestor label 的原生激活把预览误判为选择。
- radio 是唯一的设为当前使用入口。空卡 radio disabled；路径存在但预览 URL 失效时缩略图 disabled，radio 是否可选仍按服务端路径合同和 slot selectable 判定；非法 kind 或空槽请求由 renderer 与 IPC/service 双层拒绝。
- busy 防抖：任一生成/选择操作进行中，该分段所有素材操作禁用（`segmentBusy[segmentId]` 单例），按钮文案切换「生成中...」；`isSegmentBusy` 返回布尔（disabled），`segmentBusyKind` 返回类型标识（文案分支，2026-08-14 修复：原 Boolean 实现导致「生成中/重试中」文案永不显示）。
- 【生成新图】【生成 AI 视频】失败：错误经 resolveStory2VideoNotification 归一化后弹窗提示，并刷新素材 URL；失败保留旧素材和旧选中态。
- 【再次合成视频】与【重新合成】并列：busy 共用 `recomposing`；`recomposeProject` 成功后刷新项目与素材 URL。
- 预览弹窗：UiModal xl 尺寸；图片显示大图，video1/video2 都显示 `<video controls autoplay>`；空素材保持固定 media frame，不打开弹窗。

#### 6) 显示项

- 场景素材区标题「场景素材」+ 提示「点击可放大预览」；
- 槽位标签：图片 1 / 图片 2 / 视频 1 / 视频 2（zh）/ Image 1 / Image 2 / Video 1 / Video 2（en）；
- 空槽占位「未生成」/「Not generated」，每个空 media frame 只显示一行本地化文案；选中徽标「当前使用」/「In Use」。
- 卡内按钮：「生成新图」「生成 AI 视频」，分别只出现在 image1/video1 卡内；busy 时显示对应本地化生成中状态并禁用；底部保留「再次合成视频」「合成中...」。
- 成功通知：新图片已生成 / 场景视频已生成 / 已切换使用素材；失败通知：见提示文字。

#### 7) 提示文字（zh / en）

| key | zh | en |
|-----|----|----|
| story2video.scene_image_generated | 新图片已生成。 | A new image has been generated. |
| story2video.scene_video_generated | 场景视频已生成。 | The scene video has been generated. |
| story2video.material_selected | 已切换使用素材。 | Material switched. |
| story2video.scene_audio_missing | 该场景没有旁白音频，无法生成视频。 | This scene has no narration audio and cannot generate a video. |
| story2video.scene_image_missing | 该场景没有可用的图片素材，请先生成图片。 | No usable image material for this scene; generate an image first. |
| story2video.scene_slot_empty | 该素材槽位暂无素材，请先生成素材。 | This material slot is empty; generate material first. |
| story2video.sceneMaterial.* | 见 locales zh/en 成对（title/image1Label/image2Label/videoLabel/emptySlot/selectedBadge/generateImage/generateVideo/generating/selectAriaLabel/emptyAriaLabel/previewHint/previewImageTitle/previewVideoTitle/recomposeFinal/recomposingFinal/recomposeFinalHint） | 同左成对 |

#### 8) 安全边界

- 新 IPC 通道全量走 `withSenderCheck` + 白名单 id 校验 + `story2video_write` 权限映射；
- 所有素材路径经 `_copyRequired`/`resolveReadableMediaFile` 受控复制到项目目录，UI 只接触项目内副本；
- `_cleanupUnreferencedProjectFiles` 将 `alternateImages[].path` 纳入引用集，替换素材时旧文件安全清理，不误删在用备选图；
- `generateSceneVideo` 渲染输出与失败产物落在项目目录 attemptFiles 集，失败清理不越界（`isPathWithin` 受控）。

#### 9) 测试要求

- 服务层（story2video-project-service.test.js）：槽位规则 4 分支、生成失败回滚、select 校验（非法 kind/空槽）、`_scenesForCompose` 四态、saveRun manual 富化、备选图纳入引用清理、旧项目兼容；
- preload.test.js：新方法通道转发 + 数量断言（92 / 282 / 80）；
- ResultView.test.js：4 个视觉卡固定顺序与选中态、thumbnail-only preview、radio-only selection、video kind 归一、按钮只渲染一次、busy 态、空框/URL 失效、再次合成调用 recompose、成功/失败通知归一化；
- locale：zh/en 成对 + CI Gate 7（check-locale-sync）通过；渲染端无新增中文字面量。

### 3.1.28 历史记录状态标签、统一排序与非运行任务编辑（2026-08-20）

> **术语与流转更新（2026-08-17）**：本节中的“详情页/详情弹窗”已由「视频任务编辑页」替代。符合编辑条件的历史卡片直接进入编辑页；不会再打开独立只读详情弹窗。完整的固定操作栏、暂停、状态卡片和编辑交互合同见 `PRD-S2V-PIPELINE-PAGE-UX.md`。

历史记录页面打开后默认选择“全部”。所有任务（包括筛选后的单一状态）按有效更新时间倒序排列，不再按状态分组。有效更新时间按以下优先级读取：`updatedAt` → `updated_at` → `completedAt` → `completed_at` → `endedAt` → `ended_at` → `createdAt` → `created_at`；字段接受 ISO 日期字符串及有限数字时间戳，绝对值小于 `1e11` 的数字按秒转换，其余按毫秒转换。空值、空白字符串、非有限数字和无效日期视为缺失；缺失更新时间时回退有效创建时间，再缺失则按 0 排在有时间记录之后。相同有效更新时间按创建时间倒序，再按首个非空 `id`/`projectId`/`runId` 字典序，最后保持原始输入顺序。时间戳 0 是有效时间，不能误判为空。全部任务和每个状态筛选复用同一排序函数，状态筛选为严格相等，`failed` 不并入 `paused`。当同一任务同时存在项目草稿和流水线运行记录时，历史卡片合并两者：项目提供标题、文案、分段和素材；运行记录提供状态、阶段、错误、检查点、耗时与运行时间，禁止重复显示两张卡片。

状态选择使用六个可访问标签：全部、进行中、已暂停、执行失败、已完成、已取消。标签容器为 `tablist`，标签为 `tab`，当前项使用 `aria-selected=true` 和 roving tabindex；支持鼠标点击、Enter/Space、左右方向键、Home/End，切换只改变筛选条件，不触发恢复或写入。

每张卡片统一展示标题、流水线、状态、文案预览、首场景缩略图、有效更新时间、创建时间、任务耗时、视频时长、模式、任务/项目标识和阶段摘要。标题为空时按 `title → params.title/publishTitle → sourceText/text/场景文案 → 流水线名 → 未命名任务` 回退；文案预览只读取任务文案，最多 120 个 JavaScript 字符，超长追加 `…`，不使用图片/视频提示词替代。视频时长只读取明确的成片/视频时长字段，流水线执行耗时仍单独显示为“耗时”。暂停任务额外显示已本地化的暂停环节及暂停环境/检查点；失败任务额外显示失败环节和自然语言“失败原因”，不得直接展示 `Story2Video optimize failed`、HTTP 状态码或模型原始错误对象。

已启动且有有效 `projectId` 的 paused、failed、completed、cancelled 卡片 body 或“编辑”动作进入视频任务编辑页；进入不会自动恢复、继续、暂停、取消或删除。running 卡片不从主体进入编辑页，继续使用流水线控制入口；没有 `projectId` 的纯 pipeline run 记录不得伪造编辑页项目；cancelled 项目可以查看、修改和保存，但不显示或执行“从断点继续”。

恢复、继续生成、打开结果、删除均为独立显式操作，点击这些按钮不会打开详情，也不会隐式恢复任务。轮询更新会重新应用有效时间排序，同时通过原数组 `splice` 保持响应式列表身份。未改动 IPC、持久化结构、过期任务清理或恢复引擎；仅调整 renderer 展示、交互和纯排序工具。

验收必须覆盖 ISO/秒/毫秒/0/非法时间、同时间 tie-break、全部与状态筛选一致排序、六标签 ARIA/键盘行为、标题/文案回退、图片优先和视频首帧缩略图、视频时长与执行耗时分离、暂停/失败本地化字段、running 不进入编辑、四种非运行项目状态可编辑、纯 run 不伪造项目、显式动作不冒泡、轮询重排和中英文 locale 成对校验。

### 3.1.29 历史记录场景内容编辑、重新生成与整片重合成（2026-08-15）

> **术语与流转更新（2026-08-17）**：本节中的“结果页/详情弹窗/编辑并重新合成”分别统一为「视频任务编辑页 / 不再使用 / 编辑」。历史入口携带项目与运行标识直接进入编辑页；当前页面与数据校验合同见 `PRD-S2V-PIPELINE-PAGE-UX.md`。

**需求**：「视频创作-历史记录」中已经启动流水线且不处于 running 的项目任务，其每个场景的内容组成元素（本场景文案、字幕、语音、图片/视频优化词、图片、视频）应可进入视频任务编辑页修改；此前终态范围不完整，且缺少统一的缺失素材占位。本迭代为 paused、failed、completed、cancelled 项目补齐完整闭环：**文本类元素可修改**（场景文案、字幕块、视频优化词、语音设置），**生成类元素可重新生成**（字幕、旁白语音、图片/视频优化词；图片/视频素材沿用既有【生成新图】【生成视频】），修改/重新生成后通过【保存分段】+【重新合成】生成新成片；running 仍由流水线控制页管理，不从历史卡片主体进入编辑页。

#### 1) 数据模型（分段新增/扩展字段）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `segment.subtitleBlocks` | string[] | 数组取前 200 块、每块 ≤500 字符、过滤空值 | 字幕块（每块一句）；与 `subtitleTimeline` 区分：timeline 是带时间轴的字幕（compose 输出），blocks 是纯文本字幕（可编辑、可重切） |
| `segment.videoPrompt` | string \| null | ≤40000 字符 | 视频优化词（video-prompt-engine 输出，compose 消费；2026-08-16 由 20000 上浮） |
| `segment.voiceId` | string | ≤160 字符 | 场景级音色 ID，留空回退项目默认音色 |
| `segment.voiceProvider` / `segment.voiceModel` | string | 各 ≤160 字符 | 场景级语音 provider/model（透传保留） |
| `segment.voiceSpeed` / `segment.voicePitch` | number | speed 收敛 [0.5, 2]、pitch 收敛 [-12, 12] | 语速倍率 / 音调（支持负值=低沉、0=中性，与 CreateView 滑杆及 story2video-text-config 契约一致）；非有限数字回退原值 |
| `segment.voiceEmotion` | string | ≤80 字符 | 情绪参数（如 calm/cheerful），可选 |

- `subtitleTimeline` 为**派生数据**：字幕重新生成时清空，合成时按新字幕块重建时间轴，避免陈旧时间轴与新字幕错位。
- 兼容旧项目：未保存过新字段的旧分段字段缺省，UI 展示空值、保存时按白名单透传即可。

#### 2) 数据校验（服务端 fail-closed）

- `updateSegments` 白名单扩展：仅接受 `text / prompt / videoPrompt / subtitleBlocks / subtitleTimeline / voiceId / voiceProvider / voiceModel / voiceSpeed / voicePitch / voiceEmotion`；白名单外字段（imagePath/videoPath/audioPath 等）一律忽略（不覆盖、不落库）。
- 所有文本字段经 `safeText` 限长收敛（videoPrompt 40000、voiceId/Provider/Model 160、voiceEmotion 80、text 10000、prompt 20000）；`subtitleBlocks` 经 `safeSubtitleBlocks`（≤200 块 × ≤500 字符、过滤空值）；`voiceSpeed` 经 `safeVoiceSpeed` 收敛 [0.5, 2]、`voicePitch` 经 `safeVoicePitch` 收敛 [-12, 12]（拆分为两个收敛函数，避免共用收敛把 pitch 0/负值篡改为 0.1，审查 W1），非有限数字回退原值。
- **videoPrompt 持久化回填（C1）**：compose 输出分段不含 `videoPrompt`（`normalizeComposeScenes` 白名单丢弃），`_persistComposeArtifacts` 按 index 从 fallback 分段回填（流水线 saveRun 主路径与 recomposeProject 均覆盖），重新合成后视频优化词不会丢失；recomposeProject 恢复映射 `videoPrompt: original.videoPrompt || segment.videoPrompt || null` 兜底。
- IPC 层三个新通道 `story2video:regenerate-scene-subtitle / regenerate-scene-audio / regenerate-scene-prompt`：均 `withSenderCheck` + `isSafeId`（projectId/segmentId）+ 参数类型校验；`regenerate-scene-prompt` 的 `kind` 白名单 `['image','video']`，非法值抛「优化词类型无效」；失败统一 `VALIDATION_ERROR`。license-access-control 均映射 `story2video_write`。
- 重新生成前置校验（fail-closed）：
  - 字幕：场景无 `text` → 「该场景没有旁白文字，无法重新生成字幕」；`splitSubtitleBlocks` 拆不出块 → 「该场景无法拆分字幕」。
  - 旁白：场景无 `text` → 「该场景没有旁白文字，无法生成语音」；`assetGenerator.generateTTS` 不可用 → 「语音生成服务不可用」。
  - 优化词：场景无 `text` → 「该场景没有旁白文字，无法重新生成优化词」；`serviceBus.optimizePrompt/optimizeVideoPrompt` 不可用 → 「提示词优化服务不可用」；优化结果提取为空/含 error → 「提示词优化结果无效」（fail-closed，不写库）。

#### 3) 流程

```
历史记录 → 可编辑任务 → 卡片【编辑】 → 视频任务编辑页（ResultView）
  ├─ 场景区：文案 textarea + 字幕 textarea（每行一句）+ 视频优化词 textarea + 语音设置网格 + 素材槽/生成按钮
  ├─ 修改文本类元素（文案/字幕/视频优化词/音色/语速/音调/情绪）→ 标脏 →【保存分段】
  ├─ 【重新生成字幕】→ 本地按文案重切字幕块 → 清空时间轴 → 成功/失败通知
  ├─ 【重新生成旁白】→ 按场景/项目语音设置调 TTS → 替换 audioPath → 成功/失败通知
  ├─ 【重新生成图片优化词/视频优化词】→ prompt-engine → 重写 prompt/videoPrompt → 成功/失败通知
  ├─ 【生成新图】【生成视频】→ 沿用 3.1.26 素材生成逻辑
  └─ 【重新合成】→ 以最新分段内容 + 素材 + 语音设置整片重合成 → 新成片预览
```

#### 4) 功能逻辑

- **保存分段**：透传编辑后的新字段到 `updateSegments`；服务端白名单收敛后整体落库；返回的 segments 回写 UI；保存失败保持编辑态并提示。
- **重新生成字幕**：不消耗外部额度；按 `splitSubtitleBlocks(segment.text)` 本地分句重切，替换 `subtitleBlocks` 并清空 `subtitleTimeline`；成功置 `status='completed'`、`error=null`、`subtitleSource='local-typescript'`（重置旧失败状态与来源标记，审查 I2）。
- **重新生成旁白**：用 `segment.voiceId || project.options.voiceId`（provider/model/speed/pitch/emotion 同理，段级优先）调用 `generateTTS`（带时间戳）；成功复制音频到项目目录（`segment.id_audio_tts_<ts>.<ext>`）替换 `audioPath` + `audioMeta`；**失败保留旧音频**、清理本次 attemptFiles、回写 `status='failed'` + error，不吞错。
- **重新生成优化词**：`kind=image` → `serviceBus.optimizePrompt(segment.text)` → 重写 `prompt` 并**清空 `promptTranslation`**（提示词变化后旧翻译失效）；`kind=video` → `serviceBus.optimizeVideoPrompt(segment.text)` → 重写 `videoPrompt`；成功置 completed，失败不改动分段。
- **整片重新合成**：沿用既有 `story2video:recompose-project`；合成消费最新分段内容（text/prompt/videoPrompt/subtitleBlocks/voice 设置/素材选中态）。
- **同项目写串行（W2）**：主进程对同一 `projectId` 的保存分段/整片重合成/三种重新生成统一经 `_serializeProject` per-project promise 队列串行执行（read-modify-write 全程持锁），杜绝跨段并发或「保存」与「重新生成」竞态互相覆盖；队列执行后自动清理，不泄漏。
- **重新生成前自动保存（W3）**：渲染端检测到未落盘编辑（`segmentsDirty`）时，先调用保存分段再执行重新生成，确保重切/TTS/优化基于最新文案，且服务端响应不会覆盖本地编辑；响应按整项目回写并重新解析素材 URL。

#### 5) 交互逻辑

- 场景卡片新增可编辑区块：字幕 textarea（`subtitleBlocksText` 合并展示、`updateSegmentSubtitleBlocks` 按行拆分，行内 trim + 过滤空行；**手动编辑后同步清空 `subtitleTimeline`，清空输入框后不再回退旧时间轴**，审查 I1）；视频优化词 textarea；语音设置网格（音色 ID / 语速 / 音调 / 情绪）。
- 语音输入框边界与流水线契约一致（W1）：语速 `min=0.5 max=2 step=0.1`、音调 `min=-12 max=12 step=0.1`（支持负值低沉音色）。
- 每个生成按钮在对应场景 busy 时禁用：`segmentBusy` 键 `subtitle`（字幕）/ `tts`（旁白）/ `promptImage` / `promptVideo`；按钮文案切换「重新生成字幕 ↔ 字幕生成中...」「重新生成旁白 ↔ 旁白生成中...」「重新生成图片/视频优化词 ↔ 优化词生成中...」。**任一分段 busy 时（`anySegmentBusy`）同时禁用全局【保存分段】与【重新合成】，避免与主进程写队列交叉（W2）。**
- 重新生成成功后自动刷新 project + segments，并提示「请保存分段后重新合成」；失败按错误归一化提示（见下表），不中断其他场景操作。
- 语音设置仅在【重新生成旁白】时生效（作为 TTS 参数）；修改后同样需【保存分段】持久化。
- 历史记录入口：paused、failed、completed、cancelled 且存在有效 `projectId`、并确认流水线已启动的任务卡片显示【编辑】（`editAndRecompose`），点击跳转视频任务编辑页并携带项目上下文；running 任务保留流水线控制入口；无 `projectId` 的记录不显示编辑入口，不能由 `runId` 伪造项目。
- 原“详情弹窗场景列表”仅作为历史版本记录保留；当前不创建只读弹窗，分段内容、提示词、素材和错误信息均在视频任务编辑页查看与修改。

#### 6) 提示文字（locales zh/en 成对）

| key | 中文 | English |
|------|------|---------|
| story2video.sceneMaterial.editRecomposeHint | 修改文案、字幕、语音或优化词后，点击「保存分段」，再点击「重新合成」生成新视频 | Edit text, subtitles, voice or prompts, click "Save segments", then "Recompose" to generate a new video. |
| story2video.sceneMaterial.subtitleLabel | 字幕（每行一句） | Subtitles (one line per block) |
| story2video.sceneMaterial.regenerateSubtitle | 重新生成字幕 | Regenerate subtitles |
| story2video.sceneMaterial.regeneratingSubtitle | 字幕生成中... | Regenerating subtitles... |
| story2video.sceneMaterial.videoPromptLabel | 视频优化词 | Video prompt |
| story2video.sceneMaterial.regenerateImagePrompt | 重新生成图片优化词 | Regenerate image prompt |
| story2video.sceneMaterial.regenerateVideoPrompt | 重新生成视频优化词 | Regenerate video prompt |
| story2video.sceneMaterial.regeneratingPrompt | 优化词生成中... | Regenerating prompt... |
| story2video.sceneMaterial.voiceSettingsLabel | 语音设置（重新生成旁白时使用） | Voice settings (used when regenerating narration) |
| story2video.sceneMaterial.voiceIdLabel | 音色 ID | Voice ID |
| story2video.sceneMaterial.voiceIdPlaceholder | 留空使用项目默认音色 | Leave empty to use project default |
| story2video.sceneMaterial.voiceSpeedLabel | 语速 | Speed |
| story2video.sceneMaterial.voicePitchLabel | 音调 | Pitch |
| story2video.sceneMaterial.voiceEmotionLabel | 情绪 | Emotion |
| story2video.sceneMaterial.voiceEmotionPlaceholder | 如 calm、cheerful（可选） | e.g. calm, cheerful (optional) |
| story2video.scene_subtitle_regenerated | 字幕已重新生成，请保存分段后重新合成。 | Subtitles regenerated. Save segments and recompose. |
| story2video.scene_subtitle_regenerate_failed | 字幕重新生成失败，请稍后再试。 | Failed to regenerate subtitles. Please try again. |
| story2video.scene_audio_regenerated | 旁白已重新生成，请保存分段后重新合成。 | Narration regenerated. Save segments and recompose. |
| story2video.scene_audio_regenerate_failed | 旁白重新生成失败，请检查音色/语音设置后重试。 | Failed to regenerate narration. Check voice settings and retry. |
| story2video.scene_prompt_regenerated | 优化词已重新生成，请保存分段后重新合成。 | Prompt regenerated. Save segments and recompose. |
| story2video.scene_prompt_regenerate_failed | 优化词重新生成失败，请稍后再试。 | Failed to regenerate prompt. Please try again. |
| create.history.editAndRecompose | 编辑 | Edit |
| create.history.sceneListLabel | 场景列表 | Scenes |
| create.history.sceneListHint | 点击「编辑」进入视频任务编辑页：可修改每个场景的文案、字幕、语音设置与图片/视频优化词，重新生成字幕/旁白/图片/视频，最后重新合成整片。 | Click "Edit" to open the video task editor: modify each scene's text, subtitles, voice settings and image/video prompts, regenerate subtitles/narration/images/videos, then recompose the whole video. |

- 失败错误归一化（story2video-notifications.js `resolveMessageKey`）：含「无法重新生成字幕/无法拆分字幕」或 `subtitle.*(regenerat|split).*(fail|unavailable|invalid)` → `scene_subtitle_regenerate_failed`；含「无法生成语音/语音生成服务不可用/无法重新生成旁白」或 `tts.*(fail|unavailable|invalid)` → `scene_audio_regenerate_failed`；含「无法重新生成优化词/提示词优化服务不可用/优化词类型无效/优化结果无效」或 `prompt.*(regenerat|optimiz).*(fail|unavailable|invalid)` → `scene_prompt_regenerate_failed`（中英文均覆盖）。

#### 7) 安全边界

- 三个新 IPC 通道全量 `withSenderCheck` + `isSafeId` + `story2video_write` 权限映射；无新增文件越界（旁白产物走 `_copyRequired` + `_cleanupUnreferencedProjectFiles` 引用集）。
- `updateSegments` 白名单外字段不落库，杜绝通过分段更新注入不可信路径/素材。
- 渲染端无新增中文字面量（全部走 locales 成对）；CI Gate 7 check-locale-sync 拦截。

#### 8) 测试要求

- 服务层（story2video-project-service.test.js）：`safeVoiceSpeed`/`safeVoicePitch` 收敛（speed 0/负数/超大/非法、pitch 负值原样保留）、`extractOptimizedPrompt` 多结构、updateSegments 新字段透传 + 白名单外忽略 + 限长收敛、regenerateSceneSubtitle（清 timeline/无文案 fail/重置 error+subtitleSource）、regenerateSceneAudio（成功替换/失败回滚保留旧音频 + 回写 failed）、regenerateScenePrompt（image 清 translation / video 写 videoPrompt / 非法 kind / 空结果 fail）、recompose 保留 videoPrompt（compose 回显缺省时从项目原值回填，C1 回归）、`_serializeProject` 同项目写串行且队列不泄漏（W2 回归）；
- IPC（story2video.test.js）：三通道可信来源/非法 id/非法 kind 拒绝 + 参数校验；保存/重合成/三种重新生成均经 `_serializeProject` 队列（W2 回归断言 5 次包裹 + projectId 透传）；
- preload.test.js：新方法通道转发 + 数量断言（99 / 289 / 87）；
- ResultView.test.js：保存透传新字段、字幕 textarea 编辑拆分（含清空不回退旧时间轴/手动编辑清时间轴，I1 回归）、三按钮成功/失败通知、重新生成前自动保存（W3 回归）、任一分段 busy 禁用保存与重新合成（W2 回归）；
- CreateViewHistory.test.js：编辑动作渲染/跳转、历史卡片内联场景提示与提示文案；
- locale：zh/en 成对 + check-locale-sync 通过；渲染端无新增中文字面量。


#### 3.1.29.1 AI 视频重新生成（W4 闭环：videoPrompt 消费路径，2026-08-16）

**背景（W4 真缺口）**：3.1.29 交付后，历史场景的「视频优化词」可编辑、可重新生成，但结果页既有【生成视频】按钮走 `generateSceneVideo`（图片动效渲染，不消费 `videoPrompt`、不调用 AI 视频生成），导致「修改视频优化词后重新生成视频」没有落地路径——AI 视频生成此前只存在于流水线 generate_assets 阶段。本小节补齐：**分段级 AI 视频重新生成**，以 `videoPrompt`（缺省回退 `prompt`/`text`）为提示词，复用流水线同一 stages 契约（generateVideo 提交 → getVideoStatus 轮询 → 下载校验），成功后替换分段 `videoPath`，失败保留旧视频并回写失败态。

##### 1) 数据校验（服务端 fail-closed）

- 输入：`projectId` / `segmentId` 必须通过 `isSafeId`（`[a-zA-Z0-9_-]{1,100}`）；分段不存在 → 「分段不存在」。
- 提示词前置校验：`segment.videoPrompt || segment.prompt || segment.text` 经 `safeText(..., 20000)` 收敛；全部为空 → 拒绝并提示「该场景没有视频优化词，请先编辑或重新生成视频优化词」（**不调用生成器、不改动分段状态**）。
- 服务可用性前置校验（fail-closed，不调用生成器）：
  - `modelProviderManager` 缺失或 `callAdapter`/`getDefault` 不可用 → 「AI 视频生成服务不可用，请在模型设置中启用视频供应商」；
  - 默认 video 供应商解析失败（`getDefault('video')` 无 id）→ 「未配置可用的视频供应商，请在模型设置中启用视频生成能力」。
- 生成尺寸 `_videoSize`：优先解析 `project.options.resolution`（支持 `WxH`/`W×H`，160..4096 边界，`parseOutputSize` 非法回退比例映射）；否则按 `options.aspectRatio` 映射（16:9→1280x720、9:16→720x1280、1:1→1024x1024、4:3→1280x960、3:4→960x1280，未知比例回退 9:16），长边封顶 1280（与流水线 `resolveVideoSize` 同源语义）。
- 帧率 `fps`：`project.options.fps` 为正数则透传，否则默认 30；stages 内部再做 `pickFrameCountForSceneDuration` 帧数换算。
- 轮询间隔：`project.options.video.pollIntervalMs` 为正数则透传，否则默认 10000ms（与流水线 `stage.options.video.pollIntervalMs` 同参名契约）。
- 时长估算：复用 stages `estimateSceneSeconds`（`segment.duration` + `options.defaultSceneDuration` 兜底）。
- 模型选择 `_defaultVideoGenerator`：`manager.getDefault('video')` 的 provider；`category === 'multimodal'` 且 `capability_models.video` 为字符串时优先取能力模型（须在 `models` 列表内，否则用能力模型原值；models 为空时回退能力模型），否则取 `models[0]`；provider id 必填（trim 后非空），model 可为空串（stages 层按 undefined 处理）。

##### 2) 流程与功能逻辑

```
结果页（历史记录场景）→【生成 AI 视频】
  ├─ 前置：segmentsDirty 时先【保存分段】（W3 语义：基于最新 videoPrompt，防响应覆盖本地编辑）
  ├─ 服务端 generateSceneAiVideo(projectId, segmentId)（_serializeProject 同项目写串行队列内执行）
  │    ├─ 解析提示词/供应商/尺寸/fps/时长（见上）
  │    ├─ 复用 stages.generateSceneVideo：generateVideo 提交（prompt/model/width/height/numFrames/frameRate）→
  │    │     getVideoStatus 轮询（≤10 分钟；provider code<0/success=false/status failed|error|cancelled 立即终止）→
  │    │     http(s) 下载（≤5 重定向、流式字节上限）→ ffprobe 解码校验
  │    ├─ 成功：_copyRequired 复制到项目目录（segment.id_video_ai_<ts>.mp4），替换 segment.videoPath，
  │    │        videoMeta={provider, model, source:'ai-video'}，status='completed'，持久化后按引用集清理旧素材
  │    └─ 失败：保留旧 videoPath、清理本次 attemptFiles、回写 status='failed'+error，异常上抛（不吞错）
  └─ 渲染端：成功 → 整项目回写 + segmentsDirty=true + 重新解析素材 URL（refreshSegmentImageUrls）+
      提示「AI 视频已生成，请保存分段后重新合成。」；失败 → 归一化失败提示
```

- 与流水线一致性：同一 `generateSceneVideo` stages 契约与下载/校验守卫（2026-08-11 W3/W5：错误终止态不空转、仅 http/https 下载、probe 校验），避免历史记录重新生成的视频质量与新建流水线不一致。
- 清理语义：成功路径旧 `videoPath` 随 `_cleanupUnreferencedProjectFiles` 引用集删除；失败路径 attemptFiles（本次复制目标）经 `_cleanupProjectFiles` 清理，旧视频保留。
- 注入点：`generateSceneVideoStage` / `estimateSceneSecondsStage` 通过构造器可注入（缺省为 stages 导出），便于单测隔离且不改变生产装配（phase1-context 注入 `modelProviderManager` 后即用）。

##### 3) 交互逻辑

- 位置：场景「视频优化词」输入区操作行，紧随【重新生成视频优化词】按钮之后。
- 按钮：【生成 AI 视频】（`data-testid="generate-ai-video-button"`）；场景 busy 或 `segment.videoPrompt` 为空时禁用，空提示词时按钮 title 显示「请先编辑或重新生成视频优化词，再生成 AI 视频」（不弹错，直接禁用引导）。
- busy 状态：`segmentBusy[segmentId] = 'aiVideo'`；busy 期间按钮文案切换「AI 视频生成中...」，且该场景其他生成按钮同步禁用（`isSegmentBusy`）；`anySegmentBusy` 联动禁用全局【保存分段】【重新合成】。
- 成功：整项目回写 + 素材 URL 重新解析（video 槽预览更新为 AI 视频）+ 成功通知；`segmentsDirty=true` 提示用户保存后重合成。
- 失败：按错误归一化弹窗提示（见提示文字），不中断其他场景操作；旧视频保留在素材槽可继续使用。
- 与【生成视频】（图片动效渲染）关系：两者并存——【生成视频】为无供应商兜底渲染路径；【生成 AI 视频】为 AI 视频生成路径（消费 videoPrompt）。用户可任选其一，最新一次生成的素材替换 video 槽。

##### 4) 提示文字（locales zh/en 成对）

| key | 中文 | English |
|------|------|---------|
| story2video.sceneMaterial.generateAiVideo | 生成 AI 视频 | Generate AI video |
| story2video.sceneMaterial.generatingAiVideo | AI 视频生成中... | Generating AI video... |
| story2video.sceneMaterial.aiVideoNeedsPromptHint | 请先编辑或重新生成视频优化词，再生成 AI 视频 | Edit or regenerate the video prompt first, then generate the AI video |
| story2video.scene_ai_video_generated | AI 视频已生成，请保存分段后重新合成。 | AI video generated. Save segments and recompose. |
| story2video.scene_ai_video_generate_failed | AI 视频生成失败，请检查视频供应商配置后重试。 | AI video generation failed. Check the video provider configuration and retry. |

- 失败错误归一化（story2video-notifications.js `resolveMessageKey`，顺序在 SCENE_PROMPT_REGENERATE_FAILED 之后锚定，避免误归）：含「无法生成 AI 视频 / 未配置可用的视频供应商 / AI 视频生成服务不可用 / 视频生成（调用失败|任务失败|未返回任务|超时或失败|下载超过|文件无法解码|任务状态为）」或 `ai video.*(fail|unavailable|invalid)` → `scene_ai_video_generate_failed`；该场景没有视频优化词（前置校验）同样归一化到该失败提示（文案已内含操作指引）。

##### 5) 安全边界

- IPC 通道 `story2video:generate-scene-ai-video`：`withSenderCheck`（不可信 sender 拒绝）+ `isSafeId` 双参数 + 参数类型校验；失败 `VALIDATION_ERROR`；license-access-control 映射 `story2video_write`（登录即可用，与同级生成通道一致）。
- 素材路径：AI 视频产物经 `_copyRequired`（受控根 `projectsDir`/`STORY2VIDEO_TEMP_DIR` 内校验 + 字节上限）复制；下载仅允许 http/https（stages W5 守卫），轮询超时上限 10 分钟。
- 渲染端无新增中文字面量（全部走 locales 成对）；CI Gate 7 check-locale-sync 拦截。

##### 6) 测试要求

- 服务层（story2video-project-service.test.js「AI 视频重新生成（W4）」describe）：成功替换 videoPath/videoMeta（provider/model/source='ai-video'）+ 旧素材按引用集清理 + stages 调用参数（providerId/model/prompt/size/fps + manager 透传）；videoPrompt 缺省回退 prompt；无任何文案 fail-closed 不调生成器且状态不变；未配置视频供应商 / 服务不可用 fail-closed；失败保留旧视频 + 回写 failed + 清理本次产物；multimodal `capability_models.video` 选模型 + `resolution` 解析尺寸。
- IPC（story2video.test.js）：新通道不可信来源 / 非法 id 拒绝且不调服务；成功路径经 `_serializeProject` 队列（断言次数 6 与参数透传）。
- ResultView.test.js：按钮渲染 + 无 videoPrompt 禁用 + title 提示；成功通知 + 预保存 + 分段回写；失败归一化通知。
- preload.test.js：`story2videoGenerateSceneAiVideo` 通道转发 + 数量断言（100 / 290 / 88）。
- notifications：中英文 AI 视频失败归一化（含「未配置可用的视频供应商」「视频生成调用失败」「ai video generation failed」）。
- locale：zh/en 成对 + check-locale-sync 通过；preload bundle 重新构建并含新通道行。

#### 3.1.29.2 历史记录重生成增强：串行队列全覆盖与瞬时重试（2026-08-16）

**背景**：3.1.29/3.1.29.1 交付后，双模型审查发现两类遗留问题：① `replace-segment-audio`、`retry-segment`、`select-scene-material`、`generate-scene-image`、`generate-scene-video` 五个写通道绕过 `_serializeProject` 同项目串行队列直接调用服务，用户并发（快速连点/多窗口）时多个写操作可能交错读写同一项目文件，产生互相覆盖或部分写入竞态；② 历史记录「生成 AI 视频」直接调用 stage 一次，provider 瞬时限流/网络超时（如 `request timed out`）即失败，与流水线 generate_assets 阶段的有界重试行为不一致。本小节补齐 W4（队列全覆盖）+ W5（瞬时重试）。

##### 1) 数据校验与并发控制（W4）

- **写通道清单**（以下通道全部经 `requireProjectService()._serializeProject(projectId, () => serviceMethod(...))` 执行，同项目串行、跨项目并行）：

| 通道 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `story2video:replace-segment-audio` | `replaceSegmentAudio` | projectId / segmentId / filePath | 替换旁白（受控媒体临时副本） |
| `story2video:retry-segment` | `retrySegment` | projectId / segmentId / mode(image\|video) | 分段重试 |
| `story2video:select-scene-material` | `selectSceneMaterial` | projectId / segmentId / kind(image1\|image2\|video) | 场景素材选择（由同步返回改为异步透传，返回语义不变） |
| `story2video:generate-scene-image` | `generateSceneImage` | projectId / segmentId | 生成新图 |
| `story2video:generate-scene-video` | `generateSceneVideo` | projectId / segmentId | 生成视频（图片动效渲染） |
| `story2video:delete-project` | `deleteProject` | projectId | 删除项目（入队防「删除后队列任务复活项目」竞态，审查 M3） |

- **入队语义**：参数校验在入队前完成（非法参数直接 `VALIDATION_ERROR`，不进入队列）；服务方法异常经 catch 归一化为 `REQUEST_ERROR` + 透传 message（含 `_serializeProject` 未暴露时的兜底，不静默降级）。
- **覆盖完整性**：连同既有入队通道（`update-segments` / `recompose-project` / `regenerate-scene-subtitle` / `regenerate-scene-audio` / `regenerate-scene-prompt` / `generate-scene-ai-video`）与 `delete-project`，历史记录**全部写路径（含删除）**同项目串行化；「保存分段」「重新合成」「删除」与「任意重新生成/素材替换/选择」不再并发交错（删除入队同时消除「删除后队列内任务 `_upsertProject` 复活项目」竞态）。

##### 2) 瞬时错误重试（W5）

- **注入点**：`Story2VideoProjectService` 构造器新增可注入 `assetRetry`（`options.assetRetry`），缺省为 `story2video-stages.withAssetTransientRetry`（与流水线 generate_assets 同一函数，单一来源，参数漂移风险为零）。
- **重试范围**：仅对瞬时错误重试——抛错或结果对象命中 `isTransientErrorLike`（timeout / network / 429 限流类，如 `request timed out`）；内容政策检查点、模型配置、参数校验等非瞬时失败原样返回/上抛，不重试。
- **轮询超时/任务终态不重试（审查 M1）**：历史交互路径的默认重试包装排除「视频生成超时或失败」「视频生成任务失败」「视频生成任务状态为」三类文案——它们代表**任务已提交后的**轮询超时或 provider 终止态，整体重试等于重新提交计费任务（最坏 3 次计费 + 30 分钟队列持锁）。提交阶段（`generateVideo` 调用、任务 ID 缺失）与下载阶段的瞬时错误仍正常重试。流水线路径（stages 默认参数）行为不变。
- **有界退避**：普通瞬时错误最多 3 次（`maxAttempts=3`）、限流最多 4 次（`rateLimitMaxAttempts=4`），退避 `800ms×attempt`（限流 `2500ms×attempt`），不无限重试。
- **fail-closed 语义不变**：重试仅包在 `generateSceneVideoStage` 调用外；重试耗尽返回 `{code:-1, message}` 或最后一次 outcome，由 `generateSceneAiVideo` 既有守卫（`!outcome.success || !outcome.path` → throw）失败上抛，**旧视频保留、分段回写 failed、本次产物清理**——与 3.1.29.1 完全一致。守卫读取 `outcome.error || outcome.message`（审查 M2：抛错路径耗尽时真实瞬时错误文案经 `{code:-1,message}` 保留，不再退化为兜底「AI 视频生成失败」）。

##### 3) 流程与功能逻辑

```
用户操作 → IPC 通道（withSenderCheck + isSafeId + 参数校验）
  └─ _serializeProject(projectId, task)：同项目写串行队列
       ├─ replace-segment-audio / retry-segment / select-scene-material /
       │  generate-scene-image / generate-scene-video / 既有 6 通道
       └─ generateSceneAiVideo：assetRetry(() => generateSceneVideoStage({...}))
            ├─ 瞬时错误 → 退避重试（最多 3 次 / 限流 4 次）
            ├─ 成功 → 产物落盘替换（见 3.1.29.1）
            └─ 重试耗尽/非瞬时失败 → throw → REQUEST_ERROR 透传
```

##### 4) 提示文字

- 本变更**无新增用户可见文案**（重试为服务端透明行为；队列串行为既有机制补全，不影响 UI 文案）。失败提示沿用 3.1.29.1 的 `scene_ai_video_generate_failed` 归一化文案；瞬时失败重试后成功不产生任何失败提示。

##### 5) 测试要求

- IPC（`story2video.test.js`）：主 mock 增加 `selectSceneMaterial/generateSceneImage/generateSceneVideo`；`_serializeProject` 队列断言 6→**12**（含 3 个新通道 + `delete-project` 入队与参数透传）；「替换旁白」成功/失败两个用例的 mock 补齐 `_serializeProject`（验证队列包装不改变清理语义）。
- 服务层（`story2video-project-service.test.js`）：「AI 视频生成经注入 assetRetry 包装，瞬时失败重试后成功」（stage 抛错 1 次 → 第 2 次成功，断言调用 2 次、重试原因、产物替换、status=completed）；「默认 withAssetTransientRetry 对瞬时错误重试后成功」（stage 返回 `{success:false, error:'request timed out'}` → 成功，断言调用 2 次、产物替换）；「重试耗尽 fail-closed」（真实 `withAssetTransientRetry(maxAttempts:1)` 耗尽，断言抛出与回写错误均为真实 `request timed out`、旧视频保留、无新产物）；「非瞬时结果对象不重试」（内容政策类失败 stage 只调用 1 次、原样上抛）。
- 全量桌面 vitest、QM-1 打包（`electron-builder --win --dir` + 8s 冒烟）、CI 全绿。

#### 3.1.29.3 历史记录图片提示词完整展示 + 未保存修改离开守卫（2026-08-16）

**背景**：用户反馈两类问题：① 旧的历史查看界面把图片提示词按 60 字符硬截断（案例截断在 "Wunü Mo" 单词中间），长提示词信息丢失无法查看；② 视频任务编辑页分段编辑修改后没有自动保存、也没有清晰的保存引导，直接返回/离开时会静默丢失未保存修改。

##### 1) 视频任务编辑页完整展示

- 视频任务编辑页的场景信息由「单行混合预览 + 60 字符截断」改为**每个场景两行独立展示**：「旁白」行（`scene.text`）与「画面提示词」行（`scene.prompt`），只渲染存在的字段，空字段不占行；移除 60 字符硬截断，长文本 `white-space: normal; word-break: break-word` 自动换行，列表限高滚动。
- 历史卡片预览仍按 120 字符截断（设计如此：卡片是摘要，完整内容在视频任务编辑页查看）。

##### 2) 结果页未保存修改标识与离开守卫

- 分段编辑区新增「有未保存修改」标识（`segmentsDirty=true` 时显示，保存成功后消失）。
- 新增 `beforeRouteLeave` 离开守卫：存在未保存修改时挂起导航并弹出确认框，三个动作：
  - 【保存并离开】：先调保存分段，保存成功才放行；保存失败留在当前页并保持弹窗（可再试或取消）。
  - 【不保存离开】：放弃未保存修改直接导航。
  - 【取消】：撤销导航，留在结果页继续编辑。
- 组件被销毁且守卫仍挂起时（如测试/异常路径）兜底取消导航，保证 `next` 只调用一次、不悬挂。
- **保存语义（回答「现在是怎么保存的」）**：分段编辑为**手动保存**——修改标脏后点【保存分段】持久化（IPC `story2video:update-segments`）；「重新生成字幕/旁白/优化词」「生成新图/视频」「重新合成」等后续动作前会自动保存未落盘编辑（3.1.29 W3 既有机制）；本次新增离开确认，防止直接返回时静默丢失。

##### 3) 测试与门禁

- ResultView.test.js：6 用例（无 dirty 放行 / chip 显示与保存后消失 / 取消留页 / 保存成功并离开 / 保存失败留页 / 不保存离开），经真实 `<router-view>` 挂载触发 `beforeRouteLeave`，弹窗按钮经 Teleport stub 就地渲染后 DOM 触发。
- CreateViewHistory.test.js：长提示词（>120 字符）详情完整可见、无省略号；旁白/画面提示词分行；只有 text 或只有 prompt 时不渲染空行；卡片预览仍 120 截断。
- locale zh/en 成对（新增 8 键：create.history.sceneNarration/scenePrompt + story2video.sceneMaterial 6 键）；CJK 基线 `--update-baseline` 吸收行号偏移（官方门禁 1499/1499 无新增硬编码）；`pnpm run build:vue` 通过。
#### 3.1.29.4 结果页/历史编辑视频预览令牌失效自愈与旧令牌回收（2026-08-16）

**背景**：视频创作-历史记录，任务内容编辑中弹出「视频预览加载失败」，但成片文件实际已保存。根因：本地媒体服务签发短生命令牌 URL（TTL 15 分钟、128 条 FIFO 注册表逐出、生产零 revoke），编辑会话回放旧任务时旧令牌已过期/被逐出，`<video>` 元素 error 被渲染层固定弹为「视频预览加载失败」，属误报。

#### 1) 主视频预览 error 自愈（渲染端）

- 结果页 `handleError` 首次 error 时自愈：对同一 `videoPath` 重签本地预览 URL（透传旧地址为 `previousUrl`），`await $nextTick()` 后 `player.load()`；**仅二次失败**才弹既有本地化文案 `videoPreviewFailed`。
- 自愈标记 `videoReloadAttempted` 在 `loadVideoPath`/`loadProject` 成功后重置；重签失败不置位（下次 error 仍可自愈一次）。
- 文案与 run 终态均不修改（既有 `preview_missing`/`videoPreviewFailed` 契约不变）。

#### 2) 令牌回收契约（IPC）

- `story2video:create-share-url` 接受可选第三参 `previousUrl`：签发成功后 best-effort 回收旧令牌。
- **仅同源（与新签发 URL 同 origin）+ `/media/` 令牌形状路径**的 `previousUrl` 才调用 `revoke`；`file://`、异源、非媒体路径一律忽略，防止误逐出共享 128 条注册表的分段图/音频/视频活跃令牌。
- 分段图/音频/视频 URL 替换处同步透传旧地址，长期编辑会话逐槽位回收。
- preload 与 `api/publisher.js` 透传第二参数；`previousUrl` 仅 defined 时转发，1 参调用方（SceneAssetSelection 等）行为字节级不变。

#### 3) 测试要求

- IPC（`story2video.test.js`）：+4 用例——传 previousUrl 时 revoke 被调用；不传时不调用；`file://` 非本地 URL 拒绝 revoke；同源非媒体路径拒绝 revoke。
- 渲染端（`ResultView.test.js`）：+5 用例——首次 error 自愈不弹窗且透传旧 videoSrc；二次 error 弹 `videoPreviewFailed`；重签失败直接弹且不标记已自愈；`loadVideoPath` 成功后重置标记并透传旧地址；`refreshSegmentImageUrls` 透传旧 imageUrl。
- 全量桌面 vitest、QM-1 打包（`electron-builder --win --dir` + 8s 冒烟）、CI 全绿。

#### 3.1.29.5 视频提示词优化长度放宽（已实现，2026-08-16）

**背景**：图片提示词 `optimize.max_length` 上限放开（PR #887，500→2000 可配置）后，用户希望视频提示词的优化字数也尽量放宽，避免长视频提示词在生成/优化时被截断。

**需求**：Story2Video 视频提示词优化（`scene.videoPrompt` / 视频优化词路径）在合理成本内放宽长度上限，长提示词不因长度被静默截断。

**边界与实现约束**：
- 沿用 PR #887 域级模式：Story2Video 域显式携带 `max_length`（流水线 stageDef 默认与文本配置默认同步，各入口显式透传），**不改共享 kernel 默认 500**（`buildPromptEngineOptimizeRequest` 未显式时保持现状），**不改视频 legacy 8020 契约**——避免静默放大所有通用 `optimize` 调用方与视频 legacy 路径的成本。
- 执行器契约收敛 `[50, 2000]` 不放松（8013 上限 2000）；若需超过 2000，须先与供应商/网关确认真实上限、配额与成本再评估，禁止仅凭本地放宽。
- 渲染层可仿照图片提示词提供「提示词最大长度」可配置档位（200–2000，默认 2000），越界/缺失回退默认。
- 历史快照兼容沿用 #887 规则：存量 run 保留原 `optimize.maxLength`（恢复/续跑沿用旧值），重新生成时按新默认透传。

**状态**：已实现——历史重生成视频优化词（`regenerateScenePrompt` kind=video）显式携带视频域上限 `max_length`（`VIDEO_ENGINE_LIMITS.videoMaxLengthMax`）：8020 standalone builder 收敛 [200,40000]、8013 legacy builder 收敛 [50,2000]，共享 kernel 默认 500 与 legacy 执行器契约 [50,2000] 不放松；2026-08-16 上界由 20000 再放宽至 40000（openspec `s2v-video-maxlength-40000`，8020 引擎侧同步 le=40000）。渲染层「提示词最大长度」档位列为可选后续。

### 附录 A：场景素材四卡布局与预览/选择交互修订（2026-08-20）

本修订覆盖 3.1.26 中历史场景素材区的旧交互描述。产品展示层固定为四个视觉卡，服务端持久化层仍只保留三种素材身份，不新增数据库字段、IPC kind 或迁移。

#### 数据模型与校验

1. 每个 segment 必须按固定顺序生成 image1、image2、video1、video2 四个视觉 slot。image1 读取 imagePath；image2 读取 alternateImages 的第一项 path；video1 优先读取 videoMeta.sceneVideoPath，缺失时兼容读取 videoPath；video2 只读取 videoMeta.altSceneVideoPath。视频 radio 的 selectable 还必须满足 canonical videoPath 存在，以匹配主进程 video 持久化校验；仅有 videoMeta 的异常旧数据允许预览但不允许选择。
2. selectedMaterial 只允许 image1、image2、video。空白、未知值、video1、video2 等非法值按未选择处理，不能根据第一个有素材的 slot 猜测当前使用。video1 和 video2 是 renderer 视觉别名，不是新的持久化枚举。
3. 每个 slot 同时计算 path、resolved URL、selectable 和 selected。path 缺失时 radio 必须 disabled；path 存在但 URL 签发失败时保留固定空框，缩略图按钮 disabled，radio 是否可选仍由服务端 path 合同和 slot selectable 决定。
4. alternateImages 不是数组、为空或首项没有合法 path 时，image2 作为空 slot；videoMeta 缺失时只允许 video1 按旧项目规则回退 videoPath，video2 不借用 video1 的路径或 URL。
5. 服务端和 IPC 继续校验 projectId、segmentId、素材 kind 和目标槽位存在性。renderer 的 disabled/白名单是第一层防线，主进程 validation/service 是第二层防线；伪造请求不能改变项目选中态或素材路径。

#### 流程与功能逻辑

历史记录 -> 视频任务编辑页 -> 加载项目 -> 刷新每个场景的图片、备选图片、场景视频和 alternate 视频预览 URL -> 生成四个固定视觉卡。任何一个 URL 失败只清空对应 slot URL，其他 slot 和四卡几何不受影响。

1. 点击有 path 且 URL 有效的缩略图，只调用 previewSceneMaterial，打开预览弹窗；不调用 select-scene-material，不改 selectedMaterial，不改 dirty 状态。卡片不得使用包裹缩略图和 radio 的 ancestor label，避免浏览器原生 label 激活把预览误判为选择。
2. 点击 radio 或 radio 对应的素材名称 label，才调用 selectSceneMaterial。image1/image2 直接发送同名 kind；video1/video2 都归一发送 canonical video。选择成功后使用服务端返回的完整 project，刷新派生 URL 并显示当前使用徽标；失败保留原选中态并显示归一化提示。
3. 当前使用徽标只在 image1、image2 或 canonical video1 显示。video2 可以预览和作为视频候选显示，但不重复伪造第二个 video 持久化身份或第二个当前使用徽标。
4. 空 slot 的缩略图按钮不打开预览，空 slot radio 不调用 IPC。四个 slot 始终存在，不能因为没有图片或视频而折叠成三格或改变顺序。
5. 生成新图生成 AI 视频都是场景级操作：生成新图显示在 image1/image2 卡内并调用 generateSceneImage(segmentId)，写入目标由选中态规则决定；生成 AI 视频显示在 video1/video2 卡内并调用 generateSceneAiVideo(segmentId)，结果写入 canonical 视频槽。多卡入口只是同一动作的重复暴露，不改变落点语义；video2 仍是视觉别名，不新增持久化身份。生成 AI 视频按钮仅当 videoPrompt/prompt/text 全为空时禁用（提示词回退契约与后端 generateSceneAiVideo 一致）。
6. 生成前检查 segmentBusy 和输入条件；AI 视频要求 videoPrompt/prompt/text 任一 trim 后非空（与后端回退契约一致）。若有未保存分段修改，先保存，保存失败不提交生成请求。同一场景同一时间最多一个生成/选择写操作，finally 必须清除 busy。
7. 成功生成后用主进程返回的 path 更新项目，调用 refreshSegmentImageUrls 重新签发 URL，保留 selectedMaterial 语义并显示成功通知。失败时保留旧素材和旧选中态，清理本次 attemptFiles，只显示本地化且可操作的错误提示，不显示绝对路径、堆栈、provider JSON 或内部 prompt。

#### 交互与显示合同

- 卡片结构固定为 media frame -> radio + 素材名称 -> 当前使用徽标（如适用）-> 所属生成按钮（如适用）。radio 位于缩略图底部，并且在素材名称文字前。
- 缩略图使用独立 button type=button，图片和视频分别使用 img 与 video；video1/video2 预览都必须渲染 video 元素并提供 controls/autoplay。
- 预览弹窗使用 UiModal 的 xl 尺寸，媒体最大高度受 75vh 约束；弹窗只负责查看，不附带选择动作。
- 每个 media frame 宽度为卡片内容区 100%，使用 aspect-ratio 3/4、min-height 96px 和统一背景色。图片、视频和空态共用相同几何，媒体内容使用 object-fit cover。
- 宽屏使用四列等宽布局；视口不大于 720px 时使用两列。生成按钮允许文案换行，但不能撑破卡片、遮挡 radio、label 或媒体框。
- 有素材时 radio 的可访问名称为“选择{label}作为当前素材”，缩略图的可访问名称为“放大预览{label}”；空态使用“{label}尚未生成”。所有文案必须在 zh/en locale 成对存在。
- 空媒体框只显示一行本地化 emptySlot：中文“未生成”、英文“Not generated”。不得显示 Video 1、Video 2、video1、video2 或第二行未解释的英文 fallback。

#### 回归与验收

ResultView 测试必须覆盖四卡固定顺序、radio-only selection、thumbnail-only preview、video kind 归一、canonical video1 徽标、按钮不重复、busy/prompt guard、path/URL 失效、非法 selectedMaterial、旧字段缺省、空态英文泄漏、xl modal、图片/视频媒体类型和键盘可访问性。交付前还必须通过 zh/en locale 成对检查、CJK 硬编码扫描、Vue build、变更文件 ESLint、worktree dependency 解析和 git diff hygiene。
ResultView 测试必须覆盖四卡固定顺序、radio-only selection、thumbnail-only preview、video kind 归一、canonical video1 徽标、生成按钮覆盖全部图片/视频卡、busy/prompt guard（videoPrompt/prompt/text 回退）、path/URL 失效、非法 selectedMaterial、旧字段缺省、空态英文泄漏、xl modal、图片/视频媒体类型和键盘可访问性。交付前还必须通过 zh/en locale 成对检查、CJK 硬编码扫描、Vue build、变更文件 ESLint、worktree dependency 解析和 git diff hygiene。

### 3.1.27 历史记录可见性与终态一致（2026-08-15）

**背景**：① 流水线失败/取消时，主进程仅置 run 顶层终态，当前 stage（如 compose）仍保持 `running`，历史卡片与持久化快照出现「视频合成 运行中」假象；② 历史列表把「暂停/失败」任务排在全部已完成项目之后（实测 30+ 条历史中最新失败任务排第 27 位），用户误以为任务丢失。

#### 1) 终态一致（主进程）

- `_finalizeRun(run, status, error)` 在 `status=failed|cancelled` 时，把 `run.stages[run.currentStage]` 同步为同一终态并补 `completedAt`（与 `_advanceRun` 完成语义一致）；`cancel()` 先置 stage 时幂等兜底。
- 覆盖路径：`executeStage` 失败、`_autoAdvanceRun` 失败、`cancel()`；`getRunSnapshot`/`runStateStore.saveFailed` 快照随之携带正确 stage 终态。
- 回归保护：`pipeline-engine.test.js`「_finalizeRun failed/cancelled 同步当前 stage 终态」断言 stage 终态 + completedAt + 已完成 stage 不受影响。

#### 2) 历史排序（前端 CreateView.loadHistory）

- 排序规则：全部及各状态筛选均按 §3.1.28 有效更新时间倒序；不再按状态优先级分组。
- 失败任务 `pausedStage` 优先取 `stage.status==='failed'` 的阶段，无 failed stage 时才回退「非 completed / 末位」。
- 回归保护：`CreateView.test.js`「失败/暂停的未完成任务排在已完成项目之前」断言 `[failed, paused, project×2]` 顺序。

### 3.3 叠加层（Remotion 快速路径，P1）

| 类型 | 说明 | 参数 |
|------|------|------|
| `section_title` | 章节标题 | 文字 + 副标题 + 颜色 |
| `stat_reveal` | 数据揭示 | 数字 + 标签 + 动画 |
| `hero_title` | 大标题展示 | 标题 + 副标题 |
| `provider_chip` | 多来源标签 | 来源列表 + 轮播速度 |

### 3.4 字幕系统（P1）

| 功能 | 说明 |
|------|------|
| S2V 烧录字幕 | 已实现：逐场景文本、字号/颜色/边框/背景样式 |
| 逐词高亮 | 仅独立 Remotion 快速路径；S2V 主链未实现词级时间轴 |
| 多页显示 | 已实现：每个场景内部本地二次切分，ffmpeg 通过独立的 `[start,end)` 半开 `enable` 区间分页显示，边界帧不会同时叠加前后两页 |
| TTS 同步 | 已实现：以 ffprobe 真实音频时长按字幕文本权重分配，末页精确结束；未提供词级时间戳时不宣称逐词精准同步 |

### 3.5 音频系统（P1）

| 轨道 | 说明 | 参数 |
|------|------|------|
| 旁白（Narration） | 已实现：TTS 或逐段本地音频 | 文件路径 + 独立旁白音量（0-2，合成时写入 ffmpeg） |
| 背景音乐（Music） | 已实现：本地 BGM 循环混音 + 设备级素材库（添加/重命名/删除，下拉选择，见 3.1.25） | 库条目路径 + 音量 |
| 音效（SFX） | 未接入 S2V 主链 | 源路径 + 时间点 + 音量 |

### 3.6 主题系统（P0）

| 主题 | 适用场景 |
|------|---------|
| `clean-professional` | 商务、教育、产品介绍 |
| `flat-motion-graphics` | 科技、创意、短视频 |
| `minimalist-diagram` | 数据分析、流程图解 |
| `anime-ghibli` | 故事讲述、品牌短片 |

### 3.7 媒体配置（P0）

| 预设 | 分辨率 | 适用平台 |
|------|--------|---------|
| `youtube-landscape` | 1920×1080 | YouTube、B站 |
| `youtube-4k` | 3840×2160 | YouTube 4K（受运营开关 `videoCreation.maxOutputResolution=4k` 控制；关闭时该模板的分辨率归一化为 1920×1080，见 PRD.md 7.1.20） |
| `youtube-shorts` | 1080×1920 | YouTube Shorts |
| `tiktok` | 1080×1920 | 抖音/TikTok |
| `instagram-reels` | 1080×1920 | Instagram Reels |
| `wechat` | 1080×1920 | 微信视频号 |
| `bilibili` | 1920×1080 | B站 |
| `xiaohongshu` | 1080×1440 | 小红书 |
| `generic-hd` | 1920×1080 | 通用 |
| `cinematic` | 2560×1080 | 电影感 21:9 |
| `linkedin` | 1920×1080 | LinkedIn |
| `instagram-feed` | 1080×1080 | Instagram 信息流

### 3.1.27 视频提示词优化引擎 Round3 B/C：跨镜承接状态包 + 导演分镜块骨架（2026-08-15）

**需求**：把《Hell Grind》长片一致性算法内核（上一镜终态显式交接给下一镜）与 refined 导演分镜单形态（12 块骨架 + 覆盖度 + 启发式 gated 判据）落到独立视频提示词引擎（8020）与 Story2Video 视频提示词链路上。OpenSpec：`higgsfield-round3b-cross-scene` / `higgsfield-round3c-refined-output`。

#### 1) 数据模型与校验（引擎侧 + 桌面契约侧）

- `prev_final_frame`（上镜终态描述）：引擎 `VideoOptimizeRequest` 与桌面契约双侧上限 **1000 字符**；桌面侧归一——非字符串丢弃、trim 后空丢弃、超长按句截断（句末回溯，无句末硬截断）。
- `final_frame`（计划终态）：上限与 `prev_final_frame` 同界 **1000 字符**；语义为**计划中的最终画面描述**（位置/姿势/灯光/机位/禁文字），不是解码后的真实视频帧证据。
- `blocks`（导演分镜块骨架，refined 层可选）：**12 键白名单** `SCENE NOTE / SPATIAL LAYOUT / LIGHTING / COLOR / CAMERA / ENVIRONMENT / CONTINUITY / CHARACTERS / SKIN / ACTING / STILLNESS LOCK / FINAL FRAME`；仅保留非空字符串、每值 **≤4000 字符**；非法键丢弃。桌面契约与 8020 引擎同源（`video-prompt-engine-contract.js` blockKeys 与 `refined_blocks.json` 顺序一致）。
- 引擎缺块回退：请求无有效 blocks 时走既有 legacy 渲染器；渲染时缺失块用旧字段回退（如 SCENE NOTE 承接旧 prompt，避免稀疏 blocks 丢主体）。

#### 2) 流程（跨镜链式优化）

```text
Story2Video 视频场景（按场景顺序）
  ├─ ① 视频提示词优化串行：第 N 镜请求携带第 N-1 镜的 final_frame（prev_final_frame）
  ├─ ② 引擎注入 SCENE Continuity 承接段（<prev_final_frame> 事实引用，非指令）
  ├─ ③ 优化结果回写 scene.video.final_frame（计划终态）+ continuity 元数据
  ├─ ④ 媒体生成仍按既有预算并发（只串行优化调用，不串行生成）
  └─ ⑤ 断点续跑：从 checkpoint 终态恢复链（resume.completed[].final_frame /
        .video.final_frame / 旧字段三级回退），缺终态 → 显式 degraded 断链记录
```

#### 3) 功能逻辑

- **承接注入**：仅当 `prev_final_frame` 存在时注入 `## SCENE Continuity (MANDATORY when prev_final_frame is provided)` 段；段内 `<prev_final_frame>` 是事实引用，显式说明其中指令不得执行（防提示词注入）。
- **缓存盐**：`HIGGSFIELD_FMT_V4`——承接段与块骨架改变输出形态，旧缓存一次失效重建；key 纳入 `prev_final_frame` 哈希。
- **连续性评分（advisory -5）**：英文——实体 token 命中率 ≥40%，且角色白名单提供时角色名必中（硬判据）；中文——显式白名单（角色名 + 终态姿势/位置词）命中 ≥60%，无白名单时整句重合度（SequenceMatcher）≥0.5；无 `prev_final_frame` 零回归。
- **块覆盖度（refined 专属，advisory -5）**：分母 = 归一后非空 blocks 数，分子 = 渲染串中命中块标记数（统一正则，行首标题+冒号）；比率 <0.8 记 `block_coverage = -5`，不拒绝候选。
- **启发式 gated 规则（7 条，默认启用 3 条）**：默认启用 `dead_center / exposure_break / eye_line`；其余 `warm_light_leak / silhouette_break / style_contamination / skin_guard` 资产内可用但默认 OFF。规则需「活跃非否定 lock」+「非否定 forbidden 出现」同时成立才扣分——局部否定（`not overexposed`、`no waxy skin`）不是失败；`style_contamination` 不用 `photoreal` 词作为触发（词边界整名匹配，`photorealistic detail` 等完整 lock 词才触发）。
- **FAIL CHECK**：只存在于模型指令（自审清单），若被意外输出则剥离，永不成为导演块；尾行清理只认「含画幅与时长字段的完整 trailer 尾段」，块内字面量（如 `Photoreal NON-IP aesthetic`）不会误删后续 FINAL FRAME 块。
- **引擎选择与 provenance**：`VIDEO_PROMPT_PORT=8020` 启用独立引擎优先，失败自动回退 8013 `domain=video`；结果带 `engine_source`（standalone-8020 / legacy-8013 + fallback 标志）。
- **断链可见性**：优化失败/缺终态按既有混合模式回退图片轮播；continuity 元数据记录 `mode: planned_final_frame`、`status: active | degraded`、`reason`（not_started / missing_prompt / missing_prompt_bridge / missing_final_frame / prompt_optimization_failed / resume:missing_final_state），日志显式提示断链，不虚构连续性。

#### 4) 交互逻辑与显示项

- 无新增 UI 表面；优化阶段进度/失败展示沿用既有 stage.progress 契约。
- 断点续跑场景：复用断点产物时保留 continuity 元数据（checkpoint 计划终态链），不再只有 `{ resumed: true }`。
- 视频提示词优化失败按既有「混合模式回退图片轮播」交互，不弹窗阻断。

#### 5) 提示文字（zh / en）

- 无新增用户可见文案；失败原因沿用既有阶段失败提示（引擎侧日志含 `prev_final_frame injected (source=…, chars=…)`、`缺少可用 final_frame，跨镜承接已从该场景断开` 等诊断日志，仅主进程日志可见）。

#### 6) 测试要求

- 引擎：`tests/test_cross_scene.py`（边界/缓存/承接/择优）、`tests/test_refined_blocks.py`（块契约/渲染/尾行/覆盖度/gated/盐 V4）、`tests/test_analyze_hg_corpus.py`（语料资产）；全量 `pytest tests/ -q --ignore=tests/test_web_e2e.py` 通过。
- 契约：`video-prompt-engine-contract.test.js`（prev_final_frame 归一/块白名单/engine_source 回退）、`story2video-stages.test.js`（串行链/断点恢复/断链明示）、`story2video-manual-assets.test.js`（manual 集成零回归）；桌面关联套件全绿。

---

### 3.1.24 视频创作首页流水线卡片 UI |

### 3.1.24 视频创作首页流水线卡片 UI：多列动态布局 + 内置静态背景 + 交互动效（2026-08-13 落地，方案 B）

> 范围：`/create` → 「流水线创作」视图（`PipelineSelector.vue` + `pipeline-selector.css` + 静态资源）。
> **背景图为随应用打包发布的固定静态资源**（git 版本控制，所有用户一致）；**彻底移除运行时图片生成**
> （不调用任何生成 API、不访问网络、不写本地缓存、无 loopback 服务）。背景图由免费生图模型
> Pollinations(flux) 一次性预生成后提交仓库（存量 MiniMax/LLM Key 经诊断在当前 Electron 下不可解密，故不依赖运行时 Key）。

#### 1) 流程（数据流）

```
进入 /create（流水线创作视图，未选流水线）
  ├─ 1. CreateView 加载流水线列表（pipeline:list → PipelineEngine.listPipelines + video-clone 入口）
  ├─ 2. PipelineSelector 挂载 → 对每张卡片按 pipeline.name 查询内置静态映射（PIPELINE_BG_IMAGES）
  ├─ 3. 命中映射 → 渲染 .card-bg（<img> 静态资源 + 双层暗色遮罩）+ 浅色前景
  └─ 4. 未命中（新增流水线暂无背景资源）→ 分类色系渐变兜底，正常可选
全程无 IPC、无生成请求、无磁盘写入。
```

#### 2) 数据校验

| 项 | 规则 |
|----|------|
| 静态资源 | `apps/desktop/src/assets/pipeline-card-bg/<pipeline-name>.jpg`，1024x576（16:9）JPEG，由 `src/story2video/pipeline-card-bg-assets.js` 静态导入聚合为 name→URL 映射 |
| 名称匹配 | 资源文件名与流水线 `name` 完全一致（kebab-case）；不匹配/缺失 → 渐变兜底 |
| 资源内容 | 统一风格（低饱和深色渐变、抽象几何、留白、无文字/人物/logo）；每卡主题意象与流水线功能相关（如口播=声波线、电影感=胶片光晕、视频克隆=镜像光分） |
| 无运行时校验 | 不校验 Key/额度/网络；不存在运行时生成/下载/缓存路径 |

#### 3) 功能逻辑

- 前端渲染层：命中映射的卡片渲染 `card-bg`（`<img loading="lazy" decoding="async">` + `card-bg-scrim` 双层暗色遮罩，`aria-hidden`），前景文字在有背景时强制浅色（标题 #f5f6fa、描述/元信息 rgba 浅色、badge/标签半透明白底），保证对比度。
- 渐变兜底：未收录背景资源的流水线沿用分类色系低饱和渐变（generated/talking_head/cinematic/animation/screen_recording/hybrid/custom）。
- 交互动效：卡片入场 fadeInUp（stagger 30ms/卡，最多 12 档）；悬停抬升 -4px + 阴影 + 背景图 scale(1.06) + 边框高亮；`:focus-visible` 外环；`prefers-reduced-motion: reduce` 关闭入场/缩放/shadow 过渡。
- 可访问性：卡片 role=button + tabindex=0 + aria-label（流水线名）；背景层 aria-hidden；键盘 Enter 触发选择。

#### 4) 交互逻辑与显示项

| 显示项/交互 | 说明 |
|-------------|------|
| 多列网格 | ≤768px 1 列；769-1199px auto-fill（280px 基数）；1200-1439px 3 列；1440-1919px 4 列；≥1920px 5 列；gap 16px（窄屏 12px） |
| 页面容器 | 流水线选择视图放宽至 max-width 1600px（`.create-page--pipeline-list`） |
| 背景层 | 静态 img（object-fit: cover）+ 双层暗色遮罩（顶部 0.42→0.12→底部 0.62→0.85 渐变） |
| 前景文字 | 有背景时强制浅色，保证对比度；无背景时保持主题色 |
| 骨架屏/错误态 | 沿用 skeleton-grid 与 error-state + 重试按钮（`pipelineSelector.retry`） |
| 提示条 | 无（运行时生成相关提示已随运行时链路一并移除） |

#### 5) 提示文字（zh / en）

| key | zh | en |
|-----|----|----|
| `pipelineSelector.retry`（沿用） | 重试 | Retry |
| `pipelineSelector.stages`（沿用） | {count} 阶段 | {count} stages |
| 其余分类/成本/可用性文案沿用 `pipelineSelector.*`（P3 i18n 已迁移） | — | — |

#### 6) 安全边界与已知边界

- 无运行时网络请求/API 调用/本地缓存/静态服务 → 相关安全面（SSRF/下载/loopback）随运行时链路整体移除。
- 静态资源随应用打包发布；换图走 git + 发版，不存在运行时更新。
- 未收录背景资源的新流水线以渐变兜底呈现，不阻塞使用；补充资源后随下一次发版生效。
- 免费模型生成仅发生在开发期预生成阶段（一次性），产物已校验（JPEG magic/尺寸/数量），不依赖任何运行时服务可用性。

#### 7) 视觉测试确定性（2026-08-13 补充）

- `test-runner.js` 配置 `reducedMotion: 'reduce'`，关闭 CSS 动画/过渡，确保截图无动画中间态干扰。
- `_waitForImagesSettled()` 等待视口内 `loading="lazy"` 图片解码完成后再截图，消除懒加载时序差异。
- 基线快照 `apps/desktop/tests/visual-testing/base-screenshots/create-editor.png` 等 9 张已更新，匹配静态背景 UI 的确定性渲染。
- 门禁：像素对比阈值 6%，全部 17 页通过。

---

## 四、非功能需求

### 4.1 性能

| 指标 | 目标 |
|------|------|
| Remotion 渲染（30s 视频） | ≤ 5 分钟 |
| FFmpeg 合成（30s 视频） | ≤ 30 秒 |
| 渲染队列 | 串行执行（队列管理） |
| 进度更新 | 每 5% 更新一次 |
| UI 响应 | 渲染不阻塞界面 |

### 4.2 可用性

| 场景 | 处理 |
|------|------|
| 运行时缺少打包资源 / ffmpeg | 阻断对应能力并给出安装或修复指引，不在应用运行时联网安装依赖 |
| 首次运行 | 检查随应用打包或锁定的渲染资源；不执行在线 `npm install` 或 Playwright 下载 |
| 渲染超时 | 10 分钟超时自动取消 |
| 渲染失败 | 错误详情展示 + 重试按钮 |
| 用户关闭窗口 | before-quit 终止子进程 |
| 并发渲染 | 任务队列 maxConcurrent=1 |
| 网络不可用 | 离线模式，依赖本地已安装工具 |

### 4.3 安全性

| 项目 | 要求 |
|------|------|
| API Key | 本地加密存储；仅在调用用户主动选择的 Provider 时发送给该 Provider，不能宣称外部生成全程离线 |
| 用户素材 | 默认不上传云端；用户主动选择外部图片/TTS/STT Provider 时，仅把完成请求所需的提示词、文本或已导入媒体发送给该 Provider，并受其服务条款约束 |
| 渲染子进程 | 沙箱隔离 |
| 取消渲染 | 完整进程树清理 |

---

## 五、历史阶段规划与当前补齐项

> 下列 Phase 1-5 是早期 Remotion/Python 路线的规划记录，已完成的部分不再作为当前待办。
> `image/remix/gallery/audio/batch` 已明确排除，不再作为 Story2Video 待迁移能力。
> 历史基线中的外部产品缺口包括音色克隆、旧 orchestrator 会员配额，以及云历史/云分享。音色目录、克隆和个人槽位的本轮合同不构成已交付声明；已接入的 Provider 仍需在真实
> 凭据、网络和配额齐全的目标环境完成外部验收。
> 分段编辑、单段重试、完整旁白、本地项目历史、流式 ZIP 和真实裁剪已经接通；
> 本地路径操作不等同于云端分享链接。

### 历史 Phase 1（P0）— 基础渲染（已被六阶段链路替代）
- 已完成：独立 Remotion Composition 注册、参数校验和渲染 IPC。
- 已由现行链路覆盖：CreateView 输入、字幕/音频参数、结果预览和发布入口。

### 历史 Phase 2（P1）— 多模式扩展（独立 Remotion 路径）
- 已完成：TalkingHead、CinematicRenderer、CollageBurst、LyricOverlay 等独立 Composition。
- 这些 Composition 不会自动成为 `story2video-compose` 的阶段；需要单独走 Remotion IPC。

### 历史 Phase 3（P1）— Python 工具链（已接入，能力按运行环境可用性计）
- 已完成：Python 后端桥接和 YAML 清单；具体 provider 是否可用取决于本地依赖与凭据。
- S2V 默认使用本地 `AssetGenerator`，外部服务不可用时必须明确失败或降级。

### 当前补齐项（P1/P2）— 交付体验与外部能力
- [x] text 标准模式：唯一创作输入为文案；图片和逐段旁白由生成阶段产生。
- [x] 结果页项目编辑：编辑/排序/删除分段、替换旁白、图片/视频重试和重新合成；这不是 `batch` 创作模式。
- [x] 普通流水线/工具继续支持图片、音频、视频素材和逐段 STT，不受 Story2Video text-only 合同影响。
- [x] `image/remix/gallery/audio/batch` 明确排除，不计入 Story2Video 功能缺口。
- [x] 结果页本地交付：预览、下载、完整旁白、逐段媒体、复制路径、打开目录和流式 ZIP 导出。
- [x] 本地项目历史：用户隔离持久化、最近 100 项、筛选/打开/删除和重启恢复。
- [x] 真实视频裁剪：双范围选择、区间预览和 ffmpeg 输出校验。
- [ ] 云端分享链接、失败运行断点续作和跨设备历史。
- [ ] 音色克隆，以及 Doubao/MiMo 等外部 Provider 的真实凭据和网络验收。

### 历史 Phase 5（P2）— 增强与完善（不等同于 S2V 主链待办）
- [ ] 绿幕合成
- [ ] 人脸增强 / 去背景 / 上采样
- [ ] 自动裁切（人脸跟踪）
- [x] 视频修剪（ffmpeg 精确起止时间；未实现独立静音检测剪切）
- [ ] 自定义 Playbook 生成

---

## 六、验收标准

### 当前 `story2video-compose` 验收
- [x] 仅文案模式可通过 CreateView 发起六阶段编排，图片/音频/视频输入在 UI 和主进程两层被拒绝。
- [x] 独立 `Story2VideoTextConfig` 覆盖兼容默认值、边界校验、阶段映射和项目持久化。
- [x] Story2Video 输出配置与其他视频流水线隔离，切换流水线不会继承分辨率或素材状态。
- [x] Story2Video 在视频创作列表中优先显示；创建页只暴露实际由六阶段链路消费的参数。图片比例由输出分辨率唯一推导，不能与成片尺寸冲突；不支持的情绪、字幕字体和离线占位图不作为可选项。
- [x] 旁白有可探测音频时长时以音频时长决定场景时长；`defaultSceneDuration`（默认 6 秒，UI 不暴露）只作为音频时长不可探测时的回退，不承诺强制截断旁白；“无旁白场景时长/单画面时长（perImageDuration）”已随无旁白纯图片轮播模式下线。
- [x] 结果页本地视频和旁白预览通过仅绑定 127.0.0.1 的短期令牌媒体服务提供，不向 renderer 暴露绝对路径；CSP 仅允许该回环来源的媒体请求。
- [x] 图片动效、转场、字幕、BGM、水印、分辨率/FPS 和 MP4/WebM 输出有自动化合同测试与真实 ffmpeg 验证。
- [x] 水印六位置（top-left/top-right/bottom-left/bottom-right/center/moving）坐标契约有单测断言（drawtext 左上角语义），且经真实 ffmpeg 渲染帧级验证水印可见、moving 不越界（t=0 居中，Lissajous 确定性漂移）。
- [x] watermark.position/opacity/fontSize 非法值 normalizer fail-closed 拒绝；compose 层 clamp 二次防线；快照恢复陈旧枚举吸附合法档位，下拉无空白选项。
- [x] 水印新 UI（位置/字号/透明度下拉）文案走 locales zh/en 成对，CJK 基线扫描无新增硬编码；打包产物（asar）含新 renderer 与主进程代码。
- [x] 图片动效按场景有效时长归一化：zoompan `d=总帧数` + 进度 `min(1, on/T)`，短场景动效不被切走、长场景不提前定格；回归覆盖字符串断言与（可选）真实 ffmpeg 帧级验证；`renderSegment` 上报时长与 compose 一致收敛到 0.1..3600。
- [x] `perImageDuration`（单画面时长/无旁白场景时长）已从 renderer/normalizer/模板库/YAML 移除；旧项目历史配置兼容忽略，`defaultSceneDuration` 保留为内部默认 6 秒回退。
- [x] 场景层正常路径由 8002 的 `scenes` 决定；仅服务不可用时本地降级，非法响应不降级，并在运行结果和项目清单保留来源字段。
- [x] Story2Video 分句别名映射到 8002 的 `config.sentence_tokenizer/scene`；自定义时长、语速和场景字数不会被 FastAPI 静默忽略；字幕参数（`subtitle_min_chars/subtitle_max_chars/subtitle_timing`，v1.2）透传为 `config.subtitle.*`，不再静默丢弃。
- [x] 每个场景独立生成 8-15 字目标的字幕块；字幕不跨场景，旧项目缺少字幕块时可在 compose 阶段兼容生成。
- [x] 分页字幕时间轴以 ffprobe 真实 TTS 时长生成，区间连续不重叠，语速变化时等比例缩放，最后一页精确结束。
- [x] 缺失音频时长不会被固定截断；短片段转场会自动收敛或降级。
- [x] 输出文件必须非空并通过 ffmpeg 解码校验。
- [x] 图片/音频/BGM 输入格式、大小、路径和总时长受控；成片不超过 50 分钟（默认上限，见 PRD §7.1.25a）。
- [x] 编排完成自动进入结果页；完成项目、完整旁白和分段媒体按用户持久化，最多保留 100 项。
- [x] 分段编辑、排序、删除、替换旁白、图片/视频重试和重新合成有项目服务与 UI 回归测试。
- [x] ZIP 导出不把全部视频读入内存；真实裁剪使用 ffmpeg，并可在 UI 中选择和预览区间。
- [x] 分段持久化使用受信任的段位序号命名，即使上游 `segment.index` 重复也不会覆盖图片、旁白或分段视频；原始索引仅作为元数据保留。
- [x] 本地播放、复制路径、打开目录和 ZIP 源文件只接受受控 Story2Video 临时区或项目目录；外部保存目录只能由主进程原生保存对话框明确授权。
- [x] 历史内容在 `contentType=history` 时经过领域增强，富化提示词再进入批量 prompt-engine 优化；完成项目保留 `contentType` 选项。
- [x] 已选择图片 Provider 时，`dall-e`/Imagen 参数合同有回归测试；ComfyUI 因缺完整输出协议在 S2V 主链 fail-closed。
- [x] 开发环境真实 `PipelineEngine` 已调用 8002/8013，依次完成六阶段并通过 ffmpeg 解码；测试/开发 fixture 的明确标记替代物不构成生产成功证据，尤其不得把明确 Content Policy 耗尽、认证、限流或网络失败改写为占位图/静音成功；发布按配置跳过。
- [ ] 目标安装环境的 8002/8013 sidecar、真实图片/TTS Provider 和真实多平台发布仍需单独验收。
- [ ] 音色克隆、旧会员配额、云分享和跨设备历史仍需外部能力或产品设计；被排除的五种旧模式不计入缺口。

### 独立 Remotion 快速路径验收（历史设计范围）
- [x] Composition 注册、参数校验和渲染 IPC 已接入。
- [ ] 每个 Composition 的真实渲染包验收不作为 `story2video-compose` 门禁。

---

## 七、排除项

- ❌ 不改动现有发布流程
- ❌ 不修改 OpenMontage 源码（直接复用或引用）
- ❌ 不引入 TypeScript（Multi-Publish 用纯 JS）
- ❌ 不引入外部视频编辑时间轴 UI（保持简洁参数化）
- ❌ 不引入在线协作功能
- ❌ 不引入视频存储/CDN 方案（用户本地管理）

---

## 八、风险评估

| 风险 | 影响 | 概率 | 应对 |
|------|------|------|------|
| Node.js 版本兼容 | 渲染失败 | 中 | 版本检测 + 明确最低要求 |
| 用户本地 GPU 不足 | AI 渲染慢 | 高 | 云端 API 备选 + 进度提示 |
| Remotion API 变更 | 渲染崩溃 | 低 | 锁定版本号 |
| OpenMontage Python 工具依赖复杂 | 环境配置困难 | 中 | 自动化懒加载 + 错误引导 |
| AI 服务 API 变更/停服 | 特定功能不可用 | 中 | 多提供商备选 + 降级提示 |

## 图片轮播合同补充（2026-08-04）

- 稳定内部流水线 ID 保持 `story2video-compose`；仅通过 i18n 显示中文“图片轮播”和英文“Image Carousel”。
- 提交后固定全自动连续执行六阶段，并以阶段清单反馈状态；每个场景的图片内容政策拒绝最多重试 5 次，耗尽进入 `needs_user_input`，不得用占位图伪装成功。
- 分句语言默认 `auto`；音调、并发数、创意强度采用运营可审计的受控默认值。图片风格与提示词风格是两个独立语义字段，不得合并。
- OpsCenter（`D:\Data\projects\ops-center`）当前没有已确认租户/音色同步 API，本任务不接入也不写入；未来跨仓库合同须另行定义租户边界、版本、鉴权、失效、回滚和审计，不能臆造 endpoint/字段。
- Doubao 不在桌面端放置高权限 secret；后端 connector 交付前不显示伪造个人音色列表。
- 用户清单 item 11 内容为空且最近 20 轮记录不可重建，属于 TBD/审计限制；UE item 15 已获确认并进入实现，不代表真实 provider 或打包交付已完成。

- **用户音色样本归属**：上传、保存、删除、设默认及 owner-scoped userData/SQLite 元数据均属于桌面端前台用户功能；不得移交或写入 OpsCenter。OpsCenter 仅承载音调、并发数、创意强度等运营受控默认值，以及未来后台高权限凭据/目录同步，绝不保存或管理用户音频样本。

## 图片轮播 UE 实施与空白页错误边界（2026-08-05）

### 已确认的前端方案

story2video-compose 的创作配置使用五个可折叠区：基础、外观、声音、高级、发布；基础区默认展开，其余按需展开。音调、并发数、创意强度仍作为受控默认值发送但不作为用户输入展示，分句语言默认 auto。图片风格与提示词风格保留为两个独立字段，并在界面分别解释视觉输出与提示词组织的职责。

运行反馈统一为六项阶段清单（文案拆分、内容增强、画面提示词优化、图片/视频/旁白生成、合成轮播视频、发布），展示阶段状态与摘要，不显示 Story2Video 百分比。启动按钮统一显示“启动流水线”；英文 locale 对应 “Start pipeline”。

### 身份与权益错误边界（2026-08-05）

图片轮播启动调用受保护的 `pipeline:startOrchestrated` IPC。未登录、登录会话失效或当前账号没有流水线权益时，主进程返回 `AUTH_ERROR`（桌面错误码 `-3`），renderer 必须显示稳定的 `story2video.access_denied` 本地化提示，明确要求用户登录并确认账号权益；不得把该状态伪装成普通生成失败，也不得通过开发变量绕过授权。权限错误仍应停止轮询、保留阶段清单的失败状态，并允许用户登录后重新提交。

本地调试可通过 `ELECTRON_USER_DATA_DIR` 复用仓库外固定 profile；profile 目录存在不等于身份状态有效，启动后必须以 `identity:get-state` 的 `authenticated`/`offline_authenticated` 结果为准。远程部署使用独立 userData，部署或交付前清理本地调试 profile，禁止将 Cookie、Local Storage、SQLite、DPAPI 凭据纳入版本库。

### 路由错误边界

懒加载组件（特别是 /create）失败时，router 通过共享响应式状态记录路径、友好错误和调试摘要。应用根布局优先渲染 RouteLoadError，提供“重试”和“刷新应用”，保证初始导航失败发生在 App 挂载前也不会出现裸白屏。错误仍写入 renderer console，便于诊断；正常加载路径不改变 CreateView 行为。

### 验收状态

本地 Vue build、路由状态回归和 Story2Video UI 合同测试属于可自动验证范围。真实 TTS provider 目录/个人槽位/用户音色克隆上传及图片敏感词降级必须在目标 provider 账号、网络和配额齐全时单独验收，不能以本地 mock、CI 或文档替代，状态保持 PENDING_EXTERNAL。

---

## 九、UI/UX 优化方案（2026-08-11）

### 9.1 优化背景

视频创作模块经过多轮迭代，功能已基本完善，但代码组织和用户体验存在优化空间。本次优化旨在：
1. 改善代码可维护性
2. 提升用户体验
3. 增强可访问性
4. 优化响应式设计

### 9.2 组件架构优化

#### 9.2.1 当前问题
- **CreateView.vue** 过于庞大（3531行），混合了多个职责
- 组件间有重复代码（如历史记录加载逻辑）
- 缺乏可复用的UI组件

#### 9.2.2 优化方案

**新增组件：**

| 组件 | 职责 | 行数 |
|------|------|------|
| `PipelineSelector.vue` | 流水线选择网格 | ~200行 |
| `StageProgress.vue` | 阶段进度显示 | ~180行 |
| `ErrorDialog.vue` | 错误对话框 | ~120行 |
| `ConfigSummary.vue` | 配置摘要预览 | ~100行 |

**Composable 集成：**

| Composable | 职责 | 状态 |
|------------|------|------|
| `usePipelineHistory.js` | 历史记录管理 | 已创建，待接入 |
| `usePipelineConfig.js` | 配置状态管理 | 待创建 |
| `usePipelineUI.js` | UI状态管理 | 待创建 |

### 9.3 UI/UX 增强

#### 9.3.1 流水线选择优化

**当前状态：**
- 基础卡片网格布局
- 无加载状态
- 无视觉层次

**优化后：**
- 添加加载骨架屏
- 改进卡片视觉层次
- 添加键盘快捷键
- 优化hover效果

#### 9.3.2 配置区域优化

**当前状态：**
- 6个折叠区过于复杂
- 无配置预览
- 无一键重置

**优化后：**
- 添加配置摘要预览
- 改进折叠区设计
- 添加一键重置功能
- 优化表单布局

#### 9.3.3 历史记录优化

**当前状态：**
- 基础列表展示
- 无批量操作
- 无搜索功能

**优化后：**
- 添加批量操作
- 添加搜索功能
- 改进排序选项
- 优化卡片设计

### 9.4 可访问性改进

#### 9.4.1 键盘导航
- 所有交互元素添加 `tabindex`
- 添加 `aria-label` 和 `aria-describedby`
- 改进焦点指示器
- 优化Tab顺序

#### 9.4.2 屏幕阅读器
- 添加适当的 ARIA 角色
- 动态内容更新通知
- 状态变化提示
- 错误信息无障碍

#### 9.4.3 颜色对比度
- 确保文本对比度符合 WCAG 2.1 AA 标准
- 状态颜色区分明显
- 焦点指示器清晰

### 9.5 响应式设计改进

#### 9.5.1 移动端优化
- 流水线网格单列布局
- 历史卡片自适应
- 触摸交互优化
- 表单元素适配

#### 9.5.2 平板端优化
- 流水线网格双列布局
- 配置区域分栏
- 历史卡片双列

#### 9.5.3 桌面端优化
- 流水线网格三列布局
- 配置区域完整展示
- 历史卡片多列

### 9.6 实施计划

#### 阶段 1：组件拆分（2天）
- 拆分 CreateView.vue 为独立组件
- 集成 usePipelineHistory.js
- 创建新的 composable

#### 阶段 2：UI 增强（2天）
- 改进流水线卡片设计
- 优化配置区域
- 改进历史记录界面

#### 阶段 3：无障碍访问（1天）
- 添加 ARIA 标签
- 改进键盘导航
- 测试屏幕阅读器

#### 阶段 4：响应式设计（1天）
- 改进移动端布局
- 优化触摸交互
- 测试不同设备

#### 阶段 5：测试和文档（1天）
- 编写组件测试
- 更新 PRD 文档
- 创建用户指南

### 9.7 预期效果

#### 9.7.1 代码质量
- CreateView.vue 从 3531 行减少到约 800 行
- 组件职责清晰，易于维护
- 测试覆盖率提高

#### 9.7.2 用户体验
- 更流畅的交互体验
- 更清晰的视觉层次
- 更好的响应式设计

#### 9.7.3 可访问性
- 符合 WCAG 2.1 AA 标准
- 完整的键盘导航
- 良好的屏幕阅读器支持

### 9.8 验收标准

- [ ] 所有新组件通过单元测试
- [ ] 键盘导航完整可用
- [ ] 屏幕阅读器可访问
- [ ] 移动端布局正常
- [ ] 性能无明显下降
- [ ] 现有功能不受影响



### 9.9 组件接入状态（2026-08-11 更新）

#### 已接入组件

| 组件 | 接入位置 | 接入方式 | 状态 |
|------|----------|----------|------|
| PipelineSelector.vue | CreateView.vue | 替换内联流水线网格（原22行→10行） | ✅ 已接入 |
| StageProgress.vue | CreateView.vue | 替换内联阶段进度（原25行→8行） | ✅ 已接入 |

#### 未接入组件及原因

| 组件 | 原因 | 替代方案 |
|------|------|----------|
| ErrorDialog.vue | 独立overlay与设计系统UiModal不一致 | 保留UiModal |
| ConfigSummary.vue | 与现有配置表单功能重复 | 不插入避免UI冗余 |

#### 数据校验

- **PipelineSelector**：pipelines数组每项需包含name、category、estimatedCost、available字段；loading/error为Boolean/String
- **StageProgress**：stages数组每项需包含name、status（completed/running/failed/waiting_approval/pending/cancelled）；progressPercent为0-100数值

#### 交互逻辑

- **PipelineSelector**：点击卡片触发select事件（传递pipeline对象）；加载中显示骨架屏；错误状态显示重试按钮
- **StageProgress**：自动根据status显示对应图标和颜色；运行中阶段显示子进度条（compose阶段）；显示每个阶段的耗时

#### 显示项

- **PipelineSelector**：分类标签（AI生成/说话头像/电影感等）、稳定性指示点（production/beta/experimental）、阶段数、消耗等级、可用性
- **StageProgress**：总进度百分比、已用时间、完成摘要、各阶段名称/状态图标/状态文本/耗时

#### 提示文字

- PipelineSelector加载态："加载流水线列表..."
- PipelineSelector错误态：错误信息 + "重试"按钮
- StageProgress阶段状态：等待中/运行中/已完成/失败/等待确认/已取消
- StageProgress时间格式："X分Y秒" 或 "Y秒"


### 3.1.30 电影工程（film-engineering）流水线合并（2026-08-18）

> **范围**：新增「影视工程（Hell Grind）」流水线，包含独立页面 `/film-engineering`、film-kit 资产库、IPC 服务与 i18n 注册。
> **分支**：`codex/film-engineering-hell-grind` → 合入 `codex/video-creation-ui`。

#### 1) 背景

视频创作模块此前已有 AI 生成、说话头像、电影感等流水线，但缺少面向专业影视制作的「电影工程」流水线。该流水线以经典电影《Hell Grind》为模板，提供完整的分镜库、剧本套用、角色/场景资产管理、一键复制与导出能力，适合需要精细控制的影视创作场景。

#### 2) 流程（数据流）

```
用户选择「电影工程」流水线卡片
  ├─ 1. CreateView 路由跳转至 /film-engineering
  ├─ 2. FilmEngineeringView 加载 film-kit 资产
  │     ├─ film-manifest.json（流水线元数据：名称/描述/阶段/分类）
  │     ├─ reference-registry.json（角色/场景/道具注册表）
  │     ├─ shot-library.json（分镜库：镜头编号/类型/描述/参考图）
  │     ├─ prompt-doctrine.json（提示词规范：风格/节奏/禁忌）
  │     └─ images/（角色/场景参考图 WebP）
  ├─ 3. 用户浏览分镜库，选择模板，套用到当前项目
  ├─ 4. 一键复制/导出分镜方案
  └─ 5. 启动流水线进入常规 Story2Video 编排
```

#### 3) 数据校验

| 项 | 规则 |
|----|------|
| film-manifest.json | 必须包含 name/description/stages/category 字段；stages 数组非空；category ∈ {generated,talking_head,cinematic,animation,screen_recording,hybrid,custom,film_engineering} |
| reference-registry.json | 角色/场景条目必须包含 id/name/type；参考图路径必须指向 images/ 目录下已有 WebP 文件 |
| shot-library.json | 每条分镜必须包含 shotId/type/description；type ∈ {wide/medium/close-up/extreme-close-up/tracking/aerial} |
| prompt-doctrine.json | 必须包含 style/tone/prohibited 字段；prohibited 为字符串数组 |
| IPC 接口 | `film-engineering:list-kits` 返回 kit 列表（至少 1 个）；`film-engineering:get-kit` 返回完整 kit 数据；`film-engineering:export` 返回 JSON 字符串 |

#### 4) 功能逻辑

- **独立页面**：`FilmEngineeringView.vue` 作为独立路由页面，与 Story2Video 流水线启动页并列，通过 `/film-engineering` 路径访问。
- **资产加载**：页面挂载时从 `electron/film-kit/` 目录读取 JSON 资产文件，通过 IPC 传递到渲染进程。
- **分镜库浏览**：左侧分镜列表，右侧预览面板，支持按类型筛选。
- **角色/场景管理**：展示角色卡（名称/描述/参考图）和场景卡（名称/氛围/参考图），支持一键套用到项目。
- **提示词规范**：显示风格指南和禁忌列表，辅助用户编写高质量提示词。
- **导出**：将选中的分镜方案导出为 JSON 文件，供后续流水线消费。
- **一键复制**：将当前分镜方案复制到剪贴板（JSON 格式）。

#### 5) 交互逻辑与显示项

- **卡片注册**：`pipeline-labels.js` 新增 `film-engineering` 条目（name/description/category/stages/stability），PipelineSelector 自动渲染卡片。
- **路由注册**：`router/index.js` 新增 `/film-engineering` → `FilmEngineeringView`。
- **IPC 服务**：`electron/ipc-handlers/film-engineering.js` 处理 kit 列表/详情/导出请求。
- **i18n**：`zh.js` / `en.js` 新增 `pipelines.names.film-engineering` 和 `pipelines.descriptions.film-engineering`。

#### 6) 提示文字

- 加载态：「正在加载影视工程资产...」
- 空状态：「暂无可用的影视工程模板」
- 导出成功：「分镜方案已导出」
- 复制成功：「已复制到剪贴板」

#### 7) 影响范围

- 新增文件：`FilmEngineeringView.vue`、`electron/film-kit/*`、`electron/ipc-handlers/film-engineering.js`、`openspec/specs/film-engineering/spec.md`
- 修改文件：`pipeline-labels.js`（新增注册）、`router/index.js`（新增路由）、`zh.js` / `en.js`（新增 i18n）
- 无破坏性变更：不影响现有流水线功能。

#### 8) 分镜视频生成与成片合成扩展（2026-09-21，film-engineering-video-gen）

> **范围**：在既有电影工程流水线末端追加「分镜视频生成（generate_videos）」与「成片合成（render）」两阶段，构成六阶段端到端；新增成本确认 checkpoint、失败分镜单镜重试 IPC、提示词原文直送合同。
> **分支**：`film-engineering-video-gen`（worktree 隔离）。
> **契约来源**：`openspec/changes/film-engineering-video-gen/specs/film-engineering/spec.md`（3 MODIFIED + 4 ADDED，18 可测场景）。

**流程（六阶段）**：分镜选取 → `generate_videos`（成本闸先行） → `render`（成片合成）。

- **原文直送**：提交给视频 provider 的 prompt 与分镜导出文本逐字符相等（含 `<<<uuid>>>` 令牌）；prompt-engine 优化器被调用即视为违例（负向场景，见 specs/video-prompt-engine）。
- **成本确认 checkpoint（cost_confirm）**：`generate_videos` 在 `context.cost_confirmation.confirmed !== true` 时返回 `awaitingConfirmation + costCheck`（逐镜 shotId/标题/画幅/时长 + 批次/Provider/模型），**零 provider 调用**；用户经 `pipeline:confirm-stage-gate` IPC 确认后重入才逐镜生成落盘 `shot_NNN.mp4`；`resumeFromCheckpoint` 重启恢复仍停在成本闸不绕过。
- **单镜重试**：`film-engineering:retry-shot` IPC（withSenderCheck），合法重试以原文直送合同单镜提交→下载→覆盖 `shot_NNN.mp4`，不迁移流水线阶段状态。
- **成片合成 render**：ffprobe 预检——规格一致走 `-c copy` 直拷，不一致 scale+pad 归一后 concat；磁盘缺镜 fail 并输出缺失序号清单、不产出 `final.mp4`；产物清单以 run 目录扫描为准（内存态标失败但磁盘已补视为可用）。成片落 `film-engineering/<runId>/final.mp4`，受控媒体根 `getAllowedMediaRoots()`。
- **fail-closed**：未配置默认视频模型时返回 `VIDEO_MODEL_NOT_CONFIGURED`（含引导字段），前端引导跳 `/model-providers`。
- **批次上限**：单批最多 10 镜（`MAX_VIDEO_BATCH` / `FILM_MAX_VIDEO_BATCH`），>10 前端拦截 + 后端兜底。

**交互逻辑与显示项**（`FilmEngineeringView.vue` + `useFilmVideoGen` composable 六态）：
- idle 发起面板（画幅 16:9 默认 / 9:16 / 源规格、时长 5/8/10s 默认 5、批量提示、>10 拦截）
- awaiting-confirm 成本确认卡（逐镜清单 + 确认/取消）
- generating 进度 + 逐镜结果列表（成功/失败/重试按钮）
- done 成片完成态（打开所在文件夹 / 另存为 / 再来一批）
- cancelled / failed（provider 未配置跳模型设置）
- 数据源：`pipelineStartOrchestrated('film-engineering', ...)` + onPipelineUpdate + 3s 轮询 `getRunSnapshot` 兜底；`costCheck` / `videoResults` / `finalPath` 取自 top-level `snapshot.context.{generate_videos,render}`。

**i18n**：`zh.js` / `en.js` 成对新增 `filmEngineering.video.*` 全量文案；`01-docs/i18n-glossary.md` 登记「分镜视频生成 / 成本确认 / 成片」。渲染端非 locales 文件零新增中文字面量（错误按 errorCode 本地化，回退串置 null）。

**影响范围**：
- 新增：`services/film-engineering/video-gen.js`、`film-render.js`、`composables/useFilmVideoGen.js` 及对应测试；IPC `film-engineering:retry-shot`、`pipeline:confirm-stage-gate`。
- 修改：`container.setup.js`（装配六阶段）、`pipeline-engine.js`（stageDefs 追加）、`story2video-paths.js`（受控根 film-engineering）、preload/access-control/publisher（暴露通道）、`FilmEngineeringView.vue`、locales。
- 二期排除清单见 `openspec/changes/film-engineering-video-gen/proposal.md`（多角色一致性、自动配音/字幕、跨 run 续拼等本期不做）。

**验证**：15 测试文件 132 单测全绿；CI 门禁 locale key-sync / CJK / glossary PASS；QM-1 打包 exe 启动 9s 存活、stderr 0 字节无告警、asar 含新模块 + require 链 PASS。

### 3.1.31 视频创作页 UI 优化（2026-08-18）

> **范围**：流水线启动页底部按钮对齐、页面导航箭头、返回按钮优化、历史记录卡片信息增强、页面名词统一。
> **分支**：`codex/video-creation-ui`，PR #990。

#### 3.1.31.1 流水线启动页底部按钮居右对齐

**需求**：流水线启动页底部操作区域（启动流水线/恢复默认选项等按钮）统一居右显示，符合用户操作习惯。

**实现**：
- `create-view.css`：`.action-bar` 新增 `justify-content: flex-end`。
- 底部操作区域保持固定定位（`position: fixed`），位于页面底部，z-index 110。
- 移动端（≤720px）按钮自动换行，仍居右对齐。

**显示项**：
- 启动流水线按钮
- 恢复默认选项按钮
- 运行中时显示暂停/取消按钮

**交互逻辑**：
- 按钮始终居右，不受内容宽度影响。
- 多个按钮时从右向左排列。

**数据校验**：
- 无新增数据字段，仅 CSS 变更。

#### 3.1.31.2 页面导航箭头

**需求**：视频创作页面顶部新增左右箭头按钮，支持在浏览历史中前进/后退，类似浏览器导航。

**实现**：
- `CreateView.vue`：新增 `viewHistory[]`（状态数组）和 `viewHistoryIndex`（当前索引）。
- `goBack()`：索引 -1，恢复上一视图状态。
- `goForward()`：索引 +1，恢复下一视图状态。
- `pushViewState(state)`：截断后续历史，追加新状态。
- `applyViewState(state)`：恢复 `view`、`selectedPipeline` 等字段。
- `canGoBack` / `canGoForward`：计算属性，控制按钮 disabled 状态。

**数据合同**：
```
viewState: {
  view: 'pipelines' | 'quick' | 'history',
  selectedPipeline: object | null
}
```

**交互逻辑**：
- 箭头按钮位于页面标题左侧（`.page-header-nav`）。
- ← 按钮：无历史时 disabled，点击执行 `goBack()`。
- → 按钮：无后续时 disabled，点击执行 `goForward()`。
- 切换视图（流水线创作/快速渲染/历史记录）时自动 `pushViewState`。
- 选择流水线进入详情时自动 `pushViewState`。

**显示项**：
- ← 按钮（disabled 态 opacity 0.35）
- → 按钮（disabled 态 opacity 0.35）

#### 3.1.31.3 返回按钮优化

**需求**：流水线详情页底部「返回流水线列表」链接文字改为「返回」，点击后跳转历史记录页。

**实现**：
- `CreateView.vue`：`goToHistory()` 方法设置 `selectedPipeline = null; view = 'history'`，调用 `loadHistory()` 和 `pushViewState()`。
- 模板中 back button 的 click 处理改为 `goToHistory()`。

**交互逻辑**：
- 点击「返回」→ 清除选中流水线 → 切换到历史记录视图 → 加载历史数据 → 推送导航状态。
- 页面顶部导航箭头同步更新（可回退到流水线详情页）。

**显示项**：
- 「← 返回」链接文字

#### 3.1.31.4 历史记录卡片信息增强

**需求**：历史记录六个状态标签共用一张卡片，统一显示通用信息，暂停/失败任务额外显示特有字段；标题为空时回退到任务文案，文案预览使用任务原文案，所有状态包括 cancelled 均遵守相同显示结构。

**通用信息（所有状态卡片均显示）**：
| 字段 | 来源 | 说明 |
|------|------|------|
| 任务标题 | `publishTitle(item)` | 优先 `title` → `params.title` → 首段文案前 60 字 → 流水线名 |
| 流水线名称 | `pipelineName(item.pipeline)` | i18n 翻译后的流水线名 |
| 状态标签 | `historyStatusLabel(item.status)` | 带颜色图标的状态文字 |
| 文案预览 | `taskContent(item)` | 任务 `sourceText/text` 或场景文案拼接后的前 120 个 JavaScript 字符，超长追加 `…`；不读取图片/视频提示词 |
| 首场景缩略图 | `story2video:get-thumbnail` | 第一场景合法图片优先；无图片时取第一段合法视频的第 0 秒首帧；失败显示固定空背景和“未生成” |
| 视频时长 | `videoDuration(item)` | 仅使用 `videoDuration`、`video.duration`、`composeDuration` 等明确成片时长字段；缺失显示“未生成” |
| 翻译预览 | `firstSegmentTranslation(item)` | 非中文 locale 显示翻译（前 140 字）；编辑页缺失时保留“未生成”占位 |
| 更新时间 | `displayTime(item)` | 有效更新时间（优先级：updatedAt → completedAt → endedAt → createdAt） |
| 创建时间 | `createdTime(item)` | ISO 日期格式化 |
| 耗时 | `historyDuration(item)` | 活跃毫秒数，格式「X分Y秒」 |
| 流水线 | `item.pipeline` | 流水线标识（tag 样式） |

**暂停任务额外字段**：
| 字段 | 来源 | 说明 |
|------|------|------|
| 暂停环节 | `item.pausedStage` | 本地化阶段名 |
| 暂停环境 | `pauseEnvironment(item)` | 检查点类型（scene_asset_selection/waiting_approval/needs_user_input/local） |

**失败任务额外字段**：
| 字段 | 来源 | 说明 |
|------|------|------|
| 失败环节 | `failedStage(item)` | status=failed 的阶段名 |
| 失败原因 | `item.error` | 自然语言描述（非原始错误对象） |

**交互逻辑**：
- paused、failed、completed、cancelled 且有有效项目的卡片 body 点击进入视频任务编辑页；running 不进入编辑页；纯 run 记录不生成编辑路由。
- 暂停/失败卡片底部显示「从断点继续」/「修改场景文案并重新生成」按钮。
- 所有状态卡片共用同一套 CSS 样式（`.history-item` + `.status-*`），仅通过状态类名区分左边框颜色和动画。

**数据校验**：
- 标题回退链：`item.title` → `item.params?.title/publishTitle` → `taskContent(item)` 前 60 字 → `pipelineName(item.pipeline)` → `tr('untitled')`；空白字符串视为缺失。
- 空值/空白字符串视为缺失，逐级回退。
- 时间字段复用 §3.1.28 的有效时间解析规则。
- project/run 合并时项目标题、文案、分段和素材优先，run 的状态、阶段、检查点、错误、runId 和运行耗时补充；`updatedAt` 取两侧最新有效时间。
- `updatedAt` 在内容、素材、提示词、翻译、字幕、语音成功保存，以及暂停、继续、取消、失败、完成状态写回后更新，且同一项目的时间戳单调递增。
- 详情页的图片、视频、图片/视频提示词、翻译、字幕、语音任一字段未生成、失败、文件不存在或不可读时，保留固定槽位和空背景，显示“未生成”，不阻塞其他场景编辑。

#### 3.1.31.5 页面名词统一

**需求**：统一视频创作模块的页面命名，确保 PRD、i18n、注释、模板一致。

**术语定义**：
| 术语 | 定义 | 使用场景 |
|------|------|----------|
| 流水线启动页 | 进入视频创作 → 选择一个流水线后进入的页面 | PRD §3.1.31、注释、模板 |
| 历史记录页 | 视频创作页面的「历史记录」标签页 | PRD §3.1.28/3.1.29、i18n |
| 视频任务编辑页 | 从历史记录点击卡片进入的编辑页面 | PRD §3.1.29、i18n |
| 流水线选择页 | 视频创作页面的「流水线创作」标签页 | PRD §3.1.24 |

**更新范围**：
- 模板注释：`流水线创作视图（流水线启动页）` → `流水线启动页（流水线创作）`
- 模板注释：`流水线启动页配置` → `流水线启动页：配置与执行`
- i18n：`create.history.detailTitle` 值为「视频任务编辑页」
- PRD：§3.1.28/3.1.29 中的「详情页/详情弹窗」统一为「视频任务编辑页」

**显示项**：
- 无新增显示项，仅文案/注释统一。

**交互逻辑**：
- 无交互变更。

### 3.1.32 影视工程页面资源不可用 Bug 修复（2026-08-19）

> 范围：修复影视工程页面进入时显示影视工程资源不可用错误。
> 分支：codex/fix-film-engineering-unavailable，PR #998。

#### 1) 根因

container.setup.js 注册了 filmEngineeringService，但 bootstrap 链路中：
- phase1-context.js 未通过 container.get('filmEngineeringService') 提取实例
- phase5-ipc.js 未将 filmEngineeringService 传递给 handlerDependencies

导致 IPC handler film-engineering.js 访问 deps.filmEngineeringService 为 undefined，service.getStatus() 抛 TypeError（非 FILM_KIT_UNAVAILABLE），前端收到通用错误并显示影视工程资源不可用。

#### 2) 流程（修复后数据流）

container.setup.js 注册 filmEngineeringService -> phase1-context.js container.get 提取 -> context.services.filmEngineeringService -> phase5-ipc.js 解构 context -> handlerDependencies.filmEngineeringService -> ipc-handlers/film-engineering.js deps 可用 -> service.getStatus() -> kit-loader 加载 film-kit -> 前端显示正常

#### 3) 数据校验

- phase1-context 返回值：ctx.filmEngineeringService 必须为 truthy（DI 容器注册后）
- handlerDependencies：filmEngineeringService 必须存在于 handlerDependencies 对象中
- IPC status 调用：film-engineering:status 返回 code 0 且 data.available 为 true

#### 4) 功能逻辑

- phase1-context.js：新增 container.get('filmEngineeringService') 并在 services 分组中添加
- phase5-ipc.js：在 context 解构和 handlerDependencies 中均添加 filmEngineeringService
- phase1-context.test.js：在 expectedFields 数组中补充 filmEngineeringService（回归保护）

#### 5) 交互逻辑与显示项

- 修复前：用户进入 /film-engineering 页面显示影视工程资源不可用错误
- 修复后：用户进入 /film-engineering 页面正常加载分镜库、场景列表、提示词规范
- 无新增交互逻辑或显示项

#### 6) 影响范围

- 修改文件：phase1-context.js（+2 行）、phase5-ipc.js（+2 行）、phase1-context.test.js（+2 行）
- 无破坏性变更：不影响现有流水线功能

#### 7) 测试逃逸分析（QM-5）

- 逃逸链：单元测试全部 mock filmEngineeringService（直接注入 deps），绕过了真实 DI -> context -> IPC 注入链路
- 系统性漏洞：缺少集成级 IPC 注册验证，测试不应只验证 handler 逻辑，还应验证 handler 依赖的完整注入路径
- 回归保护：phase1-context.test.js 新增 filmEngineeringService 字段断言，确保 context 始终包含该字段


## 10. Story2Video 页面 UX 统一（2026-08-17）

本次流水线启动页、历史记录和视频任务编辑页的详细需求、数据校验、显示项、流程、交互和提示文案见 [PRD-S2V-PIPELINE-PAGE-UX.md](./PRD-S2V-PIPELINE-PAGE-UX.md)。本节保留视频创作 PRD 的入口索引，并明确以下产品结论：进入流水线后的页面叫“流水线启动页”；历史记录中的详情入口直接进入视频任务编辑页；编辑页底部操作固定；多状态历史卡片共用一套结构；失败原因使用自然语言；暂停在流水线启动页提供，编辑页携带运行中 runId 时也提供同一受校验的暂停动作。

## 11. Story2Video 历史记录失败提示强化（2026-08-19）

### 11.1 目标与范围

历史记录、结果页和失败对话框必须帮助用户判断“哪个模型账号出了什么问题、下一步做什么”，而不是暴露内部模板变量或原始技术错误。本次范围覆盖流水线自由文本 formatter、renderer 通知归一化、zh/en locale、历史卡片/结果页最终渲染和回归测试；不改变原始错误的诊断保存、模型调用协议、IPC 结构、重试和断点恢复语义。

### 11.2 数据合同与校验

| 数据项 | 输入来源 | 展示校验 | 失败回退 |
|---|---|---|---|
| message key | 稳定错误码或已知 raw pattern | 必须属于 Story2Video 通知键集合 | operation_failed 本地化文案 |
| provider | 显式 provider/providerId 或 raw error | 仅接受已知 provider ID；拒绝 account、provider、unknown、数字和空白值 | 中文“当前模型账号”；英文“current model account” |
| context | 场景号、素材比例、生成类型 | 只拼接有限数字和 locale 标签，不接受 raw error 全文 | 空字符串，不渲染括号 |
| detail | 已知 locale 引用或受限字段 | 先解析 locale 引用；不把完整异常堆栈传给插值 | 不显示 detail |
| locale | 当前 zh/en 语言环境 | en* 归一为 en，其余回退 zh | 使用中文文案 |
| 历史原始错误 | 主进程持久化诊断字段 | 只用于分类和有限提取，renderer 不直接回显 | 通用失败提示 |

provider 显示名集中维护：minimax-multimodal、minimax-image 显示为 MiniMax，kling 显示为 Kling，agnes-image 显示为 Agnes Image。用户可见文案再追加“模型账号”或“model account”。未识别 ID 不猜测品牌，不显示内部 ID。

### 11.3 失败分类与流程逻辑

1. 主进程或流水线产生 raw error，并按既有稳定错误码/模式进入 formatter。
2. formatter 只提取 provider、场景号、素材比例、生成类型、HTTP 状态码等用于分类的有限字段；HTTP 状态码只参与分类，不进入历史提示。
3. renderer 通知归一化再次执行 provider 和 locale 校验，兼容旧快照中的 sceneText，但不再消费它。
4. 归一化结果为 messageKey + messageParams；messageParams 只允许 provider、context、detail、limitMinutes 等白名单字段。
5. locale 插值生成最终文案；最终文案必须不含 {sceneText}、{provider}、{context} 等未解析变量。
6. 历史卡片显示自然语言失败原因；用户点击卡片、编辑、修改场景或从断点继续时，继续使用既有恢复门控，不因提示文案改变任务状态。

### 11.4 提示文字与显示项

| 分类 | 中文提示核心 | English copy | 主要动作 |
|---|---|---|---|
| 限流 | 生成受频率或额度限制（场景 N），请稍等片刻后重试；若持续出现，请检查 MiniMax模型账号的套餐额度。 | Generation is rate limited (scene N). Wait a moment and retry, or check the MiniMax model account plan quota. | 等待后重试 |
| 额度/余额 | MiniMax模型账号的额度或余额已用完（场景 N），请检查该模型账号套餐，或更换模型后从断点继续。 | The MiniMax model account quota or balance is exhausted (scene N). Check the plan, or switch models and resume. | 检查额度/更换模型/断点继续 |
| 空结果 | MiniMax模型账号图片生成多次未返回结果（场景 N），可能是服务波动或账号问题。请调整场景提示词后重试。 | The MiniMax model account repeatedly returned no image result (scene N). Adjust the scene prompt and retry. | 调整场景提示词 |
| 素材生成 | 素材生成未完成（场景 0/51，图片生成），请检查 MiniMax模型账号的 API 配额和网络连接，然后从断点继续。 | Asset generation is incomplete (scenes 0/51, image generation). Check the MiniMax model account quota and network, then resume. | 检查账号/网络/断点继续 |
| API Key | MiniMax模型账号的 API Key 无效或已过期，请在模型设置中更新该模型账号的 API Key 后重试。 | The MiniMax model account API key is invalid or expired. Update it in Model Settings and retry. | 打开模型设置 |
| 参数不支持 | 图片模型 Agnes Image 不支持指定参数，请更换兼容模型后从断点继续。 | The Agnes Image model does not support the parameter. Switch models and resume. | 更换模型 |
| 未知失败 | 当前操作未能完成，请稍后再试。 | Could not complete the request. Please try again. | 稍后重试 |

历史卡片显示项：失败状态、失败环节、失败原因、任务标题/文案摘要、更新时间、run/project ID 和可用的编辑/恢复/删除动作。技术状态码、请求 ID、堆栈、provider JSON、完整 prompt-engine 错误和内部端口不显示。

### 11.5 交互逻辑

- 失败原因在历史卡片内显示短版自然语言；详情对话框可复用同一 messageKey/messageParams 二次格式化，不能重新读取 raw error。
- 已知场景号时在原因中显示场景位置；用户点击“修改场景文案并重新生成”仍定位对应场景。
- 可恢复失败继续显示“从断点继续”；内容政策失败沿既有规则进入场景编辑，不伪造可恢复状态。
- 限流类提示建议稍后重试；额度/API Key 类提示优先引导检查具体模型账号，不把重试描述成必然有效。
- unknown provider 不阻断任务状态展示，但使用当前模型账号回退并避免误导性品牌名。

### 11.6 测试与验收矩阵

| 层级 | 必测场景 |
|---|---|
| formatter 单测 | 402、429、空结果、素材比例、图片/旁白类型、已知/未知 provider、中文/英文场景号 |
| renderer 通知单测 | 稳定 key、raw 分类、旧 sceneText 兼容、二次格式化、最终文案无技术占位符 |
| 结果页回归 | 失败任务显示自然语言原因；空结果不误判内容政策；既有 7 个 baseline 失败保持原样记录 |
| locale 门禁 | zh/en key 成对、插值变量均有值、无硬编码中文提示 |
| 交付门禁 | git diff --check、pnpm run build:vue、依赖解析、OpenSpec validate、双模型/本地审查 |

### 3.1.33 历史断点恢复使用当前设置模型（2026-08-19）

需求：视频创作历史记录中，失败或中断的 Story2Video 任务点击【从断点继续】后，未完成的文字推理、图片、语音和视频调用使用当前“模型设置”中的能力模型；已完成且有效的本地资产继续复用。不新增模型选择操作。

#### 功能逻辑

1. 主进程读取旧 run snapshot 后，只对 Story2Video 在内存中增加内部恢复标记，不改变 version 1 快照结构。
2. 恢复参数保留场景文案、提示词、scene index、输入图片/音频、画幅、视频模式与选择比例、voiceId、语速、音调和情绪。
3. 顶层与阶段 options 中的旧 image/TTS/video provider 与 model 被清理；已完成的 video_plan 不再把旧视频路由当作未完成调用的显式配置。
4. 运行到实际调用边界时，按能力读取当前默认 provider；多模态 provider 优先读取 capability_models.image/tts/video/llm，缺失时回退该 provider 的首个可用 model。
5. 每个场景先检查 resume.completed 中按 index 保存的本地路径。图片、音频、视频路径有效时直接复用，不能因为原模型与当前模型不同而重生成。
6. 未完成场景允许与旧资产混合完成；最终结果按 scene index 配对，不能按完成顺序拼接。

#### 数据校验

| 数据 | 校验规则 | 失败处理 |
|---|---|---|
| 恢复参数 | 非对象按空对象；只保存 JSON-safe 内容 | 沿用既有恢复错误合同 |
| 已完成资产 | index 为非负整数；路径为受控可读本地文件 | 忽略无效条目，未完成场景重新生成 |
| provider/model | 当前 provider 已启用且声明对应能力；model 取能力默认值 | 没有可用配置时沿用既有“请先配置模型”错误 |
| voiceId | 保留原 ID，交由当前 provider/model 音色合同校验 | 不静默替换音色，不覆盖旧音频；沿用兼容错误或既有 re-clone |
| video task | 当前快照没有持久化远程 taskId | 未知状态不记为完成，按阶段级重试/图片回退语义处理 |

#### 资产与模型行为矩阵

| 状态 | 图片 | 语音 | 视频 | 结果 |
|---|---|---|---|---|
| 已完成本地资产有效 | 复用旧文件 | 复用旧文件 | 复用旧文件和 continuity 元数据 | 不调用新 provider |
| 场景未完成 | 当前 image provider/model | 当前 TTS provider/model + 原 voiceId | 当前 video provider/model | 允许新旧模型资产混合 |
| 新 TTS 不支持旧音色 | 不影响图片 | fail-closed 或按现有合同 re-clone | 不影响视频路由 | 不生成错误音色/空音频 |
| 远程视频提交未知 | 不适用 | 不适用 | 不伪造完成，不查询不存在的持久化 taskId | 继续现有阶段重试/回退 |

#### 交互、显示项与提示文字

- 历史页保留单一【从断点继续】按钮，不显示“使用旧模型/当前模型”选择器，不新增确认弹窗。
- 复用资产仍显示原有场景素材；混合新旧资产不增加额外卡片或标签。
- 当前模型路由属于主进程运行时行为，不改变现有历史状态标签。
- 音色不兼容、模型未配置和视频失败沿用现有本地化错误/诊断面；远程未知状态不得显示为“已完成”。
- 本迭代不新增用户可见 locale key；若后续需要显示“已复用/当前模型/远程状态未知”，必须先补 zh/en 成对文案、术语词典和渲染回归。

#### 风险与限制

- 新 TTS 可能拥有不同的音色集合、音色质量、语言覆盖和时长表现；保留 voiceId 能避免静默换音色，但可能导致该场景失败并需要用户处理。
- 新旧图片/视频模型的风格、画幅细节和运动表现可能不同，混合成片是明确允许的产品行为，不保证全片视觉同质。
- 远程视频 taskId 当前未持久化，不能保证“提交后进程中断”时避免远程重复任务；未来必须单独设计持久化与原绑定查询合同。

### 3.1.34 历史状态语义修订：新增「已中断」状态 + run-only 卡片回填（2026-08-20）

**背景**：用户反馈两处历史记录问题：

1. **状态归类错误**：任务 `run_1787…i1f1` 执行失败，却同时出现在「已暂停」与「执行失败」两个标签下。用户明确：「已暂停的任务一定是用户手动暂停的才应该是这个状态」。
2. **卡片显示错误**：「已暂停」「执行失败」「已取消」标签下的任务卡片标题显示流水线名词（如「故事视频合成」）、文案预览显示「未生成」。

**根因与逃逸分析**：

- Bug 1：getHistory() 把持久化 running 快照归一化为 paused（3.1.11 合同），CreateView/usePipelineHistory 又把 30 分钟无更新的 stale running 转为 paused（3.1.19 合同）——「已暂停」语义被污染为「非运行中」而非「用户手动暂停」。
- Bug 2：失败早于 saveEditableRun 草稿创建（无 project 记录）时，历史卡片无 title/sourceText，标题回退为流水线名称、文案预览回退为「未生成」。
- 逃逸根因：**PRD 自身定义了错误合同**（本节 3.1.11/3.1.14/3.1.19 的「running→paused 归一化」、S2V-PIPELINE-PAGE-UX §5.1 第 4/5 项），测试忠实实现了错误需求，因此单元/集成/E2E 全部通过却拦不住该 Bug。预防措施：状态语义变更必须先经 PM 确认（本任务由用户原话「已暂停=用户手动暂停」驱动），并同步修订所有 PRD 合同条款（本节顶部废弃警示机制）。

**核心决策**：新增「已中断（interrupted）」状态——应用退出/崩溃/强杀导致的 running 快照残留（saveRunning）与 stale-running（>30 分钟无更新）归入此类；「已暂停（paused）」仅保留用户手动暂停（pauseRun → savePaused）与 scene_asset_selection 检查点。

**一、数据校验**

| 数据 | 校验规则 | 失败处理 |
|---|---|---|
| 快照 projectId | run-state-store `_write()` 写入快照时增量附加 projectId（快照 version 保持 1，旧快照兼容）；getHistory() persisted 条目用 `snapshot.projectId || runId` 兜底 | 缺失不影响读取，仅影响 run-only 卡片回填 |
| interrupted 判定 | 磁盘快照 status='running'（重启残留）→ interrupted；展示层 `running` 且 `updatedAt > 30min` → interrupted | 快照 status 仍为 'running'，恢复链 resumeOrchestration 不变 |
| pausedStage | 仅用户手动暂停与 scene_asset_selection 检查点填充；interrupted 从 snapshot.currentStage 推导（无效索引或阶段缺失时为 null） | null 时提示行隐藏 |
| params 回填 | run-only 记录（无 project 匹配）：title ← run.params.title/publishTitle，sourceText ← run.params.text；仅当对应字段 trim 后非空才采用 | 空白视为缺失，继续回退链 |
| 恢复资格 | interrupted 与 paused/failed 同等可恢复（historyItemResumable 含 interrupted）；内容策略类错误（needs_user_input/content_policy/可能需要修改文案）仍不显示恢复按钮 | 不可恢复时不渲染恢复按钮 |
| locale/CJK | zh/en 成对新增 4 键（tabs.interrupted/statuses.interrupted/interruptedStage/interruptedHint）；renderer 不新增硬编码中文 | CI locale-sync 与 CJK 基线拦截 |

**二、流程**

    用户打开历史记录
      -> loadHistory() 并行请求 projects + pipeline runs
      -> 对持久化 running 快照（重启后残留）：normalizedStatus = 'interrupted'（原 'paused'），
         persisted 条目回填 projectId（snapshot.projectId || runId）
      -> 对每个 run.status === 'running' 且 updatedAt > 30min 的任务：
          1. run.status = 'interrupted'（原 'paused'）
          2. 无 pausedStage -> 从 stages 推导（优先级同 3.1.19：failed 阶段 -> 最后一个非 completed -> 最后阶段）
      -> run-only 记录（无 project）：title/sourceText 从快照 params 回填
      -> 排序：所有任务按有效更新时间倒序，状态严格筛选（7 个标签互斥，精确匹配）
      -> 渲染 CreateViewHistory 组件（taskContent 回退链含 params.text）

**三、功能逻辑**

| 场景 | 原状态 | 显示状态 | 环节提示 | 恢复按钮 |
|---|---|---|---|---|
| 应用退出/崩溃/强杀后的 running 快照残留 | running（快照） | 已中断 | 「中断环节：{currentStage 推导}」 | 显示 |
| 30 分钟无更新的 running | running → interrupted | 已中断 | 「中断环节：{running 阶段推导}」 | 显示 |
| 用户手动暂停 | paused | 已暂停 | 「暂停环节：{pausedStage}」 | 显示 |
| scene_asset_selection 检查点 | paused | 已暂停 | 「暂停环节：{pausedStage}」（等待素材选择） | 显示（进入素材选择） |
| 超时/崩溃导致失败 | failed | 执行失败 | 「失败环节：{stages 推导}」 | 显示 |
| 内容策略拒绝 | failed | 执行失败 | 「失败环节」 | 不显示 |
| 正常完成 | completed | 已完成 | - | 不显示 |
| 用户取消 | cancelled | 已取消 | - | 不显示（可进入编辑页） |

**四、交互逻辑**

1. **状态筛选**：筛选器共 7 项——全部/进行中/已暂停/已中断/执行失败/已完成/已取消；过滤条件严格相等匹配，标签互斥（修复"同一任务同时出现在已暂停与执行失败"）。
2. **中断提示**：interrupted 卡片显示「中断环节：{阶段名}」；无阶段名时显示「应用已退出或长时间未更新，可点击继续生成」（interruptedHint）。
3. **暂停提示**：paused 卡片仍显示「暂停环节：{pausedStage}」。
4. **恢复操作**：interrupted 卡片显示「从断点继续」按钮，触发 resume-history 事件，走既有 resumeOrchestration 恢复链（磁盘快照 status 仍为 'running'，与 3.1.33 当前设置模型恢复逻辑兼容）。
5. **卡片悬停**：沿用既有 hover 效果（translateY(-1px) + box-shadow，0.15s ease）。

**五、显示项与提示文字**

| 元素 | 位置 | 内容/样式 |
|---|---|---|
| 状态色条 | 卡片左侧 3px | interrupted 紫色 #6d28d9（running 蓝 / paused 橙 / failed 红 / completed 绿 / cancelled 灰 / interrupted 紫） |
| 状态徽章 | 标题行右侧 | 图标 ↯ + 文本「已中断」（locale statuses.interrupted） |
| 中断提示行 | 卡片第二行 | 「中断环节：xxx」（locale interruptedStage；无阶段时 interruptedHint） |
| 标签页 | 筛选器 | 「已中断」（locale tabs.interrupted），与「已暂停」并列 |
| 标题回退链 | 任务标题 | title → params.title/publishTitle → sourceText/text/场景文案 → 流水线名称 → 未命名任务（run-only 记录 params 回填后不再落到流水线名） |
| 文案预览 | 任务正文 | sourceText → text → params.text → segments 拼接；全部缺失才显示「未生成」 |

**六、回归保护**

- pipeline-engine.test.js：running 快照归一化为 interrupted（原断言 paused 更新）；persisted 条目 projectId 回填断言。
- CreateView.test.js：stale running → interrupted；run-only 卡片标题/文案回填断言（不再出现流水线名 +「未生成」组合）。
- CreateViewHistory.test.js / usePipelineHistory.test.js：stale 检测同步 interrupted；恢复按钮资格。
- locale 成对：zh/en 4 键同步（locale-sync 门禁）；CJK 基线无新增硬编码（行号位移重锚）。

**七、相关文件**

- 后端：apps/desktop/electron/services/pipeline-engine.js（getHistory）、apps/desktop/electron/services/run-state-store.js（_write 快照 projectId）
- 前端：apps/desktop/src/views/CreateView.vue（run-only params 回填 + stale interrupted）、apps/desktop/src/views/CreateViewHistory.vue（7 标签/↯ 图标/中断提示/恢复按钮/taskContent 回退链）、apps/desktop/src/composables/usePipelineHistory.js（stale interrupted + resumable）、apps/desktop/src/views/history-utils.js（HISTORY_STATUSES 加 interrupted + counts）、apps/desktop/src/styles/history-panel.css（紫色系）
- 文案：apps/desktop/src/locales/zh.js + en.js（4 键成对）

**八、废弃合同**

3.1.11（running 快照→paused）、3.1.14（stale running→paused）、3.1.19（30 分钟无更新→paused）及 S2V-PIPELINE-PAGE-UX §5.1 第 4/5 项中与本节冲突的条款以本节为准（各节顶部已加废弃警示）。


### 3.1.34a 可恢复聚合筛选 tab（2026-08-31）

展示层将已暂停和已中断归入同一个可恢复筛选 tab，筛选栏从 7 标签减少为 6 标签。底层状态值不变，卡片内仍通过图标和提示文字区分暂停原因。

数据契约：

- HISTORY_STATUSES 新增 recoverable 枚举值，RECOVERABLE_STATUSES = [paused, interrupted] 定义聚合关系。
- filterHistoryByStatus 接受 recoverable 时返回 status 为 paused 或 interrupted 的所有记录，精确匹配 paused/interrupted 仍可用。
- historyStatusCounts 新增 recoverable 计数，累加 paused 和 interrupted 的 count。
- locale tabs: zh/en 中 paused/interrupted 合并为 recoverable（可恢复/Recoverable），statuses.interrupted 保留用于卡片内提示。

不可合并底层状态的理由：

- 已暂停（用户主动）和已中断（环境异常）的来源不同，恢复路径和 checkpoint 处理逻辑有差异。
- 合并底层状态需修改 run-state-store、pipeline-engine 和 IPC 合同，风险高、收益低。
- 展示层聚合即可同时满足降低认知负担和保留精确信息的双重目标。

### 3.1.35 流水线启动前台跟踪与离开转后台生命周期（2026-08-21）

**背景**：2026-08-19 的 s2v-pipeline-always-background 把「启动」定义为纯后台（创作页不展示阶段进度），2026-08-20 的断点续跑修复（PR #1072 / 3.1.33 相关）让历史「继续/从断点继续」恢复时回到创作页前台跟踪，形成「新启动无前台进度、续跑有前台进度」的不对称。用户确认目标模型：**启动流水线后在创作页实时轮询展示进度；离开页面后任务自动转后台运行，仅在历史记录可见；再次进入创作页回到全新新建状态，可在并发上限内再次启动。**

**一、数据校验**

| 数据 | 校验规则 | 失败处理 |
|---|---|---|
| runId | `startOrchestrationForeground(runId)` 仅接受非空字符串且 trim 后非空 | 返回 false，不改变当前运行态、不切换视图、不启动轮询 |
| outcome 增强字段 | outcome.context/stages 仅作初始占位；阶段与上下文以 `updateOrchestrationStatus()` 首次全量拉取为准 | 缺失时用 `getDefaultPipelineStages()` 占位，轮询补齐，不依赖 start 返回值 |
| 轮询竞态 | 三重守卫：`orchestrationRunId` 快照比对 + `orchestrationStatusRequestId` 单调递增 + `_s2vAlive` 组件存活 | 过期响应或卸载后响应一律丢弃，不写回状态、不触发结果页跳转 |
| 并发占槽 | 主进程 `_assertConcurrencyBudget()` 仍是唯一权威判定；后台运行不释放槽位 | 超限照常返回 `PIPELINE_CONCURRENCY_LIMIT` 及 count/max 文案，前端不进入前台跟踪 |
| locale | zh/en 成对：新增 `create.story2video.startForegroundToast`，修订 `backgroundResumeToast`；renderer 不新增硬编码中文 | CI locale-sync pair + CJK 基线拦截 |

**二、流程**

```
用户点击「启动流水线」
  -> pipelineStartOrchestrated 返回 runId（autoAdvance + background 主进程异步推进）
  -> applyOrchestrationOutcome 处理同步完成/失败；outcome.paused 走素材选择检查点
  -> 否则 startOrchestrationForeground(runId)：保留 runId，立即 updateOrchestrationStatus() 拉取全量快照
  -> 3s 轮询 + pipeline:update 事件双向更新 StageProgress（runId 快照守卫）
  -> 用户留在页面：完成态 applyOrchestrationOutcome 自动跳转 /create/result；失败/取消展示错误并停止轮询
  -> 用户离开页面：beforeUnmount 停止轮询与事件订阅，run 继续在后台执行
  -> 用户重新进入创作页：mounted 全新初始态，不重挂任何 run；历史记录 5s 轮询显示运行中进度
```

**三、功能逻辑**

| 场景 | 行为 |
|---|---|
| 新启动（文案/视频/Story2Video 三条启动路径） | 前台跟踪：展示 StageProgress、running-controls（暂停/取消），启动按钮隐藏；toast 提示开始实时展示进度 |
| 历史「继续/从断点继续」恢复 running | 沿用 openRunningPipeline 前台跟踪（语义与启动对齐），toast 提示断点继续并实时展示进度 |
| scene_asset_selection 检查点 | 保持 paused，进入素材选择面板；不自动继续、不转后台 |
| 前台完成 | applyOrchestrationOutcome 自动跳转结果页（带 activeMs/输出元数据） |
| 前台失败/取消 | 停止轮询、展示错误、刷新历史 |
| 离开页面 | 清轮询；主进程不受影响，run 仅历史可见；不弹结果页 |
| 重新进入 | 全新新建初始态；并发上限允许时可再次启动（旧 run 未结束时由主进程并发门禁拦截） |

**四、交互逻辑**

1. 启动成功后进入前台跟踪：`stopPipelinePolling()` 只清旧轮询，**不得调用 `resetPipelineUiState()`**（否则 runId 被清空、进度无法挂载）。
2. 首次 `updateOrchestrationStatus()` 失败或返回非 running 时同样展示错误/终态，不盲目启动轮询；轮询仅在组件存活（`_s2vAlive !== false`）、runId 未变、未进入 failed 终态时开启。
3. `handlePipelinePush` 事件到达时更新阶段进度并重置 3s 轮询计时；事件与轮询双写由 runId 守卫防竞态。
4. 卸载竞态：`updateOrchestrationStatus()` 与 `applyOrchestrationOutcome()` 均检查 `_s2vAlive`，组件已卸载时丢弃在飞响应，杜绝已卸载组件触发 `router.push`。
5. 删除既有的纯后台机器（`runOrchestrationInBackground` / `startBackgroundCompletionWatch` / `checkBackgroundRunCompletion` / `s2vBackgroundTracking`），避免「启动后台观感」与「续跑前台观感」两套契约并存。
6. 同一 `/create` 页面内切换顶部 tab（「历史记录」或「快速渲染」）与离开创作页具有相同生命周期效果：停止轮询与 `pipeline:update` 订阅，清理当前 renderer run 展示态，不调用取消 IPC；主进程任务继续执行并占用并发槽位。切回「流水线创作」只回到新建任务列表，不自动恢复之前的 run。
7. 启动 IPC 是异步请求。切 tab、切换流水线、取消或重置时递增 `orchestrationStartRequestId`；IPC 返回后必须验证请求代际仍有效且当前视图仍为「流水线创作」，否则丢弃响应，禁止旧 runId 重新挂载、重新开启轮询或弹出过期错误。

**五、显示项与提示文字**

| 元素 | 位置 | 内容/样式 |
|---|---|---|
| 启动 toast | 创作页 action-bar | zh：「流水线已启动，正在实时展示进度；离开本页后任务继续后台运行，可在「历史记录」中查看（仍占用并发名额）。」 en：`Pipeline started. Progress is shown live here; it keeps running in the background after you leave this page and remains visible in History (still occupies a run slot).`（locale `create.story2video.startForegroundToast`） |
| 续跑 toast | 创作页 action-bar | zh：「流水线已从断点继续，正在实时展示进度；离开本页后任务继续后台运行，可在「历史记录」中查看。」（locale `create.story2video.backgroundResumeToast` 修订） |
| 运行控制 | running-controls | 暂停（⏸）/取消（✕）保持在运行态可用；启动/批量/恢复默认选项入口隐藏 |
| 独立历史页 | CreateHistory.vue | interrupted 状态标签「已中断」（紫色 #6d28d9）、卡片路由 `/create`、stale running 与主历史页同规则（30 分钟阈值）归入 interrupted；中断提示复用 locale `stageProgress.interruptedStage/interruptedHint` |

**六、回归保护**

- CreateView.test.js：启动即前台跟踪（runId 保留、GET 运行态被调用、轮询开启、toast 文案、不调用 cancel、启动按钮隐藏）；runId 快照守卫（切换 run 后旧响应不写回）；完成自动跳结果页；卸载后终态不跳转；离开页面停轮询且保留 runId；重进为全新初始态。
- CreateView.test.js：同页 tab 脱离不取消后台 run、清理展示态并在切回时保持新建初始态；启动响应延迟期间切 tab 后旧响应被代际令牌丢弃。
- CreateHistory.test.js：statusLabel interrupted；stale running → interrupted（30 分钟阈值一致、暂停环节推导）。
- locale 成对与 CJK 基线：zh/en 同步新增/修订 key；行号位移场景按脚本文档显式 `--update-baseline`。

**七、相关文件**

- 前端：apps/desktop/src/views/CreateView.vue（startOrchestrationForeground、卸载守卫、移除后台监听）、apps/desktop/src/views/CreateHistory.vue（interrupted 标签/路由/stale 规则）、apps/desktop/src/styles/history-page.css（紫色系）。
- 文案：apps/desktop/src/locales/zh.js + en.js（startForegroundToast 新增、backgroundResumeToast 修订、backgroundRunToast 删除）。

**八、废弃合同**

总 PRD「视频创作流水线启动即后台运行 §3a」与 OpenSpec s2v-pipeline-always-background 中「启动成功后 renderer 立即停止轮询、恢复初始态、仅历史观察」的条款废弃；「离开页面转后台、重进初始态、并发占槽、检查点例外」维持。以本节为准。

### 3.1.36 Provider 运行级熔断与克隆音色恢复去重（2026-08-23）

**背景**：run_1787423931138_9cak 中失效 `voice_id` 被每个并发 TTS 任务各自重克隆；MiniMax 随即返回余额/Token Plan 额度错误后，图片、文字推理与视频队列仍继续领取并消耗上游额度。

**一、产品规则**
1. 同一次流水线运行内，同一个 `(providerId, voiceId)` 克隆音色仅允许重克隆一次；并发 TTS 共享同一恢复结果，成功后后续任务复用新 voice id，失败后本运行不再重复克隆。
2. provider 返回余额不足、Token Plan、usage limit、用量上限等额度/套餐错误时，当前运行立即按 provider 维度熔断；剩余未启动的图片、TTS、LLM、视频和重克隆任务不再调用上游，已在途请求自然收尾。
3. 熔断仅作用于当前内存运行，不写入 checkpoint；断点恢复继续复用 `resume.completed` / `partialTts` 已完成产物，已恢复的新 voice id 以可序列化字段供后续恢复复用。
4. 全部 provider/model 统一处理，不做 MiniMax 特判；限流仍允许现有短暂重试，额度错误不进入限流重试。
5. 供应商返回新的克隆音色 ID 后，系统必须只在当前登录用户、当前 provider/model 的本地克隆音色目录中替换旧 ID；原有样本、展示名称和其余元数据随记录保留，供下一次运行直接使用新 ID。
6. 目标 ID 已存在时必须拒绝覆盖，避免把两个本地克隆记录错误合并；用户偏好仅在它仍指向旧 ID 时迁移到新 ID，指向其他音色的偏好不得改写。
7. 本地目录或偏好迁移失败不得撤销已经成功的当前 TTS 重试，也不得阻断当前成片；必须保留可诊断日志，让后续目录读取或用户操作能够发现并修复持久化异常。

**二、技术合同**
1. `ProviderRunContext` 按 provider ID 维护运行级 breaker，经 `getProviderRunContext(context)` 绑定到流水线上下文；`ModelProviderManager.callAdapter` 可选第四参 `{ providerRunContext }`，quota 错误自动打开 breaker，旧三参调用保持兼容。
2. `_mapWithConcurrency` 支持 `shouldStart`；breaker 打开后未启动队列返回 `{ success: false, skipped: true }`，不执行上游调用。
3. LLM 直调与 PromptBridge 优化链路共享默认 LLM provider 的 breaker；prompt-engine 出现 quota 错误时禁止 CLI/legacy fallback 再次触发同一 provider。
4. Story2Video 与 videogen 的图片、TTS、视频提交/轮询、cloneVoice 统一经 runtime options 接入；`tryReCloneVoice` 通过 ProviderRunContext 去重并持久化 `voice_recovery[providerId][voiceId]`。

**三、验收标准**
1. 同一 run 并发 TTS 遇到同一失效音色时 `cloneVoice` 调用次数为 1；成功后所有任务使用新 voice id，失败后不再重克隆。
2. 任意 provider quota 错误后，后续同 provider 的 image/TTS/LLM/video/cloneVoice 未启动调用次数为 0。
3. 断点恢复后已完成图片/音频/视频继续复用，新 voice id 映射可读取；breaker 不复用上次运行状态。
4. 限流/超时/网络仍按现有重试规则执行；额度错误不重试。
### 3.1.37 影视工程提交数据不符合要求与真实 E2E 修复（2026-08-23）

> 范围：修复电影工程分镜复制、导出、剧本套用和生成入口的“提交的数据不符合要求。请检查输入后重试。”，并补齐详情抽屉与 IPC 参数序列化问题。
> 分支：codex/film-engineering-submit-validation，PR #1125。

#### 1) 现象

- 进入电影工程后，复制分镜/批量复制/JSON/Markdown 导出/剧本套用/生成等提交操作显示“提交的数据不符合要求。请检查输入后重试。”
- 点击分镜卡不会打开详情抽屉，用户无法查看提示词正文。
- 导出与批量生成在 renderer 控制台报 “An object could not be cloned”，refTokens 带 Vue reactive proxy 无法经 IPC 序列化。

#### 2) 根因

1. `withKit(fn)` 原实现为 `fn(...args)`，但主进程 handler 统一遵循 `(_e, ...params)`：Electron event 占位被当作第一个业务参数，`sceneId/shotId/selectedShots` 全部左移为 undefined，入参校验失败返回 VALIDATION_ERROR，前端渲染为通用提示。
2. FilmEngineeringView 点击分镜时只调用 `openShot(shotId)`，未设置详情抽屉 `detailOpen = true`。
3. useFilmEngineering 的 `selectedShotsPayload()` 直接透传 Vue 响应式数组，嵌套 `refTokens` 是 reactive proxy，IPC 参数无法克隆。

#### 3) 修复与数据合同

- `withKit` 改为 `fn(event, ...args)`，handler 继续使用 `(_e, ...params)` 签名，业务参数不再左移。
- 前端新增 `onOpenShot`：先 `detailOpen.value = true` 再 `openShot(shotId)`。
- `selectedShotsPayload()` 改为 `JSON.parse(JSON.stringify(list))` 脱壳，保证 renderer 提交到 IPC 的参数是纯 JSON。
- 校验上限不变：剧本 10000、角色映射 10 键、数组批量 50、生成批量 20、prompt 50000。

#### 4) 回归保护

- 单元/组件：film-engineering.test.js 补充 withKit event 转发参数用例；useFilmEngineering.test.js 补充 selectedShotsPayload 脱壳用例。
- 真实打包 Electron E2E：新增 apps/desktop/tests/e2e/film-engineering-real.js，命令 `pnpm --filter @multi-publish/desktop test:e2e:film-engineering`，驱动 `dist-electron/win-unpacked/Multi-Publish.exe` 完成 24 项检查。
- E2E 覆盖：打包启动、入口路由、Hell Grind kit、162 个场景、分镜列表、详情抽屉、单镜/批量复制、JSON/Markdown 导出、剧本套用、方法论、生成入口真实调用。
- 验证结果：24/24 PASS；film-engineering 页面 pageErrors 为空；生成入口真实产出 `img_0000.png`。
- CI 门禁：PR #1130 将该真实 E2E 接入 Build & Release Windows job，打包后自动运行并上传报告。

#### 5) 影响范围与未覆盖边界

- 修改文件：electron/ipc-handlers/film-engineering.js、src/composables/useFilmEngineering.js、src/views/FilmEngineeringView.vue、对应测试/apps/desktop/package.json。
- 生成入口在未配置外部图片 Provider 时走离线 ffmpeg 占位图 fallback；真实外部 Provider 验收不属于本次修复范围。
- 2026-08-23 起，真实 E2E 接入 Build & Release Windows job：打包出 `dist-electron/win-unpacked/Multi-Publish.exe` 后自动运行 `test:e2e:film-engineering` 并上传报告；默认 `pnpm test:e2e` 仍运行 Vite + mock desktop 环境，不打包 EXE。

#### 6) 验收标准

- 分镜复制、批量复制、JSON/Markdown 导出、剧本套用、生成入口不再出现“提交的数据不符合要求”。
- 点击分镜卡可打开详情抽屉并显示提示词正文。
- 打包 Electron 应用运行 `test:e2e:film-engineering` 达到 24/24 PASS。
#### 视频流水线统一进度弹窗与后台脱离合同（2026-08-23）

视频创作页面中只要存在可观察的流水线阶段状态，就使用统一进度弹窗承载完整详情。弹窗采用 `UiModal` 的 progress variant，桌面最大宽度 `960px`，最大高度按视口减去固定操作条空间计算，body 独立滚动；总进度、已用时、摘要、阶段状态/详情/耗时/子进度、合成时间说明、provider warning、BGM 跳过提示、checkpoint 和素材选择均保留。历史页仍显示轻量阶段摘要，不复制可操作的完整进度面板。

启动或历史续跑得到合法非空 `runId` 后，renderer 以该 run 建立 3 秒轮询和 `pipeline:update` 推送观察。用户点击【后台运行】或右上角关闭时，先递增 request/action generation，停止轮询并清除 renderer 展示态，恢复新建任务页面，显示“任务已转入后台运行，在历史记录中可查看”，随后刷新历史；该动作不调用 `pipelineCancel`，不释放主进程并发槽位，后台 run 继续执行。弹窗遮罩和 Escape 均不可关闭，关闭只允许右上角按钮，离场包含缩小缩放。

输入合同：`runId` 必须是 trim 后非空字符串；阶段列表必须为数组；阶段和上下文字段按对象/数组类型守卫；所有 progress 数值必须为有限值并归一化到 `0..100`；JSON 数字字符串可读取，非法值隐藏或安全回退。启动、恢复、轮询、push 和暂停响应均验证 runId、请求代际和组件存活，旧响应不得污染新建状态。

人工检查点是明确例外：`scene_asset_selection`、`content_policy`、`waiting_approval`、`needs_user_input` 或 `needsCheckpoint=true` 时不显示后台按钮，右上角关闭 disabled，弹窗必须保留选择/修改/取消交互；旧快照即使只有状态枚举、没有 checkpoint 对象，也按人工检查点保护。

普通非编排流水线没有稳定 run identity 时只复用该视觉弹窗和安全清理，不声明按 run 的恢复/取消能力；新增此能力必须先补主进程 runId/API 合同和跨端回归。

**范围边界（2026-08-23 审计收口）**：统一进度弹窗合同只覆盖“有可观察流水线阶段状态”的编排流水线前台跟踪、历史续跑前台跟踪，以及获得稳定 run identity 的普通流水线；快速渲染（Remotion）loading、发布 timeline 和独立分析状态不属于该壳，保持各自轻量过程提示，不得原样声明“后台运行/在历史记录中可查看”。`CreateHistory.vue` 已废弃（`/create/history` 重定向到 `/create?view=history`，无生产引用），其内嵌进度卡片不得重新接入；当前唯一的生产历史组件是 `CreateViewHistory.vue`。




