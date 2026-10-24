// @ts-check
/**
 * HotTopicsService — 热门选题聚合服务（主进程）v2
 *
 * 职责：
 *   - 从 8 个公开渠道并发抓取热搜榜/热榜选题
 *   - 复用 collection-engine 防反爬组件（限流/熔断/缓存）
 *   - 分类（渠道原生 + 关键词打分多标签）→ 去重 → 缓存落 SQLite settings
 *
 * v2 变更（方案A/B/C/D，修复分类结构性稀疏）：
 *   A. MAX_PER_CHANNEL 20→50、MAX_TOPICS 160→400；条目携带多标签 categories[]
 *   B/D. 稀疏分类定向补拉：主聚合后某分类条目数低于 CATEGORY_BOOSTS[cat].threshold
 *       或 UI 显式 boostCategories 指定时，追加抓取该分类垂类榜单
 *       （百度财经tab / 新浪财经滚动 / IT之家RSS / 微博情感·健康垂类过滤），
 *       补拉条目直挂目标分类，id 含 board 段避免与主榜撞号。
 *   C. LLM 分类兜底：仍为 general 的条目批量交 deps.llmClassify 分类，
 *       结果落盘缓存（hot_topics_llm_labels，上限 500 条）；未配置/失败静默降级。
 *
 * IPC 通道（由 ipc-handlers/hot-topics.js 注册）：
 *   hot-topics:fetch      { force, boostCategories } → { code, data: { topics, fetchedAt, channelStats } }
 *   hot-topics:get-cache   {}       → { code, data: cache }
 */

const { classifyTopicMulti, CATEGORY_KEYS } = require('./hot-topics/classifier')
const { pickContentFields, filterViableEntries, withLegacyKind } = require('./hot-topics/item-model.js')
const { CHANNEL_PARSERS } = require('./hot-topics/channels')
const { scoreTopics, markTrend } = require('./hot-topics/scorer')
const { ChannelThrottle, ChannelBreaker, quotaKeyOf } = require('./hot-topics/throttle')
// gyread 源定义单独成模块：① 把「实现就绪」与「获准抓取」分开（合规依据自成一处，
// 不会被误当成已生效配置）；② 本文件登记值 534 + 容差 200，main 已漂移到 671，
// 余量将尽 —— 按门禁意图拆分而非抬基线。启用前必读该模块的合规说明。
const { GYREAD_SOURCE } = require('./hot-topics/gyread-source')

const CACHE_KEY = 'hot_topics_cache'
const LLM_LABELS_KEY = 'hot_topics_llm_labels'
const CACHE_TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 10 * 1000
/**
 * 手动 force 刷新的最小间隔（P1）。
 *
 * 为什么必须有：UI 的 `refresh(true)` 会把 `force=true` 一路传到这里，而 v2 的 force
 * 直接跳过缓存 TTL —— 也就是说**决定第三方压力的是用户点刷新的频率，而它没有上限**。
 * 缓存 TTL（10 分钟）约束的是自动刷新，约束不了手点。
 * 取 60s：足够拦截「连点刷新」与「无脑轮询」，又不会让用户觉得刷新坏了（60s 后仍可真实刷新）。
 * 带 `boostCategories` 的定向补拉**不受此限制**（那是用户明确指名的补拉意图，不能被吞）。
 */
const MANUAL_REFRESH_MIN_INTERVAL_MS = 60 * 1000
const THROTTLE_STATE_KEY = 'hot_topics_throttle_state' // P3：限流/熔断状态落盘（跨进程重启）
const MAX_PER_CHANNEL = 50
const MAX_TOPICS = 400 // 10 渠道 × 50 条候选（去重后实际更少；含垂类补拉）；上限兼顾 IPC 载荷，按统一热度截断尾部
const LLM_BATCH_LIMIT = 40   // 单次抓取最多送 LLM 分类的 general 条目数（成本控制）
const LLM_LABELS_MAX = 500   // LLM 标签缓存条目上限（超限按插入序裁剪）
const RANK_CONFIG_KEY = 'hot_topics_rank_config' // P2 评分配置：{ channelWeights?, halfLifeMs? }（可选，缺省用内置默认）

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * 小红书 App 端固定请求头（`edith.xiaohongshu.com/api/sns/v1/search/hot_list`）。
 *
 * 该接口**免登录、免 Cookie**，但门槛是「固定头六项齐全」：`User-Agent` / `referer` /
 * `xy-direction` / `shield` / `xy-platform-info` / `xy-common-params`，缺少其中任一 `xy-*` 或
 * `shield` 一律返回 **406**（2026-10-12 逐项隔离实验证实）。取值公开自多个 MIT 开源项目
 * （60s `src/modules/rednote.module.ts`、hot-topics `src/fetchers/rednote.ts`），
 * **不是**本项目的私有凭证，也不是用户数据。
 *
 * ⚠️ `shield` 是**静态** token：平台轮换后该渠道立即 406 失效，只能人工替换下方常量。
 * `_collectChannel` 对 406 有**单独告警**（唯一需要人工介入的故障形态），不要与普通网络失败混排。
 */
