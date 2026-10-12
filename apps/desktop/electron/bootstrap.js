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
const { RiskSuspendedError } = require('./services/risk-suspender-store')
// P0-8 pubfail passive diagnose (PR-2, proposal-v3): wire executor + logger/app.
// Un-wired state keeps the module disabled with zero side effects; errors in wiring must never block boot.
try {
  const pubfail = require('./services/pubfail-diagnose')
  pubfail.setDiagnoseDeps({ log, app, runSelfCheck: (params) => require('./services/rate-limit-self-check').runSelfCheck(params) })
  pubfail.setEnabled(true)
} catch (e) { log.warn('Bootstrap', 'pubfail-diagnose wiring failed (degraded to disabled): ' + (e && e.message)) }
const pythonBridge = require('./services/python-bridge')
const { createContainer } = require('./core/container.setup')
const { wireTaskQueueEvents } = require('./bootstrap/phase4-events')
const {
  createPublishProgressEmitter,
  createTaskProgressRouter,
} = require('./services/publish-progress-events')
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
    history, publishMonitor, publishImpactTracker, AccountManager, riskSuspender } = ctx

  // publish-progress-ux：进度事件富化层（单一发射点）+ platform→taskId 归属路由。
  // rpaViewManager.onProgress 是单槽回调——全局只注册一次（此前每任务覆盖，
  // 3 并发任务互相抢占回调导致进度跨归属），回调内经 router 解析当前归属。
  const progressEmitter = createPublishProgressEmitter({ getMainWin })
  const taskProgressRouter = createTaskProgressRouter()
  rpaViewManager.onProgress((data) => {
    if (!data || typeof data.platform !== 'string') return
    const taskId = taskProgressRouter.resolve(data.platform)
    if (!taskId) return
    progressEmitter.emit(taskId, data.platform, 'progress', {
      stage: data.stage, percent: data.percent, batchId: null,
    })
  })

  taskQueue.setExecutor(async (task, context = {}) => {
    if (context.signal?.aborted) throw new Error('任务已取消')
    const platform = task.platform
    // §5 风控挂起 enforcement：命中挂起的平台/账号在派发前拦截（RiskSuspendedError.noRetry → 不重试）
    const taskAccountId = task.article && task.article.accountId
    if (riskSuspender && riskSuspender.isSuspended(platform, taskAccountId)) {
      throw new RiskSuspendedError(platform, taskAccountId)
    }
    // publish-progress-ux：任务开始边界事件（对齐账号批量检测 start/done 双边界先例）
    taskProgressRouter.register(platform, task.id)
    progressEmitter.emit(task.id, platform, 'start', {
      stage: '准备发布...', percent: 0, batchId: task.batchId || null,
    })
    const publisher = publisherRouter.createPublisher(platform, {
      rpaViewManager, store, pythonBridge, accountManager: AccountManager,
    })
    // API 直连轨（ApiPublisher）经 options.onProgress 补发进度（此前该轨完全静默）；
    // RPA 轨进度走 rpaViewManager 全局回调链，不消费本参数。
    const onPublisherProgress = (pct, msg) => {
      progressEmitter.emit(task.id, platform, 'progress', {
        stage: msg, percent: pct, batchId: task.batchId || null,
      })
    }
    // publish-frequency-policy-v2：区分「进入发布器之前」与「之内」的失败（见下方打点注释）
    let enteredPublisher = false
    try {
      // ── publish-frequency-policy-v2：提交阶段打点（P0-1 的正确性基础）──
      // 判据是「平台写操作是否真的发出去过」，因此打点必须由**这一层**（真正调用发布器
      // 的地方）而不是由抛错的那一层来做：抛错方同时是「免等重试」的获益方，自标可被伪造。
      //
      // 分层语义：
      //   ① 进入 publish() 之前的失败（风控挂起 / 信号已中止 / 进度注册失败）⇒ 从未发起
      //      平台写尝试 ⇒ 不打点 ⇒ 守卫可回滚该窗口（这正是报告点名的「风控挂起」族）。
      //   ② publish() 内部失败：默认按**已提交**处理（保守：宁可多等一个窗口）；
      //      仅当发布器显式声明 `definitelyNotSent === true`（连接未建立 / DNS 失败等
      //      可确证未送出）时才允许回滚。
      //   ③ 成功 ⇒ submittedAt 置位（同时满足不变量 I4：成功而 submittedAt 为空即接线缺陷）。
      enteredPublisher = true
      const result = await publisher.publish(task, { signal: context.signal, onProgress: onPublisherProgress })
      if (typeof taskQueue.markSubmitted === 'function') taskQueue.markSubmitted(task.id)
      // 终态事件单一来源是 phase4-events 的 task:success/task:failed（executor 不再重复发送）
      return result
    } catch (e) {
      // ② 已进入发布器且未自证「未送出」⇒ 标记已发起提交尝试，以阻止误回滚
      if (enteredPublisher && !(e && e.definitelyNotSent === true)) {
        if (typeof taskQueue.markSubmitAttempted === 'function') taskQueue.markSubmitAttempted(task.id)
      }
      log.error('Executor', 'Publish failed for ' + platform + ': ' + errorMessage(e))
      throw e
    } finally {
      taskProgressRouter.unregister(platform, task.id)
    }
  })

  // 保留原位：任务事件接线（拆分到 bootstrap/phase4-events.js）
  wireTaskQueueEvents({
    taskQueue, history, publishMonitor, publishImpactTracker, getMainWin, riskSuspender,
    store: ctx.store || (ctx.container && ctx.container.get('store')),
    progressEmitter,
    // publish-fail-draft-guard：发布失败自动存草稿（旁路，内建 try/catch 不影响失败主流程）。
    // identityService 由 Phase 3 晚于此处挂到 ctx（仅作 Logto 模式判据），失败时刻再惰性读取。
    failureDraftSaver: {
      saveFailureDraft: (task) => require('./services/publish-failure-draft').saveFailureDraft(task, {
        store: ctx.store || (ctx.container && ctx.container.get('store')),
        identityService: ctx.identityService || null,
      }),
    },
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
      // P2-6d B2：归因重算的自动触发挂在这里（真正的 start() 站点，不在 phase3 里重复调一次）。
      // 此前 recomputeAll() 的生产调用点只有手动 IPC 一个，而本行注释早就写着「+ 归因重算」——
      // 挂要在 start() 之前，否则 30s 首轮没有回调。
      try {
        var performanceRecrawl = container.get('performanceRecrawlService')
        if (performanceRecrawl && typeof performanceRecrawl.start === 'function') {
          if (typeof performanceRecrawl.setAfterRound === 'function') {
            var patternAttribution = container.get('patternAttributionService')
            performanceRecrawl.setAfterRound(function () {
              if (patternAttribution && typeof patternAttribution.recomputeAll === 'function') {
                return patternAttribution.recomputeAll()
              }
              log.warn('PerformanceLoop', 'attribution service missing, skip after-round recompute')
              return null
            })
          }
          performanceRecrawl.start()
          log.info('App', 'performance-recrawl scheduler started')
        }
      } catch (e) { /* 容器无此服务时静默跳过 */ }

      // 启动账号级作品数据回流（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12）：
      // 启动后 60s 首轮 + 每 24h 一轮。低频是产品契约（用户接受非实时），
      // 目的是让发布记录页的五项互动列有真数据，同时把请求密度压到风控安全区。
      // 归属解析器必须在这里注入：identityService 挂在 servicesResult 上而不在容器里，
      // 容器装配期拿不到。返回 null（有身份服务但认不出主体）⇒ 服务整轮跳过，不回落到 legacy 桶。
      try {
        var accountMetrics = container.get('accountMetricsService')
        if (accountMetrics && typeof accountMetrics.start === 'function') {
          if (typeof accountMetrics.setResolveOwner === 'function' && servicesResult.identityService) {
            accountMetrics.setResolveOwner(function () {
              try {
                var st = servicesResult.identityService.getState && servicesResult.identityService.getState()
                var sub = st && st.user && st.user.sub
                if (typeof sub === 'string' && sub.trim()) return sub.trim()
                return null
              } catch (_) { return null }
            })
          }
          accountMetrics.start()
          log.info('App', 'account-metrics scheduler started')
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
