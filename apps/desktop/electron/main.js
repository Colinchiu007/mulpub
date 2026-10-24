// @ts-check
/**
 * main.js — 应用入口（已拆分为 bootstrap/window/shutdown 三件套）
 *
 * 职责：编排启动流程，自身不持有业务逻辑
 *   1. requestSingleInstanceLock()  确保只有一个应用实例
 *   2. createAppContext()           同步初始化基础设施（DI 容器消费 + taskQueue 接线）
 *   3. registerShutdownHandlers()   注册异步退出协调器
 *   4. runWhenReady()               注册 app.whenReady 回调（内含 createWindow）
 *   5. second-instance / activate   聚焦或重建主窗口
 */
const { app, BrowserWindow, Menu } = require('electron')
const { configureGraphics, configureUserDataPath, configureUserAgentFallback } = require('./startup-compat')
const { removeApplicationMenu } = require('./services/native-menu')

let storageConfig
try {
  storageConfig = configureUserDataPath({ app })
  // stdio-log-bridge（2026-10-24）：packages/* 的 logger 只写 stdout，而应用日志只收自家 logger
  // ⇒ 包内诊断（CSRF、上传、发稿步骤）在开发与生产中都不可见。此处接管 stdout/stderr 并透传。
  // 包内诊断落盘（2026-10-24）：packages/* 的 logger 只写 stdout，应用日志不收 stdout。
  // 不拦 stdout（会插进 Electron 核心输出路径、启动期可能直接崩），改为把包 logger 的文件镜像
  // 指向应用日志目录，诊断与 app-*.log 并排落盘。
  try {
    const _pathMod = require('path')
    const _fsMod = require('fs')
    const _logsDir = _pathMod.join(storageConfig.path || app.getPath('userData'), 'logs')
    _fsMod.mkdirSync(_logsDir, { recursive: true })
    if (!process.env.MP_PKG_LOG) process.env.MP_PKG_LOG = _pathMod.join(_logsDir, 'pkg-engine.log')
  } catch (_ePkgLog) {}
  // 2026-10-24 回退：stdio 接管导致主进程启动后异常退出（CDP ready 后 ~10s 进程消失），
  // 恢复为不安装；包内诊断改由 MP_PKG_LOG 文件镜像承担（见 api-publish-engine/src/logger.js）。
  // try { require('./services/stdio-log-bridge').install() } catch (_eBridge) {}
  const graphicsConfig = configureGraphics({ app })
  const uaConfig = configureUserAgentFallback({ app })
  if (uaConfig.configured) {
    console.log('[startup] 已净化 User-Agent（移除 Electron 标记，规避平台登录风控）')
  } else {
    console.warn('[startup] User-Agent 未净化（UA 不含 Electron 标记或取不到 userAgentFallback）；知乎等平台登录风控可能拒绝下发验证码')
  }
  if (storageConfig.fallback) {
    console.warn(`[startup] 默认 userData 不可写，已切换到 ${storageConfig.path}`)
  }
  if (storageConfig.shared) {
    console.warn(`[startup] 检测到 shared-user-data 锚点，使用共享数据目录 ${storageConfig.path}（WSL/Windows 环境数据一致）`)
  }
  if (graphicsConfig.disabled) {
    console.warn('[startup] 硬件加速已禁用（' + graphicsConfig.reason + '）；如遇界面异常可移除 ELECTRON_DISABLE_GPU=1 恢复默认 GPU 渲染')
  }
} catch (error) {
  console.error('[startup] 无法准备应用运行目录:', error instanceof Error ? error.message : String(error))
  app.quit()
  throw error
}
const { createAppContext, runWhenReady } = require('./bootstrap')
const { createWindow } = require('./window')
const { registerShutdownHandlers } = require('./shutdown')
const log = require('./services/logger')
const PROCESS_ERROR_HANDLER_MARKER = Symbol.for('@multi-publish/desktop/process-error-handler')

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorDetails(value) {
  return value instanceof Error ? (value.stack || value.message) : String(value)
}

function registerProcessErrorHandler(eventName, handler) {
  const alreadyRegistered = process.listeners(eventName).some((listener) => (
    Reflect.get(listener, PROCESS_ERROR_HANDLER_MARKER) === eventName
  ))
  if (alreadyRegistered) return

  Object.defineProperty(handler, PROCESS_ERROR_HANDLER_MARKER, { value: eventName })
  process.on(eventName, handler)
}

