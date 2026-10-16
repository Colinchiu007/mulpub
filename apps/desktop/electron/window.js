// @ts-check
/**
 * window.js — 窗口创建模块（从 main.js 拆分）
 *
 * 职责：
 *   - createWindow(context)：创建 BrowserWindow + 绑定事件 + 注册 IPC
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const log = require('./services/logger')
const { installDevCacheGuard } = require('./services/dev-cache-guard')
const { config, getUrl } = require('./config/app-config')
const { isTrustedSender } = require('./core/ipc-security')
const { createAccessControlledIpcMain } = require('./ipc-handlers/license-access-control')
const { shouldHideToTrayOnClose } = require('./services/window-close-policy')
const {
  isThenable,
  runOnce,
  runIpcRegistrationTransaction,
} = require('./bootstrap/phase5-ipc')

// R28 修复：防止 macOS app.on('activate') 重复调用 createWindow 时
// 重复注册 ipcMain.handle 导致 "Attempted to register a second handler" 崩溃
const _ipcRegistrationState = { completed: false, pending: null }
const _completedIpcRegistrars = new Set()
let _pendingWindowCreation = null
const IPC_REGISTRAR_NAMES = [
  'webviewManager',
  'qrCodeLogin',
  'oauthManager',
  'batchManager',
  // 回归修复：35ae6224 修复重复注册时误删唯一注册点，导致 'url-collect:fetch'
  // 无 handler（前端采集回退层静默失败）。71d0b85f 已移除 phase5-ipc 侧注册，
  // 此处是唯一注册点；两处只可存在其一，重复注册会启动崩溃（R28）。
  'urlCollector',
  'providerManager',
  'viralEngine',
  'commentManager',
  'contentIntelligence',
  'publishImpactTracker',
]

function registerIpcRegistrar(context, name) {
  // 显式构造 access-controlled ipcMain 并注入服务（与 phase5-ipc 中心注册一致），
  // 不再临时替换全局 ipcMain.handle，避免注册机制双轨与全局状态污染。
  const controlledIpcMain = createAccessControlledIpcMain(
    ipcMain,
    context.licenseManager,
    process.env,
    app,
    context.identityService,
  )
  return runIpcRegistrationTransaction(
    ipcMain,
    () => context[name].registerIpcHandlers(controlledIpcMain),
  )
}

function registerRemainingIpcHandlers(context, startIndex = 0) {
  for (let index = startIndex; index < IPC_REGISTRAR_NAMES.length; index += 1) {
    const name = IPC_REGISTRAR_NAMES[index]
    if (_completedIpcRegistrars.has(name)) continue
    const result = registerIpcRegistrar(context, name)
    if (isThenable(result)) {
      return Promise.resolve(result).then(() => {
        _completedIpcRegistrars.add(name)
        return registerRemainingIpcHandlers(context, index + 1)
      })
    }
    _completedIpcRegistrars.add(name)
  }
  return undefined
}

function registerIpcHandlersOnce(context) {
  return runOnce(
    _ipcRegistrationState,
    () => registerRemainingIpcHandlers(context),
  )
}

function isAllowedMainWindowUrl(url) {
  return isTrustedSender({ senderFrame: { url } }, app)
}

// 本函数与 packages/shared-utils/src/safe-http-url.js 是**按 sink 分的两种策略**，刻意不合并：
//   · safeHttpUrl —— 渲染层把数据绑成 <a :href> 的**下限**判据（仅 http/https 前缀）；
//   · 本函数     —— 交给操作系统打开（shell.openExternal）的**更严**判据：走 new URL() 解析，
//                    且额外拒绝带 username/password 的 URL。把它收敛成 safeHttpUrl 等于放松这个面。
// 口径与理由见 01-docs/PRD-HREF-SCHEME-GUARD-2026-09-29.md §5.1；
// 「本函数必须继续拒绝 userinfo、必须继续存在」由 apps/desktop/src/href-scheme-contract.test.js 钉住。
function isAllowedExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false
  try {
    const url = new URL(rawUrl)
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username && !url.password
  } catch (_) {
    return false
  }
}

function reportExternalOpenFailure(error) {
  log.notify('window', 'open-external-failed', { level: 'WARN', error: error instanceof Error ? error.message : String(error) })
}

function openExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) return
  try {
    Promise.resolve(shell.openExternal(rawUrl)).catch(reportExternalOpenFailure)
  } catch (error) {
    reportExternalOpenFailure(error)
  }
}

function destroyFailedWindow(mainWindow) {
  try {
    if (typeof mainWindow.isDestroyed === 'function' && mainWindow.isDestroyed()) return
    if (typeof mainWindow.destroy === 'function') mainWindow.destroy()
    else if (typeof mainWindow.close === 'function') mainWindow.close()
  } catch (error) {
    log.notify('window', 'failed-window-cleanup-error', { level: 'WARN', error: error instanceof Error ? error.message : String(error) })
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 关闭窗口时是否应隐藏到托盘（方案A：运行中的编排流水线/发布任务在后台继续）。
 *
 * 平台决策集中在 services/window-close-policy.js：
 * - Windows/Linux：托盘可用 且 有运行中任务（流水线或发布，任一）→ 拦截 close 隐藏到
 *   托盘后台继续；二者缺一时照旧关闭/退出，避免无托盘环境下窗口关闭后进程无法恢复。
 * - macOS：关闭窗口不退出应用是系统约定（app 留在 Dock、window-all-closed 不退出、
 *   activate 重建窗口），因此不拦截 close，让窗口正常关闭、任务继续后台运行。
 *
 * @param {object} context
 * @param {string} [platform] 目标平台（默认 process.platform，测试可注入）
 * @returns {boolean}
 */
