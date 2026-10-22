// @ts-check
/**
 * pipeline-model-preflight.js — 编排流水线启动前的模型能力前置校验
 *
 * 契约：PipelineEngine.startOrchestrated 在 normalize 之后、start() 之前调用
 * checkPipelineModelRequirements()；返回 success=false 且
 * errorCode=PIPELINE_MODEL_REQUIREMENTS_MISSING 时不得创建 run、不得触发任何阶段执行。
 * 批量创作队列复用同一启动入口（story2video-batch-queue._startItem），自动遵守同一契约；
 * 断点续跑（resumeOrchestration）不做前置拦截。
 *
 * 校验语义与运行时模型解析一致（见 openspec/specs/pipeline-model-preflight 规格）：
 * - 未显式指定 provider → ModelProviderManager.getDefault(capability)（含多模态能力默认与
 *   capability_enabled.video 规则，getDefault 已封装）。
 * - 显式指定 provider → getProviderWithKey(id) + hasUsableApiKey / canUseWithoutApiKey
 *   （本地免 Key provider：piper / local-diffusion / comfyui + loopback base_url），与
 *   callAdapter 的凭据判定一致，不做 enabled 强校验。
 * - 模型管理器缺失/未初始化 → fail-open 跳过并告警，保持既有启动行为。
 *
 * 映射一致性：STATIC_PIPELINE_REQUIREMENTS 的每一项注释标注阶段执行器中的实际解析点；
 * 修改各 *-stages.js 模型调用的 PR 必须同步本表与规格（openspec/specs/pipeline-model-preflight）。
 */

const { hasUsableApiKey, canUseWithoutApiKey } = require('./model-provider-manager')

const PIPELINE_MODEL_REQUIREMENTS_MISSING = 'PIPELINE_MODEL_REQUIREMENTS_MISSING'

/**
 * 数字人流水线的机器名与 provider（与 videogen-stages.js 的
 * AVATAR_PIPELINE / DIGITAL_HUMAN_PROVIDER 保持一致，避免两处漂移）。
 */
const DIGITAL_HUMAN_PIPELINE = 'avatar-spokesperson'
const DIGITAL_HUMAN_PROVIDER = 'heygen'
const AVATAR_ID_REQUIRED = 'AVATAR_ID_REQUIRED'
const AVATAR_VOICE_REQUIRED = 'AVATAR_VOICE_REQUIRED'
const AVATAR_CLONE_UNAVAILABLE = 'AVATAR_CLONE_UNAVAILABLE'

// 能力标识（同时是 model_providers.category，与 renderer 能力标签键一致）
const CAPABILITIES = Object.freeze({
  LLM: 'llm',
  IMAGE: 'image',
  VIDEO: 'video',
  TTS: 'tts',
  SPEECH_RECOGNITION: 'speech_recognition',
})

// 能力 → 中文标签（仅用于主进程错误摘要；renderer 弹窗文案走 locales 能力标签表）
const CAPABILITY_LABELS = Object.freeze({
  [CAPABILITIES.LLM]: '推理模型',
  [CAPABILITIES.IMAGE]: '图片生成',
  [CAPABILITIES.VIDEO]: '视频模型',
  [CAPABILITIES.TTS]: 'TTS语音',
  [CAPABILITIES.SPEECH_RECOGNITION]: '语音识别',
})

const STORY2VIDEO_PIPELINE_NAME = 'story2video-compose'

/**
 * 静态流水线能力需求（story2video-compose 走动态规则，不在此表）。
 * 注释格式：能力 → 阶段执行器中的解析点（file:line 为写表时基线）。
 */
