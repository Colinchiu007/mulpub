'use strict'
/**
 * validate-account.js — 云端账号上行字段的 fail-closed 校验（服务端独立一遍，PRD §6.2）。
 *
 * 真源：01-docs/PRD-CLOUD-ACCOUNT-SYNC-2026-09-27.md §6.2 校验表与 §7.5 错误码全表。
 * 三条纪律：
 *   1) **客户端校验不是安全边界**（PRD §6.2 尾注）：本模块必须是完整口径，不依赖上游已过滤。
 *   2) 逐条裁决：一条非法只判该条 `rejected`，不得让整批回滚（PRD §7.2「MUST NOT 整批回滚」）。
 *   3) 错误码只用 §7.5 已登记的码；确有必要新增时在本文件末尾「口径延伸」段集中声明，不散落。
 *
 * 线上字段形态：§7.1/§7.2 的响应体用 camelCase（`credentialEnvelope`/`platformUid`），
 * §6.2 的表体用 snake_case（`platform_uid`）。为不让调用方猜，两种拼写都收进白名单并归一为
 * camelCase；同一字段两种拼写同时出现且值不同即 `ACCOUNT_FIELD_NOT_ALLOWED`（语义歧义不猜）。
 */

const {
  countCredentialKeys,
  isCredentialDigest,
  normalizedByteSize,
} = require('./credential-digest')

// ---- 口径常量（PRD §5.1 / §6.1 / §6.2）----------------------------------------------

/** 八平台：PRD §5.1 要求全部有 uid extract 实现，枚举与之一一对应。 */
const SUPPORTED_PLATFORMS = Object.freeze([
  'douyin', 'toutiao', 'wechat_mp', 'tencent_video', 'bilibili', 'kuaishou', 'xiaohongshu', 'zhihu',
])

const MAX_BATCH_SIZE = 100
const MAX_CREDENTIAL_BYTES = 2 * 1024 * 1024
const MAX_CREDENTIAL_KEYS = 5000
const MAX_UID_LENGTH = 128
const MAX_NAME_LENGTH = 200
const MAX_AVATAR_LENGTH = 1024
const MAX_DEVICE_LABEL_LENGTH = 64
const MAX_FOLLOWERS = 1e12
/** 时间戳允许的未来偏移：只吸收时钟偏差，不给客户端留「预写未来时间」的口子（PRD §6.2）。 */
const TIMESTAMP_FUTURE_SKEW_MS = 5 * 60 * 1000
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16
const ENVELOPE_VERSION = 1
const ENVELOPE_ALG = 'A256GCM'
const REPORTED_STATUSES = Object.freeze(['active', 'expired', 'unverified'])

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/

/** 上行白名单：camelCase 为规范形态，snake_case 为 §6.2 表体的兼容别名。 */
const ACCOUNT_FIELD_ALIASES = Object.freeze({
  platform: ['platform'],
  platformUid: ['platformUid', 'platform_uid'],
  displayName: ['displayName', 'display_name'],
  accountName: ['accountName', 'account_name'],
  avatar: ['avatar'],
  followers: ['followers'],
  isActive: ['isActive', 'is_active'],
  credentialEnvelope: ['credentialEnvelope', 'credential_envelope'],
  credentialUpdatedAt: ['credentialUpdatedAt', 'credential_updated_at'],
  metadataUpdatedAt: ['metadataUpdatedAt', 'metadata_updated_at'],
  createdAt: ['createdAt', 'created_at'],
  lastReportedStatus: ['lastReportedStatus', 'last_reported_status'],
  lastSyncDeviceLabel: ['lastSyncDeviceLabel', 'last_sync_device_label'],
})
const ALLOWED_ACCOUNT_FIELDS = Object.freeze(
  Array.from(new Set(Object.keys(ACCOUNT_FIELD_ALIASES).reduce((acc, key) => acc.concat(ACCOUNT_FIELD_ALIASES[key]), []))),
)

// ---- 错误码工厂（沿用本仓 code/status 携带风格，见 postgres-commerce-store.js）---------

function accountError(code, status, message) {
  return Object.assign(new Error(code), { code, status, message: message || code })
}

// ---- 噪声昵称判定：shared-utils CJS 孪生的等价实现 -------------------------------------
/*
 * 本包是可独立打包的零 workspace 依赖运行时（见 package.json 的 files 与 Docker runner 的
 * COPY 清单），因此不能 require('@multi-publish/shared-utils')；这里按同一批形态规则重写，
 * 并由 test/cloud-accounts-validate.test.js 对两份实现做 parity 锁（词表逐字 + 正则按
 * source/flags 比较 + 样本判定一致）。**新增规则必须两处同时改，否则 parity 锁变红。**
 *
 * 按 AGENTS.md「枚举式黑名单必须配结构化正向契约」：以下规则主体是形态指纹，不是坏值枚举；
 * 测试样本不得取自被枚举集合本身。
 */
