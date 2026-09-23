// @ts-check
/**
 * videogen-stages - animation / avatar-spokesperson / character-animation / hybrid 流水线的共享阶段执行器
 *
 * 四条流水线共用同一模式：LLM 规划（概念/脚本/分镜）→ 视频生成（配置的视频 provider，未配置则 fail closed
 * 并给出明确引导）→ FFmpeg 合成。
 *
 * 阶段类型：
 *   - videogen_concept:      主题 → LLM 创意概念/角色设定（animation / character-animation）
 *   - videogen_avatar:       校验数字人选择并生成口播文案（avatar-spokesperson）
 *   - videogen_script:       LLM 口播/解说文案（avatar-spokesperson / hybrid）
 *   - videogen_storyboard:   概念 → LLM 分镜场景数组（animation / character-animation / hybrid）
 *   - videogen_generate:     每场景调用视频 provider 的 generateVideo + 轮询 getVideoStatus + 下载
 *   - videogen_merge:        FFmpeg 拼接/合成场景视频
 *   - videogen_render:       输出最终视频（校验产物）
 *
 * 注册方式：container.setup.js 中调用 registerVideoGenStages(pipelineEngine)
 */

'use strict'

const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { findFfmpeg } = require('./media-tool-paths')
const { mapWithModelBudget, withModelBudget } = require('./model-call-scheduler')
const { segmentScript } = require('./video-script-segmentation')
const { extractKeyEntities, checkSceneAlignment, assessVisualConsistency } = require('./video-content-alignment')
const { emitStageProgress, emitStageStart, emitStageItem, emitStageComplete } = require('./stage-progress')
const { getProviderRunContext } = require('./provider-run-context')
const { resolveProviderDefaultModel } = require('./model-provider-manager')

const VIDEOGEN_STAGE_TYPES = {
  CONCEPT: 'videogen_concept',
  AVATAR: 'videogen_avatar',
  SCRIPT: 'videogen_script',
  STORYBOARD: 'videogen_storyboard',
  GENERATE: 'videogen_generate',
  MERGE: 'videogen_merge',
  RENDER: 'videogen_render',
}

const MAX_SCENES = 12
const DEFAULT_SCENE_SECONDS = 5
const DEFAULT_NUM_FRAMES = 121

// 分镜双模式（video-content-fidelity）：
//   creative — 一句话/短创意由 LLM 自由拓展（原始机制，零新增约束）
//   fidelity — 按原文保真：人物/事件/时代/核心论点不得改变，关键事件必须有场景
//   hybrid   — 保真主旨 + 允许可视化演绎（镜头/氛围）
//   auto     — 按输入特征自动判定（段落≥3 或字≥300 或句≥8 → fidelity；字≤80 且句≤2 → creative；其余 hybrid）
const STORYBOARD_MODES = Object.freeze(['creative', 'fidelity', 'hybrid', 'auto'])
const FIDELITY_MODES = Object.freeze(['fidelity', 'hybrid'])
const AUTO_FIDELITY_MIN_CHARS = 300
const AUTO_FIDELITY_MIN_SENTENCES = 8
const AUTO_FIDELITY_MIN_PARAGRAPHS = 3
const AUTO_CREATIVE_MAX_CHARS = 80
const AUTO_CREATIVE_MAX_SENTENCES = 2
const STORYBOARD_ALIGNMENT_MAX_RETRIES = 2
const STORYBOARD_ALIGNMENT_MIN_COVERAGE = 0.8
const MAX_STORYBOARD_INJECT_CHARS = 6000

// 默认 LLM 输出预算：普通模型 1600；推理型模型会把 <think> 思考过程算进输出，
// 在默认预算下会导致概念/分镜的 JSON 被截断（如 MiniMax-M3 实测 2000 tokens 仍截断、
// parseJsonArray 返回 null 阶段失败），命中推理特征时自动放大到 REASONING_LLM_MAX_TOKENS。
const DEFAULT_LLM_MAX_TOKENS = 1600
const REASONING_LLM_MAX_TOKENS = 5000

/**
 * 推理型 LLM 模型标识（model id 小写后命中任一特征即视为推理型）。
 * 与 adapters/* 的 stripThinkingBlocks 配套：识别后放大 max_tokens，
 * 给思考块留足预算，确保概念/分镜输出完整 JSON。
 */
const REASONING_MODEL_PATTERNS = [
  'reasoner', // deepseek-reasoner / kimi-reasoner / gpt-o* 等
  'deepseek-v4', // deepseek-v4-pro / deepseek-v4-flash（推理型）
  'minimax-m3', 'minimax-m2.7', 'minimax-m2', 'm3', // MiniMax M 系列
  'kimi-k2.8', 'kimi-k2.7', 'kimi-k2.6', 'kimi-r1', // Moonshot 长思考/推理
  'o1', 'o3', 'o4', 'o5', // OpenAI 推理系列（o3-mini 等）
  'r1', 'r2', // DeepSeek-R1 / Kimi-R1 等
  'think', // gemini-flash-thinking / glm-4.5-thinking / qwen3-thinking 等
]

function isReasoningLlmModel (modelId) {
  const id = String(modelId || '').trim().toLowerCase()
  if (!id) return false
  return REASONING_MODEL_PATTERNS.some(pattern => id.includes(pattern))
}

function getAiGenerator (pipelineEngine) {
  return pipelineEngine.aiGenerator ||
    (pipelineEngine.container && typeof pipelineEngine.container.get === 'function'
      ? pipelineEngine.container.get('aiGenerator')
      : null)
}

function getLlmConfig (aiGenerator) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  const provider = manager && typeof manager.getDefault === 'function'
    ? manager.getDefault('llm')
    : null
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
  // 双默认语义（2026-08-27）：用户默认 > 运营默认 > capability_models.llm > models[0]
  const model = resolveProviderDefaultModel(provider, 'llm')
  return model ? { providerId: provider.id.trim(), model } : null
}

function getVideoProviderConfig (aiGenerator) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  const provider = manager && typeof manager.getDefault === 'function'
    ? manager.getDefault('video')
    : null
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
  // 双默认语义（2026-08-27）：用户默认 > 运营默认 > capability_models.video > models[0]
  const model = resolveProviderDefaultModel(provider, 'video')
  return { providerId: provider.id.trim(), model: model || '' }
}

