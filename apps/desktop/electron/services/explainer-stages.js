// @ts-check
/**
 * explainer-stages - animated-explainer（AI 讲解视频）流水线的自定义阶段执行器
 *
 * 注册与 animated-explainer 流水线配套的自定义 STAGE_TYPES：
 *   - explainer_research:          主题 → 默认 LLM 生成结构化解说大纲
 *   - explainer_proposal:          大纲 → 默认 LLM 生成分镜方案（段落/主题划分）
 *   - explainer_script:            方案 → 默认 LLM 生成逐段旁白文案
 *   - explainer_scenes:            文案 → 默认 LLM 生成场景数组 [{ prompt, text, duration }]
 *   - explainer_generate_assets:   复用 story2video_generate_assets（图片+TTS，含内容政策重试）
 *   - explainer_editing:           资源清单校验/透传（真实动效/转场由 compose 引擎执行）
 *
 * 注册方式：在 container.setup.js 中调用 registerExplainerStages(pipelineEngine)
 */

'use strict'

const { emitStageStart, emitStageComplete } = require('./stage-progress')

const EXPLAINER_STAGE_TYPES = {
  RESEARCH: 'explainer_research',
  PROPOSAL: 'explainer_proposal',
  SCRIPT: 'explainer_script',
  SCENES: 'explainer_scenes',
  GENERATE_ASSETS: 'explainer_generate_assets',
  EDITING: 'explainer_editing',
}

const MAX_SCENES = 30
const DEFAULT_SCENE_DURATION = 6
const MIN_SCENE_TEXT_LENGTH = 4

function getAiGenerator (pipelineEngine) {
  return pipelineEngine.aiGenerator ||
    (pipelineEngine.container && typeof pipelineEngine.container.get === 'function'
      ? pipelineEngine.container.get('aiGenerator')
      : null)
}

function getDefaultLlmConfig (aiGenerator) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  const provider = manager && typeof manager.getDefault === 'function'
    ? manager.getDefault('llm')
    : null
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
  const model = Array.isArray(provider.models)
    ? provider.models.find(item => typeof item === 'string' && item.trim())
    : null
  return model ? { providerId: provider.id.trim(), model: model.trim() } : null
}

function getDefaultProviderConfig (aiGenerator, type) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  const provider = manager && typeof manager.getDefault === 'function'
    ? manager.getDefault(type)
    : null
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
  // 复合 provider（如 minimax-multimodal）声明 capability_models 按能力选模型；
  // 必须优先于 models[0]，否则会把 TTS 模型（speech-2.8-turbo）当图片模型传给生图。
  const capabilityModel = provider.capability_models && provider.capability_models[type]
  const model = typeof capabilityModel === 'string' && capabilityModel.trim()
    ? capabilityModel.trim()
    : (Array.isArray(provider.models)
        ? provider.models.find(item => typeof item === 'string' && item.trim())
        : null)
  return model ? { providerId: provider.id.trim(), model: model.trim() } : null
}

async function callDefaultLlm (aiGenerator, systemPrompt, userContent, maxTokens, options = {}) {
  if (!aiGenerator || typeof aiGenerator.generateWithDefault !== 'function') {
    throw new Error('默认 LLM 不可用，请先完成模型设置')
  }
  if (!getDefaultLlmConfig(aiGenerator)) {
    throw new Error('未找到需要的相关模型，请在设置中添加模型')
  }
  // 有界重试（2026-08-11 E2E 复盘）：LLM 偶发返回空内容/瞬时错误会让
  // research/proposal/script/scenes 整线失败。默认最多 2 次额外重试，
  // 仅对空内容与可判定为瞬时的错误重试；配置/模型缺失等直接抛出。
  const maxAttempts = Math.max(1, Math.min(Number(options.retries) || 2, 4))
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await aiGenerator.generateWithDefault('llm', {
        temperature: 0.7,
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : 1600,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      })
      const content = result && typeof result.content === 'string' ? result.content.trim() : ''
      if (content) return content
      lastError = new Error('默认 LLM 返回空内容')
    } catch (error) {
      lastError = error
      const message = error && error.message ? String(error.message) : String(error)
      // 配置/能力类错误不是瞬时问题，直接抛出不重试
      if (/未找到|不可用|没有配置|No configured|No adapter|not configured|配置|requires/i.test(message)) throw error
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500 * attempt))
    }
  }
  throw lastError
}

