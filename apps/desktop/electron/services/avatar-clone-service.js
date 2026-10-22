// @ts-check
/**
 * avatar-clone-service — 数字人形象克隆（HeyGen）
 *
 * 存在理由（openspec/changes/avatar-voice-clone）：
 * 用户要「上传真人照片/视频 → 克隆出长期保存、可反复使用的新角色形象」。
 * 形象克隆与声音克隆在 HeyGen 侧是两条独立链路（端点/轮询/配额/失败语义全不同），
 * 故本 service 只负责形象，声音复用 tts-voice-clone-service。
 *
 * 从 tts-voice-clone-service **范式派生**而非直接复制，分歧点：
 *   1. 素材是图片/视频（扩展名、容器、大小限制不同）；
 *   2. 远端有「训练中」长态，需要轮询（TTS 克隆提交即完成）；
 *   3. 审计日志 append-only 独立落盘（评审 i3：删 registry 不得丢审计）。
 *
 * ⚠ 端点字段未经真实响应核对（本机 DNS 解析不到 developers.heygen.com）。
 * 三个形象方法（createAvatar/getAvatarStatus/deleteAvatar）**未登记** KNOWN_METHODS，
 * 因此 callAdapter 的 supports() 闸门会拦下它们 ⇒ 本轮形象创建路径是
 * **预期内的 fail-closed**（返回 AVATAR_CLONE_PROVIDER_UNAVAILABLE，不产生半截状态）。
 * 首跑核对字段后登记 KNOWN_METHODS 才真正打通；声音克隆不受影响
 * （cloneVoice/deleteVoice 已在 TTS mixin 登记）。
 */
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { AvatarCloneStorage } = require('./avatar-clone-storage')
const { AvatarCloneRemote } = require('./avatar-clone-remote')
const { AvatarCloneSelectionStore } = require('./avatar-clone-selection')

const {
  CAPABILITY_TYPES,
  AVATAR_IMAGE_EXTENSIONS,
  AVATAR_VIDEO_EXTENSIONS,
  AVATAR_MEDIA_EXTENSIONS,
  AVATAR_CLONE_INVALID_REASONS,
  DELETE_STATES,
  TRAINING_STATES,
  SOURCE_PRIORITY,
  safeIdentifier,
  safeDisplayName,
  normalizeSourceKind,
  isSafeSampleStorage,
  isSafeAvatarClone,
  isSafeAvatarCloneRegistry,
  buildPublicCloneEntries,
  normalizeCreateRequest,
  normalizeIdRequest,
  normalizeRenameRequest,
  normalizeTrainingState,
} = require('./avatar-clone-registry')

const AVATAR_CLONE_PROVIDER = 'heygen'
const AVATAR_CLONE_REGISTRY_VERSION = 1
const SAMPLE_STORAGE_DIRECTORY = 'avatar-clone-samples'
const AUDIT_LOG_DIRECTORY = 'audit'
const AUDIT_LOG_FILE = 'avatar-voice-clone.log'

// 素材上限（保守值；官方限制待首跑核对后收紧）
const MAX_SAMPLE_BYTES = 100 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

// 训练轮询（提案 Q11）
const POLL_INTERVAL_MS = 10 * 1000
const POLL_BACKOFF_MS = 30 * 1000
const POLL_TIMEOUT_MS = 15 * 60 * 1000
// 远端删除重试封顶（提案 Q11）
const DELETE_RETRY_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DELETE_MAX_RETRIES = 5

function success (data) { return { code: 0, data } }
function failure (message, data) { return data === undefined ? { code: -1, message } : { code: -1, message, data } }

function hasControlCharacter (value) {
  return Array.from(String(value)).some((ch) => { const c = ch.charCodeAt(0); return c <= 0x1f || c === 0x7f })
}

