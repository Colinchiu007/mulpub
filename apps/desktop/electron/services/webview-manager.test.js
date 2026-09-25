// @ts-check
/**
 * WebviewManager 虚拟登录标签测试（对齐参考产品全屏登录体验）
 *
 * 场景：账号管理-添加账号-选择平台-打开登录页 → 登录视图以全屏标签
 * 形式呈现在 TabBar 中（而非弹窗），关闭后回退到之前的标签。
 */
const { getPlatformName } = require('@multi-publish/shared-utils/src/platform-definitions')

__enableElectronMock()

let WebviewManager, AUTH_TAB_ID
const credentialLoadMock = vi.fn(() => null)

beforeEach(async () => {
  vi.resetModules()
  __resetElectronMock()
  __registerMock('./logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  __registerMock('./credential-store', { loadCredential: credentialLoadMock })
  patchViewAndSessionMocks()
  const mod = await import('./webview-manager.js')
  WebviewManager = mod.default || mod
  AUTH_TAB_ID = mod.AUTH_TAB_ID
})

afterEach(() => {
  vi.restoreAllMocks()
})

function createMainWindow () {
  return {
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    // 客户区尺寸（真实 BrowserWindow 会扣除标题栏/菜单栏/边框）
    getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }
  }
}

function createBrowserView () {
  return {
    setVisible: vi.fn(),
    setBounds: vi.fn(),
    webContents: { close: vi.fn() }
  }
}

function createManagerWithBrowserTab () {
  const wm = new WebviewManager()
  wm.mainWindow = createMainWindow()
  wm._subscribers.add('test-subscriber')
  const view = createBrowserView()
  wm._tabViews.set('btab-1', view)
  wm._tabStates.set('btab-1', {
    url: 'https://creator.douyin.com/',
    title: '抖音创作者中心',
    loading: false,
    canGoBack: false,
    canGoForward: false
  })
  wm._activeTabId = 'btab-1'
  wm._homeTabId = 'home'
  return { wm, view }
}

function createFakeAuthViewManager () {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    onOpened: null,
    onClosed: null,
    _onWindowResize: vi.fn()
  }
}

function createFakeQrCodeLogin () {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    onOpened: null,
    onClosed: null,
    _onWindowResize: vi.fn()
  }
}

describe('内嵌标签页布局（回归：必须用客户区尺寸，外框尺寸会裁掉滚动条与底部内容）', () => {
  it('浏览器标签 setBounds 基于客户区尺寸（2026-09-13 账号管理打开平台网页 Bug 回归点）', () => {
    const { wm, view } = createManagerWithBrowserTab()
    wm.resize()
    // 外框 1440x900 vs 客户区 1424x861：若误用外框会得到 {width:1240, height:824}，
    // 视图比可见区域宽出左右边框、高出标题栏+底边框 → 网页垂直滚动条（渲染在视图
    // 右边缘）与底部内容落在窗口之外被裁掉，且页面已按外框视口布局、无法滚动补救。
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 200, y: 76, width: 1224, height: 785 })
  })
})

describe('setSidebarWidth 守卫（回归 2026-09-15：宽度=0 不能让内嵌视图盖住侧边栏）', () => {
  it('合法宽度（68 / 200）被接受并更新 _sidebarWidth', () => {
    const { wm } = createManagerWithBrowserTab()
    wm.setSidebarWidth(68)
    expect(wm._sidebarWidth).toBe(68)
    wm.setSidebarWidth(200)
    expect(wm._sidebarWidth).toBe(200)
  })

  it('宽度=0 被拒绝，_sidebarWidth 保持上一个合法值，视图不以 x=0 重排', () => {
    const { wm, view } = createManagerWithBrowserTab()
    wm.setSidebarWidth(68)
    wm.setSidebarWidth(0)
    expect(wm._sidebarWidth).toBe(68)
    const calls = view.setBounds.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    // 所有重排调用的 x 都不为 0（不覆盖 x=0 的侧边栏）
    calls.forEach((c) => expect(c[0].x).not.toBe(0))
    // 最近一次重排仍以合法侧栏宽 68 定位
    expect(calls[calls.length - 1][0].x).toBe(68)
  })

  it('负宽度被拒绝，_sidebarWidth 保持上一个合法值', () => {
    const { wm } = createManagerWithBrowserTab()
    wm.setSidebarWidth(68)
    wm.setSidebarWidth(-5)
    expect(wm._sidebarWidth).toBe(68)
  })

  it('超出上限 600 的宽度被拒绝', () => {
    const { wm } = createManagerWithBrowserTab()
    wm.setSidebarWidth(68)
    wm.setSidebarWidth(700)
    expect(wm._sidebarWidth).toBe(68)
  })
})

