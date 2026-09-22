// @ts-check
/**
 * HotTopicsService — 热门选题聚合服务（主进程）v2
 *
 * 职责：
 *   - 从 8 个公开渠道并发抓取热搜榜/热榜选题
 *   - 复用 collection-engine 防反爬组件（限流/熔断/缓存）
 *   - 分类（渠道原生 + 关键词打分多标签）→ 去重 → 缓存落 SQLite settings
 *
 * v2 变更（方案A/B/C/D，修复分类结构性稀疏）：
 *   A. MAX_PER_CHANNEL 20→50、MAX_TOPICS 160→400；条目携带多标签 categories[]
 *   B/D. 稀疏分类定向补拉：主聚合后某分类条目数低于 CATEGORY_BOOSTS[cat].threshold
 *       或 UI 显式 boostCategories 指定时，追加抓取该分类垂类榜单
 *       （百度财经tab / 新浪财经滚动 / IT之家RSS / 微博情感·健康垂类过滤），
 *       补拉条目直挂目标分类，id 含 board 段避免与主榜撞号。
 *   C. LLM 分类兜底：仍为 general 的条目批量交 deps.llmClassify 分类，
 *       结果落盘缓存（hot_topics_llm_labels，上限 500 条）；未配置/失败静默降级。
 *
 * IPC 通道（由 ipc-handlers/hot-topics.js 注册）：
 *   hot-topics:fetch      { force, boostCategories } → { code, data: { topics, fetchedAt, channelStats } }
 *   hot-topics:get-cache   {}       → { code, data: cache }
 */

const { classifyTopicMulti, CATEGORY_KEYS } = require('./hot-topics/classifier')
const { CHANNEL_PARSERS } = require('./hot-topics/channels')
const { scoreTopics, markTrend } = require('./hot-topics/scorer')

const CACHE_KEY = 'hot_topics_cache'
const LLM_LABELS_KEY = 'hot_topics_llm_labels'
const CACHE_TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 10 * 1000
const MAX_PER_CHANNEL = 50
const MAX_TOPICS = 400 // 8 渠道 × 50 条上限（去重后实际更少；含垂类补拉）
const LLM_BATCH_LIMIT = 40   // 单次抓取最多送 LLM 分类的 general 条目数（成本控制）
const LLM_LABELS_MAX = 500   // LLM 标签缓存条目上限（超限按插入序裁剪）
const RANK_CONFIG_KEY = 'hot_topics_rank_config' // P2 评分配置：{ channelWeights?, halfLifeMs? }（可选，缺省用内置默认）

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * 主渠道配置：端点、请求头、最小间隔（分钟）、风险级别。
 * intervalMinutes 由内存限流器使用（简单时间戳节流，避免高频抓取触发反爬）。
 */
