# publisher-logging (delta)

## ADDED Requirements

### Requirement: publisher-router 三条发布轨记录结构化生命周期日志
发布器路由的三条轨（RPA 视图、API 直调、Python 后端）必须在 publish 调用前后落结构化日志，覆盖成功/失败/取消，并携带 platform、accountId、mode、返回 URL（经 safe-http-url 消毒）、耗时。

- `RpaVmPublisher.publish`（`apps/desktop/electron/services/publisher-router.js` L452-491）
- `ApiPublisher.publish`（L508-552）
- `BackendPublisher.publish`（L561-586）
- `PublisherRouter` 分发（L591+）记录 route 选择（platform/mode）

日志一律经 `logger.notify(module, messageKey, { params, errorCategory, level })`，禁止裸 `console.*` / 字符串 concat；返回 URL 必须经 `sanitizePublishResultUrl`（既有，L485/L551/L583 已用）后入 params。

#### Scenario: RPA 发布成功记录 dom 模式结果
WHEN `RpaVmPublisher.publish` 经 `rpaViewManager.publish` 返回 `{success:true, url, postId}` 且 platform=baijiahao
THEN 落 `notify('PublisherRouter','rpa-publish-ok',{params:{platform:'baijiahao',accountId,mode:'dom',url:sanitized,durationMs},level:'INFO'})`，且 url 不含控制字符

#### Scenario: API 发布因 Cookie 缺失失败被记录
WHEN `ApiPublisher.publish` 因 `cookies.length===0` 抛出「平台 Cookie 缺失」（L517）
THEN 落 `notify('PublisherRouter','api-publish-error',{params:{platform,accountId,mode:'api'},errorCategory:'auth_missing',level:'ERROR',error:'平台 Cookie 缺失...'})`

#### Scenario: 后端发布失败记录
WHEN `BackendPublisher.publish` 命中 `result.code!==0` 分支抛错（L585）
THEN 落 `notify('PublisherRouter','backend-publish-error',{params:{platform},errorCategory:'backend_error',level:'ERROR',error})`

#### Scenario: 路由选择被记录
WHEN `PublisherRouter` 为某 platform 选中 ApiPublisher（mode=api）
THEN 落 `notify('PublisherRouter','route-selected',{params:{platform,mode:'api'}})`

#### Scenario: 发布被取消信号中止
WHEN `publish` 在 await 期间 `signal.aborted` 为真抛 `任务已取消`（L464/L476/L520/L547）
THEN 落 `notify('PublisherRouter','publish-cancelled',{params:{platform,accountId},level:'WARN'})`

QM-3 断言：新增 `apps/desktop/electron/services/publisher-router-logging.test.js`，用 `vi.mock('../services/logger', () => ({ info, warn, error, notify }))` 的 `notify` recorder 断言上述 messageKey 出现且 params 含 platform/accountId/mode/durationMs。

### Requirement: video-clone-engine 发布适配记录结构化日志
`packages/video-clone-engine/src/adapters/publish.js` `createPublish().run` 必须记录 skipped（无 publisher）/ publish 成功 / VIDEOCLONE_PUBLISH_FAILED 三态（接入 logger，复用 shared-utils 或包内 logger）。

#### Scenario: 无 publisher 时记录 skipped
WHEN `enabled!==true || typeof publisher!=='function'`（L12）
THEN 落 `notify('VideoClonePublish','publish-skipped',{params:{reason:'no-publisher'}})`

#### Scenario: 发布成功记录
WHEN `publisher({media,report})` 成功返回（L18）
THEN 落 `notify('VideoClonePublish','publish-ok',{params:{mediaType},level:'INFO'})`

#### Scenario: 发布失败记录并带 cause
WHEN `publisher` 抛错被包成 `VideoCloneError('VIDEOCLONE_PUBLISH_FAILED',{phase:'publish',cause:err})`（L21）
THEN 落 `notify('VideoClonePublish','publish-error',{params:{phase:'publish'},errorCategory:'video_clone_publish',level:'ERROR',error:String(err.message)})`，且 error 经消毒（见 log-injection-sanitization）

QM-3 断言：新增 `packages/video-clone-engine/src/adapters/__tests__/publish-logging.test.js`，mock logger，断言三种 messageKey 出现。

