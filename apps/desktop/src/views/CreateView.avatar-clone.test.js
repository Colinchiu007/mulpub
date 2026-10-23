// @ts-check
/**
 * CreateView.avatar-clone.test.js — 形象克隆面板（avatar-voice-clone）UI 契约
 *
 * 锁定：
 *  - 面板只在数字人流水线 + 点「管理克隆形象」后渲染
 *  - 一次性合规提示默认展示，点「我已了解」后不再展示（不强制勾选）
 *  - 形象下拉 = 公共目录 ∪ 克隆形象，克隆项带来源标识且排在前面（提案 Q9）
 *  - 创建走两段式：chooseMedia（主进程对话框）→ add；用户取消不报错
 *  - 失败文案经 locale key 呈现（不在渲染端写中文）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'
import CreateView from './CreateView.vue'
import UiButton from '@/components/UiButton.vue'
import UiSelect from '@/components/UiSelect.vue'
import CreateViewHistory from './CreateViewHistory.vue'
import PipelineSelector from './video-creation/PipelineSelector.vue'
import StageProgress from './video-creation/StageProgress.vue'

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn(async () => true),
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}))

const listAvatarClones = vi.hoisted(() => vi.fn())
const chooseAvatarCloneMedia = vi.hoisted(() => vi.fn())
const addAvatarClone = vi.hoisted(() => vi.fn())
const deleteAvatarClone = vi.hoisted(() => vi.fn())
const renameAvatarClone = vi.hoisted(() => vi.fn())

const getAvatarCatalog = vi.hoisted(() => vi.fn())
const getAvatarVoiceCatalog = vi.hoisted(() => vi.fn())
const modelProviderList = vi.hoisted(() => vi.fn())
const modelProviderGetDefault = vi.hoisted(() => vi.fn())

vi.mock('@/api/avatar-catalog', () => ({
  getAvatarCatalog,
  getAvatarVoiceCatalog,
  invalidateAvatarCatalog: vi.fn(),
}))

// change: digital-human-multiprovider —— 数字人服务商下拉的数据源。
// 默认只返 heygen（带 digital_human capability）；kling 不带，用来验证筛选。
vi.mock('@/api/model-providers', () => ({
  modelProviderList,
  modelProviderGetDefault,
}))

vi.mock('@/api/avatar-clone', () => ({
  listAvatarClones,
  chooseAvatarCloneMedia,
  addAvatarClone,
  deleteAvatarClone,
  renameAvatarClone,
}))

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
  aiGenerate: vi.fn().mockResolvedValue({ code: 0, data: { content: '文案' } }),
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
  story2videoConfigProfileList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoConfigProfileCreate: vi.fn().mockResolvedValue({ code: -1, message: 'unavailable' }),
  story2videoConfigProfileRename: vi.fn().mockResolvedValue({ code: -1, message: 'unavailable' }),
  story2videoConfigProfileDelete: vi.fn().mockResolvedValue({ code: -1, message: 'unavailable' }),
  story2videoBatchCreate: vi.fn().mockResolvedValue({ code: 0, data: { batchId: 'b1', items: [] } }),
  story2videoBatchStatus: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBatchCancel: vi.fn().mockResolvedValue({ code: 0, data: { success: true, cancelled: 1 } }),
  story2videoPickBatchFiles: vi.fn().mockResolvedValue({ code: 0, data: { files: [] } }),
}))

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: { template: '<div/>' } }],
})

const CLONES = [
  { id: 'cl-1', name: '我的形象', sourceKind: 'self', mediaType: 'image', trainingState: 'completed', deletionState: 'active', createdAt: 1 },
]

async function mountView () {
  const w = mount(CreateView, {
    global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } },
  })
  await nextTick()
  return w
}

async function selectPipeline (w, name) {
  w.vm.selectPipeline({ name, available: true, stages: [] })
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

describe('形象克隆面板（avatar-voice-clone）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    listAvatarClones.mockReset()
    chooseAvatarCloneMedia.mockReset()
    addAvatarClone.mockReset()
    deleteAvatarClone.mockReset()
    renameAvatarClone.mockReset()
    listAvatarClones.mockResolvedValue({ code: 0, data: { avatars: [] } })
    getAvatarCatalog.mockReset()
    getAvatarVoiceCatalog.mockReset()
    modelProviderList.mockReset()
    modelProviderGetDefault.mockReset()
    getAvatarCatalog.mockResolvedValue({ code: 0, data: { avatars: [{ id: 'ava-1', name: '小雅' }, { id: 'ava-2', name: '小博' }] } })
    getAvatarVoiceCatalog.mockResolvedValue({ code: 0, data: { voices: [{ id: 'voice-1', name: '甜美女声' }] } })
    // video 列表里只有 heygen 带 digital_human capability；kling 是通用文生视频。
    // data 直接是数组，且要求 enabled + is_configured 双 true（与 CreateView 的 enabledProviders 一致）。
    modelProviderList.mockResolvedValue({
      code: 0,
      data: [
        { id: 'heygen', name: 'HeyGen', category: 'video', capabilities: ['video', 'digital_human'], enabled: true, is_configured: true },
        { id: 'kling', name: 'Kling', category: 'video', capabilities: ['video'], enabled: true, is_configured: true },
      ],
    })
    modelProviderGetDefault.mockResolvedValue({ code: 0, data: { id: 'heygen' } })
    const { resetAvatarCatalogForTest } = await import('./video-creation/composables/useAvatarCatalog')
    resetAvatarCatalogForTest()
    // 克隆列表同样是模块级单例：不复位会让上一条的列表残留进下一条
    const { resetAvatarCloneForTest } = await import('./video-creation/composables/useAvatarClone')
    resetAvatarCloneForTest()
  })

  it('默认不渲染面板，点「管理克隆形象」后渲染', async () => {
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    expect(w.find('[data-testid="avatar-clone-panel"]').exists()).toBe(false)
    expect(w.find('[data-testid="avatar-clone-manage"]').exists()).toBe(true)

    await w.find('[data-testid="avatar-clone-manage"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="avatar-clone-panel"]').exists()).toBe(true)
    w.unmount()
  })

  it('选中流水线时就拉取克隆列表（形象下拉要能合并克隆项）', async () => {
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await new Promise((r) => setTimeout(r, 0))
    expect(listAvatarClones).toHaveBeenCalled()
    w.unmount()
  })

  it('打开面板不重复拉列表（选中时已加载）', async () => {
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    const before = listAvatarClones.mock.calls.length
    await w.find('[data-testid="avatar-clone-manage"]').trigger('click')
    await nextTick()
    expect(listAvatarClones.mock.calls.length).toBe(before)
    w.unmount()
  })

  it('一次性合规提示默认展示，点「我已了解」后消失（不强制勾选）', async () => {
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await w.find('[data-testid="avatar-clone-manage"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="avatar-clone-notice"]').exists()).toBe(true)

    await w.find('[data-testid="avatar-clone-notice-ack"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="avatar-clone-notice"]').exists()).toBe(false)
    // 提示消失不应影响创建入口仍可用（不阻断流程）
    expect(w.find('[data-testid="avatar-clone-create-photo"]').exists()).toBe(true)
    w.unmount()
  })

  it('空列表 → 空态提示', async () => {
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await w.find('[data-testid="avatar-clone-manage"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="avatar-clone-empty"]').exists()).toBe(true)
    w.unmount()
  })

  it('有克隆形象 → 列表渲染并可删除', async () => {
    listAvatarClones.mockResolvedValue({ code: 0, data: { avatars: CLONES } })
    deleteAvatarClone.mockResolvedValue({ code: 0, data: { deleted: true } })
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await w.find('[data-testid="avatar-clone-manage"]').trigger('click')
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()

    expect(w.find('[data-testid="avatar-clone-list"]').exists()).toBe(true)
    expect(w.vm.avatarClones).toHaveLength(1)

    await w.find('[data-testid="avatar-clone-delete-cl-1"]').trigger('click')
    await nextTick()
    expect(deleteAvatarClone).toHaveBeenCalled()
    // providerId 由当前选中的服务商带入（空串 = 未解析出 provider，主进程回落默认）
    expect(deleteAvatarClone.mock.calls[0][0]).toMatchObject({ avatarId: 'cl-1' })
    w.unmount()
  })

  it('形象下拉合并克隆项，且克隆项排在公共目录前（提案 Q9）', async () => {
    listAvatarClones.mockResolvedValue({ code: 0, data: { avatars: CLONES } })
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    // 等公共目录 + 克隆列表两个异步都完成（两者都在选中流水线时触发）
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()

    const options = w.vm.mergedAvatarOptions()
    expect(options[0].id).toBe('cl-1')
    expect(options[0].clone).toBe(true)
    expect(options.map((o) => o.id)).toContain('ava-1')
    w.unmount()
  })

  it('失效克隆项不进形象下拉（training_failed / 远端失效）', async () => {
    listAvatarClones.mockResolvedValue({
      code: 0,
      data: { avatars: [{ ...CLONES[0], invalidReason: 'training_failed' }] },
    })
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    expect(w.vm.mergedAvatarOptions().map((o) => o.id)).not.toContain('cl-1')
    w.unmount()
  })

  it('创建走两段式：chooseMedia → add', async () => {
    chooseAvatarCloneMedia.mockResolvedValue({ code: 0, data: { selectionId: 'sel-1' } })
    addAvatarClone.mockResolvedValue({ code: 0, data: { avatar: { id: 'cl-9', name: '新形象' } } })
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await w.find('[data-testid="avatar-clone-manage"]').trigger('click')
    await nextTick()
    w.vm.avatarCloneNameDraft = '新形象'
    await nextTick()

    await w.find('[data-testid="avatar-clone-create-photo"]').trigger('click')
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(chooseAvatarCloneMedia).toHaveBeenCalledWith({ type: 'photo' })
    expect(addAvatarClone).toHaveBeenCalledWith(expect.objectContaining({
      selectionId: 'sel-1', name: '新形象', type: 'photo',
    }))
    w.unmount()
  })

  it('用户取消对话框 → 不报错、不调 add', async () => {
    chooseAvatarCloneMedia.mockResolvedValue({ code: 0, data: { paths: [] } })
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await w.find('[data-testid="avatar-clone-manage"]').trigger('click')
    await nextTick()
    w.vm.avatarCloneNameDraft = 'x'
    await nextTick()

    await w.find('[data-testid="avatar-clone-create-photo"]').trigger('click')
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(addAvatarClone).not.toHaveBeenCalled()
    expect(w.find('[data-testid="avatar-clone-create-error"]').exists()).toBe(false)
    w.unmount()
  })

  it('创建失败 → 错误文案经 locale key 呈现（渲染端不写中文）', async () => {
    chooseAvatarCloneMedia.mockResolvedValue({ code: 0, data: { selectionId: 'sel-1' } })
    addAvatarClone.mockResolvedValue({ code: -1, message: 'AVATAR_CLONE_DUPLICATE_ID' })
    const w = await mountView()
    await selectPipeline(w, 'avatar-spokesperson')
    await w.find('[data-testid="avatar-clone-manage"]').trigger('click')
    await nextTick()
    w.vm.avatarCloneNameDraft = 'x'
    await nextTick()

    await w.find('[data-testid="avatar-clone-create-photo"]').trigger('click')
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(w.vm.avatarCloneCreateError).toBe('avatarCloneErrDuplicate')
    // 渲染出的应是 locale 值而不是 key 本身
    const rendered = w.find('[data-testid="avatar-clone-create-error"]').text()
    expect(rendered).not.toBe('avatarCloneErrDuplicate')
    expect(rendered.length).toBeGreaterThan(0)
    w.unmount()
  })

  // ── change: digital-human-multiprovider：服务商切换 ──────────────────

  describe('数字人服务商切换', () => {
    it('下拉只列声明了 digital_human 能力的 provider', async () => {
      getAvatarCatalog.mockResolvedValue({ code: 0, data: { avatars: [{ id: 'ava-1', name: '小雅' }] } })
      const w = await mountView()
      await selectPipeline(w, 'avatar-spokesperson')
      await new Promise((r) => setTimeout(r, 0))
      await nextTick()

      // 本用例只配了 heygen（夹具里 kling 无 digital_human capability）
      expect(w.vm.avatarProviderOptions.map((p) => p.id)).toEqual(['heygen'])
      expect(w.vm.avatarProviderId).toBe('heygen')
      // 只有一家时下拉禁用（切换无意义，避免用户点了没反应）
      expect(w.find('[data-testid="avatar-provider-select"]').attributes('disabled')).toBeDefined()
      w.unmount()
    })

    it('切换服务商：清空已选形象/音色 + 重拉克隆列表并带上新 providerId', async () => {
      listAvatarClones.mockResolvedValue({ code: 0, data: { avatars: [] } })
      const w = await mountView()
      await selectPipeline(w, 'avatar-spokesperson')
      await new Promise((r) => setTimeout(r, 0))
      await nextTick()

      w.vm.avatarId = 'ava-1'
      w.vm.avatarVoiceId = 'voice-1'
      listAvatarClones.mockClear()

      await w.vm.switchAvatarProvider('hifly')
      await new Promise((r) => setTimeout(r, 0))
      await nextTick()

      expect(w.vm.avatarProviderId).toBe('hifly')
      // 两家 id 同形，留着旧值等于让用户误选另一家的资源
      expect(w.vm.avatarId).toBe('')
      expect(w.vm.avatarVoiceId).toBe('')
      // 克隆列表按 provider 分段，必须带新 providerId 重拉
      expect(listAvatarClones).toHaveBeenCalledWith({ providerId: 'hifly' })
      w.unmount()
    })
  })
})
