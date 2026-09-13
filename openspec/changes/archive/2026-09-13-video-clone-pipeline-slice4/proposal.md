## Why

切片 1-3（PR #595/#599/#603）已交付六阶段引擎，但尚无 IPC-ready 驱动与桌面 UI 契约。本切片交付：① engine runner（createVideoCloneRunner：阶段级进度事件 + AbortSignal 协作中止，IPC 可直接驱动）；② 完整 IPC 契约与 UI 详细规格（PRD §18）；③ Electron 接线（服务/IPC/preload/Vue 视图）的契约与门禁要求——接线代码待 node_modules 环境就绪（QM-1 打包门禁）后提交。

## What Changes

- `packages/video-clone-engine`：
  - `src/pipeline.js`：executorOptions 支持 eventSink（stage:started/succeeded/failed/aborted 事件）与 abortSignal（阶段边界协作中止）；失败形状不变。
  - `src/runner.js`：createVideoCloneRunner({ createPipeline, pipelineOptions, onEvent, signal })——注入事件与中止，返回 { run, stages }。
  - 测试：runner.test.js 5 用例（事件序列/失败/运行前中止/阶段内中止/completed elapsedMs），合计 91 全绿。
- 文档：PRD v1.4 §18（IPC 通道契约表、preload API、VideoCloneView 交互逻辑、主进程服务生命周期、Electron 门禁 QM-1/QM-2 前置）；OpenSpec change；CHANGELOG；.quality-gates.md。
- Electron 接线（切片 4b）：video-clone-service.js + IPC handler + preload + VideoCloneView.vue——契约与门禁已定义，提交待 node_modules 环境（npm ci 已后台进行）与 QM-1 打包验证。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `video-clone-pipeline`: 新增 IPC-ready runner（进度事件/协作中止）与 pipeline 事件/中止注入。

## Impact

- 新增：`packages/video-clone-engine/src/runner.js`、`test/runner.test.js`、`openspec/changes/video-clone-pipeline-slice4/`、PRD §18。
- 修改：`src/pipeline.js`（+eventSink/abortSignal）、`src/index.js`、`package.json`（test script）、PRD v1.3→v1.4。
- 测试：`node --test` 91 用例（工具缺失自动 skip）。