function buildResearchPrompt (topic, options = {}) {
  const scope = typeof options.scope === 'string' && options.scope.trim()
    ? '\n内容范围：' + options.scope.trim()
    : ''
  return {
    system: '你是资深视频策划。根据用户给的主题，输出一份结构化的讲解视频大纲：3-6 个要点，每点一行，格式「序号. 要点标题：一句话说明」。只输出大纲本身，不要任何其他文字或 markdown。',
    user: '主题：' + String(topic || '').trim() + scope,
  }
}

function buildProposalPrompt (outline, options = {}) {
  return {
    system: '你根据大纲为讲解视频设计分镜方案。输出分镜列表，每行一个分镜，格式「分镜N：画面内容提示 | 对应讲解要点」。只输出方案本身，不要多余文字。',
    user: '大纲：\n' + String(outline || '').trim(),
  }
}

function buildScriptPrompt (plan, options = {}) {
  return {
    system: '你根据分镜方案撰写逐段旁白文案，每段对应一个分镜，段落之间用空行分隔。语言口语化、逻辑连贯、适合配音。不要输出序号以外的多余标记。',
    user: '分镜方案：\n' + String(plan || '').trim(),
  }
}

function buildScenesPrompt (script, options = {}) {
  return {
    system: '把旁白文案拆分为若干视频场景。输出严格的 JSON 数组，不要包含任何其他文字或 markdown 代码块标记。每个元素格式：{"prompt": "该场景的画面提示词（描述主体、动作、构图、光线、视觉风格，供 AI 生图直接使用）", "text": "该场景对应的旁白文本", "duration": 秒数（4 到 10 的整数）}。场景数量不超过 ' + MAX_SCENES + ' 个。',
    user: '旁白文案：\n' + String(script || '').trim(),
  }
}

/** 从 LLM 输出中提取 JSON 数组（容忍 markdown 围栏、说明文字与对象包装）。 */
function parseScenesJson (text) {
  const source = String(text || '').trim()
  if (!source) return null

  // 1) 直接解析整段（可能是裸数组或含数组字段的对象）
  try {
    const parsed = JSON.parse(source)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') {
      const firstArray = Object.values(parsed).find(Array.isArray)
      if (firstArray) return firstArray
    }
  } catch {
    // fallthrough
  }

  // 2) 提取第一个 [...] 数组块
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start !== -1 && end > start) {
    const candidate = source.slice(start, end + 1)
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // fallthrough
    }
  }

  // 3) 提取数组属性值（例如 {"scenes": [...]} 带前后说明文字）
  const propertyMatch = source.match(/["']?scenes["']?\s*:\s*(\[[\s\S]*\])/i)
  if (propertyMatch) {
    try {
      const parsed = JSON.parse(propertyMatch[1])
      if (Array.isArray(parsed)) return parsed
    } catch {
      // fallthrough
    }
  }

  return null
}

/** 行级兜底：把旁白文案按段落/行拆成场景（JSON 解析失败时保证流水线可继续）。 */
function fallbackScenes (script, options = {}) {
  const duration = Number(options.duration)
  const sceneDuration = Number.isFinite(duration) && duration >= 1 ? duration : DEFAULT_SCENE_DURATION
  const blocks = String(script || '')
    .split(/\n\s*\n|\r?\n/)
    .map(block => block.trim())
    .filter(block => block.length >= MIN_SCENE_TEXT_LENGTH)
  if (blocks.length === 0) return null
  return blocks.slice(0, MAX_SCENES).map(text => ({
    text,
    prompt: '以纪实风格呈现「' + text.slice(0, 40) + '」的解说画面，构图清晰，光线自然。',
    duration: sceneDuration,
  }))
}

function normalizeScenes (raw, fallbackScript) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const scenes = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (!prompt || !text) continue
    const duration = Number(item.duration)
    scenes.push({
      prompt,
      text,
      duration: Number.isFinite(duration) && duration >= 1 ? duration : DEFAULT_SCENE_DURATION,
    })
  }
  if (scenes.length === 0) return null
  return scenes.slice(0, MAX_SCENES)
}

