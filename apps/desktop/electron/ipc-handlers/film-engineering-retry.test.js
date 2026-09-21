// @ts-check
'use strict'
/**
 * film-engineering:retry-shot 单镜重试 IPC 契约测试（tasks 4.1 / specs「失败分镜单镜重试」+ IPC 校验合同 / D7）
 *
 * 合同：
 *   - 非受信 sender 拒绝（withSenderCheck）；
 *   - runId / shotIndex 非法或不属于该 run → 带字段名校验错误，零 provider 调用；
 *   - provider 未配置 → VIDEO_MODEL_NOT_CONFIGURED，零 provider 调用；
 *   - 合法重试以原文直送合同重提单镜 → 覆盖 shot_NNN.mp4，且不迁移流水线阶段状态机。
 *
 * seam：deps._testSleep / deps._testDownload 注入（与 video-gen executor 同构），
 * 生产 deps 不传 → generateShotVideo 走真实 10s 轮询 + 真实下载（下载真实路径由集成测试 2.2 覆盖）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../services/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

__enableElectronMock()

let registerHandlers

beforeEach(async () => {
  vi.resetModules()
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const mod = await import('./film-engineering')
  registerHandlers = mod.default || mod
})

const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

function createMockIpcMain () {
  const handlers = {}
  return { handle: vi.fn((channel, fn) => { handlers[channel] = fn }), _get: (c) => handlers[c] }
}

const STORED_PROMPT = '第三镜原文提示词 <<<uuid:abc-123>>> 保持逐字符直送'

function makeManagerStub (overrides = {}) {
  const callAdapter = vi.fn(async (_pid, method) => {
    if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-77' } }
    if (method === 'getVideoStatus') return { code: 0, data: { status: 'succeeded', videoUrl: 'http://example.invalid/v.mp4' } }
    return { code: 0, data: {} }
  })
  return {
    getDefault: vi.fn(() => ({ id: 'vid-prov', models: ['m'], capability_models: { video: 'm' } })),
    getProvider: vi.fn(() => ({ id: 'vid-prov' })),
    callAdapter,
    ...overrides,
  }
}

function makeDeps (over = {}) {
  const manager = over.manager || makeManagerStub()
  const tmpRunDir = over.runDir || fs.mkdtempSync(path.join(os.tmpdir(), 'film-retry-'))
  const snap = over.snapshot === undefined
    ? { context: { selectedShots: [{ shotId: 's0', prompt: 'p0' }, { shotId: 's2', prompt: STORED_PROMPT }] } }
    : over.snapshot
  const pipelineEngine = {
    getRunSnapshot: vi.fn(() => snap),
    confirmStageGate: vi.fn(),
    startOrchestrated: vi.fn(),
    advanceRun: vi.fn(),
    resumeOrchestration: vi.fn(),
  }
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    filmEngineeringService: {},
    pipelineEngine,
    aiGenerator: { _modelProviderManager: manager },
    _testSleep: async () => {},
    _testDownload: async (_url, dest) => { fs.writeFileSync(dest, 'FAKE-MP4'); return dest },
    __tmpRunDir: tmpRunDir,
    __manager: manager,
    __pipelineEngine: pipelineEngine,
  }
}

describe('film-engineering:retry-shot 单镜重试 IPC', () => {
  let dirs = []
  afterEach(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } } dirs = [] })

  it('通道已注册', () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, makeDeps())
    expect(ipcMain._get('film-engineering:retry-shot')).toBeTypeOf('function')
  })

  it('非受信 sender 拒绝，零 provider 调用', async () => {
    const deps = makeDeps(); dirs.push(deps.__tmpRunDir)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:retry-shot')(UNTRUSTED_EVENT, { runId: 'r1', shotIndex: 0 })
    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(deps.__manager.callAdapter).not.toHaveBeenCalled()
  })

  it('空 runId → VALIDATION_ERROR（含字段名），零 provider 调用', async () => {
    const deps = makeDeps(); dirs.push(deps.__tmpRunDir)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:retry-shot')(TRUSTED_EVENT, { runId: '  ', shotIndex: 0 })
    expect(result.code).toBe(-2)
    expect(result.message).toMatch(/runId/)
    expect(deps.__manager.callAdapter).not.toHaveBeenCalled()
  })

  it('shotIndex 非整数/负 → VALIDATION_ERROR（含字段名），零 provider 调用', async () => {
    const deps = makeDeps(); dirs.push(deps.__tmpRunDir)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const bad = await ipcMain._get('film-engineering:retry-shot')(TRUSTED_EVENT, { runId: 'r1', shotIndex: 1.5 })
    expect(bad.code).toBe(-2)
    expect(bad.message).toMatch(/shotIndex/)
    expect(deps.__manager.callAdapter).not.toHaveBeenCalled()
  })

  it('runId 不属于任何 run → 校验错误，零 provider 调用', async () => {
    const deps = makeDeps({ snapshot: null }); dirs.push(deps.__tmpRunDir)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:retry-shot')(TRUSTED_EVENT, { runId: 'ghost', shotIndex: 0 })
    expect(result.code).toBe(-2)
    expect(result.message).toMatch(/runId/)
    expect(deps.__manager.callAdapter).not.toHaveBeenCalled()
  })

  it('shotIndex 超出该 run 选中数 → 校验错误（含范围），零 provider 调用', async () => {
    const deps = makeDeps(); dirs.push(deps.__tmpRunDir)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:retry-shot')(TRUSTED_EVENT, { runId: 'r1', shotIndex: 9 })
    expect(result.code).toBe(-2)
    expect(result.message).toMatch(/shotIndex/)
    expect(deps.__manager.callAdapter).not.toHaveBeenCalled()
  })

  it('provider 未配置 → VIDEO_MODEL_NOT_CONFIGURED，零 provider 调用', async () => {
    const manager = makeManagerStub({ getDefault: vi.fn(() => null) })
    const deps = makeDeps({ manager }); dirs.push(deps.__tmpRunDir)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:retry-shot')(TRUSTED_EVENT, { runId: 'r1', shotIndex: 1 })
    expect(result.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
    expect(manager.callAdapter).not.toHaveBeenCalled()
  })

  it('合法重试：原文直送提交 → 覆盖 shot_001.mp4，不迁移流水线阶段状态', async () => {
    const runId = 'r-ok-' + Date.now()
    // handler 落盘到 getFilmRunDir(runId)（os.tmpdir()/film-engineering/<runId>），测试后清理
    dirs.push(path.join(os.tmpdir(), 'film-engineering', runId))
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const result = await ipcMain._get('film-engineering:retry-shot')(TRUSTED_EVENT, { runId, shotIndex: 1, aspect: '16x9', seconds: 5 })
    expect(result.code).toBe(0)
    expect(result.data.success).toBe(true)
    // 原文直送：提交载荷 prompt 与 run 内存储逐字符相等（含 <<<uuid>>> 令牌）
    const gen = deps.__manager.callAdapter.mock.calls.find((c) => c[1] === 'generateVideo')
    expect(gen).toBeTruthy()
    expect(gen[2].prompt).toBe(STORED_PROMPT)
    // 落盘产物（覆盖该镜 shot_001.mp4）
    expect(result.data.path).toMatch(/shot_001\.mp4$/)
    expect(fs.existsSync(result.data.path)).toBe(true)
    // 不迁移流水线阶段状态机
    expect(deps.__pipelineEngine.confirmStageGate).not.toHaveBeenCalled()
    expect(deps.__pipelineEngine.advanceRun).not.toHaveBeenCalled()
    expect(deps.__pipelineEngine.startOrchestrated).not.toHaveBeenCalled()
    expect(deps.__pipelineEngine.resumeOrchestration).not.toHaveBeenCalled()
  })
})
