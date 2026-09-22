# 会员中心阶段 1 · P1 服务端底座 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `packages/api-publish-engine` 补齐会员中心阶段 1 的服务端底座：三档权益矩阵、订阅写入路径、兑换码核销（幂等）、订单、消息中心、设备会话与账号资料接口。

**Architecture:** 复用既有 Postgres 身份链路（`identity_*` 表 + `PostgresEntitlementProvider` + RSA 快照）。新增 `004_member_commerce.sql` 迁移建 3 张表并扩会话列；新建 `plan-matrix.js`（服务端唯一权益真源）与 `subscription-service.js`（核销/开通/到期降级的单事务编排）；`publish-api-server.js` 按既有 `_handle` 路由链新增会员/商务端点，运营入口走 `admin:users` scope。

**Tech Stack:** Node.js ≥18、`pg` 8.16.3、`node:test`（fake pool / 真实 HTTP + `TestPublishApiServer`）、PostgreSQL 迁移账本（`migrations/postgresql/`）。

**关联 spec：** `01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md` §2/§3/§5.1-5.3/§8/§9（本文所有任务以此为验收来源）

**会话隔离（MANDATORY）：** 本计划是运行时代码变更，禁止在共享主目录 `D:\Data\projects\Multi-Publish`（main）直接改码。所有 Task 0-9 在 `scripts/start-mp-task.ps1 -TaskName member-center-p1` 创建的 worktree（默认 `D:\Data\projects\mp-worktrees\mp-member-center-p1`，分支 `codex/member-center-p1`）中执行；git 写操作一律 PowerShell 原生 `D:\` 路径。

---

## 文件结构（先读后写）

| 文件 | 操作 | 职责 |
|---|---|---|
| `migrations/postgresql/004_member_commerce.sql` | 新建 | 生产迁移：`identity_orders`、`identity_redeem_codes`、`identity_notifications` + 会话表扩列 |
| `packages/api-publish-engine/src/auth/plan-matrix.js` | 新建 | 三档权益矩阵 + 价目目录（服务端唯一真源，支持 overrides 注入） |
| `packages/api-publish-engine/src/auth/postgres-identity-repository.js` | 修改 | SCHEMA/REQUIRED 关系 + 商务读写方法 + `commerceTransaction` |
| `packages/api-publish-engine/src/auth/subscription-service.js` | 新建 | 核销/后台开通/到期降级/视图组装（单事务） |
| `packages/api-publish-engine/src/auth/logto-runtime.js` | 修改 | runtime 组装 `subscriptionService` |
| `packages/api-publish-engine/bin/publish-api` | 修改 | server 构造注入 `subscriptionService` |
| `packages/api-publish-engine/src/publish-api-server.js` | 修改 | `_requiredScope` + 会员/商务/admin 路由 + `/api/v1/me` 扩展 |
| `packages/api-publish-engine/test/member-commerce-migrations.test.js` | 新建 | 迁移/SCHEMA/readiness 回归 |
| `packages/api-publish-engine/test/plan-matrix.test.js` | 新建 | 矩阵契约回归 |
| `packages/api-publish-engine/test/member-commerce-repository.test.js` | 新建 | 仓储 SQL 回归 |
| `packages/api-publish-engine/test/subscription-service.test.js` | 新建 | 状态机/幂等/到期回归 |
| `packages/api-publish-engine/test/member-commerce-api.test.js` | 新建 | HTTP 端点合同回归 |

**测试运行方式（本包惯例）：** 单文件 `node packages/api-publish-engine/test/<file>.test.js`；全量 `pnpm --filter @multi-publish/api-publish-engine test`（`scripts/run-tests.js` 自动发现 `test/*.test.js`，无需注册）。

---

## Task 0：启动隔离 worktree 并就绪依赖

- [ ] **Step 1: 创建/进入 worktree（PowerShell，共享根保持 clean）**

```powershell
cd D:\Data\projects\Multi-Publish
git status --porcelain          # 期望输出为空（共享根必须干净）
powershell -ExecutionPolicy Bypass -File scripts/start-mp-task.ps1 -TaskName member-center-p1
```

预期：输出 worktree 路径 `D:\Data\projects\mp-worktrees\mp-member-center-p1` 与分支 `codex/member-center-p1`，并自动声明 `.agent_context/expected-branch`。若共享根 dirty：立即停止并报告用户，禁止 stash/checkout 补救（硬纪律 A）。

- [ ] **Step 2: 依赖就绪三连**

```powershell
cd D:\Data\projects\mp-worktrees\mp-member-center-p1
pnpm install --frozen-lockfile
node scripts/ensure-electron.js
node scripts/verify-worktree-deps.js
```

预期：三条命令 exit 0；`verify-worktree-deps.js` 断言 `@multi-publish/*` 解析到当前 worktree。

- [ ] **Step 3: 基线测试确认（不允许带着存量红开始）**

```powershell
cd D:\Data\projects\mp-worktrees\mp-member-center-p1\packages\api-publish-engine
node scripts/run-tests.js
```

预期：exit 0。若存量失败，先记录失败清单并报告用户，不得混入本任务修复。

---

## Task 1：迁移 004 + 开发态 SCHEMA + readiness 关系表

**Files:**
- Create: `migrations/postgresql/004_member_commerce.sql`
- Modify: `packages/api-publish-engine/src/auth/postgres-identity-repository.js`（`REQUIRED_SCHEMA_RELATIONS`、`SCHEMA`）
- Test: `packages/api-publish-engine/test/member-commerce-migrations.test.js`

- [ ] **Step 1: 写失败测试**

创建 `packages/api-publish-engine/test/member-commerce-migrations.test.js`：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/api-publish-engine/test/member-commerce-migrations.test.js`
Expected: FAIL —「缺少 004_member_commerce.sql」

- [ ] **Step 3: 新建迁移文件**

创建 `migrations/postgresql/004_member_commerce.sql`（事务外壳必须包裹全文，见 `postgres-migrations.js:normalizeMigrationSql`）：

```sql
-- 会员中心阶段 1 · 商务底座：订单 / 兑换码 / 消息中心 / 设备会话画像。
-- 真源：01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md §3.2/§3.3/§3.5/§3.6。

BEGIN;

CREATE TABLE IF NOT EXISTS identity_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('free', 'standard', 'pro')),
    amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY',
    channel TEXT NOT NULL CHECK (channel IN ('redeem', 'admin_grant', 'payment')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'canceled')),
    invoice_status TEXT NOT NULL DEFAULT 'none' CHECK (invoice_status IN ('none', 'requested', 'issued')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_identity_orders_user
    ON identity_orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS identity_redeem_codes (
    code TEXT PRIMARY KEY,
    plan TEXT NOT NULL CHECK (plan IN ('standard', 'pro')),
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    batch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'disabled')),
    used_by TEXT REFERENCES identity_users(id),
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_redeem_codes_batch
    ON identity_redeem_codes(batch);

CREATE TABLE IF NOT EXISTS identity_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'critical')),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_notifications_user
    ON identity_notifications(user_id, created_at DESC);

-- 设备会话画像：id 为 sha256(user_id:device_id) 派生，
-- upsert 走 ON CONFLICT (id) DO UPDATE（复活 revoked 行），广播消息按用户 fan-out。
ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS device_name TEXT;
ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_identity_user_sessions_device
    ON identity_user_sessions(user_id) WHERE device_id IS NOT NULL;

COMMIT;
```

- [ ] **Step 4: 扩展仓储 SCHEMA 与关系表**

修改 `packages/api-publish-engine/src/auth/postgres-identity-repository.js`：

`REQUIRED_SCHEMA_RELATIONS` 数组（第 7-15 行）在 `'identity_user_sessions'` 之后追加：

```js
  'identity_orders',
  'identity_redeem_codes',
  'identity_notifications',
```

`SCHEMA` 数组（第 17-80 行）末尾（`identity_user_sessions` 建表语句之后）追加以下条目（与 004 迁移逐字一致，去掉 BEGIN/COMMIT；缩进按文件既有 2 空格风格）：

```js
  `CREATE TABLE IF NOT EXISTS identity_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('free', 'standard', 'pro')),
    amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY',
    channel TEXT NOT NULL CHECK (channel IN ('redeem', 'admin_grant', 'payment')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded', 'canceled')),
    invoice_status TEXT NOT NULL DEFAULT 'none' CHECK (invoice_status IN ('none', 'requested', 'issued')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identity_orders_user
    ON identity_orders(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS identity_redeem_codes (
    code TEXT PRIMARY KEY,
    plan TEXT NOT NULL CHECK (plan IN ('standard', 'pro')),
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    batch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'disabled')),
    used_by TEXT REFERENCES identity_users(id),
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identity_redeem_codes_batch
    ON identity_redeem_codes(batch)`,
  `CREATE TABLE IF NOT EXISTS identity_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'critical')),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identity_notifications_user
    ON identity_notifications(user_id, created_at DESC)`,
  `ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS device_id TEXT`,
  `ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS device_name TEXT`,
  `ALTER TABLE identity_user_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`,
```

注意：`assertReady()` 按 `REQUIRED_SCHEMA_RELATIONS` 检查 `to_regclass`，新表纳入后**存量库必须先跑迁移**，否则 readiness fail closed——这是预期行为（生产 `scripts/migrate-postgres.js`，开发 `initialize()`）。同时更新存量测试 `test/postgres-identity-repository.test.js` 中两处 `expected` / `expectedRelations` 数组，补上三个新表名（断言与实现同源）。

- [ ] **Step 5: 运行新旧测试确认通过**

Run（均在 `packages/api-publish-engine` 下）：
```powershell
node test/member-commerce-migrations.test.js
node test/postgres-identity-repository.test.js
node test/postgres-migrations.test.js
```
Expected: 三个 exit 0

- [ ] **Step 6: Commit**

```powershell
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 add migrations/postgresql/004_member_commerce.sql packages/api-publish-engine/src/auth/postgres-identity-repository.js packages/api-publish-engine/test/member-commerce-migrations.test.js packages/api-publish-engine/test/postgres-identity-repository.test.js
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 commit -m "feat(member-center): P1-T1 商务底座迁移 004（订单/兑换码/消息/会话画像）"
```

---

## Task 2：三档权益矩阵 plan-matrix.js（服务端唯一真源）

**Files:**
- Create: `packages/api-publish-engine/src/auth/plan-matrix.js`
- Test: `packages/api-publish-engine/test/plan-matrix.test.js`

- [ ] **Step 1: 写失败测试**

创建 `packages/api-publish-engine/test/plan-matrix.test.js`：

```js
const assert = require('assert')
const test = require('node:test')

const { PLAN_IDS, getPlanEntitlement, getPlanCatalog, PLAN_MATRIX_VERSION } = require('../src/auth/plan-matrix')

test('plan-matrix 契约（spec §2）', async (t) => {
  await t.test('档位枚举与版本', () => {
    assert.deepStrictEqual([...PLAN_IDS], ['free', 'standard', 'pro'])
    assert.strictEqual(typeof PLAN_MATRIX_VERSION, 'string')
    assert.throws(() => { PLAN_IDS.push('enterprise') }, /object|frozen|not extensible/i)
  })

  await t.test('价格与 spec 矩阵逐字一致（单位：分）', () => {
    const catalog = getPlanCatalog()
    assert.strictEqual(catalog.length, 3)
    const [free, standard, pro] = catalog
    assert.strictEqual(free.priceMonthlyCents, 0)
    assert.strictEqual(standard.priceMonthlyCents, 2900)
    assert.strictEqual(standard.priceYearlyCents, 19900)
    assert.strictEqual(pro.priceMonthlyCents, 7900)
    assert.strictEqual(pro.priceYearlyCents, 59900)
    for (const item of catalog) assert.strictEqual(item.currency, 'CNY')
  })

  await t.test('无限值约定 -1：pro 平台数 / standard AI 写稿（自有 Key）', () => {
    assert.strictEqual(getPlanEntitlement('pro').limits.max_platforms, -1)
    assert.strictEqual(getPlanEntitlement('standard').quota.ai_write_monthly, -1)
    assert.strictEqual(getPlanEntitlement('free').limits.max_platforms, 5)
    assert.strictEqual(getPlanEntitlement('standard').limits.max_platforms, 15)
  })

  await t.test('日发布数折算 cloud_publish_monthly = daily_publish × 30（双口径）', () => {
    assert.strictEqual(getPlanEntitlement('free').quota.cloud_publish_monthly, 5 * 30)
    assert.strictEqual(getPlanEntitlement('standard').quota.cloud_publish_monthly, 50 * 30)
    assert.strictEqual(getPlanEntitlement('pro').limits.daily_publish, 1000)
    assert.strictEqual(getPlanEntitlement('pro').quota.cloud_publish_monthly, 1000 * 30)
  })

  await t.test('feature/quota 形状对齐 consumeFeature 契约（features 数组 + 顶层 quota）', () => {
    const free = getPlanEntitlement('free')
    assert.ok(free.features.includes('cloud_publish'))
    assert.ok(free.features.includes('ai_write'))
    assert.ok(!free.features.includes('video_create'))
    assert.ok(!free.features.includes('schedule_batch'))
    assert.ok(!free.features.includes('dashboard_full'))
    const standard = getPlanEntitlement('standard')
    assert.ok(standard.features.includes('video_create'))
    assert.ok(standard.features.includes('schedule_batch'))
    assert.ok(standard.features.includes('dashboard_full'))
    assert.strictEqual(standard.quota.video_create_monthly, 500)
    assert.strictEqual(getPlanEntitlement('pro').quota.video_create_monthly, 3000)
    assert.strictEqual(standard.limits.concurrent_tasks, 3)
    assert.strictEqual(getPlanEntitlement('pro').limits.concurrent_tasks, 10)
    // 官方积分档位：free 无 / standard 中 / pro 高
    assert.strictEqual(free.quota.official_credit_monthly, 0)
    assert.ok(standard.quota.official_credit_monthly > 0)
    assert.ok(getPlanEntitlement('pro').quota.official_credit_monthly > standard.quota.official_credit_monthly)
  })

  await t.test('运营 overrides 注入：合法覆盖生效、未知键与非法值 fail closed', () => {
    const patched = getPlanEntitlement('standard', { standard: { videoMonthly: 600 } })
    assert.strictEqual(patched.quota.video_create_monthly, 600)
    assert.strictEqual(getPlanEntitlement('standard').quota.video_create_monthly, 500) // 不污染基线
    assert.throws(() => getPlanEntitlement('standard', { standard: { noSuchKey: 1 } }), /unknown key/i)
    assert.throws(() => getPlanEntitlement('standard', { standard: { videoMonthly: 1.5 } }), /integer/i)
    assert.throws(() => getPlanEntitlement('standard', { standard: { videoMonthly: -2 } }), /-1|range|invalid/i)
  })

  await t.test('未知档位抛 PLAN_INVALID', () => {
    assert.throws(() => getPlanEntitlement('enterprise'), (err) => err.code === 'PLAN_INVALID')
  })

  await t.test('返回值深冻结，调用方不能篡改矩阵', () => {
    const snapshot = getPlanEntitlement('free')
    assert.throws(() => { snapshot.quota.cloud_publish_monthly = 999 }, /read-only|frozen|not extensible|Cannot assign/i)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/api-publish-engine/test/plan-matrix.test.js`
Expected: FAIL — `Cannot find module '../src/auth/plan-matrix'`

- [ ] **Step 3: 实现 plan-matrix.js**

创建 `packages/api-publish-engine/src/auth/plan-matrix.js`：

```js
'use strict'

/**
 * 会员中心 · 三档权益矩阵（服务端唯一真源）。
 * 数据契约：01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md §2。
 *
 * 约定：
 * - 数值 -1 表示「不限」（仅 maxPlatforms / aiWriteMonthly / dailyPublish / videoMonthly / officialCreditMonthly 允许）。
 * - 输出形状直接兼容 PostgresEntitlementProvider.consumeFeature：features 为字符串数组（includes 判定），
 *   quota 为顶层对象且键名对齐 `${feature}_monthly`；limits 为 UI 展示透传字段（扣减路径不读）。
 * - overrides 为运营可配注入（config.yaml，带 * 项），只允许覆盖基线已有数值键。
 * - 客户端禁止硬编码金额/配额，一律通过 GET /api/v1/plans 与 entitlement 快照下发。
 */

