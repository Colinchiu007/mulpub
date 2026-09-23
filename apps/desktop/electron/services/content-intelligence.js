// @ts-check
/**
 * Content Intelligence — 跨平台内容情报引擎
 *
 * 基于 last30days 架构精简实现，提供面向发布者的社交情报功能。
 *
 * 功能：
 *   1. search(query)       — 跨平台搜索主题讨论
 *   2. searchTitles(title) — 标题优化（搜索同类标题互动数据）
 *   3. searchMentions(keywords) — 发布后提及追踪
 *
 * 数据源（免费，无需 API Key）：
 *   - Reddit: 公开 JSON API
 *   - Hacker News: Algolia API
 *   - GitHub: Issues/Releases API（60 req/h 未认证足够 MVP）
 *
 * 架构重构（2026-07-16）：按职责拆分为 2 个 mixin，通过 Object.assign 注入 prototype。
 *   - content-intelligence-sources.js   — 数据源 fetch 逻辑（_engagementScore / _search* / _fetch*Trending）
 *   - content-intelligence-analysis.js  — 分析逻辑（_extractPatterns / _extractKeywords / suggestTags / findReferences / getBenchmark / getOptimalTime）
 *
 * 主文件保留核心方法：constructor / _getAxios / _getCached / _setCache / search / searchTitles /
 * searchMentions / fetchTrending / saveImpactSnapshot / getImpactHistory / registerIpcHandlers
 *
 * 与 rpa-view-manager.js 和 store/index.js 的 mixin 模式一致，保证 require('./content-intelligence') 接口不变。
 */
// eslint-disable-next-line no-unused-vars
const { calculateStats, deduplicateResults, calculateHourDistribution } = require('./content-intelligence-utils')
const log = require('./logger')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')

const sourcesMixin = require('./content-intelligence-sources')
const analysisMixin = require('./content-intelligence-analysis')

class ContentIntelligence {
  constructor (store) {
    this._axios = null
    this._searchCache = new Map()   // cacheKey -> { results, timestamp }
    this._cacheTTL = 5 * 60 * 1000  // 5 minutes
    this._store = store             // Store instance for impact tracking persistence
  }

  /**
   * 注入 AIGenerator 实例（智能标签建议 LLM 生成使用）。
   * 延迟注入避免与 AIGenerator 循环依赖。
   * @param {object} aiGenerator
   */
  setAIGenerator (aiGenerator) {
    this._aiGenerator = aiGenerator
  }

  _getAxios () {
    if (!this._axios) {
      this._axios = require('axios')
    }
    return this._axios
  }

  // ── Cache ───────────────────────────────────────────────────────

  _getCached (key) {
    const entry = this._searchCache.get(key)
    if (entry && Date.now() - entry.timestamp < this._cacheTTL) {
      return entry.results
    }
    return null
  }

  _setCache (key, results) {
    // Limit cache size
    if (this._searchCache.size > 50) {
      const oldest = this._searchCache.keys().next().value
      this._searchCache.delete(oldest)
    }
    this._searchCache.set(key, { results, timestamp: Date.now() })
  }

  // ── Main search ──────────────────────────────────────────────────

