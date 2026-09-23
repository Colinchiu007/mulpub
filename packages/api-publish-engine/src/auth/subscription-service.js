'use strict'

/**
 * 会员中心 · 订阅服务：兑换码核销 / 后台开通 / 到期惰性降级 / 视图组装。
 * 真源：01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md §3.1/§3.3/§3.5。
 * 多表写入一律走 repository.commerceTransaction；错误统一 CommerceError{code,status} 由路由层映射 HTTP。
 */

const crypto = require('crypto')
const { PLAN_IDS, getPlanEntitlement } = require('./plan-matrix')

// 排除易混淆字符 I/O/0/1；格式 4-4-4（与 LicenseManager.activate 的输入习惯兼容）。
const REDEEM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const REDEEM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/

class CommerceError extends Error {
  constructor(message, code, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

function generateRedeemCode() {
  const pick = () => Array.from(
    { length: 4 },
    () => REDEEM_CODE_ALPHABET[crypto.randomInt(REDEEM_CODE_ALPHABET.length)],
  ).join('')
  return `${pick()}-${pick()}-${pick()}`
}

/**
 * 仓储返回的 identity_subscriptions 原始行（snake_case）→ 规范化 DTO（camelCase）。
 * 白名单构造：只吐前端契约字段，内部列（provider_reference 等）一律不出现在响应体。缺字段用 null。
 */
function toSubscriptionDto(row) {
  if (!row) return null
  return {
    id: row.id ?? null,
    plan: row.plan ?? null,
    status: row.status ?? null,
    periodStart: row.current_period_start ?? null,
    periodEnd: row.current_period_end ?? null,
  }
}

/** 仓储返回的 identity_orders 原始行 → 规范化 DTO（白名单）。 */
function toOrderDto(row) {
  if (!row) return null
  return {
    id: row.id ?? null,
    userId: row.user_id ?? null,
    plan: row.plan ?? null,
    amount: row.amount ?? null,
    currency: row.currency ?? null,
    channel: row.channel ?? null,
    status: row.status ?? null,
    createdAt: row.created_at ?? null,
  }
}

class SubscriptionService {
  constructor(options = {}) {
    if (!options.repository) throw new TypeError('repository is required')
    this.repository = options.repository
    this.now = typeof options.now === 'function' ? options.now : () => new Date()
    this.planOverrides = options.planOverrides || null
  }

  entitlementPayload(plan) {
    // deepFreeze 后需脱壳才能安进 JSONB 参数/测试 fixture
    return JSON.parse(JSON.stringify(getPlanEntitlement(plan, this.planOverrides)))
  }

  /**
   * 到期惰性降级：仅在存在过期 active 订阅时降级回 free（无定时任务，/me 访问触发）。
   * 三个写必须在同一事务：若先置 expired 再写快照（非事务），中途失败会留下
   * 「订阅已 expired + 快照仍为 pro」的永久权限泄漏（expired 行下次不再命中，无重试路径）。
   */
  async settleExpiry(userId) {
    return this.repository.commerceTransaction(async (tx) => {
      const expired = await tx.expireSubscription(userId)
      if (!expired) return null
      await tx.putEntitlement(userId, this.entitlementPayload('free'))
      await tx.createNotification({
        id: crypto.randomUUID(),
        userId,
        title: '会员已到期',
        body: '本期订阅已结束，档位已回到免费版；兑换新码可续叠。',
        level: 'warn',
      })
      return expired
    })
  }

  async getSubscriptionView(userId) {
    await this.settleExpiry(userId)
    const subscription = await this.repository.getActiveSubscription(userId)
    const plan = subscription ? subscription.plan : 'free'
    return {
      plan,
      status: subscription ? subscription.status : 'free',
      periodStart: subscription ? subscription.current_period_start : null,
      periodEnd: subscription ? subscription.current_period_end : null,
      entitlement: this.entitlementPayload(plan),
    }
  }

  /** 用量视图：矩阵上限 + 当期用量（无记录也回 used=0，前端进度条不需再判空）。 */
  async getUsageView(userId) {
    const subscription = await this.repository.getActiveSubscription(userId)
    const plan = subscription ? subscription.plan : 'free'
    const entitlement = getPlanEntitlement(plan, this.planOverrides)
    const rows = await this.repository.getUsageSummary(userId, this.now())
    const byFeature = new Map(rows.map((row) => [row.feature, row]))
    const features = Object.keys(entitlement.quota).map((quotaKey) => {
      const feature = quotaKey.replace(/_monthly$/, '')
      const row = byFeature.get(feature)
      return {
        feature,
        used: row ? Number(row.used) : 0,
        limit: Number(entitlement.quota[quotaKey]),
        periodStart: row ? row.period_start : null,
        periodEnd: row ? row.period_end : null,
      }
    })
    return { plan, features }
  }

  /**
   * 本人重放的返回体：键集合必须与首次核销完全一致（Task 6 原样 spread 给客户端，缺字段即破坏前端契约）。
   * 权益三字段（subscription/periodStart/periodEnd）经存活性判定回填——若当前 active 行已过期未结算，
   * 绝不能把陈旧到期时间当作现行权益吐给客户端（M-3 footgun）。order/version 重放不回吐：订单首次核销
   * 已下发且可在 /me/orders 查询，重放再发一份会泄漏重复计费凭证。
   */
  async _idempotentRedeemView(userId, code, row) {
    const active = await this.repository.getActiveSubscription(userId)
    const alive = active && new Date(active.current_period_end) > this.now()
    return {
      idempotent: true,
      code,
      plan: row.plan,
      redeemedAt: row.used_at,
      subscription: alive ? toSubscriptionDto(active) : null,
      order: null,
      version: null,
      periodStart: alive ? (active.current_period_start ?? null) : null,
      periodEnd: alive ? (active.current_period_end ?? null) : null,
    }
  }

  async requireUser(userId) {
    if (typeof userId !== 'string' || !userId) {
      throw new CommerceError('需要登录态', 'BUSINESS_USER_REQUIRED', 503)
    }
  }

  /** 兑换码核销：行锁 + 条件更新双保险幂等；本人重放不重复记账。 */
  async redeem({ userId, code }) {
    await this.requireUser(userId)
    const normalized = typeof code === 'string' ? code.trim().toUpperCase() : ''
    if (!REDEEM_CODE_PATTERN.test(normalized)) {
      throw new CommerceError('兑换码格式不正确（形如 ABCD-EFGH-JKMN）', 'REDEEM_CODE_FORMAT', 400)
    }
    return this.repository.commerceTransaction(async (tx) => {
      const row = await tx.lockRedeemCode(normalized)
      if (!row) throw new CommerceError('兑换码不存在', 'REDEEM_CODE_NOT_FOUND', 404)
      if (row.status === 'used') {
        if (row.used_by === userId) {
          return this._idempotentRedeemView(userId, normalized, row)
        }
        throw new CommerceError('兑换码已被使用', 'REDEEM_CODE_USED', 409)
      }
      if (row.status !== 'active') throw new CommerceError('兑换码已停用', 'REDEEM_CODE_DISABLED', 409)
      if (row.expires_at && new Date(row.expires_at) <= this.now()) {
        throw new CommerceError('兑换码已过有效期', 'REDEEM_CODE_EXPIRED', 410)
      }
      const applied = await tx.applySubscription({
        userId,
        plan: row.plan,
        durationDays: row.duration_days,
        now: this.now(),
        order: {
          id: `ord-${crypto.randomUUID()}`,
          amount: 0,
          currency: 'CNY',
          channel: 'redeem',
          providerReference: `redeem:${normalized}`,
        },
        entitlementPayload: this.entitlementPayload(row.plan),
      })
      await tx.markRedeemCodeUsed(normalized, userId)
      await tx.createNotification({
        id: crypto.randomUUID(),
        userId,
        title: '兑换成功',
        body: `已开通 ${row.plan}，有效期 ${row.duration_days} 天`,
        level: 'info',
      })
      return {
        idempotent: false,
        code: normalized,
        plan: row.plan,
        redeemedAt: this.now().toISOString(),
        subscription: toSubscriptionDto(applied.subscription),
        order: toOrderDto(applied.order),
        version: applied.version ?? null,
        periodStart: applied.periodStart ?? null,
        periodEnd: applied.periodEnd ?? null,
      }
    })
  }

  /** 后台开通（ops-center，阶段 1 不走支付）：channel=admin_grant，金额 0。 */
  async grant({ userId, plan, durationDays, providerReference = null, operator = null }) {
    await this.requireUser(userId)
    if (!PLAN_IDS.includes(plan) || plan === 'free') {
      throw new CommerceError('仅支持开通付费档位', 'PLAN_INVALID', 400)
    }
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      throw new CommerceError('时长必须为正整数天', 'DURATION_INVALID', 400)
    }
    return this.repository.commerceTransaction(async (tx) => {
      // provider_reference 在 identity_subscriptions 上是 UNIQUE（002:29），默认值必须逐次唯一，
      // 否则同一 operator 连续给两个用户开通时第二个必然撞唯一约束导致整个事务回滚。
      const grantOrderId = `ord-${crypto.randomUUID()}`
      const applied = await tx.applySubscription({
        userId,
        plan,
        durationDays,
        now: this.now(),
        order: {
          id: grantOrderId,
          amount: 0,
          currency: 'CNY',
          channel: 'admin_grant',
          providerReference: providerReference || `grant:${operator || 'system'}:${grantOrderId}`,
        },
        entitlementPayload: this.entitlementPayload(plan),
      })
      await tx.createNotification({
        id: crypto.randomUUID(),
        userId,
        title: '会员开通',
        body: `已开通 ${plan}，有效期 ${durationDays} 天`,
        level: 'info',
      })
      return {
        plan,
        subscription: toSubscriptionDto(applied.subscription),
        order: toOrderDto(applied.order),
        version: applied.version ?? null,
        periodStart: applied.periodStart ?? null,
        periodEnd: applied.periodEnd ?? null,
      }
    })
  }

  /** 批量生成兑换码（运营入口）：上限 500/批，内存去重后批量入库。 */
  async createRedeemBatch({ plan, durationDays, count, batch = null, expiresAt = null }) {
    if (!PLAN_IDS.includes(plan) || plan === 'free') {
      throw new CommerceError('兑换码仅支持付费档位', 'PLAN_INVALID', 400)
    }
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      throw new CommerceError('时长必须为正整数天', 'DURATION_INVALID', 400)
    }
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new CommerceError('批量数量需在 1-500 之间', 'BATCH_COUNT_INVALID', 400)
    }
    const batchId = batch || `batch-${new Date(this.now()).toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`
    const codes = new Set()
    while (codes.size < count) codes.add(generateRedeemCode())
    const records = [...codes].map((code) => ({ code, plan, durationDays, batch: batchId, expiresAt }))
    const created = await this.repository.createRedeemCodes(records)
    return { batch: batchId, plan, durationDays, requested: count, generated: created.length, codes: created }
  }
}

module.exports = { SubscriptionService, CommerceError, generateRedeemCode, REDEEM_CODE_PATTERN }
