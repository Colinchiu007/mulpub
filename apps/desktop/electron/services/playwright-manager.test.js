import { afterEach, describe, expect, it, vi } from 'vitest'

__enableElectronMock()

let playwrightManager

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  __resetElectronMock()
})

describe('playwright-manager 会话隔离', () => {
  it('按调用用途控制兼容窗口是否可见', async () => {
    const module = await import('./playwright-manager.js')
    playwrightManager = module.default || module

    const visiblePage = (await playwrightManager.getContext({ show: true })).newPage()
    const hiddenPage = (await playwrightManager.getContext({ show: false })).newPage()

    expect(visiblePage._win._opts.show).toBe(true)
    expect(hiddenPage._win._opts.show).toBe(false)
  })

  it('每个兼容上下文使用独立的非持久 session', async () => {
    const partitions = []
    __electronMock.session.fromPartition = vi.fn(partition => {
      partitions.push(partition)
      return { cookies: { get: vi.fn(), set: vi.fn() } }
    })
    const module = await import('./playwright-manager.js')
    playwrightManager = module.default || module

    const firstContext = await playwrightManager.getContext()
    const secondContext = await playwrightManager.getContext()
    const firstPage = firstContext.newPage()
    const secondPage = secondContext.newPage()

    expect(partitions).toHaveLength(2)
    expect(new Set(partitions).size).toBe(2)
    expect(partitions.every(partition => !partition.startsWith('persist:'))).toBe(true)
    expect(firstPage._win._opts.webPreferences.session).not.toBe(secondPage._win._opts.webPreferences.session)
  })

  it('提供 account:add 依赖的 evaluate、waitForFunction 和元素查询接口', async () => {
    const isolatedSession = { cookies: { get: vi.fn().mockResolvedValue([]), set: vi.fn() } }
    __electronMock.session.fromPartition = vi.fn(() => isolatedSession)
    const module = await import('./playwright-manager.js')
    playwrightManager = module.default || module
    const page = (await playwrightManager.getContext()).newPage()
    page._win.webContents.session = isolatedSession
    page._win.webContents.executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ token: 'secret' })
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('公众号账号')

    await expect(page.evaluate(() => ({ token: localStorage.getItem('token') })))
      .resolves.toEqual({ token: 'secret' })
    await expect(page.waitForFunction(
      loginHost => window.location.host !== loginHost,
      'mp.weixin.qq.com',
      { timeout: 100, polling: 1 },
    )).resolves.toBe(true)

    const element = await page.$('.weui-desktop-account__name')
    expect(element).not.toBeNull()
    await expect(element.textContent()).resolves.toBe('公众号账号')
  })

  it('把 Playwright Cookie 正确转换为 Electron Cookie 并可逆读取', async () => {
    const cookieSet = vi.fn().mockResolvedValue(undefined)
    const isolatedSession = {
      cookies: {
        set: cookieSet,
        get: vi.fn().mockResolvedValue([{
          name: 'session',
          value: 'secret',
          domain: '.mp.weixin.qq.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
          expirationDate: 1893456000,
        }]),
      },
    }
    __electronMock.session.fromPartition = vi.fn(() => isolatedSession)
    const module = await import('./playwright-manager.js')
    playwrightManager = module.default || module
    const context = await playwrightManager.getContext()
    const page = context.newPage()
    page._win.webContents.session = isolatedSession

    await page.context().addCookies([{
      name: 'session',
      value: 'secret',
      domain: '.mp.weixin.qq.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expires: 1893456000,
    }])

    expect(cookieSet).toHaveBeenCalledWith({
      url: 'https://mp.weixin.qq.com/',
      name: 'session',
      value: 'secret',
      domain: '.mp.weixin.qq.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 1893456000,
    })
    await expect(context.cookies()).resolves.toEqual([{
      name: 'session',
      value: 'secret',
      domain: '.mp.weixin.qq.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      expires: 1893456000,
    }])
  })
})

// 隐藏窗口原生渲染崩溃（2026-09-16 toutiao / 2026-10-06 wechat_mp / 2026-10-16 kuaishou）
// 现场：主进程日志在 `checkLoginStatus: start kuaishou` 后戛然而止，随后
// `crashpad_client_win.cc: not connected`，全部 electron 进程消失（应用窗口空白）。
// 既有对策是往 RENDER_CRASH_PRONE_OPEN_PLATFORMS 白名单里逐平台加（第四例 = 知乎，
// #3726），属打地鼠：名单外的平台一开隐藏窗口就再崩一次。这里改从**成因**下手 ——
// 一个永不显示的窗口不需要合成表面，且崩溃必须留下可观测证据、让调用方 fail-fast。
describe('playwright-manager 隐藏窗口不建合成表面 + 崩溃可观测', () => {
  it('隐藏上下文必须 paintWhenInitiallyHidden=false（可见上下文保持默认）', async () => {
    const module = await import('./playwright-manager.js')
    playwrightManager = module.default || module

    const hiddenPage = (await playwrightManager.getContext({ show: false })).newPage()
    const visiblePage = (await playwrightManager.getContext({ show: true })).newPage()

    expect(hiddenPage._win._opts.webPreferences.paintWhenInitiallyHidden).toBe(false)
    // 可见窗口必须保持可绘制（把它也关掉会把主界面画不出来）
    expect(visiblePage._win._opts.webPreferences.paintWhenInitiallyHidden).not.toBe(false)
  })

  it('render-process-gone 必须被接线、记录，并让后续等待 fail-fast', async () => {
    const module = await import('./playwright-manager.js')
    playwrightManager = module.default || module
    const page = (await playwrightManager.getContext({ show: false })).newPage()

    const handler = page._win.webContents._handlers['render-process-gone']
    expect(typeof handler).toBe('function')

    handler({}, { reason: 'crashed', exitCode: 133 })

    // fail-fast：不得在已死的 renderer 上继续轮询到超时（那会把崩溃伪装成「登录态不确定」）
    await expect(page.waitForSelector('.any', { timeout: 50 }))
      .rejects.toThrow(/render/i)
  })
})
