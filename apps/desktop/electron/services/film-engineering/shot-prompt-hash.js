// @ts-check

/**
 * 两级提示词哈希（design D22 / 第 8 轮 i1 / 第 14 轮 i2）。
 *
 * · `promptAssetHash`（plan 级·**提示词资产面**）：doctrine + 任务原文 + locale + 回退事实。
 *   **它的域是有边界的** ⇒ 「换了色盘 ⇒ 资产哈希会变」是**假命题**（色盘变了是逐镜渲染哈希变）。
 * · `promptRenderHash`（逐镜·**渲染面**）：固定键序的 vars + locale + **缺失清单**。
 *   ⚠ 缺失清单必须参与，否则「变量超限」与「变量根本没有」会得到**同一个哈希**。
 *
 * 两者**不能合并**：同一资产的**不同镜**渲染本就不同 ⇒ 「资产哈希相同 ⇒ 渲染逐字相同」是假命题。
 */

const crypto = require('crypto')
const { HASH_VERSION, ABSENT_TEMPLATE, FALLBACK_SOURCES } = require('./shot-prompt-contract')

/**
 * **长度前缀拼接**（避免 `a=bc` 与 `ab=c` 这类拼接碰撞）。
 * @param {Array<[string, string]>} pairs
 * @returns {string}
 */
function joinLengthPrefixed (pairs) {
  const parts = []
  for (const [k, v] of pairs) {
    const key = String(k)
    const val = String(v)
    parts.push(key.length + ':' + key + '=' + val.length + ':' + val)
  }
  return parts.join('|')
}

/**
 * **plan 级提示词资产哈希**（design D22 / 第 8 轮 i1）：覆盖**提示词资产面**
 * （doctrine + 任务原文 + locale + 回退事实）。
 *
 * **它的域是有边界的**（第 8 轮 i1 · Critical/consistency）：
 * ✅ 覆盖：doctrine、任务模板 system/user、语种、回退事实 —— 这些是**提示词资产**。
 * ❌ **不**覆盖：色盘行、角色描述、逐镜时长/模型 —— 那些是**逐镜输入**，
 *    由 `promptRenderHash` 覆盖。
 * ⇒ 「换了色盘 ⇒ 提示词资产哈希会变」是**假命题**（色盘变了是**逐镜渲染哈希**变）。
 *    旧名 `assetHash` 会让人以为覆盖全部资产 ⇒ 已改名 `promptAssetHash`。
 *
 * 它回答「**提示词资产**变没变」，**不**回答「某镜的渲染变没变」——后者靠 `promptRenderHash`。
 *
 * @param {object} opts
 * @param {any} [opts.doctrine]
 * @param {string} [opts.system]
 * @param {string} [opts.user]
 * @param {string} [opts.locale]
 * @param {Record<string, string>} [opts.fallbacks] - 按来源分组的回退事实
 * @returns {string} 十六进制哈希（无输入 ⇒ 空串）
 */
function computePromptAssetHash (opts) {
  const o = opts || {}
  let doctrineText = ''
  if (o.doctrine && typeof o.doctrine === 'object') {
    try { doctrineText = JSON.stringify(o.doctrine) } catch (e) { doctrineText = '' }
  }
  const fb = o.fallbacks && typeof o.fallbacks === 'object' ? o.fallbacks : {}
  const fbPairs = []
  for (const src of FALLBACK_SOURCES) {
    const sub = fb[src] && typeof fb[src] === 'object' ? fb[src] : {}
    for (const k of Object.keys(sub).sort()) fbPairs.push([src + '.' + k, sub[k]])
  }
  const pairs = [
    ['version', HASH_VERSION],
    ['locale', o.locale === 'en' ? 'en' : 'zh'],
    ['fallbacks', joinLengthPrefixed(fbPairs)],
    ['doctrine', doctrineText],
    // ⚠ 缺模板用**显式标记**（第 14 轮 i8）：空串与「真·空模板」会同哈希 ⇒ 不可区分。
    ['system', typeof o.system === 'string' ? o.system : ABSENT_TEMPLATE],
    ['user', typeof o.user === 'string' ? o.user : ABSENT_TEMPLATE],
  ]
  return crypto.createHash('sha256').update(joinLengthPrefixed(pairs)).digest('hex')
}

/**
 * **逐镜渲染哈希**（design D22 / 第 14 轮 i2）：覆盖**渲染面**（固定键序的 vars + locale + **缺失清单**）。
 *
 * ⇒ 同一镜、同一资产 ⇒ `promptRenderHash` 相同 ⇒ 渲染**逐字相同**；
 * 不同镜的 `promptRenderHash` 本就不同（逐镜 vars 不同）⇒ 不能用 `promptAssetHash` 代替。
 *
 * ⚠ **缺失清单必须参与**（第 14 轮 i2 · Critical/consistency）：
 * 只哈希「已提供」的变量时，「变量**超限**」与「变量**根本没有**」会得到**同一个哈希**
 * （两者都不在 vars 里）⇒ 不可区分。
 * ⇒ 缺失项按 `name + reason` 的**规范形式**参与拼接 ⇒ 缺失态与提供态哈希**必然不同**。
 *
 * @param {object} opts
 * @param {Record<string, string>} [opts.vars]
 * @param {Array<{name: string, reason: string}>} [opts.missing]
 * @param {string} [opts.locale]
 * @returns {string} 十六进制哈希
 */
function computePromptRenderHash (opts) {
  const o = opts || {}
  const vars = o.vars && typeof o.vars === 'object' ? o.vars : {}
  const missing = Array.isArray(o.missing) ? o.missing : []
  const pairs = [
    ['version', HASH_VERSION],
    ['locale', o.locale === 'en' ? 'en' : 'zh'],
  ]
  for (const k of Object.keys(vars).sort()) pairs.push([k, vars[k]])
  // 缺失项：按 name + reason 排序后参与（区分「超限」与「没有」——第 14 轮 i2）
  const missPairs = missing
    .map(m => [String(m && m.name), String(m && m.reason)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1)))
  for (const [name, reason] of missPairs) pairs.push(['missing:' + name, reason])
  return crypto.createHash('sha256').update(joinLengthPrefixed(pairs)).digest('hex')
}

module.exports = {
  joinLengthPrefixed,
  computePromptAssetHash,
  computePromptRenderHash,
}
