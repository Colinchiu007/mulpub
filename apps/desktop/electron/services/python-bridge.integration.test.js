/**
 * 跨包集成测试：Electron 主进程 → python-backend FastAPI 通信链路
 *
 * 测 python-bridge.js 的 spawn 子进程管理 + http 健康检查 + requestBackend 转发。
 * 不真实 spawn Python（CI 无 Python/依赖），改用 vi.spyOn 拦截 child_process.spawn
 * 与 http.get/http.request。
 *
 * 放在 electron/services/ 下以被 apps/desktop/vitest.config.js 的 include 命中。
 */
import { vi, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import { EventEmitter } from 'events'

// mock 身份运行时配置加载器，验证 python-bridge 是否把身份环境变量注入 Python 后端子进程。
// 主进程代码用 CJS require 加载，vi.mock 不生效，须用 test-setup 的 __registerMock 拦截 Module._load。
const identityRuntimeMock = { loadIdentityRuntimeEnv: vi.fn(() => ({})) }
__registerMock('./identity/identity-runtime-config', identityRuntimeMock)

// 构造伪 ChildProcess：带 stdout/stderr/exit/on/kill/pid
function createFakeProc (pid) {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = pid || 12345
  proc.kill = vi.fn((sig) => {
    // kill 后异步触发 exit
    setImmediate(() => proc.emit('exit', 0, null))
  })
  // spawn 事件：真实 child_process 在进程启动后触发 'spawn'
  // python-bridge.js 监听此事件来 resolve Promise（修复竞态后）
  setImmediate(() => proc.emit('spawn'))
  return proc
}

function createCrashingProc () {
  const proc = createFakeProc()
  proc.removeAllListeners('spawn')
  setImmediate(() => proc.emit('exit', 1, null))
  return proc
}

function createExitBeforeSpawnProc () {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = 12346
  proc.kill = vi.fn()
  setImmediate(() => proc.emit('exit', 1, null))
  return proc
}

let spawnSpy
let httpGetSpy
let httpRequestSpy
let spawnSyncSpy
let bridge
let spawnedProcesses

beforeAll(() => {
  // 核心模块不随 vi.resetModules() 一起重建；一次加载并持续复用同一
  // child_process/http 实例，避免 bridge 与测试侧的 spy 落在不同模块图。
  const child_process = require('child_process')
  const http = require('http')
  spawnSpy = vi.spyOn(child_process, 'spawn')
  spawnSyncSpy = vi.spyOn(child_process, 'spawnSync')
  httpGetSpy = vi.spyOn(http, 'get')
  httpRequestSpy = vi.spyOn(http, 'request')
  bridge = require('./python-bridge')
})

function mockHealthGetAlways (healthy) {
  httpGetSpy.mockImplementation((url, opts, cb) => {
    const res = new EventEmitter()
    res.statusCode = 200
    setImmediate(() => {
      if (cb) cb(res)
      res.emit('data', JSON.stringify({ status: healthy ? 'ok' : 'bad' }))
      res.emit('end')
    })
    const req = new EventEmitter()
    req.destroy = vi.fn()
    return req
  })
}

function mockHealthGetAfterAttempts (healthyAfter) {
  let attempts = 0
  httpGetSpy.mockImplementation((url, opts, cb) => {
    const res = new EventEmitter()
    res.statusCode = 200
    const healthy = ++attempts > healthyAfter
    setImmediate(() => {
      if (cb) cb(res)
      res.emit('data', JSON.stringify({ status: healthy ? 'ok' : 'bad' }))
      res.emit('end')
    })
    const req = new EventEmitter()
    req.destroy = vi.fn()
    return req
  })
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllTimers()
  spawnedProcesses = []
  spawnSpy.mockReset().mockImplementation(() => {
    const proc = createFakeProc(12345 + spawnedProcesses.length)
    spawnedProcesses.push(proc)
    return proc
  })
  spawnSyncSpy.mockReset().mockImplementation(() => ({ status: 0 }))
  httpGetSpy.mockReset()
  httpRequestSpy.mockReset()
  bridge.setAuthService(null)
})

