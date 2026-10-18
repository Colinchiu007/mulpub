/**
 * 「字数控制」页的纯逻辑（可单测，不依赖 Vue/DOM）。
 *
 * 契约（已落地后端：ops-center/backend/services/story_text_limit_service.py）
 * - 管理接口字段名为 snake_case：{ scope, label, max_chars, warn_percent, enabled, note,
 *   updated_at, updated_by }，信封另带 defaults / ranges；
 *   任务书里的 camelCase 写法（scopeLabel / maxChars / ...）读侧一并兼容，
 *   避免上游契约措辞与实现漂移时页面直接空白。
 * - max_chars 取值 1000~50000 的整数，默认 10000（历史值 6000）；
 *   warn_percent 取值 50~99 的整数，默认 90；note 最多 200 字。
 * - 区间与默认值的权威来源是后端信封（defaults / ranges）；下面的常量只是**兜底**
 *   与文案模板的默认参数（后端明确要求前端不要另抄一份数字，抄的那份必然先漂移）。
 * - 前端只做**校验并提示**：校验失败即阻止保存，且不改写输入值
 *   （越界值/小数原样留在输入框里，绝不 clamp 成边界 —— PRD §11 E5 的失效形态）。
 * - 生效时机文案一律取自 constants/runtime-delivery.js 的单一真源（RESTART_HINT_*）：
 *   桌面端**只在应用启动时同步一次**，既无定时同步也无手动同步入口。
 */
import { RESTART_HINT_HOW, RESTART_HINT_WHEN } from '../constants/runtime-delivery'

/** 兜底区间（= 后端契约常量，后端未下发 ranges 时使用） */
export const MAX_CHARS_MIN = 1000
export const MAX_CHARS_MAX = 50000
export const WARN_PERCENT_MIN = 50
export const WARN_PERCENT_MAX = 99
export const NOTE_MAX_LEN = 200

/** 兜底默认值（= 后端契约常量，后端未下发 defaults 时使用） */
export const DEFAULT_MAX_CHARS = 10000
export const DEFAULT_WARN_PERCENT = 90

export const DEFAULT_RANGES = {
  maxChars: { min: MAX_CHARS_MIN, max: MAX_CHARS_MAX },
  warnPercent: { min: WARN_PERCENT_MIN, max: WARN_PERCENT_MAX },
  noteMaxLen: NOTE_MAX_LEN,
}

export const DEFAULT_LIMITS = {
  maxChars: DEFAULT_MAX_CHARS,
  warnPercent: DEFAULT_WARN_PERCENT,
}

/**
 * 用户可见提示文案（措辞锁定，Lead 要写进 PRD）。
 * 用函数模板而非拼接字面量：后端若调整区间/默认值，提示与会随之变化而不会自相矛盾。
 */
export function maxCharsError(ranges = DEFAULT_RANGES) {
  return `字数上限需为 ${ranges.maxChars.min}~${ranges.maxChars.max} 的整数`
}

export function warnPercentError(ranges = DEFAULT_RANGES) {
  return `预警阈值需为 ${ranges.warnPercent.min}~${ranges.warnPercent.max} 的整数`
}

export function noteError(ranges = DEFAULT_RANGES) {
  return `备注最多 ${ranges.noteMaxLen} 字`
}

export function resetDoneMessage(defaults = DEFAULT_LIMITS) {
  return `已恢复默认（${defaults.maxChars} 字 / ${defaults.warnPercent}%）`
}

/** 契约默认值下的文案（页面兜底与 PRD 引用用这一份） */
export const MAX_CHARS_ERROR = maxCharsError()
export const WARN_PERCENT_ERROR = warnPercentError()
export const NOTE_ERROR = noteError()
export const RESET_DONE_MESSAGE = resetDoneMessage()

/** 空态文案（后端尚未返回任何范围时展示） */
export const EMPTY_TEXT = '暂无字数控制配置'

/** 历史默认上限（PRD 里要写明「历史为 6000 字」，用于说明本次提升幅度） */
export const HISTORY_MAX_CHARS = 6000

/**
 * 页面顶部说明（用户可见，措辞锁定）。默认上限取自后端 defaults，
 * 因此「默认上限为 N 字」不会与后端实际默认值脱节；
 * 生效时机用 RESTART_HINT_* 单一真源（桌面端只在应用启动时同步一次）。
 */
export function pageDescription(defaults = DEFAULT_LIMITS) {
  return '控制视频创作页各文案输入框的字数上限。'
    + `故事讲述流水线的默认上限为 ${defaults.maxChars} 字（历史为 ${HISTORY_MAX_CHARS} 字）。`
    + `修改后的配置${RESTART_HINT_WHEN}；${RESTART_HINT_HOW}。`
}

/** 「行为与生效说明」第 ③ 条（用户可见，措辞锁定；与页面顶部说明共用同一真源） */
export const EFFECT_NOTICE_SAVE = `保存后${RESTART_HINT_WHEN}；${RESTART_HINT_HOW}。`

/**
 * 把后端可能返回的数字字符串收敛为数字，便于校验与提交。
 * 非字符串原样返回；空字符串返回 null（视为「未填写」，交给区间校验判错）。
 */
function asInt(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : Number(trimmed)
  }
  return typeof value === 'number' ? value : null
}

/** 同时兼容 camelCase / snake_case 的取值（后端已落地 snake_case） */
function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

/**
 * 校验单个字段：不合法时返回中文提示，合法返回空字符串。
 * 注意：`Number.isInteger` 同时排除小数、NaN、null、undefined（不静默取整）。
 */
