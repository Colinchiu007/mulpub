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

  it('clearSignal 清空', () => {
    const store = useViralSignalStore()
    store.setSignal({ topic: 'T', angles: ['A'], keywords: ['K'] })
    store.clearSignal()
    expect(store.signal).toBeNull()
  })
})
