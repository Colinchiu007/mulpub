const assert = require('assert')
const path = require('path')
const test = require('node:test')

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations/postgresql')

// 008 积分账户与不可变账本。体例与 004/005/006 完全一致：单向（迁移 → SCHEMA）比对、
// 去注释、忽略空白；防漂移锁的形状刻意照抄 006，避免「口径各写各的」。

test('008 积分账本迁移与开发态 SCHEMA 一致', async (t) => {
  await t.test('迁移文件可发现且事务外壳合法', async () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const target = migrations.find((item) => item.name === '008_credit_ledger.sql')
    assert.ok(target, '缺少 008_credit_ledger.sql')
    assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
    // 两张新表必须都在迁移里出现（少一条 = 生产缺那张表）
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS identity_credit_accounts/)
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS identity_credit_ledger/)
    // 幂等索引是「重试不重复扣」的唯一数据库侧保证，不能被删
    assert.match(target.sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_credit_ledger_spend/)
    assert.match(target.sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_credit_ledger_grant/)
  })

  await t.test('迁移正文逐语句在开发态 SCHEMA 中存在（防漂移）', async () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const target = migrations.find((item) => item.name === '008_credit_ledger.sql')
    assert.ok(target, '缺少 008_credit_ledger.sql')

    const { SCHEMA } = require('../src/auth/postgres-identity-repository')
    const normalizeStatement = (statement) => statement.replace(/\s+/g, ' ').trim()
    const ddlStatements = normalizeMigrationSql(target.sql)
      .replace(/--[^\r\n]*/g, '')
      .split(';')
      .map(normalizeStatement)
      .filter(Boolean)
      .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))
    assert.ok(ddlStatements.length > 0, '008 迁移正文未解析出任何 DDL 语句')
    const schemaStatements = new Set(SCHEMA.map(normalizeStatement))
    for (const statement of ddlStatements) {
      assert.ok(
        schemaStatements.has(statement),
        `008 迁移与开发态 SCHEMA 漂移，SCHEMA 缺少语句：${statement.slice(0, 60)}`,
      )
    }
  })

  await t.test('开发态 SCHEMA 覆盖新表且 readiness 关系表包含它', async () => {
    const calls = []
    const pool = { async query(text) { calls.push(text); return { rows: [] } } }
    const { PostgresIdentityRepository, REQUIRED_SCHEMA_RELATIONS, SCHEMA } = require('../src/auth/postgres-identity-repository')
    await new PostgresIdentityRepository({ pool }).initialize()
    const sql = calls.join('\n')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_credit_accounts/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_credit_ledger/)
    assert.ok(REQUIRED_SCHEMA_RELATIONS.includes('identity_credit_accounts'), 'identity_credit_accounts 未纳入 REQUIRED_SCHEMA_RELATIONS')
    assert.ok(REQUIRED_SCHEMA_RELATIONS.includes('identity_credit_ledger'), 'identity_credit_ledger 未纳入 REQUIRED_SCHEMA_RELATIONS')
    assert.ok(
      SCHEMA.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS identity_credit_accounts')),
      'identity_credit_accounts 未纳入开发态 SCHEMA',
    )
    assert.ok(
      SCHEMA.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS identity_credit_ledger')),
      'identity_credit_ledger 未纳入开发态 SCHEMA',
    )
  })
})

test('008 积分账本的语义约束不可被削弱', async (t) => {
  await t.test('余额非负 CHECK 存在（并发穿透的最后一道防线）', async () => {
    const { CREDIT_SCHEMA } = require('../src/auth/credit-schema')
    const accounts = CREDIT_SCHEMA.find((s) => s.includes('CREATE TABLE IF NOT EXISTS identity_credit_accounts'))
    assert.ok(accounts, 'CREDIT_SCHEMA 缺 identity_credit_accounts')
    assert.match(accounts, /CHECK \(balance >= 0\)/)
  })

  await t.test('分录类型白名单与 amount 正数约束存在', async () => {
    const { CREDIT_SCHEMA } = require('../src/auth/credit-schema')
    const ledger = CREDIT_SCHEMA.find((s) => s.includes('CREATE TABLE IF NOT EXISTS identity_credit_ledger'))
    assert.ok(ledger, 'CREDIT_SCHEMA 缺 identity_credit_ledger')
    assert.match(ledger, /entry_type IN \('grant', 'spend', 'refund', 'expire', 'adjust'\)/)
    assert.match(ledger, /CHECK \(amount > 0\)/)
    // 成本列不得为负
    assert.match(ledger, /CHECK \(cost_cents >= 0\)/)
  })

  await t.test('幂等索引限定在正确口径上（消耗按事件、发放按 ref_id）', async () => {
    const { CREDIT_SCHEMA } = require('../src/auth/credit-schema')
    const spend = CREDIT_SCHEMA.find((s) => s.includes('uq_identity_credit_ledger_spend'))
    const grant = CREDIT_SCHEMA.find((s) => s.includes('uq_identity_credit_ledger_grant'))
    assert.ok(spend, '缺消耗幂等索引')
    assert.ok(grant, '缺发放幂等索引')
    assert.match(spend, /entry_type = 'spend'/)
    assert.match(grant, /entry_type = 'grant'/)
    // 发放索引必须排除空 ref_id——否则无 ref_id 的周期发放会被误判为重复
    assert.match(grant, /ref_id <> ''/)
  })
})
