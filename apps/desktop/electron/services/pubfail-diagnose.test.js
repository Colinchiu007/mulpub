/**
 * pubfail-diagnose.test.js — P0-8 发布失败被动附带诊断（PR-2）
 *
 * 契约来源：.adversarial/pubfail-diagnose-pr2-20260923/proposal-v3.md（两轮 CCG 评审收敛终版）
 * 合同要点：
 *  - maybeDiagnose 同步返回应挂的码（string）或 null；内部永不抛（N-3）
 *  - 分类唯一事实源 = classifyProviderFailure ∈ {'rate','quota'}（C-4）
 *  - 缓存/节流/in-flight 全部 per-key（N-5）；setProviderLimits 经 invalidateDiagnoseCache 失效
 *  - 探针自适应（N-4）：effRpm≥20 用真实配置（requestCount 3/4 档），否则默认探针 probeMode='default'
 *  - 一码至多一行结论日志（C-9 settled）；shutdown 后不触发、迟到丢弃（C-10）
 *  - deps 未装配时禁用（enabled=false），零副作用——主链路既有测试不受影响
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pubfail = require('./pubfail-diagnose')
const { ProviderError, ERROR_CODES } = require('./adapters/_base/provider-error')

/** 可控 fake 自检：返回 pending promise，由测试决定何时 resolve 及结论 */
function createFakeSelfCheck () {
  const calls = []
  let resolveNext = null
  const runSelfCheck = vi.fn((params) => new Promise((resolve) => {
    calls.push(params)
    resolveNext = resolve
  }))
  return {
    runSelfCheck,
    calls,
    /** 完成第 n 个在途自检 */
    finish: (result) => { const r = resolveNext; resolveNext = null; if (r) r(result) },
  }
}

function okResult (totalMs = 3000) {
  return {
    engine: 'real-governor',
    metrics: { total_duration_ms: totalMs, rate_limited_count: 0, network_calls: 0, max_concurrent_observed: 1 },
    assertions: [{ name: 'max_concurrent', pass: true }, { name: 'no_rate_limited', pass: true }, { name: 'no_network', pass: true }],
    timeline: [],
  }
}

function makeLog () {
  const lines = []
  return {
    lines,
    notify: (module, messageKey, meta) => lines.push({ module, messageKey, meta }),
    info: () => {}, warn: () => {}, error: () => {},
  }
}

let fakeApp
let quitHandler

beforeEach(() => {
  vi.useFakeTimers()
  fakeApp = {
    on: (event, cb) => { if (event === 'before-quit') quitHandler = cb },
  }
  pubfail.__resetDiagnoseState()
})

afterEach(() => {
  vi.useRealTimers()
  pubfail.__resetDiagnoseState()
})

function setupDeps (overrides = {}) {
  const fake = createFakeSelfCheck()
  const log = makeLog()
  pubfail.setDiagnoseDeps({
    log,
    app: fakeApp,
    runSelfCheck: fake.runSelfCheck,
    ...overrides,
    ...(overrides.selfCheck ? { runSelfCheck: overrides.selfCheck } : {}),
  })
  pubfail.setEnabled(true)
  return { fake, log }
}

describe('分类触发（classifyProviderFailure 唯一事实源）', () => {
  it('governor 排队超时 ProviderError(RATE_LIMITED) → 返回码并触发自检', async () => {
    const { fake } = setupDeps()
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '排队等待超时，请稍后重试。', { providerId: 'p:llm' })
    const code = pubfail.maybeDiagnose(err, { source: 'governor', key: 'openai:llm' })
    expect(code).toMatch(/^D-[0-9a-z]{6}$/)
    expect(fake.runSelfCheck).toHaveBeenCalledTimes(1)
  })

  it('_pace「当前请求频率已达上限」→ 触发', () => {
    setupDeps()
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '当前请求频率已达上限，请稍后再试。', { providerId: 'k' })
    expect(pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })).toMatch(/^D-/)
  })

  it('QUOTA_EXCEEDED → 触发（quota 类别）', async () => {
    const { log, fake } = setupDeps()
    const err = new ProviderError(ERROR_CODES.QUOTA_EXCEEDED, '该模型 API 的每 5 小时 token 额度（100）已用完。', { providerId: 'k' })
    const code = pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })
    expect(code).toMatch(/^D-/)
    fake.finish(okResult())
    await flushMicrotasks()
    expect(log.lines.at(-1).meta.errorCategory).toBe('quota_exceeded')
  })

  it('batch {message} 裸形状含 429 文本 → 文本模式命中触发', () => {
    setupDeps()
    const code = pubfail.maybeDiagnose({ message: '发布失败：HTTP 429 Too Many Requests' }, { source: 'batch', key: 'batch:publish' })
    expect(code).toMatch(/^D-/)
  })

  it('非限流错误 / null / 非对象 → null 且零副作用', () => {
    const { fake } = setupDeps()
    expect(pubfail.maybeDiagnose(new Error('参数非法'), { source: 'governor', key: 'a:llm' })).toBeNull()
    expect(pubfail.maybeDiagnose(null, { source: 'governor', key: 'a:llm' })).toBeNull()
    expect(pubfail.maybeDiagnose('rate limited', { source: 'governor', key: 'a:llm' })).toBeNull()
    expect(pubfail.maybeDiagnose({ message: '内容政策拒绝' }, { source: 'batch', key: 'a:llm' })).toBeNull()
    expect(fake.runSelfCheck).not.toHaveBeenCalled()
  })

  it('deps 未装配（禁用态）→ null，零副作用（主链路既有行为不变）', () => {
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', { providerId: 'k' })
    expect(pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })).toBeNull()
  })
})

