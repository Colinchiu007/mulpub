/**
 * 采集页「AI 改写」字数区间真实生效（collect-rewrite-wordcount，2026-10-20）。
 *
 * 事故形态（用户实测）：采集页把字数区间设成 0-6000，点「改写」后出来的稿子只有 1229 字
 * （原文 3515 字），且**没有任何提示**——用户既不知道自己的设置没生效，也不知道结果被砍过。
 *
 * 根因三连（全部在本文件锁住）：
 *   ① 采集页下发的是 `userSettings.targetWordCount`，而引擎真契约是 `userSettings.wordCountRange`
 *      ⇒ 引擎完全收不到区间：prompt 里没有【字数要求】、后处理上限回落策略默认（800/1500/2000/3000）、
 *      主进程 max_tokens 推导也回落 3000 口径。死键 targetWordCount 在整个引擎包里 0 处引用。
 *   ② `Number(min) || 800` 把合法的下限 0 吞成 800（0 是假值）——用户设的「0」根本没传下去。
 *   ③ 引擎把 min=0 渲染成「0 到 6000 字之间」——「无下限」被说成「可以任意短」，
 *      模型照着下限写，改写被做成摘要（本文件只锁契约，引擎侧语义在 rewrite-engine-core 的 W7-W10）。
 *
 * 本文件独立于 Collection.test.js（后者行数已接近容差），
 * 描述的是「字数区间契约 + 结果可见性」这一条独立契约。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
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

/** 采集页用到的最小 IPC 面：改写走 aiRewrite（Node 引擎链路）。 */
function mockApi (aiRewriteResult) {
  return {
    aggregationCollect: vi.fn(),
    aggregationRewrite: vi.fn(),
    aiRewrite: vi.fn().mockResolvedValue(aiRewriteResult),
    urlCollectNeedsStealth: vi.fn().mockResolvedValue({ code: 0, data: { needsStealth: false } }),
    urlCollectFetch: vi.fn(),
  }
}

function mountCollection () {
  return mount(CollectionView, {
    global: { plugins: [createPinia(), i18n] },
  })
}

/** 采集页已有的改写结果（够长，便于断言字数元信息） */
const REWRITTEN = '改写后的正文内容。'.repeat(100)

describe('采集页 AI 改写 — 字数区间真实生效（collect-rewrite-wordcount）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  // ── ① 契约：引擎收的是 wordCountRange，不是死键 targetWordCount ──

  it('下发给引擎的是 userSettings.wordCountRange（引擎真契约），不再有死键 targetWordCount', async () => {
    window.electronAPI = mockApi({ code: 0, data: { success: true, result: REWRITTEN } })
    const w = mountCollection()
    await nextTick()
    w.vm.rewriteWordCountMin = 0
    w.vm.rewriteWordCountMax = 6000
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()

    const call = window.electronAPI.aiRewrite.mock.calls[0]
    expect(call).toBeTruthy()
    const us = call[0].userSettings
    expect(us.wordCountRange).toEqual({ min: 0, max: 6000 })
    // 死键必须消失：它在整个引擎包里 0 处引用，留着只会让人误以为设置生效了
    expect(us.targetWordCount).toBeUndefined()
  })

  it('min=0 原样下发（不被 || 800 吞成 800）', async () => {
    window.electronAPI = mockApi({ code: 0, data: { success: true, result: REWRITTEN } })
    const w = mountCollection()
    await nextTick()
    w.vm.rewriteWordCountMin = 0
    w.vm.rewriteWordCountMax = 6000
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()

    const range = window.electronAPI.aiRewrite.mock.calls[0][0].userSettings.wordCountRange
    expect(range.min).toBe(0)
    expect(range.max).toBe(6000)
  })

  it('非法区间时不下发区间（早退，不把垃圾值发给引擎）', async () => {
    window.electronAPI = mockApi({ code: 0, data: { success: true, result: REWRITTEN } })
    const w = mountCollection()
    await nextTick()
    // max < min ⇒ 校验器判红，改写按钮禁用
    w.vm.rewriteWordCountMin = 6000
    w.vm.rewriteWordCountMax = 100
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    expect(window.electronAPI.aiRewrite).not.toHaveBeenCalled()
  })

  // ── ② 可见性：用户必须看得到「改写后到底多少字」和「稿子被砍过」 ──

  it('改写结果显示实际字数（改写后 N 字 / 原文 M 字）', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: { success: true, result: REWRITTEN, outputLength: REWRITTEN.length },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()

    const meta = w.find('[data-testid="collection-rewrite-output-length"]')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain(String(REWRITTEN.length))
    // 原文长度也要能看到——用户要判断「短了多少」得有两个数
    expect(meta.text()).toContain(String('原文内容。'.repeat(100).length))
  })

  it('引擎按上限砍尾 ⇒ 显示「已按字数上限截断」横幅（不是静默短稿）', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: { success: true, result: REWRITTEN, outputTruncated: true, outputLength: 1500 },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.rewriteWordCountMin = 0
    w.vm.rewriteWordCountMax = 1500
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()

    const banner = w.find('[data-testid="collection-rewrite-truncated"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('1500')
  })

  it('模型侧生成上限截断 ⇒ 显示「模型输出达到单次生成上限」横幅（与引擎砍尾分型）', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: { success: true, result: REWRITTEN, modelTruncated: true, outputLength: 3000 },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()

    const banner = w.find('[data-testid="collection-rewrite-model-truncated"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('3000')
  })

  it('正常改写（未截断）⇒ 不出现任何截断横幅', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: { success: true, result: REWRITTEN, outputTruncated: false, modelTruncated: false, outputLength: REWRITTEN.length },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()

    expect(w.find('[data-testid="collection-rewrite-truncated"]').exists()).toBe(false)
    expect(w.find('[data-testid="collection-rewrite-model-truncated"]').exists()).toBe(false)
    expect(w.find('[data-testid="collection-rewrite-output-length"]').exists()).toBe(true)
  })

  it('清空结果 ⇒ 字数元信息与横幅一并复位（不得残留上一轮的截断提示）', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: { success: true, result: REWRITTEN, outputTruncated: true, outputLength: 1500 },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()
    expect(w.find('[data-testid="collection-rewrite-truncated"]').exists()).toBe(true)

    w.vm.clearResult()
    await nextTick()
    expect(w.find('[data-testid="collection-rewrite-truncated"]').exists()).toBe(false)
    expect(w.find('[data-testid="collection-rewrite-output-length"]').exists()).toBe(false)
  })
})
