import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

__enableElectronMock()

let AuthViewManager

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  __resetElectronMock()
  const module = await import('./auth-view-manager.js')
  AuthViewManager = module.default || module
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function createView(cookies = [], localStorage = {}, indexedDB = {}) {
  return {
    setBounds: vi.fn(),
    webContents: {
      session: { cookies: { get: vi.fn().mockResolvedValue(cookies) } },
      executeJavaScript: vi.fn(script => {
        if (script.includes('getIndexedDB')) return Promise.resolve(indexedDB)
        if (script.includes('getLocalStorage')) return Promise.resolve(localStorage)
        if (script.includes('accountInfoCollector')) return Promise.resolve({ nickName: '微信号甲', avatar: 'https://cdn/wx.png' })
        return Promise.resolve('测试账号')
      }),
      close: vi.fn(),
    },
  }
}

function createMainWindow() {
  return {
    getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    // 客户区尺寸（真实 BrowserWindow 会扣除标题栏/菜单栏/边框）
    getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('AuthViewManager 凭证边界', () => {
  it('恶意外部 URL 不能触发登录完成提取', async () => {
    const manager = new AuthViewManager()
    manager.currentPlatform = 'wechat_mp'
    manager.currentView = createView()
    manager._resolveLogin = vi.fn()
    const extract = vi.spyOn(manager, '_extractAuthData')

    manager._checkLoginCompleted('https://evil.example/?next=mp.weixin.qq.com/cgi-bin/home')
    await vi.advanceTimersByTimeAsync(3500)

    expect(extract).not.toHaveBeenCalled()
    expect(manager._resolveLogin).not.toHaveBeenCalled()
  })

  // 2026-09-25 回归：快手登录页在 passport.kuaishou.com，登录成功后回落到
  // cp.kuaishou.com/profile —— 与未登录时被前端路由到的地址完全相同。
  // 仅凭 URL 判定会让视图刚打开就自动关闭并把登录页的埋点 Cookie 存成有效账号。
  it('快手登录页 Cookie 不能构成登录完成（URL 命中但缺会话标记）', async () => {
    const anonymous = ['did', 'wid', 'kwssectoken', 'kwpsecproductname', 'kwfv1', 'kwscode']
      .map(name => ({ name, value: 'anon', domain: '.kuaishou.com' }))
    const manager = new AuthViewManager()
    manager.mainWindow = createMainWindow()
    manager.currentPlatform = 'kuaishou'
    manager.currentView = createView(anonymous)
    manager._resolveLogin = vi.fn()
    const close = vi.spyOn(manager, 'close')

    manager._checkLoginCompleted('https://cp.kuaishou.com/profile')
    await vi.advanceTimersByTimeAsync(3500)

    expect(manager._resolveLogin).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('快手命中会话票据后才结束登录并回传凭证', async () => {
    const manager = new AuthViewManager()
    manager.mainWindow = createMainWindow()
    manager.currentPlatform = 'kuaishou'
    const cookies = [
      { name: 'did', value: 'anon', domain: '.kuaishou.com' },
      { name: 'kuaishou.web.cp.api_st', value: 'ST-1', domain: '.kuaishou.com' },
    ]
    manager.currentView = createView(cookies)
    // _settleLogin 会先把 this._resolveLogin 置空再调用，必须自持引用才能断言
    const resolveLogin = vi.fn()
    manager._resolveLogin = resolveLogin

    manager._checkLoginCompleted('https://cp.kuaishou.com/profile')
    await vi.advanceTimersByTimeAsync(3500)

    expect(resolveLogin).toHaveBeenCalledTimes(1)
    expect(resolveLogin.mock.calls[0][0].cookies).toEqual(cookies)
  })

  it('用户确认完成登录时，缺会话标记必须报错而不是入库', async () => {
    const manager = new AuthViewManager()
    manager.mainWindow = createMainWindow()
    manager.currentPlatform = 'kuaishou'
    manager.currentView = createView([{ name: 'did', value: 'anon', domain: '.kuaishou.com' }])
    manager._resolveLogin = vi.fn()

    await expect(manager.completeLogin()).rejects.toThrow('未检测到登录凭证')
    expect(manager._resolveLogin).not.toHaveBeenCalled()
  })

  it('只提取当前平台域名范围内的 Cookie', async () => {
    const manager = new AuthViewManager()
    const view = createView([
      { name: 'valid', value: '1', domain: '.mp.weixin.qq.com' },
      { name: 'invalid', value: '2', domain: '.evil.example' },
    ], {}, { auth: { token: 'indexed-token', ignored: () => 'not-json' } })

    await expect(manager._extractAuthData(view, 'wechat_mp')).resolves.toEqual({
      cookies: [{ name: 'valid', value: '1', domain: '.mp.weixin.qq.com' }],
      name: '测试账号',
      localStorage: {},
      indexedDB: { auth: { token: 'indexed-token' } },
      // 登录入口必须随凭证一起产出账号资料：这是昵称/头像唯一的写入时机（PRD-ACCOUNT-PROFILE-INFO）
      accountInfo: { nickName: '微信号甲', avatar: 'https://cdn/wx.png' },
    })
  })

  it('窗口 resize 时重新定位当前登录视图（回归 _onWindowResize 缺失崩溃）', () => {
    const manager = new AuthViewManager()
    const view = createView()
    const mainWindow = createMainWindow()
    manager.mainWindow = mainWindow
    manager.currentView = view
    const position = vi.spyOn(manager, '_positionView')

    expect(() => manager._onWindowResize()).not.toThrow()
    expect(position).toHaveBeenCalledWith()
  })

  it('无当前视图时 _onWindowResize 不抛异常', () => {
    const manager = new AuthViewManager()
    manager.mainWindow = createMainWindow()

    expect(() => manager._onWindowResize()).not.toThrow()
  })

  it('用户确认完成登录后由主进程提取凭证并结束当前会话', async () => {
    const manager = new AuthViewManager()
    const view = createView([{ name: 'session', value: '1', domain: '.mp.weixin.qq.com' }])
    const resolveLogin = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = view
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-1'
    manager._resolveLogin = resolveLogin

    await expect(manager.completeLogin()).resolves.toBe(true)

    expect(resolveLogin).toHaveBeenCalledWith({
      cookies: [{ name: 'session', value: '1', domain: '.mp.weixin.qq.com' }],
      name: '测试账号',
      localStorage: {},
      indexedDB: {},
      // 登录成功必须随凭证一起产出账号资料（昵称/头像唯一写入时机，PRD-ACCOUNT-PROFILE-INFO）
      accountInfo: { nickName: '微信号甲', avatar: 'https://cdn/wx.png' },
    })
    expect(manager.currentView).toBeNull()
    expect(manager.mainWindow.webContents.send).toHaveBeenCalledWith('auth:view-closed')
  })

  it('只有 localStorage 凭证的平台也能完成登录', async () => {
    const manager = new AuthViewManager()
    const view = createView([], { accessToken: 'token-value' })
    const resolveLogin = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = view
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-storage'
    manager._resolveLogin = resolveLogin

    await expect(manager.completeLogin()).resolves.toBe(true)
    expect(resolveLogin).toHaveBeenCalledWith({
      cookies: [],
      name: '测试账号',
      localStorage: { accessToken: 'token-value' },
      indexedDB: {},
      accountInfo: { nickName: '微信号甲', avatar: 'https://cdn/wx.png' },
    })
  })

  it('只有 IndexedDB 登录态时也能确认并保存 JSON 安全快照', async () => {
    const manager = new AuthViewManager()
    const view = createView([], {}, { auth: { refreshToken: 'indexed-only' } })
    const resolveLogin = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = view
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-indexed-db'
    manager._resolveLogin = resolveLogin

    await expect(manager.completeLogin()).resolves.toBe(true)
    expect(resolveLogin).toHaveBeenCalledWith({
      cookies: [],
      name: '测试账号',
      localStorage: {},
      indexedDB: { auth: { refreshToken: 'indexed-only' } },
      accountInfo: { nickName: '微信号甲', avatar: 'https://cdn/wx.png' },
    })
  })

  it('并发确认同一登录会话时只完成一次', async () => {
    const manager = new AuthViewManager()
    const deferred = createDeferred()
    const view = createView([{ name: 'session', value: '1', domain: '.mp.weixin.qq.com' }])
    const resolveLogin = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = view
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-1'
    manager._resolveLogin = resolveLogin
    vi.spyOn(manager, '_extractAuthData').mockReturnValue(deferred.promise)

    const first = manager.completeLogin()
    const second = manager.completeLogin()
    deferred.resolve({
      cookies: [{ name: 'session', value: '1', domain: '.mp.weixin.qq.com' }],
      name: '测试账号',
    })

    const results = await Promise.allSettled([first, second])
    // 新行为：第二个 completeLogin() 检测到会话已结束，静默返回 true
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(resolveLogin).toHaveBeenCalledTimes(1)
  })

  it('重复成功导航只安排一次凭证提取', async () => {
    const manager = new AuthViewManager()
    const view = createView()
    manager.mainWindow = createMainWindow()
    manager.currentView = view
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-1'
    manager._resolveLogin = vi.fn()
    const extract = vi.spyOn(manager, '_extractAuthData').mockResolvedValue({ cookies: [], name: '' })

    const successUrl = 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index'
    manager._checkLoginCompleted(successUrl)
    manager._checkLoginCompleted(successUrl)
    await vi.advanceTimersByTimeAsync(3000)

    expect(extract).toHaveBeenCalledTimes(1)
  })

  it('自动完成未提取到凭据时保持登录视图可继续操作', async () => {
    const manager = new AuthViewManager()
    const view = createView()
    const resolveLogin = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = view
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-empty'
    manager._resolveLogin = resolveLogin

    manager._checkLoginCompleted('https://mp.weixin.qq.com/cgi-bin/home?t=home/index')
    await vi.advanceTimersByTimeAsync(3500)

    expect(resolveLogin).not.toHaveBeenCalled()
    expect(manager.currentView).toBe(view)
    expect(manager._autoCompletionAttemptId).toBeNull()
  })

  it('自动完成可接受仅由 IndexedDB 保存的登录态', async () => {
    const manager = new AuthViewManager()
    const view = createView([], {}, { auth: { refreshToken: 'indexed-only' } })
    const resolveLogin = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = view
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-indexed-auto'
    manager._resolveLogin = resolveLogin

    manager._checkLoginCompleted('https://mp.weixin.qq.com/cgi-bin/home?t=home/index')
    await vi.advanceTimersByTimeAsync(3500)

    expect(resolveLogin).toHaveBeenCalledWith(expect.objectContaining({
      cookies: [],
      localStorage: {},
      indexedDB: { auth: { refreshToken: 'indexed-only' } },
    }))
  })

  it('初始加载完成前的导航（登录页自身重定向链）不会触发登录完成提取', async () => {
    const manager = new AuthViewManager()
    const resolveLogin = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = createView([{ name: 'pre', value: '1', domain: '.mp.weixin.qq.com' }])
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-redirect'
    manager._resolveLogin = resolveLogin
    const attempt = manager._getLoginAttempt()
    expect(attempt.initialRedirectPhase).toBe(true)
    const extract = vi.spyOn(manager, '_extractAuthData')

    // 初始重定向链：即使 URL 命中成功模式也不得安排提取
    manager._handleNavigation('https://mp.weixin.qq.com/cgi-bin/home?t=home/index', attempt)
    await vi.advanceTimersByTimeAsync(3500)

    expect(extract).not.toHaveBeenCalled()
    expect(resolveLogin).not.toHaveBeenCalled()
    expect(manager.currentView).not.toBeNull()

    // 页面加载完成后，成功导航才可能触发自动完成
    attempt.initialRedirectPhase = false
    manager._handleNavigation('https://mp.weixin.qq.com/cgi-bin/home?t=home/index', attempt)
    await vi.advanceTimersByTimeAsync(3500)

    expect(extract).toHaveBeenCalledTimes(1)
    expect(resolveLogin).toHaveBeenCalledTimes(1)
  })

  it('openLogin 接线：did-finish-load 前的导航被忽略，加载完成后才放行自动完成', async () => {
    // auth-view-manager.js 顶层已解构 WebContentsView，必须在模块加载前覆盖 mock
    vi.resetModules()
    __resetElectronMock()
    const handlers = {}
    const view = {
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        session: { cookies: { get: vi.fn().mockResolvedValue([{ name: 'session', value: '1', domain: '.mp.weixin.qq.com' }]) } },
        loadURL: vi.fn().mockResolvedValue(undefined),
        executeJavaScript: vi.fn().mockResolvedValue({}),
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
        getBackgroundThrottling: vi.fn(() => true),
        on: vi.fn((event, callback) => { handlers[event] = callback }),
        debugger: { attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn().mockResolvedValue({}), on: vi.fn() },
      },
    }
    __electronMock.WebContentsView = vi.fn(function () { return view })

    const freshModule = await import('./auth-view-manager.js')
    const FreshAuthViewManager = freshModule.default || freshModule
    const manager = new FreshAuthViewManager()
    const mainWindow = createMainWindow()
    manager.setMainWindow(mainWindow)
    const loginPromise = manager.openLogin('wechat_mp', 0)

    // 初始加载完成前：即使 URL 命中成功模式也不得安排提取（登录页自身重定向链）
    handlers['did-navigate']({}, 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index')
    await vi.advanceTimersByTimeAsync(3500)
    expect(manager._resolveLogin).toBeTruthy()
    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('auth:view-closed', expect.anything())

    // 页面加载完成后：成功导航才触发自动完成并关闭登录视图
    handlers['did-finish-load']()
    handlers['did-navigate']({}, 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index')
    await vi.advanceTimersByTimeAsync(3500)

    await expect(loginPromise).resolves.toMatchObject({
      cookies: [{ name: 'session', value: '1', domain: '.mp.weixin.qq.com' }],
    })
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('auth:view-closed')
  })

  it('百家号登录页 URL 即使存在预登录 Cookie 也不自动完成（回归：登录视图提前关闭）', async () => {
    const manager = new AuthViewManager()
    const view = createView([{ name: 'BAIDUID', value: 'pre-login-tracker', domain: '.baijiahao.baidu.com' }])
    const resolveLogin = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = view
    manager.currentPlatform = 'baijiahao'
    manager.currentAccountId = 'auth-baijiahao-1'
    manager._resolveLogin = resolveLogin

    // 未登录时百家号主页会落在 /builder/theme/bjh/login（与创作后台同域）
    manager._checkLoginCompleted('https://baijiahao.baidu.com/builder/theme/bjh/login')
    await vi.advanceTimersByTimeAsync(3500)

    expect(resolveLogin).not.toHaveBeenCalled()
    expect(manager.currentView).toBe(view)
    expect(manager._urlExtractTimer).toBeFalsy()
  })

  it('旧会话已开始的异步提取不能完成后续新会话', async () => {
    const manager = new AuthViewManager()
    const deferred = createDeferred()
    const oldView = createView()
    const oldResolve = vi.fn()
    manager.mainWindow = createMainWindow()
    manager.currentView = oldView
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-old'
    manager._resolveLogin = oldResolve
    const extract = vi.spyOn(manager, '_extractAuthData').mockReturnValue(deferred.promise)

    manager._checkLoginCompleted('https://mp.weixin.qq.com/cgi-bin/home?t=home/index')
    vi.advanceTimersByTime(3000)
    expect(extract).toHaveBeenCalledWith(oldView, 'wechat_mp')

    manager.close()
    const newView = createView()
    const newResolve = vi.fn()
    manager.currentView = newView
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-new'
    manager._resolveLogin = newResolve

    deferred.resolve({
      cookies: [{ name: 'old-session', value: '1', domain: '.mp.weixin.qq.com' }],
      name: '旧账号',
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(oldResolve).toHaveBeenCalledOnce()
    expect(oldResolve).toHaveBeenCalledWith({ cancelled: true })
    expect(newResolve).not.toHaveBeenCalled()
    expect(manager.currentView).toBe(newView)
  })

  it('旧视图迟到的成功事件不能替新会话安排凭证提取', async () => {
    const manager = new AuthViewManager()
    manager.mainWindow = createMainWindow()
    manager.currentView = createView()
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-old'
    manager._resolveLogin = vi.fn()
    const oldAttempt = manager._getLoginAttempt()

    manager.close()
    manager.currentView = createView()
    manager.currentPlatform = 'wechat_mp'
    manager.currentAccountId = 'auth-wechat_mp-new'
    manager._resolveLogin = vi.fn()
    manager._getLoginAttempt()
    const extract = vi.spyOn(manager, '_extractAuthData')

    manager._checkLoginCompleted(
      'https://mp.weixin.qq.com/cgi-bin/home?t=home/index',
      oldAttempt,
    )
    manager._scheduleAutoCompletion('cdp', oldAttempt)
    await vi.advanceTimersByTimeAsync(3500)

    expect(extract).not.toHaveBeenCalled()
    expect(manager._urlExtractTimer).toBeFalsy()
    expect(manager._cdpExtractTimer).toBeFalsy()
  })

  it('没有活动登录页时完成登录静默返回成功', async () => {
    const manager = new AuthViewManager()
    // 新行为：CDP 自动检测可能已保存凭证并关闭会话，completeLogin 检测到后静默返回 true
    const result = await manager.completeLogin()
    expect(result).toBe(true)
  })

  it('登录视图全屏布局（TabBar+NavBar 下方），基于客户区尺寸而非窗口外框', () => {
    const manager = new AuthViewManager()
    const setBounds = vi.fn()
    manager.currentView = { setBounds }
    // 外框 1440x900 vs 客户区 1424x861：若误用外框会得到 1240x824，
    // 视图右侧滚动条与底部内容会被窗口边框裁掉（2026-09-13 Bug 回归点）。
    manager.mainWindow = createMainWindow()

    manager._positionView()
    expect(setBounds).toHaveBeenLastCalledWith({ x: 200, y: 76, width: 1224, height: 785 })
  })

  it('show()/hide() 切换视图可见性', () => {
    const manager = new AuthViewManager()
    const setVisible = vi.fn()
    manager.currentView = { setVisible, setBounds: vi.fn() }

    manager.hide()
    expect(setVisible).toHaveBeenCalledWith(false)

    manager.show()
    expect(setVisible).toHaveBeenCalledWith(true)
  })

  it('无视图时 show()/hide() 不抛异常', () => {
    const manager = new AuthViewManager()
    expect(() => manager.show()).not.toThrow()
    expect(() => manager.hide()).not.toThrow()
  })

  it('onOpened 回调在设置后通过钩子触发', () => {
    const manager = new AuthViewManager()
    const spy = vi.fn()
    manager.onOpened = spy

    manager._fireOpened({ platform: 'douyin', accountId: 'auth-douyin-1', url: 'https://creator.douyin.com/' })
    expect(spy).toHaveBeenCalledWith({ platform: 'douyin', accountId: 'auth-douyin-1', url: 'https://creator.douyin.com/' })
  })

  it('onClosed 回调在 close() 时触发', () => {
    const manager = new AuthViewManager()
    const spy = vi.fn()
    manager.onClosed = spy
    manager.mainWindow = createMainWindow()
    manager.currentView = createView()
    manager.currentPlatform = 'douyin'

    manager.close()
    expect(spy).toHaveBeenCalled()
  })

  it('未设置回调时 _fireOpened/_fireClosed 不抛异常', () => {
    const manager = new AuthViewManager()
    expect(() => manager._fireOpened({ platform: 'douyin' })).not.toThrow()
    expect(() => manager._fireClosed()).not.toThrow()
  })
})

describe('AuthViewManager 登录页承载方式（回归：主窗口顶部多层内容重叠）', () => {
  it('openLogin 内嵌登录视图到主窗口（参照参考产品 isAuth 模式，不再使用独立窗口）', async () => {
    const manager = new AuthViewManager()
    const mainWindow = createMainWindow()
    manager.setMainWindow(mainWindow)

    const loginPromise = manager.openLogin('wechat_mp', 0).catch(() => {})

    // 核心回归点：登录视图必须挂到主窗口 contentView（内嵌全屏标签模式）。
    // 参照参考产品 isAuth 模式：认证就是普通标签，不需要独立窗口。
    // 重叠问题由 App.vue isLoginTab 时隐藏 router-view 解决。
    expect(mainWindow.contentView.addChildView).toHaveBeenCalled()
    expect(manager.currentView).toBeTruthy()

    manager.close()
    await loginPromise
  })

  it('登录视图内嵌主窗口时定位到 TabBar+NavBar 下方（和浏览器标签定位一致）', async () => {
    const manager = new AuthViewManager()
    // 设置 SIDEBAR_WIDTH=200（_positionView 默认），主窗口 1200×800
    const mainWindow = createMainWindow()
    manager.setMainWindow(mainWindow)

    const loginPromise = manager.openLogin('wechat_mp', 0).catch(() => {})

    const view = manager.currentView
    expect(view).toBeTruthy()
    expect(view.setVisible).toHaveBeenCalledWith(true)
    // 内嵌定位应与浏览器标签一致：x=sidebar(200), y=76
    const bounds = view.setBounds.mock.calls.at(-1)?.[0]
    expect(bounds).toBeTruthy()
    expect(bounds.x).toBe(200)
    expect(bounds.y).toBe(76)

    manager.close()
    await loginPromise
  })

  it('close() 从主窗口移除认证视图并清理资源', async () => {
    const manager = new AuthViewManager()
    manager.setMainWindow(createMainWindow())

    const loginPromise = manager.openLogin('wechat_mp', 0).catch(() => {})
    const view = manager.currentView
    expect(view).toBeTruthy()

    manager.close()

    // 视图已从主窗口移除并关闭
    expect(manager.currentView).toBeNull()
    // 清理字段重置
    expect(manager._loginWindowResizeCleanup).toBeNull()
    expect(manager._syncLoginViewBounds).toBeNull()
    // 平台信息已清空
    expect(manager.currentPlatform).toBeNull()

    await loginPromise
  })
})

// 「添加账号 → 公众号」走 openLogin，分区是每次全新的 persist:auth-*，
// 而 iframe 内的二维码请求不触发外层 did-fail-load —— 该路径此前零日志，
// 用户报「二维码刷很久」时主进程无从归因（#1887 §7 把 auth 挂接列为未做项）。
describe('AuthViewManager 登录视图可观测性（回归：persist:auth-* 分区此前零日志）', () => {
  const QR_FILTERS = {
    urls: [
      '*://*.weixin.qq.com/*',
      '*://*.wx.qq.com/*',
      '*://weixin.qq.com/*',
      '*://wx.qq.com/*'
    ]
  }

  let originalFromPartition
  let originalWebContentsView

  beforeEach(() => {
    originalFromPartition = __electronMock.session.fromPartition
    originalWebContentsView = __electronMock.WebContentsView
  })

  afterEach(() => {
    __electronMock.session.fromPartition = originalFromPartition
    __electronMock.WebContentsView = originalWebContentsView
  })

  // 登录视图的 session 必须是可断言的 spy 容器：诊断监听到底有没有挂上，只有这里能证明
  function wireView () {
    const handlers = {}
    const diagSession = {
      cookies: { get: vi.fn().mockResolvedValue([]) },
      webRequest: { onErrorOccurred: vi.fn(), onCompleted: vi.fn() },
      resolveProxy: vi.fn().mockResolvedValue('DIRECT'),
    }
    __electronMock.session.fromPartition = vi.fn(function () { return diagSession })
    // drawn 跟随 setVisible 变化：真实 Electron 上 getVisible() 反映的正是 setVisible 的结果，
    // 若夹具写成常量，"出码窗口落在未绘制时段"这条判据就永远测不到。
    let drawn = true
    const view = {
      setBounds: vi.fn(),
      setVisible: vi.fn(function (v) { drawn = v }),
      getVisible: vi.fn(function () { return drawn }),
      webContents: {
        session: diagSession,
        loadURL: vi.fn().mockResolvedValue(undefined),
        executeJavaScript: vi.fn().mockResolvedValue({}),
        close: vi.fn(),
        isDestroyed: vi.fn(() => false),
        getBackgroundThrottling: vi.fn(() => true),
        on: vi.fn(function (evt, cb) { handlers[evt] = cb; return this }),
        once: vi.fn(function () { return this }),
        debugger: { attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn().mockResolvedValue({}), on: vi.fn() },
      },
    }
    __electronMock.WebContentsView = vi.fn(function () { return view })
    return { view, handlers, diagSession }
  }

  // logger 必须在 wireView/import 之后取：文件级 beforeEach 做过 vi.resetModules()，
  // 提前 require 拿到的是旧实例，spy 会静默失效并让断言恒真。
  function spyLogInfo () {
    const log = require('./logger')
    return vi.spyOn(log, 'info').mockImplementation(function () {})
  }

  function openLogin () {
    const manager = new AuthViewManager()
    manager.setMainWindow(createMainWindow())
    const pending = manager.openLogin('wechat_mp', 0).catch(function () {})
    return { manager, pending }
  }

  it('openLogin 给登录视图分区挂上会话级诊断（补齐 iframe 二维码请求盲区）', async () => {
    const { diagSession } = wireView()
    const { manager, pending } = openLogin()

    expect(diagSession.webRequest.onCompleted).toHaveBeenCalledTimes(1)
    expect(diagSession.webRequest.onCompleted.mock.calls[0][0]).toEqual(QR_FILTERS)
    expect(diagSession.webRequest.onErrorOccurred).toHaveBeenCalledTimes(1)
    expect(diagSession.webRequest.onErrorOccurred.mock.calls[0][0]).toEqual(QR_FILTERS)

    manager.close()
    await pending
  })

  it('did-finish-load 记录相对 loadURL 的耗时与绘制/节流状态（首屏迟到归因入口）', async () => {
    const { handlers } = wireView()
    const log = spyLogInfo()
    const { manager, pending } = openLogin()

    handlers['did-finish-load']()

    expect(log).toHaveBeenCalledWith('AuthView', expect.stringMatching(
      /^login page finished after \d+ms platform=wechat_mp drawn=true bgThrottle=true$/))

    manager.close()
    await pending
  })

  it('hide()/show() 记录绘制与节流状态，用于判断出码窗口是否落在被节流时段', async () => {
    const { view } = wireView()
    const log = spyLogInfo()
    const { manager, pending } = openLogin()

    manager.hide()
    expect(log).toHaveBeenCalledWith('AuthView',
      'login view setVisible=false platform=wechat_mp drawn=false bgThrottle=true')

    view.webContents.getBackgroundThrottling = vi.fn(() => false)
    manager.show()
    expect(log).toHaveBeenCalledWith('AuthView',
      'login view setVisible=true platform=wechat_mp drawn=true bgThrottle=false')

    manager.close()
    await pending
  })

  // 上一版这里读 view.webContents.getVisibilityState()，而 Electron 43.1.1 的 d.ts 里
  // 压根没有 VisibilityState 这个类型（真机日志恒为 visibility=unknown），
  // 单测却因手搓夹具把这个字段补上了而全绿 —— 与 #2398 的 app.userAgent 同源。
  // 这三条锁把「探针读的必须是宿主真有的字段」变成机器可判定的事。
  describe('AuthViewManager 宿主 API 归属契约锁（防再犯死 API 探针）', () => {
    const fs = require('fs')
    const path = require('path')

    function readSource () {
      return fs.readFileSync(path.join(__dirname, 'auth-view-manager.js'), 'utf8')
    }

    // 逐级上溯找 electron.d.ts：本仓 node-linker=hoisted，electron 装在 worktree 根，
    // 从 __dirname 数 `..` 的层数在不同布局（hoisted / isolated / CI）下会指错，
    // 一旦指错就变成「静默跳过」的装饰性锁。
    function findDts () {
      let dir = __dirname
      for (let i = 0; i < 8; i += 1) {
        const cand = path.join(dir, 'node_modules', 'electron', 'electron.d.ts')
        if (fs.existsSync(cand)) return cand
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
      }
      return null
    }

    function readClassBlock (name) {
      const dts = findDts()
      if (dts === null) return null
      const body = fs.readFileSync(dts, 'utf8')
      const start = body.indexOf('class ' + name + ' extends')
      if (start < 0) return null
      const end = body.indexOf('\n  }', start)
      return body.slice(start, end < 0 ? body.length : end)
    }

    // 依赖装齐是本锁的前提，不是跳过理由：跑得起 vitest 就跑得起这条断言。
    function requireBlocks (...names) {
      const missing = names.filter(n => readClassBlock(n) === null)
      expect(
        missing,
        'electron.d.ts 未找到或解析失败 —— 宿主 API 归属锁禁止静默跳过（missing: ' + missing.join(',') + '）'
      ).toEqual([])
      return names
    }

    it('真实 electron.d.ts 上我们用到的字段确实存在（解析失败必须红，不得跳过）', () => {
      requireBlocks('WebContents', 'View', 'WebContentsView')
      const wc = readClassBlock('WebContents')
      const view = readClassBlock('View')
      expect(wc).toMatch(/^\s{4}getBackgroundThrottling\(\): boolean;$/m)
      expect(view).toMatch(/^\s{4}getVisible\(\): boolean;$/m)
      expect(readClassBlock('WebContentsView')).toMatch(/class WebContentsView extends View/)
      // 反面：读过的死字段必须确认宿主真没有，否则这条锁形同虚设
      expect(wc).not.toMatch(/getVisibilityState/)
    })

    it('源码不再出现 getVisibilityState 这类宿主不存在的可见性字段', () => {
      expect(readSource()).not.toMatch(/getVisibilityState|VisibilityState/)
    })

    it('源码里对 webContents 的方法调用必须都在 electron.d.ts 的 WebContents 上声明', () => {
      requireBlocks('WebContents')
      const members = readClassBlock('WebContents')
      const declared = new Set(
        [...members.matchAll(/^\s{4}([a-zA-Z][A-Za-z0-9_]*)\(/gm)].map(m => m[1])
      )
      // 下界：解析退化成空集合时，本锁会「全都不违规」而假绿；先证明声明集是真的
      expect(declared.size, 'WebContents 声明集异常小，d.ts 解析疑似退化').toBeGreaterThan(100)
      const used = [...readSource().matchAll(/\.webContents\.([a-zA-Z][A-Za-z0-9_]*)\(/g)].map(m => m[1])
      expect(used.length).toBeGreaterThan(0)
      const undeclared = [...new Set(used)].filter(name => !declared.has(name))
      expect(undeclared).toEqual([])
    })
  })

  // 节流取值必须"显式声明"：留默认等于没写理由 —— 上一轮就是留默认导致真机恒 bgThrottle=true。
  describe('登录承载路径 backgroundThrottling 显式声明锁（四类承载同口径）', () => {
    const fsLock = require('fs')
    const pathLock = require('path')

    // 隐藏期承载（全程不被绘制）必须 false；可见期承载允许 true，但两者都必须写出来。
    const CARRIERS = [
      ['auth-view-session.js', true],
      ['qrcode-login.js', true],
      ['identity/identity-auth-window.js', false],
      ['auth-view-manager.js', false],
    ]

    function declOf (file) {
      const p = pathLock.join(__dirname, file)
      if (!fsLock.existsSync(p)) throw new Error('登录承载文件不存在：' + file)
      const lines = fsLock.readFileSync(p, 'utf8').split(/\r?\n/)
      for (const raw of lines) {
        const l = raw.trim()
        // 注释里的 backgroundThrottling:false 不算声明 —— 上一版就是被注释字样骗过
        if (l.startsWith('*') || l.startsWith('//') || l.startsWith('/*')) continue
        const m = l.match(/backgroundThrottling:\s*(true|false)/)
        if (m) return m[1] === 'false' ? false : true
      }
      return null
    }

    it('每个登录承载文件都必须显式声明 backgroundThrottling（留默认即视为未声明）', () => {
      const missing = CARRIERS.filter(([f]) => declOf(f) === null).map(([f]) => f)
      expect(missing, '以下登录承载路径未声明 backgroundThrottling').toEqual([])
    })

    it('隐藏期承载声明 false、可见期承载声明 true（分档即门禁口径）', () => {
      expect(declOf('identity/identity-auth-window.js')).toBe(false)
      expect(declOf('auth-view-manager.js')).toBe(false)
      expect(declOf('auth-view-session.js')).toBe(true)
      expect(declOf('qrcode-login.js')).toBe(true)
    })

    it('loginSilent 真的把 backgroundThrottling:false 传给了隐藏 BrowserWindow', () => {
      const electron = require('electron')
      const AuthViewManager = require('./auth-view-manager')
      const m = new AuthViewManager()
      const before = electron.BrowserWindow.mock.calls.length
      const pending = m.loginSilent('wechat_mp', [], {}, {})
      pending.catch(() => {}) // 内部 3s 兜底定时器不该阻塞断言
      const calls = electron.BrowserWindow.mock.calls
      expect(calls.length).toBeGreaterThan(before)
      const opts = calls[calls.length - 1][0]
      expect(opts.show).toBe(false)
      expect(opts.webPreferences.backgroundThrottling).toBe(false)
    })
  })

  it('诊断挂接失败不阻断登录流程（可观测性是旁路，不能变成新的故障点）', async () => {
    const { diagSession } = wireView()
    diagSession.webRequest.onErrorOccurred = vi.fn(function () { throw new Error('boom') })
    const log = spyLogInfo()
    const warnSpy = vi.spyOn(require('./logger'), 'warn').mockImplementation(function () {})
    const { manager, pending } = openLogin()

    expect(manager.currentView).toBeTruthy()
    expect(warnSpy).toHaveBeenCalledWith('AuthView', expect.stringContaining('boom'))

    manager.close()
    await pending
    log.mockRestore()
    warnSpy.mockRestore()
  })
})
