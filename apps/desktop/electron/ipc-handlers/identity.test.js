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


describe('identity:redeem-code IPC 边界', () => {
  function createRedeemHandlers() {
    const registerIdentityHandlers = require('./identity')
    const handlers = {}
    const memberApiService = {
      request: vi.fn(async ({ path, method, body }) => ({ path, method, body, ok: true })),
    }
    // 注意 memberApiService 挂在 authService 上 —— handler 读的是 authService.memberApiService，
    // 放在 deps 顶层会得到 IDENTITY_NOT_CONFIGURED，且 request 一次都不会被调用。
    const authService = {
      getState: vi.fn(() => ({ status: 'authenticated', user: { sub: 'sub-1' } })),
      memberApiService,
    }
    registerIdentityHandlers(
      { handle: (channel, handler) => { handlers[channel] = handler } },
      { authService },
    )
    return { handlers, memberApiService, event: { senderFrame: { url: 'app://localhost/index.html' } } }
  }

  it('只透传 code，其余 renderer 字段必须被丢弃', async () => {
    const { handlers, memberApiService, event } = createRedeemHandlers()
    await handlers['identity:redeem-code'](event, {
      code: 'ABCD-EFGH-JKMN',
      plan: 'pro',
      durationDays: 36500,
      subject: 'sub-attacker',
      __proto__: { polluted: true },
    })
    expect(memberApiService.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/redeem', method: 'POST' }),
    )
    const call = memberApiService.request.mock.calls[0][0]
    // renderer 不可信：只有 code 能穿过 IPC 边界
    expect(Object.keys(call.body)).toEqual(['code'])
    expect(call.body).toEqual({ code: 'ABCD-EFGH-JKMN' })
    expect(call.body.plan).toBeUndefined()
    expect(call.body.durationDays).toBeUndefined()
  })

  it('body 缺失时不构造出带 undefined 键的请求', async () => {
    const { handlers, memberApiService, event } = createRedeemHandlers()
    await handlers['identity:redeem-code'](event, undefined)
    const call = memberApiService.request.mock.calls[0][0]
    expect(call.body).toEqual({ code: '' })
  })

  it('上游错误码放在 message 上供渲染层选文案', async () => {
    const { handlers, memberApiService, event } = createRedeemHandlers()
    const err = new Error('boom')
    err.code = 'REDEEM_CODE_USED'
    memberApiService.request.mockRejectedValue(err)
    await expect(handlers['identity:redeem-code'](event, { code: 'ABCD-EFGH-JKMN' }))
      .resolves.toMatchObject({ code: -3, message: 'REDEEM_CODE_USED' })
  })

  it('幂等重放且订阅为空时完整透出，渲染层才能区分过期', async () => {
    const { handlers, memberApiService, event } = createRedeemHandlers()
    memberApiService.request.mockResolvedValue({
      idempotent: true, plan: 'standard', subscription: null, periodEnd: null,
    })
    await expect(handlers['identity:redeem-code'](event, { code: 'ABCD-EFGH-JKMN' }))
      .resolves.toMatchObject({
        code: 0,
        data: { idempotent: true, plan: 'standard', subscription: null, periodEnd: null },
      })
  })

  it('不可信 sender 不能兑换', async () => {
    const { handlers, memberApiService } = createRedeemHandlers()
    await expect(handlers['identity:redeem-code'](
      { senderFrame: { url: 'https://evil.example' } },
      { code: 'ABCD-EFGH-JKMN' },
    )).resolves.toMatchObject({ code: -3 })
    expect(memberApiService.request).not.toHaveBeenCalled()
  })

  it('未登录时不得触发核销请求', async () => {
    const registerIdentityHandlers = require('./identity')
    const handlers = {}
    const memberApiService = { request: vi.fn() }
    registerIdentityHandlers(
      { handle: (channel, handler) => { handlers[channel] = handler } },
      { authService: { getState: () => ({ status: 'signed_out', user: null }), memberApiService } },
    )
    // 错误码要与服务端 BUSINESS_USER_REQUIRED 对齐：渲染层据此显示「请先登录」
    await expect(handlers['identity:redeem-code'](
      { senderFrame: { url: 'app://localhost/index.html' } },
      { code: 'ABCD-EFGH-JKMN' },
    )).resolves.toEqual({ code: -3, message: 'BUSINESS_USER_REQUIRED' })
    expect(memberApiService.request).not.toHaveBeenCalled()
  })

  it('读通道维持原语义：未登录仍交给下游判定，不被写通道的短路影响', async () => {
    // 守回归：requireSubject 只加在 redeem 上，读通道行为不能被顺带改掉。
    const registerIdentityHandlers = require('./identity')
    const handlers = {}
    const memberApiService = { request: vi.fn(async (payload) => ({ subject: payload.subject })) }
    registerIdentityHandlers(
      { handle: (channel, handler) => { handlers[channel] = handler } },
      { authService: { getState: () => ({ status: 'signed_out', user: null }), memberApiService } },
    )
    await handlers['identity:sessions']({ senderFrame: { url: 'app://localhost/index.html' } })
    expect(memberApiService.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/me/sessions', subject: null }),
    )
  })
})
