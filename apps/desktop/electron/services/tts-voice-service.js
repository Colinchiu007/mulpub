// @ts-check
'use strict'

const {
  CAPABILITY_TYPES,
  getVoiceCapability,
  normalizeVoiceList,
  isSafeCatalogVoice,
} = require('./tts-voice-catalog')
const defaultLogger = require('./logger')

const CATALOG_SCHEMA_VERSION = 2
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000
const MAX_IDENTIFIER_LENGTH = 128
const MAX_VOICE_ID_LENGTH = 256
const MAX_DETAIL_LENGTH = 200
const REDACTED_DETAIL = 'upstream-auth-error'

/**
 * 配置类失败判定（永久性问题，重试无效）：未配置/无效 API Key、服务商/适配器缺失、
 * 适配器初始化失败、认证失败。不包含「模型服务尚未初始化」（瞬时，可重试）。
 * 以 callAdapter 的稳定 message 关键词为准，避免依赖其内部错误对象结构。
 */
const CONFIG_FAILURE_PATTERNS = [
  /尚未配置\s*API\s*Key/i,
  /API\s*Key\s*not\s*configured/i,
  /未找到服务商/i,
  /Provider\s+["'][^"']*["']\s+not\s+found/i,
  /未找到.*适配器/i,
  /No\s+adapter\s+registered/i,
  /适配器初始化失败/i,
  /Factory\s+initialization\s+failed/i,
  /\b401\b/i,
  /unauthorized/i,
  /invalid\s+api\s+key/i,
  /认证失败/i,
  /key\s+无效/i,
]

/** 方法/能力不支持：adapter 层 capability 不匹配（指引「暂不支持」而非「配置 API Key」） */
const UNSUPPORTED_FAILURE_PATTERNS = [
  /不支持该操作/i,
  /Method\s+["'][^"']*["']\s+not\s+supported/i,
  /not\s+supported/i,
]

/** 敏感模式：detail 只能回显分类短语，不得把 token/密钥原文带回 renderer */
const SENSITIVE_DETAIL_PATTERNS = [
  /Bearer\s+\S+/i,
  /authorization\s*[:=]/i,
  /(?:api[_-]?key|token|secret)\s*[:=]/i,
  /\bsk-[A-Za-z0-9._~-]{6,}/i,
]

function classifyCatalogFailure (message) {
  const raw = String(message || '')
  if (CONFIG_FAILURE_PATTERNS.some(pattern => pattern.test(raw))) return 'config'
  if (UNSUPPORTED_FAILURE_PATTERNS.some(pattern => pattern.test(raw))) return 'unsupported'
  return 'transient'
}

function catalogFailureCode (message) {
  const kind = classifyCatalogFailure(message)
  if (kind === 'config') return 'VOICE_CATALOG_CONFIG_UNAVAILABLE'
  if (kind === 'unsupported') return 'VOICE_CATALOG_UNSUPPORTED'
  return 'VOICE_CATALOG_UNAVAILABLE'
}

function redactFailureDetail (message) {
  const raw = String(message || '').trim()
  if (!raw) return ''
  if (SENSITIVE_DETAIL_PATTERNS.some(pattern => pattern.test(raw))) return REDACTED_DETAIL
  return raw.length > MAX_DETAIL_LENGTH ? raw.slice(0, MAX_DETAIL_LENGTH - 1) + '…' : raw
}

function catalogFailure (message, detail) {
  return { code: -1, message, data: { detail: redactFailureDetail(detail) } }
}

function safeIdentifier (value, maxLength = MAX_IDENTIFIER_LENGTH) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || !/^[a-zA-Z0-9._-]+$/.test(normalized)) return null
  return normalized
}

/**
 * voiceId 校验（比 providerId/model 宽松）：
 * 允许 MiniMax 系统音色 id（如 'Chinese (Mandarin)_Reliable_Executive'，含空格/括号）
 * 以及常规 ASCII id；仅拒绝控制字符、路径分隔符与遍历序列。
 * voiceId 只用于偏好持久化与传给 adapter 合成，不进入文件路径。
 */
