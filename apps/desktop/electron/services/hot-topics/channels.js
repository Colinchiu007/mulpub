// @ts-check
/**
 * 热门选题渠道解析器 — 每渠道一个 parse 函数
 *
 * 统一输出条目结构：{ channel, kind, rank, topic, hotValue, url, rawCategory }（kind 由产出层写，见 hot-topics/item-model.js）
 * 所有解析器只做纯数据提取，不做网络请求（fetch 由 service 层统一处理）。
 *
 * v2 变更（方案A/D）：
 *   - 各榜单解析上限 20 → 50（配合 service MAX_PER_CHANNEL=50 放宽抓取量）
 *   - parseWeibo 兼容两种载荷形态：data.band_list 与 data 数组（实测线上两种都出现）
 *   - 新增垂类专属解析器：parseSinaFinance（新浪财经滚动）、parseIthomeRSS（IT之家 RSS）
 */

const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')
const { KIND_TOPIC } = require('./item-model.js')
const { decodeHtmlEntities, stripTags, stripTagsJoined, extractLinks } = require('./html-utils.js')
const { parseGyreadIndex, parseGyreadEdition } = require('./channels-gyread.js')


/** 安全 URL：判据收敛到共享单一实现（PRD-HREF-SCHEME-GUARD），本处只做名字适配 */
const sanitizeUrl = safeHttpUrl

/** 知乎热榜 JSON：data[].question.title / data[].target.title（实测 2026-09 两种结构） */
function parseZhihu(json) {
  const list = (json && json.data) || []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'zhihu',
    kind: KIND_TOPIC,
    rank: i + 1,
    topic: String((item.question && item.question.title) || (item.target && item.target.title) || item.title || '').trim(),
    hotValue: Number((item.detail_text || '').replace(/[^0-9]/g, '')) || null,
    url: sanitizeUrl((item.question && item.question.url) || (item.target && item.target.url) || item.url),
    rawCategory: null,
  })).filter(x => x.topic)
}

/** 今日头条热榜 JSON：data[].Title（实测 2026-10-12 复核）
 * 字段修正：响应里**没有** `Category` 字段（0/50）；语义相近的是 `InterestCategory[]`（42/50 存在），
 * 故原生分类优先取 `InterestCategory[0]`，再回退历史字段 `Category`（兼容旧缓存/旧响应）。
 * `HotValue` 是字符串（Number() 转换）；`ClusterIdStr` 可自拼 trending 详情页。 */
function parseToutiao(json) {
  const list = (json && json.data) || []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'toutiao',
    kind: KIND_TOPIC,
    rank: i + 1,
    topic: String(item.Title || '').trim(),
    hotValue: Number(item.HotValue) || null,
    url: sanitizeUrl(item.Url || item.url ||
      (item.ClusterIdStr ? 'https://www.toutiao.com/trending/' + item.ClusterIdStr + '/' : null)),
    rawCategory: (Array.isArray(item.InterestCategory) && item.InterestCategory[0]) || item.Category || null,
  })).filter(x => x.topic)
}

/** 腾讯新闻热榜 JSON：idlist[0].newslist[]（实测 2026-09 结构；首条为广告位标题需过滤） */
function parseTencent(json) {
  let list = []
  if (json && Array.isArray(json.idlist) && json.idlist[0] && Array.isArray(json.idlist[0].newslist)) {
    list = json.idlist[0].newslist
  } else if (json && Array.isArray(json.newslist)) {
    list = json.newslist
  }
  // 过滤固定广告位（articletype '560' 为"每10分钟更新一次"占位）
  const filtered = list.filter(item => item.articletype !== '560')
  return filtered.slice(0, 50).map((item, i) => ({
    channel: 'tencent',
    kind: KIND_TOPIC,
    rank: i + 1,
    topic: decodeHtmlEntities(item.title || item.name || ''),
    hotValue: Number(item.hotEvent || item.hotScore || 0) || null,
    url: sanitizeUrl(item.url || item.surl || item.href),
    rawCategory: item.chlid || item.category || item.field || null,
  })).filter(x => x.topic)
}

/** B站热门 JSON：data.list[].title（tname 分区名作为原生分类，实测 2026-09）
 * ps=50 拉取更充分的分区覆盖（tname 多样性），v2 解析同步放宽到 50 条。 */
