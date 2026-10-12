/**
 * Identity API 封装 — 调用 Electron IPC（登录态 / 账号切换 / 诊断）
 *
 * M-9 收敛：不再自持 getApi 副本，改走 electron-bridge。
 * 行为保持与旧实现逐字段一致：
 *   - invoke 失败 / preload 缺方法时回 IDENTITY_API_UNAVAILABLE 信封
 *     （invokeWithFallback 的 fallback 即此信封；主进程真返回的错误原样透传）；
 *   - onIdentityStateChanged 无监听能力时返回空取消函数。
 */
import { invokeWithFallback, on } from './electron-bridge'

const UNAVAILABLE = Object.freeze({ code: -1, message: 'IDENTITY_API_UNAVAILABLE' })

export async function identityGetState() {
  return invokeWithFallback('identityGetState', UNAVAILABLE)
}

export async function identitySignIn() {
  return invokeWithFallback('identitySignIn', UNAVAILABLE)
}

export async function identitySwitchAccount() {
  return invokeWithFallback('identitySwitchAccount', UNAVAILABLE)
}

export async function identitySignOut() {
  return invokeWithFallback('identitySignOut', UNAVAILABLE)
}

export async function identityDiagnosticReport() {
  return invokeWithFallback('identityDiagnosticReport', UNAVAILABLE)
}

/**
 * 激活码核销（服务端 POST /api/v1/redeem）。
 *
 * 注意错误码语义：主进程把服务端错误原样放进 `message`
 * （REDEEM_CODE_FORMAT / NOT_FOUND / USED / DISABLED / EXPIRED），
 * 调用方要按 code 判成功、按 message 选文案，两者不能混用。
 */
export async function identityRedeemCode(payload) {
  return invokeWithFallback('identityRedeemCode', UNAVAILABLE, payload)
}

export function onIdentityStateChanged(callback) {
  return on('IdentityStateChanged', callback)
}
