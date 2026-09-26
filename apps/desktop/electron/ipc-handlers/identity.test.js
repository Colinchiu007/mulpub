__enableElectronMock()

describe('identity IPC', () => {
  it('注册状态、登录、切换和退出通道并返回脱敏结果', async () => {
    const registerIdentityHandlers = require('./identity')
    const handlers = {}
    const authService = {
      getState: vi.fn(() => ({ status: 'signed_out', user: null })),
      signIn: vi.fn(async () => ({ status: 'authenticated', user: { sub: 'sub-1' } })),
      switchAccount: vi.fn(async () => ({ status: 'authenticated', user: { sub: 'sub-2' } })),
      signOut: vi.fn(async () => ({ status: 'signed_out', user: null })),
    }
    registerIdentityHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, { authService })
    const event = { senderFrame: { url: 'app://localhost/index.html' } }

    await expect(handlers['identity:get-state'](event)).resolves.toEqual({ code: 0, data: { status: 'signed_out', user: null } })
    await expect(handlers['identity:sign-in'](event)).resolves.toMatchObject({ code: 0, data: { status: 'authenticated' } })
    await expect(handlers['identity:switch-account'](event)).resolves.toMatchObject({ code: 0, data: { user: { sub: 'sub-2' } } })
    await expect(handlers['identity:sign-out'](event)).resolves.toMatchObject({ code: 0, data: { status: 'signed_out' } })
    expect(authService.signIn).toHaveBeenCalledTimes(1)
    expect(authService.switchAccount).toHaveBeenCalledTimes(1)
    expect(authService.signOut).toHaveBeenCalledTimes(1)
  })

  it('不可信 sender 不能触发登录', async () => {
    const registerIdentityHandlers = require('./identity')
    const authService = { signIn: vi.fn() }
    const handlers = {}
    registerIdentityHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, { authService })
    await expect(handlers['identity:sign-in']({ senderFrame: { url: 'https://evil.example' } }))
      .resolves.toMatchObject({ code: -3 })
    expect(authService.signIn).not.toHaveBeenCalled()
  })

  it('身份服务未配置时返回稳定的禁用错误码', async () => {
    const registerIdentityHandlers = require('./identity')
    const handlers = {}
    registerIdentityHandlers({ handle: (channel, handler) => { handlers[channel] = handler } })
    const event = { senderFrame: { url: 'app://localhost/index.html' } }

    await expect(handlers['identity:get-state'](event)).resolves.toMatchObject({
      code: 0,
      data: { status: 'disabled' },
    })
    await expect(handlers['identity:sign-in'](event)).resolves.toMatchObject({
      message: 'IDENTITY_NOT_CONFIGURED',
    })
    await expect(handlers['identity:switch-account'](event)).resolves.toMatchObject({
      message: 'IDENTITY_NOT_CONFIGURED',
    })
  })

  it('状态读取异常时返回脱敏的统一错误响应', async () => {
    const registerIdentityHandlers = require('./identity')
    const handlers = {}
    const authService = {
      getState: vi.fn(() => {
        throw Object.assign(new Error('内部状态不可用'), { code: 'IDENTITY_STATE_UNAVAILABLE' })
      }),
    }
    registerIdentityHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, { authService })

    await expect(handlers['identity:get-state']({ senderFrame: { url: 'app://localhost/index.html' } }))
      .resolves.toEqual({ code: -3, message: 'IDENTITY_STATE_UNAVAILABLE' })
  })

  it('会员通道转发自鉴权请求并按路径白名单接线', async () => {
    const registerIdentityHandlers = require('./identity')
    const handlers = {}
    const authService = {
      getState: () => ({ user: { sub: 'sub-9' } }),
      memberApiService: { request: vi.fn(async (payload) => ({ ok: true, ...payload })) },
    }
    registerIdentityHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, { authService })
    const event = { senderFrame: { url: 'app://localhost/index.html' } }

    await expect(handlers['identity:sessions'](event))
      .resolves.toEqual({ code: 0, data: { ok: true, subject: 'sub-9', path: '/api/v1/me/sessions' } })
    await expect(handlers['identity:sessions-revoke-others'](event)).resolves.toMatchObject({
      code: 0, data: { path: '/api/v1/me/sessions/revoke-others' },
    })
    await expect(handlers['identity:notifications'](event)).resolves.toMatchObject({
      code: 0, data: { path: '/api/v1/me/notifications' },
    })
    await expect(handlers['identity:notifications-mark-read'](event)).resolves.toMatchObject({
      code: 0, data: { path: '/api/v1/me/notifications/read' },
    })
    expect(authService.memberApiService.request).toHaveBeenCalledTimes(4)
  })

  it('会员通道在身份服务未启用或会话异常时返回脱敏错误码', async () => {
    const registerIdentityHandlers = require('./identity')
    const handlers = {}
    registerIdentityHandlers({ handle: (channel, handler) => { handlers[channel] = handler } })
    const event = { senderFrame: { url: 'app://localhost/index.html' } }
    await expect(handlers['identity:sessions'](event))
      .resolves.toEqual({ code: -3, message: 'IDENTITY_NOT_CONFIGURED' })

    const authService = {
      memberApiService: { request: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'ENTITLEMENT_SESSION_MISMATCH' }) }) },
    }
    const handlers2 = {}
    registerIdentityHandlers({ handle: (channel, handler) => { handlers2[channel] = handler } }, { authService })
    await expect(handlers2['identity:notifications'](event))
      .resolves.toEqual({ code: -3, message: 'ENTITLEMENT_SESSION_MISMATCH' })
  })
})

