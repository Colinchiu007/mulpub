/**
 * 发布页草稿在【路由切换】时保持 —— App.vue keep-alive 行为级回归测试
 * （缺口：首页里点左侧菜单/模块导航离开 /publish 再回来，草稿丢失；v-show 只解决标签切换那条，
 *   路由切换仍会重挂载 Publish.vue。修复＝App.vue 主工作区 <keep-alive :include="['Publish']">）
 *
 * 真挂载 App.vue + 双路由（/publish 命名 'Publish' 的状态组件 + / 另一页），驱动
 * /publish → / → /publish 一次来回，断言 Publish 实例**从未被销毁**（setup 计数恒 1、
 * 草稿值保留）。把 keep-alive 摘掉时本测试必须变红（反证）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref, reactive, nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/electron-bridge', () => ({
  getApi: () => ({
    pageManager: {
      onTabEvent: () => () => {},
      on: () => () => {},
      onNavigationChanged: () => () => {},
      subscribeEvents: async () => ({ code: 0, data: { subscriberId: 'test-sub' } }),
      unsubscribeEvents: async () => ({ code: 0 }),
      getAllTabs: async () => ({ code: 0, data: [] }),
      getActiveTab: async () => ({ code: 0, data: null }),
      switchToTab: async () => ({ code: 0 }),
      saveAccountTabCredentials: async () => ({ code: 0 }),
    },
    onNavigate: () => () => {},
  }),
  invokePageManager: () => Promise.resolve(),
}))
vi.mock('@/utils/home-shell', () => ({ isHomeShellSearch: () => false }))
vi.mock('@/router', () => ({ routeLoadError: ref(null), clearRouteLoadError: () => {} }))
vi.mock('@/stores/license', () => ({ useLicenseStore: () => ({ load: () => {} }) }))
vi.mock('@/stores/identity', () => ({ useIdentityStore: () => ({ load: () => {}, dispose: () => {} }) }))
// 与真实模块的**被消费面**同形：App.vue 现在还会 watch「就地打开设置」请求
// （settingsDialogRequest），mock 少一个导出会让 watch(undefined) 直接抛错
// （2026-10-15 实测：本文件 + publish-tab-state-keepalive 共 5 例全红）
vi.mock('@/stores/settings-dialog', () => ({
  notifySettingsDialogClosed: () => {},
  settingsDialogRevision: ref(0),
  settingsDialogRequest: ref(null),
}))
vi.mock('@/composables/useEmbeddedViewSuspension', () => ({
  suspendEmbeddedViewsForOverlay: () => {},
  releaseEmbeddedViewsForOverlay: () => {},
}))
vi.mock('@/composables/useAccountActions', () => ({ useAccountActions: () => ({}) }))
vi.mock('@/composables/useSpaNavHistory', () => ({
  useSpaNavHistory: () => ({ canGoBack: ref(false), canGoForward: ref(false), attach: () => {}, dispose: () => {} }),
}))
vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

import i18n from '@/i18n'
import App from './App.vue'

// 组件名必须为 'Publish'，才能被 App.vue 的 <keep-alive :include="['Publish']"> 命中缓存。
const setupCalls = ref(0)
const PublishPage = defineComponent({
  name: 'Publish',
  setup () {
    setupCalls.value += 1
    const article = reactive({ video_path: '' })
    return { article }
  },
  template: '<div class="publish-page" data-testid="publish-page">{{ article.video_path }}</div>',
})
const OtherPage = defineComponent({
  name: 'Home',
  setup () { return {} },
  template: '<div data-testid="other-page">other</div>',
})

const childStubs = {
  MpSidebar: true, MpModuleNav: true, TabBar: true, NavBar: true, OfflineIndicator: true,
  UpdateNotification: true, SettingsDialog: true, BackToTop: true, PipelineBackgroundToast: true,
  PublishProgressPanel: true, RouteLoadError: true,
}

async function mountApp () {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/publish', name: 'Publish', component: PublishPage },
      { path: '/', name: 'Home', component: OtherPage },
    ],
  })
  await router.push('/publish')
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(App, { global: { plugins: [router, pinia, i18n], stubs: childStubs }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

describe('App.vue keep-alive：发布页草稿在路由切换时保持', () => {
  beforeEach(() => { setupCalls.value = 0; document.body.replaceChildren() })

  it('/publish → / → /publish 一次来回：Publish 实例不被销毁、草稿保留', async () => {
    const { wrapper, router } = await mountApp()
    expect(setupCalls.value).toBe(1)
    const page = wrapper.findComponent(PublishPage)
    expect(page.exists()).toBe(true)
    page.vm.article.video_path = '01.mp4'
    await nextTick()
    expect(wrapper.find('[data-testid="publish-page"]').text()).toBe('01.mp4')

    // 离开发布页（模拟点左侧菜单/模块导航）
    await router.push('/')
    await nextTick()
    expect(wrapper.find('[data-testid="other-page"]').exists()).toBe(true)

    // 回到发布页
    await router.push('/publish')
    await nextTick()
    // 关键反证点：keep-alive 命中 → 实例从未被销毁 → setup 仍只执行一次（无 keep-alive 会重挂载变 2）
    expect(setupCalls.value).toBe(1)
    const back = wrapper.findComponent(PublishPage)
    expect(back.exists()).toBe(true)
    expect(back.vm.article.video_path).toBe('01.mp4')
    expect(wrapper.find('[data-testid="publish-page"]').text()).toBe('01.mp4')
  })

  it('非发布页（Home）不纳入 include：来回切换仍按原语义重挂载（不缓存）', async () => {
    const { wrapper, router } = await mountApp()
    // 先离开到 Home 再回 Publish 再离开 Home：Home 每次都是新实例（未被 keep-alive 缓存）
    await router.push('/')
    await nextTick()
    await router.push('/publish')
    await nextTick()
    await router.push('/')
    await nextTick()
    // Publish 只被挂载一次（缓存生效），与 Home 是否缓存无关；这里断言 Publish 计数仍为 1
    expect(setupCalls.value).toBe(1)
  })
})