  /**
   * Search across all sources for a topic query.
   * @param {string} query — Search keywords
   * @param {object} [opts]
   * @param {string[]} [opts.sources] — ['reddit','hackernews','github'] or subset
   * @param {number} [opts.limit=10] — Results per source
   * @param {boolean} [opts.noCache=false] — Skip cache
   * @returns {Promise<object>} { results, sources, total }
   */
  async search (query, opts = {}) {
    const sources = opts.sources || ['reddit', 'hackernews', 'github']
    const limit = opts.limit || 10
    const cacheKey = `search:${query}:${sources.join(',')}:${limit}`

    if (!opts.noCache) {
      const cached = this._getCached(cacheKey)
      if (cached) return cached
    }

    const tasks = []
    if (sources.includes('reddit')) tasks.push(this._searchReddit(query, limit))
    if (sources.includes('hackernews')) tasks.push(this._searchHN(query, limit))
    if (sources.includes('github')) tasks.push(this._searchGitHub(query, limit))

    const results = (await Promise.allSettled(tasks))
      .flatMap(r => r.status === 'fulfilled' ? r.value : [])

    // Sort by engagement
    results.sort((a, b) => b.engagement - a.engagement)

    // Dedup by title (fuzzy same-title detection)
    const seen = new Set()
    const deduped = []
    for (const r of results) {
      const key = r.title.slice(0, 40).toLowerCase().trim()
      if (!seen.has(key)) {
        seen.add(key)
        deduped.push(r)
      }
    }

    const output = {
      query,
      sources: sources.filter(s => {
        if (s === 'reddit') return sources.includes('reddit')
        if (s === 'hackernews') return sources.includes('hackernews')
        if (s === 'github') return sources.includes('github')
        return true
      }),
      total: deduped.length,
      results: deduped.slice(0, limit * 2),
      timestamp: new Date().toISOString(),
    }

    this._setCache(cacheKey, output)
    return output
  }

  // ── Title assistant: search for similar titles ───────────────────
  //
  // Takes the draft title and searches for similar content.
  // Returns engagement data for similar titles to guide optimization.

  async searchTitles (title, opts = {}) {
    // Use the title itself as the query
    const result = await this.search(title, { ...opts, limit: 6 })

    // Extract key patterns
    const patterns = this._extractPatterns(result.results)

    return {
      ...result,
      titleAnalysis: {
        patterns,
        suggestion: this._generateTitleSuggestion(title, patterns),
      }
    }
  }

  // ── Mention tracking (post-publish impact) ────────────────────────
  //
  // Search for mentions of published content across platforms.

  async searchMentions (keywords, opts = {}) {
    // keywords can be: title + brand name + author name
    const result = await this.search(keywords, { ...opts, limit: 8 })

    // After T+24h, mark vs earlier results for trend direction
    return {
      ...result,
      analysis: {
        totalMentions: result.total,
        topSource: result.results[0]?.source || null,
        topEngagement: result.results[0]?.engagement || 0,
        sentiment: 'unknown',  // would need LLM for real sentiment
      }
    }
  }

  // ── Impact tracking persistence ──────────────────────────────────

