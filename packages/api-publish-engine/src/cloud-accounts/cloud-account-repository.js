'use strict'
/**
 * cloud-account-repository.js — 云端账号镜像的数据访问层（PRD §6.1 / §7）。
 *
 * 三条硬约束：
 *   1) **归属只能由入参 userId 决定**，且每条 SQL 都带 `user_id = $1`（PRD 验收标准 9：
 *      A 身份读不到 B 身份的任何记录）。没有任何「按 id 直取」的旁路方法。
 *   2) **全部参数化**，用户输入（platform / uid / 昵称 / base64 信封）一律走 `$n` 占位符，
 *      永不字符串拼接（test 里有逐条断言）。
 *   3) `upsertMany` **逐条独立裁决**：PRD §7.2「一条失败 MUST NOT 整批回滚」，
 *      所以这里刻意不开事务、不 `pool.connect()`，一条一个语句序列；
 *      幂等靠唯一约束 `(user_id, platform, platform_uid)` + 内容比较，
 *      `unchanged` 一条写请求都不发（AGENTS.md「无定论不得发冗余写」同源纪律）。
 *
 * pg 会把 BIGINT 以字符串回读（followers: '12345'），比较一律走本文件的归一化器，
 * 否则每轮同步都会把没变的账号判成 `updated`，白刷一次 updated_at。
 */

const { safeErrorCode } = require('../auth/safe-error-code')
const { ENVELOPE_ALG, ENVELOPE_VERSION } = require('./envelope-crypto')
const { accountError, isPlainObject, MAX_UID_LENGTH, CONTROL_CHARS, MAX_BATCH_SIZE } = require('./validate-account')

const CLOUD_ACCOUNT_COLUMNS = `id, user_id, platform, platform_uid, display_name, account_name, avatar, followers,
  is_active, credential_digest, last_reported_status, credential_updated_at, metadata_updated_at,
  last_sync_device_label, created_at, updated_at`

/** 摘要：分组计数 + 该组最后变更时刻，一次拿全（total 由调用方求和，不再发第二条 COUNT）。 */
const SELECT_DIGEST = `SELECT platform, COUNT(*)::int AS count, MAX(updated_at) AS updated_at
   FROM cloud_accounts WHERE user_id = $1
   GROUP BY platform
   ORDER BY count DESC, platform ASC`

const SELECT_TOMBSTONE_COUNT = 'SELECT COUNT(*)::int AS count FROM cloud_account_tombstones WHERE user_id = $1'

/** 合并视图：刻意不取 credential_ciphertext / credential_iv / credential_auth_tag / encrypted_data_key。 */
const SELECT_FULL = `SELECT ${CLOUD_ACCOUNT_COLUMNS}
   FROM cloud_accounts WHERE user_id = $1
   ORDER BY platform ASC, platform_uid ASC`

const SELECT_TOMBSTONES = `SELECT platform, platform_uid, deleted_at
   FROM cloud_account_tombstones WHERE user_id = $1
   ORDER BY platform ASC, platform_uid ASC`

const SELECT_ROW = `SELECT ${CLOUD_ACCOUNT_COLUMNS}
   FROM cloud_accounts WHERE user_id = $1 AND platform = $2 AND platform_uid = $3`

const SELECT_CREDENTIALS = `SELECT platform, platform_uid, credential_iv, credential_ciphertext,
    credential_auth_tag, encrypted_data_key, credential_digest, credential_updated_at
   FROM cloud_accounts
   WHERE user_id = $1
     AND (platform, platform_uid) IN (SELECT p, u FROM unnest($2::text[], $3::text[]) AS t(p, u))
   ORDER BY platform ASC, platform_uid ASC`

const INSERT_ACCOUNT = `INSERT INTO cloud_accounts
    (user_id, platform, platform_uid, display_name, account_name, avatar, followers, is_active,
     credential_ciphertext, credential_iv, credential_auth_tag, encrypted_data_key, credential_digest,
     last_reported_status, credential_updated_at, metadata_updated_at, last_sync_device_label, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz, $16::timestamptz, $17,
     COALESCE($18::timestamptz, NOW()))
   ON CONFLICT (user_id, platform, platform_uid) DO NOTHING
   RETURNING id`

