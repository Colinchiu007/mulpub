/**
 * MpSidebar 共享侧边栏驱动聚焦标签测试（方案 B，2026-09-24）
 *
 * 缺陷背景：新建（home-shell）标签聚焦时点击左侧菜单，跳转发生在被 WebContentsView
 * 覆盖隐藏的首页标签上，当前可见标签毫无反应，用户误以为「点了没反应」。
 *
 * 契约：
 * - 聚焦 home-shell 标签 → 点击经 IPC 定向让该实例自身导航（navigateActiveHomeShell），主窗口路由不动；
 * - 聚焦普通网页标签 → 先切回首页标签再导航，让变化可见；
 * - 高亮跟随：home-shell 聚焦时用 activeTab.spaRoute 判定激活，而非主窗口 route.path。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import i18n from '@/i18n'

const routeState = vi.hoisted(() => ({ path: '/' }))
const pushMock = vi.hoisted(() => vi.fn(async () => {}))
const navShellMock = vi.hoisted(() => vi.fn(async () => ({ code: 0, data: { handled: true } })))
const switchToTabMock = vi.hoisted(() => vi.fn(async () => {}))
const tabStoreState = vi.hoisted(() => ({
  activeTabIsHomeShell: false,
  activeTab: { tabId: 'home', spaRoute: '', isHome: true },
  isHomeTab: true,
  tabs: [{ tabId: 'home', isHome: true }],
  activeTabId: 'home',
  switchToTab: switchToTabMock,
}))

vi.mock('@/api/electron-bridge', () => ({
  invoke: vi.fn(async () => ({ code: 0 })),
  invokePageManager: vi.fn(),
  getApi: () => ({ pageManager: { navigateActiveHomeShell: navShellMock } }),
}))

vi.mock('@/stores/tab', () => ({
  useTabStore: () => tabStoreState,
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/composables/useAppVersion', async () => {
  const { ref } = await import('vue')
  return { useAppVersion: () => ({ version: ref(''), loadVersion: vi.fn() }) }
})

import MpSidebar from './MpSidebar.vue'

let wrapper

function mountSidebar () {
  i18n.global.locale.value = 'zh'
  wrapper = mount(MpSidebar, {
    global: {
      plugins: [i18n, createPinia()],
      stubs: {
        ProfileMenu: { template: '<div data-testid="profile-menu-stub" />' },
        UpgradeModal: { template: '<div data-testid="upgrade-modal-stub" />' },
        ElPopover: {
          template: '<div class="el-popover-stub"><slot name="reference" /><slot /></div>',
        },
        RouterLink: {
          props: { to: { type: [String, Object], default: '' } },
          computed: {
            href () {
              return typeof this.to === 'string' ? this.to : this.to.path
            },
          },
          template: '<a :href="href" v-bind="$attrs"><slot /></a>',
        },
      },
    },
  })
  return wrapper
}

function setHomeShellFocus (spaRoute) {
  tabStoreState.activeTabIsHomeShell = true
  tabStoreState.isHomeTab = false
  tabStoreState.activeTabId = 'shell-1'
  tabStoreState.activeTab = { tabId: 'shell-1', spaRoute, isHome: false, homeShell: true }
  tabStoreState.tabs = [
    { tabId: 'home', isHome: true },
    { tabId: 'shell-1', isHome: false, homeShell: true, spaRoute },
  ]
}

function setWebTabFocus () {
  tabStoreState.activeTabIsHomeShell = false
  tabStoreState.isHomeTab = false
  tabStoreState.activeTabId = 'web-1'
  tabStoreState.activeTab = { tabId: 'web-1', spaRoute: '', isHome: false }
  tabStoreState.tabs = [
    { tabId: 'home', isHome: true },
    { tabId: 'web-1', isHome: false },
  ]
}

beforeEach(() => {
  routeState.path = '/'
  pushMock.mockClear()
  navShellMock.mockClear()
  switchToTabMock.mockClear()
  navShellMock.mockResolvedValue({ code: 0, data: { handled: true } })
  tabStoreState.activeTabIsHomeShell = false
  tabStoreState.isHomeTab = true
  tabStoreState.activeTabId = 'home'
  tabStoreState.activeTab = { tabId: 'home', spaRoute: '', isHome: true }
  tabStoreState.tabs = [{ tabId: 'home', isHome: true }]
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('MpSidebar 共享侧边栏驱动聚焦标签', () => {
  it('聚焦 home-shell 标签：点击菜单经 IPC 定向导航，主窗口 router.push 不被调用', async () => {
    setHomeShellFocus('/')
    const sidebar = mountSidebar()
    await nextTick()

    await sidebar.get('[data-testid="mp-primary-accounts"]').trigger('click')

    expect(navShellMock).toHaveBeenCalledWith('/accounts')
    expect(pushMock).not.toHaveBeenCalled()
    expect(switchToTabMock).not.toHaveBeenCalled()
  })

  it('聚焦普通网页标签：先切回首页标签再导航，使变化可见', async () => {
    setWebTabFocus()
    const sidebar = mountSidebar()
    await nextTick()

    await sidebar.get('[data-testid="mp-primary-accounts"]').trigger('click')

    expect(navShellMock).not.toHaveBeenCalled()
    expect(switchToTabMock).toHaveBeenCalledWith('home')
    expect(pushMock).toHaveBeenCalledWith('/accounts')
  })

  it('高亮跟随：home-shell 聚焦时用 activeTab.spaRoute 判定激活（非主窗口 route.path）', async () => {
    // 主窗口 route 仍在 '/'，但聚焦的 home-shell 实例真实页面在 /accounts
    routeState.path = '/'
    setHomeShellFocus('/accounts')
    const sidebar = mountSidebar()
    await nextTick()

    expect(sidebar.get('[data-testid="mp-primary-accounts"]').classes()).toContain('active')
    expect(sidebar.get('[data-testid="mp-primary-accounts"]').attributes('aria-current')).toBe('page')
  })

  it('home-shell IPC 未处理（handled:false）时回退为切回首页 + 主窗口导航', async () => {
    setHomeShellFocus('/')
    navShellMock.mockResolvedValue({ code: 0, data: { handled: false } })
    const sidebar = mountSidebar()
    await nextTick()

    await sidebar.get('[data-testid="mp-primary-accounts"]').trigger('click')

    expect(navShellMock).toHaveBeenCalledWith('/accounts')
    expect(pushMock).toHaveBeenCalledWith('/accounts')
  })
})
