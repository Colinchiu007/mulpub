/** @vitest-environment jsdom */
// P1-15：ops-center 前端 auth store —— HttpOnly Cookie 会话契约
//
// 旧测试锁的是「localStorage 里的 token 是否被正确恢复/清理」，而 P1-15 之后
// 前端根本不再持有 token，因此这套用例整体重写为三条不变量：
//   1) 登录/水合/登出全程 **不写 localStorage**（凭据外带面为零）；
//   2) 会话有效性只由后端判定（GET /api/auth/session 探测，失败即未登录）；
//   3) 登出必须请后端下发过期 Cookie（只清内存态会让浏览器继续携带有效凭据）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const requests = []
let responder = () => Promise.reject(Object.assign(new Error('unhandled'), { response: { status: 401 } }))

vi.mock('axios', () => ({
  default: {
    create: (instanceConfig) => ({
      instanceConfig,
      get: (url, options) => {
        const record = { method: 'get', url, options, instanceConfig }
        requests.push(record)
        return responder(record)
      },
      post: (url, data, options) => {
        const record = { method: 'post', url, data, options, instanceConfig }
        requests.push(record)
        return responder(record)
      },
    }),
  },
}))

const { useAuthStore } = await import('../src/stores/auth')

function ok(data) {
  responder = () => Promise.resolve({ data })
}

function fail(status, detail = 'denied') {
  responder = () => Promise.reject({ response: { status, data: { detail } } })
}

function lastRequest() {
  return requests[requests.length - 1]
}

beforeEach(() => {
  requests.length = 0
  responder = () => Promise.reject(Object.assign(new Error('unhandled'), { response: { status: 401 } }))
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('authStore —— 会话水合（restore）', () => {
  it('后端会话有效 → 登录态成立，且请求走 /api 同域凭据（withCredentials）', async () => {
    ok({ username: 'admin', role: 'admin' })
    const store = useAuthStore()
    await expect(store.restore()).resolves.toBe(true)
    expect(store.isLoggedIn).toBe(true)
    expect(store.username).toBe('admin')
    expect(store.role).toBe('admin')
    expect(lastRequest().url).toBe('/auth/session')
    expect(lastRequest().instanceConfig.baseURL).toBe('/api')
    expect(lastRequest().instanceConfig.withCredentials).toBe(true)
  })

  it('会话探测失败(401) → 未登录且 initialized=true（守卫据此跳登录页）', async () => {
    fail(401, '未提供认证令牌')
    const store = useAuthStore()
    await expect(store.restore()).resolves.toBe(false)
    expect(store.isLoggedIn).toBe(false)
    expect(store.initialized).toBe(true)
  })

  it('水合只打一次后端（后续导航复用内存态）', async () => {
    ok({ username: 'admin', role: 'admin' })
    const store = useAuthStore()
    await store.restore()
    await store.restore()
    expect(requests.filter((r) => r.url === '/auth/session')).toHaveLength(1)
  })
})

describe('authStore —— 登录（login）', () => {
  it('成功后不落地任何凭据：localStorage 全空、不发 Authorization 头', async () => {
    ok({ username: 'admin', role: 'admin', expires_in: 28800, csrf_header: 'X-Ops-Session' })
    const store = useAuthStore()
    const data = await store.login('admin', 'admin123')
    expect(data.csrf_header).toBe('X-Ops-Session')
    expect(store.csrfHeader).toBe('X-Ops-Session')
    expect(store.expiresIn).toBe(28800)
    expect(store.isLoggedIn).toBe(true)
    expect(lastRequest().url).toBe('/auth/login')
    expect(lastRequest().data).toEqual({ username: 'admin', password: 'admin123' })
    // 关键不变量：不再有任何形式的 token 持久化
    expect(Object.keys(localStorage)).toHaveLength(0)
    expect(JSON.stringify(lastRequest().options || {})).not.toMatch(/Authorization/i)
  })

  it('登录失败 → 抛原错误且保持未登录', async () => {
    fail(401, '用户名或密码错误')
    const store = useAuthStore()
    await expect(store.login('admin', 'bad')).rejects.toBeTruthy()
    expect(store.isLoggedIn).toBe(false)
  })
})

describe('authStore —— 登出（logout）', () => {
  it('必须请后端清 Cookie（POST /auth/logout）并清内存态', async () => {
    ok({ ok: true })
    const store = useAuthStore()
    store.username = 'admin'
    store.role = 'admin'
    await store.logout()
    expect(lastRequest().method).toBe('post')
    expect(lastRequest().url).toBe('/auth/logout')
    expect(store.isLoggedIn).toBe(false)
    expect(store.role).toBe('')
  })

  it('登出请求失败也要清本地态（避免卡在半登录态）', async () => {
    fail(500, 'boom')
    const store = useAuthStore()
    store.username = 'admin'
    await expect(store.logout()).resolves.toBeUndefined()
    expect(store.isLoggedIn).toBe(false)
    expect(store.initialized).toBe(true)
  })
})
