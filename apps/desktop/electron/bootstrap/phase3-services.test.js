// phase3-services.test.js — 不 require('vitest')，使用 test-setup.js 注入的全局 describe/it/expect/vi
__registerMock('../services/logger', {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
})
const mockLoginStatusMonitor = { start: vi.fn(), stop: vi.fn() }
const mockCreateLoginStatusMonitor = vi.fn(() => mockLoginStatusMonitor)
__registerMock('../services/login-status-monitor', {
  createLoginStatusMonitor: mockCreateLoginStatusMonitor,
})
const mockAccountManager = { setOwnerSubjectProvider: vi.fn() }
__registerMock('../publishers/account-manager', mockAccountManager)
__registerMock('../services/analytics-providers', {
  xiaohongshuProvider: { name: 'xhs' },
  douyinProvider: { name: 'douyin' },
})
const mockOfflineManager = { setOwnerSubjectProvider: vi.fn() }
__registerMock('../services/offline-manager', mockOfflineManager)

const log = require('../services/logger')
const { startServices } = require('./phase3-services')

function makeMockDeps(overrides) {
  const mockUsageTracker = {
    trackSession: vi.fn(),
    getStats: vi.fn(),
  }
  const mockContainer = {
    get: vi.fn((key) => {
      if (key === 'publishIntervalGuard') return {}
      if (key === 'commentManager') return mockCommentManager
      if (key === 'batchManager') return mockBatchManager
      return {}
    }),
  }
  const mockCommentManager = {
    setOwnerSubjectProvider: vi.fn(),
    stopAll: vi.fn(async () => {}),
  }
  const mockBatchManager = {
    setOwnerSubjectProvider: vi.fn(),
  }
  const mockStore = {
    init: vi.fn(() => true),
    close: vi.fn(),
    setOwnerSubjectProvider: vi.fn(),
    setSetting: vi.fn(),
    getSetting: vi.fn(() => null),
    setUserSetting: vi.fn(),
    getUserSetting: vi.fn(() => null),
    addCallbackLog: vi.fn(),
  }
  const mockTaskQueue = {
    setStateSaver: vi.fn(),
    setOwnerSubjectProvider: vi.fn(),
    deserialize: vi.fn(() => 0),
  }
  const mockCallbackServer = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  }
  const mockScheduler = {
    restore: vi.fn(() => 0),
    setOwnerSubjectProvider: vi.fn(),
    stopAll: vi.fn(),
  }
  const mockKeywordMonitor = {
    onAlert: vi.fn(),
    getAllHistories: vi.fn(() => ({})),
  }
  const mockAnalyticsService = {
    registerProvider: vi.fn(),
  }
  const mockPythonBridge = {
    setAuthService: vi.fn(),
  }
  const mockCloudPublisher = vi.fn()
  mockCloudPublisher.prototype.registerIpcHandlers = vi.fn()
  const mockModelProviderManager = { init: vi.fn() }
  const mockGetMainWin = vi.fn(() => null)
  const mockLoadIdentityRuntimeEnv = vi.fn(({ env }) => env)
  const mockWaitForStoreReady = vi.fn(() => Promise.resolve())

  return Object.assign({
    container: mockContainer,
    usageTracker: mockUsageTracker,
    store: mockStore,
    taskQueue: mockTaskQueue,
    callbackServer: mockCallbackServer,
    scheduler: mockScheduler,
    keywordMonitor: mockKeywordMonitor,
    analyticsService: mockAnalyticsService,
    pythonBridge: mockPythonBridge,
    CloudPublisher: mockCloudPublisher,
    modelProviderManager: mockModelProviderManager,
    getMainWin: mockGetMainWin,
    loadIdentityRuntimeEnv: mockLoadIdentityRuntimeEnv,
    waitForStoreReady: mockWaitForStoreReady,
  }, overrides)
}

