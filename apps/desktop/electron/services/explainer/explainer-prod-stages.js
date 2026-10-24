// @ts-check
/**
 * explainer-prod-stages — 生产五阶段的执行器（scenes / assets / editing / compose / publish）
 *
 * ## 为什么单独一个模块
 *
 * `explainer-stages.js` 原本 353 行；把五个阶段的实现搬到这里后它**变瘦**
 * （抽模块，不抬基线）。本模块只做「阶段编排 + 产物装配」，不重复实现上游契约。
 *
 * ## 契约衔接的关键点：旁白文本在哪
 *
 * ⚠ `scene_plan.scenes[]` 的 schema 里**没有旁白文本字段**
 *   （`additionalProperties:false`，多写就 schema 判红）。
 *   ⇒ 旁白文本在 **`script.sections[].text`**。
 *   ⇒ scene 与 script 的关联靠 `scene_plan.scenes[].script_section_id`。
 *   ⇒ 上游允许「一个 section 拆成 2–3 镜」（scene-director Common Pitfalls
 *     「One scene per section」）⇒ **按时间区间重叠**做映射，不是按下标。
 *
 * ## compose / publish 为什么要用专属 type
 *
 * 内置 `compose` / `publish` 是 story2video 等 5 条流水线共用的（`stage-executor.js` 的
 * `STAGE_TYPES.COMPOSE` / `PUBLISH`）⇒ 改它们的输出形态会破坏那 5 条线。
 * ⇒ explainer 用 `explainer_compose` / `explainer_publish` 两个独立 key
 *   （`execute` 是「自定义 executor 优先」，key 不重叠 ⇒ 零侵入）。
 * ⇒ 内层调用时**必须把 `stage.options` 原样带过去**（内置 compose 读它的 18 个白名单 key），
 *   否则合成参数被静默丢掉。
 */

'use strict'

const { emitStageStart, emitStageComplete } = require('../stage-progress')
const { getDefaultLlmConfig, callDefaultLlm } = require('./llm-call')
const {
  parseJsonArtifact,
  validateArtifact,
  asText,
  asArray,
  asObject,
  asNumber,
} = require('./explainer-artifacts')
const {
  assembleShotPrompt,
  makeIssue,
} = require('./explainer-shot-language')
const {
  buildScenePlan,
  checkScenePlanCriteria,
  buildAssetManifest,
  checkAssetManifestCriteria,
} = require('./explainer-prod-artifacts')
const {
  buildEditDecisions,
  checkEditDecisionsCriteria,
} = require('./explainer-edit-decisions')
const {
  buildRenderReport,
  buildFinalReview,
  buildPublishLog,
  checkPublishLogCriteria,
} = require('./explainer-prod-review')
const {
  probeContainer,
  sampleFrames,
  measureLoudness,
} = require('./explainer-media-probe')

const MAX_SCENES = 30
const DEFAULT_SCENE_DURATION = 6
const MIN_SCENE_TEXT_LENGTH = 4

/**
 * 把场景与 script 的章节按**时间区间重叠**关联。
 *
 * @param {Array} planScenes scene_plan.scenes
 * @param {Array} scriptSections script.sections
 * @returns {Map<string, object>} sceneId → section
 */
function linkScenesToSections (planScenes, scriptSections) {
  const link = new Map()
  const sections = scriptSections.map(s => asObject(s))
  planScenes.forEach((scene, index) => {
    const obj = asObject(scene)
    const sceneId = asText(obj.id) || ('scene-' + (index + 1))
    const explicit = asText(obj.script_section_id)
    if (explicit) {
      const hit = sections.find(s => asText(s.id) === explicit)
      if (hit) { link.set(sceneId, hit); return }
    }
    // 按时间区间重叠最大者
    const start = asNumber(obj.start_seconds, 0)
    const end = asNumber(obj.end_seconds, start)
    let best = null
    let bestOverlap = -1
    for (const section of sections) {
      const sStart = asNumber(section.start_seconds, 0)
      const sEnd = asNumber(section.end_seconds, sStart)
      const overlap = Math.min(end, sEnd) - Math.max(start, sStart)
      if (overlap > bestOverlap) { bestOverlap = overlap; best = section }
    }
    if (best && bestOverlap > 0) link.set(sceneId, best)
  })
  return link
}

/** 场景的旁白文本（经 script_section_id 关联） */
function sceneNarrationText (scene, sectionLink) {
  const section = sectionLink.get(asText(asObject(scene).id))
  return section ? asText(asObject(section).text) : ''
}

