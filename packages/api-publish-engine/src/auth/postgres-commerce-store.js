const crypto = require('crypto')

/**
 * postgres-commerce-store.js — 会员中心 P1 商务数据访问层。
 *
 * 自 postgres-identity-repository.js 拆出：承载兑换码/订单/订阅/权益快照/通知/设备会话
 * 的 SQL 常量、事务编排（PostgresCommerceTransaction）与挂到仓储原型上的商务读写方法
 * （commerceMethods）。原仓储模块 require 本模块后再导出 + Object.assign 混入，对外契约不变。
 */

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

// provider_reference 在 identity_subscriptions 上是 UNIQUE（migrations/postgresql/002_logto_identity.sql:29）。撞该约束意味着调用方
// 复用了同一幂等键（重放/误填同值），属可预期的 409，不得冒泡成裸 23505 → 500。约束名固化在仓储层，服务层无需知道。
const ORDER_REFERENCE_CONFLICT_CONSTRAINT = 'identity_subscriptions_provider_reference_key'

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
    // 同一用户的订阅写入串行化：兑换码行锁只保护「同一个码」，跨码/后台授予并发时
    // current_period_end 的读-改-写会丢期（两笔订单只续一份时长）。advisory xact 锁
    // 覆盖「首单尚无行」的冷启动场景（FOR UPDATE 锁不住不存在的行）。
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`sub:${userId}`])
    const existingResult = await this.client.query(
      `SELECT * FROM identity_subscriptions
       WHERE user_id = $1 AND status = 'active' AND current_period_end > $2
       ORDER BY current_period_end DESC LIMIT 1`,
      [userId, nowDate.toISOString()],
    )
    const existing = existingResult.rows[0] || null
    const base = existing && new Date(existing.current_period_end) > nowDate
      ? new Date(existing.current_period_end)
      : nowDate
    const periodEnd = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000)
    // 上界守卫：durationDays 虽为整数，但大到让 periodEnd 溢出为 Invalid Date（1e21/MAX_SAFE_INTEGER）时，
    // 后续 .toISOString() 会抛裸 RangeError → 500。redeem 路径的 duration_days 来自 DB（004 只有 >0 无上限），
    // 两条路径同经此处，故在仓储层拦下，复用既有 DURATION_INVALID/400 语义。
    if (Number.isNaN(periodEnd.getTime())) {
      throw Object.assign(new Error('DURATION_INVALID'), { code: 'DURATION_INVALID', status: 400 })
    }
    let subscriptionResult
    try {
      subscriptionResult = await this.client.query(UPSERT_SUBSCRIPTION, [
        `sub-${userId}`, userId, plan,
        base.toISOString(), periodEnd.toISOString(), order.providerReference || null,
      ])
    } catch (err) {
      // 只收敛 provider_reference 这一处 UNIQUE；其它错误（含别的 23505/别的 constraint）原样上抛，绝不吞。
      if (err && err.code === '23505' && err.constraint === ORDER_REFERENCE_CONFLICT_CONSTRAINT) {
        throw Object.assign(new Error('ORDER_REFERENCE_CONFLICT'), { code: 'ORDER_REFERENCE_CONFLICT', status: 409 })
      }
      throw err
    }
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

/**
 * 会员中心 P1 商务读写方法宿主类：通过 mixin 将实例方法挂到 PostgresIdentityRepository.prototype。
 * 以 class 形态承载方法（类体方法之间无需逗号），this.pool 由宿主仓储实例提供。
 */
class CommerceMethods {
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
      `SELECT * FROM identity_orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
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
      `SELECT * FROM identity_notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
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
    if (typeof deviceId !== 'string' || !deviceId) {
      throw Object.assign(new TypeError('deviceId is required'), { code: 'SESSION_DEVICE_REQUIRED', status: 400 })
    }
    const id = sessionRecordId(userId, deviceId)
    const result = await this.pool.query(UPSERT_SESSION, [id, userId, deviceId, deviceName])
    return result.rows[0] || { id, user_id: userId, device_id: deviceId, device_name: deviceName, revoked_at: null }
  }

  async listActiveSessions(userId) {
    const result = await this.pool.query(
      `SELECT id, device_id, device_name, created_at, last_seen_at FROM identity_user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC NULLS LAST, id DESC`,
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
}

module.exports = {
  PostgresCommerceTransaction,
  CommerceMethods,
}
