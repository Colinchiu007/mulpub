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

beforeEach(() => {
  resetTtsVoicesForTest()
})

describe('useTtsVoices 契约', () => {
  it('deps 未注入时 fail-closed（抛错而非静默）', () => {
    expect(() => ttsVoicesMethods.getS2VVoiceContext()).toThrow('deps not injected')
    expect(() => ttsVoicesComputeds.s2vVoiceOptions.value).toThrow('deps not injected')
  })

  it('导出面完整：20 状态 ref + 5 计算属性 + 27 方法', () => {
    expect(Object.keys(ttsVoicesRefs)).toHaveLength(20)
    // 5 = 6 - s2vVoiceModelOptions（voice-model-program-resolved 移除「语音模型」下拉）
    expect(Object.keys(ttsVoicesComputeds)).toHaveLength(5)
    // 27 = 28 - handleS2VVoiceModelChange（同上）
    expect(Object.keys(ttsVoicesMethods)).toHaveLength(27)
    // 关键名称在位（壳代理/桥接与 S2V 面板契约按名访问）
    for (const k of ['s2vVoiceCatalog', 's2vVoiceClones', 's2vVoiceCloneLoading', 's2vVoiceProviders']) {
      expect(ttsVoicesRefs).toHaveProperty(k)
    }
    for (const k of ['s2vVoiceProviderOptions', 's2vVoiceModelHidden', 's2vVoiceContextModel', 's2vVoiceOptions']) {
      expect(ttsVoicesComputeds).toHaveProperty(k)
    }
    for (const k of ['loadS2VVoiceData', 'selectS2VVoice', 'addS2VVoiceClone', 'deleteS2VVoiceClone', 'renameS2VVoiceClone']) {
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

  it('resetS2VVoiceData 清空目录/能力/克隆态（不清 requestId 计数）', () => {
    setupTtsVoicesDeps(makeDeps())
    ttsVoicesRefs.s2vVoiceCatalog.value = [{ id: 'v1', name: 'V1' }]
    ttsVoicesRefs.s2vVoiceClones.value = [{ id: 'c1', name: 'C1' }]
    ttsVoicesRefs.s2vVoiceCapability.value = { type: 'user_clone', clone: { enabled: true } }
    ttsVoicesRefs.s2vVoiceCatalogError.value = 'e'
    ttsVoicesRefs.s2vVoiceClonePending.value = { id: 'p', name: 'P', sampleCount: 1 }
    ttsVoicesMethods.resetS2VVoiceData()
    expect(ttsVoicesRefs.s2vVoiceCatalog.value).toEqual([])
    expect(ttsVoicesRefs.s2vVoiceClones.value).toEqual([])
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
