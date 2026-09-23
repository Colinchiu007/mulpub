'use strict'

const assert = require('assert')
const test = require('node:test')

const { SubscriptionService, generateRedeemCode, REDEEM_CODE_PATTERN } = require('../src/auth/subscription-service')

function createRepositoryFixture(initial = {}) {
  const repo = {
    codes: new Map((initial.codes || []).map((c) => [c.code, { status: 'active', used_by: null, expires_at: null, duration_days: 30, plan: 'standard', ...c }])),
    orders: [],
    notifications: [],
    subscriptionWrites: [],
    entitlementWrites: [],
    current: initial.current || null,
    expiryResult: initial.expiryResult || null,
    usage: initial.usage || [],
    txCalls: [],
    async commerceTransaction(callback) {
      const self = this
      return callback({
        async lockRedeemCode(code) { return self.codes.get(code) || null },
        async expireSubscription(userId) {
          self.txCalls.push('expireSubscription')
          return self.expiryResult
        },
        async putEntitlement(userId, payload) {
          self.txCalls.push('putEntitlement')
          self.entitlementWrites.push({ userId, payload })
          return self.entitlementWrites.length
        },
        async markRedeemCodeUsed(code, userId) {
          const row = self.codes.get(code)
          if (!row || row.status !== 'active') {
            throw Object.assign(new Error('REDEEM_CODE_RACE'), { code: 'REDEEM_CODE_RACE', status: 409 })
          }
          row.status = 'used'
          row.used_by = userId
          row.used_at = new Date().toISOString()
          return row
        },
        async applySubscription(args) {
          self.subscriptionWrites.push(args)
          self.orders.push(args.order)
          return {
            subscription: { id: `sub-${args.userId}`, plan: args.plan },
            order: args.order,
            version: self.entitlementWrites.length + 1,
            periodStart: 'ps', periodEnd: 'pe',
          }
        },
        async createNotification(record) { self.txCalls.push('createNotification'); self.notifications.push(record) },
      })
    },
    async expireSubscription() { return this.expiryResult },
    async putEntitlement(userId, payload) { this.entitlementWrites.push({ userId, payload }) },
    async getActiveSubscription() { return this.current },
    async getUsageSummary() { return this.usage },
    async createNotification(record) { this.notifications.push(record) },
    async createRedeemCodes(records) {
      for (const record of records) this.codes.set(record.code, { ...record, status: 'active', used_by: null })
      return records.map((record) => record.code)
    },
  }
  return repo
}

function createService(initial = {}, options = {}) {
  const repository = createRepositoryFixture(initial)
  const service = new SubscriptionService({ repository, now: () => new Date('2026-09-23T00:00:00Z'), ...options })
  return { service, repository }
}

test('generateRedeemCode', async (t) => {
  await t.test('格式 4-4-4 且字母表排除混淆字符', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRedeemCode()
      assert.match(code, REDEEM_CODE_PATTERN)
      assert.ok(!/[IO01]/.test(code), `不应含易混淆字符: ${code}`)
    }
  })
})

