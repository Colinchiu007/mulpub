// @ts-check
/**
 * useOpsCenterRuntime.test.js — 运营后台运行时策略 composable
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiMock = { opsCenterSyncRuntime: vi.fn() }
vi.mock('@/api/ops-center-sync', () => ({
  opsCenterSyncRuntime: () => apiMock.opsCenterSyncRuntime(),
}))

import { useOpsCenterRuntime, SEVERITIES } from '../composables/useOpsCenterRuntime'

describe('useOpsCenterRuntime', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('loadRuntime 填充公告/策略，并只保留 severity 机器值词表（文案已迁 locale）', async () => {
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
    // 文案已从本 composable 移出（ux-audit-announcement-mount）：
    // 原先这里是一张写死中文的 SEVERITY_LABELS 表，英文界面必然露出中文。
    // composable 只保留机器值白名单；标签由组件按 locale 取（见 announcement-copy.test.js）。
    expect(s.SEVERITY_LABELS).toBeUndefined()
    expect(SEVERITIES).toEqual(['info', 'warning', 'maintenance'])
  })

  it('IPC 不可用/无数据时保持空状态不抛错', async () => {
    apiMock.opsCenterSyncRuntime.mockResolvedValue({ code: -1, message: 'electronAPI not available', data: null })
    const s = useOpsCenterRuntime()
    await s.loadRuntime()
    expect(s.announcements.value).toEqual([])
    expect(s.loaded.value).toBe(true)
  })

  // 本批接线引入的真实回归：横幅挂在 App.vue 上，onMounted 里那条 loadRuntime() 没人 await，
  // 宿主一抛（实测是部分 mock 缺 invokeWithFallback）就变成 Unhandled Rejection，
  // 全域 vitest 报 `Errors 5 errors` 而**测试全绿** —— 断言面完全看不见它。
  it('宿主抛错时 loadRuntime 必须以返回值表达失败，不得把 rejection 抛给调用方', async () => {
    apiMock.opsCenterSyncRuntime.mockRejectedValue(new Error('invokeWithFallback is not defined'))
    const s = useOpsCenterRuntime()
    const res = await s.loadRuntime()
    expect(res.code).toBe(-1)
    expect(res.message).toContain('invokeWithFallback is not defined')
    expect(s.announcements.value).toEqual([])
    expect(s.loaded.value).toBe(true)
  })

  it('失败返回值不得被当成"公告为空"的成功态（两者可区分）', async () => {
    apiMock.opsCenterSyncRuntime.mockRejectedValue(new Error('bridge down'))
    const s = useOpsCenterRuntime()
    const res = await s.loadRuntime()
    expect(res.code).not.toBe(0)
    expect(res.data).toBeNull()
  })

  it('导出完整性', () => {    const s = useOpsCenterRuntime()
    for (const key of ['announcements', 'updatePolicy', 'contentPolicy', 'syncedAt', 'loaded', 'loadRuntime']) {
      expect(s).toHaveProperty(key)
    }
    // 反向锁：标签表不得再回到 composable（它承载的是文案，不是运行时状态）
    expect(s).not.toHaveProperty('SEVERITY_LABELS')
  })
})
