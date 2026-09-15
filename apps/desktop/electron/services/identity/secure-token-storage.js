const fs = require('fs')
const path = require('path')
const { IdentityError } = require('./identity-errors')

const STORAGE_VERSION = 2 // v2: 新增 encrypted 字段，支持 safeStorage 不可用时明文回退
const DEFAULT_RETRY_DELAYS_MS = [25, 50, 100]
const STALE_TEMP_MIN_AGE_MS = 60 * 1000
/** 删除被系统拒绝（权限/占用/安全软件拦截）时可重试的错误码。 */
const TRANSIENT_DELETE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'EMFILE', 'ENFILE'])

/**
 * 「已清空」信封：删除被拒绝时的降级结果。
 *
 * 背景（2026-09-14 实测 P1）：宿主注入的 safe-delete shim 会把 `fs.unlink` 改写为
 * 「移入回收站 + 批量守卫」，长生命周期进程的守卫计数耗尽后删除一律 fail-closed 抛错
 * （错误不带 `.code`）。若清空会话强依赖「删除文件成功」，登录/退出就整体失败。
 * 因此删除失败时降级为**原地覆写**：令牌内容被不可用载荷覆盖，`load()` 直接判定为空会话，
 * 语义等价于「本地登录信息已失效」，且不依赖删除能力。
 */
const CLEARED_ENVELOPE = Object.freeze({
  version: STORAGE_VERSION,
  ciphertext: '',
  encrypted: false,
  cleared: true,
})

function defaultFilePath() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'identity-session.json')
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function isTransientDeleteError(error) {
  return Boolean(error && typeof error === 'object' && TRANSIENT_DELETE_CODES.has(String(error.code || '')))
}

class SecureTokenStorage {
  constructor(options = {}) {
    this._safeStorage = options.safeStorage || require('electron').safeStorage
    this._filePath = options.filePath || (options.read || options.write ? null : defaultFilePath())
    /** 文件系统实现（测试接缝：注入 rename/unlink 失败以验证重试与降级）。 */
    this._fs = options.fs || fs.promises
    this._retryDelaysMs = Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS
    this._read = options.read || (() => fs.promises.readFile(this._filePath, 'utf8').catch((error) => {
      if (error && error.code === 'ENOENT') return null
      throw error
    }))
    this._write = options.write || ((value) => this._writeAtomic(value))
    this._remove = options.remove || (() => this._unlinkWithRetry())
    this._mutation = Promise.resolve()
  }

  _isEncryptionAvailable() {
    return !!(this._safeStorage && typeof this._safeStorage.isEncryptionAvailable === 'function' &&
      this._safeStorage.isEncryptionAvailable())
  }

  _assertAvailable() {
    if (!this._isEncryptionAvailable()) {
      throw new IdentityError('IDENTITY_SECURE_STORAGE_UNAVAILABLE', '操作系统安全存储不可用')
    }
  }

