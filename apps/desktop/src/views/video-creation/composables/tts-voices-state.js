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
  s2vVoiceCloneRequirements: null,
  s2vVoiceClones: [],
  s2vVoiceCloneSelection: null,
  s2vVoiceCloneLoading: false,
  s2vVoiceCloneError: '',
  s2vVoiceClonePending: null,
  s2vVoiceCloneRenamingId: '',
  s2vVoiceCloneRenameDraft: '',
  // change: hifly-voice-edit-ui —— 参数编辑（语速/音量/语调）。
  // 用三个独立字符串而非嵌套对象：reset 只需置空，且模板 v-model 直接绑。
  s2vVoiceCloneParamsEditingId: '',
  s2vVoiceCloneParamsRate: '',
  s2vVoiceCloneParamsVolume: '',
  s2vVoiceCloneParamsPitch: '',
  s2vVoiceProviderExplicitEdge: false,
  // 上一次 loadS2VVoiceData 用的语音上下文（providerId + 解析出的 model）。
  // 用途：区分「上下文切换」（reset 时要连克隆列表一起清）与「同上下文刷新」（保留克隆列表），
  // 见 useTtsVoices.js 的 resetS2VVoiceData({ clearClones }) 调用点与 CCG 深度审查 i3。
  s2vVoiceCloneProviderId: '',
  s2vVoiceCloneModelId: '',
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
  // trim 归一：getS2VVoiceContext 用 trim 后的 id 查 provider，而并发守卫
  // （isCurrentS2VVoice*Request）比对的是 s2vVoiceContextModel —— 若两侧 trim 口径不同，
  // 带首尾空白的存量 voiceProvider 会让 expectedModel 恒不等于 context.model，
  // 请求结果被静默丢弃（跨家族评审 m2）。统一在此处 trim，两侧自然一致。
  const normalized = typeof providerId === 'string' ? providerId.trim() : ''
  return state.s2vVoiceProviders.find(provider => provider?.id === normalized) || null
}

/**
 * 能力级默认模型的单一真源解析口径（voice-model-program-resolved，2026-10-18）。
 *
 * 与主进程 `resolveProviderDefaultModel(provider, type)` **逐项等价**，由
 * `electron/services/voice-model-resolution-parity.test.js` 做跨层一致性锁
 * （语音域 type='tts'）。渲染层不能 require 主进程模块，故在此维护等价实现；
 * 改任一层都必须同步另一层。
 *
 * 四级优先级（2026-10-18 修订：能力级默认必须**先于** provider 级默认）：
 *   1. config.user_default_model（桌面端「模型设置」用户选择，∈ models 才生效）
 *   2. capability_models[type]（运营中心按能力类别配置的默许模型，声明即有效）
 *   3. config.default_model（运营 provider 级默认，∈ models 才生效；**多模态跳过**）
 *   4. 兜底：多模态 fail-closed 返回 ''（models[0] 可能是别的能力模型，禁止猜）；
 *      单能力返回 models[0] || ''。
 *
 * 为什么第 2 步必须早于第 3 步（2026-10-18 跨家族评审 C1 实证）：
 *   `minimax-multimodal` 的目录下发同时含 `default_model='MiniMax-M2.7'`（∈models，llm 模型）
 *   与 `capability_models={llm:MiniMax-M2.7, tts:speech-2.8-turbo, image:image-01, video:…}`。
 *   旧顺序（provider 级默认优先）会让 tts/image/video 全部解析成 **LLM 模型**。
 *
 * 注意：本函数**不认识** MiMo 的 tts/voiceclone 双模型特例——那是能力 driven 的分支
 * （预置音色 → mimo-v2.5-tts，克隆 → mimo-v2.5-tts-voiceclone），由 tts-voices-shared
 * 的 getS2VVoiceContext / getS2VVoiceCloneContext 分支处理，与本口径正交。
 *
 * @param {object|null|undefined} provider listProviders 返回的 provider 行
 * @param {string} type 能力类型：tts / image / video / llm / speech_recognition / audio
 * @returns {string}
 */
