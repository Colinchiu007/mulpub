// @ts-check
/**
 * Auto-updater — 自动更新
 * 使用 electron-updater 检查并安装 GitHub Release 更新
 * 网络失败（GFW 场景）静默处理，不弹错误提示
 */
const { autoUpdater } = require('electron-updater')
// eslint-disable-next-line no-unused-vars
const { app, BrowserWindow } = require('electron')
const logger = require('./logger')

let _mainWin = null
let _statusCallback = null
let _policy = null
let _listenersRegistered = false
const _reportedUnavailableErrors = new WeakSet()

// ─── 侧边栏「新版本」入口状态 ──────────────────────────
// _availableUpdate: 最近一次检测到的新版本信息（仅 update-available 写入）
// _updateDownloaded: 该版本安装包是否已下载完成
// _installRequested: 用户已点击「新版本」，下载完成后自动退出并安装
let _availableUpdate = null
let _updateDownloaded = false
let _installRequested = false

// 网络超时/阻断错误特征码（GFW 场景）
const NETWORK_ERROR_PATTERNS = [
  'ERR_INTERNET_DISCONNECTED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_NETWORK_CHANGED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'request failed',
  'getaddrinfo',
  'connect ETIMEDOUT',
  'connect ENETUNREACH',
  'socket hang up'
]

function errorMessage (err) {
  if (!err) return ''
  if (typeof err.message === 'string') return err.message
  return String(err)
}

function isNetworkError (err) {
  const msg = errorMessage(err)
  return NETWORK_ERROR_PATTERNS.some(p => msg.includes(p))
}

function isLatestManifestMissing (err) {
  const msg = errorMessage(err)
  const statusCode = Number(err?.statusCode ?? err?.status ?? err?.response?.statusCode)
  const details = [
    msg,
    err?.url,
    err?.response?.url,
    err?.response?.config?.url,
    err?.request?.responseURL,
  ].filter(value => typeof value === 'string').join(' ')
  const hasManifestReference = /latest(?:-[a-z0-9_-]+)?\.ya?ml/i.test(details)
  const hasNotFoundMarker = /(?:cannot find|not found|request(?:ed)?[^\r\n]*\b404\b)/i.test(details)
  const isNotFound = statusCode === 404 || /\b404\b/.test(details)
  const isSignatureFailure = /(?:signature|signing|checksum|integrity|verification)/i.test(details)
  return isNotFound && hasManifestReference && !isSignatureFailure && (statusCode === 404 || hasNotFoundMarker || /\b404\b/.test(details))
}

