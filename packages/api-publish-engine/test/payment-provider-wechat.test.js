'use strict'
/**
 * WeChatNativeProvider 契约测试。
 *
 * 两个不可让的判据（AGENTS「取证口径」：被测性质是「这段代码会执行」时，判据不能只是
 * 「字符串存在于文件里」）：
 *   ① **真签名必须被接受、伪造签名必须被拒**——用真实 crypto 生成密钥对并真实签名，
 *      而不是 mock 掉 verify。mock 掉验签的测试证明不了验签有效。
 *   ② **解密必须真能解出明文**——用真实 AES-256-GCM 加密构造 resource，
 *      而不是直接传明文 JSON。
 *
 * 关于「平台证书」的取证边界（如实记录，不假装已闭合）：
 *   本机无 openssl、Node 无「造 X.509」API，因此夹具用 **SPKI 公钥**（PEM）作平台凭据，
 *   验签主路径（时间戳/四头/签名串/nonce/body 绑定/解密/归一化）全部**真实覆盖**。
 *   「X.509 证书 → X509Certificate 提公钥 → 验签」这条分支由 `toVerifiableKey()`
 *   的单独用例覆盖其反证面（非证书 PEM 不得走证书路径、裸 Base64 解析失败即 401）。
 *   为什么这样切分：证书分支的唯一风险是「把 SPKI 当证书用」的 ASN.1 wrong tag
 *   （实现里为此专门分流 PEM 头类型，已修），它不需要一整张真证书就能证伪。
 *
 * 零外发：fetcher / now / certificateProvider 全部注入，不碰网络、不碰真实凭据。
 */

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const {
  WeChatNativeProvider,
  buildVerifyString,
  decryptResource,
  toVerifiableKey,
} = require('../src/auth/payment-providers/wechat-native')
const {
  PaymentProvider,
  WebhookSignatureError,
} = require('../src/auth/payment-providers/index')

const API_V3_KEY = '0123456789abcdef0123456789abcdef' // 32 字节
const APPID = 'wx_test_appid'
const MCH_ID = '1600000000'
const CERT_SERIAL = 'TESTCERT0001'
const NOW_ISO = '2026-10-21T11:36:36Z'
const NOW_TS = Math.floor(new Date(NOW_ISO).getTime() / 1000)

// 真实 RSA 密钥对：测试用 crypto 真实签、真实验。
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const SPKI_PEM = publicKey.export({ type: 'spki', format: 'pem' })

function sign(timestamp, nonce, body) {
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(buildVerifyString({ timestamp, nonce, body }), 'utf8')
  return signer.sign(privateKey, 'base64')
}

function encryptResource(plain) {
  const key = Buffer.from(API_V3_KEY, 'utf8')
  const nonce = Buffer.from('0f8a1b2c3d4e5f60', 'utf8') // 16 字节
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from('resource-test', 'utf8'))
  const enc = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    original_type: 'transaction',
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    associated_data: 'resource-test',
    nonce: nonce.toString('utf8'),
    algorithm: 'AEAD_AES_256_GCM',
  }
}