/** `updated_at = NOW()` 只出现在真正写库的分支；`unchanged` 走不到这里。 */
const UPDATE_ACCOUNT = `UPDATE cloud_accounts SET
     display_name = $4, account_name = $5, avatar = $6, followers = $7, is_active = $8,
     credential_ciphertext = $9, credential_iv = $10, credential_auth_tag = $11,
     encrypted_data_key = $12, credential_digest = $13, last_reported_status = $14,
     credential_updated_at = $15::timestamptz, metadata_updated_at = $16::timestamptz,
     last_sync_device_label = $17, updated_at = NOW()
   WHERE user_id = $1 AND platform = $2 AND platform_uid = $3
   RETURNING id`

const INSERT_TOMBSTONE = `INSERT INTO cloud_account_tombstones (user_id, platform, platform_uid)
   VALUES ($1, $2, $3)
   ON CONFLICT (user_id, platform, platform_uid) DO NOTHING
   RETURNING id`

const DELETE_ACCOUNTS = 'DELETE FROM cloud_accounts WHERE user_id = $1 RETURNING id'
const DELETE_TOMBSTONES = 'DELETE FROM cloud_account_tombstones WHERE user_id = $1 RETURNING id'

/** 删完必须回读：PRD §7.4 要求把「没清干净」如实上报，不能拿 DELETE 的返回值当已清空。 */
const SELECT_RESIDUAL = `SELECT
    (SELECT COUNT(*) FROM cloud_accounts WHERE user_id = $1) AS accounts,
    (SELECT COUNT(*) FROM cloud_account_tombstones WHERE user_id = $1) AS tombstones`

