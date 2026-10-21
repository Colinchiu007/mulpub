// @ts-nocheck
/**
 * App 壳层：全局快捷键导航必须是「可见导航」（UX 审计 1.5）。
 *
 * 现场：主进程 `hotkeys.js` 注册全局加速键后向渲染层发 `app:navigate`，
 * `App.vue` 的订阅回调做的是裸 `router.push(route)`。而侧边栏的点击走的是另一套
 * 三段式（内嵌主页实例定向 / 先切回首页标签 / 才 push）。于是同一个动作：
 *   - 用户停在首页标签：鼠标与键盘都看得见；
 *   - 用户停在**网页标签**（原生 WebContentsView 盖在主窗口之上）：鼠标点侧边栏会先切回
 *     首页再跳，看得见；按快捷键则主窗口路由在覆盖层背后悄悄变了 —— 屏幕上什么都不会发生。
 * 本文件把"键盘这条路也必须走同一段实现"钉住（不是补一个 if，而是消掉一份复制的判断）。
 *
 * 夹具口径：用**真 tab store**（不 mock `@/stores/tab`），因为被断言的是
 * 「isHomeTab / activeTabIsHomeShell / switchToTab 经 pageManager IPC」这条真实链路；
 * 手搓一份同名 getter 的 mock 会让"读错字段"这一类缺陷对测试结构性免疫。
 * 标签状态在挂载后播种（`tabStore.init()` 会把 tabs 覆写成 home 一条）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 判据的扫描根由**本文件自身定位**，不用 process.cwd()（评审 R2-i6）：
 * 从仓库根以 workspace 模式跑 vitest 时 cwd 不是 apps/desktop，届时的失败读起来
 * 像「结构锁全红」，实际是判据的坐标漂了 —— 把坐标钉在文件位置上，锁的可用域才与声明一致。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(HERE, '..')


const routerMock = vi.hoisted(() => ({
  push: vi.fn(async () => {}),
  onError: () => () => {},
  afterEach: () => () => {},
  beforeEach: () => () => {},
  isReady: () => Promise.resolve(),
  currentRoute: { value: { name: 'home', fullPath: '/', query: {} } },
}))

vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ path: '/', query: {}, fullPath: '/' }),
  createRouter: () => routerMock,
  createWebHashHistory: () => ({}),
  RouterLink: { template: '<a><slot /></a>' },
  RouterView: { template: '<div><slot name="default" /></div>' },
}))

import i18n from '@/i18n'
import { useTabStore } from '@/stores/tab'
import App from './App.vue'

const HOME_TAB = { tabId: 'home', isHome: true, title: '首页', url: '', loading: false }
const WEB_TAB = { tabId: 'web', isHome: false, homeShell: false, title: '网页', url: 'https://example.com', loading: false }
const SHELL_TAB = { tabId: 'web', isHome: false, homeShell: true, spaRoute: '/some/page', title: '主页实例', url: '', loading: false }

/** 事件顺序账本：'switch' = 经 pageManager 切标签，'push' = 主窗口路由，'home-shell' = 定向 IPC */
let order = []
let navigateHandler = null
let pageManager = null
let piniaInstance = null

function makePageManager () {
  return {
    on: () => () => {},
    // tabStore.init() 会订阅这两个通道（`onTabEvent` / `on`）；缺一个就是 unhandled
    // rejection，而"3 files passed"照样打印 —— 基线必须 0 错误，否则变异红集不可归因。
    onTabEvent: () => () => {},
    onNavigationChanged: () => () => {},
    subscribeEvents: async () => ({ code: 0, data: { subscriberId: 'visible-nav-test' } }),
    unsubscribeEvents: async () => ({ code: 0 }),
    getAllTabs: async () => ({ code: 0, data: [] }),
    getActiveTab: async () => ({ code: 0, data: null }),
    setShellMode: async () => ({ code: 0 }),
    setSidebarCollapsed: async () => ({ code: 0 }),
    switchToTab: async (tabId) => { order.push('switch:' + tabId) },
    navigateActiveHomeShell: async (to) => {
      order.push('home-shell:' + to)
      return { code: 0, data: { handled: true } }
    },
  }
}

function mountApp () {
  return mount(App, {
    global: {
      plugins: [piniaInstance, i18n],
      stubs: {
        RouterView: true,
        RouterLink: true,
        MpSidebar: true,
        TabBar: true,
        NavBar: true,
        PublishProgressPanel: true,
        RouteLoadError: true,
        UpdateNotification: true,
        SettingsDialog: true,
        PipelineBackgroundToast: true,
        BackToTop: true,
        OfflineIndicator: true,
        ElConfigProvider: true,
      },
    },
  })
}

