// M-12 运行时实测：S2V 选项变更必须真的触发自动保存。
//
// Why this test exists
// --------------------
// 修 M-12 时我把快照方法体误写进 `watch: {}` 块 ⇒ 监听了一个不存在的属性 ⇒
// handler 永不触发 ⇒ 「选项变更 1s 防抖自动保存」被静默删掉，而 CreateView.test.js
// 的 **288 条用例全绿**——因为既有测试只覆盖"恢复上次选项"（restore），
// 从未覆盖"变更后自动保存"（autosave）。
//
// 静态守卫（options-api-watch-sources.test.js）只能证明"watch 键名存在"，
// 证明不了"handler 真的被调用"。静态过了但功能死了，正是这次的形态。
// 所以必须有一条**真实挂载 + 真实改值 + 真实等防抖**的运行时断言。
//
//   pnpm exec vitest run src/views/s2v-options-autosave.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'

const mockEnsureLogin = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({
    ensureLogin: mockEnsureLogin,
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}))

const storeSetSettingMock = vi.hoisted(() => vi.fn().mockResolvedValue({ code: 0 }))

vi.mock('@/api/publisher', () => ({
  renderStart: vi.fn(),
  renderStartAiVideo: vi.fn(),
  renderCancel: vi.fn(),
  renderGetStatus: vi.fn().mockResolvedValue({ code: 0, data: { ready: true } }),
  renderInstallDeps: vi.fn().mockResolvedValue({ code: 0, data: { success: true } }),
  onRenderProgress: vi.fn().mockReturnValue(vi.fn()),
  onRenderComplete: vi.fn().mockReturnValue(vi.fn()),
  onRenderError: vi.fn().mockReturnValue(vi.fn()),
  onRenderInstallProgress: vi.fn().mockReturnValue(vi.fn()),
  onPipelineUpdate: vi.fn().mockReturnValue(vi.fn()),
  modelProviderGetDefault: vi.fn().mockResolvedValue({ code: 0, data: { id: 'openai' } }),
  aiGenerate: vi.fn().mockResolvedValue({ code: 0, data: { content: 'x' } }),
  pipelineList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  pipelineStart: vi.fn(),
  pipelinePause: vi.fn(),
  pipelinePauseRun: vi.fn(),
  pipelineResume: vi.fn(),
  pipelineCancel: vi.fn(),
  pipelineStatus: vi.fn(),
  pipelineAdvance: vi.fn(),
  pipelineHistory: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  pipelineStartOrchestrated: vi.fn(),
  pipelineResumeOrchestration: vi.fn(),
  pipelineAdvanceToNextCheckpoint: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelineConfirmSceneAssets: vi.fn(),
  pipelineDeleteRun: vi.fn(),
  draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoCreateShareUrl: vi.fn(async () => ({ code: 0, data: { url: 'media://x' } })),
  storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: null }),
  storeSetSetting: (...args) => storeSetSettingMock(...args),
  story2videoImportMedia: vi.fn(),
  story2videoTranscribe: vi.fn(),
  story2videoListProjects: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoGetThumbnail: vi.fn().mockResolvedValue({ code: 0, data: { status: 'missing', url: null } }),
  story2videoSaveAs: vi.fn().mockResolvedValue({ code: 0, data: { path: '/saved/video.mp4', cancelled: true } }),
  story2videoDeleteProject: vi.fn(),
  story2videoBgmLibraryList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBgmLibraryAdd: vi.fn(),
  story2videoBgmLibraryRename: vi.fn(),
  story2videoBgmLibraryDelete: vi.fn(),
  story2videoBgmLibraryStatus: vi.fn().mockResolvedValue({ code: -1, message: 'unavailable' }),
  story2videoConfigProfileList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoConfigProfileCreate: vi.fn().mockResolvedValue({ code: -1, message: 'unavailable' }),
  story2videoConfigProfileRename: vi.fn().mockResolvedValue({ code: -1, message: 'unavailable' }),
  story2videoConfigProfileDelete: vi.fn().mockResolvedValue({ code: -1, message: 'unavailable' }),
  story2videoBatchCreate: vi.fn().mockResolvedValue({ code: 0, data: { batchId: 'b1', items: [] } }),
  story2videoBatchStatus: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBatchCancel: vi.fn().mockResolvedValue({ code: 0, data: { success: true, cancelled: 1 } }),
  story2videoPickBatchFiles: vi.fn().mockResolvedValue({ code: 0, data: { files: [] } }),
}))

vi.mock('@/api/tts-voice-catalog', () => ({
  getTtsVoiceCatalog: vi.fn().mockResolvedValue({ code: 0, data: { providerId: '', model: '', selectedVoiceId: null, voices: [] } }),
  getTtsVoiceCapability: vi.fn().mockResolvedValue({ code: 0, data: { type: 'user_clone', clone: { enabled: true } } }),
  selectTtsVoice: vi.fn().mockResolvedValue({ code: 0, data: { providerId: '', model: '', selectedVoiceId: null, voices: [] } }),
  clearTtsVoicePreference: vi.fn().mockResolvedValue({ code: 0, data: { providerId: '', model: '', selectedVoiceId: null } }),
}))

