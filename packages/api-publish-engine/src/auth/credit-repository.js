'use strict'
/**
 * PostgresCreditRepository — 积分账户与不可变账本的数据访问层。
 *
 * 为什么单独成文件：`postgres-identity-repository.js` 已有 428 行，
 * 把积分方法内联进去会推过仓库 `filesOver500` 债务基线（抬高基线掩盖自己引入的
 * 债务是明确禁止的）。按既有 `postgres-commerce-store.js` 拆分先例单独立文件。
 *
 * 与 `identity_entitlement_usage` 的边界（两者语义不同，不可混用）：
 *   · identity_entitlement_usage = **次数配额**（能发几篇 / 生成几条视频），防刷用；
 *   · identity_credit_accounts/ledger = **积分余额**（官方算力花了多少钱），计费用。
 *
 * 并发语义（照抄 `consumeEntitlementUsage` 的原子 CAS 范式）：
 *   扣减用 `UPDATE ... WHERE balance >= amount`，在 READ COMMITTED 下行锁会重新
 *   求值条件，两个并发请求只有一个能扣成功，另一个拿到 rowcount=0（余额不足）。
 *   **扣减与写分录必须在同一事务内**——否则并发下可能出现「余额扣了但分录没写」
 *   或「分录写了但余额没扣」，账实不符且无法审计。
 */

const CREDIT_ENTRY_TYPES = Object.freeze(['grant', 'spend', 'refund', 'expire', 'adjust'])

class CreditError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
    this.status = 409
  }
}

class PostgresCreditRepository {
  constructor(options = {}) {
    this.pool = options.pool
    if (!this.pool || typeof this.pool.query !== 'function') {
      throw new TypeError('PostgresCreditRepository requires a pool')
    }
  }

  /** 账户不存在时创建空账户（余额 0）。幂等。 */
  async ensureAccount(userId, periodStart, periodEnd) {
    if (typeof userId !== 'string' || !userId) throw new TypeError('userId is required')
    const result = await this.pool.query(
      `INSERT INTO identity_credit_accounts
        (user_id, balance, granted_total, spent_total, period_start, period_end)
       VALUES ($1, 0, 0, 0, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING balance, granted_total, spent_total, period_start, period_end`,
      [userId, periodStart, periodEnd],
    )
    return this._toAccount(result.rows[0])
  }

  /** 读账户余额。账户不存在返回 null（调用方决定是建还是报错）。 */
  async getAccount(userId) {
    if (typeof userId !== 'string' || !userId) throw new TypeError('userId is required')
    const result = await this.pool.query(
      `SELECT balance, granted_total, spent_total, period_start, period_end
         FROM identity_credit_accounts WHERE user_id = $1`,
      [userId],
    )
    const row = result.rows && result.rows[0]
    return row ? this._toAccount(row) : null
  }

  /**
   * 发放积分（订阅生效 / 兑换码核销 / 运营补发）。
   *
   * 幂等：同一 (ref_type, ref_id) 的 grant 只入账一次——靠
   * `uq_identity_credit_ledger_grant` 部分唯一索引在数据库侧兜住，
   * 不靠「先查后写」（后者在并发下有窗口）。
   *
   * @returns {Promise<{account: object, entry: object, duplicated: boolean}>}
   */
  async grantCredit({ userId, amount, reason = '', refType = '', refId = '', periodStart, periodEnd } = {}) {
    this._assertGrant({ userId, amount, periodStart, periodEnd })
    return this._withTransaction(async (client) => {
      // 幂等：带 ref_id 的发放已入账则直接返回，不重复加余额。
      // 空 ref_id 不查（数据库侧唯一索引也放行它）——那种发放由调用方保证不重复。
      if (refId) {
        const existing = await client.query(
          `SELECT id, amount, balance_after FROM identity_credit_ledger
            WHERE ref_type = $1 AND ref_id = $2 AND entry_type = 'grant'`,
          [refType, refId],
        )
        if (existing.rows && existing.rows[0]) {
          const account = await this.getAccount(userId)
          return {
            account,
            entry: {
              id: existing.rows[0].id,
              amount: Number(existing.rows[0].amount),
              balanceAfter: Number(existing.rows[0].balance_after),
            },
            duplicated: true,
          }
        }
      }
      const account = await this._applyBalance(client, {
        userId,
        amount,
        direction: 'grant',
        periodStart,
        periodEnd,
      })
      const entry = await this._insertEntry(client, {
        userId,
        entryType: 'grant',
        amount,
        balanceAfter: account.balance,
        reason,
        refType,
        refId,
        priceId: '',
        costCents: 0,
        periodStart,
        periodEnd,
      })
      return { account, entry, duplicated: false }
    })
  }

