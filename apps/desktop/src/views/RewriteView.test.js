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
      // 改写结果标题（2026-09-18）：引擎提炼 ≤20 字标题
      title: '这是改写后的标题',
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
vi.mock('@element-plus/icons-vue', () => {
  const __icon = { template: "<span />" }; const __guard = ["__esModule", "then", "catch", "default", "Symbol(Symbol.toStringTag)"]; return new Proxy({}, { has: () => true, get: (t, p) => (typeof p === "string" && !__guard.includes(p) ? __icon : undefined) });
})

// 文本出期入口（PRD §7.10.3.4 ②-b②）的三条依赖。频道必须能从用例里拨值：
// 真实 usePodcastChannel 会去拉全量频道列表，而这里要锁的是「有没有默认频道」这一渲染条件的两个分支。
const podcastApi = vi.hoisted(() => ({
  episodePlanPreview: vi.fn(),
  episodePublishFromScript: vi.fn(),
  onEpisodePublishProgress: vi.fn(),
}))
vi.mock('@/api/podcast-channel', async (importOriginal) => Object.assign({}, await importOriginal(), podcastApi))

const suspension = vi.hoisted(() => ({ suspend: vi.fn(), release: vi.fn() }))
vi.mock('@/composables/useEmbeddedViewSuspension', () => ({
  suspendEmbeddedViewsForOverlay: suspension.suspend,
  releaseEmbeddedViewsForOverlay: suspension.release,
}))

const channelState = vi.hoisted(() => ({}))
vi.mock('@/composables/usePodcastChannel', async (importOriginal) => {
  const { ref } = await import('vue')
  const original = await importOriginal()
  const activeChannelId = ref('')
  const ensureChannel = vi.fn(async () => {
    activeChannelId.value = 'ch_from_ensure'
    return activeChannelId.value
  })
  channelState.activeChannelId = activeChannelId
  channelState.ensureChannel = ensureChannel
  return { ...original, usePodcastChannel: () => ({ activeChannelId, ensureChannel }) }
})

import RewriteView from './RewriteView.vue'
import PodcastScriptEntry from '@/components/PodcastScriptEntry.vue'

