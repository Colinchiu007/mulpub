'use strict'
/**
 * subscription-payment.js — 微信 Native 支付的下单/回调落账（SubscriptionService 的 mixin）。
 *
 * 为什么单独成文件：这组方法直接内联进 `subscription-service.js` 会把那个文件从 487 行
 * 推到 632 行，顶破仓库 `filesOver500` 债务基线。**抬高基线掩盖自己引入的债务是禁止的**，
 * 所以按既有 `publish-api-commerce.js` / `publish-api-redeem-code-admin.js` 的
 * `applyXxxHelpers(Proto)` mixin 体例拆分：方法定义在本文件，挂回 SubscriptionService 原型，
 * 对外契约（调用方 `service.createCheckout(...)`）完全不变。
 *
 * 本文件承载**最小闭环**：
 *   下单 createCheckout → 落 pending 订单 → 调供应商拿 code_url
 *   回调 settlePaymentWebhook → 找订单 → 标 paid → **只调既有 applySubscription**
 *
 * 不做（本期非目标，见 PRD §4.2）：自动续费、升降级 proration、自助退款、免费试用、
 * 促销码 coupon、客户门户、多通道配置切换。
 */

const crypto = require('crypto')
const { PLAN_IDS, getPlanCatalog } = require('./plan-matrix')

const PAYMENT_CHANNEL = 'payment'
const PERIODS = Object.freeze(['month', 'year'])

/** 6 个月/年份 → 授权天数。与兑换码路径同为整数天（不做自然月顺延，避免与既有语义分叉）。 */
const DURATION_DAYS = Object.freeze({ month: 30, year: 365 })

/**
 * 惰性取 CommerceError。
 * 不能在文件顶部 `require('./subscription-service')`：subscription-service 会在末尾
 * require 本文件以应用 mixin，形成循环；加载期拿到的是未完成的 exports（CommerceError 为
 * undefined），只有调用期才完整。用惰性 require 一次性绕开加载顺序问题。
 */
function commerceError (message, code, status) {
  const { CommerceError } = require('./subscription-service')
  return new CommerceError(message, code, status)
}

class SubscriptionPaymentOps {
  /**
   * 下单：**金额一律服务端算**（客户端只报 plan/period，传 amount 在路由层白名单就被丢弃）。
   *
   * 落库顺序不可换：**先落 pending 订单，再调供应商**。反过来的话，供应商下单成功而落库失败
   * 会得到「用户手机里有一张可扫的付款码，我们账上什么都没有」——回调到达时无从归属，
   * 既不能授权也不能对账。先落单后下单，最坏情况是留一条 pending（超时后自然失效），无害。
   */
  async createCheckout({ userId, plan, period }) {
    await this.requireUser(userId)
    if (!PLAN_IDS.includes(plan) || plan === 'free') {
      throw commerceError('仅支持购买付费档位', 'CHECKOUT_PLAN_INVALID', 400)
    }
    if (!PERIODS.includes(period)) {
      throw commerceError('计费周期仅支持 month / year', 'CHECKOUT_PERIOD_INVALID', 400)
    }
    if (!this.paymentProvider) {
      throw commerceError('支付通道暂未开放', 'PAYMENT_PROVIDER_UNAVAILABLE', 503)
    }
    const amountCents = this._paymentPriceCents(plan, period)
    const orderId = this._newPaymentOrderId()
    const order = await this.repository.createPendingOrder({
      id: orderId,
      userId,
      plan,
      amount: amountCents,
      currency: 'CNY',
      period,
    })
    if (!order) throw commerceError('订单创建失败', 'PAYMENT_ORDER_CREATE_FAILED', 503)
    // 用户 ↔ 供应商客户映射：webhook 回传 openid 时反查用。本期只用 user_id 键，best-effort。
    if (typeof this.repository.upsertPaymentCustomer === 'function') {
      await this.repository.upsertPaymentCustomer({ userId, provider: 'wechat' })
    }
    let checkout
    try {
      checkout = await this.paymentProvider.createCheckout({
        orderId,
        plan,
        period,
        amountCents,
        currency: 'CNY',
        // attach 会被微信原样回传，是 webhook 落定用户的关键（回调本身不带我们的 user_id）
        attach: { orderId, userId },
      })
    } catch (error) {
      // 供应商失败：订单留 pending（等超时），错误原样上抛给路由层映射 502/400
      if (error && error.code) throw error
      throw commerceError('支付发起失败', 'PAYMENT_PROVIDER_UPSTREAM_FAILED', 502)
    }
    return { orderId, codeUrl: checkout.codeUrl, expiresAt: checkout.expiresAt || null }
  }

