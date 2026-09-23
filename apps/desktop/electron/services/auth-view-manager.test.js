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
