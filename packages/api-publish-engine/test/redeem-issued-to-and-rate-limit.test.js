'use strict'

const assert = require('assert')
const http = require('http')
const test = require('node:test')

const { SubscriptionService } = require('../src/auth/subscription-service')
const { RedeemFailureLimiter, isProbeFailure } = require('../src/auth/redeem-rate-limit')
const { TestPublishApiServer: PublishApiServer } = require('./test-publish-api-server')

// ── 一、issued_to（发放对象）链路 ────────────────────────────────────────

test('createRedeemBatch 把 issued_to（发放对象）透传到仓储，并去空白', async () => {
  const created = []
  const service = new SubscriptionService({
    repository: {
      async createRedeemCodes(records) { created.push(...records); return records.map((r) => r.code) },
    },
    now: () => new Date('2026-10-24T00:00:00Z'),
  })
  const result = await service.createRedeemBatch({
    plan: 'standard', durationDays: 30, count: 3, issuedTo: '  渠道A  ',
  })
  assert.strictEqual(created.length, 3)
  for (const record of created) assert.strictEqual(record.issuedTo, '渠道A')
  assert.strictEqual(result.issuedTo, '渠道A')
})

test('issued_to 是**透传**而不是写死的常量（两个不同值各自归位）', async () => {
  const created = []
  const service = new SubscriptionService({
    repository: {
      async createRedeemCodes(records) { created.push(...records); return records.map((r) => r.code) },
    },
    now: () => new Date('2026-10-24T00:00:00Z'),
  })
  await service.createRedeemBatch({ plan: 'standard', durationDays: 30, count: 1, issuedTo: '渠道A' })
  await service.createRedeemBatch({ plan: 'pro', durationDays: 90, count: 1, issuedTo: '渠道B' })
  assert.strictEqual(created.length, 2)
  assert.strictEqual(created[0].issuedTo, '渠道A')
  assert.strictEqual(created[1].issuedTo, '渠道B')
  // ⚠️ 若实现把 issuedTo 写死成某一个常量，上面两条断言里至少有一条会红。
  assert.notStrictEqual(created[0].issuedTo, created[1].issuedTo)
})

test('issued_to 为空/空白 ⇒ 视为未填（null），不是错误', async () => {
  const created = []
  const service = new SubscriptionService({
    repository: {
      async createRedeemCodes(records) { created.push(...records); return records.map((r) => r.code) },
    },
    now: () => new Date('2026-10-24T00:00:00Z'),
  })
  const result = await service.createRedeemBatch({ plan: 'pro', durationDays: 90, count: 1, issuedTo: '   ' })
  assert.strictEqual(created[0].issuedTo, null)
  assert.strictEqual(result.issuedTo, null)
})

test('issued_to 类型错 ⇒ 400 ISSUED_TO_INVALID（不静默吞）', async () => {
  const service = new SubscriptionService({
    repository: { async createRedeemCodes() { throw new Error('不应入库') } },
    now: () => new Date('2026-10-24T00:00:00Z'),
  })
  await assert.rejects(
    () => service.createRedeemBatch({ plan: 'pro', durationDays: 90, count: 1, issuedTo: 123 }),
    (error) => error.code === 'ISSUED_TO_INVALID' && error.status === 400
  )
})

test('issued_to 超长 ⇒ 400 ISSUED_TO_INVALID（闸门在入口，不在数据库）', async () => {
  const service = new SubscriptionService({
    repository: { async createRedeemCodes() { throw new Error('不应入库') } },
    now: () => new Date('2026-10-24T00:00:00Z'),
  })
  await assert.rejects(
    () => service.createRedeemBatch({ plan: 'pro', durationDays: 90, count: 1, issuedTo: 'x'.repeat(201) }),
    (error) => error.code === 'ISSUED_TO_INVALID' && error.status === 400
  )
})