/** 组装 scenes 阶段的结构化提示词：要求 LLM 产**结构化**镜头语言 */
function buildScenePlanPrompt (script, options = {}) {
  return {
    system: [
      '你是视频分镜师。把旁白文案拆分为若干视频场景，输出严格的 JSON。',
      '输出格式：{"scenes": [{"id": "scene-1", "type": "broll", "description": "画面主体与动作的一句话描述",',
      '"duration": 6, "script_section_id": "对应旁白章节 id", "shot_intent": "这一镜为什么存在",',
      '"shot_language": {"shot_size": "medium", "camera_movement": "static", "lens_mm": 50,',
      '"lighting_key": "natural", "depth_of_field": "medium", "color_temperature": "neutral"},',
      '"texture_keywords": ["clean"]}]}',
      '字段说明：type 只能是 ' + [
        'talking_head', 'broll', 'animation', 'character_scene', 'diagram',
        'text_card', 'transition', 'generated', 'screen_recording',
      ].join(' | ') + ' 之一；',
      'shot_size ∈ extreme_wide|wide|medium_wide|medium|medium_close|close_up|extreme_close_up|over_shoulder|insert|establishing；',
      'camera_movement ∈ static|pan_left|pan_right|tilt_up|tilt_down|dolly_in|dolly_out|tracking_left|tracking_right|crane_up|crane_down|handheld|steadicam|whip_pan|orbital|zoom_in|zoom_out|rack_focus；',
      'lens_mm ∈ 14|24|35|50|85|135|200；',
      'lighting_key ∈ high_key|low_key|natural|golden_hour|blue_hour|tungsten_warm|neon|silhouette|rim_lit|volumetric|overcast_soft；',
      'depth_of_field ∈ shallow|medium|deep；color_temperature ∈ cool|neutral|warm|mixed。',
      '不要输出 markdown 代码块标记，不要任何解释文字。场景数量不超过 ' + MAX_SCENES + ' 个。',
    ].join('\n'),
    user: '旁白文案（每段前标注章节 id）：\n' + String(script || '').trim(),
  }
}

/** 行级兜底：把旁白文案按段落拆成场景（LLM 解析失败时保证流水线可继续） */
function fallbackScenes (script, options = {}) {
  const duration = Number(options.duration)
  const sceneDuration = Number.isFinite(duration) && duration >= 1 ? duration : DEFAULT_SCENE_DURATION
  const blocks = String(script || '')
    .split(/\n\s*\n|\r?\n/)
    .map(block => block.trim())
    .filter(block => block.length >= MIN_SCENE_TEXT_LENGTH)
  if (blocks.length === 0) return null
  return blocks.slice(0, MAX_SCENES).map((text, index) => ({
    id: 'scene-' + (index + 1),
    type: 'broll',
    description: '以纪实风格呈现「' + text.slice(0, 40) + '」的解说画面，构图清晰，光线自然。',
    duration: sceneDuration,
  }))
}

/** 从 LLM 输出里抽出场景数组（容忍围栏 / 说明文字） */
function parseScenesArray (text) {
  const parsed = parseJsonArtifact(text)
  if (Array.isArray(parsed)) return parsed
  if (parsed && Array.isArray(parsed.scenes)) return parsed.scenes
  const source = String(text || '')
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const candidate = JSON.parse(source.slice(start, end + 1))
      if (Array.isArray(candidate)) return candidate
    } catch (error) { /* fallthrough */ }
  }
  return null
}

module.exports = {
  MAX_SCENES,
  linkScenesToSections,
  sceneNarrationText,
  buildScenePlanPrompt,
  fallbackScenes,
  parseScenesArray,
}

// ---------------------------------------------------------------------------
// 执行器工厂
// ---------------------------------------------------------------------------

function getAiGenerator (pipelineEngine) {
  return pipelineEngine.aiGenerator ||
    (pipelineEngine.container && typeof pipelineEngine.container.get === 'function'
      ? pipelineEngine.container.get('aiGenerator')
      : null)
}

/** script artifact ⇒ 纯文本（供 LLM 提示词用）；兼容旧字符串形态 */
function extractScriptText (script) {
  if (typeof script === 'string') return script.trim()
  const sections = asArray(asObject(script).sections)
  if (!sections.length) return ''
  return sections.map(s => {
    const o = asObject(s)
    const id = asText(o.id)
    const text = asText(o.text)
    return id ? '[' + id + '] ' + text : text
  }).filter(Boolean).join('\n')
}

