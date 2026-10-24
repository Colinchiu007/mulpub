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
 * ## 本模块的口径（端点级 + 失败计数）
 *
 *   - 同一用户：60 秒内**失败** ≥ 5 次 ⇒ 429
 *   - 同一 IP：10 分钟内**失败** ≥ 30 次，**且最近 60 秒内失败 ≥ 10 次** ⇒ 429
 *   - **只计失败**，成功不计数；一次成功还会**清零**该用户的失败计数
 *   - 命中时只回 429，**不透露剩余次数**（否则限流器本身可被探测）
 *
 * ## 为什么用户维度要「预占」额度（并发绕过）
 *
 * 若限流判定是「先看计数、再执行、失败后才计数」，那么**并发请求会全部通过**：
 * 20 个并发请求在同一瞬间都读到计数为 0 ⇒ 全部进入 ⇒ 限流形同虚设。
 * 这是典型的 TOCTOU。
 *
 * ⇒ 本模块用**预占（pending）**堵：请求进入时先占一个「待定失败」额度，
 * **失败时转正为失败、成功时释放**。有效占用 = 失败数 + 待定数。
 * ⇒ 并发 20 个失败请求时，只有前 5 个能进（阈值 5），其余当场被拦。
 *
 * ⚠️ `acquire()` 必须**同步完成检查与预占**（内部无 await）——
 * Node 单线程下，同步块不会被并发请求交错 ⇒ 这就是原子性的来源。
 *
 * ## IP 维度为什么要加「速率」条件（避免误伤共享出口）
 *
 * 公司 NAT / 校园网 / 家庭网关下，很多正常用户共用同一个出口 IP。
 * 若只按「10 分钟内失败 ≥ 30 次」判定，那些用户**各失败一两次**就足以把
 * **同出口的所有正常用户**一起锁在门外。
 *
 * ⇒ IP 档额外要求**最近 60 秒内失败 ≥ 10 次**（速率条件）：
 *   - 单 IP 快速探测 ⇒ 速率高 ⇒ **触发**
 *   - 共享出口慢速偶发失败 ⇒ 速率低 ⇒ **不触发**
 *
 * ## 诚实边界
 *
 * 计数是**进程内内存态**：多实例部署时每个实例各算各的 ⇒ 实际阈值是「阈值 × 实例数」。
 * 与仓内既有 `rate-limiter.js` 同一形态。要跨实例精确，需要 Redis 之类的共享存储，
 * 本期不做（**先上温和档**，观察一周真实数据再决定是否收紧或上共享存储）。
 */

/** 温和档默认参数：用户 60 秒 5 次失败；IP 10 分钟 30 次失败且 60 秒内 10 次。 */
const DEFAULT_USER_WINDOW_MS = 60 * 1000
const DEFAULT_USER_MAX_FAILURES = 5
const DEFAULT_IP_WINDOW_MS = 10 * 60 * 1000
const DEFAULT_IP_MAX_FAILURES = 30
/** IP 档的速率条件：最近这么多毫秒内失败次数达到该值才触发（防共享出口误伤）。 */
const DEFAULT_IP_BURST_WINDOW_MS = 60 * 1000
const DEFAULT_IP_BURST_FAILURES = 10

/** 清理间隔：与最短窗口同量级即可，不必更频繁。 */
const CLEANUP_INTERVAL_MS = 60 * 1000

