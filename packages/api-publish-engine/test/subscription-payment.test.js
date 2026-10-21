'use strict'
/**
 * SubscriptionService 支付路径契约测试（createCheckout / settlePaymentWebhook）。
 *
 * 三条不可让的判据：
 *   ① **金额真源**：客户端传 amount 必须被忽略，一律按 plan-matrix 计算。
 *      （AGENTS §4.5「金额夹紧」：绝不据客户端参数计费）
 *   ② **幂等**：同一 out_trade_no 重复回调不得重复授权、不得重复落单。
 *   ③ **复用 applySubscription**：支付路径不得自己写 subscription/entitlement，
 *      否则并发续叠/跨档压制/三连写原子性全部失去保护。
 *
 * 仓储用内存 fake（不连 PG），但**applySubscription 的语义走真实实现**——
 * 用 fake repository 实现 commerceTransaction + applySubscription 的关键 SQL 效果，
 * 而不是 mock 掉 SubscriptionService 内部调用。
 */

const test = require('node:test')
const assert = require('node:assert')
const { SubscriptionService, CommerceError } = require('../src/auth/subscription-service')
const { planRank } = require('../src/auth/plan-matrix')

const KEY = '0123456789abcdef0123456789abcdef'

/** 内存 fake 仓储：实现本测试用到的 commerceTransaction 语义（串行 + 关键不变量）。 */
function makeRepository() {
  const orders = new Map() // id → row
  const subscriptions = new Map() // user_id → row
  const customers = new Map() // `${provider}:${user_id}` → row
  const events = new Map() // `${provider}:${id}` → row
  const notifications = []
  let eventCounter = 0

  const tx = {
    async applySubscription({ userId, plan, durationDays, now, order, entitlementPayloadFor }) {
      // 复刻 postgres-commerce-store.js:88-169 的关键语义（advisory lock 在单线程测试里
      // 由串行的 commerceTransaction 保证；这里只实现行为判据）
      const nowDate = now instanceof Date ? now : new Date(now)
      if (!Number.isInteger(durationDays) || durationDays <= 0) {
        throw Object.assign(new Error('DURATION_INVALID'), { code: 'DURATION_INVALID', status: 400 })
      }
      const existing = subscriptions.get(userId) || null
      const existingRank = existing ? planRank(existing.plan) : -1
      const requestedRank = planRank(plan)
      const downgradeSuppressed = Boolean(existing) && existingRank >= 0 && requestedRank >= 0 && existingRank > requestedRank
      const effectivePlan = downgradeSuppressed ? existing.plan : plan
      if (downgradeSuppressed && typeof entitlementPayloadFor !== 'function') {
        throw Object.assign(new Error('ENTITLEMENT_PAYLOAD_REQUIRED'), { code: 'ENTITLEMENT_PAYLOAD_REQUIRED', status: 500 })
      }
      const base = existing && new Date(existing.current_period_end) > nowDate
        ? new Date(existing.current_period_end)
        : nowDate
      const periodEnd = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000)
      // provider_reference UNIQUE（同 postgres-commerce-store.js:146-152 的收敛）
      const ref = order.providerReference || null
      if (ref) {
        for (const row of subscriptions.values()) {
          if (row.provider_reference === ref) {
            throw Object.assign(new Error('ORDER_REFERENCE_CONFLICT'), { code: 'ORDER_REFERENCE_CONFLICT', status: 409 })
          }
        }
      }
      const sub = {
        id: `sub-${userId}`,
        user_id: userId,
        plan: effectivePlan,
        status: 'active',
        current_period_start: base.toISOString(),
        current_period_end: periodEnd.toISOString(),
        provider_reference: ref,
      }
      subscriptions.set(userId, sub)
      const orderRow = {
        id: order.id,
        user_id: userId,
        plan, // 订单记**请求**档位
        amount: order.amount,
        currency: order.currency || 'CNY',
        channel: order.channel,
        status: 'paid',
        created_at: nowDate.toISOString(),
        paid_at: nowDate.toISOString(),
      }
      orders.set(orderRow.id, orderRow)
      return {
        subscription: sub,
        order: orderRow,
        version: 1,
        periodStart: base.toISOString(),
        periodEnd: periodEnd.toISOString(),
        plan: effectivePlan,
        requestedPlan: plan,
        downgradeSuppressed,
      }
    },
    async createNotification({ id, userId, title, body }) {
      notifications.push({ id, userId, title, body })
    },
    async putEntitlement() { return 1 },
    async lockRedeemCode() { return null },
    async markRedeemCodeUsed() { throw new Error('not used in payment tests') },
    async expireSubscription() { return null },
  }

  return {
    orders,
    subscriptions,
    customers,
    events,
    notifications,
    async commerceTransaction(cb) { return cb(tx) },
    async getActiveSubscription(userId) {
      const row = subscriptions.get(userId) || null
      if (row && new Date(row.current_period_end) > new Date()) return row
      return null
    },
    async getOrder(orderId) { return orders.get(orderId) || null },
    async getOrderById(orderId) { return orders.get(orderId) || null },
    async createPendingOrder(row) {
      // 真实仓储走 RETURNING *，列名是 user_id（snake_case）。
      // 夹具必须复刻 DB 形状，否则服务层读 order.user_id 会拿到 undefined。
      // channel='payment' 在真实 SQL 里是硬编码的（INSERT ... VALUES (..., 'payment', 'pending', ...)），
      // 服务层不传；夹具必须复刻这一点。
      const stored = {
        ...row,
        user_id: row.userId,
        channel: 'payment',
        status: 'pending',
        provider_order_id: null,
        paid_at: null,
        created_at: new Date('2026-10-21T11:36:36Z').toISOString(),
      }
      orders.set(row.id, stored)
      return stored
    },
    async markOrderPaid(orderId, { paidAt, providerOrderId }) {
      const row = orders.get(orderId)
      if (!row) return null
      row.status = 'paid'
      row.paid_at = paidAt
      if (providerOrderId) row.provider_order_id = providerOrderId
      return row
    },
    async upsertPaymentCustomer({ userId, provider, providerCustomerId, email }) {
      const key = `${provider}:${userId}`
      const row = { user_id: userId, provider, provider_customer_id: providerCustomerId || null, email: email || null }
      customers.set(key, row)
      return row
    },
    async claimPaymentEvent({ provider, eventId }) {
      const key = `${provider}:${eventId}`
      if (events.has(key)) return false
      eventCounter += 1
      events.set(key, { id: eventId, provider, status: 'processing' })
      return true
    },
    async completePaymentEvent({ provider, eventId, result }) {
      const key = `${provider}:${eventId}`
      const row = events.get(key)
      if (row) { row.status = 'processed'; row.result = result }
      return row
    },
    async listOrders(userId) { return [...orders.values()].filter((r) => r.user_id === userId) },
  }
}

