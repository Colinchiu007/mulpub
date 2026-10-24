'use strict'
/**
 * 微信支付路由分派的回归护栏（publish-api-payment.js mixin）。
 *
 * 为什么这层必须单独测：路由块已从 publish-api-server.js 抽到 mixin，
 * 重构最容易出的错是**某条分支搬漏**（端点静默 404）或**顺序错**
 * （webhook 排到鉴权之后 ⇒ 微信永远 401；`/me/orders/{id}` 排到集合分支之后 ⇒ 永不命中）。
 * 这类错在 service 单测里看不见。
 *
 * 覆盖：
 *   1. 三个端点的分派都在
 *   2. webhook **验签失败 401 且不入库**（伪造回调不得白嫖权益）
 *   3. webhook **内部错误仍 2xx**（防微信重投风暴）
 *   4. checkout body 白名单：`amount` 被丢弃，只传 plan/period
 *   5. 订单详情**越权返回 404 而非 403**（403 会泄露订单号存在）
 */

const assert = require('node:assert')
const test = require('node:test')

const { applyPaymentHelpers } = require('../src/auth/publish-api-payment')

function createStub (overrides = {}) {
  const emitted = []
  const errors = []
  const settleCalls = []
  const checkoutCalls = []

  class Stub {
    _json (res, status, body) { emitted.push({ status, body }); return true }
    _logError (code, error) { errors.push({ code, error }) }
    _ctx () { return {} }
    _memberUserId () { return overrides.userId === undefined ? 'u-1' : overrides.userId }
    async _parseBody () { return overrides.body || {} }
    async _readRawBody () {
      if (overrides.readBodyError) throw overrides.readBodyError
      return overrides.rawBody === undefined ? '{"raw":true}' : overrides.rawBody
    }
    _commerceFailure (req, res, error) {
      this._json(res, (error && error.status) || 500, { error: (error && error.code) || 'X' })
    }
    _commerceRepository () { return overrides.repository === undefined ? null : overrides.repository }
  }
  applyPaymentHelpers(Stub)

  const stub = new Stub()
  stub.emitted = emitted
  stub.errors = errors
  stub.settleCalls = settleCalls
  stub.checkoutCalls = checkoutCalls
  stub._paymentProvider = overrides.provider === undefined
    ? { async parseWebhook ({ rawBody }) { return { type: 'checkout.completed', orderId: 'wpabc12345', amountCents: 5900, occurredAt: null } } }
    : overrides.provider
  stub._subscriptionService = overrides.subscriptionService === undefined
    ? {
        async settlePaymentWebhook (args) { settleCalls.push(args); return { plan: 'standard', orderId: args.orderId } },
        async createCheckout (args) { checkoutCalls.push(args); return { orderId: 'wpabc12345', codeUrl: 'weixin://x', expiresAt: null } },
      }
    : overrides.subscriptionService
  return stub
}

const res = {}
const req = { headers: {}, method: 'POST' }

