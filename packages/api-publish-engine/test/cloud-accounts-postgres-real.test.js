'use strict'
/**
 * 账号云镜像 —— 真实 PostgreSQL 回归（CI job: QG Business API Postgres）
 *
 * 为什么单独成文件：本包既有的库层测试全部跑在手写 fake client 上（见
 * test/postgres-migrations.test.js、test/member-commerce-migrations.test.js）。
 * fake client 只记录 SQL 文本，**不执行** SQL，所以它对下面这些失败完全免疫：
 *   * 列名/类型拼错（`credential_auth_tag` vs `credential_tag`）
 *   * `ON CONFLICT` 目标列与真库唯一约束不一致（真库直接 42P10）
 *   * 迁移文件的 DDL 语法本身错（fake 只是把字符串塞进 query 记录）
 *   * BYTEA 与 Buffer 往返、TIMESTAMPTZ 与 Date 往返
 *   * 外键方向与 `ON DELETE CASCADE` 是否真的级联
 * 那些只有真库能证伪。CI 默认全 windows-latest（不支持 services: 容器），
 * 所以这个文件在没有 BUSINESS_DATABASE_URL 时**整体跳过**——跳过不是通过，
 * PR 与 .quality-gates.md 必须如实记录它是否在真库跑过。
 */
const test = require('node:test').test
const assert = require('node:assert/strict')
const path = require('path')

const DATABASE_URL = String(process.env.BUSINESS_DATABASE_URL || '').trim()
const RUN = DATABASE_URL ? test : test.skip

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations/postgresql')

const KMS_KEY_ENV = 'MP_CLOUD_KMS_LOCAL_KEY'
// 仅测试用固定密钥（32 字节 hex）。真部署必须由云 KMS 提供，见 docs/adr/0003。
const TEST_KMS_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

/** 构造一条合法上行账号（元数据 + 明文凭证，由服务端负责加密）。 */
function account(platform, platformUid, overrides) {
  return Object.assign({
    platform,
    platformUid,
    displayName: '测试账号' + platformUid,
    accountName: '昵称' + platformUid,
    avatar: 'https://cdn.example.com/a.png',
    followers: 100,
    isActive: true,
    credential: {
      cookies: [
        { name: 'sessionid', value: 'v-' + platformUid, domain: '.example.com', path: '/', secure: true },
        { name: 'uid', value: platformUid, domain: '.example.com', path: '/', secure: true },
      ],
      localStorage: { user_name: '昵称' + platformUid },
      indexedDB: {},
    },
  }, overrides || {})
}

async function withServices(run) {
  process.env[KMS_KEY_ENV] = process.env[KMS_KEY_ENV] || TEST_KMS_KEY
  const { Client, Pool } = require('pg')
  const { runMigrations } = require('../src/auth/postgres-migrations')
  const cloudAccounts = require('../src/cloud-accounts')
  const { createCloudAccountServices } = cloudAccounts

  const bootstrap = new Client({ connectionString: DATABASE_URL })
  await bootstrap.connect()
  try {
    const migration = await runMigrations({ client: bootstrap, directory: MIGRATIONS_DIR })
    // 迁移必须真的把 005 落到库里；applied 或 skipped（本 job 内已跑过）都算存在
    const known = migration.applied.concat(migration.skipped)
    assert.ok(known.includes('005_cloud_accounts.sql'),
      '005_cloud_accounts.sql 未出现在 ledger：' + JSON.stringify(migration))
  } finally {
    await bootstrap.end().catch(() => {})
  }

  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 })
  const services = createCloudAccountServices({ pool })
  try {
    return await run(services, pool)
  } finally {
    await pool.end().catch(() => {})
  }
}

/** 直接走 HTTP 处理层，避免把断言建立在 repository 私有方法名上。 */
async function call(services, method, url, body, authUserId) {
  let captured = { status: null, body: null }
  const res = await services.handle({
    method,
    url,
    req: { method, url, headers: {} },
    auth: { businessUser: { id: authUserId || 'user-real-1' } },
    bodyParser: () => Promise.resolve(body === undefined ? null : body),
    json: (status, out) => { captured = { status, body: out } },
    now: () => Date.now(),
  })
  return res || captured
}

async function cleanup(pool, userId) {
  await pool.query('DELETE FROM cloud_account_tombstones WHERE user_id = $1', [userId])
  await pool.query('DELETE FROM cloud_accounts WHERE user_id = $1', [userId])
}

const USER_A = 'user-real-a'
const USER_B = 'user-real-b'