afterEach(async () => {
  vi.useRealTimers()
  // 清理：停止后端 + 恢复 spy
  try { await bridge.stopPythonBackend() } catch { /* noop */ }
  vi.clearAllTimers()
})

afterAll(() => {
  vi.useRealTimers()
  vi.clearAllTimers()
  vi.restoreAllMocks()
})

// 辅助：让 http.get 的下一次调用返回 {status:'ok'}
function mockHealthGet (healthy) {
  httpGetSpy.mockImplementationOnce((url, opts, cb) => {
    const res = new EventEmitter()
    res.statusCode = 200
    setImmediate(() => {
      if (cb) cb(res)
      res.emit('data', JSON.stringify({ status: healthy ? 'ok' : 'bad' }))
      res.emit('end')
    })
    const req = new EventEmitter()
    req.destroy = vi.fn()
    return req
  })
}

// 辅助：让 http.get 持续返回错误（连接拒绝）
function mockHealthGetError () {
  httpGetSpy.mockImplementationOnce(() => {
    const req = new EventEmitter()
    setImmediate(() => req.emit('error', new Error('connect ECONNREFUSED')))
    return req
  })
}

test('startPythonBackend 成功路径：spawn 正确参数 + 健康检查通过 + isRunning=true', async () => {
  mockHealthGet(true)
  await bridge.startPythonBackend()
  expect(spawnSpy).toHaveBeenCalledTimes(1)
  const [cmd, args, opts] = spawnSpy.mock.calls[0]
  expect(cmd).toMatch(/python3?/)
  expect(args).toEqual(['server.py'])
  expect(opts.env.BACKEND_PORT).toBe('8299')
  expect(opts.env.PYTHONUNBUFFERED).toBe('1')
  expect(bridge.isRunning()).toBe(true)
  expect(bridge.currentPort()).toBe(8299)
})

test('startPythonBackend 健康检查轮询：前 2 次失败第 3 次成功', async () => {
  mockHealthGetError()
  mockHealthGetError()
  mockHealthGet(true)
  await bridge.startPythonBackend()
  expect(httpGetSpy).toHaveBeenCalledTimes(3)
  expect(bridge.isRunning()).toBe(true)
})

test('startPythonBackend 并发调用只启动一个 Python 进程', async () => {
  mockHealthGetAlways(true)
  const first = bridge.startPythonBackend()
  const second = bridge.startPythonBackend()

  await Promise.all([first, second])

  expect(spawnSpy).toHaveBeenCalledTimes(1)
  expect(bridge.isRunning()).toBe(true)
})

test('启动尚未完成时 stopPythonBackend 等待启动收敛并回收后端', async () => {
  let releaseSpawn
  const spawnGate = new Promise((resolve) => { releaseSpawn = resolve })
  spawnSpy.mockImplementationOnce(() => {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 12349
    proc.kill = vi.fn((sig) => {
      setImmediate(() => proc.emit('exit', 0, null))
    })
    spawnedProcesses.push(proc)
    // 让 startPythonBackend 暂停在 launchProcess 的 spawn 事件之前；
    // 这正是关闭流程最容易与冷启动交叉的窗口。
    spawnGate.then(() => proc.emit('spawn'))
    return proc
  })
  mockHealthGetAlways(true)

  const start = bridge.startPythonBackend()
  start.catch(() => {})
  const stop = bridge.stopPythonBackend()

  releaseSpawn()
  await expect(start).rejects.toThrow('start cancelled')
  await expect(stop).resolves.toBeUndefined()
  expect(bridge.isRunning()).toBe(false)
  if (process.platform === 'win32') {
    expect(spawnSyncSpy).toHaveBeenCalledWith('taskkill', ['/PID', '12349', '/F', '/T'], { timeout: 5000 })
  } else {
    expect(spawnedProcesses[0].kill).toHaveBeenCalledWith('SIGKILL')
  }
})