test('listRedeemCodes：issued_to 为 null 或缺字段时映射成 null（不是 undefined）', async () => {
  const service = new SubscriptionService({
    repository: {
      async listRedeemCodes() {
        return [
          { code: 'ABCD-EFGH-JKMN', plan: 'standard', duration_days: 30, batch: 'b1', status: 'active', used_by: null, used_at: null, expires_at: null, created_at: '2026-10-24T00:00:00Z', issued_to: null },
          { code: 'WXYZ-2345-JKMN', plan: 'pro', duration_days: 90, batch: 'b2', status: 'active', used_by: null, used_at: null, expires_at: null, created_at: '2026-10-24T00:00:00Z' },
        ]
      },
      async countRedeemCodes() { return 2 },
    },
    now: () => new Date('2026-10-24T00:00:00Z'),
  })
  const result = await service.listRedeemCodes({})
  assert.strictEqual(result.codes[0].issuedTo, null)
  assert.strictEqual(result.codes[1].issuedTo, null)
  // ⚠️ 契约要求是 null 而不是 undefined：JSON 序列化后 undefined 字段会整条消失
  assert.ok(Object.prototype.hasOwnProperty.call(result.codes[0], 'issuedTo'))
})

test('listRedeemCodes 把 issued_to 映射成 issuedTo', async () => {
  const service = new SubscriptionService({
    repository: {
      async listRedeemCodes() {
        return [{ code: 'ABCD-EFGH-JKMN', plan: 'standard', duration_days: 90, batch: 'b1', status: 'active', used_by: null, used_at: null, expires_at: null, created_at: '2026-10-24T00:00:00Z', issued_to: '渠道A' }]
      },
      async countRedeemCodes() { return 1 },
    },
    now: () => new Date('2026-10-24T00:00:00Z'),
  })
  const result = await service.listRedeemCodes({})
  assert.strictEqual(result.codes[0].issuedTo, '渠道A')
  assert.strictEqual(result.codes[0].durationDays, 90)
})

// ── 二、限流器（温和档）单元行为 ─────────────────────────────────────────

test('限流器：失败累计到阈值后放行门关闭（按真实调用序列 acquire → recordFailure）', () => {
  const limiter = new RedeemFailureLimiter({ userWindowMs: 60000, userMaxFailures: 5, ipWindowMs: 600000, ipMaxFailures: 30 })
  try {
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(limiter.acquire('u1', '1.1.1.1').blocked, false)
      limiter.recordFailure('u1', '1.1.1.1')
    }
    assert.strictEqual(limiter.acquire('u1', '1.1.1.1').blocked, false)
    limiter.recordFailure('u1', '1.1.1.1')
    // 第 6 次应当被拦
    const gate = limiter.acquire('u1', '1.1.1.1')
    assert.strictEqual(gate.blocked, true)
    assert.strictEqual(gate.scope, 'user')
    // 另一个用户不受影响
    assert.strictEqual(limiter.acquire('u2', '1.1.1.1').blocked, false)
  } finally { limiter.stop() }
})

test('限流器：并发请求无法绕过（预占额度 ⇒ 同一瞬间只有阈值个能进）', () => {
  const limiter = new RedeemFailureLimiter({ userWindowMs: 60000, userMaxFailures: 5, ipWindowMs: 600000, ipMaxFailures: 30 })
  try {
    // 20 个「同时」到达的请求：acquire 是同步的（内部无 await）⇒ 等价于并发同时判定
    const results = []
    for (let i = 0; i < 20; i++) results.push(limiter.acquire('u1', '1.1.1.1'))
    const allowed = results.filter((r) => !r.blocked).length
    const blocked = results.filter((r) => r.blocked).length
    assert.strictEqual(allowed, 5, '只有阈值（5）个请求能进，其余当场被拦')
    assert.strictEqual(blocked, 15)
  } finally { limiter.stop() }
})

test('限流器：一次成功清零该用户的失败计数', () => {
  const limiter = new RedeemFailureLimiter({ userWindowMs: 60000, userMaxFailures: 2, ipWindowMs: 600000, ipMaxFailures: 30 })
  try {
    limiter.acquire('u1', '1.1.1.1'); limiter.recordFailure('u1', '1.1.1.1')
    limiter.acquire('u1', '1.1.1.1'); limiter.recordFailure('u1', '1.1.1.1')
    assert.strictEqual(limiter.acquire('u1', '1.1.1.1').blocked, true)
    limiter.recordSuccess('u1')
    assert.strictEqual(limiter.acquire('u1', '1.1.1.1').blocked, false)
  } finally { limiter.stop() }
})