async function callDefaultLlm (aiGenerator, systemPrompt, userContent, maxTokens, runtimeOptions) {
  if (!aiGenerator || typeof aiGenerator.generateWithDefault !== 'function') {
    throw new Error('默认 LLM 不可用，请先完成模型设置')
  }
  const llmConfig = getLlmConfig(aiGenerator)
  if (!llmConfig) {
    throw new Error('未找到需要的相关模型，请在设置中添加模型')
  }
  // 显式 maxTokens 优先；未指定时推理型模型自动放大预算，避免思考块截断 JSON
  const effectiveMaxTokens = Number.isFinite(maxTokens)
    ? maxTokens
    : (isReasoningLlmModel(llmConfig.model) ? REASONING_LLM_MAX_TOKENS : DEFAULT_LLM_MAX_TOKENS)
  const result = await aiGenerator.generateWithDefault('llm', {
    temperature: 0.7,
    max_tokens: effectiveMaxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  }, undefined, runtimeOptions)
  const content = result && typeof result.content === 'string' ? result.content.trim() : ''
  if (!content) throw new Error('默认 LLM 返回空内容')
  return content
}

function parseJsonArray (text) {
  const source = String(text || '').trim()
  if (!source) return null
  try {
    const parsed = JSON.parse(source)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') {
      const arr = Object.values(parsed).find(Array.isArray)
      if (arr) return arr
    }
  } catch { /* fallthrough */ }
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(source.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch { /* fallthrough */ }
  }
  return null
}


/** 场景时长（秒）→ 满足 8n+1 规则的帧数档位（24fps 近似），让 storyboard duration 真正作用于生成参数 */
function pickFrameCountForDuration (durationSeconds) {
  const d = Number(durationSeconds)
  if (!Number.isFinite(d) || d <= 0) return DEFAULT_NUM_FRAMES
  if (d <= 5) return 121
  if (d <= 8) return 201 // 8*25+1 ≈ 8.4s@24fps
  if (d <= 10) return 241 // 8*30+1 ≈ 10s@24fps
  return 441
}
/**
 * 分镜模式判定（video-content-fidelity S1）。
 * 显式 storyboardMode 优先；auto 按输入特征：段落≥3 或字≥300 或句≥8 → fidelity；
 * 字≤80 且句≤2 → creative；其余 hybrid。
 * @param {unknown} text
 * @param {unknown} explicitMode
 * @returns {{ mode: 'creative'|'fidelity'|'hybrid', reason: string, requested?: string }}
 */
function resolveStoryboardMode (text, explicitMode) {
  const requested = typeof explicitMode === 'string' ? explicitMode.trim().toLowerCase() : ''
  if (STORYBOARD_MODES.includes(requested) && requested !== 'auto') {
    return { mode: requested, reason: 'explicit:' + requested, requested }
  }
  const source = String(text || '').trim()
  const charCount = Array.from(source).length
  const sentenceCount = source.split(/[。！？!?；;]/).filter(s => s.trim()).length
  const paragraphCount = source.split(/\n\s*\n|\n+/).map(s => s.trim()).filter(Boolean).length

  if (paragraphCount >= AUTO_FIDELITY_MIN_PARAGRAPHS ||
      charCount >= AUTO_FIDELITY_MIN_CHARS ||
      sentenceCount >= AUTO_FIDELITY_MIN_SENTENCES) {
    return {
      mode: 'fidelity',
      reason: 'auto:fidelity(chars=' + charCount + ',sentences=' + sentenceCount + ',paragraphs=' + paragraphCount + ')',
    }
  }
  if (charCount <= AUTO_CREATIVE_MAX_CHARS && sentenceCount <= AUTO_CREATIVE_MAX_SENTENCES) {
    return { mode: 'creative', reason: 'auto:creative(chars=' + charCount + ',sentences=' + sentenceCount + ')' }
  }
  return { mode: 'hybrid', reason: 'auto:hybrid(chars=' + charCount + ',sentences=' + sentenceCount + ',paragraphs=' + paragraphCount + ')' }
}

/**
 * 解析 LLM 输出的 JSON 对象（支持 markdown 围栏与对象内嵌）。
 * @param {string} text
 * @returns {object | null}
 */
function parseJsonObject (text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  if (!source) return null
  try {
    const parsed = JSON.parse(source)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch { /* fallthrough */ }
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(source.slice(start, end + 1))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* fallthrough */ }
  }
  return null
}

function buildConceptPrompt (topic, kind, mode) {
  const kindLabel = { animation: '动画视频', 'character-animation': '角色动画' }[kind] || kind
  const effectiveMode = FIDELITY_MODES.includes(mode) ? mode : 'creative'
  if (effectiveMode === 'creative') {
    return {
      system: `你是资深${kindLabel}策划。根据主题输出创意概念：角色设定（2-4 个要点）、视觉风格（一句）、故事钩子（一句）。只输出 JSON 对象 {"role_design": "每个角色的独立视觉特征（年龄/发型/面部/服饰/体型），用 | 分隔多角色", "characters": [{"name": "角色名", "visual": "独立视觉特征标签（年龄/发型/面部/服饰，确保多角色可区分）"}], "visual_style": "...", "hook": "..."}，不要多余文字。

【多角色视觉差异化】当场景中出现多个角色时，每个角色必须有独立且可区分的视觉特征标签（年龄差异、发型差异、面部特征差异、服饰差异、体型差异）。禁止多个角色使用相同的面部描述。这是视频画面中区分不同角色的唯一依据。

【文化地域锚定·最高优先级】必须从主题推断时代背景、文化地域与人种，并显式写入每个角色的 visual 标签与 visual_style。例如中国古代（东汉/三国）题材必须写"中国古代汉族男性，束发髻，汉式服饰/铠甲"；禁止西方人种特征（金发、碧眼、高鼻深目、西方面孔）、禁止西方服饰（西式盔甲、西装、欧式宫廷装）。这是防止视频模型生成错误人种的唯一依据。

【最高优先级约束】视频画面严禁出现文字/字幕/水印/标志。每个视觉描述末尾必须附加: clean frame, no text, no subtitles, no watermarks, no logos。`,
      user: '主题：' + String(topic || '').trim(),
    }
  }
  // fidelity / hybrid：硬保真约束 + 关键事实/实体提取
  const hybridLine = effectiveMode === 'hybrid' ? '5. 允许合理可视化演绎：可补充镜头语言/氛围，但不得改变事实与主旨。\n' : ''
  return {
    system: `你是资深${kindLabel}策划。用户提供了完整文案，你需要按原文内容设计视频概念。
硬性要求：
1. 忠实原文——不得虚构或篡改与原文矛盾的情节、人物、事件；
2. 不得改变人物身份、时代背景、文化地域与核心论点；
3. 提取原文关键事实（key_facts）与关键实体（entities：人物/事件/地点/作品等）；
4. 视觉风格应服务于原文基调，不得整体偏离。
5. 【文化地域锚定·最高优先级】必须从原文推断时代背景(era)、文化地域(culture)与人种，并显式写入每个角色的 visual 标签与 visual_style。例如中国古代（东汉/三国）题材必须写"中国古代汉族男性，束发髻，汉式服饰/铠甲"；禁止西方人种特征（金发、碧眼、高鼻深目、西方面孔）、禁止西方服饰（西式盔甲、西装、欧式宫廷装）。这是防止视频模型生成错误人种的唯一依据。
${hybridLine}只输出 JSON 对象 {"role_design": "每个角色的独立视觉特征（年龄/发型/面部/服饰/体型），用 | 分隔多角色", "characters": [{"name": "角色名", "visual": "独立视觉特征标签（年龄/发型/面部/服饰，确保多角色可区分）"}], "visual_style": "...", "hook": "...", "key_facts": ["..."], "entities": ["..."], "mode": "${effectiveMode}"}，不要多余文字。`,
    user: '主题（完整文案）：' + String(topic || '').trim(),
  }
}

