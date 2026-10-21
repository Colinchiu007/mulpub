'use strict'
/**
 * 微信支付测试夹具（非 `.test.js`，不被 run-tests.js 当测试文件发现）。
 *
 * 为什么抽出来：两个契约测试文件（provider 契约 / webhook 验签）共用同一套
 * 真实 crypto 夹具。复制两份的代价不是行数，而是**两处会漂移**——
 * 一处改了签名串拼接方式，另一处的负例就变成在测空气。
 *
 * 关键纪律（AGENTS 取证口径）：
 *   - 验签用**真实** RSA 密钥对真实签/真实验，绝不 mock 掉 verify。
 *   - 解密用**真实** AES-256-GCM 加密构造 resource，绝不传明文 JSON。
 *   - `event_type` 必须放**外层明文**（真实微信 APIv3 结构），不得塞进 resource。
 */

const crypto = require('node:crypto')

const API_V3_KEY = '0123456789abcdef0123456789abcdef' // 32 字节
const APPID = 'wx_test_appid'
const MCH_ID = '1600000000'
const CERT_SERIAL = 'TESTCERT0001'
const NOW_ISO = '2026-10-21T11:36:36Z'
const NOW_TS = Math.floor(new Date(NOW_ISO).getTime() / 1000)

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const SPKI_PEM = publicKey.export({ type: 'spki', format: 'pem' })

/** 构造待验签串：`timestamp\nnonce\nbody\n`（尾换行不可少，少它签名永远对不上）。 */
function buildVerifyString ({ timestamp, nonce, body }) {
  return `${timestamp}\n${nonce}\n${body}\n`
}

/** 用测试私钥对 (timestamp, nonce, body) 真实签名。 */
function sign (timestamp, nonce, body) {
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(buildVerifyString({ timestamp, nonce, body }), 'utf8')
  return signer.sign(privateKey, 'base64')
}

/** 真实 AES-256-GCM 加密，产出微信 APIv3 的 resource 形状。 */
function encryptResource (plain) {
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

/**
 * 构造微信 APIv3 通知体。`event_type` 在外层明文，不在加密的 resource 里——
 * 这是真实结构：{ id, create_time, event_type, summary, resource:{ciphertext,nonce,associated_data} }。
 */
function makeNotification (eventType, resourcePlain, summary) {
  return JSON.stringify({
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    create_time: '2026-10-21T19:36:37+08:00',
    event_type: eventType,
    summary: summary || eventType,
    resource: encryptResource(resourcePlain),
  })
}

function successBody () {
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

/** 构造完整签名头组（四头齐备）。 */
function signedHeaders (body, overrides = {}) {
  return {
    'Wechatpay-Signature': sign(NOW_TS, 'nonce-1', body),
    'Wechatpay-Serial': CERT_SERIAL,
    'Wechatpay-Timestamp': String(NOW_TS),
    'Wechatpay-Nonce': 'nonce-1',
    ...overrides,
  }
}

module.exports = {
  API_V3_KEY,
  APPID,
  MCH_ID,
  CERT_SERIAL,
  NOW_ISO,
  NOW_TS,
  privateKey,
  SPKI_PEM,
  buildVerifyString,
  sign,
  encryptResource,
  makeNotification,
  successBody,
  signedHeaders,
}
