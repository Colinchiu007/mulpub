import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const aiRewrite = vi.fn()
const aiListRewriteStrategies = vi.fn()
const aiGetRecommendedStrategies = vi.fn()
const notifyError = vi.fn()
const notifySuccess = vi.fn()

vi.mock('@/api/publisher', () => ({
  aiRewrite: (...args) => aiRewrite(...args),
  aiListRewriteStrategies: (...args) => aiListRewriteStrategies(...args),
  aiGetRecommendedStrategies: (...args) => aiGetRecommendedStrategies(...args),
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({ notifyError, notifySuccess, notifyWarning: vi.fn(), notifyInfo: vi.fn() }),
}))

vi.mock('@/utils/user-facing-error', () => ({
  formatUserError: (error, opts) => ({
    message: (error && error.message) || (opts && opts.fallback) || 'error',
  }),
}))

vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }))

import CopyRewriteModal from './CopyRewriteModal.vue'

const SOURCE = {
  fromKey: 'collect:c1',
  title: '原标题',
  content: '这是一段足够长的原文内容，用于验证改写弹窗的参数组装与提交。',
  platform: '',
  sourceUrl: 'https://example.com/a',
}

function factory (source = SOURCE) {
  i18n.global.locale.value = 'zh'
  return mount(CopyRewriteModal, {
    props: { source },
    global: { plugins: [i18n] },
  })
}

describe('CopyRewriteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiListRewriteStrategies.mockResolvedValue({ code: 0, data: [{ id: 's1', name: '爆款策略' }] })
    aiGetRecommendedStrategies.mockResolvedValue({ code: 0, data: [{ id: 's1', name: '爆款策略' }] })
    aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '改写后的正文' } })
  })

  it('渲染改写相关的全部选项', async () => {
    const w = factory()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    expect(w.find('[data-testid="copy-rewrite-modal"]').exists()).toBe(true)
    // 原文展示
    expect(w.find('[data-testid="copy-rewrite-source-title"]').text()).toBe('原标题')
    expect(w.find('[data-testid="copy-rewrite-source"]').element.value).toContain('这是一段足够长的原文内容')
    // 改写模式（3 项）
    expect(w.findAll('.mode-chip')).toHaveLength(3)
    expect(w.find('[data-testid="copy-rewrite-mode-imitate"]').exists()).toBe(true)
    expect(w.find('[data-testid="copy-rewrite-mode-expand"]').exists()).toBe(true)
    expect(w.find('[data-testid="copy-rewrite-mode-create"]').exists()).toBe(true)
    // 风格 / 平台 / 知识参考 / 字数 / 策略
    expect(w.find('[data-testid="copy-rewrite-style"]').exists()).toBe(true)
    expect(w.find('[data-testid="copy-rewrite-platform"]').exists()).toBe(true)
    expect(w.find('[data-testid="copy-rewrite-viral"]').exists()).toBe(true)
    expect(w.find('[data-testid="copy-rewrite-personal"]').exists()).toBe(true)
    expect(w.findAll('input[type="number"]')).toHaveLength(2)
    expect(w.findAll('.strategy-radio')).toHaveLength(2)
  })

  it('原文为空时禁止提交并提示', async () => {
    const w = factory({ ...SOURCE, content: '' })
    await nextTick()
    expect(w.find('[data-testid="copy-rewrite-start"]').attributes('disabled')).toBeDefined()
    await w.vm.start()
    expect(w.find('[data-testid="copy-rewrite-error"]').text()).toContain('无法改写')
    expect(aiRewrite).not.toHaveBeenCalled()
  })

  it('字数区间非法时阻止改写', async () => {
    const w = factory()
    await nextTick()
    w.vm.wordCountMin = 3000
    w.vm.wordCountMax = 100
    await nextTick()
    expect(w.find('[data-testid="copy-rewrite-start"]').attributes('disabled')).toBeDefined()
    await w.vm.start()
    expect(aiRewrite).not.toHaveBeenCalled()
    expect(w.find('[data-testid="copy-rewrite-error"]').text()).toContain('最大字数不能小于最小字数')
  })

  it('改写成功后 emit rewritten 并带上来源键与结果', async () => {
    const w = factory()
    await nextTick()
    await w.vm.start()
    await nextTick()
    expect(aiRewrite).toHaveBeenCalledTimes(1)
    const params = aiRewrite.mock.calls[0][0]
    expect(params).toMatchObject({ mode: 'imitate', content: SOURCE.content, strategyId: null })
    expect(params.userSettings).toMatchObject({
      tone: 'casual',
      platform: undefined,
      wordCountRange: { min: 800, max: 2000 },
      targetLength: 'medium',
      knowledgeOptions: { useViralLibrary: true, usePersonalKnowledge: false },
    })
    const emitted = w.emitted('rewritten')
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0]).toMatchObject({
      fromKey: 'collect:c1',
      fromTitle: '原标题',
      content: '改写后的正文',
      sourceUrl: 'https://example.com/a',
    })
    expect(w.find('[data-testid="copy-rewrite-result-section"]').exists()).toBe(true)
  })

  it('选项变更反映到请求参数（模式/风格/平台/知识参考/字数/手动策略）', async () => {
    const w = factory()
    await nextTick()
    w.vm.mode = 'expand'
    w.vm.style = 'formal'
    w.vm.platform = 'douyin'
    w.vm.usePersonalExperience = true
    w.vm.useViralLibrary = false
    w.vm.wordCountMin = 1500
    w.vm.wordCountMax = 2600
    w.vm.strategyMode = 'manual'
    w.vm.strategyId = 's1'
    await nextTick()
    await w.vm.start()
    const params = aiRewrite.mock.calls[0][0]
    expect(params.mode).toBe('expand')
    expect(params.strategyId).toBe('s1')
    expect(params.userSettings.tone).toBe('formal')
    expect(params.userSettings.platform).toBe('douyin')
    expect(params.userSettings.wordCountRange).toEqual({ min: 1500, max: 2600 })
    expect(params.userSettings.targetLength).toBe('long')
    expect(params.userSettings.knowledgeOptions).toEqual({ useViralLibrary: false, usePersonalKnowledge: true })
  })

  it('改写失败时展示错误且不 emit', async () => {
    aiRewrite.mockResolvedValue({ code: -400, message: '模型未配置' })
    const w = factory()
    await nextTick()
    await w.vm.start()
    await nextTick()
    expect(w.emitted('rewritten')).toBeUndefined()
    expect(w.find('[data-testid="copy-rewrite-error"]').text()).toContain('模型未配置')
    expect(notifyError).toHaveBeenCalled()
  })

  it('IPC 抛异常时也展示错误（不冒泡）', async () => {
    aiRewrite.mockRejectedValue(new Error('ipc down'))
    const w = factory()
    await nextTick()
    await w.vm.start()
    expect(w.find('[data-testid="copy-rewrite-error"]').text()).toContain('ipc down')
  })

  it('关闭：改写中不响应，空闲时 emit close', async () => {
    const w = factory()
    await nextTick()
    await w.vm.onCancel()
    expect(w.emitted('close')).toHaveLength(1)
  })
})
