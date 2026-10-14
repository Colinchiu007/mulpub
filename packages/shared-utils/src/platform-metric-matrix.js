/**
 * platform-metric-matrix —— 平台指标矩阵的读取层（CJS，主进程）。
 *
 * ## 定位：**参考数据，不是运行时真源**
 *
 * 运行时真源仍是 `account-metrics/adapters.js` 的实际字段解析。本模块只服务两件事：
 *   ① UI 文案（告诉用户「这个平台能拿到哪些指标」）；
 *   ② 测试的交叉校验（`reconcileObservation`）。
 *
 * ## ★★ 本模块**不得**用于请求门控
 *
 * 厂商矩阵是**他们产品的**能力边界，不是本仓的。本仓实测能拿到的，即使厂商没声明，
 * 也**应采信实测** —— 这正是 `reconcileObservation` 里 `undeclared-but-present` **不是错误**的原因。
 * 反过来（厂商声明有、实测 `null`）才值得告警（声明过期或适配器漏解析）。
 *
 * ## 为什么是二维结构
 *
 * 源 ini 有两个段，**同名不同义**：段 `[1]` 的 `id=1` 是「总收益」，段 `[2]` 的 `id=1` 是「收益」；
 * 且**两段平台覆盖不同**。压成「平台 → 指标」一维会让两者互相覆盖，故一律按 `group` 分组访问。
 *
 * ## 缓存
 *
 * 按 `mtimeMs + size` 失效（与 platform-taxonomy 同法）。`setMatrixPathForTest` /
 * `__resetMatrixCacheForTest` / `__clearMatrixOverrideForTest` 供测试注入。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const SUPPORTED_SCHEMA_VERSION = 1

/** 三态 + 两种未知：**必须**区分「平台没这指标」与「我们不知道这个平台」 */
const SUPPORT_STATES = Object.freeze([
  'declared-available',
  'declared-unavailable',
  'unknown-platform',
  'unknown-metric',
])

const VERDICTS = Object.freeze(['consistent', 'declared-but-null', 'undeclared-but-present', 'unknown'])

let __overridePath = null
let __cache = null
let __cacheKey = null

/** 默认产物路径。与 platform-taxonomy 同一条解析链（env 覆盖 → 仓库 config → resourcesPath）。 */
function defaultMatrixPath () {
  if (process.env.MULTI_PUBLISH_METRIC_MATRIX_PATH) return process.env.MULTI_PUBLISH_METRIC_MATRIX_PATH
  const candidates = []
  if (process.env.MULTI_PUBLISH_ROOT) candidates.push(path.join(process.env.MULTI_PUBLISH_ROOT, 'config', 'platform-metric-matrix.json'))
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'config', 'platform-metric-matrix.json'))
  candidates.push(path.join(__dirname, '..', '..', '..', 'config', 'platform-metric-matrix.json'))
  for (const c of candidates) if (c && fs.existsSync(c)) return c
  return candidates[candidates.length - 1]
}

function matrixPath () {
  return __overridePath || defaultMatrixPath()
}

/**
 * 载入矩阵（带缓存）。
 * @throws 文件缺失 / JSON 非法 / schemaVersion 不认识 —— 一律 fail-loud，不返回空表
 */
function loadMatrix (options = {}) {
  const p = options.path || matrixPath()
  let stat
  try {
    stat = fs.statSync(p)
  } catch (e) {
    const err = new Error(`平台指标矩阵不存在：${p}（不得静默退化，否则 UI 会显示「所有平台都没有指标」）`)
    err.code = 'METRIC_MATRIX_MISSING'
    throw err
  }
  const key = `${p}\u0000${stat.mtimeMs}\u0000${stat.size}`
  if (__cache && __cacheKey === key && !options.force) return __cache

  const raw = fs.readFileSync(p, 'utf8')
  let data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    const err = new Error(`平台指标矩阵 JSON 非法（${p}）：${e.message}`)
    err.code = 'METRIC_MATRIX_INVALID_JSON'
    throw err
  }
  if (data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    const err = new Error(
      `平台指标矩阵 schemaVersion=${data.schemaVersion} 不被支持（本层认 ${SUPPORTED_SCHEMA_VERSION}）—— ` +
      '拒绝按旧结构解释新数据'
    )
    err.code = 'METRIC_MATRIX_SCHEMA_UNSUPPORTED'
    throw err
  }
  __cache = data
  __cacheKey = key
  return data
}

