// @ts-check
/**
 * useOfflineStatus.test.js — 离线状态 composable 测试（Phase 4.1 TDD）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useOfflineStatus } from '../composables/useOfflineStatus'

describe('useOfflineStatus — composable setup', () => {
  let originalElectronAPI

  beforeEach(() => {
    originalElectronAPI = window.electronAPI
    vi.clearAllMocks()
  })

  afterEach(() => {
    window.electronAPI = originalElectronAPI
  })

  it('返回响应式状态和方法', () => {
    window.electronAPI = {}
    const r = useOfflineStatus()
    expect(r.isOffline).toBeDefined()
    expect(r.cachedTaskCount).toBeDefined()
    expect(typeof r.init).toBe('function')
  })

  it('初始 isOffline=false, cachedTaskCount=0', () => {
    window.electronAPI = {}
    const r = useOfflineStatus()
    expect(r.isOffline.value).toBe(false)
    expect(r.cachedTaskCount.value).toBe(0)
  })

  it('init 无 electronAPI 时不抛错', () => {
    window.electronAPI = undefined
    const r = useOfflineStatus()
    expect(function () { r.init() }).not.toThrow()
  })

  it('init 无 offlineStatus 方法时不抛错', () => {
    window.electronAPI = {}
    const r = useOfflineStatus()
    expect(function () { r.init() }).not.toThrow()
  })

  it('init 调用 offlineStatus 并更新状态（offline=true）', async () => {
    const offlineStatus = vi.fn(function () {
      return Promise.resolve({ code: 0, data: { offline: true, cachedCount: 3 } })
    })
    window.electronAPI = { offlineStatus }
    const r = useOfflineStatus()
    await r.init()
    expect(offlineStatus).toHaveBeenCalledTimes(1)
    expect(r.isOffline.value).toBe(true)
    expect(r.cachedTaskCount.value).toBe(3)
  })

  it('init 调用 offlineStatus 并更新状态（offline=false）', async () => {
    const offlineStatus = vi.fn(function () {
      return Promise.resolve({ code: 0, data: { offline: false, cachedCount: 0 } })
    })
    window.electronAPI = { offlineStatus }
    const r = useOfflineStatus()
    await r.init()
    expect(r.isOffline.value).toBe(false)
    expect(r.cachedTaskCount.value).toBe(0)
  })

  it('init code!=0 时不更新状态', async () => {
    const offlineStatus = vi.fn(function () {
      return Promise.resolve({ code: 1, data: {} })
    })
    window.electronAPI = { offlineStatus }
    const r = useOfflineStatus()
    r.isOffline.value = true
    r.cachedTaskCount.value = 5
    await r.init()
    expect(r.isOffline.value).toBe(true)
    expect(r.cachedTaskCount.value).toBe(5)
  })

  it('init 注册 onOfflineRestored 监听', () => {
    const offlineStatus = vi.fn(function () { return Promise.resolve({ code: 0, data: {} }) })
    const onOfflineRestored = vi.fn()
    window.electronAPI = { offlineStatus, onOfflineRestored }
    const r = useOfflineStatus()
    r.init()
    expect(onOfflineRestored).toHaveBeenCalledTimes(1)
  })

  it('onOfflineRestored 回调设置 isOffline=false + cachedTaskCount', () => {
    const offlineStatus = vi.fn(function () { return Promise.resolve({ code: 0, data: {} }) })
    const onOfflineRestored = vi.fn()
    window.electronAPI = { offlineStatus, onOfflineRestored }
    const r = useOfflineStatus()
    r.init()
    r.isOffline.value = true
    r.cachedTaskCount.value = 5
    const cb = onOfflineRestored.mock.calls[0][0]
    cb({ cachedCount: 2 })
    expect(r.isOffline.value).toBe(false)
    expect(r.cachedTaskCount.value).toBe(2)
  })

  it('onOfflineRestored 回调无 cachedCount 时设为 0', () => {
    const offlineStatus = vi.fn(function () { return Promise.resolve({ code: 0, data: {} }) })
    const onOfflineRestored = vi.fn()
    window.electronAPI = { offlineStatus, onOfflineRestored }
    const r = useOfflineStatus()
    r.init()
    const cb = onOfflineRestored.mock.calls[0][0]
    cb({})
    expect(r.cachedTaskCount.value).toBe(0)
  })

  it('init 抛错时不崩溃', () => {
    const offlineStatus = vi.fn(function () { throw new Error('fail') })
    window.electronAPI = { offlineStatus }
    const r = useOfflineStatus()
    expect(function () { r.init() }).not.toThrow()
  })

  // ── 阶段 1.7（audit-7）：断网方向必须真的有通道，且监听成对释放 ──

  it('主进程 offline:lost 回调把状态置为离线并带上缓存数', () => {
    const onOfflineLost = vi.fn()
    window.electronAPI = { onOfflineLost, offlineStatus: vi.fn(async () => ({ code: 0, data: {} })) }
    const r = useOfflineStatus()
    r.init()

    expect(onOfflineLost).toHaveBeenCalledTimes(1)
    onOfflineLost.mock.calls[0][0]({ cachedCount: 4 })
    expect(r.isOffline.value).toBe(true)
    expect(r.cachedTaskCount.value).toBe(4)
  })

  it('缺 onOfflineLost（旧 preload）时不抛错，其它通道照常', () => {
    window.electronAPI = { offlineStatus: vi.fn(async () => ({ code: 0, data: { offline: false, cachedCount: 0 } })) }
    const r = useOfflineStatus()
    expect(function () { r.init() }).not.toThrow()
    window.dispatchEvent(new Event('offline'))
    expect(r.isOffline.value).toBe(true)
    r.dispose()
  })

  it('渲染进程 window 的 offline/online 事件即刻反映（不等主进程推送）', async () => {
    const offlineStatus = vi.fn(async () => ({ code: 0, data: { offline: false, cachedCount: 7 } }))
    window.electronAPI = { offlineStatus }
    const r = useOfflineStatus()
    r.init()

    window.dispatchEvent(new Event('offline'))
    expect(r.isOffline.value).toBe(true)

    r.isOffline.value = true
    r.cachedTaskCount.value = 0
    window.dispatchEvent(new Event('online'))
    expect(r.isOffline.value).toBe(false)
    await Promise.resolve()
    // 恢复后计数回主进程取真值，不得凭猜测清零。
    // 这里**不**断言 offlineStatus 的调用次数：同文件前面的用例没有 dispose，
    // 它们的 online 处理器在触发时经 getApi() 现取 window.electronAPI，会打到本用例的 mock 上
    // （实测 12 次）——计数在这种夹具下不是可信判据，判据交给"值必须来自取回的 7"。
    expect(r.cachedTaskCount.value).toBe(7)
    r.dispose()
  })

  it('dispose 成对释放全部监听（重挂载不得叠加第二份）', () => {
    const removed = []
    window.electronAPI = {
      offlineStatus: vi.fn(async () => ({ code: 0, data: {} })),
      onOfflineLost: () => () => removed.push('lost'),
      onOfflineRestored: () => () => removed.push('restored'),
    }
    const r = useOfflineStatus()
    r.init()
    r.dispose()
    expect(removed.slice().sort()).toEqual(['lost', 'restored'])

    // dispose 后再来 window 事件不该改状态（监听已被摘掉）
    const before = r.isOffline.value
    window.dispatchEvent(new Event('offline'))
    expect(r.isOffline.value).toBe(before)
  })
})
