/**
 * useTtsVoices 独立测试（CreateView 拆分第 2 步，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3 §2.2/§2.3）。
 *
 * 与旧测试（CreateView.test.js，经壳代理/桥接驱动）互补：本文件直接测 composable 契约——
 * deps 注入与 fail-closed、状态复位、计算属性纯函数性、并发守卫（requestId）语义、
 * 以及「零 CJK 字面量」的源文件约束（方案 §2.6 发现 T1 的防回流锁）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ttsVoicesRefs,
  ttsVoicesComputeds,
  ttsVoicesMethods,
  setupTtsVoicesDeps,
  resetTtsVoicesForTest,
} from './useTtsVoices'
import {
  getS2VDefaultVoiceModel,
  resolveVoiceModelForProvider,
} from './tts-voices-state'
import {
  addTtsVoiceClone,
  chooseTtsVoiceCloneSamples as chooseCloneSamplesApi,
  deleteTtsVoiceClone as deleteCloneApi,
  getTtsVoiceCloneRequirements as getTtsVoiceCloneRequirementsApi,
  listTtsVoiceClones as listTtsVoiceClonesApi,
  renameTtsVoiceClone as renameCloneApi,
} from '@/api/tts-voice-clone'
import {
  getTtsVoiceCatalog as getTtsVoiceCatalogApi,
  getTtsVoiceCapability as getTtsVoiceCapabilityApi,
  selectTtsVoice,
} from '@/api/tts-voice-catalog'
import { confirmDanger } from '@/utils/confirm-danger'

vi.mock('@/utils/confirm-danger', () => ({
  confirmDanger: vi.fn(async () => true),
}))

vi.mock('@/api/tts-voice-clone', () => ({
  addTtsVoiceClone: vi.fn(),
  chooseTtsVoiceCloneSamples: vi.fn(),
  deleteTtsVoiceClone: vi.fn(),
  getTtsVoiceCloneRequirements: vi.fn(async () => ({ code: 0, data: {} })),
  listTtsVoiceClones: vi.fn(async () => ({ code: 0, data: { voices: [] } })),
  renameTtsVoiceClone: vi.fn(),
}))

vi.mock('@/api/tts-voice-catalog', () => ({
  getTtsVoiceCatalog: vi.fn(async () => ({ code: 0, data: { voices: [], invalidVoices: [] } })),
  getTtsVoiceCapability: vi.fn(async () => ({ code: 0, data: { type: 'user_clone', clone: { enabled: true } } })),
  selectTtsVoice: vi.fn(async () => ({ code: 0, data: {} })),
  clearTtsVoicePreference: vi.fn(async () => ({ code: 0, data: {} })),
}))

const here = dirname(fileURLToPath(import.meta.url))

function makeDeps(overrides = {}) {
  // 必须与生产一致为响应式对象：计算属性依赖它，普通对象改动不会失效（会测出假绿/假红）
  const s2vConfig = reactive({
    voiceProvider: '', voiceModel: '', voiceId: '',
    imageProvider: '', imageModel: '', videoProvider: '', videoModel: '',
  })
  return {    s2vConfig,
    getS2vConfig: () => s2vConfig,
    t: vi.fn((key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)),
    translate: vi.fn((key) => key),
    cloneForIpc: vi.fn((value) => JSON.parse(JSON.stringify(value))),
    isAlive: vi.fn(() => true),
    showOptionsToast: vi.fn(),
    ...overrides,
  }
}

/**
 * 顶层 beforeEach：复位模块级单例状态 + **所有**被 vi.mock 替换的 API 入口。
 *
 * 为什么要在这里（而不是只在新 describe 的 beforeEach）做 mock 复位：顶层 vi.mock 是
 * 模块级替换，对本文件**全部**用例生效（含既有 16 例）。若只在新 describe 里复位，
 * 一旦执行顺序变化，新 describe 覆写过的 mockResolvedValue 会泄漏给既有用例
 * （2026-10-20 CCG 深度审查 i4）。
 *
 * ⚠ **如实记录：i4 只被部分闭合。** 本改动让状态复位与 mock 复位都发生在每个用例之前，
 * 但 `--sequence.shuffle` 实测仍有 6 例失败（新 describe 读到 `[v1,v2,v3]`）。起点日志
 * 证实复位本身有效（见 setupCloneReady 内注释），泄漏发生在被测函数执行期间，
 * 根因尚未定位。CI 不跑 shuffle，不阻塞合并；该债务记在执行记录「残留风险」里。
 * 不要把「已上移复位」读成「顺序无关已被证明」—— 它没有被证明。
 */
beforeEach(() => {
  resetTtsVoicesForTest()
  for (const m of [chooseCloneSamplesApi, addTtsVoiceClone, deleteCloneApi, renameCloneApi,
    getTtsVoiceCloneRequirementsApi, listTtsVoiceClonesApi,
    getTtsVoiceCatalogApi, getTtsVoiceCapabilityApi, selectTtsVoice, confirmDanger]) {
    m.mockReset()
  }
  // 默认值：与生产「正常路径」一致。各用例只覆写自己关心的那几个。
  getTtsVoiceCatalogApi.mockResolvedValue({ code: 0, data: { voices: [], invalidVoices: [] } })
  getTtsVoiceCapabilityApi.mockResolvedValue({ code: 0, data: { type: 'user_clone', clone: { enabled: true } } })
  getTtsVoiceCloneRequirementsApi.mockResolvedValue({ code: 0, data: {} })
  listTtsVoiceClonesApi.mockResolvedValue({ code: 0, data: { voices: [] } })
  confirmDanger.mockResolvedValue(true)
})

