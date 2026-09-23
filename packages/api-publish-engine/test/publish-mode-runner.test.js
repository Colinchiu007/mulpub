/**
 * publish-mode-runner.test.js — §5.2 双轨发布执行包装（假发布者，零外发，vitest 组）
 */
const { createPublishWithMode, outcomeOfResult } = require('../src/publish/core/publish-mode-runner')
const { createPublishSpacer } = require('../src/publish/core/publish-spacer')

function capLogger () {
  const logs = []
  return {
    logs,
    info: (d, m, o) => logs.push({ level: 'info', domain: d, msg: m, obj: o }),
    warn: (d, m, o) => logs.push({ level: 'warn', domain: d, msg: m, obj: o }),
    error: (d, m, o) => logs.push({ level: 'error', domain: d, msg: m, obj: o }),
    debug: () => {},
  }
}

describe('outcomeOfResult 结果归一', () => {
  it('显式标志优先', () => {
    expect(outcomeOfResult({ success: true })).toBe('success')
    expect(outcomeOfResult({ riskBlocked: true })).toBe('risk_blocked')
    expect(outcomeOfResult({ login_expired: true })).toBe('login_expired')
    expect(outcomeOfResult({ unsupported: true })).toBe('unsupported')
  })
  it('具名错误码 BILI_RISK_601 → risk_blocked', () => {
    expect(outcomeOfResult({ success: false, code: 'BILI_RISK_601', error: '上传视频过快' })).toBe('risk_blocked')
  })
  it('文案兜底：登录/风控/不支持/瞬时', () => {
    expect(outcomeOfResult({ error: 'cookie 已失效，请重新登录' })).toBe('login_expired')
    expect(outcomeOfResult({ error: '触发风控 10000015' })).toBe('risk_blocked')
    expect(outcomeOfResult({ error: '该功能暂不支持 API 发布' })).toBe('unsupported')
    expect(outcomeOfResult({ error: 'socket hang up' })).toBe('transient_error')
    expect(outcomeOfResult(null)).toBe('transient_error')
  })
})

describe('publishWithMode：dom-only 轨', () => {
  it('dom-only 直接走 DOM，不调用 API', async () => {
    let apiCalled = false
    const lg = capLogger()
    const run = createPublishWithMode({
      logger: lg,
      apiPublish: async () => { apiCalled = true; return { success: true } },
      domPublish: async () => ({ success: true, publishId: 'DOM1' }),
    })
    const r = await run('weibo', { title: 't' }, 'cookie', { mode: 'dom-only', accountId: 'a1' })
    expect(apiCalled).toBe(false)
    expect(r.track).toBe('dom')
    expect(r.success).toBe(true)
    expect(r.publishId).toBe('DOM1')
    expect(r.degraded).toBe(false)
    expect(r.reasonCode).toBe('mode_dom_only')
  })

  it('dom-only 无 DOM 执行器 → requiresDom', async () => {
    const run = createPublishWithMode({ logger: capLogger(), apiPublish: async () => ({ success: true }) })
    const r = await run('weibo', {}, 'c', { mode: 'dom-only', accountId: 'a1' })
    expect(r.track).toBe('dom')
    expect(r.requiresDom).toBe(true)
    expect(r.success).toBe(false)
  })
})

