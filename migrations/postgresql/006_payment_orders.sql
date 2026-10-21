-- 会员中心阶段 2 · 微信 Native 支付（最小闭环）
-- 真源：01-docs/PRD-WECHAT-PAY-INTEGRATION-2026-10-21.md §5
--      openspec/changes/wechat-native-payment/design.md §2
--
-- 本期范围（最小闭环）：一次性下单 → Native 扫码 → webhook 回调 → 复用 applySubscription 发放权益。
-- 不做自动续费 / 升降级 / 自助退款 / 试用 / 促销码 / 客户门户 / 多通道配置切换。
--
-- 两条复用既有地基的事实（本迁移因此是纯增量）：
--   ① identity_orders.channel 的 CHECK 约束在 004_member_commerce.sql:12 已含 'payment'
--      —— 阶段 1 就为第 ③ 条写入通道留好了取值，本迁移不改约束。
--   ② identity_webhook_events 已存在（阶段 1 为 Logto webhook 设计），本迁移复用为支付
--      outbox；auth_subject 语义放宽为「事件归属的业务主键」（支付事件填订单号），见 design.md §2.3。

BEGIN;

-- 订单：补支付供应商字段。全部可空 + 默认值向后兼容（阶段 1 兑换码/后台订单不受影响）。
-- period 不设 CHECK 约束：与上游 DESIGN-MEMBER-CENTER-P2-PAYMENT §4.1 一致，避免既有行阻塞
-- 迁移；取值由服务层白名单校验（month | year）。
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS provider_sub_id    TEXT;
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS period            TEXT;
-- discount_cents 本期恒 0（无 coupon 功能）。列的存在是为对账 schema 稳定，服务层不读。
ALTER TABLE identity_orders ADD COLUMN IF NOT EXISTS discount_cents    INTEGER NOT NULL DEFAULT 0;

-- 用户 ↔ 供应商客户映射：微信 webhook 回传 openid / transaction_id，**没有我们的 user_id**，
-- 必须有映射才能把回调落到正确用户。本期虽经 attach 字段回传 user_id 不依赖 openid 反查，
-- 但 openid 落库仍为对账与将来 JSAPI 接入留入口。
-- 唯一键取 (provider, user_id) 而非 (provider, provider_customer_id)：一个用户对微信只有一个
-- 映射；反向唯一会让「同 openid 绑两个 user」被 DB 拒绝（那是业务层该判的），且
-- provider_customer_id 可空时 PG 唯一约束不锁 NULL，写了也锁不住。
CREATE TABLE IF NOT EXISTS identity_payment_customers (
    user_id              TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    provider             TEXT NOT NULL,
    provider_customer_id TEXT,
    email                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT identity_payment_customers_unique UNIQUE (provider, user_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_payment_customers_user
    ON identity_payment_customers(user_id, provider);

COMMIT;
