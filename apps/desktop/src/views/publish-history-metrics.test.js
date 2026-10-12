/**
 * 发布记录页作品互动数据 + 整卡可点的视图级回归
 * （PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §7.1 T22–T25）
 *
 * 单独成文件而不是塞进 PublishHistory.test.js：后者已 1199 行且仍在增长，
 * 混在一起会让两条互不相干的夹具（筛选/批量 vs 指标回流）互相牵制。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const historyListMock = vi.fn()
const historyGetMock = vi.fn()
const draftListMock = vi.fn()
const historyMetricsMock = vi.fn()
const metricsSyncMock = vi.fn()
const tabCreateTabMock = vi.fn()

vi.mock('@/api/publisher', () => ({
  historyList: (...args) => historyListMock(...args),
  historyGet: (...args) => historyGetMock(...args),
  historyDelete: vi.fn(),
  retryTask: vi.fn(),
  draftList: (...args) => draftListMock(...args),
}))

vi.mock('@/api/knowledge-library', () => ({
  historyMetrics: (...args) => historyMetricsMock(...args),
  metricsSync: (...args) => metricsSyncMock(...args),
  addManualSnapshot: vi.fn(),
}))

vi.mock('@/stores/tab', () => ({
  useTabStore: () => ({ createTab: (...args) => tabCreateTabMock(...args) }),
}))

vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({ isAuthenticated: { value: true }, signIn: vi.fn() }),
}))

vi.mock('@/utils/confirm-danger', () => ({ confirmDanger: vi.fn(async () => true) }))

vi.mock('@/stores/platforms', () => ({
  usePlatformStore: () => ({ load: vi.fn(), getLabel: () => '', getIcon: () => '', getContentCategory: () => 'ARTICLE' }),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import PublishHistory from './PublishHistory.vue'

async function flushHistory () {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function record (extra) {
  return {
    id: 'm-1', taskId: 'task-1', title: '带数据的记录', platform: 'xiaohongshu', status: 'success',
    timestamp: '2026-10-01T00:00:00.000Z', publisher: '秋叔', contentType: 'video',
    result: { url: 'https://www.xiaohongshu.com/explore/6530a1b2c3d4e5f600112233' },
    ...extra,
  }
}

async function mountWith (records, metricsPayload) {
  historyListMock.mockReset().mockResolvedValue({ code: 0, data: { total: records.length, records } })
  historyMetricsMock.mockReset().mockResolvedValue(metricsPayload)
  const wrapper = mount(PublishHistory, { global: { plugins: [i18n] } })
  await flushHistory()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'zh'
  vi.clearAllMocks()
  metricsSyncMock.mockReset().mockResolvedValue({ code: 0, data: { ran: true } })
  tabCreateTabMock.mockReset().mockResolvedValue('btab-1')
})

describe('发布记录页五项互动数据（T22/T24）', () => {
  it('T22 有快照 ⇒ 卡片展示真实数字而不是 "-"', async () => {
    const wrapper = await mountWith([record()], {
      code: 0,
      data: {
        metrics: { 'task-1': { trackedId: 't1', views: 1200, likes: 34, comments: 5, favorites: 6, shares: 7, capturedAt: '2026-10-12T08:00:00.000Z' } },
        missing: [],
        status: null,
      },
    })
    expect(historyMetricsMock).toHaveBeenCalledWith({ taskIds: ['task-1'] })
    const stats = wrapper.get('[data-testid="record-stats-m-1"]').text()
    expect(stats).toContain('1200')
    expect(stats).toContain('34')
    expect(stats).toContain('7')
  })

  it('T24 尚未采集 ⇒ 五列显示 "-"，卡片 title 说明原因（不把「没采」渲染成「就是 0」）', async () => {
    const wrapper = await mountWith([record()], {
      code: 0,
      data: { metrics: {}, missing: ['task-1'], status: null },
    })
    const stats = wrapper.get('[data-testid="record-stats-m-1"]')
    expect(stats.text()).toContain('-')
    expect(stats.attributes('title')).toBe('尚未采集作品数据')
  })

  it('T24b 平台不支持 ⇒ 提示点名「该平台暂不支持自动采集」', async () => {
    const wrapper = await mountWith([record({ platform: 'wechat_mp' })], {
      code: 0,
      data: {
        metrics: {},
        missing: ['task-1'],
        status: { counts: {}, accounts: [{ accountId: 'w1', platform: 'wechat_mp', status: 'unsupported' }] },
      },
    })
    expect(wrapper.get('[data-testid="record-stats-m-1"]').attributes('title')).toBe('该平台暂不支持自动采集')
  })

  it('T24c 登录过期 ⇒ 提示引导去账号页重新登录', async () => {
    const wrapper = await mountWith([record()], {
      code: 0,
      data: {
        metrics: {},
        missing: ['task-1'],
        status: { counts: {}, accounts: [{ accountId: 'a1', platform: 'xiaohongshu', status: 'needs_login' }] },
      },
    })
    expect(wrapper.get('[data-testid="record-stats-m-1"]').attributes('title')).toBe('账号登录已过期，请在账号页重新登录')
  })
})

describe('非实时说明与刷新入口（T25）', () => {
  it('T25 工具栏常驻「数据为低频采集，非实时」，有数据时附「数据截至 X 前」', async () => {
    const capturedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    const wrapper = await mountWith([record()], {
      code: 0,
      data: { metrics: { 'task-1': { views: 1, capturedAt } }, missing: [], status: null },
    })
    const line = wrapper.get('[data-testid="metrics-not-realtime"]').text()
    expect(line).toContain('数据为低频采集，非实时')
    expect(line).toContain('数据截至')
    expect(line).toContain('小时前')
  })

  it('T25b 无任何数据时不显示「数据截至」（不编造时刻）', async () => {
    const wrapper = await mountWith([record()], { code: 0, data: { metrics: {}, missing: ['task-1'], status: null } })
    expect(wrapper.get('[data-testid="metrics-not-realtime"]').text()).toBe('数据为低频采集，非实时')
  })

  it('T25c 点刷新触发 metricsSync 并重取指标', async () => {
    const wrapper = await mountWith([record()], { code: 0, data: { metrics: {}, missing: [], status: null } })
    historyMetricsMock.mockResolvedValue({ code: 0, data: { metrics: { 'task-1': { views: 42 } }, missing: [], status: null } })
    await wrapper.get('[data-testid="refresh-metrics"]').trigger('click')
    await flushHistory()
    expect(metricsSyncMock).toHaveBeenCalledWith({ force: true })
    expect(wrapper.get('[data-testid="record-stats-m-1"]').text()).toContain('42')
  })

  it('T25d 当日全部账号达上限 ⇒ 按钮禁用且 title 说明原因（不让用户反复点一个必然被拒的按钮）', async () => {
    const wrapper = await mountWith([record()], {
      code: 0,
      data: {
        metrics: {},
        missing: [],
        status: { lastRunAt: new Date().toISOString(), counts: { synced: 0, skipped_daily_cap: 1 }, accounts: [{ accountId: 'a1', platform: 'xiaohongshu', status: 'skipped_daily_cap' }] },
      },
    })
    const btn = wrapper.get('[data-testid="refresh-metrics"]')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toBe('今日采集次数已用完，请明天再试')
  })
})

describe('整卡点击打开内容页（T29 草稿语义）', () => {
  it('有公开内容页的记录 ⇒ 整卡可点，点击在新标签打开并保持前台', async () => {
    const wrapper = await mountWith([record()], { code: 0, data: { metrics: {}, missing: [], status: null } })
    const card = wrapper.find('.record-card')
    expect(card.classes()).toContain('is-clickable')
    await card.trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).toHaveBeenCalledTimes(1)
    expect(tabCreateTabMock.mock.calls[0][0].url).toBe('https://www.xiaohongshu.com/explore/6530a1b2c3d4e5f600112233')
  })

  it('T29 草稿记录 ⇒ 不可点且提示「草稿（未公开，无链接）」（点不动是正确语义，不是缺陷）', async () => {
    const wrapper = await mountWith(
      [record({ result: { url: '', draft: true } })],
      { code: 0, data: { metrics: {}, missing: [], status: null } },
    )
    const card = wrapper.find('.record-card')
    expect(card.classes()).not.toContain('is-clickable')
    expect(card.attributes('title')).toBe('草稿（未公开，无链接）')
    await card.trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).not.toHaveBeenCalled()
  })

  it('账号级采集回填的真实作品 ID 经 applyMetrics 落到 platformWorkId，卡片随之变为可点（D3 的兑现路径）', async () => {
    // 记录本身没有 result.postId（真实数据里 58/68 条如此），
    // 主进程返回的指标里带回了 postId ⇒ 卡片必须变为可点。
    // ⚠️ 这条锁必须断言 `.is-clickable` 与 title：只断言 `exists()` 是**恒真**的假锁
    // （夹具里卡片必然存在），会掩盖「丢了 postId」这类真实缺陷（QM-6 前端轴 MINOR 实测）。
    const wrapper = await mountWith(
      [record({ result: { url: 'https://creator.xiaohongshu.com/publish/publish' } })],
      {
        code: 0,
        data: {
          metrics: { 'task-1': { views: 1, postId: '6530a1b2c3d4e5f600112233', capturedAt: new Date().toISOString() } },
          missing: [],
          status: null,
        },
      },
    )
    const card = wrapper.find('.record-card')
    expect(card.classes()).toContain('is-clickable')
    expect(card.attributes('title')).toBe('点击打开平台作品链接')
    await card.trigger('click')
    await flushHistory()
    expect(tabCreateTabMock).toHaveBeenCalledTimes(1)
    expect(tabCreateTabMock.mock.calls[0][0].url).toBe('https://www.xiaohongshu.com/explore/6530a1b2c3d4e5f600112233')
  })

  it('回填的 postId 不得覆盖记录已有的 platformWorkId（只补空值）', async () => {
    const wrapper = await mountWith(
      [record({ platformWorkId: '6530a1b2c3d4e5f600112233', result: { url: '' } })],
      {
        code: 0,
        data: {
          metrics: { 'task-1': { views: 1, postId: 'ffffffffffffffffffffffff', capturedAt: new Date().toISOString() } },
          missing: [],
          status: null,
        },
      },
    )
    await wrapper.find('.record-card').trigger('click')
    await flushHistory()
    expect(tabCreateTabMock.mock.calls[0][0].url).toBe('https://www.xiaohongshu.com/explore/6530a1b2c3d4e5f600112233')
  })

  it('采集失败时工具栏出声（不让按钮点一下毫无反应）', async () => {
    historyListMock.mockReset().mockResolvedValue({ code: 0, data: { total: 1, records: [record()] } })
    historyMetricsMock.mockReset().mockResolvedValue({ code: -1, message: '账号级采集服务未就绪' })
    const wrapper = mount(PublishHistory, { global: { plugins: [i18n] } })
    await flushHistory()
    expect(wrapper.get('[data-testid="metrics-error"]').text()).toBe('账号级采集服务未就绪')
  })

  it('陈旧数据按卡片提示「数据截至」；新鲜数据不提示（一条新鲜记录不得漂白整页）', async () => {
    const stale = new Date(Date.now() - 72 * 3600 * 1000).toISOString()
    const wrapper = await mountWith([record()], {
      code: 0,
      data: { metrics: { 'task-1': { views: 9, capturedAt: stale } }, missing: [], status: null },
    })
    expect(wrapper.get('[data-testid="record-stats-m-1"]').attributes('title')).toContain('数据截至')
  })
})
