// @ts-check
/**
 * HotTopics 生成视频【去发布】标题生成与三级降级（fix-hot-topics-genvideo-title，2026-10-17）。
 *
 * 为什么独立成文件：`HotTopics.test.js` 加入本组用例后到 1671 行，越过
 * `check-max-lines` 的 1500 行测试上限（债务熔断 TEST_OVER_LIMIT），门禁处方
 * 「按被测模块/场景分文件」。标题降级是与「编排流程」不同的场景簇，独立后：
 *   - HotTopics.test.js 回落到 ~1430 行（<1500）
 *   - 本文件聚焦一条契约：标题来源 + 降级 + query 形状 + 重复点击幂等
 *
 * 夹具口径（关键）：`story2videoTextConfig.config.publish.title` 显式置为**空串**，
 * 与真实链路口径一致——修复前 `HotTopics.test.js` 的【去发布】夹具手写
 * `publish.title = '发布标题'`，而生产链路该字段恒为空，于是缺陷路径在测试中
 * 被伪装成正确行为（详见 PRD §3.13.10.10 逃逸分析）。
 */
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
  pipelineList: vi.fn(),
  pipelineStartOrchestrated: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelineCancelRun: vi.fn(),
  onPipelineUpdate: vi.fn(() => vi.fn()),
  modelProviderGetDefault: vi.fn(),
  aiGenerateGenVideoTitle: vi.fn(),
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
import { hotTopicsFetch, hotTopicsGetCache, hotTopicsFavoriteList } from '@/api/hot-topics'
import { aiRewrite, draftSave, storeGetSetting, pipelineList, pipelineStartOrchestrated, pipelineGetRunContext, modelProviderGetDefault, aiGenerateGenVideoTitle } from '@/api/publisher'

const mockTopics = [
  { id: 'zhihu:1', topic: 'AI大模型最新突破进展', channel: 'zhihu', category: 'tech', rank: 1, hotValue: 12000000, url: null, fetchedAt: '2026-09-11T00:00:00Z' },
  { id: 'toutiao:1', topic: 'A股大涨沪指重返3000点', channel: 'toutiao', category: 'finance', rank: 1, hotValue: 456789, url: null, fetchedAt: '2026-09-11T00:00:00Z' },
  { id: 'baidu:1', topic: '普通日常记录', channel: 'baidu', category: 'general', rank: 1, hotValue: null, url: null, fetchedAt: '2026-09-11T00:00:00Z' },
]

const mockPipelineList = [
  { name: 'story2video-compose', available: true },
  { name: 'animated-explainer', available: true },
  { name: 'talking-head', available: true },
  { name: 'cinematic', available: true },
  { name: 'animation', available: true },
  { name: 'framework-smoke', available: true },
  { name: 'film-engineering', available: true },
]