async function flush () {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await nextTick()
}

/**
 * 挂载后播种标签状态，并**当场自证前提**（夹具前提必须自己断言）：
 * init() 会把 tabs 覆写成只含 home 一条，若播种被它吃掉，这里就红在"前提"上，
 * 而不是让后面的顺序断言以一种读不懂的方式失败。
 */
function seed ({ tabs, activeTabId }) {
  const tabStore = useTabStore()
  tabStore.tabs = tabs
  tabStore.activeTabId = activeTabId
  return tabStore
}

beforeEach(() => {
  order = []
  navigateHandler = null
  piniaInstance = createPinia()
  setActivePinia(piniaInstance)
  routerMock.push.mockReset()
  routerMock.push.mockImplementation(async () => { order.push('push') })
  pageManager = makePageManager()
  window.electronAPI = {
    onNavigate: vi.fn((cb) => {
      navigateHandler = cb
      return () => { navigateHandler = null }
    }),
    schedulerList: vi.fn(async () => ({ code: 0, data: [] })),
    onSchedulerDispatchFailed: vi.fn(() => () => {}),
    pageManager,
  }
})

afterEach(() => {
  delete window.electronAPI
})

describe('App 壳层：app:navigate 必须是可见导航', () => {
  it('挂载即订阅全局导航（快捷键在任何页面都该有反应）', async () => {
    const w = mountApp()
    await flush()
    expect(window.electronAPI.onNavigate).toHaveBeenCalledTimes(1)
    expect(typeof navigateHandler).toBe('function')
    w.unmount()
  })

  it('停在网页标签时按快捷键：先切回首页标签，再跳目标路由（顺序不可反）', async () => {
    const w = mountApp()
    await flush()
    const tabStore = seed({ tabs: [HOME_TAB, WEB_TAB], activeTabId: 'web' })
    await flush()
    expect(tabStore.isHomeTab, '夹具前提：当前聚焦必须是网页标签').toBe(false)

    navigateHandler('/publish')
    await flush()

    const switchIdx = order.indexOf('switch:home')
    const pushIdx = order.indexOf('push')
    expect(order, '只 push 主窗口路由时，跳转发生在原生覆盖层背后 —— 用户看不到任何变化').toEqual(['switch:home', 'push'])
    expect(switchIdx, '必须先切标签').toBeGreaterThanOrEqual(0)
    expect(pushIdx, '切完必须 push').toBeGreaterThanOrEqual(0)
    expect(switchIdx, '顺序不可反').toBeLessThan(pushIdx)
    w.unmount()
  })

  it('聚焦内嵌主页实例时：定向让它自己跳，主窗口隐藏路由不动', async () => {
    const navSpy = vi.fn(async (to) => {
      order.push('home-shell:' + to)
      return { code: 0, data: { handled: true } }
    })
    pageManager.navigateActiveHomeShell = navSpy
    const w = mountApp()
    await flush()
    const tabStore = seed({ tabs: [HOME_TAB, SHELL_TAB], activeTabId: 'web' })
    await flush()
    expect(tabStore.activeTabIsHomeShell, '夹具前提：聚焦标签必须是 home-shell 实例').toBe(true)

    navigateHandler('/collection')
    await flush()

    expect(navSpy).toHaveBeenCalledWith('/collection')
    expect(order, '定向成功后不得再切标签、不得再 push 主窗口路由').toEqual(['home-shell:/collection'])
    w.unmount()
  })

  it('定向无回执（老 preload / 主进程判非 home-shell）⇒ 回落可见路径，不静默失效', async () => {
    pageManager.navigateActiveHomeShell = async (to) => {
      order.push('home-shell:' + to)
      return { code: 0, data: { handled: false } }
    }
    const w = mountApp()
    await flush()
    seed({ tabs: [HOME_TAB, SHELL_TAB], activeTabId: 'web' })
    await flush()

    navigateHandler('/accounts')
    await flush()

    expect(order).toEqual(['home-shell:/accounts', 'switch:home', 'push'])
    w.unmount()
  })

  it('已经在首页标签时不重复切标签（不多一次无谓的 IPC）', async () => {
    const w = mountApp()
    await flush()
    const tabStore = seed({ tabs: [HOME_TAB, WEB_TAB], activeTabId: 'home' })
    await flush()
    expect(tabStore.isHomeTab, '夹具前提：当前聚焦就是首页标签').toBe(true)

    navigateHandler('/dashboard')
    await flush()

    expect(order).toEqual(['push'])
    w.unmount()
  })

  it('卸载时解除订阅（不留跨实例幽灵回调）', async () => {
    const stop = vi.fn(() => { navigateHandler = null })
    window.electronAPI.onNavigate = vi.fn((cb) => {
      navigateHandler = cb
      return stop
    })
    const w = mountApp()
    await flush()
    seed({ tabs: [HOME_TAB, WEB_TAB], activeTabId: 'web' })
    await flush()
    w.unmount()
    await flush()

    expect(stop, 'onBeforeUnmount 必须成对注销').toHaveBeenCalledTimes(1)
    if (navigateHandler) navigateHandler('/publish')
    await flush()
    expect(order, '注销后再来事件不得跳转').toEqual([])
  })
})

