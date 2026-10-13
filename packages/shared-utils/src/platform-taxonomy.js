/**
 * platform-taxonomy.js — 平台分类对照表的读取层。
 *
 * 数据来源：`config/platform-taxonomy.json`，由 `scripts/import-platform-taxonomy.js` 从
 * 竞品数据资产转换而来（**冻结快照，未联网校验**）。本模块只读，不改写。
 *
 * ## 为什么需要「null 成因可区分」而不是一律返回 null
 *
 * 调用方拿 null 时要做两件**相反**的事：
 *   - 平台本来就没有分类数据（`platform-absent` / `platform-name-only`）
 *     ⇒ **静默跳过**，不写分类字段，不影响发布；
 *   - 用户显式指定了分类名却查不到（`not-found` / `content-type-mismatch` / `ambiguous`）
 *     ⇒ **必须失败**。否则用户以为按分类发，实际落进了平台默认分类 —— 这是"静默发错"。
 * 把这两种情况都收敛成 null，就等于把「没数据」和「用户填错」变得无法区分。
 *
 * ## 为什么 contentType 必须参与查表
 *
 * 实测（B站）：id=21 在**图文**表是「萌宠」、在**视频**表是「日常」；id=4 图文是「动漫杂谈」、
 * 视频是「游戏」。同一个数字在两条链上是两套语义 ⇒ 不区分 contentType 必查错。
 *
 * ## 与 publish-capabilities 的关系
 *
 * 二者是**不同的问题**：后者回答「这个平台能不能设标题/描述」，本模块回答「这个平台的分类 ID 是什么」。
 * 故不合并、也不互相依赖。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** 测试注入用；生产环境走 resolveTaxonomyPath() */
let overridePath = null

/** 缓存键 = 绝对路径；缓存项带 mtimeMs + size（文件被换掉即失效） */
const cache = new Map()

/**
 * 解析分类表路径 —— **复用既有单一真源**，不新造解析链。
 *
 * `platform-config-path.js` 的 `resolvePlatformConfigPath()` 返回 `platforms.yaml` 的**文件路径**，
 * 故分类表 = 同目录换文件名，天然继承 `MULTI_PUBLISH_CONFIG_PATH > MULTI_PUBLISH_ROOT/config >
 * resourcesPath/config > <仓库>/config` 这条既有约定。
 *
 * 该 require 放在 try 里：本模块会被渲染进程的打包链引用，而 platform-config-path 依赖 `app`，
 * 在非 Electron 环境（如脚本/测试）下可能不可用 —— 此时退回「仓库根 /config」。
 */
function resolveTaxonomyPath () {
  if (overridePath) return overridePath
  try {
    const { resolvePlatformConfigPath } = require('./platform-config-path')
    const yamlPath = resolvePlatformConfigPath()
    if (yamlPath) return path.join(path.dirname(yamlPath), 'platform-taxonomy.json')
  } catch { /* 非 Electron 环境，走下面的回退 */ }
  return path.join(__dirname, '..', '..', '..', 'config', 'platform-taxonomy.json')
}

/** 空壳：文件缺失/损坏时用它，让调用方统一按「没有数据」处理而不必到处判 null */
function emptyTaxonomy (why) {
  return { version: 0, source: null, platformsWithoutIdData: [], stats: { platforms: 0, nodes: 0 }, platforms: {}, __loadError: why || null }
}

/** 读取并缓存分类表。**任何失败都不抛** —— 分类表是增强能力，不该炸掉发布链。 */
function loadTaxonomy (opts = {}) {
  const p = opts.filePath || resolveTaxonomyPath()
  let st
  try { st = fs.statSync(p) } catch { return emptyTaxonomy(`分类表不存在: ${p}`) }

  const hit = cache.get(p)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data

  let data
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (err) {
    return emptyTaxonomy(`分类表解析失败: ${err.message}`)
  }
  if (!data || typeof data !== 'object' || !data.platforms || typeof data.platforms !== 'object') {
    return emptyTaxonomy('分类表结构不符（缺少 platforms）')
  }
  cache.set(p, { mtimeMs: st.mtimeMs, size: st.size, data })
  return data
}

