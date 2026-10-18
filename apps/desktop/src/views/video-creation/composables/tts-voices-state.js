/**
 * tts-voices-state —— TTS 音色域最低层：共享状态 + 跨域依赖 + 计算属性 + 测试复位
 *
 * 拆分理由：CI 债务熔断对新建文件有 500 行硬上限（scripts/check-debt-budget.js 的
 * NEW_OVER_LIMIT），故按子域拆模块。本层不 import 任何同族模块（层次最底），
 * 只对外暴露状态、requireDeps 与计算属性。
 *
 * 为何 getS2VVoiceProvider / getS2VDefaultVoiceModel 在本层：计算属性 s2vVoiceModelHidden
 * 依赖前者，而 shared 层又依赖这些计算属性；放 shared 会形成 state→shared→state 环。
 *
 * 设计约束（与 useBgmLibrary 同构，见方案 §2.3）：模块级单例、无实例依赖、
 * 跨域写点经 setupTtsVoicesDeps 注入、用户可见文案走 locale（deps.t）——
 * **同族模块不得出现 CJK 字面量**（CI Gate 7 --cjk 拦新路径，见方案 §2.6 发现 T1）。
 */
import { reactive, computed, toRefs } from 'vue'

/** 模块级状态（单例：音色目录与克隆列表为设备级资源，跨组件共享同一份） */
export const state = reactive({
  s2vVoiceProviders: [],
  s2vVoiceCatalog: [],
  s2vVoiceCatalogLoading: false,
  s2vVoiceCatalogError: '',
  s2vVoiceCatalogErrorCode: '',
  s2vVoiceCapability: null,
  s2vVoiceProviderRequestId: 0,
  s2vVoiceRequestId: 0,
  s2vVoiceSelectionRequestId: 0,
  s2vVoiceCloneRequestId: 0,
  s2vPersistedVoiceId: '',
  s2vVoiceCloneRequirements: null,
  s2vVoiceClones: [],
  s2vVoiceCloneSelection: null,
  s2vVoiceCloneLoading: false,
  s2vVoiceCloneError: '',
  s2vVoiceClonePending: null,
  s2vVoiceCloneRenamingId: '',
  s2vVoiceCloneRenameDraft: '',
  s2vVoiceProviderExplicitEdge: false,
})

/** 壳注入的跨域依赖（setupTtsVoicesDeps 一次性注入；window 兜底防测试/早调用时序） */
let deps = null
const WINDOW_KEY = '__ttsVoicesDeps'

export function setupTtsVoicesDeps(d) {
  deps = d
  if (typeof window !== 'undefined') window[WINDOW_KEY] = d
}

/** 取依赖；未注入即抛错（fail-closed，不静默降级） */
export function requireDeps() {
  const d = deps || (typeof window !== 'undefined' ? window[WINDOW_KEY] : null)
  if (!d) throw new Error('[useTtsVoices] deps not injected: shell component must call setupTtsVoicesDeps first')
  return d
}

export function getS2VVoiceProvider(providerId) {
  const d = requireDeps()
  if (providerId === undefined) providerId = d.getS2vConfig().voiceProvider
  return state.s2vVoiceProviders.find(provider => provider?.id === providerId) || null
}

/**
 * 语音模型的单一真源解析口径（voice-model-program-resolved，2026-10-18）。
 *
 * 与主进程 `resolveProviderDefaultModel(provider, 'tts')` **逐项等价**，由
 * `electron/services/voice-model-resolution-parity.test.js` 做跨层一致性锁。
 * 渲染层不能 require 主进程模块，故在此维护等价实现；改任一层都必须同步另一层。
 *
 * 四级优先级：
 *   1. config.user_default_model（桌面端「模型设置」用户选择，∈ models 才生效）
 *   2. capability_models.tts（运营中心按能力类别配置的默许模型，声明即有效）
 *   3. config.default_model（运营 provider 级默认，∈ models 才生效）
 *   4. 兜底：多模态 fail-closed 返回 ''（models[0] 可能是 image/video/llm 模型，禁止猜）；
 *      单能力返回 models[0] || ''。
 *
 * 注意：本函数**不认识** MiMo 的 tts/voiceclone 双模型特例——那是能力 driven 的分支
 * （预置音色 → mimo-v2.5-tts，克隆 → mimo-v2.5-tts-voiceclone），由 tts-voices-shared
 * 的 getS2VVoiceContext / getS2VVoiceCloneContext 分支处理，与本口径正交。
 *
 * @param {object|null|undefined} provider listProviders 返回的 provider 行
 * @returns {string}
 */
export function resolveVoiceModelForProvider (provider) {
  if (!provider || typeof provider !== 'object') return ''
  const models = Array.isArray(provider.models)
    ? provider.models.filter(model => typeof model === 'string' && model.trim()).map(model => model.trim())
    : []
  const config = provider.config && typeof provider.config === 'object' ? provider.config : {}
  // 1. 用户默认（桌面端「模型设置」用户选择）
  const userDefault = typeof config.user_default_model === 'string' ? config.user_default_model.trim() : ''
  if (userDefault && models.includes(userDefault)) return userDefault
  // 2. 运营默许模型（能力类别默认，声明即有效，不校验 ∈ models）
  if (provider.capability_models && typeof provider.capability_models === 'object') {
    const byCapability = provider.capability_models.tts
    if (typeof byCapability === 'string' && byCapability.trim()) return byCapability.trim()
  }
  // 3. 运营 provider 级默认（兼容存量字段）
  const opsDefault = typeof config.default_model === 'string' ? config.default_model.trim() : ''
  if (opsDefault && models.includes(opsDefault)) return opsDefault
  // 4. 兜底：多模态不猜测（fail-closed），单能力取首模型
  if (provider.category === 'multimodal') return ''
  return models[0] || ''
}

