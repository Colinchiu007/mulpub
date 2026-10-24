import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive, ref } from 'vue'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({ t: (key) => key }),
}))

const identityCtx = {
  status: 'authenticated',
  user: { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' },
  displayName: '用户甲',
  loading: false,
  switchAccount: vi.fn(async () => true),
  signOut: vi.fn(async () => true),
}
vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({
    status: ref(identityCtx.status),
    user: ref(identityCtx.user),
    displayName: ref(identityCtx.displayName),
    loading: ref(identityCtx.loading),
    error: ref(null),
    switchAccount: identityCtx.switchAccount,
    signOut: identityCtx.signOut,
  }),
}))

// reactive：组件 computed 依赖 store.error / sessions，测试里回调内改值
// 必须能触发重算（普通对象不会）。
const memberCtx = reactive({
  sessions: [{ id: 1, deviceId: 'dev-1', deviceName: 'PC-A', lastSeenAt: '2026-10-24T00:00:00Z' }],
  loading: false,
  error: null,
  revokeOtherSessions: vi.fn(async () => 1),
})
vi.mock('@/stores/member', () => ({
  useMemberStore: () => memberCtx,
}))

async function mountAccountSecurity() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const AccountSecurity = (await import('./AccountSecurity.vue')).default
  return mount(AccountSecurity, { global: { plugins: [pinia] } })
}

describe('member-center/AccountSecurity', () => {
  beforeEach(() => {
    memberCtx.error = null
    memberCtx.revokeOtherSessions = vi.fn(async () => 1)
  })

  describe('错误展示（P0-5：修复前静默）', () => {
    it('revoke 失败（store error）→ 本地化错误提示，不渲染裸码', async () => {
      // 真实链路：safeInvoke 捕获抛错 → error 落 MEMBER_REQUEST_FAILED；
      // mock 层直接置 store.error 模拟该终态（渲染层只认 error 字段）。
      memberCtx.revokeOtherSessions = vi.fn(async () => { memberCtx.error = 'MEMBER_REQUEST_FAILED'; return false })
      const wrapper = await mountAccountSecurity()
      await wrapper.get('[data-testid="member-center-revoke-others"]').trigger('click')
      await wrapper.vm.$nextTick()
      const alert = wrapper.find('[role="alert"]')
      expect(alert.exists()).toBe(true)
      expect(alert.text()).toBe('memberCenter.memberRequestFailed')
      memberCtx.error = null
    })

    it('权限错误 → 权限文案', async () => {
      memberCtx.revokeOtherSessions = vi.fn(async () => false)
      memberCtx.error = 'MEMBER_PERMISSION_REQUIRED'
      const wrapper = await mountAccountSecurity()
      expect(wrapper.find('[role="alert"]').text()).toBe('memberCenter.memberPermissionRequired')
    })

    it('无 error → 不渲染错误区', async () => {
      memberCtx.error = null
      const wrapper = await mountAccountSecurity()
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    })
  })

  describe('revoked 数量语义', () => {
    it('revoked > 0 → 成功提示（插值 key）', async () => {
      memberCtx.revokeOtherSessions = vi.fn(async () => 2)
      const wrapper = await mountAccountSecurity()
      await wrapper.get('[data-testid="member-center-revoke-others"]').trigger('click')
      await wrapper.vm.$nextTick()
      const result = wrapper.find('[data-testid="revoke-result"]')
      expect(result.text()).toBe('memberCenter.revokeSuccess')
      expect(result.classes()).toContain('is-success')
    })

    it('revoked === 0 → info 提示「没有其他设备」', async () => {
      memberCtx.revokeOtherSessions = vi.fn(async () => 0)
      const wrapper = await mountAccountSecurity()
      await wrapper.get('[data-testid="member-center-revoke-others"]').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="revoke-result"]').exists()).toBe(true)
    })
  })

  it('会话列表正常渲染', async () => {
    const wrapper = await mountAccountSecurity()
    expect(wrapper.text()).toContain('PC-A')
  })
})