function shouldHideToTray(context, platform = process.platform) {
  if (!context || typeof context !== 'object') return false
  const pipelineEngine = context.pipelineEngine
  const systemTray = context.systemTray
  const taskQueue = context.taskQueue
  if (!pipelineEngine || typeof pipelineEngine.hasRunningOrchestration !== 'function') return false
  if (!systemTray || typeof systemTray.isAvailable !== 'function') return false
  let hasRunningPipeline
  try {
    hasRunningPipeline = pipelineEngine.hasRunningOrchestration()
  } catch (error) {
    log.notify('window', 'running-task-check-failed', { level: 'WARN', error: errorMessage(error) })
    return false
  }
  // publish-progress-ux：发布任务运行中（含排队）同样转托盘后台继续；
  // 守卫口径与流水线同款（getStatus 异常按无任务处理，不阻塞关闭）。
  let hasRunningPublish = false
  try {
    const status = typeof taskQueue?.getStatus === 'function' ? taskQueue.getStatus() : null
    const runningCount = Array.isArray(status?.running) ? status.running.length : 0
    const queuedCount = Array.isArray(status?.queue) ? status.queue.length : 0
    hasRunningPublish = runningCount + queuedCount > 0
  } catch (error) {
    log.notify('window', 'running-publish-check-failed', { level: 'WARN', error: errorMessage(error) })
  }
  return shouldHideToTrayOnClose({
    platform,
    hasRunningPipeline,
    hasRunningPublish,
    trayAvailable: systemTray.isAvailable(),
  })
}

function clearMainWindowBindings(context) {
  for (const name of [
    'authViewManager', 'rpaViewManager', 'webviewManager', 'qrCodeLogin', 'oauthManager',
  ]) {
    const manager = context[name]
    if (!manager || typeof manager.setMainWindow !== 'function') continue
    try {
      manager.setMainWindow(null)
    } catch (error) {
      log.notify('window', 'window-ref-cleanup-error', { level: 'WARN', error: error instanceof Error ? error.message : String(error) })
    }
  }
}

function finishWindowInitialization(context, mainWindow) {
  const {
    authViewManager, rpaViewManager, webviewManager, qrCodeLogin,
    oauthManager, commentManager, systemTray, hotkeys, autoUpdater, firstRun,
  } = context

  authViewManager.setMainWindow(mainWindow)
  rpaViewManager.setMainWindow(mainWindow)
  webviewManager.setMainWindow(mainWindow)
  qrCodeLogin.setMainWindow(mainWindow)
  oauthManager.setMainWindow(mainWindow)
  commentManager.setGetMainWin(() => BrowserWindow.getAllWindows()[0])
  systemTray.init(mainWindow)
  hotkeys.register()
  try {
    autoUpdater.init(mainWindow, (status) => {
      log.info('auto-updater', JSON.stringify(status))
    })
  } catch (e) {
    log.notify('window', 'autoupdater-init-failed', { level: 'WARN', error: String(e && e.message) })
  }
  firstRun.runSetup(mainWindow)
  return mainWindow
}

