/**
 * sidebar-menu-merge 单测 —— 覆盖 PRD「应用菜单」章节的全部校验规则与兜底契约。
 *
 * 测试策略：以真实 SIDEBAR_MENU_DEFINITION 做集成断言（而非纯构造数据），
 * 确保「定义文件改动」能被测试捕获。
 */
import { describe, it, expect } from 'vitest'
import {
  SIDEBAR_MENU_DEFINITION,
  SIDEBAR_FORCED_VISIBLE_KEYS,
  SIDEBAR_GROUP_PRIMARY,
  SIDEBAR_GROUP_MORE,
} from './sidebar-menu'
import {
  MAX_APP_MENU_ITEMS,
  MAX_SORT_ORDER,
  normalizeSortOrder,
  normalizeVisible,
  normalizeAppMenuConfig,
  resolveSidebarMenu,
  visibleItemsOf,
} from './sidebar-menu-merge'

const keysOf = (items) => items.map((i) => i.key)
const findItem = (resolved, key) =>
  [...resolved[SIDEBAR_GROUP_PRIMARY], ...resolved[SIDEBAR_GROUP_MORE]].find((i) => i.key === key)

// ─────────────────────────────────────────────────────────
describe('normalizeSortOrder — sort_order 数值校验', () => {
  it('接受非负整数与可解析字符串', () => {
    expect(normalizeSortOrder(0)).toBe(0)
    expect(normalizeSortOrder(7)).toBe(7)
    expect(normalizeSortOrder('12')).toBe(12)
    expect(normalizeSortOrder(3.9)).toBe(3)
  })

  it('拒绝负数、NaN、Infinity、空值、对象', () => {
    expect(normalizeSortOrder(-1)).toBeNull()
    expect(normalizeSortOrder(NaN)).toBeNull()
    expect(normalizeSortOrder(Infinity)).toBeNull()
    expect(normalizeSortOrder('abc')).toBeNull()
    expect(normalizeSortOrder('')).toBeNull()
    expect(normalizeSortOrder(null)).toBeNull()
    expect(normalizeSortOrder(undefined)).toBeNull()
    expect(normalizeSortOrder({})).toBeNull()
  })

  it('超大值被夹到 MAX_SORT_ORDER（不产生排序异常）', () => {
    expect(normalizeSortOrder(1e12)).toBe(MAX_SORT_ORDER)
  })
})

