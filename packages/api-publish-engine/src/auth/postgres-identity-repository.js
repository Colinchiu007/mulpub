const crypto = require('crypto')
const path = require('path')
const { discoverMigrations, validateMigrationLedger } = require('./postgres-migrations')

const DEFAULT_MIGRATION_DIRECTORY = path.resolve(__dirname, '../../../..', 'migrations', 'postgresql')

const REQUIRED_SCHEMA_RELATIONS = [
  'identity_schema_migrations',
  'identity_users',
  'identity_subscriptions',
  'identity_entitlement_snapshots',
  'identity_entitlement_usage',
  'identity_webhook_events',
  'identity_user_sessions',
  'identity_orders',
  'identity_redeem_codes',
  'identity_notifications',
]

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS identity_users (
    id TEXT PRIMARY KEY,
    auth_provider TEXT NOT NULL DEFAULT 'logto',
    auth_subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    display_name TEXT,
    avatar_url TEXT,
    last_event_created_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (auth_provider, auth_subject)
  )`,
  `ALTER TABLE identity_users
    ADD COLUMN IF NOT EXISTS last_event_created_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS identity_entitlement_snapshots (
    user_id TEXT PRIMARY KEY REFERENCES identity_users(id),
    version INTEGER NOT NULL DEFAULT 1,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS identity_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    provider_reference TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS identity_entitlement_usage (
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
    quota_limit INTEGER NOT NULL CHECK (quota_limit >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, feature, period_start)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identity_entitlement_usage_period
    ON identity_entitlement_usage (user_id, period_end)`,
  `CREATE TABLE IF NOT EXISTS identity_webhook_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'logto',
    event TEXT NOT NULL,
    hook_id TEXT NOT NULL,
    auth_subject TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    result JSONB,
    processed_at TIMESTAMPTZ,
    UNIQUE (provider, id)
  )`,
  `CREATE TABLE IF NOT EXISTS identity_user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
  )`,
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
]

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

class PostgresWebhookTransaction {
  constructor(client) {
    this.client = client
  }

  async claimWebhookEvent(record) {
    const result = await this.client.query(
      `INSERT INTO identity_webhook_events
        (id, provider, event, hook_id, auth_subject, created_at, received_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
       ON CONFLICT (provider, id) DO NOTHING
       RETURNING id`,
      [record.id, record.provider, record.event, record.hookId, record.subject, record.createdAt, record.receivedAt],
    )
    return result.rows.length > 0
  }

  async upsertUserState(provider, subject, patch = {}, options = {}) {
    const existingResult = await this.client.query(
      'SELECT * FROM identity_users WHERE auth_provider = $1 AND auth_subject = $2 FOR UPDATE',
      [provider, subject],
    )
    const existing = existingResult.rows[0] || null
    const eventAt = options.eventCreatedAt ? new Date(options.eventCreatedAt) : null
    if (eventAt && Number.isNaN(eventAt.getTime())) throw new Error('WEBHOOK_EVENT_TIME_INVALID')
    if (existing && eventAt && existing.last_event_created_at && new Date(existing.last_event_created_at) >= eventAt) {
      return { ...existing, applied: false }
    }

    const status = existing && existing.status === 'deleted' && options.preserveDeleted
      ? 'deleted'
      : typeof patch.status === 'string' ? patch.status : existing ? existing.status : 'active'
    const displayName = Object.prototype.hasOwnProperty.call(patch, 'display_name')
      ? patch.display_name : existing ? existing.display_name : null
    const avatarUrl = Object.prototype.hasOwnProperty.call(patch, 'avatar_url')
      ? patch.avatar_url : existing ? existing.avatar_url : null
    const id = existing ? existing.id : crypto.randomUUID()
    const result = await this.client.query(
      `INSERT INTO identity_users
        (id, auth_provider, auth_subject, status, display_name, avatar_url, last_event_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (auth_provider, auth_subject) DO UPDATE SET
         status = EXCLUDED.status,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         last_event_created_at = EXCLUDED.last_event_created_at,
         updated_at = NOW()
       WHERE identity_users.last_event_created_at IS NULL
          OR identity_users.last_event_created_at < EXCLUDED.last_event_created_at
       RETURNING *`,
      [id, provider, subject, status, displayName, avatarUrl, eventAt ? eventAt.toISOString() : null],
    )
    if (!result.rows[0]) return { ...(existing || {}), applied: false }
    return { ...result.rows[0], applied: true }
  }

  async revokeUserSessions(provider, subject) {
    await this.client.query(
      `UPDATE identity_user_sessions SET revoked_at = NOW()
       WHERE revoked_at IS NULL AND user_id = (
         SELECT id FROM identity_users WHERE auth_provider = $1 AND auth_subject = $2
       )`,
      [provider, subject],
    )
  }

  async completeWebhookEvent(eventId, result) {
    await this.client.query(
      `UPDATE identity_webhook_events
       SET status = 'processed', result = $2::jsonb, processed_at = NOW()
       WHERE id = $1`,
      [eventId, JSON.stringify(result || {})],
    )
  }
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

class PostgresIdentityRepository {
  constructor(options = {}) {
    if (options.pool) {
      this.pool = options.pool
      this._ownsPool = false
    } else {
      if (typeof options.connectionString !== 'string' || !options.connectionString) {
        throw new TypeError('PostgreSQL connectionString is required')
      }
      const { Pool } = require('pg')
      this.pool = new Pool({ connectionString: options.connectionString, max: options.maxConnections || 10 })
      this._ownsPool = true
    }
    this.migrationDirectory = options.migrationDirectory || DEFAULT_MIGRATION_DIRECTORY
    this.production = options.production === undefined
      ? String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
      : options.production === true
  }

  async initialize() {
    if (this.production) {
      const error = new Error('PRODUCTION_AUTO_MIGRATE_FORBIDDEN')
      error.code = 'PRODUCTION_AUTO_MIGRATE_FORBIDDEN'
      throw error
    }
    for (const statement of SCHEMA) await this.pool.query(statement)
  }

  async assertReady() {
    await this.pool.query('SELECT 1 AS ok')
    const result = await this.pool.query(
      'SELECT name, to_regclass(name) AS relation FROM unnest($1::text[]) AS name',
      [REQUIRED_SCHEMA_RELATIONS],
    )
    const relations = new Map((result.rows || []).map((row) => [row.name, row.relation]))
    const missing = REQUIRED_SCHEMA_RELATIONS.filter((name) => !relations.get(name))
    if (missing.length > 0) {
      const error = new Error('BUSINESS_DATABASE_SCHEMA_NOT_READY')
      error.code = 'BUSINESS_DATABASE_SCHEMA_NOT_READY'
      error.missingRelations = missing
      throw error
    }
    try {
      const migrations = discoverMigrations(this.migrationDirectory)
      const ledger = await this.pool.query('SELECT name, checksum FROM identity_schema_migrations ORDER BY name')
      validateMigrationLedger(migrations, ledger.rows || [], { allowPending: false })
    } catch (error) {
      if (error && ['MIGRATION_PENDING', 'MIGRATION_CHECKSUM_MISMATCH', 'MIGRATION_FILE_MISSING', 'MIGRATION_LEDGER_INVALID'].includes(error.code)) throw error
      const wrapped = new Error('BUSINESS_DATABASE_MIGRATIONS_UNAVAILABLE')
      wrapped.code = 'BUSINESS_DATABASE_MIGRATIONS_UNAVAILABLE'
      throw wrapped
    }
    return { database: 'ready', schema: 'ready' }
  }

  async findBySubject(provider, subject) {
    const result = await this.pool.query(
      'SELECT * FROM identity_users WHERE auth_provider = $1 AND auth_subject = $2',
      [provider, subject],
    )
    return result.rows[0] || null
  }

  async create(record) {
    const result = await this.pool.query(
      `INSERT INTO identity_users
        (id, auth_provider, auth_subject, status, display_name, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (auth_provider, auth_subject) DO NOTHING
       RETURNING *`,
      [record.id, record.auth_provider, record.auth_subject, record.status || 'active', record.display_name || null, record.avatar_url || null],
    )
    return result.rows[0] || this.findBySubject(record.auth_provider, record.auth_subject)
  }

  async updateProfile(id, patch = {}) {
    const result = await this.pool.query(
      `UPDATE identity_users SET
         display_name = CASE WHEN $2 THEN $3 ELSE display_name END,
         avatar_url = CASE WHEN $4 THEN $5 ELSE avatar_url END,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        id,
        Object.prototype.hasOwnProperty.call(patch, 'display_name'), patch.display_name || null,
        Object.prototype.hasOwnProperty.call(patch, 'avatar_url'), patch.avatar_url || null,
      ],
    )
    return result.rows[0] || null
  }

  async getEntitlement(userId) {
    const result = await this.pool.query(
      'SELECT payload FROM identity_entitlement_snapshots WHERE user_id = $1',
      [userId],
    )
    return result.rows[0] ? result.rows[0].payload : null
  }

  /**
   * 原子扣减一个用户在当前计费周期内的 feature 用量。
   * 返回 null 表示额度不足；调用方不得在应用层先读后写。
   */
  async consumeEntitlementUsage({ userId, feature, amount, limit, periodStart, periodEnd }) {
    if (typeof userId !== 'string' || !userId || typeof feature !== 'string' || !feature) {
      throw new TypeError('userId and feature are required')
    }
    if (!Number.isInteger(amount) || amount <= 0 || !Number.isInteger(limit) || limit < 0) {
      throw new TypeError('amount and limit must be valid integers')
    }
    if (typeof periodStart !== 'string' || typeof periodEnd !== 'string') {
      throw new TypeError('periodStart and periodEnd are required')
    }
    const periodStartDate = new Date(periodStart)
    const periodEndDate = new Date(periodEnd)
    if (Number.isNaN(periodStartDate.getTime()) || Number.isNaN(periodEndDate.getTime())) {
      throw new TypeError('periodStart and periodEnd must be valid dates')
    }
    if (periodEndDate <= periodStartDate) throw new TypeError('periodEnd must be after periodStart')
    const result = await this.pool.query(
      `INSERT INTO identity_entitlement_usage
        (user_id, feature, period_start, period_end, used, quota_limit)
       SELECT $1, $2, $3::timestamptz, $4::timestamptz, $5, $6
       WHERE $5 <= $6
       ON CONFLICT (user_id, feature, period_start) DO UPDATE SET
         used = identity_entitlement_usage.used + EXCLUDED.used,
         quota_limit = EXCLUDED.quota_limit,
         period_end = EXCLUDED.period_end,
         updated_at = NOW()
       WHERE identity_entitlement_usage.used + EXCLUDED.used <= EXCLUDED.quota_limit
       RETURNING used, quota_limit, period_start, period_end`,
      [userId, feature, periodStart, periodEnd, amount, limit],
    )
    const row = result.rows && result.rows[0]
    if (!row) return null
    return {
      used: Number(row.used),
      limit: Number(row.quota_limit),
      remaining: Math.max(0, Number(row.quota_limit) - Number(row.used)),
      periodStart: row.period_start,
      periodEnd: row.period_end,
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await callback(new PostgresWebhookTransaction(client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

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

  async close() {
    if (this._ownsPool && this.pool && typeof this.pool.end === 'function') await this.pool.end()
  }
}

class PostgresEntitlementProvider {
  constructor(repository, options = {}) {
    this.repository = repository
    this.now = typeof options.now === 'function' ? options.now : () => new Date()
  }

  async getForUser({ businessUser } = {}) {
    if (!businessUser || typeof businessUser.id !== 'string') return { plan: 'free', features: [] }
    const value = await this.repository.getEntitlement(businessUser.id)
    const payload = typeof value === 'string' ? JSON.parse(value) : value
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { plan: 'free', features: [] }
    return payload
  }

  async requireFeature(context = {}) {
    const entitlement = await this.getForUser(context)
    return Array.isArray(entitlement.features) && entitlement.features.includes(context.feature)
  }

  async consumeFeature(context = {}, amount = 1) {
    const userId = context.businessUser && context.businessUser.id
    if (typeof userId !== 'string' || !userId) {
      throw Object.assign(new Error('BUSINESS_USER_REQUIRED'), { code: 'BUSINESS_USER_REQUIRED', status: 503 })
    }
    const feature = context.feature
    const entitlement = await this.getForUser(context)
    if (!Array.isArray(entitlement.features) || !entitlement.features.includes(feature)) {
      throw Object.assign(new Error('ENTITLEMENT_FEATURE_REQUIRED'), { code: 'ENTITLEMENT_FEATURE_REQUIRED', status: 403 })
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw Object.assign(new Error('ENTITLEMENT_AMOUNT_INVALID'), { code: 'ENTITLEMENT_AMOUNT_INVALID', status: 400 })
    }
    const quotaKey = `${feature}_monthly`
    const limit = entitlement.quota && Number(entitlement.quota[quotaKey])
    if (!Number.isInteger(limit) || limit < 0) {
      throw Object.assign(new Error('ENTITLEMENT_QUOTA_INVALID'), { code: 'ENTITLEMENT_QUOTA_INVALID', status: 503 })
    }
    const current = this.now()
    const date = current instanceof Date ? current : new Date(current)
    if (Number.isNaN(date.getTime())) {
      throw Object.assign(new Error('ENTITLEMENT_CLOCK_INVALID'), { code: 'ENTITLEMENT_CLOCK_INVALID', status: 503 })
    }
    const periodStartDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    const periodEndDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
    const usage = await this.repository.consumeEntitlementUsage({
      userId,
      feature,
      amount,
      limit,
      periodStart: periodStartDate.toISOString(),
      periodEnd: periodEndDate.toISOString(),
    })
    if (!usage) {
      throw Object.assign(new Error('ENTITLEMENT_QUOTA_EXHAUSTED'), {
        code: 'ENTITLEMENT_QUOTA_EXHAUSTED', status: 429,
      })
    }
    return usage
  }
}

module.exports = {
  PostgresEntitlementProvider,
  PostgresIdentityRepository,
  PostgresWebhookTransaction,
  PostgresCommerceTransaction,
  REQUIRED_SCHEMA_RELATIONS,
  SCHEMA,
  DEFAULT_MIGRATION_DIRECTORY,
}
