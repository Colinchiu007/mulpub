-- 会员中心阶段 3 · 积分账户与不可变账本（成本计量地基）
-- 真源：01-docs/PRD-CREDIT-COST-ACCOUNTING-2026-10-23.md §3
--      openspec/changes/credit-cost-accounting-phase1/design.md §2
--
-- 本期范围：把「积分」从展示性数字变成可计量、可对账的账本地基。
--   ① identity_credit_accounts —— 积分余额（物化列，账本汇总的快速读）
--   ② identity_credit_ledger  —— 不可变分录账本（append-only，审计与对账的真相）
--
-- 本期不做（留给后续 change）：
--   · 扣减接线（consumeFeature 目前只被用于次数配额 cloud_publish，积分额度尚未接入）
--   · 价格卡与成本计算（在 ops-center 侧 SQLite 落地，见 models_credit.py）
--   · 预授权/结算两段式扣减
--
-- 与既有表的关系：
--   · identity_entitlement_usage 是**次数配额**（能发几篇/生成几条），本迁移不动它；
--     积分余额是**金额**，两者语义不同，必须分表——混表会得到
--     「发了 1600 积分，用户发 1600 篇就超限」这种荒谬语义。
--   · identity_users 已存在（identity_orders / identity_redeem_codes 同样 FK 到它），
--     本迁移复用，不新建用户表。

BEGIN;

-- 积分账户：余额物化列 + 累计发放/消耗，便于看板直读。
-- balance 的 CHECK (balance >= 0) 是**最后一道防线**：扣减走原子 CAS，
-- 正常路径不会写负数；CHECK 只在并发穿透或逻辑缺陷时兜底。
-- period_start/period_end 是发放周期边界（月初对齐），与
-- identity_entitlement_usage 的周期口径一致，便于两者对账。
CREATE TABLE IF NOT EXISTS identity_credit_accounts (
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
);

-- 积分账本：append-only 的分录流水。
-- entry_type 语义：
--   grant  发放（订阅生效、兑换码核销、运营补发）
--   spend  消耗（按模型真实成本换算后扣减）
--   refund 退回（退款回收、预授权结算后的差额退回）
--   expire 过期（周期结束时按决策清零未用积分）
--   adjust 人工调整（运营纠错，必须带 reason）
-- amount 一律为**正整数**，方向由 entry_type 决定——避免正负号二义性。
-- balance_after 冗余存该分录后的余额，用于逐行核对（不回读账户表也能验账）。
-- price_id / cost_cents 让每笔消耗可回溯到具体价格卡与真实成本（分）。
CREATE TABLE IF NOT EXISTS identity_credit_ledger (
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
);

CREATE INDEX IF NOT EXISTS idx_identity_credit_ledger_user_period
    ON identity_credit_ledger (user_id, period_start DESC);

-- 幂等：同一笔消耗（ref_type='usage_event'）只能入账一次。
-- 桌面端上报可能因超时重试而重复，账本侧靠这个唯一索引兜住，
-- 避免「重试一次扣两次积分」。
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_credit_ledger_spend
    ON identity_credit_ledger (ref_type, ref_id)
    WHERE ref_type = 'usage_event' AND entry_type = 'spend';

-- 幂等：同一笔发放（周期订阅 / 兑换码核销 / 运营补发）只能入账一次。
-- 条件带 `ref_id <> ''`：无 ref_id 的发放退化为「调用方保证不重复」，
-- 而带稳定 ref_id 的周期性发放（如 subscription:<user>:<period>）由数据库兜底。
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_credit_ledger_grant
    ON identity_credit_ledger (ref_type, ref_id)
    WHERE entry_type = 'grant' AND ref_id <> '';

COMMIT;
