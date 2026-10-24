import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import { resetAutoUpdateState, useAutoUpdate } from '@/composables/useAutoUpdate'

const routeState = vi.hoisted(() => ({ path: '/accounts' }))
const push = vi.hoisted(() => vi.fn())
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/electron-bridge', () => ({
  invoke: invokeMock,
  invokePageManager: vi.fn(),
  getApi: () => null,
  // M-9 收敛后 ops-center-sync 的 onOpsCenterRuntimeUpdated 走 bridge.on()
  on: vi.fn(() => () => {}),
}))

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

// 组件（方案 B）新增 useTabStore 依赖：本测试不装 pinia，按既有 store mock 风格提供聚焦态
// 2026-10-23：改为可变的模块级状态对象，供「升级 Pro 入口」可见性回归用例切换到
// 「外部网页标签活动」现场（外部网页由原生 WebContentsView 承载，页面须先切回首页标签才可见）。
const tabState = vi.hoisted(() => ({
  activeTabIsHomeShell: false,
  isHomeTab: true,
  activeTab: { tabId: 'home', spaRoute: '', isHome: true },
  tabs: [{ tabId: 'home', isHome: true }],
  activeTabId: 'home',
  switchToTab: vi.fn(),
}))
vi.mock('@/stores/tab', () => ({
  useTabStore: () => tabState,
}))

import MpSidebar from './MpSidebar.vue'

let wrapper