test('redeem 兑换码核销状态机', async (t) => {
  await t.test('成功核销：三连写 + 标记已用 + 通知', async () => {
    const { service, repository } = createService({ codes: [{ code: 'ABCD-EFGH-JKMN', plan: 'pro', duration_days: 30 }] })
    const result = await service.redeem({ userId: 'u-1', code: 'abcd-efgh-jkmn' }) // 小写归一
    assert.strictEqual(result.plan, 'pro')
    assert.strictEqual(repository.subscriptionWrites[0].plan, 'pro')
    assert.strictEqual(repository.subscriptionWrites[0].durationDays, 30)
    assert.strictEqual(repository.orders[0].channel, 'redeem')
    assert.strictEqual(repository.codes.get('ABCD-EFGH-JKMN').status, 'used')
    assert.strictEqual(repository.notifications.length, 1)
  })

  await t.test('非法格式 400 REDEEM_CODE_FORMAT（不碰数据库）', async () => {
    const { service, repository } = createService()
    for (const bad of ['abc', '', 'AAAA-BBBB', 'IIII-OOOO-0000', 'AAAA-BBBB-CCCC-DDDD']) {
      await assert.rejects(service.redeem({ userId: 'u-1', code: bad }), (err) => err.code === 'REDEEM_CODE_FORMAT' && err.status === 400)
    }
    assert.strictEqual(repository.subscriptionWrites.length, 0)
  })

  await t.test('不存在 404 / 他人已用 409 / 停用 409 / 过期 410', async () => {
    const cases = [
      { codes: [], code: 'ABCD-EFGH-JKMN', expectCode: 'REDEEM_CODE_NOT_FOUND', status: 404 },
      { codes: [{ code: 'ABCD-EFGH-JKMN', status: 'used', used_by: 'u-2' }], code: 'ABCD-EFGH-JKMN', expectCode: 'REDEEM_CODE_USED', status: 409 },
      { codes: [{ code: 'ABCD-EFGH-JKMN', status: 'disabled' }], code: 'ABCD-EFGH-JKMN', expectCode: 'REDEEM_CODE_DISABLED', status: 409 },
      { codes: [{ code: 'ABCD-EFGH-JKMN', expires_at: '2020-01-01T00:00:00Z' }], code: 'ABCD-EFGH-JKMN', expectCode: 'REDEEM_CODE_EXPIRED', status: 410 },
    ]
    for (const item of cases) {
      const { service } = createService({ codes: item.codes })
      await assert.rejects(service.redeem({ userId: 'u-1', code: item.code }), (err) => err.code === item.expectCode && err.status === item.status)
    }
  })

  await t.test('本人重复提交幂等：不重复记账', async () => {
    const { service, repository } = createService({ codes: [{ code: 'ABCD-EFGH-JKMN', status: 'used', used_by: 'u-1', used_at: '2026-09-22T00:00:00Z' }] })
    const result = await service.redeem({ userId: 'u-1', code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(result.idempotent, true)
    assert.strictEqual(result.plan, 'standard')
    assert.strictEqual(repository.subscriptionWrites.length, 0)
    assert.strictEqual(repository.orders.length, 0)
  })
})

test('grant / createRedeemBatch / settleExpiry / 视图', async (t) => {
  await t.test('grant：free/未知档位 PLAN_INVALID，时长非正整数 DURATION_INVALID', async () => {
    const { service } = createService()
    await assert.rejects(service.grant({ userId: 'u-1', plan: 'free', durationDays: 30 }), (err) => err.code === 'PLAN_INVALID')
    await assert.rejects(service.grant({ userId: 'u-1', plan: 'gold', durationDays: 30 }), (err) => err.code === 'PLAN_INVALID')
    await assert.rejects(service.grant({ userId: 'u-1', plan: 'standard', durationDays: 0 }), (err) => err.code === 'DURATION_INVALID')
    await assert.rejects(service.grant({ userId: 'u-1', plan: 'standard', durationDays: 1.5 }), (err) => err.code === 'DURATION_INVALID')
  })

  await t.test('grant 成功：channel admin_grant，providerReference 透传', async () => {
    const { service, repository } = createService()
    const result = await service.grant({ userId: 'u-1', plan: 'standard', durationDays: 30, providerReference: 'ops:admin-9' })
    assert.strictEqual(result.order.channel, 'admin_grant')
    assert.strictEqual(repository.subscriptionWrites[0].order.providerReference, 'ops:admin-9')
    assert.strictEqual(repository.notifications.length, 1)
  })

  await t.test('createRedeemBatch：数量上限 1-500，生成码唯一且入库', async () => {
    const { service, repository } = createService()
    await assert.rejects(service.createRedeemBatch({ plan: 'standard', durationDays: 30, count: 0 }), (err) => err.code === 'BATCH_COUNT_INVALID')
    await assert.rejects(service.createRedeemBatch({ plan: 'standard', durationDays: 30, count: 501 }), (err) => err.code === 'BATCH_COUNT_INVALID')
    const batch = await service.createRedeemBatch({ plan: 'pro', durationDays: 365, count: 5, batch: 'b1' })
    assert.strictEqual(batch.codes.length, 5)
    assert.strictEqual(new Set(batch.codes).size, 5)
    assert.strictEqual(repository.codes.size, 5)
    assert.strictEqual(repository.codes.get(batch.codes[0]).plan, 'pro')
    assert.strictEqual(repository.codes.get(batch.codes[0]).durationDays, 365)
  })

  await t.test('settleExpiry：有降级行→回写 free 快照+通知；无→null；三写必在同一事务', async () => {
    const withExpiry = createService({ expiryResult: { id: 'sub-u-1', plan: 'standard', status: 'expired' } })
    const settled = await withExpiry.service.settleExpiry('u-1')
    assert.ok(settled)
    assert.strictEqual(withExpiry.repository.entitlementWrites[0].payload.plan, 'free')
    assert.strictEqual(withExpiry.repository.notifications.length, 1)
    // 回归保护（CCG C3）：若退回「非事务 + 先 expire 后写快照」，中途失败会永久泄漏 pro 权益
    assert.deepStrictEqual(withExpiry.repository.txCalls,
      ['expireSubscription', 'putEntitlement', 'createNotification'])
    const clean = createService()
    assert.strictEqual(await clean.service.settleExpiry('u-1'), null)
    assert.strictEqual(clean.repository.entitlementWrites.length, 0)
  })

  await t.test('grant 默认 providerReference 逐次唯一（否则撞 UNIQUE 回滚整事务）', async () => {
    const { service, repository } = createService()
    const first = await service.grant({ userId: 'u-1', plan: 'standard', durationDays: 30 })
    await service.grant({ userId: 'u-2', plan: 'pro', durationDays: 30 })
    const refs = repository.subscriptionWrites.map((w) => w.order.providerReference)
    assert.strictEqual(new Set(refs).size, 2, `providerReference 必须全局唯一：${refs.join(', ')}`)
    assert.match(first.order.providerReference, /^grant:system:ord-/)
  })

  await t.test('getSubscriptionView：无订阅回 free，有订阅回当期档位', async () => {
    const empty = createService()
    assert.strictEqual((await empty.service.getSubscriptionView('u-1')).plan, 'free')
    const paid = createService({ current: { id: 'sub-u-1', plan: 'pro', status: 'active', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z' } })
    const view = await paid.service.getSubscriptionView('u-1')
    assert.strictEqual(view.plan, 'pro')
    assert.strictEqual(view.periodEnd, '2026-10-01T00:00:00Z')
    assert.strictEqual(view.entitlement.limits.concurrent_tasks, 10)
  })

  await t.test('getUsageView：无记录 feature 也回 used=0 + 矩阵上限', async () => {
    const { service } = createService({
      current: { id: 'sub-u-1', plan: 'standard', status: 'active', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z' },
      usage: [{ feature: 'cloud_publish', used: 12, quota_limit: 1500, period_start: '2026-09-01T00:00:00Z', period_end: '2026-10-01T00:00:00Z' }],
    })
    const usageView = await service.getUsageView('u-1')
    const publish = usageView.features.find((item) => item.feature === 'cloud_publish')
    assert.strictEqual(publish.used, 12)
    assert.strictEqual(publish.limit, 1500)
    const video = usageView.features.find((item) => item.feature === 'video_create')
    assert.strictEqual(video.used, 0)
    assert.strictEqual(video.limit, 500)
  })
})
