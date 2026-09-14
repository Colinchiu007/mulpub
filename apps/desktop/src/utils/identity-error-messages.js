// @ts-check
/**
 * identity-error-messages.js — 身份错误码 → 提示文案 key 的唯一映射（渲染层共享）
 *
 * 背景（2026-09-14 缺陷）：`ProfileMenu.vue` 与 `MemberCenter.vue` 各自维护一份不完整的
 * 错误码映射表，且 fallback 一律落到 `memberCenter.signOutFailed`（「退出失败，当前登录
 * 仍然有效。」）。于是**点击登录失败时**面板显示的是「退出失败」，语义完全相反；
 * 又因为状态机把清理错误当成主错误（`throw cleanupError || identityError`），
 * 前端拿到的码几乎总是不在映射表里，必然走 fallback。
 *
 * 本模块集中维护映射，并要求：
 *  1. 登录类、退出类、会话存储类错误必须给出各自的文案，禁止再共用 signOutFailed；
 *  2. 未知错误码回落到中性文案 `memberCenter.operationFailed`（不是退出失败）；
 *  3. 新增错误码时只需在这里登记 + 在 locales 里补 zh/en 词条。
 */

/** 错误码 → i18n key（memberCenter 命名空间）。 */
export const IDENTITY_ERROR_MESSAGE_KEYS = Object.freeze({
  // —— 身份服务可用性 ——
  IDENTITY_API_UNAVAILABLE: 'memberCenter.identityDisabledHint',
  IDENTITY_NOT_CONFIGURED: 'memberCenter.identityDisabledHint',
  IDENTITY_CONFIG_INVALID: 'memberCenter.identityServiceUnavailable',
  IDENTITY_SDK_INVALID: 'memberCenter.identityServiceUnavailable',
  IDENTITY_FETCH_UNAVAILABLE: 'memberCenter.identityServiceUnavailable',
  IDENTITY_LOAD_FAILED: 'memberCenter.identityLoadFailed',
  IDENTITY_TOKEN_UNAVAILABLE: 'memberCenter.identityServiceUnavailable',
  IDENTITY_OPERATION_FAILED: 'memberCenter.operationFailed',
  IDENTITY_DISPOSE_FAILED: 'memberCenter.operationFailed',

  // —— 登录 ——
  IDENTITY_SIGN_IN_FAILED: 'memberCenter.loginFailed',
  IDENTITY_SIGN_IN_CANCELLED: 'memberCenter.loginCancelled',
  IDENTITY_SIGN_IN_IN_PROGRESS: 'memberCenter.loginInProgress',
  IDENTITY_CALLBACK_TIMEOUT: 'memberCenter.loginTimeout',
  IDENTITY_CALLBACK_STATE_INVALID: 'memberCenter.loginCallbackFailed',
  IDENTITY_CALLBACK_PORT_UNAVAILABLE: 'memberCenter.loginCallbackFailed',
  IDENTITY_CALLBACK_ALREADY_STARTED: 'memberCenter.loginCallbackFailed',
  IDENTITY_AUTH_WINDOW_LOAD_FAILED: 'memberCenter.loginWindowFailed',
  IDENTITY_AUTH_WINDOW_NAVIGATION_BLOCKED: 'memberCenter.loginWindowFailed',
  IDENTITY_AUTH_WINDOW_URL_INVALID: 'memberCenter.loginWindowFailed',
  IDENTITY_ACCOUNT_SWITCH_REQUIRED: 'memberCenter.switchAccountRequired',

  // —— 账号切换 / 退出 ——
  IDENTITY_ACCOUNT_SWITCH_FAILED: 'memberCenter.switchFailed',
  IDENTITY_SIGN_OUT_FAILED: 'memberCenter.signOutFailed',
  IDENTITY_OPERATION_IN_PROGRESS: 'memberCenter.operationInProgress',

  // —— 会话与本地安全存储 ——
  IDENTITY_SESSION_EXPIRED: 'memberCenter.statusExpired',
  IDENTITY_SESSION_INVALID: 'memberCenter.sessionInvalid',
  IDENTITY_SESSION_CLEAR_FAILED: 'memberCenter.sessionStoreBlocked',
  IDENTITY_SECURE_STORAGE_UNAVAILABLE: 'memberCenter.secureStorageUnavailable',
  IDENTITY_AUTH_WINDOW_SESSION_CLEAR_FAILED: 'memberCenter.sessionStoreBlocked',

  // —— 网络 ——
  IDENTITY_NETWORK_UNAVAILABLE: 'memberCenter.networkUnavailable',
})

/** 未知错误码的回落文案（中性、不误导）。 */
export const IDENTITY_ERROR_FALLBACK_KEY = 'memberCenter.operationFailed'

/**
 * 解析错误码对应的文案 key。
 * @param {unknown} code
 * @returns {string}
 */
export function resolveIdentityErrorMessageKey(code) {
  if (typeof code !== 'string' || !code) return IDENTITY_ERROR_FALLBACK_KEY
  return IDENTITY_ERROR_MESSAGE_KEYS[code] || IDENTITY_ERROR_FALLBACK_KEY
}

/**
 * 未登录态下「状态副标题」的文案 key。
 * 说明：面板副标题只在未登录分支渲染，因此 error 分支只需一句可重试提示，
 * 与下方 `errorMessage` 的详细原因区分，避免同一句话重复出现两次。
 * @param {unknown} status
 * @returns {string}
 */
export function resolveIdentityStatusNoteKey(status) {
  if (status === 'disabled') return 'memberCenter.identityDisabledHint'
  if (status === 'expired') return 'memberCenter.statusExpired'
  if (status === 'error') return 'memberCenter.retryHint'
  return 'memberCenter.notLoggedInHint'
}
