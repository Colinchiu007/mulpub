'use strict'
/**
 * 微信支付生产配置的回归判据（QM-6 评审 i7 的处置）。
 *
 * 为什么单独成文件：`production-config.test.js` 已覆盖 Logto/Entitlement 面，
 * 本组只守 `PAYMENT_PROVIDER` 分支。评审 i7 指出的问题是**只有手工四档验证、
 * 没有自动化回归**——手工验证不可重放，下一个人改这个分支时无人拦截。
 *
 * 本文件把当时的四档手工输出固化成断言，并补两条形状校验（密钥长度 / https），
 * 以及「CERT_PATH 与 CERT_CONTENT 二者其一即可」这条容易写反的分支。
 */

const assert = require('node:assert')
const crypto = require('node:crypto')
const test = require('node:test')

function validEnv (overrides = {}) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    NODE_ENV: 'production',
    IDENTITY_AUTH_ENABLED: 'true',
    IDENTITY_AUTH_REQUIRED: 'false',
    BUSINESS_DATABASE_AUTO_MIGRATE: 'false',
    LOGTO_ENDPOINT: 'https://id.example.com',
    LOGTO_API_RESOURCE: 'https://api.example.com',
    LOGTO_CLIENT_ID: 'publish-api-m2m',
    LOGTO_CLIENT_SECRET: 'fixture-client-secret',
    BUSINESS_DATABASE_URL: 'postgresql://app:strongpassword@databases.example.com:5432/multi_publish',
    LOGTO_DATABASE_URL: 'postgresql://logto:strongpassword@databases.example.com:5432/logto',
    LOGTO_WEBHOOK_SIGNING_KEY: 'w'.repeat(48),
    ENTITLEMENT_KEY_ID: 'entitlement-2026-07',
    ENTITLEMENT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    ...overrides,
  }
}

const WECHAT_ENV = Object.freeze({
  PAYMENT_PROVIDER: 'wechat_native',
  WECHAT_PAY_APPID: 'wx1234567890abcdef',
  WECHAT_PAY_MCH_ID: '1600000001',
  WECHAT_PAY_API_V3_KEY: '0123456789abcdef0123456789abcdef',
  WECHAT_PAY_CERT_SERIAL_NO: 'SERIAL0001',
  WECHAT_PAY_CERT_PATH: '/etc/secrets/apiclient_cert.pem',
  // 平台公钥与商户私钥同等必需：缺它时下单能出码，但所有 webhook 都会 401 ⇒ 用户付了钱拿不到权益。
  WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: '/etc/secrets/wechatpay_pub_key.pem',
  WECHAT_PAY_NOTIFY_URL: 'https://api.example.com/api/v1/webhooks/payment',
})

const paymentErrors = (result) => result.errors.filter((error) => /PAYMENT/.test(error.code))

// 统一用 phase='shadow'：phase='required' 会额外要求 IDENTITY_AUTH_REQUIRED=true，
// 那条与支付无关，混进来只会让失败原因含糊（实测第一版就是被 AUTH_REQUIRED_PHASE_MISMATCH 打红）。
// 支付校验本身不区分 phase，用 shadow 已足够覆盖。

