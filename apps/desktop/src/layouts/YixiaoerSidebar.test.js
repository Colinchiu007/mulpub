import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import { resetAutoUpdateState, useAutoUpdate } from '@/composables/useAutoUpdate'

const routeState = vi.hoisted(() => ({ path: '/accounts' }))
const push = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push }),
}))

vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => ({
    status: 'authenticated',
    user: { name: '测试用户', username: 'testuser' },
    displayName: '测试用户',
    entitlement: null,
    signIn: vi.fn(),
    switchAccount: vi.fn(),
    signOut: vi.fn(),
  }),
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
    { key: 'mainBackend', name: '主服务', status: 'running', port: 8299 },
    { key: 'splitterEngine', name: '分句引擎', status: 'running', port: 8002 },
    { key: 'promptEngine', name: '提示词优化引擎', status: 'running', port: 8013 },
    { key: 'callbackServer', name: '回调服务', status: 'running', port: 16521 },
    { key: 'mediaServer', name: '媒体服务', status: 'running', port: 0 },
    { key: 'alignerEngine', name: '对齐引擎', status: 'standby', port: 8004 },
  ],
  loaded: true,
  unavailable: false,
  runningCount: 5,
  allRunning: true,
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  refresh: vi.fn(async () => true),
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
  // 更新状态为模块级共享单例，用例间必须复位，否则「新版本」入口会泄漏到后续用例
  resetAutoUpdateState()
})

function mountSidebar (path = '/accounts') {
  i18n.global.locale.value = 'zh'
  routeState.path = path
  wrapper = mount(YixiaoerSidebar, {
    global: {
      plugins: [i18n],
      stubs: {
        // 登录区已从顶部移到 footer：桩件向上抛事件，用于验证宿主转发
        ProfileMenu: {
          emits: ['open-settings', 'upgrade'],
          template: `
            <div data-testid="profile-menu-stub" @click="$emit('open-settings')">
              <button type="button" data-testid="profile-menu-stub-upgrade" @click="$emit('upgrade')">upgrade</button>
            </div>
          `,
        },
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

describe('YixiaoerSidebar', () => {
  it('renders the account route active with the login banner at the bottom and service info above it', () => {
    const sidebar = mountSidebar('/accounts')

    // 登录区不再出现在顶部 header
    const header = sidebar.get('.yixiaoer-sidebar-header')
    expect(header.find('[data-testid="profile-menu-stub"]').exists()).toBe(false)

    // 登录区落在 footer，且位于服务连接信息下方
    const footer = sidebar.get('.yixiaoer-sidebar-footer')
    expect(footer.get('[data-testid="profile-menu-stub"]').exists()).toBe(true)

    const footerBlocks = Array.from(footer.element.children)
    // footer 内的 DOM 顺序即「服务连接信息在上、登录 banner 在下」
    expect(footerBlocks[0].querySelector('[data-testid="yixiaoer-service-status"]')).toBeTruthy()
    expect(footerBlocks[1].getAttribute('data-testid')).toBe('profile-menu-stub')

    const serviceStatus = sidebar.get('[data-testid="yixiaoer-service-status"]')
    expect(serviceStatus.text()).toBe('服务运行中')
    expect(serviceStatus.classes()).toContain('is-ok')

    expect(sidebar.text()).toContain('主页')
    expect(sidebar.text()).toContain('发布')
    expect(sidebar.text()).toContain('账号')
    expect(sidebar.text()).toContain('数据')
    expect(sidebar.text()).toContain('视频创作')
    expect(sidebar.text()).toContain('采集')
    expect(sidebar.get('[data-testid="yixiaoer-primary-accounts"]').classes()).toContain('active')
  })

  it('shows the new-version entry above the bottom login banner only when an update is available', async () => {
    const sidebar = mountSidebar('/accounts')

    // 无可用更新时不渲染（footer 顺序契约保持不变：服务信息 → 登录 banner）
    expect(sidebar.find('[data-testid="yixiaoer-update"]').exists()).toBe(false)
    expect(Array.from(sidebar.get('.yixiaoer-sidebar-footer').element.children)[1].getAttribute('data-testid'))
      .toBe('profile-menu-stub')

    useAutoUpdate().handleUpdateStatus({ type: 'available', data: { version: '2.4.0' } })
    await nextTick()

    // 有新版本时插入到「服务连接信息」与「登录 banner」之间，即底部菜单按钮上方
    const footerBlocks = Array.from(sidebar.get('.yixiaoer-sidebar-footer').element.children)
    expect(footerBlocks[0].querySelector('[data-testid="yixiaoer-service-status"]')).toBeTruthy()
    expect(footerBlocks[1].getAttribute('data-testid')).toBe('yixiaoer-update')
    expect(footerBlocks[2].getAttribute('data-testid')).toBe('profile-menu-stub')
    expect(sidebar.get('[data-testid="yixiaoer-update"]').text()).toContain('新版本')
  })

  it('moves the settings entry out of the primary navigation into the bottom login menu', () => {
    const sidebar = mountSidebar('/accounts')

    expect(sidebar.find('[data-testid="yixiaoer-primary-settings"]').exists()).toBe(false)
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
    expect(aligner.text()).toContain('待命')
  })

  it('shows degraded summary when services fail', () => {
    const previous = serviceStatusState.services
    const previousRunning = serviceStatusState.runningCount
    const previousAll = serviceStatusState.allRunning
    serviceStatusState.services = previous.map((s) => s.key === 'promptEngine' ? { ...s, status: 'stopped' } : s)
    serviceStatusState.runningCount = 4
    serviceStatusState.allRunning = false

    try {
      const sidebar = mountSidebar('/accounts')

      const serviceStatus = sidebar.get('[data-testid="yixiaoer-service-status"]')
      expect(serviceStatus.classes()).toContain('is-degraded')
      const prompt = sidebar.get('[data-testid="yixiaoer-service-promptEngine"]')
      expect(prompt.text()).toContain('已停止')
    } finally {
      serviceStatusState.services = previous
      serviceStatusState.runningCount = previousRunning
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

  it('forwards the settings entry coming from the bottom login menu', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[data-testid="profile-menu-stub"]').trigger('click')

    expect(sidebar.emitted('open-settings')).toBeTruthy()
  })

  it('opens the upgrade modal when the bottom login menu requests an upgrade', async () => {
    const sidebar = mountSidebar('/accounts')

    expect(sidebar.find('[data-testid="upgrade-modal-stub"]').exists()).toBe(false)

    await sidebar.get('[data-testid="profile-menu-stub-upgrade"]').trigger('click')

    expect(sidebar.find('[data-testid="upgrade-modal-stub"]').exists()).toBe(true)
  })

  it('routes the add button to the publish editor', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[data-testid="yixiaoer-sidebar"]').find('button[aria-label="新建发布"]').trigger('click')

    expect(push).toHaveBeenCalledWith('/publish')
  })
})
