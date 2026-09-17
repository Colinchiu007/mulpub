import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
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

  // ── CCG 评审修复（2026-09-13）──

  it('第二次改写无 quality 时旧质量报告不残留（stale-data 修复）', async () => {
    const mocks = await import('@/api/publisher')
    // 第一次改写返回 quality
    mocks.aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '第一次改写结果',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [], sensitiveHits: [], knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: { sufficiency: 80, semanticPreservation: 70, originality: 85, verdict: 'pass', suggestions: ['好'], method: 'simhash' },
      },
    })
    // 第二次改写无 quality
    mocks.aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '第二次改写结果',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [], sensitiveHits: [], knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: null,
      },
    })
    const wrapper = factory()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    const btn = wrapper.find('.rewrite-start-btn')
    // 第一次改写 → 质量报告显示
    await btn.trigger('click')
    await nextTick()
    await nextTick()
    expect(wrapper.find('[data-testid="rewrite-quality-report"]').exists()).toBe(true)
    // 第二次改写 → 质量报告不残留，显示占位
    await btn.trigger('click')
    await nextTick()
    await nextTick()
    expect(wrapper.find('[data-testid="rewrite-quality-report"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="rewrite-quality-none"]').exists()).toBe(true)
  })

  it('quality 为数组时显示占位（非对象不展示）', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '改写结果',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [], sensitiveHits: [], knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: [{ sufficiency: 80 }], // 数组 → 应显示占位
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
    expect(wrapper.find('[data-testid="rewrite-quality-report"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="rewrite-quality-none"]').exists()).toBe(true)
  })

  it('verdict 非法值回退为 fail，文案为中性「建议优化」而非「不合格」', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '改写结果',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [], sensitiveHits: [], knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: { sufficiency: 80, semanticPreservation: 70, originality: 85, verdict: 'unknown', suggestions: ['好'], method: 'simhash' },
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
    const report = wrapper.find('[data-testid="rewrite-quality-report"]')
    expect(report.exists()).toBe(true)
    expect(report.text()).toContain('建议优化') // verdict=unknown → fail，但用词中性
    // BUGFIX-REWRITE-QUALITY-UX 回归：负面结论用词不得回归
    expect(report.text()).not.toContain('不合格')
  })

  it('suggestions 非数组时不展示建议列表', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '改写结果',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [], sensitiveHits: [], knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: { sufficiency: 80, semanticPreservation: 70, originality: 85, verdict: 'pass', suggestions: '单条建议字符串', method: 'simhash' },
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
    const report = wrapper.find('[data-testid="rewrite-quality-report"]')
    expect(report.exists()).toBe(true)
    // suggestions 非数组 → 不渲染建议列表（不逐字符迭代）
    expect(report.find('.rewrite-quality-suggestions').exists()).toBe(false)
  })

  // ── 结果区元信息与复制按钮（BUGFIX-REWRITE-QUALITY-UX）──

  /** 改写模式 chip 顺序与组件内 rewriteModes 一致：imitate / expand / create */
  const MODE_CHIP_INDEX = { imitate: 0, expand: 1, create: 2 }

  /**
   * 跑一次改写并返回 wrapper。
   * @param {string} [mode] 指定改写模式（不传则用组件默认值 create）
   */
  async function runRewrite(mode) {
    const wrapper = factory()
    if (mode) {
      await wrapper.findAll('.mode-chip')[MODE_CHIP_INDEX[mode]].trigger('click')
      await nextTick()
    }
    const input = wrapper.find('textarea.rewrite-textarea')
    await input.setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    return wrapper
  }

  it('元信息栏渲染字数概览（占位符已被插值，不泄漏 {original}/{result}）', async () => {
    const wrapper = await runRewrite('imitate')
    const meta = wrapper.find('.rewrite-result-meta')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain('原文 30 字 → 结果 18 字')
    expect(meta.text()).not.toMatch(/\{[^{}]+\}/)
  })

  // 设计评审 Q5：选题创作模式的输入是「主题种子」而非待改写正文，
  // 字数概览若标成「原文」会把种子误读为需保留语义的原文（与评分口径同一概念陷阱）
  it('选题创作模式下字数概览用「主题」（组件默认模式即 create）', async () => {
    const wrapper = await runRewrite() // 不指定模式 → 组件默认 create
    const meta = wrapper.find('.rewrite-result-meta')
    expect(meta.text()).toContain('主题 30 字 → 结果 18 字')
    expect(meta.text()).not.toContain('原文')
    expect(meta.text()).not.toMatch(/\{[^{}]+\}/)
  })

  it('扩写模式下字数概览用「原文」', async () => {
    const wrapper = await runRewrite('expand')
    expect(wrapper.find('.rewrite-result-meta').text()).toContain('原文 30 字 → 结果 18 字')
  })

  it('元信息缺少 mode 时回退「原文」（向后兼容旧后端）', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '这是改写后的文案内容，用于测试。',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [], sensitiveHits: [], knowledgeRefs: [],
        metadata: { originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 }, // 无 mode 字段
        quality: { sufficiency: 78.5, semanticPreservation: 65.2, originality: 82.1, verdict: 'pass', suggestions: ['好'], method: 'simhash' },
      },
    })
    const wrapper = await runRewrite()
    expect(wrapper.find('.rewrite-result-meta').text()).toContain('原文 30 字 → 结果 18 字')
  })

  it('复制按钮渲染在结果文本框下方', async () => {
    const wrapper = await runRewrite()
    const btn = wrapper.find('[data-testid="btn-copy-result"]')
    expect(btn.exists()).toBe(true)
    // 按钮位于结果 textarea 之后（同一结果卡片内、动作行之前）
    const html = wrapper.find('.rewrite-result-card').html()
    expect(html.indexOf('result-textarea')).toBeLessThan(html.indexOf('btn-copy-result'))
    expect(btn.text()).toContain('复制')
  })

  it('点击复制把改写结果写入剪贴板，并切换按钮反馈态', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })
    try {
      const wrapper = await runRewrite()
      const btn = wrapper.find('[data-testid="btn-copy-result"]')
      await btn.trigger('click')
      await nextTick()
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(writeText).toHaveBeenCalledWith('这是改写后的文案内容，用于测试。')
      expect(wrapper.find('[data-testid="btn-copy-result"]').text()).toContain('已复制')
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, writable: true, configurable: true })
    }
  })

  it('复制失败时按钮保持「复制」态并复位（不回显已复制）', async () => {
    const writeText = vi.fn(async () => { throw new Error('NotAllowedError') })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })
    const originalExec = document.execCommand
    document.execCommand = vi.fn(() => false)
    try {
      const wrapper = await runRewrite()
      await wrapper.find('[data-testid="btn-copy-result"]').trigger('click')
      await nextTick()
      const btn = wrapper.find('[data-testid="btn-copy-result"]')
      expect(btn.text()).toContain('复制')
      expect(btn.text()).not.toContain('已复制')
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, writable: true, configurable: true })
      if (originalExec) document.execCommand = originalExec
      else delete document.execCommand
    }
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

  it('renders strategy section with manual mode by default and dropdown visible', async () => {
    const wrapper = factory()
    await nextTick()
    await nextTick()
    // 2026-09-15：默认改为「手动选择」——下拉直接展开，降低策略发现成本
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    expect(radios.length).toBe(2)
    expect(radios[1].element.checked).toBe(true)
    // 默认渲染策略下拉
    expect(wrapper.find('select.strategy-select').exists()).toBe(true)
  })

  it('shows auto preview after switching to auto mode', async () => {
    const wrapper = factory()
    await nextTick()
    await nextTick()
    // 切回自动模式后显示匹配预览
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    await radios[0].setValue('auto')
    await nextTick()
    await nextTick()
    expect(wrapper.find('.strategy-preview').exists()).toBe(true)
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
    // 默认 manual 不显示预览 → 切到 auto 验证
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    await radios[0].setValue('auto')
    await nextTick()
    await nextTick()
    await nextTick()
    const { aiGetRecommendedStrategies } = await import('@/api/publisher')
    expect(aiGetRecommendedStrategies).toHaveBeenCalled()
    expect(wrapper.find('.strategy-preview').text()).toContain('爆款故事化策略')
  })

  it('refreshes preview when platform changes', async () => {
    const wrapper = factory()
    // 默认 manual 不显示预览 → 切到 auto 验证
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    await radios[0].setValue('auto')
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
    // 默认 manual 不显示预览 → 切到 auto 验证
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    await radios[0].setValue('auto')
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
    // 默认 manual 不显示预览 → 切到 auto 验证竞态守卫
    const radios = wrapper.findAll('input[type="radio"][name="strategy-mode"]')
    await radios[0].setValue('auto')
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

// ── viral-rewrite-integration：标题参考 chip + 爆款潜力第 4 维展示 ──
describe('RewriteView viral integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
    mockRouterPush.mockClear()
  })

  it('titleHint query prefills removable chip', async () => {
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory()
    await nextTick()
    const chip = wrapper.find('[data-testid="rewrite-title-hint"]')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('AI工具推荐TOP5')
    await wrapper.find('[data-testid="rewrite-title-hint-remove"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="rewrite-title-hint"]').exists()).toBe(false)
  })

  it('startRewrite passes titleHint to aiRewrite', async () => {
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory()
    await nextTick()
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    expect(aiRewrite).toHaveBeenCalledWith(expect.objectContaining({ titleHint: 'AI工具推荐TOP5' }))
  })

  it('startRewrite omits titleHint when chip removed', async () => {
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory()
    await nextTick()
    await wrapper.find('[data-testid="rewrite-title-hint-remove"]').trigger('click')
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    const params = aiRewrite.mock.calls[0][0]
    expect(params.titleHint).toBeUndefined()
  })

  it('renders viral potential metric when engine returns viral field', async () => {
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockImplementationOnce(async () => ({
      code: 0,
      data: {
        success: true,
        result: '改写后的文案。',
        strategy: { id: 'auto', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 10, resultLength: 8, aiTasteLevel: 0.1 },
        quality: { sufficiency: 80, semanticPreservation: 60, originality: 70, simhashDistance: 7, verdict: 'pass', suggestions: [], method: 'simhash' },
        viral: { original: 62.5, rewritten: 78.3, delta: 15.8, mode: 'local-fallback' },
      },
    }))
    const wrapper = factory()
    await nextTick()
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const viralEl = wrapper.find('[data-testid="rewrite-viral-info"]')
    expect(viralEl.exists()).toBe(true)
    expect(viralEl.text()).toContain('62.5')
    expect(viralEl.text()).toContain('78.3')
    expect(viralEl.text()).toContain('15.8')
  })

  it('hides viral metric when engine returns no viral field (regression)', async () => {
    const wrapper = factory()
    await nextTick()
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="rewrite-viral-info"]').exists()).toBe(false)
  })
})

