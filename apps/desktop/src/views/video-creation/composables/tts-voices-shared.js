/**
 * tts-voices-shared —— TTS 音色域共享操作层
 *
 * 归属理由：目录侧与克隆侧都要调用（例如克隆新增后要「选中该音色」、删除后要「回退到可用音色」），
 * 放在任一上层模块都会形成循环依赖，故沉到本层。
 */
import {
  state,
  requireDeps,
  getS2VVoiceProvider,
  resolveVoiceModelForProvider,
  s2vVoiceProviderOptions,
  s2vVoiceCatalogRefreshable,
  s2vVoiceModelHidden,
  s2vVoiceContextModel,
  s2vVoiceOptions,
} from './tts-voices-state'
import { selectTtsVoice, clearTtsVoicePreference } from '@/api/tts-voice-catalog'
import { formatUserError } from '@/utils/user-facing-error'

function getS2VVoiceContext() {
  const d = requireDeps()
  const providerId = typeof d.getS2vConfig().voiceProvider === 'string' ? d.getS2vConfig().voiceProvider.trim() : ''
  // 语音模型不再由用户选择（voice-model-program-resolved，2026-10-18）：
  // MiMo 走 tts/voiceclone 双模型分支（预置音色目录固定用 mimo-v2.5-tts）；
  // 其它 provider 一律按运营默许模型解析，**不读**用户可能陈旧的 s2vConfig.voiceModel。
  const model = s2vVoiceModelHidden.value
    ? 'mimo-v2.5-tts'
    : resolveVoiceModelForProvider(getS2VVoiceProvider(providerId))
  return providerId && model ? { providerId, model } : null
}

// MiMo TTS 克隆上下文：克隆 registry/偏好绑定在 voiceclone 模型下
function getS2VVoiceCloneContext() {
  const d = requireDeps()
  const context = getS2VVoiceContext()
  if (!context) return null
  return s2vVoiceModelHidden.value
    ? { providerId: context.providerId, model: 'mimo-v2.5-tts-voiceclone' }
    : context
}

function isCurrentS2VVoiceRequest(requestId, context) {
  const d = requireDeps()
  return requestId === state.s2vVoiceRequestId
    && d.getS2vConfig().voiceProvider === context.providerId
    && s2vVoiceContextModel.value === context.model
}

function isCurrentS2VVoiceCloneRequest(requestId, context) {
  const d = requireDeps()
  // MiMo TTS：克隆请求的 context.model 是 mimo-v2.5-tts-voiceclone（与 catalog 的 tts 模型不同）
  const expectedModel = s2vVoiceModelHidden.value ? 'mimo-v2.5-tts-voiceclone' : s2vVoiceContextModel.value
  return requestId === state.s2vVoiceCloneRequestId
    && d.getS2vConfig().voiceProvider === context.providerId
    && expectedModel === context.model
}

function isCurrentS2VVoiceSelectionRequest(requestId, context, voiceId) {
  const d = requireDeps()
  // MiMo TTS：克隆音色选择请求的 context.model 是 mimo-v2.5-tts-voiceclone
  const expectedModel = s2vVoiceModelHidden.value ? 'mimo-v2.5-tts-voiceclone' : s2vVoiceContextModel.value
  return requestId === state.s2vVoiceSelectionRequestId
    && d.getS2vConfig().voiceProvider === context.providerId
    && expectedModel === context.model
    && d.getS2vConfig().voiceId === voiceId
}

function toS2VVoiceOption(voice) {
  const d = requireDeps()
  const id = typeof voice?.id === 'string' ? voice.id.trim() : ''
  const name = typeof voice?.name === 'string' ? voice.name.trim() : ''
  if (!id || !name) return null
  return { id, name, invalid: voice.invalid === true }
}

