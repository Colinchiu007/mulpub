// @ts-check
/**
 * 效果闭环 IPC handlers — 表现数据查询 / 手动录入 / 归因重算 / 追踪列表
 */
function registerHandlers(ipcMain, deps) {
  const { withSenderCheck } = require('./helpers')
  const EC = require('../core/error-codes').ERROR
  const log = require('../services/logger')
  const { store, patternAttributionService, performanceRecrawlService } = deps

  if (!store) return

  ipcMain.handle('performance:list-tracked', async (_event, params) => {
    try {
      const page = Math.max(1, Number(params && params.page) || 1)
      const pageSize = Math.min(100, Math.max(1, Number(params && params.pageSize) || 20))
      const countRow = store.db.prepare('SELECT COUNT(*) AS n FROM tracked_content').get()
      const total = countRow ? Number(countRow.n) || 0 : 0
      const rows = store.db.prepare('SELECT * FROM tracked_content ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(pageSize, (page - 1) * pageSize)
      // 附带最新快照
      const items = rows.map(r => {
        const snap = store.getLatestSnapshot(r.id)
        return { ...r, latest_snapshot: snap || null }
      })
      return { code: EC.SUCCESS, data: { items, total } }
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  ipcMain.handle('performance:add-manual-snapshot', withSenderCheck(async (_event, trackedContentId, metrics) => {
    try {
      if (!trackedContentId) return { code: EC.VALIDATION_ERROR, message: '缺少追踪条目 ID' }
      if (!metrics || typeof metrics !== 'object') return { code: EC.VALIDATION_ERROR, message: '参数无效' }
      const snapId = store.addPerformanceSnapshot({
        trackedContentId: String(trackedContentId),
        source: 'manual',
        views: metrics.views, likes: metrics.likes, comments: metrics.comments,
        favorites: metrics.favorites, shares: metrics.shares,
        raw: { manual: true },
      })
      if (!snapId) return { code: EC.REQUEST_ERROR, message: '保存失败' }
      // 手动录入后更新追踪状态（manual/unsupported → ok，继续自动节奏）
      store.updateTrackedContent(String(trackedContentId), { recrawlStatus: 'ok' })
      return { code: EC.SUCCESS, data: { id: snapId } }
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('performance:recompute-attribution', withSenderCheck(async () => {
    try {
      if (!patternAttributionService) return { code: EC.REQUEST_ERROR, message: '归因服务未就绪' }
      return patternAttributionService.recomputeAll()
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('performance:list-pattern-performance', async (_event, params) => {
    try {
      const rows = store.listPatternPerformance(params || {})
      return { code: EC.SUCCESS, data: { items: rows } }
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  })

  // 立即回采调试入口：真正触发一轮巡检（此前为空壳只 return supported）。
  // force=true 忽略 T+1h 排期纳入窗口内全部可回采条目，用于当场观测「回采→爆款库写回」闭环。
  ipcMain.handle('performance:trigger-recrawl', withSenderCheck(async (_event, opts) => {
    try {
      const { supportedPlatforms } = require('../services/platform-metrics')
      const supported = supportedPlatforms()
      const force = Boolean(opts && opts.force)
      let ran = false
      if (performanceRecrawlService && typeof performanceRecrawlService.processRound === 'function') {
        await performanceRecrawlService.processRound({ force })
        ran = true
      }
      return { code: EC.SUCCESS, data: { supported, ran, force } }
    } catch (e) { return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
}

module.exports = registerHandlers