/** 该平台在矩阵里被收录了吗（任一 group 出现即算） */
function isKnownPlatform (platformId, m) {
  for (const g of Object.keys(m.groups || {})) {
    if (m.groups[g].platforms && Object.prototype.hasOwnProperty.call(m.groups[g].platforms, platformId)) return true
  }
  return false
}

/**
 * 某平台的指标能力清单。
 *
 * 未收录平台返回 **空数组**（不是 `null`）—— 调用方拿到 `[]` 可以直接 `for` 而不用先判空，
 * 且「未收录」与「收录了但一个指标都没有」在数据层不可能同时存在（后者会被转换器拒绝）。
 *
 * @returns {Array<{metricKey:string,label:string,group:'content'|'trend',groupId:string,rawMetricId:string}>}
 */
function getPlatformMetricCapabilities (platformId) {
  const m = loadMatrix()
  const out = []
  for (const [gid, g] of Object.entries(m.groups || {})) {
    const ids = g.platforms && g.platforms[platformId]
    if (!Array.isArray(ids)) continue
    for (const mid of ids) {
      const label = (g.metrics && g.metrics[mid]) || null
      const metricKey = (m.metricKeyMap && m.metricKeyMap[gid] && m.metricKeyMap[gid][mid]) || null
      out.push({ metricKey, label, group: g.key, groupId: gid, rawMetricId: mid })
    }
  }
  return out
}

/**
 * 三态查询：某平台是否声明能拿到某指标。
 *
 * **必须区分** `declared-unavailable`（平台没这指标）与 `unknown-platform`（我们不知道这个平台）——
 * 压成 boolean 会让二者在 UI 上都显示成「无」，用户无法分辨「平台不支持」与「我们没这个平台的数据」。
 *
 * @returns {'declared-available'|'declared-unavailable'|'unknown-platform'|'unknown-metric'}
 */
function getMetricSupport (platformId, metricKey) {
  const m = loadMatrix()
  if (!isKnownPlatform(platformId, m)) return 'unknown-platform'

  // 该 metricKey 在本表里存在吗（任一 group 的映射里出现即算）
  let metricKnown = false
  for (const gid of Object.keys(m.metricKeyMap || {})) {
    if (Object.values(m.metricKeyMap[gid]).includes(metricKey)) { metricKnown = true; break }
  }
  if (!metricKnown) return 'unknown-metric'

  for (const [gid, g] of Object.entries(m.groups || {})) {
    const ids = g.platforms && g.platforms[platformId]
    if (!Array.isArray(ids)) continue
    const map = (m.metricKeyMap && m.metricKeyMap[gid]) || {}
    for (const mid of ids) if (map[mid] === metricKey) return 'declared-available'
  }
  return 'declared-unavailable'
}

/**
 * 把一条实测观察与厂商矩阵对账（**供测试交叉校验**）。
 *
 * verdict 含义：
 *   · `consistent`               —— 声明有且实测有值 / 声明无且实测无值
 *   · `declared-but-null`        —— **声明拿得到但实测 null** ⇒ 值得告警（声明过期或适配器漏解析）
 *   · `undeclared-but-present`   —— **声明拿不到但实测有值** ⇒ ★ **不是错误**
 *   · `unknown`                  —— 平台或指标不在本表里
 *
 * ★ `undeclared-but-present` 不是错误：厂商矩阵是**他们产品的**能力边界。
 *   本仓实测能拿到的即使厂商没声明也应采信实测。**禁止**把它当异常上报或据此拦住请求。
 *
 * @param {{platformId:string, metricKey:string, value:unknown}} observation
 * @returns {{verdict:string, note?:string}}
 */