function safeVoiceId (value, maxLength = MAX_VOICE_ID_LENGTH) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) return null
  if (Array.from(normalized).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })) return null
  if (normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) return null
  return normalized
}

function success (data) {
  return { code: 0, data }
}

function failure (message, data) {
  return data === undefined ? { code: -1, message } : { code: -1, message, data }
}

function catalogSettingKey (providerId, model) {
  return `tts-voice-catalog:v2:${providerId}:${model}`
}

function preferenceSettingKey (providerId, model) {
  return `tts-voice-preference:v1:${providerId}:${model}`
}

function copyVoice (voice) {
  const result = {
    id: voice.id,
    name: voice.name,
    source: voice.source,
  }
  if (voice.clonePath) result.clonePath = voice.clonePath
  return result
}

function copyCapability (capability) {
  return {
    providerId: capability.providerId,
    model: capability.model,
    type: capability.type,
    canListVoices: capability.canListVoices,
    defaultVoiceId: capability.defaultVoiceId,
    clone: { ...capability.clone },
    reason: capability.reason,
  }
}

function isSafeCatalogCache (value, providerId, model, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const allowed = new Set(['version', 'providerId', 'model', 'voices', 'refreshedAt', 'expiresAt'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  if (value.version !== CATALOG_SCHEMA_VERSION || value.providerId !== providerId || value.model !== model) return false
  if (!Number.isFinite(value.refreshedAt) || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) return false
  if (!Array.isArray(value.voices) || !value.voices.every(isSafeCatalogVoice)) return false
  return true
}

function isSafePreference (value, providerId, model, voiceIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const allowed = new Set(['providerId', 'model', 'voiceId', 'selectedAt'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  return value.providerId === providerId && value.model === model &&
    typeof value.voiceId === 'string' && voiceIds.has(value.voiceId) && Number.isFinite(value.selectedAt)
}

function defaultVoiceId (voices, capability) {
  if (capability.defaultVoiceId && voices.some((voice) => voice.id === capability.defaultVoiceId)) {
    return capability.defaultVoiceId
  }
  return voices[0] ? voices[0].id : null
}

class TtsVoiceService {
  /**
   * @param {{
   *   store?: {getUserSetting?: Function, setUserSetting?: Function, getOwnerSubject?: Function},
   *   modelProviderManager?: {callAdapter?: Function, getProvider?: Function},
   *   now?: () => number,
   *   cacheTtlMs?: number,
   *   cloneService?: {listClones?: Function},
   * }} deps
   */
  constructor (deps = {}) {
    this._store = deps.store || null
    this._modelProviderManager = deps.modelProviderManager || null
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now()
    this._cacheTtlMs = Number.isFinite(deps.cacheTtlMs) && deps.cacheTtlMs > 0
      ? deps.cacheTtlMs
      : DEFAULT_CACHE_TTL_MS
    this._cloneService = deps.cloneService || null
    this._logger = deps.logger || defaultLogger
  }

  _logCatalogFailure (request, detail) {
    if (!this._logger || typeof this._logger.warn !== 'function') return
    this._logger.warn(
      'tts-voice-catalog',
      `catalog failed providerId=${request.providerId} model=${request.model} detail=${redactFailureDetail(detail)}`,
    )
  }

  getCapability (input) {
    const request = this._normalizeRequest(input)
    if (!request) return failure('VOICE_CATALOG_INVALID_ARGUMENTS')
    return success(copyCapability(getVoiceCapability(request.providerId, request.model)))
  }

  async getCatalog (input) {
    const request = this._normalizeRequest(input)
    if (!request) return failure('VOICE_CATALOG_INVALID_ARGUMENTS')

    const ownerSubject = this._captureOwnerSubject()
    if (!ownerSubject) return failure('VOICE_OWNER_UNAVAILABLE')
    return this._getCatalog(request, ownerSubject)
  }

  async _getCatalog (request, ownerSubject) {

    const capability = getVoiceCapability(request.providerId, request.model)
    const unsupported = this._unsupportedResponse(capability)
    if (unsupported) return unsupported
    if (!this._hasUserSettings()) return failure('VOICE_PREFERENCE_STORE_UNAVAILABLE')
    if (!this._hasMatchingProvider(request.providerId, request.model)) return failure('VOICE_MODEL_MISMATCH')

    const now = this._now()
    const cacheKey = catalogSettingKey(request.providerId, request.model)
    let cached
    try {
      cached = this._store.getUserSetting(cacheKey, null, ownerSubject)
    } catch (_) {
      return failure('VOICE_PREFERENCE_STORE_UNAVAILABLE')
    }

    if (!request.refresh && isSafeCatalogCache(cached, request.providerId, request.model, now)) {
      return this._buildCatalogResponse(cached, capability, 'hit', ownerSubject)
    }

    const failWith = (message, detail) => {
      const result = catalogFailure(message, detail)
      this._logCatalogFailure(request, detail)
      return result
    }

    if (!this._modelProviderManager || typeof this._modelProviderManager.callAdapter !== 'function') {
      return failWith('VOICE_CATALOG_CONFIG_UNAVAILABLE', 'model provider manager is not available')
    }

    let adapterResult
    try {
      adapterResult = await this._modelProviderManager.callAdapter(
        request.providerId,
        'listVoices',
        { model: request.model },
      )
    } catch (error) {
      const underlying = error && error.message ? error.message : String(error)
      return failWith(catalogFailureCode(underlying), underlying)
    }

    if (!adapterResult || adapterResult.code !== 0 || !Array.isArray(adapterResult.data)) {
      const underlying = adapterResult && typeof adapterResult.message === 'string'
        ? adapterResult.message
        : 'empty or invalid adapter result'
      return failWith(catalogFailureCode(underlying), underlying)
    }

    const voices = normalizeVoiceList(adapterResult.data, { source: capability.type })
    const catalog = {
      version: CATALOG_SCHEMA_VERSION,
      providerId: request.providerId,
      model: request.model,
      voices,
      refreshedAt: now,
      expiresAt: now + this._cacheTtlMs,
    }
    try {
      this._store.setUserSetting(cacheKey, catalog, ownerSubject)
    } catch (_) {
      return failure('VOICE_PREFERENCE_STORE_UNAVAILABLE')
    }
    return this._buildCatalogResponse(catalog, capability, 'refreshed', ownerSubject)
  }

  async selectVoice (input) {
    const request = this._normalizeRequest(input, { requireVoiceId: true })
    if (!request) return failure('VOICE_CATALOG_INVALID_ARGUMENTS')

    const ownerSubject = this._captureOwnerSubject()
    if (!ownerSubject) return failure('VOICE_OWNER_UNAVAILABLE')

    const capability = getVoiceCapability(request.providerId, request.model)
    if (capability.reason === 'model_not_whitelisted') return failure('VOICE_MODEL_MISMATCH')
    const unsupported = this._unsupportedResponse(capability)
    if (unsupported) return unsupported

    const catalogResult = await this._getCatalog({
      providerId: request.providerId,
      model: request.model,
      refresh: false,
    }, ownerSubject)
    if (catalogResult.code !== 0) return catalogResult

    const voiceExists = catalogResult.data.voices.some((voice) => voice.id === request.voiceId)
    if (!voiceExists) return failure('VOICE_NOT_IN_CATALOG')
    try {
      this._store.setUserSetting(preferenceSettingKey(request.providerId, request.model), {
        providerId: request.providerId,
        model: request.model,
        voiceId: request.voiceId,
        selectedAt: this._now(),
      }, ownerSubject)
    } catch (_) {
      return failure('VOICE_PREFERENCE_STORE_UNAVAILABLE')
    }

    return success({
      ...catalogResult.data,
      selectedVoiceId: request.voiceId,
      preference: 'saved',
    })
  }

  async clearVoicePreference (input) {
    const request = this._normalizeRequest(input)
    if (!request) return failure('VOICE_CATALOG_INVALID_ARGUMENTS')
    const ownerSubject = this._captureOwnerSubject()
    if (!ownerSubject) return failure('VOICE_OWNER_UNAVAILABLE')
    const capability = getVoiceCapability(request.providerId, request.model)
    const unsupported = this._unsupportedResponse(capability)
    if (unsupported) return unsupported
    const catalogResult = await this._getCatalog(request, ownerSubject)
    if (catalogResult.code !== 0) return catalogResult
    try {
      this._store.setUserSetting(preferenceSettingKey(request.providerId, request.model), null, ownerSubject)
      // MiMo TTS：克隆音色偏好保存在 voiceclone 模型下，一并清除
      if (request.providerId === 'mimo-tts') {
        this._store.setUserSetting(preferenceSettingKey(request.providerId, 'mimo-v2.5-tts-voiceclone'), null, ownerSubject)
      }
    } catch (_) {
      return failure('VOICE_PREFERENCE_STORE_UNAVAILABLE')
    }
    return success({ ...catalogResult.data, selectedVoiceId: defaultVoiceId(catalogResult.data.voices, capability), preference: 'cleared' })
  }
  _normalizeRequest (input, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    const providerId = safeIdentifier(input.providerId)
    const model = safeIdentifier(input.model)
    if (!providerId || !model) return null
    if (input.refresh !== undefined && typeof input.refresh !== 'boolean') return null
    const request = { providerId, model, refresh: input.refresh === true }
    if (options.requireVoiceId) {
      const voiceId = safeVoiceId(input.voiceId, MAX_VOICE_ID_LENGTH)
      if (!voiceId) return null
      request.voiceId = voiceId
    }
    return request
  }

  _hasUserSettings () {
    return Boolean(this._store) && typeof this._store.getUserSetting === 'function' &&
      typeof this._store.setUserSetting === 'function'
  }

  _captureOwnerSubject () {
    if (!this._store || typeof this._store.getOwnerSubject !== 'function') return null
    try {
      const ownerSubject = this._store.getOwnerSubject()
      return typeof ownerSubject === 'string' && ownerSubject ? ownerSubject : null
    } catch (_) {
      return null
    }
  }

  _hasMatchingProvider (providerId, model) {
    if (!this._modelProviderManager || typeof this._modelProviderManager.getProvider !== 'function') return true
    try {
      const provider = this._modelProviderManager.getProvider(providerId)
      if (!provider) return false
      // 多模态模型（category=multimodal）在能力选择器中同样承担 TTS 角色：必须声明支持 tts 能力。
      if (provider.category === 'multimodal') {
        const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : []
        if (!capabilities.includes('tts')) return false
      } else if (provider.category && provider.category !== 'tts') {
        return false
      }
      // 模型匹配：multimodal 的 capability_models.tts 与 models 都算数（避免只列 models 时漏判默认 TTS 模型）。
      const models = new Set(Array.isArray(provider.models) ? provider.models.filter(m => typeof m === 'string') : [])
      if (provider.capability_models && typeof provider.capability_models === 'object' && typeof provider.capability_models.tts === 'string') {
        models.add(provider.capability_models.tts)
      }
      if (models.size === 0) return true
      return models.has(model)
    } catch (_) {
      return false
    }
  }

  _unsupportedResponse (capability) {
    if (capability.canListVoices) return null
    if (capability.reason === 'model_not_whitelisted') return failure('VOICE_MODEL_MISMATCH')
    return failure('VOICE_CATALOG_UNSUPPORTED', { capability: copyCapability(capability) })
  }

  async _buildCatalogResponse (catalog, capability, cache, ownerSubject) {
    const voices = catalog.voices.map(copyVoice)
    const invalidVoices = []
    if (this._cloneService && typeof this._cloneService.listClones === 'function') {
      try {
        // MiMo TTS：克隆 registry 绑定在 mimo-v2.5-tts-voiceclone 模型下
        // （catalog 请求模型是 mimo-v2.5-tts 预置音色，但克隆音色由 voiceclone 模型管理）
        const cloneModel = catalog.providerId === 'mimo-tts' ? 'mimo-v2.5-tts-voiceclone' : catalog.model
        const clones = await this._cloneService.listClones({ providerId: catalog.providerId, model: cloneModel })
        if (clones?.code === 0 && Array.isArray(clones.data?.voices)) {
          for (const clone of clones.data.voices) {
            if (clone?.source !== CAPABILITY_TYPES.USER_CLONE || typeof clone.id !== 'string' || typeof clone.name !== 'string') continue
            // 克隆音色 voice_id 不合法（如旧版生成的 "01"）：不进入可选项，偏好自动回退默认音色，
            // 避免合成被平台拒绝（MiniMax "invalid params, voice id wrong"）；以 invalidVoices 供前端提示。
            if (clone.invalid === true) {
              invalidVoices.push({ id: clone.id, name: clone.name, source: CAPABILITY_TYPES.USER_CLONE, invalid: true })
              continue
            }
            if (!voices.some((voice) => voice.id === clone.id)) voices.push({ id: clone.id, name: clone.name, source: CAPABILITY_TYPES.USER_CLONE })
          }
        }
      } catch (_) { void 0 }
    }
    const voiceIds = new Set(voices.map((voice) => voice.id))
    let preference
    try {
      // MiMo TTS：预置音色偏好存 tts 键，克隆音色偏好存 voiceclone 键，两者都读取
      if (catalog.providerId === 'mimo-tts') {
        preference = this._store.getUserSetting(preferenceSettingKey(catalog.providerId, 'mimo-v2.5-tts'), null, ownerSubject)
          || this._store.getUserSetting(preferenceSettingKey(catalog.providerId, 'mimo-v2.5-tts-voiceclone'), null, ownerSubject)
      } else {
        preference = this._store.getUserSetting(preferenceSettingKey(catalog.providerId, catalog.model), null, ownerSubject)
      }
    } catch (_) {
      return failure('VOICE_PREFERENCE_STORE_UNAVAILABLE')
    }

    let selectedVoiceId
    // MiMo TTS：偏好可能来自 tts 或 voiceclone 键，校验时按实际来源的 model
    const preferenceModel = catalog.providerId === 'mimo-tts'
      ? (isSafePreference(preference, catalog.providerId, 'mimo-v2.5-tts', voiceIds)
        ? 'mimo-v2.5-tts'
        : 'mimo-v2.5-tts-voiceclone')
      : catalog.model
    if (isSafePreference(preference, catalog.providerId, preferenceModel, voiceIds)) {
      selectedVoiceId = preference.voiceId
    } else {
      selectedVoiceId = defaultVoiceId(voices, capability)
      if (selectedVoiceId && preference !== null && preference !== undefined) {
        try {
          this._store.setUserSetting(preferenceSettingKey(catalog.providerId, preferenceModel), {
            providerId: catalog.providerId,
            model: preferenceModel,
            voiceId: selectedVoiceId,
            selectedAt: this._now(),
          }, ownerSubject)
        } catch (_) {
          return failure('VOICE_PREFERENCE_STORE_UNAVAILABLE')
        }
      }
    }

    return success({
      providerId: catalog.providerId,
      model: catalog.model,
      voices,
      invalidVoices,
      selectedVoiceId,
      refreshedAt: catalog.refreshedAt,
      expiresAt: catalog.expiresAt,
      cache,
      capability: copyCapability(capability),
    })
  }
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  DEFAULT_CACHE_TTL_MS,
  catalogSettingKey,
  preferenceSettingKey,
  TtsVoiceService,
  classifyCatalogFailure,
  catalogFailureCode,
  redactFailureDetail,
}
