// @ts-check
'use strict'

const crypto = require('crypto')
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { promisify } = require('util')
const {
  IMPORTED_MEDIA_DIR,
  MAX_AUDIO_FILE_BYTES,
  MAX_IMAGE_FILE_BYTES,
  getAllowedMediaRoots,
  isPathWithin,
  resolveReadableFile,
  resolveReadableMediaFile,
} = require('./story2video-paths')
const {
  STORY2VIDEO_TEXT_CONFIG_VERSION,
  normalizeStory2VideoTextParams,
} = require('./story2video-text-config')
const { splitSubtitleBlocks } = require('./story2video-segmentation')
const {
  generateSceneVideo: generateAiSceneVideo,
  estimateSceneSeconds,
  withAssetTransientRetry,
  buildOptimizeContext,
} = require('./story2video-stages')
const {
  PROMPT_ENGINE_LIMITS,
  buildPromptEngineOptimizeRequest,
} = require('./prompt-engine-contract')
const { VIDEO_ENGINE_LIMITS } = require('./video-prompt-engine-contract')
const {
  IMAGE_PROVIDER_ALIASES,
} = require('./asset-generator')
const { LEGACY_OWNER_SUBJECT } = require('./store-schema')
const { findFfmpeg } = require('./media-tool-paths')
const { resolveProviderDefaultModel } = require('./model-provider-manager')

const SETTING_KEY = 'story2video_projects_v1'
const MAX_PROJECTS = 1000
// 具备真实编排产物（compose/export/render/report 输出）并需要项目持久化的流水线
const AUTO_PIPELINES = ['story2video-compose', 'animated-explainer', 'clip-factory', 'cinematic', 'framework-smoke', 'talking-head', 'documentary-montage', 'localization-dub', 'animation', 'avatar-spokesperson', 'character-animation', 'hybrid']
const MAX_VIDEO_BYTES = 512 * 1024 * 1024
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/
// 场景素材槽位身份：image1 = imagePath、image2 = alternateImages[0].path、video = videoPath
const MATERIAL_KINDS = ['image1', 'image2', 'video', 'video1', 'video2']
const THUMBNAIL_FILE_NAME = 'thumbnail-first-scene.jpg'
const THUMBNAIL_META_FILE_NAME = 'thumbnail-first-scene.json'
const THUMBNAIL_MAX_BYTES = 12 * 1024 * 1024
const THUMBNAIL_TIMEOUT_MS = 15000
const execFileAsync = promisify(execFile)

function isJpegFile (filePath) {
  try {
    const handle = fs.openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(3)
      const bytesRead = fs.readSync(handle, header, 0, header.length, 0)
      return bytesRead === 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    } finally {
      fs.closeSync(handle)
    }
  } catch (_) {
    return false
  }
}

/**
 * 解析输出分辨率字符串（如 720x1280 / 1080×1920），非法返回 null（与流水线 parseOutputSize 语义对齐）。
 */
function parseOutputSize (value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^\s*(\d{2,5})\s*[xX\u00d7]\s*(\d{2,5})\s*$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 160 || height < 160 || width > 4096 || height > 4096) return null
  return { width, height }
}

function getUserDataDir () {
  if (!process.versions.electron) return os.tmpdir()
  try {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') return app.getPath('userData')
  } catch (_) { /* 纯 Node 环境 */ }
  return os.tmpdir()
}

function safeText (value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function nextUpdatedAt (previous) {
  const previousMs = typeof previous === 'number' && Number.isFinite(previous)
    ? (Math.abs(previous) < 1e11 ? previous * 1000 : previous)
    : Date.parse(typeof previous === 'string' ? previous : '')
  const nextMs = Math.max(
    Date.now(),
    Number.isFinite(previousMs) ? previousMs + 1 : 0,
  )
  return new Date(nextMs).toISOString()
}

function safeAssetMeta (value) {
  if (!value || typeof value !== 'object') return null
  const meta = {
    source: safeText(value.source, 80),
    provider: safeText(value.provider, 80),
    model: safeText(value.model, 160),
    format: safeText(value.format, 20),
    degraded: value.degraded === true,
  }
  for (const key of ['sceneVideoPath', 'altSceneVideoPath']) {
    if (typeof value[key] === 'string' && value[key].trim()) meta[key] = safeText(value[key], 1000)
  }
  return Object.values(meta).some(Boolean) ? meta : null
}

function safePromptOptimizationMeta (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const meta = {}
  if (value.strategy_used === 'llm' || value.strategy_used === 'template') meta.strategy_used = value.strategy_used
  if (value.key_source === 'caller' || value.key_source === 'none') meta.key_source = value.key_source
  if (typeof value.cache_hit === 'boolean') meta.cache_hit = value.cache_hit
  if (typeof value.model_used === 'string' && value.model_used.trim()) meta.model_used = safeText(value.model_used, 160)
  if (typeof value.caller === 'string' && value.caller.trim()) meta.caller = safeText(value.caller, 80)
  if (typeof value.platform === 'string' && value.platform.trim()) meta.platform = safeText(value.platform, 80)
  if (typeof value.style === 'string' && value.style.trim()) meta.style = safeText(value.style, 80)
  return Object.keys(meta).length > 0 ? meta : null
}

function safeSubtitleBlocks (value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 200)
    .map(item => safeText(typeof item === 'string' ? item : item?.text, 500))
    .filter(Boolean)
}

function safeSubtitleTimeline (value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 200).map((item, position) => {
    if (!item || typeof item !== 'object') return null
    const text = safeText(item.text, 500)
    const startTime = Number(item.startTime)
    const endTime = Number(item.endTime)
    if (!text || !Number.isFinite(startTime) || !Number.isFinite(endTime) ||
        startTime < 0 || endTime <= startTime || endTime > 3600) {
      return null
    }
    return {
      index: Number.isInteger(item.index) && item.index >= 0 ? item.index : position,
      text,
      startTime,
      endTime,
      duration: endTime - startTime,
    }
  }).filter(Boolean)
}

function safeVoiceSpeed (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  // 与 story2video-text-config 权威契约一致：speechRate 0.5..2
  return Math.min(2, Math.max(0.5, number))
}

function safeVoicePitch (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  // 与 story2video-text-config 权威契约一致：pitch -12..12（0=中性、负值=低沉）
  return Math.min(12, Math.max(-12, number))
}

// 图片优化请求仅透传 prompt-engine 契约键（与流水线 buildPromptEngineOptimizeRequest 消费键一致），
// 避免把 story2videoTextConfig.config.optimize 中的 stage 元键（maxRetries/concurrency/uiLocale 等）透传。
const OPTIMIZE_STAGE_REQUEST_KEYS = Object.freeze(new Set([
  'platform', 'style', 'creative_level', 'creativeLevel',
  'optimization_strategy', 'optimizationStrategy',
  'bypass_cache', 'bypassCache',
  'negative_prompt', 'negativePrompt', 'num_candidates', 'numCandidates',
  'auto_detect_style', 'autoDetectStyle', 'quality_baseline',
]))

function safeOptimizeStageOptions (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const key of Object.keys(value)) {
    if (OPTIMIZE_STAGE_REQUEST_KEYS.has(key)) result[key] = value[key]
  }
  return result
}

/**
 * 从 prompt-engine 单条优化响应中提取优化后的提示词文本。
 * 与流水线消费端一致：结果结构为对象（prompt/optimized_prompt/optimized）、
 * 字符串、或 results[0] 数组包装；error/detail 存在即抛错（fail-closed，
 * 2026-08-16），防止引擎「错误兜底回显原文」（如 402）被当作成功写入分段；
 * 错误优先顺序对齐 prompt-engine-kernel.extractOptimizedBase（error → detail）。
 */
function extractOptimizedPromptResult (result) {
  if (typeof result === 'string') return { text: result, metaSource: null }
  const source = result && typeof result === 'object' && !Array.isArray(result) && result.data && typeof result.data === 'object'
    ? result.data
    : result
  if (source && typeof source === 'object') {
    // 错误优先：引擎失败兜底可能同时回显原文（同层或跨层），必须先判错再取文本
    const topError = source.error !== undefined && source.error !== null && source.error !== ''
      ? String(source.error)
      : (source.detail !== undefined && source.detail !== null && source.detail !== '' ? String(source.detail) : '')
    if (topError) throw new Error(topError || '提示词优化失败')
    if (Array.isArray(source.results)) {
      const item = source.results[0]
      if (typeof item === 'string') return { text: item, metaSource: null }
      if (item && typeof item === 'object') {
        const itemError = item.error !== undefined && item.error !== null && item.error !== ''
          ? String(item.error)
          : (item.detail !== undefined && item.detail !== null && item.detail !== '' ? String(item.detail) : '')
        if (itemError) throw new Error(itemError || '提示词优化失败')
        const text = item.optimized_prompt || item.prompt || item.optimized
        if (typeof text === 'string' && text.trim()) return { text, metaSource: item }
      }
      return { text: '', metaSource: item }
    }
    const text = source.optimized_prompt || source.prompt || source.optimized
    if (typeof text === 'string' && text.trim()) return { text, metaSource: source }
  }
  return { text: '', metaSource: source }
}

function extractOptimizedPrompt (result) {
  return extractOptimizedPromptResult(result).text
}

function extractImageOptimizedPrompt (result) {
  const extracted = extractOptimizedPromptResult(result)
  if (!extracted.text || !extracted.text.trim()) throw new Error('提示词优化结果无效')
  const source = extracted.metaSource
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('提示词优化结果缺少执行元数据')
  }
  if (source.strategy_used !== 'llm') {
    throw new Error('提示词优化结果 strategy_used 必须是 llm')
  }
  if (source.key_source !== 'caller') {
    throw new Error('提示词优化结果 key_source 必须是 caller')
  }
  if (source.cache_hit !== false) {
    throw new Error('提示词优化结果 cache_hit 必须是 false')
  }
  const meta = safePromptOptimizationMeta(source)
  if (!meta || meta.strategy_used !== 'llm' || meta.key_source !== 'caller' || meta.cache_hit !== false) {
    throw new Error('提示词优化结果执行元数据无效')
  }
  return { text: extracted.text, meta }
}

function safeAlternateImages (value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 1).map((item) => {
    if (!item || typeof item !== 'object') return null
    const pathValue = safeText(item.path, 1000)
    if (!pathValue) return null
    return { path: pathValue, meta: safeAssetMeta(item.meta) }
  }).filter(Boolean)
}

function safeMaterialKind (value) {
  return MATERIAL_KINDS.includes(value) ? value : null
}

function sourceExtension (filePath, fallback) {
  const extension = path.extname(String(filePath || '')).toLowerCase()
  return /^\.[a-z0-9]{2,5}$/.test(extension) ? extension : fallback
}

function providerBaseUrl (provider) {
  const nestedConfig = provider?.config && typeof provider.config === 'object' ? provider.config : {}
  const value = provider?.base_url || nestedConfig.baseUrl || nestedConfig.base_url
  return typeof value === 'string' ? value.trim() : ''
}

function resolveComposeOutput (context) {
  if (!context) return null
  const composeRaw = context.compose?.data || context.compose
  if (composeRaw && typeof composeRaw === 'object' && (composeRaw.videoPath || composeRaw.path)) return composeRaw
  // clip-factory 等流水线的导出输出位于 context.export
  const exportRaw = context.export?.data || context.export
  if (exportRaw && typeof exportRaw === 'object' && (exportRaw.videoPath || exportRaw.path)) return exportRaw
  // cinematic 等流水线的最终输出位于 context.render
  const renderRaw = context.render?.data || context.render
  if (renderRaw && typeof renderRaw === 'object' && (renderRaw.videoPath || renderRaw.path)) return renderRaw
  // framework-smoke 等流水线的输出位于 context.report
  const reportRaw = context.report?.data || context.report
  if (reportRaw && typeof reportRaw === 'object' && (reportRaw.videoPath || reportRaw.path)) return reportRaw
  return null
}

function copyFileAtomic (source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = destination + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL)
    const stat = fs.statSync(temporary)
    if (!stat.isFile() || stat.size <= 0) throw new Error('复制后的文件为空')
    if (fs.existsSync(destination)) fs.unlinkSync(destination)
    fs.renameSync(temporary, destination)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch (_) { /* ignore */ }
    throw error
  }
  return destination
}

function referencedProjectFiles (project) {
  const files = new Set()
  const add = (candidate) => {
    if (typeof candidate === 'string' && candidate.trim()) files.add(path.resolve(candidate))
  }
  add(project?.videoPath)
  add(project?.audioPath)
  add(project?.options?.bgmPath)
  for (const segment of Array.isArray(project?.segments) ? project.segments : []) {
    add(segment?.imagePath)
    add(segment?.audioPath)
    add(segment?.videoPath)
    for (const alternate of Array.isArray(segment?.alternateImages) ? segment.alternateImages : []) {
      add(alternate?.path)
    }
  }
  return files
}

function firstSceneThumbnailCandidates (project) {
  const firstSegment = Array.isArray(project?.segments) ? project.segments[0] : null
  if (!firstSegment || typeof firstSegment !== 'object') {
    return { images: [], videos: [] }
  }
  const images = [
    firstSegment.imagePath,
    ...(Array.isArray(firstSegment.alternateImages)
      ? firstSegment.alternateImages.map(item => item?.path)
      : []),
  ].filter(value => typeof value === 'string' && value.trim())
  const videos = [
    firstSegment.videoPath,
    firstSegment.videoMeta?.sceneVideoPath,
    firstSegment.videoMeta?.altSceneVideoPath,
  ].filter(value => typeof value === 'string' && value.trim())
  return { images, videos }
}

const MAX_PROJECT_MANIFEST_BYTES = 5 * 1024 * 1024

