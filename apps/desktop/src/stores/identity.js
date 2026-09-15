import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  identityGetState,
  identitySignIn,
  identitySwitchAccount,
  identitySignOut,
  onIdentityStateChanged,
} from '@/api/identity'

const EMPTY_USER = null
const DISABLED_ERROR_CODES = new Set(['IDENTITY_API_UNAVAILABLE', 'IDENTITY_NOT_CONFIGURED'])

function isDisabledError(code) {
  return DISABLED_ERROR_CODES.has(code)
}

/**
 * 归一化主进程返回的错误对象。
 *
 * `cleanup` 是 2026-09-14 起新增的可选字段：当登录失败后「本地会话清理」也失败时，
 * 主进程把清理失败降级为附加信息（主错误优先），渲染层据此追加一条可操作提示。
 *
 * @param {unknown} value
 * @returns {{ code: string, message: string, cleanup?: { code: string } } | null}
 */
function normalizeError(value) {
  if (!value || typeof value !== 'object') return null
  const cleanup = value.cleanup && typeof value.cleanup === 'object' && typeof value.cleanup.code === 'string'
    ? { code: value.cleanup.code }
    : null
  return {
    code: String(value.code || 'IDENTITY_OPERATION_FAILED'),
    message: String(value.message || ''),
    ...(cleanup ? { cleanup } : {}),
  }
}

function normalizeState(value) {
  const state = value && typeof value === 'object' ? value : {}
  const user = state.user && typeof state.user === 'object'
    ? {
        sub: typeof state.user.sub === 'string' ? state.user.sub : '',
        name: typeof state.user.name === 'string' ? state.user.name : '',
        username: typeof state.user.username === 'string' ? state.user.username : '',
        picture: typeof state.user.picture === 'string' ? state.user.picture : '',
      }
    : EMPTY_USER
  const allowed = new Set(['disabled', 'signed_out', 'signing_in', 'authenticated', 'refreshing', 'offline_authenticated', 'expired', 'error', 'signing_out'])
  const entitlement = state.entitlement && typeof state.entitlement === 'object' && !Array.isArray(state.entitlement)
    ? {
        plan: typeof state.entitlement.plan === 'string' ? state.entitlement.plan : 'free',
        features: Array.isArray(state.entitlement.features)
          ? state.entitlement.features.filter((feature) => typeof feature === 'string')
          : [],
        ...(typeof state.entitlement.source === 'string' ? { source: state.entitlement.source } : {}),
        ...(Number.isFinite(state.entitlement.expiresAt) ? { expiresAt: state.entitlement.expiresAt } : {}),
        ...(state.entitlement.quota && typeof state.entitlement.quota === 'object' && !Array.isArray(state.entitlement.quota)
          ? { quota: JSON.parse(JSON.stringify(state.entitlement.quota)) }
          : {}),
      }
    : null
  return {
    status: allowed.has(state.status) ? state.status : 'signed_out',
    user,
    entitlement,
    error: normalizeError(state.error),
  }
}

export const useIdentityStore = defineStore('identity', () => {
  const status = ref('signed_out')
  const user = ref(EMPTY_USER)
  const entitlement = ref(null)
  const error = ref(null)
  const loading = ref(false)
  let unsubscribe = null
  let activeOperation = null

  function applyState(value) {
    const next = normalizeState(value)
    status.value = next.status
    user.value = next.user
    entitlement.value = next.entitlement
    error.value = next.error
  }

  function registerStateListener() {
    if (unsubscribe) return
    const cancel = onIdentityStateChanged(applyState)
    unsubscribe = typeof cancel === 'function' ? cancel : () => {}
  }

  async function runExclusive(operation) {
    if (activeOperation) return false
    loading.value = true
    const task = Promise.resolve().then(operation)
    activeOperation = task
    try {
      return await task
    } finally {
      if (activeOperation === task) activeOperation = null
      loading.value = false
    }
  }

  function load() {
    return runExclusive(async () => {
      try {
        const response = await identityGetState()
        if (response && response.code === 0) {
          applyState(response.data)
          registerStateListener()
          return true
        }
        applyState({ status: isDisabledError(response?.message) ? 'disabled' : 'error', error: { code: response?.message || 'IDENTITY_LOAD_FAILED' } })
        return false
      } catch {
        applyState({ status: 'error', error: { code: 'IDENTITY_LOAD_FAILED' } })
        return false
      }
    })
  }

  function signIn() {
    return runExclusive(async () => {
      error.value = null
      try {
        const response = await identitySignIn()
        if (response && response.code === 0) {
          applyState(response.data)
          registerStateListener()
          return true
        }
        applyState({
          status: isDisabledError(response?.message) ? 'disabled' : 'error',
          error: { code: response?.message || 'IDENTITY_SIGN_IN_FAILED' },
        })
        return false
      } catch {
        applyState({ status: 'error', error: { code: 'IDENTITY_SIGN_IN_FAILED' } })
        return false
      }
    })
  }

  function signOut() {
    return runExclusive(async () => {
      try {
        const response = await identitySignOut()
        if (response && response.code === 0) {
          applyState(response.data)
          return true
        }
        status.value = isDisabledError(response?.message) ? 'disabled' : 'error'
        error.value = { code: response?.message || 'IDENTITY_SIGN_OUT_FAILED', message: '' }
        return false
      } catch {
        status.value = 'error'
        error.value = { code: 'IDENTITY_SIGN_OUT_FAILED', message: '' }
        return false
      }
    })
  }

  function switchAccount() {
    return runExclusive(async () => {
      error.value = null
      try {
        const response = await identitySwitchAccount()
        if (response && response.code === 0) {
          applyState(response.data)
          registerStateListener()
          return true
        }
        status.value = isDisabledError(response?.message) ? 'disabled' : 'error'
        error.value = { code: response?.message || 'IDENTITY_ACCOUNT_SWITCH_FAILED', message: '' }
        return false
      } catch {
        status.value = 'error'
        error.value = { code: 'IDENTITY_ACCOUNT_SWITCH_FAILED', message: '' }
        return false
      }
    })
  }

  function dispose() {
    if (unsubscribe) unsubscribe()
    unsubscribe = null
  }

  /**
   * 登录自愈入口：signIn 被主进程以 IDENTITY_ACCOUNT_SWITCH_REQUIRED 拒绝时
   * （主进程残留旧账号会话、渲染端状态不同步的 error 态），自动降级为
   * switchAccount（先登出旧会话再重新登录），避免用户被「请使用切换账号」
   * 提示卡死但界面无该入口。其他错误码原样返回 false。
   */
  async function signInOrSwitch() {
    const ok = await signIn()
    if (ok) return true
    if (error.value?.code === 'IDENTITY_ACCOUNT_SWITCH_REQUIRED') {
      return switchAccount()
    }
    return false
  }

  const authenticatedStatuses = new Set(['authenticated', 'refreshing', 'offline_authenticated'])
  const isAuthenticated = computed(() => Boolean(user.value?.sub) && authenticatedStatuses.has(status.value))
  const subject = computed(() => user.value?.sub || '')
  const displayName = computed(() => user.value?.name || user.value?.username || (isAuthenticated.value ? '已登录用户' : '登录'))

  return {
    status, user, entitlement, error, loading, isAuthenticated, subject, displayName,
    load, signIn, switchAccount, signOut, signInOrSwitch, dispose,
  }
})
