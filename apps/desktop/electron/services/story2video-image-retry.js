// @ts-check
'use strict'

const {
  ERROR_CODES,
  classifyContentPolicyType,
  hasStrictContentPolicySignal,
} = require('./adapters/_base/provider-error')

const MAX_IMAGE_GENERATION_ATTEMPTS = 5

// 优化点 5：LLM 改写成本预算（2026-08-30）。
// 每场景 LLM 改写调用上限，避免无谓消耗 LLM 额度。
const LLM_REWRITE_MAX_CALLS_PER_SCENE = 2
// 优化点 5：LLM 改写结果缓存（模块级，仅单次运行内有效）。
// key = 原始 prompt 的 SHA-256 哈希，value = { prompt, retention }。
// 同原始提示词哈希再次触发时直接复用，不重复调用 LLM。
//
// 2026-10-18 有界化：key 空间无界（用户每写一个新 prompt 就是新 key），而 Electron 主进程
// **常驻**（不随单次生成任务结束重启）⇒ 原实现单调增长。R11 审计面（openspec/records/
// risk-closeout.md §4.2）把这一项列为「真实无淘汰缓存」并登记待评估，本条即为处置。
// 做法是**插入序上限**：Map 天然保序，超出上限时删最早插入的那条。语义不变 ——
// 缓存收益（同 key 命中直接复用）完整保留，只是不再无限占用主进程内存。
// 上限取值：一次生成任务的 prompt 数远小于 500，正常使用永远不会触发淘汰；
// 只有"同一进程内长期生成大量不同 prompt"才会淘汰最早那批，而那批的复用价值也早已趋零。
const LLM_REWRITE_CACHE_MAX_ENTRIES = 500

/** 通用插入序上限写入：超出上限时删最早插入的一条（Map 保序，最早 = 迭代第一条）。 */
function setWithInsertionBound (map, key, value, maxEntries) {
  if (!map.has(key) && map.size >= maxEntries) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

const llmRewriteCache = new Map()
// 优化点 5：每场景 LLM 改写调用计数（key = 原始 prompt 哈希）。
// 与结果缓存同一上限常量 —— 两处不同步等于没锁（见同目录 story2video-llm-cache-bound.test.js）。
const llmRewriteCallCount = new Map()

const NON_CONTENT_POLICY_ERROR_CODES = new Set([
  ERROR_CODES.AUTH_FAILED,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.NETWORK_ERROR,
  ERROR_CODES.INVALID_CONFIG,
  ERROR_CODES.NOT_IMPLEMENTED,
])

function normalizeSceneIndex (value) {
  const index = Number(value)
  return Number.isInteger(index) && index >= 0 ? index : 0
}

function normalizeAttemptLimit (value) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric)) return MAX_IMAGE_GENERATION_ATTEMPTS
  return Math.min(MAX_IMAGE_GENERATION_ATTEMPTS, Math.max(1, numeric))
}

function getErrorStatusCode (error) {
  const candidates = [
    error?.statusCode,
    error?.status,
    error?.context?.statusCode,
    error?.context?.status,
    error?.response?.status,
    error?.response?.statusCode,
  ]
  for (const candidate of candidates) {
    const numeric = Number(candidate)
    if (Number.isInteger(numeric)) return numeric
  }
  return null
}

function getErrorCategory (error) {
  if (typeof error?.category === 'string' && error.category.trim()) return error.category.trim()
  if (typeof error?.code === 'string' && error.code.trim()) return error.code.trim().toLowerCase()
  return 'provider'
}

function getErrorSignals (error) {
  return [
    error?.code,
    error?.type,
    error?.errorCode,
    error?.error_code,
    error?.providerCode,
    error?.provider_code,
    error?.context?.code,
    error?.context?.type,
    error?.context?.errorCode,
    error?.context?.error_code,
    error?.context?.providerCode,
    error?.context?.provider_code,
    error?.data?.code,
    error?.data?.type,
    error?.data?.error?.code,
    error?.data?.error?.type,
    error?.response?.data?.code,
    error?.response?.data?.type,
    error?.response?.data?.error?.code,
    error?.response?.data?.error?.type,
    error?.message,
  ]
}

/**
 * 仅把明确的结构化内容政策信号视为可安全重写的拒绝。
 * 认证、限流、网络和配置错误即使错误文案提到安全也绝不重试。
 */
function isContentPolicyRejection (error) {
  if (!error || typeof error !== 'object') return false

  const statusCode = getErrorStatusCode(error)
  if (statusCode === 0 || statusCode === 401 || statusCode === 403 || statusCode === 429) return false

  if (NON_CONTENT_POLICY_ERROR_CODES.has(error.code)) return false
  if (error.code === ERROR_CODES.CONTENT_POLICY) return true

  return getErrorSignals(error).some(hasStrictContentPolicySignal)
}

