// @ts-check
/**
 * quick-collect-engine — 「快捷采集」执行编排（依赖注入，零直连 IO）
 *
 * 一次执行 = 校验 → 检索 → 合并 → 组提示词 → 调默认大模型 → 归一成采集条目。
 * 全部外部依赖注入（`searchFn` / `llmFn` / `log` / `now`），因此单测可覆盖
 * 成功、无素材、检索失败、模型未配置、模型返回空白、模型抛错六类现场，且零出网。
 *
 * 错误码（IPC envelope.code）：
 *   -2   参数校验失败（message = quick-collect-command 的领域码）
 *   -101 默认大模型未配置
 *   -102 大模型调用失败（message = 原始错误摘要）
 *   -103 大模型返回空内容
 */
const {
  validateQuickCollectCommand,
  normalizeQuickCollectCommand,
  LIMITS,
} = require('./quick-collect-command')
const { mergeMaterials, summarizeRetrieval } = require('./quick-collect-materials')
const { splitSources } = require('./quick-collect-sources')
const { buildMessages, buildDisclaimerLine, shouldPrependDisclaimer, formatUtc8 } = require('./quick-collect-prompt')

const ENGINE_ERRORS = Object.freeze({
  VALIDATION_ERROR: -2,
  LLM_NOT_CONFIGURED: -101,
  LLM_FAILED: -102,
  LLM_EMPTY: -103,
})

/** 单次检索每个关键词请求的条数 */
const PER_QUERY_LIMIT = 8
/** 写入采集库的正文长度上限（防止把整篇灌进采集记录） */
const CONTENT_MAX = 20000
/** 相关性判据字段：素材展示面默认只看标题，快捷采集额外看摘要（正文里的关键词也算相关性） */
const RELEVANCE_ON = Object.freeze(['title', 'snippet'])

/** 「模型没配置」类错误的兜底识别（handler 侧会优先用 `err.quickCollectCode` 标注） */
const LLM_NOT_CONFIGURED_RE = /No configured default provider|No configured model|No adapter registered|Model provider manager not available|No LLM provider/i

/**
 * 把大模型调用错误分成「没配置」与「调用失败」两类。
 * 判据优先取显式标注（`err.quickCollectCode`），其次是已知文案；两者都不命中按调用失败处理
 * （fail closed：不能把真实故障说成"没配置"，那会让用户去改配置而不是看日志）。
 * @param {unknown} err
 * @returns {'QC_LLM_NOT_CONFIGURED'|'QC_LLM_FAILED'}
 */
function classifyLlmFailure (err) {
  const code = err && typeof err === 'object' ? /** @type {any} */ (err).quickCollectCode : null
  if (code === 'QC_LLM_NOT_CONFIGURED') return 'QC_LLM_NOT_CONFIGURED'
  const message = err instanceof Error ? err.message : String(err || '')
  return LLM_NOT_CONFIGURED_RE.test(message) ? 'QC_LLM_NOT_CONFIGURED' : 'QC_LLM_FAILED'
}

/**
 * @param {{ searchFn?: Function, trendFn?: Function, llmFn?: Function, log?: object, now?: () => number }} deps
 */