function makeService(repo, overrides = {}) {
  return new SubscriptionService({
    repository: repo,
    now: overrides.now || (() => new Date('2026-10-21T11:36:36Z')),
    planOverrides: null,
    paymentProvider: overrides.paymentProvider,
  })
}

const fakeProvider = {
  capabilities: () => ({ immediateCancel: false, refunds: false, proration: false, autoRenewToggle: false, trial: false, coupons: false, customerPortal: false }),
  async createCheckout({ orderId, amountCents }) {
    return { codeUrl: `weixin://wxpay/bizpayurl?pr=${orderId}:${amountCents}`, expiresAt: null }
  },
}

test('createCheckout 金额真源', async (t) => {
  await t.test('standard 月付按 plan-matrix 算 5900 分，durationDays=30', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { paymentProvider: fakeProvider })
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month', clientAmount: 1 })
    const order = repo.orders.get(out.orderId)
    assert.strictEqual(order.amount, 5900, '客户端传 amount:1 必须被忽略')
    assert.strictEqual(order.status, 'pending')
    assert.strictEqual(order.channel, 'payment')
    assert.strictEqual(order.period, 'month')
    assert.strictEqual(order.plan, 'standard')
  })

  await t.test('pro 年付按 plan-matrix 算 99900 分，durationDays=365', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { paymentProvider: fakeProvider })
    const out = await svc.createCheckout({ userId: 'u-1', plan: 'pro', period: 'year' })
    const order = repo.orders.get(out.orderId)
    assert.strictEqual(order.amount, 99900)
    assert.strictEqual(order.period, 'year')
  })

  await t.test('free 档拒绝下单（400），不落单', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { paymentProvider: fakeProvider })
    await assert.rejects(
      svc.createCheckout({ userId: 'u-1', plan: 'free', period: 'month' }),
      (err) => err instanceof CommerceError && err.code === 'CHECKOUT_PLAN_INVALID' && err.status === 400,
    )
    assert.strictEqual(repo.orders.size, 0)
  })

  await t.test('period 非法拒绝（400），不调供应商', async () => {
    const repo = makeRepository()
    let called = false
    const svc = makeService(repo, { paymentProvider: { ...fakeProvider, createCheckout: async () => { called = true; return { codeUrl: 'x' } } } })
    await assert.rejects(
      svc.createCheckout({ userId: 'u-1', plan: 'pro', period: 'decade' }),
      (err) => err.code === 'CHECKOUT_PERIOD_INVALID' && err.status === 400,
    )
    assert.strictEqual(called, false, 'period 非法不得调用供应商')
    assert.strictEqual(repo.orders.size, 0)
  })

  await t.test('未登录（userId 缺失）→ 503 BUSINESS_USER_REQUIRED', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { paymentProvider: fakeProvider })
    await assert.rejects(
      svc.createCheckout({ userId: null, plan: 'pro', period: 'month' }),
      (err) => err.code === 'BUSINESS_USER_REQUIRED' && err.status === 503,
    )
  })

  await t.test('未配置支付供应商 → 503 PAYMENT_PROVIDER_UNAVAILABLE，不落单', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { paymentProvider: null })
    await assert.rejects(
      svc.createCheckout({ userId: 'u-1', plan: 'pro', period: 'month' }),
      (err) => err.code === 'PAYMENT_PROVIDER_UNAVAILABLE' && err.status === 503,
    )
    assert.strictEqual(repo.orders.size, 0)
  })

  await t.test('落 payment_customers 映射（webhook 反查用户用）', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { paymentProvider: fakeProvider })
    await svc.createCheckout({ userId: 'u-1', plan: 'pro', period: 'month' })
    assert.strictEqual(repo.customers.get('wechat:u-1').user_id, 'u-1')
  })

  await t.test('订单号唯一（连续两次下单不撞主键）', async () => {
    const repo = makeRepository()
    const svc = makeService(repo, { paymentProvider: fakeProvider })
    const a = await svc.createCheckout({ userId: 'u-1', plan: 'pro', period: 'month' })
    const b = await svc.createCheckout({ userId: 'u-1', plan: 'pro', period: 'month' })
    assert.notStrictEqual(a.orderId, b.orderId)
    assert.strictEqual(repo.orders.size, 2)
  })
})

