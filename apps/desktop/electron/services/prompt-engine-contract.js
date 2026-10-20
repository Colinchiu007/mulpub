// @ts-check
/**
 * prompt-engine-contract — 图片提示词契约（与外部 prompt-engine 服务 8013 的契约单一来源）。
 *
 * 结构（openspec change prompt-engine-kernel-refactor）：
 *   - 领域中立逻辑（风格归一、敏感凭据守卫、中立 limits、fail-closed 核心 extractOptimizedBase）
 *     集中在 prompt-engine-kernel.js，本文件 re-export，公共 API 与行为零变化。
 *   - 图片专属：平台枚举/别名/归一、请求构造（/v1/optimize）、
 *     extractOptimizedPrompt（kernel base + detected_categories/candidates meta）。
 *   - 视频契约（video-prompt-engine-contract.js）改从 kernel 引入，不经过本文件。
 *
 * 被 PromptBridge、story2video-stages、story2video-text-config、stage-executor 共用，
 * 避免「图片提示词统一走 prompt-engine」在多处漂移。
 */
'use strict'

const {
  PROMPT_ENGINE_STYLES,
  PROMPT_ENGINE_STYLE_ALIASES,
  DEFAULT_PROMPT_ENGINE_STYLE,
  PROMPT_ENGINE_LIMITS,
  SENSITIVE_CONTEXT_KEYS,
  assertNoSensitiveContext,
  normalizePromptEngineStyle,
  clampNumber,
  extractOptimizedBase,
  resolveTieredMaxLength,
  normalizeOptimizationStrategy,
  filterPlausibleNegativePrompt,
  normalizePositiveConstraints,
  scorePrompt,
} = require('./prompt-engine-kernel')

const PROMPT_ENGINE_PLATFORMS = Object.freeze(new Set([
  'midjourney', 'stable_diffusion', 'dalle', 'tongyi', 'yizhang', 'jimeng', 'generic',
]))

const PROMPT_ENGINE_PLATFORM_ALIASES = Object.freeze({
  'dall-e': 'dalle',
  'dall-e-2': 'dalle',
  'dall-e-3': 'dalle',
  'stable-diffusion': 'stable_diffusion',
  'stable-diffusion-xl': 'stable_diffusion',
  sdxl: 'stable_diffusion',
  stability: 'stable_diffusion',
  '通义万相': 'tongyi',
  '文心一格': 'yizhang',
  '即梦': 'jimeng',
})

const DEFAULT_PROMPT_ENGINE_PLATFORM = 'generic'

/**
 * context 白名单键（对齐外部 prompt_engine/optimizer.py _warn_unknown_context_keys 已知 7 键；
 * 未知键忽略并记录 warning，不改变优化行为；敏感凭据键由 assertNoSensitiveContext 前置拦截。
 */
const PROMPT_ENGINE_CONTEXT_KEYS = Object.freeze(new Set([
  'synopsis', 'character', 'setting', 'character_list',
  'narrative_intent', 'scene_type', 'full_text',
]))

/**
 * 技术底座基线片段（影视项目案例语料实证：12 行技术底座标记出现率 90%+，
 * 写实/摄影/灯光/色彩比例/皮肤细节/物理/禁文字段）。
 * ≤200 字符；默认拼入 prompt 后置（受 promptMax 截断保护），可显式关闭（options.quality_baseline=false）。
 */
const IMAGE_QUALITY_BASELINE = 'Photoreal, cinematic lighting, natural light, color ratio 60:30:10, detailed skin texture, physical accuracy, no text, no watermark, no logo'

/**
 * 归一化 prompt-engine 平台值；未知值回退默认（generic）。图片领域专属。
 * @param {unknown} value
 * @returns {string}
 */
function normalizePromptEnginePlatform(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (PROMPT_ENGINE_PLATFORMS.has(raw)) return raw
  if (Object.prototype.hasOwnProperty.call(PROMPT_ENGINE_PLATFORM_ALIASES, raw)) {
    return PROMPT_ENGINE_PLATFORM_ALIASES[raw]
  }
  return DEFAULT_PROMPT_ENGINE_PLATFORM
}

