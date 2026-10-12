// @ts-check
/**
 * Phase5-IPC P1-B 回归测试：IPC sender 来源验证
 *
 * 验证：
 *   - 可信来源（app://, file://, dev localhost）正常处理
 *   - 不可信来源（https://evil.com）返回默认值不处理
 *   - event.senderFrame 缺失时返回 false（防呆）
 */
__enableElectronMock()

// Mock logger
__registerMock('../services/logger', {
  info: () => {},
  warn: () => {},
  error: () => {},
})

// Mock ipc-handlers/index（由测试控制同步失败和异步拒绝）
const mockRegisterAllHandlers = vi.fn()
__registerMock('../ipc-handlers', mockRegisterAllHandlers)

const { ipcMain, BrowserWindow } = require('electron')
const {
  registerAllIpcHandlers,
  isTrustedSender,
  runIpcRegistrationTransaction,
} = require('./phase5-ipc')

function makeTrustedEvent() {
  return { senderFrame: { url: 'app://localhost/index.html' } }
}

function makeUntrustedEvent() {
  return { senderFrame: { url: 'https://evil.example/' } }
}

describe('usageTracker context 注入', () => {
  const app = { isPackaged: true }

  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    mockRegisterAllHandlers.mockReset()
    mockRegisterAllHandlers.mockImplementation(() => {})
  })

  it('usage:* handlers 只调用 context 中的 usageTracker', async () => {
    const usageTracker = {
      getStats: vi.fn(() => ({ sessions: 2 })),
      getDailyStats: vi.fn(() => ({ '2026-07-17': 3 })),
      trackEvent: vi.fn(),
    }
    registerAllIpcHandlers({ app, BrowserWindow, context: { usageTracker } })

    // controlledIpcMain 的 dynamicallyAuthorizedHandler 是 async，需 await
    await expect(ipcMain._handlers['usage:stats'](makeTrustedEvent())).resolves.toEqual({ sessions: 2 })
    await expect(ipcMain._handlers['usage:daily'](makeTrustedEvent())).resolves.toEqual({ '2026-07-17': 3 })
    await expect(ipcMain._handlers['usage:track'](makeTrustedEvent(), {
      feature: 'publish', action: 'start', detail: { platform: 'wechat' },
    })).resolves.toBe(true)
    expect(usageTracker.getStats).toHaveBeenCalledTimes(1)
    expect(usageTracker.getDailyStats).toHaveBeenCalledTimes(1)
    expect(usageTracker.trackEvent).toHaveBeenCalledWith('publish', 'start', { platform: 'wechat' })
  })

  it('usage:* handlers 拒绝不可信来源且不调用 usageTracker', async () => {
    const usageTracker = {
      getStats: vi.fn(() => ({ sessions: 2 })),
      getDailyStats: vi.fn(() => ({ '2026-07-17': 3 })),
      trackEvent: vi.fn(),
    }
    registerAllIpcHandlers({ app, BrowserWindow, context: { usageTracker } })

    // #531 多语言后 untrustedSender 附带 errorCode（UNTRUSTED_SENDER），用 toMatchObject 断言核心字段
    const expected = { code: -3, errorCode: 'UNTRUSTED_SENDER', message: '未授权的调用来源' }
    await expect(ipcMain._handlers['usage:stats'](makeUntrustedEvent())).resolves.toEqual(expected)
    await expect(ipcMain._handlers['usage:daily'](makeUntrustedEvent())).resolves.toEqual(expected)
    await expect(ipcMain._handlers['usage:track'](makeUntrustedEvent(), {
      feature: 'publish', action: 'start', detail: { platform: 'wechat' },
    })).resolves.toEqual(expected)

    expect(usageTracker.getStats).not.toHaveBeenCalled()
    expect(usageTracker.getDailyStats).not.toHaveBeenCalled()
    expect(usageTracker.trackEvent).not.toHaveBeenCalled()
  })

  it('context 未提供 usageTracker 时保持默认返回值', async () => {
    registerAllIpcHandlers({ app, BrowserWindow, context: {} })
    await expect(ipcMain._handlers['usage:stats'](makeTrustedEvent())).resolves.toEqual({
      features: {}, events: [], sessions: 0,
    })
    await expect(ipcMain._handlers['usage:daily'](makeTrustedEvent())).resolves.toEqual({})
    await expect(ipcMain._handlers['usage:track'](makeTrustedEvent(), { feature: 'x' })).resolves.toBe(true)
  })

  it('生产注册入口向 Store IPC 注入凭证与账号状态存储', () => {
    const context = {}

    registerAllIpcHandlers({ app, BrowserWindow, context })

    const dependencies = mockRegisterAllHandlers.mock.calls[0][1]
    expect(dependencies.credentialStore).toBe(require('../services/credential-store'))
    expect(dependencies.accountStateRestorer).toBe(require('../services/account-state-restorer'))
  })

  it('context 中的 assetGenerator 流入 handlerDependencies（视频克隆 E2E 根因回归）', () => {
    const assetGenerator = { generateVideo: vi.fn(), generateImage: vi.fn() }
    const context = { assetGenerator }

    registerAllIpcHandlers({ app, BrowserWindow, context })

    const dependencies = mockRegisterAllHandlers.mock.calls[0][1]
    expect(dependencies.assetGenerator).toBe(assetGenerator)
  })

  it('context 中的 serviceBus/publisherRouter 流入 handlerDependencies（视频克隆提示词优化根因回归）', () => {
    const serviceBus = { optimizeVideoPromptsBatch: vi.fn() }
    const publisherRouter = { publish: vi.fn() }
    const context = { serviceBus, publisherRouter }

    registerAllIpcHandlers({ app, BrowserWindow, context })

    const dependencies = mockRegisterAllHandlers.mock.calls[0][1]
    expect(dependencies.serviceBus).toBe(serviceBus)
    expect(dependencies.publisherRouter).toBe(publisherRouter)
  })
})