describe('永不抛合同（N-3）', () => {
  it('runSelfCheck 同步抛错 → maybeDiagnose 不外抛，结论 fail 落日志', () => {
    const { log } = setupDeps({ selfCheck: () => { throw new TypeError('boom') } })
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', { providerId: 'k' })
    expect(() => pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })).not.toThrow()
    return vi.advanceTimersByTimeAsync(0).then(() => {
      const line = log.lines.find((l) => l.messageKey === 'publish.diagnose_result')
      expect(line.meta.level).toBe('fail')
    })
  })

  it('getLimits 抛错 → 不阻断，降级默认探针', () => {
    const { fake } = setupDeps()
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', { providerId: 'k' })
    pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm', getLimits: () => { throw new Error('no limits') } })
    expect(fake.calls[0]).toMatchObject({ rpm: 60, requestCount: 4 })
  })
})

describe('缓存/节流/in-flight per-key（N-5/C-5）', () => {
  function fakeSequential () {
    const queue = []
    const calls = []
    const runSelfCheck = vi.fn((params) => {
      calls.push(params)
      let res
      queue.push(() => res(okResult()))
      return new Promise((resolve) => { res = resolve })
    })
    return { runSelfCheck, calls, queue }
  }

  it('TTL 内同 key 复用同一码且不重跑自检', async () => {
    const s = fakeSequential()
    setupDeps({ selfCheck: s.runSelfCheck })
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', { providerId: 'k' })
    const c1 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'openai:llm' })
    s.queue.shift()() // 完成自检
    await vi.advanceTimersByTimeAsync(0)
    const c2 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'openai:llm' })
    expect(c2).toBe(c1)
    expect(s.runSelfCheck).toHaveBeenCalledTimes(1)
  })

  it('异 key 不串（openai vs minimax 各自发码）', async () => {
    const s = fakeSequential()
    setupDeps({ selfCheck: s.runSelfCheck })
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', { providerId: 'k' })
    const c1 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'openai:llm' })
    s.queue.shift()()
    await vi.advanceTimersByTimeAsync(0)
    const c2 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'minimax:llm' })
    expect(c2).not.toBe(c1)
    expect(s.runSelfCheck).toHaveBeenCalledTimes(2)
  })

  it('在途复用同一码（自检未完成时新失败不再触发）', () => {
    const s = fakeSequential()
    setupDeps({ selfCheck: s.runSelfCheck })
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', { providerId: 'k' })
    const c1 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })
    const c2 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })
    expect(c2).toBe(c1)
    expect(s.runSelfCheck).toHaveBeenCalledTimes(1)
  })

  it('invalidateDiagnoseCache(key) 后新失败发新码（setProviderLimits 失效路径）', async () => {
    const s = fakeSequential()
    setupDeps({ selfCheck: s.runSelfCheck })
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', { providerId: 'k' })
    const c1 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })
    s.queue.shift()()
    await vi.advanceTimersByTimeAsync(0)
    pubfail.invalidateDiagnoseCache('k:llm')
    const c2 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })
    expect(c2).not.toBe(c1)
  })

  it('缓存 TTL 10min 过期后重跑', async () => {
    const s = fakeSequential()
    setupDeps({ selfCheck: s.runSelfCheck })
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', { providerId: 'k' })
    const c1 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })
    s.queue.shift()()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1)
    const c2 = pubfail.maybeDiagnose(err, { source: 'governor', key: 'k:llm' })
    expect(c2).not.toBe(c1)
    expect(s.runSelfCheck).toHaveBeenCalledTimes(2)
  })
})

