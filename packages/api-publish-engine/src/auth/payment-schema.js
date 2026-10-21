'use strict'
/**
 * 006 微信 Native 支付（最小闭环）的开发态建表语句。
 *
 * 为什么单独成文件：本组语句直接追加进 `postgres-identity-repository.js` 的 `SCHEMA`
 * 会把那个文件从 473 行推到 522 行，顶破仓库 `filesOver500` 债务基线（实测 96 > baseline 95）。
 * 抬高基线掩盖自己引入的债务是明确禁止的，所以按既有 `postgres-commerce-store.js`
 * 拆分先例单独立文件。
 *
 * **与 `migrations/postgresql/006_payment_orders.sql` 的 DDL 必须逐字一致**（单向比对：
 * 迁移 → 本数组，忽略空白；口径同 004/005）。防漂移锁见
 * `test/member-commerce-migrations.test.js` 的「006 支付迁移与开发态 SCHEMA 一致」。
 * 迁移侧的 SQL 注释**不镜像**进来 —— 比对口径只对迁移侧去注释，带入会造成永久假红。
 */

const PAYMENT_SCHEMA = [
  // 订单：补支付供应商字段。全部可空 + 默认值向后兼容（阶段 1 兑换码/后台订单不受影响）。
  'ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS provider_order_id TEXT',
  'ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS provider_sub_id TEXT',
  // period 不设 CHECK 约束（与迁移一致）：避免既有行阻塞迁移，取值由服务层白名单校验（month | year）
  'ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS period TEXT',
  // discount_cents 本期恒 0（无 coupon）；列存在是为对账 schema 稳定，服务层不读
  'ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0',
  // 微信 webhook 回传 openid/transaction_id，没有我们的 user_id ⇒ 必须有映射表。
  // 唯一键 (provider, user_id)：provider_customer_id 可空时 PG 唯一约束不锁 NULL，反向唯一写了也锁不住。
  `CREATE TABLE IF NOT EXISTS identity_payment_customers (
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_customer_id TEXT,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT identity_payment_customers_unique UNIQUE (provider, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identity_payment_customers_user
    ON identity_payment_customers(user_id, provider)`,
]

module.exports = { PAYMENT_SCHEMA }
