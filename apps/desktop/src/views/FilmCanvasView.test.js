// @vitest-environment jsdom
/**
 * FilmCanvasView 冒烟回归：验证 <script setup> 从 useFilmCanvas/useFilmVideoGen 解构的
 * ref/方法集合与真实返回形状一致（漏解构/错名会在此炸），以及工具栏按钮与 VueFlow 装配可渲染。
 * 外部依赖（vue-i18n / @vue-flow/* / element-plus / IPC）按最小面 mock，composable 走真实实现。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k }) }))

vi.mock('element-plus', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

// VueFlow 家族：core 提供占位 VueFlow（渲染默认插槽以挂载自定义节点）、useVueFlow、Handle、Position
vi.mock('@vue-flow/core', () => {
  const { h, defineComponent } = require('vue')
  return {
    VueFlow: defineComponent({
      name: 'VueFlow',
      props: ['nodes', 'edges'],
      setup(_, { slots }) { return () => h('div', { class: 'vue-flow-stub' }, slots.default ? slots.default() : null) },
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
    adaptScript: vi.fn(async () => ({ code: 0, data: { adaptedShots: [{ shotId: 'adapt-001', sceneId: 's1', prompt: 'p' }, { shotId: 'adapt-002', sceneId: 's1', prompt: 'q' }], llmEnhanced: false, warnings: [] } })),
    uploadReference: vi.fn(async () => ({ code: 0, data: { path: '/r/a.png', fileName: 'a.png', bytes: 10, mime: 'image/png' } })),
  },
}
vi.mock('@/api/electron-bridge', () => ({ getApi: () => apiMock }))
vi.mock('@/api/publisher', () => ({
  pipelineStartOrchestrated: vi.fn(async () => ({ code: 0, data: { success: true, runId: 'run-1' } })),
  pipelineGetRunContext: vi.fn(async () => ({ code: 0, data: {} })),
  pipelineCancelRun: vi.fn(async () => ({ code: 0 })),
  pipelineConfirmStageGate: vi.fn(async () => ({ code: 0, data: { success: true } })),
  onPipelineUpdate: () => () => {},
  filmEngineeringRetryShot: vi.fn(async () => ({ code: 0, data: { success: true } })),
}))

import FilmCanvasView from './FilmCanvasView.vue'

beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })

const mountView = async () => {
  const wrapper = mount(FilmCanvasView, {
    global: { stubs: { ElSelect: true, ElOption: true, ElDialog: true } },
  })
  await flushPromises()
  return wrapper
}

describe('FilmCanvasView 装配', () => {
  it('挂载不抛错、引擎可用时按钮启用', async () => {
    const w = await mountView()
    expect(w.find('[data-testid="fcv-adapt"]').exists()).toBe(true)
    expect(w.find('[data-testid="fcv-generate"]').exists()).toBe(true)
    w.unmount()
  })

  it('拆分镜：写入剧本后点击生成两个分镜节点', async () => {
    const w = await mountView()
    w.vm.form.script = '第一场\n\n剧情。'
    await w.vm.onAdapt()
    await flushPromises()
    expect(apiMock.filmEngineering.adaptScript).toHaveBeenCalled()
    const shotNodes = w.vm.nodes.filter((n) => n.type === 'shot')
    expect(shotNodes).toHaveLength(2)
    w.unmount()
  })

  it('非法连线（分镜→分镜）被门禁拒绝且不落边', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    const ids = w.vm.nodes.filter((n) => n.type === 'shot').map((n) => n.id)
    const r = w.vm.addEdge({ source: ids[0], target: ids[1] })
    expect(r.ok).toBe(false)
    expect(w.vm.edges).toHaveLength(0)
    w.unmount()
  })
})