function normalizeCreativeLevel(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return PROMPT_ENGINE_LIMITS.creativeLevel.default
  return clampNumber(raw, PROMPT_ENGINE_LIMITS.creativeLevel.min, PROMPT_ENGINE_LIMITS.creativeLevel.max)
}

function normalizeMaxLength(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return PROMPT_ENGINE_LIMITS.maxLength.default
  return clampNumber(raw, PROMPT_ENGINE_LIMITS.maxLength.min, PROMPT_ENGINE_LIMITS.maxLength.max)
}

function normalizeNumCandidates(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return PROMPT_ENGINE_LIMITS.numCandidates.default
  return clampNumber(raw, PROMPT_ENGINE_LIMITS.numCandidates.min, PROMPT_ENGINE_LIMITS.numCandidates.max)
}

/**
 * 构造 /v1/optimize 请求体（字段与边界对齐 prompt_engine/models.py:126-141）。
 *
 * 规则：
 *   - style 显式指定（非空）→ 发送归一化 style；未指定且 autoDetectStyle=true → 省略 style，由服务端检测
 *   - creative_level / max_length / num_candidates 收敛到契约边界
 *   - negative_prompt 截断到 500；context 为对象时透传（敏感键由上层校验）
 * @param {string} prompt
 * @param {object} [options]
 * @returns {object}
 */
function buildPromptEngineOptimizeRequest(prompt, options = {}) {
  const styleRaw = typeof options.style === 'string' ? options.style.trim() : ''
  const autoDetectStyle = options.auto_detect_style !== undefined
    ? Boolean(options.auto_detect_style)
    : (options.autoDetectStyle !== undefined ? Boolean(options.autoDetectStyle) : true)

  const creativeLevel = normalizeCreativeLevel(options.creative_level ?? options.creativeLevel)
  const hasOptimizationStrategy = options.optimization_strategy !== undefined ||
    options.optimizationStrategy !== undefined
  const optimizationStrategy = hasOptimizationStrategy
    ? normalizeOptimizationStrategy(options.optimization_strategy ?? options.optimizationStrategy)
    : 'llm'
  const hasBypassCache = options.bypass_cache !== undefined || options.bypassCache !== undefined

  // 技术底座基线：默认拼入 prompt 后置（Higgsfield 实证），可显式关闭实现零回归
  let promptText = String(prompt || '')
  if (options.quality_baseline !== false) {
    promptText = promptText.trim() ? promptText.trim() + ' ' + IMAGE_QUALITY_BASELINE : IMAGE_QUALITY_BASELINE
  }

  const request = {
    prompt: promptText.slice(0, PROMPT_ENGINE_LIMITS.promptMax),
    platform: normalizePromptEnginePlatform(options.platform),
    creative_level: creativeLevel,
    // 精修层长度层级：显式传值收敛 [50,2000]；未显式且 creativeLevel≥7 → 精修层默认（对齐 8013 能力上限）
    max_length: resolveTieredMaxLength(
      options.max_length !== undefined ? options.max_length : options.maxLength,
      creativeLevel,
      PROMPT_ENGINE_LIMITS.maxLength,
      PROMPT_ENGINE_LIMITS.maxLength.default,
      PROMPT_ENGINE_LIMITS.maxLength.max,
    ),
    num_candidates: normalizeNumCandidates(options.num_candidates ?? options.numCandidates),
    auto_detect_style: autoDetectStyle,
  }

  request.optimization_strategy = optimizationStrategy
  if (hasBypassCache) request.bypass_cache = Boolean(options.bypass_cache ?? options.bypassCache)

  if (styleRaw) {
    request.style = normalizePromptEngineStyle(styleRaw)
  } else if (!autoDetectStyle) {
    request.style = DEFAULT_PROMPT_ENGINE_STYLE
  }

  // plausible-only 负面词过滤：只保留真实失败类别，清理裸绝对否定词
  // （图片侧保持现状：无内置 no-text 合并；外部 8013 图片策略自带 no-text 指令）
  const negativePrompt = filterPlausibleNegativePrompt(
    typeof options.negative_prompt === 'string' ? options.negative_prompt : '',
  )
  if (negativePrompt) request.negative_prompt = negativePrompt.slice(0, PROMPT_ENGINE_LIMITS.negativePromptMax)

  const context = options.context
  if (context !== undefined && context !== null && context !== '') {
    // context 会发给外部服务：对象型上下文必须先过敏感凭据键拦截（防 api_key/token 外发）
    if (typeof context === 'object') {
      assertNoSensitiveContext(context, 'optimize.context')
      // 白名单过滤：只透传 7 个已知键（synopsis/character/setting/character_list/
      // narrative_intent/scene_type/full_text，对齐外部 _warn_unknown_context_keys），未知键忽略 + warning
      const warn = typeof options.warn === 'function' ? options.warn : () => {}
      const allowedContext = {}
      for (const key of Object.keys(context)) {
        if (PROMPT_ENGINE_CONTEXT_KEYS.has(key)) allowedContext[key] = context[key]
        else warn('optimize.context 忽略未知键: ' + key)
      }
      if (Object.keys(allowedContext).length > 0) request.context = allowedContext
    } else {
      request.context = { synopsis: String(context) }
    }
  }

  return request
}

