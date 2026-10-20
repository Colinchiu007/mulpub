import zhLocale from '@/locales/zh'
import enLocale from '@/locales/en'
import { resolveProviderDisplayName, defaultProviderName } from '@/utils/provider-name-map'
import {
  MODEL_API_KEY_PATTERN, MODEL_CONFIGURATION_PATTERN, ACCESS_DENIED_PATTERN,
  RATE_LIMITED_PATTERN, USAGE_LIMIT_EXCEEDED_PATTERN, QUOTA_EXCEEDED_PATTERN,
  EMPTY_RESULT_PATTERN, API_KEY_INVALID_PATTERN, TEXT_ONLY_PATTERN,
  TEXT_TOO_LONG_PATTERN, PREVIEW_MISSING_PATTERN, VOICE_INVALID_PATTERN, VOICE_CLONE_UNAVAILABLE_PATTERN,
  PIPELINE_CONCURRENCY_PATTERN, COMPOSE_SEGMENT_DURATION_PATTERN,
  COMPOSE_DURATION_PATTERN, CONTENT_POLICY_PATTERN, OPTIMIZE_SERVICE_PATTERN,
  UNSUPPORTED_PARAMS_PATTERN, COMPOSE_STAGE_PATTERN, TIMEOUT_PATTERN,
  SCENE_AUDIO_MISSING_PATTERN, SCENE_IMAGE_MISSING_PATTERN, SCENE_VIDEO_MISSING_PATTERN,
  SCENE_SLOT_EMPTY_PATTERN, SCENE_SUBTITLE_REGENERATE_FAILED_PATTERN,
  SCENE_AUDIO_REGENERATE_FAILED_PATTERN, SCENE_PROMPT_REGENERATE_FAILED_PATTERN,
  SCENE_AI_VIDEO_GENERATE_FAILED_PATTERN,
  COMPOSE_INPUT_SIZE_EXCEEDED_PATTERN,
  COMPOSE_SCENE_MEDIA_UNREADABLE_PATTERN, COMPOSE_SCENE_AUDIO_UNREADABLE_PATTERN,
} from './notification-error-patterns'
import { DEFAULT_STORY2VIDEO_TEXT_LIMIT } from './story-text-limit'
import { STORY2VIDEO_NOTIFICATION_KEYS } from './story2video-notifications-keys'
import { normalizeStory2VideoParams, interpolateStory2VideoMessage, resolveLocaleRef } from './story2video-notification-params'

/**
 * 内置默认文案上限（Unicode 码点）。
 *
 * 语义收窄（story-text-limit-control）：这里是**内置默认值**，不再是硬上限。
 * 真实生效上限由运营中心运行时下发块 `storyTextLimit.story2video.maxChars` 覆盖，
 * 解析入口见 ./story-text-limit.js（缺省/非法时回落本值）。
 */
export const MAX_STORY2VIDEO_TEXT_CHARACTERS = DEFAULT_STORY2VIDEO_TEXT_LIMIT.maxChars

// STORY2VIDEO_NOTIFICATION_KEYS 由 ./story2video-notifications-keys 单一真源提供（2026-10-20 拆分），
// 此处 re-export 保持既有导入路径不变（message-contract.js / notifyCore / 各 composable 均从本模块导入）。
export { STORY2VIDEO_NOTIFICATION_KEYS }

const notificationKeySet = new Set(Object.values(STORY2VIDEO_NOTIFICATION_KEYS))

/**
 * i18n-content-sync（2026-08-13）：用户可见文案单一事实源 = locales/{zh,en}.js。
 * 本模块不再持有任何 zh/en 文案，只保留：稳定 key 常量、错误归一化正则、参数归一化与插值逻辑。
 * 新增文案一律写入 locales（zh/en 成对），见 openspec/specs/i18n-content-sync/spec.md。
 *
 * 2026-10-20 拆分（error-message-user-friendly-audit，逐文件行数门禁）：
 *   - key 常量      → ./story2video-notifications-keys.js
 *   - 参数归一化与插值引擎 → ./story2video-notification-params.js
 *   - 本模块保留「消息渲染编排 + 归一化判定 + 导出 API」
 */
const LOCALE_TREES = Object.freeze({ zh: zhLocale, en: enLocale })