/** 深拷贝：浅拷贝会让调用方突变污染缓存里的同一份对象 */
const clone = (v) => JSON.parse(JSON.stringify(v))

/** 取某平台在某 contentType 下的分类块；不存在返回 null */
function blockOf (tax, platformId, contentType) {
  const p = tax.platforms?.[platformId]
  if (!p) return null
  if (!contentType) return null
  const b = p[contentType]
  if (b && Array.isArray(b.nodes)) return b
  // 同平台多来源表（如头条系）以 `article:xxx` 落键，取第一个匹配的
  const alt = Object.keys(p).find((k) => k.split(':')[0] === contentType)
  return alt && Array.isArray(p[alt].nodes) ? p[alt] : null
}

/** 该平台在任何 contentType 下是否有分类数据 */
function anyBlock (tax, platformId) {
  const p = tax.platforms?.[platformId]
  if (!p) return null
  for (const k of Object.keys(p)) if (Array.isArray(p[k]?.nodes) && p[k].nodes.length) return p[k]
  return null
}

/** 取「除指定 contentType 之外」的那些块的分类名（用于 content-type-mismatch 判定与可用集提示） */
function otherBlockNames (tax, platformId, excludeContentType) {
  const p = tax.platforms?.[platformId]
  if (!p) return null
  const names = []
  for (const k of Object.keys(p)) {
    if (k === excludeContentType || k.split(':')[0] === excludeContentType) continue
    for (const n of p[k].nodes || []) names.push(n.name)
  }
  return names.length ? [...new Set(names)] : null
}

// ── 对外 API ──────────────────────────────────────────────────────────────

/**
 * 取某平台某内容类型的分类节点（**深拷贝**）。
 * @throws 缺 contentType 时抛错 —— 不猜，因为猜错会发到错误的分类
 */
function getCategories (platformId, opts = {}) {
  const contentType = opts.contentType
  if (!contentType) {
    throw new Error('getCategories 必须显式传 contentType（article | video）：分类 ID 在两条链上是两套命名空间，猜错会发到错误的分类')
  }
  const tax = loadTaxonomy(opts)
  const b = blockOf(tax, platformId, contentType)
  return b ? clone(b.nodes) : []
}

/**
 * 按「中文分类名」或「分类 ID」解析出平台侧 ID。
 *
 * @returns {{ok:true, id:string, name:string, path:string[], contentType:string}}
 *        | {{ok:false, reason:'platform-absent'|'platform-name-only'|'not-found'|'content-type-mismatch'|'ambiguous', hint?:string, available?:string[], candidates?:Array}}
 */
