## Why

切片 1/2（PR #595/#599）已交付契约层与 ingest/analyze/plan 真实 adapter，但 generate/compose/publish 仍 fail-closed，流水线无法产出成片。本切片补齐生成侧三段：逐镜头资产规划与 provider 契约、ffmpeg 合成（字幕/水印/画幅/时长）、可选发布。

## What Changes

- `packages/video-clone-engine/src/adapters/` 新增：
  - `generate-assets.js`：`createAssetPlan`（逐镜头资产规格：kind image/video、时长、promptSeed 含 palette/tone/person/plot 锚点）+ `createGenerateAssets`（未注入 assetGenerator → PROVIDER_UNAVAILABLE fail-closed；生成失败 → ASSET_GENERATION_FAILED retryable；产物缺 path 失败）。
  - `compose-ffmpeg.js`：`resolveTargetSize`（分辨率/画幅 → 目标 WxH）、`buildAssScript`（script.lines → ASS 字幕，{\an2} 样式）、`buildComposeCommand`（图片序列 scale/pad/concat + 可选音频/字幕/水印 → ffmpeg args，纯函数）+ `createFfmpegCompose`（执行 + ffprobe 校验输出，失败 COMPOSE_FAILED retryable）。
  - `publish.js`：`createPublish`（可选发布：未注入/enabled=false → publishResult skipped 不失败；publisher 抛错 → PUBLISH_FAILED retryable）。
  - `index.js`：`createSlice3Pipeline`（全六阶段：ingest/analyze/plan 真实 + generate/compose/publish 契约，opts 注入 assetGenerator/publisher/ffmpegRunner 等）。
- 测试：新增 19 用例（generate 7 / compose-command 5 / compose 真实合成 1 / publish 4 / slice3 全链路 2），合计 86 全绿。
- 文档：PRD v1.3 §17 切片 3 详细规格；OpenSpec change；CHANGELOG；.quality-gates.md。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `video-clone-pipeline`: generate（资产规划+provider 契约）、compose（ffmpeg 合成+字幕/水印）、publish（可选发布）adapter 与纯函数命令构建。

## Impact

- 新增：`packages/video-clone-engine/src/adapters/{generate-assets,compose-ffmpeg,publish}.js`、`test/adapters/{generate-assets,compose-command,compose-integration,publish,slice3-integration}.test.js`、`openspec/changes/video-clone-pipeline-slice3/`、PRD §17。
- 修改：`src/adapters/index.js`（+createSlice3Pipeline）、`package.json`（test script）、PRD v1.2→v1.3。
- 不触碰既有运行时代码（独立流水线原则，切片 1/2 已证据化）。
- 测试：`node --test` 86 用例（含真实 ffmpeg/ffprobe 合成与全链路 smoke；工具缺失自动 skip）。