/** script artifact ⇒ 总时长 */
function extractTargetDuration (script) {
  const direct = asNumber(asObject(script).total_duration_seconds, 0)
  if (direct > 0) return direct
  const sections = asArray(asObject(script).sections)
  if (!sections.length) return 0
  const last = asObject(sections[sections.length - 1])
  return asNumber(last.end_seconds, 0)
}

/**
 * scenes 阶段：LLM 出**结构化**场景 ⇒ 归一化成上游 scene_plan。
 *
 * ⚠ **输出形态变了**：旧版输出 `[{prompt, text, duration}]` 数组，
 *   新版输出 scene_plan 对象 ⇒ 下游 assets 阶段必须做**双形态适配**。
 */
function createScenePlanExecutor (pipelineEngine) {
  return async ({ stage, context, onProgress }) => {
    const aiGenerator = getAiGenerator(pipelineEngine)
    if (!aiGenerator) {
      return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
    }
    const scriptText = extractScriptText(context.script)
    if (!scriptText) {
      return { success: false, error: 'animated-explainer scenes 需要 context.script（对象或字符串形态）' }
    }
    const options = stage.options || {}
    const { system, user } = buildScenePlanPrompt(scriptText, options)
    try {
      emitStageStart(onProgress, { messageKey: 'stageProgress.explainerScenes' })
      const raw = await callDefaultLlm(aiGenerator, system, user)
      let scenes = parseScenesArray(raw)
      if (!scenes) {
        // JSON 解析失败：让 LLM 把输出修复为严格 JSON（有界 1 次）
        try {
          const repaired = await callDefaultLlm(
            aiGenerator,
            '你是严格的 JSON 输出助手。把用户给的文字重写为严格的 JSON，格式：{"scenes":[{"id":"scene-1","type":"broll","description":"...","duration":6,"shot_language":{"shot_size":"medium","camera_movement":"static"}}]}。只输出 JSON，不要解释。',
            '原始输出：\n' + String(raw).slice(0, 4000),
            1600,
            { retries: 1 },
          )
          scenes = parseScenesArray(repaired)
        } catch (error) { /* 修复失败不阻断 */ }
      }
      if (!scenes) scenes = fallbackScenes(scriptText, options)
      if (!scenes) {
        const snippet = String(raw).slice(0, 120)
        return { success: false, error: 'scenes 阶段无法解析场景：' + snippet }
      }

      const plan = buildScenePlan({ scenes }, {
        targetDurationSeconds: extractTargetDuration(context.script),
        stylePlaybook: asText(options.stylePlaybook),
      })
      const validation = validateArtifact('scene_plan', plan)
      if (!validation.ok) {
        return {
          success: false,
          error: 'scene_plan 不符合上游 schema：' + validation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
        }
      }
      const issues = checkScenePlanCriteria(plan)
      const blocking = issues.filter(i => asText(i.severity) === 'error')
      emitStageComplete(onProgress, {
        messageKey: 'stageProgress.explainerScenesComplete',
        summaryKey: 'stageProgress.explainerScenesSummary',
        summaryParams: { count: plan.scenes.length },
        detail: { done: plan.scenes.length, total: plan.scenes.length, kind: 'scene' },
      })
      return {
        success: true,
        output: plan,
        // ⚠ 质量自检的 error 级问题不阻断流水线（**记录**而非拦截）——
        //   真正的闸门是 P3 的 G1 审批门；此处 fail-closed 会让片出不来。
        issues,
        blocked: blocking.length > 0,
      }
    } catch (error) {
      return { success: false, error: 'scenes 失败：' + (error && error.message ? error.message : String(error)) }
    }
  }
}

module.exports.createScenePlanExecutor = createScenePlanExecutor
module.exports.getAiGenerator = getAiGenerator
module.exports.extractScriptText = extractScriptText
module.exports.extractTargetDuration = extractTargetDuration

// ---------------------------------------------------------------------------
// assets 阶段（复用 story2video_generate_assets）
// ---------------------------------------------------------------------------

/**
 * 取默认 provider 配置。
 * ⚠ **原样搬**自 explainer-stages.js（搬既有实现不要顺手优化 ——
 *   复合 provider 用 capability_models 按能力选模型，必须优先于 models[0]，
 *   否则会把 TTS 模型当图片模型传给生图）。
 */
