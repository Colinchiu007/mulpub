## Why

用户需求（2026-08-12 拍板）：输入线上视频链接（抖音/小红书/快手/B站/视频号/YouTube/TikTok/Ins）或本地视频文件，自动拆解分析（剧情/文案/文案风格/画面风格/画面元素/节奏/听觉/平台参数），产出**可编辑报告（CloneReport）**，再按报告生成「同款结构 + 同款风格 + 内容再创作」成片，逐层逼近 100%（复刻层级 L0/L1/L2）。

现状：项目已有 Story2Video 文案管线（分句→场景上下文→prompt-engine→素材→ffmpeg→发布），但**没有视频输入、没有拆解分析层、没有「报告→生成」的复刻编排**。经 GitHub 调研（RESEARCH-VIDEO-CLONE-REFERENCE-2026-08-12.md）：无完整开源成品，组件（yt-dlp/whisperX/PySceneDetect/Open-Sora/Wan2.1）成熟可复用；差异化在 7 层 CloneReport + 可编辑 + L2 画面风格级复刻 + 相似度自检（F4）+ 发布闭环。

## What Changes

- 新增独立流水线 **VideoClonePipeline**（与 Story2Video 编排隔离）：ingest → analyze → plan → generate → compose → publish。
- 新增包 `packages/video-clone-engine`（纯 Node，零运行时依赖）：
  - `CloneReport` 7 层 schema + 校验/归一化/编辑往返/IPC 脱壳（sanitize）；
  - 错误分类（阶段 × 错误码 × 是否可重试 × 用户提示键）；
  - 阶段编排器（顺序执行、checkpoint 断点续跑、有界重试、fail-closed）；
  - 相似度自检（F4：结构/文案/风格/时长偏差 + 综合分与复刻层级）；
  - Pipeline 门面 + 六个阶段的 adapter 注入契约（本切片为契约与编排，真实下载/ASR/生成 adapter 分阶段接入）。
- 文档：PRD 增补详细规格（数据校验、流程、功能/交互逻辑、显示项、提示文字 zh/en、错误码）、CHANGELOG、CCG task、记忆更新。

## Capabilities

### New Capabilities
- `video-clone-pipeline`: 视频克隆独立流水线编排 + CloneReport 契约 + 错误分类 + 相似度自检（F4）。

### Modified Capabilities
<!-- 无（不修改既有 Story2Video 编排） -->

## Impact

- 新增：`packages/video-clone-engine/`（src/* + test/*）、`openspec/specs/video-clone-pipeline/spec.md`、`01-docs/PRD-VIDEO-CLONE-2026-08-12.md` 详细规格、`CHANGELOG.md`、`.quality-gates.md`。
- 不触碰：Story2Video / electron 主进程 / ops-center（本期无运行时代码交互）。
- 测试：`node --test packages/video-clone-engine/test/`（Node 内置 runner，零依赖）。