vi.mock('@/api/tts-voice-clone', () => ({
  addTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: 'UNAVAILABLE' }),
  chooseTtsVoiceCloneSamples: vi.fn().mockResolvedValue({ code: -1, message: 'UNAVAILABLE' }),
  deleteTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: 'UNAVAILABLE' }),
  getTtsVoiceCloneRequirements: vi.fn().mockResolvedValue({ code: -1, message: 'UNAVAILABLE' }),
  listTtsVoiceClones: vi.fn().mockResolvedValue({ code: -1, message: 'UNAVAILABLE' }),
  renameTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: 'UNAVAILABLE' }),
}))

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/create', name: 'create', component: { template: '<div>create</div>' } }],
})

import UiButton from '@/components/UiButton.vue'
import UiSelect from '@/components/UiSelect.vue'
import CreateView from './CreateView.vue'
import CreateViewHistory from './CreateViewHistory.vue'
import { PipelineSelector, StageProgress } from './video-creation'
import i18n from '@/i18n'

config.global.stubs = { ...(config.global.stubs || {}), teleport: true }

function mountCreateView () {
  return mount(CreateView, {
    global: {
      plugins: [router, i18n],
      components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress },
    },
  })
}

/** 进入 story2video-compose 流水线 —— saveS2VLastOptions 只在编排流水线下才落盘。 */
async function enterS2V (wrapper) {
  wrapper.vm.selectedPipeline = { name: 'story2video-compose', available: true, stages: [] }
  await nextTick()
}

describe('M-12：S2V 选项变更必须真的触发自动保存（运行时实测）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
    storeSetSettingMock.mockResolvedValue({ code: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('顶层选项变更后 1s 防抖自动落盘 story2video.lastOptions.v1', async () => {
    vi.useFakeTimers()
    const w = mountCreateView()
    await nextTick()
    await enterS2V(w)

    w.vm.s2vConfig.imageStyle = 'cyberpunk'
    await nextTick()
    vi.advanceTimersByTime(1100)
    await nextTick()

    expect(
      storeSetSettingMock.mock.calls.filter((c) => c[0] === 'story2video.lastOptions.v1').length,
      '改了选项却没落盘 ⇒ watch handler 没触发（本次事故形态：方法体误放进 watch 块，' +
      '监听了一个不存在的属性，自动保存被静默删掉）'
    ).toBeGreaterThan(0)
    w.unmount()
  })

  it('嵌套选项变更（subtitleStyle 深层字段）同样触发自动保存', async () => {
    vi.useFakeTimers()
    const w = mountCreateView()
    await nextTick()
    await enterS2V(w)

    // M-12 的性能论点就在这里：原先两条 deep watch 会对整棵配置树做深度遍历。
    // 改成快照比较后开销降到 O(对象大小)，但**语义不可退化** —— 深层写入仍须被感知。
    const nested = w.vm.s2vConfig.subtitleStyle || {}
    w.vm.s2vConfig.subtitleStyle = { ...nested, color: '#ff0000' }
    await nextTick()
    vi.advanceTimersByTime(1100)
    await nextTick()

    expect(
      storeSetSettingMock.mock.calls.filter((c) => c[0] === 'story2video.lastOptions.v1').length,
      '嵌套字段改了却没落盘 ⇒ 快照比较漏掉了嵌套变化，deep→shallow 改造语义退化'
    ).toBeGreaterThan(0)
    w.unmount()
  })

  it('反证：值没变就不该重复落盘（防退化为"任何东西一动就写"）', async () => {
    vi.useFakeTimers()
    const w = mountCreateView()
    await nextTick()
    await enterS2V(w)

    // 写入相同值：快照字符串不变 ⇒ watch 不触发
    w.vm.s2vConfig.imageStyle = w.vm.s2vConfig.imageStyle
    await nextTick()
    vi.advanceTimersByTime(1100)
    await nextTick()

    const writes = storeSetSettingMock.mock.calls.filter((c) => c[0] === 'story2video.lastOptions.v1')
    expect(
      writes.length,
      '值没变却落盘了 ⇒ 监听的不是快照而是"任何依赖变化"，M-12 的性能收益并不存在'
    ).toBe(0)
    w.unmount()
  })

  it('配置档套用中（s2vConfigProfileApplying）不触发自动保存，避免把档名清掉', async () => {
    vi.useFakeTimers()
    const w = mountCreateView()
    await nextTick()
    await enterS2V(w)

    w.vm.s2vConfigProfileApplying = true
    w.vm.s2vActiveConfigProfile = 'my-profile'
    w.vm.s2vConfig.imageStyle = 'watercolor'
    await nextTick()
    vi.advanceTimersByTime(1100)
    await nextTick()

    expect(w.vm.s2vActiveConfigProfile, '套用档期间不该把当前档名清成空').toBe('my-profile')
    w.unmount()
  })
})
