import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * 外部协议守卫单测。
 *
 * 注意：本仓主进程代码用 CJS `require()` 加载依赖，`vi.mock` 只在 vitest SSR 转换层生效，
 * 对 CJS require 无效（见 test-setup.js 顶部说明）——所以 logger mock 走 `__registerMock`。
 */
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), notify: vi.fn() }
__registerMock('./logger', mockLogger)

let isAllowedNavigationUrl
let attachExternalProtocolGuard

beforeEach(async () => {
  vi.resetModules()
  mockLogger.notify.mockClear()
  const mod = await import('./external-protocol-guard.js')
  isAllowedNavigationUrl = mod.isAllowedNavigationUrl
  attachExternalProtocolGuard = mod.attachExternalProtocolGuard
})

/** 造一个可记录 handler 的假 webContents（Electron 真身同名方法） */
function createWebContents ({ withWindowOpen = true, withNavigate = true } = {}) {
  const handlers = {}
  const wc = {
    handlers,
    on: vi.fn(function (channel, handler) {
      handlers[channel] = handler
      return this
    }),
  }
  if (withWindowOpen) {
    wc.setWindowOpenHandler = vi.fn(function (handler) {
      handlers.windowOpen = handler
      return this
    })
  }
  if (!withNavigate) delete wc.on
  return wc
}

describe('isAllowedNavigationUrl — 导航面判据', () => {
  it.each([
    'https://creator.douyin.com/',
    'http://127.0.0.1:5174/#/accounts',
    'HTTPS://EXAMPLE.COM/',
  ])('放行 http(s)：%s', (url) => {
    expect(isAllowedNavigationUrl(url)).toBe(true)
  })

  it.each([
    ['bitbrowser://cc/', '未注册的外部协议（本机现场取证到的那个）'],
    ['snssdk1128://', '另一类外部协议'],
    ['javascript:alert(1)', '脚本协议'],
    ['data:text/html,<script>alert(1)</script>', 'data 协议'],
    ['file:///C:/Windows/System32/drivers/etc/hosts', '本地文件协议'],
    ['about:blank', 'about 协议'],
    ['not a url', '根本不是 URL'],
    ['', '空串'],
  ])('拒绝 %s（%s）', (url) => {
    expect(isAllowedNavigationUrl(url)).toBe(false)
  })

  it.each([
    ['https://user:secret@example.com/', '用户名+密码'],
    ['https://user@example.com/', '仅用户名'],
  ])('拒绝带 userinfo 的 URL：%s（%s）', (url) => {
    expect(isAllowedNavigationUrl(url)).toBe(false)
  })

  it.each([null, undefined, 123, {}, []])('拒绝非字符串入参：%s', (value) => {
    expect(isAllowedNavigationUrl(value)).toBe(false)
  })
})

