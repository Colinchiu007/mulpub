// @ts-check
/**
 * quick-collect-sources — 素材源注册表（**唯一真源**）
 *
 * 为什么要有这一层：
 *   ① 源清单此前散落在指令校验（`ALLOWED_SOURCES`）、内置词条、渲染端提示文案三处，
 *      加一个源要改三处且没有判据能发现漏改；本模块把清单收敛成一份，其余全部**派生**；
 *   ② 源有两种**正交**属性必须显式声明，否则接进来就是错的：
 *      - `kind: 'search' | 'trend'` —— 前者「按关键词去查」（有相关性门禁语义），
 *        后者「无关键词，取榜单/时间线」（不能混进 search 的语义，见 PRD §3.1）；
 *      - `timeKind: 'published' | 'observed'` —— 榜单类源**没有发布时间**，
 *        只有"我什么时候看到它在榜上"；把它当 `published` 会让窗口过滤把素材全部丢掉
 *        （`missing_time`），或更糟：把抓取时刻冒充发布时间（PRD §3.2）。
 *   ③ `expectedDomains` 是「这个条目是否真的来自该源」的声明式判据（借鉴 TrendRadar
 *      `expected_domain` 的**降级语义**：不匹配就整条丢弃并归因，不做逐条"洗白"）。
 *
 * 本模块零 IO、零时钟：只描述源，不做抓取（抓取在 `quick-collect-trend-sources.js`
 * 与既有的 hot-topics / content-intelligence 服务里）。
 */

/** 源分组（UI 只消费 group id，显示名由 locale 提供） */
const SOURCE_GROUPS = Object.freeze(['en', 'cn-hot', 'tech', 'policy'])

/**
 * @typedef {object} SourceDescriptor
 * @property {string} id
 * @property {string} label            显示名（专有名词，主进程侧中文不进渲染端 CJK 扫描面）
 * @property {'search'|'trend'} kind
 * @property {'hottest'|'realtime'} sourceType
 * @property {'published'|'observed'} timeKind
 * @property {string} group
 * @property {'content-intelligence'|'hot-topics'|'feed'|'none'} provider
 * @property {string} homeUrl
 * @property {string[]} expectedDomains
 * @property {number} intervalMinutes  最小抓取间隔（0 = 不适用/由上游服务自管）
 * @property {'low'|'medium'|'high'} riskLevel
 */

