import { describe, expect, it, vi, beforeEach } from 'vitest'
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
        records: [{ id: 'detail-mode', title: 'API 发布', platform: 'baijiahao', status: 'success', result: { mode: 'api', postId: 'post-998', url: 'https://example.com/p/998' } }],
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
    expect(detail.get('[data-testid="detail-link"]').attributes('href')).toBe('https://example.com/p/998')
    expect(detail.get('[data-testid="detail-link"]').attributes('rel')).toBe('noopener')
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

    expect(historyListMock).toHaveBeenNthCalledWith(2, { limit: 50, offset: 50 })
    expect(wrapper.findAll('.record-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('第二页唯一待重试记录')

    await wrapper.get('[data-testid="history-search"]').setValue('')
    await wrapper.get('[data-testid="status-filter"]').setValue('failed')
    await flushHistory()
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

  it('无 result.mode 不显示发布方式徽标', async () => {
    const wrapper = await mountWithMode(null)
    expect(wrapper.find('[data-testid="delivery-mode-rec-mode"]').exists()).toBe(false)
  })
})
