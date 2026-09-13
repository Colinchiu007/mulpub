## ADDED Requirements

### Requirement: 阶段级进度事件
`createVideoClonePipeline` SHALL 在 executorOptions 接受 eventSink，并在每阶段入口发 `stage:started`、成功发 `stage:succeeded`、失败发 `stage:failed`（含序列化 error）；请求校验通过后 SHALL 发 `completed`（经 runner）。事件回调异常不得阻断流水线。

#### Scenario: 六阶段事件序列
- **WHEN** 注入 eventSink 并成功运行
- **THEN** 依次收到 ingest..publish 的 stage:started/stage:succeeded，最后 completed(ok:true)

#### Scenario: 阶段失败事件
- **WHEN** analyze 抛错
- **THEN** 收到 stage:failed{stage:'analyze', error:{code}} 且流水线返回 ok:false

### Requirement: 协作中止
`createVideoClonePipeline` SHALL 接受 abortSignal：请求校验后与每阶段入口检查；已中止 → 发 `aborted` 事件并返回 VIDEOCLONE_INTERNAL{params.reason:'aborted'}。运行中阶段的强制中断由 adapter 自行协作。

#### Scenario: 运行前中止
- **WHEN** signal 已 aborted 后运行
- **THEN** 立即返回 ok:false（reason=aborted）且无任何 stage 事件

#### Scenario: 阶段内触发中止
- **WHEN** ingest 阶段内调用 controller.abort()
- **THEN** 下一阶段（analyze）入口中止，返回 ok:false（reason=aborted）并发出 aborted 事件

### Requirement: IPC-ready runner
`createVideoCloneRunner({ createPipeline, pipelineOptions, onEvent, signal })` SHALL 构造 pipeline 并注入 eventSink/abortSignal，run(request) 包装结果并在完成时发 `completed{runId, ok, elapsedMs}`；pipeline.run 抛异常时兜底发 `failed` 并返回 ok:false。

#### Scenario: 完成事件
- **WHEN** run 成功
- **THEN** 返回 { ok:true, runId, report, ... } 且收到 completed 事件（elapsedMs ≥ 0）

### Requirement: 场景-测试映射
以上场景 SHALL 由 `packages/video-clone-engine/test/runner.test.js` 覆盖。

#### Scenario: 回归断言
- **WHEN** 运行 `node --test`（91 用例）
- **THEN** 全部通过且 exit code 0
