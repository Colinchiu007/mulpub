import { describe, expect, it, vi } from 'vitest'

describe('services IPC', () => {
  it('聚合六个服务的运行状态并返回稳定结构', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    const deps = {
      pythonBridge: { isRunning: vi.fn(() => true), currentPort: vi.fn(() => 8299) },
      splitterBridge: { healthCheck: vi.fn(async () => true), isRunning: true, port: 8002 },
      promptBridge: { healthCheck: vi.fn(async () => true), isRunning: true, port: 8013 },
      callbackServer: { server: { listening: true }, port: 16521 },
      story2videoMediaServer: { origin: 'http://127.0.0.1:54321' },
      alignerBridge: null,
    }
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, deps)
    const event = { senderFrame: { url: 'app://localhost/index.html' } }

    const result = await handlers['services:get-status'](event)

    expect(result.code).toBe(0)
    expect(result.data.services).toHaveLength(6)
    expect(result.data.services.map((s) => s.key)).toEqual([
      'mainBackend', 'splitterEngine', 'promptEngine', 'callbackServer', 'mediaServer', 'alignerEngine',
    ])
    const main = result.data.services.find((s) => s.key === 'mainBackend')
    expect(main).toMatchObject({ status: 'running', port: 8299 })
    const aligner = result.data.services.find((s) => s.key === 'alignerEngine')
    expect(aligner).toMatchObject({ status: 'standby', port: 8004 })
  })

  it('服务异常时返回 stopped 而不是抛错', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    const deps = {
      pythonBridge: { isRunning: vi.fn(() => false), currentPort: vi.fn(() => 8299) },
      splitterBridge: { healthCheck: vi.fn(async () => { throw new Error('ECONNREFUSED') }), port: 8002 },
      promptBridge: { healthCheck: vi.fn(async () => false), port: 8013 },
      callbackServer: { server: null, port: 16521 },
      story2videoMediaServer: { origin: '' },
      alignerBridge: null,
    }
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, deps)
    const event = { senderFrame: { url: 'app://localhost/index.html' } }

    const result = await handlers['services:get-status'](event)

    expect(result.code).toBe(0)
    const byKey = Object.fromEntries(result.data.services.map((s) => [s.key, s.status]))
    expect(byKey).toEqual({
      mainBackend: 'stopped',
      splitterEngine: 'stopped',
      promptEngine: 'stopped',
      callbackServer: 'stopped',
      mediaServer: 'stopped',
      alignerEngine: 'standby',
    })
  })

  it('splitterBridge/promptBridge 缺失时对应服务返回 stopped（生产 deps 接线守卫）', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      pythonBridge: { isRunning: vi.fn(() => true), currentPort: vi.fn(() => 8299) },
      callbackServer: { server: { listening: true } },
      story2videoMediaServer: { origin: 'http://127.0.0.1:54321' },
    })
    const event = { senderFrame: { url: 'app://localhost/index.html' } }

    const result = await handlers['services:get-status'](event)

    expect(result.code).toBe(0)
    const byKey = Object.fromEntries(result.data.services.map((s) => [s.key, s.status]))
    expect(byKey.splitterEngine).toBe('stopped')
    expect(byKey.promptEngine).toBe('stopped')
    expect(byKey.mainBackend).toBe('running')
  })

  it('不可信 sender 不能查询服务状态', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {})
    const result = await handlers['services:get-status']({ senderFrame: { url: 'https://evil.example' } })
    expect(result).toMatchObject({ code: -3 })
  })

  it('返回故障归因与可操作元数据（reason / restartable / onDemand）', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      pythonBridge: { isRunning: () => true, currentPort: () => 8299, startPythonBackend: vi.fn() },
      splitterBridge: {
        healthCheckDetail: vi.fn(async () => ({ ok: false, reason: 'connection_refused', statusCode: null })),
        isRunning: false, port: 8002, ensureRunning: vi.fn(),
      },
      promptBridge: { healthCheck: vi.fn(async () => true), isRunning: true, port: 8013, start: vi.fn() },
      callbackServer: { server: { listening: true }, port: 16521 },
      story2videoMediaServer: { origin: 'http://127.0.0.1:54321', start: vi.fn() },
    })
    const result = await handlers['services:get-status']({ senderFrame: { url: 'app://localhost/index.html' } })

    const byKey = Object.fromEntries(result.data.services.map((s) => [s.key, s]))
    expect(byKey.mainBackend).toMatchObject({ status: 'running', reason: 'ok', restartable: true, onDemand: false })
    // 进程未启动优先归因为 not_started，而非端口级的 connection_refused
    expect(byKey.splitterEngine).toMatchObject({ status: 'stopped', reason: 'not_started', restartable: true })
    expect(byKey.promptEngine).toMatchObject({ status: 'running', reason: 'ok', restartable: true })
    expect(byKey.callbackServer).toMatchObject({ status: 'running', reason: 'ok', restartable: false })
    expect(byKey.mediaServer).toMatchObject({ status: 'running', reason: 'ok', restartable: true })
    expect(byKey.alignerEngine).toMatchObject({ status: 'standby', reason: 'on_demand', restartable: false, onDemand: true })
  })

  it('进程存活但健康检查失败时采用具体归因', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      splitterBridge: { healthCheckDetail: vi.fn(async () => ({ ok: false, reason: 'timeout' })), isRunning: true, port: 8002 },
      promptBridge: { healthCheckDetail: vi.fn(async () => ({ ok: false, reason: 'http_error', statusCode: 500 })), isRunning: true, port: 8013 },
    })
    const result = await handlers['services:get-status']({ senderFrame: { url: 'app://localhost/index.html' } })

    const byKey = Object.fromEntries(result.data.services.map((s) => [s.key, s]))
    expect(byKey.splitterEngine).toMatchObject({ status: 'stopped', reason: 'timeout' })
    expect(byKey.promptEngine).toMatchObject({ status: 'stopped', reason: 'http_error' })
  })

  it('healthCheckDetail 抛错时降级到 healthCheck 布尔判定', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      splitterBridge: {
        healthCheckDetail: vi.fn(async () => { throw new Error('boom') }),
        healthCheck: vi.fn(async () => true),
        isRunning: true, port: 8002,
      },
    })
    const result = await handlers['services:get-status']({ senderFrame: { url: 'app://localhost/index.html' } })

    const splitter = result.data.services.find((s) => s.key === 'splitterEngine')
    expect(splitter).toMatchObject({ status: 'running', reason: 'ok' })
  })

  it('services:restart 调用对应 bridge 的启动入口并返回成功', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    const ensureRunning = vi.fn(async () => {})
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      splitterBridge: { isRunning: false, port: 8002, ensureRunning },
    })
    const result = await handlers['services:restart'](
      { senderFrame: { url: 'app://localhost/index.html' } },
      { key: 'splitterEngine' },
    )

    expect(result.code).toBe(0)
    expect(result.data.key).toBe('splitterEngine')
    expect(ensureRunning).toHaveBeenCalledTimes(1)
  })

  it('services:restart 对 mainBackend 使用 startPythonBackend', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    const startPythonBackend = vi.fn(async () => {})
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      pythonBridge: { isRunning: () => false, currentPort: () => 8299, startPythonBackend },
    })
    const result = await handlers['services:restart'](
      { senderFrame: { url: 'app://localhost/index.html' } },
      { key: 'mainBackend' },
    )

    expect(result.code).toBe(0)
    expect(startPythonBackend).toHaveBeenCalledTimes(1)
  })

  it('services:restart 拒绝白名单外的 key', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      splitterBridge: { isRunning: false, port: 8002, ensureRunning: vi.fn() },
    })
    const result = await handlers['services:restart'](
      { senderFrame: { url: 'app://localhost/index.html' } },
      { key: 'alignerEngine' },
    )

    expect(result).toMatchObject({ code: -2, message: 'SERVICES_RESTART_UNSUPPORTED_KEY' })
  })

  it('services:restart 对无启动入口的服务返回不可用', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      callbackServer: { server: { listening: true }, port: 16521 },
    })
    const result = await handlers['services:restart'](
      { senderFrame: { url: 'app://localhost/index.html' } },
      { key: 'callbackServer' },
    )

    expect(result).toMatchObject({ message: 'SERVICES_RESTART_UNAVAILABLE' })
  })

  it('services:restart 启动失败时返回失败而不抛错', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      splitterBridge: { isRunning: false, port: 8002, ensureRunning: vi.fn(async () => { throw new Error('spawn failed') }) },
    })
    const result = await handlers['services:restart'](
      { senderFrame: { url: 'app://localhost/index.html' } },
      { key: 'splitterEngine' },
    )

    expect(result).toMatchObject({ message: 'SERVICES_RESTART_FAILED' })
    expect(result.data.error).toContain('spawn failed')
  })

  it('services:restart 进行中时重复请求被拒', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    let release
    const ensureRunning = vi.fn(() => new Promise((resolve) => { release = resolve }))
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      splitterBridge: { isRunning: false, port: 8002, ensureRunning },
    })
    const event = { senderFrame: { url: 'app://localhost/index.html' } }

    const first = handlers['services:restart'](event, { key: 'splitterEngine' })
    const second = await handlers['services:restart'](event, { key: 'splitterEngine' })

    expect(second).toMatchObject({ message: 'SERVICES_RESTART_IN_PROGRESS' })
    release()
    await first
    expect(ensureRunning).toHaveBeenCalledTimes(1)
  })

  it('不可信 sender 不能重启服务', async () => {
    const registerServicesHandlers = require('./services')
    const handlers = {}
    const ensureRunning = vi.fn()
    registerServicesHandlers({ handle: (channel, handler) => { handlers[channel] = handler } }, {
      splitterBridge: { isRunning: false, port: 8002, ensureRunning },
    })
    const result = await handlers['services:restart'](
      { senderFrame: { url: 'https://evil.example' } },
      { key: 'splitterEngine' },
    )

    expect(result).toMatchObject({ code: -3 })
    expect(ensureRunning).not.toHaveBeenCalled()
  })
})
