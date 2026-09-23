const assert = require('assert')
const test = require('node:test')

const { PostgresIdentityRepository, PostgresCommerceTransaction } = require('../src/auth/postgres-identity-repository')

function fakePool() {
  const calls = []
  return {
    calls,
    rows: [],
    async query(text, values) { calls.push({ text, values }); return { rows: this.rows } },
  }
}

function fakeClient() {
  const calls = []
  return {
    calls,
    queue: [],
    async query(text, values) {
      calls.push({ text, values })
      if (this.queue.length) return this.queue.shift()
      return { rows: [] }
    },
  }
}

test('商务仓储池级方法', async (t) => {
  await t.test('会话行以确定性 id 复用（同设备重登复活 revoked 行）', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    const first = await repository.upsertSession({ userId: 'u-1', deviceId: 'device-a', deviceName: 'Win' })
    const second = await repository.upsertSession({ userId: 'u-1', deviceId: 'device-a', deviceName: 'Win2' })
    assert.match(first.id, /^ses-[0-9a-f]{32}$/)
    assert.strictEqual(first.id, second.id)
    const insert = pool.calls[pool.calls.length - 1]
    assert.match(insert.text, /ON CONFLICT \(id\) DO UPDATE SET revoked_at = NULL/)
    assert.deepStrictEqual(insert.values[0], second.id)
    const other = await repository.upsertSession({ userId: 'u-1', deviceId: 'device-b', deviceName: 'Mac' })
    assert.notStrictEqual(other.id, first.id)
  })

  await t.test('revokeOtherSessions 用 IS DISTINCT FROM 保留当前设备', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    await repository.revokeOtherSessions('u-1', 'device-a')
    const call = pool.calls[0]
    assert.match(call.text, /device_id IS DISTINCT FROM \$2/)
    assert.deepStrictEqual(call.values, ['u-1', 'device-a'])
  })

  await t.test('putEntitlement 快照 version 自增 upsert', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    await repository.putEntitlement('u-1', { plan: 'standard', features: [], quota: {} })
    const call = pool.calls[0]
    assert.match(call.text, /INSERT INTO identity_entitlement_snapshots/)
    assert.match(call.text, /version \+ 1/)
    assert.strictEqual(call.values[0], 'u-1')
    assert.strictEqual(call.values[1], JSON.stringify({ plan: 'standard', features: [], quota: {} }))
  })

  await t.test('getActiveSubscription / expireSubscription / listOrders / getUsageSummary 参数化', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    await repository.getActiveSubscription('u-1')
    assert.match(pool.calls[0].text, /status = 'active'/)
    await repository.expireSubscription('u-1')
    assert.match(pool.calls[1].text, /SET status = 'expired'/)
    assert.match(pool.calls[1].text, /current_period_end <= NOW\(\)/)
    await repository.listOrders('u-1', { limit: 20, offset: 0 })
    assert.match(pool.calls[2].text, /FROM identity_orders WHERE user_id = \$1/)
    assert.deepStrictEqual(pool.calls[2].values, ['u-1', 20, 0])
    await repository.getUsageSummary('u-1', new Date('2026-09-01T00:00:00Z'))
    assert.match(pool.calls[3].text, /FROM identity_entitlement_usage/)
    assert.match(pool.calls[3].text, /period_start <= \$2 AND period_end > \$2/)
  })

  await t.test('createRedeemCodes 批量 unnest + 冲突静默跳过', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    const records = [
      { code: 'AAAA-BBBB-CCCC', plan: 'standard', durationDays: 30, batch: 'b1', expiresAt: null },
      { code: 'DDDD-EEEE-FFFF', plan: 'pro', durationDays: 365, batch: 'b1', expiresAt: new Date('2027-01-01T00:00:00Z') },
    ]
    await repository.createRedeemCodes(records)
    const call = pool.calls[0]
    assert.match(call.text, /unnest/)
    assert.match(call.text, /ON CONFLICT \(code\) DO NOTHING/)
    assert.deepStrictEqual(call.values[0], ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'])
    assert.deepStrictEqual(call.values[2], [30, 365])
  })

  await t.test('通知：list/countUnread/markRead/broadcast fan-out', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    await repository.listNotifications('u-1', { limit: 20, offset: 0 })
    assert.match(pool.calls[0].text, /FROM identity_notifications WHERE user_id = \$1/)
    await repository.countUnreadNotifications('u-1')
    assert.match(pool.calls[1].text, /read_at IS NULL/)
    await repository.markNotificationsRead('u-1')
    assert.match(pool.calls[2].text, /SET read_at = NOW\(\) WHERE user_id = \$1 AND read_at IS NULL/)
    await repository.broadcastNotification(['u-1', 'u-2', 'u-3'], { title: '公告', body: '维护', level: 'warn' })
    const call = pool.calls[3]
    assert.match(call.text, /unnest/)
    assert.strictEqual(call.values[1].length, 3)
    assert.match(call.text, /identity_notifications/)
  })

  await t.test('commerceTransaction 走 BEGIN/COMMIT，异常 ROLLBACK', async () => {
    const queries = []
    const client = { async query(text) { queries.push(text.split('\n')[0]); return { rows: [] } }, release() {} }
    const pool = { async connect() { return client } }
    const repository = new PostgresIdentityRepository({ pool })
    await repository.commerceTransaction(async (tx) => {
      assert.ok(tx instanceof PostgresCommerceTransaction)
      return 'ok'
    })
    assert.deepStrictEqual(queries.slice(0, 2), ['BEGIN', 'COMMIT'])
    await assert.rejects(repository.commerceTransaction(async () => { throw new Error('boom') }), /boom/)
    assert.ok(queries.includes('ROLLBACK'))
  })
})

