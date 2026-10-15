// @ts-check
/**
 * rate-limit.test.js (ipc-handlers) — 限流自检 IPC 通道（P2）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function makeIpcMain () {
  const handlers = {}
  return {
    ipcMain: { handle: vi.fn((channel, handler) => { handlers[channel] = handler }) },
    call: (channel, ...args) => handlers[channel]({ sender: {}, senderFrame: undefined }, ...args),
    handlers,
  }
}

const LOG = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }

describe('rate-limit IPC handlers', () => {
  let registerHandlers

  beforeEach(() => { registerHandlers = require('./rate-limit').registerHandlers })
  afterEach(() => { vi.restoreAllMocks() })

  it('注册 self-check 与 report 通道；self-check 返回真实自检结果', async () => {
    const { ipcMain, call, handlers } = makeIpcMain()
    registerHandlers(ipcMain, { opsCenterSync: null, app: {}, log: LOG })
    expect(Object.keys(handlers).sort()).toEqual(['rate-limit:report', 'rate-limit:self-check'])
    const r = await call('rate-limit:self-check', { rpm: 120, maxConcurrent: 1, requestCount: 3, requestDurationMs: 10 })
    expect(r.code).toBe(0)
    expect(r.data.engine).toBe('real-governor')
    expect(r.data.metrics.max_concurrent_observed).toBeLessThanOrEqual(1)
    expect(r.data.metrics.network_calls).toBe(0)
  })

  it('self-check 参数非法返回错误码', async () => {
    const { ipcMain, call } = makeIpcMain()
    registerHandlers(ipcMain, { opsCenterSync: null, app: {}, log: LOG })
    const r = await call('rate-limit:self-check', { rpm: 0, requestCount: 5 })
    expect(r.code).toBe(-1)
  })

  it('report 未配置运营后台同步时明确提示且不发起请求', async () => {
    const { ipcMain, call } = makeIpcMain()
    const opsCenterSync = { getConfig: vi.fn(() => ({ manualUrl: '', apiKeyConfigured: false })) }
    registerHandlers(ipcMain, { opsCenterSync, app: {}, log: LOG })
    const r = await call('rate-limit:report', { params: { rpm: 20 }, result: { metrics: {} } })
    expect(r.code).toBe(-1)
    expect(r.message).toContain('未配置运营后台同步')
  })

  it('report 已配置时 POST /api/v1/scheduler/verify 并返回 run_id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ run_id: 42 }),
    })
    const { ipcMain, call } = makeIpcMain()
    const opsCenterSync = {
      getConfig: vi.fn(() => ({ manualUrl: 'https://ops.example.com', apiKeyConfigured: true })),
      getCatalogApiKey: vi.fn(() => 'k'),
    }
    registerHandlers(ipcMain, { opsCenterSync, app: { getPath: () => '/tmp/ud' }, log: LOG })
    const r = await call('rate-limit:report', {
      preset_id: 'minimax-tts',
      params: { rpm: 20, maxConcurrent: 2, limitPer5h: null, requestCount: 5, requestDurationMs: 10 },
      result: { metrics: { total_duration_ms: 100, max_concurrent_observed: 2 }, assertions: [], timeline: [] },
    })
    expect(r.code).toBe(0)
    expect(r.run_id).toBe(42)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('https://ops.example.com/api/v1/scheduler/verify')
    const body = JSON.parse(opts.body)
    expect(body.simulated).toBe(false)
    expect(body.engine).toBe('real-governor')
    expect(body.preset_id).toBe('minimax-tts')
    expect(body.rpm).toBe(20)
  })
})
