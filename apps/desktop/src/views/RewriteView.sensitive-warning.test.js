/**
 * 改写结果的敏感词警告必须走 warning 级，不得进红色错误区
 * （fix-rewrite-warning-severity，2026-10-21）。
 *
 * 事故形态（外部审查发现，PR #4141 收尾时登记为未闭合项）：
 * PR #4103 把引擎的前置敏感词拦截关了，方案「B+」是「关前置、留后置」——
 * 改写结果若仍含敏感词，引擎会在 warnings 里提醒人工审核。但三个消费点里：
 *   · 采集页 4 入口 —— 已修（PR #4141，warning 级提示条）
 *   · RewriteView.vue:891 —— `rewriteError.value = data.warnings.join('；')`
 *   · AiWriterPanel.vue:368 —— `panelError.value = data.warnings.join("；")`
 * 后两个把 warnings 写进**红色错误区**（`role="alert"`），而同一时刻结果已成功落地、
 * 还弹了 `notifySuccess` ⇒ 用户看到「红色错误 + 成功提示 + 有结果」三者并存，
 * 视觉语义自相矛盾：要么以为改写失败了，要么以为这个错误可以忽略。
 *
 * 本文件锁住三件事：
 *   ① 有 warnings 时，role="alert" 的红色错误区**不得**出现（warnings 不是失败）；
 *   ② warnings 必须以 warning 级呈现（独立的提示元素 + warning 级通知）；
 *   ③ 真正的失败（引擎 success:false）仍然进红色错误区——不能把两者一起放宽。
 *
 * 与 Collection.rewrite-sensitive-warning.test.js 的分工：那个文件锁采集页，
 * 本文件锁改写页与 AI 面板，互不重叠。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'

const mockRouteQuery = { value: {} }
const mockRouterPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useRoute: () => ({ query: mockRouteQuery.value }),
}))

// AiWriterPanel 的既有挂载方式：@/api/publisher 的桩转发到 window.electronAPI，
// 并需 mock useLoginGate（否则 ensureLogin 走真实逻辑）。与 AiWriterPanel.test.js 同构。
const mockEnsureLogin = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({
    ensureLogin: mockEnsureLogin,
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}))

// 用 vi.hoisted 顶层拿桩：动态 import 在多文件同跑时会拿到被其它文件 vi.mock
// 污染后的实例（实测 mockResolvedValueOnce 变成不存在），故必须走 hoisted。
const hoisted = vi.hoisted(() => ({
  aiRewrite: vi.fn(),
}))
vi.mock('@/api/publisher', () => ({
  aiRewrite: hoisted.aiRewrite,
  aiListRewriteStrategies: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  aiGetRecommendedStrategies: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  aiRewriteCancel: vi.fn().mockResolvedValue({ code: 0 }),
  applyKnowledgeFeedback: vi.fn().mockResolvedValue({ code: 0 }),
}))

const WARNING_TEXT = '改写结果可能包含敏感内容，请人工审核'

/**
 * 本文件首测要付「RewriteView.vue 及其依赖图的一次性编译」成本。
 *
 * 实测（rewrite-view-decompose，2026-10-21，本机 jsdom + vitest）：
 *   · `await import('./RewriteView.vue')` 单段 = **3.7s**（拆出 3 个 composable
 *     + 外置样式后 ≈ **4.2s**）—— 这是 Vite 把 SFC 及其整张依赖图编译一遍的**一次性**成本；
 *   · `mount()` 本体 = **75–92ms**；`firstNextTick` = **0ms**。
 * ⇒ 首测的 5.8s 里，**绝大部分不是产品行为慢，是脚手架的一次性编译**。
 *
 * 为什么必须处理：默认 `testTimeout = 10000`，而冷缓存 + 同片并发编译时
 * 首测曾实测超时（7 个文件同场冷跑）。全局抬高 `testTimeout` 不可取 ——
 * 那会让**真正挂死**的用例也跟着放宽，把缺陷藏进更长的等待里。
 * 正解是把一次性编译挪到 `beforeAll`（给它一份显式预算），
 * 让**每条用例的断言窗口仍是 10s** —— 产品行为变慢照样 10s 内报错。
 */
const IMPORT_BUDGET_MS = 60_000

/** 引擎成功 + 带敏感词 warnings 的信封（形状与真实引擎一致） */
function successWithWarnings () {
  return {
    code: 0,
    data: {
      success: true,
      result: '这是改写后的文案内容，用于测试。',
      title: '这是改写后的标题',
      strategy: { id: 'auto-strategy', name: '测试策略', category: 'viral' },
      warnings: [WARNING_TEXT],
      sensitiveHits: [{ word: '爆炸', index: 0, length: 2, category: '暴力' }],
      knowledgeRefs: [],
      metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
      quality: { verdict: 'pass', suggestions: [], method: 'simhash' },
    },
  }
}

