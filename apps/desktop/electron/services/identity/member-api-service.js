'use strict'
/**
 * 会员侧已鉴权 API 客户端（B1 设备会话 / B2 消息中心）。
 *
 * 复用 EntitlementService 的 apiUrl/deviceId/fetcher，统一附加 Bearer + X-Device-Id。
 * 路径必须命中 ME_API_PATHS 白名单——renderer 可控入参拼接任意 URL 会构成 token 外泄面。
 */
const { IdentityError } = require('./identity-errors')

const ME_API_PATHS = new Map([
  ['/api/v1/me/sessions', { method: 'GET' }],
  ['/api/v1/me/sessions/revoke-others', { method: 'POST' }],
  ['/api/v1/me/notifications', { method: 'GET' }],
  ['/api/v1/me/notifications/read', { method: 'POST' }],
])

function createMemberApiService({ entitlementService, tokenProvider } = {}) {
  if (!entitlementService || typeof tokenProvider !== 'function') {
    throw new IdentityError('ENTITLEMENT_CONFIG_INVALID', '会员服务缺少依赖')
  }
  return {
    async request({ subject, path: apiPath, body } = {}) {
      if (!entitlementService.canReadMembership || !entitlementService.canReadMembership(subject)) {
        throw new IdentityError('ENTITLEMENT_SESSION_MISMATCH', '登录会话已变更，请重试')
      }
      const route = ME_API_PATHS.get(apiPath)
      if (!route) throw new IdentityError('MEMBER_API_PATH_NOT_ALLOWED', '请求路径不在会员接口白名单内')
      const accessToken = await tokenProvider()
      const headers = { Authorization: 'Bearer ' + accessToken, 'X-Device-Id': entitlementService.deviceId }
      if (route.method === 'POST') {
        headers['Content-Type'] = 'application/json'
        headers['X-Requested-With'] = 'XMLHttpRequest'
      }
      const response = await entitlementService.fetcher(entitlementService.apiUrl + apiPath, {
        method: route.method,
        headers,
        ...(route.method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
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

module.exports = { createMemberApiService, ME_API_PATHS }
