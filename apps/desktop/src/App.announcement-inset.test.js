// @ts-nocheck
// 公告横幅的**装配锁**（UX-AUDIT 阶段 1.2 / audit-6）。
//
// 这条链的失败形状是"每一环都对，合起来没人接"：
// 组件有、数据链有（ops-center → OpsCenterSync → opsCenterSyncRuntime）、preload 有、
// 主进程 handler 有，而 App.vue 里没挂 → 用户永远看不到公告（audit-6 的原始状态）。
// `AnnouncementBanner.test.js` 测的是组件自身；本文件测的是"以生产方式挂载 App 时，
// 公告真的出现，且它的高度真的走到了 pageManager.setTopInset"。
// 摘掉 App.vue 里的 `<AnnouncementBanner @inset=... />` 必须变红。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

var routerMock
var announcements = ref([])

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

vi.mock('@/composables/useOpsCenterRuntime', () => ({
  useOpsCenterRuntime: () => ({
    announcements,
    loadRuntime: vi.fn().mockResolvedValue({ code: 0, data: {} }),
  }),
}))

import i18n from '@/i18n'
import App from './App.vue'

const BANNER_HEIGHT = 64

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

describe('App 装配公告横幅与顶部下移', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    i18n.global.locale.value = 'zh'
    routerMock.currentRoute.value = { name: 'home', path: '/' }
    announcements.value = [{ id: 'ann-1', title: '系统维护通知', severity: 'maintenance' }]
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get () { return this.classList && this.classList.contains('announcement-banners') ? BANNER_HEIGHT : 0 },
    })
    window.electronAPI = {
      schedulerList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      onSchedulerDispatchFailed: vi.fn(() => () => {}),
      onNavigate: vi.fn(() => () => {}),
      firstRunCheck: vi.fn().mockResolvedValue({ code: 0, data: { setupDone: true } }),
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: null }),
      storeSetSetting: vi.fn().mockResolvedValue({ code: 0, data: true }),
      pageManager: {
        setTopInset: vi.fn().mockResolvedValue({ code: 0 }),
        setShellMode: vi.fn().mockResolvedValue({ code: 0 }),
        // main 侧 App.vue 现在会在 onMounted 里 tabStore.init()，它走 pageManager 命名空间
        // 订阅标签事件并 subscribeEvents（见 stores/tab.js:44-50,150-179,244）。
        // 夹具必须与真实桥同形：缺键时挂载链抛出未捕获 rejection，而用例仍全绿——
        // vitest 把 "Errors 4" 与 "59 passed" 同时打印，只数通过数就会把它读成通过。
        on: vi.fn(() => () => {}),
        onTabEvent: vi.fn(() => () => {}),
        onNavigationChanged: vi.fn(() => () => {}),
        subscribeEvents: vi.fn().mockResolvedValue({ code: 0, data: { subscriberId: 'test-sub' } }),
        unsubscribeEvents: vi.fn().mockResolvedValue({ code: 0 }),
        getAllTabs: vi.fn().mockResolvedValue({ code: 0, data: [] }),
        getActiveTab: vi.fn().mockResolvedValue({ code: 0, data: null }),
      },
    }
  })

  afterEach(() => {
    delete window.electronAPI
    announcements.value = []
    delete HTMLElement.prototype.offsetHeight
  })

  it('公告存在 ⇒ 横幅渲染，并把实测高度经 pageManager.setTopInset 交给主进程', async () => {
    const w = mountApp()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(w.find('[data-testid="announcement-banners"]').exists()).toBe(true)
    expect(w.text()).toContain('系统维护通知')
    expect(window.electronAPI.pageManager.setTopInset).toHaveBeenCalledWith(BANNER_HEIGHT)
    w.unmount()
  })

  it('无公告 ⇒ 报 0，绝不把主进程留在上一次的下移上', async () => {
    announcements.value = []
    const w = mountApp()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(window.electronAPI.pageManager.setTopInset).toHaveBeenCalledWith(0)
    w.unmount()
  })
})