function resolveCategoryId (platformId, nameOrId, opts = {}) {
  const contentType = opts.contentType
  const tax = loadTaxonomy(opts)
  const p = tax.platforms?.[platformId]

  // ① 平台无任何数据
  if (!p) {
    const nameOnly = Array.isArray(tax.platformsWithoutIdData) && tax.platformsWithoutIdData.includes(platformId)
    return {
      ok: false,
      reason: nameOnly ? 'platform-name-only' : 'platform-absent',
      hint: nameOnly
        ? `${platformId} 仅有分类名称、没有可提交的分类 ID，请勿写入分类字段`
        : `${platformId} 没有分类数据`,
    }
  }
  if (!contentType) {
    return { ok: false, reason: 'content-type-mismatch', hint: '必须传 contentType（article | video）' }
  }

  const b = blockOf(tax, platformId, contentType)
  const nodes = b ? b.nodes : []

  // ② 该 contentType 下无数据，但平台在别的 contentType 下有 ⇒ 给出可用集
  if (nodes.length === 0) {
    const other = anyBlock(tax, platformId)
    if (other) {
      return {
        ok: false,
        reason: 'content-type-mismatch',
        hint: `${platformId} 在 ${contentType} 下没有分类数据`,
        available: [...new Set(other.nodes.map((n) => n.name))].slice(0, 50),
      }
    }
    const nameOnly = Array.isArray(tax.platformsWithoutIdData) && tax.platformsWithoutIdData.includes(platformId)
    return { ok: false, reason: nameOnly ? 'platform-name-only' : 'platform-absent' }
  }

  const key = String(nameOrId).trim()

  // ⓪ 源数据自身有歧义的 id（实测 B站视频表 tid=36 同时是「知识」与「科技」）：
  //    平台按哪个解释从数据里无法判断 ⇒ **拒绝解析并列候选**，绝不按数组顺序猜一个。
  const ambiguousHits = nodes.filter((n) => n.ambiguous && (n.id === key || n.name === key))
  if (ambiguousHits.length > 0) {
    return {
      ok: false,
      reason: 'ambiguous',
      hint: `「${key}」在源数据里对应多个不同分类（id=${ambiguousHits[0].id} 有多个名称），平台侧含义无法确定，请改用明确无歧义的分类`,
      candidates: ambiguousHits.map((n) => ({ id: n.id, name: n.name, depth: n.depth })),
    }
  }

  // ③ 先按 ID 精确匹配，再按名称精确匹配（同名可能多义）
  const byId = nodes.filter((n) => n.id === key)
  const byName = nodes.filter((n) => n.name === key)
  const hit = byId.length ? byId : byName

  if (hit.length === 0) {
    // 回查另一 contentType：名字在那儿 ⇒ 这是「找错链」而不是「名字写错」，
    // 两者对调用方的处置不同（前者可提示切换内容类型，后者必须判失败）。
    const other = otherBlockNames(tax, platformId, contentType)
    if (other && other.includes(key)) {
      return {
        ok: false,
        reason: 'content-type-mismatch',
        hint: `「${key}」是 ${platformId} 在另一个内容类型下的分类，不在 ${contentType} 下`,
        available: other.slice(0, 50),
      }
    }
    return {
      ok: false,
      reason: 'not-found',
      hint: `${platformId}/${contentType} 下没有名为「${key}」的分类`,
      available: [...new Set(nodes.map((n) => n.name))].slice(0, 50),
    }
  }
  if (hit.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      hint: `「${key}」在 ${platformId}/${contentType} 下命中 ${hit.length} 个分类`,
      candidates: hit.map((n) => ({ id: n.id, name: n.name, depth: n.depth })),
    }
  }

  const n = hit[0]
  const chain = []
  let cur = n
  for (let i = 0; i < 8 && cur; i++) {
    chain.unshift(cur.name)
    cur = cur.parentId ? nodes.find((x) => x.id === cur.parentId) : null
  }
  return { ok: true, id: n.id, name: n.name, path: chain, contentType }
}

/** 该平台是否有可提交的分类 ID（决定 UI 是否渲染分类控件） */
function hasPlatformCategories (platformId, opts = {}) {
  const tax = loadTaxonomy(opts)
  return !!anyBlock(tax, platformId)
}

/**
 * 档位查询：`id` = 有可提交 ID；`name-only` = 只有名称（不可提交）；
 * `absent` = 完全没有分类数据。
 */
function getTaxonomyCoverage (platformId, opts = {}) {
  const tax = loadTaxonomy(opts)
  if (anyBlock(tax, platformId)) return 'id'
  if (Array.isArray(tax.platformsWithoutIdData) && tax.platformsWithoutIdData.includes(platformId)) return 'name-only'
  return 'absent'
}

