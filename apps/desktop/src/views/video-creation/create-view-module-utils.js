// @ts-check
/**
 * CreateView 模块级纯函数/常量（createview-split 第一批：createview-split 技术债拆分）
 *
 * 从 CreateView.vue 模块级区域机械搬出（零行为变更）：
 * pipeline stage/snapshot 归一化与合并、S2V 配置快照字段挑选、历史请求超时竞速、
 * 平台/风格/阶段枚举。全部为纯函数与冻结常量，无组件实例依赖。
 */

const HISTORY_LOAD_TIMEOUT_MS = 5000
const STORY2VIDEO_OUTPUT_ASPECT_RATIOS = Object.freeze({
  '720x1280': '9:16',
  '1920x1080': '16:9',
  '3840x2160': '16:9',
  '1080x1920': '9:16',
  '1080x1440': '3:4',
})

// 已实现真实执行引擎的流水线（与 pipeline-engine 注册表 available 字段保持一致；此处为前端兜底）
const IMPLEMENTED_PIPELINES = ['story2video-compose', 'animated-explainer', 'talking-head', 'cinematic', 'clip-factory', 'framework-smoke', 'documentary-montage', 'localization-dub', 'animation', 'avatar-spokesperson', 'character-animation', 'hybrid']

const PIPELINE_TERMINAL_STATUSES = Object.freeze(['idle', 'completed', 'failed', 'cancelled'])
const PIPELINE_END_STATUSES = Object.freeze(['completed', 'failed', 'cancelled'])
const PIPELINE_RUN_STATUSES = Object.freeze(['idle', 'pending', 'running', 'paused', 'waiting_approval', 'needs_user_input', 'completed', 'failed', 'cancelled'])
const PIPELINE_STAGE_STATUSES = Object.freeze(['pending', 'running', 'completed', 'skipped', 'failed', 'cancelled', 'paused', 'waiting_approval', 'needs_user_input'])

function normalizeProgressPercent(value, fallback = null) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function normalizePipelineStage(stage) {
  if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return null
  const name = typeof stage.name === 'string' && stage.name.trim()
    ? stage.name.trim()
    : (typeof stage.stage === 'string' && stage.stage.trim() ? stage.stage.trim() : '')
  if (!name) return null
  if (typeof stage.status !== 'string' || !PIPELINE_STAGE_STATUSES.includes(stage.status)) return null
  const status = stage.status
  const progress = stage.progress && typeof stage.progress === 'object' && !Array.isArray(stage.progress)
    ? { ...stage.progress }
    : null
  if (progress) {
    const percent = normalizeProgressPercent(progress.percent)
    if (percent === null) delete progress.percent
    else progress.percent = percent
  }
  return { ...stage, name, status, ...(progress ? { progress } : {}) }
}

function normalizePipelineStages(stages, fallback = []) {
  const source = Array.isArray(stages) ? stages : fallback
  return source.map(normalizePipelineStage).filter(Boolean)
}

function pipelineStageKey(stage, index) {
  if (!stage || typeof stage !== 'object') return String(index)
  return String(stage.id || stage.name || stage.stage || index)
}

function mergePipelineStages(previousStages, incomingStages) {
  const previous = Array.isArray(previousStages) ? previousStages : []
  if (!Array.isArray(incomingStages)) return previous
  if (previous.length === 0) return incomingStages

  // Progress-only events may contain only the active stage. Preserve the rest of
  // the last complete snapshot while merging fields supplied by the event.
  const incomingByKey = new Map(incomingStages.map((stage, index) => [pipelineStageKey(stage, index), stage]))
  if (incomingStages.length >= previous.length) {
    return incomingStages.map((stage, index) => {
      const previousStage = previous.find((item, previousIndex) => pipelineStageKey(item, previousIndex) === pipelineStageKey(stage, index))
      if (!previousStage || typeof previousStage !== 'object') return stage
      return {
        ...previousStage,
        ...stage,
        ...(previousStage.progress || stage.progress
          ? { progress: { ...(previousStage.progress || {}), ...(stage.progress || {}) } }
          : {}),
      }
    })
  }
  return previous.map((stage, index) => {
    const incoming = incomingByKey.get(pipelineStageKey(stage, index))
    if (!incoming || typeof incoming !== 'object') return stage
    return {
      ...stage,
      ...incoming,
      ...(stage.progress || incoming.progress
        ? { progress: { ...(stage.progress || {}), ...(incoming.progress || {}) } }
        : {}),
    }
  })
}

