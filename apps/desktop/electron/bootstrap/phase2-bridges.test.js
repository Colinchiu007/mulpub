/**
 * phase2-bridges 单元测试
 * P1-C 试点：验证 Python bridges 启动/清理逻辑
 *
 * 注意：CJS 项目不 require('vitest')，使用 test-setup.js 注入的全局 describe/it/expect/vi
 */

// Mock logger
__registerMock('../services/logger', {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  notify: vi.fn(),
})

const log = require('../services/logger')
const { startBridges } = require('./phase2-bridges')

describe('phase2-bridges.startBridges', () => {
  let mockApp, mockPythonBridge, mockSplitterBridge, mockPromptBridge

  beforeEach(() => {
    mockApp = { on: vi.fn() }
    mockPythonBridge = {
      startPythonBackend: vi.fn(() => Promise.resolve()),
      stopPythonBackend: vi.fn(() => Promise.resolve()),
    }
    mockSplitterBridge = { start: vi.fn(() => Promise.resolve()), stop: vi.fn(() => Promise.resolve()) }
    mockPromptBridge = { start: vi.fn(() => Promise.resolve()), stop: vi.fn(() => Promise.resolve()) }
    log.info.mockClear()
    log.warn.mockClear()
    log.error.mockClear()
  })

  it('三个 bridge 全部启动成功 — 记录 2 条 info 日志', async () => {
    await startBridges({
      app: mockApp,
      pythonBridge: mockPythonBridge,
      splitterBridge: mockSplitterBridge,
      promptBridge: mockPromptBridge,
    })
    expect(mockPythonBridge.startPythonBackend).toHaveBeenCalledTimes(1)
    expect(mockSplitterBridge.start).toHaveBeenCalledTimes(1)
    expect(mockPromptBridge.start).toHaveBeenCalledTimes(1)
    expect(log.notify).toHaveBeenCalledWith('App', 'bridge-started', expect.objectContaining({ params: { bridge: 'SplitterBridge' } }))
    expect(log.notify).toHaveBeenCalledWith('App', 'bridge-started', expect.objectContaining({ params: { bridge: 'PromptBridge' } }))
  })

  it('pythonBridge 失败 — 不阻断其他 bridge 启动', async () => {
    mockPythonBridge.startPythonBackend = vi.fn(() => Promise.reject(new Error('python down')))
    await startBridges({
      app: mockApp,
      pythonBridge: mockPythonBridge,
      splitterBridge: mockSplitterBridge,
      promptBridge: mockPromptBridge,
    })
    expect(log.notify).toHaveBeenCalledWith('App', 'python-backend-start-failed', expect.objectContaining({ error: 'python down' }))
    expect(mockSplitterBridge.start).toHaveBeenCalledTimes(1)
    expect(mockPromptBridge.start).toHaveBeenCalledTimes(1)
  })

  it('splitterBridge 失败 — promptBridge 仍启动，记录 warn', async () => {
    mockSplitterBridge.start = vi.fn(() => Promise.reject(new Error('splitter crash')))
    await startBridges({
      app: mockApp,
      pythonBridge: mockPythonBridge,
      splitterBridge: mockSplitterBridge,
      promptBridge: mockPromptBridge,
    })
    expect(log.notify).toHaveBeenCalledWith('App', 'bridge-start-failed', expect.objectContaining({ error: 'splitter crash' }))
    expect(mockPromptBridge.start).toHaveBeenCalledTimes(1)
    expect(log.notify).toHaveBeenCalledWith('App', 'bridge-started', expect.objectContaining({ params: { bridge: 'PromptBridge' } }))
  })

  it('splitterBridge 失败（打包形态）— 发送系统通知提示语义分句不可用（bug 反思 P1 打包契约）', async () => {
    // Mock electron：isPackaged=true + Notification 类
    const shownNotifications = []
    __registerMock('electron', {
      app: {},
      isPackaged: () => true,
      Notification: Object.assign(
        class MockNotification {
          constructor(opts) { this.opts = opts }
          show() { shownNotifications.push(this.opts) }
        },
        { isSupported: () => true },
      ),
    })
    // 重新加载模块使 mock 生效
    delete require.cache[require.resolve('./phase2-bridges')]
    const { startBridges: startBridgesFresh } = require('./phase2-bridges')

    mockSplitterBridge.start = vi.fn(() => Promise.reject(new Error('spawn python ENOENT')))
    await startBridgesFresh({
      app: mockApp,
      pythonBridge: mockPythonBridge,
      splitterBridge: mockSplitterBridge,
      promptBridge: mockPromptBridge,
    })

    expect(shownNotifications.length).toBe(1)
    expect(shownNotifications[0].title).toContain('语义分句引擎不可用')
    expect(shownNotifications[0].body).toContain('smart-sentence-splitter')

    // 清理 mock
    delete require.cache[require.resolve('./phase2-bridges')]
  })

  it('返回显式可等待的 bridge 清理函数，不注册异步 before-quit 监听器', async () => {
    const stopBridges = await startBridges({
      app: mockApp,
      pythonBridge: mockPythonBridge,
      splitterBridge: mockSplitterBridge,
      promptBridge: mockPromptBridge,
    })
    expect(stopBridges).toBeTypeOf('function')
    expect(mockApp.on).not.toHaveBeenCalled()
    await stopBridges()
    expect(mockPythonBridge.stopPythonBackend).toHaveBeenCalledTimes(1)
    expect(mockSplitterBridge.stop).toHaveBeenCalledTimes(1)
    expect(mockPromptBridge.stop).toHaveBeenCalledTimes(1)
  })

  it('bridge 清理幂等且等待全部异步 stop 完成', async () => {
    let resolveSplitterStop
    mockSplitterBridge.stop = vi.fn(() => new Promise((resolve) => { resolveSplitterStop = resolve }))
    const stopBridges = await startBridges({
      app: mockApp,
      pythonBridge: mockPythonBridge,
      splitterBridge: mockSplitterBridge,
      promptBridge: mockPromptBridge,
    })

    const firstStop = stopBridges()
    const secondStop = stopBridges()
    let settled = false
    firstStop.then(() => { settled = true })
    await Promise.resolve()

    expect(firstStop).toBe(secondStop)
    expect(settled).toBe(false)
    resolveSplitterStop()
    await firstStop
    expect(mockPythonBridge.stopPythonBackend).toHaveBeenCalledTimes(1)
    expect(mockSplitterBridge.stop).toHaveBeenCalledTimes(1)
    expect(mockPromptBridge.stop).toHaveBeenCalledTimes(1)
  })

  it('bridge 清理中单个 stop 失败 — 不影响其他 stop', async () => {
    mockSplitterBridge.stop = vi.fn(() => Promise.reject(new Error('stop fail')))
    const stopBridges = await startBridges({
      app: mockApp,
      pythonBridge: mockPythonBridge,
      splitterBridge: mockSplitterBridge,
      promptBridge: mockPromptBridge,
    })
    await stopBridges()
    expect(log.notify).toHaveBeenCalledWith('App', 'bridge-stop-failed', expect.objectContaining({ error: 'stop fail' }))
    expect(mockPythonBridge.stopPythonBackend).toHaveBeenCalledTimes(1)
    expect(mockPromptBridge.stop).toHaveBeenCalledTimes(1)
  })

  it('promptBridge 失败 — splitterBridge 仍启动，记录 warn', async () => {
    mockPromptBridge.start = vi.fn(() => Promise.reject(new Error('prompt crash')))
    await startBridges({
      app: mockApp,
      pythonBridge: mockPythonBridge,
      splitterBridge: mockSplitterBridge,
      promptBridge: mockPromptBridge,
    })
    expect(log.notify).toHaveBeenCalledWith('App', 'bridge-start-failed', expect.objectContaining({ error: 'prompt crash' }))
    expect(mockSplitterBridge.start).toHaveBeenCalledTimes(1)
    expect(log.notify).toHaveBeenCalledWith('App', 'bridge-started', expect.objectContaining({ params: { bridge: 'SplitterBridge' } }))
  })

  // 2026-10-18：可选 bridge 的可选依赖（pip 包 / 独立仓库）缺位时，启动会跑满
  // MAX_RESTARTS × HEALTH_CHECK_TIMEOUT 的重试退避（白屏 10-30s）。
  // MP_SKIP_BRIDGES 用于显式跳过；默认不配置时行为必须与之前完全一致。
  it('MP_SKIP_BRIDGES 点名时跳过 start 并留痕，stop 仍调用（清理幂等）', async () => {
    process.env.MP_SKIP_BRIDGES = 'SplitterBridge, PromptBridge'
    try {
      const stopBridges = await startBridges({
        app: mockApp,
        pythonBridge: mockPythonBridge,
        splitterBridge: mockSplitterBridge,
        promptBridge: mockPromptBridge,
      })
      expect(mockPythonBridge.startPythonBackend).toHaveBeenCalledTimes(1)
      expect(mockSplitterBridge.start).not.toHaveBeenCalled()
      expect(mockPromptBridge.start).not.toHaveBeenCalled()
      expect(log.notify).toHaveBeenCalledWith('App', 'bridge-skipped', expect.objectContaining({ params: { bridge: 'SplitterBridge' } }))
      expect(log.notify).toHaveBeenCalledWith('App', 'bridge-skipped', expect.objectContaining({ params: { bridge: 'PromptBridge' } }))
      // 跳过不等于不清理：shutdown 仍对三者调用 stop，语义与未跳过时一致。
      await stopBridges()
      expect(mockSplitterBridge.stop).toHaveBeenCalledTimes(1)
      expect(mockPromptBridge.stop).toHaveBeenCalledTimes(1)
    } finally {
      delete process.env.MP_SKIP_BRIDGES
    }
  })

  it('只跳过 SplitterBridge 时 PromptBridge 照常启动', async () => {
    process.env.MP_SKIP_BRIDGES = 'splitterbridge'
    try {
      await startBridges({
        app: mockApp,
        pythonBridge: mockPythonBridge,
        splitterBridge: mockSplitterBridge,
        promptBridge: mockPromptBridge,
      })
      expect(mockSplitterBridge.start).not.toHaveBeenCalled()
      expect(mockPromptBridge.start).toHaveBeenCalledTimes(1)
    } finally {
      delete process.env.MP_SKIP_BRIDGES
    }
  })
})
