import { describe, expect, it, vi } from 'vitest'
const fs = require('fs')
const path = require('path')

const { createAccessLevelCache } = require('./access-level-cache')
const {
  ACCESS_LEVEL_CHANNEL,
  ACCESS_LEVEL_INVALIDATE_EVENT,
  ACCESS_LEVEL_TTL_MS,
  isAccessLevel,
} = require('../core/access-level')

/** 假时钟：避免用例依赖真实时间流逝 */
function fakeClock (start = 0) {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

describe('访问级别缓存（审计 P2·性能税）', () => {
  it('TTL 内重复读取只回源一次（受限 API 不再每次交同步 IPC 税）', () => {
    const clock = fakeClock()
    const read = vi.fn(() => 'public')
    const cache = createAccessLevelCache({ read, now: clock.now })

    expect(cache.get()).toBe('public')
    expect(cache.get()).toBe('public')
    expect(cache.get()).toBe('public')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('invalidate 后下一次读取立即回源 —— 不重载窗口也能升级/降级', () => {
    const clock = fakeClock()
    let level = 'public'
    const read = vi.fn(() => level)
    const cache = createAccessLevelCache({ read, now: clock.now })

    expect(cache.get()).toBe('public')
    level = 'authenticated'
    expect(cache.get()).toBe('public', '未失效前仍走缓存（这是本用例的前提）')
    cache.invalidate()
    expect(cache.get()).toBe('authenticated')
    level = 'public'
    cache.invalidate()
    expect(cache.get()).toBe('public')
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('TTL 到期自动回源（漏收推送不会永久停留在旧级别）', () => {
    const clock = fakeClock()
    let level = 'public'
    const read = vi.fn(() => level)
    const cache = createAccessLevelCache({ read, ttlMs: 1000, now: clock.now })

    expect(cache.get()).toBe('public')
    level = 'admin'
    clock.advance(999)
    expect(cache.isFresh()).toBe(true)
    expect(cache.get()).toBe('public')
    clock.advance(2)
    expect(cache.isFresh()).toBe(false)
    expect(cache.get()).toBe('admin')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('默认 TTL 存在且为正数（兜底窗口不能是 0 或 Infinity）', () => {
    expect(ACCESS_LEVEL_TTL_MS).toBeGreaterThan(0)
    expect(Number.isFinite(ACCESS_LEVEL_TTL_MS)).toBe(true)
  })

  it('回源抛异常按 public 失败关闭，且异常不外泄给业务调用方', () => {
    const clock = fakeClock()
    const cache = createAccessLevelCache({ read: () => { throw new Error('同步 IPC 不可用') }, now: clock.now })
    expect(() => cache.get()).not.toThrow()
    expect(cache.get()).toBe('public')
  })

  it('非法级别（伪造值/undefined/非字符串）一律判为无权限', () => {
    expect(isAccessLevel('public')).toBe(true)
    expect(isAccessLevel('authenticated')).toBe(true)
    expect(isAccessLevel('admin')).toBe(true)
    for (const forged of ['forged-admin', 'ADMIN', undefined, null, 42, {}, ['admin']]) {
      expect(isAccessLevel(forged), String(forged)).toBe(false)
    }
    const clock = fakeClock()
    const cache = createAccessLevelCache({ read: () => 'superuser', now: clock.now })
    expect(cache.get()).toBe('public')
  })

  it('protocol 常量单一来源：级别通道字面量在 electron 源码中只允许出现一次', () => {
    // 两侧各写一份字面量 = 主进程改了通道名而 preload 没改，缓存静默失效（推送永远收不到）。
    const root = path.resolve(__dirname, '..')
    const hits = { [ACCESS_LEVEL_CHANNEL]: [], [ACCESS_LEVEL_INVALIDATE_EVENT]: [] }
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(fp); continue }
        if (!entry.name.endsWith('.js')) continue
        // 打包产物内联了源码（必然重复），测试文件按字面量断言属预期，均不参与漂移检查
        if (entry.name.endsWith('.bundle.js') || entry.name.endsWith('.test.js')) continue
        const text = fs.readFileSync(fp, 'utf8')
        for (const literal of Object.keys(hits)) {
          if (text.includes("'" + literal + "'") || text.includes('"' + literal + '"')) {
            hits[literal].push(path.relative(root, fp).replace(/\\/g, '/'))
          }
        }
      }
    }
    walk(root)
    expect(hits[ACCESS_LEVEL_CHANNEL], '通道名字面量必须只在 core/access-level.js 出现一次').toEqual(['core/access-level.js'])
    expect(hits[ACCESS_LEVEL_INVALIDATE_EVENT], '失效事件名必须只在 core/access-level.js 出现一次').toEqual(['core/access-level.js'])
  })
})
