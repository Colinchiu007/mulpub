function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('AuthService', () => {
  it('并发获取过期 Token 只执行一次刷新', async () => {
    const { AuthService } = require('./auth-service')
    const refreshStarted = deferred()
    const releaseRefresh = deferred()
    let refreshCount = 0
    const client = {
      isAuthenticated: async () => true,
      getAccessToken: async () => {
        refreshCount += 1
        refreshStarted.resolve()
        await releaseRefresh.promise
        return 'access-1'
      },
      getIdTokenClaims: async () => ({ sub: 'sub-1', name: 'Test' }),
      signIn: async () => {},
      signOut: async () => {},
      handleSignInCallback: async () => {},
    }
    const service = new AuthService({ client, tokenStorage: { load: async () => null, save: async () => {}, clear: async () => {} } })
    const first = service.getAccessToken()
    await refreshStarted.promise
    const second = service.getAccessToken()
    releaseRefresh.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual(['access-1', 'access-1'])
    expect(refreshCount).toBe(1)
  })

  it('刷新失败时清理本地会话并进入 signed_out', async () => {
    const { AuthService } = require('./auth-service')
    const cleared = []
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getAccessToken: async () => { throw Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' }) },
        signOut: async () => {},
      },
      tokenStorage: { load: async () => ({ refreshToken: 'old' }), save: async () => {}, clear: async () => cleared.push(true) },
    })
    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'IDENTITY_SESSION_EXPIRED' })
    expect(cleared).toEqual([true])
    expect(service.getState().status).toBe('signed_out')
  })

  it('服务端临时故障不会误删有效会话', async () => {
    const { AuthService } = require('./auth-service')
    const clear = vi.fn(async () => {})
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-1', exp: 300 }),
        getAccessToken: async () => { throw Object.assign(new Error('upstream 503'), { code: 'SERVICE_UNAVAILABLE' }) },
      },
      tokenStorage: { clear },
      resource: 'https://api.multi-publish.com',
      now: () => 200,
    })
    await service.restore()

    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'IDENTITY_TOKEN_UNAVAILABLE' })
    expect(clear).not.toHaveBeenCalled()
    expect(service.getState()).toMatchObject({
      status: 'error',
      user: { sub: 'sub-1' },
      error: { code: 'IDENTITY_TOKEN_UNAVAILABLE' },
    })
  })

  it('先启动回环服务，再执行 SDK 登录并处理 callback', async () => {
    const { AuthService } = require('./auth-service')
    const order = []
    const callbackServer = {
      start: async () => { order.push('start') },
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      stop: async () => { order.push('stop') },
    }
    const client = {
      prepareSignInState: async () => 'state-1234567890123456',
      signIn: async (options) => { order.push(`signIn:${options.redirectUri}`) },
      handleSignInCallback: async () => { order.push('callback') },
      getIdTokenClaims: async () => ({ sub: 'sub-1', name: '用户甲', email: 'secret@example.com' }),
    }
    const service = new AuthService({
      client,
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: (options) => {
        expect(options).toEqual({ expectedState: 'state-1234567890123456' })
        return callbackServer
      },
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    await expect(service.signIn()).resolves.toMatchObject({ status: 'authenticated', user: { sub: 'sub-1', name: '用户甲' } })
    expect(order).toEqual(['start', 'signIn:http://127.0.0.1:16526/auth/callback', 'callback', 'stop'])
    expect(service.getState().user).not.toHaveProperty('email')
  })

  it('点击登录后先弹出加载窗再执行 SDK 登录（openSignInWindow 早于 signIn）', async () => {
    const { AuthService } = require('./auth-service')
    const order = []
    const callbackServer = {
      start: async () => { order.push('start') },
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      stop: async () => { order.push('stop') },
    }
    const client = {
      prepareSignInState: async () => 'state-1234567890123456',
      openSignInWindow: async () => { order.push('openLoading') },
      signIn: async (options) => { order.push(`signIn:${options.redirectUri}`) },
      handleSignInCallback: async () => { order.push('callback') },
      getIdTokenClaims: async () => ({ sub: 'sub-1', name: '用户甲' }),
    }
    const service = new AuthService({
      client,
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    await expect(service.signIn()).resolves.toMatchObject({ status: 'authenticated' })
    expect(order).toEqual(['start', 'openLoading', 'signIn:http://127.0.0.1:16526/auth/callback', 'callback', 'stop'])
  })

  it('加载窗弹出失败不阻断登录主流程', async () => {
    const { AuthService } = require('./auth-service')
    const callbackServer = {
      start: vi.fn(async () => {}),
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      stop: vi.fn(async () => {}),
    }
    const client = {
      prepareSignInState: async () => 'state-1234567890123456',
      openSignInWindow: vi.fn(async () => { throw new Error('加载窗创建失败') }),
      signIn: vi.fn(async () => {}),
      handleSignInCallback: async () => {},
      getIdTokenClaims: async () => ({ sub: 'sub-1', name: '用户甲' }),
    }
    const service = new AuthService({
      client,
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    await expect(service.signIn()).resolves.toMatchObject({ status: 'authenticated' })
    expect(client.openSignInWindow).toHaveBeenCalledTimes(1)
    expect(client.signIn).toHaveBeenCalledTimes(1)
  })

  it('用户关闭独立认证窗口时立即取消登录并停止回调服务', async () => {
    const { AuthService } = require('./auth-service')
    let closeWindow
    const windowClosed = new Promise((resolve) => { closeWindow = resolve })
    const callbackServer = {
      start: vi.fn(async () => {}),
      waitForCallback: vi.fn(() => new Promise(() => {})),
      stop: vi.fn(async () => {}),
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: vi.fn(async () => {}),
        waitForSignInWindowClosed: () => windowClosed,
        closeSignInWindow: vi.fn(async () => {}),
      },
      tokenStorage: { clear: vi.fn(async () => {}) },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const signingIn = service.signIn()
    await Promise.resolve()
    closeWindow()
    await expect(signingIn).rejects.toMatchObject({ code: 'IDENTITY_SIGN_IN_CANCELLED' })
    expect(callbackServer.stop).toHaveBeenCalledTimes(1)
    expect(service.getState()).toMatchObject({ status: 'error', error: { code: 'IDENTITY_SIGN_IN_CANCELLED' } })
  })

  it('应用释放身份服务时主动关闭仍打开的认证窗口', async () => {
    const { AuthService } = require('./auth-service')
    let closeWindow
    const windowClosed = new Promise((resolve) => { closeWindow = resolve })
    const callbackServer = {
      start: vi.fn(async () => {}),
      waitForCallback: vi.fn(() => new Promise(() => {})),
      cancel: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    }
    const closeSignInWindow = vi.fn(async () => { closeWindow() })
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: vi.fn(async () => {}),
        waitForSignInWindowClosed: () => windowClosed,
        closeSignInWindow,
      },
      tokenStorage: { clear: vi.fn(async () => {}) },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const signingIn = service.signIn()
    await Promise.resolve()
    await service.dispose()

    expect(callbackServer.cancel).toHaveBeenCalledTimes(1)
    expect(closeSignInWindow).toHaveBeenCalled()
    await expect(signingIn).rejects.toMatchObject({ code: 'IDENTITY_SIGN_IN_CANCELLED' })
    expect(callbackServer.stop).toHaveBeenCalledTimes(1)
  })

  it('应用释放身份服务会等待登录窗口和回调服务停止', async () => {
    const { AuthService } = require('./auth-service')
    const stopStarted = deferred()
    const releaseStop = deferred()
    let closeWindow
    const windowClosed = new Promise((resolve) => { closeWindow = resolve })
    const callbackServer = {
      start: vi.fn(async () => {}),
      waitForCallback: vi.fn(() => new Promise(() => {})),
      cancel: vi.fn(async () => {}),
      stop: vi.fn(async () => {
        stopStarted.resolve()
        await releaseStop.promise
      }),
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: vi.fn(async () => {}),
        waitForSignInWindowClosed: () => windowClosed,
        closeSignInWindow: vi.fn(async () => { closeWindow() }),
      },
      tokenStorage: { clear: vi.fn(async () => {}) },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const signingIn = service.signIn()
    await Promise.resolve()
    const disposing = service.dispose()
    await stopStarted.promise
    let disposeFinished = false
    void disposing.then(() => { disposeFinished = true })
    await Promise.resolve()
    expect(disposeFinished).toBe(false)

    releaseStop.resolve()
    await expect(disposing).resolves.toBeUndefined()
    await expect(signingIn).rejects.toMatchObject({ code: 'IDENTITY_SIGN_IN_CANCELLED' })
  })

  it('应用释放身份服务会报告认证窗口关闭失败', async () => {
    const { AuthService } = require('./auth-service')
    const service = new AuthService({
      client: {
        closeSignInWindow: vi.fn(async () => { throw new Error('window close failed') }),
      },
      tokenStorage: { clear: vi.fn(async () => {}) },
    })

    await expect(service.dispose()).rejects.toMatchObject({ code: 'IDENTITY_DISPOSE_FAILED' })
  })

  it('退出登录先调用 Logto 撤销，再清理本地会话', async () => {
    const { AuthService } = require('./auth-service')
    const order = []
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signOut: async () => { order.push('remote-sign-out') },
      },
      tokenStorage: { clear: async () => { order.push('clear-local') } },
    })

    await expect(service.signOut()).resolves.toMatchObject({ status: 'signed_out' })
    expect(order).toEqual(['remote-sign-out', 'clear-local'])
  })

  it('退出登录会在清理本地凭证前清除应用内认证窗口会话', async () => {
    const { AuthService } = require('./auth-service')
    const order = []
    const service = new AuthService({
      client: {
        signOut: async () => { order.push('remote-sign-out') },
        clearSignInWindowSession: async () => { order.push('clear-auth-window') },
      },
      tokenStorage: { clear: async () => { order.push('clear-local') } },
    })

    await expect(service.signOut()).resolves.toMatchObject({ status: 'signed_out' })
    expect(order).toEqual(['remote-sign-out', 'clear-auth-window', 'clear-local'])
  })

  it('认证窗口会话无法清理时保留本地凭证并报告可重试错误', async () => {
    const { AuthService } = require('./auth-service')
    const clearLocal = vi.fn(async () => {})
    const service = new AuthService({
      client: {
        signOut: async () => {},
        clearSignInWindowSession: async () => { throw new Error('session locked') },
      },
      tokenStorage: { clear: clearLocal },
    })

    await expect(service.signOut()).rejects.toMatchObject({ code: 'IDENTITY_AUTH_WINDOW_SESSION_CLEAR_FAILED' })
    expect(clearLocal).not.toHaveBeenCalled()
    expect(service.getState()).toMatchObject({
      status: 'error',
      error: { code: 'IDENTITY_AUTH_WINDOW_SESSION_CLEAR_FAILED' },
    })
  })

  it('显式切换账号会先完整退出旧账号，再建立新账号会话', async () => {
    const { AuthService } = require('./auth-service')
    const order = []
    let currentSubject = 'sub-a'
    const callbackServer = {
      start: async () => { order.push('callback-start') },
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=new&state=state-1234567890123456'),
      stop: async () => { order.push('callback-stop') },
    }
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: currentSubject, exp: 300 }),
        signOut: async () => { order.push('remote-sign-out'); currentSubject = 'sub-b' },
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => { order.push('open-sign-in') },
        handleSignInCallback: async () => { order.push('handle-callback') },
      },
      tokenStorage: { clear: async () => { order.push('clear-session') } },
      entitlementService: {
        restore: async () => null,
        clear: async () => { order.push('clear-entitlement') },
      },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      now: () => 200,
    })
    await service.restore()

    await expect(service.switchAccount()).resolves.toMatchObject({
      status: 'authenticated',
      user: { sub: 'sub-b' },
    })
    expect(order).toEqual([
      'remote-sign-out', 'clear-session', 'clear-entitlement',
      'callback-start', 'open-sign-in', 'handle-callback', 'callback-stop',
    ])
  })

  it('已登录时普通登录入口拒绝覆盖当前账号', async () => {
    const { AuthService } = require('./auth-service')
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-a', exp: 300 }),
      },
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: vi.fn(),
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      now: () => 200,
    })
    await service.restore()

    await expect(service.signIn()).rejects.toMatchObject({ code: 'IDENTITY_ACCOUNT_SWITCH_REQUIRED' })
    expect(service._callbackServerFactory).not.toHaveBeenCalled()
  })

  it('远端退出失败仍清理本地会话并返回可提示的 warning', async () => {
    const { AuthService } = require('./auth-service')
    const order = []
    const service = new AuthService({
      client: {
        signOut: async () => {
          order.push('remote-sign-out')
          throw Object.assign(new Error('network down'), { code: 'NETWORK_ERROR' })
        },
      },
      tokenStorage: { clear: async () => { order.push('clear-local') } },
    })

    await expect(service.signOut()).resolves.toMatchObject({ status: 'signed_out', warning: 'IDENTITY_OPERATION_FAILED' })
    expect(order).toEqual(['remote-sign-out', 'clear-local'])
  })

  it('退出登录与浏览器回调并发时取消旧登录，不恢复成 authenticated', async () => {
    const { AuthService } = require('./auth-service')
    let resolveCallback
    const callbackPromise = new Promise((resolve) => { resolveCallback = resolve })
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => callbackPromise,
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        handleSignInCallback: async () => {},
        getIdTokenClaims: async () => ({ sub: 'stale-sub' }),
        signOut: async () => {},
      },
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const signingIn = service.signIn()
    await Promise.resolve()
    const signingOut = service.signOut()
    resolveCallback('http://127.0.0.1:16526/auth/callback?code=stale&state=state-1234567890123456')

    await expect(signingIn).rejects.toMatchObject({ code: 'IDENTITY_SIGN_IN_CANCELLED' })
    await expect(signingOut).resolves.toMatchObject({ status: 'signed_out' })
    expect(service.getState()).toMatchObject({ status: 'signed_out', user: null })
  })

  it('退出登录会取消进行中的会话恢复，不允许旧会话重新变为 authenticated', async () => {
    const { AuthService } = require('./auth-service')
    let markClaimsStarted
    let resolveClaims
    const claimsStarted = new Promise((resolve) => { markClaimsStarted = resolve })
    const claimsPromise = new Promise((resolve) => { resolveClaims = resolve })
    const tokenStorage = { clear: vi.fn(async () => {}) }
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => {
          markClaimsStarted()
          return claimsPromise
        },
        signOut: async () => {},
      },
      tokenStorage,
    })

    const restoring = service.restore()
    await claimsStarted
    await expect(service.signOut()).resolves.toMatchObject({ status: 'signed_out', user: null })
    resolveClaims({ sub: 'stale-sub' })

    await expect(restoring).resolves.toMatchObject({ status: 'signed_out', user: null })
    expect(service.getState()).toMatchObject({ status: 'signed_out', user: null })
    expect(tokenStorage.clear).toHaveBeenCalledTimes(1)
  })

  it('会话恢复清理期间的新登录不会被旧清理覆盖', async () => {
    const { AuthService } = require('./auth-service')
    let markClearStarted
    let releaseClear
    const clearStarted = new Promise((resolve) => { markClearStarted = resolve })
    const clearRelease = new Promise((resolve) => { releaseClear = resolve })
    const handleSignInCallback = vi.fn(async () => {})
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=new&state=state-1234567890123456'),
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        isAuthenticated: async () => false,
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        handleSignInCallback,
        getIdTokenClaims: async () => ({ sub: 'new-sub' }),
      },
      tokenStorage: {
        clear: async () => {
          markClearStarted()
          await clearRelease
        },
      },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const restoring = service.restore()
    await clearStarted
    const signingIn = service.signIn()
    await new Promise((resolve) => setImmediate(resolve))
    expect(handleSignInCallback).not.toHaveBeenCalled()
    releaseClear()

    await expect(signingIn).resolves.toMatchObject({ status: 'authenticated', user: { sub: 'new-sub' } })
    await expect(restoring).resolves.toMatchObject({ status: 'signing_in', user: null })
    expect(handleSignInCallback).toHaveBeenCalledTimes(1)
    expect(service.getState()).toMatchObject({ status: 'authenticated', user: { sub: 'new-sub' } })
  })

  it('退出进行中拒绝启动新登录，避免新会话被旧退出清理', async () => {
    const { AuthService } = require('./auth-service')
    let finishSignOut
    const remoteSignOut = new Promise((resolve) => { finishSignOut = resolve })
    const callbackServerFactory = vi.fn()
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-1' }),
        signOut: async () => remoteSignOut,
      },
      tokenStorage: { clear: async () => {} },
      callbackServerFactory,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })
    await service.restore()

    const signingOut = service.signOut()
    await Promise.resolve()
    await expect(service.signIn()).rejects.toMatchObject({ code: 'IDENTITY_OPERATION_IN_PROGRESS' })
    expect(callbackServerFactory).not.toHaveBeenCalled()
    finishSignOut()
    await expect(signingOut).resolves.toMatchObject({ status: 'signed_out' })
  })

  it('并发退出共享同一个操作且只撤销一次远端会话', async () => {
    const { AuthService } = require('./auth-service')
    let finishSignOut
    const remoteSignOut = new Promise((resolve) => { finishSignOut = resolve })
    const client = { signOut: vi.fn(async () => remoteSignOut) }
    const tokenStorage = { clear: vi.fn(async () => {}) }
    const service = new AuthService({ client, tokenStorage })

    const first = service.signOut()
    const second = service.signOut()
    await Promise.resolve()
    expect(client.signOut).toHaveBeenCalledTimes(1)
    finishSignOut()
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'signed_out' }),
      expect.objectContaining({ status: 'signed_out' }),
    ])
    expect(tokenStorage.clear).toHaveBeenCalledTimes(1)
  })

  it('登录成功后同步服务端 entitlement，退出时清理权益缓存', async () => {
    const { AuthService } = require('./auth-service')
    const entitlementService = {
      sync: vi.fn(async () => ({ plan: 'pro', features: ['cloud_publish'], source: 'online' })),
      clear: vi.fn(async () => {}),
    }
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        handleSignInCallback: async () => {},
        getIdTokenClaims: async () => ({ sub: 'sub-1', name: 'Test' }),
        getAccessToken: async () => 'access-1',
        signOut: async () => {},
      },
      tokenStorage: { clear: async () => {} },
      entitlementService,
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    await expect(service.signIn()).resolves.toMatchObject({
      status: 'authenticated', entitlement: { plan: 'pro', source: 'online' },
    })
    expect(entitlementService.sync).toHaveBeenCalledWith({ subject: 'sub-1', accessToken: 'access-1' })
    await service.signOut()
    expect(entitlementService.clear).toHaveBeenCalledTimes(1)
  })

  it('恢复时缺少非空 subject 必须拒绝会话', async () => {
    const { AuthService } = require('./auth-service')
    const cleared = []
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ name: 'broken-token' }),
      },
      tokenStorage: { clear: async () => { cleared.push(true) } },
    })

    await expect(service.restore()).resolves.toMatchObject({ status: 'signed_out', user: null })
    expect(cleared).toEqual([true])
  })

  it('登录回调返回缺少 subject 的 claims 时不得进入 authenticated', async () => {
    const { AuthService } = require('./auth-service')
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        handleSignInCallback: async () => {},
        getIdTokenClaims: async () => ({}),
      },
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    await expect(service.signIn()).rejects.toMatchObject({ code: 'IDENTITY_SESSION_INVALID' })
    expect(service.getState().status).toBe('error')
  })

  it('退出登录不会等待无法取消的回调登录', async () => {
    const { AuthService } = require('./auth-service')
    let cancelled = 0
    let rejectCallback
    const callbackPromise = new Promise((_, reject) => { rejectCallback = reject })
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => callbackPromise,
      cancel: async () => {
        cancelled += 1
        rejectCallback(Object.assign(new Error('cancelled'), { code: 'IDENTITY_SIGN_IN_CANCELLED' }))
      },
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        signOut: async () => {},
      },
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const signingIn = service.signIn()
    await Promise.resolve()
    await expect(service.signOut()).resolves.toMatchObject({ status: 'signed_out' })
    expect(cancelled).toBe(1)
    await expect(signingIn).rejects.toBeDefined()
  })

  it('ID Token 过期时刷新并使用新 claims 恢复登录', async () => {
    const { AuthService } = require('./auth-service')
    let claimsRead = 0
    const client = {
      isAuthenticated: async () => true,
      getIdTokenClaims: async () => {
        claimsRead += 1
        return claimsRead === 1 ? { sub: 'sub-1', exp: 100 } : { sub: 'sub-1', exp: 300 }
      },
      getAccessToken: vi.fn(async () => 'refreshed-token'),
    }
    const service = new AuthService({
      client,
      tokenStorage: { clear: vi.fn(async () => {}) },
      resource: 'https://api.multi-publish.com',
      now: () => 200,
    })

    await expect(service.restore()).resolves.toMatchObject({ status: 'authenticated', user: { sub: 'sub-1' } })
    expect(client.getAccessToken).toHaveBeenCalledWith('https://api.multi-publish.com')
    expect(claimsRead).toBe(2)
  })

  it('ID Token 过期且临时断网时在宽限期内恢复离线登录', async () => {
    const { AuthService } = require('./auth-service')
    const clear = vi.fn(async () => {})
    const entitlementService = {
      restore: vi.fn(async () => ({ subject: 'sub-1', features: ['local_publish'], source: 'offline' })),
      clear,
    }
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-1', exp: 100 }),
        getAccessToken: async () => { throw Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' }) },
      },
      tokenStorage: { clear },
      entitlementService,
      resource: 'https://api.multi-publish.com',
      now: () => 200,
      offlineGraceSeconds: 300,
    })

    await expect(service.restore()).resolves.toMatchObject({
      status: 'offline_authenticated',
      user: { sub: 'sub-1' },
      entitlement: { source: 'offline' },
    })
    expect(clear).not.toHaveBeenCalled()
  })

  it('恢复检查遇到临时网络错误时保留已有本地身份', async () => {
    const { AuthService } = require('./auth-service')
    const clear = vi.fn(async () => {})
    const service = new AuthService({
      client: {
        isAuthenticated: async () => {
          throw Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' })
        },
      },
      tokenStorage: { clear },
    })
    service._setState({
      status: 'authenticated',
      user: { sub: 'sub-1', name: '用户甲', username: '', picture: '' },
      entitlement: { plan: 'pro', features: ['local_publish'] },
      error: null,
    })

    await expect(service.restore()).resolves.toMatchObject({
      status: 'error',
      user: { sub: 'sub-1' },
      entitlement: { plan: 'pro' },
      error: { code: 'IDENTITY_NETWORK_UNAVAILABLE' },
    })
    expect(clear).not.toHaveBeenCalled()
  })

  it('系统安全存储暂时不可用时不删除待恢复的加密会话', async () => {
    const { AuthService } = require('./auth-service')
    const clear = vi.fn(async () => {})
    const service = new AuthService({
      client: {
        isAuthenticated: async () => {
          throw Object.assign(new Error('safeStorage unavailable'), {
            code: 'IDENTITY_SECURE_STORAGE_UNAVAILABLE',
          })
        },
      },
      tokenStorage: { clear },
    })

    await expect(service.restore()).resolves.toMatchObject({
      status: 'error',
      error: { code: 'IDENTITY_SECURE_STORAGE_UNAVAILABLE' },
    })
    expect(clear).not.toHaveBeenCalled()
  })

  it('Refresh Token 被撤销时清理会话而不是进入离线登录', async () => {
    const { AuthService } = require('./auth-service')
    const clear = vi.fn(async () => {})
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-1', exp: 100 }),
        getAccessToken: async () => { throw Object.assign(new Error('invalid_grant'), { code: 'invalid_grant' }) },
      },
      tokenStorage: { clear },
      resource: 'https://api.multi-publish.com',
      now: () => 200,
      offlineGraceSeconds: 300,
    })

    await expect(service.restore()).resolves.toMatchObject({ status: 'signed_out', user: null })
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('离线宽限已过期时清理过期会话', async () => {
    const { AuthService } = require('./auth-service')
    const clear = vi.fn(async () => {})
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-1', exp: 100 }),
        getAccessToken: async () => { throw Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' }) },
      },
      tokenStorage: { clear },
      resource: 'https://api.multi-publish.com',
      now: () => 500,
      offlineGraceSeconds: 300,
    })

    await expect(service.restore()).resolves.toMatchObject({ status: 'signed_out', user: null })
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('已恢复会话刷新时临时断网不会删除本地凭证', async () => {
    const { AuthService } = require('./auth-service')
    const clear = vi.fn(async () => {})
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-1', exp: 300 }),
        getAccessToken: async () => { throw Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' }) },
      },
      tokenStorage: { clear },
      resource: 'https://api.multi-publish.com',
      now: () => 200,
    })
    await service.restore()

    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'IDENTITY_NETWORK_UNAVAILABLE' })
    expect(service.getState().status).toBe('offline_authenticated')
    expect(clear).not.toHaveBeenCalled()
  })

  it('状态监听器异常不影响登录成功，也不阻断其他监听器', async () => {
    const { AuthService } = require('./auth-service')
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        handleSignInCallback: async () => {},
        getIdTokenClaims: async () => ({ sub: 'sub-1', name: '用户甲' }),
      },
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })
    const healthyListener = vi.fn()
    service.onStateChanged(() => { throw new Error('window already destroyed') })
    service.onStateChanged(healthyListener)

    await expect(service.signIn()).resolves.toMatchObject({ status: 'authenticated' })
    expect(healthyListener).toHaveBeenCalledWith(expect.objectContaining({ status: 'authenticated' }))
  })

  it('退出时本地会话清理失败会保留身份并允许重试', async () => {
    const { AuthService } = require('./auth-service')
    let clearAttempts = 0
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-1', name: '用户甲' }),
        signOut: async () => {},
      },
      tokenStorage: {
        clear: async () => {
          clearAttempts += 1
          if (clearAttempts === 1) throw new Error('disk unavailable')
        },
      },
    })
    await service.restore()

    await expect(service.signOut()).rejects.toMatchObject({ code: 'IDENTITY_SESSION_CLEAR_FAILED' })
    expect(service.getState()).toMatchObject({
      status: 'error',
      user: { sub: 'sub-1' },
      error: { code: 'IDENTITY_SESSION_CLEAR_FAILED' },
    })
    await expect(service.signOut()).resolves.toMatchObject({ status: 'signed_out', user: null })
  })

  it('旧恢复清理不会在新登录写入后删除新会话', async () => {
    const { AuthService } = require('./auth-service')
    const clearStarted = deferred()
    const releaseClear = deferred()
    let persisted = 'old-session'
    const tokenStorage = {
      save: vi.fn(async (value) => { persisted = value }),
      clear: vi.fn(async () => {
        clearStarted.resolve()
        await releaseClear.promise
        persisted = null
      }),
    }
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        isAuthenticated: async () => false,
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        handleSignInCallback: async () => { await tokenStorage.save('new-session') },
        getIdTokenClaims: async () => ({ sub: 'sub-new', name: '新用户' }),
      },
      tokenStorage,
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const restoring = service.restore()
    await clearStarted.promise
    const signingIn = service.signIn()
    await new Promise((resolve) => setImmediate(resolve))
    releaseClear.resolve()

    await Promise.all([restoring, signingIn])
    expect(persisted).toBe('new-session')
    expect(service.getState()).toMatchObject({ status: 'authenticated', user: { sub: 'sub-new' } })
  })

  it('已过期登录失败不会覆盖正在退出的状态', async () => {
    const { AuthService } = require('./auth-service')
    const syncStarted = deferred()
    const syncResult = deferred()
    const remoteSignOutStarted = deferred()
    const releaseRemoteSignOut = deferred()
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      cancel: async () => {},
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        handleSignInCallback: async () => {},
        getIdTokenClaims: async () => ({ sub: 'sub-1', name: '用户甲' }),
        getAccessToken: async () => 'access-1',
        signOut: async () => {
          remoteSignOutStarted.resolve()
          await releaseRemoteSignOut.promise
        },
      },
      tokenStorage: { clear: async () => {} },
      entitlementService: {
        sync: async () => {
          syncStarted.resolve()
          return syncResult.promise
        },
        clear: async () => {},
      },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const signingIn = service.signIn().catch((error) => error)
    await syncStarted.promise
    const signingOut = service.signOut()
    syncResult.reject(new Error('stale entitlement failure'))
    await remoteSignOutStarted.promise

    expect(service.getState().status).toBe('signing_out')
    releaseRemoteSignOut.resolve()
    await expect(signingOut).resolves.toMatchObject({ status: 'signed_out' })
    await expect(signingIn).resolves.toBeInstanceOf(Error)
  })

  it('退出后到达的在线权益结果不能恢复写权限', async () => {
    const { AuthService } = require('./auth-service')
    const onlineSyncStarted = deferred()
    const onlineSyncResult = deferred()
    let syncCount = 0
    const entitlementService = {
      sync: vi.fn(async () => {
        syncCount += 1
        if (syncCount === 1) return { subject: 'sub-1', features: ['cloud_publish'], source: 'online' }
        onlineSyncStarted.resolve()
        return onlineSyncResult.promise
      }),
      clear: vi.fn(async () => {}),
      hasFeature: vi.fn(() => true),
    }
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => Promise.resolve('http://127.0.0.1:16526/auth/callback?code=abc&state=state-1234567890123456'),
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => {},
        handleSignInCallback: async () => {},
        getIdTokenClaims: async () => ({ sub: 'sub-1', name: '用户甲' }),
        getAccessToken: async () => 'access-1',
        signOut: async () => {},
      },
      tokenStorage: { clear: async () => {} },
      entitlementService,
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })
    await service.signIn()

    const requiring = service.requireEntitlement('cloud_publish', { onlineOnly: true })
    await onlineSyncStarted.promise
    await service.signOut()
    onlineSyncResult.resolve({ subject: 'sub-1', features: ['cloud_publish'], source: 'online' })

    await expect(requiring).rejects.toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
    expect(service.getState()).toMatchObject({ status: 'signed_out', user: null, entitlement: null })
  })

  // —— 2026-09-14 缺陷回归：登录失败时清理错误不得掩盖主错误 ——

  it('登录失败且本地会话清理也失败时，主错误码不被清理错误掩盖', async () => {
    const { AuthService } = require('./auth-service')
    const callbackServer = {
      start: async () => {},
      waitForCallback: () => new Promise(() => {}),
      stop: async () => {},
    }
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        // 复刻宿主安全删除 shim 的 fail-closed 错误：不带 .code
        signIn: async () => { throw new Error('[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":500}') },
      },
      tokenStorage: { clear: async () => { throw new Error('unlink denied') } },
      callbackServerFactory: () => callbackServer,
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const error = await service.signIn().catch((thrown) => thrown)
    expect(error.code).toBe('IDENTITY_SIGN_IN_FAILED')
    expect(error.cleanupCode).toBe('IDENTITY_SESSION_CLEAR_FAILED')
    expect(service.getState()).toMatchObject({
      status: 'error',
      error: {
        code: 'IDENTITY_SIGN_IN_FAILED',
        cleanup: { code: 'IDENTITY_SESSION_CLEAR_FAILED' },
      },
    })
  })

  it('登录失败但清理成功时不带 cleanup 附加信息', async () => {
    const { AuthService } = require('./auth-service')
    const service = new AuthService({
      client: {
        prepareSignInState: async () => 'state-1234567890123456',
        signIn: async () => { throw new Error('boot failed') },
      },
      tokenStorage: { clear: async () => {} },
      callbackServerFactory: () => ({ start: async () => {}, waitForCallback: () => new Promise(() => {}), stop: async () => {} }),
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
    })

    const error = await service.signIn().catch((thrown) => thrown)
    expect(error.code).toBe('IDENTITY_SIGN_IN_FAILED')
    expect(error.cleanupCode).toBeUndefined()
    expect(service.getState().error).not.toHaveProperty('cleanup')
  })

  it('身份失败写诊断日志（含原始 cause 文本），不改变对外错误码', async () => {
    const { AuthService } = require('./auth-service')
    const warn = vi.fn()
    const service = new AuthService({
      client: {
        isAuthenticated: async () => true,
        getIdTokenClaims: async () => ({ sub: 'sub-1', name: '测试用户' }),
        signOut: async () => {},
      },
      tokenStorage: { clear: async () => { throw new Error('[safe-delete] 操作失败: genie-trash exited 1') } },
      logger: { warn },
    })
    await service.restore()

    const error = await service.signOut().catch((thrown) => thrown)
    expect(error.code).toBe('IDENTITY_SESSION_CLEAR_FAILED')
    const logged = warn.mock.calls.map((call) => String(call[1])).join(' | ')
    expect(logged).toContain('tokenStorage.clear')
    expect(logged).toContain('safe-delete')
  })
})
