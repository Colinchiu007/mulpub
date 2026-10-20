'use strict'

/**
 * `grant` 的幂等支撑（PRD N9）。
 *
 * 抽成独立模块有两个原因：① `subscription-service.js` 已逼近 500 行硬限（逐文件行数门禁），
 * 幂等分支塞进去会把一份 487 行的文件推成「新增超大文件」；② 这两个纯函数可以被单测直接钉住，
 * 不必起整个服务。
 */

/**
 * 归一化幂等入参。
 * - 只认非空字符串（空串/非字符串视为未提供，避免把 undefined 拼进 UNIQUE 列）；
 * - 幂等键与显式 `providerReference` 同时给 ⇒ 无法解释「撞的是哪一个」，调用方应 fail closed。
 *
 * @returns {{idem: string|null, conflict: boolean}}
 */
function normalizeGrantIdempotency({ idempotencyKey = null, providerReference = null } = {}) {
  const idem = typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : null
  return { idem, conflict: idem !== null && Boolean(providerReference) }
}

/** 幂等键 → 确定性 provider_reference（该列 UNIQUE，第二次同 key 必然撞约束）。 */
function idempotentProviderReference(operator, idem) {
  return `grant:${operator || 'system'}:idem:${idem}`
}

/**
 * 撞 UNIQUE 后的重放视图：**不叠加时长、不重复通知**，只回读当前订阅。
 * `downgradeSuppressed` 给 `null`（未知）而不是 `false`——结算后读不到首次是否被压制，
 * 编造 false 会与首次返回体矛盾（与 redeem 的重放视图同口径）。
 */
function buildGrantReplayView({ subscription, requestedPlan, toSubscriptionDto, toIsoOrNull }) {
  return {
    idempotent: true,
    plan: subscription ? subscription.plan : requestedPlan,
    requestedPlan,
    downgradeSuppressed: null,
    subscription: toSubscriptionDto(subscription),
    order: null,
    version: null,
    periodStart: toIsoOrNull(subscription && subscription.current_period_start),
    periodEnd: toIsoOrNull(subscription && subscription.current_period_end),
  }
}

module.exports = { normalizeGrantIdempotency, idempotentProviderReference, buildGrantReplayView }
