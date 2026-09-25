import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_MENU_ORDER } from '../config/menuItems'
import { useMenuStore } from './menu'

// 「菜单设置」页四种位移（⤒ 移到首位 / ↑ 上移 / ↓ 下移 / ⤓ 移到末位）的语义契约。
//
// 根因背景：视图渲染的是 visibleForRole(role) 过滤后的列表，非 admin 视角下
// 「可见下标」与「完整 order 下标」并不一致。#1941 已把拖拽改为按 path 定位，
// 但箭头仍走 move(path, ±1)（直接作用在完整 order 上），因此对非 admin 会移动错项、
// 或在用户看不见任何变化的情况下悄悄改掉 admin 的顺序。
// 本文件锁住修复后的口径：位移一律按**可见序列**解析目标，再落到完整 order，
// 与 #2246「所见即所得：序列外的项不受影响」保持同一原则。

function createMemoryStorage() {
  const map = new Map()
  const storage = {
    writes: 0,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { storage.writes += 1; map.set(k, String(v)) },
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
  return storage
}

function visiblePathsAs(store, role) {
  return store.visibleForRole(role).map((i) => i.path)
}

describe('menu store - moveToVisibleEdge（移到可见首 / 末位）', () => {
  let storage

  beforeEach(() => {
    storage = createMemoryStorage()
    globalThis.localStorage = storage
    setActivePinia(createPinia())
  })

  it('不传可见序列时按完整 order 处理：移到首位 = 成为 order[0]，其余相对顺序不变', () => {
    const store = useMenuStore()
    store.moveToVisibleEdge('/model-keys', 'top')
    expect(store.order).toEqual(['/model-keys', ...DEFAULT_MENU_ORDER.filter((p) => p !== '/model-keys')])
  })

  it('移到末位 = 成为 order 末项，其余相对顺序不变', () => {
    const store = useMenuStore()
    store.moveToVisibleEdge('/', 'bottom')
    expect(store.order).toEqual([...DEFAULT_MENU_ORDER.filter((p) => p !== '/'), '/'])
  })

  it('非 admin 视角只在可见区间内生效：不得越过看不见的 adminOnly 尾部项', () => {
    const store = useMenuStore()
    const adminPaths = visiblePathsAs(store, 'admin')
    // 先造出「全局末项对 viewer 不可见」的场景：/model-keys(adminOnly) 落到完整 order 最末，
    // 而 viewer 的可见末项是 /settings，它后面还跟着一个自己看不见的项。
    store.moveToVisibleEdge('/model-keys', 'bottom', adminPaths)
    const viewerPaths = visiblePathsAs(store, 'viewer')
    expect(store.order[store.order.length - 1]).toBe('/model-keys')
    expect(viewerPaths[viewerPaths.length - 1]).toBe('/settings')

    store.moveToVisibleEdge('/rewrite-strategies', 'bottom', viewerPaths)

    // 所见即所得：它成为 viewer 的可见末项，但停在 /settings 之后、/model-keys 之前，
    // 没有被“悄悄移到全局最末”（那会改变 admin 看到的顺序）。
    const settingsIdx = store.order.indexOf('/settings')
    expect(store.order[settingsIdx + 1]).toBe('/rewrite-strategies')
    expect(store.order[settingsIdx + 2]).toBe('/model-keys')
    expect(visiblePathsAs(store, 'viewer')).toEqual(
      [...viewerPaths.filter((p) => p !== '/rewrite-strategies'), '/rewrite-strategies'],
    )
  })

  it('已在可见首 / 末位时不改动，也不写 localStorage', () => {
    const store = useMenuStore()
    const adminPaths = visiblePathsAs(store, 'admin')
    storage.writes = 0
    store.moveToVisibleEdge('/', 'top', adminPaths)
    store.moveToVisibleEdge('/settings', 'bottom', adminPaths)
    expect(store.order).toEqual(DEFAULT_MENU_ORDER)
    expect(storage.writes).toBe(0)
  })

  it('未知 path 与非法 edge 值一律 no-op（不抛错、不持久化）', () => {
    const store = useMenuStore()
    const adminPaths = visiblePathsAs(store, 'admin')
    storage.writes = 0
    store.moveToVisibleEdge('/not-a-menu', 'top', adminPaths)
    store.moveToVisibleEdge('/', 'middle', adminPaths)
    store.moveToVisibleEdge('/', undefined, adminPaths)
    expect(store.order).toEqual(DEFAULT_MENU_ORDER)
    expect(storage.writes).toBe(0)
  })

  it('持久化：移动后 localStorage 与 order 一致（点击即时保存）', () => {
    const store = useMenuStore()
    const adminPaths = visiblePathsAs(store, 'admin')
    storage.writes = 0
    store.moveToVisibleEdge('/model-keys', 'top', adminPaths)
    expect(storage.writes).toBe(1)
    expect(JSON.parse(localStorage.getItem('ops_menu_order'))).toEqual(store.order)
  })
})

describe('menu store - moveInVisible（上移 / 下移按可见序列定位，修复下标漂移）', () => {
  let storage

  beforeEach(() => {
    storage = createMemoryStorage()
    globalThis.localStorage = storage
    setActivePinia(createPinia())
  })

  it('offset -1 / +1 与可见相邻项互换位置（完整列表口径下与旧行为一致）', () => {
    const store = useMenuStore()
    const full = [...DEFAULT_MENU_ORDER]
    store.moveInVisible('/usage', 1)
    expect(store.order).toEqual([
      ...full.slice(0, full.indexOf('/usage')),
      '/diagnostics',
      '/usage',
      ...full.slice(full.indexOf('/diagnostics') + 1),
    ])
  })

  it('回归：非 admin 的「可见首项」上移不得越过看不见的 adminOnly 项（旧 move 会越界）', () => {
    const store = useMenuStore()
    // 先把一个 adminOnly 项挪到最前，制造「viewer 可见首项其实不是全局首位」的场景
    store.moveToVisibleEdge('/model-keys', 'top')
    const viewerPaths = visiblePathsAs(store, 'viewer')
    expect(store.order[0]).toBe('/model-keys')
    expect(viewerPaths[0]).toBe('/')
    storage.writes = 0

    store.moveInVisible('/', -1, viewerPaths)

    expect(store.order).toEqual(['/model-keys', ...DEFAULT_MENU_ORDER.filter((p) => p !== '/model-keys')])
    expect(storage.writes).toBe(0)
  })

  it('非 admin 的「可见末项」下移同样 no-op', () => {
    const store = useMenuStore()
    store.moveToVisibleEdge('/model-keys', 'bottom')
    const viewerPaths = visiblePathsAs(store, 'viewer')
    const before = [...store.order]
    storage.writes = 0

    store.moveInVisible(viewerPaths[viewerPaths.length - 1], 1, viewerPaths)

    expect(store.order).toEqual(before)
    expect(storage.writes).toBe(0)
  })

  it('越出可见区间或 path 不在可见序列内一律 no-op', () => {
    const store = useMenuStore()
    const viewerPaths = visiblePathsAs(store, 'viewer')
    storage.writes = 0
    store.moveInVisible('/model-keys', 1, viewerPaths) // adminOnly：不在 viewer 可见序列内
    store.moveInVisible('/not-a-menu', 1, viewerPaths)
    expect(store.order).toEqual(DEFAULT_MENU_ORDER)
    expect(storage.writes).toBe(0)
  })

  it('非 admin 视角下相邻交换只影响可见区间内的次序', () => {
    const store = useMenuStore()
    const viewerPaths = visiblePathsAs(store, 'viewer')
    store.moveInVisible(viewerPaths[1], -1, viewerPaths)
    expect(visiblePathsAs(store, 'viewer')).toEqual([
      viewerPaths[1],
      viewerPaths[0],
      ...viewerPaths.slice(2),
    ])
  })

  it('默认按完整 order 处理（不传第三参）', () => {
    const store = useMenuStore()
    store.moveInVisible('/feature-flags', -1)
    expect(store.order.slice(0, 2)).toEqual(['/feature-flags', '/'])
  })
})
