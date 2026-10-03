import { describe, expect, it, vi } from 'vitest'

const { ApiUsageGovernor } = require('./api-usage-governor')
const { ProviderError, ERROR_CODES, classifyProviderFailure } = require('./adapters/_base/provider-error')

/** 构造带 notify 的真实 logger 注入，便于断言埋点。 */
function makeGovernor(extra = {}) {
  const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
  const g = new ApiUsageGovernor({ log, maxPaceWaitMs: 10, ...extra })
  return { g, log }
}

describe('ApiUsageGovernor 观测性埋点（T4.1/T4.2）', () => {
  it('pace 超过等待预算时发射 pace-over-limit 且不吞异常', async () => {
    const { g, log } = makeGovernor()
    g.setLimits('p:llm:m', { maxConcurrent: 8, rpm: 1, cooldownMs: 1000, retry429: 3 })
    // 模拟已有请求把时间槽推进到很远的未来，使本次 waitMs 远超 maxPaceWaitMs 预算
    const st = g._stateFor('p:llm:m')
    st.nextSlotAt = Date.now() + 10 * 60 * 1000
    await expect(
      g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => 'a'),
    ).rejects.toThrow()
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'pace-over-limit',
      expect.objectContaining({ errorCategory: 'rate_limit', level: 'WARN', params: expect.objectContaining({ key: 'p:llm:m' }) }),
    )
  })

  it('冷却期超过上限时发射 cooldown-over-limit 且不吞异常', async () => {
    const { g, log } = makeGovernor()
    g.setLimits('p:llm:m', { maxConcurrent: 8, rpm: 1000, cooldownMs: 1000, retry429: 3 })
    const st = g._stateFor('p:llm:m')
    st.cooldownUntil = Date.now() + 10 * 60 * 1000 // 10 分钟冷却，远超 MAX_COOLDOWN_WAIT_MS
    await expect(
      g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => 'a'),
    ).rejects.toThrow()
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'cooldown-over-limit',
      expect.objectContaining({ errorCategory: 'rate_limit', level: 'WARN', params: expect.objectContaining({ key: 'p:llm:m' }) }),
    )
  })

  it('token 额度超限时发射 quota-exceeded 且不吞异常', async () => {
    const { g, log } = makeGovernor()
    g.setLimits('p:llm:m', { maxConcurrent: 8, rpm: 1000, cooldownMs: 1000, retry429: 3 })
    g.setTokenWindows('p:llm:m', [{ windowMs: 60 * 60 * 1000, limit: 5, field: 'tokens' }])
    // 不预置 used：准入时 used(0) < limit 放行，真实响应把窗口累计推过 limit，
    // 由 _assertTokenBudget 事后断言兜底（这正是本埋点要覆盖的「调用已发出、随后才超额」形态）。
    await expect(
      g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => ({ usage: { tokens: 10 } })),
    ).rejects.toThrow()
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'quota-exceeded',
      expect.objectContaining({ errorCategory: 'quota', level: 'ERROR', params: expect.objectContaining({ key: 'p:llm:m', field: 'tokens', limit: 5 }) }),
    )
  })

  it('429 重试耗尽时发射 retry429-exhausted 且不吞异常', async () => {
    const { g, log } = makeGovernor()
    g.setLimits('p:llm:m', { maxConcurrent: 8, rpm: 1000, cooldownMs: 1000, retry429: 2 })
    const rateErr = new ProviderError(ERROR_CODES.RATE_LIMITED, 'rate')
    expect(classifyProviderFailure(rateErr)).toBe('rate')
    await expect(
      g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => { throw rateErr }),
    ).rejects.toThrow()
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'retry429-exhausted',
      expect.objectContaining({ errorCategory: 'rate_limit', level: 'ERROR', params: expect.objectContaining({ key: 'p:llm:m' }) }),
    )
  })

  it('瞬时错误重试耗尽时发射 transient-retry-exhausted 且不吞异常', async () => {
    const { g, log } = makeGovernor()
    g.setLimits('p:llm:m', { maxConcurrent: 8, rpm: 1000, cooldownMs: 1000, retry429: 3 })
    const transientErr = new ProviderError(ERROR_CODES.NETWORK_ERROR, 'net down')
    expect(classifyProviderFailure(transientErr)).toBe('transient')
    await expect(
      g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => { throw transientErr }),
    ).rejects.toThrow()
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'transient-retry-exhausted',
      expect.objectContaining({ errorCategory: 'transient', level: 'ERROR', params: expect.objectContaining({ key: 'p:llm:m' }) }),
    )
  })

  it('业务错误（非限流/非瞬时）发射 provider-error 且不吞异常', async () => {
    const { g, log } = makeGovernor()
    g.setLimits('p:llm:m', { maxConcurrent: 8, rpm: 1000, cooldownMs: 1000, retry429: 3 })
    const bizErr = new ProviderError(ERROR_CODES.AUTH_FAILED, 'bad key')
    expect(classifyProviderFailure(bizErr)).toBe('other')
    await expect(
      g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => { throw bizErr }),
    ).rejects.toThrow()
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'provider-error',
      expect.objectContaining({ errorCategory: 'other', level: 'ERROR', params: expect.objectContaining({ key: 'p:llm:m' }) }),
    )
  })

  it('排队超时时发射 queue-timeout 且不吞异常', async () => {
    const { g, log } = makeGovernor()
    g.setLimits('p:llm:m', { maxConcurrent: 1, rpm: 1000, cooldownMs: 1000, retry429: 3 })
    const st = g._stateFor('p:llm:m')
    st.waiters.push({ resolve() {}, reject() {}, deadline: Date.now() - 10 })
    expect(() => g._sweepExpired('p:llm:m', st)).not.toThrow()
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'queue-timeout',
      expect.objectContaining({ errorCategory: 'rate_limit', level: 'WARN', params: expect.objectContaining({ key: 'p:llm:m' }) }),
    )
  })

  it('长重试风暴下 retry-attempt 通知受 maxBurst 硬上限约束（P1-4）', async () => {
    // 快速集成验证：retry429:5 + sampleEvery:1/maxBurst:5。
    // 注意 _executeWithRetry 每次失败都会 await sleep(jitter(·))，jitter 自带 0~1500ms 抖动，
    // 故这里只跑少量重试来验证「governor 实际驱动采样器、首必记 + 中间封顶」——
    // 穷尽式 burst 边界（maxBurst 精确值）由 log-storm-guard.test.js 独立覆盖。
    // 期望：attempt1 首条必记 + attempt2/3/4 中间抽样 + attempt5 被 middleCap(=3) 截断 = 4 条。
    const { g, log } = makeGovernor({ retryLogSampleEvery: 1, retryLogMaxBurst: 5 })
    g.setLimits('p:llm:m', { maxConcurrent: 8, rpm: 1000, cooldownMs: 0, retry429: 5 })
    const rateErr = new ProviderError(ERROR_CODES.RATE_LIMITED, 'rate')
    await expect(
      g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => { throw rateErr }),
    ).rejects.toThrow()
    const retryAttemptHits = log.notify.mock.calls.filter((c) => c[1] === 'retry-attempt').length
    expect(retryAttemptHits).toBeLessThanOrEqual(5) // 整体 ≤ maxBurst
    expect(retryAttemptHits).toBe(4) // 1(首) + 3(中间每1抽样，受 middleCap 截断)
    // 首条必记
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'retry-attempt',
      expect.objectContaining({ params: expect.objectContaining({ attempt: 1 }) }),
    )
    // 语义末条（耗尽通知）必记
    expect(log.notify).toHaveBeenCalledWith(
      'ApiGovernor',
      'retry429-exhausted',
      expect.objectContaining({ params: expect.objectContaining({ key: 'p:llm:m' }) }),
    )
  })
})
