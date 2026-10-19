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
    // 2026-10-17 collection-page-ui-ue-refine：`is-primary` 是全仓零样式定义的**死类**
    // （分级在视觉上完全不成立），统一改为 col-btn--primary；「该类真有定义」由
    // collection-page-css-contract.test.js 的「消费⇒有定义」判据看守。
    expect(cls('draft')).toContain('col-btn--primary')
    expect(cls('publish')).toContain('col-btn--primary')
    expect(cls('view')).not.toContain('col-btn--primary')
    expect(cls('video')).not.toContain('col-btn--primary')
    // 死类不得复辟
    for (const id of ['draft', 'publish', 'view', 'video']) {
      expect(cls(id), `${id} 不得再用死类 is-primary`).not.toContain('is-primary')
      expect(cls(id), `${id} 不得再用死类 primary`).not.toMatch(/(^|\s)primary(\s|$)/)
    }
    expect(w.find('[data-testid="batch-item-check-a"]').exists()).toBe(true)
    expect(w.find('[data-testid="batch-item-check-b"]').exists()).toBe(true)
  })

  it('primary 档按钮在规范层有真实样式定义（不是死类占位）', () => {
    // 上一条只证明「class 名对」；这一条证明「class 名有样式」——
    // 正是 is-primary 缺陷的盲区（原测试只断类名、不断定义，所以分级失效三年没人发现）。
    const { readFileSync } = require('node:fs')
    const { join } = require('node:path')
    const pageCss = readFileSync(join(process.cwd(), 'src/features/collection/collection-page.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const primaryBody = /\.col-btn--primary\s*\{([^}]*)\}/.exec(pageCss)
    const secondaryBody = /\.col-btn--secondary\s*\{([^}]*)\}/.exec(pageCss)
    expect(primaryBody, 'col-btn--primary 应在规范层有定义').toBeTruthy()
    expect(secondaryBody, 'col-btn--secondary 应在规范层有定义').toBeTruthy()
    // primary 与 secondary 的声明必须真的不同（否则分级仍是假的）
    expect(primaryBody[1].trim()).not.toBe(secondaryBody[1].trim())
    expect(primaryBody[1]).toMatch(/background/)
    expect(secondaryBody[1]).toMatch(/border/)
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

  // ── 结果区可点性与改写失败可诊断（2026-10-17，change: collected-results-fix）──
  it('点卡片内容/图标 = 选中该条（emit select）——修「有链接光标但没反应」', async () => {
    const w = mountList()
    await w.find('[data-testid="card-info-a"]').trigger('click')
    expect(w.emitted('select')[0][0]).toMatchObject({ id: 'a' })
    await w.find('[data-testid="card-icon-b"]').trigger('click')
    expect(w.emitted('select')[1][0]).toMatchObject({ id: 'b' })
  })

  it('改写失败徽标带原因（rewriteError 内联 + title 悬停），改写成功徽标不带', () => {
    const w = mountList({
      items: [
        item('f', { rewriteFailed: true, rewriteError: 'connect ECONNREFUSED 127.0.0.1:8010' }),
        item('s', { rewrittenContent: '改写后的文字' }),
      ],
    })
    const fail = w.find('[data-testid="badge-rewrite-failed-f"]')
    expect(fail.exists()).toBe(true)
    expect(fail.text()).toContain('改写失败')
    expect(fail.text()).toContain('ECONNREFUSED')
    expect(fail.attributes('title')).toContain('ECONNREFUSED')
    // 成功条目不得带失败徽标（防旧数据误标）
    expect(w.find('[data-testid="badge-rewrite-failed-s"]').exists()).toBe(false)
  })
})