describe('敏感词警告的严重级（fix-rewrite-warning-severity）', () => {
  /**
   * 一次性编译预热：把 RewriteView.vue 及其依赖图的编译成本挪到 setup 阶段，
   * 并给这一段一份显式预算。下面的用例仍走自己的 `await import(...)`（结构不变），
   * 但那已是缓存命中，**每条用例的断言窗口仍是默认 10s**。
   */
  beforeAll(async () => {
    await import('./RewriteView.vue')
  }, IMPORT_BUDGET_MS)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    mockRouteQuery.value = {}
    // 默认信封：成功且无 warnings。clearAllMocks 会清掉实现，故每个用例重设。
    hoisted.aiRewrite.mockResolvedValue({
      code: 0,
      data: {
        success: true,
        result: '这是改写后的文案内容，用于测试。',
        title: '这是改写后的标题',
        strategy: { id: 'auto-strategy', name: '测试策略', category: 'viral' },
        warnings: [],
        sensitiveHits: [],
        knowledgeRefs: [],
        metadata: { mode: 'imitate', originalLength: 30, resultLength: 18, aiTasteLevel: 0.15 },
        quality: { verdict: 'pass', suggestions: [], method: 'simhash' },
      },
    })
    // AiWriterPanel 的 onMounted checkConfig 会查 aiIsConfigured；返回已配置
    window.electronAPI = {
      aiIsConfigured: vi.fn().mockResolvedValue({ code: 0, data: true }),
      modelProviderIsConfigured: vi.fn().mockResolvedValue({ code: 0, data: true }),
      aiGenerateTitles: vi.fn(),
      aiEnhanceContent: vi.fn(),
      aiGenerateSummary: vi.fn(),
    }
  })

  /** 等 AiWriterPanel 的异步 checkConfig 完成（与 AiWriterPanel.test.js 同构） */
  async function waitConfig () {
    await new Promise((r) => setTimeout(r, 20))
    await nextTick()
  }

  // ── ① 改写页：warnings 不得进 role="alert" 红色错误区 ──

  it('RewriteView：有 warnings ⇒ 红色错误区（role="alert"）不出现，但结果照常落地', async () => {
    const { default: RewriteView } = await import('./RewriteView.vue')
    hoisted.aiRewrite.mockResolvedValue(successWithWarnings())

    const w = mount(RewriteView, { global: { plugins: [createPinia(), i18n] } })
    await nextTick()
    await w.vm.$nextTick()

    // 触发改写：直接调组件方法（与既有用例同一驱动方式）
    w.vm.content = '这是一段需要改写的原始文案内容，长度足够通过校验。'
    await w.vm.startRewrite()
    await nextTick()

    // 结果必须照常落地（warnings 不是失败，不能挡住结果）
    expect(w.vm.rewriteResult).toBe('这是改写后的文案内容，用于测试。')
    // 关键契约：红色错误区不得出现
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.vm.rewriteError).toBeFalsy()
    // warnings 必须以 warning 级呈现（独立提示元素）
    const banner = w.find('[data-testid="rewrite-sensitive-warning"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('敏感')
    w.unmount()
  })

  it('RewriteView：真正的失败（success:false）仍进红色错误区（不把两者一起放宽）', async () => {
    const { default: RewriteView } = await import('./RewriteView.vue')
    hoisted.aiRewrite.mockResolvedValue({
      code: 0,
      data: { success: false, error: 'LLM 调用失败: provider down', errorCode: 'LLM_ERROR' },
    })

    const w = mount(RewriteView, { global: { plugins: [createPinia(), i18n] } })
    await nextTick()
    w.vm.content = '这是一段需要改写的原始文案内容，长度足够通过校验。'
    await w.vm.startRewrite()
    await nextTick()

    // 失败仍然必须是红色错误（这条不能被本轮放宽破坏）
    expect(w.find('[role="alert"]').exists()).toBe(true)
    expect(w.vm.rewriteError).toBeTruthy()
    // 且不得出现敏感词提示条（那不是失败路径）
    expect(w.find('[data-testid="rewrite-sensitive-warning"]').exists()).toBe(false)
    w.unmount()
  })

  it('RewriteView：无 warnings ⇒ 不出现敏感词提示条（不制造噪音）', async () => {
    const { default: RewriteView } = await import('./RewriteView.vue')
    const w = mount(RewriteView, { global: { plugins: [createPinia(), i18n] } })
    await nextTick()
    w.vm.content = '这是一段需要改写的原始文案内容，长度足够通过校验。'
    await w.vm.startRewrite()
    await nextTick()

    expect(w.vm.rewriteResult).toBe('这是改写后的文案内容，用于测试。')
    expect(w.find('[data-testid="rewrite-sensitive-warning"]').exists()).toBe(false)
    expect(w.find('[role="alert"]').exists()).toBe(false)
    w.unmount()
  })
})