function finishWindowSafely(context, mainWindow) {
  try {
    return finishWindowInitialization(context, mainWindow)
  } catch (error) {
    clearMainWindowBindings(context)
    destroyFailedWindow(mainWindow)
    throw error
  }
}

/**
 * 创建主窗口
 * @param {object} context - bootstrap 创建的上下文
 * @returns {BrowserWindow | Promise<BrowserWindow>} mainWindow
 */
function createWindow(context) {
  if (_pendingWindowCreation) return _pendingWindowCreation

  const { authViewManager, webviewManager, qrCodeLogin } = context

  const mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'index.bundle.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })
  let shown = false
  const showMainWindow = () => {
    if (shown || (typeof mainWindow.isDestroyed === 'function' && mainWindow.isDestroyed())) return
    shown = true
    if (showFallbackTimer) clearTimeout(showFallbackTimer)
    log.notify('window', 'main-window-shown')
    mainWindow.show()
  }
  const reportLoadFailure = (error) => {
    log.notify('window', 'main-window-load-failed', { level: 'ERROR', error: errorMessage(error) })
    // Keep the native error page visible instead of leaving a hidden process behind.
    showMainWindow()
  }
  // 打包状态是窗口加载模式的唯一权威，生产包不能被残留开发信号降级到本地服务器。
  const isDev = app.isPackaged === false
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedMainWindowUrl(url)) {
      event.preventDefault()
      log.notify('window', 'untrusted-navigation-blocked', { level: 'WARN', params: { url } })
    }
  })
  if (typeof mainWindow.webContents.setWindowOpenHandler === 'function') {
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      openExternalUrl(url)
      return { action: 'deny' }
    })
  }
  // 2026-09-12 GPU 帧循环卡死复盘：默认硬件加速后，GPU/渲染进程崩溃需显性化。
  // 渲染进程崩溃 → 记录 + 通知用户（不静默白屏）；用户可重启应用或用
  // ELECTRON_DISABLE_GPU=1 逃生门。GPU 进程崩溃由 Chromium 自愈（自动重启 GPU 进程）。
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.notify('window', 'renderer-gone', { level: 'ERROR', params: { reason: details.reason, exitCode: details.exitCode } })
    try {
      const { Notification } = require('electron')
      if (typeof Notification === 'function' && Notification.isSupported()) {
        const notification = new Notification({
          title: '应用界面异常',
          body: '渲染进程异常退出（' + details.reason + '）。请重启应用；若反复出现，可在启动时设置 ELECTRON_DISABLE_GPU=1 使用兼容模式。',
        })
        notification.show()
      }
    } catch (_) { /* 通知失败不影响主流程 */ }
  })
  if (isDev) {
    // 渲染层 HTTP 缓存治理：Vite 给预构建产物发 immutable 缓存头，而 `?v=<hash>`
    // 不含 workspace 源码内容 ⇒ 源码变了 URL 没变 ⇒ Chromium 命中旧副本且不校验，
    // 表现为「改了代码不生效」「页面资源没有成功加载 / does not provide an export」。
    // 两条腿缺一不可：清掉已污染条目 + 对 dev server origin 强制 no-store。
    // 必须在 loadURL 之前安装（接线锁见 services/dev-cache-guard.test.js）。
    //
    // session 取**窗口实际使用的**而不是硬编码 defaultSession：窗口将来若改用
    // partition，硬编码会让整个守卫静默失效（CCG 深度审查 i1）；devServerUrl 传进去
    // 是为了把 filter 缩窄到 vite 端口，避免连带改写本机其他服务的缓存语义（i5）。
    const devServerUrl = getUrl(config.devServer)
    const cacheGuard = installDevCacheGuard({
      app,
      session: mainWindow.webContents.session,
      log,
      devServerUrl,
    })
    // 安装结果必须留痕：否则"守卫没装上"与"守卫装上了但没生效"在日志里无法区分。
    if (!cacheGuard.installed || cacheGuard.reason) {
      log.notify('window', 'dev-cache-guard-install-result', {
        level: cacheGuard.installed ? 'WARN' : 'ERROR',
        params: { installed: cacheGuard.installed, reason: cacheGuard.reason || 'ok' },
      })
    }
    // ⛔ loadURL 必须在「清缓存落定」之后：clearCache 是异步的，而旧磁盘条目若是
    // immutable，Chromium 命中它时**根本不发网络请求** ⇒ 响应头改写钩子不触发
    // ⇒ 首屏仍是旧副本、症状原样复现（CCG 第二轮 i1）。
    // 超时兜底：清缓存若悬挂，宁可带着可能未清的缓存继续加载，也不能让窗口永不出现。
    Promise.race([
      cacheGuard.cacheCleared || Promise.resolve(),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500)
        if (timer && typeof timer.unref === 'function') timer.unref()
      }),
    ]).then(() => mainWindow.loadURL(getUrl(config.devServer)).catch(reportLoadFailure))
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(reportLoadFailure)
  }
  mainWindow.once('ready-to-show', showMainWindow)
  mainWindow.webContents.once('did-finish-load', showMainWindow)
  const showFallbackTimer = setTimeout(() => {
    log.notify('window', 'show-event-missing-fallback', { level: 'WARN' })
    showMainWindow()
  }, 5000)
  if (typeof showFallbackTimer.unref === 'function') showFallbackTimer.unref()
  mainWindow.on('closed', () => {
    if (showFallbackTimer) clearTimeout(showFallbackTimer)
  })
  // 方案A：运行中的编排流水线/发布任务在后台继续——关闭窗口时隐藏到托盘而非退出进程。
  // 托盘不可用或无运行任务时照旧关闭（window-all-closed → before-quit 清理链）。
  mainWindow.on('close', (event) => {
    if (shouldHideToTray(context)) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      mainWindow.hide()
      // publish-progress-ux：发布运行中隐藏到托盘时气泡提示后台语义（Windows-only，
      // system-tray.showBalloon 内建平台守卫；非 Windows 静默降级）。
      let hasRunningPublish = false
      try {
        const status = typeof context.taskQueue?.getStatus === 'function' ? context.taskQueue.getStatus() : null
        const runningCount = Array.isArray(status?.running) ? status.running.length : 0
        const queuedCount = Array.isArray(status?.queue) ? status.queue.length : 0
        hasRunningPublish = runningCount + queuedCount > 0
      } catch { /* getStatus 异常按无发布任务处理（不气泡，走流水线日志分支） */ }
      if (hasRunningPublish && typeof context.systemTray?.showBalloon === 'function') {
        context.systemTray.showBalloon('发布仍在后台进行', '发布任务正在后台继续执行，请勿退出程序。点击托盘图标可恢复窗口。')
        log.notify('window', 'publish-running-hide-to-tray')
      } else {
        log.notify('window', 'pipeline-running-hide-to-tray')
      }
    }
  })
  mainWindow.on('resize', () => {
    authViewManager._onWindowResize()
    webviewManager.resize()
    qrCodeLogin._onWindowResize()
  })
  // R28 修复：IPC handler 只注册一次，防止 macOS activate 重复注册崩溃
  let registration
  try {
    registration = registerIpcHandlersOnce(context)
  } catch (error) {
    destroyFailedWindow(mainWindow)
    throw error
  }
  if (isThenable(registration)) {
    const creation = Promise.resolve(registration).then(
      () => finishWindowSafely(context, mainWindow),
      (error) => {
        destroyFailedWindow(mainWindow)
        throw error
      },
    )
    const trackedCreation = creation.finally(() => {
      if (_pendingWindowCreation === trackedCreation) _pendingWindowCreation = null
    })
    _pendingWindowCreation = trackedCreation
    return trackedCreation
  }
  return finishWindowSafely(context, mainWindow)
}

module.exports = { createWindow, isAllowedMainWindowUrl, shouldHideToTray }
