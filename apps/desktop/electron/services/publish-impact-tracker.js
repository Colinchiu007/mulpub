// @ts-check
/**
 * PublishImpactTracker — 发布后影响力追踪（方案 C）
 *
 * 发布后在 T+1h / T+24h / T+72h 定时搜索提及和讨论，
 * 记录到 impact_snapshots 表，展示在 Dashboard 看板。
 *
 * 使用方式:
 *   const tracker = new PublishImpactTracker(contentIntelligence)
 *   tracker.scheduleImpactTracking({ articleId, title, keywords, platform })
 *
 * 文件位置: apps/desktop/electron/publish-impact-tracker.js
 */
const log = require('./logger')
const EC = require('../core/error-codes').ERROR

class PublishImpactTracker {
  constructor (contentIntelligence) {
    this.ci = contentIntelligence
    this._timers = new Map()   // articleId -> { intervals, snapshots }
    this._intervals = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '72h': 72 * 60 * 60 * 1000,
    }
  }

  /**
   * Schedule impact tracking for a published article.
   * Tracks at T+1h, T+24h, T+72h intervals.
   *
   * @param {object} opts
   * @param {string} opts.articleId — Task/article ID
   * @param {string} opts.title — Article title
   * @param {string} opts.keywords — Search keywords (default: title)
   * @param {string} opts.platform — Publishing platform
   */
  scheduleImpactTracking (opts) {
    const { articleId, title, keywords, platform } = opts
    if (!articleId) {
      log.warn('ImpactTracker', 'scheduleImpactTracking: missing articleId')
      return
    }

    // Cancel any existing schedule for this article
    this._cancelTracking(articleId)

    const searchKeywords = keywords || title
    if (!searchKeywords) {
      log.warn('ImpactTracker', 'scheduleImpactTracking: no keywords/title to search')
      return
    }

    log.info('ImpactTracker', `Scheduled tracking for "${title?.slice(0, 40)}" (${articleId})`)

    const intervals = []
    const schedule = []

    for (const [label, delay] of Object.entries(this._intervals)) {
      const timer = setTimeout(async () => {
        await this._captureSnapshot(articleId, title, searchKeywords, platform, label)
      }, delay)
      // R28 修复：unref 让定时器不阻止进程退出
      if (timer && timer.unref) timer.unref()
      intervals.push(timer)
      schedule.push({ label, delay, at: new Date(Date.now() + delay).toISOString() })
    }

    this._timers.set(articleId, { intervals, schedule })

    // Immediate: capture initial baseline snapshot
    // (use small delay to let the publish complete)
    const baselineTimer = setTimeout(async () => {
      // 执行后从 intervals 中移除自身（避免 stopAll 重复清除已触发的句柄）
      const entry = this._timers.get(articleId)
      if (entry) {
        const idx = entry.intervals.indexOf(baselineTimer)
        if (idx >= 0) entry.intervals.splice(idx, 1)
      }
      await this._captureSnapshot(articleId, title, searchKeywords, platform, 'baseline')
    }, 60_000)  // T+1min
    // R28 修复：baselineTimer 同样需 unref（与 line 63 的 timer 对齐）
    if (baselineTimer && baselineTimer.unref) baselineTimer.unref()
    intervals.push(baselineTimer)

    return { articleId, schedule }
  }

  /**
   * Capture a single impact snapshot.
   */
  async _captureSnapshot (articleId, title, keywords, platform, label) {
    try {
      log.info('ImpactTracker', `Capturing ${label} snapshot for ${articleId}`)

      const result = await this.ci.searchMentions(keywords, { limit: 8, noCache: true })

      await this.ci.saveImpactSnapshot(articleId, title, keywords, result)

      log.info('ImpactTracker',
        `${label} snapshot saved: ${result.total} mentions for "${title?.slice(0, 30)}"`
      )
      return result
    } catch (e) {
      log.error('ImpactTracker', `Snapshot error (${label}): ${e.message}`)
      return null
    }
  }

  /**
   * Cancel all tracking for an article.
   */
  _cancelTracking (articleId) {
    const existing = this._timers.get(articleId)
    if (existing) {
      for (const timer of existing.intervals) {
        clearTimeout(timer)
      }
      this._timers.delete(articleId)
    }
  }

  /**
   * Cancel tracking for a specific article (external API).
   */
  cancelTracking (articleId) {
    this._cancelTracking(articleId)
  }

  /**
   * 清理所有追踪定时器（应用退出时调用）
   */
  stopAll () {
    for (const [articleId, data] of this._timers) {
      for (const timer of data.intervals) {
        clearTimeout(timer)
      }
    }
    this._timers.clear()
  }

  /**
   * Get all active tracking schedules.
   */
  getActiveTrackings () {
    const result = []
    for (const [articleId, data] of this._timers) {
      result.push({ articleId, schedule: data.schedule })
    }
    return result
  }

  /**
   * Register IPC handlers for rendering impact data in Dashboard.
   */
  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] publish-impact-tracker registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）')
    }
    const ipcMain = injectedIpcMain
    ipcMain.handle('impact:get-active', () => {
      try {
        // M-8 修复：统一为标准 { code, data, message } 格式
        return { code: 0, data: this.getActiveTrackings() }
      } catch (e) {
        log.error('ImpactTracker', 'getActive error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
      }
    })

    // Return recent impact snapshots for dashboard display
    ipcMain.handle('impact:get-recent-snapshots', () => {
      if (!this.ci || !this.ci._store || !this.ci._store._ready) return { code: 0, data: [] }
      try {
        const rows = this.ci._store.db.prepare(
          `SELECT * FROM impact_snapshots ORDER BY checked_at DESC LIMIT 20`
        ).all()
        return { code: 0, data: rows.map(r => ({
          ...r,
          keywords: r.keywords ? JSON.parse(r.keywords) : null,
        })) }
      } catch (e) {
        log.error('ImpactTracker', 'getRecentSnapshots error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
      }
    })
  }
}

module.exports = PublishImpactTracker