function reconcileObservation (observation) {
  const { platformId, metricKey, value } = observation || {}
  const has = value !== null && value !== undefined
  const support = getMetricSupport(platformId, metricKey)

  if (support === 'unknown-platform' || support === 'unknown-metric') {
    return { verdict: 'unknown', note: `矩阵里没有 ${platformId}/${metricKey}（${support}），无从对账` }
  }
  if (support === 'declared-available') {
    return has
      ? { verdict: 'consistent' }
      : {
          verdict: 'declared-but-null',
          note: `矩阵声明 ${platformId} 能拿到 ${metricKey}，但实测为 ${value === null ? 'null' : 'undefined'} —— 可能声明已过期或适配器漏解析`,
        }
  }
  // declared-unavailable
  return has
    ? {
        verdict: 'undeclared-but-present',
        note: `${platformId} 未声明 ${metricKey}，但实测有值（${JSON.stringify(value).slice(0, 40)}）—— ★ 这不是错误：矩阵是厂商的能力边界，实测优先`,
      }
    : { verdict: 'consistent' }
}

/**
 * 结构自检。返回问题清单（空数组 = 通过）。
 * 与转换器的 fail-loud 互补：转换器管「生成时正确」，这里管「用到的这份没坏」。
 */
function validateMatrix () {
  const problems = []
  let m
  try {
    m = loadMatrix()
  } catch (e) {
    return [`载入失败：${e.message}`]
  }

  if (m.schemaVersion !== SUPPORTED_SCHEMA_VERSION) problems.push(`schemaVersion 应为 ${SUPPORTED_SCHEMA_VERSION}`)
  if (!m.groups || typeof m.groups !== 'object' || Object.keys(m.groups).length === 0) problems.push('groups 缺失或为空')
  if (!m.metricKeyMap || Object.keys(m.metricKeyMap).length === 0) problems.push('metricKeyMap 缺失或为空')

  for (const [gid, g] of Object.entries(m.groups || {})) {
    if (!g.key) problems.push(`groups.${gid} 缺 key`)
    if (!g.metrics || Object.keys(g.metrics).length === 0) problems.push(`groups.${gid}.metrics 为空`)
    if (!g.platforms || typeof g.platforms !== 'object') problems.push(`groups.${gid}.platforms 缺失`)
    for (const [pid, ids] of Object.entries(g.platforms || {})) {
      if (!Array.isArray(ids) || ids.length === 0) { problems.push(`groups.${gid}.platforms.${pid} 不是非空数组`); continue }
      const dup = ids.filter((v, i) => ids.indexOf(v) !== i)
      if (dup.length) problems.push(`groups.${gid}.platforms.${pid} 有重复指标 id：${[...new Set(dup)].join(',')}`)
      for (const mid of ids) {
        if (!g.metrics[mid]) problems.push(`groups.${gid}.platforms.${pid} 引用了未声明的指标 ${mid}`)
        if (!m.metricKeyMap[gid] || !m.metricKeyMap[gid][mid]) {
          problems.push(`groups.${gid}.platforms.${pid} 的指标 ${mid} 在 metricKeyMap[${gid}] 里没有映射`)
        }
      }
    }
  }
  // 每个 group 至少要有一个平台，否则这一维形同虚设
  for (const [gid, g] of Object.entries(m.groups || {})) {
    if (!Object.keys(g.platforms || {}).length) problems.push(`groups.${gid} 一个平台都没有`)
  }
  return problems
}

// ── 测试注入口（仅测试用；生产不调用）──────────────────────────────────────
function setMatrixPathForTest (p) { __overridePath = p; __cache = null; __cacheKey = null }
function __resetMatrixCacheForTest () { __cache = null; __cacheKey = null }
function __clearMatrixOverrideForTest () { __overridePath = null; __cache = null; __cacheKey = null }

module.exports = {
  SUPPORT_STATES,
  VERDICTS,
  loadMatrix,
  getPlatformMetricCapabilities,
  getMetricSupport,
  reconcileObservation,
  validateMatrix,
  setMatrixPathForTest,
  __resetMatrixCacheForTest,
  __clearMatrixOverrideForTest,
}
