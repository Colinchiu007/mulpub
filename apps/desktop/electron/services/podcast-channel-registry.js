'use strict'

/**
 * podcast-channel-registry.js — 播客多频道目录、迁移与全局元信息
 *
 * 为什么不是把 channel.json 复制成多份就算多频道（PRD §4/§5）：
 * - channelId 必须**不可变**：托管对象路径含 channelId，改名可以、改 id 等于改掉
 *   已经提交给 Apple/小宇宙的 feed URL，那是对外不可逆承诺；
 * - 因此 `default` 这类"频道名"绝不能当 id 用，迁移出来的频道同样分配合规 ch_ 短 id；
 * - index.json 自己是**跨频道全局态**（hosting + defaultChannelId 的读改写），
 *   按 channelId 加键根本盖不住它，所以 index 用自己的键锁、频道级互斥用发布忙标记；
 * - 迁移落在 ensureMigratedOnce，由首个需要频道数据的调用触发（读或写均可），
 *   注册路径绝不触盘 —— ipc-handlers/podcast.js 的惰性构造约束优先于此。
 */

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const { ITEMS_MAX } = require('@multi-publish/shared-utils/src/podcast-rss')
const { createKeyedLocks, channelBusyGate } = require('./podcast-channel-locks')

const PODCAST_DIR_NAME = 'podcast'
const INDEX_FILE = 'index.json'
const LEGACY_CHANNEL_FILE = 'channel.json'
const LEGACY_EPISODES_FILE = 'episodes.json'
const CHANNELS_DIR = 'channels'
const CHANNEL_ID_RE = /^ch_[a-z0-9]{4,16}$/

// Windows 短暂 delete-share 的有界退避；总自旋上界 = 各档之和，超过即原样抛出（AGENTS.md 原子替换约束）。
// 允许同步自旋是因为临界区本身是同步文件 IO —— 改成 await 会把 index 的读改写拆成跨 tick 的两段。
const REGISTRY_RENAME_RETRY_DELAYS_MS = [0, 20, 60]

/**
 * 落盘层兜底：hosting.pathPrefix / hosting.endpoint 会被刀 2 用来派生 OSS 对象 key 与公网 URL，
 * 所以防跨前缀逃逸的判据必须在**写盘这一站**就把关，不能只待在输入层（评审 i6）。
 * 唯一实现复用 podcast-hosting-upload 的 normalizePathPrefix，禁止在本地再抄一份清洗规则。
 */
const { normalizePathPrefix } = require('./podcast-hosting-upload')

function normalizeObjectPathPrefix (raw) {
  const s = String(raw == null ? '' : raw)
  if (s.trim() === '') return ''
  return normalizePathPrefix(s)
}

function normalizeHostingEndpoint (raw) {
  return String(raw == null ? '' : raw).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

const REGISTRY_ERRORS = {
  CHANNEL_ID_INVALID: 'PODCAST_CHANNEL_ID_INVALID',
  CHANNEL_NOT_FOUND: 'PODCAST_CHANNEL_NOT_FOUND',
  MIGRATION_CONFLICT: 'PODCAST_MIGRATION_CONFLICT',
  MIGRATION_IO_FAILED: 'PODCAST_MIGRATION_IO_FAILED',
  INDEX_BUSY: 'PODCAST_INDEX_BUSY',
  CHANNEL_BUSY: 'PODCAST_CHANNEL_BUSY',
}

function err (code, message, extra) {
  const e = new Error(code + ': ' + message)
  e.code = code
  if (extra) Object.assign(e, extra)
  return e
}

function newChannelId () {
  return 'ch_' + crypto.randomBytes(8).toString('hex')
}

function sha256Of (text) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text), 'utf8').digest('hex')
}

