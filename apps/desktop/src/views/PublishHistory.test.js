import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import fs from 'node:fs'
import path from 'node:path'
import i18n from '@/i18n'

const historyListMock = vi.fn()
const draftListMock = vi.fn()
const pushMock = vi.fn()
const historyGetMock = vi.fn()
const historyDeleteMock = vi.fn()
const retryTaskMock = vi.fn()
// 卡片整体点击打开平台链接（PRD-PUBLISH-HISTORY-CARD-OPEN-LINK-2026-10-03）：
// 组件合同测 store.createTab 调用契约；store→pageManager 桥→IPC 的集成由
// Collection.test.js / Comments.test.js 与 tab store 自身测试覆盖。
const tabCreateTabMock = vi.fn()
vi.mock('@/stores/tab', () => ({
  useTabStore: () => ({ createTab: (...args) => tabCreateTabMock(...args) }),
}))

// 未登录门禁态测试：用 ref 驱动 isAuthenticated，可模拟「登录成功 → 自动重载」。
const identityAuthenticatedRef = ref(false)
const identitySignInMock = vi.fn(async () => true)
vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({
    isAuthenticated: identityAuthenticatedRef,
    signIn: (...args) => identitySignInMock(...args),
  }),
}))

vi.mock('@/api/publisher', () => ({
  historyList: (...args) => historyListMock(...args),
  historyGet: (...args) => historyGetMock(...args),
  historyDelete: (...args) => historyDeleteMock(...args),
  retryTask: (...args) => retryTaskMock(...args),
  draftList: (...args) => draftListMock(...args),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

// 批量删除走 confirmDanger 确认门禁（desktop-ui-consistency）；测试默认确认通过，
// 确认交互本身由 confirm-danger 契约测试与视觉回归覆盖。
const confirmDangerMock = vi.fn(async () => true)
vi.mock('@/utils/confirm-danger', () => ({
  confirmDanger: (...args) => confirmDangerMock(...args),
}))

// PublishHistory 已统一走 platformStore；mock 返回空值让组件回退到 PLATFORM_NAMES/PLATFORM_ICONS 与显式 contentType。
vi.mock('@/stores/platforms', () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    getLabel: () => '',
    getIcon: () => '',
    getContentCategory: () => 'ARTICLE',
  }),
}))

import PublishHistory from './PublishHistory.vue'

function mountView () {
  return mount(PublishHistory, { global: { plugins: [i18n] } })
}

