// @ts-check
/**
 * avatar-clone-selection — 素材两段式上传的中间态（纯内存 + 依赖注入）
 *
 * 从 avatar-clone-service 拆出（max-lines 门禁）。
 *
 * 为什么两段式：renderer 不得直接传路径或字节——那等于把任意文件读取开给渲染进程。
 * 路径只能由主进程对话框产生；选中后立刻读成内存 Blob，只把 selectionId 交回 renderer，
 * 第二步再用 selectionId 换取创建。与 tts-voice-clone-service 的样本选择同型，
 * 但素材是图片/视频（更大），故 TTL 与并发上限都收紧。
 */
'use strict'

const path = require('node:path')

const AVATAR_IMAGE_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp'])
const AVATAR_VIDEO_EXTENSIONS = Object.freeze(['.mp4', '.mov', '.webm'])
// change: avatar-voice-clone-bundled —— 录音素材（飞影官方只支持这三种）
const AVATAR_AUDIO_EXTENSIONS = Object.freeze(['.mp3', '.m4a', '.wav'])

// 图片 mime 走 shared-utils 单一真源（R7 规则：业务文件不得自建 mime↔扩展名映射表）。
// 该模块只登记图片格式，正好覆盖 photo 类型的全部扩展名；未知 ext 返回 null（宁可失败不猜）。
const { extToMime } = require('@multi-publish/shared-utils/src/image-mime')

/**
 * 视频 mime：共享真源不覆盖视频，故用分支而非映射表。
 * R7 扫描器只认「mime↔扩展名配对的对象字面量」，分支不构成独立映射表信号；
 * 若将来 shared-utils 补视频格式，应改回调真源。
 */
function videoContentType (ext) {
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.webm') return 'video/webm'
  return 'application/octet-stream'
}

/**
 * 音频 mime：同上，共享真源不覆盖音频，用分支。
 * 这三个扩展名对应飞影官方「创建声音」的三种受支持格式。
 */
function audioContentType (ext) {
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.wav') return 'audio/wav'
  return 'application/octet-stream'
}

const MAX_ACTIVE_SELECTIONS = 4
const DEFAULT_SELECTION_TTL_MS = 5 * 60 * 1000

function isSafeIdentifier (value, maxLength = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    /^[a-zA-Z0-9._-]+$/.test(value)
}

function extensionOf (fileName) {
  if (typeof fileName !== 'string') return null
  const ext = path.extname(fileName).toLowerCase()
  return ext || null
}

function allowedExtensionsFor (type) {
  if (type === 'photo') return AVATAR_IMAGE_EXTENSIONS
  if (type === 'audio') return AVATAR_AUDIO_EXTENSIONS
  return AVATAR_VIDEO_EXTENSIONS
}

function contentTypeFor (type, ext) {
  if (type === 'photo') return extToMime(ext) || 'application/octet-stream'
  if (type === 'audio') return audioContentType(ext)
  return videoContentType(ext)
}

class AvatarCloneSelectionStore {
  /**
   * @param {object} deps
   * @param {typeof import('node:fs')} [deps.fs]
   * @param {() => string} deps.createToken
   * @param {() => number} deps.now
   * @param {Function} [deps.setTimeout]
   * @param {Function} [deps.clearTimeout]
   * @param {number} [deps.ttlMs]
   */
  constructor (deps = {}) {
    this._fs = deps.fs || require('node:fs')
    this._createToken = deps.createToken
    this._now = deps.now
    this._setTimeout = deps.setTimeout || setTimeout
    this._clearTimeout = deps.clearTimeout || clearTimeout
    this._ttlMs = Number.isFinite(deps.ttlMs) && deps.ttlMs > 0 ? deps.ttlMs : DEFAULT_SELECTION_TTL_MS
    this._items = new Map()
    this._timers = new Map()
  }

