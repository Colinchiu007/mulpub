// @ts-check
/**
 * auth-diagnostics.js — 身份失败判定与诊断输出的纯函数集合
 *
 * 从 `auth-service.js` 抽出（2026-09-14）：该文件已接近 500 行债务阈值，
 * 而这些函数彼此独立、无状态、可单独测试，抽出后 auth-service 只保留状态机。
 *
 * 为什么需要诊断输出：2026-09-14 的登录事故中，状态机只保留了「清理失败」，
 * 真正的失败原因（宿主 safe-delete shim 拦截 `fs.unlink`）被完全吞掉，
 * 现场只能靠猜，排查耗时以小时计。凡失败分支都应落 `scope + code + cause 链`。
 */

/**
 * 汇总错误对象及其 cause 链上的 code/message（小写），用于关键字判定。
 * @param {unknown} error
 * @returns {string}
 */
function errorSignals(error) {
  const values = []
  let current = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current.code) values.push(String(current.code).toLowerCase())
    if (current.message) values.push(String(current.message).toLowerCase())
    current = current.cause
  }
  return values.join(' ')
}

/**
 * 是否可判定为网络类失败（决定「离线宽限」与「保留本地凭证」）。
 * @param {unknown} error
 * @returns {boolean}
 */
function isNetworkError(error) {
  const value = errorSignals(error)
  return ['network', 'fetch failed', 'econnreset', 'econnrefused', 'enotfound', 'eai_again', 'etimedout', 'timeout']
    .some((signal) => value.includes(signal))
}

/**
 * 是否可判定为「服务端明确拒绝会话」（决定是否清理本地凭证）。
 * @param {unknown} error
 * @returns {boolean}
 */
function isSessionRejected(error) {
  const value = errorSignals(error)
  return ['invalid_grant', 'not_authenticated', 'token_revoked', 'session_expired']
    .some((signal) => value.includes(signal))
}

/**
 * ID Token 是否已过期。
 * @param {{ exp?: number } | null | undefined} claims
 * @param {number} now
 * @returns {boolean}
 */
function claimsExpired(claims, now) {
  return Boolean(claims && Number.isFinite(claims.exp) && claims.exp <= now)
}

/**
 * 生成可读的 cause 链描述，如 `IDENTITY_SIGN_IN_FAILED: 登录失败 <- Error: unlink denied`。
 * @param {unknown} error
 * @param {number} [maxDepth]
 * @returns {string}
 */
function describeErrorChain(error, maxDepth = 5) {
  const chain = []
  let current = error
  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    const code = current.code || current.name || 'Error'
    chain.push(code + ': ' + (current.message || ''))
    current = current.cause
  }
  return chain.join(' <- ')
}

/**
 * 落一条身份失败诊断日志。日志失败绝不影响身份流程本身。
 * @param {{ warn?: (module: string, message: string, meta?: unknown) => void } | null} logger
 * @param {string} scope
 * @param {unknown} error
 * @param {Record<string, unknown>} [extra]
 */
function logIdentityFailure(logger, scope, error, extra = {}) {
  if (!logger || typeof logger.warn !== 'function') return
  try {
    logger.warn('Identity', scope + ' failed: ' + describeErrorChain(error), extra)
  } catch { /* 日志失败不影响身份流程 */ }
}

module.exports = {
  errorSignals,
  isNetworkError,
  isSessionRejected,
  claimsExpired,
  describeErrorChain,
  logIdentityFailure,
}
