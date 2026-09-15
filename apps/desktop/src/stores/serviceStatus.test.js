import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockServicesGetStatus = vi.hoisted(() => vi.fn())
const mockServicesRestart = vi.hoisted(() => vi.fn())

vi.mock('@/api/services', () => ({
  servicesGetStatus: (...args) => mockServicesGetStatus(...args),
  servicesRestart: (...args) => mockServicesRestart(...args),
}))

function okStatus (services) {
  return { code: 0, data: { services } }
}

describe('serviceStatus store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    mockServicesGetStatus.mockReset()
    mockServicesRestart.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refresh 归一化服务列表并标记 loaded', async () => {
    mockServicesGetStatus.mockResolvedValue(okStatus([
      { key: 'mainBackend', name: '主服务', status: 'running', port: 8299 },
      { key: 'splitterEngine', name: '分句引擎', status: 'stopped', port: 8002 },
      { key: 'alignerEngine', name: '对齐引擎', status: 'standby', port: 8004 },
    ]))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await expect(store.refresh()).resolves.toBe(true)

    expect(store.loaded).toBe(true)
    expect(store.unavailable).toBe(false)
    expect(store.services).toHaveLength(3)
    expect(store.services[0]).toMatchObject({ key: 'mainBackend', status: 'running', port: 8299 })
    expect(store.runningCount).toBe(1)
    expect(store.stoppedCount).toBe(1)
    expect(store.allRunning).toBe(false)
    expect(store.hasDegradation).toBe(true)
  })

  it('非法状态值归一为 stopped，非法 port 归一为 0，缺失 reason 按状态兜底', async () => {
    mockServicesGetStatus.mockResolvedValue(okStatus([{ key: 'x', name: 'X', status: 'exploded', port: 'abc' }]))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await store.refresh()

    expect(store.services[0]).toMatchObject({ key: 'x', status: 'stopped', port: 0, reason: 'unknown' })
    expect(store.services[0].restartable).toBe(false)
  })

  it('透传主进程返回的 reason / restartable / onDemand，未知 reason 归一为 unknown', async () => {
    mockServicesGetStatus.mockResolvedValue(okStatus([
      { key: 'a', name: 'A', status: 'stopped', port: 1, reason: 'connection_refused', restartable: true },
      { key: 'b', name: 'B', status: 'standby', port: 2, reason: 'on_demand', onDemand: true },
      { key: 'c', name: 'C', status: 'stopped', port: 3, reason: 'totally_made_up' },
    ]))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await store.refresh()

    expect(store.services[0]).toMatchObject({ reason: 'connection_refused', restartable: true, onDemand: false })
    expect(store.services[1]).toMatchObject({ reason: 'on_demand', onDemand: true })
    expect(store.services[2]).toMatchObject({ reason: 'unknown' })
  })

  it('IPC 不可用时标记 unavailable 且不抛错', async () => {
    mockServicesGetStatus.mockResolvedValue({ code: -1, message: 'SERVICES_API_UNAVAILABLE' })
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await expect(store.refresh()).resolves.toBe(false)

    expect(store.unavailable).toBe(true)
    expect(store.loaded).toBe(false)
  })

  it('轮询期间旧响应不覆盖新状态（快照守卫）', async () => {
    let resolveFirst
    mockServicesGetStatus
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => Promise.resolve(okStatus([
        { key: 'mainBackend', name: '主服务', status: 'running', port: 8299 },
      ])))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    const first = store.refresh()
    const second = store.refresh()
    await second
    resolveFirst(okStatus([{ key: 'mainBackend', name: '主服务', status: 'stopped', port: 8299 }]))
    await first

    expect(store.services[0].status).toBe('running')
  })

  it('startPolling 定时刷新，stopPolling 停止', async () => {
    mockServicesGetStatus.mockResolvedValue(okStatus([
      { key: 'mainBackend', name: '主服务', status: 'running', port: 8299 },
    ]))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    store.startPolling()
    expect(mockServicesGetStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10000)
    expect(mockServicesGetStatus).toHaveBeenCalledTimes(2)

    store.stopPolling()
    await vi.advanceTimersByTimeAsync(30000)
    expect(mockServicesGetStatus).toHaveBeenCalledTimes(2)
  })

  it('重复 startPolling 不会产生并行轮询', async () => {
    mockServicesGetStatus.mockResolvedValue(okStatus([
      { key: 'mainBackend', name: '主服务', status: 'running', port: 8299 },
    ]))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    store.startPolling()
    store.startPolling()

    expect(mockServicesGetStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(mockServicesGetStatus).toHaveBeenCalledTimes(2)
    store.stopPolling()
  })

  it('降级时轮询间隔指数退避', async () => {
    mockServicesGetStatus.mockResolvedValue(okStatus([
      { key: 'a', name: 'A', status: 'stopped', port: 1 },
    ]))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    store.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockServicesGetStatus).toHaveBeenCalledTimes(1)

    // 第 2 次延迟 10s（streak=1）
    await vi.advanceTimersByTimeAsync(10000)
    expect(mockServicesGetStatus).toHaveBeenCalledTimes(2)

    // 第 3 次延迟退避到 20s：前 10s 不应触发
    await vi.advanceTimersByTimeAsync(10000)
    expect(mockServicesGetStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10000)
    expect(mockServicesGetStatus).toHaveBeenCalledTimes(3)

    store.stopPolling()
  })

  it('记录 lastSeenRunning：running 刷新时间戳，故障时保留旧值', async () => {
    mockServicesGetStatus.mockResolvedValueOnce(okStatus([
      { key: 'a', name: 'A', status: 'running', port: 1 },
    ]))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await store.refresh()
    const first = store.lastSeenRunning.a
    expect(Number.isFinite(first)).toBe(true)

    vi.setSystemTime(new Date(Date.now() + 5000))
    mockServicesGetStatus.mockResolvedValueOnce(okStatus([
      { key: 'a', name: 'A', status: 'stopped', port: 1 },
    ]))
    await store.refresh()

    expect(store.lastSeenRunning.a).toBe(first)
  })

  it('restart 成功后刷新并返回 ok', async () => {
    mockServicesRestart.mockResolvedValue({ code: 0, data: { key: 'splitterEngine' } })
    mockServicesGetStatus.mockResolvedValue(okStatus([]))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await expect(store.restart('splitterEngine')).resolves.toEqual({ ok: true })
    expect(mockServicesRestart).toHaveBeenCalledWith('splitterEngine')
    expect(mockServicesGetStatus).toHaveBeenCalled()
  })

  it('restart 失败时透传主进程错误码', async () => {
    mockServicesRestart.mockResolvedValue({ code: -99, message: 'SERVICES_RESTART_FAILED' })
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await expect(store.restart('x')).resolves.toEqual({ ok: false, message: 'SERVICES_RESTART_FAILED' })
  })

  it('restart 遇到权限错误归一为 AUTH_REQUIRED', async () => {
    mockServicesRestart.mockRejectedValue(Object.assign(new Error('permission denied'), { code: -3, name: 'LicensePermissionError' }))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await expect(store.restart('x')).resolves.toEqual({ ok: false, message: 'AUTH_REQUIRED' })
  })

  it('restart 在自定义 code 丢失时仍按 LicensePermissionError 归一', async () => {
    mockServicesRestart.mockRejectedValue(Object.assign(new Error('denied'), { name: 'LicensePermissionError' }))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    await expect(store.restart('x')).resolves.toEqual({ ok: false, message: 'AUTH_REQUIRED' })
  })

  it('restart 进行中时重复调用被拒', async () => {
    let release
    mockServicesRestart.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const { useServiceStatusStore } = await import('./serviceStatus')
    const store = useServiceStatusStore()

    const first = store.restart('a')
    await expect(store.restart('a')).resolves.toEqual({ ok: false, message: 'SERVICES_RESTART_IN_PROGRESS' })

    release({ code: 0 })
    await first
    expect(mockServicesRestart).toHaveBeenCalledTimes(1)
  })
})