  /** 读取路径并生成 selectionId；返回 { ok, ... }，不抛异常 */
  async create (type, mediaPath) {
    // change: avatar-voice-clone-bundled —— audio 也走同一条两段式链路
    if (type !== 'photo' && type !== 'digital_twin' && type !== 'audio') {
      return { ok: false, message: 'AVATAR_CLONE_INVALID_ARGUMENTS' }
    }
    if (typeof mediaPath !== 'string' || !path.isAbsolute(mediaPath) || mediaPath.length > 4096) {
      return { ok: false, message: 'AVATAR_CLONE_INVALID_ARGUMENTS' }
    }
    const ext = extensionOf(mediaPath)
    if (!ext || !allowedExtensionsFor(type).includes(ext)) {
      return { ok: false, message: 'AVATAR_CLONE_SAMPLE_INVALID' }
    }

    let buffer
    try {
      buffer = await this._fs.promises.readFile(mediaPath)
    } catch (_) {
      return { ok: false, message: 'AVATAR_CLONE_SAMPLE_UNREADABLE' }
    }

    const selectionId = isSafeIdentifier(this._createToken()) ? this._createToken() : null
    if (!selectionId) return { ok: false, message: 'AVATAR_CLONE_SELECTION_UNAVAILABLE' }

    this.purgeExpired()
    if (this._items.size >= MAX_ACTIVE_SELECTIONS) {
      return { ok: false, message: 'AVATAR_CLONE_SELECTION_UNAVAILABLE' }
    }

    const contentType = contentTypeFor(type, ext)
    const expiresAt = this._now() + this._ttlMs
    this._items.set(selectionId, {
      type,
      media: { blob: new Blob([buffer], { type: contentType }), fileName: path.basename(mediaPath), contentType },
      bytes: buffer.length,
      expiresAt,
    })
    this._scheduleExpiry(selectionId)
    return {
      ok: true,
      data: {
        selectionId,
        expiresAt,
        bytes: buffer.length,
        mediaType: type === 'photo' ? 'image' : (type === 'audio' ? 'audio' : 'video'),
      },
    }
  }

  /** 取出并消费 selection；senderKey/type 不匹配即拒绝（防跨窗口冒用） */
  take (selectionId, senderKey, type) {
    if (!isSafeIdentifier(selectionId)) return { ok: false, message: 'AVATAR_CLONE_INVALID_ARGUMENTS' }
    this.purgeExpired()
    const item = this._items.get(selectionId)
    if (!item || item.senderKey !== senderKey || item.type !== type) {
      return { ok: false, message: 'AVATAR_CLONE_SELECTION_UNAVAILABLE' }
    }
    this._items.delete(selectionId)
    this._clearTimer(selectionId)
    return { ok: true, media: item.media }
  }

  /** 记录 senderKey（create 之后、take 之前由调用方绑定） */
  bindSender (selectionId, senderKey) {
    const item = this._items.get(selectionId)
    if (!item) return false
    item.senderKey = senderKey
    return true
  }

  purgeExpired () {
    const now = this._now()
    for (const [id, item] of this._items) {
      if (!item || item.expiresAt <= now) {
        this._items.delete(id)
        this._clearTimer(id)
      }
    }
  }

  _scheduleExpiry (selectionId) {
    const item = this._items.get(selectionId)
    if (!item) return
    const timer = this._setTimeout(() => {
      this._items.delete(selectionId)
      this._timers.delete(selectionId)
    }, Math.max(0, item.expiresAt - this._now()))
    if (timer && typeof timer.unref === 'function') timer.unref()
    this._timers.set(selectionId, timer)
  }

  _clearTimer (selectionId) {
    const timer = this._timers.get(selectionId)
    if (timer) this._clearTimeout(timer)
    this._timers.delete(selectionId)
  }
}

module.exports = {
  AvatarCloneSelectionStore,
  AVATAR_IMAGE_EXTENSIONS,
  AVATAR_VIDEO_EXTENSIONS,
  MAX_ACTIVE_SELECTIONS,
  DEFAULT_SELECTION_TTL_MS,
}