export function resolveCapabilityDefaultModel (provider, type) {
  if (!provider || typeof provider !== 'object') return ''
  const models = Array.isArray(provider.models)
    ? provider.models.filter(model => typeof model === 'string' && model.trim()).map(model => model.trim())
    : []
  const config = provider.config && typeof provider.config === 'object' ? provider.config : {}
  // 1. 用户默认（桌面端「模型设置」用户选择）
  const userDefault = typeof config.user_default_model === 'string' ? config.user_default_model.trim() : ''
  if (userDefault && models.includes(userDefault)) return userDefault
  // 2. 运营默许模型（能力类别默认，声明即有效，不校验 ∈ models）—— 必须先于 provider 级默认
  if (type && provider.capability_models && typeof provider.capability_models === 'object') {
    const byCapability = provider.capability_models[type]
    if (typeof byCapability === 'string' && byCapability.trim()) return byCapability.trim()
  }
  // 3. 运营 provider 级默认（兼容存量字段）。多模态**除 llm 外**跳过：该字段对多模态是
  //    provider 的「主模型」（通常是 llm），拿它解 tts/image/video 会静默取错模型；
  //    但解 llm 时它正是正确来源。
  const skipOpsDefault = provider.category === 'multimodal' && type && type !== 'llm'
  if (!skipOpsDefault) {
    const opsDefault = typeof config.default_model === 'string' ? config.default_model.trim() : ''
    if (opsDefault && models.includes(opsDefault)) return opsDefault
  }
  // 4. 兜底：多模态不猜测（fail-closed），单能力取首模型
  if (provider.category === 'multimodal') return ''
  return models[0] || ''
}

/** 语音域薄封装：type 固定 'tts'（跨层一致性锁按本函数签名取证） */
export function resolveVoiceModelForProvider (provider) {
  return resolveCapabilityDefaultModel(provider, 'tts')
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
  // ⛔ 不得在此调用 requireDeps()：该 computed 只读 state，不消费 deps。
  // 「为了 fail-closed 而调用」会引入一个真实缺陷 —— Vue 的 computed 在求值抛错时
  // 把 `_dirty` 置回 false 却**保留上一次的 _value**，而抛错那次又没成功注册依赖订阅，
  // 于是此后 state 变化再也 trigger 不到它 ⇒ 永久返回陈旧值。
  // 实测形态：--sequence.shuffle 下 s2vVoiceOptions 卡在 [v1,v2,v3]（上一个用例的残留），
  // 而它两个真实依赖已是正确值（2026-10-20 定位，见 useTtsVoices.test.js 的 DIAG 记录）。
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
  // 同上：不调用 requireDeps（本函数只经 getS2VVoiceProvider 间接取 provider，
  // 那条路径自己 requireDeps；在 computed 里再调一次只会多一个抛错点）。
  const provider = getS2VVoiceProvider()
  return Boolean(provider && provider.id === 'mimo-tts')
})

// 当前语音上下文使用的模型：MiMo TTS 走预置音色模型 mimo-v2.5-tts（克隆音色由
// tts-voice-clone-service 单独按 provider:model 管理）；其它 provider 按运营默许模型解析
// （voice-model-program-resolved：不再读用户可编辑的 s2vConfig.voiceModel）。
// deps 语义与原实现一致：未注入即抛错（fail-closed），由壳负责 setupTtsVoicesDeps。
export const s2vVoiceContextModel = computed(() => {
  // 同上：不调用 requireDeps（getS2VVoiceProvider / resolveVoiceModelForProvider 各自负责 fail-closed）
  const provider = getS2VVoiceProvider()
  if (provider && provider.id === 'mimo-tts') return 'mimo-v2.5-tts'
  return resolveVoiceModelForProvider(provider)
})

export const s2vVoiceOptions = computed(() => {
  // ⛔ 这里原先有一行 `const d = requireDeps()`，且**整个函数体从未使用 d** ——
  // 纯粹是「为了 fail-closed 而调用」。它是 --sequence.shuffle 下 6 例失败的根因：
  // 该 computed 只读 state.s2vVoiceCatalog / state.s2vVoiceClones，与 deps 无关；
  // 一旦在 deps 未注入时被读一次（测试里的 fail-closed 用例就会读），Vue 的 computed
  // 在抛错路径上保留旧 _value 且丢掉依赖订阅，之后永久返回陈旧值。
  // 实证（seed=1792469548946）：computed=['v1','v2','v3'] 而手动按同一公式算
  // =['official-old','MiniMaxVoice_auto1']，两个真实依赖也都是新值。
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
    s2vVoiceCloneRequirements: null,
    s2vVoiceClones: [],
    s2vVoiceCloneSelection: null,
    s2vVoiceCloneLoading: false,
    s2vVoiceCloneError: '',
    s2vVoiceClonePending: null,
    s2vVoiceCloneRenamingId: '',
    s2vVoiceCloneRenameDraft: '',
    // change: hifly-voice-edit-ui —— 参数编辑（语速/音量/语调）。
    // 用三个独立字符串而非嵌套对象：reset 只需置空，且模板 v-model 直接绑。
    s2vVoiceCloneParamsEditingId: '',
    s2vVoiceCloneParamsRate: '',
    s2vVoiceCloneParamsVolume: '',
    s2vVoiceCloneParamsPitch: '',
    s2vVoiceProviderExplicitEdge: false,
    s2vVoiceCloneProviderId: '',
    s2vVoiceCloneModelId: '',
  }
  Object.assign(state, initial)
  deps = null
  if (typeof window !== 'undefined') delete window[WINDOW_KEY]
}