test('startPythonBackend 后端晚于 10 秒就绪时接管同一进程', async () => {
  vi.useFakeTimers()
  // 第 25 次检查约在 12.5s 才成功，严格超过旧的 10s 上限，
  // 但仍在当前 30s 启动预算内。
  mockHealthGetAfterAttempts(24)
  const start = bridge.startPythonBackend()
  start.catch(() => {})

  await vi.advanceTimersByTimeAsync(13000)
  await vi.runAllTicks()
  await expect(start).resolves.toBeUndefined()

  expect(spawnSpy).toHaveBeenCalledTimes(1)
  expect(bridge.isRunning()).toBe(true)
  expect(spawnSyncSpy).not.toHaveBeenCalled()
})

test('startPythonBackend 启动期崩溃只尝试一次且拒绝，不触发自动重启', async () => {
  spawnSpy.mockImplementationOnce(() => createCrashingProc())
  const start = bridge.startPythonBackend()
  await expect(start).rejects.toThrow('process exited before becoming healthy')

  expect(spawnSpy).toHaveBeenCalledTimes(1)
  expect(bridge.isRunning()).toBe(false)

  // 若 exit 处理器错误地安排了重启，推进重启延迟会再次 spawn。
  await new Promise(resolve => setTimeout(resolve, 2500))
  expect(spawnSpy).toHaveBeenCalledTimes(1)
})

test('startPythonBackend 仅端口占用（spawn 层失败）时回退到下一个端口', async () => {
  spawnSpy
    .mockImplementationOnce(() => {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      proc.pid = 12350
      proc.kill = vi.fn()
      // spawn 层失败：child_process 'error' 事件携带 EADDRINUSE，例如
      // 启动器无法完成 spawn 时的端口冲突。真实后端若端口被占，通常
      // 表现为子进程启动后 bind 失败并以非零码退出（exit 路径），不会
      // 走到这里；该退出路径由下方“真实端口占用走 exit”测试覆盖。
      setImmediate(() => proc.emit('error', new Error('EADDRINUSE: port is already in use')))
      spawnedProcesses.push(proc)
      return proc
    })
    .mockImplementationOnce(() => {
      const proc = createFakeProc(12351)
      spawnedProcesses.push(proc)
      return proc
    })
  mockHealthGet(true)

  await bridge.startPythonBackend()

  expect(spawnSpy).toHaveBeenCalledTimes(2)
  expect(spawnSpy.mock.calls[0][2].env.BACKEND_PORT).toBe('8299')
  expect(spawnSpy.mock.calls[1][2].env.BACKEND_PORT).toBe('8300')
  expect(bridge.currentPort()).toBe(8300)
  expect(bridge.isRunning()).toBe(true)
})

test('startPythonBackend 真实端口占用（子进程 exit）时不回退、拒绝且不静默继续', async () => {
  // 真实场景：Python 进程成功 spawn 后因端口被占 bind 失败并以非零码退出；
  // 走 launchProcess 的 exit → waitForHealthy onExit 路径，而不是 PORT_IN_USE 回退。
  spawnSpy.mockImplementationOnce(() => {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.pid = 12352
    proc.kill = vi.fn()
    // 先 spawn（Promise resolve），随后立即以非零码退出（bind 失败）。
    setImmediate(() => proc.emit('spawn'))
    setImmediate(() => proc.emit('exit', 1, null))
    spawnedProcesses.push(proc)
    return proc
  })
  mockHealthGet(true)

  const start = bridge.startPythonBackend()
  await expect(start).rejects.toThrow('process exited before becoming healthy')

  // 不回退到 8300：真实端口占用不是 spawn 层失败，PORT_FALLBACK 不适用。
  expect(spawnSpy).toHaveBeenCalledTimes(1)
  expect(bridge.isRunning()).toBe(false)
})

test('Python 进程在 spawn 前退出时立即拒绝并清理启动等待', async () => {
  spawnSpy.mockImplementationOnce(() => createExitBeforeSpawnProc())
  const start = bridge.startPythonBackend()

  await expect(start).rejects.toThrow('exited before spawn')
  expect(spawnSpy).toHaveBeenCalledTimes(1)

  // 若 spawn 超时计时器未清理，此处会在 30 秒后再次触发回收；
  // 短暂等待即可确认没有第二次启动。
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(spawnSpy).toHaveBeenCalledTimes(1)
})

