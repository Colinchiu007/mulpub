// @ts-check
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, reactive, nextTick, computed } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import FilmEngineeringView from './FilmEngineeringView.vue'
import i18n from '@/i18n'

const composable = {
  status: ref(null),
  statusLoading: ref(false),
  scenes: ref([]),
  scenesLoading: ref(false),
  selectedSceneId: ref(null),
  shots: ref([]),
  shotsLoading: ref(false),
  shotsTotal: ref(0),
  shotsOffset: ref(0),
  shotsHasMore: ref(false),
  shotsLoadingMore: ref(false),
  loadMoreShots: vi.fn(),
  shotDetail: ref(null),
  detailLoading: ref(false),
  doctrine: ref(null),
  selectedShotIds: ref([]),
  copyMode: ref('full'),
  generating: ref(false),
  exportLoading: ref(false),
  adapt: reactive({ script: '', characterMap: {}, llmEnabled: false, adaptedShots: [], warnings: [], loading: false }),
  refreshAll: vi.fn().mockResolvedValue(false),
  selectScene: vi.fn(),
  openShot: vi.fn(),
  toggleShot: vi.fn(),
  toggleAllInScene: vi.fn(),
  copyText: vi.fn(),
  copySelected: vi.fn(),
  exportSelected: vi.fn(),
  generateSelected: vi.fn(),
  adaptScript: vi.fn(),
  copyAdaptedShot: vi.fn(),
  buildConfigProfileSnapshot: vi.fn((entries) => ({
    schemaVersion: 1,
    capturedAt: '2026-08-29T00:00:00.000Z',
    kind: 'film-engineering',
    filmEngineering: { copyMode: composable.copyMode.value, characterMap: Object.fromEntries((entries || []).map((entry) => [entry.key, entry.value])) },
  })),
  applyConfigProfileSnapshot: vi.fn(() => true),
  loadConfigProfiles: vi.fn().mockResolvedValue([]),
  saveConfigProfile: vi.fn().mockResolvedValue({ code: 0, data: { id: 'profile-000000000001', name: '工程配置', pipelineId: 'film-engineering', snapshot: { schemaVersion: 1 }, updatedAt: 1 } }),
  renameConfigProfile: vi.fn().mockResolvedValue({ code: 0, data: { id: 'profile-000000000001', name: '新名', pipelineId: 'film-engineering', snapshot: { schemaVersion: 1 }, updatedAt: 2 } }),
  deleteConfigProfile: vi.fn().mockResolvedValue({ code: 0, data: { deleted: true, id: 'profile-000000000001' } }),
}

vi.mock('@/composables/useFilmEngineering', () => ({ useFilmEngineering: () => composable }))