const PLAN_MATRIX_VERSION = '2026-09-23'

const PLAN_IDS = Object.freeze(['free', 'standard', 'pro'])

const BASE_MATRIX = {
  free: {
    label: '免费版',
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    maxPlatforms: 5,
    dailyPublish: 5,
    aiWriteMonthly: 200,
    videoMonthly: 0,
    scheduleBatch: false,
    dashboard: 'basic',
    officialCreditMonthly: 0,
    concurrentTasks: 1,
  },
  standard: {
    label: '标准版',
    priceMonthlyCents: 2900,
    priceYearlyCents: 19900,
    maxPlatforms: 15,
    dailyPublish: 50,
    // 「不限」前提是走自有 Key；官方积分受 officialCreditMonthly（中档）约束。
    aiWriteMonthly: -1,
    videoMonthly: 500,
    scheduleBatch: true,
    dashboard: 'full',
    officialCreditMonthly: 500,
    concurrentTasks: 3,
  },
  pro: {
    label: '专业版',
    priceMonthlyCents: 7900,
    priceYearlyCents: 59900,
    maxPlatforms: -1,
    // spec：「不限（默认上限 1000，运营可配）」——用有限高值而非 -1，避免下游除零/无限逻辑。
    dailyPublish: 1000,
    aiWriteMonthly: 12000,
    videoMonthly: 3000,
    scheduleBatch: true,
    dashboard: 'full',
    officialCreditMonthly: 3000,
    concurrentTasks: 10,
  },
}

