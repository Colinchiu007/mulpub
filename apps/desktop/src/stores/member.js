import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@/api/electron-bridge'

/**
 * 会员中心数据 store（B1 设备会话 / B2 消息中心）。
 *
 * 一律经 electron-bridge 单轨桥接（Gate 10），无 API（浏览器直开）时安全降级，
 * 与 stores/identity 的 normalize 防御风格一致：只接受白名单字段，绝不透传任意对象。
 */

function normalizeNotification(row) {
  const source = row && typeof row === 'object' ? row : {}
  return {
    id: Number.isFinite(Number(source.id)) ? Number(source.id) : null,
    title: typeof source.title === 'string' ? source.title.slice(0, 200) : '',
    body: typeof source.body === 'string' ? source.body.slice(0, 2000) : '',
    level: ['info', 'success', 'warn', 'error'].includes(source.level) ? source.level : 'info',
    read: source.read_at != null,
    createdAt: typeof source.created_at === 'string' || typeof source.created_at === 'number' ? source.created_at : null,
  }
}

function normalizeSession(row) {
  const source = row && typeof row === 'object' ? row : {}
  return {
    id: Number.isFinite(Number(source.id)) ? Number(source.id) : null,
    deviceId: typeof source.device_id === 'string' ? source.device_id.slice(0, 200) : null,
    deviceName: typeof source.device_name === 'string' ? source.device_name.slice(0, 100) : null,
    createdAt: typeof source.created_at === 'string' || typeof source.created_at === 'number' ? source.created_at : null,
    lastSeenAt: typeof source.last_seen_at === 'string' || typeof source.last_seen_at === 'number' ? source.last_seen_at : null,
  }
}

function responseOk(response) {
  return Boolean(response && response.code === 0 && response.data && typeof response.data === 'object')
}

function isRecordArray(value) {
  return Array.isArray(value) && value.every((row) => row && typeof row === 'object')
}

export const useMemberStore = defineStore('member', () => {
  const notifications = ref([])
  const unreadCount = ref(0)
  const sessions = ref([])
  const error = ref(null)
  const loading = ref(false)

  function setError(response) {
    const message = typeof response?.message === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(response.message)
      ? response.message
      : 'MEMBER_REQUEST_FAILED'
    error.value = message
    return false
  }

  async function runExclusive(operation) {
    loading.value = true
    try {
      return await operation()
    } finally {
      loading.value = false
    }
  }

  async function loadNotifications() {
    return runExclusive(async () => {
      const response = await invoke('identityNotifications')
      if (!responseOk(response)) return setError(response)
      error.value = null
      notifications.value = isRecordArray(response.data.notifications) ? response.data.notifications.map(normalizeNotification) : []
      unreadCount.value = Number.isFinite(Number(response.data.unreadCount)) ? Math.max(0, Number(response.data.unreadCount)) : 0
      return true
    })
  }

  async function markNotificationsRead() {
    const response = await invoke('identityNotificationsMarkRead')
    if (!responseOk(response)) return setError(response)
    notifications.value = notifications.value.map((row) => ({ ...row, read: true }))
    unreadCount.value = 0
    return true
  }

  async function loadSessions() {
    return runExclusive(async () => {
      const response = await invoke('identitySessions')
      if (!responseOk(response)) return setError(response)
      error.value = null
      sessions.value = isRecordArray(response.data.sessions) ? response.data.sessions.map(normalizeSession) : []
      return true
    })
  }

  async function revokeOtherSessions() {
    const response = await invoke('identitySessionsRevokeOthers')
    if (!responseOk(response)) return setError(response)
    error.value = null
    const revoked = Number.isFinite(Number(response.data.revoked)) ? Number(response.data.revoked) : 0
    await loadSessions()
    return revoked
  }

  function $reset() {
    notifications.value = []
    unreadCount.value = 0
    sessions.value = []
    error.value = null
    loading.value = false
  }

  return {
    notifications, unreadCount, sessions, error, loading,
    loadNotifications, markNotificationsRead,
    loadSessions, revokeOtherSessions, $reset,
  }
})
