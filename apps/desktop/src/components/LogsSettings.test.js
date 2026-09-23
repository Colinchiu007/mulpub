import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const api = vi.hoisted(() => ({
  logsGetInfo: vi.fn(),
  logsClear: vi.fn(),
  cacheGetStats: vi.fn(),
  cacheClear: vi.fn(),
  submitFeedback: vi.fn(),
}))
vi.mock('@/api/publisher', () => api)

import LogsSettings from './LogsSettings.vue'

const LOG_INFO = {
  code: 0,
  data: {
    dir: 'D:/logs',
    totalBytes: 2048,
    fileCount: 2,
    maxFileBytes: 1024,
    files: [{ name: 'app-2026-09-22.log', size: 1024 }],
  },
}

describe('LogsSettings（缓存卡片抽离后的接线回归）', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    api.logsGetInfo.mockReset().mockResolvedValue(LOG_INFO)
    api.cacheGetStats.mockReset().mockResolvedValue({ code: 0, data: { totalBytes: 0, fileCount: 0, items: [] } })
    api.logsClear.mockReset().mockResolvedValue({ code: 0 })
    api.cacheClear.mockReset().mockResolvedValue({ code: 0 })
    api.submitFeedback.mockReset().mockResolvedValue({ code: 0 })
  })

  it('仍然挂载 CacheCleanupSection，且其自有请求照常发出（拆分未打断页面接线）', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="cache-cleanup-section"]').exists()).toBe(true)
    expect(api.logsGetInfo).toHaveBeenCalledTimes(1)
    expect(api.cacheGetStats).toHaveBeenCalledTimes(1)
  })

  it('父组件继续用共享 formatBytes 渲染日志统计（2048B → 2.00 KB）', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('2.00 KB')
    expect(wrapper.text()).toContain('D:/logs')
  })
})

async function mountPage () {
  const wrapper = mount(LogsSettings, { global: { plugins: [i18n], stubs: { UiSkeleton: true } } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return wrapper
}