describe('useTtsVoices 契约', () => {
  it('deps 未注入时 fail-closed（抛错而非静默）', () => {
    expect(() => ttsVoicesMethods.getS2VVoiceContext()).toThrow('deps not injected')
    // 注：此处**故意不再**断言 computed 抛错 —— 见下一条用例。computed 的 fail-closed
    // 会引入比它防住的更严重的缺陷（Vue 抛错路径保留旧值 + 丢依赖订阅）。
    // fail-closed 的职责由**写路径方法**承担（getS2VVoiceContext / selectS2VVoice 等），
    // 只读 computed 在 deps 缺失时返回安全空值是正确行为。
  })

  it('只读 computed 在 deps 未注入时不抛错、且不污染缓存（Vue computed 抛错会保留旧值的回归锁）', () => {
    // 动因（2026-10-20，seed=1792469548946 实测）：s2vVoiceOptions 里有一行
    // `const d = requireDeps()` 且函数体**从未使用 d** —— 纯粹的「为 fail-closed 而调用」。
    // Vue 3 的 computed 在求值抛错时把 _dirty 置回 false 却保留上一次的 _value，而抛错那次
    // 又没成功注册依赖订阅，于是此后 state 变化再也 trigger 不到它 ⇒ 永久返回陈旧值。
    // 现场：computed=['v1','v2','v3']（上一用例残留），而两个真实依赖已是正确值。
    // 这条锁分四步，任一步坏掉都能指名变红。
    // 1) 有 deps 时求出真实值
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'cache-a' }]
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'cache-b' }]
    expect(ttsVoicesComputeds.s2vVoiceOptions.value.map(v => v.id)).toEqual(['cache-a', 'cache-b'])
    // 2) 复位（deps 置空、state 清空）
    resetTtsVoicesForTest()
    // 3) deps 未注入时读它 —— 不得抛错（抛错就会冻结旧值）
    expect(() => ttsVoicesComputeds.s2vVoiceOptions.value).not.toThrow()
    expect(ttsVoicesComputeds.s2vVoiceOptions.value).toEqual([])
    // 4) 重新注入并换数据 —— 必须反映新值，证明缓存没被卡住
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'cache-c' }]
    expect(ttsVoicesComputeds.s2vVoiceOptions.value.map(v => v.id)).toEqual(['cache-c'])
  })

  it('导出面完整：25 状态 ref + 5 计算属性 + 30 方法', () => {
    expect(Object.keys(ttsVoicesRefs)).toHaveLength(25)
    // 25 = 21 + 4（change: hifly-voice-edit-ui —— 参数编辑：
    //        s2vVoiceCloneParamsEditingId / ParamsRate / ParamsVolume / ParamsPitch）
    // 21 = 20 + s2vVoiceCloneProviderId + s2vVoiceCloneModelId（上下文切换判定用，CCG i3）
    //      - s2vPersistedVoiceId（2026-10-20 清理：s2vConfig.voiceId 的冗余镜像，生产零读取）
    // 5 = 6 - s2vVoiceModelOptions（voice-model-program-resolved 移除「语音模型」下拉）
    expect(Object.keys(ttsVoicesComputeds)).toHaveLength(5)
    // 30 = 27 + 3（change: hifly-voice-edit-ui —— start/cancel/saveS2VVoiceCloneParams）
    // 27 = 28 - handleS2VVoiceModelChange（同上）
    expect(Object.keys(ttsVoicesMethods)).toHaveLength(30)
    // 关键名称在位（壳代理/桥接与 S2V 面板契约按名访问）
    for (const k of ['s2vVoiceCatalog', 's2vVoiceClones', 's2vVoiceCloneLoading', 's2vVoiceProviders']) {
      expect(ttsVoicesRefs).toHaveProperty(k)
    }
    for (const k of ['s2vVoiceProviderOptions', 's2vVoiceModelHidden', 's2vVoiceContextModel', 's2vVoiceOptions']) {
      expect(ttsVoicesComputeds).toHaveProperty(k)
    }
    for (const k of ['loadS2VVoiceData', 'selectS2VVoice', 'addS2VVoiceClone', 'deleteS2VVoiceClone', 'renameS2VVoiceClone', 'startS2VVoiceCloneParams', 'cancelS2VVoiceCloneParams', 'saveS2VVoiceCloneParams']) {
      expect(ttsVoicesMethods).toHaveProperty(k)
    }
    // 模型下拉相关入口已随下拉一并移除（fail-closed：拼错的键不应静默存在）
    expect(ttsVoicesMethods).not.toHaveProperty('handleS2VVoiceModelChange')
    expect(ttsVoicesComputeds).not.toHaveProperty('s2vVoiceModelOptions')
  })

  it('resetTtsVoicesForTest 把状态复位到初值并清空 deps', () => {
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'a', name: 'A' }]
    ttsVoicesRefs.s2vVoiceCloneLoading.value = true
    ttsVoicesRefs.s2vVoiceCatalogError.value = 'boom'
    resetTtsVoicesForTest()
    expect(ttsVoicesRefs.s2vVoiceClones.value).toEqual([])
    expect(ttsVoicesRefs.s2vVoiceCloneLoading.value).toBe(false)
    expect(ttsVoicesRefs.s2vVoiceCatalogError.value).toBe('')
    // deps 亦被清空 → 回到 fail-closed
    expect(() => ttsVoicesMethods.getS2VVoiceContext()).toThrow('deps not injected')
  })

  it('getS2VVoiceContext 依 provider+解析出的默许模型计算；缺一即 null（voice-model-program-resolved）', () => {
    const deps = makeDeps()
    setupTtsVoicesDeps(deps)
    // 无 provider → null
    expect(ttsVoicesMethods.getS2VVoiceContext()).toBeNull()
    // provider 未注册在 s2vVoiceProviders → 解析不出模型 → null
    deps.s2vConfig.voiceProvider = 'p1'
    expect(ttsVoicesMethods.getS2VVoiceContext()).toBeNull()
    // provider 已注册且运营默许模型可解析 → 正常返回（注意：不再读用户可编辑的 voiceModel）
    ttsVoicesRefs.s2vVoiceProviders.value = [
      { id: 'p1', name: 'P1', category: 'tts', models: ['m1', 'm2'], capability_models: { tts: 'm1' } },
    ]
    deps.s2vConfig.voiceModel = 'user-stale-value'
    expect(ttsVoicesMethods.getS2VVoiceContext()).toEqual({ providerId: 'p1', model: 'm1' })
    expect(ttsVoicesMethods.getS2VVoiceCloneContext()).toEqual({ providerId: 'p1', model: 'm1' })
    // 解析结果为空（多模态无 tts 声明）→ null（fail-closed，不猜 models[0]）
    ttsVoicesRefs.s2vVoiceProviders.value = [
      { id: 'p1', name: 'P1', category: 'multimodal', models: ['m1', 'm2'] },
    ]
    expect(ttsVoicesMethods.getS2VVoiceContext()).toBeNull()
  })

  it('resolveVoiceModelForProvider 四级优先级（voice-model-program-resolved）', () => {
    // 该函数与主进程 resolveProviderDefaultModel(provider,'tts') 等价，跨层锁见
    // electron/services/voice-model-resolution-parity.test.js；此处测前端侧导入与 MiMo 特例。
    expect(typeof resolveVoiceModelForProvider).toBe('function')
    expect(resolveVoiceModelForProvider({ id: 'x', category: 'tts', models: ['a', 'b'], capability_models: { tts: 'b' } })).toBe('b')
    // MiMo 特例正交保留：getS2VDefaultVoiceModel 对 mimo-tts 置空，实际模型由音色类型分支决定
    const deps = makeDeps()
    setupTtsVoicesDeps(deps)
    ttsVoicesRefs.s2vVoiceProviders.value = [
      { id: 'mimo-tts', name: 'MiMo', category: 'tts', models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone'] },
    ]
    deps.s2vConfig.voiceProvider = 'mimo-tts'
    expect(getS2VDefaultVoiceModel()).toBe('')
  })

  it('MiMo TTS（provider.id === mimo-tts）隐藏模型下拉，catalog 用预置模型、克隆用 voiceclone 模型', () => {
    const deps = makeDeps()
    setupTtsVoicesDeps(deps)
    ttsVoicesRefs.s2vVoiceProviders.value = [{ id: 'mimo-tts', name: 'MiMo', models: ['mimo-v2.5-tts'] }]
    deps.s2vConfig.voiceProvider = 'mimo-tts'
    deps.s2vConfig.voiceModel = 'mimo-v2.5-tts'
    expect(ttsVoicesComputeds.s2vVoiceModelHidden.value).toBe(true)
    expect(ttsVoicesMethods.getS2VVoiceContext()).toEqual({ providerId: 'mimo-tts', model: 'mimo-v2.5-tts' })
    expect(ttsVoicesMethods.getS2VVoiceCloneContext()).toEqual({ providerId: 'mimo-tts', model: 'mimo-v2.5-tts-voiceclone' })
    // s2vVoiceContextModel 对 mimo 固定为预置音色模型（与用户配置无关）
    expect(ttsVoicesComputeds.s2vVoiceContextModel.value).toBe('mimo-v2.5-tts')
  })

  it('s2vVoiceProviderOptions 首项为「自动 Edge TTS」且带 displayName（locale 取值）', () => {
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceProviders.value = [
      { id: 'p1', name: 'P1', category: 'multimodal' },
    ]
    const opts = ttsVoicesComputeds.s2vVoiceProviderOptions.value
    expect(opts[0]).toEqual({
      id: '',
      name: 'create.story2video.voice.autoEdgeProvider',
      displayName: 'create.story2video.voice.autoEdgeProvider',
    })
    // 多模态加 locale 后缀
    expect(opts[1].displayName).toBe('P1create.story2video.voice.multimodalSuffix')
  })

  it('s2vVoiceOptions 合并目录与克隆并按 id 去重（克隆覆盖同名目录项）', () => {
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'v1', name: '目录V1' }, { id: 'v2', name: '目录V2' }]
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'v2', name: '克隆V2' }, { id: 'v3', name: '克隆V3' }]
    const ids = ttsVoicesComputeds.s2vVoiceOptions.value.map((v) => v.id)
    expect(ids).toEqual(['v1', 'v2', 'v3'])
    // 后者（克隆）胜出
    expect(ttsVoicesComputeds.s2vVoiceOptions.value.find((v) => v.id === 'v2').name).toBe('克隆V2')
  })

  it('s2vVoiceCatalogRefreshable 仅对瞬时/未知错误为真（配置类错误不可重试）', () => {
    setupTtsVoicesDeps(makeDeps())
    expect(ttsVoicesComputeds.s2vVoiceCatalogRefreshable.value).toBe(false)
    ttsVoicesRefs.s2vVoiceCatalogError.value = 'x'
    ttsVoicesRefs.s2vVoiceCatalogErrorCode.value = ''
    expect(ttsVoicesComputeds.s2vVoiceCatalogRefreshable.value).toBe(true)
    ttsVoicesRefs.s2vVoiceCatalogErrorCode.value = 'VOICE_CATALOG_UNAVAILABLE'
    expect(ttsVoicesComputeds.s2vVoiceCatalogRefreshable.value).toBe(true)
    ttsVoicesRefs.s2vVoiceCatalogErrorCode.value = 'VOICE_CATALOG_CONFIG_UNAVAILABLE'
    expect(ttsVoicesComputeds.s2vVoiceCatalogRefreshable.value).toBe(false)
  })

  it('并发守卫：requestId 落后即判定为过期请求（不写状态）', () => {
    const deps = makeDeps()
    setupTtsVoicesDeps(deps)
    deps.s2vConfig.voiceProvider = 'p1'
    ttsVoicesRefs.s2vVoiceProviders.value = [
      { id: 'p1', name: 'P1', category: 'tts', models: ['m1', 'm2'], capability_models: { tts: 'm1' } },
    ]
    const ctx = ttsVoicesMethods.getS2VVoiceContext()
    expect(ctx).toEqual({ providerId: 'p1', model: 'm1' })
    ttsVoicesRefs.s2vVoiceRequestId.value = 5
    expect(ttsVoicesMethods.isCurrentS2VVoiceRequest(5, ctx)).toBe(true)
    expect(ttsVoicesMethods.isCurrentS2VVoiceRequest(4, ctx)).toBe(false)
    // context 与当前解析结果不一致 → 亦判过期（换 provider 使解析值改变）
    ttsVoicesRefs.s2vVoiceProviders.value = [
      { id: 'p1', name: 'P1', category: 'tts', models: ['m1', 'm2'], capability_models: { tts: 'm2' } },
    ]
    expect(ttsVoicesMethods.isCurrentS2VVoiceRequest(5, ctx)).toBe(false)
  })

  it('nextS2VVoiceCloneName 以前缀 + 最大序号递增（3 位零填充，重命名不回退）', () => {
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceClones.value = []
    expect(ttsVoicesMethods.nextS2VVoiceCloneName()).toBe('create.story2video.voice.cloneNamePrefix001')
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'a', name: 'create.story2video.voice.cloneNamePrefix007' }]
    expect(ttsVoicesMethods.nextS2VVoiceCloneName()).toBe('create.story2video.voice.cloneNamePrefix008')
  })

  it('formatS2VVoiceCloneBytes / Duration 走 locale 键与边界值', () => {
    setupTtsVoicesDeps(makeDeps())
    expect(ttsVoicesMethods.formatS2VVoiceCloneBytes(-1)).toBe('—')
    expect(ttsVoicesMethods.formatS2VVoiceCloneBytes(1024)).toBe('1 KB')
    expect(ttsVoicesMethods.formatS2VVoiceCloneBytes(2 * 1024 * 1024)).toBe('2 MB')
    expect(ttsVoicesMethods.formatS2VVoiceCloneDuration(-1)).toBe('—')
    expect(ttsVoicesMethods.formatS2VVoiceCloneDuration(30)).toContain('durationSeconds')
    expect(ttsVoicesMethods.formatS2VVoiceCloneDuration(90)).toContain('durationMinutesSeconds')
    expect(ttsVoicesMethods.formatS2VVoiceCloneDuration(120)).toContain('durationMinutes')
  })

  it('克隆重命名态开合（start/cancel）为纯状态操作，加载中拒绝进入', () => {
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'c1', name: '克隆一' }]
    ttsVoicesMethods.startS2VVoiceCloneRename('c1')
    expect(ttsVoicesRefs.s2vVoiceCloneRenamingId.value).toBe('c1')
    expect(ttsVoicesRefs.s2vVoiceCloneRenameDraft.value).toBe('克隆一')
    ttsVoicesMethods.cancelS2VVoiceCloneRename()
    expect(ttsVoicesRefs.s2vVoiceCloneRenamingId.value).toBe('')
    expect(ttsVoicesRefs.s2vVoiceCloneRenameDraft.value).toBe('')
    // 加载中不进入编辑态
    ttsVoicesRefs.s2vVoiceCloneLoading.value = true
    ttsVoicesMethods.startS2VVoiceCloneRename('c1')
    expect(ttsVoicesRefs.s2vVoiceCloneRenamingId.value).toBe('')
  })

  it('resetS2VVoiceData 清空目录/能力/克隆进行态（不清 requestId 计数；刻意保留克隆列表）', () => {
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'v1', name: 'V1' }]
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'c1', name: 'C1' }]
    ttsVoicesRefs.s2vVoiceCapability.value = { type: 'user_clone', clone: { enabled: true } }
    ttsVoicesRefs.s2vVoiceCatalogError.value = 'e'
    ttsVoicesRefs.s2vVoiceClonePending.value = { id: 'p', name: 'P', sampleCount: 1 }
    ttsVoicesMethods.resetS2VVoiceData()
    expect(ttsVoicesRefs.s2vVoiceCatalog.value).toEqual([])
    // 克隆列表是设备级本地资源，与「目录刷新」无关：一次失败的目录刷新不得把它抹掉
    // （CCG 深度审查 i2：旧实现清空它 ⇒ 克隆音色从候选消失 ⇒ 选中项被归一成悬空/清空）
    expect(ttsVoicesRefs.s2vVoiceClones.value).toEqual([{ id: 'c1', name: 'C1' }])
    expect(ttsVoicesRefs.s2vVoiceCapability.value).toBeNull()
    expect(ttsVoicesRefs.s2vVoiceCatalogError.value).toBe('')
    expect(ttsVoicesRefs.s2vVoiceClonePending.value).toBeNull()
  })

  it('s2vVoiceCloneStatusText 无占位行时为空串（不渲染横幅）', () => {
    setupTtsVoicesDeps(makeDeps())
    expect(ttsVoicesMethods.s2vVoiceCloneStatusText()).toBe('')
    ttsVoicesRefs.s2vVoiceClonePending.value = { id: 'p', name: 'P', sampleCount: 3 }
    expect(ttsVoicesMethods.s2vVoiceCloneStatusText()).toContain('cloneStatusPending')
  })
})

