// @ts-check
'use strict'

const fs = require('fs')
const path = require('path')
const { withSenderCheck } = require('./helpers')
const { ERROR: EC } = require('../core/error-codes')
  const log = require('../services/logger')
const {
  MAX_EXPORT_BYTES,
  createShareFileUrl,
  createZipFromFiles,
} = require('../services/story2video-export')
const {
  cleanupImportedMediaPaths,
  gcImportedMedia,
  getAllowedMediaRoots,
  importUserSelectedMedia,
  isPathWithin,
  resolveReadableFile,
} = require('../services/story2video-paths')
const {
  getStory2VideoBgmLibrary,
} = require('../services/story2video-bgm-library')
const {
  getStory2VideoConfigProfiles,
} = require('../services/story2video-config-profiles')

function safeZipName (value) {
  const base = path.basename(typeof value === 'string' && value.trim() ? value.trim() : 'story2video-export.zip')
  const sanitized = Array.from(base, (character) => (
    character < ' ' || '<>:"/\\|?*'.includes(character) ? '_' : character
  )).join('').slice(0, 120)
  return sanitized.toLowerCase().endsWith('.zip') ? sanitized : sanitized + '.zip'
}

function validateFilePath (filePath, extraRoots = [], projectMediaResolver = null) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null
  const resolved = resolveReadableFile(filePath, {
    allowedRoots: getAllowedMediaRoots(extraRoots),
    maxBytes: MAX_EXPORT_BYTES,
  })
  if (resolved) return resolved
  // 跨 profile 迁移 / 设置库合并后：仅当路径属于本项目服务持久化过的「项目清单目录」
  // （目录含 project.json 且清单引用该文件）时，作为只读媒体回退放行。
  if (typeof projectMediaResolver === 'function') {
    try {
      const fallback = projectMediaResolver(filePath, { maxBytes: MAX_EXPORT_BYTES })
      return fallback || null
    } catch (_) { return null }
  }
  return null
}

function isSafeId (value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
}

// Only reclaim a token that belongs to this local media server: same origin as the
// freshly issued URL and a media path with a valid token shape. Anything else (file://,
// foreign origin, non-media path) is ignored so a stale renderer value cannot evict a
// token still in active use by another segment.
function isLocalMediaTokenUrl (value, sampleUrl) {
  try {
    const previous = new URL(value)
    const sample = new URL(sampleUrl)
    return previous.origin === sample.origin && /^\/media\/[A-Za-z0-9_-]{16,128}$/.test(previous.pathname)
  } catch (_) {
    return false
  }
}

