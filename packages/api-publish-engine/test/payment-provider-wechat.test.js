'use strict'
/**
 * WeChatNativeProvider 契约测试 · 部分 A：抽象契约 / 下单 / 凭据形态 / 解密。
 * 部分 B（webhook 验签与归一化）见 payment-provider-wechat-webhook.test.js。
 *
 * 为什么分两文件：单文件 566 行会顶破仓库 `filesOver500` 债务基线（实测 96 > baseline 95）。
 * 抬高基线掩盖自己引入的债务是明确禁止的（AGENTS「未抬高基线掩盖」），所以拆。
 *
 * 共享夹具在 helpers/wechat-payment-fixtures.js（真实 crypto + 真实 AES-GCM）。
 */

const test = require('node:test')
const assert = require('node:assert')
const {
  WeChatNativeProvider,
  decryptResource,
  toVerifiableKey,
} = require('../src/auth/payment-providers/wechat-native')
const {
  PaymentProvider,
} = require('../src/auth/payment-providers/index')
const {
  API_V3_KEY,
  APPID,
  MCH_ID,
  CERT_SERIAL,
  NOW_ISO,
  SPKI_PEM,
  encryptResource,
} = require('./helpers/wechat-payment-fixtures')

function makeProvider (overrides = {}) {
  return new WeChatNativeProvider({
    appid: APPID,
    mchId: MCH_ID,
    apiV3Key: API_V3_KEY,
    notifyUrl: 'https://example.test/api/v1/webhooks/payment',
    fetcher: overrides.fetcher || (async () => ({ ok: true, json: async () => ({ code_url: 'weixin://wxpay/bizpayurl?pr=ABC' }) })),
    now: overrides.now || (() => new Date(NOW_ISO)),
    certificateProvider: overrides.certificateProvider || {
      getBySerial: async (serial) => (serial === CERT_SERIAL ? SPKI_PEM : null),
    },
    signRequest: overrides.signRequest,
  })
}

test('PaymentProvider 抽象契约', async (t) => {
  await t.test('抽象类不得直接实例化', () => {
    assert.throws(() => new PaymentProvider({}), TypeError)
  })

  await t.test('子类未实现方法即抛错（不是静默返回 undefined）', async () => {
    class Half extends PaymentProvider {}
    const p = new Half({})
    await assert.rejects(p.createCheckout({}), TypeError)
    await assert.rejects(p.parseWebhook({}), TypeError)
  })

  await t.test('capabilities 默认全 false（安全默认值：漏声明 = 功能不出现）', () => {
    const caps = PaymentProvider.prototype.capabilities.call({})
    for (const key of ['immediateCancel', 'refunds', 'proration', 'autoRenewToggle', 'trial', 'coupons', 'customerPortal']) {
      assert.strictEqual(caps[key], false, `${key} 默认必须为 false`)
    }
  })

  await t.test('构造期缺 appid/mchId/apiV3Key/notifyUrl/fetcher 一律 fail closed', () => {
    const base = { appid: APPID, mchId: MCH_ID, apiV3Key: API_V3_KEY, notifyUrl: 'https://x.test/y' }
    assert.throws(() => new WeChatNativeProvider({}), TypeError)
    assert.throws(() => new WeChatNativeProvider({ ...base, appid: undefined }), TypeError)
    assert.throws(() => new WeChatNativeProvider({ ...base, mchId: undefined }), TypeError)
    assert.throws(() => new WeChatNativeProvider({ ...base, apiV3Key: 'short' }), TypeError)
    assert.throws(() => new WeChatNativeProvider({ ...base, notifyUrl: undefined }), TypeError)
    // 没有 fetcher 也不许建（否则默认走真实网络）
    assert.throws(() => new WeChatNativeProvider(base), TypeError)
  })
})