/**
 * 差异化改写策略（方案层 2，2026-08-30）。
 * 按敏感类型选择改写指令，注入 scene_context 锚点保留原文背景，避免背景漂移。
 * @type {Object<string, string>}
 */
const CONTENT_POLICY_REWRITE_STRATEGIES = Object.freeze({
  violence: 'Depict the scene as a tense conflict atmosphere with no blood, wounds, weapons, or graphic detail.',
  sexual: 'Depict the scene in a modest, non-explicit, age-appropriate way with no nudity or sexual content.',
  portrait: 'Depict only a fictional, non-identifying character; do not reproduce any real person likeness.',
  political: 'Depict the scene without any political figures, symbols, or references.',
  minor: 'Depict only adult characters; do not depict any minors or child-like figures.',
  selfharm: 'Depict a calm, hopeful scene with no self-harm, injury, or distress.',
  unknown: 'Replace sensitive people, actions, and details with symbolic, non-identifying alternatives.',
})

/**
 * 优化点 5：按图片模型（provider）定制的改写指令（2026-08-30）。
 * 不同供应商对改写指令的解析能力不同：MiniMax 等偏简洁，SD 系偏详细。
 * 未列出的 provider 回退到通用 CONTENT_POLICY_REWRITE_STRATEGIES。
 * @type {Object<string, Object<string, string>>}
 */
const CONTENT_POLICY_REWRITE_STRATEGIES_BY_PROVIDER = Object.freeze({
  minimax: Object.freeze({
    violence: 'tense conflict atmosphere, no blood, no weapons, no graphic detail',
    sexual: 'modest non-explicit age-appropriate, no nudity',
    portrait: 'fictional non-identifying character only',
    political: 'no political figures or symbols',
    minor: 'adult characters only',
    selfharm: 'calm hopeful scene, no self-harm or distress',
    unknown: 'symbolic non-identifying alternatives',
  }),
  'stable-diffusion': Object.freeze({
    violence: 'A tense standoff between two figures, dramatic lighting, no blood, no visible wounds, no weapons, cinematic composition',
    sexual: 'Elegant modest attire, soft lighting, tasteful and age-appropriate, no nudity, no suggestive poses',
    portrait: 'A fictional character with no resemblance to any real person, generic features, studio portrait',
    political: 'A crowd in a neutral public square, no flags, no political symbols, no identifiable leaders',
    minor: 'Adult characters only, mature figures, no child-like features',
    selfharm: 'A serene hopeful scene, warm light, calm posture, no injury, no distress',
    unknown: 'Symbolic and abstract representation, non-identifying figures',
  }),
})

/**
 * 优化点 5：中文改写指令（2026-08-30）。当 language='zh' 时使用，避免中英混杂。
 * @type {Object<string, string>}
 */
const CONTENT_POLICY_REWRITE_STRATEGIES_ZH = Object.freeze({
  violence: '将场景表现为紧张对峙的氛围，无血腥、无伤口、无武器、无暴力细节。',
  sexual: '以含蓄、非露骨、适龄的方式表现场景，无裸露、无色情内容。',
  portrait: '只表现虚构、非特定身份的角色，不还原任何真实人物形象。',
  political: '场景中不出现任何政治人物、政治符号或政治指涉。',
  minor: '只表现成年角色，不出现未成年人或儿童形象。',
  selfharm: '表现平静、充满希望的场景，无自伤、无受伤、无痛苦。',
  unknown: '用象征性、非特定身份的替代物替换敏感人物、动作与细节。',
})

/**
 * 敏感类型分级（方案层 1 增强，2026-08-30）。
 * 标注各敏感类型的严重度，供改写指令强度参考（severe 需更强改写）。
 * 注意：severe 不用于「直接交用户」决策——所有敏感类型都走自动改写（模板→LLM 升级），
 * 仅当自动改写全部失败才交用户（2026-08-30 用户决策：程序/LLM 自动解决）。
 * @type {Object<string, 'mild'|'severe'>}
 */
const CONTENT_POLICY_SEVERITY = Object.freeze({
  violence: 'mild',
  sexual: 'mild',
  portrait: 'mild',
  political: 'severe',
  minor: 'severe',
  selfharm: 'severe',
  unknown: 'mild',
})

/**
 * 优化点 4：按敏感类型生成 negative_prompt（2026-08-30）。
 * 正向保留原文语义、负向排除敏感内容，兼顾保留度与安全性。
 * @param {string} sensitiveType 敏感类型
 * @returns {string} negative_prompt 指令
 */
function buildNegativePrompt (sensitiveType) {
  const type = String(sensitiveType || 'unknown').toLowerCase()
  const map = {
    violence: 'no blood, no weapons, no wounds, no graphic violence, no gore',
    sexual: 'no nudity, no sexual content, no explicit poses, no suggestive clothing',
    portrait: 'no real person likeness, no identifiable celebrity, no public figure',
    political: 'no political figures, no political symbols, no flags, no campaign imagery',
    minor: 'no minors, no children, no child-like figures, no underage characters',
    selfharm: 'no self-harm, no injury, no blood, no distress, no suicide imagery',
    unknown: 'no sensitive content, no explicit material, no identifiable individuals',
  }
  return map[type] || map.unknown
}