function safeReadJson (fsImpl, file) {
  try {
    if (!fsImpl.existsSync(file)) return null
    const raw = fsImpl.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

/** 读不动≠不存在：迁移期读到半文件会把"已完成"误判成"来源缺失"，这里如实抛出。 */
function readOrThrow (fsImpl, file) {
  if (!fsImpl.existsSync(file)) return null
  const raw = fsImpl.readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

function atomicWriteJson (fsImpl, file, value, retryDelaysMs) {
  const tmp = file + '.tmp.' + process.pid
  let renamed = false
  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true })
    fsImpl.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    const delays = Array.isArray(retryDelaysMs) && retryDelaysMs.length ? retryDelaysMs : [0]
    let attempt = 0
    for (;;) {
      try {
        fsImpl.renameSync(tmp, file)
        renamed = true
        break
      } catch (e) {
        const transient = process.platform === 'win32'
          && ['EPERM', 'EACCES', 'EBUSY'].includes(e && e.code)
        if (!transient || attempt >= delays.length) throw e
        const busyWait = delays[attempt++]
        const until = Date.now() + busyWait
        while (Date.now() < until) { /* 有界退避：Windows 短暂 delete-share */ }
      }
    }
  } finally {
    if (!renamed) {
      try { if (fsImpl.existsSync(tmp)) fsImpl.rmSync(tmp, { force: true }) } catch (_) { /* 不掩盖原错误 */ }
    }
  }
}

class PodcastChannelRegistry {
  /**
   * @param {object} [options]
   * @param {string} [options.podcastRoot] 显式 podcast 根（测试用 os.tmpdir 唯一目录）
   * @param {object} [options.app] Electron app 替身（惰性取 userData）
   * @param {typeof import('fs')} [options.fs]
   * @param {object} [options.logger]
   * @param {number[]} [options.renameRetryDelaysMs]
   * @param {() => string} [options.idFactory] 仅供测试固定 id
   */
  constructor (options = {}) {
    this._fs = options.fs || fs
    this._app = options.app || null
    this._logger = options.logger || null
    this._retry = Array.isArray(options.renameRetryDelaysMs) ? options.renameRetryDelaysMs : REGISTRY_RENAME_RETRY_DELAYS_MS
    this._idFactory = typeof options.idFactory === 'function' ? options.idFactory : newChannelId
    this._rootOverride = typeof options.podcastRoot === 'string' && options.podcastRoot.trim()
      ? options.podcastRoot.trim() : null
    this._rootResolved = null
    const waitTimeoutMs = Number(process.env.MP_PODCAST_LOCK_WAIT_MS) || undefined
    this._indexLocks = createKeyedLocks({ waitTimeoutMs: Number.isFinite(waitTimeoutMs) ? waitTimeoutMs : 250 })
    this._gate = channelBusyGate
    this._migratedOnce = false
  }

  get logger () {
    if (!this._logger) this._logger = { info () {}, warn () {}, error () {} }
    return this._logger
  }

  resolveRoot () {
    if (this._rootResolved) return this._rootResolved
    if (this._rootOverride) {
      this._rootResolved = this._rootOverride
      return this._rootResolved
    }
    let app = this._app
    if (!app) {
      try { app = require('electron').app } catch (_) { app = null }
    }
    if (!app || typeof app.getPath !== 'function') {
      throw err(REGISTRY_ERRORS.MIGRATION_IO_FAILED, '无法解析 userData 根目录（不得静默写相对路径）')
    }
    this._rootResolved = path.join(app.getPath('userData'), PODCAST_DIR_NAME)
    return this._rootResolved
  }

  indexPath () { return path.join(this.resolveRoot(), INDEX_FILE) }
  channelDir (channelId) {
    const id = String(channelId || '').trim()
    if (!CHANNEL_ID_RE.test(id)) throw err(REGISTRY_ERRORS.CHANNEL_ID_INVALID, '频道 id 形态非法：' + id)
    return path.join(this.resolveRoot(), CHANNELS_DIR, id)
  }

  // ---- index.json（全局态：一律在 index 锁内读改写） ----

