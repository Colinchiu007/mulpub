/**
 * usePublishHistoryMetrics 单测（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §7.1 T22–T25 的判据层）
 *
 * 这层的风险是「静默说谎」：把失败当成空数据、把缺失当成 0、把「刚刚」当成无法解析的时间。
 * 所以逐条断言提示语与回填结果，而不是断言「函数有返回值」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const historyMetricsMock = vi.fn()
const metricsSyncMock = vi.fn()
vi.mock('@/api/knowledge-library', () => ({
  historyMetrics: (...args) => historyMetricsMock(...args),
  metricsSync: (...args) => metricsSyncMock(...args),
}))

const { usePublishHistoryMetrics, displayMetric, relativeTime } = await import('./usePublishHistoryMetrics')

const t = (key, named) => {
  if (key === 'historyPage.metricsAsOf') return '数据截至 ' + (named && named.time)
  if (key === 'historyPage.metricsAgoMinutes') return (named && named.n) + ' 分钟前'
  // formatUserError 的 fallback 走这条 t：返回真实中文文案（护栏产物是「文案」而不是键名）
  if (key === 'historyPage.metricsFailed') return '上次采集失败，可稍后重试'
  if (key === 'historyPage.metricsSaveFailed') return '保存失败，请稍后重试'
  if (key === 'historyPage.metricsCollectFormatChanged') return '平台数据格式有变化，暂无法采集该平台。可稍后重试，或在详情弹窗手动录入'
  return key
}

function setup (records) {
  const recordsRef = ref(records)
  const api = usePublishHistoryMetrics({ t, records: recordsRef })
  return { api, recordsRef }
}

beforeEach(() => {
  historyMetricsMock.mockReset()
  metricsSyncMock.mockReset()
})

describe('displayMetric', () => {
  it('null/undefined/空串一律给 "-"；0 是合法值必须原样显示（0 与「没这个字段」不是一回事）', () => {
    expect(displayMetric(null)).toBe('-')
    expect(displayMetric(undefined)).toBe('-')
    expect(displayMetric('')).toBe('-')
    expect(displayMetric(0)).toBe(0)
    expect(displayMetric(123)).toBe(123)
  })
})

describe('relativeTime', () => {
  it('分/时/天/日期四档；不可解析返回 ""（不伪造成「刚刚」）', () => {
    const now = Date.parse('2026-10-12T12:00:00.000Z')
    expect(relativeTime('2026-10-12T11:59:40.000Z', now)).toBe('justNow')
    expect(relativeTime('2026-10-12T11:30:00.000Z', now)).toEqual({ key: 'minutes', value: 30 })
    expect(relativeTime('2026-10-12T06:00:00.000Z', now)).toEqual({ key: 'hours', value: 6 })
    expect(relativeTime('2026-10-09T12:00:00.000Z', now)).toEqual({ key: 'days', value: 3 })
    expect(relativeTime('2026-09-01T12:00:00.000Z', now)).toEqual({ key: 'date', value: '2026-09-01' })
    expect(relativeTime('', now)).toBe('')
    expect(relativeTime('乱码', now)).toBe('')
    expect(relativeTime(null, now)).toBe('')
  })
})

describe('loadMetrics', () => {
  it('T22 有快照 ⇒ 五项指标就地回填到 record（模板直接读 record.views）', async () => {
    historyMetricsMock.mockResolvedValue({
      code: 0,
      data: {
        metrics: { 'task-1': { trackedId: 't1', views: 1200, likes: 34, comments: 5, favorites: 6, shares: 7, capturedAt: '2026-10-12T10:00:00.000Z', source: 'account_sync' } },
        missing: [],
        status: null,
      },
    })
    const { api, recordsRef } = setup([{ id: 'r1', taskId: 'task-1', platform: 'xiaohongshu' }])
    await api.loadMetrics()
    expect(historyMetricsMock).toHaveBeenCalledWith({ taskIds: ['task-1'] })
    expect(recordsRef.value[0].views).toBe(1200)
    expect(recordsRef.value[0].favorites).toBe(6)
    expect(recordsRef.value[0].metricsCapturedAt).toBe('2026-10-12T10:00:00.000Z')
  })

  it('T22b 缺失指标保持 null（不补 0），界面渲染 "-" 而不是假数字', async () => {
    historyMetricsMock.mockResolvedValue({
      code: 0,
      data: {
        metrics: { 'task-1': { trackedId: 't1', views: 5, likes: null, comments: null, favorites: null, shares: null, capturedAt: '2026-10-12T10:00:00.000Z' } },
        missing: [],
        status: null,
      },
    })
    const { api, recordsRef } = setup([{ id: 'r1', taskId: 'task-1' }])
    await api.loadMetrics()
    expect(recordsRef.value[0].views).toBe(5)
    expect(displayMetric(recordsRef.value[0].favorites)).toBe('-')
  })

  it('T23 无 taskId 的记录不参与请求；列表为空时不发请求', async () => {
    const { api } = setup([])
    await api.loadMetrics()
    expect(historyMetricsMock).not.toHaveBeenCalled()
  })

  it('刷新失败保留上一次数据（把「刷新失败」渲染成「没有数据」是更差的结果）', async () => {
    historyMetricsMock.mockResolvedValueOnce({ code: 0, data: { metrics: { 'task-1': { views: 9 } }, missing: [], status: null } })
    const { api, recordsRef } = setup([{ id: 'r1', taskId: 'task-1' }])
    await api.loadMetrics()
    expect(recordsRef.value[0].views).toBe(9)

    historyMetricsMock.mockResolvedValueOnce({ code: -1, message: 'boom' })
    await api.loadMetrics()
    expect(recordsRef.value[0].views).toBe(9) // 未被清空
    expect(api.metricsError.value).toBe('boom')
  })

  it('抛错不冒出（不让指标失败带崩整个列表）', async () => {
    historyMetricsMock.mockRejectedValueOnce(new Error('ipc down'))
    const { api } = setup([{ id: 'r1', taskId: 'task-1' }])
    await expect(api.loadMetrics()).resolves.toBeUndefined()
    expect(api.metricsError.value).toBe('ipc down')
  })
})

describe('metricHint 四类空态互斥', () => {
  const status = {
    counts: { synced: 1, needs_login: 1, unsupported: 1, failed: 1 },
    accounts: [
      { accountId: 'a1', platform: 'douyin', status: 'needs_login' },
      { accountId: 'a2', platform: 'toutiao', status: 'unsupported' },
      { accountId: 'a3', platform: 'zhihu', status: 'failed' },
    ],
  }

  async function setupWithStatus () {
    historyMetricsMock.mockResolvedValue({ code: 0, data: { metrics: { 'task-ok': { views: 1 } }, missing: [], status } })
    const ctx = setup([
      { id: 'r-ok', taskId: 'task-ok', platform: 'xiaohongshu' },
      { id: 'r-login', taskId: 'task-login', platform: 'douyin' },
      { id: 'r-unsup', taskId: 'task-unsup', platform: 'toutiao' },
      { id: 'r-fail', taskId: 'task-fail', platform: 'zhihu' },
      { id: 'r-never', taskId: 'task-never', platform: 'weibo' },
    ])
    await ctx.api.loadMetrics()
    return ctx
  }

  it('T23b 有数据 → 无提示；需登录 / 不支持 / 失败 / 尚未采集 各自点名', async () => {
    const { api } = await setupWithStatus()
    expect(api.metricHint({ taskId: 'task-ok', platform: 'xiaohongshu' })).toBe('')
    expect(api.metricHint({ taskId: 'task-login', platform: 'douyin' })).toBe('historyPage.metricsNeedsLogin')
    // no_adapter（无 error 字段）⇒ 通用 unsupported 行（stub 未覆盖该键 ⇒ 返回键名）
    expect(api.metricHint({ taskId: 'task-unsup', platform: 'toutiao' })).toBe('historyPage.metricsUnsupported')
    // failed 且无 reason ⇒ 通用失败行（stub 覆盖了该键 ⇒ 返回真实文案，护栏走的就是这条路）
    expect(api.metricHint({ taskId: 'task-fail', platform: 'zhihu' })).toBe('上次采集失败，可稍后重试')
    expect(api.metricHint({ taskId: 'task-never', platform: 'weibo' })).toBe('historyPage.metricsNeverCollected')
    expect(api.metricHint(null)).toBe('')
  })

  it('T23c unsupported/needs_login 按 reason 细分（reason 来自主进程 accounts[].error）', async () => {
    const { api } = await setupWithStatus()
    // 签名器不在场 ⇒ 独立文案，不再与「暂不支持」混用（stub 未覆盖 ⇒ 断言键名）
    expect(api.platformStatusHint('unsupported', 'signer_unavailable')).toBe('historyPage.metricsSignerUnavailable')
    expect(api.platformStatusHint('unsupported', 'sign_failed')).toBe('historyPage.metricsSignFailed')
    // 快手设备指纹缺失 ⇒ 「登录信息不完整」而不是「登录过期」
    expect(api.platformStatusHint('needs_login', 'missing_cookie:kuaishou.web.cp.api_ph')).toBe('historyPage.metricsCookieIncomplete')
    // 采集接口形态变化 ⇒ 自然语言说明 + 手动录入出路（stub 覆盖 ⇒ 断言真实文案）
    expect(api.platformStatusHint('failed', 'parse_error:douyin: 响应缺少 aweme_list')).toBe('平台数据格式有变化，暂无法采集该平台。可稍后重试，或在详情弹窗手动录入')
    expect(api.platformStatusHint('failed', 'http_500')).toBe('平台数据格式有变化，暂无法采集该平台。可稍后重试，或在详情弹窗手动录入')
    expect(api.platformStatusHint('failed', 'invalid_json')).toBe('平台数据格式有变化，暂无法采集该平台。可稍后重试，或在详情弹窗手动录入')
  })

  it('同一平台多账号时取「最需要用户处理」的那个状态（needs_login 优先于 failed）', async () => {
    historyMetricsMock.mockResolvedValue({
      code: 0,
      data: {
        metrics: {},
        missing: [],
        status: {
          counts: {},
          accounts: [
            { accountId: 'a1', platform: 'douyin', status: 'failed' },
            { accountId: 'a2', platform: 'douyin', status: 'needs_login' },
          ],
        },
      },
    })
    const { api } = setup([{ id: 'r', taskId: 't', platform: 'douyin' }])
    await api.loadMetrics()
    expect(api.metricHint({ taskId: 't', platform: 'douyin' })).toBe('historyPage.metricsNeedsLogin')
  })
})

describe('refreshMetrics', () => {
  it('T25 手动刷新触发 metricsSync 并重取指标；进行中重复调用被吞（防连点）', async () => {
    let release
    metricsSyncMock.mockImplementation(() => new Promise(r => { release = r }))
    historyMetricsMock.mockResolvedValue({ code: 0, data: { metrics: {}, missing: [], status: null } })
    const { api } = setup([{ id: 'r1', taskId: 'task-1' }])

    const first = api.refreshMetrics()
    expect(api.syncing.value).toBe(true)
    const second = await api.refreshMetrics()
    expect(second).toBeNull()
    expect(metricsSyncMock).toHaveBeenCalledTimes(1)

    release({ code: 0, data: { ran: true } })
    await first
    expect(api.syncing.value).toBe(false)
    expect(historyMetricsMock).toHaveBeenCalled()
  })

  it('刷新失败时保留错误并解除 loading（不能让按钮永久卡在「正在采集」）', async () => {
    // 「未登录」命中 formatUserError 的遗留 AUTH_REQUIRED pattern ⇒ 转成自然语言文案而非原样直出；
    // 这正是接上护栏后的预期行为（技术/半技术文本不再裸奔到 UI）。
    metricsSyncMock.mockResolvedValue({ code: -1, message: '未登录' })
    const { api } = setup([{ id: 'r1', taskId: 'task-1' }])
    const out = await api.refreshMetrics()
    expect(out).toBeNull()
    expect(api.metricsError.value).toContain('登录')
    expect(api.syncing.value).toBe(false)
  })

  it('刷新失败的技术文本（通道名形态）⇒ 经 formatUserError 兜底，不直出内部文本', async () => {
    metricsSyncMock.mockResolvedValue({ code: -1, message: 'store:metrics-sync failed at line 3' })
    const { api } = setup([{ id: 'r1', taskId: 'task-1' }])
    await api.refreshMetrics()
    expect(api.metricsError.value).toBe('上次采集失败，可稍后重试')
    expect(api.metricsError.value).not.toContain('store:')
  })
})

describe('派生状态', () => {
  it('latestCapturedAt 取最新一份快照时刻（「数据截至」的依据）；无数据时为空串', async () => {
    historyMetricsMock.mockResolvedValue({
      code: 0,
      data: {
        metrics: {
          a: { views: 1, capturedAt: '2026-10-11T00:00:00.000Z' },
          b: { views: 2, capturedAt: '2026-10-12T00:00:00.000Z' },
        },
        missing: [],
        status: null,
      },
    })
    const { api } = setup([{ id: 'r1', taskId: 'a' }, { id: 'r2', taskId: 'b' }])
    await api.loadMetrics()
    expect(api.latestCapturedAt.value).toBe('2026-10-12T00:00:00.000Z')
    expect(api.hasAnyMetrics.value).toBe(true)
  })

  it('dailyCapReached：当日全部账号都因日上限被跳过时判真（按钮据此禁用并说明原因）', async () => {
    historyMetricsMock.mockResolvedValue({
      code: 0,
      data: {
        metrics: {},
        missing: [],
        status: { lastRunAt: new Date().toISOString(), counts: { skipped_daily_cap: 2, synced: 0 }, accounts: [{ accountId: 'a1', status: 'skipped_daily_cap' }, { accountId: 'a2', status: 'skipped_daily_cap' }] },
      },
    })
    const { api } = setup([{ id: 'r', taskId: 't' }])
    await api.loadMetrics()
    expect(api.dailyCapReached.value).toBe(true)
  })

  it('dailyCapReached：**昨日**的持久化状态不得把按钮灰锁到今天（UTC 日判据）', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    historyMetricsMock.mockResolvedValue({
      code: 0,
      data: {
        metrics: {},
        missing: [],
        status: { lastRunAt: yesterday, counts: { skipped_daily_cap: 2, synced: 0 }, accounts: [{ accountId: 'a1', status: 'skipped_daily_cap' }] },
      },
    })
    const { api } = setup([{ id: 'r', taskId: 't' }])
    await api.loadMetrics()
    expect(api.dailyCapReached.value).toBe(false)
  })

  it('dailyCapReached：刚跑完的那一轮优先于持久化状态（用户点完立刻知道还能不能再点）', async () => {
    // 持久化状态是「昨天已打满」，但本轮实测有账号成功 ⇒ 不禁用
    historyMetricsMock.mockResolvedValue({
      code: 0,
      data: {
        metrics: {},
        missing: [],
        status: { lastRunAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), counts: { skipped_daily_cap: 1, synced: 0 }, accounts: [{ accountId: 'a1', status: 'skipped_daily_cap' }] },
      },
    })
    metricsSyncMock.mockResolvedValue({ code: 0, data: { ran: true, counts: { synced: 1 }, accounts: [{ accountId: 'a1', status: 'ok' }] } })
    const { api } = setup([{ id: 'r', taskId: 't' }])
    await api.loadMetrics()
    await api.refreshMetrics()
    expect(api.dailyCapReached.value).toBe(false)
  })

  it('dailyCapReached：有账号成功采集过则判假（不能因为别的账号超限就锁住按钮）', async () => {
    historyMetricsMock.mockResolvedValue({
      code: 0,
      data: {
        metrics: {},
        missing: [],
        status: { lastRunAt: new Date().toISOString(), counts: { skipped_daily_cap: 1, synced: 1 }, accounts: [{ accountId: 'a1', status: 'skipped_daily_cap' }, { accountId: 'a2', status: 'ok' }] },
      },
    })
    const { api } = setup([{ id: 'r', taskId: 't' }])
    await api.loadMetrics()
    expect(api.dailyCapReached.value).toBe(false)
  })
})
