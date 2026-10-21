'use strict'
/**
 * WeChatNativeProvider — 微信 Native（扫码）支付适配器。
 *
 * 契约：packages/api-publish-engine/src/auth/payment-providers/index.js
 * 规格：01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md §6
 *
 * **零外发纪律**：所有 HTTP 经注入的 fetcher，所有时间经注入的 now()，平台证书经注入的
 * certificateProvider。测试因此不碰网络、不碰真实商户凭据（同 shipinhao-capabilities.js:16）。
 *
 * APIv3 两个最易错点，都在这里集中处理：
 *   ① **验签必须先于解析**：四头（Signature / Serial / Timestamp / Nonce）齐备且时间戳
 *      在容差内，才允许 JSON.parse。先解析再验签等于把不可信字节喂给业务字段。
 *   ② **resource 是加密的**：微信 APIv3 通知体的 resource 字段是 AEAD_AES_256_GCM 密文，
 *      密钥是 APIv3 密钥（32 字节）。直接读明文字段会拿到 undefined 且不报错。
 */

const crypto = require('crypto')
const {
  WebhookSignatureError,
  PaymentProviderError,
} = require('./index')

const WECHAT_API_BASE = 'https://api.mch.weixin.qq.com'
// 时间戳容差（秒）。上游 P2 spec §8 建议 5 分钟；取 300。
const MAX_TIMESTAMP_SKEW_SECONDS = 300
// 请求体上限（字节）。与 Logto webhook 的 256 KiB 同口径。
const MAX_BODY_BYTES = 256 * 1024

// 归一化映射：微信事件类型 → 我们的归一化类型。未登记的返回 null（调用方记 ignored）。
const EVENT_TYPE_MAP = Object.freeze({
  'TRANSACTION.SUCCESS': 'checkout.completed',
  'TRANSACTION.FAIL': 'payment.failed',
  'REFUND.SUCCESS': 'refunded',
  'REFUND.CLOSED': 'refunded',
})

/**
 * 构造待验签串。微信口径：`timestamp\nnonce\nbody\n`，三者以换行拼接、body 后还有一个换行。
 * 少那个尾换行是经典错误——签名算得出来但永远对不上，且报错信息只会说「验签失败」。
 */
function buildVerifyString({ timestamp, nonce, body }) {
  return `${timestamp}\n${nonce}\n${body}\n`
}

/** RSA-SHA256 验签。公钥非法/不匹配一律抛 WebhookSignatureError（401），不得静默放行。 */
function verifySignature({ platformCredential, verifyString, signature }) {
  let normalizedSignature = String(signature == null ? '' : signature).trim()
  if (!normalizedSignature) {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_SIGNATURE_MISSING', '缺少签名头')
  }
  // 微信签名是 Base64；容错接受带 padding 变体与 URL-safe 变体，但不接受空串与明显非 Base64 串。
  if (!/^[A-Za-z0-9+/=_-]+$/.test(normalizedSignature)) {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_SIGNATURE_MALFORMED', '签名头不是 Base64')
  }
  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(verifyString, 'utf8')
  let ok = false
  try {
    ok = verifier.verify(toVerifiableKey(platformCredential), normalizedSignature, 'base64')
  } catch {
    // createVerify().verify() 在密钥不可解析时抛错；抛错即验签失败，不得冒泡成 500。
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_CERT_INVALID', '平台证书不可用')
  }
  if (!ok) {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_SIGNATURE_INVALID', '签名校验失败')
  }
}

/**
 * 平台凭据归一化为「verify() 能吃的 PEM」。
 *
 * 为什么必须按 PEM 头类型分流（实测踩过）：微信 `/v3/certificates` 返回的是 **X.509 证书**
 * （`BEGIN CERTIFICATE`），而 `crypto.createVerify().verify()` 接受证书、也接受裸公钥，
 * 但**不能**接受「把 SPKI 公钥包进 CERTIFICATE 头」的东西——那会抛
 * `error:068000A8:asn1 encoding routines::wrong tag`，而错误信息只说「ASN.1 错」，
 * 完全不提示「你把公钥当证书用了」。第一版就是这么写的，所有真签名用例全红。
 *
 * 三种合法输入：
 *   ① `BEGIN CERTIFICATE`  → X.509 证书，经 X509Certificate 提公钥后交给 verify()
 *   ② `BEGIN PUBLIC KEY`  → SPKI 公钥，原样用
 *   ③ 裸 Base64（无 PEM 头）→ 按证书补头（微信平台证书的标准形态）
 */
