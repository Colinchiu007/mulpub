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
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
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

// ───────────────────────────────────────────────────────────────────────────
// render:cards —— 入参校验与失败纪律（P2-4 判据①）
//
// 判据① 的原文是「通道入参非法时返回**稳定错误合同**而非 crash」—— 两半都要断言：
//   · 形状：{ code, message }（render.js 自己的合同，不是 account.js 的 { ok, status, reason }）
//   · **不抛异常**：`await handler(...)` 必须 resolve 而不是 reject
//
// 为什么入参校验值得逐层测：本仓没有统一 IPC 入参中间件（§10 X-1），每条通道自校验；
// 不校验的后果不是「报错」而是「崩在深处」（data.pages[0][0] 对 undefined 必崩）。
// ───────────────────────────────────────────────────────────────────────────
describe('render:cards 入参校验（判据①：稳定错误合同而非 crash）', () => {
  /** 拿到 render:cards 的 handler；cardCapture 经 deps 注入以便替换 */
  function getHandler (capture = { renderCardsToPng: vi.fn(async ({ pages }) => pages.map(() => Buffer.from('png'))) }) {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps({ cardCapture: capture }))
    return { handler: ipcMain._get('render:cards'), capture }
  }

  it('通道已注册（否则下面所有断言都在测 undefined）', () => {
    const { handler } = getHandler()
    expect(typeof handler).toBe('function')
  })

  // ★ 反向断言：先把「合法入参能过」钉住，否则「非法入参被拒」可能只是因为通道根本不通
  it('合法入参 ⇒ { code: 0, data: [路径...] }', async () => {
    const { handler } = getHandler()
    const r = await handler(TRUSTED_EVENT, { pages: [['a', 'b'], ['c']] })
    expect(r.code).toBe(0)
    expect(Array.isArray(r.data)).toBe(true)
    expect(r.data).toHaveLength(2)
    expect(r.data.every((p) => typeof p === 'string' && p.endsWith('.png'))).toBe(true)
  })

  const BAD = [
    ['data 缺失', undefined, '缺少 data 参数'],
    ['data 是 null', null, '缺少 data 参数'],
    ['data 是字符串', 'x', '缺少 data 参数'],
    ['data 是数组', [], '缺少 data 参数'],
    ['pages 缺失', {}, 'data.pages 必须是非空数组'],
    ['pages 是空数组', { pages: [] }, 'data.pages 必须是非空数组'],
    ['pages 非数组', { pages: 'x' }, 'data.pages 必须是非空数组'],
    ['pages[0] 非数组', { pages: ['x'] }, 'data.pages[0] 必须是数组'],
    ['pages[0][0] 非字符串', { pages: [[1]] }, 'data.pages[0][0] 必须是字符串'],
    ['pages[1][0] 非字符串（点名下标）', { pages: [['ok'], [null]] }, 'data.pages[1][0] 必须是字符串'],
  ]

  for (const [name, input, expectMsg] of BAD) {
    it(`${name} ⇒ VALIDATION_ERROR（且不抛异常）`, async () => {
      const { handler, capture } = getHandler()
      // ★ 用 resolves 而不是 rejects —— 判据要的是「返回错误合同」，throw 即失败
      const r = await handler(TRUSTED_EVENT, input)
      expect(r).toMatchObject({ code: -2, message: expect.any(String) })
      expect(r.message).toContain(expectMsg)
      // 入参非法时**不得**触碰渲染服务（否则等于把非法值喂给了下游）
      expect(capture.renderCardsToPng).not.toHaveBeenCalled()
    })
  }

  for (const [name, bad] of [['0', 0], ['负数', -1], ['小数', 1.5], ['字符串', '1006']]) {
    it(`widthPx 是${name} ⇒ VALIDATION_ERROR（不静默回落默认）`, async () => {
      const { handler } = getHandler()
      const r = await handler(TRUSTED_EVENT, { pages: [['a']], widthPx: bad })
      expect(r).toMatchObject({ code: -2 })
      expect(r.message).toContain('widthPx')
    })
  }

  it('未给 widthPx ⇒ 用默认（undefined 不是非法值）', async () => {
    const { handler, capture } = getHandler()
    const r = await handler(TRUSTED_EVENT, { pages: [['a']] })
    expect(r.code).toBe(0)
    expect(capture.renderCardsToPng).toHaveBeenCalledTimes(1)
  })

  // ★ 失败纪律：部分产物比没有更危险（用户会以为发全了）
  it('渲染页数不符 ⇒ REQUEST_ERROR 且**不返回部分产物**', async () => {
    const { handler } = getHandler({
      renderCardsToPng: vi.fn(async () => [Buffer.from('only-one')]), // 期望 2 页，只给 1 页
    })
    const r = await handler(TRUSTED_EVENT, { pages: [['a'], ['b']] })
    expect(r).toMatchObject({ code: -1 })
    expect(r.message).toContain('渲染页数不符')
    expect(r.data).toBeUndefined()
  })

  it('渲染服务不可用 ⇒ REQUEST_ERROR 而非 crash', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps({ cardCapture: {} })) // 没有 renderCardsToPng
    const r = await ipcMain._get('render:cards')(TRUSTED_EVENT, { pages: [['a']] })
    expect(r).toMatchObject({ code: -1 })
  })

  it('渲染抛错 ⇒ REQUEST_ERROR 而非 crash（异常不外泄）', async () => {
    const { handler } = getHandler({
      renderCardsToPng: vi.fn(async () => { throw new Error('offscreen 窗口创建失败') }),
    })
    const r = await handler(TRUSTED_EVENT, { pages: [['a']] })
    expect(r).toMatchObject({ code: -1 })
    expect(r.message).toContain('offscreen 窗口创建失败')
  })

  // 与同文件其余写操作一致：render:cards 也走 withSenderCheck
  it('拒绝外部网页调用（与 render:start 同口径）', async () => {
    const { handler } = getHandler()
    const r = await handler(UNTRUSTED_EVENT, { pages: [['a']] })
    expect(r).toEqual({ code: -3, message: '未授权的调用来源' })
  })
})
