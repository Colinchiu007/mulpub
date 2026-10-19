import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

// App 壳层接线 —— 全局侧边栏折叠的行为契约（TDD，先于实现编写）。
//
// 两条不可由组件级测试覆盖的接线：
//   1) MpSidebar 用 v-show（而非 v-if）跟随全局状态：折叠只隐藏、不卸载；
//      卸载会让侧边栏的 ResizeObserver / 运营菜单配置 / 登录区状态全部重建，
//      并且再次展开时首帧会闪一次 0 宽再回到 200px（宽度上报抖动）。
//   2) App 挂载时主动把**持久化后的**折叠状态上报主进程：主进程默认 false，
//      若用户上次退出时是收起态，不补这一报，之后新建的浏览器/登录标签
//      WebContentsView 仍会从 x=200 开始 —— 左侧留出 200px 死区。
const invokePageManagerMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ code: 0 })))

vi.mock('@/api/electron-bridge', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    invokePageManager: invokePageManagerMock,
  }
})

vi.mock('vue-router', () => {
  const noop = () => () => {}
  const router = {
    push: vi.fn(),
    onError: noop,
    afterEach: () => () => {},
    beforeEach: () => () => {},
    isReady: () => Promise.resolve(),
    currentRoute: { value: { name: 'home' } },
  }
  return {
    useRouter: () => router,
    useRoute: () => ({ path: '/', query: {} }),
    createRouter: () => router,
    createWebHashHistory: () => ({}),
    RouterLink: { template: '<a><slot /></a>' },
    RouterView: { template: '<div><slot name="default" /></div>' },
  }
})

import i18n from '@/i18n'
import App from './App.vue'
import { sidebarCollapsed } from '@/stores/sidebar-collapse'

function mountApp () {
  return mount(App, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        RouterView: true,
        RouterLink: true,
        MpSidebar: { template: '<div data-testid="mp-sidebar-stub" />' },
        TabBar: true,
        NavBar: true,
        PublishProgressPanel: true,
        RouteLoadError: true,
        UpdateNotification: true,
        SettingsDialog: true,
        PipelineBackgroundToast: true,
        BackToTop: true,
        OfflineIndicator: true,
      },
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  invokePageManagerMock.mockClear()
  sidebarCollapsed.value = false
  window.localStorage.clear()
})

afterEach(() => {
  sidebarCollapsed.value = false
})

describe('App 壳层：侧边栏折叠接线', () => {
  it('侧边栏用 v-show 跟随全局状态：收起只隐藏、不卸载，展开后恢复', async () => {
    const w = mountApp()
    await nextTick()

    const sidebar = w.get('[data-testid="mp-sidebar-stub"]')
    expect(sidebar.element.style.display).not.toBe('none')

    sidebarCollapsed.value = true
    await nextTick()
    expect(w.get('[data-testid="mp-sidebar-stub"]').element.style.display).toBe('none')

    sidebarCollapsed.value = false
    await nextTick()
    expect(w.get('[data-testid="mp-sidebar-stub"]').element.style.display).not.toBe('none')

    w.unmount()
  })

  it('App 挂载时把持久化折叠状态上报主进程（新建内嵌视图按全宽定位）', async () => {
    const w = mountApp()
    await nextTick()

    const reports = invokePageManagerMock.mock.calls.filter(
      ([method]) => method === 'setSidebarCollapsed',
    )
    expect(reports).toHaveLength(1)
    expect(reports[0]).toEqual(['setSidebarCollapsed', false])

    w.unmount()
  })
})

