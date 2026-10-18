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
    getApi: () => null,
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
        MpModuleNav: true,
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