async function flushHistory () {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

// M-11：筛选改动现在走 300ms 防抖（useDebouncedWatchSources 默认），所以改完筛选条件
// 必须**显式推进时间**才能等到补页加载。原 flushHistory 只 flush 微任务 —— 防抖前那够用，
// 防抖后不够。这里补一个真实等待，保持用例原有语义不变（不靠改断言绕过行为变更）。
//
// 之所以用真实等待而不是假定时器：本文件既有大量用例依赖真实微任务/宏任务交错，
// 假定时器会把它们一起改变。只在确需等防抖的两条用例里加这一步，影响面可控。
const FILTER_DEBOUNCE_MS = 300
async function flushFilterDebounce () {
  await new Promise((r) => setTimeout(r, FILTER_DEBOUNCE_MS + 80))
}

describe('PublishHistory', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
    historyListMock.mockReset().mockResolvedValue({
      code: 0,
      data: {
        total: 1,
        records: [{
          id: 'record-1',
          title: '已发布文章',
          platform: 'zhihu',
          status: 'success',
          timestamp: '2026-07-24T08:00:00.000Z',
          publisher: '秋叔',
          contentType: 'video',
          publishMode: 'rpa',
          accountCount: 1,
          taskCount: 1,
          failedCount: 0,
          views: 120,
          comments: 4,
          likes: 8,
          favorites: 2,
          shares: 3,
        }],
      },
    })
    historyGetMock.mockReset().mockResolvedValue({ code: 0, data: {} })
    historyDeleteMock.mockReset().mockResolvedValue({ code: 0, data: { deleted: 1 } })
    retryTaskMock.mockReset().mockResolvedValue({ code: 0 })
    identityAuthenticatedRef.value = false
    identitySignInMock.mockClear()
    draftListMock.mockReset().mockResolvedValue({
      code: 0,
      data: [{ id: 'draft-1', title: '待完成草稿', created_at: '2026-07-23T08:00:00.000Z' }],
    })
  })

  it('默认加载发布记录并展示平台和状态', async () => {
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    expect(historyListMock).toHaveBeenCalledWith({ limit: 50, offset: 0 })
    expect(wrapper.text()).toContain('发布记录')
    expect(wrapper.text()).toContain('已发布文章')
    expect(wrapper.text()).toContain('知乎')
    expect(wrapper.text()).toContain('发布成功')
  })

  it('提供参考产品对齐的搜索、四类筛选、视图切换和导出工具', async () => {
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    expect(wrapper.get('[data-testid="history-search"]').attributes('placeholder')).toContain('搜索作品描述或任务标题')
    expect(wrapper.get('[data-testid="publisher-filter"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="content-type-filter"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="status-filter"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="publish-mode-filter"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="view-grid"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-testid="view-list"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="export-history"]').text()).toContain('导出')
  })

  it('发布记录标签提供面板关联、roving tabindex 和方向键切换', async () => {
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    const recordsTab = wrapper.get('[data-testid="records-tab"]')
    const draftsTab = wrapper.get('[data-testid="drafts-tab"]')
    expect(recordsTab.attributes('aria-controls')).toBe('records-panel')
    expect(recordsTab.attributes('tabindex')).toBe('0')
    expect(draftsTab.attributes('aria-controls')).toBe('drafts-panel')
    expect(draftsTab.attributes('tabindex')).toBe('-1')

    await recordsTab.trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect(draftsTab.attributes('aria-selected')).toBe('true')
    expect(draftListMock).toHaveBeenCalledTimes(1)
  })

  it('展示服务端总数并使用 offset 加载剩余发布记录', async () => {
    historyListMock
      .mockResolvedValueOnce({
        code: 0,
        data: {
          total: 75,
          records: [{ id: 'page-1', title: '第一页', platform: 'zhihu', status: 'success' }],
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          total: 75,
          records: [{ id: 'page-2', title: '第二页', platform: 'weibo', status: 'success' }],
        },
      })

    const wrapper = mountView()
    await nextTick()
    await nextTick()

    expect(wrapper.text()).toContain('75 条发布任务')
    expect(wrapper.findAll('.record-card')).toHaveLength(1)
    await wrapper.get('[data-testid="load-more-history"]').trigger('click')
    await nextTick()
    await nextTick()

    expect(historyListMock).toHaveBeenNthCalledWith(2, { limit: 50, offset: 1 })
    expect(wrapper.findAll('.record-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('第二页')
  })


  it('平台和时间筛选与参考产品工具栏一致', async () => {
    historyListMock.mockResolvedValue({ code: 0, data: { records: [
      { id: 'today', title: '今天记录', platform: 'zhihu', status: 'success', timestamp: new Date().toISOString() },
      { id: 'old', title: '旧记录', platform: 'weibo', status: 'success', timestamp: '2020-01-01T00:00:00.000Z' },
    ] } })
    const wrapper = mountView()
    await nextTick()
    await nextTick()
    await wrapper.get('[data-testid="platform-filter"]').setValue('zhihu')
    expect(wrapper.findAll('.record-card')).toHaveLength(1)
    await wrapper.get('[data-testid="platform-filter"]').setValue('')
    await wrapper.get('[data-testid="date-filter"]').setValue('today')
    expect(wrapper.findAll('.record-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('今天记录')
  })

  it('记录详情弹窗读取历史详情，失败记录支持重试', async () => {
    historyGetMock.mockResolvedValue({ code: 0, data: { description: '详情正文' } })
    retryTaskMock.mockResolvedValue({ code: 0 })
    historyListMock.mockResolvedValue({ code: 0, data: { records: [{ id: 'failed-1', taskId: 'task-1', title: '失败任务', platform: 'zhihu', status: 'failed' }] } })
    const wrapper = mountView()
    await nextTick()
    await nextTick()
    await wrapper.get('[data-testid="detail-failed-1"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(historyGetMock).toHaveBeenCalledWith('failed-1')
    expect(wrapper.get('.record-detail-modal').text()).toContain('详情正文')
    await wrapper.get('[data-testid="close-record-detail"]').trigger('click')
    await wrapper.get('[data-testid="retry-failed-1"]').trigger('click')
    await nextTick()
    expect(retryTaskMock).toHaveBeenCalledWith('task-1')
  })

  it('列表展示发布人、内容属性和完整统计字段', async () => {
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    expect(wrapper.text()).toContain('秋叔')
    expect(wrapper.text()).toContain('账号数')
    expect(wrapper.text()).toContain('任务数')
    expect(wrapper.text()).toContain('失败')
    expect(wrapper.text()).toContain('播放')
    expect(wrapper.text()).toContain('评论')
    expect(wrapper.text()).toContain('点赞')
    expect(wrapper.text()).toContain('收藏')
    expect(wrapper.text()).toContain('分享')
    expect(wrapper.text()).toContain('120')
  })

  it('详情弹窗显示参考产品记录统计和发布配置字段', async () => {
    historyGetMock.mockResolvedValue({
      code: 0,
      data: {
        description: '详情正文',
        contentType: 'video',
        publishMode: 'scheduled',
        accountCount: 2,
        taskCount: 3,
        failedCount: 1,
        views: 120,
        comments: 4,
        likes: 8,
        favorites: 2,
        shares: 3,
      },
    })
    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="detail-record-1"]').trigger('click')
    await flushHistory()

    const detail = wrapper.get('.record-detail-modal').text()
    expect(detail).toContain('内容类型')
    expect(detail).toContain('视频')
    expect(detail).toContain('发布模式')
    expect(detail).toContain('定时发布')
    expect(detail).toContain('账号数')
    expect(detail).toContain('2')
    expect(detail).toContain('任务数')
    expect(detail).toContain('3')
    expect(detail).toContain('失败')
    expect(detail).toContain('播放')
    expect(detail).toContain('120')
    expect(detail).toContain('详情正文')
  })
  it('详情弹窗展示发布方式、作品 ID 与作品链接', async () => {
    historyListMock.mockReset().mockResolvedValue({
      code: 0,
      data: {
        total: 1,
        records: [{ id: 'detail-mode', title: 'API 发布', platform: 'baijiahao', status: 'success', result: { mode: 'api', postId: 'post-998', url: 'https://baijiahao.baidu.com/s?id=9987654321' } }],
      },
    })
    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="detail-detail-mode"]').trigger('click')
    await flushHistory()
    const detail = wrapper.get('.record-detail-modal')
    expect(detail.text()).toContain('发布方式')
    expect(detail.text()).toContain('API 直连')
    expect(detail.text()).toContain('post-998')
    expect(detail.get('[data-testid="detail-link"]').attributes('href')).toBe('https://baijiahao.baidu.com/s?id=9987654321')
    expect(detail.get('[data-testid="detail-link"]').attributes('rel')).toBe('noopener')
  })
  it('详情里的历史 url 非 http/https 时不产出锚点，改渲染纯文本（PRD-HREF-SCHEME-GUARD）', async () => {
    historyListMock.mockReset().mockResolvedValue({
      code: 0,
      data: {
        total: 1,
        records: [{ id: 'detail-evil', title: '被污染的历史', platform: 'baijiahao', status: 'success', result: { mode: 'api', postId: 'p-1', url: 'javascript:alert(1)' } }],
      },
    })
    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="detail-detail-evil"]').trigger('click')
    await flushHistory()
    const detail = wrapper.get('.record-detail-modal')
    expect(detail.find('[data-testid="detail-link"]').exists()).toBe(false)
    expect(detail.get('[data-testid="detail-link-plain"]').text()).toBe('javascript:alert(1)')
    expect(detail.html()).not.toContain('href="javascript')
  })
  it('详情弹窗无 result 时不渲染发布方式/作品ID/链接行', async () => {
    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="detail-record-1"]').trigger('click')
    await flushHistory()
    const detail = wrapper.get('.record-detail-modal')
    expect(detail.text()).not.toContain('发布方式')
    expect(detail.find('[data-testid="detail-link"]').exists()).toBe(false)
  })
  it('失败记录在列表卡片显示失败原因（error 字段）', async () => {
    historyListMock.mockReset().mockResolvedValue({
      code: 0,
      data: {
        total: 1,
        records: [{
          id: 'failed-err-1', taskId: 'task-err-1', title: '失败任务', platform: 'zhihu',
          status: 'failed', error: 'publish timeout',
        }],
      },
    })
    const wrapper = mountView()
    await flushHistory()
    expect(wrapper.get('[data-testid="record-error-failed-err-1"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="record-error-failed-err-1"]').text()).toContain('publish timeout')
  })
  it('成功记录不渲染失败原因行', async () => {
    const wrapper = mountView()
    await flushHistory()
    expect(wrapper.find('[data-testid="record-error-record-1"]').exists()).toBe(false)
  })
  it('详情弹窗显示失败原因字段（error 字段）', async () => {
    historyListMock.mockReset().mockResolvedValue({
      code: 0,
      data: {
        total: 1,
        records: [{
          id: 'failed-err-2', taskId: 'task-err-2', title: '失败任务', platform: 'kuaishou',
          status: 'failed', error: 'publish verification timeout',
        }],
      },
    })
    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="detail-failed-err-2"]').trigger('click')
    await flushHistory()
    const detail = wrapper.get('.record-detail-modal')
    expect(detail.text()).toContain('失败原因')
    expect(detail.get('[data-testid="detail-error-reason"]').text()).toContain('publish verification timeout')
  })
  it('详情弹窗失败记录无 error 字段时显示占位文案而非空白', async () => {
    historyListMock.mockReset().mockResolvedValue({
      code: 0,
      data: {
        total: 1,
        records: [{ id: 'failed-noerr', taskId: 'task-noerr', title: '失败任务', platform: 'zhihu', status: 'failed' }],
      },
    })
    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="detail-failed-noerr"]').trigger('click')
    await flushHistory()
    const detail = wrapper.get('.record-detail-modal')
    expect(detail.text()).toContain('失败原因')
    expect(detail.get('[data-testid="detail-error-reason"]').text()).not.toBe('')
  })
  it('搜索和状态筛选只保留匹配记录', async () => {
    historyListMock.mockResolvedValue({
      code: 0,
      data: {
        records: [
          { id: 'ok', title: '正常发布', platform: 'zhihu', status: 'success' },
          { id: 'failed', title: '需要重试', platform: 'weibo', status: 'failed' },
        ],
      },
    })
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    await wrapper.get('[data-testid="history-search"]').setValue('重试')
    expect(wrapper.findAll('.record-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('需要重试')

    await wrapper.get('[data-testid="history-search"]').setValue('')
    await wrapper.get('[data-testid="status-filter"]').setValue('failed')
    expect(wrapper.findAll('.record-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('需要重试')
  })

  it('筛选时补取后续页，避免遗漏第 51 条以后的记录', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: `first-${index}`,
      title: `第一页记录 ${index}`,
      platform: 'zhihu',
      status: 'success',
    }))
    historyListMock
      .mockResolvedValueOnce({ code: 0, data: { total: 51, records: firstPage } })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          total: 51,
          records: [{ id: 'second-page-match', title: '第二页唯一待重试记录', platform: 'weibo', status: 'failed' }],
        },
      })

    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="history-search"]').setValue('唯一待重试')
    await flushHistory()
    await flushFilterDebounce()

    expect(historyListMock).toHaveBeenNthCalledWith(2, { limit: 50, offset: 50 })
    expect(wrapper.findAll('.record-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('第二页唯一待重试记录')

    await wrapper.get('[data-testid="history-search"]').setValue('')
    await wrapper.get('[data-testid="status-filter"]').setValue('failed')
    await flushHistory()
    await flushFilterDebounce()
    expect(wrapper.findAll('.record-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('第二页唯一待重试记录')
  })

  it('筛选补页遇到重复响应时停止，避免无限请求和重复记录', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: `repeat-${index}`,
      title: `重复页记录 ${index}`,
      platform: 'zhihu',
      status: 'success',
    }))
    historyListMock
      .mockResolvedValueOnce({ code: 0, data: { total: 100, records: firstPage } })
      .mockResolvedValue({ code: 0, data: { total: 100, records: firstPage } })

    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="history-search"]').setValue('重复页')
    await flushHistory()
    await flushFilterDebounce()

    expect(historyListMock).toHaveBeenCalledTimes(2)
    expect(historyListMock).toHaveBeenNthCalledWith(2, { limit: 50, offset: 50 })
    expect(wrapper.findAll('.record-card')).toHaveLength(50)
    expect(wrapper.find('[data-testid="load-more-history"]').exists()).toBe(false)
  })

  it('网格与列表视图使用稳定的显式模式类', async () => {
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    await wrapper.get('[data-testid="view-grid"]').trigger('click')
    expect(wrapper.get('.record-list').classes()).toContain('grid-view')
    expect(wrapper.get('[data-testid="view-grid"]').attributes('aria-pressed')).toBe('true')
  })

  it('空记录时用 EmptyState 提供新建发布入口并打开发布类型选择', async () => {
    historyListMock.mockResolvedValue({ code: 0, data: { total: 0, records: [] } })
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    // 空态统一走 EmptyState（T0-3）：标题取 i18n，CTA 复用页面原有「新建发布」流程
    const empty = wrapper.get('[data-testid="publish-history-empty"]')
    expect(empty.classes()).toContain('mp-empty-state')
    expect(empty.get('.mp-empty-state__title').text()).toBe(i18n.global.t('publishHistory.empty.records.title'))
    expect(empty.get('.mp-empty-state__hint').text()).toBe(i18n.global.t('publishHistory.empty.records.message'))

    await empty.get('button.mp-empty-state__action').trigger('click')
    expect(wrapper.get('[data-testid="publish-type-dialog"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="publish-type-dialog-title"]').text()).toBe('选择发布类型')
    expect(wrapper.findAll('[data-testid^="publish-type-card-"]')).toHaveLength(2)
  })

  it('有记录但筛选无结果时用紧凑空态提供清空筛选 CTA', async () => {
    const wrapper = mountView()
    await flushHistory()
    await wrapper.get('[data-testid="history-search"]').setValue('不存在的标题')

    const filtered = wrapper.get('[data-testid="publish-history-filter-empty"]')
    expect(filtered.classes()).toContain('mp-empty-state--compact')
    expect(wrapper.find('[data-testid="publish-history-empty"]').exists()).toBe(false)

    await filtered.get('button.mp-empty-state__action').trigger('click')
    expect(wrapper.get('[data-testid="history-search"]').element.value).toBe('')
  })

  it('草稿为空时渲染 EmptyState，有草稿时不渲染', async () => {
    draftListMock.mockResolvedValue({ code: 0, data: [] })
    const wrapper = mountView()
    await nextTick()
    await wrapper.get('[data-testid="drafts-tab"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="publish-history-drafts-empty"]').exists()).toBe(true)

    draftListMock.mockResolvedValue({ code: 0, data: [{ id: 'd1', title: '草稿一', updated_at: '2026-09-01 10:00:00' }] })
    await wrapper.get('[data-testid="refresh-drafts"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="publish-history-drafts-empty"]').exists()).toBe(false)
    expect(wrapper.findAll('.draft-card')).toHaveLength(1)
  })

  it('加载失败时显示错误并允许重试', async () => {
    historyListMock.mockRejectedValueOnce(new Error('history unavailable'))
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    expect(wrapper.text()).toContain('发布记录加载失败')
    expect(wrapper.text()).toContain('请检查服务连接后重试')
    expect(wrapper.text()).not.toContain('history unavailable')
    historyListMock.mockResolvedValue({ code: 0, data: { total: 0, records: [] } })
    await wrapper.get('[data-testid="retry-history"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(historyListMock).toHaveBeenCalledTimes(2)
  })

  it('未登录被门禁拒绝（AUTH_REQUIRED）时显示登录引导，而不是服务连接失败', async () => {
    historyListMock.mockResolvedValueOnce({
      code: -3,
      errorCode: 'AUTH_REQUIRED',
      message: '当前许可证无权访问该功能，请先登录并确认账号已开通所需权益后重试。',
    })
    const wrapper = mountView()
    await flushHistory()

    expect(wrapper.find('[data-testid="history-login-gate"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('登录后查看发布记录')
    expect(wrapper.text()).toContain('去登录')
    expect(wrapper.text()).not.toContain('发布记录加载失败')
    expect(wrapper.text()).not.toContain('请检查服务连接后重试')
    expect(wrapper.find('[data-testid="retry-history"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('点击去登录触发 identity.signIn，登录成功后自动重载发布记录', async () => {
    historyListMock.mockResolvedValueOnce({ code: -3, errorCode: 'AUTH_REQUIRED', message: 'auth required' })
    const wrapper = mountView()
    await flushHistory()
    expect(wrapper.find('[data-testid="history-login-gate"]').exists()).toBe(true)

    await wrapper.get('[data-testid="history-sign-in"]').trigger('click')
    expect(identitySignInMock).toHaveBeenCalledTimes(1)

    identityAuthenticatedRef.value = true
    await flushHistory()
    expect(historyListMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="history-login-gate"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已发布文章')
    wrapper.unmount()
  })

  it('登录后权益不足（ENTITLEMENT_REQUIRED）显示具体原因，不误报服务连接失败', async () => {
    historyListMock.mockResolvedValueOnce({
      code: -3,
      errorCode: 'ENTITLEMENT_REQUIRED',
      message: '当前账号没有所需权益，无法使用该功能。请升级或开通对应权益后重试。',
    })
    const wrapper = mountView()
    await flushHistory()

    expect(wrapper.find('[data-testid="history-login-gate"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('发布记录加载失败')
    // formatUserError 按运行语言映射权益文案（zh/en），两语言任一命中即算具体原因
    const text = wrapper.text()
    expect(
      text.includes('当前账号没有所需权益') || text.includes('does not have the required plan'),
    ).toBe(true)
    expect(text).not.toContain('请检查服务连接后重试')
    expect(wrapper.find('[data-testid="retry-history"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('切换草稿箱后加载草稿，并进入编辑器继续编辑', async () => {
    const wrapper = mountView()
    await nextTick()
    await wrapper.get('[data-testid="drafts-tab"]').trigger('click')
    await nextTick()
    await nextTick()

    expect(draftListMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('待完成草稿')
    await wrapper.get('[data-testid="edit-draft-draft-1"]').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/publish?draft=draft-1')
  })

  it('新建发布先选择类型，再带类型进入编辑器', async () => {
    const wrapper = mountView()
    await nextTick()
    await wrapper.get('[data-testid="new-publish"]').trigger('click')
    await wrapper.get('[data-testid="publish-type-card-video"]').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/publish?type=video')
    expect(wrapper.find('[data-testid="publish-type-dialog"]').exists()).toBe(false)
  })

  it('批量管理支持选择、全选和取消选择', async () => {
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    await wrapper.get('[data-testid="start-selection"]').trigger('click')
    const checkboxes = wrapper.findAll('.record-selector input')
    expect(checkboxes).toHaveLength(1)

    await checkboxes[0].setValue(true)
    expect(wrapper.text()).toContain('已选择 1 项')

    const cancelAll = wrapper.findAll('button').find(button => button.text() === '取消全选')
    expect(cancelAll).toBeDefined()
    await cancelAll.trigger('click')
    expect(wrapper.text()).toContain('已选择 0 项')

    const cancelSelection = wrapper.findAll('button').find(button => button.text() === '取消选择')
    await cancelSelection.trigger('click')
    expect(wrapper.find('.record-selector').exists()).toBe(false)
  })

  it('批量管理支持删除选中的发布记录并刷新列表', async () => {
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    await wrapper.get('[data-testid="start-selection"]').trigger('click')
    await wrapper.get('.record-selector input').setValue(true)
    const deleteButton = wrapper.findAll('.selection-toolbar .toolbar-button').find(button => button.text().includes('删除'))

    expect(deleteButton).toBeDefined()
    expect(deleteButton.attributes('disabled')).toBeUndefined()
    await deleteButton.trigger('click')

    // 危险操作确认门禁：必须先经 confirmDanger 且文案携带影响条数
    expect(confirmDangerMock).toHaveBeenCalledTimes(1)
    const dangerOptions = confirmDangerMock.mock.calls[0][0]
    expect(dangerOptions.message).toContain('1')

    expect(historyDeleteMock).toHaveBeenCalledWith(['record-1'])
    expect(historyListMock).toHaveBeenLastCalledWith({ limit: 50, offset: 0 })
    expect(wrapper.text()).toContain('已选择 0 项')
  })

  it('批量删除在用户取消确认时不执行且保留选择集', async () => {
    confirmDangerMock.mockResolvedValueOnce(false)
    const wrapper = mountView()
    await nextTick()
    await nextTick()

    await wrapper.get('[data-testid="start-selection"]').trigger('click')
    await wrapper.get('.record-selector input').setValue(true)
    const deleteButton = wrapper.findAll('.selection-toolbar .toolbar-button').find(button => button.text().includes('删除'))
    await deleteButton.trigger('click')

    expect(confirmDangerMock).toHaveBeenCalledTimes(1)
    expect(historyDeleteMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已选择 1 项')
  })

  it('移动端记录主体使用可收缩布局，批量复选框不会撑出卡片', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/views/PublishHistory.vue'), 'utf8')
    const mobileStyles = source.slice(source.indexOf('@media (max-width: 720px)'))
    const recordMainRule = mobileStyles.match(/\.record-main\s*\{([^}]+)\}/)?.[1] || ''

    expect(recordMainRule).toMatch(/width:\s*auto/)
    expect(recordMainRule).toMatch(/flex:\s*1\s+1\s+0/)
    expect(recordMainRule).not.toMatch(/calc\(/)
  })
})

describe('PublishHistory 发布方式徽标（§6.1）', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
    identityAuthenticatedRef.value = false
  })

  async function mountWithMode (mode) {
    historyListMock.mockReset().mockResolvedValue({
      code: 0,
      data: {
        total: 1,
        records: [{
          id: 'rec-mode', title: '图文文章', platform: 'baijiahao', status: 'success',
          timestamp: '2026-09-23T08:00:00.000Z',
          ...(mode ? { result: { mode } } : {}),
        }],
      },
    })
    const wrapper = mount(PublishHistory, { global: { plugins: [i18n] } })
    await flushPromises()
    await nextTick()
    return wrapper
  }

  it('record.result.mode=api 显示「API 直连」徽标', async () => {
    const wrapper = await mountWithMode('api')
    const badge = wrapper.find('[data-testid="delivery-mode-rec-mode"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('API 直连')
  })

  it('record.result.mode=dom 显示「RPA 浏览器」徽标', async () => {
    const wrapper = await mountWithMode('dom')
    expect(wrapper.find('[data-testid="delivery-mode-rec-mode"]').text()).toContain('RPA 浏览器')
  })

  it('record.result.mode=fallback 显示「降级发布」徽标（第三态）', async () => {
    const wrapper = await mountWithMode('fallback')
    const badge = wrapper.find('[data-testid="delivery-mode-rec-mode"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('降级发布')
    expect(badge.classes()).toContain('delivery-mode-fallback')
  })

  it('无 result.mode 不显示发布方式徽标', async () => {
    const wrapper = await mountWithMode(null)
    expect(wrapper.find('[data-testid="delivery-mode-rec-mode"]').exists()).toBe(false)
  })

  // P0-1 审核状态：发布成功只代表平台受理，之后仍可能被拒/下线——
  // 历史列表与详情必须如实显示平台审核结论，拒绝/下线醒目提示；
  // 无结论（旧记录/监控无定论）不渲染徽标（不得用「无徽标」伪装成「已通过」）。
  describe('P0-1 审核状态展示', () => {
    async function mountWithAudit (record) {
      historyListMock.mockResolvedValue({ code: 0, data: { total: 1, records: [record] } })
      const wrapper = mountView()
      await flushHistory()
      return wrapper
    }
    const base = { id: 'audit-1', title: '审核跟踪', platform: 'douyin', status: 'success', timestamp: '2026-10-09T00:00:00.000Z' }

    it('拒绝（deny）显示醒目审核徽标 + 处置指引', async () => {
      const wrapper = await mountWithAudit({ ...base, auditStatus: 'deny' })
      const badge = wrapper.get('[data-testid="audit-status-audit-1"]')
      expect(badge.text()).toBe('审核未通过')
      expect(badge.classes()).toContain('is-alert')
      expect(badge.attributes('title')).toContain('创作者中心')
    })

    it('已上线（published）显示中性徽标（不醒目）', async () => {
      const wrapper = await mountWithAudit({ ...base, auditStatus: 'published' })
      const badge = wrapper.get('[data-testid="audit-status-audit-1"]')
      expect(badge.text()).toBe('已上线')
      expect(badge.classes()).not.toContain('is-alert')
    })

    it.each([
      ['inAudit', '审核中'],
      ['prePublish', '待发布'],
      ['notPublic', '未公开'],
      ['withdrawn', '已下线'],
      ['transferFail', '转码失败'],
    ])('审核状态 %s → 文案「%s」', async (auditStatus, label) => {
      const wrapper = await mountWithAudit({ ...base, auditStatus })
      expect(wrapper.get('[data-testid="audit-status-audit-1"]').text()).toBe(label)
    })

    it('拒绝/下线/转码失败三条为醒目态，其余不是', async () => {
      for (const [status, alert] of [['deny', true], ['withdrawn', true], ['transferFail', true], ['published', false], ['inAudit', false], ['prePublish', false], ['notPublic', false]]) {
        const wrapper = await mountWithAudit({ ...base, auditStatus: status })
        const badge = wrapper.get('[data-testid="audit-status-audit-1"]')
        expect(badge.classes().includes('is-alert'), status).toBe(alert)
      }
    })

    it('无审核结论/非法值不渲染徽标（不伪造已通过）', async () => {
      for (const auditStatus of [undefined, null, '', 'bogus', 'unknown']) {
        const wrapper = await mountWithAudit({ ...base, ...(auditStatus === undefined ? {} : { auditStatus }) })
        expect(wrapper.find('[data-testid="audit-status-audit-1"]').exists(), String(auditStatus)).toBe(false)
      }
    })

    it('详情弹窗显示审核状态 + 平台作品 ID', async () => {
      historyGetMock.mockResolvedValue({ code: 0, data: { description: '详情' } })
      const wrapper = await mountWithAudit({
        ...base, auditStatus: 'withdrawn', platformWorkId: 'aweme-777',
        taskId: 't-1', accountCount: 1, taskCount: 1, failedCount: 0,
      })
      await wrapper.get('[data-testid="detail-audit-1"]').trigger('click')
      await flushHistory()
      const modal = wrapper.get('.record-detail-modal')
      expect(modal.text()).toContain('审核状态')
      expect(modal.text()).toContain('已下线')
      expect(modal.text()).toContain('平台作品 ID')
      expect(modal.text()).toContain('aweme-777')
    })
  })
})

// ── PRD-PUBLISH-HISTORY-CARD-OPEN-LINK-2026-10-03：卡片整体点击打开平台链接 ──
// 判据单一来源：safeHttpUrl（渲染端 ESM 孪生）；打开通道：tabStore.createTab
// （page-manager 应用内新标签）→ 失败降级 window.open（主进程 isAllowedExternalUrl 更严判据兜底）。
describe('PublishHistory 发布记录卡片点击打开平台链接', () => {
  // PRD-PUBLISH-HISTORY-PUBLIC-LINK-2026-10-07 §8.3 修正说明：
  // 旧夹具 CARD_URL 用的是 `https://www.zhihu.com/question/123456`（**问题页**，不是内容页），
  // 它之所以能通过，正说明旧判据只查协议、不查目的地——这正是本 Bug 的逃逸口。
  // 现改为真正的公开内容页，并由新增的 V2（后台页 + postId → 派生）与之构成对照。
  const CARD_URL = 'https://zhuanlan.zhihu.com/p/123456789'

  // 组件合同测 store.createTab 调用契约（vi.mock('@/stores/tab') 注入 tabCreateTabMock）；
  // store→pageManager 桥→IPC 的集成由 Collection.test.js / Comments.test.js 与 tab store 自身测试覆盖。
  async function mountWithRecords (records) {
    historyListMock.mockReset().mockResolvedValue({ code: 0, data: { total: records.length, records } })
    const wrapper = mountView()
    await flushHistory()
    return wrapper
  }

  const successRecord = (extra = {}) => ({
    id: 'card-1', title: '已发布文章', platform: 'zhihu', status: 'success',
    timestamp: '2026-07-24T08:00:00.000Z', publisher: '秋叔', contentType: 'article',
    result: { url: CARD_URL }, ...extra,
  })

  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
    identityAuthenticatedRef.value = false
    tabCreateTabMock.mockReset().mockResolvedValue('btab-9')
  })

  it('T1 点击卡片主体在新标签页打开平台链接（应用内 page-manager 标签）', async () => {
    const wrapper = await mountWithRecords([successRecord()])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).toHaveBeenCalledTimes(1)
    expect(tabCreateTabMock).toHaveBeenCalledWith({
      url: CARD_URL,
      platform: 'zhihu',
      title: '作品 · 已发布文章',
    })
  })

  it('T2 点击卡片内「详情」按钮不触发打开（弹窗照常）', async () => {
    const wrapper = await mountWithRecords([successRecord()])
    await wrapper.get(`[data-testid="detail-card-1"]`).trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).not.toHaveBeenCalled()
    expect(wrapper.find('.record-detail-modal').exists()).toBe(true)
  })

  it('T3 点击卡片内「重试」按钮不触发打开（重试照常）', async () => {
    const wrapper = await mountWithRecords([successRecord({ status: 'failed', error: '上传超时' })])
    await wrapper.get(`[data-testid="retry-card-1"]`).trigger('click')
    await flushHistory()
    expect(retryTaskMock).toHaveBeenCalledTimes(1)
    expect(tabCreateTabMock).not.toHaveBeenCalled()
  })

  it('T4 批量管理模式下点击卡片不打开链接', async () => {
    const wrapper = await mountWithRecords([successRecord()])
    await wrapper.get('[data-testid="start-selection"]').trigger('click')
    await wrapper.find('.record-card').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).not.toHaveBeenCalled()
  })

  it.each([
    ['无 result', successRecord({ result: undefined })],
    ['result.url 缺失', successRecord({ result: { mode: 'api' } })],
    ['javascript: 协议', successRecord({ result: { url: 'javascript:alert(1)' } })],
    ['缺协议域名', successRecord({ result: { url: 'example.com/xxx' } })],
    ['协议相对地址', successRecord({ result: { url: '//evil.example.com/x' } })],
    ['url 非字符串', successRecord({ result: { url: 12345 } })],
  ])('T5-T7 %s：点击卡片不产出任何打开行为', async (_name, record) => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = await mountWithRecords([record])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('T8 创建成功显示提示文案', async () => {
    const wrapper = await mountWithRecords([successRecord()])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(wrapper.text()).toContain('已在新标签页打开作品链接')
  })

  it('T9-T10 createTab 返回空（含桥异常被 store 吞掉的合同形态）降级 window.open', async () => {
    tabCreateTabMock.mockResolvedValue(null)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = await mountWithRecords([successRecord()])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledWith(CARD_URL, '_blank')
    openSpy.mockRestore()
  })

  it('T10b createTab promise 拒绝（合同外漂移）显示失败提示且无未捕获异常', async () => {
    tabCreateTabMock.mockRejectedValue(new Error('unexpected store drift'))
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = await mountWithRecords([successRecord()])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(wrapper.text()).toContain('打开作品链接失败，请重试')
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('T11-T12 可点/不可点卡片的悬浮提示如实呈现', async () => {
    const wrapper = await mountWithRecords([
      successRecord(),
      successRecord({ id: 'card-2', title: '无链接记录', result: undefined }),
    ])
    const cards = wrapper.findAll('.record-card')
    expect(cards[0].attributes('title')).toBe('点击打开平台作品链接')
    expect(cards[1].attributes('title')).toBe('暂无平台公开链接')
  })

  it('T13 同一卡片进行中重复点击不重复发请求', async () => {
    let resolveCreate
    tabCreateTabMock.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve }))
    const wrapper = await mountWithRecords([successRecord()])
    const card = wrapper.find('.record-card')
    await card.trigger('click')
    await card.trigger('click')
    resolveCreate('btab-9')
    await flushHistory()
    expect(tabCreateTabMock).toHaveBeenCalledTimes(1)
  })

  it('T14 详情弹窗作品链接锚点保持 safeHttpUrl 判据与 noopener（回归）', async () => {
    const wrapper = await mountWithRecords([successRecord()])
    await wrapper.get(`[data-testid="detail-card-1"]`).trigger('click')
    await flushHistory()
    const link = wrapper.get('[data-testid="detail-link"]')
    expect(link.attributes('href')).toBe(CARD_URL)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })
})

// ── PRD-PUBLISH-HISTORY-PUBLIC-LINK-2026-10-07：作品链接的**目的地**判据 ──
// 用户报障：发布记录里已成功的记录，点链接打开的是**登录页**而不是作品内容页。
// 根因：落库的 result.url 是 RPA 会话所在的后台页，旧判据只查协议不查目的地。
// 本组用例第一次真正覆盖这个缺口：V2/V3/V4/V6 全部以「合法 http 的后台页 URL」为输入。
describe('PublishHistory 作品链接必须落到平台公开内容页', () => {
  const CONSOLE_URL = 'https://creator.xiaohongshu.com/publish/publish'
  const XHS_NOTE_ID = '6530a1b2c3d4e5f600112233'
  const XHS_PUBLIC = `https://www.xiaohongshu.com/explore/${XHS_NOTE_ID}`

  const record = (extra = {}) => ({
    id: 'pl-1', title: '已发布笔记', platform: 'xiaohongshu', status: 'success',
    timestamp: '2026-07-24T08:00:00.000Z', publisher: '秋叔', contentType: 'image',
    result: { url: CONSOLE_URL, postId: XHS_NOTE_ID }, ...extra,
  })

  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
    tabCreateTabMock.mockResolvedValue('btab-1')
    identityAuthenticatedRef.value = true
  })

  async function mountRecords (records) {
    historyListMock.mockReset().mockResolvedValue({ code: 0, data: { total: records.length, records } })
    const wrapper = mountView()
    await flushHistory()
    return wrapper
  }

  async function openDetail (wrapper, id) {
    await wrapper.get(`[data-testid="detail-${id}"]`).trigger('click')
    await flushHistory()
  }

  it('V2 后台页 + 合法作品 ID ⇒ 打开的是派生出的公开内容页，而不是后台页', async () => {
    const wrapper = await mountRecords([record()])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).toHaveBeenCalledTimes(1)
    const [arg] = tabCreateTabMock.mock.calls[0]
    expect(arg.url).toBe(XHS_PUBLIC)
    // 核心反证：绝不能把创作者后台页当作品链接交出去
    expect(arg.url).not.toBe(CONSOLE_URL)
  })

  it('V3 只有后台页、无作品 ID ⇒ 卡片不可点，不产出任何打开行为', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = await mountRecords([record({ result: { url: CONSOLE_URL } })])
    // 2026-10-15：无链接的原因必须分态。这条是「有后台页、但没有作品 ID」⇒ 走
    // cardNoLinkNoPostId（旧断言用的笼统 cardNoLinkHint 无法区分「平台没有公开页」
    // 与「这次没抓到 ID」，而后者是真缺陷、可修）。
    expect(wrapper.find('.record-card').attributes('title')).toBe('本次发布未获取到作品 ID，无法定位公开链接')
    expect(wrapper.find('.record-card').classes()).not.toContain('is-clickable')
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('V4 作品 ID 是合成值（published-xxx）⇒ 不构造必然 404 的链接', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = await mountRecords([record({ result: { url: CONSOLE_URL, postId: 'published-lz3k9x' } })])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('V5 详情弹窗：derived ⇒ 锚点 href 为派生值 + 标注来源', async () => {
    const wrapper = await mountRecords([record()])
    await openDetail(wrapper, 'pl-1')
    const link = wrapper.get('[data-testid="detail-link"]')
    expect(link.attributes('href')).toBe(XHS_PUBLIC)
    expect(link.text()).toBe(XHS_PUBLIC)
    expect(wrapper.get('[data-testid="detail-link-derived-hint"]').text()).toBe('由平台作品 ID 推导生成')
    expect(wrapper.find('[data-testid="detail-link-loginwall-hint"]').exists()).toBe(false)
  })

  it('V6 详情弹窗：无法解析出公开内容页 ⇒ 纯文本 + 登录说明，**不渲染 <a>**', async () => {
    const wrapper = await mountRecords([record({ result: { url: CONSOLE_URL } })])
    await openDetail(wrapper, 'pl-1')
    expect(wrapper.find('[data-testid="detail-link"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="detail-link-plain"]').text()).toBe(CONSOLE_URL)
    expect(wrapper.get('[data-testid="detail-link-loginwall-hint"]').text())
      .toBe('以下为发布时页面地址（需登录平台查看）')
  })

  it('V7 详情弹窗：只记录了作品 ID、无链接记录 ⇒ 占位文案而非留空白', async () => {
    // 公众号：永久链接需 __biz+mid+idx+sn 四元组，只有 mid 派生不出公开页（PRD §6.3）
    const wrapper = await mountRecords([record({
      platform: 'wechat_mp',
      result: { mode: 'api', postId: '1000000001' },
    })])
    await openDetail(wrapper, 'pl-1')
    expect(wrapper.find('[data-testid="detail-link"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="detail-link-absent"]').text()).toBe('未记录作品链接')
  })

  it('V8 详情弹窗：recorded 本身是公开内容页 ⇒ 原样使用且不标「推导」', async () => {
    const url = 'https://www.bilibili.com/video/BV1xx411c7mD'
    const wrapper = await mountRecords([record({ platform: 'bilibili', result: { url } })])
    await openDetail(wrapper, 'pl-1')
    expect(wrapper.get('[data-testid="detail-link"]').attributes('href')).toBe(url)
    expect(wrapper.find('[data-testid="detail-link-derived-hint"]').exists()).toBe(false)
  })

  it('V11 platformWorkId 作为历史记录的作品 ID 回退来源（审核回写落库的锚点）', async () => {
    const wrapper = await mountRecords([record({ result: { url: CONSOLE_URL }, platformWorkId: XHS_NOTE_ID })])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).toHaveBeenCalledTimes(1)
    expect(tabCreateTabMock.mock.calls[0][0].url).toBe(XHS_PUBLIC)
  })

  it('V12 结构性不可派生平台（视频号）⇒ 如实不给链接', async () => {
    const wrapper = await mountRecords([record({
      platform: 'tencent_video',
      result: { url: 'https://channels.weixin.qq.com/platform/post/create', postId: '1000000001' },
    })])
    // 2026-10-15：结构性无公开页的平台要有**专属**文案（旧断言用笼统 cardNoLinkHint，
    // 用户看不出「这个平台本来就没有网页版」与「我们抓漏了」的区别）。
    expect(wrapper.find('.record-card').attributes('title')).toBe('该平台不提供网页端公开链接（内容仅在客户端内可见）')
    await openDetail(wrapper, 'pl-1')
    expect(wrapper.find('[data-testid="detail-link"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="detail-link-loginwall-hint"]').exists()).toBe(true)
  })

  // F1（QM-6 评审 upheld，PR #3155 裁决书）：完全无链接证据（无 url、无 postId、
  // 无 platformWorkId）的记录，「作品链接」行也必须渲染——显示「未记录作品链接」
  // 占位，与 PRD §7.2「none+无 recordedUrl → detailLinkAbsent」承诺一致。
  // 旧实现三项皆假时整行不渲染，占位文案落空。
  it('F1 完全无链接证据的记录 ⇒ 「作品链接」行仍渲染并显示占位文案', async () => {
    const wrapper = await mountRecords([record({ result: {} })])
    await openDetail(wrapper, 'pl-1')
    expect(wrapper.find('[data-testid="detail-link"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="detail-link-plain"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="detail-link-absent"]').text()).toBe('未记录作品链接')
  })

  // F2（QM-6 upheld）：带 query 的真实内容页（分享链接普遍形态）不得被错杀——
  // 旧判据锚定 pathname+search 结尾，?from=share 直接判非内容页，recorded 来源
  // 被整条丢弃，用户看到「暂无公开链接」而非可点的真链接。
  it('F2 带 query 的内容页 ⇒ recorded 原样采用', async () => {
    const shared = 'https://zhuanlan.zhihu.com/p/123456789?from=share'
    const wrapper = await mountRecords([record({
      platform: 'zhihu',
      result: { url: shared, postId: '123456789' },
    })])
    await wrapper.find('.record-title-row h2').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).toHaveBeenCalledTimes(1)
    expect(tabCreateTabMock.mock.calls[0][0].url).toBe(shared)
  })
})

