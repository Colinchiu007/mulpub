const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

test('PostgresIdentityRepository', async (t) => {
  function createPool() {
    const calls = []
    const queries = new Map()
    const client = {
      async query(text, values) {
        calls.push({ text, values })
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        if (text.includes('INSERT INTO identity_users')) return { rows: [{ id: 'u-1' }] }
        if (text.includes('INSERT INTO identity_webhook_events')) return { rows: [{ id: 'event-1' }] }
        if (text.includes('SELECT * FROM identity_users')) return { rows: queries.get(values.join(':')) || [] }
        return { rows: [] }
      },
      release() { calls.push({ text: 'RELEASE' }) },
    }
    return {
      calls,
      client,
      async query(text, values) {
        calls.push({ text, values })
        if (text.includes('INSERT INTO identity_users')) return { rows: [{ id: 'u-1' }] }
        return { rows: [] }
      },
      async connect() { return client },
    }
  }

  await t.test('初始化业务身份、权益、Webhook 和会话表', async () => {
    const pool = createPool()
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool })

    await repository.initialize()

    const sql = pool.calls.map((call) => call.text).join('\n')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_users/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_webhook_events/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_entitlement_snapshots/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_subscriptions/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_entitlement_usage/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_user_sessions/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_orders/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_redeem_codes/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_notifications/)
    assert.match(sql, /ALTER TABLE identity_users\s+ADD COLUMN IF NOT EXISTS last_event_created_at/)
    assert.match(sql, /ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS device_id TEXT/)
    assert.match(sql, /ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS device_name TEXT/)
    assert.match(sql, /ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS cloud_accounts/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS cloud_account_tombstones/)
  })

  await t.test('生产 readiness 只检查连接、migration ledger 和关键表，不执行 DDL', async () => {
    const calls = []
    const expected = [
      'identity_schema_migrations', 'identity_users', 'identity_subscriptions',
      'identity_entitlement_snapshots', 'identity_entitlement_usage',
      'identity_webhook_events', 'identity_user_sessions',
      'identity_orders', 'identity_redeem_codes', 'identity_notifications',
      'cloud_accounts', 'cloud_account_tombstones',
    ]
    const pool = {
      async query(text, values) {
        calls.push({ text, values })
        if (/unnest/.test(text)) return { rows: expected.map((name) => ({ name, relation: name })) }
        if (/SELECT name, checksum FROM identity_schema_migrations/.test(text)) {
          const { discoverMigrations } = require('../src/auth/postgres-migrations')
          return { rows: discoverMigrations(path.resolve(__dirname, '../../../migrations/postgresql')) }
        }
        return { rows: [{ ok: 1 }] }
      },
    }
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool })

    const result = await repository.assertReady()

    assert.deepStrictEqual(result, { database: 'ready', schema: 'ready' })
    assert.deepStrictEqual(calls[1].values, [expected])
    assert.strictEqual(calls.some((call) => /CREATE|ALTER|INSERT|UPDATE|DELETE/i.test(call.text)), false)
  })

  await t.test('生产 readiness 在 migration 待执行、checksum 漂移或文件丢失时 fail closed', async () => {
    const migrationDirectory = path.resolve(__dirname, '../../../migrations/postgresql')
    const { discoverMigrations } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(migrationDirectory)
    const expectedRelations = [
      'identity_schema_migrations', 'identity_users', 'identity_subscriptions',
      'identity_entitlement_snapshots', 'identity_entitlement_usage',
      'identity_webhook_events', 'identity_user_sessions',
      'identity_orders', 'identity_redeem_codes', 'identity_notifications',
      'cloud_accounts', 'cloud_account_tombstones',
    ]
    const makeRepository = (ledgerRows) => {
      const pool = {
        async query(text) {
          if (/unnest/.test(text)) return { rows: expectedRelations.map((name) => ({ name, relation: name })) }
          if (/SELECT name, checksum FROM identity_schema_migrations/.test(text)) return { rows: ledgerRows }
          return { rows: [{ ok: 1 }] }
        },
      }
      const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
      return new PostgresIdentityRepository({ pool, migrationDirectory })
    }

    await assert.rejects(makeRepository(migrations.slice(0, 1)).assertReady(), (error) => error.code === 'MIGRATION_PENDING')
    await assert.rejects(makeRepository([{ ...migrations[0], checksum: 'wrong' }, migrations[1]]).assertReady(), (error) => error.code === 'MIGRATION_CHECKSUM_MISMATCH')
    await assert.rejects(makeRepository([...migrations, { name: '001_removed.sql', checksum: 'a'.repeat(64) }]).assertReady(), (error) => error.code === 'MIGRATION_FILE_MISSING')
  })

  await t.test('生产 readiness 在关键表缺失时 fail closed', async () => {
    const pool = {
      async query(text) {
        if (/unnest/.test(text)) return { rows: [{ name: 'identity_users', relation: null }] }
        return { rows: [{ ok: 1 }] }
      },
    }
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool })

    await assert.rejects(repository.assertReady(), (error) => {
      return error && error.code === 'BUSINESS_DATABASE_SCHEMA_NOT_READY'
    })
  })

  await t.test('生产仓储即使被直接调用 initialize 也拒绝执行 DDL', async () => {
    const calls = []
    const pool = { query: async (text) => { calls.push(text); return { rows: [] } } }
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool, production: true })

    await assert.rejects(repository.initialize(), (error) => error.code === 'PRODUCTION_AUTO_MIGRATE_FORBIDDEN')
    assert.strictEqual(calls.length, 0)
  })

  await t.test('生产 PostgreSQL 迁移与运行时所需表保持一致', () => {
    const migrationDirectory = path.resolve(__dirname, '../../../migrations/postgresql')
    const sql = ['002_logto_identity.sql', '003_logto_webhook_events.sql', '004_member_commerce.sql', '005_cloud_accounts.sql']
      .map((name) => fs.readFileSync(path.join(migrationDirectory, name), 'utf8'))
      .join('\n')
    for (const table of [
      'identity_users', 'identity_subscriptions', 'identity_entitlement_snapshots',
      'identity_entitlement_usage', 'identity_webhook_events', 'identity_user_sessions',
      'identity_orders', 'identity_redeem_codes', 'identity_notifications',
      'cloud_accounts', 'cloud_account_tombstones',
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
    }
    assert.match(sql, /TIMESTAMPTZ/)
    assert.match(sql, /JSONB/)
    assert.match(sql, /last_event_created_at/)
  })

  await t.test('以单条参数化 SQL 原子扣减月度额度', async () => {
    const calls = []
    const pool = {
      async query(text, values) {
        calls.push({ text, values })
        return { rows: [{ used: 3, quota_limit: 10, period_start: '2026-07-01', period_end: '2026-08-01' }] }
      },
    }
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool })
    const usage = await repository.consumeEntitlementUsage({
      userId: 'user-1', feature: 'cloud_publish', amount: 2, limit: 10,
      periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z',
    })

    assert.deepStrictEqual(usage, {
      used: 3, limit: 10, remaining: 7,
      periodStart: '2026-07-01', periodEnd: '2026-08-01',
    })
    assert.strictEqual(calls.length, 1)
    assert.match(calls[0].text, /ON CONFLICT \(user_id, feature, period_start\) DO UPDATE/)
    assert.match(calls[0].text, /WHERE identity_entitlement_usage\.used \+ EXCLUDED\.used <= EXCLUDED\.quota_limit/)
    assert.deepStrictEqual(calls[0].values, [
      'user-1', 'cloud_publish', '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z', 2, 10,
    ])
  })

  await t.test('拒绝无效或倒置的计费周期', async () => {
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool: { query: async () => ({ rows: [] }) } })
    const base = { userId: 'user-1', feature: 'cloud_publish', amount: 1, limit: 10 }

    await assert.rejects(repository.consumeEntitlementUsage({
      ...base, periodStart: 'invalid', periodEnd: '2026-08-01T00:00:00.000Z',
    }), /periodStart and periodEnd must be valid/)
    await assert.rejects(repository.consumeEntitlementUsage({
      ...base, periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-07-01T00:00:00.000Z',
    }), /periodEnd must be after periodStart/)
  })

  await t.test('权益提供器按 UTC 月份扣减并在额度耗尽时 fail closed', async () => {
    const calls = []
    const repository = {
      async getEntitlement() {
        return { plan: 'pro', features: ['cloud_publish'], quota: { cloud_publish_monthly: 2 } }
      },
      async consumeEntitlementUsage(input) {
        calls.push(input)
        return calls.length === 1 ? { used: 1, limit: 2, remaining: 1 } : null
      },
    }
    const { PostgresEntitlementProvider } = require('../src/auth/postgres-identity-repository')
    const provider = new PostgresEntitlementProvider(repository, { now: () => new Date('2026-07-20T12:00:00.000Z') })
    const context = { businessUser: { id: 'user-1' }, feature: 'cloud_publish' }

    await assert.doesNotReject(provider.consumeFeature(context, 1))
    assert.deepStrictEqual(calls[0], {
      userId: 'user-1', feature: 'cloud_publish', amount: 1, limit: 2,
      periodStart: '2026-07-01T00:00:00.000Z', periodEnd: '2026-08-01T00:00:00.000Z',
    })
    await assert.rejects(provider.consumeFeature(context, 1), (error) => {
      return error && error.code === 'ENTITLEMENT_QUOTA_EXHAUSTED' && error.status === 429
    })
  })

  await t.test('按 provider + sub 查找并以唯一键幂等创建业务用户', async () => {
    const pool = createPool()
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool })

    const found = await repository.findBySubject('logto', 'sub-1')
    const created = await repository.create({
      id: 'u-1', auth_provider: 'logto', auth_subject: 'sub-1', status: 'active',
    })

    assert.strictEqual(found, null)
    assert.deepStrictEqual(created, { id: 'u-1' })
    assert(pool.calls.some((call) => call.text.includes('ON CONFLICT (auth_provider, auth_subject) DO NOTHING')))
  })

  await t.test('Webhook 事务异常时回滚并释放连接，成功时提交', async () => {
    const pool = createPool()
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool })

    await repository.transaction(async (transaction) => {
      assert.strictEqual(await transaction.claimWebhookEvent({
        id: 'event-1', provider: 'logto', event: 'User.Created', hookId: 'hook-1',
        subject: 'sub-1', createdAt: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-01T00:00:01.000Z',
      }), true)
      await transaction.completeWebhookEvent('event-1', { subject: 'sub-1' })
    })
    assert(pool.calls.some((call) => call.text === 'COMMIT'))
    assert(pool.calls.some((call) => call.text === 'RELEASE'))

    await assert.rejects(repository.transaction(async () => { throw new Error('boom') }), /boom/)
    assert(pool.calls.some((call) => call.text === 'ROLLBACK'))
  })

  await t.test('乱序 Webhook 返回 applied=false，供调用方跳过撤销副作用', async () => {
    const calls = []
    const existing = {
      id: 'u-1',
      auth_provider: 'logto',
      auth_subject: 'sub-1',
      status: 'active',
      last_event_created_at: '2026-07-20T00:10:00.000Z',
    }
    const client = {
      async query(text, values) {
        calls.push({ text, values })
        if (text.includes('SELECT * FROM identity_users')) return { rows: [existing] }
        throw new Error('乱序事件不应执行 INSERT')
      },
    }
    const { PostgresWebhookTransaction } = require('../src/auth/postgres-identity-repository')
    const transaction = new PostgresWebhookTransaction(client)

    const result = await transaction.upsertUserState('logto', 'sub-1', { status: 'deleted' }, {
      eventCreatedAt: '2026-07-20T00:09:00.000Z',
    })

    assert.strictEqual(result.applied, false)
    assert.strictEqual(result.status, 'active')
    assert.strictEqual(calls.length, 1)
  })
})