describe('publishWithMode：api-then-dom 三态决策', () => {
  it('API 成功 → 留 API，不降级', async () => {
    const lg = capLogger()
    let domCalled = false
    const run = createPublishWithMode({
      logger: lg,
      apiPublish: async () => ({ success: true, publishId: 'BV1' }),
      domPublish: async () => { domCalled = true; return { success: true } },
    })
    const r = await run('bilibili', { title: 't' }, 'bili_jct=x', { mode: 'api-then-dom', accountId: 'u1' })
    expect(domCalled).toBe(false)
    expect(r.track).toBe('api')
    expect(r.success).toBe(true)
    expect(r.publishId).toBe('BV1')
    expect(r.degraded).toBe(false)
    expect(r.reasonCode).toBe('ok')
    expect(r.apiAttempt.outcome).toBe('success')
  })

  it('API transient_error → 降级 DOM，结构化日志 degraded+reasonCode', async () => {
    const lg = capLogger()
    const run = createPublishWithMode({
      logger: lg,
      apiPublish: async () => ({ success: false, error: 'socket hang up' }),
      domPublish: async () => ({ success: true, publishId: 'DOM9' }),
    })
    const r = await run('shipinhao', { title: 't' }, 'ck', { mode: 'api-then-dom', accountId: 'a1' })
    expect(r.track).toBe('dom')
    expect(r.degraded).toBe(true)
    expect(r.reasonCode).toBe('transient_error_fallback')
    expect(r.success).toBe(true)
    expect(r.publishId).toBe('DOM9')
    expect(r.apiAttempt.outcome).toBe('transient_error')
    const degradeLog = lg.logs.find((l) => l.obj && l.obj.degraded === true)
    expect(degradeLog).toBeTruthy()
    expect(degradeLog.obj.reasonCode).toBe('transient_error_fallback')
  })

  it('API 抛异常 → 归一 transient_error → 降级', async () => {
    const run = createPublishWithMode({
      logger: capLogger(),
      apiPublish: async () => { throw new Error('ECONNREFUSED') },
      domPublish: async () => ({ success: true, publishId: 'D' }),
    })
    const r = await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'a1' })
    expect(r.degraded).toBe(true)
    expect(r.track).toBe('dom')
    expect(r.success).toBe(true)
  })

  it('risk_blocked → 停报，绝不降级（即便 api-then-dom）', async () => {
    const lg = capLogger()
    let domCalled = false
    const run = createPublishWithMode({
      logger: lg,
      apiPublish: async () => ({ success: false, riskBlocked: true, error: '触发风控' }),
      domPublish: async () => { domCalled = true; return { success: true } },
    })
    const r = await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'a1' })
    expect(domCalled).toBe(false)
    expect(r.degraded).toBe(false)
    expect(r.stopped).toBe(true)
    expect(r.success).toBe(false)
    expect(r.reasonCode).toBe('risk_blocked_stop')
    expect(r.track).toBe('api')
  })

  it('login_expired → 停报，不降级绕风控', async () => {
    const run = createPublishWithMode({
      logger: capLogger(),
      apiPublish: async () => ({ success: false, loginExpired: true, error: 'cookie 过期' }),
      domPublish: async () => ({ success: true }),
    })
    const r = await run('shipinhao', {}, 'c', { mode: 'api-then-dom', accountId: 'a1' })
    expect(r.reasonCode).toBe('login_expired_stop')
    expect(r.degraded).toBe(false)
    expect(r.success).toBe(false)
  })

  it('unsupported → api-then-dom 回落 DOM', async () => {
    const run = createPublishWithMode({
      logger: capLogger(),
      apiPublish: async () => ({ success: false, unsupported: true }),
      domPublish: async () => ({ success: true, publishId: 'D' }),
    })
    const r = await run('baijiahao', {}, 'c', { mode: 'api-then-dom', accountId: 'a1' })
    expect(r.degraded).toBe(true)
    expect(r.reasonCode).toBe('mode_unsupported_fallback')
    expect(r.track).toBe('dom')
  })

  it('降级但无 DOM 执行器 → requiresDom + degraded', async () => {
    const run = createPublishWithMode({
      logger: capLogger(),
      apiPublish: async () => ({ success: false, error: 'timeout' }),
    })
    const r = await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'a1' })
    expect(r.degraded).toBe(true)
    expect(r.requiresDom).toBe(true)
    expect(r.success).toBe(false)
  })
})

