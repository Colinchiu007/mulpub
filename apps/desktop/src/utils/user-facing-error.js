/**
 * 用户可见错误文案统一格式化（user-facing messages）
 *
 * 主进程 IPC 错误形态：{ code, errorCode, message, messageParams }。
 * 本模块把错误映射为当前语言下「具体原因 + 解决方法建议」的自然语言，
 * 未知错误不暴露原始技术文本（通道名 / 英文错误码 / 栈信息）。
 *
 * 解析顺序（严格）：
 *   1. input.errorCode（稳定机器码，优先）
 *   2. input.code（数值错误码，含 429/402）
 *   3. 遗留原始 message 的 pattern 匹配（兼容旧主进程返回）
 *   4. 调用方 fallback 或通用文案
 */
import { getAppLocale } from '../i18n'
import zhLocale from '@/locales/zh'
import enLocale from '@/locales/en'

const LOCALE_TREES = Object.freeze({ zh: zhLocale, en: enLocale })

export const USER_ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  ENTITLEMENT_REQUIRED: 'ENTITLEMENT_REQUIRED',
  UNTRUSTED_SENDER: 'UNTRUSTED_SENDER',
  NOT_SIGNED_IN: 'NOT_SIGNED_IN',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  IO_ERROR: 'IO_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PROVIDER_EXISTS: 'PROVIDER_EXISTS',
  ADAPTER_NOT_FOUND: 'ADAPTER_NOT_FOUND',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  API_KEY_NOT_CONFIGURED: 'API_KEY_NOT_CONFIGURED',
  API_KEY_REQUIRED: 'API_KEY_REQUIRED',
  LLM_KEY_MISSING: 'LLM_KEY_MISSING',
  AGGREGATION_CONTENT_EMPTY: 'AGGREGATION_CONTENT_EMPTY',
  AGGREGATION_URL_EMPTY: 'AGGREGATION_URL_EMPTY',
  AGGREGATION_URL_INVALID: 'AGGREGATION_URL_INVALID',
  AGGREGATION_SOURCE_TYPE_UNSUPPORTED: 'AGGREGATION_SOURCE_TYPE_UNSUPPORTED',
  AGGREGATION_STYLE_UNSUPPORTED: 'AGGREGATION_STYLE_UNSUPPORTED',
  AGGREGATION_LENGTH_UNSUPPORTED: 'AGGREGATION_LENGTH_UNSUPPORTED',
  AGGREGATION_WORD_COUNT_RANGE_INVALID: 'AGGREGATION_WORD_COUNT_RANGE_INVALID',
  AGGREGATION_REWRITE_FAILED: 'AGGREGATION_REWRITE_FAILED',
  AGGREGATION_INTERNAL_ERROR: 'AGGREGATION_INTERNAL_ERROR',
  AGGREGATION_TASK_NOT_FOUND: 'AGGREGATION_TASK_NOT_FOUND',
  ADAPTER_INIT_FAILED: 'ADAPTER_INIT_FAILED',
  OPERATION_NOT_SUPPORTED: 'OPERATION_NOT_SUPPORTED',
  CREATE_FAILED: 'CREATE_FAILED',
  UPDATE_FAILED: 'UPDATE_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  SET_DEFAULT_FAILED: 'SET_DEFAULT_FAILED',
  ENCRYPT_FAILED: 'ENCRYPT_FAILED',
  CRYPTO_UNAVAILABLE: 'CRYPTO_UNAVAILABLE',
  INVALID_CATEGORY: 'INVALID_CATEGORY',
  STORE_NOT_INITIALIZED: 'STORE_NOT_INITIALIZED',
  NO_UPDATABLE_FIELDS: 'NO_UPDATABLE_FIELDS',
  OPERATION_FAILED: 'OPERATION_FAILED',
})

// i18n-sync-hardening（2026-08-13）：文案单一事实源 = locales（userErrors 命名空间）。
// 本模块只保留：稳定 errorCode 常量、数值码映射、遗留 pattern 归一化与技术文本识别。
// 每条文案 = 「具体原因 + 解决方法建议」，见 locales/{zh,en}.js userErrors.*。
function localeMessageSource (locale, key) {
  const tree = LOCALE_TREES[normalizeLocale(locale)] || LOCALE_TREES.zh
  const leaf = String(key).split('.').reduce(
    (acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined),
    tree
  )
  return typeof leaf === 'string' ? leaf : undefined
}

// 数值错误码 → 稳定 errorCode（含 HTTP 语义码）
const NUMERIC_CODE_MAP = Object.freeze({
  429: USER_ERROR_CODES.RATE_LIMITED,
  402: USER_ERROR_CODES.QUOTA_EXCEEDED,
  '-3': USER_ERROR_CODES.AUTH_REQUIRED,
  '-2': USER_ERROR_CODES.VALIDATION_ERROR,
  '-10': USER_ERROR_CODES.NOT_FOUND,
  '-11': USER_ERROR_CODES.TIMEOUT,
  '-12': USER_ERROR_CODES.NETWORK_ERROR,
  '-13': USER_ERROR_CODES.IO_ERROR,
})

