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
