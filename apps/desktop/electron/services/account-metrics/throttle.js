// @ts-check
/**
 * account-metrics/throttle — 账号级采集的节流与熔断（纯逻辑，无 IO）
 *
 * 存在理由（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §3.1 V4/V6/V8）：
 * 「不能太频繁查询以防被封」是本次需求的第一约束。本仓已有的两条节流范式都不完全适用：
 *   - `performance-recrawl-service._jitter()` 是**模块内私有**的 2–5s 固定区间，且按作品粒度；
 *   - `publish-frequency-policy` 管的是**发布**间隔（分钟级），拿它管采集会让两条链互相压缩额度。
 * 所以采集侧另立一处，但口径对齐既有纪律：
 *   ① 延迟一律带随机抖动（固定间隔是机器特征）；
 *   ② 额度超限**出声计数**，不静默跳过；
 *   ③ 连续失败转 backoff 的阈值与回采链同为 3。
 *
 * 本模块不读时钟、不发请求、不写库 —— `nowMs` 一律由调用方传入，因此日界与熔断可离线穷举。
 */
'use strict'

const {
  MAX_CONSECUTIVE_FAILURES,
} = require('./constants')

/** UTC 日键：日额度按 UTC 日滚动，避免本地时区跨零点抖动导致额度提前/滞后复位。 */
function utcDayKey (nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10)
}

class AccountMetricsThrottle {
  /**
   * @param {object} [opts]
   * @param {number} [opts.pageDelayBaseMs]
   * @param {number} [opts.pageDelayJitterRatio]
   * @param {number} [opts.accountDailyMax]
   * @param {() => number} [opts.random] 注入随机源（测试用；默认 Math.random）
   */
  constructor (opts) {
    const o = opts || {}
    this._baseMs = Number.isFinite(o.pageDelayBaseMs) ? o.pageDelayBaseMs : 1000
    this._jitterRatio = Number.isFinite(o.pageDelayJitterRatio) ? o.pageDelayJitterRatio : 0.5
    this._dailyMax = Number.isFinite(o.accountDailyMax) ? o.accountDailyMax : 4
    this._random = typeof o.random === 'function' ? o.random : Math.random
    /** @type {Map<string, {day: string, count: number}>} */
    this._runs = new Map()
    /** @type {Map<string, number>} */
    this._failures = new Map()
  }

  /**
   * V4：页间延迟 = base × (1 + random[0, ratio])。
   * 返回一个**具体的毫秒数**（而不是 Promise），让调用方决定怎么等 —— 便于断言与注入假时钟。
   * @returns {number}
   */
  pageDelayMs () {
    const r = this._random()
    // 随机源异常（NaN/越界）时退回基准，绝不产出 NaN 延迟（那会让 setTimeout 立刻触发 ⇒ 节流失效）
    const safe = Number.isFinite(r) ? Math.min(Math.max(r, 0), 1) : 0
    return Math.round(this._baseMs * (1 + safe * this._jitterRatio))
  }

  /**
   * V6：该账号今天还能不能跑。
   * 未跑过 / 已跨日 → 允许；已达上限 → 拒绝（调用方记 skipped_daily_cap 并出声）。
   * @param {string} accountId
   * @param {number} nowMs
   * @returns {boolean}
   */
  canRun (accountId, nowMs) {
    const id = String(accountId || '')
    if (!id) return false
    const entry = this._runs.get(id)
    if (!entry) return true
    if (entry.day !== utcDayKey(nowMs)) return true
    return entry.count < this._dailyMax
  }

  /**
   * 记账一次「真的发了请求的轮次」。只应在通过 canRun 之后调用。
   * @param {string} accountId
   * @param {number} nowMs
   */
  recordRun (accountId, nowMs) {
    const id = String(accountId || '')
    if (!id) return
    const day = utcDayKey(nowMs)
    const entry = this._runs.get(id)
    if (!entry || entry.day !== day) {
      this._runs.set(id, { day, count: 1 })
      return
    }
    entry.count += 1
  }

  /** 供界面/状态展示：该账号今日已跑轮次与上限。 */
  dailyUsage (accountId, nowMs) {
    const id = String(accountId || '')
    const entry = this._runs.get(id)
    const used = entry && entry.day === utcDayKey(nowMs) ? entry.count : 0
    return { used, max: this._dailyMax }
  }

  /**
   * V8：记账一次失败。返回是否已达 backoff 阈值。
   * @param {string} accountId
   * @returns {boolean} true = 该账号本轮应终止
   */
  recordFailure (accountId) {
    const id = String(accountId || '')
    if (!id) return false
    const next = (this._failures.get(id) || 0) + 1
    this._failures.set(id, next)
    return next >= MAX_CONSECUTIVE_FAILURES
  }

  /** 一次成功后清零失败计数（与回采链「成功即清零」同口径）。 */
  recordSuccess (accountId) {
    const id = String(accountId || '')
    if (!id) return
    this._failures.delete(id)
  }

  /** 该账号当前连续失败次数（排障与状态展示用）。 */
  failureCount (accountId) {
    return this._failures.get(String(accountId || '')) || 0
  }

  /** 清空全部内存态（测试与「重置」入口用）。 */
  reset () {
    this._runs.clear()
    this._failures.clear()
  }
}

module.exports = { AccountMetricsThrottle, utcDayKey, MAX_CONSECUTIVE_FAILURES }