// ─── 博主监控依赖接线（2026-10-12 事故回归）─────────────────────────────
// 事故：creator 服务在**每一次**启动里都解析成 undefined，11 个 creator 通道
// 全部降级，用户看到的只有「缺少采集依赖。请执行：」（命令位为空）。
// 两个独立成因都要有锁：
//   ① 取值路径写错（`context` 是分组 Proxy，**没有** `get` 方法）；
//   ② `creatorCredentialProvider` 从未注册 —— 容器 `get` 对未注册名**抛错**，
//      于是 `creatorCollector`（以及依赖它的 `creatorRuntime`）解析失败。
describe('博主监控依赖接线（creator-monitor-depfix 回归锁）', () => {
  const app = { isPackaged: true }
  const fs = require('fs')
  const path = require('path')

  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    mockRegisterAllHandlers.mockReset()
    mockRegisterAllHandlers.mockImplementation(() => {})
  })

  function fakeCreatorServices () {
    return {
      creatorStore: {
        listCreators: async () => [],
        countPending: () => 0,
        canSpend: () => true,
        spend: () => {},
      },
      creatorCollector: { resolveChannelId: async () => 'UC_x' },
      creatorRuntime: {
        probeCreator: async () => ({}),
        collectOne: async () => ({}),
        collectBatch: async () => ({ collected: 0, failed: 0 }),
      },
      creatorCredentialProvider: {
        status: () => ({ status: 'not_configured' }),
        getApiKey: () => null,
        setApiKey: () => ({ ok: true }),
        clear: () => ({ ok: true }),
      },
    }
  }

  it('从 context.container.get 解析 creator 依赖（分组 Proxy 自身没有 get）', () => {
    const services = fakeCreatorServices()
    const container = { get: (name) => services[name] }

    registerAllIpcHandlers({ app, BrowserWindow, context: { container } })

    const deps = mockRegisterAllHandlers.mock.calls[0][1]
    expect(deps.creatorStore).toBe(services.creatorStore)
    expect(deps.creatorCollector).toBe(services.creatorCollector)
    expect(deps.creatorCredential).toBe(services.creatorCredentialProvider)
    // 门面恰含 4 个方法，且必须是经 runtime 转发（不是把 runtime 原样塞进去）
    expect(typeof deps.creatorMonitor.probeCreator).toBe('function')
    expect(typeof deps.creatorMonitor.collectBatch).toBe('function')
    // 配额包是 store 的账本方法适配层
    expect(typeof deps.creatorQuota.canSpend).toBe('function')
  })

  it('context 顶层直取仍可用（测试/显式注入路径不被破坏）', () => {
    const services = fakeCreatorServices()

    registerAllIpcHandlers({
      app,
      BrowserWindow,
      context: {
        creatorStore: services.creatorStore,
        creatorCollector: services.creatorCollector,
        creatorRuntime: services.creatorRuntime,
        creatorCredentialProvider: services.creatorCredentialProvider,
      },
    })

    const deps = mockRegisterAllHandlers.mock.calls[0][1]
    expect(deps.creatorStore).toBe(services.creatorStore)
    expect(typeof deps.creatorMonitor.collectOne).toBe('function')
  })

  it('容器缺项时只降级、不抛（报错会把整条 IPC 注册连带带崩）', () => {
    const container = { get: () => { throw new Error('Service not registered: creatorStore') } }
    expect(() => registerAllIpcHandlers({ app, BrowserWindow, context: { container } })).not.toThrow()
    const deps = mockRegisterAllHandlers.mock.calls[0][1]
    expect(deps.creatorStore).toBeUndefined()
  })

  it('⛔ 源码里不得再出现 `context.get(` —— 那个方法不存在，写了就是静默全降级', () => {
    const src = fs.readFileSync(path.join(__dirname, 'phase5-ipc.js'), 'utf8')
    expect(src).not.toContain('context.get(')
    // 反向断言：真实的取值口必须在位（否则上面那条"不出现"会以删除功能的方式变绿）
    expect(src).toContain("typeof container.get === 'function'")
  })
})

