// @ts-check
/**
 * bootstrap.js — 应用启动模块（从 main.js 拆分，Bug-1 重构：拆分 phase4-events / phase5-ipc）
 *
 * 职责：
 *   - createAppContext()：同步初始化（DI 容器消费 + taskQueue 接线 + 基础设施构建）
 *   - runWhenReady(context, { createWindow })：注册 app.whenReady 回调
 *
 * 红线：保留原 main.js DI 容器消费代码，不碰 container.setup.js
 */
const { app } = require('electron')
const log = require('./services/logger')
const pythonBridge = require('./services/python-bridge')
const { createContainer } = require('./core/container.setup')
const { wireTaskQueueEvents } = require('./bootstrap/phase4-events')
const { registerAllIpcHandlers } = require('./bootstrap/phase5-ipc')
const { startBridges } = require('./bootstrap/phase2-bridges')
const { extractContext } = require('./bootstrap/phase1-context')
const { startServices } = require('./bootstrap/phase3-services')
const { getStory2VideoMediaServer } = require('./services/story2video-media-server')

// ─── Helper ────────────────────────────────────────────────
// Bug-5: 优先从 DI 容器获取缓存的窗口引用，fallback 到 getAllWindows
let _container = null

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorMessage(value) {
  return value instanceof Error ? value.message : String(value)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorDetails(value) {
  return value instanceof Error ? (value.stack || value.message) : String(value)
}

function isUsableMainWindow(mainWindow) {
  return Boolean(mainWindow) && typeof mainWindow.then !== 'function' && (
    typeof mainWindow.isDestroyed !== 'function' || !mainWindow.isDestroyed()
  )
}

function getMainWin() {
  if (_container && typeof _container.has === 'function') {
    try {
      if (_container.has('mainWindow')) {
        const registeredWindow = _container.get('mainWindow')
        if (isUsableMainWindow(registeredWindow)) return registeredWindow
      }
    } catch { /* fallthrough */ }
  }
  return require('electron').BrowserWindow.getAllWindows().find(isUsableMainWindow)
}

/**
 * 创建应用上下文（同步初始化）
 * @returns {object} context 对象，包含所有基础设施实例
 */
function createAppContext() {
  const container = createContainer()
  _container = container // Bug-5: 缓存 container 供 getMainWin 使用

  // Phase 1: 提取所有 DI 实例 + 模块单例 + 副作用（拆分到 bootstrap/phase1-context.js）
  const ctx = extractContext(container)

  // 保留原位：taskQueue.setExecutor 闭包（依赖 getMainWin + publisherRouter + rpaViewManager，高风险）
  const { taskQueue, publisherRouter, rpaViewManager, store,
    history, publishMonitor, publishImpactTracker, AccountManager } = ctx
  taskQueue.setExecutor(async (task, context = {}) => {
    if (context.signal?.aborted) throw new Error('任务已取消')
    const platform = task.platform
    const emitProgress = (stage) => {
      const win = getMainWin()
      if (win && !win.isDestroyed()) {
        win.webContents.send('publish:progress', { platform, stage, taskId: task.id })
      }
    }
    emitProgress('准备发布...')
    const publisher = publisherRouter.createPublisher(platform, {
      rpaViewManager, store, pythonBridge, accountManager: AccountManager,
    })
    rpaViewManager.onProgress(({ stage }) => { emitProgress(stage) })
    try {
      const result = await publisher.publish(task, { signal: context.signal })
      emitProgress('✓ 发布成功')
      return result
    } catch (e) {
      log.error('Executor', 'Publish failed for ' + platform + ': ' + errorMessage(e))
      throw e
    }
  })

  // 保留原位：任务事件接线（拆分到 bootstrap/phase4-events.js）
  wireTaskQueueEvents({
    taskQueue, history, publishMonitor, publishImpactTracker, getMainWin,
    store: ctx.store || (ctx.container && ctx.container.get('store')),
  })

  return ctx
}

async function rollbackStartup(context, servicesResult, stopBridges) {
  if (context.story2videoMediaServer && typeof context.story2videoMediaServer.stop === 'function') {
    try {
      await context.story2videoMediaServer.stop()
    } catch (e) {
      log.warn('App', 'Story2Video media server rollback failed: ' + errorMessage(e))
    }
  }

  if (servicesResult && typeof servicesResult.rollback === 'function') {
    try {
      await servicesResult.rollback()
    } catch (e) {
      log.warn('App', 'Service rollback failed: ' + errorMessage(e))
    }
  }

  if (stopBridges) {
    try {
      await stopBridges()
    } catch (e) {
      log.warn('App', 'Bridge rollback failed: ' + errorMessage(e))
    }
    return
  }

  /** @type {Array<[string, () => unknown]>} */
  const bridgeStops = [
    ['Python backend', () => {
      if (context.pythonBridge && context.pythonBridge.stopPythonBackend) {
        return context.pythonBridge.stopPythonBackend()
      }
    }],
    ['SplitterBridge', () => {
      if (context.splitterBridge && context.splitterBridge.stop) return context.splitterBridge.stop()
    }],
    ['PromptBridge', () => {
      if (context.promptBridge && context.promptBridge.stop) return context.promptBridge.stop()
    }],
  ]
  const results = await Promise.allSettled(
    bridgeStops.map(([, stop]) => Promise.resolve().then(() => stop())),
  )
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      log.warn('App', bridgeStops[index][0] + ' rollback failed: ' + reason)
    }
  })
}

