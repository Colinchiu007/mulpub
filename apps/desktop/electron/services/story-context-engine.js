// @ts-check
/**
 * story-context-engine — Story2Video 场景上下文增强中间层（规则驱动，无 IO，可测）。
 *
 * 定位：位于「分句引擎输出场景（split / scene_context）」与「图片提示词优化引擎（prompt-engine）」
 * 之间，读取完整文案提取全局故事上下文（时代/朝代/文化地域/题材/设定/角色/道具/视觉风格/语气），
 * 再把全局锚点融合进每个场景，形成逐场景上下文块与负面锚点，保证提示词生成图片/视频时
 * 故事背景的准确性、一致性与连贯性（如唐代全文 + 「一个老妇人在做饭」→ 不生成西方老太太现代厨房）。
 *
 * 契约：发送 prompt-engine 的 context 只输出 CONTEXT_KEY_WHITELIST 白名单键
 * （对齐 prompt_engine/prompt_builder.py build_context_section 已知键），
 * 敏感凭据键拦截由 prompt-engine-contract.assertNoSensitiveContext 在发送层执行。
 */
'use strict'
// ---------------------------------------------------------------------------
// 规则表加载（单一来源 story-context-rules.json 内置随包，支持外部覆盖）
// 优先级：env STORY2VIDEO_CONTEXT_RULES_PATH → overridePath（调用方传入）→ 内置 JSON → 空规则兜底
// ---------------------------------------------------------------------------
const fs = require('fs')

let BUILTIN_CONTEXT_RULES = null
try {
  BUILTIN_CONTEXT_RULES = require('./story-context-rules.json')
} catch (_) {
  // 语法级损坏属打包错误：loadContextRules 会回退空规则兜底并告警
}

const EMPTY_CONTEXT_RULES = Object.freeze({
  version: 0,
  dynasty: [], culture: [], genre: [], setting: [], visualStyle: [], tone: [],
  characters: [], time: { timeOfDay: [], season: [] },
  props: { ancient: [], modern: [] },
  negativeAnchors: { ancient: [], modern: [] },
  cooking: { positiveProps: { ancient: [], modern: [] }, negativeAnchors: { ancient: [], modern: [] } },
})

function _isNonEmptyStringArray (value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.trim().length > 0)
}

/**
 * 规则结构校验（fail-fast）：非法字段逐项报错（path + message）。
 * @param {unknown} rules
 * @returns {{ok: boolean, errors: Array<{path: string, message: string}>}}
 */