  _loadIndex () {
    const file = this.indexPath()
    const raw = safeReadJson(this._fs, file)
    if (raw && typeof raw === 'object' && Array.isArray(raw.channels)) return raw
    return { version: 1, defaultChannelId: '', channels: [], hosting: null, migratedAt: '', migrationStatus: '' }
  }

  _saveIndex (index) {
    atomicWriteJson(this._fs, this.indexPath(), index, this._retry)
    return index
  }

  readIndex () { return this._loadIndex() }

  /** 首个需要频道数据的调用触发；恰好一次（内存位 + migratedAt 双保险）。 */
  ensureMigratedOnce () {
    if (this._migratedOnce) return this._loadIndex()
    return this._indexLocks.withKey('index', 'migration', () => {
      const current = this._loadIndex()
      if (current.migratedAt) { this._migratedOnce = true; return current }
      // 冲突/硬失败态必须**可读**：读路径若继续抛错，界面就渲染不出横幅，用户既看不到冲突
      // 也点不到处置按钮，只能反复重启应用排障。写路径的拦截另有 _assertWritable。
      if (current.migrationStatus) return current
      let migrated
      try {
        migrated = this._runMigration(current)
      } catch (e) {
        // 冲突/硬失败在**首次被发现**的那一次调用上就必须返回可读状态：读路径若抛错，界面渲染不出
        // 横幅，用户既看不到冲突也点不到处置按钮，只能反复重启应用排障（写路径另有 assertChannelWritable）。
        const idx = e && e.index
        if (idx && (idx.migrationStatus === 'conflict' || idx.migrationStatus === 'error')) return idx
        throw e
      }
      this._migratedOnce = true
      return migrated
    })
  }