function getDefaultProviderConfig (aiGenerator, type) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  const provider = manager && typeof manager.getDefault === 'function'
    ? manager.getDefault(type)
    : null
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
  const capabilityModel = provider.capability_models && provider.capability_models[type]
  const model = typeof capabilityModel === 'string' && capabilityModel.trim()
    ? capabilityModel.trim()
    : (Array.isArray(provider.models)
        ? provider.models.find(item => typeof item === 'string' && item.trim())
        : null)
  return model ? { providerId: provider.id.trim(), model: model.trim() } : null
}

/**
 * 解析场景来源，认**三种**形态。
 *
 * ⚠ **为什么有三种**：产物的 context 键是 **`context[stage.name]`**，而本仓阶段名是 `scenes`
 *   （上游是 `scene_plan`）⇒ 新契约的产物落在 `context.scenes` 且**是对象**；
 *   而 P2b 之前 `context.scenes` 是**旧形态的场景数组**；另外 `context.scene_plan`
 *   是按上游阶段名对齐的键（P4 的 EP 状态机会按上游两级结构取）。
 * ⇒ 三种都要认，否则任一形态都会被读成「没有场景」。
 *
 * @returns {{ plan: object|null, scenes: Array, legacy: boolean }}
 */
function resolveSceneSource (context) {
  const candidates = [asObject(context).scene_plan, asObject(context).scenes]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (Array.isArray(candidate)) return { plan: null, scenes: candidate, legacy: true }
    const scenes = asArray(candidate.scenes)
    if (scenes.length) return { plan: candidate, scenes, legacy: false }
  }
  return { plan: null, scenes: [], legacy: false }
}

/**
 * 把 scene_plan（**或旧形态的场景数组**）转成 story2video assets 阶段要的输入。
 *
 * ⚠ **双形态适配**：P2b 之前 scenes 阶段输出 `[{prompt, text, duration}]` 数组；
 *   P2b 之后输出 scene_plan 对象。断点续跑的旧 run 上下文里仍是数组 ⇒ 两者都要吃。
 *
 * @param {object} context 阶段上下文
 * @param {object} options 阶段 options
 * @returns {{ split: Array, scenes: Array, legacy: boolean, issues: Array }}
 */
function adaptScenesForAssets (context, options = {}) {
  const issues = []
  const source = resolveSceneSource(context)
  const plan = source.plan
  const planScenes = source.scenes
  const legacyScenes = source.legacy ? source.scenes : []

  if (planScenes.length && !source.legacy) {
    const link = linkScenesToSections(planScenes, asArray(asObject(context.script).sections))
    const split = planScenes.map((scene, index) => {
      const obj = asObject(scene)
      const sceneId = asText(obj.id) || ('scene-' + (index + 1))
      const prompt = assembleShotPrompt(obj, { imageStyle: options.imageStyle }).prompt
      const text = sceneNarrationText(obj, link)
      if (!text) {
        issues.push(makeIssue('SCENE_WITHOUT_NARRATION',
          '场景「' + sceneId + '」找不到对应旁白章节（script_section_id 未关联上）', 'warn'))
      }
      return {
        prompt,
        text,
        duration: Number((asNumber(obj.end_seconds, 0) - asNumber(obj.start_seconds, 0)).toFixed(3)) || 6,
      }
    })
    return { split, scenes: split, legacy: false, issues }
  }

  if (legacyScenes.length) {
    // 旧形态：直接沿用（双形态适配的另一支）
    return { split: legacyScenes, scenes: legacyScenes, legacy: true, issues }
  }

  return { split: [], scenes: [], legacy: false, issues }
}

/**
 * assets 阶段：跑 story2video_generate_assets，然后登记成上游 asset_manifest。
 *
 * ⚠ 内部逻辑（provider 解析 / visualMode / 内容政策重试）**原样搬**自
 *   explainer-stages.js 的 GENERATE_ASSETS，只改两处：
 *   ① 输入适配（scene_plan ⇄ 旧数组）；② 输出包装（asset_manifest）。
 */
