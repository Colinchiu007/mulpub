/**
 * login-status-hints.js —— 登录态「未确认/失败」的用户可执行提示映射（2026-10-17）
 *
 * 为什么需要：主进程的 checkLoginStatus 一直带 `reason`（细到"为什么没定论"），
 * 但渲染端只拿到 `code`，未确认时一律显示「未能确认登录状态：本轮检测未取到定论」——
 * 用户看完不知道该做什么。参考产品B（CEF 壳）把平台错误码翻译成可执行提示
 * （2190008 →「授权失效,请重新授权」、100437 →「无法获取私密账号数据」），
 * 见 01-docs/REVERSE-REFERENCE-PRODUCT-B-CEF-ACCOUNT-2026-10-17.md §4.2。
 *
 * 三条不可破：
 * ① **只解释、不改判**：本模块只产出"给用户看的解释与下一步动作"，
 *    绝不参与 valid 的三态判定（判定逻辑全在 account-manager.js）。
 * ② **未知码一律回落通用文案**：宁可不具体，也不许编一个动作让用户白做。
 * ③ **不新增文案字面量到渲染端**：这里给的是 locales 键名，中文案由 zh/en 成对提供。
 *
 * @typedef {Object} LoginHint
 * @property {string} key - locales 键名（形如 accountsPage.checkHints.xxx）
 * @property {string} fallback - 主进程侧兜底文本（locales 缺失时使用）
 * @property {'retry'|'relogin'|'wait'|'contact'|'none'} action - 建议动作分类（供聚合统计）
 */

/** 未确认（valid===undefined）各 reason 的提示 */
const REASON_HINTS = {
  'no-cookie': {
    key: 'accountsPage.checkHints.noCookie',
    fallback: '未检测到已保存的登录凭证，请重新登录该平台账号',
    action: 'relogin'
  },
  'credential-file-only': {
    key: 'accountsPage.checkHints.credentialFileOnly',
    fallback: '只找到历史凭证文件、没有可用 Cookie，登录状态无法确认，请重新登录',
    action: 'relogin'
  },
  'http-check-inconclusive': {
    key: 'accountsPage.checkHints.httpCheckInconclusive',
    fallback: '平台接口未给出明确结论（可能正在风控或改版），请稍后重试',
    action: 'retry'
  },
  'render-crash-prone-http-inconclusive': {
    key: 'accountsPage.checkHints.renderCrashProne',
    fallback: '该平台无法用接口判定且不能开窗检测，请重新登录以恢复确定结论',
    action: 'relogin'
  },
  'hidden-browser-disabled-default': {
    key: 'accountsPage.checkHints.hiddenBrowserDisabled',
    fallback: '该平台当前只用接口判定登录态，未取到定论，请重新登录',
    action: 'relogin'
  },
  'no-positive-evidence': {
    key: 'accountsPage.checkHints.noPositiveEvidence',
    fallback: '页面既没有登录特征也没有登出特征，无法判定，请重新登录',
    action: 'relogin'
  },
  'browser-check-failed': {
    key: 'accountsPage.checkHints.browserCheckFailed',
    fallback: '页面检测自身失败（超时或被拦截），请稍后重试',
    action: 'retry'
  },
  'dom-check-process-died': {
    key: 'accountsPage.checkHints.domCheckProcessDied',
    fallback: '页面检测进程已退出，本次未取到定论，请稍后重试',
    action: 'retry'
  }
}

/** 确定结论与错误码的提示（失效/失败也要说清"为什么"） */
const CODE_HINTS = {
  CHECK_LOGIN_NO_CREDENTIAL: {
    key: 'accountsPage.checkHints.noCredential',
    fallback: '没有可用登录凭证，请添加或重新登录该账号',
    action: 'relogin'
  },
  CHECK_LOGIN_COOKIE_EXPIRED: {
    key: 'accountsPage.checkHints.cookieExpired',
    fallback: '登录已失效（Cookie 过期或被平台踢下线），请重新登录',
    action: 'relogin'
  },
  CHECK_LOGIN_HTTP_TIMEOUT: {
    key: 'accountsPage.checkHints.httpTimeout',
    fallback: '平台接口响应超时，请稍后重试',
    action: 'retry'
  },
  CHECK_LOGIN_HTTP_ERROR: {
    key: 'accountsPage.checkHints.httpError',
    fallback: '平台接口返回异常，请稍后重试',
    action: 'retry'
  },
  CHECK_LOGIN_TIMEOUT: {
    key: 'accountsPage.checkHints.timeout',
    fallback: '检测超时，请稍后重试',
    action: 'retry'
  },
  CHECK_LOGIN_LOCK_TIMEOUT: {
    key: 'accountsPage.checkHints.lockTimeout',
    fallback: '上一次检测仍在进行，本次未执行，请稍后重试',
    action: 'retry'
  },
  CHECK_LOGIN_ERROR: {
    key: 'accountsPage.checkHints.error',
    fallback: '检测过程出错，请稍后重试',
    action: 'retry'
  },
  CHECK_LOGIN_FAILED: {
    key: 'accountsPage.checkHints.failed',
    fallback: '登录状态检查失败，请稍后重试',
    action: 'retry'
  },
  CHECK_LOGIN_UNSUPPORTED_PLATFORM: {
    key: 'accountsPage.checkHints.unsupportedPlatform',
    fallback: '该平台暂不支持登录态检测，请手动打开平台确认',
    action: 'none'
  }
  // ⚠️ 不登记 CHECK_LOGIN_INVALID_PARAMS：那是**调用方传错参数**（开发缺陷），
  // 不是用户能处理的状态。给它配"请联系支持"只会把 bug 包装成产品提示；
  // 正确做法是让日志与测试暴露它，UI 回落通用文案。
}

/**
 * 取一条登录态提示。
 *
 * 判定优先级：`reason`（最细）→ `code`（其次）→ null（调用方回落通用文案）。
 * 这样做的原因：`CHECK_LOGIN_INCONCLUSIVE` 一个码下面挂着 9 种 reason，
 * 只按 code 给提示等于把"网络错误可重试"和"要重新登录"混成一句。
 *
 * @param {{code?:string, reason?:string, valid?:boolean|undefined}} status
 * @returns {LoginHint|null}
 */
function hintForLoginStatus (status) {
  if (!status || typeof status !== 'object') return null
  const reason = typeof status.reason === 'string' ? status.reason : ''
  if (reason && Object.prototype.hasOwnProperty.call(REASON_HINTS, reason)) {
    return REASON_HINTS[reason]
  }
  const code = typeof status.code === 'string' ? status.code : ''
  if (code && Object.prototype.hasOwnProperty.call(CODE_HINTS, code)) {
    return CODE_HINTS[code]
  }
  return null
}

/**
 * 把一组账号的提示按 action 聚合，供批量检测的汇总行使用。
 * @param {Array<{hint?:LoginHint|null}>} items
 * @returns {{relogin:number, retry:number, wait:number, contact:number, none:number, unknown:number}}
 */
function summarizeHintActions (items) {
  const out = { relogin: 0, retry: 0, wait: 0, contact: 0, none: 0, unknown: 0 }
  if (!Array.isArray(items)) return out
  for (const item of items) {
    const action = item && item.hint && typeof item.hint.action === 'string' ? item.hint.action : ''
    if (action && Object.prototype.hasOwnProperty.call(out, action)) out[action]++
    else out.unknown++
  }
  return out
}

module.exports = {
  REASON_HINTS,
  CODE_HINTS,
  hintForLoginStatus,
  summarizeHintActions
}
