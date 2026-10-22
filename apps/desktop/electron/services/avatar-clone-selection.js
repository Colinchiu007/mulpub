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

const IMAGE_CONTENT_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
})
const VIDEO_CONTENT_TYPES = Object.freeze({
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
})

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
  return type === 'photo' ? AVATAR_IMAGE_EXTENSIONS : AVATAR_VIDEO_EXTENSIONS
}

function contentTypeFor (type, ext) {
  const table = type === 'photo' ? IMAGE_CONTENT_TYPES : VIDEO_CONTENT_TYPES
  return table[ext] || 'application/octet-stream'
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
    if (type !== 'photo' && type !== 'digital_twin') return { ok: false, message: 'AVATAR_CLONE_INVALID_ARGUMENTS' }
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
        mediaType: type === 'photo' ? 'image' : 'video',
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
