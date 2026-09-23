/**
 * Knowledge Base — 用户个人知识库 v2
 *
 * 本地存储用户偏好、风格指纹、历史成功案例、反馈日志、知识图谱与知识条目。
 * 隐私优先，所有数据存储在用户本地，不上传云端。
 *
 * v2 升级（参考 LLM-Wiki-V2 算法）：
 * - Ebbinghaus 遗忘曲线置信度 + 时间衰减
 * - RRF 混合搜索（关键词 + 标签/类别通道融合）
 * - 知识图谱（8 关系类型 + DFS 遍历）
 * - 矛盾检测（bigram Jaccard + 否定词扫描）
 * - 隐私过滤（正则替换为 ***）
 * - 生命周期管理（active → stale → deprecated → archived）
 * - 质量评分（结构 0.3 / 引用 0.4 / 可读性 0.3）
 *
 * 参考：Karpathy LLM Wiki 理论 + Colinchiu007/LLM-Wiki-V2
 */

const DEFAULT_KB = {
  version: 2,
  preferences: {
    industries: {},
    tones: {},
    platforms: {},
    preferredStrategies: []
  },
  styleFingerprint: {
    avgSentenceLength: 0,
    commonPhrases: [],
    openingPatterns: [],
    closingPatterns: [],
    emojiUsage: 'medium',
    punctuationStyle: 'balanced'
  },
  successfulRewrites: [],
  feedbackLog: [],
  entities: {},
  relations: [],
  knowledgeItems: []
}