  /**
   * 消耗积分（按模型真实成本换算后扣减）。
   *
   * 余额不足时抛 `CREDIT_BALANCE_EXHAUSTED`（409），**不写分录**——
   * 账本只记真实发生过的消耗。
   *
   * 幂等：同一 (ref_type='usage_event', ref_id=事件ID) 只扣一次，
   * 靠 `uq_identity_credit_ledger_spend` 部分唯一索引兜住。
   */
  async consumeCredit({
    userId,
    amount,
    costCents = 0,
    priceId = '',
    reason = '',
    refType = 'usage_event',
    refId = '',
    periodStart,
    periodEnd,
  } = {}) {
    this._assertGrant({ userId, amount, periodStart, periodEnd })
    if (costCents < 0 || !Number.isInteger(costCents)) throw new TypeError('costCents must be a non-negative integer')
    return this._withTransaction(async (client) => {
      // 先看这笔记不已经扣过——命中即幂等返回，不重复扣。
      const existing = await client.query(
        `SELECT id, amount, balance_after FROM identity_credit_ledger
          WHERE ref_type = $1 AND ref_id = $2 AND entry_type = 'spend'`,
        [refType, refId],
      )
      if (existing.rows && existing.rows[0]) {
        const account = await this.getAccount(userId)
        return {
          account,
          entry: {
            id: existing.rows[0].id,
            amount: Number(existing.rows[0].amount),
            balanceAfter: Number(existing.rows[0].balance_after),
          },
          duplicated: true,
        }
      }
      const account = await this._applyBalance(client, {
        userId,
        amount,
        direction: 'spend',
        periodStart,
        periodEnd,
      })
      if (!account) {
        throw new CreditError('CREDIT_BALANCE_EXHAUSTED', '积分余额不足')
      }
      const entry = await this._insertEntry(client, {
        userId,
        entryType: 'spend',
        amount,
        balanceAfter: account.balance,
        reason,
        refType,
        refId,
        priceId,
        costCents,
        periodStart,
        periodEnd,
      })
      return { account, entry, duplicated: false }
    })
  }

