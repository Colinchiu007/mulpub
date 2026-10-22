// @ts-check
/**
 * window.test.js — 测试 createWindow(context)
 *
 * 策略：使用 test-setup.js 提供的 global.__electronMock 单例（稳定 BrowserWindow mock），
 * 注入 mock context，验证窗口创建/事件/IPC 注册行为。
 * 不使用 vi.mock（vi.mock 不适用于 CJS require 加载的模块）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// mock 依赖的服务模块（window.js 直接 require 的非 electron 模块）
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), notify: vi.fn(),
}
__registerMock('./services/logger', mockLogger)

// 通过 require 加载被测模块（在 mock 注册后）
let createWindow
let isAllowedMainWindowUrl
beforeAll(() => {
  // 启用 electron mock（opt-in）：window.js 顶层 require('electron') 需要 mock
  __enableElectronMock()
})

// 构造一个 mock context（含 createWindow 需要的所有 manager）
function buildMockContext(overrides) {
  const mk = () => ({
    setMainWindow: vi.fn(),
    setGetMainWin: vi.fn(),
    registerIpcHandlers: vi.fn(),
    _onWindowResize: vi.fn(),
    resize: vi.fn(),
    init: vi.fn(),
    // 2026-10-18：OAuth 授权视图交给 WebviewManager 同步侧栏布局（漏接回归修复）
    setOAuthManager: vi.fn(),
    setSidebarWidth: vi.fn(),
    setSidebarCollapsed: vi.fn(),
  })
  return Object.assign({
    authViewManager: mk(),
    rpaViewManager: mk(),
    webviewManager: mk(),
    qrCodeLogin: mk(),
    oauthManager: mk(),
    batchManager: mk(),
    urlCollector: mk(),
    providerManager: mk(),
    viralEngine: mk(),
    commentManager: mk(),
    contentIntelligence: mk(),
    publishImpactTracker: mk(),
    systemTray: { init: vi.fn() },
    hotkeys: { register: vi.fn() },
    autoUpdater: { init: vi.fn() },
    firstRun: { runSetup: vi.fn() },
  }, overrides)
}

// 便捷访问最新的 BrowserWindow 实例
function lastWindow() {
  const instances = __electronMock.BrowserWindow._instances
  return instances[instances.length - 1]
}

function mockNextWindowWithDestroy() {
  const originalImplementation = __electronMock.BrowserWindow.getMockImplementation()
  __electronMock.BrowserWindow.mockImplementationOnce(function (options) {
    originalImplementation.call(this, options)
    this.destroy = vi.fn()
  })
}

function captureWindowOpenHandler(context) {
  const originalImplementation = __electronMock.BrowserWindow.getMockImplementation()
  const setWindowOpenHandler = vi.fn()
  __electronMock.BrowserWindow.mockImplementationOnce(function (options) {
    originalImplementation.call(this, options)
    this.webContents.setWindowOpenHandler = setWindowOpenHandler
  })
  createWindow(context)
  expect(setWindowOpenHandler).toHaveBeenCalledTimes(1)
  return setWindowOpenHandler.mock.calls[0][0]
}

describe('window — createWindow', () => {
  let context
  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    __electronMock.shell.openExternal = vi.fn().mockResolvedValue(undefined)
    context = buildMockContext()
    // window.js 内 _ipcRegistered 为模块级标记（R28：防止 macOS activate 重复注册 IPC），
    // 跨用例残留会导致除首次 createWindow 外 registerIpcHandlers 不再调用。
    // 每个用例前清缓存重新 require，使 _ipcRegistered 复位为 false。
    delete require.cache[require.resolve('./window.js')]
    const windowModule = require('./window.js')
    createWindow = windowModule.createWindow
    isAllowedMainWindowUrl = windowModule.isAllowedMainWindowUrl
  })

  it('createWindow 是函数', () => {
    expect(typeof createWindow).toBe('function')
  })

  it('创建 BrowserWindow（验证 width/height）', () => {
    createWindow(context)
    expect(__electronMock.BrowserWindow).toHaveBeenCalledTimes(1)
    const opts = __electronMock.BrowserWindow.mock.calls[0][0]
    expect(opts.width).toBe(1280)
    expect(opts.height).toBe(800)
  })

  it('设置 minWidth / minHeight', () => {
    createWindow(context)
    const opts = __electronMock.BrowserWindow.mock.calls[0][0]
    expect(opts.minWidth).toBe(1024)
    expect(opts.minHeight).toBe(600)
  })

  it('webPreferences.contextIsolation = true', () => {
    createWindow(context)
    const opts = __electronMock.BrowserWindow.mock.calls[0][0]
    expect(opts.webPreferences.contextIsolation).toBe(true)
  })

  it('webPreferences.nodeIntegration = false', () => {
    createWindow(context)
    const opts = __electronMock.BrowserWindow.mock.calls[0][0]
    expect(opts.webPreferences.nodeIntegration).toBe(false)
  })

  it('主窗口使用单文件 preload 并启用 sandbox', () => {
    createWindow(context)
    const opts = __electronMock.BrowserWindow.mock.calls[0][0]
    expect(opts.webPreferences.preload.replace(/\\/g, '/'))
      .toMatch(/\/electron\/preload\/index\.bundle\.js$/)
    expect(opts.webPreferences.sandbox).toBe(true)
  })

  it('show: false（延迟显示）', () => {
    createWindow(context)
    const opts = __electronMock.BrowserWindow.mock.calls[0][0]
    expect(opts.show).toBe(false)
  })

  // ── 2026-10-21（remove-native-menu-bar）：去掉窗口顶部 File/Edit/View/Window 那一行 ──
  it('autoHideMenuBar = true（窗口顶部不再常驻系统菜单行）', () => {
    createWindow(context)
    const opts = __electronMock.BrowserWindow.mock.calls[0][0]
    expect(opts.autoHideMenuBar).toBe(true)
  })

  it('主窗口自身的菜单被置空（setMenu(null)，Alt 键也唤不回）', () => {
    createWindow(context)
    const win = lastWindow()
    expect(win.setMenu).toHaveBeenCalledTimes(1)
    expect(win.setMenu).toHaveBeenCalledWith(null)
  })

  it('开发环境加载 127.0.0.1:5174', async () => {
    process.env.NODE_ENV = 'development'
    createWindow(context)
    const win = lastWindow()
    // loadURL 现在排在「清缓存落定」之后（CCG 深度审查第二轮 i1：clearCache 是异步的，
    // 抢跑会让 immutable 旧条目不发网络请求 ⇒ onHeadersReceived 不触发 ⇒ 首屏仍是旧副本）。
    // 判据不变（仍断言以该 URL 加载），只是必须等这条异步时序落定。
    await vi.waitFor(() => {
      expect(win.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5174')
    })
    delete process.env.NODE_ENV
  })

  it('行为锁：loadURL 必须等到清缓存落定（顺序语义，不是文本存在性）', async () => {
    // CCG 深度审查第二轮 i1/i5：仅靠源码文本锁证明不了「loadURL 排在清缓存之后」——
    // 实测把 loadURL 改回同步调用后，文本锁**依然全绿**（M8 变异 NOT-CAUGHT）。
    // 这里用可控 session 做行为断言：clearCache 未落定前不得 loadURL。
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const originalPackaged = __electronMock.app.isPackaged
    const originalImplementation = __electronMock.BrowserWindow.getMockImplementation()
    __electronMock.app.isPackaged = false
    __electronMock.BrowserWindow.mockImplementationOnce(function (options) {
      originalImplementation.call(this, options)
      this.webContents.session = {
        clearCache: () => gate,
        webRequest: { onHeadersReceived: vi.fn() },
      }
    })
    try {
      createWindow(context)
      const win = lastWindow()
      // 清缓存尚未落定：此时不允许发起导航（否则 immutable 旧条目不发网络请求，
      // onHeadersReceived 不触发 ⇒ 首屏仍是旧副本）
      await new Promise((r) => setTimeout(r, 30))
      expect(win.loadURL).not.toHaveBeenCalled()
      release()
      await vi.waitFor(() => {
        expect(win.loadURL).toHaveBeenCalled()
      })
    } finally {
      __electronMock.app.isPackaged = originalPackaged
    }
  })

  it('未打包但 MP_FORCE_PROD_RENDERER=1 时加载 dist/index.html（启动提速 B）', () => {
    const originalPackaged = __electronMock.app.isPackaged
    const originalForce = process.env.MP_FORCE_PROD_RENDERER
    __electronMock.app.isPackaged = false
    process.env.MP_FORCE_PROD_RENDERER = '1'
    try {
      // openDevTools 在 dev 分支里无条件调用；此处走 loadFile 分支，顺带锁住「不再弹开发者工具」
      const originalImplementation = __electronMock.BrowserWindow.getMockImplementation()
      __electronMock.BrowserWindow.mockImplementationOnce(function (options) {
        originalImplementation.call(this, options)
        this.webContents.openDevTools = vi.fn()
      })
      createWindow(context)
      const win = lastWindow()
      expect(win.loadFile).toHaveBeenCalled()
      expect(win.loadURL).not.toHaveBeenCalled()
    } finally {
      __electronMock.app.isPackaged = originalPackaged
      if (originalForce === undefined) delete process.env.MP_FORCE_PROD_RENDERER
      else process.env.MP_FORCE_PROD_RENDERER = originalForce
    }
  })

  it('生产环境加载 dist/index.html', () => {
    delete process.env.NODE_ENV
    // 模拟生产：--dev 不在 argv 且 app.isPackaged = true
    // isDev = NODE_ENV === 'development' || argv.includes('--dev') || !app.isPackaged
    // 当 isPackaged=true 时 !isPackaged=false，isDev=false → loadFile 路径
    __electronMock.app.isPackaged = true
    const origArgv = process.argv
    process.argv = ['node', 'main.js']
    try {
      createWindow(context)
      const win = lastWindow()
      expect(win.loadFile).toHaveBeenCalled()
    } finally {
      process.argv = origArgv
      __electronMock.app.isPackaged = false
    }
  })

  it('打包应用忽略残留开发信号并加载 dist/index.html', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalElectronIsDev = process.env.ELECTRON_IS_DEV
    const originalArgv = process.argv
    const originalPackaged = __electronMock.app.isPackaged

    process.env.NODE_ENV = 'development'
    process.env.ELECTRON_IS_DEV = '1'
    process.argv = ['Multi-Publish.exe', '--dev']
    __electronMock.app.isPackaged = true

    try {
      const originalImplementation = __electronMock.BrowserWindow.getMockImplementation()
      __electronMock.BrowserWindow.mockImplementationOnce(function (options) {
        originalImplementation.call(this, options)
        this.webContents.openDevTools = vi.fn()
      })
      createWindow(context)
      const win = lastWindow()
      expect(win.loadFile).toHaveBeenCalled()
      expect(win.loadURL).not.toHaveBeenCalled()
      expect(win.webContents.openDevTools).not.toHaveBeenCalled()
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = originalNodeEnv
      if (originalElectronIsDev === undefined) delete process.env.ELECTRON_IS_DEV
      else process.env.ELECTRON_IS_DEV = originalElectronIsDev
      process.argv = originalArgv
      __electronMock.app.isPackaged = originalPackaged
    }
  })

  it('主窗口导航只允许可信应用来源', () => {
    process.env.NODE_ENV = 'development'
    expect(isAllowedMainWindowUrl('http://localhost:5174/#/accounts')).toBe(true)
    expect(isAllowedMainWindowUrl('http://localhost.evil.example:5174/')).toBe(false)
    expect(isAllowedMainWindowUrl('https://evil.example/')).toBe(false)
    delete process.env.NODE_ENV
  })

  it.each([
    'https://example.com/published/1',
    'http://example.com/help',
  ])('可信外链 %s 由系统浏览器打开且不创建 Electron 子窗口', async (url) => {
    const handler = captureWindowOpenHandler(context)

    expect(handler({ url })).toEqual({ action: 'deny' })
    await Promise.resolve()
    expect(__electronMock.shell.openExternal).toHaveBeenCalledWith(url)
  })

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'data:text/html,<script>alert(1)</script>',
    'https://user:secret@example.com/',
    'not a url',
  ])('危险或无效外链 %s 被拒绝且不调用系统浏览器', (url) => {
    const handler = captureWindowOpenHandler(context)

    expect(handler({ url })).toEqual({ action: 'deny' })
    expect(__electronMock.shell.openExternal).not.toHaveBeenCalled()
  })

  it.each([
    ['Promise 拒绝', (mock, error) => mock.mockRejectedValueOnce(error)],
    ['同步抛错', (mock, error) => mock.mockImplementationOnce(() => { throw error })],
  ])('系统浏览器打开%s时记录错误且保持拒绝 Electron 子窗口', async (_, configureFailure) => {
    const openError = new Error('无法打开系统浏览器')
    configureFailure(__electronMock.shell.openExternal, openError)
    const handler = captureWindowOpenHandler(context)

    expect(handler({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    await Promise.resolve()
    await Promise.resolve()
    expect(mockLogger.notify).toHaveBeenCalledWith(
      'window',
      'open-external-failed',
      expect.objectContaining({ error: '无法打开系统浏览器' }),
    )
  })

  it('绑定 ready-to-show 事件', () => {
    createWindow(context)
    const win = lastWindow()
    expect(win._handlers['ready-to-show']).toBeDefined()
    expect(typeof win._handlers['ready-to-show']).toBe('function')
  })

  it('绑定 did-finish-load 事件以避免窗口永久隐藏', () => {
    createWindow(context)
    const win = lastWindow()
    expect(win.webContents._handlers['did-finish-load']).toBeDefined()
    expect(typeof win.webContents._handlers['did-finish-load']).toBe('function')
  })

  it('绑定 closed 事件', () => {
    createWindow(context)
    const win = lastWindow()
    expect(win._handlers['closed']).toBeDefined()
  })

  it('绑定 resize 事件', () => {
    createWindow(context)
    const win = lastWindow()
    expect(win._handlers['resize']).toBeDefined()
  })

  it('ready-to-show 回调调用 mainWindow.show', () => {
    createWindow(context)
    const win = lastWindow()
    win._handlers['ready-to-show']()
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(mockLogger.notify).toHaveBeenCalledWith('window', 'main-window-shown')
  })

  it('did-finish-load 在 ready-to-show 未到达时仍显示主窗口', () => {
    createWindow(context)
    const win = lastWindow()
    win.webContents._handlers['did-finish-load']()
    expect(win.show).toHaveBeenCalledTimes(1)
  })

  it('两个显示事件只显示主窗口一次', () => {
    createWindow(context)
    const win = lastWindow()
    win._handlers['ready-to-show']()
    win.webContents._handlers['did-finish-load']()
    expect(win.show).toHaveBeenCalledTimes(1)
  })

  it('显示事件缺失时在五秒后显示主窗口', () => {
    vi.useFakeTimers()
    try {
      createWindow(context)
      const win = lastWindow()
      vi.advanceTimersByTime(5000)
      expect(win.show).toHaveBeenCalledTimes(1)
      expect(mockLogger.notify).toHaveBeenCalledWith('window', 'show-event-missing-fallback', expect.objectContaining({ level: 'WARN' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('resize 回调调用 authViewManager._onWindowResize / webviewManager.resize / qrCodeLogin._onWindowResize', () => {
    createWindow(context)
    const win = lastWindow()
    win._handlers['resize']()
    expect(context.authViewManager._onWindowResize).toHaveBeenCalledTimes(1)
    expect(context.webviewManager.resize).toHaveBeenCalledTimes(1)
    expect(context.qrCodeLogin._onWindowResize).toHaveBeenCalledTimes(1)
  })

  it('调用 authViewManager.setMainWindow', () => {
    createWindow(context)
    expect(context.authViewManager.setMainWindow).toHaveBeenCalledTimes(1)
  })

  it('调用 rpaViewManager.setMainWindow', () => {
    createWindow(context)
    expect(context.rpaViewManager.setMainWindow).toHaveBeenCalledTimes(1)
  })

  it('调用 webviewManager.setMainWindow + registerIpcHandlers', () => {
    createWindow(context)
    expect(context.webviewManager.setMainWindow).toHaveBeenCalledTimes(1)
    expect(context.webviewManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
  })

  it('调用 qrCodeLogin.setMainWindow + registerIpcHandlers', () => {
    createWindow(context)
    expect(context.qrCodeLogin.setMainWindow).toHaveBeenCalledTimes(1)
    expect(context.qrCodeLogin.registerIpcHandlers).toHaveBeenCalledTimes(1)
  })

  it('调用 oauthManager.setMainWindow + registerIpcHandlers', () => {
    createWindow(context)
    expect(context.oauthManager.setMainWindow).toHaveBeenCalledTimes(1)
    expect(context.oauthManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
  })

  it('把 oauthManager 注入 webviewManager（回归：OAuth 视图漏接侧栏宽度/折叠态）', () => {
    // 2026-10-18：oauth-manager._positionView 曾只传 1 参给 computeEmbeddedViewBounds，
    // sidebarWidth 回落默认 200、collapsed 恒 false ⇒ 收起态下 OAuth 视图左侧留
    // 200px 死区、跨 900px 断点后仍按 200 布局。装配链必须把它交给 WebviewManager 同步。
    createWindow(context)
    expect(context.webviewManager.setOAuthManager).toHaveBeenCalledTimes(1)
    expect(context.webviewManager.setOAuthManager).toHaveBeenCalledWith(context.oauthManager)
  })

  it('调用 urlCollector.registerIpcHandlers（回归：35ae6224 误删导致 url-collect:fetch 无 handler）', () => {
    // 35ae6224 从 IPC_REGISTRAR_NAMES 移除 urlCollector 时，phase5-ipc 侧注册
    // 已在 71d0b85f 先行移除，两处都删后 'url-collect:fetch' 彻底无 handler，
    // 采集回退层静默失败。此测试锁定 window.js 是 urlCollector 的唯一注册点。
    createWindow(context)
    expect(context.urlCollector.registerIpcHandlers).toHaveBeenCalledTimes(1)
  })

  it('服务型 IPC 统一拒绝外部来源，并动态响应许可证升级', async () => {
    const originalPackaged = __electronMock.app.isPackaged
    let isPro = false
    const businessHandler = vi.fn(async () => ({ code: 0, data: 'saved' }))
    context.licenseManager = { isPro: vi.fn(() => isPro) }
    context.providerManager.registerIpcHandlers.mockImplementation((injected) => {
      ;(injected || __electronMock.ipcMain).handle('provider:restricted-smoke', businessHandler)
    })
    __electronMock.app.isPackaged = true

    try {
      createWindow(context)
      const handler = __electronMock.ipcMain._handlers['provider:restricted-smoke']
      const trustedEvent = { senderFrame: { url: 'app://localhost/index.html' } }
      const untrustedEvent = { senderFrame: { url: 'https://evil.example/' } }

      await expect(handler(untrustedEvent, { key: 'stolen' }))
        .resolves.toMatchObject({ code: -3 })
      await expect(handler(trustedEvent, { key: 'free' }))
        .resolves.toMatchObject({ code: -3 })
      expect(businessHandler).not.toHaveBeenCalled()

      isPro = true
      await expect(handler(trustedEvent, { key: 'pro' }))
        .resolves.toEqual({ code: 0, data: 'saved' })
      expect(businessHandler).toHaveBeenCalledTimes(1)
    } finally {
      __electronMock.app.isPackaged = originalPackaged
    }
  })

  it('Logto 身份启用时服务型 IPC 不接受本地 Pro license 提权', async () => {
    const originalPackaged = __electronMock.app.isPackaged
    let identityStatus = 'signed_out'
    const businessHandler = vi.fn(async () => ({ code: 0, data: 'saved' }))
    context.licenseManager = { isPro: vi.fn(() => true) }
    context.identityService = { getState: vi.fn(() => ({ status: identityStatus })) }
    context.providerManager.registerIpcHandlers.mockImplementation((injected) => {
      ;(injected || __electronMock.ipcMain).handle('provider:identity-smoke', businessHandler)
    })
    __electronMock.app.isPackaged = true

    try {
      createWindow(context)
      const handler = __electronMock.ipcMain._handlers['provider:identity-smoke']
      const trustedEvent = { senderFrame: { url: 'app://localhost/index.html' } }

      await expect(handler(trustedEvent)).resolves.toMatchObject({ code: -3 })
      identityStatus = 'authenticated'
      await expect(handler(trustedEvent)).resolves.toEqual({ code: 0, data: 'saved' })
    } finally {
      __electronMock.app.isPackaged = originalPackaged
    }
  })

  it('IPC 注册中断后只重试未完成项，全部成功后保持幂等', () => {
    mockNextWindowWithDestroy()
    context.oauthManager.registerIpcHandlers.mockImplementationOnce(() => {
      throw new Error('OAuth IPC 注册失败')
    })

    expect(() => createWindow(context)).toThrow('OAuth IPC 注册失败')
    const failedWindow = lastWindow()
    expect(failedWindow.destroy).toHaveBeenCalledTimes(1)
    expect(context.authViewManager.setMainWindow).not.toHaveBeenCalled()
    expect(context.rpaViewManager.setMainWindow).not.toHaveBeenCalled()
    expect(context.webviewManager.setMainWindow).not.toHaveBeenCalled()
    expect(context.webviewManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.qrCodeLogin.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.oauthManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.batchManager.registerIpcHandlers).not.toHaveBeenCalled()

    expect(() => createWindow(context)).not.toThrow()
    expect(context.webviewManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.qrCodeLogin.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.oauthManager.registerIpcHandlers).toHaveBeenCalledTimes(2)
    expect(context.batchManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.publishImpactTracker.registerIpcHandlers).toHaveBeenCalledTimes(1)

    createWindow(context)
    expect(context.webviewManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.qrCodeLogin.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.oauthManager.registerIpcHandlers).toHaveBeenCalledTimes(2)
    expect(context.batchManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.publishImpactTracker.registerIpcHandlers).toHaveBeenCalledTimes(1)
  })

  it('单个 IPC 注册器部分成功后抛错会回滚 channel 并可重试', () => {
    const originalHandle = __electronMock.ipcMain.handle
    const partialChannel = 'oauth:partial-registration'
    __electronMock.ipcMain.handle = vi.fn(function (channel, handler) {
      if (this._handlers[channel]) {
        throw new Error('Attempted to register a second handler for ' + channel)
      }
      this._handlers[channel] = handler
    })
    context.oauthManager.registerIpcHandlers
      .mockImplementationOnce(() => {
        __electronMock.ipcMain.handle(partialChannel, vi.fn())
        throw new Error('OAuth IPC 注册中断')
      })
      .mockImplementationOnce(() => {
        __electronMock.ipcMain.handle(partialChannel, vi.fn())
      })

    try {
      expect(() => createWindow(context)).toThrow('OAuth IPC 注册中断')
      expect(__electronMock.ipcMain._handlers[partialChannel]).toBeUndefined()

      expect(() => createWindow(context)).not.toThrow()
      expect(__electronMock.ipcMain._handlers[partialChannel]).toBeDefined()
      expect(context.oauthManager.registerIpcHandlers).toHaveBeenCalledTimes(2)
      expect(context.webviewManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
    } finally {
      __electronMock.ipcMain.handle = originalHandle
    }
  })

  it('IPC 注册器异步拒绝会销毁窗口、回滚 channel，并可重试', async () => {
    const originalHandle = __electronMock.ipcMain.handle
    const partialChannel = 'oauth:partial-async-registration'
    __electronMock.ipcMain.handle = vi.fn(function (channel, handler) {
      if (this._handlers[channel]) {
        throw new Error('Attempted to register a second handler for ' + channel)
      }
      this._handlers[channel] = handler
    })
    mockNextWindowWithDestroy()
    context.oauthManager.registerIpcHandlers
      .mockImplementationOnce(async () => {
        __electronMock.ipcMain.handle(partialChannel, vi.fn())
        await Promise.resolve()
        throw new Error('OAuth IPC 异步注册失败')
      })
      .mockImplementationOnce(() => {
        __electronMock.ipcMain.handle(partialChannel, vi.fn())
      })

    try {
      const creation = createWindow(context)
      const failedWindow = lastWindow()
      await expect(creation).rejects.toThrow('OAuth IPC 异步注册失败')
      expect(failedWindow.destroy).toHaveBeenCalledTimes(1)
      expect(context.authViewManager.setMainWindow).not.toHaveBeenCalled()
      expect(context.rpaViewManager.setMainWindow).not.toHaveBeenCalled()
      expect(context.webviewManager.setMainWindow).not.toHaveBeenCalled()
      expect(__electronMock.ipcMain._handlers[partialChannel]).toBeUndefined()

      const recoveredWindow = await createWindow(context)
      expect(recoveredWindow).toBe(lastWindow())
      expect(__electronMock.ipcMain._handlers[partialChannel]).toBeDefined()
      expect(context.oauthManager.registerIpcHandlers).toHaveBeenCalledTimes(2)
      expect(context.webviewManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
      expect(context.authViewManager.setMainWindow).toHaveBeenCalledTimes(1)
    } finally {
      __electronMock.ipcMain.handle = originalHandle
    }
  })

  it('异步 IPC 注册未完成时复用同一个窗口创建 Promise', async () => {
    let releaseRegistration
    const registrationGate = new Promise((resolve) => { releaseRegistration = resolve })
    context.oauthManager.registerIpcHandlers.mockImplementationOnce(() => registrationGate)

    const firstCreation = createWindow(context)
    const secondCreation = createWindow(context)

    expect(secondCreation).toBe(firstCreation)
    expect(__electronMock.BrowserWindow).toHaveBeenCalledTimes(1)

    releaseRegistration()
    const [firstWindow, secondWindow] = await Promise.all([firstCreation, secondCreation])
    expect(secondWindow).toBe(firstWindow)
    expect(context.oauthManager.registerIpcHandlers).toHaveBeenCalledTimes(1)
    expect(context.authViewManager.setMainWindow).toHaveBeenCalledTimes(1)
  })

  it('窗口初始化失败时清除 manager 引用并销毁窗口', () => {
    const initializationError = new Error('tray initialization failed')
    mockNextWindowWithDestroy()
    context.systemTray.init.mockImplementationOnce(function () {
      throw initializationError
    })

    expect(() => createWindow(context)).toThrow(initializationError)

    const failedWindow = lastWindow()
    expect(failedWindow.destroy).toHaveBeenCalledTimes(1)
    for (const name of [
      'authViewManager', 'rpaViewManager', 'webviewManager', 'qrCodeLogin', 'oauthManager',
    ]) {
      expect(context[name].setMainWindow).toHaveBeenLastCalledWith(null)
    }
  })

  it('调用 systemTray.init', () => {
    createWindow(context)
    expect(context.systemTray.init).toHaveBeenCalledTimes(1)
  })

  it('运行中有编排任务且托盘可用时关闭窗口隐藏到托盘（后台继续）', () => {
    context.pipelineEngine = { hasRunningOrchestration: vi.fn(() => true) }
    context.systemTray = { init: vi.fn(), isAvailable: vi.fn(() => true) }
    createWindow(context)
    const win = lastWindow()
    const hideSpy = vi.spyOn(win, 'hide')
    const event = { preventDefault: vi.fn() }
    win._handlers['close'](event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(hideSpy).toHaveBeenCalledTimes(1)
  })

  it('无运行中编排任务时关闭窗口照常进行（不拦截）', () => {
    context.pipelineEngine = { hasRunningOrchestration: vi.fn(() => false) }
    context.systemTray = { init: vi.fn(), isAvailable: vi.fn(() => true) }
    createWindow(context)
    const win = lastWindow()
    const hideSpy = vi.spyOn(win, 'hide')
    const event = { preventDefault: vi.fn() }
    win._handlers['close'](event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(hideSpy).not.toHaveBeenCalled()
  })

  it('托盘不可用时即使有运行任务也不拦截关闭（避免窗口关闭后进程无法恢复）', () => {
    context.pipelineEngine = { hasRunningOrchestration: vi.fn(() => true) }
    context.systemTray = { init: vi.fn(), isAvailable: vi.fn(() => false) }
    createWindow(context)
    const win = lastWindow()
    const hideSpy = vi.spyOn(win, 'hide')
    const event = { preventDefault: vi.fn() }
    win._handlers['close'](event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(hideSpy).not.toHaveBeenCalled()
  })

  it('macOS：运行任务 + 托盘可用也不隐藏到托盘（窗口正常关闭，进程留在 Dock）', () => {
    // 直接调用导出的决策函数注入 darwin；close 事件处理器在非 darwin 测试环境走默认策略
    const windowModule = require('./window.js')
    const shouldHide = windowModule.shouldHideToTray({
      pipelineEngine: { hasRunningOrchestration: () => true },
      systemTray: { isAvailable: () => true },
    }, 'darwin')
    expect(shouldHide).toBe(false)
  })

  it('Windows：运行任务 + 托盘可用 → 隐藏到托盘（决策函数注入 win32）', () => {
    const windowModule = require('./window.js')
    const shouldHide = windowModule.shouldHideToTray({
      pipelineEngine: { hasRunningOrchestration: () => true },
      systemTray: { isAvailable: () => true },
    }, 'win32')
    expect(shouldHide).toBe(true)
  })

  it('publish-progress-ux：仅发布任务运行中（无流水线）+ 托盘可用 → 隐藏到托盘并气泡提示', () => {
    context.pipelineEngine = { hasRunningOrchestration: vi.fn(() => false) }
    context.taskQueue = { getStatus: vi.fn(() => ({ running: [{ id: 't1' }], queue: [{ id: 't2' }] })) }
    context.systemTray = { init: vi.fn(), isAvailable: vi.fn(() => true), showBalloon: vi.fn() }
    createWindow(context)
    const win = lastWindow()
    const hideSpy = vi.spyOn(win, 'hide')
    const event = { preventDefault: vi.fn() }
    win._handlers['close'](event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(hideSpy).toHaveBeenCalledTimes(1)
    expect(context.systemTray.showBalloon).toHaveBeenCalledTimes(1)
    expect(context.systemTray.showBalloon).toHaveBeenCalledWith(
      '发布仍在后台进行',
      expect.stringContaining('请勿退出程序'),
    )
  })

  it('publish-progress-ux：发布运行中但托盘对象无 showBalloon（向后兼容）→ 仍隐藏不抛错', () => {
    context.pipelineEngine = { hasRunningOrchestration: vi.fn(() => false) }
    context.taskQueue = { getStatus: vi.fn(() => ({ running: [{ id: 't1' }], queue: [] })) }
    context.systemTray = { init: vi.fn(), isAvailable: vi.fn(() => true) }
    createWindow(context)
    const win = lastWindow()
    const hideSpy = vi.spyOn(win, 'hide')
    const event = { preventDefault: vi.fn() }
    expect(() => win._handlers['close'](event)).not.toThrow()
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(hideSpy).toHaveBeenCalledTimes(1)
  })

  it('publish-progress-ux：流水线运行 + 发布排队为空 → 隐藏但走流水线日志分支（不气泡）', () => {
    context.pipelineEngine = { hasRunningOrchestration: vi.fn(() => true) }
    context.taskQueue = { getStatus: vi.fn(() => ({ running: [], queue: [] })) }
    context.systemTray = { init: vi.fn(), isAvailable: vi.fn(() => true), showBalloon: vi.fn() }
    createWindow(context)
    const win = lastWindow()
    const event = { preventDefault: vi.fn() }
    win._handlers['close'](event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(context.systemTray.showBalloon).not.toHaveBeenCalled()
  })

  it('publish-progress-ux：taskQueue.getStatus 抛错 → 守卫按无发布任务处理（不阻塞关闭决策）', () => {
    const windowModule = require('./window.js')
    const shouldHide = windowModule.shouldHideToTray({
      pipelineEngine: { hasRunningOrchestration: () => false },
      taskQueue: { getStatus: () => { throw new Error('boom') } },
      systemTray: { isAvailable: () => true },
    }, 'win32')
    expect(shouldHide).toBe(false)
  })

  it('publish-progress-ux：context 无 taskQueue（向后兼容）→ 决策与旧口径一致', () => {
    const windowModule = require('./window.js')
    expect(windowModule.shouldHideToTray({
      pipelineEngine: { hasRunningOrchestration: () => true },
      systemTray: { isAvailable: () => true },
    }, 'win32')).toBe(true)
    expect(windowModule.shouldHideToTray({
      pipelineEngine: { hasRunningOrchestration: () => false },
      systemTray: { isAvailable: () => true },
    }, 'win32')).toBe(false)
  })

  it('调用 hotkeys.register', () => {
    createWindow(context)
    expect(context.hotkeys.register).toHaveBeenCalledTimes(1)
  })

  it('调用 autoUpdater.init', () => {
    createWindow(context)
    expect(context.autoUpdater.init).toHaveBeenCalledTimes(1)
  })

  it('调用 firstRun.runSetup', () => {
    createWindow(context)
    expect(context.firstRun.runSetup).toHaveBeenCalledTimes(1)
  })

  it('返回 mainWindow 实例', () => {
    const result = createWindow(context)
    expect(result).toBeDefined()
    expect(result).toBe(lastWindow())
  })
})
