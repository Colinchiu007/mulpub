/**
 * gyread.com（AI 情报日报）渠道解析（自 channels.js 拆出）
 *
 * 拆出的理由同 html-utils.js：本文件随渠道解析器一同增长，触发 `NEW_OVER_LIMIT`。
 * gyread 是**独立来源**（每日编辑精选的日报，不是热度榜单），与其它渠道解析逻辑无关 ⇒ 单独成模块。
 * 函数体逐字搬移，行为不变。
 */

const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')
const { decodeHtmlEntities, stripTags, stripTagsJoined, extractLinks } = require('./html-utils.js')

const sanitizeUrl = safeHttpUrl

/**
 * gyread.com（AI 情报日报）索引解析 —— `https://gyread.com/news/search-index.json`。
 *
 * 该站是**每日编辑精选的日报**而非热度榜单：无 `hotValue`（一律 `null`，这也是它
 * MUST NOT 进 `CHANNEL_CONFIGS` 的原因）、榜单序是编辑意志、全量 1421 条远超单轮
 * 候选上限 ⇒ 调用方**必须**传 `date` 或 `days` 过滤。
 *
 * ⚠️ 合规：用途是「检索/引用」（用户点回原文），**不得**用作训练语料。
 * 站点 robots.txt 在 `User-agent: *` 组禁 `/news/`，Allow 只给具名检索 UA；
 * 故当前**默认不启用**（见 `hot-topics-service.js` 的 `GYREAD_SOURCE` 说明）。
 *
 * @param {object|null} json `{generated, pages, count, items[]}`，item 含 u/d/c/t/s/g
 * @param {{date?: string, days?: number}} [filter] date=单日；days=最近 N 个日期
 * @returns {Array<{channel:string, rank:number, topic:string, hotValue:null, url:string|null, rawCategory:string|null, rawDate:string}>}
 */
function parseGyreadIndex (json, filter = {}) {
  const items = (json && Array.isArray(json.items)) ? json.items : []
  /** 去重后的日期集合，倒序（最新在前）——`days` 过滤据此取窗口 */
  const dates = []
  for (const it of items) {
    const d = typeof it.d === 'string' ? it.d : ''
    if (d && !dates.includes(d)) dates.push(d)
  }
  const sortedDates = dates.sort().reverse()
  /** @type {Set<string>|null} */
  let allowed = null
  if (typeof filter.date === 'string' && filter.date) {
    allowed = new Set([filter.date])
  } else if (Number.isFinite(filter.days) && filter.days > 0) {
    allowed = new Set(sortedDates.slice(0, Math.floor(filter.days)))
  }
  const out = []
  for (const it of items) {
    const topic = String((it && it.t) || '').trim()
    const d = typeof it.d === 'string' ? it.d : ''
    const rel = String((it && it.u) || '').trim()
    // 无标题或无日报页地址 → 丢弃：前者无选题，后者无从溯源也无从做原文链接增强
    if (!topic || !rel) continue
    if (allowed && !allowed.has(d)) continue
    out.push({
      channel: 'gyread',
      // rank 在过滤后重新连续编号：跨日期名次断层会让 UI 序号与 scorer 名次兜底失真
      rank: out.length + 1,
      topic,
      hotValue: null,
      url: sanitizeUrl('https://gyread.com/news/' + rel.replace(/^\/+/, '')),
      rawCategory: (typeof it.c === 'string' && it.c.trim()) ? it.c.trim() : null,
      rawDate: d || null,
    })
  }
  return out
}


/**
 * gyread 单期日报 HTML 解析 —— 抽取每条选题的标题、来源标注与**原文链接**。
 *
 * 存在理由：`search-index.json` 的 `u` 指向**日报页本身**而非新闻原文，
 * 而「溯源跳板」（用户点回一手报道）正是 gyread 的核心价值。
 *
 * **两代版式的字段顺序不同**，这是主要陷阱：旧版 `dateline` 在 `item-title` **之前**，
 * 新版 `item-meta` 在**之后**。若以 `item-title` 作块锚点，旧版第一条会越界拿到
 * **下一条**的 dateline（串条，本轮实测复现）。故块边界取条目容器 `<div class="item">`
 * （两版都有、与字段顺序无关），容器内再「新版 item-meta 优先、旧版 dateline 兜底」。
 *
 * fail-open 是硬合同：缺失/畸形只让该条少带链接，**不得抛错** —— 否则一次版式变动
 * 就会让整个补拉渠道记失败，把高质量 AI 选题全部丢掉。
 *
 * @param {string|null} html 单期日报 HTML
 * @returns {Array<{channel:string, topic:string, sourceText:string, sourceUrls:string[]}>}
 */
function parseGyreadEdition (html) {
  const text = String(html || '')
  if (!text) return []
  // 块边界用**条目容器** `<div class="item">`：两版都有、且与字段顺序无关。
  // 容器内再分别取标题/来源/出处，因此不存在「旧版 dateline 在标题之前」的串条问题。
  const chunks = text.split(/<div class="item">/).slice(1)
  const out = []
  for (const chunk of chunks) {
    const titleMatch = chunk.match(/<div class="item-title">([\s\S]*?)<\/div>/)
    if (!titleMatch) continue // 无标题不是有效选题块（voice / curiosity 等块自然跳过）
    const topic = stripTags(titleMatch[1])
    if (!topic) continue
    // 来源标注：新版 item-meta 优先，旧版 dateline 兜底
    const meta = chunk.match(/<div class="item-meta">([\s\S]*?)<\/div>/)
    const dateline = chunk.match(/<div class="dateline">([\s\S]*?)<\/div>/)
    const sourceText = meta ? stripTagsJoined(meta[1]) : (dateline ? stripTags(dateline[1]) : '')
    // 出处链接：取本块内第一个 src-line（新版多链接 → 数组）
    const src = chunk.match(/<div class="src-line">([\s\S]*?)<\/div>/)
    const sourceUrls = src ? extractLinks(src[1]) : []
    out.push({ channel: 'gyread', topic, sourceText, sourceUrls })
  }
  return out
}

module.exports = {
  parseGyreadIndex,
  parseGyreadEdition,
}
