// @ts-check
/**
 * account-metrics/cookies — 凭证到请求头的转换（纯函数，无 IO）
 *
 * 从 `index.js` 抽出：该文件是采集编排的主体，把「Cookie 形状归一」这类与编排无关的
 * 纯转换留在里面会把它顶过 500 行门禁（`.github/scripts/check-max-lines.js`）。
 *
 * ⛔ 本模块是**凭证的唯一出口**：编排层只把结果交给 http 层，适配器拿不到也记录不了，
 * 日志里因此不会出现凭证（采集侧三条纪律之一）。
 */
'use strict'

/**
 * Cookie 数组 → 请求头字符串。
 * 凭证库里存的是 `[{name, value, domain, ...}]`（playwright 采集形态），
 * 但也兼容 JSON 字符串与 `name=value` 裸串（历史数据三种都出现过）。
 * @param {unknown} cookies
 * @returns {string}
 */
function cookiesToHeader (cookies) {
  let list = cookies
  if (typeof list === 'string') {
    const text = list.trim()
    if (!text) return ''
    if (text.startsWith('[') || text.startsWith('{')) {
      try { list = JSON.parse(text) } catch (_) { return '' }
    } else {
      return text
    }
  }
  if (!Array.isArray(list)) return ''
  return list
    .filter(c => c && typeof c.name === 'string' && c.name && c.value !== undefined && c.value !== null)
    .map(c => c.name + '=' + String(c.value))
    .join('; ')
}

/** Cookie 名字集合（小写）用于 requiredCookieNames 校验与 body 注入。 */
function cookieNameSet (cookieHeader) {
  const set = new Set()
  for (const part of String(cookieHeader || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    set.add(part.slice(0, eq).trim().toLowerCase())
  }
  return set
}

/** Cookie 头 → { 小写名: 值 }（body 注入用；只解析首个小写化键名）。 */
function cookieValueMap (cookieHeader) {
  const map = {}
  for (const part of String(cookieHeader || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    if (!map[key]) map[key] = part.slice(eq + 1).trim()
  }
  return map
}

/**
 * 把 Cookie 里的值注入 JSON body（适配器声明 `bodyFromCookie: { bodyKey: cookieName }`）。
 * 平台把某些设备指纹**同时**放在 Cookie 与 JSON body 里（逆向真源对快手的实测形态）。
 * body 缺失/非对象或 cookie 缺该键时原样返回（不构造空 body）。
 * @param {unknown} body
 * @param {Record<string, string>|undefined|null} bodyFromCookie
 * @param {string} cookieHeader
 */
function injectBodyFromCookie (body, bodyFromCookie, cookieHeader) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  if (!bodyFromCookie || typeof bodyFromCookie !== 'object') return body
  const names = cookieNameSet(cookieHeader)
  const values = cookieValueMap(cookieHeader)
  const out = { ...body }
  for (const [bodyKey, cookieName] of Object.entries(bodyFromCookie)) {
    const key = String(cookieName || '').toLowerCase()
    if (!names.has(key)) continue
    out[bodyKey] = values[key]
  }
  return out
}

module.exports = { cookiesToHeader, cookieNameSet, cookieValueMap, injectBodyFromCookie }
