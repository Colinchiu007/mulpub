// @ts-check
/**
 * avatar-clone-remote — 形象克隆的远端调用与创建编排（副作用集中在此）
 *
 * 从 avatar-clone-service 拆出（max-lines 门禁）。
 *
 * 集中三件事：
 *   1. _callAvatarMethod：统一走 callAdapter（未登记 KNOWN_METHODS 的方法由
 *      supports() 闸门 fail-closed，返回 { ok:false, detail }，不抛异常）；
 *   2. _remoteDelete：删除远端形象；
 *   3. orchestrateCreate：创建编排（审计先行 → 远端创建 → 落样本 → 写 registry），
 *      任一步失败的补偿路径都在这里闭合，避免 service 主体被补偿分支撑爆。
 *
 * 补偿原则：远端已创建而本地失败时，必须删远端（否则留下付费的孤儿资产），
 * 且审计要记下「曾发起创建」与「补偿结果」。
 */
'use strict'

const { safeIdentifier, DELETE_STATES } = require('./avatar-clone-registry')

/**
 * 兜底 provider（仅当 owner 上没带 providerId 时用）。
 *
 * change: digital-human-multiprovider —— 此前这里是唯一的 provider 来源，
 * 导致 service 已按 providerId 分段存 registry、远端调用却仍打 HeyGen：
 * 切到飞影后「用照片创建」会拿 HeyGen 的 avatar id 存进飞影的 registry，
 * 生成视频时飞影不认这个 id —— 不报错，静默错配。
 * 现在 providerId 一律由调用方（owner）传入，本常量只兜底。
 */
const DEFAULT_AVATAR_CLONE_PROVIDER = 'heygen'
const PENDING = DELETE_STATES.PENDING

class AvatarCloneRemote {
  /**
   * @param {object} deps
   * @param {{callAdapter: Function}|null} deps.modelProviderManager
   * @param {(owner: unknown, event: object) => Promise<number|null>} deps.appendAudit
   * @param {(owner: unknown, descriptor: object, media: unknown) => Promise<object>} deps.persistSample
   * @param {(owner: unknown, sampleStorage: unknown) => Promise<boolean>} deps.cleanupSampleStorage
   * @param {(owner: unknown, registry: object) => boolean} deps.writeRegistry
   * @param {(owner: unknown) => {registry: object}|{error: object}} deps.readRegistry
   * @param {() => object} deps.newCloneRecord
   * @param {(clone: object) => object} deps.toPublic
   * @param {(message: string, data?: object) => object} deps.failure
   * @param {(data: object) => object} deps.success
   * @param {(message: string, value: unknown) => void} deps.warn
   */
  constructor (deps = {}) {
    this._manager = deps.modelProviderManager || null
    this._appendAudit = deps.appendAudit
    this._persistSample = deps.persistSample
    this._cleanupSampleStorage = deps.cleanupSampleStorage
    this._writeRegistry = deps.writeRegistry
    this._readRegistry = deps.readRegistry
    this._newCloneRecord = deps.newCloneRecord
    this._toPublic = deps.toPublic
    this._failure = deps.failure
    this._success = deps.success
    this._warn = deps.warn || (() => {})
  }

  hasAdapter () {
    return Boolean(this._manager) && typeof this._manager.callAdapter === 'function'
  }

  /**
   * 调 adapter 的形象克隆方法。
   *
   * @param {string} providerId 当前数字人服务商（由 owner 带下，不在此处猜）
   * @param {string} method adapter 方法名
   * @param {object} params
   */
  async callAvatarMethod (providerId, method, params) {
    if (!this.hasAdapter()) return { ok: false, detail: 'model provider manager unavailable' }
    const provider = typeof providerId === 'string' && providerId.trim() ? providerId.trim() : DEFAULT_AVATAR_CLONE_PROVIDER
    try {
      const result = await this._manager.callAdapter(provider, method, params)
      if (result && result.code === 0) return { ok: true, data: result.data }
      const detail = result && (result.message || result.errorCode) ? String(result.message || result.errorCode) : 'adapter returned failure'
      return { ok: false, detail }
    } catch (error) {
      return { ok: false, detail: String(error && error.message ? error.message : error).slice(0, 300) }
    }
  }

  async remoteDelete (providerId, avatarId) {
    const result = await this.callAvatarMethod(providerId, 'deleteAvatar', { avatarId })
    return result.ok
  }

