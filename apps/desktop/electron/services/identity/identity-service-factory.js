const crypto = require('crypto')
const path = require('path')
const SecureTokenStorage = require('./secure-token-storage')
const { AuthService } = require('./auth-service')
const { LoopbackCallbackServer } = require('./loopback-callback-server')
const { createLogtoClient, normalizeEndpoint } = require('./logto-client')
const { IdentityAuthWindow } = require('./identity-auth-window')
const { IdentityError } = require('./identity-errors')
const { EntitlementService } = require('./entitlement-service')

function enabled(value) {
  return new Set(['1', 'true', 'yes', 'on']).has(String(value || '').trim().toLowerCase())
}

const DEFAULT_SCOPES = 'openid profile offline_access profile:read publish:submit publish:read account:manage cloud:publish'

function isValidDeviceId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(value)
}

function resolveDeviceId(store, randomUUID = crypto.randomUUID) {
  if (!store || typeof store.getSetting !== 'function' || typeof store.setSetting !== 'function') {
    throw new IdentityError('IDENTITY_CONFIG_INVALID', '身份服务缺少持久化存储')
  }
  const existing = store.getSetting('identity_device_id')
  if (isValidDeviceId(existing)) return existing
  const generated = typeof randomUUID === 'function' ? String(randomUUID()) : ''
  if (!isValidDeviceId(generated)) throw new IdentityError('IDENTITY_CONFIG_INVALID', '无法生成稳定设备标识')
  store.setSetting('identity_device_id', generated)
  return generated
}

function parseEntitlementPublicKeys(env) {
  const pem = String(env.ENTITLEMENT_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim()
  const keyId = String(env.ENTITLEMENT_KEY_ID || '').trim()
  if (!pem && !keyId) return {}
  if (!pem || !keyId) throw new IdentityError('ENTITLEMENT_CONFIG_INVALID', '权益公钥和 key id 必须同时配置')
  try {
    const key = crypto.createPublicKey(pem)
    if (key.asymmetricKeyType !== 'rsa') throw new Error('权益公钥必须是 RSA')
    return { [keyId]: key }
  } catch (error) {
    throw new IdentityError('ENTITLEMENT_CONFIG_INVALID', '权益公钥无效', error)
  }
}

async function createIdentityService(options = {}) {
  const env = options.env || process.env
  if (!enabled(env.IDENTITY_AUTH_ENABLED)) return null
  const endpoint = normalizeEndpoint(env.LOGTO_ENDPOINT)
  const appId = env.LOGTO_APP_ID
  const resource = env.LOGTO_API_RESOURCE
  const store = options.store
  const deviceId = resolveDeviceId(store, options.randomUUID)
  const publicKeys = parseEntitlementPublicKeys(env)
  const redirectUri = env.LOGTO_REDIRECT_URI || 'http://127.0.0.1:16526/auth/callback'
  let parsedRedirect
  try {
    parsedRedirect = new URL(redirectUri)
  } catch (error) {
    throw new IdentityError('IDENTITY_CONFIG_INVALID', '登录回调地址无效', error)
  }
  if (parsedRedirect.hostname !== '127.0.0.1' || parsedRedirect.protocol !== 'http:') {
    throw new IdentityError('IDENTITY_CONFIG_INVALID', '回调地址必须使用 http://127.0.0.1')
  }
  if (!parsedRedirect.port || parsedRedirect.username || parsedRedirect.password ||
      parsedRedirect.search || parsedRedirect.hash) {
    throw new IdentityError('IDENTITY_CONFIG_INVALID', '回调地址必须包含固定端口且不能包含凭据、查询或片段')
  }
  const createTokenStorage = options.createTokenStorage || (() => new SecureTokenStorage())
  const tokenStorage = createTokenStorage()
  const createEntitlementStorage = options.createEntitlementStorage || (() => new SecureTokenStorage({
    filePath: path.join(require('electron').app.getPath('userData'), 'identity-entitlement.json'),
  }))
  const entitlementStorage = createEntitlementStorage()
  const createEntitlementService = options.createEntitlementService || ((serviceOptions) => new EntitlementService(serviceOptions))
  const entitlementService = createEntitlementService({
    apiUrl: env.BUSINESS_API_URL || resource,
    deviceId,
    publicKeys,
    storage: entitlementStorage,
  })
  const createClient = options.createClient || createLogtoClient
  let authWindow = options.authWindow || null
  if (!authWindow && (options.createAuthWindow || !options.createClient)) {
    const createAuthWindow = options.createAuthWindow || ((windowOptions) => new IdentityAuthWindow(windowOptions))
    authWindow = createAuthWindow({
      endpoint,
      redirectUri,
      getParentWindow: options.getMainWin,
    })
  }
  const client = await createClient({
    endpoint,
    appId,
    resource,
    scopes: String(env.LOGTO_SCOPES || DEFAULT_SCOPES).split(/\s+/).filter(Boolean),
    storage: tokenStorage,
    authWindow,
  })
  const createAuthService = options.createAuthService || ((serviceOptions) => new AuthService(serviceOptions))
  const authService = createAuthService({
    client,
    tokenStorage,
    entitlementService,
    resource,
    redirectUri,
    // 诊断日志：身份链路失败必须落盘（含底层 cause），否则现场只剩被包装后的错误码。
    logger: options.logger || require('../logger'),
    callbackServerFactory: ({ expectedState } = {}) => new LoopbackCallbackServer({
      host: '127.0.0.1',
      port: Number(parsedRedirect.port),
      callbackPath: parsedRedirect.pathname,
      expectedState,
    }),
  })
  if (typeof authService.onStateChanged === 'function') {
    authService.onStateChanged((state) => {
      const win = options.getMainWin && options.getMainWin()
      if (!win || win.isDestroyed()) return
      const webContents = win.webContents
      if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) return
      try {
        webContents.send('identity:state-changed', state)
      } catch { /* ignore */ }
    })
  }
  await authService.restore()
  return authService
}

module.exports = { createIdentityService, enabled, isValidDeviceId, parseEntitlementPublicKeys, resolveDeviceId }