describe('RewriteView — 文案库交接带入（合并版文案库【改写】按钮）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
    sessionStorage.clear()
  })

  const HANDOFF = {
    content: '从文案库交接过来的正文内容，用于改写。',
    title: '采集标题',
    platform: 'douyin',
    sourceUrl: 'https://example.com/a',
    fromKey: 'collect:c1',
    fromTitle: '采集标题',
  }

  function seedHandoff (payload = HANDOFF) {
    sessionStorage.setItem('rewrite_handoff_v1', JSON.stringify(payload))
  }

  it('from=collection 时取交接载荷：仿写模式 + 自动开始 + 平台带入', async () => {
    mockRouteQuery.value = { from: 'collection' }
    seedHandoff()
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    const wrapper = factory()
    await nextTick()
    await nextTick()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    expect(textarea.element.value).toBe(HANDOFF.content)
    // 自动触发改写，且为仿写模式（交接语义=基于原文改写）
    expect(aiRewrite).toHaveBeenCalledTimes(1)
    const params = aiRewrite.mock.calls[0][0]
    expect(params.mode).toBe('imitate')
    expect(params.userSettings.platform).toBe('douyin')
    // 一次性语义：读后即焚
    expect(sessionStorage.getItem('rewrite_handoff_v1')).toBeNull()
  })

  it('改写成功后按 fromKey 回写文案库（同一来源只保留最新结果）', async () => {
    mockRouteQuery.value = { from: 'collection' }
    seedHandoff()
    const { aiRewrite, storeSetSetting, storeGetSetting } = await import('@/api/publisher')
    aiRewrite.mockClear()
    storeGetSetting.mockResolvedValue(null)
    storeSetSetting.mockClear()
    const wrapper = factory()
    await nextTick()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    const entry = storeSetSetting.mock.calls.find((c) => c[0] === 'copy_library_rewrites')
    expect(entry).toBeTruthy()
    const saved = JSON.parse(entry[1])
    expect(saved[0]).toMatchObject({ fromKey: 'collect:c1', fromTitle: '采集标题', title: '采集标题', platform: 'douyin', sourceUrl: 'https://example.com/a' })
    expect(saved[0].content).toContain('这是改写后的文案内容')
  })

  it('无交接载荷时不自动改写（直接访问 /rewrite?from=collection 不误触发）', async () => {
    mockRouteQuery.value = { from: 'collection' }
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    factory()
    await nextTick()
    await nextTick()
    expect(aiRewrite).not.toHaveBeenCalled()
  })

  it('topic 优先于交接载荷（两入口互斥）', async () => {
    mockRouteQuery.value = { topic: '这是一个足够长的热门选题标题超过二十个字用于测试自动改写触发场景', from: 'collection' }
    seedHandoff()
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    const wrapper = factory()
    await nextTick()
    await nextTick()
    expect(aiRewrite).toHaveBeenCalledTimes(1)
    expect(aiRewrite.mock.calls[0][0].mode).toBe('create')
    // 交接载荷未被消费，保留给后续真实入口
    expect(sessionStorage.getItem('rewrite_handoff_v1')).not.toBeNull()
  })
})

