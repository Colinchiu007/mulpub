/**
 * quick-collect-commands — 快捷采集指令的前端纯逻辑（校验 / 编解码 / 合并 / 排序）
 *
 * 与主进程 `electron/services/quick-collect-command.js` **同一套闭集**：
 * 常量在这里再声明一次是为了让渲染端（ESM）与主进程（CJS）零耦合，
 * 但两侧一致性由 `quick-collect-commands.test.js` 的「前后端闭集对账」用例强制
 * （直接 import 主进程模块逐项比对，漂移即红）。校验判据本身是**独立实现**
 * （前端要产出字段级内联错误，主进程要产出领域码），两者都按同一组边界取值。
 */

/** 时间窗口闭集（小时）；0 = 不限时间 */
export const WINDOW_HOURS = Object.freeze([0, 24, 48, 168])

/**
 * 素材源闭集（**镜像**：唯一真源是主进程 `electron/services/quick-collect-sources.js`）。
 * 两侧一致性由 `quick-collect-commands.test.js` 的「前后端闭集对账」用例逐项强制。
 * 两类语义不同（PRD §3.1）：`reddit/hackernews/github` 按关键词检索；
 * 中文热榜（`weibo` 起 8 个）是榜单源，**没有发布时间**，按抓取时刻计入时间窗口。
 */
export const ALLOWED_SOURCES = Object.freeze([
  'reddit', 'hackernews', 'github',
  'weibo', 'zhihu', 'douyin', 'bilibili', 'baidu', 'toutiao', 'tencent', 'tophub',
  'solidot', 'sspai', 'oschina', 'ithome', 'qbitai', 'infoq_cn', 'v2ex_hot', 'arxiv_cs_ai', 'hf_papers',
])

/** 中文榜单源子集（渲染端只用于文案分组提示，判据仍在主进程注册表） */
export const CN_TREND_SOURCES = Object.freeze(['weibo', 'zhihu', 'douyin', 'bilibili', 'baidu', 'toutiao', 'tencent', 'tophub'])

/** 中文/技术时间线源子集（有发布时间，S2 接入） */
export const TECH_SOURCES = Object.freeze(['solidot', 'sspai', 'oschina', 'ithome', 'qbitai', 'infoq_cn', 'v2ex_hot', 'arxiv_cs_ai', 'hf_papers'])

/** 字段边界（与主进程 LIMITS 逐项一致） */
export const LIMITS = Object.freeze({
  TITLE_MAX: 40,
  PROMPT_MIN: 10,
  PROMPT_MAX: 4000,
  KEYWORDS_MAX: 5,
  KEYWORD_MAX: 30,
  /** 单次执行最多真实检索的关键词个数（与主进程 LIMITS.QUERY_KEYWORDS_MAX 一致） */
  QUERY_KEYWORDS_MAX: 3,
})

/** 存储键（与 collected_items 同一 store 通道） */
export const QUICK_COLLECT_COMMANDS_KEY = 'quick_collect_commands'

/** 存储版本 */
export const STORAGE_VERSION = 1

/** 表单校验失败 → locale 文案键（组件侧拼 `collection.quickCollect.` 前缀） */
export const FORM_ERROR_KEYS = Object.freeze({
  TITLE_REQUIRED: 'errTitleRequired',
  TITLE_TOO_LONG: 'errTitleTooLong',
  TITLE_DUPLICATE: 'errTitleDuplicate',
  PROMPT_REQUIRED: 'errPromptRequired',
  PROMPT_TOO_SHORT: 'errPromptShort',
  PROMPT_TOO_LONG: 'errPromptTooLong',
  KEYWORDS_TOO_MANY: 'errKeywordsTooMany',
  KEYWORD_TOO_LONG: 'errKeywordTooLong',
  WINDOW_INVALID: 'errWindowInvalid',
})

/** 主进程领域码（`message` 字段）→ 表单文案键（错误提示复用同一批文案） */
export const DOMAIN_CODE_TO_FORM_KEY = Object.freeze({
  QC_TITLE_REQUIRED: 'TITLE_REQUIRED',
  QC_TITLE_TOO_LONG: 'TITLE_TOO_LONG',
  QC_PROMPT_REQUIRED: 'PROMPT_REQUIRED',
  QC_PROMPT_TOO_SHORT: 'PROMPT_TOO_SHORT',
  QC_PROMPT_TOO_LONG: 'PROMPT_TOO_LONG',
  QC_KEYWORDS_TOO_MANY: 'KEYWORDS_TOO_MANY',
  QC_KEYWORD_TOO_LONG: 'KEYWORD_TOO_LONG',
  QC_WINDOW_INVALID: 'WINDOW_INVALID',
  QC_SOURCES_INVALID: 'WINDOW_INVALID',
  QC_COMMAND_REQUIRED: 'PROMPT_REQUIRED',
})

