/**
 * RateLimiter — L3 频率控制器
 *
 * 职责：
 * 1. 随机化请求间隔（min/max 抖动）
 * 2. 活跃时段判断（白天才发，深夜不发）
 * 3. 周末衰减（weekendFactor）
 * 4. 记录请求时间戳，计算下一次可请求时间
 *
 * 纯 Node，可单测。时间通过注入 clock 控制。
 */

function jitter (min, max, rng = Math.random) {
  if (max <= min) return min
  return Math.floor(min + rng() * (max - min))
}

/** 是否周末（周六=6 周日=0） */
function isWeekend (date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

/** 是否在活跃时段内（跨午夜不处理，约定 start <= end） */
function isInActiveHours (date, activeHours) {
  const hour = date.getHours()
  return hour >= activeHours.start && hour < activeHours.end
}

class RateLimiter {
  constructor (opts = {}) {
    this._now = opts.now || (() => new Date())
    this._rng = opts.rng || Math.random
    this._lastRequest = new Map() // key -> timestamp
    this._lastInterval = new Map() // key -> 本次计算的间隔（用于测试断言）
  }

  _key (platform, accountId = 'default') {
    return platform + ':' + accountId
  }

  /**
   * 计算下次可请求的等待时间（毫秒）
   * @returns {number} 还需等待的 ms（0 表示可立即请求）
   */
  getWaitTime (strategy) {
    const { platform, accountId = 'default', interval } = strategy
    const key = this._key(platform, accountId)
    const nowMs = this._now().getTime()
    const last = this._lastRequest.get(key)

    if (!last) return 0

    const elapsed = nowMs - last
    let target = this._lastInterval.get(key)
    if (target == null) {
      target = jitter(interval.min, interval.max, this._rng)
      this._lastInterval.set(key, target)
    }
    return Math.max(0, target - elapsed)
  }

  /**
   * 是否允许现在请求（结合活跃时段 + 周末衰减）
   * @param {object} strategy - 平台策略（含 weekendFactor/activeHours/interval）
   * @param {boolean} [strategy.manual] - 用户手动单次采集：豁免 weekend-throttle
   *   随机拒绝（用户周末手动采一篇被概率拦截不合理），保留 interval 限流与活跃时段。
   * @returns {{allowed: boolean, reason?: string, waitMs?: number}}
   */
  evaluate (strategy) {
    const now = this._now()

    // 手动单次采集（manual: true）豁免活跃时段限制：用户主动点击采集不应受
    // 「模拟人工活跃时段」约束（与 weekend-throttle 豁免同理）。活跃时段仅约束
    // 自动批量采集（模拟人类作息，降低封号风险）。
    if (!strategy.manual && !isInActiveHours(now, strategy.activeHours)) {
      return { allowed: false, reason: 'outside-active-hours' }
    }

    if (isWeekend(now) && !strategy.manual) {
      // 周末衰减：按概率拒绝（factor=0.5 意味着 50% 概率拒绝）。
      // 仅作用于自动批量采集（模拟人类周末低频行为降低封号风险）；
      // 手动单次采集（manual: true）豁免——用户点击一次被随机拒绝无意义。
      const factor = strategy.weekendFactor ?? 1
      if (factor < 1 && this._rng() > factor) {
        return { allowed: false, reason: 'weekend-throttle' }
      }
    }

    const waitMs = this.getWaitTime(strategy)
    if (waitMs > 0) {
      return { allowed: false, reason: 'rate-limit', waitMs }
    }

    return { allowed: true }
  }

  /** 记录一次请求（更新 lastRequest 时间戳） */
  recordRequest (platform, accountId = 'default') {
    const key = this._key(platform, accountId)
    this._lastRequest.set(key, this._now().getTime())
  }

  /** 重置某账号的节奏状态 */
  reset (platform, accountId = 'default') {
    const key = this._key(platform, accountId)
    this._lastRequest.delete(key)
    this._lastInterval.delete(key)
  }

  /** 获取最近一次计算的间隔（测试用） */
  getLastInterval (platform, accountId = 'default') {
    return this._lastInterval.get(this._key(platform, accountId))
  }
}

module.exports = {
  RateLimiter,
  jitter,
  isWeekend,
  isInActiveHours,
}