test('微信支付生产配置', async (t) => {
  const { validateProductionConfig } = require('../src/auth/production-config')

  await t.test('档 1：未设置 PAYMENT_PROVIDER ⇒ 默认 none，支付面零错误（不引入新的必填红）', () => {
    const result = validateProductionConfig(validEnv(), { phase: 'shadow' })
    assert.strictEqual(result.valid, true)
    assert.deepStrictEqual(paymentErrors(result), [])
    assert.strictEqual(result.config.paymentProvider, 'none')
  })

  await t.test('档 2：完整 wechat_native 配置 ⇒ 通过且 paymentProvider 回显', () => {
    const result = validateProductionConfig(validEnv(WECHAT_ENV), { phase: 'shadow' })
    assert.strictEqual(result.valid, true, JSON.stringify(paymentErrors(result)))
    assert.deepStrictEqual(paymentErrors(result), [])
    assert.strictEqual(result.config.paymentProvider, 'wechat_native')
  })

  await t.test('档 3：六个变量逐项缺一即报 PAYMENT_CONFIG_INVALID 并点名该变量', () => {
    for (const variable of [
      'WECHAT_PAY_APPID',
      'WECHAT_PAY_MCH_ID',
      'WECHAT_PAY_API_V3_KEY',
      'WECHAT_PAY_CERT_SERIAL_NO',
      'WECHAT_PAY_NOTIFY_URL',
    ]) {
      const result = validateProductionConfig(validEnv({ ...WECHAT_ENV, [variable]: '' }), { phase: 'shadow' })
      assert.strictEqual(result.valid, false, `${variable} 为空时不得判通过`)
      const hit = result.errors.filter((error) => error.code === 'PAYMENT_CONFIG_INVALID' && error.variable === variable)
      assert.strictEqual(hit.length, 1, `必须点名 ${variable}，实际 ${JSON.stringify(result.errors)}`)
    }
  })

  await t.test('档 3b：CERT_PATH 与 CERT_CONTENT 二者其一即可（这条最容易写反）', () => {
    const onlyContent = validateProductionConfig(validEnv({
      ...WECHAT_ENV,
      WECHAT_PAY_CERT_PATH: '',
      WECHAT_PAY_CERT_CONTENT: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    }), { phase: 'shadow' })
    assert.strictEqual(onlyContent.valid, true, '只给 CERT_CONTENT 必须通过')

    const neither = validateProductionConfig(validEnv({
      ...WECHAT_ENV,
      WECHAT_PAY_CERT_PATH: '',
      WECHAT_PAY_CERT_CONTENT: '',
    }), { phase: 'shadow' })
    assert.strictEqual(neither.valid, false, '两者都空必须失败')
    assert.strictEqual(
      neither.errors.filter((error) => error.code === 'PAYMENT_CONFIG_INVALID' && error.variable === 'WECHAT_PAY_CERT_PATH').length,
      1,
    )
  })

  await t.test('档 4：非法 provider 值 ⇒ PAYMENT_CONFIG_INVALID 且点名 PAYMENT_PROVIDER', () => {
    const result = validateProductionConfig(validEnv({ PAYMENT_PROVIDER: 'alipay' }), { phase: 'shadow' })
    assert.strictEqual(result.valid, false)
    const hit = result.errors.filter((error) => error.code === 'PAYMENT_CONFIG_INVALID' && error.variable === 'PAYMENT_PROVIDER')
    assert.strictEqual(hit.length, 1, JSON.stringify(result.errors))
  })

  await t.test('形状校验：APIv3 密钥必须 32 字节', () => {
    const short = validateProductionConfig(validEnv({ ...WECHAT_ENV, WECHAT_PAY_API_V3_KEY: 'short-key' }), { phase: 'shadow' })
    assert.strictEqual(short.valid, false)
    assert.strictEqual(short.errors.filter((error) => error.code === 'PAYMENT_API_V3_KEY_INVALID').length, 1)

    // 边界：恰好 32 字节必须通过（不把上限写错）
    const exact = validateProductionConfig(validEnv({ ...WECHAT_ENV, WECHAT_PAY_API_V3_KEY: 'k'.repeat(32) }), { phase: 'shadow' })
    assert.strictEqual(exact.valid, true, JSON.stringify(paymentErrors(exact)))
  })

  await t.test('形状校验：notify_url 必须 https（回调走明文等于把订单事件暴露在链路上）', () => {
    for (const bad of ['http://api.example.com/api/v1/webhooks/payment', 'api.example.com/hook', 'ftp://x/y']) {
      const result = validateProductionConfig(validEnv({ ...WECHAT_ENV, WECHAT_PAY_NOTIFY_URL: bad }), { phase: 'shadow' })
      assert.strictEqual(result.valid, false, `${bad} 必须被拒`)
      assert.strictEqual(
        result.errors.filter((error) => error.code === 'PAYMENT_NOTIFY_URL_HTTPS_REQUIRED').length,
        1,
        `${bad} 必须报 PAYMENT_NOTIFY_URL_HTTPS_REQUIRED`,
      )
    }
    const ok = validateProductionConfig(validEnv(WECHAT_ENV), { phase: 'shadow' })
    assert.strictEqual(ok.valid, true)
  })

  await t.test('none 档不受支付形状校验影响（关掉支付时不该被残留变量打红）', () => {
    const result = validateProductionConfig(validEnv({
      PAYMENT_PROVIDER: 'none',
      WECHAT_PAY_API_V3_KEY: 'short',
      WECHAT_PAY_NOTIFY_URL: 'http://insecure',
    }), { phase: 'shadow' })
    assert.deepStrictEqual(paymentErrors(result), [], 'none 档必须整块跳过支付校验')
  })
})