const NUMERIC_KEYS = Object.freeze([
  'priceMonthlyCents', 'priceYearlyCents', 'maxPlatforms', 'dailyPublish',
  'aiWriteMonthly', 'videoMonthly', 'officialCreditMonthly', 'concurrentTasks',
])
const UNLIMITED_ALLOWED = Object.freeze(['maxPlatforms', 'dailyPublish', 'aiWriteMonthly', 'videoMonthly', 'officialCreditMonthly'])

function validateNumericValue(key, value, context) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`plan-matrix: '${key}' in ${context} must be an integer`)
  }
  if (value === -1 && !UNLIMITED_ALLOWED.includes(key)) {
    throw new Error(`plan-matrix: '${key}' in ${context} does not accept -1 (unlimited)`)
  }
  if (value < -1) {
    throw new Error(`plan-matrix: '${key}' in ${context} must be >= -1`)
  }
}

function mergePlanSection(plan, overrides) {
  const base = BASE_MATRIX[plan]
  if (!overrides) return { ...base }
  const section = overrides[plan]
  if (!section) return { ...base }
  const merged = { ...base }
  for (const [key, value] of Object.entries(section)) {
    if (!(key in base)) throw new Error(`plan-matrix: unknown key '${key}' for plan ${plan}`)
    if (!NUMERIC_KEYS.includes(key)) {
      // scheduleBatch/dashboard/label 为契约开关，阶段 1 冻结为不可覆盖（运营可配仅覆盖数值 * 项）
      throw new Error(`plan-matrix: key '${key}' for plan ${plan} is not overridable`)
    }
    validateNumericValue(key, value, `plan ${plan}`)
    merged[key] = value
  }
  return merged
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value)
  }
  return Object.freeze(obj)
}

