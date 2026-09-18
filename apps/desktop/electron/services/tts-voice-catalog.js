// @ts-check
'use strict'

/**
 * TTS 音色目录的静态能力边界。
 *
 * 这里只描述已经注册的 adapter 可以被目录服务安全消费的 provider/model
 * 组合；不能根据模型名、供应商文档或 renderer 输入推断上传/克隆能力。
 */

const CAPABILITY_TYPES = Object.freeze({
  BUILTIN: 'builtin',
  PROVIDER_PERSONAL_SLOT: 'provider_personal_slot',
  USER_CLONE: 'user_clone',
  UNSUPPORTED: 'unsupported',
})

const SAFE_SOURCES = new Set(Object.values(CAPABILITY_TYPES))
const MAX_VOICE_ID_LENGTH = 256
const MAX_VOICE_NAME_LENGTH = 256

function makeCloneMetadata (entry, implementation, messageKey, enabled = false) {
  return Object.freeze({
    enabled,
    entry,
    implementation,
    messageKey,
  })
}

const NO_CLONE = makeCloneMetadata('none', 'not_implemented', 'tts.voice.clone.notImplemented')
const PLATFORM_CONSOLE = makeCloneMetadata('provider_console', 'external_console_required', 'tts.voice.clone.providerConsole')
const NOT_SUPPORTED = makeCloneMetadata('none', 'unsupported', 'tts.voice.clone.unsupported')
const DESKTOP_UPLOAD_CLONE = makeCloneMetadata(
  'desktop_upload',
  'adapter_implemented',
  'tts.voice.clone.desktopUpload',
  true,
)

function catalogCapability (type, options = {}) {
  return Object.freeze({
    type,
    canListVoices: options.canListVoices === true,
    defaultVoiceId: options.defaultVoiceId || null,
    clone: options.clone || NO_CLONE,
  })
}

/**
 * 此白名单是唯一的 provider/model 能力来源。
 *
 * `user_clone` 表示供应商具有用户克隆产品能力，不表示桌面 adapter 已经
 * 实现上传或创建 API；`clone.enabled` 必须保持 false，直到对应 adapter
 * 以经过验收的 API 合同显式实现为止。
 */
const PROVIDER_MODEL_CAPABILITIES = Object.freeze({
  elevenlabs: Object.freeze({
    'eleven_multilingual_v2': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, clone: DESKTOP_UPLOAD_CLONE }),
    'eleven_turbo_v2_5': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, clone: DESKTOP_UPLOAD_CLONE }),
    'eleven_monolingual_v1': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, clone: DESKTOP_UPLOAD_CLONE }),
  }),
  'openai-tts': Object.freeze({
    'tts-1': catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, defaultVoiceId: 'alloy' }),
    'tts-1-hd': catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, defaultVoiceId: 'alloy' }),
    'gpt-4o-mini-tts': catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, defaultVoiceId: 'alloy' }),
    'gpt-4o-mini-tts-2025-12-15': catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, defaultVoiceId: 'alloy' }),
  }),
  'doubao-tts': Object.freeze({
    'doubao-tts': catalogCapability(CAPABILITY_TYPES.PROVIDER_PERSONAL_SLOT, {
      canListVoices: true,
      clone: PLATFORM_CONSOLE,
    }),
    'doubao-streaming-tts': catalogCapability(CAPABILITY_TYPES.PROVIDER_PERSONAL_SLOT, {
      canListVoices: true,
      clone: PLATFORM_CONSOLE,
    }),
  }),
  'google-tts': Object.freeze({
    'google-tts': catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, clone: NOT_SUPPORTED }),
    waveNet: catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, clone: NOT_SUPPORTED }),
    neural2: catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, clone: NOT_SUPPORTED }),
  }),
  piper: Object.freeze({
    piper: catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, clone: NOT_SUPPORTED }),
  }),
  'mimo-tts': Object.freeze({
    // MiMo 官方文档（speech-synthesis-v2.5）：
    // - mimo-v2.5-tts 使用 9 个预置音色（mimo_default/冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean）
    // - mimo-v2.5-tts-voiceclone 基于音频样本复刻任意音色（每次合成注入 base64 样本，
    //   无远端 voice_id；本地样本由 tts-voice-clone-service 管理，adapter 已实现 cloneVoice）
    // - mimo-v2.5-tts-voicedesign 项目用不到，已从代码中移除
    'mimo-v2.5-tts': catalogCapability(CAPABILITY_TYPES.BUILTIN, { canListVoices: true, defaultVoiceId: 'mimo_default' }),
    'mimo-v2.5-tts-voiceclone': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, clone: DESKTOP_UPLOAD_CLONE }),
  }),
  'minimax-tts': Object.freeze({
    // MiniMax 官方支持 100+ 系统音色与音色快速复刻（speech-voice-clone）；
    // 音色列表与克隆能力由 minimax-tts adapter 按官方 API 合同实现（listVoices/cloneVoice）。
    'speech-2.8-turbo': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, defaultVoiceId: 'male-qn-qingse', clone: DESKTOP_UPLOAD_CLONE }),
    'speech-2.8-hd': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, defaultVoiceId: 'male-qn-qingse', clone: DESKTOP_UPLOAD_CLONE }),
    'speech-2.6-hd': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, defaultVoiceId: 'male-qn-qingse', clone: DESKTOP_UPLOAD_CLONE }),
    'speech-2.6-turbo': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, defaultVoiceId: 'male-qn-qingse', clone: DESKTOP_UPLOAD_CLONE }),
  }),
  'minimax-multimodal': Object.freeze({
    // 多模态预设（category=multimodal）内部委托 minimax-tts adapter 实现 TTS 能力
    // （synthesize/listVoices/cloneVoice），音色能力边界与 minimax-tts 完全一致；
    // capability_models.tts 默认 speech-2.8-turbo 也在此白名单内。
    'speech-2.8-turbo': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, defaultVoiceId: 'male-qn-qingse', clone: DESKTOP_UPLOAD_CLONE }),
    'speech-2.8-hd': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, defaultVoiceId: 'male-qn-qingse', clone: DESKTOP_UPLOAD_CLONE }),
    'speech-2.6-hd': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, defaultVoiceId: 'male-qn-qingse', clone: DESKTOP_UPLOAD_CLONE }),
    'speech-2.6-turbo': catalogCapability(CAPABILITY_TYPES.USER_CLONE, { canListVoices: true, defaultVoiceId: 'male-qn-qingse', clone: DESKTOP_UPLOAD_CLONE }),
  }),
})

