// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// mock element-plus（ElMessage 等）
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

const pushSpy = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushSpy }),
  useRoute: () => ({ query: {} }),
}))

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useI18n: () => ({ t: (key, params) => key + (params ? ':' + JSON.stringify(params) : '') }),
  }
})

vi.mock('@/api/hot-topics', () => ({
  hotTopicsFetch: vi.fn(),
  hotTopicsGetCache: vi.fn(),
  hotTopicsFavoriteList: vi.fn(),
  hotTopicsFavoriteAdd: vi.fn(),
  hotTopicsFavoriteRemove: vi.fn(),
}))

vi.mock('@/api/publisher', () => ({
  aiRewrite: vi.fn(),
  draftSave: vi.fn(),
  storeGetSetting: vi.fn(),
  pipelineStartOrchestrated: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelineCancelRun: vi.fn(),
  onPipelineUpdate: vi.fn(() => vi.fn()),
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
  }),
}))

import HotTopics from './HotTopics.vue'
import i18n from '@/i18n'
import { hotTopicsFetch } from '@/api/hot-topics'
import { hotTopicsGetCache } from '@/api/hot-topics'
import { hotTopicsFavoriteList, hotTopicsFavoriteRemove } from '@/api/hot-topics'
import { aiRewrite, draftSave, storeGetSetting, pipelineStartOrchestrated, pipelineGetRunContext, pipelineCancelRun } from '@/api/publisher'
import { pipelineBackgroundToastVisible, hidePipelineBackgroundToast } from '@/stores/pipeline-background-toast'
import { readFileSync } from 'node:fs'

const mockTopics = [
  { id: 'zhihu:1', topic: 'AI大模型最新突破进展', channel: 'zhihu', category: 'tech', rank: 1, hotValue: 12000000, url: null, fetchedAt: '2026-09-11T00:00:00Z' },
  { id: 'toutiao:1', topic: 'A股大涨沪指重返3000点', channel: 'toutiao', category: 'finance', rank: 1, hotValue: 456789, url: null, fetchedAt: '2026-09-11T00:00:00Z' },
  { id: 'baidu:1', topic: '普通日常记录', channel: 'baidu', category: 'general', rank: 1, hotValue: null, url: null, fetchedAt: '2026-09-11T00:00:00Z' },
]

function mountPage() {
  return mount(HotTopics, {
    global: { plugins: [i18n], stubs: { 'el-alert': true, 'el-select': true, 'el-option': true, 'el-progress': true, 'el-skeleton': true } },
  })
}