/**
 * 校验并读取「项目清单目录」：目录必须真实存在（非符号链接/联接）、目录名与 projectId
 * 同形（安全字符）、目录内存在可解析的 project.json 且 manifest.projectId 与目录名一致。
 * 返回解析后的 manifest，不满足任何条件返回 null。
 */
function readProjectManifestDir (candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(path.basename(candidate))) return null
  try {
    const stat = fs.lstatSync(candidate)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null
  } catch { return null }
  const manifestPath = path.join(candidate, 'project.json')
  let manifest
  try {
    const stat = fs.lstatSync(manifestPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_PROJECT_MANIFEST_BYTES) return null
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch { return null }
  if (!manifest || manifest.projectId !== path.basename(candidate)) return null
  return manifest
}

/** 收集 manifest 中引用的全部媒体绝对路径（含 options/textConfig 的 BGM 路径）。 */
function projectFileReferencePaths (manifest) {
  const refs = []
  const push = (value) => { if (typeof value === 'string' && value.trim()) refs.push(value.trim()) }
  push(manifest.videoPath)
  push(manifest.audioPath)
  push(manifest.bgmPath)
  const segments = Array.isArray(manifest.segments) ? manifest.segments : []
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue
    push(segment.imagePath)
    push(segment.audioPath)
    push(segment.videoPath)
    const alternates = Array.isArray(segment.alternateImages) ? segment.alternateImages : []
    for (const item of alternates) if (item && typeof item === 'object') push(item.path)
    // AI 场景视频只存在 videoMeta.sceneVideoPath / altSceneVideoPath（videoPath 为空）：
    // firstSceneThumbnailCandidates 会优先尝试它们，清单引用校验漏掉会导致回退无效（审查 W2）。
    const videoMeta = segment.videoMeta
    if (videoMeta && typeof videoMeta === 'object') {
      push(videoMeta.sceneVideoPath)
      push(videoMeta.altSceneVideoPath)
    }
  }
  const options = manifest.options
  if (options && typeof options === 'object') push(options.bgmPath)
  const textConfig = manifest.story2videoTextConfig
  const bgm = textConfig && typeof textConfig === 'object' && textConfig.config &&
    typeof textConfig.config === 'object' ? textConfig.config.bgm : null
  if (bgm && typeof bgm === 'object') push(bgm.path)
  return refs.map(value => path.resolve(value))
}

function thumbnailTemporaryPath (destination) {
  return destination + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + path.extname(destination)
}

/**
 * 检测是否为克隆音色不可用错误（换账号后克隆音色失效）。
 * 用于 regenerateSceneAudio 兆底：有现有音频时静默保留，用户无感。
 */
function isClonedVoiceFailure (error) {
  if (!error) return false
  const errCode = error.code || (error.context && error.context.code) || ""
  if (errCode === "INVALID_CONFIG") return true
  const msg = String(error.message || error || "").toLowerCase()
  return /voice\s+(?:id\s+)?(?:wrong|not\s+found|does\s+not\s+exist|unavailable|missing)/.test(msg)
    || /voice_id.*(?:not\s+found|not\s+exist|invalid|wrong|not\s+support)/.test(msg)
    || /cloned?\s+voice.*(?:not\s+found|not\s+available|unavailable)/.test(msg)
    || /\\u5f53\\u524d\\u8d26\\u53f7.*\\u97f3\\u8272|\\u8d26\\u53f7.*\\u97f3\\u8272|\\u5c5e\\u4e8e.*\\u5176\\u4ed6.*\\u8d26\\u53f7/.test(msg)
    || /\\u97f3\\u8272.*(?:\\u65e0\\u6548|\\u4e0d\\u5b58\\u5728|\\u5931\\u6548|\\u9519\\u8bef|\\u4e0d\\u652f\\u6301)/.test(msg)
    || /voice.*(?:\\u65e0\\u6548|\\u4e0d\\u5b58\\u5728|\\u5931\\u6548|\\u9519\\u8bef|\\u4e0d\\u652f\\u6301)/i.test(msg)
    || /\\u58f0\\u97f3.*(?:\\u65e0\\u6548|\\u4e0d\\u5b58\\u5728|\\u5931\\u6548|\\u9519\\u8bef|\\u4e0d\\u652f\\u6301)/.test(msg)
    || /(?:don'?t|do not|cannot|can't)\s+have\s+access.*voice/i.test(msg)
}

class Story2VideoProjectService {
  constructor (options = {}) {
    this.store = options.store || null
    this.composeEngine = options.composeEngine || null
    this.assetGenerator = options.assetGenerator || null
    this.aiGenerator = options.aiGenerator || null
    this.serviceBus = options.serviceBus || null
    this.ttsVoiceCloneService = options.ttsVoiceCloneService || null
    this.modelProviderManager = options.modelProviderManager || null
    this.generateSceneVideoStage = options.generateSceneVideoStage || generateAiSceneVideo
    this.estimateSceneSecondsStage = options.estimateSceneSecondsStage || estimateSceneSeconds
    // 资源生成瞬时错误重试包装（与流水线 withAssetTransientRetry 同源，2026-08-16 审查 W5）
    // 历史交互路径排除轮询超时/任务终态：避免整轮 提交→轮询→下载 被整体重试（最坏 3 次计费 + 30 分钟队列持锁，审查 M1）
    this.assetRetry = options.assetRetry || ((fn) => withAssetTransientRetry(fn, {
      excludeMessages: ['视频生成超时或失败', '视频生成任务失败', '视频生成任务状态为'],
    }))
    this.log = options.log || require('./logger')
    this.findFfmpeg = typeof options.findFfmpeg === 'function' ? options.findFfmpeg : findFfmpeg
    this.thumbnailRunner = typeof options.thumbnailRunner === 'function' ? options.thumbnailRunner : execFileAsync
    this.projectsDir = path.resolve(options.projectsDir || path.join(getUserDataDir(), 'story2video-projects'))
    this.maxProjects = Number.isInteger(options.maxProjects) && options.maxProjects > 0
      ? options.maxProjects
      : MAX_PROJECTS
    // 同项目写操作串行队列：regenerate/update 等 read-modify-write 全程持锁，
    // 防止跨段并发或「保存」与「重新生成」竞态互相覆盖（2026-08-15 审查 W2）。
    this._projectQueues = new Map()
    this._thumbnailPromises = new Map()
  }

  _serializeProject (projectId, task) {
    const key = String(projectId || '')
    const previous = this._projectQueues.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(() => task()).finally(() => {
      if (this._projectQueues.get(key) === next) this._projectQueues.delete(key)
    })
    this._projectQueues.set(key, next)
    return next
  }

  /**
   * 当前是否为设备级本地命名空间（未登录/无身份服务）。
   * 供 IPC 返回 localMode 标记，渲染端据此展示「本地模式」提示。
   */
  isLocalOwner () {
    return this._ownerSubject() === LEGACY_OWNER_SUBJECT
  }

  _ownerSubject () {
    if (!this.store) throw new Error('Story2Video 项目存储不可用')
    const owner = typeof this.store._resolveOwnerSubject === 'function'
      ? this.store._resolveOwnerSubject()
      : LEGACY_OWNER_SUBJECT
    // 身份服务已启用但未登录（无有效 sub）：回退设备级本地命名空间，
    // 与「未配置身份服务」的 legacy 行为一致，保证本地历史记录可用；
    // 登录后按 sub 隔离，未登录期间的本地数据不混入用户空间。
    if (typeof owner !== 'string' || !owner.trim()) return LEGACY_OWNER_SUBJECT
    return owner.trim()
  }

  _ownerDir () {
    const ownerHash = crypto.createHash('sha256').update(this._ownerSubject(), 'utf8').digest('hex')
    const directory = path.join(this.projectsDir, ownerHash)
    if (!isPathWithin(directory, [this.projectsDir])) throw new Error('Story2Video 用户目录无效')
    fs.mkdirSync(directory, { recursive: true })
    return directory
  }

  _assertId (value, label = 'projectId') {
    if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(label + ' 无效')
    return value
  }

  _projectDir (projectId) {
    const directory = path.join(this._ownerDir(), this._assertId(projectId))
    if (!isPathWithin(directory, [this.projectsDir])) throw new Error('Story2Video 项目目录无效')
    return directory
  }

