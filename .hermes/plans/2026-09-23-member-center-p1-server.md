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

- [x] **Step 1: 创建/进入 worktree（PowerShell，共享根保持 clean）**

```powershell
cd D:\Data\projects\Multi-Publish
git status --porcelain          # 期望输出为空（共享根必须干净）
powershell -ExecutionPolicy Bypass -File scripts/start-mp-task.ps1 -TaskName member-center-p1
```

预期：输出 worktree 路径 `D:\Data\projects\mp-worktrees\mp-member-center-p1`，分支名即任务名 `member-center-p1`（`gwm-task.sh` 不加 `codex/` 前缀），并自动注册写保护任务。
若共享根 dirty：立即停止并报告用户，禁止 stash/checkout 补救（硬纪律 A）。

环境前置（本机 harness 实测坑，2026-09-23）：

```powershell
# 非交互 shell 继承的 PATH 缺 Git for Windows coreutils，session-init.sh 的 dirname/awk/cygpath 会 127
$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
```

基线前置（同一次实测）：`gwm-task.sh:107` 以 `origin/main` 为 worktree 基线，而共享根 main 上有未推送的本项目文档提交（spec + 本计划）。若 `git rev-list --count origin/main..main` > 0，必须先把本地 main 与上游合流（`git merge origin/main`，非破坏性；禁止对已推送历史 rebase），再在新 worktree 内 `git merge --ff-only main` 把基线抬到含计划文档的提交，否则实施者读不到 spec/计划，且交付时 diff 会吞掉上游 6 个提交的反向改动。

- [x] **Step 2: 依赖就绪三连**

```powershell
cd D:\Data\projects\mp-worktrees\mp-member-center-p1
pnpm install --frozen-lockfile
node scripts/ensure-electron.js
node scripts/verify-worktree-deps.js
```

预期：三条命令 exit 0；`verify-worktree-deps.js` 断言 `@multi-publish/*` 解析到当前 worktree。

- [x] **Step 3: 基线测试确认（不允许带着存量红开始）**

> 实测（2026-09-23，基线 `81be086d6`）：三连 exit 0；`run-tests.js` exit 0，node:test 24 个套件 232 pass / 0 fail，vitest 11 文件 67 pass。日志 `.agent_context/p1-baseline.log`（其间的 `[ERROR] ... execute failed` 是 adapters-interface 空入参用例的预期 stderr，不是失败）。

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
  `CREATE INDEX IF NOT EXISTS idx_identity_user_sessions_device
    ON identity_user_sessions(user_id) WHERE device_id IS NOT NULL`,
