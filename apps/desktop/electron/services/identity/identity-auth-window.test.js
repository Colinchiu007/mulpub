function createFakeWindowClass() {
  const instances = []
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options
      this.handlers = new Map()
      this.webContents = {
        on: (event, handler) => this.handlers.set(`webContents:${event}`, handler),
        setWindowOpenHandler: (handler) => { this.windowOpenHandler = handler },
        loadURL: vi.fn(async (url) => { this.loadedUrl = url }),
        isDestroyed: () => this.closed,
      }
      this.closed = false
      this.handlers.set('ready-to-show', null)
      instances.push(this)
    }

    once(event, handler) { this.handlers.set(event, handler) }
    show() { this.shown = true }
    close() {
      if (this.closed) return
      this.closed = true
      this.handlers.get('closed')?.()
    }
    emit(event, ...args) { this.handlers.get(event)?.(...args) }
  }
  return { FakeBrowserWindow, instances }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('IdentityAuthWindow', () => {
  let fake
  let shell
  let authSession

  beforeEach(() => {
    fake = createFakeWindowClass()
    shell = { openExternal: vi.fn(async () => {}) }
    authSession = {
      id: 'isolated-logto-session',
      on: vi.fn(),
      removeListener: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      clearStorageData: vi.fn(async () => {}),
    }
  })

  it('创建隔离、安全且稳定尺寸的认证窗口，并在 ready-to-show 后展示', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
      getParentWindow: () => ({ id: 'main-window' }),
    })

    await authWindow.open('https://auth.example.com/oidc/auth?state=abc')
    const window = fake.instances[0]
    expect(window.options).toMatchObject({
      width: 520,
      height: 720,
      show: false,
      modal: true,
      parent: { id: 'main-window' },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: authSession,
      },
    })
    expect(window.options.webPreferences).not.toHaveProperty('preload')
    // 窗口在 ready-to-show / dom-ready / did-finish-load 之前一直是 show:false，隐藏页会被降频定时器并停掉 rAF
    expect(window.options.webPreferences.backgroundThrottling).toBe(false)
    expect(window.shown).toBeFalsy()
    window.emit('ready-to-show')
    expect(window.shown).toBe(true)
  })

  it('只允许 Logto issuer 与固定回调地址，阻止任意导航并拒绝新窗口', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    const authorizationUrl = 'https://auth.example.com/sign-in?state=state-1'
    await authWindow.open(authorizationUrl)
    const window = fake.instances[0]
    const navigate = window.handlers.get('webContents:will-navigate')
    const blocked = { preventDefault: vi.fn() }
    navigate(blocked, 'https://evil.example/phish')
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).toHaveBeenCalledWith(authorizationUrl)
    expect(window.windowOpenHandler({ url: 'https://evil.example/new-window' })).toEqual({ action: 'deny' })
    expect(window.windowOpenHandler({ url: 'https://auth.example.com/account' })).toEqual({ action: 'deny' })
    const permissionHandler = authSession.setPermissionRequestHandler.mock.calls[0][0]
    const permissionDecision = vi.fn()
    permissionHandler(null, 'media', permissionDecision)
    expect(permissionDecision).toHaveBeenCalledWith(false)
    const downloadHandler = authSession.on.mock.calls.find(([event]) => event === 'will-download')[1]
    const downloadEvent = { preventDefault: vi.fn() }
    downloadHandler(downloadEvent)
    expect(downloadEvent.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('页面加载失败时关闭认证窗口并返回脱敏错误', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const loadError = new Error('ERR_CONNECTION_RESET https://secret.example')
    const failingFake = createFakeWindowClass()
    class FailingWindow extends failingFake.FakeBrowserWindow {
      constructor(options) {
        super(options)
        this.webContents.loadURL = vi.fn(async () => { throw loadError })
      }
    }
    const failing = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: FailingWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await expect(failing.open('https://auth.example.com/sign-in')).rejects.toMatchObject({
      code: 'IDENTITY_AUTH_WINDOW_LOAD_FAILED',
      message: 'IDENTITY_AUTH_WINDOW_LOAD_FAILED: 登录页面加载失败',
    })
    expect(failingFake.instances[0].closed).toBe(true)
  })

  it('允许回调导航，关闭窗口时通知等待方并可安全重复关闭', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.open('https://auth.example.com/sign-in')
    const window = fake.instances[0]
    const navigate = window.handlers.get('webContents:will-navigate')
    const callbackEvent = { preventDefault: vi.fn() }
    navigate(callbackEvent, 'http://127.0.0.1:16526/auth/callback?code=x&state=y')
    expect(callbackEvent.preventDefault).not.toHaveBeenCalled()
    const closed = authWindow.waitForClosed()
    authWindow.close()
    await expect(closed).resolves.toBeUndefined()
    expect(authSession.removeListener).not.toHaveBeenCalled()
    expect(authSession.setPermissionRequestHandler).not.toHaveBeenCalledWith(null)
    expect(() => authWindow.close()).not.toThrow()
  })

  it('退出或切换账号时关闭窗口并清理隔离认证会话', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const session = { fromPartition: vi.fn(() => authSession) }
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session,
      shell,
    })
    await authWindow.open('https://auth.example.com/sign-in')

    await authWindow.clearSession()

    expect(fake.instances[0].closed).toBe(true)
    expect(authSession.clearStorageData).toHaveBeenCalledTimes(1)
    expect(authSession.removeListener).toHaveBeenCalledWith('will-download', expect.any(Function))
    expect(authSession.setPermissionRequestHandler).toHaveBeenLastCalledWith(null)
    expect(session.fromPartition).toHaveBeenCalledWith('persist:logto-identity', { cache: true })
  })

  it('重开认证窗口时保留 session 安全处理器，仅在清理会话后释放', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })

    await authWindow.open('https://auth.example.com/sign-in?attempt=1')
    await authWindow.open('https://auth.example.com/sign-in?attempt=2')

    expect(authSession.on).toHaveBeenCalledTimes(1)
    expect(authSession.setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(authSession.setPermissionRequestHandler).not.toHaveBeenCalledWith(null)

    await authWindow.clearSession()

    expect(authSession.removeListener).toHaveBeenCalledTimes(1)
    expect(authSession.setPermissionRequestHandler).toHaveBeenCalledTimes(2)
    expect(authSession.setPermissionRequestHandler).toHaveBeenLastCalledWith(null)
  })

  it('窗口已销毁但未触发 closed 回调时仍会完成会话清理', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.open('https://auth.example.com/sign-in')

    fake.instances[0].closed = true
    const clearing = authWindow.clearSession()
    let settledBeforeFallback = false
    clearing.then(() => { settledBeforeFallback = true })
    await new Promise(resolve => setImmediate(resolve))
    if (!settledBeforeFallback) fake.instances[0].emit('closed')

    await expect(clearing).resolves.toBeUndefined()
    expect(settledBeforeFallback).toBe(true)
  })

  it('窗口拒绝常规关闭时使用 destroy 强制结算并清理会话', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    class CloseBlockedWindow extends fake.FakeBrowserWindow {
      constructor(options) {
        super(options)
        this.destroy = vi.fn(() => {
          this.closed = true
          this.handlers.get('closed')?.()
        })
      }

      close() {
        this.closeWasRequested = true
      }
    }
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: CloseBlockedWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.open('https://auth.example.com/sign-in')
    const window = fake.instances[0]

    const clearing = authWindow.clearSession()
    let settledBeforeFallback = false
    clearing.then(() => { settledBeforeFallback = true })
    await new Promise(resolve => setImmediate(resolve))
    const destroyCallsBeforeFallback = window.destroy.mock.calls.length
    if (!settledBeforeFallback) window.destroy()

    await expect(clearing).resolves.toBeUndefined()
    expect(destroyCallsBeforeFallback).toBe(1)
    expect(window.closeWasRequested).toBeUndefined()
  })

  it('认证 session 监听器清理异常不会阻塞会话清理', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    authSession.removeListener.mockImplementation(() => { throw new Error('session already destroyed') })
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.open('https://auth.example.com/sign-in')

    await expect(authWindow.clearSession()).resolves.toBeUndefined()
    expect(authSession.clearStorageData).toHaveBeenCalledTimes(1)
  })

  it('忽略旧认证窗口迟到的阻断导航，仅当前窗口回退自己的授权地址', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.open('https://auth.example.com/sign-in?attempt=1')
    const oldWindow = fake.instances[0]
    await authWindow.open('https://auth.example.com/sign-in?attempt=2')
    const currentWindow = fake.instances[1]

    const oldEvent = { preventDefault: vi.fn() }
    oldWindow.handlers.get('webContents:will-navigate')(oldEvent, 'https://attacker.example.test/')

    expect(oldEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).not.toHaveBeenCalled()

    const currentEvent = { preventDefault: vi.fn() }
    currentWindow.handlers.get('webContents:will-navigate')(currentEvent, 'https://attacker.example.test/')

    expect(currentEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).toHaveBeenCalledWith('https://auth.example.com/sign-in?attempt=2')
  })

  it('旧窗口延迟加载失败不会误关后续认证窗口', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const loads = [deferred(), deferred()]
    let index = 0
    class DelayedWindow extends fake.FakeBrowserWindow {
      constructor(options) {
        super(options)
        const load = loads[index++]
        this.webContents.loadURL = vi.fn(() => load.promise)
      }
    }
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: DelayedWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })

    const firstOpen = authWindow.open('https://auth.example.com/sign-in?attempt=1')
    while (fake.instances.length < 1) await Promise.resolve()
    const secondOpen = authWindow.open('https://auth.example.com/sign-in?attempt=2')
    while (fake.instances.length < 2) await Promise.resolve()
    loads[0].reject(new Error('旧窗口加载失败'))
    await expect(firstOpen).resolves.toBeUndefined()
    loads[1].resolve()
    await expect(secondOpen).resolves.toBeUndefined()
    expect(fake.instances[0].closed).toBe(true)
    expect(fake.instances[1].closed).toBe(false)
  })

  // ── 2026-09-20 登录窗口延迟回归：ready-to-show 可能迟迟不触发，窗口必须兜底显示 ──

  it('ready-to-show 未触发但 dom-ready 到达时展示认证窗口', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.open('https://auth.example.com/sign-in')
    const window = fake.instances[0]
    expect(window.shown).toBeFalsy()
    window.handlers.get('webContents:dom-ready')()
    expect(window.shown).toBe(true)
  })

  it('ready-to-show 与 dom-ready 均未触发时，兜底定时强制展示认证窗口', async () => {
    vi.useFakeTimers()
    try {
      const { IdentityAuthWindow } = require('./identity-auth-window')
      const load = deferred()
      class HangingWindow extends fake.FakeBrowserWindow {
        constructor(options) {
          super(options)
          this.webContents.loadURL = vi.fn(() => load.promise)
        }
      }
      const authWindow = new IdentityAuthWindow({
        endpoint: 'https://auth.example.com',
        redirectUri: 'http://127.0.0.1:16526/auth/callback',
        BrowserWindow: HangingWindow,
        session: { fromPartition: vi.fn(() => authSession) },
        shell,
        showFallbackTimeout: 2500,
      })
      const openPromise = authWindow.open('https://auth.example.com/sign-in')
      await vi.advanceTimersByTimeAsync(0)
      const window = fake.instances[0]
      expect(window.shown).toBeFalsy()
      await vi.advanceTimersByTimeAsync(2500)
      expect(window.shown).toBe(true)
      load.resolve()
      await openPromise
    } finally {
      vi.useRealTimers()
    }
  })

  it('窗口已展示后兜底定时器不再重复触发 show', async () => {
    vi.useFakeTimers()
    try {
      const { IdentityAuthWindow } = require('./identity-auth-window')
      const authWindow = new IdentityAuthWindow({
        endpoint: 'https://auth.example.com',
        redirectUri: 'http://127.0.0.1:16526/auth/callback',
        BrowserWindow: fake.FakeBrowserWindow,
        session: { fromPartition: vi.fn(() => authSession) },
        shell,
        showFallbackTimeout: 2500,
      })
      const openPromise = authWindow.open('https://auth.example.com/sign-in')
      await vi.advanceTimersByTimeAsync(0)
      const window = fake.instances[0]
      window.emit('ready-to-show')
      expect(window.shown).toBe(true)
      const showSpy = vi.spyOn(window, 'show')
      await vi.advanceTimersByTimeAsync(10000)
      expect(showSpy).not.toHaveBeenCalled()
      await openPromise
    } finally {
      vi.useRealTimers()
    }
  })

  it('认证窗口关闭后兜底定时器不再触发展示已销毁窗口', async () => {
    vi.useFakeTimers()
    try {
      const { IdentityAuthWindow } = require('./identity-auth-window')
      const load = deferred()
      class HangingWindow extends fake.FakeBrowserWindow {
        constructor(options) {
          super(options)
          this.webContents.loadURL = vi.fn(() => load.promise)
        }
      }
      const authWindow = new IdentityAuthWindow({
        endpoint: 'https://auth.example.com',
        redirectUri: 'http://127.0.0.1:16526/auth/callback',
        BrowserWindow: HangingWindow,
        session: { fromPartition: vi.fn(() => authSession) },
        shell,
        showFallbackTimeout: 2500,
      })
      const openPromise = authWindow.open('https://auth.example.com/sign-in')
      await vi.advanceTimersByTimeAsync(0)
      const window = fake.instances[0]
      authWindow.close()
      await vi.advanceTimersByTimeAsync(5000)
      expect(window.shown).toBeFalsy()
      load.resolve()
      await openPromise
    } finally {
      vi.useRealTimers()
    }
  })

  // ── L2 秒开加载窗：openLoading 预热窗口，open 复用同一已显示窗口 ──

  it('openLoading 创建本地加载窗并以 data URL 秒显，背景为主题底色', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.openLoading()
    const window = fake.instances[0]
    expect(window.options.backgroundColor).toBe('#faf6f8')
    expect(window.loadedUrl).toMatch(/^data:text\/html/)
    expect(window.shown).toBeFalsy()
    window.emit('ready-to-show')
    expect(window.shown).toBe(true)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('openLoading 幂等，重复调用复用同一窗口不重建', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.openLoading()
    await authWindow.openLoading()
    expect(fake.instances.length).toBe(1)
  })

  it('open 复用 openLoading 已创建的窗口，仅替换为真实授权地址且不重复建窗', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.openLoading()
    const window = fake.instances[0]
    await authWindow.open('https://auth.example.com/sign-in?state=abc')
    expect(fake.instances.length).toBe(1)
    expect(window.loadedUrl).toBe('https://auth.example.com/sign-in?state=abc')
    expect(window.closed).toBeFalsy()
  })

  it('openLoading 加载失败被吞掉后 open 仍能向同一窗口加载真实地址', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    class LoadingThenOk extends fake.FakeBrowserWindow {
      constructor(options) {
        super(options)
        this.webContents.loadURL = vi.fn(async (url) => {
          if (url.startsWith('data:')) throw new Error('本地加载页失败')
          this.loadedUrl = url
        })
      }
    }
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: LoadingThenOk,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await expect(authWindow.openLoading()).resolves.toBeUndefined()
    await authWindow.open('https://auth.example.com/sign-in?state=abc')
    expect(fake.instances.length).toBe(1)
    expect(fake.instances[0].loadedUrl).toBe('https://auth.example.com/sign-in?state=abc')
  })

  it('未经 openLoading 直接 open 仍独立建窗加载（回归原行为），关窗后再 open 新建', async () => {
    const { IdentityAuthWindow } = require('./identity-auth-window')
    const authWindow = new IdentityAuthWindow({
      endpoint: 'https://auth.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      BrowserWindow: fake.FakeBrowserWindow,
      session: { fromPartition: vi.fn(() => authSession) },
      shell,
    })
    await authWindow.open('https://auth.example.com/sign-in?attempt=1')
    expect(fake.instances.length).toBe(1)
    fake.instances[0].close()
    await authWindow.open('https://auth.example.com/sign-in?attempt=2')
    expect(fake.instances.length).toBe(2)
    expect(fake.instances[1].loadedUrl).toBe('https://auth.example.com/sign-in?attempt=2')
  })
})
