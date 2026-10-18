// @ts-nocheck
// 首运向导的**装配锁**（UX-AUDIT 阶段 1.4）——不是再测一遍判据，
// 而是证明「以生产方式挂载的 App 真的调用了 useFirstRunGate，并且它真的会导航」。
//
// 为什么需要这条锁：`useFirstRunGate.js` 有 6 条自己的用例、路由表里有 /first-run、
// preload 也暴露了 firstRunCheck ——三件事同时为真而无人调用它，用户依然永远进不了向导。
// 这正是本仓 CHANGELOG 里反复出现的「注册 ≠ 注入 ≠ 执行」形状（audit-4/audit-6 同款）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// vi.mock 的工厂会被提到 import 之前执行，所以共享对象用 var 声明（提升为 undefined，
// 工厂里赋值即可；用 const 会踩 "Cannot access before initialization"）。
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

describe('App 装配首运判定', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    routerMock.currentRoute.value = { name: 'home', path: '/' }
    window.electronAPI = {
      schedulerList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      onSchedulerDispatchFailed: vi.fn(() => () => {}),
      onNavigate: vi.fn(() => () => {}),
      firstRunCheck: vi.fn().mockResolvedValue({ code: 0, data: { setupDone: false } }),
    }
  })

  afterEach(() => {
    delete window.electronAPI
    vi.useRealTimers()
  })

  it('未引导过 ⇒ App 挂载后被 replace 到 /first-run（拉取真源，不靠推送）', async () => {
    const w = mountApp()
    await nextTick()
    await nextTick()
    expect(window.electronAPI.firstRunCheck).toHaveBeenCalled()
    expect(routerMock.replace).toHaveBeenCalledWith('/first-run')
    w.unmount()
  })

  it('已引导过 ⇒ 一步都不跳（正常用户不得每次启动都看见向导）', async () => {
    window.electronAPI.firstRunCheck = vi.fn()
      .mockResolvedValue({ code: 0, data: { setupDone: true } })
    const w = mountApp()
    await nextTick()
    await nextTick()
    expect(routerMock.replace).not.toHaveBeenCalled()
    expect(routerMock.push).not.toHaveBeenCalled()
    w.unmount()
  })

  it('读不到状态（桥接无该方法）⇒ 不跳：把"没证据"读成"没引导"是错误方向', async () => {
    delete window.electronAPI.firstRunCheck
    const w = mountApp()
    await nextTick()
    await nextTick()
    expect(routerMock.replace).not.toHaveBeenCalled()
    w.unmount()
  })

  it('已在 /first-run 上不重复 replace（避免自我替换循环）', async () => {
    routerMock.currentRoute.value = { name: 'FirstRun', path: '/first-run' }
    const w = mountApp()
    await nextTick()
    await nextTick()
    expect(routerMock.replace).not.toHaveBeenCalled()
    w.unmount()
  })
})
