// @ts-check
/**
 * account-metrics/adapters — 账号级创作者后台列表接口的平台适配器
 *
 * 数据源选择理由（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §1.4）：
 * 本仓既有 `services/platform-metrics` 抓的是**公开作品页 HTML 正则**，而国内主流平台的作品页
 * 要么需登录、要么把指标放在打包脚本里不可正则命中。竞品（参考产品 4.13.19 逆向）走的是
 * **带账号 Cookie 调创作者后台自己的列表接口**：一次请求返回该账号全部作品及其指标。
 * 量级差异 —— 100 条作品 = 1 次请求，而非 100 次页面抓取；后者既拿不到数，风控面还大一个量级。
 *
 * 每个适配器实现统一接口（新平台接入 = 加一个 registerAdapter 调用，编排层零改动）：
 *
 *   platform             平台标识（与 config/platforms.yaml 的键一致）
 *   requiredCookieNames  会话必需 Cookie；缺任一即判 needs_login 且**不发请求**（V2）
 *   buildListRequest({ cursor, pageSize })
 *                        → { url, method, headers, body } | { unsupportedReason }
 *   parseList(json)      → { items: [{ postId, title, metrics }], nextCursor, hasMore }
 *   requiresSigner       需要签名时给出签名器标识；编排层取不到即降级 unsupported（不伪造签名）
 *
 * ⛔ 三条不可破的判据（PRD §3.1/§3.2）：
 *   ① 平台没有该字段 ⇒ `null`，**不是 0** —— 0 是「平台说这条是 0」，null 是「没这个字段」；
 *      小红书无分享数、抖音/头条无收藏，「补 0」就是把缺失伪造成数据（V10）。
 *   ② 解析失败（结构不符）⇒ 抛错由编排层记 failed，**不得返回空数组冒充「这个账号没作品」**。
 *   ③ 适配器不碰 Cookie 内容、不拼 Authorization —— Cookie 由传输层统一注入，
 *      避免每个平台各自拼接导致凭证出现在日志里。
 *
 * 端点形态来自竞品逆向产物（**本地逆向工程目录，路径不入库**），
 * 逐个标注了原始函数名，便于将来对端变更时定位。
 */
'use strict'

/**
 * 指标计数归一：只接受有限非负数，其余一律 null（V10）。
 * 平台返回 `"1.2万"` 这类本地化字符串时**不猜**，如实 null —— 猜错比缺失更糟。
 * @param {unknown} value
 * @returns {number|null}
 */
function toCount (value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.trunc(n)
}

/** 取第一个「有值」的候选计数（同一语义在不同版本字段名不同时的容错，仅限同义字段）。 */
function pickCount () {
  for (let i = 0; i < arguments.length; i += 1) {
    const v = toCount(arguments[i])
    if (v !== null) return v
  }
  return null
}

/**
 * 平台发布时间 → ISO 字符串。平台给的是 **epoch 秒**（偶有毫秒）。
 * 解析不出/越界一律返回 ''（不是「现在」——伪造时间会让归因的时间窗判据错配，
 * 这比没有时间更糟）。10 位当秒、13 位当毫秒，与 performance-overview 的 toEpochMs 同思路。
 * @param {unknown} value
 * @returns {string}
 */
