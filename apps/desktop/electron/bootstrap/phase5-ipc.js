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
    opsCenterSync, rewriteStrategyManager, rewriteHardConstraintManager, rewriteEngineService,
    projectService, boardService, contactSheetService, approvalGateService,
    executionRecorder, usageTracker, cloudPublisher, identityService,
    filmEngineeringService,
    fullAutoPipeline,
    story2videoProjectService, story2videoMediaServer,
    promptEvalService, signalCollector, promptMemory, governance,
    knowledgeLibraryService, patternExtractionService,
    performanceRecrawlService, patternAttributionService,
    urlCollector,
    hotTopicsService,
    callbackServer,
    splitterBridge, promptBridge,
    riskSuspender,
  } = context

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
    opsCenterSync, rewriteStrategyManager, rewriteHardConstraintManager, rewriteEngineService,
    projectService, boardService, contactSheetService, approvalGateService,
    executionRecorder, identityService, credentialStore, accountStateRestorer,
    filmEngineeringService,
    fullAutoPipeline,
    story2videoProjectService, story2videoMediaServer,
    promptEvalService, signalCollector, promptMemory, governance,
    knowledgeLibraryService, patternExtractionService,
    performanceRecrawlService, patternAttributionService,
    urlCollector,
    hotTopicsService,
    callbackServer,
    splitterBridge, promptBridge,
    riskSuspender,
  }
  let state = registrationStates.get(context)
  if (!state) {
    state = { completed: false, pending: null }
    registrationStates.set(context, state)
  }

  return runOnce(state, () => runIpcRegistrationTransaction(ipcMain, () => {
    // 审计 P2·性能税：preload 侧访问级别改为「推送失效 + TTL 兜底」缓存。广播能力在此绑定一次
    // —— BrowserWindow 只有 bootstrap 持有，业务模块（license.js / identity-service-factory.js）
    // 只调用 emitAccessLevelInvalidated 发信号。绑定失败会让缓存退化为纯 TTL，故不得静默。
    bindAccessLevelInvalidator(createAccessLevelInvalidator(BrowserWindow, log))
    const controlledIpcMain = createAccessControlledIpcMain(
      ipcMain,
      licenseManager,
      process.env,
      app,
      identityService,
    )
    const registerCentralHandlers = () => {
      return registerAllHandlers(controlledIpcMain, handlerDependencies)
    }
    const cloudRegistration = cloudPublisher
      ? cloudPublisher.registerIpcHandlers(controlledIpcMain)
      : undefined
    const result = isThenable(cloudRegistration)
      ? Promise.resolve(cloudRegistration).then(registerCentralHandlers)
      : registerCentralHandlers()
    if (isThenable(result)) {
      return Promise.resolve(result).then(() => registerUsageHandlers(controlledIpcMain, usageTracker))
    }
    registerUsageHandlers(controlledIpcMain, usageTracker)
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
