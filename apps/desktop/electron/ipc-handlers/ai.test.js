// @ts-check
/**
 * AI IPC handlers 合同测试
 *
 * 验证写操作的 sender 来源校验（withSenderCheck）：
 * - ai:generate / ai:save-config / ai:generate-titles / ai:generate-summary
 *
 * 只读操作不校验：list-providers / get-config / list-models /
 * test-connection / is-configured / enhance-content
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
  const mod = await import('./ai')
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
    aiGenerator: {
      listProviders: vi.fn(() => []),
      getProviderConfig: vi.fn(),
      listModels: vi.fn(() => []),
      generate: vi.fn(),
      testConnection: vi.fn(),
      updateProviderConfig: vi.fn(),
    },
    aiWriter: {
      isConfigured: vi.fn(() => true),
      generateTitles: vi.fn(),
      enhanceContent: vi.fn(),
      generateSummary: vi.fn(),
    },
    BrowserWindow: { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    ...overrides,
  }
}

// 不可信来源（外部网页）
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
// 可信来源（dev localhost）
const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

describe('ai IPC 写操作 sender 校验', () => {
  it('ai:generate 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('ai:generate')

    const result = await handler(UNTRUSTED_EVENT, { type: 'text', provider: 'openai', params: {} })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('ai:save-config 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('ai:save-config')

    const result = await handler(UNTRUSTED_EVENT, 'openai', { apiKey: 'k' })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('ai:generate-titles 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('ai:generate-titles')

    const result = await handler(UNTRUSTED_EVENT, 'topic')

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('ai:generate-summary 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('ai:generate-summary')

    const result = await handler(UNTRUSTED_EVENT, 'content')

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })
})

describe('ai IPC 可信来源与只读操作', () => {
  it('ai:generate-titles 可信来源正常调用 aiWriter', async () => {
    const deps = createMockDeps({
      aiWriter: {
        isConfigured: vi.fn(() => true),
        generateTitles: vi.fn().mockResolvedValue(['标题一', '标题二']),
        enhanceContent: vi.fn(),
        generateSummary: vi.fn(),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:generate-titles')

    const result = await handler(TRUSTED_EVENT, 'topic')

    expect(result).toEqual({ code: 0, data: ['标题一', '标题二'] })
    expect(deps.aiWriter.generateTitles).toHaveBeenCalledWith('topic')
  })

  it('ai:list-providers 只读操作不加 sender 校验，外部来源也可调用', async () => {
    const deps = createMockDeps({
      aiGenerator: {
        listProviders: vi.fn(() => ['openai', 'anthropic']),
        getProviderConfig: vi.fn(),
        listModels: vi.fn(() => []),
        generate: vi.fn(),
        testConnection: vi.fn(),
        updateProviderConfig: vi.fn(),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:list-providers')

    const result = await handler(UNTRUSTED_EVENT, null)

    expect(result).toEqual({ code: 0, data: ['openai', 'anthropic'] })
  })
})

describe('ai:rewrite 改写引擎 IPC', () => {
  function createRewriteDeps(overrides = {}) {
    return {
      aiGenerator: {
        listProviders: vi.fn(() => []),
        getProviderConfig: vi.fn(),
        listModels: vi.fn(() => []),
        generate: vi.fn(),
        testConnection: vi.fn(),
        updateProviderConfig: vi.fn(),
      },
      aiWriter: {
        isConfigured: vi.fn(() => true),
        generateTitles: vi.fn(),
        enhanceContent: vi.fn(),
        generateSummary: vi.fn(),
      },
      rewriteEngineService: {
        rewrite: vi.fn(),
        listStrategies: vi.fn(() => []),
        getRecommendedStrategies: vi.fn(() => []),
      },
      BrowserWindow: { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
      ...overrides,
    }
  }

  it('ai:rewrite 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createRewriteDeps())
    const handler = ipcMain._get('ai:rewrite')

    const result = await handler(UNTRUSTED_EVENT, { mode: 'expand', content: 'x' })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('ai:rewrite 可信来源调用 rewriteEngineService.rewrite', async () => {
    const deps = createRewriteDeps({
      rewriteEngineService: {
        rewrite: vi.fn().mockResolvedValue({ success: true, result: '改写结果' }),
        listStrategies: vi.fn(() => []),
        getRecommendedStrategies: vi.fn(() => []),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:rewrite')

    const params = { mode: 'expand', content: '正文', userSettings: {} }
    const result = await handler(TRUSTED_EVENT, params)

    expect(result).toEqual({ code: 0, data: { success: true, result: '改写结果' } })
    expect(deps.rewriteEngineService.rewrite).toHaveBeenCalledWith(params)
  })

  it('ai:list-rewrite-strategies 返回策略列表', async () => {
    const deps = createRewriteDeps({
      rewriteEngineService: {
        rewrite: vi.fn(),
        listStrategies: vi.fn(() => [{ id: 'strategy-viral-storytelling', name: '故事化爆款策略' }]),
        getRecommendedStrategies: vi.fn(() => []),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('ai:list-rewrite-strategies')

    const result = await handler()

    expect(result.code).toBe(0)
    expect(result.data).toEqual([{ id: 'strategy-viral-storytelling', name: '故事化爆款策略' }])
  })

  it('ai:rewrite 参数为 null 时返回校验错误', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createRewriteDeps())
    const handler = ipcMain._get('ai:rewrite')

    const result = await handler(TRUSTED_EVENT, null)

    expect(result.code).not.toBe(0)
  })
})

// ── rewrite-cancel-and-truncation-summary：取消通道（协作式，段边界生效）──
describe('ai:rewrite-cancel 取消通道', () => {
  // owner 校验需要 event.sender.id；既有 TRUSTED_EVENT 只有 senderFrame，
  // 故本组单独构造带 sender 的可信事件（生产环境 WebContents 一定有 sender）。
  const OWNER = { sender: { id: 1 }, senderFrame: { url: 'http://localhost:5174/' } }
  const OTHER = { sender: { id: 999 }, senderFrame: { url: 'http://localhost:5174/' } }

  function depsWithRewrite(rewriteImpl) {
    return {
      aiGenerator: {
        listProviders: vi.fn(() => []), getProviderConfig: vi.fn(), listModels: vi.fn(() => []),
        generate: vi.fn(), testConnection: vi.fn(), updateProviderConfig: vi.fn(),
      },
      aiWriter: {
        isConfigured: vi.fn(() => true), generateTitles: vi.fn(),
        enhanceContent: vi.fn(), generateSummary: vi.fn(),
      },
      rewriteEngineService: {
        rewrite: vi.fn(rewriteImpl),
        listStrategies: vi.fn(() => []),
        getRecommendedStrategies: vi.fn(() => []),
      },
      BrowserWindow: { fromWebContents: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    }
  }

  it('无 runId 的老调用方：signal 不下传，行为与改动前一致', async () => {
    const deps = depsWithRewrite(async () => ({ success: true, result: 'r' }))
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const params = { mode: 'imitate', content: 'x' }
    await ipcMain._get('ai:rewrite')(TRUSTED_EVENT, params)

    // 老调用方零影响：不能凭空多出 signal 字段
    expect(deps.rewriteEngineService.rewrite).toHaveBeenCalledWith(params)
    expect(params).not.toHaveProperty('signal')
  })

  it('带 runId：下传 signal 标记对象；取消置位后引擎可读到', async () => {
    let captured = null
    const deps = depsWithRewrite(async (p) => {
      captured = p
      return { success: true, result: 'r' }
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    await ipcMain._get('ai:rewrite')(TRUSTED_EVENT, { mode: 'imitate', content: 'x', runId: 'run-a' })

    expect(captured.signal).toEqual({ cancelled: false })
  })

  it('改写进行中取消 ⇒ 命中 token 并返回 cancelled:true', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    let captured = null
    const deps = depsWithRewrite(async (p) => {
      captured = p
      await gate
      return { success: false, errorCode: 'CANCELLED', cancelled: true }
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const pending = ipcMain._get('ai:rewrite')(OWNER, { mode: 'imitate', content: 'x', runId: 'run-b' })
    // 让 handler 跑到 await 处
    await new Promise((r) => setTimeout(r, 0))

    const cancelRes = await ipcMain._get('ai:rewrite-cancel')(OWNER, 'run-b')
    expect(cancelRes).toEqual({ code: 0, data: { cancelled: true } })
    expect(captured.signal.cancelled).toBe(true)

    release()
    const res = await pending
    expect(res.data.cancelled).toBe(true)
  })

  it('未知 runId ⇒ cancelled:false + reason not_running', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, depsWithRewrite(async () => ({ success: true })))

    const res = await ipcMain._get('ai:rewrite-cancel')(TRUSTED_EVENT, 'no-such-run')
    expect(res).toEqual({ code: 0, data: { cancelled: false, reason: 'not_running' } })
  })

  it('非 owner 取消 ⇒ cancelled:false + reason not_owner，token 不被置位', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    let captured = null
    const deps = depsWithRewrite(async (p) => { captured = p; await gate; return { success: true } })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const pending = ipcMain._get('ai:rewrite')(OWNER, { mode: 'imitate', content: 'x', runId: 'run-c' })
    await new Promise((r) => setTimeout(r, 0))

    const res = await ipcMain._get('ai:rewrite-cancel')(OTHER, 'run-c')
    expect(res).toEqual({ code: 0, data: { cancelled: false, reason: 'not_owner' } })
    expect(captured.signal.cancelled).toBe(false)

    release()
    await pending
  })

  it('改写结束后不再持有 runId（无泄漏）', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, depsWithRewrite(async () => ({ success: true, result: 'r' })))

    await ipcMain._get('ai:rewrite')(TRUSTED_EVENT, { mode: 'imitate', content: 'x', runId: 'run-d' })

    const res = await ipcMain._get('ai:rewrite-cancel')(TRUSTED_EVENT, 'run-d')
    expect(res.data).toEqual({ cancelled: false, reason: 'not_running' })
  })

  it('重复 runId 并发 ⇒ 第二个返回 DUPLICATE_RUN（不共享 token 互相误杀）', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const deps = depsWithRewrite(async () => { await gate; return { success: true } })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const first = ipcMain._get('ai:rewrite')(TRUSTED_EVENT, { mode: 'imitate', content: 'x', runId: 'run-e' })
    await new Promise((r) => setTimeout(r, 0))
    const second = await ipcMain._get('ai:rewrite')(TRUSTED_EVENT, { mode: 'imitate', content: 'x', runId: 'run-e' })
    expect(second.code).not.toBe(0)
    expect(second.message).toContain('DUPLICATE_RUN')

    release()
    await first
  })

  it('ai:rewrite-cancel 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, depsWithRewrite(async () => ({ success: true })))

    const res = await ipcMain._get('ai:rewrite-cancel')(UNTRUSTED_EVENT, 'run-x')
    expect(res).toEqual({ code: -3, message: '未授权的调用来源' })
  })
})