/**
 * 构造视频提示词优化的 context（video-content-fidelity S4）。
 * 键与 prompt-engine OptimizeRequest.context 白名单一致（synopsis/character/setting/character_list/full_text）。
 * @param {object} concept
 * @param {Array<{index:number, text:string}>} [paragraphs]
 * @returns {object | undefined}
 */
function buildVideoOptimizeContext (concept, paragraphs) {
  const ctx = {}
  const conceptObj = concept && typeof concept === 'object' ? concept : {}
  const entities = Array.isArray(conceptObj.entities) ? conceptObj.entities.filter(e => typeof e === 'string') : []
  const keyFacts = Array.isArray(conceptObj.key_facts) ? conceptObj.key_facts.filter(f => typeof f === 'string') : []

  const synopsis = [
    typeof conceptObj.hook === 'string' ? conceptObj.hook : '',
    ...keyFacts.slice(0, 3),
  ].filter(Boolean).join('；').slice(0, 500)
  if (synopsis) ctx.synopsis = synopsis

  if (typeof conceptObj.role_design === 'string' && conceptObj.role_design.trim()) {
    ctx.character = conceptObj.role_design.trim().slice(0, 500)
  }
  if (entities.length > 0) ctx.character_list = entities.slice(0, 10)
  if (typeof conceptObj.visual_style === 'string' && conceptObj.visual_style.trim()) {
    ctx.setting = conceptObj.visual_style.trim().slice(0, 500)
  }

  const fullText = Array.isArray(paragraphs)
    ? paragraphs.map(p => p.text).join('\n').slice(0, 2000)
    : ''
  if (fullText.trim()) ctx.full_text = fullText

  return Object.keys(ctx).length > 0 ? ctx : undefined
}

function buildStoryboardPrompt (concept, kind, options = {}) {
  const style = typeof concept === 'string' ? concept : (concept && concept.visual_style) || '动态视觉'
  const mode = FIDELITY_MODES.includes(options.mode) ? options.mode : 'creative'
  if (mode === 'creative') {
    return {
      system: `你是分镜导演。把创意概念拆分为 ${MAX_SCENES} 个以内视频场景。输出严格 JSON 数组，每个元素 {"prompt": "画面提示词（主体/动作/构图/光线/风格，供视频生成模型直接使用）", "text": "解说文案", "duration": 4-8 秒整数}。只输出 JSON，不要其他文字。

【最高优先级约束】每个场景的 prompt 字段末尾必须附加: clean frame, no text, no subtitles, no watermarks, no logos。严禁视频画面生成任何文字/字幕/水印伪影。

【多角色视觉锚定】当场景中出现多个角色时，每个角色的 prompt 必须包含其独立视觉特征标签（来自概念阶段的 characters 数组）。格式示例: "Character A: [老者，白须，红袍] standing next to Character B: [年轻将领，黑发短寸，蓝甲]"。禁止省略角色视觉标签——这是视频模型区分不同角色的唯一依据。

【文化锚定·最高优先级】每个场景的 prompt 必须显式包含时代背景、文化地域与人种锚定（来自概念阶段的 era/culture/visual_style），例如中国古代题材必须写 "ancient Chinese (Eastern Han dynasty), East Asian Han Chinese faces, period-appropriate Hanfu and armor"。禁止金发碧眼、西方面孔、西方服饰出现在画面中。`,
      user: '创意概念与视觉风格：' + String(style || concept || '').slice(0, 2000),
    }
  }
  // fidelity / hybrid：注入分段文案全文 + key_facts/entities，要求 source_paras 绑定
  const paragraphs = Array.isArray(options.paragraphs) ? options.paragraphs : []
  const keyFacts = Array.isArray(options.keyFacts) ? options.keyFacts : []
  const entities = Array.isArray(options.entities) ? options.entities : []
  const paragraphText = paragraphs.map(p => '[' + p.index + '] ' + String(p.text || '').slice(0, MAX_STORYBOARD_INJECT_CHARS)).join('\n')
  const user = [
    '创意概念与视觉风格：' + String(style || concept || '').slice(0, 2000),
    '原文分段（共 ' + paragraphs.length + ' 段）：',
    paragraphText.slice(0, MAX_STORYBOARD_INJECT_CHARS),
    keyFacts.length > 0 ? '关键事实：' + keyFacts.join('；').slice(0, 1500) : '',
    entities.length > 0 ? '关键实体：' + entities.join('、').slice(0, 1500) : '',
    options.retryHint ? '补充要求：' + options.retryHint : '',
  ].filter(Boolean).join('\n')
  return {
    system: `你是分镜导演。把创意概念拆分为 ${MAX_SCENES} 个以内视频场景。输出严格 JSON 数组，每个元素 {"prompt": "画面提示词（主体/动作/构图/光线/风格，供视频生成模型直接使用）", "text": "解说文案", "duration": 4-8 秒整数, "source_paras": [对应原文段落索引数组]}。
硬性要求：
1. 忠实原文——不得虚构或篡改与原文矛盾的情节、人物、事件；
2. 不得改变人物身份、时代背景、文化地域与核心论点；
3. 每个场景必须标注 source_paras（绑定原文段落索引）；
4. 文案描述的关键事件（关键实体中的事件）必须有专属场景；
5. 【文化锚定·最高优先级】每个场景的 prompt 必须显式包含时代背景、文化地域与人种锚定（来自概念阶段的 era/culture/visual_style），例如中国古代题材必须写 "ancient Chinese (Eastern Han dynasty), East Asian Han Chinese faces, period-appropriate Hanfu and armor"。禁止金发碧眼、西方面孔、西方服饰出现在画面中。
6. 只输出 JSON 数组，不要其他文字。

【多角色视觉锚定】当场景中出现多个角色时，每个角色的 prompt 必须包含其独立视觉特征标签（来自概念阶段的 characters 数组）。格式: "Character A: [视觉标签] ... Character B: [视觉标签] ..."。禁止省略角色视觉标签——这是视频模型区分不同角色的唯一依据。`,
    user,
  }
}