function safeString (value, maxLength) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || Array.from(normalized).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })) return null
  return normalized
}

function normalizeSource (source) {
  return SAFE_SOURCES.has(source) ? source : CAPABILITY_TYPES.BUILTIN
}

function cloneCapability (clone) {
  return {
    enabled: clone.enabled === true,
    entry: clone.entry,
    implementation: clone.implementation,
    messageKey: clone.messageKey,
  }
}

function unsupportedCapability (providerId, model, reason) {
  return {
    providerId: safeString(providerId, 128),
    model: safeString(model, 128),
    type: CAPABILITY_TYPES.UNSUPPORTED,
    canListVoices: false,
    defaultVoiceId: null,
    clone: cloneCapability(NOT_SUPPORTED),
    reason,
  }
}

/**
 * 返回防御性副本，禁止调用方修改全局能力表。
 * @param {string} providerId
 * @param {string} model
 */
function getVoiceCapability (providerId, model) {
  const safeProviderId = safeString(providerId, 128)
  const safeModel = safeString(model, 128)
  if (!safeProviderId || !safeModel) {
    return unsupportedCapability(providerId, model, 'invalid_provider_or_model')
  }

  const providerCapabilities = PROVIDER_MODEL_CAPABILITIES[safeProviderId]
  if (!providerCapabilities) return unsupportedCapability(safeProviderId, safeModel, 'provider_not_whitelisted')
  const capability = providerCapabilities[safeModel]
  if (!capability) return unsupportedCapability(safeProviderId, safeModel, 'model_not_whitelisted')

  return {
    providerId: safeProviderId,
    model: safeModel,
    type: capability.type,
    canListVoices: capability.canListVoices,
    defaultVoiceId: capability.defaultVoiceId,
    clone: cloneCapability(capability.clone),
    reason: capability.canListVoices ? null : 'adapter_list_voices_not_available',
  }
}

function firstString (record, fields, maxLength) {
  for (const field of fields) {
    const value = safeString(record[field], maxLength)
    if (value) return value
  }
  return null
}

/**
 * Clone 文件永远不经 IPC 或 settings 存放字节。若未来 adapter 返回一个已受控
 * 的本地路径，只接受 voice-clones/ 下的相对文件名。
 */
function normalizeClonePath (value) {
  const raw = safeString(value, 512)
  if (!raw) return null
  const normalized = raw.replace(/\\/g, '/')
  if (!normalized.startsWith('voice-clones/') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  if (!/^[a-zA-Z0-9._/-]+$/.test(normalized)) return null
  return normalized
}

/**
 * 将 adapter 返回结果收敛成可安全持久化和显示的最小元数据。
 * @param {unknown[]} rawVoices
 * @param {{source?: string}} [options]
 */
function normalizeVoiceList (rawVoices, options = {}) {
  if (!Array.isArray(rawVoices)) return []
  const source = normalizeSource(options.source)
  const seenIds = new Set()
  const voices = []

  for (const rawVoice of rawVoices) {
    let id = null
    let name = null
    let clonePath = null

    if (typeof rawVoice === 'string') {
      id = safeString(rawVoice, MAX_VOICE_ID_LENGTH)
      name = id
    } else if (rawVoice && typeof rawVoice === 'object' && !Array.isArray(rawVoice)) {
      /** @type {{id?: unknown, voice_id?: unknown, voiceId?: unknown, name?: unknown, display_name?: unknown, displayName?: unknown, voice_name?: unknown, clonePath?: unknown, clone_path?: unknown}} */
      const rawRecord = rawVoice
      id = firstString(rawRecord, ['id', 'voice_id', 'voiceId', 'name'], MAX_VOICE_ID_LENGTH)
      name = firstString(rawRecord, ['name', 'display_name', 'displayName', 'voice_name', 'id', 'voice_id'], MAX_VOICE_NAME_LENGTH) || id
      clonePath = normalizeClonePath(rawRecord.clonePath || rawRecord.clone_path)
    }

    if (!id || !name || seenIds.has(id)) continue
    seenIds.add(id)
    const voice = { id, name, source }
    if (clonePath) voice.clonePath = clonePath
    voices.push(voice)
  }

  return voices
}

function isSafeCatalogVoice (voice) {
  if (!voice || typeof voice !== 'object' || Array.isArray(voice)) return false
  const allowed = new Set(['id', 'name', 'source', 'clonePath'])
  if (Object.keys(voice).some((key) => !allowed.has(key))) return false
  const normalized = normalizeVoiceList([voice], { source: voice.source })
  return normalized.length === 1 && normalized[0].id === voice.id && normalized[0].name === voice.name &&
    normalized[0].source === voice.source && normalized[0].clonePath === voice.clonePath
}

module.exports = {
  CAPABILITY_TYPES,
  PROVIDER_MODEL_CAPABILITIES,
  getVoiceCapability,
  normalizeVoiceList,
  normalizeClonePath,
  isSafeCatalogVoice,
}
