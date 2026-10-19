// @vitest-environment node
// enforce-gate 单元测试（forced-update-gate，2026-10-19）。
// 覆盖：evaluate 纯函数状态机、72h 宽限期时间边界、持久化原子写、窗口管理层注入、dispose 清理。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeDeps (overrides = {}) {
  const windows = []
  let nowMs = 1_700_000_000_000
  let monoMs = 1000.0
  let mainHidden = false
  let written = null
  const stateFile = join(mkdtempSync(join(tmpdir(), 'enforce-gate-')), 'enforce-gate-state.json')

  const deps = {
    appVersion: () => '0.2.0',
    now: () => nowMs,
    monotonicMs: () => monoMs,
    stateFile,
    locale: 'zh-CN',
    gatePreloadPath: 'fake-preload.js',
    // 文件读写（默认真实落盘，断言缓存内容；用例可覆写）
    readStateFile: (p) => readFileSync(p, 'utf-8'),
    writeStateFileAtomic: (p, state) => { written = { p, state }; writeFileSync(p, JSON.stringify(state)) },
    removeStateFile: (p) => { written = null; try { rmSync(p) } catch { /* absent */ } },
    // 窗口/主窗管理（QM-6 i1：程序化关闭走 __closeProgrammatically → destroy）
    createGateWindow: (opts) => {
      const win = {
        opts,
        isDestroyed: () => false,
        on: vi.fn(),
        once: vi.fn(),
        loadFile: vi.fn(async () => {}),
        show: vi.fn(),
        focus: vi.fn(),
        close: vi.fn(),
        destroy: vi.fn(),
        __closeProgrammatically: vi.fn(function () { this.destroy() }),
        webContents: { send: vi.fn() },
      }
      windows.push(win)
      return win
    },
    loadGatePage: vi.fn(async (win) => { await win.loadFile('gate.html') }),
    hideMainWindow: vi.fn(() => { mainHidden = true }),
    showMainWindow: vi.fn(() => { mainHidden = false }),
    wasMainWindowHidden: () => mainHidden,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    installNow: vi.fn(),
    syncNow: vi.fn(),
    setInterval: vi.fn(() => ({ unref: vi.fn(), clear: vi.fn() })),
    ...overrides,
  }
  return { deps, windows, stateFile, advance: (ms) => { nowMs += ms; monoMs += ms } }
}

function makeGate () {
  // 每个用例单独 import（隔离单例状态）
  return import('./enforce-gate.js')
}

