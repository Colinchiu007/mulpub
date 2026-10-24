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
  // change: hifly-voice-edit-ui —— 带上参数，供面板回显当前值
  return {
    id,
    name,
    invalid: voice.invalid === true,
    ...(voice.params && typeof voice.params === 'object' ? { params: { ...voice.params } } : {}),
  }
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

/**
 * 把主进程错误 message 映射为用户可读文案。
 *
 * @param {string} message 原始 message（可能含错误码）
 * @param {object} [options] 选项对象（刻意不用位置布尔参数 —— 漏传会**静默退回**「恒有兜底」
 *   的旧行为，那正是两个兜底键变成死代码的成因；具名参数让每个意图显式、可扩展）
 * @param {boolean} [options.allowUnmapped=true] 未知错误码时的行为：
 *   true  ⇒ 返回 catalogLoadFailed（「语音列表加载失败」），适合「我只想要一句通用提示」的调用点；
 *   false ⇒ 返回空串，让调用点的 `|| 自有兜底` 真正生效
 *            （否则本函数恒返回非空，右侧兜底永不可达）。
 * @returns {string}
 */
function friendlyVoiceCatalogError(message, options = {}) {
  const allowUnmapped = options?.allowUnmapped !== false
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
  // 未知错误码：默认返回 catalogLoadFailed（调用方多数只想要「列表加载失败」这一句）。
  // 但调用点若要落到**自己的**兜底文案（如「默认音色保存失败」），必须传
  // allowUnmapped=false —— 否则本函数恒返回非空串，`friendlyVoiceCatalogError(m) || 自有兜底`
  // 的右侧永远不可达（2026-10-20 CCG 深度审查 i1：旧代码正是这样把两个兜底键变成死代码的）。
  if (allowUnmapped === false) return ''
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

/**
 * 显式选择音色（下拉切换或克隆列表「设为默认」）并持久化偏好。
 *
 * @param {string} [voiceId] 目标音色 ID；缺省取当前 s2vConfig.voiceId
 * @param {object} [options] 选项对象（刻意不用位置布尔/字符串参数 —— 位置参数漏传会
 *   **静默退回**有缺陷的旧行为，正是本次 R1 的成因；选项对象让每个意图都具名、可扩展）
 * @param {string} [options.rollbackVoiceId] 持久化失败时的回滚锚点。调用方若在进入本函数
 *   **之前**已先把 voiceId 写进 s2vConfig（克隆成功后的自动切换就是这样），**必须**显式传入
 *   切换前的值；否则内部以「进入时的 voiceId」为锚点，而该值已被调用方改写成目标 id
 *   ⇒ 回滚写回同一个 id，成为空操作，下拉会停留在一个从未保存成功的音色上。
 *   **缺省时不传锚点** ⇒ 锚点 = 进入时的 s2vConfig.voiceId（旧行为，仅供未预写 voiceId 的调用方）。
 * @returns {Promise<boolean>} 偏好是否已持久化
 */
async function selectS2VVoice(voiceId, options = {}) {
  const rollbackVoiceId = options?.rollbackVoiceId
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
      // 先映射已知错误码；映射不到才落到「恢复默认音色失败」。
      // 第二个参数 false 是**必需的**：friendlyVoiceCatalogError 默认对未知码返回非空的
      // catalogLoadFailed，不传 false 则右侧兜底永不可达（旧代码正是这样把
      // defaultVoiceRestoreFailed 变成死代码，用户把「恢复默认失败」看成「列表加载失败」）。
      state.s2vVoiceCatalogError = friendlyVoiceCatalogError(result?.message, { allowUnmapped: false })
        || d.t('create.story2video.voice.defaultVoiceRestoreFailed')
      return false
    }
    const selectedVoiceId = typeof result.data?.selectedVoiceId === 'string' ? result.data.selectedVoiceId : ''
    d.getS2vConfig().voiceId = selectedVoiceId
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
  // 回滚锚点取显式入参（调用方已预写 voiceId 的场景），否则取进入时的值（旧行为）。
  const previousVoiceId = rollbackVoiceId !== undefined ? rollbackVoiceId : d.getS2vConfig().voiceId
  d.getS2vConfig().voiceId = normalizedVoiceId

  const requestId = ++state.s2vVoiceSelectionRequestId
  const result = await selectTtsVoice(d.cloneForIpc({ ...selectContext, voiceId: normalizedVoiceId }))
  if (!isCurrentS2VVoiceSelectionRequest(requestId, selectContext, normalizedVoiceId)) return false
  if (result?.code !== 0) {
    // 保存失败：回滚下拉与徽标，避免显示一个从未持久化的「默认」音色
    d.getS2vConfig().voiceId = previousVoiceId
    // 先映射已知错误码；映射不到才落到「默认音色保存失败」（第二个参数 false 的理由见 clear 分支）
    state.s2vVoiceCatalogError = friendlyVoiceCatalogError(result?.message, { allowUnmapped: false })
      || d.t('create.story2video.voice.selectionSaveFailed')
    return false
  }
  // 注：这里原有 `state.s2vPersistedVoiceId = result.data.selectedVoiceId ?? normalizedVoiceId`，
  // 记录主进程归一后的 id。该 ref 是 s2vConfig.voiceId 的冗余镜像、生产零读取（2026-10-20 清理）。
  // ⚠ 若将来真的需要「主进程归一后的 id」（它可能与本地传入值不同），正解是把它**回写
  // s2vConfig.voiceId**（让权威来源与显示同步），而不是再存一份没人读的镜像。
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