function isPackagedUpdateConfigMissing (err) {
  const details = [errorMessage(err), err?.path]
    .filter(value => typeof value === 'string')
    .join(' ')
  const isMissingFile = err?.code === 'ENOENT' || /\bENOENT\b/.test(details)
  return isMissingFile && /(?:^|[\\/])app-update\.ya?ml(?:['"\s]|$)/i.test(details)
}

function isUpdateCheckUnavailable (err) {
  return isPackagedUpdateConfigMissing(err) || isLatestManifestMissing(err) || isNetworkError(err)
}

function createProductionLogger () {
  const write = (level, message) => {
    if (level === 'error' && isUpdateCheckUnavailable(message)) return
    logger[level](`auto-updater ${errorMessage(message)}`)
  }

  return {
    debug: message => write('debug', message),
    info: message => write('info', message),
    warn: message => write('warn', message),
    error: message => write('error', message)
  }
}

function sendUnavailableOnce (err) {
  if (err && (typeof err === 'object' || typeof err === 'function')) {
    if (_reportedUnavailableErrors.has(err)) return false
    _reportedUnavailableErrors.add(err)
  }
  _sendStatus('not-available', '当前已是最新版本')
  return true
}

/**
 * 初始化自动更新
 * @param {BrowserWindow} win - 主窗口
 * @param {Function} onStatus - (status: string, data?: any) => void
 */
function init (win, onStatus) {
  _mainWin = win
  _statusCallback = onStatus

  if (_listenersRegistered) return

  // 打包状态是权威来源，残留开发环境变量不能重新启用 console logger。
  const isUnpackagedDevelopment = app?.isPackaged === false && process.env.NODE_ENV === 'development'
  autoUpdater.logger = isUnpackagedDevelopment
    ? console
    : createProductionLogger()

  // 自动下载
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // ─── 事件 ───────────────────────
  autoUpdater.on('checking-for-update', () => {
    _sendStatus('checking', '正在检查更新...')
  })

  autoUpdater.on('update-available', (info) => {
    _availableUpdate = {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    }
    _updateDownloaded = false
    _sendStatus('available', _availableUpdate)
  })

  autoUpdater.on('update-not-available', () => {
    // 保留正在进行的「点击即安装」请求：并发复查返回 not-available 不应中断安装
    if (!_installRequested) {
      _availableUpdate = null
      _updateDownloaded = false
    }
    _sendStatus('not-available', '当前已是最新版本')
  })

  autoUpdater.on('download-progress', (progress) => {
    _sendStatus('downloading', {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred
    })
  })

  autoUpdater.on('update-downloaded', () => {
    _updateDownloaded = true
    _sendStatus('downloaded', '更新已下载，重启后生效')
    // 用户已点击「新版本」→ 下载完成即退出应用并安装（点击即视为同意）
    if (_installRequested) {
      _installRequested = false
      _sendStatus('installing', { version: _availableUpdate ? _availableUpdate.version : '' })
      quitAndInstall()
    }
  })

  autoUpdater.on('error', (err) => {
    const installInterrupted = _installRequested
    _installRequested = false
    // 用户主动触发的安装失败必须回传 error（让入口可重试），不能降级成「已是最新版本」
    if (isUpdateCheckUnavailable(err) && !installInterrupted) {
      sendUnavailableOnce(err)
      return
    }
    _sendStatus('error', errorMessage(err))
  })

  _listenersRegistered = true
}

/**
 * 检查更新
 */
function _parseVersion (v) {
  // 预发布后缀（如 2.3.53-beta）只取主版本段，避免 NaN 比较
  return String(v || '').split('-')[0].split('.').map(s => {
    const n = Number(s)
    return Number.isFinite(n) ? n : 0
  })
}

function _compareVersions (a, b) {
  const pa = _parseVersion(a)
  const pb = _parseVersion(b)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** 稳定灰度分桶：以安装目录(userData)+当前版本为种子哈希 % 100，避免每次检查随机抖动 */
function _grayRoll (ratio) {
  let seed = String((app && app.getPath) ? app.getPath('userData') : 'default') + '@' + String((app && app.getVersion) ? app.getVersion() : '')
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return hash % 100 < ratio
}

/** 应用运营后台版本发布策略（force_version 强制 / gray_ratio 灰度 / min_version 最低提示） */
function applyPolicy (policy) {
  _policy = (policy && typeof policy === 'object' && policy.enabled !== false) ? policy : null
}

function check () {
  const policy = _policy
  if (policy) {
    const current = String((app && app.getVersion) ? app.getVersion() : '')
    const forced = !!policy.force_version && _compareVersions(current, policy.force_version) < 0
    if (!forced) {
      const ratio = Number.isFinite(Number(policy.gray_ratio)) ? Number(policy.gray_ratio) : 100
      if (ratio < 100 && !_grayRoll(ratio)) {
        _sendStatus('skipped-by-policy', '本次更新检查被灰度策略跳过')
        return
      }
    } else {
      // 强制版本：自动下载（仍由用户在重启时安装；弹窗不可选忽略下载）
      autoUpdater.autoDownload = true
    }
    if (policy.min_version && _compareVersions(current, policy.min_version) < 0) {
      _sendStatus('policy-min-version', { version: policy.min_version })
    }
  }
  autoUpdater.checkForUpdates().catch(err => {
    if (isUpdateCheckUnavailable(err)) {
      sendUnavailableOnce(err)
      return
    }
    _sendStatus('error', errorMessage(err))
  })
}

/**
 * 下载更新
 */
function download () {
  autoUpdater.downloadUpdate().catch(err => {
    if (isNetworkError(err)) {
      sendUnavailableOnce(err)
      return
    }
    _sendStatus('error', errorMessage(err))
  })
}

/**
 * 退出并安装
 */
function quitAndInstall () {
  autoUpdater.quitAndInstall()
}

/**
 * 退出应用并安装新版本（侧边栏「新版本」按钮入口，点击即视为同意退出）
 *
 * 三种情况：
 *   1. 安装包已下载完成 → 直接 quitAndInstall
 *   2. 检测到新版本但尚未下载 → 启动下载，下载完成后自动退出并安装
 *   3. 当前没有可用更新 → 回落 not-available（入口自动隐藏）
 *
 * 幂等：重复点击只保留一次安装请求，不会重复触发下载。
 * @returns {boolean} 是否受理安装请求（false = 当前没有可安装的新版本）
 */
function installNow () {
  if (_updateDownloaded) {
    _sendStatus('installing', { version: _availableUpdate ? _availableUpdate.version : '' })
    quitAndInstall()
    return true
  }
  if (!_availableUpdate) {
    _sendStatus('not-available', '当前已是最新版本')
    return false
  }
  if (_installRequested) return true
  _installRequested = true
  _sendStatus('installing', { version: _availableUpdate.version, phase: 'downloading' })
  // autoDownload=true（force_version 策略）时 electron-updater 已在下载，重复调用会二次下载
  if (!autoUpdater.autoDownload) download()
  return true
}

/**
 * 发送状态给主窗口和回调
 */
function _sendStatus (type, data) {
  const payload = { type, data }
  if (_mainWin && !_mainWin.isDestroyed()) {
    _mainWin.webContents.send('update:status', payload)
  }
  if (_statusCallback) {
    _statusCallback(payload)
  }
}

module.exports = { init, check, download, quitAndInstall, installNow, applyPolicy, _compareVersions }