describe('phase3-services.startServices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('使用注入的 usageTracker 记录会话，不写入 global', async () => {
    const mockUsageTracker = { trackSession: vi.fn(), getStats: vi.fn() }
    const deps = makeMockDeps({
      usageTracker: mockUsageTracker,
    })
    await startServices(deps)
    expect(mockUsageTracker.trackSession).toHaveBeenCalled()
  })

  it('store.init 被调用', async () => {
    const deps = makeMockDeps()
    await startServices(deps)
    expect(deps.store.init).toHaveBeenCalled()
  })


  it('等待 SQLite WASM 就绪并在 Store 成功后初始化模型服务商', async () => {
    let releaseSqlite
    const sqliteReady = new Promise((resolve) => { releaseSqlite = resolve })
    const deps = makeMockDeps({ waitForStoreReady: vi.fn(() => sqliteReady) })
    const initializationOrder = []
    deps.store.init.mockImplementation(() => {
      initializationOrder.push('store')
      return true
    })
    deps.modelProviderManager.init.mockImplementation(() => initializationOrder.push('providers'))

    const starting = startServices(deps)
    await Promise.resolve()
    expect(deps.store.init).not.toHaveBeenCalled()
    expect(deps.modelProviderManager.init).not.toHaveBeenCalled()

    releaseSqlite()
    await starting

    expect(initializationOrder).toEqual(['store', 'providers'])
  })

  it('Store 初始化失败时阻止后续服务与模型服务商启动', async () => {
    const deps = makeMockDeps()
    deps.store.init.mockReturnValue(false)

    await expect(startServices(deps)).rejects.toThrow('Local data store failed to initialize')
    expect(deps.modelProviderManager.init).not.toHaveBeenCalled()
    expect(deps.callbackServer.start).not.toHaveBeenCalled()
  })

  it('taskQueue.setStateSaver 被调用', async () => {
    const deps = makeMockDeps()
    await startServices(deps)
    expect(deps.taskQueue.setStateSaver).toHaveBeenCalled()
  })

  it('callbackServer.start 被调用（await）', async () => {
    const deps = makeMockDeps()
    await startServices(deps)
    expect(deps.callbackServer.start).toHaveBeenCalled()
  })

  it('callbackServer.start 失败 — 不抛错，记录 warn', async () => {
    const deps = makeMockDeps({
      callbackServer: { start: vi.fn(async () => { throw new Error('port in use') }) },
    })
    await startServices(deps)
    expect(log.warn).toHaveBeenCalledWith('App', 'Callback server failed to start (port may be in use): port in use')
  })

  it('scheduler.restore 被调用', async () => {
    const deps = makeMockDeps()
    await startServices(deps)
    expect(deps.scheduler.restore).toHaveBeenCalled()
  })

  it('savedState 存在时 taskQueue.deserialize 被调用', async () => {
    const deps = makeMockDeps({
      store: {
        init: vi.fn(() => true),
        setSetting: vi.fn(),
        getSetting: vi.fn(() => '{"tasks":[]}'),
        addCallbackLog: vi.fn(),
      },
      taskQueue: {
        setStateSaver: vi.fn(),
        deserialize: vi.fn(() => 3),
      },
    })
    await startServices(deps)
    expect(deps.taskQueue.deserialize).toHaveBeenCalledWith('{"tasks":[]}')
    expect(deps.store.setSetting).toHaveBeenCalledWith('task_queue_state', null)
  })

  it('keywordMonitor.onAlert 被调用', async () => {
    const deps = makeMockDeps()
    await startServices(deps)
    expect(deps.keywordMonitor.onAlert).toHaveBeenCalled()
  })

  it('关键词监控聚合状态写入当前用户命名空间', async () => {
    vi.useFakeTimers()
    const deps = makeMockDeps()
    deps.keywordMonitor.getAllHistories.mockReturnValue({ topic: [{ total: 1 }] })
    try {
      const result = await startServices(deps)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(deps.store.setUserSetting).toHaveBeenCalledWith(
        'keyword_monitor_state',
        JSON.stringify({ topic: [{ total: 1 }] }),
      )
      await result.rollback()
    } finally {
      vi.useRealTimers()
    }
  })

  it('analytics providers 注册成功', async () => {
    const deps = makeMockDeps()
    await startServices(deps)
    expect(deps.analyticsService.registerProvider).toHaveBeenCalledWith('xiaohongshu', { name: 'xhs' })
    expect(deps.analyticsService.registerProvider).toHaveBeenCalledWith('douyin', { name: 'douyin' })
  })

  it('CloudPublisher 仅构造并返回，IPC 延迟到 Phase 5 受控注册', async () => {
    const deps = makeMockDeps()
    const result = await startServices(deps)

    expect(deps.CloudPublisher).toHaveBeenCalled()
    expect(result.cloudPublisher).toBeInstanceOf(deps.CloudPublisher)
    expect(deps.CloudPublisher.prototype.registerIpcHandlers).not.toHaveBeenCalled()
  })

  it('身份服务注入 CloudPublisher 并随阶段结果返回', async () => {
    const identityService = {
      getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'user-a' } })),
    }
    const createIdentityService = vi.fn(async () => identityService)
    const deps = makeMockDeps({ createIdentityService })
    const result = await startServices(deps)

    expect(createIdentityService).toHaveBeenCalledWith(expect.objectContaining({ store: deps.store }))
    expect(deps.CloudPublisher).toHaveBeenCalledWith(expect.objectContaining({ authService: identityService }))
    expect(deps.pythonBridge.setAuthService).toHaveBeenCalledWith(identityService)
    expect(deps.store.setOwnerSubjectProvider).toHaveBeenCalledWith(expect.any(Function))
    const ownerProvider = deps.store.setOwnerSubjectProvider.mock.calls[0][0]
    expect(ownerProvider()).toBe('user-a')
    expect(result.identityService).toBe(identityService)
    expect(deps.scheduler.restore).toHaveBeenCalledWith('user-a')
    expect(deps.scheduler.setOwnerSubjectProvider).toHaveBeenCalledWith(expect.any(Function))
    expect(deps.taskQueue.setOwnerSubjectProvider).toHaveBeenCalledWith(expect.any(Function))
    expect(mockAccountManager.setOwnerSubjectProvider).toHaveBeenCalledWith(expect.any(Function))
    const commentManager = deps.container.get('commentManager')
    expect(commentManager.setOwnerSubjectProvider).toHaveBeenCalledWith(expect.any(Function))
    const batchManager = deps.container.get('batchManager')
    expect(batchManager.setOwnerSubjectProvider).toHaveBeenCalledWith(expect.any(Function))
    expect(mockOfflineManager.setOwnerSubjectProvider).toHaveBeenCalledWith(expect.any(Function))
  })

  it('身份服务使用合并后的公开运行时配置', async () => {
    const identityEnv = {
      IDENTITY_AUTH_ENABLED: 'true',
      IDENTITY_AUTH_REQUIRED: 'false',
      LOGTO_ENDPOINT: 'https://auth.example.com',
    }
    const identityService = {
      getState: vi.fn(() => ({ status: 'signed_out' })),
    }
    const createIdentityService = vi.fn(async () => identityService)
    const loadIdentityRuntimeEnv = vi.fn(() => identityEnv)
    const deps = makeMockDeps({ createIdentityService, loadIdentityRuntimeEnv })

    await startServices(deps)

    expect(loadIdentityRuntimeEnv).toHaveBeenCalledWith({ env: process.env })
    expect(createIdentityService).toHaveBeenCalledWith(expect.objectContaining({
      env: identityEnv,
      store: deps.store,
    }))
  })

  it('方案C 零配置：把解析出的 OPS_CENTER_URL 注入运营中心同步（setOpsCenterUrl + setGetAccessToken）', async () => {
    const identityEnv = { IDENTITY_AUTH_ENABLED: 'true', OPS_CENTER_URL: 'https://ops.iart.work' }
    const identityService = {
      getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'user-a' } })),
      getAccessToken: vi.fn(async () => 'jwt'),
    }
    const createIdentityService = vi.fn(async () => identityService)
    const loadIdentityRuntimeEnv = vi.fn(() => identityEnv)
    const opsCenterSync = { setGetAccessToken: vi.fn(), setOpsCenterUrl: vi.fn() }
    const deps = makeMockDeps({ createIdentityService, loadIdentityRuntimeEnv, opsCenterSync })
    await startServices(deps)
    expect(opsCenterSync.setOpsCenterUrl).toHaveBeenCalledWith('https://ops.iart.work')
    expect(opsCenterSync.setGetAccessToken).toHaveBeenCalledWith(expect.any(Function))
  })

  it('运营配置落地后广播 ops-center:runtime-updated，让侧边栏免重启刷新', async () => {
    const send = vi.fn()
    let currentWin = { isDestroyed: vi.fn(() => false), webContents: { send } }
    const opsCenterSync = { setGetAccessToken: vi.fn(), setOpsCenterUrl: vi.fn(), setOnRuntimeUpdated: vi.fn() }
    const deps = makeMockDeps({
      createIdentityService: vi.fn(async () => ({
        getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'user-a' } })),
        getAccessToken: vi.fn(async () => 'jwt'),
      })),
      loadIdentityRuntimeEnv: vi.fn(() => ({ IDENTITY_AUTH_ENABLED: 'true', OPS_CENTER_URL: 'https://ops.iart.work' })),
      opsCenterSync,
      getMainWin: vi.fn(() => currentWin),
    })
    await startServices(deps)

    expect(opsCenterSync.setOnRuntimeUpdated).toHaveBeenCalledWith(expect.any(Function))
    const notify = opsCenterSync.setOnRuntimeUpdated.mock.calls[0][0]

    notify({ syncedAt: 'server-t' })
    expect(send).toHaveBeenCalledWith('ops-center:runtime-updated', expect.objectContaining({ syncedAt: expect.any(String) }))

    // 窗口尚未创建 / 已销毁时广播静默跳过：同步结果已落盘，通知不得成为失败源
    send.mockClear()
    currentWin = null
    expect(() => notify({})).not.toThrow()
    currentWin = { isDestroyed: vi.fn(() => true), webContents: { send } }
    expect(() => notify({})).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('方案C 零配置：identityEnv 无 OPS_CENTER_URL 时不调用 setOpsCenterUrl', async () => {
    const identityEnv = { IDENTITY_AUTH_ENABLED: 'true' }
    const identityService = { getState: vi.fn(() => ({ status: 'signed_out' })), getAccessToken: vi.fn(async () => '') }
    const createIdentityService = vi.fn(async () => identityService)
    const loadIdentityRuntimeEnv = vi.fn(() => identityEnv)
    const opsCenterSync = { setGetAccessToken: vi.fn(), setOpsCenterUrl: vi.fn() }
    const deps = makeMockDeps({ createIdentityService, loadIdentityRuntimeEnv, opsCenterSync })
    await startServices(deps)
    expect(opsCenterSync.setOpsCenterUrl).not.toHaveBeenCalled()
  })
  it('发行配置加载失败时不允许在 shadow 阶段静默降级', async () => {
    const failure = new Error('identity public config is invalid')
    const deps = makeMockDeps({
      loadIdentityRuntimeEnv: vi.fn(() => { throw failure }),
      createIdentityService: vi.fn(),
    })

    await expect(startServices(deps)).rejects.toBe(failure)
    expect(deps.createIdentityService).not.toHaveBeenCalled()
    expect(deps.CloudPublisher).not.toHaveBeenCalled()
  })

  it('shadow 阶段的身份配置错误不允许静默降级', async () => {
    const failure = Object.assign(new Error('identity config is invalid'), {
      code: 'IDENTITY_CONFIG_INVALID',
    })
    const deps = makeMockDeps({
      loadIdentityRuntimeEnv: vi.fn(() => ({ IDENTITY_AUTH_REQUIRED: 'false' })),
      createIdentityService: vi.fn(async () => { throw failure }),
    })

    await expect(startServices(deps)).rejects.toBe(failure)
    expect(deps.CloudPublisher).not.toHaveBeenCalled()
  })

  it.each(['1', 'true', 'yes', 'on', ' TRUE '])('required=%s 时身份初始化失败必须阻止启动', async (required) => {
    const previous = process.env.IDENTITY_AUTH_REQUIRED
    process.env.IDENTITY_AUTH_REQUIRED = required
    const failure = new Error('identity bootstrap failed')
    const deps = makeMockDeps({ createIdentityService: vi.fn(async () => { throw failure }) })
    try {
      await expect(startServices(deps)).rejects.toBe(failure)
      expect(deps.CloudPublisher).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.IDENTITY_AUTH_REQUIRED
      else process.env.IDENTITY_AUTH_REQUIRED = previous
    }
  })

  it('公开配置声明 required 时身份初始化失败必须阻止启动', async () => {
    const failure = new Error('identity public config bootstrap failed')
    const deps = makeMockDeps({
      loadIdentityRuntimeEnv: vi.fn(() => ({ IDENTITY_AUTH_REQUIRED: 'true' })),
      createIdentityService: vi.fn(async () => { throw failure }),
    })

    await expect(startServices(deps)).rejects.toBe(failure)
    expect(deps.CloudPublisher).not.toHaveBeenCalled()
  })

  it('启动成功时返回退出阶段需要的定时器和登录监控引用', async () => {
    const deps = makeMockDeps()

    const result = await startServices(deps)

    expect(result.keywordPersistTimer).toBeDefined()
    expect(result.loginStatusMonitor).toBe(mockLoginStatusMonitor)
  })

  it('CloudPublisher 构造失败时回滚已经启动的阶段3资源', async () => {
    const registerError = new Error('CloudPublisher constructor failed')
    const CloudPublisher = vi.fn(function () { throw registerError })
    const identityService = {
      getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'user-a' } })),
      dispose: vi.fn(async () => {}),
    }
    const deps = makeMockDeps({
      CloudPublisher,
      createIdentityService: vi.fn(async () => identityService),
    })
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    await expect(startServices(deps)).rejects.toBe(registerError)

    expect(mockLoginStatusMonitor.stop).toHaveBeenCalledTimes(1)
    expect(deps.scheduler.stopAll).toHaveBeenCalledTimes(1)
    expect(deps.callbackServer.stop).toHaveBeenCalledTimes(1)
    expect(deps.taskQueue.setStateSaver).toHaveBeenLastCalledWith(null)
    expect(deps.scheduler.setOwnerSubjectProvider).toHaveBeenLastCalledWith(null)
    expect(deps.taskQueue.setOwnerSubjectProvider).toHaveBeenLastCalledWith(null)
    expect(mockOfflineManager.setOwnerSubjectProvider).toHaveBeenLastCalledWith(null)
    expect(deps.pythonBridge.setAuthService).toHaveBeenLastCalledWith(null)
    expect(identityService.dispose).toHaveBeenCalledTimes(1)
    expect(deps.store.close).toHaveBeenCalledTimes(1)
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('Store 不支持 owner provider 时仍绑定账号凭据归属', async () => {
    const identityService = {
      getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'user-a' } })),
    }
    const deps = makeMockDeps({ createIdentityService: vi.fn(async () => identityService) })
    delete deps.store.setOwnerSubjectProvider

    const result = await startServices(deps)

    expect(mockAccountManager.setOwnerSubjectProvider).toHaveBeenCalledWith(expect.any(Function))
    const ownerProvider = mockAccountManager.setOwnerSubjectProvider.mock.calls[0][0]
    expect(ownerProvider()).toBe('user-a')
    await result.rollback()
    expect(mockAccountManager.setOwnerSubjectProvider).toHaveBeenLastCalledWith(null)
  })
})
