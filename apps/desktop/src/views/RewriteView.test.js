import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'

// useRoute() 需要 router 环境；测试统一 mock vue-router（topic 场景由各用例覆盖 query）
const mockRouteQuery = { value: {} }
const mockRouterPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useRoute: () => ({ query: mockRouteQuery.value }),
}))

vi.mock('@/api/publisher', () => ({
  aiRewrite: vi.fn().mockImplementation(async (params) => ({
    code: 0,
    data: {
      success: true,
      result: '这是改写后的文案内容，用于测试。',
      strategy: { id: params?.strategyId || 'auto-strategy', name: params?.strategyId === 'strategy-douyin-viral' ? '抖音爆款策略' : '测试策略', category: 'viral' },
      warnings: [],
      sensitiveHits: [],
      knowledgeRefs: [],
      metadata: { mode: params?.mode, originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
      // content-quality-eval 桌面端闭环：改写质量评估报告
      quality: {
        sufficiency: 78.5,
        semanticPreservation: 65.2,
        originality: 82.1,
        simhashDistance: 8,
        verdict: 'pass',
        suggestions: ['改写质量良好，充分度与语义保持度均达标'],
        method: 'simhash',
      },
    },
  })),
  aiListRewriteStrategies: vi.fn().mockResolvedValue({
    code: 0,
    data: [
      { id: 'strategy-viral-storytelling', name: '爆款故事化策略', enabled: true },
      { id: 'strategy-douyin-viral', name: '抖音爆款策略', enabled: true },
    ],
  }),
  aiGetRecommendedStrategies: vi.fn().mockImplementation(async (userSettings) => ({
    code: 0,
    data: userSettings?.platform === 'douyin'
      ? [{ id: 'strategy-douyin-viral', name: '抖音爆款策略' }]
      : [{ id: 'strategy-viral-storytelling', name: '爆款故事化策略' }],
  })),
  draftSave: vi.fn().mockResolvedValue({ code: 0, data: true }),
  draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  storeGetSetting: vi.fn().mockResolvedValue(null),
  storeSetSetting: vi.fn().mockResolvedValue({}),
  applyKnowledgeFeedback: vi.fn().mockResolvedValue({ code: 0 }),
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
    notifyWarning: vi.fn(),
    notifyInfo: vi.fn(),
  }),
}))

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn().mockResolvedValue(true),
  }),
}))

vi.mock('@/utils/user-facing-error', () => ({
  formatUserError: (e, opts) => ({
    message: e?.message || opts?.fallback || 'unknown error',
  }),
}))

vi.mock('@/utils/notifyCore', () => ({
  resolveNotifyText: (key) => ({ text: key }),
}))

vi.mock('element-plus', () => ({}))
vi.mock('@element-plus/icons-vue', () => ({}))

import RewriteView from './RewriteView.vue'

function factory() {
  setActivePinia(createPinia())
  i18n.global.locale.value = 'zh'
  const wrapper = mount(RewriteView, {
    global: {
      plugins: [i18n],
      stubs: {
        PublishDestinationModal: true,
      },
      mocks: {
        $router: { push: vi.fn() },
        $route: { query: {} },
      },
    },
  })
  return wrapper
}

