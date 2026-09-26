'use strict'
/**
 * 会员侧已鉴权 API 客户端（B1 设备会话 / B2 消息中心 / 账号云镜像）。
 *
 * 复用 EntitlementService 的 apiUrl/deviceId/fetcher，统一附加 Bearer + X-Device-Id。
 * 路径必须命中 ME_API_PATHS 白名单——renderer 可控入参拼接任意 URL 会构成 token 外泄面。
 * 白名单同时锁死「该路径允许哪些方法」：只放开路径不放开方法，等于把 /me/sessions
 * 变成可被 PUT 的端点。
 */
const { IdentityError } = require('./identity-errors')

const ME_API_PATHS = new Map([
  ['/api/v1/me/sessions', { methods: ['GET'] }],
  ['/api/v1/me/sessions/revoke-others', { methods: ['POST'] }],
  ['/api/v1/me/notifications', { methods: ['GET'] }],
  ['/api/v1/me/notifications/read', { methods: ['POST'] }],
  // 账号云镜像：摘要/全集读取 + 批量 upsert。凭证内容经 TLS 上行，服务端信封加密落库。
  ['/api/v1/me/accounts', { methods: ['GET', 'PUT'] }],
  // 按合并键取回云端凭证（恢复与冲突裁决用）
  ['/api/v1/me/accounts/sync', { methods: ['POST'] }],
  // 清除该身份在云端的全部账号镜像与墓碑；confirm 由服务端二次校验
  ['/api/v1/me/accounts/disconnect', { methods: ['POST'] }],
])

const QUERY_ALLOWLIST = new Set(['view'])
const QUERY_VALUES = { view: new Set(['digest', 'full']) }

function buildQuery(query) {
  if (!query) return ''
  const value = typeof query === 'string' ? query : String(query)
  const pair = /^([a-zA-Z_]+)=([a-zA-Z0-9_-]*)$/.exec(value)
  if (!pair) throw new IdentityError('MEMBER_API_QUERY_NOT_ALLOWED', '查询串不在白名单内')
  const [, key, raw] = pair
  if (!QUERY_ALLOWLIST.has(key)) throw new IdentityError('MEMBER_API_QUERY_NOT_ALLOWED', '查询键不在白名单内')
  const allowed = QUERY_VALUES[key]
  if (allowed && !allowed.has(raw)) throw new IdentityError('MEMBER_API_QUERY_NOT_ALLOWED', '查询值不在白名单内')
  return '?' + key + '=' + raw
}

function createMemberApiService({ entitlementService, tokenProvider } = {}) {
  if (!entitlementService || typeof tokenProvider !== 'function') {
    throw new IdentityError('ENTITLEMENT_CONFIG_INVALID', '会员服务缺少依赖')
  }
  return {
    async request({ subject, path: apiPath, body, method, query } = {}) {
      if (!entitlementService.canReadMembership || !entitlementService.canReadMembership(subject)) {
        throw new IdentityError('ENTITLEMENT_SESSION_MISMATCH', '登录会话已变更，请重试')
      }
      const route = ME_API_PATHS.get(apiPath)
      if (!route) throw new IdentityError('MEMBER_API_PATH_NOT_ALLOWED', '请求路径不在会员接口白名单内')
      const resolvedMethod = method || route.methods[0]
      if (!route.methods.includes(resolvedMethod)) {
        throw new IdentityError('MEMBER_API_METHOD_NOT_ALLOWED', '该路径不允许此方法')
      }
      const accessToken = await tokenProvider()
      const headers = { Authorization: 'Bearer ' + accessToken, 'X-Device-Id': entitlementService.deviceId }
      const suffix = buildQuery(query)
      const url = entitlementService.apiUrl + apiPath + suffix
      if (resolvedMethod !== 'GET') {
        headers['Content-Type'] = 'application/json'
        headers['X-Requested-With'] = 'XMLHttpRequest'
      }
      const response = await entitlementService.fetcher(url, {
        method: resolvedMethod,
        headers,
        ...(resolvedMethod !== 'GET' ? { body: JSON.stringify(body || {}) } : {}),
      })
      if (!response || response.ok !== true || typeof response.json !== 'function') {
        let detail = null
        try { detail = response && typeof response.json === 'function' ? await response.json() : null } catch { /* 忽略解析失败 */ }
        const upstream = detail && typeof detail.error === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(detail.error) ? detail.error : null
        throw new IdentityError(upstream || 'MEMBER_API_REQUEST_FAILED', '会员接口请求失败')
      }
      return response.json()
    },
  }
}

module.exports = { createMemberApiService, ME_API_PATHS, buildQuery }
