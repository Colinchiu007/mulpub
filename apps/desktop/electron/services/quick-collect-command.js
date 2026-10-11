// @ts-check
/**
 * quick-collect-command — 快捷采集指令的校验与归一（唯一口径）
 *
 * 为什么单独成模块：这份判据有三个消费者 —— 渲染端表单、IPC handler、引擎纵深防御。
 * 三处各写一份必然漂移（本仓库对「第二份口径」有明确禁令），因此判据只在这里定义：
 *   - validateQuickCollectCommand(raw) → { ok, code, field }   领域码闭集，非法不截断
 *   - normalizeQuickCollectCommand(raw) → 归一后的指令对象 | null
 *
 * 闭集取值一律导出常量：`WINDOW_HOURS` / `ALLOWED_SOURCES` / `LIMITS`。
 * 渲染端（`src/features/collection/quick-collect-commands.js`）复用同一组常量值，
 * 由 `quick-collect-command.test.js` 的「前后端闭集对账」用例强制两侧一致。
 */

const { ALL_SOURCE_IDS } = require('./quick-collect-sources')

/** 领域码闭集（IPC 的 `message` 字段就是这些字符串，渲染端负责映射成文案） */const QUICK_COLLECT_CODES = Object.freeze({
  COMMAND_REQUIRED: 'QC_COMMAND_REQUIRED',
  TITLE_REQUIRED: 'QC_TITLE_REQUIRED',
  TITLE_TOO_LONG: 'QC_TITLE_TOO_LONG',
  PROMPT_REQUIRED: 'QC_PROMPT_REQUIRED',
  PROMPT_TOO_SHORT: 'QC_PROMPT_TOO_SHORT',
  PROMPT_TOO_LONG: 'QC_PROMPT_TOO_LONG',
  KEYWORDS_TOO_MANY: 'QC_KEYWORDS_TOO_MANY',
  KEYWORD_TOO_LONG: 'QC_KEYWORD_TOO_LONG',
  WINDOW_INVALID: 'QC_WINDOW_INVALID',
  SOURCES_INVALID: 'QC_SOURCES_INVALID',
})

/** 时间窗口闭集（小时）；0 = 不限时间 */
const WINDOW_HOURS = Object.freeze([0, 24, 48, 168])

/**
 * 素材源闭集：**从源注册表派生**（`quick-collect-sources.js` 是唯一真源）。
 * 之所以不再手写：源清单同时被校验层、引擎分流、内置词条、渲染端提示消费，
 * 手写四份必然漂移；派生后「加一个源」只需改注册表一处（跨平面 parity 测试兜底）。
 * 保持 `ALLOWED_SOURCES` 这个导出名不变，既有消费者零改动。
 */
const ALLOWED_SOURCES = ALL_SOURCE_IDS

/** 字段边界（渲染端表单与文档都引用这一组数字） */
const LIMITS = Object.freeze({
  TITLE_MAX: 40,
  PROMPT_MIN: 10,
  PROMPT_MAX: 4000,
  KEYWORDS_MAX: 5,
  KEYWORD_MAX: 30,
  /** 单次执行最多真实检索的关键词个数（每个关键词 = 一次跨源检索） */
  QUERY_KEYWORDS_MAX: 3,
})

/**
 * 关键词输入 → 字符串数组。
 * 输入可以是数组（IPC）或字符串（表单/存储 JSON），分隔符同时接受 `,` `，` `、`。
 * 只做拆分与去空白，**不做**去重截断与长度校验（那是校验层的事）。
 * @param {unknown} raw
 * @returns {string[]}
 */
function splitKeywords (raw) {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k == null ? '' : k).trim()).filter((k) => k.length > 0)
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,，、]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
  }
  return []
}

/**
 * 关键词去重：**不区分大小写**（`AI` 与 `ai` 在同一次检索里是同一个查询，
 * 不去重就会对同一个词外呼两次，也让结果里的关键词列表出现视觉重复）。
 * 保留首次出现的原始写法。
 * @param {string[]} list
 * @returns {string[]}
 */
function dedupeKeywords (list) {
  const seen = new Set()
  const out = []
  for (const k of Array.isArray(list) ? list : []) {
    const key = String(k).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(k)
  }
  return out
}

/**
 * 窗口解析：只接受 number 与非空数字字符串（表单 select 会给 `"48"`）。
 * `null` / `''` / `true` / 非数字一律 NaN —— **不得**靠 `Number(null) === 0` 落到合法闭集里，
 * 那会把"字段缺失"静默变成"不限时间"。
 * @param {unknown} raw
 * @returns {number}
 */