function parseBilibili(json) {
  const list = (json && json.data && Array.isArray(json.data.list)) ? json.data.list : []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'bilibili',
    kind: KIND_TOPIC,
    rank: i + 1,
    topic: String(item.title || '').trim(),
    hotValue: Number(item.stat && item.stat.view) || null,
    url: sanitizeUrl('https://www.bilibili.com/video/' + (item.bvid || '')),
    rawCategory: item.tname || null,
  })).filter(x => x.topic)
}

/** 中文数量字符串 → 数值：'947.5w' / '1.2万' / '8850' → 9475000 / 12000 / 8850 */
function parseCnNumber(input) {
  const t = String(input == null ? '' : input).trim()
  if (!t) return null
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  return /[wW万]$/.test(t) ? Math.round(n * 10000) : Math.round(n)
}

/**
 * 抖音热搜 JSON —— 三个公开端点同构，共用一个解析器（调研 2026-10-12 实测）：
 *   - web 端  `www.douyin.com/aweme/v1/web/hot/search/list/`：data.word_list[] + data.trending_list[]
 *   - 移动端  `aweme-lq.snssdk.com/aweme/v1/hot/search/list/`：同上（零头部可用）
 *   - 旧端点  `www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/`：**顶层** word_list[]（无 data 包裹）
 * rank 优先用 position（无则回退数组序）；url 用 sentence_id 拼热点详情页；
 * trending_list 是「上升热点」，与主榜去重后并入并标 rawCategory='上升热点'。
 */
function parseDouyin(json) {
  const root = (json && json.data) ? json.data : json
  const words = Array.isArray(root && root.word_list) ? root.word_list : []
  const rising = Array.isArray(root && root.trending_list) ? root.trending_list : []
  const items = []
  for (const [list, isRising] of [[words, false], [rising, true]]) {
    for (const w of list) {
      const topic = String((w && w.word) || '').trim()
      if (!topic || items.some(x => x.topic === topic)) continue
      items.push({
        channel: 'douyin',
        kind: KIND_TOPIC,
        rank: Number(w.position) || items.length + 1,
        topic,
        hotValue: Number(w.hot_value) || null,
        url: w.sentence_id ? sanitizeUrl('https://www.douyin.com/hot/' + w.sentence_id) : null,
        rawCategory: isRising ? '上升热点' : null,
      })
    }
  }
  return items.slice(0, 50)
}

/**
 * 小红书 App 端热搜 JSON（`edith.xiaohongshu.com/api/sns/v1/search/hot_list`，实测 2026-10-12 免登录 200 / 20 条）：
 * data.items[].title / .score（'947.5w' 形态的字符串）/ .word_type（'热' / '无'）。
 * 接口**不返回 rank**，只能按数组序；url 用搜索页拼装（该端点是热搜词而非内容条目）。
 */
function parseXiaohongshu(json) {
  const list = (json && json.data && Array.isArray(json.data.items)) ? json.data.items : []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'xiaohongshu',
    kind: KIND_TOPIC,
    rank: i + 1,
    topic: String(item.title || '').trim(),
    hotValue: parseCnNumber(item.score),
    url: sanitizeUrl('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(item.title || '') + '&type=51'),
    rawCategory: item.word_type || null,
  })).filter(x => x.topic)
}

/**
 * 凤凰热榜 JSON（`ne883dbn.ifeng.com/hotspotlist?page=N&gv=7.9.1&av=7.9.1`，实测 2026-10-12 免登录；
 * page1=30 + page2=5 共 35 条）：data.list[] → title / link.url / commentsCount / type。
 * ⚠️ 顶层**没有** url 字段，链接在 `link.url`；`data.totalPage` 实测恒为 1 不可信。
 * hotValue 取 commentsCount（该榜单唯一可比的数值信号，口径为「评论数」，由 scorer 在渠道内归一）。
 */
function parseIfeng(json) {
  const list = (json && json.data && Array.isArray(json.data.list)) ? json.data.list : []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'ifeng',
    kind: KIND_TOPIC,
    rank: i + 1,
    topic: decodeHtmlEntities(item.title || ''),
    hotValue: Number(item.commentsCount) || null,
    url: sanitizeUrl((item.link && item.link.url) || item.url),
    rawCategory: item.type || null,
  })).filter(x => x.topic)
}

