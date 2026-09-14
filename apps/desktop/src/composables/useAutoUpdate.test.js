// @ts-check
/**
 * useAutoUpdate.test.js — 自动更新状态（共享单例）测试
 *
 * 覆盖：状态机（badgeMode）、点击即安装流程、监听生命周期幂等。
 * 说明：状态为模块级共享单例，用例间用 resetAutoUpdateState() 复位。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock @/api/publisher 的更新方法
vi.mock('@/api/publisher', function () {
  return {
    onUpdateStatus: vi.fn(function (cb) {
      // 模拟返回 cancel 函数
      return function cancel() { /* noop */ }
    }),
    updateCheck: vi.fn(function () { return Promise.resolve() }),
    updateInstallNow: vi.fn(function () { return Promise.resolve({ code: 0, data: true }) }),
  }
})

import {
  formatSpeed,
  resetAutoUpdateState,
  useAutoUpdate,
} from '../composables/useAutoUpdate'
import { onUpdateStatus, updateCheck, updateInstallNow } from '@/api/publisher'

// ─── 纯函数测试 ────────────────────────────────────────
describe('useAutoUpdate — formatSpeed 纯函数', () => {
  it('null/undefined/0 返回空字符串', () => {
    expect(formatSpeed(null)).toBe('')
    expect(formatSpeed(undefined)).toBe('')
    expect(formatSpeed(0)).toBe('')
  })

  it('< 1KB 返回 B/s', () => {
    expect(formatSpeed(512)).toBe('512 B/s')
  })

  it('1KB - 1MB 返回 KB/s', () => {
    expect(formatSpeed(2048)).toBe('2.0 KB/s')
    expect(formatSpeed(10240)).toBe('10.0 KB/s')
  })

  it('> 1MB 返回 MB/s', () => {
    expect(formatSpeed(2 * 1024 * 1024)).toBe('2.0 MB/s')
    expect(formatSpeed(2.5 * 1024 * 1024)).toBe('2.5 MB/s')
  })

  it('= 1MB 边界返回 KB/s（原始逻辑严格 >）', () => {
    expect(formatSpeed(1024 * 1024)).toBe('1024.0 KB/s')
  })
})

// ─── 状态机测试 ────────────────────────────────────────
describe('useAutoUpdate — 更新状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetAutoUpdateState()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetAutoUpdateState()
  })

  it('返回响应式状态和方法', () => {
    const r = useAutoUpdate()
    expect(r.badgeMode).toBeDefined()
    expect(r.showUpdateBadge).toBeDefined()
    expect(r.updateStatus).toBeDefined()
    expect(r.updateInfo).toBeDefined()
    expect(r.downloading).toBeDefined()
    expect(r.downloadPercent).toBeDefined()
    expect(r.downloadSpeed).toBeDefined()
    expect(r.showNotAvailable).toBeDefined()
    expect(r.showError).toBeDefined()
    expect(r.updateError).toBeDefined()
    expect(r.installRequested).toBeDefined()
    expect(typeof r.handleUpdateStatus).toBe('function')
    expect(typeof r.handleInstallNow).toBe('function')
    expect(typeof r.start).toBe('function')
    expect(typeof r.cleanup).toBe('function')
  })

  it('初始状态：徽标隐藏、无版本信息', () => {
    const r = useAutoUpdate()
    expect(r.badgeMode.value).toBe('hidden')
    expect(r.showUpdateBadge.value).toBe(false)
    expect(r.updateStatus.value).toBeNull()
    expect(r.updateInfo.value).toBeNull()
    expect(r.downloading.value).toBe(false)
    expect(r.downloadPercent.value).toBe(0)
  })

  it('handleUpdateStatus(null) 不抛错', () => {
    const r = useAutoUpdate()
    expect(function () { r.handleUpdateStatus(null) }).not.toThrow()
    expect(r.updateStatus.value).toBeNull()
  })

  it('handleUpdateStatus type=available 显示「新版本」入口', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'available', data: { version: '2.0.0' } })
    expect(r.updateStatus.value).toBe('available')
    expect(r.updateInfo.value).toEqual({ version: '2.0.0' })
    expect(r.badgeMode.value).toBe('available')
    expect(r.showUpdateBadge.value).toBe(true)
  })

  it('handleUpdateStatus type=installing 进入下载态（点击后等待下载完成）', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'installing', data: { version: '2.0.0', phase: 'downloading' } })
    expect(r.badgeMode.value).toBe('downloading')
    expect(r.downloading.value).toBe(true)
    expect(r.showUpdateBadge.value).toBe(true)
  })

  it('handleUpdateStatus type=downloading 更新进度', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'downloading', data: { percent: 50, bytesPerSecond: 2048 } })
    expect(r.updateStatus.value).toBe('downloading')
    expect(r.downloading.value).toBe(true)
    expect(r.downloadPercent.value).toBe(50)
    expect(r.downloadSpeed.value).toBe('2.0 KB/s')
    expect(r.badgeMode.value).toBe('downloading')
  })

  it('handleUpdateStatus type=downloaded 进入「重启安装」态', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'downloaded', data: {} })
    expect(r.updateStatus.value).toBe('downloaded')
    expect(r.downloading.value).toBe(false)
    expect(r.downloadPercent.value).toBe(100)
    expect(r.badgeMode.value).toBe('ready')
  })

  it('用户点击后安装失败 → 保留可重试入口', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'available', data: { version: '2.0.0' } })
    r.handleUpdateStatus({ type: 'installing', data: { version: '2.0.0', phase: 'downloading' } })
    r.handleUpdateStatus({ type: 'error', data: '网络失败' })
    expect(r.updateError.value).toBe('网络失败')
    expect(r.showError.value).toBe(true)
    expect(r.downloading.value).toBe(false)
    expect(r.badgeMode.value).toBe('error')
    expect(r.showUpdateBadge.value).toBe(true)
  })

  it('后台静默检查失败（未点击）→ 不显示入口', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'error', data: '网络失败' })
    expect(r.showError.value).toBe(true)
    expect(r.badgeMode.value).toBe('hidden')
    expect(r.showUpdateBadge.value).toBe(false)
  })

  it('handleUpdateStatus type=error 无 data 时使用默认错误消息', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'error' })
    expect(r.updateError.value).toBe('更新失败，请稍后重试')
  })

  it('handleUpdateStatus type=not-available 隐藏入口并提示已最新', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'available', data: { version: '2.0.0' } })
    r.handleUpdateStatus({ type: 'not-available' })
    expect(r.updateStatus.value).toBe('not-available')
    expect(r.badgeMode.value).toBe('hidden')
    expect(r.updateInfo.value).toBeNull()
    expect(r.showNotAvailable.value).toBe(true)
  })

  it('handleUpdateStatus type=not-available 4 秒后自动隐藏提示条', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'not-available' })
    expect(r.showNotAvailable.value).toBe(true)
    vi.advanceTimersByTime(4000)
    expect(r.showNotAvailable.value).toBe(false)
  })

  it('handleUpdateStatus type=policy-min-version 提示升级', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'policy-min-version', data: { version: '2.3.53' } })
    expect(r.showError.value).toBe(true)
    expect(r.updateError.value).toContain('2.3.53')
  })

  it('handleUpdateStatus type=skipped-by-policy 静默不显示入口', () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'skipped-by-policy' })
    expect(r.updateStatus.value).toBe('skipped-by-policy')
    expect(r.badgeMode.value).toBe('hidden')
  })
})