test('settlePaymentWebhook', async (t) => {
  function setup(overrides = {}) {
    const repo = makeRepository()
    const svc = makeService(repo, { paymentProvider: fakeProvider })
    return { repo, svc }
  }

  await t.test('pending → paid 并发放订阅（channel=payment）', async () => {
    const { repo, svc } = setup()
    const { orderId } = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const out = await svc.settlePaymentWebhook({
      orderId,
      providerReference: `wechat:${orderId}`,
      amountCents: 5900,
      occurredAt: '2026-10-21T11:36:36Z',
    })
    assert.strictEqual(out.plan, 'standard')
    const order = repo.orders.get(orderId)
    assert.strictEqual(order.status, 'paid')
    assert.strictEqual(repo.subscriptions.get('u-1').plan, 'standard')
    assert.strictEqual(repo.subscriptions.get('u-1').provider_reference, `wechat:${orderId}`)
  })

  await t.test('重复回调幂等：第二次不重复授权、不重复落单', async () => {
    const { repo, svc } = setup()
    const { orderId } = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    await svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 5900 })
    const endBefore = repo.subscriptions.get('u-1').current_period_end
    // 第二次：同一订单号同一 providerReference ⇒ applySubscription 撞 UNIQUE ⇒ 409 收敛
    await assert.rejects(
      svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 5900 }),
      (err) => err.code === 'ORDER_REFERENCE_CONFLICT' && err.status === 409,
    )
    assert.strictEqual(repo.subscriptions.get('u-1').current_period_end, endBefore, '重复回调不得顺延时长')
    assert.strictEqual(repo.orders.size, 1)
  })

  await t.test('未知订单号 → 409 PAYMENT_ORDER_NOT_FOUND，不建订阅', async () => {
    const { repo, svc } = setup()
    await assert.rejects(
      svc.settlePaymentWebhook({ orderId: 'wpdoesnotexist', providerReference: 'wechat:wpdoesnotexist', amountCents: 5900 }),
      (err) => err.code === 'PAYMENT_ORDER_NOT_FOUND' && err.status === 409,
    )
    assert.strictEqual(repo.subscriptions.size, 0)
  })

  await t.test('金额不一致 → 记 WARN 但**不改计费不阻断授权**', async () => {
    const { repo, svc } = setup()
    const { orderId } = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    // 回调金额 100 分 ≠ 订单 5900 分
    const out = await svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 100 })
    assert.strictEqual(out.plan, 'standard', '金额不一致不得阻断授权')
    assert.strictEqual(repo.subscriptions.get('u-1').plan, 'standard')
  })

  await t.test('乱序：refunded 早于 checkout.completed → 记 ignored 不抛错', async () => {
    const { repo, svc } = setup()
    const { orderId } = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const out = await svc.settlePaymentWebhook({
      orderId, providerReference: `wechat:${orderId}`, amountCents: 5900, type: 'refunded',
    })
    assert.strictEqual(out.ignored, true)
    assert.strictEqual(repo.subscriptions.size, 0, '退款事件不得发放权益')
    // 后续 SUCCESS 仍能正常生效
    const ok = await svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 5900, type: 'checkout.completed' })
    assert.strictEqual(ok.plan, 'standard')
  })

  await t.test('跨档压制：pro 用户下一单 standard ⇒ 档位保持 pro、时长顺延', async () => {
    const { repo, svc } = setup()
    const pro = await svc.createCheckout({ userId: 'u-1', plan: 'pro', period: 'month' })
    await svc.settlePaymentWebhook({ orderId: pro.orderId, providerReference: `wechat:${pro.orderId}`, amountCents: 11900 })
    const endBefore = repo.subscriptions.get('u-1').current_period_end
    const std = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const out = await svc.settlePaymentWebhook({ orderId: std.orderId, providerReference: `wechat:${std.orderId}`, amountCents: 5900 })
    assert.strictEqual(out.downgradeSuppressed, true)
    assert.strictEqual(repo.subscriptions.get('u-1').plan, 'pro', '低档单不得降高档')
    assert.ok(new Date(repo.subscriptions.get('u-1').current_period_end) > new Date(endBefore), '时长必须顺延')
  })

  await t.test('payment.failed 只记录不动订阅', async () => {
    const { repo, svc } = setup()
    const { orderId } = await svc.createCheckout({ userId: 'u-1', plan: 'standard', period: 'month' })
    const out = await svc.settlePaymentWebhook({ orderId, providerReference: `wechat:${orderId}`, amountCents: 5900, type: 'payment.failed' })
    assert.strictEqual(out.ignored, true)
    assert.strictEqual(repo.subscriptions.size, 0)
    assert.strictEqual(repo.orders.get(orderId).status, 'pending', '支付失败不得把订单转 paid')
  })
})