/**
 * 关键词输入 → 数组。分隔符同时接受 `,` `，` `、`（与主进程 splitKeywords 同集合）。
 * @param {unknown} raw
 * @returns {string[]}
 */
export function splitKeywordsInput (raw) {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k == null ? '' : k).trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw.split(/[,，、]/).map((k) => k.trim()).filter(Boolean)
  }
  return []
}

/** 数组 → 输入框可编辑文本（顿号不用，统一逗号分隔） */
export function formatKeywordsInput (raw) {
  return splitKeywordsInput(raw).join(', ')
}

/**
 * 关键词去重（不区分大小写，保留首次出现的写法）——与主进程 `dedupeKeywords` 同口径。
 * @param {string[]} list
 * @returns {string[]}
 */
export function dedupeKeywords (list) {
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
 * 窗口值解析：只接受 number 与非空数字字符串；其余 NaN（与主进程 parseWindowHours 同口径，
 * 避免 `Number(null) === 0` 把"字段缺失"变成"不限时间"）。
 * @param {unknown} raw
 */
export function parseWindowHours (raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

/**
 * 表单校验。返回 `{ ok, errors }`：`errors` 是 `字段 → 文案键`（首个错误优先）。
 * @param {{ title?: unknown, prompt?: unknown, keywords?: unknown, windowHours?: unknown }} form
 * @param {{ existing?: Array<{ id?: string, title?: string }>, excludeId?: string }} [ctx]
 * @returns {{ ok: boolean, errors: Record<string, string> }}
 */
export function validateCommandForm (form, ctx = {}) {
  const errors = {}
  const src = form && typeof form === 'object' ? form : {}

  const title = typeof src.title === 'string' ? src.title.trim() : ''
  if (!title) errors.title = FORM_ERROR_KEYS.TITLE_REQUIRED
  else if (title.length > LIMITS.TITLE_MAX) errors.title = FORM_ERROR_KEYS.TITLE_TOO_LONG
  else if (isDuplicateTitle(title, ctx.existing, ctx.excludeId)) errors.title = FORM_ERROR_KEYS.TITLE_DUPLICATE

  const prompt = typeof src.prompt === 'string' ? src.prompt.trim() : ''
  if (!prompt) errors.prompt = FORM_ERROR_KEYS.PROMPT_REQUIRED
  else if (prompt.length < LIMITS.PROMPT_MIN) errors.prompt = FORM_ERROR_KEYS.PROMPT_TOO_SHORT
  else if (prompt.length > LIMITS.PROMPT_MAX) errors.prompt = FORM_ERROR_KEYS.PROMPT_TOO_LONG

  const keywords = splitKeywordsInput(src.keywords)
  if (keywords.length > LIMITS.KEYWORDS_MAX) errors.keywords = FORM_ERROR_KEYS.KEYWORDS_TOO_MANY
  else if (keywords.some((k) => k.length > LIMITS.KEYWORD_MAX)) errors.keywords = FORM_ERROR_KEYS.KEYWORD_TOO_LONG

  const windowHours = parseWindowHours(src.windowHours)
  if (!WINDOW_HOURS.includes(windowHours)) errors.windowHours = FORM_ERROR_KEYS.WINDOW_INVALID

  return { ok: Object.keys(errors).length === 0, errors }
}

/**
 * 标题查重（去空白、不区分大小写；排除自身 id）——与主进程同一行为。
 * @param {string} title
 * @param {Array<{ id?: string, title?: string }>} [existing]
 * @param {string} [excludeId]
 */
export function isDuplicateTitle (title, existing, excludeId) {
  const key = String(title || '').trim().toLowerCase()
  if (!key) return false
  return (Array.isArray(existing) ? existing : []).some((c) => {
    if (!c || (excludeId && c.id === excludeId)) return false
    return String(c.title || '').trim().toLowerCase() === key
  })
}

/** 自定义指令 id（与主进程 newCustomCommandId 同形状，前缀相同便于日志辨识） */
export function newCommandId () {
  return 'qc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 表单 → 指令对象（新增/编辑共用）。校验不通过返回 null（调用方已有内联错误）。
 * @param {{ title?: unknown, prompt?: unknown, keywords?: unknown, windowHours?: unknown }} form
 * @param {{ existing?: object, excludeId?: string, preset?: object, now?: number }} [opts]
 */
export function buildCommandFromForm (form, opts = {}) {
  const check = validateCommandForm(form, { existing: opts.existing, excludeId: opts.excludeId })
  if (!check.ok) return null
  const nowIso = new Date(typeof opts.now === 'number' ? opts.now : Date.now()).toISOString()
  const preset = opts.preset && typeof opts.preset === 'object' ? opts.preset : null
  return {
    id: preset && preset.id ? preset.id : newCommandId(),
    title: String(form.title).trim(),
    summary: preset && typeof preset.summary === 'string' ? preset.summary : '',
    prompt: String(form.prompt).trim(),
    keywords: dedupeKeywords(splitKeywordsInput(form.keywords)),
    windowHours: parseWindowHours(form.windowHours),
    sources: [...ALLOWED_SOURCES],
    builtin: false,
    createdAt: preset && preset.createdAt ? preset.createdAt : nowIso,
    updatedAt: nowIso,
  }
}

/**
 * 落盘编码：**只写自定义指令**（内置由主进程提供，落盘副本会盖住版本升级）。
 * @param {Array<object>} commands
 * @returns {string}
 */
export function encodeCommands (commands) {
  const list = (Array.isArray(commands) ? commands : [])
    .filter((c) => c && typeof c === 'object' && c.builtin !== true)
    .map((c) => ({
      id: String(c.id || ''),
      title: String(c.title || ''),
      summary: String(c.summary || ''),
      prompt: String(c.prompt || ''),
      keywords: splitKeywordsInput(c.keywords),
      windowHours: parseWindowHours(c.windowHours),
      sources: Array.isArray(c.sources) && c.sources.length ? [...c.sources] : [...ALLOWED_SOURCES],
      builtin: false,
      createdAt: String(c.createdAt || ''),
      updatedAt: String(c.updatedAt || ''),
    }))
  return JSON.stringify({ version: STORAGE_VERSION, commands: list })
}

/**
 * 读取解码：容忍三种历史形态 ——
 *   ① v1 对象 `{version, commands}`；② v0 裸数组；③ 无法解析的字符串/其它类型。
 * 逐条用同一份表单校验丢弃不合法条目，并计数 `skipped`（一条脏数据不得让整表消失）。
 * @param {unknown} raw
 * @returns {{ commands: object[], skipped: number, version: number }}
 */
export function decodeCommands (raw) {
  let parsed = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return { commands: [], skipped: 0, version: STORAGE_VERSION }
    try {
      parsed = JSON.parse(text)
    } catch (_) {
      return { commands: [], skipped: 0, version: STORAGE_VERSION }
    }
  }
  if (parsed === null || parsed === undefined) return { commands: [], skipped: 0, version: STORAGE_VERSION }

  let list = []
  let version = STORAGE_VERSION
  let skipped = 0
  if (Array.isArray(parsed)) {
    list = parsed // v0 裸数组
    version = 0
  } else if (typeof parsed === 'object') {
    version = Number(parsed.version) === STORAGE_VERSION ? STORAGE_VERSION : 0
    list = Array.isArray(parsed.commands) ? parsed.commands : []
  } else {
    return { commands: [], skipped: 0, version: STORAGE_VERSION }
  }

  const commands = []
  for (const item of list) {
    const form = item && typeof item === 'object' ? item : null
    if (!form || form.builtin === true) { skipped += 1; continue }
    const check = validateCommandForm(form)
    if (!check.ok || !form.id) { skipped += 1; continue }
    commands.push({
      id: String(form.id),
      title: String(form.title).trim(),
      summary: typeof form.summary === 'string' ? form.summary.trim().slice(0, 80) : '',
      prompt: String(form.prompt).trim(),
      keywords: dedupeKeywords(splitKeywordsInput(form.keywords)),
      windowHours: parseWindowHours(form.windowHours),
      sources: Array.isArray(form.sources) && form.sources.length ? [...form.sources] : [...ALLOWED_SOURCES],
      builtin: false,
      createdAt: typeof form.createdAt === 'string' ? form.createdAt : '',
      updatedAt: typeof form.updatedAt === 'string' ? form.updatedAt : '',
    })
  }
  return { commands, skipped, version }
}

/** 自定义指令排序：最近修改在前，同时间按标题字典序（渲染稳定） */
export function sortCustomCommands (commands) {
  return [...(Array.isArray(commands) ? commands : [])].sort((a, b) => {
    const ua = String((a && a.updatedAt) || '')
    const ub = String((b && b.updatedAt) || '')
    if (ua !== ub) return ua < ub ? 1 : -1
    return String((a && a.title) || '').localeCompare(String((b && b.title) || ''))
  })
}

/**
 * 内置在前 + 自定义（按修改时间倒序）；同 id 冲突时以内置为准（内置词条以主进程为真源）。
 * @param {Array<object>} presets
 * @param {Array<object>} customs
 */
export function mergeCommands (presets, customs) {
  const builtins = (Array.isArray(presets) ? presets : []).map((c) => ({ ...c, builtin: true }))
  const builtinIds = new Set(builtins.map((c) => c.id))
  const own = sortCustomCommands(customs).filter((c) => c && !builtinIds.has(c.id))
  return [...builtins, ...own]
}

/** 时间范围显示用的 locale 键（组件侧拼前缀） */
export function windowLabelKey (windowHours) {
  const h = parseWindowHours(windowHours)
  if (h === 24) return 'window24'
  if (h === 48) return 'window48'
  if (h === 168) return 'window168'
  return 'window0'
}