/**
 * 优化点 7：检测原文语言（2026-08-30）。
 * 中文占比超过阈值判定为 zh，否则 en。用于选择改写指令语言。
 * @param {string} prompt 原始提示词
 * @returns {'zh'|'en'}
 */
function detectPromptLanguage (prompt) {
  const text = String(prompt || '')
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const total = text.replace(/\s/g, '').length
  if (total === 0) return 'en'
  return cjkCount / total > 0.4 ? 'zh' : 'en'
}

/**
 * 生成发送给供应商的按场景安全化改写；调用方不得把返回的 prompt 写入审计数据。
 * 支持按敏感类型差异化改写，并注入 scene_context 锚点（contextBlock/anchors）保留原文背景。
 * 优化点 5：支持按 provider 定制改写指令 + 中文改写指令（language='zh'）。
 * 优化点 6：支持保留角色一致性（character）与视觉风格（style）。
 * @param {string} prompt 原始提示词
 * @param {object} [options]
 * @param {number} [options.sceneIndex] 场景索引
 * @param {string} [options.sensitiveType] 敏感类型（violence/sexual/portrait/political/minor/selfharm/unknown）
 * @param {string} [options.contextBlock] scene_context 上下文块（时代/地域/角色/视觉风格）
 * @param {string[]} [options.anchors] scene_context 一致性锚点
 * @param {string} [options.provider] 图片供应商（优化点 5，用于选择定制改写指令）
 * @param {string} [options.language] 改写指令语言（'zh' 用中文，默认英文）（优化点 5）
 * @param {string} [options.character] 角色一致性描述（优化点 6，改写时保留角色）
 * @param {string} [options.style] 视觉风格描述（优化点 6，改写时保留风格）
 */
function buildContentPolicySafePrompt (prompt, options = {}) {
  const sceneIndex = normalizeSceneIndex(options.sceneIndex)
  const source = String(prompt || '').trim().slice(0, 4000)
  const sceneNumber = sceneIndex + 1
  const sensitiveType = options.sensitiveType || 'unknown'
  const provider = String(options.provider || '').toLowerCase()
  // 优化点 7：未显式指定语言时，按原文自动检测（中文原文用中文指令，英文用英文）
  const language = String(options.language || '').toLowerCase() || detectPromptLanguage(source)
  const contextBlock = String(options.contextBlock || '').trim()
  const anchors = Array.isArray(options.anchors) ? options.anchors.filter(Boolean) : []
  const character = String(options.character || '').trim()
  const style = String(options.style || '').trim()
  const severity = CONTENT_POLICY_SEVERITY[sensitiveType] || 'mild'

  // 优化点 5：按 provider 选择改写指令（优先 provider 定制，其次通用，最后中文）
  let strategy
  if (language === 'zh') {
    strategy = CONTENT_POLICY_REWRITE_STRATEGIES_ZH[sensitiveType] || CONTENT_POLICY_REWRITE_STRATEGIES_ZH.unknown
  } else {
    const providerMap = CONTENT_POLICY_REWRITE_STRATEGIES_BY_PROVIDER[provider]
    strategy = (providerMap && providerMap[sensitiveType]) ||
      CONTENT_POLICY_REWRITE_STRATEGIES[sensitiveType] ||
      CONTENT_POLICY_REWRITE_STRATEGIES.unknown
  }

  const lines = [
    'Generate a policy-compliant, age-appropriate visual interpretation for scene ' + sceneNumber + '.',
    strategy,
    'Do not depict graphic violence, nudity, sexual content, minors, self-harm, illegal activity, hate symbols, real-person likenesses, or readable text.',
  ]
  // 优化点 8：severe 类型（political/minor/selfharm）使用更强改写指令，明确排除敏感元素
  if (severity === 'severe') {
    if (language === 'zh') {
      lines.push('必须严格排除所有敏感元素：不得出现任何未成年人、政治人物、自伤自残或相关暗示。')
    } else {
      lines.push('Strictly exclude all sensitive elements: no minors, no political figures, no self-harm, no related hints.')
    }
  }
  // 注入 scene_context 锚点，保留原文背景（避免改写后背景漂移）
  if (contextBlock) lines.push('Preserve this scene background: ' + contextBlock + '.')
  if (anchors.length > 0) lines.push('Keep these visual anchors: ' + anchors.join(', ') + '.')
  // 优化点 6：保留角色一致性与视觉风格（避免改写后角色/风格漂移）
  if (character) lines.push('Keep the same character: ' + character + '.')
  if (style) lines.push('Keep the visual style: ' + style + '.')
  lines.push('Scene source to adapt:', source)
  return lines.join('\n')
}