export function getS2VDefaultVoiceModel(providerId) {
  const d = requireDeps()
  if (providerId === undefined) providerId = d.getS2vConfig().voiceProvider
  const provider = getS2VVoiceProvider(providerId)
  // MiMo TTS：模型由「语音/音色 ID」区分（预置→tts，克隆→voiceclone），
  // 解析结果置空，实际模型由 getS2VVoiceContext / getS2VVoiceCloneContext 分支决定。
  if (provider?.id === 'mimo-tts') return ''
  return resolveVoiceModelForProvider(provider)
}

// ── 计算属性（壳以只读 computed 转发到模板；模块内以 .value 读取）──────
export const s2vVoiceProviderOptions = computed(() => {
  const d = requireDeps()
  // 首项「自动 Edge TTS」必须带 displayName，否则模板 {{ provider.displayName }} 渲染为空选项（2026-08-10 Bug 反哺）
  return [{ id: '', name: d.t('create.story2video.voice.autoEdgeProvider'), displayName: d.t('create.story2video.voice.autoEdgeProvider') }, ...state.s2vVoiceProviders.map(provider => ({
    ...provider,
    displayName: provider.category === 'multimodal' ? provider.name + d.t('create.story2video.voice.multimodalSuffix') : provider.name,
  }))]
})

export const s2vVoiceCatalogRefreshable = computed(() => {
  const d = requireDeps()
  // 仅瞬时/未知错误提供「刷新音色列表」；配置类/不支持/模型不匹配/身份问题重试无效
  if (!state.s2vVoiceCatalogError) return false
  const code = state.s2vVoiceCatalogErrorCode
  return code === '' || code === 'VOICE_CATALOG_UNAVAILABLE'
})

// 注：原 `s2vVoiceModelOptions` computed 已随「语音模型」下拉一并移除
// （voice-model-program-resolved，2026-10-18）——它只服务下拉候选渲染与旧的选择归一，
// 两处消费方都不再存在；模型解析统一走 resolveVoiceModelForProvider。

// MiMo TTS 的模型分支标记：mimo-v2.5-tts 与 mimo-v2.5-tts-voiceclone
// 由「语音 / 音色 ID」下拉区分（预置音色 → tts，克隆音色 → voiceclone）。
export const s2vVoiceModelHidden = computed(() => {
  const d = requireDeps()
  const provider = getS2VVoiceProvider()
  return Boolean(provider && provider.id === 'mimo-tts')
})

// 当前语音上下文使用的模型：MiMo TTS 走预置音色模型 mimo-v2.5-tts（克隆音色由
// tts-voice-clone-service 单独按 provider:model 管理）；其它 provider 按运营默许模型解析
// （voice-model-program-resolved：不再读用户可编辑的 s2vConfig.voiceModel）。
// deps 语义与原实现一致：未注入即抛错（fail-closed），由壳负责 setupTtsVoicesDeps。
export const s2vVoiceContextModel = computed(() => {
  const d = requireDeps()
  const provider = getS2VVoiceProvider()
  if (provider && provider.id === 'mimo-tts') return 'mimo-v2.5-tts'
  return resolveVoiceModelForProvider(provider)
})

export const s2vVoiceOptions = computed(() => {
  const d = requireDeps()
  const voices = [
    ...(Array.isArray(state.s2vVoiceCatalog) ? state.s2vVoiceCatalog : []),
    ...(Array.isArray(state.s2vVoiceClones) ? state.s2vVoiceClones : []),
  ]
  return [...new Map(voices.map(voice => [voice.id, voice])).values()]
})

/** 计算属性表（壳 computed 转发） */
export const ttsVoicesComputeds = {
  s2vVoiceProviderOptions,
  s2vVoiceCatalogRefreshable,
  s2vVoiceModelHidden,
  s2vVoiceContextModel,
  s2vVoiceOptions,
}

/** 状态桥接用 toRefs（壳 CreateView computed get/set 委托到这里） */
export const ttsVoicesRefs = toRefs(state)

/** 测试复位（模块级单例状态跨用例泄漏防护）：仅测试环境使用 */
export function resetTtsVoicesForTest() {
  const initial = {
    s2vVoiceProviders: [],
    s2vVoiceCatalog: [],
    s2vVoiceCatalogLoading: false,
    s2vVoiceCatalogError: '',
    s2vVoiceCatalogErrorCode: '',
    s2vVoiceCapability: null,
    s2vVoiceProviderRequestId: 0,
    s2vVoiceRequestId: 0,
    s2vVoiceSelectionRequestId: 0,
    s2vVoiceCloneRequestId: 0,
    s2vPersistedVoiceId: '',
    s2vVoiceCloneRequirements: null,
    s2vVoiceClones: [],
    s2vVoiceCloneSelection: null,
    s2vVoiceCloneLoading: false,
    s2vVoiceCloneError: '',
    s2vVoiceClonePending: null,
    s2vVoiceCloneRenamingId: '',
    s2vVoiceCloneRenameDraft: '',
    s2vVoiceProviderExplicitEdge: false,
  }
  Object.assign(state, initial)
  deps = null
  if (typeof window !== 'undefined') delete window[WINDOW_KEY]
}