function normalizePipelineStatusSnapshot(snapshot, fallbackStages = []) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  if (typeof snapshot.status !== 'string' || !snapshot.status.trim()) return null
  const status = snapshot.status.trim()
  if (!PIPELINE_RUN_STATUSES.includes(status)) return null
  const stages = normalizePipelineStages(snapshot.stages, fallbackStages)
  const progress = normalizeProgressPercent(snapshot.progress, null)
  const checkpoint = snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
    ? { ...snapshot.checkpoint }
    : null
  return {
    ...snapshot,
    status,
    ...(progress === null ? {} : { progress }),
    stages,
    checkpoint,
  }
}

function hasManualPipelineCheckpoint(snapshot, needsCheckpoint = false, context = null) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return Boolean(needsCheckpoint)
  const checkpoint = snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
    ? snapshot.checkpoint
    : null
  const checkpointKinds = new Set(['scene_asset_selection', 'content_policy', 'needs_user_input', 'waiting_approval', 'approval'])
  const checkpointType = String(checkpoint?.type || '').trim().toLowerCase()
  const checkpointReason = String(checkpoint?.reason || '').trim().toLowerCase()
  if (checkpointKinds.has(checkpointType) || checkpointKinds.has(checkpointReason)) return true
  if (snapshot.status === 'waiting_approval' || snapshot.status === 'needs_user_input') return true
  const snapshotContext = snapshot.context && typeof snapshot.context === 'object' && !Array.isArray(snapshot.context)
    ? snapshot.context
    : null
  const contextCandidates = context?.generate_assets?.candidates || snapshotContext?.generate_assets?.candidates
  // 旧版暂停快照可能丢失 checkpoint 元数据，但保留了待选素材清单。
  // 这只能证明“需要人工处理”，不能证明 confirmSceneAssets 协议仍可用，
  // 因此调用方只禁用后台脱离，不凭空渲染可提交的选择表单。
  if (snapshot.status === 'paused' && Array.isArray(contextCandidates) && contextCandidates.length > 0) return true
  const stages = Array.isArray(snapshot.stages) ? snapshot.stages : []
  return Boolean(needsCheckpoint || stages.some(stage => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return false
    const status = String(stage.status || '').trim().toLowerCase()
    if (!['paused', 'waiting_approval', 'needs_user_input'].includes(status)) return false
    const stageType = String(stage.checkpointType || stage.checkpoint || '').trim().toLowerCase()
    const stageName = String(stage.name || stage.stage || '').trim().toLowerCase()
    return stage.requiresCheckpoint === true
      || checkpointKinds.has(stageType)
      || stageName === 'finalize_assets'
  }))
}

function hasLegacyPipelineCheckpointEvidence(snapshot, context = null) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
  const checkpoint = snapshot.checkpoint && typeof snapshot.checkpoint === 'object' && !Array.isArray(snapshot.checkpoint)
    ? snapshot.checkpoint
    : null
  if (checkpoint?.type || checkpoint?.reason) return false

  const snapshotContext = snapshot.context && typeof snapshot.context === 'object' && !Array.isArray(snapshot.context)
    ? snapshot.context
    : null
  const contextCandidates = context?.generate_assets?.candidates || snapshotContext?.generate_assets?.candidates
  if (snapshot.status === 'paused' && Array.isArray(contextCandidates) && contextCandidates.length > 0) return true

  const checkpointKinds = new Set(['scene_asset_selection', 'content_policy', 'needs_user_input', 'waiting_approval', 'approval'])
  const stages = Array.isArray(snapshot.stages) ? snapshot.stages : []
  return stages.some(stage => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return false
    const status = String(stage.status || '').trim().toLowerCase()
    const stageType = String(stage.checkpointType || stage.checkpoint || '').trim().toLowerCase()
    const stageName = String(stage.name || stage.stage || '').trim().toLowerCase()
    return ['paused', 'waiting_approval', 'needs_user_input'].includes(status)
      && (stage.requiresCheckpoint === true || checkpointKinds.has(stageType) || stageName === 'finalize_assets')
  })
}

