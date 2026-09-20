const crypto = require('crypto')
const { IdentityError } = require('./identity-errors')

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

async function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || '').trim()
  if (!value) return ''
  let url
  try {
    url = new URL(value)
  } catch (error) {
    throw new IdentityError('IDENTITY_CONFIG_INVALID', 'LOGTO_ENDPOINT 必须是有效的 HTTPS 地址', error)
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback))) {
    throw new IdentityError('IDENTITY_CONFIG_INVALID', 'LOGTO_ENDPOINT 必须使用 HTTPS（本机开发可使用回环 HTTP）')
  }
  return url.toString().replace(/\/+$/, '')
}

function withFetchTimeout(fetcher, timeoutMs, timerFns = {}) {
  const setTimeoutFn = timerFns.setTimeoutFn || setTimeout
  const clearTimeoutFn = timerFns.clearTimeoutFn || clearTimeout
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetcher
  return (input, init = {}) => {
    const controller = new AbortController()
    const external = init && init.signal
    if (external) {
      if (external.aborted) controller.abort(external.reason)
      else external.addEventListener('abort', () => controller.abort(external.reason), { once: true })
    }
    const timer = setTimeoutFn(() => controller.abort(new Error('IDENTITY_FETCH_TIMEOUT')), timeoutMs)
    const signal = controller.signal
    return Promise.resolve(fetcher(input, { ...(init || {}), signal })).finally(() => clearTimeoutFn(timer))
  }
}

function createMemoryStorage() {
  const values = new Map()
  return {
    async getItem(key) { return values.has(key) ? values.get(key) : null },
    async setItem(key, value) { values.set(key, value) },
    async removeItem(key) { values.delete(key) },
  }
}

async function createLogtoClient(options = {}) {
  const endpoint = normalizeEndpoint(options.endpoint || process.env.LOGTO_ENDPOINT)
  const appId = options.appId || process.env.LOGTO_APP_ID
  const resource = options.resource || process.env.LOGTO_API_RESOURCE
  if (!endpoint || !appId || !resource) {
    throw new IdentityError('IDENTITY_CONFIG_INVALID', 'LOGTO_ENDPOINT、LOGTO_APP_ID 和 LOGTO_API_RESOURCE 必须配置')
  }
  const loadModule = options.loadModule || (() => import('@logto/client'))
  const module = await loadModule()
  const LogtoClient = module.default
  if (typeof LogtoClient !== 'function') throw new IdentityError('IDENTITY_SDK_INVALID', 'Logto SDK 导出无效')
  const storage = options.storage || require('./secure-token-storage')
  const adapterStorage = typeof storage === 'function' ? new storage(options.storageOptions) : storage
  const shell = options.shell || require('electron').shell
  const authWindow = options.authWindow || null
  const baseFetcher = options.fetcher || globalThis.fetch
  if (typeof baseFetcher !== 'function') throw new IdentityError('IDENTITY_FETCH_UNAVAILABLE', '系统缺少 fetch')
  // OIDC discovery / token 请求经 SDK requester 发出；无超时的 fetch 会在网络抖动时长时间挂起，
  // 点击登录后迟迟无响应。统一注入超时，让 discovery 快速失败而非无限等待。
  const configuredTimeout = Number(options.fetchTimeoutMs)
  const fetchTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 15000
  const fetcher = withFetchTimeout(baseFetcher, fetchTimeoutMs, options.timerFns)
  const requester = typeof module.createRequester === 'function' ? module.createRequester(fetcher) : fetcher
  let preparedSignInState = null
  const adapter = {
    requester,
    storage: adapterStorage,
    unstable_cache: options.cache || createMemoryStorage(),
    navigate: async (url, parameters) => {
      if (parameters.for === 'sign-in' && authWindow) {
        await authWindow.open(url, parameters)
        return
      }
      if (parameters.for === 'sign-in' || parameters.for === 'sign-out') await shell.openExternal(url)
    },
    generateState: () => {
      const state = preparedSignInState || randomBase64Url()
      preparedSignInState = null
      return state
    },
    generateCodeVerifier: () => randomBase64Url(48),
    generateCodeChallenge,
  }
  const client = new LogtoClient({
    endpoint,
    appId,
    resources: [resource],
    scopes: options.scopes || (process.env.LOGTO_SCOPES || 'profile:read publish:submit publish:read account:manage cloud:publish').split(/\s+/).filter(Boolean),
  }, adapter)
  Object.defineProperty(client, 'prepareSignInState', {
    configurable: false,
    enumerable: false,
    value: () => {
      preparedSignInState = randomBase64Url()
      return preparedSignInState
    },
  })
  if (authWindow) {
    Object.defineProperties(client, {
      waitForSignInWindowClosed: {
        configurable: false,
        enumerable: false,
        value: () => authWindow.waitForClosed(),
      },
      closeSignInWindow: {
        configurable: false,
        enumerable: false,
        value: () => authWindow.close(),
      },
      clearSignInWindowSession: {
        configurable: false,
        enumerable: false,
        value: () => typeof authWindow.clearSession === 'function' ? authWindow.clearSession() : undefined,
      },
    })
  }
  return client
}

module.exports = { createLogtoClient, normalizeEndpoint, generateCodeChallenge, withFetchTimeout }
