import { describe, it, expect } from 'vitest'
import { formatBytes } from './bytes'

// 口径来源：LogsSettings.vue 内联实现（日志统计）与缓存卡片共用同一换算，抽离后钉死契约
describe('formatBytes（日志/缓存统计共用口径）', () => {
  it('非有限值、0 与负数一律归零为 "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
    expect(formatBytes(Infinity)).toBe('0 B')
    expect(formatBytes(undefined)).toBe('0 B')
  })

  it('B 档取整，KB 及以上保留两位', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1536)).toBe('1.50 KB')
  })

  it('进档到 MB/GB，GB 为最大档（1 TB 只显示 1024.00 GB）', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB')
    expect(formatBytes(1024 ** 4)).toBe('1024.00 GB')
  })
})