/**
 * 改写质量验证（方案层 3，2026-08-30）。
 * 扫描改写后的 prompt 是否仍含高危敏感词。
 * @param {string} prompt 改写后的 prompt
 * @returns {{safe: boolean, flagged: string[]}}
 */
function validateRewriteSafety (prompt) {
  const text = String(prompt || '').toLowerCase()
  const HIGH_RISK_PATTERN = /\b(?:child|minor|underage|self[_\s-]?harm|suicide|gore|nudit|nude|porn|explicit\s+sexual|graphic\s+violence|violent)\b/
  // 中文高危词（2026-08-30 调优）：供应商/用户可能用中文描述敏感内容，
  // 仅英文正则会漏判，导致模板改写版拼入中文原文仍被图片模型拒绝。
  const HIGH_RISK_CN_PATTERN = /(?:儿童|孩子|未成年人|未成年|自杀|自伤|血腥|裸露|色情|淫秽|性爱|暴力)/
  const flagged = []
  if (HIGH_RISK_PATTERN.test(text)) flagged.push('high_risk_sensitive_term')
  if (HIGH_RISK_CN_PATTERN.test(text)) flagged.push('high_risk_sensitive_cn_term')
  return { safe: flagged.length === 0, flagged }
}

/**
 * 扩展敏感词库（优化点 2，2026-08-30）。
 * 覆盖 validateRewriteSafety 之外的常见敏感词，用于改写版发送前的本地预检，
 * 减少无效重试浪费尝试次数。与 validateRewriteSafety 互补（后者覆盖高危核心词）。
 */
const EXTENDED_SENSITIVE_WORDS = [
  // 英文扩展词
  'naked', 'nude', 'nudity', 'corpse', 'dead body', 'dismember', 'mutilat',
  'torture', 'beheading', 'decapitat', 'bloodbath', 'massacre', 'genocide',
  'pedophil', 'child porn', 'underage', 'minor', 'suicide', 'self-harm',
  'self harm', 'selfharm', 'gore', 'gory', 'slaughter', 'execution',
  'weapon', 'gun', 'knife', 'blood', 'bleeding', 'wound', 'injur',
  // 中文扩展词
  '裸体', '裸露', '尸体', '肢解', '虐杀', '斩首', '屠杀', '大屠杀',
  '儿童色情', '恋童', '未成年', '自杀', '自残', '自伤', '血腥', '屠杀',
  '武器', '枪支', '刀', '流血', '伤口', '受伤',
]

/**
 * 改写版发送前预检（优化点 2，2026-08-30）。
 * 扫描改写后的 prompt 是否仍含扩展敏感词库中的高危词。
 * 英文词用词边界匹配并排除否定语境（"no weapons" 不误判），中文词用子串匹配。
 * @param {string} prompt 改写后的 prompt
 * @returns {{safe: boolean, flagged: string[]}}
 */
function preflightRewriteSafety (prompt) {
  const text = String(prompt || '').toLowerCase()
  const flagged = []
  for (const word of EXTENDED_SENSITIVE_WORDS) {
    // 英文词（不含中文）：用词边界匹配，且排除 "no xxx" / "without xxx" 否定语境
    if (!/[\u4e00-\u9fff]/.test(word)) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp('\\b' + escaped + '\\b')
      const negation = new RegExp('\\b(?:no|without)\\s+' + escaped + '\\b')
      if (pattern.test(text) && !negation.test(text)) {
        flagged.push(word)
      }
    } else if (text.includes(word)) {
      // 中文词：子串匹配
      flagged.push(word)
    }
  }
  return { safe: flagged.length === 0, flagged }
}

/**
 * 改写前后语义保留度估算（方案层 3，2026-08-30）。
 * 用关键词重叠率近似估算改写是否保留了原文语义。
 * 优化点 1（2026-08-30 增强）：中文用双字 n-gram（bigram）、英文用词干化，
 * 提升中文/同义词场景的保留度估算准确性；保留原关键词重叠作为兜底。
 * @param {string} original 原始 prompt
 * @param {string} rewritten 改写后 prompt
 * @returns {number} 0~1 的语义保留度
 */
function estimateSemanticRetention (original, rewritten) {
  const a = String(original || '').toLowerCase()
  const b = String(rewritten || '').toLowerCase()
  if (!a.trim()) return 0

  const tokenize = (value) => new Set(String(value || '').split(/[\s,，。.!！?？;；:：、]+/).filter(Boolean))
  // 英文词干化：剥离常见后缀，使 child/kid、running/run 归并为同一词根
  const stem = (word) => word.replace(/(?:ing|ed|es|s)$/, '').replace(/ie$/, 'y')
  const enTokens = (value) => new Set([...tokenize(value)].map(stem))

  // 中文 bigram：把中文连续字符切成双字 n-gram
  const cnBigrams = (value) => {
    const cjk = value.replace(/[^\u4e00-\u9fff]/g, '')
    const grams = new Set()
    for (let i = 0; i < cjk.length - 1; i++) grams.add(cjk.slice(i, i + 2))
    return grams
  }

  const aEn = enTokens(a)
  const bEn = enTokens(b)
  const aCn = cnBigrams(a)
  const bCn = cnBigrams(b)

  let overlap = 0
  let total = 0
  for (const token of aEn) {
    if (!/[\u4e00-\u9fff]/.test(token)) {
      total++
      if (bEn.has(token)) overlap++
    }
  }
  for (const gram of aCn) {
    total++
    if (bCn.has(gram)) overlap++
  }
  return total ? overlap / total : 0
}