const STATIC_PIPELINE_REQUIREMENTS = Object.freeze({
  // LLM 规划链（explainer-stages.js callDefaultLlm，research/proposal/script/scenes）
  // + 图片/旁白素材生成（explainer-stages.js explainer_generate_assets:407 getDefaultProviderConfig image；
  //   TTS 走默认 provider → Edge TTS/静音兜底，免 Key，不列 tts）
  'animated-explainer': [CAPABILITIES.LLM, CAPABILITIES.IMAGE],
  // videogen-stages.js：CONCEPT/AVATAR/SCRIPT/STORYBOARD 均 callDefaultLlm（llm），
  // GENERATE 经 getVideoProviderConfig + callAdapter('generateVideo')（video）
  animation: [CAPABILITIES.LLM, CAPABILITIES.VIDEO],
  'avatar-spokesperson': [CAPABILITIES.LLM, CAPABILITIES.VIDEO],
  'character-animation': [CAPABILITIES.LLM, CAPABILITIES.VIDEO],
  hybrid: [CAPABILITIES.LLM, CAPABILITIES.VIDEO],
  // documentary-stages.js：research/ingest 用 callDefaultLlm（llm），documentary_edit 复用
  // story2video_generate_assets（image；TTS 同上免 Key 兜底）
  'documentary-montage': [CAPABILITIES.LLM, CAPABILITIES.IMAGE],
  // localization-stages.js：translate 用 callDefaultLlm（llm）；localization_tts 的
  // voiceProvider 为空时走默认 TTS → Edge TTS/静音兜底，仅显式非空 voiceProvider 时 +tts
  'localization-dub': [CAPABILITIES.LLM],
  // podcast-repurpose-stages.js：generate_assets 用 assetGenerator.generateImage（image）；
  // transcript 为空时 transcribeFile 语音识别（:111-122）→ +speech_recognition
  'podcast-repurpose': [CAPABILITIES.IMAGE],
  // 纯本地 FFmpeg/ffprobe（talkinghead-stages.js / cinematic-stages.js / clipfactory-stages.js）
  'talking-head': [],
  cinematic: [],
  'clip-factory': [],
  // smoketest-stages.js：验证工具链 + testsrc 合成，纯本地
  'framework-smoke': [],
  // screen-demo：屏幕录制流水线（PIPELINES 注册、无编排 stageDefs），纯本地
  'screen-demo': [],
  // film-engineering-stages.js 读取 params.llmEnabled（默认关）→ 开启时 +llm。
  // 2026-10-07 起该开关已从 UI 整体下线（ScriptAdapter 唯一生产构造点传 llm: null，
  // 启用判定要求 this.llm 非空，出厂构建恒 false）。本分支保留仅为 IPC 契约兼容：
  // 外部调用方仍可传 llmEnabled=true，此时仍会按老口径申报 LLM 能力依赖。
  // 若将来真接线，需同步撤销本行与 stages.js 的硬编码 llmEnabled=false。
  // 开启即要求 LLM，避免增强真正接入后缺少默认模型。
  'film-engineering': [],
})