describe('RewriteView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
    mockRouterPush.mockClear()
  })

  it('renders the page title', () => {
    const wrapper = factory()
    expect(wrapper.text()).toContain('文案改写')
  })

  it('renders the text input area', () => {
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    expect(textarea.exists()).toBe(true)
  })

  it('renders config checkboxes with default values', () => {
    const wrapper = factory()
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(2)
    // 结合爆款库 默认勾选
    expect(checkboxes[0].element.checked).toBe(true)
    // 结合个人经历 默认不勾选
    expect(checkboxes[1].element.checked).toBe(false)
  })

  it('renders rewrite mode chips', () => {
    const wrapper = factory()
    const chips = wrapper.findAll('.mode-chip')
    expect(chips.length).toBe(3)
    expect(chips[0].text()).toContain('智能仿写')
    expect(chips[1].text()).toContain('扩写爆款')
    expect(chips[2].text()).toContain('选题创作')
  })

  it('renders target platform selector', () => {
    const wrapper = factory()
    const select = wrapper.find('select.config-select')
    expect(select.exists()).toBe(true)
  })

  // ── 字数区间控制（2026-09-12）──

  it('renders word count inputs with default 800-2000', () => {
    const wrapper = factory()
    const inputs = wrapper.findAll('input.word-count-input')
    expect(inputs.length).toBe(2)
    expect(Number(inputs[0].element.value)).toBe(800)
    expect(Number(inputs[1].element.value)).toBe(2000)
  })

  it('shows error and disables button when max < min', async () => {
    const wrapper = factory()
    const inputs = wrapper.findAll('input.word-count-input')
    await inputs[0].setValue(2000)
    await inputs[1].setValue(100)
    await nextTick()
    expect(wrapper.text()).toContain('最大字数不能小于最小字数')
    const btn = wrapper.find('.rewrite-start-btn')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('shows error for non-integer or out-of-range word count', async () => {
    const wrapper = factory()
    const inputs = wrapper.findAll('input.word-count-input')
    await inputs[1].setValue(7000)
    await nextTick()
    expect(wrapper.text()).toContain('最大字数需为 1-6000 的整数')
  })

  it('disables rewrite button when content is empty', async () => {
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('   ')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('enables rewrite button when content is long enough', async () => {
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，用于测试改写按钮的启用状态。')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('short content (no 20-char minimum) enables rewrite button', async () => {
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('太短')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    // 2026-09-12 移除最少字数：短内容（非空）即可改写
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('shows result and action buttons after successful rewrite', async () => {
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()

    // 结果应该显示出来
    const text = wrapper.text()
    expect(text).toContain('测试策略')
    // 改写结果写入结果 textarea
    const resultTextarea = wrapper.find('.result-textarea')
    expect(resultTextarea.exists()).toBe(true)
    expect(resultTextarea.element.value).toContain('这是改写后的文案内容')
    // 存入草稿/去发布按钮应该出现
    expect(wrapper.text()).toContain('存入草稿')
    expect(wrapper.text()).toContain('去发布')
  })

  it('shows quality assessment report after successful rewrite', async () => {
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()

    // 质量报告应显示
    const report = wrapper.find('[data-testid="rewrite-quality-report"]')
    expect(report.exists()).toBe(true)
    const text = report.text()
    expect(text).toContain('质量评估')
    expect(text).toContain('78.5') // 充分度
    expect(text).toContain('65.2') // 语义保持度
    expect(text).toContain('82.1') // 原创性
    expect(text).toContain('合格') // verdict=pass
    expect(text).toContain('改写质量良好') // 建议
  })

  it('shows quality-none placeholder when quality is absent', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '这是改写后的文案内容，用于测试。',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: null, // 无质量评估
      },
    })
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()

    const none = wrapper.find('[data-testid="rewrite-quality-none"]')
    expect(none.exists()).toBe(true)
    expect(none.text()).toContain('未生成质量评估')
  })

  it('does not show result section before rewrite', () => {
    const wrapper = factory()
    expect(wrapper.text()).not.toContain('改写结果')
  })

  // ── 视频创作入口（rewrite-to-video-entry 2026-09-13）──

  it('shows video create button in result actions after rewrite', async () => {
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()
    const videoBtn = wrapper.find('[data-testid="btn-video-create"]')
    expect(videoBtn.exists()).toBe(true)
    expect(videoBtn.text()).toContain('视频创作')
  })

  it('video create button saves draft then navigates to /create with draft query (no pipeline)', async () => {
    const { draftSave } = await import('@/api/publisher')
    draftSave.mockClear()
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    const videoBtn = wrapper.find('[data-testid="btn-video-create"]')
    await videoBtn.trigger('click')
    await nextTick()
    await nextTick()
    // 先存草稿
    expect(draftSave).toHaveBeenCalledTimes(1)
    // 再跳转 /create?draft=xxx（不预选流水线，用户在创作页自选）
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith({ path: '/create', query: { draft: expect.any(String) } })
    const query = mockRouterPush.mock.calls[0][0].query
    expect(query.pipeline).toBeUndefined()
  })

  it('video create button does not navigate when draft save fails', async () => {
    const { draftSave } = await import('@/api/publisher')
    draftSave.mockResolvedValueOnce({ code: -1, message: 'save failed' })
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    await wrapper.find('[data-testid="btn-video-create"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('video create button is re-entry safe: double click saves draft once and navigates once', async () => {
    const { draftSave } = await import('@/api/publisher')
    draftSave.mockClear()
    mockRouterPush.mockClear()
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    const videoBtn = wrapper.find('[data-testid="btn-video-create"]')
    // 连点两次：两次 click 同步触发（第二次在第一次的 await saveToDraft() 挂起、锁未释放时进入）
    const firstClick = videoBtn.trigger('click')
    const secondClick = videoBtn.trigger('click')
    await firstClick
    await secondClick
    await nextTick()
    await nextTick()
    expect(draftSave).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledTimes(1)
  })

  it('rewrite mode chip click changes active mode', async () => {
    const wrapper = factory()
    const chips = wrapper.findAll('.mode-chip')
    // 默认 create 是 active
    expect(chips[2].classes()).toContain('active')
    // 点击 imitate
    await chips[0].trigger('click')
    await nextTick()
    expect(wrapper.findAll('.mode-chip')[0].classes()).toContain('active')
  })

  it('viral library checkbox can be toggled', async () => {
    const wrapper = factory()
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes[0].element.checked).toBe(true)
    await checkboxes[0].trigger('click')
    await nextTick()
    expect(checkboxes[0].element.checked).toBe(false)
  })

  // ─── P2 隐式反馈：保存草稿=采纳，再次改写=弃用 ───
  it('saving draft sends adopted feedback for knowledgeRefs', async () => {
    const { aiRewrite, applyKnowledgeFeedback } = await import('@/api/publisher')
    aiRewrite.mockResolvedValue({
      code: 0,
      data: {
        success: true,
        result: '这是改写后的文案内容，用于测试。',
        strategy: { id: 'test-strategy', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [{ table: 'viral_library', id: 'v1' }],
        metadata: { mode: 'create', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
      },
    })
    applyKnowledgeFeedback.mockClear()
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()
    // 点击存入草稿
    const saveBtn = wrapper.findAll('button').find(b => b.text().includes('存入草稿'))
    await saveBtn.trigger('click')
    await nextTick()
    await nextTick()
    expect(applyKnowledgeFeedback).toHaveBeenCalledWith(
      'adopted',
      expect.arrayContaining([expect.objectContaining({ table: 'viral_library', id: 'v1' })])
    )
  })
})

describe('RewriteView — hot topics topic query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
  })

  it('fills content with topic and auto-starts rewrite in create mode (>=20 chars)', async () => {
    mockRouteQuery.value = { topic: '这是一个足够长的热门选题标题超过二十个字用于测试自动改写触发场景' }
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    const wrapper = factory()
    await nextTick()
    await nextTick()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    expect(textarea.element.value).toContain('热门选题标题')
    // 自动触发改写
    expect(aiRewrite).toHaveBeenCalledTimes(1)
    const params = aiRewrite.mock.calls[0][0]
    expect(params.mode).toBe('create')
  })

  it('short topic fills content directly without guide prefix', async () => {
    mockRouteQuery.value = { topic: '短选题' }
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    const wrapper = factory()
    await nextTick()
    await nextTick()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    // 2026-09-12 移除 ≥20 字符限制：短选题直接填入，不再补引导语
    expect(textarea.element.value).toBe('短选题')
    expect(aiRewrite).toHaveBeenCalledTimes(1)
  })

  it('does nothing when topic query is missing', async () => {
    mockRouteQuery.value = {}
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    factory()
    await nextTick()
    await nextTick()
    expect(aiRewrite).not.toHaveBeenCalled()
  })
})

