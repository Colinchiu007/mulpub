const assert = require('assert')
const test = require('node:test')

const { PostgresCreditRepository, CreditError } = require('../src/auth/credit-repository')

/**
 * 假 pool：只实现本仓测试需要的查询面。
 * balance 由 fake 持有——扣减时按「WHERE balance >= amount」语义模拟，
 * 即余额不足时返回空 rows（模拟 PG 的 rowcount=0）。
 */
function createFakePool(initialBalance = 0) {
  const state = {
    balance: initialBalance,
    granted: 0,
    spent: 0,
    entries: [],
    nextId: 1,
    queries: [],
  }
  const pool = {
    async query(text, params = []) {
      state.queries.push({ text, params })
      const sql = String(text).replace(/\s+/g, ' ').trim()
      if (sql.includes('INSERT INTO identity_credit_accounts') && sql.includes('ON CONFLICT')) {
        // 发放路径：余额与累计发放同时增加
        state.balance += Number(params[1])
        state.granted += Number(params[1])
        return { rows: [{ balance: state.balance, granted_total: state.granted, spent_total: state.spent }] }
      }
      if (sql.startsWith('UPDATE identity_credit_accounts')) {
        const amount = Number(params[1])
        if (state.balance < amount) return { rows: [] } // 余额不足 ⇒ 扣不动
        state.balance -= amount
        state.spent += amount
        return { rows: [{ balance: state.balance, granted_total: state.granted, spent_total: state.spent }] }
      }
      if (sql.includes('INSERT INTO identity_credit_ledger')) {
        const entry = {
          id: state.nextId++,
          entry_type: params[1],
          amount: Number(params[2]),
          balance_after: Number(params[3]),
          ref_type: params[5],
          ref_id: params[6],
          cost_cents: Number(params[8]),
        }
        state.entries.push(entry)
        return { rows: [entry] }
      }
      if (sql.includes('SELECT id, amount, balance_after FROM identity_credit_ledger')) {
        // 幂等查账的 SQL 文本在 grant / spend 两条路径上完全相同，区别只在
        // `entry_type = '...'` 字面量——按字面量区分，否则 grant 的幂等检查
        // 会被当成 spend 的检查而恒返回空。
        const wanted = /entry_type = '(\w+)'/.exec(sql)
        const entryType = wanted ? wanted[1] : 'spend'
        const found = state.entries.find(
          (e) => e.ref_type === params[0] && e.ref_id === params[1] && e.entry_type === entryType,
        )
        return { rows: found ? [found] : [] }
      }
      if (sql.includes('SELECT balance, granted_total, spent_total')) {
        if (params[0] === '__missing__') return { rows: [] }
        return { rows: [{ balance: state.balance, granted_total: state.granted, spent_total: state.spent }] }
      }
      return { rows: [] }
    },
    async connect() {
      return {
        query: pool.query.bind(pool),
        release() {},
      }
    },
  }
  return { pool, state }
}

