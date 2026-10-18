// @ts-check
/**
 * 全局「左侧菜单收起/展开」的跨进程链路端到端锁（2026-10-18）。
 *
 * 为什么需要这一条（CCG 深度审查 i2）：单看每一跳都有测试，但「store 一点 → preload →
 * IPC 通道 → WebviewManager → view-bounds → AuthViewManager/QRCodeLogin」整链没有
 * 一个测试真的把它们接起来。缺这一条时，任一环改名/改签名仍会全绿：
 *   · store 测试只 mock 了 invokePageManager；
 *   · preload 测试只认通道名与参数；
 *   · ipc-handlers 测试只认 handler 调用了 self 方法；
 *   · layout 测试只认 setBounds 数字。
 * 本测试用**真实模块**把四段串起来，只替换最外层 Electron 对象（ipcMain/ipcRenderer/
 * BrowserWindow/WebContentsView），因此断言的通道名、参数与 bounds 都是生产代码算出来的。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPageManagerApi } from '../electron/preload/page-manager'
import { registerIpcHandlers } from '../electron/services/webview-manager/ipc-handlers'
import layoutMethods from '../electron/services/webview-manager/layout'
import {
  setSidebarCollapsed,
  sidebarCollapsed,
  reportSidebarCollapsed,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from './stores/sidebar-collapse'

/** 1424×861 客户区：收起后 width=1424，展开时 x=200/width=1224，TOP 恒 76。 */
const WINDOW_CONTENT = { x: 0, y: 0, width: 1424, height: 861 }

function createHarness () {
  const handlers = new Map()
  const ipcMain = { handle (channel, fn) { handlers.set(channel, fn) } }
  const view = {
    bounds: null,
    visible: false,
    setBounds (bounds) { this.bounds = { ...bounds } },
    setVisible (visible) { this.visible = visible },
  }
  const auth = { calls: [], setSidebarCollapsed (v) { this.calls.push(v) } }
  const qr = { calls: [], setSidebarCollapsed (v) { this.calls.push(v) } }
  const wm = {
    mainWindow: { getContentBounds: () => ({ ...WINDOW_CONTENT }) },
    _sidebarWidth: 200,
    _sidebarCollapsed: false,
    _tabViews: new Map([['tab-1', view]]),
    _activeTabId: 'tab-1',
    _authTabInfo: null,
    _authViewManager: auth,
    _qrCodeLogin: qr,
    _overlaySuspensions: new Set(),
    isEmbeddedViewsSuspended () { return false },
    _hideAllTabs () {},
    _getActiveLoginViewManager () { return null },
  }
  Object.assign(wm, layoutMethods)
  registerIpcHandlers.call(wm, ipcMain)
  const ipcRenderer = {
    invoke (channel, arg) {
      const fn = handlers.get(channel)
      // 通道不存在时显式失败：不能让「拼错通道名」退化成静默 no-op
      if (!fn) return Promise.reject(new Error('no ipc handler: ' + channel))
      // 走真实的 withSenderCheck：dev 模式 + 默认 dev-server 端口是它明确接受的来源。
      // NODE_ENV/DEV_SERVER_PORT 在 beforeEach 中固定，避免依赖本机环境。
      return Promise.resolve(fn({ senderFrame: { url: 'http://localhost:5174/' } }, arg))
    },
    on () {},
    removeListener () {},
  }
  return { wm, view, auth, qr, handlers, api: createPageManagerApi(ipcRenderer) }
}

async function flushIpc () {
  // preload.invoke → withSenderCheck → handler 全是 Promise 链，两轮微任务足够
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  const previous = globalThis.window?.electronAPI
  globalThis.__chainPrevApi = previous
  // 让 withSenderCheck 走它自己的 dev 信任分支（真实判据，不 mock 安全模块）
  globalThis.__chainPrevEnv = { NODE_ENV: process.env.NODE_ENV, DEV_SERVER_PORT: process.env.DEV_SERVER_PORT }
  process.env.NODE_ENV = 'development'
  process.env.DEV_SERVER_PORT = '5174'
  try { globalThis.localStorage.clear() } catch { /* jsdom 总是可用 */ }
  // 先把模块级单例复位到展开（无 API 时 report 静默），避免跨用例串状态
  setSidebarCollapsed(false)
})

afterEach(() => {
  globalThis.window.electronAPI = globalThis.__chainPrevApi
  delete globalThis.__chainPrevApi
  const prevEnv = globalThis.__chainPrevEnv
  if (prevEnv) {
    if (prevEnv.NODE_ENV === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevEnv.NODE_ENV
    if (prevEnv.DEV_SERVER_PORT === undefined) delete process.env.DEV_SERVER_PORT
    else process.env.DEV_SERVER_PORT = prevEnv.DEV_SERVER_PORT
  }
  delete globalThis.__chainPrevEnv
})

describe('左侧菜单收起/展开 · 跨进程链路（真实 preload + 真实 handler + 真实 layout）', () => {
  it('收起：store → preload → IPC 通道 → WebviewManager → view-bounds 全宽 + 两个子管理器同步', async () => {
    const h = createHarness()
    globalThis.window.electronAPI = { pageManager: h.api.pageManager }

    setSidebarCollapsed(true)
    await flushIpc()

    expect(sidebarCollapsed.value).toBe(true)
    expect(globalThis.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('1')
    expect(h.wm.isSidebarCollapsed()).toBe(true)
    expect(h.view.bounds).toEqual({ x: 0, y: 76, width: 1424, height: 785 })
    expect(h.auth.calls).toEqual([true])
    expect(h.qr.calls).toEqual([true])
    // 只动收起标志，不得顺手改宽度：展开时要能回到用户原来的 200
    expect(h.wm._sidebarWidth).toBe(200)
  })

  it('展开：同一链路反向恢复 x=200/1224，并再次同步两个子管理器', async () => {
    const h = createHarness()
    globalThis.window.electronAPI = { pageManager: h.api.pageManager }

    setSidebarCollapsed(true)
    await flushIpc()
    setSidebarCollapsed(false)
    await flushIpc()

    expect(sidebarCollapsed.value).toBe(false)
    expect(globalThis.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('0')
    expect(h.wm.isSidebarCollapsed()).toBe(false)
    expect(h.view.bounds).toEqual({ x: 200, y: 76, width: 1224, height: 785 })
    expect(h.auth.calls).toEqual([true, false])
    expect(h.qr.calls).toEqual([true, false])
  })

  it('启动恢复：持久化为收起时，reportSidebarCollapsed 打的是同一条通道且主进程收敛为全宽', async () => {
    // 第一次运行把模块态切成收起（模拟上次退出时的持久化结果）
    const first = createHarness()
    globalThis.window.electronAPI = { pageManager: first.api.pageManager }
    setSidebarCollapsed(true)
    await flushIpc()
    expect(globalThis.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('1')

    // 第二次运行：新的主进程（默认 _sidebarCollapsed=false），启动补报必须把状态追平
    const boot = createHarness()
    globalThis.window.electronAPI = { pageManager: boot.api.pageManager }
    reportSidebarCollapsed()
    await flushIpc()

    expect(boot.wm.isSidebarCollapsed()).toBe(true)
    expect(boot.view.bounds).toEqual({ x: 0, y: 76, width: 1424, height: 785 })
    expect(boot.auth.calls).toEqual([true])
    expect(boot.qr.calls).toEqual([true])
  })
})