function toS2VVoiceCloneRequirements(requirements) {
  const d = requireDeps()
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return null
  const toFiniteNumber = (value) => Number.isFinite(value) && value >= 0 ? value : null
  return {
    allowedExtensions: Array.isArray(requirements.allowedExtensions)
      ? requirements.allowedExtensions.filter(extension => typeof extension === 'string' && extension)
      : [],
    maxSampleCount: toFiniteNumber(requirements.maxSampleCount),
    maxSampleBytes: toFiniteNumber(requirements.maxSampleBytes),
    maxTotalBytes: toFiniteNumber(requirements.maxTotalBytes),
    minSampleDurationSeconds: toFiniteNumber(requirements.minSampleDurationSeconds) || 0,
    maxSampleDurationSeconds: toFiniteNumber(requirements.maxSampleDurationSeconds),
    maxTotalDurationSeconds: toFiniteNumber(requirements.maxTotalDurationSeconds),
  }
}

function friendlyVoiceCatalogError(message) {
  const d = requireDeps()
  const raw = String(message || '')
  const map = {
    VOICE_CATALOG_UNSUPPORTED: 'This voice model does not support voice lists or cloning yet. Using the default voice.',
    VOICE_CATALOG_CONFIG_UNAVAILABLE: 'The voice provider configuration is unavailable. Check it in model settings and retry.',
    VOICE_CATALOG_UNAVAILABLE: 'The voice list is temporarily unavailable. Using the default voice. Please try again later.',
    VOICE_MODEL_MISMATCH: 'The selected voice model does not match the configuration. Check the model settings.',
    VOICE_PREFERENCE_STORE_UNAVAILABLE: 'Voice preference storage is unavailable. Check local storage.',
    VOICE_OWNER_UNAVAILABLE: 'Sign-in state is unavailable. Sign in again and retry.',
    VOICE_NOT_IN_CATALOG: 'The selected voice is not in the current voice list. Select another voice.',
    VOICE_CLONE_SAMPLE_INVALID: 'The uploaded audio does not meet the requirements. Adjust format, duration, or size and retry.',
    VOICE_CLONE_SAMPLE_DURATION_INVALID: 'The uploaded audio duration does not meet the requirements. Adjust the duration and retry.',
    VOICE_CLONE_SAMPLE_EXTENSION_UNSUPPORTED: 'The uploaded audio format is not supported. Use mp3, m4a, or wav.',
    VOICE_CLONE_SAMPLE_TOO_LARGE: 'The uploaded audio is too large. Compress it or use another file.',
    VOICE_CLONE_TOTAL_SIZE_EXCEEDED: 'The total audio size exceeds the limit. Remove files and retry.',
    VOICE_CLONE_TOTAL_DURATION_EXCEEDED: 'The total audio duration exceeds the limit. Remove files and retry.',
    VOICE_CLONE_PROVIDER_UNAVAILABLE: 'Voice cloning is temporarily unavailable. Please try again later.',
    VOICE_CLONE_UNAVAILABLE: 'Voice cloning is temporarily unavailable. Please try again later.',
    VOICE_CLONE_PLAN_UNSUPPORTED: 'Your MiniMax account cannot clone voices: note that MiniMax voice cloning requires a separate 9.9 CNY purchase per voice and is not covered by subscription plans. Purchase it on the MiniMax platform and retry, or use a built-in voice or another provider.',
    VOICE_CLONE_UNSUPPORTED: 'This voice model does not support voice cloning yet. Using the default voice.',
    VOICE_CLONE_DIALOG_UNAVAILABLE: 'Could not open the audio file picker. Please try again.',
    VOICE_CLONE_DUPLICATE_ID: 'A cloned voice with this name already exists. Use another name.',
    VOICE_CLONE_MODEL_MISMATCH: 'The selected voice model does not match the clone configuration. Check the model settings.',
    VOICE_CLONE_NOT_FOUND: 'The cloned voice was not found. Select it again.',
    VOICE_CLONE_REGISTRY_INVALID: 'The local clone voice record is invalid. Select the audio file again and retry.',
    VOICE_CLONE_ROLLBACK_REQUIRED: 'The clone voice save did not finish. Select the audio file again and retry.',
    VOICE_CLONE_SELECTION_UNAVAILABLE: 'Audio sample staging is unavailable. Select the audio file again.',
    VOICE_CLONE_STORE_UNAVAILABLE: 'Clone voice storage is unavailable. Check disk space and retry.',
    VOICE_CLONE_STORAGE_UNAVAILABLE: 'Clone voice storage is unavailable. Check disk space and retry.',
    VOICE_CLONE_INVALID_ARGUMENTS: 'Invalid clone voice parameters. Select the audio file again.',
  }
  const found = Object.entries(map).find(([key]) => raw.includes(key))
  // 英文兜底（ASCII）仅用于「键缺失」的防御路径；键存在时一律取 locale 值（zh/en 成对）
  if (found) return d.translate('create.story2video.voice.' + found[0], found[1], found[1])
  // 不向用户泄露系统技术错误码
  const generic = 'The voice list could not be loaded. Using the default voice. Please try again later.'
  return d.translate('create.story2video.voice.catalogLoadFailed', generic, generic)
}

