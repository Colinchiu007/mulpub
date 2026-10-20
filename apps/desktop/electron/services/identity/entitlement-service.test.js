const crypto = require('crypto')

function sign(payload, privateKey) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.sign('RSA-SHA256', Buffer.from(encoded), privateKey).toString('base64url')
  return `${encoded}.${signature}`
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

describe('EntitlementService', () => {
  function createFixture(overrides = {}, snapshotExtras = {}) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const payload = {
      sub: 'sub-1', device_id: 'device-1', plan: 'pro', features: ['cloud_publish'],
      quota: { cloud_publish_monthly: 100 }, iat: 100, exp: 200, kid: 'key-1',
      ...snapshotExtras,
    }
    const token = sign(payload, privateKey)
    let persisted = null
    const storage = {
      save: vi.fn(async (value) => { persisted = value }),
      load: vi.fn(async () => persisted),
      clear: vi.fn(async () => { persisted = null }),
    }
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 'user-1', status: 'active' },
        entitlement: { plan: 'pro', features: ['cloud_publish'], quota: payload.quota, ...snapshotExtras },
        entitlementSnapshot: { token },
      }),
    }))
    const { EntitlementService } = require('./entitlement-service')
    const service = new EntitlementService({
      apiUrl: 'https://api.example.com',
      deviceId: 'device-1',
      publicKeys: { 'key-1': publicKey },
      storage,
      fetcher,
      now: () => 150,
      ...overrides,
    })
    return { service, storage, fetcher, token, payload, getPersisted: () => persisted }
  }

  it('在线同步 /api/v1/me，携带 Bearer 与设备 ID 并缓存有效签名快照', async () => {
    const { service, fetcher, token, getPersisted } = createFixture()

    await expect(service.sync({ subject: 'sub-1', accessToken: 'access-1' }))
      .resolves.toMatchObject({ plan: 'pro', features: ['cloud_publish'], source: 'online' })
    expect(fetcher).toHaveBeenCalledWith('https://api.example.com/api/v1/me', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer access-1', 'X-Device-Id': 'device-1' }),
    }))
    expect(getPersisted()).toEqual({ token })
  })

  it('透传 limits / 到期宽限字段（v2.0 C1.3 / C9.2）', async () => {
    const limits = {
      max_platforms: 15, daily_publish: 50, concurrent_tasks: 3,
      max_devices: 3, max_cloud_accounts: 20, batch_size_per_run: 10, model_tier: 1, plan_rank: 1,
    }
    const { service } = createFixture({}, { limits, graceUntil: '2026-10-30T00:00:00.000Z', previousPlan: 'pro' })

    const state = await service.sync({ subject: 'sub-1', accessToken: 'access-1' })
    // 发布页平台数校验的唯一数据源：丢了这个字段，档位承诺就是空头支票
    expect(state.limits).toMatchObject(limits)
    expect(state.graceUntil).toBe('2026-10-30T00:00:00.000Z')
    expect(state.previousPlan).toBe('pro')
    // 深拷贝隔离：调用方改坏返回值不得污染服务内部权益
    state.limits.max_platforms = 999
    expect(service.getState().limits.max_platforms).toBe(15)
  })

  it('limits 缺失或非法形状时不写入（缺失即放行，由客户端按不限处理）', async () => {
    const { service } = createFixture({}, { limits: 'oops' })
    const state = await service.sync({ subject: 'sub-1', accessToken: 'access-1' })
    expect(state.limits).toBeUndefined()
  })

  it('离线恢复只接受绑定当前账号和设备且未过期的签名快照', async () => {
    const { service, storage, token } = createFixture()
    await storage.save({ token })

    await expect(service.restore('sub-1'))
      .resolves.toMatchObject({ plan: 'pro', features: ['cloud_publish'], source: 'offline' })
    await expect(service.restore('sub-other')).resolves.toBeNull()
    expect(storage.clear).toHaveBeenCalled()
  })

  it('在线同步和离线恢复默认允许服务端快 2 秒', async () => {
    const online = createFixture({ now: () => 98 })
    await expect(online.service.sync({ subject: 'sub-1', accessToken: 'access-1' }))
      .resolves.toMatchObject({ subject: 'sub-1', source: 'online' })

    const offline = createFixture({ now: () => 98 })
    await offline.storage.save({ token: offline.token })
    await expect(offline.service.restore('sub-1'))
      .resolves.toMatchObject({ subject: 'sub-1', source: 'offline' })
  })

  it('显式严格模式和超过 60 秒的偏差仍然拒绝权益快照', async () => {
    const strict = createFixture({ now: () => 98, clockTolerance: 0 })
    await expect(strict.service.sync({ subject: 'sub-1', accessToken: 'access-1' }))
      .rejects.toMatchObject({ code: 'ENTITLEMENT_EXPIRED' })

    const beyondTolerance = createFixture({ now: () => 39 })
    await beyondTolerance.storage.save({ token: beyondTolerance.token })
    await expect(beyondTolerance.service.restore('sub-1')).resolves.toBeNull()
    expect(beyondTolerance.storage.clear).toHaveBeenCalled()
  })

  it('服务端用户被暂停时拒绝同步权益并清缓存', async () => {
    const { service, storage } = createFixture({
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ user: { status: 'suspended' }, entitlement: { plan: 'pro', features: ['cloud_publish'] } }),
      }),
    })

    await expect(service.sync({ subject: 'sub-1', accessToken: 'access-1' }))
      .rejects.toMatchObject({ code: 'ENTITLEMENT_USER_INACTIVE' })
    expect(storage.clear).toHaveBeenCalled()
  })

  it('在线同步失败不会把离线缓存冒充为在线写权限', async () => {
    const { service } = createFixture({ fetcher: async () => { throw new Error('network down') } })

    await expect(service.sync({ subject: 'sub-1', accessToken: 'access-1' }))
      .rejects.toMatchObject({ code: 'ENTITLEMENT_SYNC_FAILED' })
    expect(service.hasFeature('cloud_publish', { onlineOnly: true })).toBe(false)
  })

  it('clear 后才完成的旧同步不能恢复权益和缓存', async () => {
    const response = deferred()
    const fixture = createFixture({ fetcher: vi.fn(() => response.promise) })

    const syncing = fixture.service.sync({ subject: 'sub-1', accessToken: 'access-old' })
    await fixture.service.clear()
    response.resolve({
      ok: true,
      json: async () => ({
        user: { status: 'active' },
        entitlement: { plan: 'pro', features: ['cloud_publish'] },
        entitlementSnapshot: { token: fixture.token },
      }),
    })

    await syncing
    expect(fixture.service.getState()).toBeNull()
    expect(fixture.getPersisted()).toBeNull()
  })

  it('两个账号并发同步时只保留最后发起的账号', async () => {
    const responseA = deferred()
    const responseB = deferred()
    const fetcher = vi.fn((_url, options) => options.headers.Authorization === 'Bearer access-a'
      ? responseA.promise
      : responseB.promise)
    const { service } = createFixture({ publicKeys: {}, fetcher })
    const syncingA = service.sync({ subject: 'sub-a', accessToken: 'access-a' })
    const syncingB = service.sync({ subject: 'sub-b', accessToken: 'access-b' })
    responseB.resolve({
      ok: true,
      json: async () => ({ user: { status: 'active' }, entitlement: { plan: 'pro', features: ['feature-b'] } }),
    })
    await syncingB
    responseA.resolve({
      ok: true,
      json: async () => ({ user: { status: 'active' }, entitlement: { plan: 'pro', features: ['feature-a'] } }),
    })
    await syncingA

    expect(service.getState()).toMatchObject({ subject: 'sub-b', features: ['feature-b'] })
  })

  it('旧同步失败不能清掉新账号已经写入的权益', async () => {
    const responseA = deferred()
    const responseB = deferred()
    const fetcher = vi.fn((_url, options) => options.headers.Authorization === 'Bearer access-a'
      ? responseA.promise
      : responseB.promise)
    const fixture = createFixture({ publicKeys: {}, fetcher })
    const syncingA = fixture.service.sync({ subject: 'sub-a', accessToken: 'access-a' })
    const syncingB = fixture.service.sync({ subject: 'sub-b', accessToken: 'access-b' })
    responseB.resolve({
      ok: true,
      json: async () => ({ user: { status: 'active' }, entitlement: { plan: 'pro', features: ['feature-b'] } }),
    })
    await syncingB
    responseA.resolve({ ok: false, status: 403, json: async () => ({}) })

    await expect(syncingA).rejects.toMatchObject({ code: 'ENTITLEMENT_SYNC_FAILED' })
    expect(fixture.service.getState()).toMatchObject({ subject: 'sub-b', features: ['feature-b'] })
  })
})