/** @type {ReadonlyArray<SourceDescriptor>} */
const SOURCES = Object.freeze([
  // ─────────── search：按关键词检索（英文社区，行为与既有实现逐字一致） ───────────
  Object.freeze({
    id: 'reddit', label: 'Reddit', kind: 'search', sourceType: 'realtime', timeKind: 'published',
    group: 'en', provider: 'content-intelligence',
    homeUrl: 'https://www.reddit.com', expectedDomains: ['reddit.com'], intervalMinutes: 0, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'hackernews', label: 'Hacker News', kind: 'search', sourceType: 'realtime', timeKind: 'published',
    group: 'en', provider: 'content-intelligence',
    homeUrl: 'https://news.ycombinator.com', expectedDomains: ['ycombinator.com'], intervalMinutes: 0, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'github', label: 'GitHub', kind: 'search', sourceType: 'realtime', timeKind: 'published',
    group: 'en', provider: 'content-intelligence',
    homeUrl: 'https://github.com', expectedDomains: ['github.com'], intervalMinutes: 0, riskLevel: 'low',
  }),

  // ─────────── trend：中文榜单（复用 hot-topics-service，零新抓取） ───────────
  // 全部 `timeKind: 'observed'`：这些榜单只给名次与热度，**没有发布时间**。
  Object.freeze({
    id: 'weibo', label: '微博热搜', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
    group: 'cn-hot', provider: 'hot-topics',
    homeUrl: 'https://s.weibo.com/top/summary', expectedDomains: ['weibo.com', 's.weibo.com'], intervalMinutes: 10, riskLevel: 'medium',
  }),
  Object.freeze({
    id: 'zhihu', label: '知乎热榜', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
    group: 'cn-hot', provider: 'hot-topics',
    homeUrl: 'https://www.zhihu.com/hot', expectedDomains: ['zhihu.com'], intervalMinutes: 5, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'douyin', label: '抖音热点', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
    group: 'cn-hot', provider: 'hot-topics',
    homeUrl: 'https://www.douyin.com/hot', expectedDomains: ['douyin.com'], intervalMinutes: 15, riskLevel: 'high',
  }),
  Object.freeze({
    id: 'bilibili', label: 'B站热门', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
    group: 'cn-hot', provider: 'hot-topics',
    homeUrl: 'https://www.bilibili.com/v/popular/all', expectedDomains: ['bilibili.com'], intervalMinutes: 10, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'baidu', label: '百度热搜', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
    group: 'cn-hot', provider: 'hot-topics',
    homeUrl: 'https://top.baidu.com/board?tab=realtime', expectedDomains: ['baidu.com', 'top.baidu.com'], intervalMinutes: 10, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'toutiao', label: '今日头条热榜', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
    group: 'cn-hot', provider: 'hot-topics',
    homeUrl: 'https://www.toutiao.com/hot-event/hot-board/', expectedDomains: ['toutiao.com'], intervalMinutes: 5, riskLevel: 'medium',
  }),
  Object.freeze({
    id: 'tencent', label: '腾讯新闻热榜', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
    group: 'cn-hot', provider: 'hot-topics',
    homeUrl: 'https://news.qq.com', expectedDomains: ['qq.com', 'inews.qq.com'], intervalMinutes: 10, riskLevel: 'medium',
  }),
  Object.freeze({
    id: 'tophub', label: '微博(tophub 镜像)', kind: 'trend', sourceType: 'hottest', timeKind: 'observed',
    group: 'cn-hot', provider: 'hot-topics',
    homeUrl: 'https://tophub.today/n/KqndgxeLl9', expectedDomains: ['tophub.today', 'weibo.com', 's.weibo.com'], intervalMinutes: 30, riskLevel: 'medium',
  }),

  // ─────────── trend：带发布时间的免费中文/技术时间线（S2；本机实测 200 且有 pubDate） ───────────
  // 这些源**有原生发布时间** ⇒ `timeKind: 'published'`，窗口按发布时间过滤（与榜单源的 observed 语义分开）。
  Object.freeze({
    id: 'solidot', label: 'Solidot', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://www.solidot.org', feedUrl: 'https://www.solidot.org/index.rss',
    expectedDomains: ['solidot.org'], intervalMinutes: 30, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'sspai', label: '少数派', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://sspai.com', feedUrl: 'https://sspai.com/feed',
    expectedDomains: ['sspai.com'], intervalMinutes: 30, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'oschina', label: 'OSCHINA 资讯', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://www.oschina.net', feedUrl: 'https://www.oschina.net/news/rss',
    expectedDomains: ['oschina.net'], intervalMinutes: 30, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'ithome', label: 'IT之家', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://www.ithome.com', feedUrl: 'https://www.ithome.com/rss/',
    expectedDomains: ['ithome.com'], intervalMinutes: 30, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'qbitai', label: '量子位', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://www.qbitai.com', feedUrl: 'https://www.qbitai.com/feed',
    expectedDomains: ['qbitai.com'], intervalMinutes: 60, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'infoq_cn', label: 'InfoQ 中文', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://www.infoq.cn', feedUrl: 'https://www.infoq.cn/feed',
    expectedDomains: ['infoq.cn'], intervalMinutes: 60, riskLevel: 'low',
  }),
  Object.freeze({
    // V2EX hot.json 是榜单形态，但**每条自带 created（unix 秒）** ⇒ 标 published（有原生时间就用原生时间，
    // 只有拿不到时间的榜单才降级 observed；该不变量由测试锁死）
    id: 'v2ex_hot', label: 'V2EX 热榜', kind: 'trend', sourceType: 'hottest', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://www.v2ex.com/?tab=hot', feedUrl: 'https://www.v2ex.com/api/topics/hot.json',
    expectedDomains: ['v2ex.com'], intervalMinutes: 15, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'arxiv_cs_ai', label: 'arXiv cs.AI', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://arxiv.org/list/cs.AI/recent', feedUrl: 'https://export.arxiv.org/rss/cs.AI',
    expectedDomains: ['arxiv.org'], intervalMinutes: 120, riskLevel: 'low',
  }),
  Object.freeze({
    id: 'hf_papers', label: 'HuggingFace 每日论文', kind: 'trend', sourceType: 'realtime', timeKind: 'published',
    group: 'tech', provider: 'feed',
    homeUrl: 'https://huggingface.co/papers', feedUrl: 'https://huggingface.co/api/daily_papers',
    expectedDomains: ['huggingface.co'], intervalMinutes: 120, riskLevel: 'low',
  }),
])