// 2026-10-12 用户报障「发布的历史记录页，发布任务的缩略图好像不是发布的真实封面图片」：
// 写侧从来不落封面键（已在 phase4-events 补齐），读侧 `thumbnailUrl` 恒空 → 回退平台图标。
// 本组锁读侧的渲染契约：本地 cover_path 经 cover:read-data 转 dataURL、远程 cover_url
// 过协议判据、都拿不到时回退平台图标（不渲染破图）。
describe('PublishHistory — 真实封面缩略图（2026-10-12）', () => {
  const originalElectronAPI = globalThis.window ? window.electronAPI : undefined

  afterEach(() => {
    if (globalThis.window) window.electronAPI = originalElectronAPI
  })

  function recordWithCover (extra) {
    return {
      id: 'cover-1',
      title: '带封面的发布',
      platform: 'zhihu',
      status: 'success',
      timestamp: '2026-10-12T00:00:00.000Z',
      ...extra,
    }
  }

  async function mountWithRecord (record) {
    historyListMock.mockReset().mockResolvedValue({
      code: 0,
      data: { total: 1, records: [record] },
    })
    const wrapper = mountView()
    await flushHistory()
    return wrapper
  }

  it('本地 cover_path 经 cover:read-data 转 dataURL 渲染真实封面（不直接拿路径当 src）', async () => {
    const readCoverData = vi.fn(async () => ({ code: 0, data: { dataUrl: 'data:image/png;base64,REALCOVER' } }))
    window.electronAPI = { readCoverData }

    const wrapper = await mountWithRecord(recordWithCover({ cover_path: 'D:/covers/real.png' }))
    await flushHistory()

    expect(readCoverData).toHaveBeenCalledWith('D:/covers/real.png')
    const img = wrapper.find('.record-preview img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('data:image/png;base64,REALCOVER')
  })

  it('远程 cover_url 直接渲染', async () => {
    window.electronAPI = { readCoverData: vi.fn() }

    const wrapper = await mountWithRecord(recordWithCover({ cover_url: 'https://cdn.example.com/remote.png' }))

    const img = wrapper.find('.record-preview img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('https://cdn.example.com/remote.png')
    expect(window.electronAPI.readCoverData).not.toHaveBeenCalled()
  })

  it('本地封面读取失败时回退（不渲染破图）', async () => {
    window.electronAPI = { readCoverData: vi.fn(async () => ({ code: -1, message: '读取失败' })) }

    const wrapper = await mountWithRecord(recordWithCover({ cover_path: 'D:/covers/broken.png' }))
    await flushHistory()

    // 回退到平台图标/占位，而不是渲染一个 src 是本地路径的破图
    const preview = wrapper.find('.record-preview')
    expect(preview.exists()).toBe(true)
    expect(preview.find('img[src^="D:"]').exists()).toBe(false)
  })

  it('非 http(s) 的封面 URL 不产出锚点式破图（回退平台图标）', async () => {
    window.electronAPI = { readCoverData: vi.fn() }

    const wrapper = await mountWithRecord(recordWithCover({ cover_url: 'javascript:alert(1)' }))

    expect(wrapper.find('.record-preview img[src^="javascript"]').exists()).toBe(false)
  })

  it('存量记录（无任何封面键）行为不变：回退平台图标', async () => {
    window.electronAPI = { readCoverData: vi.fn() }

    const wrapper = await mountWithRecord(recordWithCover({}))

    expect(wrapper.find('.record-preview').exists()).toBe(true)
    expect(window.electronAPI.readCoverData).not.toHaveBeenCalled()
  })
})

// 2026-10-14 用户要求「发布记录列表的缩略图，目前是横版尺寸，改成竖屏的尺寸显示（3:4比例）」。
// 本组锁**四个断面的比例契约**——只锁比例不锁具体像素，是为了将来调尺寸不必改测试：
//   ① 列表视图（默认）     ② 网格视图（viewMode=grid）③ 窄屏 720px ④ 窄屏 460px
// 判据读**组件自身的 scoped CSS 原文**（与「移动端记录主体使用可收缩布局」用例同一范式），
// 因为 jsdom 不布局：width/height 的计算值在这里恒为 0，量渲染结果等于什么都没量。
describe('PublishHistory — 缩略图竖屏 3:4 比例（2026-10-14）', () => {
  const SOURCE = fs.readFileSync(path.resolve(process.cwd(), 'src/views/PublishHistory.vue'), 'utf8')

  /** 取某段 CSS 文本里 `.record-preview { ... }` 的声明体；取不到即空串（断言随之转红） */
  function previewRule (css) {
    return css.match(/\.record-preview\s*\{([^}]+)\}/)?.[1] || ''
  }

  /** 从声明体里读 width / height / flex-basis 的**第一个**长度值（px 优先） */
  function pxOf (rule, prop) {
    const m = rule.match(new RegExp(`${prop}\\s*:\\s*([^;}]+)`))
    if (!m) return null
    const px = m[1].match(/(\d+(?:\.\d+)?)px/)
    return px ? Number(px[1]) : null
  }

  /** 比例判据：3:4 ⇒ 宽/高 === 0.75；容差 1e-6（浮点误差） */
  function expectPortraitRatio (rule, label) {
    const w = pxOf(rule, 'width')
    const h = pxOf(rule, 'height')
    expect(w, `${label}: width 缺失或非 px`).not.toBeNull()
    expect(h, `${label}: height 缺失或非 px`).not.toBeNull()
    expect(w / h, `${label}: 宽高比应为 3:4（实际 ${w}x${h}）`).toBeCloseTo(0.75, 6)
    // flex-basis 必须与 width 同源，否则窄容器下 flex 收缩会让实际比例漂回横版
    const basis = pxOf(rule, 'flex-basis')
    expect(basis, `${label}: flex-basis 缺失或非 px`).not.toBeNull()
    expect(basis, `${label}: flex-basis 必须等于 width`).toBe(w)
  }

  it('列表视图缩略图为竖屏 3:4', () => {
    const baseCss = SOURCE.slice(SOURCE.indexOf('.record-preview {'))
    expectPortraitRatio(previewRule(baseCss), '列表视图')
  })

  it('网格视图缩略图同样为竖屏 3:4', () => {
    const gridCss = SOURCE.slice(SOURCE.indexOf('.grid-view .record-preview'))
    expectPortraitRatio(previewRule(gridCss), '网格视图')
  })

  it('720px 窄屏缩略图为竖屏 3:4', () => {
    const narrow = SOURCE.slice(SOURCE.indexOf('@media (max-width: 720px)'))
    expectPortraitRatio(previewRule(narrow), '720px 窄屏')
  })

  it('460px 窄屏缩略图为竖屏 3:4', () => {
    const narrow = SOURCE.slice(SOURCE.indexOf('@media (max-width: 460px)'))
    expectPortraitRatio(previewRule(narrow), '460px 窄屏')
  })

  it('四处断面一律不得再出现横版比例（16:9 量级）', () => {
    // 横版判据：宽明显大于高。这是把「改成竖屏」翻译成可机械断言的补集 ——
    // 只断言四处是 3:4 而不断言「别处没有横版」，挡不住有人在响应式块里
    // 另起一条 .record-preview 覆盖（那会让上面四条全绿而实际仍是横版）。
    const sections = [
      ['列表视图', SOURCE.slice(SOURCE.indexOf('.record-preview {'))],
      ['网格视图', SOURCE.slice(SOURCE.indexOf('.grid-view .record-preview'))],
      ['720px 窄屏', SOURCE.slice(SOURCE.indexOf('@media (max-width: 720px)'))],
      ['460px 窄屏', SOURCE.slice(SOURCE.indexOf('@media (max-width: 460px)'))],
    ]
    const ruleRe = /\.record-preview\s*\{([^}]+)\}/g
    for (const [label, css] of sections) {
      let m
      while ((m = ruleRe.exec(css)) !== null) {
        const rule = m[1]
        const w = pxOf(rule, 'width')
        const h = pxOf(rule, 'height')
        if (w === null || h === null) continue
        expect(w, `${label}: 发现横版比例 ${w}x${h}（width > height）`).toBeLessThanOrEqual(h)
      }
    }
  })
})