test('限流器：IP 维度在「速率条件」满足时独立生效', () => {
  const limiter = new RedeemFailureLimiter({
    userWindowMs: 60000, userMaxFailures: 100,
    ipWindowMs: 600000, ipMaxFailures: 3,
    ipBurstWindowMs: 60000, ipBurstFailures: 3,
  })
  try {
    for (let i = 0; i < 3; i++) limiter.recordFailure(`u${i}`, '9.9.9.9')
    const gate = limiter.acquire('fresh-user', '9.9.9.9')
    assert.strictEqual(gate.blocked, true)
    assert.strictEqual(gate.scope, 'ip')
  } finally { limiter.stop() }
})

test('限流器：共享出口下的慢速偶发失败**不**触发 IP 档（防误伤同出口所有正常用户）', () => {
  // 可注入时钟：不靠真实等待就能构造「10 分钟内 30 次、最近 60 秒内只有 3 次」这一格。
  let clock = Date.parse('2026-10-24T00:00:00Z')
  // ⚠️ 阈值用**生产默认**（200），不要为「测得快」调小 —— 调小会让本用例变成另一个语义。
  const limiter = new RedeemFailureLimiter({
    userWindowMs: 60000, userMaxFailures: 100,
    ipWindowMs: 600000, ipMaxFailures: 200,
    ipBurstWindowMs: 60000, ipBurstFailures: 60,
    now: () => clock,
  })
  try {
    // 30 个不同用户在同一出口 IP 上各失败 1 次（公司 NAT / 校园网的典型形态），
    // 每次间隔 19 秒 ⇒ 10 分钟内共 30 次。
    // ⇒ 总量 30 < 200（不达标）、最近 60 秒内 3 次 < 60（不达标）⇒ 两个条件都不达标 ⇒ 不拦。
    for (let i = 0; i < 30; i++) {
      clock += 19 * 1000
      limiter.acquire(`u${i}`, '9.9.9.9')
      limiter.recordFailure(`u${i}`, '9.9.9.9')
    }
    const counts = limiter.counts(null, '9.9.9.9')
    assert.strictEqual(counts.ipFailures, 30)
    const gate = limiter.acquire('fresh-user', '9.9.9.9')
    assert.strictEqual(gate.blocked, false, '慢速分散失败不应锁死整个出口')
  } finally { limiter.stop() }
})