/**
 * 改写页视觉契约（2026-09-16 视觉优化）
 *
 * 与 src/styles/cohere-design-system.test.js 的「改写页列宽合同」配套：
 * 那里锁定全局 CSS 的宽度修复，这里锁定 RewriteView 自身的样式与结构，
 * 防止「勾选框被 flex 拉伸」「质量报告卡片套卡片」「设置区无分组」等问题回退。
 */
describe('RewriteView — 视觉契约', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/views/RewriteView.vue'), 'utf8')

  function ruleBody (selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = source.match(new RegExp(escaped + '\\s*\\{([^}]+)\\}'))
    return match?.[1] || ''
  }

  it('勾选框固定尺寸：阻止 flex 把它拉伸到整行宽而脱离文字', () => {
    const body = ruleBody('.config-switch input[type="checkbox"]')
    expect(body).toMatch(/flex:\s*0\s+0\s+auto/)
    expect(body).toMatch(/width:\s*16px/)
    expect(body).toMatch(/height:\s*16px/)
  })

  it('卡片回归静态容器语义：不显示手型光标、不随悬停浮起', () => {
    expect(source).toMatch(/cursor:\s*default/)
    expect(source).toMatch(/box-shadow:\s*none/)
  })

  it('质量评估用左侧强调条替代「卡片套卡片」', () => {
    const body = ruleBody('.rewrite-quality-report')
    expect(body).toMatch(/background:\s*transparent/)
    expect(body).toMatch(/border-left:\s*3px/)
  })

  it('卡片标题建立字号层级（全局 .cohere-section-title 原本无样式）', () => {
    const body = ruleBody('.cohere-section-title')
    expect(body).toMatch(/font-size:\s*15px/)
    expect(body).toMatch(/font-weight:\s*600/)
  })
})

