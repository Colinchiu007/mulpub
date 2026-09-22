// @ts-check
/**
 * P1-c 提取服务巡检回落钩子契约（PR-2）：processQueue 每轮开头尝试 deferred→pending 批量回落。
 */
const PatternExtractionService = require('./pattern-extraction-service')

describe('PatternExtractionService 队列回落（U-212）', () => {
  it('U-212a: processQueue 开头调用 promoteDeferredPatternCards({ below: 200 })', async () => {
    const calls = []
    const store = {
      listPendingPatternCards: () => [],
      promoteDeferredPatternCards: (opts) => { calls.push(opts); return 0 },
    }
    const svc = new PatternExtractionService({ store, aiGenerator: {} })
    await svc.processQueue()
    expect(calls.length).toBe(1)
    expect(calls[0].below).toBe(200)
  })

  it('U-212b: promote 抛错 fail-open，队列处理继续', async () => {
    let listed = false
    const store = {
      listPendingPatternCards: () => { listed = true; return [] },
      promoteDeferredPatternCards: () => { throw new Error('db locked') },
    }
    const svc = new PatternExtractionService({ store, aiGenerator: {} })
    await svc.processQueue()
    expect(listed).toBe(true)
  })
})