/**
 * 结构化审计记录（方案层 4，2026-08-30）。
 * 记录敏感类型/改写前后 prompt 哈希/供应商/模型/尝试次数/结果。
 * 严禁保存原始或改写后的 prompt 明文（遵循 PRD §7.1.5 合同）。
 * @param {object} opts
 * @returns {object} 审计记录
 */
function createContentPolicyAudit (opts = {}) {
  const crypto = require('crypto')
  const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')
  const audit = {
    sceneIndex: normalizeSceneIndex(opts.sceneIndex),
    sceneNumber: normalizeSceneIndex(opts.sceneIndex) + 1,
    sensitiveType: opts.sensitiveType || 'unknown',
    provider: opts.provider || '',
    model: opts.model || '',
    attempts: Number(opts.attempts) || 1,
    outcome: opts.outcome || '',
    originalPromptHash: sha256(opts.originalPrompt),
    rewrittenPromptHash: sha256(opts.rewrittenPrompt),
  }
  return audit
}

function createAttemptAudit (attempt, sceneIndex, promptStrategy, outcome, category) {
  const audit = {
    attempt,
    sceneIndex,
    sceneNumber: sceneIndex + 1,
    promptStrategy,
    outcome,
  }
  if (category) audit.category = category
  return audit
}

function createContentPolicyCheckpoint (sceneIndex, attempts, sensitiveType) {
  const sceneNumber = sceneIndex + 1
  const checkpoint = {
    type: 'needs_user_input',
    status: 'needs_user_input',
    reason: 'content_policy',
    needsUserInput: true,
    sceneIndex,
    sceneNumber,
    attempts,
    recommendation: '请将第 ' + sceneNumber + ' 个场景改为更抽象、非露骨且不含敏感人物或动作的描述后重试。',
  }
  if (typeof sensitiveType === 'string' && sensitiveType) checkpoint.sensitiveType = sensitiveType
  return checkpoint
}

function createEmptyResultCheckpoint (sceneIndex, attempts) {
  const sceneNumber = sceneIndex + 1
  return {
    type: 'needs_user_input',
    status: 'needs_user_input',
    reason: 'empty_result',
    needsUserInput: true,
    sceneIndex,
    sceneNumber,
    attempts,
    recommendation: '第 ' + sceneNumber + ' 个场景的图片生成多次未返回结果（可能是内容安全策略或服务波动）。请修改该场景文案后重试，或稍后再试。',
  }
}

/**
 * 仅针对明确的内容政策拒绝重写并重试图片生成。
 * 返回的 attempts 只包含非敏感审计元数据，绝不包含原始或重写后的 prompt。
 * @param {object} opts
 * @param {string} opts.prompt 原始提示词
 * @param {number} [opts.sceneIndex] 场景索引
 * @param {number} [opts.maxAttempts] 最大尝试次数
 * @param {Function} opts.generate 单次生成函数
 * @param {Function} [opts.onRewrite] 当发生内容政策拒绝并切换到安全改写时回调（用于实时进度提示）
 * @param {object} [opts.sceneContext] scene_context 上下文（方案层 2）：{ contextBlock, anchors }
 * @param {string} [opts.sceneContext.contextBlock] 场景上下文块（时代/地域/角色/视觉风格）
 * @param {string[]} [opts.sceneContext.anchors] 场景一致性锚点
 * @param {Function} [opts.rewriteWithLLM] 可选 LLM 改写回调（方案层 3 增强）：模板改写自检失败
 *   （原文含高危敏感词，改写版必然仍含）时，调用它做真正的语义改写（替换敏感内容、保留原意）。
 *   签名：async ({ prompt, sensitiveType, sceneIndex, contextBlock, anchors }) => string（改写后的安全提示词）。
 *   未提供时，模板改写自检失败则直接交用户（兜底）。
 */
