/**
 * BatchCollectPanel — 知乎收藏夹批量行为锁（自 Collection.test.js 迁入，collection-ui-refinement）
 *
 * 九条不可省（P0/QM-6 系列回归锁原样保留，断言对象从 w.vm.* 换为组件内部状态访问）：
 * ① 无 secret 必填提示；② 成功填充下拉；③ 失败错误提示；④ 空收藏夹提示；
 * ⑤ P0 字段不丢失（双层展开回归锁）；⑥ C2 已采集标记；⑦ unified 通道 + capped 提示；
 * ⑧ 新通道结果入库（QM-6 C1）；⑨ cancelZhihuFavBatch 通道存在。
 *
 * IPC 走真实 getApi() 桥（window.electronAPI 桩）—— 不 mock 组件内部函数。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

// 真实 electron-bridge 桥（getApi 返回 window.electronAPI），不 mock
vi.mock('@/api/publisher', () => ({
  storeSetSetting: vi.fn(async () => ({ code: 0 })),
}))

const BatchCollectPanel = (await import('./BatchCollectPanel.vue')).default

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      collection: {
        batchCollectTitle: '批量采集',
        rssBatch: 'RSS 批量采集',
        urlListBatch: 'URL 列表批量采集',
        rssPlaceholder: 'RSS 订阅源地址',
        urlListPlaceholder: '每行一个链接',
        urlListHint: '提示',
        batchCollect: '开始批量采集',
        batchCollecting: '批量采集中...',
        batchProgress: '批量采集进度',
        cancelBatch: '取消',
        zhihuFavlist: {
          title: '知乎收藏夹', secretPlaceholder: '访问密钥', loadBtn: '加载收藏夹', loading: '加载中',
          collectBtn: '采集', collecting: '采集中', rewriteBtn: '改写', rewriting: '改写中', hint: '提示',
          progressTitle: '采集并改写进度', progressText: '{done} / {total}',
          secretRequired: '请先填写知乎 Access Secret',
          loadFailed: '加载失败', empty: '没有收藏夹', emptyFavlist: '收藏夹没有内容',
          fetchingContents: '获取收藏内容...', collectingProgress: '共 {count} 条，采集中...',
          batchDone: '完成，成功 {completed} 失败 {failed}',
          batchDoneCancelledSuffix: '（已取消）', batchDoneCircuitBrokenSuffix: '（熔断）',
          noRewritable: '没有可改写的内容', rewritingProgress: '改写 {count} 条...',
          noSelection: '请先勾选要采集的内容',
          emptyItems: '收藏夹清单为空',
          fewerThanRequested: '实际获取 {actual} 条，少于申请的 {requested} 条',
          favlistsCapped: '收藏夹数量已达上限', fullModeCap: '全量模式单次最多 200 条',
          mappingMismatch: '进度汇总与实际产出不一致',
          expandDetail: '展开明细', collapseDetail: '收起明细',
        },
        zhihuFav: {
          scopeFavlist: '指定收藏夹', scopeAll: '全部收藏', countPlaceholder: '数量', fullMode: '全量',
          includeCollected: '包含已采集', loadContents: '加载内容', loadingContents: '加载中',
          selectAll: '全选', selectedCount: '已选 {count} 条', collectAndRewrite: '采集并改写',
          collecting: '采集中', markCollected: '已采集',
          progressSummary: '成功 {success} 失败 {failed} 跳过 {skipped} 改写失败 {rewriteFailed}',
          collectingNote: '采集 {url}', doneNote: '完成', registerOnlyNote: '仅登记',
          collectOkRewriteFailNote: '采集成功但改写失败', fallbackSuffix: '（{count} 张图片降级）',
          kindAnswer: '回答', kindArticle: '文章', kindColumn: '专栏', kindPin: '想法', kindVideo: '视频', kindUnknown: '未知',
        },
      },
    },
  },
})

function mountPanel (props = {}) {
  return mount(BatchCollectPanel, {
    global: { plugins: [i18n] },
    props: {
      collectedUrlSet: new Set(),
      categoryTagCtx: { knownCategoryKeys: [] },
      rewriteStyle: '轻松易懂',
      ...props,
    },
  })
}

/** 取组件内部 setup 状态（script setup 变量经 defineExpose 未导出的，走 vm 代理） */
function state (w, key, value) {
  if (value === undefined) return w.vm[key]
  w.vm[key] = value
}

