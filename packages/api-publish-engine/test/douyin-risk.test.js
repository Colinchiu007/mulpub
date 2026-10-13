// §5.1 抖音风控信号端到端接线回归
// 覆盖：x-tt-verify-passport-decision / status_code===110 两类信号 → outcome risk_blocked →
// 双轨 runner 停报不降级 + 挂起 platform::accountId（复用 W1 通用基建），二次调用命中挂起零请求。
// 合规：风控即停、绝不自动换号；全用例假发布者，零外发。
const { createPublishWithMode, outcomeOfResult } = require('../src/publish/core/publish-mode-runner')
const { createRiskSuspender } = require('../src/publish/core/risk-suspender')
const DouyinAdapter = require('../src/adapters/douyin.js')
const { errorCode } = require('../src/error-codes.js')

const silentLogger = { info () {}, warn () {}, error () {} }

describe('§5.1 抖音风控信号 → outcomeOfResult 归一', () => {
  it('x-tt-verify-passport-decision 命中（链返回 risk_blocked）→ risk_blocked', () => {
    const res = { success: false, risk_blocked: true, platform: 'douyin', error: '抖音触发安全验证，请在创作者中心手动完成验证后重试（不自动换号）' }
    expect(outcomeOfResult(res)).toBe('risk_blocked')
  })

  it('status_code===110 验证失败（链返回 risk_blocked）→ risk_blocked', () => {
    const res = { success: false, risk_blocked: true, platform: 'douyin', error: '抖音验证失败(110)，请手动完成验证后重试' }
    expect(outcomeOfResult(res)).toBe('risk_blocked')
  })

  it('即便漏置 risk_blocked 标志，错误文案含"验证/verify"仍被 RISK_RE 兜底识别', () => {
    const res = { success: false, platform: 'douyin', code: errorCode.request_error, error: '抖音安全 verify 拦截' }
    expect(outcomeOfResult(res)).toBe('risk_blocked')
  })
})

// CCG 深度审查 i3：outcomeOfResult 曾另持一张**私有码表**（只含 BILI_RISK_601 / 10000015 / -1e7，
// 缺裸 601 与 RISK_BLOCKED），于是「code:601 + 普通文本」在引擎轨被判 transient_error →
// 降级 DOM 且不挂起，而同一失败在桌面轨（经 task.errorCode）却判 strong 并挂起 —— 两侧分裂。
// 本组锁钉住「路由判据也走单一真源」。
describe('§5.1 路由判据与码族单一真源（CCG 深度审查 i3）', () => {
  it('裸码 601 + 普通文本 → risk_blocked（旧私有码表漏判，会错误降级 DOM）', () => {
    expect(outcomeOfResult({ success: false, platform: 'bilibili', code: 601, error: '平台拒绝了本次请求' })).toBe('risk_blocked')
  })

  it('字符串码 601 / RISK_BLOCKED → risk_blocked', () => {
    expect(outcomeOfResult({ success: false, platform: 'bilibili', code: '601', error: '平台拒绝了本次请求' })).toBe('risk_blocked')
    expect(outcomeOfResult({ success: false, platform: 'douyin', code: 'RISK_BLOCKED', error: '平台拒绝了本次请求' })).toBe('risk_blocked')
  })

  it('非风控码 + 普通文本 → 仍按 transient_error（不误升为风控）', () => {
    expect(outcomeOfResult({ success: false, platform: 'douyin', code: 500, error: '服务异常请稍后重试' })).toBe('transient_error')
    expect(outcomeOfResult({ success: false, platform: 'douyin', code: 6019, error: 'publish id 6019 not found' })).toBe('transient_error')
  })
})

