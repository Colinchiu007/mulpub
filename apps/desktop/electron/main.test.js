// @ts-check
/**
 * main.test.js — QM-3 启动测试（Phase 3.5）
 *
 * 目标：验证 main.js 入口编排逻辑，覆盖 AGENTS.md QM-3
 *   "node -e \"require('./electron/main.js')\" 不抛错" 的精神
 *   （纯 node 环境下 Electron 二进制未安装，故用 vitest + opt-in mock 验证 require 链 + 编排）
 *
 * 策略：
 *   - mock 三个直接依赖（./bootstrap / ./window / ./shutdown），聚焦 main.js 编排
 *   - 启用 electron mock（main.js 顶层 require('electron')）
 *   - 验证：require 不抛错 / createAppContext 调用 / registerShutdownHandlers 调用 /
 *     runWhenReady 调用 / app.on('activate') 注册 / activate 回调触发 createWindow
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

// ─── mock 三个直接依赖 ─────────────────────────────────
const PROCESS_ERROR_HANDLER_MARKER = Symbol.for('@multi-publish/desktop/process-error-handler')
const PROCESS_ERROR_EVENTS = ['unhandledRejection', 'uncaughtException']
const initialProcessListeners = new Map(PROCESS_ERROR_EVENTS.map((eventName) => (
  [eventName, process.listeners(eventName)]
)))
const mockContainerRegister = vi.fn()
const mockContainerHas = vi.fn(function () { return false })
const mockContainerGet = vi.fn()
const mockContext = {
  _marker: 'mock-context',
  container: {
    register: mockContainerRegister,
    has: mockContainerHas,
    get: mockContainerGet,
  },
}
const mockCreateAppContext = vi.fn(function () { return mockContext })
const mockRunWhenReady = vi.fn(function () { return Promise.resolve() })
const mockCreateWindow = vi.fn()
const mockRegisterShutdownHandlers = vi.fn()
const mockLogError = vi.fn()
const mockLogInfo = vi.fn()

__registerMock('./bootstrap', {
  createAppContext: mockCreateAppContext,
  runWhenReady: mockRunWhenReady,
})
__registerMock('./window', { createWindow: mockCreateWindow })
__registerMock('./shutdown', { registerShutdownHandlers: mockRegisterShutdownHandlers })
__registerMock('./services/logger', { error: mockLogError, info: mockLogInfo })

// ─── 加载 main.js（应在 mock 注册后） ──────────────────
// main.js 顶层会执行 createAppContext() + registerShutdownHandlers() + runWhenReady()
// + app.on('activate', ...)，故 require 即触发全部编排
let mainLoaded
beforeAll(() => {
  __enableElectronMock()
  __electronMock.app.requestSingleInstanceLock = vi.fn(function () { return true })
  // require 前清空调用记录，避免 beforeAll 中的 require 与后续断言混淆
  mockCreateAppContext.mockClear()
  mockRunWhenReady.mockClear()
  mockCreateWindow.mockClear()
  mockRegisterShutdownHandlers.mockClear()
  // cache busting：main.js 可能已被其他测试 require 过，强制重新加载
  delete require.cache[require.resolve('./main.js')]
  mainLoaded = require('./main.js')
})

afterAll(() => {
  for (const eventName of PROCESS_ERROR_EVENTS) {
    const initialListeners = initialProcessListeners.get(eventName)
    for (const listener of process.listeners(eventName)) {
      const isAppHandler = Reflect.get(listener, PROCESS_ERROR_HANDLER_MARKER) === eventName
      if (isAppHandler && !initialListeners.includes(listener)) {
        process.removeListener(eventName, listener)
      }
    }
  }
  delete require.cache[require.resolve('./main.js')]
})

describe('main.js — QM-3 启动测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    __electronMock.app.requestSingleInstanceLock.mockImplementation(function () { return true })
    mockContainerHas.mockReset()
    mockContainerHas.mockImplementation(function () { return false })
    mockContainerGet.mockReset()
    // 重新触发 main.js 编排（清除 cache 后再次 require）
    delete require.cache[require.resolve('./main.js')]
    mockCreateAppContext.mockClear()
    mockRunWhenReady.mockClear()
    mockCreateWindow.mockClear()
    mockRegisterShutdownHandlers.mockClear()
    require('./main.js')
  })

  it('require ./main.js 不抛错', () => {
    expect(function () {
      delete require.cache[require.resolve('./main.js')]
      require('./main.js')
    }).not.toThrow()
  })

  it('在创建应用上下文前取得单实例锁', () => {
    expect(__electronMock.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(
      __electronMock.app.requestSingleInstanceLock.mock.invocationCallOrder[0],
    ).toBeLessThan(mockCreateAppContext.mock.invocationCallOrder[0])
  })

  it('未取得单实例锁时立即退出且不初始化任何资源', () => {
    vi.clearAllMocks()
    __resetElectronMock()
    __electronMock.app.requestSingleInstanceLock.mockImplementationOnce(function () { return false })
    delete require.cache[require.resolve('./main.js')]

    require('./main.js')

    expect(__electronMock.app.quit).toHaveBeenCalledTimes(1)
    expect(mockCreateAppContext).not.toHaveBeenCalled()
    expect(mockRegisterShutdownHandlers).not.toHaveBeenCalled()
    expect(mockRunWhenReady).not.toHaveBeenCalled()
  })

  it('多次清除 require cache 重载时只保留一组进程异常监听器', () => {
    const initialUnhandledRejectionCount = process.listenerCount('unhandledRejection')
    const initialUncaughtExceptionCount = process.listenerCount('uncaughtException')

    for (let index = 0; index < 12; index += 1) {
      delete require.cache[require.resolve('./main.js')]
      require('./main.js')
    }

    expect(process.listenerCount('unhandledRejection')).toBe(initialUnhandledRejectionCount)
    expect(process.listenerCount('uncaughtException')).toBe(initialUncaughtExceptionCount)
  })

  it('进程异常监听器保留原有日志语义', () => {
    const handlers = new Map(PROCESS_ERROR_EVENTS.map((eventName) => {
      const handler = process.listeners(eventName).find((listener) => (
        Reflect.get(listener, PROCESS_ERROR_HANDLER_MARKER) === eventName
      ))
      return [eventName, handler]
    }))
    const rejectionReason = new Error('异步失败')
    const uncaughtError = new Error('同步失败')

    handlers.get('unhandledRejection')(rejectionReason)
    handlers.get('uncaughtException')(uncaughtError)

    expect(mockLogError).toHaveBeenNthCalledWith(1, 'Process', expect.stringContaining('Unhandled rejection:'))
    expect(mockLogError).toHaveBeenNthCalledWith(2, 'Process', expect.stringContaining('Uncaught exception:'))
  })

  it('createAppContext 被调用（同步初始化）', () => {
    expect(mockCreateAppContext).toHaveBeenCalledTimes(1)
  })

  it('registerShutdownHandlers 被调用且接收 context', () => {
    expect(mockRegisterShutdownHandlers).toHaveBeenCalledTimes(1)
    expect(mockRegisterShutdownHandlers).toHaveBeenCalledWith(mockContext)
  })

  it('runWhenReady 被调用且接收 context + createWindow', () => {
    expect(mockRunWhenReady).toHaveBeenCalledTimes(1)
    const args = mockRunWhenReady.mock.calls[0]
    expect(args[0]).toBe(mockContext)
    expect(args[1]).toEqual({ createWindow: mockCreateWindow })
  })

  // 2026-10-21（remove-native-menu-bar）：启动即移除 Electron 默认应用菜单
  // （File/Edit/View/Window 那一行的源头）。
  it('启动时移除默认应用菜单（setApplicationMenu(null)）', () => {
    expect(__electronMock.Menu.setApplicationMenu).toHaveBeenCalledWith(null)
  })

  it('移除应用菜单发生在窗口创建之前', () => {
    expect(
      __electronMock.Menu.setApplicationMenu.mock.invocationCallOrder[0],
    ).toBeLessThan(mockRunWhenReady.mock.invocationCallOrder[0])
  })

  // QM-6 外部评审 i5（Info，采纳并已修）：菜单没被移除只是「不好看」而非「起不来」，
  // 静默失败会让它无从排查 ⇒ 必须留下一条可诊断的日志。
  it('菜单移除结果被记录到日志（失败时能查出原因）', () => {
    expect(mockLogInfo).toHaveBeenCalledWith(
      'App',
      expect.stringContaining('Native application menu removal: '),
    )
  })


  it('app.on 注册 activate 事件', () => {
    expect(__electronMock.app.on).toHaveBeenCalledWith('activate', expect.any(Function))
    expect(__electronMock.app._handlers['activate']).toBeDefined()
  })

  it('second-instance 只恢复并聚焦已有主窗口', () => {
    const mainWindow = {
      isDestroyed: vi.fn(function () { return false }),
      isMinimized: vi.fn(function () { return true }),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    __electronMock.BrowserWindow.getAllWindows.mockReturnValueOnce([mainWindow])

    __electronMock.app._handlers['second-instance']()

    expect(mainWindow.restore).toHaveBeenCalledTimes(1)
    expect(mainWindow.show).toHaveBeenCalledTimes(1)
    expect(mainWindow.focus).toHaveBeenCalledTimes(1)
    expect(mockCreateWindow).not.toHaveBeenCalled()
    expect(mockCreateAppContext).toHaveBeenCalledTimes(1)
  })

  it('second-instance 聚焦窗口失败时记录错误且不向事件循环抛出', () => {
    const focusError = new Error('focus failed')
    const mainWindow = {
      isDestroyed: vi.fn(function () { return false }),
      isMinimized: vi.fn(function () { return false }),
      show: vi.fn(function () { throw focusError }),
      focus: vi.fn(),
    }
    __electronMock.BrowserWindow.getAllWindows.mockReturnValueOnce([mainWindow])

    expect(() => __electronMock.app._handlers['second-instance']()).not.toThrow()
    expect(mockLogError).toHaveBeenCalledWith(
      'App',
      expect.stringContaining('focus failed'),
    )
  })

  it('second-instance 存在多个窗口时优先聚焦容器中的主窗口', () => {
    const secondaryWindow = {
      isDestroyed: vi.fn(function () { return false }),
      isMinimized: vi.fn(function () { return false }),
      show: vi.fn(),
      focus: vi.fn(),
    }
    const mainWindow = {
      isDestroyed: vi.fn(function () { return false }),
      isMinimized: vi.fn(function () { return false }),
      show: vi.fn(),
      focus: vi.fn(),
    }
    mockContainerHas.mockReturnValueOnce(true)
    mockContainerGet.mockReturnValueOnce(mainWindow)
    __electronMock.BrowserWindow._instances = [secondaryWindow, mainWindow]

    __electronMock.app._handlers['second-instance']()

    expect(mainWindow.show).toHaveBeenCalledTimes(1)
    expect(mainWindow.focus).toHaveBeenCalledTimes(1)
    expect(__electronMock.BrowserWindow.getAllWindows).not.toHaveBeenCalled()
    expect(secondaryWindow.show).not.toHaveBeenCalled()
    expect(secondaryWindow.focus).not.toHaveBeenCalled()
  })

  it('容器窗口已销毁时回退到实际窗口列表，避免重复创建', () => {
    const destroyedWindow = {
      isDestroyed: vi.fn(function () { return true }),
    }
    const actualWindow = {
      isDestroyed: vi.fn(function () { return false }),
      isMinimized: vi.fn(function () { return false }),
      show: vi.fn(),
      focus: vi.fn(),
    }
    mockContainerHas.mockReturnValueOnce(true)
    mockContainerGet.mockReturnValueOnce(destroyedWindow)
    __electronMock.BrowserWindow.getAllWindows.mockReturnValueOnce([actualWindow])

    __electronMock.app._handlers['second-instance']()

    expect(actualWindow.show).toHaveBeenCalledTimes(1)
    expect(actualWindow.focus).toHaveBeenCalledTimes(1)
    expect(mockCreateWindow).not.toHaveBeenCalled()
  })

  it('second-instance 在没有窗口时重建并注册主窗口', async () => {
    const recreatedWindow = { id: 'second-instance-window' }
    __electronMock.BrowserWindow.getAllWindows.mockReturnValueOnce([])
    mockCreateWindow.mockReturnValueOnce(recreatedWindow)

    __electronMock.app._handlers['second-instance']()

    await vi.waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledWith(mockContext)
    })
    expect(mockCreateWindow).toHaveBeenCalledWith(mockContext)
    expect(mockContainerRegister).toHaveBeenCalledWith('mainWindow', recreatedWindow, { forceValue: true })
  })

  it('second-instance 等待异步创建完成后注册并聚焦真实窗口', async () => {
    let resolveWindow
    const recreatedWindow = {
      isDestroyed: vi.fn(function () { return false }),
      isMinimized: vi.fn(function () { return false }),
      show: vi.fn(),
      focus: vi.fn(),
    }
    __electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    mockCreateWindow.mockImplementationOnce(function () {
      return new Promise((resolve) => { resolveWindow = resolve })
    })

    __electronMock.app._handlers['second-instance']()
    await vi.waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledTimes(1)
    })
    expect(mockContainerRegister).not.toHaveBeenCalledWith(
      'mainWindow',
      expect.any(Promise),
      { forceValue: true },
    )

    resolveWindow(recreatedWindow)
    await vi.waitFor(() => {
      expect(recreatedWindow.focus).toHaveBeenCalledTimes(1)
    })
    expect(mockContainerRegister).toHaveBeenCalledWith(
      'mainWindow',
      recreatedWindow,
      { forceValue: true },
    )
  })

  it('activate 与 second-instance 并发恢复时只创建并注册一个窗口', async () => {
    let resolveWindow
    const recreatedWindow = {
      isDestroyed: vi.fn(function () { return false }),
      isMinimized: vi.fn(function () { return false }),
      show: vi.fn(),
      focus: vi.fn(),
    }
    __electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    mockCreateWindow.mockImplementation(function () {
      return new Promise((resolve) => { resolveWindow = resolve })
    })

    __electronMock.app._handlers['second-instance']()
    __electronMock.app._handlers['activate']()

    await vi.waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledTimes(1)
    })
    resolveWindow(recreatedWindow)
    await vi.waitFor(() => {
      expect(mockContainerRegister).toHaveBeenCalledTimes(1)
    })
    expect(recreatedWindow.focus).toHaveBeenCalledTimes(1)
  })

  it('窗口恢复失败后清除进行中状态，后续 activate 可以重试', async () => {
    const firstError = new Error('first restore failed')
    const recreatedWindow = { id: 'retry-window' }
    __electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    mockCreateWindow
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce(recreatedWindow)

    __electronMock.app._handlers['second-instance']()
    await vi.waitFor(() => {
      expect(mockLogError).toHaveBeenCalledWith(
        'App',
        expect.stringContaining('first restore failed'),
      )
    })

    __electronMock.app._handlers['activate']()
    await vi.waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledTimes(2)
    })
    expect(mockContainerRegister).toHaveBeenCalledWith(
      'mainWindow',
      recreatedWindow,
      { forceValue: true },
    )
  })

  it('second-instance 在 bootstrap 未完成时等待，避免重复创建主窗口', async () => {
    let resolveStartup
    const mainWindow = {
      isDestroyed: vi.fn(function () { return false }),
      isMinimized: vi.fn(function () { return false }),
      show: vi.fn(),
      focus: vi.fn(),
    }
    vi.clearAllMocks()
    __resetElectronMock()
    __electronMock.app.requestSingleInstanceLock.mockImplementation(function () { return true })
    mockContainerHas.mockReset()
    mockContainerHas
      .mockImplementationOnce(function () { return false })
      .mockImplementationOnce(function () { return true })
    mockContainerGet.mockReset()
    mockContainerGet.mockReturnValueOnce(mainWindow)
    mockRunWhenReady.mockImplementationOnce(function () {
      return new Promise((resolve) => { resolveStartup = resolve })
    })
    delete require.cache[require.resolve('./main.js')]
    require('./main.js')

    __electronMock.app._handlers['second-instance']()
    expect(mockCreateWindow).not.toHaveBeenCalled()

    resolveStartup()
    await vi.waitFor(() => {
      expect(mainWindow.focus).toHaveBeenCalledTimes(1)
    })
    expect(mainWindow.show).toHaveBeenCalledTimes(1)
    expect(mockCreateWindow).not.toHaveBeenCalled()
  })

  it('activate 回调在无窗口时调用 createWindow(context)', async () => {
    // 模拟无窗口场景
    const recreatedWindow = { id: 'recreated-window' }
    __electronMock.BrowserWindow.getAllWindows.mockReturnValueOnce([])
    mockCreateWindow.mockReturnValueOnce(recreatedWindow)
    __electronMock.app._handlers['activate']()
    await vi.waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledWith(mockContext)
    })
    expect(mockCreateWindow).toHaveBeenCalledWith(mockContext)
    expect(mockCreateWindow).toHaveBeenCalledTimes(1)
    expect(mockContainerRegister).toHaveBeenCalledWith('mainWindow', recreatedWindow, { forceValue: true })
  })

  it('activate 回调在有窗口时不调用 createWindow', () => {
    // 模拟已有窗口场景
    __electronMock.BrowserWindow.getAllWindows.mockReturnValueOnce([{ _fake: true }])
    __electronMock.app._handlers['activate']()
    expect(mockCreateWindow).not.toHaveBeenCalled()
  })

  it('启动编排顺序：createAppContext → registerShutdownHandlers → runWhenReady', () => {
    mockCreateAppContext.mockClear()
    mockRegisterShutdownHandlers.mockClear()
    mockRunWhenReady.mockClear()
    const order = []
    mockCreateAppContext.mockImplementationOnce(function () { order.push('ctx'); return mockContext })
    mockRegisterShutdownHandlers.mockImplementationOnce(function () { order.push('shutdown') })
    mockRunWhenReady.mockImplementationOnce(function () { order.push('ready'); return Promise.resolve() })

    delete require.cache[require.resolve('./main.js')]
    require('./main.js')

    expect(order).toEqual(['ctx', 'shutdown', 'ready'])
  })

  it('启动 Promise 拒绝时主动退出，避免未处理拒绝', async () => {
    const startupError = new Error('startup failed')
    vi.clearAllMocks()
    __resetElectronMock()
    __electronMock.app.requestSingleInstanceLock.mockImplementation(function () { return true })
    mockRunWhenReady.mockImplementationOnce(function () { return Promise.reject(startupError) })

    delete require.cache[require.resolve('./main.js')]
    require('./main.js')
    await Promise.resolve()
    await Promise.resolve()

    expect(__electronMock.app.quit).toHaveBeenCalledTimes(1)
  })
})
