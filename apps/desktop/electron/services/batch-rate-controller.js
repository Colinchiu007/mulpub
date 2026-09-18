// @ts-check
/**
 * BatchRateController — 批量任务频率控制器（反爬）
 *
 * 为知乎收藏夹批量采集/批量改写设计。核心策略：
 *   1. 串行执行（并发=1）——批量并发请求是风控的最强信号
 *   2. 条间随机延迟（base + jitter）——模拟人类不规则操作间隔
 *   3. 指数退避（429/403 等可重试失败）——30s→60s→120s
 *   4. 熔断（连续退避超上限）——停止批量，保护账号
 *   5. 可取消——用户可中途停止
 *
 * 与 collection-engine RateLimiter 的区别：后者是平台级策略（weekendFactor 等），
 * 本控制器是任务级编排器（管理一批 items 的执行节奏 + 进度 + 退避 + 熔断）。
 */

class BatchRateController {
  /**
   * @param {object} [opts]
   * @param {number} [opts.baseIntervalMs] - 条间基础延迟，默认 8000
   * @param {number} [opts.jitterMs] - 随机抖动上限，默认 4000
   * @param {number} [opts.backoffBaseMs] - 退避基础，默认 30000
   * @param {number} [opts.backoffFactor] - 退避倍数，默认 2
   * @param {number} [opts.maxBackoffs] - 最大退避次数，默认 3（超过即熔断）
   * @param {object} [opts.log] - { info, warn, error }
   * @param {function} [opts.sleepFn] - sleep 注入（测试用，避免真实等待）
   */
  constructor (opts = {}) {
    this._baseIntervalMs = Number.isFinite(opts.baseIntervalMs) ? opts.baseIntervalMs : 8000
    this._jitterMs = Number.isFinite(opts.jitterMs) ? opts.jitterMs : 4000
    this._backoffBaseMs = Number.isFinite(opts.backoffBaseMs) ? opts.backoffBaseMs : 30000
    this._backoffFactor = Number.isFinite(opts.backoffFactor) ? opts.backoffFactor : 2
    this._maxBackoffs = Number.isFinite(opts.maxBackoffs) ? opts.maxBackoffs : 3
    this._log = opts.log || { info: () => {}, warn: () => {}, error: () => {} }
    this._sleepFn = opts.sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms)))
    this._stats = { completed: 0, failed: 0, skipped: 0, backoffCount: 0, circuitBroken: false }
  }

  /**
   * 串行执行一批任务，带频率控制。
   * @param {Array} items - 待处理数组
   * @param {function} taskFn - async (item, index) => { ok: boolean, retryable?: boolean }
   * @param {object} [opts]
   * @param {function} [opts.onProgress] - (index, total, result) => void
   * @param {object} [opts.signal] - { cancelled: boolean } 外部取消标记
   * @returns {Promise<{completed: number, failed: number, skipped: number, cancelled: boolean, backoffCount: number, circuitBroken: boolean, results: Array}>}
   */
  async run (items, taskFn, opts = {}) {
    if (!Array.isArray(items)) throw new TypeError('items must be an array')
    if (typeof taskFn !== 'function') throw new TypeError('taskFn must be a function')
    const signal = opts.signal || { cancelled: false }
    const results = []
    this._stats = { completed: 0, failed: 0, skipped: 0, backoffCount: 0, circuitBroken: false }

    for (let i = 0; i < items.length; i++) {
      if (signal.cancelled === true) {
        this._log.info('batch-rate', '批量任务被用户取消', { processed: i, total: items.length })
        return { ...this._stats, cancelled: true, results }
      }

      let result
      try {
        result = await taskFn(items[i], i)
      } catch (e) {
        result = { ok: false, error: e && e.message ? e.message : String(e) }
      }

      if (result && result.ok) {
        this._stats.completed++
      } else if (result && result.retryable) {
        // 可重试失败（429/403）：指数退避
        this._stats.backoffCount++
        this._stats.failed++
        if (this._stats.backoffCount > this._maxBackoffs) {
          this._stats.circuitBroken = true
          this._log.warn('batch-rate', '熔断：连续退避超上限，停止批量', {
            backoffCount: this._stats.backoffCount, maxBackoffs: this._maxBackoffs, processed: i,
          })
          results.push({ index: i, ...result })
          return { ...this._stats, cancelled: false, results }
        }
        const backoffMs = this._backoffBaseMs * Math.pow(this._backoffFactor, this._stats.backoffCount - 1)
        this._log.warn('batch-rate', '可重试失败，指数退避', {
          index: i, backoffMs, backoffCount: this._stats.backoffCount,
        })
        await this._sleepFn(backoffMs)
      } else {
        // 不可重试失败：记录，继续下一条（不退避）
        this._stats.failed++
      }

      results.push({ index: i, ...result })
      if (opts.onProgress) {
        try { opts.onProgress(i, items.length, result) } catch { /* 回调异常不中断 */ }
      }

      // 条间延迟（最后一条之后不延迟）
      if (i < items.length - 1 && !signal.cancelled) {
        const delay = this._computeInterval()
        await this._sleepFn(delay)
      }
    }
    return { ...this._stats, cancelled: false, results }
  }

  /**
   * 计算条间延迟：base + random(0, jitter)。
   * @returns {number}
   */
  _computeInterval () {
    const jitter = this._jitterMs > 0 ? Math.floor(Math.random() * this._jitterMs) : 0
    return this._baseIntervalMs + jitter
  }

  /**
   * 当前统计。
   * @returns {{completed: number, failed: number, skipped: number, backoffCount: number, circuitBroken: boolean}}
   */
  getStats () {
    return { ...this._stats }
  }
}

module.exports = BatchRateController