/** entitlement 形状：{ plan, features: string[], quota: {}, limits: {} }，兼容 consumeFeature，供 /api/v1/me 快照直接落库。 */
function getPlanEntitlement(plan, overrides) {
  if (!PLAN_IDS.includes(plan)) {
    const err = new Error(`plan-matrix: unknown plan '${plan}'`)
    err.code = 'PLAN_INVALID'
    throw err
  }
  const matrix = mergePlanSection(plan, overrides)
  const features = ['cloud_publish', 'ai_write']
  if (matrix.videoMonthly > 0) features.push('video_create')
  if (matrix.scheduleBatch === true) features.push('schedule_batch')
  if (matrix.dashboard === 'full') features.push('dashboard_full')
  const cloudPublishMonthly = matrix.dailyPublish === -1 ? -1 : matrix.dailyPublish * 30
  return deepFreeze({
    plan,
    matrixVersion: PLAN_MATRIX_VERSION,
    features,
    quota: {
      cloud_publish_monthly: cloudPublishMonthly,
      ai_write_monthly: matrix.aiWriteMonthly,
      video_create_monthly: matrix.videoMonthly,
      official_credit_monthly: matrix.officialCreditMonthly,
    },
    limits: {
      max_platforms: matrix.maxPlatforms,
      daily_publish: matrix.dailyPublish,
      concurrent_tasks: matrix.concurrentTasks,
    },
  })
}

