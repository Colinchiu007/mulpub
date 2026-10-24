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


// 009 兑换码「发放对象」列。判据 = **列级 (表.列) 双向集合比对**，不是语句字面量。
//
// ⚠ 为什么不用「语句字面量」比（第 2 轮对抗审查用 5 个变异实测出来的）：
//   ① 引号写法（`ADD COLUMN IF NOT EXISTS "issued_to" TEXT`，语义等价）⇒ 字面量锁看不见 ⇒ 假绿
//   ② 换一列（issued_by）/ 换一张表 ⇒ 字面量锁仍绿 ⇒ 假绿（超出它宣称的覆盖范围）
//   ③ 未来 010 合法给同表加一列（迁移与 SCHEMA 两处一致）⇒ 若拿 009 当全集 ⇒ 假红地雷
//   ④ 类型演进（TEXT → VARCHAR）⇒ 若逐字比语句 ⇒ 假红
// ⇒ 改为**解析出 (表, 列) 再比集合**：引号归一化、列类型不在比对维度内、
//   且比较域是**全部迁移文件**（每一份迁移各管自己那一段 ⇒ 职责边界正确）。
test('009 兑换码发放对象列与开发态 SCHEMA 双向一致', async (t) => {
  const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
  const { SCHEMA } = require('../src/auth/postgres-identity-repository')

  const normalizeStatement = (statement) => statement.replace(/\s+/g, ' ').trim()
  const splitDdl = (sql) => normalizeMigrationSql(sql)
    .replace(/--[^\r\n]*/g, '')
    .split(';')
    .map(normalizeStatement)
    .filter(Boolean)
    .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))

  // 列级解析：容忍标识符引号（`"issued_to"` ≡ `issued_to`）。
  // 列类型不在比对维度内 ⇒ TEXT → VARCHAR 这类演进不误报。
  const ADD_COLUMN_RE = /ALTER TABLE\s+("[A-Za-z0-9_.]+"|[A-Za-z0-9_.]+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?("[A-Za-z0-9_]+"|[A-Za-z0-9_]+)/i
  const addedColumnsOf = (statements) => {
    const out = new Set()
    for (const statement of statements) {
      const m = ADD_COLUMN_RE.exec(statement)
      if (!m) continue
      out.add(`${m[1].replace(/"/g, '').toLowerCase()}.${m[2].replace(/"/g, '').toLowerCase()}`)
    }
    return out
  }

  const migrations = discoverMigrations(MIGRATIONS_DIR)

  await t.test('迁移文件可发现且含 issued_to 的 ALTER', async () => {
    const target = migrations.find((item) => item.name === '009_redeem_code_issued_to.sql')
    assert.ok(target, '缺少 009_redeem_code_issued_to.sql')
    assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
    // 列级断言（容忍引号写法）：列必须落在正确的表上
    const columns = addedColumnsOf(splitDdl(target.sql))
    assert.ok(
      columns.has('identity_redeem_codes.issued_to'),
      '009 迁移必须给 identity_redeem_codes 加 issued_to 列（且用 IF NOT EXISTS 保证可重跑）',
    )
    // 编号纪律：009 必须在 006 之后（编号撞车会让 identity 仓储启动期硬失败）
    const names = migrations.map((item) => item.name)
    assert.ok(
      names.indexOf('009_redeem_code_issued_to.sql') > names.indexOf('006_payment_orders.sql'),
      '009 必须排在 006 之后',
    )
  })

  await t.test('列级双向一致：迁移加过的列 SCHEMA 必须有，SCHEMA 有的列迁移必须也加过', async () => {
    const migrationColumns = new Set()
    for (const migration of migrations) {
      for (const key of addedColumnsOf(splitDdl(migration.sql))) migrationColumns.add(key)
    }
    const schemaColumns = addedColumnsOf(SCHEMA.map(normalizeStatement))

    // 方向一：迁移加过的列，SCHEMA 里没有 ⇒ 开发库缺列、生产正常（只在开发环境复现）
    for (const key of migrationColumns) {
      assert.ok(
        schemaColumns.has(key),
        `迁移有、开发态 SCHEMA 没有的列：${key}（开发库会缺这一列，生产走迁移正常）`,
      )
    }
    // 方向二：SCHEMA 里多出的列 ⇒ 生产没有（迁移缺）⇒ 两边漂移
    for (const key of schemaColumns) {
      assert.ok(
        migrationColumns.has(key),
        `开发态 SCHEMA 有、但任何迁移都没有的列：${key}（生产与开发 schema 将不一致）`,
      )
    }
    // 009 专项：这一列必须落在正确的表上（换表 ⇒ 上面两个方向都抓得到）
    assert.ok(
      schemaColumns.has('identity_redeem_codes.issued_to'),
      '开发态 SCHEMA 必须给 identity_redeem_codes 加 issued_to 列',
    )
    // 两个集合必须逐个相等（防止「两个方向各自漏掉『都缺』」的情形）
    assert.deepStrictEqual(
      [...schemaColumns].sort(),
      [...migrationColumns].sort(),
      '开发态 SCHEMA 的加列集合与全部迁移的加列集合不一致',
    )
  })

  await t.test('SCHEMA 的执行顺序：同表的每条 ADD COLUMN 都必须在 CREATE TABLE 之后', async () => {
    // 锁对顺序不敏感、而 SCHEMA 的执行是**顺序敏感**的：把 ALTER 挪到建表之前仍全绿，
    // 但开发库启动即炸（列还不存在）。所以这里显式断言顺序。
    const statements = SCHEMA.map((statement) => normalizeStatement(statement))
    const indicesMatching = (re) => statements
      .map((statement, index) => (re.test(statement) ? index : -1))
      .filter((index) => index >= 0)
    for (const table of ['identity_redeem_codes', 'identity_orders', 'identity_user_sessions']) {
      const creates = indicesMatching(new RegExp(`^CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'))
      const alters = indicesMatching(new RegExp(`^ALTER TABLE ${table}\\s+ADD COLUMN`, 'i'))
      if (creates.length === 0 || alters.length === 0) continue
      const createAt = creates[0]
      for (const alterAt of alters) {
        assert.ok(
          alterAt > createAt,
          `SCHEMA 里 ${table} 的 ADD COLUMN 必须排在 CREATE TABLE 之后（create@${createAt} alter@${alterAt}）`,
        )
      }
    }
  })

  await t.test('SCHEMA 侧必须用 ALTER 兜底（CREATE TABLE IF NOT EXISTS 不会给已存在的表加列）', async () => {
    const statements = SCHEMA.map((statement) => normalizeStatement(statement))
    const schemaColumns = addedColumnsOf(statements)
    assert.ok(
      schemaColumns.has('identity_redeem_codes.issued_to'),
      'SCHEMA 数组必须包含 identity_redeem_codes.issued_to 的 ALTER —— 只靠 CREATE TABLE IF NOT EXISTS 不会给已存在的表加列',
    )
    // 必须是 ALTER 形态（不是把 issued_to 写进 CREATE TABLE 的列清单里）
    assert.ok(
      statements.some((statement) => /^ALTER TABLE identity_redeem_codes\s+ADD COLUMN\b/i.test(statement)
        && /issued_to/i.test(statement)),
      'issued_to 必须是 ALTER TABLE ... ADD COLUMN 语句（写进 CREATE TABLE 对已存在的表是 no-op）',
    )
  })
})
