import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

/**
 * OrdersBilling 契约测试（spec MODIFIED Requirement「会员中心订单页展示真实订单」）。
 *
 * 判据不只「渲染了表格」——这里锁五件事：
 *   ① 四列内容来自服务端字段（时间/套餐/金额/状态），金额是**分→元**且带周期
 *   ② `pending` 给「继续支付」且状态文案是「待支付」；`paid` 不给按钮
 *   ③ **失败 ≠ 空态**：请求失败必须渲染错误态 + 重试，绝不能显示「还没有订单」
 *      （那会让用户以为付过的订单丢了）
 *   ④ 未登录**不发请求**（发一次只会拿 401，并在服务端留无主日志）
 *   ⑤ 空态两个入口分别 emit 不同 navigate 目标
 */

const invokeMock = vi.fn()
vi.mock('@/api/electron-bridge', () => ({ invoke: (...args) => invokeMock(...args) }))

const t = (key) => key
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t }) }))

let authed = true
vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => ({
    get isAuthenticated () { return authed },
  }),
}))

const ORDER_PAID = {
  id: 'wpabc12345', plan: 'standard', amount: 5900, currency: 'CNY',
  status: 'paid', period: 'month', createdAt: '2026-10-20T10:00:00.000Z', paidAt: '2026-10-20T10:01:00.000Z',
}
const ORDER_PENDING = {
  id: 'wpdef67890', plan: 'pro', amount: 99900, currency: 'CNY',
  status: 'pending', period: 'year', createdAt: '2026-10-21T10:00:00.000Z', paidAt: null,
}

async function mountOrders (orders = [ORDER_PAID]) {
  invokeMock.mockResolvedValue({ code: 0, data: { orders } })
  const OrdersBilling = (await import('./OrdersBilling.vue')).default
  const wrapper = mount(OrdersBilling)
  await flushPromises()
  return wrapper
}

describe('OrdersBilling', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    authed = true
  })

  it('列表：四列来自服务端字段，金额是分→元且带周期', async () => {
    const wrapper = await mountOrders([ORDER_PAID, ORDER_PENDING])
    expect(wrapper.find('[data-testid="orders-table"]').exists()).toBe(true)

    const paidRow = wrapper.get(`[data-testid="order-row-${ORDER_PAID.id}"]`)
    expect(paidRow.text()).toContain('¥59.00')
    expect(paidRow.text()).toContain('memberCenter.periodMonth')
    expect(paidRow.text()).toContain('memberCenter.ordersStatusPaid')

    const pendingRow = wrapper.get(`[data-testid="order-row-${ORDER_PENDING.id}"]`)
    expect(pendingRow.text()).toContain('¥999.00')
    expect(pendingRow.text()).toContain('memberCenter.periodYear')
    expect(pendingRow.text()).toContain('memberCenter.ordersStatusPending')
  })

  it('pending 给「继续支付」、paid 不给', async () => {
    const wrapper = await mountOrders([ORDER_PAID, ORDER_PENDING])
    expect(wrapper.find(`[data-testid="order-continue-${ORDER_PENDING.id}"]`).exists()).toBe(true)
    expect(wrapper.find(`[data-testid="order-continue-${ORDER_PAID.id}"]`).exists()).toBe(false)
    expect(wrapper.find('[data-testid="orders-pending-hint"]').exists()).toBe(true)
  })

  it('继续支付：主进程收到该订单的 orderId（复用同一订单，不新建）', async () => {
    const wrapper = await mountOrders([ORDER_PENDING])
    expect(invokeMock).toHaveBeenCalledTimes(1) // 只有列表那一次：弹窗初始未打开

    await wrapper.get(`[data-testid="order-continue-${ORDER_PENDING.id}"]`).trigger('click')
    // 弹窗是 defineAsyncComponent：它的 chunk 要加载 + transform 完才挂载，挂载后
    // watch(immediate) 才会发下单请求。这段耗时依赖 runner 负载（Windows CI 上会多出
    // 好几轮事件循环），写死「两轮微任务」等于把 runner 速度写进断言。
    // 实测 2026-10-23 主干 7718f8987 绿 → 98558636e 红，而两次之间源码零改动
    // （差异只有 max-lines 基线 JSON 与一份执行记录）⇒ 这是 flake 而非回归。
    // 改用仓内既有范式 vi.waitFor：等条件成立，而不是猜事件循环转了几轮。
    await vi.waitFor(() => {
      expect(
        invokeMock.mock.calls.some(([method]) => method === 'wechatPayCreateOrder'),
        '点「继续支付」必须发起复用下单请求'
      ).toBe(true)
    }, { timeout: 10000, interval: 50 })

    const orderCall = invokeMock.mock.calls.find(([method]) => method === 'wechatPayCreateOrder')
    expect(orderCall[1]).toEqual({ plan: 'pro', period: 'year', orderId: ORDER_PENDING.id })
  })

  it('未知状态原样显示，不被塞进「已关闭」（refunded 不能被读成 failed）', async () => {
    const wrapper = await mountOrders([{ ...ORDER_PAID, id: 'wprefund001', status: 'refunded' }])
    expect(wrapper.get('[data-testid="order-status-wprefund001"]').text()).toBe('refunded')
  })

  it('空订单 → 空态 + 两个入口，分别 emit 不同目标', async () => {
    const wrapper = await mountOrders([])
    expect(wrapper.find('[data-testid="member-center-orders-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="orders-table"]').exists()).toBe(false)

    await wrapper.get('[data-testid="orders-empty-buy"]').trigger('click')
    await wrapper.get('[data-testid="orders-empty-redeem"]').trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([['subscription'], ['redeem']])
  })

  it('加载失败 → 错误态 + 重试，**不得显示成空态**', async () => {
    invokeMock.mockResolvedValue({ code: -1, message: 'AUTH_ERROR' })
    const OrdersBilling = (await import('./OrdersBilling.vue')).default
    const wrapper = mount(OrdersBilling)
    await flushPromises()

    expect(wrapper.find('[data-testid="orders-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="member-center-orders-empty"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="orders-table"]').exists()).toBe(false)

    // 重试：第二次成功
    invokeMock.mockResolvedValue({ code: 0, data: { orders: [] } })
    await wrapper.get('[data-testid="orders-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="member-center-orders-empty"]').exists()).toBe(true)
  })

  it('未登录 → 不发请求（登录前列表必空，发一次只会拿 401）', async () => {
    authed = false
    invokeMock.mockResolvedValue({ code: 0, data: { orders: [] } })
    const OrdersBilling = (await import('./OrdersBilling.vue')).default
    const wrapper = mount(OrdersBilling)
    await flushPromises()
    expect(invokeMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="member-center-orders-empty"]').exists()).toBe(true)
  })
})
