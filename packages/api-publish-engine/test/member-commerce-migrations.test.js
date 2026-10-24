const assert = require('assert')
const path = require('path')
const test = require('node:test')

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations/postgresql')

test('004 商务迁移与开发态 SCHEMA 一致', async (t) => {
  await t.test('迁移文件可发现且事务外壳合法', async () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const target = migrations.find((item) => item.name === '004_member_commerce.sql')
    assert.ok(target, '缺少 004_member_commerce.sql')
    assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS identity_orders/)
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS identity_redeem_codes/)
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS identity_notifications/)
    assert.match(target.sql, /ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS device_id TEXT/)
    assert.match(target.sql, /ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ/)
    // 防漂移：normalizeMigrationSql 对带事务外壳的文件返回已剥离 BEGIN;/COMMIT; 的正文（注释保留），
    // 为兼容无外壳文件此处仍显式剔除事务控制语句；比对为单向（迁移 → SCHEMA）且忽略空白差异。
    const { SCHEMA } = require('../src/auth/postgres-identity-repository')
    const normalizeStatement = (statement) => statement.replace(/\s+/g, ' ').trim()
    const ddlStatements = normalizeMigrationSql(target.sql)
      .replace(/--[^\r\n]*/g, '')
      .split(';')
      .map(normalizeStatement)
      .filter(Boolean)
      .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))
    assert.ok(ddlStatements.length > 0, '004 迁移正文未解析出任何 DDL 语句')
    const schemaStatements = new Set(SCHEMA.map(normalizeStatement))
    for (const statement of ddlStatements) {
      assert.ok(
        schemaStatements.has(statement),
        `004 迁移与开发态 SCHEMA 漂移，SCHEMA 缺少语句：${statement.slice(0, 60)}`,
      )
    }
  })

  await t.test('开发态 SCHEMA 覆盖三张新表且 readiness 关系表包含它们', async () => {
    const calls = []
    const pool = { async query(text) { calls.push(text); return { rows: [] } } }
    const { PostgresIdentityRepository, REQUIRED_SCHEMA_RELATIONS, SCHEMA } = require('../src/auth/postgres-identity-repository')
    await new PostgresIdentityRepository({ pool }).initialize()
    const sql = calls.join('\n')
    for (const table of ['identity_orders', 'identity_redeem_codes', 'identity_notifications']) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
      assert.ok(REQUIRED_SCHEMA_RELATIONS.includes(table), `${table} 未纳入 REQUIRED_SCHEMA_RELATIONS`)
      assert.ok(SCHEMA.some((statement) => statement.includes(`CREATE TABLE IF NOT EXISTS ${table}`)), `${table} 未纳入开发态 SCHEMA`)
    }
    assert.ok(SCHEMA.some((statement) => statement.includes('ADD COLUMN IF NOT EXISTS device_id')))
  })
})

// 006 微信 Native 支付（最小闭环）。体例与 004/005 完全一致：单向（迁移 → SCHEMA）比对、
// 忽略空白、剔除迁移侧注释与事务控制语句。为什么必须同体例：SCHEMA 数组是开发态/测试态
// 建表真源，而 migrations/postgresql/ 是生产态真源；两者漂移时本地全绿而生产缺列。
test('006 支付迁移与开发态 SCHEMA 一致', async (t) => {
  await t.test('迁移文件可发现且事务外壳合法', async () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const target = migrations.find((item) => item.name === '006_payment_orders.sql')
    assert.ok(target, '缺少 006_payment_orders.sql')
    assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
    // 四条 ALTER 必须逐个在迁移里出现（少一条 = 那个字段在生产缺失）
    for (const column of ['provider_order_id', 'provider_sub_id', 'period', 'discount_cents']) {
      assert.match(target.sql, new RegExp(`ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS ${column}`))
    }
    assert.match(target.sql, /CREATE TABLE IF NOT EXISTS identity_payment_customers/)
    assert.match(target.sql, /CREATE INDEX IF NOT EXISTS idx_identity_payment_customers_user/)

    const { SCHEMA } = require('../src/auth/postgres-identity-repository')
    const normalizeStatement = (statement) => statement.replace(/\s+/g, ' ').trim()
    const ddlStatements = normalizeMigrationSql(target.sql)
      .replace(/--[^\r\n]*/g, '')
      .split(';')
      .map(normalizeStatement)
      .filter(Boolean)
      .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))
    assert.ok(ddlStatements.length > 0, '006 迁移正文未解析出任何 DDL 语句')
    const schemaStatements = new Set(SCHEMA.map(normalizeStatement))
    for (const statement of ddlStatements) {
      assert.ok(
        schemaStatements.has(statement),
        `006 迁移与开发态 SCHEMA 漂移，SCHEMA 缺少语句：${statement.slice(0, 60)}`,
      )
    }
  })

  await t.test('开发态 SCHEMA 覆盖新列与新表且 readiness 关系表包含它', async () => {
    const calls = []
    const pool = { async query(text) { calls.push(text); return { rows: [] } } }
    const { PostgresIdentityRepository, REQUIRED_SCHEMA_RELATIONS, SCHEMA } = require('../src/auth/postgres-identity-repository')
    await new PostgresIdentityRepository({ pool }).initialize()
    const sql = calls.join('\n')
    // 新表必须在开发态被建出来
    assert.match(sql, /CREATE TABLE IF NOT EXISTS identity_payment_customers/)
    assert.ok(REQUIRED_SCHEMA_RELATIONS.includes('identity_payment_customers'), 'identity_payment_customers 未纳入 REQUIRED_SCHEMA_RELATIONS')
    assert.ok(
      SCHEMA.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS identity_payment_customers')),
      'identity_payment_customers 未纳入开发态 SCHEMA',
    )
    // 四条 ALTER 也必须逐条进 SCHEMA（生产迁移有、SCHEMA 没有 ⇒ 测试态读不到这些列）
    for (const column of ['provider_order_id', 'provider_sub_id', 'period', 'discount_cents']) {
      assert.ok(
        SCHEMA.some((statement) => statement.includes(`ADD COLUMN IF NOT EXISTS ${column}`)),
        `${column} 未纳入开发态 SCHEMA`,
      )
    }
  })
})