describe('RewriteView — 策略选择与匹配预览', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
  })

  it('renders strategy section with auto mode by default and no dropdown', async () => {
    const wrapper = factory()
    await nextTick()
    await nextTick()
    // 默认「自动匹配」radio 选中
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    expect(radios.length).toBe(2)
    expect(radios[0].element.checked).toBe(true)
    // 默认不渲染策略下拉
    expect(wrapper.find('select.strategy-select').exists()).toBe(false)
  })

  it('shows strategy dropdown when switching to manual mode', async () => {
    const wrapper = factory()
    await nextTick()
    await nextTick()
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    await radios[1].setValue('manual')
    await nextTick()
    const select = wrapper.find('select.strategy-select')
    expect(select.exists()).toBe(true)
    const options = select.findAll('option')
    // 占位 + 2 个策略
    expect(options.length).toBe(3)
    expect(options[1].text()).toContain('爆款故事化策略')
    expect(options[2].text()).toContain('抖音爆款策略')
  })

  it('previews auto-matched strategy name on mount', async () => {
    const wrapper = factory()
    await nextTick()
    await nextTick()
    await nextTick()
    const { aiGetRecommendedStrategies } = await import('@/api/publisher')
    expect(aiGetRecommendedStrategies).toHaveBeenCalled()
    expect(wrapper.find('.strategy-preview').text()).toContain('爆款故事化策略')
  })

  it('refreshes preview when platform changes', async () => {
    const wrapper = factory()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(wrapper.find('.strategy-preview').text()).toContain('爆款故事化策略')
    const select = wrapper.find('select.config-select')
    await select.setValue('douyin')
    await nextTick()
    await nextTick()
    await nextTick()
    expect(wrapper.find('.strategy-preview').text()).toContain('抖音爆款策略')
  })

  it('degrades preview to placeholder when recommend IPC fails', async () => {
    const { aiGetRecommendedStrategies } = await import('@/api/publisher')
    aiGetRecommendedStrategies.mockRejectedValueOnce(new Error('ipc down'))
    const wrapper = factory()
    await nextTick()
    await nextTick()
    await nextTick()
    expect(wrapper.find('.strategy-preview').text()).toContain('--')
  })

  it('sends strategyId=null in auto mode', async () => {
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试自动模式传参。')
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    expect(aiRewrite).toHaveBeenCalledTimes(1)
    expect(aiRewrite.mock.calls[0][0].strategyId).toBeNull()
  })

  it('sends selected strategyId in manual mode', async () => {
    const wrapper = factory()
    await nextTick()
    await nextTick()
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    await radios[1].setValue('manual')
    await nextTick()
    const select = wrapper.find('select.strategy-select')
    await select.setValue('strategy-douyin-viral')
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试手动模式传参。')
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    expect(aiRewrite).toHaveBeenCalledTimes(1)
    expect(aiRewrite.mock.calls[0][0].strategyId).toBe('strategy-douyin-viral')
  })

  it('sends null when manual mode has no strategy selected', async () => {
    const wrapper = factory()
    await nextTick()
    await nextTick()
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    await radios[1].setValue('manual')
    await nextTick()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试手动未选策略。')
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    expect(aiRewrite.mock.calls[0][0].strategyId).toBeNull()
  })

  it('refreshes preview after rewrite completes (user history may change recommendations)', async () => {
    const { aiGetRecommendedStrategies } = await import('@/api/publisher')
    aiGetRecommendedStrategies.mockClear()
    const wrapper = factory()
    await nextTick()
    await nextTick()
    await nextTick()
    // 挂载时第 1 次预览
    expect(aiGetRecommendedStrategies).toHaveBeenCalledTimes(1)
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写后预览刷新。')
    const btn = wrapper.find('.rewrite-start-btn')
    await btn.trigger('click')
    await nextTick()
    await nextTick()
    await nextTick()
    // 改写结束后 finally 中再次刷新（第 2 次）
    expect(aiGetRecommendedStrategies).toHaveBeenCalledTimes(2)
  })

  it('drops stale preview result when platform switches quickly (race guard)', async () => {
    const { aiGetRecommendedStrategies } = await import('@/api/publisher')
    // 第一次调用（挂载，通用平台）慢返回，第二次（切抖音）快返回
    let resolveFirst
    aiGetRecommendedStrategies.mockImplementation(async (us) => {
      if (!us?.platform) {
        await new Promise((r) => { resolveFirst = r })
        return { code: 0, data: [{ id: 's-general', name: '通用慢策略' }] }
      }
      return { code: 0, data: [{ id: 'strategy-douyin-viral', name: '抖音爆款策略' }] }
    })
    const wrapper = factory()
    await nextTick()
    await nextTick()
    // 平台切换触发第二次（快）请求 → 显示抖音策略
    await wrapper.find('select.config-select').setValue('douyin')
    await nextTick()
    await nextTick()
    expect(wrapper.find('.strategy-preview').text()).toContain('抖音爆款策略')
    // 慢的第一次请求现在才返回 → 应被序列号守卫丢弃，不覆盖抖音结果
    resolveFirst()
    await nextTick()
    await nextTick()
    expect(wrapper.find('.strategy-preview').text()).toContain('抖音爆款策略')
    expect(wrapper.find('.strategy-preview').text()).not.toContain('通用慢策略')
  })
})
