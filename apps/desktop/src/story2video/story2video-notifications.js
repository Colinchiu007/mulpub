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
} from './notification-error-patterns'
import { DEFAULT_STORY2VIDEO_TEXT_LIMIT } from './story-text-limit'

/**
 * 内置默认文案上限（Unicode 码点）。
 *
 * 语义收窄（story-text-limit-control）：这里是**内置默认值**，不再是硬上限。
 * 真实生效上限由运营中心运行时下发块 `storyTextLimit.story2video.maxChars` 覆盖，
 * 解析入口见 ./story-text-limit.js（缺省/非法时回落本值）。
 */
export const MAX_STORY2VIDEO_TEXT_CHARACTERS = DEFAULT_STORY2VIDEO_TEXT_LIMIT.maxChars

export const STORY2VIDEO_NOTIFICATION_KEYS = Object.freeze({
  MODEL_CONFIGURATION_REQUIRED: 'story2video.model_configuration_required',
  MODEL_API_KEY_REQUIRED: 'story2video.model_api_key_required',
  // 流水线启动前置校验：模型能力缺失清单（errorCode=PIPELINE_MODEL_REQUIREMENTS_MISSING）
  MODELS_REQUIRED: 'story2video.models_required',
  BGM_SKIPPED: 'story2video.bgm_skipped',
  ACCESS_DENIED: 'story2video.access_denied',
  ORCHESTRATION_FAILED: 'story2video.orchestration_failed',
  TEXT_INPUT_ONLY: 'story2video.text_input_only',
  TEXT_TOO_LONG: 'story2video.text_too_long',
  TEXT_REQUIRED: 'story2video.text_required',
  RUN_STATUS_UNAVAILABLE: 'story2video.run_status_unavailable',
  PREVIEW_MISSING: 'story2video.preview_missing',
  VIDEO_PREVIEW_FAILED: 'story2video.videoPreviewFailed',
  MEDIA_INVALID: 'story2video.media_invalid',
  MEDIA_FORMAT_INVALID: 'story2video.media_format_invalid',
  MEDIA_SIZE_EXCEEDED: 'story2video.media_size_exceeded',
  MEDIA_UNREADABLE: 'story2video.media_unreadable',
  MEDIA_PATH_UNRESOLVED: 'story2video.media_path_unresolved',
  VOICE_INVALID: 'story2video.voice_invalid',
  VOICE_CLONE_UNAVAILABLE: 'story2video.voice_clone_unavailable',
  PROJECT_DELETE_FAILED: 'story2video.project_delete_failed',
  PROJECT_DELETE_CONFIRM: 'story2video.project_delete_confirm',
  RUN_DELETE_FAILED: 'story2video.run_delete_failed',
  RUN_DELETE_CONFIRM: 'story2video.run_delete_confirm',
  TEMPLATE_DELETE_CONFIRM: 'story2video.template_delete_confirm',
  // 历史记录批量删除（2026-08-26）
  BATCH_DELETE_CONFIRM: 'story2video.batch_delete_confirm',
  BATCH_DELETE_SUCCESS: 'story2video.batch_delete_success',
  BATCH_DELETE_PARTIAL: 'story2video.batch_delete_partial',
  BATCH_DELETE_FAILED: 'story2video.batch_delete_failed',
  BGM_LIBRARY_LOAD_FAILED: 'story2video.bgm_library_load_failed',
  BGM_LIBRARY_RENAME_FAILED: 'story2video.bgm_library_rename_failed',
  BGM_LIBRARY_DELETE_FAILED: 'story2video.bgm_library_delete_failed',
  BGM_LIBRARY_DELETE_CONFIRM: 'story2video.bgm_library_delete_confirm',
  HISTORY_LOAD_FAILED: 'story2video.history_load_failed',
  HISTORY_LOCAL_MODE: 'story2video.history_local_mode',
  EXPORT_COMPLETED: 'story2video.export_completed',
  EXPORT_CANCELLED: 'story2video.export_cancelled',
  SAVE_COMPLETED: 'story2video.save_completed',
  PATH_COPIED: 'story2video.path_copied',
  TRIM_COMPLETED: 'story2video.trim_completed',
  SEGMENTS_SAVED: 'story2video.segments_saved',
  SEGMENT_AUDIO_REPLACED: 'story2video.segment_audio_replaced',
  SEGMENT_IMAGE_RETRIED: 'story2video.segment_image_retried',
  SEGMENT_VIDEO_RETRIED: 'story2video.segment_video_retried',
  PROJECT_RECOMPOSED: 'story2video.project_recomposed',
  SCENE_IMAGE_GENERATED: 'story2video.scene_image_generated',
  SCENE_VIDEO_GENERATED: 'story2video.scene_video_generated',
  MATERIAL_SELECTED: 'story2video.material_selected',
  SCENE_AUDIO_MISSING: 'story2video.scene_audio_missing',
  SCENE_IMAGE_MISSING: 'story2video.scene_image_missing',
  SCENE_VIDEO_MISSING: 'story2video.scene_video_missing',
  SCENE_SLOT_EMPTY: 'story2video.scene_slot_empty',
  SCENE_SUBTITLE_REGENERATED: 'story2video.scene_subtitle_regenerated',
  SCENE_SUBTITLE_REGENERATE_FAILED: 'story2video.scene_subtitle_regenerate_failed',
  SCENE_AUDIO_REGENERATED: 'story2video.scene_audio_regenerated',
  SCENE_AUDIO_REGENERATE_FAILED: 'story2video.scene_audio_regenerate_failed',
  SCENE_PROMPT_REGENERATED: 'story2video.scene_prompt_regenerated',
  SCENE_PROMPT_REGENERATE_FAILED: 'story2video.scene_prompt_regenerate_failed',
  SCENE_AI_VIDEO_GENERATED: 'story2video.scene_ai_video_generated',
  SCENE_AI_VIDEO_GENERATE_FAILED: 'story2video.scene_ai_video_generate_failed',
  DEGRADED_ASSETS_WARNING: 'story2video.degraded_assets_warning',
  RATE_LIMITED: 'story2video.rate_limited',
  QUOTA_EXCEEDED: 'story2video.quota_exceeded',
  EMPTY_RESULT: 'story2video.empty_result',
  API_KEY_INVALID: 'story2video.api_key_invalid',
  COMPOSE_TIMEOUT: 'story2video.compose_timeout',
  COMPOSE_DURATION_EXCEEDED: 'story2video.compose_duration_exceeded',
  COMPOSE_SEGMENT_DURATION_EXCEEDED: 'story2video.compose_segment_duration_exceeded',
  NEEDS_USER_INPUT: 'story2video.needs_user_input',
  OPTIMIZE_SERVICE_UNAVAILABLE: 'story2video.optimize_service_unavailable',
  PROVIDER_PARAMS_UNSUPPORTED: 'story2video.provider_params_unsupported',
  ASSET_GENERATION_FAILED: 'story2video.asset_generation_failed',
  OPTIMIZE_FAILED: 'story2video.optimize_failed',
  COMPOSE_FAILED: 'story2video.compose_failed',
  API_ERROR: 'story2video.api_error',
  OPERATION_FAILED: 'story2video.operation_failed',
  UNKNOWN_ERROR: 'story2video.unknown_error',
  PIPELINE_NOT_IMPLEMENTED: 'story2video.pipeline_not_implemented',
  PIPELINE_CONCURRENCY_LIMIT: 'story2video.pipeline_concurrency_limit',
  // 启动参数校验失败（2026-09-04）：normalizeStory2VideoTextParams 抛出的通用 Error 没有 .code 时兜底
  INVALID_PARAMS: 'story2video.invalid_params',
  // 断点恢复失败（pipeline-engine resumeOrchestration errorCode 契约）
  RESUME_SNAPSHOT_NOT_FOUND: 'story2video.resume_snapshot_not_found',
  RESUME_RUN_NOT_FAILED: 'story2video.resume_run_not_failed',
  RESUME_RUN_NOT_ORCHESTRATOR: 'story2video.resume_run_not_orchestrator',
  RESUME_STAGE_NOT_FOUND: 'story2video.resume_stage_not_found',
})

