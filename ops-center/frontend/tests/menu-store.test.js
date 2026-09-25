/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_MENU_ORDER } from '../src/config/menuItems'
import { useMenuStore } from '../src/stores/menu'

describe('menuStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('default order starts with dashboard and ends with settings', () => {
    const store = useMenuStore()
    const paths = store.orderedItems.map((item) => item.path)
    expect(paths[0]).toBe('/')
    expect(paths[paths.length - 1]).toBe('/settings')
  })

  it('moveInVisible changes position and persists to localStorage', () => {
    const store = useMenuStore()
    store.moveInVisible('/usage', 1)
    expect(store.order).toContain('/usage')
    expect(localStorage.getItem('ops_menu_order')).toBeTruthy()
  })

  it('reset restores default menu order', () => {
    const store = useMenuStore()
    store.moveInVisible('/usage', 1)
    store.reset()
    expect(store.order).toEqual(DEFAULT_MENU_ORDER)
  })

  it('preserves saved order across rehydration', () => {
    const store = useMenuStore()
    store.moveInVisible('/diagnostics', -1)
    const after = store.order.slice()
    const freshStore = useMenuStore()
    expect(freshStore.order).toEqual(after)
  })

  it('appends new default items when storage is missing paths', () => {
    localStorage.setItem('ops_menu_order', JSON.stringify(['/']))
    const store = useMenuStore()
    expect(store.order).toContain('/')
    expect(store.order).toContain('/settings')
    expect(store.order.length).toBe(DEFAULT_MENU_ORDER.length)
  })
})