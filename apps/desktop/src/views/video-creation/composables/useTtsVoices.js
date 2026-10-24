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
  startS2VVoiceCloneParams,
  cancelS2VVoiceCloneParams,
  saveS2VVoiceCloneParams,
} from './tts-voices-clone'
import {
  getTtsVoiceCatalog,
  getTtsVoiceCapability,
} from '@/api/tts-voice-catalog'
import {
  getTtsVoiceCloneRequirements,
  listTtsVoiceClones,
} from '@/api/tts-voice-clone'

/**
 * 重置音色域的「拉取中」状态。
 *
 * @param {object} [options]
 * @param {boolean} [options.clearClones=false] 是否连克隆列表一起清空。
 *   **默认 false（保留）**：克隆音色是设备级本地资源（主进程 registry + 本机样本），
 *   与「音色目录刷新」无关。旧实现无条件清空它，导致一次失败的目录刷新就把用户刚克隆的
 *   音色从下拉候选里抹掉，同时 selectedVoiceId 归一又因候选集合为空走到清空分支 ——
 *   两个缺陷叠加，用户看到「克隆成功的音色莫名消失且无提示」（PRD：已保存的 voiceId
 *   不得静默丢失）。
 *   **true（清空）只在 provider/model 上下文切换时用**：旧 provider 的克隆音色对新
 *   provider 无意义，若不及时清掉，在新列表到达前会暂留在下拉候选里、可被误选
 *   （2026-10-20 CCG 深度审查 i3）。并发守卫只丢弃过期拉取**结果**，不清本地候选，
 *   所以必须显式清。
 */
function resetS2VVoiceData(options = {}) {
  const d = requireDeps()
  const clearClones = options.clearClones === true
  state.s2vVoiceCatalog = []
  state.s2vVoiceCatalogLoading = false
  state.s2vVoiceCatalogError = ''
  state.s2vVoiceCatalogErrorCode = ''
  state.s2vVoiceCapability = null
  state.s2vVoiceCloneRequirements = null
  if (clearClones) state.s2vVoiceClones = []
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
  // 上下文切换（provider 或解析出的模型变了）时连克隆列表一起清：旧 provider 的克隆音色
  // 对新 provider 无意义，不清则在新列表到达前暂留在下拉候选里、可被误选
  // （2026-10-20 CCG 深度审查 i3）。纯刷新（context 不变）保留克隆列表，避免一次失败
  // 的刷新抹掉用户已克隆的音色。无 context（未选 provider）时同样清空。
  // ⚠ tracking 字段只在**拉取成功、并发守卫通过后**更新（见下方 isCurrentS2VVoiceRequest 之后）：
  // 若在请求开始时就写，一次失败的切换会把「上次成功上下文」污染成新值，用户切回原 provider
  // 时判定不出「这是切换」，克隆候选已被抹掉且保留逻辑失效（CCG 深度审查 i1）。
  const contextChanged = !context
    || context.providerId !== state.s2vVoiceCloneProviderId
    || context.model !== state.s2vVoiceCloneModelId
  resetS2VVoiceData({ clearClones: contextChanged })
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
  // 目录**成功**返回后才把「上次成功上下文」记成当前值。
  // 提早记（请求开始处，甚至「拉取被采纳」时）会让一次失败的切换污染记忆：用户切到 B 失败、
  // 再切回 A 时判定不出「这是切换」，A 的克隆候选已被 B 那次清空抹掉且保留逻辑失效（i1）。
  if (catalogData) {
    state.s2vVoiceCloneProviderId = context.providerId
    state.s2vVoiceCloneModelId = context.model
  }
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
  // 克隆列表是否拿到了「权威结果」（成功返回，哪怕 voices 为空数组）。
  // 与 catalogData 同理：取不到 ≠ 为空。只有拿到权威结果才允许据此清空选中项。
  let cloneListAuthoritative = false
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
    // 克隆列表同样遵循「取不到数据 ≠ 数据为空」：拉取失败时保留原值，不用空数组覆盖。
    // 旧实现无条件赋 [] ⇒ 一次失败的克隆列表刷新就把用户已克隆的音色从下拉候选里抹掉，
    // 与「目录刷新失败清空选中项」是同型缺陷（CCG 深度审查 i2 的根因）。
    // provider/model 切换后的跨 provider 克隆不匹配由并发守卫丢弃，不走「预先清空」这条路。
    if (clonesResponse?.code === 0 && Array.isArray(clonesResponse.data?.voices)) {
      cloneListAuthoritative = true
      state.s2vVoiceClones = clonesResponse.data.voices.map(voice => toS2VVoiceOption(voice)).filter(Boolean)
    }
    state.s2vVoiceCloneError = requirementsResponse?.code === 0 && clonesResponse?.code === 0
      ? ''
      : (requirementsResponse?.message || clonesResponse?.message || d.t('create.story2video.voice.cloneInfoUnavailable'))
    state.s2vVoiceCloneLoading = false
  }

  if (!isCurrentS2VVoiceRequest(requestId, context)) return
  const selectedVoiceId = typeof catalogData?.selectedVoiceId === 'string' ? catalogData.selectedVoiceId : ''
  const configuredVoiceId = typeof d.getS2vConfig().voiceId === 'string' ? d.getS2vConfig().voiceId : ''
  const availableVoiceIds = new Set(s2vVoiceOptions.value.map(voice => voice.id))
  const configuredStillAvailable = Boolean(configuredVoiceId) && availableVoiceIds.has(configuredVoiceId)
  if (selectedVoiceId && availableVoiceIds.has(selectedVoiceId)) {
    d.getS2vConfig().voiceId = selectedVoiceId
  } else if (configuredStillAvailable) {
    // 已配置的音色仍在候选集合内 ⇒ 不动它（保留用户/主进程的选择）
  } else if (configuredVoiceId && !catalogData && !cloneListAuthoritative) {
    // 目录本次没拿到 **且克隆列表也没拿到权威结果**（两个拉取都失败/被跳过）⇒ 保留已保存的
    // voiceId，不清空（违反「已保存的 voiceId 不得静默丢失」）。
    //
    // 为什么必须同时要求 !cloneListAuthoritative：若克隆列表**成功**返回了权威空数组
    // （用户真的把克隆全删了），而目录又没拿到，此时保留的就是一个**无候选可渲染**的悬空 id。
    // 「权威来源说没有」与「这次没问到」是两件事，只有后者才配保留（2026-10-20 CCG 深度审查 i2）。
    //
    // 注：这里原有一行 `state.s2vPersistedVoiceId = configuredVoiceId`，是 s2vConfig.voiceId
    // 的冗余镜像且生产零读取（2026-10-20 清理）；保留语义完全由「不写 s2vConfig.voiceId」承担。
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
  startS2VVoiceCloneParams,
  cancelS2VVoiceCloneParams,
  saveS2VVoiceCloneParams,
  formatS2VVoiceCloneBytes,
  formatS2VVoiceCloneDuration,
}

export { setupTtsVoicesDeps, resetTtsVoicesForTest, ttsVoicesRefs, ttsVoicesComputeds }