function createQuickCollectEngine (deps = {}) {
  const searchFn = typeof deps.searchFn === 'function' ? deps.searchFn : null
  const trendFn = typeof deps.trendFn === 'function' ? deps.trendFn : null
  const llmFn = typeof deps.llmFn === 'function' ? deps.llmFn : null
  const log = deps.log && typeof deps.log.warn === 'function' ? deps.log : null
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()

  function emit (onProgress, payload) {
    if (typeof onProgress !== 'function') return
    try {
      onProgress(payload)
    } catch (_) { /* 进度回调异常不得影响主流程（与 AIGenerator._safeProgress 同口径） */ }
  }

  /**
   * 检索素材：按 `kind` 分流（PRD §3.1）。
   *   - search 源：逐关键词调 `searchFn`（行为与既有实现逐字一致）；
   *   - trend 源：一次调 `trendFn(sourceIds, { windowHours, now })`（榜单/时间线，无关键词）。
   * `trendFn` 未注入时**降级**（该分支不产出素材、状态记 `skipped`），不抛错中断执行 ——
   * phase5 装配期服务可能尚未就绪，抛错会把「暂时没有」变成「永久失败」。
   * @param {object} command 归一后的指令
   * @returns {Promise<{ items: object[], failedQueries: number, queryCount: number,
   *   searchQueryCount: number, trendSourceCount: number, trendSources: string[],
   *   trendSkipped: boolean, sourceStats: Record<string, string> }>}
   */
  async function retrieve (command) {
    const split = splitSources(command.sources)
    const keywords = command.keywords.slice(0, LIMITS.QUERY_KEYWORDS_MAX)
    const items = []
    let failedQueries = 0
    let searchQueryCount = 0

    if (searchFn && keywords.length > 0 && split.search.length > 0) {
      searchQueryCount = keywords.length
      for (let i = 0; i < keywords.length; i++) {
        const keyword = keywords[i]
        try {
          const res = await searchFn(keyword, {
            sources: split.search,
            limit: PER_QUERY_LIMIT,
            noCache: true,
            relevanceOn: [...RELEVANCE_ON],
          })
          const results = res && Array.isArray(res.results) ? res.results : []
          for (const item of results) items.push(item)
        } catch (e) {
          failedQueries += 1
          // 只记位置与源数，不记关键词原文（指令可能带私密业务方向）
          if (log) log.warn('[quick-collect] retrieval failed: query#' + (i + 1) + '/' + keywords.length + ' sources=' + split.search.length + ' err=' + ((e && e.message) || String(e)))
        }
      }
    }

    /** @type {Record<string, string>} */
    const sourceStats = {}
    /** @type {string[]} 计划性不更新的源（如 arXiv RSS 周末空榜）：与「源故障」必须可区分 */
    const emptyBySchedule = []
    let trendSourceCount = 0
    let trendSkipped = false
    if (split.trend.length > 0) {
      if (!trendFn) {
        // 指令**要求**了趋势源，只是本进程暂时没有这个能力（装配期未就绪）。
        // 这属于「跑了但一无所获」（empty），不属于「指令没配检索」（skipped）——
        // 把 attempted 记上，用户才会看到"本次未检索到素材"而不是"你没配关键词"。
        trendSkipped = true
        trendSourceCount = split.trend.length
        for (const id of split.trend) sourceStats[id] = 'skipped'
      } else {
        trendSourceCount = split.trend.length
        try {
          const res = await trendFn([...split.trend], { windowHours: command.windowHours, now: now() })
          const got = res && Array.isArray(res.items) ? res.items : []
          for (const item of got) items.push(item)
          for (const id of Array.isArray(res && res.emptyBySchedule) ? res.emptyBySchedule : []) emptyBySchedule.push(id)
          const stats = res && res.sourceStats && typeof res.sourceStats === 'object' ? res.sourceStats : {}
          for (const id of split.trend) {
            const state = stats[id] === 'failed' || stats[id] === 'skipped' ? stats[id] : 'ok'
            sourceStats[id] = state
            if (state === 'failed') failedQueries += 1
          }
        } catch (e) {
          for (const id of split.trend) sourceStats[id] = 'failed'
          failedQueries += split.trend.length
          if (log) log.warn('[quick-collect] trend retrieval failed: sources=' + split.trend.length + ' err=' + ((e && e.message) || String(e)))
        }
      }
    }

    return {
      items,
      failedQueries,
      queryCount: searchQueryCount + trendSourceCount,
      searchQueryCount,
      trendSourceCount,
      trendSources: split.trend,
      trendSkipped,
      emptyBySchedule,
      sourceStats,
    }
  }

  /**
   * 执行一条指令。
   * @param {unknown} rawCommand
   * @param {{ onProgress?: Function }} [opts]
   * @returns {Promise<{ code: number, message?: string, data?: object }>}
   */
  async function run (rawCommand, opts = {}) {
    const onProgress = opts.onProgress
    const validation = validateQuickCollectCommand(rawCommand)
    if (!validation.ok) {
      return { code: ENGINE_ERRORS.VALIDATION_ERROR, message: String(validation.code) }
    }
    const command = normalizeQuickCollectCommand(rawCommand, { now: now() })
    if (!command) {
      return { code: ENGINE_ERRORS.VALIDATION_ERROR, message: 'QC_COMMAND_REQUIRED' }
    }

    emit(onProgress, { stage: 'retrieving', percent: 10 })
    const r = await retrieve(command)
    const merged = mergeMaterials(r.items, { windowHours: command.windowHours, now: now() })
    const retrieval = summarizeRetrieval({
      queryCount: r.queryCount,
      materialCount: merged.materials.length,
      failedQueries: r.failedQueries,
    })
    // 素材实际用到的时间语义（UI 与结果卡据此分两类标签：发布 / 抓取时刻）
    const timeKinds = [...new Set(merged.materials.map((m) => m.timeKind))].sort()
    if (log) {
      log.warn('[quick-collect] retrieval done: retrieval=' + retrieval + ' materials=' + merged.materials.length +
        ' dropped=' + merged.droppedTotal + ' search=' + r.searchQueryCount + ' trend=' + r.trendSourceCount)
    }

    if (!llmFn) {
      return { code: ENGINE_ERRORS.LLM_NOT_CONFIGURED, message: 'QC_LLM_NOT_CONFIGURED' }
    }

    emit(onProgress, { stage: 'summarizing', percent: 60 })
    const { messages, temperature, max_tokens } = buildMessages(command, merged.materials)
    let raw
    try {
      raw = await llmFn({ messages, temperature, max_tokens, commandId: command.id })
    } catch (e) {
      const kind = classifyLlmFailure(e)
      if (kind === 'QC_LLM_NOT_CONFIGURED') {
        return { code: ENGINE_ERRORS.LLM_NOT_CONFIGURED, message: 'QC_LLM_NOT_CONFIGURED' }
      }
      const message = (e && e.message) || String(e)
      if (log) log.warn('[quick-collect] llm failed: ' + message)
      return { code: ENGINE_ERRORS.LLM_FAILED, message }
    }

    const text = extractContent(raw)
    if (!text) return { code: ENGINE_ERRORS.LLM_EMPTY, message: 'QC_LLM_EMPTY' }

    const disclaimer = buildDisclaimerLine(command, retrieval)
    const body = (disclaimer && shouldPrependDisclaimer(text))
      ? disclaimer + '\n\n' + text
      : text

    const content = body.length > CONTENT_MAX ? body.slice(0, CONTENT_MAX) : body
    const generatedAt = new Date(now()).toISOString()
    const data = {
      id: 'qc-item-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: command.title + ' · ' + formatUtc8(now() / 1000).slice(0, 10),
      content,
      description: content.slice(0, 120),
      source: command.title,
      sourceUrl: merged.materials.length ? merged.materials[0].url : '',
      wordCount: content.length,
      quickCollect: {
        commandId: command.id,
        commandTitle: command.title,
        builtin: command.builtin,
        windowHours: command.windowHours,
        sources: [...command.sources],
        searchQueryCount: r.searchQueryCount,
        trendSourceCount: r.trendSourceCount,
        trendSources: [...r.trendSources],
        trendSkipped: r.trendSkipped,
        sourceStats: { ...r.sourceStats },
        emptyBySchedule: [...r.emptyBySchedule],
        timeKinds,
        materialCount: merged.materials.length,
        droppedMaterials: merged.droppedTotal,
        retrieval,
        generatedAt,
      },
    }
    emit(onProgress, { stage: 'done', percent: 100 })
    return { code: 0, data }
  }

  return { run }
}

/**
 * 兼容两种返回：字符串，或 `{ content: string }`（AIGenerator.generateWithDefault 的形状）。
 * @param {unknown} raw
 * @returns {string}
 */
function extractContent (raw) {
  if (typeof raw === 'string') return raw.trim()
  if (raw && typeof raw === 'object') {
    const content = /** @type {any} */ (raw).content
    if (typeof content === 'string') return content.trim()
  }
  return ''
}

module.exports = {
  createQuickCollectEngine,
  classifyLlmFailure,
  extractContent,
  ENGINE_ERRORS,
  PER_QUERY_LIMIT,
  CONTENT_MAX,
  RELEVANCE_ON,
}