test('IP 取值：X-Forwarded-For 取**最右**元素（反代拓扑下 socket 恒为回环地址）', () => {
  // 红队实测打穿：生产 nginx 把 /api/v1/ 反代到 127.0.0.1:3030、引擎只绑回环
  // ⇒ req.socket.remoteAddress 恒为 127.0.0.1 ⇒ 若以 socket 为准，
  // **全站所有用户共用同一个 IP 桶** ⇒ 攻击者打满它，所有正常用户也换不了。
  // ⇒ 必须优先取 XFF；且取**最右**（nginx 的 $proxy_add_x_forwarded_for 把它看到的
  // 真实客户端 IP 追加在末尾，取最左的话客户端自带伪造 XFF 就能把计数打到别人头上）。
  const { PublishApiRedeemHelpers } = require('../src/auth/publish-api-redeem')
  const helper = Object.create(PublishApiRedeemHelpers.prototype)
  // ⚠️ req 的形状是 { headers: <headers对象>, socket: <socket对象> }
  //    ⇒ 第一个参数是**裸的 headers**，第二个是**裸的 socket**，不要再多包一层。
  const ipOf = (headers, socket) => helper._redeemClientIp({ headers: headers, socket: socket })

  assert.strictEqual(ipOf({ 'x-forwarded-for': '1.2.3.4' }, { remoteAddress: '127.0.0.1' }), '1.2.3.4')
  assert.strictEqual(ipOf({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, { remoteAddress: '127.0.0.1' }), '5.6.7.8')
  // 没有 XFF 时回退到 socket（直连场景）
  assert.strictEqual(ipOf({}, { remoteAddress: '9.9.9.9' }), '9.9.9.9')
  // XFF 为空串 ⇒ 回退
  assert.strictEqual(ipOf({ 'x-forwarded-for': '  ' }, { remoteAddress: '9.9.9.9' }), '9.9.9.9')
})

test('限流器：IP 档在「总量达标但速率不达标」时也触发（节流规避形态）', () => {
  // 红队实测打穿：两条件若是 AND，把速率压在 60 次/分以下就能让 burst 永不达标
  // ⇒ 即便 10 分钟累计 500+ 次失败，IP 档也一条不拦（实测 1770 次 0 次 429）。
  // ⇒ 两个条件必须是 OR。
  let clock = Date.parse('2026-10-24T00:00:00Z')
  const limiter = new RedeemFailureLimiter({
    userWindowMs: 60000, userMaxFailures: 100,
    ipWindowMs: 600000, ipMaxFailures: 200,
    ipBurstWindowMs: 60000, ipBurstFailures: 60,
    now: () => clock,
  })
  try {
    // 每 2.5 秒一次 ⇒ 10 分钟 240 次；最近 60 秒内只有 24 次（< 60 ⇒ 速率不达标）
    for (let i = 0; i < 240; i++) {
      clock += 2500
      limiter.acquire(`u${i}`, '6.6.6.6')
      limiter.recordFailure(`u${i}`, '6.6.6.6')
    }
    const counts = limiter.counts(null, '6.6.6.6')
    assert.strictEqual(counts.ipFailures, 240, '总量已远超阈值')
    const gate = limiter.acquire('fresh-user', '6.6.6.6')
    assert.strictEqual(gate.blocked, true, '节流规避（低速但量大）也必须被 IP 档拦住')
    assert.strictEqual(gate.scope, 'ip')
  } finally { limiter.stop() }
})

test('限流器：IP 档在速率条件也满足时触发（单 IP 快速探测）', () => {
  let clock = Date.parse('2026-10-24T00:00:00Z')
  const limiter = new RedeemFailureLimiter({
    userWindowMs: 60000, userMaxFailures: 100,
    ipWindowMs: 600000, ipMaxFailures: 30,
    ipBurstWindowMs: 60000, ipBurstFailures: 10,
    now: () => clock,
  })
  try {
    // 30 次失败集中在 30 秒内 ⇒ 总量与速率都满足 ⇒ 触发
    for (let i = 0; i < 30; i++) {
      clock += 1000
      limiter.acquire(`u${i}`, '8.8.8.8')
      limiter.recordFailure(`u${i}`, '8.8.8.8')
    }
    const gate = limiter.acquire('fresh-user', '8.8.8.8')
    assert.strictEqual(gate.blocked, true, '单 IP 快速探测应被 IP 档拦住')
    assert.strictEqual(gate.scope, 'ip')
  } finally { limiter.stop() }
})

test('限流器：窗口过期后计数归零（滑窗真的会滑）', () => {
  let clock = Date.parse('2026-10-24T00:00:00Z')
  const limiter = new RedeemFailureLimiter({
    userWindowMs: 60000, userMaxFailures: 2,
    ipWindowMs: 600000, ipMaxFailures: 30,
    now: () => clock,
  })
  try {
    limiter.acquire('u1', '7.7.7.7'); limiter.recordFailure('u1', '7.7.7.7')
    limiter.acquire('u1', '7.7.7.7'); limiter.recordFailure('u1', '7.7.7.7')
    assert.strictEqual(limiter.acquire('u1', '7.7.7.7').blocked, true)
    clock += 61 * 1000
    assert.strictEqual(limiter.acquire('u1', '7.7.7.7').blocked, false, '窗口过后应重新放行')
  } finally { limiter.stop() }
})

test('探测型失败的口径：格式错/不存在/已被别人用过/已作废 都算；过期与服务端故障不算', () => {
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_FORMAT' }), true)
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_NOT_FOUND' }), true)
  // 红队打穿点④：「已用/已停用不计数」⇒ 攻击者拿泄漏清单逐个试，
  // 已被别人用过的码回 409 且不计数 ⇒ 免费的存在性预言机。
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_USED' }), true)
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_DISABLED' }), true)
  // 过期是正常业务（买了没兑、过期了又来试）；服务端故障也不是用户的错
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_EXPIRED' }), false)
  assert.strictEqual(isProbeFailure({ code: 'INTERNAL_SERVER_ERROR' }), false)
  assert.strictEqual(isProbeFailure(null), false)
})

// ── 三、接线验证：限流门真的在生产路径上（不是「单测全绿但没人调用」）──

function request(port, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method, path,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }) }
        catch (error) { reject(new Error(`响应非 JSON (${res.statusCode}): ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function createIdentityRepository(id) {
  // ⚠️ 鉴权在找不到用户时会走 create()：缺这个方法 ⇒ 抛 TypeError 被吞 ⇒
  // req.auth.businessUser 填不上 ⇒ _memberUserId 返回 null ⇒ 503。
  return {
    async findBySubject(provider, subject) {
      return { id, auth_provider: provider, auth_subject: subject, status: 'active', display_name: '测试用户' }
    },
    async create() { throw new Error('存量测试不应创建用户') },
  }
}

function createVerifier() {
  return {
    verify: async (token) => {
      if (token === 'member-write') return { subject: 'sub-me', scopes: ['profile:read', 'profile:write'] }
      if (token === 'admin-token') return { subject: 'sub-admin', scopes: ['admin:users'] }
      throw Object.assign(new Error('AUTH_TOKEN_INVALID'), { code: 'AUTH_TOKEN_INVALID', status: 401 })
    },
  }
}

test('接线：连续探测式失败超过阈值后，端点真的返回 429（限流门在生产路径上）', async () => {
  const service = {
    repository: {},
    planOverrides: null,
    async redeem() {
      throw Object.assign(new Error('兑换码不存在'), { code: 'REDEEM_CODE_NOT_FOUND', status: 404 })
    },
  }
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-1'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    // 前 5 次：正常返回 404（码不存在）
    for (let i = 0; i < 5; i++) {
      const res = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
      assert.strictEqual(res.status, 404, `第 ${i + 1} 次应仍是 404`)
    }
    // 第 6 次：被限流门拦下
    const blocked = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(blocked.status, 429)
    assert.strictEqual(blocked.body.error, 'REDEEM_RATE_LIMITED')
    // ⚠️ 不得透露剩余次数（否则限流器本身可被探测）
    assert.strictEqual(JSON.stringify(blocked.body).includes('remaining'), false)
  } finally {
    await server.stop()
  }
})

test('接线：幂等重放（200 + idempotent:true）**不得**清零失败计数', async () => {
  // 红队实测打穿：幂等重放也返回 200 ⇒ 若路由把它当「成功」处理，
  // 攻击者拿**一个已用码**反复重放就能无限清零失败计数 ⇒ 用户档限流彻底失效。
  let mode = 'fail'
  const service = {
    repository: {},
    planOverrides: null,
    async redeem() {
      if (mode === 'fail') {
        throw Object.assign(new Error('兑换码不存在'), { code: 'REDEEM_CODE_NOT_FOUND', status: 404 })
      }
      // 幂等重放：HTTP 200，但 idempotent 为 true
      return { idempotent: true, code: 'ABCD-EFGH-JKMN', plan: 'standard', subscription: null, periodEnd: null }
    },
  }
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-7'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    // 失败 4 次 ⇒ 失败计数 4（阈值 5）
    for (let i = 0; i < 4; i++) {
      assert.strictEqual((await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })).status, 404)
    }
    // 切到幂等重放：连续 3 次 200
    mode = 'replay'
    for (let i = 0; i < 3; i++) {
      assert.strictEqual((await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })).status, 200)
    }
    // 失败计数**没被清零** ⇒ 再失败 1 次就到 5 ⇒ 下一次被拦
    mode = 'fail'
    assert.strictEqual((await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })).status, 404)
    assert.strictEqual((await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })).status, 429)
  } finally {
    await server.stop()
  }
})

test('接线：一次成功后失败计数被清零（路由层确实调用了 recordSuccess）', async () => {
  let call = 0
  const service = {
    repository: {},
    planOverrides: null,
    async redeem() {
      call += 1
      // 第 3 次成功，其余失败
      if (call === 3) return { idempotent: false, plan: 'standard', subscription: null, periodEnd: null }
      throw Object.assign(new Error('兑换码不存在'), { code: 'REDEEM_CODE_NOT_FOUND', status: 404 })
    },
  }
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-4'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    // 失败 2 次 → 计数 2
    assert.strictEqual((await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })).status, 404)
    assert.strictEqual((await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })).status, 404)
    // 第 3 次成功 ⇒ 成功路径必须清零失败计数
    assert.strictEqual((await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })).status, 200)
    // 若成功没有清零，失败计数仍是 2 ⇒ 第 4 次失败就会被拦（有效占用 = 失败数 + 待定 ≥ 5）；
    // 清零了 ⇒ 还能再失败 5 次，第 6 次才拦。
    // ⇒ 「循环内全是 404」这条断言本身就区分了两种实现。
    for (let i = 0; i < 5; i++) {
      const res = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })
      assert.strictEqual(res.status, 404, `成功后第 ${i + 1} 次失败应是 404（说明计数已清零）`)
    }
    assert.strictEqual((await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'X' })).status, 429)
  } finally {
    await server.stop()
  }
})

test('接线：运营签发端点确实把 issuedTo 转发给了服务层', async () => {
  const seen = []
  const service = {
    repository: {},
    planOverrides: null,
    async redeem() { throw Object.assign(new Error('x'), { code: 'REDEEM_CODE_NOT_FOUND', status: 404 }) },
    async createRedeemBatch(payload) {
      seen.push(payload)
      return { batch: 'b1', plan: payload.plan, durationDays: payload.durationDays, issuedTo: payload.issuedTo, requested: 1, generated: 1, codes: ['ABCD-EFGH-JKMN'] }
    },
  }
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-5'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    const res = await request(port, 'POST', '/api/v1/admin/member/redeem-codes', 'admin-token', {
      plan: 'standard', durationDays: 90, count: 1, issuedTo: '渠道Z',
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(seen.length, 1)
    // ⚠️ 若运营端点没转发 issuedTo，这里拿到的会是 undefined
    assert.strictEqual(seen[0].issuedTo, '渠道Z')
    assert.strictEqual(res.body.issuedTo, '渠道Z')
  } finally {
    await server.stop()
  }
})

test('接线：三类花钱动作都留审计，且**业务字段在 details 里**（不是被静默丢弃的顶层字段）', async () => {
  const seen = []
  const service = {
    repository: {},
    planOverrides: null,
    async redeem() { throw Object.assign(new Error('x'), { code: 'REDEEM_CODE_NOT_FOUND', status: 404 }) },
    async createRedeemBatch(payload) {
      seen.push(payload)
      return { batch: 'b-audit', plan: payload.plan, durationDays: payload.durationDays, issuedTo: payload.issuedTo, requested: 1, generated: 1, codes: ['ABCD-EFGH-JKMN'] }
    },
    async grant({ userId, plan, durationDays }) {
      return { plan, durationDays, order: { id: 'ord-audit', channel: 'admin_grant' } }
    },
    async disableRedeemCode({ code }) {
      return { code, status: 'disabled', idempotent: false }
    },
  }
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-6'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    // ① 批量签发
    const issued = await request(port, 'POST', '/api/v1/admin/member/redeem-codes', 'admin-token', {
      plan: 'standard', durationDays: 90, count: 1, issuedTo: '渠道Z',
    })
    assert.strictEqual(issued.status, 200)
    // ② 手动开通
    const granted = await request(port, 'POST', '/api/v1/admin/member/grant', 'admin-token', {
      userId: 'u-6', plan: 'pro', durationDays: 30,
    })
    assert.strictEqual(granted.status, 200)
    // ③ 作废
    const disabled = await request(port, 'POST', '/api/v1/admin/member/redeem-codes/disable', 'admin-token', {
      code: 'ABCD-EFGH-JKMN',
    })
    assert.strictEqual(disabled.status, 200)

    const entries = server._auditLog.list()
    const byType = (t) => entries.find((e) => e.type === t)

    // ⚠️ 本条断言锁的是一个**静默丢弃**形态：`AuditLog.log` 只认一组固定字段
    // （id/ownerSubject/type/platform/title/status/error/publishId/details/createdAt），
    // 直接把业务字段放在顶层会被**无声丢掉** ⇒ 审计里只剩「发生过」，看不到「发生了什么」。
    // ⇒ 业务字段必须装在 `details` 里。
    const issuedEntry = byType('redeem_code_batch_issued')
    assert.ok(issuedEntry, '批量签发必须有审计记录')
    assert.ok(issuedEntry.details, '审计的业务字段必须在 details 里')
    assert.strictEqual(issuedEntry.details.issuedTo, '渠道Z')
    assert.strictEqual(issuedEntry.details.batch, 'b-audit')
    assert.strictEqual(issuedEntry.details.plan, 'standard')
    assert.strictEqual(issuedEntry.details.durationDays, 90)
    assert.strictEqual(issuedEntry.details.count, 1)
    // 顶层不该有这些字段（若将来有人挪回顶层，这条会提醒它又会被丢弃）
    assert.strictEqual(issuedEntry.issuedTo, undefined)
    assert.strictEqual(issuedEntry.batch, undefined)

    const grantEntry = byType('member_grant')
    assert.ok(grantEntry, '手动开通必须有审计记录')
    assert.strictEqual(grantEntry.details.userId, 'u-6')
    assert.strictEqual(grantEntry.details.plan, 'pro')
    assert.strictEqual(grantEntry.details.durationDays, 30)

    const disabledEntry = byType('redeem_code_disabled')
    assert.ok(disabledEntry, '作废必须有审计记录')
    assert.strictEqual(disabledEntry.details.code, 'ABCD-EFGH-JKMN')
  } finally {
    await server.stop()
  }
})

test('接线：20 个并发请求不能绕过限流（预占额度 ⇒ 只有阈值个能进）', async () => {
  const service = {
    repository: {},
    planOverrides: null,
    async redeem() {
      throw Object.assign(new Error('兑换码不存在'), { code: 'REDEEM_CODE_NOT_FOUND', status: 404 })
    },
  }
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-3'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' }))
    )
    const allowed = responses.filter((r) => r.status === 404).length
    const limited = responses.filter((r) => r.status === 429).length
    assert.strictEqual(allowed, 5, `只有 5 个并发请求能进，实际 ${allowed}`)
    assert.strictEqual(limited, 15, `其余 15 个应被限流，实际 ${limited}`)
  } finally {
    await server.stop()
  }
})

test('接线：自己重放已用过的码（200 幂等）不计入失败计数 ⇒ 不会被限流', async () => {
  // ⚠️ 「自己重放」真实返回的是 **200 + idempotent:true**（走成功路径），
  // 而 409 REDEEM_CODE_USED 是「**别人**用过」⇒ 那是探测行为 ⇒ 计入（见下一个用例）。
  const service = {
    repository: {},
    planOverrides: null,
    async redeem() {
      return { idempotent: true, code: 'ABCD-EFGH-JKMN', plan: 'standard', subscription: null, periodEnd: null }
    },
  }
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-2'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    for (let i = 0; i < 8; i++) {
      const res = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
      assert.strictEqual(res.status, 200, `第 ${i + 1} 次应是 200（幂等重放不算失败）`)
    }
  } finally {
    await server.stop()
  }
})

test('接线：已被**别人**用过的码（409 USED）计入失败计数 ⇒ 泄漏清单探测会被限流', async () => {
  // 红队打穿点④：原先 USED 不计数 ⇒ 攻击者拿泄漏清单逐个试，
  // 已被别人用过的码回 409 且不计数 ⇒ 200 次探测 0 次 429 ⇒ 免费的存在性预言机。
  const service = {
    repository: {},
    planOverrides: null,
    async redeem() {
      throw Object.assign(new Error('已被使用'), { code: 'REDEEM_CODE_USED', status: 409 })
    },
  }
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-8'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    // 前 5 次 409（计入失败），第 6 次起被拦
    // ⚠️ 阈值判定用的是「失败数 + 待定」⇒ 第 5 次请求时有效占用是 4（还没到 5），
    // 第 6 次才是 5 ⇒ 拦。这与「成功后清零」那条用例的算式同源。
    for (let i = 0; i < 5; i++) {
      const res = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
      assert.strictEqual(res.status, 409, `第 ${i + 1} 次应是 409`)
    }
    const blocked = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(blocked.status, 429, '第 6 次应被限流（USED 计入失败计数）')
    assert.strictEqual(blocked.body.error, 'REDEEM_RATE_LIMITED')
  } finally {
    await server.stop()
  }
})