const NOISE_KEYWORDS = Object.freeze([
  '退出登录', '账号认证', '扫码登录', '请登录', '立即登录',
  '创作者中心', '创作中心', '数据中心', '发布记录', '作品管理',
  '内容管理', '首页', '设置', '提现', '收益',
])
const METRIC_WORDS = Object.freeze(['粉丝', '获赞', '关注者', '粉丝数', '关注数'])
const KNOWN_PAGE_TITLES = Object.freeze([
  '作品发布', '头条号', '百家号', '视频号助手', '视频号',
  'bilibili 创作者中心', 'bilibili', '哔哩哔哩', '哔哩哔哩创作中心',
  '微信公众号', '公众号', '大鱼号', '搜狐号', '网易号', '一点号',
  '爱奇艺号', '企鹅号', '网易订阅号',
])
const CHROME_SUFFIXES = Object.freeze([
  '创作者中心', '创作者服务平台', '创作服务平台', '服务平台',
  '工作台', '管理后台', '开放平台', '数据中心',
])
const METRIC_PATTERNS = Object.freeze([
  /\d+(?:\.\d+)?\s*[万亿wk]?\s*(?:人看过|人观看|人浏览|次阅读|次播放|条评价|位粉丝|个粉丝)/i,
  /^\d+(?:\.\d+)?\s*[万亿wk]?\s*(?:粉丝|关注|获赞|播放|阅读|浏览|作品|动态|赞)$/i,
])
const ELLIPSIS_PATTERN = /\.{3}|…|。{2,}/
const TITLE_SEPARATOR_PATTERN = /\s[-–—|·]\s/
const OPEN_BRACKETS = '([{（［【〔「『〈《'
const CLOSE_BRACKETS = ')]}）］】〕」』〉》'

function hasUnbalancedBrackets(text) {
  let open = 0
  let close = 0
  for (const ch of text) {
    if (OPEN_BRACKETS.includes(ch)) open += 1
    else if (CLOSE_BRACKETS.includes(ch)) close += 1
  }
  return open !== close
}

/** 空串没有可展示信息，同样判噪声（PRD §6.2 display_name 非空 + 形态规则同一口径）。 */
function isNoiseAccountName(name) {
  const raw = typeof name === 'string' ? name.trim() : ''
  if (!raw) return true
  if (NOISE_KEYWORDS.some((keyword) => raw.includes(keyword))) return true
  const metricHits = METRIC_WORDS.reduce((count, word) => count + (raw.split(word).length - 1), 0)
  if (metricHits >= 2) return true
  const lowered = raw.toLowerCase()
  if (KNOWN_PAGE_TITLES.includes(lowered)) return true
  if (CHROME_SUFFIXES.some((suffix) => lowered.endsWith(suffix.toLowerCase()))) return true
  if (METRIC_PATTERNS.some((pattern) => pattern.test(raw))) return true
  if (ELLIPSIS_PATTERN.test(raw)) return true
  if (TITLE_SEPARATOR_PATTERN.test(raw)) return true
  return hasUnbalancedBrackets(raw)
}

// ---- 基础取器 --------------------------------------------------------------------------

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key)
}

/** 按别名取字段；未出现返回 `{ present: false }`，避免把「缺席」当成「显式 null」。 */
function pick(source, canonical) {
  const aliases = ACCOUNT_FIELD_ALIASES[canonical] || [canonical]
  let found
  let seen = false
  for (const alias of aliases) {
    if (!hasOwn(source, alias)) continue
    const value = source[alias]
    if (seen && JSON.stringify(found) !== JSON.stringify(value)) {
      throw accountError('ACCOUNT_FIELD_NOT_ALLOWED', 400)
    }
    found = value
    seen = true
  }
  return { present: seen, value: found }
}

function optionalText(value, code) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw accountError(code, 400)
  return value
}

function asBytes(value, code) {
  if (Buffer.isBuffer(value)) return value
  if (typeof value === 'string') {
    if (!value || !BASE64.test(value)) throw accountError(code, 400)
    const decoded = Buffer.from(value, 'base64')
    // base64 往返必须等长：否则是把非 base64 文本（例如又一层 JSON）当成密文收下了。
    if (decoded.toString('base64') !== value) throw accountError(code, 400)
    return decoded
  }
  throw accountError(code, 400)
}

