'use strict'
/**
 * 分轨诊断字段：摘取与挂载（router-diag-passthrough，2026-10-21）
 *
 * rpa-view-manager 已在返回对象上写好 track / apiTrackAttempted / apiTrackFailed /
 * publishId（PRD §16.19.4 埋点）。但 publisher-router 的成功/失败分支都重新构造
 * 返回对象，把这些字段丢在半路 ⇒ 历史只剩终态 error，埋点白做。
 *
 * 独立成模块的原因：publisher-router.js 已在 check-max-lines 点名还账清单内
 *（登记 629 行、零增长容差），往里加任何代码都会顶爆门禁。
 *
 * 只摘已知字段，**不透传整个 result**（避免把 cookies/大对象带进历史记录）。
 */

/**
 * @param {object} r rpa-view-manager 的返回对象
 * @returns {object} 仅含存在的诊断字段
 */
function pickDiagFields (r) {
  if (!r || typeof r !== 'object') return {}
  const out = {}
  if (r.track) out.track = String(r.track)
  if (r.apiTrackAttempted !== undefined) out.apiTrackAttempted = r.apiTrackAttempted === true
  if (r.apiTrackFailed) out.apiTrackFailed = r.apiTrackFailed
  if (typeof r.publishId === 'string' && r.publishId.trim()) out.publishId = r.publishId.trim()
  return out
}

/**
 * 把分轨诊断挂到 error 对象上（失败分支用）。
 * 不改变 throw 语义与 error.message，只补字段 —— 上层 task.result 为 null 时，
 * 这些字段是唯一能回答「走了哪条轨、API 轨为何失败」的依据。
 * @param {Error} err
 * @param {object} r rpa-view-manager 的返回对象
 * @returns {Error} 同一个 err（链式）
 */
function attachDiagToError (err, r) {
  if (!err) return err
  try {
    const d = pickDiagFields(r)
    for (const k of Object.keys(d)) err[k] = d[k]
  } catch (_e) { /* 诊断挂载失败不得影响错误抛出 */ }
  return err
}

/**
 * RPA 轨失败 error 的一次性装饰（router-diag-passthrough，2026-10-21）。
 * 合并三个既有装饰动作 + 诊断透传，让 publisher-router 失败分支从
 * 「3 个调用 + 3 段注释」收敛为「1 个调用」—— 该文件在 check-max-lines
 * 点名还账清单内（零增长容差），每一行都在挤压额度。
 *
 * 动作：① markNotSentByResult（publish-precondition-gate 显式标 + 封闭词表兜底）
 *       ② attachRiskSignals（结构化风控信号 code/risk_blocked/login_expired）
 *       ③ 分轨诊断（track/apiTrackAttempted/apiTrackFailed/publishId）
 *
 * 三者都只往 err 上挂字段，**不改变 err.message 与 throw 语义**。
 * @param {Error} err
 * @param {object} result rpa-view-manager 返回对象
 * @returns {Error} 同一个 err
 */
function decorateRpaError (err, result, deps) {
  if (!err) return err
  try {
    if (deps && typeof deps.markNotSentByResult === 'function') deps.markNotSentByResult(err, result)
    if (deps && typeof deps.attachRiskSignals === 'function') deps.attachRiskSignals(err, result)
    attachDiagToError(err, result)
  } catch (_e) { /* 装饰失败不得影响错误抛出 */ }
  return err
}

module.exports = { pickDiagFields, attachDiagToError, decorateRpaError }