function factory(pinia) {
  setActivePinia(pinia || createPinia())
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

  // CCG 深度审查 i3：预览必须响应 content 变化（带 300ms 防抖，二轮 i3）。
  // 缺陷形态：启发式兜底依赖原文形态，只监听设置项 ⇒ 「粘贴长文但没动下拉」时
  // 预览名不刷新，而实际改写会用新 content 重新匹配 ⇒ 预览与实际命中策略漂移。
  // 防抖后：连续键入合并到停顿 300ms 后一次请求，避免逐键高频触发（二轮 i3）。
  it('i3：粘贴长文后预览请求刷新并携带 content（300ms 防抖）', async () => {
    vi.useFakeTimers()
    try {
      const { aiGetRecommendedStrategies } = await import('@/api/publisher')
      aiGetRecommendedStrategies.mockClear()
      const wrapper = factory()
      await nextTick()
      const before = aiGetRecommendedStrategies.mock.calls.length
      const input = wrapper.find('textarea.rewrite-textarea')
      // 模拟连续键入：三次 setValue 只应触发一次防抖后的请求
      await input.setValue('第一段输入。')
      await input.setValue('第一段输入。第二段。')
      await input.setValue('这是一段足够长的成稿内容。' + '补充说明。'.repeat(200))
      await vi.advanceTimersByTimeAsync(300)
      await nextTick()
      await nextTick()
      const after = aiGetRecommendedStrategies.mock.calls.length
      expect(after).toBeGreaterThan(before)
      const last = aiGetRecommendedStrategies.mock.calls[after - 1]
      // 第二参必须是原文；否则预览与 startRewrite 的匹配口径不一致
      expect(typeof last[1]).toBe('string')
      expect(last[1].length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // P1-1 回归锁（rewrite-default-strategy-fix）：改写页必须把 industry/purpose/tone
  // 真实下发给引擎。此前完全不下发 ⇒ 匹配器只能拿到空输入 ⇒ 全体并列退化为数组首项。
  it('P1-1：改写请求携带 industry/purpose/tone（此前完全不下发）', async () => {
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    const wrapper = factory()
    await nextTick()
    const input = wrapper.find('textarea.rewrite-textarea')
    await input.setValue('这是一段测试文案。用于验证三个维度是否下发。')
    const selects = wrapper.findAll('select.config-select')
    // 平台 + 行业 + 目的 + 语气 共四个下拉（平台为既有，后三个为本次新增）
    expect(selects.length).toBe(4)
    await selects[1].setValue('technology')
    await selects[2].setValue('authority-building')
    await selects[3].setValue('formal')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    expect(aiRewrite).toHaveBeenCalled()
    const us = aiRewrite.mock.calls[0][0].userSettings
    expect(us.industry).toBe('technology')
    expect(us.purpose).toBe('authority-building')
    expect(us.tone).toBe('formal')
  })

  it('P1-1：未选择时三个维度不下发 undefined 以外的值（不得猜测用户行业）', async () => {
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    const wrapper = factory()
    await nextTick()
    const input = wrapper.find('textarea.rewrite-textarea')
    await input.setValue('这是一段测试文案。用于验证默认值。')
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    expect(aiRewrite).toHaveBeenCalled()
    const us = aiRewrite.mock.calls[0][0].userSettings
    // 空串语义 = 未指定，必须落成 undefined，绝不能凭空猜一个行业
    expect(us.industry).toBeUndefined()
    expect(us.purpose).toBeUndefined()
    expect(us.tone).toBeUndefined()
  })

  // R3 回归锁（rewrite-default-strategy-fix）：长文成稿改写前把上限抬高，
  // 不再用 800-2000 硬截（5000 字原文会被压掉 60%）。
  it('R3：长文成稿改写时字数上限按原文长度自适应（不再硬截到 2000）', async () => {
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    const wrapper = factory()
    const input = wrapper.find('textarea.rewrite-textarea')
    await input.setValue('这是一段长文成稿。' + '内容填充。'.repeat(700))
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    expect(aiRewrite).toHaveBeenCalled()
    const range = aiRewrite.mock.calls[0][0].userSettings.wordCountRange
    expect(range.max).toBeGreaterThan(2000)
    expect(range.max).toBeLessThanOrEqual(6000)
    expect(range.min).toBeLessThanOrEqual(range.max)
  })

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
    // rewrite-limits-50000：合法上界改为 50000；7000 已合法，越界值改用 50001
    await inputs[1].setValue(50001)
    await nextTick()
    expect(wrapper.text()).toContain('最大字数需为 1-50000 的整数')
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
  // rewrite-default-strategy-fix：默认模式不再写死 create，改为按输入形态推导；
  // 本用例改为显式切到 create 验证文案口径（默认路径的行为由下方 imitate 用例覆盖）。
  it('选题创作模式下字数概览用「主题」（显式切到 create）', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '这是改写后的文案内容，用于测试。',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [], sensitiveHits: [], knowledgeRefs: [],
        metadata: { mode: 'create', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: { sufficiency: 78.5, semanticPreservation: 65.2, originality: 82.1, verdict: 'pass', suggestions: ['好'], method: 'simhash' },
      },
    })
    const wrapper = await runRewrite('create')
    const meta = wrapper.find('.rewrite-result-meta')
    expect(meta.text()).toContain('主题 30 字 → 结果 18 字')
    expect(meta.text()).not.toContain('原文')
    expect(meta.text()).not.toMatch(/\{[^{}]+\}/)
  })

  // R2 回归锁（rewrite-default-strategy-fix）：成稿默认必须走 imitate。
  // 缺陷形态：默认 create 授权模型「重新创作」，实测把 5000 字深度报道改成 800 字带货腔。
  // R2 回归锁（rewrite-default-strategy-fix）：成稿默认必须走 imitate。
  // 缺陷形态：默认 create 授权模型「重新创作」，实测把 5000 字深度报道改成 800 字带货腔。
  // 输入用真实成稿形态（多句多段、远超灰色带），而非 runRewrite 的通用短句测试文案
  // —— i5 判据收紧后，20 余字的单句测试文案按「选题种子」处理，走 create 才是正确行为。
  it('R2：成稿输入默认走 imitate（不再写死 create）', async () => {
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockClear()
    const wrapper = factory()
    await nextTick()
    const draft = [
      '上周AI圈都在讨论一件事，但大多数人只看到了一半。',
      '7月15日，前OpenAI CTO在旧金山发布了新模型，20亿美元融资，975B参数。',
      '强化学习之父也宣布创办新实验室，认为当前方法需要从根基上重新来过。',
      'SWE-bench Verified 评测中，新模型以 85.6 分登顶第一。',
      '这套架构有个正式名字：不同能力在共享基座之上独立训练、灵活组合。',
    ].join('\n')
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue(draft)
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    expect(aiRewrite).toHaveBeenCalled()
    expect(aiRewrite.mock.calls[0][0].mode).toBe('imitate')
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

// ── 自动改写入口完成后直接定位改写结果区（2026-10-09，PRD-REWRITE-AUTO-JUMP-RESULT）──
// 判定规则：topic 带入 / from=collection 交接属「自动改写入口」→ 改写成功后视口定位到
// .rewrite-result-card；手动开始 / titleHint 预填 / 改写失败不滚动。
// 反证：删掉 startRewrite 成功分支的 focusRewriteResult 调用 → 前两条必须红；
// 删掉 autoFocusResult 条件（无条件滚动）→ 后三条必须红。
describe('RewriteView — 自动改写入口完成后定位结果区', () => {
  let scrollSpy

  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
    sessionStorage.clear()
    scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy
  })

  /** 刷完自动改写整条 promise 链（onMounted → startRewrite → ensureLogin → aiRewrite → 赋值 → nextTick 滚动） */
  async function flushRewrite (wrapper) {
    await nextTick()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    return wrapper
  }

  it('topic 带入 + 改写成功 → scrollIntoView 定位到改写结果卡片（smooth/start）', async () => {
    mockRouteQuery.value = { topic: '这是一个足够长的热门选题标题超过二十个字用于测试自动改写触发场景' }
    const wrapper = factory()
    await flushRewrite(wrapper)
    const card = wrapper.find('.rewrite-result-card')
    expect(card.exists()).toBe(true)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    // 滚动目标必须是结果卡片本身（mock.instances[0] = scrollIntoView 的 this）
    expect(scrollSpy.mock.instances[0]).toBe(card.element)
  })

  it('from=collection 交接 + 改写成功 → 同样定位到改写结果卡片', async () => {
    mockRouteQuery.value = { from: 'collection' }
    sessionStorage.setItem('rewrite_handoff_v1', JSON.stringify({
      content: '从文案库交接过来的正文内容，用于改写。',
      title: '采集标题',
      platform: 'douyin',
      sourceUrl: 'https://example.com/a',
      fromKey: 'collect:c1',
      fromTitle: '采集标题',
    }))
    const wrapper = factory()
    await flushRewrite(wrapper)
    const card = wrapper.find('.rewrite-result-card')
    expect(card.exists()).toBe(true)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy.mock.instances[0]).toBe(card.element)
  })

  it('无 query 手动改写成功 → 不滚动（用户本就在看着页面）', async () => {
    const wrapper = factory()
    await nextTick()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的手动输入文案内容，用于验证手动改写不触发自动滚动。')
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await flushRewrite(wrapper)
    expect(wrapper.find('.rewrite-result-card').exists()).toBe(true)
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('titleHint 预填入口手动改写成功 → 不滚动（非自动改写入口）', async () => {
    mockRouteQuery.value = { titleHint: '爆款参考标题' }
    const wrapper = factory()
    await nextTick()
    const textarea = wrapper.find('textarea.rewrite-textarea')
    await textarea.setValue('这是一段足够长的手动输入文案内容，用于验证 titleHint 入口不自动滚动。')
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await flushRewrite(wrapper)
    expect(wrapper.find('.rewrite-result-card').exists()).toBe(true)
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('topic 带入但改写失败 → 不滚动（错误横幅在首屏可见，结果卡片不渲染）', async () => {
    mockRouteQuery.value = { topic: '这是一个足够长的热门选题标题超过二十个字用于测试自动改写触发场景' }
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockResolvedValueOnce({ code: 0, data: { error: '引擎错误：改写失败' } })
    const wrapper = factory()
    await flushRewrite(wrapper)
    expect(wrapper.find('.rewrite-result-card').exists()).toBe(false)
    expect(scrollSpy).not.toHaveBeenCalled()
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
    // rewrite-default-strategy-fix(i3)：content 进预览 watch 但走 300ms 防抖——
    // 键入产生的预览请求被合并推迟，本次同步触发的 click→finally 路径里
    // 防抖 timer 尚未到期 ⇒ 实际发出的只有「挂载 + finally」两次。
    // （防抖请求本身由 i3 专项用例用 fake timers 单独覆盖。）
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

// ── P1-E：爆款信号注入（viralAngles/viralKeywords 软约束）──
describe('RewriteView viral signal (P1-E)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
    mockRouterPush.mockClear()
  })

  it('startRewrite 携带 store 中的爆款信号（titleHint 带入时快照）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useViralSignalStore } = await import('@/stores/viral-signal')
    useViralSignalStore().setSignal({ topic: 'AI 工具', angles: ['深度解析'], keywords: ['AI 效率'] })
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory(pinia)
    await nextTick()
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    expect(aiRewrite).toHaveBeenCalledWith(expect.objectContaining({
      titleHint: 'AI工具推荐TOP5',
      viralAngles: ['深度解析'],
      viralKeywords: ['AI 效率'],
    }))
  })

  it('P1-E 评审 W-1：移除 chip 同时清空信号，params 不再携带', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useViralSignalStore } = await import('@/stores/viral-signal')
    useViralSignalStore().setSignal({ topic: 'AI 工具', angles: ['深度解析'], keywords: ['AI 效率'] })
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory(pinia)
    await nextTick()
    await wrapper.find('[data-testid="rewrite-title-hint-remove"]').trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="rewrite-title-hint"]').exists()).toBe(false)
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    const params = aiRewrite.mock.calls[0][0]
    expect(params.titleHint).toBeUndefined()
    expect(params.viralAngles).toBeUndefined()
    expect(params.viralKeywords).toBeUndefined()
  })

  it('无信号时 params 不携带 viralAngles/viralKeywords（回归）', async () => {
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory()
    await nextTick()
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    const params = aiRewrite.mock.calls[0][0]
    expect(params.viralAngles).toBeUndefined()
    expect(params.viralKeywords).toBeUndefined()
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
  // 样式已外置到 src/views/rewrite-view.css（rewrite-view-decompose，2026-10-21）。
  // 变的是**读取对象**，不是**被锁的契约**：下面 4 条视觉契约一条不减。
  // 为什么必须改：外置前样式在 .vue 里，读 .vue 拿得到规则体；外置后 .vue 里
  // 只有一个 <style scoped src="...">，规则体在 CSS 文件里 —— 不改读取对象，
  // `ruleBody()` 会返回空串，4 条用例变成**恒真的假锁**（match 失败 ⇒ 断言红，
  // 但红的原因是路径漂移而不是视觉回退，会把真问题淹没）。
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/views/rewrite-view.css'), 'utf8')
  // 反向锁：CSS 文件不能变成孤儿（文件在、但视图不引它 ⇒ 页面裸奔，
  // 而上面 4 条只读 CSS 的锁会一直绿 —— 所以这条必须单独存在）。
  const viewSource = fs.readFileSync(path.resolve(process.cwd(), 'src/views/RewriteView.vue'), 'utf8')

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
    expect(body).toMatch(/font-size:\s*var\(--font-size-base\)/)
    expect(body).toMatch(/font-weight:\s*600/)
  })

  it('视图必须仍然引用该 CSS 文件（防样式文件变成孤儿：文件在、但页面不引它）', () => {
    expect(viewSource).toMatch(/<style scoped src="\.\/rewrite-view\.css"><\/style>/)
    // 反向：视图里**只允许**那一个 <style> 标签（CC 外部评审 i5：原先用
    // `not.toMatch(/<style scoped>\s*\n/)` 判断「没有内联 scoped 样式」，
    // 判据是「某个具体写法不存在」—— 一旦换个写法（`<style scoped >`、
    // 换行位置不同）就会漏判。改成「<style> 标签恰好一个，且就是那一个」，
    // 与写法无关，且顺带挡住「两份真相」）。
    const styleTags = viewSource.match(/<style\b[^>]*>/g) || []
    expect(styleTags).toHaveLength(1)
    expect(styleTags[0]).toBe('<style scoped src="./rewrite-view.css">')
  })
})

describe('RewriteView — 设置区结构与布局契约', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
  })

  // 局部 helper：执行一次改写并返回 wrapper（本 describe 独立定义，不依赖外层 runRewrite）
  async function runRewrite() {
    // vi.clearAllMocks 会清掉 aiRewrite 的默认实现（mockReset 语义），
    // 因此用 mockResolvedValue 设置默认实现（各用例可用 mockResolvedValueOnce 覆盖）
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockResolvedValue({
      code: 0,
      data: {
        success: true,
        result: '这是改写后的文案内容，用于测试。',
        title: '这是改写后的标题',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: null,
      },
    })
    const wrapper = factory()
    await wrapper.find('textarea.rewrite-textarea').setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    return wrapper
  }

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

  // ── 改写结果标题 + 复制按钮移位 + 文案库回写（2026-09-18）──

  it('改写成功后展示结果标题（纯文字，非输入框）', async () => {
    // 显式提供带 title 的返回，避免依赖默认 mock（vi.clearAllMocks 不清实现但显式更稳）
    const { aiRewrite } = await import('@/api/publisher')
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '这是改写后的文案内容，用于测试。',
        title: '这是改写后的标题',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: null,
      },
    })
    const wrapper = await runRewrite()
    const title = wrapper.find('[data-testid="rewrite-result-title"]')
    expect(title.exists()).toBe(true)
    expect(title.text()).toContain('标题')
    expect(title.text()).toContain('这是改写后的标题')
    // 标题是纯文字展示，不是输入框
    expect(title.find('input').exists()).toBe(false)
    expect(title.find('textarea').exists()).toBe(false)
  })

  it('引擎未返回标题时不展示标题行', async () => {
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
        quality: null,
      },
    })
    const wrapper = factory()
    await wrapper.find('textarea.rewrite-textarea').setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    expect(wrapper.find('[data-testid="rewrite-result-title"]').exists()).toBe(false)
  })

  it('复制按钮与存入草稿/视频创作在同一动作行（最左侧）', async () => {
    const wrapper = await runRewrite()
    const actions = wrapper.find('.rewrite-result-actions')
    expect(actions.exists()).toBe(true)
    // 复制按钮在动作行内
    expect(actions.find('[data-testid="btn-copy-result"]').exists()).toBe(true)
    expect(actions.find('[data-testid="btn-video-create"]').exists()).toBe(true)
    // 复制按钮是动作行第一个按钮（最左侧）
    const html = actions.html()
    const copyIdx = html.indexOf('btn-copy-result')
    const draftIdx = html.indexOf('存入草稿')
    const videoIdx = html.indexOf('btn-video-create')
    expect(copyIdx).toBeGreaterThan(-1)
    expect(copyIdx).toBeLessThan(draftIdx)
    expect(copyIdx).toBeLessThan(videoIdx)
  })

  it('存入草稿携带改写结果标题', async () => {
    const { draftSave } = await import('@/api/publisher')
    draftSave.mockClear()
    const wrapper = await runRewrite()
    // 复制按钮已移到动作行最左侧；存入草稿按钮按文本定位
    const saveBtn = wrapper.findAll('.rewrite-result-actions button').find((b) => b.text().includes('存入草稿'))
    await saveBtn.trigger('click')
    await nextTick()
    expect(draftSave).toHaveBeenCalledTimes(1)
    const saved = draftSave.mock.calls[0][0]
    expect(saved.title).toBe('这是改写后的标题')
    expect(saved.content).toContain('这是改写后的文案内容')
  })

  it('改写成功后写入文案库（storeSetSetting 携带改写记录）', async () => {
    const { storeSetSetting } = await import('@/api/publisher')
    storeSetSetting.mockClear()
    const wrapper = await runRewrite()
    await nextTick()
    // syncResultToLibrary 异步执行，等待微任务
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(storeSetSetting).toHaveBeenCalled()
    const key = storeSetSetting.mock.calls.find((c) => c[0] === 'copy_library_rewrites')
    expect(key).toBeTruthy()
    const records = JSON.parse(key[1])
    expect(records.length).toBeGreaterThan(0)
    expect(records[0].title).toBe('这是改写后的标题')
    expect(records[0].content).toContain('这是改写后的文案内容')
  })
})
// ── P2-a：爆款强度定量信号 engagement 透传 + sessionStorage 中转读后即焚 ──
describe('RewriteView viral strength (P2-a)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
    mockRouterPush.mockClear()
    try { sessionStorage.clear() } catch {}
  })

  it('store 快照含 engagement → startRewrite 透传到引擎', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useViralSignalStore } = await import('@/stores/viral-signal')
    useViralSignalStore().setSignal({ topic: 'T', angles: ['A'], keywords: ['K'], engagement: { sampleCount: 5, avgLikes: 900, avgComments: 30 } })
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory(pinia)
    await nextTick()
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    const params = aiRewrite.mock.calls[0][0]
    expect(params.engagement).toEqual({ sampleCount: 5, avgLikes: 900, avgComments: 30 })
  })

  it('sessionStorage 中转快照优先于 store，读后清除（AC-P2-2）', async () => {
    const { setViralSignalHandoff } = await import('@/utils/viral-signal-bridge')
    setViralSignalHandoff({ topic: 'T', angles: ['角度H'], keywords: ['词H'], engagement: { sampleCount: 8, avgLikes: 1200, avgComments: 50 } })
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useViralSignalStore } = await import('@/stores/viral-signal')
    useViralSignalStore().setSignal({ topic: 'T', angles: ['旧角度'], keywords: [], engagement: null })
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory(pinia)
    await nextTick()
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    const params = aiRewrite.mock.calls[0][0]
    expect(params.viralAngles).toEqual(['角度H'])
    expect(params.engagement).toEqual({ sampleCount: 8, avgLikes: 1200, avgComments: 50 })
    // 读后即焚：二次挂载不再残留
    const { takeViralSignalHandoff } = await import('@/utils/viral-signal-bridge')
    expect(takeViralSignalHandoff()).toBeNull()
  })

  it('无 engagement 信号 → params 不携带 engagement（回归）', async () => {
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory()
    await nextTick()
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    const params = aiRewrite.mock.calls[0][0]
    expect(params.engagement).toBeUndefined()
  })
  it('弱信号 sampleCount<3 → 强度徽标不显示且 params 不携带 engagement（与引擎门槛一致，BUGFIX-STRENGTH-BADGE-GATE）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useViralSignalStore } = await import('@/stores/viral-signal')
    useViralSignalStore().setSignal({ topic: 'T', angles: ['A'], keywords: ['K'], engagement: { sampleCount: 1, avgLikes: 100, avgComments: 10 } })
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory(pinia)
    await nextTick()
    expect(wrapper.find('[data-testid="rewrite-strength-badge"]').exists()).toBe(false)
    await wrapper.find('textarea.rewrite-textarea').setValue('需要改写的原始文案内容')
    await wrapper.find('button.rewrite-start-btn').trigger('click')
    await nextTick()
    const { aiRewrite } = await import('@/api/publisher')
    const params = aiRewrite.mock.calls[0][0]
    expect(params.engagement).toBeUndefined()
  })
  it('达标信号 sampleCount>=3 → 强度徽标显示且 params 携带 engagement（正例配对）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useViralSignalStore } = await import('@/stores/viral-signal')
    useViralSignalStore().setSignal({ topic: 'T', angles: ['A'], keywords: ['K'], engagement: { sampleCount: 3, avgLikes: 900, avgComments: 30 } })
    mockRouteQuery.value = { titleHint: 'AI工具推荐TOP5' }
    const wrapper = factory(pinia)
    await nextTick()
    expect(wrapper.find('[data-testid="rewrite-strength-badge"]').exists()).toBe(true)
  })
})

