// @ts-check
'use strict'

const path = require('node:path')

const { AvatarCloneService } = require('../services/avatar-clone-service')
const { AVATAR_IMAGE_EXTENSIONS, AVATAR_VIDEO_EXTENSIONS, AVATAR_AUDIO_EXTENSIONS } = require('../services/avatar-clone-registry')
const { withSenderCheck, EC } = require('./helpers')
const { log } = require('../services/logger')

const MEDIA_FILTERS = Object.freeze({
  photo: Object.freeze({ name: '图片素材', extensions: stripDots(AVATAR_IMAGE_EXTENSIONS) }),
  digital_twin: Object.freeze({ name: '视频素材', extensions: stripDots(AVATAR_VIDEO_EXTENSIONS) }),
  // change: avatar-voice-clone-bundled —— 录音素材（飞影官方只支持 mp3/m4a/wav）
  audio: Object.freeze({ name: '录音素材', extensions: stripDots(AVATAR_AUDIO_EXTENSIONS) }),
})

function stripDots (extensions) {
  return extensions.map((ext) => ext.replace(/^\./, ''))
}

function isSafeIdentifier (value, maxLength = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    /^[a-zA-Z0-9._-]+$/.test(value)
}

function isSafeName (value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128 &&
    !Array.from(value).some((ch) => { const c = ch.charCodeAt(0); return c <= 0x1f || c === 0x7f })
}

const SOURCE_KINDS = new Set(['self', 'third_party_authorized'])

function invalidArguments () {
  return { code: EC.VALIDATION_ERROR, message: 'AVATAR_CLONE_INVALID_ARGUMENTS' }
}

function logHandlerError (method, error) {
  const detail = String(error && error.message ? error.message : error).slice(0, 200)
  if (log && typeof log.warn === 'function') {
    log.warn('avatar-clone', `${method} error detail=${detail}`)
  }
}

function senderKey (event) {
  if (!event || !event.sender || !Number.isInteger(event.sender.id) || event.sender.id < 0) return null
  return `webcontents:${event.sender.id}`
}

/**
 * 素材类型归一。
 *
 * change: avatar-voice-clone-bundled —— 加 `audio`：声音克隆素材（录音）与形象
 * 素材走同一条两段式链路（对话框选文件 → selectionId → add），所以这里要多认一种。
 * `audio` **不是**独立入口，只作为 `avatar-clone:add` 的配套 voiceSelectionId 的来源。
 */
function normalizeType (value) {
  return value === 'photo' || value === 'digital_twin' || value === 'audio' ? value : null
}

/**
 * 注册数字人形象克隆 IPC。
 *
 * 素材刻意走「对话框选文件 → selectionId → add」两段式（与 tts-voice-clone 同型）：
 * renderer 不得直接传路径或字节，否则等于把任意文件读取开给渲染进程。
 */
function registerAvatarCloneHandlers (ipcMain, deps = {}) {
  const service = deps.avatarCloneService || new AvatarCloneService({
    store: deps.store,
    modelProviderManager: deps.modelProviderManager,
    app: deps.app,
  })
  const dialog = deps.dialog || null

  ipcMain.handle('avatar-clone:list', withSenderCheck(async (_event, args) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return invalidArguments()
    try {
      return await service.listClones({})
    } catch (error) {
      logHandlerError('list', error)
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CLONE_UNAVAILABLE' }
    }
  }))

  ipcMain.handle('avatar-clone:choose-media', withSenderCheck(async (event, args) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return invalidArguments()
    const type = normalizeType(args.type)
    if (!type) return invalidArguments()
    const key = senderKey(event)
    if (!key) return invalidArguments()
    if (!dialog || typeof dialog.showOpenDialog !== 'function') {
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CLONE_DIALOG_UNAVAILABLE' }
    }
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [MEDIA_FILTERS[type]],
      })
      if (!result || result.canceled === true) return { code: 0, data: { paths: [] } }
      const paths = Array.isArray(result.filePaths) &&
        result.filePaths.every((value) => typeof value === 'string' && path.isAbsolute(value))
        ? [...result.filePaths]
        : null
      return paths && paths.length > 0
        ? await service.createSampleSelection({ type }, paths, key)
        : { code: 0, data: { paths: [] } }
    } catch (error) {
      logHandlerError('choose-media', error)
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CLONE_DIALOG_UNAVAILABLE' }
    }
  }))

  ipcMain.handle('avatar-clone:add', withSenderCheck(async (event, args) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return invalidArguments()
    if (!isSafeIdentifier(args.selectionId, 128)) return invalidArguments()
    if (!isSafeName(args.name)) return invalidArguments()
    const type = normalizeType(args.type)
    if (!type) return invalidArguments()
    if (args.sourceKind !== undefined && !SOURCE_KINDS.has(args.sourceKind)) return invalidArguments()
    // change: digital-human-multiprovider —— 透传 providerId：service 要按它
    // 路由远端调用（否则 clone 会打到默认的 HeyGen）与分段 registry。
    if (args.providerId !== undefined && !isSafeIdentifier(args.providerId, 128)) return invalidArguments()
    // change: avatar-voice-clone-bundled —— 配套声音的 selectionId。
    // 与形象素材同型：也是「对话框选文件 → selectionId」两段式，
    // renderer 不直传路径或字节。不传表示「只要形象」。
    if (args.voiceSelectionId !== undefined && !isSafeIdentifier(args.voiceSelectionId, 128)) return invalidArguments()
    // 显式拒绝 renderer 直传素材（两段式的边界）
    if (args.media !== undefined || args.image !== undefined || args.video !== undefined || args.paths !== undefined) {
      return invalidArguments()
    }
    const key = senderKey(event)
    if (!key) return invalidArguments()
    try {
      return await service.addCloneFromSelection({
        selectionId: args.selectionId,
        name: args.name.trim(),
        type,
        sourceKind: args.sourceKind,
        ...(args.providerId ? { providerId: args.providerId } : {}),
        ...(args.voiceSelectionId ? { voiceSelectionId: args.voiceSelectionId } : {}),
      }, key)
    } catch (error) {
      logHandlerError('add', error)
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CLONE_UNAVAILABLE' }
    }
  }))

  ipcMain.handle('avatar-clone:delete', withSenderCheck(async (_event, args) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return invalidArguments()
    if (!isSafeIdentifier(args.avatarId, 256)) return invalidArguments()
    try {
      return await service.deleteClone({ avatarId: args.avatarId })
    } catch (error) {
      logHandlerError('delete', error)
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CLONE_UNAVAILABLE' }
    }
  }))

  ipcMain.handle('avatar-clone:rename', withSenderCheck(async (_event, args) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return invalidArguments()
    if (!isSafeIdentifier(args.avatarId, 256)) return invalidArguments()
    if (!isSafeName(args.name)) return invalidArguments()
    try {
      return await service.renameClone({ avatarId: args.avatarId, name: args.name.trim() })
    } catch (error) {
      logHandlerError('rename', error)
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CLONE_UNAVAILABLE' }
    }
  }))
}

module.exports = registerAvatarCloneHandlers
