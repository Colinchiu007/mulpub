/**
 * 采集页「一键改写」取消通道回归锁（rewrite-cancel-collection，2026-10-20）。
 *
 * 背景：#4078 把 `ai:rewrite-cancel` 通道建好，但只接到了改写页（RewriteView）。
 * 采集页四个改写入口（视频转写 / stealth 自动 / 普通采集 / 手动改写）仍然不可取消 ——
 * 而**采集页恰恰是 5 万字长文最常出现的入口**（知乎回答、公众号长文、视频转写），
 * 也正是最初报错（#3979）的那个页面。本文件锁住「取消在采集页真的能点、能生效、不误报错误」。
 *
 * 独立成文件：Collection.test.js 与 Collection.rewrite-input-limit.test.js 已接近行数容差，
 * 新增场景按被测能力分文件（TEST_LEDGER_GREW 口径）。
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

/** 知乎 stealth 采集通道 + 可控 aiRewrite / aiRewriteCancel */
function mockApi (opts = {}) {
  const content = opts.content != null ? opts.content : '采集到的正文内容，足够长以便改写。'
  return {
    aggregationCollect: vi.fn(),
    aggregationRewrite: vi.fn(),
    aiRewrite: opts.aiRewrite || vi.fn().mockResolvedValue({
      code: 0,
      data: { success: true, result: '改写后的内容。' },
    }),
    aiRewriteCancel: opts.aiRewriteCancel || vi.fn().mockResolvedValue({
      code: 0, data: { cancelled: true },
    }),
    urlCollectNeedsStealth: vi.fn().mockResolvedValue({ code: 0, data: { needsStealth: true } }),
    urlCollectFetch: vi.fn().mockResolvedValue({
      code: 0,
      data: { title: '知乎回答标题', content, coverImage: '' },
    }),
  }
}

describe('采集页改写取消通道（rewrite-cancel-collection）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    window.electronAPI = {}
  })

  it('手动改写：aiRewrite 收到本次 runId（取消的寻址前提）', async () => {
    window.electronAPI = mockApi()
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { title: 't', content: '正文内容足够长用来改写。' }
    await w.vm.rewriteCollected()

    expect(window.electronAPI.aiRewrite).toHaveBeenCalledTimes(1)
    const params = window.electronAPI.aiRewrite.mock.calls[0][0]
    expect(typeof params.runId).toBe('string')
    expect(params.runId.length).toBeGreaterThan(0)
    w.unmount()
  })

  it('改写进行中展示取消按钮；点击后调 aiRewriteCancel(runId) 并弹 info 不弹 error', async () => {
    // aiRewrite 永不 resolve ⇒ 保持 rewriting 态
    window.electronAPI = mockApi({ aiRewrite: vi.fn().mockReturnValue(new Promise(() => {})) })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { title: 't', content: '正文内容足够长用来改写。' }
    void w.vm.rewriteCollected()
    await nextTick()

    const cancelBtn = w.find('[data-testid="collection-rewrite-cancel-btn"]')
    expect(cancelBtn.exists()).toBe(true)

    const runId = window.electronAPI.aiRewrite.mock.calls[0][0].runId
    await cancelBtn.trigger('click')
    await flushPromises()

    expect(window.electronAPI.aiRewriteCancel).toHaveBeenCalledWith(runId)
    expect(ElMessage.info).toHaveBeenCalled()
    expect(ElMessage.error).not.toHaveBeenCalled()
    w.unmount()
  })

  it('引擎返回 CANCELLED ⇒ 不写 rewriteError、不弹错误、弹 info 提示代价', async () => {
    window.electronAPI = mockApi({
      aiRewrite: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          success: false,
          cancelled: true,
          errorCode: 'CANCELLED',
          error: '改写已取消（第 2/5 段开始前停止）',
          segmentCount: 5,
          completedSegments: 1,
        },
      }),
    })
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { title: 't', content: '正文内容足够长用来改写。' }
    await w.vm.rewriteCollected()

    // 取消是预期行为：不是错误
    expect(ElMessage.error).not.toHaveBeenCalled()
    expect(ElMessage.info).toHaveBeenCalled()
    expect(w.vm.rewriteError).toBeNull()
    // 不把取消当成功：结果区保持空
    expect(w.vm.rewriteResult).toBe('')
    w.unmount()
  })

  it('一键改写流程（采集+自动改写）进行中也能取消', async () => {
    window.electronAPI = mockApi({ aiRewrite: vi.fn().mockReturnValue(new Promise(() => {})) })
    const w = mountCollection()
    await nextTick()
    w.vm.linkUrl = ZHIHU_ANSWER_URL
    void w.vm.collectAndRewrite()
    // 等采集链路走完、进入改写阶段
    for (let i = 0; i < 8; i++) { await nextTick(); await Promise.resolve() }
    await nextTick()

    const cancelBtn = w.find('[data-testid="collection-rewrite-cancel-btn"]')
    expect(cancelBtn.exists()).toBe(true)
    w.unmount()
  })

  it('改写完成后取消按钮消失（不长期占位）', async () => {
    window.electronAPI = mockApi()
    const w = mountCollection()
    await nextTick()
    w.vm.collectedResult = { title: 't', content: '正文内容足够长用来改写。' }
    await w.vm.rewriteCollected()
    await nextTick()

    expect(w.find('[data-testid="collection-rewrite-cancel-btn"]').exists()).toBe(false)
    expect(w.vm.rewriteResult).toBe('改写后的内容。')
    w.unmount()
  })
})