### Requirement: publish-progress-events 关键相位结构化日志
`apps/desktop/electron/services/publish-progress-events.js` 的 `createPublishProgressEmitter` 在每次向渲染层 `send('publish:progress', ...)` 之后，必须仅对**关键相位（terminal phase）**补一条结构化 `notify`（`log.notify('PublishProgress','phase-'+phase, {...})`），用于可观测性。心跳/重试/阻塞相位（`phase` 不在 `start/success/failed/cancelled` 集合内）**不得**触发 notify，以免日志风暴。

- 模块级 `emitPhaseNotify(platform, taskId, normalizedPhase, payload)` 仅在 `normalizedPhase ∈ {start, success, failed, cancelled}` 时生效，其余相位直接 return。
- 关键相位对应的 level 与 errorCategory：`start→INFO`、`success→INFO`、`failed→ERROR`（errorCategory=`publish_phase_failed`）、`cancelled→INFO`（无 errorCategory）。
- params 字段：`platform`、`taskId`、`stageKey`（payload.stageKey）、`percent`（payload.percent）。
  - `failed`：额外加 `params.error = String(payload.error)`（从 payload.error 经 String 强制，不得抛）。
  - `success`：当 `payload.result !== undefined` 时额外加 `params.hasResult = true`（percent 取 100、`done` 语义），否则不加。
  - `cancelled`：不携带 errorCategory、不携带 error。
- `phase` 归一化沿用 `PHASE_ENUM`；`percent` 在 start 为 0、success 为 100、failed/cancelled 取 payload.percent（可能为 null）。
- `getMainWin()` 返回 null 时：emit 与 notify 均不得抛（已验证），notify 不触发（无窗口即无上下文，不强行落盘）。
- 调用位置：在 `emit` 的 `send` try/catch 之后统一调用一次 `emitPhaseNotify(...)`，不进入 progress 心跳热路径。

#### Scenario: 任务开始落 phase-start
WHEN emitter 发出 `phase:'start'`（stageKey=prepare，percent=0）
THEN 落 `notify('PublishProgress','phase-start',{params:{platform,taskId,stageKey:'prepare',percent:0},level:'INFO'})`，且进度心跳不落 notify

#### Scenario: 任务成功落 phase-success
WHEN emitter 发出 `phase:'success'`（percent=100，含 result）
THEN 落 `notify('PublishProgress','phase-success',{params:{platform,taskId,stageKey,percent:100,hasResult:true},level:'INFO'})`

#### Scenario: 任务失败落 phase-failed（带 error）
WHEN emitter 发出 `phase:'failed'`（payload.error='超时'）
THEN 落 `notify('PublishProgress','phase-failed',{params:{platform,taskId,stageKey,percent:null,error:'超时'},errorCategory:'publish_phase_failed',level:'ERROR'})`

#### Scenario: 任务取消落 phase-cancelled（中性，无 errorCategory）
WHEN emitter 发出 `phase:'cancelled'`（percent=null）
THEN 落 `notify('PublishProgress','phase-cancelled',{params:{platform,taskId,stageKey,percent:null},level:'INFO'})`，且无 errorCategory

#### Scenario: 进度心跳不落 notify
WHEN emitter 连续发出多个 `phase:'progress'`（含 percent 推进）
THEN 不触发任何 `notify('PublishProgress','phase-*')`，只有 start/success/failed/cancelled 四种相位 notify

#### Scenario: 重试/阻塞相位不落 notify
WHEN emitter 发出 `phase:'retry'` 或 `phase:'blocked'`
THEN 不触发 `phase-retry` / `phase-blocked` notify（不在 terminal 集合内）

QM-3 断言：扩展 `apps/desktop/electron/services/publish-progress-events.test.js`，新增 describe「createPublishProgressEmitter — 关键相位 notify 可观测性（P0-2）」：用 `vi.spyOn(realLogger,'notify')` 真实 logger spy（不 vi.mock logger 工厂，否则拦截不到 SUT 同级 `require('./logger')`），断言 start→phase-start(INFO,percent 0,stageKey prepare)、success→phase-success(INFO,hasResult,percent 100)、failed→phase-failed(ERROR,errorCategory 'publish_phase_failed',error '超时')、cancelled→phase-cancelled(INFO,无 errorCategory,percent null)、progress 心跳不出现 notify、retry/blocked 不出现 notify、getMainWin 为 null 不抛、整轮成功仅出现 [phase-start, phase-success] 两条 key。
