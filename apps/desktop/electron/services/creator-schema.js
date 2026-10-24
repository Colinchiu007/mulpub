/**
 * creator-schema.js — 博主监控与采集的数据结构与迁移
 *
 * ## 为什么独立成文件
 *
 * `store-schema.js` 受「债务熔断」约束不得突破 500 行（见该文件 activate-viral-library
 * 处的注释），本特性新增 3 张表 + 1 个跨表迁移，放进去必然超限。
 * 沿用 `activate-viral-schema.js` 的既有模式：表 DDL 与迁移都在此文件，
 * `store-schema.js` 只做 require 与数组拼接。
 *
 * ## 为什么 viral_library 的索引必须是 partial
 *
 * `viral_library` 是存量表，`external_id` 是本特性新增列且默认空串。
 * 若建普通 `UNIQUE(platform, external_id)`，**存量行的该列全为空串 → 创建索引瞬间
 * 因重复键抛错 → schema 初始化整体失败 → 应用起不来**。
 * `WHERE external_id <> ''` 把存量行排除在索引外，升级零影响。
 *
 * ## 为什么迁移必须单事务
 *
 * 本迁移同时做「加列」与「建跨表索引」两件事。若中途失败留下半迁移状态
 * （列加了索引没建，或反之），`CREATE TABLE IF NOT EXISTS` 与
 * `CREATE INDEX IF NOT EXISTS` 都**不会补做**，形成需要手工干预的死锁。
 * 故整段包在 BEGIN/COMMIT 里，失败即整体 ROLLBACK：整次迁移原子完成，
 * 或完全不发生。
 */

'use strict'

const CREATOR_TABLES = [
  // ── 博主实体 ──────────────────────────────────────────────
  // external_id 为平台 canonical ID（YouTube 的 UC…），禁止存用户原始输入，
  // 否则同一频道的 4 种 URL 写法会拆成 4 行。
  `CREATE TABLE IF NOT EXISTS creator_accounts (
    id               TEXT PRIMARY KEY,
    platform         TEXT NOT NULL,
    external_id      TEXT NOT NULL,
    display_name     TEXT DEFAULT '',
    handle           TEXT DEFAULT '',
    avatar_url       TEXT DEFAULT '',
    platform_url     TEXT DEFAULT '',
    capability_tier  TEXT NOT NULL DEFAULT 'official',
    credential_alias TEXT DEFAULT '',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_accounts_uniq
    ON creator_accounts(platform, external_id)`,

  // ── 关注关系 + 监控配置 + 运行状态 ──────────────────────────
  // status: active | paused_by_user | auto_paused | fatal_paused
  `CREATE TABLE IF NOT EXISTS creator_follows (
    id                   TEXT PRIMARY KEY,
    creator_id           TEXT NOT NULL,
    platform             TEXT NOT NULL,
    enabled              INTEGER NOT NULL DEFAULT 1,
    check_interval_min   INTEGER NOT NULL DEFAULT 60,
    per_creator_limit    INTEGER,
    status               TEXT NOT NULL DEFAULT 'active',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_checked_at      TEXT,
    last_success_at      TEXT,
    last_error_code      TEXT,
    last_error_message   TEXT,
    paused_reason        TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_follows_uniq
    ON creator_follows(creator_id)`,
  `CREATE INDEX IF NOT EXISTS idx_creator_follows_scan
    ON creator_follows(status, enabled)`,

  // ── 发现的视频（未采集） ────────────────────────────────────
  // collect_state: pending | collecting | collected | failed | skipped
  // claim_token 是单调递增的 fencing token：租约过期后旧 worker 的提交必须被拒，
  // 否则会覆盖新持有者的结果（lost update）。
  `CREATE TABLE IF NOT EXISTS creator_discoveries (
    id                TEXT PRIMARY KEY,
    creator_id        TEXT NOT NULL,
    platform          TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    title             TEXT DEFAULT '',
    url               TEXT NOT NULL,
    thumbnail_url     TEXT DEFAULT '',
    published_at      TEXT,
    discovered_at     TEXT NOT NULL,
    collect_state     TEXT NOT NULL DEFAULT 'pending',
    collected_at      TEXT,
    attempt_count     INTEGER NOT NULL DEFAULT 0,
    claim_token       INTEGER NOT NULL DEFAULT 0,
    claimed_by        TEXT DEFAULT '',
    lease_expires_at  INTEGER,
    retry_after_at    INTEGER,
    last_error        TEXT DEFAULT '',
    transcript_source TEXT DEFAULT '',
    content_quality   TEXT DEFAULT 'unknown',
    summary           TEXT DEFAULT '',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_discoveries_uniq
    ON creator_discoveries(platform, external_id)`,
  `CREATE INDEX IF NOT EXISTS idx_creator_discoveries_list
    ON creator_discoveries(creator_id, collect_state, discovered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_creator_discoveries_stale
    ON creator_discoveries(collect_state, lease_expires_at)`,
]