// 隐私过滤正则表（参考 LLM-Wiki-V2 privacy_filter.py）
const PRIVACY_PATTERNS = [
  { type: 'api_key', pattern: /(sk-|pk-|pk_live_|pk_test_)[a-zA-Z0-9_\-]{20,}/g },
  { type: 'google_api_key', pattern: /AIzaSy[0-9A-Za-z_-]{33}/g },
  { type: 'openai_key', pattern: /OPENAI_API_KEY\s*[=:]\s*["']?[a-zA-Z0-9_\-]{20,}/g },
  { type: 'anthropic_key', pattern: /ANTHROPIC_API_KEY\s*[=:]\s*["']?[a-zA-Z0-9_\-]{20,}/g },
  { type: 'github_token', pattern: /gh[pousr]_[a-zA-Z0-9]{36}/g },
  { type: 'password', pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']?[^\s"'{}]{8,}/g },
  { type: 'phone_cn', pattern: /1[3-9]\d{9}/g },
  { type: 'id_card_cn', pattern: /[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g },
  { type: 'bank_card', pattern: /(?:62|4\d|5[1-5])\d{14,17}/g },
  { type: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g },
  { type: 'aws_key', pattern: /AKIA[0-9A-Z]{16}/g },
  { type: 'private_key', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g }
]

// 知识图谱 8 关系类型（参考 LLM-Wiki-V2 entities.py）
const RELATION_TYPES = [
  'uses',
  'depends_on',
  'causes',
  'contradicts',
  'supersedes',
  'related_to',
  'part_of',
  'implemented_by'
]

// 否定词表（参考 LLM-Wiki-V2 contradiction.py）
const NEGATION_WORDS = ['不', '非', '无', '未', '别', '反', '不是', '并非', '并非如此']

// 生命周期阈值（天数）
const fallbackLogger = require('./logger-fallback')

const LIFECYCLE = {
  STALE_DAYS: 90,
  DEPRECATED_DAYS: 180,
  ARCHIVE_MIN_ACCESS: 3
}

class KnowledgeBase {
  /**
   * @param {object} options
   * @param {object} options.storage - 持久化存储接口 { get(key), set(key, value) }
   * @param {object} [options.logger] - 日志出口 { info/warn/error/debug(tag, msg) }，缺省落 console
   */
  constructor(options = {}) {
    this._storage = options.storage
    this._logger = options.logger || fallbackLogger
    this._data = null
  }

  /**
   * 初始化知识库（从存储加载或创建默认）
   */
  init() {
    if (this._data) return
    const stored = this._storage ? this._storage.get('rewrite_engine_kb') : null
    if (stored) {
      try {
        this._data = JSON.parse(stored)
        this._migrate()
      } catch (err) {
        // 存量数据损坏 → 回退默认知识库是有意降级，但等价于「用户偏好静默清零」，
        // 属数据丢失级事件，必须留痕（审计 P2：有意降级但无线上留痕）。
        this._logger.warn('KnowledgeBase', '知识库存储数据不可解析，已回退默认值（用户既有偏好丢失）: ' + String((err && err.message) || err))
        this._data = JSON.parse(JSON.stringify(DEFAULT_KB))
      }
    } else {
      this._data = JSON.parse(JSON.stringify(DEFAULT_KB))
    }
  }

  /**
   * 获取用户偏好摘要（用于注入 Prompt 的 {knowledgeContext}）
   * 自动触发生命周期状态降级，并按置信度排序输出知识条目
   * @returns {string}
   */
  getContextSummary() {
    this.init()
    this._decayCheck()
    const p = this._data.preferences

    const parts = []

    // 行业偏好
    const topIndustries = this._topKeys(p.industries, 2)
    if (topIndustries.length > 0) {
      parts.push('用户主要关注领域：' + topIndustries.join('、'))
    }

    // 风格偏好
    const topTones = this._topKeys(p.tones, 2)
    if (topTones.length > 0) {
      parts.push('偏好语言风格：' + topTones.join('、'))
    }

    // 高频短语
    const fp = this._data.styleFingerprint
    if (fp.commonPhrases && fp.commonPhrases.length > 0) {
      parts.push('常用表达：' + fp.commonPhrases.slice(0, 5).join('、'))
    }

    // 开头/结尾模式
    if (fp.openingPatterns && fp.openingPatterns.length > 0) {
      parts.push('常用开头：' + fp.openingPatterns.slice(0, 3).join('、'))
    }

    // 按置信度排序的知识条目（遗忘曲线衰减）
    const topItems = this._data.knowledgeItems
      .slice()
      .sort((a, b) => this._retrievalPriority(b) - this._retrievalPriority(a))
      .slice(0, 5)
    if (topItems.length > 0) {
      const itemLines = topItems.map(item => {
        const conf = this._computeConfidence(item).toFixed(2)
        return '- ' + item.content + '（置信度 ' + conf + '）'
      })
      parts.push('用户知识要点：\n' + itemLines.join('\n'))
    }

    return parts.length > 0 ? '用户偏好参考：\n' + parts.join('\n') : ''
  }

  /**
   * 记录改写结果反馈（自动过滤隐私信息）
   * @param {object} feedback
   * @param {string} feedback.action - 'adopted' | 'modified' | 'rejected'
   * @param {string} feedback.strategyId
   * @param {string} feedback.originalContent
   * @param {string} feedback.resultContent
   * @param {number} feedback.editDistance - 用户修改比例 0-1
   */
  recordFeedback(feedback) {
    this.init()
    const entry = {
      timestamp: new Date().toISOString(),
      action: feedback.action || 'unknown',
      strategyId: feedback.strategyId || '',
      editDistance: feedback.editDistance || 0,
      notes: this._filterPrivacy(feedback.notes || '')
    }

    this._data.feedbackLog.push(entry)

    // 限制日志长度
    if (this._data.feedbackLog.length > 500) {
      this._data.feedbackLog = this._data.feedbackLog.slice(-500)
    }

    // 更新策略偏好
    if (feedback.strategyId) {
      this._updatePreference('preferredStrategies', feedback.strategyId, feedback.action === 'adopted' ? 1 : -0.5)
    }

    // 采纳时更新风格指纹（内部自动过滤隐私）
    if (feedback.action === 'adopted' && feedback.resultContent) {
      this._updateStyleFingerprint(feedback.resultContent)
    }

    // 更新行业/风格偏好
    if (feedback.userSettings) {
      if (feedback.userSettings.industry) {
        this._incrementPreference('industries', feedback.userSettings.industry)
      }
      if (feedback.userSettings.tone) {
        this._incrementPreference('tones', feedback.userSettings.tone)
      }
      if (feedback.userSettings.platform) {
        this._incrementPreference('platforms', feedback.userSettings.platform)
      }
    }

    this._persist()
  }

  /**
   * 获取策略的历史评分
   * @param {string} strategyId
   * @returns {number|null}
   */
  getStrategyRating(strategyId) {
    this.init()
    const logs = this._data.feedbackLog.filter(l => l.strategyId === strategyId)
    if (logs.length === 0) return null

    const scoreMap = { adopted: 5, modified: 3, rejected: 1 }
    const total = logs.reduce((sum, l) => sum + (scoreMap[l.action] || 0), 0)
    return Math.round(total / logs.length)
  }

  /**
   * 获取所有策略的评分映射
   * @returns {object}
   */
  getStrategyRatings() {
    this.init()
    const ratings = {}
    const strategyIds = new Set(this._data.feedbackLog.map(l => l.strategyId))
    for (const id of strategyIds) {
      const rating = this.getStrategyRating(id)
      if (rating !== null) ratings[id] = rating
    }
    return ratings
  }

  /**
   * 获取用户偏好数据（用于策略匹配）
   * @returns {object}
   */
  getUserHistory() {
    this.init()
    return {
      preferredStrategies: this._data.preferences.preferredStrategies || [],
      strategyRatings: this.getStrategyRatings()
    }
  }

  /**
   * RRF 混合搜索（关键词 + 标签/类别通道融合）
   * @param {string} query
   * @returns {Array<object>}
   */
  search(query) {
    this.init()
    this._decayCheck()
    const q = (query || '').trim().toLowerCase()
    if (!q) return []

    const tokens = this._tokenize(q)
    const keywordResults = this._keywordSearch(tokens)
    const tagResults = this._tagSearch(q)

    const fused = this._reciprocalRankFusion([keywordResults, tagResults], 60, 10)
    return fused
      .map(r => {
        const item = this._data.knowledgeItems.find(i => i.id === r.id)
        return {
          id: r.id,
          score: r.score,
          sources: r.sources,
          priority: item ? this._retrievalPriority(item) : 0,
          item: item || null
        }
      })
      .sort((a, b) => b.priority - a.priority)
  }

  /**
   * 添加实体到知识图谱
   * @param {string} id
   * @param {string} type - entity/topic/source/synthesis 等
   * @param {object} [properties]
   * @returns {object}
   */
  addEntity(id, type, properties) {
    this.init()
    const now = new Date().toISOString()
    if (!this._data.entities[id]) {
      this._data.entities[id] = { type, properties: properties || {}, createdAt: now, updatedAt: now }
    } else {
      this._data.entities[id].type = type || this._data.entities[id].type
      this._data.entities[id].properties = Object.assign({}, this._data.entities[id].properties, properties || {})
      this._data.entities[id].updatedAt = now
    }
    this._persist()
    return this._data.entities[id]
  }

  /**
   * 添加关系到知识图谱
   * @param {string} source
   * @param {string} target
   * @param {string} type - 8 种关系类型之一
   * @returns {boolean} 是否新增（已存在返回 false）
   */
  addRelation(source, target, type) {
    this.init()
    if (!RELATION_TYPES.includes(type)) {
      throw new Error('Invalid relation type: ' + type)
    }
    const exists = this._data.relations.some(
      r => r.source === source && r.target === target && r.type === type
    )
    if (exists) return false
    this._data.relations.push({ source, target, type, createdAt: new Date().toISOString() })
    this._persist()
    return true
  }

  /**
   * 知识图谱遍历（DFS，带深度限制与防环）
   * @param {string} entityId
   * @param {number} [depth]
   * @returns {Array<object>}
   */
  queryGraph(entityId, depth) {
    this.init()
    const results = []
    const visited = new Set()
    const maxDepth = Math.max(0, depth || 2)

    const dfs = (nodeId, d) => {
      if (d > maxDepth || visited.has(nodeId)) return
      visited.add(nodeId)
      for (const edge of this._data.relations) {
        if (edge.source === nodeId) {
          results.push({ source: edge.source, target: edge.target, type: edge.type, depth: d, reversed: false })
          dfs(edge.target, d + 1)
        } else if (edge.target === nodeId) {
          results.push({ source: edge.source, target: edge.target, type: edge.type, depth: d, reversed: true })
          dfs(edge.source, d + 1)
        }
      }
    }

    dfs(entityId, 0)
    return results
  }

  /**
   * 检测新条目与现有条目的矛盾（bigram Jaccard + 否定词）
   * @param {object} newItem - { id, content }
   * @returns {Array<object>} 冲突列表
   */
  detectContradictions(newItem) {
    this.init()
    const results = []
    const content = (newItem && newItem.content) || ''
    if (!content) return results

    for (const item of this._data.knowledgeItems) {
      if (item.id === newItem.id) continue
      const sim = this._textSimilarity(content, item.content || '')
      if (sim > 0.7) {
        const hasNeg1 = NEGATION_WORDS.some(w => content.includes(w))
        const hasNeg2 = NEGATION_WORDS.some(w => (item.content || '').includes(w))
        if (hasNeg1 !== hasNeg2) {
          results.push({
            type: 'negation_conflict',
            itemId: item.id,
            similarity: sim,
            warning: true
          })
        }
      }
    }
    return results
  }

  /**
   * 生命周期管理：将过期条目降级（active → stale → deprecated → archived）
   * @returns {object} 清理统计
   */
  consolidate() {
    this.init()
    let archived = 0
    let deprecated = 0
    let stale = 0

    for (const item of this._data.knowledgeItems) {
      const days = this._daysSince(item.lastAccessAt || item.createdAt)
      const current = item.status || 'active'
      let next = current

      if (days > LIFECYCLE.DEPRECATED_DAYS) {
        next = 'deprecated'
      } else if (days > LIFECYCLE.STALE_DAYS) {
        next = 'stale'
      }

      // 低频 + 久未访问 → archived（移出活跃检索）
      if (next === 'deprecated' && (item.accessCount || 0) < LIFECYCLE.ARCHIVE_MIN_ACCESS) {
        next = 'archived'
        archived++
      }

      if (next !== current) {
        item.status = next
        item.updatedAt = new Date().toISOString()
        if (next === 'deprecated') deprecated++
        if (next === 'stale') stale++
      }
    }

    this._persist()
    return { archived, deprecated, stale }
  }

  /**
   * 质量评分（结构 0.3 / 引用 0.4 / 可读性 0.3）
   * @param {object} item - { content, sources, tags }
   * @returns {object}
   */
  rateQuality(item) {
    const structure = this._checkStructure(item)
    const citation = this._checkCitation(item)
    const readability = this._checkReadability(item)
    const quality = structure * 0.3 + citation * 0.4 + readability * 0.3
    return {
      structure,
      citation,
      readability,
      quality,
      label: quality >= 0.7 ? 'good' : quality >= 0.4 ? 'needs_review' : 'low_quality'
    }
  }

  /**
   * 知识库统计
   * @returns {object}
   */
  getStats() {
    this.init()
    const statusCounts = {}
    for (const item of this._data.knowledgeItems) {
      const status = item.status || 'active'
      statusCounts[status] = (statusCounts[status] || 0) + 1
    }
    return {
      version: this._data.version,
      knowledgeItems: this._data.knowledgeItems.length,
      entities: Object.keys(this._data.entities).length,
      relations: this._data.relations.length,
      feedbackLog: this._data.feedbackLog.length,
      statusCounts
    }
  }

  // ===== 内部方法 =====

  _persist() {
    if (this._storage) {
      this._storage.set('rewrite_engine_kb', JSON.stringify(this._data))
    }
  }

  _migrate() {
    // v1 → v2：补齐新增字段
    if (this._data.version < 2) {
      this._data.version = 2
      if (!this._data.entities) this._data.entities = {}
      if (!this._data.relations) this._data.relations = []
      if (!this._data.knowledgeItems) this._data.knowledgeItems = []
    }
  }

  _topKeys(obj, n) {
    if (!obj) return []
    return Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k)
  }

  _incrementPreference(field, key) {
    if (!this._data.preferences[field]) {
      this._data.preferences[field] = {}
    }
    const current = this._data.preferences[field][key] || 0
    this._data.preferences[field][key] = Math.min(1, current + 0.1)
  }

  _updatePreference(field, key, delta) {
    if (!this._data.preferences[field]) {
      this._data.preferences[field] = []
    }
    const list = this._data.preferences[field]
    if (delta > 0 && !list.includes(key)) {
      list.unshift(key)
      if (list.length > 10) list.length = 10
    }
  }

  _updateStyleFingerprint(content) {
    const fp = this._data.styleFingerprint
    if (!fp) return
    // 隐私过滤
    const filtered = this._filterPrivacy(content || '')

    // 更新平均句长
    const sentences = filtered.split(/[。！？\.\!\?]+/).filter(Boolean)
    if (sentences.length > 0) {
      const avgLen = filtered.length / sentences.length
      fp.avgSentenceLength = fp.avgSentenceLength
        ? Math.round(fp.avgSentenceLength * 0.7 + avgLen * 0.3)
        : Math.round(avgLen)
    }

    // 提取开头/结尾模式（简单实现）
    if (sentences.length > 0) {
      const first = sentences[0].trim().slice(0, 20)
      if (first.length > 2 && !fp.openingPatterns.includes(first)) {
        fp.openingPatterns.unshift(first)
        if (fp.openingPatterns.length > 10) fp.openingPatterns.length = 10
      }
      const last = sentences[sentences.length - 1].trim().slice(0, 20)
      if (last.length > 2 && !fp.closingPatterns.includes(last)) {
        fp.closingPatterns.unshift(last)
        if (fp.closingPatterns.length > 10) fp.closingPatterns.length = 10
      }
    }

    // 检测 emoji 使用频率
    const emojiCount = (filtered.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu) || []).length
    fp.emojiUsage = emojiCount > filtered.length * 0.02 ? 'high' : emojiCount > 0 ? 'medium' : 'low'
  }

  // ===== 隐私过滤 =====

  /**
   * 过滤隐私信息，替换为 ***
   * @param {string} text
   * @returns {string}
   */
  _filterPrivacy(text) {
    if (!text) return text
    let result = String(text)
    for (const { pattern } of PRIVACY_PATTERNS) {
      result = result.replace(pattern, '***')
    }
    return result
  }

  // ===== 置信度 / 遗忘曲线 =====

  /**
   * 计算置信度（Ebbinghaus 遗忘曲线）
   * @param {object} item
   * @returns {number}
   */
  _computeConfidence(item) {
    const days = this._daysSince(item.lastAccessAt || item.createdAt)
    const sources = Array.isArray(item.sources) ? item.sources : []
    const base = 0.5
    const sourceBonus = Math.min(sources.length, 3) * 0.1
    const authorityBonus = (item.authority || 0.5) * 0.2
    const accessBonus = Math.min(item.accessCount || 0, 10) * 0.02
    const decay = Math.pow(0.5, days / 30)
    const confidence = (base + sourceBonus + authorityBonus + accessBonus) * decay
    return Math.min(confidence, 0.99)
  }

  /**
   * 计算检索优先级 = 置信度 × ln(1+访问次数)，按状态降级
   * @param {object} item
   * @returns {number}
   */
  _retrievalPriority(item) {
    let priority = this._computeConfidence(item) * Math.log1p(item.accessCount || 0)
    const status = item.status || 'active'
    if (status === 'stale') priority *= 0.5
    else if (status === 'deprecated') priority *= 0.1
    else if (status === 'archived') priority *= 0.01
    return priority
  }

  /**
   * 计算距今天数
   * @param {string} iso
   * @returns {number}
   */
  _daysSince(iso) {
    if (!iso) return 0
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return 0
    return Math.max(0, (Date.now() - then) / 86400000)
  }

  // ===== 生命周期 =====

  /**
   * 根据 lastAccessAt 计算生命周期状态
   * @param {object} item
   * @returns {string}
   */
  _checkLifecycle(item) {
    const days = this._daysSince(item.lastAccessAt || item.createdAt)
    if (days > LIFECYCLE.DEPRECATED_DAYS) return 'deprecated'
    if (days > LIFECYCLE.STALE_DAYS) return 'stale'
    return 'active'
  }

  /**
   * 自动触发状态降级检查
   */
  _decayCheck() {
    for (const item of this._data.knowledgeItems) {
      const status = this._checkLifecycle(item)
      if (status !== item.status) {
        item.status = status
        item.updatedAt = new Date().toISOString()
      }
    }
  }

  // ===== 搜索 =====

  /**
   * 简单分词（英文/数字 token + 中文字符）
   * @param {string} text
   * @returns {Array<string>}
   */
  _tokenize(text) {
    const normalized = (text || '').toLowerCase()
    const ascii = normalized.match(/[a-z0-9_]+/g) || []
    const cjk = normalized.match(/[\u4e00-\u9fa5]/g) || []
    return ascii.concat(cjk)
  }

  /**
   * 关键词匹配通道
   * @param {Array<string>} tokens
   * @returns {Array<object>}
   */
  _keywordSearch(tokens) {
    const results = []
    for (const item of this._data.knowledgeItems) {
      const content = (item.content || '').toLowerCase()
      let hits = 0
      for (const t of tokens) {
        if (t && content.includes(t)) hits++
      }
      if (hits > 0) {
        results.push({ id: item.id, source: 'keyword', score: hits })
      }
    }
    return results.sort((a, b) => b.score - a.score)
  }

  /**
   * 标签/类别匹配通道
   * @param {string} query
   * @returns {Array<object>}
   */
  _tagSearch(query) {
    const results = []
    const q = query.toLowerCase()
    for (const item of this._data.knowledgeItems) {
      const tags = (item.tags || []).map(t => String(t).toLowerCase())
      const category = String(item.category || '').toLowerCase()
      const matched = tags.some(t => t.includes(q) || q.includes(t)) ||
        (category && (category.includes(q) || q.includes(category)))
      if (matched) {
        results.push({ id: item.id, source: 'tag', score: 1 })
      }
    }
    return results
  }

  /**
   * RRF 融合（score = Σ 1/(k+rank)）
   * @param {Array<Array<object>>} resultSets
   * @param {number} k
   * @param {number} topK
   * @returns {Array<object>}
   */
  _reciprocalRankFusion(resultSets, k = 60, topK = 10) {
    const scores = new Map()
    for (const results of resultSets) {
      results.forEach((item, idx) => {
        const rank = idx + 1
        const id = item.id
        const rrfScore = 1.0 / (k + rank)
        if (!scores.has(id)) scores.set(id, { id, score: 0, sources: [] })
        const entry = scores.get(id)
        entry.score += rrfScore
        entry.sources.push({ engine: item.source, rank })
      })
    }
    return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, topK)
  }

  // ===== 矛盾检测 =====

  /**
   * 字符级 bigram Jaccard 相似度
   * @param {string} text1
   * @param {string} text2
   * @returns {number}
   */
  _textSimilarity(text1, text2) {
    const ngrams = (text, n = 2) => {
      const set = new Set()
      for (let i = 0; i <= text.length - n; i++) set.add(text.slice(i, i + n))
      return set
    }
    const ng1 = ngrams(text1)
    const ng2 = ngrams(text2)
    let inter = 0
    for (const g of ng1) if (ng2.has(g)) inter++
    const union = new Set([...ng1, ...ng2]).size
    return union === 0 ? 0 : inter / union
  }

  // ===== 质量评分 =====

  /**
   * 结构完整性评分（0-1）
   * @param {object} item
   * @returns {number}
   */
  _checkStructure(item) {
    const content = (item && item.content) || ''
    let score = 0
    if (/^#\s/m.test(content)) score += 0.3
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
    if (paragraphs.length >= 2) score += 0.3
    else if (paragraphs.length >= 1) score += 0.15
    if (/^[-*]\s/m.test(content)) score += 0.2
    if (/^>\s/m.test(content) || /```/.test(content)) score += 0.2
    return Math.min(score, 1.0)
  }

  /**
   * 引用覆盖率评分（0-1）
   * @param {object} item
   * @returns {number}
   */
  _checkCitation(item) {
    const sources = Array.isArray(item && item.sources) ? item.sources : []
    const content = (item && item.content) || ''
    const wikilinks = (content.match(/\[\[[^\]]+\]\]/g) || []).length
    if (sources.length >= 3) return 1.0
    if (sources.length >= 2) return 0.7
    if (sources.length >= 1) return 0.4
    if (wikilinks >= 3) return 0.5
    if (wikilinks >= 1) return 0.3
    return 0.1
  }

  /**
   * 可读性评分（0-1）
   * @param {object} item
   * @returns {number}
   */
  _checkReadability(item) {
    const content = (item && item.content) || ''
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
    if (paragraphs.length === 0) return 0.3
    const avgLen = content.length / paragraphs.length
    if (avgLen >= 100 && avgLen <= 300) return 0.9
    if (avgLen >= 50 && avgLen <= 500) return 0.6
    return 0.3
  }
}

// 内存存储（开发/测试用，生产环境替换为 SQLite）
class MemoryStorage {
  constructor() {
    this._store = new Map()
  }
  get(key) {
    return this._store.get(key) || null
  }
  set(key, value) {
    this._store.set(key, value)
  }
}

module.exports = { KnowledgeBase, MemoryStorage, DEFAULT_KB }