  /**
   * 创建编排。返回 { ok, response }；response 即 service 对外的成功/失败体。
   *
   * 顺序：审计 → 远端创建 → 落样本 → 读 registry → 写 registry。
   * 每一步失败都有对应的补偿（删远端 / 清样本），且都落审计。
   */
  async orchestrateCreate (request, owner, sampleStorage) {
    const auditSeq = await this._appendAudit(owner, {
      event: 'create',
      sourceKind: request.sourceKind,
      name: request.name,
      mediaType: request.mediaType,
    })
    if (!auditSeq) return { ok: false, response: this._failure('AVATAR_CLONE_STORAGE_UNAVAILABLE') }

    const created = await this.callAvatarMethod(owner.providerId, 'createAvatar', {
      name: request.name,
      type: request.type,
      [request.mediaType === 'image' ? 'image' : 'video']: request.media,
    })
    if (!created.ok) {
      await this._appendAudit(owner, { event: 'create_failed', auditSeq, detail: created.detail })
      return { ok: false, response: this._failure('AVATAR_CLONE_PROVIDER_UNAVAILABLE', { detail: created.detail }) }
    }

    const avatarId = safeIdentifier(created.data && (created.data.id || created.data.avatar_id), 256)
    if (!avatarId) {
      await this._appendAudit(owner, { event: 'create_failed', auditSeq, detail: 'no avatar id in response' })
      return { ok: false, response: this._failure('AVATAR_CLONE_PROVIDER_UNAVAILABLE', { detail: 'no avatar id in response' }) }
    }

    // 落样本：远端已创建成功，本地失败要补偿删远端
    try {
      await this._persistSample(owner, sampleStorage, request.media)
    } catch (_) {
      await this.remoteDelete(owner.providerId, avatarId)
      await this._appendAudit(owner, { event: 'create_failed', auditSeq, detail: 'sample persist failed; remote compensated' })
      return { ok: false, response: this._failure('AVATAR_CLONE_STORAGE_UNAVAILABLE') }
    }

    const registryResult = this._readRegistry(owner)
    if (registryResult.error) {
      await this._compensate(owner.providerId, avatarId, owner, sampleStorage, auditSeq, 'registry read failed')
      return { ok: false, response: registryResult.error }
    }
    if (registryResult.registry.avatars.some((a) => a.id === avatarId)) {
      await this._compensate(owner.providerId, avatarId, owner, sampleStorage, auditSeq, 'duplicate id')
      return { ok: false, response: this._failure('AVATAR_CLONE_DUPLICATE_ID') }
    }

    const clone = this._newCloneRecord({ avatarId, request, auditSeq, sampleStorage })
    const nextRegistry = { ...registryResult.registry, avatars: [...registryResult.registry.avatars, clone] }
    if (!this._writeRegistry(owner, nextRegistry)) {
      await this._compensate(owner.providerId, avatarId, owner, sampleStorage, auditSeq, 'registry write failed')
      return { ok: false, response: this._failure('AVATAR_CLONE_STORE_UNAVAILABLE') }
    }

    await this._appendAudit(owner, { event: 'created', auditSeq, avatarId })
    return { ok: true, response: this._success({ avatar: this._toPublic(clone) }) }
  }

  async _compensate (providerId, avatarId, owner, sampleStorage, auditSeq, reason) {
    await this.remoteDelete(providerId, avatarId)
    await this._cleanupSampleStorage(owner, sampleStorage)
    await this._appendAudit(owner, { event: 'create_failed', auditSeq, detail: reason + '; remote compensated' })
    this._warn('AvatarClone', 'create compensated: ' + reason)
  }

  /**
   * 删除编排。
   *
   * 三态语义（与 tts-voice-clone-service.DELETE_STATES 同构）：
   *   - 远端删除成功 ⇒ 清 registry 条目与本地样本，报 { deleted:true, remoteDeleted:true }
   *   - 远端删除失败 ⇒ registry 条目标 pending、**保留样本**，报 { deleted:false, pending:true }
   *     （不谎称成功；下次重试或 TTL 到期后再清理）
   *   - 本地 registry 写失败但远端已删 ⇒ 保留 pending 记录，报 STORE_UNAVAILABLE
   *     （远端已不存在而本地还留着，比「本地也没有」更安全——下次还能重试清理）
   */
  async orchestrateDelete (request, owner) {
    const registryResult = this._readRegistry(owner)
    if (registryResult.error) return registryResult.error
    const clone = registryResult.registry.avatars.find((a) => a.id === request.avatarId)
    if (!clone) return this._failure('AVATAR_CLONE_NOT_FOUND')

    const workingRegistry = {
      ...registryResult.registry,
      avatars: registryResult.registry.avatars.map((a) => (a.id === request.avatarId ? { ...a, deletionState: PENDING } : a)),
    }
    if (!this._writeRegistry(owner, workingRegistry)) return this._failure('AVATAR_CLONE_STORE_UNAVAILABLE')

    const remoteDeleted = await this.remoteDelete(owner.providerId, clone.id)
    await this._appendAudit(owner, {
      event: remoteDeleted ? 'deleted' : 'delete_pending',
      avatarId: clone.id,
      detail: remoteDeleted ? null : 'remote delete failed; local retained for retry',
    })

    if (!remoteDeleted) {
      return this._success({ deleted: false, remoteDeleted: false, pending: true })
    }

    const nextRegistry = { ...workingRegistry, avatars: workingRegistry.avatars.filter((a) => a.id !== clone.id) }
    if (!this._writeRegistry(owner, nextRegistry)) {
      return this._failure('AVATAR_CLONE_STORE_UNAVAILABLE')
    }
    await this._cleanupSampleStorage(owner, clone.sampleStorage)
    return this._success({ deleted: true, remoteDeleted: true })
  }
}

module.exports = { AvatarCloneRemote, DEFAULT_AVATAR_CLONE_PROVIDER }
