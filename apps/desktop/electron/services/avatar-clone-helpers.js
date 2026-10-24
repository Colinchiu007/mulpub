// @ts-check
/**
 * avatar-clone-helpers.js — AvatarCloneService 的工具方法（prototype mixin）
 *
 * 从 avatar-clone-service.js 拆出（max-lines 门禁）。拆的都是**无状态小工具**：
 * 路径解析、错误摘要、公开条目裁剪、扩展名白名单。它们不依赖 registry 锁，
 * 也不发起远端调用，抽走不影响主流程可读性。
 *
 * 挂载方式（与 heygen-clone / hifly-clone 同型）：
 *   Object.assign(AvatarCloneService.prototype, require('./avatar-clone-helpers').helpers)
 */
'use strict'

const path = require('node:path')

const {
  AVATAR_MEDIA_EXTENSIONS,
  AVATAR_AUDIO_EXTENSIONS,
  DELETE_STATES,
  TRAINING_STATES,
} = require('./avatar-clone-registry')

/** userData 路径长度上限（防异常值把后续 fs 调用带崩） */
const MAX_USER_DATA_PATH_LENGTH = 4096

function hasControlCharacter (value) {
  return Array.from(String(value)).some((ch) => {
    const code = ch.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
}

const helpers = {
  /**
   * 解析 userData 绝对路径。
   *
   * 三級回退：注入值 → app.getPath('userData') → null。
   * 每一步都做形状校验（非空、绝对路径、无控制字符、长度受限）——
   * 这个值会进 fs 调用，异常值要么炸要么写到意外位置。
   */
  _resolveUserDataPath () {
    let userDataPath = this._userDataPath
    if (userDataPath === null && this._getUserDataPath) {
      try { userDataPath = this._getUserDataPath() } catch (_) { userDataPath = null }
    }
    if (userDataPath === null && this._app && typeof this._app.getPath === 'function') {
      try { userDataPath = this._app.getPath('userData') } catch (_) { userDataPath = null }
    }
    if (typeof userDataPath !== 'string' || !userDataPath || userDataPath.length > MAX_USER_DATA_PATH_LENGTH || hasControlCharacter(userDataPath) || !path.isAbsolute(userDataPath)) {
      return null
    }
    return path.resolve(userDataPath)
  },

  /** 错误摘要（截断到 300 字符，防超长 message 撑爆日志行） */
  _errorDetail (error) {
    if (!error) return 'unknown'
    return String(error.message || error.code || error).slice(0, 300)
  },

  /**
   * 裁成公开条目（listClones 用）。
   *
   * 刻意**不含** sampleStorage.relativeDir：那是本机绝对路径的片段，
   * 给了渲染进程等于泄露用户目录结构，且前端也用不到（它只看 sampleCount）。
   */
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
      // change: avatar-voice-clone-bundled —— 配套声音 id 一并暴露，
      // 前端生成视频时可直接取用，不需要再去声音克隆列表里找。
      ...(avatar.voiceId ? { voiceId: avatar.voiceId } : {}),
    }
    if (avatar.invalidReason) out.invalidReason = avatar.invalidReason
    return out
  },

  /** 素材扩展名白名单（图片/视频；非法扩展名在入参归一阶段就被拒） */
  /**
   * 素材扩展名白名单。
   *
   * change: avatar-voice-clone-bundled —— 从「图片+视频」扩到「图片+视频+音频」：
   * 克隆现在可同时带一段录音作为配套声音素材，`.mp3/.m4a/.wav` 必须过这道闸。
   * 具体的类型配对校验（photo 只能图片、voice 只能音频）在归一层做，
   * 这里只负责「是不是受支持的素材扩展名」。
   */
  _safeExtension (fileName) {
    if (typeof fileName !== 'string') return null
    const ext = path.extname(fileName).toLowerCase()
    return AVATAR_MEDIA_EXTENSIONS.includes(ext) || AVATAR_AUDIO_EXTENSIONS.includes(ext) ? ext : null
  },
}

module.exports = { helpers, hasControlCharacter }