const XHS_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.7(0x18000733) NetType/WIFI Language/zh_CN'
const XHS_SHIELD = 'XYAAAAAQAAAAEAAABTAAAAUzUWEe4xG1IYD9/c+qCLOlKGmTtFa+lG434Oe+FTRagxxoaz6rUWSZ3+juJYz8RZqct+oNMyZQxLEBaBEL+H3i0RhOBVGrauzVSARchIWFYwbwkV'
const XHS_PLATFORM_INFO = 'platform=iOS&version=8.7&build=8070515&deviceId=C323D3A5-6A27-4CE6-AA0E-51C9D4C26A24&bundle=com.xingin.discover'
const XHS_COMMON_PARAMS = 'app_id=ECFAAF02&build=8070515&channel=AppStore&deviceId=C323D3A5-6A27-4CE6-AA0E-51C9D4C26A24&device_fingerprint=20230920120211bd7b71a80778509cf4211099ea911000010d2f20f6050264&device_fingerprint1=20230920120211bd7b71a80778509cf4211099ea911000010d2f20f6050264&device_model=phone&fid=1695182528-0-0-63b29d709954a1bb8c8733eb2fb58f29&gid=7dc4f3d168c355f1a886c54a898c6ef21fe7b9a847359afc77fc24ad&identifier_flag=0&lang=zh-Hans&launch_id=716882697&platform=iOS&project_id=ECFAAF&sid=session.1695189743787849952190&t=1695190591&teenager=0&tz=Asia/Shanghai&uis=light&version=8.7'

/**
 * 主渠道配置：端点、请求头、最小间隔（分钟）、风险级别。
 * intervalMinutes 由内存限流器使用（简单时间戳节流，避免高频抓取触发反爬）。
 *
 * `fallbacks`（2026-10-12 新增）：同一平台**同源**端点的顺序降级链，仅在主端点抓取失败
 * 或解析出**空列表**时按序尝试。刻意不用并发 —— 同源数据并发拉取既放大对平台的风控面，
 * 又会让同一条选题被跨「渠道」去重后误算成「多榜同现」的全民热点信号（scorer sourceBonus）。
 */
