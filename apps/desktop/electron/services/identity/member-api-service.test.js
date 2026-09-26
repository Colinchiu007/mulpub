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