/**
 * 从 HTML 中提取 `allData = {...}` 并 JSON 解析。
 * 必须做花括号配对，**不能**用 `\{[\s\S]*?\}` 惰性正则：i.ifeng.com 的 allData 是内嵌多行 JSON，
 * 惰性匹配会在第一个 `}` 处截断（www.ifeng.com 是单行，惰性匹配恰好可用，因此这是隐蔽陷阱）。
 * 配对扫描需跳过字符串字面量与转义字符。
 */
function extractIfengAllData(html) {
  const text = String(html || '')
  const at = text.search(/allData\s*=\s*/)
  if (at === -1) return null
  const braceAt = text.indexOf('{', at)
  if (braceAt === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = braceAt; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(text.slice(braceAt, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

/**
 * 凤凰热榜内联兜底（`https://i.ifeng.com/` 的 `allData.hotRankData.data[]`，实测 51 条）。
 * 与 parseIfeng 是**同一份榜单的不同出口**，但字段名不同（这里是顶层 `url`，不是 `link.url`），
 * 故解析器不能共用。仅在 ifeng_hot 换域/失败时按顺序降级使用。
 */
function parseIfengInline(html) {
  const all = extractIfengAllData(html)
  const list = (all && all.hotRankData && Array.isArray(all.hotRankData.data)) ? all.hotRankData.data : []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'ifeng',
    kind: KIND_TOPIC,
    rank: i + 1,
    topic: decodeHtmlEntities(item.title || ''),
    hotValue: null,
    url: sanitizeUrl(item.url),
    rawCategory: null,
  })).filter(x => x.topic)
}

/** 百度热搜官方 JSON API：data.cards[0].content[0].content[]（实测 2026-09；该端点无 hotScore 字段）
 * 置顶条（isTop:true，无 index 字段）是栏目推广位非正式名次，跳过以保证 rank 唯一
 * （否则置顶条 rank 回退 i+1=1 与正式榜首 index=1 重复，id 冲突污染勾选状态）。
 * 垂类 tab（如 tab=finance）复用本解析器，由 service 层补拉配置直挂分类。 */
function parseBaidu(json) {
  const cards = (json && json.data && Array.isArray(json.data.cards)) ? json.data.cards
    : (json && Array.isArray(json.cards)) ? json.cards : []
  const content = []
  for (const card of cards) {
    if (Array.isArray(card.content) && card.content[0] && Array.isArray(card.content[0].content)) {
      content.push(...card.content[0].content)
    }
  }
  // 过置顶推广位（isTop 无 index），保留正式名次 1..n 唯一
  const ranked = content.filter(item => !item.isTop)
  return ranked.slice(0, 50).map((item, i) => ({
    channel: 'baidu',
    kind: KIND_TOPIC,
    rank: Number(item.index) || i + 1,
    topic: decodeHtmlEntities(item.word || item.query || ''),
    hotValue: Number(item.hotScore) || null,
    url: sanitizeUrl(item.url || item.rawUrl),
    rawCategory: null,
  })).filter(x => x.topic)
}

/** 微博热搜官方 JSON（实测 2026-09 两种载荷形态，都需兼容）：
 *   形态一 data.band_list[]（旧接口形状）
 *   形态二 data[]（线上 hot_band 直出数组，51 条，带 category 原生分类字段）
 * rawCategory 原生分类供分类器映射（情感/艺人/汽车等 v2 扩容映射表命中）。 */
function parseWeibo(json) {
  const list = (json && json.data && Array.isArray(json.data.band_list)) ? json.data.band_list
    : (json && Array.isArray(json.data)) ? json.data : []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'weibo',
    kind: KIND_TOPIC,
    // rank 用数组序 i+1（与其他解析器一致）：实测 band_list 中 realpos 偶发稀疏（null），
    // 若回退 i+1 会与后续条目的 realpos 撞号产生重复 id；数组序恒唯一
    rank: i + 1,
    topic: String(item.word || item.title || '').trim(),
    hotValue: Number(item.num) || null,
    url: sanitizeUrl('https://s.weibo.com/weibo?q=' + encodeURIComponent(item.word || '')),
    rawCategory: item.category || null,
  })).filter(x => x.topic)
}

