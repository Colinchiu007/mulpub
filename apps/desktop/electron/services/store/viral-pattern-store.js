// @ts-check
/**
 * viral-pattern-store — 模式卡片功能域 mixin
 *
 * 表：viral_pattern_cards（与 viral_library 一对一）
 * 生命周期：pending（入库即建）→ done（LLM 提取成功）/ failed（attempts >= 3）
 * 依赖：logger
 */
const log = require('../logger')

const PATTERN_STATUS = new Set(['pending', 'done', 'failed', 'deferred'])
const HOOK_TYPES = new Set(['suspense', 'conflict', 'counterintuitive', 'question', 'story', 'data', 'empathy', 'other'])
const EMOTION_CURVES = new Set(['rise', 'fall', 'rise_fall', 'fall_rise', 'wave', 'flat'])
const NARRATIVE_STRUCTURES = new Set(['total_subtotal', 'problem_solution', 'chronological', 'contrast', 'list', 'story_lesson'])
const CTA_STYLES = new Set(['question', 'challenge', 'resource', 'follow', 'comment', 'none'])

// P1-c（viral-library-integration）：队列保护常量——实例属性可覆盖（测试/调参），方法内用 this.X ?? 常量
// pending 积压超上限 → 新卡片直标 deferred（非终态，不丢任务）；巡检时 pending 回落到回落线以下
// 将 deferred 批量转回 pending（老卡优先，单批受 max 限流）
const PENDING_BACKLOG_LIMIT = 500
const DEFERRED_PROMOTE_BELOW = 200
const DEFERRED_PROMOTE_MAX = 200

function parseCardRow (row) {
  if (!row) return null
  const copy = { ...row }
  try { copy.golden_quotes = JSON.parse(copy.golden_quotes || '[]') } catch { copy.golden_quotes = [] }
  return copy
}

