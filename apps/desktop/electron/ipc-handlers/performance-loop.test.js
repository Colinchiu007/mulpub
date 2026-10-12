// @ts-check
/**
 * performance-loop IPC：performance:trigger-recrawl 立即回采调试入口回归。
 *
 * 修复前该 handler 是空壳（只 return supported，从不跑 processRound），
 * 无法在会话内即时观测「回采→爆款库写回」。修复后必须真正执行一轮巡检，
 * 并支持 { force } 忽略 T+1h 排期纳入未到期条目。
 */
// withSenderCheck 通过 require('electron').app 读取 isPackaged → 需启用 electron mock
__enableElectronMock()

let registerHandlers
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  originalIsPackaged = __electronMock.app.isPackaged
  __electronMock.app.isPackaged = false
  const mod = await import('./performance-loop')
  registerHandlers = mod.default || mod
})
afterEach(() => { __electronMock.app.isPackaged = originalIsPackaged })

const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }
const fakeStore = { db: { prepare: () => ({ get: () => ({ n: 0 }), all: () => [] }) } }

function makeIpc () {
  const handlers = {}
  // on/removeListener 是给 T21b 的「真装配」路径准备的：
  // ipc-handlers/index 会连带注册 license 等模块，它们用 ipcMain.on 收事件。
  // 缺这两个方法会让装配锁以一个与生产无关的理由变红，掩盖它真正要守的东西。
  const ipcMain = {
    handle: (ch, fn) => { handlers[ch] = fn },
    on: () => {},
    removeListener: () => {},
    removeHandler: () => {},
  }
  return { handlers, ipcMain }
}

describe('performance:trigger-recrawl 立即回采入口', () => {
  it('force=true -> processRound({force:true}) 被调用 + 返回 supported/ran', async () => {
    const { handlers, ipcMain } = makeIpc()
    const performanceRecrawlService = { processRound: vi.fn(async () => {}) }
    registerHandlers(ipcMain, { store: fakeStore, performanceRecrawlService })
    const r = await handlers['performance:trigger-recrawl'](TRUSTED_EVENT, { force: true })
    expect(r.code).toBe(0)
    expect(Array.isArray(r.data.supported)).toBe(true)
    expect(r.data.ran).toBe(true)
    expect(r.data.force).toBe(true)
    expect(performanceRecrawlService.processRound).toHaveBeenCalledTimes(1)
    expect(performanceRecrawlService.processRound).toHaveBeenCalledWith({ force: true })
  })

  it('缺省 opts -> 非强制巡检（force:false，仅纳入已到期条目）', async () => {
    const { handlers, ipcMain } = makeIpc()
    const performanceRecrawlService = { processRound: vi.fn(async () => {}) }
    registerHandlers(ipcMain, { store: fakeStore, performanceRecrawlService })
    await handlers['performance:trigger-recrawl'](TRUSTED_EVENT, undefined)
    expect(performanceRecrawlService.processRound).toHaveBeenCalledWith({ force: false })
  })

  it('回采服务未就绪 -> ran:false，仍返回 supported 不抛', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, { store: fakeStore, performanceRecrawlService: null })
    const r = await handlers['performance:trigger-recrawl'](TRUSTED_EVENT, {})
    expect(r.code).toBe(0)
    expect(r.data.ran).toBe(false)
  })
})

/**
 * P2-6c `performance:overview` 看板聚合入口。
 * 夹具刻意用**真实聚合函数**（只 mock store 的取数），因为本案最大的风险就是
 * 「handler 自己另拼一份口径」或「门禁写成恒过」——mock 掉聚合就都测不出来。
 */
function overviewStore (overrides) {
  return Object.assign({
    listTrackedForOverview: () => ({
      rows: [{ id: 'c1', platform: 'zhihu', recrawl_status: 'ok', created_at: '2026-10-01T00:00:00.000Z', last_recrawl_at: null }],
      total: 1, truncated: false,
    }),
    listSnapshotsForOverview: () => ({
      rows: [{ id: 's1', tracked_content_id: 'c1', views: 30, likes: 4, comments: 1, favorites: 0, shares: 0, captured_at: '2026-10-02T00:00:00.000Z' }],
      total: 1, truncated: false, orphanTotal: 0,
    }),
  }, overrides || {})
}