// 009 兑换码「发放对象」列。体例与 004/006 一致，但**双向**比对：
// 本仓已知的漂移形态恰恰是「SCHEMA 侧多出一条 ALTER、迁移侧没有」——
// 单向（迁移 → SCHEMA）比对**抓不到**那种漂移，而那正是会让开发库缺列、
// 生产库正常（只在开发环境复现）的那一种。故此处两向都断言。
test('009 兑换码发放对象列与开发态 SCHEMA 双向一致', async (t) => {
  await t.test('迁移文件可发现且含 issued_to 的 ALTER', async () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const target = migrations.find((item) => item.name === '009_redeem_code_issued_to.sql')
    assert.ok(target, '缺少 009_redeem_code_issued_to.sql')
    assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
    assert.match(
      target.sql,
      /ALTER TABLE identity_redeem_codes ADD COLUMN IF NOT EXISTS issued_to TEXT/,
      '009 迁移必须加 issued_to 列（且用 IF NOT EXISTS 保证可重跑）'
    )
    // 编号纪律：009 必须在 006 之后（编号撞车会让 identity 仓储启动期硬失败）
    const names = migrations.map((item) => item.name)
    assert.ok(
      names.indexOf('009_redeem_code_issued_to.sql') > names.indexOf('006_payment_orders.sql'),
      '009 必须排在 006 之后'
    )
  })

  await t.test('迁移与开发态 SCHEMA 双向逐字一致', async () => {
    const { normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const { SCHEMA } = require('../src/auth/postgres-identity-repository')
    const fs = require('fs')
    const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, '009_redeem_code_issued_to.sql'), 'utf8')
    const normalizeStatement = (statement) => statement.replace(/\s+/g, ' ').trim()
    const ddlStatements = normalizeMigrationSql(raw)
      .replace(/--[^\r\n]*/g, '')
      .split(';')
      .map(normalizeStatement)
      .filter(Boolean)
      .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))
    assert.ok(ddlStatements.length > 0, '009 迁移正文未解析出任何 DDL 语句')
    const schemaStatements = new Set(SCHEMA.map(normalizeStatement))
    // 方向一：迁移里的每条语句都必须在 SCHEMA 里
    for (const statement of ddlStatements) {
      assert.ok(
        schemaStatements.has(statement),
        `009 迁移与开发态 SCHEMA 漂移，SCHEMA 缺少语句：${statement.slice(0, 80)}`
      )
    }
    // 方向二：SCHEMA 里与 issued_to 相关的语句也必须在迁移里
    // （单向比，抓不到「SCHEMA 多出一条、迁移没有」那种漂移——那会让开发库缺列而生产正常）
    for (const statement of SCHEMA.map(normalizeStatement)) {
      if (!/ADD COLUMN IF NOT EXISTS issued_to/.test(statement)) continue
      assert.ok(
        ddlStatements.includes(statement),
        `开发态 SCHEMA 多出一条迁移里没有的语句：${statement.slice(0, 80)}`
      )
    }
  })

  await t.test('SCHEMA 侧必须用 ALTER 兜底（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）', async () => {
    const { SCHEMA } = require('../src/auth/postgres-identity-repository')
    const hasAlter = SCHEMA.some((statement) => /ADD COLUMN IF NOT EXISTS issued_to/.test(statement))
    assert.ok(hasAlter, 'SCHEMA 数组必须包含 issued_to 的 ALTER —— 只靠 CREATE TABLE IF NOT EXISTS 不会给已存在的表加列')
  })
})
