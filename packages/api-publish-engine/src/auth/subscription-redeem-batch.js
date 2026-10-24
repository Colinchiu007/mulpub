'use strict'
/**
 * subscription-redeem-batch.js — 兑换码批量签发（SubscriptionService 的 mixin）。
 *
 * 为什么单独成文件：`subscription-service.js` 原本 496 行，而仓库的逐文件行数门禁
 * 对**未挂账**文件是「≥ 500 行即阻断」（`.github/scripts/check-max-lines.js` 的
 * `NEW_OVER_LIMIT`，全局 `limit: 500`）。加 `issued_to` 透传需要额外行数 ⇒ 会撞门禁。
 * 正确解法是**抽模块**（把该文件压回安全区），不是抬基线
 * ——「抬高基线掩盖自己引入的债务是禁止的」（同 `subscription-payment.js` 头部注释的同款论证）。
 *
 * 体例与 `subscription-payment.js` / `publish-api-redeem-code-admin.js` 一致：
 * 方法定义在本文件，用 `applySubscriptionRedeemBatchOps` 挂回 SubscriptionService 原型，
 * 对外契约（调用方 `service.createRedeemBatch(...)`）完全不变 ⇒ 既有调用方与测试零改动。
 *
 * 本文件承载：批量签发（含「发放对象 issued_to」透传）。
 */

/** 发放对象最大长度：够写渠道名/客户名/活动名，又不至于把台账塞成长文本。 */
const ISSUED_TO_MAX_LENGTH = 200

/**
 * 惰性取 CommerceError。
 * 不能在文件顶部 `require('./subscription-service')`：subscription-service 会在末尾
 * require 本文件以应用 mixin，形成循环；加载期拿到的是未完成的 exports。
 * 只有调用期才完整（与 subscription-payment.js 同款论证）。
 */
function commerceError (message, code, status) {
  const { CommerceError } = require('./subscription-service')
  return new CommerceError(message, code, status)
}

/**
 * 惰性取码生成器与碰撞补足轮数上限。
 * 这两个是 subscription-service.js 的既有导出，搬走它们会改动那边的 module.exports 契约，
 * 所以留在原处、这里按需取。
 */
function redeemPrimitives () {
  const service = require('./subscription-service')
  return {
    generateRedeemCode: service.generateRedeemCode,
    topupMaxRounds: service.REDEEM_TOPUP_MAX_ROUNDS,
  }
}

/**
 * 归一化「发放对象」。
 *
 * 语义：兑换码一旦泄漏（例如渠道方二次转卖），没有发放对象就无从定位受影响批次，
 * 也就无法批量作废止损。issued_to 回答「这批码发给了谁」。
 *
 * 规则：
 *   - null / undefined / 纯空白 ⇒ 视为未填（null），不是错误（历史批次没有这个字段）
 *   - 非字符串 ⇒ 400（类型错是调用方的错，不该静默吞）
 *   - 超长 ⇒ 400（闸门在入口，不在数据库）
 */
function normalizeIssuedTo (value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw commerceError('发放对象必须是字符串', 'ISSUED_TO_INVALID', 400)
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > ISSUED_TO_MAX_LENGTH) {
    throw commerceError(
      `发放对象过长（上限 ${ISSUED_TO_MAX_LENGTH} 字符）`,
      'ISSUED_TO_INVALID',
      400
    )
  }
  return trimmed
}

class SubscriptionRedeemBatchOps {
  /**
   * 批量生成兑换码（运营入口）：上限 500/批，内存去重后批量入库。
   *
   * 与原实现逐行一致，只多了一处：`issuedTo`（发放对象）随记录落库。
   * 其余语义（碰撞补足、REDEEM_BATCH_INCOMPLETE 携带已签发码）**一个字都没改**。
   */
  async createRedeemBatch ({ plan, durationDays, count, batch = null, expiresAt = null, issuedTo = null }) {
    const { CommerceError } = require('./subscription-service')
    const { generateRedeemCode, topupMaxRounds } = redeemPrimitives()
    const { PLAN_IDS } = require('./plan-matrix')
    const crypto = require('crypto')
    if (!PLAN_IDS.includes(plan) || plan === 'free') {
      throw new CommerceError('兑换码仅支持付费档位', 'PLAN_INVALID', 400)
    }
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      throw new CommerceError('时长必须为正整数天', 'DURATION_INVALID', 400)
    }
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new CommerceError('批量数量需在 1-500 之间', 'BATCH_COUNT_INVALID', 400)
    }
    const normalizedIssuedTo = normalizeIssuedTo(issuedTo)
    const batchId = batch || `batch-${new Date(this.now()).toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`
    const created = []
    // seen 始终以已入库码打底，保证本批内不会重复投递同一个 code
    const seen = new Set()
    const done = new Set()
    let rounds = 0
    for (; created.length < count && rounds < topupMaxRounds; rounds++) {
      while (seen.size < count) seen.add(generateRedeemCode())
      const pending = [...seen].filter((code) => !done.has(code))
      if (pending.length === 0) break
      const records = pending.map((code) => ({ code, plan, durationDays, batch: batchId, expiresAt, issuedTo: normalizedIssuedTo }))
      const inserted = await this.repository.createRedeemCodes(records)
      for (const code of inserted) done.add(code)
      created.push(...inserted)
    }
    if (created.length < count) {
      const error = new CommerceError('批量签发未补足，请按已签发码交付或重试', 'REDEEM_BATCH_INCOMPLETE', 409)
      error.requested = count
      error.generated = created.length
      error.rounds = rounds
      error.created = created
      throw error
    }
    return { batch: batchId, plan, durationDays, issuedTo: normalizedIssuedTo, requested: count, generated: created.length, codes: created }
  }
}

function applySubscriptionRedeemBatchOps (Proto) {
  const names = Object.getOwnPropertyNames(SubscriptionRedeemBatchOps.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(SubscriptionRedeemBatchOps.prototype, key))
  }
}

module.exports = { applySubscriptionRedeemBatchOps, SubscriptionRedeemBatchOps, ISSUED_TO_MAX_LENGTH }
