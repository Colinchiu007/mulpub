/**
 * 采集页「一键改写」流程可视化与字数区间放开 —— 行为锁
 * （collection-ux-step-flow，2026-10-20）
 *
 * 动因：用户真机走查提了 6 条反馈，本文件锁住其中与**运行时行为**直接相关的四条：
 *   P1 一键改写期间「采集」按钮跟着变成「采集中…」⇒ 按钮态串扰；
 *   P2 采集成功后只有一句「采集成功」⇒ 用户以为整个操作已完成（实际才到第 2 步）；
 *   P5 字数上限文案与引擎真实上限（50000）不一致；
 *   P6 字数区间默认预填 800-2000 ⇒ 每次改写都被压进窄区间。
 *
 * 尺寸类与样式类断言不在本文件（P4 的根因与判据在
 * src/features/collection/collection-page-css-contract.test.js）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
  ElDialog: { template: '<div class="el-dialog"><slot></slot></div>' },
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import CollectionView from './Collection.vue'
import i18n from '@/i18n'
import { ElMessage } from 'element-plus'

const ZHIHU_ANSWER_URL = 'https://www.zhihu.com/question/715577762/answer/2095239383058329672'

function mountCollection () {
  return mount(CollectionView, {
    global: { plugins: [createPinia(), i18n] },
  })
}

/**
 * 知乎 stealth 采集通道 + **可手动放行**的 aiRewrite（用来观察「改写进行中」的中间态）。
 * 放行前改写一直挂着，测试可以在此窗口内断言按钮文案与步骤条状态。
 */
function mockStealthApi (content, gate) {
  return {
    aggregationCollect: vi.fn(),
    aggregationRewrite: vi.fn(),
    aiRewrite: vi.fn(() => gate),
    urlCollectNeedsStealth: vi.fn().mockResolvedValue({ code: 0, data: { needsStealth: true } }),
    urlCollectFetch: vi.fn().mockResolvedValue({
      code: 0,
      data: { title: '知乎回答标题', content, coverImage: '' },
    }),
  }
}

function successTexts () {
  return ElMessage.success.mock.calls.map((c) => String(c[0])).join('\n')
}

describe('采集页一键改写 — 流程状态与按钮态解耦（collection-ux-step-flow）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  it('P1：一键改写进行中，「采集」按钮文案保持「采集」（只禁用，不改态）', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    window.electronAPI = mockStealthApi('原文正文内容。', gate)
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL

    const running = w.vm.collectAndRewrite()
    // 采集已完成、改写被 gate 卡住 ⇒ 此刻是「第 2 步进行中」
    await flushPromises()

    const collectBtn = w.find('[data-testid="collection-collect-btn"]')
    expect(collectBtn.exists()).toBe(true)
    expect(collectBtn.text(), '采集按钮文案不得跟随改写状态变化').toBe('采集')
    expect(collectBtn.element.disabled, '改写期间采集按钮应被禁用（防重复提交）').toBe(true)

    release({ code: 0, data: { success: true, result: '改写后的内容。' } })
    await running
    await nextTick()
    // 流程结束后按钮恢复常态
    expect(w.find('[data-testid="collection-collect-btn"]').text()).toBe('采集')
  })

  it('P2：步骤条把「第 1 步已完成 / 第 2 步进行中」显式画出来', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    window.electronAPI = mockStealthApi('原文正文内容。', gate)
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL

    const running = w.vm.collectAndRewrite()
    await flushPromises()

    const flow = w.find('[data-testid="collection-step-flow"]')
    expect(flow.exists(), '有采集结果时必须显示步骤条').toBe(true)
    expect(w.find('[data-testid="collection-step-collect"]').classes()).toContain('is-done')
    expect(w.find('[data-testid="collection-step-rewrite"]').classes()).toContain('is-active')

    release({ code: 0, data: { success: true, result: '改写后的内容。' } })
    await running
    await nextTick()
    expect(w.find('[data-testid="collection-step-rewrite"]').classes()).toContain('is-done')
  })

  it('P2：一键改写时采集成功的提示必须点明「第 2 步」，不得用「采集成功」收尾', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    window.electronAPI = mockStealthApi('原文正文内容。', gate)
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL

    const running = w.vm.collectAndRewrite()
    await flushPromises()

    const texts = successTexts()
    expect(texts).toContain('第 2 步')
    expect(texts).toContain('AI 改写')

    release({ code: 0, data: { success: true, result: '改写后的内容。' } })
    await running
  })

  it('P3：采集到的原文与改写设置分区渲染（两个独立区块 + 原文预览）', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    window.electronAPI = mockStealthApi('这是一段用于验证分区的原文正文。', gate)
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL
    const running = w.vm.collectAndRewrite()
    await flushPromises()

    expect(w.find('[data-testid="collected-content-card"]').exists()).toBe(true)
    expect(w.find('[data-testid="rewrite-settings-card"]').exists()).toBe(true)
    expect(w.find('[data-testid="collected-content-preview"]').text()).toContain('这是一段用于验证分区的原文正文。')

    release({ code: 0, data: { success: true, result: '改写后的内容。' } })
    await running
    await nextTick()
    expect(w.find('[data-testid="rewrite-result-card"]').exists()).toBe(true)
  })
})

