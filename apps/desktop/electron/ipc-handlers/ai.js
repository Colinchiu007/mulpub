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
    // 改写取消（rewrite-cancel-and-truncation-summary）：分段改写把一次改写拉长到分钟级，
    // 而 ai:rewrite 此前没有任何中止途径（粘错文章也只能等全程、后续片段继续计费）。
    //
    // 形态借用本仓既有协作式范式（zhihu-favlist.js / batch-rate-controller.js 的
    // `signal = { cancelled: false }` 标记对象），**不是** AbortSignal：
    // in-flight HTTP 无法中止（信号需穿过 4 层到 fetch，会波及全部 LLM 调用，proposal §2.1），
    // 因此取消在**段边界**生效，最坏延迟 = 一个片段时长。UI 文案已如实写明。
    const activeRewrites = new Map() // runId → { token, senderId }

    /** runId 归一：仅接受短字符串；非法/缺失 ⇒ null（老调用方走此路，行为零变化） */
    const normalizeRunId = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : null)
    /** sender id 归一：单元测试的 mock 事件可能没有 sender，取不到时记 null */
    const senderIdOf = (event) => {
      const id = event && event.sender && event.sender.id
      return typeof id === 'number' ? id : null
    }

    ipcMain.handle('ai:rewrite', withSenderCheck(async (event, params) => {
      try {
        if (!params || typeof params !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
        const runId = normalizeRunId(params.runId)
        if (!runId) {
          // 无 runId：完全维持旧行为（不登记、不注入 signal、引擎零检查）
          const result = await rewriteEngineService.rewrite(params)
          return { code: 0, data: result }
        }
        if (activeRewrites.has(runId)) {
          // 同一 runId 并发：拒绝而非覆盖——共用一个 token 会让两次改写互相误杀
          return { code: EC.VALIDATION_ERROR, message: 'DUPLICATE_RUN: 该 runId 已有改写在进行中' }
        }
        const token = { cancelled: false }
        activeRewrites.set(runId, { token, senderId: senderIdOf(event) })
        try {
          const result = await rewriteEngineService.rewrite({ ...params, signal: token })
          return { code: 0, data: result }
        } finally {
          // 无论成功/失败/取消都必须释放，否则 Map 随改写次数无限增长
          activeRewrites.delete(runId)
        }
      } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('ai:rewrite-cancel', withSenderCheck((event, runId) => {
      const id = normalizeRunId(runId)
      if (!id) return { code: EC.VALIDATION_ERROR, message: '缺少 runId' }
      const entry = activeRewrites.get(id)
      if (!entry) return { code: 0, data: { cancelled: false, reason: 'not_running' } }
      // owner 校验：仅当两侧都拿得到 sender.id 时才判定（单元测试/未来非 WebContents 调用
      // 取不到 id；生产环境两侧必有，故该检查在真实路径上始终生效）
      const callerId = senderIdOf(event)
      if (entry.senderId !== null && callerId !== null && entry.senderId !== callerId) {
        return { code: 0, data: { cancelled: false, reason: 'not_owner' } }
      }
      entry.token.cancelled = true
      return { code: 0, data: { cancelled: true } }
    }))

    ipcMain.handle('ai:list-rewrite-strategies', async () => {
      try {
        return { code: 0, data: rewriteEngineService.listStrategies() }
      } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
    })

    // content（可选，第二参）：参与无有效信号时的保真优先兜底（rewrite-default-strategy-fix）。
    // ⚠ 签名兼容 ≠ 行为不变：本次修复后，空/近似空 userSettings 的自动推荐
    //   由 strategy-viral-storytelling 改为 strategy-knowledge-dry（保真兜底），
    //   这是本 PR 修复目标本身的有意变化，覆盖 AiWriterPanel/Collection/RewriteView 三个入口。
    // 老调用方只传 userSettings 时 content 为 undefined ⇒ 桥接层回落空串，签名兼容。
    ipcMain.handle('ai:get-recommended-strategies', async (_event, userSettings, content) => {
      try {
        return { code: 0, data: rewriteEngineService.getRecommendedStrategies(userSettings || {}, content) }
      } catch (e) { log.warn('[ipc:ai]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
    })
  }
}

module.exports = registerHandlers