const CHANNEL_CONFIGS = [
  { id: 'zhihu', name: '知乎', url: 'https://api.zhihu.com/topstory/hot-list?limit=50', headers: {}, intervalMinutes: 5, riskLevel: 'low' },
  { id: 'toutiao', name: '今日头条', url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', headers: {}, intervalMinutes: 5, riskLevel: 'medium' },
  { id: 'tencent', name: '腾讯新闻', url: 'https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=50', headers: {}, intervalMinutes: 10, riskLevel: 'medium' },
  { id: 'bilibili', name: '哔哩哔哩', url: 'https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1', headers: {}, intervalMinutes: 10, riskLevel: 'low' },
  { id: 'douyin', name: '抖音', url: 'https://www.douyin.com/aweme/v1/web/hot/search/list/', headers: { Referer: 'https://www.douyin.com/' }, intervalMinutes: 15, riskLevel: 'high' },
  { id: 'baidu', name: '百度热搜', url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime', headers: {}, intervalMinutes: 10, riskLevel: 'low' },
  { id: 'weibo', name: '微博热搜', url: 'https://weibo.com/ajax/statuses/hot_band', headers: { Referer: 'https://weibo.com/' }, intervalMinutes: 10, riskLevel: 'medium' },
  { id: 'tophub', name: '微博(tophub)', url: 'https://tophub.today/n/KqndgxeLl9', headers: {}, intervalMinutes: 30, riskLevel: 'medium' },
]

/**
 * 稀疏分类定向补拉配置（方案B/D）。
 * threshold：主聚合后该分类条目数低于此值 → 自动触发 sources 补拉；
 *   UI 空分类「补拉该分类」按钮经 boostCategories 显式触发时不受阈值限制。
 * sources[].parser：复用 CHANNEL_PARSERS 键；board：id 中的撞号隔离段；
 *   boostCategory：条目直挂分类；filterCategory：解析后仅保留该原生分类的条目（微博垂类）。
 * 端点均经 2026-09-20 实测可用（探测记录见 PRD-热门选题分类供给增强）。
 */
const CATEGORY_BOOSTS = {
  finance: { threshold: 6, sources: [
    { id: 'baidu-finance', name: '百度财经榜', url: 'https://top.baidu.com/api/board?platform=wise&tab=finance', parser: 'baidu', channel: 'baidu', board: 'finance', boostCategory: 'finance', headers: {}, intervalMinutes: 10, riskLevel: 'low' },
    { id: 'sina-finance', name: '新浪财经滚动', url: 'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=50', parser: 'sina_finance', channel: 'sina_finance', board: 'finance', boostCategory: 'finance', headers: { Referer: 'https://finance.sina.com.cn/' }, intervalMinutes: 15, riskLevel: 'medium' },
  ] },
  tech: { threshold: 6, sources: [
    { id: 'ithome-tech', name: 'IT之家热榜', url: 'https://www.ithome.com/rss/', parser: 'ithome_rss', channel: 'ithome_tech', board: 'tech', boostCategory: 'tech', headers: {}, intervalMinutes: 15, riskLevel: 'low' },
  ] },
  emotion: { threshold: 4, sources: [
    { id: 'weibo-emotion', name: '微博情感垂类', url: 'https://weibo.com/ajax/statuses/hot_band', parser: 'weibo', channel: 'weibo', board: 'emotion', boostCategory: 'emotion', filterCategory: '情感', headers: { Referer: 'https://weibo.com/' }, intervalMinutes: 10, riskLevel: 'medium' },
  ] },
  health: { threshold: 4, sources: [
    { id: 'weibo-health', name: '微博健康垂类', url: 'https://weibo.com/ajax/statuses/hot_band', parser: 'weibo', channel: 'weibo', board: 'health', boostCategory: 'health', filterCategory: '健康医疗', headers: { Referer: 'https://weibo.com/' }, intervalMinutes: 10, riskLevel: 'medium' },
  ] },
  // 教育/国际暂无稳定可用垂类端点（探测记录：百度 education tab、头条分类参数、v2ex 均不可用），
  // 依赖 方案A 关键词/映射修复 + 方案C LLM 兜底补充
  education: { threshold: 4, sources: [] },
  international: { threshold: 4, sources: [] },
}

/** 简单内存限流器（单渠道最小间隔节流；正式限流组件见 collection-engine rate-limiter） */
class ChannelThrottle {
  constructor() { this.lastFetch = new Map() }
  /** @returns {boolean} 允许则记录时间戳并返回 true */
  tryAcquire(channelId, intervalMinutes) {
    const now = Date.now()
    const last = this.lastFetch.get(channelId) || 0
    if (now - last < intervalMinutes * 60 * 1000) return false
    this.lastFetch.set(channelId, now)
    return true
  }
}

/** 简单内存熔断器（连续 N 次失败 → OPEN 冷却 M 分钟 → HALF_OPEN 放行一次） */
class ChannelBreaker {
  constructor() {
    this.failures = new Map()
    this.openedAt = new Map()
  }
  isOpen(channelId, { cooldownMs = 30 * 60 * 1000 } = {}) {
    const opened = this.openedAt.get(channelId) || 0
    if (!opened) return false
    if (Date.now() - opened >= cooldownMs) {
      // 冷却结束 → HALF_OPEN：清零失败计数，放行一次
      this.openedAt.delete(channelId)
      this.failures.set(channelId, 0)
      return false
    }
    return true
  }
  recordSuccess(channelId) {
    this.failures.set(channelId, 0)
    this.openedAt.delete(channelId)
  }
  recordFailure(channelId, { threshold = 3, cooldownMs = 30 * 60 * 1000 } = {}) {
    const n = (this.failures.get(channelId) || 0) + 1
    this.failures.set(channelId, n)
    if (n >= threshold) this.openedAt.set(channelId, Date.now())
    return { failures: n, opened: this.openedAt.has(channelId), cooldownMs }
  }
}

class HotTopicsService {
  /**
   * @param {{
   *   log?: { info: Function, warn: Function, error: Function },
   *   settingsStore?: { getSetting: Function, setSetting: Function },
   *   llmClassify?: (topics: string[]) => Promise<Record<string, string>>,
   * }} deps
   *   llmClassify（方案C）：批量 LLM 分类，返回 { 选题文本: 分类枚举 }；
   *   可缺省（未配置模型）或抛错 —— 均静默降级保持关键词结果。
   */
  constructor(deps = {}) {
    this.log = deps.log || { info: () => {}, warn: () => {}, error: () => {} }
    this.settingsStore = deps.settingsStore || null
    this.llmClassify = typeof deps.llmClassify === 'function' ? deps.llmClassify : null
    this.throttle = new ChannelThrottle()
    this.breaker = new ChannelBreaker()
    /** @type {{ topics: Array, fetchedAt: number, channelStats: Object } | null} */
    this.memCache = null
    this.inFlight = null
  }

  /** 运行期注入 LLM 分类兜底（phase1-context 在 ModelProviderManager 就绪后接线） */
  setLlmClassify(fn) {
    this.llmClassify = typeof fn === 'function' ? fn : null
  }

  /** 读缓存（内存 → SQLite settings），fail-closed 回退空结构 */
  getCache() {
    if (this.memCache) return this.memCache
    if (this.settingsStore && typeof this.settingsStore.getSetting === 'function') {
      try {
        const raw = this.settingsStore.getSetting(CACHE_KEY)
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed && Array.isArray(parsed.topics) && typeof parsed.fetchedAt === 'number') {
          this.memCache = { topics: parsed.topics, fetchedAt: parsed.fetchedAt, channelStats: parsed.channelStats || {} }
          return this.memCache
        }
      } catch (e) {
        this.log.warn && this.log.warn('[hot-topics] cache parse failed:', e && e.message)
      }
    }
    return { topics: [], fetchedAt: 0, channelStats: {} }
  }

  _writeCache(cache) {
    this.memCache = cache
    if (this.settingsStore && typeof this.settingsStore.setSetting === 'function') {
      try {
        this.settingsStore.setSetting(CACHE_KEY, JSON.stringify(cache))
      } catch (e) {
        this.log.warn && this.log.warn('[hot-topics] cache write failed:', e && e.message)
      }
    }
  }

  /** 读 LLM 标签落盘缓存（fail-closed 空对象） */
  _readLlmLabels() {
    if (!this.settingsStore || typeof this.settingsStore.getSetting !== 'function') return {}
    try {
      const raw = this.settingsStore.getSetting(LLM_LABELS_KEY)
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] llm labels parse failed:', e && e.message)
    }
    return {}
  }

  _writeLlmLabels(labels) {
    if (!this.settingsStore || typeof this.settingsStore.setSetting !== 'function') return
    try {
      const keys = Object.keys(labels)
      const trimmed = keys.length > LLM_LABELS_MAX
        ? Object.fromEntries(keys.slice(keys.length - LLM_LABELS_MAX).map(k => [k, labels[k]]))
        : labels
      this.settingsStore.setSetting(LLM_LABELS_KEY, JSON.stringify(trimmed))
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] llm labels write failed:', e && e.message)
    }
  }

  /** 单渠道抓取（带 UA/头/超时），返回原始文本或抛错 */
  async _fetchChannel(config) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(config.url, {
        headers: {
          'User-Agent': DESKTOP_UA,
          'Accept': 'application/json, text/html, */*',
          ...config.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.text()
    } finally {
      clearTimeout(timer)
    }
  }

  /** 单渠道完整流程：限流 → 熔断 → 抓取 → 解析 → 多标签分类 */
  async _collectChannel(config, fetchedAt) {
    // 限流：未到最小间隔 → 跳过（用缓存数据，不报错）
    if (!this.throttle.tryAcquire(config.id, config.intervalMinutes)) {
      return { channel: config.id, items: null, skipped: true }
    }
    // 熔断：OPEN 状态 → 跳过
    if (this.breaker.isOpen(config.id)) {
      return { channel: config.id, items: null, skipped: true, breakerOpen: true }
    }
    try {
      const text = await this._fetchChannel(config)
      const parser = CHANNEL_PARSERS[config.parser || config.id]
      if (!parser) throw new Error('no parser for ' + config.id)
      const rawItems = parser(text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text)
      const items = rawItems.slice(0, MAX_PER_CHANNEL).map(x => {
        const multi = classifyTopicMulti(x.rawCategory, x.channel, x.topic)
        return {
          id: x.channel + ':' + x.rank,
          topic: x.topic,
          channel: x.channel,
          category: multi.category,
          categories: multi.categories,
          rank: x.rank,
          hotValue: x.hotValue,
          url: x.url,
          fetchedAt,
        }
      })
      this.breaker.recordSuccess(config.id)
      return { channel: config.id, items, skipped: false }
    } catch (e) {
      const state = this.breaker.recordFailure(config.id)
      this.log.warn && this.log.warn('[hot-topics] channel ' + config.id + ' failed:', e && e.message ? e.message : String(e), state)
      return { channel: config.id, items: null, skipped: false, error: e && e.message ? e.message : String(e) }
    }
  }

  /**
   * 单垂类补拉（方案B/D）：限流/熔断键用 source.id（与主榜隔离，
   * 微博情感/健康垂类共用端点但各自独立节流）。条目直挂 boostCategory，
   * id 含 board 段（如 weibo:emotion:3）避免与主榜 'weibo:3' 撞号。
   * filterCategory：解析后仅保留该原生分类条目（微博 band_list 垂类过滤）。
   */
  async _collectBoostChannel(source, fetchedAt) {
    if (!this.throttle.tryAcquire(source.id, source.intervalMinutes)) {
      return { channel: source.id, items: null, skipped: true, boost: true }
    }
    if (this.breaker.isOpen(source.id)) {
      return { channel: source.id, items: null, skipped: true, breakerOpen: true, boost: true }
    }
    try {
      const text = await this._fetchChannel(source)
      const parser = CHANNEL_PARSERS[source.parser]
      if (!parser) throw new Error('no boost parser for ' + source.id)
      let rawItems = parser(text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text)
      if (source.filterCategory) {
        rawItems = rawItems.filter(x => x.rawCategory === source.filterCategory)
      }
      const items = rawItems.slice(0, MAX_PER_CHANNEL).map(x => ({
        id: source.channel + ':' + source.board + ':' + x.rank,
        topic: x.topic,
        channel: source.channel,
        category: source.boostCategory,
        categories: [source.boostCategory],
        rank: x.rank,
        hotValue: x.hotValue,
        url: x.url,
        fetchedAt,
      }))
      this.breaker.recordSuccess(source.id)
      return { channel: source.id, items, skipped: false, boost: true }
    } catch (e) {
      const state = this.breaker.recordFailure(source.id)
      this.log.warn && this.log.warn('[hot-topics] boost channel ' + source.id + ' failed:', e && e.message ? e.message : String(e), state)
      return { channel: source.id, items: null, skipped: false, error: e && e.message ? e.message : String(e), boost: true }
    }
  }

  /** 聚合一批渠道结果为 { channelStats, allTopics, seen }（跨渠道按选题文本去重，先到者保留） */
  _aggregate(results, allTopics = [], seen = new Map(), channelStats = {}) {
    for (const r of results) {
      channelStats[r.channel] = {
        // 限流/熔断跳过不算失败：ok 保持 true，避免渠道下拉误标「不可用」
        ok: !r.error,
        skipped: !!r.skipped,
        error: r.error || null,
        count: r.items ? r.items.length : 0,
      }
      if (!r.items) continue
      for (const item of r.items) {
        // 归一化：兼容缺 categories 的旧形态条目（测试 mock / 陈旧缓存结构）
        const norm = { ...item }
        norm.categories = Array.isArray(norm.categories) && norm.categories.length
          ? norm.categories.slice(0, 3)
          : [norm.category || 'general']
        const key = norm.topic.trim()
        const prev = seen.get(key)
        if (prev) {
          const target = allTopics[prev.index]
          target.mergedFrom = target.mergedFrom || []
          if (!target.mergedFrom.includes(norm.channel)) target.mergedFrom.push(norm.channel)
          // 分类升级：先到条目为 general 而后来条目带明确分类（垂类补拉）→ 提升主分类并并标签
          for (const c of norm.categories) {
            if (!target.categories.includes(c) && target.categories.length < 3) target.categories.push(c)
          }
          if (target.category === 'general' && norm.category && norm.category !== 'general') {
            target.category = norm.category
          }
        } else {
          seen.set(key, { index: allTopics.length })
          allTopics.push(norm)
        }
      }
    }
    return { channelStats, allTopics, seen }
  }

  /** 分类计数（多标签口径：条目 categories 内每个标签都计） */
  _categoryCounts(items) {
    const counts = {}
    for (const t of items) {
      const cats = (Array.isArray(t.categories) && t.categories.length) ? t.categories : [t.category || 'general']
      for (const c of cats) counts[c] = (counts[c] || 0) + 1
    }
    return counts
  }

  /** 读评分配置（P2 渠道权重/半衰期配置化；fail-closed 空对象=用默认值） */
  _readRankConfig() {
    if (!this.settingsStore || typeof this.settingsStore.getSetting !== 'function') return {}
    try {
      const raw = this.settingsStore.getSetting(RANK_CONFIG_KEY)
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] rank config parse failed:', e && e.message)
    }
    return {}
  }

  /**
   * 方案C：LLM 分类兜底 —— 对仍为 general 的条目批量分类并应用。
   * 落盘标签缓存（LLM_LABELS_KEY）避免重复计费；llmClassify 缺省/抛错均静默降级。
   */
  async _applyLlmLabels(topics) {
    if (!this.llmClassify) return
    const labels = this._readLlmLabels()
    /** @type {Array<object>} */
    const need = []
    for (const t of topics) {
      if (t.category !== 'general') continue
      const cached = labels[t.topic]
      if (typeof cached === 'string' && CATEGORY_KEYS.includes(cached)) {
        if (cached !== 'general') {
          t.category = cached
          if (!t.categories.includes(cached) && t.categories.length < 3) t.categories.push(cached)
        }
      } else if (!Object.prototype.hasOwnProperty.call(labels, t.topic)) {
        need.push(t)
      }
    }
    const batch = need.slice(0, LLM_BATCH_LIMIT)
    if (!batch.length) return
    try {
      const got = await this.llmClassify(batch.map(t => t.topic))
      if (!got || typeof got !== 'object') return
      let changed = false
      for (const t of batch) {
        const lab = got[t.topic]
        // 合同校验：非法分类一律忽略（保持 general）
        if (typeof lab !== 'string' || !CATEGORY_KEYS.includes(lab)) continue
        labels[t.topic] = lab
        changed = true
        if (lab !== 'general') {
          t.category = lab
          if (!t.categories.includes(lab) && t.categories.length < 3) t.categories.push(lab)
        }
      }
      if (changed) this._writeLlmLabels(labels)
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] llm classify failed (silent fallback): ' + (e && e.message ? e.message : String(e)))
    }
  }

  /**
   * 抓取全部渠道（并发），去重、稀疏分类定向补拉、LLM 兜底、写缓存。
   * @param {{ force?: boolean, boostCategories?: string[] }} options
   *   force=true 跳过缓存 TTL 检查；boostCategories=UI 显式要求补拉的分类
   *   （空分类「补拉该分类」按钮），即使当前计数不低于阈值也触发该分类 sources。
   */
  async fetchTopics(options = {}) {
    const cache = this.getCache()
    // 时钟回拨防护：fetchedAt 在未来视为过期，避免缓存永不过期
    const age = Date.now() - cache.fetchedAt
    const fresh = cache.fetchedAt > 0 && age >= 0 && age < CACHE_TTL_MS
    if (!options.force && fresh) {
      return { ...cache, fromCache: true }
    }
    // 并发去重：同一时刻只允许一个 fetch 在飞；
    // 但带显式 boostCategories 的用户动作不复用旧请求（其补拉意图会被丢弃，评审 MINOR-3）
    const hasExplicitBoost = Array.isArray(options.boostCategories) && options.boostCategories.length > 0
    if (this.inFlight && !hasExplicitBoost) return this.inFlight

    this.inFlight = (async () => {
      const fetchedAt = Date.now()
      const results = await Promise.all(CHANNEL_CONFIGS.map(cfg => this._collectChannel(cfg, fetchedAt)))
      const { channelStats, allTopics, seen } = this._aggregate(results)
      const previous = Array.isArray(cache.topics) ? cache.topics : []

      // ── 方案B/D：稀疏分类定向补拉（低于阈值自动触发 + UI 显式指定） ──
      // 必须排在 preserve 早退之前：UI 显式「补拉该分类」是用户动作，不能被
      // 主渠道限流跳过的零结果路径静默吞掉（评审 MAJOR-1，2026-09-20）。
      const counts = this._categoryCounts(allTopics)
      /** @type {Set<string>} */
      const wanted = new Set((Array.isArray(options.boostCategories) ? options.boostCategories : [])
        .filter(c => typeof c === 'string' && CATEGORY_KEYS.includes(c)))
      /** @type {Array<object>} */
      const boostSources = []
      for (const [cat, cfg] of Object.entries(CATEGORY_BOOSTS)) {
        if (!cfg.sources.length) continue
        if (wanted.has(cat) || (counts[cat] || 0) < cfg.threshold) boostSources.push(...cfg.sources)
      }
      if (boostSources.length) {
        const boostResults = await Promise.all(boostSources.map(src => this._collectBoostChannel(src, fetchedAt)))
        this._aggregate(boostResults, allTopics, seen, channelStats)
        this.log.info && this.log.info('[hot-topics] boost fetched ' + boostSources.length + ' sources for categories: ' +
          [...new Set(boostSources.map(s => s.boostCategory))].join(','))
      }

      // 全渠道（含补拉）失败/被限流跳过 → 本轮零选题。此时**不能**用空结果覆盖上一次的非空缓存：
      // 一次网络抖动（或 10s 抓取超时）会把用户已抓到的选题全部清空，UI 直接掉进
      // 「暂无热门选题」空态，需要重新手动刷新才可能恢复（2026-09-14 实测缺陷）。
      // 保守策略：保留上一次的选题与 fetchedAt（保留陈旧值 = 下次非 force 调用仍会重试网络），
      // 只把本轮 channelStats 落盘供 UI 展示失败原因，并打上 preservedStaleCache 标记。
      if (allTopics.length === 0 && previous.length > 0) {
        const preserved = {
          topics: previous,
          fetchedAt: cache.fetchedAt,
          channelStats,
          preservedStaleCache: true,
        }
        this._writeCache(preserved)
        this.log.warn && this.log.warn('[hot-topics] all channels failed; preserved ' + previous.length +
          ' cached topics (stale) instead of overwriting with an empty list')
        return preserved
      }

      // ── P2 衰减数据流（跨轮 carry-over）：本轮被限流/熔断/失败跳过的渠道，沿用上一轮
      //   缓存条目参与统一评分；时间衰减按 age 使其下沉、热度不足自然跌出截断。
      //   全渠道零结果已在上方 preserve 早退（合同：不重排、不 carry）。 ──
      const liveChannels = new Set()
      for (const t of allTopics) liveChannels.add(t.channel)
      const byTopicKey = new Map(allTopics.map((t) => [String(t.topic || '').trim(), t]))
      let carried = 0
      for (const p of previous) {
        const k = String(p.topic || '').trim()
        if (!k || byTopicKey.has(k)) continue
        if (!p.channel || liveChannels.has(p.channel)) continue // channel 未知的旧形态条目不沿用
        allTopics.push(p)
        byTopicKey.set(k, p)
        carried++
      }
      if (carried && typeof this.log.info === 'function') {
        this.log.info('[hot-topics] carried ' + carried + ' stale topics from channels absent this round')
      }

      // ── 统一热度评分：先评分排序、后截断（P0，替代渠道序截断；boost 条目按真实热度插位） ──
      const rankCfg = this._readRankConfig()
      const scored = scoreTopics(allTopics, {
        now: fetchedAt,
        channelWeights: rankCfg.channelWeights || undefined,
        halfLifeMs: rankCfg.halfLifeMs || undefined,
      })
      // P1 trend 数据源：与上一轮（preserve 语义下的旧缓存）名次对比
      markTrend(scored, previous)
      const topics = scored.slice(0, MAX_TOPICS)

      // ── 方案C：LLM 分类兜底（general 条目批量分类 + 落盘缓存；失败静默降级） ──
      await this._applyLlmLabels(topics)

      const newCache = { topics, fetchedAt, channelStats }
      this._writeCache(newCache)
      this.log.info && this.log.info('[hot-topics] fetched ' + topics.length + ' topics from ' +
        Object.values(channelStats).filter(s => s.ok).length + '/' + Object.keys(channelStats).length + ' channels')
      return newCache
    })()

    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }
}

module.exports = {
  HotTopicsService,
  CACHE_KEY,
  LLM_LABELS_KEY,
  CACHE_TTL_MS,
  MAX_PER_CHANNEL,
  MAX_TOPICS,
  CHANNEL_CONFIGS,
  CATEGORY_BOOSTS,
  RANK_CONFIG_KEY,
}