test('requestBackend 在启动中等待同一个启动 Promise', async () => {
  mockHealthGetAfterAttempts(1)
  const start = bridge.startPythonBackend()
  const request = bridge.requestBackend('GET', '/api/accounts')

  // requestBackend 必须等健康检查完成；此时尚未发出业务 HTTP 请求。
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(httpRequestSpy).not.toHaveBeenCalled()

  httpRequestSpy.mockImplementationOnce((opts, cb) => {
    const res = new EventEmitter()
    res.statusCode = 200
    setImmediate(() => {
      if (cb) cb(res)
      res.emit('data', JSON.stringify({ code: 0, data: [] }))
      res.emit('end')
    })
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    return req
  })

  await expect(start).resolves.toBeUndefined()
  await expect(request).resolves.toEqual({ code: 0, data: [] })
  expect(httpRequestSpy).toHaveBeenCalledTimes(1)
})

test('startPythonBackend 健康检查超时抛错（fake timers）', async () => {
  vi.useFakeTimers()
  // 持续返回 error，永不健康
  httpGetSpy.mockImplementation(() => {
    const req = new EventEmitter()
    setImmediate(() => req.emit('error', new Error('ECONNREFUSED')))
    return req
  })
  const p = bridge.startPythonBackend()
  // 预先附 handler，避免 reject 在 advanceTimersByTimeAsync 期间触发时
  // 被判为 unhandled rejection（Vitest 会把 Node 的 unhandledRejection 事件
  // 当作测试错误）
  p.catch(() => {})
  // 推进 fake timers 超过启动就绪总预算（当前实现为 30s）
  await vi.advanceTimersByTimeAsync(31000)
  await expect(p).rejects.toThrow('health check timed out')
  expect(bridge.isRunning()).toBe(false)
  expect(spawnedProcesses).toHaveLength(1)
  if (process.platform === 'win32') {
    expect(spawnSyncSpy).toHaveBeenCalledTimes(1)
  } else {
    expect(spawnedProcesses[0].kill).toHaveBeenCalledWith('SIGKILL')
  }
})

test('requestBackend 转发：调用 http.request 时参数正确，返回解析 JSON', async () => {
  mockHealthGet(true)
  await bridge.startPythonBackend()
  httpGetSpy.mockClear()

  httpRequestSpy.mockImplementationOnce((opts, cb) => {
    const res = new EventEmitter()
    res.statusCode = 200
    setImmediate(() => {
      if (cb) cb(res)
      res.emit('data', JSON.stringify({ platforms: ['douyin'] }))
      res.emit('end')
    })
    const req = new EventEmitter()
    req.write = vi.fn()
    req.end = vi.fn()
    return req
  })

  const result = await bridge.requestBackend('POST', '/api/accounts', { name: 'test' })
  expect(httpRequestSpy).toHaveBeenCalledTimes(1)
  const [opts] = httpRequestSpy.mock.calls[0]
  expect(opts.hostname).toBe('127.0.0.1')
  expect(opts.port).toBe(8299)
  expect(opts.path).toBe('/api/accounts')
  expect(opts.method).toBe('POST')
  expect(result).toEqual({ platforms: ['douyin'] })
})

test('requestBackend 自动透传当前 Logto access token', async () => {
  mockHealthGet(true)
  await bridge.startPythonBackend()
  bridge.setAuthService({ getAccessToken: vi.fn(async () => 'access-token-1') })
  httpRequestSpy.mockImplementationOnce((opts, cb) => {
    const res = new EventEmitter()
    res.statusCode = 200
    setImmediate(() => { cb(res); res.emit('data', JSON.stringify({ code: 0 })); res.emit('end') })
    const req = new EventEmitter(); req.write = vi.fn(); req.end = vi.fn(); return req
  })

  await expect(bridge.requestBackend('GET', '/api/accounts')).resolves.toEqual({ code: 0 })
  const [opts] = httpRequestSpy.mock.calls[0]
  expect(opts.headers.Authorization).toBe('Bearer access-token-1')
})