module.exports = {
  PATTERN_STATUS, HOOK_TYPES, EMOTION_CURVES, NARRATIVE_STRUCTURES, CTA_STYLES,
  PENDING_BACKLOG_LIMIT, DEFERRED_PROMOTE_BELOW, DEFERRED_PROMOTE_MAX,

  /**
   * 确保卡片存在（入库后置钩子调用；幂等——已存在不重置状态）
   */
  ensurePatternCard (viralItemId) {
    if (!this._ready) return false
    if (!viralItemId) return false
    const now = new Date().toISOString()
    try {
      // P1-c：pending 积压达上限 → 新卡片直接标 deferred（延后而非丢弃，可见可回落）；
      // INSERT OR IGNORE 保持幂等——已存在不重置状态，同题重复入库天然复用原卡（P1-c 合并窗口）
      const limit = this.PENDING_BACKLOG_LIMIT ?? PENDING_BACKLOG_LIMIT
      const status = this.countPendingPatternCards() >= limit ? 'deferred' : 'pending'
      this.db.prepare(`
        INSERT OR IGNORE INTO viral_pattern_cards
          (viral_item_id, status, attempts, schema_version, created_at, updated_at)
        VALUES (?, ?, 0, 1, ?, ?)
      `).run(String(viralItemId), status, now, now)
      return true
    } catch (e) {
      log.warn('Store', 'ensurePatternCard failed: ' + e.message)
      return false
    }
  },

  getPatternCard (viralItemId) {
    if (!this._ready) return null
    try {
      const row = this.db.prepare('SELECT * FROM viral_pattern_cards WHERE viral_item_id = ?').get(String(viralItemId))
      return parseCardRow(row) || null
    } catch (e) {
      log.warn('Store', 'getPatternCard failed: ' + e.message)
      return null
    }
  },

  /**
   * 更新卡片字段（枚举校验：非法值落空/other；金句截断至 3 条）
   */
  updatePatternCard (viralItemId, updates) {
    if (!this._ready) return false
    if (!viralItemId || !updates || typeof updates !== 'object') return false
    const now = new Date().toISOString()
    const sets = []
    const params = []

    if (updates.status !== undefined) {
      const status = PATTERN_STATUS.has(String(updates.status)) ? String(updates.status) : 'pending'
      sets.push('status = ?')
      params.push(status)
    }
    if (updates.attempts !== undefined) {
      sets.push('attempts = ?')
      params.push(Math.max(0, Number(updates.attempts) || 0))
    }
    if (updates.hook_type !== undefined) {
      const v = String(updates.hook_type || '')
      sets.push('hook_type = ?')
      params.push(HOOK_TYPES.has(v) ? v : (v ? 'other' : ''))
    }
    if (updates.hook_analysis !== undefined) {
      sets.push('hook_analysis = ?')
      params.push(String(updates.hook_analysis || '').slice(0, 2000))
    }
    if (updates.emotion_curve !== undefined) {
      const v = String(updates.emotion_curve || '')
      sets.push('emotion_curve = ?')
      params.push(EMOTION_CURVES.has(v) ? v : '')
    }
    if (updates.narrative_structure !== undefined) {
      const v = String(updates.narrative_structure || '')
      sets.push('narrative_structure = ?')
      params.push(NARRATIVE_STRUCTURES.has(v) ? v : '')
    }
    if (updates.cta_style !== undefined) {
      const v = String(updates.cta_style || '')
      sets.push('cta_style = ?')
      params.push(CTA_STYLES.has(v) ? v : '')
    }
    if (updates.golden_quotes !== undefined) {
      let quotes = updates.golden_quotes
      if (typeof quotes === 'string') {
        try { quotes = JSON.parse(quotes) } catch { quotes = [] }
      }
      if (!Array.isArray(quotes)) quotes = []
      quotes = quotes.filter(q => typeof q === 'string' && q.trim()).slice(0, 3)
      sets.push('golden_quotes = ?')
      params.push(JSON.stringify(quotes))
    }
    if (updates.title_formula !== undefined) {
      sets.push('title_formula = ?')
      params.push(String(updates.title_formula || '').slice(0, 500))
    }
    if (updates.extracted_at !== undefined) {
      sets.push('extracted_at = ?')
      params.push(String(updates.extracted_at || ''))
    }
    if (updates.last_error !== undefined) {
      sets.push('last_error = ?')
      params.push(String(updates.last_error || '').slice(0, 1000))
    }

    if (sets.length === 0) return false
    sets.push('updated_at = ?')
    params.push(now)
    params.push(String(viralItemId))

    try {
      const result = this.db.prepare(
        'UPDATE viral_pattern_cards SET ' + sets.join(', ') + ' WHERE viral_item_id = ?'
      ).run(...params)
      return (result.changes || 0) > 0
    } catch (e) {
      log.warn('Store', 'updatePatternCard failed: ' + e.message)
      return false
    }
  },

  /**
   * 记录一次提取尝试（attempts +1，写错误信息；attempts >= 3 时标记 failed 终态）
   * failed 终态不自动重试——重试仅经 resetPatternCard（UI「重新分析」）触发
   */
  recordPatternAttempt (viralItemId, errorMessage) {
    if (!this._ready) return false
    const card = this.getPatternCard(viralItemId)
    if (!card) return false
    const attempts = (Number(card.attempts) || 0) + 1
    return this.updatePatternCard(viralItemId, {
      attempts,
      status: attempts >= 3 ? 'failed' : card.status === 'done' ? 'done' : 'pending',
      last_error: errorMessage || '',
    })
  },

  /**
   * 待提取队列：仅 pending（failed 为终态，重试走 resetPatternCard）
   */
  listPendingPatternCards (limit = 20) {
    if (!this._ready) return []
    try {
      return this.db.prepare(`
        SELECT * FROM viral_pattern_cards
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?
      `).all(Math.max(1, Math.min(100, Number(limit) || 20))).map(parseCardRow)
    } catch (e) {
      log.warn('Store', 'listPendingPatternCards failed: ' + e.message)
      return []
    }
  },

  listPatternCards (opts = {}) {
    if (!this._ready) return { items: [], total: 0 }
    const page = Math.max(1, Number(opts.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20))
    const conditions = []
    const params = []
    if (opts.status && PATTERN_STATUS.has(String(opts.status))) {
      conditions.push('status = ?')
      params.push(String(opts.status))
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    try {
      const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM viral_pattern_cards ' + where).get(...params)
      const total = countRow ? Number(countRow.n) || 0 : 0
      const rows = this.db.prepare(
        'SELECT * FROM viral_pattern_cards ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(...params, pageSize, (page - 1) * pageSize)
      return { items: rows.map(parseCardRow), total }
    } catch (e) {
      log.warn('Store', 'listPatternCards failed: ' + e.message)
      return { items: [], total: 0 }
    }
  },

  /**
   * pending 计数（P1-c 入队积压判定 + 页头提示条数据源；fail-open 返 0 不阻塞入库）
   */
  countPendingPatternCards () {
    if (!this._ready) return 0
    try {
      const row = this.db.prepare("SELECT COUNT(*) AS n FROM viral_pattern_cards WHERE status = 'pending'").get()
      return row ? Number(row.n) || 0 : 0
    } catch (e) {
      log.warn('Store', 'countPendingPatternCards failed: ' + e.message)
      return 0
    }
  },

  /**
   * deferred 计数（爆款库页头提示条「{n} 条延后处理」数据源）
   */
  countDeferredPatternCards () {
    if (!this._ready) return 0
    try {
      const row = this.db.prepare("SELECT COUNT(*) AS n FROM viral_pattern_cards WHERE status = 'deferred'").get()
      return row ? Number(row.n) || 0 : 0
    } catch (e) {
      log.warn('Store', 'countDeferredPatternCards failed: ' + e.message)
      return 0
    }
  },

  /**
   * deferred → pending 批量回落（P1-c 巡检调用）：仅当当前 pending < below 才迁移，
   * 且迁移后 pending 不越过 below（old-first：created_at ASC），单批受 max 限流。
   * @returns {number} 实际迁移条数
   */
  promoteDeferredPatternCards (opts = {}) {
    if (!this._ready) return 0
    const below = Number(opts.below ?? this.DEFERRED_PROMOTE_BELOW ?? DEFERRED_PROMOTE_BELOW)
    const max = Number(opts.max ?? this.DEFERRED_PROMOTE_MAX ?? DEFERRED_PROMOTE_MAX)
    try {
      const pending = this.countPendingPatternCards()
      if (pending >= below || max <= 0) return 0
      const quota = Math.min(max, below - pending)
      const ids = this.db.prepare(
        "SELECT viral_item_id FROM viral_pattern_cards WHERE status = 'deferred' ORDER BY created_at ASC LIMIT " + quota
      ).all().map((r) => String(r.viral_item_id))
      // LIMIT 拼接纯数字（quota 经 Math.min/Number 收敛），规避 sql.js 对 LIMIT 占位符的方言差异
      const now = new Date().toISOString()
      let promoted = 0
      for (const id of ids) {
        const r = this.db.prepare(
          "UPDATE viral_pattern_cards SET status = 'pending', updated_at = ? WHERE viral_item_id = ? AND status = 'deferred'"
        ).run(now, id)
        promoted += (r.changes || 0)
      }
      return promoted
    } catch (e) {
      log.warn('Store', 'promoteDeferredPatternCards failed: ' + e.message)
      return 0
    }
  },
  /**
   * 重置卡片为 pending（重新分析按钮）
   */
  resetPatternCard (viralItemId) {
    return this.updatePatternCard(viralItemId, {
      status: 'pending',
      attempts: 0,
      last_error: '',
    })
  },

  /**
   * 队列状态汇总（F-204 页头提示条数据源）：一次返回 pending/deferred 计数。
   * fail-open：未就绪/异常均回 0/0，绝不阻塞知识库页渲染。
   */
  patternQueueStats () {
    return Promise.all([
      Promise.resolve(this.countPendingPatternCards()),
      Promise.resolve(this.countDeferredPatternCards()),
    ]).then(function (r) { return { pending: r[0], deferred: r[1] } })
      .catch(function () { return { pending: 0, deferred: 0 } })
  },

  deletePatternCard (viralItemId) {
    if (!this._ready) return false
    try {
      const result = this.db.prepare('DELETE FROM viral_pattern_cards WHERE viral_item_id = ?').run(String(viralItemId))
      return (result.changes || 0) > 0
    } catch (e) {
      log.warn('Store', 'deletePatternCard failed: ' + e.message)
      return false
    }
  },
}
