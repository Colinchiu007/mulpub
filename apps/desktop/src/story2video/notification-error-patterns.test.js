/**
 * notification-error-patterns.test.js — 通知错误归一化正则回归锁
 *
 * 本轮重点（story-text-limit-control）：字数上限由写死 6000 改为「默认 10000 + 运营中心
 * 可下发覆盖」。旧正则 `超过\s*6000|最多\s*6000` 在上限变成 10000 后会把
 * 「超过 10000」判为不匹配 ⇒ 错误归因落空（PRD §7.8）。这里同时锁定 6000 / 10000 两档，
 * 防止下一次调值再次漏改正则。
 */
import { describe, expect, it } from 'vitest'
import { TEXT_TOO_LONG_PATTERN } from './notification-error-patterns'
import { STORY2VIDEO_NOTIFICATION_KEYS, resolveStory2VideoNotification } from './notifications'

describe('TEXT_TOO_LONG_PATTERN', () => {
  it('旧档 6000 的中英文表述必须继续命中（向后兼容历史错误文本）', () => {
    for (const error of [
      'Story2Video 文案超过 6000 个 Unicode 字符',
      '最多 6000 字',
      '6000 字符上限',
      'text exceeds 6000 characters',
    ]) {
      expect(TEXT_TOO_LONG_PATTERN.test(error), error).toBe(true)
    }
  })

  it('新档 10000 的中英文表述必须命中（旧写死正则的逃逸点）', () => {
    for (const error of [
      'Story2Video 文案超过 10000 个 Unicode 字符',
      '文案最多 10000 字',
      '10000 字符上限',
      'text exceeds 10000 characters',
      'Text is too long (10000 max)',
    ]) {
      expect(TEXT_TOO_LONG_PATTERN.test(error), error).toBe(true)
    }
  })

  it('运营可把上限调到任意 4-6 位区间值，正则按数字通配命中', () => {
    for (const error of ['超过 1000 个字符', '超过 12000 个字符', '最多 50000 字']) {
      expect(TEXT_TOO_LONG_PATTERN.test(error), error).toBe(true)
    }
  })

  it('不含超限语义的文本不误判（避免把普通进度/数量文案归成字数错误）', () => {
    for (const text of [
      '正常文案 500 字',
      '已完成 12 个场景',
      'request timeout after 10 seconds',
      'Token Plan 额度已用完 100',
    ]) {
      expect(TEXT_TOO_LONG_PATTERN.test(text), text).toBe(false)
    }
  })

  it('归一化链路：6000 与 10000 两档错误文本都映射到 text_too_long', () => {
    for (const error of [
      'Story2Video 文案超过 6000 个 Unicode 字符',
      'Story2Video 文案超过 10000 个 Unicode 字符',
      '最多 10000 字',
    ]) {
      const resolved = resolveStory2VideoNotification({ error })
      expect(resolved.key, error).toBe(STORY2VIDEO_NOTIFICATION_KEYS.TEXT_TOO_LONG)
      expect(resolved.message.length, error).toBeGreaterThan(0)
    }
  })
})