  _runMigration (index) {
    const root = this.resolveRoot()
    const legacyChannel = path.join(root, LEGACY_CHANNEL_FILE)
    const legacyEpisodes = path.join(root, LEGACY_EPISODES_FILE)
    const hasLegacy = this._fs.existsSync(legacyChannel) || this._fs.existsSync(legacyEpisodes)
    if (!hasLegacy) {
      const nowIso = new Date().toISOString()
      return this._saveIndex({ ...index, migratedAt: nowIso })
    }

    const id = this._idFactory()
    const target = path.join(root, CHANNELS_DIR, id)
    const nowIso = new Date().toISOString()
    const entry = {
      id,
      name: '我的播客频道',
      createdAt: nowIso,
      updatedAt: nowIso,
      source: 'legacy-migration',
    }

    try {
      const legacyChannelRaw = this._fs.existsSync(legacyChannel) ? readOrThrow(this._fs, legacyChannel) : null
      const legacyEpisodesRaw = this._fs.existsSync(legacyEpisodes) ? readOrThrow(this._fs, legacyEpisodes) : null

      // 三态判定（PRD §5）：一致=完成；不一致且来源完整=静默续传；两侧各为不同合法内容=conflict
      const stateOf = (targetFile, legacyObj, wrap) => {
        if (!this._fs.existsSync(targetFile)) return { kind: 'missing' }
        const targetParsed = safeReadJson(this._fs, targetFile)
        const targetValid = targetParsed && typeof targetParsed === 'object'
        const srcValid = legacyObj && typeof legacyObj === 'object'
        if (!targetValid) return { kind: 'corrupt' }
        if (!srcValid) return { kind: 'source-missing', keepTarget: true }
        if (sha256Of(JSON.stringify(targetParsed)) === sha256Of(JSON.stringify(wrap(legacyObj)))) {
          return { kind: 'equal' }
        }
        return { kind: 'diverged' }
      }

      const chFile = path.join(target, LEGACY_CHANNEL_FILE)
      const epFile = path.join(target, LEGACY_EPISODES_FILE)
      const wrapChannel = (obj) => ({ version: 1, meta: obj && obj.channel ? obj.channel : obj, feedSync: null })
      const wrapEpisodes = (obj) => ({ version: 1, episodes: obj && Array.isArray(obj.episodes) ? obj.episodes : [] })

      const chState = stateOf(chFile, legacyChannelRaw, wrapChannel)
      const epState = stateOf(epFile, legacyEpisodesRaw, wrapEpisodes)

      if (chState.kind === 'diverged' || epState.kind === 'diverged') {
        const conflicted = this._saveIndex({
          ...index,
          migrationStatus: 'conflict',
          migrationConflicts: [chState.kind === 'diverged' ? LEGACY_CHANNEL_FILE : '', epState.kind === 'diverged' ? LEGACY_EPISODES_FILE : ''].filter(Boolean),
          migrationCandidateChannelId: id,
          channels: index.channels.some((c) => c.id === id) ? index.channels : [...index.channels, entry],
        })
        throw err(REGISTRY_ERRORS.MIGRATION_CONFLICT, '迁移目标已存在且内容不同，需人工处置', {
          issues: [{ code: REGISTRY_ERRORS.MIGRATION_CONFLICT, path: 'migration', message: '目标与 legacy 各为不同合法内容' }],
          index: conflicted,
        })
      }

      this._fs.mkdirSync(target, { recursive: true })
      if (chState.kind !== 'equal' && chState.kind !== 'keepTarget') {
        if (legacyChannelRaw) {
          atomicWriteJson(this._fs, chFile, wrapChannel(legacyChannelRaw), this._retry)
        }
      }
      if (epState.kind !== 'equal' && legacyEpisodesRaw) {
        atomicWriteJson(this._fs, epFile, wrapEpisodes(legacyEpisodesRaw), this._retry)
      }
      // guid 一律原样搬运：补写新形态会让聚合端把每期认成新节目（PRD §4 第 4 条）

      const saved = this._saveIndex({
        ...index,
        migratedAt: nowIso,
        migrationStatus: '',
        defaultChannelId: index.defaultChannelId || id,
        channels: index.channels.some((c) => c.id === id) ? index.channels : [...index.channels, entry],
      })
      this.logger.info('PodcastRegistry', 'legacy migrated (channelId=' + id + ')')
      return saved
    } catch (e) {
      if (e && e.code === REGISTRY_ERRORS.MIGRATION_CONFLICT) throw e
      const failed = this._saveIndex({ ...this._loadIndex(), migrationStatus: 'error', migrationError: (e && e.message) || String(e) })
      this.logger.warn('PodcastRegistry', 'migration failed: ' + ((e && e.message) || String(e)))
      throw err(REGISTRY_ERRORS.MIGRATION_IO_FAILED, '迁移中途失败，可重试；只读通道保留', { index: failed })
    }
  }

  resolveMigration (direction) {
    if (direction !== 'keep_legacy' && direction !== 'keep_existing') {
      throw err('PODCAST_MIGRATION_DIRECTION_INVALID', '处置方向须为 keep_legacy 或 keep_existing')
    }
    return this._indexLocks.withKey('index', 'migration:resolve', () => {
      const index = this._loadIndex()
      if (index.migrationStatus !== 'conflict') return index
      const id = index.migrationCandidateChannelId || (index.channels[0] && index.channels[0].id) || ""
      if (direction === "keep_legacy") {
        // 用 legacy 覆盖目标：目标那份是上一次复制的半成品，用户明确选了"以来源为准"
        const legacyChannel = readOrThrow(this._fs, path.join(this.resolveRoot(), LEGACY_CHANNEL_FILE))
        const legacyEpisodes = readOrThrow(this._fs, path.join(this.resolveRoot(), LEGACY_EPISODES_FILE))
        const target = path.join(this.resolveRoot(), CHANNELS_DIR, id)
        this._fs.mkdirSync(target, { recursive: true })
        if (legacyChannel) atomicWriteJson(this._fs, path.join(target, LEGACY_CHANNEL_FILE),
          { version: 1, meta: legacyChannel.channel || legacyChannel, feedSync: null }, this._retry)
        if (legacyEpisodes) atomicWriteJson(this._fs, path.join(target, LEGACY_EPISODES_FILE),
          { version: 1, episodes: Array.isArray(legacyEpisodes.episodes) ? legacyEpisodes.episodes : [] }, this._retry)
      }
      return this._saveIndex({ ...index,
        migrationStatus: "resolved:" + direction,
        migrationResolvedAt: new Date().toISOString(),
        migratedAt: index.migratedAt || new Date().toISOString(),
      })
    })
  }