/**
 * 归因链：改写页是这条链的**起点**（PRD-PUBLISH-REWRITE-LINEAGE-2026-10-05）。
 *
 * 断链的原始形态就是这里：主进程把 rewriteHistoryId 放进信封返回，
 * 而本组件读完 result/title/knowledgeRefs/quality/viral 之后从没读过它 ——
 * 于是草稿没有关联、发布没有关联、归因榜永远恒空，且全程没有任何报错。
 * 判据一律打在 draftSave 的**入参**上（断言"具体通道与被写对象"，不断言返回码）。
 */
describe('RewriteView — 归因链：rewriteHistoryId 随草稿落盘', () => {
  const LONG_INPUT = '这是一段足够长的测试文案内容，超过二十个字，测试改写功能。'

  const rewriteEnvelope = (over = {}) => ({
    code: 0,
    data: {
      success: true,
      result: '改写后的正文',
      strategy: { id: 's1', name: '测试策略' },
      warnings: [], sensitiveHits: [], knowledgeRefs: [],
      metadata: { mode: 'imitate', originalLength: 30, resultLength: 6 },
      ...over,
    },
  })

  async function rewriteThenSaveDraft (wrapper, mocks) {
    await wrapper.find('textarea.rewrite-textarea').setValue(LONG_INPUT)
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    mocks.draftSave.mockClear()
    const btn = wrapper.findAll('button').find(b => b.text().includes('存入草稿'))
    expect(btn, '找不到【存入草稿】按钮，测试锚点失效').toBeTruthy()
    await btn.trigger('click')
    await nextTick()
    await nextTick()
  }

  it('改写返回带 id ⇒ 草稿快照携带同一个 id', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce(rewriteEnvelope({ rewriteHistoryId: 'mdAAAA1111' }))
    const wrapper = factory()
    await rewriteThenSaveDraft(wrapper, mocks)
    expect(mocks.draftSave).toHaveBeenCalledTimes(1)
    expect(mocks.draftSave.mock.calls[0][0].rewriteHistoryId).toBe('mdAAAA1111')
  })

  it('第二次改写返回新的 id ⇒ 草稿带第二个，第一个不得残留', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce(rewriteEnvelope({ rewriteHistoryId: 'mdFIRST00001' }))
    const wrapper = factory()
    await rewriteThenSaveDraft(wrapper, mocks)
    expect(mocks.draftSave.mock.calls[0][0].rewriteHistoryId).toBe('mdFIRST00001')

    mocks.aiRewrite.mockResolvedValueOnce(rewriteEnvelope({ result: '第二次改写正文', rewriteHistoryId: 'mdSECOND0002' }))
    await rewriteThenSaveDraft(wrapper, mocks)
    const last = mocks.draftSave.mock.calls[mocks.draftSave.mock.calls.length - 1][0]
    expect(last.rewriteHistoryId).toBe('mdSECOND0002')
  })

  it('第二次改写没给 id（未落库）⇒ 键消失，绝不把上一次的 id 发给这一次的内容', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce(rewriteEnvelope({ rewriteHistoryId: 'mdSTALE99999' }))
    const wrapper = factory()
    await rewriteThenSaveDraft(wrapper, mocks)

    mocks.aiRewrite.mockResolvedValueOnce(rewriteEnvelope({ result: '无关联的第二次改写' }))
    await rewriteThenSaveDraft(wrapper, mocks)
    const last = mocks.draftSave.mock.calls[mocks.draftSave.mock.calls.length - 1][0]
    expect(Object.prototype.hasOwnProperty.call(last, 'rewriteHistoryId'),
      '假关联比没关联更糟：归因榜会出现一个看着合理但属于别人的数字').toBe(false)
  })

  it('脏 id（空串/空白/超长）⇒ 不挂键（判据在 utils/rewrite-lineage，此处只验接线）', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce(rewriteEnvelope({ rewriteHistoryId: '   ' }))
    const wrapper = factory()
    await rewriteThenSaveDraft(wrapper, mocks)
    const snapshot = mocks.draftSave.mock.calls[0][0]
    expect(Object.prototype.hasOwnProperty.call(snapshot, 'rewriteHistoryId')).toBe(false)
  })

  // QM-6 后端轴 W-1：原位编辑与"再改写一次"是两条不同的失效路径。
  // 上一条量的是新改写替换旧 id；这条量的是**没有新改写**、只有用户手改正文 ——
  // 此时 rewrite_history 行里存的已经不是屏幕上这份内容，继续挂旧 id 就是假归因。
  it('改写后用户手改结果正文 ⇒ 关联必须失效，不得把旧 id 挂到新文案上', async () => {
    const mocks = await import('@/api/publisher')
    mocks.aiRewrite.mockResolvedValueOnce(rewriteEnvelope({ rewriteHistoryId: 'mdEDIT000001' }))
    const wrapper = factory()
    await rewriteThenSaveDraft(wrapper, mocks)
    expect(mocks.draftSave.mock.calls[0][0].rewriteHistoryId).toBe('mdEDIT000001')

    // 再编辑结果 textarea（v-model=rewriteResult，:219）→ watch(rewriteResult) 触发失效
    await wrapper.find('textarea.result-textarea').setValue('改完又不满意，手动重写了这一段正文')
    await nextTick()
    mocks.draftSave.mockClear()
    const btn = wrapper.findAll('button').find(b => b.text().includes('存入草稿'))
    await btn.trigger('click')
    await nextTick()
    await nextTick()

    const snapshot = mocks.draftSave.mock.calls[0][0]
    expect(snapshot.content).toContain('手动重写了这一段')
    expect(Object.prototype.hasOwnProperty.call(snapshot, 'rewriteHistoryId'),
      '手改后的正文携带上一次改写的 id ⇒ 归因榜把新文案的表现算给旧的爆款引用组合').toBe(false)
  })
})

