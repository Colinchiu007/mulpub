/**
 * 改写结果元信息派生回归锁（rewrite-cancel-and-truncation-summary）。
 *
 * 重点是「缺字段/非法值不臆造」与「分段段号过滤」：这两个派生直接决定横幅是否出现，
 * 误判会让用户在截断时看不到提示（静默截断）或在正常时被噪音打扰。
 */
import { describe, it, expect } from 'vitest'
import {
  deriveOutputTruncatedInfo,
  deriveModelTruncatedInfo,
  deriveSegmentedCount,
} from './rewrite-truncation'

describe('deriveOutputTruncatedInfo — 引擎砍尾（outputTruncated）', () => {
  it('outputTruncated=true + 合法 outputLength ⇒ {length, max}', () => {
    expect(deriveOutputTruncatedInfo({ outputTruncated: true, outputLength: 3000 }, 50000))
      .toEqual({ length: 3000, max: 50000 })
  })

  it('outputTruncated 缺省/false ⇒ null（正常路径零噪音）', () => {
    expect(deriveOutputTruncatedInfo({ outputLength: 3000 }, 50000)).toBeNull()
    expect(deriveOutputTruncatedInfo({ outputTruncated: false, outputLength: 3000 }, 50000)).toBeNull()
    expect(deriveOutputTruncatedInfo(null, 50000)).toBeNull()
  })

  it('outputLength 非法 ⇒ null（不展示「截断到 NaN 字」）', () => {
    expect(deriveOutputTruncatedInfo({ outputTruncated: true, outputLength: 'abc' }, 50000)).toBeNull()
    expect(deriveOutputTruncatedInfo({ outputTruncated: true }, 50000)).toBeNull()
  })

  it('fallbackMax 非法 ⇒ max 为 null（由调用方决定回退文案）', () => {
    expect(deriveOutputTruncatedInfo({ outputTruncated: true, outputLength: 10 }, undefined))
      .toEqual({ length: 10, max: null })
  })
})

describe('deriveModelTruncatedInfo — 模型侧截断（modelTruncated）', () => {
  it('分段路径带 truncatedSegments ⇒ 原样保留 1-based 段号', () => {
    expect(deriveModelTruncatedInfo({
      modelTruncated: true, outputLength: 42000, truncatedSegments: [3],
    })).toEqual({ length: 42000, truncatedSegments: [3] })
  })

  it('多段被截 ⇒ 全部保留（顺序即用户可见顺序）', () => {
    expect(deriveModelTruncatedInfo({
      modelTruncated: true, outputLength: 100, truncatedSegments: [2, 5],
    }).truncatedSegments).toEqual([2, 5])
  })

  it('单次路径（无 truncatedSegments）⇒ 空数组，走「整篇被截」文案', () => {
    expect(deriveModelTruncatedInfo({ modelTruncated: true, outputLength: 3000 }))
      .toEqual({ length: 3000, truncatedSegments: [] })
  })

  it('非法段号被过滤（0/负数/非数字/NaN 都不该出现在文案里）', () => {
    expect(deriveModelTruncatedInfo({
      modelTruncated: true, outputLength: 10, truncatedSegments: [0, -1, 'x', NaN, 4],
    }).truncatedSegments).toEqual([4])
  })

  it('modelTruncated 缺省/false ⇒ null', () => {
    expect(deriveModelTruncatedInfo({ outputLength: 10 })).toBeNull()
    expect(deriveModelTruncatedInfo({ modelTruncated: false, outputLength: 10 })).toBeNull()
  })
})

describe('deriveSegmentedCount — 分段段数展示', () => {
  it('segmented.enabled=true 且段数 >1 ⇒ 返回段数', () => {
    expect(deriveSegmentedCount({ segmented: { enabled: true, segmentCount: 5 } })).toBe(5)
  })

  it('单段 ⇒ 0（不给普通改写加噪音）', () => {
    expect(deriveSegmentedCount({ segmented: { enabled: true, segmentCount: 1 } })).toBe(0)
  })

  it('enabled=false / 缺省 ⇒ 0', () => {
    expect(deriveSegmentedCount({ segmented: { enabled: false, segmentCount: 5 } })).toBe(0)
    expect(deriveSegmentedCount({})).toBe(0)
    expect(deriveSegmentedCount(null)).toBe(0)
  })
})
