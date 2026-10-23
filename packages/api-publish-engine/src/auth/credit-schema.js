'use strict'
/**
 * 008 积分账户与不可变账本的开发态建表语句。
 *
 * 为什么单独成文件：本组语句直接追加进 `postgres-identity-repository.js` 的 `SCHEMA`
 * 会把那个文件从 428 行推过 500 行，顶破仓库 `filesOver500` 债务基线。
 * 抬高基线掩盖自己引入的债务是明确禁止的，所以按既有 `payment-schema.js` /
 * `postgres-commerce-store.js` 拆分先例单独立文件。
 *
 * **与 `migrations/postgresql/008_credit_ledger.sql` 的 DDL 必须逐字一致**（单向比对：
 * 迁移 → 本数组，忽略空白；口径同 004/005/006）。防漂移锁见
 * `test/credit-ledger-migrations.test.js` 的「008 迁移与开发态 SCHEMA 一致」。
 * 迁移侧的 SQL 注释**不镜像**进来 —— 比对口径只对迁移侧去注释，带入会造成永久假红。
 *
 * 语义边界（为什么与 identity_entitlement_usage 分表）：
 *   · identity_entitlement_usage = **次数配额**（能发几篇 / 生成几条视频），防刷用；
 *   · identity_credit_accounts/ledger = **积分余额**（官方算力花了多少钱），计费用。
 * 混在一张表会得到「发了 1600 积分，用户发 1600 篇就超限」这种荒谬语义。
 */

const CREDIT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS identity_credit_accounts (
    user_id        TEXT PRIMARY KEY REFERENCES identity_users(id) ON DELETE CASCADE,
    balance        INTEGER NOT NULL DEFAULT 0,
    granted_total  INTEGER NOT NULL DEFAULT 0,
    spent_total    INTEGER NOT NULL DEFAULT 0,
    period_start   TIMESTAMPTZ NOT NULL,
    period_end     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_identity_credit_balance_nonneg CHECK (balance >= 0),
    CONSTRAINT ck_identity_credit_granted_nonneg   CHECK (granted_total >= 0),
    CONSTRAINT ck_identity_credit_spent_nonneg     CHECK (spent_total >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS identity_credit_ledger (
    id             BIGSERIAL PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    entry_type     TEXT NOT NULL,
    amount         INTEGER NOT NULL,
    balance_after  INTEGER NOT NULL,
    reason         TEXT NOT NULL DEFAULT '',
    ref_type       TEXT NOT NULL DEFAULT '',
    ref_id         TEXT NOT NULL DEFAULT '',
    price_id       TEXT NOT NULL DEFAULT '',
    cost_cents     INTEGER NOT NULL DEFAULT 0,
    period_start   TIMESTAMPTZ NOT NULL,
    period_end     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_identity_credit_entry_type CHECK (
        entry_type IN ('grant', 'spend', 'refund', 'expire', 'adjust')
    ),
    CONSTRAINT ck_identity_credit_amount_positive CHECK (amount > 0),
    CONSTRAINT ck_identity_credit_cost_nonneg CHECK (cost_cents >= 0)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identity_credit_ledger_user_period
    ON identity_credit_ledger (user_id, period_start DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_credit_ledger_spend
    ON identity_credit_ledger (ref_type, ref_id)
    WHERE ref_type = 'usage_event' AND entry_type = 'spend'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_credit_ledger_grant
    ON identity_credit_ledger (ref_type, ref_id)
    WHERE entry_type = 'grant' AND ref_id <> ''`,
]

module.exports = { CREDIT_SCHEMA }