// 遗留原始 message pattern（兼容旧主进程返回，仅用于无法识别 errorCode/code 时）
const PATTERN_RULES = Object.freeze([
  {
    errorCode: USER_ERROR_CODES.AUTH_REQUIRED,
    patterns: [
      /当前许可证无权访问/i, /当前账号没有所需权益/i, /未登录|登录已过期|需要登录|请先登录/i,
      /not signed in|sign[ -]?in required|authentication required|access denied|not authorized|permission denied|unauthorized/i,
    ],
  },
  {
    errorCode: USER_ERROR_CODES.NETWORK_ERROR,
    patterns: [/网络连接|network error|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i],
  },
  {
    errorCode: USER_ERROR_CODES.TIMEOUT,
    patterns: [/超时|timeout|timed out|ETIMEDOUT/i],
  },
  {
    errorCode: USER_ERROR_CODES.STORAGE_UNAVAILABLE,
    patterns: [/存储不可用|存储不可写|storage (unavailable|not)|sqlite|database (error|unavailable)/i],
  },
  {
    errorCode: USER_ERROR_CODES.RATE_LIMITED,
    patterns: [/rate limit|too many requests|\b429\b|限流/i],
  },
  {
    errorCode: USER_ERROR_CODES.QUOTA_EXCEEDED,
    patterns: [/quota exceeded|\b402\b|额度|配额/i],
  },
  {
    errorCode: USER_ERROR_CODES.API_KEY_NOT_CONFIGURED,
    patterns: [/api key not configured|尚未配置 api key|未配置.*api.?key/i],
  },
  {
    errorCode: USER_ERROR_CODES.LLM_KEY_MISSING,
    patterns: [/未配置 LLM API Key|LLM_API_KEY|PO_OPENAI_API_KEY|llm key (is )?missing/i],
  },
  {
    errorCode: USER_ERROR_CODES.IO_ERROR,
    patterns: [/io error|读写.*失败|filesystem|ENOSPC|EACCES|EBUSY/i],
  },
])

function normalizeLocale (locale) {
  if (locale === 'en' || locale === 'zh') return locale
  return 'zh'
}

function defaultLocale () {
  try {
    return getAppLocale()
  } catch (_) {
    return 'zh'
  }
}

// 明显技术性文本特征（命中其一即视为内部文本，禁止直出）：
//   - 内部通道名 store:xxx / pipeline:xxx
//   - 大写下划线错误码 VOICE_CATALOG_UNAVAILABLE / ERR_xxx
//   - 栈信息（line N / at xxx）
//   - IP:端口
const TECHNICAL_TEXT_PATTERNS = Object.freeze([
  /\b[a-z][a-z0-9-]*:[a-z][a-z0-9-]*(?::[a-z0-9-]+)*\b/i,
  /\b[A-Z]{2,}_[A-Z0-9_]+\b/,
  /\b(?:line|at)\s+\d+/i,
  /(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/,
  // 浏览器模式 / 桥接不可用返回的内部哨兵文本，禁止直出，交给 fallback 映射为友好文案。
  /\belectronAPI\b/i,
])

function looksTechnical (text) {
  return TECHNICAL_TEXT_PATTERNS.some((pattern) => pattern.test(text))
}

function toRawText (input) {
  if (input == null) return ''
  if (typeof input === 'string') return input
  if (input instanceof Error) return input.message || ''
  if (typeof input === 'object') {
    const value = input.message ?? input.error ?? input.reason
    if (typeof value === 'string') return value
    return String(value || '')
  }
  return String(input)
}

/**
 * 把 IPC 错误（或异常）格式化为当前语言的用户可见文案。
 * @param {*} input - { code, errorCode, message } | Error | string
 * @param {{ locale?: string, fallback?: string }} [options]
 * @returns {{ errorCode: string, message: string, matched: 'errorCode'|'code'|'pattern'|'fallback' }}
 */
export function formatUserError (input, options = {}) {
  const locale = normalizeLocale(options.locale || defaultLocale())
  const messageFor = (code) => localeMessageSource(locale, `userErrors.${code}`)
  const rawText = toRawText(input)

  // 1. 稳定 errorCode（仅识别 catalog 中已知码，避免把内部码当文案）
  if (input && typeof input === 'object' && typeof input.errorCode === 'string') {
    const known = USER_ERROR_CODES[input.errorCode]
    const message = known ? messageFor(input.errorCode) : null
    if (message) {
      // 插值参数：后端 params（或 messageParams）替换文案中的 {param} 占位符
      const params = { ...(input.params || {}), ...(input.messageParams || {}) }
      const interpolated = Object.keys(params).length
        ? message.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m))
        : message
      return { errorCode: input.errorCode, message: interpolated, matched: 'errorCode' }
    }
  }

  // 2. 数值错误码
  if (input && typeof input === 'object') {
    const numericKey = String(input.code)
    const mapped = NUMERIC_CODE_MAP[numericKey]
    if (mapped) {
      return { errorCode: mapped, message: messageFor(mapped), matched: 'code' }
    }
  }

  // 3. 遗留 raw pattern
  if (rawText) {
    for (const rule of PATTERN_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(rawText))) {
        return { errorCode: rule.errorCode, message: messageFor(rule.errorCode), matched: 'pattern' }
      }
    }
  }

  // 4. 未知错误：
  //    - 原始文本含明显技术标识（通道名 / 错误码 / 栈信息）→ 通用兜底，不泄露内部文本
  //    - 其余（已是自然语言的具体原因）→ 原样透传保留信息，仅在无文本时使用 fallback
  const fallbackMessage = typeof options.fallback === 'string' && options.fallback.trim()
    ? options.fallback
    : messageFor(USER_ERROR_CODES.OPERATION_FAILED)
  if (rawText && looksTechnical(rawText)) {
    return { errorCode: USER_ERROR_CODES.OPERATION_FAILED, message: fallbackMessage, matched: 'fallback' }
  }
  const passThrough = rawText && rawText.length <= 200 ? rawText : fallbackMessage
  return { errorCode: USER_ERROR_CODES.OPERATION_FAILED, message: passThrough, matched: passThrough === rawText ? 'passthrough' : 'fallback' }
}