test('createCheckout', async (t) => {
  await t.test('金额单位为分、attach 被 JSON 序列化、out_trade_no 透传', async () => {
    const calls = []
    const provider = makeProvider({
      fetcher: async (url, init) => {
        calls.push({ url, init })
        return { ok: true, json: async () => ({ code_url: 'weixin://wxpay/bizpayurl?pr=XYZ' }) }
      },
    })
    const out = await provider.createCheckout({
      orderId: 'wpabc123xyz', plan: 'standard', period: 'month', amountCents: 5900,
      attach: { orderId: 'wpabc123xyz', userId: 'user-1' },
    })
    assert.strictEqual(out.codeUrl, 'weixin://wxpay/bizpayurl?pr=XYZ')
    const sent = JSON.parse(calls[0].init.body)
    assert.strictEqual(sent.amount.total, 5900)
    assert.strictEqual(sent.amount.currency, 'CNY')
    assert.strictEqual(sent.out_trade_no, 'wpabc123xyz')
    assert.strictEqual(sent.notify_url, 'https://example.test/api/v1/webhooks/payment')
    assert.deepStrictEqual(JSON.parse(sent.attach), { orderId: 'wpabc123xyz', userId: 'user-1' })
    // 不得把 plan/period 当供应商字段直接塞（description 是唯一展示位）
    assert.strictEqual(sent.plan, undefined)
    assert.strictEqual(sent.period, undefined)
  })

  await t.test('订单号形状非法 → 400，不发请求', async () => {
    let called = false
    const provider = makeProvider({ fetcher: async () => { called = true; return { ok: true, json: async () => ({}) } } })
    await assert.rejects(
      provider.createCheckout({ orderId: 'BAD-ORDER', plan: 'pro', period: 'month', amountCents: 11900 }),
      (err) => err.code === 'PAYMENT_ORDER_ID_INVALID' && err.status === 400,
    )
    assert.strictEqual(called, false)
  })

  await t.test('金额非正整数 → 400，不发请求（防 0 元单）', async () => {
    let called = false
    const provider = makeProvider({ fetcher: async () => { called = true; return { ok: true, json: async () => ({}) } } })
    await assert.rejects(
      provider.createCheckout({ orderId: 'wpabc123xyz', plan: 'pro', period: 'month', amountCents: 0 }),
      (err) => err.code === 'PAYMENT_AMOUNT_INVALID' && err.status === 400,
    )
    assert.strictEqual(called, false)
  })

  await t.test('微信返回错误体 → 502 且原样带 code 供对账', async () => {
    const provider = makeProvider({
      fetcher: async () => ({ ok: true, json: async () => ({ code: 'OUT_TRADE_NO_USED', message: '商户订单号重复' }) }),
    })
    await assert.rejects(
      provider.createCheckout({ orderId: 'wpabc123xyz', plan: 'pro', period: 'month', amountCents: 11900 }),
      (err) => err.code === 'PAYMENT_PROVIDER_UPSTREAM_REJECTED' && err.status === 502 && /OUT_TRADE_NO_USED/.test(err.message),
    )
  })

  await t.test('网络抛错 → 502（订单留 pending，由调用方决定重试）', async () => {
    const provider = makeProvider({ fetcher: async () => { throw new Error('ECONNRESET') } })
    await assert.rejects(
      provider.createCheckout({ orderId: 'wpabc123xyz', plan: 'pro', period: 'month', amountCents: 11900 }),
      (err) => err.code === 'PAYMENT_PROVIDER_UPSTREAM_FAILED' && /ECONNRESET/.test(err.message),
    )
  })

  await t.test('注入 signRequest 时其返回的头被合并（商户证书签名路径可测）', async () => {
    const calls = []
    const provider = makeProvider({
      fetcher: async (url, init) => { calls.push(init); return { ok: true, json: async () => ({ code_url: 'weixin://x' }) } },
      signRequest: () => ({ Authorization: 'WECHATPAY2-SHA256-RSA2048 test-sig' }),
    })
    await provider.createCheckout({ orderId: 'wpabc123xyz', plan: 'pro', period: 'month', amountCents: 11900 })
    assert.strictEqual(calls[0].headers.Authorization, 'WECHATPAY2-SHA256-RSA2048 test-sig')
  })
})

test('toVerifiableKey 凭据形态分流', async (t) => {
  await t.test('SPKI 公钥 PEM 原样通过（不误包成证书头）', () => {
    // 断言「等价可用」而非「逐字节同一」：实现做了 trim，首尾空白可能不同，
    // 但交给 crypto.createVerify().verify() 的是同一个公钥。
    const out = toVerifiableKey(SPKI_PEM)
    assert.strictEqual(out.trim(), SPKI_PEM.trim())
    assert.match(out, /^-----BEGIN PUBLIC KEY-----/)
  })

  await t.test('空值 → 401', () => {
    assert.throws(() => toVerifiableKey(''), (err) => err.code === 'PAYMENT_WEBHOOK_CERT_MISSING')
    assert.throws(() => toVerifiableKey(null), (err) => err.code === 'PAYMENT_WEBHOOK_CERT_MISSING')
  })

  await t.test('伪装成证书的非法内容 → 401（不得静默放行）', () => {
    const certLike = '-----BEGIN CERTIFICATE-----\nnot-base64!!!\n-----END CERTIFICATE-----'
    assert.throws(() => toVerifiableKey(certLike), (err) => err.code === 'PAYMENT_WEBHOOK_CERT_INVALID')
  })

  await t.test('裸 Base64（无 PEM 头）按证书补头后解析失败 → 401', () => {
    assert.throws(() => toVerifiableKey('AAAA'), (err) => err.code === 'PAYMENT_WEBHOOK_CERT_INVALID')
  })
})

test('decryptResource 单测', async (t) => {
  await t.test('密钥长度非 32 → 401（不得静默用错密钥解出垃圾）', () => {
    assert.throws(
      () => decryptResource({ apiV3Key: 'short', resource: encryptResource({ a: 1 }) }),
      (err) => err.code === 'PAYMENT_WEBHOOK_KEY_INVALID',
    )
  })

  await t.test('ciphertext 过短（≤16 字节，tag 都放不下）→ 401', () => {
    assert.throws(
      () => decryptResource({ apiV3Key: API_V3_KEY, resource: { ciphertext: Buffer.from('short').toString('base64'), nonce: '0f8a1b2c3d4e5f60' } }),
      (err) => err.code === 'PAYMENT_WEBHOOK_RESOURCE_MALFORMED',
    )
  })

  await t.test('associated_data 不匹配 → 解密失败（AAD 也是完整性的一部分）', () => {
    const resource = encryptResource({ hello: 'world' })
    const tampered = { ...resource, associated_data: 'wrong-aad' }
    assert.throws(
      () => decryptResource({ apiV3Key: API_V3_KEY, resource: tampered }),
      (err) => err.code === 'PAYMENT_WEBHOOK_DECRYPT_FAILED',
    )
  })

  await t.test('真加密 → 真解出原对象（证明解密路径可用，不是形状存在）', () => {
    const plain = { out_trade_no: 'wproundtrip01', amount: { payer_total: 11900 } }
    const out = decryptResource({ apiV3Key: API_V3_KEY, resource: encryptResource(plain) })
    assert.deepStrictEqual(out, plain)
  })
})