/** 跨表最终化队列（outbox）：与业务写入同事务落盘，是「已提交但未最终化」的唯一真源。 */
const CREATOR_OUTBOX_SQL = [
  `CREATE TABLE IF NOT EXISTS collection_outbox (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    ref_id        TEXT NOT NULL,
    payload_json  TEXT DEFAULT '{}',
    state         TEXT NOT NULL DEFAULT 'pending',   -- pending | done | failed | dead_letter | cancelled
    retry_count   INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_collection_outbox_state
    ON collection_outbox(state, next_retry_at)`,
  `CREATE INDEX IF NOT EXISTS idx_collection_outbox_ref
    ON collection_outbox(ref_id, state)`,

  // 配额账本：崩溃 / 改系统时间 / 强杀后，内存计数会与真实消耗脱账。
  // 计数真源是这张表，内存仅作缓存。
  `CREATE TABLE IF NOT EXISTS collection_quota_ledger (
    day         TEXT NOT NULL,
    kind        TEXT NOT NULL,                    -- probe | collect
    units       INTEGER NOT NULL DEFAULT 0,
    request_sig TEXT NOT NULL,                    -- 幂等键，崩溃重发不重复计费
    created_at  TEXT NOT NULL,
    PRIMARY KEY (day, kind, request_sig)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_collection_quota_day
    ON collection_quota_ledger(day, kind)`,
]

const CREATOR_TABLE_SQL = CREATOR_TABLES.concat(CREATOR_OUTBOX_SQL)

/**
 * 迁移前冲突预检：返回存在重复 (platform, external_id) 的分组。
 *
 * ⛔ 不得无条件去查 `external_id`：这条预检跑在**加列的 ALTER 之前**，而一个尚未升级的库
 * （或 PRAGMA 读不到该列的库）里这一列根本不存在 ⇒ 每次新库首次启动都要发一条**结构上注定失败**
 * 的查询。过去用 `catch (_) { return [] }` 兜住，但兜的位置在 sqlite-wrapper 里——它先
 * `log.error` 再返回空，于是打包启动日志每次都留下一条
 * `no such column: external_id` 的假 ERROR（2026-10-18 两次复现）。
 * 判据一律先看列在不在（与下面的迁移用同一个 PRAGMA 口径），缺列直接返回空。
 */
function viralLibraryColumns (db) {
  try {
    return db.prepare('PRAGMA table_info(viral_library)').all().map(c => c.name)
  } catch (_) {
    return []   // 连 PRAGMA 都读不到（表还不存在）⇒ 无行即无重复
  }
}

function findViralLibraryConflicts (db) {
  if (!viralLibraryColumns(db).includes('external_id')) return []
  try {
    return db.prepare(
      `SELECT platform, external_id, COUNT(*) AS n FROM viral_library
        WHERE external_id <> '' AND external_id IS NOT NULL
        GROUP BY platform, external_id HAVING n > 1`
    ).all() || []
  } catch (err) {
    // 列在位却查失败 = 真故障（磁盘 I/O、库损坏），不得与"缺列"共用一条静默出口
    console.warn(`[creator-schema] viral_library 冲突预检查询失败：${err && err.message}`)
    return []
  }
}

/**
 * 为存量 viral_library 补 external_id / creator_id 两列，并建 partial 索引。
 * 幂等：列已存在则跳过；整段单事务，失败即整体回滚。
 */
function migrateCreatorLinkageSchema (db, execSchemaSql) {
  const rows = findViralLibraryConflicts(db)
  if (rows.length) {
    // 不静默去重——擅自删行即数据损失。抛错让启动失败，由人决定保留哪条。
    const detail = rows.slice(0, 5).map(r => `${r.platform}:${r.external_id}x${r.n}`).join(', ')
    throw new Error(
      `viral_library 存在 ${rows.length} 组重复 (platform, external_id)：${detail}` +
      `。为避免误删数据，迁移已中止；请人工清理后重试。`
    )
  }

  const run = (sql) => {
    if (typeof db.execOrThrow === 'function') db.execOrThrow(sql)
    else if (typeof execSchemaSql === 'function') execSchemaSql(db, sql)
    else db.exec(sql)
  }

  // BEGIN 失败（如「cannot start a transaction within a transaction」）时降级为无事务执行，
  // 不因环境限制让整个迁移失败。
  let began = false
  try { run('BEGIN'); began = true } catch (_) { /* 无事务能力，降级直跑 */ }

  try {
    // 与上面的预检共用同一个 PRAGMA 口径（两份"列在不在"的判断必须同形）
    const cols = viralLibraryColumns(db)
    for (const [name, ddl] of [
      ['external_id', 'ALTER TABLE viral_library ADD COLUMN external_id TEXT DEFAULT \'\''],
      ['creator_id', 'ALTER TABLE viral_library ADD COLUMN creator_id TEXT DEFAULT \'\''],
    ]) {
      if (!cols.includes(name)) run(ddl)
    }
    // ⚠ partial：存量行该列为空串，普通 UNIQUE 会在建索引瞬间因重复键抛错致应用起不来
    run('CREATE UNIQUE INDEX IF NOT EXISTS idx_viral_library_external '
      + 'ON viral_library(platform, external_id) WHERE external_id <> \'\'')
    run('CREATE INDEX IF NOT EXISTS idx_viral_library_creator '
      + 'ON viral_library(creator_id) WHERE creator_id <> \'\'')
    if (began) run('COMMIT')
  } catch (err) {
    if (began) { try { run('ROLLBACK') } catch (_) { /* 回滚失败时保留原始错误 */ } }
    throw err
  }
}

module.exports = {
  CREATOR_TABLE_SQL,
  CREATOR_TABLES,
  CREATOR_OUTBOX_SQL,
  findViralLibraryConflicts,
  migrateCreatorLinkageSchema,
}