// ── 「再次发布」+ 同批徽标 + 无链接原因三态 ──
// PRD-PUBLISH-RECORD-REPUBLISH-2026-10-15 §5.1 / §5.2.3 / §5.3
describe('PublishHistory「再次发布」与批次/链接原因', () => {
  function recordsPage (records) {
    historyListMock.mockReset().mockResolvedValue({ code: 0, data: { total: records.length, records } })
  }

  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
    historyGetMock.mockReset().mockResolvedValue({ code: 0, data: {} })
    retryTaskMock.mockReset().mockResolvedValue({ code: 0 })
    draftListMock.mockReset().mockResolvedValue({ code: 0, data: [] })
    identityAuthenticatedRef.value = false
  })

  it('有快照时「再次发布」可点，并跳到发布页的 republish 入口', async () => {
    recordsPage([{ id: 'rec-snap', title: '标题', platform: 'zhihu', status: 'success', hasRepublishSnapshot: true }])
    const wrapper = mountView()
    await flushHistory()

    const button = wrapper.get('[data-testid="republish-rec-snap"]')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.attributes('title')).toBe(i18n.global.t('historyPage.republishHint'))

    await button.trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/publish?republish=rec-snap')
  })

  it('早期记录没有快照：按钮禁用且悬停说明原因（不隐藏、不静默）', async () => {
    recordsPage([{ id: 'rec-old', title: '标题', platform: 'zhihu', status: 'success' }])
    const wrapper = mountView()
    await flushHistory()

    const button = wrapper.get('[data-testid="republish-rec-old"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toBe(i18n.global.t('historyPage.republishUnavailable'))

    await button.trigger('click')
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('hasRepublishSnapshot 必须是严格 true 才算有快照（字符串真值不算）', async () => {
    recordsPage([{ id: 'rec-str', title: '标题', platform: 'zhihu', status: 'success', hasRepublishSnapshot: 'true' }])
    const wrapper = mountView()
    await flushHistory()
    expect(wrapper.get('[data-testid="republish-rec-str"]').attributes('disabled')).toBeDefined()
  })

  it('同批 ≥2 条记录渲染批次徽标并列出平台；单条不渲染', async () => {
    recordsPage([
      { id: 'b1', title: '标题一', platform: 'zhihu', status: 'success', batchId: 'batch_x' },
      { id: 'b2', title: '标题二', platform: 'douyin', status: 'success', batchId: 'batch_x' },
      { id: 'alone', title: '标题三', platform: 'weibo', status: 'success', batchId: 'batch_y' },
      { id: 'none', title: '标题四', platform: 'toutiao', status: 'success' },
    ])
    const wrapper = mountView()
    await flushHistory()

    expect(wrapper.get('[data-testid="batch-b1"]').text()).toBe(i18n.global.t('historyPage.batchBadge', { count: 2 }))
    expect(wrapper.get('[data-testid="batch-b2"]').attributes('title')).toContain('知乎')
    expect(wrapper.find('[data-testid="batch-alone"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="batch-none"]').exists()).toBe(false)
  })

  it('无链接原因三态：草稿 / 平台结构性无公开页 / 未抓到作品 ID', async () => {
    recordsPage([
      { id: 'r-draft', title: '草稿', platform: 'xiaohongshu', status: 'success', result: { draft: true } },
      { id: 'r-struct', title: '视频号', platform: 'tencent_video', status: 'success', result: { url: 'https://channels.weixin.qq.com/x' } },
      { id: 'r-noid', title: '抖音', platform: 'douyin', status: 'success', result: { url: 'https://creator.douyin.com/creator-micro/content/manage' } },
      { id: 'r-empty', title: '空', platform: 'toutiao', status: 'success', result: {} },
    ])
    const wrapper = mountView()
    await flushHistory()

    const hintOf = (id) => wrapper.get(`[data-testid="republish-${id}"]`).element.closest('article').getAttribute('title')
    expect(hintOf('r-draft')).toBe(i18n.global.t('historyPage.cardDraftHint'))
    expect(hintOf('r-struct')).toBe(i18n.global.t('historyPage.cardNoLinkStructural'))
    expect(hintOf('r-noid')).toBe(i18n.global.t('historyPage.cardNoLinkNoPostId'))
    expect(hintOf('r-empty')).toBe(i18n.global.t('historyPage.cardNoLinkHint'))
  })
})
