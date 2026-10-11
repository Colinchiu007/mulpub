// @ts-check
/**
 * quick-collect-trend-sources — 趋势源抓取与解析（RSS / Atom / JSON），S2 切片
 *
 * 与 `quick-collect-sources.js` 的分工：注册表**描述**源（kind/timeKind/域名/节流间隔），
 * 本模块**执行**抓取与解析。三类解析器：
 *   - `parseFeedItems`：通用 RSS(`<item>`) / Atom(`<entry>`) 轻量正则解析（与仓库既有
 *     `parseIthomeRSS` 同族，不引入新依赖）；
 *   - `parseV2exHot`：V2EX `hot.json`（有 `created` unix 秒，属 hottest 榜单）；
 *   - `parseHfDailyPapers`：HuggingFace `daily_papers`（`publishedAt` 是 **`MM/DD/YYYY HH:mm:ss`**，
 *     非 ISO —— 错解析会把 10/07/2026 读成 2026-07-10，必须单独处理并锁测试）。
 *
 * 三条硬约束：
 *   ① **字节上限**：实测存在 1.3MB / 1.2MB 的 feed（雷锋网、OpenAI News），桌面端不能无界读；
 *      统一按 `MAX_BYTES` 截断，并保证截断落在**完整条目边界**（正则要求闭合标签，半个条目不产出）。
 *   ② **条数上限**：`MAX_PER_SOURCE`（默认 20）。
 *   ③ **计划性空榜 ≠ 故障**：arXiv RSS 带 `<skipDays>`（含周六周日），周末必然空 ⇒ 记
 *      `emptyBySchedule`，界面文案是"该源本期不更新"，不是"源故障"。
 *
 * 全部依赖注入（`fetchFn` / `now` / `log`），零直连 IO ⇒ 单测零出网、零时钟依赖。
 */
const { getSource } = require('./quick-collect-sources')

/** 单源响应体处理上限（512KB） */
const MAX_BYTES = 512 * 1024
/** 单源条目上限 */
const MAX_PER_SOURCE = 20
/** 单次抓取超时 */
const FETCH_TIMEOUT_MS = 10 * 1000
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** HTML 实体解码（标题里 `&amp;` 很常见，不解会把实体原样喂给模型） */
function decodeEntities (text) {
  return String(text == null ? '' : text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
}

/** 去 CDATA 包裹 */
function stripCdata (text) {
  const s = String(text == null ? '' : text).trim()
  const m = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  return m ? m[1].trim() : s
}

/**
 * 解析时间字符串 → epoch 秒；无法解析返回 null（**不返回 now**：把"解析不出时间"伪装成
 * "刚刚发布"是本 PRD 明令禁止的）。
 * @param {unknown} raw
 * @returns {number|null}
 */
function parseTime (raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return null
  // HuggingFace daily_papers：MM/DD/YYYY HH:mm:ss（美国格式，必须走这一支）
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (us) {
    const [, mm, dd, yyyy, hh, mi, ss] = us
    const t = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh || 0), Number(mi || 0), Number(ss || 0))
    return Number.isFinite(t) && t > 0 ? Math.floor(t / 1000) : null
  }
  const t = Date.parse(s)
  return Number.isFinite(t) && t > 0 ? Math.floor(t / 1000) : null
}

/**
 * 通用 RSS / Atom 解析。只取标题、链接、时间三样（素材层只用这三样 + 来源域名判据）。
 * @param {string} text 已按 MAX_BYTES 截断的响应体
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{ title: string, url: string, publishedAt: number|null }>}
 */
