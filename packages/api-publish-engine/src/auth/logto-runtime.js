const crypto = require('crypto')
const { createLogtoJwtVerifier } = require('./logto-jwks')
const { LogtoWebhookConsumer } = require('./logto-webhook')
const { signEntitlement } = require('./entitlement')
const { PostgresEntitlementProvider, PostgresIdentityRepository } = require('./postgres-identity-repository')
const { SubscriptionService } = require('./subscription-service')
const { createProductionReadinessProbe } = require('./production-readiness')
const { validateProductionConfig } = require('./production-config')

class LogtoRuntimeError extends Error {
  constructor(code, message, cause) {
    super(`${code}: ${message || code}`)
    this.code = code
    if (cause) this.cause = cause
  }
}

function enabled(value, name = 'identity auth flag') {
  const normalized = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
  if (!normalized || ['0', 'false', 'no', 'off'].includes(normalized)) return false
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', `${name} 必须是明确的布尔值`)
}

function optionalBoolean(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  return enabled(value, name)
}

function durationSeconds(value, fallback, name, { allowZero = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback * 1000
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || (allowZero ? seconds < 0 : seconds <= 0)) {
    throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', `${name} 必须是${allowZero ? '非负' : '正'}数字`)
  }
  return seconds * 1000
}

function normalizeIssuer(env) {
  const configured = String(env.LOGTO_ISSUER || env.LOGTO_ENDPOINT || '').trim().replace(/\/+$/, '')
  const value = env.LOGTO_ISSUER ? configured : `${configured}/oidc`
  let url
  try { url = new URL(value) } catch (error) {
    throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', 'LOGTO issuer 无效', error)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
    throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', 'LOGTO issuer 必须使用 HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

function createEntitlementSigner(env) {
  const pem = String(env.ENTITLEMENT_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim()
  const keyId = String(env.ENTITLEMENT_KEY_ID || '').trim()
  if (!pem && !keyId) return null
  if (!pem || !keyId) throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', '权益私钥和 key id 必须同时配置')
  try {
    const privateKey = crypto.createPrivateKey(pem)
    if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('权益私钥必须是 RSA')
    return { sign: (snapshot) => signEntitlement({ ...snapshot, kid: keyId }, privateKey) }
  } catch (error) {
    throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', '权益私钥无效', error)
  }
}

async function createLogtoRuntime(options = {}) {
  const env = options.env || process.env
  const authEnabled = enabled(env.IDENTITY_AUTH_ENABLED, 'IDENTITY_AUTH_ENABLED')
  const authRequired = enabled(env.IDENTITY_AUTH_REQUIRED, 'IDENTITY_AUTH_REQUIRED')
  const production = String(env.NODE_ENV || '').trim().toLowerCase() === 'production'
  if (production) {
    const validation = validateProductionConfig(env, { phase: authRequired ? 'required' : 'shadow' })
    if (!validation.valid) {
      throw new LogtoRuntimeError(
        'LOGTO_RUNTIME_CONFIG_INVALID',
        validation.errors.map((entry) => entry.code).join(','),
      )
    }
  }
  if (!authEnabled && !authRequired) return null
  const audience = String(env.LOGTO_API_RESOURCE || '').trim()
  if (!audience) throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', '缺少 LOGTO_API_RESOURCE')
  const databaseUrl = String(env.BUSINESS_DATABASE_URL || '').trim()
  if (!options.repository && !databaseUrl) {
    throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', '缺少 BUSINESS_DATABASE_URL')
  }
  const issuer = normalizeIssuer(env)
  const createVerifier = options.createVerifier || createLogtoJwtVerifier
  const clientId = String(env.LOGTO_CLIENT_ID || '').trim() || null
  const clientSecret = String(env.LOGTO_CLIENT_SECRET || '').trim() || null
  if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
    throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', 'LOGTO_CLIENT_ID 和 LOGTO_CLIENT_SECRET 必须同时配置或同时省略')
  }
  const verifier = createVerifier({
    issuer,
    audience,
    cacheTtlMs: durationSeconds(env.LOGTO_JWKS_CACHE_TTL, 300, 'LOGTO_JWKS_CACHE_TTL'),
    ...(clientId && clientSecret ? { clientId, clientSecret } : {}),
  })
  const migrationDirectory = options.migrationDirectory || String(env.BUSINESS_DATABASE_MIGRATIONS_DIR || '').trim() || undefined
  const repository = options.repository || new PostgresIdentityRepository({
    connectionString: databaseUrl,
    ...(migrationDirectory ? { migrationDirectory } : {}),
    production,
  })
  const entitlementSigner = options.entitlementSigner === undefined ? createEntitlementSigner(env) : options.entitlementSigner
  const autoMigrate = optionalBoolean(
    env.BUSINESS_DATABASE_AUTO_MIGRATE,
    !production,
    'BUSINESS_DATABASE_AUTO_MIGRATE',
  )
  if (production && autoMigrate) {
    await repository.close().catch(() => {})
    throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', '生产环境禁止应用启动时自动迁移')
  }
  try {
    if (autoMigrate) {
      await repository.initialize()
    } else {
      if (typeof repository.assertReady !== 'function') {
        throw new LogtoRuntimeError('LOGTO_RUNTIME_CONFIG_INVALID', '业务数据库仓储不支持 schema readiness')
      }
      await repository.assertReady()
    }
    const entitlementProvider = options.entitlementProvider || new PostgresEntitlementProvider(repository)
    const subscriptionService = new SubscriptionService({
      repository,
      planOverrides: options.planOverrides || null,
    })
    const webhookKey = String(env.LOGTO_WEBHOOK_SIGNING_KEY || '')
    const createWebhookConsumer = options.createWebhookConsumer || ((consumerOptions) => new LogtoWebhookConsumer(consumerOptions))
    const webhookConsumer = webhookKey ? createWebhookConsumer({
      signingKey: webhookKey,
      repository,
      maxEventAgeMs: durationSeconds(env.LOGTO_WEBHOOK_MAX_EVENT_AGE_SECONDS, 15 * 60, 'LOGTO_WEBHOOK_MAX_EVENT_AGE_SECONDS'),
      maxFutureSkewMs: durationSeconds(env.LOGTO_WEBHOOK_MAX_FUTURE_SKEW_SECONDS, 5 * 60, 'LOGTO_WEBHOOK_MAX_FUTURE_SKEW_SECONDS', { allowZero: true }),
    }) : null
    const readinessProbe = createProductionReadinessProbe({
      repository,
      verifier,
      requireIntrospection: production,
    })
    return {
      required: authRequired,
      verifier,
      repository,
      entitlementProvider,
      entitlementSigner,
      subscriptionService,
      webhookConsumer,
      readinessProbe,
      autoMigrate,
      close: () => repository.close(),
    }
  } catch (error) {
    await repository.close().catch(() => {})
    throw error
  }
}

module.exports = { LogtoRuntimeError, createEntitlementSigner, createLogtoRuntime, enabled, normalizeIssuer, optionalBoolean }
