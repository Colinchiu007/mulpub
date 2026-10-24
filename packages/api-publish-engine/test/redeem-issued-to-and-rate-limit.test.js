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

test('限流器：失败累计到阈值后放行门关闭', () => {
  const limiter = new RedeemFailureLimiter({ userWindowMs: 60000, userMaxFailures: 5, ipWindowMs: 600000, ipMaxFailures: 30 })
  try {
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(limiter.check('u1', '1.1.1.1').blocked, false)
      limiter.recordFailure('u1', '1.1.1.1')
    }
    assert.strictEqual(limiter.check('u1', '1.1.1.1').blocked, false)
    limiter.recordFailure('u1', '1.1.1.1')
    // 第 6 次应当被拦
    const gate = limiter.check('u1', '1.1.1.1')
    assert.strictEqual(gate.blocked, true)
    assert.strictEqual(gate.scope, 'user')
    // 另一个用户不受影响
    assert.strictEqual(limiter.check('u2', '1.1.1.1').blocked, false)
  } finally { limiter.stop() }
})

test('限流器：一次成功清零该用户的失败计数', () => {
  const limiter = new RedeemFailureLimiter({ userWindowMs: 60000, userMaxFailures: 2, ipWindowMs: 600000, ipMaxFailures: 30 })
  try {
    limiter.recordFailure('u1', '1.1.1.1')
    limiter.recordFailure('u1', '1.1.1.1')
    assert.strictEqual(limiter.check('u1', '1.1.1.1').blocked, true)
    limiter.recordSuccess('u1')
    assert.strictEqual(limiter.check('u1', '1.1.1.1').blocked, false)
  } finally { limiter.stop() }
})

test('限流器：IP 维度独立生效', () => {
  const limiter = new RedeemFailureLimiter({ userWindowMs: 60000, userMaxFailures: 100, ipWindowMs: 600000, ipMaxFailures: 3 })
  try {
    for (let i = 0; i < 3; i++) limiter.recordFailure(`u${i}`, '9.9.9.9')
    const gate = limiter.check('fresh-user', '9.9.9.9')
    assert.strictEqual(gate.blocked, true)
    assert.strictEqual(gate.scope, 'ip')
  } finally { limiter.stop() }
})

test('只有「格式错」与「不存在」算探测型失败；已用/停用/过期都不算', () => {
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_FORMAT' }), true)
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_NOT_FOUND' }), true)
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_USED' }), false)
  assert.strictEqual(isProbeFailure({ code: 'REDEEM_CODE_DISABLED' }), false)
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

test('接线：已用（REDEEM_CODE_USED）不计入失败计数 ⇒ 反复重放同一张码不会被限流', async () => {
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
    businessIdentityRepository: createIdentityRepository('u-2'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    for (let i = 0; i < 8; i++) {
      const res = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
      assert.strictEqual(res.status, 409, `第 ${i + 1} 次应仍是 409（未过期码不算探测）`)
    }
  } finally {
    await server.stop()
  }
})
