// @ts-check
/**
 * 渲染 IPC handlers
 */

function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { renderEngine, BrowserWindow, log, modelProviderManager, generateSceneVideo: injectedGenerateSceneVideo } = deps
  const { generateSceneVideo: generateSceneVideoFromStages } = require('../services/story2video-stages')
  const { resolveProviderDefaultModel } = require('../services/model-provider-manager')
  const os = require('os')
  const path = require('path')
  // 测试可注入 mock；生产环境回退到流水线 stages 的真实实现
  const generateSceneVideo = injectedGenerateSceneVideo || generateSceneVideoFromStages

  ipcMain.handle('render:start', withSenderCheck(async (event, data) => {
    try {
      // R51 P0 修复：data 为 undefined 时 data.props / data.profile 属性访问必崩
      if (!data || typeof data !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少 data 参数' }
      const win = BrowserWindow.fromWebContents(event.sender)
      const onProgress = (percent, stage) => { win?.webContents.send('render:progress', { percent, stage }) }
      const result = await renderEngine.render(data.props || data, { onProgress, profile: data.profile })
      if (result.success) win?.webContents.send('render:complete', result)
      else win?.webContents.send('render:error', result)
      // R52 修复：统一为标准 { code, data, message } 格式
      return { code: 0, data: result }
    } catch (err) {
      log.error('[render] render:start error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message }
    }
  }))

  /**
   * 快速渲染 text 模式：调用 AI 视频生成模型（提交 + 轮询 + 下载），返回本地视频路径。
   * 复用流水线 generate_assets 阶段的 generateSceneVideo 契约（同一 provider 适配器能力）。
   * 进度经 render:progress 推送（percent 0-100，stage 为阶段文案）。
   */
  ipcMain.handle('render:start-ai-video', withSenderCheck(async (event, data) => {
    try {
      if (!data || typeof data !== 'object' || typeof data.prompt !== 'string' || !data.prompt.trim()) {
        return { code: EC.VALIDATION_ERROR, message: '缺少 prompt 参数' }
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      const onProgress = (percent, stage) => { win?.webContents.send('render:progress', { percent, stage }) }
      if (!modelProviderManager || typeof modelProviderManager.callAdapter !== 'function' ||
          typeof modelProviderManager.getDefault !== 'function') {
        return { code: EC.REQUEST_ERROR, message: 'AI 视频生成服务不可用，请在模型设置中启用视频供应商' }
      }
      const provider = modelProviderManager.getDefault('video')
      if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) {
        return { code: EC.REQUEST_ERROR, message: '未配置可用的视频供应商，请在模型设置中启用视频生成能力' }
      }
      const model = resolveProviderDefaultModel(provider, 'video')
      // 快速渲染默认 9:16 竖屏（与流水线 story2video-compose 默认一致），长边封顶 1280
      const size = { width: 720, height: 1280 }
      const fps = 30
      const seconds = 8
      const runDir = path.join(os.tmpdir(), 'story2video', 'quick-render', 'ai-video')
      onProgress(1, '提交视频生成任务')
      const outcome = await generateSceneVideo({
        manager: modelProviderManager,
        providerId: provider.id.trim(),
        model,
        prompt: data.prompt.trim(),
        index: 0,
        seconds,
        size,
        fps,
        runDir,
        pollIntervalMs: 10000,
      })
      if (!outcome || !outcome.success || !outcome.path) {
        const message = (outcome && (outcome.error || outcome.message)) || 'AI 视频生成失败'
        win?.webContents.send('render:error', { success: false, error: message })
        return { code: EC.REQUEST_ERROR, message }
      }
      const result = { success: true, outputPath: outcome.path }
      win?.webContents.send('render:complete', result)
      return { code: 0, data: result }
    } catch (err) {
      log.error('[render] render:start-ai-video error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message }
    }
  }))

  ipcMain.handle('render:cancel', withSenderCheck(() => {
    try {
      // R52 修复：统一为标准格式
      renderEngine.cancel(); return { code: 0, data: true }
    } catch (e) { log.warn('[ipc:render]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('render:status', () => {
    try {
      const status = renderEngine.getStatus()
      // R52 修复：成功路径包裹为标准格式
      return { code: 0, data: status }
    } catch (e) { log.error('[render:status] error:', e); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('render:install-deps', withSenderCheck(async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await renderEngine.installDeps((text) => win?.webContents.send('render:install-progress', { text }))
      // R52 修复：统一为标准格式
      return { code: 0, data: result }
    } catch (err) {
      log.error('[render] install-deps error:', err)
      return { code: EC.REQUEST_ERROR, message: err.message }
    }
  }))

  // --- Composition 管理（Phase 1）---
  ipcMain.handle('render:list-compositions', () => {
    try {
      // R52 修复：成功路径包裹为标准格式
      return { code: 0, data: renderEngine.listCompositions() }
    } catch (e) { log.warn('[ipc:render]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
  })

  ipcMain.handle('render:get-composition', (_event, id) => {
    try {
      // R52 修复：成功路径包裹为标准格式
      return { code: 0, data: renderEngine.getComposition(id) }
    } catch (e) { log.warn('[ipc:render]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('render:validate-props', (_event, compositionId, props) => {
    try {
      // R52 修复：成功路径包裹为标准格式
      return { code: 0, data: renderEngine.validateProps(compositionId, props) }
    } catch (e) { log.warn('[ipc:render]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })
}

module.exports = registerHandlers