describe('HotTopics.vue — 生成视频【去发布】标题生成与三级降级', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushSpy.mockClear()
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: [], fetchedAt: 0, channelStats: {} } })
    hotTopicsGetCache.mockResolvedValue({ code: 0, data: { topics: [], fetchedAt: 0, channelStats: {} } })
    hotTopicsFavoriteList.mockResolvedValue({ code: 0, data: [] })
    pipelineList.mockResolvedValue({ code: 0, data: mockPipelineList })
    // 默认有可用文字推理模型 + AI 标题成功（无模型/失败分支由专用用例覆盖）
    modelProviderGetDefault.mockResolvedValue({ code: 0, data: { id: 'openai', name: 'OpenAI' } })
    aiGenerateGenVideoTitle.mockResolvedValue({ code: 0, data: { success: true, title: '打工人醒醒！AI又抢活了' } })
    // 清理上一用例 Teleport 到 body 的弹窗残留，隔离用例。
    // 不用 `document.body.innerHTML = ''`：CCG 安全门禁把 innerHTML 判为高危（XSS），
    // 而本文件是全新文件、100% 行都算「本次改动」，存量过滤救不了。
    // 每个 wrapper 都 attachTo 到自建 el 并在用例末尾 el.remove()，这里只兜底清掉游离节点。
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
  })

  /**
   * 起一个已完成的 run，返回 wrapper。
   * @param {{withProject?: boolean, videoPath?: string, topic?: string}} [opts]
   *   withProject=false → 模拟非 S2V 流水线的 run-only 终态（无 story2videoProject）
   */
  async function mountCompletedRun (opts = {}) {
    const withProject = opts.withProject !== false
    const videoPath = opts.videoPath || 'D:/videos/out.mp4'
    const topic = opts.topic || mockTopics[0].topic
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '完整流程文案' } })
    draftSave.mockResolvedValue({ code: 0 })
    storeGetSetting.mockResolvedValue(null)
    pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-title-1' } })
    pipelineGetRunContext.mockResolvedValue({ code: 0, data: {
      runId: 'run-title-1',
      status: { status: 'completed', progress: 100, stages: [
        { name: 'split', status: 'completed' }, { name: 'compose', status: 'completed' },
      ] },
      context: withProject
        ? {
            compose: { data: { videoPath } },
            story2videoProject: {
              projectId: 'p1', title: '成片标题', sourceText: '成片正文', videoPath,
              story2videoTextConfig: { config: { publish: { title: '', content: '发布正文', tags: ['AI'] } } },
            },
          }
        : { compose: { data: { videoPath } } },
    } })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = mount(HotTopics, {
      attachTo: el,
      global: { plugins: [i18n], stubs: { 'el-alert': true, 'el-select': true, 'el-option': true, 'el-progress': true, 'el-skeleton': true } },
    })
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-generate-video-zhihu:1"]').trigger('click')
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))
    await flushPromises()
    expect(wrapper.vm.genVideoPhase).toBe('completed')
    return wrapper
  }

  function clickPublish () {
    document.body.querySelector('[data-testid="hot-topics-gen-video-publish"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  function lastPublishTarget () {
    return pushSpy.mock.calls.map(c => c[0]).find(v => v && v.path === '/publish')
  }

  it('C1 AI 标题成功：title 来自 AI 且 title_source=ai（不是正文切片）', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = await mountCompletedRun()

    pushSpy.mockClear()
    clickPublish()
    await flushPromises()
    const target = lastPublishTarget()
    expect(target).toBeTruthy()
    expect(decodeURIComponent(String(target.query.title))).toBe('打工人醒醒！AI又抢活了')
    expect(target.query.title_source).toBe('ai')
    expect(target.query.title_reason).toBeUndefined()
    // AI 标题生成带上了本次原始选题与改写正文
    expect(aiGenerateGenVideoTitle).toHaveBeenCalledTimes(1)
    const payload = aiGenerateGenVideoTitle.mock.calls[0][0]
    expect(payload.topicText).toBe('AI大模型最新突破进展')
    expect(payload.bodyText).toBe('完整流程文案')

    wrapper.unmount()
    el.remove()
  })

  it('C2 无默认文字推理模型：不调 AI，标题 = 原始选题 + no-model', async () => {
    modelProviderGetDefault.mockResolvedValue({ code: 0, data: null })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = await mountCompletedRun()

    pushSpy.mockClear()
    clickPublish()
    await flushPromises()
    const target = lastPublishTarget()
    expect(target).toBeTruthy()
    expect(decodeURIComponent(String(target.query.title))).toBe('AI大模型最新突破进展')
    expect(target.query.title_source).toBe('topic')
    expect(target.query.title_reason).toBe('no-model')
    expect(aiGenerateGenVideoTitle).not.toHaveBeenCalled()

    wrapper.unmount()
    el.remove()
  })

  it('C2b modelProviderGetDefault 抛错时也降级为原始选题', async () => {
    modelProviderGetDefault.mockRejectedValue(new Error('ipc down'))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = await mountCompletedRun()

    pushSpy.mockClear()
    clickPublish()
    await flushPromises()
    const target = lastPublishTarget()
    expect(decodeURIComponent(String(target.query.title))).toBe('AI大模型最新突破进展')
    expect(target.query.title_reason).toBe('no-model')
    expect(aiGenerateGenVideoTitle).not.toHaveBeenCalled()

    wrapper.unmount()
    el.remove()
  })

  it('C3 LLM 返回空：标题 = 原始选题 + failed', async () => {
    aiGenerateGenVideoTitle.mockResolvedValue({ code: 0, data: { success: false, reason: 'failed', message: 'x' } })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = await mountCompletedRun()

    pushSpy.mockClear()
    clickPublish()
    await flushPromises()
    const target = lastPublishTarget()
    expect(decodeURIComponent(String(target.query.title))).toBe('AI大模型最新突破进展')
    expect(target.query.title_source).toBe('topic')
    expect(target.query.title_reason).toBe('failed')

    wrapper.unmount()
    el.remove()
  })

  it('C3b LLM 调用抛错：标题 = 原始选题 + failed，且仍然跳转', async () => {
    aiGenerateGenVideoTitle.mockRejectedValue(new Error('boom'))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = await mountCompletedRun()

    pushSpy.mockClear()
    clickPublish()
    await flushPromises()
    const target = lastPublishTarget()
    expect(target).toBeTruthy()
    expect(decodeURIComponent(String(target.query.title))).toBe('AI大模型最新突破进展')
    expect(target.query.title_reason).toBe('failed')

    wrapper.unmount()
    el.remove()
  })

  it('C4 run-only（无项目）也带标题；content/tags 仍不注入', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    // 非 S2V 流水线终态：无 story2videoProject
    const wrapper = await mountCompletedRun({ withProject: false })

    pushSpy.mockClear()
    clickPublish()
    await flushPromises()
    const target = lastPublishTarget()
    expect(decodeURIComponent(String(target.query.video_path))).toBe('D:/videos/out.mp4')
    expect(decodeURIComponent(String(target.query.title))).toBe('打工人醒醒！AI又抢活了')
    expect(target.query.title_source).toBe('ai')
    expect(target.query.content).toBeUndefined()
    expect(target.query.tags).toBeUndefined()

    wrapper.unmount()
    el.remove()
  })

  it('C5 标题取自原始选题，不被改写文案污染', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = await mountCompletedRun()

    pushSpy.mockClear()
    clickPublish()
    await flushPromises()
    // 断言：送进标题生成的 topicText 是选题原文，不是改写正文
    expect(aiGenerateGenVideoTitle).toHaveBeenCalledTimes(1)
    const payload = aiGenerateGenVideoTitle.mock.calls[0][0]
    expect(payload.topicText).toBe('AI大模型最新突破进展')
    expect(payload.topicText).not.toContain('完整流程文案')
    // 正文摘要来自改写产物（给 AI 做参考），但与 topicText 是不同字段
    expect(payload.bodyText).toBe('完整流程文案')

    wrapper.unmount()
    el.remove()
  })

  it('C6 标题生成期间重复点击只发起一次 LLM 调用、只跳转一次', async () => {
    // 让标题生成挂起，模拟慢模型
    let resolveTitle
    aiGenerateGenVideoTitle.mockImplementation(() => new Promise((resolve) => { resolveTitle = resolve }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = await mountCompletedRun()

    pushSpy.mockClear()
    clickPublish()
    await flushPromises()
    clickPublish()
    await flushPromises()
    expect(aiGenerateGenVideoTitle).toHaveBeenCalledTimes(1)
    expect(pushSpy).not.toHaveBeenCalled()

    resolveTitle({ code: 0, data: { success: true, title: '慢模型标题' } })
    await flushPromises()
    expect(pushSpy).toHaveBeenCalledTimes(1)
    const target = lastPublishTarget()
    expect(decodeURIComponent(String(target.query.title))).toBe('慢模型标题')

    wrapper.unmount()
    el.remove()
  })

  it('C7 完成态显示标题来源说明；生成中显示「正在生成标题…」', async () => {
    let resolveTitle
    aiGenerateGenVideoTitle.mockImplementation(() => new Promise((resolve) => { resolveTitle = resolve }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const wrapper = await mountCompletedRun()

    // 完成未点击：静态说明
    expect(document.body.querySelector('[data-testid="hot-topics-gen-video-title-hint"]')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="hot-topics-gen-video-title-generating"]')).toBeFalsy()

    // 点击后（生成中）：生成中文案
    clickPublish()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="hot-topics-gen-video-title-generating"]')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="hot-topics-gen-video-title-hint"]')).toBeFalsy()

    resolveTitle({ code: 0, data: { success: true, title: 'x' } })
    await flushPromises()
    wrapper.unmount()
    el.remove()
  })
})
