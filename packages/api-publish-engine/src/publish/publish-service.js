'use strict'
/**
 * publish-service.js — 双轨发布服务入口装配（W1 §5 服务层收口）
 *
 * 把 §5 四件套组装成一个可直接调用的产品级服务：
 *   getMode（§5.1 apiRouter.getPublishMode 逐平台三态）+ spacer（§5.3 18min 频控）
 *   + publishWithMode 决策执行（§5.2 缝合 decideRoute 与实际执行）+ riskSuspender（§5.4 风控挂起）。
 *
 * apiPublish / getMode 由调用方注入（index.js 传 publishViaApi / apiRouter.getPublishMode），
 * 本模块不 require ./index 或 ./api-router，避免与 index↔api-router 的惰性循环依赖纠缠，
 * 也让单测可用假 apiPublish 零外发驱动整条服务链。
 *
 * domPublish（DOM/RPA 回落执行器）按「每次调用」从 opts.rpaPublish 取，缺省为 undefined →
 * 由 publishWithMode 走 requiresDom 语义（提示上层需要 DOM 能力，而非静默成功）。
 * spacer 与 riskSuspender 为服务级单例（进程内跨调用持久台账）。
 */
const { createPublishWithMode } = require('./core/publish-mode-runner')
const { createPublishSpacer } = require('./core/publish-spacer')
const { createRiskSuspender } = require('./core/risk-suspender')

/**
 * @param {{apiPublish:Function, getMode?:Function, logger?:object,
 *   spacer?:object, riskSuspender?:object, onRiskEvent?:Function}} deps
 */
function createPublishService (deps = {}) {
  const apiPublish = deps.apiPublish
  if (typeof apiPublish !== 'function') {
    throw new Error('publish-service: deps.apiPublish(function) is required')
  }
  const getMode = deps.getMode || (() => undefined)
  const logger = deps.logger
  const spacer = deps.spacer || createPublishSpacer()
  const risk = deps.riskSuspender || createRiskSuspender({ notify: deps.onRiskEvent, logger })

  /**
   * @param {string} platform
   * @param {object} taskData
   * @param {string} cookie
   * @param {{accountId?:string, mode?:string, rpaPublish?:Function, onProgress?:Function}} [opts]
   */
  function publishWithMode (platform, taskData, cookie, opts = {}) {
    const runner = createPublishWithMode({
      apiPublish,
      domPublish: opts.rpaPublish, // 未提供 → runner 归一 requiresDom，不误判成功
      getMode,
      spacer,
      riskSuspender: risk,
      logger,
    })
    return runner(platform, taskData, cookie, opts)
  }

  return {
    publishWithMode: publishWithMode,
    getMode: getMode,
    spacer: spacer,
    risk: risk, // suspend/isSuspended/getSuspension/resume/listSuspended/clear/size
  }
}

module.exports = { createPublishService }
