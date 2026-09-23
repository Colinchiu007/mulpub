'use strict'
/**
 * publish-mode.js — 双轨发布模式路由决策核（W1 §5.1/§5.2）
 *
 * 三态总闸（配置驱动，逐平台）：
 *   api-only       仅 API：任何非成功结果都"停报"，不降级
 *   api-then-dom   API 优先：仅"可重试型失败"降级 DOM；风控/登录失效不降级
 *   dom-only       仅 DOM RPA：不进入 API 链
 *
 * API 尝试结果 → 路由决策矩阵。纯函数，无副作用，供执行包装层（§4 链就绪后）
 * 与单测复用。降级判定保守：只有明确"瞬时/未支持"才回落 DOM，
 * 风控与登录失效一律停报（决策账：风控即停不换号、不因换号绕风控）。
 */
const MODES = { apiOnly: 'api-only', apiThenDom: 'api-then-dom', domOnly: 'dom-only' }
const ROUTES = { api: 'api', dom: 'dom', stop: 'stop' }

// reasonCode 与错误码体系语义对齐，供结构化日志 degraded+reasonCode
const REASON = {
  ok: 'ok',
  modeDomOnly: 'mode_dom_only',
  modeUnsupported: 'mode_unsupported_fallback',
  modeTransient: 'transient_error_fallback',
  riskBlocked: 'risk_blocked_stop',
  loginExpired: 'login_expired_stop',
  apiFailedStop: 'api_failed_stop',
}

function normalizeMode (mode) {
  if (mode === undefined || mode === null || mode === '') return MODES.apiThenDom
  const m = String(mode)
  if (!Object.values(MODES).includes(m)) {
    throw new Error('publish-mode: unknown publishMode "' + m + '" (expect ' + Object.values(MODES).join('|') + ')')
  }
  return m
}

/**
 * @param {object} p
 * @param {string} p.mode 归一化前的发布模式
 * @param {string} [p.outcome] API 尝试结果：success|risk_blocked|login_expired|transient_error|unsupported（首次决策可省略）
 * @returns {{mode:string, route:string, degrade:boolean, reasonCode:string}}
 */
function decideRoute (p = {}) {
  const mode = normalizeMode(p.mode)
  const outcome = p.outcome

  // 决策"进入哪条轨"（未执行时）
  if (outcome === undefined) {
    if (mode === MODES.domOnly) return { mode, route: ROUTES.dom, degrade: false, reasonCode: REASON.modeDomOnly }
    return { mode, route: ROUTES.api, degrade: false, reasonCode: REASON.ok }
  }

  if (outcome === 'success') return { mode, route: ROUTES.api, degrade: false, reasonCode: REASON.ok }

  // 风控 / 登录失效：任何模式都停报，不降级、不换号（合规红线）
  if (outcome === 'risk_blocked') return { mode, route: ROUTES.stop, degrade: false, reasonCode: REASON.riskBlocked }
  if (outcome === 'login_expired') return { mode, route: ROUTES.stop, degrade: false, reasonCode: REASON.loginExpired }

  // 可回落 DOM 的失败：unsupported / transient_error
  const fallbackable = outcome === 'unsupported' || outcome === 'transient_error'
  if (mode === MODES.apiOnly) {
    return { mode, route: ROUTES.stop, degrade: false, reasonCode: REASON.apiFailedStop }
  }
  if (mode === MODES.apiThenDom && fallbackable) {
    return {
      mode, route: ROUTES.dom, degrade: true,
      reasonCode: outcome === 'unsupported' ? REASON.modeUnsupported : REASON.modeTransient,
    }
  }
  // 其余（未知失败码）保守停报
  return { mode, route: ROUTES.stop, degrade: false, reasonCode: REASON.apiFailedStop }
}

module.exports = { MODES, ROUTES, REASON, normalizeMode, decideRoute }