function makeProvider(overrides = {}) {
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

/**
 * 构造微信 APIv3 通知体。**event_type 必须在外层明文**（不在加密的 resource 里）——
 * 这是真实结构：{ id, create_time, event_type, summary, resource:{ciphertext,nonce,associated_data} }。
 * 第一版夹具把 event_type 也塞进 resource，恰好让实现的错读法通过，属「夹具跟着错实现写」。
 */
function makeNotification(eventType, resourcePlain, summary) {
  return JSON.stringify({
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    create_time: '2026-10-21T19:36:37+08:00',
    event_type: eventType,
    summary: summary || eventType,
    resource: encryptResource(resourcePlain),
  })
}

function successBody() {
  return makeNotification('TRANSACTION.SUCCESS', {
    out_trade_no: 'wpmc0abc1234',
    transaction_id: '4200000000000000000000000001',
    trade_state: 'SUCCESS',
    success_time: '2026-10-21T19:36:36+08:00',
    amount: { payer_total: 5900, payer_currency: 'CNY' },
    mchid: MCH_ID,
    appid: APPID,
  }, '支付成功')
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

test('parseWebhook 验签（真签名 / 真伪造）', async (t) => {
  const body = successBody()

  await t.test('真签名 + 未过期时间戳 → 归一化为 checkout.completed', async () => {
    const provider = makeProvider()
    const event = await provider.parseWebhook({
      rawBody: body,
      headers: {
        'Wechatpay-Signature': sign(NOW_TS, 'nonce-1', body),
        'Wechatpay-Serial': CERT_SERIAL,
        'Wechatpay-Timestamp': String(NOW_TS),
        'Wechatpay-Nonce': 'nonce-1',
      },
    })
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
        headers: {
          'Wechatpay-Signature': Buffer.from('forged').toString('base64'),
          'Wechatpay-Serial': CERT_SERIAL,
          'Wechatpay-Timestamp': String(NOW_TS),
          'Wechatpay-Nonce': 'nonce-1',
        },
      }),
      (err) => err instanceof WebhookSignatureError && err.status === 401 && err.code === 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
    )
  })

  await t.test('改一个字节的 body → 401（证明验签绑的是 body 原文）', async () => {
    const provider = makeProvider()
    const tampered = body.replace('支付成功', '支付失败')
    assert.notStrictEqual(tampered, body, '夹具必须真的被改动')
    // 签名是对**原 body** 算的，body 被换 ⇒ 必须拒。
    // （这条锁的是「签名与 body 绑定」；反向那条「签名对被改后的 body 算」见下一条。）
    await assert.rejects(
      provider.parseWebhook({
        rawBody: tampered,
        headers: {
          'Wechatpay-Signature': sign(NOW_TS, 'nonce-1', body),
          'Wechatpay-Serial': CERT_SERIAL,
          'Wechatpay-Timestamp': String(NOW_TS),
          'Wechatpay-Nonce': 'nonce-1',
        },
      }),
      (err) => err.code === 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
    )
  })

  await t.test('摘要文案被改但签名同步重算 → 仍应通过（证明锁的是 body 原文而非某个字段）', async () => {
    // 这条是上一条的反向对照：签名对被改后的 body 重算，就应该过。
    // 少了它，「改 body 必拒」可能被实现成「只认某一组固定字节」而仍然全绿。
    const provider = makeProvider()
    const tampered = body.replace('支付成功', '支付成功（已核对）')
    assert.notStrictEqual(tampered, body, '夹具必须真的被改动')
    const event = await provider.parseWebhook({
      rawBody: tampered,
      headers: {
        'Wechatpay-Signature': sign(NOW_TS, 'nonce-1', tampered),
        'Wechatpay-Serial': CERT_SERIAL,
        'Wechatpay-Timestamp': String(NOW_TS),
        'Wechatpay-Nonce': 'nonce-1',
      },
    })
    assert.strictEqual(event.type, 'checkout.completed')
  })

  await t.test('nonce 不匹配 → 401（防重放：签名含 nonce）', async () => {
    const provider = makeProvider()
    await assert.rejects(
      provider.parseWebhook({
        rawBody: body,
        headers: {
          'Wechatpay-Signature': sign(NOW_TS, 'nonce-1', body),
          'Wechatpay-Serial': CERT_SERIAL,
          'Wechatpay-Timestamp': String(NOW_TS),
          'Wechatpay-Nonce': 'nonce-2',
        },
      }),
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
        headers: {
          'Wechatpay-Signature': sign(Number(staleTs), 'n', body),
          'Wechatpay-Serial': CERT_SERIAL,
          'Wechatpay-Timestamp': staleTs,
          'Wechatpay-Nonce': 'n',
        },
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
        headers: {
          'Wechatpay-Signature': sign(Number(futureTs), 'n', body),
          'Wechatpay-Serial': CERT_SERIAL,
          'Wechatpay-Timestamp': futureTs,
          'Wechatpay-Nonce': 'n',
        },
      }),
      (err) => err.code === 'PAYMENT_WEBHOOK_TIMESTAMP_STALE',
    )
  })

  await t.test('缺任一签名头 → 401（四头齐备是硬前置）', async () => {
    const provider = makeProvider()
    const base = {
      'Wechatpay-Signature': sign(NOW_TS, 'n', body),
      'Wechatpay-Serial': CERT_SERIAL,
      'Wechatpay-Timestamp': String(NOW_TS),
      'Wechatpay-Nonce': 'n',
    }
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
      provider.parseWebhook({
        rawBody: body,
        headers: {
          'Wechatpay-Signature': sign(NOW_TS, 'n', body),
          'Wechatpay-Serial': 'UNKNOWN000',
          'Wechatpay-Timestamp': String(NOW_TS),
          'Wechatpay-Nonce': 'n',
        },
      }),
      (err) => err.code === 'PAYMENT_WEBHOOK_CERT_NOT_FOUND',
    )
  })

  await t.test('头名大小写不敏感（Node 已小写化，但代理/夹具可能是任意大小写）', async () => {
    // ⚠️ 必须是**连字符**形态的大小写变体。真实 Node http 头名是 'wechatpay-signature'；
    // 写成驼峰 'wechatpaySignature' 不是真实形态（那样断言的是错误的东西）。
    const provider = makeProvider()
    const event = await provider.parseWebhook({
      rawBody: body,
      headers: {
        'WECHATPAY-SIGNATURE': sign(NOW_TS, 'n', body),
        'WeChatPay-Serial': CERT_SERIAL,
        'WeChatPay-Timestamp': String(NOW_TS),
        'WECHATPAY-NONCE': 'n',
      },
    })
    assert.strictEqual(event.type, 'checkout.completed')
  })

  await t.test('body 超 256 KiB → 413', async () => {
    const provider = makeProvider()
    const big = JSON.stringify({ resource: { ciphertext: 'A'.repeat(300 * 1024) } })
    await assert.rejects(
      provider.parseWebhook({
        rawBody: big,
        headers: {
          'Wechatpay-Signature': 'x', 'Wechatpay-Serial': CERT_SERIAL,
          'Wechatpay-Timestamp': String(NOW_TS), 'Wechatpay-Nonce': 'n',
        },
      }),
      (err) => err.code === 'PAYMENT_WEBHOOK_BODY_TOO_LARGE' && err.status === 413,
    )
  })

  await t.test('时间戳非数字 → 401', async () => {
    const provider = makeProvider()
    await assert.rejects(
      provider.parseWebhook({
        rawBody: body,
        headers: {
          'Wechatpay-Signature': 'x', 'Wechatpay-Serial': CERT_SERIAL,
          'Wechatpay-Timestamp': 'abc', 'Wechatpay-Nonce': 'n',
        },
      }),
      (err) => err.code === 'PAYMENT_WEBHOOK_TIMESTAMP_MALFORMED',
    )
  })
})

