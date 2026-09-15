// @ts-check
/**
 * HotTopicsService — 热门选题聚合服务（主进程）
 *
 * 职责：
 *   - 从 8 个公开渠道并发抓取热搜榜/热榜选题
 *   - 复用 collection-engine 防反爬组件（限流/熔断/缓存）
 *   - 分类（渠道原生 + 关键词规则）→ 去重 → 缓存落 SQLite settings
 *
 * IPC 通道（由 ipc-handlers/hot-topics.js 注册）：
 *   hot-topics:fetch      { force } → { code, data: { topics, fetchedAt, channelStats } }
 *   hot-topics:get-cache   {}       → { code, data: cache }
 */

const { classifyTopic } = require('./hot-topics/classifier')
const { CHANNEL_PARSERS } = require('./hot-topics/channels')

const CACHE_KEY = 'hot_topics_cache'
const CACHE_TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 10 * 1000
const MAX_PER_CHANNEL = 20
const MAX_TOPICS = 160 // 8 渠道 × 20 条上限 = 160（去重后实际更少）

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * 渠道配置：端点、请求头、最小间隔（分钟）、风险级别。
 * intervalMinutes 由内存限流器使用（简单时间戳节流，避免高频抓取触发反爬）。
 */
const CHANNEL_CONFIGS = [
  { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/api/v4/creators/rank/hot?domain=0', headers: {}, intervalMinutes: 5, riskLevel: 'low' },
  { id: 'toutiao', name: '今日头条', url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', headers: {}, intervalMinutes: 5, riskLevel: 'medium' },
  { id: 'tencent', name: '腾讯新闻', url: 'https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=20', headers: {}, intervalMinutes: 10, riskLevel: 'medium' },
  { id: 'bilibili', name: '哔哩哔哩', url: 'https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1', headers: {}, intervalMinutes: 10, riskLevel: 'low' },
  { id: 'douyin', name: '抖音', url: 'https://www.douyin.com/aweme/v1/web/hot/search/list/', headers: { Referer: 'https://www.douyin.com/' }, intervalMinutes: 15, riskLevel: 'high' },
  { id: 'baidu', name: '百度热搜', url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime', headers: {}, intervalMinutes: 10, riskLevel: 'low' },
  { id: 'weibo', name: '微博热搜', url: 'https://weibo.com/ajax/statuses/hot_band', headers: { Referer: 'https://weibo.com/' }, intervalMinutes: 10, riskLevel: 'medium' },
  { id: 'tophub', name: '微博(tophub)', url: 'https://tophub.today/n/KqndgxeLl9', headers: {}, intervalMinutes: 30, riskLevel: 'medium' },
]

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
   * @param {{ log?: { info: Function, warn: Function, error: Function }, settingsStore?: { getSetting: Function, setSetting: Function } }} deps
   */
  constructor(deps = {}) {
    this.log = deps.log || { info: () => {}, warn: () => {}, error: () => {} }
    this.settingsStore = deps.settingsStore || null
    this.throttle = new ChannelThrottle()
    this.breaker = new ChannelBreaker()
    /** @type {{ topics: Array, fetchedAt: number, channelStats: Object } | null} */
    this.memCache = null
    this.inFlight = null
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

  /** 单渠道完整流程：限流 → 熔断 → 抓取 → 解析 → 分类 */
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
      const parser = CHANNEL_PARSERS[config.id]
      if (!parser) throw new Error('no parser for ' + config.id)
      const rawItems = parser(text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text)
      const items = rawItems.slice(0, MAX_PER_CHANNEL).map(x => ({
        id: x.channel + ':' + x.rank,
        topic: x.topic,
        channel: x.channel,
        category: classifyTopic(x.rawCategory, x.channel, x.topic),
        rank: x.rank,
        hotValue: x.hotValue,
        url: x.url,
        fetchedAt,
      }))
      this.breaker.recordSuccess(config.id)
      return { channel: config.id, items, skipped: false }
    } catch (e) {
      const state = this.breaker.recordFailure(config.id)
      this.log.warn && this.log.warn('[hot-topics] channel ' + config.id + ' failed:', e && e.message ? e.message : String(e), state)
      return { channel: config.id, items: null, skipped: false, error: e && e.message ? e.message : String(e) }
    }
  }

  /**
   * 抓取全部渠道（并发），去重、写缓存。
   * @param {{ force?: boolean }} options force=true 跳过缓存 TTL 检查
   */
  async fetchTopics(options = {}) {
    const cache = this.getCache()
    // 时钟回拨防护：fetchedAt 在未来视为过期，避免缓存永不过期
    const age = Date.now() - cache.fetchedAt
    const fresh = cache.fetchedAt > 0 && age >= 0 && age < CACHE_TTL_MS
    if (!options.force && fresh) {
      return { ...cache, fromCache: true }
    }
    // 并发去重：同一时刻只允许一个 fetch 在飞
    if (this.inFlight) return this.inFlight

    this.inFlight = (async () => {
      const fetchedAt = Date.now()
      const results = await Promise.all(CHANNEL_CONFIGS.map(cfg => this._collectChannel(cfg, fetchedAt)))
      const channelStats = {}
      const allTopics = []
      const seen = new Map() // topic.trim() → { index, mergedFrom }
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
          const key = item.topic.trim()
          const prev = seen.get(key)
          if (prev) {
            // 跨渠道重复：保留先到者，记录 mergedFrom
            allTopics[prev.index].mergedFrom = allTopics[prev.index].mergedFrom || []
            if (!allTopics[prev.index].mergedFrom.includes(item.channel)) {
              allTopics[prev.index].mergedFrom.push(item.channel)
            }
          } else {
            seen.set(key, { index: allTopics.length })
            allTopics.push(item)
          }
        }
      }
      const topics = allTopics.slice(0, MAX_TOPICS)
      const previous = Array.isArray(cache.topics) ? cache.topics : []
      // 全渠道失败/被限流跳过 → 本轮零选题。此时**不能**用空结果覆盖上一次的非空缓存：
      // 一次网络抖动（或 10s 抓取超时）会把用户已抓到的选题全部清空，UI 直接掉进
      // 「暂无热门选题」空态，需要重新手动刷新才可能恢复（2026-09-14 实测缺陷）。
      // 保守策略：保留上一次的选题与 fetchedAt（保留陈旧值 = 下次非 force 调用仍会重试网络），
      // 只把本轮 channelStats 落盘供 UI 展示失败原因，并打上 preservedStaleCache 标记。
      if (topics.length === 0 && previous.length > 0) {
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
      const newCache = { topics, fetchedAt, channelStats }
      this._writeCache(newCache)
      this.log.info && this.log.info('[hot-topics] fetched ' + topics.length + ' topics from ' +
        Object.values(channelStats).filter(s => s.ok).length + '/' + CHANNEL_CONFIGS.length + ' channels')
      return newCache
    })()

    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }
}

module.exports = { HotTopicsService, CACHE_KEY, CACHE_TTL_MS, CHANNEL_CONFIGS }