beforeEach(() => {
  // 默认：主进程返回成功的版本响应；个别用例可覆盖为失败码/不可用/异常
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ code: 0, data: '2.3.53' })
  // 标签态复位为「首页虚拟标签活动」
  tabState.activeTabIsHomeShell = false
  tabState.isHomeTab = true
  tabState.activeTab = { tabId: 'home', spaRoute: '', isHome: true }
  tabState.tabs = [{ tabId: 'home', isHome: true }]
  tabState.activeTabId = 'home'
  tabState.switchToTab.mockReset()
  tabState.switchToTab.mockResolvedValue(undefined)
})

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
  wrapper = mount(MpSidebar, {
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

describe('MpSidebar', () => {
  it('renders the account route active with the login banner at the bottom and service info above it', () => {
    const sidebar = mountSidebar('/accounts')

    // 登录区不再出现在顶部 header
    const header = sidebar.get('.mp-sidebar-header')
    expect(header.find('[data-testid="profile-menu-stub"]').exists()).toBe(false)

    // 登录区落在 footer，且位于服务连接信息下方
    const footer = sidebar.get('.mp-sidebar-footer')
    expect(footer.get('[data-testid="profile-menu-stub"]').exists()).toBe(true)

    const footerBlocks = Array.from(footer.element.children)
    // footer 内的 DOM 顺序即「服务连接信息在上、登录 banner 在下」
    expect(footerBlocks[0].querySelector('[data-testid="mp-service-status"]')).toBeTruthy()
    expect(footerBlocks[1].getAttribute('data-testid')).toBe('profile-menu-stub')

    const serviceStatus = sidebar.get('[data-testid="mp-service-status"]')
    expect(serviceStatus.text()).toBe('服务运行中')
    expect(serviceStatus.classes()).toContain('is-ok')

    expect(sidebar.text()).toContain('主页')
    expect(sidebar.text()).toContain('发布')
    expect(sidebar.text()).toContain('账号')
    expect(sidebar.text()).toContain('数据')
    expect(sidebar.text()).toContain('视频创作')
    expect(sidebar.text()).toContain('采集')
    expect(sidebar.get('[data-testid="mp-primary-accounts"]').classes()).toContain('active')
  })

  it('shows the new-version entry above the bottom login banner only when an update is available', async () => {
    const sidebar = mountSidebar('/accounts')

    // 无可用更新时不渲染（footer 顺序契约保持不变：服务信息 → 登录 banner）
    expect(sidebar.find('[data-testid="mp-update"]').exists()).toBe(false)
    expect(Array.from(sidebar.get('.mp-sidebar-footer').element.children)[1].getAttribute('data-testid'))
      .toBe('profile-menu-stub')

    useAutoUpdate().handleUpdateStatus({ type: 'available', data: { version: '2.4.0' } })
    await nextTick()

    // 有新版本时插入到「服务连接信息」与「登录 banner」之间，即底部菜单按钮上方
    const footerBlocks = Array.from(sidebar.get('.mp-sidebar-footer').element.children)
    expect(footerBlocks[0].querySelector('[data-testid="mp-service-status"]')).toBeTruthy()
    expect(footerBlocks[1].getAttribute('data-testid')).toBe('mp-update')
    expect(footerBlocks[2].getAttribute('data-testid')).toBe('profile-menu-stub')
    expect(sidebar.get('[data-testid="mp-update"]').text()).toContain('新版本')
  })

  it('moves the settings entry out of the primary navigation into the bottom login menu', () => {
    const sidebar = mountSidebar('/accounts')

    expect(sidebar.find('[data-testid="mp-primary-settings"]').exists()).toBe(false)
  })

  it('shows per-service status list with names and states', () => {
    const sidebar = mountSidebar('/accounts')

    const list = sidebar.get('[data-testid="mp-service-list"]')
    const items = list.findAll('.mp-service-item')
    expect(items).toHaveLength(6)
    expect(items[0].text()).toContain('主服务')
    expect(items[0].text()).toContain('运行中')
    expect(items[1].text()).toContain('分句引擎')
    expect(items[2].text()).toContain('提示词优化引擎')
    const aligner = sidebar.get('[data-testid="mp-service-alignerEngine"]')
    expect(aligner.text()).toContain('按需')
  })

  it('shows degraded summary when services fail', () => {
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

      const serviceStatus = sidebar.get('[data-testid="mp-service-status"]')
      expect(serviceStatus.classes()).toContain('is-degraded')
      const prompt = sidebar.get('[data-testid="mp-service-promptEngine"]')
      expect(prompt.text()).toContain('已停止')
    } finally {
      serviceStatusState.services = previous
      serviceStatusState.runningCount = previousRunning
      serviceStatusState.stoppedCount = previousStopped
      serviceStatusState.allRunning = previousAll
    }
  })

  it('opens the more menu and exposes secondary navigation', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[data-testid="mp-primary-more"]').trigger('click')

    expect(sidebar.get('[role="menu"]').text()).toContain('监控')
    expect(sidebar.get('[role="menu"]').text()).toContain('发布日历')
    expect(sidebar.get('[role="menu"]').text()).toContain('私信评论')
    expect(sidebar.get('[role="menu"]').text()).toContain('CLI')
    expect(sidebar.get('[role="menu"]').text()).toContain('素材库')
    expect(sidebar.get('[data-testid="mp-primary-more"]').attributes('aria-expanded')).toBe('true')
  })

  it('exposes all migrated-cohere routes so navigation stays reachable after shell unification', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[data-testid="mp-primary-more"]').trigger('click')

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

  // fix-upgrade-payment-entry：升级入口从「打开 UpgradeModal」改为「跳会员中心」。
  //
  // 改动理由（不是口味问题）：正式包里 UpgradeModal 只有「付费通道筹备中」，
  // 点开是死胡同；会员中心有真实档位/价格与服务端兑换码核销，是当前唯一
  // 真实可用的开通渠道。原断言（弹窗出现）锁的是一个**错误的**行为，
  // 因此这里不是"放宽断言"，而是换成锁正确行为。
  it('routes the bottom login menu upgrade entry to the member center', async () => {
    push.mockClear()
    const sidebar = mountSidebar('/accounts')

    // 不再渲染升级弹窗（组件已从模板移除）
    expect(sidebar.find('[data-testid="upgrade-modal-stub"]').exists()).toBe(false)

    await sidebar.get('[data-testid="profile-menu-stub-upgrade"]').trigger('click')

    expect(push).toHaveBeenCalledWith('/member-center')
    // 跳转后仍不该出现弹窗（防止有人把模板加回来）
    expect(sidebar.find('[data-testid="upgrade-modal-stub"]').exists()).toBe(false)
  })

  // 2026-10-23 缺陷回归：升级入口与「会员中心」同根因。
  // 裸 router.push 会让会员中心页面渲染在外部网页标签的原生 WebContentsView 背后
  // （原生图层永远压在 DOM 之上，CSS z-index 无效）⇒ 用户表现为「点了没反应」。
  // 正确行为：走侧边栏唯一的可见导航范式 onNavClick —— 先切回首页标签
  // （让壳态切到 workbench、隐藏原生视图），再路由跳转。
  it('升级 Pro 入口：当前活动标签是外部网页标签时，先切回首页标签再跳转会员中心', async () => {
    push.mockClear()
    tabState.activeTabIsHomeShell = false
    tabState.isHomeTab = false
    tabState.activeTab = { tabId: 'tab-2', spaRoute: '', isHome: false }
    tabState.tabs = [{ tabId: 'home', isHome: true }, { tabId: 'tab-2', isHome: false }]
    tabState.activeTabId = 'tab-2'

    const sidebar = mountSidebar('/accounts')
    await sidebar.get('[data-testid="profile-menu-stub-upgrade"]').trigger('click')
    await flushPromises()

    expect(tabState.switchToTab).toHaveBeenCalledWith('home')
    expect(push).toHaveBeenCalledWith('/member-center')
    expect(tabState.switchToTab.mock.invocationCallOrder[0]).toBeLessThan(push.mock.invocationCallOrder[0])
  })

  it('routes the add button to the publish editor', async () => {
    const sidebar = mountSidebar('/accounts')

    await sidebar.get('[data-testid="mp-sidebar"]').find('button[aria-label="新建发布"]').trigger('click')

    expect(push).toHaveBeenCalledWith('/publish')
  })

  it('renders the fish logo and the app version in the top-left header', async () => {
    const sidebar = mountSidebar('/accounts')
    await flushPromises()

    const header = sidebar.get('.mp-sidebar-header')
    const logo = header.get('[data-testid="mp-sidebar-logo"]')
    expect(logo.element.tagName).toBe('IMG')
    expect(logo.attributes('src')).toBeTruthy()
    expect(logo.attributes('alt')).toBe('汤姆鱼')

    const version = header.get('[data-testid="mp-sidebar-version"]')
    expect(version.text()).toBe('v2.3.53')
    expect(version.attributes('title')).toBe('当前版本')

    // 旧的文字品牌标识（MP 徽标 / 文字品牌文本）已退役
    expect(header.find('.mp-sidebar-brand').exists()).toBe(false)
    expect(header.find('.mp-sidebar-title').exists()).toBe(false)
  })

  it('hides the version badge when the version IPC is unavailable', async () => {
    invokeMock.mockResolvedValue(undefined)

    const sidebar = mountSidebar('/accounts')
    await flushPromises()

    // 纯浏览器 / 视觉回归环境没有 window.electronAPI：只保留 logo，不渲染版本号
    expect(sidebar.find('[data-testid="mp-sidebar-logo"]').exists()).toBe(true)
    expect(sidebar.find('[data-testid="mp-sidebar-version"]').exists()).toBe(false)
  })

  it('does not render a stale version when the IPC reports a failure code', async () => {
    invokeMock.mockResolvedValue({ code: -1, message: 'boom' })

    const sidebar = mountSidebar('/accounts')
    await flushPromises()

    expect(sidebar.find('[data-testid="mp-sidebar-version"]').exists()).toBe(false)
  })

  it('keeps the shell rendering when the version IPC rejects', async () => {
    invokeMock.mockRejectedValue(new Error('ipc down'))

    const sidebar = mountSidebar('/accounts')
    await flushPromises()

    expect(sidebar.find('[data-testid="mp-sidebar-version"]').exists()).toBe(false)
    expect(sidebar.get('[data-testid="mp-sidebar"]').exists()).toBe(true)
  })

  // T0-2：暗色主题下结构必须与亮色完全一致（颜色由 token 承接，DOM 不随主题变化）
  it('renders the same structure under the dark theme', async () => {
    const light = mountSidebar('/accounts')
    await flushPromises()
    const lightKeys = light.findAll('.mp-primary-item').map((item) => item.attributes('data-testid'))

    light.unmount()
    document.documentElement.setAttribute('data-theme', 'dark')
    try {
      const dark = mountSidebar('/accounts')
      await flushPromises()
      const darkKeys = dark.findAll('.mp-primary-item').map((item) => item.attributes('data-testid'))

      expect(darkKeys).toEqual(lightKeys)
      expect(dark.get('[data-testid="mp-sidebar"]').classes()).toEqual(['mp-sidebar'])
    } finally {
      document.documentElement.removeAttribute('data-theme')
    }
  })
})