/**
 * 从 PromptBridge 响应提取图片优化结果并做 fail-closed 校验。
 * 基于共享内核 extractOptimizedBase（error → detail → 空串 → 截断），
 * 成功时额外合并图片领域 meta（detected_categories/candidates）。
 *
 * @param {unknown} result - PromptBridge._post 的解析结果
 * @param {{ index?: number, maxLength?: number, warn?: (msg: string) => void }} [opts]
 * @returns {{ ok: true, prompt: string, meta: object, truncated: boolean } | { ok: false, error: string }}
 */
function extractOptimizedPrompt(result, opts = {}) {
  const base = extractOptimizedBase(result, opts)
  if (!base.ok) return base
  const meta = { ...base.meta }
  if (result.detected_categories && typeof result.detected_categories === 'object') {
    meta.detected_categories = result.detected_categories
  }
  if (Array.isArray(result.candidates)) meta.candidates = result.candidates
  // 正向约束 meta 透传（本图"必须如此"硬约束）：数组透传/字符串拆分/上限 10/非字符串丢弃；缺省零拒绝
  if (result.positive_constraints !== undefined && result.positive_constraints !== null) {
    const constraints = normalizePositiveConstraints(result.positive_constraints)
    if (constraints.length > 0) meta.positive_constraints = constraints
  }
  return { ok: true, prompt: base.prompt, meta, truncated: base.truncated }
}

/**
 * 多候选规则评估择优：scorePrompt 四维评分（长度/六要素/保真/构图），
 * tie-break 保留最长候选（对齐既有「最长即最优」兜底，评分含长度分量）。
 * 未启用择优的既有路径（candidates 长度 ≤1 或非数组）返回 null，行为零回归。
 *
 * @param {unknown} candidates - 外部引擎多候选数组（num_candidates>1 时返回）
 * @param {string} [sourcePrompt] - 原始输入，用于保真维度评分
 * @returns {{ prompt: string, score: number } | null}
 */
function selectBestCandidate(candidates, sourcePrompt) {
  if (!Array.isArray(candidates)) return null
  const valid = candidates.filter(candidate => typeof candidate === 'string' && candidate.trim())
  if (valid.length === 0) return null
  let best = valid[0]
  let bestScore = scorePrompt(best, { sourcePrompt })
  for (const candidate of valid.slice(1)) {
    const score = scorePrompt(candidate, { sourcePrompt })
    if (score > bestScore || (score === bestScore && candidate.length > best.length)) {
      best = candidate
      bestScore = score
    }
  }
  return { prompt: best, score: bestScore }
}

module.exports = {
  // 共享内核 re-export（公共 API 保持既有 13 项 + 新增 clampNumber/extractOptimizedBase）
  ...require('./prompt-engine-kernel'),
  // 图片领域专属
  PROMPT_ENGINE_PLATFORMS,
  PROMPT_ENGINE_PLATFORM_ALIASES,
  DEFAULT_PROMPT_ENGINE_PLATFORM,
  normalizePromptEnginePlatform,
  buildPromptEngineOptimizeRequest,
  extractOptimizedPrompt,
  PROMPT_ENGINE_CONTEXT_KEYS,
  IMAGE_QUALITY_BASELINE,
  selectBestCandidate,
}
