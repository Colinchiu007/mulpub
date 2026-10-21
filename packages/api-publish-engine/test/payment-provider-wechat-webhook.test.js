'use strict'
/**
 * WeChatNativeProvider 契约测试 · 部分 B：webhook 验签与归一化。
 * 部分 A（抽象契约 / 下单 / 凭据形态 / 解密）见 payment-provider-wechat.test.js。
 *
 * 不可让的判据（AGENTS 取证口径）：本条被测性质是「验签真的在拦、解密真的能解」，
 * 所以判据不能是「这些字符串存在于文件里」——
 *   - 验签用**真实** RSA 密钥对真实签/真实验，绝不 mock 掉 verify
 *   - 解密用**真实** AES-256-GCM 加密构造 resource，绝不传明文
 *   - 含**双向**对照：伪造签名必拒 / 签名对被改后的 body 重算必须过
 *     （少了后者，「改 body 必拒」可能被实现成「只认某一组固定字节」而仍然全绿）
 */

const test = require('node:test')
const assert = require('node:assert')
const { WeChatNativeProvider } = require('../src/auth/payment-providers/wechat-native')
const { WebhookSignatureError } = require('../src/auth/payment-providers/index')
const {
  API_V3_KEY,
  APPID,
  MCH_ID,
  CERT_SERIAL,
  NOW_ISO,
  NOW_TS,
  SPKI_PEM,
  sign,
  makeNotification,
  successBody,
  signedHeaders,
} = require('./helpers/wechat-payment-fixtures')

function makeProvider (overrides = {}) {
  return new WeChatNativeProvider({
    appid: APPID,
    mchId: MCH_ID,
    apiV3Key: API_V3_KEY,
    notifyUrl: 'https://example.test/api/v1/webhooks/payment',
    fetcher: overrides.fetcher || (async () => ({ ok: true, json: async () => ({ code_url: 'weixin://x' }) })),
    now: overrides.now || (() => new Date(NOW_ISO)),
    certificateProvider: overrides.certificateProvider || {
      getBySerial: async (serial) => (serial === CERT_SERIAL ? SPKI_PEM : null),
    },
  })
}

