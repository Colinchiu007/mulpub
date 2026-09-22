// @ts-check
/**
 * pipeline:confirm-stage-gate 成本确认门 IPC 契约测试（tasks 5.2 前置 / specs「成本确认检查点」/ D6）
 *
 * 合同：
 *   - 非受信 sender 拒绝（withSenderCheck）；
 *   - runId 非法 → VALIDATION_ERROR（含字段名），引擎零调用；
 *   - contextPatch 非对象（数组/字符串/数字）→ VALIDATION_ERROR，引擎零调用；
 *   - contextPatch 缺省（取消路径）→ 允许透传，引擎收到 undefined；
 *   - 引擎返回 {success:false,...}（如 NOT_AT_CONFIRMATION_GATE）→ 原样透出，不改写语义；
 *   - 引擎抛错 → REQUEST_ERROR。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../services/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

__enableElectronMock()

let registerHandlers
let originalNodeEnv
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  originalNodeEnv = process.env.NODE_ENV
  originalIsPackaged = __electronMock.app.isPackaged
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const mod = await import('./pipeline')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  __electronMock.app.isPackaged = originalIsPackaged
})

const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

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
    pipelineEngine: {
      confirmStageGate: vi.fn(async () => ({ success: true, runId: 'run-1' })),
      ...overrides,
    },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

describe('pipeline:confirm-stage-gate IPC', () => {
  it('通道已注册', () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    expect(ipcMain._get('pipeline:confirm-stage-gate')).toBeTypeOf('function')
  })

  it('非受信 sender 拒绝，引擎零调用', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('pipeline:confirm-stage-gate')(UNTRUSTED_EVENT, 'run-1', {})
    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(deps.pipelineEngine.confirmStageGate).not.toHaveBeenCalled()
  })

  it('空 runId → VALIDATION_ERROR（含字段名），引擎零调用', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('pipeline:confirm-stage-gate')(TRUSTED_EVENT, '  ', {})
    expect(result.code).toBe(-2)
    expect(result.message).toMatch(/runId/)
    expect(deps.pipelineEngine.confirmStageGate).not.toHaveBeenCalled()
  })

  it('contextPatch 为数组/字符串 → VALIDATION_ERROR，引擎零调用', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const bad1 = await ipcMain._get('pipeline:confirm-stage-gate')(TRUSTED_EVENT, 'run-1', ['a'])
    expect(bad1.code).toBe(-2)
    const bad2 = await ipcMain._get('pipeline:confirm-stage-gate')(TRUSTED_EVENT, 'run-1', 'patch')
    expect(bad2.code).toBe(-2)
    expect(deps.pipelineEngine.confirmStageGate).not.toHaveBeenCalled()
  })

  it('contextPatch 缺省（取消路径）→ 透传 undefined 给引擎', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('pipeline:confirm-stage-gate')(TRUSTED_EVENT, 'run-1')
    expect(result.code).toBe(0)
    expect(deps.pipelineEngine.confirmStageGate).toHaveBeenCalledTimes(1)
    expect(deps.pipelineEngine.confirmStageGate.mock.calls[0][1]).toBeUndefined()
  })

  it('合法确认：patch 透传引擎，成功结果原样返回', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const patch = { filmVideoChoices: { aspect: '16x9', seconds: 5 } }
    const result = await ipcMain._get('pipeline:confirm-stage-gate')(TRUSTED_EVENT, 'run-1', patch)
    expect(result.code).toBe(0)
    expect(deps.pipelineEngine.confirmStageGate).toHaveBeenCalledWith('run-1', patch)
    expect(result.data.success).toBe(true)
  })

  it('引擎返回 success:false（不在确认门）→ 原样透出 errorCode', async () => {
    const deps = createMockDeps({
      confirmStageGate: vi.fn(async () => ({ success: false, error: '当前流水线不处于等待确认的检查点', errorCode: 'NOT_AT_CONFIRMATION_GATE' })),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('pipeline:confirm-stage-gate')(TRUSTED_EVENT, 'run-1', {})
    expect(result.code).toBe(0)
    expect(result.data.success).toBe(false)
    expect(result.data.errorCode).toBe('NOT_AT_CONFIRMATION_GATE')
  })

  it('引擎抛错 → REQUEST_ERROR', async () => {
    const deps = createMockDeps({
      confirmStageGate: vi.fn(async () => { throw new Error('boom') }),
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('pipeline:confirm-stage-gate')(TRUSTED_EVENT, 'run-1', {})
    expect(result.code).toBe(-1)
    expect(result.message).toMatch(/boom/)
  })
})