  // ---- 频道 CRUD ----

  async listChannels () {
    const index = await this.ensureMigratedOnce()
    const items = index.channels.map((c) => ({
      ...c,
      cap: ITEMS_MAX,
      count: this.countEpisodes(c.id),
    }))
    return {
      channels: items,
      defaultChannelId: index.defaultChannelId || '',
      empty: items.length === 0,
      migrationStatus: index.migrationStatus || '',
      migrationConflicts: index.migrationConflicts || [],
      hostingConfigured: Boolean(index.hosting && index.hosting.endpoint && index.hosting.bucket && index.hosting.credentialRef),
    }
  }

  async createChannel (name) {
    const label = String(name == null ? '' : name).trim()
    if (!label) throw err('PODCAST_CHANNEL_NAME_REQUIRED', '频道名称不能为空')
    // 迁移必须收在锁**外**：本方法随后要持 index 键，ensureMigratedOnce 持的是同一把键，
    // 嵌进去就是自死锁（等自己的临界区，必然超时）。同一键不可重入是这套串行队列的前提。
    await this.ensureMigratedOnce()
    return this._indexLocks.withKey('index', 'channel:create', async () => {
      const index = this._loadIndex()
      this._assertWritable(index)
      const id = this._idFactory()
      if (!CHANNEL_ID_RE.test(id)) throw err(REGISTRY_ERRORS.CHANNEL_ID_INVALID, '生成的 id 不合规：' + id)
      if (index.channels.some((c) => c.id === id)) throw err(REGISTRY_ERRORS.CHANNEL_ID_INVALID, 'id 重复')
      const nowIso = new Date().toISOString()
      const entry = { id, name: label.slice(0, 120), createdAt: nowIso, updatedAt: nowIso }
      this._fs.mkdirSync(path.join(this.resolveRoot(), CHANNELS_DIR, id), { recursive: true })
      const saved = this._saveIndex({
        ...index,
        channels: [...index.channels, entry],
        defaultChannelId: index.defaultChannelId || id,
      })
      this.logger.info('PodcastRegistry', 'channel created (id=' + id + ')')
      return { channel: entry, defaultChannelId: saved.defaultChannelId }
    })
  }

  renameChannel (channelId, name) {
    const id = String(channelId || '').trim()
    const label = String(name == null ? '' : name).trim()
    if (!label) throw err('PODCAST_CHANNEL_NAME_REQUIRED', '频道名称不能为空')
    return this._indexLocks.withKey('index', 'channel:rename', () => {
      const index = this._loadIndex()
      const hit = index.channels.find((c) => c.id === id)
      if (!hit) throw err(REGISTRY_ERRORS.CHANNEL_NOT_FOUND, '频道不存在：' + id)
      const nowIso = new Date().toISOString()
      const channels = index.channels.map((c) => (c.id === id ? { ...c, name: label.slice(0, 120), updatedAt: nowIso } : c))
      this._saveIndex({ ...index, channels })
      return { channel: channels.find((c) => c.id === id) }
    })
  }

  setDefaultChannel (channelId) {
    const id = String(channelId || '').trim()
    return this._indexLocks.withKey('index', 'channel:setDefault', () => {
      const index = this._loadIndex()
      if (!index.channels.some((c) => c.id === id)) throw err(REGISTRY_ERRORS.CHANNEL_NOT_FOUND, '频道不存在：' + id)
      this._saveIndex({ ...index, defaultChannelId: id })
      return { defaultChannelId: id }
    })
  }

