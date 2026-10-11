// @ts-check
/**
 * 快捷采集 IPC handlers
 *
 * 只有两条通道 + 一个事件：
 *   - quick-collect:list-presets  内置指令目录（只读、无参）
 *   - quick-collect:run           执行一条指令（withSenderCheck：会触发付费模型调用，
 *                                 与 ai:generate 同级）
 *   - quick-collect:progress      主进程 → 发起窗口的阶段推送（不在本文件接收）
 *
 * 引擎按「依赖身份」惰性构造：phase5 装配期 aiGenerator / contentIntelligence 可能尚未就绪，
 * 注册时硬取会把「当时还没好」冻结成永久。因此每次调用前比对依赖身份，变了就重建。
 */
const { wrapIpcHandlerRaw, withSenderCheck } = require('./helpers')
const { createQuickCollectEngine } = require('../services/quick-collect-engine')
const { listPresetCommands } = require('../services/quick-collect-presets')
const { getSource } = require('../services/quick-collect-sources')
const { createFeedTrendFetcher } = require('../services/quick-collect-trend-sources')

/** 进度事件名（渲染端 preload 逐字订阅同一个字面量） */
const PROGRESS_CHANNEL = 'quick-collect:progress'
/** 单源进素材池的条数上限（与抓取层同口径：榜单前 20 名足够支撑选题判断） */
const MAX_PER_TREND_SOURCE = 20

