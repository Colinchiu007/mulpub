describe('createMemberApiService', () => {
  function createFixture() {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sessions: [] }) }))
    const entitlementService = {
      apiUrl: 'https://api.example.com',
      deviceId: 'device-1',
      fetcher,
      canReadMembership: (subject) => subject === 'sub-1',
    }
    const tokenProvider = vi.fn(async () => 'access-1')
    const { createMemberApiService } = require('./member-api-service')
    return { fetcher, tokenProvider, service: createMemberApiService({ entitlementService, tokenProvider }) }
  }

  it('白名单 GET 携带 Bearer 与设备头并透传响应体', async () => {
    const { service, fetcher, tokenProvider } = createFixture()
    await expect(service.request({ subject: 'sub-1', path: '/api/v1/me/sessions' }))
      .resolves.toEqual({ sessions: [] })
    expect(tokenProvider).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com/api/v1/me/sessions', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer access-1', 'X-Device-Id': 'device-1' }),
    }))
  })

  it('POST 通道发送 JSON 空体并带 CSRF 头', async () => {
    const { service, fetcher } = createFixture()
    await service.request({ subject: 'sub-1', path: '/api/v1/me/notifications/read' })
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com/api/v1/me/notifications/read', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }),
      body: '{}',
    }))
  })

  it('白名单外路径拒绝且不发请求', async () => {
    const { service, fetcher } = createFixture()
    await expect(service.request({ subject: 'sub-1', path: '/api/v1/admin/users' }))
      .rejects.toMatchObject({ code: 'MEMBER_API_PATH_NOT_ALLOWED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('subject 与权益会话不一致时拒绝', async () => {
    const { service, fetcher } = createFixture()
    await expect(service.request({ subject: 'sub-evil', path: '/api/v1/me/sessions' }))
      .rejects.toMatchObject({ code: 'ENTITLEMENT_SESSION_MISMATCH' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('上游错误按语义错误码透传', async () => {
    const fixture = createFixture()
    fixture.fetcher.mockImplementation(async () => ({
      ok: false, status: 400, json: async () => ({ error: 'DEVICE_ID_REQUIRED' }),
    }))
    await expect(fixture.service.request({ subject: 'sub-1', path: '/api/v1/me/sessions/revoke-others' }))
      .rejects.toMatchObject({ code: 'DEVICE_ID_REQUIRED' })
  })
})

describe('createMemberApiService 激活码核销通道', () => {
  function createRedeemFixture(response) {
    const fetcher = vi.fn(async () => response)
    const entitlementService = {
      apiUrl: 'https://api.example.com',
      deviceId: 'device-1',
      fetcher,
      canReadMembership: (subject) => subject === 'sub-1',
    }
    const { createMemberApiService } = require('./member-api-service')
    const service = createMemberApiService({
      entitlementService,
      tokenProvider: vi.fn(async () => 'access-1'),
    })
    return { fetcher, service }
  }

  const okJson = (payload) => ({ ok: true, status: 200, json: async () => payload })

  it('POST /api/v1/redeem 发送 code 且带 JSON 头', async () => {
    const { service, fetcher } = createRedeemFixture(
      okJson({ idempotent: false, plan: 'standard', subscription: { plan: 'standard' }, periodEnd: '2026-12-31T00:00:00Z' }),
    )
    await expect(
      service.request({ subject: 'sub-1', path: '/api/v1/redeem', method: 'POST', body: { code: 'ABCD-EFGH-JKMN' } }),
    ).resolves.toMatchObject({ idempotent: false, plan: 'standard' })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/redeem',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-1',
          'X-Device-Id': 'device-1',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ code: 'ABCD-EFGH-JKMN' }),
      }),
    )
  })

  it('redeem 路径拒绝 GET —— 该端点只接受 POST，GET 会绕开请求体校验', async () => {
    const { service, fetcher } = createRedeemFixture(okJson({}))
    await expect(
      service.request({ subject: 'sub-1', path: '/api/v1/redeem', method: 'GET' }),
    ).rejects.toMatchObject({ code: 'MEMBER_API_METHOD_NOT_ALLOWED' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('上游业务错误码原样透传，不被改写成通用失败', async () => {
    const codes = ['REDEEM_CODE_FORMAT', 'REDEEM_CODE_NOT_FOUND', 'REDEEM_CODE_USED',
      'REDEEM_CODE_DISABLED', 'REDEEM_CODE_EXPIRED']
    for (const code of codes) {
      // 错误体形状以服务端 publish-api-commerce.js 的 _commerceFailure 为准：
      // { error: "<语义码>", message } —— error 是扁平字符串，不是 { error: { code } }。
      // 写成嵌套对象会让客户端拿不到语义码，静默退化成 MEMBER_API_REQUEST_FAILED。
      const { service } = createRedeemFixture({
        ok: false,
        status: code === 'REDEEM_CODE_EXPIRED' ? 410 : 400,
        json: async () => ({ error: code, message: code }),
      })
      await expect(
        service.request({ subject: 'sub-1', path: '/api/v1/redeem', method: 'POST', body: { code: 'X' } }),
      ).rejects.toMatchObject({ code })
    }
  })

  it('幂等重放时 subscription 为 null 必须原样透出，不得补成真值', async () => {
    // 服务端在「同码重放且订阅已过期」时返回 HTTP 200 + subscription: null。
    // 若这里把它抹成 {} 或丢弃，UI 会把过期重放误报成「兑换成功」。
    const { service } = createRedeemFixture(
      okJson({ idempotent: true, plan: 'standard', subscription: null, order: null, version: null, periodStart: null, periodEnd: null }),
    )
    const res = await service.request({
      subject: 'sub-1', path: '/api/v1/redeem', method: 'POST', body: { code: 'ABCD-EFGH-JKMN' },
    })
    expect(res.idempotent).toBe(true)
    expect(res.subscription).toBeNull()
    expect(res.periodEnd).toBeNull()
  })

  it('未授权 subject 不得调用 redeem', async () => {
    const { service, fetcher } = createRedeemFixture(okJson({}))
    await expect(
      service.request({ subject: 'sub-other', path: '/api/v1/redeem', method: 'POST', body: { code: 'X' } }),
    ).rejects.toMatchObject({ code: 'ENTITLEMENT_SESSION_MISMATCH' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
