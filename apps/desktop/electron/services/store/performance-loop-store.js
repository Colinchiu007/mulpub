// @ts-check
/**
 * performance-loop-store — 效果闭环功能域 mixin
 *
 * 表：rewrite_history / tracked_content / performance_snapshot / pattern_performance
 * 闭环：改写历史 → 发布关联（tracked_content）→ 指标回采（snapshot）→ 模式归因（pattern_performance）
 * 依赖：logger
 */
const log = require('../logger')

function _genId () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function _parseJson (str, fallback) {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}

const RECRAWL_STATUSES = new Set(['pending', 'ok', 'failed', 'unsupported', 'untrackable', 'manual'])

module.exports = {
  // ===================== 改写历史 =====================

  addRewriteHistory (entry) {
    if (!this._ready) return null
    if (!entry || typeof entry.rewrittenContent !== 'string' || !entry.rewrittenContent.trim()) return null
    const id = String(entry.id || '') || _genId()
    const now = new Date().toISOString()
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO rewrite_history
          (id, mode, original_excerpt, rewritten_content, strategy_id, knowledge_refs, matched_keywords, owner_subject, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        String(entry.mode || '').slice(0, 50),
        String(entry.originalContent || '').slice(0, 500),
        entry.rewrittenContent,
        String(entry.strategyId || '').slice(0, 100),
        JSON.stringify(Array.isArray(entry.knowledgeRefs) ? entry.knowledgeRefs : []),
        JSON.stringify(Array.isArray(entry.matchedKeywords) ? entry.matchedKeywords : []),
        entry.ownerSubject || null,
        now,
      )
      return id
    } catch (e) {
      log.warn('Store', 'addRewriteHistory failed: ' + e.message)
      return null
    }
  },

  getRewriteHistory (id) {
    if (!this._ready) return null
    try {
      const row = this.db.prepare('SELECT * FROM rewrite_history WHERE id = ?').get(String(id))
      if (!row) return null
      row.knowledge_refs = _parseJson(row.knowledge_refs, [])
      row.matched_keywords = _parseJson(row.matched_keywords, [])
      return row
    } catch (e) {
      log.warn('Store', 'getRewriteHistory failed: ' + e.message)
      return null
    }
  },

  listRewriteHistory (opts = {}) {
    if (!this._ready) return { items: [], total: 0 }
    const page = Math.max(1, Number(opts.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20))
    try {
      const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM rewrite_history').get()
      const total = countRow ? Number(countRow.n) || 0 : 0
      const rows = this.db.prepare('SELECT * FROM rewrite_history ORDER BY created_at DESC LIMIT ? OFFSET ?')
        .all(pageSize, (page - 1) * pageSize)
      return { items: rows.map(r => ({ ...r, knowledge_refs: _parseJson(r.knowledge_refs, []), matched_keywords: _parseJson(r.matched_keywords, []) })), total }
    } catch (e) {
      log.warn('Store', 'listRewriteHistory failed: ' + e.message)
      return { items: [], total: 0 }
    }
  },

  // ===================== 追踪登记 =====================

  addTrackedContent (entry) {
    if (!this._ready) return null
    if (!entry || !entry.platform) return null
    const id = String(entry.id || '') || _genId()
    const status = RECRAWL_STATUSES.has(String(entry.recrawlStatus)) ? String(entry.recrawlStatus) : 'pending'
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO tracked_content
          (id, platform, post_id, url, publish_history_id, rewrite_history_id, recrawl_status, last_recrawl_at, next_recrawl_at, owner_subject, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        String(entry.platform).slice(0, 50),
        String(entry.postId || '').slice(0, 200),
        String(entry.url || '').slice(0, 2048),
        entry.publishHistoryId || null,
        entry.rewriteHistoryId || null,
        status,
        entry.lastRecrawlAt || null,
        entry.nextRecrawlAt || null,
        entry.ownerSubject || null,
        String(entry.createdAt || new Date().toISOString()),
      )
      return id
    } catch (e) {
      log.warn('Store', 'addTrackedContent failed: ' + e.message)
      return null
    }
  },

  /**
   * 待回采队列：next_recrawl_at 到期 + 7 天窗口内 + status ∈ (pending, ok, failed)
   * （failed = 单次失败待重试；连续 3 次失败由服务层转 manual 终态）
   * @param {number} nowMs - 当前时间戳
   */
  listDueForRecrawl (nowMs, opts) {
    opts = opts || {}
    if (!this._ready) return []
    const nowIso = new Date(nowMs).toISOString()
    const windowStartIso = new Date(nowMs - 7 * 24 * 3600 * 1000).toISOString()
    try {
      // force（立即回采调试入口）：忽略 next_recrawl_at 到期排期，纳入 7 天窗口内全部可回采条目；
      // 仍守 7 天窗口与状态过滤。默认路径维持 T+1h 排期语义不变。
      if (opts.force) {
        return this.db.prepare(`
          SELECT * FROM tracked_content
          WHERE recrawl_status IN ('pending', 'ok', 'failed')
            AND created_at >= ?
          ORDER BY next_recrawl_at ASC
          LIMIT 50
        `).all(windowStartIso)
      }
      return this.db.prepare(`
        SELECT * FROM tracked_content
        WHERE recrawl_status IN ('pending', 'ok', 'failed')
          AND next_recrawl_at IS NOT NULL AND next_recrawl_at <= ?
          AND created_at >= ?
        ORDER BY next_recrawl_at ASC
        LIMIT 50
      `).all(nowIso, windowStartIso)
    } catch (e) {
      log.warn('Store', 'listDueForRecrawl failed: ' + e.message)
      return []
    }
  },

  getTrackedByPlatform (platform) {
    if (!this._ready) return []
    try {
      return this.db.prepare('SELECT * FROM tracked_content WHERE platform = ? ORDER BY created_at DESC').all(String(platform))
    } catch (e) { return [] }
  },

  updateTrackedContent (id, updates) {
    if (!this._ready || !id || !updates) return false
    const sets = []
    const params = []
    if (updates.recrawlStatus !== undefined) {
      if (!RECRAWL_STATUSES.has(String(updates.recrawlStatus))) return false
      sets.push('recrawl_status = ?')
      params.push(String(updates.recrawlStatus))
    }
    if (updates.lastRecrawlAt !== undefined) { sets.push('last_recrawl_at = ?'); params.push(updates.lastRecrawlAt || null) }
    if (updates.nextRecrawlAt !== undefined) { sets.push('next_recrawl_at = ?'); params.push(updates.nextRecrawlAt || null) }
    if (updates.rewriteHistoryId !== undefined) { sets.push('rewrite_history_id = ?'); params.push(updates.rewriteHistoryId || null) }
    if (sets.length === 0) return false
    params.push(String(id))
    try {
      const result = this.db.prepare('UPDATE tracked_content SET ' + sets.join(', ') + ' WHERE id = ?').run(...params)
      return (result.changes || 0) > 0
    } catch (e) {
      log.warn('Store', 'updateTrackedContent failed: ' + e.message)
      return false
    }
  },

  // ===================== 表现快照 =====================

  addPerformanceSnapshot (entry) {
    if (!this._ready) return null
    if (!entry || !entry.trackedContentId) return null
    const id = _genId()
    try {
      this.db.prepare(`
        INSERT INTO performance_snapshot
          (id, tracked_content_id, source, views, likes, comments, favorites, shares, raw, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        String(entry.trackedContentId),
        entry.source === 'manual' ? 'manual' : 'auto',
        Math.max(0, Number(entry.views) || 0),
        Math.max(0, Number(entry.likes) || 0),
        Math.max(0, Number(entry.comments) || 0),
        Math.max(0, Number(entry.favorites) || 0),
        Math.max(0, Number(entry.shares) || 0),
        JSON.stringify(entry.raw || {}),
        new Date().toISOString(),
      )
      return id
    } catch (e) {
      log.warn('Store', 'addPerformanceSnapshot failed: ' + e.message)
      return null
    }
  },

  getLatestSnapshot (trackedContentId) {
    if (!this._ready) return null
    try {
      return this.db.prepare(
        'SELECT * FROM performance_snapshot WHERE tracked_content_id = ? ORDER BY captured_at DESC, rowid DESC LIMIT 1'
      ).get(String(trackedContentId)) || null
    } catch (e) { return null }
  },

  listSnapshots (trackedContentId) {
    if (!this._ready) return []
    try {
      return this.db.prepare(
        'SELECT * FROM performance_snapshot WHERE tracked_content_id = ? ORDER BY captured_at DESC, rowid DESC'
      ).all(String(trackedContentId))
    } catch (e) { return [] }
  },

  // ===================== 模式归因聚合 =====================

  /**
   * 全量替换模式归因（每日重算 + 手动触发；幂等）
   * @param {Array} rows - [{ dimension, value, platform, sampleCount, avgViews, avgLikes, avgComments, avgFavorites }]
   */
  replacePatternPerformance (rows) {
    if (!this._ready || !Array.isArray(rows)) return false
    const now = new Date().toISOString()
    try {
      // 事务包裹 delete+insert（审查 W-3：防中途崩溃留下半表）
      const tx = (typeof this.db.transaction === 'function')
        ? this.db.transaction(() => this._replacePatternPerformanceInner(rows, now))
        : () => this._replacePatternPerformanceInner(rows, now)
      tx()
      return true
    } catch (e) {
      log.warn('Store', 'replacePatternPerformance failed: ' + e.message)
      return false
    }
  },

  _replacePatternPerformanceInner (rows, now) {
    this.db.prepare('DELETE FROM pattern_performance').run()
    const stmt = this.db.prepare(`
      INSERT INTO pattern_performance
        (id, dimension, value, platform, sample_count, avg_views, avg_likes, avg_comments, avg_favorites, engagement_score, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const r of rows) {
      if (!r || !r.dimension || !r.value) continue
      const avgViews = Math.max(0, Number(r.avgViews) || 0)
      const avgLikes = Math.max(0, Number(r.avgLikes) || 0)
      const avgComments = Math.max(0, Number(r.avgComments) || 0)
      const avgFavorites = Math.max(0, Number(r.avgFavorites) || 0)
      // engagement_score = avg_likes + avg_comments + avg_favorites × 2（首版启发式，常量区可调）
      const score = avgLikes + avgComments + avgFavorites * 2
      stmt.run(_genId(), String(r.dimension), String(r.value), String(r.platform || ''), Math.max(0, Number(r.sampleCount) || 0), avgViews, avgLikes, avgComments, avgFavorites, score, now)
    }
  },

  listPatternPerformance (opts = {}) {
    if (!this._ready) return []
    const conditions = []
    const params = []
    if (opts.dimension) { conditions.push('dimension = ?'); params.push(String(opts.dimension)) }
    if (opts.platform) { conditions.push('platform = ?'); params.push(String(opts.platform)) }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    try {
      return this.db.prepare(
        'SELECT * FROM pattern_performance ' + where + ' ORDER BY engagement_score DESC'
      ).all(...params)
    } catch (e) { return [] }
  },
}
