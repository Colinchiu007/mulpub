// @ts-check
/**
 * P2 技术债（audit-batch-4）：_waitForResponse 并发共享单句柄
 *
 * session.webRequest.onCompleted 是「会话级单例」拦截器：同一 session 上后一次注册
 * 直接覆盖前一次，且前一次的 cleanup 又会把它置 null。两个 _waitForResponse 并发时，
 * 先发起的那次收不到回调（只能等超时兜底），表现为「偶发永远等不到响应」。
 * 修复：按 session 把注册串行化（一次只有一个活跃拦截器）。
 */
const helpers = require('./rpa-view-helpers')

function makeHarness () {
  const events = []
  let active = null
  const session = {
    webRequest: {
      onCompleted (filter, cb) {
        if (typeof cb === 'function') {
          if (active) throw new Error('并发注册：会话级拦截器被覆盖')
          active = cb
          events.push('set')
        } else {
          if (!active) return
          active = null
          events.push('clear')
        }
      },
    },
  }
  const win = { webContents: { session } }
  const ctx = {
    _waitForResponse: helpers._waitForResponse,
    _waitForResponseExclusive: helpers._waitForResponseExclusive,
  }
  return { events, win, ctx, fire: (d) => active && active(d), active: () => active }
}

const tick = () => new Promise((r) => setImmediate(r))

describe('rpa-view-helpers._waitForResponse 并发串行化', () => {
  it('两次并发调用不会同时占用会话级拦截器（第二个排队等第一个释放）', async () => {
    const h = makeHarness()
    const p1 = h.ctx._waitForResponse(h.win, ['/api/publish'], 200)
    await tick()
    const p2 = h.ctx._waitForResponse(h.win, ['/api/publish'], 200)
    await tick()

    // 第一个已注册，第二个必须还在排队（events 只有一个 set）
    expect(h.events).toEqual(['set'])

    h.fire({ url: 'https://example.com/api/publish', statusCode: 200 })
    const r1 = await p1
    expect(r1).toMatchObject({ statusCode: 200, matchedUrls: [{ statusCode: 200 }] })

    await tick()
    expect(h.events).toEqual(['set', 'clear', 'set'])

    // 第二个只能靠超时兜底结束（期间没有响应打进来）
    const r2 = await p2
    expect(r2).toBeNull()
    expect(h.events[h.events.length - 1]).toBe('clear')
  })

  it('前一个等待失败也不得毒化队列（后一个仍能正常注册并命中）', async () => {
    const h = makeHarness()
    const p1 = h.ctx._waitForResponse(h.win, ['/a'], 5)
    await tick()
    const p2 = h.ctx._waitForResponse(h.win, ['/b'], 500)
    expect(await p1).toBeNull()

    await tick()
    expect(h.events).toEqual(['set', 'clear', 'set'])
    h.fire({ url: 'https://example.com/b', statusCode: 200 })
    expect(await p2).toMatchObject({ statusCode: 200 })
  })

  it('不同 session 之间互不阻塞', async () => {
    const h1 = makeHarness()
    const h2 = makeHarness()
    const a = h1.ctx._waitForResponse(h1.win, ['/x'], 500)
    const b = h2.ctx._waitForResponse(h2.win, ['/y'], 500)
    await tick()
    expect(h1.events).toEqual(['set'])
    expect(h2.events).toEqual(['set'])
    h1.fire({ url: 'https://e/x', statusCode: 200 })
    h2.fire({ url: 'https://e/y', statusCode: 200 })
    expect((await a).statusCode).toBe(200)
    expect((await b).statusCode).toBe(200)
    // 两个会话各自的拦截器互不覆盖：两边都只注册/释放了一次
    expect(h1.events).toEqual(['set', 'clear'])
    expect(h2.events).toEqual(['set', 'clear'])
  })

  it('防复发静态不变量：公开入口必须走排他实现，不得再直接注册拦截器', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'rpa-view-helpers.js'), 'utf8')
    expect(src).toMatch(/_waitForResponseExclusive/)
    expect(src).toMatch(/new WeakMap\(\)/)
    // 只有排他实现里允许出现 onCompleted 注册
    const publicPart = src.slice(src.indexOf('async _waitForResponse(win'), src.indexOf('async _waitForResponseExclusive(win'))
    expect(publicPart).not.toMatch(/webRequest\.onCompleted\(/)
  })
})
