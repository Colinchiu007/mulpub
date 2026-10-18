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
})