test('requestBackend 收到一次 401 时强制刷新并只重放一次', async () => {
  mockHealthGet(true)
  await bridge.startPythonBackend()
  const getAccessToken = vi.fn()
    .mockResolvedValueOnce('stale-token')
    .mockResolvedValueOnce('fresh-token')
  bridge.setAuthService({ getAccessToken })
  httpRequestSpy
    .mockImplementationOnce((opts, cb) => {
      const res = new EventEmitter(); res.statusCode = 401
      setImmediate(() => { cb(res); res.emit('data', JSON.stringify({ detail: 'AUTH_TOKEN_EXPIRED' })); res.emit('end') })
      const req = new EventEmitter(); req.write = vi.fn(); req.end = vi.fn(); return req
    })
    .mockImplementationOnce((opts, cb) => {
      const res = new EventEmitter(); res.statusCode = 200
      setImmediate(() => { cb(res); res.emit('data', JSON.stringify({ code: 0, retried: true })); res.emit('end') })
      const req = new EventEmitter(); req.write = vi.fn(); req.end = vi.fn(); return req
    })

  await expect(bridge.requestBackend('GET', '/api/accounts')).resolves.toEqual({ code: 0, retried: true })
  expect(httpRequestSpy).toHaveBeenCalledTimes(2)
  expect(httpRequestSpy.mock.calls[0][0].headers.Authorization).toBe('Bearer stale-token')
  expect(httpRequestSpy.mock.calls[1][0].headers.Authorization).toBe('Bearer fresh-token')
  expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
})

test('requestBackend 未运行时立即拒绝，不发起 http 请求', async () => {
  await expect(bridge.requestBackend('GET', '/api/health')).rejects.toThrow('not running')
  expect(httpRequestSpy).not.toHaveBeenCalled()
})

test('stopPythonBackend 在未运行时直接返回不抛错', async () => {
  // 不 startPythonBackend，直接 stop，验证不抛错且 isRunning 保持 false
  await expect(bridge.stopPythonBackend()).resolves.toBeUndefined()
  expect(bridge.isRunning()).toBe(false)
})

test('startPythonBackend 把身份运行时配置注入 Python 后端子进程 env', async () => {
  identityRuntimeMock.loadIdentityRuntimeEnv.mockReturnValue({
    IDENTITY_AUTH_ENABLED: 'true',
    IDENTITY_AUTH_REQUIRED: 'false',
    LOGTO_ENDPOINT: 'https://auth.iart.work',
    LOGTO_API_RESOURCE: 'https://api.multi-publish.com',
    LOGTO_APP_ID: 'should-not-leak',
  })
  mockHealthGet(true)
  await bridge.startPythonBackend()
  const [,, opts] = spawnSpy.mock.calls[0]
  expect(opts.env.IDENTITY_AUTH_ENABLED).toBe('true')
  expect(opts.env.IDENTITY_AUTH_REQUIRED).toBe('false')
  expect(opts.env.LOGTO_ENDPOINT).toBe('https://auth.iart.work')
  expect(opts.env.LOGTO_API_RESOURCE).toBe('https://api.multi-publish.com')
  // 只注入 Python 后端需要的键，避免无关身份字段泄漏到子进程
  expect(opts.env.LOGTO_APP_ID).toBeUndefined()
  // 身份配置加载失败时不应阻断后端启动（容错）
  identityRuntimeMock.loadIdentityRuntimeEnv.mockReset()
  identityRuntimeMock.loadIdentityRuntimeEnv.mockImplementation(() => { throw new Error('IDENTITY_CONFIG_INVALID') })
  await bridge.stopPythonBackend()
  mockHealthGet(true)
  await bridge.startPythonBackend()
  const [,, opts2] = spawnSpy.mock.calls[spawnSpy.mock.calls.length - 1]
  expect(opts2.env.IDENTITY_AUTH_ENABLED).toBeUndefined()
  expect(bridge.isRunning()).toBe(true)
})