function registerHandlers (ipcMain, deps = {}) {
  const electron = require('electron')
  const BrowserWindow = deps.BrowserWindow || electron.BrowserWindow
  const dialog = deps.dialog || electron.dialog
  const shell = deps.shell || electron.shell
  const clipboard = deps.clipboard || electron.clipboard
  const mediaServer = deps.story2videoMediaServer || null
  const projectService = deps.story2videoProjectService || null
  const projectRoots = projectService && typeof projectService.projectsDir === 'string'
    ? [projectService.projectsDir]
    : []
  const allowedMediaRoots = (extraRoots = []) => getAllowedMediaRoots([...projectRoots, ...extraRoots])
  const resolveProjectMedia = projectService && typeof projectService.resolveProjectMedia === 'function'
    ? projectService.resolveProjectMedia.bind(projectService)
    : null
  const getProjectMediaRoot = projectService && typeof projectService.getProjectMediaRoot === 'function'
    ? projectService.getProjectMediaRoot.bind(projectService)
    : null
  // 默认根外的文件经项目清单目录放行后，URL 签发（createShareFileUrl 二次校验）同样需要并入该项目根。
  const projectMediaRootsFor = (filePath) => {
    if (!getProjectMediaRoot || typeof filePath !== 'string' || !filePath.trim()) return []
    // 默认根内的文件直接短路，无需解析清单（避免每次 URL 签发都读 project.json，审查 I1）
    if (isPathWithin(path.resolve(filePath), getAllowedMediaRoots())) return []
    const root = getProjectMediaRoot(filePath)
    return root ? [root] : []
  }

  // BGM 素材库：生产环境懒创建（userData/story2video-bgm）；测试可注入 mock 实例。
  let bgmLibrary = deps.story2videoBgmLibrary || null
  let bgmLibraryError = null
  const requireBgmLibrary = () => {
    if (bgmLibrary) return bgmLibrary
    if (!bgmLibraryError) {
      try {
        bgmLibrary = getStory2VideoBgmLibrary()
      } catch (error) {
        bgmLibraryError = error
      }
    }
    if (!bgmLibrary) throw bgmLibraryError || new Error('BGM 素材库不可用')
    return bgmLibrary
  }

  const requireProjectService = () => {
    if (!projectService) throw new Error('Story2Video 项目服务不可用')
    return projectService
  }

  // 流水线「保存配置」库：生产环境懒创建（userData/story2video-config-profiles）；测试可注入 mock 实例。
  let configProfiles = deps.story2videoConfigProfiles || null
  let configProfilesError = null
  const requireConfigProfiles = () => {
    if (configProfiles) return configProfiles
    if (!configProfilesError) {
      try {
        configProfiles = getStory2VideoConfigProfiles()
      } catch (error) {
        configProfilesError = error
      }
    }
    if (!configProfiles) throw configProfilesError || new Error('配置库不可用')
    return configProfiles
  }

  // selected-media 老化回收：仅在显式开启时执行（测试环境默认不触发，避免触碰真实临时目录）。
  // 生产接线在 ipc-handlers/index.js 传入 runImportedMediaGc: true。
  if (deps.runImportedMediaGc === true) {
    const gc = (deps && typeof deps.gcImportedMedia === 'function') ? deps.gcImportedMedia : gcImportedMedia
    try {
      gc()
    } catch (gcError) {
      console.warn('[story2video] imported-media GC failed: ' + (gcError && gcError.message ? gcError.message : String(gcError)))
    }
  }

  ipcMain.handle('story2video:list-projects', withSenderCheck(async () => {
    try {
      const service = requireProjectService()
      const localMode = typeof service.isLocalOwner === 'function' ? service.isLocalOwner() : false
      return { code: 0, data: service.listProjects(), localMode }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message, data: [] } }
  }))

  ipcMain.handle('story2video:get-project', withSenderCheck(async (_event, projectId) => {
    if (!isSafeId(projectId)) return { code: EC.VALIDATION_ERROR, message: 'projectId 无效' }
    try { return { code: 0, data: requireProjectService().getProject(projectId) } }
    catch (error) { return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:get-thumbnail', withSenderCheck(async (_event, projectId) => {
    if (!isSafeId(projectId)) return { code: EC.VALIDATION_ERROR, message: 'projectId 无效' }
    try {
      const thumbnail = await requireProjectService().getThumbnail(projectId)
      if (!thumbnail || thumbnail.status !== 'ready' || !thumbnail.path) {
        return { code: 0, data: { status: thumbnail?.status || 'missing', kind: thumbnail?.kind || 'missing', url: null } }
      }
      const resolved = validateFilePath(thumbnail.path, projectRoots, resolveProjectMedia)
      if (!resolved) return { code: 0, data: { status: 'failed', kind: 'failed', url: null } }
      const url = createShareFileUrl(resolved, {
        allowedRoots: allowedMediaRoots(projectMediaRootsFor(resolved)),
        mediaServer,
      })
      if (typeof url !== 'string' || !url.trim()) {
        return { code: 0, data: { status: 'failed', kind: 'failed', url: null } }
      }
      return { code: 0, data: { status: 'ready', kind: thumbnail.kind, url } }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: error.message }
    }
  }))

  ipcMain.handle('story2video:delete-project', withSenderCheck(async (_event, projectId) => {
    if (!isSafeId(projectId)) return { code: EC.VALIDATION_ERROR, message: 'projectId 无效' }
    try {
      const result = await requireProjectService()._serializeProject(projectId, () => requireProjectService().deleteProject(projectId))
      // 级联清理该项目的持久化 run-state 快照：已中断/失败/暂停的编排 run 以快照形式
      // 由 pipelineHistory() 重新加载，若不清理，删除项目后重进历史页该 run 会再次出现
      // （2026-08-30 Bug：批量删除「已中断」任务后仍残留）。
      // runId 与 projectId 同源（saveRun/saveEditableRun 均以 run.id 作为 projectId），
      // 直接以 projectId 作为快照键清理；快照不存在时 remove 幂等返回 true。
      const runStateStore = deps.runStateStore || null
      if (runStateStore && typeof runStateStore.remove === 'function') {
        try {
          runStateStore.remove(projectId)
        } catch (cleanupError) {
          // 快照清理失败不阻断项目删除：孤立快照为本地垃圾，记录告警而非抛错，
          // 避免 UI 弹出误导性「项目未能删除」提示（与 deleteProject 目录清理语义一致）。
          console.warn('[story2video] run-state snapshot cleanup failed: ' + (cleanupError && cleanupError.message ? cleanupError.message : String(cleanupError)) + ' projectId=' + projectId)
        }
      }
      return { code: 0, data: result }
    }
    catch (error) { return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:ensure-project', withSenderCheck(async (_event, payload) => {
    if (!payload || typeof payload !== 'object' || !isSafeId(payload.projectId)) {
      return { code: EC.VALIDATION_ERROR, message: 'payload.projectId 无效' }
    }
    try {
      const service = requireProjectService()
      const result = service.ensureProjectFromRun(payload)
      return { code: 0, data: result }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:update-segments', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) ||
        !Array.isArray(request.segments) || request.segments.length === 0) {
      return { code: EC.VALIDATION_ERROR, message: '分段更新参数无效' }
    }
    try { return { code: 0, data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().updateSegments(request.projectId, request.segments)) } }
    catch (error) { return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:replace-segment-audio', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) ||
        !isSafeId(request.segmentId) || typeof request.filePath !== 'string' || !request.filePath.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '分段音频替换参数无效' }
    }
    try {
      return {
        code: 0,
        data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().replaceSegmentAudio(request.projectId, request.segmentId, request.filePath)),
      }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: error.message }
    } finally {
      cleanupImportedMediaPaths({ audio: [{ path: request.filePath }] })
    }
  }))

  ipcMain.handle('story2video:retry-segment', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) ||
        !isSafeId(request.segmentId) || !['image', 'video'].includes(request.mode)) {
      return { code: EC.VALIDATION_ERROR, message: '分段重试参数无效' }
    }
    try {
      const data = await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().retrySegment(request.projectId, request.segmentId, request.mode))
      return { code: 0, data }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:recompose-project', withSenderCheck(async (_event, projectId) => {
    if (!isSafeId(projectId)) return { code: EC.VALIDATION_ERROR, message: 'projectId 无效' }
    try { return { code: 0, data: await requireProjectService()._serializeProject(projectId, () => requireProjectService().recomposeProject(projectId)) } }
    catch (error) { return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:select-scene-material', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) ||
        !isSafeId(request.segmentId) || !['image1', 'image2', 'video', 'video1', 'video2'].includes(request.kind)) {
      return { code: EC.VALIDATION_ERROR, message: '素材选择参数无效' }
    }
    try {
      return { code: 0, data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().selectSceneMaterial(request.projectId, request.segmentId, request.kind)) }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:generate-scene-image', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) || !isSafeId(request.segmentId)) {
      return { code: EC.VALIDATION_ERROR, message: '场景图片生成参数无效' }
    }
    try {
      return { code: 0, data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().generateSceneImage(request.projectId, request.segmentId)) }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:generate-scene-ai-video', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) || !isSafeId(request.segmentId)) {
      return { code: EC.VALIDATION_ERROR, message: '场景 AI 视频重新生成参数无效' }
    }
    try {
      return { code: 0, data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().generateSceneAiVideo(request.projectId, request.segmentId)) }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:generate-scene-video', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) || !isSafeId(request.segmentId)) {
      return { code: EC.VALIDATION_ERROR, message: '场景视频生成参数无效' }
    }
    try {
      return { code: 0, data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().generateSceneVideo(request.projectId, request.segmentId)) }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:regenerate-scene-subtitle', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) || !isSafeId(request.segmentId)) {
      return { code: EC.VALIDATION_ERROR, message: '场景字幕重新生成参数无效' }
    }
    try {
      return { code: 0, data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().regenerateSceneSubtitle(request.projectId, request.segmentId)) }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:regenerate-scene-audio', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) || !isSafeId(request.segmentId)) {
      return { code: EC.VALIDATION_ERROR, message: '场景旁白重新生成参数无效' }
    }
    try {
      return { code: 0, data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().regenerateSceneAudio(request.projectId, request.segmentId)) }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:regenerate-scene-prompt', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || !isSafeId(request.projectId) ||
        !isSafeId(request.segmentId) || !['image', 'video'].includes(request.kind)) {
      return { code: EC.VALIDATION_ERROR, message: '场景优化词重新生成参数无效' }
    }
    try {
      return { code: 0, data: await requireProjectService()._serializeProject(request.projectId, () => requireProjectService().regenerateScenePrompt(request.projectId, request.segmentId, request.kind)) }
    } catch (error) { log.warn('[ipc:story2video]', ((error && error.message) || String(error))); return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:transcribe', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || typeof request.filePath !== 'string') {
      return { code: EC.VALIDATION_ERROR, message: '语音识别参数无效' }
    }
    try { return { code: 0, data: await requireProjectService().transcribeFile(request.filePath) } }
    catch (error) { return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:capabilities', withSenderCheck(async () => {
    try { return { code: 0, data: requireProjectService().getCapabilities() } }
    catch (error) { return { code: EC.REQUEST_ERROR, message: error.message } }
  }))

  ipcMain.handle('story2video:import-media', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return { code: EC.VALIDATION_ERROR, message: '媒体导入参数必须为对象' }
    }
    try {
      // 生产导入路径开启惰性 GC（selected-media 老化回收，默认 1h 间隔）。
      const data = importUserSelectedMedia(request.filePath, request.kind, { gcEnabled: true })
      return { code: 0, data }
    } catch (error) {
      return { code: EC.VALIDATION_ERROR, message: error.message }
    }
  }))

  // BGM 素材库：设备级持久化（userData/story2video-bgm），纯本地操作，未登录可用。
  ipcMain.handle('story2video:bgm-library-list', withSenderCheck(async () => {
    try {
      return { code: 0, data: requireBgmLibrary().list() }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: error.message }
    }
  }))

  ipcMain.handle('story2video:bgm-library-add', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.filePath !== 'string' || !request.filePath.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '背景音乐文件路径无效' }
    }
    try {
      const data = requireBgmLibrary().add(request.filePath)
      return { code: 0, data }
    } catch (error) {
      // message 沿用 importUserSelectedMedia 语义（不支持的媒体格式/超过大小上限/被占用），
      // renderer 经 resolveMediaImportFailure 映射为用户可读提示。
      return { code: EC.VALIDATION_ERROR, message: error.message }
    }
  }))

  ipcMain.handle('story2video:bgm-library-rename', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.id !== 'string' || !request.id.trim() || typeof request.name !== 'string') {
      return { code: EC.VALIDATION_ERROR, message: '背景音乐重命名参数无效' }
    }
    try {
      const data = requireBgmLibrary().rename(request.id, request.name)
      return { code: 0, data }
    } catch (error) {
      return { code: EC.VALIDATION_ERROR, message: error.message }
    }
  }))

  ipcMain.handle('story2video:bgm-library-delete', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.id !== 'string' || !request.id.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '背景音乐删除参数无效' }
    }
    try {
      const data = requireBgmLibrary().delete(request.id)
      return { code: 0, data }
    } catch (error) {
      return { code: EC.VALIDATION_ERROR, message: error.message }
    }
  }))

  // 历史背景音乐存在性核验（s2v-bgm-legacy-repair）：只读、纯本地，未登录可用。
  // 解决「已选音频（未入库）」把“文件仍可用 / 已被临时目录清理 / 已不可用”混为一谈的问题；
  // 判定合同与 compose 的 resolveReadableMediaFile 同源，避免界面与合成双源真相。
  ipcMain.handle('story2video:bgm-library-status', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.filePath !== 'string' || !request.filePath.trim() || request.filePath.length > 4096) {
      return { code: EC.VALIDATION_ERROR, message: '背景音乐文件路径无效' }
    }
    try {
      return { code: 0, data: requireBgmLibrary().inspectPath(request.filePath) }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: error.message }
    }
  }))

  // 流水线「保存配置」：设备级命名组合配置（userData/story2video-config-profiles），
  // 本地操作未登录可用（与 bgm-library 同安全白名单）。
  ipcMain.handle('story2video:config-profile-list', withSenderCheck(async () => {
    try {
      return { code: 0, data: requireConfigProfiles().list() }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: error.message }
    }
  }))

  ipcMain.handle('story2video:config-profile-create', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.pipelineId !== 'string' || !request.pipelineId.trim() ||
      typeof request.name !== 'string' || !request.snapshot || typeof request.snapshot !== 'object' || Array.isArray(request.snapshot)) {
      return { code: EC.VALIDATION_ERROR, message: '配置参数无效' }
    }
    try {
      const data = requireConfigProfiles().create({
        pipelineId: request.pipelineId,
        name: request.name,
        snapshot: request.snapshot,
        overwrite: request.overwrite === true,
      })
      return { code: 0, data }
    } catch (error) {
      // 业务/参数校验错误 → VALIDATION_ERROR；IO/占用等运行时错误 → REQUEST_ERROR（双模型审查 M3 修复）
      const code = error && error.name === 'ProfileValidationError' ? EC.VALIDATION_ERROR : EC.REQUEST_ERROR
      return { code, message: error.message }
    }
  }))

  ipcMain.handle('story2video:config-profile-rename', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.id !== 'string' || !request.id.trim() || typeof request.name !== 'string') {
      return { code: EC.VALIDATION_ERROR, message: '配置重命名参数无效' }
    }
    try {
      const data = requireConfigProfiles().rename(request.id, request.name)
      return { code: 0, data }
    } catch (error) {
      const code = error && error.name === 'ProfileValidationError' ? EC.VALIDATION_ERROR : EC.REQUEST_ERROR
      return { code, message: error.message }
    }
  }))

  ipcMain.handle('story2video:config-profile-delete', withSenderCheck(async (_event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.id !== 'string' || !request.id.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '配置删除参数无效' }
    }
    try {
      const data = requireConfigProfiles().delete(request.id)
      return { code: 0, data }
    } catch (error) {
      const code = error && error.name === 'ProfileValidationError' ? EC.VALIDATION_ERROR : EC.REQUEST_ERROR
      return { code, message: error.message }
    }
  }))

  ipcMain.handle('story2video:export-zip', withSenderCheck(async (event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return { code: EC.VALIDATION_ERROR, message: '导出参数必须为对象' }
    }
    if (!Array.isArray(request.files) || request.files.length === 0) {
      return { code: EC.VALIDATION_ERROR, message: '至少选择一个视频文件' }
    }

    let destinationPath = request.destinationPath
    let allowedRoots = allowedMediaRoots()
    // 逐文件独立校验（默认根或项目清单目录根），任一文件不通过立即拒绝：
    // 不允许用「清单引用的文件」整体解锁项目目录后再导出其中未引用文件（审查 W1）。
    const projectRootsExtra = []
    const validatedFiles = []
    for (const item of request.files) {
      const file = item && typeof item === 'object' ? (item.path || item.filePath) : null
      if (typeof file !== 'string' || !file.trim()) {
        return { code: EC.VALIDATION_ERROR, message: '导出文件参数无效' }
      }
      const resolved = validateFilePath(file, projectRoots, resolveProjectMedia)
      if (!resolved) return { code: EC.VALIDATION_ERROR, message: '导出文件路径无效或不允许访问' }
      if (!isPathWithin(path.resolve(resolved), getAllowedMediaRoots()) && getProjectMediaRoot) {
        const rootDir = getProjectMediaRoot(resolved)
        if (rootDir) projectRootsExtra.push(rootDir)
      }
      validatedFiles.push({ ...(item && typeof item === 'object' ? item : {}), path: resolved })
    }
    if (destinationPath !== undefined && (typeof destinationPath !== 'string' || !path.isAbsolute(destinationPath))) {
      return { code: EC.VALIDATION_ERROR, message: '导出目标路径无效' }
    }
    if (!destinationPath) {
      if (!dialog || typeof dialog.showSaveDialog !== 'function') {
        return { code: EC.REQUEST_ERROR, message: '系统保存对话框不可用' }
      }
      const options = {
        title: '导出 Story2Video ZIP',
        defaultPath: safeZipName(request.suggestedName),
        filters: [{ name: 'ZIP 归档', extensions: ['zip'] }],
      }
      const win = BrowserWindow && typeof BrowserWindow.fromWebContents === 'function'
        ? BrowserWindow.fromWebContents(event.sender)
        : null
      const selection = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (selection.canceled || !selection.filePath) return { code: 0, data: { cancelled: true } }
      destinationPath = selection.filePath
      allowedRoots = allowedMediaRoots([...projectRootsExtra, path.dirname(destinationPath)])
    } else if (projectRootsExtra.length > 0) {
      allowedRoots = allowedMediaRoots(projectRootsExtra)
    }

    try {
      const data = await createZipFromFiles(validatedFiles, destinationPath, { allowedRoots })
      return { code: 0, data }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: error.message }
    }
  }))

  ipcMain.handle('story2video:create-share-url', withSenderCheck(async (_event, filePath, previousUrl) => {
    try {
      const resolved = validateFilePath(filePath, projectRoots, resolveProjectMedia)
      if (!resolved) return { code: EC.VALIDATION_ERROR, message: '视频文件路径无效或不允许访问' }
      const allowedRoots = allowedMediaRoots(projectMediaRootsFor(resolved))
      const url = createShareFileUrl(resolved, { allowedRoots, mediaServer })
      // Best-effort reclaim of the previous short-lived media token: after re-issuing a
      // fresh URL for the same file, the old token is revoked so it cannot linger. Only
      // same-server media URLs are accepted; anything else is ignored.
      if (typeof previousUrl === 'string' && previousUrl && isLocalMediaTokenUrl(previousUrl, url) &&
          mediaServer && typeof mediaServer.revoke === 'function') {
        try { mediaServer.revoke(previousUrl) } catch (_) { /* revoke is best-effort */ }
      }
      return { code: 0, data: { url, path: resolved } }
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: error.message }
    }
  }))

  ipcMain.handle('story2video:copy-path', withSenderCheck(async (_event, filePath) => {
    const resolved = validateFilePath(filePath, projectRoots, resolveProjectMedia)
    if (!resolved) return { code: EC.VALIDATION_ERROR, message: '视频文件路径无效或不允许访问' }
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      return { code: EC.REQUEST_ERROR, message: '系统剪贴板不可用' }
    }
    clipboard.writeText(resolved)
    return { code: 0, data: { path: resolved } }
  }))

  ipcMain.handle('story2video:show-in-folder', withSenderCheck(async (_event, filePath) => {
    const resolved = validateFilePath(filePath, projectRoots, resolveProjectMedia)
    if (!resolved) return { code: EC.VALIDATION_ERROR, message: '视频文件路径无效或不允许访问' }
    if (!shell || typeof shell.showItemInFolder !== 'function') {
      return { code: EC.REQUEST_ERROR, message: '系统文件管理器不可用' }
    }
    shell.showItemInFolder(resolved)
    return { code: 0, data: { path: resolved } }
  }))

  // 保存文件到用户选择的位置（弹系统保存对话框 + 复制文件）。
  // 修复：renderer 的 <a download> 对跨源/本地 HTTP 媒体 URL 无效（下载按钮无反应），
  // 下载必须走主进程 showSaveDialog + copyFileSync。
  ipcMain.handle('story2video:save-as', withSenderCheck(async (event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.filePath !== 'string' || !request.filePath.trim()) {
      return { code: EC.VALIDATION_ERROR, message: '保存参数无效' }
    }
    const resolved = validateFilePath(request.filePath, projectRoots, resolveProjectMedia)
    if (!resolved) return { code: EC.VALIDATION_ERROR, message: '文件路径无效或不允许访问' }
    let stat
    try {
      stat = fs.statSync(resolved)
    } catch {
      return { code: EC.VALIDATION_ERROR, message: '文件不存在或不可读' }
    }
    if (!stat.isFile() || stat.size <= 0) return { code: EC.VALIDATION_ERROR, message: '文件不存在或不可读' }

    const suggested = typeof request.suggestedName === 'string' && request.suggestedName.trim()
      ? path.basename(request.suggestedName).slice(0, 120)
      : path.basename(resolved)
    if (!dialog || typeof dialog.showSaveDialog !== 'function') {
      return { code: EC.REQUEST_ERROR, message: '系统保存对话框不可用' }
    }
    const extension = path.extname(resolved).replace(/^\./, '').toLowerCase()
    const options = {
      title: '保存文件',
      defaultPath: suggested,
      filters: extension ? [{ name: extension.toUpperCase() + ' 文件', extensions: [extension] }] : [],
    }
    const win = BrowserWindow && typeof BrowserWindow.fromWebContents === 'function'
      ? BrowserWindow.fromWebContents(event.sender)
      : null
    const selection = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (selection.canceled || !selection.filePath) return { code: 0, data: { cancelled: true } }
    try {
      fs.copyFileSync(resolved, selection.filePath)
    } catch (error) {
      return { code: EC.REQUEST_ERROR, message: '文件保存失败：' + (error && error.message ? error.message : String(error)) }
    }
    return { code: 0, data: { path: selection.filePath } }
  }))
}

module.exports = registerHandlers