describe('HotTopics.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushSpy.mockClear()
    // 默认无缓存：走网络抓取路径（与旧行为兼容）
    hotTopicsGetCache.mockResolvedValue({ code: 0, data: { topics: [], fetchedAt: 0, channelStats: {} } })
    // 默认无收藏：收藏 tab 用例各自覆盖该实现
    hotTopicsFavoriteList.mockResolvedValue({ code: 0, data: [] })
    document.body.innerHTML = '' // 清理 Teleport 到 body 的弹窗/按钮残留，隔离用例
  })

  it('renders topic list after fetch', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: { zhihu: { ok: true } } } })
    const wrapper = mountPage()
    await flushPromises()
    const items = wrapper.findAll('[data-testid="hot-topic-item"]')
    expect(items).toHaveLength(3)
    expect(wrapper.text()).toContain('AI大模型最新突破进展')
  })

  // ─── SWR 优化：缓存优先渲染 + 后台刷新 ───

  it('renders cached topics immediately on mount, then background refresh updates the list', async () => {
    // 缓存有数据：立即渲染；后台刷新完成后新数据替换旧数据（flushPromises 跑完 mount+getCache+fetch，断言最终态）
    hotTopicsGetCache.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now() - 5 * 60 * 1000, channelStats: { zhihu: { ok: true } } } })
    // 后台刷新 deferred：先断言缓存中间态，再放行 fetch 验证替换（SWR 核心保证：缓存先渲染、网络后更新）
    let resolveFetch
    hotTopicsFetch.mockImplementation(() => new Promise(r => { resolveFetch = r }))

    const wrapper = mountPage()
    await flushPromises()

    // 中间态：缓存 3 条已渲染、fetch 未完成、无中央提示（后台刷新不打断内容）
    expect(wrapper.findAll('[data-testid="hot-topic-item"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('AI大模型最新突破进展')
    expect(wrapper.find('[data-testid="hot-topics-central-loading"]').exists()).toBe(false)

    // 放行后台刷新 → 新数据替换旧数据
    resolveFetch({ code: 0, data: { topics: [...mockTopics, { id: 'bilibili:1', topic: '新B站热榜话题', channel: 'bilibili', category: 'tech', rank: 1, hotValue: 999, url: null }], fetchedAt: Date.now(), channelStats: {} } })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="hot-topic-item"]')).toHaveLength(4)
    expect(wrapper.text()).toContain('新B站热榜话题')
    // 全程无中央提示（后台刷新不打断用户）
    expect(wrapper.find('[data-testid="hot-topics-central-loading"]').exists()).toBe(false)
    expect(hotTopicsFetch).toHaveBeenCalledWith(false, [])
  })

  it('falls back to network fetch with central loading when getCache throws', async () => {
    // getCache IPC 异常：静默容错回退网络抓取路径
    hotTopicsGetCache.mockRejectedValue(new Error('IPC error'))
    hotTopicsFetch.mockImplementation(() => new Promise(() => {})) // 抓取挂起：验证中央提示出现

    const wrapper = mountPage()
    await flushPromises()

    expect(hotTopicsFetch).toHaveBeenCalledWith(false, [])
    expect(wrapper.find('[data-testid="hot-topics-central-loading"]').exists()).toBe(true)
  })

  it('shows central loading hint with animated dots when no cache on first visit', async () => {
    // 无缓存 + fetch 挂起（模拟网络抓取中）
    hotTopicsGetCache.mockResolvedValue({ code: 0, data: { topics: [], fetchedAt: 0, channelStats: {} } })
    hotTopicsFetch.mockImplementation(() => new Promise(() => {}))

    const wrapper = mountPage()
    await flushPromises()

    // 中央加载提示可见：主文案 + 动态元素
    const hint = wrapper.find('[data-testid="hot-topics-central-loading"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('refreshLoadingTitle')
    expect(hint.text()).toContain('refreshLoadingDesc')
    expect(hint.find('.htcl-dots').exists()).toBe(true)
  })

  it('shows central loading hint on manual refresh even when topics are visible', async () => {
    // 有缓存数据 + 用户点击刷新按钮
    hotTopicsGetCache.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now() - 30 * 60 * 1000, channelStats: {} } })
    // 后台刷新立即完成（让 loading 归位，按钮恢复可点），手动刷新再挂起
    hotTopicsFetch.mockResolvedValueOnce({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    hotTopicsFetch.mockImplementation(() => new Promise(() => {}))

    const wrapper = mountPage()
    await flushPromises()
    // 缓存已渲染
    expect(wrapper.findAll('[data-testid="hot-topic-item"]')).toHaveLength(3)

    // 点击刷新按钮（手动刷新 = 用户明确等待场景，显示中央提示）
    const refreshBtn = wrapper.findAll('.header-actions button').find(b => b.text().includes('refresh'))
    expect(refreshBtn).toBeTruthy()
    expect(refreshBtn.attributes('disabled')).toBeFalsy() // loading 结束后按钮恢复可点
    await refreshBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="hot-topics-central-loading"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="hot-topic-item"]')).toHaveLength(3) // 旧数据保留
  })

  it('shows empty state when no topics', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: [], fetchedAt: Date.now(), channelStats: {} } })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="hot-topics-empty"]').exists()).toBe(true)
  })

  it('category filter narrows the list', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    const wrapper = mountPage()
    await flushPromises()
    // 点击「科技」chip（第 5 个：全部/综合/社会/财经/科技）
    const chips = wrapper.findAll('.category-chip')
    await chips[4].trigger('click')
    expect(wrapper.findAll('[data-testid="hot-topic-item"]')).toHaveLength(1)
  })

  it('rank badges renumber from 1 within filtered view (not source channel rank)', async () => {
    // 场景：分类筛选后各渠道原始 rank 混排（1、3、7…），视图内序号应从 1 连续递增
    const mixed = [
      { id: 'zhihu:3', topic: '科技话题三', channel: 'zhihu', category: 'tech', rank: 3, hotValue: null, url: null, fetchedAt: 'T' },
      { id: 'toutiao:7', topic: '科技话题七', channel: 'toutiao', category: 'tech', rank: 7, hotValue: null, url: null, fetchedAt: 'T' },
      { id: 'baidu:1', topic: '日常话题', channel: 'baidu', category: 'general', rank: 1, hotValue: null, url: null, fetchedAt: 'T' },
    ]
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mixed, fetchedAt: Date.now(), channelStats: {} } })
    const wrapper = mountPage()
    await flushPromises()
    // 点击「科技」chip
    const chips = wrapper.findAll('.category-chip')
    await chips[4].trigger('click')
    const badges = wrapper.findAll('.rank-badge')
    expect(badges).toHaveLength(2)
    expect(badges[0].text()).toBe('1') // zhihu rank=3 → 视图内 1
    expect(badges[1].text()).toBe('2') // toutiao rank=7 → 视图内 2
    // 全部视图下同样从 1 递增
    await chips[0].trigger('click')
    const allBadges = wrapper.findAll('.rank-badge')
    expect(allBadges.map(b => b.text())).toEqual(['1', '2', '3'])
    // hover title 显示来源渠道内排名（zh locale 是函数，mock 下检查 title 属性存在且含 rank 值）
    expect(badges[0].attributes('title')).toBeTruthy()
  })

  it('checkbox toggle updates selection', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    const wrapper = mountPage()
    await flushPromises()
    const check = wrapper.find('[data-testid="hot-topic-check-zhihu:1"]')
    await check.setValue(true)
    expect(wrapper.text()).toContain('selectedCount')
  })

  it('single create-copy navigates to /rewrite with topic query', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.item-create-btn').trigger('click')
    expect(pushSpy).toHaveBeenCalledWith('/rewrite?topic=' + encodeURIComponent('AI大模型最新突破进展'))
  })

  it('batch publish flow: rewrite all, save drafts, navigate', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '改写后的文案内容' } })
    draftSave.mockResolvedValue({ code: 0 })
    const wrapper = mountPage()
    await flushPromises()
    // 全选 + 一键发布（teleport 弹窗挂到 document.body）
    const el = document.createElement('div')
    document.body.appendChild(el)
    const attached = mount(HotTopics, {
      attachTo: el,
      global: { plugins: [i18n], stubs: { 'el-alert': true, 'el-select': true, 'el-option': true, 'el-progress': true, 'el-skeleton': true } },
    })
    await flushPromises()
    await attached.find('.select-all-label input').setValue(true)
    // 重新 mount 后 hotTopicsFetch 已被调用过，直接触发发布
    attached.vm.selectedIds = new Set(mockTopics.map(x => x.id))
    await attached.vm.$nextTick()
    const publishBtn = attached.findAll('.batch-actions button').find(b => b.text().includes('publishBtn'))
    await publishBtn.trigger('click')
    const articleBtn = document.body.querySelector('[data-testid="publish-dest-article"]')
    expect(articleBtn).toBeTruthy()
    articleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(aiRewrite).toHaveBeenCalledTimes(3)
    expect(draftSave).toHaveBeenCalledTimes(3)
    attached.unmount()
    el.remove()
  })

  // ─── Bug 回归：改写完成后进度区不消失，完成提示与去发布按钮可见 ───
  // E2E 2026-09-11 发现：publishing=false 时 v-if 切回批量条，
  // 「改写完成，已生成 n 条草稿」和「去发布」按钮一闪而过用户看不到。
  it('publish progress area stays visible after completion with done text and go-publish button', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '改写结果' } })
    draftSave.mockResolvedValue({ code: 0 })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const attached = mount(HotTopics, {
      attachTo: el,
      global: { plugins: [i18n], stubs: { 'el-alert': true, 'el-select': true, 'el-option': true, 'el-progress': true, 'el-skeleton': true } },
    })
    await flushPromises()
    attached.vm.selectedIds = new Set(mockTopics.map(x => x.id))
    await attached.vm.$nextTick()
    const publishBtn = attached.findAll('.batch-actions button').find(b => b.text().includes('publishBtn'))
    await publishBtn.trigger('click')
    const articleBtn = document.body.querySelector('[data-testid="publish-dest-article"]')
    articleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    // 完成后：批量条隐藏，进度区仍在，完成提示与去发布按钮可见
    expect(attached.find('[data-testid="hot-topics-batch-bar"]').exists()).toBe(false)
    expect(attached.find('.publish-progress').exists()).toBe(true)
    expect(attached.find('.publish-done').exists()).toBe(true)
    expect(attached.text()).toContain('publishDone')
    // 点返回 → 回到批量条
    const backBtn = attached.findAll('button').find(b => b.text().includes('backToBatch'))
    await backBtn.trigger('click')
    expect(attached.find('[data-testid="hot-topics-batch-bar"]').exists()).toBe(true)
    expect(attached.find('.publish-progress').exists()).toBe(false)
    attached.unmount()
    el.remove()
  })

  // ─── 一键生成视频 ───

  it('generate-video button renders on each topic row', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    const wrapper = mountPage()
    await flushPromises()
    const btns = wrapper.findAll('[data-testid^="hot-topic-generate-video-"]')
    expect(btns).toHaveLength(3)
    expect(btns[0].text()).toContain('generateVideo')
  })

  it('generate-video opens modal, rewrites, saves draft, and starts story2video pipeline', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '改写后的视频文案内容' } })
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-123', stages: [{ name: 'split', status: 'running' }] } })
    pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: 'run-123', status: { status: 'running', progress: 10, stages: [{ name: 'split', status: 'running' }] } } })

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()

    // 弹窗打开，改写完成，流水线启动
    expect(aiRewrite).toHaveBeenCalledWith(expect.objectContaining({ mode: 'create', content: expect.stringContaining('AI大模型最新突破进展') }))
    expect(draftSave).toHaveBeenCalledTimes(1)
    expect(pipelineStartOrchestrated).toHaveBeenCalledWith('story2video-compose', expect.objectContaining({
      text: '改写后的视频文案内容',
      inputMode: 'text',
      story2videoTextConfig: expect.objectContaining({ mode: 'text', prompt: '改写后的视频文案内容' }),
    }))
    // stages 数组含 rewrite_copy 在最前 + 7 个流水线阶段
    const stageNames = wrapper.vm.genVideoStages.map(s => s.name)
    expect(stageNames[0]).toBe('rewrite_copy')
    expect(stageNames).toHaveLength(8)
    expect(wrapper.vm.genVideoStages.find(s => s.name === 'rewrite_copy').status).toBe('completed')
  })

  it('generate-video rewrite failure marks stage failed with retry available', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: false, error: 'quota exceeded' } })

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-toutiao:1"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.genVideoPhase).toBe('failed')
    expect(wrapper.vm.genVideoStages.find(s => s.name === 'rewrite_copy').status).toBe('failed')
    expect(pipelineStartOrchestrated).not.toHaveBeenCalled()
    // 弹窗内错误文案必须真的落到 DOM：编排逻辑抽到 composable 后，曾因漏把
    // genVideoErrorText 暴露给模板而静默不渲染（只有 Vue warn 可见），故在此锚定。
    const errEl = document.body.querySelector('[data-testid="hot-topics-gen-video-error"]')
    expect(errEl).toBeTruthy()
    expect(errEl.textContent).toContain('genVideoRewriteFailed')
  })

  it('generate-video pipeline start failure keeps rewrite completed and allows retry without re-rewriting', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '改写结果文案' } })
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    pipelineStartOrchestrated.mockResolvedValue({ code: -1, message: 'concurrency limit' })

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.genVideoPhase).toBe('failed')
    expect(wrapper.vm.genVideoStages.find(s => s.name === 'rewrite_copy').status).toBe('completed')

    // 重试：不重新改写，直接再启动流水线
    pipelineStartOrchestrated.mockClear()
    aiRewrite.mockClear()
    pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-456' } })
    pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: 'run-456', status: { status: 'running', progress: 5 } } })
    await wrapper.vm.retryGenVideo()
    await flushPromises()
    expect(aiRewrite).not.toHaveBeenCalled()
    expect(pipelineStartOrchestrated).toHaveBeenCalledTimes(1)
  })

  it('generate-video completes and navigates to result page with videoPath', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '完整流程文案' } })
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-done-1' } })
    pipelineGetRunContext.mockResolvedValue({ code: 0, data: {
      runId: 'run-done-1',
      status: { status: 'completed', progress: 100, stages: [
        { name: 'split', status: 'completed' }, { name: 'scene_context', status: 'completed' },
        { name: 'optimize', status: 'completed' }, { name: 'select_video_scenes', status: 'skipped' },
        { name: 'generate_assets', status: 'completed' }, { name: 'compose', status: 'completed' },
        { name: 'publish', status: 'skipped' },
      ] },
      context: { compose: { data: { videoPath: 'D:/videos/out.mp4' } }, story2videoProject: { projectId: 'p1' } },
    } })

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))
    await flushPromises()

    expect(wrapper.vm.genVideoPhase).toBe('completed')
    expect(wrapper.vm.genVideoModalOpen).toBe(false)
    expect(pushSpy).toHaveBeenCalledWith({ path: '/create/result', query: { path: 'D:/videos/out.mp4', project: 'p1', runId: 'run-done-1' } })
  })

  it('generate-video cancel during rewrite aborts orchestration without pipeline call', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockImplementation(() => new Promise(() => {}))

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.genVideoPhase).toBe('rewriting')
    await wrapper.vm.cancelGenVideo()
    expect(wrapper.vm.genVideoPhase).toBe('cancelled')
    expect(pipelineCancelRun).not.toHaveBeenCalled()
    expect(pipelineStartOrchestrated).not.toHaveBeenCalled()
    expect(wrapper.vm.genVideoStages.find(s => s.name === 'rewrite_copy').status).toBe('cancelled')
  })

  it('generate-video cancel during running pipeline calls pipelineCancelRun with runId', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '运行中文案' } })
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-cancel-1' } })
    pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: 'run-cancel-1', status: { status: 'running', progress: 20 } } })
    pipelineCancelRun.mockResolvedValue({ code: 0, data: { success: true } })

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.vm.genVideoPhase).toBe('running')
    await wrapper.vm.cancelGenVideo()
    expect(pipelineCancelRun).toHaveBeenCalledWith('run-cancel-1')
    expect(wrapper.vm.genVideoPhase).toBe('cancelled')
  })

  // 回归（2026-09-13）：后台运行后必须释放前端跟踪态，否则按钮永久禁用、无法并行开新任务
  it('generate-video close during running detaches to background and releases frontend tracking state', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '后台文案' } })
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-bg-1' } })
    pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: 'run-bg-1', status: { status: 'running', progress: 30 } } })

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.vm.genVideoPhase).toBe('running')
    expect(wrapper.vm.genVideoBusy).toBe(true)
    wrapper.vm.handleGenVideoClose()

    // 脱离：弹窗关闭 + 前端跟踪态整体复位（busy 释放、runId/stages 清空），主进程 run 不被取消
    expect(wrapper.vm.genVideoModalOpen).toBe(false)
    expect(wrapper.vm.genVideoPhase).toBe('idle')
    expect(wrapper.vm.genVideoBusy).toBe(false)
    expect(wrapper.vm.genVideoRunId).toBeNull()
    expect(wrapper.vm.genVideoStages).toHaveLength(0)
    expect(pipelineCancelRun).not.toHaveBeenCalled()

    // 复位后可立即重复发起（前端已无在跟踪的任务）
    await wrapper.vm.startGenerateVideo(mockTopics[1])
    expect(pipelineStartOrchestrated).toHaveBeenCalledTimes(2)
  })

  // 改写/启动阶段（尚无主进程 run）：关闭 = 中止前端编排，不启动流水线、不产生后台任务
  it('generate-video close during rewrite aborts frontend orchestration without starting pipeline', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockImplementation(() => new Promise(() => {}))

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.genVideoPhase).toBe('rewriting')
    wrapper.vm.handleGenVideoClose()

    expect(wrapper.vm.genVideoModalOpen).toBe(false)
    expect(wrapper.vm.genVideoPhase).toBe('idle')
    expect(wrapper.vm.genVideoBusy).toBe(false)
    expect(pipelineStartOrchestrated).not.toHaveBeenCalled()
    expect(pipelineCancelRun).not.toHaveBeenCalled()
  })

  // 弹窗内编排在途时 busy 守卫仍生效：避免同一弹窗内产生两条不受跟踪的编排
  it('generate-video busy guard still blocks a second orchestration while rewrite is in flight', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockImplementation(() => new Promise(() => {}))

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.genVideoPhase).toBe('rewriting')
    expect(wrapper.find('[data-testid="hot-topic-generate-video-toutiao:1"]').attributes('disabled')).toBeDefined()
    await wrapper.vm.startGenerateVideo(mockTopics[1])
    expect(aiRewrite).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.genVideoTopic.id).toBe(mockTopics[0].id)
  })

  // ─── 2026-09-12 需求回归：视频流水线弹窗统一【后台运行】按钮 + 全局居中提示 ───

  it('running pipeline modal shows background-run button and clicking it detaches with centered toast', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '后台按钮文案' } })
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-bg-btn-1' } })
    pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: 'run-bg-btn-1', status: { status: 'running', progress: 40 } } })

    const el = document.createElement('div')
    document.body.appendChild(el)
    const attached = mount(HotTopics, {
      attachTo: el,
      global: { plugins: [i18n], stubs: { 'el-alert': true, 'el-select': true, 'el-option': true, 'el-progress': true, 'el-skeleton': true } },
    })
    await flushPromises()
    await attached.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))

    expect(attached.vm.genVideoPhase).toBe('running')
    // UiModal 经 Teleport 渲染到 body，wrapper.find 找不到 footer 按钮；用 body 查询（与 publish-dest-article 同模式）
    const bgBtn = document.body.querySelector('[data-testid="hot-topics-gen-video-background"]')
    expect(bgBtn).toBeTruthy()
    expect(bgBtn.textContent).toContain('genVideoBackgroundRun')
    expect(pipelineBackgroundToastVisible.value).toBe(false)

    bgBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    // 脱离语义：弹窗关闭、前端跟踪态复位（busy 释放）、run 不被取消
    expect(attached.vm.genVideoModalOpen).toBe(false)
    expect(attached.vm.genVideoPhase).toBe('idle')
    expect(attached.vm.genVideoBusy).toBe(false)
    expect(attached.vm.genVideoRunId).toBeNull()
    expect(pipelineCancelRun).not.toHaveBeenCalled()
    // 全局居中提示已触发（模块级单例，脱离视图存活）
    expect(pipelineBackgroundToastVisible.value).toBe(true)
    attached.unmount()
    el.remove()
    hidePipelineBackgroundToast()
  })

  // 回归（2026-09-13 用户报障）：【后台运行】后再次点击另一条选题的【生成视频】无反应
  it('after background-run detach, another topic can start a parallel pipeline immediately', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    // 按调用序号返回不同产物：序号化实现（非 once 队列）避免用例失败时的实现泄漏
    const rewriteResults = ['选题A文案', '选题B文案']
    let rewriteIdx = 0
    aiRewrite.mockImplementation(async () => ({
      code: 0,
      data: { success: true, result: rewriteResults[rewriteIdx++] || '兜底文案' },
    }))
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    const runIds = ['run-parallel-1', 'run-parallel-2']
    let runIdx = 0
    pipelineStartOrchestrated.mockImplementation(async () => ({
      code: 0,
      data: { success: true, runId: runIds[runIdx++] || 'run-extra' },
    }))
    pipelineGetRunContext.mockImplementation(async (runId) => ({
      code: 0,
      data: { runId, status: { status: 'running', progress: 25 } },
    }))

    const el = document.createElement('div')
    document.body.appendChild(el)
    const attached = mount(HotTopics, {
      attachTo: el,
      global: { plugins: [i18n], stubs: { 'el-alert': true, 'el-select': true, 'el-option': true, 'el-progress': true, 'el-skeleton': true } },
    })
    await flushPromises()

    // 第一条任务：选题 A → 运行中
    await attached.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))
    expect(attached.vm.genVideoPhase).toBe('running')
    expect(attached.vm.genVideoRunId).toBe('run-parallel-1')

    // 点击【后台运行】脱离（run 在主进程继续，前端不再跟踪）
    const bgBtn = document.body.querySelector('[data-testid="hot-topics-gen-video-background"]')
    expect(bgBtn).toBeTruthy()
    bgBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(attached.vm.genVideoBusy).toBe(false)
    expect(pipelineCancelRun).not.toHaveBeenCalled()

    // 第二条任务：选题 B 的【生成视频】按钮必须可用并能并行启动
    const secondBtn = attached.find('[data-testid="hot-topic-generate-video-toutiao:1"]')
    expect(secondBtn.attributes('disabled')).toBeUndefined()
    await secondBtn.trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))

    expect(aiRewrite).toHaveBeenCalledTimes(2)
    expect(pipelineStartOrchestrated).toHaveBeenCalledTimes(2)
    expect(pipelineStartOrchestrated.mock.calls[1][1].text).toBe('选题B文案')
    expect(attached.vm.genVideoModalOpen).toBe(true)
    expect(attached.vm.genVideoPhase).toBe('running')
    expect(attached.vm.genVideoRunId).toBe('run-parallel-2')

    attached.unmount()
    el.remove()
    hidePipelineBackgroundToast()
  })

  it('background-run button hidden during rewrite (no run yet) and in terminal states', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockImplementation(() => new Promise(() => {}))

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()

    // 改写阶段：无主进程 run，不应提供后台运行（Teleport 到 body，用 body 查询断言）
    expect(wrapper.vm.genVideoPhase).toBe('rewriting')
    expect(document.body.querySelector('[data-testid="hot-topics-gen-video-background"]')).toBeNull()

    // 终态（取消）后同样不显示
    await wrapper.vm.cancelGenVideo()
    await flushPromises()
    expect(wrapper.vm.genVideoPhase).toBe('cancelled')
    expect(document.body.querySelector('[data-testid="hot-topics-gen-video-background"]')).toBeNull()
  })

  it('mergeGenStages does not downgrade terminal stages on stale push', async () => {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.genVideoStages = [
      { id: 'rewrite_copy', name: 'rewrite_copy', status: 'completed', startedAt: null, completedAt: '2026-09-12T00:00:00Z' },
      { id: 'split', name: 'split', status: 'running', startedAt: '2026-09-12T00:00:01Z', completedAt: null },
    ]
    wrapper.vm.mergeGenStages([
      { name: 'rewrite_copy', status: 'running' },
    ])
    expect(wrapper.vm.genVideoStages.find(s => s.name === 'rewrite_copy').status).toBe('completed')
  })
})

