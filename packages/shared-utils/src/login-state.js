'use strict'
/**
 * 登录态单向证据规则（唯一口径）。
 *
 * 为什么单独成模块：同一个「检测三态 + 真源现状 → 要不要改写真源」的判定此前被抄了三份
 * （account-manager 的 loginStatusFromCheckResult、ipc-handlers/account.js 的
 * loginStatusFromCheck、login-status-monitor 的 _loginStatusOf），三处都把「无定论」映射成
 * `unverified`，于是任何一处的修正都不会自动传导到另外两处 —— 这正是振荡能活下来的机制。
 *
 * 规则：登录态真源只被**正向**（检测有效）或**负向**（检测明确失效）证据改写。
 * 「没拿到新证据」（无定论 / 检测自身异常 / 硬超时）既不是正向也不是负向，MUST NOT 被当成
 * 反证去覆盖既有结论；同时用超龄兜底避免「已失效却永远显示已登录」的僵尸绿灯。
 */

/** 「无定论时保持原状」的默认宽限期（天）。 */
const DEFAULT_GRACE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000
const LOGIN_STATUSES = ['active', 'expired', 'unverified']

/**
 * 宽限期毫秒数。非法值（0 / 负数 / 非数字 / 空）一律回落默认，
 * 避免出现「零宽限 → 每轮都降级」或「Infinity → 永不降级」两种更糟的极端。
 * @param {string|number} [raw] 便于测试注入；缺省读 process.env
 * @returns {number}
 */
function resolveLoginGraceMs (raw) {
  const value = raw === undefined ? process.env.MP_LOGIN_STATE_GRACE_DAYS : raw
  const days = Number(value)
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_GRACE_DAYS * DAY_MS
  return days * DAY_MS
}

/**
 * 检测结论 + 当前真源 → 应写入的登录态；返回 `null` 表示**本轮不改写真源**。
 *
 * 纯函数：除 `resolveLoginGraceMs` 可能读一次环境变量外不碰任何全局状态，不做 I/O；
 * 当前时刻由 `nowMs` 注入，便于假时钟回归。
 *
 * @param {object} args
 * @param {any} [args.result] `checkLoginStatus` 的三态返回（valid: true / false / undefined）
 * @param {string} [args.checkError] 检测自身抛出的异常信息（属「无证据」，不是失效证据）
 * @param {string} [args.currentStatus] 真源当前登录态（active / expired / unverified / 缺失）
 * @param {string} [args.lastValidated] 真源最近一次定论时间（ISO）
 * @param {number} [args.nowMs] 注入的当前时刻（毫秒）
 * @param {number} [args.graceMs] 覆盖宽限期（毫秒，测试用）
 * @param {string|number} [args.graceDaysRaw] 覆盖宽限期环境变量（测试用）
 * @returns {'active'|'expired'|'unverified'|null}
 */
function loginStatusTransition (args) {
  const { result, checkError, currentStatus, lastValidated, nowMs, graceMs, graceDaysRaw } = args || {}

  // 正向 / 负向证据：一律改写，不受现状与超龄影响
  if (!checkError && result && result.valid === true) return 'active'
  if (!checkError && result && result.valid === false) return 'expired'

  // 走到这里 = 本轮无定论
  // expired 已是粘滞态（监控原本就不擅自翻案），缺证据时保持。
  if (currentStatus === 'expired') return null
  // 「从未有结论」以及历史脏值（inactive/offline 等）都必须继续诚实呈现为 unverified，
  // 不得因为「保持原状」而被冒充成已有结论。
  if (currentStatus !== 'active') return 'unverified'

  const grace = Number.isFinite(graceMs) && graceMs > 0 ? graceMs : resolveLoginGraceMs(graceDaysRaw)
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const at = Date.parse(lastValidated)
  // active 却拿不到定论时间 = 无从判断新鲜度，按超龄处理（宁可降级也不做无限期乐观）
  if (!Number.isFinite(at)) return 'unverified'
  return (now - at) > grace ? 'unverified' : null
}

module.exports = {
  DEFAULT_GRACE_DAYS,
  LOGIN_STATUSES,
  loginStatusTransition,
  resolveLoginGraceMs,
}