/**
 * 注册 animated-explainer 流水线的自定义阶段执行器
 * @param {object} pipelineEngine - PipelineEngine 实例（需已注入 serviceBus）
 * @returns {{success: boolean, error?: string, registered?: string[]}}
 */
function registerExplainerStages (pipelineEngine) {
  if (!pipelineEngine || !pipelineEngine.stageExecutor) {
    return {
      success: false,
      error: 'PipelineEngine.stageExecutor not configured (ServiceBus missing)',
    }
  }

  const registered = []
  const log = pipelineEngine.log

  // ----------------------------------------------------------
  // RESEARCH - 主题 → 结构化解说大纲
  // ----------------------------------------------------------
  pipelineEngine.registerStageExecutor(
    EXPLAINER_STAGE_TYPES.RESEARCH,
    async ({ stage, params, onProgress }) => {
      const aiGenerator = getAiGenerator(pipelineEngine)
      if (!aiGenerator) {
        return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
      }
      const topic = typeof params.text === 'string' ? params.text.trim() : ''
      if (!topic) {
        return { success: false, error: 'animated-explainer research 需要非空主题（params.text）' }
      }
      const { system, user } = buildResearchPrompt(topic, stage.options || {})
      try {
        emitStageStart(onProgress, { messageKey: 'stageProgress.explainerResearch' })
        const outline = await callDefaultLlm(aiGenerator, system, user)
        emitStageComplete(onProgress, {
          messageKey: 'stageProgress.explainerResearchComplete',
          summaryKey: 'stageProgress.explainerResearchSummary',
        })
        return { success: true, output: outline }
      } catch (error) {
        return { success: false, error: 'research 失败：' + (error && error.message ? error.message : String(error)) }
      }
    },
  )
  registered.push(EXPLAINER_STAGE_TYPES.RESEARCH)

  // ----------------------------------------------------------
  // PROPOSAL - 大纲 → 分镜方案
  // ----------------------------------------------------------
  pipelineEngine.registerStageExecutor(
    EXPLAINER_STAGE_TYPES.PROPOSAL,
    async ({ stage, context, onProgress }) => {
      const aiGenerator = getAiGenerator(pipelineEngine)
      if (!aiGenerator) {
        return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
      }
      const outline = typeof context.research === 'string' ? context.research.trim() : ''
      if (!outline) {
        return { success: false, error: 'animated-explainer proposal 需要 context.research' }
      }
      const { system, user } = buildProposalPrompt(outline, stage.options || {})
      try {
        emitStageStart(onProgress, { messageKey: 'stageProgress.explainerProposal' })
        const plan = await callDefaultLlm(aiGenerator, system, user)
        emitStageComplete(onProgress, {
          messageKey: 'stageProgress.explainerProposalComplete',
          summaryKey: 'stageProgress.explainerProposalSummary',
        })
        return { success: true, output: plan }
      } catch (error) {
        return { success: false, error: 'proposal 失败：' + (error && error.message ? error.message : String(error)) }
      }
    },
  )
  registered.push(EXPLAINER_STAGE_TYPES.PROPOSAL)

  // ----------------------------------------------------------
  // SCRIPT - 分镜方案 → 逐段旁白文案
  // ----------------------------------------------------------
  pipelineEngine.registerStageExecutor(
    EXPLAINER_STAGE_TYPES.SCRIPT,
    async ({ stage, context, onProgress }) => {
      const aiGenerator = getAiGenerator(pipelineEngine)
      if (!aiGenerator) {
        return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
      }
      const plan = typeof context.proposal === 'string' ? context.proposal.trim() : ''
      if (!plan) {
        return { success: false, error: 'animated-explainer script 需要 context.proposal' }
      }
      const { system, user } = buildScriptPrompt(plan, stage.options || {})
      try {
        emitStageStart(onProgress, { messageKey: 'stageProgress.explainerScript' })
        const script = await callDefaultLlm(aiGenerator, system, user)
        emitStageComplete(onProgress, {
          messageKey: 'stageProgress.explainerScriptComplete',
          summaryKey: 'stageProgress.explainerScriptSummary',
        })
        return { success: true, output: script }
      } catch (error) {
        return { success: false, error: 'script 失败：' + (error && error.message ? error.message : String(error)) }
      }
    },
  )
  registered.push(EXPLAINER_STAGE_TYPES.SCRIPT)

  // ----------------------------------------------------------
  // SCENES - 旁白文案 → 场景数组 [{ prompt, text, duration }]
  // ----------------------------------------------------------
  pipelineEngine.registerStageExecutor(
    EXPLAINER_STAGE_TYPES.SCENES,
    async ({ stage, context, onProgress }) => {
      const aiGenerator = getAiGenerator(pipelineEngine)
      if (!aiGenerator) {
        return { success: false, error: '默认 LLM 不可用，请先完成模型设置' }
      }
      const script = typeof context.script === 'string' ? context.script.trim() : ''
      if (!script) {
        return { success: false, error: 'animated-explainer scenes 需要 context.script' }
      }
      const { system, user } = buildScenesPrompt(script, stage.options || {})
      try {
        emitStageStart(onProgress, { messageKey: 'stageProgress.explainerScenes' })
        const raw = await callDefaultLlm(aiGenerator, system, user)
        let scenes = normalizeScenes(parseScenesJson(raw), script)
        if (!scenes) {
          // JSON 解析失败：让 LLM 把原始输出修复为严格 JSON（有界 1 次），
          // 修复仍失败再回落行级兜底（2026-08-11 E2E 复盘：降低 LLM 偶发格式漂移导致的整线失败）。
          try {
            const repaired = await callDefaultLlm(
              aiGenerator,
              '你是严格的 JSON 输出助手。用户给你一段文字，如果它不是严格的 JSON 数组，请把它重写为严格的 JSON 数组；如果它已经是，直接原样输出。每个元素格式：{"prompt": "画面提示词", "text": "旁白文本", "duration": 4到10的整数}。只输出 JSON 数组，不要任何其他文字。',
              '原始输出：\n' + String(raw).slice(0, 4000),
              1600,
              { retries: 1 },
            )
            scenes = normalizeScenes(parseScenesJson(repaired), script)
          } catch (_) {
            // 修复失败不阻断，继续走行级兜底
          }
        }
        if (!scenes) {
          scenes = fallbackScenes(script, stage.options || {})
        }
        if (!scenes) {
          const snippet = raw.length > 120 ? raw.slice(0, 120) + '…' : raw
          return {
            success: false,
            error: 'scenes 阶段无法解析场景：' + snippet,
          }
        }
        emitStageComplete(onProgress, {
          messageKey: 'stageProgress.explainerScenesComplete',
          summaryKey: 'stageProgress.explainerScenesSummary',
          summaryParams: { count: scenes.length },
          detail: { done: scenes.length, total: scenes.length, kind: 'scene' },
        })
        return { success: true, output: scenes }
      } catch (error) {
        return { success: false, error: 'scenes 失败：' + (error && error.message ? error.message : String(error)) }
      }
    },
  )
  registered.push(EXPLAINER_STAGE_TYPES.SCENES)

  // ----------------------------------------------------------
  // GENERATE_ASSETS - 复用 story2video_generate_assets（图片+TTS，含内容政策重试）
  // ----------------------------------------------------------
  pipelineEngine.registerStageExecutor(
    EXPLAINER_STAGE_TYPES.GENERATE_ASSETS,
    async ({ runId, stage, params, context, onProgress }) => {
      const scenes = Array.isArray(context.scenes) ? context.scenes : []
      if (scenes.length === 0) {
        return { success: false, error: 'animated-explainer generate_assets 需要 context.scenes' }
      }
      const optimizedPrompts = scenes.map((scene) => ({
        optimized_prompt: scene.prompt || '',
        prompt: scene.prompt || '',
      }))
      if (optimizedPrompts.some(item => !item.prompt)) {
        return { success: false, error: 'animated-explainer 场景缺少画面提示词（prompt）' }
      }
      const adaptedContext = {
        ...context,
        optimize: optimizedPrompts,
        split: scenes,
      }
      // 未显式指定图片/TTS provider 时，自动解析模型设置中的默认 provider，
      // 避免资源生成落到本地占位/降级路径。
      const aiGenerator = getAiGenerator(pipelineEngine)
      const defaultImage = getDefaultProviderConfig(aiGenerator, 'image')
      const defaultVoice = getDefaultProviderConfig(aiGenerator, 'tts')
      const innerOptions = { ...(stage.options || {}) }
      // 「画面模式」透传给下游 assets 阶段（story2video_generate_assets）：
      //   'ai'（默认）→ 调模型设置里的默认 image provider 做 AI 生图（消耗积分/额度）
      //   'title-card' → 本地 ffmpeg 渲染动效标题卡，**不调 provider** ⇒ 不产生模型调用日志
      //                  ⇒ 不进入算力成本归集 ⇒ 不消耗积分（表现形式单一：只是图片展示文字）
      // 下游读的是 `firstDefined(params.visualMode, stage.options?.visualMode, 'ai')`，
      // params 优先；这里再写进 innerOptions 是双保险（params 被别处剥离时仍能生效）。
      const visualMode = params?.visualMode === 'title-card' ? 'title-card' : 'ai'
      if (visualMode === 'title-card') {
        // 标题卡模式**不填**默认 image provider：这是「关掉 AI 生图」的第二道防线。
        // 第一道在下游 story2video_generate_assets（按模式显式置空 resolvedImageProvider），
        // 但那是**单点**：若将来有人重构掉那一处，这里填进去的 provider 就会让标题卡
        // 静默变回 AI 生图（界面显示已切换、实际仍消耗算力成本，不报错不降级无痕迹）。
        // ⇒ 两层都不提供 provider，「关不掉」这条路在结构上就不存在。
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
        log.warn('ExplainerStages', 'generate_assets reuse failed: ' + inner.error)
      }
      return inner
    },
  )
  registered.push(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)

  // ----------------------------------------------------------
  // EDITING - 资源清单校验/透传（真实动效/转场由 compose 引擎执行）
  // ----------------------------------------------------------
  pipelineEngine.registerStageExecutor(
    EXPLAINER_STAGE_TYPES.EDITING,
    async ({ context }) => {
      const manifest = context.assets
      const scenes = manifest && Array.isArray(manifest.scenes) ? manifest.scenes : []
      if (scenes.length === 0) {
        return { success: false, error: 'animated-explainer editing 需要有效的资源清单（context.assets）' }
      }
      return { success: true, output: manifest }
    },
  )
  registered.push(EXPLAINER_STAGE_TYPES.EDITING)

  return { success: true, registered }
}

module.exports = {
  EXPLAINER_STAGE_TYPES,
  buildResearchPrompt,
  buildProposalPrompt,
  buildScriptPrompt,
  buildScenesPrompt,
  parseScenesJson,
  normalizeScenes,
  fallbackScenes,
  registerExplainerStages,
}
