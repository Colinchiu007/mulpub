// @ts-check
/**
 * P1-a 回采服务写回挂点契约（PR-2）：成功路径旁路写回、fail-open、经 _getParser DI seam 免真实平台。
 */
const { PerformanceRecrawlService } = require('./performance-recrawl-service')

function makeService (store) {
  const svc = new PerformanceRecrawlService({ store })
  svc._jitter = async () => {} // 去抖，测试不真等 2-5s
  return svc
}

function fakeParser (metrics) {
  return {
    resolveContentUrl: (postId, url) => url,
    fetchMetrics: async () => metrics,
  }
}

const item = {
  id: 't1', platform: 'fixture', post_id: 'p1', url: 'https://example.com/note/123',
  created_at: new Date().toISOString(),
}

describe('PerformanceRecrawlService 写回挂点（U-203）', () => {
  it('U-203a: 回采成功 → updateViralEngagementByNormUrl(url,{likes,comments}) 被调用', () => {
    const calls = []
    const store = {
      addPerformanceSnapshot: () => {},
      updateTrackedContent: () => {},
      updateViralEngagementByNormUrl: (url, eng) => { calls.push([url, eng]) },
    }
    const svc = makeService(store)
    svc._getParser = () => fakeParser({ views: 1, likes: 6000, comments: 30, favorites: 0, shares: 0, raw: {} })
    return svc._recrawlOne(item).then(() => {
      expect(calls.length).toBe(1)
      expect(calls[0][0]).toBe('https://example.com/note/123')
      expect(calls[0][1]).toEqual({ likes: 6000, comments: 30 })
    })
  })

  it('U-203b: 写回抛错 fail-open —— tracked 域更新不回滚、不抛出', async () => {
    const updates = []
    const store = {
      addPerformanceSnapshot: () => {},
      updateTrackedContent: (id, u) => { updates.push(u) },
      updateViralEngagementByNormUrl: () => { throw new Error('db locked') },
    }
    const svc = makeService(store)
    svc._getParser = () => fakeParser({ likes: 1, comments: 1, raw: {} })
    await svc._recrawlOne(item)
    expect(updates.some((u) => u && u.recrawlStatus === 'ok')).toBe(true)
  })

  it('U-203c: store 无该方法（旧 store 兼容）→ 主流程不受影响', async () => {
    const store = { addPerformanceSnapshot: () => {}, updateTrackedContent: () => {} }
    const svc = makeService(store)
    svc._getParser = () => fakeParser({ likes: 1, comments: 1, raw: {} })
    await svc._recrawlOne(item)
  })
})
