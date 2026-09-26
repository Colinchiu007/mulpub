const assert = require('assert')
const path = require('path')
const test = require('node:test')

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations/postgresql')
const MIGRATION_NAME = '005_cloud_accounts.sql'
const UNIQUE_CONSTRAINT = 'cloud_accounts_user_platform_uid_key'

/**
 * 取迁移正文（已剥离 BEGIN;/COMMIT; 外壳、去注释）里的单条 DDL 语句序列。
 * 与 member-commerce-migrations.test.js 同一口径，便于比对「先建表再建索引」的顺序。
 */
function ddlStatements(sql) {
  const { normalizeMigrationSql } = require('../src/auth/postgres-migrations')
  return normalizeMigrationSql(sql)
    .replace(/--[^\r\n]*/g, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((statement) => !/^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))
}

function targetSql() {
  const { discoverMigrations } = require('../src/auth/postgres-migrations')
  const target = discoverMigrations(MIGRATIONS_DIR).find((item) => item.name === MIGRATION_NAME)
  assert.ok(target, `缺少 ${MIGRATION_NAME}`)
  return target
}

test('005 账号云镜像迁移（cloud_accounts / cloud_account_tombstones）', async (t) => {
  await t.test('文件可被发现、命名合规且事务外壳合法', () => {
    const { discoverMigrations, normalizeMigrationSql } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const names = migrations.map((item) => item.name)
    assert.ok(names.includes(MIGRATION_NAME), `discoverMigrations 未收集到 ${MIGRATION_NAME}`)
    // 005 必须排在 004 之后：identity_users 由 002 建立，外键方向依赖既有顺序。
    assert.ok(names.indexOf(MIGRATION_NAME) > names.indexOf('004_member_commerce.sql'))
    const target = migrations.find((item) => item.name === MIGRATION_NAME)
    assert.doesNotThrow(() => normalizeMigrationSql(target.sql))
    assert.match(target.sql, /^\s*(?:--[^\r\n]*\s*)*BEGIN\s*;/i)
    assert.match(target.sql, /COMMIT\s*;\s*$/i)
  })

  await t.test('唯一约束名 cloud_accounts_user_platform_uid_key 存在且只出现一次', () => {
    const target = targetSql()
    const matches = target.sql.split(UNIQUE_CONSTRAINT)
    assert.strictEqual(matches.length - 1, 1, `${UNIQUE_CONSTRAINT} 必须恰好声明一次`)
    assert.match(
      target.sql,
      new RegExp(`CONSTRAINT\\s+${UNIQUE_CONSTRAINT}\\s+UNIQUE\\s*\\(\\s*user_id\\s*,\\s*platform\\s*,\\s*platform_uid\\s*\\)`),
      `唯一约束必须是 (user_id, platform, platform_uid)`,
    )
  })

  await t.test('负控：约束名匹配器对不存在的串必须判否（证明上面的断言不是空跑）', () => {
    const target = targetSql()
    assert.strictEqual(target.sql.includes(`${UNIQUE_CONSTRAINT}_typo`), false)
    assert.strictEqual(target.sql.includes('cloud_account_user_platform_uid_key'), false)
    assert.throws(
      () => assert.match(target.sql, new RegExp(`CONSTRAINT\\s+${UNIQUE_CONSTRAINT}_typo\\s+UNIQUE`)),
      '把约束名改成不存在的串必须让断言变红',
    )
  })

  await t.test('两表列合同：PRD §6.1 逐列存在、类型与 NOT NULL 一致', () => {
    const statements = ddlStatements(targetSql().sql)
    const accounts = statements.find((s) => /^CREATE TABLE IF NOT EXISTS cloud_accounts\b/.test(s))
    const tombstones = statements.find((s) => /^CREATE TABLE IF NOT EXISTS cloud_account_tombstones\b/.test(s))
    assert.ok(accounts, '缺少 cloud_accounts 建表语句')
    assert.ok(tombstones, '缺少 cloud_account_tombstones 建表语句')

    for (const column of [
      'id BIGSERIAL PRIMARY KEY',
      'user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE',
      'platform TEXT NOT NULL',
      'platform_uid TEXT NOT NULL',
      'display_name TEXT NOT NULL',
      'account_name TEXT',
      'avatar TEXT',
      'followers BIGINT',
      'is_active BOOLEAN NOT NULL DEFAULT true',
      'credential_ciphertext BYTEA NOT NULL',
      'credential_iv BYTEA NOT NULL',
      'credential_auth_tag BYTEA NOT NULL',
      'encrypted_data_key BYTEA NOT NULL',
      'credential_digest TEXT NOT NULL',
      'credential_updated_at TIMESTAMPTZ NOT NULL',
      'metadata_updated_at TIMESTAMPTZ NOT NULL',
      'last_sync_device_label TEXT',
      'created_at TIMESTAMPTZ NOT NULL',
      'updated_at TIMESTAMPTZ NOT NULL',
      'last_reported_status TEXT',
    ]) {
      assert.ok(accounts.includes(column), `cloud_accounts 缺少列定义：${column}`)
    }
    // 信封四列必须是 BYTEA NOT NULL，摘要必须是 TEXT NOT NULL（判变更的唯一依据）。
    assert.match(accounts, /credential_ciphertext BYTEA NOT NULL/)
    assert.match(accounts, /credential_digest TEXT NOT NULL/)
    // 合并键不接受空串（PRD §6.1「不接受空串」）。
    assert.match(accounts, /CHECK\s*\(\s*platform_uid\s*(?:<>\s*''|>\s*0|LENGTH)/)
    // 墓碑表：合并键三列 + deleted_at。
    for (const column of [
      'user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE',
      'platform TEXT NOT NULL',
      'platform_uid TEXT NOT NULL',
      'deleted_at TIMESTAMPTZ NOT NULL',
    ]) {
      assert.ok(tombstones.includes(column), `cloud_account_tombstones 缺少列定义：${column}`)
    }
    assert.match(
      tombstones,
      /CONSTRAINT\s+cloud_account_tombstones_user_platform_uid_key\s+UNIQUE\s*\(\s*user_id\s*,\s*platform\s*,\s*platform_uid\s*\)/,
    )
  })

  await t.test('外键方向：先建表再建索引，宽表不出现无前导 user_id 的查询索引', () => {
    const statements = ddlStatements(targetSql().sql)
    const order = statements.map((s) => s.replace(/\s+/g, ' '))
    const createAccounts = order.findIndex((s) => /^CREATE TABLE IF NOT EXISTS cloud_accounts\b/.test(s))
    const createTombstones = order.findIndex((s) => /^CREATE TABLE IF NOT EXISTS cloud_account_tombstones\b/.test(s))
    const indexes = order
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => /^CREATE INDEX IF NOT EXISTS/.test(s))
    assert.ok(createAccounts >= 0 && createTombstones >= 0)
    // 每张索引必须建在**自己那张表**之后（同一迁移里跨表穿插是合法的，同表倒序会让 CREATE INDEX 直接报错）。
    for (const { s, i } of indexes) {
      const owns = /\bON\s+cloud_account_tombstones\b/.test(s) ? 'tombstones' : 'accounts'
      const ownerIndex = owns === 'tombstones' ? createTombstones : createAccounts
      assert.ok(i > ownerIndex, `${s.slice(0, 60)} 建在了 ${owns} 建表语句之前`)
      assert.match(s, /ON\s+(?:cloud_accounts|cloud_account_tombstones)\s*\(\s*user_id\b/, `索引未以 user_id 前导：${s.slice(0, 80)}`)
    }
    assert.strictEqual(indexes.length, 2, '两表各一条 user_id 前导索引')
  })

  await t.test('迁移幂等：全部 DDL 使用 IF NOT EXISTS，不出现探测式 DDL', () => {
    const statements = ddlStatements(targetSql().sql)
    assert.ok(statements.length >= 4, '005 正文解析出的 DDL 语句过少')
    for (const s of statements) {
      assert.match(s, /^CREATE (?:TABLE|INDEX) IF NOT EXISTS/, `非幂等 DDL：${s.slice(0, 60)}`)
    }
    // AGENTS.md「PostgreSQL migration 最小权限」：迁移本体不得写 DO/EXISTS 探测式 DDL。
    const joined = statements.join(' ')
    assert.strictEqual(/DO\s*\$/i.test(joined), false)
    assert.strictEqual(/\bIF\s+EXISTS\s*\(/i.test(joined), false)
    assert.strictEqual(/DROP\s+(?:TABLE|INDEX)/i.test(joined), false)
  })

  await t.test('validateMigrationLedger 接受把 005 记为已应用的 ledger', () => {
    const { checksum, discoverMigrations, validateMigrationLedger } = require('../src/auth/postgres-migrations')
    const migrations = discoverMigrations(MIGRATIONS_DIR)
    const ledger = migrations.map((item) => ({ name: item.name, checksum: item.checksum }))
    const result = validateMigrationLedger(migrations, ledger, { allowPending: false })
    assert.deepStrictEqual(result.pending, [])
    assert.ok(result.applied.includes(MIGRATION_NAME))
    // checksum 必须由文件内容决定：内容漂移时 ledger 校验必须变红。
    const target = migrations.find((item) => item.name === MIGRATION_NAME)
    assert.strictEqual(typeof target.checksum, 'string')
    assert.strictEqual(target.checksum, checksum(target.sql))
    assert.throws(
      () => validateMigrationLedger(migrations, ledger.map((e) => (e.name === MIGRATION_NAME ? { ...e, checksum: 'stale' } : e)), { allowPending: false }),
      (error) => error.code === 'MIGRATION_CHECKSUM_MISMATCH',
    )
  })
})
