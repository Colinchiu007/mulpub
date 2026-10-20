'use strict'

/**
 * 档位能力的**服务端**判据（v2.2 / PRD N7 与 N8 的落地）。
 *
 * 为什么需要这一层：客户端 `features/member/plan-limits.js` 只是**软提示**——
 * 它拦得住 UI 上的「第 6 个平台」，拦不住直接打 API 的调用方（脚本/旧客户端/抓包重放）。
 * 服务端此前只校验 `cloud_publish` 这一个 feature，`max_platforms` / `batch_size_per_run`
 * 这类**数量型上限**从未被读取，等于把「免费档 5 平台」写成了一张空头承诺。
 *
 * 三条纪律（与客户端同源，避免两侧语义漂移）：
 * 1. **缺失即放行**：`limits` 不存在、键缺失、值非数字 ⇒ 不拦。旧快照没有这些字段，
 *    若按 0 处理会把全体存量用户挡在门外（这正是 `Number('') === 0` 那类反向静默故障）。
 * 2. **-1 是不限**：与 `plan-matrix.js` 的 `UNLIMITED_ALLOWED` 同一语义。
 * 3. **只判上限，不判下限**：数量型上限的比较是 `count > limit`，边界值本身合法
 *    （免费档 5 个平台 ⇒ 第 5 个允许、第 6 个拒绝）。
 */

/** 上限键 → 违约码。顺序即判定优先级（先报最贴近用户动作的那条）。 */
const CAPABILITY_RULES = Object.freeze([
  { key: 'max_platforms', input: 'platforms', code: 'PLATFORM_LIMIT_EXCEEDED', status: 402, label: '平台数' },
  { key: 'batch_size_per_run', input: 'batchSize', code: 'BATCH_SIZE_EXCEEDED', status: 402, label: '单次批量' },
  { key: 'max_cloud_accounts', input: 'cloudAccounts', code: 'CLOUD_ACCOUNT_LIMIT_EXCEEDED', status: 402, label: '云账号数' },
  { key: 'max_devices', input: 'devices', code: 'DEVICE_LIMIT_EXCEEDED', status: 403, label: '设备数' },
])

/** 把任意来源的值收敛成「数字上限」或 `null`（= 无信息 = 不限）。 */
function toLimit(raw) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0) return null
  return value
}

/**
 * 从 entitlement payload 读出各项上限。
 * @param {object|null|undefined} entitlement 权益快照（含 `limits` 段）
 * @returns {{limits: object, present: boolean}} `present=false` 表示这份快照没有任何数量上限信息
 */
function resolveLimits(entitlement) {
  const source = entitlement && typeof entitlement === 'object' && !Array.isArray(entitlement)
    && entitlement.limits && typeof entitlement.limits === 'object' && !Array.isArray(entitlement.limits)
    ? entitlement.limits
    : null
  const limits = {}
  let present = false
  for (const rule of CAPABILITY_RULES) {
    const limit = source ? toLimit(source[rule.key]) : null
    limits[rule.key] = limit
    if (limit !== null) present = true
  }
  return { limits, present }
}

/**
 * 判定一组请求是否越过档位上限。
 * @param {object|null|undefined} entitlement 权益快照
 * @param {object} request 请求量（只判传入的键，未传的键不判）
 * @returns {null|{code: string, status: number, key: string, limit: number, requested: number, label: string}}
 */
function checkPlanCapability(entitlement, request) {
  const caps = request && typeof request === 'object' ? request : {}
  const { limits } = resolveLimits(entitlement)
  for (const rule of CAPABILITY_RULES) {
    const limit = limits[rule.key]
    if (limit === null) continue
    const requested = Number(caps[rule.input])
    // 未提供该项 / 非有限数 ⇒ 不判（调用方没问，或数据源缺失）
    if (!Number.isFinite(requested)) continue
    if (requested > limit) {
      return {
        code: rule.code,
        status: rule.status,
        key: rule.key,
        limit,
        requested,
        label: rule.label,
      }
    }
  }
  return null
}

/** 违约 → 可抛出的错误对象（HTTP 层用 `status` / `code` 直出）。 */
function capabilityError(violation) {
  if (!violation) return null
  return Object.assign(new Error(violation.code), {
    code: violation.code,
    status: violation.status,
    limit: violation.limit,
    requested: violation.requested,
  })
}

module.exports = {
  CAPABILITY_RULES,
  resolveLimits,
  checkPlanCapability,
  capabilityError,
}