function buildScriptPrompt (topic, kind) {
  const kindLabel = { 'avatar-spokesperson': '数字人口播', hybrid: '混合视频' }[kind] || kind
  return {
    system: `你是${kindLabel}文案作者。根据主题撰写一段 100-200 字的口播文案，口语化、逻辑连贯、适合配音。只输出文案本身。`,
    user: '主题：' + String(topic || '').trim(),
  }
}

function runTool (binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).slice(0, 1200)))
      else resolve(String(stdout) + '\n' + String(stderr))
    })
  })
}

function getRunDir (runId) {
  return path.join(os.tmpdir(), 'story2video', 'videogen', String(runId || 'run'))
}

/**
 * 从 context 中按候选键取第一个非空值。
 * 不同 videogen 流水线把前序阶段输出写入各自的阶段名
 * （animation→concept/storyboard；character-animation→character_design/rigging；
 *  hybrid→plan/generate；avatar→avatar_select/script），统一解析避免读取固定键。
 */
function firstContextValue (context, keys) {
  if (!context || typeof context !== 'object') return undefined
  for (const key of keys) {
    const value = context[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function resolveVideogenConcept (context) {
  const value = firstContextValue(context, ['concept', 'character_design', 'plan', 'avatar_select', 'script'])
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') {
    const extracted = value.concept || value.script || value.topic
    if (typeof extracted === 'string') return extracted.trim()
    // 概念可能是对象（如 { visual_style, hook }），storyboard 提示词构建兼容对象
    if (extracted && typeof extracted === 'object') return extracted
    return ''
  }
  return ''
}

function resolveVideogenScenes (context) {
  const value = firstContextValue(context, ['storyboard', 'rigging', 'generate', 'scenes', 'plan'])
  return Array.isArray(value) ? value : null
}

async function downloadToFile (url, dest) {
  const http = require('http')
  const https = require('https')
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https:') ? https : http
    const file = fs.createWriteStream(dest)
    const request = lib.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadToFile(response.headers.location, dest).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error('视频下载失败，HTTP ' + response.statusCode))
        return
      }
      response.pipe(file)
      file.on('finish', () => file.close(() => resolve(dest)))
    })
    request.on('error', (error) => { fs.unlinkSync(dest); reject(error) })
  })
}

/**
 * 注册 video-gen 类流水线的共享阶段执行器
 * @param {object} pipelineEngine
 * @returns {{success: boolean, error?: string, registered?: string[]}}
 */
