// @ts-check
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { fileURLToPath } = require('url')

const MAX_INPUT_FILE_BYTES = 100 * 1024 * 1024
const MAX_INPUT_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024
const MAX_AUDIO_FILE_BYTES = 50 * 1024 * 1024
const MAX_BGM_FILE_BYTES = 15 * 1024 * 1024
const STORY2VIDEO_TEMP_DIR = path.join(os.tmpdir(), 'story2video')
// 电影工程 run 产物根（film-engineering/<runId>/shot_NNN.mp4 / final.mp4）：
// D9 沿用受控媒体根机制，成片「打开所在文件夹/另存」复用既有 shell/showSaveDialog IPC，不新开白名单路径。
const FILM_ENGINEERING_RUNS_DIR = path.join(os.tmpdir(), 'film-engineering')
const IMPORTED_MEDIA_DIR = path.join(STORY2VIDEO_TEMP_DIR, 'selected-media')
const MAX_VIDEO_FILE_BYTES = 512 * 1024 * 1024

const MEDIA_RULES = Object.freeze({
  image: { extensions: new Set(['.jpg', '.jpeg', '.png', '.webp']), maxBytes: MAX_IMAGE_FILE_BYTES },
  audio: { extensions: new Set(['.wav', '.m4a', '.mp3']), maxBytes: MAX_AUDIO_FILE_BYTES },
  bgm: { extensions: new Set(['.wav', '.m4a', '.mp3']), maxBytes: MAX_BGM_FILE_BYTES },
  video: { extensions: new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']), maxBytes: MAX_VIDEO_FILE_BYTES },
})

function safeRunId (value) {
  return String(value || 'run').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'run'
}

function getElectronMediaRoots (appImpl) {
  const roots = []
  try {
    // 允许测试注入 app 实现（仓库惯例：纯 Node 测试通过依赖注入避开 require('electron') 不可 mock 的限制）
    let app = appImpl
    if (!app) {
      const electron = require('electron')
      app = electron && electron.app
    }
    if (app && typeof app.getPath === 'function') {
      const userData = app.getPath('userData')
      if (userData) {
        roots.push(path.join(userData, 'story2video-projects'))
        // BGM 素材库（持久化，设备级）：库内文件经 compose 的 resolveReadableMediaFile 校验放行
        roots.push(path.join(userData, 'story2video-bgm'))
      }
    }
  } catch (_) { /* 纯 Node 测试或非 Electron 调用 */ }
  return roots
}

function getAllowedMediaRoots (extraRoots = []) {
  const roots = [STORY2VIDEO_TEMP_DIR, FILM_ENGINEERING_RUNS_DIR, ...getElectronMediaRoots(), ...extraRoots]
  const unique = []
  for (const root of roots) {
    if (typeof root !== 'string' || !root.trim()) continue
    const resolved = path.resolve(root)
    if (!unique.includes(resolved)) unique.push(resolved)
  }
  return unique
}

function canonicalPath (candidate) {
  const resolved = path.resolve(candidate)
  let cursor = resolved
  const suffix = []
  while (true) {
    try {
      return path.join(fs.realpathSync.native(cursor), ...suffix.reverse())
    } catch {
      const parent = path.dirname(cursor)
      if (parent === cursor) return resolved
      suffix.push(path.basename(cursor))
      cursor = parent
    }
  }
}

function isPathWithin (candidate, roots) {
  if (typeof candidate !== 'string' || !candidate) return false
  const resolvedCandidate = canonicalPath(candidate)
  return (Array.isArray(roots) ? roots : [roots]).some((root) => {
    if (typeof root !== 'string' || !root) return false
    const resolvedRoot = canonicalPath(root)
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep)
  })
}

