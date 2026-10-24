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

/**
 * §8 MAJOR-1：带兜底的 IPC 调用（工厂外定义，onError 由 store 注入）。
 *
 * 为什么需要：`invoke` 本身不兜底——preload 的 access-control 对
 * 非 public 方法（identitySessions / identityNotifications /
 * identitySessionsRevokeOthers / identityRedeemCode 五个都在内）在权限不足时
 * **同步 throw**，而 `invoke` 是 async 函数 ⇒ 变成 rejected promise。
 * store 原先零 catch，异常以 unhandled rejection 逃逸：UI 无反馈、
 * error 字段也不落值。修复后所有失败都收敛为 error 字段的已知码，
 * 渲染层经 resolveMemberErrorKey 本地化展示。
 *
 * 权限错误（LicensePermissionError）→ MEMBER_PERMISSION_REQUIRED（可给
 * 「重新登录」指引）；其余 → MEMBER_REQUEST_FAILED（通用重试文案）。
 */
async function safeInvoke(channel, payload, onError) {
  try {
    return await invoke(channel, payload)
  } catch (e) {
    onError(e && e.name === 'LicensePermissionError'
      ? 'MEMBER_PERMISSION_REQUIRED'
      : 'MEMBER_REQUEST_FAILED')
    return null
  }
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
      const response = await safeInvoke('identityNotifications', undefined, (code) => { error.value = code })
      // response === null ⇒ safeInvoke 已捕获抛错并落好错误码，**不得再
      // 被 setError(response) 覆盖成通用码（那会丢掉权限语义）。
      if (response === null) return false
      if (!responseOk(response)) return setError(response)
      error.value = null
      notifications.value = isRecordArray(response.data.notifications) ? response.data.notifications.map(normalizeNotification) : []
      unreadCount.value = Number.isFinite(Number(response.data.unreadCount)) ? Math.max(0, Number(response.data.unreadCount)) : 0
      return true
    })
  }

  async function markNotificationsRead() {
    const response = await safeInvoke('identityNotificationsMarkRead', undefined, (code) => { error.value = code })
    if (response === null) return false
    if (!responseOk(response)) return setError(response)
    notifications.value = notifications.value.map((row) => ({ ...row, read: true }))
    unreadCount.value = 0
    return true
  }

  async function loadSessions() {
    return runExclusive(async () => {
      const response = await safeInvoke('identitySessions', undefined, (code) => { error.value = code })
      if (response === null) return false
      if (!responseOk(response)) return setError(response)
      error.value = null
      sessions.value = isRecordArray(response.data.sessions) ? response.data.sessions.map(normalizeSession) : []
      return true
    })
  }

  async function revokeOtherSessions() {
    const response = await safeInvoke('identitySessionsRevokeOthers', undefined, (code) => { error.value = code })
    if (response === null) return false
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

  /**
   * 激活码核销。返回归一化视图，渲染层不再直接碰服务端原始响应。
   *
   * `idempotent` + `hasActiveSubscription` 必须分开传：服务端在「同码重放且
   * 订阅已过期」时返回 HTTP 200 + `subscription: null`，那既不是失败也不是
   * 「兑换成功」。合成一个 success 布尔会让 UI 对用户发假承诺。
   */
  async function redeemCode(code) {
    return runExclusive(async () => {
      const response = await safeInvoke('identityRedeemCode', { code }, (c) => { error.value = c })
      if (response === null) return false
      if (!responseOk(response)) return setError(response)
      error.value = null
      const data = response.data || {}
      return {
        idempotent: data.idempotent === true,
        plan: typeof data.plan === 'string' ? data.plan : null,
        periodEnd: typeof data.periodEnd === 'string' ? data.periodEnd : null,
        hasActiveSubscription: !!data.subscription,
      }
    })
  }

  return {
    notifications, unreadCount, sessions, error, loading,
    loadNotifications, markNotificationsRead,
    loadSessions, revokeOtherSessions, redeemCode, $reset,
  }
})