// ─────────────────────────────────────────────────────────
describe('normalizeVisible — visible 白名单为真', () => {
  it('仅明确的真值视为可见', () => {
    expect(normalizeVisible(true)).toBe(true)
    expect(normalizeVisible(1)).toBe(true)
    expect(normalizeVisible('1')).toBe(true)
    expect(normalizeVisible('true')).toBe(true)
  })

  it('字符串 "false" / null / 对象 / 未定义视为隐藏', () => {
    expect(normalizeVisible('false')).toBe(false)
    expect(normalizeVisible(false)).toBe(false)
    expect(normalizeVisible(0)).toBe(false)
    expect(normalizeVisible(null)).toBe(false)
    expect(normalizeVisible(undefined)).toBe(false)
    expect(normalizeVisible({})).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────
describe('normalizeAppMenuConfig — payload 结构校验', () => {
  it('结构非法一律返回 null（触发 fail-open）', () => {
    expect(normalizeAppMenuConfig(null)).toBeNull()
    expect(normalizeAppMenuConfig(undefined)).toBeNull()
    expect(normalizeAppMenuConfig('x')).toBeNull()
    expect(normalizeAppMenuConfig(42)).toBeNull()
    expect(normalizeAppMenuConfig({})).toBeNull()
    expect(normalizeAppMenuConfig({ items: 'nope' })).toBeNull()
    expect(normalizeAppMenuConfig({ items: null })).toBeNull()
  })

  it('空数组是合法配置（全部按默认可见渲染）', () => {
    const cfg = normalizeAppMenuConfig({ items: [] })
    expect(cfg).not.toBeNull()
    expect(Object.keys(cfg.map)).toHaveLength(0)
  })

  it(`超过 ${MAX_APP_MENU_ITEMS} 项时整体拒绝（防渲染 DoS）`, () => {
    const items = Array.from({ length: MAX_APP_MENU_ITEMS + 1 }, (_, i) => ({
      key: `k${i}`, visible: true, sort_order: i,
    }))
    expect(normalizeAppMenuConfig({ items })).toBeNull()
  })

  it('丢弃原型污染 key 与非法条目', () => {
    const cfg = normalizeAppMenuConfig({
      items: [
        { key: '__proto__', visible: true },
        { key: 'constructor', visible: true },
        { key: '   ', visible: true },
        null,
        'string',
        { key: 'publish', visible: false, sort_order: 1 },
      ],
    })
    expect(Object.keys(cfg.map)).toEqual(['publish'])
    expect(Object.prototype.polluted).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────
describe('resolveSidebarMenu — fail-open 降级（C1）', () => {
  const cases = [
    ['未下发 null', null],
    ['未下发 undefined', undefined],
    ['payload 非对象', 'garbage'],
    ['payload 缺 items', { synced_at: 'x' }],
    ['items 非数组', { items: {} }],
  ]

  it.each(cases)('%s → 全部可见 + 保持定义顺序', (_name, raw) => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, raw)
    expect(resolved[SIDEBAR_GROUP_PRIMARY].every((i) => i.visible)).toBe(true)
    expect(resolved[SIDEBAR_GROUP_MORE].every((i) => i.visible)).toBe(true)
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])).toEqual(
      keysOf(SIDEBAR_MENU_DEFINITION.filter((i) => i.group === SIDEBAR_GROUP_PRIMARY)),
    )
    expect(keysOf(resolved[SIDEBAR_GROUP_MORE])).toEqual(
      keysOf(SIDEBAR_MENU_DEFINITION.filter((i) => i.group === SIDEBAR_GROUP_MORE)),
    )
  })

  it('全部菜单项都在结果中，不丢失任何 key', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, null)
    const all = [...resolved[SIDEBAR_GROUP_PRIMARY], ...resolved[SIDEBAR_GROUP_MORE]]
    expect(keysOf(all).sort()).toEqual(SIDEBAR_MENU_DEFINITION.map((i) => i.key).sort())
  })
})

// ─────────────────────────────────────────────────────────
describe('resolveSidebarMenu — 强制项保护（C2）', () => {
  it.each(SIDEBAR_FORCED_VISIBLE_KEYS)('下发 %s.visible=false 时仍强制可见', (key) => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [{ key, visible: false, sort_order: 99 }],
    })
    const item = findItem(resolved, key)
    expect(item.visible).toBe(true)
    expect(item.forcedVisible).toBe(true)
  })

  it('强制项即使被恶意整体下发为 hidden 也不会消失', () => {
    const items = SIDEBAR_MENU_DEFINITION.map((i) => ({ key: i.key, visible: false, sort_order: 0 }))
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, { items })
    const visibleKeys = keysOf([
      ...visibleItemsOf(resolved, SIDEBAR_GROUP_PRIMARY),
      ...visibleItemsOf(resolved, SIDEBAR_GROUP_MORE),
    ])
    expect(visibleKeys.sort()).toEqual([...SIDEBAR_FORCED_VISIBLE_KEYS].sort())
  })

  it('非强制项标记 forcedVisible=false', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, null)
    expect(findItem(resolved, 'home').forcedVisible).toBe(false)
    expect(findItem(resolved, 'keywords').forcedVisible).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────