const notificationKeySet = new Set(Object.values(STORY2VIDEO_NOTIFICATION_KEYS))

/**
 * i18n-content-sync（2026-08-13）：用户可见文案单一事实源 = locales/{zh,en}.js。
 * 本模块不再持有任何 zh/en 文案，只保留：稳定 key 常量、错误归一化正则、参数归一化与插值逻辑。
 * 新增文案一律写入 locales（zh/en 成对），见 openspec/specs/i18n-content-sync/spec.md。
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
function extractSceneNumber (rawError) {
  const match = String(rawError || '').match(/(?:scene|场景)\s*(\d+)/i)
  return match ? Number(match[1]) : null
}

function formatSceneContext (scene, locale) {
  if (scene === null || scene === undefined) return ''
  const labelKey = String(scene).includes('/') ? 'sceneRatio' : 'sceneLabel'
  const label = resolveLocaleRef('@story2video.labels.' + labelKey, locale, { scene })
  return locale === 'en' ? ' (' + label + ')' : '（' + label + '）'
}

function fallbackProviderDisplayName (locale) {
  return resolveLocaleRef(defaultProviderName(locale), locale, {})
}

function normalizeParams (value, locale, messageKey, rawError) {
  const supplied = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const params = {}

  // 双次归一化幂等（2026-10 回归修复）：ResultView/CreateView 弹窗先 resolve 入态、渲染时再 format。
  // normalizeParams 只消费原始枚举（assetKinds/missing）产出解析标签；第二次进入时原始枚举已不存在，
  // 必须把已解析的插值参数原样保留，否则 {kinds}/{missingLabels} 被清空，渲染出「（）」空括号。
  if (
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING &&
    !Array.isArray(supplied.assetKinds) &&
    typeof supplied.kinds === 'string' && supplied.kinds.trim() !== ''
  ) {
    params.kinds = supplied.kinds
  }
  if (
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.MODELS_REQUIRED &&
    !Array.isArray(supplied.missing) &&
    typeof supplied.missingLabels === 'string' && supplied.missingLabels.trim() !== ''
  ) {
    params.missingLabels = supplied.missingLabels
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.TEXT_TOO_LONG && Number.isFinite(Number(supplied.max))) {
    params.max = Number(supplied.max)
    params.maxFormatted = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN').format(params.max)
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_FORMAT_INVALID) {
    params.extension = String(supplied.extension || '').trim() || '@story2video.labels.thisFile'
    params.kindLabel = String(supplied.kindLabel || '').trim() || ''
    params.extensions = Array.isArray(supplied.extensions) ? supplied.extensions.join(' / ') : String(supplied.extensions || '')
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_SIZE_EXCEEDED) {
    params.kindLabel = String(supplied.kindLabel || '').trim() || ''
    if (Number.isFinite(Number(supplied.maxMb))) params.maxMb = Math.round(Number(supplied.maxMb))
    if (Number.isFinite(Number(supplied.actualMb))) params.actualMb = Math.max(1, Math.round(Number(supplied.actualMb)))
  }

  if (
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_UNREADABLE ||
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_PATH_UNRESOLVED
  ) {
    params.kindLabel = String(supplied.kindLabel || '').trim() || ''
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.PROVIDER_PARAMS_UNSUPPORTED) {
    const paramMatch = rawError.match(/Setting\s*['"]([^'"]+)['"]/i) || rawError.match(/参数\s*['"]([^'"]+)['"]/i)
    params.provider = resolveProviderDisplayName(rawError, supplied) || fallbackProviderDisplayName(locale)
    params.param = paramMatch ? paramMatch[1] : String(supplied.param || '')
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.MODEL_API_KEY_REQUIRED || messageKey === STORY2VIDEO_NOTIFICATION_KEYS.API_KEY_INVALID) {
    params.provider = resolveProviderDisplayName(rawError, supplied) ||
      fallbackProviderDisplayName(locale)
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.ASSET_GENERATION_FAILED) {
    const ratioMatch = rawError.match(/(\d+)\/(\d+)\s*scenes?\s+have\s+both/i)
    const scenes = ratioMatch ? ratioMatch[1] + '/' + ratioMatch[2] : ''
    params.provider = resolveProviderDisplayName(rawError, supplied) || fallbackProviderDisplayName(locale)
    const detailRef = String(supplied.detail || '').trim()
    const detail = detailRef ? resolveLocaleRef(detailRef, locale, supplied) : ''
    const contextParts = []
    if (scenes) contextParts.push(resolveLocaleRef('@story2video.labels.sceneRatio', locale, { scene: scenes }))
    if (detail) contextParts.push(detail)
    params.context = contextParts.length > 0
      ? (locale === 'en' ? ' (' + contextParts.join(', ') + ')' : '（' + contextParts.join('，') + '）')
      : ''
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.VOICE_INVALID) {
    params.provider = resolveProviderDisplayName(rawError, supplied) || fallbackProviderDisplayName(locale)
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.SCENE_PROMPT_REGENERATE_FAILED) {
    params.provider = resolveProviderDisplayName(rawError, supplied) || fallbackProviderDisplayName(locale)
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.DEGRADED_ASSETS_WARNING && Array.isArray(supplied.assetKinds)) {
    const labels = LOCALE_TREES[locale].story2video.degradedAssetLabels
    const separator = locale === 'en' ? ', ' : '、'
    const kindLabels = supplied.assetKinds
      .map(kind => labels[kind] || '')
      .filter(Boolean)
      .join(separator)
    // 空值兜底（2026-10）：assetKinds 缺失或全部未登记时不得产出空括号「（）」，
    // 回退到通用降级素材文案（labels.fallback，zh/en 成对维护）。
    params.kinds = kindLabels !== '' ? kindLabels : (labels.fallback || '')
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.PIPELINE_CONCURRENCY_LIMIT) {
    if (Number.isFinite(Number(supplied.count))) params.count = Number(supplied.count)
    if (Number.isFinite(Number(supplied.max))) params.max = Number(supplied.max)
  }

  // 启动前置校验：缺失能力 → 本地化标签列表（附显式 provider 标识），供 models_required 模板插值
  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.MODELS_REQUIRED && Array.isArray(supplied.missing)) {
    const labelTree = LOCALE_TREES[locale].story2video.modelCapabilityLabels || {}
    const providers = supplied.providers && typeof supplied.providers === 'object' ? supplied.providers : {}
    const separator = locale === 'en' ? ', ' : '、'
    params.missingLabels = supplied.missing
      .filter((capability) => typeof capability === 'string' && capability)
      .map((capability) => {
        let label = labelTree[capability] || capability
        if (providers[capability]) {
          label += locale === 'en' ? ' (' + providers[capability] + ')' : '（' + providers[capability] + '）'
        }
        return label
      })
      .join(separator)
  }

  // 历史记录批量删除（2026-08-26）：{count}/{success}/{failed} 插值
  if (
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_CONFIRM ||
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_SUCCESS ||
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.BATCH_DELETE_PARTIAL
  ) {
    if (Number.isFinite(Number(supplied.count))) params.count = Number(supplied.count)
    if (Number.isFinite(Number(supplied.success))) params.success = Number(supplied.success)
    if (Number.isFinite(Number(supplied.failed))) params.failed = Number(supplied.failed)
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_DURATION_EXCEEDED) {
    const limitMatch = String(rawError || '').match(/(\d+(?:\.\d+)?)\s*(?:分钟|minutes?)/i)
    const suppliedLimit = Number(supplied.limitMinutes)
    const parsedLimit = limitMatch ? Number(limitMatch[1]) : suppliedLimit
    params.limitMinutes = Number.isFinite(parsedLimit) && parsedLimit > 0 && parsedLimit <= 24 * 60
      ? parsedLimit
      : 50
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.RATE_LIMITED || messageKey === STORY2VIDEO_NOTIFICATION_KEYS.QUOTA_EXCEEDED || messageKey === STORY2VIDEO_NOTIFICATION_KEYS.NEEDS_USER_INPUT || messageKey === STORY2VIDEO_NOTIFICATION_KEYS.EMPTY_RESULT) {
    const scene = extractSceneNumber(rawError)
    const providerName = resolveProviderDisplayName(rawError, supplied) || ''
    params.context = formatSceneContext(scene, locale) || (typeof supplied.context === 'string' ? supplied.context : '')
    params.provider = providerName || fallbackProviderDisplayName(locale)
  }

  if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AUDIO_REGENERATE_FAILED || messageKey === STORY2VIDEO_NOTIFICATION_KEYS.SCENE_AI_VIDEO_GENERATE_FAILED || messageKey === STORY2VIDEO_NOTIFICATION_KEYS.API_ERROR) {
    params.provider = resolveProviderDisplayName(rawError, supplied) || fallbackProviderDisplayName(locale)
  }

  return params
}
function resolveLocaleRef (ref, locale, params) {
  if (typeof ref !== 'string' || !ref.startsWith('@')) return ref
  const keyPath = ref.slice(1).split('.')
  let node = LOCALE_TREES[normalizeStory2VideoLocale(locale)] || LOCALE_TREES.zh
  for (const seg of keyPath) {
    node = node?.[seg]
    if (node == null) return ref
  }
  const resolved = typeof node === 'string' ? node : ref
  if (params && resolved.includes('{')) {
    return resolved.replace(/\{([^{}]+)\}/g, (_, k) => String(params[k] ?? ''))
  }
  return resolved
}

function interpolateMessage (template, params, locale) {
  return template.replace(/\{([^{}]+)\}/g, (_placeholder, name) => {
    const raw = params[name]
    const resolved = locale ? resolveLocaleRef(raw, locale, params) : raw
    return String(resolved ?? '')
  })
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
  return fallbackKey
}

function messageFor (key, params, locale) {
  const template = localeMessageSource(locale, key) ||
    localeMessageSource(locale, STORY2VIDEO_NOTIFICATION_KEYS.UNKNOWN_ERROR)
  return interpolateMessage(template, params, locale)
}

export function formatStory2VideoNotification (notification = {}, locale = getStory2VideoLocale()) {
  const normalizedLocale = normalizeStory2VideoLocale(locale)
  const messageKey = resolveMessageKey(notification, STORY2VIDEO_NOTIFICATION_KEYS.UNKNOWN_ERROR)
  const rawError = String(notification?.error || notification?.message || '')
  const params = normalizeParams(notification?.messageParams || notification?.errorParams, normalizedLocale, messageKey, rawError)
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
  const params = normalizeParams(notification?.messageParams || notification?.errorParams, normalizedLocale, key, rawError)
  return { key, params, message: messageFor(key, params, normalizedLocale) }
}
