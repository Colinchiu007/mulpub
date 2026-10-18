import { describe, expect, it } from 'vitest'
import {
  PUBLISH_TITLE_MAX,
  PUBLISH_TITLE_IDEAL,
  truncateTitleByCodePoints,
  countTitleCodePoints,
} from './title-limits'

/**
 * 标题长度单一真源（2026-10-18 用户要求：最多 20 字）。
 *
 * 这组用例守三件事：
 *   ① 上限就是 20（改这个数必须同时改这里，且要想清楚是不是真的全平台安全）；
 *   ② 计数与截断**同一口径**（Unicode 码点）——两者不同口径时用户会看到「19/20 却被拦」；
 *   ③ 非法 max 不抛错、不静默变成 0（那会把标题清空）。
 */
describe('title-limits', () => {
  it('上限是 20（取各平台 titleMax 的最小者：小红书 20）', () => {
    expect(PUBLISH_TITLE_MAX).toBe(20)
  })

  it('理想长度严格小于硬上限（否则 prompt 的软约束自相矛盾）', () => {
    expect(PUBLISH_TITLE_IDEAL).toBeLessThan(PUBLISH_TITLE_MAX)
    expect(PUBLISH_TITLE_IDEAL).toBeGreaterThan(0)
  })

  it('countTitleCodePoints 按码点计：中文/英文/emoji 各计 1', () => {
    expect(countTitleCodePoints('')).toBe(0)
    expect(countTitleCodePoints('打工人')).toBe(3)
    expect(countTitleCodePoints('abc')).toBe(3)
    // emoji 是代理对：String.length 会算 2，码点口径必须算 1
    expect(countTitleCodePoints('🎬')).toBe(1)
    expect('🎬'.length).toBe(2)
  })

  it('countTitleCodePoints 对非字符串返回 0（不抛错）', () => {
    for (const v of [null, undefined, 123, {}, [], true]) {
      expect(countTitleCodePoints(v)).toBe(0)
    }
  })

  it('truncateTitleByCodePoints 短于上限时原样返回（不 reshape）', () => {
    expect(truncateTitleByCodePoints('打工人')).toBe('打工人')
    expect(truncateTitleByCodePoints('')).toBe('')
  })

  it('truncateTitleByCodePoints 恰好等于上限时不截断', () => {
    const exactly = '字'.repeat(PUBLISH_TITLE_MAX)
    expect(truncateTitleByCodePoints(exactly)).toBe(exactly)
  })

  it('truncateTitleByCodePoints 超上限时截到 20 码点', () => {
    const long = '字'.repeat(PUBLISH_TITLE_MAX + 5)
    const out = truncateTitleByCodePoints(long)
    expect(countTitleCodePoints(out)).toBe(PUBLISH_TITLE_MAX)
    expect(out).toBe('字'.repeat(PUBLISH_TITLE_MAX))
  })

  it('truncateTitleByCodePoints 不切断 emoji 代理对', () => {
    const emojis = '🎬'.repeat(PUBLISH_TITLE_MAX + 3)
    const out = truncateTitleByCodePoints(emojis)
    expect(countTitleCodePoints(out)).toBe(PUBLISH_TITLE_MAX)
    // 逐字符仍是合法 emoji（没被切成半个代理对）
    expect([...out].every(c => c === '🎬')).toBe(true)
    // 没有孤立代理项
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false)
  })

  it('max 非法时回退到 20（不返回空串、不抛错）', () => {
    const text = '字'.repeat(30)
    for (const bad of [0, -1, NaN, Infinity, '', null, undefined, {}]) {
      expect(countTitleCodePoints(truncateTitleByCodePoints(text, bad))).toBe(PUBLISH_TITLE_MAX)
    }
  })

  it('max 为合法小数时向下取整', () => {
    expect(truncateTitleByCodePoints('一二三四五六', 3.9)).toBe('一二三')
  })

  it('max 为数字字符串时按数字处理（"12" → 12）', () => {
    expect(truncateTitleByCodePoints('一二三四五六七八九十壹贰叁', '12')).toBe('一二三四五六七八九十壹贰')
  })

  it('非字符串输入返回空串（不抛错）', () => {
    for (const v of [null, undefined, 123, {}, [], true]) {
      expect(truncateTitleByCodePoints(v)).toBe('')
    }
  })
})
