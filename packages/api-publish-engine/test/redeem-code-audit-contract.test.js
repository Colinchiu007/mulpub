'use strict'

/**
 * 兑换码运营动作的**审计契约**（第 2 轮对抗审查查出的空白）。
 *
 * ⚠️ 为什么必须用**真 server + 真 AuditLog**（而不是桩）：
 *   上一轮「把业务字段装进 details」的修复，恰恰是在**桩 `_auditLog`** 上验证的
 *   ⇒ 桩不做「固定字段表之外静默丢弃」这件事 ⇒ 结构上**不可能**发现
 *   「字段写了但被丢了」。本文件全部走真实 `AuditLog`（`server._auditLog`）。
 */

const assert = require('assert')
const http = require('http')
const test = require('node:test')

const { TestPublishApiServer: PublishApiServer } = require('./test-publish-api-server')

function createVerifier() {
  return {
    verify: async (token) => {
      if (token === 'admin-token') return { subject: 'sub-admin', scopes: ['admin:users'] }
      throw Object.assign(new Error('AUTH_TOKEN_INVALID'), { code: 'AUTH_TOKEN_INVALID', status: 401 })
    },
  }
}

function createIdentityRepository(id) {
  return {
    async findBySubject(provider, subject) {
      return { id, auth_provider: provider, auth_subject: subject, status: 'active', display_name: '运营' }
    },
    async create() { throw new Error('存量测试不应创建用户') },
  }
}

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

/** 起一个真 server（真 AuditLog + 桩服务层），返回 { server, port, service, auditEntries }。 */
async function startServer(serviceOverrides = {}) {
  const service = Object.assign({
    repository: {},
    planOverrides: null,
    async grant() { return { plan: 'standard', order: { id: 'ord-1', channel: 'admin_grant' } } },
    async createRedeemBatch() {
      return { batch: 'B1', plan: 'pro', durationDays: 30, issuedTo: '渠道A', generated: 1, codes: ['ABCD-EFGH-JKMN'] }
    },
    async disableRedeemCode() { return { code: 'ABCD-EFGH-JKMN', status: 'disabled', idempotent: false } },
    async listRedeemCodes() { return { codes: [], total: 0, revealed: false } },
  }, serviceOverrides)
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createIdentityRepository('u-1'),
    entitlementProvider: { async getForUser() { return { plan: 'standard', features: [], quota: {}, limits: {} } } },
    subscriptionService: service,
  })
  await server.start(0)
  return {
    server,
    service,
    port: server._server.address().port,
    auditEntries: () => server._auditLog.list(100, 0, 'sub-admin'),
  }
}

test('审计：部分签发失败必须留下**内容完整**的失败条目（details 非空 + status=failed + batch）', async () => {
  const { server, port, auditEntries } = await startServer({
    async createRedeemBatch() {
      const error = Object.assign(new Error('批量签发未补足'), { code: 'REDEEM_BATCH_INCOMPLETE', status: 409 })
      error.requested = 10
      error.generated = 2
      error.rounds = 10
      error.created = ['ABCD-EFGH-JKMN', 'WXYZ-2345-6789']
      error.batch = 'B-PARTIAL'
      error.issuedTo = '渠道A'
      throw error
    },
  })
  try {
    const res = await request(port, 'POST', '/api/v1/admin/member/redeem-codes', 'admin-token', {
      plan: 'pro', durationDays: 30, count: 10, issuedTo: '渠道A',
    })
    assert.strictEqual(res.status, 409)
    // ⚠️ 响应体必须带 batch：**已签发出去、仍可兑**的那 2 个码要知道属于哪一批
    assert.strictEqual(res.body.batch, 'B-PARTIAL', '409 响应体必须带 batch（否则那批活码无从定位）')

    const entries = auditEntries()
    const incomplete = entries.find((entry) => entry.type === 'redeem_code_batch_incomplete')
    assert.ok(incomplete, '部分签发失败必须留一条审计')
    // ⚠️ 这些断言在「字段写在顶层」的实现下会**全部落空**（details=null / status='unknown'）
    assert.strictEqual(incomplete.status, 'failed', '失败条目的 status 必须是 failed（不是默认的 unknown）')
    assert.ok(incomplete.title && incomplete.title.length > 0, '失败条目必须有人可读的 title')
    assert.strictEqual(incomplete.error, 'REDEEM_BATCH_INCOMPLETE')
    assert.ok(incomplete.details, 'details 不得为 null（字段写在顶层会被 AuditLog 静默丢弃）')
    assert.strictEqual(incomplete.details.requested, 10)
    assert.strictEqual(incomplete.details.generated, 2)
    assert.strictEqual(incomplete.details.rounds, 10)
    assert.strictEqual(incomplete.details.batch, 'B-PARTIAL')
    assert.strictEqual(incomplete.details.issuedTo, '渠道A')
    assert.strictEqual(incomplete.details.actor, 'sub-admin', 'details 里必须有权威的 actor（token subject）')
  } finally {
    await server.stop()
  }
})

