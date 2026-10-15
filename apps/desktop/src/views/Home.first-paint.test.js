import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Home.vue 首屏数据并行化契约测试（fix-newtab-home-slow）
 *
 * 缺陷背景（2026-10-15 真机实测）：「+」新标签 3-4 秒才显示主页。除 bundle 体积外，
 * Home.vue onMounted 里 6 个数据源是**串行** await：
 *   platformStore.load() → accountStore.ensureLoaded() → refreshExpiredAccounts()
 *   → dashboardStats() → historyList()
 * 其中 refreshExpiredAccounts 内部又 accountStore.load() + accountBatchCheckLogin()，
 * 后者逐账号跑 checkLoginStatus（HTTP/浏览器降级），单账号最坏 60s 超时。
 *
 * 契约（修复后）：
 *   ① 首屏渲染（骨架 + 静态区块）不依赖任何 IPC 返回；
 *   ② 统计/近期动态并行取数，任一失败不影响其他区块渲染；
 *   ③ 失效账号校验走懒触发（用户可见后再跑），不阻塞首屏。
 */

// ── mock 掉全部 IPC 面，让测试只验证「谁在什么时候被调用」──
// vi.hoisted：vi.mock 的工厂被提升到文件顶部，无法引用外层变量；
// 用 hoisted 造出的对象是「同一份引用」，用例里改写它的字段即可实时改桩行为。
const h = vi.hoisted(() => {
  const calls = []
  const apiStub = {
    dashboardStats: async () => { calls.push('dashboardStats'); return { code: 0, data: { total: 0, success: 0, failed: 0, daily: [] } } },
    historyList: async () => { calls.push('historyList'); return { code: 0, data: { total: 0, records: [] } } },
  }
  const publisherStub = {
    accountBatchOpenLogin: async () => ({ code: 0, data: { items: [] } }),
    listAccounts: async () => ({ code: 0, data: [] }),
    getPlatformDefinitions: async () => ({ code: 0, data: { loginUrls: {}, names: {}, icons: {}, dashboardUrls: {}, qrCodePlatforms: [] } }),
    historyList: async () => { calls.push('publisher.historyList'); return apiStub.historyListResult ?? { code: 0, data: { total: 0, records: [] } } },
    dashboardStats: async () => apiStub.dashboardStatsResult ?? { code: 0, data: { total: 0, success: 0, failed: 0, daily: [] } },
    accountBatchCheckLogin: async () => { calls.push('accountBatchCheckLogin'); return { code: 0, data: { results: [] } } },
    onAuthCompleted: () => () => {},
    onAccountStatusChanged: () => () => {},
    onRiskHold: () => () => {},
    onProgress: () => () => {},
    storeGetSettingResult: async () => ({ ok: false }),
  }
  return { calls, apiStub, publisherStub }
})

const calls = h.calls
const apiStub = h.apiStub

vi.mock('@/api/electron-bridge', () => ({
  getApi: () => h.apiStub,
  invokePageManager: () => undefined,
}))

vi.mock('@/api/publisher', () => h.publisherStub)

import i18n from '@/i18n'
import Home from './Home.vue'

function mountHome () {
  setActivePinia(createPinia())
  return mount(Home, { props: {}, global: { plugins: [i18n, createPinia()] } })
}

describe('Home.vue 首屏数据并行化', () => {
  beforeEach(() => { calls.length = 0 })
  afterEach(() => { vi.clearAllMocks(); delete apiStub.dashboardStatsResult; delete apiStub.historyListResult })

  it('首帧即渲染静态区块，无需等待任何 IPC', async () => {
    const w = mountHome()
    await nextTick()
    // 骨架/标题/快捷入口/平台列表在 nextTick 后就该在
    expect(w.find('[data-testid="home-publish-hero"]').exists()).toBe(true)
    expect(w.findAll('.mp-home-shortcut').length).toBeGreaterThan(0)
    expect(w.findAll('.mp-home-platform-tag').length).toBeGreaterThan(0)
    // 统计卡存在（值可以是 0，属加载中占位）
    expect(w.findAll('.mp-home-stat-card').length).toBe(4)
  })

  it('dashboardStats 与 historyList 并行发起，不互相等待', async () => {
    // 并行性判据：让 dashboard 明显慢于 history，若实现为串行 await，
    // history 的开始/结束都会被 dashboard 挡在后面。
    // Home.vue 的统计与历史都走 api.*（getApi() 直取），两条都造延时桩。
    const order = []
    apiStub.dashboardStats = async () => {
      order.push('dashboard:start')
      await new Promise(r => setTimeout(r, 40))
      order.push('dashboard:end')
      return { code: 0, data: { total: 1, success: 1, failed: 0, daily: [] } }
    }
    apiStub.historyList = async () => {
      order.push('history:start')
      await new Promise(r => setTimeout(r, 2))
      order.push('history:end')
      return { code: 0, data: { total: 0, records: [] } }
    }
    const w = mountHome()
    // 桩内部用 setTimeout 造延时，flushPromises 只清微任务队列、不推进定时器，
    // 必须给足够的真实时间让两个 setTimeout 都到期。
    await new Promise(r => setTimeout(r, 120))
    await flushPromises()
    expect(order).toContain('dashboard:start')
    expect(order).toContain('history:start')
    // history 远快于 dashboard ⇒ 它的结束必须早于 dashboard 结束
    expect(order.indexOf('history:end')).toBeLessThan(order.indexOf('dashboard:end'))
    w.unmount()
  })

  it('dashboardStats 失败不阻断整页渲染', async () => {
    apiStub.dashboardStats = async () => { throw new Error('boom') }
    const w = mountHome()
    await flushPromises()
    expect(w.find('[data-testid="mp-home"]').exists()).toBe(true)
    expect(w.findAll('.mp-home-stat-card').length).toBe(4)
    w.unmount()
  })

  it('失效账号校验（accountBatchCheckLogin）不在首屏同步 await 链上', async () => {
    const w = mountHome()
    await nextTick()
    // nextTick 时（首帧）不应已发起逐账号登录态校验
    expect(calls.filter(c => c === 'accountBatchCheckLogin').length).toBe(0)
    w.unmount()
  })
})
