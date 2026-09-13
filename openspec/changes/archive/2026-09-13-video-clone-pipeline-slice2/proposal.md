## Why

切片 1（PR #595，mergeCommit e97c3bf5）交付了 VideoClonePipeline 的契约层与编排层，但 ingest/analyze/plan 仍为 fail-closed 占位。要让「视频克隆」真正可跑，需要真实 adapter：本地文件校验 + ffprobe 元数据、链接下载错误分类、场景检测、ASR/改写契约。本切片补齐这三阶段的可执行实现（generate/compose/publish 仍留切片 3）。

## What Changes

- `packages/video-clone-engine/src/adapters/` 新增：
  - `runners.js`：二进制解析（VC_*/FFPROBE_PATH/FFMPEG_PATH/YTDLP_PATH 环境变量开发回退）、spawn 封装、ffprobe JSON 元数据、ffmpeg scene filter 场景检测 + `timesToShots`、yt-dlp 下载、`classifyDownloadError` 错误文本分类。
  - `ingest-local.js`：本地文件校验（存在/大小 ≤500MB/扩展名/时长 ≤30min/ffprobe 探测）+ 错误码映射。
  - `ingest-url.js`：yt-dlp 下载、平台域名提示、下载失败按文本分类映射（私密/会员/地区/反爬/不可用）、产物大小上限。
  - `analyze-ffprobe.js`：补探元数据、场景检测（scene 阈值 0.3，失败降级为合成均匀分段并记录 provenance.synthetic）、ASR 契约注入（缺省跳过，`requireTranscript` 才 fail-closed）、7 层报告骨架组装（aspect 由分辨率派生）。
  - `plan-script.js`：复刻层级/模式写入、文案改写（llmRunner 注入，失败 retryable；未注入 → skipped）、inspiration 模式仅借结构。
  - `index.js`：`createDefaultIngest`（按 source.type 分派）+ `createSlice2Pipeline`（ingest/analyze/plan 真实，generate/compose/publish 保持 fail-closed）。
- 错误码新增 `VIDEOCLONE_FILE_NOT_FOUND`（ingest，非重试）。
- 测试：新增 27 用例（含 2 个真实 ffprobe/ffmpeg 集成：默认管线停在 generate 且报告已填充；注入 stub 后全链路 ok + F4 相似度），合计 67 全绿。
- 文档：PRD v1.2 §16 切片 2 详细规格；本 OpenSpec change；CHANGELOG；.quality-gates.md。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `video-clone-pipeline`: 新增真实 ingest（本地/链接）、ffprobe analyze、plan 改写 adapter 与 runner 契约；错误码扩展 FILE_NOT_FOUND。

## Impact

- 新增：`packages/video-clone-engine/src/adapters/*`（6 文件）、`test/adapters/*`（5 文件）、`openspec/changes/video-clone-pipeline-slice2/`、PRD §16、CHANGELOG。
- 修改：`src/errors.js`（+1 错误码）、`package.json`（test script）、PRD v1.1→v1.2。
- 不触碰：既有运行时代码（electron/story2video/ops-center）；generate/compose/publish 仍为切片 3。
- 测试：`node --test`（67 用例，含真实 ffprobe/ffmpeg smoke；工具缺失自动 skip）。
