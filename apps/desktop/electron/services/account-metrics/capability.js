/**
 * account-metrics/capability —— 把「平台指标矩阵」翻译成账号快照里的能力描述。
 *
 * ## 这个模块解决什么
 *
 * 采集回来的账号快照里，某个指标没有值时，界面此前只能显示 `-`。
 * 但 `-` 把**三种完全不同的情况**混成了同一个样子：
 *   ① 平台根本没这个指标（该显示「平台不支持」）
 *   ② 平台有、这次没采到（该显示 `-` 或「暂无」）
 *   ③ 我们压根不认识这个平台（该显示「未知平台」）
 *
 * 本模块为每个账号生成 `capability`，把 ①②③ 分开，供 UI 按状态出不同文案。
 *
 * ## ★ 它**不是**请求门控
 *
 * 矩阵是**厂商的能力边界**，不是本仓的。本仓实测能拿到的，即使厂商没声明也应采信实测。
 * 因此本模块只做两件事：给 UI 出文案；给采集结果做**交叉校验**（见 `checkMetrics`）。
 * **绝不用它决定「要不要发这个请求」** —— 那会让「厂商矩阵不全」变成「本仓拿不到数」。
 *
 * ## 与 P1-1 的关系
 *
 * 三态本身由 `platform-metric-matrix.getMetricSupport()` 提供；本模块只做编排与形状转换，
 * 不重复实现判据（重复实现会让两处慢慢漂移）。
 */
'use strict'

const {
  getMetricSupport,
  getPlatformMetricCapabilities,
  loadMatrix,
} = require('@multi-publish/shared-utils/src/platform-metric-matrix')

/** UI 文案键（渲染端按 key 出中英文；此处不放用户可见字符串，避免绕过 i18n） */
const CAPABILITY_STATE = Object.freeze({
  KNOWN: 'known',
  UNKNOWN_PLATFORM: 'unknown-platform',
})

/**
 * 全矩阵出现过的所有 metricKey（**并集**，含各平台各自的标签）。
 *
 * ★ 必须用并集而不是「该平台声明的那些」：只看声明过的，就永远问不出「它**不**支持什么」——
 * 实测 `kuaishou` 声明的指标里根本不含 `income`，于是「不支持」列表恒为空，
 * 而 UI 要的恰恰是「这个平台没有收益指标」这句话。
 */
function allMetricKeys () {
  const m = loadMatrix()
  const byKey = new Map()
  for (const [gid, g] of Object.entries(m.groups || {})) {
    const map = (m.metricKeyMap && m.metricKeyMap[gid]) || {}
    for (const [rawId, label] of Object.entries(g.metrics || {})) {
      const key = map[rawId]
      if (!key) continue
      if (!byKey.has(key)) byKey.set(key, { metricKey: key, label, group: g.key })
    }
  }
  return [...byKey.values()]
}

/**
 * 为某平台生成能力描述。
 *
 * @param {string} platform 平台 slug
 * @returns {{
 *   state: 'known'|'unknown-platform',
 *   metrics: Array<{metricKey:string, label:string, group:string, support:string}>,
 *   unsupportedMetricKeys: string[],
 *   availableMetricKeys: string[]
 * }}
 *
 * 未收录平台返回 `state:'unknown-platform'` 且 `metrics: []` —— UI 据此显示「未知平台」，
 * **不是**「该平台所有指标都不支持」（后者会误导用户以为我们查过这个平台）。
 */
function buildPlatformCapability (platform) {
  const pid = String(platform || '').toLowerCase()
  const caps = getPlatformMetricCapabilities(pid) // 未收录平台返回 []，不是 null
  if (!Array.isArray(caps) || caps.length === 0) {
    return {
      state: CAPABILITY_STATE.UNKNOWN_PLATFORM,
      metrics: [],
      unsupportedMetricKeys: [],
      availableMetricKeys: [],
    }
  }

  // 逐个指标问三态。**用 getMetricSupport 而不是看 caps 里有没有** ——
  // 前者是唯一判据源（P1-1），后者只是它的一个投影；两处都判会让判据分叉。
  // 遍历的是**全矩阵并集**，这样「它没有 income」才表现为 declared-unavailable 而不是消失。
  const metrics = []
  const available = []
  const unsupported = []
  for (const c of allMetricKeys()) {
    const support = getMetricSupport(pid, c.metricKey)
    if (support === 'unknown-metric') continue
    metrics.push({ metricKey: c.metricKey, label: c.label, group: c.group, support })
    if (support === 'declared-available') available.push(c.metricKey)
    else if (support === 'declared-unavailable') unsupported.push(c.metricKey)
  }

  return {
    state: CAPABILITY_STATE.KNOWN,
    metrics,
    unsupportedMetricKeys: unsupported,
    availableMetricKeys: available,
  }
}

/**
 * 对一次采集结果做交叉校验（P1-2 验收判据 ③）。
 *
 * ## 只校验「适配器这次真的尝试解析过」的指标
 *
 * 判据是**该 key 是否出现在任一 item 的 `metrics` 对象里（作为键）**，而不是「矩阵声明过」。
 * 原因：适配器目前只解析 likes/comments/shares 等少数几个；若按「矩阵声明过」校验，
 * 其余十几个声明指标会因为「这条链本就没实现」全被判成 `declared-but-null`，
 * **噪声会把真信号埋掉** —— 而这条判据的全部价值就在于让真信号可见。
 *
 * 回传的只有两类：
 *   · `declared-but-null`      —— 适配器**解析了**这个键、但值全空 ⇒ **可疑**（声明过期或解析漏了）
 *   · `undeclared-but-present` —— 厂商没声明、适配器却解析出了值 ⇒ **不是错误**（实测优先）
 *
 * @param {string} platform
 * @param {Array<{metrics?: object}>} items 适配器产出的作品列表
 * @returns {Array<{metricKey:string, verdict:string, note:string}>}
 */
function checkMetrics (platform, items) {
  const pid = String(platform || '').toLowerCase()
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return []

  // 适配器这次**碰过**的键（键存在即算碰过，值为 null 也算 —— 那正是要抓的情况）
  const touched = new Set()
  for (const it of list) {
    if (it && it.metrics && typeof it.metrics === 'object') {
      for (const k of Object.keys(it.metrics)) touched.add(k)
    }
  }
  if (touched.size === 0) return []

  const matrix = require('@multi-publish/shared-utils/src/platform-metric-matrix')
  const out = []
  for (const metricKey of touched) {
    const values = list.map((it) => (it && it.metrics ? it.metrics[metricKey] : undefined))
    const present = values.filter((v) => v !== null && v !== undefined)
    // 全部为空才算「实测 null」；只要有一条有值就是拿到了
    const value = present.length > 0 ? present[0] : null
    // 直接复用 P1-1 的对账器，别在这里重写判据
    const r = matrix.reconcileObservation({ platformId: pid, metricKey, value })
    if (r.verdict === 'declared-but-null' || r.verdict === 'undeclared-but-present') {
      out.push({ metricKey, verdict: r.verdict, note: r.note || '' })
    }
  }
  return out
}

module.exports = { buildPlatformCapability, checkMetrics, allMetricKeys, CAPABILITY_STATE }