describe('resolveSidebarMenu — 显隐合并（C3/C4）', () => {
  it('非强制项按下发值隐藏', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [
        { key: 'home', visible: false, sort_order: 0 },
        { key: 'dashboard', visible: false, sort_order: 1 },
        { key: 'keywords', visible: false, sort_order: 0 },
      ],
    })
    expect(findItem(resolved, 'home').visible).toBe(false)
    expect(findItem(resolved, 'dashboard').visible).toBe(false)
    expect(findItem(resolved, 'keywords').visible).toBe(false)
    // 未提及的项保持可见
    expect(findItem(resolved, 'library').visible).toBe(true)
  })

  it('下发配置里的未知 key 被忽略（不新增菜单项）', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [{ key: 'definitely-not-exist', visible: true, sort_order: 0 }],
    })
    const all = [...resolved[SIDEBAR_GROUP_PRIMARY], ...resolved[SIDEBAR_GROUP_MORE]]
    expect(all).toHaveLength(SIDEBAR_MENU_DEFINITION.length)
    expect(findItem(resolved, 'definitely-not-exist')).toBeUndefined()
  })

  it('本地定义有但下发缺失的项仍可见（向后兼容新增菜单项）', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, { items: [] })
    expect(findItem(resolved, 'home').visible).toBe(true)
    expect(findItem(resolved, 'home').sortOrder).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────
describe('resolveSidebarMenu — 组内排序（C5）', () => {
  it('按 sort_order 升序重排 primary 组', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [
        { key: 'home', visible: true, sort_order: 1 },
        { key: 'publish', visible: true, sort_order: 0 },
        { key: 'accounts', visible: true, sort_order: 2 },
        { key: 'dashboard', visible: true, sort_order: 3 },
        { key: 'create', visible: true, sort_order: 4 },
        { key: 'collection', visible: true, sort_order: 5 },
      ],
    })
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])).toEqual([
      // 6 项已配置按 sort_order 升序；rewrite/copy-library 无 sort_order → 排在已配置项之后（copy-library 先于 rewrite，同定义顺序）
      'publish', 'home', 'accounts', 'dashboard', 'create', 'collection', 'copy-library', 'rewrite',
    ])
  })

  it('两组互不影响（more 组排序不改变 primary 组）', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [
        { key: 'keywords', visible: true, sort_order: 99 },
        { key: 'member-center', visible: true, sort_order: 0 },
      ],
    })
    // 已配置项优先：member-center(sort 0) → keywords(sort 99)；未配置项全部排在其后
    expect(keysOf(resolved[SIDEBAR_GROUP_MORE]).slice(0, 2)).toEqual(['member-center', 'keywords'])
    expect(keysOf(resolved[SIDEBAR_GROUP_MORE]).at(-1)).toBe('performance-insights')
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])).toEqual(
      keysOf(SIDEBAR_MENU_DEFINITION.filter((i) => i.group === SIDEBAR_GROUP_PRIMARY)),
    )
  })

  it('sort_order 相同时按定义顺序（稳定排序）', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [
        { key: 'collection', visible: true, sort_order: 5 },
        { key: 'home', visible: true, sort_order: 5 },
        { key: 'accounts', visible: true, sort_order: 5 },
      ],
    })
    // 同为 sort_order=5 → 按定义顺序 home → accounts → collection；未配置项排在其后
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY]).slice(0, 3)).toEqual([
      'home', 'accounts', 'collection',
    ])
    expect(
      resolved[SIDEBAR_GROUP_PRIMARY].slice(3).every((i) => i.sortOrder === null),
    ).toBe(true)
  })

  it('无 sort_order 的项排在已配置项之后并保持定义顺序', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [{ key: 'dashboard', visible: true, sort_order: 0 }],
    })
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])).toEqual([
      'dashboard', 'home', 'publish', 'accounts', 'create', 'collection', 'copy-library', 'rewrite',
    ])
  })

  it('非法 sort_order（负数/字符串）视为未配置', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [
        { key: 'dashboard', visible: true, sort_order: -5 },
        { key: 'accounts', visible: true, sort_order: 'oops' },
        { key: 'home', visible: true, sort_order: 0 },
      ],
    })
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])[0]).toBe('home')
    expect(resolved[SIDEBAR_GROUP_PRIMARY].slice(1).map((i) => i.sortOrder)).toEqual([
      null, null, null, null, null, null, null,
    ])
  })
})