describe('§5.1 DouyinAdapter.execute 透传风控信号（链抛 → risk_blocked）', () => {
  it('链 run 抛带 risk_blocked 的异常 → 适配器结果 risk_blocked=true → outcome risk_blocked', async () => {
    const a = new DouyinAdapter()
    const err = new Error('抖音验证失败(110)'); err.risk_blocked = true; err.code = errorCode.request_error
    a._chainOverride = { run: async () => { throw err } }
    try {
      const r = await a.execute({ title: 'T', video: { path: 'D:\\x.mp4' } }, 'cookie=x', { accountId: 'acct1' })
      expect(r.risk_blocked).toBe(true)
      expect(outcomeOfResult(r)).toBe('risk_blocked')
    } finally { delete a._chainOverride }
  })
})

describe('§5.1 双轨 runner：抖音风控停报不降级 + 挂起 platform::accountId', () => {
  function build (apiResults) {
    const events = []
    const suspender = createRiskSuspender({ notify: (e) => events.push(e), logger: silentLogger })
    let domCalls = 0
    let apiCalls = 0
    let i = 0
    const runner = createPublishWithMode({
      apiPublish: async () => { apiCalls++; const r = apiResults[Math.min(i++, apiResults.length - 1)]; return r },
      domPublish: async () => { domCalls++; return { success: true, publishId: 'DOM' } },
      getMode: () => 'api-then-dom',
      logger: silentLogger,
      riskSuspender: suspender,
    })
    return { runner, events, suspender, counts: () => ({ domCalls, apiCalls }) }
  }

  const xttRisk = { success: false, risk_blocked: true, platform: 'douyin', error: '抖音触发安全验证' }

  it('首条命中风控：停报不降级（track api、stopped、未降级、DOM 零调用）+ 挂起 douyin::acct1 + 广播 suspend', async () => {
    const ctx = build([xttRisk])
    const res = await ctx.runner('douyin', { title: 'T', video: { path: 'D:\\x.mp4' } }, 'cookie=x', { accountId: 'acct1' })
    expect(res.stopped).toBe(true)
    expect(res.degraded).toBe(false)
    expect(res.track).toBe('api')
    expect(res.success).toBe(false)
    expect(res.reasonCode).toBe('risk_blocked_stop')
    expect(ctx.counts().domCalls).toBe(0) // 风控绝不回落 DOM 换路
    expect(ctx.suspender.isSuspended('douyin', 'acct1')).toBe(true)
    const susp = ctx.events.find((e) => e.type === 'suspend')
    expect(susp).toBeTruthy()
    expect(susp.platform).toBe('douyin')
    expect(susp.accountId).toBe('acct1')
  })

  it('二次同账号发布命中挂起守卫：直接停、apiPublish 不再触网（零请求，绝不自动换号）', async () => {
    const ctx = build([xttRisk])
    await ctx.runner('douyin', { title: 'T', video: { path: 'D:\\x.mp4' } }, 'cookie=x', { accountId: 'acct1' })
    const before = ctx.counts().apiCalls
    const res2 = await ctx.runner('douyin', { title: 'T2', video: { path: 'D:\\x.mp4' } }, 'cookie=x', { accountId: 'acct1' })
    expect(res2.track).toBe('suspended')
    expect(res2.stopped).toBe(true)
    expect(ctx.counts().apiCalls).toBe(before) // 挂起后不再发起任何 API 请求
    expect(ctx.counts().domCalls).toBe(0)
  })

  it('挂起是细粒度：仅命中该账号，其他账号/平台不受影响仍走 API', async () => {
    const ctx = build([xttRisk, { success: true, publishId: 'OK2', platform: 'douyin' }])
    await ctx.runner('douyin', { title: 'T', video: { path: 'D:\\x.mp4' } }, 'cookie=x', { accountId: 'acct1' })
    const resOther = await ctx.runner('douyin', { title: 'T2', video: { path: 'D:\\y.mp4' } }, 'cookie2=y', { accountId: 'acct2' })
    expect(ctx.suspender.isSuspended('douyin', 'acct2')).toBe(false)
    expect(resOther.track).toBe('api')
    expect(resOther.success).toBe(true)
  })
})