function toVerifiableKey(platformCredential) {
  const value = String(platformCredential == null ? '' : platformCredential).trim()
  if (!value) {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_CERT_MISSING', '未配置平台证书')
  }
  let pem = value
  if (!pem.includes('-----BEGIN')) {
    // 裸 Base64：按 X.509 证书补头（微信平台证书的标准形态）
    pem = `-----BEGIN CERTIFICATE-----\n${pem}\n-----END CERTIFICATE-----`
  }
  if (pem.includes('BEGIN CERTIFICATE')) {
    try {
      const cert = new crypto.X509Certificate(pem)
      return cert.publicKey.export({ type: 'spki', format: 'pem' })
    } catch {
      throw new WebhookSignatureError('PAYMENT_WEBHOOK_CERT_INVALID', '平台证书不是合法 X.509')
    }
  }
  return pem
}

/**
 * AEAD_AES_256_GCM 解密 resource。
 * 微信口径：ciphertext = Base64(resource.ciphertext)，nonce = resource.nonce，
 * additionalData = resource.associated_data，tag 取 ciphertext 末 16 字节。
 * 任一步失败抛 WebhookSignatureError——密文被改动或密钥不对，等同不可信。
 */
function decryptResource({ apiV3Key, resource }) {
  if (!resource || typeof resource !== 'object') {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_RESOURCE_MISSING', '通知体缺少 resource')
  }
  const key = String(apiV3Key || '')
  if (key.length !== 32) {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_KEY_INVALID', 'APIv3 密钥必须是 32 字节')
  }
  const { ciphertext, nonce, associated_data: associatedData } = resource
  if (typeof ciphertext !== 'string' || typeof nonce !== 'string') {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_RESOURCE_MALFORMED', 'resource 字段缺失或类型错误')
  }
  let buffer
  try {
    buffer = Buffer.from(ciphertext, 'base64')
  } catch {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_RESOURCE_MALFORMED', 'ciphertext 不是 Base64')
  }
  if (buffer.length <= 16) {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_RESOURCE_MALFORMED', 'ciphertext 过短')
  }
  const tag = buffer.subarray(buffer.length - 16)
  const data = buffer.subarray(0, buffer.length - 16)
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), Buffer.from(nonce, 'utf8'))
    decipher.setAuthTag(tag)
    if (typeof associatedData === 'string' && associatedData.length > 0) {
      decipher.setAAD(Buffer.from(associatedData, 'utf8'))
    }
    const plain = Buffer.concat([decipher.update(data), decipher.final()])
    return JSON.parse(plain.toString('utf8'))
  } catch {
    throw new WebhookSignatureError('PAYMENT_WEBHOOK_DECRYPT_FAILED', 'resource 解密失败')
  }
}

/** 我方订单号格式：`wp` + base36 时间戳 + base36 随机。服务端生成，这里只校验形状。 */
const OUT_TRADE_NO_PATTERN = /^wp[a-z0-9]{8,64}$/

class WeChatNativeProvider {
  /**
   * @param {object} options
   * @param {string} options.appid 应用 ID
   * @param {string} options.mchId 商户号
   * @param {string} options.apiV3Key APIv3 密钥（32 字节）
   * @param {string} options.notifyUrl 回调完整 URL
   * @param {function} options.fetcher (url, init) => Promise<Response>（注入，测试零外发）
   * @param {function} options.now () => Date（注入）
   * @param {object} options.certificateProvider { getBySerial(serial) → Promise<string|null> }（注入）
   * @param {function} [options.signRequest] 商户证书签名器（下单用）
   */
  constructor(options = {}) {
    const { appid, mchId, apiV3Key, notifyUrl } = options
    if (!appid) throw new TypeError('WeChatNativeProvider 需要 appid')
    if (!mchId) throw new TypeError('WeChatNativeProvider 需要 mchId')
    if (typeof apiV3Key !== 'string' || apiV3Key.length !== 32) {
      throw new TypeError('WeChatNativeProvider 需要 32 字节 apiV3Key')
    }
    if (!notifyUrl) throw new TypeError('WeChatNativeProvider 需要 notifyUrl')
    if (typeof options.fetcher !== 'function') {
      throw new TypeError('WeChatNativeProvider 需要注入 fetcher（禁止默认走真实网络）')
    }
    this.appid = appid
    this.mchId = mchId
    this.apiV3Key = apiV3Key
    this.notifyUrl = notifyUrl
    this.fetcher = options.fetcher
    this.now = typeof options.now === 'function' ? options.now : () => new Date()
    this.certificateProvider = options.certificateProvider || null
    this.signRequest = options.signRequest || null
  }