describe('探针自适应（N-4）', () => {
  it('effRpm≥30 → 真实配置探针 requestCount=4', () => {
    const { fake } = setupDeps()
    pubfail.maybeDiagnose(new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', {}), {
      source: 'governor', key: 'k:llm', getLimits: () => ({ effRpm: 30, rpm: 30, maxConcurrent: 2, cooldownMs: 30000 }),
    })
    expect(fake.calls[0]).toMatchObject({ rpm: 30, requestCount: 4, maxConcurrent: 2, cooldownMs: 30000 })
  })

  it('20≤effRpm<30 → requestCount=3', () => {
    const { fake } = setupDeps()
    pubfail.maybeDiagnose(new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', {}), {
      source: 'governor', key: 'k:llm', getLimits: () => ({ effRpm: 25, rpm: 30, maxConcurrent: 2, cooldownMs: 30000 }),
    })
    expect(fake.calls[0]).toMatchObject({ rpm: 25, requestCount: 3 })
  })

  it('effRpm<20（video rpm 4）→ 默认探针（避免理论 45s 恒超时假 fail）', () => {
    const { fake } = setupDeps()
    pubfail.maybeDiagnose(new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', {}), {
      source: 'governor', key: 'k:video', getLimits: () => ({ effRpm: 4, rpm: 4, maxConcurrent: 2, cooldownMs: 60000 }),
    })
    expect(fake.calls[0]).toMatchObject({ rpm: 60, requestCount: 4 })
  })

  it('真实 limits 越界被 _validate 拒（TypeError）→ 回退默认探针重跑', async () => {
    const calls = []
    const runSelfCheck = vi.fn((params) => {
      calls.push(params)
      if (calls.length === 1) return Promise.reject(new TypeError('cooldownMs 必须是 [100,60000] 的整数或留空'))
      return Promise.resolve(okResult())
    })
    const { log } = setupDeps({ selfCheck: runSelfCheck })
    pubfail.maybeDiagnose(new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', {}), {
      source: 'governor', key: 'k:llm', getLimits: () => ({ effRpm: 30, rpm: 30, maxConcurrent: 2, cooldownMs: 90000 }),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.length).toBe(2)
    expect(calls[1]).toMatchObject({ rpm: 60 })
    const line = log.lines.find((l) => l.messageKey === 'publish.diagnose_result')
    expect(line.meta.probeMode).toBe('default-fallback')
  })
})

describe('超时 settled（C-9）与 level 映射（C-8）', () => {
  it('硬超时 → fail 一行；迟到结论丢弃不写第二行', async () => {
    let lateResolve
    const runSelfCheck = vi.fn(() => new Promise((r) => { lateResolve = r }))
    const { log } = setupDeps({ selfCheck: runSelfCheck })
    pubfail.maybeDiagnose(new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', {}), { source: 'governor', key: 'k:llm' })
    await vi.advanceTimersByTimeAsync(10_001)
    const lines = log.lines.filter((l) => l.messageKey === 'publish.diagnose_result')
    expect(lines.length).toBe(1)
    expect(lines[0].meta.level).toBe('fail')
    lateResolve(okResult())
    await vi.advanceTimersByTimeAsync(0)
    expect(log.lines.filter((l) => l.messageKey === 'publish.diagnose_result').length).toBe(1)
  })

  it('level 映射：全 pass 且时长≤1.5×理论→ok；超→warn；断言失败→fail', () => {
    setupDeps()
    const the = 3020
    expect(pubfail._internal.levelOf(okResult(3000), the).level).toBe('ok')
    expect(pubfail._internal.levelOf(okResult(9999), the).level).toBe('warn')
    const bad = okResult(100)
    bad.assertions[0].pass = false
    expect(pubfail._internal.levelOf(bad, the).level).toBe('fail')
  })
})

describe('生命周期（C-10）', () => {
  it('before-quit 后不再触发；在途结论迟到不写日志', async () => {
    let lateResolve
    const runSelfCheck = vi.fn(() => new Promise((r) => { lateResolve = r }))
    const { log } = setupDeps({ selfCheck: runSelfCheck })
    const err = new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', {})
    pubfail.maybeDiagnose(err, { source: 'governor', key: 'k1:llm' })
    quitHandler()
    lateResolve(okResult())
    await vi.advanceTimersByTimeAsync(0)
    expect(log.lines.filter((l) => l.messageKey === 'publish.diagnose_result').length).toBe(0)
    expect(pubfail.maybeDiagnose(err, { source: 'governor', key: 'k2:llm' })).toBeNull()
  })
})

describe('结论日志合同（§4）', () => {
  it('恰好一行：module/messageKey/字段齐全，assertionsSummary ≤500', async () => {
    const { log, fake } = setupDeps()
    pubfail.maybeDiagnose(new ProviderError(ERROR_CODES.RATE_LIMITED, '限流', {}), { source: 'governor', key: 'k:llm' })
    fake.finish(okResult())
    await vi.advanceTimersByTimeAsync(0)
    const line = log.lines.find((l) => l.messageKey === 'publish.diagnose_result')
    expect(line.module).toBe('publishDiagnose')
    expect(line.meta).toMatchObject({ errorCategory: 'rate_limited', level: 'ok', source: 'governor', probeMode: 'default' })
    expect(line.meta.code).toMatch(/^D-[0-9a-z]{6}$/)
    expect(line.meta.assertionsSummary.length).toBeLessThanOrEqual(500)
    expect(log.lines.filter((l) => l.messageKey === 'publish.diagnose_result').length).toBe(1)
  })
})

// —— 工具：冲刷微任务/即时 promise ——
function flushMicrotasks () {
  return vi.advanceTimersByTimeAsync(0)
}