function epochToIso (value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' && value.includes('-')) {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? new Date(ms).toISOString() : ''
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  const ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : 0
  if (!ms) return ''
  const d = new Date(ms)
  // 越界（早于 2000 或晚于现在 +1 天）判为不可信，不产出伪时间
  const now = Date.now()
  if (d.getTime() < Date.parse('2000-01-01T00:00:00Z') || d.getTime() > now + 24 * 3600 * 1000) return ''
  return d.toISOString()
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/** 适配器注册表。key = platform，小写。 */
const registry = new Map()

/**
 * 平台「未登录」业务码判定。抛出的错误带 `needsLogin = true`，编排层据此记 `needs_login`
 * 而不是 `failed`（QM-6 后端轴 MAJOR：过期 Cookie 落在 200 + 业务码上，只校验容器键的话
 * 会被归成「采集失败」，界面给出的下一步动作就错了）。
 *
 * 只登记**有明确证据**的形态；模糊形态（如头条的通用 code=-1）不猜——把它误判成未登录
 * 会误导用户去重新登录一个其实有效的账号。
 * @param {any} json
 * @param {string} platform
 */
function throwIfLoginRequired (json, platform) {
  if (!json || typeof json !== 'object') return
  const statusCode = Number(json.status_code)
  // 抖音：status_code=8 是「未登录/登录态失效」的既定取值
  if (Number.isFinite(statusCode) && statusCode === 8) {
    const err = new Error(platform + ': not logged in (status_code=8)')
    err.needsLogin = true
    throw err
  }
  // 小红书：success=false + code ∈ {-100, 401}
  const code = Number(json.code)
  if (json.success === false && (code === -100 || code === 401)) {
    const err = new Error(platform + ': not logged in (code=' + code + ')')
    err.needsLogin = true
    throw err
  }
  if (code === 401) {
    const err = new Error(platform + ': not logged in (code=401)')
    err.needsLogin = true
    throw err
  }
}

function registerAdapter (adapter) {
  if (!adapter || !adapter.platform) throw new Error('account-metrics: adapter.platform required')
  if (typeof adapter.buildListRequest !== 'function' || typeof adapter.parseList !== 'function') {
    throw new Error('account-metrics: adapter ' + adapter.platform + ' 缺 buildListRequest/parseList')
  }
  registry.set(String(adapter.platform).toLowerCase(), adapter)
}

function getAdapter (platform) {
  return registry.get(String(platform || '').toLowerCase()) || null
}

function supportedPlatforms () {
  return Array.from(registry.keys())
}

/** 测试用：清空注册表（生产不使用）。 */
function __resetAdapters () {
  registry.clear()
}

// ─────────────────────────── 小红书 ───────────────────────────
// 逆向来源：getAnalyzeContentListResponse（datacenter/note/analyze/list，含 read/like/comment/fav/share）
// 与 getContentListAsync$m（sns/v5/creator/note/user/posted，含 xsec_token）两个端点。
// 取前者：它是**数据中心**接口，五项指标一次给全，与「一次请求拿全量指标」的目标一致；
// 后者用于内容管理（缺收藏/分享），不作为指标源。
registerAdapter({
  platform: 'xiaohongshu',
  displayName: '小红书',
  requiredCookieNames: ['web_session'],
  requiresSigner: 'xiaohongshu',
  buildListRequest ({ cursor, pageSize }) {
    const page = Math.max(1, Number(cursor) || 1)
    const size = Math.max(1, Number(pageSize) || 10)
    return {
      method: 'GET',
      url: 'https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/analyze/list'
        + '?type=0&page_size=' + size + '&page_num=' + page,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://creator.xiaohongshu.com/publish/publish',
        Origin: 'https://creator.xiaohongshu.com',
      },
    }
  },
  parseList (json) {
    throwIfLoginRequired(json, 'xiaohongshu')
    const list = json && json.data && Array.isArray(json.data.note_infos) ? json.data.note_infos : null
    if (!list) throw new Error('xiaohongshu: 响应缺少 data.note_infos')
    const items = list.map((n) => ({
      postId: String(n.id || ''),
      title: String(n.title || ''),
      publishedAt: epochToIso(n.post_time || n.time || n.create_time),
      metrics: {
        views: pickCount(n.read_count, n.view_count),
        likes: pickCount(n.like_count),
        comments: pickCount(n.comment_count),
        favorites: pickCount(n.fav_count, n.collect_count),
        shares: pickCount(n.share_count),
      },
    })).filter(it => it.postId)
    // 该端点是页码制：返回条数 == page_size 即认为还有下一页
    const pageSize = Number(json?.data?.page_size) || list.length
    return { items, nextCursor: null, hasMore: list.length > 0 && list.length >= pageSize }
  },
})