function createAssetsExecutor (pipelineEngine) {
  return async ({ runId, stage, params, context, onProgress }) => {
    const options = stage.options || {}
    const adapted = adaptScenesForAssets(context, options)
    if (!adapted.scenes.length) {
      return { success: false, error: 'animated-explainer generate_assets 需要有效的场景（context.scene_plan 或 context.scenes）' }
    }
    const optimizedPrompts = adapted.scenes.map(scene => ({
      optimized_prompt: scene.prompt || '',
      prompt: scene.prompt || '',
    }))
    if (optimizedPrompts.some(item => !item.prompt)) {
      return { success: false, error: 'animated-explainer 场景缺少画面提示词（prompt）' }
    }
    const adaptedContext = { ...context, optimize: optimizedPrompts, split: adapted.split }

    const aiGenerator = getAiGenerator(pipelineEngine)
    const defaultImage = getDefaultProviderConfig(aiGenerator, 'image')
    const defaultVoice = getDefaultProviderConfig(aiGenerator, 'tts')
    const innerOptions = { ...options }
    const visualMode = params?.visualMode === 'title-card' ? 'title-card' : 'ai'
    if (visualMode === 'title-card') {
      // ⚠ 标题卡模式**不填**默认 image provider：这是「关掉 AI 生图」的第二道防线。
      //   第一道在下游 story2video_generate_assets，两层都不提供 provider
      //   ⇒ 「关不掉」这条路在结构上就不存在。
      innerOptions.visualMode = 'title-card'
    } else {
      if (!innerOptions.imageProvider && defaultImage) innerOptions.imageProvider = defaultImage.providerId
      if (!innerOptions.imageModel && defaultImage) innerOptions.imageModel = defaultImage.model
    }
    if (!innerOptions.voiceProvider && defaultVoice) innerOptions.voiceProvider = defaultVoice.providerId
    if (!innerOptions.voiceModel && defaultVoice) innerOptions.voiceModel = defaultVoice.model

    const inner = await pipelineEngine.stageExecutor.execute({
      runId,
      stage: { name: 'assets', type: 'story2video_generate_assets', options: innerOptions },
      params,
      context: adaptedContext,
      onProgress,
    })
    if (!inner.success) {
      pipelineEngine.log.warn('ExplainerStages', 'generate_assets reuse failed: ' + inner.error)
      return inner
    }

    const manifest = buildAssetManifest(inner.output, {
      scenePlan: asObject(context.scene_plan),
      imageStyle: options.imageStyle,
      sourceTool: innerOptions.imageProvider || 'title-card',
    })
    const validation = validateArtifact('asset_manifest', manifest)
    if (!validation.ok) {
      return {
        success: false,
        error: 'asset_manifest 不符合上游 schema：' + validation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
      }
    }
    const issues = checkAssetManifestCriteria(manifest, { scenePlan: asObject(context.scene_plan) })
    return { success: true, output: manifest, issues }
  }
}

/**
 * editing 阶段：产出上游 edit_decisions（cuts / 字幕 / 音频层 / pacing）。
 */
function createEditingExecutor (pipelineEngine) {
  return async ({ stage, context }) => {
    const source = resolveSceneSource(context)
    const plan = source.plan
    if (!source.scenes.length) {
      return { success: false, error: 'animated-explainer editing 需要有效的 scene_plan（context.scene_plan / context.scenes）' }
    }
    const manifest = asObject(context.assets)
    if (!asArray(manifest.assets).length) {
      return { success: false, error: 'animated-explainer editing 需要有效的 asset_manifest（context.assets）' }
    }
    const proposal = asObject(context.proposal)
    const lockedRuntime = asText(asObject(proposal.production_plan).render_runtime)
    const decisions = buildEditDecisions({}, {
      scenePlan: plan || { version: '1.0', scenes: source.scenes },
      assetManifest: manifest,
      script: asObject(context.script),
      renderRuntime: lockedRuntime,
      approvalStatus: asText(asObject(proposal.approval).status),
      options: stage.options || {},
    })
    const validation = validateArtifact('edit_decisions', decisions)
    if (!validation.ok) {
      return {
        success: false,
        error: 'edit_decisions 不符合上游 schema：' + validation.errors.slice(0, 3).map(e => e.path + ' ' + e.message).join('; '),
      }
    }
    const issues = checkEditDecisionsCriteria(decisions, {
      scenePlan: plan,
      assetManifest: manifest,
      script: asObject(context.script),
      options: stage.options || {},
    })
    return { success: true, output: decisions, issues }
  }
}

module.exports.adaptScenesForAssets = adaptScenesForAssets
module.exports.createAssetsExecutor = createAssetsExecutor
module.exports.createEditingExecutor = createEditingExecutor
module.exports.getDefaultProviderConfig = getDefaultProviderConfig
module.exports.resolveSceneSource = resolveSceneSource