describe('attachExternalProtocolGuard — 守卫行为', () => {
  it('装上 window-open 与 will-navigate 两道守卫', () => {
    const wc = createWebContents()
    const result = attachExternalProtocolGuard(wc, { tag: 'auth-view' })

    expect(result.installed).toBe(true)
    expect(wc.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    expect(wc.on).toHaveBeenCalledWith('will-navigate', expect.any(Function))
  })

  it('http(s) 的新窗口请求放行（保持与守卫接入前一致的新开窗行为）', () => {
    const wc = createWebContents()
    attachExternalProtocolGuard(wc, { tag: 'auth-view' })

    expect(wc.handlers.windowOpen({ url: 'https://creator.douyin.com/' })).toEqual({ action: 'allow' })
    expect(mockLogger.notify).not.toHaveBeenCalled()
  })

  it('自定义协议的新窗口请求被拒并记 WARN（source=window-open）', () => {
    const wc = createWebContents()
    attachExternalProtocolGuard(wc, { tag: 'auth-view' })

    expect(wc.handlers.windowOpen({ url: 'bitbrowser://cc/' })).toEqual({ action: 'deny' })
    expect(mockLogger.notify).toHaveBeenCalledWith(
      'ExternalProtocolGuard',
      'external-protocol-blocked',
      expect.objectContaining({
        level: 'WARN',
        params: expect.objectContaining({ tag: 'auth-view', source: 'window-open' }),
      }),
    )
  })

  it('主框架导航到自定义协议时被阻止（source=navigation）', () => {
    const wc = createWebContents()
    attachExternalProtocolGuard(wc, { tag: 'qrcode-login' })
    const event = { preventDefault: vi.fn() }

    wc.handlers['will-navigate'](event, 'bitbrowser://cc/')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(mockLogger.notify).toHaveBeenCalledWith(
      'ExternalProtocolGuard',
      'external-protocol-blocked',
      expect.objectContaining({
        level: 'WARN',
        params: expect.objectContaining({ tag: 'qrcode-login', source: 'navigation' }),
      }),
    )
  })

  it('http(s) 导航放行（登录重定向链不能被拦）', () => {
    const wc = createWebContents()
    attachExternalProtocolGuard(wc, { tag: 'auth-view' })
    const event = { preventDefault: vi.fn() }

    wc.handlers['will-navigate'](event, 'https://creator.douyin.com/')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mockLogger.notify).not.toHaveBeenCalled()
  })

  it('目标对象不支持 setWindowOpenHandler 时静默跳过，不抛错', () => {
    const wc = createWebContents({ withWindowOpen: false })
    let result = null
    expect(() => { result = attachExternalProtocolGuard(wc, { tag: 'rpa-view' }) }).not.toThrow()
    expect(result.installed).toBe(false)
  })

  it('目标对象缺 on() 时仍装上 window-open 守卫', () => {
    const wc = { setWindowOpenHandler: vi.fn() }
    const result = attachExternalProtocolGuard(wc, { tag: 'silent-auth' })

    expect(result.installed).toBe(true)
    expect(wc.setWindowOpenHandler).toHaveBeenCalledTimes(1)
  })

  it('入参不是对象时返回未安装且不抛错', () => {
    expect(attachExternalProtocolGuard(null, { tag: 'x' }).installed).toBe(false)
    expect(attachExternalProtocolGuard(undefined, { tag: 'x' }).installed).toBe(false)
  })

  // CCG 外部评审 i1（Critical）：重复对同一个 webContents 装守卫会叠加 will-navigate
  // 监听器 ⇒ 一次拦截写两遍日志。这里把"重复安装"变成机制上不可能，而不是靠调用纪律。
  it('同一 webContents 重复安装不会叠加监听器（幂等）', () => {
    const wc = createWebContents()
    const first = attachExternalProtocolGuard(wc, { tag: 'auth-view' })
    const second = attachExternalProtocolGuard(wc, { tag: 'auth-view' })

    expect(wc.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    expect(wc.on).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('幂等安装后拦截仍只记一次日志', () => {
    const wc = createWebContents()
    attachExternalProtocolGuard(wc, { tag: 'auth-view' })
    attachExternalProtocolGuard(wc, { tag: 'auth-view' })

    wc.handlers.windowOpen({ url: 'bitbrowser://cc/' })

    expect(mockLogger.notify).toHaveBeenCalledTimes(1)
  })
})

describe('登录视图接线 — 行为级（账号登录视图 = 本次事故现场那条路径）', () => {
  let createAuthView

  beforeEach(async () => {
    __enableElectronMock()
    vi.resetModules()
    const mod = await import('./auth-view-session.js')
    createAuthView = mod.createAuthView
  })

  it('账号登录视图造出来后即装有守卫：自定义协议被拒、http(s) 放行', () => {
    const view = createAuthView('auth-test', 'preload.js', {})
    const handler = view.webContents._windowOpenHandler

    expect(typeof handler).toBe('function')
    expect(handler({ url: 'bitbrowser://cc/' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'https://creator.douyin.com/' })).toEqual({ action: 'allow' })
  })
})