test('POST /api/v1/webhooks/payment', async (t) => {
  await t.test('验签通过 → 200 并落账', async () => {
    const s = createStub()
    const handled = await s._handlePaymentWebhook(req, res, 'POST', '/api/v1/webhooks/payment')
    assert.strictEqual(handled, true)
    assert.strictEqual(s.emitted[0].status, 200)
    assert.strictEqual(s.emitted[0].body.success, true)
    assert.strictEqual(s.settleCalls.length, 1)
    assert.strictEqual(s.settleCalls[0].providerReference, 'wechat:wpabc12345')
  })

  await t.test('验签失败 → 401，且**不入库不落账**（settle 一次都没调）', async () => {
    const s = createStub({
      provider: {
        async parseWebhook () {
          const e = new Error('bad sig')
          e.code = 'PAYMENT_WEBHOOK_SIGNATURE_INVALID'
          e.status = 401
          throw e
        },
      },
    })
    await s._handlePaymentWebhook(req, res, 'POST', '/api/v1/webhooks/payment')
    assert.strictEqual(s.emitted[0].status, 401)
    assert.strictEqual(s.emitted[0].body.error, 'PAYMENT_WEBHOOK_SIGNATURE_INVALID')
    assert.strictEqual(s.settleCalls.length, 0, '验签失败不得调用 settle（否则等于给伪造回调落账）')
    assert.strictEqual(s.errors.length, 1, '验签失败必须留痕')
  })

  await t.test('内部错误 → 仍返回 2xx（防微信重投风暴）', async () => {
    const s = createStub({
      subscriptionService: {
        async settlePaymentWebhook () { throw Object.assign(new Error('boom'), { code: 'PAYMENT_WEBHOOK_INTERNAL' }) },
      },
    })
    await s._handlePaymentWebhook(req, res, 'POST', '/api/v1/webhooks/payment')
    assert.strictEqual(s.emitted[0].status, 200, '内部错误必须 2xx，否则微信会重投')
    assert.strictEqual(s.emitted[0].body.processed, false)
    assert.strictEqual(s.emitted[0].body.error, 'PAYMENT_WEBHOOK_INTERNAL')
  })

  await t.test('未配置供应商 → 404（让微信侧配置错误一眼可见）', async () => {
    const s = createStub({ provider: null })
    await s._handlePaymentWebhook(req, res, 'POST', '/api/v1/webhooks/payment')
    assert.strictEqual(s.emitted[0].status, 404)
    assert.strictEqual(s.emitted[0].body.error, 'PAYMENT_WEBHOOK_NOT_CONFIGURED')
  })

  await t.test('GET → 405（webhook 只接 POST）', async () => {
    const s = createStub()
    await s._handlePaymentWebhook(req, res, 'GET', '/api/v1/webhooks/payment')
    assert.strictEqual(s.emitted[0].status, 405)
  })

  await t.test('body 超限 → 413', async () => {
    const s = createStub({ readBodyError: Object.assign(new Error('too big'), { status: 413 }) })
    await s._handlePaymentWebhook(req, res, 'POST', '/api/v1/webhooks/payment')
    assert.strictEqual(s.emitted[0].status, 413)
  })

  await t.test('非本路径 → 返回 false（不抢别人的路由）', async () => {
    const s = createStub()
    const handled = await s._handlePaymentWebhook(req, res, 'POST', '/api/v1/me/checkout')
    assert.strictEqual(handled, false)
    assert.strictEqual(s.emitted.length, 0)
  })
})

test('POST /api/v1/me/checkout', async (t) => {
  await t.test('body 白名单：只把 plan/period 传给 service，amount 被丢弃', async () => {
    const s = createStub({ body: { plan: 'standard', period: 'month', amount: 1, planId: 'x', currency: 'USD' } })
    await s._handleMemberCheckout(req, res, 'POST', '/api/v1/me/checkout')
    assert.strictEqual(s.emitted[0].status, 200)
    assert.deepStrictEqual(s.checkoutCalls[0], { userId: 'u-1', plan: 'standard', period: 'month' })
    assert.strictEqual(s.checkoutCalls[0].amount, undefined, 'amount 绝不能透传到 service')
  })

  await t.test('继续支付：orderId 透传，但 amount 仍被丢弃（白名单不因新增键而放宽）', async () => {
    const s = createStub({ body: { plan: 'standard', period: 'month', orderId: 'wpabc12345', amount: 1 } })
    await s._handleMemberCheckout(req, res, 'POST', '/api/v1/me/checkout')
    assert.strictEqual(s.checkoutCalls[0].orderId, 'wpabc12345')
    assert.strictEqual(s.checkoutCalls[0].amount, undefined, 'amount 绝不能随 orderId 一起漏进来')
    assert.deepStrictEqual(Object.keys(s.checkoutCalls[0]).sort(), ['orderId', 'period', 'plan', 'userId'])
    assert.strictEqual(s.checkoutCalls[0].plan, 'standard')
  })

  await t.test('orderId 非字符串 → 不传该键（不是传 undefined：那会改变调用形状）', async () => {
    const s = createStub({ body: { plan: 'standard', period: 'month', orderId: 123 } })
    await s._handleMemberCheckout(req, res, 'POST', '/api/v1/me/checkout')
    assert.strictEqual('orderId' in s.checkoutCalls[0], false, '非字符串时不得出现 orderId 键')
  })

  await t.test('非字符串 plan/period → 传空串（由 service 判 400，不在路由层猜）', async () => {
    const s = createStub({ body: { plan: 123, period: { x: 1 } } })
    await s._handleMemberCheckout(req, res, 'POST', '/api/v1/me/checkout')
    assert.strictEqual(s.checkoutCalls[0].plan, '')
    assert.strictEqual(s.checkoutCalls[0].period, '')
  })

  await t.test('service 抛 CommerceError → 经 _commerceFailure 映射状态码', async () => {
    const s = createStub({
      subscriptionService: {
        async createCheckout () { throw Object.assign(new Error('x'), { code: 'CHECKOUT_PLAN_INVALID', status: 400 }) },
      },
    })
    await s._handleMemberCheckout(req, res, 'POST', '/api/v1/me/checkout')
    assert.strictEqual(s.emitted[0].status, 400)
    assert.strictEqual(s.emitted[0].body.error, 'CHECKOUT_PLAN_INVALID')
  })

  await t.test('未登录 → 503 BUSINESS_USER_REPOSITORY_NOT_CONFIGURED', async () => {
    const s = createStub({ userId: null })
    await s._handleMemberCheckout(req, res, 'POST', '/api/v1/me/checkout')
    assert.strictEqual(s.emitted[0].status, 503)
  })

  await t.test('未配置订阅服务 → 503', async () => {
    const s = createStub({ subscriptionService: null })
    await s._handleMemberCheckout(req, res, 'POST', '/api/v1/me/checkout')
    assert.strictEqual(s.emitted[0].status, 503)
  })

  await t.test('GET → 405', async () => {
    const s = createStub()
    await s._handleMemberCheckout(req, res, 'GET', '/api/v1/me/checkout')
    assert.strictEqual(s.emitted[0].status, 405)
  })
})

