// @ts-check
/**
 * shutdown.js — 退出清理模块（从 main.js 拆分）
 *
 * 职责：
 *   - registerShutdownHandlers(context)：注册进程退出协调器
 */
const { app } = require('electron')
const log = require('./services/logger')

/**
 * @param {string} message
 * @param {() => unknown | Promise<unknown>} cleanup
 * @returns {Promise<void>}
 */
async function runCleanup(message, cleanup) {
  try {
    await cleanup()
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    log.error('App', message + ' ' + detail)
  }
}

/**
 * 注册退出清理处理器
 * @param {object} context - bootstrap 创建的上下文
 */
async function performShutdown(context) {
  const {
    hotkeys, pythonBridge,
    webviewManager, rpaViewManager, keywordMonitor,
    callbackServer, store,
    systemTray, scheduler, publishImpactTracker,
    authViewManager, qrCodeLogin, oauthManager,
    batchManager, taskQueue, commentManager,
    renderEngine, usageTracker, story2videoMediaServer,
  } = context

  // 退出兜底：最先落盘运行中的编排流水线，保证应用退出后任务在历史中仍可见并可断点继续。
  // 必须在热键/调度器等清理之前执行，避免任务被 stop 后丢失运行态（2026-08-09 方案B）。
  await runCleanup('Error saving running pipeline state:', () => {
    if (context.pipelineEngine && typeof context.pipelineEngine.saveRunningState === 'function') {
      return context.pipelineEngine.saveRunningState()
    }
  })
  await runCleanup('Error unregistering hotkeys:', () => {
    if (hotkeys && hotkeys.unregister) return hotkeys.unregister()
  })
  await runCleanup('Error stopping scheduler:', () => {
    if (scheduler && scheduler.stopAll) return scheduler.stopAll()
  })
  await runCleanup('Error stopping batch manager:', () => {
    if (batchManager && batchManager.stopAll) return batchManager.stopAll()
  })
  await runCleanup('Error stopping impact tracker:', () => {
    if (publishImpactTracker && publishImpactTracker.stopAll) return publishImpactTracker.stopAll()
  })
  await runCleanup('Error stopping task queue:', () => {
    if (taskQueue && taskQueue.shutdown) return taskQueue.shutdown()
  })
  await runCleanup('Error stopping comment manager:', () => {
    if (commentManager && commentManager.stopAll) return commentManager.stopAll()
  })
  await runCleanup('Error clearing keyword persist timer:', () => {
    if (context.keywordPersistTimer) clearInterval(context.keywordPersistTimer)
  })
  await runCleanup('Error stopping login monitor:', () => {
    if (context.loginStatusMonitor && context.loginStatusMonitor.stop) return context.loginStatusMonitor.stop()
  })

  await runCleanup('Error stopping bridges:', async () => {
    if (context.stopBridges) await context.stopBridges()
    else if (pythonBridge && pythonBridge.stopPythonBackend) await pythonBridge.stopPythonBackend()
  })
  await runCleanup('Error canceling render:', () => {
    if (renderEngine && renderEngine.cancel) return renderEngine.cancel()
  })
  await runCleanup('Error saving usage:', () => {
    if (usageTracker && usageTracker.save) return usageTracker.save()
  })

  await runCleanup('Error closing webviews:', () => {
    if (webviewManager && webviewManager.closeAll) return webviewManager.closeAll()
  })
  // forced-update-gate：清 6h 轮询定时器 + 关阻断弹窗（其余窗口清理前，避免遗留置顶窗）
  await runCleanup('Error disposing enforce gate:', () => {
    try { require('./services/enforce-gate').dispose() } catch (e) { /* shutdown 尽力清理 */ }
  })
  await runCleanup('Error cleaning rpa views:', () => {
    if (rpaViewManager && rpaViewManager.cleanup) return rpaViewManager.cleanup()
  })
  await runCleanup('Error closing auth views:', () => {
    if (authViewManager && authViewManager.close) return authViewManager.close()
  })
  await runCleanup('Error closing qrcode login:', () => {
    if (qrCodeLogin && qrCodeLogin.close) return qrCodeLogin.close()
  })
  await runCleanup('Error closing oauth:', () => {
    if (oauthManager && oauthManager.close) return oauthManager.close()
  })

  await runCleanup('Error stopping keyword monitor:', () => {
    if (keywordMonitor && keywordMonitor.stopAll) return keywordMonitor.stopAll()
  })
  await runCleanup('Error stopping callback server:', () => {
    if (callbackServer && callbackServer.stop) return callbackServer.stop()
  })
  await runCleanup('Error stopping Story2Video media server:', () => {
    if (story2videoMediaServer && story2videoMediaServer.stop) return story2videoMediaServer.stop()
  })
  await runCleanup('Error destroying tray:', () => {
    if (systemTray && systemTray.destroy) return systemTray.destroy()
  })
  await runCleanup('Error removing taskQueue listeners:', () => {
    if (taskQueue && taskQueue.removeAllListeners) return taskQueue.removeAllListeners()
  })
  await runCleanup('Error closing store:', () => {
    if (store && store.close) return store.close()
  })
  // 日志落盘：等待异步文件写入队列排空后再退出
  await runCleanup('Error flushing logs:', () => log.flush())
}

function registerShutdownHandlers(context, options = {}) {
  const platform = options.platform || process.platform
  let shutdownPromise = null
  let quitPromise = null
  let allowQuit = false

  function shutdown() {
    if (!shutdownPromise) shutdownPromise = performShutdown(context)
    return shutdownPromise
  }

  function quitAfterShutdown() {
    if (!quitPromise) {
      quitPromise = shutdown().then(() => {
        allowQuit = true
        app.quit()
      })
    }
    return quitPromise
  }

  app.on('before-quit', (event) => {
    if (allowQuit) return Promise.resolve()
    if (event && event.preventDefault) event.preventDefault()
    return quitAfterShutdown()
  })

  app.on('window-all-closed', () => {
    if (platform === 'darwin') return Promise.resolve()
    return quitAfterShutdown()
  })

  return shutdown
}

module.exports = { registerShutdownHandlers, performShutdown }