function text(value) {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

function bool(value) {
  return value === true || value === 't' || value === 't ' || value === 1 || value === '1'
}

/** pg 的 int8 以字符串回读，与 Number 比较前统一成字符串（null 保持 null，不与 0 混同）。 */
function intText(value) {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

function isoTime(value) {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function countAffected(result) {
  if (!result) return 0
  if (Number.isFinite(result.rowCount)) return result.rowCount
  return Array.isArray(result.rows) ? result.rows.length : 0
}

function toCount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function assertUserId(userId) {
  if (typeof userId !== 'string' || !userId.trim() || CONTROL_CHARS.test(userId)) {
    throw accountError('BUSINESS_USER_REQUIRED', 503)
  }
  return userId.trim()
}

function assertKey(platform, platformUid, label) {
  if (typeof platformUid !== 'string' || !platformUid.trim() || platformUid.trim().length > MAX_UID_LENGTH
    || CONTROL_CHARS.test(platformUid)) {
    throw accountError('ACCOUNT_UID_INVALID', 400, label)
  }
  if (typeof platform !== 'string' || !platform.trim() || CONTROL_CHARS.test(platform)) {
    throw accountError('ACCOUNT_PLATFORM_UNSUPPORTED', 400, label)
  }
  return { platform: platform.trim(), platformUid: platformUid.trim() }
}

/**
 * 写库前的最低限度自校验：归属、合并键、信封四元组与摘要。
 * 完整业务校验在 validate-account.js（handlers 已跑过一遍）；这里再拦一次是防「绕过 handlers
 * 直接 require repository」把半条记录写进真源——repository 是最后一道门。
 */
function assertWritable(userId, item) {
  assertUserId(userId)
  if (!isPlainObject(item)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  const key = assertKey(item.platform, item.platformUid)
  const envelope = item.credential
  if (!isPlainObject(envelope)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  for (const field of ['iv', 'ciphertext', 'tag', 'encryptedDataKey']) {
    if (!Buffer.isBuffer(envelope[field]) || envelope[field].length === 0) {
      throw accountError('CREDENTIAL_SHAPE_INVALID', 400, field)
    }
  }
  if (typeof item.credentialDigest !== 'string' || !item.credentialDigest) {
    throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  }
  if (!item.metadataUpdatedAt || !item.credentialUpdatedAt) throw accountError('ACCOUNT_TIMESTAMP_INVALID', 400)
  return {
    ...key,
    displayName: text(item.displayName),
    accountName: text(item.accountName),
    avatar: text(item.avatar),
    followers: intText(item.followers),
    isActive: item.isActive === undefined ? true : Boolean(item.isActive),
    credentialDigest: item.credentialDigest,
    credentialUpdatedAt: item.credentialUpdatedAt,
    metadataUpdatedAt: item.metadataUpdatedAt,
    createdAt: item.createdAt || null,
    lastReportedStatus: text(item.lastReportedStatus),
    lastSyncDeviceLabel: text(item.lastSyncDeviceLabel),
    envelope,
  }
}

/** 内容是否等价：digest + 全部元数据列。时间戳列不参与（它们是客户端上报的镜像值，不是内容）。 */
function sameRecord(existing, record) {
  return (existing.credential_digest || null) === record.credentialDigest
    && text(existing.display_name) === record.displayName
    && text(existing.account_name) === record.accountName
    && text(existing.avatar) === record.avatar
    && intText(existing.followers) === record.followers
    && bool(existing.is_active) === record.isActive
    && text(existing.last_reported_status) === record.lastReportedStatus
    && text(existing.last_sync_device_label) === record.lastSyncDeviceLabel
}

function mapAccount(row) {
  return {
    platform: row.platform,
    platformUid: row.platform_uid,
    displayName: text(row.display_name),
    accountName: text(row.account_name),
    avatar: text(row.avatar),
    followers: intText(row.followers) === null ? null : Number(row.followers),
    isActive: bool(row.is_active),
    credentialDigest: text(row.credential_digest),
    credentialUpdatedAt: isoTime(row.credential_updated_at),
    metadataUpdatedAt: isoTime(row.metadata_updated_at),
    lastReportedStatus: text(row.last_reported_status),
  }
}

function mapTombstone(row) {
  return { platform: row.platform, platformUid: row.platform_uid, deletedAt: isoTime(row.deleted_at) }
}

function insertParams(userId, record) {
  return [
    userId, record.platform, record.platformUid, record.displayName, record.accountName, record.avatar,
    record.followers, record.isActive,
    record.envelope.ciphertext, record.envelope.iv, record.envelope.tag, record.envelope.encryptedDataKey,
    record.credentialDigest, record.lastReportedStatus, record.credentialUpdatedAt, record.metadataUpdatedAt,
    record.lastSyncDeviceLabel, record.createdAt,
  ]
}

function updateParams(userId, record) {
  return [
    userId, record.platform, record.platformUid, record.displayName, record.accountName, record.avatar,
    record.followers, record.isActive,
    record.envelope.ciphertext, record.envelope.iv, record.envelope.tag, record.envelope.encryptedDataKey,
    record.credentialDigest, record.lastReportedStatus, record.credentialUpdatedAt, record.metadataUpdatedAt,
    record.lastSyncDeviceLabel,
  ]
}

function createCloudAccountRepository(options = {}) {
  const pool = options.pool
  if (!isPlainObject(pool) || typeof pool.query !== 'function') {
    throw new TypeError('createCloudAccountRepository 需要 PostgreSQL 连接池（pool.query）')
  }
  const query = (sql, params) => pool.query(sql, params)

  async function readRow(userId, platform, platformUid) {
    const result = await query(SELECT_ROW, [userId, platform, platformUid])
    return (result && result.rows && result.rows[0]) || null
  }

  async function writeInsert(userId, record) {
    const result = await query(INSERT_ACCOUNT, insertParams(userId, record))
    return countAffected(result) > 0 || Boolean(result && result.rows && result.rows[0])
  }

  async function writeUpdate(userId, record) {
    const result = await query(UPDATE_ACCOUNT, updateParams(userId, record))
    return countAffected(result) > 0 || Boolean(result && result.rows && result.rows[0])
  }

  /** 一条一个独立裁决序列；任何一步抛错只影响这一条。 */
  async function upsertOne(userId, rawItem) {
    const record = assertWritable(userId, rawItem)
    const existing = await readRow(userId, record.platform, record.platformUid)
    if (existing) {
      if (sameRecord(existing, record)) return { outcome: 'unchanged' }
      if (await writeUpdate(userId, record)) return { outcome: 'updated' }
    }
    if (await writeInsert(userId, record)) return { outcome: 'created' }
    // INSERT 被唯一约束挡下（并发同一合并键）：回读再按内容裁决一次，绝不「猜成 created」。
    const afterConflict = await readRow(userId, record.platform, record.platformUid)
    if (!afterConflict) throw accountError('ACCOUNT_WRITE_FAILED', 500)
    if (sameRecord(afterConflict, record)) return { outcome: 'unchanged' }
    return { outcome: (await writeUpdate(userId, record)) ? 'updated' : 'unchanged' }
  }

  return {
    /** GET ?view=digest（PRD §7.1）：`{ total, byPlatform[], tombstones, updatedAt }`。 */
    async listDigest(userId) {
      const owner = assertUserId(userId)
      const [grouped, tombstoneCount] = await Promise.all([
        query(SELECT_DIGEST, [owner]),
        query(SELECT_TOMBSTONE_COUNT, [owner]),
      ])
      const rows = (grouped && grouped.rows) || []
      // SQL 已按 (count desc, platform asc) 排；JS 再排一次，防不同驱动/视图把顺序打散。
      const byPlatform = rows.map((row) => ({ platform: String(row.platform), count: toCount(row.count) }))
        .sort((left, right) => (right.count - left.count) || String(left.platform).localeCompare(String(right.platform)))
      const stamps = rows.map((row) => isoTime(row.updated_at)).filter(Boolean).sort()
      return {
        total: byPlatform.reduce((sum, entry) => sum + entry.count, 0),
        byPlatform,
        tombstones: toCount(tombstoneCount && tombstoneCount.rows && tombstoneCount.rows[0] && tombstoneCount.rows[0].count),
        updatedAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
      }
    },

    /** GET ?view=full：合并所需的云端全集（不含任何凭证材料）+ 墓碑。 */
    async listFull(userId) {
      const owner = assertUserId(userId)
      const [accounts, tombstones] = await Promise.all([
        query(SELECT_FULL, [owner]),
        query(SELECT_TOMBSTONES, [owner]),
      ])
      return {
        accounts: ((accounts && accounts.rows) || []).map((row) => mapAccount(row)),
        tombstones: ((tombstones && tombstones.rows) || []).map((row) => mapTombstone(row)),
      }
    },

    /**
     * PUT /api/v1/me/accounts：逐条独立裁决，返回与入参同序的 results。
     * 这里没有 BEGIN/COMMIT——整批回滚会把已成功的账号也抹掉，违反 PRD §7.2。
     */
    async upsertMany(userId, items) {
      const owner = assertUserId(userId)
      if (!Array.isArray(items)) throw accountError('ACCOUNT_BATCH_INVALID', 400)
      if (items.length > MAX_BATCH_SIZE) throw accountError('ACCOUNT_BATCH_TOO_LARGE', 413)
      const results = []
      for (const item of items) {
        const platform = item && typeof item.platform === 'string' ? item.platform : null
        const platformUid = item && typeof item.platformUid === 'string' ? item.platformUid : null
        try {
          const outcome = await upsertOne(owner, item)
          results.push({ platform, platformUid, outcome: outcome.outcome })
        } catch (error) {
          // 只回语义码：驱动原文（约束名、SQLSTATE、连接串）一律不外泄。
          results.push({ platform, platformUid, outcome: 'rejected', errorCode: safeErrorCode(error, 'ACCOUNT_WRITE_FAILED') })
        }
      }
      return { results }
    },

    async listTombstones(userId) {
      const owner = assertUserId(userId)
      const result = await query(SELECT_TOMBSTONES, [owner])
      return ((result && result.rows) || []).map((row) => mapTombstone(row))
    },

    /** 幂等：重复写同一合并键不报错也不产生第二行。 */
    async addTombstone(userId, platform, platformUid) {
      const owner = assertUserId(userId)
      const key = assertKey(platform, platformUid)
      const result = await query(INSERT_TOMBSTONE, [owner, key.platform, key.platformUid])
      return { created: countAffected(result) > 0 || Boolean(result && result.rows && result.rows[0]) }
    },

    /** POST /api/v1/me/accounts/sync（本期语义 = 批量取凭证槽，PRD §7.3）。 */
    async getCredentials(userId, keys) {
      const owner = assertUserId(userId)
      if (!Array.isArray(keys)) throw accountError('ACCOUNT_BATCH_INVALID', 400)
      if (keys.length === 0) return []
      if (keys.length > MAX_BATCH_SIZE) throw accountError('ACCOUNT_BATCH_TOO_LARGE', 413)
      const platforms = []
      const uids = []
      for (const entry of keys) {
        const key = assertKey(entry && entry.platform, entry && entry.platformUid)
        platforms.push(key.platform)
        uids.push(key.platformUid)
      }
      const result = await query(SELECT_CREDENTIALS, [owner, platforms, uids])
      return ((result && result.rows) || []).map((row) => ({
        platform: row.platform,
        platformUid: row.platform_uid,
        credentialUpdatedAt: isoTime(row.credential_updated_at),
        credentialEnvelope: {
          v: ENVELOPE_VERSION,
          // alg 不落列（PRD §6.1 没有算法列）：契约固定为 A256GCM，读库时按常量回填，
          // 不去探测一个不存在的列（AGENTS.md「宿主/数据字段归属必须先核实」同源纪律）。
          alg: ENVELOPE_ALG,
          iv: row.credential_iv,
          ciphertext: row.credential_ciphertext,
          tag: row.credential_auth_tag,
          encryptedDataKey: row.encrypted_data_key,
          digest: row.credential_digest,
        },
      }))
    },

    /**
     * POST /api/v1/me/accounts/disconnect（断开云端，PRD §7.4）：账号 + 墓碑一并清除，
     * 删完回读；有残留即返回 CLOUD_DISCONNECT_PARTIAL 语义，由客户端保留入口重试。
     */
    async clearAll(userId) {
      const owner = assertUserId(userId)
      const deletedAccounts = countAffected(await query(DELETE_ACCOUNTS, [owner]))
      const deletedTombstones = countAffected(await query(DELETE_TOMBSTONES, [owner]))
      const residual = await query(SELECT_RESIDUAL, [owner])
      const row = (residual && residual.rows && residual.rows[0]) || {}
      const remaining = toCount(row.accounts) + toCount(row.tombstones)
      if (remaining > 0) {
        return { ok: false, errorCode: 'CLOUD_DISCONNECT_PARTIAL', deletedAccounts, deletedTombstones, remaining }
      }
      return { ok: true, deletedAccounts, deletedTombstones, remaining: 0 }
    },
  }
}

module.exports = {
  CLOUD_ACCOUNT_COLUMNS,
  DELETE_ACCOUNTS,
  DELETE_TOMBSTONES,
  INSERT_ACCOUNT,
  INSERT_TOMBSTONE,
  SELECT_CREDENTIALS,
  SELECT_DIGEST,
  SELECT_FULL,
  SELECT_RESIDUAL,
  SELECT_ROW,
  SELECT_TOMBSTONE_COUNT,
  SELECT_TOMBSTONES,
  UPDATE_ACCOUNT,
  createCloudAccountRepository,
  sameRecord,
}
