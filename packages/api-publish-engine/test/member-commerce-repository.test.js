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

  await t.test('createRedeemCodes 空批次早退返回 [] 且不发查询', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    const codes = await repository.createRedeemCodes([])
    assert.deepStrictEqual(codes, [])
    assert.strictEqual(pool.calls.length, 0)
  })

  await t.test('broadcastNotification 空收件人早退返回 0 且不落写', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    const count = await repository.broadcastNotification([], { title: '公告' })
    assert.strictEqual(count, 0)
    assert.strictEqual(pool.calls.length, 0)
  })

  await t.test('upsertSession 缺 deviceId 抛 TypeError 且不写会话行', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    await assert.rejects(
      repository.upsertSession({ userId: 'u-1' }),
      (err) => err instanceof TypeError && /deviceId is required/.test(err.message)
        && err.code === 'SESSION_DEVICE_REQUIRED' && err.status === 400
    )
    assert.strictEqual(pool.calls.length, 0)
  })

  await t.test('getUsageSummary 左闭右开周期谓词与绑定钟值（Task 4 契约）', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    await repository.getUsageSummary('u-1', new Date('2026-09-01T00:00:00Z'))
    const call = pool.calls[0]
    assert.match(call.text, /period_start <= \$2 AND period_end > \$2/)
    assert.deepStrictEqual(call.values, ['u-1', new Date('2026-09-01T00:00:00Z').toISOString()])
  })

  await t.test('listOrders / listNotifications 平局以 id DESC 稳定分页', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    await repository.listOrders('u-1', { limit: 20, offset: 0 })
    assert.match(pool.calls[0].text, /ORDER BY created_at DESC, id DESC LIMIT \$2 OFFSET \$3/)
    await repository.listNotifications('u-1', { limit: 20, offset: 0 })
    assert.match(pool.calls[1].text, /ORDER BY created_at DESC, id DESC LIMIT \$2 OFFSET \$3/)
  })

  await t.test('listActiveSessions 排除已撤销且排序确定', async () => {
    const pool = fakePool()
    const repository = new PostgresIdentityRepository({ pool })
    await repository.listActiveSessions('u-1')
    const call = pool.calls[0]
    assert.match(call.text, /revoked_at IS NULL/)
    assert.match(call.text, /ORDER BY last_seen_at DESC NULLS LAST, id DESC/)
    assert.deepStrictEqual(call.values, ['u-1'])
  })

  await t.test('countUnreadNotifications 把计数列转回 JS number', async () => {
    const pool = fakePool()
    pool.rows = [{ count: '5' }]
    const repository = new PostgresIdentityRepository({ pool })
    const count = await repository.countUnreadNotifications('u-1')
    assert.strictEqual(typeof count, 'number')
    assert.strictEqual(count, 5)
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
      { rows: [{ pg_advisory_xact_lock: null }] },                    // advisory 锁
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
    const upsert = client.calls[2]
    assert.match(upsert.text, /INSERT INTO identity_subscriptions/)
    assert.match(upsert.text, /ON CONFLICT \(id\) DO UPDATE SET/)
    assert.strictEqual(upsert.values[0], 'sub-u-1')
    // 续叠：periodStart = max(now, 未到期 current_period_end) = 2026-10-01
    assert.strictEqual(upsert.values[3], new Date('2026-10-01T00:00:00Z').toISOString())
    assert.strictEqual(upsert.values[4], new Date('2026-10-31T00:00:00Z').toISOString())
    assert.match(client.calls[3].text, /INSERT INTO identity_orders/)
    assert.match(client.calls[4].text, /INSERT INTO identity_entitlement_snapshots/)
  })

  await t.test('applySubscription 无存量订阅时从 now 起算', async () => {
    const client = fakeClient()
    client.queue = [
      { rows: [{ pg_advisory_xact_lock: null }] },  // advisory 锁
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
    const upsert = client.calls[2]
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

  await t.test('applySubscription 拒绝非正整数时长且不落任何写', async () => {
    const client = fakeClient()
    const tx = new PostgresCommerceTransaction(client)
    const base = {
      userId: 'u-1', plan: 'pro',
      now: new Date('2026-09-15T00:00:00Z'),
      order: { id: 'ord-1', amount: 7900, currency: 'CNY', channel: 'redeem' },
      entitlementPayload: { plan: 'pro' },
    }
    for (const durationDays of [0, -1, 1.5, '30', undefined]) {
      await assert.rejects(
        tx.applySubscription({ ...base, durationDays }),
        (err) => err.code === 'DURATION_INVALID' && err.status === 400
      )
    }
    assert.strictEqual(client.calls.length, 0)
  })

  await t.test('applySubscription 拒绝无效时钟且不落任何写', async () => {
    const client = fakeClient()
    const tx = new PostgresCommerceTransaction(client)
    const base = {
      userId: 'u-1', plan: 'pro', durationDays: 30,
      order: { id: 'ord-1', amount: 7900, currency: 'CNY', channel: 'redeem' },
      entitlementPayload: { plan: 'pro' },
    }
    await assert.rejects(
      tx.applySubscription({ ...base, now: new Date(NaN) }),
      (err) => err.code === 'COMMERCE_CLOCK_INVALID' && err.status === 503
    )
    await assert.rejects(
      tx.applySubscription({ ...base, now: 'not-a-date' }),
      (err) => err.code === 'COMMERCE_CLOCK_INVALID' && err.status === 503
    )
    assert.strictEqual(client.calls.length, 0)
  })

  await t.test('applySubscription 透传 provider_reference：缺省绑定 null、有值原样透传', async () => {
    const withoutRef = fakeClient()
    withoutRef.queue = [
      { rows: [{ pg_advisory_xact_lock: null }] },
      { rows: [] },
      { rows: [{ id: 'sub-u-9' }] },
      { rows: [{ id: 'ord-9' }] },
      { rows: [{ version: 1 }] },
    ]
    await new PostgresCommerceTransaction(withoutRef).applySubscription({
      userId: 'u-9', plan: 'standard', durationDays: 30,
      now: new Date('2026-09-15T00:00:00Z'),
      order: { id: 'ord-9', amount: 2900, currency: 'CNY', channel: 'admin_grant' },
      entitlementPayload: { plan: 'standard' },
    })
    const upsertNoRef = withoutRef.calls[2]
    assert.match(upsertNoRef.text, /INSERT INTO identity_subscriptions/)
    assert.strictEqual(upsertNoRef.values[5], null)

    const withRef = fakeClient()
    withRef.queue = [
      { rows: [{ pg_advisory_xact_lock: null }] },
      { rows: [] },
      { rows: [{ id: 'sub-u-10' }] },
      { rows: [{ id: 'ord-10' }] },
      { rows: [{ version: 1 }] },
    ]
    await new PostgresCommerceTransaction(withRef).applySubscription({
      userId: 'u-10', plan: 'pro', durationDays: 30,
      now: new Date('2026-09-15T00:00:00Z'),
      order: { id: 'ord-10', amount: 7900, currency: 'CNY', channel: 'payment', providerReference: 'live-op-42' },
      entitlementPayload: { plan: 'pro' },
    })
    const upsertRef = withRef.calls[2]
    assert.strictEqual(upsertRef.values[5], 'live-op-42')
  })

  await t.test('lockRedeemCode 命中返回行、未命中返回 null 且持 FOR UPDATE 行锁', async () => {
    const hit = fakeClient()
    const row = { code: 'AAAA-BBBB-CCCC', status: 'active' }
    hit.queue = [{ rows: [row] }]
    assert.deepStrictEqual(await new PostgresCommerceTransaction(hit).lockRedeemCode('AAAA-BBBB-CCCC'), row)
    assert.match(hit.calls[0].text, /WHERE code = \$1 FOR UPDATE/)
    assert.deepStrictEqual(hit.calls[0].values, ['AAAA-BBBB-CCCC'])
    const miss = fakeClient()
    assert.strictEqual(await new PostgresCommerceTransaction(miss).lockRedeemCode('ZZZZ-ZZZZ-ZZZZ'), null)
  })

  await t.test('applySubscription 首条查询即 sub: 前缀 advisory xact 锁（I-1 丢期回归护栏）', async () => {
    const client = fakeClient()
    client.queue = [
      { rows: [{ pg_advisory_xact_lock: null }] },  // advisory 锁
      { rows: [] },                                 // 无存量
      { rows: [{ id: 'sub-u-7' }] },
      { rows: [{ id: 'ord-7' }] },
      { rows: [{ version: 1 }] },
    ]
    const tx = new PostgresCommerceTransaction(client)
    await tx.applySubscription({
      userId: 'u-7', plan: 'pro', durationDays: 30,
      now: new Date('2026-09-15T00:00:00Z'),
      order: { id: 'ord-7', amount: 7900, currency: 'CNY', channel: 'redeem' },
      entitlementPayload: { plan: 'pro' },
    })
    // 锁必须先于存在性 SELECT：删锁或把锁挪到 SELECT 之后，本断言即红
    assert.strictEqual(client.calls.length, 5)
    assert.strictEqual(client.calls[0].text, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))')
    assert.deepStrictEqual(client.calls[0].values, ['sub:u-7'])
    assert.match(client.calls[1].text, /FROM identity_subscriptions/)
  })

  await t.test('applySubscription 统一时钟基准与 INSERT_ORDER 参数位置锁（M-3/M-6）', async () => {
    const client = fakeClient()
    client.queue = [
      { rows: [{ pg_advisory_xact_lock: null }] },
      { rows: [{ id: 'sub-u-1', user_id: 'u-1', plan: 'standard', status: 'active', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z' }] },
      { rows: [{ id: 'sub-u-1' }] },
      { rows: [{ id: 'ord-1' }] },
      { rows: [{ version: 2 }] },
    ]
    const tx = new PostgresCommerceTransaction(client)
    await tx.applySubscription({
      userId: 'u-1', plan: 'pro', durationDays: 30,
      now: new Date('2026-09-15T00:00:00Z'),
      order: { id: 'ord-1', amount: 7900, currency: 'CNY', channel: 'redeem' },
      entitlementPayload: { plan: 'pro' },
    })
    // 存在性 SELECT 与 base 计算同用一个应用时钟：$2 绑定 now，改回 NOW() 即红
    assert.match(client.calls[1].text, /current_period_end > \$2/)
    assert.deepStrictEqual(client.calls[1].values, ['u-1', new Date('2026-09-15T00:00:00Z').toISOString()])
    // UPSERT 位置锁：$4/$5 为续叠起点与到期点（由绑定时钟推导）
    assert.deepStrictEqual(client.calls[2].values, [
      'sub-u-1', 'u-1', 'pro',
      new Date('2026-10-01T00:00:00Z').toISOString(),
      new Date('2026-10-31T00:00:00Z').toISOString(),
      null,
    ])
    // INSERT_ORDER 位置锁：amount/currency/channel 换序即红
    assert.deepStrictEqual(client.calls[3].values, ['ord-1', 'u-1', 'pro', 7900, 'CNY', 'redeem'])
  })
})