test('parseWebhook 验签（真签名 / 真伪造）', async (t) => {
  const body = successBody()

  await t.test('真签名 + 未过期时间戳 → 归一化为 checkout.completed', async () => {
    const provider = makeProvider()
    const event = await provider.parseWebhook({ rawBody: body, headers: signedHeaders(body) })
    assert.strictEqual(event.type, 'checkout.completed')
    assert.strictEqual(event.provider, 'wechat')
    assert.strictEqual(event.orderId, 'wpmc0abc1234')
    // 幂等键 = 我方订单号，不是微信流水号
    assert.strictEqual(event.externalEventId, 'wpmc0abc1234')
    assert.strictEqual(event.providerTransactionId, '4200000000000000000000000001')
    assert.strictEqual(event.amountCents, 5900)
    assert.strictEqual(event.currency, 'CNY')
    assert.strictEqual(event.occurredAt, '2026-10-21T11:36:36.000Z')
  })

  await t.test('伪造签名 → 401 且抛 WebhookSignatureError', async () => {
    const provider = makeProvider()
    await assert.rejects(
      provider.parseWebhook({
        rawBody: body,
        headers: signedHeaders(body, { 'Wechatpay-Signature': Buffer.from('forged').toString('base64') }),
      }),
      (err) => err instanceof WebhookSignatureError && err.status === 401 && err.code === 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
    )
  })

  await t.test('改一个字节的 body → 401（签名绑的是 body 原文）', async () => {
    const provider = makeProvider()
    const tampered = body.replace('支付成功', '支付失败')
    assert.notStrictEqual(tampered, body, '夹具必须真的被改动')
    await assert.rejects(
      provider.parseWebhook({ rawBody: tampered, headers: signedHeaders(body) }),
      (err) => err.code === 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
    )
  })

  await t.test('摘要被改但签名同步重算 → 仍应通过（锁的是 body 原文而非某组固定字节）', async () => {
    const provider = makeProvider()
    const tampered = body.replace('支付成功', '支付成功（已核对）')
    assert.notStrictEqual(tampered, body, '夹具必须真的被改动')
    const event = await provider.parseWebhook({ rawBody: tampered, headers: signedHeaders(tampered) })
    assert.strictEqual(event.type, 'checkout.completed')
  })

  await t.test('nonce 不匹配 → 401（防重放：签名含 nonce）', async () => {
    const provider = makeProvider()
    const headers = signedHeaders(body, { 'Wechatpay-Nonce': 'nonce-2' })
    await assert.rejects(
      provider.parseWebhook({ rawBody: body, headers }),
      (err) => err.code === 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
    )
  })

  await t.test('过期时间戳 → 401 且不进入验签（先拒再算，省 CPU）', async () => {
    let verifyAttempted = false
    const provider = makeProvider({
      certificateProvider: { getBySerial: async () => { verifyAttempted = true; return SPKI_PEM } },
    })
    const staleTs = String(NOW_TS - 3600)
    await assert.rejects(
      provider.parseWebhook({
        rawBody: body,
        headers: signedHeaders(body, {
          'Wechatpay-Signature': sign(Number(staleTs), 'nonce-1', body),
          'Wechatpay-Timestamp': staleTs,
        }),
      }),
      (err) => err.code === 'PAYMENT_WEBHOOK_TIMESTAMP_STALE',
    )
    assert.strictEqual(verifyAttempted, false, '过期时间戳不得走到取证书/验签')
  })

  await t.test('未来时间戳超容差 → 401', async () => {
    const provider = makeProvider()
    const futureTs = String(NOW_TS + 3600)
    await assert.rejects(
      provider.parseWebhook({
        rawBody: body,
        headers: signedHeaders(body, {
          'Wechatpay-Signature': sign(Number(futureTs), 'nonce-1', body),
          'Wechatpay-Timestamp': futureTs,
        }),
      }),
      (err) => err.code === 'PAYMENT_WEBHOOK_TIMESTAMP_STALE',
    )
  })

  await t.test('缺任一签名头 → 401（四头齐备是硬前置）', async () => {
    const provider = makeProvider()
    const base = signedHeaders(body)
    for (const drop of Object.keys(base)) {
      const headers = { ...base }
      delete headers[drop]
      await assert.rejects(
        provider.parseWebhook({ rawBody: body, headers }),
        (err) => err.code === 'PAYMENT_WEBHOOK_HEADERS_INCOMPLETE',
        `缺 ${drop} 必须被拒`,
      )
    }
  })

  await t.test('未知证书序列号 → 401（不得跳过验签放行）', async () => {
    const provider = makeProvider()
    await assert.rejects(
      provider.parseWebhook({ rawBody: body, headers: signedHeaders(body, { 'Wechatpay-Serial': 'UNKNOWN000' }) }),
      (err) => err.code === 'PAYMENT_WEBHOOK_CERT_NOT_FOUND',
    )
  })

  await t.test('头名大小写不敏感（连字符形态的大小写变体）', async () => {
    // ⚠️ 必须是**连字符**形态的大小写变体。真实 Node http 头名是 'wechatpay-signature'；
    // 写成驼峰 'wechatpaySignature' 不是真实形态（那样断言的是错误的东西）。
    const provider = makeProvider()
    const event = await provider.parseWebhook({
      rawBody: body,
      headers: {
        'WECHATPAY-SIGNATURE': sign(NOW_TS, 'nonce-1', body),
        'WeChatPay-Serial': CERT_SERIAL,
        'WeChatPay-Timestamp': String(NOW_TS),
        'WECHATPAY-NONCE': 'nonce-1',
      },
    })
    assert.strictEqual(event.type, 'checkout.completed')
  })

  await t.test('body 超 256 KiB → 413', async () => {
    const provider = makeProvider()
    const big = JSON.stringify({ resource: { ciphertext: 'A'.repeat(300 * 1024) } })
    await assert.rejects(
      provider.parseWebhook({ rawBody: big, headers: signedHeaders(body) }),
      (err) => err.code === 'PAYMENT_WEBHOOK_BODY_TOO_LARGE' && err.status === 413,
    )
  })

  await t.test('时间戳非数字 → 401', async () => {
    const provider = makeProvider()
    await assert.rejects(
      provider.parseWebhook({ rawBody: body, headers: signedHeaders(body, { 'Wechatpay-Timestamp': 'abc' }) }),
      (err) => err.code === 'PAYMENT_WEBHOOK_TIMESTAMP_MALFORMED',
    )
  })
})