RUN('真库：005 迁移建出的列与仓储 SQL 对得上（BYTEA/TIMESTAMPTZ 往返）', async () => {
  await withServices(async (services, pool) => {
    const columns = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'cloud_accounts' ORDER BY ordinal_position`)
    const names = columns.rows.map((r) => r.column_name)
    for (const required of [
      'user_id', 'platform', 'platform_uid', 'display_name', 'account_name',
      'credential_ciphertext', 'credential_iv', 'credential_auth_tag',
      'encrypted_data_key', 'credential_digest', 'credential_updated_at',
    ]) {
      assert.ok(names.includes(required), 'cloud_accounts 缺少列 ' + required + '，实有 ' + names.join(','))
    }
    const bytea = columns.rows.filter((r) => r.data_type === 'bytea').map((r) => r.column_name)
    for (const field of ['credential_ciphertext', 'credential_iv', 'credential_auth_tag', 'encrypted_data_key']) {
      assert.ok(bytea.includes(field), field + ' 必须是 bytea，实为 ' + JSON.stringify(columns.rows.find((r) => r.column_name === field)))
    }

    const put = await call(services, 'PUT', '/api/v1/me/accounts',
      { accounts: [account('douyin', 'real-uid-1')] }, USER_A)
    assert.equal(put.status, 200, JSON.stringify(put.body))
    assert.equal(put.body.results[0].outcome, 'created', JSON.stringify(put.body))

    const rows = await pool.query(
      `SELECT credential_ciphertext, credential_iv, credential_auth_tag, encrypted_data_key, credential_digest
         FROM cloud_accounts WHERE user_id = $1 AND platform_uid = $2`, [USER_A, 'real-uid-1'])
    assert.equal(rows.rows.length, 1)
    const row = rows.rows[0]
    // pg 把 bytea 解成 Buffer：能拿到 Buffer 就证明 DDL 类型与写入编码一致
    for (const field of ['credential_ciphertext', 'credential_iv', 'credential_auth_tag', 'encrypted_data_key']) {
      assert.ok(Buffer.isBuffer(row[field]) && row[field].length > 0, field + ' 未往返成非空 Buffer，实得 ' + require('util').inspect(row[field]))
    }
    assert.match(row.credential_digest, /^[0-9a-f]{64}$/)
    await cleanup(pool, USER_A)
  })
})

RUN('真库：合并键唯一约束生效，同 (platform, platform_uid) 不产生第二行', async () => {
  await withServices(async (services, pool) => {
    const first = await call(services, 'PUT', '/api/v1/me/accounts',
      { accounts: [account('douyin', 'real-uid-dup')] }, USER_A)
    assert.equal(first.body.results[0].outcome, 'created')

    const second = await call(services, 'PUT', '/api/v1/me/accounts',
      { accounts: [account('douyin', 'real-uid-dup', { followers: 999 })] }, USER_A)
    assert.equal(second.body.results[0].outcome, 'updated', JSON.stringify(second.body))

    const count = await pool.query(
      `SELECT count(*)::int AS n FROM cloud_accounts WHERE user_id = $1 AND platform = 'douyin' AND platform_uid = 'real-uid-dup'`,
      [USER_A])
    assert.equal(count.rows[0].n, 1, '唯一约束没拦住，出现重复行')

    // 同 uid 再送完全相同的内容 → unchanged，且不得刷新 updated_at
    const before = await pool.query(
      `SELECT updated_at FROM cloud_accounts WHERE user_id = $1 AND platform_uid = 'real-uid-dup'`, [USER_A])
    const third = await call(services, 'PUT', '/api/v1/me/accounts',
      { accounts: [account('douyin', 'real-uid-dup', { followers: 999 })] }, USER_A)
    assert.equal(third.body.results[0].outcome, 'unchanged', JSON.stringify(third.body))
    const after = await pool.query(
      `SELECT updated_at FROM cloud_accounts WHERE user_id = $1 AND platform_uid = 'real-uid-dup'`, [USER_A])
    assert.equal(before.rows[0].updated_at.getTime(), after.rows[0].updated_at.getTime(),
      'unchanged 仍刷新了 updated_at（会把"没动过"的账号伪装成刚同步过）')
    await cleanup(pool, USER_A)
  })
})

RUN('真库：库内取证不含任何 cookie 明文子串', async () => {
  await withServices(async (services, pool) => {
    const secret = 'super-secret-session-value'
    await call(services, 'PUT', '/api/v1/me/accounts',
      { accounts: [account('bilibili', 'real-uid-secret', {
        credential: { cookies: [{ name: 'SESSDATA', value: secret, domain: '.bilibili.com', path: '/' }], localStorage: {}, indexedDB: {} },
      })] }, USER_A)

    const dump = await pool.query(
      `SELECT encode(credential_ciphertext,'escape') AS c, encode(credential_iv,'escape') AS i,
              encode(encrypted_data_key,'escape') AS k, credential_digest AS d
         FROM cloud_accounts WHERE user_id = $1`, [USER_A])
    const all = dump.rows.map((r) => [r.c, r.i, r.k, r.d].join('|')).join('\n')
    assert.ok(!all.includes(secret), '库内出现明文 cookie —— 信封加密没生效')
    assert.ok(!all.includes('SESSDATA'), '库内出现 cookie 名，凭证 JSON 未加密')
    await cleanup(pool, USER_A)
  })
})

RUN('真库：按用户隔离（A 读不到 B 的任何行）', async () => {
  await withServices(async (services, pool) => {
    await call(services, 'PUT', '/api/v1/me/accounts', { accounts: [account('douyin', 'real-uid-a')] }, USER_A)
    await call(services, 'PUT', '/api/v1/me/accounts', { accounts: [account('douyin', 'real-uid-b'), account('zhihu', 'real-uid-b2')] }, USER_B)

    const asA = await call(services, 'GET', '/api/v1/me/accounts?view=full', undefined, USER_A)
    assert.equal(asA.status, 200, JSON.stringify(asA.body))
    const keysA = asA.body.accounts.map((a) => a.platformUid)
    assert.deepEqual(keysA, ['real-uid-a'], 'A 读到了别人的账号：' + JSON.stringify(keysA))
    assert.equal(asA.body.accounts[0].credential, undefined, 'full 视图不得回传凭证内容')

    const asB = await call(services, 'GET', '/api/v1/me/accounts?view=digest', undefined, USER_B)
    assert.equal(asB.body.total, 2, 'B 的计数被 A 污染：' + JSON.stringify(asB.body))
    await cleanup(pool, USER_A)
    await cleanup(pool, USER_B)
  })
})

RUN('真库：外键 ON DELETE CASCADE 随 identity_users 级联清掉云账号', async () => {
  await withServices(async (services, pool) => {
    // 建一个真实的父用户，云账号挂在它上面；删父用户必须级联删云账号，
    // 否则注销用户后其凭证会永久滞留在库里（合规删除做不到的形态）
    const surrogate = 'user-real-cascade-' + process.pid + '-' + Date.now()
    await pool.query(
      `INSERT INTO identity_users (id, subject, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`, [surrogate, 'sub-cascade-' + surrogate])
    await call(services, 'PUT', '/api/v1/me/accounts', { accounts: [account('douyin', 'real-uid-cascade')] }, surrogate)
    const before = await pool.query('SELECT count(*)::int AS n FROM cloud_accounts WHERE user_id = $1', [surrogate])
    if (before.rows[0].n !== 1) {
      // 父行创建方式与真实 schema 不符（列名/约束差异）——这本身就是要在真库暴露的问题
      throw new assert.AssertionError({
        message: '云账号未能挂到真实 identity_users 行（FK 目标或父表列与本测试假设不一致）：' + JSON.stringify(before.rows),
        expected: 1, actual: before.rows[0].n, operator: '===',
      })
    }
    await pool.query('DELETE FROM identity_users WHERE id = $1', [surrogate])
    const after = await pool.query('SELECT count(*)::int AS n FROM cloud_accounts WHERE user_id = $1', [surrogate])
    assert.equal(after.rows[0].n, 0, '删父用户后云账号残留 —— ON DELETE CASCADE 没生效')
  })
})

RUN('真库：断开云端清空该用户账号与墓碑，且不影响其他用户', async () => {
  await withServices(async (services, pool) => {
    await call(services, 'PUT', '/api/v1/me/accounts', { accounts: [account('douyin', 'real-uid-d1')] }, USER_A)
    await call(services, 'PUT', '/api/v1/me/accounts', { accounts: [account('toutiao', 'real-uid-d2')] }, USER_B)
    await call(services, 'POST', '/api/v1/me/accounts/disconnect', { confirm: 'cloud' }, USER_A)

    const mine = await pool.query('SELECT count(*)::int AS n FROM cloud_accounts WHERE user_id = $1', [USER_A])
    assert.equal(mine.rows[0].n, 0, '断开后 A 的云端账号未清空')
    const theirs = await pool.query('SELECT count(*)::int AS n FROM cloud_accounts WHERE user_id = $1', [USER_B])
    assert.equal(theirs.rows[0].n, 1, '断开越界删了 B 的账号')
    await cleanup(pool, USER_B)
  })
})