function s2vVoiceCloneHint() {
  const d = requireDeps()
  const r = state.s2vVoiceCloneRequirements
  if (!r) return ''
  const parts = []
  if (Array.isArray(r.allowedExtensions) && r.allowedExtensions.length > 0) {
    const extText = r.allowedExtensions.map(ext => String(ext).replace(/^\./, '')).join('、')
    parts.push(d.t('create.story2video.voice.cloneHintFormat', { extensions: extText }))
  }
  if (r.minSampleDurationSeconds > 0 && r.maxSampleDurationSeconds > 0) {
    const maxMinutes = Math.round(r.maxSampleDurationSeconds / 60)
    parts.push(d.t('create.story2video.voice.cloneHintMinDuration', { seconds: r.minSampleDurationSeconds, minutes: maxMinutes }))
  } else if (r.maxSampleDurationSeconds > 0) {
    parts.push(d.t('create.story2video.voice.cloneHintMaxDuration', { duration: formatS2VVoiceCloneDuration(r.maxSampleDurationSeconds) }))
  }
  if (r.maxSampleBytes > 0) {
    parts.push(d.t('create.story2video.voice.cloneHintMaxSize', { size: formatS2VVoiceCloneBytes(r.maxSampleBytes) }))
  }
  return parts.length > 0 ? parts.join('；') + '。' : ''
}

function nextS2VVoiceCloneName() {
  const d = requireDeps()
  // 自动克隆默认名「音色XXX」：以「当前克隆数量」与「现有最大音色序号」较大者 +1（3 位零填充）。
  // - 首个克隆为 音色001；按创建顺序递增 音色002/003…，重命名后不回退旧序号；
  // - 用户手动命名为 音色100 后，下一个自动名继续用 音色101。
  // 序号用 BigInt 解析/比较，避免超长数字名（如 128 位）经 Number 转浮点后污染名称。
  const clones = Array.isArray(state.s2vVoiceClones) ? state.s2vVoiceClones : []
  const cloneNamePrefix = d.t('create.story2video.voice.cloneNamePrefix')
  const escapedNamePrefix = cloneNamePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const cloneNamePattern = new RegExp('^' + escapedNamePrefix + '(\\d+)$')
  let maxIndex = 0n
  for (const voice of clones) {
    const match = cloneNamePattern.exec(String(voice?.name || '').trim())
    if (match) {
      try {
        const index = BigInt(match[1])
        if (index > maxIndex) maxIndex = index
      } catch (_) { /* 非数字忽略 */ }
    }
  }
  const count = BigInt(clones.length)
  const nextIndex = (count > maxIndex ? count : maxIndex) + 1n
  return cloneNamePrefix + String(nextIndex).padStart(3, '0')
}