describe('WebviewManager 虚拟登录标签', () => {
  it('attachAuthViewManager 绑定开关钩子', () => {
    const wm = new WebviewManager()
    const auth = createFakeAuthViewManager()

    wm.attachAuthViewManager(auth)

    expect(typeof auth.onOpened).toBe('function')
    expect(typeof auth.onClosed).toBe('function')
  })

  it('登录视图打开 → 注入虚拟登录标签并广播 tab-created/tab-switched', () => {
    const { wm, view } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)

    auth.onOpened({ platform: 'douyin', accountId: null, url: 'https://creator.douyin.com/' })

    // 浏览器标签被隐藏
    expect(view.setVisible).toHaveBeenCalledWith(false)
    // 活动标签切换为登录标签
    expect(wm._activeTabId).toBe(AUTH_TAB_ID)
    // 广播事件
    const sends = wm.mainWindow.webContents.send.mock.calls.map(c => c[0])
    expect(sends).toContain('page-manager:tab-created')
    expect(sends).toContain('page-manager:tab-switched')
    const switched = wm.mainWindow.webContents.send.mock.calls.find(c => c[0] === 'page-manager:tab-switched')
    expect(switched[1].data).toMatchObject({
      tabId: AUTH_TAB_ID,
      url: 'https://creator.douyin.com/',
      title: getPlatformName('douyin') + '登录',
      isLogin: true
    })
  })

  it('getAllTabs/getActiveTab 包含登录标签（isLogin:true）', () => {
    const { wm } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)

    auth.onOpened({ platform: 'douyin', accountId: null, url: 'https://creator.douyin.com/' })

    const all = wm.getAllTabs()
    const loginTab = all.find(t => t.tabId === AUTH_TAB_ID)
    expect(loginTab).toMatchObject({
      isLogin: true,
      isActive: true,
      isHome: false,
      title: getPlatformName('douyin') + '登录'
    })

    const active = wm.getActiveTab()
    expect(active.tabId).toBe(AUTH_TAB_ID)
    expect(active.isLogin).toBe(true)
  })

  it('登录视图关闭 → 移除登录标签并回退到之前的浏览器标签', () => {
    const { wm, view } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)

    auth.onOpened({ platform: 'douyin', accountId: null, url: 'https://creator.douyin.com/' })
    wm.mainWindow.webContents.send.mockClear()
    auth.onClosed()

    expect(wm._authTabInfo).toBeNull()
    expect(wm.getAllTabs().find(t => t.tabId === AUTH_TAB_ID)).toBeUndefined()
    // 回退到之前的浏览器标签并重新显示
    expect(wm._activeTabId).toBe('btab-1')
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    const sends = wm.mainWindow.webContents.send.mock.calls.map(c => c[0])
    expect(sends).toContain('page-manager:tab-closed')
    expect(sends).toContain('page-manager:tab-switched')
  })

  it('登录视图关闭且无之前标签 → 回退到首页（不广播 tab-switched）', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm._homeTabId = 'home'
    wm._activeTabId = 'home'
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)

    auth.onOpened({ platform: 'douyin', accountId: null, url: 'https://creator.douyin.com/' })
    auth.onClosed()

    // 新行为：回退首页时不广播 tab-switched，仅内部重置 activeTabId
    expect(wm._activeTabId).toBe('home')
    const switched = wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-switched')
      .pop()
    // 最后一处 tab-switched 是登录打开时的广播，不是回退时的
    expect(switched[1].data.isLogin).toBe(true)
  })

  it('switchToTab(登录标签) 显示登录视图并隐藏浏览器标签', () => {
    const { wm, view } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)
    auth.onOpened({ platform: 'douyin', accountId: null, url: 'https://creator.douyin.com/' })

    // 先切到浏览器标签（登录视图应被隐藏）
    wm.switchToTab('btab-1')
    expect(auth.hide).toHaveBeenCalled()
    expect(wm._activeTabId).toBe('btab-1')

    // 再切回登录标签
    const result = wm.switchToTab(AUTH_TAB_ID)
    expect(result).toBe(true)
    expect(auth.show).toHaveBeenCalled()
    expect(view.setVisible).toHaveBeenLastCalledWith(false)
    expect(wm._activeTabId).toBe(AUTH_TAB_ID)
  })

  it('登录标签不存在时 switchToTab(AUTH_TAB_ID) 返回 false', () => {
    const { wm } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)

    expect(wm.switchToTab(AUTH_TAB_ID)).toBe(false)
    expect(auth.show).not.toHaveBeenCalled()
  })

  it('closeTab(登录标签) 委托 authViewManager.close() 结束登录会话', () => {
    const { wm } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)
    auth.onOpened({ platform: 'douyin', accountId: null, url: 'https://creator.douyin.com/' })

    const result = wm.closeTab(AUTH_TAB_ID)
    expect(result).toBe(true)
    expect(auth.close).toHaveBeenCalledTimes(1)
  })

  it('切换到首页时隐藏登录视图', () => {
    const { wm } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)
    auth.onOpened({ platform: 'douyin', accountId: null, url: 'https://creator.douyin.com/' })

    wm.switchToTab('home')
    expect(auth.hide).toHaveBeenCalled()
    expect(wm._activeTabId).toBe('home')
  })

  it('登录标签活动态下 resize 由 AuthViewManager 重新定位', () => {
    const { wm } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    wm.attachAuthViewManager(auth)
    auth.onOpened({ platform: 'douyin', accountId: null, url: 'https://creator.douyin.com/' })

    wm.resize()
    expect(auth._onWindowResize).toHaveBeenCalled()
  })

  it('未挂载 AuthViewManager 时登录标签相关操作安全降级', () => {
    const { wm } = createManagerWithBrowserTab()

    expect(wm.switchToTab(AUTH_TAB_ID)).toBe(false)
    expect(wm.closeTab(AUTH_TAB_ID)).toBe(false)
    expect(() => wm.resize()).not.toThrow()
    expect(wm.getAllTabs().find(t => t.tabId === AUTH_TAB_ID)).toBeUndefined()
  })

  it('二维码登录接入同一个虚拟登录标签，打开时隐藏现有创作者中心', () => {
    const { wm, view } = createManagerWithBrowserTab()
    const qrCodeLogin = createFakeQrCodeLogin()
    wm.attachQrCodeLogin(qrCodeLogin)

    qrCodeLogin.onOpened({
      platform: 'kuaishou',
      accountId: 'auth-kuaishou-1',
      url: 'https://passport.kuaishou.com/',
    })

    expect(view.setVisible).toHaveBeenCalledWith(false)
    expect(wm._activeTabId).toBe(AUTH_TAB_ID)
    expect(wm.getActiveTab()).toMatchObject({
      tabId: AUTH_TAB_ID,
      isLogin: true,
      title: getPlatformName('kuaishou') + '登录',
    })
  })

  it('二维码登录关闭后恢复原标签；切换和关闭只操作二维码视图', () => {
    const { wm, view } = createManagerWithBrowserTab()
    const auth = createFakeAuthViewManager()
    const qrCodeLogin = createFakeQrCodeLogin()
    wm.attachAuthViewManager(auth)
    wm.attachQrCodeLogin(qrCodeLogin)
    qrCodeLogin.onOpened({
      platform: 'kuaishou',
      accountId: 'auth-kuaishou-1',
      url: 'https://passport.kuaishou.com/',
    })

    expect(wm.closeTab(AUTH_TAB_ID)).toBe(true)
    expect(qrCodeLogin.close).toHaveBeenCalledTimes(1)
    expect(auth.close).not.toHaveBeenCalled()

    wm.switchToTab('btab-1')
    expect(qrCodeLogin.hide).toHaveBeenCalledTimes(1)
    expect(wm.switchToTab(AUTH_TAB_ID)).toBe(true)
    expect(qrCodeLogin.show).toHaveBeenCalledTimes(1)
    wm.resize()
    expect(qrCodeLogin._onWindowResize).toHaveBeenCalledTimes(1)

    qrCodeLogin.onClosed()
    expect(wm._activeTabId).toBe('btab-1')
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('后台扫码会话结束时保留用户后来主动选择的标签', () => {
    const { wm } = createManagerWithBrowserTab()
    const qrCodeLogin = createFakeQrCodeLogin()
    const laterView = createBrowserView()
    wm._tabViews.set('btab-2', laterView)
    wm._tabStates.set('btab-2', {
      url: 'https://cp.kuaishou.com/article/publish/video',
      title: '快手创作者中心',
      loading: false,
      canGoBack: false,
      canGoForward: false
    })
    wm.attachQrCodeLogin(qrCodeLogin)

    qrCodeLogin.onOpened({
      platform: 'kuaishou',
      accountId: 'auth-kuaishou-1',
      url: 'https://passport.kuaishou.com/',
    })
    expect(wm.switchToTab('btab-2')).toBe(true)

    qrCodeLogin.onClosed()

    expect(wm._authTabInfo).toBeNull()
    expect(wm._activeTabId).toBe('btab-2')
    expect(laterView.setVisible).toHaveBeenLastCalledWith(true)
  })
})

function patchViewAndSessionMocks () {
  __electronMock.WebContentsView = function (opts) {
    this._opts = opts || {}
    const handlers = {}
    this.webContents = {
      _handlers: handlers,
      _windowOpenHandler: null,
      // 真实 Electron 中 webContents.session 即构造时 webPreferences.session 传入的分区，mock 必须同物挂接；
      // 否则 Cookie 提取路径在测试中永远是 undefined，吞错路径会被误放行（2026-09-22 getAll 回归教训）。
      session: (opts && opts.webPreferences && opts.webPreferences.session) || null,
      on: function (evt, fn) { handlers[evt] = fn },
      once: function () {},
      canGoBack: function () { return false },
      canGoForward: function () { return false },
      loadURL: vi.fn(function () { return Promise.resolve() }),
      executeJavaScript: vi.fn(function () { return Promise.resolve() }),
      isDestroyed: function () { return false },
      setWindowOpenHandler: function (fn) { this._windowOpenHandler = fn },
      // debugger mock：测试预设 __webContentsDebuggerFactory 返回 CDP stub；
      // 未预设时保持 undefined，等价真实环境 debugger 不可用（降级路径回归锚点）。
      debugger: (__electronMock.__webContentsDebuggerFactory ? __electronMock.__webContentsDebuggerFactory() : undefined),
    }
    this.setBounds = vi.fn()
    this.setVisible = vi.fn()
  }
  const partitions = []
  __electronMock.session._partitions = partitions
  // 测试可预设「分区残留 Cookie」：cleanSession 用例据此断言清除行为
  __electronMock.session._staleCookies = null
  __electronMock.session.fromPartition = function (partition) {
    const created = {
      partition,
      cookies: {
        // 契约：忠实镜像真实 Electron session.cookies API——只有 get/set/remove/flushStore，不存在 getAll。
        // 测试可通过 _store 预设 get() 返回值。
        setCalls: [],
        removeCalls: [],
        _store: undefined,
        set: function (cookie) { created.cookies.setCalls.push(cookie); return Promise.resolve() },
        get: function () { return Promise.resolve(created.cookies._store !== undefined ? created.cookies._store : (__electronMock.session._staleCookies || [])) },
        remove: function (url, name) { created.cookies.removeCalls.push({ url, name }); return Promise.resolve() },
        flushStore: function () { return Promise.resolve() },
      },
      on: function () {},
    }
    partitions.push(created)
    return created
  }
  return partitions
}

