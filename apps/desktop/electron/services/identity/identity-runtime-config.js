const crypto = require('crypto')
const fs = require('fs')
const { getConfigPath } = require('../config-resolver')
const { IdentityError } = require('./identity-errors')

const CONFIG_FILENAME = 'identity-public.json'
const MAX_CONFIG_BYTES = 64 * 1024
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['', '0', 'false', 'no', 'off'])
const RUNTIME_ENV_KEYS = [
  'IDENTITY_AUTH_ENABLED',
  'IDENTITY_AUTH_REQUIRED',
  'LOGTO_ENDPOINT',
  'LOGTO_APP_ID',
  'LOGTO_API_RESOURCE',
  'BUSINESS_API_URL',
  'LOGTO_REDIRECT_URI',
  'LOGTO_SCOPES',
  'ENTITLEMENT_KEY_ID',
  'ENTITLEMENT_PUBLIC_KEY',
  'OPS_CENTER_URL',
]
const CONFIG_ENV_OVERRIDE_KEYS = RUNTIME_ENV_KEYS.filter((key) => key !== 'IDENTITY_AUTH_ENABLED')
const ALLOWED_FIELDS = new Set([
  'version',
  'identityAuthEnabled',
  'identityAuthRequired',
  'logtoEndpoint',
  'logtoAppId',
  'logtoApiResource',
  'businessApiUrl',
  'logtoRedirectUri',
  'logtoScopes',
  'entitlementKeyId',
  'entitlementPublicKey',
  'opsCenterUrl',
])

function invalidConfig(message, cause) {
  return new IdentityError('IDENTITY_CONFIG_INVALID', message, cause)
}

function requiredString(config, key) {
  const value = config[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidConfig(`身份公开配置缺少 ${key}`)
  }
  return value.trim()
}

function optionalString(config, key) {
  if (!(key in config)) return null
  return requiredString(config, key)
}

function optionalBoolean(config, key, fallback = false) {
  if (!(key in config)) return fallback
  if (typeof config[key] !== 'boolean') throw invalidConfig(`身份公开配置 ${key} 必须为布尔值`)
  return config[key]
}

function requiredBoolean(config, key) {
  if (!(key in config)) throw invalidConfig(`身份公开配置缺少 ${key}`)
  return optionalBoolean(config, key)
}

function parseRuntimeBoolean(value, key) {
  const normalized = String(value === undefined ? '' : value).trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  throw invalidConfig(`身份运行时配置 ${key} 必须是布尔值`)
}

function validateMergedEnvironment(env) {
  const enabled = parseRuntimeBoolean(env.IDENTITY_AUTH_ENABLED, 'IDENTITY_AUTH_ENABLED')
  const required = parseRuntimeBoolean(env.IDENTITY_AUTH_REQUIRED, 'IDENTITY_AUTH_REQUIRED')
  if (required && !enabled) {
    throw invalidConfig('身份运行时配置不能在禁用身份时要求身份认证')
  }
}

function optionalScopes(config) {
  if (!('logtoScopes' in config)) return null
  if (!Array.isArray(config.logtoScopes) || config.logtoScopes.length === 0) {
    throw invalidConfig('身份公开配置 logtoScopes 必须是非空数组')
  }
  const scopes = config.logtoScopes.map((scope) => {
    if (typeof scope !== 'string' || !scope.trim() || scope.length > 200 || /\s/.test(scope)) {
      throw invalidConfig('身份公开配置 logtoScopes 包含无效 scope')
    }
    return scope.trim()
  })
  const uniqueScopes = new Set(scopes)
  for (const requiredScope of ['openid', 'profile', 'offline_access']) {
    if (!uniqueScopes.has(requiredScope)) {
      throw invalidConfig(`身份公开配置 logtoScopes 缺少 ${requiredScope}`)
    }
  }
  return Array.from(uniqueScopes).join(' ')
}

function validateEntitlementPublicKey(value) {
  let key
  try {
    key = crypto.createPublicKey(value)
  } catch (error) {
    throw invalidConfig('身份公开配置 entitlementPublicKey 无效', error)
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw invalidConfig('身份公开配置 entitlementPublicKey 必须是 RSA 公钥')
  }
}

function parseIdentityPublicConfig(source) {
  let config
  try {
    config = JSON.parse(source)
  } catch (error) {
    throw invalidConfig('身份公开配置不是合法 JSON', error)
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw invalidConfig('身份公开配置必须是对象')
  }
  for (const key of Object.keys(config)) {
    if (!ALLOWED_FIELDS.has(key)) throw invalidConfig(`身份公开配置包含不允许的字段: ${key}`)
  }
  if (config.version !== 1) throw invalidConfig('身份公开配置版本不受支持')

  const enabled = requiredBoolean(config, 'identityAuthEnabled')
  const required = optionalBoolean(config, 'identityAuthRequired')
  if (required && !enabled) throw invalidConfig('身份公开配置不能在禁用身份时要求身份认证')

  const result = {
    IDENTITY_AUTH_ENABLED: String(enabled),
    IDENTITY_AUTH_REQUIRED: String(required),
  }
  if (!enabled) return result

  result.LOGTO_ENDPOINT = requiredString(config, 'logtoEndpoint')
  result.LOGTO_APP_ID = requiredString(config, 'logtoAppId')
  result.LOGTO_API_RESOURCE = requiredString(config, 'logtoApiResource')
  result.BUSINESS_API_URL = requiredString(config, 'businessApiUrl')
  result.ENTITLEMENT_KEY_ID = requiredString(config, 'entitlementKeyId')
  result.ENTITLEMENT_PUBLIC_KEY = requiredString(config, 'entitlementPublicKey')
  validateEntitlementPublicKey(result.ENTITLEMENT_PUBLIC_KEY)
  const opsCenterUrl = optionalString(config, 'opsCenterUrl')
  if (opsCenterUrl) result.OPS_CENTER_URL = opsCenterUrl

  const redirectUri = optionalString(config, 'logtoRedirectUri')
  if (redirectUri) result.LOGTO_REDIRECT_URI = redirectUri
  const scopes = optionalScopes(config)
  if (scopes) result.LOGTO_SCOPES = scopes
  return result
}

function mergeEnvironment(configEnv, env, overrideKeys = RUNTIME_ENV_KEYS) {
  // 发行配置锁定身份服务是否启用，受控启动器只能调整其余公开运行时字段。
  const merged = { ...configEnv }
  for (const key of overrideKeys) {
    const value = env && env[key]
    if (value !== undefined) merged[key] = value
  }
  validateMergedEnvironment(merged)
  return merged
}

function loadIdentityRuntimeEnv(options = {}) {
  const env = options.env || process.env
  const configPath = options.configPath || getConfigPath(CONFIG_FILENAME)
  const existsSync = options.existsSync || fs.existsSync
  const readFileSync = options.readFileSync || fs.readFileSync
  if (!existsSync(configPath)) return mergeEnvironment({}, env)

  let source
  try {
    source = readFileSync(configPath, 'utf8')
  } catch (error) {
    throw invalidConfig('无法读取身份公开配置', error)
  }
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_CONFIG_BYTES) {
    throw invalidConfig('身份公开配置大小无效')
  }
  return mergeEnvironment(parseIdentityPublicConfig(source), env, CONFIG_ENV_OVERRIDE_KEYS)
}

module.exports = {
  CONFIG_FILENAME,
  MAX_CONFIG_BYTES,
  loadIdentityRuntimeEnv,
  parseIdentityPublicConfig,
}
