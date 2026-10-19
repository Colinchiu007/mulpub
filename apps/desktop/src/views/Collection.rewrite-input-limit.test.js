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

  it('50001 字正文（超新上限）→ 截到 50000 码点并明确提示截断；原文不被改写', async () => {
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
    expect([...calls[0][0].content].length).toBe(REWRITE_ENGINE_MAX_INPUT_CHARS)
    expect(calls[0][0].content).toBe('字'.repeat(50000))
    expect(w.vm.rewriteResult).toBe('改写后的内容。')
    // 采集到的原文必须保持完整：截断只作用于改写入参，不得改写用户内容
    expect(w.vm.collectedResult.content).toBe(original)
    // 用户必须被告知「截断」而不是静默丢尾部
    const warned = warningTexts()
    expect(warned).toContain('50001')
    expect(warned).toContain('50000')
    expect(warned).toContain('截取')
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
})
