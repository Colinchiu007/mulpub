-- 兑换码「发放对象」一列（2026-10-24）。
--
-- 动机：兑换码是 bearer token，一旦泄漏（例如渠道方二次转卖），没有发放对象就无从
-- 回答「这批码发给了谁」，运营只能靠记忆排查。issued_to 记录「发给谁」。
--
-- ⚠️ 能力边界（不要把本列的作用说大）：仓里**只有单码吊销**
-- （POST /api/v1/admin/member/redeem-codes/disable），**没有批量作废端点**。
-- ⇒ 泄漏后的处置流程是：按 **batch** 列出该批次的码（列表接口支持 batch 过滤）
--   → 逐个吊销；issued_to 供人工判断这批码该优先处理。
--   ⚠️ issued_to **当前不是列表筛选条件**（列表只支持 plan/status/batch 过滤）。
--
-- ⚠️ 迁移编号纪律（AGENTS.md「迁移编号的唯一性纪律」）：本文件用 009，刻意**跳过 007 与 008**。
--   008 已被在飞 PR #4322（credit_ledger）占用；007 预留给尚未开 PR 的
--   compute-key-envelope-migration change。迁移台账按「文件名 + checksum」双向锁定，
--   **撞号会让 identity 仓储启动期硬失败**（MIGRATION_PENDING / MIGRATION_CHECKSUM_MISMATCH
--   ⇒ MEMBERSHIP_UNAVAILABLE ⇒ 会员中心整体降级）⇒ 宁可跳号，不可撞号。
--
-- ⚠️ 本文件必须与 `packages/api-publish-engine/src/auth/postgres-identity-repository.js`
--   的 SCHEMA 数组**逐字成对**（那是仅非生产环境执行的 bootstrap 路径）：
--   那里那张表写的是 `CREATE TABLE IF NOT EXISTS identity_redeem_codes (...)`，
--   **对已存在的表是 no-op、不会加列** ⇒ 开发库缺这一列 ⇒ INSERT 报 column does not exist，
--   而生产库（走迁移）是好的 ⇒ 只在开发环境复现的诡异差异。
--   故两处都用 ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   （先例：006_payment_orders.sql 与 src/auth/payment-schema.js 是内容相同的一对）。

BEGIN;

ALTER TABLE identity_redeem_codes ADD COLUMN IF NOT EXISTS issued_to TEXT;

COMMIT;