describe('WebviewManager.createNewTabPage 账号登录态恢复', () => {
  beforeEach(() => {
    credentialLoadMock.mockReset()
    credentialLoadMock.mockReturnValue(null)
  })

  it('带 accountId 时使用按账号持久分区并从加密凭证恢复 Cookie', async () => {
    const partitions = patchViewAndSessionMocks()
    credentialLoadMock.mockReturnValue({
      cookies: [{ url: 'https://www.zhihu.com', name: 'session', value: 'abc' }],
      localStorage: { token: 'xyz' },
    })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    const tabId = wm.createNewTabPage({ url: 'https://creator.zhihu.com', accountId: 'account-1' })

    expect(tabId).toBeTruthy()
    expect(credentialLoadMock).toHaveBeenCalledWith('account-1', expect.any(String))
    const created = partitions[partitions.length - 1]
    expect(created.partition).toBe('persist:account-account-1')
    expect(created.cookies.setCalls).toEqual([{ url: 'https://www.zhihu.com', name: 'session', value: 'abc' }])
  })

  it('身份命名空间凭证优先于 legacy credential-store，适用于所有平台', async () => {
    const partitions = patchViewAndSessionMocks()
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()
    wm.setAccountManager({
      loadSavedCredentials: vi.fn(() => ({
        cookies: [{ domain: '.baijiahao.baidu.com', name: 'BDUSS', value: 'owner-value', secure: true }],
        localStorage: { token: 'owner-token' },
      })),
    })

    wm.createNewTabPage({ url: 'https://baijiahao.baidu.com/', platform: 'baijiahao', accountId: 'baijia-1' })

    expect(credentialLoadMock).not.toHaveBeenCalled()
    expect(partitions[partitions.length - 1].cookies.setCalls).toEqual([
      { url: 'https://baijiahao.baidu.com/', domain: '.baijiahao.baidu.com', name: 'BDUSS', value: 'owner-value', secure: true },
    ])
  })

  it('账号标签创建会把 platform 传给身份凭证读取器，并等待 Cookie 注入后导航', async () => {
    const partitions = patchViewAndSessionMocks()
    const loadSavedCredentials = vi.fn(() => ({
      cookies: [{ url: 'https://cp.kuaishou.com', name: 'kuaishou_sid', value: 'owner-cookie' }],
    }))
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()
    wm.setAccountManager({ loadSavedCredentials })

    wm.createNewTabPage({ url: 'https://cp.kuaishou.com/article/publish/video', platform: 'kuaishou', accountId: 'ks-1' })

    const view = wm._tabViews.get(wm._activeTabId)
    expect(loadSavedCredentials).toHaveBeenCalledWith('ks-1', 'kuaishou')
    expect(view.webContents.loadURL).not.toHaveBeenCalled()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://cp.kuaishou.com/article/publish/video')
    expect(partitions[partitions.length - 1].cookies.setCalls).toEqual([
      { url: 'https://cp.kuaishou.com', name: 'kuaishou_sid', value: 'owner-cookie' },
    ])
  })

  it('凭证缺少 url 的 Cookie 以初始页面 URL 补齐后再注入', async () => {
    const partitions = patchViewAndSessionMocks()
    credentialLoadMock.mockReturnValue({ cookies: [{ name: 'sid', value: 'v1' }] })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://creator.douyin.com', accountId: 'acc_2' })

    const created = partitions[partitions.length - 1]
    expect(created.cookies.setCalls).toEqual([{ url: 'https://creator.douyin.com', name: 'sid', value: 'v1' }])
  })

  it('页面加载完成后恢复凭证中的 localStorage', async () => {
    patchViewAndSessionMocks()
    credentialLoadMock.mockReturnValue({ localStorage: { token: 'xyz' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://creator.zhihu.com', accountId: 'account-1' })

    const activeView = wm._tabViews.get(wm._activeTabId)
    activeView.webContents._handlers['did-finish-load']()
    expect(activeView.webContents.executeJavaScript).toHaveBeenCalled()
    const script = activeView.webContents.executeJavaScript.mock.calls[0][0]
    expect(script).toContain('"token":"xyz"')
    await Promise.resolve()
    expect(activeView.webContents.loadURL).toHaveBeenCalledWith('https://creator.zhihu.com')
  })

  it('debugger 可用时凭证 localStorage 经 CDP document-start 注入且先于首个导航（无二段导航）', async () => {
    patchViewAndSessionMocks()
    const order = []
    const dbg = {
      attach: vi.fn(function () {}),
      sendCommand: vi.fn(function (method) {
        if (method === 'Page.addScriptToEvaluateOnNewDocument') order.push('addScript')
        return Promise.resolve()
      }),
      detach: vi.fn(),
    }
    __electronMock.__webContentsDebuggerFactory = function () { return dbg }
    credentialLoadMock.mockReturnValue({ localStorage: { finder_username: 'v2_ctx' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://channels.weixin.qq.com/', platform: 'tencent_video', accountId: 'tv-1' })

    const view = wm._tabViews.get(wm._activeTabId)
    // 导航必然经 promise 链延后（微任务），同步包装可完整记录时序
    const origLoadURL = view.webContents.loadURL
    view.webContents.loadURL = vi.fn(function (u) { order.push('loadURL:' + u); return origLoadURL.call(this, u) })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dbg.attach).toHaveBeenCalled()
    expect(dbg.sendCommand).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument',
      expect.objectContaining({ source: expect.stringContaining('"finder_username"') }))
    const navIdx = order.indexOf('loadURL:https://channels.weixin.qq.com/')
    expect(navIdx).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('addScript')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('addScript')).toBeLessThan(navIdx)

    // 早期注入成功 → 不得再有 did-finish-load 补注入与二段导航（消除登录页闪烁）
    if (view.webContents._handlers['did-finish-load']) view.webContents._handlers['did-finish-load']()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    __electronMock.__webContentsDebuggerFactory = null
  })

  it('debugger attach 失败时降级回旧行为：did-finish-load 后注入并二段导航（fail-open）', async () => {
    patchViewAndSessionMocks()
    __electronMock.__webContentsDebuggerFactory = function () {
      return {
        attach: vi.fn(function () { throw new Error('debugger may already be attached') }),
        sendCommand: vi.fn(function () { return Promise.resolve() }),
        detach: vi.fn(),
      }
    }
    credentialLoadMock.mockReturnValue({ localStorage: { finder_username: 'v2_ctx' } })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://channels.weixin.qq.com/', platform: 'tencent_video', accountId: 'tv-2' })

    const view = wm._tabViews.get(wm._activeTabId)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
    expect(view.webContents._handlers['did-finish-load']).toBeTruthy()

    view.webContents._handlers['did-finish-load']()
    expect(view.webContents.executeJavaScript).toHaveBeenCalled()
    const script = view.webContents.executeJavaScript.mock.calls[0][0]
    expect(script).toContain('"finder_username":"v2_ctx"')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(2)
    expect(view.webContents.loadURL).toHaveBeenLastCalledWith('https://channels.weixin.qq.com/')
    __electronMock.__webContentsDebuggerFactory = null
  })

  // ─── 2026-09-24 头条账号标签「一直加载不出来」事故回归对（两条不变量）───
  // 根因（PR #2327 引入）：首个导航被门控在 CDP addScriptToEvaluateOnNewDocument 的
  // promise 上，而该命令在头条账号分区可永久挂起（事故日志：标签存活近 2 分钟命令
  // 从未返回，关闭瞬间才以 target closed 失败）→ 页面永不导航；关闭后回调又对已销毁
  // webContents 调 loadURL → 未处理 TypeError。
  it('CDP 命令永久挂起时超时降级，首个导航照常发生（头条加载挂死回归）', async () => {
    patchViewAndSessionMocks()
    __electronMock.__webContentsDebuggerFactory = function () {
      return {
        attach: vi.fn(function () {}),
        // 永不 resolve/reject：忠实镜像事故现场的 CDP 挂起
        sendCommand: vi.fn(function () { return new Promise(function () {}) }),
        detach: vi.fn(),
      }
    }
    credentialLoadMock.mockReturnValue({ localStorage: { session_token: 'hang' } })
    vi.useFakeTimers()
    try {
      const mod = await import('./webview-manager.js')
      const WM = mod.default || mod
      const wm = new WM()
      wm.mainWindow = createMainWindow()

      wm.createNewTabPage({ url: 'https://mp.toutiao.com/', platform: 'toutiao', accountId: 'tt-hang-1' })
      const view = wm._tabViews.get(wm._activeTabId)

      await vi.advanceTimersByTimeAsync(0)
      expect(view.webContents.loadURL).not.toHaveBeenCalled() // 导航仍被早期注入门控（契约：先于首个导航）

      await vi.advanceTimersByTimeAsync(10000) // 超过 LS_INJECTION_TIMEOUT_MS
      expect(view.webContents.loadURL).toHaveBeenCalledWith('https://mp.toutiao.com/')
      // 超时后走旧补注入路径（fail-open），LS 仍会在 did-finish-load 后恢复
      expect(view.webContents._handlers['did-finish-load']).toBeTruthy()
    } finally {
      vi.useRealTimers()
      __electronMock.__webContentsDebuggerFactory = null
    }
  })

  it('标签关闭后 CDP 命令才失败时，导航回调静默跳过且不产生未处理拒绝（loadURL undefined 回归）', async () => {
    patchViewAndSessionMocks()
    const unhandled = []
    const onUnhandled = (err) => { unhandled.push(err) }
    process.on('unhandledRejection', onUnhandled)
    let rejectCmd = null
    __electronMock.__webContentsDebuggerFactory = function () {
      return {
        attach: vi.fn(function () {}),
        sendCommand: vi.fn(function () {
          return new Promise(function (_resolve, reject) { rejectCmd = reject })
        }),
        detach: vi.fn(),
      }
    }
    credentialLoadMock.mockReturnValue({ localStorage: { session_token: 'hang' } })
    try {
      const mod = await import('./webview-manager.js')
      const WM = mod.default || mod
      const wm = new WM()
      wm.mainWindow = createMainWindow()
      wm.createNewTabPage({ url: 'https://mp.toutiao.com/', platform: 'toutiao', accountId: 'tt-close-1' })
      const tabId = wm._activeTabId
      const view = wm._tabViews.get(tabId)
      // 真实 Electron：close 之后 view.webContents 不复存在
      view.webContents.close = vi.fn(function () { view.webContents = undefined })
      // 微任务冲刷：让早期注入链完成 sendCommand 调用并登记 reject 句柄
      await new Promise(resolve => setTimeout(resolve, 0))

      wm.closeTab(tabId)
      // 忠实镜像事故时序：关闭瞬间 CDP 命令才以 target closed 失败
      expect(typeof rejectCmd).toBe('function')
      rejectCmd(new Error('target closed while handling command'))
      await new Promise(resolve => setTimeout(resolve, 0))
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      __electronMock.__webContentsDebuggerFactory = null
    }
  })

  it('将 Playwright Cookie 的 expires/sameSite 转为 Electron 字段', async () => {
    const partitions = patchViewAndSessionMocks()
    credentialLoadMock.mockReturnValue({
      cookies: [{
        domain: '.baijiahao.baidu.com',
        name: 'BDUSS',
        value: 'v1',
        expires: 1893456000,
        sameSite: 'Lax',
      }],
    })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://baijiahao.baidu.com/', platform: 'baijiahao', accountId: 'baijia-1' })

    expect(partitions[partitions.length - 1].cookies.setCalls).toEqual([{
      domain: '.baijiahao.baidu.com',
      name: 'BDUSS',
      value: 'v1',
      expirationDate: 1893456000,
      sameSite: 'lax',
      url: 'https://baijiahao.baidu.com/',
    }])
  })

  it('无 accountId 时保持一次性浏览分区且不读取凭证', async () => {
    const partitions = patchViewAndSessionMocks()
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://www.baidu.com' })

    expect(credentialLoadMock).not.toHaveBeenCalled()
    const created = partitions[partitions.length - 1]
    expect(created.partition).toMatch(/^persist:browse-btab-\d+$/)
  })

  it('非法 accountId 或凭证读取失败时静默降级，不阻塞标签创建', async () => {
    const partitions = patchViewAndSessionMocks()
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    // 非法 accountId → 降级为一次性浏览分区，不读取凭证
    const fallbackTabId = wm.createNewTabPage({ url: 'https://creator.zhihu.com', accountId: 'bad/../id' })
    expect(fallbackTabId).toBeTruthy()
    expect(credentialLoadMock).not.toHaveBeenCalled()
    expect(partitions[partitions.length - 1].partition).toMatch(/^persist:browse-btab-\d+$/)

    // 合法 accountId 但凭证解密失败 → 仍创建账号分区标签，只是无 Cookie 注入
    credentialLoadMock.mockReset()
    credentialLoadMock.mockImplementation(() => { throw new Error('decrypt failed') })
    const tabId = wm.createNewTabPage({ url: 'https://creator.zhihu.com', accountId: 'account-1' })
    expect(tabId).toBeTruthy()
    const created = partitions[partitions.length - 1]
    expect(created.partition).toBe('persist:account-account-1')
    expect(created.cookies.setCalls).toEqual([])
  })

  it('支持传入 title 作为标签初始标题（创作者中心等场景），未传时回退 New Tab', async () => {
    const partitions = patchViewAndSessionMocks()
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    const tabId = wm.createNewTabPage({ url: 'https://creator.zhihu.com', accountId: 'account-1', title: '  知乎创作者中心  ' })
    expect(wm._tabStates.get(tabId).title).toBe('知乎创作者中心')

    const tabId2 = wm.createNewTabPage({ url: 'https://creator.zhihu.com', accountId: 'account-2' })
    expect(wm._tabStates.get(tabId2).title).toBe('New Tab')
  })
})

describe('WebviewManager.createNewTabPage cleanSession（失效账号登录页干净会话）', () => {
  beforeEach(() => {
    credentialLoadMock.mockReset()
    credentialLoadMock.mockReturnValue(null)
  })

  it('cleanSession:true 时跳过凭证 Cookie 恢复并清空分区残留 Cookie', async () => {
    const partitions = patchViewAndSessionMocks()
    // 持久分区里残留上次打开时写入的失效身份 Cookie（微信 wxuin 等）
    __electronMock.session._staleCookies = [
      { domain: '.mp.weixin.qq.com', name: 'wxuin', value: '88xxx', secure: true, path: '/' },
      { domain: '.mp.weixin.qq.com', name: 'ua_id', value: 'abc=', secure: true, path: '/' },
    ]
    credentialLoadMock.mockReturnValue({
      cookies: [{ url: 'https://mp.weixin.qq.com', name: 'slave_sid', value: 'dead-session' }],
    })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    const tabId = wm.createNewTabPage({ url: 'https://mp.weixin.qq.com/', platform: 'wechat_mp', accountId: 'mp-1', cleanSession: true })

    expect(tabId).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 0))
    const created = partitions[partitions.length - 1]
    expect(created.partition).toBe('persist:account-mp-1')
    // 凭证 Cookie 不得注入
    expect(created.cookies.setCalls).toEqual([])
    // 残留 Cookie 全部清除
    expect(created.cookies.removeCalls).toEqual([
      { url: 'https://mp.weixin.qq.com/', name: 'wxuin' },
      { url: 'https://mp.weixin.qq.com/', name: 'ua_id' },
    ])
    // 清除完成后导航
    const view = wm._tabViews.get(wm._activeTabId)
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://mp.weixin.qq.com/')
  })

  it('cleanSession:true 时跳过凭证 localStorage 恢复', async () => {
    const partitions = patchViewAndSessionMocks()
    credentialLoadMock.mockReturnValue({
      cookies: [],
      localStorage: { token: 'stale-token' },
    })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://mp.weixin.qq.com/', platform: 'wechat_mp', accountId: 'mp-2', cleanSession: true })

    const view = wm._tabViews.get(wm._activeTabId)
    await new Promise(resolve => setTimeout(resolve, 0))
    // did-finish-load 未注册 localStorage 写入钩子（executeJavaScript 不被调用）
    const js = view.webContents.executeJavaScript.mock.calls.map(c => c[0]).join('')
    expect(js).not.toContain('stale-token')
  })

  it('未传 cleanSession 的账号标签保持原有凭证恢复行为（回归保护）', async () => {
    const partitions = patchViewAndSessionMocks()
    __electronMock.session._staleCookies = [
      { domain: '.mp.weixin.qq.com', name: 'wxuin', value: '88xxx', secure: true, path: '/' },
    ]
    credentialLoadMock.mockReturnValue({
      cookies: [{ url: 'https://mp.weixin.qq.com', name: 'slave_sid', value: 'valid-session' }],
    })
    const mod = await import('./webview-manager.js')
    const WM = mod.default || mod
    const wm = new WM()
    wm.mainWindow = createMainWindow()

    wm.createNewTabPage({ url: 'https://mp.weixin.qq.com/', platform: 'wechat_mp', accountId: 'mp-3' })

    const created = partitions[partitions.length - 1]
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(created.cookies.setCalls).toEqual([{ url: 'https://mp.weixin.qq.com', name: 'slave_sid', value: 'valid-session' }])
    expect(created.cookies.removeCalls).toEqual([])
  })
})

describe('WebviewManager 浏览器标签标题隔离', () => {
  it('不同 WebContentsView 的 page-title-updated 只更新对应 tab 并广播对应 tabId', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')

    const firstTabId = wm.createNewTabPage({ url: 'https://creator.douyin.com' })
    const secondTabId = wm.createNewTabPage({ url: 'https://cp.kuaishou.com' })
    const firstView = wm._tabViews.get(firstTabId)
    const secondView = wm._tabViews.get(secondTabId)

    firstView.webContents._handlers['page-title-updated']({}, '抖音创作者中心')
    secondView.webContents._handlers['page-title-updated']({}, '快手创作者服务')

    expect(wm._tabStates.get(firstTabId).title).toBe('抖音创作者中心')
    expect(wm._tabStates.get(secondTabId).title).toBe('快手创作者服务')
    const titleEvents = wm.mainWindow.webContents.send.mock.calls
      .filter(call => call[0] === 'page-manager:tab-title-updated')
      .map(call => call[1].data)
    expect(titleEvents).toEqual([
      { tabId: firstTabId, title: '抖音创作者中心' },
      { tabId: secondTabId, title: '快手创作者服务' }
    ])
  })
})

