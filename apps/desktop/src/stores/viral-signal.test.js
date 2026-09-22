// @ts-check
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useViralSignalStore } from './viral-signal'

describe('viral-signal store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('setSignal 清洗 angles/keywords（过滤非字符串、截断 6 条）', () => {
    const store = useViralSignalStore()
    store.setSignal({
      topic: 'AI 工具',
      angles: ['深度解析', 42, null, '  ', '避坑指南'],
      keywords: ['AI', '', '效率', { bad: 1 }],
    })
    expect(store.signal.topic).toBe('AI 工具')
    expect(store.signal.angles).toEqual(['深度解析', '避坑指南'])
    expect(store.signal.keywords).toEqual(['AI', '效率'])
    expect(store.signal.savedAt).toBeTruthy()
  })

  it('无效 payload 忽略', () => {
    const store = useViralSignalStore()
    store.setSignal(null)
    store.setSignal('bad')
    expect(store.signal).toBeNull()
  })

  it('边界截断：7+ 条只留 6 条、>60 字条目截断至 60', () => {
    const store = useViralSignalStore()
    const angles = []
    for (let i = 0; i < 8; i++) angles.push('角度' + i + ' ' + 'x'.repeat(70))
    store.setSignal({ topic: 'T', angles, keywords: ['K'] })
    expect(store.signal.angles.length).toBe(6)
    for (const a of store.signal.angles) expect(a.length).toBeLessThanOrEqual(60)
    expect(store.signal.angles.some(a => a.startsWith('角度0'))).toBe(true)
  })

  it('setSignal 归一 engagement：三个有限数保留、缺项/非有限数 → null', () => {
    const store = useViralSignalStore()
    store.setSignal({ topic: 'T', angles: [], keywords: [], engagement: { sampleCount: 6, avgLikes: 1200.5, avgComments: 40 } })
    expect(store.signal.engagement).toEqual({ sampleCount: 6, avgLikes: 1200.5, avgComments: 40 })
    store.setSignal({ topic: 'T', angles: [], keywords: [], engagement: { sampleCount: 6, avgLikes: NaN, avgComments: 40 } })
    expect(store.signal.engagement).toBeNull()
    store.setSignal({ topic: 'T', angles: [], keywords: [], engagement: { sampleCount: 6, avgLikes: 100 } })
    expect(store.signal.engagement).toBeNull()
    store.setSignal({ topic: 'T', angles: [], keywords: [] })
    expect(store.signal.engagement).toBeNull()
    store.setSignal({ topic: 'T', angles: [], keywords: [], engagement: 'bad' })
    expect(store.signal.engagement).toBeNull()
  })

  it('clearSignal 清空', () => {
    const store = useViralSignalStore()
    store.setSignal({ topic: 'T', angles: ['A'], keywords: ['K'] })
    store.clearSignal()
    expect(store.signal).toBeNull()
  })
})
