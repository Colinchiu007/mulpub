/**
 * useTtsVoices —— TTS 音色域门面（CreateView 拆分第 2 步，方案 v3 §2.2）
 *
 * 本文件是壳的唯一接入点：负责音色目录加载、服务商/模型切换与音色选择，并把同族模块
 * （tts-voices-state / tts-voices-shared / tts-voices-clone）的导出汇总为壳所需的四件套：
 * refs / computeds / methods / setup+reset。端到端契约见 01-docs/PRD.md 同名附录。
 */
import {
  state,
  requireDeps,
  setupTtsVoicesDeps,
  resetTtsVoicesForTest,
  ttsVoicesRefs,
  ttsVoicesComputeds,
  getS2VVoiceProvider,
  getS2VDefaultVoiceModel,
  s2vVoiceProviderOptions,
  s2vVoiceCatalogRefreshable,
  s2vVoiceModelHidden,
  s2vVoiceContextModel,
  s2vVoiceOptions,
} from './tts-voices-state'
import {
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
} from './tts-voices-shared'
import {
  chooseS2VVoiceCloneSamples,
  addS2VVoiceClone,
  s2vVoiceCloneStatusText,
  deleteS2VVoiceClone,
  startS2VVoiceCloneRename,
  cancelS2VVoiceCloneRename,
  renameS2VVoiceClone,
} from './tts-voices-clone'
import {
  getTtsVoiceCatalog,
  getTtsVoiceCapability,
} from '@/api/tts-voice-catalog'
import {
  getTtsVoiceCloneRequirements,
  listTtsVoiceClones,
} from '@/api/tts-voice-clone'

function resetS2VVoiceData() {
  const d = requireDeps()
  state.s2vVoiceCatalog = []
  state.s2vVoiceCatalogLoading = false
  state.s2vVoiceCatalogError = ''
  state.s2vVoiceCatalogErrorCode = ''
  state.s2vVoiceCapability = null
  state.s2vPersistedVoiceId = ''
  state.s2vVoiceCloneRequirements = null
  state.s2vVoiceClones = []
  state.s2vVoiceCloneSelection = null
  state.s2vVoiceClonePending = null
  state.s2vVoiceCloneLoading = false
  state.s2vVoiceCloneError = ''
  state.s2vVoiceCloneRenamingId = ''
  state.s2vVoiceCloneRenameDraft = ''
}

async function loadS2VVoiceData(options = {}) {
  const d = requireDeps()
  // 卸载守卫：弹窗关闭触发的语音目录/能力重载可能跨越组件卸载（2026-08-12 复审 I1）
  if (d.isAlive() === false) return
  const context = getS2VVoiceContext()
  const requestId = ++state.s2vVoiceRequestId
  state.s2vVoiceSelectionRequestId += 1
  state.s2vVoiceCloneRequestId += 1
  resetS2VVoiceData()
  if (!context) return

  state.s2vVoiceCatalogLoading = true
  const catalogInput = d.cloneForIpc({ ...context, refresh: options.refresh === true })
  // MiMo TTS：catalog 用 mimo-v2.5-tts（预置音色），capability/克隆用 mimo-v2.5-tts-voiceclone
  // （音色复刻能力由 voiceclone 模型声明）。语音模型下拉隐藏，模型由音色类型区分。
  const cloneContext = s2vVoiceModelHidden.value
    ? { providerId: context.providerId, model: 'mimo-v2.5-tts-voiceclone' }
    : context
  const [catalogResult, capabilityResult] = await Promise.allSettled([
    getTtsVoiceCatalog(catalogInput),
    getTtsVoiceCapability(d.cloneForIpc(cloneContext)),
  ])
  if (!isCurrentS2VVoiceRequest(requestId, context)) return

  const catalogResponse = catalogResult.status === 'fulfilled' ? catalogResult.value : null
  const capabilityResponse = capabilityResult.status === 'fulfilled' ? capabilityResult.value : null
  const catalogData = catalogResponse?.code === 0 && catalogResponse.data && typeof catalogResponse.data === 'object'
    ? catalogResponse.data
    : null
  const capabilityData = capabilityResponse?.code === 0 && capabilityResponse.data && typeof capabilityResponse.data === 'object'
    ? capabilityResponse.data
    : null
  state.s2vVoiceCatalog = [
    ...(Array.isArray(catalogData?.voices) ? catalogData.voices.map(voice => toS2VVoiceOption(voice)).filter(Boolean) : []),
    // 失效克隆音色（如旧版生成的非法 voice_id）：仅展示提示，不可选择
    ...(Array.isArray(catalogData?.invalidVoices) ? catalogData.invalidVoices.map(voice => toS2VVoiceOption(voice)).filter(Boolean) : []),
  ]
  state.s2vVoiceCapability = capabilityData
    ? {
        type: capabilityData.type,
        clone: { enabled: capabilityData.clone?.enabled === true },
      }
    : null
  state.s2vVoiceCatalogLoading = false
  state.s2vVoiceCatalogErrorCode = catalogData ? '' : String(catalogResponse?.message || '')
  if (!catalogData) {
    state.s2vVoiceCatalogError = friendlyVoiceCatalogError(catalogResponse?.message)
  }

  const cloneEnabled = state.s2vVoiceCapability?.type === 'user_clone'
    && state.s2vVoiceCapability?.clone?.enabled === true
  if (cloneEnabled) {
    const cloneRequestId = ++state.s2vVoiceCloneRequestId
    state.s2vVoiceCloneLoading = true
    const [requirementsResult, clonesResult] = await Promise.allSettled([
      getTtsVoiceCloneRequirements(d.cloneForIpc(cloneContext)),
      listTtsVoiceClones(d.cloneForIpc(cloneContext)),
    ])
    if (!isCurrentS2VVoiceRequest(requestId, context)
      || !isCurrentS2VVoiceCloneRequest(cloneRequestId, cloneContext)) return

    const requirementsResponse = requirementsResult.status === 'fulfilled' ? requirementsResult.value : null
    const clonesResponse = clonesResult.status === 'fulfilled' ? clonesResult.value : null
    state.s2vVoiceCloneRequirements = requirementsResponse?.code === 0
      ? toS2VVoiceCloneRequirements(requirementsResponse.data)
      : null
    state.s2vVoiceClones = clonesResponse?.code === 0 && Array.isArray(clonesResponse.data?.voices)
      ? clonesResponse.data.voices.map(voice => toS2VVoiceOption(voice)).filter(Boolean)
      : []
    state.s2vVoiceCloneError = requirementsResponse?.code === 0 && clonesResponse?.code === 0
      ? ''
      : (requirementsResponse?.message || clonesResponse?.message || d.t('create.story2video.voice.cloneInfoUnavailable'))
    state.s2vVoiceCloneLoading = false
  }

  if (!isCurrentS2VVoiceRequest(requestId, context)) return
  const selectedVoiceId = typeof catalogData?.selectedVoiceId === 'string' ? catalogData.selectedVoiceId : ''
  const configuredVoiceId = typeof d.getS2vConfig().voiceId === 'string' ? d.getS2vConfig().voiceId : ''
  const availableVoiceIds = new Set(s2vVoiceOptions.value.map(voice => voice.id))
  if (selectedVoiceId && availableVoiceIds.has(selectedVoiceId)) {
    d.getS2vConfig().voiceId = selectedVoiceId
    state.s2vPersistedVoiceId = selectedVoiceId
  } else if (configuredVoiceId && availableVoiceIds.has(configuredVoiceId)) {
    state.s2vPersistedVoiceId = configuredVoiceId
  } else {
    d.getS2vConfig().voiceId = ''
  }
}

