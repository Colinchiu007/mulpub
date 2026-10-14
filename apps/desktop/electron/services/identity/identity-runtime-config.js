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
  // 部署层验签信任锚（2026-10-14）：打包版唯一可配处原为「运营中心同步」表单，
  // 而该表单早已从界面撤下 ⇒ 打包版不存在可达配置路径，运行时策略必然 fail-closed。
  // 与 OPS_CENTER_URL 同机制：identity-public.json 的 runtimePublicKey，可经此 env 覆盖。
  'RUNTIME_PUBLIC_KEY',
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
  'runtimePublicKey',
])

// 2026-10-07 安全加固：发行公钥的**不可变锚点**。
//
// 背景：`identity-public.json` 被打包进 `<安装目录>/resources/config/`——位于
// app.asar **之外**的普通文件，用户可编辑。而该文件同时提供
// `entitlementPublicKey`（验签权益快照）与 `businessApiUrl`（权益服务地址），
// 且 `CONFIG_ENV_OVERRIDE_KEYS` 还允许用**进程环境变量**覆盖二者。
//
// 于是原实现存在一条完整的伪造链：同时替换公钥与 API 地址 → 起一个假
// `/api/v1/me` 返回自签的「永久 Pro」→ 本地验签通过 → UI 显示 Pro。
// `validateEntitlementPublicKey` 只校验**格式**（`crypto.createPublicKey` 能解析
// 且 `asymmetricKeyType === 'rsa'`），换一把自己生成的 RSA 公钥完全合法，照样放行。
//
// 修法：把发行公钥作为**编译期常量**钉进代码，packaged 模式下要求配置/环境
// 提供的公钥与之**逐字节一致**，否则直接判配置非法。攻击者若改公钥就启动不了；
// 只改 `businessApiUrl` 指向假服务器也没用——假签名验不过这把钉死的公钥。
//
// **刻意只钉公钥、不钉 keyId**：`entitlementKeyId` 允许运维在不重发安装包的前提下
// 轮换到新 key id（现有测试即依赖该语义：fixture 用 `entitlement-key-1` 而非发行
// 配置的 `entitlement-2026-07-24`）。新公钥的轮换走发版，在此常量中追加条目即可。
//
// **仅 packaged 模式强制**：未打包运行需要本地测试密钥；且攻击者要利用这一点，
// 前提是自己编译整个应用（门槛与签名成本都很高），且只影响自己。
// 判定用 `options.isPackaged` 显式注入 —— 与 `getConfigPath` 同源，但避免
// 直接 require('electron') 造成测试无法注入。
const PINNED_ENTITLEMENT_PUBLIC_KEYS = Object.freeze([
  {
    keyId: "entitlement-2026-07-24",
    publicKey: "\n-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArBZ/ZMC00wi1TQBJ7LCe\nwfrUgD5E8c6IVBBYxh8tDayW6dGg4Wv/FDqm3CUftnMUfgWYrFhhP+8w2ddpEcZE\ncPBCm7LSZ1/FvtiQDsQJXniKVzstfCNADV4cq/s3W6GU/mdUbnDChxlpu1H8CEdA\nR/KczWTyhDANYxKwC33r5B5oYOiz6gDAaFlX/J3QLzrFmxoyqXy3VUJW3F6fedk7\nXYqj/Vypfcrqf8lKRqSPsOaYB48gnBSxEaEdwonSL3CjFFgcWulk5unf5H1+VPCi\nXYsNGSmkmpJdXBG8QsV6cVH8hBCxLvWGh+9ew8u5P+AzelBaIOi9i2WAjS7nqdeW\nGwIDAQAB\n-----END PUBLIC KEY-----\n",
  },
])

function pinnedEntitlementPublicKeyFor(keyId) {
  if (typeof keyId !== 'string' || !keyId) return null
  return PINNED_ENTITLEMENT_PUBLIC_KEYS.find((entry) => entry.keyId === keyId) || null
}

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
  // 部署层信任锚：不做 PEM 校验（不合法时由验签侧以 INVALID_PUBLIC_KEY 出声拒绝，
  // 比在启动期抛错更可诊断，且不会因一个可选字段把应用启动打挂）。
  const runtimePublicKey = optionalString(config, 'runtimePublicKey')
  if (runtimePublicKey) result.RUNTIME_PUBLIC_KEY = runtimePublicKey

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
  // 必须在校验**之后**做：mergeEnvironment 会用进程环境覆盖配置，两条替换路径
  // （改配置文件 / 改环境变量）都要被同一次校验覆盖到。
  const merged = mergeEnvironment(parseIdentityPublicConfig(source), env, CONFIG_ENV_OVERRIDE_KEYS)
  assertPinnedEntitlementPublicKey(merged, options.isPackaged)
  return merged
}

// 2026-10-07：packaged 模式下要求发行公钥与编译期锚点逐字节一致。
// 详见 PINNED_ENTITLEMENT_PUBLIC_KEYS 上方注释。
function assertPinnedEntitlementPublicKey(merged, isPackaged) {
  // 严格布尔判定：`!== true` 意味着 `1` / `'true'` 这类真值会**静默降级为宽松**，
  // 与 `license:activate`(#3085) 的 `app.isPackaged !== false` 口径不一致。
  // 宁可「非严格 true 就当作打包态从严」——误拒的代价是启动失败（可查、可修），
  // 误放行的代价是签名校验被绕过。
  if (isPackaged === true) {
    // 继续
  } else if (isPackaged === false || isPackaged === undefined || isPackaged === null) {
    return // 明确的开发态 / 未指定
  } else {
    throw invalidConfig(`isPackaged 必须是布尔值，收到 ${typeof isPackaged}: ${String(isPackaged)}`)
  }
  const keyId = merged.ENTITLEMENT_KEY_ID
  const publicKey = merged.ENTITLEMENT_PUBLIC_KEY
  // 身份未启用时本就没有公钥，不在此处越权拦截
  if (merged.IDENTITY_AUTH_ENABLED !== 'true') return
  if (!keyId || !publicKey) return
  const pinned = pinnedEntitlementPublicKeyFor(keyId)
  if (!pinned) {
    throw invalidConfig(`身份公开配置 entitlementKeyId 未内置：${keyId}`)
  }
  if (normalizePem(publicKey) !== normalizePem(pinned.publicKey)) {
    throw invalidConfig(`身份公开配置 entitlementPublicKey 与内置发行公钥不一致（keyId=${keyId}）`)
  }
}

// PEM 换行符在不同平台可能是 CRLF，且尾部可能有多余空行；比较前统一规范化。
// 注意：只规范化**空白**，不做任何"宽松解析"——逐字节一致是这里的目的。
function normalizePem(value) {
  return String(value).replace(/\r\n/g, '\n').trim()
}

module.exports = {
  CONFIG_FILENAME,
  MAX_CONFIG_BYTES,
  PINNED_ENTITLEMENT_PUBLIC_KEYS,
  loadIdentityRuntimeEnv,
  parseIdentityPublicConfig,
}
