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
    status: vi.fn(async () => ({ code: 0, data: { available: true, filmMeta: { title: 'Film Project Case' } } })),
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
import { messageIs, messageContains } from '../utils/toast-assert-helpers'

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

/**
 * 回归锁（2026-10-07）：「LLM 润色」开关已下线。
 *
 * 背景：该开关在出厂构建里**永远不生效**——ScriptAdapter 的唯一生产构造点传
 * `llm: null`（core/container.setup.js:453），而启用判定要求 `this.llm` 非空
 * （script-adapt.js:168），故 useLlm 恒 false。界面上却摆着可勾选的复选框，
 * 用户勾了、点了「拆分镜」，什么都没变。经典视图更彻底——连降级提示都没有。
 *
 * 本组锁的是「开关确实不在了」：UI 无复选框、composable 无该状态、
 * adaptScript 请求不带 llmEnabled、拆分镜成功不再弹任何 llm 相关提示。
 *
 * 反证纪律：把复选框或 form.llmEnabled 加回去，本组必须变红。
 */
describe('FilmCanvasView LLM 润色开关已下线（2026-10-07）', () => {
  it('form 上不再有 llmEnabled 状态', async () => {
    const w = await mountView()
    expect(Object.prototype.hasOwnProperty.call(w.vm.form, 'llmEnabled')).toBe(false)
    w.unmount()
  })

  it('拆分镜请求体不带 llmEnabled', async () => {
    const w = await mountView()
    apiMock.filmEngineering.adaptScript.mockResolvedValueOnce({
      code: 0,
      data: { adaptedShots: [{ shotId: 'adapt-001', sceneId: 's1', prompt: 'p' }], llmEnhanced: false, warnings: [] },
    })
    w.vm.form.script = '第一场\n\n剧情。'
    await w.vm.onAdapt()
    await flushPromises()
    const payload = apiMock.filmEngineering.adaptScript.mock.calls.at(-1)[0]
    expect(Object.prototype.hasOwnProperty.call(payload, 'llmEnabled')).toBe(false)
    w.unmount()
  })

  it('引擎即便回传 llmEnhanced=false 也不弹任何 llm 相关提示', async () => {
    const w = await mountView()
    apiMock.filmEngineering.adaptScript.mockResolvedValueOnce({
      code: 0,
      data: { adaptedShots: [{ shotId: 'adapt-001', sceneId: 's1', prompt: 'p' }], llmEnhanced: false, warnings: [] },
    })
    w.vm.form.script = '第一场\n\n剧情。'
    await w.vm.onAdapt()
    await flushPromises()
    expect(ElMessage.success).toHaveBeenCalledWith(messageIs('filmEngineering.canvas.adapt.done'))
    const warned = ElMessage.warning.mock.calls.map((c) => String(c[0]))
    expect(warned.some((s) => /llm/i.test(s))).toBe(false)
    w.unmount()
  })

  it('模板里不再渲染 fcv-llm 复选框', async () => {
    const w = await mountView()
    expect(w.find('[data-testid="fcv-llm"]').exists()).toBe(false)
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
    expect(ElMessage.error).toHaveBeenCalledWith(messageIs('filmEngineering.canvas.retry.failed'))
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
    expect(ElMessage.error).toHaveBeenCalledWith(messageIs('filmEngineering.canvas.retry.failed'))
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

// ── 缺陷 3：错误归因（2026-10-19 修复）────────────────────────────────
// 原实现把除 tooManyShots / noShots 之外的**所有**失败都显示成「影视引擎不可用」，
// 于是 provider 未配置也被误报成安装损坏，用户不会去配模型。
describe('FilmCanvasView 错误归因分流', () => {
  it('VIDEO_MODEL_NOT_CONFIGURED 必须显示 video.noModel，而非 engineUnavailable', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    vg().start.mockResolvedValueOnce({ ok: false, errorCode: 'VIDEO_MODEL_NOT_CONFIGURED', error: '需要视频模型' })
    await w.vm.onGenerate(['adapt-001'])
    await flushPromises()
    const msgs = ElMessage.error.mock.calls.map((c) => c[0])
    expect(msgs).toContain('filmEngineering.video.noModel')
    expect(msgs).not.toContain('filmEngineering.canvas.engineUnavailable')
    w.unmount()
  })

  it('FILM_KIT_UNAVAILABLE 仍归因为 engineUnavailable（kit 缺失确实是引擎不可用）', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    vg().start.mockResolvedValueOnce({ ok: false, errorCode: 'FILM_KIT_UNAVAILABLE', error: 'kit 缺失' })
    await w.vm.onGenerate(['adapt-001'])
    await flushPromises()
    expect(ElMessage.error).toHaveBeenCalledWith('filmEngineering.canvas.engineUnavailable')
    w.unmount()
  })

  it('未识别错误码仍落到 engineUnavailable 兜底（不吞掉、不静默）', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    vg().start.mockResolvedValueOnce({ ok: false, errorCode: 'SOMETHING_ELSE', error: 'x' })
    await w.vm.onGenerate(['adapt-001'])
    await flushPromises()
    expect(ElMessage.error).toHaveBeenCalledWith('filmEngineering.canvas.engineUnavailable')
    w.unmount()
  })
})

// ── 缺陷 4：refCount 写入（2026-10-19 修复）───────────────────────────
// ShotNode 渲染「已注入 {n} 张参考」，但全仓无任何代码写入 data.refCount ⇒ 该提示永不显示。
// 修复后：连参考图→分镜 时写入，断开连线时回退。
describe('FilmCanvasView 参考图连线后 refCount 回写', () => {
  it('连一条人物参考到分镜后，该分镜节点 refCount 为 1', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    // 造一个人物参考节点
    await w.vm.uploadReference({ name: 'a.png', type: 'image/png', size: 10, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, 'character')
    await flushPromises()
    const refNode = w.vm.nodes.find((n) => n.type === 'characterRef')
    const shotNode = w.vm.nodes.find((n) => n.id === 'shot:adapt-001')
    expect(refNode, '应存在人物参考节点').toBeTruthy()
    const r = w.vm.addEdge({ source: refNode.id, target: shotNode.id })
    expect(r.ok).toBe(true)
    expect(w.vm.nodes.find((n) => n.id === shotNode.id).data.refCount).toBe(1)
    w.unmount()
  })

  it('删掉该连线后 refCount 回到 0（不留残留计数）', async () => {
    const w = await mountView()
    w.vm.form.script = 'x'
    await w.vm.onAdapt()
    await flushPromises()
    await w.vm.uploadReference({ name: 'a.png', type: 'image/png', size: 10, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, 'character')
    await flushPromises()
    const refNode = w.vm.nodes.find((n) => n.type === 'characterRef')
    const shotNode = w.vm.nodes.find((n) => n.id === 'shot:adapt-001')
    w.vm.addEdge({ source: refNode.id, target: shotNode.id })
    expect(w.vm.nodes.find((n) => n.id === shotNode.id).data.refCount).toBe(1)
    w.vm.removeNodes([refNode.id])
    await flushPromises()
    const after = w.vm.nodes.find((n) => n.id === shotNode.id)
    expect(after.data.refCount).toBe(0)
    w.unmount()
  })
})