/** tophub.today 微博热搜节点页 HTML（/n/KqndgxeLl9）：tbody 内 <td><a href="https://s.weibo.com/...">标题</a></td> + <td class="ws">热度</td> */
function parseTophub(html) {
  if (!html) return []
  const items = []
  // 行结构：<td align="center">N.</td><td><a href="https://s.weibo.com/...">标题</a></td><td class="ws">125万</td>
  const rowRe = /<td><a href="https:\/\/s\.weibo\.com\/[^"]*"[^>]*>([^<]{2,})<\/a><\/td>\s*<td class="ws">([^<]*)<\/td>/g
  let m
  while ((m = rowRe.exec(html)) && items.length < 50) {
    const topic = decodeHtmlEntities(m[1])
    const hotText = decodeHtmlEntities(m[2])
    const hotValue = hotText.includes('万')
      ? Math.round(parseFloat(hotText) * 10000)
      : parseInt(hotText.replace(/[^0-9]/g, ''), 10) || null
    if (topic) items.push({
      channel: 'tophub',
      kind: KIND_TOPIC,
      rank: items.length + 1,
      topic,
      hotValue,
      url: null,
      rawCategory: null,
    })
  }
  return items
}

/** 新浪财经滚动新闻 JSON：result.data[].title
 * （端点 feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516，实测 2026-09-20 返回 30 条真财经题）
 * rawCategory 固定「财经」：条目直挂财经分类（GENERIC_RAW_MAP 亦可命中，service 补拉时以 boostCategory 为准）。 */
function parseSinaFinance(json) {
  const list = (json && json.result && Array.isArray(json.result.data)) ? json.result.data : []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'sina_finance',
    kind: KIND_TOPIC,
    rank: i + 1,
    topic: decodeHtmlEntities(item.title || ''),
    hotValue: null,
    url: sanitizeUrl(item.url),
    rawCategory: '财经',
  })).filter(x => x.topic)
}

/** IT之家热榜 RSS（www.ithome.com/rss/，实测 2026-09-20 HTTP 200 XML；api.ithome.com/json/hot 已 404）
 * 逐 <item> 块提取 title（兼容 CDATA 与 HTML 实体）+ link。 */
function parseIthomeRSS(xml) {
  if (!xml || typeof xml !== 'string') return []
  const items = []
  const blocks = xml.split(/<item>/).slice(1)
  for (const b of blocks) {
    if (items.length >= 50) break
    const tm = b.match(/<title>([\s\S]*?)<\/title>/)
    if (!tm) continue
    let title = tm[1]
    const cdata = title.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
    if (cdata) title = cdata[1]
    title = decodeHtmlEntities(title)
    if (!title) continue
    const lm = b.match(/<link>([\s\S]*?)<\/link>/)
    items.push({
      channel: 'ithome_tech',
      kind: KIND_TOPIC,
      rank: items.length + 1,
      topic: title,
      hotValue: null,
      url: sanitizeUrl(lm ? lm[1].trim() : null),
      rawCategory: '科技',
    })
  }
  return items
}


/** 渠道解析器注册表（补拉渠道经 source.parser 键复用；fallback 亦可各自声明 parser） */
const CHANNEL_PARSERS = {
  zhihu: parseZhihu,
  toutiao: parseToutiao,
  tencent: parseTencent,
  bilibili: parseBilibili,
  douyin: parseDouyin,
  baidu: parseBaidu,
  tophub: parseTophub,
  weibo: parseWeibo,
  sina_finance: parseSinaFinance,
  ithome_rss: parseIthomeRSS,
  xiaohongshu: parseXiaohongshu,
  ifeng: parseIfeng,
  ifeng_inline: parseIfengInline,
  gyread_index: parseGyreadIndex,
  gyread_edition: parseGyreadEdition,
}

module.exports = {
  decodeHtmlEntities,
  sanitizeUrl,
  parseCnNumber,
  CHANNEL_PARSERS,
  parseZhihu, parseToutiao, parseTencent, parseBilibili, parseDouyin, parseBaidu, parseTophub, parseWeibo,
  parseSinaFinance, parseIthomeRSS,
  parseXiaohongshu, parseIfeng, parseIfengInline, extractIfengAllData,
  parseGyreadIndex, parseGyreadEdition, stripTags, stripTagsJoined, extractLinks,
}