// ─────────────────────────── 抖音 ───────────────────────────
// 逆向来源：getVideoList$1（web/api/media/aweme/post/，已发布作品列表，含 statistics）。
// status=0 = 全部（作者视角）；max_cursor 游标制。
registerAdapter({
  platform: 'douyin',
  displayName: '抖音',
  requiredCookieNames: [],
  requiresSigner: null,
  buildListRequest ({ cursor, pageSize }) {
    const maxCursor = Math.max(0, Number(cursor) || 0)
    const count = Math.max(1, Number(pageSize) || 12)
    const qs = [
      'scene=star_atlas', 'status=0', 'count=' + count, 'max_cursor=' + maxCursor,
      'cookie_enabled=true', 'screen_width=1920', 'screen_height=1080',
      'browser_language=zh-CN', 'browser_platform=Win32', 'browser_name=Mozilla',
      'browser_version=' + encodeURIComponent(USER_AGENT), 'browser_online=true',
      'timezone_name=Asia%2FShanghai', 'aid=1128', 'msToken=',
    ].join('&')
    return {
      method: 'GET',
      url: 'https://creator.douyin.com/web/api/media/aweme/post/?' + qs,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://creator.douyin.com/creator-micro/content/manage',
      },
    }
  },
  parseList (json) {
    throwIfLoginRequired(json, 'douyin')
    const list = json && Array.isArray(json.aweme_list) ? json.aweme_list : null
    if (!list) throw new Error('douyin: 响应缺少 aweme_list')
    const items = list.map((a) => {
      const st = a && a.statistics ? a.statistics : {}
      return {
        postId: String(a.aweme_id || ''),
        title: String(a.desc || ''),
        publishedAt: epochToIso(a.create_time),
        metrics: {
          views: pickCount(st.play_count, st.play_count_v2),
          // 数据中心的字段名（attitude_count/reposts_count）与内容管理接口的
          // （digg_count/share_count/forward_count）都作为候补：两端点都实测存在，
          // 认哪个取决于最终采用的端点；同义字段互为候补不算「跨字段顶替」。
          likes: pickCount(st.digg_count, st.attitude_count),
          comments: pickCount(st.comment_count),
          // 抖音作品列表**不返回收藏数**：如实 null，不得拿其他字段顶替（V10）
          favorites: pickCount(st.collect_count),
          shares: pickCount(st.share_count, st.forward_count, st.reposts_count),
        },
      }
    }).filter(it => it.postId)
    const hasMore = json.has_more === true || json.has_more === 1
    return { items, nextCursor: hasMore ? String(json.max_cursor || 0) : null, hasMore }
  },
})

// ─────────────────────────── 快手 ───────────────────────────
// 逆向来源：getKuaishouContentDetailList（rest/cp/creator/analysis/pc/photo/list，POST JSON）。
// 注意：该接口要求请求头 `kuaishou.web.cp.api_ph`，其值从 Cookie 中取（平台把它当设备指纹）。
// 本仓 signer-local 的 `getKuaishouSign` 是 md5 派生，与平台真实 __NS_sig3 未必一致 ⇒
// 这里**不自行伪造**，ph 只从 Cookie 取；取不到即 unsupported（PRD §九 残余限制 3）。
registerAdapter({
  platform: 'kuaishou',
  displayName: '快手',
  requiredCookieNames: ['kuaishou.web.cp.api_ph'],
  requiresSigner: null,
  // 该端点是**纯页码分页**（逆向真源 `getKuaishouContentDetailList($, page)`，body 里只有
  // `page`，响应里的 `pcursor` 平台自己都不读）。因此把 Cookie 里的设备指纹
  // **同时**注入 JSON body（逆向真源两处都放），游标按页码自增（见 parseList）。
  bodyFromCookie: { 'kuaishou.web.cp.api_ph': 'kuaishou.web.cp.api_ph' },
  buildListRequest ({ cursor, pageSize }) {
    const page = Math.max(0, Number(cursor) || 0)
    const count = Math.max(1, Number(pageSize) || 10)
    return {
      method: 'POST',
      url: 'https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/list',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        Referer: 'https://cp.kuaishou.com/article/manage/video',
        Origin: 'https://cp.kuaishou.com',
      },
      body: { orderType: 2, sortType: 1, type: 0, count, page },
    }
  },
  parseList (json) {
    throwIfLoginRequired(json, 'kuaishou')
    const photoList = json && json.data ? json.data.photoList : null
    const list = photoList && Array.isArray(photoList.photoItems) ? photoList.photoItems : null
    if (!list) throw new Error('kuaishou: 响应缺少 data.photoList.photoItems')
    const items = list.map((p) => ({
      postId: String(p.photoId || ''),
      title: String(p.title || p.desc || ''),
      publishedAt: epochToIso(p.publishTime || p.publish_time),
      metrics: {
        views: pickCount(p.playCount, p.viewCount),
        likes: pickCount(p.likeCount),
        comments: pickCount(p.commentCount),
        favorites: pickCount(p.collectCount),
        // 快手列表给的是「涨粉量」(followCount)，不是分享：分享数如实 null，不得顶替（V10）
        shares: pickCount(p.shareCount),
      },
    })).filter(it => it.postId)
    // ⛔ 页码制：`nextCursor` 必须为 null 让编排层按页码自增。
    // 曾经把响应里的 `pcursor` 当页码回灌 —— 实测后果是每轮都请求 `page=0`（重复第一页，
    // 靠首条去重 break 后只拿到一页且状态仍报 ok），或直接跳到第 N 页丢数据（QM-6 CRITICAL）。
    // hasMore：非空页即继续，直到某页返回空（编排层在 items 为空时 break）。
    // 不用响应里的 `count` 判「是否满页」——那是**总数**语义，用它判会在一页就停。
    return { items, nextCursor: null, hasMore: list.length > 0 }
  },
})