function registerVideoGenStages (pipelineEngine) {
  if (!pipelineEngine || !pipelineEngine.stageExecutor) {
    return { success: false, error: 'PipelineEngine.stageExecutor not configured (ServiceBus missing)' }
  }
  const registered = []
  const log = pipelineEngine.log

  // CONCEPT - 主题 → 创意概念/角色设定（video-content-fidelity：双模式 + 事实/实体提取）
  pipelineEngine.registerStageExecutor(
    VIDEOGEN_STAGE_TYPES.CONCEPT,
    async ({ stage, params, context, onProgress }) => {
      emitStageStart(onProgress, { messageKey: 'stageProgress.videogenConcept' })
      const aiGenerator = getAiGenerator(pipelineEngine)
      if (!aiGenerator) return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
      const providerRunContext = getProviderRunContext(context || {})
      const topic = typeof params.text === 'string' ? params.text.trim() : ''
      if (!topic) return { success: false, error: '该流水线需要非空主题（params.text）' }
      const modeInfo = resolveStoryboardMode(topic, params.storyboardMode || (stage.options && stage.options.storyboardMode))
      const fidelity = FIDELITY_MODES.includes(modeInfo.mode)
      const { system, user } = buildConceptPrompt(topic, stage.kind || 'animation', modeInfo.mode)
      try {
        let raw = await callDefaultLlm(aiGenerator, system, user, undefined, { providerRunContext })
        let concept = fidelity ? parseJsonObject(raw) : (parseJsonArray(raw) && parseJsonArray(raw)[0] || raw)
        // fidelity/hybrid：key_facts/entities 缺失时重试一次（CONCEPT_FACTS_MISSING 兜底）
        if (fidelity) {
          if (!concept || !Array.isArray(concept.key_facts) || !Array.isArray(concept.entities)) {
            raw = await callDefaultLlm(aiGenerator, system, user, undefined, { providerRunContext })
            concept = parseJsonObject(raw)
          }
          if (!concept || !Array.isArray(concept.key_facts) || !Array.isArray(concept.entities)) {
            return {
              success: false,
              error: 'concept 未提取关键事实/实体（key_facts/entities 缺失）',
              errorCode: 'CONCEPT_FACTS_MISSING',
            }
          }
          concept.mode = concept.mode || modeInfo.mode
        }
        emitStageComplete(onProgress, { messageKey: 'stageProgress.videogenConceptComplete', summaryKey: 'stageProgress.videogenConceptSummary' })
        return { success: true, output: { concept, topic, storyboardMode: modeInfo.mode, modeReason: modeInfo.reason } }
      } catch (error) {
        return { success: false, error: 'concept 失败：' + (error && error.message ? error.message : String(error)) }
      }
    },
  )
  registered.push(VIDEOGEN_STAGE_TYPES.CONCEPT)


  // AVATAR - 数字人选择校验 + 口播文案（avatar-spokesperson）
  pipelineEngine.registerStageExecutor(
    VIDEOGEN_STAGE_TYPES.AVATAR,
    async ({ stage, params, context, onProgress }) => {
      emitStageStart(onProgress, { messageKey: 'stageProgress.videogenAvatar' })
      const providerRunContext = getProviderRunContext(context || {})
      const aiGenerator = getAiGenerator(pipelineEngine)
      if (!aiGenerator) return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
      const topic = typeof params.text === 'string' ? params.text.trim() : ''
      if (!topic) return { success: false, error: 'avatar-spokesperson 需要非空主题（params.text）' }
      const avatarId = params.avatarId || stage.options?.avatarId || ''
      const { system, user } = buildScriptPrompt(topic, 'avatar-spokesperson')
      try {
        const script = await callDefaultLlm(aiGenerator, system, user, undefined, { providerRunContext })
        emitStageComplete(onProgress, { messageKey: 'stageProgress.videogenAvatarComplete', summaryKey: 'stageProgress.videogenAvatarSummary' })
        return { success: true, output: { script, avatarId, topic } }
      } catch (error) {
        return { success: false, error: 'avatar 阶段失败：' + (error && error.message ? error.message : String(error)) }
      }
    },
  )
  registered.push(VIDEOGEN_STAGE_TYPES.AVATAR)

  // SCRIPT - 文案（hybrid）
  pipelineEngine.registerStageExecutor(
    VIDEOGEN_STAGE_TYPES.SCRIPT,
    async ({ stage, params, context, onProgress }) => {
      emitStageStart(onProgress, { messageKey: 'stageProgress.videogenScript' })
      const providerRunContext = getProviderRunContext(context || {})
      const aiGenerator = getAiGenerator(pipelineEngine)
      if (!aiGenerator) return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
      const topic = typeof params.text === 'string' ? params.text.trim() : ''
      if (!topic) return { success: false, error: '该流水线需要非空主题（params.text）' }
      const { system, user } = buildScriptPrompt(topic, 'hybrid')
      try {
        const script = await callDefaultLlm(aiGenerator, system, user, undefined, { providerRunContext })
        emitStageComplete(onProgress, { messageKey: 'stageProgress.videogenScriptComplete', summaryKey: 'stageProgress.videogenScriptSummary' })
        return { success: true, output: script }
      } catch (error) {
        return { success: false, error: 'script 失败：' + (error && error.message ? error.message : String(error)) }
      }
    },
  )
  registered.push(VIDEOGEN_STAGE_TYPES.SCRIPT)

  // STORYBOARD - 概念 → 分镜场景数组（video-content-fidelity：段落化 + 保真注入 + 对齐门禁）
  pipelineEngine.registerStageExecutor(
    VIDEOGEN_STAGE_TYPES.STORYBOARD,
    async ({ stage, context, onProgress }) => {
      emitStageStart(onProgress, { messageKey: 'stageProgress.videogenStoryboard' })
      const providerRunContext = getProviderRunContext(context || {})
      const aiGenerator = getAiGenerator(pipelineEngine)
      if (!aiGenerator) return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
      const concept = resolveVideogenConcept(context)
      if (!concept) return { success: false, error: '该流水线 storyboard 需要前序概念或文案（context.concept/character_design/plan/script）' }

      const conceptBox = context.concept && typeof context.concept === 'object' ? context.concept : {}
      const mode = FIDELITY_MODES.includes(conceptBox.storyboardMode) ? conceptBox.storyboardMode : 'creative'
      const keyFacts = Array.isArray(conceptBox.key_facts) ? conceptBox.key_facts.filter(f => typeof f === 'string') : []
      const entities = Array.isArray(conceptBox.entities) ? conceptBox.entities.filter(e => typeof e === 'string') : []
      // 原文：优先 context.params.text，其次 CONCEPT 输出 topic
      const fullText = String(
        (context.params && typeof context.params.text === 'string' && context.params.text.trim()) ||
        (typeof conceptBox.topic === 'string' && conceptBox.topic.trim()) ||
        '',
      ).trim()
      const paragraphs = mode === 'creative' ? [] : (fullText ? segmentScript(fullText).paragraphs : [])

      const alignmentConfig = {
        enabled: true,
        minCoverage: STORYBOARD_ALIGNMENT_MIN_COVERAGE,
        maxRetries: STORYBOARD_ALIGNMENT_MAX_RETRIES,
        llmExtractFallback: true,
      }
      try {
        const cfg = (context.config && context.config.videoContentFidelity) || {}
        if (typeof cfg.enabled === 'boolean') alignmentConfig.enabled = cfg.enabled
        if (Number.isFinite(Number(cfg.minCoverage))) {
          alignmentConfig.minCoverage = Math.min(1, Math.max(0, Number(cfg.minCoverage)))
        }
        if (Number.isFinite(Number(cfg.maxRetries))) {
          alignmentConfig.maxRetries = Math.min(5, Math.max(0, Math.floor(Number(cfg.maxRetries))))
        }
        if (typeof cfg.llmExtractFallback === 'boolean') alignmentConfig.llmExtractFallback = cfg.llmExtractFallback
      } catch (_) { /* 配置异常走默认 */ }

      const extractLlm = alignmentConfig.llmExtractFallback && fullText
        ? async (system, user) => callDefaultLlm(aiGenerator, system, user, 2000, { providerRunContext })
        : null

      let scenes = null
      let report = {
        mode,
        enabled: alignmentConfig.enabled,
        coverage: 0,
        matched: [],
        missing: [],
        retries: 0,
        truncated: false,
        paragraphCount: paragraphs.length,
        entityCount: 0,
        assessVisual: assessVisualConsistency(),
      }
      const maxAttempts = alignmentConfig.enabled ? 1 + alignmentConfig.maxRetries : 1
      let attempt = 0
      let retryHint = ''
      let lastError = ''

      while (attempt < maxAttempts) {
        attempt++
        const { system, user } = buildStoryboardPrompt(concept, stage.kind || 'animation', {
          mode,
          paragraphs,
          keyFacts,
          entities,
          retryHint,
        })
        let raw
        try {
          // fidelity/hybrid 注入分段全文 + source_paras，输出体积显著大于 creative：显式放大输出预算
          const storyboardMaxTokens = mode === 'creative' ? undefined : 8000
          raw = await callDefaultLlm(aiGenerator, system, user, storyboardMaxTokens, { providerRunContext })
        } catch (error) {
          lastError = error && error.message ? error.message : String(error)
          break
        }
        const parsed = parseJsonArray(raw)
        if (!Array.isArray(parsed) || parsed.length === 0) {
          // JSON 解析失败：视为一次无效输出，带提示重试（fidelity 模式输出更长更易截断/格式漂移）
          if (attempt < maxAttempts) {
            retryHint = '上次输出不是合法 JSON 数组（可能被截断或含多余文字），请只输出严格 JSON 数组，不要任何其他文字'
            log.info('VideoGenStages', '故事板 JSON 解析失败，重试 ' + attempt + '/' + (maxAttempts - 1))
            continue
          }
          lastError = 'storyboard 无法解析场景 JSON'
          break
        }
        const normalized = parsed.slice(0, MAX_SCENES).map((s, i) => ({
          index: i,
          prompt: typeof s === 'string' ? s : (s.prompt || s.text || ''),
          text: typeof s === 'string' ? '' : (s.text || ''),
          duration: Number(s.duration) >= 4 ? Number(s.duration) : DEFAULT_SCENE_SECONDS,
          ...(s && typeof s === 'object' && Array.isArray(s.source_paras) ? { source_paras: s.source_paras } : {}),
        }))
        if (!alignmentConfig.enabled) {
          scenes = normalized
          report = { ...report, retries: attempt - 1, truncated: false }
          break
        }
        // 对齐门禁：实体抽取 + 覆盖度校验
        const extraction = await extractKeyEntities(fullText, {
          llmExtractFallback: alignmentConfig.llmExtractFallback,
          extractLlm,
        })
        const check = checkSceneAlignment(normalized, extraction.entities, alignmentConfig.minCoverage)
        report = {
          ...report,
          coverage: check.coverage,
          matched: check.matched,
          missing: check.missing,
          entityCount: check.entityCount,
          retries: attempt - 1,
          truncated: false,
        }
        if (check.pass) {
          scenes = normalized
          break
        }
        if (attempt < maxAttempts && check.missing.length > 0) {
          retryHint = '上次分镜未覆盖以下关键内容，请补充对应场景：' + check.missing.join('、')
          log.info('VideoGenStages', '故事板对齐不足，重试 ' + attempt + '/' + (maxAttempts - 1) + ' missing=' + check.missing.join('、'))
          continue
        }
        lastError = '视频分镜未覆盖文案关键内容：' + check.missing.join('、') + '（已重试 ' + (attempt - 1) + ' 次）'
        break
      }

      if (!scenes) {
        const errorCode = lastError.indexOf('无法解析') !== -1 ? 'STORYBOARD_EMPTY_SCENES' : 'STORYBOARD_ALIGNMENT_FAILED'
        return { success: false, error: lastError || 'storyboard 失败', errorCode }
      }

      // 对齐报告写入 run 上下文（video-content-fidelity S5）
      try {
        context.videoContentFidelity = { ...report, truncated: false }
      } catch (_) { /* 上下文不可写时忽略 */ }
      emitStageComplete(onProgress, {
        messageKey: 'stageProgress.videogenStoryboardComplete',
        summaryKey: 'stageProgress.videogenStoryboardSummary',
        summaryParams: { count: scenes.length },
      })
      return { success: true, output: scenes }
    },
  )
  registered.push(VIDEOGEN_STAGE_TYPES.STORYBOARD)


  // GENERATE - 视频生成（provider 门控）
  pipelineEngine.registerStageExecutor(
    VIDEOGEN_STAGE_TYPES.GENERATE,
    async ({ runId, stage, params, context, serviceBus, onProgress }) => {
      emitStageStart(onProgress, { messageKey: 'stageProgress.videogenGenerateStart' })
      const providerRunContext = getProviderRunContext(context || {})
      const scenes = resolveVideogenScenes(context) || []
      const prompts = scenes.length > 0 ? scenes.map(s => s.prompt) : [params.text || '']
      if (!prompts[0]) return { success: false, error: '该流水线 generate 需要场景提示词或主题' }
      const aiGenerator = getAiGenerator(pipelineEngine)
      const manager = aiGenerator && aiGenerator._modelProviderManager
      const videoProvider = getVideoProviderConfig(aiGenerator)
      if (!videoProvider || !manager || typeof manager.callAdapter !== 'function') {
        return {
          success: false,
          error: '该流水线需要视频生成模型（如 Agnes Video / CogVideo / Runway / Kling / Veo 等），请在设置中配置并启用视频生成模型后重试',
          errorCode: 'VIDEO_MODEL_NOT_CONFIGURED',
        }
      }
      // 视频提示词统一走 prompt-engine（domain=video）——videogen_generate 前批量优化。
      // 8013 未运行/未注入 PromptBridge 时明确失败，不静默回退（spec video-prompt-engine: 视频提示词统一经 prompt-engine 优化）。
      const bus = serviceBus || pipelineEngine.serviceBus
      if (bus && typeof bus.optimizeVideoPromptsBatch === 'function') {
        try {
          // prompt-engine 批量接口单次上限 20 条（BatchOptimizeRequest.max_length=20，2026-08-12 由 10 上调）：
          // storyboard 上限 MAX_SCENES=12 可单批通过；>20 极端场景仍分块（≤20）后按序合并，保持全量 fail-closed 校验。
          const CHUNK_SIZE = 20
          const optResults = []
          // video-content-fidelity S4：把文案摘要/实体通过 context 透传给 prompt-engine
          const conceptBox = context && context.concept && typeof context.concept === 'object' ? context.concept : {}
          const fullTextForContext = String(
            (context && context.params && typeof context.params.text === 'string' && context.params.text.trim()) ||
            (typeof conceptBox.topic === 'string' && conceptBox.topic.trim()) ||
            '',
          ).trim()
          const paragraphsForContext = fullTextForContext ? segmentScript(fullTextForContext).paragraphs : []
          const optimizeContext = buildVideoOptimizeContext(conceptBox, paragraphsForContext)
          for (let start = 0; start < prompts.length; start += CHUNK_SIZE) {
            const chunk = prompts.slice(start, start + CHUNK_SIZE)
            const part = await bus.optimizeVideoPromptsBatch(chunk, {
              platform: videoProvider.providerId || undefined,
              // model 供语言路由兜底（通用网关 provider 场景按模型名判定 zh/en）；仅字符串透传
              ...(typeof videoProvider.model === 'string' && videoProvider.model ? { model: videoProvider.model } : {}),
              ...(optimizeContext ? { context: optimizeContext } : {}),
              ...(stage.options && stage.options.optimize ? stage.options.optimize : {}),
              providerRunContext,
            })
            if (!Array.isArray(part)) {
              return {
                success: false,
                error: '视频提示词优化结果数量与场景不一致（expected ' + chunk.length + ', got 非法响应）',
              }
            }
            optResults.push(...part)
            emitStageItem(onProgress, Math.min(start + chunk.length, prompts.length), prompts.length, {
              messageKey: 'stageProgress.videogenPrompt',
              kind: 'scene',
              percentStart: 0,
              percentEnd: 35,
            })
          }
          if (optResults.length !== prompts.length) {
            return {
              success: false,
              error: '视频提示词优化结果数量与场景不一致（expected ' + prompts.length + ', got ' + optResults.length + '）',
            }
          }
          const optimized = []
          for (let j = 0; j < optResults.length; j++) {
            const item = optResults[j] || {}
            const p = typeof item.optimized_prompt === 'string' && item.optimized_prompt.trim()
              ? item.optimized_prompt.trim()
              : ''
            if (!p) {
              return { success: false, error: '视频提示词优化场景 ' + j + ' 返回空提示词' }
            }
            optimized.push(p)
          }
          prompts.length = 0
          prompts.push(...optimized)
          log.info('VideoGenStages', '视频提示词经 prompt-engine 优化：' + prompts.length + ' 条')
        } catch (error) {
          return { success: false, error: '视频提示词优化失败：' + (error && error.message ? error.message : String(error)) }
        }
      } else {
        return { success: false, error: '视频提示词优化需要 prompt-engine 服务（PromptBridge 未注入）' }
      }

      const runDir = getRunDir(runId)
      fs.mkdirSync(runDir, { recursive: true })

      // 视频生成并行（2026-08-13）：异步任务制（提交 + 轮询 + 下载），2 路并行安全（与故事讲述一致）。
      // - 复用 model-call-scheduler 预算调度：provider rpm 约束提交速率（governor RPM 排队/429 冷却）；
      // - 保序 map（mapWithModelBudget 结果与输入同序）：MERGE 按场景顺序拼接 concat-list，不得乱序；
      // - 显式 stage.options.videoConcurrency 仅作请求值，仍受 provider 预算上限收敛。
      const governor = pipelineEngine && pipelineEngine.governor
      const provider = manager && typeof manager.getProvider === 'function'
        ? manager.getProvider(videoProvider.providerId)
        : null
      const requestedConcurrency = Number(stage.options?.videoConcurrency) > 0 ? Number(stage.options.videoConcurrency) : 2
      const videoTask = async (prompt, index) => {
        try {
          // 统一参数契约：adapter 层驼峰/下划线两种命名并存（agnes 读 numFrames/frameRate，
          // ltx 读 num_frames/frame_rate），双写保证所有 adapter 生效；
          // 显式 stageOptions 优先，否则按场景时长映射帧数（storyboard duration 真正生效）
          const width = Number(stage.options?.width) > 0 ? Number(stage.options.width) : 1152
          const height = Number(stage.options?.height) > 0 ? Number(stage.options.height) : 768
          const numFrames = Number(stage.options?.numFrames) > 0
            ? Number(stage.options.numFrames)
            : pickFrameCountForDuration(scenes[index] && scenes[index].duration)
          const frameRate = Number(stage.options?.frameRate) > 0 ? Number(stage.options.frameRate) : 24
          const submit = await manager.callAdapter(videoProvider.providerId, 'generateVideo', {
            prompt: prompts[index],
            model: videoProvider.model || undefined,
            width,
            height,
            numFrames,
            frameRate,
            num_frames: numFrames,
            frame_rate: frameRate,
          }, { providerRunContext })
          // callAdapter 统一返回 { code: 0, data: adapterResult } 或 { code: -1, message }。
          // 前者 code !== 0 时直接透传；后者 code === 0 但有二层失败（adapter 抛异常被
          // callAdapter 包装成 { code: 0, data: { code: -1, message: '...' } }）时，
          // 必须检查 data.code 避免把真实错误吞成「视频生成未返回任务 ID」（2026-09-04 修复）。
          if (submit && submit.code !== 0) {
            return { index, success: false, error: submit.message || ('视频生成调用失败（provider: ' + videoProvider.providerId + '）') }
          }
          const data = submit && submit.data
          // 检查 data 层是否也包含失败（adapter 抛异常被 callAdapter 包装成 { code:0, data:{ code:-1, message } }）
          if (data && typeof data === 'object' && (data.code === -1 || data.code < 0)) {
            return {
              index,
              success: false,
              error: (data.message || data.error || '视频生成失败（provider: ' + videoProvider.providerId + '）'),
            }
          }
          // 兼容多种 taskId 字段命名（agnes-video 用 id/task_id，其他 adapter 用 taskId/videoId）
          const taskId = data && (data.taskId || data.videoId || data.id || data.task_id)
          if (!taskId) {
            return {
              index,
              success: false,
              error: '视频生成未返回任务 ID'
                + (data && typeof data === 'object' ? '，响应数据：' + JSON.stringify(Object.keys(data).filter(k => k !== 'model')) : '')
                + (submit && submit.message ? '；' + submit.message : ''),
            }
          }
          // 轮询任务状态：条件轮询 + 具名上限 + 超时原因（原实现固定 sleep 10s
          // 才做首次查询，秒回的任务也白等 10s；失败原因统一写成「超时或失败」，
          // 排查时分不清是轮询窗口用尽还是任务侧明确返回 failed）。
          const VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000
          const VIDEO_POLL_INTERVAL_MS = 10 * 1000
          const TERMINAL_STATES = ['failed', 'error', 'cancelled']
          const pollDeadline = Date.now() + VIDEO_POLL_TIMEOUT_MS
          let videoUrl = null
          let lastState = ''
          while (true) {
            const status = await manager.callAdapter(videoProvider.providerId, 'getVideoStatus', { videoId: taskId, taskId }, { providerRunContext })
            const url = status && (status.videoUrl || status.url || (status.data && (status.data.videoUrl || status.data.url)))
            if (url) { videoUrl = url; break }
            lastState = String((status && (status.status || (status.data && status.data.status))) || '').toLowerCase()
            if (TERMINAL_STATES.includes(lastState)) break
            if (Date.now() + VIDEO_POLL_INTERVAL_MS > pollDeadline) break
            await new Promise(r => setTimeout(r, VIDEO_POLL_INTERVAL_MS))
          }
          if (!videoUrl) {
            const reason = TERMINAL_STATES.includes(lastState)
              ? '任务状态为 ' + lastState
              : '轮询超时（上限 ' + Math.round(VIDEO_POLL_TIMEOUT_MS / 1000) + 's，末次状态=' + (lastState || 'unknown') + '）'
            return { index, success: false, error: '视频生成失败：' + reason + '（provider: ' + videoProvider.providerId + '）' }
          }
          const dest = path.join(runDir, 'scene_' + String(index).padStart(3, '0') + '.mp4')
          await downloadToFile(videoUrl, dest)
          log.info('VideoGenStages', 'scene ' + index + ' video generated: ' + dest)
          return { index, success: true, path: dest }
        } catch (error) {
          return { index, success: false, error: (error && error.message ? error.message : String(error)) }
        }
      }
      const videoResults = await mapWithModelBudget({
        items: prompts,
        requestedConcurrency,
        fallbackConcurrency: 2,
        type: 'video',
        providerId: videoProvider.providerId,
        provider,
        manager,
        governor,
        fn: (prompt, index) => {
          const runItem = () => videoTask(prompt, index)
          return withModelBudget(
            { governor, type: 'video', providerId: videoProvider.providerId, model: videoProvider.model },
            runItem,
          )
        },
      })
      const videos = videoResults.filter(Boolean)
      let generatedCount = 0
      for (const result of videos) {
        generatedCount += 1
        emitStageItem(onProgress, generatedCount, prompts.length, {
          messageKey: 'stageProgress.videogenGenerate',
          kind: 'video',
          percentStart: 35,
          percentEnd: 100,
        })
      }
      const ok = videos.filter(v => v.success)
      if (ok.length === 0) {
        return { success: false, error: '该流水线视频生成全部失败：' + videos.map(v => v.error).join('；') }
      }
      // video-content-fidelity S5：对齐报告补视觉评估桩
      try {
        if (context && typeof context === 'object') {
          context.videoContentFidelity = {
            ...(context.videoContentFidelity || {}),
            assessVisual: assessVisualConsistency(),
          }
        }
      } catch (_) { /* 上下文不可写时忽略 */ }
      emitStageComplete(onProgress, {
        messageKey: 'stageProgress.videogenGenerateComplete',
        summaryKey: ok.length === prompts.length ? 'stageProgress.videogenSummary' : 'stageProgress.videogenPartialSummary',
        summaryParams: { done: ok.length, total: prompts.length },
      })
      return { success: true, output: { videos: ok, scenes } }
    },
  )
  registered.push(VIDEOGEN_STAGE_TYPES.GENERATE)

  // MERGE - FFmpeg 拼接场景视频
  pipelineEngine.registerStageExecutor(
    VIDEOGEN_STAGE_TYPES.MERGE,
    async ({ runId, context, onProgress }) => {
      // 生成阶段的输出按 stage.name 写入 context（animation/character-animation=animate，
      // avatar-spokesperson=generate，hybrid=merge），merge 必须兼容全部候选键
      const videos = (['generate', 'merge', 'animate']
        .map(key => context[key] && context[key].videos)
        .find(Array.isArray)) || []
      if (videos.length === 0) return { success: false, error: '该流水线 merge 需要 context.generate/merge.videos' }
      const ffmpeg = findFfmpeg()
      if (!ffmpeg) return { success: false, error: 'ffmpeg 不可用，无法拼接视频' }
      const runDir = getRunDir(runId)
      fs.mkdirSync(runDir, { recursive: true })
      try {
        emitStageStart(onProgress, {
          messageKey: 'stageProgress.videogenMerge',
          message: 'Merging generated videos…',
        })
        const concatFile = path.join(runDir, 'concat-list.txt')
        const lines = videos.map(v => "file '" + String(v.path).replace(/'/g, "'\\''") + "'")
        fs.writeFileSync(concatFile, lines.join('\n'), 'utf8')
        const merged = path.join(runDir, 'merged.mp4')
        await runTool(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', merged])
        emitStageComplete(onProgress, {
          messageKey: 'stageProgress.videogenMergeComplete',
          summaryKey: 'stageProgress.videogenMergeSummary',
          detail: { done: 1, total: 1, kind: 'video' },
        })
        return { success: true, output: { videoPath: merged } }
      } catch (error) {
        return { success: false, error: 'merge 失败：' + (error && error.message ? error.message : String(error)) }
      }
    },
  )
  registered.push(VIDEOGEN_STAGE_TYPES.MERGE)

  // RENDER - 最终产物校验
  pipelineEngine.registerStageExecutor(
    VIDEOGEN_STAGE_TYPES.RENDER,
    async ({ context, onProgress }) => {
      emitStageStart(onProgress, { messageKey: 'stageProgress.videogenRender' })
      const merged = context.merge
      const videoPath = merged && (merged.videoPath || (merged.data && merged.data.videoPath))
      if (!videoPath || !fs.existsSync(videoPath)) {
        return { success: false, error: '该流水线 render 未找到合成产物（context.merge.videoPath）' }
      }
      emitStageComplete(onProgress, {
        messageKey: 'stageProgress.videogenRenderComplete',
        summaryKey: 'stageProgress.videogenRenderSummary',
        detail: { done: 1, total: 1, kind: 'video' },
      })
      return { success: true, output: { videoPath } }
    },
  )
  registered.push(VIDEOGEN_STAGE_TYPES.RENDER)

  return { success: true, registered }
}

module.exports = {
  VIDEOGEN_STAGE_TYPES,
  STORYBOARD_MODES,
  FIDELITY_MODES,
  DEFAULT_LLM_MAX_TOKENS,
  REASONING_LLM_MAX_TOKENS,
  REASONING_MODEL_PATTERNS,
  isReasoningLlmModel,
  resolveStoryboardMode,
  parseJsonObject,
  buildVideoOptimizeContext,
  callDefaultLlm,
  buildConceptPrompt,
  buildStoryboardPrompt,
  buildScriptPrompt,
  parseJsonArray,
  registerVideoGenStages,
}