// ─────────────────────────────────────────────────────────
describe('resolveSidebarMenu — 跨组归属（下发 group 覆盖本地，2026-09-16 撤销 D-GRP）', () => {
  it('下发 group=primary 把本地 more 项提到一级导航', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [{ key: 'keywords', visible: true, sort_order: 0, group: 'primary' }],
    })
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])).toContain('keywords')
    expect(keysOf(resolved[SIDEBAR_GROUP_MORE])).not.toContain('keywords')
  })

  it('下发 group=more 把本地 primary 项降入「更多」', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [{ key: 'dashboard', visible: true, sort_order: 0, group: 'more' }],
    })
    expect(keysOf(resolved[SIDEBAR_GROUP_MORE])).toContain('dashboard')
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])).not.toContain('dashboard')
  })

  it('下发 group 非法/缺失时 fail-open 回退本地定义', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [{ key: 'keywords', visible: true, sort_order: 0, group: 'bogus' }],
    })
    // 本地定义 keywords 在 more → 回退后仍属 more
    expect(keysOf(resolved[SIDEBAR_GROUP_MORE])).toContain('keywords')
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])).not.toContain('keywords')
  })

  it('强制显示项即使下发 group=more 仍锁定一级导航', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [{ key: 'publish', visible: true, sort_order: 0, group: 'more' }],
    })
    expect(keysOf(resolved[SIDEBAR_GROUP_PRIMARY])).toContain('publish')
    expect(keysOf(resolved[SIDEBAR_GROUP_MORE])).not.toContain('publish')
  })
})

// ─────────────────────────────────────────────────────────
describe('resolveSidebarMenu — 不可变性与健壮性（C6）', () => {
  it('不修改传入的 definition', () => {
    const snapshot = JSON.stringify(SIDEBAR_MENU_DEFINITION.map((i) => i.key))
    resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, {
      items: [{ key: 'home', visible: false, sort_order: 0 }],
    })
    expect(JSON.stringify(SIDEBAR_MENU_DEFINITION.map((i) => i.key))).toBe(snapshot)
  })

  it('不修改传入的 rawConfig', () => {
    const raw = { items: [{ key: 'home', visible: false, sort_order: 3 }] }
    const snapshot = JSON.stringify(raw)
    resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, raw)
    expect(JSON.stringify(raw)).toBe(snapshot)
  })

  it('definition 非数组 / 含空元素时不抛异常', () => {
    expect(() => resolveSidebarMenu(null, null)).not.toThrow()
    expect(() => resolveSidebarMenu([null, undefined, 'x'], null)).not.toThrow()
    const resolved = resolveSidebarMenu([null, { key: 'a', group: 'unknown-group' }], null)
    expect(resolved[SIDEBAR_GROUP_PRIMARY]).toEqual([])
    expect(resolved[SIDEBAR_GROUP_MORE]).toEqual([])
  })

  it('结果项不残留内部 index 字段', () => {
    const resolved = resolveSidebarMenu(SIDEBAR_MENU_DEFINITION, null)
    expect(resolved[SIDEBAR_GROUP_PRIMARY].every((i) => !('index' in i))).toBe(true)
  })

  it('visibleItemsOf 对非法输入返回空数组', () => {
    expect(visibleItemsOf(null, SIDEBAR_GROUP_PRIMARY)).toEqual([])
    expect(visibleItemsOf({}, SIDEBAR_GROUP_PRIMARY)).toEqual([])
    expect(visibleItemsOf({ primary: 'x' }, SIDEBAR_GROUP_PRIMARY)).toEqual([])
  })
})