test('GET /api/v1/me/orders/{id}', async (t) => {
  const ownOrder = {
    id: 'wpabc12345', user_id: 'u-1', plan: 'standard', amount: 5900, currency: 'CNY',
    channel: 'payment', status: 'paid', period: 'month', created_at: '2026-10-21T00:00:00Z', paid_at: '2026-10-21T00:01:00Z',
    provider_sub_id: 'SHOULD_NOT_LEAK',
  }
  const repo = { async getOrderById (id) { return id === ownOrder.id ? ownOrder : null } }

  await t.test('本人订单 → 200 且白名单字段（不泄露 provider_sub_id）', async () => {
    const s = createStub({ repository: repo })
    await s._handleMemberOrderDetail(req, res, 'GET', '/api/v1/me/orders/wpabc12345')
    assert.strictEqual(s.emitted[0].status, 200)
    assert.strictEqual(s.emitted[0].body.order.id, 'wpabc12345')
    assert.strictEqual(s.emitted[0].body.order.status, 'paid')
    assert.strictEqual(s.emitted[0].body.order.provider_sub_id, undefined, '内部列不得外泄')
  })

  await t.test('别人的订单 → 404（不是 403：403 会泄露订单号存在）', async () => {
    const s = createStub({
      repository: { async getOrderById () { return { ...ownOrder, user_id: 'u-2' } } },
    })
    await s._handleMemberOrderDetail(req, res, 'GET', '/api/v1/me/orders/wpabc12345')
    assert.strictEqual(s.emitted[0].status, 404)
    assert.strictEqual(s.emitted[0].body.error, 'ORDER_NOT_FOUND')
  })

  await t.test('订单号形状非法 → 404，且不查库', async () => {
    let queried = false
    const s = createStub({ repository: { async getOrderById () { queried = true; return ownOrder } } })
    await s._handleMemberOrderDetail(req, res, 'GET', '/api/v1/me/orders/not-an-order')
    assert.strictEqual(s.emitted[0].status, 404)
    assert.strictEqual(queried, false)
  })

  await t.test('非详情路径 → 返回 false（集合分支自己处理）', async () => {
    const s = createStub({ repository: repo })
    const handled = await s._handleMemberOrderDetail(req, res, 'GET', '/api/v1/me/orders')
    assert.strictEqual(handled, false)
  })
})