describe('WebviewManager 固定首页标签（对齐参考产品：第1个标签永为应用主页）', () => {
  it('构造后 _homeTabId 固定为 HOME_TAB_ID，创建浏览器标签不会改变它', () => {
    const wm = new WebviewManager()
    const { HOME_TAB_ID } = require('./webview-manager.js')
    expect(wm._homeTabId).toBe(HOME_TAB_ID)
    expect(wm._activeTabId).toBe(HOME_TAB_ID)

    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const tabId = wm.createNewTabPage({ url: 'https://creator.douyin.com', platform: 'douyin', title: '抖音' })
    expect(wm._homeTabId).toBe(HOME_TAB_ID)
    expect(wm._activeTabId).toBe(tabId)
  })

  it('getAllTabs 固定返回首页标签（isHome:true）且排在第一位', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.createNewTabPage({ url: 'https://creator.douyin.com', platform: 'douyin', title: '抖音' })
    wm.createNewTabPage({ url: 'https://cp.kuaishou.com', platform: 'kuaishou', title: '快手' })

    const all = wm.getAllTabs()
    const homeTabs = all.filter(t => t.isHome)
    expect(homeTabs).toHaveLength(1)
    expect(homeTabs[0].tabId).toBe('home')
    expect(homeTabs[0].title).toBe('首页')
    expect(all[0].isHome).toBe(true)
    expect(all.length).toBeGreaterThanOrEqual(3)
  })

  it('关闭首页标签返回 false（不可关闭）', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    expect(wm.closeTab('home')).toBe(false)
  })

  it('closeAll 后回退到首页', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.createNewTabPage({ url: 'https://creator.douyin.com' })
wm.createNewTabPage({ url: 'https://cp.kuaishou.com' })
    expect(wm._tabViews.size).toBe(2)
    wm.closeAll()
    expect(wm._tabViews.size).toBe(0)
    expect(wm._activeTabId).toBe('home')
  })

  it('getActiveTab 在首页活动时返回静态首页信息', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')

    wm.switchToTab('home')
    const active = wm.getActiveTab()
    expect(active).toMatchObject({
      tabId: 'home',
      title: '首页',
isHome: true,
      canGoBack: false,
      canGoForward: false
    })
  })
})

