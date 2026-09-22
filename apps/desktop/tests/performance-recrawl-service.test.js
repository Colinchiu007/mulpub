/**
 * PerformanceRecrawlService 测试 — 调度筛选 / 采样节奏 / 失败转 manual / 快照写入
 */
var path = require('path')
var { PerformanceRecrawlService } = require(path.resolve(__dirname, '../electron/services/performance-recrawl-service'))

describe('PerformanceRecrawlService', function () {
  var store
  var svc

  beforeEach(function () {
    store = {
      listDueForRecrawl: vi.fn(function () { return [] }),
      updateTrackedContent: vi.fn(function () { return true }),
      addPerformanceSnapshot: vi.fn(function () { return 'snap-1' }),
    }
    svc = new PerformanceRecrawlService({ store: store })
    // 压缩抖动等待，测试不真等 2-5s
    svc._jitter = function () { return Promise.resolve() }
  })

  test('空队列零副作用', async function () {
    await svc.processRound()
    expect(store.updateTrackedContent).not.toHaveBeenCalled()
    expect(store.addPerformanceSnapshot).not.toHaveBeenCalled()
  })

  test('未注册平台 → unsupported', async function () {
    store.listDueForRecrawl = vi.fn(function () {
      return [{ id: 't1', platform: 'unknown_platform', post_id: 'p1', created_at: new Date().toISOString() }]
    })
    await svc.processRound()
    expect(store.updateTrackedContent).toHaveBeenCalledWith('t1', expect.objectContaining({ recrawlStatus: 'unsupported' }))
  })

  test('成功回采 → 快照 + 节奏推进', async function () {
    store.listDueForRecrawl = vi.fn(function () {
      return [{ id: 't1', platform: 'bilibili', post_id: '', url: 'https://www.bilibili.com/video/BV1xx411c7mD', created_at: new Date().toISOString() }]
    })
    // mock fetch（B 站 API 路径）
    global.fetch = vi.fn(function () {
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({ code: 0, data: { stat: { view: 1000, like: 100, reply: 20, favorite: 30, share: 5 } } })
        },
      })
    })
    await svc.processRound()
    expect(store.addPerformanceSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      trackedContentId: 't1', source: 'auto', views: 1000, likes: 100,
    }))
    expect(store.updateTrackedContent).toHaveBeenCalledWith('t1', expect.objectContaining({ recrawlStatus: 'ok' }))
    delete global.fetch
  })

  test('连续失败 3 次 → manual', async function () {
    store.listDueForRecrawl = vi.fn(function () {
      return [{ id: 't1', platform: 'zhihu', post_id: 'p1', url: '', created_at: new Date().toISOString() }]
    })
    global.fetch = vi.fn(function () { return Promise.reject(new Error('network down')) })
    // 三轮失败
    await svc.processRound()
    await svc.processRound()
    await svc.processRound()
    expect(store.updateTrackedContent).toHaveBeenCalledWith('t1', expect.objectContaining({ recrawlStatus: 'manual', nextRecrawlAt: null }))
    delete global.fetch
  })

  test('7 天窗口结束 → nextRecrawlAt null', function () {
    var old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()
    var next = svc._nextRecrawlAt({ created_at: old })
    expect(next).toBeNull()
  })

  test('发布 2h → 下一采样点 +6h', function () {
    var twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    var next = svc._nextRecrawlAt({ created_at: twoHoursAgo })
    expect(next).toBeTruthy()
    var nextMs = new Date(next).getTime()
    var expected = Date.now() - 2 * 3600 * 1000 + 6 * 3600 * 1000
    expect(Math.abs(nextMs - expected)).toBeLessThan(5000)
  })
})

describe('PerformanceRecrawlService processRound force 透传', function () {
  test('processRound({force:true}) → listDueForRecrawl(now, {force:true})', async function () {
    var store = { listDueForRecrawl: vi.fn(function () { return [] }), updateTrackedContent: vi.fn(), addPerformanceSnapshot: vi.fn() }
    var svc = new PerformanceRecrawlService({ store: store })
    svc._jitter = function () { return Promise.resolve() }
    await svc.processRound({ force: true })
    expect(store.listDueForRecrawl.mock.calls[0][1]).toEqual({ force: true })
  })
  test('processRound() 无参 → 首参仍是当前时间戳（到期筛选不受影响）', async function () {
    var store = { listDueForRecrawl: vi.fn(function () { return [] }), updateTrackedContent: vi.fn(), addPerformanceSnapshot: vi.fn() }
    var svc = new PerformanceRecrawlService({ store: store })
    await svc.processRound()
    expect(typeof store.listDueForRecrawl.mock.calls[0][0]).toBe('number')
  })
})
