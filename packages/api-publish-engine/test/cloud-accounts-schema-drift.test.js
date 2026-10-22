const assert = require('assert')
const path = require('path')
const test = require('node:test')

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations/postgresql')

// 005 云账号镜像的单向漂移锁（迁移 → SCHEMA），体例与 member-commerce-migrations.test.js（004）完全一致：
// normalizeMigrationSql 对带事务外壳的文件返回已剥离 BEGIN;/COMMIT; 的正文（注释保留），
// 为兼容无外壳文件此处仍显式剔除事务控制语句；比对为单向（迁移 → SCHEMA）且忽略空白差异。
// SQL 注释在比对前从迁移正文中剔除，因此 SCHEMA 侧不得镜像注释（口径同 004）。
test('005 云账号迁移与开发态 SCHEMA 一致', async (t) => {
  await t.test('迁移文件可发现且事务外壳合法', async () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const target = migrations.find((item) => item.name === '005_cloud_accounts.sql')
    assert.ok(target, '缺少 005_cloud_accounts.sql')
    assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS cloud_accounts/)
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS cloud_account_tombstones/)
    assert.match(target.sql, /CREATE INDEX IF NOT EXISTS idx_cloud_accounts_user_platform/)
    assert.match(target.sql, /CREATE INDEX IF NOT EXISTS idx_cloud_account_tombstones_user/)

    const { SCHEMA } = require('../src/auth/postgres-identity-repository')
    const normalizeStatement = (statement) => statement.replace(/\s+/g, ' ').trim()
    const ddlStatements = normalizeMigrationSql(target.sql)
      .replace(/--[^\r\n]*/g, '')
      .split(';')
      .map(normalizeStatement)
      .filter(Boolean)
      .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))
    assert.ok(ddlStatements.length > 0, '005 迁移正文未解析出任何 DDL 语句')
    const schemaStatements = new Set(SCHEMA.map(normalizeStatement))
    for (const statement of ddlStatements) {
      assert.ok(
        schemaStatements.has(statement),
        `005 迁移与开发态 SCHEMA 漂移，SCHEMA 缺少语句：${statement.slice(0, 60)}`,
      )
    }
  })

  await t.test('开发态 SCHEMA 覆盖两张云账号表且 readiness 关系表包含它们', async () => {
    const calls = []
    const pool = { async query(text) { calls.push(text); return { rows: [] } } }
    const { PostgresIdentityRepository, REQUIRED_SCHEMA_RELATIONS, SCHEMA } = require('../src/auth/postgres-identity-repository')
    await new PostgresIdentityRepository({ pool }).initialize()
    const sql = calls.join('\n')
    for (const table of ['cloud_accounts', 'cloud_account_tombstones']) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
      assert.ok(REQUIRED_SCHEMA_RELATIONS.includes(table), `${table} 未纳入 REQUIRED_SCHEMA_RELATIONS`)
      assert.ok(SCHEMA.some((statement) => statement.includes(`CREATE TABLE IF NOT EXISTS ${table}`)), `${table} 未纳入开发态 SCHEMA`)
    }
    // 关系清单顺序与建表顺序一致（cloud_accounts 先于墓碑表），且排在既有表之后，不打乱既有清单。
    assert.ok(
      REQUIRED_SCHEMA_RELATIONS.indexOf('cloud_accounts') < REQUIRED_SCHEMA_RELATIONS.indexOf('cloud_account_tombstones'),
      'REQUIRED_SCHEMA_RELATIONS 中云账号两表顺序与 SCHEMA 追加顺序不一致',
    )
    // 「作为最后一组追加」这条 2026-10-21 改写为「作为一组连续追加」：006 微信支付新增
    // identity_payment_customers 后，云账号两表不再是清单末位。原判据 slice(-2) 硬钉
    // 「最后」会把后续任何追加型迁移一律判红——而那正是本锁要保护的形态（追加在后、
    // 不打乱既有顺序）。改写后判据继续表达原意图，且新增一条「末位就是新表」的正向断言。
    const cloudAccountsIndex = REQUIRED_SCHEMA_RELATIONS.indexOf('cloud_accounts')
    assert.deepStrictEqual(
      REQUIRED_SCHEMA_RELATIONS.slice(cloudAccountsIndex, cloudAccountsIndex + 2),
      ['cloud_accounts', 'cloud_account_tombstones'],
      '云账号两表在 REQUIRED_SCHEMA_RELATIONS 中必须连续且按 SCHEMA 追加顺序排列',
    )
    // 末位断言改为按 SCHEMA 追加顺序动态取：现在末位是 006 的 identity_payment_customers。
    // 写死具体表名会让下一次追加又撞红，故按「SCHEMA 里最后一张表」推导期望值。
    const lastSchemaTable = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(
      [...SCHEMA].reverse().find((statement) => /CREATE TABLE IF NOT EXISTS \w+/.test(statement)),
    )[1]
    assert.strictEqual(
      REQUIRED_SCHEMA_RELATIONS[REQUIRED_SCHEMA_RELATIONS.length - 1],
      lastSchemaTable,
      `REQUIRED_SCHEMA_RELATIONS 末位（${REQUIRED_SCHEMA_RELATIONS[REQUIRED_SCHEMA_RELATIONS.length - 1]}）与 SCHEMA 最后一张表（${lastSchemaTable}）不一致`,
    )
    // 两张表各自的 user_id 前导索引也必须由 initialize() 建出，否则开发库与生产迁移产生索引漂移。
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_cloud_accounts_user_platform/)
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_cloud_account_tombstones_user/)
  })
})
