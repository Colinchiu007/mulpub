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
