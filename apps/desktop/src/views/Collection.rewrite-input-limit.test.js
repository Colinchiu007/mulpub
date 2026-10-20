/**
 * 采集页「一键改写」输入上限回归锁（fix-collect-rewrite-too-long，2026-10-19）。
 *
 * 事故：知乎回答正文 6766 字 > 引擎入口 6000 码点上限 ⇒ 引擎返回 TOO_LONG；采集页漏斗
 * 把 IPC 信封原样透传给 formatUserError（只读顶层 errorCode/message）⇒ 用户只看到
 * 兜底「AI 改写失败」，真实原因完全不可见。
 *
 * 本文件独立于 Collection.test.js：后者已挂账接近行数容差，且本组断言描述的是
 * 「长文截断 + 引擎业务错误可诊断」这一条独立契约。
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
import { ElMessage } from 'element-plus'
import { REWRITE_ENGINE_MAX_INPUT_CHARS } from '@/utils/rewrite-engine-limits'

const ZHIHU_ANSWER_URL = 'https://www.zhihu.com/question/715577762/answer/2095239383058329672'

function mountCollection () {
  return mount(CollectionView, {
    global: { plugins: [createPinia(), i18n] },
  })
}

/** 知乎 stealth 采集通道 + 可指定正文长度的 aiRewrite mock */
function mockStealthApi (content, aiRewriteResult) {
  return {
    aggregationCollect: vi.fn(),
    aggregationRewrite: vi.fn(),
    aiRewrite: vi.fn().mockResolvedValue(aiRewriteResult),
    urlCollectNeedsStealth: vi.fn().mockResolvedValue({ code: 0, data: { needsStealth: true } }),
    urlCollectFetch: vi.fn().mockResolvedValue({
      code: 0,
      data: { title: '知乎回答标题', content, coverImage: '' },
    }),
  }
}

function warningTexts () {
  return ElMessage.warning.mock.calls.map((call) => String(call[0])).join('\n')
}