// ─── 点击即安装 ────────────────────────────────────────
describe('useAutoUpdate — 点击「新版本」退出并安装', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAutoUpdateState()
  })

  afterEach(() => {
    resetAutoUpdateState()
  })

  it('handleInstallNow 调用 API 并进入下载态', async () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'available', data: { version: '2.0.0' } })

    const ok = await r.handleInstallNow()

    expect(updateInstallNow).toHaveBeenCalledTimes(1)
    expect(ok).toBe(true)
    expect(r.installRequested.value).toBe(true)
    expect(r.badgeMode.value).toBe('downloading')
    expect(r.downloading.value).toBe(true)
  })

  it('handleInstallNow 下载中重复点击只调用一次 API', async () => {
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'available', data: { version: '2.0.0' } })

    const first = r.handleInstallNow()
    const second = r.handleInstallNow()

    await Promise.all([first, second])
    expect(updateInstallNow).toHaveBeenCalledTimes(1)
  })

  it('handleInstallNow 返回错误码时进入可重试态', async () => {
    updateInstallNow.mockResolvedValueOnce({ code: -1, message: '安装失败' })
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'available', data: { version: '2.0.0' } })

    const ok = await r.handleInstallNow()

    expect(ok).toBe(false)
    expect(r.badgeMode.value).toBe('error')
    expect(r.downloading.value).toBe(false)
    expect(r.showError.value).toBe(true)
    expect(r.installRequested.value).toBe(false)
  })

  it('handleInstallNow 调用失败时进入可重试态', async () => {
    updateInstallNow.mockRejectedValueOnce(new Error('网络失败'))
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'available', data: { version: '2.0.0' } })

    const ok = await r.handleInstallNow()

    expect(ok).toBe(false)
    expect(r.updateError.value).toBe('网络失败')
    expect(r.badgeMode.value).toBe('error')
    expect(r.showError.value).toBe(true)
  })

  it('重试成功可再次进入下载态', async () => {
    updateInstallNow.mockRejectedValueOnce(new Error('网络失败'))
    const r = useAutoUpdate()
    r.handleUpdateStatus({ type: 'available', data: { version: '2.0.0' } })
    await r.handleInstallNow()
    expect(r.badgeMode.value).toBe('error')

    const ok = await r.handleInstallNow()

    expect(ok).toBe(true)
    expect(updateInstallNow).toHaveBeenCalledTimes(2)
    expect(r.badgeMode.value).toBe('downloading')
    expect(r.updateError.value).toBe('')
  })
})

// ─── 监听生命周期 ──────────────────────────────────────
describe('useAutoUpdate — 监听生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetAutoUpdateState()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetAutoUpdateState()
  })

  it('start 注册 onUpdateStatus 监听 + 3 秒后 updateCheck', () => {
    const r = useAutoUpdate()
    r.start()
    expect(onUpdateStatus).toHaveBeenCalledTimes(1)
    expect(r._cancelUpdateListen).toBeDefined()
    vi.advanceTimersByTime(3000)
    expect(updateCheck).toHaveBeenCalledTimes(1)
  })

  it('start 幂等：重复调用不重复注册监听、不重复检查', () => {
    const r = useAutoUpdate()
    r.start()
    r.start()
    expect(onUpdateStatus).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3000)
    expect(updateCheck).toHaveBeenCalledTimes(1)
  })

  it('cleanup 调用 cancel 函数', () => {
    const r = useAutoUpdate()
    r.start()
    // _cancelUpdateListen 是闭包变量，通过 start 后再 cleanup 不抛错间接验证
    expect(function () { r.cleanup() }).not.toThrow()
  })

  it('start 可重入（cleanup 后再 start 注册新监听）', () => {
    const r = useAutoUpdate()
    r.start()
    r.cleanup()
    r.start()
    expect(onUpdateStatus).toHaveBeenCalledTimes(2)
  })

  it('cleanup 无监听时不抛错', () => {
    const r = useAutoUpdate()
    expect(function () { r.cleanup() }).not.toThrow()
  })
})
