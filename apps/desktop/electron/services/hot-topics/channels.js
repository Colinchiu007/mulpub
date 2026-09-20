// @ts-check
/**
 * 热门选题渠道解析器 — 每渠道一个 parse 函数
 *
 * 统一输出条目结构：{ channel, rank, topic, hotValue, url, rawCategory }
 * 所有解析器只做纯数据提取，不做网络请求（fetch 由 service 层统一处理）。
 *
 * v2 变更（方案A/D）：
 *   - 各榜单解析上限 20 → 50（配合 service MAX_PER_CHANNEL=50 放宽抓取量）
 *   - parseWeibo 兼容两种载荷形态：data.band_list 与 data 数组（实测线上两种都出现）
 *   - 新增垂类专属解析器：parseSinaFinance（新浪财经滚动）、parseIthomeRSS（IT之家 RSS）
 */

/** HTML 实体解码（百度/tophub HTML 渠道用） */
function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** 安全 URL：仅 http/https，其他协议返回 null */
function sanitizeUrl(url) {
  const u = String(url || '').trim()
  if (!u) return null
  if (/^https?:\/\//i.test(u)) return u
  return null
}

/** 知乎热榜 JSON：data[].question.title / data[].target.title（实测 2026-09 两种结构） */
function parseZhihu(json) {
  const list = (json && json.data) || []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'zhihu',
    rank: i + 1,
    topic: String((item.question && item.question.title) || (item.target && item.target.title) || item.title || '').trim(),
    hotValue: Number((item.detail_text || '').replace(/[^0-9]/g, '')) || null,
    url: sanitizeUrl((item.question && item.question.url) || (item.target && item.target.url) || item.url),
    rawCategory: null,
  })).filter(x => x.topic)
}

/** 今日头条热榜 JSON：data[].Title */
function parseToutiao(json) {
  const list = (json && json.data) || []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'toutiao',
    rank: i + 1,
    topic: String(item.Title || '').trim(),
    hotValue: Number(item.HotValue) || null,
    url: sanitizeUrl(item.Url || item.url),
    rawCategory: item.Category || null,
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
    rank: i + 1,
    topic: String(item.title || '').trim(),
    hotValue: Number(item.stat && item.stat.view) || null,
    url: sanitizeUrl('https://www.bilibili.com/video/' + (item.bvid || '')),
    rawCategory: item.tname || null,
  })).filter(x => x.topic)
}

/** 抖音热点 JSON：data.word_list[].word */
function parseDouyin(json) {
  const list = (json && json.data && Array.isArray(json.data.word_list)) ? json.data.word_list : []
  return list.slice(0, 50).map((item, i) => ({
    channel: 'douyin',
    rank: i + 1,
    topic: String(item.word || '').trim(),
    hotValue: Number(item.hot_value) || null,
    url: null,
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
      rank: items.length + 1,
      topic: title,
      hotValue: null,
      url: sanitizeUrl(lm ? lm[1].trim() : null),
      rawCategory: '科技',
    })
  }
  return items
}

/** 渠道解析器注册表（补拉渠道经 source.parser 键复用） */
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
}

module.exports = {
  decodeHtmlEntities,
  sanitizeUrl,
  CHANNEL_PARSERS,
  parseZhihu, parseToutiao, parseTencent, parseBilibili, parseDouyin, parseBaidu, parseTophub, parseWeibo,
  parseSinaFinance, parseIthomeRSS,
}
