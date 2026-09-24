// @vitest-environment jsdom
/**
 * FilmCanvasView 行为接线回归（v2 剩余项）：
 *  - 3.3 LLM 降级非阻断提示：勾选润色但引擎 llmEnhanced=false 时 warning 回显 locale key
 *  - 5.2 失败单镜就地重试：shotId -> run 快照 index 定位（findShotResultIndex），走 retryShot 通道
 *  - 5.3 成片入口进画布：done banner 提供「打开所在文件夹 / 另存为」，复用 story2video 合同
 * useFilmVideoGen 以受控 fake 注入（真实 composable 的内部 ref 无法从视图外置位）；
 * useFilmCanvas / film-canvas-model 走真实实现。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k }) }))

vi.mock('element-plus', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('@vue-flow/core', () => {
  const { h, defineComponent } = require('vue')
  return {
    VueFlow: defineComponent({
      name: 'VueFlow',
      props: ['nodes', 'edges'],
      setup (_, { slots }) { return () => h('div', { class: 'vue-flow-stub' }, slots.default ? slots.default() : null) },
    }),
    useVueFlow: () => ({ onNodeDragStop: vi.fn() }),
    Handle: defineComponent({ name: 'Handle', setup: () => () => h('span') }),
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  }
})
vi.mock('@vue-flow/background', () => ({ Background: { template: '<div />' } }))
vi.mock('@vue-flow/controls', () => ({ Controls: { template: '<div />' } }))
vi.mock('@vue-flow/minimap', () => ({ MiniMap: { template: '<div />' } }))

const apiMock = {
  filmEngineering: {
    status: vi.fn(async () => ({ code: 0, data: { available: true, filmMeta: { title: 'Hell Grind' } } })),
    adaptScript: vi.fn(async () => ({
      code: 0,
      data: { adaptedShots: [{ shotId: 'adapt-001', sceneId: 's1', prompt: 'p' }, { shotId: 'adapt-002', sceneId: 's1', prompt: 'q' }], llmEnhanced: false, warnings: [] },
    })),
    uploadReference: vi.fn(async () => ({ code: 0, data: { path: '/r/a.png', fileName: 'a.png', bytes: 10, mime: 'image/png' } })),
  },
}
vi.mock('@/api/electron-bridge', () => ({ getApi: () => apiMock }))

const pubMock = {
  story2videoShowInFolder: vi.fn(async () => ({ code: 0 })),
  story2videoSaveAs: vi.fn(async () => ({ code: 0, data: { path: '/saved/final.mp4', cancelled: false } })),
}
vi.mock('@/api/publisher', () => ({
  story2videoShowInFolder: (p) => pubMock.story2videoShowInFolder(p),
  story2videoSaveAs: (p) => pubMock.story2videoSaveAs(p),
  pipelineStartOrchestrated: vi.fn(), pipelineGetRunContext: vi.fn(), pipelineCancelRun: vi.fn(),
  pipelineConfirmStageGate: vi.fn(), onPipelineUpdate: () => () => {}, filmEngineeringRetryShot: vi.fn(),
}))

// 受控 fake useFilmVideoGen：ref 在工厂内构造，挂到 globalThis 供用例置位/断言
vi.mock('@/composables/useFilmVideoGen', async () => {
  const { ref } = await import('vue')
  const fake = {
    phase: ref('idle'), busy: ref(false), costCheck: ref(null),
    shotResults: ref([]), finalPath: ref(null),
    chosen: ref({ aspect: '16x9', seconds: 5 }),
    start: vi.fn(async () => ({ ok: true })),
    confirmCost: vi.fn(async () => ({ ok: true })),
    cancelCost: vi.fn(async () => ({ ok: true })),
    retryShot: vi.fn(async () => ({ ok: true })),
    reset: vi.fn(), dispose: vi.fn(), poll: vi.fn(),
  }
  globalThis.__fakeVg = fake
  return {
    FILM_VIDEO_ASPECTS: ['16x9', '9x16', 'source'],
    FILM_VIDEO_DURATIONS: [5, 10],
    FILM_MAX_VIDEO_BATCH: 20,
    useFilmVideoGen: () => fake,
  }
})

import FilmCanvasView from './FilmCanvasView.vue'
import { ElMessage } from 'element-plus'

const vg = () => globalThis.__fakeVg

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  const f = vg()
  f.phase.value = 'idle'
  f.busy.value = false
  f.costCheck.value = null
  f.shotResults.value = []
  f.finalPath.value = null
  f.retryShot.mockReset().mockResolvedValue({ ok: true })
})

const mountView = async () => {
  const wrapper = mount(FilmCanvasView, {
    global: { stubs: { ElSelect: true, ElOption: true, ElDialog: true } },
  })
  await flushPromises()
  return wrapper
}

async function adaptWithLLM (w, { llmEnabled, llmEnhanced }) {
  apiMock.filmEngineering.adaptScript.mockResolvedValueOnce({
    code: 0,
    data: { adaptedShots: [{ shotId: 'adapt-001', sceneId: 's1', prompt: 'p' }], llmEnhanced, warnings: [] },
  })
  w.vm.form.script = '第一场\n\n剧情。'
  w.vm.form.llmEnabled = llmEnabled
  await w.vm.onAdapt()
  await flushPromises()
}

describe('FilmCanvasView 3.3 LLM 降级提示', () => {
  it('勾选润色但 llmEnhanced=false：warning 回显 llmFallback locale key（非阻断）', async () => {
    const w = await mountView()
    await adaptWithLLM(w, { llmEnabled: true, llmEnhanced: false })
    expect(ElMessage.success).toHaveBeenCalledWith('filmEngineering.canvas.adapt.done')
    expect(ElMessage.warning).toHaveBeenCalledWith('filmEngineering.canvas.adapt.llmFallback')
    w.unmount()
  })

  it('llmEnhanced=true：不出现降级提示', async () => {
    const w = await mountView()
    await adaptWithLLM(w, { llmEnabled: true, llmEnhanced: true })
    expect(ElMessage.warning).not.toHaveBeenCalledWith('filmEngineering.canvas.adapt.llmFallback')
    w.unmount()
  })

  it('未勾选润色：引擎 llmEnhanced=false 属预期，不提示', async () => {
    const w = await mountView()
    await adaptWithLLM(w, { llmEnabled: false, llmEnhanced: false })
    expect(ElMessage.warning).not.toHaveBeenCalledWith('filmEngineering.canvas.adapt.llmFallback')
    w.unmount()
  })
})

describe('FilmCanvasView 5.2 失败单镜就地重试', () => {
  it('shotId 命中 run 结果：以对应 index 调 retryShot，节点回显 generating', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    vg().shotResults.value = [
      { index: 0, shotId: 'adapt-001', status: 'success', path: '/o/1.mp4' },
      { index: 1, shotId: 'adapt-002', status: 'failed', path: null },
    ]
    vg().retryShot.mockImplementationOnce(async () => {
      vg().shotResults.value = [
        { index: 0, shotId: 'adapt-001', status: 'success', path: '/o/1.mp4' },
        { index: 1, shotId: 'adapt-002', status: 'generating', path: null },
      ]
      return { ok: true }
    })
    await w.vm.onRetryShot('adapt-002')
    await flushPromises()
    expect(vg().retryShot).toHaveBeenCalledWith(1)
    const node = w.vm.nodes.find((n) => n.id === 'shot:adapt-002')
    expect(node.data.status).toBe('generating')
    expect(ElMessage.error).not.toHaveBeenCalled()
    w.unmount()
  })

  it('shotId 不在 run 结果（如未发起过生成）：报 retry.failed 且不调 retryShot', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    vg().shotResults.value = []
    await w.vm.onRetryShot('adapt-001')
    expect(vg().retryShot).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith('filmEngineering.canvas.retry.failed')
    w.unmount()
  })

  it('retryShot 通道失败：节点回 failed 态并提示 retry.failed', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    vg().shotResults.value = [{ index: 0, shotId: 'adapt-001', status: 'failed', path: null }]
    vg().retryShot.mockResolvedValueOnce({ ok: false, errorCode: 'shotNotFound' })
    await w.vm.onRetryShot('adapt-001')
    await flushPromises()
    const node = w.vm.nodes.find((n) => n.id === 'shot:adapt-001')
    expect(node.data.status).toBe('failed')
    expect(ElMessage.error).toHaveBeenCalledWith('filmEngineering.canvas.retry.failed')
    w.unmount()
  })
})

describe('FilmCanvasView 5.3 成片入口进画布', () => {
  it('done + finalPath：banner 提供打开所在文件夹/另存为，点击走 story2video 合同', async () => {
    const w = await mountView()
    vg().phase.value = 'done'
    vg().finalPath.value = 'D:/out/final.mp4'
    await flushPromises()
    const openBtn = w.find('[data-testid="fcv-open-folder"]')
    const saveBtn = w.find('[data-testid="fcv-save-as"]')
    expect(openBtn.exists()).toBe(true)
    expect(saveBtn.exists()).toBe(true)
    await openBtn.trigger('click')
    await saveBtn.trigger('click')
    await flushPromises()
    expect(pubMock.story2videoShowInFolder).toHaveBeenCalledWith('D:/out/final.mp4')
    expect(pubMock.story2videoSaveAs).toHaveBeenCalledWith('D:/out/final.mp4')
    w.unmount()
  })

  it('未成片时 banner 不渲染，两个入口不存在', async () => {
    const w = await mountView()
    expect(w.find('[data-testid="fcv-open-folder"]').exists()).toBe(false)
    expect(w.find('[data-testid="fcv-save-as"]').exists()).toBe(false)
    w.unmount()
  })
})