function parseFeedItems (text, opts = {}) {
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : MAX_PER_SOURCE
  const body = String(text == null ? '' : text)
  const items = []
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi
  let m
  while ((m = blockRe.exec(body)) !== null && items.length < limit) {
    const block = m[0]
    const titleRaw = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
    const title = decodeEntities(stripCdata(titleRaw))
    if (!title) continue
    // Atom 用 <link href="…"/>；RSS 用 <link>…</link>。先试 Atom 形态。
    let url = (block.match(/<link[^>]*\bhref=["']([^"']+)["']/i) || [])[1]
    if (!url) url = decodeEntities(stripCdata((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]))
    const publishedRaw = (block.match(/<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2]
    items.push({ title, url: String(url || '').trim(), publishedAt: parseTime(stripCdata(publishedRaw)) })
  }
  return items
}

/** V2EX 热榜 JSON：`created` 为 unix 秒（hottest 类，但仍带原生时间） */
function parseV2exHot (json, opts = {}) {
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : MAX_PER_SOURCE
  const list = Array.isArray(json) ? json : []
  const out = []
  for (const item of list.slice(0, limit)) {
    const title = String((item && item.title) || '').trim()
    if (!title) continue
    out.push({
      title,
      url: String((item && item.url) || '').trim(),
      publishedAt: Number.isFinite(Number(item && item.created)) ? Number(item.created) : null,
      replies: Number(item && item.replies) || null,
    })
  }
  return out
}

/** HuggingFace daily_papers JSON：顶层 `publishedAt` 为美国格式；链接用 `paper.id` 组装 */
function parseHfDailyPapers (json, opts = {}) {
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : MAX_PER_SOURCE
  const list = Array.isArray(json) ? json : []
  const out = []
  for (const item of list.slice(0, limit)) {
    const title = String((item && item.title) || '').trim()
    if (!title) continue
    const paperId = String((item && item.paper && item.paper.id) || '').trim()
    out.push({
      title,
      url: paperId ? 'https://huggingface.co/papers/' + paperId : 'https://huggingface.co/papers',
      publishedAt: parseTime(item && item.publishedAt),
      upvotes: Number(item && item.paper && item.paper.upvotes) || null,
    })
  }
  return out
}

/** 按源声明选择解析器 */
function parseBySource (source, text) {
  if (source.id === 'v2ex_hot') return parseV2exHot(safeJson(text))
  if (source.id === 'hf_papers') return parseHfDailyPapers(safeJson(text))
  return parseFeedItems(text)
}

function safeJson (text) {
  try {
    return JSON.parse(String(text || ''))
  } catch (_) {
    return null
  }
}

/** 计划性空榜识别：arXiv 的 `<skipDays>` 表示周末不更新（空 ≠ 故障） */
function isEmptyBySchedule (text) {
  return /<skipDays[\s>]/i.test(String(text || ''))
}

/**
 * 读响应体并截断到 `MAX_BYTES`（保证不无界读；截断后半个条目会被正则丢掉）。
 * @param {any} res fetch Response（或测试注入的等价对象）
 */
async function readCapped (res) {
  let buf
  if (res && typeof res.arrayBuffer === 'function') {
    buf = Buffer.from(await res.arrayBuffer())
  } else if (res && typeof res.text === 'function') {
    buf = Buffer.from(await res.text(), 'utf8')
  } else {
    buf = Buffer.from('', 'utf8')
  }
  const truncated = buf.length > MAX_BYTES
  return { text: buf.subarray(0, MAX_BYTES).toString('utf8'), truncated }
}

/**
 * 按源抓取（依赖注入 fetchFn）。
 * @param {object} source 注册表条目
 * @param {{ fetchFn: Function, log?: object }} deps
 * @returns {Promise<{ items: object[], state: 'ok'|'failed', emptyBySchedule?: boolean, truncated?: boolean }>}
 */
async function fetchTrendSource (source, deps = {}) {
  const fetchFn = deps.fetchFn
  const url = source.feedUrl || source.homeUrl
  if (typeof fetchFn !== 'function' || !url) return { items: [], state: 'failed' }
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null
  if (timer && typeof timer.unref === 'function') timer.unref()
  try {
    const res = await fetchFn(url, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, */*' },
      signal: controller ? controller.signal : undefined,
      redirect: 'follow',
    })
    if (res && typeof res.ok === 'boolean' && !res.ok) throw new Error('HTTP ' + res.status)
    const { text, truncated } = await readCapped(res)
    const parsed = parseBySource(source, text) || []
    const items = parsed
      .filter((x) => x && x.title && typeof x.url === 'string' && x.url)
      .slice(0, MAX_PER_SOURCE)
      .map((x) => ({
        url: x.url,
        urlKind: 'item',
        title: x.title,
        snippet: '',
        source: source.id,
        sourceType: source.sourceType,
        timeKind: source.timeKind,
        createdUtc: source.timeKind === 'published' ? (x.publishedAt || null) : null,
        observedAt: source.timeKind === 'observed' ? (deps.nowSec ? deps.nowSec() : Math.floor(Date.now() / 1000)) : null,
        rank: null,
        hotValue: Number.isFinite(Number(x.upvotes)) && Number(x.upvotes) > 0 ? Number(x.upvotes) : null,
      }))
    return {
      items,
      state: 'ok',
      emptyBySchedule: items.length === 0 && isEmptyBySchedule(text),
      truncated,
    }
  } catch (e) {
    if (deps.log && typeof deps.log.warn === 'function') {
      deps.log.warn('[quick-collect] trend feed failed: source=' + source.id + ' err=' + ((e && e.message) || String(e)))
    }
    return { items: [], state: 'failed' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 构造 feed 类趋势源的抓取器（供 IPC 层与引擎注入）。
 * 带**按源缓存**（键 = namespace + 排序后的源 id，值含写入时刻；TTL 默认 10 分钟）与
 * **按源节流**（`intervalMinutes`：只有真正放行去抓的请求才消耗一个 interval）。
 * @param {{ fetchFn?: Function, log?: object, now?: () => number, ttlMs?: number }} deps
 */
function createFeedTrendFetcher (deps = {}) {
  const fetchFn = typeof deps.fetchFn === 'function' ? deps.fetchFn : (typeof fetch === 'function' ? fetch : null)
  const log = deps.log
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const ttlMs = Number.isFinite(deps.ttlMs) && deps.ttlMs > 0 ? deps.ttlMs : 10 * 60 * 1000
  /** @type {Map<string, { at: number, items: object[], state: string, emptyBySchedule?: boolean }>} */
  const cache = new Map()
  /** @type {Map<string, number>} */
  const lastFetch = new Map()

  return async function feedTrendFn (sourceIds, opts = {}) {
    const ids = (Array.isArray(sourceIds) ? sourceIds : []).filter((id) => {
      const s = getSource(id)
      return s && s.kind === 'trend' && s.provider === 'feed'
    })
    /** @type {Record<string, string>} */
    const sourceStats = {}
    /** @type {string[]} */
    const emptyBySchedule = []
    const items = []
    const cacheKey = 'quick-collect-trend|' + [...ids].sort().join(',')
    const cached = cache.get(cacheKey)
    const fresh = cached && (now() - cached.at) < ttlMs
    if (fresh && !opts.force) {
      for (const id of ids) sourceStats[id] = cached.state
      return { items: cached.items, sourceStats, emptyBySchedule: cached.emptyBySchedule || [] }
    }
    for (const id of ids) {
      const source = getSource(id)
      const interval = Number(source.intervalMinutes) || 0
      const last = lastFetch.get(id)
      if (!opts.force && interval > 0 && Number.isFinite(last) && (now() - last) < interval * 60 * 1000) {
        sourceStats[id] = 'skipped'
        continue
      }
      lastFetch.set(id, now())
      const res = await fetchTrendSource(source, { fetchFn, log })
      sourceStats[id] = res.state
      if (res.emptyBySchedule) emptyBySchedule.push(id)
      for (const it of res.items) items.push(it)
    }
    cache.set(cacheKey, { at: now(), items, state: 'ok', emptyBySchedule })
    return { items, sourceStats, emptyBySchedule }
  }
}

module.exports = {
  MAX_BYTES,
  MAX_PER_SOURCE,
  FETCH_TIMEOUT_MS,
  decodeEntities,
  stripCdata,
  parseTime,
  parseFeedItems,
  parseV2exHot,
  parseHfDailyPapers,
  isEmptyBySchedule,
  readCapped,
  fetchTrendSource,
  createFeedTrendFetcher,
}