function toLocalPath (candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null
  const value = candidate.trim()
  if (/^file:\/\//i.test(value)) {
    try { return fileURLToPath(value) } catch { return null }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null
  return value
}

/**
 * 只返回用户可访问根目录内的 canonical 普通文件。
 * 先检查 lstat，拒绝 renderer 伪造的符号链接，再检查 realpath 防止链接越界。
 */
function resolveReadableFile (candidate, options = {}) {
  const localPath = toLocalPath(candidate)
  if (!localPath) return null
  const absolute = path.resolve(localPath)
  const roots = options.allowedRoots || getAllowedMediaRoots()
  if (!isPathWithin(absolute, roots)) return null

  try {
    const linkStat = fs.lstatSync(absolute)
    if (!linkStat.isFile() || linkStat.isSymbolicLink()) return null
    const realPath = fs.realpathSync.native(absolute)
    if (!isPathWithin(realPath, roots)) return null
    const stat = fs.statSync(realPath)
    const maxBytes = Number.isFinite(Number(options.maxBytes))
      ? Number(options.maxBytes)
      : MAX_INPUT_FILE_BYTES
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null
    return realPath
  } catch {
    return null
  }
}

function getMediaRule (kind) {
  return MEDIA_RULES[kind] || null
}

function resolveReadableMediaFile (candidate, options = {}) {
  const rule = getMediaRule(options.kind)
  const localPath = toLocalPath(candidate)
  if (!rule || !localPath || !rule.extensions.has(path.extname(localPath).toLowerCase())) return null
  const requestedMax = Number(options.maxBytes)
  const maxBytes = Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.min(requestedMax, rule.maxBytes)
    : rule.maxBytes
  return resolveReadableFile(localPath, { ...options, maxBytes })
}

/**
 * Windows 上文件可能被其他程序短时占用（EBUSY/EPERM/EACCES）。
 * 复制仅在占用类错误上做有界重试（短退避），其余错误原样抛出；
 * 持续占用回传可读中文原因，便于 renderer 映射「文件被占用」提示。
 */
function copyImportedMedia (source, destination) {
  const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])
  const MAX_COPY_ATTEMPTS = 3
  const RETRY_DELAY_MS = 150
  let lastError = null
  for (let attempt = 0; attempt < MAX_COPY_ATTEMPTS; attempt++) {
    try {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
      return
    } catch (error) {
      lastError = error
      if (!error || !RETRYABLE_CODES.has(error.code) || attempt === MAX_COPY_ATTEMPTS - 1) break
      // 有意为之的同步短退避（150ms×n，最坏 450ms）：仅出现在文件被占用的罕见路径，
      // 避免把导入链路改成 async 波及全部调用方；对瞬时占用重试收益远大于一次短阻塞。
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS * (attempt + 1))
    }
  }
  if (lastError && RETRYABLE_CODES.has(lastError.code)) {
    throw new Error('媒体文件被占用，请关闭占用程序后重试')
  }
  throw lastError instanceof Error ? lastError : new Error('媒体文件复制失败')
}

/**
 * Electron 的 File 选择只证明用户选择过该路径，不应因此放开整块磁盘。
 * 这里把文件复制到应用控制的临时目录，后续阶段继续使用 canonical 白名单校验。
 */
const DEFAULT_IMPORT_GC_INTERVAL_MS = 60 * 60 * 1000
// 惰性 GC 节流按 baseDir 拆分（模块级共享，避免不同导入目录互相抑制；测试亦隔离）。
// Minor9 备注：生产仅 `story2video:import-media` 单 baseDir（selected-media）场景成立；
// 若未来出现多导入目录并行生产，此 Map 天然按 baseDir 隔离，无需迁移。
const _lastImportedMediaGcByBaseDir = new Map()

/** 惰性老化回收：仅在显式开启（gcEnabled=true，生产接线传入）时按间隔触发；best-effort 失败静默。 */
function maybeRunLazyImportedMediaGc (baseDir, options = {}) {
  if (options.gcEnabled !== true) return
  const gcIntervalMs = options.gcIntervalMs !== undefined && options.gcIntervalMs !== null &&
    Number.isFinite(Number(options.gcIntervalMs)) && Number(options.gcIntervalMs) >= 0
    ? Number(options.gcIntervalMs)
    : DEFAULT_IMPORT_GC_INTERVAL_MS
  const last = _lastImportedMediaGcByBaseDir.get(baseDir) || 0
  if (Date.now() - last < gcIntervalMs) return
  _lastImportedMediaGcByBaseDir.set(baseDir, Date.now())
  gcImportedMedia({ baseDir })
}

