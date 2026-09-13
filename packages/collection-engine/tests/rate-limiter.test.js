import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { RateLimiter, jitter, isWeekend, isInActiveHours } = req('../src/rate-limiter')

describe('jitter', () => {
  it('should return min when max <= min', () => {
    expect(jitter(100, 100)).toBe(100)
  })

  it('should return value in range with mock rng', () => {
    expect(jitter(100, 200, () => 0)).toBe(100)
    expect(jitter(100, 200, () => 0.999)).toBe(199)
  })
})

describe('isWeekend', () => {
  it('should detect Sunday', () => {
    expect(isWeekend(new Date('2026-09-13T12:00:00'))).toBe(true) // Sunday
  })

  it('should detect Saturday', () => {
    expect(isWeekend(new Date('2026-09-12T12:00:00'))).toBe(true) // Saturday
  })

  it('should not flag Monday', () => {
    expect(isWeekend(new Date('2026-09-14T12:00:00'))).toBe(false)
  })
})

describe('isInActiveHours', () => {
  it('should be true inside active hours', () => {
    expect(isInActiveHours(new Date('2026-09-10T10:00:00'), { start: 8, end: 22 })).toBe(true)
  })

  it('should be false outside active hours', () => {
    expect(isInActiveHours(new Date('2026-09-10T02:00:00'), { start: 8, end: 22 })).toBe(false)
  })

  it('should be false at exact end hour', () => {
    expect(isInActiveHours(new Date('2026-09-10T22:00:00'), { start: 8, end: 22 })).toBe(false)
  })
})

describe('RateLimiter', () => {
  let clock
  let limiter

  beforeEach(() => {
    clock = { current: new Date('2026-09-10T10:00:00').getTime() }
    limiter = new RateLimiter({
      now: () => new Date(clock.current),
      rng: Math.random,
    })
  })

  function tick (ms) { clock.current += ms }

  it('should allow first request immediately', () => {
    const strategy = {
      platform: 'test', accountId: 'acc1',
      interval: { min: 5000, max: 5000 },
      activeHours: { start: 0, end: 24 },
      weekendFactor: 1,
    }
    const result = limiter.evaluate(strategy)
    expect(result.allowed).toBe(true)
  })

  it('should block second request within interval', () => {
    const strategy = {
      platform: 'test', accountId: 'acc1',
      interval: { min: 5000, max: 5000 },
      activeHours: { start: 0, end: 24 },
      weekendFactor: 1,
    }
    limiter.recordRequest('test', 'acc1')
    tick(2000) // 2s elapsed, need 5s
    const result = limiter.evaluate(strategy)
    expect(result.allowed).toBe(false)
    expect(result.waitMs).toBeGreaterThan(0)
  })

  it('should allow second request after interval', () => {
    const strategy = {
      platform: 'test', accountId: 'acc1',
      interval: { min: 5000, max: 5000 },
      activeHours: { start: 0, end: 24 },
      weekendFactor: 1,
    }
    limiter.recordRequest('test', 'acc1')
    tick(6000) // 6s elapsed
    const result = limiter.evaluate(strategy)
    expect(result.allowed).toBe(true)
  })

  it('should block outside active hours', () => {
    const offHours = { current: new Date('2026-09-10T03:00:00').getTime() }
    const nightLimiter = new RateLimiter({
      now: () => new Date(offHours.current),
    })
    const strategy = {
      platform: 'test', accountId: 'acc1',
      interval: { min: 5000, max: 5000 },
      activeHours: { start: 8, end: 22 },
      weekendFactor: 1,
    }
    const result = nightLimiter.evaluate(strategy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('outside-active-hours')
  })

  // 回归保护：手动采集（manual: true）在非活跃时段应放行（2026-09-13）。
  // 根因：用户 22 点后手动点击采集知乎被 outside-active-hours 拦截，
  // 但 url-collector 统一返回「请求频率受限」→ 前端显示「请求过于频繁，被平台限流」。
  // 手动采集是用户主动行为，不应受「模拟人工活跃时段」限制（与 weekend-throttle 豁免同理）。
  it('manual mode should bypass active hours check', () => {
    const offHours = { current: new Date('2026-09-10T23:00:00').getTime() }
    const nightLimiter = new RateLimiter({
      now: () => new Date(offHours.current),
    })
    const strategy = {
      platform: 'test', accountId: 'acc1',
      interval: { min: 5000, max: 5000 },
      activeHours: { start: 8, end: 22 },
      weekendFactor: 1,
      manual: true,
    }
    const result = nightLimiter.evaluate(strategy)
    expect(result.allowed).toBe(true)
  })

  it('non-manual mode still blocked outside active hours', () => {
    const offHours = { current: new Date('2026-09-10T23:00:00').getTime() }
    const nightLimiter = new RateLimiter({
      now: () => new Date(offHours.current),
    })
    const strategy = {
      platform: 'test', accountId: 'acc1',
      interval: { min: 5000, max: 5000 },
      activeHours: { start: 8, end: 22 },
      weekendFactor: 1,
      manual: false,
    }
    const result = nightLimiter.evaluate(strategy)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('outside-active-hours')
  })

  it('should reset state', () => {
    const strategy = {
      platform: 'test', accountId: 'acc1',
      interval: { min: 5000, max: 5000 },
      activeHours: { start: 0, end: 24 },
      weekendFactor: 1,
    }
    limiter.recordRequest('test', 'acc1')
    limiter.reset('test', 'acc1')
    const result = limiter.evaluate(strategy)
    expect(result.allowed).toBe(true)
  })
})