async function runContentPolicyImageRetry ({ prompt, sceneIndex, maxAttempts, generate, onRewrite, sceneContext, rewriteWithLLM, provider }) {
  if (typeof generate !== 'function') throw new TypeError('generate must be a function')

  const normalizedSceneIndex = normalizeSceneIndex(sceneIndex)
  const attemptLimit = normalizeAttemptLimit(maxAttempts)
  const attempts = []
  const originalPrompt = String(prompt || '').trim().slice(0, 4000)
  let currentPrompt = originalPrompt
  let promptStrategy = 'original'
  // scene_context 上下文（方案层 2）：改写时注入，保留原文背景避免漂移
  const contextBlock = sceneContext && typeof sceneContext === 'object' ? String(sceneContext.contextBlock || '') : ''
  const anchors = sceneContext && Array.isArray(sceneContext.anchors) ? sceneContext.anchors : []
  // 优化点 6：从 sceneContext 提取角色一致性与视觉风格（改写时保留，避免漂移）
  const character = sceneContext && typeof sceneContext === 'object' ? String(sceneContext.character || '') : ''
  const style = sceneContext && typeof sceneContext === 'object' ? String(sceneContext.style || '') : ''
  // 优化点 5：图片供应商（用于选择定制改写指令）
  const imageProvider = String(provider || '').toLowerCase()
  // 最近一次内容政策拒绝的敏感类型（方案层 1），用于差异化改写
  let sensitiveType = 'unknown'
  // 优化点 2：敏感类型连续拒绝计数。同一敏感类型连续拒绝 2 次说明模板改写无效，
  // 升级到 LLM 改写（若可用），避免反复用无效模板浪费尝试次数。
  let sensitiveTypeRejections = 0
  let lastSensitiveType = 'unknown'

  const notifyRewrite = () => {
    if (typeof onRewrite === 'function') {
      try {
        onRewrite({ sceneIndex: normalizedSceneIndex, sceneNumber: normalizedSceneIndex + 1 })
      } catch (_) { /* 进度提示回调异常不得阻断重试 */ }
    }
  }

  const rewritePrompt = () => {
    currentPrompt = buildContentPolicySafePrompt(originalPrompt, {
      sceneIndex: normalizedSceneIndex,
      contextBlock,
      anchors,
      sensitiveType,
      provider: imageProvider,
      character,
      style,
    })
    promptStrategy = 'content_policy_safe_rewrite'
  }

  /**
   * 方案层 3 增强：模板改写自检失败（原文含高危敏感词，改写版必然仍含）时，
   * 优先升级 LLM 改写（真正替换敏感内容、保留原意），避免直接交用户。
   * 未提供 LLM 改写回调则返回 null（调用方交用户兜底）。
   *
   * 优化点 3（2026-08-30）：多轮改写降级。每轮传不同 round 改写指令，
   * 直到拿到安全结果；用语义保留度（优化点 1）在多轮安全结果中选保留度最高的。
   * 优化点 2：改写结果二次校验——每轮结果都过 validateRewriteSafety，仍含高危词则弃用。
   *
   * @returns {Promise<{prompt: string, retention: number}|null>} 改写后的安全提示词及保留度，或 null
   */
  const rewriteWithLLMFallback = async () => {
    if (typeof rewriteWithLLM !== 'function') return null
    // 优化点 5：同原始 prompt 哈希缓存复用（避免重复调用 LLM）。
    // 缓存 key 绑定 rewriteWithLLM 函数引用，避免不同改写器/测试间污染。
    const crypto = require('crypto')
    const cacheKey = crypto.createHash('sha256').update(originalPrompt).digest('hex') + ':' + (rewriteWithLLM._cacheId || (rewriteWithLLM._cacheId = Math.random().toString(36).slice(2)))
    if (llmRewriteCache.has(cacheKey)) {
      return llmRewriteCache.get(cacheKey)
    }
    // 优化点 5：每场景 LLM 改写调用上限（超过则回退，不调用 LLM）
    const callCount = llmRewriteCallCount.get(cacheKey) || 0
    if (callCount >= LLM_REWRITE_MAX_CALLS_PER_SCENE) return null
    setWithInsertionBound(llmRewriteCallCount, cacheKey, callCount + 1, LLM_REWRITE_CACHE_MAX_ENTRIES)
    // 多轮改写指令（优化点 3）：从「替换敏感词」到「抽象化」到「最小改写」，逐级降级。
    const ROUNDS = ['safe_rewrite', 'abstract_rewrite', 'minimal_rewrite']
    let best = null
    let bestRetention = -1
    for (const round of ROUNDS) {
      let llmPrompt
      try {
        llmPrompt = await rewriteWithLLM({
          prompt: originalPrompt,
          sensitiveType,
          sceneIndex: normalizedSceneIndex,
          contextBlock,
          anchors,
          round,
        })
      } catch (_) {
        // 单轮 LLM 改写异常不阻断后续轮次
        continue
      }
      const safe = typeof llmPrompt === 'string' && llmPrompt.trim()
      if (!safe) continue
      // 优化点 2：改写结果二次校验——仍含高危词则弃用该轮
      if (!validateRewriteSafety(llmPrompt).safe) continue
      // 优化点 2 增强：扩展敏感词库预检——仍含扩展高危词则弃用该轮
      if (!preflightRewriteSafety(llmPrompt).safe) continue
      // 优化点 1：语义保留度，选保留度最高的安全结果
      const retention = estimateSemanticRetention(originalPrompt, llmPrompt)
      if (retention > bestRetention) {
        best = llmPrompt.trim()
        bestRetention = retention
      }
    }
    const result = best ? { prompt: best, retention: bestRetention } : null
    // 优化点 5：缓存改写结果（仅缓存成功结果）
    if (result) setWithInsertionBound(llmRewriteCache, cacheKey, result, LLM_REWRITE_CACHE_MAX_ENTRIES)
    return result
  }

  for (let attempt = 1; attempt <= attemptLimit; attempt++) {
    try {
      const result = await generate({
        prompt: currentPrompt,
        attempt,
        sceneIndex: normalizedSceneIndex,
        sceneNumber: normalizedSceneIndex + 1,
        promptStrategy,
      })
      attempts.push(createAttemptAudit(attempt, normalizedSceneIndex, promptStrategy, 'success'))
      return { status: 'success', result, attempts }
    } catch (error) {
      // 空结果：供应商返回 200 但无图片（静默内容策略拒绝或瞬时故障）。
      // 前几次用同提示词重试（瞬时），随后切内容安全改写；到达上限后转 needs_user_input 交用户处理。
      if (error?.emptyResult === true) {
        attempts.push(createAttemptAudit(
          attempt,
          normalizedSceneIndex,
          promptStrategy,
          'empty_result',
          'empty_result',
        ))
        // 第 3 次调用起使用内容安全改写（本次失败后设置，下次 generate 生效）
        if (attempt >= 2 && attempt < attemptLimit) {
          rewritePrompt()
          notifyRewrite()
        }
        if (attempt === attemptLimit) {
          return {
            status: 'needs_user_input',
            attempts,
            checkpoint: createEmptyResultCheckpoint(normalizedSceneIndex, attempt),
          }
        }
        continue
      }

      if (!isContentPolicyRejection(error)) {
        attempts.push(createAttemptAudit(
          attempt,
          normalizedSceneIndex,
          promptStrategy,
          'failed',
          getErrorCategory(error),
        ))
        return { status: 'failed', error, attempts }
      }

      attempts.push(createAttemptAudit(
        attempt,
        normalizedSceneIndex,
        promptStrategy,
        'content_policy_rejected',
        'content_policy',
      ))

      // 提取敏感类型（方案层 1），用于差异化改写（方案层 2）
      // 优化点 3：传入 provider 查映射表，提升已知 provider 信号的识别准确率
      sensitiveType = classifyContentPolicyType(
        error?.message || error?.status_msg || error?.context?.status_msg || '',
        imageProvider
      )
      // 优化点 2：更新敏感类型连续拒绝计数（同一类型连续拒绝才累计）
      if (sensitiveType === lastSensitiveType) {
        sensitiveTypeRejections++
      } else {
        sensitiveTypeRejections = 1
        lastSensitiveType = sensitiveType
      }

      if (attempt === attemptLimit) {
        return {
          status: 'needs_user_input',
          attempts,
          checkpoint: createContentPolicyCheckpoint(normalizedSceneIndex, attempt, sensitiveType),
        }
      }

      // 方案层 3 增强：改写前自检原文。若原文本身含高危敏感词（child/minor/self-harm 等），
      // 模板改写版会把原文拼入（Scene source to adapt）必然仍含高危词，模板改写无意义。
      // 此时优先升级 LLM 改写（真正替换敏感内容、保留原意）；无 LLM 能力则交用户兜底。
      if (!validateRewriteSafety(originalPrompt).safe) {
        const llmResult = await rewriteWithLLMFallback()
        if (llmResult) {
          currentPrompt = llmResult.prompt
          promptStrategy = 'llm_safe_rewrite'
          // 优化点 1：记录语义保留度到审计（供后续数据驱动优化）
          if (Number.isFinite(llmResult.retention)) {
            attempts[attempts.length - 1].semanticRetention = Number(llmResult.retention.toFixed(3))
          }
          notifyRewrite()
          continue
        }
        return {
          status: 'needs_user_input',
          attempts,
          checkpoint: createContentPolicyCheckpoint(normalizedSceneIndex, attempt, sensitiveType),
        }
      }

      // 优化点 2：同一敏感类型连续拒绝 ≥2 次说明模板改写无效，升级到 LLM 改写（若可用）。
      if (sensitiveTypeRejections >= 2 && typeof rewriteWithLLM === 'function') {
        const llmResult = await rewriteWithLLMFallback()
        if (llmResult) {
          currentPrompt = llmResult.prompt
          promptStrategy = 'llm_safe_rewrite'
          if (Number.isFinite(llmResult.retention)) {
            attempts[attempts.length - 1].semanticRetention = Number(llmResult.retention.toFixed(3))
          }
          notifyRewrite()
          continue
        }
      }

      rewritePrompt()
      notifyRewrite()
    }
  }

  throw new Error('Content-policy image retry did not settle')
}