/**
 * 克隆成功后「语音 / 音色 ID」下拉自动切换到新克隆音色（s2v-voice-clone-auto-select）。
 *
 * 用户诉求：在「声音」区添加本地音色样本（被克隆的样本）后，一旦新的自定义音色创建成功，
 * 上方「语音 / 音色 ID」下拉应自动选中这个新音色，而不是停留在服务商默认音色或旧选择上。
 */
describe('克隆成功后自动切换「语音 / 音色 ID」选中项', () => {
  const PROVIDER = {
    id: 'minimax-tts',
    name: 'MiniMax TTS',
    category: 'tts',
    models: ['speech-2.8-turbo'],
    capability_models: { tts: 'speech-2.8-turbo' },
    config: {},
  }

  function setupCloneReady(overrides = {}) {
    const deps = makeDeps(overrides)
    setupTtsVoicesDeps(deps)
    // 显式建立起点（不依赖外部 beforeEach 的复位）：夹具自足，任何顺序下起点一致。
    // ⚠ 历史注记（已闭合，2026-10-20）：此前 `--sequence.shuffle` 下本 describe 曾稳定 6 例失败，
    // 一度误判为「夹具泄漏」并被登记为未闭合残留。真实根因在**生产代码**：`s2vVoiceOptions`
    // 里有一行 `const d = requireDeps()` 且函数体从未使用 `d`，于是 deps 未注入时读该 computed
    // 会抛错，而 Vue 的 computed 在抛错路径上保留旧 `_value` 并丢掉依赖订阅 ⇒ 此后永久返回
    // 上一个用例的残留值。删掉那行死调用后，seed=1792469548946 / 42 / 999 / 7 与正常顺序
    // 全部 32/32 通过；把死调用加回去即 7 例指名变红（含新增的专用回归锁）。
    // 结论：这不是测试夹具债务，是**只读 computed 被强制 fail-closed 造成的缓存污染**。
    ttsVoicesRefs.s2vVoiceCatalog.value = []
    ttsVoicesRefs.s2vVoiceClones.value = []
    ttsVoicesRefs.s2vVoiceCatalogError.value = ''
    ttsVoicesRefs.s2vVoiceProviders.value = [PROVIDER]
    ttsVoicesRefs.s2vVoiceCapability.value = { type: 'user_clone', clone: { enabled: true } }
    deps.s2vConfig.voiceProvider = PROVIDER.id
    deps.s2vConfig.voiceModel = 'speech-2.8-turbo'
    deps.s2vConfig.voiceId = ''
    return deps
  }

  beforeEach(() => {
    // 顶层 beforeEach 已复位全部 mock 入口并给默认值（见文件顶部注释）；这里只补
    // 本 describe 特有的默认返回值。
    chooseCloneSamplesApi.mockResolvedValue({
      code: 0,
      data: { selectionId: 'sel-1', samples: [{ name: 'a.wav' }, { name: 'b.wav' }] },
    })
    addTtsVoiceClone.mockResolvedValue({
      code: 0,
      data: { voice: { id: 'MiniMaxVoice_auto1', name: '音色001' } },
    })
    selectTtsVoice.mockResolvedValue({ code: 0, data: { selectedVoiceId: 'MiniMaxVoice_auto1' } })
  })

  it('克隆成功即写入 s2vConfig.voiceId 并持久化偏好（下拉选中项随之切换）', async () => {
    const deps = setupCloneReady()
    // 目录里已有旧音色：证明「切换」而不是「首次赋值」
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'official-old', name: '旧官方音色' }]
    deps.s2vConfig.voiceId = 'official-old'

    await ttsVoicesMethods.chooseS2VVoiceCloneSamples()

    // 1) 自动入库（name 由 cloneNamePrefix locale 键 + 序号推导；本夹具的 t 为 key 回声）
    expect(addTtsVoiceClone).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'minimax-tts',
      model: 'speech-2.8-turbo',
      name: 'create.story2video.voice.cloneNamePrefix001',
      selectionId: 'sel-1',
      consent: true,
    }))
    // 2) 新克隆音色进入下拉候选（克隆列表是 s2vVoiceOptions 的第二数据源）
    expect(ttsVoicesComputeds.s2vVoiceOptions.value.map(v => v.id))
      .toEqual(['official-old', 'MiniMaxVoice_auto1'])
    // 3) 选中项切换到新克隆音色
    expect(deps.s2vConfig.voiceId).toBe('MiniMaxVoice_auto1')
    // 4) 偏好被持久化（主进程 selectedVoiceId 回写）
    expect(selectTtsVoice).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'minimax-tts',
      model: 'speech-2.8-turbo',
      voiceId: 'MiniMaxVoice_auto1',
    }))
    // 4) 偏好已持久化 —— 以上 selectTtsVoice 的入参就是「真的落盘了」的行为证据；
    // 原先这里还有一条 `expect(s2vPersistedVoiceId).toBe(...)`，但那个 ref 是
    // s2vConfig.voiceId 的冗余镜像、生产零读取（2026-10-20 清理），已一并删除。
    // 5) 克隆进行中态被清掉，不残留占位行
    expect(ttsVoicesRefs.s2vVoiceClonePending.value).toBeNull()
    expect(ttsVoicesRefs.s2vVoiceCloneLoading.value).toBe(false)
    // 6) 成功轻提示（新音色名作为参数传入；本夹具 translate 为 key 回声）
    expect(deps.showOptionsToast).toHaveBeenCalledWith('create.story2video.voice.cloneSuccessToast')
  })

  it('MiMo TTS：克隆音色（mimo-clone- 前缀）也切换选中项，偏好落到 voiceclone 键域', async () => {
    const deps = setupCloneReady()
    ttsVoicesRefs.s2vVoiceProviders.value = [{
      id: 'mimo-tts',
      name: 'MiMo TTS',
      category: 'tts',
      models: ['mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone'],
    }]
    deps.s2vConfig.voiceProvider = 'mimo-tts'
    // 预置音色目录（mimo-v2.5-tts）里已有默认音色
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'mimo_default', name: '默认' }]
    deps.s2vConfig.voiceId = 'mimo_default'
    addTtsVoiceClone.mockResolvedValue({
      code: 0,
      data: { voice: { id: 'mimo-clone-uuid-1', name: '音色001' } },
    })
    selectTtsVoice.mockResolvedValue({ code: 0, data: { selectedVoiceId: 'mimo-clone-uuid-1' } })

    await ttsVoicesMethods.chooseS2VVoiceCloneSamples()

    expect(deps.s2vConfig.voiceId).toBe('mimo-clone-uuid-1')
    expect(ttsVoicesComputeds.s2vVoiceOptions.value.map(v => v.id))
      .toEqual(['mimo_default', 'mimo-clone-uuid-1'])
    // 克隆音色的偏好持久化必须走 voiceclone 模型键（与 registry 同键域）
    expect(selectTtsVoice).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'mimo-tts',
      model: 'mimo-v2.5-tts-voiceclone',
      voiceId: 'mimo-clone-uuid-1',
    }))
  })

  it('偏好持久化失败时回滚到切换前的选中项，不留下从未保存成功的「默认」', async () => {
    const deps = setupCloneReady()
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'official-old', name: '旧官方音色' }]
    deps.s2vConfig.voiceId = 'official-old'
    // 克隆本体成功，但「设为默认」的 IPC 失败
    selectTtsVoice.mockResolvedValue({ code: -1, message: 'VOICE_PREFERENCE_STORE_UNAVAILABLE' })

    await ttsVoicesMethods.chooseS2VVoiceCloneSamples()

    // 新音色仍出现在下拉（克隆事实已成立），但选中项必须回滚到旧值
    expect(ttsVoicesComputeds.s2vVoiceOptions.value.map(v => v.id))
      .toEqual(['official-old', 'MiniMaxVoice_auto1'])
    expect(deps.s2vConfig.voiceId).toBe('official-old')
    // 失败要出声：错误文案 + 不弹「已添加」成功提示
    expect(ttsVoicesRefs.s2vVoiceCatalogError.value).toBeTruthy()
    expect(deps.showOptionsToast).not.toHaveBeenCalled()
  })

  it('并发上下文变更（切换语音生成器）时，过期克隆结果不覆盖新上下文的选中项', async () => {
    const deps = setupCloneReady()
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'official-old', name: '旧官方音色' }]
    deps.s2vConfig.voiceId = 'official-old'
    let resolveAdd
    addTtsVoiceClone.mockImplementation(() => new Promise((resolve) => { resolveAdd = resolve }))

    const flow = ttsVoicesMethods.chooseS2VVoiceCloneSamples()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(addTtsVoiceClone).toHaveBeenCalled()

    // 克隆进行中用户切换了语音生成器：克隆请求上下文随之失效
    ttsVoicesRefs.s2vVoiceCloneRequestId.value += 1
    deps.s2vConfig.voiceProvider = 'other-tts'
    deps.s2vConfig.voiceId = ''

    resolveAdd({ code: 0, data: { voice: { id: 'MiniMaxVoice_auto1', name: '音色001' } } })
    await flow

    // 过期结果被丢弃：不得把旧 provider 的克隆音色写成新上下文的选中项
    expect(deps.s2vConfig.voiceId).toBe('')
    expect(ttsVoicesRefs.s2vVoiceClones.value).toEqual([])
  })

  it('删除被选中的克隆音色时回退到首个可用音色，不留失效选中项', async () => {
    const deps = setupCloneReady()
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'official-old', name: '旧官方音色' }]
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'MiniMaxVoice_auto1', name: '音色001' }]
    deps.s2vConfig.voiceId = 'MiniMaxVoice_auto1'
    deleteCloneApi.mockResolvedValue({ code: 0 })
    selectTtsVoice.mockResolvedValue({ code: 0, data: { selectedVoiceId: 'official-old' } })

    await ttsVoicesMethods.deleteS2VVoiceClone('MiniMaxVoice_auto1')

    expect(ttsVoicesRefs.s2vVoiceClones.value).toEqual([])
    expect(deps.s2vConfig.voiceId).toBe('official-old')
  })

  it('音色目录本次拉取失败时，不清空仍可用的已保存选中项（克隆音色不因刷新失败而丢失）', async () => {
    const deps = setupCloneReady()
    // 先做一次成功加载建立语音上下文（否则首次加载会被判为「上下文切换」而清克隆列表）
    listTtsVoiceClonesApi.mockResolvedValue({ code: 0, data: { voices: [{ id: 'MiniMaxVoice_auto1', name: '音色001' }] } })
    await ttsVoicesMethods.loadS2VVoiceData()
    expect(ttsVoicesRefs.s2vVoiceClones.value.map(v => v.id)).toEqual(['MiniMaxVoice_auto1'])
    deps.s2vConfig.voiceId = 'MiniMaxVoice_auto1'

    // 目录请求失败：只剩克隆列表作为候选源
    getTtsVoiceCatalogApi.mockResolvedValue({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    listTtsVoiceClonesApi.mockResolvedValue({ code: -1, message: 'VOICE_CLONE_STORE_UNAVAILABLE' })

    await ttsVoicesMethods.loadS2VVoiceData({ refresh: true })

    // 刷新失败不得抹掉选中项（PRD：已保存的 voiceId 即使不在最新目录也必须保留）
    expect(deps.s2vConfig.voiceId).toBe('MiniMaxVoice_auto1')
    expect(ttsVoicesRefs.s2vVoiceCatalogError.value).toBeTruthy()
  })

  it('连续两次目录拉取失败仍不清空选中项（i1：失败态不依赖上一次成功残留）', async () => {
    const deps = setupCloneReady()
    listTtsVoiceClonesApi.mockResolvedValue({ code: 0, data: { voices: [{ id: 'MiniMaxVoice_auto1', name: '音色001' }] } })
    await ttsVoicesMethods.loadS2VVoiceData()
    deps.s2vConfig.voiceId = 'MiniMaxVoice_auto1'

    getTtsVoiceCatalogApi.mockResolvedValue({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    listTtsVoiceClonesApi.mockResolvedValue({ code: -1, message: 'VOICE_CLONE_STORE_UNAVAILABLE' })

    // 第一次失败
    await ttsVoicesMethods.loadS2VVoiceData({ refresh: true })
    expect(deps.s2vConfig.voiceId).toBe('MiniMaxVoice_auto1')
    // 紧接着第二次也失败
    await ttsVoicesMethods.loadS2VVoiceData({ refresh: true })
    expect(deps.s2vConfig.voiceId).toBe('MiniMaxVoice_auto1')
    expect(ttsVoicesRefs.s2vVoiceCatalogError.value).toBeTruthy()
  })

  it('目录刷新失败时克隆音色仍是下拉候选，且 persisted 态与选中项一致（i1/i2）', async () => {
    const deps = setupCloneReady()
    // 先建立上下文与克隆候选
    listTtsVoiceClonesApi.mockResolvedValue({ code: 0, data: { voices: [{ id: 'MiniMaxVoice_auto1', name: '音色001' }] } })
    await ttsVoicesMethods.loadS2VVoiceData()
    deps.s2vConfig.voiceId = 'MiniMaxVoice_auto1'

    // 目录与克隆列表**都**拉取失败（真实刷新失败形态）
    getTtsVoiceCatalogApi.mockResolvedValue({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    listTtsVoiceClonesApi.mockResolvedValue({ code: -1, message: 'VOICE_CLONE_STORE_UNAVAILABLE' })

    await ttsVoicesMethods.loadS2VVoiceData({ refresh: true })

    // i2：克隆列表拉取失败时保留原值（不用空数组覆盖）⇒ 它仍在下拉候选集合内，
    // 「保留」不是悬空选择（用户在下拉里看得见这个音色）
    expect(ttsVoicesComputeds.s2vVoiceOptions.value.map(v => v.id)).toEqual(['MiniMaxVoice_auto1'])
    // i1：刷新失败时选中项必须保持在被保留的音色上（不得被归一成空/悬空）
    expect(deps.s2vConfig.voiceId).toBe('MiniMaxVoice_auto1')
    expect(ttsVoicesRefs.s2vVoiceCatalogError.value).toBeTruthy()
  })

  it('目录成功返回但音色不在其中时仍清空选中项（不清空只留给「本次没拿到」）', async () => {
    const deps = setupCloneReady()
    // 目录成功，但既不回 selectedVoiceId 也不含已配置的克隆音色
    getTtsVoiceCatalogApi.mockResolvedValue({ code: 0, data: { voices: [{ id: 'other', name: '别的音色' }], invalidVoices: [] } })
    ttsVoicesRefs.s2vVoiceClones.value = []
    deps.s2vConfig.voiceId = 'MiniMaxVoice_auto1'

    await ttsVoicesMethods.loadS2VVoiceData()

    // 目录拿到了、音色确实不在其中 ⇒ 清空是正确行为（不是「静默丢失」）
    expect(deps.s2vConfig.voiceId).toBe('')
  })

  it('克隆列表权威返回空 + 目录失败时清空选中项（i2：不允许保留无候选的悬空 id）', async () => {
    const deps = setupCloneReady()
    // 目录失败，但克隆列表**成功**返回权威空数组（用户真的把克隆全删了）
    getTtsVoiceCatalogApi.mockResolvedValue({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    listTtsVoiceClonesApi.mockResolvedValue({ code: 0, data: { voices: [] } })
    ttsVoicesRefs.s2vVoiceClones.value = []
    deps.s2vConfig.voiceId = 'MiniMaxVoice_auto1'

    await ttsVoicesMethods.loadS2VVoiceData()

    // 「权威来源说没有」≠「这次没问到」：前者必须清空，否则保留一个无候选可渲染的悬空 id
    expect(deps.s2vConfig.voiceId).toBe('')
  })

  it('上下文切换（换语音生成器）时清掉上一个 provider 的克隆候选（i3：不留可误选的旧音色）', async () => {
    const deps = setupCloneReady()
    // 先在一次成功加载里拿到 provider A 的克隆音色
    listTtsVoiceClonesApi.mockResolvedValue({ code: 0, data: { voices: [{ id: 'clone-of-a', name: 'A的克隆' }] } })
    await ttsVoicesMethods.loadS2VVoiceData()
    expect(ttsVoicesRefs.s2vVoiceClones.value.map(v => v.id)).toEqual(['clone-of-a'])

    // 切到 provider B（上下文变了）——新列表尚未返回时，A 的克隆不得继续留在候选里
    ttsVoicesRefs.s2vVoiceProviders.value = [
      ...ttsVoicesRefs.s2vVoiceProviders.value,
      { id: 'other-tts', name: 'Other TTS', category: 'tts', models: ['m-x'], capability_models: { tts: 'm-x' } },
    ]
    deps.s2vConfig.voiceProvider = 'other-tts'
    deps.s2vConfig.voiceId = ''
    let resolveCatalog
    getTtsVoiceCatalogApi.mockImplementation(() => new Promise((resolve) => { resolveCatalog = resolve }))

    const flow = ttsVoicesMethods.loadS2VVoiceData()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 新列表到达前：A 的克隆已被清掉，不会出现在下拉候选里被误选
    expect(ttsVoicesRefs.s2vVoiceClones.value).toEqual([])
    expect(ttsVoicesComputeds.s2vVoiceOptions.value.map(v => v.id)).not.toContain('clone-of-a')

    resolveCatalog({ code: 0, data: { voices: [], invalidVoices: [] } })
    await flow
  })

  it('同上下文刷新不清克隆候选（与 i3 对照：只有切换才清）', async () => {
    const deps = setupCloneReady()
    listTtsVoiceClonesApi.mockResolvedValue({ code: 0, data: { voices: [{ id: 'clone-of-a', name: 'A的克隆' }] } })
    await ttsVoicesMethods.loadS2VVoiceData()
    expect(ttsVoicesRefs.s2vVoiceClones.value.map(v => v.id)).toEqual(['clone-of-a'])

    // 同 provider 同模型再次刷新（context 未变）：克隆列表拉取失败也应保留原候选
    listTtsVoiceClonesApi.mockResolvedValue({ code: -1, message: 'VOICE_CLONE_STORE_UNAVAILABLE' })
    await ttsVoicesMethods.loadS2VVoiceData({ refresh: true })
    expect(ttsVoicesRefs.s2vVoiceClones.value.map(v => v.id)).toEqual(['clone-of-a'])
  })

  it('未知错误码也能落到「默认音色保存失败」兜底（i1：friendlyVoiceCatalogError 不再恒非空）', async () => {
    const deps = setupCloneReady()
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'official-old', name: '旧官方音色' }]
    deps.s2vConfig.voiceId = 'official-old'
    // 主进程返回一个**不在映射表内**的错误码
    selectTtsVoice.mockResolvedValue({ code: -1, message: 'SOME_BRAND_NEW_UNMAPPED_CODE' })

    await ttsVoicesMethods.chooseS2VVoiceCloneSamples()

    // 修复前：friendlyVoiceCatalogError 对未知码恒返回 catalogLoadFailed ⇒ || 右侧不可达
    // ⇒ 用户看到「语音列表加载失败」。修复后：未知码落到了正确的兜底键。
    expect(ttsVoicesRefs.s2vVoiceCatalogError.value)
      .toBe('create.story2video.voice.selectionSaveFailed')
    expect(deps.s2vConfig.voiceId).toBe('official-old')
  })

  it('切换到 B 失败后切回 A：A 的克隆候选不被抹掉（i1：tracking 只在拉取成功后更新）', async () => {
    const deps = setupCloneReady()
    // 先在 A 上成功拿到克隆候选
    listTtsVoiceClonesApi.mockResolvedValue({ code: 0, data: { voices: [{ id: 'clone-of-a', name: 'A的克隆' }] } })
    await ttsVoicesMethods.loadS2VVoiceData()
    expect(ttsVoicesRefs.s2vVoiceClones.value.map(v => v.id)).toEqual(['clone-of-a'])

    // 切到 B，但目录拉取失败
    ttsVoicesRefs.s2vVoiceProviders.value = [
      ...ttsVoicesRefs.s2vVoiceProviders.value,
      { id: 'other-tts', name: 'Other TTS', category: 'tts', models: ['m-x'], capability_models: { tts: 'm-x' } },
    ]
    deps.s2vConfig.voiceProvider = 'other-tts'
    getTtsVoiceCatalogApi.mockResolvedValue({ code: -1, message: 'VOICE_CATALOG_UNAVAILABLE' })
    await ttsVoicesMethods.loadS2VVoiceData()
    // B 失败：tracking 仍记着 A（未被污染）
    expect(ttsVoicesRefs.s2vVoiceCloneProviderId.value).toBe('minimax-tts')

    // 切回 A：判定为「同上下文刷新」而非「切换」⇒ 不清克隆候选
    deps.s2vConfig.voiceProvider = 'minimax-tts'
    getTtsVoiceCatalogApi.mockResolvedValue({ code: 0, data: { voices: [], invalidVoices: [] } })
    await ttsVoicesMethods.loadS2VVoiceData()
    expect(ttsVoicesRefs.s2vVoiceClones.value.map(v => v.id)).toEqual(['clone-of-a'])
  })

  it('resetS2VVoiceData 默认保留克隆列表、显式 clearClones 才清（i2：语义翻转已具名）', () => {
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'c1', name: 'C1' }]

    // 默认（不传参）：保留 —— 生产唯一调用点已显式传 clearClones，不会误依赖旧语义
    ttsVoicesMethods.resetS2VVoiceData()
    expect(ttsVoicesRefs.s2vVoiceClones.value).toEqual([{ id: 'c1', name: 'C1' }])

    // 显式清空（上下文切换用）
    ttsVoicesMethods.resetS2VVoiceData({ clearClones: true })
    expect(ttsVoicesRefs.s2vVoiceClones.value).toEqual([])
  })
})

describe('useTtsVoices 源文件约束（方案 §2.6 发现 T1 防回流）', () => {
  it('composable 内不得出现 CJK 字符串字面量（否则新路径会撞 Gate 7 --cjk 基线）', () => {
    const src = readFileSync(resolve(here, 'useTtsVoices.js'), 'utf8')
    // 剥掉行注释与块注释后检测（注释中文无妨；扫描器亦剥注释）
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const CJK = /[\u4e00-\u9fff]/
    const bad = code.split('\n').filter((l) => CJK.test(l)).map((l) => l.trim().slice(0, 80))
    expect(bad).toEqual([])
  })
})