function importUserSelectedMedia (candidate, kind, options = {}) {
  const rule = getMediaRule(kind)
  const localPath = toLocalPath(candidate)
  if (!rule || !localPath || !path.isAbsolute(localPath)) throw new Error('媒体导入参数无效')
  const extension = path.extname(localPath).toLowerCase()
  if (!rule.extensions.has(extension)) throw new Error('不支持的媒体格式')

  const baseDir = path.resolve(options.baseDir || IMPORTED_MEDIA_DIR)
  let source
  try {
    const linkStat = fs.lstatSync(localPath)
    if (!linkStat.isFile() || linkStat.isSymbolicLink()) throw new Error('媒体文件类型无效')
    source = fs.realpathSync.native(localPath)
    const stat = fs.statSync(source)
    if (!stat.isFile() || stat.size <= 0 || stat.size > rule.maxBytes) throw new Error('媒体文件超过大小上限')
  } catch (error) {
    if (error && /媒体/.test(error.message)) throw error
    throw new Error('媒体文件不存在或不可读', { cause: error })
  }

  // 惰性老化回收：源文件校验通过后、复制前触发（gcEnabled 生产开启；与启动时回收互补）。
  maybeRunLazyImportedMediaGc(baseDir, options)

  fs.mkdirSync(baseDir, { recursive: true })
  const token = Date.now().toString(36) + '-' + process.pid + '-' + Math.random().toString(36).slice(2, 10)
  const destination = path.join(baseDir, kind + '-' + token + extension)
  if (!isPathWithin(destination, [baseDir])) throw new Error('媒体导入路径无效')
  copyImportedMedia(source, destination)
  const stat = fs.statSync(destination)
  return { path: destination, kind, size: stat.size, originalName: path.basename(source) }
}

function cleanupImportedMediaPaths (params, options = {}) {
  const baseDir = path.resolve(options.baseDir || IMPORTED_MEDIA_DIR)
  const candidates = []
  if (Array.isArray(params?.audio)) candidates.push(...params.audio.map(item => item && (item.path || item.filePath)))
  if (typeof params?.video === 'string') candidates.push(params.video)
  // BGM 为「可复用」导入：前端配置与后续重试/断点续跑仍引用同一路径，skipBgm 时不得删除。
  if (!options.skipBgm && typeof params?.bgmPath === 'string') candidates.push(params.bgmPath)
  let cleaned = 0
  for (const candidate of new Set(candidates.filter(Boolean))) {
    const absolute = path.resolve(candidate)
    if (!isPathWithin(absolute, [baseDir])) continue
    try {
      const stat = fs.lstatSync(absolute)
      if (!stat.isFile() || stat.isSymbolicLink()) continue
      fs.unlinkSync(absolute)
      cleaned++
    } catch { /* 文件已清理或运行期间被移除 */ }
  }
  return cleaned
}

const DEFAULT_IMPORTED_MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * selected-media 老化回收：删除超过 maxAgeMs 的普通文件（跳过符号链接与目录）。
 * BGM 属「可复用」导入不随运行收尾删除，靠此老化回收防止无界增长；
 * 被回收的 BGM 后续运行会经 compose 降级路径（bgmSkippedReason='unreadable'）处理，不会硬失败。
 * @param {object} [options]
 * @param {string} [options.baseDir] - 默认 IMPORTED_MEDIA_DIR
 * @param {number} [options.maxAgeMs] - 默认 7 天
 * @returns {number} 已清理文件数
 */
function gcImportedMedia (options = {}) {
  const baseDir = path.resolve(options.baseDir || IMPORTED_MEDIA_DIR)
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) && Number(options.maxAgeMs) > 0
    ? Number(options.maxAgeMs)
    : DEFAULT_IMPORTED_MEDIA_MAX_AGE_MS
  let entries
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true })
  } catch (_) { return 0 } // 目录不存在等 → 无可回收
  let removed = 0
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const fullPath = path.join(baseDir, entry.name)
    if (!isPathWithin(fullPath, [baseDir])) continue
    try {
      const linkStat = fs.lstatSync(fullPath)
      if (!linkStat.isFile() || linkStat.isSymbolicLink()) continue
      const stat = fs.statSync(fullPath)
      if (now - stat.mtimeMs <= maxAgeMs) continue
      fs.unlinkSync(fullPath)
      removed++
    } catch (_) { /* 单个文件清理失败忽略，不阻塞其余 */ }
  }
  return removed
}

