/**
 * story2video-notification-params.js — 通知文案的「参数归一化 + locale 引用解析」单一真源。
 *
 * 从 story2video-notifications.js 拆出（2026-10-20，change: error-message-user-friendly-audit，
 * 逐文件行数门禁：主模块 543 行 >= 500 基线）。拆分原则：
 *   - 本模块只持有**参数归一化**与 **@locale ref 解析/插值**（纯函数，不依赖 Vue/i18n 实例）；
 *   - 常量名、正则字面量、注释逐字保留，主模块经本模块导入，行为零变化
 *     （notifications.test.js + story2video-notifications.test.js 全量回归锁定）。
 *
 * 为什么拆这一块而不是拆正则：正则已在 2026-10-02 拆到 notification-error-patterns.js；
 * 剩下的两个内聚块是「key/常量/消息渲染编排」（留在主模块）与「参数归一化 + 插值引擎」（本模块）。
 * 后者被 formatStory2VideoNotification / resolveStory2VideoNotification 两条导出路径共用，
 * 且本次新增的 compose 预检参数分支（error-message-user-friendly-audit）主要落在这里。
 */
import zhLocale from '@/locales/zh'
import enLocale from '@/locales/en'
import { resolveProviderDisplayName, defaultProviderName } from '@/utils/provider-name-map'
import { STORY2VIDEO_NOTIFICATION_KEYS } from './story2video-notifications-keys'

const LOCALE_TREES = Object.freeze({ zh: zhLocale, en: enLocale })

/** 规范化 locale（与主模块同口径：仅 zh/en，其余回落 zh） */
function normalizeStory2VideoLocale (locale) {
  if (locale === 'en' || locale === 'zh') return locale
  return 'zh'
}

function extractSceneNumber (rawError) {
  const match = String(rawError || '').match(/(?:scene|场景)\s*(\d+)/i)
  return match ? Number(match[1]) : null
}

/**
 * 解析 `@story2video.labels.xxx` 形态的 locale 引用为当前语言字符串。
 * 非 @ 前缀原样返回；解析不到时**返回 ref 本身**（调用方据此识别未解析，测试锁定该行为）。
 */
export function resolveLocaleRef (ref, locale, params) {
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

/** 供主模块渲染消息用（保持既有插值语义：locale 感知 + @ref 解析） */
export function interpolateStory2VideoMessage (template, params, locale) {
  return interpolateMessage(template, params, locale)
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

/** compose 预检失败的场景号兜底：主进程未给出场景号时不渲染空占位符 */
function fallbackSceneLabel (locale) {
  return resolveLocaleRef('@story2video.labels.currentScene', locale, {})
}

/** compose 预检失败的体积兜底：主进程未给出体积时不渲染空占位符 */
function fallbackSizeLabel (locale) {
  return resolveLocaleRef('@story2video.labels.unknownSize', locale, {})
}

/**
 * 把调用方 supplied 的原始参数归一化为 locale 模板可插值的 params。
 *
 * 消费方：formatStory2VideoNotification / resolveStory2VideoNotification（主模块）。
 * 双次归一化幂等（2026-10 回归修复）：ResultView/CreateView 弹窗先 resolve 入态、渲染时再 format。
 * normalizeParams 只消费原始枚举（assetKinds/missing）产出解析标签；第二次进入时原始枚举已不存在，
 * 必须把已解析的插值参数原样保留，否则 {kinds}/{missingLabels} 被清空，渲染出「（）」空括号。
 *
 * @param {object} value - 原始参数（notification.messageParams / errorParams）
 * @param {'zh'|'en'} locale
 * @param {string} messageKey - 已解析的稳定 messageKey
 * @param {string} rawError - 原始错误文本（部分分支从原文二次推导参数）
 * @returns {object} params
 */
export function normalizeStory2VideoParams (value, locale, messageKey, rawError) {
  const supplied = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const params = {}

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

  // compose 预检失败（2026-10-20 error-message-user-friendly-audit）：
  // 主进程 messageParams 已是带单位的体积串（如 '512MB'）与 1-based 场景号，
  // 这里只做「缺失即兜底」处理——不得把空串渲染成空占位符。
  if (
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_INPUT_SIZE_EXCEEDED ||
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_SCENE_MEDIA_UNREADABLE ||
    messageKey === STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_SCENE_AUDIO_UNREADABLE
  ) {
    if (Number.isFinite(Number(supplied.scene)) && Number(supplied.scene) > 0) {
      params.scene = String(Math.floor(Number(supplied.scene)))
    } else {
      params.scene = fallbackSceneLabel(locale)
    }
    if (messageKey === STORY2VIDEO_NOTIFICATION_KEYS.COMPOSE_INPUT_SIZE_EXCEEDED) {
      params.limitMb = String(supplied.limitMb || '').trim() || fallbackSizeLabel(locale)
      params.actualMb = String(supplied.actualMb || '').trim() || fallbackSizeLabel(locale)
    }
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
