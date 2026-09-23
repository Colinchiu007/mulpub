/** @vitest-environment jsdom */
// P1-15：createApiClient —— Cookie 会话 + CSRF 头注入契约
//
// 迁移前锁的是「从 localStorage 拼 Bearer」；迁移后锁四件事：
//   1) withCredentials 打开（跨 origin 部署时 Cookie 才会随请求携带）；
//   2) 非幂等方法自动注入自定义头 X-Ops-Session（后端据此判定同源发起）；
//   3) 幂等方法不注入（后端「免检」口径一致，避免无谓预检）；
//   4) 401 清登录态并跳登录页；403 **不**清态（权限不足/CSRF 缺失不应把管理员踢下线）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { CSRF_HEADER, createApiClient } from '../src/api/http'
import { useAuthStore } from '../src/stores/auth'

function adapter(status, capture) {
  return async (config) => {
    if (capture) capture(config)
    const response = {
      data: { detail: 'test' },
      status,
      statusText: status === 401 ? 'Unauthorized' : 'Forbidden',
      headers: {},
      config,
    }
    // 自定义 adapter 不走 axios 内置 validateStatus，模拟真实行为：>=400 抛错
    if (status >= 400) throw { response, config, isAxiosError: true }
    return response
  }
}

function headerValue(headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name)
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return hit ? headers[hit] : undefined
}

describe('createApiClient（Cookie 会话版）', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
    setActivePinia(createPinia())
  })

  it('默认 baseURL=/api/v1 且开启 withCredentials', () => {
    const api = createApiClient()
    expect(api.defaults.baseURL).toBe('/api/v1')
    expect(api.defaults.withCredentials).toBe(true)
  })

  it('写操作注入 X-Ops-Session，读操作不注入', async () => {
    const seen = []
    const api = createApiClient({ adapter: adapter(200, (c) => seen.push(c)) })

    await api.get('/prompt-eval/cases')
    await api.put('/config/p/category/k', { value: '1' })
    await api.post('/snapshots', { label: 'x' })
    await api.delete('/config/p/category/k')

    expect(headerValue(seen[0].headers, CSRF_HEADER)).toBeUndefined()
    expect(headerValue(seen[1].headers, CSRF_HEADER)).toBe('1')
    expect(headerValue(seen[2].headers, CSRF_HEADER)).toBe('1')
    expect(headerValue(seen[3].headers, CSRF_HEADER)).toBe('1')
  })

  it('不再从 localStorage 读 token 拼 Authorization（历史缺陷面）', async () => {
    // 即便浏览器里还残留旧版本写入的 ops_token，新客户端也必须完全忽略它
    localStorage.setItem('ops_token', JSON.stringify({ token: 'legacy-token', username: 'admin', role: 'admin' }))
    let captured = null
    const api = createApiClient({ adapter: adapter(200, (c) => { captured = c }) })
    await api.put('/anything', {})
    expect(headerValue(captured.headers, 'Authorization')).toBeUndefined()
  })

  it('401 → 清理登录态并跳转登录页', async () => {
    const store = useAuthStore()
    store.username = 'admin'
    store.role = 'admin'
    store.initialized = true

    // 桩掉真实登出（避免单测发网络请求）：语义等价于「后端下发过期 Cookie + 清内存态」
    const logout = vi.spyOn(store, 'logout').mockImplementation(async () => {
      store.username = ''
      store.role = ''
    })

    const api = createApiClient({ adapter: adapter(401) })
    await expect(api.get('/anything')).rejects.toBeTruthy()
    // logout 是异步派发的，等一个微任务队列再断言
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(logout).toHaveBeenCalledTimes(1)
    expect(store.isLoggedIn).toBe(false)
    expect(window.location.hash).toBe('#/login')
    expect(localStorage.getItem('ops_token')).toBeNull()
    logout.mockRestore()
  })

  it('403 → 不清登录态、不跳转（权限/CSRF 问题与凭据有效性无关）', async () => {
    const store = useAuthStore()
    store.username = 'admin'
    store.role = 'admin'
    const logout = vi.spyOn(store, 'logout')

    const api = createApiClient({ adapter: adapter(403) })
    await expect(api.get('/anything')).rejects.toBeTruthy()

    expect(store.isLoggedIn).toBe(true)
    expect(window.location.hash).not.toBe('#/login')
    expect(logout).not.toHaveBeenCalled()
    logout.mockRestore()
  })
})
