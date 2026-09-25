import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

__enableElectronMock()

let QrCodeLogin
let createdViews

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createView() {
  const handlers = {}
  const view = {
    handlers,
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    webContents: {
      session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
      loadURL: vi.fn().mockResolvedValue(undefined),
      executeJavaScript: vi.fn().mockResolvedValue({}),
      getTitle: vi.fn().mockResolvedValue('测试账号'),
      isDestroyed: vi.fn(() => false),
      close: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event, callback) => { handlers[event] = callback }),
    },
  }
  createdViews.push(view)
  return view
}

function createMainWindow() {
  return {
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    // 客户区尺寸（真实 BrowserWindow 会扣除标题栏/菜单栏/边框）
    getContentBounds: () => ({ x: 8, y: 39, width: 1184, height: 761 }),
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
}

function createManager(overrides = {}) {
  return {
    saveCapturedAccount: vi.fn().mockResolvedValue({
      id: 'account-1',
      platform: 'wechat_mp',
      name: '公众号',
    }),
    deleteAccount: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  __resetElectronMock()
  createdViews = []
  __electronMock.WebContentsView = vi.fn(function () { return createView() })
  const module = await import('./qrcode-login.js')
  QrCodeLogin = module.default || module
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('QrCodeLogin 凭证边界', () => {
  it('拒绝为非二维码平台创建扫码会话', async () => {
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    qrCodeLogin.setMainWindow(createMainWindow())

    await expect(qrCodeLogin.openLogin('youtube')).rejects.toThrow('不支持扫码登录的平台')
    expect(__electronMock.WebContentsView).not.toHaveBeenCalled()
  })

  it('登录成功后在主进程持久化，并只向渲染层发送脱敏账号信息', async () => {
    const accountManager = createManager()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    const mainWindow = createMainWindow()
    qrCodeLogin.setMainWindow(mainWindow)
    const loginPromise = qrCodeLogin.openLogin('wechat_mp', 0)
    const cookies = [{ name: 'session', value: 'secret' }]
    const localStorage = { token: 'private' }

    await qrCodeLogin._onLoginSuccess(
      { cookies, localStorage, accountName: '公众号' },
      qrCodeLogin._activeSession,
    )

    expect(accountManager.saveCapturedAccount).toHaveBeenCalledWith('wechat_mp', {
      cookies,
      localStorage,
      name: '公众号',
    })
    await expect(loginPromise).resolves.toEqual({
      platform: 'wechat_mp',
      accountId: 'account-1',
      accountName: '公众号',
    })
    const completed = mainWindow.webContents.send.mock.calls.find(([channel]) => channel === 'qrcode:completed')
    expect(completed?.[1]).toEqual({
      platform: 'wechat_mp',
      accountId: 'account-1',
      accountName: '公众号',
    })
    expect(completed?.[1]).not.toHaveProperty('cookies')
    expect(completed?.[1]).not.toHaveProperty('localStorage')
  })

  it('超时时返回明确的超时原因且只结束当前会话', async () => {
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    qrCodeLogin.setMainWindow(createMainWindow())
    const errorPromise = qrCodeLogin.openLogin('wechat_mp', 60000).catch(error => error)

    await vi.advanceTimersByTimeAsync(60000)

    await expect(errorPromise).resolves.toMatchObject({ message: expect.stringContaining('扫码登录超时') })
  })

  it('关闭发生在凭证提取期间时不保存幽灵账号', async () => {
    const extract = deferred()
    const accountManager = createManager()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    qrCodeLogin.setMainWindow(createMainWindow())
    vi.spyOn(qrCodeLogin, '_extractAuthData').mockReturnValue(extract.promise)
    const errorPromise = qrCodeLogin.openLogin('wechat_mp', 0).catch(error => error)
    createdViews[0].handlers['did-finish-load']({})
    createdViews[0].handlers['did-navigate']({}, 'https://mp.weixin.qq.com/cgi-bin/home')
    await vi.advanceTimersByTimeAsync(2000)

    qrCodeLogin.close()
    extract.resolve({ cookies: [{ name: 'session', value: 'secret' }], localStorage: {}, accountName: '公众号' })
    await Promise.resolve()
    await Promise.resolve()

    expect((await errorPromise).message).toContain('关闭')
    expect(accountManager.saveCapturedAccount).not.toHaveBeenCalled()
  })

  it('关闭发生在账号保存期间时回滚已创建账号且不发送完成事件', async () => {
    const save = deferred()
    const accountManager = createManager({ saveCapturedAccount: vi.fn(() => save.promise) })
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    const mainWindow = createMainWindow()
    qrCodeLogin.setMainWindow(mainWindow)
    vi.spyOn(qrCodeLogin, '_extractAuthData').mockResolvedValue({
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: {},
      accountName: '公众号',
    })
    const errorPromise = qrCodeLogin.openLogin('wechat_mp', 0).catch(error => error)
    createdViews[0].handlers['did-finish-load']({})
    createdViews[0].handlers['did-navigate']({}, 'https://mp.weixin.qq.com/cgi-bin/home')
    await vi.advanceTimersByTimeAsync(2000)
    expect(accountManager.saveCapturedAccount).toHaveBeenCalledTimes(1)

    qrCodeLogin.close()
    save.resolve({ id: 'ghost-account', platform: 'wechat_mp', name: '公众号' })
    await Promise.resolve()
    await Promise.resolve()

    await expect(errorPromise).resolves.toBeInstanceOf(Error)
    expect(accountManager.deleteAccount).toHaveBeenCalledWith('ghost-account')
    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('qrcode:completed', expect.anything())
  })

  it('新会话替换旧会话后，旧提取结果不能污染新平台', async () => {
    const extract = deferred()
    const accountManager = createManager()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    qrCodeLogin.setMainWindow(createMainWindow())
    vi.spyOn(qrCodeLogin, '_extractAuthData').mockReturnValueOnce(extract.promise)
    const firstError = qrCodeLogin.openLogin('wechat_mp', 0).catch(error => error)
    createdViews[0].handlers['did-finish-load']({})
    createdViews[0].handlers['did-navigate']({}, 'https://mp.weixin.qq.com/cgi-bin/home')
    await vi.advanceTimersByTimeAsync(2000)

    const secondPromise = qrCodeLogin.openLogin('zhihu', 0)
    extract.resolve({ cookies: [{ name: 'session', value: 'secret' }], localStorage: {}, accountName: '旧账号' })
    await Promise.resolve()
    await Promise.resolve()

    await expect(firstError).resolves.toBeInstanceOf(Error)
    expect(accountManager.saveCapturedAccount).not.toHaveBeenCalled()
    expect(qrCodeLogin.currentPlatform).toBe('zhihu')
    qrCodeLogin.close()
    await expect(secondPromise).rejects.toBeInstanceOf(Error)
  })

  it('重复导航命中登录成功地址时只提取和保存一次', async () => {
    const accountManager = createManager()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    qrCodeLogin.setMainWindow(createMainWindow())
    const extractAuthData = vi.spyOn(qrCodeLogin, '_extractAuthData').mockResolvedValue({
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: {},
      accountName: '公众号',
    })
    const loginPromise = qrCodeLogin.openLogin('wechat_mp', 0)
    createdViews[0].handlers['did-finish-load']({})
    const navigate = createdViews[0].handlers['did-navigate']

    navigate({}, 'https://mp.weixin.qq.com/cgi-bin/home')
    navigate({}, 'https://mp.weixin.qq.com/cgi-bin/home')
    await vi.advanceTimersByTimeAsync(2000)
    await loginPromise

    expect(extractAuthData).toHaveBeenCalledTimes(1)
    expect(accountManager.saveCapturedAccount).toHaveBeenCalledTimes(1)
  })

  it('快手扫码后的页内导航也会触发凭证提取', async () => {
    const accountManager = createManager()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    qrCodeLogin.setMainWindow(createMainWindow())
    const extractAuthData = vi.spyOn(qrCodeLogin, '_extractAuthData').mockResolvedValue({
      cookies: [{ name: 'kuaishou.web.cp.api_st', value: 'secret' }],
      localStorage: {},
      accountName: '快手账号',
    })
    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0)
    const handlers = createdViews[0].handlers
    handlers['did-finish-load']({})
    handlers['did-navigate-in-page']({}, 'https://cp.kuaishou.com/profile')
    await vi.advanceTimersByTimeAsync(2000)
    await loginPromise

    expect(extractAuthData).toHaveBeenCalledTimes(1)
    expect(accountManager.saveCapturedAccount).toHaveBeenCalledWith('kuaishou', expect.objectContaining({ name: '快手账号' }))
  })

  // 2026-09-25 回归：cp.kuaishou.com/profile 在未登录时也会被前端路由命中，
  // 且登录页就带有埋点 Cookie，因此 URL 命中 + "有 Cookie" 仍不足以入库。
  it('快手 URL 命中但 Cookie 缺会话标记时不得入库', async () => {
    const accountManager = createManager()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    qrCodeLogin.setMainWindow(createMainWindow())
    vi.spyOn(qrCodeLogin, '_extractAuthData').mockResolvedValue({
      cookies: [{ name: 'did', value: 'anon' }, { name: 'wid', value: 'anon' }],
      localStorage: {},
      accountName: '快手，记录世界 记录你',
    })
    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0).catch(error => error)
    const handlers = createdViews[0].handlers
    handlers['did-finish-load']({})
    handlers['did-navigate-in-page']({}, 'https://cp.kuaishou.com/profile')
    await vi.advanceTimersByTimeAsync(2000)

    expect(accountManager.saveCapturedAccount).not.toHaveBeenCalled()
    qrCodeLogin.close()
    expect(await loginPromise).toBeInstanceOf(Error)
  })

  it('忽略把平台成功路径放在 query 中的恶意外部 URL', async () => {
    const accountManager = createManager()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    qrCodeLogin.setMainWindow(createMainWindow())
    const extractAuthData = vi.spyOn(qrCodeLogin, '_extractAuthData').mockResolvedValue({
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: {},
      accountName: '不应保存',
    })
    const loginPromise = qrCodeLogin.openLogin('wechat_mp', 0).catch(error => error)
    createdViews[0].handlers['did-finish-load']({})
    const navigate = createdViews[0].handlers['did-navigate']

    navigate({}, 'https://evil.example/?next=https%3A%2F%2Fmp.weixin.qq.com%2Fcgi-bin%2Fhome')
    await vi.advanceTimersByTimeAsync(2500)

    expect(extractAuthData).not.toHaveBeenCalled()
    expect(accountManager.saveCapturedAccount).not.toHaveBeenCalled()
    qrCodeLogin.close()
    await expect(loginPromise).resolves.toBeInstanceOf(Error)
  })

  it('提取扫码凭证时过滤其他站点的 Cookie', async () => {
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    const view = {
      webContents: {
        session: {
          cookies: {
            get: vi.fn().mockResolvedValue([
              { name: 'valid', value: '1', domain: '.mp.weixin.qq.com' },
              { name: 'invalid', value: '2', domain: '.evil.example' },
            ]),
          },
        },
        executeJavaScript: vi.fn().mockResolvedValue({ token: '1' }),
        getTitle: vi.fn().mockResolvedValue('公众号'),
        isDestroyed: vi.fn(() => false),
      },
    }
    const session = {
      accountId: 'account-1',
      platform: 'wechat_mp',
      view,
      phase: 'extracting',
      cancelled: false,
      cleaned: false,
      settled: false,
    }
    qrCodeLogin._activeSession = session

    await expect(qrCodeLogin._extractAuthData(session)).resolves.toMatchObject({
      cookies: [{ name: 'valid', value: '1', domain: '.mp.weixin.qq.com' }],
    })
  })

  it('登录页初始加载完成前的导航不触发凭证提取（回归：登录页重定向链误判）', async () => {
    const accountManager = createManager()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    qrCodeLogin.setMainWindow(createMainWindow())
    const extractAuthData = vi.spyOn(qrCodeLogin, '_extractAuthData').mockResolvedValue({
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: {},
      accountName: '公众号',
    })
    const loginPromise = qrCodeLogin.openLogin('wechat_mp', 0)
    const handlers = createdViews[0].handlers

    // 初始加载完成前：登录页重定向链中的“成功 URL”不得触发提取
    handlers['did-navigate']({}, 'https://mp.weixin.qq.com/cgi-bin/home')
    await vi.advanceTimersByTimeAsync(2500)
    expect(extractAuthData).not.toHaveBeenCalled()
    expect(accountManager.saveCapturedAccount).not.toHaveBeenCalled()

    // 页面加载完成后：成功导航才触发提取并入库
    handlers['did-finish-load']({})
    handlers['did-navigate']({}, 'https://mp.weixin.qq.com/cgi-bin/home')
    await vi.advanceTimersByTimeAsync(2500)
    await loginPromise

    expect(extractAuthData).toHaveBeenCalledTimes(1)
    expect(accountManager.saveCapturedAccount).toHaveBeenCalledTimes(1)
  })

  it('检测快手二维码时优先接受 alt/class 等稳定 DOM 属性', async () => {
    const accountManager = createManager()
    const mainWindow = createMainWindow()
    const qrCodeLogin = new QrCodeLogin({ accountManager })
    qrCodeLogin.setMainWindow(mainWindow)
    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0).catch(error => error)
    const session = qrCodeLogin._activeSession
    createdViews[0].webContents.executeJavaScript.mockResolvedValueOnce({
      type: 'img',
      src: 'data:image/png;base64,qr-image',
      width: 125,
      height: 125,
    })

    await qrCodeLogin._detectQrCodeOnce(session)

    expect(createdViews[0].webContents.executeJavaScript.mock.calls[0][0]).toContain('img[alt*="qrcode" i]')
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('qrcode:detected', expect.objectContaining({
      platform: 'kuaishou',
      image: expect.objectContaining({ width: 125, height: 125 }),
    }))
    qrCodeLogin.close()
    await expect(loginPromise).resolves.toBeInstanceOf(Error)
  })

  it('快手登录页准备时包含失效刷新与扫码模式切换策略', async () => {
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    qrCodeLogin.setMainWindow(createMainWindow())
    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0).catch(error => error)
    const session = qrCodeLogin._activeSession

    await qrCodeLogin._prepareQrPage(session)

    const script = createdViews[0].webContents.executeJavaScript.mock.calls[0][0]
    expect(script).toContain('.qrcode-status-timeout')
    expect(script).toContain('.platform-switch')
    qrCodeLogin.close()
    await expect(loginPromise).resolves.toBeInstanceOf(Error)
  })

  it('扫码登录内嵌主窗口全屏标签（参照 AuthViewManager 内嵌模式）', async () => {
    const mainWindow = createMainWindow()
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    const onOpened = vi.fn()
    const onClosed = vi.fn()
    qrCodeLogin.onOpened = onOpened
    qrCodeLogin.onClosed = onClosed
    qrCodeLogin.setMainWindow(mainWindow)

    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0).catch(error => error)
    const view = createdViews[0]

    // 内嵌主窗口承载（先 addChildView 后 _positionView）
    expect(mainWindow.contentView.addChildView).toHaveBeenCalled()
    expect(onOpened).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'kuaishou',
      accountId: expect.stringMatching(/^auth-kuaishou-/),
      url: expect.stringContaining('kuaishou'),
    }))

    // 定位基于客户区尺寸（外框 1200x800 vs 客户区 1184x761）：
    // 若误用外框会得到 1000x724，右侧滚动条与底部内容会被窗口边框裁掉。
    expect(view.setBounds).toHaveBeenCalledWith({ x: 200, y: 76, width: 984, height: 685 })

    qrCodeLogin.hide()
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    qrCodeLogin.show()
    expect(view.setVisible).toHaveBeenLastCalledWith(true)

    qrCodeLogin.close()
    expect(onClosed).toHaveBeenCalledTimes(1)
    await expect(loginPromise).resolves.toBeInstanceOf(Error)
  })

  it('close 会清理认证视图会话（独立窗口已移除，改用内嵌模式）', async () => {
    const mainWindow = createMainWindow()
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    qrCodeLogin.setMainWindow(mainWindow)

    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0).catch(error => error)
    const view = qrCodeLogin.currentView
    expect(view).toBeTruthy()

    qrCodeLogin.close()
    expect(qrCodeLogin.currentView).toBeNull()
    expect(qrCodeLogin.currentPlatform).toBeNull()
    await expect(loginPromise).resolves.toBeInstanceOf(Error)
  })
})