function registerHandlers (ipcMain, deps = {}) {
  // ⚠️ 不在这里解构：phase5 装配期 `aiGenerator` / `contentIntelligence` 可能后到
  // （容器注册顺序与 setModelProviderManager 注入都在注册之后），解构会把"当时还没有"
  // 冻结成永久，表现为「明明配了模型，快捷采集一直说未配置」。一律按当次 deps 读取。
  const log = deps.log

  let cached = null
  let cachedKeys = null

  function searchFnFor () {
    const contentIntelligence = deps.contentIntelligence
    return (contentIntelligence && typeof contentIntelligence.search === 'function')
      ? (query, opts) => contentIntelligence.search(query, opts)
      : null
  }

  function llmFnFor () {
    const aiGenerator = deps.aiGenerator
    if (!aiGenerator || typeof aiGenerator.generateWithDefault !== 'function') {
      return async () => { throw markNotConfigured() }
    }
    return ({ messages, temperature, max_tokens }) =>
      aiGenerator.generateWithDefault('llm', { messages, temperature, max_tokens })
  }

  /**
   * 趋势源取素材（无关键词），两个 provider 合成：
   *   - `hot-topics`：复用热门选题页已经在跑的 `hotTopicsService`（8 中文主榜 + 5 垂类），
   *     它自带按渠道节流、熔断与 10 分钟缓存；条目**没有发布时间** ⇒ 如实映射为
   *     `timeKind:'observed' + observedAt`（PRD §3.2）；
   *   - `feed`：`quick-collect-trend-sources` 抓 RSS/Atom/JSON 时间线（Solidot / 少数派 /
   *     OSCHINA / IT之家 / 量子位 / InfoQ 中文 / V2EX / arXiv / HuggingFace），这些源**有发布时间** ⇒ `published`。
   * 两个 provider 都按请求的源 id 过滤，各自返回 `ok/skipped/failed` 三段归因；
   * `emptyBySchedule`（如 arXiv 周末空榜）如实上传，供界面区分「计划性不更新」与「源故障」。
   * 两个 provider 都缺席时返回 null ⇒ 引擎走「降级不报错」路径（phase5 装配期可能尚未就绪）。
   */
  function trendFnFor () {
    const service = deps.hotTopicsService
    const hasHotTopics = !!service && typeof service.fetchTopics === 'function'
    const feedFn = createFeedTrendFetcher({ fetchFn: deps.fetchFn, log, now: deps.now })
    if (!hasHotTopics && typeof feedFn !== 'function') return null

    /** 中文热榜 provider（hot-topics） */
    async function hotTopicsProvider (wanted) {
      const res = await service.fetchTopics({})
      const topics = res && Array.isArray(res.topics) ? res.topics : []
      const fetchedAt = Number(res && res.fetchedAt) || Date.now()
      /** @type {Record<string, string>} */
      const sourceStats = {}
      for (const id of wanted) sourceStats[id] = 'skipped'
      const channelStats = res && res.channelStats && typeof res.channelStats === 'object' ? res.channelStats : {}
      for (const id of wanted) {
        const stat = channelStats[id]
        if (!stat) continue
        if (stat.error || stat.breakerOpen) sourceStats[id] = 'failed'
        else if (stat.skipped && !Array.isArray(stat.items)) sourceStats[id] = 'skipped'
        else sourceStats[id] = 'ok'
      }
      const items = []
      /** @type {Record<string, number>} */
      const taken = {}
      for (const t of topics) {
        const channel = String((t && t.channel) || '')
        if (!wanted.includes(channel)) continue
        taken[channel] = (taken[channel] || 0)
        if (taken[channel] >= MAX_PER_TREND_SOURCE) continue
        const descriptor = getSource(channel)
        const title = String((t && t.topic) || '').trim()
        if (!title) continue
        taken[channel] += 1
        // 抖音等源不给条目链接（parseDouyin url=null）：用源主页兜底并标 urlKind='board'，
        // 提示词与 UI 一律称「来源页面」，绝不伪造条目链接（见 PRD §4.1）。
        const itemUrl = t && t.url ? t.url : (descriptor ? descriptor.homeUrl : '')
        items.push({
          url: itemUrl,
          urlKind: t && t.url ? 'item' : 'board',
          title,
          snippet: '',
          source: channel,
          sourceType: descriptor ? descriptor.sourceType : 'hottest',
          timeKind: 'observed',
          observedAt: Math.round((Number(t && t.fetchedAt) || fetchedAt) / 1000),
          rank: Number(t && t.rank) || null,
          hotValue: Number(t && t.hotValue) || null,
        })
      }
      return { items, sourceStats }
    }

    return async (sourceIds, opts = {}) => {
      const wanted = Array.isArray(sourceIds) ? sourceIds.filter((id) => typeof id === 'string' && id) : []
      const hot = wanted.filter((id) => { const s = getSource(id); return s && s.provider === 'hot-topics' })
      const feeds = wanted.filter((id) => { const s = getSource(id); return s && s.provider === 'feed' })
      const items = []
      /** @type {Record<string, string>} */
      const sourceStats = {}
      /** @type {string[]} */
      const emptyBySchedule = []
      if (hot.length && hasHotTopics) {
        const r = await hotTopicsProvider(hot)
        for (const it of r.items) items.push(it)
        Object.assign(sourceStats, r.sourceStats)
      } else {
        for (const id of hot) sourceStats[id] = 'skipped'
      }
      if (feeds.length) {
        const r = await feedFn(feeds, opts)
        for (const it of r.items) items.push(it)
        Object.assign(sourceStats, r.sourceStats)
        for (const id of r.emptyBySchedule || []) emptyBySchedule.push(id)
      }
      return { items, sourceStats, emptyBySchedule }
    }
  }

  function getEngine () {
    const keys = [deps.aiGenerator, deps.contentIntelligence, deps.hotTopicsService]
    if (cached && cachedKeys && cachedKeys.length === keys.length && keys.every((k, i) => cachedKeys[i] === k)) return cached
    cached = createQuickCollectEngine({
      searchFn: searchFnFor(),
      trendFn: trendFnFor(),
      llmFn: llmFnFor(),
      log,
    })
    cachedKeys = keys
    return cached
  }

  ipcMain.handle('quick-collect:list-presets', wrapIpcHandlerRaw(async () => {
    return { code: 0, data: listPresetCommands() }
  }, { label: 'quick-collect:list-presets' }))

  ipcMain.handle('quick-collect:run', withSenderCheck(wrapIpcHandlerRaw(async (event, payload) => {
    const BrowserWindow = deps.BrowserWindow
    const win = BrowserWindow && typeof BrowserWindow.fromWebContents === 'function' && event && event.sender
      ? BrowserWindow.fromWebContents(event.sender)
      : null
    const requestId = payload && typeof payload.requestId === 'string' ? payload.requestId.slice(0, 64) : ''
    const onProgress = (p) => {
      try {
        const alive = !win || typeof win.isDestroyed !== 'function' || !win.isDestroyed()
        if (win && win.webContents && alive) {
          win.webContents.send(PROGRESS_CHANNEL, { requestId, stage: p.stage, percent: p.percent })
        }
      } catch (_) { /* 进度推送失败不得影响主流程 */ }
    }
    // 引擎自带校验（纵深防御）：非法指令返回 { code: -2, message: <领域码> }
    return getEngine().run(payload && payload.command, { onProgress })
  }, { requireArgs: true, label: 'quick-collect:run' })))
}

module.exports = registerHandlers
module.exports.PROGRESS_CHANNEL = PROGRESS_CHANNEL

/**
 * 构造「未配置默认大模型」错误：引擎按 `quickCollectCode` 归类成 -101。
 * 抽成具名函数（而不是在闭包里用局部 `err` 常量再标注）是为了避开 vitest SSR 转换下
 * `const err = new Error(...)` + 紧随其后的属性赋值被重排成 TDZ 的坑（实测
 * `Cannot access 'err' before initialization`），行为完全等价。
 */
function markNotConfigured () {
  const error = new Error('默认大模型未配置')
  error.quickCollectCode = 'QC_LLM_NOT_CONFIGURED'
  return error
}
