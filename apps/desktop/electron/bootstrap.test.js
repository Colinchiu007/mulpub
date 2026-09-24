// @ts-check
/**
 * bootstrap.test.js — 测试 createAppContext / runWhenReady
 *
 * 策略：使用 test-setup.js 提供的 global.__electronMock 单例 + __registerMock 注册表，
 * 替代 vi.mock（vi.mock 仅在 vitest SSR 转换层生效，不适用于 CJS require 加载的模块）。
 * 所有深层依赖通过 __registerMock 在顶层注册，beforeAll 中 require('./bootstrap.js') 时生效。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// ─── mock 服务对象定义（顶层，在 __registerMock 之前） ───

// 通用默认 mock（带 registerIpcHandlers/setMainWindow 等方法）
function defaultMock() {
  return {
    registerIpcHandlers: vi.fn(),
    setMainWindow: vi.fn(),
    onProgress: vi.fn(),
    init: vi.fn(),
    seedDefaults: vi.fn(),
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    closeAll: vi.fn(),
    cleanup: vi.fn(),
    stopAll: vi.fn(),
    setExecutor: vi.fn(),
    setStateSaver: vi.fn(),
    deserialize: vi.fn(function () { return 0 }),
    onAlert: vi.fn(),
    getAllHistories: vi.fn(function () { return {} }),
    registerProvider: vi.fn(),
    trackSession: vi.fn(),
    getStats: vi.fn(function () { return {} }),
    getDailyStats: vi.fn(function () { return {} }),
    trackEvent: vi.fn(),
    save: vi.fn(),
  }
}

const mockTaskQueue = {
  setExecutor: vi.fn(),
  on: vi.fn(),
  setStateSaver: vi.fn(),
  deserialize: vi.fn(function () { return 0 }),
}
const mockStore = {
  init: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getPublishTimeline: vi.fn(),
  setPublishTimeline: vi.fn(),
  addCallbackLog: vi.fn(),
  close: vi.fn(),
}
const mockCallbackServer = { start: vi.fn(), stop: vi.fn() }
const mockScheduler = { setTaskQueue: vi.fn(), restore: vi.fn(function () { return 0 }) }
const mockKeywordMonitor = {
  onAlert: vi.fn(),
  getAllHistories: vi.fn(function () { return {} }),
  stopAll: vi.fn(),
}
const mockAnalyticsService = { registerProvider: vi.fn() }
const mockPythonBridge = { startPythonBackend: vi.fn(), stopPythonBackend: vi.fn() }
const mockSystemTray = { registerIpcHandlers: vi.fn(), init: vi.fn() }
const mockHotkeys = { register: vi.fn(), unregister: vi.fn() }
const mockAutoUpdater = { init: vi.fn() }
const mockFirstRun = { runSetup: vi.fn() }
const mockHistory = { addRecord: vi.fn() }
const mockOfflineManager = { startMonitoring: vi.fn(), setTaskQueue: vi.fn() }
const mockPublishMonitor = { createMonitorTask: vi.fn() }
const mockTemplateManager = { seedDefaults: vi.fn() }
const mockLicenseManagerInstance = {}
const mockLicenseManager = { getInstance: vi.fn(function () { return mockLicenseManagerInstance }) }
const mockBatchManager = Object.assign(vi.fn(), {
  setTaskQueue: vi.fn(),
  registerIpcHandlers: vi.fn(),
})
const mockCloudPublisher = vi.fn(function () { return { registerIpcHandlers: vi.fn() } })
const mockUsageTracker = {
  trackSession: vi.fn(),
  trackFeatureUsage: vi.fn(),
  trackDaily: vi.fn(),
  getStats: vi.fn(function () { return {} }),
  getDailyStats: vi.fn(function () { return {} }),
  trackEvent: vi.fn(),
  save: vi.fn(),
}
const mockRenderEngine = {}
const mockCompositionManager = {}
const mockAiGenerator = {}
const mockVideoEngine = {}
const mockPipelineEngine = {}
const mockChunkedUploader = {}
const mockPublisherRouter = { createPublisher: vi.fn() }
const mockAccountManager = { loadSavedCredentials: vi.fn() }
const mockIdentityServiceFactory = {
  createIdentityService: vi.fn(async () => null),
  enabled: vi.fn(() => false),
}
const mockStory2VideoMediaServer = { start: vi.fn(), stop: vi.fn(), createUrl: vi.fn() }
const mockRiskSuspender = {
  isSuspended: vi.fn(function () { return false }),
  suspend: vi.fn(),
  listSuspended: vi.fn(function () { return [] }),
}

// container.get 返回的 mock 服务映射
const services = {
  taskQueue: mockTaskQueue,
  store: mockStore,
  callbackServer: mockCallbackServer,
  keywordMonitor: mockKeywordMonitor,
  analyticsService: mockAnalyticsService,
  usageTracker: mockUsageTracker,
  renderEngine: mockRenderEngine,
  compositionManager: mockCompositionManager,
  aiGenerator: mockAiGenerator,
  videoEngine: mockVideoEngine,
  pipelineEngine: mockPipelineEngine,
  chunkedUploader: mockChunkedUploader,
  publisherRouter: mockPublisherRouter,
  authViewManager: defaultMock(),
  rpaViewManager: defaultMock(),
  webviewManager: defaultMock(),
  qrCodeLogin: defaultMock(),
  contentIntelligence: defaultMock(),
  publishImpactTracker: defaultMock(),
  providerManager: defaultMock(),
  oauthManager: defaultMock(),
  batchManager: mockBatchManager,
  urlCollector: defaultMock(),
  viralEngine: defaultMock(),
  proxyPool: defaultMock(),
  templateManager: mockTemplateManager,
  aiWriter: defaultMock(),
  aggregatorBridge: defaultMock(),
  riskSuspender: mockRiskSuspender,
}

// ─── 注册所有深层依赖 mock（替代 vi.mock） ───
__registerMock('./services/logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
__registerMock('./services/python-bridge', mockPythonBridge)
__registerMock('./publishers/account-manager', mockAccountManager)
// 固定身份工厂结果，避免 bootstrap 测试依赖工作树的公开身份配置。
__registerMock('./services/identity/identity-service-factory', mockIdentityServiceFactory)
__registerMock('./services/story2video-media-server', { getStory2VideoMediaServer: vi.fn(() => mockStory2VideoMediaServer) })
__registerMock('./services/scheduler', mockScheduler)
__registerMock('./services/publish-history', mockHistory)
__registerMock('./services/auto-updater', mockAutoUpdater)
__registerMock('./services/first-run', mockFirstRun)
__registerMock('./services/batch-manager', mockBatchManager)
__registerMock('./services/cloud-publisher', { default: mockCloudPublisher, __esModule: true })
__registerMock('./services/license-manager', mockLicenseManager)
__registerMock('./services/publish-alert', {})
__registerMock('./services/offline-manager', mockOfflineManager)
__registerMock('./services/publish-monitor', mockPublishMonitor)
__registerMock('./services/system-tray', mockSystemTray)
__registerMock('./services/hotkeys', mockHotkeys)
__registerMock('@multi-publish/shared-utils/src/publish-interval-guard', vi.fn())
__registerMock('@multi-publish/shared-utils/src/platform-config', vi.fn())
__registerMock('@multi-publish/shared-utils/src/sensitive-filter', { createWithBuiltin: vi.fn(function () { return {} }) })
__registerMock('@multi-publish/shared-utils/src/data-sync', vi.fn(function () { return {} }))
const mockRegisterAllHandlers = vi.fn()
__registerMock('./ipc-handlers', mockRegisterAllHandlers)
__registerMock('../ipc-handlers', mockRegisterAllHandlers)
__registerMock('./services/analytics-providers', {
  xiaohongshuProvider: {},
  douyinProvider: {},
})
__registerMock('./core/container.setup', {
  createContainer: function () {
    return {
      register: vi.fn(),
      get: function (key) {
        if (services[key]) return services[key]
        return defaultMock()
      },
    }
  },
})

// 通过 require 加载被测模块（在 mock 注册后）
let createAppContext, runWhenReady
beforeAll(() => {
  // 启用 electron mock（opt-in）：bootstrap.js 顶层 require('electron') 需要 mock
  __enableElectronMock()
  const mod = require('./bootstrap.js')
  createAppContext = mod.createAppContext
  runWhenReady = mod.runWhenReady
})

describe('bootstrap — createAppContext', () => {
  let context
  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    context = createAppContext()
  })

  it('返回对象', () => {
    expect(typeof context).toBe('object')
    expect(context).not.toBeNull()
  })

  it('context 包含 container', () => {
    expect(context.container).toBeDefined()
    expect(typeof context.container.get).toBe('function')
  })

  it('context 包含 taskQueue（有 setExecutor/on 方法）', () => {
    expect(context.taskQueue).toBe(mockTaskQueue)
    expect(typeof context.taskQueue.setExecutor).toBe('function')
    expect(typeof context.taskQueue.on).toBe('function')
  })

  it('context 包含 store（有 init/getSetting 方法）', () => {
    expect(context.store).toBe(mockStore)
    expect(typeof context.store.init).toBe('function')
    expect(typeof context.store.getSetting).toBe('function')
  })

  it('context 包含 callbackServer', () => {
    expect(context.callbackServer).toBe(mockCallbackServer)
  })

  it('context 包含 keywordMonitor', () => {
    expect(context.keywordMonitor).toBe(mockKeywordMonitor)
  })

  it('context 包含 analyticsService', () => {
    expect(context.analyticsService).toBe(mockAnalyticsService)
  })

  it('context 包含 pythonBridge', () => {
    expect(context.pythonBridge).toBe(mockPythonBridge)
  })

  it('context 包含 scheduler', () => {
    expect(context.scheduler).toBeDefined()
  })

  it('context 包含 history', () => {
    expect(context.history).toBe(mockHistory)
  })

  it('context 包含 autoUpdater', () => {
    expect(context.autoUpdater).toBe(mockAutoUpdater)
  })

  it('context 包含 hotkeys', () => {
    expect(context.hotkeys).toBe(mockHotkeys)
  })

  it('context 包含 firstRun', () => {
    expect(context.firstRun).toBe(mockFirstRun)
  })

  it('context 包含 systemTray', () => {
    expect(context.systemTray).toBe(mockSystemTray)
  })

  it('context 包含 offlineManager', () => {
    expect(context.offlineManager).toBe(mockOfflineManager)
  })

  it('context 包含 publishMonitor', () => {
    expect(context.publishMonitor).toBe(mockPublishMonitor)
  })

  it('context 包含 renderEngine', () => {
    expect(context.renderEngine).toBe(mockRenderEngine)
  })

  it('context 包含 compositionManager', () => {
    expect(context.compositionManager).toBe(mockCompositionManager)
  })

  it('context 包含 aiGenerator / videoEngine / pipelineEngine', () => {
    expect(context.aiGenerator).toBe(mockAiGenerator)
    expect(context.videoEngine).toBe(mockVideoEngine)
    expect(context.pipelineEngine).toBe(mockPipelineEngine)
  })

  it('context 包含 BACKEND_PLATFORMS（Set，含 youtube/tiktok/twitter）', () => {
    expect(context.BACKEND_PLATFORMS).toBeInstanceOf(Set)
    expect(context.BACKEND_PLATFORMS.has('youtube')).toBe(true)
    expect(context.BACKEND_PLATFORMS.has('tiktok')).toBe(true)
    expect(context.BACKEND_PLATFORMS.has('twitter')).toBe(true)
  })

  it('context 包含 _platformConfig / _sensitiveFilter / _dataSync / _chunkedUploader', () => {
    expect(context._platformConfig).toBeDefined()
    expect(context._sensitiveFilter).toBeDefined()
    expect(context._dataSync).toBeDefined()
    expect(context._chunkedUploader).toBe(mockChunkedUploader)
  })

  it('context 包含 licenseManager / templateManager / aiWriter', () => {
    expect(context.licenseManager).toBeDefined()
    expect(context.templateManager).toBe(mockTemplateManager)
    expect(context.aiWriter).toBeDefined()
  })

  it('context 包含各 viewManager（authViewManager / rpaViewManager / webviewManager / qrCodeLogin）', () => {
    expect(context.authViewManager).toBeDefined()
    expect(context.rpaViewManager).toBeDefined()
    expect(context.webviewManager).toBeDefined()
    expect(context.qrCodeLogin).toBeDefined()
  })

  it('context 包含 oauthManager / batchManager / urlCollector / providerManager / viralEngine / commentManager', () => {
    expect(context.oauthManager).toBeDefined()
    expect(context.batchManager).toBe(mockBatchManager)
    expect(context.urlCollector).toBeDefined()
    expect(context.providerManager).toBeDefined()
    expect(context.viralEngine).toBeDefined()
    expect(context.commentManager).toBeDefined()
  })

  it('taskQueue.setExecutor 被调用（执行器注入）', () => {
    expect(mockTaskQueue.setExecutor).toHaveBeenCalledTimes(1)
    expect(mockTaskQueue.setExecutor).toHaveBeenCalledWith(expect.any(Function))
  })

  it('任务执行器忽略容器中的已销毁窗口并回退到存活窗口', async () => {
    const context = createAppContext()
    const destroyedWindow = { isDestroyed: vi.fn(function () { return true }) }
    const activeWindow = {
      isDestroyed: vi.fn(function () { return false }),
      webContents: { send: vi.fn() },
    }
    const publisher = { publish: vi.fn().mockResolvedValue({ ok: true }) }
    context.container.has = vi.fn(function () { return true })
    context.container.get = vi.fn(function () { return destroyedWindow })
    __electronMock.BrowserWindow.getAllWindows.mockReturnValueOnce([activeWindow])
    mockPublisherRouter.createPublisher.mockReturnValueOnce(publisher)
    const executor = mockTaskQueue.setExecutor.mock.calls.at(-1)[0]

    await executor({ id: 'task-1', platform: 'douyin' })

    expect(activeWindow.webContents.send).toHaveBeenCalledWith(
      'publish:progress',
      expect.objectContaining({ taskId: 'task-1', stage: '准备发布...' }),
    )
  })

  it('任务执行器把 AbortSignal 传给发布器', async () => {
    const context = createAppContext()
    const publisher = { publish: vi.fn().mockResolvedValue({ ok: true }) }
    mockPublisherRouter.createPublisher.mockReturnValueOnce(publisher)
    const executor = mockTaskQueue.setExecutor.mock.calls.at(-1)[0]
    const controller = new AbortController()

    await executor({ id: 'task-signal', platform: 'weibo' }, { signal: controller.signal })

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-signal' }),
      { signal: controller.signal },
    )
    expect(mockPublisherRouter.createPublisher).toHaveBeenCalledWith(
      'weibo',
      expect.objectContaining({ accountManager: mockAccountManager }),
    )
  })

  it('容器窗口查询失败时任务执行器仍回退到存活窗口', async () => {
    const context = createAppContext()
    const activeWindow = {
      isDestroyed: vi.fn(function () { return false }),
      webContents: { send: vi.fn() },
    }
    const publisher = { publish: vi.fn().mockResolvedValue({ ok: true }) }
    context.container.has = vi.fn(function () { throw new Error('container unavailable') })
    __electronMock.BrowserWindow.getAllWindows.mockReturnValue([activeWindow])
    mockPublisherRouter.createPublisher.mockReturnValueOnce(publisher)
    const executor = mockTaskQueue.setExecutor.mock.calls.at(-1)[0]

    await expect(executor({ id: 'task-2', platform: 'weibo' })).resolves.toEqual({ ok: true })
    expect(activeWindow.webContents.send).toHaveBeenCalled()
  })

  it('风控挂起平台在 executor 派发前被拦截并抛不可重试错误', async () => {
    createAppContext()
    mockRiskSuspender.isSuspended.mockImplementationOnce(function () { return true })
    const executor = mockTaskQueue.setExecutor.mock.calls.at(-1)[0]

    await expect(executor({ id: 'task-r', platform: 'weixin_hf', article: { accountId: 'acc-1' } })).rejects.toMatchObject({
      code: 'risk_suspended', noRetry: true, blocked: true, platform: 'weixin_hf',
    })
    expect(mockRiskSuspender.isSuspended).toHaveBeenCalledWith('weixin_hf', 'acc-1')
    expect(mockPublisherRouter.createPublisher).not.toHaveBeenCalled()
  })

  it('taskQueue.on 注册 4 个事件（task:success/failed/blocked/retry）', () => {
    const events = mockTaskQueue.on.mock.calls.map(function (c) { return c[0] })
    expect(events).toContain('task:success')
    expect(events).toContain('task:failed')
    expect(events).toContain('publish:blocked')
    expect(events).toContain('task:retry')
    expect(mockTaskQueue.on).toHaveBeenCalledTimes(4)
  })

  it('systemTray.registerIpcHandlers 被调用', () => {
    expect(mockSystemTray.registerIpcHandlers).toHaveBeenCalledTimes(1)
  })

  it('scheduler.setTaskQueue 被调用（taskQueue 接线）', () => {
    expect(mockScheduler.setTaskQueue).toHaveBeenCalledWith(mockTaskQueue)
  })

  it('offlineManager.setTaskQueue 被调用', () => {
    expect(mockOfflineManager.setTaskQueue).toHaveBeenCalledWith(mockTaskQueue)
  })

  it('BatchManager.setTaskQueue 被调用', () => {
    expect(mockBatchManager.setTaskQueue).toHaveBeenCalledWith(mockTaskQueue)
  })

  it('templateManager.seedDefaults 被调用', () => {
    expect(mockTemplateManager.seedDefaults).toHaveBeenCalledTimes(1)
  })

  it('offlineManager.startMonitoring 被调用', () => {
    expect(mockOfflineManager.startMonitoring).toHaveBeenCalledTimes(1)
  })

  it('licenseManager.getInstance 被调用', () => {
    expect(mockLicenseManager.getInstance).toHaveBeenCalledTimes(1)
  })
})

describe('bootstrap — runWhenReady', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
  })

  it('runWhenReady 是函数', () => {
    expect(typeof runWhenReady).toBe('function')
  })

  it('runWhenReady 调用 app.whenReady 并注册回调（不抛错）', () => {
    const context = createAppContext()
    const createWindow = vi.fn()
    expect(function () { runWhenReady(context, { createWindow: createWindow }) }).not.toThrow()
  })

  it('runWhenReady 调用 createWindow（whenReady 立即 resolve）', async () => {
    const context = createAppContext()
    const mainWindow = { id: 'main-window' }
    const createWindow = vi.fn(function () { return mainWindow })
    const result = await runWhenReady(context, { createWindow: createWindow })

    expect(result).toBe(mainWindow)
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(context.container.register).toHaveBeenCalledWith('mainWindow', mainWindow, { forceValue: true })
  })

  it('runWhenReady 启动 Story2Video 本机媒体服务并写回 context', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })

    expect(mockStory2VideoMediaServer.start).toHaveBeenCalledTimes(1)
    expect(context.story2videoMediaServer).toBe(mockStory2VideoMediaServer)
  })

  it('异步创建窗口完成后才注册真实窗口实例', async () => {
    let resolveWindow
    const context = createAppContext()
    const mainWindow = { id: 'async-main-window' }
    const createWindow = vi.fn(function () {
      return new Promise((resolve) => { resolveWindow = resolve })
    })

    const readyPromise = runWhenReady(context, { createWindow })
    await vi.waitFor(() => {
      expect(createWindow).toHaveBeenCalledTimes(1)
    })
    expect(context.container.register).not.toHaveBeenCalledWith(
      'mainWindow',
      expect.any(Promise),
      { forceValue: true },
    )

    resolveWindow(mainWindow)
    await expect(readyPromise).resolves.toBe(mainWindow)
    expect(context.container.register).toHaveBeenCalledWith(
      'mainWindow',
      mainWindow,
      { forceValue: true },
    )
  })

  it('等待异步 IPC 注册完成后才创建窗口', async () => {
    let resolveRegistration
    const context = createAppContext()
    const createWindow = vi.fn()
    mockRegisterAllHandlers.mockImplementationOnce(function () {
      return new Promise((resolve) => { resolveRegistration = resolve })
    })

    const readyPromise = runWhenReady(context, { createWindow })
    await vi.waitFor(() => {
      expect(mockRegisterAllHandlers).toHaveBeenCalledTimes(1)
    })
    expect(createWindow).not.toHaveBeenCalled()

    resolveRegistration()
    await readyPromise
    expect(createWindow).toHaveBeenCalledTimes(1)
  })

  it('异步 IPC 注册失败时不创建窗口并回滚启动资源', async () => {
    const registrationError = new Error('IPC registration failed')
    const context = createAppContext()
    const createWindow = vi.fn()
    mockRegisterAllHandlers.mockRejectedValueOnce(registrationError)

    await expect(runWhenReady(context, { createWindow })).rejects.toBe(registrationError)

    expect(createWindow).not.toHaveBeenCalled()
    expect(mockStore.close).toHaveBeenCalledTimes(1)
    expect(mockCallbackServer.stop).toHaveBeenCalledTimes(1)
    expect(mockPythonBridge.stopPythonBackend).toHaveBeenCalledTimes(1)
  })

  it('runWhenReady 返回跟随 app.whenReady 的真实 Promise', async () => {
    let resolveReady
    const originalWhenReady = __electronMock.app.whenReady
    __electronMock.app.whenReady = vi.fn(function () {
      return new Promise((resolve) => { resolveReady = resolve })
    })
    const context = createAppContext()
    const createWindow = vi.fn()

    try {
      const readyPromise = runWhenReady(context, { createWindow })
      expect(readyPromise).toBeInstanceOf(Promise)
      expect(createWindow).not.toHaveBeenCalled()
      resolveReady()
      await readyPromise
      expect(createWindow).toHaveBeenCalledTimes(1)
    } finally {
      __electronMock.app.whenReady = originalWhenReady
    }
  })

  it('runWhenReady 调用 pythonBridge.startPythonBackend', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })
    expect(mockPythonBridge.startPythonBackend).toHaveBeenCalledTimes(1)
  })

  it('runWhenReady 调用 store.init', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })
    expect(mockStore.init).toHaveBeenCalledTimes(1)
  })

  it('runWhenReady 调用 taskQueue.setStateSaver', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })
    expect(mockTaskQueue.setStateSaver).toHaveBeenCalledTimes(1)
    expect(mockTaskQueue.setStateSaver).toHaveBeenCalledWith(expect.any(Function))
  })

  it('runWhenReady 调用 callbackServer.start', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })
    expect(mockCallbackServer.start).toHaveBeenCalledTimes(1)
  })

  it('runWhenReady 调用 scheduler.restore', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })
    expect(mockScheduler.restore).toHaveBeenCalledTimes(1)
    expect(mockScheduler.restore).toHaveBeenCalledWith()
  })

  it('身份服务尚未识别用户时不恢复任务', async () => {
    mockIdentityServiceFactory.createIdentityService.mockResolvedValueOnce({
      getState: vi.fn(() => ({ status: 'signed_out' })),
    })
    const context = createAppContext()

    await runWhenReady(context, { createWindow: vi.fn() })

    expect(mockScheduler.restore).not.toHaveBeenCalled()
  })

  it('身份服务识别用户后按 subject 恢复任务', async () => {
    mockIdentityServiceFactory.createIdentityService.mockResolvedValueOnce({
      getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'user-a' } })),
    })
    const context = createAppContext()

    await runWhenReady(context, { createWindow: vi.fn() })

    expect(mockScheduler.restore).toHaveBeenCalledWith('user-a')
  })

  it('runWhenReady 调用 keywordMonitor.onAlert', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })
    expect(mockKeywordMonitor.onAlert).toHaveBeenCalledTimes(1)
  })

  it('runWhenReady 注册 analytics providers（xiaohongshu / douyin）', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })
    expect(mockAnalyticsService.registerProvider).toHaveBeenCalledWith('xiaohongshu', expect.anything())
    expect(mockAnalyticsService.registerProvider).toHaveBeenCalledWith('douyin', expect.anything())
  })

  it('runWhenReady 使用 context 中的 usageTracker 记录会话', async () => {
    const context = createAppContext()
    await runWhenReady(context, { createWindow: vi.fn() })
    expect(mockUsageTracker.trackSession).toHaveBeenCalledTimes(1)
  })

  it('runWhenReady 将可等待的 bridge 和阶段3资源引用写回 context', async () => {
    const context = createAppContext()

    await runWhenReady(context, { createWindow: vi.fn() })

    expect(context.stopBridges).toBeTypeOf('function')
    expect(context.loginStatusMonitor).toBeDefined()
    expect(context.keywordPersistTimer).toBeDefined()
  })

  it('阶段3启动失败时等待 bridge 回滚并拒绝启动 Promise', async () => {
    const startupError = new Error('cloud publisher failed')
    mockCloudPublisher.mockImplementationOnce(function () { throw startupError })
    const context = createAppContext()

    await expect(runWhenReady(context, { createWindow: vi.fn() })).rejects.toBe(startupError)

    expect(mockPythonBridge.stopPythonBackend).toHaveBeenCalledTimes(1)
  })

  it('bridge 启动同步失败时清理所有 bridge 并保留原始错误', async () => {
    const startupError = new Error('splitter failed synchronously')
    const context = createAppContext()
    let splitterStopReceiver
    let promptStopReceiver
    context.splitterBridge.start.mockImplementationOnce(function () { throw startupError })
    context.splitterBridge.stop.mockImplementationOnce(function () { splitterStopReceiver = this })
    context.promptBridge.stop.mockImplementationOnce(function () { promptStopReceiver = this })

    await expect(runWhenReady(context, { createWindow: vi.fn() })).rejects.toBe(startupError)

    expect(mockPythonBridge.stopPythonBackend).toHaveBeenCalledTimes(1)
    expect(context.splitterBridge.stop).toHaveBeenCalledTimes(1)
    expect(context.promptBridge.stop).toHaveBeenCalledTimes(1)
    expect(splitterStopReceiver).toBe(context.splitterBridge)
    expect(promptStopReceiver).toBe(context.promptBridge)
  })

  it('窗口创建失败时回滚阶段3服务和 bridge', async () => {
    const startupError = new Error('window creation failed')
    const context = createAppContext()

    await expect(runWhenReady(context, {
      createWindow: vi.fn(function () { throw startupError }),
    })).rejects.toBe(startupError)

    expect(mockStore.close).toHaveBeenCalledTimes(1)
    expect(mockCallbackServer.stop).toHaveBeenCalledTimes(1)
    expect(mockPythonBridge.stopPythonBackend).toHaveBeenCalledTimes(1)
  })

  it('app.whenReady 拒绝时不启动资源并向调用方传播错误', async () => {
    const readyError = new Error('electron ready failed')
    const originalWhenReady = __electronMock.app.whenReady
    __electronMock.app.whenReady = vi.fn(function () { return Promise.reject(readyError) })
    const context = createAppContext()

    try {
      await expect(runWhenReady(context, { createWindow: vi.fn() })).rejects.toBe(readyError)
      expect(mockPythonBridge.startPythonBackend).not.toHaveBeenCalled()
      expect(mockStore.init).not.toHaveBeenCalled()
    } finally {
      __electronMock.app.whenReady = originalWhenReady
    }
  })
})