describe('IPC 注册生命周期', () => {
  const app = { isPackaged: true }

  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    mockRegisterAllHandlers.mockReset()
    mockRegisterAllHandlers.mockImplementation(() => {})
  })

  function useStrictHandle() {
    const originalHandle = ipcMain.handle
    ipcMain.handle = vi.fn(function (channel, handler) {
      if (this._handlers[channel]) {
        throw new Error('Attempted to register a second handler for ' + channel)
      }
      this._handlers[channel] = handler
    })
    return () => { ipcMain.handle = originalHandle }
  }

  it('同步注册中断会回滚已添加的 channel，重试成功后保持幂等', () => {
    const restoreHandle = useStrictHandle()
    const context = {}
    mockRegisterAllHandlers
      .mockImplementationOnce((target) => {
        target.handle('phase5:partial-sync', vi.fn())
        target.on('phase5:partial-listener', vi.fn())
        throw new Error('业务 IPC 同步注册失败')
      })
      .mockImplementationOnce((target) => {
        target.handle('phase5:partial-sync', vi.fn())
      })

    try {
      expect(() => registerAllIpcHandlers({ app, BrowserWindow, context }))
        .toThrow('业务 IPC 同步注册失败')
      expect(ipcMain._handlers['phase5:partial-sync']).toBeUndefined()
      expect(ipcMain._handlers['phase5:partial-listener']).toBeUndefined()
      expect(ipcMain._handlers['usage:stats']).toBeUndefined()

      expect(() => registerAllIpcHandlers({ app, BrowserWindow, context })).not.toThrow()
      expect(ipcMain._handlers['phase5:partial-sync']).toBeDefined()
      expect(ipcMain._handlers['usage:stats']).toBeDefined()

      expect(() => registerAllIpcHandlers({ app, BrowserWindow, context })).not.toThrow()
      expect(mockRegisterAllHandlers).toHaveBeenCalledTimes(2)
    } finally {
      restoreHandle()
    }
  })

  it('异步注册拒绝会回滚已添加的 channel，并允许后续重试', async () => {
    const restoreHandle = useStrictHandle()
    const context = {}
    mockRegisterAllHandlers
      .mockImplementationOnce(async (target) => {
        target.handle('phase5:partial-async', vi.fn())
        await Promise.resolve()
        throw new Error('业务 IPC 异步注册失败')
      })
      .mockImplementationOnce((target) => {
        target.handle('phase5:partial-async', vi.fn())
      })

    try {
      await expect(registerAllIpcHandlers({ app, BrowserWindow, context }))
        .rejects.toThrow('业务 IPC 异步注册失败')
      expect(ipcMain._handlers['phase5:partial-async']).toBeUndefined()
      expect(ipcMain._handlers['usage:stats']).toBeUndefined()

      await expect(Promise.resolve().then(() => {
        return registerAllIpcHandlers({ app, BrowserWindow, context })
      })).resolves.toBeUndefined()
      expect(ipcMain._handlers['phase5:partial-async']).toBeDefined()
      expect(mockRegisterAllHandlers).toHaveBeenCalledTimes(2)
    } finally {
      restoreHandle()
    }
  })

  it('成功注册后重复调用不会再次注册任何 handler', () => {
    const restoreHandle = useStrictHandle()
    const context = {}

    try {
      registerAllIpcHandlers({ app, BrowserWindow, context })
      expect(() => registerAllIpcHandlers({ app, BrowserWindow, context })).not.toThrow()
      expect(mockRegisterAllHandlers).toHaveBeenCalledTimes(1)
    } finally {
      restoreHandle()
    }
  })

  it('业务 handler 通过真实注册入口动态响应许可证升降级', async () => {
    let isPro = false
    const licenseManager = { isPro: vi.fn(() => isPro) }
    const businessHandler = vi.fn(async () => ({ code: 0, data: 'ok' }))
    const context = { licenseManager }

    mockRegisterAllHandlers.mockImplementation((target) => {
      target.handle('phase5:restricted-channel', businessHandler)
    })

    registerAllIpcHandlers({ app, BrowserWindow, context })
    const registeredHandler = ipcMain._handlers['phase5:restricted-channel']

    await expect(registeredHandler(makeTrustedEvent(), { value: 'free' }))
      .resolves.toMatchObject({ code: -3 })
    expect(businessHandler).not.toHaveBeenCalled()

    isPro = true
    await expect(registeredHandler(makeTrustedEvent(), { value: 'pro' }))
      .resolves.toEqual({ code: 0, data: 'ok' })
    expect(businessHandler).toHaveBeenCalledTimes(1)

    isPro = false
    await expect(registeredHandler(makeTrustedEvent(), { value: 'downgraded' }))
      .resolves.toMatchObject({ code: -3 })
    expect(businessHandler).toHaveBeenCalledTimes(1)
  })

  it('urlCollector 通过 window.js IPC_REGISTRAR_NAMES 自动注册，不在 Phase 5 中心注册重复处理', async () => {
    // PR #1588 曾在 phase5-ipc.js 额外注册 urlCollector，与 window.js 的
    // IPC_REGISTRAR_NAMES（含 urlCollector）重复，导致 "Attempted to register a
    // second handler for 'url-collect:fetch'" 启动崩溃。现已移除 phase5-ipc.js
    // 中的重复注册；urlCollector 仅由 window.js 的 registerIpcRegistrar 统一注册。
    const licenseManager = { isPro: vi.fn(() => true) }
    const urlCollector = {
      registerIpcHandlers: vi.fn((target) => {
        target.handle('url-collect:fetch', vi.fn(async () => ({ code: 0, data: { title: '测试', content: '正文' } })))
      }),
    }
    const context = { urlCollector, licenseManager }

    registerAllIpcHandlers({ app, BrowserWindow, context })
    // Phase 5 不再注册 urlCollector，故不应触发其 registerIpcHandlers
    expect(urlCollector.registerIpcHandlers).not.toHaveBeenCalled()
  })

  it('CloudPublisher 也通过 Phase 5 受控 facade 注册', async () => {
    let isPro = false
    const businessHandler = vi.fn(async () => ({ code: 0, data: 'submitted' }))
    const licenseManager = { isPro: vi.fn(() => isPro) }
    const cloudPublisher = {
      registerIpcHandlers: vi.fn((target) => {
        target.handle('cloud-publisher:restricted-smoke', businessHandler)
      }),
    }
    const context = { cloudPublisher, licenseManager }

    registerAllIpcHandlers({ app, BrowserWindow, context })
    const handler = ipcMain._handlers['cloud-publisher:restricted-smoke']

    await expect(handler(makeTrustedEvent(), { title: 'free' }))
      .resolves.toMatchObject({ code: -3 })
    expect(businessHandler).not.toHaveBeenCalled()

    isPro = true
    await expect(handler(makeTrustedEvent(), { title: 'pro' }))
      .resolves.toEqual({ code: 0, data: 'submitted' })
    expect(cloudPublisher.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(businessHandler).toHaveBeenCalledTimes(1)
  })

  it('并发异步注册事务按顺序执行，并在结束后恢复 ipcMain 方法', async () => {
    const originalHandle = ipcMain.handle
    let releaseFirst
    let releaseSecond
    let secondStarted = false
    const firstGate = new Promise((resolve) => { releaseFirst = resolve })
    const secondGate = new Promise((resolve) => { releaseSecond = resolve })

    const first = runIpcRegistrationTransaction(ipcMain, async () => {
      ipcMain.handle('phase5:concurrent-first', vi.fn())
      await firstGate
    })
    const second = runIpcRegistrationTransaction(ipcMain, async () => {
      secondStarted = true
      ipcMain.handle('phase5:concurrent-second', vi.fn())
      await secondGate
    })

    expect(secondStarted).toBe(false)
    releaseFirst()
    await first
    await Promise.resolve()
    expect(secondStarted).toBe(true)
    releaseSecond()
    await second

    expect(ipcMain.handle).toBe(originalHandle)
    expect(ipcMain._handlers['phase5:concurrent-first']).toBeDefined()
    expect(ipcMain._handlers['phase5:concurrent-second']).toBeDefined()
  })
})

