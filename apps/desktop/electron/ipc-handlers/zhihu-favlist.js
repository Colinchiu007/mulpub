// @ts-check
/**
 * ZhihuFavlist IPC handlers — 知乎收藏夹批量采集/改写
 *
 * 通道：
 *   zhihu-favlist:list          → 收藏夹列表（官方 API）
 *   zhihu-favlist:contents      → 收藏夹内容 URL 列表（分页遍历）
 *   zhihu-favlist:batch-collect → 批量采集（BatchRateController 串行 + 间隔 + 退避）
 *   zhihu-favlist:batch-rewrite  → 批量改写（同上）
 *   zhihu-favlist:cancel        → 取消进行中的批量任务
 *
 * Access Secret 来源：store 设置 zhihu_access_secret（用户在采集页配置）。
 */

const ZhihuFavlistService = require('../services/zhihu-favlist-service')
const BatchRateController = require('../services/batch-rate-controller')

/** 进行中批量任务的取消标记（单例：同类型任务同时只允许一个） */
const activeBatches = { collect: null, rewrite: null }

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{
 *   store: { getSetting: (k: string) => any },
 *   urlCollector: { collect: (url: string, opts?: object) => Promise<object> },
 *   pythonBridge: { requestBackend: (m: string, p: string, b?: unknown) => Promise<unknown> },
 *   log?: { info: Function, warn: Function, error: Function },
 * }} deps
 */
function registerHandlers (ipcMain, deps) {
  const { store, urlCollector, pythonBridge, log, rateControllerFactory } = deps
  const logger = log || { info: () => {}, warn: () => {}, error: () => {} }
  const svc = new ZhihuFavlistService({ log: logger })
  // rateControllerFactory：测试注入快速控制器（跳过真实 8s 延迟）；生产用默认参数
  const makeController = (opts) => rateControllerFactory
    ? rateControllerFactory(opts)
    : new BatchRateController({ log: logger, ...opts })

  /** 读取用户配置的知乎 Access Secret */
  function getAccessSecret () {
    try {
      const v = store.getSetting('zhihu_access_secret')
      return typeof v === 'string' ? v.trim() : ''
    } catch {
      return ''
    }
  }

  ipcMain.handle('zhihu-favlist:list', async () => {
    try {
      const secret = getAccessSecret()
      const r = await svc.listFavlists(secret)
      if (!r.success) return { code: -1, message: r.error }
      return { code: 0, data: r.favlists }
    } catch (e) {
      logger.error('[zhihu-favlist] list failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  ipcMain.handle('zhihu-favlist:contents', async (_event, arg) => {
    try {
      if (!arg || typeof arg !== 'object') return { code: -2, message: '缺少参数对象' }
      const secret = getAccessSecret()
      const r = await svc.getFavlistContents(secret, arg.urlToken, { maxPages: arg.maxPages })
      if (!r.success) return { code: -1, message: r.error, retryable: Boolean(r.retryable) }
      return { code: 0, data: { items: r.items, totals: r.totals } }
    } catch (e) {
      logger.error('[zhihu-favlist] contents failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  ipcMain.handle('zhihu-favlist:batch-collect', async (_event, arg) => {
    try {
      if (!arg || !Array.isArray(arg.urls)) return { code: -2, message: '缺少 URL 列表' }
      if (activeBatches.collect) return { code: -3, message: '已有批量采集任务进行中' }
      const signal = { cancelled: false }
      activeBatches.collect = signal
      const ctrl = makeController({})
      const r = await ctrl.run(arg.urls, async (url) => {
        const result = await urlCollector.collect(url, { manual: false })
        return { ok: Boolean(result && result.success), data: result, retryable: false }
      }, {
        signal,
        onProgress: (idx, total, res) => {
          logger.info('[zhihu-favlist] batch-collect progress', { index: idx + 1, total, ok: res && res.ok })
        },
      })
      activeBatches.collect = null
      return {
        code: 0,
        data: {
          completed: r.completed, failed: r.failed, cancelled: r.cancelled,
          circuitBroken: r.circuitBroken, results: r.results,
        },
      }
    } catch (e) {
      activeBatches.collect = null
      logger.error('[zhihu-favlist] batch-collect failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  ipcMain.handle('zhihu-favlist:batch-rewrite', async (_event, arg) => {
    try {
      if (!arg || !Array.isArray(arg.contents)) return { code: -2, message: '缺少内容列表' }
      if (activeBatches.rewrite) return { code: -3, message: '已有批量改写任务进行中' }
      const signal = { cancelled: false }
      activeBatches.rewrite = signal
      const ctrl = makeController({ baseIntervalMs: 3000, jitterMs: 2000 })
      const r = await ctrl.run(arg.contents, async (item) => {
        const res = await pythonBridge.requestBackend('POST', '/aggregation/rewrite', {
          content: item.content, style: arg.style || '轻松易懂', length: arg.length || 'keep',
        })
        const ok = res && res.result_content
        return { ok: Boolean(ok), data: res, retryable: false }
      }, {
        signal,
        onProgress: (idx, total, res) => {
          logger.info('[zhihu-favlist] batch-rewrite progress', { index: idx + 1, total, ok: res && res.ok })
        },
      })
      activeBatches.rewrite = null
      return {
        code: 0,
        data: {
          completed: r.completed, failed: r.failed, cancelled: r.cancelled,
          circuitBroken: r.circuitBroken, results: r.results,
        },
      }
    } catch (e) {
      activeBatches.rewrite = null
      logger.error('[zhihu-favlist] batch-rewrite failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  ipcMain.handle('zhihu-favlist:cancel', async (_event, arg) => {
    const type = arg && arg.type
    if (type === 'collect' && activeBatches.collect) {
      activeBatches.collect.cancelled = true
      return { code: 0, data: true }
    }
    if (type === 'rewrite' && activeBatches.rewrite) {
      activeBatches.rewrite.cancelled = true
      return { code: 0, data: true }
    }
    return { code: 0, data: false }
  })
}

module.exports = registerHandlers
