import axios from 'axios'
import { useAuthStore } from '../stores/auth'

/**
 * P1-15：基于 Cookie 会话的 CSRF 第二层自定义头。
 * 后端（middleware/auth.py）对所有「携带会话 Cookie 的非幂等方法」强制校验该头；
 * 跨站页面无法设置自定义头（且会先被预检拦下），因此它的存在即可判定请求源自本站脚本。
 * 值无意义，固定 '1'。
 */
export const CSRF_HEADER = 'X-Ops-Session'
const SAFE_METHODS = new Set(['get', 'head', 'options'])

/**
 * 统一 API 错误文案：
 * - 传输层失败（e.response 缺失：后端未启动 / 开发服务器不可达 / 连接被拒）时，
 *   给出可操作提示，避免用户只看到裸 "Network Error" 无法自助排查；
 * - HTTP 错误优先展示后端 detail，缺失时回退到 axios message。
 */
export function apiErrorMessage(e, fallback = '操作失败，请稍后重试') {
  if (!e) return fallback
  if (!e.response) {
    // 仅真正连接失败（axios ERR_NETWORK）映射为可操作提示；超时/取消等保留原 message
    const isConnectionFailure = e.code === 'ERR_NETWORK' || e.message === 'Network Error'
    if (isConnectionFailure) {
      return '无法连接后端服务（Network Error）：请确认 ops-center 后端已启动（uvicorn main:app --port 8010），然后刷新页面重试'
    }
    return e.message || fallback
  }
  return e.response.data?.detail || e.message || fallback
}

/**
 * 统一 API 客户端工厂。
 *
 * 凭据形态（P1-15 起）：
 * - 会话 token 由后端下发为 **HttpOnly Cookie**，前端代码与浏览器扩展都读不到，
 *   同源请求由浏览器自动携带（跨 origin 部署时靠 `withCredentials` + 后端 CORS 白名单）；
 * - 因此这里**不再**从 localStorage 拼 `Authorization: Bearer`，也不再有 token 过期预检
 *   （权威过期判定只在后端）；
 * - 写操作统一注入 {@link CSRF_HEADER}；读操作不注入，保持与后端「幂等方法免检」一致。
 *
 * 响应侧语义：
 * - 401（无凭据 / 令牌无效或过期）→ 清理内存登录态并跳登录页，杜绝「半登录态」；
 * - 403（权限不足 或 缺 CSRF 头）→ 属业务/调用方问题，**不**清登录态，避免一次误操作把管理员踢下线。
 */
export function createApiClient(config = {}) {
  const api = axios.create({
    baseURL: '/api/v1',
    withCredentials: true,
    ...config,
  })

  api.interceptors.request.use((reqConfig) => {
    const method = String(reqConfig.method || 'get').toLowerCase()
    if (!SAFE_METHODS.has(method)) {
      const headers = reqConfig.headers || {}
      // axios v1 的 config.headers 是 AxiosHeaders 实例：优先走 .set()（大小写不敏感），
      // 否则退化为普通对象赋值（自定义 adapter / 老版本场景）。
      if (typeof headers.set === 'function') headers.set(CSRF_HEADER, '1')
      else headers[CSRF_HEADER] = '1'
      reqConfig.headers = headers
    }
    return reqConfig
  })

  api.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        try {
          // logout 现为异步（要通知后端清 Cookie）；这里不 await，跳转优先
          void useAuthStore().logout()
        } catch {
          // Pinia 未初始化（极端情况）：刷新后路由守卫会探测会话并跳登录页
          window.location.reload()
        }
        if (window.location.hash !== '#/login') {
          window.location.hash = '#/login'
        }
      }
      return Promise.reject(err)
    }
  )

  return api
}