// ─── 收藏选题 tab ───
// 回归背景（2026-09-19 用户报障）：收藏列表行内正文/标签/时间/按钮挤成一团。
// 根因：列表行样式只写在 views/HotTopics.css，而该文件以 <style scoped> 编译到
// HotTopics.vue；Vue scoped 样式不穿透子组件，components/HotTopicsFavorites.vue
// 内部元素一条都匹配不到，flex/gap 全丢 → 退化为无间距的行内流。
const mockFavorites = [
  { topic: mockTopics[0], favoritedAt: 1757770440000 },
  { topic: mockTopics[1], favoritedAt: 1757819100000 },
]

/** 挂载并切到「收藏选题」tab；favorites 可覆盖以构造边界数据 */
async function mountFavoritesTab(favorites = mockFavorites) {
  hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
  hotTopicsFavoriteList.mockResolvedValue({ code: 0, data: favorites })
  const wrapper = mountPage()
  await flushPromises()
  const tabs = wrapper.findAll('.tab-btn')
  await tabs[1].trigger('click')
  await flushPromises()
  return wrapper
}

describe('HotTopics 收藏选题 tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushSpy.mockClear()
    hotTopicsGetCache.mockResolvedValue({ code: 0, data: { topics: [], fetchedAt: 0, channelStats: {} } })
    hotTopicsFavoriteList.mockResolvedValue({ code: 0, data: [] })
    document.body.innerHTML = ''
  })

  // 根因回归保护：子组件必须自带 scoped 引入共用的列表样式表，否则行布局会再次塌成一行
  it('favorites child component imports the shared list stylesheet as its own scoped style', () => {
    // 相对路径读取沿用仓库既有源码级契约断言先例（UiModal.test.js / ProfileMenu.test.js）
    const child = readFileSync('./src/components/HotTopicsFavorites.vue', 'utf8')
    const parent = readFileSync('./src/views/HotTopics.vue', 'utf8')
    expect(child).toContain('<style scoped src="../styles/hot-topics-list.css"></style>')
    expect(parent).toContain('<style scoped src="../styles/hot-topics-list.css"></style>')
  })

  it('renders favorite rows with the same list/tag structure as hot rows', async () => {
    const wrapper = await mountFavoritesTab()
    const rows = wrapper.findAll('[data-testid="hot-topic-favorite-item"]')
    expect(rows).toHaveLength(2)

    const first = rows[0]
    expect(first.classes()).toContain('topic-item')
    expect(first.find('.fav-star').exists()).toBe(true)
    expect(first.find('.topic-text').text()).toContain('AI大模型最新突破进展')
    // 分类/渠道标签复用热门页同名 class（cat-tech 等分类色亦同源）
    expect(first.find('.tag.category-tag').classes()).toContain('cat-tech')
    expect(first.find('.tag.channel-tag').exists()).toBe(true)
    expect(first.find('.hot-value').exists()).toBe(true) // hotValue=12000000 → 显示
    expect(first.find('.fav-date').exists()).toBe(true)
  })

  it('every favorite row exposes unfavorite / create-copy / generate-video actions', async () => {
    const wrapper = await mountFavoritesTab()
    expect(wrapper.findAll('[data-testid^="hot-topic-favorite-unfav-"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid^="hot-topic-favorite-create-copy-"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid^="hot-topic-favorite-generate-video-"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="hot-topic-favorite-create-copy-zhihu:1"]').text()).toContain('createCopy')
    // 生成视频为行内主按钮（与热门行保持同一视觉层级）
    expect(wrapper.find('[data-testid="hot-topic-favorite-generate-video-zhihu:1"]').classes()).toContain('cohere-btn-primary')
  })

  it('create-copy on a favorite row navigates to /rewrite with that topic', async () => {
    const wrapper = await mountFavoritesTab()
    await wrapper.find('[data-testid="hot-topic-favorite-create-copy-toutiao:1"]').trigger('click')
    expect(pushSpy).toHaveBeenCalledWith('/rewrite?topic=' + encodeURIComponent('A股大涨沪指重返3000点'))
  })

  it('generate-video on a favorite row rewrites and starts the story2video pipeline', async () => {
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '收藏选题改写文案' } })
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-fav-1' } })
    pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: 'run-fav-1', status: { status: 'running', progress: 10 } } })

    const wrapper = await mountFavoritesTab()
    await wrapper.find('[data-testid="hot-topic-favorite-generate-video-toutiao:1"]').trigger('click')
    await flushPromises()

    expect(aiRewrite).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'create',
      content: expect.stringContaining('A股大涨沪指重返3000点'),
    }))
    expect(pipelineStartOrchestrated).toHaveBeenCalledWith('story2video-compose', expect.objectContaining({ text: '收藏选题改写文案' }))
    expect(wrapper.vm.genVideoModalOpen).toBe(true)
  })

  it('generate-video disabled while another favorites-row orchestration is busy', async () => {
    aiRewrite.mockImplementation(() => new Promise(() => {}))
    const wrapper = await mountFavoritesTab()
    await wrapper.find('[data-testid="hot-topic-favorite-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()

    expect(wrapper.vm.genVideoBusy).toBe(true)
    expect(wrapper.find('[data-testid="hot-topic-favorite-generate-video-toutiao:1"]').attributes('disabled')).toBeDefined()
  })

  it('unfavorite removes the row after IPC success', async () => {
    hotTopicsFavoriteRemove.mockResolvedValue({ code: 0 })
    const wrapper = await mountFavoritesTab()
    await wrapper.find('[data-testid="hot-topic-favorite-unfav-zhihu:1"]').trigger('click')
    await flushPromises()

    expect(hotTopicsFavoriteRemove).toHaveBeenCalledWith('zhihu:1')
    expect(wrapper.findAll('[data-testid="hot-topic-favorite-item"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('AI大模型最新突破进展')
  })

  // 损坏收藏数据（topic 为 null）：布局不塌、清理入口保留、依赖话题的操作禁用
  it('broken favorite entry keeps its row, allows cleanup, and disables topic-dependent actions', async () => {
    hotTopicsFavoriteRemove.mockResolvedValue({ code: 0 })
    const wrapper = await mountFavoritesTab([{ topic: null, favoritedAt: 1757770440000 }])
    const row = wrapper.find('[data-testid="hot-topic-favorite-item"]')
    expect(row.exists()).toBe(true)
    expect(row.find('.topic-text').text()).toBe('—')
    expect(wrapper.find('[data-testid="hot-topic-favorite-create-copy-1757770440000"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="hot-topic-favorite-generate-video-1757770440000"]').attributes('disabled')).toBeDefined()
    const unfav = wrapper.find('[data-testid="hot-topic-favorite-unfav-1757770440000"]')
    expect(unfav.attributes('disabled')).toBeUndefined()
    await unfav.trigger('click')
    await flushPromises()
    expect(hotTopicsFavoriteRemove).toHaveBeenCalledWith('1757770440000')
  })

  it('empty favorites renders the shared EmptyState component', async () => {
    const wrapper = await mountFavoritesTab([])
    const empty = wrapper.find('[data-testid="hot-topics-favorites-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.classes()).toContain('mp-empty-state')
    expect(empty.text()).toContain('favoritesEmptyTitle')
    expect(empty.text()).toContain('favoritesEmptyDesc')
    expect(wrapper.findAll('[data-testid="hot-topic-favorite-item"]')).toHaveLength(0)
  })
})

// ── heat ranking UI (P1 unified rank / category resort / multi badge / trend) ──
describe('HotTopics heat ranking UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hotTopicsGetCache.mockResolvedValue({ code: 0, data: { topics: [], fetchedAt: 0, channelStats: {} } })
    hotTopicsFavoriteList.mockResolvedValue({ code: 0, data: [] })
    document.body.innerHTML = ''
  })

  async function mountWith(topics) {
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics, fetchedAt: Date.now(), channelStats: {} } })
    const wrapper = mountPage()
    await flushPromises()
    return wrapper
  }
  const scored = (id, score, extra = {}) => ({
    id, topic: id + '选题', channel: 'weibo', category: 'society', categories: ['society'],
    rank: 9, hotValue: 100, url: null, fetchedAt: '2026-09-22T00:00:00Z', score, ...extra,
  })

  it('renders list ordered by unified score and shows viewRank in badge', async () => {
    const wrapper = await mountWith([
      scored('b', 0.3, { viewRank: 7 }),
      scored('a', 0.9, { viewRank: 3 }),
    ])
    const items = wrapper.findAll('.topic-item')
    expect(items[0].find('.topic-text').text()).toContain('a选题')
    const badges = wrapper.findAll('.rank-badge')
    expect(badges[0].text()).toBe('3')
    expect(badges[1].text()).toBe('7')
  })

  it('falls back to view index for legacy cache entries without score/viewRank (P3 compat)', async () => {
    const legacy = [{ id: 'zhihu:1', topic: '旧缓存条目', channel: 'zhihu', category: 'tech', rank: 1, hotValue: null, url: null, fetchedAt: '2026-09-01T00:00:00Z' }]
    const wrapper = await mountWith(legacy)
    const badges = wrapper.findAll('.rank-badge')
    expect(badges[0].text()).toBe('1')
  })

  it('shows multi-board badge when sourceCount >= 2', async () => {
    const wrapper = await mountWith([
      scored('m', 0.9, { viewRank: 1, sourceCount: 3, mergedFrom: ['zhihu', 'baidu'] }),
      scored('s', 0.5, { viewRank: 2 }),
    ])
    const multi = wrapper.findAll('[data-testid="hot-topic-multi-badge"]')
    expect(multi).toHaveLength(1)
    expect(wrapper.findAll('.topic-item')[0].text()).toContain('m选题')
  })

  it('legacy mergedFrom containing own channel does not show phantom multi badge (review m-2)', async () => {
    const wrapper = await mountWith([
      { id: 'weibo:1', topic: '同渠道跨榜合并条目', channel: 'weibo', category: 'society', categories: ['society'], rank: 1, hotValue: 100, mergedFrom: ['weibo'], fetchedAt: '2026-09-22T00:00:00Z' },
    ])
    expect(wrapper.find('[data-testid="hot-topic-multi-badge"]').exists()).toBe(false)
  })

  it('renders trend arrows for up / down / new', async () => {
    const wrapper = await mountWith([
      scored('u', 0.9, { viewRank: 1, trend: 'up' }),
      scored('d', 0.8, { viewRank: 2, trend: 'down' }),
      scored('n', 0.7, { viewRank: 3, trend: 'new' }),
      scored('f', 0.6, { viewRank: 4, trend: 'flat' }),
    ])
    expect(wrapper.find('[data-testid="hot-topic-trend-up"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hot-topic-trend-down"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hot-topic-trend-new"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid^="hot-topic-trend-"]')).toHaveLength(3)
  })

  it('category view keeps score order across mixed channels', async () => {
    const topics = [
      scored('low', 0.2, { viewRank: 2, category: 'finance', categories: ['finance'] }),
      scored('hit', 0.95, { viewRank: 1, category: 'finance', categories: ['finance'], channel: 'zhihu' }),
    ]
    const wrapper = await mountWith(topics)
    const chips = wrapper.findAll('[data-testid="hot-topic-cat-count-finance"]')
    expect(chips).toHaveLength(1)
    await chips[0].trigger('click')
    const texts = wrapper.findAll('.topic-text').map(n => n.text())
    expect(texts[0]).toContain('hit选题')
  })
})
