/**
 * 固化标签切回后工作区状态保持 —— App.vue 行为级回归测试
 * （Bug: 首页固化标签的视频发布页选完本地视频，切到账号标签再切回后草稿丢失）
 *
 * 根因：App.vue 主窗口分支曾以 `v-if="!isLoginTab"` 条件渲染 <router-view>。
 *       当活动标签是账号/登录标签时 isLoginTab 为 true，v-if 会**卸载**整个
 *       工作区路由组件（如 Publish.vue 的 article/video_path 等局部草稿状态），
 *       切回首页即重挂载为全新实例 → 未保存草稿全部丢失。
 * 修复：改用 `v-show="!isLoginTab"` —— 登录标签激活时内嵌 WebContentsView 已覆盖
 *       内容矩形，这里只需「隐藏」工作区避免重叠，绝不能「卸载」。
 *
 * 本测试真跑挂载流程（非源码记录性断言）：home → 账号标签 → home 一次来回后，
 * 工作区路由组件实例必须**从未被销毁**（setup 只执行一次、草稿值原样保留、
 * 隐藏期间仅 display:none）。把 App.vue 改回 v-if 时本测试必须变红（反证）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref, reactive, nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'

// ── 主进程桥：全部方法给最小可解析桩，令 tabStore.init()/setShellMode 静默通过 ──
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
vi.mock('@/router', () => ({
  routeLoadError: ref(null),
  clearRouteLoadError: () => {},
}))
vi.mock('@/stores/license', () => ({ useLicenseStore: () => ({ load: () => {} }) }))
vi.mock('@/stores/identity', () => ({ useIdentityStore: () => ({ load: () => {}, dispose: () => {} }) }))
// 与真实模块的**被消费面**同形：App.vue 现在还会 watch「就地打开设置」请求
// （settingsDialogRequest），mock 少一个导出会让 watch(undefined) 直接抛错
// （2026-10-15 实测：本文件 + publish-draft-keepalive 共 5 例全红）
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
  useSpaNavHistory: () => ({
    canGoBack: ref(false),
    canGoForward: ref(false),
    attach: () => {},
    dispose: () => {},
  }),
}))
vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

import i18n from '@/i18n'
import App from './App.vue'
import { useTabStore } from '@/stores/tab'

// 工作区路由组件：模拟 Publish.vue 的「局部草稿状态」——setup 计数 + 一个可写的
// video_path。被卸载再重挂载会让 setupCalls 递增且草稿值归零，正是本 Bug 的可观测面。
const setupCalls = ref(0)
const WorkspacePage = defineComponent({
  name: 'WorkspacePage',
  setup () {
    setupCalls.value += 1
    const article = reactive({ video_path: '' })
    return { article }
  },
  template: '<div class="workspace-page" data-testid="workspace-page">{{ article.video_path }}</div>',
})

const childStubs = {
  MpSidebar: true,
  MpModuleNav: true,
  TabBar: true,
  NavBar: true,
  OfflineIndicator: true,
  UpdateNotification: true,
  SettingsDialog: true,
  BackToTop: true,
  PipelineBackgroundToast: true,
  PublishProgressPanel: true,
  RouteLoadError: true,
}

async function mountApp () {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'home', component: WorkspacePage }],
  })
  await router.push('/')
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(App, {
    global: { plugins: [router, pinia, i18n], stubs: childStubs },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, pinia }
}

describe('App.vue 固化标签切回后工作区状态保持（v-show 不卸载 router-view）', () => {
  beforeEach(() => {
    setupCalls.value = 0
    // 清空挂载容器：用 replaceChildren() 而非 innerHTML=''（后者是安全扫描器判定的
    // XSS sink 形态，写它会连累本文件所在的任何提交被 CCG verify-security 拦下）
    document.body.replaceChildren()
  })

  it('首页标签：工作区路由组件挂载且 setup 恰好执行一次', async () => {
    const { wrapper } = await mountApp()
    const tabStore = useTabStore()
    tabStore.tabs = [
      { tabId: 'home', isHome: true, title: '首页' },
      { tabId: 'acc', accountId: 'a1', title: '抖音 创作者中心' },
    ]
    tabStore.activeTabId = 'home'
    await nextTick()

    expect(setupCalls.value).toBe(1)
    expect(wrapper.find('[data-testid="workspace-page"]').exists()).toBe(true)
  })

  it('切到账号标签再切回首页：工作区实例不被销毁、草稿值原样保留', async () => {
    const { wrapper } = await mountApp()
    const tabStore = useTabStore()
    tabStore.tabs = [
      { tabId: 'home', isHome: true, title: '首页' },
      { tabId: 'acc', accountId: 'a1', title: '抖音 创作者中心' },
    ]
    tabStore.activeTabId = 'home'
    await nextTick()

    const page = wrapper.findComponent(WorkspacePage)
    expect(page.exists()).toBe(true)
    // 模拟用户选定本地视频文件（Publish.vue 的 article.video_path）
    page.vm.article.video_path = '01.mp4'
    await nextTick()
    expect(wrapper.find('[data-testid="workspace-page"]').text()).toBe('01.mp4')
    expect(setupCalls.value).toBe(1)

    // ① 切到账号标签（isLoginTab 变 true）
    tabStore.activeTabId = 'acc'
    await nextTick()
    // 组件必须仍挂载（v-if 会在此处销毁 → exists() 变 false → 本断言变红）
    expect(wrapper.findComponent(WorkspacePage).exists()).toBe(true)
    // 隐藏语义：display:none 而非移除
    const hiddenEl = wrapper.find('[data-testid="workspace-page"]')
    expect(hiddenEl.exists()).toBe(true)
    expect(hiddenEl.attributes('style') || '').toMatch(/display:\s*none/)

    // ② 切回首页固化标签
    tabStore.activeTabId = 'home'
    await nextTick()
    // 关键反证点：实例从未被销毁 → setup 仍只执行一次（v-if 会重挂载变 2）
    expect(setupCalls.value).toBe(1)
    // 草稿值原样保留（Bug 现象：这里会变成空字符串）
    const backPage = wrapper.findComponent(WorkspacePage)
    expect(backPage.vm.article.video_path).toBe('01.mp4')
    expect(wrapper.find('[data-testid="workspace-page"]').text()).toBe('01.mp4')
    // 恢复可见（不再 display:none）
    expect(wrapper.find('[data-testid="workspace-page"]').attributes('style') || '').not.toMatch(/display:\s*none/)
  })

  it('普通浏览器标签（无 accountId、非登录）不触发隐藏，工作区始终可见', async () => {
    const { wrapper } = await mountApp()
    const tabStore = useTabStore()
    tabStore.tabs = [
      { tabId: 'home', isHome: true, title: '首页' },
      { tabId: 'browse', title: '某网页' },
    ]
    tabStore.activeTabId = 'home'
    await nextTick()
    const page = wrapper.findComponent(WorkspacePage)
    page.vm.article.video_path = 'keep-me'
    await nextTick()

    tabStore.activeTabId = 'browse'
    await nextTick()
    // 普通标签 isLoginTab=false → 不隐藏
    expect(wrapper.find('[data-testid="workspace-page"]').attributes('style') || '').not.toMatch(/display:\s*none/)
    expect(setupCalls.value).toBe(1)
  })
})