export function validateMaxChars(value, ranges = DEFAULT_RANGES) {
  const n = asInt(value)
  const { min, max } = ranges.maxChars
  if (!Number.isInteger(n) || n < min || n > max) return maxCharsError(ranges)
  return ''
}

export function validateWarnPercent(value, ranges = DEFAULT_RANGES) {
  const n = asInt(value)
  const { min, max } = ranges.warnPercent
  if (!Number.isInteger(n) || n < min || n > max) return warnPercentError(ranges)
  return ''
}

export function validateNote(value, ranges = DEFAULT_RANGES) {
  const note = value == null ? '' : String(value)
  return Number.isInteger(ranges.noteMaxLen) && note.length > ranges.noteMaxLen
    ? noteError(ranges)
    : ''
}

/**
 * 校验整行，返回三个字段各自的错误文案（合法为空串）。
 * 同时接受页面行模型（camelCase）与后端原始行（snake_case），避免调用方必须记对风格。
 */
export function validateRow(row, ranges = DEFAULT_RANGES) {
  return {
    maxChars: validateMaxChars(pick(row?.maxChars, row?.max_chars), ranges),
    warnPercent: validateWarnPercent(pick(row?.warnPercent, row?.warn_percent), ranges),
    note: validateNote(row?.note, ranges),
  }
}

/**
 * 批量校验，只返回**有问题**的行：
 * [{ scope, scopeLabel, maxChars, warnPercent, note, messages: [第一条错误, ...] }]
 * 顺序与入参一致，便于「提示第一条错误」时定位到用户最先看到的行。
 */
export function collectRowErrors(rows, ranges = DEFAULT_RANGES) {
  const errors = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const perField = validateRow(row, ranges)
    const messages = [perField.maxChars, perField.warnPercent, perField.note].filter(Boolean)
    if (messages.length) {
      errors.push({
        scope: row?.scope ?? '',
        scopeLabel: pick(row?.scopeLabel, row?.label) || row?.scope || '',
        ...perField,
        messages,
      })
    }
  }
  return errors
}

/**
 * 提交给 PUT /story-text-limits 的 items。
 *
 * 字段名按**已落地后端**用 snake_case（后端逐字段读 max_chars / warn_percent，
 * 收到 camelCase 会当成缺字段直接 400）。任务书里的 camelCase 契约与实现不一致，
 * 若后续后端改口径，只需改这一处与 normalizeItems 的兼容分支。
 */
export function toSavePayload(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    scope: row?.scope ?? '',
    max_chars: asInt(pick(row?.maxChars, row?.max_chars)),
    warn_percent: asInt(pick(row?.warnPercent, row?.warn_percent)),
    // enabled 缺省按「启用」提交：后端把显式 false 解读为「关闭下发」，
    // 缺字段时若给 false 会把一次普通保存变成静默停用（与 normalizeItems 的默认口径一致）。
    enabled: pick(row?.enabled) === undefined ? true : Boolean(row.enabled),
    note: row?.note || '',
  }))
}

/**
 * 后端返回的 items → 页面行模型；两种字段风格都接受，缺失字段给安全默认。
 * - enabled 缺省视为启用（后端未下发该字段时不隐藏功能）；
 * - 展示名优先 label（后端）→ scopeLabel（任务书）→ scope，保证「范围名称」列不空白。
 */
export function normalizeItems(raw) {
  return (Array.isArray(raw) ? raw : []).map((row) => ({
    scope: row?.scope ?? '',
    scopeLabel: pick(row?.label, row?.scopeLabel) || row?.scope || '',
    maxChars: pick(row?.max_chars, row?.maxChars),
    warnPercent: pick(row?.warn_percent, row?.warnPercent),
    enabled: pick(row?.enabled) === undefined ? true : Boolean(row.enabled),
    note: row?.note || '',
    updatedAt: pick(row?.updated_at, row?.updatedAt) || '',
    updatedBy: pick(row?.updated_by, row?.updatedBy) || '',
  }))
}

/**
 * GET /story-text-limits 信封 → { ranges, defaults }。
 * 后端未下发（或下发畸形）时逐字段回落契约常量，保证页面永远可校验、可恢复默认。
 */
export function parseLimitsEnvelope(data) {
  const ranges = data?.ranges || {}
  const defaults = data?.defaults || {}
  const isInt = (value) => Number.isInteger(value)
  return {
    ranges: {
      maxChars: {
        min: isInt(ranges.max_chars?.min) ? ranges.max_chars.min : MAX_CHARS_MIN,
        max: isInt(ranges.max_chars?.max) ? ranges.max_chars.max : MAX_CHARS_MAX,
      },
      warnPercent: {
        min: isInt(ranges.warn_percent?.min) ? ranges.warn_percent.min : WARN_PERCENT_MIN,
        max: isInt(ranges.warn_percent?.max) ? ranges.warn_percent.max : WARN_PERCENT_MAX,
      },
      noteMaxLen: isInt(ranges.note_max_len) ? ranges.note_max_len : NOTE_MAX_LEN,
    },
    defaults: {
      maxChars: isInt(defaults.max_chars) ? defaults.max_chars : DEFAULT_MAX_CHARS,
      warnPercent: isInt(defaults.warn_percent) ? defaults.warn_percent : DEFAULT_WARN_PERCENT,
    },
  }
}

/** 更新时间展示：本地时区 YYYY-MM-DD HH:mm；空值显示「—」，无法解析时原样返回 */
export function formatUpdatedAt(value) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