// 2026-10-07：取真实价目目录（/api/v1/plans）。
//
// 逃逸分析：`UpgradeModal` 此前**不显示任何价格**（正式包显示「付费通道筹备中」），
// 营销文档里的 ¥29/¥199/¥79/¥599 是手写的。没有测试覆盖「UI 显示的价格从哪来」，
// 于是「凭记忆写死价格」和「从服务端取价」在测试视角下完全等价。
describe('价目目录 /api/v1/plans（2026-10-07）', () => {
  const { EntitlementService } = require('./entitlement-service')

  const PLANS_BODY = {
    plans: [
      { id: 'free', label: '免费版', currency: 'CNY', priceMonthlyCents: 0, priceYearlyCents: 0 },
      { id: 'standard', label: '标准版', currency: 'CNY', priceMonthlyCents: 2900, priceYearlyCents: 19900 },
      { id: 'pro', label: '专业版', currency: 'CNY', priceMonthlyCents: 7900, priceYearlyCents: 59900 },
    ],
  }

  function makeService(fetcher) {
    return new EntitlementService({
      apiUrl: 'https://api.example.com',
      deviceId: 'device-1',
      publicKeys: {},
      storage: { read: async () => null, write: async () => {}, clear: async () => {} },
      fetcher,
    })
  }

  it('携带 Bearer 请求 /api/v1/plans 并返回规范化目录', async () => {
    const seen = []
    const service = makeService(async (url, init) => {
      seen.push({ url, init })
      return { ok: true, status: 200, json: async () => PLANS_BODY }
    })

    const plans = await service.fetchPlans({ accessToken: 'tok-1' })

    expect(seen[0].url).toBe('https://api.example.com/api/v1/plans')
    expect(seen[0].init.headers.Authorization).toBe('Bearer tok-1')
    expect(plans).toHaveLength(3)
    expect(plans[1]).toMatchObject({ id: 'standard', priceMonthlyCents: 2900, priceYearlyCents: 19900 })
  })

  it('拒绝缺失/非法的 accessToken（不发明请求）', async () => {
    let called = 0
    const service = makeService(async () => { called++; return { ok: true, status: 200, json: async () => PLANS_BODY } })
    await expect(service.fetchPlans({ accessToken: '' })).rejects.toThrow()
    await expect(service.fetchPlans({})).rejects.toThrow()
    expect(called).toBe(0)
  })

  it('非 2xx ⇒ 抛错（不返回半截数据）', async () => {
    const service = makeService(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) }))
    await expect(service.fetchPlans({ accessToken: 't' })).rejects.toThrow()
  })

  it('响应结构非法 ⇒ 抛错，绝不返回空数组冒充「没有套餐」', async () => {
    // 空数组会让 UI 渲染出「无价格」的空目录，看起来像服务端没配价格——
    // 这与「取价失败」是两回事，必须能区分。
    const service = makeService(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    await expect(service.fetchPlans({ accessToken: 't' })).rejects.toThrow()
  })

  it('丢弃缺 id 或价格非整数的条目，但保留其余合法条目', async () => {
    const service = makeService(async () => ({
      ok: true, status: 200, json: async () => ({
        plans: [
          { id: 'good', label: '好', currency: 'CNY', priceMonthlyCents: 100, priceYearlyCents: 1000 },
          { label: '无 id', currency: 'CNY', priceMonthlyCents: 1, priceYearlyCents: 1 },
          { id: 'bad', currency: 'CNY', priceMonthlyCents: '2900', priceYearlyCents: 19900 },
        ],
      }),
    }))
    const plans = await service.fetchPlans({ accessToken: 't' })
    expect(plans.map((p) => p.id)).toEqual(['good'])
  })

  it('网络异常 ⇒ 抛错（由调用方决定降级为 null，不在此处伪造）', async () => {
    const service = makeService(async () => { throw new Error('network down') })
    await expect(service.fetchPlans({ accessToken: 't' })).rejects.toThrow()
  })
})
