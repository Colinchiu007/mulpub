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
 * @param {{ searchFn?: Function, llmFn?: Function, log?: object, now?: () => number }} deps
 */
function createQuickCollectEngine (deps = {}) {
  const searchFn = typeof deps.searchFn === 'function' ? deps.searchFn : null
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
   * 检索素材。
   * @param {object} command 归一后的指令
   * @returns {Promise<{ items: object[], failedQueries: number, queryCount: number }>}
   */
  async function retrieve (command) {
    const keywords = command.keywords.slice(0, LIMITS.QUERY_KEYWORDS_MAX)
    const sources = command.sources
    if (!searchFn || keywords.length === 0 || sources.length === 0) {
      return { items: [], failedQueries: 0, queryCount: 0 }
    }
    const items = []
    let failedQueries = 0
    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i]
      try {
        const res = await searchFn(keyword, {
          sources,
          limit: PER_QUERY_LIMIT,
          noCache: true,
          relevanceOn: [...RELEVANCE_ON],
        })
        const results = res && Array.isArray(res.results) ? res.results : []
        for (const item of results) items.push(item)
      } catch (e) {
        failedQueries += 1
        // 只记位置与源数，不记关键词原文（指令可能带私密业务方向）
        if (log) log.warn('[quick-collect] retrieval failed: query#' + (i + 1) + '/' + keywords.length + ' sources=' + sources.length + ' err=' + ((e && e.message) || String(e)))
      }
    }
    return { items, failedQueries, queryCount: keywords.length }
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
    const { items, failedQueries, queryCount } = await retrieve(command)
    const merged = mergeMaterials(items, { windowHours: command.windowHours, now: now() })
    const retrieval = summarizeRetrieval({
      queryCount,
      materialCount: merged.materials.length,
      failedQueries,
    })
    if (log) {
      log.warn('[quick-collect] retrieval done: retrieval=' + retrieval + ' materials=' + merged.materials.length + ' dropped=' + merged.droppedTotal)
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
