// @ts-check
/**
 * hot-topics-publish-ux（2026-10-12）回归锁
 *
 * 范围：
 * 1. 按钮改名「改写并发布」/ "Rewrite & *Publish"（locales zh/en 成对，CI Gate 7）
 * 2. 改写完成条目内联预览/编辑（goToDestination 回写草稿）
 * 3. 分阶段 loading 提示 key（publishStageRewrite / publishStagePrepare）
 * 4. 单条「发布」按钮 = 单篇一键改写（复用批量队列，队列长度 1，不弹目标弹 Vibes 弹窗）
 * 5. 手工发布页横幅 key（publishPage.handoff.banner）
 *
 * 判据锚点选择说明：
 * - 文案断言打 locales 真源文件（i18n mock 下组件渲染出 key 蒙版而非文案，模板断言无意义）
 * - 行为断言打组件契约（defineExpose / DOM），与既有 HotTopics.test.js 同模式
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// ── ① locales 契约（zh/en 成对 + 文案变更） ──

describe('hot-topics-publish-ux locales 契约', () => {
  const zh = readFileSync('./src/locales/hot-topics/zh.js', 'utf8')
  const en = readFileSync('./src/locales/hot-topics/en.js', 'utf8')
  const zhPublish = readFileSync('./src/locales/publish-page/zh.js', 'utf8')
  const enPublish = readFileSync('./src/locales/publish-page/en.js', 'utf8')

  function expectKey (source, key) {
    expect(source).toContain(key)
  }

  it('批量按钮改名「改写并发布」/ "Rewrite & Publish"（zh/en 成对）', () => {
    expectKey(zh, "publishBtn: '改写并发布'")
    expectKey(en, "publishBtn: 'Rewrite & Publish'")
  })

  it('分阶段 loading 提示 key 存在（zh/en 成对）', () => {
    expectKey(zh, 'publishStageRewrite:')
    expectKey(zh, 'publishStagePrepare:')
    expectKey(en, 'publishStageRewrite:')
    expectKey(en, 'publishStagePrepare:')
  })

  it('单条发布按钮 key 存在（zh/en 成对）', () => {
    expectKey(zh, 'singlePublishBtn:')
    expectKey(en, 'singlePublishBtn:')
  })

  it('发布页横幅 key 存在（zh/en 成对）', () => {
    expectKey(zhPublish, 'banner:')
    expectKey(enPublish, 'banner:')
  })
})

// ── ② 行为锁（组件契约） ──

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

import { mount, flushPromises } from '@vue/test-utils'
import HotTopics from './HotTopics.vue'
import i18n from '@/i18n'
import { hotTopicsFetch } from '@/api/hot-topics'
import { aiRewrite, draftSave } from '@/api/publisher'

const mockTopics = [
  { id: 'zhihu:1', topic: 'AI大模型最新突破进展', channel: 'zhihu', category: 'tech', rank: 1, hotValue: 12000000, url: null, fetchedAt: '2026-09-11T00:00:00Z' },
  { id: 'toutiao:1', topic: 'A股大涨沪指重返3000点', channel: 'toutiao', category: 'finance', rank: 1, hotValue: 456789, url: null, fetchedAt: '2026-09-11T00:00:00Z' },
]

function mountPage() {
  return mount(HotTopics, {
    global: { plugins: [i18n], stubs: { 'el-alert': true, 'el-select': true, 'el-option': true, 'el-progress': true, 'el-skeleton': true } },
  })
}

describe('hot-topics-publish-ux 行为锁', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pushSpy.mockClear()
    hotTopicsFetch.mockResolvedValue({ code: 0, data: { topics: mockTopics, fetchedAt: Date.now(), channelStats: {} } })
  })

  it('每条选题行渲染「发布」按钮（最右侧）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const btns = wrapper.findAll('[data-testid^="hot-topic-publish-"]')
    expect(btns).toHaveLength(mockTopics.length)
    expect(btns[0].text()).toContain('singlePublishBtn')
  })

  it('单条「发布」= 单篇一键改写：跳过目标弹窗，队列长度 1，仅改写该条', async () => {
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '单条改写结果' } })
    draftSave.mockResolvedValue({ code: 0 })
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('[data-testid="hot-topic-publish-zhihu:1"]').trigger('click')
    await flushPromises()
    // 只改写本条：aiRewrite 恰好 1 次、入参含本条 topic
    expect(aiRewrite).toHaveBeenCalledTimes(1)
    expect(aiRewrite.mock.calls[0][0].content).toContain('AI大模型最新突破进展')
    expect(draftSave).toHaveBeenCalledTimes(1)
    // 队列长度 1 且完成
    expect(wrapper.vm.publishQueue).toHaveLength(1)
    expect(wrapper.vm.publishQueue[0].status).toBe('success')
    // 不弹目标弹窗（弹窗仅在批量入口 startPublish 中打开）
    expect(wrapper.vm.showPublishModal).toBe(false)
  })

  it('内联编辑回写：goToDestination 前把编辑后的正文持久化', async () => {
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '初版改写' } })
    draftSave.mockResolvedValue({ code: 0 })
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.vm.startSinglePublish(mockTopics[0])
    await flushPromises()
    // 模拟内联编辑（编辑器展开中直接去发布：persistEditedDrafts 会先冲刷）
    wrapper.vm.editingItemId = wrapper.vm.publishQueue[0].id
    wrapper.vm.editingDraftContent = '用户修改后的文案'
    await wrapper.vm.$nextTick()
    pushSpy.mockClear()
    draftSave.mockClear()
    await wrapper.vm.goToDestination()
    // 编辑结果先落草稿库再跳转
    expect(draftSave).toHaveBeenCalledWith(expect.objectContaining({
      id: wrapper.vm.publishQueue[0].draftId,
      content: '用户修改后的文案',
    }))
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('内联编辑回写失败：阻止跳转并保持进度区可见', async () => {
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '初版改写' } })
    draftSave.mockResolvedValue({ code: 0 })
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.vm.startSinglePublish(mockTopics[0])
    await flushPromises()
    wrapper.vm.editingDraftContent = '用户修改后的文案'
    draftSave.mockResolvedValueOnce({ code: -1, message: 'save failed' })
    pushSpy.mockClear()
    await wrapper.vm.goToDestination()
    expect(pushSpy).not.toHaveBeenCalled()
    expect(wrapper.vm.publishDone).toBe(true)
  })
})
