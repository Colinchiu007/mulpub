// @ts-check
/**
 * publish-daily-store — 发布日配额计数功能域 mixin（publish-frequency-policy-v2）
 *
 * 表：publish_daily_count(owner_subject, key, day_key, count, rollback_count, updated_at)
 *   key      = buildKey(platform, accountId)（percent-encoded，见 publish-interval-guard）
 *   day_key  = 本机运营日 'YYYY-MM-DD'（不与平台日界换算）
 *
 * 两个计数器语义分离（禁止合并成一个）：
 *   count          —— 已**实际提交到平台**的次数；未提交失败的回滚会幂等回补（下限 0）
 *   rollback_count —— **回滚尝试**次数；只增不减，用于防风上限
 *
 * 为什么回补：一次从未发出的尝试不构成平台负载，计入配额等于对同一件事双重计费
 * （间隔窗口已回滚，配额却仍占着）。而回滚次数不随回补减少，否则「回滚 — 回补 — 再回滚」
 * 可以无限循环，防风上限形同虚设。
 *
 * owner 解析与 rate-limit-store 同源：无 owner 一律 no-op（返回 null / 0），不落库。
 */
/** 允许的字段白名单（列名无法参数化，必须白名单化，防 SQL 注入） */
const FIELD_COLUMN = {
  count: 'count',
  rollback_count: 'rollback_count',
  rollbackCount: 'rollback_count',
}

/** 保留最近 N 天的行（按 day_key 字典序裁剪；'YYYY-MM-DD' 字典序即时间序） */
const RETAIN_DAYS = 7

function normalizeField (field) {
  const col = FIELD_COLUMN[field]
  return col || null
}