// ── 接线锁：两处入口必须共用同一实现 ────────────────────────────────
// 本单元的根因是"同一段判断被抄了两遍，其中一遍漏了"。只在行为层修 App.vue，
// 下一次再新增入口（命令面板 / 托盘菜单）就会重演；所以把"不得有第二份"钉成结构锁。
describe('接线锁：键盘与鼠标入口共用 useVisibleNavigation', () => {
  const ROOT = path.resolve(DESKTOP_ROOT, 'src')
  const appSrc = fs.readFileSync(path.join(ROOT, 'App.vue'), 'utf8')
  const sidebarSrc = fs.readFileSync(path.join(ROOT, 'layouts', 'MpSidebar.vue'), 'utf8')

  /** 去掉行注释，避免解释性散文里的字样被当成代码 */
  const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const appCode = code(appSrc)
  const sidebarCode = code(sidebarSrc)

  /**
   * 从调用名起始处取外层实参文本（括号配对 + 跳过字符串字面量）。
   * 取不到（未配对）返回 null —— 判据必须显式拒绝 null，否则"解析退化成空串"
   * 会让锁读起来像"回调体里没有 router.push"。
   * @returns {string|null}
   */
  function balancedCall (text, from) {
    const open = text.indexOf('(', from)
    if (open < 0) return null
    let depth = 0
    let quote = null
    for (let k = open; k < text.length; k += 1) {
      const ch = text[k]
      if (quote) {
        if (ch === '\\') { k += 1; continue }
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) return text.slice(open + 1, k)
      }
    }
    return null
  }

  it('取体逻辑自证：嵌套括号与字符串里的假括号都不得截断它', () => {
    const sample = 'api.onNavigate((route) => { if (x) { y() } foo("a)b") })\napi.other(() => router.push(1))'
    const body = balancedCall(sample, sample.indexOf('onNavigate'))
    expect(body, '字符串里的右括号不得提前收口').toContain('foo("a)b")')
    expect(body, '不得越界吃到下一个调用').not.toContain('api.other')
    expect(balancedCall('api.x((a => b', 6), '未配对必须返回 null，不得静默给半截').toBeNull()
  })

  it('App.vue 的 onNavigate 回调必须走 navigateVisibly（不得再裸 push 主窗口路由）', () => {
    const anchor = appCode.indexOf('api.onNavigate(')
    expect(anchor, 'App.vue 里必须仍有 api.onNavigate 订阅（锚点失效）').toBeGreaterThanOrEqual(0)
    // 回调体用**括号配对**取，而不是固定字符窗口或单一字面形态：
    // 窗口会把相邻的合法 router.push（内嵌主页实例自己的订阅）误读成违规，
    // 而字面形态匹配能被"先用中间变量存 route / 再包一层 helper"绕过（评审 i6）。
    const body = balancedCall(appCode, anchor + 'api.'.length)
    expect(body, '回调体必须整体取到（括号未配对 = 取体逻辑失效）').not.toBeNull()
    expect(body, '键盘入口必须调用共享实现').toContain('navigateVisibly(')
    expect(body, '裸 router.push(route) 会让跳转发生在看不见的背后').not.toContain('router.push(')
  })

  it('MpSidebar.vue 不得再自带一份定向导航/切标签判断（单一实现）', () => {
    expect(sidebarCode, '侧边栏必须引用共享实现').toContain('useVisibleNavigation')
    expect(sidebarCode, 'navigateActiveHomeShell 只准出现在共享实现里').not.toContain('navigateActiveHomeShell')
    expect(sidebarCode).not.toMatch(/switchToTab\(\s*(homeTab|['"]home['"])/)
  })

  it('共享实现只有一份：App.vue 与 MpSidebar.vue 都 import 同一个组合式', () => {
    expect(appCode).toContain("@/composables/useVisibleNavigation")
    expect(sidebarCode).toContain("@/composables/useVisibleNavigation")
    const impl = fs.readFileSync(path.join(ROOT, 'composables', 'useVisibleNavigation.js'), 'utf8')
    expect(code(impl)).toContain('export function useVisibleNavigation')
  })
})
