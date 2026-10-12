// @ts-check
/**
 * 账号级采集节流回归（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §7.1 T1–T4）
 *
 * 这一层的风险全在「边界静默失效」：抖动比例非法会让延迟恒等于基准（退化成机器特征）、
 * 日上限写错会让用户连点刷新把额度打光、熔断阈值写错会把一次网络抖动放大成账号永久停采。
 * 所以逐条断言具体数字，而不是断言「有返回值」。
 */
import { describe, it, expect } from 'vitest'

const { AccountMetricsThrottle, utcDayKey } = require('./throttle')
const { MAX_CONSECUTIVE_FAILURES } = require('./constants')

const DAY = 24 * 3600 * 1000

describe('AccountMetricsThrottle.pageDelayMs', () => {
  it('T1 延迟落在 [base, base*(1+ratio)] 且两次调用不相等（V4 抖动真的在起作用）', () => {
    let seq = 0
    const values = [0, 0.5, 1]
    const t = new AccountMetricsThrottle({
      pageDelayBaseMs: 1000,
      pageDelayJitterRatio: 0.5,
      random: () => values[seq++ % values.length],
    })
    const a = t.pageDelayMs()
    const b = t.pageDelayMs()
    const c = t.pageDelayMs()
    expect(a).toBe(1000)
    expect(b).toBe(1250)
    expect(c).toBe(1500)
    // 关键反证：连续调用必须可能不相等，否则「加抖动」是空话
    expect(new Set([a, b, c]).size).toBeGreaterThan(1)
  })

  it('T1b 随机源非法时绝不产出 NaN 延迟（NaN 会让 setTimeout 立即触发 ⇒ 节流失效）', () => {
    // 非有限值（NaN/Infinity）⇒ 退回基准；有限但越界 ⇒ 钳到 [0,1] 边界
    const cases = [[NaN, 800], [Infinity, 800], [-1, 800], [2, 1200]]
    for (const [bad, expected] of cases) {
      const t = new AccountMetricsThrottle({ pageDelayBaseMs: 800, pageDelayJitterRatio: 0.5, random: () => bad })
      const v = t.pageDelayMs()
      expect(Number.isFinite(v), String(bad)).toBe(true)
      expect(v, String(bad)).toBe(expected)
    }
  })

  it('T2 抖动比例非法未配置时回落默认 0.5（不是 0）', () => {
    const t = new AccountMetricsThrottle({ pageDelayBaseMs: 1000, pageDelayJitterRatio: undefined, random: () => 1 })
    expect(t.pageDelayMs()).toBe(1500)
  })
})

describe('AccountMetricsThrottle 日上限', () => {
  it('T3 上限内放行，达上限拒绝；跨 UTC 日复位（V6）', () => {
    const t0 = Date.parse('2026-10-12T03:00:00.000Z')
    const t = new AccountMetricsThrottle({ accountDailyMax: 2 })
    expect(t.canRun('a1', t0)).toBe(true)
    t.recordRun('a1', t0)
    expect(t.dailyUsage('a1', t0)).toEqual({ used: 1, max: 2 })
    expect(t.canRun('a1', t0)).toBe(true)
    t.recordRun('a1', t0)
    expect(t.canRun('a1', t0)).toBe(false)
    // 跨日复位（UTC 日键变化）
    const nextDay = t0 + DAY
    expect(utcDayKey(t0)).not.toBe(utcDayKey(nextDay))
    expect(t.canRun('a1', nextDay)).toBe(true)
    expect(t.dailyUsage('a1', nextDay)).toEqual({ used: 0, max: 2 })
  })

  it('T3b 账号之间额度互不影响；空 accountId 一律拒绝', () => {
    const now = Date.now()
    const t = new AccountMetricsThrottle({ accountDailyMax: 1 })
    t.recordRun('a1', now)
    expect(t.canRun('a1', now)).toBe(false)
    expect(t.canRun('a2', now)).toBe(true)
    expect(t.canRun('', now)).toBe(false)
  })

  it('T3c 当日已跑轮次与上限如实报给界面（不是恒 0）', () => {
    const now = Date.now()
    const t = new AccountMetricsThrottle({ accountDailyMax: 3 })
    t.recordRun('a1', now)
    t.recordRun('a1', now)
    expect(t.dailyUsage('a1', now)).toEqual({ used: 2, max: 3 })
    expect(t.dailyUsage('never-ran', now)).toEqual({ used: 0, max: 3 })
  })
})

describe('AccountMetricsThrottle 失败熔断', () => {
  it('T4 连续失败达阈值返回 true，成功清零（V8）', () => {
    const t = new AccountMetricsThrottle()
    expect(t.recordFailure('a1')).toBe(false)
    expect(t.recordFailure('a1')).toBe(false)
    expect(t.recordFailure('a1')).toBe(true)
    expect(t.failureCount('a1')).toBe(MAX_CONSECUTIVE_FAILURES)
    t.recordSuccess('a1')
    expect(t.failureCount('a1')).toBe(0)
    expect(t.recordFailure('a1')).toBe(false)
  })

  it('T4b 阈值与回采链同为 3（两条链的熔断口径不得各算一套）', () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBe(3)
  })
})
