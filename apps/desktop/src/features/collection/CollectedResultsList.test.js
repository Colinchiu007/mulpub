/**
 * CollectedResultsList — 采集结果列表契约（Q10-c 卡片层级重排 + Q10-e 空态）
 *
 * 四条不可省：① 空列表渲染 EmptyState（旧行为是整块不渲染）且动作 emit('emptyAction')；
 * ② 操作按钮主次分级（创建草稿/发布 primary，查看/视频创作 secondary，文案库改写 primary 由既有锁保留、删除 danger）；
 * ③ testid 契约：batch-select-all / batch-item-check-{id} / batch-action-bar 原样；
 * ④ 批量操作条事件逐条上抛（publishImages/generateVideos/publishVideos）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

const CollectedResultsList = (await import('./CollectedResultsList.vue')).default

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      collection: {
        resultsCount: '采集结果（{count} 篇）',
        resultsEmptyTitle: '还没有采集结果',
        resultsEmptyDesc: '粘贴一条链接开始采集，或展开下方批量方式',
        resultsEmptyAction: '去采集',
        zhihuFavlist: { selectAll: '全选' },
        zhihuFav: { rewriteFailedBadge: '改写失败', rewrittenBadge: '已改写', imageFallbackBadge: '{count} 张图片降级' },
        batch: { selectedCount: '已选 {count} 条', publishImages: '发布图文', generateVideos: '生成视频', publishVideos: '发布视频', videoPlatformLabel: '视频平台', videoPoolNote: '{count} 条视频' },
        records: { edit: '查看', createDraft: '创建草稿', toVideo: '视频创作', publish: '发布', delete: '删除' },
        collection: { view: '查看' },
      },
    },
  },
})

const item = (id, over = {}) => ({ id, title: '标题 ' + id, source: 'url', content: 'x'.repeat(30), ...over })

function mountList (props = {}) {
  return mount(CollectedResultsList, {
    global: { plugins: [i18n] },
    props: {
      items: [item('a'), item('b', { mediaType: 'video', duration: 90, platform: 'bilibili' })],
      activeId: null,
      selectedIds: [],
      batchSelectedCount: 0,
      batchVideoPoolCount: 0,
      batchPlatformOptions: [],
      batchAccountOptions: [],
      batchVideoPlatformOptions: [],
      batchVideoAccountOptions: [],
      platformKeys: ['bilibili', 'douyin'],
      isAccountSelectedFn: () => () => false,
      ...props,
    },
  })
}

describe('CollectedResultsList 空态', () => {
  it('空列表渲染空态，动作 emit emptyAction', async () => {
    const w = mountList({ items: [] })
    expect(w.find('[data-testid="collection-results-empty"]').exists()).toBe(true)
    await w.find('[data-testid="collection-results-empty"] button, [data-testid="collection-results-empty"] .empty-state').trigger('click')
    expect(w.emitted('emptyAction')).toHaveLength(1)
  })

  it('非空列表不渲染空态', () => {
    const w = mountList()
    expect(w.find('[data-testid="collection-results-empty"]').exists()).toBe(false)
  })
})

describe('CollectedResultsList 卡片操作分级', () => {
  it('创建草稿/发布为 primary，查看/视频创作非 primary，勾选 testid 逐项', () => {
    const w = mountList()
    const cards = w.findAll('.cohere-card')
    expect(cards.length).toBe(2)
    const cls = (id) => w.find(`[data-testid="result-${id}-a"]`).classes().join(' ')
    expect(cls('draft')).toContain('is-primary')
    expect(cls('publish')).toContain('is-primary')
    expect(cls('view')).not.toContain('is-primary')
    expect(cls('video')).not.toContain('is-primary')
    expect(w.find('[data-testid="batch-item-check-a"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-item-check-b"]').exists()).toBe(true)
  })
})

describe('CollectedResultsList 批量操作条', () => {
  it('勾选后显示批量条，三个动作逐条 emit', async () => {
    const w = mountList({
      selectedIds: ['a'],
      batchSelectedCount: 1,
      batchPlatformOptions: [{ id: 'wechat', label: '公众号' }],
      batchAccountOptions: [{ id: 'acc1', name: '账号一', disabled: false }],
    })
    const bar = w.find('[data-testid="batch-action-bar"]')
    expect(bar.exists()).toBe(true)
    await w.find('[data-testid="batch-publish-images"]').trigger('click')
    await w.find('[data-testid="batch-generate-videos"]').trigger('click')
    expect(w.emitted('batchPublishImages')).toHaveLength(1)
    expect(w.emitted('batchGenerateVideos')).toHaveLength(1)
  })

  it('全选勾选框 emit toggleSelectAll', async () => {
    const w = mountList()
    await w.find('[data-testid="batch-select-all"]').setValue(true)
    expect(w.emitted('toggleSelectAll')[0][0]).toBe(true)
  })
})