  _readProjects () {
    // owner 显式透传给 store：身份启用且未登录时回退 __legacy__ 必须作用到 settings 键空间，
    // 否则 settings-store 内部二次解析 provider 会返回 null（读取空、写入静默丢弃）。
    const owner = this._ownerSubject()
    if (!this.store || typeof this.store.getUserSetting !== 'function') return []
    const value = this.store.getUserSetting(SETTING_KEY, [], owner)
    if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object')
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : []
      } catch { return [] }
    }
    return []
  }

  _writeProjects (projects) {
    const owner = this._ownerSubject()
    if (!this.store || typeof this.store.setUserSetting !== 'function') {
      throw new Error('Story2Video 项目存储不可写')
    }
    this.store.setUserSetting(SETTING_KEY, projects, owner)
    return projects
  }

  _writeManifest (project) {
    const projectDir = this._projectDir(project.projectId)
    fs.mkdirSync(projectDir, { recursive: true })
    const destination = path.join(projectDir, 'project.json')
    const temporary = destination + '.tmp-' + process.pid + '-' + Date.now()
    try {
      fs.writeFileSync(temporary, JSON.stringify(project, null, 2), { encoding: 'utf8', flag: 'wx' })
      if (fs.existsSync(destination)) fs.unlinkSync(destination)
      fs.renameSync(temporary, destination)
    } catch (error) {
      try { fs.unlinkSync(temporary) } catch (_) { /* ignore */ }
      throw error
    }
  }

  _upsertProject (project) {
    const previous = this._readProjects().find(item => item.projectId === project.projectId) || null
    const normalized = {
      ...project,
      updatedAt: nextUpdatedAt(previous?.updatedAt || project.updatedAt),
    }
    const projects = this._readProjects().filter(item => item.projectId !== normalized.projectId)
    projects.unshift(normalized)
    const kept = projects.slice(0, this.maxProjects)
    this._writeProjects(kept)
    this._writeManifest(normalized)
    for (const evicted of projects.slice(this.maxProjects)) {
      try {
        const evictedDir = this._projectDir(evicted.projectId)
        if (isPathWithin(evictedDir, [this._ownerDir()])) fs.rmSync(evictedDir, { recursive: true, force: true })
      } catch (_) { /* 历史清理失败不影响新项目 */ }
    }
    return normalized
  }

  _cleanupUnreferencedProjectFiles (projectId, previousProject, nextProject) {
    const projectDir = this._projectDir(projectId)
    const previous = referencedProjectFiles(previousProject)
    const retained = referencedProjectFiles(nextProject)
    return this._cleanupProjectFiles(projectDir, [...previous].filter(candidate => !retained.has(candidate)))
  }

  _cleanupProjectFiles (projectDir, candidates) {
    let cleaned = 0
    for (const candidate of new Set(candidates)) {
      if (!isPathWithin(candidate, [projectDir])) continue
      try {
        const stat = fs.lstatSync(candidate)
        if (!stat.isFile() || stat.isSymbolicLink()) continue
        fs.unlinkSync(candidate)
        cleaned++
      } catch (_) { /* 文件已不存在或正在被其他进程使用 */ }
    }
    return cleaned
  }

  _isRecoverableProjectVideo (project) {
    if (!project || typeof project.videoPath !== 'string') return false
    try {
      const projectDir = this._projectDir(this._assertId(project.projectId))
      const videoPath = path.resolve(project.videoPath)
      const relativePath = path.relative(projectDir, videoPath)
      if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) return false

      const projectDirStat = fs.lstatSync(projectDir)
      if (!projectDirStat.isDirectory() || projectDirStat.isSymbolicLink()) return false

      let currentPath = projectDir
      const pathSegments = relativePath.split(path.sep).filter(Boolean)
      for (let index = 0; index < pathSegments.length; index++) {
        currentPath = path.join(currentPath, pathSegments[index])
        const stat = fs.lstatSync(currentPath)
        if (stat.isSymbolicLink()) return false
        if (index === pathSegments.length - 1) return stat.isFile()
        if (!stat.isDirectory()) return false
      }
      return false
    } catch (_) {
      return false
    }
  }

  listProjects () {
    return this._readProjects().map(project => ({
      ...project,
      recoverable: this._isRecoverableProjectVideo(project),
    }))
  }

  getProject (projectId) {
    this._assertId(projectId)
    const project = this._readProjects().find(item => item.projectId === projectId)
    if (!project) throw new Error('Story2Video 项目不存在')
    return { ...project, segments: Array.isArray(project.segments) ? project.segments.map(item => ({ ...item })) : [] }
  }

  _resolveSource (candidate, kind) {
    const allowedRoots = getAllowedMediaRoots([this.projectsDir])
    if (kind === 'image' || kind === 'audio' || kind === 'bgm') {
      return resolveReadableMediaFile(candidate, {
        kind,
        allowedRoots,
        maxBytes: kind === 'image' ? MAX_IMAGE_FILE_BYTES : MAX_AUDIO_FILE_BYTES,
      })
    }
    return resolveReadableFile(candidate, { allowedRoots, maxBytes: MAX_VIDEO_BYTES })
  }

  /**
   * 返回「项目清单目录」作为该项目的只读媒体根（跨 profile 迁移 / 设置库合并后，
   * 项目清单可能仍指向旧数据目录）。
   * 放行前提（全部满足）：
   *   - 目录为真实目录（非符号链接/联接），目录名与 projectId 同形；
   *   - 目录内 project.json 存在、可解析且 manifest.projectId 与目录名一致；
   *   - 清单明确引用该文件（videoPath/audioPath/bgmPath/分段媒体/备选图等）。
   * 避免任意目录伪造 project.json 后越权读取未被清单引用的文件。
   * @param {string} filePath
   * @returns {string|null} 规范化的项目目录绝对路径
   */
  getProjectMediaRoot (filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) return null
    const requested = path.resolve(filePath)
    // realpath 归一失败（路径不存在）时保留原串，比较自然不相等 -> fail-closed
    const canonicalOrRaw = (value) => {
      try { return fs.realpathSync.native(value) } catch { return value }
    }
    const requestedCanonical = canonicalOrRaw(requested)
    const requestedDir = path.dirname(requested)
    // 媒体文件通常位于 <ownerHash|__legacy__>/<projectId>/ 两层内；放宽到两层目录。
    const candidates = [requestedDir, path.dirname(requestedDir)]
    for (const candidate of new Set(candidates)) {
      const manifest = readProjectManifestDir(candidate)
      if (!manifest) continue
      const refs = projectFileReferencePaths(manifest)
      // Windows/NTFS 路径大小写不敏感：IPC 二次校验传入的是 realpath 规范化路径，
      // 与清单存储串可能只有大小写差异，字符串相等会误拒合法文件（审查 W3）。
      // 8.3 短名（如 C:\\Users\\RUNNER~1）与 realpath 长名指向同一文件但字面串不同：
      // 两侧各自 realpath 归一后再比较，别名（含联接通路）拼写同样放行。
      const referenced = process.platform === 'win32'
        ? refs.some(ref => canonicalOrRaw(ref).toLowerCase() === requestedCanonical.toLowerCase())
        : refs.some(ref => canonicalOrRaw(ref) === requestedCanonical)
      if (!referenced) continue
      return path.resolve(candidate)
    }
    return null
  }

  /**
   * 把文件解析为「项目清单目录」内的只读媒体；解析与安全校验统一走 resolveReadableFile
   * （canonical 边界、拒绝符号链接、大小上限）。
   * @param {string} filePath
   * @param {{ maxBytes?: number }} [options]
   * @returns {string|null} canonical 文件路径
   */
  resolveProjectMedia (filePath, options = {}) {
    const root = this.getProjectMediaRoot(filePath)
    if (!root) return null
    const maxBytes = Number.isFinite(Number(options.maxBytes)) && Number(options.maxBytes) > 0
      ? Number(options.maxBytes)
      : MAX_VIDEO_BYTES
    return resolveReadableFile(filePath, { allowedRoots: [root], maxBytes })
  }

  _thumbnailCachePaths (projectId) {
    const projectDir = this._projectDir(projectId)
    return {
      projectDir,
      thumbnailPath: path.join(projectDir, THUMBNAIL_FILE_NAME),
      metadataPath: path.join(projectDir, THUMBNAIL_META_FILE_NAME),
    }
  }

  _readThumbnailCache (thumbnailPath, metadataPath, sourcePath) {
    try {
      const thumbnailStat = fs.lstatSync(thumbnailPath)
      if (!thumbnailStat.isFile() || thumbnailStat.isSymbolicLink() || thumbnailStat.size <= 0 || thumbnailStat.size > THUMBNAIL_MAX_BYTES) return null
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
      const sourceStat = fs.statSync(sourcePath)
      if (!metadata || metadata.sourcePath !== sourcePath ||
          Number(metadata.size) !== Number(sourceStat.size) ||
          Number(metadata.mtimeMs) !== Number(sourceStat.mtimeMs) ||
          Number(metadata.ctimeMs) !== Number(sourceStat.ctimeMs)) return null
      return thumbnailPath
    } catch (_) {
      return null
    }
  }

  async _ensureVideoThumbnail (projectId, sourcePath) {
    const { thumbnailPath, metadataPath } = this._thumbnailCachePaths(projectId)
    const sourceStat = fs.statSync(sourcePath)
    const cached = this._readThumbnailCache(thumbnailPath, metadataPath, sourcePath)
    if (cached) return cached

    const ffmpeg = this.findFfmpeg()
    if (!ffmpeg) throw new Error('FFmpeg 不可用')
    // 跨 profile 项目（清单目录在当前数据目录之外）当前数据目录中可能还没有该项目目录，
    // 首帧缩略图缓存需要先落目录；路径来自受控 _projectDir，递归创建安全。
    try {
      fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true })
    } catch (mkdirError) {
      throw new Error('缩略图缓存目录不可写: ' + (mkdirError?.message || String(mkdirError)), { cause: mkdirError })
    }

    const temporary = thumbnailTemporaryPath(thumbnailPath)
    const metadataTemporary = thumbnailTemporaryPath(metadataPath)
    const transactionId = process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const thumbnailBackup = thumbnailPath + '.bak-' + transactionId
    const metadataBackup = metadataPath + '.bak-' + transactionId
    let backedUpThumbnail = false
    let backedUpMetadata = false
    let installedThumbnail = false
    let installedMetadata = false
    let restoredThumbnail = false
    let restoredMetadata = false
    const cleanupArtifact = (filePath) => {
      try {
        fs.unlinkSync(filePath)
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          this.log?.warn?.('[Story2Video] 缩略图临时文件清理失败: ' + (cleanupError?.message || String(cleanupError)))
        }
      }
    }
    const restoreBackup = (backupPath, destinationPath, label) => {
      if (!fs.existsSync(backupPath)) return true
      try {
        fs.renameSync(backupPath, destinationPath)
        return true
      } catch (renameError) {
        // 同目录 rename 失败时尝试复制后删除，尽量恢复旧素材并避免遗留备份。
        // 两种恢复方式都失败时保留备份，不能静默丢失旧缩略图。
        try {
          fs.copyFileSync(backupPath, destinationPath, fs.constants.COPYFILE_EXCL)
          cleanupArtifact(backupPath)
          return true
        } catch (copyError) {
          this.log?.warn?.('[Story2Video] 缩略图' + label + '回滚失败: ' + (copyError?.message || renameError?.message || String(copyError)))
          return false
        }
      }
    }
    try {
      await this.thumbnailRunner(ffmpeg, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-ss', '0',
        '-i', sourcePath,
        '-frames:v', '1',
        '-vf', 'scale=640:-2:force_original_aspect_ratio=decrease',
        '-q:v', '4',
        temporary,
      ], {
        timeout: THUMBNAIL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      })
      const outputStat = fs.lstatSync(temporary)
      if (!outputStat.isFile() || outputStat.isSymbolicLink() || outputStat.size <= 0 || outputStat.size > THUMBNAIL_MAX_BYTES) {
        throw new Error('缩略图产物无效')
      }
      if (!isJpegFile(temporary)) throw new Error('缩略图格式无效')
      const metadata = {
        sourcePath,
        size: sourceStat.size,
        mtimeMs: sourceStat.mtimeMs,
        ctimeMs: sourceStat.ctimeMs,
      }
      fs.writeFileSync(metadataTemporary, JSON.stringify(metadata), { encoding: 'utf8', flag: 'wx' })
      JSON.parse(fs.readFileSync(metadataTemporary, 'utf8'))
      // Keep the previous thumbnail and sidecar until both replacement files are installed.
      if (fs.existsSync(thumbnailPath)) {
        fs.renameSync(thumbnailPath, thumbnailBackup)
        backedUpThumbnail = true
      }
      if (fs.existsSync(metadataPath)) {
        fs.renameSync(metadataPath, metadataBackup)
        backedUpMetadata = true
      }
      fs.renameSync(temporary, thumbnailPath)
      installedThumbnail = true
      fs.renameSync(metadataTemporary, metadataPath)
      installedMetadata = true
      return thumbnailPath
    } catch (error) {
      if (installedMetadata) {
        try { fs.unlinkSync(metadataPath) } catch (_) { /* ignore rollback cleanup */ }
      }
      if (installedThumbnail) {
        try { fs.unlinkSync(thumbnailPath) } catch (_) { /* ignore rollback cleanup */ }
      }
      if (backedUpMetadata && fs.existsSync(metadataBackup)) {
        restoredMetadata = restoreBackup(metadataBackup, metadataPath, '元数据')
      }
      if (backedUpThumbnail && fs.existsSync(thumbnailBackup)) {
        restoredThumbnail = restoreBackup(thumbnailBackup, thumbnailPath, '文件')
      }
      throw error
    } finally {
      cleanupArtifact(temporary)
      cleanupArtifact(metadataTemporary)
      if (installedMetadata || restoredMetadata || !backedUpMetadata) cleanupArtifact(metadataBackup)
      if (installedThumbnail || restoredThumbnail || !backedUpThumbnail) cleanupArtifact(thumbnailBackup)
    }
  }

  async getThumbnail (projectId) {
    this._assertId(projectId)
    const existing = this._thumbnailPromises.get(projectId)
    if (existing) return existing
    const task = (async () => {
      try {
        const project = this.getProject(projectId)
        const candidates = firstSceneThumbnailCandidates(project)
        let videoFailure = null
        for (const candidate of candidates.images) {
          // 跨 profile 迁移/设置库合并后清单可能仍指向旧数据目录：先按当前根解析，
          // 失败时回退到「项目清单目录」只读根（清单必须引用该文件）。
          const resolved = this._resolveSource(candidate, 'image') ||
            this.resolveProjectMedia(candidate, { maxBytes: MAX_IMAGE_FILE_BYTES })
          if (resolved) return { status: 'ready', kind: 'image', path: resolved }
        }
        for (const candidate of candidates.videos) {
          const resolved = this._resolveSource(candidate, 'video') ||
            this.resolveProjectMedia(candidate, { maxBytes: MAX_VIDEO_BYTES })
          if (!resolved) continue
          try {
            const thumbnailPath = await this._ensureVideoThumbnail(projectId, resolved)
            return { status: 'ready', kind: 'video-frame', path: thumbnailPath }
          } catch (error) {
            videoFailure = error
            this.log?.warn?.('[Story2Video] 历史首帧缩略图生成失败: ' + (error?.message || String(error)))
            const cachePaths = this._thumbnailCachePaths(projectId)
            const fallback = this._readThumbnailCache(cachePaths.thumbnailPath, cachePaths.metadataPath, resolved)
            if (fallback) return { status: 'ready', kind: 'video-frame', path: fallback, stale: true }
          }
        }
        if (videoFailure) return { status: 'failed', kind: 'failed', path: null }
        return { status: 'missing', kind: 'missing', path: null }
      } catch (error) {
        this.log?.warn?.('[Story2Video] 历史缩略图读取失败: ' + (error?.message || String(error)))
        if (/^projectId 无效$/.test(String(error?.message || ''))) throw error
        return { status: 'failed', kind: 'failed', path: null }
      } finally {
        this._thumbnailPromises.delete(projectId)
      }
    })()
    this._thumbnailPromises.set(projectId, task)
    // A synchronous return path (for example, a ready image) can finish the async IIFE
    // before the Map insertion above. Delete only this exact promise after insertion so
    // completed requests never become a permanent stale cache entry.
    task.finally(() => {
      if (this._thumbnailPromises.get(projectId) === task) this._thumbnailPromises.delete(projectId)
    }).catch(() => {})
    return task
  }

  _resolveTranscriptionSource (candidate) {
    // 转录会把音频发送给 provider，只允许已导入或项目自有的受控副本。
    return resolveReadableMediaFile(candidate, {
      kind: 'audio',
      allowedRoots: [IMPORTED_MEDIA_DIR, this.projectsDir],
      maxBytes: MAX_AUDIO_FILE_BYTES,
    })
  }

  _copyRequired (candidate, destination, kind) {
    const source = this._resolveSource(candidate, kind)
    if (!source) throw new Error('Story2Video 产物不存在、不可读或超出限制')
    if (path.resolve(source) === path.resolve(destination)) return destination
    return copyFileAtomic(source, destination)
  }

  _persistComposeArtifacts (projectId, compose, fallbackSegments = []) {
    const projectDir = this._projectDir(projectId)
    const videoPath = this._copyRequired(
      compose.videoPath || compose.path,
      path.join(projectDir, 'video' + sourceExtension(compose.videoPath || compose.path, '.mp4')),
      'video',
    )
    const audioPath = compose.audioPath
      ? this._copyRequired(compose.audioPath, path.join(projectDir, 'narration.m4a'), 'audio')
      : null
    const normalizedFallbackSegments = Array.isArray(fallbackSegments) ? fallbackSegments : []
    const sourceSegments = Array.isArray(compose.segments) && compose.segments.length > 0
      ? compose.segments
      : normalizedFallbackSegments
    const fallbackBySourceIndex = new Map()
    normalizedFallbackSegments.forEach((segment, position) => {
      const sourceIndex = Number.isInteger(segment?.index) && segment.index >= 0 ? segment.index : position
      if (!fallbackBySourceIndex.has(sourceIndex)) fallbackBySourceIndex.set(sourceIndex, segment || {})
    })
    const segments = sourceSegments.map((segment, position) => {
      const positionalFallbackSegment = normalizedFallbackSegments[position] || {}
      const hasExplicitIndex = Number.isInteger(segment?.index) && segment.index >= 0
      const index = hasExplicitIndex ? segment.index : position
      const fallbackSegment = fallbackBySourceIndex.get(index) ||
        (!hasExplicitIndex ? positionalFallbackSegment : {})
      const id = SAFE_ID.test(String(segment.id || '')) ? String(segment.id) : 'segment-' + index
      const prefix = 'segment_' + String(position).padStart(4, '0')
      const promptTranslation = safeText(segment.promptTranslation, 20000).trim() ||
        safeText(fallbackSegment.promptTranslation, 20000).trim() || null
      return {
        id,
        index: position,
        sourceIndex: index,
        text: safeText(segment.text || segment.content, 10000),
        prompt: safeText(segment.prompt, 20000),
        promptTranslation,
        promptOptimizationMeta: safePromptOptimizationMeta(segment.promptOptimizationMeta || fallbackSegment.promptOptimizationMeta),
        // compose 输出不含 videoPrompt（normalizeComposeScenes 白名单），按稳定 source index 从 fallback 回填
        // （2026-08-15 审查 C1：否则流水线主路径与 recompose 都会把视频优化词清成 null）
        videoPrompt: safeText(segment.videoPrompt, 40000) ||
          (fallbackSegment.videoPrompt ? safeText(fallbackSegment.videoPrompt, 40000) : null),
        imagePath: segment.imagePath
          ? this._copyRequired(segment.imagePath, path.join(projectDir, prefix + '_image' + sourceExtension(segment.imagePath, '.png')), 'image')
          : null,
        audioPath: segment.audioPath
          ? this._copyRequired(segment.audioPath, path.join(projectDir, prefix + '_audio' + sourceExtension(segment.audioPath, '.mp3')), 'audio')
          : null,
        videoPath: segment.videoPath
          ? this._copyRequired(segment.videoPath, path.join(projectDir, prefix + '_video.mp4'), 'video')
          : null,
        duration: Number.isFinite(Number(segment.duration)) ? Number(segment.duration) : null,
        imageMeta: safeAssetMeta(segment.imageMeta),
        audioMeta: safeAssetMeta(segment.audioMeta),
        videoMeta: safeAssetMeta(segment.videoMeta),
        subtitleBlocks: safeSubtitleBlocks(segment.subtitleBlocks),
        subtitleTimeline: safeSubtitleTimeline(segment.subtitleTimeline),
        sceneSource: safeText(segment.sceneSource, 80) || null,
        subtitleSource: safeText(segment.subtitleSource, 80) || null,
        degraded: segment.degraded === true,
        fallbackReason: safeText(segment.fallbackReason, 300) || null,
        status: segment.status || 'completed',
        // compose 输出不含素材槽位字段，按稳定 source index 从 fallback 回填
        alternateImages: safeAlternateImages(
            Array.isArray(segment.alternateImages) && segment.alternateImages.length > 0
              ? segment.alternateImages
              : fallbackSegment.alternateImages,
        ),
        selectedMaterial: safeMaterialKind(segment.selectedMaterial || fallbackSegment.selectedMaterial),
      }
    })
    return { videoPath, audioPath, segments }
  }

  saveRun (run) {
    if (!run || !AUTO_PIPELINES.includes(run.pipeline)) return null
    const compose = resolveComposeOutput(run.context)
    if (!compose || !(compose.videoPath || compose.path)) return null
    const projectId = this._assertId(String(run.id || ''))
    const previousProject = this._readProjects().find(item => item.projectId === projectId) || null
    const scenes = run.context?.generate_assets?.scenes || run.context?.assets?.scenes || []
    const artifacts = this._persistComposeArtifacts(projectId, compose, scenes)
    // manual 模式：把流水线已生成的未选素材一并持久化到项目目录（图2 备选 / 未选视频 / 选中态），
    // 视频任务编辑页无需重跑即可展示全部候选（2026-08-14 多素材需求）。
    artifacts.segments = this._enrichManualCandidates(artifacts.segments, run, projectId)
    const options = this._safeOptions(run.params, projectId)
    const story2videoTextConfig = run.pipeline === 'story2video-compose'
      ? this._persistTextConfig(run.params, projectId, options)
      : null
    const sourceText = safeText(run.params?.text || story2videoTextConfig?.config?.prompt, 100000)
    const now = new Date().toISOString()
    const project = {
      manifestVersion: 2,
      projectId,
      runId: projectId,
      pipeline: run.pipeline,
      startedPipeline: true,
      status: run.status || 'completed',
      title: safeText(run.params?.title || story2videoTextConfig?.config?.publish?.title || sourceText, 160),
      sourceText,
      createdAt: previousProject?.createdAt || run.createdAt || now,
      updatedAt: now,
      endedAt: run.endedAt || now,
      duration: Number.isFinite(Number(compose.duration)) ? Number(compose.duration) : null,
      videoDuration: Number.isFinite(Number(compose.videoDuration || compose.durationSeconds || compose.duration))
        ? Number(compose.videoDuration || compose.durationSeconds || compose.duration)
        : null,
      outputSizeBytes: (() => {
        try {
          const stat = fs.statSync(artifacts.videoPath)
          return Number.isFinite(stat.size) ? stat.size : null
        } catch { return null }
      })(),
      format: compose.format || sourceExtension(artifacts.videoPath, '.mp4').slice(1),
      videoPath: artifacts.videoPath,
      audioPath: artifacts.audioPath,
      segments: artifacts.segments,
      dirty: false,
      options,
      ...(story2videoTextConfig ? { story2videoTextConfig } : {}),
    }
    const saved = this._upsertProject(project)
    this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
    return saved
  }

  /**
   * 在成片合成前为已生成分段建立可编辑草稿。
   * 草稿和最终项目共用 run.id，历史记录始终可进入同一个视频任务编辑页。
   */
  saveEditableRun (run, { replace = false } = {}) {
    if (!run || run.pipeline !== 'story2video-compose') return null
    const projectId = this._assertId(String(run.id || ''))
    const previousProject = this._readProjects().find(item => item.projectId === projectId) || null
    if (previousProject && !replace) return previousProject

    const manifest = run.context?.generate_assets
    const manualScenes = this._manualCandidateScenes(manifest)
    const finalizedScenes = Array.isArray(manifest?.scenes) ? manifest.scenes : []
    const sourceScenes = manualScenes.length > 0
      ? manualScenes.map((candidateScene, position) => {
          const sourceIndex = Number.isInteger(candidateScene.index) ? candidateScene.index : position
          const finalizedScene = finalizedScenes.find((scene) => scene && scene.index === sourceIndex) || {}
          return {
            ...candidateScene,
            ...finalizedScene,
            imagePath: candidateScene.imagePath || finalizedScene.imagePath || null,
            imageMeta: candidateScene.imageMeta || finalizedScene.imageMeta || null,
            videoPath: candidateScene.videoPath || finalizedScene.videoPath || null,
            videoMeta: candidateScene.videoMeta || finalizedScene.videoMeta || null,
            alternateImages: candidateScene.alternateImages?.length
              ? candidateScene.alternateImages
              : (finalizedScene.alternateImages || []),
            selectedMaterial: candidateScene.selectedMaterial || finalizedScene.selectedMaterial || null,
          }
        })
      : finalizedScenes
    if (sourceScenes.length === 0) return null

    const projectDir = this._projectDir(projectId)
    const copyOptional = (candidate, destination, kind) => {
      if (typeof candidate !== 'string' || !candidate) return null
      try {
        return this._copyRequired(candidate, destination, kind)
      } catch (error) {
        this.log?.warn?.('[Story2Video] 草稿素材复制失败: ' + (error?.message || String(error)))
        return null
      }
    }
    const segments = sourceScenes.map((scene, position) => {
      const source = scene && typeof scene === 'object' ? scene : {}
      const sourceIndex = Number.isInteger(source.index) && source.index >= 0 ? source.index : position
      const id = SAFE_ID.test(String(source.id || '')) ? String(source.id) : 'segment-' + sourceIndex
      const prefix = 'draft_' + String(position).padStart(4, '0')
      const alternateImages = safeAlternateImages(source.alternateImages).map((alternate, alternateIndex) => ({
        path: copyOptional(
          alternate.path,
          path.join(projectDir, prefix + '_image' + (alternateIndex + 2) + sourceExtension(alternate.path, '.png')),
          'image',
        ),
        meta: alternate.meta,
      })).filter(alternate => alternate.path)
      return {
        id,
        index: position,
        sourceIndex,
        text: safeText(source.text || source.content, 10000),
        prompt: safeText(source.prompt, 20000),
        promptTranslation: safeText(source.promptTranslation, 20000) || null,
        videoPrompt: safeText(source.videoPrompt, 40000) || null,
        imagePath: copyOptional(source.imagePath, path.join(projectDir, prefix + '_image' + sourceExtension(source.imagePath, '.png')), 'image'),
        audioPath: copyOptional(source.audioPath, path.join(projectDir, prefix + '_audio' + sourceExtension(source.audioPath, '.mp3')), 'audio'),
        videoPath: copyOptional(source.videoPath, path.join(projectDir, prefix + '_video' + sourceExtension(source.videoPath, '.mp4')), 'video'),
        duration: Number.isFinite(Number(source.duration)) ? Number(source.duration) : null,
        imageMeta: safeAssetMeta(source.imageMeta),
        audioMeta: safeAssetMeta(source.audioMeta),
        videoMeta: safeAssetMeta(source.videoMeta),
        subtitleBlocks: safeSubtitleBlocks(source.subtitleBlocks),
        subtitleTimeline: safeSubtitleTimeline(source.subtitleTimeline),
        sceneSource: safeText(source.sceneSource, 80) || null,
        subtitleSource: safeText(source.subtitleSource, 80) || null,
        degraded: source.degraded === true,
        fallbackReason: safeText(source.fallbackReason, 300) || null,
        status: source.status || 'completed',
        alternateImages,
        selectedMaterial: safeMaterialKind(source.selectedMaterial),
      }
    })
    const options = this._safeOptions(run.params, projectId)
    const story2videoTextConfig = this._persistTextConfig(run.params, projectId, options)
    const sourceText = safeText(run.params?.text || story2videoTextConfig?.config?.prompt, 100000)
    const now = new Date().toISOString()
    const project = {
      manifestVersion: 2,
      projectId,
      runId: projectId,
      pipeline: run.pipeline,
      startedPipeline: true,
      status: run.status || 'running',
      title: safeText(run.params?.title || story2videoTextConfig?.config?.publish?.title || sourceText, 160),
      sourceText,
      createdAt: previousProject?.createdAt || run.createdAt || now,
      updatedAt: now,
      endedAt: run.endedAt || null,
      duration: null,
      videoDuration: null,
      outputSizeBytes: null,
      format: null,
      videoPath: null,
      audioPath: null,
      segments,
      dirty: false,
      options,
      ...(story2videoTextConfig ? { story2videoTextConfig } : {}),
    }
    const saved = this._upsertProject(project)
    this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
    return saved
  }

  /** 同步草稿的运行状态，不重写用户已编辑的分段内容。 */
  syncRunStatus (run) {
    if (!run || run.pipeline !== 'story2video-compose') return null
    const projectId = this._assertId(String(run.projectId || run.id || ''))
    const previousProject = this._readProjects().find(item => item.projectId === projectId)
    if (!previousProject) return null
    return this._upsertProject({
      ...previousProject,
      runId: projectId,
      status: run.status || previousProject.status || 'running',
      updatedAt: new Date().toISOString(),
      endedAt: run.status === 'running' ? null : (run.endedAt || previousProject.endedAt || null),
    })
  }

  /**
   * 从历史记录 run 数据重建项目（如果项目不存在）。
   * 用于 pipeline-run 记录点击编辑时自动恢复项目，解决项目被逐出/丢失后编辑按钮消失的问题。
   * @param {object} payload - { projectId, pipeline, status, title, sourceText, params, stages, context, error }
   * @returns {object} 项目对象，如果已存在则返回已有项目
   */
  ensureProjectFromRun (payload) {
    if (!payload || typeof payload !== 'object' || !payload.projectId) throw new Error('payload.projectId 无效')
    const projectId = this._assertId(String(payload.projectId))
    const existing = this._readProjects().find(item => item.projectId === projectId)
    if (existing) return existing
    const now = new Date().toISOString()
    const segments = Array.isArray(payload.segments) ? payload.segments.map((segment, index) => ({
      id: segment.id || 'segment-' + index,
      index: index,
      sourceIndex: Number.isInteger(segment.sourceIndex) ? segment.sourceIndex : index,
      text: segment.text || '',
      prompt: segment.prompt || '',
      promptTranslation: segment.promptTranslation || null,
      videoPrompt: segment.videoPrompt || null,
      imagePath: segment.imagePath || null,
      audioPath: segment.audioPath || null,
      videoPath: segment.videoPath || null,
      duration: Number.isFinite(Number(segment.duration)) ? Number(segment.duration) : null,
      imageMeta: segment.imageMeta || null,
      audioMeta: segment.audioMeta || null,
      videoMeta: segment.videoMeta || null,
      subtitleBlocks: Array.isArray(segment.subtitleBlocks) ? segment.subtitleBlocks : [],
      subtitleTimeline: Array.isArray(segment.subtitleTimeline) ? segment.subtitleTimeline : [],
      sceneSource: segment.sceneSource || null,
      subtitleSource: segment.subtitleSource || null,
      degraded: segment.degraded === true,
      fallbackReason: segment.fallbackReason || null,
      status: segment.status || 'completed',
      alternateImages: Array.isArray(segment.alternateImages) ? segment.alternateImages : [],
      selectedMaterial: segment.selectedMaterial || null,
    })) : []
    const project = {
      manifestVersion: 2,
      projectId,
      runId: projectId,
      pipeline: payload.pipeline || 'story2video-compose',
      startedPipeline: true,
      status: payload.status || 'completed',
      title: payload.title || payload.sourceText || '',
      sourceText: payload.sourceText || '',
      createdAt: now,
      updatedAt: now,
      endedAt: payload.status === 'running' ? null : now,
      duration: null,
      videoDuration: null,
      outputSizeBytes: null,
      format: null,
      videoPath: null,
      audioPath: null,
      segments,
      dirty: false,
      options: {},
    }
    return this._upsertProject(project)
  }

  _manualCandidateScenes (manifest) {
    if (!manifest || manifest.creationMode !== 'manual' || !Array.isArray(manifest.candidates)) return []
    const selections = Array.isArray(manifest.selection?.selections) ? manifest.selection.selections : []
    const selectionByIndex = new Map(selections.map(selection => [selection?.index, selection]))
    return manifest.candidates.map((scene, position) => {
      if (!scene || typeof scene !== 'object') return null
      const candidates = Array.isArray(scene.candidates) ? scene.candidates : []
      const selected = selectionByIndex.get(scene.index)
      const selectedCandidate = selected?.candidateId
        ? candidates.find(candidate => candidate && candidate.id === selected.candidateId)
        : null
      const images = candidates.filter(candidate => candidate?.kind === 'image' && candidate.path)
      const video = candidates.find(candidate => candidate?.kind === 'video' && candidate.path)
      const selectedImage = selectedCandidate?.kind === 'image' ? selectedCandidate : images[0]
      const alternateImage = images.find(candidate => candidate !== selectedImage)
      return {
        ...scene,
        index: Number.isInteger(scene.index) ? scene.index : position,
        imagePath: selectedImage?.path || null,
        imageMeta: selectedImage?.meta || null,
        alternateImages: alternateImage ? [{ path: alternateImage.path, meta: alternateImage.meta }] : [],
        videoPath: (selectedCandidate?.kind === 'video' ? selectedCandidate.path : video?.path) || null,
        videoMeta: (selectedCandidate?.kind === 'video' ? selectedCandidate.meta : video?.meta) || null,
        selectedMaterial: selectedCandidate?.kind === 'video'
          ? 'video'
          : (selectedCandidate?.kind === 'image' ? 'image1' : null),
      }
    }).filter(Boolean)
  }

  _persistTextConfig (params, projectId, options) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null
    const hasPrompt = typeof params.text === 'string' && params.text.trim()
    const hasVersionedConfig = params.story2videoTextConfig &&
      typeof params.story2videoTextConfig === 'object' &&
      !Array.isArray(params.story2videoTextConfig)
    if (!hasPrompt && !hasVersionedConfig) return null

    const normalized = normalizeStory2VideoTextParams(params)
    const config = JSON.parse(JSON.stringify(normalized.story2videoTextConfig))
    if (normalized.bgmPath) {
      // 缺失/不可读 BGM：compose 阶段已按 bgmSkipped 降级跳过，持久化必须同样跳过，
      // 否则会把已成功合成的成片误判为「项目保存失败」（2026-08-11 E2E 修复）。
      const source = this._resolveSource(normalized.bgmPath, 'bgm')
      if (source) {
        const persistedBgm = options.bgmPath || this._copyRequired(
          source,
          path.join(this._projectDir(projectId), 'bgm' + sourceExtension(source, '.mp3')),
          'bgm',
        )
        options.bgmPath = persistedBgm
        config.bgm.path = persistedBgm
      } else {
        // 清空对不存在文件的引用，避免项目元数据指向已回收/缺失的 BGM
        options.bgmPath = ''
        config.bgm.path = ''
      }
    }
    return { version: STORY2VIDEO_TEXT_CONFIG_VERSION, config }
  }

  _safeOptions (params = {}, projectId = null) {
    const keys = [
      'transition', 'transitionDuration', 'imageEffect', 'subtitleEnabled', 'subtitleStyle',
      'watermark', 'watermarkText', 'watermarkConfig', 'resolution', 'fps', 'format',
      'bgmVolume', 'contentType', 'imageStyle', 'imageProvider', 'imageModel', 'aspectRatio',
      'voiceId', 'voiceProvider', 'voiceModel', 'voiceSpeed', 'voicePitch', 'voiceEmotion', 'voiceVolume', 'templateId',
      'defaultSceneDuration', 'sceneDurationMode', 'minSceneDuration',
    ]
    const result = {}
    for (const key of keys) {
      if (params[key] !== undefined) result[key] = JSON.parse(JSON.stringify(params[key]))
    }
    if (typeof params.bgmPath === 'string') {
      const source = this._resolveSource(params.bgmPath, 'bgm')
      if (source && projectId) {
        result.bgmPath = this._copyRequired(
          source,
          path.join(this._projectDir(projectId), 'bgm' + sourceExtension(source, '.mp3')),
          'bgm',
        )
      }
    }
    return result
  }

  updateSegments (projectId, updates) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(segment => ({ ...segment })) }
    if (!Array.isArray(updates) || updates.length === 0) throw new Error('分段列表不能为空')
    const existing = new Map(project.segments.map(segment => [segment.id, segment]))
    const seen = new Set()
    const segments = updates.map((update, index) => {
      if (!update || typeof update !== 'object' || typeof update.id !== 'string' || seen.has(update.id)) {
        throw new Error('分段更新参数无效')
      }
      const original = existing.get(update.id)
      if (!original) throw new Error('分段不存在')
      seen.add(update.id)
      const voiceRate = (value, current, clamp) => {
        const cleaned = clamp(value)
        return cleaned === undefined ? current : cleaned
      }
      const nextPrompt = update.prompt === undefined ? original.prompt : safeText(update.prompt, 20000)
      const promptChanged = update.prompt !== undefined && nextPrompt !== original.prompt
      return {
        ...original,
        index,
        text: update.text === undefined ? original.text : safeText(update.text, 10000),
        prompt: nextPrompt,
        promptOptimizationMeta: promptChanged
          ? null
          : (update.promptOptimizationMeta === undefined
              ? safePromptOptimizationMeta(original.promptOptimizationMeta)
              : safePromptOptimizationMeta(update.promptOptimizationMeta)),
        // 历史记录场景内容编辑（2026-08-15）：字幕/视频优化词/语音设置白名单透传
        videoPrompt: update.videoPrompt === undefined ? original.videoPrompt : safeText(update.videoPrompt, 40000),
        subtitleBlocks: update.subtitleBlocks === undefined ? original.subtitleBlocks : safeSubtitleBlocks(update.subtitleBlocks),
        subtitleTimeline: update.subtitleTimeline === undefined ? original.subtitleTimeline : safeSubtitleTimeline(update.subtitleTimeline),
        voiceId: update.voiceId === undefined ? original.voiceId : safeText(update.voiceId, 160),
        voiceProvider: update.voiceProvider === undefined ? original.voiceProvider : safeText(update.voiceProvider, 160),
        voiceModel: update.voiceModel === undefined ? original.voiceModel : safeText(update.voiceModel, 160),
        voiceSpeed: voiceRate(update.voiceSpeed, original.voiceSpeed, safeVoiceSpeed),
        voicePitch: voiceRate(update.voicePitch, original.voicePitch, safeVoicePitch),
        voiceEmotion: update.voiceEmotion === undefined ? original.voiceEmotion : safeText(update.voiceEmotion, 80),
      }
    })
    const updated = { ...project, segments, dirty: true, updatedAt: new Date().toISOString() }
    const saved = this._upsertProject(updated)
    this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
    return saved
  }

  replaceSegmentAudio (projectId, segmentId, filePath) {
    const project = this.getProject(projectId)
    this._assertId(segmentId, 'segmentId')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const previousProject = { ...project, segments: project.segments.map(segment => ({ ...segment })) }
    const projectDir = this._projectDir(projectId)
    const destination = path.join(
      projectDir,
      segmentId + '_audio_replacement_' + Date.now() + sourceExtension(filePath, '.mp3'),
    )
    const copied = this._copyRequired(filePath, destination, 'audio')
    try {
      project.segments[index] = {
        ...project.segments[index],
        audioPath: copied,
        error: null,
        status: 'completed',
      }
      project.dirty = true
      project.updatedAt = new Date().toISOString()
      const saved = this._upsertProject(project)
      this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
      return saved
    } catch (error) {
      try {
        if (isPathWithin(copied, [projectDir]) && fs.lstatSync(copied).isFile()) fs.unlinkSync(copied)
      } catch (_) { /* 回滚清理失败不覆盖原始错误 */ }
      throw error
    }
  }

  deleteProject (projectId) {
    this._assertId(projectId)
    const projects = this._readProjects()
    const exists = projects.some(project => project.projectId === projectId)
    // 逻辑删除：索引移除成功即视为删除完成，目录清理是尽力而为。
    // 索引中不存在同样返回 deleted:true（幂等），避免「已删除的项目再次点击删除」
    // 仍误报 “项目未能删除，请稍后再试”（2026-08-20 修复）。
    if (exists) {
      this._writeProjects(projects.filter(project => project.projectId !== projectId))
    }
    const projectDir = this._projectDir(projectId)
    if (isPathWithin(projectDir, [this._ownerDir()])) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true })
      } catch (dirError) {
        // Windows 下视频/首帧缩略图可能被本地媒体服务或 ffmpeg 缩略图进程临时占用
        // 而锁定（EPERM），目录清除失败不应阻断已完成的逻辑删除，孤立目录为本地垃圾，
        // 记录告警而非抛错，防止 UI 弹出误导性 “项目未能删除” 提示。
        this.log?.warn?.('[Story2Video] 项目目录清理失败（索引已删除）: ' + (dirError && dirError.message ? dirError.message : String(dirError)) + ' path=' + projectDir)
      }
    }
    return { projectId, deleted: true }
  }

  async retrySegment (projectId, segmentId, mode) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(segment => ({ ...segment })) }
    this._assertId(segmentId, 'segmentId')
    if (!['image', 'video'].includes(mode)) throw new Error('分段重试模式无效')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const segment = { ...project.segments[index], status: 'processing' }
    const projectDir = this._projectDir(projectId)
    const attemptFiles = new Set()
    try {
      if (mode === 'image') {
        if (!this.assetGenerator || typeof this.assetGenerator.generateImage !== 'function') throw new Error('图片生成服务不可用')
        // 重试图片的目标 provider 按当前设置解析：关闭「优先使用多模态模型」后不再沿用
        // 任务创建时固化的多模态 provider（2026-08-16 Bug：过期 MiniMax Key 仍被重试调用）。
        const imageGenerator = this._resolveImageGenerator(project.options?.imageProvider, project.options?.imageModel)
        if (!imageGenerator) throw new Error('未找到可用的图片生成器，请先在「模型设置」中配置并启用支持图片生成的模型')
        const generated = await this.assetGenerator.generateImage(segment.prompt || segment.text, {
          index: segment.sourceIndex ?? index,
          style: project.options?.imageStyle,
          image_provider: imageGenerator.providerId,
          image_model: imageGenerator.model,
          aspect_ratio: project.options?.aspectRatio,
          runId: 'retry_' + projectId,
        })
        const generatedPath = generated?.data?.path || generated?.data?.image_path || generated?.path
        if (!generated || generated.code !== 0 || !generatedPath) {
          throw new Error(generated?.message || '图片生成失败')
        }
        const copiedImage = this._copyRequired(
          generatedPath,
          path.join(projectDir, segment.id + '_image_retry_' + Date.now() + sourceExtension(generatedPath, '.png')),
          'image',
        )
        attemptFiles.add(copiedImage)
        segment.imagePath = copiedImage
        segment.imageMeta = safeAssetMeta(generated?.data || generated)
      }
      if (!this.composeEngine || typeof this.composeEngine.renderSegment !== 'function') throw new Error('视频合成服务不可用')
      const destination = path.join(projectDir, segment.id + '_video_retry_' + Date.now() + '.mp4')
      attemptFiles.add(destination)
      const rendered = await this.composeEngine.renderSegment(segment, project.options || {}, destination)
      if (!rendered || rendered.code !== 0 || !rendered.data?.videoPath) {
        throw new Error(rendered?.message || '单段视频生成失败')
      }
      segment.videoPath = this._copyRequired(rendered.data.videoPath, destination, 'video')
      segment.duration = Number.isFinite(Number(rendered.data.duration)) ? Number(rendered.data.duration) : segment.duration
      segment.error = null
      segment.status = 'completed'
      project.segments[index] = segment
      project.dirty = true
      project.updatedAt = new Date().toISOString()
      const saved = this._upsertProject(project)
      this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
      return saved
    } catch (error) {
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn('[Story2Video] 分段重试失败: ' + (error && error.message ? error.message : String(error)))
      }
      project.segments[index] = {
        ...previousProject.segments[index],
        status: 'failed',
        error: error.message,
      }
      project.updatedAt = new Date().toISOString()
      try {
        this._upsertProject(project)
      } catch (storageError) {
        if (this.log && typeof this.log.warn === 'function') {
          this.log.warn('[Story2Video] 保存分段失败状态失败', storageError)
        }
      }
      this._cleanupProjectFiles(projectDir, attemptFiles)
      throw error
    }
  }

  async recomposeProject (projectId) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(segment => ({ ...segment })) }
    if (!this.composeEngine || typeof this.composeEngine.compose !== 'function') throw new Error('视频合成服务不可用')
    const result = await this.composeEngine.compose({ scenes: this._scenesForCompose(project.segments) }, project.options || {})
    if (!result || result.code !== 0 || !result.data?.videoPath) throw new Error(result?.message || '重新合成失败')
    const artifacts = this._persistComposeArtifacts(projectId, result.data, project.segments)
    // 素材槽位以项目原值回填：_scenesForCompose 的 imagePath 替换仅为渲染映射，
    // compose 输出会把映射后的 imagePath 回显，直接持久化会污染图1 槽并导致原图1 被清理删除（2026-08-14 审查 C1）
    const restoredImageCopies = []
    artifacts.segments = artifacts.segments.map((segment, position) => {
      const original = project.segments[position] || {}
      // 仅当回填原值确实覆盖了 compose 回显副本时登记副本，避免误删仍被槽位引用的同名文件
      if (original.imagePath && path.resolve(segment.imagePath) !== path.resolve(original.imagePath)) {
        restoredImageCopies.push(segment.imagePath)
      }
      return {
        ...segment,
        imagePath: original.imagePath || segment.imagePath,
        imageMeta: original.imageMeta || segment.imageMeta,
        videoPrompt: original.videoPrompt || segment.videoPrompt || null,
        alternateImages: Array.isArray(original.alternateImages) ? original.alternateImages : segment.alternateImages,
        selectedMaterial: original.selectedMaterial || segment.selectedMaterial,
      }
    })
    const updated = {
      ...project,
      ...artifacts,
      duration: Number.isFinite(Number(result.data.duration)) ? Number(result.data.duration) : project.duration,
      videoDuration: Number.isFinite(Number(result.data.videoDuration || result.data.durationSeconds || result.data.duration))
        ? Number(result.data.videoDuration || result.data.durationSeconds || result.data.duration)
        : project.videoDuration,
      format: result.data.format || project.format,
      dirty: false,
      status: 'completed',
      updatedAt: new Date().toISOString(),
    }
    const saved = this._upsertProject(updated)
    this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
    // compose 回显的图片副本仅用于渲染映射，槽位回填项目原值后即为孤儿文件，一并清理（2026-08-14 审查 C1）
    this._cleanupProjectFiles(this._projectDir(projectId), restoredImageCopies)
    return saved
  }

  /**
   * 按选中态把 segments 映射为 compose 输入（compose/renderSegment 引擎零改动）：
   * - video 选中 → 保留 videoPath（compose 自身 videoPath 优先）；
   * - image1/image2 选中 → 传选中图片并置空 videoPath；
   * - 缺失 → 遗留语义（videoPath 优先，与现状一致）。
   */
  _scenesForCompose (segments) {
    return (Array.isArray(segments) ? segments : []).map((segment, index) => {
      const scene = { ...segment }
      const selected = safeMaterialKind(segment.selectedMaterial)
      if (selected === 'video') {
        const resolved = typeof scene.videoPath === 'string' && scene.videoPath.trim()
          ? this._resolveSource(scene.videoPath, 'video')
          : null
        // 显式选中视频但素材缺失：直接抛带场景号的视频素材缺失错误，避免落到 compose 的
        // 二义性 media path 错误被误归为图片缺失（2026-09-18 审查 C1）
        if (!resolved) throw new Error('第 ' + (index + 1) + ' 个场景的视频素材不存在、不可读或超出限制')
        scene.videoPath = resolved
        return scene
      }
      if (selected === 'video1') {
        const candidates = [scene.videoPath, scene.videoMeta && scene.videoMeta.sceneVideoPath]
        const resolved = candidates
          .filter(candidate => typeof candidate === 'string' && candidate.trim())
          .map(candidate => this._resolveSource(candidate, 'video'))
          .find(Boolean)
        if (!resolved) throw new Error('第 ' + (index + 1) + ' 个场景的视频素材不存在、不可读或超出限制')
        scene.videoPath = resolved
        return scene
      }
      if (selected === 'video2') {
        const alternateVideo = scene.videoMeta && scene.videoMeta.altSceneVideoPath
        const resolved = typeof alternateVideo === 'string' && alternateVideo.trim()
          ? this._resolveSource(alternateVideo, 'video')
          : null
        if (!resolved) throw new Error('第 ' + (index + 1) + ' 个场景的视频素材不存在、不可读或超出限制')
        scene.videoPath = resolved
        return scene
      }
      if (selected === 'image2') {
        const alternate = Array.isArray(segment.alternateImages) ? segment.alternateImages[0] : null
        if (alternate && typeof alternate.path === 'string' && alternate.path) {
          scene.imagePath = alternate.path
        }
      }
      // 仅显式选中图片时剥离旧视频；缺失选中态保持遗留语义（videoPath 优先）
      if (selected === 'image1' || selected === 'image2') {
        scene.videoPath = null
      }
      return scene
    })
  }

  /**
   * manual 模式候选富化：从 run.context.generate_assets.candidates 恢复未选素材。
   * - 流水线选图 → 未选中的另一张图复制为 alternateImages[0]（图2 槽），selectedMaterial='image1'；
   * - 流水线选视频 → 两张候选图分别填图1/图2 槽，selectedMaterial='video'；
   * - 无候选（auto 模式）→ 不富化，字段缺省即旧行为。
   */
  _enrichManualCandidates (segments, run, projectId) {
    if (!run || !run.context || typeof run.context !== 'object') return segments
    const manifest = run.context.generate_assets
    if (!manifest || manifest.creationMode !== 'manual' || !Array.isArray(manifest.candidates)) return segments
    const selections = Array.isArray(manifest.selection && manifest.selection.selections)
      ? manifest.selection.selections
      : []
    if (manifest.candidates.length === 0) return segments
    const projectDir = this._projectDir(projectId)
    const byIndex = new Map(selections.map((item) => [item && item.index, item]))
    const copyCandidate = (candidate, destination) => {
      if (!candidate || typeof candidate.path !== 'string' || !candidate.path) return null
      try {
        return this._copyRequired(candidate.path, destination, 'image')
      } catch (error) {
        if (this.log && typeof this.log.warn === 'function') {
          this.log.warn('[Story2Video] 候选素材复制失败: ' + (error && error.message ? error.message : String(error)))
        }
        return null
      }
    }
    return segments.map((segment, position) => {
      const scene = manifest.candidates.find((candidate) => candidate && candidate.index === (segment.sourceIndex ?? position))
      if (!scene || !Array.isArray(scene.candidates) || scene.candidates.length === 0) return segment
      const picked = byIndex.get(scene.index)
      const pickedCandidate = (typeof picked?.candidateId === 'string' && picked.candidateId)
        ? scene.candidates.find((candidate) => candidate && candidate.id === picked.candidateId)
        : null
      const images = scene.candidates.filter((candidate) => candidate && candidate.kind === 'image' &&
        typeof candidate.path === 'string' && candidate.path)
      const video = scene.candidates.find((candidate) => candidate && candidate.kind === 'video' &&
        typeof candidate.path === 'string' && candidate.path)
      const enriched = { ...segment }
      if (pickedCandidate && pickedCandidate.kind === 'image') {
        if (!Array.isArray(enriched.alternateImages) || enriched.alternateImages.length === 0) {
          const other = images.find((candidate) => candidate.id !== pickedCandidate.id)
          if (other) {
            const copied = copyCandidate(other, path.join(projectDir, (SAFE_ID.test(String(enriched.id)) ? String(enriched.id) : 'segment_' + String(position).padStart(4, '0')) + '_image2' + sourceExtension(other.path, '.png')))
            if (copied) enriched.alternateImages = [{ path: copied, meta: safeAssetMeta(other.meta) }]
          }
        }
        enriched.selectedMaterial = 'image1'
      } else if (pickedCandidate && pickedCandidate.kind === 'video') {
        if (!enriched.imagePath && images.length > 0) {
          const first = copyCandidate(images[0], path.join(projectDir, (SAFE_ID.test(String(enriched.id)) ? String(enriched.id) : 'segment_' + String(position).padStart(4, '0')) + '_image' + sourceExtension(images[0].path, '.png')))
          if (first) {
            enriched.imagePath = first
            enriched.imageMeta = safeAssetMeta(images[0].meta)
          }
        }
        if (!Array.isArray(enriched.alternateImages) || enriched.alternateImages.length === 0) {
          const second = images.length > 1 ? images[1] : null
          if (second && second.path !== enriched.imagePath) {
            const copied = copyCandidate(second, path.join(projectDir, (SAFE_ID.test(String(enriched.id)) ? String(enriched.id) : 'segment_' + String(position).padStart(4, '0')) + '_image2' + sourceExtension(second.path, '.png')))
            if (copied) enriched.alternateImages = [{ path: copied, meta: safeAssetMeta(second.meta) }]
          }
        }
        enriched.selectedMaterial = 'video'
      }
      // 流水线未选视频但存在视频候选 → 补视频槽（备选素材）
      if (!enriched.videoPath && video) {
        try {
          enriched.videoPath = this._copyRequired(video.path, path.join(projectDir, 'segment_video_' + String(position).padStart(4, '0') + sourceExtension(video.path, '.mp4')), 'video')
          enriched.videoMeta = safeAssetMeta(video.meta)
        } catch (error) {
          if (this.log && typeof this.log.warn === 'function') {
            this.log.warn('[Story2Video] 候选视频复制失败: ' + (error && error.message ? error.message : String(error)))
          }
        }
      }
      return enriched
    })
  }

  selectSceneMaterial (projectId, segmentId, kind) {
    const project = this.getProject(projectId)
    this._assertId(segmentId, 'segmentId')
    if (!MATERIAL_KINDS.includes(kind)) throw new Error('素材类型无效')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const segment = project.segments[index]
    const hasSlot = kind === 'image1'
      ? Boolean(segment.imagePath)
      : kind === 'image2'
        ? Boolean(Array.isArray(segment.alternateImages) && segment.alternateImages[0] && segment.alternateImages[0].path)
        : kind === 'video2'
          ? Boolean(segment.videoMeta && this._resolveSource(segment.videoMeta.altSceneVideoPath, 'video'))
          : kind === 'video1'
            ? Boolean(this._resolveSource(segment.videoPath, 'video') || this._resolveSource(segment.videoMeta && segment.videoMeta.sceneVideoPath, 'video'))
            : Boolean(segment.videoPath || (segment.videoMeta && segment.videoMeta.sceneVideoPath))
    if (!hasSlot) throw new Error('该素材槽位暂无素材，请先生成素材')
    const previousProject = { ...project, segments: project.segments.map(item => ({ ...item })) }
    project.segments[index] = { ...segment, selectedMaterial: kind }
    project.dirty = true
    project.updatedAt = new Date().toISOString()
    const saved = this._upsertProject(project)
    this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
    return saved
  }

  /**
   * 重新生成字幕：按场景文案用本地分句重新切分字幕块并清空陈旧时间轴。
   * 不消耗外部额度；无文案时 fail-closed。
   */
  async regenerateSceneSubtitle (projectId, segmentId) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(item => ({ ...item })) }
    this._assertId(segmentId, 'segmentId')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const segment = project.segments[index]
    if (!segment.text || !segment.text.trim()) throw new Error('该场景没有旁白文字，无法重新生成字幕')
    const subtitleBlocks = splitSubtitleBlocks(segment.text)
    if (!Array.isArray(subtitleBlocks) || subtitleBlocks.length === 0) {
      throw new Error('该场景无法拆分字幕')
    }
    project.segments[index] = {
      ...segment,
      subtitleBlocks: safeSubtitleBlocks(subtitleBlocks),
      // 字幕为派生数据：重新分句后清空陈旧时间轴，合成时按新字幕重建
      subtitleTimeline: [],
      // 重置失败状态与来源标记：本地重新分句后不再沿用旧的失败原因/远端切分来源（审查 I2）
      error: null,
      subtitleSource: 'local-typescript',
      status: 'completed',
    }
    project.dirty = true
    project.updatedAt = new Date().toISOString()
    const saved = this._upsertProject(project)
    this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
    return saved
  }

  /**
   * 重新生成旁白：按分段/项目 voice 设置用 assetGenerator.generateTTS 重新生成 TTS 音频。
   * 成功替换 audioPath；失败保留旧音频、清理本次产物、回写 failed。
   */
  async regenerateSceneAudio (projectId, segmentId) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(item => ({ ...item })) }
    this._assertId(segmentId, 'segmentId')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const segment = { ...project.segments[index], status: 'processing' }
    if (!segment.text || !segment.text.trim()) throw new Error('该场景没有旁白文字，无法生成语音')
    if (!this.assetGenerator || typeof this.assetGenerator.generateTTS !== 'function') {
      throw new Error('语音生成服务不可用')
    }
    const options = project.options || {}
    const voice = {
      voice_id: segment.voiceId || options.voiceId || '',
      voice_provider: segment.voiceProvider || options.voiceProvider || '',
      voice_model: segment.voiceModel || options.voiceModel || '',
      rate: segment.voiceSpeed || options.voiceSpeed,
      pitch: segment.voicePitch || options.voicePitch,
      emotion: segment.voiceEmotion || options.voiceEmotion || '',
    }
    const projectDir = this._projectDir(projectId)
    const attemptFiles = new Set()
    try {
      const generated = await this.assetGenerator.generateTTS(segment.text, {
        ...voice,
        with_timestamps: true,
        index: segment.sourceIndex ?? index,
        runId: 'scene_audio_' + projectId,
      })
      const generatedPath = generated?.data?.path || generated?.data?.audio_path || generated?.path
      if (!generatedPath) throw new Error(generated?.message || '语音生成失败')
      const destination = path.join(projectDir, segment.id + '_audio_tts_' + Date.now() + sourceExtension(generatedPath, '.mp3'))
      const copied = this._copyRequired(generatedPath, destination, 'audio')
      attemptFiles.add(copied)
      segment.audioPath = copied
      segment.audioMeta = safeAssetMeta(generated?.data || generated)
      segment.error = null
      segment.status = 'completed'
      project.segments[index] = segment
      project.dirty = true
      project.updatedAt = new Date().toISOString()
      const saved = this._upsertProject(project)
      this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
      return saved
    } catch (error) {
      if (this.log && this.log.warn) this.log.warn("[S2V] regenerateSceneAudio catch", { code: error && error.code, msg: error && error.message, cat: error && error.category })
      // 克隆音色跨账号失效时，尝试重新克隆（用保存的原始样本在当前账号重建）
      const prevSegment = previousProject.segments[index]
      if (isClonedVoiceFailure(error) && this.ttsVoiceCloneService) {
        try {
          const voiceId = voice.voice_id
          const providerId = voice.voice_provider
          // 克隆恢复的模型兜底按 provider 区分（MiMo 克隆 registry 绑定 mimo-v2.5-tts-voiceclone）
          const model = voice.voice_model
            || (providerId === 'mimo-tts' ? 'mimo-v2.5-tts-voiceclone' : 'speech-02-hd')
          const samples = await this.ttsVoiceCloneService.findCloneSamples(voiceId, providerId, model)
          if (samples && samples.sampleStorage && this.assetGenerator && typeof this.assetGenerator.generateTTS === 'function') {
            const _fs = require('fs')
            const _path = require('path')
            const userDataPath = this.store && typeof this.store.getUserDataDir === 'function'
              ? this.store.getUserDataDir() : null
            if (userDataPath && samples.sampleStorage.relativeDir) {
              const sampleDir = _path.join(userDataPath, samples.sampleStorage.relativeDir)
              const sampleFiles = _fs.readdirSync(sampleDir).filter(ff => /\.(mp3|wav|m4a)$/i.test(ff))
              if (sampleFiles.length > 0) {
                const samplePath = _path.join(sampleDir, sampleFiles[0])
                const audioBuffer = _fs.readFileSync(samplePath)
                const blob = new Blob([audioBuffer], { type: 'audio/mpeg' })
                const ttsAdapter = this.modelProviderManager && typeof this.modelProviderManager.getAdapter === 'function'
                  ? this.modelProviderManager.getAdapter(providerId) : null
                if (ttsAdapter && typeof ttsAdapter.cloneVoice === 'function') {
                  const newVoice = await ttsAdapter.cloneVoice({ name: voiceId, samples: [{ blob, fileName: sampleFiles[0] }] })
                  if (newVoice && newVoice.id) {
                    const retryResult = await this.assetGenerator.generateTTS(segment.text, {
                      ...voice, voice_id: newVoice.id, with_timestamps: true,
                      index: segment.sourceIndex ?? index, runId: 'scene_audio_' + projectId,
                    })
                    const retryPath = retryResult?.data?.path || retryResult?.data?.audio_path || retryResult?.path
                    if (retryPath) {
                      const dest = _path.join(projectDir, segment.id + '_audio_tts_' + Date.now() + sourceExtension(retryPath, '.mp3'))
                      const copied = this._copyRequired(retryPath, dest, 'audio')
                      attemptFiles.add(copied)
                      segment.audioPath = copied
                      segment.audioMeta = safeAssetMeta(retryResult.data || retryResult)
                      segment.error = null
                      segment.status = 'completed'
                      project.segments[index] = segment
                      project.dirty = true
                      project.updatedAt = new Date().toISOString()
                      const saved = this._upsertProject(project)
                      this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
                      if (this.log && this.log.info) this.log.info('[Story2Video] 重新克隆音色成功: ' + voiceId + ' -> ' + newVoice.id)
                      return saved
                    }
                  }
                }
              }
            }
          }
        } catch (_reCloneError) {
          if (this.log && this.log.warn) this.log.warn('[Story2Video] 重新克隆音色失败，尝试保留现有音频', _reCloneError)
        }
      }
      // 保留已有音频兜底
      if (isClonedVoiceFailure(error) && prevSegment && prevSegment.audioPath) {
        try {
          if (require('fs').existsSync(prevSegment.audioPath)) {
            project.segments[index] = {
              ...prevSegment,
              status: 'completed',
              error: null,
            }
            project.updatedAt = new Date().toISOString()
            this._upsertProject(project)
            if (this.log && this.log.info) this.log.info('[Story2Video] 克隆音色不可用，保留现有音频: ' + segmentId)
            return project
          }
        } catch (_e) { /* 文件不存在，走正常错误流程 */ }
      }
      project.segments[index] = {
        ...previousProject.segments[index],
        status: 'failed',
        error: error.message,
      }
      project.updatedAt = new Date().toISOString()
      try { this._upsertProject(project) } catch (storageError) {
        if (this.log && this.log.warn) this.log.warn('[Story2Video] 保存分段失败状态失败', storageError)
      }
      this._cleanupProjectFiles(projectDir, attemptFiles)
      throw error
    }
  }

  /**
   * 重新生成优化词：kind=image 更新 prompt（并清空陈旧翻译）；kind=video 更新 videoPrompt。
   * 失败不改动分段、不消耗图片/视频生成额度。
   */
  async regenerateScenePrompt (projectId, segmentId, kind) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(item => ({ ...item })) }
    this._assertId(segmentId, 'segmentId')
    if (!['image', 'video'].includes(kind)) throw new Error('优化词类型无效')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const segment = { ...project.segments[index], status: 'processing' }
    if (!segment.text || !segment.text.trim()) throw new Error('该场景没有旁白文字，无法重新生成优化词')
    if (!this.serviceBus ||
        typeof (kind === 'video' ? this.serviceBus.optimizeVideoPrompt : this.serviceBus.optimizePrompt) !== 'function') {
      throw new Error('提示词优化服务不可用')
    }
    const projectDir = this._projectDir(projectId)
    const attemptFiles = new Set()
    try {
      const seed = segment.text
      // 图片优化词与流水线契约同源（2026-08-16 上限放开）：经 buildPromptEngineOptimizeRequest
      // 携带 max_length=2000（8013 契约上限 PROMPT_ENGINE_LIMITS.maxLength.max，与流水线 stageDef 默认一致），
      // 防止历史重生成仍走 8013 后端默认 500 截断；
      // context 复用流水线「无 scene_context 回退路径」的 buildOptimizeContext（full_text 全场景文案 +
      // scene_type 推断 + 继承持久化 optimize.context 的 synopsis），场景来源 project.segments；
      // 仅透传契约键（safeOptimizeStageOptions），stage 元键不进入请求；
      // 视频优化词属 8020 域，保持原样不借用图片契约，不参与图片 context 构造。
      let imageOptimizeRequest = null
      if (kind === 'image') {
        const optimizeConfig = project.story2videoTextConfig?.config?.optimize
        const optimizeStageOptions = safeOptimizeStageOptions(optimizeConfig)
        const optimizeContext = buildOptimizeContext(
          (project.segments || []).map(segment => ({ text: segment.text })),
          {
            ...(project.options || {}),
            ...(optimizeConfig && optimizeConfig.context ? { context: optimizeConfig.context } : {}),
          },
        )
        imageOptimizeRequest = buildPromptEngineOptimizeRequest(seed, {
          ...optimizeStageOptions,
          optimization_strategy: 'llm',
          bypass_cache: true,
          max_length: PROMPT_ENGINE_LIMITS.maxLength.max,
          context: optimizeContext,
        })
      }
      const optimized = kind === 'video'
        ? await this.serviceBus.optimizeVideoPrompt(seed, {
            index: segment.sourceIndex ?? index,
            // 视频域显式顶格（PRD 3.1.29.5）：8020 standalone [200,20000] / 8013 legacy [50,2000]
            // 由契约 builder 各自 clamp，与图片分支「显式传域上限」同模式；
            // 防止历史重生成落回后端默认（legacy 500 / standalone 1800）截断。
            max_length: VIDEO_ENGINE_LIMITS.videoMaxLengthMax,
          })
        : await (async () => {
            // 与 stage 层一致：prompt 作为首参，请求参数剥离 prompt 键后透传
            const { prompt: enginePrompt, ...requestOptions } = imageOptimizeRequest
            return this.serviceBus.optimizePrompt(enginePrompt, { ...requestOptions, index: segment.sourceIndex ?? index })
          })()
      // Log optimize result before extraction
      if (this.log && typeof this.log.info === 'function') {
        const resultSummary = optimized && typeof optimized === 'object' ?
          `strategy_used=${optimized.strategy_used || '-'}, key_source=${optimized.key_source || '-'}, cache_hit=${optimized.cache_hit || '-'}, model_used=${optimized.model_used || '-'}` :
          `raw=${String(optimized).slice(0, 100)}`
        this.log.info('[Story2Video]', `regenerateScenePrompt optimize result: ${resultSummary}`)
      }
      const optimizedResult = kind === 'image'
        ? extractImageOptimizedPrompt(optimized)
        : { text: extractOptimizedPrompt(optimized), meta: null }
      const optimizedText = optimizedResult.text
      if (!optimizedText || !optimizedText.trim()) throw new Error('提示词优化结果无效')
      if (kind === 'image') {
        // 防御性本地截断：与流水线 extractOptimizedPrompt(max_length) 语义一致，Unicode 安全
        const capped = Array.from(optimizedText).slice(0, PROMPT_ENGINE_LIMITS.maxLength.max).join('')
        segment.prompt = safeText(capped, 20000)
        segment.promptOptimizationMeta = optimizedResult.meta
        // 提示词重写后旧翻译失效：清空，避免结果页展示陈旧翻译
        segment.promptTranslation = null
      } else {
        segment.videoPrompt = safeText(optimizedText, 40000)
      }
      segment.error = null
      segment.status = 'completed'
      project.segments[index] = segment
      project.dirty = true
      project.updatedAt = new Date().toISOString()
      const saved = this._upsertProject(project)
      this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
      return saved
    } catch (error) {
      if (this.log && typeof this.log.error === 'function') {
        this.log.error('[Story2Video]', `regenerateScenePrompt failed: ${error.message}`)
      }
      project.segments[index] = {
        ...previousProject.segments[index],
        status: 'failed',
        error: error.message,
      }
      project.updatedAt = new Date().toISOString()
      try { this._upsertProject(project) } catch (storageError) {
        if (this.log && typeof this.log.warn === 'function') this.log.warn('[Story2Video] 保存分段失败状态失败', storageError)
      }
      this._cleanupProjectFiles(projectDir, attemptFiles)
      throw error
    }
  }

  /**
   * 重新生成 AI 视频素材（历史记录场景内容闭环 W4）：
   * 以分段 videoPrompt（缺省回退 prompt/text）为提示词，走模型管理器默认 video 能力
   * 提交 generateVideo → 轮询 getVideoStatus → 下载校验后替换 videoPath。
   * 与流水线 generate_assets 阶段同一契约（复用 stages 导出的 generateSceneVideo）。
   * 失败保留旧视频、清理本次产物并回写 failed。
   */
  async generateSceneAiVideo (projectId, segmentId) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(item => ({ ...item })) }
    this._assertId(segmentId, 'segmentId')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const segment = { ...project.segments[index], status: 'processing' }
    const promptText = safeText(segment.videoPrompt || segment.prompt || segment.text, 20000)
    if (!promptText || !promptText.trim()) {
      throw new Error('该场景没有视频优化词，请先编辑或重新生成视频优化词')
    }
    const manager = this.modelProviderManager
    if (!manager || typeof manager.callAdapter !== 'function' || typeof manager.getDefault !== 'function') {
      throw new Error('AI 视频生成服务不可用，请在模型设置中启用视频供应商')
    }
    const generator = this._defaultVideoGenerator(manager)
    if (!generator) throw new Error('未配置可用的视频供应商，请在模型设置中启用视频生成能力')
    const projectDir = this._projectDir(projectId)
    const destination = path.join(projectDir, segment.id + '_video_ai_' + Date.now() + '.mp4')
    const attemptFiles = new Set([destination])
    try {
      const seconds = this.estimateSceneSecondsStage({ duration: segment.duration }, project.options && project.options.defaultSceneDuration)
      const size = this._videoSize(project.options || {})
      const fps = Number(project.options && project.options.fps) > 0 ? Number(project.options.fps) : 30
      const runDir = path.join(os.tmpdir(), 'story2video', 'videoscenes', 'history_' + projectId)
      const outcome = await this.assetRetry(() => this.generateSceneVideoStage({
        manager,
        providerId: generator.providerId,
        model: generator.model,
        prompt: promptText,
        index: segment.sourceIndex ?? index,
        seconds,
        size,
        fps,
        runDir,
        pollIntervalMs: Number(project.options && project.options.video && project.options.video.pollIntervalMs) > 0 ? Number(project.options.video.pollIntervalMs) : 10000,
      }))
      if (!outcome || !outcome.success || !outcome.path) {
        throw new Error((outcome && (outcome.error || outcome.message)) || 'AI 视频生成失败')
      }
      const copiedVideo = this._copyRequired(outcome.path, destination, 'video')
      segment.videoPath = copiedVideo
      segment.videoMeta = { provider: generator.providerId, model: generator.model || null, source: 'ai-video', sceneVideoPath: copiedVideo }
      segment.error = null
      segment.status = 'completed'
      project.segments[index] = segment
      project.dirty = true
      project.updatedAt = new Date().toISOString()
      const saved = this._upsertProject(project)
      this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
      return saved
    } catch (error) {
      project.segments[index] = {
        ...previousProject.segments[index],
        status: 'failed',
        error: error.message,
      }
      project.updatedAt = new Date().toISOString()
      try { this._upsertProject(project) } catch (storageError) {
        if (this.log && typeof this.log.warn === 'function') this.log.warn('[Story2Video] 保存分段失败状态失败', storageError)
      }
      this._cleanupProjectFiles(projectDir, attemptFiles)
      throw error
    }
  }

  /** 默认视频生成器：模型管理器默认 video provider（与流水线 resolveVideoGeneratorConfig fallback 同源）。
   *  双默认语义（2026-08-27）：用户默认 > 运营默认 > capability_models.video > models[0]。 */
  _defaultVideoGenerator (manager) {
    const provider = manager && typeof manager.getDefault === 'function' ? manager.getDefault('video') : null
    if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
    const model = resolveProviderDefaultModel(provider, 'video')
    return { providerId: provider.id.trim(), model }
  }

  /**
   * 历史任务图片重试/重生成的目标 provider+model 解析（2026-08-16 Bug 修复）：
   * 任务创建时固化的 imageProvider/imageModel 只在仍符合当前设置时复用，否则按当前
   * image 能力默认重新解析（与 AI 视频生成 _defaultVideoGenerator 同源语义）。
   * - 保存值缺失（老项目）→ 保持空透传（占位图降级语义不变）；
   * - 保存的是多模态 provider 且用户已关闭「优先使用多模态模型」→ 改走当前 image 默认，
   *   避免继续调用已降级/过期的旧多模态 Key；
   * - 保存的 provider 已删除/禁用/未配置 → 改走当前 image 默认；
   * - 其余情况（用户显式选择的 image 类 provider、多模态优先仍开启）→ 原样复用。
   * 重新解析后无可用 image 默认时返回 null，调用方报可读错误而非回退占位图。
   * @param {string|undefined} savedProvider 任务 options.imageProvider
   * @param {string|undefined} savedModel 任务 options.imageModel
   * @returns {{providerId: string, model: string}|null}
   */
  _resolveImageGenerator (savedProvider, savedModel) {
    const saved = typeof savedProvider === 'string' && savedProvider.trim() ? savedProvider.trim() : ''
    if (!saved) return { providerId: '', model: '' }
    // 老项目固化的图片 provider 别名（如 openai-image → dall-e）：DB 无对应行但
    // asset-generator 仍可 canonical 路由，原样透传保持旧行为（单一来源 asset-generator.js IMAGE_PROVIDER_ALIASES）。
    if (IMAGE_PROVIDER_ALIASES[saved]) {
      return { providerId: saved, model: typeof savedModel === 'string' ? savedModel : '' }
    }
    const manager = this.modelProviderManager
    const managerReady = manager && typeof manager.getProvider === 'function' &&
      typeof manager.getDefault === 'function'
    if (!managerReady) return { providerId: saved, model: typeof savedModel === 'string' ? savedModel : '' }

    const savedRow = manager.getProvider(saved)
    const savedUsable = Boolean(savedRow && savedRow.enabled === true && savedRow.is_configured === true)
    if (!savedUsable) {
      const resolved = this._defaultImageGenerator()
      if (!resolved) return null
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn('[Story2Video] 历史任务图片生成 provider 由 ' + saved + ' 重解析为 ' + resolved.providerId + '（当前设置/状态不满足固化 provider）')
      }
      return resolved
    }
    const savedModelTrim = typeof savedModel === 'string' && savedModel.trim() ? savedModel.trim() : ''
    const savedModels = Array.isArray(savedRow && savedRow.models) ? savedRow.models : []
    const resolvedModel = savedModelTrim && savedModels.includes(savedModelTrim)
      ? savedModelTrim
      : this._imageModelFor(savedRow)
    return { providerId: saved, model: resolvedModel || '' }
  }

  /** 当前 image 能力默认 provider+model（modelProviderManager.getDefault('image')）。 */
  _defaultImageGenerator () {
    const manager = this.modelProviderManager
    if (!manager || typeof manager.getDefault !== 'function') return null
    const provider = manager.getDefault('image')
    if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
    return { providerId: provider.id.trim(), model: this._imageModelFor(provider) }
  }

  /** provider 的默认图片模型（双默认语义 2026-08-27）：用户默认 > 运营默认 >
   *  capability_models.image（缺失时多模态留空交 adapter 默认，普通 provider 取首个模型）。 */
  _imageModelFor (provider) {
    if (!provider) return ''
    return resolveProviderDefaultModel(provider, 'image')
  }

  /** 视频生成尺寸：优先输出分辨率，否则按宽高比映射，长边封顶 1280（与流水线 resolveVideoSize 同源）。 */
  _videoSize (options) {
    const fromSize = parseOutputSize(options.resolution || options.size)
    if (fromSize) return fromSize
    const ratio = options.aspectRatio || '9:16'
    const map = {
      '16:9': [1280, 720],
      '9:16': [720, 1280],
      '1:1': [1024, 1024],
      '4:3': [1280, 960],
      '3:4': [960, 1280],
    }
    const pair = map[ratio] || map['9:16']
    let width = pair[0]
    let height = pair[1]
    const longEdge = Math.max(width, height)
    if (longEdge > 1280) {
      const scale = 1280 / longEdge
      width = Math.max(160, Math.round(width * scale))
      height = Math.max(160, Math.round(height * scale))
    }
    return { width, height }
  }

  async generateSceneImage (projectId, segmentId) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(item => ({ ...item })) }
    this._assertId(segmentId, 'segmentId')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const segment = { ...project.segments[index], status: 'processing' }
    if (!this.assetGenerator || typeof this.assetGenerator.generateImage !== 'function') {
      throw new Error('图片生成服务不可用')
    }
    const projectDir = this._projectDir(projectId)
    const attemptFiles = new Set()
    try {
      // 与重试图片同源：按当前设置解析目标 provider，关闭多模态优先后不再沿用固化多模态 provider。
      // 解析失败同样进入 catch 持久化分段 failed（与 retrySegment 语义一致，审查 M1）。
      const imageGenerator = this._resolveImageGenerator(project.options?.imageProvider, project.options?.imageModel)
      if (!imageGenerator) throw new Error('未找到可用的图片生成器，请先在「模型设置」中配置并启用支持图片生成的模型')
      const generated = await this.assetGenerator.generateImage(segment.prompt || segment.text, {
        index: segment.sourceIndex ?? index,
        style: project.options?.imageStyle,
        image_provider: imageGenerator.providerId,
        image_model: imageGenerator.model,
        aspect_ratio: project.options?.aspectRatio,
        runId: 'scene_image_' + projectId,
      })
      const generatedPath = generated?.data?.path || generated?.data?.image_path || generated?.path
      if (!generated || generated.code !== 0 || !generatedPath) {
        throw new Error(generated?.message || '图片生成失败')
      }
      const copiedImage = this._copyRequired(
        generatedPath,
        path.join(projectDir, segment.id + '_image_gen_' + Date.now() + sourceExtension(generatedPath, '.png')),
        'image',
      )
      attemptFiles.add(copiedImage)
      const generatedMeta = safeAssetMeta(generated?.data || generated)
      const alternate = Array.isArray(segment.alternateImages) ? segment.alternateImages.slice(0, 1) : []
      if (alternate.length === 0) {
        // 只有图1 → 补图2 槽，不改变选中态
        segment.alternateImages = [{ path: copiedImage, meta: generatedMeta }]
      } else if (safeMaterialKind(segment.selectedMaterial) === 'image1') {
        // 图1 被选中 → 替换图2（用户规则：图1 选中时换图2）
        segment.alternateImages = [{ path: copiedImage, meta: generatedMeta }]
      } else {
        // 图1 未被选中（图2/视频/缺失）→ 替换图1（用户规则：图1 未选中时换图1）
        segment.imagePath = copiedImage
        segment.imageMeta = generatedMeta
      }
      segment.error = null
      segment.status = 'completed'
      project.segments[index] = segment
      project.dirty = true
      project.updatedAt = new Date().toISOString()
      const saved = this._upsertProject(project)
      this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
      return saved
    } catch (error) {
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn('[Story2Video] 场景图片生成失败: ' + (error && error.message ? error.message : String(error)))
      }
      project.segments[index] = {
        ...previousProject.segments[index],
        status: 'failed',
        error: error.message,
      }
      project.updatedAt = new Date().toISOString()
      try {
        this._upsertProject(project)
      } catch (storageError) {
        if (this.log && typeof this.log.warn === 'function') {
          this.log.warn('[Story2Video] 保存分段失败状态失败', storageError)
        }
      }
      this._cleanupProjectFiles(projectDir, attemptFiles)
      throw error
    }
  }

  async generateSceneVideo (projectId, segmentId) {
    const project = this.getProject(projectId)
    const previousProject = { ...project, segments: project.segments.map(item => ({ ...item })) }
    this._assertId(segmentId, 'segmentId')
    const index = project.segments.findIndex(segment => segment.id === segmentId)
    if (index < 0) throw new Error('分段不存在')
    const segment = { ...project.segments[index], status: 'processing' }
    if (!segment.audioPath) throw new Error('该场景没有旁白音频，无法生成视频')
    if (!this.composeEngine || typeof this.composeEngine.renderSegment !== 'function') {
      throw new Error('视频合成服务不可用')
    }
    const projectDir = this._projectDir(projectId)
    const destination = path.join(projectDir, segment.id + '_video_render_' + Date.now() + '.mp4')
    const attemptFiles = new Set([destination])
    try {
      // 生成视频始终以「当前选中的图片」为画面：图2 选中用备选图，否则用图1；
      // 显式剥离 videoPath，避免 renderSegment 复用旧视频（引擎 videoPath 优先）。
      const selected = safeMaterialKind(segment.selectedMaterial)
      const sourceImage = selected === 'image2'
        ? (Array.isArray(segment.alternateImages) ? segment.alternateImages[0] : null)
        : null
      const scene = {
        ...segment,
        imagePath: sourceImage && typeof sourceImage.path === 'string' && sourceImage.path
          ? sourceImage.path
          : segment.imagePath,
        videoPath: null,
      }
      if (!scene.imagePath) throw new Error('该场景没有可用的图片素材，请先生成图片')
      const rendered = await this.composeEngine.renderSegment(scene, project.options || {}, destination)
      if (!rendered || rendered.code !== 0 || !rendered.data?.videoPath) {
        throw new Error(rendered?.message || '视频生成失败')
      }
      const copiedVideo = this._copyRequired(rendered.data.videoPath, destination, 'video')
      segment.videoPath = copiedVideo
      segment.duration = Number.isFinite(Number(rendered.data.duration)) ? Number(rendered.data.duration) : segment.duration
      segment.error = null
      segment.status = 'completed'
      project.segments[index] = segment
      project.dirty = true
      project.updatedAt = new Date().toISOString()
      const saved = this._upsertProject(project)
      this._cleanupUnreferencedProjectFiles(projectId, previousProject, saved)
      return saved
    } catch (error) {
      // 失败保留旧视频：状态回写 failed，字段保持生成前值（previousProject）
      project.segments[index] = {
        ...previousProject.segments[index],
        status: 'failed',
        error: error.message,
      }
      project.updatedAt = new Date().toISOString()
      try {
        this._upsertProject(project)
      } catch (storageError) {
        if (this.log && typeof this.log.warn === 'function') {
          this.log.warn('[Story2Video] 保存分段失败状态失败', storageError)
        }
      }
      this._cleanupProjectFiles(projectDir, attemptFiles)
      throw error
    }
  }

  _transcriptionProvider () {
    const manager = this.modelProviderManager
    if (!manager) return null
    const selected = typeof manager.getDefault === 'function' ? manager.getDefault('speech_recognition') : null
    const providers = typeof manager.listProviders === 'function' ? manager.listProviders('speech_recognition') : []
    const candidates = [selected, ...(Array.isArray(providers) ? providers : [])]
    const seen = new Set()

    for (const candidate of candidates) {
      if (!candidate || typeof candidate.id !== 'string' || seen.has(candidate.id)) continue
      seen.add(candidate.id)
      const provider = typeof manager.getProvider === 'function'
        ? (manager.getProvider(candidate.id) || candidate)
        : candidate
      if (provider.category && provider.category !== 'speech_recognition') continue
      if (provider.enabled === false) continue
      if (provider.id === 'local-whisper' && !providerBaseUrl(provider)) continue
      return provider
    }
    return null
  }

  async transcribeFile (filePath) {
    const resolved = this._resolveTranscriptionSource(filePath)
    if (!resolved) throw new Error('旁白文件路径无效、未导入或不允许访问')
    const provider = this._transcriptionProvider()
    if (!provider) throw new Error('未配置语音识别服务，请先在模型设置中启用语音识别供应商')
    const buffer = fs.readFileSync(resolved)
    const extension = sourceExtension(resolved, '.wav').slice(1)
    let result
    if (provider.id === 'local-whisper') {
      const { LocalWhisperAdapter } = require('./adapters/local-whisper')
      const adapter = new LocalWhisperAdapter({
        id: provider.id,
        baseUrl: providerBaseUrl(provider),
        apiKey: provider.config?.apiKey,
      })
      result = await adapter.transcribe({
        audio: buffer,
        filename: path.basename(resolved),
        model: resolveProviderDefaultModel(provider, 'speech_recognition') || 'base',
        endpoint: provider.config?.endpoint || 'asr',
        language: provider.config?.language,
      })
    } else {
      if (!this.aiGenerator || typeof this.aiGenerator.generate !== 'function') throw new Error('语音识别服务不可用')
      const base64Providers = new Set(['google-stt', 'doubao-stt', 'baidu-stt'])
      const params = base64Providers.has(provider.id)
        ? { audio: buffer.toString('base64'), len: buffer.length, format: extension, model: resolveProviderDefaultModel(provider, 'speech_recognition') }
        : { file: new Blob([buffer]), filename: path.basename(resolved), model: resolveProviderDefaultModel(provider, 'speech_recognition') || 'whisper-1' }
      result = await this.aiGenerator.generate('speech_recognition', provider.id, params)
    }
    const text = safeText(result?.text, 100000).trim()
    if (!text) throw new Error('语音识别未返回文字')
    return { ...result, text, provider: provider.id }
  }

  getCapabilities () {
    const provider = this._transcriptionProvider()
    const requiresGenerator = provider && provider.id !== 'local-whisper'
    const generatorAvailable = !requiresGenerator || typeof this.aiGenerator?.generate === 'function'
    return {
      transcription: {
        available: Boolean(provider && generatorAvailable),
        provider: provider?.id || null,
        reason: !provider
          ? '未配置已启用的语音识别供应商'
          : (generatorAvailable ? null : '语音识别执行器不可用'),
      },
      remix: {
        available: false,
        reason: '当前没有已配置且可验证的 Sora Remix 供应商；旧项目同样依赖外部 Supabase/Sora 服务',
      },
      voiceClone: {
        available: false,
        reason: '当前 Story2Video 流水线没有已验证的音色克隆供应商',
      },
    }
  }
}

module.exports = {
  Story2VideoProjectService,
  SETTING_KEY,
  copyFileAtomic,
  resolveComposeOutput,
  nextUpdatedAt,
}
