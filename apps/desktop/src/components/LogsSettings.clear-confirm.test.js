/**
 * LogsSettings「清理日志」的确认守卫（UX-AUDIT-2026-10-17 阶段 0.2）
 *
 * 与缓存清理同形且此前也无确认：`clearLogs()` 直接 `await logsClear()`，
 * 一点即清空本机全部应用日志（排查问题与提交反馈的唯一现场来源）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

const api = vi.hoisted(() => ({
  logsGetInfo: vi.fn(),
  logsClear: vi.fn(),
  cacheGetStats: vi.fn(),
  cacheClear: vi.fn(),
  submitFeedback: vi.fn(),
}))
vi.mock('@/api/publisher', () => api)

const confirmDanger = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/utils/confirm-danger', () => ({ confirmDanger }))

import LogsSettings from './LogsSettings.vue'

const INFO = {
  code: 0,
  data: { dir: 'L:/logs', totalBytes: 2048, fileCount: 2, maxFileBytes: 1024, files: [] },
}

async function flush (wrapper) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

function clearLogsButton (wrapper) {
  return wrapper.findAll('button').find(b => b.text().includes(i18n.global.t('settings.logs.clearBtn')))
}

describe('LogsSettings 清理日志必须先确认', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    api.logsGetInfo.mockReset().mockResolvedValue(INFO)
    api.cacheGetStats.mockReset().mockResolvedValue({ code: 0, data: { totalBytes: 0, fileCount: 0, items: [] } })
    api.logsClear.mockReset().mockResolvedValue({ code: 0 })
    api.cacheClear.mockReset().mockResolvedValue({ code: 0 })
    api.submitFeedback.mockReset().mockResolvedValue({ code: 0 })
    confirmDanger.mockReset()
    confirmDanger.mockImplementation(async () => true)
  })

  it('确认后清理，并如实调用统一确认原语', async () => {
    const wrapper = await flush(mount(LogsSettings, { global: { plugins: [i18n] } }))
    await clearLogsButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(confirmDanger).toHaveBeenCalledTimes(1)
    expect(confirmDanger.mock.calls[0][0].message).toMatch(/不可恢复/)
    expect(api.logsClear).toHaveBeenCalledTimes(1)
  })

  it('取消时不得清空日志（摘掉确认这一步必红）', async () => {
    confirmDanger.mockImplementation(async () => false)
    const wrapper = await flush(mount(LogsSettings, { global: { plugins: [i18n] } }))

    await clearLogsButton(wrapper).trigger('click')
    await flush(wrapper)

    expect(api.logsClear).not.toHaveBeenCalled()
  })
})