function validateTimestamp(value, { now, required = false, code = 'ACCOUNT_TIMESTAMP_INVALID' } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw accountError(code, 400)
    return null
  }
  if (typeof value !== 'string' || !ISO_8601.test(value)) throw accountError(code, 400)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw accountError(code, 400)
  const current = now instanceof Date ? now : new Date(typeof now === 'number' ? now : Date.now())
  if (Number.isNaN(current.getTime())) throw accountError('ACCOUNT_TIMESTAMP_INVALID', 400)
  if (date.getTime() > current.getTime() + TIMESTAMP_FUTURE_SKEW_MS) throw accountError(code, 400)
  return date.toISOString()
}

// ---- §6.2 凭证结构与体积（明文侧口径，客户端上行前与服务端复核共用同一份）----------------

/**
 * 明文凭证形状：cookies 数组且每项含 name/value；localStorage 对象；indexedDB 对象或数组；
 * 键总数 ≤ 5000；规范化后 ≤ 2 MiB。错误码固定为 CREDENTIAL_SHAPE_INVALID / CREDENTIAL_TOO_LARGE。
 */
function validateCredentialShape(credential, { now } = {}) {
  if (!isPlainObject(credential)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  const cookies = credential.cookies === undefined || credential.cookies === null ? [] : credential.cookies
  if (!Array.isArray(cookies)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  for (const item of cookies) {
    if (!isPlainObject(item)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
    if (typeof item.name !== 'string' || !item.name) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
    if (typeof item.value !== 'string') throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  }
  if (credential.localStorage !== undefined && credential.localStorage !== null && !isPlainObject(credential.localStorage)) {
    throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  }
  if (credential.indexedDB !== undefined && credential.indexedDB !== null
    && !isPlainObject(credential.indexedDB) && !Array.isArray(credential.indexedDB)) {
    throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  }
  if (countCredentialKeys(credential) > MAX_CREDENTIAL_KEYS) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  if (normalizedByteSize(credential) > MAX_CREDENTIAL_BYTES) throw accountError('CREDENTIAL_TOO_LARGE', 413)
  void now
  return true
}

/**
 * 信封形状（PRD §7.2 的 `credentialEnvelope`）：服务端只见到密文与加密 DK，
 * 摘要由客户端按同一口径算出（§8.6），服务端只能校验其形状，不能重算。
 */
function validateEnvelope(envelope, { now, required = true } = {}) {
  if (envelope === undefined || envelope === null) {
    if (required) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
    return null
  }
  if (!isPlainObject(envelope)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  if (envelope.v !== ENVELOPE_VERSION) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  if (envelope.alg !== ENVELOPE_ALG) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  const iv = asBytes(envelope.iv, 'CREDENTIAL_SHAPE_INVALID')
  const ciphertext = asBytes(envelope.ciphertext, 'CREDENTIAL_SHAPE_INVALID')
  const tag = asBytes(envelope.tag, 'CREDENTIAL_SHAPE_INVALID')
  const encryptedDataKey = asBytes(envelope.encryptedDataKey, 'CREDENTIAL_SHAPE_INVALID')
  if (iv.length !== IV_BYTES) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  if (tag.length !== AUTH_TAG_BYTES) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  if (ciphertext.length === 0) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  if (!isCredentialDigest(envelope.digest)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  const total = iv.length + ciphertext.length + tag.length + encryptedDataKey.length
  if (total > MAX_CREDENTIAL_BYTES) throw accountError('CREDENTIAL_TOO_LARGE', 413)
  const credentialUpdatedAt = validateTimestamp(
    hasOwn(envelope, 'credentialUpdatedAt') ? envelope.credentialUpdatedAt : envelope.credential_updated_at,
    { now, required: true },
  )
  return { v: ENVELOPE_VERSION, alg: ENVELOPE_ALG, iv, ciphertext, tag, encryptedDataKey, digest: envelope.digest, credentialUpdatedAt }
}

// ---- §6.2 单条账号 ----------------------------------------------------------------------

function validateAccount(raw, options = {}) {
  const { now, requireEnvelope = true } = options
  if (!isPlainObject(raw)) throw accountError('CREDENTIAL_SHAPE_INVALID', 400)
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_ACCOUNT_FIELDS.includes(key)) throw accountError('ACCOUNT_FIELD_NOT_ALLOWED', 400)
  }

  const platform = optionalText(pick(raw, 'platform').value, 'ACCOUNT_PLATFORM_UNSUPPORTED')
  if (typeof platform !== 'string' || !SUPPORTED_PLATFORMS.includes(platform)) {
    throw accountError('ACCOUNT_PLATFORM_UNSUPPORTED', 400)
  }

  const uid = optionalText(pick(raw, 'platformUid').value, 'ACCOUNT_UID_INVALID')
  if (typeof uid !== 'string' || !uid.trim() || uid.trim().length > MAX_UID_LENGTH || CONTROL_CHARS.test(uid)) {
    throw accountError('ACCOUNT_UID_INVALID', 400)
  }

  const displayName = optionalText(pick(raw, 'displayName').value, 'ACCOUNT_NAME_NOISE')
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > MAX_NAME_LENGTH
    || CONTROL_CHARS.test(displayName) || isNoiseAccountName(displayName)) {
    throw accountError('ACCOUNT_NAME_NOISE', 400)
  }

  const accountNameRaw = pick(raw, 'accountName').value
  const accountName = optionalText(accountNameRaw, 'ACCOUNT_NAME_NOISE')
  if (accountName !== null && (accountName.length > MAX_NAME_LENGTH || CONTROL_CHARS.test(accountName))) {
    throw accountError('ACCOUNT_NAME_NOISE', 400)
  }
  if (typeof accountName === 'string' && accountName !== '' && isNoiseAccountName(accountName)) {
    throw accountError('ACCOUNT_NAME_NOISE', 400)
  }

  const avatarRaw = pick(raw, 'avatar').value
  const avatar = optionalText(avatarRaw, 'ACCOUNT_AVATAR_INVALID')
  let normalizedAvatar = null
  if (avatar !== null && avatar !== '') {
    if (!avatar.startsWith('https://') || avatar.length > MAX_AVATAR_LENGTH
      || CONTROL_CHARS.test(avatar) || /\s/.test(avatar)) {
      throw accountError('ACCOUNT_AVATAR_INVALID', 400)
    }
    normalizedAvatar = avatar
  }

  const followersRaw = pick(raw, 'followers').value
  let followers = null
  if (followersRaw !== undefined && followersRaw !== null) {
    if (!Number.isSafeInteger(followersRaw) || followersRaw < 0 || followersRaw > MAX_FOLLOWERS) {
      throw accountError('ACCOUNT_FOLLOWERS_INVALID', 400)
    }
    followers = followersRaw
  }

  const isActiveRaw = pick(raw, 'isActive').value
  const isActive = isActiveRaw === undefined || isActiveRaw === null ? true : isActiveRaw
  if (typeof isActive !== 'boolean') throw accountError('ACCOUNT_FIELD_NOT_ALLOWED', 400)

  const lastReportedRaw = pick(raw, 'lastReportedStatus').value
  // §6.1 注：last_reported_status 只是展示用只读快照，恢复流程不读它；
  // 非三态之一一律按「本轮未上报」存 null，不为其发明 §7.5 之外的错误码。
  const lastReportedStatus = typeof lastReportedRaw === 'string' && REPORTED_STATUSES.includes(lastReportedRaw)
    ? lastReportedRaw : null

  const deviceLabelRaw = pick(raw, 'lastSyncDeviceLabel').value
  const deviceLabel = optionalText(deviceLabelRaw, 'ACCOUNT_DEVICE_LABEL_INVALID')
  if (deviceLabel !== null && (deviceLabel.length > MAX_DEVICE_LABEL_LENGTH || CONTROL_CHARS.test(deviceLabel))) {
    throw accountError('ACCOUNT_DEVICE_LABEL_INVALID', 400)
  }

  const metadataUpdatedAt = validateTimestamp(pick(raw, 'metadataUpdatedAt').value, { now, required: true })
  const createdAt = validateTimestamp(pick(raw, 'createdAt').value, { now })
  const envelope = validateEnvelope(pick(raw, 'credentialEnvelope').value, { now, required: requireEnvelope })

  return {
    platform,
    platformUid: uid.trim(),
    displayName,
    accountName: accountName === '' ? null : accountName,
    avatar: normalizedAvatar,
    followers,
    isActive,
    lastReportedStatus,
    lastSyncDeviceLabel: deviceLabel === '' ? null : deviceLabel,
    metadataUpdatedAt,
    createdAt,
    credentialDigest: envelope ? envelope.digest : null,
    credentialUpdatedAt: envelope ? envelope.credentialUpdatedAt : null,
    credential: envelope,
  }
}

/** 逐条裁决的入口：单条非法只返回该条错误，不抛出、不影响其余条目。 */
function validateAccountQuietly(raw, options = {}) {
  try {
    return { ok: true, value: validateAccount(raw, options) }
  } catch (error) {
    const code = typeof error && error.code ? String(error.code) : 'ACCOUNT_FIELD_NOT_ALLOWED'
    return { ok: false, code: /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'ACCOUNT_FIELD_NOT_ALLOWED', status: Number(error && error.status) || 400 }
  }
}

// ---- §6.2 批量与 sync 入参 --------------------------------------------------------------

function validateBatch(accounts) {
  if (!Array.isArray(accounts)) throw accountError('ACCOUNT_BATCH_INVALID', 400)
  if (accounts.length > MAX_BATCH_SIZE) throw accountError('ACCOUNT_BATCH_TOO_LARGE', 413)
  return accounts
}

/** POST /api/v1/me/accounts/sync 的 `keys`：只允许合并键两列（PRD §7.3），多余字段同样拒。 */
function validateSyncKeys(raw) {
  if (!isPlainObject(raw)) throw accountError('ACCOUNT_BATCH_INVALID', 400)
  const keys = raw.keys
  if (!Array.isArray(keys)) throw accountError('ACCOUNT_BATCH_INVALID', 400)
  if (keys.length > MAX_BATCH_SIZE) throw accountError('ACCOUNT_BATCH_TOO_LARGE', 413)
  return keys.map((entry) => {
    if (!isPlainObject(entry)) throw accountError('ACCOUNT_UID_INVALID', 400)
    for (const field of Object.keys(entry)) {
      if (field !== 'platform' && field !== 'platformUid' && field !== 'platform_uid') {
        throw accountError('ACCOUNT_FIELD_NOT_ALLOWED', 400)
      }
    }
    const platform = entry.platform
    if (typeof platform !== 'string' || !SUPPORTED_PLATFORMS.includes(platform)) {
      throw accountError('ACCOUNT_PLATFORM_UNSUPPORTED', 400)
    }
    const uid = entry.platformUid !== undefined ? entry.platformUid : entry.platform_uid
    if (typeof uid !== 'string' || !uid.trim() || uid.trim().length > MAX_UID_LENGTH || CONTROL_CHARS.test(uid)) {
      throw accountError('ACCOUNT_UID_INVALID', 400)
    }
    return { platform, platformUid: uid.trim() }
  })
}

module.exports = {
  ACCOUNT_FIELD_ALIASES,
  ALLOWED_ACCOUNT_FIELDS,
  AUTH_TAG_BYTES,
  BASE64,
  CHROME_SUFFIXES,
  CONTROL_CHARS,
  CLOSE_BRACKETS,
  ENVELOPE_ALG,
  ENVELOPE_VERSION,
  ISO_8601,
  IV_BYTES,
  KNOWN_PAGE_TITLES,
  MAX_AVATAR_LENGTH,
  MAX_BATCH_SIZE,
  MAX_CREDENTIAL_BYTES,
  MAX_CREDENTIAL_KEYS,
  MAX_DEVICE_LABEL_LENGTH,
  MAX_FOLLOWERS,
  MAX_NAME_LENGTH,
  MAX_UID_LENGTH,
  METRIC_PATTERNS,
  METRIC_WORDS,
  NOISE_KEYWORDS,
  OPEN_BRACKETS,
  REPORTED_STATUSES,
  SUPPORTED_PLATFORMS,
  TIMESTAMP_FUTURE_SKEW_MS,
  TITLE_SEPARATOR_PATTERN,
  ELLIPSIS_PATTERN,
  accountError,
  asBytes,
  hasUnbalancedBrackets,
  isNoiseAccountName,
  isPlainObject,
  validateAccount,
  validateAccountQuietly,
  validateBatch,
  validateCredentialShape,
  validateEnvelope,
  validateSyncKeys,
  validateTimestamp,
}

/*
 * 口径延伸（PRD §7.5 未列、但契约上必须存在的码，集中声明避免散落）：
 *   - ACCOUNT_BATCH_INVALID          400  请求体不是 { accounts: [...] } / { keys: [...] }
 *   - ACCOUNT_DEVICE_LABEL_INVALID   400  last_sync_device_label 超长或含控制字符（§6.1 只给了列宽没给码）
 *   - CREDENTIAL_DECRYPT_FAILED      500  信封存在但 AAD/标签不匹配（envelope-crypto.js 抛出）
 *   - ACCOUNT_WRITE_FAILED           500  单条落库的非语义异常（cloud-account-repository.js 兜底）
 *   - INTERNAL_SERVER_ERROR / METHOD_NOT_ALLOWED / ROUTE_NOT_FOUND  沿用 publish-api-server.js 既有码
 */
