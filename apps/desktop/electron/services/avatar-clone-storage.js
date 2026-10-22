// @ts-check
/**
 * avatar-clone-storage — 形象克隆的样本落盘与审计日志（纯 fs + 依赖注入）
 *
 * 从 avatar-clone-service 拆出（max-lines 门禁：新代码不得引入超大文件）。
 *
 * 两块职责：
 *   1. 样本落盘：userData/avatar-clone-samples/<ownerHash>/<storageId>/source.<ext>
 *      ——符号链接防护、路径 containment、写入后 lstat 复核大小（与
 *      tts-voice-clone-service 的样本落盘同型，但素材是图片/视频）。
 *   2. 审计日志：userData/audit/avatar-voice-clone.log，append-only。
 *      **独立于 registry**：删 registry 条目不得丢审计（评审 i3 抓到的真错误）。
 */
'use strict'

const path = require('node:path')

const SAMPLE_STORAGE_DIRECTORY = 'avatar-clone-samples'
const AUDIT_LOG_DIRECTORY = 'audit'
const AUDIT_LOG_FILE = 'avatar-voice-clone.log'

function isPathWithin (parentPath, candidatePath) {
  const rel = path.relative(parentPath, candidatePath)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

class AvatarCloneStorage {
  /**
   * @param {object} deps
   * @param {typeof import('node:fs')} [deps.fs]
   * @param {() => string|null} deps.resolveUserDataPath
   * @param {(value: string) => string|null} deps.safeExtension
   * @param {(value: unknown, ownerHash: string) => boolean} deps.isSafeSampleStorage
   * @param {(message: string, detail?: unknown) => void} [deps.warn]
   */
  constructor (deps = {}) {
    this._fs = deps.fs || require('node:fs')
    this._resolveUserDataPath = deps.resolveUserDataPath
    this._safeExtension = deps.safeExtension
    this._isSafeSampleStorage = deps.isSafeSampleStorage
    this._warn = typeof deps.warn === 'function' ? deps.warn : () => {}
  }

  /** 落盘一份素材，返回 { relativeDir, bytes }；失败抛错由调用方转译 */
  async persistSample (owner, descriptor, media) {
    const userDataPath = this._resolveUserDataPath()
    if (!userDataPath) throw new Error('AVATAR_CLONE_STORAGE_UNAVAILABLE')
    const root = path.resolve(userDataPath, SAMPLE_STORAGE_DIRECTORY)
    const ownerDir = path.resolve(root, owner.hash)
    const sampleDir = path.resolve(ownerDir, descriptor.storageId)
    if (!isPathWithin(root, sampleDir)) throw new Error('AVATAR_CLONE_STORAGE_UNAVAILABLE')

    await this._fs.promises.mkdir(sampleDir, { recursive: true, mode: 0o700 })
    const ext = this._safeExtension(media.fileName)
    if (!ext) throw new Error('AVATAR_CLONE_SAMPLE_INVALID')
    const samplePath = path.resolve(sampleDir, `source${ext}`)
    if (!isPathWithin(sampleDir, samplePath)) throw new Error('AVATAR_CLONE_STORAGE_UNAVAILABLE')

    const buffer = Buffer.from(await media.blob.arrayBuffer())
    await this._fs.promises.writeFile(samplePath, buffer, { mode: 0o600 })
    const stat = await this._fs.promises.lstat(samplePath)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== buffer.length) {
      throw new Error('AVATAR_CLONE_STORAGE_UNAVAILABLE')
    }
    return { relativeDir: descriptor.relativeDir, bytes: stat.size }
  }

  /** 清理样本目录；返回是否成功（false 不视为致命，仅记录） */
  async cleanupSampleStorage (owner, sampleStorage) {
    if (sampleStorage === undefined) return true
    if (!this._isSafeSampleStorage(sampleStorage, owner.hash)) return false
    const userDataPath = this._resolveUserDataPath()
    if (!userDataPath) return false
    const samplePath = path.resolve(userDataPath, sampleStorage.relativeDir)
    const root = path.resolve(userDataPath, SAMPLE_STORAGE_DIRECTORY)
    if (!isPathWithin(root, samplePath)) return false
    try {
      await this._fs.promises.rm(samplePath, { recursive: true, force: true })
      return true
    } catch (_) {
      return false
    }
  }

  /**
   * 样本目录三态探测（只读）。
   * - 'ok'：目录存在且至少一个条目
   * - 'missing'：描述非法 / 不存在 / 非目录 / 符号链接 / 空目录
   * - 'unknown'：无描述（历史记录）或 userData 不可解析 —— 不能据此判失效
   */
  async sampleStorageStatus (owner, sampleStorage) {
    if (sampleStorage === undefined) return 'unknown'
    if (!this._isSafeSampleStorage(sampleStorage, owner.hash)) return 'missing'
    const userDataPath = this._resolveUserDataPath()
    if (!userDataPath) return 'unknown'
    const dir = path.resolve(userDataPath, sampleStorage.relativeDir)
    try {
      const stat = await this._fs.promises.lstat(dir)
      if (stat.isSymbolicLink() || !stat.isDirectory()) return 'missing'
      const entries = await this._fs.promises.readdir(dir)
      return entries.length > 0 ? 'ok' : 'missing'
    } catch (_) {
      return 'missing'
    }
  }

  /** append 一行审计事件；返回 seq（失败返回 null，由调用方决定是否阻断） */
  async appendAudit (owner, event, now) {
    const userDataPath = this._resolveUserDataPath()
    if (!userDataPath) return null
    const logPath = path.resolve(userDataPath, AUDIT_LOG_DIRECTORY, AUDIT_LOG_FILE)
    const auditRoot = path.resolve(userDataPath, AUDIT_LOG_DIRECTORY)
    if (!isPathWithin(auditRoot, logPath)) return null
    const seq = now()
    const line = JSON.stringify({ seq, at: now(), owner: owner.hash, ...event }) + '\n'
    try {
      await this._fs.promises.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 })
      await this._fs.promises.appendFile(logPath, line, { mode: 0o600 })
      return seq
    } catch (error) {
      this._warn('AvatarClone', 'audit append failed: ' + String(error && error.message ? error.message : error).slice(0, 200))
      return null
    }
  }
}

module.exports = {
  AvatarCloneStorage,
  SAMPLE_STORAGE_DIRECTORY,
  AUDIT_LOG_DIRECTORY,
  AUDIT_LOG_FILE,
  isPathWithin,
}
