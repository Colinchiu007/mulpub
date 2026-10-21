import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 外部协议守卫接线 —— **反向（变异）用例**。
 *
 * 为什么需要它：CCG 外部复核（claude，PR #4163 评论）对 i2 指出"行为级断言可能假绿"：
 * 正向断言只证明"有 handler 且行为正确"，不证明"**没有**接线时断言会红"。
 * 本文件把守卫模块整体替换成**空实现**（`__registerMock` 覆盖 CJS require），
 * 再驱动同样的四个接线点，断言它们的视图/窗口**上确实没有守卫** ——
 * 于是 `external-protocol-guard-wiring.behavior.test.js` 的正向断言就被证明是**敏感的**
 * （接线一旦被摘掉，那边必红），不是恒真断言。
 *
 * 判据取产物：这里断言的是"守卫不在"，不是"守卫在"。
 */

__enableElectronMock()

// 变异：把守卫模块替换成空实现（接线照旧调用它，但什么也不装）
__registerMock('./external-protocol-guard', {
  isAllowedNavigationUrl: () => true,
  attachExternalProtocolGuard: () => ({ installed: false, navigationInstalled: false, blockedWindowOpen: 0, blockedNavigation: 0 }),
})

function createWebContents () {
  const handlers = {}
  return {
    handlers,
    setWindowOpenHandler: vi.fn(function (fn) { handlers.windowOpen = fn; return this }),
    on: vi.fn(function (evt, fn) { handlers[evt] = fn; return this }),
    loadURL: vi.fn().mockResolvedValue(undefined),
    executeJavaScript: vi.fn().mockResolvedValue({}),
    isDestroyed: vi.fn(() => false),
    close: vi.fn(),
    destroy: vi.fn(),
    session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
  }
}

function createMainWindow () {
  return {
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    getContentBounds: () => ({ x: 8, y: 39, width: 1184, height: 761 }),
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
}

/** 断言"守卫不在"：三种记录位都取不到守卫的 handler */
function assertNoGuard (webContents, label) {
  const handlers = webContents.handlers || webContents._handlers || {}
  const winOpen = handlers.windowOpen || webContents._windowOpenHandler
  const navigate = handlers['will-navigate']
  expect(typeof winOpen, `${label}: 变异下仍装有 window-open 守卫`).not.toBe('function')
  expect(typeof navigate, `${label}: 变异下仍装有 will-navigate 守卫`).not.toBe('function')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  __resetElectronMock()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('外部协议守卫接线 — 变异（守卫被替换为空实现）', () => {
  it('扫码登录视图：变异后视图上确实没有守卫', async () => {
    const created = []
    __electronMock.WebContentsView = vi.fn(function () {
      const view = { setBounds: vi.fn(), setVisible: vi.fn(), webContents: createWebContents() }
      created.push(view)
      return view
    })
    const QrCodeLogin = require('./qrcode-login')
    const qr = new QrCodeLogin({
      accountManager: {
        saveCapturedAccount: vi.fn().mockResolvedValue({ id: 'a1' }),
        deleteAccount: vi.fn().mockResolvedValue(true),
      },
    })
    qr.setMainWindow(createMainWindow())

    const pending = qr.openLogin('kuaishou', 0)
    pending.catch(() => {})

    expect(created.length).toBe(1)
    assertNoGuard(created[0].webContents, 'qrcode-login')
  })

  it('OAuth 授权视图：变异后视图上确实没有守卫', async () => {
    const created = []
    __electronMock.WebContentsView = vi.fn(function () {
      const view = { setBounds: vi.fn(), setVisible: vi.fn(), webContents: createWebContents() }
      created.push(view)
      return view
    })
    const OAuthManager = require('./oauth-manager')
    const manager = new OAuthManager({})
    manager.mainWindow = createMainWindow()
    manager._startCallbackServer = vi.fn()

    const pending = manager.startAuth('douyin', {}, 0)
    pending.catch(() => {})

    expect(created.length).toBe(1)
    assertNoGuard(created[0].webContents, 'oauth')
  })

  it('RPA 自动化窗口：变异后窗口上确实没有守卫', async () => {
    const sessionMixin = require('./rpa-view-session')
    const win = sessionMixin._createWindow.call(
      { _resolvePreloadPath: () => 'preload.js' },
      'persist:rpa-guard-negative',
      'douyin',
    )

    assertNoGuard(win.webContents, 'rpa-view')
  })

  it('静默登录窗口：变异后窗口上确实没有守卫', async () => {
    const electron = require('electron')
    const AuthViewManager = require('./auth-view-manager')
    const manager = new AuthViewManager()
    const before = electron.BrowserWindow.mock.calls.length

    const pending = manager.loginSilent('wechat_mp', [], {}, {})
    pending.catch(() => {})

    const calls = electron.BrowserWindow.mock.calls
    expect(calls.length).toBeGreaterThan(before)
    const win = electron.BrowserWindow._instances[calls.length - 1]
    assertNoGuard(win.webContents, 'silent-auth')
  })
})