function formatS2VVoiceCloneBytes(value) {
  const d = requireDeps()
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(value % (1024 * 1024) === 0 ? 0 : 1)} MB`
}

function formatS2VVoiceCloneDuration(value) {
  const d = requireDeps()
  if (!Number.isFinite(value) || value < 0) return '—'
  const seconds = Math.floor(value)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes <= 0) return d.t('create.story2video.voice.durationSeconds', { seconds })
  if (!remainingSeconds) return d.t('create.story2video.voice.durationMinutes', { minutes })
  return d.t('create.story2video.voice.durationMinutesSeconds', { minutes, seconds: remainingSeconds })
}

async function selectS2VVoice(voiceId) {
  const d = requireDeps()
  if (voiceId === undefined) voiceId = d.getS2vConfig().voiceId
  const context = getS2VVoiceContext()
  // MiMo TTS：克隆音色的偏好持久化到 voiceclone 模型下（与克隆 registry 同键域）
  const selectContext = s2vVoiceModelHidden.value && typeof voiceId === 'string' && voiceId.startsWith('mimo-clone-')
    ? { providerId: context?.providerId, model: 'mimo-v2.5-tts-voiceclone' }
    : context
  const normalizedVoiceId = typeof voiceId === 'string' ? voiceId.trim() : ''
  if (!selectContext) return false
  if (!normalizedVoiceId) {
    const requestId = ++state.s2vVoiceSelectionRequestId
    const result = await clearTtsVoicePreference(d.cloneForIpc(selectContext))
    if (!isCurrentS2VVoiceSelectionRequest(requestId, selectContext, d.getS2vConfig().voiceId)) return false
    if (result?.code !== 0) {
      state.s2vVoiceCatalogError = friendlyVoiceCatalogError(result?.message) || formatUserError(result, { fallback: d.t('create.story2video.voice.catalogFetchFailed') }).message
        ? friendlyVoiceCatalogError(result?.message)
        : d.t('create.story2video.voice.defaultVoiceRestoreFailed')
      return false
    }
    const selectedVoiceId = typeof result.data?.selectedVoiceId === 'string' ? result.data.selectedVoiceId : ''
    d.getS2vConfig().voiceId = selectedVoiceId
    state.s2vPersistedVoiceId = selectedVoiceId
    state.s2vVoiceCatalogError = ''
    return true
  }
  if (!s2vVoiceOptions.value.some(voice => voice.id === normalizedVoiceId)) {
    state.s2vVoiceCatalogError = d.t('create.story2video.voice.selectionNotInCatalog')
    return false
  }
  // 显式选择（下拉或克隆列表「设为默认」）先同步下拉框与配置：
  // 1) 让 isCurrentS2VVoiceSelectionRequest 并发守卫命中本次请求（否则结果被静默丢弃）；
  // 2) 让下拉框与克隆行「默认」徽标立即反映本次选择。
  const previousVoiceId = d.getS2vConfig().voiceId
  d.getS2vConfig().voiceId = normalizedVoiceId

  const requestId = ++state.s2vVoiceSelectionRequestId
  const result = await selectTtsVoice(d.cloneForIpc({ ...selectContext, voiceId: normalizedVoiceId }))
  if (!isCurrentS2VVoiceSelectionRequest(requestId, selectContext, normalizedVoiceId)) return false
  if (result?.code !== 0) {
    // 保存失败：回滚下拉与徽标，避免显示一个从未持久化的「默认」音色
    d.getS2vConfig().voiceId = previousVoiceId
    state.s2vVoiceCatalogError = friendlyVoiceCatalogError(result?.message) || formatUserError(result, { fallback: d.t('create.story2video.voice.catalogFetchFailed') }).message
      ? friendlyVoiceCatalogError(result?.message)
      : d.t('create.story2video.voice.selectionSaveFailed')
    return false
  }
  state.s2vPersistedVoiceId = typeof result.data?.selectedVoiceId === 'string'
    ? result.data.selectedVoiceId
    : normalizedVoiceId
  state.s2vVoiceCatalogError = ''
  return true
}

export {
  getS2VVoiceProvider,
  getS2VVoiceContext,
  getS2VVoiceCloneContext,
  isCurrentS2VVoiceRequest,
  isCurrentS2VVoiceCloneRequest,
  isCurrentS2VVoiceSelectionRequest,
  toS2VVoiceOption,
  toS2VVoiceCloneRequirements,
  friendlyVoiceCatalogError,
  s2vVoiceCloneHint,
  nextS2VVoiceCloneName,
  formatS2VVoiceCloneBytes,
  formatS2VVoiceCloneDuration,
  selectS2VVoice,
}
