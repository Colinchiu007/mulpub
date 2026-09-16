import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMenuStore } from './menu'
import { DEFAULT_MENU_ORDER } from '../config/menuItems'

// 内存版 localStorage，避免依赖 jsdom 环境
function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
}

beforeEach(() => {
  globalThis.localStorage = createMemoryStorage()
  setActivePinia(createPinia())
})

describe('menu store - reorder', () => {
  it('把第 from 项移动到第 to 项位置', () => {
    const store = useMenuStore()
    const before = [...store.order]
    const moved = before[0]
    store.reorder(0, 2)
    expect(store.order[2]).toBe(moved)
    expect(store.order).not.toEqual(before)
  })

  it('reorder 后持久化到 localStorage', () => {
    const store = useMenuStore()
    store.reorder(0, 3)
    const saved = JSON.parse(localStorage.getItem('ops_menu_order'))
    expect(saved).toEqual(store.order)
  })

  it('from === to 时不做任何改动', () => {
    const store = useMenuStore()
    const before = [...store.order]
    store.reorder(1, 1)
    expect(store.order).toEqual(before)
  })

  it('越界索引（负数或 >= 长度）时安全忽略', () => {
    const store = useMenuStore()
    const before = [...store.order]
    store.reorder(-1, 2)
    store.reorder(0, 999)
    store.reorder(999, 0)
    expect(store.order).toEqual(before)
  })

  it('有序项数量与默认一致', () => {
    const store = useMenuStore()
    expect(store.orderedItems.length).toBe(DEFAULT_MENU_ORDER.length)
  })
})

describe('menu store - move', () => {
  it('上移（offset -1）减小索引', () => {
    const store = useMenuStore()
    const path = store.order[2]
    store.move(path, -1)
    expect(store.order.indexOf(path)).toBe(1)
  })

  it('下移（offset +1）增大索引', () => {
    const store = useMenuStore()
    const path = store.order[0]
    store.move(path, 1)
    expect(store.order.indexOf(path)).toBe(1)
  })

  it('首项下移越界安全忽略', () => {
    const store = useMenuStore()
    const path = store.order[0]
    store.move(path, -1)
    expect(store.order.indexOf(path)).toBe(0)
  })
})

describe('menu store - reset', () => {
  it('打乱顺序后 reset 恢复默认顺序', () => {
    const store = useMenuStore()
    store.reorder(0, 5)
    expect(store.order).not.toEqual(DEFAULT_MENU_ORDER)
    store.reset()
    expect(store.order).toEqual(DEFAULT_MENU_ORDER)
  })
})
