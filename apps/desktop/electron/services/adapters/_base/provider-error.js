// @ts-check
/**
 * provider-error.js — P3.0 统一错误类型
 *
 * 设计决策（devex review 3.1/3.5）：
 * - testConnection 返回 ProviderError 而非裸字符串
 * - 包含 code/category/retryable/context 4 个维度
 * - ERROR_CODES 常量字典防止拼写错误
 * - fromHttpStatus 映射 HTTP 状态码到错误类型
 */

/**
 * ERROR_CODES — 错误码常量字典
 * 使用大写+SNAKE_CASE，防止拼写错误
 */
const ERROR_CODES = Object.freeze({
  AUTH_FAILED: 'AUTH_FAILED',         // 401/403 认证失败
  RATE_LIMITED: 'RATE_LIMITED',       // 429 限流
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',   // 402/额度不足（余额、token 套餐额度耗尽）
  TIMEOUT: 'TIMEOUT',                 // 请求超时
  NETWORK_ERROR: 'NETWORK_ERROR',     // 网络错误（DNS/连接失败）
  INVALID_CONFIG: 'INVALID_CONFIG',   // 配置无效（缺 API Key 等）
  PROVIDER_ERROR: 'PROVIDER_ERROR',   // 供应商内部错误（500）
  CONTENT_POLICY: 'CONTENT_POLICY', // 可明确识别的内容安全拒绝
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED', // 方法未实现
  PLAN_UNSUPPORTED: 'PLAN_UNSUPPORTED', // 账号套餐/认证不含该能力（如 MiniMax 克隆需按量付费，订阅套餐不支持）
})

/**
 * ERROR_META — 错误码元数据（category + retryable）
 * category: auth/rate/network/config/provider/system
 * retryable: 是否值得重试（401 不可重试，429 可重试）
 */
const ERROR_META = {
  AUTH_FAILED:     { category: 'auth',     retryable: false },
  RATE_LIMITED:    { category: 'rate',     retryable: true },
  QUOTA_EXCEEDED:  { category: 'quota',    retryable: false },
  TIMEOUT:         { category: 'network',  retryable: true },
  NETWORK_ERROR:   { category: 'network',  retryable: true },
  INVALID_CONFIG:  { category: 'config',   retryable: false },
  PROVIDER_ERROR:  { category: 'provider',       retryable: true },
  CONTENT_POLICY:  { category: 'content_policy', retryable: false },
  NOT_IMPLEMENTED: { category: 'system',         retryable: false },
  PLAN_UNSUPPORTED: { category: 'config',        retryable: false },
}

/**
 * ProviderError — 统一供应商错误类型
 *
 * @example
 *   throw new ProviderError(ERROR_CODES.AUTH_FAILED, 'Invalid API key', {
 *     providerId: 'openai', statusCode: 401
 *   })
 */
class ProviderError extends Error {
  constructor(code, message, context = {}) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    const meta = ERROR_META[code] || { category: 'unknown', retryable: false }
    this.category = meta.category
    this.retryable = meta.retryable
    this.context = context
  }

  toString() {
    return `[${this.code}] ${this.message}`
  }
}

/**
 * 只识别供应商稳定的内容安全标识；普通说明或裸 400/403 都不能触发内容策略重试。
 */
function hasStrictContentPolicySignal(value) {
  const signal = String(value || '').trim()
  if (!signal) return false
  const normalized = signal.toLowerCase().replace(/[\s-]+/g, '_')
  if ([
    'content_policy',
    'content_policy_violation',
    'content_filter',
    'safety_filter',
    'safety_violation',
    'moderation_blocked',
    'moderation_flagged',
    'moderation_rejected',
  ].includes(normalized)) return true

  return /\b(?:blocked|rejected|filtered)\b[^\n]{0,120}\bcontent(?:[_\s-]+)policy\b/i.test(signal) ||
    /\bcontent(?:[_\s-]+)policy\b[^\n]{0,120}\b(?:blocked|rejected|filtered)\b/i.test(signal) ||
    /\brejected as a result of (?:our )?safety system\b/i.test(signal) ||
    // MiniMax 图片生成内容安全拒绝：base_resp.status_msg 返回 "input new_sensitive"（2026-08-30 复盘 mtequszp_enqn）。
    // 该信号不含 content_policy/moderation 等标准词，但明确表示「输入含敏感内容」，必须进入内容安全改写重试路径，
    // 否则整条 generate_assets 阶段因单张图被拒而失败（69/70 场景有图有音频仍整体失败）。
    /\binput[_\s-]+new[_\s-]+sensitive\b/i.test(signal) ||
    /\bnew[_\s-]+sensitive\b/i.test(signal)
}