function parseWindowHours (raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

/**
 * 校验指令。返回领域码而不是抛错，让 IPC 层能把它原样透给渲染端映射文案。
 * @param {unknown} raw
 * @returns {{ ok: boolean, code: string|null, field: string|null }}
 */
function validateQuickCollectCommand (raw) {
  if (!raw || typeof raw !== 'object') {
    return fail(QUICK_COLLECT_CODES.COMMAND_REQUIRED, 'command')
  }
  const src = /** @type {Record<string, unknown>} */ (raw)

  const title = typeof src.title === 'string' ? src.title.trim() : ''
  if (!title) return fail(QUICK_COLLECT_CODES.TITLE_REQUIRED, 'title')
  if (title.length > LIMITS.TITLE_MAX) return fail(QUICK_COLLECT_CODES.TITLE_TOO_LONG, 'title')

  const prompt = typeof src.prompt === 'string' ? src.prompt.trim() : ''
  if (!prompt) return fail(QUICK_COLLECT_CODES.PROMPT_REQUIRED, 'prompt')
  if (prompt.length < LIMITS.PROMPT_MIN) return fail(QUICK_COLLECT_CODES.PROMPT_TOO_SHORT, 'prompt')
  if (prompt.length > LIMITS.PROMPT_MAX) return fail(QUICK_COLLECT_CODES.PROMPT_TOO_LONG, 'prompt')

  const keywords = splitKeywords(src.keywords)
  if (keywords.length > LIMITS.KEYWORDS_MAX) return fail(QUICK_COLLECT_CODES.KEYWORDS_TOO_MANY, 'keywords')
  if (keywords.some((k) => k.length > LIMITS.KEYWORD_MAX)) return fail(QUICK_COLLECT_CODES.KEYWORD_TOO_LONG, 'keywords')

  const windowHours = parseWindowHours(src.windowHours)
  if (!WINDOW_HOURS.includes(windowHours)) return fail(QUICK_COLLECT_CODES.WINDOW_INVALID, 'windowHours')

  const sources = normalizeSources(src.sources)
  if (sources === null) return fail(QUICK_COLLECT_CODES.SOURCES_INVALID, 'sources')

  return { ok: true, code: null, field: null }
}

/**
 * 归一指令。校验不通过返回 null（调用方决定是报错还是丢弃）。
 *
 * @param {unknown} raw
 * @param {{ now?: number, idFactory?: () => string }} [opts]
 * @returns {object|null}
 */
function normalizeQuickCollectCommand (raw, opts = {}) {
  if (!validateQuickCollectCommand(raw).ok) return null
  const src = /** @type {Record<string, unknown>} */ (raw)
  const nowIso = new Date(typeof opts.now === 'number' ? opts.now : Date.now()).toISOString()
  const builtin = src.builtin === true
  const idFactory = typeof opts.idFactory === 'function' ? opts.idFactory : newCustomCommandId

  const keywords = dedupeKeywords(splitKeywords(src.keywords))
  const sources = /** @type {string[]} */ (normalizeSources(src.sources))

  const id = typeof src.id === 'string' && src.id.trim()
    ? src.id.trim()
    : idFactory()

  const out = {
    id,
    title: String(src.title).trim(),
    summary: typeof src.summary === 'string' ? src.summary.trim().slice(0, 80) : '',
    prompt: String(src.prompt).trim(),
    keywords,
    windowHours: parseWindowHours(src.windowHours),
    sources,
    builtin,
    createdAt: typeof src.createdAt === 'string' && src.createdAt ? src.createdAt : nowIso,
    updatedAt: typeof src.updatedAt === 'string' && src.updatedAt ? src.updatedAt : nowIso,
  }
  return out
}

/**
 * sources 归一：缺省 = 全选；非数组或含未知源 = 非法（返回 null，不静默过滤成空）。
 * 去重并按闭集顺序排序，保证同一份输入永远得到同一份输出。
 * @param {unknown} raw
 * @returns {string[]|null}
 */
function normalizeSources (raw) {
  if (raw === undefined || raw === null || raw === '') return [...ALLOWED_SOURCES]
  if (!Array.isArray(raw)) return null
  if (raw.length === 0) return [] // 显式空数组：不检索（合法，等价于用户关掉了全部源）
  const picked = new Set()
  for (const item of raw) {
    if (typeof item !== 'string') return null
    const name = item.trim()
    if (!ALLOWED_SOURCES.includes(name)) return null
    picked.add(name)
  }
  return ALLOWED_SOURCES.filter((s) => picked.has(s))
}

/** 自定义指令 id：`qc-` + 时间戳36 + 4 位随机（与既有采集条目 id 风格一致） */
function newCustomCommandId () {
  return 'qc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 标题查重：去首尾空白 + 不区分大小写（`localeCompare` 不可用于去重，直接 lower）。
 * @param {string} title
 * @param {Array<{ id?: string, title?: string }>} commands
 * @param {string} [excludeId]
 */
function isDuplicateTitle (title, commands, excludeId) {
  const key = String(title || '').trim().toLowerCase()
  if (!key) return false
  return (Array.isArray(commands) ? commands : []).some((c) => {
    if (!c || (excludeId && c.id === excludeId)) return false
    return String(c.title || '').trim().toLowerCase() === key
  })
}

function fail (code, field) {
  return { ok: false, code, field }
}

module.exports = {
  QUICK_COLLECT_CODES,
  WINDOW_HOURS,
  ALLOWED_SOURCES,
  LIMITS,
  splitKeywords,
  dedupeKeywords,
  parseWindowHours,
  validateQuickCollectCommand,
  normalizeQuickCollectCommand,
  normalizeSources,
  newCustomCommandId,
  isDuplicateTitle,
}
