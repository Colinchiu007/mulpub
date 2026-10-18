import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STORY2VIDEO_TEXT_LIMIT,
  STORY2VIDEO_TEXT_LIMIT_MAX_CHARS,
  STORY2VIDEO_TEXT_LIMIT_MAX_WARN_PERCENT,
  STORY2VIDEO_TEXT_LIMIT_MIN_CHARS,
  STORY2VIDEO_TEXT_LIMIT_MIN_WARN_PERCENT,
  resolveStory2VideoTextLimit,
  story2VideoTextWarnThreshold,
} from './story-text-limit'

const DEFAULT_MAX = 10000
const DEFAULT_WARN = 90

/** 构造运营下发块（形状见跨端契约 storyTextLimit）。 */
function block (scope) {
  return { story2video: scope }
}

describe('resolveStory2VideoTextLimit（跨端契约 storyTextLimit）', () => {
  it('内置默认值为 10000 / 90，且被冻结不可被改', () => {
    expect(DEFAULT_STORY2VIDEO_TEXT_LIMIT).toEqual({ maxChars: DEFAULT_MAX, warnPercent: DEFAULT_WARN })
    expect(Object.isFrozen(DEFAULT_STORY2VIDEO_TEXT_LIMIT)).toBe(true)
  })

  it('合法下发：maxChars / warnPercent 原样生效，source=ops-center', () => {
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: 12000, warnPercent: 80 }) })).toEqual({
      maxChars: 12000,
      warnPercent: 80,
      source: 'ops-center',
    })
  })

  it('两种入参形态等价：runtime data（含 storyTextLimit 键）与块本身', () => {
    const scope = { maxChars: 12000, warnPercent: 85 }
    expect(resolveStory2VideoTextLimit({ syncedAt: 't', storyTextLimit: block(scope) }))
      .toEqual(resolveStory2VideoTextLimit(block(scope)))
  })

  it('null / undefined / 非对象 / 空对象 → 内置默认，source=default，且绝不抛错', () => {
    for (const input of [null, undefined, 0, '', 'storyTextLimit', [], [1], true]) {
      expect(resolveStory2VideoTextLimit(input)).toEqual({ maxChars: DEFAULT_MAX, warnPercent: DEFAULT_WARN, source: 'default' })
    }
    expect(resolveStory2VideoTextLimit({ storyTextLimit: null })).toEqual({ maxChars: DEFAULT_MAX, warnPercent: DEFAULT_WARN, source: 'default' })
    expect(resolveStory2VideoTextLimit({ storyTextLimit: {} })).toEqual({ maxChars: DEFAULT_MAX, warnPercent: DEFAULT_WARN, source: 'default' })
    expect(resolveStory2VideoTextLimit({ storyTextLimit: { story2video: null } })).toEqual({ maxChars: DEFAULT_MAX, warnPercent: DEFAULT_WARN, source: 'default' })
  })

  it('缺键：只有 maxChars 或只有 warnPercent 时，缺失字段独立回落默认', () => {
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: 12000 }) })).toEqual({
      maxChars: 12000,
      warnPercent: DEFAULT_WARN,
      source: 'ops-center',
    })
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ warnPercent: 70 }) })).toEqual({
      maxChars: DEFAULT_MAX,
      warnPercent: 70,
      source: 'default',
    })
  })

  it('字符串数字不隐式转换（防 "12000abc" 脏值），回落默认', () => {
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: '12000', warnPercent: '80' }) })).toEqual({
      maxChars: DEFAULT_MAX,
      warnPercent: DEFAULT_WARN,
      source: 'default',
    })
  })

  it('浮点 / NaN / Infinity 回落默认', () => {
    for (const value of [1.5, 12000.5, 0.9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: value, warnPercent: value }) })).toEqual({
        maxChars: DEFAULT_MAX,
        warnPercent: DEFAULT_WARN,
        source: 'default',
      })
    }
  })

  it('越界不 clamp 到端点，而是回落默认（E5：clamp 会让配置错误看起来像生效）', () => {
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: 999 }) }).maxChars).toBe(DEFAULT_MAX)
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: 50001 }) }).maxChars).toBe(DEFAULT_MAX)
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: 99999999 }) }).maxChars).toBe(DEFAULT_MAX)
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: 0 }) }).maxChars).toBe(DEFAULT_MAX)
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: -1 }) }).maxChars).toBe(DEFAULT_MAX)
  })

  it('warnPercent 越界只回落自身，maxChars 照常生效（E6）', () => {
    const resolved = resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: 12000, warnPercent: 150 }) })
    expect(resolved).toEqual({ maxChars: 12000, warnPercent: DEFAULT_WARN, source: 'ops-center' })
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: 12000, warnPercent: 5 }) }).warnPercent).toBe(DEFAULT_WARN)
  })

  it('极值边界闭区间端点合法（E13）：1000/50000 与 50/99', () => {
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: STORY2VIDEO_TEXT_LIMIT_MIN_CHARS, warnPercent: STORY2VIDEO_TEXT_LIMIT_MIN_WARN_PERCENT }) })).toEqual({
      maxChars: 1000,
      warnPercent: 50,
      source: 'ops-center',
    })
    expect(resolveStory2VideoTextLimit({ storyTextLimit: block({ maxChars: STORY2VIDEO_TEXT_LIMIT_MAX_CHARS, warnPercent: STORY2VIDEO_TEXT_LIMIT_MAX_WARN_PERCENT }) })).toEqual({
      maxChars: 50000,
      warnPercent: 99,
      source: 'ops-center',
    })
  })

  it('契约常量与区间逐值锁定', () => {
    expect([STORY2VIDEO_TEXT_LIMIT_MIN_CHARS, STORY2VIDEO_TEXT_LIMIT_MAX_CHARS]).toEqual([1000, 50000])
    expect([STORY2VIDEO_TEXT_LIMIT_MIN_WARN_PERCENT, STORY2VIDEO_TEXT_LIMIT_MAX_WARN_PERCENT]).toEqual([50, 99])
  })
})

describe('story2VideoTextWarnThreshold（预警起点）', () => {
  it('默认 90% / 10000 → 9000，与历史 Math.floor(max * 0.9) 逐值一致', () => {
    expect(story2VideoTextWarnThreshold(DEFAULT_MAX, DEFAULT_WARN)).toBe(9000)
    expect(story2VideoTextWarnThreshold(DEFAULT_MAX, DEFAULT_WARN)).toBe(Math.floor(DEFAULT_MAX * 0.9))
  })

  it('由 warnPercent 驱动：80% / 12000 → 9600', () => {
    expect(story2VideoTextWarnThreshold(12000, 80)).toBe(9600)
    expect(story2VideoTextWarnThreshold(10000, 99)).toBe(9900)
  })

  it('非法/缺失参数返回 0（档位视为中性，不抛错）', () => {
    for (const [max, percent] of [[0, 90], [-1, 90], [10000, 0], [NaN, 90], [10000, NaN], [null, null]]) {
      expect(story2VideoTextWarnThreshold(max, percent)).toBe(0)
    }
  })
})
