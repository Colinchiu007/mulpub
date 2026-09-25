import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({ t: (key) => key }),
}))

const UpgradeModalStub = {
  name: 'UpgradeModal',
  props: { },
  emits: ['close'],
  template: '<div data-testid="upgrade-modal-stub"><slot /></div>',
}

const MemberViewsStub = new Proxy({}, {
  get: (_target, prop) => ({
    name: String(prop),
    template: `<div data-testid="member-view-stub-${String(prop)}"></div>`,
  }),
})
vi.mock('./member-center/views', () => ({ MEMBER_VIEWS: MemberViewsStub }))

async function mountMemberCenter() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useIdentityStore } = await import('@/stores/identity')
  const identityStore = useIdentityStore()
  identityStore.load = vi.fn()
  identityStore.signIn = vi.fn(async () => true)
  identityStore.switchAccount = vi.fn(async () => true)
  identityStore.signOut = vi.fn(async () => true)
  const { useLicenseStore } = await import('@/stores/license')
  const licenseStore = useLicenseStore()
  licenseStore.info = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 7 }
  licenseStore.load = vi.fn()
  const { useMemberStore } = await import('@/stores/member')
  const memberStore = useMemberStore()
  memberStore.loadNotifications = vi.fn(async () => {})
  memberStore.loadSessions = vi.fn(async () => {})
  window.electronAPI = {
    getVersion: vi.fn().mockResolvedValue({ code: 0, data: '0.1.0' }),
  }
  const Component = (await import('./MemberCenter.vue')).default
  return {
    pinia,
    memberStore,
    wrapper: mount(Component, {
      global: {
        plugins: [pinia],
        stubs: { UpgradeModal: UpgradeModalStub },
      },
    }),
  }
}

function setAuthenticatedIdentity(identityStore) {
  identityStore.status = 'authenticated'
  identityStore.user = { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' }
  identityStore.entitlement = {
    plan: 'pro',
    features: ['cloud_publish', 'publish_schedule'],
    source: 'online',
    expiresAt: 1893456000,
    quota: { credits: 100, used: 20 },
  }
}

describe('MemberCenter', () => {
  let identityStore

  afterEach(() => {
    delete window.electronAPI
  })

  it('未登录显示空态与登录按钮，不渲染侧栏', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'signed_out'
    identityStore.user = null
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="member-center-nav"]').exists()).toBe(false)
    await wrapper.get('[data-testid="member-center-login"]').trigger('click')
    expect(identityStore.signIn).toHaveBeenCalledTimes(1)
  })

  it('登录后渲染七栏侧栏，默认停在概览', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    const items = wrapper.get('[data-testid="member-center-nav"]').findAll('[data-testid^="member-center-nav-"]')
    expect(items).toHaveLength(7)
    expect(wrapper.find('[data-testid="member-view-stub-Overview"]').exists()).toBe(true)
  })

  it('点击侧栏切换子视图', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="member-center-nav-account"]').trigger('click')
    expect(wrapper.find('[data-testid="member-view-stub-Overview"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="member-view-stub-AccountSecurity"]').exists()).toBe(true)
  })

  it('消息栏激活时加载并渲染通知列表', async () => {
    const { wrapper, memberStore } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore)
    memberStore.notifications = [{ id: 7, title: '会员开通', body: '专业版已开通', level: 'info', read: false }]
    memberStore.unreadCount = 1
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="member-center-nav-messages"]').trigger('click')
    expect(memberStore.loadNotifications).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="member-center-messages"]').exists()).toBe(true)
  })

  it('disabled 状态显示身份服务未启用，不显示登录按钮', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'disabled'
    identityStore.user = null
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('memberCenter.identityDisabled')
    expect(wrapper.find('[data-testid="member-center-login"]').exists()).toBe(false)
  })

  it('概览保留升级入口并可打开 UpgradeModal', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    identityStore.entitlement = null
    const { useLicenseStore } = await import('@/stores/license')
    useLicenseStore().info = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 0 }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="member-center-upgrade"]').trigger('click')
    expect(wrapper.find('[data-testid="upgrade-modal-stub"]').exists()).toBe(true)
  })

  // A2 单一真源回归：登录且有服务端权益快照时，升级 CTA 以 entitlement.plan 为准，不再读本地 licenseStore
  it('pro entitlement 隐藏升级入口（即使本地 licenseStore 为 free）', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    setAuthenticatedIdentity(identityStore) // entitlement.plan = 'pro'，本地 licenseStore 仍为 free
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(false)
  })

  it('trial entitlement 保留升级入口', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    identityStore.entitlement = { plan: 'trial', features: [], source: 'online', expiresAt: 1893456000, quota: null }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(true)
  })

  it('entitlement 缺失时升级入口回退本地 licenseStore（pro 用户不显示）', async () => {
    const { wrapper } = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    identityStore.entitlement = null
    const { useLicenseStore } = await import('@/stores/license')
    useLicenseStore().info = { type: 'pro', isPro: true, isTrial: false, features: [], daysRemaining: 0 }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(false)
  })
})