/** info 通道（分段改写提示走 info，不是 warning——它不是告警而是预期行为） */
function infoTexts () {
  return ElMessage.info.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('采集页一键改写 — 超长正文自动截取（fix-collect-rewrite-too-long）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  it('6766 字正文 → 新上限 50000 下不截断，原样送引擎（旧上限 6000 的回归锁）', async () => {
    const original = '字'.repeat(6766)
    window.electronAPI = mockStealthApi(original, {
      code: 0,
      data: { success: true, result: '改写后的内容。' },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL
    await w.vm.collectAndRewrite()

    const calls = window.electronAPI.aiRewrite.mock.calls
    expect(calls.length).toBe(1)
    // rewrite-limits-50000：6766 < 50000 ⇒ 不再截断（知乎长文完整改写）
    expect(calls[0][0].content).toBe(original)
    expect(w.vm.rewriteResult).toBe('改写后的内容。')
    expect(w.vm.collectedResult.content).toBe(original)
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })

  it('恰好 6000 码点 → 不截断、原样送引擎，不弹截断提示', async () => {
    const exact = '字'.repeat(6000)
    window.electronAPI = mockStealthApi(exact, {
      code: 0,
      data: { success: true, result: '改写后的内容。' },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL
    await w.vm.collectAndRewrite()

    expect(window.electronAPI.aiRewrite.mock.calls[0][0].content).toBe(exact)
    expect(ElMessage.warning).not.toHaveBeenCalled()
  })

  it('50001 字正文（超阈值）→ 透传全文给引擎（不预截断）并事前提示将分段改写', async () => {
    // rewrite-segment-and-finish-reason 第二刀：预截断会让超长正文永远到不了引擎的
    // 分段路径（评审 M1），故改为透传全文 + info 提示「将分段改写」。
    const original = '字'.repeat(50001)
    window.electronAPI = mockStealthApi(original, {
      code: 0,
      data: { success: true, result: '改写后的内容。' },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL
    await w.vm.collectAndRewrite()

    const calls = window.electronAPI.aiRewrite.mock.calls
    expect(calls.length).toBe(1)
    // 全文透传：一个码点都不少（这是分段路径可达的前提）
    expect([...calls[0][0].content].length).toBe(50001)
    expect(calls[0][0].content).toBe(original)
    expect(w.vm.rewriteResult).toBe('改写后的内容。')
    expect(w.vm.collectedResult.content).toBe(original)
    // 用户必须被事前告知「将分段改写」（含真实字数与阈值）
    const info = infoTexts()
    expect(info).toContain('50001')
    expect(info).toContain(String(REWRITE_ENGINE_MAX_INPUT_CHARS))
    expect(info).toContain('分段改写')
    // 不得再出现旧的「已截取前 N 字」承诺（两者对同一输入互相矛盾）
    expect(warningTexts()).not.toContain('截取')
  })

  it('引擎业务错误信封（TOO_LONG）→ 透出具体上限文案，不再回落「AI 改写失败」', async () => {
    window.electronAPI = mockStealthApi('字'.repeat(50000), {
      code: 0,
      data: { success: false, errorCode: 'TOO_LONG', error: '内容过长，最多 50000 字' },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL
    await w.vm.collectAndRewrite()

    expect(w.vm.rewriteResult).toBe('')
    expect(w.vm.rewriteError).toBeTruthy()
    expect(w.vm.rewriteError.message).toContain('50000')
    expect(w.vm.rewriteError.message).not.toBe('AI 改写失败')
    expect(ElMessage.error).toHaveBeenCalled()
  })

  it('rewriteViaEngine 归一化：引擎业务错误 → 稳定码 + {max} 参数（供 formatUserError 插值）', async () => {
    window.electronAPI = mockStealthApi('', {
      code: 0,
      data: { success: false, errorCode: 'TOO_LONG', error: '内容过长，最多 6000 字' },
    })
    const w = mountCollection()
    await nextTick()
    const r = await w.vm.rewriteViaEngine('字'.repeat(6000))
    expect(r.__error).toBeTruthy()
    expect(r.__error.errorCode).toBe('REWRITE_CONTENT_TOO_LONG')
    expect(r.__error.params).toEqual({ max: REWRITE_ENGINE_MAX_INPUT_CHARS })
  })

  it('IPC 层错误（code !== 0）仍按顶层 message 透传（不误伤既有形态）', async () => {
    window.electronAPI = mockStealthApi('', { code: -2, message: '改写服务不可用' })
    const w = mountCollection()
    await nextTick()
    const r = await w.vm.rewriteViaEngine('字'.repeat(100))
    expect(r.__error).toEqual({ code: -2, message: '改写服务不可用' })
  })

  // ── rewrite-segment-and-finish-reason 第二刀：meta 透传 + 分段失败文案 ──

  it('成功分支透传 meta 六字段（outputTruncated/outputLength/modelTruncated/segmented/truncatedSegments/wordCountRange）', async () => {
    // 评审 M5：成功分支历史上只挑 result_content/knowledgeRefs，引擎新增的可见字段被静默丢弃
    window.electronAPI = mockStealthApi('', {
      code: 0,
      data: {
        success: true,
        result: '改写后的内容。',
        outputTruncated: true,
        outputLength: 1234,
        modelTruncated: true,
        segmented: { enabled: true, segmentCount: 5, totalChars: 60000 },
        truncatedSegments: [3],
      },
    })
    const w = mountCollection()
    await nextTick()
    w.vm.rewriteWordCountMin = 0
    w.vm.rewriteWordCountMax = 6000
    const r = await w.vm.rewriteViaEngine('字'.repeat(100))
    expect(r.result_content).toBe('改写后的内容。')
    expect(r.meta).toEqual({
      outputTruncated: true,
      outputLength: 1234,
      modelTruncated: true,
      segmented: { enabled: true, segmentCount: 5, totalChars: 60000 },
      // fix-collection-rewrite-publish-flow（2026-10-20）新增两字段：
      // ① truncatedSegments：段级截断段号（引擎仅在分段路径且确有截断时给）——
      //    缺省归空数组，让派生函数统一按「整篇被截 / 部分段被截」两档展示；
      // ② wordCountRange：本次生效的字数区间——截断横幅的「上限」显示项必须用它，
      //    不能写死 6000（用户可填到 50000）。
      truncatedSegments: [3],
      wordCountRange: { min: 0, max: 6000 },
    })
  })

  it('成功但无可见字段 ⇒ meta 全部缺省化（不臆造 true，不炸旧信封）', async () => {
    window.electronAPI = mockStealthApi('', { code: 0, data: { success: true, result: '短结果。' } })
    const w = mountCollection()
    await nextTick()
    const r = await w.vm.rewriteViaEngine('字'.repeat(100))
    expect(r.meta).toEqual({
      outputTruncated: false,
      outputLength: undefined,
      modelTruncated: false,
      segmented: null,
      truncatedSegments: [],
      wordCountRange: { min: 800, max: 2000 },
    })
  })

  it('分段失败 ⇒ 映射 REWRITE_SEGMENT_FAILED 并带 1-based 段号（不编进 errorCode）', async () => {
    // 引擎返回底层稳定码 + 结构化段号；渲染层把段号抬进 params 并换成专用文案码
    window.electronAPI = mockStealthApi('', {
      code: 0,
      data: {
        success: false,
        errorCode: 'LLM_ERROR',
        error: '第 2/3 段改写失败，前面段的进度未保留',
        segmentIndex: 1,
        segmentCount: 3,
      },
    })
    const w = mountCollection()
    await nextTick()
    const r = await w.vm.rewriteViaEngine('字'.repeat(100))
    expect(r.__error.errorCode).toBe('REWRITE_SEGMENT_FAILED')
    expect(r.__error.params).toEqual({ index: 2, total: 3 })
  })
})