describe('WebviewManager window.open 拦截（对齐参考产品：创作者中心链接在当前 tab 内打开）', () => {
  it('_setupNav 注册 setWindowOpenHandler，intercept foreground-tab 并在当前 tab 内导航', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const tabId = wm.createNewTabPage({ url: 'https://mp.toutiao.com', platform: 'toutiao', title: '头条号' })
    const view = wm._tabViews.get(tabId)
    const handler = view.webContents._windowOpenHandler
    expect(typeof handler).toBe('function')

    const result = handler({ url: 'https://mp.toutiao.com/profile/', disposition: 'foreground-tab' })
    expect(result).toEqual({ action: 'deny' })
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://mp.toutiao.com/profile/')
  })

  it('拒绝非 http/https 协议的 URL', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    const tabId = wm.createNewTabPage({ url: 'https://creator.douyin.com' })
    const view = wm._tabViews.get(tabId)
    const handler = view.webContents._windowOpenHandler

    // 记录当前 loadURL 调用次数（标签创建本身会导航一次）
    const callsBefore = view.webContents.loadURL.mock.calls.length
    const result = handler({ url: 'file:///etc/passwd', disposition: 'foreground-tab' })
    expect(result).toEqual({ action: 'deny' })
    expect(view.webContents.loadURL.mock.calls.length).toBe(callsBefore)
  })

  it('拒绝无效 URL', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    const tabId = wm.createNewTabPage({ url: 'https://creator.douyin.com' })
    const view = wm._tabViews.get(tabId)
    const handler = view.webContents._windowOpenHandler

    const result = handler({ url: 'not a valid url', disposition: 'foreground-tab' })
    expect(result).toEqual({ action: 'deny' })
  })
})

