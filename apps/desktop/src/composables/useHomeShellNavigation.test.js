/**
 * useHomeShellNavigation 回归锁（UX-AUDIT-2026-10-17 阶段 1.5）
 *
 * 动因：三段式此前只活在 MpSidebar 的点击处理里，全局快捷键走裸 router.push，
 * 于是「当前是网页标签」时键盘导航把路由推到用户看不见的后台首页标签 —— 按了没反应。
 * 本锁既锁三段式每条分支，也锁「鼠标与键盘确实共用这一份实现」（结构锁）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { navigateToHomeShellRoute } from './useHomeShellNavigation'

function makeDeps (overrides = {}) {
  const tabStore = {
    activeTabIsHomeShell: false,
    isHomeTab: true,
    activeTabId: 'home-1',
    tabs: [{ tabId: 'home-1', isHome: true }, { tabId: 'web-1', isHome: false }],
    switchToTab: vi.fn(async () => true),
    ...(overrides.tabStore || {}),
  }
  const router = { push: vi.fn(async () => true), ...(overrides.router || {}) }
  const api = overrides.api === undefined
    ? { pageManager: { navigateActiveHomeShell: vi.fn(async () => ({ code: 0, data: { handled: false } })) } }
    : overrides.api
  const warn = overrides.warn || vi.fn()
  return { tabStore, router, api, warn }
}

describe('navigateToHomeShellRoute 三段式', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('目标不合法时直接返回 false，不碰任何依赖', async () => {
    const deps = makeDeps()
    expect(await navigateToHomeShellRoute('', deps)).toBe(false)
    expect(await navigateToHomeShellRoute(undefined, deps)).toBe(false)
    expect(await navigateToHomeShellRoute(42, deps)).toBe(false)
    expect(deps.router.push).not.toHaveBeenCalled()
    expect(deps.tabStore.switchToTab).not.toHaveBeenCalled()
  })

  it('① 内嵌主页实例聚焦时经 IPC 定向，handled 为真即结束（不动主窗口路由）', async () => {
    const deps = makeDeps({
      tabStore: { activeTabIsHomeShell: true },
      api: { pageManager: { navigateActiveHomeShell: vi.fn(async () => ({ code: 0, data: { handled: true } })) } },
    })
    expect(await navigateToHomeShellRoute('/dashboard', deps)).toBe(true)
    expect(deps.api.pageManager.navigateActiveHomeShell).toHaveBeenCalledWith('/dashboard')
    expect(deps.router.push).not.toHaveBeenCalled()
  })

  it('② 定向未接管（IPC 缺失 / 返回不 handled / 抛错）时继续走后续两段', async () => {
    for (const api of [
      null,
      { pageManager: {} },
      { pageManager: { navigateActiveHomeShell: vi.fn(async () => ({ code: 0, data: { handled: false } })) } },
      { pageManager: { navigateActiveHomeShell: vi.fn(async () => { throw new Error('ipc down') }) } },
    ]) {
      const deps = makeDeps({ tabStore: { activeTabIsHomeShell: true, isHomeTab: true }, api })
      expect(await navigateToHomeShellRoute('/accounts', deps)).toBe(true)
      expect(deps.router.push).toHaveBeenCalledWith('/accounts')
      deps.router.push.mockClear()
    }
  })

  it('③ 当前是普通网页标签时先切回首页标签再导航（让变化可见）', async () => {
    const deps = makeDeps({ tabStore: { isHomeTab: false, activeTabId: 'web-1' } })
    await navigateToHomeShellRoute('/collection', deps)
    expect(deps.tabStore.switchToTab).toHaveBeenCalledWith('home-1')
    expect(deps.router.push).toHaveBeenCalledWith('/collection')
  })

  it('④ 已经在首页标签时不做多余切换', async () => {
    const deps = makeDeps()
    await navigateToHomeShellRoute('/keywords', deps)
    expect(deps.tabStore.switchToTab).not.toHaveBeenCalled()
    expect(deps.router.push).toHaveBeenCalledWith('/keywords')
  })

  it('切标签失败只停那一步：仍继续导航并留痕（不得升级成整次导航失败）', async () => {
    const warn = vi.fn()
    const deps = makeDeps({
      tabStore: { isHomeTab: false, activeTabId: 'web-1', switchToTab: vi.fn(async () => { throw new Error('switch fail') }) },
      warn,
    })
    await navigateToHomeShellRoute('/viral-analysis', deps)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('switch home'), expect.any(Error))
    expect(deps.router.push).toHaveBeenCalledWith('/viral-analysis')
  })

  it('router.push 抛错被吞并留痕，不向调用方冒泡', async () => {
    const warn = vi.fn()
    const deps = makeDeps({ router: { push: vi.fn(async () => { throw new Error('nav fail') }) }, warn })
    await expect(navigateToHomeShellRoute('/x', deps)).resolves.toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('navigate failed'), expect.any(Error))
  })
})

describe('鼠标与键盘确实共用同一份实现（结构锁）', () => {
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')

  it('MpSidebar 与 App.vue 都 import useHomeShellNavigation', () => {
    for (const rel of ['../layouts/MpSidebar.vue', '../App.vue']) {
      expect(read(rel), rel).toMatch(/useHomeShellNavigation/)
    }
  })

  it('MpSidebar 不再自带三段式（否则就是第二份实现，会漂）', () => {
    const src = read('../layouts/MpSidebar.vue')
    expect(src).not.toMatch(/navigateActiveHomeShell/)
    expect(src).not.toMatch(/switch home failed/)
  })

  it('App.vue 的快捷键落点走共用实现，不再裸 router.push', () => {
    const src = read('../App.vue')
    const at = src.indexOf('api.onNavigate')
    expect(at).toBeGreaterThan(-1)
    const block = src.slice(at, at + 400)
    expect(block).toMatch(/navigate\(\s*route\s*\)/)
    expect(block).not.toMatch(/router\.push\(\s*route\s*\)/)
  })
})