function objectValue (value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function firstDefined (...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function nonEmptyString (value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

/** 静态流水线的显式 provider 输入（扁平参数；未提供时走默认解析）。 */
function explicitProviderFor (pipelineName, capability, params) {
  if (capability === CAPABILITIES.IMAGE) return nonEmptyString(params.imageProvider)
  if (capability === CAPABILITIES.VIDEO) return nonEmptyString(params.videoProvider)
  if (capability === CAPABILITIES.TTS) return nonEmptyString(params.voiceProvider)
  return ''
}

/**
 * 解析流水线所需模型能力（含显式 provider 标识）。
 * @param {string} pipelineName
 * @param {object} [params]
 * @returns {{ capabilities: string[], providers: Record<string,string> }}
 */
function resolvePipelineModelRequirements (pipelineName, params = {}) {
  const capabilities = []
  const providers = {}
  const push = (capability, provider) => {
    if (!capabilities.includes(capability)) capabilities.push(capability)
    const providerId = nonEmptyString(provider)
    if (providerId) providers[capability] = providerId
  }

  if (pipelineName === STORY2VIDEO_PIPELINE_NAME) {
    // story2video-compose 动态规则（参数为 startOrchestrated normalize 后的 story2videoTextConfig，
    // 回退扁平旧字段 videoMode/videoProvider/voiceProvider/imageProvider）：
    // - image 恒必需（generate_assets 必生成图片素材，失败时 ffmpeg 占位图降级仍消耗配置）
    // - video 仅 video.mode ∈ {fixed, ai-judged}（off 纯图片轮播不要求）
    // - llm 仅 video.mode=ai-judged（select_video_scenes AI 评估；optimize 走 prompt-engine 外部服务）
    // - tts 仅显式非空 voiceProvider（空 = 内置 Edge TTS 免 Key）
    const config = objectValue(params.story2videoTextConfig)
    const video = objectValue(config.video)
    const voice = objectValue(config.voice)
    const image = objectValue(config.image)
    const mode = nonEmptyString(firstDefined(video.mode, params.videoMode)) || 'off'

    push(CAPABILITIES.IMAGE, firstDefined(image.provider, params.imageProvider))
    if (mode === 'fixed' || mode === 'ai-judged') {
      push(CAPABILITIES.VIDEO, firstDefined(video.provider, params.videoProvider))
    }
    if (mode === 'ai-judged') push(CAPABILITIES.LLM, '')
    const ttsProvider = nonEmptyString(firstDefined(voice.provider, params.voiceProvider))
    if (ttsProvider) push(CAPABILITIES.TTS, ttsProvider)
    return { capabilities, providers }
  }

  for (const capability of STATIC_PIPELINE_REQUIREMENTS[pipelineName] || []) {
    push(capability, explicitProviderFor(pipelineName, capability, params))
  }
  if (pipelineName === 'localization-dub') {
    const voiceProvider = nonEmptyString(params.voiceProvider)
    if (voiceProvider) push(CAPABILITIES.TTS, voiceProvider)
  } else if (pipelineName === 'podcast-repurpose') {
    const transcript = typeof params.transcript === 'string' ? params.transcript.trim() : ''
    if (!transcript) push(CAPABILITIES.SPEECH_RECOGNITION, '')
  } else if (pipelineName === 'film-engineering') {
    if (params.llmEnabled) push(CAPABILITIES.LLM, '')
  }
  return { capabilities, providers }
}

/**
 * 前置校验入口。
 * @param {{getDefault?: Function, getProviderWithKey?: Function}|null} modelProviderManager
 * @param {string} pipelineName
 * @param {object} [params]
 * @param {{warn?: Function}} [log]
 * @returns {{success: boolean, checked?: boolean, unmapped?: boolean, errorCode?: string, errorParams?: object, error?: string}}
 */
function isSafeAvatarId (value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim().length <= 256
}

/**
 * 数字人流水线（avatar-spokesperson）的专项前置校验。
 *
 * 为什么单独校验而不只靠 [llm, video] 能力表：那个组合对「配了任意通用
 * 视频模型」也成立 —— 用户配了 Kling 也会被判「数字人可用」，但真跑到
 * generate 阶段会因为 HeyGen 未配置而失败。这是 PRD §1.2 记录的假阳性来源。
 *
 * 校验顺序刻意先查参数再查 provider：参数缺失是用户能立刻修正的，
 * _provider 缺失需要跳转设置页，把可即时修正的放前面能减少一次往返。
 *
 * @returns {{success: boolean, errorCode?: string, error?: string}}
 */
/**
 * 读取指定 avatarId 的克隆产物状态（同步，只读本地 registry）。
 *
 * 设计取舍：
 *  - 同步：启动路径 checkPipelineModelRequirements 是同步的，不为此改异步；
 *  - 只读本地：生命周期设计是「本地 registry 为权威」，失效标记在列表时已写好
 *    （buildPublicCloneEntries），无需启动前再查一次远端；
 *  - fail-open：探子未注入、抛错、返回形状不符，一律视为「不是克隆产物」，
 *    不因探子故障误拦用户（与 checkPipelineModelRequirements 的 fail-open 同调）。
 *
 * @returns {{unavailable: boolean, reason?: string}}
 */
function readCloneAvatarState (modelProviderManager, avatarId) {
  if (typeof modelProviderManager.listAvatarClonesSync !== 'function') {
    return { unavailable: false }
  }
  let result
  try {
    result = modelProviderManager.listAvatarClonesSync()
  } catch (_) {
    return { unavailable: false }
  }
  if (!result || result.code !== 0 || !result.data || !Array.isArray(result.data.avatars)) {
    return { unavailable: false }
  }
  const clone = result.data.avatars.find((item) => item && item.id === avatarId)
  if (!clone) return { unavailable: false }
  if (clone.invalidReason) return { unavailable: true, reason: clone.invalidReason }
  if (clone.trainingState === 'failed') return { unavailable: true, reason: 'training_failed' }
  return { unavailable: false }
}

function checkDigitalHumanRequirements (modelProviderManager, params) {
  if (!isSafeAvatarId(params.avatarId)) {
    return { success: false, errorCode: AVATAR_ID_REQUIRED, error: '请先选择数字人形象后再启动流水线。' }
  }
  if (!isSafeAvatarId(params.voiceId)) {
    return { success: false, errorCode: AVATAR_VOICE_REQUIRED, error: '请先选择数字人音色后再启动流水线。' }
  }
  // 克隆产物失效（change: avatar-voice-clone）：克隆形象与公共目录同形同键，
  // 但多了 training_failed / 远端已不存在两种失效态。若不在启动前拦下，
  // 会一路跑到 generate 阶段才炸，用户看到的是「生成失败」而非「形象不可用」。
  // 探子由 container 注入（listAvatarClonesSync）；未注入时 fail-open，
  // 不影响未装克隆功能的构建与既有测试。
  const cloneState = readCloneAvatarState(modelProviderManager, params.avatarId)
  if (cloneState.unavailable) {
    return {
      success: false,
      errorCode: AVATAR_CLONE_UNAVAILABLE,
      error: cloneState.reason === 'training_failed'
        ? '启动被拦截：该克隆数字人形象训练失败，请删除后重新创建，或改用其他形象。'
        : '启动被拦截：该克隆数字人形象在 HeyGen 侧已不存在，请删除本地记录后重新创建。',
    }
  }
  // provider 可用性：显式 videoProvider 优先，否则固定 HeyGen
  const explicit = nonEmptyString(params.videoProvider)
  const providerId = explicit || DIGITAL_HUMAN_PROVIDER
  const provider = typeof modelProviderManager.getProviderWithKey === 'function'
    ? modelProviderManager.getProviderWithKey(providerId)
    : null
  const ok = Boolean(provider && (hasUsableApiKey(provider.api_key) || canUseWithoutApiKey(provider)))
  if (!ok) {
    return {
      success: false,
      errorCode: PIPELINE_MODEL_REQUIREMENTS_MISSING,
      errorParams: { missing: ['video'], providers: { video: providerId } },
      error: '启动被拦截：数字人视频生成需要 HeyGen 模型，请到「模型设置」中配置 HeyGen 后重试。',
    }
  }
  return { success: true }
}

function checkPipelineModelRequirements (modelProviderManager, pipelineName, params = {}, log) {
  // Fail-open 边界：管理器缺失/未初始化（如纯引擎单测环境）时跳过校验并告警，
  // 不把环境问题误报为用户模型缺失；生产链路（container.setup + phase1）恒注入已初始化管理器。
  const managerReady = Boolean(
    modelProviderManager &&
    typeof modelProviderManager.getDefault === 'function' &&
    typeof modelProviderManager.getProviderWithKey === 'function' &&
    modelProviderManager._ready !== false,
  )
  if (!managerReady) {
    if (log && typeof log.warn === 'function') {
      log.warn('PipelinePreflight', 'modelProviderManager 不可用，跳过启动前模型能力校验（pipeline=' + pipelineName + '）')
    }
    return { success: true, checked: false }
  }

  if (pipelineName !== STORY2VIDEO_PIPELINE_NAME && !(pipelineName in STATIC_PIPELINE_REQUIREMENTS)) {
    // 未登记流水线 fail-open：不误伤未来/自定义流水线，但告警提示补映射。
    if (log && typeof log.warn === 'function') {
      log.warn('PipelinePreflight', '未知流水线无模型能力映射，放行并请补充映射: ' + pipelineName)
    }
    return { success: true, checked: true, unmapped: true }
  }

  // 数字人流水线专项校验（PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19）：
  // 放在通用能力校验之前，让「参数缺失」这类用户可立即修正的问题优先暴露。
  if (pipelineName === DIGITAL_HUMAN_PIPELINE) {
    const digitalHuman = checkDigitalHumanRequirements(modelProviderManager, params)
    if (!digitalHuman.success) {
      return { success: false, checked: true, ...digitalHuman }
    }
  }

  const { capabilities, providers } = resolvePipelineModelRequirements(pipelineName, params)
  // 数字人流水线的 video 能力已由专项校验（HeyGen 可用性）覆盖：这里再从
  // capabilities 里剔除，避免「默认 video 是别的模型」这种无关状态再拦一次。
  // llm（写口播文案）仍需校验。
  const effectiveCapabilities = pipelineName === DIGITAL_HUMAN_PIPELINE
    ? capabilities.filter((capability) => capability !== CAPABILITIES.VIDEO)
    : capabilities
  const effectiveProviders = { ...providers }
  if (pipelineName === DIGITAL_HUMAN_PIPELINE) delete effectiveProviders[CAPABILITIES.VIDEO]

  const missing = []
  const missingProviders = {}
  for (const capability of effectiveCapabilities) {
    const providerId = effectiveProviders[capability]
    let ok
    if (providerId) {
      // 显式 provider：凭据可用（可解密 API Key 或本地免 Key provider），与 callAdapter 判定一致
      const provider = modelProviderManager.getProviderWithKey(providerId)
      ok = Boolean(provider && (hasUsableApiKey(provider.api_key) || canUseWithoutApiKey(provider)))
      if (!ok) missingProviders[capability] = providerId
    } else {
      // 默认解析：多模态能力默认 / capability_enabled.video 规则已由 getDefault 封装
      ok = modelProviderManager.getDefault(capability) !== null
    }
    if (!ok) missing.push(capability)
  }

  if (missing.length === 0) return { success: true, checked: true }
  return {
    success: false,
    checked: true,
    errorCode: PIPELINE_MODEL_REQUIREMENTS_MISSING,
    errorParams: {
      missing,
      providers: missingProviders,
    },
    error: '启动被拦截：缺少模型能力 ' +
      missing.map((capability) => CAPABILITY_LABELS[capability] || capability).join('、') +
      '。请到「模型设置」中添加对应模型后重试。',
  }
}

module.exports = {
  checkPipelineModelRequirements,
  checkDigitalHumanRequirements,
  resolvePipelineModelRequirements,
  STATIC_PIPELINE_REQUIREMENTS,
  PIPELINE_MODEL_REQUIREMENTS_MISSING,
  AVATAR_ID_REQUIRED,
  AVATAR_VOICE_REQUIRED,
  DIGITAL_HUMAN_PIPELINE,
  DIGITAL_HUMAN_PROVIDER,
}