describe('WebviewManager 批量登录凭证自动保存与护栏（方案一/二/三）', () => {
  function makeAccountManager() {
    return { updateCapturedAccount: vi.fn(() => Promise.resolve()), loadSavedCredentials: vi.fn(() => null) }
  }
  // 用真实 createNewTabPage 建「待保存」账号标签（cleanSession → credentialSaveState:'unsaved'），
  // 再解除初始重定向守卫，模拟登录页首帧已过、可判定登录成功。
  function createUnsavedAccountTab(wm, opts = {}) {
    const { platform = 'douyin', accountId = 'acc-1', url = 'https://creator.douyin.com/' } = opts
    const tabId = wm.createNewTabPage({ url, platform, accountId, cleanSession: true })
    const state = wm._tabStates.get(tabId)
    state.initialRedirectPhase = false
    return { tabId, state, view: wm._tabViews.get(tabId) }
  }

  it('getAllTabs/getActiveTab 透传 credentialSaveState（方案三角标数据源）', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const { tabId } = createUnsavedAccountTab(wm)
    const all = wm.getAllTabs()
    expect(all.find(t => t.tabId === tabId).credentialSaveState).toBe('unsaved')
    const active = wm.getActiveTab()
    expect(active.tabId).toBe(tabId)
    expect(active.credentialSaveState).toBe('unsaved')
  })

  it('getAccountTabSaveState：账号标签返回 unsaved，非账号/未知标签返回 isAccountTab=false（方案二护栏）', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const { tabId } = createUnsavedAccountTab(wm, { accountId: 'acc-9', platform: 'douyin' })
    expect(wm.getAccountTabSaveState(tabId)).toMatchObject({
      isAccountTab: true, credentialSaveState: 'unsaved', accountId: 'acc-9', platform: 'douyin'
    })
    const browseTabId = wm.createNewTabPage({ url: 'https://www.baidu.com' })
    expect(wm.getAccountTabSaveState(browseTabId)).toMatchObject({ isAccountTab: false, credentialSaveState: null })
    expect(wm.getAccountTabSaveState('no-such-tab')).toMatchObject({ isAccountTab: false })
  })

  it('saveAccountTabCredentials 成功后置 saved 并广播 tab-credential-state-changed（三方案共享）', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.setAccountManager(makeAccountManager())
    const { tabId, state, view } = createUnsavedAccountTab(wm, { platform: 'douyin', accountId: 'acc-1' })
    view.webContents.session.cookies._store = [{ domain: '.douyin.com', name: 'sessionid', value: 'v1', path: '/', secure: true }]
    const result = await wm.saveAccountTabCredentials(tabId)
    expect(result.ok).toBe(true)
    // 弱断言 expect.any(Array) 对空数组恒真（2026-09-22 getAll 逃逸点），必须断言真实内容
    expect(wm._accountManager.updateCapturedAccount).toHaveBeenCalledWith(
      'douyin',
      expect.objectContaining({ cookies: [{ domain: '.douyin.com', name: 'sessionid', value: 'v1', path: '/', secure: true }] }),
      'acc-1'
    )
    expect(state.credentialSaveState).toBe('saved')
    const sends = wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-credential-state-changed').map(c => c[1].data)
    expect(sends).toContainEqual(expect.objectContaining({ tabId, credentialSaveState: 'saved' }))
  })

  // 回归（2026-09-22）：saveAccountTabCredentials 曾调用 session.cookies.getAll——该方法在
  // Electron 中不存在，TypeError 被 catch 吞掉后以 cookies=[] 继续保存（假成功），导致失效
  // 账号扫码重登后凭证库仍是 0 Cookie，再开创作者中心弹回登录页。契约：
  // ① 必须用真实 API get({}) 提取；② 提取失败必须 fail-closed（不保存、保持 unsaved、
  // 不广播 saved），杜绝任何吞错假保存。
  it('回归：saveAccountTabCredentials 经 session.cookies.get 提取真实 Cookie（API 契约镜像 Electron）', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.setAccountManager(makeAccountManager())
    const { tabId, view } = createUnsavedAccountTab(wm, { platform: 'tencent_video', accountId: 'vid-1', url: 'https://channels.weixin.qq.com/' })
    // mock 的 cookies 对象忠实镜像 Electron API：不存在 getAll
    expect(typeof view.webContents.session.cookies.getAll).toBe('undefined')
    view.webContents.session.cookies._store = [
      { domain: '.weixin.qq.com', name: 'slave_sid', value: 'fresh', path: '/', secure: true },
    ]
    const result = await wm.saveAccountTabCredentials(tabId)
    expect(result.ok).toBe(true)
    expect(wm._accountManager.updateCapturedAccount).toHaveBeenCalledWith(
      'tencent_video',
      expect.objectContaining({ cookies: [{ domain: '.weixin.qq.com', name: 'slave_sid', value: 'fresh', path: '/', secure: true }] }),
      'vid-1'
    )
  })

  it('回归：Cookie 提取抛错时 fail-closed——不落盘、保持 unsaved、不广播 saved', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.setAccountManager(makeAccountManager())
    const { tabId, state, view } = createUnsavedAccountTab(wm, { platform: 'tencent_video', accountId: 'vid-2', url: 'https://channels.weixin.qq.com/' })
    view.webContents.session.cookies.get = () => Promise.reject(new Error('extract-boom'))
    const result = await wm.saveAccountTabCredentials(tabId)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('cookie-extract-failed')
    expect(wm._accountManager.updateCapturedAccount).not.toHaveBeenCalled()
    expect(state.credentialSaveState).toBe('unsaved')
    const sends = wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-credential-state-changed').map(c => c[1].data)
    expect(sends.some(d => d && d.credentialSaveState === 'saved')).toBe(false)
  })

  // 本 PR 补充：_extractTabCookies 集中守卫的负例——session 整体缺失时同样 fail-closed，
  // 绝不退化成「保存一份 cookies=0 的凭证」（该守卫是本 PR 引入，main 的用例未覆盖）。
  it('回归：session 不可用时 fail-closed（cookies 提取守卫，不落空凭证）', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.setAccountManager(makeAccountManager())
    const { tabId, state, view } = createUnsavedAccountTab(wm, { platform: 'tencent_video', accountId: 'vid-3', url: 'https://channels.weixin.qq.com/' })
    view.webContents.session = undefined
    const result = await wm.saveAccountTabCredentials(tabId)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('cookie-extract-failed')
    expect(wm._accountManager.updateCapturedAccount).not.toHaveBeenCalled()
    expect(state.credentialSaveState).toBe('unsaved')
  })

  it('回归：saveCookies（tab-cookies-changed 事件源）用 get 提取真实 Cookie', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const { tabId, view } = createUnsavedAccountTab(wm)
    view.webContents.session.cookies._store = [{ domain: '.douyin.com', name: 'sid', value: 'x', path: '/', secure: false }]
    const spy = vi.fn()
    wm.on('tab-cookies-changed', spy)
    wm.saveCookies(tabId)
    await new Promise(resolve => setImmediate(resolve))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatchObject({ tabId, cookies: [{ domain: '.douyin.com', name: 'sid', value: 'x', path: '/', secure: false }] })
  })

  it('saveAccountTabCredentials 无 accountManager 时失败且保持 unsaved（不静默丢失）', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const { tabId, state } = createUnsavedAccountTab(wm)
    const result = await wm.saveAccountTabCredentials(tabId)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('account-manager-unavailable')
    expect(state.credentialSaveState).toBe('unsaved')
  })

  it('方案一（治本）：did-navigate 命中登录成功 URL → 去抖后自动回写凭证', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.setAccountManager(makeAccountManager())
    const { tabId, state } = createUnsavedAccountTab(wm)
    const saveSpy = vi.spyOn(wm, 'saveAccountTabCredentials').mockResolvedValue({ ok: true, accountId: 'acc-1', platform: 'douyin' })
    vi.useFakeTimers()
    try {
      const view = wm._tabViews.get(tabId)
      view.webContents._handlers['did-navigate']({}, 'https://creator.douyin.com/creator-micro/home')
      expect(state._autoSaveTimer).toBeTruthy()
      expect(saveSpy).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
      expect(saveSpy).toHaveBeenCalledWith(tabId)
    } finally {
      vi.useRealTimers()
    }
  })

  it('方案一：初始重定向阶段（initialRedirectPhase=true）不触发自动保存（防误判登录页）', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const tabId = wm.createNewTabPage({ url: 'https://creator.douyin.com/', platform: 'douyin', accountId: 'acc-1', cleanSession: true })
    const state = wm._tabStates.get(tabId)
    state.initialRedirectPhase = true
    const saveSpy = vi.spyOn(wm, 'saveAccountTabCredentials').mockResolvedValue({ ok: true })
    vi.useFakeTimers()
    try {
      wm._maybeScheduleAutoSave(tabId, state)
      vi.advanceTimersByTime(2000)
      expect(saveSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('方案一：已保存标签不再排程；横跳到非成功 URL 取消待触发计时器（防抖动误存）', () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const { tabId, state } = createUnsavedAccountTab(wm)
    const saveSpy = vi.spyOn(wm, 'saveAccountTabCredentials').mockResolvedValue({ ok: true })
    vi.useFakeTimers()
    try {
      const view = wm._tabViews.get(tabId)
      view.webContents._handlers['did-navigate']({}, 'https://creator.douyin.com/creator-micro/home')
      expect(state._autoSaveTimer).toBeTruthy()
      // 跳离平台域（非 auth host）→ 取消计时器
      view.webContents._handlers['did-navigate']({}, 'https://example.com/away')
      expect(state._autoSaveTimer).toBeNull()
      vi.advanceTimersByTime(2000)
      expect(saveSpy).not.toHaveBeenCalled()
      // 手动置 saved 后再命中成功 URL 也不重复排程
      state.credentialSaveState = 'saved'
      wm._maybeScheduleAutoSave(tabId, state)
      expect(state._autoSaveTimer).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('方案三：saveAllUnsavedAccounts 批量保存全部 unsaved 账号标签，跳过非账号标签', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.setAccountManager(makeAccountManager())
    const t1 = createUnsavedAccountTab(wm, { accountId: 'a1', platform: 'douyin' }).tabId
    const t2 = createUnsavedAccountTab(wm, { accountId: 'a2', platform: 'kuaishou' }).tabId
    wm.createNewTabPage({ url: 'https://www.baidu.com' }) // 浏览标签，非账号 → 跳过
    const res = await wm.saveAllUnsavedAccounts()
    expect(res).toMatchObject({ attempted: 2, saved: 2 })
    expect(res.failed).toEqual([])
    expect(wm._tabStates.get(t1).credentialSaveState).toBe('saved')
    expect(wm._tabStates.get(t2).credentialSaveState).toBe('saved')
  })

  it('方案三：单个账号保存失败计入 failed，不影响其余账号', async () => {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.setAccountManager({
      loadSavedCredentials: vi.fn(() => null),
      updateCapturedAccount: vi.fn((platform) => platform === 'douyin'
        ? Promise.reject(new Error('boom')) : Promise.resolve()),
    })
    createUnsavedAccountTab(wm, { accountId: 'a1', platform: 'douyin' })
    const t2 = createUnsavedAccountTab(wm, { accountId: 'a2', platform: 'kuaishou' }).tabId
    const res = await wm.saveAllUnsavedAccounts()
    expect(res.attempted).toBe(2)
    expect(res.saved).toBe(1)
    expect(res.failed).toEqual([{ accountId: 'a1', platform: 'douyin', reason: 'boom' }])
    expect(wm._tabStates.get(t2).credentialSaveState).toBe('saved')
  })
})

describe('WebviewManager home-shell 内嵌主页标签', () => {
  it('opts.homeShell 创建时加载本应用主页地址并挂载 home-shell preload', () => {
    patchViewAndSessionMocks()
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')

    const tabId = wm.createNewTabPage({ homeShell: true, title: '新标签页' })
    const view = wm._tabViews.get(tabId)
    const loadedUrl = view.webContents.loadURL.mock.calls[0][0]

    // 开发态（mock isPackaged:false）走 devServer 地址；两种形态都必须携带壳态参数
    expect(loadedUrl).toMatch(/mp-home-shell=1/)
    expect(loadedUrl).toMatch(/\/\?mp-home-shell=1$|#\?mp-home-shell=1$/)
    expect(view._opts.webPreferences.preload).toMatch(/home-shell-preload(\.js|\.bundle\.js)$/)
    expect(view._opts.webPreferences.additionalArguments).toEqual(
      expect.arrayContaining([expect.stringContaining('--mp-home-shell-url=')])
    )
  })

  it('home-shell 标签 tab-created 广播地址置空（避免 file:// 长路径灌进地址栏）', () => {
    patchViewAndSessionMocks()
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')

    const tabId = wm.createNewTabPage({ homeShell: true, title: '新标签页' })
    const created = wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-created')
      .pop()
    expect(created[1].data.tabId).toBe(tabId)
    expect(created[1].data.url).toBe('')
    expect(wm.getAllTabs().find(t => t.tabId === tabId).title).toBe('新标签页')
  })

  it('普通 URL 标签不受 home-shell 逻辑影响（回归保护：monitor-preload + 原地址导航）', () => {
    patchViewAndSessionMocks()
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')

    const tabId = wm.createNewTabPage({ url: 'https://creator.douyin.com' })
    const view = wm._tabViews.get(tabId)
    expect(view._opts.webPreferences.preload).toMatch(/monitor-preload\.js$/)
    expect(view._opts.webPreferences.additionalArguments || []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('--mp-home-shell-url=')])
    )
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://creator.douyin.com')
  })

  it('about:blank 创建不再产生可见空白标签：等价降级为 home-shell 主页', () => {
    patchViewAndSessionMocks()
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')

    const tabId = wm.createNewTabPage({ url: 'about:blank', title: '新标签页' })
    const view = wm._tabViews.get(tabId)
    const loadedUrl = view.webContents.loadURL.mock.calls.length
      ? view.webContents.loadURL.mock.calls[0][0]
      : ''
    // 要么直接加载主页，要么保持不导航（state 视为 homeShell）；不得把 about:blank 作为可见内容地址广播
    expect(loadedUrl === '' || loadedUrl.includes('mp-home-shell=1')).toBe(true)
    const created = wm.mainWindow.webContents.send.mock.calls
      .filter(c => c[0] === 'page-manager:tab-created')
      .pop()
    expect(created[1].data.url).not.toBe('about:blank')
  })

  it('home-shell 标签不读取账号凭证、不挂登录诊断（无 accountId 路径回归）', () => {
    patchViewAndSessionMocks()
    const partitions = __electronMock.session._partitions
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    wm.setAccountManager({ loadSavedCredentials: vi.fn(() => ({ cookies: [{ url: 'https://example.test', name: 'sid', value: 'x' }] })) })

    wm.createNewTabPage({ homeShell: true, title: '新标签页' })
    const created = partitions[partitions.length - 1]
    expect(created.partition).toMatch(/^persist:browse-btab-\d+$/)
    expect(created.cookies.setCalls.length).toBe(0)
  })

  // F5 / §6.5：home-shell 标签地址栏导航去外部站点后自然结束壳态（本标签转普通网页标签）
  it('home-shell 标签导航到外站后壳态自然结束（地址栏显示真实 URL、不再置空）', () => {
    patchViewAndSessionMocks()
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')

    const tabId = wm.createNewTabPage({ homeShell: true, title: '新标签页' })
    const view = wm._tabViews.get(tabId)
    const state = wm._tabStates.get(tabId)
    expect(state.homeShell).toBe(true)
    expect(wm.getAllTabs().find(t => t.tabId === tabId).url).toBe('')

    // 用户在外层地址栏输入外部 URL → WebContentsView 导航至该站点（文档级 did-navigate）
    view.webContents._handlers['did-navigate']({}, 'https://example.com/some-page')

    const tab = wm.getAllTabs().find(t => t.tabId === tabId)
    expect(tab.url).toBe('https://example.com/some-page')
    // 壳态已结束：后续页面 <title> 可覆盖锁定前的默认标题（titleLocked 不再因壳态强制）
    expect(state.homeShell).toBe(false)
  })
})

describe('共享左侧边栏驱动聚焦 home-shell 标签（方案 B：navigateActiveHomeShell + spaRoute 回归）', () => {
  function createHomeShellTab () {
    patchViewAndSessionMocks()
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const tabId = wm.createNewTabPage({ homeShell: true })
    const view = wm._tabViews.get(tabId)
    view.webContents.send = vi.fn()
    return { wm, tabId, view }
  }

  it('聚焦标签是 home-shell：把 hash 路由定向发给其 webContents 并返回 handled:true', () => {
    const { wm, view } = createHomeShellTab()
    const res = wm.navigateActiveHomeShell('/collection')
    expect(res).toEqual({ handled: true })
    expect(view.webContents.send).toHaveBeenCalledWith('page-manager:home-shell-navigate', { path: '/collection' })
  })

  it('非法 path（不以 / 开头 / 非字符串）拒绝且不发送', () => {
    const { wm, view } = createHomeShellTab()
    expect(wm.navigateActiveHomeShell('collection')).toEqual({ handled: false })
    expect(wm.navigateActiveHomeShell(null)).toEqual({ handled: false })
    expect(wm.navigateActiveHomeShell(123)).toEqual({ handled: false })
    expect(view.webContents.send).not.toHaveBeenCalled()
  })

  it('聚焦标签是普通网页（非 home-shell）→ handled:false，让渲染层回退切回首页', () => {
    patchViewAndSessionMocks()
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    wm._subscribers.add('test-subscriber')
    const tabId = wm.createNewTabPage({ url: 'https://creator.douyin.com/' })
    const view = wm._tabViews.get(tabId)
    view.webContents.send = vi.fn()
    expect(wm.navigateActiveHomeShell('/collection')).toEqual({ handled: false })
    expect(view.webContents.send).not.toHaveBeenCalled()
  })

  it('home-shell 页内 hash 导航：更新 spaRoute 并经 getActiveTab/getAllTabs 暴露 homeShell+spaRoute', () => {
    const { wm, tabId, view } = createHomeShellTab()
    const handlers = view.webContents._handlers
    handlers['did-navigate-in-page']({}, 'http://localhost:5174/index.html?mp-home-shell=1#/publish?tab=1')
    expect(wm._tabStates.get(tabId).spaRoute).toBe('/publish')
    const active = wm.getActiveTab()
    expect(active.homeShell).toBe(true)
    expect(active.spaRoute).toBe('/publish')
    const all = wm.getAllTabs().find((t) => t.tabId === tabId)
    expect(all.homeShell).toBe(true)
    expect(all.spaRoute).toBe('/publish')
  })

  it('home-shell 壳态自然结束（文档级导航去外站）：清空 spaRoute 并解除 homeShell', () => {
    const { wm, tabId, view } = createHomeShellTab()
    const handlers = view.webContents._handlers
    handlers['did-navigate']({}, 'https://www.baidu.com/')
    const state = wm._tabStates.get(tabId)
    expect(state.homeShell).toBe(false)
    expect(state.spaRoute).toBe('')
    expect(wm.getActiveTab().homeShell).toBe(false)
  })
})

describe('page-manager 事件订阅按 subscriberId 精确删除', () => {
  function register () {
    const wm = new WebviewManager()
    wm.mainWindow = createMainWindow()
    const map = new Map()
    wm.registerIpcHandlers({ handle: (channel, fn) => map.set(channel, fn) })
    const call = (channel, arg, event) => map.get(channel)(event || {}, arg)
    return { wm, call }
  }

  // 模拟一个渲染进程 webContents：可注册 once 监听并由测试触发销毁
  function createSender () {
    const handlers = {}
    return {
      isDestroyed: () => false,
      once: (ev, cb) => { handlers[ev] = cb },
      fire: (ev) => { if (handlers[ev]) handlers[ev]() }
    }
  }

  async function subscribe (call, sender) {
    // 生产环境 event.sender 必然存在（缺失即被拒绝），未显式传入时给一个独立 sender
    const res = await call('page-manager:subscribe-events', undefined, { sender: sender || createSender() })
    return res && res.data && res.data.subscriberId
  }

  it('subscribe-events 回传 subscriberId 供渲染层注销时使用', async () => {
    const { call } = register()
    expect(typeof await subscribe(call)).toBe('string')
  })

  it('实例 A 按自己的 id 注销后，实例 B 仍能收到标签广播', async () => {
    const { wm, call } = register()
    const idA = await subscribe(call)
    const idB = await subscribe(call)
    // 显式断言 id 互不相同：原实现 'default-' + Date.now() 在同一毫秒会撞成同一个，
    // 只靠 Set 去重后的 size 判定会让断言成败依赖平台定时器精度。
    expect(idA).not.toBe(idB)
    expect(wm._subscribers.size).toBe(2)

    await call('page-manager:unsubscribe-events', { subscriberId: idA })
    expect(wm._subscribers.has(idA)).toBe(false)
    expect(wm._subscribers.has(idB)).toBe(true)

    wm._broadcast('tab-created', { tabId: 'auth-login', isLogin: true })
    const sends = wm.mainWindow.webContents.send.mock.calls.map((c) => c[1].subscriberId)
    expect(sends).toEqual([idB])
  })

  it('缺失 subscriberId 的注销不得清空其他实例的订阅（多 SPA 实例共存回归锁）', async () => {
    const { wm, call } = register()
    const idA = await subscribe(call)
    const idB = await subscribe(call)

    await call('page-manager:unsubscribe-events', {})

    expect(Array.from(wm._subscribers)).toEqual([idA, idB])
    wm._broadcast('tab-switched', { tabId: 'auth-login', isLogin: true })
    expect(wm.mainWindow.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('渲染进程销毁时回收该实例订阅，其他实例订阅存活（禁止全清后的回收路径）', async () => {
    const { wm, call } = register()
    const senderA = createSender()
    const senderB = createSender()
    const idA = await subscribe(call, senderA)
    const idB = await subscribe(call, senderB)
    expect(wm._subscribers.size).toBe(2)

    senderA.fire('destroyed')

    expect(wm._subscribers.has(idA)).toBe(false)
    expect(wm._subscribers.has(idB)).toBe(true)
  })

  it('订阅 id 由服务方生成，调用方传入的值不得被采信（唯一性不可绕过）', async () => {
    const { wm, call } = register()
    const res = await call('page-manager:subscribe-events', { subscriberId: 'caller-supplied' }, { sender: createSender() })
    expect(res.code).toBe(0)
    expect(res.data.subscriberId).not.toBe('caller-supplied')
    expect(Array.from(wm._subscribers)).toEqual([res.data.subscriberId])
  })

  it('sender 已销毁时拒绝订阅，不留下无人回收的条目', async () => {
    const { wm, call } = register()
    const dead = createSender()
    dead.isDestroyed = () => true
    const res = await call('page-manager:subscribe-events', undefined, { sender: dead })
    expect(res.code).not.toBe(0)
    expect(wm._subscribers.size).toBe(0)
    expect(wm._senderSubscribers.size).toBe(0)
  })

  it('注销后该 id 从 sender 记账集合中一并剪除', async () => {
    const { wm, call } = register()
    const sender = createSender()
    const id = await subscribe(call, sender)
    await call('page-manager:unsubscribe-events', { subscriberId: id })
    expect(wm._subscribers.has(id)).toBe(false)
    expect(wm._senderSubscribers.get(sender).has(id)).toBe(false)
  })
})
