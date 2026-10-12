/**
 * 更改密码（POST /api/auth/change-password）。
 *
 * 刻意**不复用** api/http.js 的 createApiClient：
 *  - 认证端点在 /api/auth 下，而 http.js 的 baseURL 固定 /api/v1；
 *  - http.js 的响应拦截器把 401 一律解释为「会话失效 → 跳登录页」。改密成功恰恰会让
 *    当前会话失效，若走那套拦截器，用户会被当成「被踢下线」而不是看到成功提示。
 *  - 与 stores/auth.js 同口径（那里也是自建 axios，注释说明了同样的循环依赖问题）。
 *
 * CSRF 头仍必须注入：后端对「携带会话 Cookie 的非幂等方法」强制校验 X-Ops-Session。
 */
import axios from 'axios'
import { CSRF_HEADER } from './http'

const http = axios.create({ baseURL: '/api', withCredentials: true })

/**
 * @param {{old_password: string, new_password: string, confirm_password: string}} payload
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function changePassword(payload) {
  const { data } = await http.post(
    '/auth/change-password',
    payload,
    { headers: { [CSRF_HEADER]: '1' } },
  )
  return data
}