```

注意：SCHEMA 数组必须与 004 迁移**逐字一致**（含部分索引），否则开发库 `initialize()` 与生产 `migrate-postgres.js` 产生索引漂移。

`assertReady()` 按 `REQUIRED_SCHEMA_RELATIONS` 检查 `to_regclass`，新表纳入后**存量库必须先跑迁移**，否则 readiness fail closed——这是预期行为（生产 `packages/api-publish-engine/scripts/migrate-postgres.js`，开发 `initialize()`）。同时更新存量测试 `test/postgres-identity-repository.test.js` 的**三处**断言（不是两处）：

1. 第 41-47 行 `initialize()` DDL 断言的 `expected` 数组：补上三张新表与三个新列的 `CREATE TABLE` / `ALTER TABLE` 正则；
2. 第 50 行起 readiness 子测试的 `expectedRelations` 数组：补上 `identity_orders` / `identity_redeem_codes` / `identity_notifications`；
3. **第 129-143 行「生产 PostgreSQL 迁移与运行时所需表保持一致」子测试**：它硬编码了 `['002_logto_identity.sql', '003_logto_webhook_events.sql']` 与六张旧表。必须补入 `'004_member_commerce.sql'` 与三张新表名——否则该测试不再守护「生产迁移必须创建全部运行时所需表」这一不变式（新表缺失时它不会变红，属静默失效）。

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
'use strict'

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
    // dailyPublish 是被扣减 feature 的派生源，-1 会击穿 consumeFeature 的 limit>=0 校验 → 必须 fail closed
    assert.throws(() => getPlanEntitlement('standard', { standard: { dailyPublish: -1 } }), /does not accept -1/i)
    // aiWriteMonthly 允许 -1（P1 无服务端 consumeFeature('ai_write') 路径，仅契约下发）
    assert.doesNotThrow(() => getPlanEntitlement('standard', { standard: { aiWriteMonthly: -1 } }))
  })

  await t.test('未知档位抛 PLAN_INVALID', () => {
    assert.throws(() => getPlanEntitlement('enterprise'), (err) => err.code === 'PLAN_INVALID')
  })

  await t.test('返回值深冻结，调用方不能篡改矩阵', () => {
    const snapshot = getPlanEntitlement('free')
    // 必须 `'use strict'`（见本文件首行）：sloppy 模式下给冻结属性赋值是静默失败，assert.throws 永不满足
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
// 不含 dailyPublish：它派生 quota.cloud_publish_monthly，该 feature 会被 consumeFeature 扣减（要求 limit >= 0），-1 会导致发布链路 503
const UNLIMITED_ALLOWED = Object.freeze(['maxPlatforms', 'aiWriteMonthly', 'videoMonthly', 'officialCreditMonthly'])

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

---

## Task 3：仓储层商务读写（postgres-identity-repository.js 扩展）

**Files:**
- Modify: `packages/api-publish-engine/src/auth/postgres-identity-repository.js`（`PostgresIdentityRepository` 新增池级方法；新增 `PostgresCommerceTransaction` 类；`commerceTransaction` 入口；`module.exports` 补 `PostgresCommerceTransaction`）
- Test: `packages/api-publish-engine/test/member-commerce-repository.test.js`

模式约束（与既有代码一致）：所有 SQL 参数化（$n 占位）；fake pool/record-client 断言 SQL 文本与参数，不依赖真实数据库；事务类沿用 `PostgresWebhookTransaction` 的 `constructor(client)` 风格。

- [ ] **Step 1: 写失败测试**

创建 `packages/api-publish-engine/test/member-commerce-repository.test.js`：

```js
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
    const upsert = client.calls[1]
    assert.match(upsert.text, /INSERT INTO identity_subscriptions/)
    assert.match(upsert.text, /ON CONFLICT \(id\) DO UPDATE SET/)
    assert.strictEqual(upsert.values[0], 'sub-u-1')
    // 续叠：periodStart = max(now, 未到期 current_period_end) = 2026-10-01
    assert.strictEqual(upsert.values[3], new Date('2026-10-01T00:00:00Z').toISOString())
    assert.strictEqual(upsert.values[4], new Date('2026-10-31T00:00:00Z').toISOString())
    assert.match(client.calls[2].text, /INSERT INTO identity_orders/)
    assert.match(client.calls[3].text, /INSERT INTO identity_entitlement_snapshots/)
  })

  await t.test('applySubscription 无存量订阅时从 now 起算', async () => {
    const client = fakeClient()
    client.queue = [
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
    const upsert = client.calls[1]
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
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/api-publish-engine/test/member-commerce-repository.test.js`
Expected: FAIL — `repository.upsertSession is not a function`

- [ ] **Step 3: 实现仓储扩展**

修改 `packages/api-publish-engine/src/auth/postgres-identity-repository.js`，在 `SCHEMA` 数组定义之后插入 SQL 常量与 id 派生函数：

```js
// ——— 会员中心 P1 商务 SQL（spec §3.2/§3.3/§3.5/§3.6）———

const UPSERT_SUBSCRIPTION = `INSERT INTO identity_subscriptions
    (id, user_id, plan, status, current_period_start, current_period_end, provider_reference)
   VALUES ($1, $2, $3, 'active', $4::timestamptz, $5::timestamptz, $6)
   ON CONFLICT (id) DO UPDATE SET
     plan = EXCLUDED.plan,
     status = 'active',
     current_period_start = EXCLUDED.current_period_start,
     current_period_end = EXCLUDED.current_period_end,
     provider_reference = COALESCE(EXCLUDED.provider_reference, identity_subscriptions.provider_reference),
     updated_at = NOW()
   RETURNING *`

const INSERT_ORDER = `INSERT INTO identity_orders
    (id, user_id, plan, amount, currency, channel, status, paid_at)
   VALUES ($1, $2, $3, $4, $5, $6, 'paid', NOW())
   RETURNING *`

const PUT_ENTITLEMENT = `INSERT INTO identity_entitlement_snapshots (user_id, version, payload, updated_at)
   VALUES ($1, 1, $2::jsonb, NOW())
   ON CONFLICT (user_id) DO UPDATE SET
     version = identity_entitlement_snapshots.version + 1,
     payload = EXCLUDED.payload,
     updated_at = NOW()
   RETURNING version`

const UPSERT_SESSION = `INSERT INTO identity_user_sessions (id, user_id, device_id, device_name, last_seen_at)
   VALUES ($1, $2, $3, $4, NOW())
   ON CONFLICT (id) DO UPDATE SET revoked_at = NULL, device_name = EXCLUDED.device_name, last_seen_at = NOW()
   RETURNING *`

/** 会话主键确定性派生：同 (user, device) 重登复活原行而非无限插入新行。 */
function sessionRecordId(userId, deviceId) {
  const digest = crypto.createHash('sha256').update(`${userId}:${deviceId}`).digest('hex').slice(0, 32)
  return `ses-${digest}`
}
```

在 `PostgresWebhookTransaction` 类之后新增事务类（先抽出与池级方法共用的 SQL 常量，避免同一 UPDATE 维护两份实现）：

```js
const EXPIRE_SUBSCRIPTION = `UPDATE identity_subscriptions SET status = 'expired', updated_at = NOW()
   WHERE user_id = $1 AND status = 'active' AND current_period_end <= NOW()
   RETURNING *`

class PostgresCommerceTransaction {
  constructor(client) {
    this.client = client
  }

  async lockRedeemCode(code) {
    const result = await this.client.query(
      'SELECT * FROM identity_redeem_codes WHERE code = $1 FOR UPDATE',
      [code],
    )
    return result.rows[0] || null
  }

  async markRedeemCodeUsed(code, userId) {
    const result = await this.client.query(
      `UPDATE identity_redeem_codes SET status = 'used', used_by = $2, used_at = NOW()
       WHERE code = $1 AND status = 'active' RETURNING *`,
      [code, userId],
    )
    if (!result.rows[0]) {
      throw Object.assign(new Error('REDEEM_CODE_RACE'), { code: 'REDEEM_CODE_RACE', status: 409 })
    }
    return result.rows[0]
  }

  /** 到期置过期：与 free 快照回写同属一个事务（见 SubscriptionService.settleExpiry）。 */
  async expireSubscription(userId) {
    const result = await this.client.query(EXPIRE_SUBSCRIPTION, [userId])
    return result.rows[0] || null
  }

  /** 订阅续叠三连写：subscription upsert → 订单落库 → 权益快照回写（同事务，要么全成要么全回滚）。 */
  async applySubscription({ userId, plan, durationDays, now, order, entitlementPayload }) {
    const nowDate = now instanceof Date ? now : new Date(now)
    // 仓储层不反依赖服务层的 CommerceError（避循环 require），沿用本文件 REDEEM_CODE_RACE 的 code/status 携带风格
    if (Number.isNaN(nowDate.getTime())) {
      throw Object.assign(new Error('COMMERCE_CLOCK_INVALID'), { code: 'COMMERCE_CLOCK_INVALID', status: 503 })
    }
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      throw Object.assign(new Error('DURATION_INVALID'), { code: 'DURATION_INVALID', status: 400 })
    }
    const existingResult = await this.client.query(
      `SELECT * FROM identity_subscriptions
       WHERE user_id = $1 AND status = 'active' AND current_period_end > NOW()
       ORDER BY current_period_end DESC LIMIT 1`,
      [userId],
    )
    const existing = existingResult.rows[0] || null
    const base = existing && new Date(existing.current_period_end) > nowDate
      ? new Date(existing.current_period_end)
      : nowDate
    const periodEnd = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000)
    const subscriptionResult = await this.client.query(UPSERT_SUBSCRIPTION, [
      `sub-${userId}`, userId, plan,
      base.toISOString(), periodEnd.toISOString(), order.providerReference || null,
    ])
    const orderResult = await this.client.query(INSERT_ORDER, [
      order.id, userId, plan, order.amount, order.currency || 'CNY', order.channel,
    ])
    const snapshotResult = await this.client.query(PUT_ENTITLEMENT, [userId, JSON.stringify(entitlementPayload)])
    return {
      subscription: subscriptionResult.rows[0] || null,
      order: orderResult.rows[0] || null,
      version: snapshotResult.rows[0] ? Number(snapshotResult.rows[0].version) : null,
      periodStart: base.toISOString(),
      periodEnd: periodEnd.toISOString(),
    }
  }

  async createNotification({ id, userId, title, body = '', level = 'info' }) {
    const result = await this.client.query(
      `INSERT INTO identity_notifications (id, user_id, title, body, level)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, userId, title, body, level],
    )
    return result.rows[0] || null
  }

  async putEntitlement(userId, payload) {
    const result = await this.client.query(PUT_ENTITLEMENT, [userId, JSON.stringify(payload)])
    return result.rows[0] ? Number(result.rows[0].version) : null
  }
}
```

在 `PostgresIdentityRepository` 类内（`transaction` 方法之后、`close` 之前）新增池级方法：

```js
  // ——— 会员中心 P1 商务读写 ———

  async getActiveSubscription(userId) {
    const result = await this.pool.query(
      `SELECT * FROM identity_subscriptions WHERE user_id = $1 AND status = 'active'
       ORDER BY current_period_end DESC LIMIT 1`,
      [userId],
    )
    return result.rows[0] || null
  }

  /** 到期惰性降级：仅当存在已过期 active 订阅时置为 expired 并返回该行（与事务版共用 EXPIRE_SUBSCRIPTION）。 */
  async expireSubscription(userId) {
    const result = await this.pool.query(EXPIRE_SUBSCRIPTION, [userId])
    return result.rows[0] || null
  }

  async putEntitlement(userId, payload) {
    const result = await this.pool.query(PUT_ENTITLEMENT, [userId, JSON.stringify(payload)])
    return result.rows[0] ? Number(result.rows[0].version) : null
  }

  async getUsageSummary(userId, at = new Date()) {
    const result = await this.pool.query(
      `SELECT feature, used, quota_limit, period_start, period_end FROM identity_entitlement_usage
       WHERE user_id = $1 AND period_start <= $2 AND period_end > $2`,
      [userId, at.toISOString()],
    )
    return result.rows || []
  }

  async listOrders(userId, { limit = 20, offset = 0 } = {}) {
    const result = await this.pool.query(
      `SELECT * FROM identity_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    )
    return result.rows || []
  }

  async createRedeemCodes(records) {
    if (!Array.isArray(records) || records.length === 0) return []
    const result = await this.pool.query(
      `INSERT INTO identity_redeem_codes (code, plan, duration_days, batch, expires_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::timestamptz[])
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [
        records.map((r) => r.code),
        records.map((r) => r.plan),
        records.map((r) => r.durationDays),
        records.map((r) => r.batch),
        records.map((r) => (r.expiresAt ? new Date(r.expiresAt).toISOString() : null)),
      ],
    )
    return (result.rows || []).map((row) => row.code)
  }

  async listNotifications(userId, { limit = 20, offset = 0 } = {}) {
    const result = await this.pool.query(
      `SELECT * FROM identity_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    )
    return result.rows || []
  }

  async countUnreadNotifications(userId) {
    const result = await this.pool.query(
      'SELECT COUNT(*)::int AS count FROM identity_notifications WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    )
    return Number(result.rows[0] ? result.rows[0].count : 0)
  }

  async markNotificationsRead(userId) {
    const result = await this.pool.query(
      'UPDATE identity_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL RETURNING id',
      [userId],
    )
    return (result.rows || []).map((row) => row.id)
  }

  async createNotification({ id, userId, title, body = '', level = 'info' }) {
    const result = await this.pool.query(
      `INSERT INTO identity_notifications (id, user_id, title, body, level)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, userId, title, body, level],
    )
    return result.rows[0] || null
  }

  /** 广播通知 fan-out：每用户一行，已读状态独立（spec §3.5）。 */
  async broadcastNotification(userIds, { title, body = '', level = 'info' }) {
    if (!Array.isArray(userIds) || userIds.length === 0) return 0
    const result = await this.pool.query(
      `INSERT INTO identity_notifications (id, user_id, title, body, level)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
       RETURNING id`,
      [
        userIds.map(() => crypto.randomUUID()),
        userIds,
        userIds.map(() => title),
        userIds.map(() => body),
        userIds.map(() => level),
      ],
    )
    return (result.rows || []).length
  }

  async upsertSession({ userId, deviceId, deviceName = null }) {
    if (typeof deviceId !== 'string' || !deviceId) throw new TypeError('deviceId is required')
    const id = sessionRecordId(userId, deviceId)
    const result = await this.pool.query(UPSERT_SESSION, [id, userId, deviceId, deviceName])
    return result.rows[0] || { id, user_id: userId, device_id: deviceId, device_name: deviceName, revoked_at: null }
  }

  async listActiveSessions(userId) {
    const result = await this.pool.query(
      `SELECT id, device_id, device_name, created_at, last_seen_at FROM identity_user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC NULLS LAST`,
      [userId],
    )
    return result.rows || []
  }

  async revokeOtherSessions(userId, keepDeviceId) {
    const result = await this.pool.query(
      `UPDATE identity_user_sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL AND device_id IS DISTINCT FROM $2 RETURNING id`,
      [userId, keepDeviceId],
    )
    return (result.rows || []).map((row) => row.id)
  }

  async commerceTransaction(callback) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await callback(new PostgresCommerceTransaction(client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
```

`module.exports` 补 `PostgresCommerceTransaction`：

```js
module.exports = {
  PostgresEntitlementProvider,
  PostgresIdentityRepository,
  PostgresWebhookTransaction,
  PostgresCommerceTransaction,
  REQUIRED_SCHEMA_RELATIONS,
  SCHEMA,
  DEFAULT_MIGRATION_DIRECTORY,
}
```

- [ ] **Step 4: 运行确认通过**

Run：
```powershell
node packages/api-publish-engine/test/member-commerce-repository.test.js
node packages/api-publish-engine/test/member-commerce-migrations.test.js
node packages/api-publish-engine/test/postgres-identity-repository.test.js
```
Expected: 三个 exit 0

- [ ] **Step 5: Commit**

```powershell
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 add packages/api-publish-engine/src/auth/postgres-identity-repository.js packages/api-publish-engine/test/member-commerce-repository.test.js
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 commit -m "feat(member-center): P1-T3 仓储商务读写（订阅续叠/兑换码/通知/会话）"
```

---

## Task 4：订阅服务 subscription-service.js（核销/开通/到期降级编排）

**Files:**
- Create: `packages/api-publish-engine/src/auth/subscription-service.js`
- Test: `packages/api-publish-engine/test/subscription-service.test.js`

职责边界：服务层只做状态机校验与编排，所有多表写入一律走 `repository.commerceTransaction`（Task 3）；单表读直接调仓储方法。错误统一抛 `CommerceError { code, status }`，由 Task 6 路由层直接映射 HTTP 状态码。

- [ ] **Step 1: 写失败测试**

创建 `packages/api-publish-engine/test/subscription-service.test.js`：

```js
const assert = require('assert')
const test = require('node:test')

const { SubscriptionService, generateRedeemCode, REDEEM_CODE_PATTERN } = require('../src/auth/subscription-service')

function createRepositoryFixture(initial = {}) {
  const repo = {
    codes: new Map((initial.codes || []).map((c) => [c.code, { status: 'active', used_by: null, expires_at: null, duration_days: 30, plan: 'standard', ...c }])),
    orders: [],
    notifications: [],
    subscriptionWrites: [],
    entitlementWrites: [],
    current: initial.current || null,
    expiryResult: initial.expiryResult || null,
    usage: initial.usage || [],
    txCalls: [],
    async commerceTransaction(callback) {
      const self = this
      return callback({
        async lockRedeemCode(code) { return self.codes.get(code) || null },
        async expireSubscription(userId) {
          self.txCalls.push('expireSubscription')
          return self.expiryResult
        },
        async putEntitlement(userId, payload) {
          self.txCalls.push('putEntitlement')
          self.entitlementWrites.push({ userId, payload })
          return self.entitlementWrites.length
        },
        async markRedeemCodeUsed(code, userId) {
          const row = self.codes.get(code)
          if (!row || row.status !== 'active') {
            throw Object.assign(new Error('REDEEM_CODE_RACE'), { code: 'REDEEM_CODE_RACE', status: 409 })
          }
          row.status = 'used'
          row.used_by = userId
          row.used_at = new Date().toISOString()
          return row
        },
        async applySubscription(args) {
          self.subscriptionWrites.push(args)
          self.orders.push(args.order)
          return {
            subscription: { id: `sub-${args.userId}`, plan: args.plan },
            order: args.order,
            version: self.entitlementWrites.length + 1,
            periodStart: 'ps', periodEnd: 'pe',
          }
        },
        async createNotification(record) { self.txCalls.push('createNotification'); self.notifications.push(record) },
      })
    },
    async expireSubscription() { return this.expiryResult },
    async putEntitlement(userId, payload) { this.entitlementWrites.push({ userId, payload }) },
    async getActiveSubscription() { return this.current },
    async getUsageSummary() { return this.usage },
    async createNotification(record) { this.notifications.push(record) },
    async createRedeemCodes(records) {
      for (const record of records) this.codes.set(record.code, { ...record, status: 'active', used_by: null })
      return records.map((record) => record.code)
    },
  }
  return repo
}

function createService(initial = {}, options = {}) {
  const repository = createRepositoryFixture(initial)
  const service = new SubscriptionService({ repository, now: () => new Date('2026-09-23T00:00:00Z'), ...options })
  return { service, repository }
}

test('generateRedeemCode', async (t) => {
  await t.test('格式 4-4-4 且字母表排除混淆字符', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRedeemCode()
      assert.match(code, REDEEM_CODE_PATTERN)
      assert.ok(!/[IO01]/.test(code), `不应含易混淆字符: ${code}`)
    }
  })
})

test('redeem 兑换码核销状态机', async (t) => {
  await t.test('成功核销：三连写 + 标记已用 + 通知', async () => {
    const { service, repository } = createService({ codes: [{ code: 'ABCD-EFGH-JKMN', plan: 'pro', duration_days: 30 }] })
    const result = await service.redeem({ userId: 'u-1', code: 'abcd-efgh-jkmn' }) // 小写归一
    assert.strictEqual(result.plan, 'pro')
    assert.strictEqual(repository.subscriptionWrites[0].plan, 'pro')
    assert.strictEqual(repository.subscriptionWrites[0].durationDays, 30)
    assert.strictEqual(repository.orders[0].channel, 'redeem')
    assert.strictEqual(repository.codes.get('ABCD-EFGH-JKMN').status, 'used')
    assert.strictEqual(repository.notifications.length, 1)
  })

  await t.test('非法格式 400 REDEEM_CODE_FORMAT（不碰数据库）', async () => {
    const { service, repository } = createService()
    for (const bad of ['abc', '', 'AAAA-BBBB', 'IIII-OOOO-0000', 'AAAA-BBBB-CCCC-DDDD']) {
      await assert.rejects(service.redeem({ userId: 'u-1', code: bad }), (err) => err.code === 'REDEEM_CODE_FORMAT' && err.status === 400)
    }
    assert.strictEqual(repository.subscriptionWrites.length, 0)
  })

  await t.test('不存在 404 / 他人已用 409 / 停用 409 / 过期 410', async () => {
    const cases = [
      { codes: [], code: 'ABCD-EFGH-JKMN', expectCode: 'REDEEM_CODE_NOT_FOUND', status: 404 },
      { codes: [{ code: 'ABCD-EFGH-JKMN', status: 'used', used_by: 'u-2' }], code: 'ABCD-EFGH-JKMN', expectCode: 'REDEEM_CODE_USED', status: 409 },
      { codes: [{ code: 'ABCD-EFGH-JKMN', status: 'disabled' }], code: 'ABCD-EFGH-JKMN', expectCode: 'REDEEM_CODE_DISABLED', status: 409 },
      { codes: [{ code: 'ABCD-EFGH-JKMN', expires_at: '2020-01-01T00:00:00Z' }], code: 'ABCD-EFGH-JKMN', expectCode: 'REDEEM_CODE_EXPIRED', status: 410 },
    ]
    for (const item of cases) {
      const { service } = createService({ codes: item.codes })
      await assert.rejects(service.redeem({ userId: 'u-1', code: item.code }), (err) => err.code === item.expectCode && err.status === item.status)
    }
  })

  await t.test('本人重复提交幂等：不重复记账', async () => {
    const { service, repository } = createService({ codes: [{ code: 'ABCD-EFGH-JKMN', status: 'used', used_by: 'u-1', used_at: '2026-09-22T00:00:00Z' }] })
    const result = await service.redeem({ userId: 'u-1', code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(result.idempotent, true)
    assert.strictEqual(result.plan, 'standard')
    assert.strictEqual(repository.subscriptionWrites.length, 0)
    assert.strictEqual(repository.orders.length, 0)
  })
})

test('grant / createRedeemBatch / settleExpiry / 视图', async (t) => {
  await t.test('grant：free/未知档位 PLAN_INVALID，时长非正整数 DURATION_INVALID', async () => {
    const { service } = createService()
    await assert.rejects(service.grant({ userId: 'u-1', plan: 'free', durationDays: 30 }), (err) => err.code === 'PLAN_INVALID')
    await assert.rejects(service.grant({ userId: 'u-1', plan: 'gold', durationDays: 30 }), (err) => err.code === 'PLAN_INVALID')
    await assert.rejects(service.grant({ userId: 'u-1', plan: 'standard', durationDays: 0 }), (err) => err.code === 'DURATION_INVALID')
    await assert.rejects(service.grant({ userId: 'u-1', plan: 'standard', durationDays: 1.5 }), (err) => err.code === 'DURATION_INVALID')
  })

  await t.test('grant 成功：channel admin_grant，providerReference 透传', async () => {
    const { service, repository } = createService()
    const result = await service.grant({ userId: 'u-1', plan: 'standard', durationDays: 30, providerReference: 'ops:admin-9' })
    assert.strictEqual(result.order.channel, 'admin_grant')
    assert.strictEqual(repository.subscriptionWrites[0].order.providerReference, 'ops:admin-9')
    assert.strictEqual(repository.notifications.length, 1)
  })

  await t.test('createRedeemBatch：数量上限 1-500，生成码唯一且入库', async () => {
    const { service, repository } = createService()
    await assert.rejects(service.createRedeemBatch({ plan: 'standard', durationDays: 30, count: 0 }), (err) => err.code === 'BATCH_COUNT_INVALID')
    await assert.rejects(service.createRedeemBatch({ plan: 'standard', durationDays: 30, count: 501 }), (err) => err.code === 'BATCH_COUNT_INVALID')
    const batch = await service.createRedeemBatch({ plan: 'pro', durationDays: 365, count: 5, batch: 'b1' })
    assert.strictEqual(batch.codes.length, 5)
    assert.strictEqual(new Set(batch.codes).size, 5)
    assert.strictEqual(repository.codes.size, 5)
    assert.strictEqual(repository.codes.get(batch.codes[0]).plan, 'pro')
    assert.strictEqual(repository.codes.get(batch.codes[0]).durationDays, 365)
  })

  await t.test('settleExpiry：有降级行→回写 free 快照+通知；无→null；三写必在同一事务', async () => {
    const withExpiry = createService({ expiryResult: { id: 'sub-u-1', plan: 'standard', status: 'expired' } })
    const settled = await withExpiry.service.settleExpiry('u-1')
    assert.ok(settled)
    assert.strictEqual(withExpiry.repository.entitlementWrites[0].payload.plan, 'free')
    assert.strictEqual(withExpiry.repository.notifications.length, 1)
    // 回归保护（CCG C3）：若退回「非事务 + 先 expire 后写快照」，中途失败会永久泄漏 pro 权益
    assert.deepStrictEqual(withExpiry.repository.txCalls,
      ['expireSubscription', 'putEntitlement', 'createNotification'])
    const clean = createService()
    assert.strictEqual(await clean.service.settleExpiry('u-1'), null)
    assert.strictEqual(clean.repository.entitlementWrites.length, 0)
  })

  await t.test('grant 默认 providerReference 逐次唯一（否则撞 UNIQUE 回滚整事务）', async () => {
    const { service, repository } = createService()
    const first = await service.grant({ userId: 'u-1', plan: 'standard', durationDays: 30 })
    await service.grant({ userId: 'u-2', plan: 'pro', durationDays: 30 })
    const refs = repository.subscriptionWrites.map((w) => w.order.providerReference)
    assert.strictEqual(new Set(refs).size, 2, `providerReference 必须全局唯一：${refs.join(', ')}`)
    assert.match(first.order.providerReference, /^grant:system:ord-/)
  })

  await t.test('getSubscriptionView：无订阅回 free，有订阅回当期档位', async () => {
    const empty = createService()
    assert.strictEqual((await empty.service.getSubscriptionView('u-1')).plan, 'free')
    const paid = createService({ current: { id: 'sub-u-1', plan: 'pro', status: 'active', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z' } })
    const view = await paid.service.getSubscriptionView('u-1')
    assert.strictEqual(view.plan, 'pro')
    assert.strictEqual(view.periodEnd, '2026-10-01T00:00:00Z')
    assert.strictEqual(view.entitlement.limits.concurrent_tasks, 10)
  })

  await t.test('getUsageView：无记录 feature 也回 used=0 + 矩阵上限', async () => {
    const { service } = createService({
      current: { id: 'sub-u-1', plan: 'standard', status: 'active', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z' },
      usage: [{ feature: 'cloud_publish', used: 12, quota_limit: 1500, period_start: '2026-09-01T00:00:00Z', period_end: '2026-10-01T00:00:00Z' }],
    })
    const usageView = await service.getUsageView('u-1')
    const publish = usageView.features.find((item) => item.feature === 'cloud_publish')
    assert.strictEqual(publish.used, 12)
    assert.strictEqual(publish.limit, 1500)
    const video = usageView.features.find((item) => item.feature === 'video_create')
    assert.strictEqual(video.used, 0)
    assert.strictEqual(video.limit, 500)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/api-publish-engine/test/subscription-service.test.js`
Expected: FAIL — `Cannot find module '../src/auth/subscription-service'`

- [ ] **Step 3: 实现 subscription-service.js**

创建 `packages/api-publish-engine/src/auth/subscription-service.js`：

```js
'use strict'

/**
 * 会员中心 · 订阅服务：兑换码核销 / 后台开通 / 到期惰性降级 / 视图组装。
 * 真源：01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md §3.1/§3.3/§3.5。
 * 多表写入一律走 repository.commerceTransaction；错误统一 CommerceError{code,status} 由路由层映射 HTTP。
 */

const crypto = require('crypto')
const { PLAN_IDS, getPlanEntitlement } = require('./plan-matrix')

// 排除易混淆字符 I/O/0/1；格式 4-4-4（与 LicenseManager.activate 的输入习惯兼容）。
const REDEEM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const REDEEM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/

class CommerceError extends Error {
  constructor(message, code, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

function generateRedeemCode() {
  const pick = () => Array.from(
    { length: 4 },
    () => REDEEM_CODE_ALPHABET[crypto.randomInt(REDEEM_CODE_ALPHABET.length)],
  ).join('')
  return `${pick()}-${pick()}-${pick()}`
}

class SubscriptionService {
  constructor(options = {}) {
    if (!options.repository) throw new TypeError('repository is required')
    this.repository = options.repository
    this.now = typeof options.now === 'function' ? options.now : () => new Date()
    this.planOverrides = options.planOverrides || null
  }

  entitlementPayload(plan) {
    // deepFreeze 后需脱壳才能安进 JSONB 参数/测试 fixture
    return JSON.parse(JSON.stringify(getPlanEntitlement(plan, this.planOverrides)))
  }

  /**
   * 到期惰性降级：仅在存在过期 active 订阅时降级回 free（无定时任务，/me 访问触发）。
   * 三个写必须在同一事务：若先置 expired 再写快照（非事务），中途失败会留下
   * 「订阅已 expired + 快照仍为 pro」的永久权限泄漏（expired 行下次不再命中，无重试路径）。
   */
  async settleExpiry(userId) {
    return this.repository.commerceTransaction(async (tx) => {
      const expired = await tx.expireSubscription(userId)
      if (!expired) return null
      await tx.putEntitlement(userId, this.entitlementPayload('free'))
      await tx.createNotification({
        id: crypto.randomUUID(),
        userId,
        title: '会员已到期',
        body: '本期订阅已结束，档位已回到免费版；兑换新码可续叠。',
        level: 'warn',
      })
      return expired
    })
  }

  async getSubscriptionView(userId) {
    await this.settleExpiry(userId)
    const subscription = await this.repository.getActiveSubscription(userId)
    const plan = subscription ? subscription.plan : 'free'
    return {
      plan,
      status: subscription ? subscription.status : 'free',
      periodStart: subscription ? subscription.current_period_start : null,
      periodEnd: subscription ? subscription.current_period_end : null,
      entitlement: this.entitlementPayload(plan),
    }
  }

  /** 用量视图：矩阵上限 + 当期用量（无记录也回 used=0，前端进度条不需再判空）。 */
  async getUsageView(userId) {
    const subscription = await this.repository.getActiveSubscription(userId)
    const plan = subscription ? subscription.plan : 'free'
    const entitlement = getPlanEntitlement(plan, this.planOverrides)
    const rows = await this.repository.getUsageSummary(userId, this.now())
    const byFeature = new Map(rows.map((row) => [row.feature, row]))
    const features = Object.keys(entitlement.quota).map((quotaKey) => {
      const feature = quotaKey.replace(/_monthly$/, '')
      const row = byFeature.get(feature)
      return {
        feature,
        used: row ? Number(row.used) : 0,
        limit: Number(entitlement.quota[quotaKey]),
        periodStart: row ? row.period_start : null,
        periodEnd: row ? row.period_end : null,
      }
    })
    return { plan, features }
  }

  async requireUser(userId) {
    if (typeof userId !== 'string' || !userId) {
      throw new CommerceError('需要登录态', 'BUSINESS_USER_REQUIRED', 503)
    }
  }

  /** 兑换码核销：行锁 + 条件更新双保险幂等；本人重放不重复记账。 */
  async redeem({ userId, code }) {
    await this.requireUser(userId)
    const normalized = typeof code === 'string' ? code.trim().toUpperCase() : ''
    if (!REDEEM_CODE_PATTERN.test(normalized)) {
      throw new CommerceError('兑换码格式不正确（形如 ABCD-EFGH-JKMN）', 'REDEEM_CODE_FORMAT', 400)
    }
    return this.repository.commerceTransaction(async (tx) => {
      const row = await tx.lockRedeemCode(normalized)
      if (!row) throw new CommerceError('兑换码不存在', 'REDEEM_CODE_NOT_FOUND', 404)
      if (row.status === 'used') {
        if (row.used_by === userId) {
          return { idempotent: true, code: normalized, plan: row.plan, redeemedAt: row.used_at }
        }
        throw new CommerceError('兑换码已被使用', 'REDEEM_CODE_USED', 409)
      }
      if (row.status !== 'active') throw new CommerceError('兑换码已停用', 'REDEEM_CODE_DISABLED', 409)
      if (row.expires_at && new Date(row.expires_at) <= this.now()) {
        throw new CommerceError('兑换码已过有效期', 'REDEEM_CODE_EXPIRED', 410)
      }
      const applied = await tx.applySubscription({
        userId,
        plan: row.plan,
        durationDays: row.duration_days,
        now: this.now(),
        order: {
          id: `ord-${crypto.randomUUID()}`,
          amount: 0,
          currency: 'CNY',
          channel: 'redeem',
          providerReference: `redeem:${normalized}`,
        },
        entitlementPayload: this.entitlementPayload(row.plan),
      })
      await tx.markRedeemCodeUsed(normalized, userId)
      await tx.createNotification({
        id: crypto.randomUUID(),
        userId,
        title: '兑换成功',
        body: `已开通 ${row.plan}，有效期 ${row.duration_days} 天`,
        level: 'info',
      })
      return { idempotent: false, code: normalized, plan: row.plan, ...applied }
    })
  }

  /** 后台开通（ops-center，阶段 1 不走支付）：channel=admin_grant，金额 0。 */
  async grant({ userId, plan, durationDays, providerReference = null, operator = null }) {
    await this.requireUser(userId)
    if (!PLAN_IDS.includes(plan) || plan === 'free') {
      throw new CommerceError('仅支持开通付费档位', 'PLAN_INVALID', 400)
    }
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      throw new CommerceError('时长必须为正整数天', 'DURATION_INVALID', 400)
    }
    return this.repository.commerceTransaction(async (tx) => {
      // provider_reference 在 identity_subscriptions 上是 UNIQUE（002:29），默认值必须逐次唯一，
      // 否则同一 operator 连续给两个用户开通时第二个必然撞唯一约束导致整个事务回滚。
      const grantOrderId = `ord-${crypto.randomUUID()}`
      const applied = await tx.applySubscription({
        userId,
        plan,
        durationDays,
        now: this.now(),
        order: {
          id: grantOrderId,
          amount: 0,
          currency: 'CNY',
          channel: 'admin_grant',
          providerReference: providerReference || `grant:${operator || 'system'}:${grantOrderId}`,
        },
        entitlementPayload: this.entitlementPayload(plan),
      })
      await tx.createNotification({
        id: crypto.randomUUID(),
        userId,
        title: '会员开通',
        body: `已开通 ${plan}，有效期 ${durationDays} 天`,
        level: 'info',
      })
      return { plan, ...applied }
    })
  }

  /** 批量生成兑换码（运营入口）：上限 500/批，内存去重后批量入库。 */
  async createRedeemBatch({ plan, durationDays, count, batch = null, expiresAt = null }) {
    if (!PLAN_IDS.includes(plan) || plan === 'free') {
      throw new CommerceError('兑换码仅支持付费档位', 'PLAN_INVALID', 400)
    }
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      throw new CommerceError('时长必须为正整数天', 'DURATION_INVALID', 400)
    }
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new CommerceError('批量数量需在 1-500 之间', 'BATCH_COUNT_INVALID', 400)
    }
    const batchId = batch || `batch-${new Date(this.now()).toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`
    const codes = new Set()
    while (codes.size < count) codes.add(generateRedeemCode())
    const records = [...codes].map((code) => ({ code, plan, durationDays, batch: batchId, expiresAt }))
    const created = await this.repository.createRedeemCodes(records)
    return { batch: batchId, plan, durationDays, requested: count, codes: created }
  }
}

module.exports = { SubscriptionService, CommerceError, generateRedeemCode, REDEEM_CODE_PATTERN }
```

- [ ] **Step 4: 运行确认通过**

Run：
```powershell
node packages/api-publish-engine/test/subscription-service.test.js
node packages/api-publish-engine/test/plan-matrix.test.js
```
Expected: 两个 exit 0

- [ ] **Step 5: Commit**

```powershell
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 add packages/api-publish-engine/src/auth/subscription-service.js packages/api-publish-engine/test/subscription-service.test.js
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 commit -m "feat(member-center): P1-T4 订阅服务（核销幂等/后台开通/到期降级/视图）"
```

---

## Task 5：runtime 与 CLI 接线（subscriptionService 注入）

**Files:**
- Modify: `packages/api-publish-engine/src/auth/logto-runtime.js`（第 125 行 `entitlementProvider` 创建之后；返回对象 139-149 行）
- Modify: `packages/api-publish-engine/bin/publish-api`（第 101 行 `entitlementSigner` 注入行之后）
- Test: `packages/api-publish-engine/test/logto-runtime.test.js`（追加子测试）

- [ ] **Step 1: 写失败测试**

在 `packages/api-publish-engine/test/logto-runtime.test.js` 最后一个 `test(...)` 之前追加（沿用文件已有的 fake repository 模式）：

```js
test('createLogtoRuntime 组装 subscriptionService', async (t) => {
  await t.test('repository 就绪时返回 SubscriptionService 实例', async () => {
    const { createLogtoRuntime } = require('../src/auth/logto-runtime')
    const { SubscriptionService } = require('../src/auth/subscription-service')
    const fakeRepository = {
      // 非生产默认 autoMigrate=true（logto-runtime.js:107-118）会调用 initialize()，缺方法会先抛 TypeError
      async initialize() {},
      async assertReady() { return { database: 'ready', schema: 'ready' } },
      async close() {},
    }
    const runtime = await createLogtoRuntime({
      env: { IDENTITY_AUTH_ENABLED: 'true', LOGTO_ENDPOINT: 'https://auth.example.com', LOGTO_APP_ID: 'app' },
      repository: fakeRepository,
      verifier: { verify: async () => ({ subject: 's' }) },
    })
    assert.ok(runtime.subscriptionService instanceof SubscriptionService)
    assert.strictEqual(runtime.subscriptionService.repository, fakeRepository)
  })
})
```

注：若文件头部 require 尚无 `test`/`assert`，沿用存量引入（存量文件已引入 node:test 与 assert）；若 `createLogtoRuntime` 对 env 有必填校验（如 webhook/introspection），参照存量测试中最小配置场景补全 env 字段，断言目标不变。

- [ ] **Step 2: 运行确认失败**

Run: `node packages/api-publish-engine/test/logto-runtime.test.js`
Expected: FAIL — `runtime.subscriptionService` 为 undefined

- [ ] **Step 3: 接线实现**

修改 `packages/api-publish-engine/src/auth/logto-runtime.js`：

1. 文件头部 require 区追加：

```js
const { SubscriptionService } = require('./subscription-service')
```

2. 第 125 行 `const entitlementProvider = options.entitlementProvider || new PostgresEntitlementProvider(repository)` 之后追加：

```js
    const subscriptionService = new SubscriptionService({
      repository,
      planOverrides: options.planOverrides || null,
    })
```

3. 返回对象（139-149 行）在 `entitlementSigner,` 之后插入一行：

```js
      subscriptionService,
```

修改 `packages/api-publish-engine/bin/publish-api`：第 101 行 `entitlementSigner: identityRuntime && identityRuntime.entitlementSigner,` 之后插入：

```js
    subscriptionService: identityRuntime && identityRuntime.subscriptionService,
```

- [ ] **Step 4: 运行确认通过**

Run：
```powershell
node packages/api-publish-engine/test/logto-runtime.test.js
node scripts/run-tests.js
```
Expected: exit 0（全量无存量回归）

- [ ] **Step 5: Commit**

```powershell
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 add packages/api-publish-engine/src/auth/logto-runtime.js packages/api-publish-engine/bin/publish-api packages/api-publish-engine/test/logto-runtime.test.js
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 commit -m "feat(member-center): P1-T5 runtime/CLI 接线 subscriptionService"
```

---

## Task 6：HTTP 端点与 /me 会员聚合

**Files:**
- Modify: `packages/api-publish-engine/src/publish-api-server.js`（头部 require；构造器 100 行附近；`_requiredScope` 384-391；`_buildEntitlement` 540 行后；`/api/v1/me` 处理器 697-727；新路由插在 `/api/v1/me` 处理器之后）
- Test: `packages/api-publish-engine/test/member-commerce-api.test.js`

端点合同（scope 见括号）：
| 方`法` | 路径 | scope | 说明 |
|---|---|---|---|
| GET | `/api/v1/plans` | profile:read | 价目目录（矩阵+价格） |
| POST | `/api/v1/redeem` | profile:write | 兑换码核销 |
| GET | `/api/v1/me` | profile:read | 既有响应新增 `membership`（fail-soft） |
| GET | `/api/v1/me/orders` | profile:read | 订单列表 |
| GET | `/api/v1/me/notifications` | profile:read | 通知列表+未读数 |
| POST | `/api/v1/me/notifications/read` | profile:write | 全部标已读 |
| GET | `/api/v1/me/sessions` | profile:read | 活跃设备会话 |
| POST | `/api/v1/me/sessions/revoke-others` | profile:write | 下线其它设备（必须带合法 `X-Device-ID`，否则 400 DEVICE_ID_REQUIRED） |
| PATCH | `/api/v1/me/profile` | profile:write | 改 displayName/avatarUrl |
| POST | `/api/v1/admin/member/grant` | admin:users | 后台开通 |
| POST | `/api/v1/admin/member/redeem-codes` | admin:users | 批量生成兑换码 |

`CommerceError{code,status}` 由 `_commerceFailure` 直接映射 HTTP 状态码；`subscriptionService` 未配置时会员端点回 503 `SUBSCRIPTION_SERVICE_NOT_CONFIGURED`，`/me` 聚合缺失 `membership` 字段但主响应不变（fail-soft）。

注：admin grant 的 `userId` 不存在时由 `identity_subscriptions` 外键拦截，P1 接受 500（ops-center P4 从用户列表选择，不手输 id）；阶段 2 再补 `USER_NOT_FOUND` 预检。

- [ ] **Step 1: 写失败测试**

创建 `packages/api-publish-engine/test/member-commerce-api.test.js`（沿用 `publish-api-logto-auth.test.js` 的 `TestPublishApiServer` + 真实 HTTP 风格）：

```js
const assert = require('assert')
const http = require('http')
const { TestPublishApiServer: PublishApiServer } = require('./test-publish-api-server')

function request(port, method, path, token, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method, path,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }) }
        catch (error) { reject(new Error(`响应非 JSON (${res.statusCode}): ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function createRepositoryStub() {
  return {
    calls: [],
    async findBySubject(provider, subject) {
      return { id: 'business-user-1', auth_provider: provider, auth_subject: subject, status: 'active', display_name: '用户甲' }
    },
    async create() { throw new Error('存量测试不应创建用户') },
    async countUnreadNotifications(userId) { this.calls.push(['countUnread', userId]); return 2 },
    async listOrders(userId, options) { this.calls.push(['listOrders', userId, options]); return [{ id: 'ord-1', plan: 'pro', amount: 0, channel: 'redeem', status: 'paid' }] },
    async listNotifications(userId, options) { this.calls.push(['listNotifications', userId, options]); return [{ id: 'ntf-1', title: '公告', read_at: null }] },
    async markNotificationsRead(userId) { this.calls.push(['markRead', userId]); return ['ntf-1'] },
    async listActiveSessions(userId) { this.calls.push(['listSessions', userId]); return [{ id: 'ses-x', device_id: 'device-a' }] },
    async upsertSession(record) { this.calls.push(['upsertSession', record]); return { id: 'ses-x', ...record } },
    async revokeOtherSessions(userId, keepDeviceId) { this.calls.push(['revokeOthers', userId, keepDeviceId]); return ['ses-old'] },
    async updateProfile(id, patch) { this.calls.push(['updateProfile', id, patch]); return { id, display_name: patch.display_name, avatar_url: patch.avatar_url } },
  }
}

function createServiceStub(overrides = {}) {
  const repository = createRepositoryStub()
  return {
    repository,
    planOverrides: null,
    async getSubscriptionView(userId) {
      if (overrides.subscriptionFails) throw new Error('会员视图不可用')
      return { plan: 'standard', status: 'active', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', entitlement: { plan: 'standard', features: ['cloud_publish'], quota: {}, limits: {} } }
    },
    async getUsageView() { return { plan: 'standard', features: [{ feature: 'cloud_publish', used: 1, limit: 1500 }] } },
    async redeem({ userId, code }) {
      if (overrides.redeemNotFound) throw Object.assign(new Error('不存在'), { code: 'REDEEM_CODE_NOT_FOUND', status: 404 })
      return { idempotent: false, code: 'ABCD-EFGH-JKMN', plan: 'pro' }
    },
    async grant({ userId, plan }) {
      if (overrides.grantInvalid) throw Object.assign(new Error('档位'), { code: 'PLAN_INVALID', status: 400 })
      return { plan, order: { id: 'ord-admin', channel: 'admin_grant' } }
    },
    async createRedeemBatch({ count }) { return { batch: 'b1', codes: ['ABCD-EFGH-JKMN'] } },
  }
}

function createVerifier() {
  return {
    verify: async (token) => {
      if (token === 'member-read') return { subject: 'sub-me', scopes: ['profile:read'] }
      if (token === 'member-write') return { subject: 'sub-me', scopes: ['profile:read', 'profile:write'] }
      if (token === 'admin-token') return { subject: 'sub-admin', scopes: ['admin:users'] }
      if (token === 'publish-token') return { subject: 'sub-me', scopes: ['publish:read', 'publish:submit'] }
      throw Object.assign(new Error('AUTH_TOKEN_INVALID'), { code: 'AUTH_TOKEN_INVALID', status: 401 })
    },
  }
}

async function main() {
  // 场景 1：完整会员链路
  const service = createServiceStub()
  const server = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createRepositoryStub(),
    entitlementProvider: {
      async getForUser() { return { plan: 'standard', features: ['cloud_publish'], quota: { cloud_publish_monthly: 1500 }, limits: { daily_publish: 50 } } },
    },
    subscriptionService: service,
  })
  await server.start(0)
  const port = server._server.address().port
  try {
    const plans = await request(port, 'GET', '/api/v1/plans', 'member-read')
    assert.strictEqual(plans.status, 200)
    assert.strictEqual(plans.body.plans.length, 3)
    assert.strictEqual(plans.body.plans[1].priceMonthlyCents, 2900)
    console.log('  ✅ GET /api/v1/plans 价目目录')

    const me = await request(port, 'GET', '/api/v1/me', 'member-read', null, { 'X-Device-ID': 'device-aaaaaaaaaaaa' })
    assert.strictEqual(me.status, 200)
    assert.strictEqual(me.body.membership.subscription.plan, 'standard')
    assert.strictEqual(me.body.membership.unreadNotifications, 2)
    assert.strictEqual(me.body.membership.usage.features[0].feature, 'cloud_publish')
    assert.deepStrictEqual(me.body.entitlement.limits, { daily_publish: 50 }, 'limits 必须透传')
    assert.ok(service.repository.calls.some((call) => call[0] === 'upsertSession' && call[1].deviceId === 'device-aaaaaaaaaaaa'), '/me 应登记设备会话')
    console.log('  ✅ GET /api/v1/me 聚合 membership + 设备登记 + limits 透传')

    const meNoDevice = await request(port, 'GET', '/api/v1/me', 'member-read')
    assert.strictEqual(meNoDevice.status, 200, '缺 X-Device-ID 不影响 /me')
    console.log('  ✅ /me 无设备头不受影响')

    const orders = await request(port, 'GET', '/api/v1/me/orders', 'member-read')
    assert.strictEqual(orders.status, 200)
    assert.strictEqual(orders.body.orders[0].id, 'ord-1')
    const notifications = await request(port, 'GET', '/api/v1/me/notifications', 'member-read')
    assert.strictEqual(notifications.status, 200)
    assert.strictEqual(notifications.body.unreadCount, 2)
    const markRead = await request(port, 'POST', '/api/v1/me/notifications/read', 'member-write', {})
    assert.strictEqual(markRead.status, 200)
    assert.deepStrictEqual(markRead.body.ids, ['ntf-1'])
    const sessions = await request(port, 'GET', '/api/v1/me/sessions', 'member-read')
    assert.strictEqual(sessions.status, 200)
    assert.strictEqual(sessions.body.sessions[0].device_id, 'device-a')
    const revokeNoHeader = await request(port, 'POST', '/api/v1/me/sessions/revoke-others', 'member-write', { deviceId: 'x' })
    assert.strictEqual(revokeNoHeader.status, 400, 'revoke-others 只认 X-Device-ID，body.deviceId 不得作为保活依据')
    const revoke = await request(port, 'POST', '/api/v1/me/sessions/revoke-others', 'member-write', {}, { 'X-Device-ID': 'device-aaaaaaaaaaaa' })
    assert.strictEqual(revoke.status, 200)
    assert.deepStrictEqual(revoke.body.revoked, ['ses-old'])
    const profile = await request(port, 'PATCH', '/api/v1/me/profile', 'member-write', { displayName: '新名字' })
    assert.strictEqual(profile.status, 200)
    assert.strictEqual(profile.body.user.displayName, '新名字')
    const badAvatar = await request(port, 'PATCH', '/api/v1/me/profile', 'member-write', { avatarUrl: 'javascript:alert(1)' })
    assert.strictEqual(badAvatar.status, 400)
    assert.strictEqual(badAvatar.body.error, 'AVATAR_URL_INVALID')
    console.log('  ✅ orders/notifications/sessions/profile 会员端点')

    const readOnlyWrite = await request(port, 'PATCH', '/api/v1/me/profile', 'member-read', { displayName: 'x' })
    assert.strictEqual(readOnlyWrite.status, 403, 'profile:read 不能写资料')
    const redeemWithRead = await request(port, 'POST', '/api/v1/redeem', 'member-read', { code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(redeemWithRead.status, 403, '核销需要 profile:write')
    const publishScopeRejected = await request(port, 'GET', '/api/v1/plans', 'publish-token')
    assert.strictEqual(publishScopeRejected.status, 403, 'publish scope 不能读价目')
    console.log('  ✅ scope 边界（读/写/无关 scope 隔离）')

    const redeem = await request(port, 'POST', '/api/v1/redeem', 'member-write', { code: 'abcd-efgh-jkmn' })
    assert.strictEqual(redeem.status, 200)
    assert.strictEqual(redeem.body.plan, 'pro')
    console.log('  ✅ POST /api/v1/redeem 成功核销')

    const adminGrant = await request(port, 'POST', '/api/v1/admin/member/grant', 'admin-token', { userId: 'u-x', plan: 'standard', durationDays: 30 })
    assert.strictEqual(adminGrant.status, 200)
    assert.strictEqual(adminGrant.body.order.channel, 'admin_grant')
    const adminBatch = await request(port, 'POST', '/api/v1/admin/member/redeem-codes', 'admin-token', { plan: 'pro', durationDays: 365, count: 1 })
    assert.strictEqual(adminBatch.status, 200)
    assert.strictEqual(adminBatch.body.codes.length, 1)
    const memberAdminRejected = await request(port, 'POST', '/api/v1/admin/member/grant', 'member-write', { userId: 'u-x', plan: 'standard', durationDays: 30 })
    assert.strictEqual(memberAdminRejected.status, 403, '非 admin scope 不得开通')
    console.log('  ✅ admin 会员运营端点')

    // 存量回归：发布链路不受会员路由影响
    const publish = await request(port, 'POST', '/api/v1/publish', 'publish-token', { platform: 'zhihu', title: 'x' })
    assert.strictEqual(publish.status, 200)
    console.log('  ✅ 发布链路无回归')
  } finally {
    await server.stop()
  }

  // 场景 2：错误映射与 fail-soft
  const failServer = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createRepositoryStub(),
    entitlementProvider: { async getForUser() { return { plan: 'free', features: [] } } },
    subscriptionService: createServiceStub({ redeemNotFound: true, subscriptionFails: true }),
  })
  await failServer.start(0)
  const failPort = failServer._server.address().port
  try {
    const notFound = await request(failPort, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(notFound.status, 404)
    assert.strictEqual(notFound.body.error, 'REDEEM_CODE_NOT_FOUND')
    const meDegraded = await request(failPort, 'GET', '/api/v1/me', 'member-read')
    assert.strictEqual(meDegraded.status, 200, '会员聚合失败不得阻断 /me 主响应')
    assert.strictEqual(meDegraded.body.user.id, 'business-user-1')
    assert.strictEqual(meDegraded.body.membership, undefined)
    console.log('  ✅ CommerceError 状态码映射 + membership fail-soft')
  } finally {
    await failServer.stop()
  }

  // 场景 3：未配置商务服务的降级
  const bareServer = new PublishApiServer({
    dryRun: true,
    logtoVerifier: createVerifier(),
    businessIdentityRepository: createRepositoryStub(),
    entitlementProvider: { async getForUser() { return { plan: 'free', features: [] } } },
  })
  await bareServer.start(0)
  const barePort = bareServer._server.address().port
  try {
    const bareMe = await request(barePort, 'GET', '/api/v1/me', 'member-read')
    assert.strictEqual(bareMe.status, 200)
    assert.strictEqual(bareMe.body.membership, undefined)
    const barePlans = await request(barePort, 'GET', '/api/v1/plans', 'member-read')
    assert.strictEqual(barePlans.status, 200, 'plans 不依赖 subscriptionService')
    const bareRedeem = await request(barePort, 'POST', '/api/v1/redeem', 'member-write', { code: 'ABCD-EFGH-JKMN' })
    assert.strictEqual(bareRedeem.status, 503)
    assert.strictEqual(bareRedeem.body.error, 'SUBSCRIPTION_SERVICE_NOT_CONFIGURED')
    console.log('  ✅ 未配置商务服务的 503/降级合同')
  } finally {
    await bareServer.stop()
  }
  console.log('member-commerce-api: 全部通过')
}

main().catch((error) => { console.error(error); process.exit(1) })
```

- [ ] **Step 2: 运行确认失败**

Run: `node packages/api-publish-engine/test/member-commerce-api.test.js`
Expected: FAIL — `GET /api/v1/plans` 返回 404（路由不存在）或 403（scope 误匹配 publish:submit）

- [ ] **Step 3: 实现路由层**

修改 `packages/api-publish-engine/src/publish-api-server.js`，共 6 处：

**3a. 文件头部 require 区追加（与其他 auth require 同段）：**

```js
const { getPlanCatalog } = require("./auth/plan-matrix")
```

**3b. 构造器（100 行 `entitlementSigner` 之后）追加：**

```js
    this._subscriptionService = this._opts.subscriptionService || null
```

**3c. `_requiredScope`（384-391 行）整体替换（会员规则前置于 POST 兜底行，靠 early-return 避免 `/api/v1/plans` 被 `startsWith("/api/v1/plan")` 吞掉）：**

```js
  _requiredScope(req) {
    const url = requestPath(req)
    if (url === "/api/v1/health" || url === "/api/v1/ready") return null
    if (url === "/api/v1/me" || url === "/api/v1/plans") return "profile:read"
    if (url === "/api/v1/redeem") return "profile:write"
    if (url.indexOf("/api/v1/me/") === 0) {
      return req.method === "GET" || req.method === "HEAD" ? "profile:read" : "profile:write"
    }
    if (url.indexOf("/api/v1/admin/member/") === 0) return "admin:users"
    if (url.startsWith("/api/v1/keys") || url.startsWith("/api/v1/plugins") || url.startsWith("/api/v1/logs")) return "admin:users"
    if (req.method === "POST" || url.startsWith("/api/v1/schedule") || url.startsWith("/api/v1/plan")) return "publish:submit"
    return "publish:read"
  }
```

**3d. `_buildEntitlement`（540 行 quota 透传之后）补 limits 透传：**

```js
    if (entitlement.limits && typeof entitlement.limits === "object" && !Array.isArray(entitlement.limits)) response.limits = entitlement.limits
```

**3e. 辅助方法（插在 `_buildEntitlementSnapshot` 之后）：**

```js
  /** CommerceError{code,status} 直接映射 HTTP；>=500 记 error 日志，业务错误不污染 error 日志。 */
  _commerceFailure(req, res, error) {
    const status = error && Number.isInteger(error.status) ? error.status : 500
    const code = error && error.code ? error.code : "COMMERCE_INTERNAL_ERROR"
    if (status >= 500) this._logError(code, error, this._ctx(req))
    this._json(res, status, { error: code, message: status >= 500 ? "服务暂时不可用" : (error && error.message) || "请求未生效" })
  }

  _memberUserId(req) {
    const user = req.auth && req.auth.businessUser
    return user && typeof user.id === "string" ? user.id : null
  }

  /** X-Device-ID 合同与快照签发一致（^[A-Za-z0-9._:-]{16,128}$）；不合法返回 null 而非抛错（会话登记是尽力而为）。 */
  _deviceIdFrom(req) {
    const deviceId = req.headers && req.headers["x-device-id"]
    return typeof deviceId === "string" && /^[A-Za-z0-9._:-]{16,128}$/.test(deviceId) ? deviceId : null
  }

  _commerceRepository() {
    const repository = (this._subscriptionService && this._subscriptionService.repository) || this._businessIdentityRepository
    return repository && typeof repository.listOrders === "function" ? repository : null
  }
```

**3f. `/api/v1/me` 处理器改造（697-727 行）：** 在 `entitlementSnapshot` 赋值成功之后、`this._json(res, 200, {` 之前插入 membership 聚合：

```js
        let membership = null;
        try {
          if (this._subscriptionService) {
            const commerceRepository = this._commerceRepository();
            const [subscription, usage, unreadNotifications] = await Promise.all([
              this._subscriptionService.getSubscriptionView(businessUser.id),
              this._subscriptionService.getUsageView(businessUser.id),
              commerceRepository ? commerceRepository.countUnreadNotifications(businessUser.id) : Promise.resolve(0),
            ]);
            membership = { subscription, usage, unreadNotifications };
            const deviceId = this._deviceIdFrom(req);
            if (deviceId && commerceRepository && typeof commerceRepository.upsertSession === "function") {
              await commerceRepository.upsertSession({
                userId: businessUser.id,
                deviceId,
                deviceName: typeof req.headers["x-device-name"] === "string" ? req.headers["x-device-name"].slice(0, 100) : null,
              });
            }
          }
        } catch (error) {
          this._logError("MEMBERSHIP_UNAVAILABLE", error, this._ctx(req));
          membership = null;
        }
```

并把响应对象改为（增加最后一行）：

```js
        this._json(res, 200, {
          user: {
            id: businessUser.id,
            status: businessUser.status || "active",
            displayName: businessUser.display_name || null,
            avatarUrl: businessUser.avatar_url || null,
          },
          entitlement,
          ...(entitlementSnapshot ? { entitlementSnapshot } : {}),
          ...(membership ? { membership } : {}),
        });
```

**3g. 会员路由（插在 `/api/v1/me` 处理器的 `return; }` 之后、`--- Key Management ---` 之前）：**

```js
      // --- 会员中心 P1：目录 / 核销 / 订单 / 通知 / 会话 / 资料 / 运营入口 ---
      if (method === "GET" && url === "/api/v1/plans") {
        this._json(res, 200, { plans: getPlanCatalog((this._subscriptionService && this._subscriptionService.planOverrides) || null) });
        return;
      }

      if (method === "POST" && url === "/api/v1/redeem") {
        if (!this._subscriptionService) { this._json(res, 503, { error: "SUBSCRIPTION_SERVICE_NOT_CONFIGURED" }); return; }
        const userId = this._memberUserId(req);
        if (!userId) { this._json(res, 503, { error: "BUSINESS_USER_REPOSITORY_NOT_CONFIGURED" }); return; }
        var redeemBody = await this._parseBody(req);
        try {
          var redeemResult = await this._subscriptionService.redeem({ userId, code: redeemBody && redeemBody.code });
          this._json(res, 200, { success: true, ...redeemResult });
        } catch (error) { this._commerceFailure(req, res, error); }
        return;
      }

      if (url === "/api/v1/me/orders" || url === "/api/v1/me/notifications" || url === "/api/v1/me/notifications/read" ||
        url === "/api/v1/me/sessions" || url === "/api/v1/me/sessions/revoke-others" || url === "/api/v1/me/profile") {
        const commerceRepository = this._commerceRepository();
        if (!commerceRepository) { this._json(res, 503, { error: "BUSINESS_USER_REPOSITORY_NOT_CONFIGURED" }); return; }
        const userId = this._memberUserId(req);
        if (!userId) { this._json(res, 503, { error: "BUSINESS_USER_REPOSITORY_NOT_CONFIGURED" }); return; }
        try {
          if (method === "GET" && url === "/api/v1/me/orders") {
            this._json(res, 200, { orders: await commerceRepository.listOrders(userId, { limit: 50, offset: 0 }) });
            return;
          }
          if (method === "GET" && url === "/api/v1/me/notifications") {
            const [notifications, unreadCount] = await Promise.all([
              commerceRepository.listNotifications(userId, { limit: 50, offset: 0 }),
              commerceRepository.countUnreadNotifications(userId),
            ]);
            this._json(res, 200, { notifications, unreadCount });
            return;
          }
          if (method === "POST" && url === "/api/v1/me/notifications/read") {
            this._json(res, 200, { ids: await commerceRepository.markNotificationsRead(userId) });
            return;
          }
          if (method === "GET" && url === "/api/v1/me/sessions") {
            this._json(res, 200, { sessions: await commerceRepository.listActiveSessions(userId) });
            return;
          }
          if (method === "POST" && url === "/api/v1/me/sessions/revoke-others") {
            // 只认经正则校验的 X-Device-ID：若改用未校验的 body.deviceId，任意串都无匹配会话，
            // IS DISTINCT FROM 语义下会把当前会话一起下线（自断登录态）。
            const keepDeviceId = this._deviceIdFrom(req);
            if (!keepDeviceId) { this._json(res, 400, { error: "DEVICE_ID_REQUIRED" }); return; }
            this._json(res, 200, { revoked: await commerceRepository.revokeOtherSessions(userId, keepDeviceId) });
            return;
          }
          if ((method === "PATCH" || method === "PUT") && url === "/api/v1/me/profile") {
            var profileBody = await this._parseBody(req);
            var patch = {};
            if (profileBody && Object.prototype.hasOwnProperty.call(profileBody, "displayName")) {
              if (typeof profileBody.displayName !== "string" || !profileBody.displayName.trim()
                  || profileBody.displayName.length > 60
                  || /[\u0000-\u001f\u007f]/.test(profileBody.displayName)) {
                this._json(res, 400, { error: "DISPLAY_NAME_INVALID" }); return;
              }
              patch.display_name = profileBody.displayName.trim();
            }
            if (profileBody && Object.prototype.hasOwnProperty.call(profileBody, "avatarUrl")) {
              // 存储型 XSS 面：URL 字段必须限死 scheme，javascript: 与 data:text/html 一律 fail closed
              const avatar = profileBody.avatarUrl;
              const avatarOk = /^(https?:)?\/\/[^\s"'<>]+$/i.test(avatar)
                || /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(avatar);
              if (avatar !== null && (typeof avatar !== "string" || avatar.length > 500 || !avatarOk)) {
                this._json(res, 400, { error: "AVATAR_URL_INVALID" }); return;
              }
              patch.avatar_url = avatar;
            }
            if (!Object.keys(patch).length) { this._json(res, 400, { error: "PROFILE_PATCH_EMPTY" }); return; }
            const updated = await commerceRepository.updateProfile(userId, patch);
            if (!updated) { this._json(res, 503, { error: "PROFILE_UPDATE_UNAVAILABLE" }); return; }
            this._json(res, 200, { user: { id: updated.id, displayName: updated.display_name || null, avatarUrl: updated.avatar_url || null } });
            return;
          }
          this._json(res, 405, { error: "METHOD_NOT_ALLOWED" });
          return;
        } catch (error) { this._commerceFailure(req, res, error); return; }
      }

      if (url.indexOf("/api/v1/admin/member/") === 0) {
        if (!this._subscriptionService) { this._json(res, 503, { error: "SUBSCRIPTION_SERVICE_NOT_CONFIGURED" }); return; }
        try {
          if (method === "POST" && url === "/api/v1/admin/member/grant") {
            var grantBody = await this._parseBody(req);
            if (!grantBody || typeof grantBody.userId !== "string" || !grantBody.userId) { this._json(res, 400, { error: "USER_ID_REQUIRED" }); return; }
            var grantResult = await this._subscriptionService.grant({
              userId: grantBody.userId,
              plan: grantBody.plan,
              durationDays: grantBody.durationDays,
              providerReference: grantBody.providerReference || null,
              operator: grantBody.operator || null,
            });
            this._json(res, 200, { success: true, ...grantResult });
            return;
          }
          if (method === "POST" && url === "/api/v1/admin/member/redeem-codes") {
            var batchBody = await this._parseBody(req);
            var batchResult = await this._subscriptionService.createRedeemBatch({
              plan: batchBody && batchBody.plan,
              durationDays: batchBody && batchBody.durationDays,
              count: batchBody && batchBody.count,
              batch: batchBody && batchBody.batch || null,
              expiresAt: batchBody && batchBody.expiresAt || null,
            });
            this._json(res, 200, { success: true, ...batchResult });
            return;
          }
          this._json(res, 404, { error: "ROUTE_NOT_FOUND" });
          return;
        } catch (error) { this._commerceFailure(req, res, error); return; }
      }
```

**3h. 端点文档表（1069-1101 行附近）补录**：在既有端点清单追加上述 11 条路径与一句话说明（格式照旧），保持文档同步（QM-5）。

- [ ] **Step 4: 运行确认通过**

Run：
```powershell
node packages/api-publish-engine/test/member-commerce-api.test.js
node packages/api-publish-engine/test/publish-api-logto-auth.test.js
node scripts/run-tests.js
```
Expected: 全部 exit 0（存量 auth 测试验证 scope 改造无回归）

- [ ] **Step 5: Commit**

```powershell
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 add packages/api-publish-engine/src/publish-api-server.js packages/api-publish-engine/test/member-commerce-api.test.js
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 commit -m "feat(member-center): P1-T6 会员/商务 HTTP 端点与 /me 聚合"
```

---

## Task 7：全量回归与收尾

- [ ] **Step 1: 全包测试**

```powershell
cd D:\Data\projects\mp-worktrees\mp-member-center-p1
pnpm --filter @multi-publish/api-publish-engine test
```

Expected: exit 0（含 5 个新增测试文件与全部存量）

- [ ] **Step 2: 生产迁移演练（本地 Postgres 可用时执行，不可用则记录跳过原因待 CI/部署时补）**

```powershell
$env:BUSINESS_DATABASE_URL = 'postgres://postgres:***@localhost:5432/mp_member_p1'
node packages/api-publish-engine/scripts/migrate-postgres.js
node -e "const {PostgresIdentityRepository}=require('./packages/api-publish-engine/src/auth/postgres-identity-repository'); new PostgresIdentityRepository({connectionString: process.env.BUSINESS_DATABASE_URL, production: true}).assertReady().then(r=>console.log(r)).catch(e=>{console.error(e.code||e.message);process.exit(1)})"
```

Expected: 迁移 002-004 全部 applied（`migrations/postgresql/` 现存只有 002/003，本任务新增 004，不存在 001）；`assertReady` 返回 `{ database: 'ready', schema: 'ready' }`（fail closed：新表缺失/账本 checksum 不符必须报错）

- [ ] **Step 3: 质量门禁自检**

逐项过 `.quality-gates.md` 自检清单（开发阶段：测试全通过 / 错误处理到位 / 手动验证）；本包不改 `apps/desktop/electron/` 与 `packages/rpa-engine/`，QM-1 打包验证由 P2（桌面 IPC）任务承担。

- [ ] **Step 4: CHANGELOG + 最终提交**

`CHANGELOG.md` Unreleased 段追加：`会员中心 P1 服务端底座：三档权益矩阵、兑换码核销、订单、消息中心、设备会话与会员 API`。

```powershell
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 add CHANGELOG.md
git -C D:\Data\projects\mp-worktrees\mp-member-center-p1 commit -m "docs(member-center): P1-T7 CHANGELOG 收口"
```

---

## spec §8/§9 验收映射（P1 承担部分）

| spec 条目 | P1 任务 | 证据 |
|---|---|---|
| §8-2 兑换码/后台开通后套餐与配额刷新（服务端侧） | Task 4 redeem/grant + Task 3 `putEntitlement` version+1 回写快照 | `subscription-service.test.js`、`member-commerce-repository.test.js` |
| §8-3 三档矩阵数值一致（含直接调用回归） | Task 2 `plan-matrix.js` 唯一真源 + Task 6 `/api/v1/plans` | `plan-matrix.test.js` 逐字断言 |
| §8-4 设备列会话/注销；消息接收/已读（服务端侧） | Task 3 upsertSession/revoke + Task 6 sessions/notifications 端点 | `member-commerce-api.test.js` scope 边界断言 |
| §8-5 订单以服务端为准 | Task 1 `identity_orders` + Task 3 `listOrders` + Task 6 `/me/orders` | 同上 |
| §8-6 既有场景不回归 | Task 0 Step 3 基线 + Task 7 Step 1 全量 | run-tests 全绿 |
| §9 契约测试（/me 结构 + 矩阵断言） | Task 6 membership 聚合 + limits/quota 透传 | `member-commerce-api.test.js` 场景 1/2/3 |
| §9 兑换码幂等/重复/过期/跨账号 | Task 4 状态机（400/404/409/410 + 本人重放） | `subscription-service.test.js` |
| §9 订阅状态机（续叠/到期降级） | Task 3 `applySubscription` 续叠 + Task 4 `settleExpiry` | 两测试文件对应子用例 |
| §9 设备会话（当前会话保活） | Task 3 `IS DISTINCT FROM` 保活语义 | `member-commerce-repository.test.js` |
| §8-1（UI 7 栏）/ §8-2 客户端 30s 刷新与离线快照 / §9 前端与打包 | → P2（桌面 IPC/服务层）与 P3（会员中心前端） | 不在本计划范围 |
| §3.7 绑定手机/邮箱、修改密码 | → P2/P3：以 Logto Account Center（前端跳转/SDK）为真源，P1 只提供 `PATCH /api/v1/me/profile`（昵称/头像） | 本计划范围声明（D10） |
| ops-center 运营入口（§10 待办） | → P4；P1 仅提供 admin:* 端点 | 不在本计划范围 |

---

## 决策日志

| # | 决策 | 理由 | 被否方案 |
|---|---|---|---|
| D1 | 无限值统一用 -1；唯独 pro 日发布用有限高值 1000 | `consumeFeature` 校验 `limit >= 0`，被扣减的 feature（cloud_publish）不得出现 -1；spec 本身即「不限（默认上限 1000，运营可配）」 | 新增 unlimited 布尔字段（双真源，否） |
| D2 | 日发布→月配额采用 ×30 折算双口径（`quota.cloud_publish_monthly` 扣减，`limits.daily_publish` 展示） | 现有扣减只有 UTC 月周期一条路；日窗口拦截推 P2 增强 | 新建 daily 周期表（迁移面大，P1 不值） |
| D3 | 到期惰性降级（/me 访问触发 `settleExpiry`） | 无现成 cron/调度设施；惰性方案无后台任务也能保证最终一致 | 定时任务扫描（需新增调度依赖，否） |
| D4 | 会话确定性主键 `ses-sha256(userId:deviceId)`，重登复活 revoked 行 | 避免每次 /me 新插一行导致表无限膨胀；与登录页「本设备」识别稳定 | 每登一次新行（需 TTL 清理作业，否） |
| D5 | 广播通知 fan-out 每用户一行 | 已读状态 per-user 天然成立；表结构简单，量级（用户数 × 广播次数）P1 可接受 | 全局表+已读关联表（多一张表一次 join，否） |
| D6 | 兑换码字母表排除 I/O/0/1，4-4-4 分组 | 电话/人工录入场景防错；与存量 `LicenseManager.activate` 输入习惯兼容 | UUID 全字长（人工传播成本高，否） |
| D7 | 拆 4 份子计划（P1 服务端→P2 桌面→P3 前端→P4 运营），本轮只写 P1 | 用户确认；每份独立可交付可测试 | 单份大计划（跨 4 子系统，粒度失控，否） |
| D8 | 路由层不另建鉴权中间件，沿用 `_requiredScope` early-return 链 | 会员路径在 POST 兜底行之前 return，避免 `/plans` 被 `startsWith('/api/v1/plan')` 吞进 publish:submit | 新增 express 式中间件（与现有手写路由链不合，否） |
| D9 | 通知已读用 `read_at TIMESTAMPTZ`（非 spec 字面的 `read` 布尔） | `read_at IS NULL` = 未读，可带已读时间做审计；与 sessions `revoked_at` 风格一致 | 布尔列（丢时间信息，否）。P3 按 `readAt` 字段渲染，勿找 `read` |
| D10 | spec §3.7 的绑定手机/邮箱、修改密码不在 P1 做服务端端点 | 这三项的真源是 Logto，本项目已有 OIDC 登录链路；服务端自建改密/绑定会形成双真源 | 服务端代理 Logto Management API（需额外密钥与作用域，P1 不值）。延至 P2/P3 以 Account Center 跳转实现 |
| D11 | 到期降级只在 `/me` 路径触发（惰性 settle），且 `settleExpiry` 已改为单事务 | 发布扣减路径（`_consumeEntitlementFeature` → `getForUser` 读快照）不 settle，过期用户到下次 `/me` 前仍按旧快照扣减；桌面端启动即调 `/me`，窗口≈单次会话生命周期；P1 无支付回调也无定时设施 | 在发布热路径加 settle（每请求一次写查询 + 行锁，否）；阶段 2 上调度后改为对账作业 |
| D12 | `quota` 与 `limits` 双口径下发：`quota.*` 供服务端扣减，`limits.*` 供展示 | `consumeFeature` 只认 `${feature}_monthly`，日窗口/平台数无扣减源 | 只发 quota（前端无法渲染「日发布 50」类展示，否） |

---

## P2/P3 交接契约清单（本包下发但下游必须对齐的命名）

| 项 | P1 现状 | P2/P3 必须做的 | 来源 |
|---|---|---|---|
| feature 名 `video_create` / `schedule_batch` / `dashboard_full` | 服务端新造（spec §2 未给反引号名） | 与 `license-access-control.js` 现有枚举（cloud_publish/publish_history/pipeline_run）对齐，客户端 `features.includes()` 必须用同名 | CCG I3 |
| `membership.usage.features[].limit` 中的 `official_credit_monthly` | 无服务端扣减源，`used` 恒为 0 | 进度条标注「随官方积分能力开放」或隐藏，避免误读为已用 0/3000 | CCG I5 |
| `limits` 仅存在于在线 `entitlement` | `_buildEntitlementSnapshot`（RSA 离线快照）仍只带 plan/features/quota | 若要离线按平台数/并发门禁，需同步在快照体加 `limits` 并重签；否则离线宽限期只按 quota 判 | CCG I4 |
| `X-Device-ID` 必发头 | `/me` 无头不阻断，但 `revoke-others` **必须有合法头**（否则 400） | P2 桌面 IPC 统一注入 `X-Device-ID`（^[A-Za-z0-9._:-]{16,128}$），与快照签发同源 | CCG W1 |
| 通知字段 `readAt` | 用时间戳表达已读（D9） | P3 渲染勿找 spec 字面的 `read` 布尔 | CCG I1 |
| `/me` 写副作用 | 过期临界时会写快照+通知（非纯读） | 监控/审计勿将 `/me` 计入纯读延迟；读扩散优化时保留 settle | CCG I7 |
