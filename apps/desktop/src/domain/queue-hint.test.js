import { describe, it, expect } from 'vitest'
import { buildQueueHint, QUEUE_HINT_KIND } from './queue-hint'

/**
 * queue-hint 的单元测试
 *
 * 覆盖：正常（两种提示形态）/ 边界（<1s、0 个、空数组）/ 异常（畸形输入）
 */
describe('buildQueueHint', () => {
  it('无排队（queue 为空 / entries 为空）⇒ 返回 null（不显示任何提示）', () => {
    expect(buildQueueHint(null)).toBeNull()
    expect(buildQueueHint(undefined)).toBeNull()
    expect(buildQueueHint({})).toBeNull()
    expect(buildQueueHint({ entries: [] })).toBeNull()
  })

  it('并发槽排队 ⇒ 只报数量，不报时间（真实等待不可知）', () => {
    const hint = buildQueueHint({ entries: [{ reason: 'concurrency', queued: 3, etaMs: null }] })
    expect(hint).toEqual({ kind: QUEUE_HINT_KIND.WAITING, count: 3 })
    expect(hint.etaMs).toBeUndefined()
  })

  it('RPM 槽排队 ⇒ 报精确 ETA', () => {
    const hint = buildQueueHint({ entries: [{ reason: 'rpm', queued: 1, etaMs: 4200 }] })
    expect(hint).toEqual({ kind: QUEUE_HINT_KIND.ETA, etaMs: 4200 })
  })

  it('边界：ETA 小于 1 秒 ⇒ 不提示（几乎察觉不到，避免噪音）', () => {
    expect(buildQueueHint({ entries: [{ reason: 'rpm', queued: 1, etaMs: 999 }] })).toBeNull()
    expect(buildQueueHint({ entries: [{ reason: 'rpm', queued: 1, etaMs: 1000 }] })).not.toBeNull()
  })

  it('边界：并发排队但数量为 0 ⇒ 不提示', () => {
    expect(buildQueueHint({ entries: [{ reason: 'concurrency', queued: 0 }] })).toBeNull()
  })

  it('异常：畸形输入不抛，且一律判为无排队', () => {
    expect(buildQueueHint({ entries: 'not-array' })).toBeNull()
    expect(buildQueueHint({ entries: [null] })).toBeNull()
    expect(buildQueueHint({ entries: [123] })).toBeNull()
    expect(buildQueueHint({ entries: [{ reason: 'concurrency', queued: 'x' }] })).toBeNull()
    expect(buildQueueHint({ entries: [{ reason: 'rpm', etaMs: 'x' }] })).toBeNull()
  })

  it('取第一条（快照已按「并发优先、ETA 升序」排好序）', () => {
    const hint = buildQueueHint({
      entries: [
        { reason: 'concurrency', queued: 2 },
        { reason: 'rpm', queued: 1, etaMs: 100 },
      ],
    })
    expect(hint.kind).toBe(QUEUE_HINT_KIND.WAITING)
    expect(hint.count).toBe(2)
  })
})
