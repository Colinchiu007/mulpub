import { describe, expect, it, vi } from 'vitest'

// page-manager preload —— 全局侧边栏折叠的 IPC 合同（TDD，先于实现编写）。
//
// 渲染层按 `invokePageManager('setSidebarCollapsed', boolean)` 调用；
// 本测试钉死「命名空间方法存在 + 通道名 + 参数原样透传」三件事，
// 防止实现落到错误的通道（例如误用 set-sidebar-width）。
describe('page-manager preload：侧边栏折叠 IPC 合同', () => {
  function createApi () {
    const { createPageManagerApi } = require('./page-manager')
    const ipcRenderer = {
      invoke: vi.fn(async () => ({ code: 0 })),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    return { api: createPageManagerApi(ipcRenderer), ipcRenderer }
  }

  it('暴露 setSidebarCollapsed(boolean)，只经 page-manager:set-sidebar-collapsed 通道', () => {
    const { api, ipcRenderer } = createApi()

    expect(typeof api.pageManager.setSidebarCollapsed).toBe('function')
    api.pageManager.setSidebarCollapsed(true)
    api.pageManager.setSidebarCollapsed(false)

    expect(ipcRenderer.invoke.mock.calls).toEqual([
      ['page-manager:set-sidebar-collapsed', true],
      ['page-manager:set-sidebar-collapsed', false],
    ])
  })

  it('不复用 set-sidebar-width 通道表达收起（宽度守卫只接受 >0）', () => {
    const { api, ipcRenderer } = createApi()

    api.pageManager.setSidebarCollapsed(true)

    const channels = ipcRenderer.invoke.mock.calls.map(([channel]) => channel)
    expect(channels).not.toContain('page-manager:set-sidebar-width')
  })

  it('暴露 onSidebarCollapsedChanged(cb)，监听专用广播通道', () => {
    const { api, ipcRenderer } = createApi()

    expect(typeof api.pageManager.onSidebarCollapsedChanged).toBe('function')
    const cb = vi.fn()
    const off = api.pageManager.onSidebarCollapsedChanged(cb)

    expect(ipcRenderer.on).toHaveBeenCalledWith(
      'page-manager:sidebar-collapsed-changed', expect.any(Function))

    // 主进程载荷形状 { data: { collapsed } }：preload 负责剥壳，交给渲染层裸布尔
    const handler = ipcRenderer.on.mock.calls[0][1]
    handler({}, { data: { collapsed: true } })
    expect(cb).toHaveBeenCalledWith(true)

    handler({}, { collapsed: false })
    expect(cb).toHaveBeenLastCalledWith(false)
  })

  it('广播载荷形状变化时不得静默错位（缺 data 时回落到顶层 collapsed）', () => {
    const { api, ipcRenderer } = createApi()
    const cb = vi.fn()
    api.pageManager.onSidebarCollapsedChanged(cb)

    const handler = ipcRenderer.on.mock.calls[0][1]
    // 老形状：直接 { collapsed }
    handler({}, { collapsed: true })
    expect(cb).toHaveBeenLastCalledWith(true)

    // 缺字段：交给渲染层的 applyRemoteCollapsed 用「非布尔忽略」兜底，不得传成 undefined 之外的怪值
    handler({}, {})
    expect(cb).toHaveBeenLastCalledWith(undefined)
  })

  it('退订函数解绑同一 handler（跨窗口泄漏防护）', () => {
    const { api, ipcRenderer } = createApi()
    const off = api.pageManager.onSidebarCollapsedChanged(vi.fn())

    const handler = ipcRenderer.on.mock.calls[0][1]
    off()

    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      'page-manager:sidebar-collapsed-changed', handler)
  })
})
