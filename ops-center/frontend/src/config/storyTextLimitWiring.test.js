// @vitest-environment jsdom
// router/index.js 在模块加载时 createRouter + createWebHashHistory（需要 window.location），
// 因此本文件必须走 jsdom（与 changePasswordWiring.test.js 同一原因）。
import { describe, expect, it } from 'vitest'
import { RESTART_HINT_HOW, RESTART_HINT_WHEN } from '../constants/runtime-delivery'
import { DEFAULT_MENU_ORDER, MENU_ITEMS } from '../config/menuItems'
import { routes } from '../router'
import { pageGuides } from '../pageGuides'

/**
 * 「字数控制」接线锁（防漏接回归）。
 *
 * 背景：新增一个菜单页要同时改四处 —— menuItems.js（侧边栏）、router/index.js（路由）、
 * pageGuides.js（页头说明）、views/*.vue（页面本体）。任一处漏接都不会报错：
 * 菜单点了跳空白路由、页头说明静默消失。本文件把四处接线一次性钉住。
 */

const NEW_PATH = '/story-text-limit'

describe('字数控制 - 菜单/路由/说明 接线', () => {
  it('menuItems.js 已登记「字数控制」，且仅管理员可见', () => {
    const item = MENU_ITEMS.find((i) => i.path === NEW_PATH)
    expect(item, 'MENU_ITEMS 缺少 /story-text-limit').toBeTruthy()
    expect(item.label).toBe('字数控制')
    expect(item.adminOnly).toBe(true)
    expect(item.icon, '/story-text-limit 缺少图标（侧边栏会渲染空白）').toBeTruthy()
  })

  it('菜单项紧跟在「选项控制」之后（需求指定的菜单位置）', () => {
    const paths = MENU_ITEMS.map((i) => i.path)
    const idx = paths.indexOf(NEW_PATH)
    expect(idx, 'MENU_ITEMS 缺少 /story-text-limit').toBeGreaterThan(0)
    expect(paths[idx - 1]).toBe('/pipeline-options')
    // 默认顺序由 MENU_ITEMS 推导，旧 localStorage 会自动补齐该项
    expect(DEFAULT_MENU_ORDER).toContain(NEW_PATH)
  })

  it('router 已登记 /story-text-limit，命名为 StoryTextLimit 且懒加载', () => {
    const route = routes.find((r) => r.path === NEW_PATH)
    expect(route, 'routes 缺少 /story-text-limit').toBeTruthy()
    expect(route.name).toBe('StoryTextLimit')
    expect(typeof route.component).toBe('function')
  })

  it('路由两道锁都上：requiresAuth + adminOnly（与菜单口径一致）', () => {
    const route = routes.find((r) => r.path === NEW_PATH)
    expect(route.meta.requiresAuth).toBe(true)
    // 配置下发类页面；菜单已 adminOnly，路由不同口径会留下「知道地址就能进」的旁门
    expect(route.meta.adminOnly).toBe(true)
  })

  it('pageGuides 已按路由 name 提供页头说明（否则页头静默空白）', () => {
    const route = routes.find((r) => r.path === NEW_PATH)
    const guide = pageGuides[route.name]
    expect(guide, `pageGuides 缺少 ${route.name} 的说明`).toBeTruthy()
    expect(guide).toHaveLength(3)
    expect(guide[0]).toBe('字数控制')
    // 页头说明要与页面正文同口径：默认 10000 字、历史 6000 字
    expect(guide[1]).toContain('10000')
    expect(guide[1]).toContain('6000')
    // 生效时机同样走单一真源；不得出现与桌面端实现不符的「手动/定时同步」说法
    expect(guide[1]).toContain(RESTART_HINT_WHEN)
    expect(guide[1]).toContain(RESTART_HINT_HOW)
    expect(guide[1]).not.toContain('手动同步')
    expect(guide[1]).not.toContain('定时同步')
    expect(guide[1]).not.toContain('24 小时')
  })

  it('菜单项与路由一一对应：每个菜单 path 都有路由', () => {
    const menuPaths = MENU_ITEMS.map((i) => i.path)
    const routePaths = routes.map((r) => r.path)
    const menuOnly = menuPaths.filter((p) => !routePaths.includes(p))
    expect(menuOnly, `菜单项缺对应路由: ${menuOnly.join(', ')}`).toEqual([])
  })
})