/** 价目目录（GET /api/v1/plans 展示用，含展示字段，与权益分离）。 */
function getPlanCatalog(overrides) {
  return PLAN_IDS.map((plan) => {
    const matrix = mergePlanSection(plan, overrides)
    return deepFreeze({
      id: plan,
      label: matrix.label,
      currency: 'CNY',
      priceMonthlyCents: matrix.priceMonthlyCents,
      priceYearlyCents: matrix.priceYearlyCents,
      entitlement: getPlanEntitlement(plan, overrides),
    })
  })
}

module.exports = { PLAN_MATRIX_VERSION, PLAN_IDS, getPlanEntitlement, getPlanCatalog }
```

注意：`getPlanEntitlement` 输出形状 `{ plan, features: string[], quota, limits }` 与 `PostgresEntitlementProvider.getForUser/requireFeature/consumeFeature` 现有消费契约（`features.includes(...)` + `quota[`${feature}_monthly`]`）直接兼容；Task 6 `_buildEntitlement` 只需补 `quota`/`limits` 透传。快照 `cloud_publish_monthly` 全档位为有限正整数（-1 不进入被扣减的 feature），与 `consumeFeature` 的 `limit >= 0` 校验不冲突；`ai_write_monthly = -1`（标准版）仅作契约下发，P1 服务端无 `consumeFeature('ai_write')` 调用路径（AI 写稿在桌面端本地执行）。

- [ ] **Step 4: 运行确认通过**

Run: `node packages/api-publish-engine/test/plan-matrix.test.js`
Expected: exit 0

- [ ] **Step 5: Commit**

```powershell
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 add packages/api-publish-engine/src/auth/plan-matrix.js packages/api-publish-engine/test/plan-matrix.test.js
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 commit -m "feat(member-center): P1-T2 三档权益矩阵 plan-matrix（服务端唯一真源）"
```
