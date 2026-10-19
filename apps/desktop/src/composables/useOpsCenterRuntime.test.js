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

  // 回归锁（PR #3898 CI 实测）：`AnnouncementBanner` 挂在 App.vue 下且在 onMounted 里
  // **不 await** 地调用 loadRuntime。当时部分套件把 `@/api/electron-bridge` mock 成
  // 不含 `invokeWithFallback` 的形状，读取即抛 ⇒ 每次挂载壳层就是一次 unhandled rejection
  // （CI 一次跑出 9 条）。判据不是"有没有日志"，而是**这个 promise 永不被拒绝**。
  it('桥接读取抛错时收口为无配置，且绝不向外抛 rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    apiMock.opsCenterSyncRuntime.mockRejectedValue(new Error('No "invokeWithFallback" export is defined on the mock'))
    const s = useOpsCenterRuntime()
    // resolves（不是 rejects）—— 消费方不 await 也不会产生未处理拒绝
    await expect(s.loadRuntime()).resolves.toMatchObject({ code: -1, message: 'runtime_read_failed' })
    expect(s.announcements.value).toEqual([])
    expect(s.updatePolicy.value).toBe(null)
    expect(s.loaded.value).toBe(true)
    // 静默不等于不出声
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][1])).toContain('invokeWithFallback')
    warn.mockRestore()
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
