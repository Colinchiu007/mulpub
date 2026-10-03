# publish-progress-logging (delta)

## ADDED Requirements

### Requirement: 发布进度关键阶段落盘（不重复渲染事件）
`apps/desktop/electron/services/publish-progress-events.js` `emit`（L129-160）在向渲染层 `webContents.send('publish:progress', payload)` 之外，对**关键阶段**（start、success、failed、cancelled，即 PHASE_ENUM 终态 + start）落 `logger.notify('PublishProgress','phase-<phase>',{params:{taskId,platform,stage,percent,batchId}})`。正常 progress 阶段（percent 心跳）不落盘，避免日志膨胀。

#### Scenario: 任务开始阶段落盘
WHEN `emit(taskId,platform,'start',{stage})` 且 payload 组装成功
THEN 落 `notify('PublishProgress','phase-start',{params:{taskId,platform,stage}})`（除既有的非法 taskId warn 外，新增正常 start 落盘）

#### Scenario: 成功终态落盘
WHEN `emit(taskId,platform,'success',{result})`
THEN 落 `notify('PublishProgress','phase-success',{params:{taskId,platform,percent:100}})`

#### Scenario: 失败终态落盘带原因
WHEN `emit(taskId,platform,'failed',{error})`
THEN 落 `notify('PublishProgress','phase-failed',{params:{taskId,platform},level:'WARN',error:sanitizedError})`

#### Scenario: 取消中性终态落盘
WHEN `emit(taskId,platform,'cancelled',{})`（phase4-events 转发，非失败）
THEN 落 `notify('PublishProgress','phase-cancelled',{params:{taskId,platform}})`

#### Scenario: 进度心跳不落盘
WHEN `emit(taskId,platform,'progress',{percent:42})`
THEN 不落任何 `phase-*` notify（仅渲染层 send），避免日志风暴（与 log-storm-guard 协同）

QM-3 断言：扩展 `apps/desktop/electron/services/publish-progress-events.test.js`，mock logger，断言 start/success/failed/cancelled 各 messageKey 出现、progress 心跳不出现。
