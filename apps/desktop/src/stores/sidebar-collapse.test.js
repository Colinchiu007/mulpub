import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 侧边栏折叠全局状态 —— 行为契约（TDD，先于实现编写）。
//
// 设计要点（PRD-SIDEBAR-COLLAPSE-TOGGLE-2026-10-18 §五）：
//   1) 状态是**模块级单例 ref**（非 Pinia），与 stores/settings-dialog.js 同族；
//   2) 持久化 key `mulpub.ui.sidebarCollapsed`：'1' = 收起，其余（含缺失/非法） = 展开；
//   3) 状态变化必须同时：写 localStorage + 上报主进程（内嵌 WebContentsView 不会跟随 CSS）；
//   4) localStorage 抛错（隐私模式）与非 Electron 环境都必须静默降级，不得阻塞 UI；
//   5) 非法入参（非布尔）被忽略，避免 IPC 合同漂移。
const invokePageManager = vi.hoisted(() => vi.fn())

vi.mock('@/api/electron-bridge', () => ({ invokePageManager }))

const KEY = 'mulpub.ui.sidebarCollapsed'

async function loadStore () {
  vi.resetModules()
  return import('./sidebar-collapse')
}

beforeEach(() => {
  invokePageManager.mockReset()
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('侧边栏折叠全局状态（模块单例，非 Pinia）', () => {
  it('默认展开：无持久化值时为 false', async () => {
    const { sidebarCollapsed } = await loadStore()
    expect(sidebarCollapsed.value).toBe(false)
  })

  it('启动读取持久化：1 = 收起；0 / 其它非法值 = 展开', async () => {
    window.localStorage.setItem(KEY, '1')
    let mod = await loadStore()
    expect(mod.sidebarCollapsed.value).toBe(true)

    window.localStorage.setItem(KEY, '0')
    mod = await loadStore()
    expect(mod.sidebarCollapsed.value).toBe(false)

    window.localStorage.setItem(KEY, 'yes')
    mod = await loadStore()
    expect(mod.sidebarCollapsed.value).toBe(false)
  })

  it('toggle 翻转状态、写入持久化并上报主进程', async () => {
    const { sidebarCollapsed, toggleSidebarCollapse } = await loadStore()

    toggleSidebarCollapse()
    expect(sidebarCollapsed.value).toBe(true)
    expect(window.localStorage.getItem(KEY)).toBe('1')
    expect(invokePageManager).toHaveBeenLastCalledWith('setSidebarCollapsed', true)

    toggleSidebarCollapse()
    expect(sidebarCollapsed.value).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe('0')
    expect(invokePageManager).toHaveBeenLastCalledWith('setSidebarCollapsed', false)
  })

  it('setSidebarCollapsed 幂等：同值不重复上报（避免每次重排内嵌视图）', async () => {
    const { setSidebarCollapsed } = await loadStore()

    setSidebarCollapsed(true)
    expect(invokePageManager).toHaveBeenCalledTimes(1)
    setSidebarCollapsed(true)
    expect(invokePageManager).toHaveBeenCalledTimes(1)

    setSidebarCollapsed(false)
    expect(invokePageManager).toHaveBeenCalledTimes(2)
  })

  it('非布尔入参被忽略：不改变状态、不上报（IPC 合同只接受 boolean）', async () => {
    const { sidebarCollapsed, setSidebarCollapsed } = await loadStore()
    setSidebarCollapsed(true)
    invokePageManager.mockClear()

    setSidebarCollapsed('1')
    setSidebarCollapsed(1)
    setSidebarCollapsed(undefined)
    setSidebarCollapsed(null)

    expect(sidebarCollapsed.value).toBe(true)
    expect(invokePageManager).not.toHaveBeenCalled()
  })

  it('reportSidebarCollapsed 只上报当前状态、不改变状态（启动时恢复主进程认知）', async () => {
    window.localStorage.setItem(KEY, '1')
    const { sidebarCollapsed, reportSidebarCollapsed } = await loadStore()

    reportSidebarCollapsed()

    expect(invokePageManager).toHaveBeenLastCalledWith('setSidebarCollapsed', true)
    expect(sidebarCollapsed.value).toBe(true)
  })

  it('localStorage 读/写抛错时静默降级：默认展开，切换仍生效且仍上报', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    const { sidebarCollapsed, toggleSidebarCollapse } = await loadStore()
    expect(sidebarCollapsed.value).toBe(false)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => toggleSidebarCollapse()).not.toThrow()
    expect(sidebarCollapsed.value).toBe(true)
    expect(invokePageManager).toHaveBeenLastCalledWith('setSidebarCollapsed', true)
  })

  it('非 Electron（invokePageManager 返回 undefined）不影响切换', async () => {
    invokePageManager.mockReturnValue(undefined)
    const { sidebarCollapsed, toggleSidebarCollapse } = await loadStore()

    expect(() => toggleSidebarCollapse()).not.toThrow()
    expect(sidebarCollapsed.value).toBe(true)
  })

  it('IPC reject（未登录 / 老版本 preload）不产生未处理拒绝，也不回滚 UI 状态', async () => {
    invokePageManager.mockReturnValue(Promise.reject(new Error('LicensePermissionError')))
    const { sidebarCollapsed, toggleSidebarCollapse } = await loadStore()

    toggleSidebarCollapse()
    await Promise.resolve()
    await Promise.resolve()

    expect(sidebarCollapsed.value).toBe(true)
  })
})