  /** 从 plan-matrix 公开目录取价（唯一真源，已含运营 overrides）。 */
  _paymentPriceCents(plan, period) {
    const entry = getPlanCatalog(this.planOverrides).find((item) => item.id === plan)
    const value = period === 'month' ? entry && entry.priceMonthlyCents : entry && entry.priceYearlyCents
    if (!Number.isInteger(value) || value <= 0) {
      throw commerceError('该档位未配置价格', 'CHECKOUT_PRICE_MISSING', 500)
    }
    return value
  }

  /** 订单号：`wp` + base36 时间戳 + 8 位 hex。全局唯一、有界、形状与 provider 侧校验一致。 */
  _newPaymentOrderId() {
    const ts = Math.floor(this.now().getTime()).toString(36)
    const rand = crypto.randomBytes(4).toString('hex').slice(0, 8)
    return `wp${ts}${rand}`
  }

  /**
   * 支付回调落账：**只做「找订单 → 标记 paid → 调既有 applySubscription」**，
   * 不复制 applySubscription 的任何一行（advisory lock / 跨档压制 / 快照同源 / 三连写原子性
   * 全在 postgres-commerce-store.js）。这是本设计最重要的一条边界。
   *
   * 非 `checkout.completed` 事件一律 `ignored: true` 返回、**不抛错**：微信对 4xx/5xx 会重投，
   * 乱序到达的 refunded 若报错会引发重投风暴，而它本身没有可执行语义（本期无退款功能）。
   */
  async settlePaymentWebhook({ orderId, providerReference = null, amountCents = null, occurredAt = null, type = 'checkout.completed' }) {
    if (type !== 'checkout.completed') {
      return { ignored: true, type, orderId: orderId || null }
    }
    if (typeof orderId !== 'string' || !orderId) {
      throw commerceError('回调缺少订单号', 'PAYMENT_ORDER_ID_REQUIRED', 400)
    }
    const order = typeof this.repository.getOrderById === 'function'
      ? await this.repository.getOrderById(orderId)
      : null
    if (!order) throw commerceError('订单不存在', 'PAYMENT_ORDER_NOT_FOUND', 409)
    if (order.channel !== PAYMENT_CHANNEL) {
      // 兑换码/后台订单不该走到支付回调；拒绝而不是静默处理，避免串道
      throw commerceError('订单渠道不匹配', 'PAYMENT_ORDER_CHANNEL_MISMATCH', 409)
    }
    const durationDays = DURATION_DAYS[order.period] || DURATION_DAYS.month
    const reference = providerReference || `wechat:${orderId}`
    void amountCents
    return this.repository.commerceTransaction(async (tx) => {
      // 条件更新 pending → paid：重复回调在这里拿到 null；随后的 applySubscription 会撞
      // provider_reference UNIQUE 收敛成 409（既有语义），因此不会重复授权。
      if (typeof this.repository.markOrderPaid === 'function') {
        await this.repository.markOrderPaid(orderId, {
          paidAt: occurredAt ? new Date(occurredAt) : this.now(),
        })
      }
      const applied = await tx.applySubscription({
        userId: order.user_id,
        plan: order.plan,
        durationDays,
        now: this.now(),
        order: {
          id: orderId,
          // 金额取**订单已落库的值**（下单时服务端算好的），不是回调声称的金额。
          // 回调金额只用于对账告警，绝不据此计费（AGENTS 金额夹紧）。
          amount: order.amount,
          currency: order.currency || 'CNY',
          channel: PAYMENT_CHANNEL,
          providerReference: reference,
        },
        // 快照按**生效档位**现算（低档单不得把高档配额写进快照）
        entitlementPayloadFor: (plan) => this.entitlementPayload(plan),
      })
      const appliedPlan = applied.plan || order.plan
      await tx.createNotification({
        id: crypto.randomUUID(),
        userId: order.user_id,
        title: '支付成功',
        body: applied.downgradeSuppressed
          ? `已顺延 ${durationDays} 天；当前有效期内的档位高于本次购买，档位保持 ${appliedPlan} 不变`
          : `已开通 ${appliedPlan}，有效期 ${durationDays} 天`,
        level: 'info',
      })
      return {
        plan: appliedPlan,
        requestedPlan: order.plan,
        downgradeSuppressed: applied.downgradeSuppressed === true,
        orderId,
        periodEnd: applied.periodEnd ?? null,
      }
    })
  }
}

function applySubscriptionPaymentOps (Proto) {
  const names = Object.getOwnPropertyNames(SubscriptionPaymentOps.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(SubscriptionPaymentOps.prototype, key))
  }
}

module.exports = { applySubscriptionPaymentOps, SubscriptionPaymentOps, PAYMENT_CHANNEL, DURATION_DAYS }
