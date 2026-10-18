// @ts-check
/**
 * useOpsCenterRuntime.test.js — 运营后台运行时策略 composable
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiMock = { opsCenterSyncRuntime: vi.fn() }
vi.mock('@/api/ops-center-sync', () => ({
  opsCenterSyncRuntime: () => apiMock.opsCenterSyncRuntime(),
}))

import { useOpsCenterRuntime } from '../composables/useOpsCenterRuntime'

describe('useOpsCenterRuntime', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('loadRuntime 填充公告/策略并暴露严重级别标签', async () => {
    apiMock.opsCenterSyncRuntime.mockResolvedValue({
      code: 0,
      data: {
        announcements: [{ title: '维护', severity: 'maintenance', content: 'x' }],
        updatePolicy: { min_version: '2.3.50' },
        contentPolicy: { name: '默认', enabled: true, updatedAt: 't' }, // IPC 契约：词库不下发渲染端
        syncedAt: 't',
      },
    })
    const s = useOpsCenterRuntime()
    await s.loadRuntime()
    expect(s.announcements.value).toHaveLength(1)
    expect(s.updatePolicy.value.min_version).toBe('2.3.50')
    expect(s.contentPolicy.value.enabled).toBe(true)
    expect(s.contentPolicy.value).not.toHaveProperty('word_list')
    expect(s.loaded.value).toBe(true)
    // 墓碑：档位文案已迁到 locales（announcement/*），composable 不得再持有中文字面量
    expect(s).not.toHaveProperty('SEVERITY_LABELS')
  })

  it('IPC 不可用/无数据时保持空状态不抛错', async () => {
    apiMock.opsCenterSyncRuntime.mockResolvedValue({ code: -1, message: 'electronAPI not available', data: null })
    const s = useOpsCenterRuntime()
    await s.loadRuntime()
    expect(s.announcements.value).toEqual([])
    expect(s.loaded.value).toBe(true)
  })

  it('导出完整性', () => {
    const s = useOpsCenterRuntime()
    for (const key of ['announcements', 'updatePolicy', 'contentPolicy', 'syncedAt', 'loaded', 'loadRuntime']) {
      expect(s).toHaveProperty(key)
    }
    // 导出面收敛（阶段 1.2）：SEVERITY_LABELS 已删，文案归 locales/announcement
    expect(s).not.toHaveProperty('SEVERITY_LABELS')
  })
})