describe('RewriteView — 设置区结构与布局契约', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
  })

  it('内容依据是两个并排开关，勾选框位于开关内部首位（左置）', () => {
    const wrapper = factory()
    const switches = wrapper.findAll('.config-switch')
    expect(switches.length).toBe(2)
    for (const sw of switches) {
      expect(sw.element.firstElementChild.tagName).toBe('INPUT')
      expect(sw.element.firstElementChild.getAttribute('type')).toBe('checkbox')
    }
  })

  it('勾选态以 is-on 表达（未勾选为白底灰边，可被视觉与测试识别）', async () => {
    const wrapper = factory()
    const switches = wrapper.findAll('.config-switch')
    expect(switches.length).toBe(2)
    // 结合爆款库默认勾选 → 带 is-on；结合个人经历默认未勾选 → 不带
    expect(switches[0].classes()).toContain('is-on')
    expect(switches[1].classes()).not.toContain('is-on')
    // 勾选第二个 → is-on 跟随状态（勾选态是纯视觉信号，必须与真实状态同步）
    await switches[1].find('input[type="checkbox"]').setValue(true)
    await nextTick()
    expect(wrapper.findAll('.config-switch')[1].classes()).toContain('is-on')
  })

  it('短字段并排：字数控制与目标平台同处一个两列容器', () => {
    const wrapper = factory()
    const grid = wrapper.find('.config-grid')
    expect(grid.exists()).toBe(true)
    expect(grid.findAll('.config-row').length).toBe(2)
  })

  it('执行区分段：改写按钮位于带分隔线的提交区', () => {
    const wrapper = factory()
    const submit = wrapper.find('.rewrite-submit')
    expect(submit.exists()).toBe(true)
    expect(submit.find('.rewrite-start-btn').exists()).toBe(true)
  })

  it('质量报告带结论强调条 class（pass/warn/fail）', async () => {
    // 显式提供带 quality 的返回：本用例不依赖前序用例遗留的 mock 实现
    // （vi.clearAllMocks 只清调用记录、不清 mockResolvedValue 设定的实现）
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '这是改写后的文案内容，用于测试。',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: {
          sufficiency: 78.5,
          semanticPreservation: 65.2,
          originality: 82.1,
          verdict: 'pass',
          suggestions: ['改写质量良好'],
          method: 'simhash',
        },
      },
    })
    const wrapper = factory()
    await wrapper.find('textarea.rewrite-textarea').setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    const report = wrapper.find('[data-testid="rewrite-quality-report"]')
    expect(report.exists()).toBe(true)
    expect(report.classes()).toContain('quality-accent-pass')
  })
})
