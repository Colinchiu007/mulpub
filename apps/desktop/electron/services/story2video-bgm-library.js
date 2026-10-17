// @ts-check
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  getAllowedMediaRoots,
  getMediaRule,
  importUserSelectedMedia,
  isPathWithin,
  resolveReadableMediaFile,
  toLocalPath,
} = require('./story2video-paths')

const LIBRARY_INDEX_VERSION = 1
const MAX_DISPLAY_NAME_LENGTH = 60
const MAX_PATH_LENGTH = 4096
const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const MAX_WRITE_ATTEMPTS = 3
const RETRY_DELAY_MS = 150
const INDEX_FILE_NAME = 'library.json'

function getUserDataDir () {
  try {
    const electron = require('electron')
    const app = electron && electron.app
    if (app && typeof app.getPath === 'function') {
      const userData = app.getPath('userData')
      if (userData) return userData
    }
  } catch (_) { /* 纯 Node 测试或非 Electron 调用 */ }
  return null
}

function defaultLibraryDir () {
  const userData = getUserDataDir()
  return userData ? path.join(userData, 'story2video-bgm') : null
}

function isSafeFileName (value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    path.basename(value) === value && !value.includes('..') &&
    !value.includes('/') && !value.includes('\\')
}

function isSafeLibraryId (value) {
  // randomUUID（36 位含连字符）或测试注入的 8..64 位 [A-Za-z0-9-]
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value)
}

function normalizeDisplayName (value) {
  const trimmed = String(value == null ? '' : value).trim()
  if (trimmed.length === 0 || Array.from(trimmed).length > MAX_DISPLAY_NAME_LENGTH) return ''
  return trimmed
}

/** Windows 占用类错误有界重试（沿用 copyImportedMedia 语义）；其余错误原样抛出。 */
function renameWithRetry (source, destination) {
  let lastError = null
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(source, destination)
      return
    } catch (error) {
      lastError = error
      if (!error || !RETRYABLE_CODES.has(error.code) || attempt === MAX_WRITE_ATTEMPTS - 1) break
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS * (attempt + 1))
    }
  }
  if (lastError && RETRYABLE_CODES.has(lastError.code)) {
    throw new Error('背景音乐库写入失败，文件被占用，请稍后重试')
  }
  throw lastError instanceof Error ? lastError : new Error('背景音乐库写入失败')
}

function unlinkWithRetry (filePath) {
  let lastError = null
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      fs.unlinkSync(filePath)
      return
    } catch (error) {
      if (!error || error.code === 'ENOENT') return
      lastError = error
      if (!RETRYABLE_CODES.has(error.code) || attempt === MAX_WRITE_ATTEMPTS - 1) break
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS * (attempt + 1))
    }
  }
  if (lastError && RETRYABLE_CODES.has(lastError.code)) {
    throw new Error('背景音乐文件被占用，请关闭占用程序后重试')
  }
  throw lastError instanceof Error ? lastError : new Error('背景音乐文件删除失败')
}

/**
 * 全能创作 BGM 素材库（持久化，设备级）。
 * 目录：userData/story2video-bgm/，索引 library.json（原子写入）。
 * 展示名与磁盘文件名解耦：重命名只改索引；磁盘文件为 bgm-<token><ext>。
 */
class Story2VideoBgmLibrary {
  constructor (options = {}) {
    const dir = options.libraryDir || defaultLibraryDir()
    if (!dir) throw new Error('BGM 素材库目录不可用')
    this.libraryDir = path.resolve(dir)
    this.indexPath = path.join(this.libraryDir, INDEX_FILE_NAME)
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => crypto.randomUUID()
    // 允许媒体根：生产取 getAllowedMediaRoots()（临时受控目录 + 素材库 + 项目目录）；
    // 纯 Node 测试无 electron.app，允许显式注入等价根，避免测试依赖机器上不存在的 userData。
    this.allowedRoots = Array.isArray(options.allowedRoots) && options.allowedRoots.length > 0
      ? options.allowedRoots.map(root => path.resolve(root))
      : getAllowedMediaRoots()
  }