function normalizePipelineRunMeta(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { valid: false, value: null }
  const invalidMeta = Symbol('invalid-pipeline-meta')
  const metaKeys = ['createdAt', 'endedAt', 'outputSizeBytes', 'activeMs', 'activeSegmentStartedAt']
  const fields = metaKeys.filter(key => Object.prototype.hasOwnProperty.call(snapshot, key))
  const readNonNegative = (key) => {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key) || snapshot[key] === null || snapshot[key] === undefined || snapshot[key] === '') return null
    const numeric = Number(snapshot[key])
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : invalidMeta
  }
  const activeMs = readNonNegative('activeMs')
  const outputSizeBytes = readNonNegative('outputSizeBytes')
  if (activeMs === invalidMeta || outputSizeBytes === invalidMeta) {
    return { valid: false, value: null }
  }
  const readDate = (key) => {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key) || snapshot[key] === null || snapshot[key] === undefined || snapshot[key] === '') return null
    return typeof snapshot[key] === 'string' ? snapshot[key] : null
  }
  return {
    valid: true,
    fields,
    value: {
      createdAt: readDate('createdAt'),
      endedAt: readDate('endedAt'),
      outputSizeBytes,
      activeMs,
      activeSegmentStartedAt: readDate('activeSegmentStartedAt'),
    },
  }
}

function mergePipelineRunMeta(previous, result) {
  if (!result?.valid) return previous || null
  const fields = Array.isArray(result.fields) ? result.fields : []
  if (fields.length === 0) return previous || null
  const merged = { ...(previous && typeof previous === 'object' ? previous : {}) }
  for (const field of fields) merged[field] = result.value[field]
  return merged
}

function createPipelineRunMeta(createdAt = new Date().toISOString()) {
  return {
    createdAt: typeof createdAt === 'string' && createdAt ? createdAt : new Date().toISOString(),
    endedAt: null,
    outputSizeBytes: null,
    activeMs: null,
    activeSegmentStartedAt: null,
  }
}

function createPipelineRunMetaFromSnapshot(snapshot = {}) {
  const base = createPipelineRunMeta(snapshot?.createdAt)
  const result = normalizePipelineRunMeta(snapshot)
  return mergePipelineRunMeta(base, result) || base
}

function normalizePipelineContext(snapshot, fallback = null) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { valid: false, value: null }
  if (!Object.prototype.hasOwnProperty.call(snapshot, 'context')) return { valid: true, value: fallback, provided: false }
  const context = snapshot.context
  if (context === null || context === undefined) return { valid: true, value: null, provided: true }
  if (typeof context !== 'object' || Array.isArray(context)) return { valid: false, value: null, provided: true }
  return { valid: true, value: context, provided: true }
}

const VIDEO_CLONE_PIPELINE_ENTRY = {
  name: 'video-clone', category: 'generated', stageCount: 6, available: true, estimatedCost: 'medium',
}

const FILM_ENGINEERING_PIPELINE_ENTRY = {
  name: 'film-engineering', category: 'generated', stageCount: 4, available: true, estimatedCost: 'low',
}

function withVideoCloneEntry(pipelines) {
  const base = prioritizeStory2VideoPipeline(pipelines).filter((p) => p && p.name !== 'video-clone' && p.name !== 'film-engineering')
  const idx = base.findIndex((p) => p.name === 'story2video-compose')
  base.splice(idx >= 0 ? idx + 1 : 0, 0, VIDEO_CLONE_PIPELINE_ENTRY)
  base.splice(idx >= 0 ? idx + 2 : 1, 0, FILM_ENGINEERING_PIPELINE_ENTRY)
  return base
}

function prioritizeStory2VideoPipeline(pipelines) {
  const values = Array.isArray(pipelines) ? pipelines : []
  return [
    ...values.filter(pipeline => pipeline?.name === 'story2video-compose'),
    ...values.filter(pipeline => pipeline?.name !== 'story2video-compose'),
  ]
}

function getStory2VideoOutputAspectRatio(resolution) {
  return STORY2VIDEO_OUTPUT_ASPECT_RATIOS[resolution] || '9:16'
}

function settleHistoryRequest (request) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(Object.assign(new Error('历史记录加载超时'), { code: 'HISTORY_LOAD_TIMEOUT' })), HISTORY_LOAD_TIMEOUT_MS)
  })
  return Promise.race([Promise.resolve().then(request), timeout]).finally(() => clearTimeout(timeoutId))
}