/**
 * 按 checkpoint.reason 生成 needs_user_input 的用户可见消息（单一来源，2026-08-16）：
 * content_policy → 内容安全审查；empty_result → 多次未返回结果（服务波动或账号问题）。
 * 严禁在 empty_result 消息中内嵌 "content-policy" 字样，避免渲染层模式再次误映射为内容审查。
 */
function needsUserInputMessage (checkpoint) {
  return checkpoint?.reason === 'content_policy'
    ? 'Image generation requires user input after content-policy review'
    : 'Image generation repeatedly returned no result (service fluctuation or account issue); adjust the scene prompt and retry, or check the provider account'
}

/**
 * 优化点 4：敏感词库数据驱动优化（2026-08-30）。
 * 从审计记录数组聚合各敏感类型占比、改写成功率、平均语义保留度，反哺信号词库和改写模板。
 * 输入为 createContentPolicyAudit 产出的审计记录数组（只含哈希与元数据，不含明文 prompt）。
 * @param {Array<object>} audits 审计记录数组
 * @returns {object} 聚合统计
 */
function aggregateContentPolicyStats (audits) {
  const list = Array.isArray(audits) ? audits : []
  const byType = {}
  let total = 0
  let successCount = 0
  let retentionSum = 0
  let retentionCount = 0

  for (const audit of list) {
    const type = audit?.sensitiveType || 'unknown'
    if (!byType[type]) byType[type] = { count: 0, success: 0, needsUserInput: 0, retentionSum: 0, retentionCount: 0 }
    byType[type].count++
    total++
    if (audit?.outcome === 'success') {
      successCount++
      byType[type].success++
    } else if (audit?.outcome === 'needs_user_input') {
      byType[type].needsUserInput++
    }
    if (Number.isFinite(audit?.semanticRetention)) {
      byType[type].retentionSum += audit.semanticRetention
      byType[type].retentionCount++
      retentionSum += audit.semanticRetention
      retentionCount++
    }
  }

  const types = Object.keys(byType).map((type) => {
    const t = byType[type]
    return {
      sensitiveType: type,
      count: t.count,
      ratio: total ? Number((t.count / total).toFixed(3)) : 0,
      successRate: t.count ? Number((t.success / t.count).toFixed(3)) : 0,
      needsUserInputRate: t.count ? Number((t.needsUserInput / t.count).toFixed(3)) : 0,
      avgSemanticRetention: t.retentionCount ? Number((t.retentionSum / t.retentionCount).toFixed(3)) : 0,
    }
  }).sort((a, b) => b.count - a.count)

  // 优化点 6：审计统计反哺（2026-08-30）。
  // 低成功率类型生成改写指令增强建议；高频 unknown 生成信号词补充建议。
  // 反哺为可选调优建议，不改变既有审计数据。
  const suggestions = []
  const LOW_SUCCESS_RATE_THRESHOLD = 0.5
  for (const t of types) {
    if (t.count >= 2 && t.successRate < LOW_SUCCESS_RATE_THRESHOLD) {
      suggestions.push({
        sensitiveType: t.sensitiveType,
        successRate: t.successRate,
        count: t.count,
        action: 'enhance_rewrite_strategy',
        detail: '低成功率类型：建议增强该敏感类型的改写指令强度或补充信号词。',
      })
    }
  }
  const unknownType = types.find((t) => t.sensitiveType === 'unknown')
  if (unknownType && unknownType.count >= 3) {
    suggestions.push({
      sensitiveType: 'unknown',
      successRate: unknownType.successRate,
      count: unknownType.count,
      action: 'supplement_signal_words',
      detail: '高频 unknown 类型：建议补充供应商错误信号词以提升敏感类型识别准确率。',
    })
  }

  return {
    total,
    successRate: total ? Number((successCount / total).toFixed(3)) : 0,
    avgSemanticRetention: retentionCount ? Number((retentionSum / retentionCount).toFixed(3)) : 0,
    byType: types,
    suggestions,
  }
}

module.exports = {
  MAX_IMAGE_GENERATION_ATTEMPTS,
  LLM_REWRITE_MAX_CALLS_PER_SCENE,
  CONTENT_POLICY_REWRITE_STRATEGIES,
  CONTENT_POLICY_REWRITE_STRATEGIES_BY_PROVIDER,
  CONTENT_POLICY_REWRITE_STRATEGIES_ZH,
  CONTENT_POLICY_SEVERITY,
  aggregateContentPolicyStats,
  buildContentPolicySafePrompt,
  buildNegativePrompt,
  createContentPolicyAudit,
  createContentPolicyCheckpoint,
  createEmptyResultCheckpoint,
  detectPromptLanguage,
  estimateSemanticRetention,
  isContentPolicyRejection,
  needsUserInputMessage,
  preflightRewriteSafety,
  runContentPolicyImageRetry,
  validateRewriteSafety,
}