const identityWith = (sub) => ({ getState: () => (sub ? { user: { sub } } : { user: null }) })

describe('performance:overview 看板聚合入口', () => {
  it('T18 身份可解析 -> 按该归属取数，信封含 totals/trend/health 且数字来自真聚合', async () => {
    const { handlers, ipcMain } = makeIpc()
    const seen = []
    const store = overviewStore({
      listTrackedForOverview: (owner) => { seen.push(owner); return { rows: [{ id: 'c1', platform: 'zhihu', recrawl_status: 'ok' }], total: 1, truncated: false } },
    })
    registerHandlers(ipcMain, { store, identityService: identityWith('user-A') })
    const r = await handlers['performance:overview'](TRUSTED_EVENT, { windowDays: 14 })
    expect(r.code).toBe(0)
    expect(seen).toEqual(['user-A'])
    expect(r.data.totals.views).toBe(30)
    expect(r.data.totals.interactions).toBe(5)
    expect(r.data.windowDays).toBe(14)
    expect(r.data.trend).toHaveLength(14)
    expect(r.data.health.covered).toBe(1)
    expect(r.data.hasData).toBe(true)
  })

  it('T19 无法识别当前用户 -> AUTH_ERROR，绝不返回全零成功信封', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, { store: overviewStore(), identityService: identityWith(null) })
    const r = await handlers['performance:overview'](TRUSTED_EVENT, {})
    expect(r.code).not.toBe(0)
    expect(r.message).toBe('无法识别当前用户')
    expect(r.data).toBeUndefined()
  })

  it('T19b 无身份服务（legacy 档）-> 以 undefined 归属照常出数，不把匿名态误判成未登录', async () => {
    const { handlers, ipcMain } = makeIpc()
    const seen = []
    registerHandlers(ipcMain, {
      store: overviewStore({ listTrackedForOverview: (owner) => { seen.push(owner); return { rows: [], total: 0, truncated: false } } }),
      identityService: null,
    })
    const r = await handlers['performance:overview'](TRUSTED_EVENT, {})
    expect(r.code).toBe(0)
    expect(seen).toEqual([undefined])
    expect(r.data.hasData).toBe(false)
  })

  it('T20 store 抛错 -> REQUEST_ERROR 且不冒泡到 IPC 层', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, {
      store: overviewStore({ listTrackedForOverview: () => { throw new Error('db down') } }),
      identityService: identityWith('user-A'),
    })
    const r = await handlers['performance:overview'](TRUSTED_EVENT, {})
    expect(r.code).not.toBe(0)
    expect(r.message).toBe('db down')
  })

  it('T20c store 以 error 字段报告查询失败 → REQUEST_ERROR，不得返回 code:0 + 空数据', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, {
      store: overviewStore({
        listTrackedForOverview: () => ({ rows: [], total: 0, truncated: false, error: 'no such table: tracked_content' }),
        listSnapshotsForOverview: () => ({ rows: [], total: 0, truncated: false, orphanTotal: 0 }),
      }),
      identityService: identityWith('user-A'),
    })
    const r = await handlers['performance:overview'](TRUSTED_EVENT, {})
    expect(r.code).not.toBe(0)
    expect(r.message).toBe('no such table: tracked_content')
    expect(r.data).toBeUndefined()
  })

  it('T20b 孤儿快照数如实透传（真孤儿来自库级计数，不是聚合层的猜测）', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, {
      store: overviewStore({ listSnapshotsForOverview: () => ({ rows: [], total: 0, truncated: false, orphanTotal: 7 }) }),
      identityService: identityWith('user-A'),
    })
    const r = await handlers['performance:overview'](TRUSTED_EVENT, {})
    expect(r.data.diagnostics.orphanSnapshotsDb).toBe(7)
  })

  it('T21 截断必须带着上限一起出，供界面如实说明「基于最近 N 条」', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, {
      store: overviewStore({
        listTrackedForOverview: () => ({ rows: [], total: 9000, truncated: true }),
        listSnapshotsForOverview: () => ({ rows: [], total: 1, truncated: false, orphanTotal: 0 }),
      }),
      identityService: identityWith('user-A'),
    })
    const r = await handlers['performance:overview'](TRUSTED_EVENT, {})
    expect(r.data.truncated).toEqual({ tracked: true, snapshot: false })
    expect(r.data.limits.tracked).toBeGreaterThan(0)
  })

  it('T21b 装配锁：真实 ipc-handlers/index 注册面必须挂上本 handler', async () => {
    const { handlers, ipcMain } = makeIpc()
    // 走真实 index（而不是直接 require ./performance-loop），守的是「handler 写了但没人挂」这条路。
    // 个别模块（如 prompt-eval）缺依赖会 fail-fast 抛错——那是它们的正确行为，
    // 所以这里必须给出它们要求的注入物，缺哪个补哪个，禁止改成直接调子模块把锁降级。
    require('./index')(ipcMain, {
      store: overviewStore(),
      identityService: identityWith('user-A'),
      promptEvalService: { listEvaluations: async () => ({ code: 0, data: [] }) },
    })
    expect(typeof handlers['performance:overview']).toBe('function')
    const r = await handlers['performance:overview'](TRUSTED_EVENT, {})
    expect(r.code).toBe(0)
  })
})