const STYLES = [
  { value: 'clean-professional', label: '简洁专业', desc: '干净排版，适合商业内容' },
  { value: 'flat-motion-graphics', label: '扁平动效', desc: '现代扁平化动画风格' },
  { value: 'anime-ghibli', label: '吉卜力动漫', desc: '温暖的手绘动漫质感' },
  { value: 'minimalist-diagram', label: '极简图表', desc: '数据可视化优先' },
  { value: 'cinematic-dark', label: '电影暗调', desc: '深色电影感渲染' },
]

const STORY2VIDEO_STAGE_NAMES = Object.freeze([
  'split',
  'scene_context',
  'optimize',
  'select_video_scenes',
  'generate_assets',
  'compose',
  'publish',
])

// 自动流水线的真实阶段名（列表接口不返回 stages，按流水线名映射，避免回退到 s2v 阶段名）
const AUTO_PIPELINE_STAGES = Object.freeze({
  'story2video-compose': STORY2VIDEO_STAGE_NAMES,
  'animated-explainer': ['research', 'proposal', 'script', 'scenes', 'assets', 'editing', 'compose', 'publish'],
  'framework-smoke': ['verify', 'report'],
  'documentary-montage': ['research', 'ingest', 'edit', 'narrate', 'render'],
  'localization-dub': ['transcribe', 'translate', 'tts', 'sync'],
  'animation': ['concept', 'storyboard', 'animate', 'render'],
  'avatar-spokesperson': ['avatar_select', 'script', 'generate', 'render'],
  'character-animation': ['character_design', 'rigging', 'animate', 'render'],
  'hybrid': ['plan', 'generate', 'merge', 'render'],
})