class RedeemFailureLimiter {
  constructor (options = {}) {
    this.userWindowMs = Number.isFinite(options.userWindowMs) ? options.userWindowMs : DEFAULT_USER_WINDOW_MS
    this.userMaxFailures = Number.isFinite(options.userMaxFailures) ? options.userMaxFailures : DEFAULT_USER_MAX_FAILURES
    this.ipWindowMs = Number.isFinite(options.ipWindowMs) ? options.ipWindowMs : DEFAULT_IP_WINDOW_MS
    this.ipMaxFailures = Number.isFinite(options.ipMaxFailures) ? options.ipMaxFailures : DEFAULT_IP_MAX_FAILURES
    this.ipBurstWindowMs = Number.isFinite(options.ipBurstWindowMs) ? options.ipBurstWindowMs : DEFAULT_IP_BURST_WINDOW_MS
    this.ipBurstFailures = Number.isFinite(options.ipBurstFailures) ? options.ipBurstFailures : DEFAULT_IP_BURST_FAILURES
    // 可注入时钟：滑窗行为（窗口过期、速率条件）必须能被**不靠等待**地测出来。
    // 真实环境用 Date.now()；测试里推进虚拟时间即可覆盖「10 分钟后窗口过期」这类分支。
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    // key → { failures: number[], pending: number[] }（均为滑窗时间戳数组）
    this._users = new Map()
    this._ips = new Map()
    this._timer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS)
    // 清理定时器不得阻止进程退出（与仓内 rate-limiter.js 同款处理）
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref()
  }

  /**
   * **原子**地做限流判定并预占额度。
   *
   * ⚠️ 内部**不得**有 await：Node 单线程下，同步块不会被并发请求交错，
   * 这正是「并发请求无法同时通过判定」的来源。
   *
   * @returns {{ blocked: boolean, scope: 'user'|'ip'|null }}
   */
  acquire (userId, ip) {
    const now = this.now()
    if (userId) {
      const bucket = this._bucket(this._users, userId, now, this.userWindowMs)
      // 有效占用 = 已失败 + 待定（待定是「已经放行、结果未知的在途请求」）
      if (bucket.failures.length + bucket.pending.length >= this.userMaxFailures) {
        return { blocked: true, scope: 'user' }
      }
    }
    if (ip) {
      const bucket = this._bucket(this._ips, ip, now, this.ipWindowMs)
      const burst = bucket.failures.filter((ts) => ts > now - this.ipBurstWindowMs).length
      if (bucket.failures.length >= this.ipMaxFailures && burst >= this.ipBurstFailures) {
        return { blocked: true, scope: 'ip' }
      }
    }
    // 通过 ⇒ 预占一个待定额度（用户维度）。失败时转正，成功时释放。
    if (userId) this._bucket(this._users, userId, now, this.userWindowMs).pending.push(now)
    return { blocked: false, scope: null }
  }

  /** 记一次失败（只对「探测型」错误调用）：待定转正为失败。 */
  recordFailure (userId, ip) {
    const now = this.now()
    if (userId) {
      const bucket = this._bucket(this._users, userId, now, this.userWindowMs)
      bucket.pending.pop()
      bucket.failures.push(now)
    }
    if (ip) {
      const bucket = this._bucket(this._ips, ip, now, this.ipWindowMs)
      bucket.failures.push(now)
    }
  }

  /** 一次成功：释放待定额度，并清掉该用户的失败计数（IP 计数不清 —— 同 IP 可能是多用户共用出口）。 */
  recordSuccess (userId) {
    if (!userId) return
    const bucket = this._bucket(this._users, userId, this.now(), this.userWindowMs)
    bucket.pending.pop()
    bucket.failures.length = 0
  }

  /**
   * 释放一次**待定**额度，但不记为失败。
   *
   * ⚠️ 这个方法的存在是因为 `acquire()` 会**预占**额度。请求若以「非探测型」错误结束
   * （已用 / 停用 / 过期 / 服务端 500），既不该记失败、也不算成功 ——
   * 但**必须**把预占还回去，否则 pending 永久累积 ⇒
   * 用户只是反复拿自己的旧码来试，也会被限流在门外。
   */
  releasePending (userId) {
    if (!userId) return
    const bucket = this._bucket(this._users, userId, this.now(), this.userWindowMs)
    bucket.pending.pop()
  }

  /** 当前计数（供测试与运营自查；不通过 HTTP 暴露）。 */
  counts (userId, ip) {
    const now = this.now()
    const user = userId ? this._bucket(this._users, userId, now, this.userWindowMs) : null
    const ipBucket = ip ? this._bucket(this._ips, ip, now, this.ipWindowMs) : null
    return {
      userFailures: user ? user.failures.length : 0,
      userPending: user ? user.pending.length : 0,
      ipFailures: ipBucket ? ipBucket.failures.length : 0,
    }
  }

  stop () {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    this._users.clear()
    this._ips.clear()
  }

  /**
   * 取（或建）一个滑窗桶。
   *
   * ⚠️ `windowMs` 必须**按维度传**：IP 桶用 ipWindowMs（10 分钟），
   * 用户桶用 userWindowMs（60 秒）。若 IP 桶误用短窗口，
   * 「10 分钟内失败 ≥ 30 次」这个总量条件**永远达不到** ⇒ IP 档静默永不触发
   * （比不实现更糟：看起来有防护，实际没有）。
   *
   * ⚠️ 这里**不能**在桶为空时 `store.delete(key)`：删除后仍返回该 bucket，
   * 调用方接下来的写入会落到一个**已经不在 store 里**的 bucket ⇒ 计数丢失。
   * 空桶由 `_cleanup()` 定期清。
   */
  _bucket (store, key, now, windowMs) {
    let bucket = store.get(key)
    if (!bucket) {
      bucket = { failures: [], pending: [] }
      store.set(key, bucket)
    }
    const cutoff = now - windowMs
    bucket.failures = bucket.failures.filter((ts) => ts > cutoff)
    bucket.pending = bucket.pending.filter((ts) => ts > cutoff)
    return bucket
  }

  _cleanup () {
    const now = this.now()
    for (const [store, windowMs] of [[this._users, this.userWindowMs], [this._ips, this.ipWindowMs]]) {
      const cutoff = now - windowMs
      for (const [key, bucket] of store) {
        bucket.failures = bucket.failures.filter((ts) => ts > cutoff)
        bucket.pending = bucket.pending.filter((ts) => ts > cutoff)
        if (!bucket.failures.length && !bucket.pending.length) store.delete(key)
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
  DEFAULT_IP_BURST_WINDOW_MS,
  DEFAULT_IP_BURST_FAILURES,
}
