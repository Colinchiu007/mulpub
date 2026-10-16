// @ts-check
/**
 * account-metrics-store — 账号级作品数据回流的存储层（mixin）
 *
 * 表沿用既有的 `tracked_content` / `performance_snapshot`，**不新造表**。理由（PRD §四）：
 * 该表已有五项字段、已有 `(tracked_content_id, captured_at)` 索引、已有一处聚合真源
 * （`performance-overview.js`）与两个读侧（发布记录页 / 数据看板）。新表会立刻产生第二份真源
 * 与两处口径漂移。
 *
 * 本 mixin 只做四件事，业务判据（谁跟谁关联）在 services/account-metrics/link.js：
 *   ① 读该归属下的 tracked 行（供归因）；
 *   ② 把归因结果落成快照 + 回填 post_id（**只补空值**，V14）；
 *   ③ 按 tracked id 批量取「每行最新一份快照」（修 D1/D2 的读侧缺陷）；
 *   ④ 读写账号级采集状态（last_run_at / 各账号结果）。
 *
 * ⛔ 幂等键（V13）：快照主键 = `acct:<trackedId>:<UTC 日>`。同一作品同一天同一来源只保留一份，
 * 用户连点刷新不会堆 N 行，也不会让「日增趋势」把同一天的多次采集算成多天增量。
 */
'use strict'

const log = require('../logger')
const { LEGACY_OWNER_SUBJECT } = require('../store-schema')
// 公开内容页解析器：本文件只用它回答一个问题 ——「这个 post_id 能不能定位到作品」。
// 与渲染端作品链接、platform-metrics 的 resolveContentUrl **同源**，不另写一份形态正则。
const { resolvePublishedContentUrl } = require('@multi-publish/shared-utils/src/published-content-url')

/** 账号级采集状态的 settings 键（按归属分桶，见 settings-store 的 getUserSetting）。 */
const STATE_KEY = 'account_metrics_sync_state'

/**
 * 该作品 ID 是否**能定位到公开作品**。
 * 合成值（`published-<时间戳>` 等成功信号）与形态不合的值一律 false —— 它们非空，
 * 但拼不出任何真实内容页。
 * @param {string} platform
 * @param {string} postId
 * @returns {boolean}
 */
function isUsableWorkId (platform, postId) {
  try {
    return resolvePublishedContentUrl({ platform, postId }).source !== 'none'
  } catch (_) {
    return false
  }
}

/**
 * 归属谓词。与 performance-loop-store 的 `_ownerPredicate` **逐字同口径**：
 * 身份可解析 → 只取该 subject；无身份服务（legacy 档）→ 只取无归属桶
 * （NULL / 空串 / __legacy__），绝不把已归属账号的数据端给匿名态。
 * @param {string|undefined|null} ownerSubject
 * @param {string} alias
 */
function ownerPredicate (ownerSubject, alias) {
  const prefix = alias ? alias + '.' : ''
  const owner = typeof ownerSubject === 'string' && ownerSubject.trim() ? ownerSubject.trim() : null
  if (owner) return { sql: prefix + 'owner_subject = ?', params: [owner] }
  return {
    sql: '(' + prefix + 'owner_subject IS NULL OR TRIM(' + prefix + 'owner_subject) = ? OR ' + prefix + 'owner_subject = ?)',
    params: ['', LEGACY_OWNER_SUBJECT],
  }
}

/** UTC 日键（与 throttle.js 同口径；两处都必须按 UTC 日折叠，否则跨零点会多出一份）。 */
function utcDayKey (nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10)
}