// 全局未捕获异常处理器（防止静默 unhandledRejection 导致错误不可诊断）
// 第九轮 CRITICAL：全库无 process.on('unhandledRejection')，任何漏网的 Promise rejection 都会静默丢失
registerProcessErrorHandler('unhandledRejection', (reason) => {
  log.error('Process', 'Unhandled rejection: ' + errorDetails(reason))
})
registerProcessErrorHandler('uncaughtException', (err) => {
  log.error('Process', 'Uncaught exception: ' + errorDetails(err))
  // 不主动 exit，让 Electron 继续运行（用户可保存数据后重启）
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  // 2026-10-21（remove-native-menu-bar）：移除 Electron 默认应用菜单
  // （File / Edit / View / Window）。它不是本产品的功能入口，却白占一整行窗口高度。
  // 这是根因级的一刀：之后创建的窗口都不再自带这行菜单；
  // 主窗口另有窗口级兜底（window.js 的 removeWindowMenuBar）。
  // macOS 保留原生菜单（见 services/native-menu.js 的平台策略）。
  // 留痕（QM-6 外部评审 i5）：菜单没被移除只是「不好看」而不是「起不来」，
  // 但静默失败会让它无从排查——Electron 升级后 API 变了吗？平台策略命中了吗？日志能答。
  const nativeMenuRemoval = removeApplicationMenu({ Menu })
  log.info('App', 'Native application menu removal: ' + nativeMenuRemoval.reason)
  // 同步初始化基础设施（DI 容器消费 + taskQueue 接线 + 基础设施构建）
  const context = createAppContext()

  async function createAndRegisterWindow() {
    const mainWindow = await createWindow(context)
    log.info('App', 'Main window created')
    if (!isUsableWindow(mainWindow)) {
      throw new Error('Window creation did not return a usable window')
    }
    if (context.container && typeof context.container.register === 'function') {
      context.container.register('mainWindow', mainWindow, { forceValue: true })
    }
    return mainWindow
  }

  function isUsableWindow(window) {
    return Boolean(window) && typeof window.then !== 'function' && (
      typeof window.isDestroyed !== 'function' || !window.isDestroyed()
    )
  }

  function findMainWindow() {
    try {
      if (context.container &&
          typeof context.container.has === 'function' &&
          context.container.has('mainWindow')) {
        const registeredWindow = context.container.get('mainWindow')
        if (isUsableWindow(registeredWindow)) return registeredWindow
      }
    } catch { /* 容器引用不可用时回退到 Electron 窗口列表 */ }
    return BrowserWindow.getAllWindows().find(isUsableWindow) || null
  }

  // 注册退出协调器，再启动异步资源，确保启动失败也能完整清理。
  registerShutdownHandlers(context)

  let startupPromise
  try {
    startupPromise = Promise.resolve(runWhenReady(context, { createWindow })).then(
      () => true,
      () => {
        app.quit()
        return false
      },
    )
  } catch (e) {
    log.error('App', 'Startup orchestration failed: ' + errorDetails(e))
    app.quit()
    startupPromise = Promise.resolve(false)
  }

  let pendingWindowRecovery = null

  function ensureMainWindowAfterStartup() {
    if (pendingWindowRecovery) return pendingWindowRecovery

    const recovery = (async () => {
      const startupSucceeded = await startupPromise
      if (!startupSucceeded) return null
      return findMainWindow() || createAndRegisterWindow()
    })()
    const trackedRecovery = recovery.finally(() => {
      if (pendingWindowRecovery === trackedRecovery) pendingWindowRecovery = null
    })
    pendingWindowRecovery = trackedRecovery
    return trackedRecovery
  }

  function focusMainWindow(mainWindow) {
    if (!isUsableWindow(mainWindow)) return
    if (mainWindow.isMinimized && mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  function handleWindowTaskFailure(error) {
    log.error('App', 'Failed to restore main window: ' + errorDetails(error))
  }

  app.on('second-instance', () => {
    try {
      const mainWindow = findMainWindow()
      if (!mainWindow) {
        ensureMainWindowAfterStartup().then(focusMainWindow).catch(handleWindowTaskFailure)
        return
      }
      focusMainWindow(mainWindow)
    } catch (error) {
      handleWindowTaskFailure(error)
    }
  })

  // macOS：点击 Dock 图标时若窗口已全部关闭则重建主窗口。
  app.on('activate', () => {
    try {
      if (!findMainWindow()) {
        ensureMainWindowAfterStartup().catch(handleWindowTaskFailure)
      }
    } catch (error) {
      handleWindowTaskFailure(error)
    }
  })
}