function mountView () {
  return mount(FilmEngineeringView, {
    global: {
      plugins: [i18n],
      compilerOptions: {
        isCustomElement: (tag) => tag.startsWith('el-'),
      },
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        Transition: { template: '<div><slot /></div>' },
        'el-tree': { template: '<div class="el-tree-stub"></div>' },
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  composable.status.value = null
  composable.selectedShotIds.value = []
  composable.copyMode.value = 'full'
  composable.adapt.script = ''
  composable.adapt.characterMap = {}
  composable.scenes.value = []
  composable.shots.value = []
})

describe('FilmEngineeringView configuration profiles', () => {
  it('renders the profile manager for the film-engineering pipeline and refreshes the page data', async () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="film-engineering-config-profile-save"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="film-engineering-config-profile-manage"]').exists()).toBe(true)
    expect(composable.refreshAll).toHaveBeenCalledTimes(1)
    await nextTick()
  })

  it('keeps the unavailable retry action wired', async () => {
    composable.status.value = { available: false, error: 'kit missing', filmMeta: null, sceneCount: 0, shotCount: 0, referenceCount: 0 }
    const wrapper = mountView()
    await nextTick()
    // 全局 test-setup 将 el-button stub 为 <button class="el-button">（优先于 isCustomElement），
    // 故用类选择器定位重试按钮，验证其 click 仍透传到 refreshAll。
    const retry = wrapper.find('.fe-actions .el-button')
    expect(retry.exists()).toBe(true)
    await retry.trigger('click')
    expect(composable.refreshAll).toHaveBeenCalledTimes(2)
  })

  it('routes profile save through the page wrapper and passes roleEntries to the composable', async () => {
    const wrapper = mountView()
    await wrapper.find('[data-testid="film-engineering-config-profile-save"]').trigger('click')
    await wrapper.find('[data-testid="film-engineering-config-profile-name-input"]').setValue('工程配置')
    await wrapper.find('[data-testid="film-engineering-config-profile-save-confirm"]').trigger('click')
    await flushPromises()
    expect(composable.saveConfigProfile).toHaveBeenCalledTimes(1)
    const [, entries, options] = composable.saveConfigProfile.mock.calls[0]
    expect(Array.isArray(entries)).toBe(true)
    expect(entries).toHaveLength(4)
    expect(options).toEqual(expect.objectContaining({ snapshot: expect.objectContaining({ kind: 'film-engineering' }) }))
  })

  it('keeps the film library actions available when status is ready', async () => {
    composable.status.value = { available: true, filmMeta: { title: 'Film', logline: 'Logline', durationSec: 60 }, sceneCount: 1, shotCount: 1, referenceCount: 0 }
    composable.selectedSceneId.value = 'scene-1'
    composable.shots.value = [{ shotId: 'shot-0001', sceneId: 'scene-1', prompt: 'prompt', model: 'model' }]
    const wrapper = mountView()
    await nextTick()
    expect(wrapper.find('[data-testid="fe-copy-selected"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="fe-export-json"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="fe-export-markdown"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="fe-generate"]').exists()).toBe(true)
  })
  it('8.1 production entry button is disabled when no shots selected', async () => {
    composable.status.value = { available: true, filmMeta: { title: 'Film', logline: 'L', durationSec: 60 }, sceneCount: 1, shotCount: 1, referenceCount: 0 }
    composable.selectedSceneId.value = 'sc-1'
    composable.shots.value = [{ shotId: 'shot-0001', sceneId: 'sc-1', prompt: 'p', model: 'm' }]
    await nextTick()
    const wrapper = mountView()
    await nextTick()
    const btn = wrapper.find('[data-testid="fe-production-entry"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('8.1 production entry button is enabled when shots selected', async () => {
    composable.status.value = { available: true, filmMeta: { title: 'Film', logline: 'L', durationSec: 60 }, sceneCount: 1, shotCount: 1, referenceCount: 0 }
    composable.selectedSceneId.value = 'sc-1'
    composable.shots.value = [{ shotId: 'shot-0001', sceneId: 'sc-1', prompt: 'p', model: 'm' }]
    await nextTick()
    composable.selectedShotIds.value = ['s-a', 's-b']
    const wrapper = mountView()
    await nextTick()
    const btn = wrapper.find('[data-testid="fe-production-entry"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('8.1 clicking production entry opens the dialog (plan-ready phase)', async () => {
    composable.status.value = { available: true, filmMeta: { title: 'Film', logline: 'L', durationSec: 60 }, sceneCount: 1, shotCount: 1, referenceCount: 0 }
    composable.selectedSceneId.value = 'sc-1'
    composable.shots.value = [{ shotId: 'shot-0001', sceneId: 'sc-1', prompt: 'p', model: 'm' }]
    await nextTick()
    // 全局 el-dialog 由 isCustomElement stub 处理，检查 v-model 状态即可
    composable.selectedShotIds.value = ['s-x']
    const wrapper = mountView()
    await nextTick()
    const btn = wrapper.find('[data-testid="fe-production-entry"]')
    await btn.trigger('click')
    await nextTick()
    // productionPanelOpen ref 应为 true
    expect(wrapper.vm.productionPanelOpen).toBe(true)
  })

  // PRD-HREF-SCHEME-GUARD：元信息里的 projectUrl 属外部数据，非 http/https 不得成链
  it('来源链接：projectUrl 合法时成链且带 rel=noopener，非法时不成链但文本保留', async () => {
    composable.status.value = {
      available: true,
      filmMeta: { title: 'Film', logline: 'L', durationSec: 60, characters: [], source: { projectUrl: 'https://example.com/proj' } },
      sceneCount: 0, shotCount: 0, referenceCount: 0,
    }
    const w = mountView()
    await nextTick()
    const link = w.find('el-link.fe-meta-link')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('https://example.com/proj')
    expect(String(link.attributes('rel') || '')).toContain('noopener')

    composable.status.value = {
      available: true,
      filmMeta: { title: 'Film', logline: 'L', durationSec: 60, characters: [], source: { projectUrl: 'javascript:alert(1)' } },
      sceneCount: 0, shotCount: 0, referenceCount: 0,
    }
    await nextTick()
    expect(w.find('el-link.fe-meta-link').exists()).toBe(false)
    const plain = w.find('span.fe-meta-link')
    expect(plain.exists()).toBe(true)
    expect(plain.text()).toBe('javascript:alert(1)')
  })

  // video-copy-refine（2026-10-19）：分镜库总标题由「随包数据的原始片名」改为 i18n 文案。
  // 回归面：即使 kit 的 filmMeta.title 仍是旧片名（数据层不动），界面也不得把它显示出来。
  it('分镜库总标题渲染 i18n 文案「影响项目案例」，不渲染 kit 里的 filmMeta.title', async () => {
    composable.status.value = {
      available: true,
      filmMeta: { title: 'Hell Grind', logline: 'L', durationSec: 60, characters: [], source: { projectUrl: 'https://example.com/proj' } },
      sceneCount: 0, shotCount: 0, referenceCount: 0,
    }
    const w = mountView()
    await nextTick()
    const title = w.find('.fe-meta-title')
    expect(title.exists()).toBe(true)
    expect(title.text()).toBe('影响项目案例')
    // 总标题不得泄漏 kit 的 filmMeta.title。
    // 注意：剧本套用 tab 的角色映射提示（adapt.roleMapHint / roleKeyPlaceholder）仍会提到原始项目
    // 与其角色名（ROKO 等）—— 那是 kit 数据的客观事实、不在本次改动范围内，故不断言整页文本。
  })
})

/**
 * 回归保护（2026-10-07）：全量出片「逐批确认」必须显示批次上下文。
 *
 * Bug：`production.batchCard`（含 {i}/{n}/{count}/{aspect}/{seconds} 五个占位符）
 * 全仓零引用；而 `confirmBatch` 文案「确认执行本批」本身没有任何占位符，却被传了
 * 那五个参数——结果是用户点确认前**看不到本批要出几镜、什么画幅、什么时长**，
 * 而这是「逐批确认后才计费」里唯一的付费前核对信息。
 *
 * 反证纪律：删掉模板里那行 batchCard，本组必须变红。
 */
describe('FilmEngineeringView 全量出片 · 批次上下文（付费前核对）', () => {
  function mkProduction (overrides = {}) {
    return {
      phase: ref('batching'),
      busy: ref(false),
      plan: ref(null),
      taskId: ref('tk'),
      shotIds: ref([]),
      chosen: ref({ aspect: '16x9', seconds: 5 }),
      batches: ref([
        { batchIndex: 0, shotCount: 10, status: 'pending', error: null, doneShots: 0 },
        { batchIndex: 1, shotCount: 4, status: 'pending', error: null, doneShots: 0 },
      ]),
      progress: ref({ doneCount: 0, totalCount: 14 }),
      renderManifest: ref(null),
      manifestError: ref(null),
      failedBatches: ref([]),
      confirmedShotCount: ref(0),
      remainingBatchCount: ref(2),
      recycled: ref(null),
      finalPath: ref(null),
      errorCode: ref(null),
      errorText: ref(null),
      batchCount: computed(() => 2),
      planProduction: vi.fn(),
      begin: vi.fn(),
      confirmBatch: vi.fn(),
      resume: vi.fn(),
      retryShotInBatch: vi.fn(),
      recycleAll: vi.fn(),
      composeFinal: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
      ...overrides,
    }
  }

  let productionMock = null

  beforeEach(() => {
    vi.resetModules()
    productionMock = mkProduction()
    vi.doMock('@/composables/useFilmProduction', () => ({ useFilmProduction: () => productionMock }))
  })

  async function mountBatching () {
    const { mount: mountLocal, flushPromises: fp } = await import('@vue/test-utils')
    const { default: View } = await import('./FilmEngineeringView.vue')
    composable.status.value = { available: true, filmMeta: { title: 'F', logline: 'L', durationSec: 60 }, sceneCount: 1, shotCount: 1, referenceCount: 0 }
    composable.selectedShotIds.value = ['shot-0001']
    const wrapper = mountLocal(View, {
      global: {
        plugins: [i18n],
        compilerOptions: { isCustomElement: (tag) => tag.startsWith('el-') },
        stubs: { Teleport: { template: '<div><slot /></div>' }, Transition: { template: '<div><slot /></div>' }, 'el-tree': { template: '<div class="el-tree-stub"></div>' } },
      },
    })
    await fp()
    await wrapper.find('[data-testid="fe-production-entry"]').trigger('click')
    await fp()
    return wrapper
  }

  it('每个待确认批次都渲染批次上下文（批号/镜数/画幅/时长）', async () => {
    const wrapper = await mountBatching()
    const cards = wrapper.findAll('[data-testid="fe-production-batch-card"]')
    expect(cards.length).toBe(2)
    // 第 1 批：第 1/2 批 · 10 个分镜 · 16:9 · 5 秒
    // 画幅必须显示**与画幅下拉逐字相同**的标签（"16:9 横屏"），而不是原始枚举 "16x9"
    expect(cards[0].text()).toContain('1/2')
    expect(cards[0].text()).toContain('10')
    expect(cards[0].text()).toContain('16:9 横屏')
    expect(cards[0].text()).not.toContain('16x9')
    expect(cards[0].text()).toContain('5s')
    // 第 2 批镜数不同，必须各按自己的数量渲染
    expect(cards[1].text()).toContain('2/2')
    expect(cards[1].text()).toContain('4')
  })

  it('确认按钮保持纯文案，不把批次参数塞进按钮（避免超长按钮）', async () => {
    const wrapper = await mountBatching()
    const btn = wrapper.find('[data-testid="fe-production-confirm-0"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('确认执行本批')
  })

  it('批次上下文随画幅/时长选择实时变化', async () => {
    const wrapper = await mountBatching()
    expect(wrapper.findAll('[data-testid="fe-production-batch-card"]')[0].text()).toContain('16:9 横屏')
    productionMock.chosen.value = { aspect: '9x16', seconds: 8 }
    await wrapper.vm.$nextTick()
    const after = wrapper.findAll('[data-testid="fe-production-batch-card"]')[0].text()
    expect(after).toContain('9:16 竖屏')
    expect(after).toContain('8s')
  })
})
