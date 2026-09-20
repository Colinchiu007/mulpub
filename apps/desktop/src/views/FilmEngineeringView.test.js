// @ts-check
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, reactive, nextTick } from 'vue'
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
    filmEngineering: { copyMode: composable.copyMode.value, characterMap: Object.fromEntries((entries || []).map((entry) => [entry.key, entry.value])), llmEnabled: composable.adapt.llmEnabled },
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
  composable.adapt.llmEnabled = false
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
})