function isPathWithin (parentPath, candidatePath) {
  const rel = path.relative(parentPath, candidatePath)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

class AvatarCloneError extends Error {
  constructor (code) { super(code); this.code = code }
}

/**
 * 构造一条克隆 registry 记录（纯函数）。
 *
 * 字段形状必须与 avatar-clone-registry.isSafeAvatarClone 的允许集逐一对应：
 * 加字段不同时改两边，写入会被 _writeRegistry 拒（fail-closed）。
 */
function buildCloneRecord ({ avatarId, request, auditSeq, sampleStorage, now }) {
  return {
    id: avatarId,
    name: request.name,
    source: CAPABILITY_TYPES.USER_CLONE,
    sourceKind: request.sourceKind,
    // attestation 是审计链一环（评审 i3）：acknowledgedAt 必填，reason 选填
    attestation: { acknowledgedAt: now },
    auditSeq,
    createdAt: now,
    deletionState: DELETE_STATES.ACTIVE,
    trainingState: TRAINING_STATES.TRAINING,
    mediaType: request.mediaType,
    sampleStorage: { relativeDir: sampleStorage.relativeDir, sampleCount: 1, mediaType: request.mediaType },
  }
}

class AvatarCloneService {
  constructor (deps = {}) {
    this._store = deps.store || null
    this._modelProviderManager = deps.modelProviderManager || null
    this._fs = deps.fs || fs
    this._app = deps.app || null
    this._userDataPath = typeof deps.userDataPath === 'string' ? deps.userDataPath : null
    this._getUserDataPath = typeof deps.getUserDataPath === 'function' ? deps.getUserDataPath : null
    this._createStorageId = typeof deps.createStorageId === 'function' ? deps.createStorageId : crypto.randomUUID
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now()
    this._setTimeout = typeof deps.setTimeout === 'function' ? deps.setTimeout : setTimeout
    this._clearTimeout = typeof deps.clearTimeout === 'function' ? deps.clearTimeout : clearTimeout
    this._registryLocks = new Map()
    this._selections = new AvatarCloneSelectionStore({
      fs: this._fs,
      createToken: typeof deps.createSelectionToken === 'function' ? deps.createSelectionToken : crypto.randomUUID,
      now: this._now,
      setTimeout: this._setTimeout,
      clearTimeout: this._clearTimeout,
      ttlMs: deps.selectionTtlMs,
    })
    this._remote = new AvatarCloneRemote({
      modelProviderManager: this._modelProviderManager,
      appendAudit: (owner, event) => this._appendAudit(owner, event),
      persistSample: (owner, descriptor, media) => this._persistSample(owner, descriptor, media),
      cleanupSampleStorage: (owner, sampleStorage) => this._cleanupSampleStorage(owner, sampleStorage),
      writeRegistry: (owner, registry) => this._writeRegistry(owner, registry),
      readRegistry: (owner) => this._readRegistry(owner),
      newCloneRecord: ({ avatarId, request, auditSeq, sampleStorage }) =>
        buildCloneRecord({ avatarId, request, auditSeq, sampleStorage, now: this._now() }),
      toPublic: (clone) => this._toPublic(clone),
      failure: (message, data) => failure(message, data),
      success: (data) => success(data),
      warn: (scope, message) => this._log.warn(scope, message),
    })
    this._storage = new AvatarCloneStorage({
      fs: this._fs,
      resolveUserDataPath: () => this._resolveUserDataPath(),
      safeExtension: (fileName) => this._safeExtension(fileName),
      isSafeSampleStorage: (value, ownerHash) => isSafeSampleStorage(value, ownerHash),
      warn: (scope, message) => this._log.warn(scope, message),
    })
    this._log = deps.log && typeof deps.log.warn === 'function' ? deps.log : require('./logger')
  }

  // ── 公共 API ──────────────────────────────────────────────────────────

  /** 列出本账号的克隆形象（含失效标记） */
  async listClones (input) {
    const guard = this._guard(this._normalizeRequest, input)
    if (!guard.ok) return guard.response
    const { owner } = guard

    const registryResult = this._readRegistry(owner)
    if (registryResult.error) return registryResult.error

    const avatars = buildPublicCloneEntries({
      avatars: registryResult.registry.avatars,
      invalidReasonOf: (avatar) => (this._isDeletePendingExpired(avatar) ? AVATAR_CLONE_INVALID_REASONS.SAMPLE_STORAGE_MISSING : null),
      sampleStorageStatusOf: (sampleStorage) => this._sampleStorageStatus(owner, sampleStorage),
      toPublic: (avatar) => this._toPublic(avatar),
    })
    return success({ providerId: AVATAR_CLONE_PROVIDER, avatars })
  }

  /**
   * 创建克隆形象。
   *
   * 素材由主进程转成 Blob 后传入（renderer 字节/base64/路径一律拒绝，
   * 与 elevenlabs/minimax-tts/heygen.cloneVoice 同一条边界）。
   *
   * @param {object} input
   * @param {string} input.name
   * @param {'photo'|'digital_twin'} input.type
   * @param {{blob: Blob, fileName: string, contentType: string}} input.media
   * @param {'self'|'third_party_authorized'} [input.sourceKind]
   */
  async createClone (input) {
    const guard = this._guard((value) => normalizeCreateRequest(value, (fileName) => this._safeExtension(fileName)), input)
    if (!guard.ok) return guard.response
    return this._withRegistryLock(guard.owner, () => this._createCloneLocked(guard.request, guard.owner))
  }

  /**
   * 第一步：把用户在对话框选的绝对路径读成内存素材，发一个短期 selectionId。
   * 实际读文件/TTL/过期清理在 avatar-clone-selection。
   */
  async createSampleSelection (input, paths, senderKey) {
    const type = input && (input.type === 'photo' || input.type === 'digital_twin') ? input.type : null
    if (!type) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    if (typeof senderKey !== 'string' || !senderKey) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    if (!Array.isArray(paths) || paths.length !== 1) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    const created = await this._selections.create(type, paths[0])
    if (!created.ok) return failure(created.message)
    if (!this._selections.bindSender(created.data.selectionId, senderKey)) {
      return failure('AVATAR_CLONE_SELECTION_UNAVAILABLE')
    }
    return success(created.data)
  }

  /**
   * 第二步：按 selectionId 创建克隆形象。
   * selection 与 senderKey / type 必须与第一步一致，否则拒绝（防跨窗口冒用）。
   */
  async addCloneFromSelection (input, senderKey) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    if (typeof senderKey !== 'string' || !senderKey) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    const selectionId = typeof input.selectionId === 'string' ? input.selectionId : ''
    const type = input.type === 'photo' || input.type === 'digital_twin' ? input.type : null
    if (!type) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    const name = safeDisplayName(input.name)
    if (!name) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    const sourceKind = normalizeSourceKind(input.sourceKind) || 'self'

    const taken = this._selections.take(selectionId, senderKey, type)
    if (!taken.ok) return failure(taken.message)

    return this.createClone({ name, type, media: taken.media, sourceKind })
  }

  /** 删除克隆形象：先远端后本地；远端失败标 pending 并保留样本 */
  async deleteClone (input) {
    const guard = this._guard(normalizeIdRequest, input)
    if (!guard.ok) return guard.response
    return this._withRegistryLock(guard.owner, () => this._deleteCloneLocked(guard.request, guard.owner))
  }

  /** 重命名（只改本地 registry，远端身份不变） */
  async renameClone (input) {
    const guard = this._guard(normalizeRenameRequest, input)
    if (!guard.ok) return guard.response
    return this._withRegistryLock(guard.owner, () => this._renameCloneLocked(guard.request, guard.owner))
  }

  /** 刷新训练状态（轮询一次；由 UI 定时调用） */
  async refreshTrainingState (input) {
    const guard = this._guard(normalizeIdRequest, input)
    if (!guard.ok) return guard.response
    return this._withRegistryLock(guard.owner, () => this._refreshTrainingStateLocked(guard.request, guard.owner))
  }

  // ── 内部实现 ─────────────────────────────────────────────────────────

  async _createCloneLocked (request, owner) {
    if (!this._remote.hasAdapter()) return failure('AVATAR_CLONE_PROVIDER_UNAVAILABLE')

    const sampleStorage = this._createSampleStorageDescriptor(owner)
    if (!sampleStorage || !this._resolveUserDataPath()) return failure('AVATAR_CLONE_STORAGE_UNAVAILABLE')

    // 创建编排（审计/远端/落样本/写 registry 与全部补偿路径）在 avatar-clone-remote
    const outcome = await this._remote.orchestrateCreate(request, owner, sampleStorage)
    return outcome.response
  }

  /**
   * 删除编排在 avatar-clone-remote（与创建编排同属副作用编排）。
   * 这里只保留 registry 读取与「远端结果 → 本地三态」的落点。
   */
  async _deleteCloneLocked (request, owner) {
    return this._remote.orchestrateDelete(request, owner)
  }

  async _renameCloneLocked (request, owner) {
    const registryResult = this._readRegistry(owner)
    if (registryResult.error) return registryResult.error
    const clone = registryResult.registry.avatars.find((a) => a.id === request.avatarId)
    if (!clone) return failure('AVATAR_CLONE_NOT_FOUND')
    if (clone.deletionState !== DELETE_STATES.ACTIVE) return failure('AVATAR_CLONE_NOT_ACTIVE')

    const nextRegistry = {
      ...registryResult.registry,
      avatars: registryResult.registry.avatars.map((a) => (a.id === request.avatarId ? { ...a, name: request.name } : a)),
    }
    if (!this._writeRegistry(owner, nextRegistry)) return failure('AVATAR_CLONE_STORE_UNAVAILABLE')
    await this._appendAudit(owner, { event: 'renamed', avatarId: clone.id, name: request.name })
    return success({ avatar: this._toPublic({ ...clone, name: request.name }) })
  }

  async _refreshTrainingStateLocked (request, owner) {
    const registryResult = this._readRegistry(owner)
    if (registryResult.error) return registryResult.error
    const clone = registryResult.registry.avatars.find((a) => a.id === request.avatarId)
    if (!clone) return failure('AVATAR_CLONE_NOT_FOUND')
    if (clone.trainingState !== TRAINING_STATES.TRAINING) {
      return success({ avatar: this._toPublic(clone) })
    }

    if (!this._remote.hasAdapter()) return failure('AVATAR_CLONE_PROVIDER_UNAVAILABLE')

    const statusResult = await this._remote.callAvatarMethod('getAvatarStatus', { avatarId: clone.id })
    if (!statusResult.ok) {
      // 轮询失败不改变本地状态（下次再试），只回报
      return failure('AVATAR_CLONE_PROVIDER_UNAVAILABLE', { detail: statusResult.detail })
    }
    // 远端状态 → 本地三态（纯映射在 avatar-clone-registry）
    const trainingState = normalizeTrainingState(statusResult.data && statusResult.data.status)
    if (trainingState === clone.trainingState) return success({ avatar: this._toPublic(clone) })

    const nextRegistry = {
      ...registryResult.registry,
      avatars: registryResult.registry.avatars.map((a) => (a.id === clone.id ? { ...a, trainingState } : a)),
    }
    if (!this._writeRegistry(owner, nextRegistry)) return failure('AVATAR_CLONE_STORE_UNAVAILABLE')
    await this._appendAudit(owner, { event: trainingState === TRAINING_STATES.COMPLETED ? 'training_completed' : 'training_failed', avatarId: clone.id })
    return success({ avatar: this._toPublic({ ...clone, trainingState }) })
  }

  // ── registry ────────────────────────────────────────────────────────

  _registryKey (owner) {
    return `avatar-clones:v${AVATAR_CLONE_REGISTRY_VERSION}:${owner.hash}`
  }

  _readRegistry (owner) {
    const key = this._registryKey(owner)
    let value
    try {
      value = this._store.getUserSetting(key, null, owner.subject)
    } catch (error) {
      return { error: failure('AVATAR_CLONE_STORE_UNAVAILABLE', { detail: this._errorDetail(error) }) }
    }
    if (value === null || value === undefined) {
      return { registry: { version: AVATAR_CLONE_REGISTRY_VERSION, ownerHash: owner.hash, avatars: [] } }
    }
    if (!isSafeAvatarCloneRegistry(value, owner.hash)) {
      // 形状不符 ⇒ 不猜测、不合并，整体视为空并告警（与 TTS 克隆同型）
      this._log.warn('AvatarClone', 'registry shape invalid; treating as empty: ' + key)
      return { registry: { version: AVATAR_CLONE_REGISTRY_VERSION, ownerHash: owner.hash, avatars: [] } }
    }
    return { registry: value }
  }

  _writeRegistry (owner, registry) {
    if (!isSafeAvatarCloneRegistry(registry, owner.hash)) {
      this._log.warn('AvatarClone', 'refusing to write invalid registry')
      return false
    }
    try {
      this._store.setUserSetting(this._registryKey(owner), registry, owner.subject)
      return true
    } catch (error) {
      this._log.warn('AvatarClone', 'registry write failed: ' + this._errorDetail(error))
      return false
    }
  }

  async _withRegistryLock (owner, work) {
    const key = this._registryKey(owner)
    const previous = this._registryLocks.get(key) || Promise.resolve()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    this._registryLocks.set(key, previous.then(() => gate))
    await previous.catch(() => {})
    try {
      return await work()
    } finally {
      release()
      if (this._registryLocks.get(key) === previous.then(() => gate)) {
        this._registryLocks.delete(key)
      }
    }
  }

  // ── owner / store ───────────────────────────────────────────────────

  _captureOwner () {
    if (!this._store || typeof this._store.getOwnerSubject !== 'function') return null
    let subject
    try { subject = this._store.getOwnerSubject() } catch (_) { return null }
    if (typeof subject !== 'string' || !subject) return null
    return { subject, hash: crypto.createHash('sha256').update(subject).digest('hex').slice(0, 32) }
  }

  _hasUserSettings () {
    return Boolean(this._store) && typeof this._store.getUserSetting === 'function' && typeof this._store.setUserSetting === 'function'
  }

  // ── 样本落盘 / 审计日志（委托 avatar-clone-storage，见该文件头注）─────

  _createSampleStorageDescriptor (owner) {
    const storageId = safeIdentifier(this._createStorageId(), 128)
    if (!storageId) return null
    return {
      storageId,
      relativeDir: `${SAMPLE_STORAGE_DIRECTORY}/${owner.hash}/${storageId}`,
    }
  }

  async _persistSample (owner, descriptor, media) {
    return this._storage.persistSample(owner, descriptor, media)
  }

  async _cleanupSampleStorage (owner, sampleStorage) {
    return this._storage.cleanupSampleStorage(owner, sampleStorage)
  }

  async _sampleStorageStatus (owner, sampleStorage) {
    return this._storage.sampleStorageStatus(owner, sampleStorage)
  }

  async _appendAudit (owner, event) {
    return this._storage.appendAudit(owner, event, this._now)
  }


  // ── 远端（编排在 avatar-clone-remote）───────────────────────────────

  _isDeletePendingExpired (avatar) {
    if (avatar.deletionState !== DELETE_STATES.PENDING) return false
    return this._now() - avatar.createdAt > DELETE_RETRY_TTL_MS
  }

  // ── 工具 ────────────────────────────────────────────────────────────

  _resolveUserDataPath () {
    let userDataPath = this._userDataPath
    if (userDataPath === null && this._getUserDataPath) {
      try { userDataPath = this._getUserDataPath() } catch (_) { userDataPath = null }
    }
    if (userDataPath === null && this._app && typeof this._app.getPath === 'function') {
      try { userDataPath = this._app.getPath('userData') } catch (_) { userDataPath = null }
    }
    if (typeof userDataPath !== 'string' || !userDataPath || userDataPath.length > 4096 || hasControlCharacter(userDataPath) || !path.isAbsolute(userDataPath)) {
      return null
    }
    return path.resolve(userDataPath)
  }

  _errorDetail (error) {
    if (!error) return 'unknown'
    return String(error.message || error.code || error).slice(0, 300)
  }

  _toPublic (avatar) {
    const out = {
      id: avatar.id,
      name: avatar.name,
      source: avatar.source,
      sourceKind: avatar.sourceKind,
      mediaType: avatar.mediaType,
      trainingState: avatar.trainingState === undefined ? TRAINING_STATES.TRAINING : avatar.trainingState,
      deletionState: avatar.deletionState === undefined ? DELETE_STATES.ACTIVE : avatar.deletionState,
      createdAt: avatar.createdAt,
      sampleCount: avatar.sampleStorage ? avatar.sampleStorage.sampleCount : 0,
    }
    if (avatar.invalidReason) out.invalidReason = avatar.invalidReason
    return out

  }

  /** 素材扩展名白名单（图片/视频；非法扩展名在入参归一阶段就被拒） */
  _safeExtension (fileName) {
    if (typeof fileName !== 'string') return null
    const ext = path.extname(fileName).toLowerCase()
    return AVATAR_MEDIA_EXTENSIONS.includes(ext) ? ext : null
  }

  /**
   * 公共方法的统一前置：归一入参 → 取 owner → 查 store 可用。
   * 五个入口（list/create/delete/rename/refresh）都是同一串，抽出来避免五份漂移。
   *
   * @param {(input: unknown) => object|null} normalize
   * @param {unknown} input
   * @returns {{ok: false, response: object} | {ok: true, request: object, owner: object}}
   */
  _guard (normalize, input) {
    const request = normalize(input)
    if (!request) return { ok: false, response: failure('AVATAR_CLONE_INVALID_ARGUMENTS') }
    const owner = this._captureOwner()
    if (!owner) return { ok: false, response: failure('AVATAR_OWNER_UNAVAILABLE') }
    if (!this._hasUserSettings()) return { ok: false, response: failure('AVATAR_CLONE_STORE_UNAVAILABLE') }
    return { ok: true, request, owner }
  }

  // ── 入参归一：纯函数在 avatar-clone-registry，这里直接调，不包薄层 ──

  _normalizeRequest (input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    return { providerId: AVATAR_CLONE_PROVIDER }
  }
}

// 导出面刻意收敛：外部（IPC handler）只消费 AvatarCloneService。
// 训练轮询/删除重试等策略常量若被测试或别处需要，应从 avatar-clone-registry 取
// ——那里是同族的纯常量真源，避免两处各写一份。
module.exports = { AvatarCloneService }
