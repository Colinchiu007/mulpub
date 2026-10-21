/**
 * BatchCollectPanel — 知乎收藏批量的字数区间契约（feat-zhihu-fav-batch-wordcount，2026-10-21）
 *
 * 缺口形态：知乎收藏批量面板**没有**字数区间入口，改写请求固定 `length:'keep'`
 * ⇒ 长度由 Python 的三档映射写死（目标 1500 / 区间 300-3000），用户改不了也看不见。
 *
 * 四条不可省：
 *  ① 面板出现字数区间输入，默认 800/2000（与采集页同默认）；
 *  ② 区间非法 ⇒ 红字提示 + 「采集并改写」按钮 disabled（与采集页同口径）；
 *  ③ 区间合法 ⇒ IPC payload 带 wordCountMin / wordCountMax；
 *  ④ 非法区间 ⇒ 早退不发 IPC（不发半坏的参数）。
 *
 * 独立于 BatchCollectPanel.test.js：那一份锁折叠分组与 testid 迁移红线，本份锁字数契约。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'

const zhihuFavBatchRun = vi.fn(async () => ({
  code: 0,
  data: { completed: 1, failed: 0, duplicateSkipped: 0, rewriteFailed: 0, results: [], overLimit: 0 },
}))

vi.mock('@/api/publisher', () => ({
  storeGetSettingResult: vi.fn(async () => ({ code: 0, data: null })),
  storeSetSetting: vi.fn(async () => ({ code: 0 })),
}))
vi.mock('@/api/electron-bridge', () => ({
  getApi: () => ({
    aggregationCollectBatch: vi.fn(),
    batchCollectProgress: vi.fn(() => () => {}),
    cancelBatchCollect: vi.fn(),
    zhihuGetConfig: vi.fn(async () => ({ code: 0, data: { configured: true, readable: true, source: 'safeStorage' } })),
    zhihuFavlistList: vi.fn(async () => ({ code: 0, data: [{ urlToken: 't1', title: '夹子A' }] })),
    zhihuFavlistContents: vi.fn(async () => ({ code: 0, data: { items: [{ url: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', title: '收藏一', favTime: 1 }] } })),
    zhihuFavBatchRun: (...args) => zhihuFavBatchRun(...args),
    zhihuFavBatchCancel: vi.fn(),
    onZhihuFavProgress: vi.fn(() => () => {}),
    onZhihuFavBatchProgress: vi.fn(() => () => {}),
    zhihuFavlistBatchCollect: vi.fn(),
    zhihuFavlistBatchRewrite: vi.fn(),
    zhihuFavlistBatchCancel: vi.fn(),
    onZhihuFavlistProgress: vi.fn(() => () => {}),
  }),
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
        batchGroupLabel: '批量采集方式',
        zhihuFavlist: { title: '知乎收藏夹', loadBtn: '加载收藏夹', loading: '加载中', collectBtn: '采集', collecting: '采集中', rewriteBtn: '改写', rewriting: '改写中', hint: '提示', progressTitle: '采集并改写进度', progressText: '{done} / {total}', progressSummary: '完成：成功 {success} · 失败 {failed} · 跳过重复 {skipped} · 改写失败 {rewriteFailed}', overLimitSuffix: '，其中 {count} 条超出设定上限', configBadge: '已配置', configNotConfigured: '未配置', configMissing: '请先在「设置 → 知乎 API」中配置 Access Secret', configUnreadable: '已保存的密钥无法读取', configLegacy: '旧版明文密钥，建议迁移', goSettings: '前往设置' },
        zhihuFav: { scopeFavlist: '指定收藏夹', scopeAll: '全部收藏', countPlaceholder: '数量', fullMode: '全量', includeCollected: '包含已采集', loadContents: '加载内容', loadingContents: '加载中', selectAll: '全选', selectedCount: '已选 {count} 条', collectAndRewrite: '采集并改写', collecting: '采集中', markCollected: '已采集', rewriteFailedBadge: '改写失败', rewrittenBadge: '已改写', imageFallbackBadge: '{count} 张图片降级' },
        wordCountLabel: '字数',
        wordCountMinPlaceholder: '最小（选填）',
        wordCountMaxPlaceholder: '最大（选填）',
        wordCountUnit: '字',
        wordCountMinInvalid: '最小字数需为 0-49999 的整数',
        wordCountMaxInvalid: '最大字数需为 1-50000 的整数',
        wordCountMaxLtMin: '最大字数不能小于最小字数',
        wordCountInvalid: '请先修正字数设置',
        batch: { selectedCount: '已选 {count} 条', publishImages: '发布图文', generateVideos: '生成视频', publishVideos: '发布视频', videoPlatformLabel: '视频平台', videoPoolNote: '{count} 条视频' },
        resultsEmptyTitle: '还没有采集结果',
        resultsEmptyDesc: '粘贴一条链接开始采集，或展开下方批量方式',
        resultsEmptyAction: '去采集',
      },
    },
  },
})

function mountPanel () {
  return mount(BatchCollectPanel, {
    global: { plugins: [i18n] },
    props: {
      collectedUrlSet: new Set(),
      categoryTagCtx: { knownCategoryKeys: [] },
      rewriteStyle: '轻松易懂',
    },
  })
}

/** 展开知乎分组 + 注入一条已勾选的收藏条目（面板内部态，省掉整条加载链） */
async function openZhihuWithItems (w) {
  await w.find('[data-testid="batch-group-title-zhihu"]').trigger('click')
  await nextTick()
  w.vm.zhihuFavItems = [{ url: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', title: '收藏一', favTime: 1 }]
  w.vm.zhihuFavChecked = new Set(['https://zhuanlan.zhihu.com/p/1'])
  await nextTick()
}

describe('知乎收藏批量 — 字数区间输入', () => {
  beforeEach(() => { zhihuFavBatchRun.mockClear() })

  it('面板出现字数区间输入，默认 800/2000', async () => {
    const w = mountPanel()
    await w.find('[data-testid="batch-group-title-zhihu"]').trigger('click')
    await nextTick()
    const inputs = w.findAll('input.word-count-input')
    expect(inputs.length).toBe(2)
    expect(Number(inputs[0].element.value)).toBe(800)
    expect(Number(inputs[1].element.value)).toBe(2000)
  })

  it('区间非法（max<min）⇒ 红字提示 + 「采集并改写」按钮 disabled', async () => {
    const w = mountPanel()
    await openZhihuWithItems(w)
    w.vm.zhihuFavWordCountMin = 6000
    w.vm.zhihuFavWordCountMax = 100
    await nextTick()
    expect(w.find('.word-count-error').exists()).toBe(true)
    expect(w.find('.word-count-error').text()).toContain('最大字数不能小于最小字数')
    const btn = w.find('[data-testid="zhihu-fav-collect-rewrite"]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('区间非法 ⇒ 不发 IPC（早退，不发半坏的参数）', async () => {
    const w = mountPanel()
    await openZhihuWithItems(w)
    w.vm.zhihuFavWordCountMin = 1.5
    w.vm.zhihuFavWordCountMax = 6000
    await nextTick()
    await w.vm.runZhihuFavCollectRewrite()
    expect(zhihuFavBatchRun).not.toHaveBeenCalled()
  })

  it('区间合法 ⇒ IPC payload 带 wordCountMin / wordCountMax', async () => {
    const w = mountPanel()
    await openZhihuWithItems(w)
    w.vm.zhihuFavWordCountMin = 0
    w.vm.zhihuFavWordCountMax = 6000
    await nextTick()
    await w.vm.runZhihuFavCollectRewrite()
    expect(zhihuFavBatchRun).toHaveBeenCalled()
    const payload = zhihuFavBatchRun.mock.calls[0][0]
    expect(payload.wordCountMin).toBe(0)
    expect(payload.wordCountMax).toBe(6000)
  })

  it('默认值（未动过）⇒ IPC payload 带 800/2000', async () => {
    const w = mountPanel()
    await openZhihuWithItems(w)
    await w.vm.runZhihuFavCollectRewrite()
    expect(zhihuFavBatchRun).toHaveBeenCalled()
    const payload = zhihuFavBatchRun.mock.calls[0][0]
    expect(payload.wordCountMin).toBe(800)
    expect(payload.wordCountMax).toBe(2000)
  })
})