function validateContextRules (rules) {
  const errors = []
  const push = (rulePath, message) => errors.push({ path: rulePath, message })
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    return { ok: false, errors: [{ path: '', message: '规则必须是对象' }] }
  }
  if (typeof rules.version !== 'number' || !Number.isInteger(rules.version) || rules.version < 1) {
    push('version', 'version 必须为正整数')
  }
  const keywordRules = [
    ['dynasty', ['keywords', 'name', 'period', 'visualStyle', 'era']],
    ['culture', ['keywords', 'culture', 'regions']],
    ['genre', ['keywords', 'genre']],
    ['setting', ['keywords', 'setting']],
    ['visualStyle', ['keywords', 'style']],
    ['tone', ['keywords', 'tone']],
  ]
  for (const [key, required] of keywordRules) {
    if (!Array.isArray(rules[key])) { push(key, '必须为数组'); continue }
    rules[key].forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { push(key + '[' + index + ']', '项必须是对象'); return }
      for (const field of required) {
        if (field === 'keywords') {
          if (!_isNonEmptyStringArray(item[field])) push(key + '[' + index + '].keywords', 'keywords 必须为非空字符串数组')
        } else if (field === 'regions') {
          if (!Array.isArray(item[field])) push(key + '[' + index + '].regions', 'regions 必须为数组')
        } else if (typeof item[field] !== 'string' || item[field].trim().length === 0) {
          push(key + '[' + index + '].' + field, '必须为非空字符串')
        }
      }
      if (key === 'dynasty' && item.era !== 'ancient' && item.era !== 'modern') {
        push('dynasty[' + index + '].era', 'era 必须为 ancient 或 modern')
      }
    })
  }
  if (!Array.isArray(rules.characters)) {
    push('characters', '必须为数组')
  } else {
    rules.characters.forEach((item, index) => {
      if (typeof item !== 'string' || item.trim().length === 0) push('characters[' + index + ']', '必须为非空字符串')
    })
  }
  if (!rules.time || typeof rules.time !== 'object') {
    push('time', '必须为对象')
  } else {
    for (const key of ['timeOfDay', 'season']) {
      if (!Array.isArray(rules.time[key])) push('time.' + key, '必须为数组')
    }
  }
  for (const key of ['props', 'negativeAnchors', 'cooking']) {
    if (!rules[key] || typeof rules[key] !== 'object' || Array.isArray(rules[key])) push(key, '必须为对象')
  }
  if (rules.props && typeof rules.props === 'object') {
    for (const side of ['ancient', 'modern']) {
      if (!Array.isArray(rules.props[side])) push('props.' + side, '必须为数组')
      else rules.props[side].forEach((item, index) => {
        if (!item || typeof item !== 'object' || !_isNonEmptyStringArray(item.keywords) || typeof item.name !== 'string' || !item.name.trim()) {
          push('props.' + side + '[' + index + '].keywords/name', 'keywords 必须为非空字符串数组且 name 必须为非空字符串')
        }
      })
    }
  }
  if (rules.negativeAnchors && typeof rules.negativeAnchors === 'object') {
    for (const side of ['ancient', 'modern']) {
      if (!Array.isArray(rules.negativeAnchors[side])) push('negativeAnchors.' + side, '必须为数组')
      else rules.negativeAnchors[side].forEach((item, index) => {
        if (typeof item !== 'string' || item.trim().length === 0) push('negativeAnchors.' + side + '[' + index + ']', '必须为非空字符串')
      })
    }
  }
  if (rules.cooking && typeof rules.cooking === 'object') {
    for (const sub of ['positiveProps', 'negativeAnchors']) {
      if (!rules.cooking[sub] || typeof rules.cooking[sub] !== 'object') { push('cooking.' + sub, '必须为对象'); continue }
      for (const side of ['ancient', 'modern']) {
        if (!Array.isArray(rules.cooking[sub][side])) push('cooking.' + sub + '.' + side, '必须为数组')
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

function _readRulesFile (filePath, source) {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(text)
    const result = validateContextRules(parsed)
    if (!result.ok) {
      return { ok: false, error: source + ' 规则校验失败: ' + result.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; ') }
    }
    return { ok: true, rules: parsed, source }
  } catch (error) {
    return { ok: false, error: source + ' 读取/解析失败: ' + (error && error.message ? error.message : String(error)) }
  }
}

/**
 * 加载规则：外部覆盖（env/overridePath）→ 内置 JSON → 空规则兜底。
 * @param {{overridePath?: string}} [options]
 * @returns {{rules: object, source: string, warning: (string|null)}}
 */
function loadContextRules ({ overridePath } = {}) {
  const envPath = process.env.STORY2VIDEO_CONTEXT_RULES_PATH
  const candidates = []
  if (typeof envPath === 'string' && envPath.trim()) candidates.push({ path: envPath.trim(), source: 'env' })
  if (typeof overridePath === 'string' && overridePath.trim()) candidates.push({ path: overridePath.trim(), source: 'file' })
  const warnings = []
  for (const candidate of candidates) {
    const loaded = _readRulesFile(candidate.path, candidate.source)
    if (loaded.ok) return { rules: loaded.rules, source: candidate.source, warning: warnings.length > 0 ? warnings.join('; ') : null }
    warnings.push(loaded.error)
  }
  const builtinValid = validateContextRules(BUILTIN_CONTEXT_RULES)
  if (builtinValid.ok) return { rules: BUILTIN_CONTEXT_RULES, source: 'builtin', warning: warnings.length > 0 ? warnings.join('; ') : null }
  return {
    rules: EMPTY_CONTEXT_RULES,
    source: 'empty',
    warning: '内置规则校验失败: ' + builtinValid.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
  }
}

let contextRulesState = loadContextRules({})

/** 当前生效规则（外部覆盖失败时回退内置）。 */
function getContextRules () {
  return { ...contextRulesState.rules }
}

/** 规则来源信息（供日志/展示）。 */
function getContextRulesInfo () {
  return { source: contextRulesState.source, warning: contextRulesState.warning, version: contextRulesState.rules.version }
}

/**
 * 运行时切换外部规则（如 <userData>/config/story-context-rules.json）。
 * 失败保持现状（回退内置），不抛错。
 * @param {string} overridePath
 * @returns {{ok: boolean, source?: string, error?: string}}
 */
function resetContextRules () {
  contextRulesState = loadContextRules({})
  _refreshRuleConstants()
  return getContextRulesInfo()
}
function _refreshRuleConstants () {
  DYNASTY_RULES = contextRulesState.rules.dynasty
  CULTURE_RULES = contextRulesState.rules.culture
  GENRE_RULES = contextRulesState.rules.genre
  SETTING_RULES = contextRulesState.rules.setting
  PROP_RULES = contextRulesState.rules.props
  CHARACTER_RULES = contextRulesState.rules.characters
  TIME_RULES = contextRulesState.rules.time
  VISUAL_STYLE_RULES = contextRulesState.rules.visualStyle
  TONE_RULES = contextRulesState.rules.tone
  NEGATIVE_ANCHOR_RULES = contextRulesState.rules.negativeAnchors
  COOKING_NEGATIVE_ANCHORS = contextRulesState.rules.cooking.negativeAnchors
  COOKING_POSITIVE_PROPS = contextRulesState.rules.cooking.positiveProps
  // 审查 W1：CommonJS module.exports 是值快照，外部解构常量的消费者需同步刷新
  module.exports.DYNASTY_RULES = DYNASTY_RULES
  module.exports.CULTURE_RULES = CULTURE_RULES
  module.exports.GENRE_RULES = GENRE_RULES
  module.exports.SETTING_RULES = SETTING_RULES
  module.exports.PROP_RULES = PROP_RULES
  module.exports.CHARACTER_RULES = CHARACTER_RULES
  module.exports.TIME_RULES = TIME_RULES
  module.exports.VISUAL_STYLE_RULES = VISUAL_STYLE_RULES
  module.exports.TONE_RULES = TONE_RULES
  module.exports.NEGATIVE_ANCHOR_RULES = NEGATIVE_ANCHOR_RULES
  module.exports.COOKING_NEGATIVE_ANCHORS = COOKING_NEGATIVE_ANCHORS
  module.exports.COOKING_POSITIVE_PROPS = COOKING_POSITIVE_PROPS
}
function setContextRulesOverride (overridePath) {
  const loaded = _readRulesFile(overridePath, 'file')
  if (!loaded.ok) return { ok: false, error: loaded.error }
  contextRulesState = { rules: loaded.rules, source: 'file', warning: null }
  _refreshRuleConstants()
  return { ok: true, source: 'file' }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 规则表（单一来源：story-context-rules.json；由 loadContextRules 加载，支持外部覆盖）
// ---------------------------------------------------------------------------
let DYNASTY_RULES = contextRulesState.rules.dynasty
let CULTURE_RULES = contextRulesState.rules.culture
let GENRE_RULES = contextRulesState.rules.genre
let SETTING_RULES = contextRulesState.rules.setting
let PROP_RULES = contextRulesState.rules.props
let CHARACTER_RULES = contextRulesState.rules.characters
let TIME_RULES = contextRulesState.rules.time
let VISUAL_STYLE_RULES = contextRulesState.rules.visualStyle
let TONE_RULES = contextRulesState.rules.tone
let NEGATIVE_ANCHOR_RULES = contextRulesState.rules.negativeAnchors
let COOKING_NEGATIVE_ANCHORS = contextRulesState.rules.cooking.negativeAnchors
let COOKING_POSITIVE_PROPS = contextRulesState.rules.cooking.positiveProps

/** 发送 prompt-engine 的 context 白名单键（对齐 prompt_engine/prompt_builder.py） */
const CONTEXT_KEY_WHITELIST = Object.freeze([
  'synopsis', 'full_text', 'setting', 'narrative_intent', 'scene_type', 'character_list', 'character',
])

/** full_text 发送上限（审查 W4）：长文 × N 场景会造成请求体重复放大；服务端另截断 500。 */
const MAX_FULL_TEXT_CHARS = 2000

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = Object.freeze({
  enabled: true,
  maxSummaryLength: 300,
  maxAnchors: 8,
  includeNegativeAnchors: true,
  contextBlockMaxChars: 400,
})

function normalizeText (value) {
  return String(value || '').replace(/\s+/gu, ' ').trim()
}


function integerInRange (value, min, max, fallback) {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function booleanValue (value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function firstDefined (...values) {
  return values.find(value => value !== undefined && value !== null)
}

function keywordHits (text, keywords) {
  if (!text) return []
  return keywords.filter(keyword => text.includes(keyword))
}

function dedupe (items) {
  return [...new Set(items.filter(item => item !== undefined && item !== null && String(item).trim() !== ''))]
}

function joinNonEmpty (parts, separator) {
  return parts.filter(part => part !== undefined && part !== null && String(part).trim() !== '').join(separator)
}

/** 按断句点截断到 max 字符（优先在句末标点处断开，避免截断语义） */
function truncateBySentence (text, max) {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const window = chars.slice(0, max).join('')
  const breakMatch = window.match(/[。！？!?；;，,、：:][^。！？!?；;，,、：:]*$/)
  if (breakMatch && breakMatch.index !== undefined && breakMatch.index > 0) {
    return window.slice(0, breakMatch.index + 1)
  }
  return window
}

function sceneTextOf (scene) {
  if (typeof scene === 'string') return normalizeText(scene)
  if (!scene || typeof scene !== 'object') return ''
  return normalizeText(scene.imagePromptSeed || scene.prompt || scene.text || scene.content || scene.sentence)
}

function detectByRules (text, rules, keyName) {
  return rules
    .map(rule => ({ rule, hits: keywordHits(text, rule.keywords) }))
    .filter(item => item.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length)
    .map(item => ({ [keyName]: item.rule[keyName], hits: item.hits, evidence: item.hits, rule: item.rule }))
}

// ---------------------------------------------------------------------------
// 成语/多义词误判守卫（2026-08-30，任务 mtfdxj8d_x694 场景11被"事后诸葛亮"误判三国）
// 朝代关键词用裸子串匹配，成语"事后诸葛亮"含"诸葛亮"、"说曹操曹操到"含"曹操"，
// 会把非三国题材整篇误判为三国并污染所有场景（era strong + 视觉风格 + 负面锚点）。
// 映射：朝代关键词 → 包含它的成语列表；文本命中成语时，该关键词不作为朝代证据。
// 仅作用于 detectDynasty（朝代误判影响最大），不影响道具/时代/东亚意象等其它检测。
// ---------------------------------------------------------------------------
const IDIOM_EXCLUSIONS = Object.freeze({
  诸葛亮: Object.freeze(['事后诸葛亮']),
  曹操: Object.freeze(['说曹操曹操到', '曹操到']),
  // P1-13（体检报告问题13，[v3 订正]）：只登记真实惯用语/歇后语。
  // "孙权称帝"是史实陈述而非惯用语，登记它会让所有正经三国文本漏判 —— 改由正向回归锁定。
  刘备: Object.freeze(['刘备借荆州', '刘备摔阿斗']),
})

/**
 * 过滤被成语包含的朝代关键词命中。
 * 若命中词出现在 IDIOM_EXCLUSIONS 中，且文本包含对应成语，则剔除该命中。
 * @param {string} text
 * @param {string[]} hits 已命中的朝代关键词
 * @returns {string[]} 过滤后的命中
 */
function filterIdiomHits (text, hits) {
  if (!hits || hits.length === 0) return hits
  return hits.filter(keyword => {
    const idioms = IDIOM_EXCLUSIONS[keyword]
    if (!idioms) return true
    // 命中词是成语的一部分：若文本包含任一成语，则该命中视为成语误判，剔除
    return !idioms.some(idiom => text.includes(idiom))
  })
}

// ---------------------------------------------------------------------------
// 配置归一
// ---------------------------------------------------------------------------

/**
 * 收敛 scene_context 配置到契约边界；非法类型回退默认。
 * @param {object} [options]
 */
function normalizeSceneContextOptions (options = {}) {
  const source = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  // snake_case → camelCase 统一（stageOptions 走 snake_case，text-config/直调走 camelCase），
  // 避免 include_negative_anchors 等布尔开关端到端失效（审查 C1）。
  const camel = {}
  for (const [key, value] of Object.entries(source)) {
    const camelKey = key.replace(/_([a-z])/gu, (_, char) => char.toUpperCase())
    if (camel[camelKey] === undefined) camel[camelKey] = value
  }
  return {
    enabled: booleanValue(camel.enabled, DEFAULT_OPTIONS.enabled),
    maxSummaryLength: integerInRange(
      firstDefined(camel.maxSummaryLength),
      50, 1000, DEFAULT_OPTIONS.maxSummaryLength,
    ),
    maxAnchors: integerInRange(
      firstDefined(camel.maxAnchors),
      1, 20, DEFAULT_OPTIONS.maxAnchors,
    ),
    includeNegativeAnchors: booleanValue(
      camel.includeNegativeAnchors, DEFAULT_OPTIONS.includeNegativeAnchors,
    ),
    contextBlockMaxChars: integerInRange(
      firstDefined(camel.contextBlockMaxChars),
      50, 1000, DEFAULT_OPTIONS.contextBlockMaxChars,
    ),
  }
}

// ---------------------------------------------------------------------------
// 全局故事上下文提取
// ---------------------------------------------------------------------------

function detectDynasty (text) {
  const found = detectByRules(text, DYNASTY_RULES, 'name')
  if (found.length === 0) return null
  // 成语/多义词守卫（2026-08-30）：剔除被成语包含的关键词命中（如"事后诸葛亮"→诸葛亮）
  const filtered = found
    .map(item => {
      const cleanHits = filterIdiomHits(text, item.hits)
      return { ...item, hits: cleanHits, evidence: cleanHits }
    })
    .filter(item => item.hits.length > 0)
  if (filtered.length === 0) return null
  // 现代信号中和（2026-08-30 modern-signal）：现代题材全文出现朝代关键词作举例/引用时，
  // 若现代信号 ≥2 且朝代命中 < 现代信号，视为"引用/背景"而非"主题"，返回 null（不污染全局朝代/era/视觉风格）。
  // 纯历史（现代信号 0）与穿越剧（朝代命中 ≥ 现代信号）不受影响。
  const modernCount = keywordHits(text, MODERN_TERMS).length
  const dynastyHits = filtered.reduce((sum, item) => sum + item.hits.length, 0)
  if (modernCount >= 2 && dynastyHits < modernCount) return null
  const top = filtered[0]
  const rule = top.rule
  return {
    name: rule.name,
    period: rule.period,
    visualStyle: rule.visualStyle,
    era: rule.era,
    confidence: Math.min(0.98, 0.8 + top.hits.length * 0.04),
    method: 'keyword',
    evidence: top.hits.slice(0, 5),
  }
}

function detectCulture (text) {
  const found = detectByRules(text, CULTURE_RULES, 'culture')
  if (found.length === 0) return { culture: '', region: '', hits: [], multiCandidates: [] }
  const top = found[0]
  // 审查 W3：无地域关键词命中时返回空 region，禁止用规则表默认城市编造定位
  const region = top.rule.regions.find(candidate => text.includes(candidate)) || ''
  return {
    culture: top.culture,
    region: region || '',
    hits: top.hits,
    multiCandidates: found
      .slice(0, 3)
      .map(item => ({ culture: item.culture, hits: item.hits.length, evidence: item.hits.slice(0, 5) })),
  }
}

function detectGenre (text) {
  const found = detectByRules(text, GENRE_RULES, 'genre')
  return found.length > 0 ? { genre: found[0].genre, evidence: found[0].hits } : { genre: 'general', evidence: [] }
}

function detectSetting (text) {
  return detectByRules(text, SETTING_RULES, 'setting').map(item => item.setting)
}

function detectCharacters (text) {
  const characters = []
  for (const name of CHARACTER_RULES) {
    let index = 0
    let appearances = 0
    while (index < text.length) {
      const position = text.indexOf(name, index)
      if (position === -1) break
      appearances += 1
      // 修饰语前窗：取角色词前 ≤6 个非标点字符
      const before = text.slice(Math.max(0, position - 6), position).replace(/[。！？!?；;，,、：:\s]/gu, '')
      const descriptor = before ? before.slice(-4) + name : name
      if (!characters.some(c => c.name === name)) {
        characters.push({ name, descriptor, appearances })
      } else {
        const existing = characters.find(c => c.name === name)
        existing.appearances = appearances
      }
      index = position + name.length
    }
  }
  return characters
}

function detectProps (text, era) {
  const ancient = dedupe(PROP_RULES.ancient.flatMap(rule => keywordHits(text, rule.keywords)))
  const modern = dedupe(PROP_RULES.modern.flatMap(rule => keywordHits(text, rule.keywords)))
  if (era === 'ancient') return { ancient, modern: [] }
  if (era === 'modern') return { ancient: [], modern }
  return { ancient, modern }
}

function detectVisualStyle (text, dynasty) {
  // 审查 W2：朝代风格与文本显式风格词合并（朝代在前、文本词追加），不整体覆盖用户显式风格
  const found = detectByRules(text, VISUAL_STYLE_RULES, 'style')
  const textStyle = found.length > 0 ? found.map(item => item.style).join('、') : ''
  if (dynasty && dynasty.visualStyle) {
    return textStyle ? dynasty.visualStyle + '、' + textStyle : dynasty.visualStyle
  }
  return textStyle
}

function detectTone (text) {
  const found = detectByRules(text, TONE_RULES, 'tone')
  return found.length > 0 ? found[0].tone : ''
}

function detectTime (text) {
  const timeOfDay = TIME_RULES.timeOfDay.find(keyword => text.includes(keyword)) || ''
  const season = TIME_RULES.season.find(keyword => text.includes(keyword)) || ''
  return { timeOfDay, season }
}

// ---------------------------------------------------------------------------
// 历史内容增强（imagePromptSeed 种子生成，domain_enrich 合并进 scene_context，2026-08-14）
// 情感→光线三元判定独立于 detectTone（四元语气），词表自 story2video-domain.js 原样迁移。
// ---------------------------------------------------------------------------
const SENTIMENT_POSITIVE_WORDS = Object.freeze(['喜悦', '欢乐', '胜利', '成功', '和平', '美好'])
const SENTIMENT_NEGATIVE_WORDS = Object.freeze(['悲伤', '失败', '死亡', '战争', '痛苦', '灾难'])
const MODERN_SEED_VISUAL_STYLE = '现代真实场景、自然肤色、清晰构图、柔和日光'
const ANCIENT_SEED_VISUAL_STYLE = '古朴建筑、传统服饰、电影感体积光、低饱和暖色'
const NEUTRAL_SEED_VISUAL_STYLE = '具有叙事感的电影画面、自然光线、层次清晰'

// 人物外貌锚（2026-08-16 east-asian-face-anchor）：文化 → 外观 固定映射，代码常量（决策 1），
// 不扩 rules schema。用户反馈古代中国+朝鲜剧本出西方面孔：正向锚进 seed/contextBlock，
// 负面锚进 negativeAnchors 并透传出图。
const EAST_ASIAN_APPEARANCE = '东亚人面孔、黑发、黄皮肤、深色瞳'
const EAST_ASIAN_CULTURES = new Set(['中国', '日本', '韩国', '朝鲜·东北亚古国'])
const WESTERN_CULTURES = new Set(['欧洲', '美国'])
const OTHER_REGION_APPEARANCE = Object.freeze({
  印度: '南亚人面孔、棕色皮肤、深色瞳',
  阿拉伯: '阿拉伯人面孔、深色皮肤、深色瞳',
  埃及: '埃及人面孔、深色皮肤、深色瞳',
})
const FACE_NEGATIVE_ANCHORS = Object.freeze(['西方面孔', '金发', '蓝眼', '高鼻深目', '欧式五官'])
// W2：无文化命中时 strong ancient 需东亚意象线索才默认东亚锚，防止古希腊/波斯/维京/玛雅被强制东亚化
const EAST_ASIAN_CUE_GENRES = new Set(['历史', '武侠', '仙侠', '宫廷'])
// 东亚专属意象词（审查 C1）：宫殿/将军/马车/轿子/油灯/烛台等古语词非东亚专属
// （希腊宫殿、维京长船同样存在），不得作为无文化 strong ancient 的东亚化线索，
// 防止古希腊/维京/玛雅等无文化命中的古史被强制东亚化
const EAST_ASIAN_CUE_TERMS = Object.freeze(['皇帝', '剑客', '朝廷', '城墙', '科举', '江湖', '武林', '丝绸之路'])
// 现代信号词表（2026-08-30 modern-signal 中和）：从 detectEra 提升为模块级，供 detectDynasty/detectEra 复用。
// 现代题材全文出现朝代关键词（如"秦始皇""诸葛亮"）作举例/引用时，用现代信号中和，避免整篇误判为古代。
const MODERN_TERMS = Object.freeze(['手机', '电脑', '互联网', '微信', '抖音', '地铁', '高铁', '飞机', '汽车', '人工智能', '外卖', '快递', '电商', '写字楼', '电烤箱', '微波炉', '冰箱'])
// W4：场景级非东亚人物意象守卫（胡人/波斯/西方使者/古希腊/维京/玛雅等），命中则跳过正锚并移除面孔负面锚
const NON_EA_SCENE_CUE_TERMS = Object.freeze(['胡人', '波斯', '粟特', '大食', '色目', '金发', '蓝眼', '西方使者', '美国', '美军', '欧洲', '罗马', '伦敦', '巴黎', '白种', '希腊', '雅典', '斯巴达', '维京', '玛雅', '北欧'])

function containsNonEaSceneCue (text) {
  if (!text) return false
  return NON_EA_SCENE_CUE_TERMS.some(term => text.includes(term))
}

/**
 * 人物外貌正锚解析：东亚文化 → 东亚锚；印度/阿拉伯/埃及 → 当地民族面孔；
 * 欧洲/美国绝不注入；无文化命中时 strong ancient 需东亚意象线索才默认东亚锚。
 * 2026-09-13 default-appearance-anchor：中国媒体来源无文化/地域指向时默认东亚面孔，
 * 避免图片 API 训练数据偏西方导致同一文案跨场景人脸种族不一致。
 * @param {object|null} story
 * @param {string} [sceneText] 场景文本（W4 场景级守卫）
 * @returns {string} 空串 = 不注入
 */
function resolveAppearanceAnchor (story, sceneText) {
  if (!story || typeof story !== 'object') return ''
  const culture = story.culture || ''
  const era = story.era
  if (containsNonEaSceneCue(sceneText)) return ''
  if (WESTERN_CULTURES.has(culture)) return ''
  if (EAST_ASIAN_CULTURES.has(culture)) return EAST_ASIAN_APPEARANCE
  if (OTHER_REGION_APPEARANCE[culture]) return OTHER_REGION_APPEARANCE[culture]
  if (!culture && story.eraStrong === true && era === 'ancient' && story.eastAsianCue === true) return EAST_ASIAN_APPEARANCE
  // 默认外观锚（2026-09-13 default-appearance-anchor）：modern/mixed 时代无文化命中 → 默认东亚。
  // ancient 时代保持原逻辑（无 eastAsianCue 的古希腊/维京/玛雅等不得被强制东亚化，审查 C1）。
  if (!culture && (era === 'modern' || era === 'mixed')) {
    // 场景级守卫：含非东亚异域词（胡人/波斯/古希腊/维京/玛雅等）不默认
    if (!containsNonEaSceneCue(sceneText)) return EAST_ASIAN_APPEARANCE
    return ''
  }
  return ''
}

/**
 * 情感倾向三元判定（positive/negative/peaceful）。
 * 独立于 detectTone（四元语气），消费路径不同（seed 光线分支），不复用以避免行为回归（design D2）。
 * @param {string} sceneText
 * @returns {'positive'|'negative'|'peaceful'}
 */
function detectSentiment (sceneText) {
  const text = String(sceneText || '')
  if (SENTIMENT_POSITIVE_WORDS.some(word => text.includes(word))) return 'positive'
  if (SENTIMENT_NEGATIVE_WORDS.some(word => text.includes(word))) return 'negative'
  return 'peaceful'
}

/**
 * 历史内容增强种子（imagePromptSeed）模板：`文本；视觉风格；光线；无文字、主体明确`。
 * visualStyle 优先 `story.dynasty.visualStyle`（规则表 16 朝代超集），回退 era 风格（modern/ancient），
 * 再回退叙事风格；不用合并版 story.visualStyle（会多出文本显式风格词，改变 optimize 输入分布，design D3）。
 * @param {string} sceneText
 * @param {object|null} story 全局故事上下文（enabled=false 时调用方传 null 走中性风格兜底）
 * @returns {string}
 */
function buildDomainSeed (sceneText, story) {
  const text = typeof sceneText === 'string' ? sceneText.trim() : String(sceneText || '').trim()
  const storyObj = story && typeof story === 'object' ? story : {}
  const dynasty = storyObj.dynasty && typeof storyObj.dynasty === 'object' ? storyObj.dynasty : null
  const era = storyObj.era === 'modern' || storyObj.era === 'ancient' ? storyObj.era : 'mixed'
  const visualStyle = (dynasty && dynasty.visualStyle)
    || (era === 'modern' ? MODERN_SEED_VISUAL_STYLE
      : (era === 'ancient' ? ANCIENT_SEED_VISUAL_STYLE : NEUTRAL_SEED_VISUAL_STYLE))
  const sentiment = detectSentiment(text)
  const appearanceAnchor = resolveAppearanceAnchor(storyObj, text)
  return [
    text,
    visualStyle,
    sentiment === 'negative' ? '阴影与冷色氛围' : '自然层次与叙事光线',
    '无文字、主体明确',
    appearanceAnchor ? '人物形象：' + appearanceAnchor : '',
  ].filter(Boolean).join('；')
}

/**
 * 时代判定（审查 W2）：避免单关键词误判。
 * 返回 { era, strong }：strong=true 才允许注入时代负面锚点（防止「寺庙」等单信号
 * 把现代场景整篇误标古代并注入电烤箱/汽车等无关排除项）。
 * 规则：朝代命中 → strong；否则古代/现代信号各自计数，只有「≥2 个独立信号且无对立信号」
 * 才算 strong；`童话/战争` 不再硬编码为古代（弱信号）。
 * @returns {{era: string, strong: boolean}}
 */
function detectEra (text, dynasty, genre) {
  if (dynasty) {
    // 现代信号中和（2026-08-30 modern-signal，双保险）：朝代存在时，若现代信号 ≥2 且朝代命中 < 现代信号，
    // era 降级为 mixed（不注入时代负面锚点）。detectDynasty 已优先降级，此处兜底。
    const modernCount = keywordHits(text, MODERN_TERMS).length
    const dynastyHits = (dynasty.evidence && dynasty.evidence.length) || 0
    if (modernCount >= 2 && dynastyHits < modernCount) return { era: 'mixed', strong: false }
    return { era: dynasty.era, strong: true }
  }
  const ancientGenres = new Set(['历史', '武侠', '仙侠', '宫廷'])
  const modernGenres = new Set(['现代都市', '科幻'])
  const ancientTerms = ['朝廷', '皇帝', '王朝', '宫殿', '将军', '古代', '城墙', '科举', '丝绸之路', '江湖', '武林', '剑客', '寺庙', '油灯', '烛台', '马车', '轿子']
  const ancientCount = (ancientGenres.has(genre) ? 1 : 0) + keywordHits(text, ancientTerms).length
  const modernCount = (modernGenres.has(genre) ? 1 : 0) + keywordHits(text, MODERN_TERMS).length
  if (ancientCount > 0 && modernCount === 0) return { era: 'ancient', strong: ancientCount >= 2 }
  if (modernCount > 0 && ancientCount === 0) return { era: 'modern', strong: modernCount >= 2 }
  if (ancientCount > 0 && modernCount > 0) return { era: 'mixed', strong: false }
  return { era: 'mixed', strong: false }
}

function buildSummary (text, story, maxLength) {
  const prefix = joinNonEmpty([
    story.genre && story.genre !== 'general' ? story.genre : '',
    story.dynasty ? story.dynasty.period : (story.era === 'ancient' ? '古代' : story.era === 'modern' ? '现代' : ''),
    story.culture ? story.culture : '',
  ], '·')
  const content = text.replace(/[。！？!?；;]+$/u, '')
  const combined = prefix ? prefix + '的故事：' + content : content
  return truncateBySentence(combined, maxLength)
}

function buildGlobalNegativeAnchors (era, culture, strongEra, eastAsianCue) {
  const anchors = []
  // 仅时代判定 strong（朝代命中或多独立信号）时注入时代负面锚点，防止单关键词误判污染整篇（审查 W2）
  if (strongEra) {
    if (era === 'ancient') anchors.push(...NEGATIVE_ANCHOR_RULES.ancient)
    if (era === 'modern') anchors.push(...NEGATIVE_ANCHOR_RULES.modern)
    if (culture === '中国' && (era === 'ancient' || era === 'mixed')) {
      anchors.push('西方现代建筑', '西式餐具')
    }
  }
  // 面孔负面锚（C1，2026-08-16 east-asian-face-anchor）：ancient + strong 才注入，
  // 文化命中不覆盖此门（防「高句丽+手机合影」mixed 弱信号或现代题材误伤西方角色）；欧洲/美国除外。
  // 无文化命中时必须同时具备东亚意象线索（审查 C1），防止古希腊/维京/玛雅等古史被强制东亚化
  if (era === 'ancient' && strongEra && !WESTERN_CULTURES.has(culture)
      && (EAST_ASIAN_CULTURES.has(culture) || eastAsianCue)) {
    anchors.push(...FACE_NEGATIVE_ANCHORS)
  }
  return dedupe(anchors)
}

/**
 * 全局故事上下文提取（读完整文案，而非单场景文字）。
 * @param {string} fullText
 * @param {object} [options]
 * @returns {object} story
 */
function extractStoryContext (fullText, options = {}) {
  const opts = normalizeSceneContextOptions(options)
  const text = normalizeText(fullText)
  if (!text) {
    return {
      genre: 'general', era: 'mixed', eraStrong: false, dynasty: null, culture: '', region: '', setting: [],
      time: { timeOfDay: '', season: '' }, characters: [], props: { ancient: [], modern: [] },
      visualStyle: '', tone: '', summary: '', anchors: [], negativeAnchors: [],
      confidence: 0, evidence: {}, method: 'rule-based', multiCandidates: [], eastAsianCue: false,
    }
  }

  const dynasty = detectDynasty(text)
  const culture = detectCulture(text)
  const genre = detectGenre(text)
  const eraDetected = detectEra(text, dynasty, genre.genre)
  const era = eraDetected.era
  const setting = detectSetting(text)
  const characters = detectCharacters(text)
  const props = detectProps(text, era)
  const visualStyle = detectVisualStyle(text, dynasty)
  const tone = detectTone(text)
  const time = detectTime(text)
  // W2：无文化 strong ancient 的东亚锚门控线索（题材属东亚或全文命中东亚专属术语）。
  // genre 分支与术语分支统一过 W4 守卫：古代希腊/维京/玛雅等不得因 genre=历史 或
  // 宫殿/马车等非东亚专属词被强制东亚化（审查 C1）
  const eastAsianCue = (EAST_ASIAN_CUE_GENRES.has(genre.genre) || keywordHits(text, EAST_ASIAN_CUE_TERMS).length > 0)
    && !containsNonEaSceneCue(text)
  const negativeAnchors = opts.includeNegativeAnchors
    ? buildGlobalNegativeAnchors(era, culture.culture, eraDetected.strong, eastAsianCue)
    : []

  const evidence = {
    dynasty: dynasty ? dynasty.evidence : [],
    culture: culture.hits,
    genre: genre.evidence,
    props: [...props.ancient, ...props.modern],
  }

  // 一致性锚点：朝代名 + 朝代证据 + 文化 + 地域 + 场景设定（≤ maxAnchors）
  const anchors = dedupe([
    dynasty ? dynasty.name : '',
    ...(dynasty ? dynasty.evidence.slice(0, 1) : []),
    culture.culture,
    culture.region,
    ...setting.slice(0, 1),
  ]).slice(0, opts.maxAnchors)

  const summary = buildSummary(text, { genre: genre.genre, dynasty, era, culture: culture.culture }, opts.maxSummaryLength)

  const confidence = Math.max(
    dynasty ? dynasty.confidence : 0,
    culture.hits.length > 0 ? Math.min(0.95, 0.7 + culture.hits.length * 0.05) : 0,
    genre.evidence.length > 0 ? Math.min(0.9, 0.6 + genre.evidence.length * 0.05) : 0,
    0,
  )

  return {
    genre: genre.genre,
    era,
    eraStrong: eraDetected.strong,
    dynasty,
    culture: culture.culture,
    region: culture.region,
    setting,
    time,
    characters,
    props,
    visualStyle,
    tone,
    summary,
    anchors,
    negativeAnchors,
    confidence,
    evidence,
    method: 'rule-based',
    multiCandidates: culture.multiCandidates,
    eastAsianCue,
  }
}

// ---------------------------------------------------------------------------
// 逐场景上下文融合
// ---------------------------------------------------------------------------

function isCookingScene (sceneText) {
  return /做饭|烹饪|炒菜|煮饭|烧饭|厨房|灶台|煮|炊烟/u.test(sceneText)
}

/**
 * 组装单个场景的上下文块 / 一致性锚点 / 负面锚点 / 角色。
 * @param {object|string} scene
 * @param {object} story
 * @param {object} [options]
 * @returns {{contextBlock: string, anchors: string[], negativeAnchors: string[], character: (object|null)}}
 */
function buildSceneContextBlock (scene, story, options = {}) {
  const opts = normalizeSceneContextOptions(options)
  const sceneText = sceneTextOf(scene)
  if (!sceneText) {
    return { contextBlock: '', anchors: [], negativeAnchors: [], character: null }
  }
  const storyObj = story && typeof story === 'object' ? story : {}

  const sceneSetting = detectSetting(sceneText)[0] || storyObj.setting?.[0] || ''
  const eraLabel = storyObj.dynasty
    ? storyObj.dynasty.period
    : (storyObj.era === 'ancient' ? '古代' : storyObj.era === 'modern' ? '现代' : '')
  const location = joinNonEmpty([storyObj.culture, eraLabel ? eraLabel + '时期' : '', storyObj.region, sceneSetting], '')

  const cooking = isCookingScene(sceneText)
  const era = storyObj.era
  const positiveProps = cooking && era === 'ancient'
    ? COOKING_POSITIVE_PROPS.ancient
    : []

  const appearanceAnchor = resolveAppearanceAnchor(storyObj, sceneText)
  const sceneHasNonEaCue = containsNonEaSceneCue(sceneText)

  const contextBlock = truncateBySentence(joinNonEmpty([
    location ? location + '，' + sceneText : sceneText,
    storyObj.visualStyle ? '；视觉' + storyObj.visualStyle : '',
    positiveProps.length > 0 ? '；使用' + positiveProps.join('、') : '',
    storyObj.tone ? '；光线' + storyObj.tone : '',
    appearanceAnchor ? '；人物形象：' + appearanceAnchor : '',
  ], ''), opts.contextBlockMaxChars)

  let negativeAnchors = []
  if (opts.includeNegativeAnchors) {
    if (storyObj.negativeAnchors && Array.isArray(storyObj.negativeAnchors)) {
      negativeAnchors.push(...storyObj.negativeAnchors)
    }
    if (cooking) {
      if (era === 'ancient') negativeAnchors.push(...COOKING_NEGATIVE_ANCHORS.ancient)
      if (era === 'modern') negativeAnchors.push(...COOKING_NEGATIVE_ANCHORS.modern)
    }
    // W4：场景含非东亚人物意象（胡人/波斯/西方使者等）→ 移除该场景面孔负面锚，
    // 避免抑制波斯/西方角色合法的深目高鼻特征
    if (sceneHasNonEaCue) {
      const faceSet = new Set(FACE_NEGATIVE_ANCHORS)
      negativeAnchors = negativeAnchors.filter(item => !faceSet.has(item))
    }
  }

  const anchors = dedupe([
    ...(Array.isArray(storyObj.anchors) ? storyObj.anchors : []),
    sceneSetting,
  ]).slice(0, opts.maxAnchors)

  let character = storyObj.characters && Array.isArray(storyObj.characters)
    ? storyObj.characters.find(c => c && c.name && sceneText.includes(c.name)) || null
    : null
  // 打磨（2026-08-12）：场景内特有角色（未出现在全文）也从场景文本识别，descriptor 回退角色名
  if (!character) {
    const sceneRole = CHARACTER_RULES.find(name => sceneText.includes(name))
    if (sceneRole) character = { name: sceneRole, descriptor: sceneRole }
  }

  return {
    contextBlock,
    anchors,
    negativeAnchors: dedupe(negativeAnchors),
    character,
  }
}

function inferSceneType (sceneText) {
  if (!sceneText) return '常规场景'
  if (/对比|vs|而不是|相反/u.test(sceneText)) return '对比场景'
  if (/特写|细节|精致|纹理/u.test(sceneText)) return '细节场景'
  if (/全景|街道|市场|宫殿|俯瞰/u.test(sceneText)) return '全景场景'
  return '常规场景'
}

/**
 * 构造发送 prompt-engine 的 context（白名单七键，对齐服务端 build_context_section）。
 * @param {object|string} scene
 * @param {object} story
 * @param {string} [fullText]
 * @param {object} [options]
 * @returns {object}
 */
function buildPromptEngineSceneContext (scene, story, fullText = '', options = {}, block) {
  const opts = normalizeSceneContextOptions(options)
  // 审查 I1：调用方可传入已计算的 block，避免同一场景重复规则扫描
  const sceneBlock = block || buildSceneContextBlock(scene, story, opts)
  const storyObj = story && typeof story === 'object' ? story : {}
  const normalizedFullText = normalizeText(fullText)
  const fullTextChars = Array.from(normalizedFullText)
  return {
    synopsis: typeof storyObj.summary === 'string' ? storyObj.summary : '',
    // 审查 W4：full_text 设独立上限（服务端另截断 500）
    full_text: fullTextChars.length > MAX_FULL_TEXT_CHARS
      ? fullTextChars.slice(0, MAX_FULL_TEXT_CHARS).join('')
      : normalizedFullText,
    setting: sceneBlock.contextBlock || sceneTextOf(scene),
    narrative_intent: typeof storyObj.tone === 'string' ? storyObj.tone : '',
    scene_type: (scene && typeof scene === 'object' && typeof scene.sceneType === 'string' && scene.sceneType)
      ? scene.sceneType
      : inferSceneType(sceneTextOf(scene)),
    character_list: Array.isArray(storyObj.characters)
      ? storyObj.characters.slice(0, 10).map(c => ({
          name: c.name,
          ...(c.descriptor && c.descriptor !== c.name ? { descriptor: c.descriptor } : {}),
        }))
      : [],
    character: sceneBlock.character || null,
  }
}

/**
 * 单场景增强：附加 storyContext / anchors / negativeAnchors / character / context。
 * @param {object|string} scene
 * @param {object} story
 * @param {string} [fullText]
 * @param {object} [options]
 * @returns {object}
 */
function enrichSceneWithContext (scene, story, fullText = '', options = {}) {
  const opts = normalizeSceneContextOptions(options)
  const block = buildSceneContextBlock(scene, story, opts)
  const base = scene && typeof scene === 'object' ? { ...scene } : {}
  return {
    ...base,
    storyContext: block.contextBlock,
    anchors: block.anchors,
    negativeAnchors: block.negativeAnchors,
    character: block.character,
    context: buildPromptEngineSceneContext({ ...base, ...block }, story, fullText, opts, block),
  }
}

/**
 * 阶段主入口：全局故事上下文 + 逐场景增强。
 * 输入校验 fail closed（非空场景数组 + 非空文案）；规则异常由调用方降级（透传 + degraded）。
 * @param {Array} scenes
 * @param {string} fullText
 * @param {object} [options]
 * @returns {{story: object, scenes: Array, metadata: object}}
 */
function buildSceneContextResult (scenes, fullText, options = {}) {
  const opts = normalizeSceneContextOptions(options)
  // 审查 I1：禁用时直接透传（不因输入校验失败而阻断），与「禁用=透传」语义一致
  if (!opts.enabled) {
    return {
      story: null,
      scenes,
      metadata: {
        enriched: false,
        degraded: true,
        extractor: 'rule-based',
        fallbackReason: 'scene_context_disabled',
        sceneCount: Array.isArray(scenes) ? scenes.length : 0,
      },
    }
  }
  // 输入校验 fail closed（非空场景数组 + 非空文案）
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('场景上下文增强需要非空场景数组')
  }
  const text = normalizeText(fullText)
  if (!text) {
    throw new Error('场景上下文增强需要非空文案')
  }
  const story = extractStoryContext(text, opts)
  const enriched = scenes.map(scene => enrichSceneWithContext(scene, story, text, opts))
  return {
    story,
    scenes: enriched,
    metadata: {
      enriched: true,
      degraded: false,
      extractor: 'rule-based',
      confidence: story.confidence,
      sceneCount: enriched.length,
    },
  }
}

/**
 * 负面提示合并：去重、合并、按上限截断。
 * @param {string} base
 * @param {string[]} [negativeAnchors]
 * @param {number} [maxLength]
 * @returns {string}
 */
function mergeNegativePrompt (base, negativeAnchors, maxLength = 500) {
  const parts = []
  for (const item of [base, ...(Array.isArray(negativeAnchors) ? negativeAnchors : [])]) {
    const text = normalizeText(item)
    if (text) parts.push(text)
  }
  const unique = dedupe(parts)
  const joined = unique.join(', ')
  const max = integerInRange(maxLength, 1, 2000, 500)
  return Array.from(joined).length > max ? Array.from(joined).slice(0, max).join('') : joined
}

module.exports = {
  getContextRules,
  getContextRulesInfo,
  loadContextRules,
  setContextRulesOverride,
  validateContextRules,
  resetContextRules,
  COOKING_NEGATIVE_ANCHORS,
  COOKING_POSITIVE_PROPS,
  CONTEXT_KEY_WHITELIST,
  MAX_FULL_TEXT_CHARS,
  CULTURE_RULES,
  CHARACTER_RULES,
  DEFAULT_OPTIONS,
  DYNASTY_RULES,
  GENRE_RULES,
  NEGATIVE_ANCHOR_RULES,
  PROP_RULES,
  SETTING_RULES,
  TIME_RULES,
  TONE_RULES,
  VISUAL_STYLE_RULES,
  buildDomainSeed,
  buildPromptEngineSceneContext,
  buildSceneContextBlock,
  buildSceneContextResult,
  buildSummary,
  detectCulture,
  detectDynasty,
  detectEra,
  detectGenre,
  detectProps,
  detectSentiment,
  detectSetting,
  detectTime,
  detectVisualStyle,
  enrichSceneWithContext,
  extractStoryContext,
  // P1-13: 导出供回归用例直接验证登记表内容契约
  filterIdiomHits,
  inferSceneType,
  mergeNegativePrompt,
  normalizeSceneContextOptions,
  sceneTextOf,
  truncateBySentence,
}

