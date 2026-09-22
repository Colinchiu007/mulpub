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

  await t.test('会话行以确定性 id 复用（同设备重登复活 revoked 行）', async () => {
    const calls = []
    const pool = { async query(text, values) { calls.push({ text, values }); return { rows: [] } } }
    const { PostgresIdentityRepository } = require('../src/auth/postgres-identity-repository')
    const repository = new PostgresIdentityRepository({ pool })
    const first = await repository.upsertSession({ userId: 'u-1', deviceId: 'device-a', deviceName: 'Win' })
    const second = await repository.upsertSession({ userId: 'u-1', deviceId: 'device-a', deviceName: 'Win2' })
    assert.strictEqual(first.id, second.id)
    const insert = calls[calls.length - 1]
    assert.match(insert.text, /ON CONFLICT \(id\) DO UPDATE SET revoked_at = NULL/)
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