describe('publishWithMode：api-only 轨（任何失败停报不降级）', () => {
  it('transient_error 也停报', async () => {
    let domCalled = false
    const run = createPublishWithMode({
      logger: capLogger(),
      apiPublish: async () => ({ success: false, error: 'timeout' }),
      domPublish: async () => { domCalled = true; return { success: true } },
    })
    const r = await run('bilibili', {}, 'c', { mode: 'api-only', accountId: 'a1' })
    expect(domCalled).toBe(false)
    expect(r.success).toBe(false)
    expect(r.stopped).toBe(true)
    expect(r.reasonCode).toBe('api_failed_stop')
  })
})

describe('publishWithMode：spacer 18 分钟频控闸门', () => {
  it('首次放行并记录，同账号 18min 内二次被节流（零请求）', async () => {
    let apiCalls = 0
    let now = 0
    const sp = createPublishSpacer({ clock: () => now })
    const run = createPublishWithMode({
      logger: capLogger(), spacer: sp,
      apiPublish: async () => { apiCalls++; return { success: true, publishId: 'P' + apiCalls } },
    })
    const r1 = await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'u1' })
    expect(r1.success).toBe(true)
    expect(apiCalls).toBe(1)
    now = 17 * 60 * 1000 // 17:00 < 18:00
    const r2 = await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'u1' })
    expect(r2.track).toBe('throttled')
    expect(r2.success).toBe(false)
    expect(r2.reasonCode).toBe('throttled')
    expect(r2.waitMs).toBe(60 * 1000)
    expect(apiCalls).toBe(1) // 节流时不再发起 API 请求
    now = 18 * 60 * 1000 + 1 // 越过 18:00
    const r3 = await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'u1' })
    expect(r3.track).toBe('api')
    expect(apiCalls).toBe(2)
  })

  it('不同 accountId 独立，互不节流', async () => {
    const sp = createPublishSpacer({ clock: () => 0 })
    const run = createPublishWithMode({ logger: capLogger(), spacer: sp, apiPublish: async () => ({ success: true }) })
    expect((await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'A' })).track).toBe('api')
    expect((await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'B' })).track).toBe('api')
  })

  it('dom-only 轨同样受 spacer 约束', async () => {
    let domCalls = 0
    let now = 0
    const sp = createPublishSpacer({ clock: () => now })
    const run = createPublishWithMode({ logger: capLogger(), spacer: sp, domPublish: async () => { domCalls++; return { success: true } } })
    await run('weibo', {}, 'c', { mode: 'dom-only', accountId: 'x' })
    now = 60 * 1000
    const r = await run('weibo', {}, 'c', { mode: 'dom-only', accountId: 'x' })
    expect(r.track).toBe('throttled')
    expect(domCalls).toBe(1)
  })
})

describe('publishWithMode：模式来源与默认', () => {
  it('getMode 提供平台默认模式；opts.mode 覆盖之', async () => {
    let lastApi = false
    const run = createPublishWithMode({
      logger: capLogger(),
      getMode: (p) => (p === 'weibo' ? 'dom-only' : 'api-then-dom'),
      apiPublish: async () => { lastApi = true; return { success: true } },
      domPublish: async () => { lastApi = false; return { success: true } },
    })
    await run('weibo', {}, 'c', { accountId: 'a' })
    expect(lastApi).toBe(false) // dom-only from getMode
    await run('weibo', {}, 'c', { accountId: 'a', mode: 'api-then-dom' }) // opts override
    expect(lastApi).toBe(true)
  })

  it('无 mode → 默认 api-then-dom', async () => {
    const run = createPublishWithMode({ logger: capLogger(), apiPublish: async () => ({ success: true }) })
    const r = await run('bilibili', {}, 'c', { accountId: 'a' })
    expect(r.mode).toBe('api-then-dom')
    expect(r.track).toBe('api')
  })

  it('无 api 执行器 + api-then-dom + 有 dom → 回落 DOM', async () => {
    const run = createPublishWithMode({ logger: capLogger(), domPublish: async () => ({ success: true, publishId: 'D' }) })
    const r = await run('bilibili', {}, 'c', { mode: 'api-then-dom', accountId: 'a' })
    expect(r.degraded).toBe(true)
    expect(r.track).toBe('dom')
    expect(r.success).toBe(true)
  })
})
