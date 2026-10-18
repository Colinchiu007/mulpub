// @ts-check
/**
 * OAuthManager IPC 安全合同测试
 *
 * @vitest-environment node
 */
__enableElectronMock()

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}
__registerMock('./logger', mockLog)
__registerMock('../services/logger', mockLog)
__registerMock('./store', function MockStore () {})

const OAuthManager = require('./oauth-manager')

const TRUSTED_EVENT = { senderFrame: { url: 'app://localhost/index.html' } }
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }

describe('OAuthManager IPC 安全合同', () => {
  let manager
  let closeHandler

  beforeEach(() => {
    vi.clearAllMocks()
    __resetElectronMock()
    manager = new OAuthManager({})
    manager.close = vi.fn()
    // P1-14：注入契约收紧后必须显式传入受控 ipcMain（不再回退全局）
    manager.registerIpcHandlers(__electronMock.ipcMain)
    closeHandler = __electronMock.ipcMain._handlers['oauth:close']
  })

  it('oauth:close 拒绝不可信来源且不关闭授权流程', async () => {
    const result = await closeHandler(UNTRUSTED_EVENT)

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(manager.close).not.toHaveBeenCalled()
  })

  it('oauth:close 放行可信来源并保持成功返回合同', async () => {
    const result = await closeHandler(TRUSTED_EVENT)

    expect(result).toEqual({ code: 0 })
    expect(manager.close).toHaveBeenCalledTimes(1)
  })

  it('oauth:close 捕获关闭异常并返回稳定错误合同', async () => {
    manager.close.mockImplementation(() => { throw new Error('close failed') })

    await expect(closeHandler(TRUSTED_EVENT)).resolves.toEqual({
      code: -1,
      message: 'close failed',
    })
  })

  it('close 会清理认证视图会话（独立窗口已移除，改用内嵌模式）', () => {
    const oauthManager = new OAuthManager({})
    oauthManager.currentView = { webContents: { close: vi.fn(), destroy: vi.fn() } }
    oauthManager.mainWindow = null

    oauthManager.close()

    // 认证视图被清理
    expect(oauthManager.currentView).toBeNull()
  })
})

describe('OAuthManager 内嵌视图布局（回归：_positionView 曾缺失导致 startAuth 一进入就崩溃）', () => {
  it('_positionView 存在且基于窗口客户区定位（不能用外框尺寸）', () => {
    const oauthManager = new OAuthManager({})
    const setBounds = vi.fn()
    oauthManager.currentView = { setBounds }
    oauthManager.mainWindow = {
      getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
      getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
    }

    expect(() => oauthManager._positionView()).not.toThrow()
    // 客户区 1424x861（而非外框 1440x900），防止右侧滚动条与底部内容被窗口裁掉
    expect(setBounds).toHaveBeenCalledWith({ x: 200, y: 76, width: 1224, height: 785 })
  })

  it('无当前视图或无窗口时 _positionView 不抛异常', () => {
    const oauthManager = new OAuthManager({})
    expect(() => oauthManager._positionView()).not.toThrow()

    oauthManager.currentView = { setBounds: vi.fn() }
    expect(() => oauthManager._positionView()).not.toThrow()
  })
})

describe('OAuthManager 侧栏宽度/折叠同步（回归：_positionView 曾只传 1 参，漏接全局折叠状态）', () => {
  const makeWindow = () => ({
    getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
  })

  it('默认布局与其余内嵌视图一致：x=200 避开侧边栏', () => {
    const m = new OAuthManager({})
    const setBounds = vi.fn()
    m.currentView = { setBounds }
    m.mainWindow = makeWindow()

    m._positionView()

    expect(setBounds).toHaveBeenCalledWith({ x: 200, y: 76, width: 1224, height: 785 })
  })

  it('setSidebarWidth 同步后按新宽度定位', () => {
    const m = new OAuthManager({})
    const setBounds = vi.fn()
    m.currentView = { setBounds }
    m.mainWindow = makeWindow()

    m.setSidebarWidth(68)

    expect(setBounds).toHaveBeenCalledWith({ x: 68, y: 76, width: 1356, height: 785 })
  })

  it('setSidebarWidth 拒绝 0/负值/越界/非数字（守卫与 view-bounds 同源）', () => {
    const m = new OAuthManager({})
    const setBounds = vi.fn()
    m.currentView = { setBounds }
    m.mainWindow = makeWindow()

    for (const bad of [0, -1, 601, '200', null, undefined, NaN, Infinity]) {
      m.setSidebarWidth(bad)
    }

    // 一次都没重排：非法值不得改变布局，也不得把视图盖到 x=0 的侧边栏上
    expect(setBounds).not.toHaveBeenCalled()
  })

  it('setSidebarCollapsed(true) 时视图 x=0 全宽（不依赖 width=0）', () => {
    const m = new OAuthManager({})
    const setBounds = vi.fn()
    m.currentView = { setBounds }
    m.mainWindow = makeWindow()

    m.setSidebarCollapsed(true)

    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 76, width: 1424, height: 785 })
  })

  it('setSidebarCollapsed(false) 恢复侧边栏避让', () => {
    const m = new OAuthManager({})
    const setBounds = vi.fn()
    m.currentView = { setBounds }
    m.mainWindow = makeWindow()

    m.setSidebarCollapsed(true)
    m.setSidebarCollapsed(false)

    expect(setBounds).toHaveBeenLastCalledWith({ x: 200, y: 76, width: 1224, height: 785 })
  })

  it('setSidebarCollapsed 非布尔值一律忽略（IPC 合同只接受 boolean）', () => {
    const m = new OAuthManager({})
    const setBounds = vi.fn()
    m.currentView = { setBounds }
    m.mainWindow = makeWindow()

    for (const bad of ['true', 1, null, undefined, {}]) {
      m.setSidebarCollapsed(bad)
    }

    expect(setBounds).not.toHaveBeenCalled()
  })

  it('重复设置同值不触发重排（幂等）', () => {
    const m = new OAuthManager({})
    const setBounds = vi.fn()
    m.currentView = { setBounds }
    m.mainWindow = makeWindow()

    m.setSidebarWidth(200)
    m.setSidebarWidth(200)
    m.setSidebarCollapsed(false)
    m.setSidebarCollapsed(false)

    expect(setBounds).not.toHaveBeenCalled()
  })

  it('视图未创建时状态仍被记录（后续 startAuth 创建即可用）', () => {
    const m = new OAuthManager({})
    m.mainWindow = makeWindow()

    expect(() => m.setSidebarCollapsed(true)).not.toThrow()
    expect(() => m.setSidebarWidth(68)).not.toThrow()

    // 状态已记下，创建视图后立即按收起态定位
    const setBounds = vi.fn()
    m.currentView = { setBounds }
    m._positionView()
    expect(setBounds).toHaveBeenCalledWith({ x: 0, y: 76, width: 1424, height: 785 })
  })
})