describe('evaluate 状态机（纯函数语义）', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('policy 缺失 → pass', async () => {
    const { deps, advance } = makeDeps()
    const gate = await makeGate()
    const r = gate.evaluateForTest(deps, null, deps.now())
    expect(r.status).toBe('pass')
  })

  it('enforce_enabled 非 true → pass；成功拉取无条件缓存（关闭策略也缓存，断网宽限时判定为 pass）', async () => {
    const { deps, stateFile, advance } = makeDeps()
    const gate = await makeGate()
    // evaluate 本身是纯函数：关闭策略 → pass（不碰文件）
    const r = gate.evaluateForTest(deps, { enforce_enabled: false, enforce_min_version: '0.2.0' }, deps.now())
    expect(r.status).toBe('pass')
    // 成功拉取 → 无条件缓存（缓存 disabled 策略 = "最后已知真相"；应急关闸后断网用户仍判 pass）
    await gate.onSyncOutcomeForTest(deps, { ok: true, policy: { enforce_enabled: false } })
    expect(existsSync(stateFile)).toBe(true)
    // 宽限期内（71h < 72h）断网 → 沿用缓存（disabled）→ pass，不会 verify-failed
    advance(71 * 3600 * 1000)
    const r2 = await gate.onSyncOutcomeForTest(deps, { ok: false })
    expect(r2.status).toBe('pass')
  })

  it('版本达标（等于阻断线）→ pass', async () => {
    const { deps, advance } = makeDeps()
    const gate = await makeGate()
    const r = gate.evaluateForTest(deps, { enforce_enabled: true, enforce_min_version: '0.2.0' }, deps.now())
    expect(r.status).toBe('pass')
  })

  it('版本达标（0.2 == 0.2.0 短段补零）→ pass', async () => {
    const { deps } = makeDeps({ appVersion: () => '0.2' })
    const gate = await makeGate()
    const r = gate.evaluateForTest(deps, { enforce_enabled: true, enforce_min_version: '0.2.0' }, deps.now())
    expect(r.status).toBe('pass')
  })

  it('版本低于阻断线 → blocking，目标版本取 force_version', async () => {
    const { deps, advance } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    const r = gate.evaluateForTest(deps, { enforce_enabled: true, enforce_min_version: '0.2.0', force_version: '0.3.0' }, deps.now())
    expect(r.status).toBe('blocking')
    expect(r.target).toBe('0.3.0')
  })

  it('无 force_version 时目标版本回落 enforce_min_version', async () => {
    const { deps, advance } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    const r = gate.evaluateForTest(deps, { enforce_enabled: true, enforce_min_version: '0.2.0' }, deps.now())
    expect(r.status).toBe('blocking')
    expect(r.target).toBe('0.2.0')
  })

  it('force_version 不高于当前版本时回落 enforce_min_version', async () => {
    const { deps, advance } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    const r = gate.evaluateForTest(deps, { enforce_enabled: true, enforce_min_version: '0.2.0', force_version: '0.1.0' }, deps.now())
    expect(r.status).toBe('blocking')
    expect(r.target).toBe('0.2.0')
  })

  it('enforce_min_version 非法（坏版本串）→ fail-open pass + 不落缓存', async () => {
    const { deps, advance } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    const r = gate.evaluateForTest(deps, { enforce_enabled: true, enforce_min_version: 'abc' }, deps.now())
    expect(r.status).toBe('pass')
  })
})

describe('72h 宽限期（onSyncOutcome）', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('同步成功 → 缓存落盘（含 policy/fetchedAt/monotonicRefMs）', async () => {
    const { deps, stateFile } = makeDeps()
    const gate = await makeGate()
    await gate.onSyncOutcomeForTest(deps, { ok: true, policy: { enforce_enabled: false } })
    const saved = JSON.parse(readFileSync(stateFile, 'utf-8'))
    expect(saved.policy.enforce_enabled).toBe(false)
    expect(saved.fetchedAt).toBeTruthy()
    expect(typeof saved.monotonicRefMs).toBe('number')
  })

  it('同步失败 + 缓存 71.9h → 沿用缓存 policy 判定（宽限内）', async () => {
    const { deps, advance } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    await gate.onSyncOutcomeForTest(deps, { ok: true, policy: { enforce_enabled: true, enforce_min_version: '0.2.0' } })
    advance(71.9 * 3600 * 1000)
    const r = await gate.onSyncOutcomeForTest(deps, { ok: false })
    expect(r.status).toBe('blocking') // 缓存 policy 判定为 blocking（阻断不受宽限缓解）
  })

  it('同步失败 + 缓存中 policy 达标 + 71.9h → 宽限放行', async () => {
    const { deps, advance } = makeDeps()
    const gate = await makeGate()
    await gate.onSyncOutcomeForTest(deps, { ok: true, policy: { enforce_enabled: false } })
    advance(71.9 * 3600 * 1000)
    const r = await gate.onSyncOutcomeForTest(deps, { ok: false })
    expect(r.status).toBe('pass')
  })

  it('同步失败 + 缓存达标 + 72.1h（超宽限）→ verify-failed', async () => {
    const { deps, advance } = makeDeps()
    const gate = await makeGate()
    await gate.onSyncOutcomeForTest(deps, { ok: true, policy: { enforce_enabled: false } })
    advance(72.1 * 3600 * 1000)
    const r = await gate.onSyncOutcomeForTest(deps, { ok: false })
    expect(r.status).toBe('verify-failed')
  })

  it('同步失败 + 无缓存 → verify-failed', async () => {
    const { deps, advance } = makeDeps()
    const gate = await makeGate()
    const r = await gate.onSyncOutcomeForTest(deps, { ok: false })
    expect(r.status).toBe('verify-failed')
  })

  it('时钟回拨 >24h（墙钟早于缓存 fetchedAt）→ 按缓存宽限判定 + WARN', async () => {
    const { deps, advance } = makeDeps()
    const gate = await makeGate()
    await gate.onSyncOutcomeForTest(deps, { ok: true, policy: { enforce_enabled: false } })
    // 回拨：现在比 fetchedAt 还早 25h
    advance(-25 * 3600 * 1000)
    const r = await gate.onSyncOutcomeForTest(deps, { ok: false })
    expect(r.status).toBe('pass')
    expect(deps.log.warn).toHaveBeenCalled()
  })
})

