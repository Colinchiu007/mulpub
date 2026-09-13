// @vitest-environment jsdom
/**
 * AutoPipelineView.test.js — 自动流水线页回归
 *
 * 回归（2026-09-14，no-undef）：视图调用了 `notifyInfo`，但 `useNotify()` 只解构了
 * notifyError/notifySuccess/notifyWarning ——
 *  - resumePipeline() 中的 `notifyInfo('autoPipeline.resuming')` 不在 try 内，
 *    点「恢复流水线」直接抛 ReferenceError，恢复流程中断；
 *  - cancelPipeline() 中的提示被 try/catch 吞掉（取消成功但无提示）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const notify = {
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => notify,
}))

const apiMock = new Proxy({}, {
  // 任意 autoPipeline*/account* 方法默认返回成功空数据；关键方法在用例内覆写
  get: (_target, prop) => {
    if (prop === 'autoPipelineStart') return vi.fn(async () => ({ success: true, runId: 'run-2' }))
    if (prop === 'autoPipelineCancel') return vi.fn(async () => ({ code: 0, data: true }))
    return vi.fn(async () => ({ code: 0, data: [], success: true }))
  },
})

vi.mock('@/api/electron-bridge', () => ({
  getApi: () => apiMock,
}))

import AutoPipelineView from './AutoPipelineView.vue'

const mountView = async () => {
  const wrapper = mount(AutoPipelineView, {
    global: { mocks: { $t: (key) => key } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AutoPipelineView 通知回归（no-undef notifyInfo）', () => {
  it('resumePipeline 提示 resuming 且不再抛 ReferenceError', async () => {
    const wrapper = await mountView()
    wrapper.vm.currentRunId = 'run-1'

    await expect(wrapper.vm.resumePipeline()).resolves.toBeUndefined()
    expect(notify.notifyInfo).toHaveBeenCalledWith('autoPipeline.resuming')
    expect(wrapper.vm.running).toBe(true)
  })

  it('cancelPipeline 成功后提示 cancelled（修复前被 try/catch 吞掉）', async () => {
    const wrapper = await mountView()
    wrapper.vm.currentRunId = 'run-1'

    await wrapper.vm.cancelPipeline()
    expect(notify.notifyInfo).toHaveBeenCalledWith('autoPipeline.cancelled')
  })
})