function getRunInputDir (runId, options = {}) {
  const baseDir = path.resolve(options.baseDir || path.join(STORY2VIDEO_TEMP_DIR, 'inputs'))
  return path.join(baseDir, safeRunId(runId))
}

function writeDataImage (source, runId, index, options = {}) {
  const match = typeof source === 'string' && source.match(
    /^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\r\n]+)$/i,
  )
  if (!match) throw new Error('图片必须是受支持的 data URL')
  const encoded = match[2].replace(/[\r\n]/g, '')
  if (encoded.length % 4 !== 0 ||
      !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(encoded)) {
    throw new Error('图片 data URL 的 Base64 内容无效')
  }
  const buffer = Buffer.from(encoded, 'base64')
  const maxBytes = Number.isFinite(Number(options.maxBytes))
    ? Math.min(Number(options.maxBytes), MAX_IMAGE_FILE_BYTES)
    : MAX_IMAGE_FILE_BYTES
  if (buffer.length === 0 || buffer.length > maxBytes) throw new Error('图片超过允许大小')

  const baseDir = path.resolve(options.baseDir || path.join(STORY2VIDEO_TEMP_DIR, 'inputs'))
  const inputDir = getRunInputDir(runId, { baseDir })
  if (!isPathWithin(inputDir, [baseDir])) throw new Error('非法运行目录')
  fs.mkdirSync(inputDir, { recursive: true })

  let total = 0
  for (const entry of fs.readdirSync(inputDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    try { total += fs.statSync(path.join(inputDir, entry.name)).size } catch { /* 并发清理时忽略 */ }
  }
  const maxTotal = Number.isFinite(Number(options.maxTotalBytes))
    ? Number(options.maxTotalBytes)
    : MAX_INPUT_TOTAL_BYTES
  if (total + buffer.length > maxTotal) throw new Error('运行输入媒体超过总大小上限')

  const extension = match[1].toLowerCase().replace('jpeg', 'jpg').split('/')[1]
  const numericIndex = Number.isInteger(Number(index)) && Number(index) >= 0 ? Number(index) : 0
  const output = path.join(inputDir, 'image_' + String(numericIndex).padStart(4, '0') + '.' + extension)
  if (fs.existsSync(output)) {
    const existing = fs.lstatSync(output)
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('运行输入文件类型无效')
    fs.unlinkSync(output)
  }
  fs.writeFileSync(output, buffer, { flag: 'wx' })
  return output
}

function cleanupRunInputDir (runId, options = {}) {
  const baseDir = path.resolve(options.baseDir || path.join(STORY2VIDEO_TEMP_DIR, 'inputs'))
  const inputDir = getRunInputDir(runId, { baseDir })
  if (!isPathWithin(inputDir, [baseDir]) || !fs.existsSync(inputDir)) return false
  try {
    fs.rmSync(inputDir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

module.exports = {
  MAX_INPUT_FILE_BYTES,
  MAX_INPUT_TOTAL_BYTES,
  MAX_IMAGE_FILE_BYTES,
  MAX_AUDIO_FILE_BYTES,
  MAX_BGM_FILE_BYTES,
  STORY2VIDEO_TEMP_DIR,
  IMPORTED_MEDIA_DIR,
  safeRunId,
  getElectronMediaRoots,
  getAllowedMediaRoots,
  isPathWithin,
  resolveReadableFile,
  resolveReadableMediaFile,
  copyImportedMedia,
  importUserSelectedMedia,
  cleanupImportedMediaPaths,
  gcImportedMedia,
  DEFAULT_IMPORTED_MEDIA_MAX_AGE_MS,
  getRunInputDir,
  writeDataImage,
  cleanupRunInputDir,
}