test('parseWebhook 解密与归一化', async (t) => {
  await t.test('TRANSACTION.FAIL → payment.failed，不推进订阅', async () => {
    const payload = makeNotification('TRANSACTION.FAIL', {
      out_trade_no: 'wpfail000001', transaction_id: 'tx-fail', trade_state: 'CLOSED', amount: { payer_total: 5900 },
    }, '支付失败')
    const event = await makeProvider().parseWebhook({ rawBody: payload, headers: signedHeaders(payload) })
    assert.strictEqual(event.type, 'payment.failed')
    assert.strictEqual(event.orderId, 'wpfail000001')
  })

  await t.test('REFUND.SUCCESS → refunded（本期只记录不动订阅）', async () => {
    const payload = makeNotification('REFUND.SUCCESS', {
      out_trade_no: 'wprefund00001', transaction_id: 'tx-r', amount: { payer_total: 5900 },
    }, '退款')
    const event = await makeProvider().parseWebhook({ rawBody: payload, headers: signedHeaders(payload) })
    assert.strictEqual(event.type, 'refunded')
  })

  await t.test('未登记事件类型 → type=null，幂等键回退 event_type:transaction_id', async () => {
    const payload = makeNotification('SOME.FUTURE.EVENT', {
      out_trade_no: '', transaction_id: 'tx-unknown', amount: {},
    }, '未知')
    const event = await makeProvider().parseWebhook({ rawBody: payload, headers: signedHeaders(payload) })
    assert.strictEqual(event.type, null)
    assert.strictEqual(event.externalEventId, 'SOME.FUTURE.EVENT:tx-unknown')
  })

  await t.test('密文被改 → 401（AEAD tag 校验失败）', async () => {
    const payload = JSON.parse(successBody())
    const original = payload.resource.ciphertext
    payload.resource.ciphertext = (original[0] === 'A' ? 'B' : 'A') + original.slice(1)
    const tampered = JSON.stringify(payload)
    await assert.rejects(
      makeProvider().parseWebhook({ rawBody: tampered, headers: signedHeaders(tampered) }),
      (err) => err.code === 'PAYMENT_WEBHOOK_DECRYPT_FAILED',
    )
  })

  await t.test('raw 只含白名单字段，不外泄整个 payload', async () => {
    // 必须先固定 body 再对它签名——makeNotification 每次生成不同 id，
    // 调两次 successBody() 会得到两个不同 body，签名必然不匹配。
    const fixed = successBody()
    const event = await makeProvider().parseWebhook({ rawBody: fixed, headers: signedHeaders(fixed) })
    assert.deepStrictEqual(Object.keys(event.raw).sort(), ['event_type', 'out_trade_no', 'summary', 'transaction_id'])
  })
})

/**
 * 外部评审（QM-6 / claude 家族）在 2026-10-21 抓出的两条 Critical 的回归锁。
 *
 * 这两条的共同特征是「**只坏对账/只坏生产**，界面与单测都看不出来」：
 *   - 金额字段读错：订阅照发（plan 不依赖金额），只有对账链路静默断掉
 *   - 裸 Base64 一律当证书：单测用 PEM 证书时全绿，上线换成「微信支付公钥」就全拒
 * 因此判据必须钉住**字段名**与**凭据形态分流**，不能只测「返回了个数」。
 */
test('外部评审 Critical 回归锁', async (t) => {
  const provider = makeProvider()

  await t.test('金额取订单总金额 total，不是实付 payer_total（有优惠时两者不等）', () => {
    // 这条是核心：若实现读 payer_total，用户在有用券/立减的订单上会把「实付」当「应收」记进对账
    assert.strictEqual(provider._amountCents({ total: 5900, payer_total: 4900, currency: 'CNY' }), 5900)
  })

  await t.test('只给 total 时不得静默变 null（老实现只读 payer_total 会返回 null）', () => {
    assert.strictEqual(provider._amountCents({ total: 5900, currency: 'CNY' }), 5900)
  })

  await t.test('只给 payer_total 时保底读取（异常报文兜底）', () => {
    assert.strictEqual(provider._amountCents({ payer_total: 4900 }), 4900)
  })

  await t.test('两者都没有 / 非数字 → null（绝不编造 0）', () => {
    assert.strictEqual(provider._amountCents({}), null)
    assert.strictEqual(provider._amountCents(null), null)
    assert.strictEqual(provider._amountCents({ total: 'abc' }), null)
  })

  await t.test('裸 Base64 的 SPKI 公钥（微信支付公钥模式）必须能验签通过', async () => {
    // 微信 2024 起从「平台证书」迁到「微信支付公钥」，配的是**无 PEM 头**的裸 Base64 公钥。
    // 老实现一律补 CERTIFICATE 头 ⇒ X509Certificate 抛 ASN.1 wrong tag ⇒ 所有回调被拒。
    const bareSpki = SPKI_PEM
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s+/g, '')
    const body = successBody({ outTradeNo: 'wpabc12345' })
    const headers = signedHeaders(body)
    // 返回**裸**公钥：不带任何 PEM 头（走既有 makeProvider，其余依赖照旧）
    const bareProvider = makeProvider({ certificateProvider: { getBySerial: async () => bareSpki } })
    const event = await bareProvider.parseWebhook({ rawBody: body, headers })
    // 本用例的被测性质是「验签通过」：裸 Base64 SPKI 能被正确识别为公钥。
    // orderId 取夹具默认值（不写死具体串，否则改夹具会连累这条判据）。
    assert.strictEqual(event.type, 'checkout.completed')
    assert.match(event.orderId, /^wp[a-z0-9]{8,64}$/)
    void provider
  })

  await t.test('裸 Base64 的垃圾串必须报 CERT_INVALID（不能被当成合法公钥放行）', () => {
    const { toVerifiableKey } = require('../src/auth/payment-providers/wechat-native')
    assert.throws(
      () => toVerifiableKey('AAAA'),
      (err) => err.code === 'PAYMENT_WEBHOOK_CERT_INVALID',
    )
  })
})