  assertChannelExists (channelId) {
    const id = String(channelId || '').trim()
    if (!CHANNEL_ID_RE.test(id)) throw err(REGISTRY_ERRORS.CHANNEL_ID_INVALID, '频道 id 形态非法：' + id)
    const index = this._loadIndex()
    if (!index.channels.some((c) => c.id === id)) throw err(REGISTRY_ERRORS.CHANNEL_NOT_FOUND, '频道不存在：' + id)
    return id
  }

  /** 写路径专用：先确认频道存在，再确认迁移不处于待处置态；读路径不得走这里（评审 i4）。 */
  assertChannelWritable (channelId) {
    const id = this.assertChannelExists(channelId)
    this._assertWritable(this._loadIndex())
    return id
  }

  /** 迁移未完成时写路径 fail-closed：读可以看见冲突，写不可以带着半成品继续。 */
  _assertWritable (index) {
    const status = (index && index.migrationStatus) || ''
    if (status === 'conflict' || status === 'error') {
      throw err(status === "conflict" ? REGISTRY_ERRORS.MIGRATION_CONFLICT : REGISTRY_ERRORS.MIGRATION_IO_FAILED,
        '频道数据迁移未完成，已阻止写入以免覆盖；请先处置迁移冲突')
    }
  }

  // ---- 托管配置（全局一份，PRD D-4） ----

  readHosting () {
    const index = this._loadIndex()
    return index.hosting || null
  }

  writeHosting (patch) {
    if (!patch || typeof patch !== 'object') throw err('PODCAST_HOSTING_REQUIRED', '托管配置必须是对象')
    return this._indexLocks.withKey('index', 'hosting:save', () => {
      const index = this._loadIndex()
      const prev = index.hosting || {}
      const next = {
        provider: patch.provider != null ? String(patch.provider).trim() : prev.provider || 'oss',
        endpoint: normalizeHostingEndpoint(patch.endpoint != null ? patch.endpoint : prev.endpoint),
        bucket: patch.bucket != null ? String(patch.bucket).trim() : prev.bucket || '',
        pathPrefix: normalizeObjectPathPrefix(patch.pathPrefix != null ? patch.pathPrefix : prev.pathPrefix),
        credentialRef: patch.credentialRef != null ? String(patch.credentialRef).trim() : prev.credentialRef || '',
        updatedAt: new Date().toISOString(),
      }
      this._saveIndex({ ...index, hosting: next })
      return next
    })
  }

  // ---- 锁与防重入的对外出口（服务层与编排层共用，禁止第二份） ----

  withIndexLock (section, task) { return this._indexLocks.withKey('index', section, task) }
  tryBeginPublish (channelId, meta) { return this._gate.tryBegin(channelId, meta) }
  endPublish (channelId) { return this._gate.end(channelId) }
  isPublishing (channelId) { return this._gate.isBusy(channelId) }
  /** 持锁凭证（供整链发布内部的再入判定）；无发布在飞时回 null。 */
  publishHolder (channelId) { return this._gate.holder(channelId) }
  publishSnapshot () { return this._gate.snapshot() }

  countEpisodes (channelId) {
    try {
      const file = path.join(this.channelDir(channelId), LEGACY_EPISODES_FILE)
      const raw = safeReadJson(this._fs, file)
      return raw && Array.isArray(raw.episodes) ? raw.episodes.length : 0
    } catch (_) {
      return 0
    }
  }
}

module.exports = PodcastChannelRegistry
module.exports.REGISTRY_ERRORS = REGISTRY_ERRORS
module.exports.CHANNEL_ID_RE = CHANNEL_ID_RE
module.exports.newChannelId = newChannelId
module.exports.sha256Of = sha256Of
module.exports.PODCAST_REGISTRY_FILES = { PODCAST_DIR_NAME, INDEX_FILE, CHANNELS_DIR, LEGACY_CHANNEL_FILE, LEGACY_EPISODES_FILE }
