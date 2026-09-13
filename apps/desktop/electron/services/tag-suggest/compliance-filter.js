// @ts-check
/**
 * compliance-filter — 合规过滤流水线
 *
 * 对标签做规范化 → 长度 → 空格 → 违禁词 → 去重 → 编码安全过滤，
 * 防止不合规/低质量标签进入输出。违禁词黑名单来自 compliance-blocklist.json。
 */
const path = require('path')
const { normalizeTag, stripHash, getTagStyle } = require('./platform-rules')

const _blocklistCache = new Map()

/**
 * 同步加载违禁词黑名单（带缓存）。
 * @param {string} [dataDir] — 指向 tag-suggest-data/ 目录
 * @returns {{version:number, global:string[], platforms:Record<string,string[]>}}
 */
function loadBlocklist (dataDir) {
  const dir = dataDir || path.join(__dirname, '..', 'tag-suggest-data')
  if (_blocklistCache.has(dir)) return _blocklistCache.get(dir)
  const file = path.join(dir, 'compliance-blocklist.json')
  let raw
  try {
    raw = require(file)
  } catch (e) {
    raw = { version: 1, global: [], platforms: {} }
  }
  const blocklist = {
    version: raw.version || 1,
    global: Array.isArray(raw.global) ? raw.global : [],
    platforms: raw.platforms && typeof raw.platforms === 'object' ? raw.platforms : {},
  }
  _blocklistCache.set(dir, blocklist)
  return blocklist
}

/**
 * 全角转半角（用于违禁词匹配统一）。
 * @param {string} s
 * @returns {string}
 */
function toHalfWidth (s) {
  return String(s).replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
}

/**
 * 长度校验：中文 ≤8 字，英文 ≤30 字符（去 # 前缀后计算）。
 * @param {string} tag
 * @param {string} [platform]
 * @returns {boolean}
 */
function validateLength (tag, platform) {
  const stripped = stripHash(tag)
  if (!stripped) return false
  // 中文（CJK）按字计，其他按字符计
  const cjkCount = (stripped.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length
  const nonCjk = stripped.length - cjkCount
  if (cjkCount > 8) return false
  if (nonCjk > 30) return false
  return true
}

/**
 * 标签内是否含空白。
 * @param {string} tag
 * @returns {boolean}
 */
function hasSpaces (tag) {
  return /\s/.test(tag)
}

/**
 * 违禁词匹配（子串，不区分大小写，全角半角统一）。
 * @param {string} tag
 * @param {{global:string[], platforms:Record<string,string[]>}} blocklist
 * @param {string} [platform]
 * @returns {boolean}
 */
function isBlocked (tag, blocklist, platform) {
  if (!blocklist) return false
  const norm = toHalfWidth(tag).toLowerCase()
  const words = (blocklist.global || []).slice()
  if (platform && blocklist.platforms && Array.isArray(blocklist.platforms[platform])) {
    words.push(...blocklist.platforms[platform])
  }
  for (const w of words) {
    if (!w) continue
    if (norm.includes(toHalfWidth(w).toLowerCase())) return true
  }
  return false
}

/**
 * 去重（忽略 # 前缀差异）。
 * @param {string[]} tags
 * @returns {string[]}
 */
function dedupe (tags) {
  const seen = new Set()
  const out = []
  for (const t of tags) {
    if (!t) continue
    const key = stripHash(t).toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(t)
    }
  }
  return out
}

/**
 * 过滤控制字符与零宽字符（编码安全）。
 * @param {string} tag
 * @returns {string}
 */
function sanitize (tag) {
  return String(tag)
    // 零宽字符
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    // 控制字符（保留常见可见字符）——清洗场景有意匹配控制字符本身，豁免 no-control-regex
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
}

/**
 * 完整过滤流水线。
 * @param {string[]} tags
 * @param {string} platform
 * @param {{global:string[], platforms:Record<string,string[]>}} [blocklist]
 * @returns {string[]}
 */
function filterTags (tags, platform, blocklist) {
  const bl = blocklist || loadBlocklist()
  return tags
    .map(tag => sanitize(normalizeTag(tag, platform)))
    .filter(tag => tag.length > 0)
    .filter(tag => validateLength(tag, platform))
    .filter(tag => !hasSpaces(tag))
    .filter(tag => !isBlocked(tag, bl, platform))
    .filter((tag, i, arr) => {
      const key = stripHash(tag).toLowerCase()
      return arr.findIndex(x => stripHash(x).toLowerCase() === key) === i
    })
}

module.exports = {
  loadBlocklist,
  toHalfWidth,
  validateLength,
  hasSpaces,
  isBlocked,
  dedupe,
  sanitize,
  filterTags,
  normalizeTag,
}