  _readIndex () {
    let raw
    try {
      raw = fs.readFileSync(this.indexPath, 'utf8')
    } catch (_) {
      return { version: LIBRARY_INDEX_VERSION, items: [] } // 缺失/不可读 → 空库
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
        return { version: LIBRARY_INDEX_VERSION, items: [] }
      }
      const items = parsed.items
        .filter(item => item && typeof item === 'object' &&
          isSafeLibraryId(item.id) && typeof item.name === 'string' &&
          isSafeFileName(item.fileName))
        .map(item => ({
          id: item.id,
          name: item.name,
          fileName: item.fileName,
          size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
          createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : 0,
          updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : 0,
        }))
      return { version: LIBRARY_INDEX_VERSION, items }
    } catch (_) {
      return { version: LIBRARY_INDEX_VERSION, items: [] } // 损坏索引 → 空库降级
    }
  }

  _writeIndex (index) {
    fs.mkdirSync(this.libraryDir, { recursive: true })
    const serialized = JSON.stringify(index, null, 2)
    const tempPath = path.join(this.libraryDir, '.' + INDEX_FILE_NAME + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp')
    fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', flag: 'wx' })
    try {
      renameWithRetry(tempPath, this.indexPath)
    } catch (error) {
      try { fs.unlinkSync(tempPath) } catch (_) { /* 临时文件清理失败忽略 */ }
      throw error
    }
  }

  _toPublicItem (entry) {
    return {
      id: entry.id,
      name: entry.name,
      path: path.join(this.libraryDir, entry.fileName),
      size: entry.size,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }

  _entryFileMissing (entry) {
    const filePath = path.join(this.libraryDir, entry.fileName)
    try {
      const stat = fs.statSync(filePath)
      return !stat.isFile()
    } catch (_) {
      return true
    }
  }

  /** 列出库内条目（path 为受控目录内 canonical 路径）；自愈：文件已缺失的条目懒清理。 */
  list () {
    const index = this._readIndex()
    const kept = []
    for (const entry of index.items) {
      if (this._entryFileMissing(entry)) continue
      kept.push(entry)
    }
    if (kept.length !== index.items.length) {
      const cleaned = { ...index, items: kept }
      try { this._writeIndex(cleaned) } catch (_) { /* 自愈写失败不阻塞读取 */ }
    }
    return kept.map(entry => this._toPublicItem(entry))
  }

  /**
   * 在库索引中查找某个 canonical 路径对应的条目（只读索引，不触发自愈写）。
   * 磁盘文件名 bgm-<token><ext> 唯一，故按 basename（Windows 忽略大小写）匹配即可，
   * 且比对前先用 isPathWithin 确认该文件确实位于库目录内，避免同名文件误命中。
   */
  _findLibraryEntryForPath (canonicalPath) {
    if (!isPathWithin(canonicalPath, [this.libraryDir])) return null
    const basename = path.basename(canonicalPath).toLowerCase()
    const index = this._readIndex()
    return index.items.find(entry => String(entry.fileName).toLowerCase() === basename) || null
  }

  /**
   * 只读核验一个 BGM 路径（历史引用 / 素材库条目 / 用户新选路径）。
   * 判定顺序与 compose 的 resolveReadableMediaFile 同源，避免“界面说可用、合成却跳过”的双源真相：
   *   入参 → 扩展名（触盘前拒绝，防任意路径探测）→ lstat → 类型/大小 → 允许根 → canonical 可读。
   * @param {unknown} candidate
   * @returns {{path: string, exists: boolean, readable: boolean, size: number, extension: string,
   *   inLibrary: boolean, libraryItemId: string|null, reason: string}}
   */
  inspectPath (candidate) {
    const requested = typeof candidate === 'string' ? candidate.trim() : ''
    const result = {
      path: requested,
      exists: false,
      readable: false,
      size: 0,
      extension: '',
      inLibrary: false,
      libraryItemId: null,
      reason: 'invalid_argument',
    }
    if (!requested || requested.length > MAX_PATH_LENGTH) return result
    const localPath = toLocalPath(requested)
    if (!localPath || !path.isAbsolute(localPath)) return result
    const extension = path.extname(localPath).toLowerCase()
    result.extension = extension
    const rule = getMediaRule('bgm')
    if (!rule || !rule.extensions.has(extension)) return { ...result, reason: 'format_unsupported' }

    let linkStat
    try {
      linkStat = fs.lstatSync(localPath)
    } catch (error) {
      return { ...result, reason: error && error.code === 'ENOENT' ? 'missing' : 'unreadable' }
    }
    result.exists = true
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) return { ...result, reason: 'not_a_file' }
    result.size = linkStat.size
    if (linkStat.size <= 0) return { ...result, reason: 'unreadable' }
    if (linkStat.size > rule.maxBytes) return { ...result, reason: 'size_exceeded' }
    if (!isPathWithin(localPath, this.allowedRoots)) return { ...result, reason: 'not_allowed' }
    const canonicalReadablePath = resolveReadableMediaFile(localPath, { kind: 'bgm', allowedRoots: this.allowedRoots })
    if (!canonicalReadablePath) return { ...result, reason: 'unreadable' }
    const entry = this._findLibraryEntryForPath(canonicalReadablePath)
    return {
      ...result,
      readable: true,
      inLibrary: Boolean(entry),
      libraryItemId: entry ? entry.id : null,
      reason: 'ok',
    }
  }

  /**
   * 添加：校验扩展名/大小/符号链接后复制入库（复用 importUserSelectedMedia 语义），
   * 展示名默认取源文件主文件名（去扩展名）。
   * @param {string} candidate - 用户选择的源文件绝对路径
   * @param {object} [options]
   * @param {string} [options.name] - 自定义展示名（1..60 字符）
   */
  add (candidate, options = {}) {
    const imported = importUserSelectedMedia(candidate, 'bgm', { baseDir: this.libraryDir })
    const entry = {
      id: this.idFactory(),
      name: normalizeDisplayName(options.name) ||
        path.basename(String(imported.originalName || ''), path.extname(String(imported.originalName || ''))) || '未命名音乐',
      fileName: path.basename(imported.path),
      size: imported.size,
      createdAt: this.now(),
      updatedAt: this.now(),
    }
    const index = this._readIndex()
    index.items.push(entry)
    this._writeIndex(index)
    return this._toPublicItem(entry)
  }

  /** 重命名展示名（仅索引，磁盘文件与引用路径不变）。 */
  rename (id, name) {
    if (!isSafeLibraryId(id)) throw new Error('背景音乐条目无效')
    const normalized = normalizeDisplayName(name)
    if (!normalized) throw new Error('背景音乐名称需为 1-60 个字符')
    const index = this._readIndex()
    const entry = index.items.find(item => item.id === id)
    if (!entry) throw new Error('背景音乐不存在或已被删除')
    entry.name = normalized
    entry.updatedAt = this.now()
    this._writeIndex(index)
    return this._toPublicItem(entry)
  }

  /** 删除：先删文件（占用类错误有界重试；缺失视为已删除），再原子更新索引。 */
  delete (id) {
    if (!isSafeLibraryId(id)) throw new Error('背景音乐条目无效')
    const index = this._readIndex()
    const entry = index.items.find(item => item.id === id)
    if (!entry) throw new Error('背景音乐不存在或已被删除')
    const filePath = path.join(this.libraryDir, entry.fileName)
    if (fs.existsSync(filePath)) {
      const linkStat = fs.lstatSync(filePath)
      if (linkStat.isSymbolicLink()) throw new Error('背景音乐文件类型无效')
      unlinkWithRetry(filePath)
    }
    index.items = index.items.filter(item => item.id !== id)
    this._writeIndex(index)
    return { deleted: true, id }
  }
}

function getStory2VideoBgmLibrary (options = {}) {
  return new Story2VideoBgmLibrary(options)
}

module.exports = {
  LIBRARY_INDEX_VERSION,
  MAX_DISPLAY_NAME_LENGTH,
  Story2VideoBgmLibrary,
  getStory2VideoBgmLibrary,
  normalizeDisplayName,
  isSafeLibraryId,
  isSafeFileName,
}