/**
 * 改写取消通道 + 分段截断汇总回归锁（rewrite-cancel-and-truncation-summary，2026-10-20）。
 *
 * 两个历史缺陷：
 * ① `ai:rewrite` 无取消通道 —— 5 万字点下去，粘错文章也只能等全程，后续片段继续计费。
 * ② 分段合并后 `modelTruncated` 恒 false —— 某段被模型截断时正文中间缺一块且界面无提示。
 *
 * 独立成文件：RewriteView.test.js / RewriteView.output-truncated.test.js 均已接近行数容差，
 * 新增场景按被测能力分文件（TEST_LEDGER_GREW 口径）。
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
  aiRewriteCancel: vi.fn(),
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
import { ElMessage } from 'element-plus'
import { aiRewrite, aiRewriteCancel } from '@/api/publisher'

const SAMPLE = '这是一段足够长的测试文案内容，超过二十个字，测试改写功能。'

function factory () {
  return mount(RewriteView, {
    global: { plugins: [createPinia(), i18n] },
    attachTo: document.body,
  })
}

/** 点「开始改写」并让 promise 停在进行中（不 resolve） */
async function startPendingRewrite (wrapper) {
  await wrapper.find('textarea.rewrite-textarea').setValue(SAMPLE)
  await nextTick()
  await wrapper.find('.rewrite-start-btn').trigger('click')
  await nextTick()
  await flushPromises()
  await nextTick()
}

function okResult (extra) {
  return {
    code: 0,
    data: {
      success: true,
      result: '改写后的完整结果。',
      strategy: { id: 's1', name: '测试策略', category: 'viral' },
      warnings: [],
      sensitiveHits: [],
      knowledgeRefs: [],
      metadata: { mode: 'imitate', originalLength: 30, resultLength: 10, aiTasteLevel: 0.2 },
      ...extra,
    },
  }
}

describe('改写取消通道（rewrite-cancel-and-truncation-summary）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
    document.body.replaceChildren()
  })

  it('每次改写生成 runId 并随参数传给引擎（取消的前提）', async () => {
    aiRewrite.mockResolvedValueOnce(okResult())
    const wrapper = factory()
    await startPendingRewrite(wrapper)

    expect(aiRewrite).toHaveBeenCalledTimes(1)
    const params = aiRewrite.mock.calls[0][0]
    expect(typeof params.runId).toBe('string')
    expect(params.runId.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('改写进行中展示取消按钮；点击后调 aiRewriteCancel(runId) 且不弹错误', async () => {
    // aiRewrite 永不 resolve ⇒ 保持「改写中」态
    aiRewrite.mockReturnValueOnce(new Promise(() => {}))
    aiRewriteCancel.mockResolvedValueOnce({ code: 0, data: { cancelled: true } })

    const wrapper = factory()
    await startPendingRewrite(wrapper)

    const cancelBtn = wrapper.find('[data-testid="rewrite-cancel-btn"]')
    expect(cancelBtn.exists()).toBe(true)

    const runId = aiRewrite.mock.calls[0][0].runId
    await cancelBtn.trigger('click')
    await flushPromises()

    expect(aiRewriteCancel).toHaveBeenCalledWith(runId)
    // 取消不是错误：info 有、error 无
    expect(ElMessage.info).toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('引擎返回 CANCELLED ⇒ 复位改写中状态、info 提示、不清空已有结果', async () => {
    aiRewrite.mockResolvedValueOnce({
      code: 0,
      data: {
        success: false,
        cancelled: true,
        errorCode: 'CANCELLED',
        error: '改写已取消（第 2/5 段开始前停止）',
        segmentCount: 5,
        completedSegments: 1,
      },
    })
    const wrapper = factory()
    await startPendingRewrite(wrapper)

    // 不算失败：不弹 error 弹窗
    expect(ElMessage.error).not.toHaveBeenCalled()
    expect(ElMessage.info).toHaveBeenCalled()
    // 取消后可以再次点开始（rewriting 已复位）
    expect(wrapper.find('.rewrite-start-btn').exists()).toBe(true)
    wrapper.unmount()
  })

  it('正常完成 ⇒ 不展示取消按钮', async () => {
    aiRewrite.mockResolvedValueOnce(okResult())
    const wrapper = factory()
    await startPendingRewrite(wrapper)

    expect(wrapper.find('[data-testid="rewrite-cancel-btn"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('分段截断汇总展示（rewrite-cancel-and-truncation-summary）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
    document.body.replaceChildren()
  })

  it('分段 + 有截断段 ⇒ 横幅出现且点名段号', async () => {
    aiRewrite.mockResolvedValueOnce(okResult({
      modelTruncated: true,
      outputLength: 42000,
      segmented: { enabled: true, segmentCount: 5, totalChars: 60000 },
      truncatedSegments: [3],
    }))
    const wrapper = factory()
    await startPendingRewrite(wrapper)

    const banner = wrapper.find('[data-testid="rewrite-model-truncated"]')
    expect(banner.exists()).toBe(true)
    // 必须让用户知道「是哪一段」被截，而不是笼统说整篇被截
    expect(banner.text()).toContain('3')
    wrapper.unmount()
  })

  it('分段但无截断段 ⇒ 不展示模型截断横幅', async () => {
    aiRewrite.mockResolvedValueOnce(okResult({
      modelTruncated: false,
      segmented: { enabled: true, segmentCount: 5, totalChars: 60000 },
      truncatedSegments: [],
    }))
    const wrapper = factory()
    await startPendingRewrite(wrapper)

    expect(wrapper.find('[data-testid="rewrite-model-truncated"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('单次路径（无 truncatedSegments）仍按原形态展示横幅（不回归旧场景）', async () => {
    aiRewrite.mockResolvedValueOnce(okResult({
      modelTruncated: true,
      outputLength: 3000,
    }))
    const wrapper = factory()
    await startPendingRewrite(wrapper)

    const banner = wrapper.find('[data-testid="rewrite-model-truncated"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('3000')
    wrapper.unmount()
  })
})
