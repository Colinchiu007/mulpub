'use strict'
/**
 * 支付路由的**管线级**鉴权回归锁（QM-6 评审 i6 的处置）。
 *
 * 为什么必须存在这一层：
 *   `_handlePaymentWebhook` 被放在 Bearer/API-key 鉴权**之前**（这是 webhook 的正确位置：
 *   微信不带我们的 Bearer，验签本身就是信任边界）。但它同时是一个**早期 return 点** ——
 *   一旦它的路径判断从「全等」退化成「前缀」或写错，鉴权链就会被整体绕过。
 *
 *   而 `payment-api.test.js` 那 20 例全是**直接调用 mixin 方法**的白盒测试，
 *   一条都没走完整请求管线，因此**证明不了**「未登录请求到 /api/v1/me/checkout 会被 401」。
 *   这正是评审 i6 点名的判据缺口：代码走读不算判据。
 *
 * 本文件从真实 HTTP 入口发起、不带 Authorization 头，断言四件事：
 *   ① 会员支付端点（checkout / 订单详情）在未登录时 401，且**不产生订单**
 *   ② 既有会员端点的鉴权未被连带削弱（对照组）
 *   ③ webhook 是**唯一**免登录出口，且它到达的是支付 handler（不是被鉴权拦掉）
 *   ④ **反向锁**：形似 webhook 的相邻路径（前缀/多级）仍然 401 —— 证明免登录面不是前缀通配
 */

const assert = require('node:assert')
const http = require('node:http')
const test = require('node:test')

const { TestPublishApiServer: PublishApiServer } = require('./test-publish-api-server')

const ORDER_ID = 'wpabc12345'

function requestJson (port, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(data) } catch (_) { parsed = { raw: data } }
        resolve({ status: res.statusCode, body: parsed })
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

/**
 * 起一个**强制鉴权**的服务器：`identityAuthRequired: true` + 一个必定抛 401 的
 * logtoVerifier（模拟"没带 token / token 无效"）。未配置 paymentProvider，
 * 因此 webhook 一旦到达 handler 就会返回 404 PAYMENT_WEBHOOK_NOT_CONFIGURED ——
 * 这个 404 正是「请求穿透了鉴权层、进到了支付 handler」的证据。
 */
async function startServer () {
  const createdOrders = []
  const server = new PublishApiServer({
    dryRun: true,
    apiKey: 'legacy-key',
    autoMigrate: false,
    identityAuthRequired: true,
    logtoVerifier: {
      verify: async () => {
        throw Object.assign(new Error('not a jwt'), { code: 'AUTH_TOKEN_INVALID', status: 401 })
      },
    },
    // 只要 createCheckout 被调用就记录：鉴权若失效，这里会有痕迹
    subscriptionService: {
      async createCheckout (args) {
        createdOrders.push(args)
        return { orderId: ORDER_ID, codeUrl: 'weixin://x', expiresAt: null }
      },
      async settlePaymentWebhook () {
        throw Object.assign(new Error('should not reach'), { code: 'SHOULD_NOT_REACH' })
      },
      planOverrides: null,
    },
  })
  await server.start(0)
  return { server, port: server._server.address().port, createdOrders }
}

test('支付路由管线级鉴权', async (t) => {
  const { server, port, createdOrders } = await startServer()
  t.after(async () => { await server.stop() })

  await t.test('① POST /api/v1/me/checkout 未登录 → 401，且 createCheckout 一次都没被调用', async () => {
    const res = await requestJson(port, 'POST', '/api/v1/me/checkout', { plan: 'standard', period: 'month' })
    assert.strictEqual(res.status, 401, `未登录下单必须 401，实际 ${res.status}`)
    assert.deepStrictEqual(createdOrders, [], '鉴权失败时绝不能产生订单')
  })

  await t.test('① GET /api/v1/me/orders/{id} 未登录 → 401', async () => {
    const res = await requestJson(port, 'GET', `/api/v1/me/orders/${ORDER_ID}`)
    assert.strictEqual(res.status, 401, `未登录查订单必须 401，实际 ${res.status}`)
  })

  await t.test('② 对照组：既有会员端点鉴权未被连带削弱', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/me/sessions'],
      ['POST', '/api/v1/me/notifications/read'],
      ['POST', '/api/v1/redeem'],
    ]) {
      const res = await requestJson(port, method, path, method === 'POST' ? { code: 'AAAA-BBBB-CCCC' } : null)
      assert.strictEqual(res.status, 401, `${method} ${path} 必须 401，实际 ${res.status}`)
    }
  })

  await t.test('③ webhook 是唯一免登录出口：请求穿透鉴权到达支付 handler（404 未配置）', async () => {
    const res = await requestJson(port, 'POST', '/api/v1/webhooks/payment', { id: 'x' })
    // 401 表示被鉴权拦住（那 webhook 就永远收不到）；404 PAYMENT_WEBHOOK_NOT_CONFIGURED
    // 才是"进到 handler 了但没配商户凭据"的正确读数。
    assert.notStrictEqual(res.status, 401, 'webhook 不得被 Bearer 鉴权拦掉')
    assert.strictEqual(res.status, 404)
    assert.strictEqual(res.body.error, 'PAYMENT_WEBHOOK_NOT_CONFIGURED')
  })

  await t.test('④ 反向锁：形似 webhook 的相邻路径仍 401（免登录面不是前缀通配）', async () => {
    for (const path of [
      '/api/v1/webhooks/payment/extra',
      '/api/v1/webhooks/paymentX',
      '/api/v1/webhooks',
      '/api/v1/webhook',
    ]) {
      const res = await requestJson(port, 'POST', path, {})
      assert.strictEqual(res.status, 401, `${path} 必须仍受鉴权保护，实际 ${res.status}`)
    }
  })

  await t.test('④ 反向锁：GET 到 webhook 路径也不免登录（只放 POST 且方法错要 405 而非 404）', async () => {
    const res = await requestJson(port, 'GET', '/api/v1/webhooks/payment')
    // 该路径确实在鉴权之前被接管（所以不是 401），但必须明确拒绝方法
    assert.notStrictEqual(res.status, 401, 'GET 也应到达支付 handler 而非被鉴权拦掉')
    assert.strictEqual(res.status, 405, `webhook 只接 POST，GET 必须 405，实际 ${res.status}`)
  })
})
