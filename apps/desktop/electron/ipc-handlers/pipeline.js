// @ts-check
/**
 * Pipeline 流水线编排 IPC handlers
 */

function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { pipelineEngine, BrowserWindow, log, story2videoBatchQueue, dialog } = deps

  ipcMain.handle('pipeline:list', withSenderCheck(() => {
    try {
      const list = pipelineEngine.listPipelines()
      return { code: 0, data: Array.isArray(list) ? list : [] }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null, data: [] } }
  }))

  ipcMain.handle('pipeline:get', withSenderCheck((_event, name) => {
    if (typeof name !== 'string' || !name.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法流水线名称' }
    try {
      return { code: 0, data: pipelineEngine.getPipeline(name) }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:start', withSenderCheck(async (_event, name, params) => {
    if (typeof name !== 'string' || !name.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法流水线名称' }
    if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) {
      return { code: EC.VALIDATION_ERROR, message: '流水线参数必须为对象' }
    }
    try {
      const result = await pipelineEngine.start(name, params || {})
      return { code: 0, data: result }
    } catch (err) {
      log.error('[pipeline] start error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  ipcMain.handle('pipeline:pause', withSenderCheck(() => {
    try {
      return { code: 0, data: pipelineEngine.pause() }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:resume', withSenderCheck(() => {
    try {
      return { code: 0, data: pipelineEngine.resume() }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:cancel', withSenderCheck(() => {
    try {
      return { code: 0, data: pipelineEngine.cancel() }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:status', withSenderCheck((_event, name) => {
    if (typeof name !== 'string' || !name.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法流水线名称' }
    try {
      return { code: 0, data: pipelineEngine.getStatus(name) }
    } catch (err) {
      log.error('[pipeline] status error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  ipcMain.handle('pipeline:advance', withSenderCheck(() => {
    try {
      return { code: 0, data: pipelineEngine.advance() }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:history', withSenderCheck(() => {
    try {
      const history = pipelineEngine.getHistory()
      return { code: 0, data: Array.isArray(history) ? history : [] }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null, data: [] } }
  }))

  ipcMain.handle('pipeline:delete-run', withSenderCheck((_event, runId) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    try {
      const result = pipelineEngine.deleteRun(runId)
      if (result && result.success) return { code: 0, data: { deleted: true, runId: result.runId } }
      return { code: EC.REQUEST_ERROR, message: (result && result.error) || '删除运行记录失败' }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:fetch', withSenderCheck(async (_event, name) => {
    if (typeof name !== 'string' || !name.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法流水线名称' }
    try {
      const result = await pipelineEngine.fetchPipelineFromBackend(name)
      return { code: 0, data: result }
    } catch (err) {
      log.error('[pipeline] fetch error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  // ---- 编排模式（Orchestrator）IPC handlers ----

  ipcMain.handle('pipeline:startOrchestrated', withSenderCheck(async (_event, name, params) => {
    if (typeof name !== 'string' || !name.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法流水线名称' }
    if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) {
      return { code: EC.VALIDATION_ERROR, message: '编排参数必须为对象' }
    }
    try {
      const result = await pipelineEngine.startOrchestrated(name, params || {})
      return { code: 0, data: result }
    } catch (err) {
      log.error('[pipeline] startOrchestrated error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  ipcMain.handle('pipeline:resumeOrchestration', withSenderCheck(async (_event, runId) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    try {
      const result = await pipelineEngine.resumeOrchestration(runId)
      return { code: 0, data: result }
    } catch (err) {
      log.error('[pipeline] resumeOrchestration error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  ipcMain.handle('pipeline:executeStage', withSenderCheck(async (_event, runId) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    try {
      const result = await pipelineEngine.executeStage(runId)
      return { code: 0, data: result }
    } catch (err) {
      log.error('[pipeline] executeStage error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  ipcMain.handle('pipeline:advanceToNextCheckpoint', withSenderCheck(async (_event, runId) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    try {
      const result = await pipelineEngine.advanceToNextCheckpoint(runId)
      return { code: 0, data: result }
    } catch (err) {
      log.error('[pipeline] advanceToNextCheckpoint error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  // 阶段确认门（成本确认等）：确认/取消 checkpoint，可选 context 补丁透传引擎
  ipcMain.handle('pipeline:confirm-stage-gate', withSenderCheck(async (_event, runId, contextPatch) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    if (contextPatch !== undefined && (contextPatch === null || typeof contextPatch !== 'object' || Array.isArray(contextPatch))) {
      return { code: EC.VALIDATION_ERROR, message: 'contextPatch 必须为对象' }
    }
    try {
      const result = await pipelineEngine.confirmStageGate(runId, contextPatch)
      return { code: 0, data: result }
    } catch (err) {
      log.error('[pipeline] confirmStageGate error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  // 分镜素材自选（manual）：确认每个场景的素材选择并推进（finalize_assets → compose → publish）
  ipcMain.handle('pipeline:confirmSceneAssets', withSenderCheck(async (_event, runId, selections) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    if (!Array.isArray(selections)) return { code: EC.VALIDATION_ERROR, message: '素材选择必须为数组' }
    try {
      const result = await pipelineEngine.confirmSceneAssets(runId, selections)
      return { code: 0, data: result }
    } catch (err) {
      log.error('[pipeline] confirmSceneAssets error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  ipcMain.handle('pipeline:getRunContext', withSenderCheck((_event, runId) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    try {
      const snapshot = typeof pipelineEngine.getRunSnapshot === 'function'
        ? pipelineEngine.getRunSnapshot(runId)
        : pipelineEngine.getRunContext(runId)
      if (!snapshot) return { code: EC.NOT_FOUND, message: '未找到指定的流水线运行' }
      // 附带模型服务异常快照：仅包含该运行创建后（含）记录的异常（按运行归属过滤，避免跨运行残留）；
      // 运行无 createdAt 时由 snapshotSince 回退全量快照，不隐藏警告。
      const { providerAnomalyBus } = require('../services/provider-anomaly')
      const providerWarnings = providerAnomalyBus.snapshotSince(snapshot.createdAt)
      return { code: 0, data: providerWarnings.length > 0 ? { ...snapshot, providerWarnings } : snapshot }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:pauseWithCheckpoint', withSenderCheck(() => {
    try {
      return { code: 0, data: pipelineEngine.pauseWithCheckpoint() }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  // 按 runId 暂停指定运行（2026-08-16：视频任务编辑页手动暂停，保存检查点可断点续跑）
  ipcMain.handle('pipeline:pause-run', withSenderCheck((_event, runId) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    try {
      const result = pipelineEngine.pauseRun(runId)
      if (result && result.success) return { code: 0, data: result }
      return { code: EC.REQUEST_ERROR, message: (result && result.error) || '暂停流水线失败' }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  // 按 runId 取消指定运行（2026-09-12 热门选题一键生成视频：定向取消，避免无参 cancel 误杀并发 run）
  ipcMain.handle('pipeline:cancel-run', withSenderCheck((_event, runId) => {
    if (typeof runId !== 'string' || !runId.trim()) return { code: EC.VALIDATION_ERROR, message: '缺少或非法 runId' }
    try {
      const result = pipelineEngine.cancelRun(runId)
      if (result && result.success) return { code: 0, data: result }
      return { code: EC.REQUEST_ERROR, message: (result && result.error) || '取消流水线失败', errorCode: result && result.errorCode }
    } catch (e) { return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:resumeFromCheckpoint', withSenderCheck(() => {
    try {
      return { code: 0, data: pipelineEngine.resumeFromCheckpoint() }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:registerPipeline', withSenderCheck((_event, def) => {
    try {
      return { code: 0, data: pipelineEngine.registerPipeline(def) }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('pipeline:registerStageExecutor', withSenderCheck((_event, stageType, fn) => {
    try {
      return { code: 0, data: pipelineEngine.registerStageExecutor(stageType, fn) }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  // ---- Story2Video 批量创作（openspec story2video-batch-create）----

  ipcMain.handle('story2video:batch:create', withSenderCheck(async (_event, payload) => {
    if (!story2videoBatchQueue || typeof story2videoBatchQueue.createBatch !== 'function') {
      return { code: EC.REQUEST_ERROR, message: '批量创作队列服务不可用' }
    }
    if (payload === undefined || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { code: EC.VALIDATION_ERROR, message: '批量创作参数必须为对象' }
    }
    try {
      const result = await story2videoBatchQueue.createBatch(payload)
      if (result && result.success) {
        return { code: 0, data: { batchId: result.batchId, items: result.items } }
      }
      return {
        code: EC.VALIDATION_ERROR,
        message: (result && result.error) || '批量创作创建失败',
        errorCode: result && result.errorCode ? result.errorCode : undefined,
        errorParams: result && result.errorParams ? result.errorParams : undefined,
        failedItems: result && Array.isArray(result.failedItems) ? result.failedItems : undefined,
      }
    } catch (err) {
      log.error('[pipeline] story2video batch create error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message, errorCode: err?.errorCode || err?.code || null, errorParams: err?.errorParams || null }
    }
  }))

  ipcMain.handle('story2video:batch:status', withSenderCheck(() => {
    if (!story2videoBatchQueue || typeof story2videoBatchQueue.getBatches !== 'function') {
      return { code: EC.REQUEST_ERROR, message: '批量创作队列服务不可用', data: [] }
    }
    try {
      return { code: 0, data: story2videoBatchQueue.getBatches() }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null, data: [] } }
  }))

  ipcMain.handle('story2video:batch:cancel', withSenderCheck((_event, payload) => {
    if (!story2videoBatchQueue || typeof story2videoBatchQueue.cancelBatchItems !== 'function') {
      return { code: EC.REQUEST_ERROR, message: '批量创作队列服务不可用' }
    }
    if (payload === undefined || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { code: EC.VALIDATION_ERROR, message: '批量取消参数必须为对象' }
    }
    if (typeof payload.batchId !== 'string' || !payload.batchId.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '缺少或非法 batchId' }
    }
    try {
      const result = story2videoBatchQueue.cancelBatchItems(payload.batchId, payload.itemIds)
      if (result && result.success) return { code: 0, data: result }
      return {
        code: EC.VALIDATION_ERROR,
        message: (result && result.error) || '批量任务不存在',
        errorCode: result && result.errorCode ? result.errorCode : undefined,
      }
    } catch (e) { log.warn('[ipc:pipeline]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null } }
  }))

  ipcMain.handle('story2video:pick-batch-files', withSenderCheck(async (_event) => {
    const dialogApi = dialog || (() => { try { return require('electron').dialog } catch { return null } })()
    if (!dialogApi || typeof dialogApi.showOpenDialog !== 'function') {
      return { code: EC.REQUEST_ERROR, message: '文件选择对话框不可用' }
    }
    try {
      const result = await dialogApi.showOpenDialog({
        title: '选择批量创作文案文件',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '文本文件', extensions: ['txt', 'md'] }],
      })
      if (!result || result.canceled === true || !result.filePaths || result.filePaths.length === 0) {
        return { code: 0, data: { files: [] } }
      }
      const nodePath = require('path')
      const files = result.filePaths.map((filePath) => ({ path: filePath, name: nodePath.basename(filePath) }))
      return { code: 0, data: { files } }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message, errorCode: e?.errorCode || e?.code || null, errorParams: e?.errorParams || null }
    }
  }))

  // ---- 阶段进度实时推送（openspec pipeline-progress-real-time-push）----
  // PipelineEngine 事件 → 轻量快照（progressOnly，不含 context）→ 受信主窗口 webContents.send('pipeline:update')。
  // 节流：每 run 500ms 窗口合并（窗口内最后一次快照）；run 终态（pipeline:complete/fail）立即发送。
  const PUSH_CHANNEL = 'pipeline:update'
  const PUSH_WINDOW_MS = 500
  const pushTimers = new Map()   // runId -> timer
  const pushTerminal = new Set() // runId 已进入终态，不再排队
  let pushBridgeInstalled = false
  const pushOffFns = []

  const getMainWindow = () => {
    const wins = BrowserWindow.getAllWindows()
    return wins.find(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.isVisible()) ||
      wins.find(w => !w.isDestroyed() && !w.webContents.isDestroyed()) || null
  }

  const sendPush = (runId) => {
    try {
      const snapshot = typeof pipelineEngine.getRunSnapshot === 'function'
        ? pipelineEngine.getRunSnapshot(runId, { progressOnly: true })
        : null
      if (!snapshot) return
      const win = getMainWindow()
      if (win) win.webContents.send(PUSH_CHANNEL, snapshot)
    } catch (e) {
      log.warn('[pipeline:push] send failed:', e && e.message ? e.message : String(e))
    }
  }

  const flushPush = (runId) => {
    pushTimers.delete(runId)
    pushTerminal.delete(runId)
    sendPush(runId)
  }

  const queuePush = (runId, terminal) => {
    if (!runId) return
    if (terminal) {
      if (pushTimers.has(runId)) { clearTimeout(pushTimers.get(runId)); pushTimers.delete(runId) }
      pushTerminal.delete(runId)
      sendPush(runId)
      return
    }
    if (pushTimers.has(runId) || pushTerminal.has(runId)) return
    pushTimers.set(runId, setTimeout(() => flushPush(runId), PUSH_WINDOW_MS))
  }

  const installPushBridge = () => {
    if (pushBridgeInstalled || !pipelineEngine || typeof pipelineEngine.on !== 'function') return
    pushBridgeInstalled = true
    const onEvent = (terminal) => (data) => {
      const runId = data && (data.runId || data.run)
      if (!runId) return
      if (terminal) pushTerminal.add(runId)
      queuePush(runId, terminal)
    }
    const subscriptions = [
      ['stage:start', false],
      ['stage:complete', false],
      ['stage:fail', false],
      ['stage:progress', false],
      ['checkpoint:pause', false],
      ['pipeline:complete', true],
      ['pipeline:fail', true],
    ]
    for (const [eventName, terminal] of subscriptions) {
      const off = pipelineEngine.on(eventName, onEvent(terminal))
      if (typeof off === 'function') pushOffFns.push(off)
    }
  }

  const cleanupPushBridge = () => {
    pushBridgeInstalled = false
    pushOffFns.splice(0).forEach(off => { try { off() } catch (_e) { /* ignore */ } })
    for (const timer of pushTimers.values()) clearTimeout(timer)
    pushTimers.clear()
    pushTerminal.clear()
  }

  installPushBridge()
  return { cleanup: cleanupPushBridge }
}

module.exports = registerHandlers
