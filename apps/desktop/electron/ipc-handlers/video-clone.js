// @ts-check
/**
 * 视频克隆 IPC handlers（切片 4b/4c/4d）
 * 通道：video-clone:run / cancel / report:edit / report:regenerate / pick-file / history
 * 进度：video-clone:progress（主 → 渲染事件）
 * 4d：运行记录持久化（store）+ regenerate（部分流水线 generate→compose→publish，initialReport 复用编辑后报告）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { withSenderCheck } = require('./helpers')
const engine = require('@multi-publish/video-clone-engine')
const {
  createVideoCloneAssetGenerator,
  createPlaceholderImageGenerator,
} = require('../services/video-clone/asset-generator')
const { createVideoClonePublisher } = require('../services/video-clone/publisher')
const { createVideoCloneStore } = require('../services/video-clone/store')

function registerHandlers(ipcMain, deps) {
  const log = require('../services/logger')
  const { BrowserWindow, dialog } = deps
  const tmp = os.tmpdir()
  const outputRoot = path.join(tmp, 'story2video', 'video-clone')
  fs.mkdirSync(outputRoot, { recursive: true })
  const store = createVideoCloneStore({ baseDir: deps.videoCloneStoreDir || tmp })

  const optimizeVideoPromptsBatch = deps.serviceBus && typeof deps.serviceBus.optimizeVideoPromptsBatch === 'function'
    ? deps.serviceBus.optimizeVideoPromptsBatch.bind(deps.serviceBus)
    : null
  const assetGenerator = deps.assetGenerator
    ? createVideoCloneAssetGenerator({ assetGenerator: deps.assetGenerator, optimizeVideoPromptsBatch })
    : createPlaceholderImageGenerator({ outputDir: path.join(tmp, 'story2video', 'video-clone-assets') })
  const publisher = createVideoClonePublisher({ publisherRouter: deps.publisherRouter })

  const pipelineOptions = { assetGenerator, publisher, outputDir: outputRoot, fps: 24, logger: log }

  const service = engine.createVideoCloneService({
    createPipeline: (opts) => engine.createSlice3Pipeline(Object.assign({}, opts, pipelineOptions)),
  })

  function partialRegeneratePipeline(opts) {
    return engine.createVideoClonePipeline({
      generate: engine.createGenerateAssets({ assetGenerator }),
      compose: engine.createFfmpegCompose({ outputDir: outputRoot, fps: 24 }),
      publish: engine.createPublish({ publisher, logger: log }),
    }, { stageIds: ['generate', 'compose', 'publish'], eventSink: opts.eventSink, abortSignal: opts.abortSignal })
  }

  ipcMain.handle('video-clone:run', withSenderCheck(async (event, arg) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sendProgress = (evt) => win?.webContents.send('video-clone:progress', evt)
    try {
      const result = await service.run(arg, { sendProgress })
      if (result.ok) {
        store.saveRun({
          runId: result.runId, request: arg,
          report: result.report, reportSource: result.reportSource,
          similarity: result.similarity, publishResult: result.publishResult,
          artifacts: result.artifacts,
          createdAt: new Date().toISOString(), status: 'completed',
        })
      }
      return { code: 0, data: result }
    } catch (e) {
      return { code: -1, message: e.message, errorCode: e.code || 'VIDEOCLONE_INTERNAL' }
    }
  }))

  ipcMain.handle('video-clone:cancel', (_event, arg) => {
    try {
      return { code: 0, data: service.cancel(arg && arg.runId) }
    } catch (e) { log.warn('[ipc:video-clone]', ((e && e.message) || String(e))); return { code: -1, message: e.message } }
  })

  ipcMain.handle('video-clone:report:edit', (_event, arg) => {
    try {
      const report = service.applyReportPatch(arg && arg.report, arg && arg.patch)
      return { code: 0, data: report }
    } catch (e) {
      return { code: -1, message: e.message, errorCode: 'VIDEOCLONE_REPORT_EDIT_INVALID' }
    }
  })

  ipcMain.handle('video-clone:report:regenerate', withSenderCheck(async (event, arg) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const sendProgress = (evt) => win?.webContents.send('video-clone:progress', evt)
    const runId = arg && arg.runId
    const record = runId ? store.loadRun(runId) : null
    if (!record) return { code: -1, message: '运行记录不存在', errorCode: 'VIDEOCLONE_RUN_NOT_FOUND' }
    try {
      const pipeline = partialRegeneratePipeline({ eventSink: sendProgress })
      const controller = new AbortController()
      const result = await pipeline.run({
        source: record.request.source,
        options: Object.assign({}, record.request.options, { initialReport: record.report, rewriteScript: false }),
      })
      if (result.ok) {
        store.saveRun({
          runId: result.runId, request: record.request,
          report: result.report, reportSource: result.reportSource || record.reportSource,
          similarity: result.similarity, publishResult: result.publishResult,
          artifacts: result.artifacts,
          createdAt: new Date().toISOString(), status: 'completed', regeneratedFrom: runId,
        })
      }
      return { code: 0, data: result }
    } catch (e) {
      return { code: -1, message: e.message, errorCode: e.code || 'VIDEOCLONE_INTERNAL' }
    }
  }))

  ipcMain.handle('video-clone:history', (_event) => {
    try {
      return { code: 0, data: store.listRuns() }
    } catch (e) { log.warn('[ipc:video-clone]', ((e && e.message) || String(e))); return { code: -1, message: e.message } }
  })

  ipcMain.handle('video-clone:pick-file', withSenderCheck(async (_event) => {
    const dialogApi = dialog || (() => { try { return require('electron').dialog } catch { return null } })()
    if (!dialogApi || typeof dialogApi.showOpenDialog !== 'function') {
      return { code: -1, message: '文件选择对话框不可用' }
    }
    try {
      const result = await dialogApi.showOpenDialog({
        title: '选择视频文件',
        properties: ['openFile'],
        filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] }],
      })
      if (!result || result.canceled === true || !result.filePaths || result.filePaths.length === 0) {
        return { code: 0, data: { path: null } }
      }
      return { code: 0, data: { path: result.filePaths[0] } }
    } catch (e) {
      return { code: -1, message: e.message }
    }
  }))
}

module.exports = registerHandlers