describe('采集页字数区间 — 默认留空 = 不设限（collection-ux-step-flow）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  it('P6：两个输入框默认留空，且留空时不下发 wordCountRange、改下发 freeformOutput', async () => {
    window.electronAPI = mockStealthApi('原文正文内容。', Promise.resolve({
      code: 0, data: { success: true, result: '改写后的内容。' },
    }))
    const w = mountCollection()
    await nextTick()
    expect(w.vm.rewriteWordCountMin).toBe('')
    expect(w.vm.rewriteWordCountMax).toBe('')
    expect(w.vm.rewriteWordCountError, '留空不是非法输入').toBe('')

    w.vm.linkUrl = ZHIHU_ANSWER_URL
    await w.vm.collectAndRewrite()

    const us = window.electronAPI.aiRewrite.mock.calls[0][0].userSettings
    expect(us.wordCountRange, '留空 ⇒ 不得下发字数区间（否则引擎会注入字数要求）').toBeUndefined()
    expect(us.targetWordCount).toBeUndefined()
    expect(us.freeformOutput, '留空 ⇒ 显式声明「不设字数限制」').toBe(true)
  })

  it('P6：用户填了数字才下发区间；只填一侧时另一侧取统一上限 50000', async () => {
    window.electronAPI = mockStealthApi('原文正文内容。', Promise.resolve({
      code: 0, data: { success: true, result: '改写后的内容。' },
    }))
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL
    w.vm.rewriteWordCountMin = 800
    w.vm.rewriteWordCountMax = 2000
    await w.vm.collectAndRewrite()

    let us = window.electronAPI.aiRewrite.mock.calls[0][0].userSettings
    expect(us.wordCountRange).toEqual({ min: 800, max: 2000 })
    expect(us.freeformOutput).toBeUndefined()
    // 契约键唯一：targetWordCount 是历史误传键（引擎 0 处引用），不得下发
    // （与 collect-rewrite-wordcount 的契约测试同口径：wordCountRange 在、targetWordCount 不在）
    expect(us.targetWordCount, '不得下发引擎不消费的历史键 targetWordCount').toBeUndefined()

    // 只填上限 ⇒ 下限取 0
    window.electronAPI.aiRewrite.mockClear()
    w.vm.rewriteWordCountMin = ''
    w.vm.rewriteWordCountMax = 2000
    await w.vm.rewriteCollected()
    us = window.electronAPI.aiRewrite.mock.calls[0][0].userSettings
    expect(us.wordCountRange).toEqual({ min: 0, max: 2000 })
    expect(us.freeformOutput).toBeUndefined()

    // 只填下限 ⇒ 上限取统一上限 50000
    window.electronAPI.aiRewrite.mockClear()
    w.vm.rewriteWordCountMin = 800
    w.vm.rewriteWordCountMax = ''
    await w.vm.rewriteCollected()
    us = window.electronAPI.aiRewrite.mock.calls[0][0].userSettings
    expect(us.wordCountRange).toEqual({ min: 800, max: 50000 })
  })

  it('P5：字数非法（超出 50000 / max < min）时阻止提交并给出错误文案', async () => {
    window.electronAPI = mockStealthApi('原文正文内容。', Promise.resolve({
      code: 0, data: { success: true, result: '改写后的内容。' },
    }))
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', title: 'T', content: '原始正文内容。', description: '' }

    w.vm.rewriteWordCountMin = 100
    w.vm.rewriteWordCountMax = 60000
    await nextTick()
    expect(w.vm.rewriteWordCountError).toBeTruthy()
    expect(w.vm.rewriteWordCountError).toContain('50000')

    w.vm.rewriteWordCountMin = 2000
    w.vm.rewriteWordCountMax = 100
    await nextTick()
    expect(w.vm.rewriteWordCountError).toBeTruthy()

    const before = window.electronAPI.aiRewrite.mock.calls.length
    await w.vm.rewriteCollected()
    expect(window.electronAPI.aiRewrite.mock.calls.length, '字数非法时不得发起改写').toBe(before)
  })
})
