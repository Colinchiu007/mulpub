// @ts-check
/**
 * Phase 5: IPC Handler 注册
 *
 * 从 bootstrap.js 拆出：
 * - registerAllHandlers（业务 IPC）
 * - usage:* 系列（使用量统计 IPC）
 *
 * 验收标准 BUGFIX-PLAN Bug-1: phase 文件 ≤ 80 行
 * P1-B: 所有 ipcMain.handle 加 sender 来源验证，防恶意页面调用
 */
const { ipcMain } = require('electron')
const { isTrustedSender } = require('../core/ipc-security')
const { createAccessControlledIpcMain } = require('../ipc-handlers/license-access-control')
const { bindAccessLevelInvalidator, createAccessLevelInvalidator } = require('../services/access-level-bus')
const log = require('../services/logger')
const credentialStore = require('../services/credential-store')
const accountStateRestorer = require('../services/account-state-restorer')

const registrationStates = new WeakMap()
const activeIpcTransactions = new WeakMap()

function isThenable(value) {
  return value != null && typeof value.then === 'function'
}

function runOnce(state, work) {
  if (state.completed) return undefined
  if (state.pending) return state.pending

  const result = work()
  if (!isThenable(result)) {
    state.completed = true
    return result
  }

  state.pending = Promise.resolve(result).then(
    (value) => {
      state.completed = true
      state.pending = null
      return value
    },
    (error) => {
      state.pending = null
      throw error
    },
  )
  return state.pending
}

function executeIpcRegistrationTransaction(target, register) {
  const handlers = []
  const listeners = []
  const originalHandle = target.handle
  const originalOn = target.on
  const originalOnce = target.once

  const wrappedHandle = function (channel, handler) {
    const result = originalHandle.call(target, channel, handler)
    handlers.push(channel)
    return result
  }
  const wrapListenerMethod = (method) => function (channel, listener) {
    const result = method.call(target, channel, listener)
    listeners.push({ channel, listener })
    return result
  }
  const wrappedOn = typeof originalOn === 'function' ? wrapListenerMethod(originalOn) : null
  const wrappedOnce = typeof originalOnce === 'function' ? wrapListenerMethod(originalOnce) : null

  target.handle = wrappedHandle
  if (wrappedOn) target.on = wrappedOn
  if (wrappedOnce) target.once = wrappedOnce

  const restore = () => {
    if (target.handle === wrappedHandle) target.handle = originalHandle
    if (wrappedOn && target.on === wrappedOn) target.on = originalOn
    if (wrappedOnce && target.once === wrappedOnce) target.once = originalOnce
  }
  const rollback = () => {
    for (let index = handlers.length - 1; index >= 0; index -= 1) {
      target.removeHandler(handlers[index])
    }
    for (let index = listeners.length - 1; index >= 0; index -= 1) {
      const { channel, listener } = listeners[index]
      if (typeof target.removeListener === 'function') target.removeListener(channel, listener)
      else if (typeof target.off === 'function') target.off(channel, listener)
    }
  }
  const fail = (error) => {
    restore()
    rollback()
    throw error
  }

  try {
    const result = register()
    if (!isThenable(result)) {
      restore()
      return result
    }
    return Promise.resolve(result).then(
      (value) => {
        restore()
        return value
      },
      fail,
    )
  } catch (error) {
    return fail(error)
  }
}

function runIpcRegistrationTransaction(target, register) {
  const active = activeIpcTransactions.get(target)
  if (active) {
    return Promise.resolve(active).then(() => {
      return runIpcRegistrationTransaction(target, register)
    })
  }

  const result = executeIpcRegistrationTransaction(target, register)
  if (!isThenable(result)) return result

  const tracked = Promise.resolve(result).finally(() => {
    if (activeIpcTransactions.get(target) === tracked) {
      activeIpcTransactions.delete(target)
    }
  })
  activeIpcTransactions.set(target, tracked)
  return tracked
}

function registerUsageHandlers(controlledIpcMain, usageTracker) {
  // 使用量统计 IPC — 通过 controlledIpcMain 走访问控制 Proxy
  // controlledIpcMain 内部已包装 isTrustedSender + 权限校验，这里不需要重复校验
  controlledIpcMain.handle('usage:stats', () => {
    try {
      if (usageTracker) return usageTracker.getStats()
      return { features: {}, events: [], sessions: 0 }
    } catch (e) {
      return { code: -1, message: e.message, features: {}, events: [], sessions: 0 }
    }
  })

  controlledIpcMain.handle('usage:daily', () => {
    try {
      if (usageTracker) return usageTracker.getDailyStats()
      return {}
    } catch (e) {
      return { code: -1, message: e.message }
    }
  })

  controlledIpcMain.handle('usage:track', (event, args) => {
    try {
      if (usageTracker && args) {
        usageTracker.trackEvent(args.feature, args.action, args.detail)
      }
      return true
    } catch (e) {
      return { code: -1, message: e.message }
    }
  })
}

