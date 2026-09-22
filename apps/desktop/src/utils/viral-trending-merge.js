// @ts-check
/**
 * viral-trending-merge — 爆款分析 F3 热门选题并源纯逻辑（viral-library-integration P1-b）
 *
 * 从 ViralAnalysis.vue 拆出，规避主 .vue 越过债务熔断 1000 行预算。全部为纯函数：
 * 不触网、不依赖组件实例，输入原始响应/文本 → 输出结构化选题列表，便于单测与复用。
 * - collectTrendingArticles：手动文章 JSON ∪ 爆款库条目 → 去重后的分析样本 + 来源标题集合；
 * - mapLocalKeywords：viralTrending IPC 词 → 带 src（library/articles）的本地信号；
 * - mapHotlistTopics：热榜缓存 topics → 带 hotlist 徽标的外部信号（截 40 字）；
 * - mergeTrending：hotlist 恒前 + 去重 + 截断（上限 12）。
 */

/**
 * 汇总 F3 分析样本：优先手动文章（src=articles），再并入爆款库前 30 条（src=library），
 * 按标题去重（首见胜出）。同时收集来源标题集合，供热榜/本地词的来源徽标归属判断。
 * @param {string} articleDataStr - 组件内手动文章 JSON 文本（可能为空/非法）
 * @param {{ code?: number, data?: { items?: any[] } }|null} libRes - listViralItems 原始响应
 * @returns {{ articles: any[], libTitles: Set<string>, artTitles: Set<string> }}
 */
export function collectTrendingArticles (articleDataStr, libRes) {
  const articles = []
  const seen = new Set()
  const libTitles = new Set()
  const artTitles = new Set()
  const push = (a, src) => {
    if (!a || typeof a !== 'object') return
    const title = typeof a.title === 'string' ? a.title.trim() : ''
    if (!title || seen.has(title)) return
    seen.add(title)
    if (src === 'library') libTitles.add(title)
    else artTitles.add(title)
    articles.push(a)
  }
  const raw = typeof articleDataStr === 'string' ? articleDataStr.trim() : ''
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) parsed.forEach((x) => push(x, 'articles'))
    } catch { /* 非法 JSON 静默忽略 */ }
  }
  const items = libRes && libRes.code === 0 && libRes.data && Array.isArray(libRes.data.items)
    ? libRes.data.items.slice(0, 30) : []
  items.forEach((it) => push({
    title: it && it.title,
    like_count: Number(it && it.likes) || 0,
    comment_count: Number(it && it.comments) || 0,
    platform_code: (it && it.platform) || 'general',
  }, 'library'))
  return { articles, libTitles, artTitles }
}

/**
 * viralTrending IPC 返回词 → 本地信号（src 依来源标题集合判定，未命中默认 library）。
 * @param {{ keywords?: any[] }|null} resData - res.data（code!==0 时传 null）
 * @param {Set<string>} libTitles @param {Set<string>} artTitles
 * @returns {Array<{ word: string, count: any, src: string }>}
 */
export function mapLocalKeywords (resData, libTitles, artTitles) {
  const keywords = resData && Array.isArray(resData.keywords) ? resData.keywords : []
  return keywords
    .filter((k) => k && typeof k.word === 'string' && k.word.trim())
    .map((k) => {
      const w = k.word.trim()
      const src = libTitles.has(w) ? 'library' : (artTitles.has(w) ? 'articles' : 'library')
      return { word: w, count: k.count, src }
    })
}

/**
 * 热榜缓存 topics → 外部信号（src=hotlist，截 40 字）。code!==0 / 结构缺失 → 空数组。
 * @param {{ code?: number, data?: { topics?: any[] } }|null} cached
 * @returns {Array<{ word: string, src: string }>}
 */
export function mapHotlistTopics (cached) {
  const topics = cached && cached.code === 0 && cached.data && Array.isArray(cached.data.topics)
    ? cached.data.topics : []
  return topics
    .filter((x) => x && typeof x.topic === 'string' && x.topic.trim())
    .map((x) => ({ word: String(x.topic).trim().slice(0, 40), src: 'hotlist' }))
}

/**
 * 并源：hotlist 恒前（外部热度 > 内部词频）+ 跨源去重（首见胜出）+ 截断。
 * @param {Array<{ word: string }>} hot @param {Array<{ word: string }>} local
 * @param {number} [cap=12]
 * @returns {Array<{ word: string, src: string }>}
 */
export function mergeTrending (hot, local, cap = 12) {
  const hotSeen = new Set()
  return hot
    .filter((k) => !hotSeen.has(k.word) && (hotSeen.add(k.word) || true))
    .concat(local.filter((k) => !hotSeen.has(k.word) && (hotSeen.add(k.word) || true)))
    .slice(0, cap)
}
