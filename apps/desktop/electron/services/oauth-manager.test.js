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
