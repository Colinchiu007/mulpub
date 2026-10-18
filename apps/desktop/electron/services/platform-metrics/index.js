// @ts-check
/**
 * 平台指标解析器注册表 — 表现数据回采的统一架构
 *
 * 每平台一个 parser 插件，统一接口：
 *   { platform, resolveContentUrl(postId, resultUrl), async fetchMetrics({ url, postId }) }
 * fetchMetrics 返回 { views, likes, comments, favorites, shares, raw }
 *
 * 第一批（有真实 URL 或 postId 可构造）：zhihu / baijiahao / kuaishou / bilibili
 * 未注册平台：recrawl_status = unsupported（UI 提供手动录入兜底）
 * 新平台接入 = 新增一个 parser 文件 + 在此注册，核心零改动。
 */
const log = require('../logger')
// 公开内容页判据的**单一真源**（PRD-PUBLISH-HISTORY-PUBLIC-LINK-2026-10-07 §5/§6.4）。
// 本文件此前自持一份「resultUrl 匹配就用、否则按 postId 拼」的模板，而渲染端
// （PublishHistory.vue）另起炉灶直接用 `result.url` —— 两份实现、正确的那份没被复用，
// 于是创作者后台页被当成作品链接端到端呈现（点开必然是平台登录页）。
// 现在四个 parser 一律委托共享解析器：它额外做作品 ID 闸门（拒绝 `published-`/`task_`
// 合成值、空值字面量、跨平台形态），因此本文件对**既有四平台是逐字 no-op**
// （由 electron/services/platform-metrics/index.test.js 的 M1-M4 逐字锁死）。
const { resolvePublishedContentUrl } = require('@multi-publish/shared-utils/src/published-content-url')

// 平台解析器注册表。key = parser.platform（平台常量，由下方「第一批解析器」逐个注册），
// 空间由代码里的平台清单决定、不随运行时间增长；同平台重复注册是覆盖语义（后者生效），
// 因此**不需要也没有** delete/clear —— R11 审计结论，见 openspec/records/risk-closeout.md §4.2。
const registry = new Map()

function registerParser(parser) {
  if (!parser || !parser.platform || typeof parser.fetchMetrics !== 'function') {
    throw new Error('invalid platform metrics parser: ' + (parser && parser.platform))
  }
  registry.set(parser.platform, parser)
}

function getParser(platform) {
  return registry.get(String(platform || '').toLowerCase()) || null
}

function supportedPlatforms() {
  return Array.from(registry.keys())
}

// ─── 第一批解析器 ───

// 知乎：API 模式发布返回真实文章 URL（/p/{aid}）；页面内 JSON-LD 含互动数
registerParser({
  platform: 'zhihu',
  resolveContentUrl (postId, resultUrl) {
    return resolvePublishedContentUrl({ platform: 'zhihu', postId, recordedUrl: resultUrl }).url
  },
  async fetchMetrics({ url, postId }) {
    const target = url || this.resolveContentUrl(postId, '')
    if (!target) throw new Error('zhihu: no content url')
    return await fetchPageMetrics(target, {
      // 知乎页面 initialData 含点赞/评论（结构随版本变化，解析失败返回零值由上层记 failed）
      likeCount: /"voteupCount":\s*(\d+)/,
      commentCount: /"commentCount":\s*(\d+)/,
      favoriteCount: /"favorit(?:edCount|eCount)"\s*[:=]\s*(\d+)/,
    })
  },
})

// 百家号：API/RPA 均返回真实文章 URL；页面含阅读/点赞/评论
registerParser({
  platform: 'baijiahao',
  resolveContentUrl (postId, resultUrl) {
    return resolvePublishedContentUrl({ platform: 'baijiahao', postId, recordedUrl: resultUrl }).url
  },
  async fetchMetrics({ url, postId }) {
    const target = url || this.resolveContentUrl(postId, '')
    if (!target) throw new Error('baijiahao: no content url')
    return await fetchPageMetrics(target, {
      // 每个交替分支独立捕获组（审查 C-46：首分支匹配时 m[1] undefined → 静默零值）
      viewCount: /(?:"readCount"|"playCount")\s*[:=]\s*(\d+)|阅读[量数][^0-9]*(\d+)/,
      likeCount: /(?:"likeCount"|"praiseCount")\s*[:=]\s*(\d+)|点赞[^0-9]*(\d+)/,
      commentCount: /"commentCount"\s*[:=]\s*(\d+)|评论[^0-9]*(\d+)/,
    })
  },
})

