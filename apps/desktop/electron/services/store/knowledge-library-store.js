// @ts-check
/**
 * knowledge-library-store — 知识库功能域 mixin（爆款库 + 个人知识库）
 *
 * 表：viral_library / personal_knowledge
 * 存储：sql.js（WASM SQLite），无 FTS5 —— 搜索使用 LIKE 匹配。
 * 依赖：logger
 */
const log = require('../logger')
const { extractSync } = require('@multi-publish/rewrite-engine')

const VIRAL_SORT_COLUMNS = new Set([
  'created_at', 'likes', 'collections', 'comments', 'like_collect_ratio', 'published_at',
])

function normalizeViralItem (item) {
  if (!item || typeof item !== 'object') return null
  if (typeof item.content !== 'string' || !item.content.trim()) return null
  const likes = Math.max(0, Number(item.likes) || 0)
  const collections = Math.max(0, Number(item.collections) || 0)
  const comments = Math.max(0, Number(item.comments) || 0)
  const ratio = Math.round((likes / Math.max(collections, 1)) * 100) / 100
  let tags = []
  if (Array.isArray(item.tags)) tags = item.tags
  else if (typeof item.tags === 'string' && item.tags.trim()) {
    try { tags = JSON.parse(item.tags) } catch { tags = [item.tags] }
  }
  return {
    id: String(item.id || ''),
    title: String(item.title || '').slice(0, 500),
    cover_url: String(item.cover_url || '').slice(0, 2048),
    author: String(item.author || '').slice(0, 100),
    url: String(item.url || '').slice(0, 2048),
    content: item.content,
    tags: JSON.stringify(tags.filter(t => typeof t === 'string' && t.trim()).slice(0, 50)),
    likes,
    collections,
    comments,
    like_collect_ratio: ratio,
    published_at: String(item.published_at || ''),
    platform: String(item.platform || '').slice(0, 50),
    // 枚举：collection（采集）/ analysis（爆款分析报告落库，P1 来源标记）/ manual（人工新增）
    source: item.source === 'collection' ? 'collection' : item.source === 'analysis' ? 'analysis' : 'manual',
  }
}

function normalizePersonalItem (item) {
  if (!item || typeof item !== 'object') return null
  if (typeof item.content !== 'string' || !item.content.trim()) return null
  return {
    id: String(item.id || ''),
    category: String(item.category || ''),
    title: String(item.title || '').slice(0, 500),
    content: item.content,
    source_file: String(item.source_file || '').slice(0, 1024),
    file_type: String(item.file_type || '').slice(0, 20),
  }
}

function parseViralRow (row) {
  if (!row) return row
  const copy = { ...row }
  try { copy.tags = JSON.parse(copy.tags || '[]') } catch { copy.tags = [] }
  return copy
}

