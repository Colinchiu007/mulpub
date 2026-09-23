'use strict'
/**
 * publish-mode-runner.js — 双轨发布服务层执行包装（W1 §5.2）
 *
 * 把 §5.1 决策核（publish-mode.decideRoute，纯函数）与「实际执行」缝合：
 *   读发布模式 → spacer 频控闸门（§5.3）→ 跑 API 链 → 结果归一为 outcome →
 *   再决策 → 可降级则回落 DOM、风控/登录失效一律停报（不降级、不换号，合规红线）→
 *   结构化日志 {degraded, reasonCode}。
 *
 * 纯编排：apiPublish / domPublish / spacer / logger 全注入，测试用假发布者，零外发。
 * 与旧 api-router.publishWithFallback 的区别：后者非模式驱动、风控也会回落；本包装
 * 严格遵循三态总闸 + 风控即停语义，是 §5 服务层的事实路由。
 */
const { decideRoute, normalizeMode, ROUTES, REASON } = require('./publish-mode')

const RISK_RE = /风控|risk|滑块|601|10000015|frequent|频繁|verify|验证/i
const LOGIN_RE = /登录|未登录|登陆|cookie.*(expired|失效|过期)|login|session|auth.*(fail|expired)|未授权/i
const UNSUPPORTED_RE = /unsupported|not.?supported|暂不支持|无.?api|no.?api/i

/** API/DOM 结果对象 → publish-mode outcome 字符串。*/
function outcomeOfResult (res) {
  if (res == null) return 'transient_error'
  if (res.success) return 'success'
  if (res.riskBlocked || res.risk_blocked) return 'risk_blocked'
  if (res.loginExpired || res.login_expired) return 'login_expired'
  if (res.unsupported) return 'unsupported'
  const code = res.code != null ? res.code : (res.result && res.result.code)
  if (code === 'BILI_RISK_601' || code === 10000015 || code === -1e7) return 'risk_blocked'
  const msg = String(res.error || res.errMsg || res.message || '')
  if (RISK_RE.test(msg)) return 'risk_blocked'
  if (LOGIN_RE.test(msg)) return 'login_expired'
  if (UNSUPPORTED_RE.test(msg)) return 'unsupported'
  return 'transient_error'
}

/**
 * @param {{apiPublish?:Function, domPublish?:Function, getMode?:Function,
 *   spacer?:{tryAcquire:Function}, logger?:{info:Function,warn:Function,error:Function},
 *   outcomeOf?:Function, riskSuspender?:{suspend:Function,isSuspended:Function}}} deps
 */
