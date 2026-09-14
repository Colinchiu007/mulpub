// @ts-check
/**
 * useAutoUpdate.js — 自动更新状态（应用壳共享单例）
 *
 * 职责：
 *   - 维护更新状态（badgeMode / updateInfo / 下载进度 / 错误）
 *   - 提供 handleUpdateStatus / handleInstallNow 方法
 *   - start/cleanup 管理监听器生命周期
 *
 * 共享：应用壳全局提示（UpdateNotification）与侧边栏「新版本」按钮读取同一份状态，
 * 因此状态提升到模块作用域（单例）；start() 幂等，重复挂载不会重复注册监听或重复检查。
 */
import { computed, ref } from 'vue'
import { onUpdateStatus, updateCheck, updateInstallNow } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'

/**
 * 格式化下载速度
 * @param {number} bytesPerSecond
 * @returns {string}
 */
export function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond) return ''
  if (bytesPerSecond > 1024 * 1024) return (bytesPerSecond / 1024 / 1024).toFixed(1) + ' MB/s'
  if (bytesPerSecond > 1024) return (bytesPerSecond / 1024).toFixed(1) + ' KB/s'
  return bytesPerSecond + ' B/s'
}

// ─── 模块级共享状态（单例）─────────────────────────────
// badgeMode: 侧边栏「新版本」入口的展示态，唯一真相源
//   'hidden'      无可用更新 / 当前已是最新版本
//   'available'   检测到新版本，等待用户点击
//   'downloading' 下载中（点击后等待下载完成）
//   'ready'       安装包已下载，点击即退出安装
//   'error'       用户点击后失败，可重试
const badgeMode = ref('hidden')
const updateStatus = ref(null)
const updateInfo = ref(null)
const downloading = ref(false)
const downloadPercent = ref(0)
const downloadSpeed = ref('')
const showNotAvailable = ref(false)
const showError = ref(false)
const updateError = ref('')
// 用户已点击「新版本」：下载完成后主进程会退出应用并安装
const installRequested = ref(false)

/** 侧边栏「新版本」入口是否可见 */
const showUpdateBadge = computed(() => badgeMode.value !== 'hidden')

let _cancelUpdateListen = null
let _started = false
let _notAvailableTimer = null

/**
 * 处理主进程更新状态事件
 * @param {{ type: string, data?: any }} payload
 */
function handleUpdateStatus(payload) {
  if (!payload) return
  updateStatus.value = payload.type

  if (payload.type === 'available') {
    updateInfo.value = payload.data || null
    badgeMode.value = 'available'
    installRequested.value = false
  } else if (payload.type === 'installing') {
    // 用户点击「新版本」后的下载阶段；下载完成由主进程退出应用并安装
    // installRequested 以主进程事件为准（窗口重载后仍能识别「用户已请求安装」）
    installRequested.value = true
    badgeMode.value = 'downloading'
    downloading.value = true
    downloadPercent.value = 0
  } else if (payload.type === 'downloading') {
    badgeMode.value = 'downloading'
    downloading.value = true
    downloadPercent.value = (payload.data && payload.data.percent) || 0
    downloadSpeed.value = formatSpeed(payload.data && payload.data.bytesPerSecond)
  } else if (payload.type === 'downloaded') {
    downloading.value = false
    downloadPercent.value = 100
    badgeMode.value = 'ready'
  } else if (payload.type === 'error') {
    updateError.value = formatUserError(payload.data, { fallback: '更新失败，请稍后重试' }).message
    showError.value = true
    downloading.value = false
    // 用户主动触发失败 → 保留可重试入口；后台静默检查失败不打扰用户
    badgeMode.value = installRequested.value ? 'error' : badgeMode.value
    installRequested.value = false
  } else if (payload.type === 'not-available') {
    badgeMode.value = 'hidden'
    updateInfo.value = null
    downloading.value = false
    showNotAvailable.value = true
    if (_notAvailableTimer) clearTimeout(_notAvailableTimer)
    _notAvailableTimer = setTimeout(function () { showNotAvailable.value = false }, 4000)
  } else if (payload.type === 'policy-min-version') {
    // 运营后台最低版本策略：低于 min_version 提示升级（不弹强制窗）
    updateError.value = '当前版本过低，建议升级到 ' + ((payload.data && payload.data.version) || '最新版本') + ' 以获得最新功能与安全修复'
    showError.value = true
  } else if (payload.type === 'skipped-by-policy') {
    // 灰度跳过：静默（仅记录 updateStatus），不打扰用户
    badgeMode.value = 'hidden'
  }
}

function failInstall (reason) {
  updateError.value = formatUserError(reason, { fallback: '更新失败，请稍后重试' }).message
  showError.value = true
  downloading.value = false
  installRequested.value = false
  badgeMode.value = 'error'
}

/**
 * 点击侧边栏「新版本」：请求主进程下载并安装（下载完成后自动退出应用）
 * @returns {Promise<boolean>} 是否受理
 */
function handleInstallNow () {
  // 下载中重复点击直接忽略（主进程同样幂等）
  if (installRequested.value && badgeMode.value === 'downloading') return Promise.resolve(false)
  installRequested.value = true
  updateError.value = ''
  downloading.value = true
  downloadPercent.value = 0
  badgeMode.value = 'downloading'
  return Promise.resolve(updateInstallNow()).then(function (result) {
    if (result && typeof result.code === 'number' && result.code !== 0) {
      failInstall(result.message || '')
      return false
    }
    return true
  }).catch(function (e) {
    failInstall(e)
    return false
  })
}

/**
 * 启动更新监听与首次检查（幂等：重复调用不会重复注册或重复检查）
 */
function start() {
  if (_started) return
  _started = true
  _cancelUpdateListen = onUpdateStatus(handleUpdateStatus)
  setTimeout(function () { updateCheck() }, 3000)
}

function cleanup() {
  _started = false
  if (_cancelUpdateListen) {
    _cancelUpdateListen()
    _cancelUpdateListen = null
  }
  if (_notAvailableTimer) {
    clearTimeout(_notAvailableTimer)
    _notAvailableTimer = null
  }
}

/**
 * 重置共享状态（仅测试使用：单例状态在同一测试文件内跨用例存活）
 */
export function resetAutoUpdateState() {
  badgeMode.value = 'hidden'
  updateStatus.value = null
  updateInfo.value = null
  downloading.value = false
  downloadPercent.value = 0
  downloadSpeed.value = ''
  showNotAvailable.value = false
  showError.value = false
  updateError.value = ''
  installRequested.value = false
  _started = false
  _cancelUpdateListen = null
  if (_notAvailableTimer) {
    clearTimeout(_notAvailableTimer)
    _notAvailableTimer = null
  }
}

/**
 * 自动更新 composable
 * @returns {object} 响应式状态 + 方法
 */
export function useAutoUpdate() {
  return {
    badgeMode,
    showUpdateBadge,
    updateStatus,
    updateInfo,
    downloading,
    downloadPercent,
    downloadSpeed,
    showNotAvailable,
    showError,
    updateError,
    installRequested,
    handleUpdateStatus,
    handleInstallNow,
    start,
    cleanup,
    get _cancelUpdateListen () { return _cancelUpdateListen },
  }
}
