import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

const routeState = vi.hoisted(() => ({ path: '/accounts' }))
const push = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push }),
}))

const mockIdentityState = vi.hoisted(() => ({
  status: 'authenticated',
  user: { name: '测试用户', username: 'testuser' },
  displayName: '测试用户',
  entitlement: null,
  signIn: vi.fn(),
  switchAccount: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => mockIdentityState,
}))

vi.mock('@/stores/license', () => ({
  useLicenseStore: () => ({
    isPro: false,
    isTrial: false,
    isFree: true,
  }),
}))

const serviceStatusState = vi.hoisted(() => ({
  services: [
    { key: 'mainBackend', name: '主服务', status: 'running', port: 8299, reason: 'ok', restartable: true, onDemand: false },
    { key: 'splitterEngine', name: '分句引擎', status: 'running', port: 8002, reason: 'ok', restartable: true, onDemand: false },
    { key: 'promptEngine', name: '提示词优化引擎', status: 'running', port: 8013, reason: 'ok', restartable: true, onDemand: false },
    { key: 'callbackServer', name: '回调服务', status: 'running', port: 16521, reason: 'ok', restartable: false, onDemand: false },
    { key: 'mediaServer', name: '媒体服务', status: 'running', port: 0, reason: 'ok', restartable: true, onDemand: false },
    { key: 'alignerEngine', name: '对齐引擎', status: 'standby', port: 8004, reason: 'on_demand', restartable: false, onDemand: true },
  ],
  loaded: true,
  unavailable: false,
  runningCount: 5,
  stoppedCount: 0,
  allRunning: true,
  hasDegradation: false,
  lastSeenRunning: {},
  restarting: {},
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  refresh: vi.fn(async () => true),
  restart: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/stores/serviceStatus', () => ({
  useServiceStatusStore: () => serviceStatusState,
}))

import YixiaoerSidebar from './YixiaoerSidebar.vue'

let wrapper

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  push.mockReset()
})

function mountSidebar (path = '/accounts') {
  i18n.global.locale.value = 'zh'
  routeState.path = path
  wrapper = mount(YixiaoerSidebar, {
    global: {
      plugins: [i18n],
      stubs: {
        ProfileMenu: { template: '<div data-testid="profile-menu-stub" />' },
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

describe('YixiaoerSidebar', () => {
  it('renders the account route active with real identity status and service summary', () => {
    const sidebar = mountSidebar('/accounts')

    expect(sidebar.find('[data-testid="profile-menu-stub"]').exists()).toBe(true)
    const status = sidebar.get('[data-testid="yixiaoer-sidebar-status"]')
    expect(status.text()).toBe('已连接')
    expect(status.classes()).toContain('is-online')
    const serviceStatus = sidebar.get('[data-testid="yixiaoer-service-status"]')
    expect(serviceStatus.text()).toBe('服务运行中')
    expect(serviceStatus.classes()).toContain('is-ok')
    expect(sidebar.text()).toContain('主页')
    expect(sidebar.text()).toContain('发布')
    expect(sidebar.text()).toContain('账号')
    expect(sidebar.text()).toContain('数据')
    expect(sidebar.text()).toContain('视频创作')
    expect(sidebar.text()).toContain('采集')
    expect(sidebar.text()).toContain('设置')
    expect(sidebar.get('[data-testid="yixiaoer-primary-accounts"]').classes()).toContain('active')
  })

  it('shows per-service status list with names and states', () => {
    const sidebar = mountSidebar('/accounts')

    const list = sidebar.get('[data-testid="yixiaoer-service-list"]')
    const items = list.findAll('.yixiaoer-service-item')
    expect(items).toHaveLength(6)
    expect(items[0].text()).toContain('主服务')
    expect(items[0].text()).toContain('运行中')
    expect(items[1].text()).toContain('分句引擎')
    expect(items[2].text()).toContain('提示词优化引擎')
    const aligner = sidebar.get('[data-testid="yixiaoer-service-alignerEngine"]')
    expect(aligner.text()).toContain('按需')
  })

  it('shows degraded summary and offline identity when services fail', () => {
    mockIdentityState.status = 'signed_out'
    const previous = serviceStatusState.services
    const previousRunning = serviceStatusState.runningCount
    const previousStopped = serviceStatusState.stoppedCount
    const previousAll = serviceStatusState.allRunning
    serviceStatusState.services = previous.map((s) => s.key === 'promptEngine' ? { ...s, status: 'stopped' } : s)
    serviceStatusState.runningCount = 4
    serviceStatusState.stoppedCount = 1
    serviceStatusState.allRunning = false

    try {
      const sidebar = mountSidebar('/accounts')

      const status = sidebar.get('[data-testid="yixiaoer-sidebar-status"]')
      expect(status.classes()).toContain('is-offline')
      const serviceStatus = sidebar.get('[data-testid="yixiaoer-service-status"]')
      expect(serviceStatus.classes()).toContain('is-degraded')
      const prompt = sidebar.get('[data-testid="yixiaoer-service-promptEngine"]')
      expect(prompt.text()).toContain('已停止')
    } finally {
      mockIdentityState.status = 'authenticated'
      serviceStatusState.services = previous
      serviceStatusState.runningCount = previousRunning
      serviceStatusState.stoppedCount = previousStopped
      serviceStatusState.allRunning = previousAll
    }
  })

  it('opens the more menu and exposes secondary navigation', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[data-testid="yixiaoer-primary-more"]').trigger('click')

    expect(sidebar.get('[role="menu"]').text()).toContain('监控')
    expect(sidebar.get('[role="menu"]').text()).toContain('发布日历')
    expect(sidebar.get('[role="menu"]').text()).toContain('私信评论')
    expect(sidebar.get('[role="menu"]').text()).toContain('CLI')
    expect(sidebar.get('[role="menu"]').text()).toContain('素材库')
    expect(sidebar.get('[data-testid="yixiaoer-primary-more"]').attributes('aria-expanded')).toBe('true')
  })

  it('exposes all migrated-cohere routes so navigation stays reachable after shell unification', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[data-testid="yixiaoer-primary-more"]').trigger('click')

    const menuText = sidebar.get('[role="menu"]').text()
    expect(menuText).toContain('关键词监控')
    expect(menuText).toContain('爆款分析')
    expect(menuText).toContain('提示词评估')
    expect(menuText).toContain('模型提供商')
    expect(menuText).toContain('会员中心')
  })

  it('settings button emits open-settings event', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[aria-label="设置"]').trigger('click')

    expect(sidebar.emitted('open-settings')).toBeTruthy()
  })

  it('routes the add button to the publish editor', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[data-testid="yixiaoer-sidebar"]').find('button[aria-label="新建发布"]').trigger('click')

    expect(push).toHaveBeenCalledWith('/publish')
  })
})