test('parseWebhook 解密与归一化', async (t) => {
  await t.test('TRANSACTION.FAIL → payment.failed，不推进订阅', async () => {
    const payload = makeNotification('TRANSACTION.FAIL', {
      out_trade_no: 'wpfail000001', transaction_id: 'tx-fail', trade_state: 'CLOSED', amount: { payer_total: 5900 },
    }, '支付失败')
    const provider = makeProvider()
    const event = await provider.parseWebhook({
      rawBody: payload,
      headers: {
        'Wechatpay-Signature': sign(NOW_TS, 'n', payload), 'Wechatpay-Serial': CERT_SERIAL,
        'Wechatpay-Timestamp': String(NOW_TS), 'Wechatpay-Nonce': 'n',
      },
    })
    assert.strictEqual(event.type, 'payment.failed')
    assert.strictEqual(event.orderId, 'wpfail000001')
  })

  await t.test('REFUND.SUCCESS → refunded（本期只记录不动订阅）', async () => {
    const payload = makeNotification('REFUND.SUCCESS', {
      out_trade_no: 'wprefund00001', transaction_id: 'tx-r', amount: { payer_total: 5900 },
    }, '退款')
    const provider = makeProvider()
    const event = await provider.parseWebhook({
      rawBody: payload,
      headers: {
        'Wechatpay-Signature': sign(NOW_TS, 'n', payload), 'Wechatpay-Serial': CERT_SERIAL,
        'Wechatpay-Timestamp': String(NOW_TS), 'Wechatpay-Nonce': 'n',
      },
    })
    assert.strictEqual(event.type, 'refunded')
  })

  await t.test('未登记事件类型 → type=null，幂等键回退 event_type:transaction_id', async () => {
    const payload = makeNotification('SOME.FUTURE.EVENT', {
      out_trade_no: '', transaction_id: 'tx-unknown', amount: {},
    }, '未知')
    const provider = makeProvider()
    const event = await provider.parseWebhook({
      rawBody: payload,
      headers: {
        'Wechatpay-Signature': sign(NOW_TS, 'n', payload), 'Wechatpay-Serial': CERT_SERIAL,
        'Wechatpay-Timestamp': String(NOW_TS), 'Wechatpay-Nonce': 'n',
      },
    })
    assert.strictEqual(event.type, null)
    assert.strictEqual(event.externalEventId, 'SOME.FUTURE.EVENT:tx-unknown')
  })

  await t.test('密文被改 → 401（AEAD tag 校验失败）', async () => {
    const payload = JSON.parse(successBody())
    const original = payload.resource.ciphertext
    payload.resource.ciphertext = (original[0] === 'A' ? 'B' : 'A') + original.slice(1)
    const tampered = JSON.stringify(payload)
    const provider = makeProvider()
    await assert.rejects(
      provider.parseWebhook({
        rawBody: tampered,
        headers: {
          'Wechatpay-Signature': sign(NOW_TS, 'n', tampered), 'Wechatpay-Serial': CERT_SERIAL,
          'Wechatpay-Timestamp': String(NOW_TS), 'Wechatpay-Nonce': 'n',
        },
      }),
      (err) => err.code === 'PAYMENT_WEBHOOK_DECRYPT_FAILED',
    )
  })

  await t.test('raw 只含白名单字段，不外泄整个 payload', async () => {
    const provider = makeProvider()
    // 必须先固定 body 再对它签名——makeNotification 每次生成不同 id，
    // 调两次 successBody() 会得到两个不同 body，签名必然不匹配。
    const fixed = successBody()
    const event = await provider.parseWebhook({
      rawBody: fixed,
      headers: {
        'Wechatpay-Signature': sign(NOW_TS, 'n', fixed), 'Wechatpay-Serial': CERT_SERIAL,
        'Wechatpay-Timestamp': String(NOW_TS), 'Wechatpay-Nonce': 'n',
      },
    })
    assert.deepStrictEqual(Object.keys(event.raw).sort(), ['event_type', 'out_trade_no', 'summary', 'transaction_id'])
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