module.exports = {
  /**
   * 读某 (key, day) 的计数行。
   * @param {string} key
   * @param {string} dayKey
   * @param {string} [ownerSubject]
   * @returns {{count: number, rollback_count: number, updated_at: number}|null} null = 无行/无 owner/未就绪
   */
  getPublishDailyCount (key, dayKey, ownerSubject) {
    if (!this._ready) return null
    const owner = this._resolveOwnerSubject(ownerSubject)
    if (!owner) return null
    const row = this.db.prepare(
      'SELECT count, rollback_count, updated_at FROM publish_daily_count WHERE owner_subject = ? AND key = ? AND day_key = ?'
    ).get(owner, key, dayKey)
    if (!row) return null
    return {
      count: row.count,
      rollback_count: row.rollback_count,
      updated_at: row.updated_at,
    }
  },

  /**
   * 增减某 (key, day) 的计数（upsert），并保证结果不为负。
   * @param {string} key
   * @param {string} dayKey
   * @param {'count'|'rollback_count'} field
   * @param {number} delta - 正数为增，负数为减
   * @param {string} [ownerSubject]
   * @param {number} [nowMs]
   * @returns {number} 变更后的计数值（no-op 时返回 0）
   */
  incrPublishDailyCount (key, dayKey, field, delta = 1, ownerSubject, nowMs) {
    if (!this._ready) return 0
    const column = normalizeField(field)
    if (!column) {
      // 未知字段不得静默写入：列名走白名单，未知一律拒绝并出声
      console.warn(`[publish-daily-store] 未知计数字段 ${JSON.stringify(field)}，已忽略（合法值：count / rollback_count）`)
      return 0
    }
    const owner = this._resolveOwnerSubject(ownerSubject)
    if (!owner) return 0
    const step = Number.isFinite(delta) ? Math.trunc(delta) : 0
    const at = Number.isFinite(nowMs) ? nowMs : Date.now()

    // 单条 UPSERT：SQLite 的 MAX(0, ...) 保证下限 0，不需要读改写两步（避免竞态）
    this.db.prepare(
      `INSERT INTO publish_daily_count (owner_subject, key, day_key, count, rollback_count, updated_at)
       VALUES (?, ?, ?, MAX(0, ?), MAX(0, ?), ?)
       ON CONFLICT(owner_subject, key, day_key) DO UPDATE SET
         ${column} = MAX(0, ${column} + ?),
         updated_at = ?`
    ).run(
      owner, key, dayKey,
      column === 'count' ? step : 0,
      column === 'rollback_count' ? step : 0,
      at,
      step,
      at
    )

    const row = this.getPublishDailyCount(key, dayKey, ownerSubject)
    return row ? Number(row[column]) || 0 : 0
  },

  /** 递减某 (key, day) 的计数（下限 0）；配额回补用 */
  decrPublishDailyCount (key, dayKey, field = 'count', ownerSubject, nowMs) {
    return this.incrPublishDailyCount(key, dayKey, field, -1, ownerSubject, nowMs)
  },

  /**
   * 裁剪早于「保留窗口」的日计数行（按 day_key 字典序）。
   * 只删本 owner 的行；返回删除行数。
   * @param {string} todayKey - 当前本机运营日 'YYYY-MM-DD'
   * @param {string} [ownerSubject]
   * @returns {number}
   */
  prunePublishDailyCount (todayKey, ownerSubject) {
    if (!this._ready) return 0
    const owner = this._resolveOwnerSubject(ownerSubject)
    if (!owner || !isValidDayKey(todayKey)) return 0
    const cutoff = shiftDayKey(todayKey, -(RETAIN_DAYS - 1))
    const res = this.db.prepare(
      'DELETE FROM publish_daily_count WHERE owner_subject = ? AND day_key < ?'
    ).run(owner, cutoff)
    return res && Number.isFinite(res.changes) ? res.changes : 0
  },

  /**
   * 启动期维护：按 owner **逐个**裁剪（change: publish-frequency-unwired-surfaces）。
   *
   * 为什么必须逐个 owner 而不是一条不带 owner_subject 的 DELETE：
   * 本仓的 owner 隔离不变量是「查询、更新和删除必须同时匹配 owner_subject」
   * （`store-owner-isolation.test.js` 有同名锁）。跨 owner 一把删会让"删除"这个动作
   * 失去归属，也与上面那个 per-owner prune 形成两套口径。
   *
   * ⚠️ 返回值带 `basis`：`owners: 0, removed: 0` 在"表本来没行"和"查询没成功"之间
   * 必须可区分 —— 把「没测到」印成 0 正是本仓反复登记过的「构造性零」。
   *
   * @param {string} todayKey - 'YYYY-MM-DD' 且日历真实存在
   * @returns {{owners: number, removed: number, basis: 'measured'|'invalid_input'|'not_ready'|'unproven'}}
   */
  prunePublishDailyCountAllOwners (todayKey) {
    if (!this._ready) return { owners: 0, removed: 0, basis: 'not_ready' }
    if (!isValidDayKey(todayKey)) return { owners: 0, removed: 0, basis: 'invalid_input' }
    const rows = this.db.prepare(
      'SELECT DISTINCT owner_subject AS owner FROM publish_daily_count'
    ).all()
    // sqlite-wrapper 的 all() 出错时会 log.error 并回吐非数组 ⇒ 那是「没测到」不是「没有行」
    if (!Array.isArray(rows)) return { owners: 0, removed: 0, basis: 'unproven' }
    let removed = 0
    let owners = 0
    for (const row of rows) {
      const owner = row && row.owner
      if (!owner) continue
      owners += 1
      removed += this.prunePublishDailyCount(todayKey, owner)
    }
    return { owners, removed, basis: 'measured' }
  },
}

/**
 * 日键校验：形状 + **日历真实性**（缺一不可）。
 *
 * 只做形状校验是不够的：'2026-13-40' 过得了 /^\d{4}-\d{2}-\d{2}$/，但经
 * `Date.UTC(2026, 12, 40)` 归一化会**滚到 2027-02**，于是 cutoff 落在所有历史行之后
 * ⇒ 一次"清理"把整表删光（症状是所有人当天都能重发）。这是保留窗口的破坏性输入，
 * 不是无害的空操作，所以两个 prune 入口共用这一个谓词。
 */
function isValidDayKey (s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const parts = s.split('-').map(Number)
  const y = parts[0]
  const m = parts[1]
  const d = parts[2]
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** 'YYYY-MM-DD' 平移 n 天（只用于裁剪阈值，不参与判定口径） */
function shiftDayKey (dayKey, days) {
  const [y, m, d] = dayKey.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000
  return new Date(t).toISOString().slice(0, 10)
}
