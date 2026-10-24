import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'zh' } } }),
  useI18n: () => ({ t: (key) => key }),
}))

// WeChatPayDialog 是 defineAsyncComponent——挂载时会真去 import 组件链。
// 测试里替换为轻量 stub（与 MemberCenter.test.js 的 UpgradeModalStub 同模式）。
const WeChatPayDialogStub = {
  name: 'WeChatPayDialog',
  props: ['open', 'plan', 'period', 'reuseOrderId'],
  emits: ['close', 'paid'],
  template: '<div data-testid="wechat-pay-dialog-stub" />',
}

const identityCtx = {
  status: 'authenticated',
  user: { sub: 'sub-1', name: '用户甲', username: 'user-a', picture: '' },
  isAuthenticated: true,
  entitlement: null,
  plans: null,
}
vi.mock('@/composables/useIdentity', () => ({
  useIdentity: () => ({
    status: ref(identityCtx.status),
    user: ref(identityCtx.user),
    displayName: ref('用户甲'),
    loading: ref(false),
    error: ref(null),
  }),
}))

const memberCtx = {
  redeemCode: vi.fn(async () => ({ idempotent: false, plan: 'pro', periodEnd: '2026-11-24T00:00:00Z' })),
  error: null,
}
vi.mock('@/stores/member', () => ({
  useMemberStore: () => memberCtx,
}))

async function mountSubscription() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const { useIdentityStore } = await import('@/stores/identity')
  const identityStore = useIdentityStore()
  identityStore.status = identityCtx.status
  identityStore.user = identityCtx.user
  identityStore.entitlement = identityCtx.entitlement
  identityStore.plans = identityCtx.plans
  const Subscription = (await import('./Subscription.vue')).default
  return {
    pinia,
    identityStore,
    wrapper: mount(Subscription, {
      global: {
        plugins: [pinia],
        stubs: { WeChatPayDialog: WeChatPayDialogStub },
      },
    }),
  }
}

