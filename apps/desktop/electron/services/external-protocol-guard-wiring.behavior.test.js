import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 外部协议守卫 —— **接线行为级**验证（CCG 外部评审 i2）。
 *
 * 背景：`external-protocol-guard-wiring.contract.test.js` 是**源码锁**（"这处源码里
 * 调了统一守卫、且带可区分 tag"）。源码锁证明不了"守卫真装在了那个视图上"——
 * 写成 `attachExternalProtocolGuard(view.webContents, …)` 但传错了对象，源码锁照样绿。
 * 本文件把四个接线点**真跑一遍**，取出真实创建的视图/窗口，直接驱动它的守卫：
 *   ① 账号登录视图 → auth-view-session.test 侧（external-protocol-guard.test.js 已覆盖）
 *   ② 扫码登录视图 → qrcode-login.openLogin
 *   ③ OAuth 授权视图 → oauth-manager.startAuth
 *   ④ RPA 自动化窗口 → rpa-view-session._createWindow
 *   ⑤ 静默登录窗口 → auth-view-manager.loginSilent
 *
 * 断言口径一致：自定义协议被拒、http(s) 放行。
 */

__enableElectronMock()

const CUSTOM_PROTOCOL_URL = 'bitbrowser://cc/'
const HTTP_URL = 'https://creator.douyin.com/'

/** 造一个会记录 handler 的 webContents（两种记录位：windowOpen / 事件名） */
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

/** 断言：守卫装上了，且自定义协议被拒、http(s) 放行 */
function assertGuardWorks (webContents, label) {
  // 三种记录位都要认：测试自建 view 用 `handlers`、electron mock 的 BrowserWindow 用 `_handlers`、
  // electron mock 的 WebContentsView 用 `_windowOpenHandler`。
  const handlers = webContents.handlers || webContents._handlers || {}
  const winOpen = handlers.windowOpen || webContents._windowOpenHandler
  const navigate = handlers['will-navigate']
  expect(typeof winOpen === 'function' || typeof navigate === 'function', `${label}: 守卫未装`).toBe(true)

  if (typeof winOpen === 'function') {
    expect(winOpen({ url: CUSTOM_PROTOCOL_URL }), `${label}: 自定义协议未被拒`).toEqual({ action: 'deny' })
    expect(winOpen({ url: HTTP_URL }), `${label}: http(s) 被误拒`).toEqual({ action: 'allow' })
  }
  if (typeof navigate === 'function') {
    const blocked = { preventDefault: vi.fn() }
    navigate(blocked, CUSTOM_PROTOCOL_URL)
    expect(blocked.preventDefault, `${label}: 自定义协议导航未被拦`).toHaveBeenCalled()

    const allowed = { preventDefault: vi.fn() }
    navigate(allowed, HTTP_URL)
    expect(allowed.preventDefault, `${label}: http(s) 导航被误拦`).not.toHaveBeenCalled()
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

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  __resetElectronMock()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('外部协议守卫接线（行为级）', () => {
  it('扫码登录视图：openLogin 建出的视图装着守卫', async () => {
    const created = []
    __electronMock.WebContentsView = vi.fn(function () {
      const view = {
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        webContents: createWebContents(),
      }
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
    assertGuardWorks(created[0].webContents, 'qrcode-login')
  })

  it('OAuth 授权视图：startAuth 建出的视图装着守卫', async () => {
    const created = []
    __electronMock.WebContentsView = vi.fn(function () {
      const view = {
        setBounds: vi.fn(),
        setVisible: vi.fn(),
        webContents: createWebContents(),
      }
      created.push(view)
      return view
    })
    const OAuthManager = require('./oauth-manager')
    const manager = new OAuthManager({})
    manager.mainWindow = createMainWindow()
    // 不起真实 HTTP 回调服务（本用例只关心视图上是否装了守卫）
    manager._startCallbackServer = vi.fn()

    const pending = manager.startAuth('douyin', {}, 0)
    pending.catch(() => {})

    expect(created.length).toBe(1)
    assertGuardWorks(created[0].webContents, 'oauth')
  })

  it('RPA 自动化窗口：_createWindow 建出的窗口装着守卫', async () => {
    const sessionMixin = require('./rpa-view-session')
    const win = sessionMixin._createWindow.call(
      { _resolvePreloadPath: () => 'preload.js' },
      'persist:rpa-guard-test',
      'douyin',
    )

    assertGuardWorks(win.webContents, 'rpa-view')
  })

  it('静默登录窗口：loginSilent 建出的隐藏窗口装着守卫', async () => {
    const electron = require('electron')
    const AuthViewManager = require('./auth-view-manager')
    const manager = new AuthViewManager()
    const before = electron.BrowserWindow.mock.calls.length

    const pending = manager.loginSilent('wechat_mp', [], {}, {})
    pending.catch(() => {})

    const calls = electron.BrowserWindow.mock.calls
    expect(calls.length).toBeGreaterThan(before)
    const win = electron.BrowserWindow._instances[calls.length - 1]
    assertGuardWorks(win.webContents, 'silent-auth')
  })
})
