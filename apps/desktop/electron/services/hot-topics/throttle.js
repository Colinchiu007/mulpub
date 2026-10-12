// @ts-check
/**
 * throttle.js — 热门选题采集的限流/熔断原语（2026-10-13 配额治理）
 *
 * 为什么从 hot-topics-service.js 拆出来（配额治理四项改动的公共依赖）：
 *   P0  限流/熔断的**键**从「来源身份 id」改为「配额键」——同一 URL 挂多个 id 时
 *       （weibo 主渠道 + weibo-emotion + weibo-health；ithome-tech + ithome-ai），
 *       按 id 计数等于没有配额：换个 id 就能再来一次。
 *   P2  配额键可被配置显式声明（`throttleKey`），让不同模块/不同身份共享同一份配额，
 *       而不必把两个模块耦在一起。
 *   P3  状态可 `serialize()` / `restore()`：进程内存态在重启后清零，意味着
 *       「重启后的第一轮 = 全量并发外呼 + 完全不记得 5 分钟前刚打过」。
 *
 * 判据单一来源：`quotaKeyOf(config)` 是**唯一**的配额键推导函数，
 * service 层禁止自己再写第二份键推导（避免判据漂移）。
 */

/**
 * 配额键归一化：去掉查询串、统一小写、去尾部斜杠。
 *
 * 为什么忽略查询串：同一端点用 query 表达不同子榜（百度 `?tab=realtime` / `?tab=finance`）
 * 时，它们是**同一台服务器的同一类压力**，应当共享配额；而 path 不同（如 `/rss/` vs `/api/x`）
 * 通常是不同资源，配额独立。
 *
 * @param {string} url
 * @returns {string}
 */
function throttleKey (url) {
  const raw = String(url || '')
  let u
  try {
    u = new URL(raw)
  } catch {
    // 非法 URL：退化为整串小写（仍然可作键，不会互相误伤）
    return raw.trim().toLowerCase()
  }
  const p = u.pathname.replace(/\/+$/, '') || '/'
  return (u.host + p).toLowerCase()
}

/**
 * 配额键推导（**唯一真源**）。
 * 优先级：显式 `throttleKey` > `url` 归一化。
 * **不使用** 来源 id（`id` 只用于 channelStats / UI 展示，不用于配额）。
 *
 * @param {{ id?: string, url?: string, throttleKey?: string }} config
 * @returns {string}
 */
function quotaKeyOf (config) {
  if (!config) return 'unknown'
  if (typeof config.throttleKey === 'string' && config.throttleKey.trim()) return config.throttleKey.trim()
  return throttleKey(config.url)
}

/**
 * 内存限流器：按配额键做最小间隔节流。
 * 与 v2 的差别：键由调用方传**配额键**（quotaKeyOf 的结果），不再是来源 id。
 */
class ChannelThrottle {
  constructor () { this.lastFetch = new Map() }

  /**
   * @param {string} quotaKey quotaKeyOf(config) 的结果
   * @param {number} intervalMinutes
   * @returns {boolean} 允许则记录时间戳并返回 true
   */
  tryAcquire (quotaKey, intervalMinutes) {
    const now = Date.now()
    const last = this.lastFetch.get(quotaKey) || 0
    if (now - last < intervalMinutes * 60 * 1000) return false
    this.lastFetch.set(quotaKey, now)
    return true
  }

  /** @returns {object} 可 JSON 序列化的快照（P3 跨重启） */
  serialize () {
    return { version: 1, lastFetch: [...this.lastFetch.entries()] }
  }

  /**
   * 从快照恢复。**fail-closed**：任何非法载荷都不得抛错，只清空状态
   * （清空 = 退化成「重启后无记忆」，绝不能退化成「放行一切」）。
   * @param {unknown} snapshot
   */
  restore (snapshot) {
    this.lastFetch = new Map()
    let parsed = snapshot
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { return }
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.lastFetch)) return
    for (const entry of parsed.lastFetch) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [k, v] = entry
      if (typeof k !== 'string' || !k) continue
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) continue
      this.lastFetch.set(k, n)
    }
  }
}

/**
 * 内存熔断器：按配额键连续失败 N 次 → OPEN 冷却 M 分钟 → HALF_OPEN 放行一次。
 * 与 v2 的差别：键由调用方传**配额键**。同一 URL 的任一身份失败，都会让该 URL 的
 * 全部身份进入保护（这正是配额的本意）。
 */
class ChannelBreaker {
  constructor () {
    this.failures = new Map()
    this.openedAt = new Map()
  }

  isOpen (quotaKey, { cooldownMs = 30 * 60 * 1000 } = {}) {
    const opened = this.openedAt.get(quotaKey) || 0
    if (!opened) return false
    if (Date.now() - opened >= cooldownMs) {
      // 冷却结束 → HALF_OPEN：清零失败计数，放行一次
      this.openedAt.delete(quotaKey)
      this.failures.set(quotaKey, 0)
      return false
    }
    return true
  }

  recordSuccess (quotaKey) {
    this.failures.set(quotaKey, 0)
    this.openedAt.delete(quotaKey)
  }

  recordFailure (quotaKey, { threshold = 3, cooldownMs = 30 * 60 * 1000 } = {}) {
    const n = (this.failures.get(quotaKey) || 0) + 1
    this.failures.set(quotaKey, n)
    if (n >= threshold) this.openedAt.set(quotaKey, Date.now())
    return { failures: n, opened: this.openedAt.has(quotaKey), cooldownMs }
  }

  /** @returns {object} 可 JSON 序列化的快照（P3 跨重启） */
  serialize () {
    return { version: 1, failures: [...this.failures.entries()], openedAt: [...this.openedAt.entries()] }
  }

  /**
   * 从快照恢复。**fail-closed**：非法载荷不抛错、清空状态。
   * @param {unknown} snapshot
   */
  restore (snapshot) {
    this.failures = new Map()
    this.openedAt = new Map()
    let parsed = snapshot
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { return }
    }
    if (!parsed || typeof parsed !== 'object') return
    const readPairs = (v) => (Array.isArray(v) ? v : [])
    for (const entry of readPairs(parsed.failures)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [k, n] = entry
      if (typeof k !== 'string' || !k) continue
      const num = Number(n)
      if (!Number.isFinite(num) || num < 0) continue
      this.failures.set(k, num)
    }
    for (const entry of readPairs(parsed.openedAt)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [k, t] = entry
      if (typeof k !== 'string' || !k) continue
      const num = Number(t)
      if (!Number.isFinite(num) || num <= 0) continue
      this.openedAt.set(k, num)
    }
  }
}

module.exports = {
  throttleKey,
  quotaKeyOf,
  ChannelThrottle,
  ChannelBreaker,
}
