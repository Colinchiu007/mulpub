/**
 * collection-batch.js — 采集页批量动作渲染层契约（2026-10-03）
 *
 * PRD-ZHIHU-FAV-BATCH-2026-10-03 §3.4/§3.6：
 *  - mapFavBatchResultsToItems：zhihu-fav-batch:run 结果 → collected_items 条目。
 *    ⚠ P0 回归锁来源（2026-10-03 摸底）：旧链路 `...x.data.data` 多取一层导致
 *    title/content/sourceUrl 全丢。本函数是唯一映射出口，mock/真实 IPC 形状
 *    统一为 {index, ok, duplicate?, data:{...}}。
 *  - buildBatchArticles：发布取稿规则 —— 改写稿优先（Q26C），无改写稿/改写失败
 *    回退原文；coverImage → cover_url 映射（封面丢失修复）；images 透传。
 *  - groupItemsByKind / usablePlatformIds / buildBatchTargets：平台预筛（D8）
 *    与 目标展开（对齐 publish-contract.buildPublishTargets 语义）。
 *
 * 纯函数、无 IO；Collection.vue 消费。
 */

/**
 * 平台预筛单一真源：contentCategory（platforms.yaml / stores/platforms DEFAULT_CONTENT_CATEGORIES）。
 * QM-6 m1 修复：删除本地 VIDEO_ONLY/MIXED 白名单双真源——分类只信传入的 contentCategory，
 * 避免名单与 yaml/store 漂移（xiaohongshu 在生产是 IMAGE_TEXT，曾被白名单误抬进视频域）。
 */

/**
 * zhihu-fav-batch:run 的 results → collected_items 条目（唯一映射出口）。
 * @param {Array<{index:number, ok:boolean, duplicate?:boolean, data?:object}>} results
 * @param {Array<{url:string, kind?:string, favTime?:number, title?:string}>} listItems - 勾选的清单条目（按 index 对齐）
 * @param {{ source?: string }} [opts]
 * @returns {Array<object>} 仅 ok 且非 duplicate 的条目
 */
export function mapFavBatchResultsToItems (results, listItems, opts = {}) {
  if (!Array.isArray(results) || !Array.isArray(listItems)) return []
  const out = []
  for (const res of results) {
    if (!res || res.ok !== true || res.duplicate === true) continue
    const d = res.data && typeof res.data === 'object' ? res.data : {}
    if (!d.title && !d.content) continue // 防空壳（与主进程 isSubstantive 双保险）
    const li = listItems[res.index] || {}
    out.push({
      id: d.id || undefined,
      title: String(d.title || li.title || ''),
      content: String(d.content || ''),
      description: String(d.description || ''),
      coverImage: String(d.coverImage || ''),
      publishTime: String(d.publishTime || ''),
      source: opts.source || 'zhihu-fav',
      sourceUrl: String(li.url || d.sourceUrl || ''),
      kind: li.kind || d.kind || 'unknown',
      favTime: Number(li.favTime ?? d.favTime ?? 0) || 0,
      images: Array.isArray(d.images) ? d.images : [],
      imageFallbacks: Array.isArray(d.imageFallbacks) ? d.imageFallbacks : [],
      rewrittenContent: d.rewrittenContent || undefined,
      // 改写稿实际字数（feat-zhihu-fav-batch-wordcount）：主进程回传（Python 的 word_count，码点口径）。
      // 缺省 ⇒ undefined（不伪造 0：0 会被读成「改写稿 0 字」）。
      rewrittenWordCount: Number(d.rewrittenWordCount) > 0 ? Number(d.rewrittenWordCount) : undefined,
      rewriteFailed: d.rewriteFailed === true,
      createdAt: d.createdAt || new Date().toISOString(),
    })
  }
  return out
}

/**
 * 发布取稿：改写稿优先，回退原文。
 * @param {Array<object>} items - collected_items 勾选条目
 * @returns {Array<{title:string, content:string, cover_url:string, coverImage:string, images:string[], sourceUrl:string}>}
 */
export function buildBatchArticles (items) {
  if (!Array.isArray(items)) return []
  return items.map((it) => {
    const src = it && typeof it === 'object' ? it : {}
    const useRewritten = typeof src.rewrittenContent === 'string' && src.rewrittenContent.trim()
    return {
      title: String(src.title || ''),
      content: useRewritten ? src.rewrittenContent : String(src.content || ''),
      cover_url: String(src.coverImage || ''),
      coverImage: String(src.coverImage || ''),
      images: Array.isArray(src.images) ? src.images.filter(Boolean) : [],
      sourceUrl: String(src.sourceUrl || ''),
    }
  })
}

/**
 * 统计将使用原文（无改写稿/改写失败）的条数——确认框展示。
 * @param {Array<object>} items
 * @returns {number}
 */
export function countOriginalFallback (items) {
  if (!Array.isArray(items)) return 0
  return items.filter((it) => !(it && typeof it.rewrittenContent === 'string' && it.rewrittenContent.trim())).length
}

/**
 * 按内容形态分组：视频型（仅登记 kind=video）vs 图文型。
 * 历史/未知条目默认归图文型（与旧数据兼容）。
 * @param {Array<object>} items
 * @returns {{ imageText: Array, videoOnly: Array }}
 */
export function groupItemsByKind (items) {
  const imageText = []
  const videoOnly = []
  for (const it of Array.isArray(items) ? items : []) {
    if (it && it.kind === 'video') videoOnly.push(it)
    else imageText.push(it)
  }
  return { imageText, videoOnly }
}

/**
 * 平台预筛：图文条目排除 VIDEO 类平台；视频条目仅 VIDEO+MIXED。
 * @param {'imageText'|'video'} kind
 * @param {Array<{id:string, contentCategory?:string}>} platforms - platforms.yaml 派生清单
 * @returns {string[]}
 */
export function usablePlatformIds (kind, platforms) {
  if (!Array.isArray(platforms)) return []
  const isVideoKind = kind === 'video'
  return platforms
    .filter((p) => p && p.id)
    .filter((p) => {
      const cat = String(p.contentCategory || 'IMAGE_TEXT').toUpperCase()
      if (isVideoKind) return cat === 'VIDEO' || cat === 'MIXED'
      return cat !== 'VIDEO'
    })
    .map((p) => p.id)
}

/**
 * 目标展开：平台 × 该平台选中账号 笛卡尔（无账号平台保留 accountId:null 兼容旧流程）。
 * 语义对齐 src/features/publish/publish-contract.js buildPublishTargets。
 * @param {string[]} platformIds
 * @param {Array<{platform:string, accountId:string}>} selectedAccounts
 * @returns {Array<{platform:string, accountId:string|null}>}
 */
export function buildBatchTargets (platformIds, selectedAccounts) {
  const ids = Array.isArray(platformIds) ? platformIds : []
  const accs = Array.isArray(selectedAccounts) ? selectedAccounts : []
  const byPlatform = {}
  for (const a of accs) {
    if (!a || !a.platform) continue
    if (!byPlatform[a.platform]) byPlatform[a.platform] = []
    byPlatform[a.platform].push(a.accountId || null)
  }
  const out = []
  for (const pid of ids) {
    const list = byPlatform[pid]
    if (Array.isArray(list) && list.length) {
      for (const acc of list) out.push({ platform: pid, accountId: acc })
    } else {
      out.push({ platform: pid, accountId: null })
    }
  }
  return out
}
