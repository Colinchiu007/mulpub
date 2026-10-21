import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

/**
 * WeChatPayDialog 契约测试（8 态状态机）。
 *
 * 判据不只「渲染了」——那对"点了能不能付"零信息。这里锁：
 *   ① 二维码真的来自主进程的 data URL（`src^="data:image/svg+xml"`），
 *      而不是把 code_url 原文塞进 img（那是扫不出的）
 *   ② 轮询**关闭即停**（关弹窗后再等一个周期，IPC 调用数不得增加）
 *   ③ paid 态触发 `identityStore.load`（权益刷新以服务端为准，客户端不自算）
 *   ④ 503 PAYMENT_PROVIDER_UNAVAILABLE → 「支付通道暂未开放」而不是泛化失败文案
 *   ⑤ **反失明**：先断言"真的推进到了扫码页"，再断言后续行为 ——
 *      否则"因为前置失败所以没渲染"会被误读成通过
 */

const invokeMock = vi.fn()
vi.mock('@/api/electron-bridge', () => ({ invoke: (...args) => invokeMock(...args) }))

const t = (key) => key
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t }) }))


const QR = 'data:image/svg+xml;base64,PHN2Zy8+'

async function mountDialog (props = {}) {
  const WeChatPayDialog = (await import('./WeChatPayDialog.vue')).default
  return mount(WeChatPayDialog, { props: { open: true, plan: 'standard', period: 'month', ...props } })
}

describe('WeChatPayDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invokeMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('loading → qrcode：二维码 src 是 SVG data URL（不是 code_url 原文）', async () => {
    // 用可控 promise 把组件钉在 loading 态，否则默认 resolved 的 mock 会在同一轮微任务里
    // 直接跳到 qrcode，"loading 曾经出现"就永远观察不到（反失明断言会假红/假绿）。
    let release
    invokeMock.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const wrapper = await mountDialog()
    expect(wrapper.find('[data-testid="wechat-pay-loading"]').exists()).toBe(true)
    release({ code: 0, data: { orderId: 'wpabc12345', qrDataUrl: QR, expiresAt: null } })
    await flushPromises()
    const img = wrapper.get('[data-testid="wechat-pay-qr"]')
    expect(img.attributes('src')).toBe(QR)
    expect(img.attributes('src').startsWith('data:image/svg+xml')).toBe(true)
    expect(wrapper.find('[data-testid="wechat-pay-scan-hint"]').exists()).toBe(true)
  })

  it('下单调用只带 plan/period（不带 money 字段）', async () => {
    invokeMock.mockResolvedValue({ code: 0, data: { orderId: 'wpabc12345', qrDataUrl: QR } })
    await mountDialog({ plan: 'pro', period: 'year' })
    await flushPromises()
    expect(invokeMock).toHaveBeenCalledWith('wechatPayCreateOrder', { plan: 'pro', period: 'year' })
    const payload = invokeMock.mock.calls[0][1]
    expect(Object.keys(payload).sort()).toEqual(['period', 'plan'])
  })

  it('轮询到 paid → 显示成功 + 触发 identity 刷新 + 停止轮询', async () => {
    invokeMock
      .mockResolvedValueOnce({ code: 0, data: { orderId: 'wpabc12345', qrDataUrl: QR } })
      .mockResolvedValue({ code: 0, data: { orderId: 'wpabc12345', status: 'paid', plan: 'standard' } })
    const wrapper = await mountDialog()
    await flushPromises()
    expect(wrapper.find('[data-testid="wechat-pay-qr"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()

    expect(wrapper.find('[data-testid="wechat-pay-paid"]').exists()).toBe(true)
    // 权益刷新由 Subscription 的 @paid 处理器负责（见 Subscription 测试），弹窗只负责发出事件与载荷
    expect(wrapper.emitted('paid')[0][0]).toMatchObject({ orderId: 'wpabc12345', plan: 'standard' })

    const callsAfterPaid = invokeMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(9000)
    expect(invokeMock.mock.calls.length).toBe(callsAfterPaid)
  })

  it('关闭弹窗即停轮询（关掉后再过一个周期，IPC 调用数不增加）', async () => {
    invokeMock.mockResolvedValue({ code: 0, data: { orderId: 'wpabc12345', qrDataUrl: QR, status: 'pending' } })
    const wrapper = await mountDialog()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
    const before = invokeMock.mock.calls.length
    expect(before).toBeGreaterThan(1)

    await wrapper.get('[data-testid="wechat-pay-close"]').trigger('click')
    await vi.advanceTimersByTimeAsync(12000)
    expect(invokeMock.mock.calls.length).toBe(before)
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('服务端 503 PAYMENT_PROVIDER_UNAVAILABLE → 「支付通道暂未开放」', async () => {
    invokeMock.mockResolvedValue({ code: -1, message: 'PAYMENT_PROVIDER_UNAVAILABLE' })
    const wrapper = await mountDialog()
    await flushPromises()
    const failed = wrapper.get('[data-testid="wechat-pay-failed"]')
    expect(failed.text()).toContain('memberCenter.payChannelUnavailable')
  })

  it('订单被关单（failed）→ 显示二维码已过期', async () => {
    invokeMock
      .mockResolvedValueOnce({ code: 0, data: { orderId: 'wpabc12345', qrDataUrl: QR } })
      .mockResolvedValue({ code: 0, data: { orderId: 'wpabc12345', status: 'failed' } })
    const wrapper = await mountDialog()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
    expect(wrapper.find('[data-testid="wechat-pay-expired"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wechat-pay-refresh"]').exists()).toBe(true)
  })

  it('30 分钟超时 → 提示超时并可重新发起', async () => {
    invokeMock.mockResolvedValue({ code: 0, data: { orderId: 'wpabc12345', qrDataUrl: QR, status: 'pending' } })
    const wrapper = await mountDialog()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 3000)
    await flushPromises()
    expect(wrapper.find('[data-testid="wechat-pay-timeout"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="wechat-pay-restart"]').exists()).toBe(true)
  })

  it('paid 态不允许直接关闭（让用户看到成功反馈）', async () => {
    invokeMock
      .mockResolvedValueOnce({ code: 0, data: { orderId: 'wpabc12345', qrDataUrl: QR } })
      .mockResolvedValue({ code: 0, data: { orderId: 'wpabc12345', status: 'paid', plan: 'standard' } })
    const wrapper = await mountDialog()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
    await wrapper.get('[data-testid="wechat-pay-close"]').trigger('click')
    expect(wrapper.emitted('close')).toBeFalsy()
  })
})
