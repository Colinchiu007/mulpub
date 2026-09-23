/**
 * KnowledgeEvolutionScheduler — 知识进化策略调度器
 *
 * 参考 EverOS OME (Offline Memory Engine) 的策略调度范式：
 * 进化不是靠用户手动触发，而是后台策略引擎按事件/定时自动执行。
 *
 * 策略：
 *   - decay-check    应用启动时 + 每 6 小时
 *   - consolidate    每周一凌晨 2 点
 *   - quality-score  每周日凌晨 3 点
 */

const { decayCheck, consolidate, batchScoreQuality } = require('./knowledge-evolution')

class KnowledgeEvolutionScheduler {
  constructor(store, logger) {
    this._store = store
    this._logger = logger || { info: function () {}, warn: function () {} }
    this._timers = []
    this._lastDecayCheck = 0
    this._lastConsolidate = 0
    this._lastQualityScore = 0
    this._running = false
  }

  start() {
    if (this._running) return
    this._running = true
    const self = this

    // 启动时立即执行一次 decay check（覆盖离线期间时间流逝）
    this._safeRun('decay-check', function () {
      const changes = decayCheck(self._store)
      self._lastDecayCheck = Date.now()
      if (changes.length > 0) self._logger.info('Evolution', 'decay-check(startup): ' + changes.length + ' changes')
    })

    // 每 6 小时 decay check
    this._timers.push(setInterval(function () {
      self._safeRun('decay-check', function () {
        const changes = decayCheck(self._store)
        self._lastDecayCheck = Date.now()
        if (changes.length > 0) self._logger.info('Evolution', 'decay-check: ' + changes.length + ' changes')
      })
    }, 6 * 3600 * 1000))

    // 每周一凌晨 2 点 consolidate
    this._scheduleWeekly(2, 1, function () {
      self._safeRun('consolidate', function () {
        const r = consolidate(self._store)
        self._lastConsolidate = Date.now()
        self._logger.info('Evolution', 'consolidate: reinforced ' + r.reinforced + ', archived ' + r.archived)
      })
    })

    // 每周日凌晨 3 点 quality-score
    this._scheduleWeekly(3, 0, function () {
      self._safeRun('quality-score', function () {
        const low = batchScoreQuality(self._store)
        self._lastQualityScore = Date.now()
        if (low.length > 0) self._logger.info('Evolution', 'quality-score: ' + low.length + ' below threshold')
      })
    })
  }

  stop() {
    // _timers 里同时装有 setInterval 与 setTimeout 句柄：Node 与浏览器中
    // clearInterval/clearTimeout 底层都是同一个 unref，可互换使用。
    for (const t of this._timers) clearInterval(t)
    this._timers = []
    this._running = false
  }

  triggerDecayCheck() {
    return decayCheck(this._store)
  }

  triggerConsolidate() {
    const r = consolidate(this._store)
    this._lastConsolidate = Date.now()
    return r
  }

  triggerQualityScore() {
    const low = batchScoreQuality(this._store)
    this._lastQualityScore = Date.now()
    return low
  }

  getStatus() {
    return {
      lastDecayCheck: this._lastDecayCheck,
      lastConsolidate: this._lastConsolidate,
      lastQualityScore: this._lastQualityScore,
      running: this._running,
    }
  }

  _safeRun(label, fn) {
    try {
      fn()
    } catch (e) {
      this._logger.warn('Evolution', label + ' failed: ' + (e && e.message ? e.message : String(e)))
    }
  }

  _scheduleWeekly(hour, dayOfWeek, fn) {
    const now = new Date()
    const target = new Date(now)
    target.setHours(hour, 0, 0, 0)
    const daysUntil = (dayOfWeek + 7 - target.getDay()) % 7
    target.setDate(target.getDate() + daysUntil)
    if (target <= now) target.setDate(target.getDate() + 7)
    const delay = target.getTime() - now.getTime()
    const self = this
    // 首跳的 setTimeout 也必须入 _timers：否则 stop() 之后它照样会触发，
    // 并在回调里再挂一个没人回收的 setInterval（孤儿定时器）——周期任务既停不掉，
    // 句柄也会一直挂在事件循环上。
    const kickoff = setTimeout(function () {
      fn()
      self._timers.push(setInterval(fn, 7 * 24 * 3600 * 1000))
    }, delay)
    this._timers.push(kickoff)
    return kickoff
  }
}

module.exports = { KnowledgeEvolutionScheduler }
