import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

/**
 * 管理后台登录态（P1-15：HttpOnly Cookie 会话版）。
 *
 * 与旧实现的关键差异 —— 旧版把 `POST /api/auth/login` 返回的 JWT 存进 localStorage 并
 * 手工拼 `Authorization: Bearer`，任何 XSS 都能把凭据完整外带走（→ 管理员会话接管）。
 * 现在凭据只存在于后端下发的 HttpOnly Cookie：
 *   - 前端**拿不到、也不需要** token；本 store 仅缓存展示/路由所需的元数据；
 *   - 因此无法在本地判断「会话是否过期」，改为向后端探测一次（{@link restore}）；
 *   - 登出必须通知后端下发过期 Cookie（仅清内存态会让浏览器继续携带有效凭据）。
 *
 * 这里刻意不 import `api/http.js`：http.js 反向依赖本 store，跨引会形成循环依赖；
 * 且认证端点在 /api/auth 下（非 /api/v1），错误处理也不走「401 跳登录页」那套拦截器。
 */
const http = axios.create({ baseURL: '/api', withCredentials: true })

export const useAuthStore = defineStore('auth', () => {
  const username = ref('')
  const role = ref('')
  /** 是否已完成一次后端会话水合（避免每次路由跳转都打一次 /auth/session） */
  const initialized = ref(false)
  /** 后端告知的 CSRF 头名（正常恒为 X-Ops-Session；留出可配置余地） */
  const csrfHeader = ref('X-Ops-Session')
  /** 会话剩余秒数（仅用于到期前的提示展示，不做本地放行判断） */
  const expiresIn = ref(0)

  const isLoggedIn = computed(() => !!username.value)

  function _applyProfile(data) {
    username.value = data?.username || ''
    role.value = data?.role || ''
  }

  function clear() {
    username.value = ''
    role.value = ''
    expiresIn.value = 0
  }

  /**
   * 水合登录态：向后端探测当前会话。
   * 任何失败（401 / 网络异常）都按「未登录」处理并置 initialized，交由路由守卫跳登录页；
   * 网络异常与凭据失效在 UX 上无需区分 —— 结果都是回到登录页重试。
   */
  async function restore() {
    if (initialized.value) return isLoggedIn.value
    try {
      const { data } = await http.get('/auth/session')
      _applyProfile(data)
    } catch {
      clear()
    } finally {
      initialized.value = true
    }
    return isLoggedIn.value
  }

  /** 登录成功：凭据已落在浏览器 Cookie 里，这里只接元数据。失败时抛原 axios 错误给调用方提示。 */
  async function login(user, pwd) {
    const { data } = await http.post('/auth/login', { username: user, password: pwd })
    _applyProfile(data)
    csrfHeader.value = data.csrf_header || csrfHeader.value
    expiresIn.value = data.expires_in || 0
    initialized.value = true
    return data
  }

  /**
   * 登出：先请后端下发 Max-Age=0 的 Cookie，再清内存态。
   * 后端请求失败也必须清本地态并放行（否则用户会卡在「已登录但全是 401」的状态）。
   */
  async function logout() {
    try {
      await http.post('/auth/logout')
    } catch { /* 忽略：本地态清理与跳转必须继续 */ }
    clear()
    initialized.value = true
  }

  return {
    username,
    role,
    initialized,
    csrfHeader,
    expiresIn,
    isLoggedIn,
    restore,
    login,
    logout,
    clear,
  }
})