  /**
   * Save an impact snapshot for a published article.
   * Called after publish, then at T+1h / T+24h / T+72h intervals.
   */
  async saveImpactSnapshot (articleId, title, keywords, snapshot) {
    if (!this._store || !this._store._ready) return false
    try {
      this._store.db.prepare(`
        INSERT INTO impact_snapshots (article_id, title, keywords, total_mentions, top_source, top_engagement, snapshot_data, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        articleId,
        title,
        JSON.stringify(keywords),
        snapshot.total || 0,
        snapshot.results?.[0]?.source || '',
        snapshot.results?.[0]?.engagement || 0,
        JSON.stringify(snapshot)
      )
      return true
    } catch (e) {
      log.error('ContentIntelligence', `saveImpactSnapshot error: ${e.message}`)
      return false
    }
  }

  /**
   * Get impact history for a published article.
   */
  getImpactHistory (articleId) {
    if (!this._store || !this._store._ready) return []
    try {
      return this._store.db.prepare(
        'SELECT * FROM impact_snapshots WHERE article_id = ? ORDER BY checked_at ASC'
      ).all(articleId)
    } catch (e) {
      log.error('ContentIntelligence', `getImpactHistory error: ${e.message}`)
      return []
    }
  }

  /**
   * Fetch trending content across sources — no keyword filter.
   * @param {object} [opts]
   * @param {string[]} [opts.sources] — Default all
   * @param {number} [opts.limit=10] — Per source
   * @returns {Promise<object>} Grouped by source + merged sorted
   */
  async fetchTrending (opts = {}) {
    const sources = opts.sources || ['reddit', 'hackernews', 'github']
    const limit = opts.limit || 10
    const cacheKey = `trending:${sources.join(',')}:${limit}`

    const cached = this._getCached(cacheKey)
    if (cached) return cached

    const tasks = []
    if (sources.includes('reddit')) tasks.push(this._fetchRedditTrending(limit))
    if (sources.includes('hackernews')) tasks.push(this._fetchHNTrending(limit))
    if (sources.includes('github')) tasks.push(this._fetchGitHubTrending(limit))

    const allResults = (await Promise.allSettled(tasks))
      .flatMap(r => r.status === 'fulfilled' ? r.value : [])

    allResults.sort((a, b) => b.engagement - a.engagement)

    const seen = new Set()
    const deduped = []
    for (const r of allResults) {
      const key = r.title.slice(0, 40).toLowerCase().trim()
      if (!seen.has(key)) { seen.add(key); deduped.push(r) }
    }

    // Group by source for the frontend panel
    const bySource = {}
    for (const r of deduped) {
      if (!bySource[r.source]) bySource[r.source] = []
      bySource[r.source].push(r)
    }

    const output = {
      total: deduped.length,
      results: deduped.slice(0, limit * 3),
      bySource,
      timestamp: new Date().toISOString(),
    }

    this._setCache(cacheKey, output)
    return output
  }

  // ── IPC Handlers ─────────────────────────────────────────────────

  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] content-intelligence registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）');
    }
    const ipcMain = injectedIpcMain;
    // R52 修复：所有 handler 统一为 { code, data, message } 格式
    // Search for topic intelligence (方案 A)
    ipcMain.handle('intelligence:search', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { query, opts } = arg
      try {
        return { code: 0, data: await this.search(query, opts || {}) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: { results: [], total: 0 } }
      }
    })

    // Title assistant search (方案 B)
    ipcMain.handle('intelligence:search-titles', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { title, opts } = arg
      try {
        return { code: 0, data: await this.searchTitles(title, opts || {}) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: { results: [], total: 0 } }
      }
    })

    // Impact tracking — save snapshot (方案 C)
    ipcMain.handle('intelligence:save-impact', withSenderCheck(async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { articleId, title, keywords, snapshot } = arg
      try {
        const ok = await this.saveImpactSnapshot(articleId, title, keywords, snapshot)
        return { code: 0, data: ok }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: false }
      }
    }))

    // Impact tracking — get history (方案 C)
    ipcMain.handle('intelligence:get-impact', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { articleId } = arg
      try {
        return { code: 0, data: this.getImpactHistory(articleId) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
      }
    })

    // Impact tracking — search mentions (方案 C)
    ipcMain.handle('intelligence:search-mentions', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { keywords, opts } = arg
      try {
        return { code: 0, data: await this.searchMentions(keywords, opts || {}) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: { results: [], total: 0 } }
      }
    })
    // ── Trending Discovery ────────────────────────────────────────
    ipcMain.handle('intelligence:fetch-trending', async (event, opts) => {
      try {
        return { code: 0, data: await this.fetchTrending(opts || {}) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: { results: [], total: 0 } }
      }
    })

    // ── Smart Tag Suggestion ─────────────────────────────────────
    ipcMain.handle('intelligence:suggest-tags', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { content, opts } = arg
      try {
        return { code: 0, data: await this.suggestTags(content, opts || {}) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: { keywords: [], byPlatform: {} } }
      }
    })

    // ── Reference Finder ─────────────────────────────────────────
    ipcMain.handle('intelligence:find-references', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { text, opts } = arg
      try {
        return { code: 0, data: await this.findReferences(text, opts || {}) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: { references: [], total: 0 } }
      }
    })

    // ── Benchmark ────────────────────────────────────────────────
    ipcMain.handle('intelligence:get-benchmark', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { title, opts } = arg
      try {
        return { code: 0, data: await this.getBenchmark(title, opts || {}) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: null }
      }
    })

    // ── Optimal Time ─────────────────────────────────────────────
    ipcMain.handle('intelligence:get-optimal-time', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { keyword } = arg
      try {
        return { code: 0, data: await this.getOptimalTime(keyword) }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: null }
      }
    })

  }
}

// 把 2 个 mixin 方法注入 ContentIntelligence.prototype
Object.assign(ContentIntelligence.prototype, sourcesMixin, analysisMixin)

module.exports = ContentIntelligence