/** 从 locale 原始语料树读取 key 的模板串；函数式消息（如进度插值）返回 undefined，模块不使用。 */
function localeMessageSource (locale, key) {
  const tree = LOCALE_TREES[normalizeStory2VideoLocale(locale)] || LOCALE_TREES.zh
  const leaf = String(key).split('.').reduce(
    (acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined),
    tree
  )
  return typeof leaf === 'string' ? leaf : undefined
}

export function countUnicodeCodePoints (value) {
  return Array.from(String(value ?? '')).length
}

export const countStory2VideoTextCharacters = countUnicodeCodePoints

export function normalizeStory2VideoLocale (locale) {
  return String(locale || '').trim().toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function getStory2VideoLocale () {
  if (typeof window === 'undefined') return 'zh'
  return normalizeStory2VideoLocale(window.localStorage?.getItem('locale'))
}

export function getStory2VideoNotificationUiText (locale = getStory2VideoLocale(), pipelineDisplayName = '') {
  // 弹窗标题统一为「提示」/「Notice」：去掉流水线名前缀（如「图片轮播 提示」→「提示」），
  // 具体内容在消息正文中体现，避免标题重复流水线名词（2026-08-08 UX 规范）。
  const safeName = String(pipelineDisplayName || '').trim()
  void safeName
  const read = (suffix) => localeMessageSource(locale, `story2video.dialog.${suffix}`) || ''
  return {
    dialogTitle: read('title'),
    acknowledge: read('acknowledge'),
    cancel: read('cancel'),
    confirmDelete: read('confirmDelete'),
    deleting: read('deleting'),
    resume: read('resume'),
    resuming: read('resuming'),
    resumeHint: read('resumeHint'),
    goToModelSettings: read('goToModelSettings'),
  }
}
function isKnownMessageKey (key) {
  return notificationKeySet.has(key)
}

function resolveMessageKey (notification, fallbackKey) {
  const suppliedKey = notification?.messageKey || notification?.errorCode
  if (isKnownMessageKey(suppliedKey)) return suppliedKey

  const raw = String(notification?.error || notification?.message || '').trim()
  // 流水线启动前置校验（主进程契约 errorCode）：缺失能力清单 → models_required
  if (notification?.errorCode === 'PIPELINE_MODEL_REQUIREMENTS_MISSING') {
    return STORY2VIDEO_NOTIFICATION_KEYS.MODELS_REQUIRED
  }
  // 参数校验失败（normalizeStory2VideoTextParams 抛出的通用 Error 没有 .code 时兜底）
  if (notification?.errorCode === 'INVALID_PARAMS') {
    return STORY2VIDEO_NOTIFICATION_KEYS.INVALID_PARAMS
  }
  // 断点恢复失败（pipeline-engine resumeOrchestration errorCode 契约）：映射到具体文案，
  // 避免回退到 operation_failed 兜底吞掉真实原因。
  if (notification?.errorCode === 'RUN_SNAPSHOT_NOT_FOUND') {
    return STORY2VIDEO_NOTIFICATION_KEYS.RESUME_SNAPSHOT_NOT_FOUND
  }
  if (notification?.errorCode === 'RUN_NOT_FAILED') {
    return STORY2VIDEO_NOTIFICATION_KEYS.RESUME_RUN_NOT_FAILED
  }
  if (notification?.errorCode === 'RUN_NOT_ORCHESTRATOR') {
    return STORY2VIDEO_NOTIFICATION_KEYS.RESUME_RUN_NOT_ORCHESTRATOR
  }
  if (notification?.errorCode === 'STAGE_NOT_FOUND') {
    return STORY2VIDEO_NOTIFICATION_KEYS.RESUME_STAGE_NOT_FOUND
  }
  // 内容政策类失败需修改文案后重新启动（前端 historyItemResumable 已拦截，此处兜底防误恢复）
  if (notification?.errorCode === 'PIPELINE_USER_INPUT_REQUIRED') {
    return STORY2VIDEO_NOTIFICATION_KEYS.NEEDS_USER_INPUT
  }
  if (Number(notification?.code) === -3 || Number(notification?.errorCode) === -3) return STORY2VIDEO_NOTIFICATION_KEYS.ACCESS_DENIED
  if (ACCESS_DENIED_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.ACCESS_DENIED
  // 明确的用量窗口耗尽优先于 429；仅凭普通 429 仍走 RATE_LIMITED。
  if (notification?.errorCode === 'QUOTA_EXCEEDED' || Number(notification?.code) === 402 || (!notification?.errorCode && USAGE_LIMIT_EXCEEDED_PATTERN.test(raw))) return STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED
  if (notification?.errorCode === 'RATE_LIMITED' || Number(notification?.code) === 429 || RATE_LIMITED_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.RATE_LIMITED
  // 文本模式匹配仅作为最后扎线：当 errorCode 已明确为非 QUOTA 时，禁止文本模式覆盖（避免 auth/quota 错误被误分类）
  if (!notification?.errorCode && QUOTA_EXCEEDED_PATTERN.test(raw) && !API_KEY_INVALID_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED
  if (notification?.errorCode === 'EMPTY_RESULT' || EMPTY_RESULT_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.EMPTY_RESULT
  if (CONTENT_POLICY_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.NEEDS_USER_INPUT
  if (OPTIMIZE_SERVICE_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.OPTIMIZE_SERVICE_UNAVAILABLE
  if (UNSUPPORTED_PARAMS_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.PROVIDER_PARAMS_UNSUPPORTED
  if (notification?.errorCode === 'PIPELINE_CONCURRENCY_LIMIT' || PIPELINE_CONCURRENCY_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.PIPELINE_CONCURRENCY_LIMIT
  if (COMPOSE_SEGMENT_DURATION_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_SEGMENT_DURATION_EXCEEDED
  if (COMPOSE_DURATION_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_DURATION_EXCEEDED
  if (COMPOSE_STAGE_PATTERN.test(raw) && TIMEOUT_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_TIMEOUT
  if (MODEL_API_KEY_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED
  if (API_KEY_INVALID_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.API_KEY_INVALID
  if (MODEL_CONFIGURATION_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.MODEL_CONFIGURATION_REQUIRED
  if (TEXT_ONLY_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.TEXT_INPUT_ONLY
  if (TEXT_TOO_LONG_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.TEXT_TOO_LONG
  if (PREVIEW_MISSING_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.PREVIEW_MISSING
  // 克隆音色不可用：必须早于 VOICE_INVALID_PATTERN（后者匹配不到「无访问权」语义），兼容后端前缀与供应商原文。
  if (notification?.errorCode === 'VOICE_CLONE_UNAVAILABLE' || VOICE_CLONE_UNAVAILABLE_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.VOICE_CLONE_UNAVAILABLE
  if (VOICE_INVALID_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.VOICE_INVALID
  if (SCENE_AUDIO_MISSING_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_MISSING
  if (SCENE_IMAGE_MISSING_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.SCENE_IMAGE_MISSING
  if (SCENE_VIDEO_MISSING_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.SCENE_VIDEO_MISSING
  if (SCENE_SLOT_EMPTY_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.SCENE_SLOT_EMPTY
  if (SCENE_SUBTITLE_REGENERATE_FAILED_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.SCENE_SUBTITLE_REGENERATE_FAILED
  if (SCENE_AUDIO_REGENERATE_FAILED_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_REGENERATE_FAILED
  if (SCENE_PROMPT_REGENERATE_FAILED_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATE_FAILED
  if (SCENE_AI_VIDEO_GENERATE_FAILED_PATTERN.test(raw)) return STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED
  // compose 预检失败（2026-10-20）：必须早于 COMPOSE_STAGE / 泛化 compose 规则，
  // 且早于「短自然语言直出」分支，否则存量 run.error 的英文原文会被原样透出。
  if (notification?.errorCode === 'COMPOSE_INPUT_SIZE_EXCEEDED' || COMPOSE_INPUT_SIZE_EXCEEDED_PATTERN.test(raw)) {
    return STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_INPUT_SIZE_EXCEEDED
  }
  if (notification?.errorCode === 'COMPOSE_SCENE_MEDIA_UNREADABLE' || COMPOSE_SCENE_MEDIA_UNREADABLE_PATTERN.test(raw)) {
    return STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_SCENE_MEDIA_UNREADABLE
  }
  if (notification?.errorCode === 'COMPOSE_SCENE_AUDIO_UNREADABLE' || COMPOSE_SCENE_AUDIO_UNREADABLE_PATTERN.test(raw)) {
    return STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_SCENE_AUDIO_UNREADABLE
  }
  return fallbackKey
}

function messageFor (key, params, locale) {
  const template = localeMessageSource(locale, key) ||
    localeMessageSource(locale, STORY2VIDEO_NOTIFICATION_KEYS.UNKNOWN_ERROR)
  return interpolateStory2VideoMessage(template, params, locale)
}

export function formatStory2VideoNotification (notification = {}, locale = getStory2VideoLocale()) {
  const normalizedLocale = normalizeStory2VideoLocale(locale)
  const messageKey = resolveMessageKey(notification, STORY2VIDEO_NOTIFICATION_KEYS.UNKNOWN_ERROR)
  const rawError = String(notification?.error || notification?.message || '')
  const params = normalizeStory2VideoParams(notification?.messageParams || notification?.errorParams, normalizedLocale, messageKey, rawError)
  const message = messageFor(messageKey, params, normalizedLocale)
  return { messageKey, message, codePointCount: countUnicodeCodePoints(message) }
}

/** compose 的 bgmSkippedReason → 本地化原因文案（未知 code 回退 unreadable）。文案在 locales story2video.bgmSkipReasons。 */
export function bgmSkippedReasonText (reason, locale = getStory2VideoLocale()) {
  const normalizedLocale = normalizeStory2VideoLocale(locale)
  const reasons = LOCALE_TREES[normalizedLocale].story2video.bgmSkipReasons
  return reasons[reason] || reasons.unreadable
}

/** 由 compose 的 bgmSkippedReason 生成完整通知（key + 本地化消息）。 */
export function formatBgmSkippedNotification (reason, locale = getStory2VideoLocale()) {
  const normalizedLocale = normalizeStory2VideoLocale(locale)
  const key = STORY2VIDEO_NOTIFICATION_KEYS.BGM_SKIPPED
  const message = messageFor(key, { reason: bgmSkippedReasonText(reason, normalizedLocale) }, normalizedLocale)
  return { messageKey: key, message, codePointCount: countUnicodeCodePoints(message) }
}

const HISTORY_DETAIL_RULES = Object.freeze({
  zh: [
    { pattern: /无法识别当前用户|未登录|登录已过期|login|not signed/i, detailKey: 'login' },
    { pattern: /存储不可用|存储不可写|项目存储|store (unavailable|not)|storage (not )?(writable|ready)|storage failed/i, detailKey: 'storage' },
    { pattern: /超时|timeout|timed out/i, detailKey: 'timeout' },
  ],
  en: [
    { pattern: /cannot identify|not signed|login|sign in|无法识别当前用户|未登录|登录已过期/i, detailKey: 'login' },
    { pattern: /store (unavailable|not)|storage (not )?(writable|ready)|storage failed|存储不可用|存储不可写|项目存储/i, detailKey: 'storage' },
    { pattern: /timeout|timed out|超时/i, detailKey: 'timeout' },
  ],
})

/**
 * 历史记录加载失败时，按具体原因生成可操作建议（供错误弹窗 detail 行展示）。
 * 无法识别的原因返回空串（不展示 detail，避免把内部错误文本直接暴露给用户）。
 * 建议文案在 locales story2video.historyDetail（zh/en 成对）。
 * @param {string|undefined|null} message - 主进程返回的原始错误 message（IPC result.message / reject reason）
 * @param {string} [locale]
 * @returns {string}
 */
export function historyLoadFailureDetail (message, locale = getStory2VideoLocale()) {
  const raw = String(message || '').trim()
  if (!raw) return ''
  const normalizedLocale = normalizeStory2VideoLocale(locale)
  const rules = HISTORY_DETAIL_RULES[normalizedLocale] || HISTORY_DETAIL_RULES.zh
  const matched = rules.find(rule => rule.pattern.test(raw))
  if (!matched) return ''
  return localeMessageSource(normalizedLocale, `story2video.historyDetail.${matched.detailKey}`) || ''
}

export function resolveStory2VideoNotification (notification = {}, options = {}) {
  const normalizedLocale = normalizeStory2VideoLocale(options.locale || getStory2VideoLocale())
  const suppliedFallbackKey = options.fallbackKey || notification?.fallbackKey
  const fallbackKey = isKnownMessageKey(suppliedFallbackKey)
    ? suppliedFallbackKey
    : STORY2VIDEO_NOTIFICATION_KEYS.OPERATION_FAILED
  const key = resolveMessageKey(notification, fallbackKey)
  const rawError = String(notification?.error || notification?.message || '')
  const params = normalizeStory2VideoParams(notification?.messageParams || notification?.errorParams, normalizedLocale, key, rawError)
  return { key, params, message: messageFor(key, params, normalizedLocale) }
}