// 快手：RPA 模式 postId 可构造 m.gifshow.com 链接
// 行为修正（PRD §6.4）：旧实现**恒**按 postId 拼 gifshow 地址、把 resultUrl 整个忽略，
// 于是 resultUrl 本身就是公开内容页时白白丢掉更强的证据。现在由共享解析器统一裁决。
registerParser({
  platform: 'kuaishou',
  resolveContentUrl (postId, resultUrl) {
    return resolvePublishedContentUrl({ platform: 'kuaishou', postId, recordedUrl: resultUrl }).url
  },
  async fetchMetrics({ url, postId }) {
    const target = url || this.resolveContentUrl(postId, '')
    if (!target) throw new Error('kuaishou: no content url')
    return await fetchPageMetrics(target, {
      viewCount: /"viewCount"\s*[:=]\s*(\d+)|播放[^0-9]*(\d+)/,
      likeCount: /"likeCount"\s*[:=]\s*(\d+)|点赞[^0-9]*(\d+)/,
      commentCount: /"commentCount"\s*[:=]\s*(\d+)|评论[^0-9]*(\d+)/,
    })
  },
})

// B 站：视频/专栏页面含 view/like/reply/favorite（JSON API 可选）
registerParser({
  platform: 'bilibili',
  resolveContentUrl (postId, resultUrl) {
    return resolvePublishedContentUrl({ platform: 'bilibili', postId, recordedUrl: resultUrl }).url
  },
  async fetchMetrics({ url, postId }) {
    const target = url || this.resolveContentUrl(postId, '')
    if (!target) throw new Error('bilibili: no content url')
    // B 站有公开 API：https://api.bilibili.com/x/web-interface/view?bvid=...
    const bvidMatch = target.match(/(BV[a-zA-Z0-9]+)/)
    if (bvidMatch) {
      try {
        const res = await httpGetJson('https://api.bilibili.com/x/web-interface/view?bvid=' + bvidMatch[1])
        const d = (res && res.data) || {}
        return {
          views: Number(d.stat && d.stat.view) || 0,
          likes: Number(d.stat && d.stat.like) || 0,
          comments: Number(d.stat && d.stat.reply) || 0,
          favorites: Number(d.stat && d.stat.favorite) || 0,
          shares: Number(d.stat && d.stat.share) || 0,
          raw: { api: 'web-interface-view' },
        }
      } catch (e) { /* API 失败回退页面解析 */ }
    }
    return await fetchPageMetrics(target, {
      viewCount: /"view":\s*(\d+)/,
      likeCount: /"like":\s*(\d+)/,
      commentCount: /"reply":\s*(\d+)/,
      favoriteCount: /"favorite":\s*(\d+)/,
    })
  },
})

// ─── 共享工具 ───

async function httpGetJson(url, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchPageMetrics(url, patterns) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const html = await res.text()
    const out = { views: 0, likes: 0, comments: 0, favorites: 0, shares: 0, raw: { source: 'page' } }
    const map = [
      ['views', patterns.viewCount], ['likes', patterns.likeCount],
      ['comments', patterns.commentCount], ['favorites', patterns.favoriteCount], ['shares', patterns.shareCount],
    ]
    for (const [field, pattern] of map) {
      if (!pattern) continue
      const m = html.match(pattern)
      if (m) out[field] = Number(m[1] || m[2]) || 0
    }
    return out
  } catch (e) {
    // 网络级错误（DNS/中断/超时）返回零值兜底（审查 C-47：不让未处理 rejection 传播）
    return { views: 0, likes: 0, comments: 0, favorites: 0, shares: 0, raw: { error: (e && e.message) || 'network error' } }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { registerParser, getParser, supportedPlatforms, httpGetJson, fetchPageMetrics }