/** 搜索式下拉的数据源：命中任一层名称即算，大小写不敏感 */
function searchCategories (platformId, keyword, opts = {}) {
  const contentType = opts.contentType
  const tax = loadTaxonomy(opts)
  const collect = (nodes) => {
    const kw = String(keyword ?? '').trim().toLowerCase()
    if (!kw) return []
    return nodes.filter((n) => String(n.name).toLowerCase().includes(kw))
  }
  if (contentType) return clone(collect(blockOf(tax, platformId, contentType)?.nodes || []))
  // 未指定 contentType 时跨全部块搜（只读展示场景），去重
  const p = tax.platforms?.[platformId]
  if (!p) return []
  const seen = new Set(); const out = []
  for (const k of Object.keys(p)) {
    for (const n of collect(p[k].nodes || [])) {
      const dk = `${n.id}\u0000${n.name}`
      if (!seen.has(dk)) { seen.add(dk); out.push(n) }
    }
  }
  return clone(out)
}

/**
 * 结构自检，返回问题清单（空数组 = 健康）。参照 publish-capabilities 的同名做法。
 * 检查：文件可读 / 必需字段 / id 非空且块内唯一 / parentId 不悬空 / nodes 非空 / 深度自洽。
 */
function validateTaxonomy (opts = {}) {
  const issues = []
  const tax = loadTaxonomy(opts)
  if (tax.__loadError) { issues.push(tax.__loadError); return issues }
  if (typeof tax.version !== 'number') issues.push('缺少 version')
  if (!tax.source || typeof tax.source.snapshotDate !== 'string') issues.push('缺少 source.snapshotDate')
  if (tax.source && tax.source.verifiedOnline !== false) {
    issues.push('source.verifiedOnline 必须显式为 false —— 本数据从未联网校验，不标注会让读者误以为已核验')
  }

  for (const [pid, blocks] of Object.entries(tax.platforms)) {
    for (const [key, b] of Object.entries(blocks)) {
      const where = `${pid}/${key}`
      if (!Array.isArray(b.nodes)) { issues.push(`${where}: nodes 不是数组`); continue }
      if (b.nodes.length === 0) { issues.push(`${where}: nodes 为空（空块不应写入产出）`); continue }
      if (b.nodeCount !== b.nodes.length) issues.push(`${where}: nodeCount(${b.nodeCount}) 与 nodes.length(${b.nodes.length}) 不一致`)

      const ids = new Set()
      for (const n of b.nodes) if (n.id !== null && n.id !== undefined && n.id !== '') ids.add(n.id)
      const seen = new Set()
      for (const n of b.nodes) {
        if (n.id === null || n.id === undefined || n.id === '') issues.push(`${where}: 存在 id 为空的节点（${n.name}）`)
        else if (seen.has(n.id)) issues.push(`${where}: 重复 id ${n.id}（${n.name}）`)
        else seen.add(n.id)
        if (!n.name) issues.push(`${where}: id=${n.id} 缺 name`)
        // 两遍：父节点可能排在本节点之后，一遍扫描会把合法层级误报成悬空
        if (n.depth !== 1 && !ids.has(n.parentId)) issues.push(`${where}: id=${n.id} 的 parentId=${n.parentId} 悬空`)
      }
    }
  }
  return issues
}

// ── 测试注入（生产不调用）────────────────────────────────────────────────
function setTaxonomyPathForTest (p) { overridePath = p }
/**
 * 只清**缓存**，**不清 overridePath**。
 * 合并成一个函数会让测试在第二次 reset 后静默回退到真实 config —— 实测该形状导致
 * 「断言读到真实数据却以为在测 fixture」，且失败信息看起来像业务逻辑错（本案真实发生）。
 */
function __resetTaxonomyCacheForTest () { cache.clear() }
/** 显式清 override，需要回到生产路径时才调用 */
function __clearTaxonomyOverrideForTest () { overridePath = null; cache.clear() }

module.exports = {
  loadTaxonomy,
  getCategories,
  resolveCategoryId,
  hasPlatformCategories,
  getTaxonomyCoverage,
  searchCategories,
  validateTaxonomy,
  // 测试专用
  setTaxonomyPathForTest,
  __resetTaxonomyCacheForTest,
  __clearTaxonomyOverrideForTest,
  resolveTaxonomyPath,
}