test('PostgresCommerceTransaction 单事务编排', async (t) => {
  await t.test('lockRedeemCode 行锁 FOR UPDATE', async () => {
    const client = fakeClient()
    const tx = new PostgresCommerceTransaction(client)
    await tx.lockRedeemCode('AAAA-BBBB-CCCC')
    assert.match(client.calls[0].text, /FROM identity_redeem_codes WHERE code = \$1 FOR UPDATE/)
  })

  await t.test('markRedeemCodeUsed 条件更新失败抛 409 REDEEM_CODE_RACE', async () => {
    const client = fakeClient()
    const tx = new PostgresCommerceTransaction(client)
    await assert.rejects(tx.markRedeemCodeUsed('X', 'u-1'), (err) => err.code === 'REDEEM_CODE_RACE' && err.status === 409)
    assert.match(client.calls[0].text, /WHERE code = \$1 AND status = 'active'/)
  })

  await t.test('applySubscription 三连写：订阅续叠→订单→快照回写', async () => {
    const client = fakeClient()
    // 预置：当前订阅未到期（续叠场景）
    client.queue = [
      { rows: [{ id: 'sub-u-1', user_id: 'u-1', plan: 'standard', status: 'active', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z' }] }, // SELECT 现有
      { rows: [{ id: 'sub-u-1', plan: 'pro' }] },   // UPSERT subscription
      { rows: [{ id: 'ord-1' }] },                    // INSERT order
      { rows: [{ version: 7 }] },                     // PUT entitlement
    ]
    const tx = new PostgresCommerceTransaction(client)
    const payload = { plan: 'pro', features: ['cloud_publish'], quota: {}, limits: {} }
    const result = await tx.applySubscription({
      userId: 'u-1', plan: 'pro', durationDays: 30,
      now: new Date('2026-09-15T00:00:00Z'),
      order: { id: 'ord-1', amount: 7900, currency: 'CNY', channel: 'redeem' },
      entitlementPayload: payload,
    })
    assert.strictEqual(result.version, 7)
    const upsert = client.calls[1]
    assert.match(upsert.text, /INSERT INTO identity_subscriptions/)
    assert.match(upsert.text, /ON CONFLICT \(id\) DO UPDATE SET/)
    assert.strictEqual(upsert.values[0], 'sub-u-1')
    // 续叠：periodStart = max(now, 未到期 current_period_end) = 2026-10-01
    assert.strictEqual(upsert.values[3], new Date('2026-10-01T00:00:00Z').toISOString())
    assert.strictEqual(upsert.values[4], new Date('2026-10-31T00:00:00Z').toISOString())
    assert.match(client.calls[2].text, /INSERT INTO identity_orders/)
    assert.match(client.calls[3].text, /INSERT INTO identity_entitlement_snapshots/)
  })

  await t.test('applySubscription 无存量订阅时从 now 起算', async () => {
    const client = fakeClient()
    client.queue = [
      { rows: [] },                          // 无存量
      { rows: [{ id: 'sub-u-2' }] },
      { rows: [{ id: 'ord-2' }] },
      { rows: [{ version: 1 }] },
    ]
    const tx = new PostgresCommerceTransaction(client)
    await tx.applySubscription({
      userId: 'u-2', plan: 'standard', durationDays: 30,
      now: new Date('2026-09-15T00:00:00Z'),
      order: { id: 'ord-2', amount: 2900, currency: 'CNY', channel: 'admin_grant', providerReference: 'op-x' },
      entitlementPayload: { plan: 'standard' },
    })
    const upsert = client.calls[1]
    assert.strictEqual(upsert.values[3], new Date('2026-09-15T00:00:00Z').toISOString())
    assert.strictEqual(upsert.values[4], new Date('2026-10-15T00:00:00Z').toISOString())
    assert.strictEqual(upsert.values[5], 'op-x')
  })

  await t.test('createNotification 单条插入带 id', async () => {
    const client = fakeClient()
    const tx = new PostgresCommerceTransaction(client)
    await tx.createNotification({ id: 'ntf-1', userId: 'u-1', title: '开通成功', body: 'pro 30 天', level: 'info' })
    assert.match(client.calls[0].text, /INSERT INTO identity_notifications/)
    assert.deepStrictEqual(client.calls[0].values, ['ntf-1', 'u-1', '开通成功', 'pro 30 天', 'info'])
  })
})
