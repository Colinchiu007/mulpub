# 设计：切片 4 — IPC-ready runner 与桌面 UI 契约

## 架构

```
engine:
  pipeline.js   executorOptions.eventSink/abortSignal → 阶段事件 + 协作中止
  runner.js     createVideoCloneRunner({createPipeline, pipelineOptions, onEvent, signal})
desktop（4b，待环境）:
  electron/services/video-clone/video-clone-service.js   runner 生命周期 + 会话表 + 清理
  ipc-handlers/video-clone.js                             video-clone:run/progress/cancel/report:edit/report:regenerate
  preload                                             window.electronAPI.videoClone.*
  src/views/VideoCloneView.vue                         输入/进度/报告编辑/结果
```

## 关键决策

1. **事件驱动进度**：pipeline 在阶段边界发 stage:started/succeeded/failed；长阶段由 adapter 自行协作检查 abort（引擎不强制中断运行中的外部命令）。
2. **中止语义**：AbortSignal 在请求校验后与每阶段入口检查；中止返回 VIDEOCLONE_INTERNAL{reason:'aborted'} + aborted 事件。
3. **IPC 序列化**：报告/请求纯 JSON（sanitizeReportForIpc 深拷贝）；错误统一 { code, phase, retryable, userMessageKey, params } → 渲染端 formatUserError。
4. **全局单例**：进度监听一次注册；窗口重建只更新发送目标（对齐既有 autoUpdater 教训）。
5. **门禁前置**：Electron 代码改动必须 QM-1 打包 + QM-2 preload/IPC 校验；node_modules 就绪前不提交 electron 改动（诚实边界）。