/**
 * 归一化供应商内容安全信号为统一枚举（小写 + 下划线）。
 * 用于把不同供应商的专有信号（如 MiniMax `input new_sensitive`、OpenAI `content_policy_violation`）
 * 归一到同一命名空间，供敏感类型分类与审计使用。
 * @param {*} signal 原始信号字符串
 * @returns {string} 归一化后的信号（空输入返回空字符串）
 */
function normalizeContentPolicySignal (signal) {
  return String(signal || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * 优化点 3：provider → 错误信号 → 敏感类型 映射表（2026-08-30）。
 * 提升已知 provider 信号的敏感类型识别准确率，降低 unknown 兜底率。
 * 未命中映射表的信号回退到 classifyContentPolicyType 的文本分类。
 * @type {Object<string, Object<string, string>>}
 */
const SENSITIVE_TYPE_SIGNAL_MAP = Object.freeze({
  'minimax-image': Object.freeze({
    violence_detected: 'violence',
    blood: 'violence',
    weapon: 'violence',
    nudity: 'sexual',
    explicit: 'sexual',
    minor: 'minor',
    child: 'minor',
  }),
  'openai-image': Object.freeze({
    violence: 'violence',
    nudity: 'sexual',
    political: 'political',
    minor: 'minor',
    self_harm: 'selfharm',
  }),
  'stable-diffusion': Object.freeze({
    nudity: 'sexual',
    violence: 'violence',
    child: 'minor',
    political: 'political',
  }),
})

/**
 * 敏感类型分类（方案层 1，2026-08-30）。
 * 把归一化后的内容安全信号归类为可操作的敏感类型，供差异化改写模板与审计使用。
 * 返回枚举：violence / sexual / portrait / political / minor / selfharm / unknown。
 * 无法识别的信号返回 'unknown'（保守兜底，不阻断改写重试路径）。
 * 优化点 3：可选 provider 参数，先查 SENSITIVE_TYPE_SIGNAL_MAP 映射表，未命中回退文本分类。
 * @param {*} signal 原始信号字符串
 * @param {string} [provider] 图片供应商（用于查映射表）
 * @returns {'violence'|'sexual'|'portrait'|'political'|'minor'|'selfharm'|'unknown'}
 */
function classifyContentPolicyType (signal, provider) {
  const normalized = normalizeContentPolicySignal(signal)
  if (!normalized) return 'unknown'
  // 优化点 3：先查 provider 映射表（已知 provider 信号优先）
  const providerKey = String(provider || '').toLowerCase()
  if (providerKey && SENSITIVE_TYPE_SIGNAL_MAP[providerKey]) {
    const mapped = SENSITIVE_TYPE_SIGNAL_MAP[providerKey][normalized]
    if (mapped) return mapped
  }
  // 把下划线还原为空格，使 \b 词边界在单词间正确生效（下划线是 \w 字符，会破坏 \b）。
  const text = normalized.replace(/_/g, ' ')

  if (/\b(?:violent|violence|gore|graphic|blood|bloodshed|brutal)\b/.test(text)) return 'violence'
  if (/\b(?:sexual|sex|nudit|nude|nudity|explicit|porn|erotic|intimate)\b/.test(text)) return 'sexual'
  if (/\b(?:real\s?person|celebrity|public\s?figure|likeness|portrait|identifiable\s?individual)\b/.test(text)) return 'portrait'
  if (/\b(?:political|politic|election|campaign|government|party)\b/.test(text)) return 'political'
  if (/\b(?:minor|child|children|underage|kid)\b/.test(text)) return 'minor'
  if (/\b(?:self\s?harm|suicide|self\s?injur)\b/.test(text)) return 'selfharm'
  // 中文错误信号（2026-08-30 调优）：供应商可能返回中文内容安全错误，
  // 仅英文匹配会归为 unknown，改写指令不精准。
  if (/(?:血腥|暴力|流血|武器)/.test(text)) return 'violence'
  if (/(?:色情|裸露|淫秽|性爱|情色)/.test(text)) return 'sexual'
  if (/(?:肖像|真人|明星|名人|公众人物)/.test(text)) return 'portrait'
  if (/(?:政治|选举|政府|政党|领导人)/.test(text)) return 'political'
  if (/(?:未成年|儿童|小孩|少年)/.test(text)) return 'minor'
  if (/(?:自杀|自伤|自残)/.test(text)) return 'selfharm'
  return 'unknown'
}

function hasContentPolicyContextSignal(context) {
  if (!context || typeof context !== 'object') return false
  if (context.contentPolicy === true || context.content_policy === true) return true
  return [
    context.providerCode,
    context.provider_code,
    context.errorCode,
    context.error_code,
    context.type,
    context.error?.code,
    context.error?.type,
  ].some(hasStrictContentPolicySignal)
}

/**
 * fromHttpStatus — HTTP 状态码映射到 ProviderError
 *
 * @param {number} status - HTTP 状态码
 * @param {string} message - 错误消息
 * @param {object} [context={}] - 附加上下文
 * @returns {ProviderError}
 */
function fromHttpStatus(status, message, context = {}) {
  const statusCode = Number(status)
  const errorMessage = typeof message === 'string' ? message : String(message || '')
  let code
  // Authentication, rate-limit and transport failures must never be retried as
  // content-policy rejections just because a provider reuses an unsafe-looking
  // message or nested code in its error payload.
  if (statusCode === 0) {
    // ETIMEDOUT / ECONNREFUSED 等 Node.js 网络错误
    code = (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout'))
      ? ERROR_CODES.TIMEOUT
      : ERROR_CODES.NETWORK_ERROR
  } else if (statusCode === 401 || statusCode === 403) {
    code = ERROR_CODES.AUTH_FAILED
  } else if (statusCode === 402) {
    code = ERROR_CODES.QUOTA_EXCEEDED
  } else if (statusCode === 429) {
    code = ERROR_CODES.RATE_LIMITED
  } else if (hasStrictContentPolicySignal(errorMessage) || hasContentPolicyContextSignal(context)) {
    code = ERROR_CODES.CONTENT_POLICY
  } else {
    code = ERROR_CODES.PROVIDER_ERROR
  }
  return new ProviderError(code, errorMessage, { ...context, statusCode })
}

const RATE_LIMIT_MESSAGE_PATTERN = /\brate[\s_-]?limit\b|too\s+many\s+requests|限流|请求频率|rate_limit|Error\s+code:\s*429|rpm\s+exhausted|429\s+Too\s+Many/i
const QUOTA_MESSAGE_PATTERN = /\b(?:insufficient|exhausted|exceeded|out\s+of)\b[^\n]{0,40}\b(?:quota|balance|token|credit)s?\b|(?:quota|balance|token|credit)s?[^\n]{0,40}\b(?:exceeded|insufficient|exhausted)\b|(?:usage|token\s*plan)[^\n]{0,30}\blimit\b|(?:用量|额度|配额)[^\n]{0,16}(?:上限|不足|不够|超出|超限|耗尽)|达到额度上限|余额不足|insufficient\s+balance|billing|payment\s+required/i

/**
 * 上游瞬时故障信号（可短退避重试，非用户/配置/额度/内容问题）：
 * - 传输层：超时、连接重置/拒绝、DNS、fetch failed、socket hang up、aborted
 * - 服务端 5xx：system error / internal server error / server error / 网关 502/503/504
 * 2026-08-30 复盘：MiniMax 生图返回 "system error"、agnes-image 返回 "fetch failed" 曾因
 * 未命中本模式被归为 'other' 不重试，导致单次上游抖动整条流水线失败（mtelxg9v_v5d6）。
 */
const TRANSIENT_MESSAGE_PATTERN = /\btimed?\s*out\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|network\s*error|fetch\s+failed|socket\s+hang\s+up|aborted|超时|网络|(?:system|server|internal|gateway|upstream|bad\s+gateway)\s*(?:error|failure)|5\d\d\s*(?:error|server)|internal\s+server\s+error/i

/**
 * 统一把 provider 失败归类为五类，供限流/排队/重试网关决策：
 * - 'rate'           → 触发频率限制（429 / RATE_LIMITED），可等待冷却后重试
 * - 'quota'          → 额度/余额/套餐配额耗尽（402 / QUOTA_EXCEEDED），不重试，需用户处理
 * - 'transient'      → 超时/网络抖动，可短退避重试
 * - 'content_policy' → 明确内容安全拒绝，进入改写/人工处理流程
 * - 'other'          → 其余错误，不重试
 */
function collectProviderFailureTexts(error, depth = 0) {
  if (!error || typeof error !== 'object' || depth > 4) return []
  const texts = []
  const push = (value) => { if (typeof value === 'string' && value.trim()) texts.push(value.trim().slice(0, 2000)) }
  push(error.message)
  push(error.msg)
  push(error.error)
  push(error.status_msg)
  const source = error.context && typeof error.context === 'object' ? error.context : (error.data && typeof error.data === 'object' ? error.data : null)
  if (source) {
    push(source.message)
    push(source.msg)
    push(source.error)
    push(source.status_msg)
    push(source.base_resp && source.base_resp.status_msg)
    push(source.base_resp && source.base_resp.message)
    push(source.response && typeof source.response === 'object' ? source.response.message : null)
  }
  for (const key of ['error', 'context', 'data', 'response']) {
    const nested = error[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) texts.push(...collectProviderFailureTexts(nested, depth + 1))
  }
  return texts
}

function classifyProviderFailure(error) {
  if (!error || typeof error !== 'object') return 'other'
  const message = collectProviderFailureTexts(error).join('\n')
  const statusCode = Number(error.statusCode ?? error.status ?? error.context?.statusCode)
  const code = error.code || error.context?.code

  if (statusCode === 429 || code === ERROR_CODES.RATE_LIMITED) {
    if (QUOTA_MESSAGE_PATTERN.test(message)) return 'quota'
    return 'rate'
  }
  if (statusCode === 402 || code === ERROR_CODES.QUOTA_EXCEEDED) return 'quota'
  if (code === ERROR_CODES.TIMEOUT || code === ERROR_CODES.NETWORK_ERROR) return 'transient'
  if (code === ERROR_CODES.CONTENT_POLICY) return 'content_policy'
  // HTTP 5xx（500/502/503/504）：上游服务端瞬时故障，短退避重试（2026-08-30 复盘）。
  // 认证/额度/限流已在上方拦截，此处 5xx 不会与用户/配置问题混淆。
  if (statusCode >= 500 && statusCode <= 599) return 'transient'

  if (RATE_LIMIT_MESSAGE_PATTERN.test(message)) return 'rate'
  if (QUOTA_MESSAGE_PATTERN.test(message)) return 'quota'
  if (TRANSIENT_MESSAGE_PATTERN.test(message)) return 'transient'
  // 空响应/缺失数据：供应商 200 但未返回可用内容（如 MiniMax TTS 缺 audio、生图空 image_urls），
  // 多为瞬时服务抖动，按 transient 短退避重试（E2E：11:56/12:05 TTS Missing audio data 曾致整线失败）。
  if (/missing\s+(?:audio\s+)?data\s+in\s+response|did\s+not\s+return\s+(?:a\s+)?supported|returned\s+no\s+(?:image|audio)\s+(?:result|data)|empty\s+response|empty\s+image_urls/i.test(message)) return 'transient'
  if (hasStrictContentPolicySignal(message) || hasContentPolicyContextSignal(error.context || error)) return 'content_policy'
  return 'other'
}

module.exports = { ProviderError, ERROR_CODES, fromHttpStatus, hasStrictContentPolicySignal, classifyContentPolicyType, normalizeContentPolicySignal, classifyProviderFailure, RATE_LIMIT_MESSAGE_PATTERN, QUOTA_MESSAGE_PATTERN, TRANSIENT_MESSAGE_PATTERN, SENSITIVE_TYPE_SIGNAL_MAP }