/**
 * 注册 app.whenReady 回调
 * @param {object} context - createAppContext 返回的上下文
 * @param {object} deps - { createWindow } 窗口创建函数
 */
function runWhenReady(context, deps) {
  const createWindow = deps.createWindow
  const {
    container, store, taskQueue, callbackServer, scheduler,
    keywordMonitor, analyticsService, usageTracker, CloudPublisher, commentManager, modelProviderManager,
    pythonBridge, splitterBridge, promptBridge, opsCenterSync,
  } = context

  return app.whenReady().then(async () => {
    let stopBridges = null
    let servicesResult = null
    try {
      context.story2videoMediaServer = deps.story2videoMediaServer || getStory2VideoMediaServer()
      try {
        await context.story2videoMediaServer.start()
      } catch (error) {
        log.warn('App', 'Story2Video media server unavailable: ' + errorMessage(error))
      }
      stopBridges = await startBridges({ app, pythonBridge, splitterBridge, promptBridge })
      context.stopBridges = stopBridges

servicesResult = await startServices({
        container, store, taskQueue, callbackServer, scheduler,
        keywordMonitor, analyticsService, usageTracker, pythonBridge, CloudPublisher, commentManager,
        modelProviderManager, getMainWin, opsCenterSync,
      })

      // 启动知识进化调度器
      try {
        var evolutionScheduler = container.get('knowledgeEvolutionScheduler')
        if (evolutionScheduler && typeof evolutionScheduler.start === 'function') {
          evolutionScheduler.start()
          log.info('App', 'knowledge-evolution scheduler started')
        }
      } catch (e) { /* 容器无此服务时静默跳过（测试环境 mock container 不注册此服务） */ }

      // 启动模式卡片提取服务（activate-viral-library：启动后 30s + 每小时巡检）
      try {
        var patternExtraction = container.get('patternExtractionService')
        if (patternExtraction && typeof patternExtraction.start === 'function') {
          patternExtraction.start()
          log.info('App', 'pattern-extraction scheduler started')
        }
      } catch (e) { /* 容器无此服务时静默跳过 */ }

      // 启动表现数据回采服务（activate-viral-library P2：启动后 30s + 每日巡检 + 归因重算）
      try {
        var performanceRecrawl = container.get('performanceRecrawlService')
        if (performanceRecrawl && typeof performanceRecrawl.start === 'function') {
          performanceRecrawl.start()
          log.info('App', 'performance-recrawl scheduler started')
        }
      } catch (e) { /* 容器无此服务时静默跳过 */ }
      context.keywordPersistTimer = servicesResult.keywordPersistTimer
      context.loginStatusMonitor = servicesResult.loginStatusMonitor
      context.cloudPublisher = servicesResult.cloudPublisher
      context.identityService = servicesResult.identityService

      await registerAllIpcHandlers({
        app,
        BrowserWindow: require('electron').BrowserWindow,
        context,
      })

      const mainWindow = await createWindow(context)
      const activeContainer = context.container || _container
      if (activeContainer) activeContainer.register('mainWindow', mainWindow, { forceValue: true })
      return mainWindow
    } catch (e) {
      await rollbackStartup(context, servicesResult, stopBridges)
      log.error('App', 'Startup failed: ' + errorDetails(e))
      try {
        const { dialog } = require('electron')
        dialog.showErrorBox('启动失败', errorMessage(e) + '\n\n请查看日志并联系支持。')
      } catch { /* dialog 不可用时忽略 */ }
      throw e
    }
  }, (e) => {
    log.error('App', 'whenReady failed: ' + errorMessage(e))
    throw e
  })
}

module.exports = { createAppContext, runWhenReady }