  /** 账本明细（按时间倒序）。 */
  async listLedger(userId, limit = 50) {
    if (typeof userId !== 'string' || !userId) throw new TypeError('userId is required')
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 200)
    const result = await this.pool.query(
      `SELECT id, entry_type, amount, balance_after, reason, ref_type, ref_id,
              price_id, cost_cents, period_start, period_end, created_at
         FROM identity_credit_ledger
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [userId, capped],
    )
    return (result.rows || []).map((row) => ({
      id: row.id,
      entryType: row.entry_type,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      reason: row.reason,
      refType: row.ref_type,
      refId: row.ref_id,
      priceId: row.price_id,
      costCents: Number(row.cost_cents),
      periodStart: row.period_start,
      periodEnd: row.period_end,
      createdAt: row.created_at,
    }))
  }

  /**
   * 对账：账本汇总 vs 账户物化列。
   * 两者不等说明有并发穿透或逻辑缺陷，运营后台应把它作为告警指标。
   */
  async reconcileAccount(userId) {
    const result = await this.pool.query(
      `SELECT a.balance AS account_balance,
              a.granted_total AS account_granted,
              a.spent_total AS account_spent,
              COALESCE(SUM(CASE WHEN l.entry_type = 'grant'  THEN l.amount
                                WHEN l.entry_type = 'spend'  THEN -l.amount
                                WHEN l.entry_type = 'refund' THEN l.amount
                                WHEN l.entry_type = 'expire' THEN -l.amount
                                ELSE 0 END), 0) AS ledger_balance,
              COALESCE(SUM(CASE WHEN l.entry_type = 'grant' THEN l.amount ELSE 0 END), 0) AS ledger_granted,
              COALESCE(SUM(CASE WHEN l.entry_type = 'spend' THEN l.amount ELSE 0 END), 0) AS ledger_spent
         FROM identity_credit_accounts a
         LEFT JOIN identity_credit_ledger l ON l.user_id = a.user_id
        WHERE a.user_id = $1
        GROUP BY a.balance, a.granted_total, a.spent_total`,
      [userId],
    )
    const row = result.rows && result.rows[0]
    if (!row) return null
    const accountBalance = Number(row.account_balance)
    const ledgerBalance = Number(row.ledger_balance)
    return {
      accountBalance,
      ledgerBalance,
      balanceMatches: accountBalance === ledgerBalance,
      accountGranted: Number(row.account_granted),
      ledgerGranted: Number(row.ledger_granted),
      accountSpent: Number(row.account_spent),
      ledgerSpent: Number(row.ledger_spent),
    }
  }

  // ── 内部实现 ────────────────────────────────────────────────────────────

  _assertGrant({ userId, amount, periodStart, periodEnd }) {
    if (typeof userId !== 'string' || !userId) throw new TypeError('userId is required')
    if (!Number.isInteger(amount) || amount <= 0) throw new TypeError('amount must be a positive integer')
    if (typeof periodStart !== 'string' || typeof periodEnd !== 'string') {
      throw new TypeError('periodStart and periodEnd are required')
    }
    const start = new Date(periodStart)
    const end = new Date(periodEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new TypeError('periodStart and periodEnd must be valid dates')
    }
    if (end <= start) throw new TypeError('periodEnd must be after periodStart')
  }

  /**
   * 余额变更（原子 CAS）。
   *  · grant：UPSERT，余额与累计发放同时增加；
   *  · spend：UPDATE ... WHERE balance >= amount，扣不动返回 null。
   * 返回扣减后的账户快照（balance 即 balance_after）。
   */
  async _applyBalance(client, { userId, amount, direction, periodStart, periodEnd }) {
    if (direction === 'grant') {
      const result = await client.query(
        `INSERT INTO identity_credit_accounts
          (user_id, balance, granted_total, spent_total, period_start, period_end)
         VALUES ($1, $2, $2, 0, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           balance = identity_credit_accounts.balance + EXCLUDED.balance,
           granted_total = identity_credit_accounts.granted_total + EXCLUDED.granted_total,
           period_start = EXCLUDED.period_start,
           period_end = EXCLUDED.period_end,
           updated_at = NOW()
         RETURNING balance, granted_total, spent_total, period_start, period_end`,
        [userId, amount, periodStart, periodEnd],
      )
      return this._toAccount(result.rows[0])
    }
    const result = await client.query(
      `UPDATE identity_credit_accounts
          SET balance = balance - $2,
              spent_total = spent_total + $2,
              updated_at = NOW()
        WHERE user_id = $1 AND balance >= $2
        RETURNING balance, granted_total, spent_total, period_start, period_end`,
      [userId, amount],
    )
    const row = result.rows && result.rows[0]
    if (!row) return null
    return this._toAccount(row)
  }

  async _insertEntry(client, entry) {
    if (!CREDIT_ENTRY_TYPES.includes(entry.entryType)) {
      throw new TypeError(`invalid entry_type: ${entry.entryType}`)
    }
    const result = await client.query(
      `INSERT INTO identity_credit_ledger
        (user_id, entry_type, amount, balance_after, reason, ref_type, ref_id,
         price_id, cost_cents, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, entry_type, amount, balance_after, created_at`,
      [
        entry.userId,
        entry.entryType,
        entry.amount,
        entry.balanceAfter,
        entry.reason,
        entry.refType,
        entry.refId,
        entry.priceId,
        entry.costCents,
        entry.periodStart,
        entry.periodEnd,
      ],
    )
    const row = result.rows && result.rows[0]
    return {
      id: row.id,
      entryType: row.entry_type,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      createdAt: row.created_at,
    }
  }

  async _withTransaction(callback) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  _toAccount(row) {
    if (!row) return null
    return {
      balance: Number(row.balance),
      grantedTotal: Number(row.granted_total),
      spentTotal: Number(row.spent_total),
      periodStart: row.period_start,
      periodEnd: row.period_end,
    }
  }
}

module.exports = { PostgresCreditRepository, CreditError, CREDIT_ENTRY_TYPES }