/**
 * 发布记录页作品互动数据（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §7.1 T19–T21/T21b）
 *
 * 本组的重点是**门禁与信封**，不是聚合本身（聚合在 store / composable 各有专测）：
 *   ① 认不出身份必须是 AUTH_ERROR，**不得**回一个空 metrics 的成功信封 ——
 *      那会让「没登录」渲染成「没有作品数据」，用户以为功能坏了；
 *   ② 查询失败必须翻成 REQUEST_ERROR，不得吞成空对象（同族：看板 FB7）；
 *   ③ 采集服务缺席必须明说，不得静默成功。
 */
describe('performance:history-metrics / metrics:sync 账号级回流通道', () => {
  const metricsStore = (overrides) => Object.assign({
    getHistoryMetricsByTaskIds: () => ({
      metrics: { 'task-1': { trackedId: 't1', platform: 'xiaohongshu', postId: 'n1', views: 120, likes: 3, comments: 1, favorites: 0, shares: 2, capturedAt: '2026-10-12T00:00:00.000Z', source: 'account_sync' } },
      missing: ['task-2'],
    }),
    getAccountSyncState: () => ({ lastRunAt: '2026-10-12T00:00:00.000Z', counts: { synced: 1 } }),
  }, overrides || {})

  it('T19 返回 metrics + missing + 采集状态；入参 taskIds 原样透传', async () => {
    const { handlers, ipcMain } = makeIpc()
    const seen = []
    registerHandlers(ipcMain, {
      store: metricsStore({ getHistoryMetricsByTaskIds: (ids, owner) => { seen.push([ids, owner]); return { metrics: { 'task-1': { views: 120 } }, missing: [] } } }),
      identityService: identityWith('user-A'),
    })
    const r = await handlers['performance:history-metrics'](TRUSTED_EVENT, { taskIds: ['task-1'] })
    expect(r.code).toBe(0)
    expect(r.data.metrics['task-1'].views).toBe(120)
    expect(r.data.status).toMatchObject({ counts: { synced: 1 } })
    // owner 必须是主进程自己解析出来的，不能由渲染端传（否则等于没有归属过滤）
    expect(seen[0][1]).toBe('user-A')
  })

  it('T20 未登录 ⇒ AUTH_ERROR，**不得**返回全零成功信封（否则「没登录」看起来像「没有数据」）', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, { store: metricsStore(), identityService: identityWith(null) })
    const r = await handlers['performance:history-metrics'](TRUSTED_EVENT, { taskIds: ['task-1'] })
    expect(r.code).toBe(-3)
    expect(r.data).toBeUndefined()
  })

  it('T20b 存储查询失败 ⇒ REQUEST_ERROR 且带原因，不吞成空 metrics', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, {
      store: metricsStore({ getHistoryMetricsByTaskIds: () => ({ metrics: {}, missing: [], error: 'no such table: performance_snapshot' }) }),
      identityService: identityWith('user-A'),
    })
    const r = await handlers['performance:history-metrics'](TRUSTED_EVENT, { taskIds: ['task-1'] })
    expect(r.code).not.toBe(0)
    expect(r.message).toContain('no such table')
  })

  it('T20c store 缺方法时明确报错（而不是静默给空对象）', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, { store: { getAccountSyncState: () => null }, identityService: identityWith('user-A') })
    const r = await handlers['performance:history-metrics'](TRUSTED_EVENT, { taskIds: ['t'] })
    expect(r.code).not.toBe(0)
    expect(r.message).toContain('getHistoryMetricsByTaskIds')
  })

  it('T21 metrics:sync 用主进程解析的归属调 runRound，reason 固定 manual', async () => {
    const { handlers, ipcMain } = makeIpc()
    const accountMetricsService = { runRound: vi.fn(async (opts) => ({ ran: true, reason: opts.reason, counts: { synced: 1 } })) }
    registerHandlers(ipcMain, { store: metricsStore(), identityService: identityWith('user-A'), accountMetricsService })
    const r = await handlers['metrics:sync'](TRUSTED_EVENT, { force: true })
    expect(r.code).toBe(0)
    expect(r.data.ran).toBe(true)
    expect(accountMetricsService.runRound).toHaveBeenCalledWith({ reason: 'manual', ownerSubject: 'user-A', force: true })
  })

  it('T21b 未登录时 metrics:sync 不得触发采集（不给匿名态打平台接口）', async () => {
    const { handlers, ipcMain } = makeIpc()
    const accountMetricsService = { runRound: vi.fn() }
    registerHandlers(ipcMain, { store: metricsStore(), identityService: identityWith(null), accountMetricsService })
    const r = await handlers['metrics:sync'](TRUSTED_EVENT, {})
    expect(r.code).toBe(-3)
    expect(accountMetricsService.runRound).not.toHaveBeenCalled()
  })

  it('T21c 采集服务未就绪 ⇒ 明确错误（不是静默成功）', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, { store: metricsStore(), identityService: identityWith('user-A'), accountMetricsService: null })
    const r = await handlers['metrics:sync'](TRUSTED_EVENT, {})
    expect(r.code).not.toBe(0)
    expect(r.message).toContain('未就绪')
  })

  it('T21d metrics:sync-status 返回状态；未登录同样 AUTH_ERROR', async () => {
    const { handlers, ipcMain } = makeIpc()
    registerHandlers(ipcMain, { store: metricsStore(), identityService: identityWith('user-A') })
    const ok = await handlers['metrics:sync-status'](TRUSTED_EVENT)
    expect(ok.code).toBe(0)
    expect(ok.data.status).toMatchObject({ counts: { synced: 1 } })

    const { handlers: h2, ipcMain: i2 } = makeIpc()
    registerHandlers(i2, { store: metricsStore(), identityService: identityWith(null) })
    const denied = await h2['metrics:sync-status'](TRUSTED_EVENT)
    expect(denied.code).toBe(-3)
  })

  it('T21e 装配锁：真实 ipc-handlers/index 注册面必须挂上三个新通道（守「写了没人挂」）', async () => {
    const { handlers, ipcMain } = makeIpc()
    require('./index')(ipcMain, {
      store: metricsStore(),
      identityService: identityWith('user-A'),
      promptEvalService: { listEvaluations: async () => ({ code: 0, data: [] }) },
      accountMetricsService: { runRound: async () => ({ ran: true }) },
    })
    expect(typeof handlers['performance:history-metrics']).toBe('function')
    expect(typeof handlers['metrics:sync']).toBe('function')
    expect(typeof handlers['metrics:sync-status']).toBe('function')
  })
})
