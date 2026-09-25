// @ts-check
/**
 * useOpsCenterSync.test.js — 运营后台同步 composable 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import { formatUserError } from '@/utils/user-facing-error'

const apiMock = {
  opsCenterSyncGet: vi.fn(),
  opsCenterSyncSave: vi.fn(),
  opsCenterSyncNow: vi.fn(),
}

vi.mock('@/api/ops-center-sync', function () {
  return {
    opsCenterSyncGet: function () { return apiMock.opsCenterSyncGet() },
    opsCenterSyncSave: function (p) { return apiMock.opsCenterSyncSave(p) },
    opsCenterSyncNow: function () { return apiMock.opsCenterSyncNow() },
  }
})

vi.mock('element-plus', function () {
  return {
    ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    ElMessageBox: { confirm: vi.fn(() => Promise.resolve()) },
  }
})

import { useOpsCenterSync } from '../composables/useOpsCenterSync'

// useOpsCenterSync 内部调用 useI18n()，必须在组件 setup 上下文中实例化
function setupSync () {
  let sync
  mount(defineComponent({
    setup () { sync = useOpsCenterSync(); return {} },
  }), { global: { plugins: [i18n] } })
  return sync
}

describe('useOpsCenterSync', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    vi.clearAllMocks()
  })

  it('loadSyncConfig 填充配置且不暴露明文 Key', async () => {
    apiMock.opsCenterSyncGet.mockResolvedValue({
      code: 0,
      config: { url: 'https://ops.example.com', apiKeyConfigured: true, autoSync: true, lastSyncedAt: '2026-08-10T08:00:00.000Z' },
    })
    const s = setupSync()
    await s.loadSyncConfig()
    expect(s.syncUrl.value).toBe('https://ops.example.com')
    expect(s.syncApiKey.value).toBe('')
    expect(s.syncApiKeyConfigured.value).toBe(true)
    expect(s.syncConfigured.value).toBe(true)
    expect(s.lastSyncedAt.value).toBe('2026-08-10T08:00:00.000Z')
    expect(s.formatLastSync('2026-08-10T08:00:00.000Z')).toBeTruthy()
  })

  it('IPC 不可用时 fail-closed（不抛错，保持空状态）', async () => {
    apiMock.opsCenterSyncGet.mockResolvedValue({ code: -1, message: 'electronAPI not available', config: null })
    const s = setupSync()
    const res = await s.loadSyncConfig()
    expect(res.code).toBe(-1)
    expect(s.syncConfigured.value).toBe(false)
    expect(s.syncUrl.value).toBe('')
  })

  it('saveSyncConfig 成功时清空输入 Key 并更新状态', async () => {
    apiMock.opsCenterSyncSave.mockResolvedValue({
      code: 0,
      config: { url: 'https://ops.example.com', apiKeyConfigured: true, autoSync: false, lastSyncedAt: '' },
    })
    const s = setupSync()
    s.syncUrl.value = 'https://ops.example.com'
    s.syncApiKey.value = 'secret'
    s.syncAutoSync.value = true
    const res = await s.saveSyncConfig()
    expect(res.code).toBe(0)
    expect(s.syncApiKey.value).toBe('')
    expect(s.syncAutoSync.value).toBe(false)
    expect(s.syncConfigured.value).toBe(true)
    expect(apiMock.opsCenterSyncSave).toHaveBeenCalledWith({ url: 'https://ops.example.com', apiKey: 'secret', autoSync: true })
  })

  it('saveSyncConfig 失败时提示错误并返回 code -1', async () => {
    apiMock.opsCenterSyncSave.mockResolvedValue({ code: -1, message: 'URL 非法' })
    const s = setupSync()
    const res = await s.saveSyncConfig()
    expect(res.code).toBe(-1)
  })

  it('runSyncNow 先持久化表单再同步：成功显示条数、失败显示错误', async () => {
    apiMock.opsCenterSyncSave.mockResolvedValue({
      code: 0,
      config: { url: 'https://ops.example.com', apiKeyConfigured: true, autoSync: true, lastSyncedAt: '' },
    })
    apiMock.opsCenterSyncNow.mockResolvedValue({ code: 0, updated: 3, syncedAt: '2026-08-10T08:01:00.000Z' })
    const s = setupSync()
    s.syncUrl.value = 'https://ops.example.com'
    s.syncApiKey.value = 'k'
    const res = await s.runSyncNow()
    expect(res.code).toBe(0)
    // 先保存（携带表单 URL/Key/autoSync），再触发同步
    expect(apiMock.opsCenterSyncSave).toHaveBeenCalledWith({ url: 'https://ops.example.com', apiKey: 'k', autoSync: true })
    expect(apiMock.opsCenterSyncNow).toHaveBeenCalledTimes(1)
    expect(s.syncStatus.value).toContain('3 个服务商')
    expect(s.lastSyncedAt.value).toBe('2026-08-10T08:01:00.000Z')

    // 保存失败则中止同步
    apiMock.opsCenterSyncSave.mockResolvedValue({ code: -1, message: 'URL 非法' })
    const s2 = setupSync()
    const res2 = await s2.runSyncNow()
    expect(res2.code).toBe(-1)
    expect(s2.syncError.value).toContain('URL 非法')

    // 同步失败显示映射错误
    apiMock.opsCenterSyncSave.mockResolvedValue({
      code: 0,
      config: { url: 'https://ops.example.com', apiKeyConfigured: true, autoSync: true, lastSyncedAt: '' },
    })
    apiMock.opsCenterSyncNow.mockResolvedValue({ code: -1, message: 'API Key 无效（401/403）' })
    const s3 = setupSync()
    const res3 = await s3.runSyncNow()
    expect(res3.code).toBe(-1)
    expect(s3.syncError.value).toContain('401/403')
  })

  it('runSyncNow 目录未完成但运营配置已下发 → 提示部分成功，不落错误态', async () => {
    apiMock.opsCenterSyncSave.mockResolvedValue({
      code: 0,
      config: { url: 'https://ops.iart.work', apiKeyConfigured: false, autoSync: true, lastSyncedAt: '' },
    })
    const reason = '无法连接 Ops Center: timeout'
    apiMock.opsCenterSyncNow.mockResolvedValue({ code: -1, message: reason, runtimeApplied: true, runtimeSyncedAt: 'server-t' })
    const s = setupSync()
    const res = await s.runSyncNow()

    expect(res.code).toBe(-1)
    // 断言取 i18n 键的渲染结果而非文案字面量，避免文案调整造成假红；
    // 原因文本经 formatUserError 映射为用户可读句，故用同一函数推导期望值。
    const mappedReason = formatUserError(
      { code: -1, message: reason },
      { fallback: i18n.global.t('modelProviders.syncFailed') },
    ).message
    expect(s.syncStatus.value).toBe(i18n.global.t('modelProviders.syncPartialSuccess', { reason: mappedReason }))
    expect(s.syncError.value).toBe('')
  })

  it('autoConnected 零配置模式：syncConfigured=true + autoConnected/autoUrl 暴露', async () => {
    apiMock.opsCenterSyncGet.mockResolvedValue({
      code: 0,
      config: { url: 'https://ops.iart.work', apiKeyConfigured: false, autoSync: true, lastSyncedAt: '', autoConnected: true, autoUrl: 'https://ops.iart.work' },
    })
    const s = setupSync()
    await s.loadSyncConfig()
    expect(s.autoConnected.value).toBe(true)
    expect(s.autoUrl.value).toBe('https://ops.iart.work')
    expect(s.syncConfigured.value).toBe(true) // autoConnected makes it configured
    expect(s.syncApiKeyConfigured.value).toBe(false) // no manual key needed
  })

  it('未登录时 autoConnected=false，syncConfigured 保持 false', async () => {
    apiMock.opsCenterSyncGet.mockResolvedValue({
      code: 0,
      config: { url: '', apiKeyConfigured: false, autoSync: true, lastSyncedAt: '', autoConnected: false, autoUrl: '' },
    })
    const s = setupSync()
    await s.loadSyncConfig()
    expect(s.autoConnected.value).toBe(false)
    expect(s.autoUrl.value).toBe('')
    expect(s.syncConfigured.value).toBe(false)
  })

    it('导出完整性：模板所需属性全部存在', () => {
    const s = setupSync()
    for (const key of ['syncUrl', 'syncApiKey', 'syncApiKeyConfigured', 'syncAutoSync', 'lastSyncedAt', 'syncing', 'syncStatus', 'syncError', 'syncConfigured', 'autoConnected', 'autoUrl', 'formatLastSync', 'loadSyncConfig', 'saveSyncConfig', 'runSyncNow']) {
      expect(s).toHaveProperty(key)
    }
  })
})
