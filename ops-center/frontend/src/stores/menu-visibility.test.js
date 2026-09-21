import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MENU_ITEMS } from '../config/menuItems'
import { useMenuStore } from './menu'

// 回归保护（2026-09-21）：菜单设置页可操作的菜单项必须与左侧真实侧边栏在同一角色下完全一致。
// 根因：SettingsView 曾各自硬编码 `!adminOnly` 过滤，admin 登录时设置页比侧边栏少 5 个
// adminOnly 项（用户反馈/模型密钥/改写硬约束/选项控制/应用菜单）。
// 修复：可见性口径收敛为 menuStore.visibleForRole(role) 单一事实源，侧边栏与设置页共用。
// 内存版 localStorage，避免依赖 jsdom 环境（与 menu.test.js 同模式）
function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  }
}

describe('menu store - visibleForRole（侧边栏/设置页共用可见性口径）', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage()
    setActivePinia(createPinia())
  })

  it('admin 看到全部菜单项（含 adminOnly），与 MENU_ITEMS 完全一致', () => {
    const store = useMenuStore()
    expect(store.visibleForRole('admin').map((i) => i.path))
      .toEqual(MENU_ITEMS.map((i) => i.path))
  })

  it('非 admin 只看到非 adminOnly 项', () => {
    const store = useMenuStore()
    const expected = MENU_ITEMS.filter((i) => !i.adminOnly).map((i) => i.path)
    expect(store.visibleForRole('viewer').map((i) => i.path)).toEqual(expected)
    expect(store.visibleForRole(undefined).map((i) => i.path)).toEqual(expected)
  })

  it('5 个 adminOnly 项对 admin 可见（防配置遗漏回归）', () => {
    const store = useMenuStore()
    const adminPaths = store.visibleForRole('admin').map((i) => i.path)
    for (const p of [
      '/feedback', '/model-keys', '/rewrite-hard-constraints', '/pipeline-options', '/app-menu',
    ]) {
      expect(adminPaths).toContain(p)
    }
  })

  it('跟随排序变化（重排后按新顺序返回）', () => {
    const store = useMenuStore()
    store.reorderByPath('/feedback', '/')
    expect(store.visibleForRole('admin')[0].path).toBe('/feedback')
    // adminOnly 项的移动不影响非 admin 视图
    expect(store.visibleForRole('viewer')[0].path).toBe('/')
  })
})
