'use strict'
const crypto = require('crypto')
/**
 * credential-digest.js — 账号凭证（cookies / localStorage / indexedDB）的确定性规范化与指纹。
 *
 * 真源：01-docs/PRD-CLOUD-ACCOUNT-SYNC-2026-09-27.md §8.6 与 §6.1 的 `credential_digest` 列。
 * 存在理由：`credential_digest` 是「本轮是否需要写库」的唯一判据（PRD §5.2 的 unchanged 分支）。
 * 规范化一旦不确定，同一次登录就会产出两个摘要，把 unchanged 误判成凭证冲突，
 * 进而触发一次本不需要的真实登录检测（ADR-0005 第 3 条）。因此本文件的两条不变式：
 *   1) 顺序无关：cookies 按 (domain, path, name) 字典序，对象键按字典序；
 *   2) 抖动无关：只保留语义字段，丢弃浏览器每次读写都会变的易变字段。
 *
 * 注意分工：摘要只用于**判变更**，不用于识别账号身份（合并键是 (platform, platform_uid)，ADR-0004）；
 * 入库的密文走 normalizeCredential **之前**的原始凭证（见 envelope-crypto.js），
 * 否则 expirationDate 等字段会在下行恢复时丢失。
 */

// 语义字段：决定「这是不是同一次登录」的字段（CONTEXT.md「账号凭证」）。
const COOKIE_SEMANTIC_FIELDS = ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite']

// 易变字段：Electron `session.cookies.get()` 每次读回都可能不同，绝不得参与摘要。
const COOKIE_VOLATILE_FIELDS = ['expirationDate', 'lastAccessTime', 'session', 'hostOnly', 'storeId']

const DIGEST_PATTERN = /^[0-9a-f]{64}$/

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

/** 单个 cookie 只保留语义字段；缺失的键不补 null，避免「未上报」与「上报为 false」被抹平。 */
function normalizeCookie(cookie) {
  const source = isPlainObject(cookie) ? cookie : {}
  const out = {}
  for (const field of COOKIE_SEMANTIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
      out[field] = source[field]
    }
  }
  return out
}

function compareCookie(left, right) {
  const byDomain = asText(left.domain).localeCompare(asText(right.domain))
  if (byDomain !== 0) return byDomain
  const byPath = asText(left.path).localeCompare(asText(right.path))
  if (byPath !== 0) return byPath
  return asText(left.name).localeCompare(asText(right.name))
}

/** 对象键按字典序重建；数组原样返回（顺序由调用方决定是否排序）。 */
function sortedEntries(value) {
  if (!isPlainObject(value)) return {}
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = value[key]
  }
  return out
}

/**
 * 规范化凭证（PRD §8.6 固定的两条口径）。缺失分区按空集合处理，不抛错——
 * 形状合法性由 validate-account.js 负责，本模块只保证「同一凭证 → 同一输出」。
 */
function normalizeCredential(credential) {
  const source = isPlainObject(credential) ? credential : {}
  const cookies = Array.isArray(source.cookies)
    ? source.cookies.map((item) => normalizeCookie(item)).sort(compareCookie)
    : []
  const indexedDB = Array.isArray(source.indexedDB) ? source.indexedDB.slice() : sortedEntries(source.indexedDB)
  return {
    cookies,
    localStorage: sortedEntries(source.localStorage),
    indexedDB,
  }
}

/**
 * 与 JSON.stringify 等价的稳定序列化：对象键字典序、数组保序、undefined 键丢弃、
 * 非有限数按 null（与 JSON 口径一致）。摘要与密文都用它，保证跨进程可复现。
 */
function stableStringify(value) {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (type === 'boolean' || type === 'string') return JSON.stringify(value)
  if (type === 'bigint') return JSON.stringify(value.toString())
  if (type === 'undefined' || typeof value === 'function') return 'null'
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString('base64'))
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(',')}]`
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined && typeof value[key] !== 'function').sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

/** 规范化后的凭证字节数（PRD §6.2 的 2 MiB 体积门禁口径）。 */
function normalizedByteSize(credential) {
  return Buffer.byteLength(stableStringify(normalizeCredential(credential)), 'utf8')
}

/**
 * 键总数（PRD §6.2「键总数 ≤ 5000」）：cookie 条数 + localStorage 顶层键 + indexedDB 顶层键。
 * 只数顶层是有意为之——上限的目的是挡住把整站数据当凭证上报，深层数量由体积门禁兜住。
 */
function countCredentialKeys(credential) {
  const normalized = normalizeCredential(credential)
  const indexedDBKeys = Array.isArray(normalized.indexedDB)
    ? normalized.indexedDB.length
    : Object.keys(normalized.indexedDB).length
  return normalized.cookies.length + Object.keys(normalized.localStorage).length + indexedDBKeys
}

function credentialDigest(credential) {
  return crypto.createHash('sha256').update(stableStringify(normalizeCredential(credential)), 'utf8').digest('hex')
}

function isCredentialDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value)
}

module.exports = {
  COOKIE_SEMANTIC_FIELDS,
  COOKIE_VOLATILE_FIELDS,
  countCredentialKeys,
  credentialDigest,
  isCredentialDigest,
  normalizeCredential,
  normalizedByteSize,
  stableStringify,
}
