import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

describe('member store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete window.electronAPI
  })

  async function loadStore() {
    const { useMemberStore } = await import('@/stores/member')
    return useMemberStore()
  }

  it('loadNotifications 成功时写入通知与未读数', async () => {
    window.electronAPI = {
      identityNotifications: vi.fn().mockResolvedValue({
        code: 0,
        data: { notifications: [{ id: 1, title: 't', read_at: null }], unreadCount: 1 },
      }),
    }
    const store = await loadStore()
    await store.loadNotifications()
    expect(store.notifications).toHaveLength(1)
    expect(store.unreadCount).toBe(1)
    expect(store.error).toBeNull()
  })

  it('loadNotifications 失败时脱敏记录错误码', async () => {
    window.electronAPI = {
      identityNotifications: vi.fn().mockResolvedValue({ code: -3, message: 'IDENTITY_SESSION_EXPIRED' }),
    }
    const store = await loadStore()
    await store.loadNotifications()
    expect(store.error).toBe('IDENTITY_SESSION_EXPIRED')
    expect(store.notifications).toEqual([])
  })

  it('loadSessions 成功时写入设备会话', async () => {
    window.electronAPI = {
      identitySessions: vi.fn().mockResolvedValue({
        code: 0,
        data: { sessions: [{ id: 9, device_id: 'dev-1', device_name: 'PC-A' }] },
      }),
    }
    const store = await loadStore()
    await store.loadSessions()
    expect(store.sessions).toHaveLength(1)
  })

  it('markNotificationsRead 成功后本地清零未读', async () => {
    window.electronAPI = {
      identityNotificationsMarkRead: vi.fn().mockResolvedValue({ code: 0, data: { ids: [1, 2] } }),
    }
    const store = await loadStore()
    store.unreadCount = 2
    await expect(store.markNotificationsRead()).resolves.toBe(true)
    expect(store.unreadCount).toBe(0)
    expect(store.notifications.every((n) => n.read === true)).toBe(true)
  })

  it('revokeOtherSessions 失败时返回 false 且不抛异常', async () => {
    window.electronAPI = {
      identitySessionsRevokeOthers: vi.fn().mockResolvedValue({ code: -3, message: 'AUTH_REQUIRED' }),
    }
    const store = await loadStore()
    await expect(store.revokeOtherSessions()).resolves.toBe(false)
    expect(store.error).toBe('AUTH_REQUIRED')
  })

  it('无 electronAPI（浏览器环境）时各动作安全降级', async () => {
    const store = await loadStore()
    await expect(store.loadNotifications()).resolves.toBe(false)
    await expect(store.loadSessions()).resolves.toBe(false)
    expect(store.notifications).toEqual([])
  })
})