module.exports = {
  /**
   * 该归属下的 tracked 行（供归因）。列取最小集，避免宽表漂移无人察觉。
   * @param {string|undefined|null} ownerSubject
   * @param {number} [limit]
   */
  listTrackedForAccountSync (ownerSubject, limit) {
    if (!this._ready) return { rows: [], total: 0, truncated: false }
    const cap = Number(limit) > 0 ? Number(limit) : 5000
    const pred = ownerPredicate(ownerSubject, '')
    try {
      const totalRow = this.db.prepare('SELECT COUNT(*) AS n FROM tracked_content WHERE ' + pred.sql).get(...pred.params)
      const total = totalRow ? Number(totalRow.n) || 0 : 0
      const rows = this.db.prepare(
        'SELECT id, platform, post_id, url, publish_history_id, recrawl_status, owner_subject, created_at ' +
        'FROM tracked_content WHERE ' + pred.sql + ' ORDER BY created_at DESC, rowid DESC LIMIT ?',
      ).all(...pred.params, cap)
      return { rows, total, truncated: total > rows.length }
    } catch (e) {
      log.warn('Store', 'listTrackedForAccountSync failed: ' + e.message)
      return { rows: [], total: 0, truncated: false, error: e.message }
    }
  },

  /**
   * 落盘一次账号级采集结果：写快照 + 回填关联键。
   *
   * @param {object} input
   * @param {Array<{trackedId: string, work: {platform: string, postId: string, metrics: object}}>} input.links
   * @param {string|undefined|null} input.ownerSubject
   * @param {number} [input.nowMs]
   * @returns {{written: number, backfilled: number, skipped: number}}
   */
  applyAccountSyncLinks (input) {
    const out = { written: 0, backfilled: 0, skipped: 0 }
    if (!this._ready) return out
    const links = Array.isArray(input && input.links) ? input.links : []
    if (links.length === 0) return out
    const ownerSubject = input && input.ownerSubject
    const nowMs = Number.isFinite(input && input.nowMs) ? input.nowMs : Date.now()
    const capturedAt = new Date(nowMs).toISOString()
    const day = utcDayKey(nowMs)
    const source = (input && input.source) || 'account_sync'
    const pred = ownerPredicate(ownerSubject, '')

    for (const link of links) {
      const trackedId = String((link && link.trackedId) || '')
      const work = (link && link.work) || null
      if (!trackedId || !work) { out.skipped += 1; continue }
      const postId = String(work.postId || '').trim()
      if (!postId) { out.skipped += 1; continue }

      try {
        // 写入前必须确认该行属于当前归属：owner 过滤不能只靠上游（fail closed）
        const row = this.db.prepare(
          'SELECT id, platform, post_id, url FROM tracked_content WHERE id = ? AND ' + pred.sql,
        ).get(trackedId, ...pred.params)
        if (!row) { out.skipped += 1; continue }

        // V14：只补空值，绝不覆盖既有 post_id（既有值可能来自平台发布回传，强度更高）。
        // 2026-10-15 补充：V14 想保护的是「**能定位到作品**的既有值」，而不是「非空的既有值」。
        // 快手链路在拿不到真 id 时会把合成成功信号 `published-<时间戳>` 写进 post_id
        // （rpa-view-platforms.js），它拼不出任何公开页、却因为非空永久占住这一格 ——
        // 账号级采集明明拿到了真 photoId（platform-metrics/adapters），却永远补不进去，
        // 于是快手发布记录的作品链接**恒为无链接**（用户报障「链接功能一直没生效」）。
        // 现在：既有值不可用、且新值可用时才覆盖；两个条件缺一不可（否则会把真值降级成假值）。
        const existingPostId = String(row.post_id || '').trim()
        const canBackfill = !existingPostId ||
          (!isUsableWorkId(row.platform, existingPostId) && isUsableWorkId(row.platform, postId))
        if (canBackfill && existingPostId !== postId) {
          this.db.prepare('UPDATE tracked_content SET post_id = ? WHERE id = ? AND ' + pred.sql)
            .run(postId, trackedId, ...pred.params)
          out.backfilled += 1
        }

        const m = work.metrics || {}
        const toVal = (v) => (Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null)

        // ⛔ 「平台没给这个字段」不得把已知值抹成 0（QM-6 后端轴 CRITICAL，已实测）：
        // 账号级采集对平台不返回的列写 NULL，而共用聚合口径 `readMetric(null) → 0` 且读侧
        // 「最新一份 wins」不带来源优先级 —— 于是后跑的这一份会把另一条链（手工录入 / 公开页回采）
        // 已确立的真实值在读侧整体折成 0，还会算出一笔假的「负差 retreat」。
        // 实测现场：auto(50 likes / 30 favorites) + account_sync(null) ⇒ totals 归零、retreats=1。
        // 正解是**按字段继承**：本次为空的列，取该作品最近一份快照里的非空值。
        const prev = this.db.prepare(
          'SELECT views, likes, comments, favorites, shares FROM performance_snapshot ' +
          'WHERE tracked_content_id = ? ORDER BY captured_at DESC, rowid DESC LIMIT 1',
        ).get(trackedId) || {}
        const inherit = (fresh, old) => (fresh === null && Number.isFinite(old) && old >= 0 ? Math.trunc(old) : fresh)

        // V13：确定性主键 ⇒ 同日同源重复写自动折叠为一份（INSERT OR REPLACE）
        const snapId = 'acct:' + trackedId + ':' + day
        this.db.prepare(`
          INSERT OR REPLACE INTO performance_snapshot
            (id, tracked_content_id, source, views, likes, comments, favorites, shares, raw, captured_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          snapId,
          trackedId,
          source,
          inherit(toVal(m.views), prev.views),
          inherit(toVal(m.likes), prev.likes),
          inherit(toVal(m.comments), prev.comments),
          inherit(toVal(m.favorites), prev.favorites),
          inherit(toVal(m.shares), prev.shares),
          // raw 只放可公开的诊断信息：**绝不写 Cookie / 账号凭证**
          JSON.stringify({ channel: 'account_sync', level: link.level || 0 }),
          capturedAt,
        )
        out.written += 1
      } catch (e) {
        out.skipped += 1
        log.warn('Store', 'applyAccountSyncLinks failed for ' + trackedId + ': ' + e.message)
      }
    }
    return out
  },

  /**
   * 批量取「每行最新一份快照」（修 D1/D2：此前渲染端只拉前 100 条 tracked，
   * 历史更早的记录永远取不到）。按 owner 过滤，用 JOIN 而不是信任调用方传来的 id 列表。
   *
   * @param {string[]} trackedIds
   * @param {string|undefined|null} ownerSubject
   * @param {number} [maxIds]
   * @returns {{rows: Array<object>, missing: string[]}}
   */
  getLatestSnapshotsForTrackedIds (trackedIds, ownerSubject, maxIds) {
    const ids = (Array.isArray(trackedIds) ? trackedIds : [])
      .map(id => String(id == null ? '' : id).trim())
      .filter(Boolean)
    const cap = Number(maxIds) > 0 ? Number(maxIds) : 500
    const unique = Array.from(new Set(ids)).slice(0, cap)
    if (!this._ready || unique.length === 0) return { rows: [], missing: unique }
    const pred = ownerPredicate(ownerSubject, 't')
    const placeholders = unique.map(() => '?').join(', ')
    try {
      const rows = this.db.prepare(
        'SELECT s.tracked_content_id AS tracked_content_id, s.views AS views, s.likes AS likes, ' +
        's.comments AS comments, s.favorites AS favorites, s.shares AS shares, ' +
        's.captured_at AS captured_at, s.source AS source, s.rowid AS _rid ' +
        'FROM performance_snapshot s JOIN tracked_content t ON t.id = s.tracked_content_id ' +
        'WHERE s.tracked_content_id IN (' + placeholders + ') AND ' + pred.sql + ' ' +
        'ORDER BY s.tracked_content_id ASC, s.captured_at DESC, s.rowid DESC',
      ).all(...unique, ...pred.params)

      const latest = new Map()
      for (const row of rows) {
        const key = String(row.tracked_content_id)
        if (latest.has(key)) continue // 已按 (captured_at DESC, rowid DESC) 排序 ⇒ 首条即最新
        latest.set(key, {
          trackedContentId: key,
          views: row.views,
          likes: row.likes,
          comments: row.comments,
          favorites: row.favorites,
          shares: row.shares,
          capturedAt: row.captured_at,
          source: row.source,
        })
      }
      const missing = unique.filter(id => !latest.has(id))
      return { rows: Array.from(latest.values()), missing }
    } catch (e) {
      log.warn('Store', 'getLatestSnapshotsForTrackedIds failed: ' + e.message)
      return { rows: [], missing: unique, error: e.message }
    }
  },

  /**
   * 发布记录页的**唯一**指标读口：按发布任务 id 批量取指标 + 最新快照时间 + 真实作品 ID。
   *
   * 存在的理由（PRD §1.2 D1/D2）：原实现是「渲染端拉前 100 条 tracked，自己在内存里按
   * publish_history_id 配对」。那条路有两个结构性缺陷：① `performance:list-tracked` 不按归属过滤
   * 且只取第一页，历史早于第 100 条的作品永远取不到；② 归属过滤放在渲染端等于没有。
   * 现在把 join 收回主进程：一次 SQL 完成「任务 id → tracked 行 → 最新快照」，渲染端只消费结果。
   *
   * 返回体里带 `postId`，是因为发布记录页还依赖它推导可点开的公开内容页 —— 账号级采集
   * 回填的真实作品 ID 正是让「点不动的卡片」恢复可点的那份证据。
   *
   * @param {string[]} taskIds 发布任务 id 列表（= tracked_content.publish_history_id）
   * @param {string|undefined|null} ownerSubject
   * @param {number} [maxIds]
   * @returns {{metrics: Record<string, object>, missing: string[]}}
   */
  getHistoryMetricsByTaskIds (taskIds, ownerSubject, maxIds) {
    const ids = (Array.isArray(taskIds) ? taskIds : [])
      .map(id => String(id == null ? '' : id).trim())
      .filter(Boolean)
    const cap = Number(maxIds) > 0 ? Number(maxIds) : 500
    const unique = Array.from(new Set(ids)).slice(0, cap)
    // ⛔ 截断必须**说出来**（QM-6 后端轴 MAJOR）：此前超出 cap 的 taskId 连 `missing` 都不含，
    // 调用方无法区分「这条记录没采过」与「这条被上限丢掉了」——那正是本 PR 要修的 D2
    // （「只拉 100 条」）换个数字重演。渲染端已按同一上限分批调用，本字段是给其他调用方的兜底。
    const truncated = ids.length > cap
    if (!this._ready || unique.length === 0) return { metrics: {}, missing: unique, truncated: false }
    const pred = ownerPredicate(ownerSubject, '')
    const placeholders = unique.map(() => '?').join(', ')
    try {
      const rows = this.db.prepare(
        'SELECT id, platform, post_id, url, publish_history_id FROM tracked_content ' +
        'WHERE publish_history_id IN (' + placeholders + ') AND ' + pred.sql,
      ).all(...unique, ...pred.params)
      const metrics = {}
      const byTask = new Map()
      for (const row of rows) {
        const key = String(row.publish_history_id || '')
        // 同一 taskId 命中多行时取第一条（发布任务与 tracked 行本应 1:1；出现多行是数据异常，
        // 不猜也不静默丢弃——把第一条给出并让 missing 逻辑保持确定性）
        if (!key || byTask.has(key)) continue
        byTask.set(key, row)
      }
      const snapshots = this.getLatestSnapshotsForTrackedIds(Array.from(byTask.values()).map(r => String(r.id)), ownerSubject, cap)
      const snapById = new Map(snapshots.rows.map(s => [String(s.trackedContentId), s]))
      for (const [taskId, row] of byTask.entries()) {
        const snap = snapById.get(String(row.id))
        if (!snap) continue
        metrics[taskId] = {
          trackedId: String(row.id),
          platform: String(row.platform || ''),
          postId: String(row.post_id || ''),
          url: String(row.url || ''),
          views: snap.views,
          likes: snap.likes,
          comments: snap.comments,
          favorites: snap.favorites,
          shares: snap.shares,
          capturedAt: snap.capturedAt,
          source: snap.source,
        }
      }
      return { metrics, missing: unique.filter(id => !metrics[id]), truncated }
    } catch (e) {
      log.warn('Store', 'getHistoryMetricsByTaskIds failed: ' + e.message)
      return { metrics: {}, missing: unique, truncated, error: e.message }
    }
  },

  /**
   * 取账号级采集状态（按归属分桶）。读失败返回 null 而不是空对象——
   * 「没采过」与「读不到状态」在界面上是两种结论。
   */
  getAccountSyncState (ownerSubject) {
    if (!this._ready) return null
    try {
      const raw = typeof this.getUserSetting === 'function'
        ? this.getUserSetting(STATE_KEY, null, ownerSubject)
        : null
      if (!raw) return null
      return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch (e) {
      log.warn('Store', 'getAccountSyncState failed: ' + e.message)
      return null
    }
  },

  /** 写账号级采集状态。失败出声但不抛错（状态写不进去不该让整轮采集报错）。 */
  setAccountSyncState (state, ownerSubject) {
    if (!this._ready) return false
    try {
      if (typeof this.setUserSetting !== 'function') return false
      this.setUserSetting(STATE_KEY, JSON.stringify(state || {}), ownerSubject)
      return true
    } catch (e) {
      log.warn('Store', 'setAccountSyncState failed: ' + e.message)
      return false
    }
  },
}