function createPublishWithMode (deps = {}) {
  const apiPublish = deps.apiPublish
  const domPublish = deps.domPublish
  const getMode = deps.getMode || (() => undefined)
  const spacer = deps.spacer || null
  const logger = deps.logger || require('../../logger')
  const outcomeOf = deps.outcomeOf || outcomeOfResult
  const riskSuspender = deps.riskSuspender || null

  const callDom = (platform, taskData, cookie, opts) => {
    if (typeof domPublish !== 'function') return null
    return domPublish(platform, taskData, cookie, opts)
  }

  /**
   * @param {string} platform
   * @param {object} taskData
   * @param {string} cookie
   * @param {{accountId?:string, mode?:string, onProgress?:Function}} [opts]
   * @returns {Promise<object>} 归一发布结果
   */
  async function publishWithMode (platform, taskData, cookie, opts = {}) {
    const mode = normalizeMode(opts.mode != null ? opts.mode : getMode(platform))
    const accountId = opts.accountId || (cookie ? String(cookie).slice(0, 16) : 'default')
    const base = { platform, mode, degraded: false, reasonCode: REASON.ok }

    // —— §5.4 风控挂起守卫：平台/账号处于挂起态则直接停，不进任何轨、零请求 ——
    if (riskSuspender && typeof riskSuspender.isSuspended === 'function' && riskSuspender.isSuspended(platform, accountId)) {
      logger.warn('publish-mode', 'skipped (risk-suspended)', { platform, mode, accountId, reasonCode: 'risk_suspended' })
      return Object.assign(base, { track: 'suspended', success: false, stopped: true, reasonCode: 'risk_suspended' })
    }

    const entry = decideRoute({ mode })

    // —— dom-only 轨：不进入 API ——
    if (entry.route === ROUTES.dom) {
      if (spacer) {
        const gate = spacer.tryAcquire(platform, accountId)
        if (!gate.allow) {
          const r = Object.assign(base, { track: 'throttled', success: false, reasonCode: 'throttled', waitMs: gate.waitMs })
          logger.warn('publish-mode', 'throttled (dom-only)', { platform, mode, accountId, reasonCode: 'throttled', waitMs: gate.waitMs })
          return r
        }
      }
      if (!domPublish) {
        return Object.assign(base, { track: 'dom', success: false, requiresDom: true, reasonCode: REASON.modeDomOnly })
      }
      const domRes = await domPublish(platform, taskData, cookie, opts)
      return Object.assign(base, {
        track: 'dom', reasonCode: REASON.modeDomOnly,
        success: !!(domRes && domRes.success), publishId: domRes && domRes.publishId,
        error: domRes && domRes.error, code: domRes && domRes.code, domAttempt: domRes,
      })
    }

    // —— api 轨（api-only / api-then-dom 首先进入）——
    if (typeof apiPublish !== 'function') {
      // 无 API 执行器：api-only 停报；api-then-dom 视场景回落 DOM
      const outcome = 'unsupported'
      const d = decideRoute({ mode, outcome })
      if (d.degrade && domPublish) return degradeToDom(base, d, platform, taskData, cookie, opts, { error: 'no api publisher available' })
      return Object.assign(base, { track: 'api', success: false, reasonCode: d.reasonCode, error: 'no api publisher available' })
    }

    if (spacer) {
      const gate = spacer.tryAcquire(platform, accountId)
      if (!gate.allow) {
        const r = Object.assign(base, { track: 'throttled', success: false, reasonCode: 'throttled', waitMs: gate.waitMs })
        logger.warn('publish-mode', 'throttled (api)', { platform, mode, accountId, reasonCode: 'throttled', waitMs: gate.waitMs })
        return r
      }
    }

    let apiRes
    try {
      apiRes = await apiPublish(platform, taskData, cookie, opts)
    } catch (err) {
      apiRes = { success: false, error: err && err.message, code: err && err.code }
    }
    const outcome = outcomeOf(apiRes)
    const d = decideRoute({ mode, outcome })
    const apiAttempt = Object.assign({}, apiRes, { outcome })

    if (d.route === ROUTES.api) { // success 留 API
      logger.info('publish-mode', 'api success', { platform, mode, accountId, reasonCode: REASON.ok, publishId: apiRes && apiRes.publishId })
      return Object.assign(base, { track: 'api', success: true, reasonCode: REASON.ok, publishId: apiRes && apiRes.publishId, apiAttempt })
    }

    if (d.route === ROUTES.stop) { // 风控/登录/api-only 失败：停报，不降级
      if (outcome === 'risk_blocked' && riskSuspender && typeof riskSuspender.suspend === 'function') {
        riskSuspender.suspend(platform, accountId, { reason: REASON.riskBlocked, error: apiRes && apiRes.error })
      }
      logger.error('publish-mode', 'stopped (no degrade)', { platform, mode, accountId, outcome, reasonCode: d.reasonCode, error: apiRes && apiRes.error })
      return Object.assign(base, { track: 'api', success: false, reasonCode: d.reasonCode, stopped: true, error: apiRes && apiRes.error, code: apiRes && apiRes.code, apiAttempt })
    }

    // d.degrade → 回落 DOM（api-then-dom + transient/unsupported）
    return degradeToDom(base, d, platform, taskData, cookie, opts, { apiAttempt, apiError: apiRes && apiRes.error })
  }

  async function degradeToDom (base, d, platform, taskData, cookie, opts, extra) {
    logger.warn('publish-mode', 'degraded to dom', {
      platform, mode: base.mode, accountId: opts.accountId || '(derived)',
      degraded: true, reasonCode: d.reasonCode, error: extra.apiError || extra.error,
    })
    if (!domPublish) {
      return Object.assign({}, base, {
        track: 'api', success: false, degraded: true, requiresDom: true, reasonCode: d.reasonCode,
        error: (extra.apiError || 'api failed') + ' | DOM publisher not provided', apiAttempt: extra.apiAttempt,
      })
    }
    const domRes = await callDom(platform, taskData, cookie, opts)
    return Object.assign({}, base, {
      track: 'dom', degraded: true, reasonCode: d.reasonCode,
      success: !!(domRes && domRes.success), publishId: domRes && domRes.publishId,
      error: domRes && domRes.error, code: domRes && domRes.code,
      apiAttempt: extra.apiAttempt, domAttempt: domRes,
    })
  }

  return publishWithMode
}

module.exports = { createPublishWithMode, outcomeOfResult }
