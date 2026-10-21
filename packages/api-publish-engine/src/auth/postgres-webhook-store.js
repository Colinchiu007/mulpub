'use strict'
/**
 * postgres-webhook-store.js — Logto webhook 事务对象（从 postgres-identity-repository.js 拆出）。
 *
 * 为什么拆：006 微信 Native 支付接入时，`postgres-identity-repository.js` 已到 498 行
 * （仓库 `filesOver500` 债务基线是 95，500 行及以上才计入）。任何为支付新增的语句都会把它
 * 推过线，而**抬高基线掩盖自己引入的债务是明确禁止的**。按既有
 * `postgres-commerce-store.js`（同文件拆出 `PostgresCommerceTransaction` + `CommerceMethods`）
 * 的同一体例拆分，对外契约不变：本模块的类仍由 repository 的 `transaction()` 实例化，
 * 由 repository 的 `module.exports` 原样再导出。
 *
 * 纪律：本类只做 SQL，不含业务判断；事件先落库再处理（outbox 式），乱序/重复/重放可追溯。
 */

const crypto = require('crypto')

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

module.exports = { PostgresWebhookTransaction }