describe('BatchCollectPanel 知乎收藏夹批量行为锁', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.electronAPI = {}
  })

  it('loadZhihuFavlists 无 secret → 显示必填提示，不发请求', async () => {
    window.electronAPI = { zhihuFavlistList: vi.fn() }
    const w = mountPanel()
    w.vm.zhihuAccessSecret = ''
    await w.vm.loadZhihuFavlists()
    expect(w.vm.zhihuFavlistError).toContain('Access Secret')
    expect(window.electronAPI.zhihuFavlistList).not.toHaveBeenCalled()
  })

  it('loadZhihuFavlists 成功 → 下拉数据填充', async () => {
    window.electronAPI = {
      zhihuFavlistList: vi.fn().mockResolvedValue({ code: 0, data: [
        { urlToken: 111, title: '收藏夹A', isPublic: true },
        { urlToken: 222, title: '收藏夹B', isPublic: false },
      ] }),
    }
    const w = mountPanel()
    w.vm.zhihuAccessSecret = 'my-secret'
    await w.vm.loadZhihuFavlists()
    await flushPromises()
    expect(w.vm.zhihuFavlists).toHaveLength(2)
    expect(w.vm.zhihuFavlists[0].title).toBe('收藏夹A')
    expect(w.vm.zhihuFavlistError).toBe('')
  })

  it('loadZhihuFavlists 失败 → 错误提示', async () => {
    window.electronAPI = {
      zhihuFavlistList: vi.fn().mockResolvedValue({ code: -1, message: '网络连接失败' }),
    }
    const w = mountPanel()
    w.vm.zhihuAccessSecret = 'secret'
    await w.vm.loadZhihuFavlists()
    await flushPromises()
    expect(w.vm.zhihuFavlistError).toContain('网络连接失败')
  })

  it('zhihuFavlistBatchCollect 空收藏夹 → 提示无内容', async () => {
    window.electronAPI = {
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [], totals: 0 } }),
    }
    const w = mountPanel()
    w.vm.zhihuSelectedFavlist = '111'
    await w.vm.zhihuFavlistBatchCollect()
    await flushPromises()
    expect(w.vm.zhihuFavlistError).toContain('没有内容')
  })

  it('zhihuFavlistBatchCollect 成功 → 结果 emit（P0 回归锁：字段不得丢失）', async () => {
    window.electronAPI = {
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [
        { url: 'https://zhuanlan.zhihu.com/p/1', title: '文章1' },
      ], totals: 1 } }),
      zhihuFavlistBatchCollect: vi.fn().mockResolvedValue({ code: 0, data: {
        completed: 1, failed: 0, cancelled: false, circuitBroken: false,
        results: [{ index: 0, ok: true, data: { success: true, title: '文章1', content: '正文内容' } }],
      } }),
    }
    const w = mountPanel()
    w.vm.zhihuSelectedFavlist = '111'
    await w.vm.zhihuFavlistBatchCollect()
    await flushPromises()
    expect(w.vm.zhihuFavlistResults).toHaveLength(1)
    expect(w.vm.zhihuFavlistProgress).toContain('成功 1')
    // P0 回归锁原样保留：emit 出的条目逐字段断言（父级原样入列表）
    const emitted = w.emitted('collected')[0][0]
    expect(emitted).toHaveLength(1)
    expect(emitted[0].title).toBe('文章1')
    expect(emitted[0].content).toBe('正文内容')
    expect(emitted[0].sourceUrl).toBe('https://zhuanlan.zhihu.com/p/1')
  })

  it('loadZhihuFavItems 指定收藏夹 → 清单渲染 + 已采集标记（C2）', async () => {
    window.electronAPI = {
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [
        { url: 'https://zhuanlan.zhihu.com/p/1', title: '甲', contentType: 'article', favTime: 1700000000 },
        { url: 'https://www.zhihu.com/pin/2', title: '乙', contentType: 'pin', favTime: 1700000001 },
      ], totals: 2 } }),
    }
    const w = mountPanel({ collectedUrlSet: new Set(['https://zhuanlan.zhihu.com/p/1']) })
    w.vm.zhihuFavlists = [{ urlToken: '111', title: '夹' }]
    w.vm.zhihuSelectedFavlist = '111'
    await w.vm.loadZhihuFavItems()
    await flushPromises()
    expect(w.vm.zhihuFavItems).toHaveLength(2)
    expect(w.vm.zhihuFavItems[0].collected).toBe(true)
    expect(w.vm.zhihuFavItems[1].collected).toBe(false)
  })

  it('loadZhihuFavItems 全部收藏 → unified-contents 通道 + favlistsCapped 提示', async () => {
    window.electronAPI = {
      zhihuFavlistUnifiedContents: vi.fn().mockResolvedValue({ code: 0, data: {
        items: [{ url: 'https://zhuanlan.zhihu.com/p/9', title: '统', kind: 'article', favTime: 5 }],
        truncated: false, totalBeforeCut: 1, favlistsCapped: true, fullModeCapped: false,
      } }),
    }
    const w = mountPanel()
    w.vm.zhihuFavlists = [{ urlToken: '111', title: '夹' }]
    w.vm.zhihuFavScope = 'all'
    await w.vm.loadZhihuFavItems()
    await flushPromises()
    expect(window.electronAPI.zhihuFavlistUnifiedContents).toHaveBeenCalled()
    expect(w.vm.zhihuFavItems).toHaveLength(1)
    expect(w.vm.zhihuFavScopeHint).toContain('50')
  })

  it('runZhihuFavCollectRewrite 成功 → 新通道结果 emit（含改写稿/图片字段，QM-6 C1）', async () => {
    window.electronAPI = {
      zhihuFavBatchRun: vi.fn().mockResolvedValue({ code: 0, data: {
        completed: 1, failed: 0, duplicateSkipped: 0, rewriteFailed: 0,
        cancelled: false, circuitBroken: false,
        results: [{ index: 0, ok: true, duplicate: false, data: {
          id: 'fb_1', title: '标题甲', content: '正文甲', coverImage: 'https://picx.zhimg.com/c.jpg',
          sourceUrl: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', favTime: 1,
          images: ['D:\\img\\a.jpg'], imageFallbacks: [], rewrittenContent: '改写稿甲', rewriteFailed: false,
        } }],
      } }),
      onZhihuFavBatchProgress: vi.fn(() => vi.fn()),
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [
        { url: 'https://zhuanlan.zhihu.com/p/1', title: '甲', kind: 'article', favTime: 1 },
      ], totals: 1 } }),
    }
    const w = mountPanel()
    w.vm.zhihuFavlists = [{ urlToken: '111', title: '夹' }]
    w.vm.zhihuSelectedFavlist = '111'
    w.vm.zhihuFavItems = [{ url: 'https://zhuanlan.zhihu.com/p/1', title: '甲', kind: 'article', favTime: 1, collected: false }]
    w.vm.zhihuFavChecked = new Set(['https://zhuanlan.zhihu.com/p/1'])
    await w.vm.runZhihuFavCollectRewrite()
    await flushPromises()
    const emitted = w.emitted('collected')[0][0]
    expect(emitted).toHaveLength(1)
    expect(emitted[0].title).toBe('标题甲')
    expect(emitted[0].content).toBe('正文甲')
    expect(emitted[0].sourceUrl).toBe('https://zhuanlan.zhihu.com/p/1')
    expect(emitted[0].rewrittenContent).toBe('改写稿甲')
    expect(emitted[0].images).toEqual(['D:\\img\\a.jpg'])
    // 清单已采集标记刷新（后台异步）
    await new Promise((r) => setTimeout(r, 0))
    expect(window.electronAPI.zhihuFavlistContents).toHaveBeenCalled()
  })

  it('runZhihuFavCollectRewrite 未勾选 → 提示', async () => {
    window.electronAPI = { onZhihuFavBatchProgress: vi.fn(() => vi.fn()) }
    const w = mountPanel()
    w.vm.zhihuFavItems = []
    await w.vm.runZhihuFavCollectRewrite()
    expect(w.vm.zhihuFavlistError).toContain('勾选')
  })

  it('QM-6 M2 回归锁：cancelZhihuFavBatch 必须存在且走 zhihuFavBatchCancel 通道', async () => {
    const cancelSpy = vi.fn().mockResolvedValue({ code: 0 })
    window.electronAPI = { onZhihuFavBatchProgress: vi.fn(() => vi.fn()), zhihuFavBatchCancel: cancelSpy }
    const w = mountPanel()
    expect(typeof w.vm.cancelZhihuFavBatch).toBe('function')
    w.vm.cancelZhihuFavBatch()
    await new Promise((r) => setTimeout(r, 0))
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('zhihuFavlistBatchRewrite 无可改写内容 → 提示', async () => {
    window.electronAPI = {}
    const w = mountPanel()
    w.vm.zhihuFavlistResults = []
    await w.vm.zhihuFavlistBatchRewrite()
    expect(w.vm.zhihuFavlistError).toContain('可改写')
  })
})
