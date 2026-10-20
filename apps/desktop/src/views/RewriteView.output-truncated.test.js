/**
 * 改写结果「输出截断可见化」回归锁（rewrite-limits-50000，2026-10-19）。
 *
 * 旧行为：引擎 _postProcess 按字数上限砍尾完全静默——用户拿到不完整的稿子且以为它就是全部，
 * 比 TOO_LONG 更隐蔽。新契约：引擎返回 outputTruncated/outputLength，改写页结果卡顶部
 * 暖橙横幅（data-testid="rewrite-output-truncated"）展示实际字数与上限。
 *
 * 独立成文件的原因：RewriteView.test.js 已挂账接近行数容差（TEST_LEDGER_GREW），
 * 新增场景按被测能力分文件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

vi.mock('@/api/publisher', () => ({
  aiRewrite: vi.fn(),
  aiListRewriteStrategies: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  aiGetRecommendedStrategies: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  draftSave: vi.fn().mockResolvedValue({ code: 0, data: { draftId: 'd-t' } }),
  applyKnowledgeFeedback: vi.fn().mockResolvedValue({ code: 0 }),
  modelProviderGetDefault: vi.fn().mockResolvedValue({ code: 0, data: null }),
  aiGenerateGenVideoTitle: vi.fn().mockResolvedValue({ code: 0, data: { success: false } }),
  draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  storeGetSetting: vi.fn().mockResolvedValue(null),
  storeSetSetting: vi.fn().mockResolvedValue({ code: 0 }),
}))

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn().mockResolvedValue(true),
  }),
}))

import RewriteView from './RewriteView.vue'
import i18n from '@/i18n'
import { aiRewrite } from '@/api/publisher'

function factory () {
  return mount(RewriteView, {
    global: { plugins: [createPinia(), i18n] },
    attachTo: document.body,
  })
}

async function startRewrite (wrapper) {
  await wrapper.find('textarea.rewrite-textarea').setValue('这是一段足够长的测试文案内容，超过二十个字，测试改写功能。')
  await nextTick()
  await wrapper.find('.rewrite-start-btn').trigger('click')
  await flushPromises()
  await nextTick()
}

describe('改写结果输出截断可见化（rewrite-limits-50000）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
    // 清空挂载残留（不用 innerHTML 置空——CCG 安全扫描会把直接 innerHTML 操作判高危）
    document.body.replaceChildren()
  })

  it('引擎 outputTruncated=true ⇒ 结果卡顶部展示截断横幅（含实际字数与上限）', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '被截断的结果。',
        outputTruncated: true,
        outputLength: 2000,
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 2000, aiTasteLevel: 0.15 },
      },
    })
    const wrapper = factory()
    await startRewrite(wrapper)
    const banner = wrapper.find('[data-testid="rewrite-output-truncated"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('2000')
    wrapper.unmount()
  })

  it('引擎 outputTruncated 缺省 ⇒ 不展示截断横幅（正常路径零干扰）', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '正常完整结果。',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 8, aiTasteLevel: 0.15 },
      },
    })
    const wrapper = factory()
    await startRewrite(wrapper)
    expect(wrapper.find('[data-testid="rewrite-output-truncated"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('引擎 outputTruncated=false ⇒ 同样不展示（显式 false 与缺省同态）', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '正常完整结果。',
        outputTruncated: false,
        outputLength: 8,
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 8, aiTasteLevel: 0.15 },
      },
    })
    const wrapper = factory()
    await startRewrite(wrapper)
    expect(wrapper.find('[data-testid="rewrite-output-truncated"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

// ── 模型侧截断可见化（rewrite-segment-and-finish-reason 第二刀）──
// 引擎 outputTruncated（按字数区间砍尾）与 modelTruncated（provider 自身上限截断）
// 是两种不同限制，必须分型展示：前者建议「调大字数控制」，对后者无效。
describe('改写结果模型侧截断可见化（rewrite-segment-and-finish-reason）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
    document.body.replaceChildren()
  })

  it('modelTruncated=true ⇒ 展示模型截断横幅（与引擎截断横幅分型，两个 testid 独立）', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '被模型截断的结果。',
        modelTruncated: true,
        outputLength: 4000,
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 4000, aiTasteLevel: 0.15 },
      },
    })
    const wrapper = factory()
    await startRewrite(wrapper)
    const banner = wrapper.find('[data-testid="rewrite-model-truncated"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('4000')
    // 引擎截断横幅不得同时出现（引擎未砍尾）
    expect(wrapper.find('[data-testid="rewrite-output-truncated"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('两态同时为 true ⇒ 两条横幅并存（来源不同、各自可读）', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '两重限制的结果。',
        outputTruncated: true,
        outputLength: 3000,
        modelTruncated: true,
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 3000, aiTasteLevel: 0.15 },
      },
    })
    const wrapper = factory()
    await startRewrite(wrapper)
    expect(wrapper.find('[data-testid="rewrite-output-truncated"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rewrite-model-truncated"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('modelTruncated 缺省 ⇒ 不展示（正常路径零干扰）', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '正常完整结果。',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 8, aiTasteLevel: 0.15 },
      },
    })
    const wrapper = factory()
    await startRewrite(wrapper)
    expect(wrapper.find('[data-testid="rewrite-model-truncated"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

// ── 分段改写元信息（rewrite-segment-and-finish-reason 第二刀）──
describe('改写结果分段元信息', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
    document.body.replaceChildren()
  })

  it('segmented.enabled=true 且段数 >1 ⇒ 结果卡 meta 行展示「分段改写 ×N」', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '分段改写后的合并结果。',
        segmented: { enabled: true, segmentCount: 5, totalChars: 60000 },
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 60000, resultLength: 12, aiTasteLevel: 0.15 },
      },
    })
    const wrapper = factory()
    await startRewrite(wrapper)
    const meta = wrapper.find('[data-testid="rewrite-segmented-meta"]')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain('5')
    wrapper.unmount()
  })

  it('segmented 缺省 / 单段 ⇒ 不展示段数（不给普通改写加噪音）', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: true,
        result: '普通改写结果。',
        strategy: { id: 's1', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 300, resultLength: 10, aiTasteLevel: 0.15 },
      },
    })
    const wrapper = factory()
    await startRewrite(wrapper)
    expect(wrapper.find('[data-testid="rewrite-segmented-meta"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
