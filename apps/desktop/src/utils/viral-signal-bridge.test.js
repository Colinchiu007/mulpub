import { describe, it, expect, beforeEach } from 'vitest'
import { setViralSignalHandoff, takeViralSignalHandoff, clearViralSignalHandoff, computeEngagement } from './viral-signal-bridge'

describe('viral-signal-bridge handoff', () => {
  beforeEach(() => { clearViralSignalHandoff(); sessionStorage.clear() })

  it('set → take 返回快照且读后即焚（AC-P2-2）', () => {
    const signal = { topic: 'T', angles: ['A'], keywords: ['K'], engagement: { sampleCount: 5, avgLikes: 900, avgComments: 30 } }
    expect(setViralSignalHandoff(signal)).toBe(true)
    expect(takeViralSignalHandoff()).toEqual(signal)
    expect(takeViralSignalHandoff()).toBeNull()
  })

  it('空对象/非对象拒绝写入；无载荷 take 返回 null 不抛', () => {
    expect(setViralSignalHandoff(null)).toBe(false)
    expect(setViralSignalHandoff('x')).toBe(false)
    expect(takeViralSignalHandoff()).toBeNull()
  })

  it('载荷损坏 → 返回 null 且清除残留', () => {
    sessionStorage.setItem('mp-viral-signal', '{bad')
    expect(takeViralSignalHandoff()).toBeNull()
    expect(sessionStorage.getItem('mp-viral-signal')).toBeNull()
  })
})

describe('computeEngagement', () => {
  it('聚合有限互动，NULL(未知) 不计入分子/分母', () => {
    const arts = [
      { like_count: 1000, comment_count: 20 },
      { like_count: 2000, comment_count: 40 },
      { like_count: 3000, comment_count: 60 },
    ]
    expect(computeEngagement(arts)).toEqual({ sampleCount: 3, avgLikes: 2000, avgComments: 40 })
  })

  it('like_count=null 视为未知，不当作 0 计入', () => {
    const arts = [
      { like_count: null, comment_count: null },
      { like_count: 500, comment_count: 10 },
    ]
    const r = computeEngagement(arts)
    expect(r.sampleCount).toBe(1)
    expect(r.avgLikes).toBe(500)
  })

  it('无有效样本/空数组/非数组 → null', () => {
    expect(computeEngagement([])).toBeNull()
    expect(computeEngagement(null)).toBeNull()
    expect(computeEngagement([{ like_count: null, comment_count: null }])).toBeNull()
  })
})
