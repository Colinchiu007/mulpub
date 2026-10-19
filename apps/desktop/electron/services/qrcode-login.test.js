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

  // 2.5b 同族锁：扫码入口的拒绝路径同样要可诊断——日志只记 Cookie 名，值一律不得出现。
  it('扫码拒绝时 warn 必须带 names= 现场（且只记名字不记值）', async () => {
    const warnSpy = vi.spyOn(require('./logger'), 'warn').mockImplementation(function () {})
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    qrCodeLogin.setMainWindow(createMainWindow())
    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0)
    loginPromise.catch(() => {})
    const anon = ['did', 'wid'].map(name => ({ name, value: 'anon-value' }))
    await expect(qrCodeLogin._onLoginSuccess(
      { cookies: anon, localStorage: {}, accountName: '快手' },
      qrCodeLogin._activeSession,
    )).rejects.toThrow('未检测到登录态，请在手机上确认登录后重试')
    const missed = warnSpy.mock.calls.map(c => String(c[1])).filter(l => l.includes('no session evidence'))
    expect(missed.length).toBe(1)
    expect(missed[0]).toContain('names=did,wid')
    expect(missed[0]).not.toContain('anon-value')
    warnSpy.mockRestore()
  })

  it('扫码会话只有匿名埋点 Cookie 时必须拒绝入库（同时锁住 reject 分支的可执行性）', async () => {
    // 2026-09-27 QM-6 评审在这条 reject 分支的日志语句里抓到一个「两个模板字符串相邻、缺 +」的写法：
    // 它能过 node --check（被解析成把前一个模板当后一个的 tag 函数），却在运行时必抛 TypeError。
    // 本用例不检查日志文本，只要求该分支抛出**预期的业务错误**——日志语句一旦炸，
    // 失败信息就会变成 TypeError 而不是下面的消息，从而把这类「语法过、运行崩」钉住。
    // 选快手：它既在 QR_CODE_PLATFORMS 内（openLogin 可用），又已声明会话标记。
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    qrCodeLogin.setMainWindow(createMainWindow())
    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0)
    loginPromise.catch(() => {})
    // 名单取自仓库既有实测（2026-09-25 快手假成功：未登录访问 cp.kuaishou.com 即有这 8 个）
    const anon = ['did', 'wid', 'kwssectoken', 'kwpsecproductname', 'kwfv1', 'kwscode', '_did', 'divid']
      .map(name => ({ name, value: 'anon-value' }))
    await expect(qrCodeLogin._onLoginSuccess(
      { cookies: anon, localStorage: {}, accountName: '快手' },
      qrCodeLogin._activeSession,
    )).rejects.toThrow('未检测到登录态，请在手机上确认登录后重试')
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

  it('侧栏收起时扫码登录视图同步为 x=0 全宽（原生视图不跟 CSS 布局）', async () => {
    const mainWindow = createMainWindow()
    const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
    qrCodeLogin.setMainWindow(mainWindow)

    const loginPromise = qrCodeLogin.openLogin('kuaishou', 0).catch(error => error)
    const view = createdViews[0]

    qrCodeLogin.setSidebarCollapsed(true)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 76, width: 1184, height: 685 })

    qrCodeLogin.setSidebarCollapsed(false)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 200, y: 76, width: 984, height: 685 })

    qrCodeLogin.close()
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

  // ── 2026-09-28 非全屏登录页显示不全：zoom-to-fit 接线（login-view-fit.js）──
  // 与 AuthViewManager 同根因：扫码页固定内容宽 > 非全屏视图宽时页面被裁。
  // 接线点：did-finish-load 立即适配 + 500ms 延迟复测（会话级定时器，随 _closeSession
  // 清理）；_positionView（resize/侧栏路径）同步适配。
  describe('扫码视图宽度自适应（zoom-to-fit）接线', () => {
    it('did-finish-load 立即适配并安排 500ms 延迟复测', async () => {
      const fitModule = require('./login-view-fit')
      const fitSpy = vi.spyOn(fitModule, 'fitLoginViewZoomSafe').mockResolvedValue(undefined)
      const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
      qrCodeLogin.setMainWindow(createMainWindow())
      const pending = qrCodeLogin.openLogin('kuaishou', 0).catch(function () {})
      // openLogin 的 _positionView 在打开时已适配一次（页面未加载，探针 no-op）
      const openedCalls = fitSpy.mock.calls.length
      expect(openedCalls).toBeGreaterThanOrEqual(1)

      createdViews[0].handlers['did-finish-load']({})
      expect(fitSpy.mock.calls.length).toBe(openedCalls + 1)
      expect(fitSpy).toHaveBeenLastCalledWith(createdViews[0], expect.objectContaining({ tag: 'QrCodeLogin' }))

      await vi.advanceTimersByTimeAsync(600)
      expect(fitSpy.mock.calls.length).toBe(openedCalls + 2)

      qrCodeLogin.close()
      await pending
      fitSpy.mockRestore()
    })

    it('_closeSession 后延迟复测不再触发（会话定时器随关闭清理）', async () => {
      const fitModule = require('./login-view-fit')
      const fitSpy = vi.spyOn(fitModule, 'fitLoginViewZoomSafe').mockResolvedValue(undefined)
      const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
      qrCodeLogin.setMainWindow(createMainWindow())
      const pending = qrCodeLogin.openLogin('kuaishou', 0).catch(function () {})
      const openedCalls = fitSpy.mock.calls.length

      createdViews[0].handlers['did-finish-load']({})
      expect(fitSpy.mock.calls.length).toBe(openedCalls + 1)

      qrCodeLogin.close()
      await pending
      await vi.advanceTimersByTimeAsync(600)
      // 复测定时器已随会话清理：计数不再增长
      expect(fitSpy.mock.calls.length).toBe(openedCalls + 1)

      fitSpy.mockRestore()
    })

    it('_positionView（resize / 侧栏宽度路径）同步触发适配', async () => {
      const fitModule = require('./login-view-fit')
      const fitSpy = vi.spyOn(fitModule, 'fitLoginViewZoomSafe').mockResolvedValue(undefined)
      const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
      qrCodeLogin.setMainWindow(createMainWindow())
      const pending = qrCodeLogin.openLogin('kuaishou', 0).catch(function () {})
      const before = fitSpy.mock.calls.length

      qrCodeLogin._onWindowResize()
      expect(fitSpy.mock.calls.length).toBeGreaterThan(before)

      qrCodeLogin.close()
      await pending
      fitSpy.mockRestore()
    })
  })
})