describe('P1-B: isTrustedSender', () => {
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const { pathToFileURL } = require('url')
  const mockApp = { isPackaged: false }
  const mockAppPackaged = { isPackaged: true, getAppPath: () => fixtureAppRoot }
  let fixtureRoot
  let fixtureAppRoot

  beforeAll(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-phase5-ipc-'))
    fixtureAppRoot = path.join(fixtureRoot, 'app')
    fs.mkdirSync(path.join(fixtureAppRoot, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(fixtureAppRoot, 'dist', 'index.html'), '<!doctype html>')
  })

  afterAll(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  function makeEvent(url) {
    return { senderFrame: { url } }
  }

  it('accepts app:// protocol (production)', () => {
    expect(isTrustedSender(makeEvent('app://localhost/index.html'), mockAppPackaged)).toBe(true)
  })

  it('accepts file:// protocol', () => {
    const fileUrl = pathToFileURL(path.join(fixtureAppRoot, 'dist', 'index.html')).href
    expect(isTrustedSender(makeEvent(fileUrl), mockAppPackaged)).toBe(true)
  })

  it('accepts http://localhost in dev mode', () => {
    expect(isTrustedSender(makeEvent('http://localhost:5174/'), mockApp)).toBe(true)
  })

  it('accepts http://127.0.0.1 in dev mode', () => {
    expect(isTrustedSender(makeEvent('http://127.0.0.1:5174/'), mockApp)).toBe(true)
  })

  it('rejects http://localhost in production (app.isPackaged=true)', () => {
    expect(isTrustedSender(makeEvent('http://localhost:5173/'), mockAppPackaged)).toBe(false)
  })

  it('rejects https://evil.com (untrusted origin)', () => {
    expect(isTrustedSender(makeEvent('https://evil.com/'), mockApp)).toBe(false)
  })

  it('rejects https://evil.com in production', () => {
    expect(isTrustedSender(makeEvent('https://evil.com/'), mockAppPackaged)).toBe(false)
  })

  it('rejects when event is null/undefined', () => {
    expect(isTrustedSender(null, mockApp)).toBe(false)
    expect(isTrustedSender(undefined, mockApp)).toBe(false)
  })

  it('rejects when senderFrame is missing', () => {
    expect(isTrustedSender({}, mockApp)).toBe(false)
    expect(isTrustedSender({ senderFrame: null }, mockApp)).toBe(false)
  })

  it('rejects when url is empty', () => {
    expect(isTrustedSender({ senderFrame: { url: '' } }, mockApp)).toBe(false)
    expect(isTrustedSender({ senderFrame: { url: null } }, mockApp)).toBe(false)
  })

  it('rejects when app is null (defensive)', () => {
    // app:// 不依赖 app 实例；file:// 仍必须落在应用 dist 目录。
    expect(isTrustedSender(makeEvent('app://localhost/'), null)).toBe(true)
    expect(isTrustedSender(makeEvent('file:///app/'), null)).toBe(false)
    // 但 dev localhost 需要 app，app 为 null 时不应通过
    expect(isTrustedSender(makeEvent('http://localhost:5173/'), null)).toBe(false)
  })
})
