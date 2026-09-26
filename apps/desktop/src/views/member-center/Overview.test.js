import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({ t: (key) => key }),
}))

// A2 单一真源回归（概览版本卡）：登录且服务端权益快照存在时，
// 版本卡与权益卡同源展示 entitlement.plan，不再读本地 licenseStore；缺失时回退。
const identityCtx = {
  status: 'authenticated',
  user: { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' },
  displayName: '用户甲',
}
vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({
    status: ref(identityCtx.status),
    user: ref(identityCtx.user),
    displayName: ref(identityCtx.displayName),
    loading: ref(false),
    error: ref(null),
  }),
}))

async function mountOverview(entitlement, licenseInfo) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useIdentityStore } = await import('@/stores/identity')
  const identityStore = useIdentityStore()
  identityStore.status = identityCtx.status
  identityStore.user = identityCtx.user
  identityStore.entitlement = entitlement
  const { useLicenseStore } = await import('@/stores/license')
  const licenseStore = useLicenseStore()
  licenseStore.info = licenseInfo
  licenseStore.load = vi.fn()
  const Overview = (await import('./Overview.vue')).default
  return mount(Overview, { global: { plugins: [pinia] } })
}

const FREE = { type: 'free', isPro: false, isTrial: false, features: [], daysRemaining: 0 }

describe('member-center/Overview', () => {
  afterEach(() => {
    delete window.electronAPI
  })

  it('pro entitlement：版本卡与权益卡同源显示 planPro，pro 徽标点亮', async () => {
    const wrapper = await mountOverview(
      { plan: 'pro', features: [], source: 'online', expiresAt: 1893456000, quota: null },
      FREE,
    )
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.planPro')
    expect(wrapper.get('[data-testid="member-center-entitlement-plan"]').text()).toContain('memberCenter.planPro')
    expect(wrapper.find('[data-testid="member-center-pro-active"]').exists()).toBe(true)
  })

  it('trial entitlement：版本卡同源显示 planTrial，无 pro 徽标', async () => {
    const wrapper = await mountOverview(
      { plan: 'trial', features: [], source: 'online', expiresAt: 1893456000, quota: null },
      FREE,
    )
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.planTrial')
    expect(wrapper.find('[data-testid="member-center-pro-active"]').exists()).toBe(false)
  })

  it('entitlement 缺失时版本卡回退本地 licenseStore', async () => {
    const wrapper = await mountOverview(null, FREE)
    expect(wrapper.get('[data-testid="member-center-plan"]').text()).toContain('memberCenter.licenseFree')
    expect(wrapper.find('[data-testid="member-center-pro-active"]').exists()).toBe(false)
  })
})
