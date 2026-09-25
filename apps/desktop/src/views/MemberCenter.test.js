import { describe, it, expect, vi } from 'vitest'
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
  window.electronAPI = {
    getVersion: vi.fn().mockResolvedValue({ code: 0, data: '0.1.0' }),
  }
  const Component = (await import('./MemberCenter.vue')).default
  return mount(Component, {
    global: {
      plugins: [pinia],
      stubs: { UpgradeModal: UpgradeModalStub },
    },
  })
}

describe('MemberCenter', () => {
  let identityStore

  afterEach(() => {
    delete window.electronAPI
  })

  it('未登录显示空态与登录按钮，点击触发登录', async () => {
    const wrapper = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'signed_out'
    identityStore.user = null
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-empty"]').exists()).toBe(true)
    await wrapper.get('[data-testid="member-center-login"]').trigger('click')
    expect(identityStore.signIn).toHaveBeenCalledTimes(1)
  })

  it('已登录展示账号信息、版本会员卡、权益与配额', async () => {
    const wrapper = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' }
    identityStore.entitlement = {
      plan: 'pro',
      features: ['cloud_publish', 'publish_schedule'],
      source: 'online',
      expiresAt: 1893456000,
      quota: { credits: 100, used: 20 },
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('用户甲')
    expect(wrapper.text()).toContain('memberCenter.statusConnected')
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.planPro')
    expect(wrapper.get('[data-testid="member-center-entitlement-plan"]').text()).toContain('memberCenter.planPro')
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="member-center-pro-active"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="member-center-features"]').findAll('li')).toHaveLength(2)
    expect(wrapper.get('[data-testid="member-center-quota"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="member-center-version"]').text()).toBe('0.1.0')
  })

  it('已登录 trial entitlement：版本卡与权益卡一致显示 trial，升级入口保留', async () => {
    const wrapper = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    identityStore.entitlement = { plan: 'trial', features: [], source: 'online', expiresAt: 1893456000, quota: null }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.planTrial')
    expect(wrapper.get('[data-testid="member-center-entitlement-plan"]').text()).toContain('memberCenter.planTrial')
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(true)
  })

  it('已登录但 entitlement 缺失时版本卡回退本地 licenseStore', async () => {
    const wrapper = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.licenseFree')
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(true)
  })

  it('无 entitlement 时不渲染权益卡与配额卡', async () => {
    const wrapper = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'authenticated'
    identityStore.user = { sub: 'sub-1', name: '用户甲', username: '', picture: '' }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-entitlement"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="member-center-quota"]').exists()).toBe(false)
  })

  it('disabled 状态显示身份服务未启用，不显示登录按钮', async () => {
    const wrapper = await mountMemberCenter()
    identityStore = (await import('@/stores/identity')).useIdentityStore()
    identityStore.status = 'disabled'
    identityStore.user = null
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('memberCenter.identityDisabled')
    expect(wrapper.find('[data-testid="member-center-login"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="member-center-account"]').text()).toContain('memberCenter.identityDisabledHint')
  })

  it('点击升级按钮打开 UpgradeModal', async () => {
    const wrapper = await mountMemberCenter()
    const { useLicenseStore } = await import('@/stores/license')
    useLicenseStore().info = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 0 }
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="member-center-upgrade"]').trigger('click')
    expect(wrapper.find('[data-testid="upgrade-modal-stub"]').exists()).toBe(true)
  })

  it('Pro 用户显示已激活标记且不显示升级按钮', async () => {
    const wrapper = await mountMemberCenter()
    const { useLicenseStore } = await import('@/stores/license')
    useLicenseStore().info = { type: 'pro', isPro: true, isTrial: false, features: [], daysRemaining: 0 }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="member-center-pro-active"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="member-center-upgrade"]').exists()).toBe(false)
  })
})