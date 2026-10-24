'use strict'
/**
 * redeem-rate-limit.js — 兑换失败限流（温和档）。
 *
 * ## 为什么需要它
 *
 * 兑换码是 31 字符字母表上的随机 12 位（组合空间 ≈ 7.88×10^17），**穷举不现实**。
 * 但 `REDEEM_CODE_NOT_FOUND` 会明确告诉调用方「这个码不存在」⇒ 可被用来
 * **定向探测某个具体码是否存在**（社交工程拿到的码、批量泄漏的码列表）。
 * 同时它也是最容易被用来骚扰的端点。
 *
 * ## 为什么不用仓里既有的 `src/rate-limiter.js`
 *
 * 那个是**全站粗桶**：① `maxRpm` 缺省为 `null` ⇒ **默认不启用**；
 * ② 不区分端点（兑换与发布共用一个计数器）；③ **不区分成败**（成功请求同样计数）；
 * ④ 单进程内存态（多实例部署时每个实例各算各的）。
 * ⇒ 对兑换场景基本无效：低速率定向探测抓不到；正常流量反而先占满额度。
 *
 * 本模块的口径（**端点级 + 失败计数**）：
 *   - 同一用户：60 秒内**失败** ≥ 5 次 ⇒ 429
 *   - 同一 IP：10 分钟内**失败** ≥ 30 次 ⇒ 429
 *   - **只计失败**，成功不计数；一次成功还会**清零**该用户的失败计数
 *   - 命中时只回 429，**不透露剩余次数**（否则限流器本身可被探测）
 *
 * ## 哪些失败才算「失败」
 *
 * 只有 `REDEEM_CODE_FORMAT`（格式错）与 `REDEEM_CODE_NOT_FOUND`（不存在）算 ——
 * 这两类才是探测行为。`REDEEM_CODE_USED` / `DISABLED` / `EXPIRED` **不算**：
 * 用户拿着自己的旧码或过期码来试，不该被限流（那是正常业务，不是攻击）。
 *
 * ## 诚实边界
 *
 * 计数是**进程内内存态**：多实例部署时每个实例各算各的 ⇒ 实际阈值是「阈值 × 实例数」。
 * 与仓内既有 `rate-limiter.js` 同一形态。要跨实例精确，需要 Redis 之类的共享存储，
 * 本期不做（**先上温和档**，观察一周真实数据再决定是否收紧或上共享存储）。
 */

/** 温和档默认参数：用户 60 秒 5 次、IP 10 分钟 30 次。 */
const DEFAULT_USER_WINDOW_MS = 60 * 1000
const DEFAULT_USER_MAX_FAILURES = 5
const DEFAULT_IP_WINDOW_MS = 10 * 60 * 1000
const DEFAULT_IP_MAX_FAILURES = 30

/** 清理间隔：与最短窗口同量级即可，不必更频繁。 */
const CLEANUP_INTERVAL_MS = 60 * 1000

class RedeemFailureLimiter {
  constructor (options = {}) {
    this.userWindowMs = Number.isFinite(options.userWindowMs) ? options.userWindowMs : DEFAULT_USER_WINDOW_MS
    this.userMaxFailures = Number.isFinite(options.userMaxFailures) ? options.userMaxFailures : DEFAULT_USER_MAX_FAILURES
    this.ipWindowMs = Number.isFinite(options.ipWindowMs) ? options.ipWindowMs : DEFAULT_IP_WINDOW_MS
    this.ipMaxFailures = Number.isFinite(options.ipMaxFailures) ? options.ipMaxFailures : DEFAULT_IP_MAX_FAILURES
    // key → 失败时间戳数组（滑窗）
    this._users = new Map()
    this._ips = new Map()
    this._timer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS)
    // 清理定时器不得阻止进程退出（与仓内 rate-limiter.js 同款处理）
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref()
  }

  /**
   * 查询是否应当放行。
   * @returns {{ blocked: boolean, scope: 'user'|'ip'|null }}
   */
  check (userId, ip) {
    const now = Date.now()
    if (userId && this._count(this._users, userId, now, this.userWindowMs) >= this.userMaxFailures) {
      return { blocked: true, scope: 'user' }
    }
    if (ip && this._count(this._ips, ip, now, this.ipWindowMs) >= this.ipMaxFailures) {
      return { blocked: true, scope: 'ip' }
    }
    return { blocked: false, scope: null }
  }

  /** 记一次失败（只对「探测型」错误调用）。 */
  recordFailure (userId, ip) {
    const now = Date.now()
    if (userId) this._push(this._users, userId, now)
    if (ip) this._push(this._ips, ip, now)
  }

  /** 一次成功：清掉该用户的失败计数（IP 计数不清 —— 同 IP 可能是多用户共用出口）。 */
  recordSuccess (userId) {
    if (userId) this._users.delete(userId)
  }

  /** 当前失败计数（供测试与运营自查；不通过 HTTP 暴露）。 */
  counts (userId, ip) {
    const now = Date.now()
    return {
      user: userId ? this._count(this._users, userId, now, this.userWindowMs) : 0,
      ip: ip ? this._count(this._ips, ip, now, this.ipWindowMs) : 0,
    }
  }

  stop () {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    this._users.clear()
    this._ips.clear()
  }

  _push (bucket, key, now) {
    const list = bucket.get(key) || []
    list.push(now)
    bucket.set(key, list)
  }

  _count (bucket, key, now, windowMs) {
    const list = bucket.get(key)
    if (!list) return 0
    const cutoff = now - windowMs
    const kept = list.filter((ts) => ts > cutoff)
    if (kept.length) bucket.set(key, kept)
    else bucket.delete(key)
    return kept.length
  }

  _cleanup () {
    const now = Date.now()
    for (const [bucket, windowMs] of [[this._users, this.userWindowMs], [this._ips, this.ipWindowMs]]) {
      for (const [key, list] of bucket) {
        const kept = list.filter((ts) => ts > now - windowMs)
        if (kept.length) bucket.set(key, kept)
        else bucket.delete(key)
      }
    }
  }
}

/**
 * 判定某个 commerce 错误是否算「探测型失败」。
 * 只有格式错与不存在算；已用/停用/过期都不算（那是正常业务）。
 */
function isProbeFailure (error) {
  if (!error) return false
  return error.code === 'REDEEM_CODE_FORMAT' || error.code === 'REDEEM_CODE_NOT_FOUND'
}

module.exports = {
  RedeemFailureLimiter,
  isProbeFailure,
  DEFAULT_USER_WINDOW_MS,
  DEFAULT_USER_MAX_FAILURES,
  DEFAULT_IP_WINDOW_MS,
  DEFAULT_IP_MAX_FAILURES,
}
