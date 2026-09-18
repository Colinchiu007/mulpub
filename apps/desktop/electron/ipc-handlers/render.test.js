// @ts-check
/**
 * Render IPC handlers 合同测试
 *
 * 验证写操作的 sender 来源校验（withSenderCheck）：
 * - render:start / render:cancel / render:install-deps
 *
 * 只读操作不校验：render:status / render:list-compositions / render:get-composition / render:validate-props
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock logger 防止真实日志污染
vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

// 启用 electron mock，withSenderCheck 通过 require('electron').app 读取 isPackaged
__enableElectronMock()

let registerHandlers
let originalNodeEnv
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  // 信任 dev localhost:5174 — 模拟未打包开发模式
  originalNodeEnv = process.env.NODE_ENV
  originalIsPackaged = __electronMock.app.isPackaged
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const mod = await import('./render')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  __electronMock.app.isPackaged = originalIsPackaged
})

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    on: vi.fn(),
    _get: (channel) => handlers[channel],
  }
}

function createMockDeps(overrides = {}) {
  return {
    renderEngine: {
      render: vi.fn().mockResolvedValue({ success: true, output: '/tmp/out.mp4' }),
      cancel: vi.fn(),
      getStatus: vi.fn(() => ({ state: 'idle' })),
      installDeps: vi.fn().mockResolvedValue({ ok: true }),
      listCompositions: vi.fn(() => []),
      getComposition: vi.fn(() => null),
      validateProps: vi.fn(() => ({ valid: true })),
    },
    BrowserWindow: {
      fromWebContents: vi.fn(() => null),
      getAllWindows: vi.fn(() => []),
    },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  }
}

// 不可信来源（外部网页）
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
// 可信来源（dev localhost）
const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

describe('render IPC 写操作 sender 校验', () => {
  it('render:start 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('render:start')

    const result = await handler(UNTRUSTED_EVENT, { props: {} })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('render:cancel 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('render:cancel')

    const result = await handler(UNTRUSTED_EVENT)

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('render:install-deps 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('render:install-deps')

    const result = await handler(UNTRUSTED_EVENT)

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })
})

describe('render IPC 只读操作不加 sender 校验', () => {
  it('render:status 外部来源也可正常调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('render:status')

    const result = await handler(UNTRUSTED_EVENT)

    expect(result).toEqual({ code: 0, data: { state: 'idle' } })
  })
})

describe('render IPC 可信来源正常工作', () => {
  it('render:start 可信来源正常调用 renderEngine', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('render:start')

    const result = await handler(TRUSTED_EVENT, { props: { id: 'comp-1' } })

    expect(result.code).toBe(0)
    expect(deps.renderEngine.render).toHaveBeenCalled()
  })
})

describe('render:start-ai-video — 快速渲染 AI 视频生成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('缺少 prompt 参数时返回校验错误', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('render:start-ai-video')

    const result = await handler(TRUSTED_EVENT, {})

    expect(result.code).toBeLessThan(0)
    expect(result.message).toContain('prompt')
  })

  it('未配置视频供应商时返回可读错误', async () => {
    const deps = createMockDeps({
      modelProviderManager: {
        callAdapter: vi.fn(),
        getDefault: vi.fn(() => null),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('render:start-ai-video')

    const result = await handler(TRUSTED_EVENT, { prompt: '夏天的风' })

    expect(result.code).toBeLessThan(0)
    expect(result.message).toContain('视频供应商')
  })

  it('成功路径：调用 generateSceneVideo 并返回本地视频路径', async () => {
    const generateSceneVideoMock = vi.fn().mockResolvedValue({ success: true, path: 'C:/tmp/ai-video.mp4' })
    const deps = createMockDeps({
      generateSceneVideo: generateSceneVideoMock,
      modelProviderManager: {
        callAdapter: vi.fn(),
        getDefault: vi.fn(() => ({ id: 'agnes-video', enabled: true, is_configured: true })),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('render:start-ai-video')

    const result = await handler(TRUSTED_EVENT, { prompt: '夏天的风' })

    expect(result.code).toBe(0)
    expect(result.data).toEqual({ success: true, outputPath: 'C:/tmp/ai-video.mp4' })
    expect(generateSceneVideoMock).toHaveBeenCalled()
    const arg = generateSceneVideoMock.mock.calls[0][0]
    expect(arg.prompt).toBe('夏天的风')
    expect(arg.providerId).toBe('agnes-video')
    expect(arg.manager).toBe(deps.modelProviderManager)
  })

  it('generateSceneVideo 失败时返回可读错误并推送 render:error', async () => {
    const generateSceneVideoMock = vi.fn().mockResolvedValue({ success: false, error: '视频生成超时' })
    const sendMock = vi.fn()
    const deps = createMockDeps({
      generateSceneVideo: generateSceneVideoMock,
      modelProviderManager: {
        callAdapter: vi.fn(),
        getDefault: vi.fn(() => ({ id: 'agnes-video', enabled: true, is_configured: true })),
      },
      BrowserWindow: {
        fromWebContents: vi.fn(() => ({ webContents: { send: sendMock } })),
        getAllWindows: vi.fn(() => []),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('render:start-ai-video')

    const result = await handler(TRUSTED_EVENT, { prompt: '夏天的风' })

    expect(result.code).toBeLessThan(0)
    expect(result.message).toContain('视频生成超时')
    expect(sendMock).toHaveBeenCalledWith('render:error', { success: false, error: '视频生成超时' })
  })
})
