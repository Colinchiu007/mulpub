// @ts-check
/**
 * AI 生成 IPC handlers
 */

function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { aiGenerator, aiWriter, BrowserWindow, log } = deps

  ipcMain.handle('ai:list-providers', (_event, type) => {
    try {
      return { code: 0, data: aiGenerator.listProviders(type || null) }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
  })

  ipcMain.handle('ai:get-config', (_event, providerId) => {
    try {
      return { code: 0, data: aiGenerator.getProviderConfig(providerId) }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('ai:list-models', (_event, providerId) => {
    try {
      return { code: 0, data: aiGenerator.listModels(providerId) }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
  })

  ipcMain.handle('ai:generate', withSenderCheck(async (event, arg) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const onProgress = (p) => win?.webContents.send('ai:progress', p)
    try {
      // R51 P1：解构保护
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { type, provider, params } = arg
      const result = await aiGenerator.generate(type, provider, params, onProgress)
      win?.webContents.send('ai:complete', result)
      return { code: 0, data: result }
    } catch (e) {
      const err = { code: EC.REQUEST_ERROR, message: e.message }
      win?.webContents.send('ai:error', err)
      return err
    }
  }))

  ipcMain.handle('ai:test-connection', async (_event, providerId) => {
    try {
      return { code: 0, data: await aiGenerator.testConnection(providerId) }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('ai:save-config', withSenderCheck((_event, providerId, config) => {
    try {
      return { code: 0, data: aiGenerator.updateProviderConfig(providerId, config) }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  // AiWriter 辅助写作 API（AiWriterPanel.vue 使用）
  ipcMain.handle('ai:is-configured', () => {
    try {
      return { code: 0, data: aiWriter.isConfigured() }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('ai:generate-titles', withSenderCheck(async (_event, topic) => {
    try {
      const titles = await aiWriter.generateTitles(topic)
      return { code: 0, data: titles }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('ai:enhance-content', async (_event, content, style) => {
    try {
      const enhanced = await aiWriter.enhanceContent(content, style)
      return { code: 0, data: enhanced }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

ipcMain.handle('ai:generate-summary', withSenderCheck(async (_event, content) => {
    try {
      const summary = await aiWriter.generateSummary(content)
      return { code: 0, data: summary }
    } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  // RewriteEngine 改写引擎 API（Phase 3 — rewrite-engine 包）
  const rewriteEngineService = deps.rewriteEngineService
  if (rewriteEngineService) {
    ipcMain.handle('ai:rewrite', withSenderCheck(async (_event, params) => {
      try {
        if (!params || typeof params !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
        const result = await rewriteEngineService.rewrite(params)
        return { code: 0, data: result }
      } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('ai:list-rewrite-strategies', async () => {
      try {
        return { code: 0, data: rewriteEngineService.listStrategies() }
      } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
    })

    // content（可选，第二参）：参与无有效信号时的保真优先兜底（rewrite-default-strategy-fix）。
    // 老调用方只传 userSettings 时 content 为 undefined ⇒ 桥接层回落空串，行为不变。
    ipcMain.handle('ai:get-recommended-strategies', async (_event, userSettings, content) => {
      try {
        return { code: 0, data: rewriteEngineService.getRecommendedStrategies(userSettings || {}, content) }
      } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
    })
  }
}

module.exports = registerHandlers
