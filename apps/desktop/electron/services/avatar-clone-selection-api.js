// @ts-check
/**
 * avatar-clone-selection-api — 「素材两段式」的 service 侧 API（prototype mixin）
 *
 * 从 avatar-clone-service 拆出（max-lines 门禁 + 职责边界）。
 *
 * 这两个方法共同构成素材两段式的 service 侧：
 *   1. createSampleSelection：把主进程对话框给的绝对路径读成内存素材，发 selectionId；
 *   2. addCloneFromSelection：按 selectionId 消费素材，发起创建。
 *
 * 为什么单独成文件而不是留在 service 主体：它们只依赖 `this._selections`
 * 与 `this.createClone`，与 registry 锁、审计、远端补偿那一大套无关。
 * 混在主体里会让「找创建编排」的人先读完两段式 glue。
 *
 * change: avatar-voice-clone-bundled —— 两条素材（形象 + 录音）走同一条两段式，
 * 在 addCloneFromSelection 里合并成一次 createClone 调用（同一 provider 下捆绑创建）。
 */
'use strict'

const { safeDisplayName, normalizeSourceKind } = require('./avatar-clone-registry')

function failure (message, data) { return data === undefined ? { code: -1, message } : { code: -1, message, data } }
function success (data) { return { code: 0, data } }

const helpers = {
  /**
   * 第一步：把用户在对话框选的绝对路径读成内存素材，发一个短期 selectionId。
   * 实际读文件/TTL/过期清理在 avatar-clone-selection。
   *
   * change: avatar-voice-clone-bundled —— type 增加 `audio`：录音素材与形象素材
   * 走同一条两段式链路。
   */
  async createSampleSelection (input, paths, senderKey) {
    const type = input && (input.type === 'photo' || input.type === 'digital_twin' || input.type === 'audio')
      ? input.type
      : null
    if (!type) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    if (typeof senderKey !== 'string' || !senderKey) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    if (!Array.isArray(paths) || paths.length !== 1) return failure('AVATAR_CLONE_INVALID_ARGUMENTS')
    const created = await this._selections.create(type, paths[0])
    if (!created.ok) return failure(created.message)
    if (!this._selections.bindSender(created.data.selectionId, senderKey)) {
      return failure('AVATAR_CLONE_SELECTION_UNAVAILABLE')
    }
    return success(created.data)
  },

  /**
   * 第二步：按 selectionId 创建克隆形象。
   * selection 与 senderKey / type 必须与第一步一致，否则拒绝（防跨窗口冒用）。
   *
   * change: avatar-voice-clone-bundled —— 可同时带 `voiceSelectionId`：
   * 声音素材与形象素材走同一条两段式链路，最终在同一个 provider 下捆绑创建。
   * 两个 selection 必须属于同一 sender（防跨窗口冒用），校验同型。
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
    // change: digital-human-multiprovider —— providerId 从 IPC 层透传下来，
    // 决定远端调用打到哪家、registry 存哪一段。
    const providerId = typeof input.providerId === 'string' && input.providerId.trim() ? input.providerId.trim() : undefined
    // change: avatar-voice-clone-bundled —— 配套声音的 selectionId（可选）
    const voiceSelectionId = typeof input.voiceSelectionId === 'string' && input.voiceSelectionId.trim()
      ? input.voiceSelectionId.trim()
      : null

    const taken = this._selections.take(selectionId, senderKey, type)
    if (!taken.ok) return failure(taken.message)

    // 声音素材：与形象同型的两段式消费。取不到（过期/跨窗口/类型不符）
    // 视为**整个创建失败**——不能出现「形象建了、声音没建」的半截克隆，
    // 那会让用户下次生成视频时仍因缺 voice 失败，且形象是付费资产。
    let voice = null
    if (voiceSelectionId) {
      const voiceTaken = this._selections.take(voiceSelectionId, senderKey, 'audio')
      if (!voiceTaken.ok) return failure(voiceTaken.message)
      voice = voiceTaken.media
    }

    return this.createClone({ name, type, media: taken.media, sourceKind, providerId, voice })
  },
}

module.exports = { helpers }