// ─────────────────────────── 头条号 ───────────────────────────
// 逆向来源：getContentListAsync$b（mp/agw/creator_center/list，need_stat=true，页码制 page_time.index）。
registerAdapter({
  platform: 'toutiao',
  displayName: '头条号',
  requiredCookieNames: [],
  requiresSigner: null,
  buildListRequest ({ cursor, pageSize }) {
    const page = Math.max(0, Number(cursor) || 0)
    const size = Math.max(1, Number(pageSize) || 20)
    const pageTime = encodeURIComponent(JSON.stringify({ index: page, time_stamp: 0 }))
    const filterParams = encodeURIComponent(JSON.stringify({ search_word: '', source: 0 }))
    const url = 'https://mp.toutiao.com/mp/agw/creator_center/list?type=0&status=2'
      + '&start_cursor=0&end_cursor=0&total_end_cursor=0&size=' + size
      + '&mode=2&need_stat=true&wenda_type=1&page_time=' + pageTime
      + '&filter_params=' + filterParams + '&wtt_need_comment=true&app_id=1231'
    return {
      method: 'GET',
      url,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Referer: 'https://mp.toutiao.com/profile_v4/manage/content/all',
      },
    }
  },
  parseList (json) {
    throwIfLoginRequired(json, 'toutiao')
    const list = json && Array.isArray(json.contents) ? json.contents : null
    if (!list) throw new Error('toutiao: 响应缺少 contents')
    const items = list.map((c) => {
      const attr = c && c.article_attr ? c.article_attr : {}
      const stat = c && c.article_stat ? c.article_stat : {}
      return {
        postId: String(attr.gid || attr.item_id || ''),
        title: String(attr.title || ''),
        publishedAt: epochToIso(attr.create_time || attr.publish_time),
        metrics: {
          // ⛔ 只认 play_count。**不得**回落 `impression_count`：那是展现量，语义不同，
          // 用它冒充播放量会让图文内容系统性偏大（QM-6 后端轴 MAJOR；PRD §5.2 明令禁止顶替）。
          // 平台没给播放数时如实 null，界面显示 `-`。
          views: pickCount(stat.play_count, stat.play_count_v2),
          likes: pickCount(stat.digg_count, stat.like_count),
          comments: pickCount(stat.comment_count),
          favorites: null, // 头条列表不返回收藏数
          shares: pickCount(stat.share_count),
        },
      }
    }).filter(it => it.postId)
    // 页码制：返回满页即认为还有下一页；头条在空页时给 code 0 + 空 contents
    return { items, nextCursor: null, hasMore: list.length > 0 && list.length >= (Number(json.size) || list.length) }
  },
})

module.exports = {
  registerAdapter,
  getAdapter,
  supportedPlatforms,
  __resetAdapters,
  toCount,
  pickCount,
  epochToIso,
  throwIfLoginRequired,
  USER_AGENT,
}
