'use strict'

/**
 * 判据的**执行体**（把 `plan-capabilities.js` 的纯函数接到 HTTP 请求上下文上）。
 *
 * 单独成文件的原因有两个：
 * 1. `publish-api-server.js` 是零增长挂账文件（债务熔断点名还账），方法体塞进去会当场超目标；
 * 2. 三条入口（即时/批量/定时）本来就要共用同一段逻辑，抽出来后「对称」不再靠注释约束。
 *
 * 两条放行边界（都有单测）：
 * - `provider` 未配置 ⇒ 放行。自建/未接入会员体系的部署不该被可选能力打成 402。
 * - 没有 `businessUser` ⇒ 放行。API-key 等无会员主体的调用方不参与档位判定。
 */

const { checkPlanCapability, capabilityError, resolveLimits } = require('./plan-capabilities')

/**
 * @param {object|null} provider 权益提供器（需有 `getForUser`）
 * @param {object} context `{ auth, businessUser }`
 * @param {object} request 数量请求（`{ platforms, batchSize, cloudAccounts, devices }`）
 * @returns {Promise<boolean>} 恒 true；越界时抛 `capabilityError` 的错误
 */
async function assertPlanCapabilitiesForContext(provider, context, request) {
  if (!provider || typeof provider.getForUser !== 'function') return true
  if (!context || !context.businessUser) return true
  const entitlement = await provider.getForUser(context)
  const violation = checkPlanCapability(entitlement, request)
  if (!violation) return true
  throw capabilityError(violation)
}

/** HTTP 请求形态的薄封装：把 `req.auth.businessUser` 提出成 context。 */
async function assertPlanCapabilitiesForRequest(provider, req, request) {
  const context = {
    auth: req && req.auth,
    businessUser: req && req.auth ? req.auth.businessUser : null,
  }
  return assertPlanCapabilitiesForContext(provider, context, request)
}

module.exports = { assertPlanCapabilitiesForContext, assertPlanCapabilitiesForRequest, resolveDeviceLimit, registerDeviceSession }
/**
 * 读出该用户当前档位的设备数上限（PRD N1 的执行点用）。
 * 与 `assertPlanCapabilitiesForContext` 共用「provider 缺失 / 无 businessUser ⇒ 放行」两条边界：
 * 这里用 `null` 表达「不限」，让存储层不必理解会员体系。
 *
 * @returns {Promise<number|null>}
 */
async function resolveDeviceLimit(provider, context) {
  if (!provider || typeof provider.getForUser !== 'function') return null
  if (!context || !context.businessUser) return null
  const entitlement = await provider.getForUser(context)
  return resolveLimits(entitlement).limits.max_devices
}
/**
 * 设备会话登记 + 上限判定（PRD N1 的执行体）。
 *
 * 放在这里而不是 `publish-api-server.js`：后者是零增长挂账文件，而这段逻辑需要
 * try/catch + 两条分支；抽出来后调用点只剩一次赋值，也让「超限不是失败、只是未被授权」
 * 这条语义有唯一落点。
 *
 * @returns {Promise<{reached: boolean, limit: number}|null>} 超限时返回提示对象，否则 null
 */
async function registerDeviceSession({ provider, repository, context, deviceId, deviceName = null, onWarn }) {
  try {
    const maxDevices = await resolveDeviceLimit(provider, context)
    await repository.upsertSession({ userId: context.businessUser.id, deviceId, deviceName, maxDevices })
    return null
  } catch (error) {
    if (error && error.code === 'DEVICE_LIMIT_EXCEEDED') return { reached: true, limit: error.limit }
    if (typeof onWarn === 'function') onWarn(error)
    return null
  }
}