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

module.exports = { pickDiagFields, attachDiagToError }