describe('member-center/Subscription', () => {
  beforeEach(() => {
    identityCtx.entitlement = null
    identityCtx.plans = null
    memberCtx.error = null
  })

  // ── 价目三态（从壳层迁入后的落点）────────────────────────────────
  describe('价目三态', () => {
    it('plans === null → 「暂不可用」，不渲染卡片列表', async () => {
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="plans-unavailable"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="plan-free"]').exists()).toBe(false)
    })

    it('plans === [] → 「暂无套餐」', async () => {
      identityCtx.plans = []
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="plans-empty"]').exists()).toBe(true)
    })

    it('有数据 → 每档渲染卡片 + 价格', async () => {
      identityCtx.plans = [
        { id: 'free', label: '免费版', currency: 'CNY', priceMonthlyCents: 0, priceYearlyCents: 0 },
        { id: 'standard', label: '标准版', currency: 'CNY', priceMonthlyCents: 5900, priceYearlyCents: 49900 },
        { id: 'pro', label: '专业版', currency: 'CNY', priceMonthlyCents: 11900, priceYearlyCents: 99900 },
      ]
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="plan-standard"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="plan-standard-price"]').text()).toContain('¥59')
      expect(wrapper.get('[data-testid="plan-pro-price"]').text()).toContain('¥119')
    })
  })

  // ── 可购买化（v4 E6：单一入口）───────────────────────────────────
  describe('价目卡可购买', () => {
    beforeEach(() => {
      identityCtx.plans = [
        { id: 'free', label: '免费版', currency: 'CNY', priceMonthlyCents: 0, priceYearlyCents: 0 },
        { id: 'standard', label: '标准版', currency: 'CNY', priceMonthlyCents: 5900, priceYearlyCents: 49900 },
        { id: 'pro', label: '专业版', currency: 'CNY', priceMonthlyCents: 11900, priceYearlyCents: 99900 },
      ]
      identityCtx.entitlement = { plan: 'free', features: [], source: 'online', limits: { plan_rank: 0 } }
    })

    it('点击标准版卡片 → 打开支付弹窗且携带 plan/period', async () => {
      const { wrapper } = await mountSubscription()
      await wrapper.get('[data-testid="plan-standard"]').trigger('click')
      const dialog = wrapper.findComponent({ name: 'WeChatPayDialog' })
      expect(dialog.props('open')).toBe(true)
      expect(dialog.props('plan')).toBe('standard')
      expect(dialog.props('period')).toBe('month')
    })

    it('当前档（free）卡片不渲染购买入口', async () => {
      const { wrapper } = await mountSubscription()
      const freeCard = wrapper.get('[data-testid="plan-free"]')
      expect(freeCard.text()).toContain('memberCenter.planBuyCurrent')
    })

    it('更高档（pro）卡片渲染购买按钮', async () => {
      const { wrapper } = await mountSubscription()
      const proCard = wrapper.get('[data-testid="plan-pro"]')
      expect(proCard.text()).toContain('memberCenter.planBuyCta')
    })

    it('购买区与卡片是同一路径：不存在独立的 purchase-*-* 按钮组', async () => {
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="purchase-standard-month"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="member-center-purchase"]').exists()).toBe(false)
    })
  })

  // ── feature 本地化（P0-4）────────────────────────────────────────
  describe('feature 本地化', () => {
    it('已知 feature → 本地化键', async () => {
      identityCtx.entitlement = {
        plan: 'pro', features: ['cloud_publish', 'ai_write'], source: 'online', limits: { plan_rank: 2 },
      }
      const { wrapper } = await mountSubscription()
      const text = wrapper.get('[data-testid="member-center-features"]').text()
      expect(text).toContain('memberCenter.feature.cloud_publish')
      expect(text).not.toContain('cloud_publish\n') // 不再裸渲染原文
    })

    it('未知 feature → 回退原文', async () => {
      identityCtx.entitlement = {
        plan: 'pro', features: ['future_feature'], source: 'online', limits: { plan_rank: 2 },
      }
      const { wrapper } = await mountSubscription()
      expect(wrapper.get('[data-testid="member-center-features"]').text()).toContain('future_feature')
    })
  })

  // ── 宽限期（v4 新增）─────────────────────────────────────────────
  describe('宽限期展示', () => {
    it('graceUntil 存在 → 宽限徽标 + 当前档（降级后）+ 宽限提示', async () => {
      identityCtx.entitlement = {
        plan: 'free', features: [], source: 'online', limits: { plan_rank: 0 },
        graceUntil: '2026-11-01T00:00:00Z', previousPlan: 'pro',
      }
      const { wrapper } = await mountSubscription()
      const text = wrapper.get('[data-testid="member-center-subscription-detail"]').text()
      expect(text).toContain('memberCenter.graceTitle')
      // 档位名走当前 plan（free）——宽限期里用户就是免费档；
      // previousPlan 经 graceHint 插值进入提示文案（见 labels.graceState 单测）。
      expect(text).toContain('memberCenter.planFree')
      expect(text).toContain('memberCenter.graceHint')
    })

    it('graceUntil 缺失 → 正常到期展示，无宽限徽标', async () => {
      identityCtx.entitlement = {
        plan: 'pro', features: [], source: 'online', expiresAt: 1893456000, limits: { plan_rank: 2 },
      }
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="member-center-grace"]').exists()).toBe(false)
    })

    it('graceUntil 非法 ISO → 不渲染宽限徽标（不崩）', async () => {
      identityCtx.entitlement = {
        plan: 'free', features: [], source: 'online', limits: { plan_rank: 0 }, graceUntil: 'not-a-date',
      }
      const { wrapper } = await mountSubscription()
      expect(wrapper.find('[data-testid="member-center-grace"]').exists()).toBe(false)
    })
  })

  // ── 兑换本地前置校验（P1-8 / MISS-9）─────────────────────────────
  describe('兑换前置校验', () => {
    it('合法码 → 调用 store.redeemCode', async () => {
      const { wrapper } = await mountSubscription()
      const input = wrapper.get('[data-testid="redeem-code-input"]')
      await input.setValue('ABCD-EFGH-JKMN')
      await wrapper.get('[data-testid="redeem-code-submit"]').trigger('click')
      expect(memberCtx.redeemCode).toHaveBeenCalledWith('ABCD-EFGH-JKMN')
    })

    it('含禁用字符（I/O/0/1）→ 本地拦截，不发请求', async () => {
      memberCtx.redeemCode.mockClear()
      const { wrapper } = await mountSubscription()
      await wrapper.get('[data-testid="redeem-code-input"]').setValue('ABCD-EFGH-IKMN')
      await wrapper.get('[data-testid="redeem-code-submit"]').trigger('click')
      expect(memberCtx.redeemCode).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="redeem-result-error"]').exists()).toBe(true)
    })

    it('长度不足 → 本地拦截', async () => {
      memberCtx.redeemCode.mockClear()
      const { wrapper } = await mountSubscription()
      await wrapper.get('[data-testid="redeem-code-input"]').setValue('ABC-EFG')
      await wrapper.get('[data-testid="redeem-code-submit"]').trigger('click')
      expect(memberCtx.redeemCode).not.toHaveBeenCalled()
    })

    it('输入自动转大写（服务端语义对齐）', async () => {
      const { wrapper } = await mountSubscription()
      const input = wrapper.get('[data-testid="redeem-code-input"]')
      await input.setValue('abcd-efgh-jkmn')
      expect(input.element.value).toBe('ABCD-EFGH-JKMN')
    })
  })
})
