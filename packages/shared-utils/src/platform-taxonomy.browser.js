// 渲染端（vite dev / build）使用的 ESM 平台分类表孪生文件。
// 主进程仍使用 platform-taxonomy.js（CommonJS），避免改变 Node 端契约。
//
// ## 与 CJS 版的差异**只在数据来源**，函数层逐字对齐
//
// CJS 版用 `fs` + `path` **运行期读文件**，并为此设计：路径解析链
// （`MULTI_PUBLISH_CONFIG_PATH > MULTI_PUBLISH_ROOT/config > resourcesPath/config > <仓库>/config`）、
// 按 mtimeMs + size 失效的缓存、读失败时的 `__loadError` 空壳、以及测试注入口
// （`setTaxonomyPathForTest` / `__resetTaxonomyCacheForTest` / `__clearTaxonomyOverrideForTest`）。
// 这些在浏览器里**一概不可用**（没有 fs），也**不必要**：
//
//   渲染端数据是**构建期静态引入**的 —— JSON 缺失或损坏，**打包当场失败**，
//   而非运行期返回空表。这是比 CJS 版**更强**的保证。
//
// 因此本文件**刻意不实现**路径解析/缓存/`__loadError`/测试注入口，
// 但**业务函数（getCategories / resolveCategoryId / getTaxonomyCoverage /
// hasPlatformCategories / searchCategories）与 CJS 版同签名同语义** —— 包括
// `article:xxx` 多来源表键、`opts.contentType` 位置、各 reason 分支。
// 漂移由 `__tests__/platform-taxonomy-browser.test.js` 的 parity 回归拦截。
//
// ## 数据单一来源
//
// 两侧共同消费 `config/platform-taxonomy.json`（由 `scripts/import-platform-taxonomy.js` 生成）。
// **禁止在本文件复制任何分类数据**。
import taxonomyData from '../../../config/platform-taxonomy.json'

/** CJS 版 loadTaxonomy 的渲染端对应物：构建期已加载，恒返回同一份 */
export function loadTaxonomy () {
  return taxonomyData
}

/** 深拷贝（与 CJS 版同语义：调用方改返回值不影响本模块） */
function clone (v) {
  return JSON.parse(JSON.stringify(v))
}

/** 取某平台某 contentType 的块；`article:xxx` 这类多来源表键取第一个前缀匹配的 */
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

/** 取「除指定 contentType 之外」那些块的分类名（用于 content-type-mismatch 与可用集提示） */
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

// ── 对外 API（与 CJS 版同签名同语义）─────────────────────────────────────────

/**
 * 取某平台某内容类型的分类节点（**深拷贝**）。
 * @param {object} [opts] `{ contentType }` —— **必填**
 * @throws 缺 contentType 时抛错 —— 不猜，因为猜错会发到错误的分类
 */
export function getCategories (platformId, opts = {}) {
  const contentType = opts.contentType
  if (!contentType) {
    throw new Error('getCategories 必须显式传 contentType（article | video）：分类 ID 在两条链上是两套命名空间，猜错会发到错误的分类')
  }
  const b = blockOf(loadTaxonomy(), platformId, contentType)
  return b ? clone(b.nodes) : []
}

/**
 * 按「中文分类名」或「分类 ID」解析出平台侧 ID。
 *
 * ⚠️ 本函数与 CJS 版**逐分支对齐**（含 `n.ambiguous` 预标、严格 `===` 比较、
 * path 上溯 8 层上限、各分支的 available 取自哪一份 nodes）。
 * 首轮实现因「按假设写」而非「照 CJS 读」导致 7 处漂移，parity 锁抓出后重写。
 *
 * @returns {{ok:true, id:string, name:string, path:string[], contentType:string}}
 *        | {{ok:false, reason:'platform-absent'|'platform-name-only'|'not-found'|'content-type-mismatch'|'ambiguous', hint?:string, available?:string[], candidates?:Array}}
 */
export function resolveCategoryId (platformId, nameOrId, opts = {}) {
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

/** 该平台在任何 contentType 下是否有分类数据 */
export function hasPlatformCategories (platformId, opts = {}) {
  void opts
  return !!anyBlock(loadTaxonomy(), platformId)
}

/**
 * 档位查询：`id` = 有可提交 ID；`name-only` = 只有名称（不可提交）；`absent` = 完全没有分类数据。
 * ⚠️ 判据是 `anyBlock` —— **任一** contentType 有数据即算 `id`（与 CJS 版一致）。
 */
export function getTaxonomyCoverage (platformId, opts = {}) {
  void opts
  const tax = loadTaxonomy()
  if (anyBlock(tax, platformId)) return 'id'
  if (Array.isArray(tax.platformsWithoutIdData) && tax.platformsWithoutIdData.includes(platformId)) return 'name-only'
  return 'absent'
}

/** 搜索式下拉的数据源：命中**名称**即算，大小写不敏感（CJS 版同样不匹配 ID） */
export function searchCategories (platformId, keyword, opts = {}) {
  const contentType = opts.contentType
  const tax = loadTaxonomy()
  const collect = (nodes) => {
    const kw = String(keyword ?? '').trim().toLowerCase()
    if (!kw) return []
    return nodes.filter((n) => String(n.name).toLowerCase().includes(kw))
  }
  if (contentType) return clone(collect(blockOf(tax, platformId, contentType)?.nodes || []))
  // 未指定 contentType 时跨全部块搜（只读展示场景），按 id+name 去重
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

/** 本分类表的版本与来源信息（供 UI 显示「数据快照日期」；**不可省略** —— 见 PRD §14.2） */
export const TAXONOMY_SOURCE = Object.freeze({
  version: taxonomyData.version,
  snapshotDate: taxonomyData.source && taxonomyData.source.snapshotDate,
  verifiedOnline: !!(taxonomyData.source && taxonomyData.source.verifiedOnline),
})

/** 完整表（供 parity 锁与调试用；业务代码请用上面的函数） */
export const TAXONOMY_DATA = taxonomyData