module.exports = {
  // ===================== 爆款库 =====================

  addViralItem (item) {
    if (!this._ready) return null
    const row = normalizeViralItem(item)
    if (!row || !row.id) return null
    const now = new Date().toISOString()
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO viral_library
          (id, title, cover_url, author, url, content, tags, likes, collections, comments,
           like_collect_ratio, published_at, platform, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id, row.title, row.cover_url, row.author, row.url, row.content, row.tags,
        row.likes, row.collections, row.comments, row.like_collect_ratio,
        row.published_at, row.platform, row.source, now, now,
      )
      return row.id
    } catch (e) {
      log.warn('Store', 'addViralItem failed: ' + e.message)
      return null
    }
  },

  getViralItem (id) {
    if (!this._ready) return null
    try {
      const row = this.db.prepare('SELECT * FROM viral_library WHERE id = ?').get(String(id))
      return parseViralRow(row) || null
    } catch (e) {
      log.warn('Store', 'getViralItem failed: ' + e.message)
      return null
    }
  },

  listViralItems (opts = {}) {
    if (!this._ready) return { items: [], total: 0 }
    const page = Math.max(1, Number(opts.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20))
    const conditions = []
    const params = []

    if (opts.search && String(opts.search).trim()) {
      const kw = '%' + String(opts.search).trim().replace(/[%_]/g, '') + '%'
      conditions.push('(title LIKE ? OR content LIKE ? OR tags LIKE ? OR author LIKE ? OR platform LIKE ?)')
      params.push(kw, kw, kw, kw, kw)
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    let orderBy = 'created_at DESC'
    if (opts.sortBy && VIRAL_SORT_COLUMNS.has(opts.sortBy)) {
      orderBy = opts.sortBy + ' ' + (String(opts.sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC') + ', created_at DESC'
    }

    try {
      const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM viral_library ' + where).get(...params)
      const total = countRow ? Number(countRow.n) || 0 : 0
      const rows = this.db.prepare(
        'SELECT * FROM viral_library ' + where + ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?'
      ).all(...params, pageSize, (page - 1) * pageSize)
      if (opts.search && rows.length > 0) {
        const ids = rows.map(function(r) { return r.id })
        this._touchAuditLog('viral_library', ids)
        for (var i = 0; i < rows.length; i++) this._touchKnowledge('viral_library', rows[i].id)
      }
      return { items: rows.map(parseViralRow), total }
    } catch (e) {
      log.warn('Store', 'listViralItems failed: ' + e.message)
      return { items: [], total: 0 }
    }
  },

  updateViralItem (id, updates) {
    if (!this._ready) return false
    const existing = this.getViralItem(id)
    if (!existing) return false
    const merged = { ...existing, ...updates, tags: updates.tags !== undefined ? updates.tags : existing.tags }
    const row = normalizeViralItem(merged)
    if (!row) return false
    const now = new Date().toISOString()
    try {
      const result = this.db.prepare(`
        UPDATE viral_library SET title = ?, cover_url = ?, author = ?, url = ?, content = ?, tags = ?,
          likes = ?, collections = ?, comments = ?, like_collect_ratio = ?, published_at = ?, platform = ?,
          source = ?, updated_at = ?
        WHERE id = ?
      `).run(
        row.title, row.cover_url, row.author, row.url, row.content, row.tags,
        row.likes, row.collections, row.comments, row.like_collect_ratio,
        row.published_at, row.platform, row.source, now, String(id),
      )
      return (result.changes || 0) > 0
    } catch (e) {
      log.warn('Store', 'updateViralItem failed: ' + e.message)
      return false
    }
  },

  deleteViralItem (id) {
    if (!this._ready) return false
    try {
      const result = this.db.prepare('DELETE FROM viral_library WHERE id = ?').run(String(id))
      // 级联清理模式卡片（viral_pattern-store mixin 混入同一 prototype 时生效）
      if ((result.changes || 0) > 0 && typeof this.deletePatternCard === 'function') {
        try { this.deletePatternCard(id) } catch (e) { /* 卡片清理失败不阻塞主删除 */ }
      }
      return (result.changes || 0) > 0
    } catch (e) {
      log.warn('Store', 'deleteViralItem failed: ' + e.message)
      return false
    }
  },

  searchViralItems (query, limit = 20) {
    if (!this._ready) return []
    if (!query || !String(query).trim()) return []
    // 关键词化检索：接受关键词数组（builder 已提取，直传避免二次分词稀释 LLM 兜底结果）
    // 或字符串（IPC 等独立入口，内部提取——修复整文 LIKE 永远空结果的缺陷）
    const keywords = Array.isArray(query)
      ? query.filter(k => typeof k === 'string' && k.trim()).slice(0, 20)
      : extractSync(String(query), 8)
    if (keywords.length === 0) return []
    const maxLimit = Math.max(1, Math.min(100, Number(limit) || 20))
    try {
      // 每个关键词生成 OR 命中组，候选集上限 100
      const conditions = []
      const params = []
      for (const kw of keywords) {
        const like = '%' + kw.replace(/[%_]/g, '') + '%'
        conditions.push('(title LIKE ? OR content LIKE ? OR tags LIKE ? OR author LIKE ? OR platform LIKE ?)')
        params.push(like, like, like, like, like)
      }
      // ORDER BY 保证候选集确定性（无序时 SQLite B-tree 遍历顺序不稳定）
      const rows = this.db.prepare(
        'SELECT * FROM viral_library WHERE ' + conditions.join(' OR ') + ' ORDER BY (likes + collections + comments) DESC, created_at DESC LIMIT 100'
      ).all(...params)
      if (rows.length === 0) return []

      // JS 侧评分：关键词命中数 × 10 + log10(1 + 互动数) + confidence × 5
      const scored = rows.map(row => {
        const text = ((row.title || '') + ' ' + (row.content || '') + ' ' + (row.tags || '') + ' ' + (row.author || '') + ' ' + (row.platform || '')).toLowerCase()
        let hits = 0
        for (const kw of keywords) {
          if (text.includes(kw.toLowerCase())) hits++
        }
        const engagement = Math.log10(1 + (Number(row.likes) || 0) + (Number(row.collections) || 0) + (Number(row.comments) || 0))
        const confidence = row.confidence === 0 ? 0 : (Number(row.confidence) || 0.5)
        return { row, score: hits * 10 + engagement + confidence * 5, hits }
      }).filter(s => s.hits > 0)

      scored.sort((a, b) => b.score - a.score)
      const top = scored.slice(0, maxLimit).map(s => s.row)

      if (top.length > 0) {
        const ids = top.map(function(r) { return r.id })
        this._touchAuditLog('viral_library', ids)
        for (var i = 0; i < top.length; i++) this._touchKnowledge('viral_library', top[i].id)
      }
      return top.map(parseViralRow)
    } catch (e) {
      log.warn('Store', 'searchViralItems failed: ' + e.message)
      return []
    }
  },

  countViralItems () {
    if (!this._ready) return 0
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM viral_library').get()
      return row ? Number(row.n) || 0 : 0
    } catch (e) { return 0 }
  },

  // ===================== 个人知识库 =====================

  addPersonalItem (item) {
    if (!this._ready) return null
    const row = normalizePersonalItem(item)
    if (!row || !row.id) return null
    const now = new Date().toISOString()
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO personal_knowledge
          (id, category, title, content, source_file, file_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, row.category, row.title, row.content, row.source_file, row.file_type, now, now)
      return row.id
    } catch (e) {
      log.warn('Store', 'addPersonalItem failed: ' + e.message)
      return null
    }
  },

  getPersonalItem (id) {
    if (!this._ready) return null
    try {
      const row = this.db.prepare('SELECT * FROM personal_knowledge WHERE id = ?').get(String(id))
      return row || null
    } catch (e) {
      log.warn('Store', 'getPersonalItem failed: ' + e.message)
      return null
    }
  },

  listPersonalItems (opts = {}) {
    if (!this._ready) return { items: [], total: 0 }
    const page = Math.max(1, Number(opts.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 20))
    const conditions = []
    const params = []

    if (opts.category && String(opts.category).trim()) {
      conditions.push('category = ?')
      params.push(String(opts.category))
    }
    if (opts.search && String(opts.search).trim()) {
      const kw = '%' + String(opts.search).trim().replace(/[%_]/g, '') + '%'
      conditions.push('(title LIKE ? OR content LIKE ?)')
      params.push(kw, kw)
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    try {
      const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM personal_knowledge ' + where).get(...params)
      const total = countRow ? Number(countRow.n) || 0 : 0
      const rows = this.db.prepare(
        'SELECT * FROM personal_knowledge ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(...params, pageSize, (page - 1) * pageSize)
      return { items: rows, total }
    } catch (e) {
      log.warn('Store', 'listPersonalItems failed: ' + e.message)
      return { items: [], total: 0 }
    }
  },

  updatePersonalItem (id, updates) {
    if (!this._ready) return false
    const existing = this.getPersonalItem(id)
    if (!existing) return false
    const row = normalizePersonalItem({ ...existing, ...updates })
    if (!row) return false
    const now = new Date().toISOString()
    try {
      const result = this.db.prepare(`
        UPDATE personal_knowledge SET category = ?, title = ?, content = ?, source_file = ?,
          file_type = ?, updated_at = ?
        WHERE id = ?
      `).run(row.category, row.title, row.content, row.source_file, row.file_type, now, String(id))
      return (result.changes || 0) > 0
    } catch (e) {
      log.warn('Store', 'updatePersonalItem failed: ' + e.message)
      return false
    }
  },

  deletePersonalItem (id) {
    if (!this._ready) return false
    try {
      const result = this.db.prepare('DELETE FROM personal_knowledge WHERE id = ?').run(String(id))
      return (result.changes || 0) > 0
    } catch (e) {
      log.warn('Store', 'deletePersonalItem failed: ' + e.message)
      return false
    }
  },

  searchPersonalItems (query, limit = 20) {
    if (!this._ready) return []
    if (!query || !String(query).trim()) return []
    // 关键词化检索（与爆款库同修；数组直传语义同上）
    const keywords = Array.isArray(query)
      ? query.filter(k => typeof k === 'string' && k.trim()).slice(0, 20)
      : extractSync(String(query), 8)
    if (keywords.length === 0) return []
    const maxLimit = Math.max(1, Math.min(100, Number(limit) || 20))
    try {
      const conditions = []
      const params = []
      for (const kw of keywords) {
        const like = '%' + kw.replace(/[%_]/g, '') + '%'
        conditions.push('(title LIKE ? OR content LIKE ? OR category LIKE ?)')
        params.push(like, like, like)
      }
      const rows = this.db.prepare(
        'SELECT * FROM personal_knowledge WHERE ' + conditions.join(' OR ') + ' ORDER BY created_at DESC LIMIT 100'
      ).all(...params)
      if (rows.length === 0) return []

      // 评分：关键词命中数 × 10 + confidence × 5（个人库无互动字段）
      const scored = rows.map(row => {
        const text = ((row.title || '') + ' ' + (row.content || '') + ' ' + (row.category || '')).toLowerCase()
        let hits = 0
        for (const kw of keywords) {
          if (text.includes(kw.toLowerCase())) hits++
        }
        const confidence = row.confidence === 0 ? 0 : (Number(row.confidence) || 0.5)
        return { row, score: hits * 10 + confidence * 5, hits }
      }).filter(s => s.hits > 0)

      scored.sort((a, b) => b.score - a.score)
      const top = scored.slice(0, maxLimit).map(s => s.row)

      if (top.length > 0) {
        const ids = top.map(function(r) { return r.id })
        this._touchAuditLog('personal_knowledge', ids)
        for (var i = 0; i < top.length; i++) this._touchKnowledge('personal_knowledge', top[i].id)
      }
      return top
    } catch (e) {
      log.warn('Store', 'searchPersonalItems failed: ' + e.message)
      return []
    }
  },

  countPersonalItems () {
    if (!this._ready) return 0
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM personal_knowledge').get()
      return row ? Number(row.n) || 0 : 0
    } catch (e) { return 0 }
  },

  // ===================== 进化语义：检索即强化 =====================

  _touchKnowledge (table, id) {
    if (!this._ready) return
    const now = new Date().toISOString()
    try {
      this.db.prepare(
        "UPDATE " + table + " SET access_count = access_count + 1, last_accessed = ?, confidence = MIN(0.99, (0.5 + 0.1 + MIN(access_count + 1, 10) * 0.02) * POWER(0.5, CAST((julianday(?) - julianday(COALESCE(last_accessed, created_at))) AS REAL) / 30)) WHERE id = ?"
      ).run(now, now, id)
    } catch (e) { /* 进化语义静默失败不减损功能 */ }
  },

  _touchAuditLog (table, ids) {
    if (!this._ready || !Array.isArray(ids) || ids.length === 0) return
    const now = new Date().toISOString()
    try {
      const stmt = this.db.prepare("INSERT INTO knowledge_audit_log (target_table, target_id, event, actor, created_at) VALUES (?, ?, 'access', 'rewrite_engine', ?)")
      for (const id of ids) {
        try { stmt.run(table, id, now) } catch (e) { /* skip dupes */ }
      }
    } catch (e) { /* ignore */ }
  },

}