/**
 * 注册所有 IPC handlers
 * @param {object} deps
 * @param {object} deps.app - Electron app 实例
 * @param {object} deps.BrowserWindow - BrowserWindow 类
 * @param {object} deps.context - createAppContext 返回的上下文
 */
function registerAllIpcHandlers({ app, BrowserWindow, context }) {
  const {
    renderEngine, taskQueue, history, scheduler, autoUpdater, hotkeys, firstRun,
    authViewManager, pythonBridge, AccountManager, store,
    _platformConfig, _sensitiveFilter, _dataSync, publisherRouter, serviceBus,
    analyticsService, proxyPool, _chunkedUploader, keywordMonitor,
    BACKEND_PLATFORMS, templateManager, licenseManager, aiWriter,
    compositionManager, aiGenerator, assetGenerator, videoEngine, pipelineEngine, modelProviderManager,
    story2videoBatchQueue, runStateStore,
    // rewriteHardConstraintManager：当前无直接 IPC handler 消费（审查 m4），
    // 保留传递为后续桌面端管理入口预留；引擎注入经 container 单例完成
    opsCenterSync, rewriteStrategyManager, rewriteHardConstraintManager, rewriteAiTasteMapManager, rewriteEngineService,
    projectService, boardService, contactSheetService, approvalGateService,
    executionRecorder, usageTracker, cloudPublisher, identityService,
    filmEngineeringService,
    fullAutoPipeline,
    automationScheduler,
    story2videoProjectService, story2videoMediaServer,
    promptEvalService, signalCollector, promptMemory, governance,
    knowledgeLibraryService, patternExtractionService,
    performanceRecrawlService, patternAttributionService,
    urlCollector,
    zhihuImageLocalizer,
    hotTopicsService,
    callbackServer,
    splitterBridge, promptBridge,
    riskSuspender,
    // 快捷采集：检索复用 content-intelligence（同一份相关性门禁与缓存策略）
    contentIntelligence,
  } = context

  // publish-frequency-policy-v2：发布频率守卫单例（容器注册项）。优先取 context 上的引用，
  // 其次经容器现取；整体 try 包裹并在失败时降级为 null —— IPC 侧据此如实回报「服务未初始化」，
  // 绝不允许在装配期抛错把整条 IPC 注册链带崩。
  const publishIntervalGuardForIpc = (() => {
    try {
      if (context && context.publishIntervalGuard) return context.publishIntervalGuard
      if (context && context.container && typeof context.container.get === 'function') {
        return context.container.get('publishIntervalGuard')
      }
    } catch (_) { /* 降级为 null，由 IPC 侧回报未初始化 */ }
    return null
  })()

  const registerAllHandlers = require('../ipc-handlers')
  const handlerDependencies = {
    app, BrowserWindow, log, renderEngine, taskQueue, history,
    scheduler, autoUpdater, hotkeys, firstRun, authViewManager, pythonBridge,
    AccountManager, store, _platformConfig, _sensitiveFilter, _dataSync,
    publisherRouter, serviceBus,
    analyticsService, proxyPool, _chunkedUploader, keywordMonitor,
    BACKEND_PLATFORMS, templateManager, licenseManager, aiWriter,
    compositionManager, aiGenerator, assetGenerator, videoEngine, pipelineEngine, modelProviderManager,
    story2videoBatchQueue, runStateStore,
    // rewriteHardConstraintManager：当前无直接 IPC handler 消费（审查 m4），
    // 保留传递为后续桌面端管理入口预留；引擎注入经 container 单例完成
    opsCenterSync, rewriteStrategyManager, rewriteHardConstraintManager, rewriteAiTasteMapManager, rewriteEngineService,
    projectService, boardService, contactSheetService, approvalGateService,
    executionRecorder, identityService, credentialStore, accountStateRestorer,
    filmEngineeringService,
    fullAutoPipeline,
    automationScheduler,
    story2videoProjectService, story2videoMediaServer,
    promptEvalService, signalCollector, promptMemory, governance,
    knowledgeLibraryService, patternExtractionService,
    performanceRecrawlService, patternAttributionService,
    urlCollector,
    zhihuImageLocalizer,
    hotTopicsService,
    callbackServer,
    splitterBridge, promptBridge,
    riskSuspender,
    // 快捷采集（quick-collect）：检索面复用 content-intelligence 单例；
    // aiGenerator 已在上面同一份依赖里，handler 侧按需读取（不缺一档就整个功能不可用）
    contentIntelligence,
  }

  // ─── 博主监控依赖（PRD-CREATOR-WIRING-2026-10-07 §1）────────
  // 为什么在这里组、而不是容器装配期：
  //   ① 门面依赖 store.db，而容器装配期 sql.js 尚未就绪（db 为 null）；
  //   ② 本注册点的时机保证 store 已 ready，与门面同源取值。
  // 容器只注册 creatorStore / creatorCollector / creatorRuntime 三个；
  // creatorMonitor 是**门面**（恰 4 个方法），creatorQuota 包 store 的账本方法。
  // 任何一项缺失都只记警告并留 undefined —— handler 侧对依赖缺失有降级路径，
  // 在这里抛错会让整个 IPC 注册连带失败，波及所有其他通道。
  const creatorDeps = (() => {
    try {
      const { createCreatorMonitorFacade, createCreatorQuota } = require('../services/creator-wiring')
      const get = (n) => (context && typeof context.get === 'function' ? context.get(n) : undefined)
      const creatorStore = get('creatorStore')
      const creatorRuntime = get('creatorRuntime')
      const creatorCollector = get('creatorCollector')
      const facade = creatorRuntime ? createCreatorMonitorFacade({ creatorRuntime }) : undefined
      const quota = creatorStore ? createCreatorQuota(creatorStore) : undefined
      if (!facade || !quota) {
        log && log.warn && log.warn('[IPC] 博主监控依赖不完整，creator 通道将走降级')
      }
      return { creatorStore, creatorCollector, creatorMonitor: facade, creatorQuota: quota }
    } catch (e) {
      log && log.warn && log.warn('[IPC] 博主监控依赖组装失败，creator 通道将走降级', e && e.message)
      return {}
    }
  })()
  Object.assign(handlerDependencies, creatorDeps)

  let state = registrationStates.get(context)
  if (!state) {
    state = { completed: false, pending: null }
    registrationStates.set(context, state)
  }

  return runOnce(state, () => runIpcRegistrationTransaction(ipcMain, () => {
    // 审计 P2·性能税：preload 侧访问级别改为「推送失效 + TTL 兜底」缓存。广播能力在此绑定一次
    // —— BrowserWindow 只有 bootstrap 持有，业务模块（license.js / identity-service-factory.js）
    // 只调用 emitAccessLevelInvalidated 发信号。绑定失败会让缓存退化为纯 TTL，故不得静默。
    // 自动化任务通知出口：窗口就绪后才有 webContents 可发，故在此延迟注入
    // （容器装配期拿不到 BrowserWindow，构造时硬取会让通知永久静默）。
    if (automationScheduler && typeof automationScheduler.setNotify === 'function') {
      automationScheduler.setNotify((payload) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (win && !win.isDestroyed()) win.webContents.send('automation:notification', payload)
        }
      })
    }
    bindAccessLevelInvalidator(createAccessLevelInvalidator(BrowserWindow, log))
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      licenseManager,
      process.env,
      app,
      identityService,
    )
    const registerCentralHandlers = () => {
      // publish-frequency-policy-v2：守卫在此挂到依赖对象上（对象字面量已闭合，故用赋值）。
      // 放在注册**之前**是硬要求：IPC handler 在调用时才读 deps，但顺序错了会让早期调用拿到 undefined。
      handlerDependencies.publishIntervalGuard = publishIntervalGuardForIpc
      const { createPublishEmergencyReleaseService } = require('../services/publish-emergency-release')
      handlerDependencies.publishEmergencyRelease = createPublishEmergencyReleaseService({
        store, log, app, identityService, now: Date.now,
      })
      return registerAllHandlers(controlledIpcMain, handlerDependencies)
    }
    const cloudRegistration = cloudPublisher
      ? cloudPublisher.registerIpcHandlers(controlledIpcMain)
      : undefined
    const result = isThenable(cloudRegistration)
      ? Promise.resolve(cloudRegistration).then(registerCentralHandlers)
      : registerCentralHandlers()
    if (isThenable(result)) {
      return Promise.resolve(result).then(() => {
        registerUsageHandlers(controlledIpcMain, usageTracker)
        require('../signer/provider').setupSignerAssembly({ ipcMain: controlledIpcMain, BrowserWindow })
      })
    }
    registerUsageHandlers(controlledIpcMain, usageTracker)
    // W3 task 2.4：签名页基建装配（manager↔assembly↔provider↔IPC，
    // controlledIpcMain 已过 isTrustedSender 咽喉点，signer:* 属 via=injected）
    require('../signer/provider').setupSignerAssembly({ ipcMain: controlledIpcMain, BrowserWindow })
    return undefined
  }))
}

module.exports = {
  registerAllIpcHandlers,
  isTrustedSender,
  isThenable,
  runOnce,
  runIpcRegistrationTransaction,
}