/** 源 id 闭集（顺序稳定：search 在前，trend 在后） */
const ALL_SOURCE_IDS = Object.freeze(SOURCES.map((s) => s.id))
/** 关键词检索类源（进 `searchFn`） */
const SEARCH_SOURCE_IDS = Object.freeze(SOURCES.filter((s) => s.kind === 'search').map((s) => s.id))
/** 榜单/时间线类源（进 `trendFn`） */
const TREND_SOURCE_IDS = Object.freeze(SOURCES.filter((s) => s.kind === 'trend').map((s) => s.id))

const BY_ID = new Map(SOURCES.map((s) => [s.id, s]))

/**
 * @param {unknown} id
 * @returns {SourceDescriptor|null}
 */
function getSource (id) {
  const key = typeof id === 'string' ? id.trim() : ''
  return key ? (BY_ID.get(key) || null) : null
}

/** @param {unknown} id */
function isKnownSource (id) {
  return getSource(id) !== null
}

/**
 * 把指令的源集合拆成两类。未知 id 一律**不进任何一类**（调用方应先做闭集校验；
 * 这里 fail-soft 只保证分流函数本身不会把未知 id 当成合法源）。
 * @param {unknown} ids
 * @returns {{ search: string[], trend: string[], unknown: string[] }}
 */
function splitSources (ids) {
  const search = []
  const trend = []
  const unknown = []
  const list = Array.isArray(ids) ? ids : []
  const seen = new Set()
  for (const raw of list) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const src = BY_ID.get(id)
    if (!src) { unknown.push(id); continue }
    if (src.kind === 'search') search.push(id)
    else trend.push(id)
  }
  // 按闭集顺序输出：同一份输入永远得到同一份输出（与 normalizeSources 同口径）
  return {
    search: SEARCH_SOURCE_IDS.filter((s) => search.includes(s)),
    trend: TREND_SOURCE_IDS.filter((s) => trend.includes(s)),
    unknown,
  }
}

/**
 * 声明式域名判据：host 必须等于 `expectedDomains` 中某项，或是其后缀子域。
 * 大小写与末尾点一律归一（`EXAMPLE.com.` 与 `example.com` 等价）。
 * @param {unknown} url 已过 `safeHttpUrl` 的 http(s) URL
 * @param {string[]} expectedDomains
 * @returns {boolean}
 */
function hostAllowed (url, expectedDomains) {
  const domains = Array.isArray(expectedDomains) ? expectedDomains.filter((d) => typeof d === 'string' && d) : []
  if (domains.length === 0) return true // 未声明域名清单 = 不做该判据（由 safeHttpUrl 兜协议）
  let host = ''
  try {
    host = String(new URL(String(url)).hostname || '').toLowerCase().replace(/\.$/, '')
  } catch (_) {
    return false
  }
  if (!host) return false
  return domains.some((d) => {
    const dom = String(d).toLowerCase().replace(/^\./, '').replace(/\.$/, '')
    if (!dom) return false
    return host === dom || host.endsWith('.' + dom)
  })
}

/** 源清单的只读快照（渲染端 parity 测试与 UI 提示消费 id 列表） */
function listSourceIds () {
  return [...ALL_SOURCE_IDS]
}

module.exports = {
  SOURCES,
  SOURCE_GROUPS,
  ALL_SOURCE_IDS,
  SEARCH_SOURCE_IDS,
  TREND_SOURCE_IDS,
  getSource,
  isKnownSource,
  splitSources,
  hostAllowed,
  listSourceIds,
}