// ── 文本出期入口（PRD §7.10.3.4 ②-b②，验收判据 1 / 2 / 4）────────────────
// 本文件前面一百多条用例没有一条引用过 activeChannelId / PodcastScriptEntry，
// 所以这一段入口代码整块坏掉也不会变红 —— 下面四条锁的就是这件事。
describe('RewriteView — 文本出期入口的合同（§7.10.3.4 ②-b②）', () => {
  const PLAN_OK = { ok: true, plan: { totalBlocks: 7, totalCodepoints: 12345 }, voice: { providerId: 'prov_x', model: 'mdl_y', voiceId: 'voice_z', origin: 'preference', resolvedBy: 'capability' } }
  const avail = (result) => ({ available: true, result })
  const SENTINEL = '哨兵正文' + '补'.repeat(90)

  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteQuery.value = {}
    channelState.activeChannelId.value = ''
    podcastApi.episodePlanPreview.mockResolvedValue(avail(PLAN_OK))
  })

  /** 跑一次改写到「结果区已有正文」为止（结果卡片是 v-if，必须先有正文才谈得上入口） */
  async function rewriteOnce () {
    const wrapper = factory()
    await wrapper.find('textarea.rewrite-textarea').setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
    await nextTick()
    await wrapper.find('.rewrite-start-btn').trigger('click')
    await nextTick()
    await nextTick()
    return wrapper
  }

  async function openOverlay (wrapper) {
    await wrapper.find('[data-testid="btn-podcast-script-entry"]').trigger('click')
    await nextTick()
    await Promise.resolve()
    await nextTick()
  }

  it('有默认频道且有正文：动作出现，预览带的就是这一页当时那份正文（含哨兵串）', async () => {
    channelState.activeChannelId.value = 'ch_a'
    const wrapper = await rewriteOnce()
    await wrapper.find('textarea.result-textarea').setValue(SENTINEL)
    await nextTick()

    expect(wrapper.find('[data-testid="btn-podcast-script-entry"]').exists()).toBe(true)
    await openOverlay(wrapper)

    expect(wrapper.findComponent(PodcastScriptEntry).exists()).toBe(true)
    const call = podcastApi.episodePlanPreview.mock.calls[0]
    expect(call, '预览没被调用 ⇒ 浮层根本没挂载，这条正控不能省').toBeTruthy()
    expect(call[0]).toMatchObject({ channelId: 'ch_a', script: SENTINEL })
  })

  // §7.10.3.4 验收判据 4 的完整落点：入口侧的「这一页当时那份正文」不能只停在预览入参上，
  // 必须一路带到真正出期的载荷里（billingConfirmed 由浮层的确认动作置真，runId 由浮层生成）。
  it('从这枚入口点确认：出期载荷的 copy.content 逐字等于当时那份正文，且 billingConfirmed 为真', async () => {
    channelState.activeChannelId.value = 'ch_a'
    podcastApi.episodePublishFromScript.mockResolvedValue(avail({ state: 'success', feedUrl: 'https://example.com/feed.xml' }))
    podcastApi.onEpisodePublishProgress.mockReturnValue(avail(() => {}))
    const wrapper = await rewriteOnce()
    await wrapper.find('textarea.result-textarea').setValue(SENTINEL)
    await nextTick()
    await openOverlay(wrapper)

    await wrapper.find('[data-testid="podcast-script-confirm"]').trigger('click')
    await nextTick()
    await Promise.resolve()
    await nextTick()

    const sent = podcastApi.episodePublishFromScript.mock.calls[0]
    expect(sent, '确认按钮没把出期请求发出去 ⇒ 这条链是断的').toBeTruthy()
    const payload = sent[0]
    expect(payload.channelId).toBe('ch_a')
    expect(payload.copy.content).toBe(SENTINEL)
    expect(payload.billingConfirmed, 'billingConfirmed 只能是用户按了确认的产物').toBe(true)
    expect(payload.runId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    // 脱壳：传给 IPC 的必须是 plain object（reactive 包装会让结构化克隆抛 "could not be cloned"）
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype)
  })

  it('入口标题与「存入草稿」共用同一个提取点（不得各写一份拼装）', async () => {
    channelState.activeChannelId.value = 'ch_a'
    const wrapper = await rewriteOnce()
    const { draftSave } = await import('@/api/publisher')
    draftSave.mockClear()
    const saveBtn = wrapper.findAll('.rewrite-result-actions button').find((b) => b.text().includes('存入草稿'))
    await saveBtn.trigger('click')
    await nextTick()
    await nextTick()
    const draftTitle = draftSave.mock.calls[0][0].title
    // 正控：提取点若退化成空串，下面那句「两边相等」就成了 vacuous 相等
    expect(draftTitle).toBe('这是改写后的标题')

    await openOverlay(wrapper)
    expect(wrapper.findComponent(PodcastScriptEntry).props('title')).toBe(draftTitle)
  })

  it('无默认频道：动作根本不出现（不是 disabled、不是点了才报）', async () => {
    channelState.activeChannelId.value = ''
    const wrapper = await rewriteOnce()
    expect(wrapper.find('[data-testid="btn-podcast-script-entry"]').exists()).toBe(false)
    // 反向正控：同一动作行里别的按钮在位 ⇒ 「不出现」不是整行没渲染
    expect(wrapper.find('[data-testid="btn-video-create"]').exists()).toBe(true)
  })

  it('正文空白：动作不出现、浮层一次都不挂载、预览一次都不发', async () => {
    channelState.activeChannelId.value = 'ch_a'
    const wrapper = await rewriteOnce()
    await wrapper.find('textarea.result-textarea').setValue('   ')
    await nextTick()
    expect(wrapper.find('[data-testid="btn-podcast-script-entry"]').exists()).toBe(false)
    expect(wrapper.findComponent(PodcastScriptEntry).exists()).toBe(false)
    expect(podcastApi.episodePlanPreview).not.toHaveBeenCalled()
  })
})

