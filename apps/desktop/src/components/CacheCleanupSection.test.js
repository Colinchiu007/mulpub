import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const api = vi.hoisted(() => ({
  cacheGetStats: vi.fn(),
  cacheClear: vi.fn(),
}))

vi.mock('@/api/publisher', () => api)

// audit-13：清理缓存前必须经统一确认原语；默认「用户已确认」，取消侧用例单独改写
const confirmDanger = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/utils/confirm-danger', () => ({ confirmDanger }))

import CacheCleanupSection from './CacheCleanupSection.vue'

const STATS = {
  code: 0,
  data: {
    totalBytes: 1536,
    fileCount: 3,
    items: [{ key: 'story2video', dir: 'D:/cache/story2video', totalBytes: 1024 }],
  },
}

const flush = async (wrapper) => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return wrapper
}

function mountSection () {
  return mount(CacheCleanupSection, {
    global: { plugins: [i18n], stubs: { UiSkeleton: true } },
  })
}

describe('CacheCleanupSection（自 LogsSettings.vue 抽离的缓存清理卡片）', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    api.cacheGetStats.mockReset().mockResolvedValue(STATS)
    api.cacheClear.mockReset()
    confirmDanger.mockReset()
    confirmDanger.mockImplementation(async () => true)
  })

  it('挂载即拉取统计，渲染总大小/文件数/明细（明细名走 i18n）', async () => {
    const wrapper = await flush(mountSection())
    expect(api.cacheGetStats).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="cache-cleanup-section"]').attributes('role')).toBe('group')
    expect(wrapper.text()).toContain('1.50 KB')
    expect(wrapper.text()).toContain(i18n.global.t('settings.cache.itemStory2Video'))
    expect(wrapper.findAll('.log-file-row')).toHaveLength(1)
  })

  it('无缓存时清理按钮禁用，并显示空态', async () => {
    api.cacheGetStats.mockResolvedValue({ code: 0, data: { totalBytes: 0, fileCount: 0, items: [] } })
    const wrapper = await flush(mountSection())
    expect(wrapper.get('[data-testid="cache-clear-btn"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(i18n.global.t('settings.cache.empty'))
  })

  it('清理成功：重算统计并播报释放量（toast 走 {size} 插值）', async () => {
    api.cacheClear.mockResolvedValue({ code: 0, data: { freedBytes: 1024 } })
    const wrapper = await flush(mountSection())
    await wrapper.get('[data-testid="cache-clear-btn"]').trigger('click')
    await flush(wrapper)
    expect(api.cacheClear).toHaveBeenCalledTimes(1)
    expect(api.cacheGetStats).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[role="status"]').text())
      .toBe(i18n.global.t('settings.cache.clearedToast', { size: '1.00 KB' }))
  })

  it('清理失败（code != 0）：给出失败提示而非静默', async () => {
    api.cacheClear.mockResolvedValue({ code: -1 })
    const wrapper = await flush(mountSection())
    await wrapper.get('[data-testid="cache-clear-btn"]').trigger('click')
    await flush(wrapper)
    expect(wrapper.get('[role="status"]').text())
      .toBe(i18n.global.t('settings.cache.clearFailedToast'))
  })

  it('IPC 不可用（降级 code:-1）时不抛异常', () => {
    api.cacheGetStats.mockResolvedValue({ code: -1, data: { totalBytes: 0, fileCount: 0, items: [] } })
    expect(() => mountSection()).not.toThrow()
  })

  // audit-13：清理缓存删掉中间产物且不可恢复，此前一点即清
  it('清理前先弹确认，文案点名文件数与体积；取消时不得调用 cacheClear', async () => {
    confirmDanger.mockImplementation(async () => false)
    api.cacheClear.mockResolvedValue({ code: 0, data: { freedBytes: 1024 } })
    const wrapper = await flush(mountSection())

    await wrapper.get('[data-testid="cache-clear-btn"]').trigger('click')
    await flush(wrapper)

    expect(confirmDanger).toHaveBeenCalledTimes(1)
    const opts = confirmDanger.mock.calls[0][0]
    expect(opts.message).toContain('3')
    expect(opts.message).toContain('1.50 KB')
    expect(opts.message).toMatch(/不可恢复/)
    expect(api.cacheClear).not.toHaveBeenCalled()
  })
})
