// @ts-nocheck
// 主题引导的**装配锁**（UX-AUDIT 阶段 1.1 / audit-9）——
// 不是再测一遍 useTheme 的判据，而是证明「以生产方式挂载的 App 真的会把持久化的主题落到 document」。
//
// 为什么需要这条锁：audit-9 的形状正是「useTheme 写好了、CSS 暗色分支写好了、
// 20 张暗色基线也备好了，但 `useTheme()` 的生产调用点是 0」。
// 若只给外观面板写用例，就会留下第二个缺口：用户不打开设置面板时，
// 上次选的深色在**本次启动**完全不生效（表现为「设置没保存」）。
// 这条锁盯的就是 App.vue 这一层的接线，摘掉 `useTheme()` 调用必须变红。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

var routerMock

vi.mock('vue-router', () => {
  routerMock = {
    push: vi.fn(),
    replace: vi.fn(),
    onError: () => () => {},
    afterEach: () => () => {},
    beforeEach: () => () => {},
    isReady: () => Promise.resolve(),
    currentRoute: { value: { name: 'home', path: '/' } },
  }
  return {
    useRouter: () => routerMock,
    useRoute: () => ({ path: '/', query: {} }),
    createRouter: () => routerMock,
    createWebHashHistory: () => ({}),
    RouterLink: { template: '<a><slot /></a>' },
    RouterView: { template: '<div><slot name="default" /></div>' },
  }
})

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({
    notify: vi.fn(), notifyError: vi.fn(), notifySuccess: vi.fn(),
    notifyWarning: vi.fn(), notifyInfo: vi.fn(),
    notifyConfirm: vi.fn().mockResolvedValue(true),
  }),
}))

import i18n from '@/i18n'
import App from './App.vue'
import { __resetThemeStateForTest } from '@/composables/useTheme'

function mountApp () {
  return mount(App, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        RouterView: true, RouterLink: true, PublishProgressPanel: true,
        RouteLoadError: true, TabBar: true, ElConfigProvider: true,
      },
    },
  })
}

describe('App 装配主题引导', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    __resetThemeStateForTest()
    routerMock.currentRoute.value = { name: 'home', path: '/' }
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    window.electronAPI = {
      schedulerList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      onSchedulerDispatchFailed: vi.fn(() => () => {}),
      onNavigate: vi.fn(() => () => {}),
      firstRunCheck: vi.fn().mockResolvedValue({ code: 0, data: { setupDone: true } }),
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'dark' }),
      storeSetSetting: vi.fn().mockResolvedValue({ code: 0, data: true }),
    }
  })

  afterEach(() => {
    __resetThemeStateForTest()
    delete window.electronAPI
    delete window.matchMedia
  })

  it('挂载 App 即读取 ui:theme 并把持久化的深色落到 document（用户不必打开设置面板）', async () => {
    const w = mountApp()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(window.electronAPI.storeGetSetting).toHaveBeenCalledWith('ui:theme')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    w.unmount()
  })

  it('无持久化偏好时按系统偏好落浅色，且不会因此写一次存储（无意图不得写盘）', async () => {
    window.electronAPI.storeGetSetting = vi.fn().mockResolvedValue({ code: 0, data: null })
    const w = mountApp()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(window.electronAPI.storeSetSetting).not.toHaveBeenCalled()
    w.unmount()
  })
})
