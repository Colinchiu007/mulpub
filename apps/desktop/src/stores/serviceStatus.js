import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { servicesGetStatus, servicesRestart } from '@/api/services'

/** 全部健康时的轮询间隔 */
export const POLL_INTERVAL_HEALTHY_MS = 10000
/** 降级时的轮询间隔上限（指数递增至该值后封顶） */
export const POLL_INTERVAL_DEGRADED_MAX_MS = 60000

const ALLOWED_STATUS = new Set(['running', 'stopped', 'standby'])
const ALLOWED_REASON = new Set([
  'ok', 'not_started', 'on_demand',
  'connection_refused', 'timeout', 'http_error', 'unhealthy', 'unknown',
])

function normalizeServices (value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && typeof item.key === 'string')
    .map((item) => {
      const status = ALLOWED_STATUS.has(item.status) ? item.status : 'stopped'
      return {
        key: item.key,
        name: typeof item.name === 'string' ? item.name : item.key,
        status,
        port: Number.isFinite(item.port) ? item.port : 0,
        // 故障归因：旧主进程版本不返回该字段时按状态兜底，避免 UI 出现空原因
        reason: ALLOWED_REASON.has(item.reason) ? item.reason : (status === 'running' ? 'ok' : 'unknown'),
        restartable: item.restartable === true,
        onDemand: item.onDemand === true,
      }
    })
}

export const useServiceStatusStore = defineStore('serviceStatus', () => {
  const services = ref([])
  const loaded = ref(false)
  const unavailable = ref(false)
  /** 每个服务最近一次被观测到 running 的时间戳（毫秒）；用于展示「上次运行时间」 */
  const lastSeenRunning = ref({})
  /** 每个服务是否正在重启中（防重复点击） */
  const restarting = ref({})

  let pollTimer = null
  let pollGeneration = 0
  let degradedStreak = 0
  let polling = false

  function _isHealthy () {
    return services.value.length > 0 && services.value.every((s) => s.status === 'running' || s.status === 'standby')
  }

  /** 计算下一次轮询延迟：健康时固定 10s，降级时指数退避（10s→20s→40s→60s 封顶） */
  function _nextDelay () {
    if (_isHealthy()) {
      degradedStreak = 0
      return POLL_INTERVAL_HEALTHY_MS
    }
    degradedStreak = Math.min(degradedStreak + 1, 4)
    return Math.min(POLL_INTERVAL_HEALTHY_MS * Math.pow(2, degradedStreak - 1), POLL_INTERVAL_DEGRADED_MAX_MS)
  }

  function _scheduleNext () {
    if (!polling) return
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = setTimeout(() => {
      refresh().finally(() => { if (polling) _scheduleNext() })
    }, _nextDelay())
  }

  /** 记录 running 时间戳：running 时刷新为当前时间，否则保留上一次的观测值 */
  function _trackLastSeen () {
    const now = Date.now()
    const next = {}
    for (const svc of services.value) {
      if (svc.status === 'running') next[svc.key] = now
      else if (Number.isFinite(lastSeenRunning.value[svc.key])) next[svc.key] = lastSeenRunning.value[svc.key]
    }
    lastSeenRunning.value = next
  }

  async function refresh () {
    const generation = ++pollGeneration
    try {
      const response = await servicesGetStatus()
      if (generation !== pollGeneration) return false
      if (response && response.code === 0 && response.data && Array.isArray(response.data.services)) {
        services.value = normalizeServices(response.data.services)
        _trackLastSeen()
        loaded.value = true
        unavailable.value = false
        return true
      }
      unavailable.value = true
      return false
    } catch {
      if (generation !== pollGeneration) return false
      unavailable.value = true
      return false
    }
  }

  function startPolling () {
    if (polling) return
    polling = true
    refresh().finally(() => { if (polling) _scheduleNext() })
  }

  function stopPolling () {
    polling = false
    pollGeneration++
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    degradedStreak = 0
  }

  /**
   * 重启指定服务（有副作用的写操作，未登录时主进程返回 AUTH_ERROR）。
   * @param {string} key
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async function restart (key) {
    if (!key || restarting.value[key]) return { ok: false, message: 'SERVICES_RESTART_IN_PROGRESS' }
    restarting.value = { ...restarting.value, [key]: true }
    try {
      const response = await servicesRestart(key)
      if (response && response.code === 0) {
        // 重启后立即刷新并重置退避，让面板尽快反映新状态
        degradedStreak = 0
        await refresh()
        return { ok: true }
      }
      return { ok: false, message: (response && response.message) || 'SERVICES_RESTART_FAILED' }
    } catch (error) {
      // preload 的许可证守卫在未登录/权限不足时抛 LicensePermissionError（code = AUTH_ERROR(-3)）。
      // 经 contextBridge 传递时自定义 code 可能丢失，故同时以 name 作为语义化判据。
      if (error && (error.code === -3 || error.name === 'LicensePermissionError')) {
        return { ok: false, message: 'AUTH_REQUIRED' }
      }
      const message = (error && error.message) || ''
      return { ok: false, message: message || 'SERVICES_RESTART_FAILED' }
    } finally {
      const next = { ...restarting.value }
      delete next[key]
      restarting.value = next
    }
  }

  const runningCount = computed(() => services.value.filter((s) => s.status === 'running').length)
  const stoppedCount = computed(() => services.value.filter((s) => s.status === 'stopped').length)
  const allRunning = computed(() => _isHealthy())
  const hasDegradation = computed(() => !unavailable.value && stoppedCount.value > 0)

  return {
    services, loaded, unavailable, lastSeenRunning, restarting,
    runningCount, stoppedCount, allRunning, hasDegradation,
    refresh, startPolling, stopPolling, restart,
  }
})