  /**
   * 有界重试：仅对「瞬时」错误（权限/占用）重试，语义错误立即上抛。
   * @param {() => Promise<unknown>} task
   */
  async _withRetry(task) {
    const delays = this._retryDelaysMs
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await task()
      } catch (error) {
        if (attempt >= delays.length || !isTransientDeleteError(error)) throw error
        await sleep(delays[attempt])
      }
    }
  }

  async _unlinkWithRetry() {
    await this._withRetry(async () => {
      try {
        await this._fs.unlink(this._filePath)
      } catch (error) {
        if (error && error.code === 'ENOENT') return
        throw error
      }
    })
  }

  async _writeAtomic(value) {
    await this._fs.mkdir(path.dirname(this._filePath), { recursive: true })
    const tempPath = `${this._filePath}.${process.pid}.tmp`
    await this._fs.writeFile(tempPath, value, { encoding: 'utf8', mode: 0o600 })
    try {
      await this._withRetry(() => this._fs.rename(tempPath, this._filePath))
    } catch (error) {
      // 残留临时文件留给 _sweepStaleTempFiles 回收（删除本身也可能被拒绝）
      try { await this._fs.unlink(tempPath) } catch { /* 尽力而为 */ }
      throw error
    }
  }

  /**
   * 尽力删除文件。
   * @returns {Promise<boolean>} 是否已不存在
   */
  async _tryRemove() {
    try {
      await this._remove()
      return true
    } catch {
      return false
    }
  }

  /**
   * 回收同目录下遗留的 `identity-session.json.<pid>.tmp`。
   * 仅回收超过 STALE_TEMP_MIN_AGE_MS 的文件，避免误删并发写入中的临时文件。
   * @returns {Promise<number>} 回收数量
   */
  async _sweepStaleTempFiles() {
    if (!this._filePath) return 0
    const directory = path.dirname(this._filePath)
    const prefix = `${path.basename(this._filePath)}.`
    let names
    try {
      names = await this._fs.readdir(directory)
    } catch {
      return 0
    }
    let removed = 0
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue
      const target = path.join(directory, name)
      try {
        const stat = await this._fs.stat(target)
        if (Date.now() - stat.mtimeMs < STALE_TEMP_MIN_AGE_MS) continue
        await this._fs.unlink(target)
        removed += 1
      } catch { /* 尽力而为 */ }
    }
    return removed
  }

  /**
   * 覆写为「已清空」信封（删除被拒绝时的降级路径）。
   * @returns {Promise<boolean>} 是否写入成功
   */
  async _writeCleared() {
    if (!this._filePath) return false
    await this._write(JSON.stringify(CLEARED_ENVELOPE))
    return true
  }

  async save(session) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      throw new IdentityError('IDENTITY_SESSION_INVALID', '会话必须是对象')
    }
    const plaintext = JSON.stringify(session)
    const encrypted = this._isEncryptionAvailable()
    const ciphertext = encrypted
      ? Buffer.from(this._safeStorage.encryptString(plaintext)).toString('base64')
      : Buffer.from(plaintext, 'utf8').toString('base64')
    const envelope = JSON.stringify({
      version: STORAGE_VERSION,
      ciphertext,
      encrypted,
    })
    await this._write(envelope)
    await this._sweepStaleTempFiles()
  }

  async getItem(key) {
    await this._mutation
    const session = await this.load()
    return session && Object.prototype.hasOwnProperty.call(session, key) ? session[key] : null
  }

  async setItem(key, value) {
    return this._enqueue(async () => {
      const session = (await this.load()) || {}
      session[key] = String(value)
      await this.save(session)
    })
  }

  async removeItem(key) {
    return this._enqueue(async () => {
      const session = (await this.load()) || {}
      if (!Object.prototype.hasOwnProperty.call(session, key)) return
      delete session[key]
      if (Object.keys(session).length === 0) return this._clearNow()
      await this.save(session)
    })
  }

  _enqueue(work) {
    const run = this._mutation.catch(() => {}).then(work)
    this._mutation = run.catch(() => {})
    return run
  }

  async load() {
    const envelopeText = await this._read()
    if (!envelopeText) return null
    try {
      const envelope = JSON.parse(envelopeText)
      if (envelope && envelope.cleared === true) return null
      if (typeof envelope.ciphertext !== 'string') {
        throw new Error('会话存储格式不受支持')
      }
      const encrypted = envelope.encrypted !== false
      // v1 兼容：无 encrypted 字段视为加密存储
      if (envelope.version === undefined && encrypted) {
        // v1 格式（无 version 字段），需要安全存储解密
        this._assertAvailable()
      }
      if (encrypted) {
        this._assertAvailable()
      }
      const cipherBytes = Buffer.from(envelope.ciphertext, 'base64')
      const plaintext = encrypted
        ? this._safeStorage.decryptString(cipherBytes)
        : cipherBytes.toString('utf8')
      const session = JSON.parse(plaintext)
      if (!session || typeof session !== 'object' || Array.isArray(session)) {
        throw new Error('会话内容无效')
      }
      return session
    } catch (error) {
      // 安全存储暂时不可用（OS keyring 锁定等）→ 保留密文，下次重试；其余损坏才清理
      if (error && error.code === 'IDENTITY_SECURE_STORAGE_UNAVAILABLE') {
        throw error
      }
      await this._bestEffortClear()
      return null
    }
  }

  async clear() {
    return this._enqueue(() => this._clearNow())
  }

  /**
   * 清空本地会话：优先删除文件；删除被拒绝时降级为覆写「已清空」信封。
   * 两条路径都失败才抛 IDENTITY_SESSION_CLEAR_FAILED（保留原始 cause 便于诊断）。
   */
  async _clearNow() {
    if (await this._tryRemove()) {
      await this._sweepStaleTempFiles()
      return
    }
    try {
      await this._writeCleared()
    } catch (error) {
      throw new IdentityError('IDENTITY_SESSION_CLEAR_FAILED', '本地登录信息无法删除也无法清空', error)
    }
    await this._sweepStaleTempFiles()
  }

  /** 尽力清空（用于损坏数据的兜底清理，失败不阻塞调用方）。 */
  async _bestEffortClear() {
    try {
      await this._clearNow()
    } catch { /* 尽力而为 */ }
  }
}

SecureTokenStorage.CLEARED_ENVELOPE = CLEARED_ENVELOPE

module.exports = SecureTokenStorage