describe('窗口管理层（依赖注入）', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('blocking → 创建窗口 + 隐藏主窗口；重复判定幂等不重建', async () => {
    const { deps, windows } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    gate.applyDecisionForTest(deps, { status: 'blocking', current: '0.1.0', target: '0.2.0' })
    expect(windows).toHaveLength(1)
    expect(deps.hideMainWindow).toHaveBeenCalledOnce()
    gate.applyDecisionForTest(deps, { status: 'blocking', current: '0.1.0', target: '0.2.0' })
    expect(windows).toHaveLength(1) // 幂等
  })

  it('gate 窗口创建参数：无边框/置顶/不可关/带 preload', async () => {
    const { deps, windows } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    gate.applyDecisionForTest(deps, { status: 'blocking', current: '0.1.0', target: '0.2.0' })
    const opts = windows[0].opts
    expect(opts.frame).toBe(false)
    expect(opts.alwaysOnTop).toBe(true)
    expect(opts.closable).toBe(false)
    expect(opts.skipTaskbar).toBe(false)
    expect(opts.webPreferences.contextIsolation).toBe(true)
    expect(opts.webPreferences.nodeIntegration).toBe(false)
    expect(opts.webPreferences.preload).toBeTruthy()
  })

  it('pass 后关闭窗口并恢复主窗口', async () => {
    const { deps, windows } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    gate.applyDecisionForTest(deps, { status: 'blocking', current: '0.1.0', target: '0.2.0' })
    gate.applyDecisionForTest(deps, { status: 'pass' })
    expect(windows[0].destroy).toHaveBeenCalled()
    expect(deps.showMainWindow).toHaveBeenCalledOnce()
  })

  it('verify-failed → 复用同一窗口切换验证失败视图', async () => {
    const { deps, windows } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    gate.applyDecisionForTest(deps, { status: 'verify-failed' })
    expect(windows).toHaveLength(1)
    gate.applyDecisionForTest(deps, { status: 'blocking', current: '0.1.0', target: '0.2.0' })
    expect(windows).toHaveLength(1) // 不重建，切换视图
    expect(windows[0].webContents.send).toHaveBeenCalled()
  })

  it('dispose 清理：关窗口 + 恢复主窗口 + 二次 dispose 幂等', async () => {
    const { deps, windows } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    gate.applyDecisionForTest(deps, { status: 'blocking', current: '0.1.0', target: '0.2.0' })
    gate.disposeForTest(deps)
    expect(windows[0].destroy).toHaveBeenCalled()
    expect(deps.showMainWindow).toHaveBeenCalled()
    gate.disposeForTest(deps) // 幂等
    expect(deps.showMainWindow).toHaveBeenCalledOnce()
  })

  it('窗口 close 事件被拦截（closable=false 语义在 handler 层兑现）', async () => {
    const { deps, windows } = makeDeps({ appVersion: () => '0.1.0' })
    const gate = await makeGate()
    gate.applyDecisionForTest(deps, { status: 'blocking', current: '0.1.0', target: '0.2.0' })
    // 注册过 close 拦截 handler
    const closeHandler = windows[0].on.mock.calls.find(([evt]) => evt === 'close')
    expect(closeHandler).toBeTruthy()
  })
})

