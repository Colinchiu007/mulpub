class BaseAdapter {
  constructor (opts = {}) {
    this.platform = opts.platform || 'unknown'
    this.strategy = opts.strategy || null
    this.rateLimiter = opts.rateLimiter || null
    this.circuitBreaker = opts.circuitBreaker || null
    this.contentCache = opts.contentCache || null
    this.healthMonitor = opts.healthMonitor || null
    this.auditLogger = opts.auditLogger || null
  }

  extractContent (response) { throw new Error('extractContent not implemented') }

  detectBlock (response) {
    if (!response) return { blocked: false }
    if (response.status === 403) return { blocked: true, reason: 'forbidden' }
    if (response.status === 429) return { blocked: true, reason: 'rate_limited' }
    return { blocked: false }
  }

  buildUrl (target) { return target.url || target }

  /**
   * P1-9: 内容是否为空 —— 空内容不得计入采集成功。
   * 桩实现 / 被风控返回空壳 / 无浏览器兜底时返回 `{ body: '' }`，
   * 过去都会上报 success:true，导致"采集成功率 / 健康度 / 熔断"三类指标同时说谎。
   */
  isEmptyContent (content) {
    if (!content) return true
    if (typeof content === 'string') return !content.trim()
    const text = String(content.text || content.desc || '').trim()
    const title = String(content.title || '').trim()
    return !text && !title
  }

  async collect (target, accountId = 'default') {
    const platform = this.platform
    const strategy = this.strategy ? this.strategy.getStrategy(platform, accountId) : {}
    const log = this.auditLogger
    const url = this.buildUrl(target)

    if (this.contentCache && this.contentCache.hasUrl(url)) {
      return { success: true, reason: 'cache_hit', content: null }
    }

    let budgetConsumed = false
    if (this.strategy) {
      const budget = this.strategy.tryConsumeBudget(platform, accountId)
      if (!budget.allowed) {
        if (log) log.blocked(platform, accountId, 'budget_exhausted')
        return { success: false, reason: 'budget_exhausted', content: null }
      }
      budgetConsumed = true
    }

    if (this.rateLimiter) {
      const ev = this.rateLimiter.evaluate({ ...strategy, platform, accountId })
      if (!ev.allowed) {
        if (log) log.blocked(platform, accountId, ev.reason, { waitMs: ev.waitMs })
        if (this.strategy && budgetConsumed) this.strategy.refundBudget(platform, accountId)
        return { success: false, reason: ev.reason, waitMs: ev.waitMs, content: null }
      }
    }

    if (this.circuitBreaker && this.circuitBreaker.isOpen(platform, accountId, strategy.circuitBreaker)) {
      if (log) log.blocked(platform, accountId, 'circuit_open')
      if (this.strategy && budgetConsumed) this.strategy.refundBudget(platform, accountId)
      return { success: false, reason: 'circuit_open', content: null }
    }

    let response
    const startMs = Date.now()
    try {
      response = await this._doFetch(url, strategy)
    } catch (err) {
      if (log) log.error(platform, accountId, err, { url })
      const errReason = (err && (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT')) ? 'timeout' : 'network_error'
      if (this.healthMonitor) this.healthMonitor.record(platform, accountId, { success: false, reason: errReason })
      if (this.circuitBreaker) this.circuitBreaker.recordFailure(platform, accountId, strategy.circuitBreaker)
      if (this.strategy && budgetConsumed) this.strategy.refundBudget(platform, accountId)
      return { success: false, reason: 'error', content: null, error: err.message }
    }
    const durationMs = Date.now() - startMs

    const blockCheck = this.detectBlock(response)
    if (blockCheck.blocked) {
      if (log) log.blocked(platform, accountId, blockCheck.reason, { url, status: response.status })
      if (this.healthMonitor) this.healthMonitor.record(platform, accountId, { success: false, reason: blockCheck.reason })
      if (this.circuitBreaker) this.circuitBreaker.recordFailure(platform, accountId, strategy.circuitBreaker)
      if (this.strategy && budgetConsumed) this.strategy.refundBudget(platform, accountId)
      return { success: false, reason: blockCheck.reason, content: null }
    }

    const content = this.extractContent(response)

    // P1-9: 空壳响应硬约束 —— 记失败 + 退预算 + 计入健康度/熔断，绝不报成功
    if (this.isEmptyContent(content)) {
      if (log) log.blocked(platform, accountId, 'empty_content', { url, status: response.status })
      if (this.healthMonitor) this.healthMonitor.record(platform, accountId, { success: false, reason: 'empty_content' })
      if (this.circuitBreaker) this.circuitBreaker.recordFailure(platform, accountId, strategy.circuitBreaker)
      if (this.strategy && budgetConsumed) this.strategy.refundBudget(platform, accountId)
      return { success: false, reason: 'empty_content', content: null }
    }

    if (this.contentCache && content) {
      this.contentCache.mark(url, String(content.text || content).slice(0, 256), { platform, accountId })
    }
    if (this.rateLimiter) this.rateLimiter.recordRequest(platform, accountId)
    if (this.circuitBreaker) this.circuitBreaker.recordSuccess(platform, accountId)
    if (this.healthMonitor) this.healthMonitor.record(platform, accountId, { success: true })
    if (log) log.request(platform, accountId, url, response.status || 200, durationMs)
    return { success: true, content }
  }

  async _doFetch (url, strategy) { throw new Error('_doFetch not implemented') }
}

module.exports = { BaseAdapter }