describe('QrCodeLogin ↔ 分区回收存活登记（#2701 评审 C1）', () => {
  it('扫码会话的目录即使不是字典序末位，也必须因为在登记表里而不被删（真目录端到端）', () => {
    const fs = require('fs')
    const os = require('os')
    const nodePath = require('path')
    // 必须用 CJS require 取登记表：qrcode-login 内部是 require('./auth-partition-reclaim')，
    // import() 拿到的是另一份模块实例，跨实例断言必然假失败（本仓踩过两次）。
    const reclaim = require('./auth-partition-reclaim.js')

    const base = fs.mkdtempSync(nodePath.join(os.tmpdir(), `mp-qrcode-reclaim-${process.pid}-`))
    try {
      const qrCodeLogin = new QrCodeLogin({ accountManager: createManager() })
      qrCodeLogin.setMainWindow(createMainWindow())
      const loginPromise = qrCodeLogin.openLogin('wechat_mp', 0)
      loginPromise.catch(function () { /* 本例不关心登录结果 */ })

      const accountId = qrCodeLogin.currentAccountId
      expect(accountId).toMatch(/^auth-wechat_mp-\d+-\d+$/)
      const dir = reclaim.partitionNameOf(accountId)
      // 前提：这个目录名确实命中回收白名单 —— 不命中就没必要登记，这条锁就在测空气
      expect(reclaim.isThrowawayPartitionName(dir)).toBe(true)
      expect(reclaim.livePartitionNames()).toContain(dir)

      // mock 的 fromPartition 不落盘，按真实形态把同组目录铺出来。
      // #2734 起回收端保留「最近 PROBE_LIMIT 份」，只铺两份会双双落在窗口内 —— 那时「没删」
      // 只是因为窗口宽，测不到存活登记表本身。故铺到窗口之外：K 份更新的同组目录把 dir 挤出窗口，
      // dir 仍然活着**只能**是因为它在登记表里（K 也是下面反向对照要用的同一个常量）。
      const K = reclaim.PROBE_LIMIT
      const newerDirs = []
      for (let i = 0; i < K; i += 1) newerDirs.push('auth-auth-wechat_mp-99999999999' + i)
      const root = nodePath.join(base, 'session', 'Partitions')
      fs.mkdirSync(root, { recursive: true })
      fs.mkdirSync(nodePath.join(root, dir), { recursive: true })
      for (const n of newerDirs) fs.mkdirSync(nodePath.join(root, n), { recursive: true })

      const summary = reclaim.reclaimStaleAuthPartitions({ userDataPath: base })
      expect(summary.removed).toEqual([])
      expect(fs.existsSync(nodePath.join(root, dir))).toBe(true)
      expect(fs.existsSync(nodePath.join(root, newerDirs[K - 1]))).toBe(true)

      // 反向对照：把登记摘掉（等价 C1 修复前的实现），同一条判据必须真的把它删掉。
      // 没有这一格，上面两个断言可能只是因为「谁都删不动」而通过。
      // #2734 起窗口是「保留最近 PROBE_LIMIT 份」而不是「只留末位」：摘掉登记后（planReclaim 不读进程内
      // 登记表，正是「等价 C1 修复前」那一格），dir 落在 K 份更新目录之后 ⇒ 必须是 victims。
      const plan = reclaim.planReclaim([dir].concat(newerDirs))
      // 精确断言而非 toContain：组内共 K+1 份、窗口宽度恰为 K ⇒ victims 有且只有被挤出窗口的 dir。
      // （本条最初写成 toContain(newerDirs[0]) 是我把窗口宽度算错了 —— K=5 时 n0 仍在窗口内，
      //  跑出来当场变红才发现。写成 toEqual 之后，窗口宽度再被人改动会立刻暴露，而不是静默偏移。）
      expect(plan.victims).toEqual([dir])
      expect(plan.kept).toEqual(newerDirs.slice().sort())
    } finally {
      try { fs.rmSync(base, { recursive: true, force: true }) } catch (_e) { /* 临时目录清不掉不影响结论 */ }
    }
  })
})