async function refreshS2VVoiceCatalog() {
  const d = requireDeps()
  state.s2vVoiceCatalogError = ''
  await loadS2VVoiceData({ refresh: true })
}

async function handleS2VVoiceProviderChange() {
  const d = requireDeps()
  const nextProviderId = getS2VVoiceProvider()?.id || ''
  // 记录「显式选择自动 Edge TTS」：空 id 既是未选择也是显式 Edge，需区分以免被多模态默认覆盖
  state.s2vVoiceProviderExplicitEdge = !nextProviderId
  d.getS2vConfig().voiceProvider = nextProviderId
  // 语音模型由程序按运营默许模型解析（voice-model-program-resolved）：用户只选提供方。
  d.getS2vConfig().voiceModel = nextProviderId ? getS2VDefaultVoiceModel(nextProviderId) : ''
  d.getS2vConfig().voiceId = ''
  await loadS2VVoiceData()
}

async function handleS2VVoiceSelection() {
  const d = requireDeps()
  await selectS2VVoice(d.getS2vConfig().voiceId)
}

/** 方法表（壳同名代理转发）：目录/选择 + 共享操作层 + 克隆 CRUD 三部分汇总 */
export const ttsVoicesMethods = {
  getS2VVoiceContext,
  getS2VVoiceCloneContext,
  getS2VVoiceProvider,
  getS2VDefaultVoiceModel,
  isCurrentS2VVoiceRequest,
  isCurrentS2VVoiceCloneRequest,
  isCurrentS2VVoiceSelectionRequest,
  toS2VVoiceOption,
  toS2VVoiceCloneRequirements,
  friendlyVoiceCatalogError,
  s2vVoiceCloneHint,
  resetS2VVoiceData,
  loadS2VVoiceData,
  refreshS2VVoiceCatalog,
  handleS2VVoiceProviderChange,
  handleS2VVoiceSelection,
  selectS2VVoice,
  chooseS2VVoiceCloneSamples,
  nextS2VVoiceCloneName,
  addS2VVoiceClone,
  s2vVoiceCloneStatusText,
  deleteS2VVoiceClone,
  startS2VVoiceCloneRename,
  cancelS2VVoiceCloneRename,
  renameS2VVoiceClone,
  formatS2VVoiceCloneBytes,
  formatS2VVoiceCloneDuration,
}

export { setupTtsVoicesDeps, resetTtsVoicesForTest, ttsVoicesRefs, ttsVoicesComputeds }
