/**
 * AutomationView 删除任务的确认守卫（UX-AUDIT-2026-10-17 阶段 0.2 / audit-13 家族）
 *
 * 现场取证：本 PR 给 scripts/check-danger-confirm.js 跑首遍时，
 * `views/AutomationView.vue#remove` 是 A 档（该文件此前没有任何确认动作）——
 * 点「删除」即删掉自动化任务及其触发条件、失败处理策略，无回收站。
 * 与 audit-13 列出的六类同形，故一并纳入「6 类无确认破坏性操作」这一批。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

const mockState = {
  listRes: { code: 0, data: { tasks: [{ id: 't1', name: '每日采集', platforms: ['wechat_mp'] }] } },
  removeRes: { code: 0, ok: true },
  removeCalls: 0,
}

vi.mock('@/api/automation', () => ({
  automationList: () => Promise.resolve(mockState.listRes),
  automationCreate: vi.fn(),
  automationUpdate: vi.fn(),
  automationRunNow: vi.fn(),
  automationRemove: () => {
    mockState.removeCalls += 1
    return Promise.resolve(mockState.removeRes)
  },
  onAutomationNotification: () => () => {},
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({ notifyError: vi.fn(), notifySuccess: vi.fn(), notifyWarning: vi.fn() }),
}))

const confirmDanger = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/utils/confirm-danger', () => ({ confirmDanger }))

import AutomationView from '@/views/AutomationView.vue'

async function flush (wrapper) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

function findDeleteButton (wrapper) {
  return wrapper.findAll('button').find(b => (b.attributes('title') || '').includes('删除')
    || b.text().trim() === '删除' || b.text().includes('删除'))
}

describe('AutomationView 删除任务必须先确认', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    confirmDanger.mockReset()
    confirmDanger.mockImplementation(async () => true)
    mockState.removeCalls = 0
  })

  it('确认后删除，确认文案点名被删任务', async () => {
    const wrapper = await flush(mount(AutomationView, { global: { plugins: [i18n] } }))
    const btn = findDeleteButton(wrapper)
    expect(btn, '任务行必须有删除入口').toBeTruthy()

    await btn.trigger('click')
    await flush(wrapper)

    expect(confirmDanger).toHaveBeenCalledTimes(1)
    const message = confirmDanger.mock.calls[0][0].message
    expect(message).toMatch(/每日采集|t1/)
    expect(message).toMatch(/不可恢复/)
    expect(mockState.removeCalls).toBe(1)
  })

  it('用户取消时不得调用 automationRemove（摘掉确认这一步必红）', async () => {
    confirmDanger.mockImplementation(async () => false)
    const wrapper = await flush(mount(AutomationView, { global: { plugins: [i18n] } }))

    await findDeleteButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(confirmDanger).toHaveBeenCalledTimes(1)
    expect(mockState.removeCalls).toBe(0)
  })
})
