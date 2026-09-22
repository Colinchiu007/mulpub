// @ts-check
/**
 * 知识库 IPC handlers
 */
function registerHandlers(ipcMain, deps) {
  const { withSenderCheck } = require('./helpers')
  const EC = require('../core/error-codes').ERROR
  const log = require('../services/logger')
  const { knowledgeLibraryService, store, patternExtractionService } = deps

  if (!knowledgeLibraryService) return

  // 从 settings 表读取飞书配置并构造 FeishuClient（每次导出前调用，保证配置最新）
  function _buildFeishuClient () {
    if (!store || typeof store.getSetting !== 'function') return null
    const crypto = require('../services/crypto')
    const { FeishuClient } = require('../services/feishu-client')
    try {
      const raw = store.getSetting('feishu_api_config')
      const cfg = raw && typeof raw === 'object' ? raw : {}
      if (!cfg.appId || !cfg.appSecret) return null
      const appSecret = crypto.decrypt(Buffer.from(cfg.appSecret, 'base64'))
      if (!appSecret) return null
      return new FeishuClient({ appId: cfg.appId, appSecret })
    } catch (e) {
      return null
    }
  }

  // ─── 爆款库 ───
  ipcMain.handle('knowledge-library:add-viral', withSenderCheck(async (_event, item) => {
    try { return knowledgeLibraryService.addToViral(item) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:add-viral-batch', withSenderCheck(async (_event, items) => {
    try { return knowledgeLibraryService.addViralBatch(items) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:list-viral', async (_event, params) => {
    try { return knowledgeLibraryService.listViral(params) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })
  ipcMain.handle('knowledge-library:get-viral', async (_event, id) => {
    try { return knowledgeLibraryService.getViral(id) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })
  ipcMain.handle('knowledge-library:update-viral', withSenderCheck(async (_event, id, updates) => {
    try { return knowledgeLibraryService.updateViral(id, updates) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:delete-viral', withSenderCheck(async (_event, id) => {
    try { return knowledgeLibraryService.deleteViral(id) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:search-viral', async (_event, query, limit) => {
    try { return knowledgeLibraryService.searchViral(query, limit) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  // ─── 模式卡片（P1：LLM 提取的结构化爆款模式）───
  ipcMain.handle('knowledge-library:list-pattern-cards', async (_event, params) => {
    try {
      if (!store || typeof store.listPatternCards !== 'function') return { code: EC.REQUEST_ERROR, message: '模式卡片存储未就绪' }
      return { code: EC.SUCCESS, data: store.listPatternCards(params || {}) }
    } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })
  ipcMain.handle('knowledge-library:pattern-queue-stats', async () => {
    try { return knowledgeLibraryService.getPatternQueueStats() } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('knowledge-library:reextract-pattern', withSenderCheck(async (_event, viralItemId) => {
    try {
      if (!store || typeof store.resetPatternCard !== 'function') return { code: EC.REQUEST_ERROR, message: '模式卡片存储未就绪' }
      if (!viralItemId) return { code: EC.VALIDATION_ERROR, message: '缺少条目 ID' }
      const ok = store.resetPatternCard(String(viralItemId))
      if (!ok) return { code: EC.REQUEST_ERROR, message: '重置失败' }
      // 异步触发重提取（不阻塞 IPC 响应）
      if (patternExtractionService && typeof patternExtractionService.triggerExtraction === 'function') {
        patternExtractionService.triggerExtraction()
      }
      return { code: EC.SUCCESS, data: null }
    } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  // ─── 个人知识库 ───
  ipcMain.handle('knowledge-library:add-personal', withSenderCheck(async (_event, item) => {
    try { return knowledgeLibraryService.addPersonal(item) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:add-personal-batch', withSenderCheck(async (_event, items) => {
    try { return knowledgeLibraryService.addPersonalBatch(items) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:list-personal', async (_event, params) => {
    try { return knowledgeLibraryService.listPersonal(params) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })
  ipcMain.handle('knowledge-library:get-personal', async (_event, id) => {
    try { return knowledgeLibraryService.getPersonal(id) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })
  ipcMain.handle('knowledge-library:update-personal', withSenderCheck(async (_event, id, updates) => {
    try { return knowledgeLibraryService.updatePersonal(id, updates) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:delete-personal', withSenderCheck(async (_event, id) => {
    try { return knowledgeLibraryService.deletePersonal(id) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:search-personal', async (_event, query, limit) => {
    try { return knowledgeLibraryService.searchPersonal(query, limit) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  // ─── P2 反馈闭环：用户采纳/拒绝驱动知识置信度 ───
  ipcMain.handle('knowledge-library:apply-feedback', withSenderCheck(async (_event, action, refs) => {
    try { return knowledgeLibraryService.applyFeedback(action, refs) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  // ─── 文件批量导入 ───
  ipcMain.handle('knowledge-library:import-files', withSenderCheck(async (_event, files, categoryPerFile) => {
    try { return await knowledgeLibraryService.importFiles(files, categoryPerFile) } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  // ─── 飞书导出 ───
  ipcMain.handle('knowledge-library:export-viral-to-feishu', withSenderCheck(async (_event, title) => {
    try {
      const client = _buildFeishuClient()
      if (!client) return { code: EC.REQUEST_ERROR, message: '未配置飞书应用，请先在设置页保存 App ID 和 App Secret' }
      knowledgeLibraryService.setFeishuClient(client)
      return await knowledgeLibraryService.exportViralToFeishu(title)
    } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
  ipcMain.handle('knowledge-library:export-personal-to-feishu', withSenderCheck(async (_event, title) => {
    try {
      const client = _buildFeishuClient()
      if (!client) return { code: EC.REQUEST_ERROR, message: '未配置飞书应用，请先在设置页保存 App ID 和 App Secret' }
      knowledgeLibraryService.setFeishuClient(client)
      return await knowledgeLibraryService.exportPersonalToFeishu(title)
    } catch (e) { log.warn('[ipc:knowledge-library]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
}

module.exports = registerHandlers
