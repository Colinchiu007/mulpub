# 设计：VideoClonePipeline（切片 1：契约与编排）

## 架构

```
VideoClonePipeline (packages/video-clone-engine)
  ├─ src/constants.js     复刻层级 L0/L1/L2、视频类型、平台、阶段、错误码常量
  ├─ src/errors.js        VideoCloneError + 错误分类表（阶段/可重试/用户提示键）
  ├─ src/clone-report.js  CloneReport 7 层 schema：validate/normalize/edit/sanitizeForIpc
  ├─ src/similarity.js    F4 相似度：durationDeviation/structureSimilarity/scriptSimilarity/styleOverlap/computeSimilarityReport
  ├─ src/stage-executor.js 顺序阶段执行器：checkpoint 断点续跑 + 有界重试 + fail-closed（可注入时钟）
  ├─ src/pipeline.js      createVideoClonePipeline({ingest,analyze,plan,generate,compose,publish}) → run(request)
  └─ src/index.js         导出
```

## 关键决策

1. **独立包、零依赖**：`packages/video-clone-engine` 只依赖 Node 内置（node:test 跑测试），避免根 node_modules 残缺环境安装成本；后续桌面端经 workspace 引用。
2. **阶段 adapter 注入**：pipeline 不直接依赖具体下载器/ASR/生成 provider；`run(request)` 注入六个 adapter，未接线阶段返回 `VIDEOCLONE_STAGE_NOT_IMPLEMENTED`（fail-closed）。真实 adapter（yt-dlp/ffprobe/whisperX/ModelProviderManager/ffmpeg）按 tasks.md 分阶段接入。
3. **CloneReport 为唯一中间产物**：analyze 产出报告 → plan 可编辑 → generate 消费；所有跨阶段数据经 `sanitizeReportForIpc` 深拷贝（IPC 序列化安全，防 reactive proxy/引用共享）。
4. **错误分类**：错误码 → {phase, retryable, userMessageKey}，渲染端按 key 本地化「原因+建议」（对齐 user-facing-messages 契约）。
5. **相似度 F4**：纯函数可测；阈值取自 PRD §3（P1/P2），`computeSimilarityReport` 输出综合分 + 层级判定 + 各指标明细。
6. **checkpoint**：context.progress 记录已完成阶段；重跑时跳过已完成（幂等续跑），失败阶段不静默降级。

## 数据结构（摘要）

- Request: `{ source:{type:'local'|'url', path?, url?, platform?}, options:{ replicationLevel:'L0'|'L1'|'L2', mode:'structure'|'style'|'inspiration'|'full', videoTypes?:string[], rewriteScript?:boolean } }`
- CloneReport: PRD §7.2 schema（meta/narrative/script/scriptStyle/visual/audio/elements/platformParams/replication）。
- RunResult: `{ ok, runId, report?, similarity?, publishResult?, error? }`