  capabilities() {
    // 微信 Native 的能力边界：全 false 是诚实的数据（见文件头说明）。
    return {
      immediateCancel: false,
      refunds: false,
      proration: false,
      autoRenewToggle: false,
      trial: false,
      coupons: false,
      customerPortal: false,
    }
  }

  /**
   * 下单。金额单位是**分**（微信 Native 的 total 字段），服务端已算好，这里原样传。
   * attach 编码 { orderId, userId }——微信会原样回传，是 webhook 落定用户的关键
   * （微信回调不携带我们的 user_id）。
   */
  async createCheckout({ orderId, plan, period, amountCents, currency = 'CNY', attach }) {
    if (!OUT_TRADE_NO_PATTERN.test(String(orderId || ''))) {
      throw new PaymentProviderError('PAYMENT_ORDER_ID_INVALID', '订单号格式不合法', 400)
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new PaymentProviderError('PAYMENT_AMOUNT_INVALID', '金额必须为正整数（分）', 400)
    }
    const body = {
      appid: this.appid,
      mchid: this.mchId,
      description: `Multi-Publish ${plan} ${period === 'year' ? '年付' : '月付'}`,
      out_trade_no: orderId,
      notify_url: this.notifyUrl,
      amount: { total: amountCents, currency },
      ...(attach ? { attach: JSON.stringify(attach) } : {}),
    }
    let response
    try {
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      }
      if (typeof this.signRequest === 'function') {
        Object.assign(init.headers, this.signRequest('POST', '/v3/pay/transactions/native', body))
      }
      response = await this.fetcher(`${WECHAT_API_BASE}/v3/pay/transactions/native`, init)
    } catch (error) {
      throw new PaymentProviderError('PAYMENT_PROVIDER_UPSTREAM_FAILED', '微信下单请求失败：' + (error && error.message))
    }
    if (!response || response.ok !== true || typeof response.json !== 'function') {
      throw new PaymentProviderError('PAYMENT_PROVIDER_UPSTREAM_FAILED', '微信下单返回异常')
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new PaymentProviderError('PAYMENT_PROVIDER_UPSTREAM_FAILED', '微信下单响应不可解析')
    }
    if (payload && payload.code) {
      // 微信错误体形如 { code: 'PARAM_ERROR', message: '...' }；原样上抛 code 供对账。
      throw new PaymentProviderError(
        'PAYMENT_PROVIDER_UPSTREAM_REJECTED',
        `微信下单被拒：${payload.code} ${payload.message || ''}`.trim(),
        502,
      )
    }
    if (!payload || typeof payload.code_url !== 'string' || !payload.code_url) {
      throw new PaymentProviderError('PAYMENT_PROVIDER_UPSTREAM_FAILED', '微信下单未返回 code_url')
    }
    return { codeUrl: payload.code_url, expiresAt: null }
  }

  /**
   * 验签 + 解密 + 归一化。**顺序不可换**：body 大小 → 四头齐备 → 时间戳 → 取证书 → 验签
   * → 解密 → 归一化。任何一步失败抛 WebhookSignatureError（401）。
   */
  async parseWebhook({ rawBody, headers = {} }) {
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody == null ? '' : rawBody)
    if (!body) throw new WebhookSignatureError('PAYMENT_WEBHOOK_BODY_EMPTY', '请求体为空')
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new WebhookSignatureError('PAYMENT_WEBHOOK_BODY_TOO_LARGE', '请求体超过 256 KiB', 413)
    }

    // 头名统一小写比较（Node 的 http.IncomingHttpHeaders 已小写，但注入的夹具可能是任意大小写）
    const readHeader = (name) => {
      const lower = name.toLowerCase()
      for (const [key, value] of Object.entries(headers)) {
        if (String(key).toLowerCase() === lower) return value
      }
      return undefined
    }
    const signature = readHeader('Wechatpay-Signature')
    const serial = readHeader('Wechatpay-Serial')
    const timestamp = readHeader('Wechatpay-Timestamp')
    const nonce = readHeader('Wechatpay-Nonce')

    if (!signature || !serial || !timestamp || !nonce) {
      throw new WebhookSignatureError('PAYMENT_WEBHOOK_HEADERS_INCOMPLETE', '缺少微信签名四头')
    }
    if (!/^\d{1,20}$/.test(String(timestamp))) {
      throw new WebhookSignatureError('PAYMENT_WEBHOOK_TIMESTAMP_MALFORMED', '时间戳不是数字')
    }
    const nowSeconds = Math.floor(this.now().getTime() / 1000)
    const skew = Math.abs(nowSeconds - Number(timestamp))
    if (skew > MAX_TIMESTAMP_SKEW_SECONDS) {
      throw new WebhookSignatureError('PAYMENT_WEBHOOK_TIMESTAMP_STALE', `时间戳偏离 ${skew}s 超过 ${MAX_TIMESTAMP_SKEW_SECONDS}s`)
    }

    if (!this.certificateProvider || typeof this.certificateProvider.getBySerial !== 'function') {
      throw new WebhookSignatureError('PAYMENT_WEBHOOK_CERT_PROVIDER_MISSING', '未配置平台证书提供者')
    }
    const publicKey = await this.certificateProvider.getBySerial(String(serial))
    if (!publicKey) {
      throw new WebhookSignatureError('PAYMENT_WEBHOOK_CERT_NOT_FOUND', `平台证书不存在：${serial}`)
    }

    verifySignature({
      platformCredential: publicKey,
      verifyString: buildVerifyString({ timestamp, nonce, body }),
      signature,
    })

    // 验签通过后才解析 JSON。
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      throw new WebhookSignatureError('PAYMENT_WEBHOOK_PAYLOAD_INVALID', '请求体不是合法 JSON', 400)
    }
    const resource = decryptResource({ apiV3Key: this.apiV3Key, resource: payload && payload.resource })
    return this._normalize({ payload, resource, serial })
  }

  /** 归一化：只吐白名单字段，raw 供入库（绝不外泄给客户端）。 */
  _normalize({ payload, resource, serial }) {
    // ⚠️ event_type 在**外层明文**，不在加密的 resource 里（微信 APIv3 通知体结构：
    //    { id, create_time, event_type, summary, resource: { ciphertext, nonce, associated_data } }）。
    // 第一版读 resource.event_type 恒为 undefined ⇒ 所有成功回调归一化成 type=null、
    // 被记 ignored、订阅永远不生效。测试夹具把 event_type 也塞进 resource 才没当场暴露，
    // 这是「夹具跟着错实现写」的典型——已改为外层读、夹具也改回真实结构。
    const wechatType = typeof payload.event_type === 'string' ? payload.event_type : ''
    const type = EVENT_TYPE_MAP[wechatType] || null
    const orderId = typeof resource.out_trade_no === 'string' ? resource.out_trade_no : ''
    const transactionId = typeof resource.transaction_id === 'string' ? resource.transaction_id : ''
    const occurredAt = this._parseWechatTime(resource.success_time || resource.update_time)
    const base = {
      provider: 'wechat',
      // 幂等键 = 我方订单号（见 design.md §2.3：不用 transaction_id，同一订单的
      // SUCCESS/REFUND 流水号相同但语义相反）
      externalEventId: orderId,
      orderId,
      amountCents: this._amountCents(resource.amount),
      currency: resource.amount && typeof resource.amount.payer_currency === 'string' ? resource.amount.payer_currency : 'CNY',
      occurredAt,
      providerTransactionId: transactionId,
      certSerial: serial,
      raw: { event_type: wechatType, out_trade_no: orderId, transaction_id: transactionId, summary: payload.summary || null },
    }
    if (!type) {
      // 未登记事件：入库留痕但不推进状态机（调用方记 ignored）。orderId 缺失也要能留痕，
      // 故此时用 event_type + transaction_id 兜底作幂等键，避免两条不同事件撞同一个键。
      return {
        ...base,
        type: null,
        externalEventId: orderId || `${wechatType}:${transactionId}`,
      }
    }
    return { ...base, type }
  }

  _parseWechatTime(value) {
    if (typeof value !== 'string' || !value) return null
    // 微信时间格式 '2026-10-21T19:36:36+08:00'（RFC3339）。非法值归 null，绝不冒泡 RangeError。
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }

  _amountCents(amount) {
    const total = amount && Number(amount.payer_total)
    return Number.isFinite(total) && total >= 0 ? total : null
  }
}

module.exports = {
  WeChatNativeProvider,
  WECHAT_API_BASE,
  MAX_TIMESTAMP_SKEW_SECONDS,
  MAX_BODY_BYTES,
  buildVerifyString,
  decryptResource,
  toVerifiableKey,
  OUT_TRADE_NO_PATTERN,
}