test('审计：运营动作的校验失败（4xx）必须留下 status=failed 的条目', async () => {
  const { server, port, auditEntries } = await startServer({
    async createRedeemBatch() {
      throw Object.assign(new Error('兑换码仅支持付费档位'), { code: 'PLAN_INVALID', status: 400 })
    },
  })
  try {
    const res = await request(port, 'POST', '/api/v1/admin/member/redeem-codes', 'admin-token', {
      plan: 'enterprise', durationDays: 30, count: 1,
    })
    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.error, 'PLAN_INVALID')

    const entries = auditEntries()
    const failed = entries.find((entry) => entry.status === 'failed')
    assert.ok(failed, '失败的运营动作必须留审计（否则「没生效」与「什么都没发生」同形）')
    assert.strictEqual(failed.error, 'PLAN_INVALID')
    assert.ok(failed.details, '失败条目的 details 不得为 null')
    assert.strictEqual(failed.details.action, 'redeem_code_batch_issued')
    assert.strictEqual(failed.details.errorCode, 'PLAN_INVALID')
    assert.strictEqual(failed.details.httpStatus, 400)
    assert.strictEqual(failed.details.actor, 'sub-admin')
  } finally {
    await server.stop()
  }
})

test('审计：缺 userId 的开通请求（路由层前置拒绝）也必须留下失败条目', async () => {
  const { server, port, auditEntries } = await startServer()
  try {
    const res = await request(port, 'POST', '/api/v1/admin/member/grant', 'admin-token', { plan: 'standard', durationDays: 30 })
    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.error, 'USER_ID_REQUIRED')

    const failed = auditEntries().find((entry) => entry.status === 'failed')
    assert.ok(failed, '路由层的前置拒绝同样要留痕（否则反复试错完全隐形）')
    assert.strictEqual(failed.error, 'USER_ID_REQUIRED')
    assert.strictEqual(failed.details.action, 'member_grant')
  } finally {
    await server.stop()
  }
})

test('审计：成功条目的 details 必须含权威 actor 与批次指纹（不落码本身）', async () => {
  let batchSeq = 0
  const { server, port, auditEntries } = await startServer({
    async createRedeemBatch() {
      batchSeq += 1
      // 同标签、不同码 ⇒ 指纹必须不同（否则审计无法区分两次签发）
      return {
        batch: 'B-SAME-LABEL', plan: 'pro', durationDays: 30, issuedTo: '渠道A',
        generated: 1, codes: [`ABCD-EFGH-JKM${batchSeq}`],
      }
    },
  })
  try {
    for (let i = 0; i < 2; i++) {
      const res = await request(port, 'POST', '/api/v1/admin/member/redeem-codes', 'admin-token', {
        plan: 'pro', durationDays: 30, count: 1, batch: 'B-SAME-LABEL', issuedTo: '渠道A',
      })
      assert.strictEqual(res.status, 200)
    }
    const entries = auditEntries().filter((entry) => entry.type === 'redeem_code_batch_issued')
    assert.strictEqual(entries.length, 2)
    for (const entry of entries) {
      assert.strictEqual(entry.details.actor, 'sub-admin', 'details 里必须有权威 actor')
      assert.strictEqual(entry.details.issuedTo, '渠道A')
      assert.ok(entry.details.codeDigest, '必须记批次指纹（同标签的两次签发才区分得开）')
      assert.strictEqual(typeof entry.details.codeDigest, 'string')
      // ⚠️ 指纹**不能**是码本身（审计文件不能变成新的泄漏面）
      assert.ok(!String(entry.details.codeDigest).includes('ABCD'), '指纹不得包含码本身')
    }
    assert.notStrictEqual(entries[0].details.codeDigest, entries[1].details.codeDigest, '同标签的两次签发指纹必须不同')
  } finally {
    await server.stop()
  }
})

test('契约：engine 收到 snake 的 issued_to 必须**报错**（不得静默丢弃发放对象）', async () => {
  const { server, port, auditEntries } = await startServer()
  try {
    const res = await request(port, 'POST', '/api/v1/admin/member/redeem-codes', 'admin-token', {
      plan: 'pro', durationDays: 30, count: 1, issued_to: '渠道A',
    })
    // ⚠️ fail-closed：静默丢弃会让「发放对象」看起来填了、其实没落库
    // ⇒ 泄漏后无从追查是哪一批。
    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.error, 'ISSUED_TO_KEY_INVALID')
    const failed = auditEntries().find((entry) => entry.status === 'failed')
    assert.ok(failed, '契约错误也要留痕')
    assert.strictEqual(failed.error, 'ISSUED_TO_KEY_INVALID')
  } finally {
    await server.stop()
  }
})

test('契约：真实服务层的「签发未补足」错误必须带上 batch 与 issuedTo', async () => {
  // ⚠️ 这条走**真实服务层**（上一条审计用例里错误是测试自己造的 ⇒ 造的时候就把
  // batch/issuedTo 填好了 ⇒ 结构上盖不住「服务层没挂这两个字段」）。
  // 真实路径：仓储一个都不入 ⇒ 补足轮次耗尽 ⇒ 抛 REDEEM_BATCH_INCOMPLETE。
  const { SubscriptionService } = require('../src/auth/subscription-service')
  const service = new SubscriptionService({
    repository: { async createRedeemCodes() { return [] } },
    now: () => new Date('2026-10-24T00:00:00Z'),
  })
  await assert.rejects(
    () => service.createRedeemBatch({
      plan: 'pro', durationDays: 30, count: 2, issuedTo: '渠道A', batch: 'B-REAL',
    }),
    (error) => {
      assert.strictEqual(error.code, 'REDEEM_BATCH_INCOMPLETE')
      assert.strictEqual(error.batch, 'B-REAL', '错误必须带 batch（否则已签发出去、仍可兑的码无从定位是哪一批）')
      assert.strictEqual(error.issuedTo, '渠道A', '错误必须带 issuedTo（发放对象同样要能追）')
      assert.ok(Array.isArray(error.created))
      return true
    },
  )
})
