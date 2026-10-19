// @ts-check
'use strict'

const { AvatarCatalogService } = require('../services/avatar-catalog-service')
const { withSenderCheck, EC } = require('./helpers')
const { log } = require('../services/logger')

function isSafeIdentifier (value, maxLength = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    /^[a-zA-Z0-9._-]+$/.test(value)
}

/**
 * 入参归一化（沿用 tts-voice-catalog.js 的 isSafeIdentifier 范式）。
 * refresh 严格布尔校验：非布尔（含字符串 'true'）一律拒绝，避免把用户提供的值
 * 当真值传下去造成「永远强制刷新」或「永远读缓存」。
 */
function normalizeCatalogArgs (args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  if (!isSafeIdentifier(args.providerId, 128)) return null
  if (args.refresh !== undefined && typeof args.refresh !== 'boolean') return null
  const result = { providerId: args.providerId }
  if (args.refresh === true) result.refresh = true
  return result
}

function invalidArguments () {
  return { code: EC.VALIDATION_ERROR, message: 'AVATAR_CATALOG_INVALID_ARGUMENTS' }
}

function logHandlerError (method, input, error) {
  const providerId = input && isSafeIdentifier(input.providerId, 128) ? input.providerId : 'unknown'
  const detail = String(error && error.message ? error.message : error).slice(0, 200)
  // 日志器缺失时静默（单测可注入无 logger 的 deps），不得让「记日志」反过来打断业务返回
  if (log && typeof log.warn === 'function') {
    log.warn('avatar-catalog', `${method} error providerId=${providerId} detail=${detail}`)
  }
}

/**
 * 注册数字人形象/音色目录 IPC。
 * 与 tts-voice:* 分开命名空间：TTS 音色是语音合成语义，数字人形象是 avatar 资产，
 * 混进同一 service 会让契约测试与职责边界同时失真。
 */
function registerAvatarCatalogHandlers (ipcMain, deps = {}) {
  const service = deps.avatarCatalogService || new AvatarCatalogService({
    modelProviderManager: deps.modelProviderManager,
  })

  ipcMain.handle('avatar-catalog:avatars', withSenderCheck(async (_event, args) => {
    const input = normalizeCatalogArgs(args)
    if (!input) return invalidArguments()
    try {
      const result = await service.listAvatars(input)
      if (!result || typeof result !== 'object') {
        return { code: EC.REQUEST_ERROR, message: 'AVATAR_CATALOG_UNAVAILABLE' }
      }
      if (result.code !== 0) {
        return { code: EC.REQUEST_ERROR, message: result.message || 'AVATAR_CATALOG_UNAVAILABLE' }
      }
      return { code: 0, data: { avatars: Array.isArray(result.data) ? result.data : [], cached: result.cached === true } }
    } catch (error) {
      logHandlerError('avatars', input, error)
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CATALOG_UNAVAILABLE' }
    }
  }))

  ipcMain.handle('avatar-catalog:voices', withSenderCheck(async (_event, args) => {
    const input = normalizeCatalogArgs(args)
    if (!input) return invalidArguments()
    try {
      const result = await service.listVoices(input)
      if (!result || typeof result !== 'object') {
        return { code: EC.REQUEST_ERROR, message: 'AVATAR_CATALOG_UNAVAILABLE' }
      }
      if (result.code !== 0) {
        return { code: EC.REQUEST_ERROR, message: result.message || 'AVATAR_CATALOG_UNAVAILABLE' }
      }
      return { code: 0, data: { voices: Array.isArray(result.data) ? result.data : [], cached: result.cached === true } }
    } catch (error) {
      logHandlerError('voices', input, error)
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CATALOG_UNAVAILABLE' }
    }
  }))

  ipcMain.handle('avatar-catalog:invalidate', withSenderCheck(async (_event, args) => {
    const input = normalizeCatalogArgs(args)
    if (!input) return invalidArguments()
    try {
      service.invalidate(input.providerId)
      return { code: 0, data: { ok: true } }
    } catch (error) {
      logHandlerError('invalidate', input, error)
      return { code: EC.REQUEST_ERROR, message: 'AVATAR_CATALOG_UNAVAILABLE' }
    }
  }))
}

module.exports = registerAvatarCatalogHandlers
module.exports.normalizeCatalogArgs = normalizeCatalogArgs