const CHANNEL_CONFIGS = [
  { id: 'zhihu', name: '知乎', url: 'https://api.zhihu.com/topstory/hot-list?limit=50', headers: {}, intervalMinutes: 5, riskLevel: 'low' },
  { id: 'toutiao', name: '今日头条', url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', headers: { Referer: 'https://www.toutiao.com/' }, intervalMinutes: 5, riskLevel: 'medium' },
  { id: 'tencent', name: '腾讯新闻', url: 'https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=50', headers: {}, intervalMinutes: 10, riskLevel: 'medium' },
  { id: 'bilibili', name: '哔哩哔哩', url: 'https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1', headers: {}, intervalMinutes: 10, riskLevel: 'low' },
  {
    id: 'douyin', name: '抖音',
    url: 'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1',
    headers: { Referer: 'https://www.douyin.com/' }, intervalMinutes: 15, riskLevel: 'high',
    // 缺浏览器 UA（service 统一注入 DESKTOP_UA）或 Referer 时是「200 + word_list 空数组」，
    // 不是 4xx —— 这正是「空列表必须视为失败」的原因（调研硬约束①）
    fallbacks: [
      { url: 'https://aweme-lq.snssdk.com/aweme/v1/hot/search/list/?aid=1128&version_code=880', headers: {} },
      { url: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', headers: {} },
    ],
  },
  {
    id: 'xiaohongshu', name: '小红书',
    url: 'https://edith.xiaohongshu.com/api/sns/v1/search/hot_list',
    headers: {
      'User-Agent': XHS_APP_UA,
      referer: 'https://app.xhs.cn/',
      'xy-direction': '22',
      shield: XHS_SHIELD,
      'xy-platform-info': XHS_PLATFORM_INFO,
      'xy-common-params': XHS_COMMON_PARAMS,
    },
    intervalMinutes: 30, riskLevel: 'high',
  },
  {
    id: 'ifeng', name: '凤凰网',
    url: 'https://ne883dbn.ifeng.com/hotspotlist?page=1&gv=7.9.1&av=7.9.1',
    headers: { Referer: 'https://ishare.ifeng.com/hotNewsRank' }, intervalMinutes: 15, riskLevel: 'medium',
    // 兜底：i.ifeng.com 首页内联 allData.hotRankData.data（同一份榜单的另一个出口，51 条）。
    // 存在的意义是 ifeng 的 API 主机名由前端 __nd__ 动态下发，随时可能换域。
    fallbacks: [
      { url: 'https://i.ifeng.com/', headers: {}, parser: 'ifeng_inline' },
    ],
  },
  { id: 'baidu', name: '百度热搜', url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime', headers: {}, intervalMinutes: 10, riskLevel: 'low' },
  { id: 'weibo', name: '微博热搜', url: 'https://weibo.com/ajax/statuses/hot_band', headers: { Referer: 'https://weibo.com/' }, intervalMinutes: 10, riskLevel: 'medium' },
  { id: 'tophub', name: '微博(tophub)', url: 'https://tophub.today/n/KqndgxeLl9', headers: {}, intervalMinutes: 30, riskLevel: 'medium' },
]

/**
 * 稀疏分类定向补拉配置（方案B/D）。
 * threshold：主聚合后该分类条目数低于此值 → 自动触发 sources 补拉；
 *   UI 空分类「补拉该分类」按钮经 boostCategories 显式触发时不受阈值限制。
 * sources[].parser：复用 CHANNEL_PARSERS 键；board：id 中的撞号隔离段；
 *   boostCategory：条目直挂分类；filterCategory：解析后仅保留该原生分类的条目（微博垂类）。
 * 端点均经 2026-09-20 实测可用（探测记录见 PRD-热门选题分类供给增强）。
 */
const CATEGORY_BOOSTS = {
  finance: { threshold: 6, sources: [
    { id: 'baidu-finance', name: '百度财经榜', url: 'https://top.baidu.com/api/board?platform=wise&tab=finance', parser: 'baidu', channel: 'baidu', board: 'finance', boostCategory: 'finance', headers: {}, intervalMinutes: 10, riskLevel: 'low' },
    { id: 'sina-finance', name: '新浪财经滚动', url: 'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=50', parser: 'sina_finance', channel: 'sina_finance', board: 'finance', boostCategory: 'finance', headers: { Referer: 'https://finance.sina.com.cn/' }, intervalMinutes: 15, riskLevel: 'medium' },
  ] },
  tech: { threshold: 6, sources: [
    // `throttleKey`（P2）：与 ai 补拉源共享同一 RSS 端点的配额（同一端点一个配额）。
    { id: 'ithome-tech', name: 'IT之家热榜', url: 'https://www.ithome.com/rss/', parser: 'ithome_rss', channel: 'ithome_tech', board: 'tech', boostCategory: 'tech', headers: {}, intervalMinutes: 15, riskLevel: 'low', throttleKey: 'ithome-rss' },
  ] },
  emotion: { threshold: 4, sources: [
    { id: 'weibo-emotion', name: '微博情感垂类', url: 'https://weibo.com/ajax/statuses/hot_band', parser: 'weibo', channel: 'weibo', board: 'emotion', boostCategory: 'emotion', filterCategory: '情感', headers: { Referer: 'https://weibo.com/' }, intervalMinutes: 10, riskLevel: 'medium' },
  ] },
  health: { threshold: 4, sources: [
    { id: 'weibo-health', name: '微博健康垂类', url: 'https://weibo.com/ajax/statuses/hot_band', parser: 'weibo', channel: 'weibo', board: 'health', boostCategory: 'health', filterCategory: '健康医疗', headers: { Referer: 'https://weibo.com/' }, intervalMinutes: 10, riskLevel: 'medium' },
  ] },
  ai: { threshold: 4, sources: [
    // AI 一级分类没有公开的「AI 榜」垂类端点，复用 IT之家 RSS 并由分类器筛选 AI 条目
    // （`onlyCategory` 用分类器本身做过滤，不新增第二份关键词表——避免判据漂移）。
    // `throttleKey`（P2）与 tech 补拉源共享同一配额：两个身份打的是**同一个 RSS 端点**，
    // 若各自配额就是 2 次/15min；共享后 1 次/15min，且一方的失败也保护另一方。
    { id: 'ithome-ai', name: 'IT之家(AI 专题筛)', url: 'https://www.ithome.com/rss/', parser: 'ithome_rss', channel: 'ithome_tech', board: 'ai', boostCategory: 'ai', onlyCategory: 'ai', headers: {}, intervalMinutes: 15, riskLevel: 'low', throttleKey: 'ithome-rss' },
    // ⛔ GYREAD AI 日报：已按合规裁决摘除，**默认不抓取**（robots 在 `*` 组禁 `/news/`）。
    // 解析实现与测试保留，但不挂启用路径 —— 解析器可用 ≠ 获准抓取。
    // 启用前必读 `GYREAD_SOURCE` 上方的合规说明与三条前置条件。
  ] },
  // 教育/国际暂无稳定可用垂类端点（探测记录：百度 education tab、头条分类参数、v2ex 均不可用），
  // 依赖 方案A 关键词/映射修复 + 方案C LLM 兜底补充
  education: { threshold: 4, sources: [] },
  international: { threshold: 4, sources: [] },
}

/**
 * 限流/熔断原语已抽到 `./hot-topics/throttle.js`（配额治理 2026-10-13）。
 *
 * ⚠️ **键语义已变更**：v2 用「来源身份 id」作键，但同一 URL 常挂多个 id
 * （weibo 主渠道 + weibo-emotion + weibo-health 共用同一端点；ithome-tech + ithome-ai 共用 RSS），
 * 按 id 计数等于没有配额——换个 id 就能再来一次。现在键统一取 `quotaKeyOf(config)`
 * （显式 `throttleKey` > URL 归一化），**同一端点只有一个配额**。
 * 原 `ChannelThrottle` / `ChannelBreaker` 的唯一真源在 throttle.js，本文件不再保留副本。
 */

class HotTopicsService {
  /**
   * @param {{
   *   log?: { info: Function, warn: Function, error: Function },
   *   settingsStore?: { getSetting: Function, setSetting: Function },
   *   llmClassify?: (topics: string[]) => Promise<Record<string, string>>,
   * }} deps
   *   llmClassify（方案C）：批量 LLM 分类，返回 { 选题文本: 分类枚举 }；
   *   可缺省（未配置模型）或抛错 —— 均静默降级保持关键词结果。
   */
  constructor(deps = {}) {
    this.log = deps.log || { info: () => {}, warn: () => {}, error: () => {}, notify: () => {} }
    this.settingsStore = deps.settingsStore || null
    this.llmClassify = typeof deps.llmClassify === 'function' ? deps.llmClassify : null
    this.throttle = new ChannelThrottle()
    this.breaker = new ChannelBreaker()
    /** @type {{ topics: Array, fetchedAt: number, channelStats: Object } | null} */
    this.memCache = null
    this.inFlight = null
    /** @type {number} 上一次**真实** force 抓取的时间（P1 手动刷新最小间隔的判据） */
    this._lastManualRefreshAt = 0
    this._restoreQuotaState()
  }

  /**
   * P3：从 settings 恢复限流/熔断状态。
   *
   * 为什么：v2 的限流/熔断是纯进程内存态，应用重启后清零 —— 「重启后的第一轮」等于
   * 全渠道并发外呼，且完全不记得 5 分钟前刚打过同一批端点。
   * 恢复失败**只清空**（退化成无记忆），绝不退化成「放行一切」。
   */
  _restoreQuotaState() {
    if (!this.settingsStore || typeof this.settingsStore.getSetting !== 'function') return
    try {
      const raw = this.settingsStore.getSetting(THROTTLE_STATE_KEY)
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!parsed || typeof parsed !== 'object') return
      this.throttle.restore(parsed.throttle)
      this.breaker.restore(parsed.breaker)
      if (Number.isFinite(parsed.lastManualRefreshAt)) this._lastManualRefreshAt = parsed.lastManualRefreshAt
      this.log.info && this.log.info('[hot-topics] quota state restored (throttle entries=' +
        (parsed.throttle && Array.isArray(parsed.throttle.lastFetch) ? parsed.throttle.lastFetch.length : 0) + ')')
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] quota state restore failed (start with empty state): ' +
        (e && e.message ? e.message : String(e)))
    }
  }

  /** P3：把限流/熔断状态写回 settings（吞错，不影响抓取主流程）。 */
  _persistQuotaState() {
    if (!this.settingsStore || typeof this.settingsStore.setSetting !== 'function') return
    try {
      this.settingsStore.setSetting(THROTTLE_STATE_KEY, JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        throttle: this.throttle.serialize(),
        breaker: this.breaker.serialize(),
        lastManualRefreshAt: this._lastManualRefreshAt,
      }))
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] quota state persist failed (ignored): ' +
        (e && e.message ? e.message : String(e)))
    }
  }

  /** 运行期注入 LLM 分类兜底（phase1-context 在 ModelProviderManager 就绪后接线） */
  setLlmClassify(fn) {
    this.llmClassify = typeof fn === 'function' ? fn : null
  }

  /** 读缓存（内存 → SQLite settings），fail-closed 回退空结构 */
  getCache() {
    if (this.memCache) return this.memCache
    if (this.settingsStore && typeof this.settingsStore.getSetting === 'function') {
      try {
        const raw = this.settingsStore.getSetting(CACHE_KEY)
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed && Array.isArray(parsed.topics) && typeof parsed.fetchedAt === 'number') {
          this.memCache = { topics: (parsed.topics || []).map(withLegacyKind), fetchedAt: parsed.fetchedAt, channelStats: parsed.channelStats || {} }
          return this.memCache
        }
      } catch (e) {
        this.log.warn && this.log.warn('[hot-topics] cache parse failed:', e && e.message)
      }
    }
    return { topics: [], fetchedAt: 0, channelStats: {} }
  }

  _writeCache(cache) {
    this.memCache = cache
    if (this.settingsStore && typeof this.settingsStore.setSetting === 'function') {
      try {
        this.settingsStore.setSetting(CACHE_KEY, JSON.stringify(cache))
      } catch (e) {
        this.log.warn && this.log.warn('[hot-topics] cache write failed:', e && e.message)
      }
    }
  }

  /** 读 LLM 标签落盘缓存（fail-closed 空对象） */
  _readLlmLabels() {
    if (!this.settingsStore || typeof this.settingsStore.getSetting !== 'function') return {}
    try {
      const raw = this.settingsStore.getSetting(LLM_LABELS_KEY)
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] llm labels parse failed:', e && e.message)
    }
    return {}
  }

  _writeLlmLabels(labels) {
    if (!this.settingsStore || typeof this.settingsStore.setSetting !== 'function') return
    try {
      const keys = Object.keys(labels)
      const trimmed = keys.length > LLM_LABELS_MAX
        ? Object.fromEntries(keys.slice(keys.length - LLM_LABELS_MAX).map(k => [k, labels[k]]))
        : labels
      this.settingsStore.setSetting(LLM_LABELS_KEY, JSON.stringify(trimmed))
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] llm labels write failed:', e && e.message)
    }
  }

  /** 单渠道抓取（带 UA/头/超时），返回原始文本或抛错 */
  async _fetchChannel(config) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(config.url, {
        headers: {
          'User-Agent': DESKTOP_UA,
          'Accept': 'application/json, text/html, */*',
          ...config.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.text()
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 单渠道完整流程：限流 → 熔断 → 抓取（主端点 → 顺序降级 fallback）→ 解析 → 多标签分类
   *
   * v3 新增两条合同（依据 2026-10-12 端点实测）：
   *   ① **空列表视为失败**。抖音缺 UA/Referer 时是「HTTP 200 + `word_list` 空数组」、
   *      小红书固定头失效时是 406、部分端点异常时返回空 list —— 这些都不是成功。
   *      记成功会让熔断器永不打开，UI 只显示「该渠道 0 条」而没有任何可排查信号。
   *   ② **fallback 顺序降级而非并发**：同源端点并发既放大风控面，又会让同一选题
   *      被跨渠道去重后误算成「多榜同现」（scorer 的 sourceBonus 是全民热点信号，
   *      被同源端点灌水即失真）。
   */
  async _collectChannel(config, fetchedAt) {
    // 限流：未到最小间隔 → 跳过（用缓存数据，不报错）
    // 键 = 配额键（quotaKeyOf）：同一 URL 的多个身份共享同一份配额（P0）。
    const quotaKey = quotaKeyOf(config)
    if (!this.throttle.tryAcquire(quotaKey, config.intervalMinutes)) {
      // 与主身份区分：让调用方/排查日志能看出这是「同 URL 配额被别的身份占用」
      return { channel: config.id, items: null, skipped: true, reason: 'throttled-by-url', quotaKey }
    }
    // 熔断：OPEN 状态 → 跳过（同样按配额键，一个身份失败保护整个端点）
    if (this.breaker.isOpen(quotaKey)) {
      return { channel: config.id, items: null, skipped: true, breakerOpen: true, quotaKey }
    }
    const attempts = [
      { url: config.url, headers: config.headers, parser: config.parser || config.id },
      ...(Array.isArray(config.fallbacks) ? config.fallbacks : []),
    ]
    let lastError = null
    for (let i = 0; i < attempts.length; i++) {
      const at = attempts[i]
      try {
        const text = await this._fetchChannel({ url: at.url, headers: at.headers || {} })
        const parser = CHANNEL_PARSERS[at.parser || config.parser || config.id]
        if (!parser) throw new Error('no parser for ' + (at.parser || config.parser || config.id))
        const rawItems = parser(text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text)
        const items0 = rawItems.slice(0, MAX_PER_CHANNEL).map(x => {
          const multi = classifyTopicMulti(x.rawCategory, x.channel, x.topic)
          return {
            id: x.channel + ':' + x.rank,
            topic: x.topic,
            channel: x.channel,
            kind: x.kind,
            ...pickContentFields(x),
            category: multi.category,
            categories: multi.categories,
            rank: x.rank,
            hotValue: x.hotValue,
            url: x.url,
            fetchedAt,
          }
        })
        const items = filterViableEntries(items0, { channel: config.id, log: this.log }).kept
        // 合同①：空列表不是成功
        if (!items.length) throw new Error('empty list (endpoint returned 0 items; treated as failure)')
        this.breaker.recordSuccess(quotaKey)
        if (i > 0) {
          this.log.info && this.log.info('[hot-topics] channel ' + config.id + ' recovered via fallback #' + i)
        }
        return { channel: config.id, items, skipped: false, viaFallback: i > 0 ? i : undefined }
      } catch (e) {
        lastError = e
        const msg = e && e.message ? e.message : String(e)
        if (msg.includes('406')) {
          // 合同②：406 是「小红书 shield 固定头失效」的特征信号，必须能一眼区分出来 ——
          // 这是本模块唯一需要人工介入（替换静态常量）的故障形态。
          this.log.warn && this.log.warn('[hot-topics] channel ' + config.id +
            ' HTTP 406: 固定请求头（shield）已失效，需人工更新静态常量（不是网络故障）')
        } else {
          this.log.warn && this.log.warn('[hot-topics] channel ' + config.id + ' attempt ' +
            (i + 1) + '/' + attempts.length + ' failed: ' + msg)
        }
      }
    }
    const state = this.breaker.recordFailure(quotaKey)
    return {
      channel: config.id,
      items: null,
      skipped: false,
      error: lastError && lastError.message ? lastError.message : String(lastError),
      breaker: state,
    }
  }

  /**
   * 单垂类补拉（方案B/D）：限流/熔断键用 source.id（与主榜隔离，
   * 微博情感/健康垂类共用端点但各自独立节流）。id 含 board 段
   * （如 weibo:emotion:3）避免与主榜 'weibo:3' 撞号。
   * filterCategory：解析后仅保留该原生分类条目（微博 band_list 垂类过滤）。
   * indexFilter：传给解析器的过滤参数（gyread 索引按 date/days 过滤，否则 1421 条全量入库）。
   *
   * v3 分类归属（修复「科技类混入不沾边内容」根因之一）：v2 把条目的
   * `category` 无条件硬写成 `source.boostCategory`，分类器完全不参与 —— 垂类端点里
   * 夹带的异质条目（跨界榜单条目、垂类 RSS 的非本行内容）会被强行挂到目标分类下。
   * 现在先走分类器：分类器判出明确分类时以分类器为准；只有它给出 general（确实无信号）
   * 时才用 boostCategory 兜底 —— 垂类榜本身即该分类的定向供给，兜底仍保供。
   *
   * enrichWithEdition（gyread 专用）：索引只给**日报页**地址，一手原文链接要从单期 HTML 抽。
   * 该增强**fail-open**：抓取/解析失败只丢 `sourceUrls`，不丢条目、不记渠道失败 ——
   * 否则站点一次版式变动就会让整个 AI 补拉渠道记失败，把高质量选题全部丢掉。
   */
  async _collectBoostChannel(source, fetchedAt) {
    // 补拉同样按配额键（P0）：微博垂类与微博主渠道、IT之家两路补拉共用端点，
    // 必须共享配额，否则「换个 board 身份」就能绕过节流。
    const quotaKey = quotaKeyOf(source)
    if (!this.throttle.tryAcquire(quotaKey, source.intervalMinutes)) {
      return { channel: source.id, items: null, skipped: true, boost: true, reason: 'throttled-by-url', quotaKey }
    }
    if (this.breaker.isOpen(quotaKey)) {
      return { channel: source.id, items: null, skipped: true, breakerOpen: true, boost: true, quotaKey }
    }
    try {
      const text = await this._fetchChannel(source)
      const parser = CHANNEL_PARSERS[source.parser]
      if (!parser) throw new Error('no boost parser for ' + source.id)
      const parsed = text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text
      // 第二参数：gyread 索引需 date/days 过滤（全量 1421 条远超候选上限）；其余解析器忽略
      let rawItems = source.indexFilter ? parser(parsed, source.indexFilter) : parser(parsed)
      if (source.filterCategory) {
        rawItems = rawItems.filter(x => x.rawCategory === source.filterCategory)
      }
      // onlyCategory：用分类器本身做筛（如 AI 专题），不引入第二份关键词表
      if (source.onlyCategory) {
        rawItems = rawItems.filter(x => classifyTopicMulti(x.rawCategory, x.channel, x.topic).category === source.onlyCategory)
      }
      const items0 = rawItems.slice(0, MAX_PER_CHANNEL).map(x => {
        const multi = classifyTopicMulti(x.rawCategory, x.channel, x.topic)
        const categories = multi.category === 'general'
          ? [source.boostCategory]
          : multi.categories.slice(0, 3)
        return {
          id: source.channel + ':' + source.board + ':' + x.rank,
          topic: x.topic,
          channel: source.channel,
          kind: x.kind,
          ...pickContentFields(x),
          category: categories[0] || source.boostCategory,
          categories: categories.length ? categories : [source.boostCategory],
          rank: x.rank,
          hotValue: x.hotValue,
          url: x.url,
          fetchedAt,
        }
      })
      const items = filterViableEntries(items0, { channel: source.channel, log: this.log }).kept
      this.breaker.recordSuccess(quotaKey)
      return { channel: source.id, items, skipped: false, boost: true }
    } catch (e) {
      const state = this.breaker.recordFailure(quotaKey)
      this.log.warn && this.log.warn('[hot-topics] boost channel ' + source.id + ' failed:', e && e.message ? e.message : String(e), state)
      return { channel: source.id, items: null, skipped: false, error: e && e.message ? e.message : String(e), boost: true }
    }
  }

  /**
  }

  /** 聚合一批渠道结果为 { channelStats, allTopics, seen }（跨渠道按选题文本去重，先到者保留） */
  _aggregate(results, allTopics = [], seen = new Map(), channelStats = {}) {
    for (const r of results) {
      channelStats[r.channel] = {
        // 限流/熔断跳过不算失败：ok 保持 true，避免渠道下拉误标「不可用」
        ok: !r.error,
        skipped: !!r.skipped,
        error: r.error || null,
        count: r.items ? r.items.length : 0,
      }
      if (!r.items) continue
      for (const item of r.items) {
        // 归一化：兼容缺 categories 的旧形态条目（测试 mock / 陈旧缓存结构）
        const norm = { ...item }
        norm.categories = Array.isArray(norm.categories) && norm.categories.length
          ? norm.categories.slice(0, 3)
          : [norm.category || 'general']
        const key = norm.topic.trim()
        const prev = seen.get(key)
        if (prev) {
          const target = allTopics[prev.index]
          target.mergedFrom = target.mergedFrom || []
          if (!target.mergedFrom.includes(norm.channel)) target.mergedFrom.push(norm.channel)
          // 分类升级：先到条目为 general 而后来条目带明确分类（垂类补拉）→ 提升主分类并并标签
          for (const c of norm.categories) {
            if (!target.categories.includes(c) && target.categories.length < 3) target.categories.push(c)
          }
          if (target.category === 'general' && norm.category && norm.category !== 'general') {
            target.category = norm.category
          }
        } else {
          seen.set(key, { index: allTopics.length })
          allTopics.push(norm)
        }
      }
    }
    return { channelStats, allTopics, seen }
  }

  /** 分类计数（多标签口径：条目 categories 内每个标签都计） */
  _categoryCounts(items) {
    const counts = {}
    for (const t of items) {
      const cats = (Array.isArray(t.categories) && t.categories.length) ? t.categories : [t.category || 'general']
      for (const c of cats) counts[c] = (counts[c] || 0) + 1
    }
    return counts
  }

  /** 读评分配置（P2 渠道权重/半衰期配置化；fail-closed 空对象=用默认值） */
  _readRankConfig() {
    if (!this.settingsStore || typeof this.settingsStore.getSetting !== 'function') return {}
    try {
      const raw = this.settingsStore.getSetting(RANK_CONFIG_KEY)
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] rank config parse failed:', e && e.message)
    }
    return {}
  }

  /**
   * 方案C：LLM 分类兜底 —— 对仍为 general 的条目批量分类并应用。
   * 落盘标签缓存（LLM_LABELS_KEY）避免重复计费；llmClassify 缺省/抛错均静默降级。
   */
  async _applyLlmLabels(topics) {
    if (!this.llmClassify) return
    const labels = this._readLlmLabels()
    /** @type {Array<object>} */
    const need = []
    for (const t of topics) {
      if (t.category !== 'general') continue
      const cached = labels[t.topic]
      if (typeof cached === 'string' && CATEGORY_KEYS.includes(cached)) {
        if (cached !== 'general') {
          t.category = cached
          if (!t.categories.includes(cached) && t.categories.length < 3) t.categories.push(cached)
        }
      } else if (!Object.prototype.hasOwnProperty.call(labels, t.topic)) {
        need.push(t)
      }
    }
    const batch = need.slice(0, LLM_BATCH_LIMIT)
    if (!batch.length) return
    try {
      const got = await this.llmClassify(batch.map(t => t.topic))
      if (!got || typeof got !== 'object') return
      let changed = false
      for (const t of batch) {
        const lab = got[t.topic]
        // 合同校验：非法分类一律忽略（保持 general）
        if (typeof lab !== 'string' || !CATEGORY_KEYS.includes(lab)) continue
        labels[t.topic] = lab
        changed = true
        if (lab !== 'general') {
          t.category = lab
          if (!t.categories.includes(lab) && t.categories.length < 3) t.categories.push(lab)
        }
      }
      if (changed) this._writeLlmLabels(labels)
    } catch (e) {
      this.log.warn && this.log.warn('[hot-topics] llm classify failed (silent fallback): ' + (e && e.message ? e.message : String(e)))
    }
  }

  /**
   * 抓取全部渠道（并发），去重、稀疏分类定向补拉、LLM 兜底、写缓存。
   * @param {{ force?: boolean, boostCategories?: string[] }} options
   *   force=true 跳过缓存 TTL 检查；boostCategories=UI 显式要求补拉的分类
   *   （空分类「补拉该分类」按钮），即使当前计数不低于阈值也触发该分类 sources。
   *
   * P1（手动刷新最小间隔）：`force` 不再等于「无上限全量外呼」。UI 的刷新按钮会把
   * force 一路传到这里，v2 里它直接绕过缓存 TTL —— 真正决定第三方压力的是用户点击频率。
   * 现在 force 受 `MANUAL_REFRESH_MIN_INTERVAL_MS` 约束：间隔内返回缓存并带 `throttled` 标记。
   * **例外**：带 `boostCategories` 的定向补拉不受此限制（用户指名的补拉意图不能被吞，
   * 与评审 MINOR-3 的取向一致）。
   */
  async fetchTopics(options = {}) {
    const cache = this.getCache()
    // 时钟回拨防护：fetchedAt 在未来视为过期，避免缓存永不过期
    const age = Date.now() - cache.fetchedAt
    const fresh = cache.fetchedAt > 0 && age >= 0 && age < CACHE_TTL_MS
    if (!options.force && fresh) {
      return { ...cache, fromCache: true }
    }
    // 并发去重：同一时刻只允许一个 fetch 在飞；
    // 但带显式 boostCategories 的用户动作不复用旧请求（其补拉意图会被丢弃，评审 MINOR-3）
    const hasExplicitBoost = Array.isArray(options.boostCategories) && options.boostCategories.length > 0
    if (this.inFlight && !hasExplicitBoost) return this.inFlight

    // P1：手动 force 的最小间隔。显式补拉豁免（hasExplicitBoost）。
    if (options.force && !hasExplicitBoost) {
      const since = Date.now() - this._lastManualRefreshAt
      if (this._lastManualRefreshAt > 0 && since < MANUAL_REFRESH_MIN_INTERVAL_MS) {
        // 返回现有缓存（可能为空结构），并明确标记「被节流」让 UI 可提示而非无反馈
        return { ...cache, fromCache: true, throttled: true }
      }
      this._lastManualRefreshAt = Date.now()
    }

    this.inFlight = (async () => {
      const fetchedAt = Date.now()
      const results = await Promise.all(CHANNEL_CONFIGS.map(cfg => this._collectChannel(cfg, fetchedAt)))
      const { channelStats, allTopics, seen } = this._aggregate(results)
      const previous = Array.isArray(cache.topics) ? cache.topics : []

      // ── 方案B/D：稀疏分类定向补拉（低于阈值自动触发 + UI 显式指定） ──
      // 必须排在 preserve 早退之前：UI 显式「补拉该分类」是用户动作，不能被
      // 主渠道限流跳过的零结果路径静默吞掉（评审 MAJOR-1，2026-09-20）。
      const counts = this._categoryCounts(allTopics)
      /** @type {Set<string>} */
      const wanted = new Set((Array.isArray(options.boostCategories) ? options.boostCategories : [])
        .filter(c => typeof c === 'string' && CATEGORY_KEYS.includes(c)))
      /** @type {Array<object>} */
      const boostSources = []
      for (const [cat, cfg] of Object.entries(CATEGORY_BOOSTS)) {
        if (wanted.has(cat) && !cfg.sources.length) {
          // 用户显式点了「补拉该分类」但该分类没有配置垂类源 → 出声，避免静默无反应
          this.log.warn && this.log.warn('[hot-topics] no boost source configured for category: ' + cat)
        }
        if (!cfg.sources.length) continue
        if (wanted.has(cat) || (counts[cat] || 0) < cfg.threshold) boostSources.push(...cfg.sources)
      }
      if (boostSources.length) {
        const boostResults = await Promise.all(boostSources.map(src => this._collectBoostChannel(src, fetchedAt)))
        this._aggregate(boostResults, allTopics, seen, channelStats)
        this.log.info && this.log.info('[hot-topics] boost fetched ' + boostSources.length + ' sources for categories: ' +
          [...new Set(boostSources.map(s => s.boostCategory))].join(','))
      }

      // 全渠道（含补拉）失败/被限流跳过 → 本轮零选题。此时**不能**用空结果覆盖上一次的非空缓存：
      // 一次网络抖动（或 10s 抓取超时）会把用户已抓到的选题全部清空，UI 直接掉进
      // 「暂无热门选题」空态，需要重新手动刷新才可能恢复（2026-09-14 实测缺陷）。
      // 保守策略：保留上一次的选题与 fetchedAt（保留陈旧值 = 下次非 force 调用仍会重试网络），
      // 只把本轮 channelStats 落盘供 UI 展示失败原因，并打上 preservedStaleCache 标记。
      if (allTopics.length === 0 && previous.length > 0) {
        const preserved = {
          topics: previous,
          fetchedAt: cache.fetchedAt,
          channelStats,
          preservedStaleCache: true,
        }
        this._writeCache(preserved)
        this.log.warn && this.log.warn('[hot-topics] all channels failed; preserved ' + previous.length +
          ' cached topics (stale) instead of overwriting with an empty list')
        return preserved
      }

      // ── P2 衰减数据流（跨轮 carry-over）：本轮被限流/熔断/失败跳过的渠道，沿用上一轮
      //   缓存条目参与统一评分；时间衰减按 age 使其下沉、热度不足自然跌出截断。
      //   全渠道零结果已在上方 preserve 早退（合同：不重排、不 carry）。 ──
      const liveChannels = new Set()
      for (const t of allTopics) liveChannels.add(t.channel)
      const byTopicKey = new Map(allTopics.map((t) => [String(t.topic || '').trim(), t]))
      let carried = 0
      for (const p of previous) {
        const k = String(p.topic || '').trim()
        if (!k || byTopicKey.has(k)) continue
        if (!p.channel || liveChannels.has(p.channel)) continue // channel 未知的旧形态条目不沿用
        allTopics.push(p)
        byTopicKey.set(k, p)
        carried++
      }
      if (carried && typeof this.log.info === 'function') {
        this.log.info('[hot-topics] carried ' + carried + ' stale topics from channels absent this round')
      }

      // ── 统一热度评分：先评分排序、后截断（P0，替代渠道序截断；boost 条目按真实热度插位） ──
      const rankCfg = this._readRankConfig()
      const scored = scoreTopics(allTopics, {
        now: fetchedAt,
        channelWeights: rankCfg.channelWeights || undefined,
        halfLifeMs: rankCfg.halfLifeMs || undefined,
      })
      // P1 trend 数据源：与上一轮（preserve 语义下的旧缓存）名次对比
      markTrend(scored, previous)
      const topics = scored.slice(0, MAX_TOPICS)

      // ── 方案C：LLM 分类兜底（general 条目批量分类 + 落盘缓存；失败静默降级） ──
      await this._applyLlmLabels(topics)

      const newCache = { topics, fetchedAt, channelStats }
      this._writeCache(newCache)
      // P3：本轮已经真实触碰过各端点，把限流/熔断状态落盘（失败吞掉，不影响主流程）
      this._persistQuotaState()
      this.log.info && this.log.info('[hot-topics] fetched ' + topics.length + ' topics from ' +
        Object.values(channelStats).filter(s => s.ok).length + '/' + Object.keys(channelStats).length + ' channels')
      return newCache
    })()

    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }
}

module.exports = {
  HotTopicsService,
  CACHE_KEY,
  LLM_LABELS_KEY,
  CACHE_TTL_MS,
  MANUAL_REFRESH_MIN_INTERVAL_MS,
  THROTTLE_STATE_KEY,
  MAX_PER_CHANNEL,
  MAX_TOPICS,
  CHANNEL_CONFIGS,
  CATEGORY_BOOSTS,
  GYREAD_SOURCE,
  RANK_CONFIG_KEY,
}
