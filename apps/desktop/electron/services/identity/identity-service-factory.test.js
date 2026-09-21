describe('createIdentityService', () => {
  function enabledEnv(overrides = {}) {
    return {
      IDENTITY_AUTH_ENABLED: 'true', LOGTO_ENDPOINT: 'https://id.example.com', LOGTO_APP_ID: 'app-1',
      LOGTO_API_RESOURCE: 'https://api.multi-publish.com', BUSINESS_API_URL: 'https://api.example.com',
      LOGTO_REDIRECT_URI: 'http://127.0.0.1:16526/auth/callback',
      ...overrides,
    }
  }

  it('开关关闭时不加载 Logto SDK', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    const createClient = vi.fn()
    await expect(createIdentityService({ env: { IDENTITY_AUTH_ENABLED: 'false' }, createClient }))
      .resolves.toBeNull()
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each(['1', 'true', 'yes', 'on', ' TRUE '])('开关值 %s 会启用身份服务', async (flag) => {
    const { createIdentityService } = require('./identity-service-factory')
    const authService = { restore: vi.fn(async () => ({ status: 'signed_out' })) }
    await expect(createIdentityService({
      env: enabledEnv({ IDENTITY_AUTH_ENABLED: flag }),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
      createAuthService: vi.fn(() => authService),
    })).resolves.toBe(authService)
  })

  it('拒绝没有显式端口的回环回调地址', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    await expect(createIdentityService({
      env: enabledEnv({ LOGTO_REDIRECT_URI: 'http://127.0.0.1/auth/callback' }),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
    })).rejects.toMatchObject({ code: 'IDENTITY_CONFIG_INVALID' })
  })

  it('开启时恢复会话并向主窗口广播脱敏状态', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    let listener
    const authService = {
      restore: vi.fn(async () => ({ status: 'signed_out' })),
      onStateChanged: vi.fn((fn) => { listener = fn; return () => {} }),
    }
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    const result = await createIdentityService({
      env: enabledEnv(),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
      createAuthService: vi.fn(() => authService),
      getMainWin: () => win,
    })
    expect(result).toBe(authService)
    expect(authService.restore).toHaveBeenCalledTimes(1)
    listener({ status: 'authenticated', user: { sub: 'sub-1' } })
    expect(win.webContents.send).toHaveBeenCalledWith('identity:state-changed', { status: 'authenticated', user: { sub: 'sub-1' } })
  })

  it('生产客户端获得受限认证窗口并在打开时解析主窗口', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    const authWindow = { open: vi.fn(), close: vi.fn(), waitForClosed: vi.fn() }
    const createAuthWindow = vi.fn(() => authWindow)
    const createClient = vi.fn(async () => ({}))
    const authService = { restore: vi.fn(async () => ({ status: 'signed_out' })) }
    const getMainWin = vi.fn(() => ({ id: 'main-window' }))
    await createIdentityService({
      env: enabledEnv(),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createAuthWindow,
      createClient,
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
      createAuthService: vi.fn(() => authService),
      getMainWin,
    })
    expect(createAuthWindow).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://id.example.com',
      redirectUri: 'http://127.0.0.1:16526/auth/callback',
      getParentWindow: getMainWin,
    }))
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ authWindow }))
  })

  it('主窗口在状态广播期间销毁时不向认证流程传播异常', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    let listener
    const authService = {
      restore: vi.fn(async () => ({ status: 'signed_out' })),
      onStateChanged: vi.fn((fn) => { listener = fn; return () => {} }),
    }
    const win = {
      isDestroyed: () => false,
      webContents: { send: vi.fn(() => { throw new Error('Object has been destroyed') }) },
    }
    await createIdentityService({
      env: enabledEnv(),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
      createAuthService: vi.fn(() => authService),
      getMainWin: () => win,
    })

    expect(() => listener({ status: 'authenticated', user: { sub: 'sub-1' } })).not.toThrow()
  })

  it('身份服务工厂拒绝远程 HTTP Logto 端点，即使注入的 client 不校验', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    await expect(createIdentityService({
      env: {
        IDENTITY_AUTH_ENABLED: 'true', LOGTO_ENDPOINT: 'http://id.example.com', LOGTO_APP_ID: 'app-1',
        LOGTO_API_RESOURCE: 'https://api.multi-publish.com',
        LOGTO_REDIRECT_URI: 'http://127.0.0.1:16526/auth/callback',
      },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
    })).rejects.toMatchObject({ code: 'IDENTITY_CONFIG_INVALID' })
  })

  it('复用持久化设备 ID，并把独立权益存储和业务 API 注入 AuthService', async () => {
    const crypto = require('crypto')
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const createEntitlementStorage = vi.fn(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn() }))
    const createEntitlementService = vi.fn((options) => ({ options }))
    const createAuthService = vi.fn((options) => ({ restore: vi.fn(), options }))
    const store = { getSetting: vi.fn(() => 'device-1234567890'), setSetting: vi.fn() }
    const { createIdentityService } = require('./identity-service-factory')

    await createIdentityService({
      env: enabledEnv({
        ENTITLEMENT_KEY_ID: 'key-1',
        ENTITLEMENT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
      }),
      store,
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage,
      createEntitlementService,
      createAuthService,
    })

    expect(store.setSetting).not.toHaveBeenCalled()
    expect(createEntitlementStorage).toHaveBeenCalledTimes(1)
    expect(createEntitlementService).toHaveBeenCalledWith(expect.objectContaining({
      apiUrl: 'https://api.example.com',
      deviceId: 'device-1234567890',
      storage: createEntitlementStorage.mock.results[0].value,
      publicKeys: { 'key-1': expect.anything() },
    }))
    expect(createAuthService).toHaveBeenCalledWith(expect.objectContaining({
      entitlementService: createEntitlementService.mock.results[0].value,
    }))
  })

  it('首次启动生成并持久化稳定设备 ID', async () => {
    const store = { getSetting: vi.fn(() => null), setSetting: vi.fn() }
    const createEntitlementService = vi.fn(() => ({}))
    const { createIdentityService } = require('./identity-service-factory')

    await createIdentityService({
      env: enabledEnv(),
      store,
      randomUUID: () => 'device-abcdef1234567890',
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
      createEntitlementService,
      createAuthService: vi.fn(() => ({ restore: vi.fn() })),
    })

    expect(store.setSetting).toHaveBeenCalledWith('identity_device_id', 'device-abcdef1234567890')
    expect(createEntitlementService).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'device-abcdef1234567890' }))
  })

  it('权益公钥配置损坏时 fail closed', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    await expect(createIdentityService({
      env: enabledEnv({ ENTITLEMENT_KEY_ID: 'key-1', ENTITLEMENT_PUBLIC_KEY: 'not-a-key' }),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
    })).rejects.toMatchObject({ code: 'ENTITLEMENT_CONFIG_INVALID' })
  })

  it('signed_out 时后台非阻塞预热 discovery，使用注入 fetcher', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    const fetcher = vi.fn(async () => ({ ok: true }))
    const authService = {
      restore: vi.fn(async () => ({ status: 'signed_out' })),
      getState: () => ({ status: 'signed_out' }),
    }
    await createIdentityService({
      env: enabledEnv(),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
      createAuthService: vi.fn(() => authService),
      prewarmFetcher: fetcher,
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('https://id.example.com/.well-known/openid-configuration')
  })

  it('预热 fetch 抛错不影响身份服务创建（异常被吞）', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    const authService = {
      restore: vi.fn(async () => ({ status: 'signed_out' })),
      getState: () => ({ status: 'signed_out' }),
    }
    await expect(createIdentityService({
      env: enabledEnv(),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
      createAuthService: vi.fn(() => authService),
      prewarmFetcher: fetcher,
    })).resolves.toBe(authService)
    await new Promise((resolve) => setImmediate(resolve))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('已登录时不预热 discovery', async () => {
    const { createIdentityService } = require('./identity-service-factory')
    const fetcher = vi.fn(async () => ({ ok: true }))
    const authService = {
      restore: vi.fn(async () => ({ status: 'authenticated' })),
      getState: () => ({ status: 'authenticated' }),
    }
    await createIdentityService({
      env: enabledEnv(),
      store: { getSetting: () => 'device-1234567890', setSetting: vi.fn() },
      createClient: vi.fn(async () => ({})),
      createTokenStorage: vi.fn(() => ({})),
      createEntitlementStorage: vi.fn(() => ({})),
      createAuthService: vi.fn(() => authService),
      prewarmFetcher: fetcher,
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(fetcher).not.toHaveBeenCalled()
  })
})
