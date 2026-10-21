/**
 * 采集页消费改写结果的敏感词警告（rewrite-sensitive-precheck-relax 收尾，2026-10-21）。
 *
 * 事故形态（用户实测 + 外部审查发现）：PR #4103 把改写引擎的前置敏感词拦截关了
 * （用户 8000 字越华史料只因「爆炸」一词被整篇拒绝）。方案是「B+」：
 * 关前置、**留后置**——改写结果若仍含敏感词，引擎会在 warnings 里提醒人工审核。
 * 但采集页的 `rewriteViaEngine` 成功分支只挑 result_content/knowledgeRefs/meta，
 * **warnings 被静默丢弃**：改写页与 AI 面板都把 warnings 写进了错误区（虽然样式不当），
 * 而采集页 4 个入口（视频转写 / stealth 自动 / 聚合回退 / 手动改写）**零提示**。
 * 于是「保留后置提醒」这半条防线在采集页实际不成立。
 *
 * 本文件锁住三件事：
 *   ① rewriteViaEngine 的 meta 必须带上 warnings（不再静默丢弃）；
 *   ② 改写成功且有 warnings 时，用户必须看到 warning 级提示（不是红色错误）；
 *   ③ 无 warnings 时不得弹提示（不制造噪音）。
 *
 * 与 Collection.rewrite-wordcount.test.js 的分工：那个文件锁字数区间契约，
 * 本文件锁敏感词警告契约，互不重叠。
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

const REWRITTEN = '改写后的正文内容。'.repeat(100)

describe('采集页消费改写结果的敏感词警告（rewrite-sensitive-precheck-relax 收尾）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  // ── ① 契约：warnings 必须穿过漏斗，不能被静默丢弃 ──

  it('改写结果带 warnings ⇒ meta.warnings 原样透传（不再静默丢弃）', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: {
        success: true,
        result: REWRITTEN,
        warnings: ['改写结果可能包含敏感内容，请人工审核'],
        sensitiveHits: [{ word: '爆炸', index: 0, length: 2, category: '暴力' }],
      },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }

    // 直接测漏斗（不改 UI）：rewriteViaEngine 是内部函数，经 rewriteCollected 驱动
    await w.vm.rewriteCollected()
    await nextTick()

    // 结果必须照常落地（warnings 不是失败，不能挡住结果）
    expect(w.vm.rewriteResult).toBe(REWRITTEN)
    // 关键契约：meta 里必须带 warnings。这里用 vm 上的 meta 状态断言形状，
    // 避免只断言「弹了提示」而漏掉「提示内容从哪来」。
    expect(w.vm.rewriteSensitiveWarnings).toEqual(['改写结果可能包含敏感内容，请人工审核'])
  })

  it('无 warnings ⇒ 不产生敏感词提示状态（不制造噪音）', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: { success: true, result: REWRITTEN, warnings: [] },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()

    expect(w.vm.rewriteResult).toBe(REWRITTEN)
    expect(w.vm.rewriteSensitiveWarnings).toEqual([])
  })

  it('warnings 缺失（旧版引擎信封）⇒ 归一化为空数组，不抛错', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: { success: true, result: REWRITTEN },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()

    expect(w.vm.rewriteResult).toBe(REWRITTEN)
    expect(w.vm.rewriteSensitiveWarnings).toEqual([])
  })

  // ── ② 可见性：用户必须看得到提示，且是 warning 级而非红色错误 ──

  it('有 warnings ⇒ 页面渲染敏感词提示条（不是红色错误区）', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: {
        success: true,
        result: REWRITTEN,
        warnings: ['改写结果可能包含敏感内容，请人工审核'],
      },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()

    const banner = w.find('[data-testid="collection-rewrite-sensitive"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('敏感')
    // 不得同时把结果判成失败：结果区与提示条是两件事
    expect(w.vm.rewriteError).toBeFalsy()
  })

  it('有 warnings ⇒ 走 warning 级通知（与红色错误区分开）', async () => {
    const { ElMessage } = await import('element-plus')
    window.electronAPI = mockApi({
      code: 0,
      data: {
        success: true,
        result: REWRITTEN,
        warnings: ['改写结果可能包含敏感内容，请人工审核'],
      },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()

    // warning 级必须响；error 级不得响（那会把「请人工审核」变成「改写失败」）
    expect(ElMessage.warning).toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  // ── ③ 复位：清空结果时提示条一并消失（不得残留上一轮的警告） ──

  it('清空结果 ⇒ 敏感词提示条一并复位', async () => {
    window.electronAPI = mockApi({
      code: 0,
      data: {
        success: true,
        result: REWRITTEN,
        warnings: ['改写结果可能包含敏感内容，请人工审核'],
      },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { id: 'x', content: '原文内容。'.repeat(100) }
    await w.vm.rewriteCollected()
    await nextTick()
    expect(w.find('[data-testid="collection-rewrite-sensitive"]').exists()).toBe(true)

    w.vm.clearResult()
    await nextTick()
    expect(w.find('[data-testid="collection-rewrite-sensitive"]').exists()).toBe(false)
    expect(w.vm.rewriteSensitiveWarnings).toEqual([])
  })
})