const PERIOD = { periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z' }

test('积分账户：发放增加余额与累计发放', async () => {
  const { pool, state } = createFakePool(0)
  const repo = new PostgresCreditRepository({ pool })
  const result = await repo.grantCredit({
    userId: 'u1', amount: 100, refType: 'subscription', refId: 'subscription:u1:2026-10', ...PERIOD,
  })
  assert.strictEqual(result.duplicated, false)
  assert.strictEqual(result.account.balance, 100)
  assert.strictEqual(state.granted, 100)
  assert.strictEqual(result.entry.entryType, 'grant')
})

test('积分账户：同一 ref_id 重复发放只入账一次（幂等）', async () => {
  const { pool, state } = createFakePool(0)
  const repo = new PostgresCreditRepository({ pool })
  const first = await repo.grantCredit({
    userId: 'u1', amount: 100, refType: 'subscription', refId: 'subscription:u1:2026-10', ...PERIOD,
  })
  const second = await repo.grantCredit({
    userId: 'u1', amount: 100, refType: 'subscription', refId: 'subscription:u1:2026-10', ...PERIOD,
  })
  assert.strictEqual(first.duplicated, false)
  assert.strictEqual(second.duplicated, true)
  // 余额只加了一次
  assert.strictEqual(state.balance, 100)
  assert.strictEqual(state.entries.length, 1)
})

test('积分账户：消耗扣减余额并写 spend 分录', async () => {
  const { pool, state } = createFakePool(100)
  const repo = new PostgresCreditRepository({ pool })
  const result = await repo.consumeCredit({
    userId: 'u1', amount: 30, costCents: 300, priceId: 'p1', refId: 'evt-1', ...PERIOD,
  })
  assert.strictEqual(result.duplicated, false)
  assert.strictEqual(state.balance, 70)
  assert.strictEqual(state.spent, 30)
  assert.strictEqual(result.entry.entryType, 'spend')
  assert.strictEqual(result.entry.balanceAfter, 70)
  assert.strictEqual(state.entries[0].cost_cents, 300)
})

test('积分账户：余额不足时抛错且不写分录', async () => {
  const { pool, state } = createFakePool(10)
  const repo = new PostgresCreditRepository({ pool })
  await assert.rejects(
    () => repo.consumeCredit({ userId: 'u1', amount: 30, refId: 'evt-2', ...PERIOD }),
    (error) => error instanceof CreditError && error.code === 'CREDIT_BALANCE_EXHAUSTED',
  )
  // 余额没动，且**没有**留下分录（账本只记真实发生过的消耗）
  assert.strictEqual(state.balance, 10)
  assert.strictEqual(state.entries.length, 0)
})

test('积分账户：同一事件重复结算只扣一次（幂等）', async () => {
  const { pool, state } = createFakePool(100)
  const repo = new PostgresCreditRepository({ pool })
  const first = await repo.consumeCredit({ userId: 'u1', amount: 30, refId: 'evt-3', ...PERIOD })
  const second = await repo.consumeCredit({ userId: 'u1', amount: 30, refId: 'evt-3', ...PERIOD })
  assert.strictEqual(first.duplicated, false)
  assert.strictEqual(second.duplicated, true)
  assert.strictEqual(state.balance, 70)
  assert.strictEqual(state.entries.length, 1)
})

test('积分账户：amount 必须是正整数', async () => {
  const { pool } = createFakePool(0)
  const repo = new PostgresCreditRepository({ pool })
  for (const bad of [0, -1, 1.5, '10', null, undefined]) {
    await assert.rejects(
      () => repo.consumeCredit({ userId: 'u1', amount: bad, refId: 'evt-x', ...PERIOD }),
      TypeError,
      `amount=${String(bad)} 应当被拒`,
    )
  }
})

test('积分账户：周期边界必须是合法且递增的时间', async () => {
  const { pool } = createFakePool(0)
  const repo = new PostgresCreditRepository({ pool })
  await assert.rejects(
    () => repo.grantCredit({
      userId: 'u1', amount: 10,
      periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z',
    }),
    TypeError,
  )
  await assert.rejects(
    () => repo.grantCredit({ userId: 'u1', amount: 10, periodStart: 'not-a-date', periodEnd: '2026-11-01' }),
    TypeError,
  )
})

test('积分账户：扣减语句必须带余额条件（并发下只允许一个扣成功）', async () => {
  const { pool, state } = createFakePool(10)
  const repo = new PostgresCreditRepository({ pool })
  await repo.consumeCredit({ userId: 'u1', amount: 4, refId: 'evt-4', ...PERIOD })
  const spendSql = state.queries.find((q) => String(q.text).replace(/\s+/g, ' ').trim().startsWith('UPDATE identity_credit_accounts'))
  assert.ok(spendSql, '未发出扣减 UPDATE')
  // 关键：WHERE 里必须带 balance >= amount，缺了这个并发下会超发
  assert.match(spendSql.text, /balance >= \$2/)
})