const S2V_PLATFORMS = [
  { value: 'douyin', label: '抖音' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'bilibili', label: 'Bilibili' },
  { value: 'wechat', label: '微信视频号' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
]

// 恢复「上次使用的选项」时对下拉枚举字段做白名单校验：陈旧快照值（如旧版本或手工写入的
// imageStyle）不在当前选项列表时回退到 data() 默认值，避免下拉框出现空白选中项（2026-08-10 Bug 反哺）。
const S2V_RESTORE_ENUM_OPTIONS = Object.freeze({
  contentType: ['general', 'history'],
  videoMode: ['off', 'fixed', 'ai-judged'],
  shortVideoHandling: ['loop', 'stop-at-end'],
  creationMode: ['auto', 'manual'],
  manualMaterialMode: ['all-images', 'video-image'],
  imageStyle: ['cinematic', 'realistic', 'anime', 'watercolor', 'minimalist'],
  promptStyle: ['realistic', 'cinematic', 'anime', 'watercolor', 'minimalist'],
  imageEffect: ['none', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'zoom-pan', 'rotate', 'blur-in'],
  transition: ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down'],
  subtitleSize: ['size1', 'size2', 'size3', 'size4', 'size5', 'size6'],
  subtitleStyleName: ['style1', 'style2', 'style3'],
  splitLanguage: ['auto', 'zh', 'en'],
  splitMode: ['fast', 'balanced', 'precise'],
  splitViewMode: ['seconds', 'chars'],
})
const S2V_RESTORE_OUTPUT_ENUM_OPTIONS = Object.freeze({
  fps: [24, 30, 60],
  format: ['mp4', 'webm'],
})

// 配置快照必须显式列出可复用的创作选项。不要把整个 reactive s2vConfig
// 写入本地文件：其中同时包含本地素材路径、发布内容和运行时状态。
const S2V_CONFIG_PROFILE_FIELDS = Object.freeze([
  'contentType', 'imageProvider', 'imageModel', 'imageStyle', 'promptStyle',
  'imageEffect', 'templateId', 'videoMode', 'shortVideoHandling', 'videoProvider', 'videoModel',
  'videoFixedRatio', 'videoMinRatio', 'videoMaxRatio', 'videoMaxScenes',
  'creationMode', 'manualMaterialMode',
  'voiceId', 'voiceProvider', 'voiceModel', 'voiceSpeed', 'voiceVolume',
  'splitLanguage', 'splitMode', 'splitMaxSentenceLength', 'splitTargetSeconds',
  'splitTargetCharsPerScene', 'splitViewMode', 'splitMinWords', 'splitMaxWords',
  'splitEnforceSentenceBoundary', 'splitOverflowToNext', 'sceneDurationMode', 'minSceneDuration',
  'splitSubtitleMinChars', 'splitSubtitleMaxChars', 'splitSubtitleTiming',
  'negativePrompt', 'maxPromptLength', 'transition', 'subtitleEnabled', 'subtitleSize',
  'subtitleStyleName', 'bgmVolume', 'watermark', 'watermarkText',
])
const S2V_CONFIG_PROFILE_OBJECT_FIELDS = Object.freeze({
  watermarkConfig: Object.freeze(['enabled', 'position', 'fontSize', 'opacity', 'color']),
  subtitleStyle: Object.freeze(['size', 'style', 'color']),
})

function cloneJsonValue(value) {
  try { return JSON.parse(JSON.stringify(value)) } catch (_) { return undefined }
}

function pickS2VConfigProfileFields(source) {
  const output = {}
  const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  for (const field of S2V_CONFIG_PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue
    const cloned = cloneJsonValue(input[field])
    if (cloned !== undefined) output[field] = cloned
  }
  for (const [field, allowedKeys] of Object.entries(S2V_CONFIG_PROFILE_OBJECT_FIELDS)) {
    const value = input[field]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const picked = {}
    for (const key of allowedKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      const cloned = cloneJsonValue(value[key])
      if (cloned !== undefined) picked[key] = cloned
    }
    output[field] = picked
  }
  return output
}

function pickS2VOutputProfileFields(source) {
  const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {}
  return {
    ...(Object.prototype.hasOwnProperty.call(input, 'resolution') ? { resolution: cloneJsonValue(input.resolution) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'fps') ? { fps: cloneJsonValue(input.fps) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'format') ? { format: cloneJsonValue(input.format) } : {}),
  }
}

const CATEGORY_LABELS = {
  generated: 'AI 生成', talking_head: '说话头像', cinematic: '电影感',
  animation: '动画', screen_recording: '屏幕录制', hybrid: '混合', custom: '自定义'
}
const COST_LABELS = { low: '低消耗', medium: '中等', high: '高消耗' }
const STABILITY_MAP = {
  'cinematic': 'production', 'animated-explainer': 'production', 'talking-head': 'beta',
  'documentary-montage': 'beta', 'clip-factory': 'beta', 'screen-demo': 'beta',
  'podcast-repurpose': 'experimental', 'localization-dub': 'experimental',
  'avatar-spokesperson': 'experimental', 'character-animation': 'experimental',
  'animation': 'experimental', 'hybrid': 'experimental', 'framework-smoke': 'experimental'
}

export {
  HISTORY_LOAD_TIMEOUT_MS,
  STORY2VIDEO_OUTPUT_ASPECT_RATIOS,
  IMPLEMENTED_PIPELINES,
  PIPELINE_TERMINAL_STATUSES,
  PIPELINE_END_STATUSES,
  PIPELINE_RUN_STATUSES,
  PIPELINE_STAGE_STATUSES,
  normalizeProgressPercent,
  normalizePipelineStage,
  normalizePipelineStages,
  pipelineStageKey,
  mergePipelineStages,
  normalizePipelineStatusSnapshot,
  hasManualPipelineCheckpoint,
  hasLegacyPipelineCheckpointEvidence,
  normalizePipelineRunMeta,
  mergePipelineRunMeta,
  createPipelineRunMeta,
  createPipelineRunMetaFromSnapshot,
  normalizePipelineContext,
  VIDEO_CLONE_PIPELINE_ENTRY,
  FILM_ENGINEERING_PIPELINE_ENTRY,
  withVideoCloneEntry,
  prioritizeStory2VideoPipeline,
  getStory2VideoOutputAspectRatio,
  settleHistoryRequest,
  STYLES,
  STORY2VIDEO_STAGE_NAMES,
  AUTO_PIPELINE_STAGES,
  S2V_PLATFORMS,
  S2V_RESTORE_ENUM_OPTIONS,
  S2V_RESTORE_OUTPUT_ENUM_OPTIONS,
  S2V_CONFIG_PROFILE_FIELDS,
  S2V_CONFIG_PROFILE_OBJECT_FIELDS,
  cloneJsonValue,
  pickS2VConfigProfileFields,
  pickS2VOutputProfileFields,
  CATEGORY_LABELS,
  COST_LABELS,
  STABILITY_MAP,
}