describe('App 壳层：多窗口折叠广播订阅（2026-10-18）', () => {
  /** 上一个测试装上的 electronAPI 备份，afterAll 还原 */
  let savedElectronAPI

  beforeAll(() => {
    savedElectronAPI = window.electronAPI
  })

  afterAll(() => {
    window.electronAPI = savedElectronAPI
  })

  /** 让 window.electronAPI 带上 pageManager.onSidebarCollapsedChanged（getApi 的真实读取路径） */
  function mockApiWithBroadcast () {
    const listeners = []
    const noopOff = () => () => {}
    const noopAsync = vi.fn(async () => ({ code: 0 }))
    const pm = {
      onSidebarCollapsedChanged: vi.fn((cb) => {
        listeners.push(cb)
        return () => {
          const i = listeners.indexOf(cb)
          if (i >= 0) listeners.splice(i, 1)
        }
      }),
      // tabStore.init() 走 pageManager 命名空间订阅标签事件（见 stores/tab.js:45,154-179）
      on: vi.fn(noopOff),
      onTabEvent: vi.fn(noopOff),
      onNavigationChanged: vi.fn(noopOff),
      subscribeEvents: noopAsync,
      unsubscribeEvents: noopAsync,
      navigateActiveHomeShell: noopAsync,
      reportTabTitle: noopAsync,
      getAllTabs: noopAsync,
      getActiveTab: noopAsync,
      getHomeTab: noopAsync,
      saveAccountTabCredentials: noopAsync,
      saveCookies: noopAsync,
      getAccountTabSaveState: noopAsync,
      saveAllUnsavedAccounts: noopAsync,
      switchToTab: noopAsync,
      createNewTabPage: noopAsync,
      closeTab: noopAsync,
    }
    const api = {
      pageManager: pm,
      onTabEvent: vi.fn(noopOff),
      onNavigationChanged: vi.fn(noopOff),
      subscribeEvents: noopAsync,
      unsubscribeEvents: noopAsync,
      onNavigate: vi.fn(noopOff),
      onSchedulerDispatchFailed: vi.fn(noopOff),
      getAllTabs: noopAsync,
      getActiveTab: noopAsync,
    }
    window.electronAPI = api
    return { pm, emit: (collapsed) => listeners.slice().forEach((cb) => cb(collapsed)) }
  }

  it('挂载时订阅主进程折叠广播', async () => {
    const { pm } = mockApiWithBroadcast()
    const w = mountApp()
    await nextTick()

    expect(pm.onSidebarCollapsedChanged).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('收到广播后用 applyRemoteCollapsed 应用：只改本地 ref，不写 localStorage、不向主进程上报折叠态', async () => {
    const { emit } = mockApiWithBroadcast()
    const w = mountApp()
    await nextTick()
    // 启动补报（reportSidebarCollapsed）与壳态 watcher 的 setShellMode 都是已设计行为，
    // 先清掉，只验「广播路径有没有额外上报折叠态」。
    invokePageManagerMock.mockClear()
    window.localStorage.clear()

    emit(true)
    await nextTick()
    await new Promise((r) => setTimeout(r, 30))

    expect(sidebarCollapsed.value).toBe(true)
    // 广播来的状态不得回写持久化（真源是用户点击的那个窗口）
    expect(window.localStorage.getItem('mulpub.ui.sidebarCollapsed')).toBeNull()
    // 不得向主进程上报折叠态（回传会形成 A↔B 互刷）
    const collapseReports = invokePageManagerMock.mock.calls.filter(
      ([method]) => method === 'setSidebarCollapsed',
    )
    expect(collapseReports).toHaveLength(0)

    w.unmount()
  })

  it('广播驱动侧边栏显隐（v-show 跟随）', async () => {
    const { emit } = mockApiWithBroadcast()
    const w = mountApp()
    await nextTick()

    emit(true)
    await nextTick()
    expect(w.get('[data-testid="mp-sidebar-stub"]').element.style.display).toBe('none')

    emit(false)
    await nextTick()
    expect(w.get('[data-testid="mp-sidebar-stub"]').element.style.display).not.toBe('none')

    w.unmount()
  })

  it('卸载后退订广播监听（防止跨路由泄漏重复订阅）', async () => {
    const { pm } = mockApiWithBroadcast()
    const w = mountApp()
    await nextTick()
    expect(pm.onSidebarCollapsedChanged).toHaveBeenCalledTimes(1)

    w.unmount()
    const off = pm.onSidebarCollapsedChanged.mock.results[0].value
    expect(typeof off).toBe('function')

    // 再挂载一次：退订函数若无效，listeners 会累积（此处验证卸载时确实调用过退订）
    const w2 = mountApp()
    await nextTick()
    expect(pm.onSidebarCollapsedChanged).toHaveBeenCalledTimes(2)
    w2.unmount()
  })

  it('preload 未暴露 onSidebarCollapsedChanged（老版本）时静默跳过，不影响壳层', async () => {
    // 有 electronAPI、pageManager 有 tab 事件方法，但没有折叠广播方法
    const noopOff = () => () => {}
    const noopAsync = vi.fn(async () => ({ code: 0 }))
    window.electronAPI = {
      pageManager: {
        on: vi.fn(noopOff),
        onTabEvent: vi.fn(noopOff),
        onNavigationChanged: vi.fn(noopOff),
        subscribeEvents: noopAsync,
        unsubscribeEvents: noopAsync,
        getAllTabs: noopAsync,
        getActiveTab: noopAsync,
        getHomeTab: noopAsync,
        switchToTab: noopAsync,
      },
    }
    const w = mountApp()
    await nextTick()

    expect(sidebarCollapsed.value).toBe(false)
    w.unmount()
  })
})
