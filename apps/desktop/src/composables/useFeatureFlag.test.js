// @ts-check
/**
 * useFeatureFlag 单元测试（AGENTS.md QM-3「composable 导出完整性测试」+ ADR-0006 fail-closed 口径）
 *
 * 这里锁的是「读不到就当关」这条安全边界：运营 runtime 不可达时若按开启处理，
 * 用户会在端点尚未部署的窗口期点进一个必错的入口（ADR-0006 拒绝的正是这个）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { FEATURE_FLAG_ACCOUNT_CLOUD_SYNC, isFlagEnabled, useFeatureFlag } from './useFeatureFlag'

const _runtime = vi.hoisted(() => vi.fn())

vi.mock('@/api/ops-center-sync', () => ({
  opsCenterSyncRuntime: () => _runtime(),
}))

describe('useFeatureFlag', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('导出完整性：Accounts.vue 模板消费的 enabled / refresh 均存在，且键名为 PRD 约定的 account_cloud_sync', () => {
    expect(FEATURE_FLAG_ACCOUNT_CLOUD_SYNC).toBe('account_cloud_sync')
    expect(typeof isFlagEnabled).toBe('function')
    const { enabled, loading, resolved, refresh } = useFeatureFlag(FEATURE_FLAG_ACCOUNT_CLOUD_SYNC)
    expect(enabled.value).toBe(false)
    expect(typeof refresh).toBe('function')
    expect(loading.value).toBe(false)
    expect(resolved.value).toBe(false)
  })

  it('runtime 下发 true 时开启；下发 false / 缺失时关闭', async () => {
    _runtime.mockResolvedValue({ code: 0, data: { featureFlags: { account_cloud_sync: true } } })
    const flag = useFeatureFlag(FEATURE_FLAG_ACCOUNT_CLOUD_SYNC)
    await expect(flag.refresh()).resolves.toBe(true)
    expect(flag.enabled.value).toBe(true)

    _runtime.mockResolvedValue({ code: 0, data: { featureFlags: { account_cloud_sync: false } } })
    await expect(flag.refresh()).resolves.toBe(false)

    _runtime.mockResolvedValue({ code: 0, data: { featureFlags: {} } })
    await expect(flag.refresh()).resolves.toBe(false)
  })

  it('未同步过运营配置（code!==0 / data 为空）时按关闭处理', async () => {
    const flag = useFeatureFlag(FEATURE_FLAG_ACCOUNT_CLOUD_SYNC)
    _runtime.mockResolvedValue({ code: -1, message: 'electronAPI not available', data: null })
    await expect(flag.refresh()).resolves.toBe(false)
    _runtime.mockResolvedValue({ code: 0, data: null })
    await expect(flag.refresh()).resolves.toBe(false)
    _runtime.mockResolvedValue({ code: 0 })
    await expect(flag.refresh()).resolves.toBe(false)
    expect(flag.enabled.value).toBe(false)
  })

  it('runtime 调用抛错时不冒泡、按关闭处理（入口隐藏即可，不制造第二条失败路径）', async () => {
    _runtime.mockRejectedValue(new Error('ipc boom'))
    const flag = useFeatureFlag(FEATURE_FLAG_ACCOUNT_CLOUD_SYNC)
    await expect(flag.refresh()).resolves.toBe(false)
    expect(flag.enabled.value).toBe(false)
    expect(flag.loading.value).toBe(false)
    expect(flag.resolved.value).toBe(true)
  })

  it('真值判定只认显式布尔/1/' + "'true'" + '，对象与任意字符串一律关闭', () => {
    expect(isFlagEnabled(true)).toBe(true)
    expect(isFlagEnabled(1)).toBe(true)
    expect(isFlagEnabled('true')).toBe(true)
    expect(isFlagEnabled(' TRUE ')).toBe(true)
    expect(isFlagEnabled('1')).toBe(true)
    expect(isFlagEnabled('4k')).toBe(false)
    expect(isFlagEnabled(2)).toBe(false)
    expect(isFlagEnabled({ enabled: true })).toBe(false)
    expect(isFlagEnabled(undefined)).toBe(false)
    expect(isFlagEnabled(null)).toBe(false)
  })

  it('空 key 直接关闭且不发请求', async () => {
    const flag = useFeatureFlag('')
    await expect(flag.refresh()).resolves.toBe(false)
    expect(_runtime).not.toHaveBeenCalled()
  })
})
