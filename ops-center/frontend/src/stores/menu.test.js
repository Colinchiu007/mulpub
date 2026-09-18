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

describe('menu store - reorderByPath（拖拽按 path 定位，修复 adminOnly 下标漂移）', () => {
  const visibleOf = (store) => store.orderedItems.filter((item) => !item.adminOnly)
  const visIdxOf = (store, path) => visibleOf(store).findIndex((i) => i.path === path)

  it('含 adminOnly 项时按 path 重排，移动的是被拖拽的项本身', () => {
    const store = useMenuStore()
    // 视图渲染的是过滤掉 adminOnly 后的可见列表（31 项），order 是完整列表（35 项）。
    // 若把可见下标直接交给按下标定位的 reorder，会移动错项（adminOnly 造成下标漂移）。
    const firstAdminPos = store.order.findIndex((p) => {
      const item = store.orderedItems.find((i) => i.path === p)
      return Boolean(item && item.adminOnly)
    })
    expect(firstAdminPos).toBeGreaterThanOrEqual(0)

    const visible = visibleOf(store)
    const srcEntry = visible.find((i) => store.order.indexOf(i.path) > firstAdminPos)
    const k = visible.indexOf(srcEntry)
    const fromPath = srcEntry.path
    const toPath = visible[k + 1].path

    const fromVisBefore = visIdxOf(store, fromPath)
    const toVisBefore = visIdxOf(store, toPath)
    const toPosBefore = store.order.indexOf(toPath)

    store.reorderByPath(fromPath, toPath)

    // 被移动的必须是用户真正抓取的那一项，且落在目标的原位置
    expect(store.order.indexOf(fromPath)).toBe(toPosBefore)
    // 可见视角下两者交换
    expect(visIdxOf(store, fromPath)).toBe(toVisBefore)
    expect(visIdxOf(store, toPath)).toBe(fromVisBefore)
  })

  it('跨边界拖拽到可见末位仍然落在末位', () => {
    const store = useMenuStore()
    const visible = visibleOf(store)
    const fromPath = visible[0].path
    const toPath = visible[visible.length - 1].path

    store.reorderByPath(fromPath, toPath)

    expect(visIdxOf(store, fromPath)).toBe(visible.length - 1)
  })

  it('未知 path / 相同 path 安全忽略', () => {
    const store = useMenuStore()
    const before = [...store.order]
    store.reorderByPath('/parameters', '/parameters')
    store.reorderByPath('/parameters', '/not-a-real-path')
    store.reorderByPath('/not-a-real-path', '/parameters')
    expect(store.order).toEqual(before)
  })

  it('重排后持久化到 localStorage', () => {
    const store = useMenuStore()
    const visible = visibleOf(store)
    store.reorderByPath(visible[0].path, visible[3].path)
    const saved = JSON.parse(localStorage.getItem('ops_menu_order'))
    expect(saved).toEqual(store.order)
  })
})
