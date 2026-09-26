// @ts-check
/**
 * account-manager — 登录态单向证据规则（loginStatusTransition）回归
 * （openspec/changes/fix-login-state-oscillation）
 *
 * 缺陷背景：`expired` 早已是粘滞态（login-status-monitor.js:75 明确不擅自翻案），
 * 但 `active` 没有任何对等保护 —— 检测链路的 7 个「无定论」出口 + IPC 层的
 * `checkError` 分支都会把既有正向结论抹成 `unverified`，而监控的判据是
 * `next !== current` 就回写，于是 active ↔ unverified 每 30 分钟来回一次。
 * 根因：「没有拿到新证据」被当成了「拿到反证」。
 *
 * 契约（与 openspec spec delta 一一对应）：
 *   1) valid === true  → 'active'
 *   2) valid === false → 'expired'
 *   3) 无定论 / 检测异常 + 现状 expired → null（不改写）
 *   4) 无定论 + 现状 active 且最近定论在宽限期内 → null（不改写）
 *   5) 无定论 + 现状 active 但超龄 / 定论时间缺失或非法 → 'unverified'（防僵尸绿灯）
 *   6) 无定论 + 现状缺失或已是 unverified → 'unverified'（从未有结论仍诚实）
 * 返回 null 是显式的「本轮不改写真源」语义，不得用 'unverified' 兼职表达。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const modulePath = './account-manager'

function loadAccountManager() {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-26T00:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()

const INCONCLUSIVE = { valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
const OK = { valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' }
const DEAD = { valid: false, code: 'CHECK_LOGIN_EXPIRED' }

describe('loginStatusTransition — 登录态只被正/负证据改写', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    delete process.env.MP_LOGIN_STATE_GRACE_DAYS
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.MP_LOGIN_STATE_GRACE_DAYS
  })

  it('规则 1/2：明确结论一律改写，且不受现状与定论时间影响', () => {
    const { loginStatusTransition } = loadAccountManager()
    expect(loginStatusTransition({ result: OK, currentStatus: 'expired', lastValidated: iso(NOW - 999 * DAY), nowMs: NOW }))
      .toBe('active')
    expect(loginStatusTransition({ result: DEAD, currentStatus: 'active', lastValidated: iso(NOW), nowMs: NOW }))
      .toBe('expired')
    // 超龄账号一旦拿到正向证据即恢复 active，不得被宽限期逻辑拦住
    expect(loginStatusTransition({ result: OK, currentStatus: 'active', lastValidated: undefined, nowMs: NOW }))
      .toBe('active')
  })

  it('规则 3：无定论不得把 expired 翻案（与监控既有粘滞一致）', () => {
    const { loginStatusTransition } = loadAccountManager()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'expired', lastValidated: iso(NOW - DAY), nowMs: NOW }))
      .toBeNull()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'expired', lastValidated: undefined, nowMs: NOW }))
      .toBeNull()
    // 检测自身抛异常同属「无证据」，与无定论同权
    expect(loginStatusTransition({ result: null, checkError: 'timeout', currentStatus: 'expired', lastValidated: iso(NOW - DAY), nowMs: NOW }))
      .toBeNull()
  })

  it('规则 4：无定论 + active 在宽限期内保持原状', () => {
    const { loginStatusTransition } = loadAccountManager()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW - 6 * DAY), nowMs: NOW }))
      .toBeNull()
    // 边界：恰好等于宽限期不算超龄（> 才降级）
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW - 7 * DAY), nowMs: NOW }))
      .toBeNull()
  })

  it('规则 5：无定论 + active 超龄则降级，防僵尸绿灯', () => {
    const { loginStatusTransition } = loadAccountManager()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW - 8 * DAY), nowMs: NOW }))
      .toBe('unverified')
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: undefined, nowMs: NOW }))
      .toBe('unverified')
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: '不是时间戳', nowMs: NOW }))
      .toBe('unverified')
  })

  it('规则 6：从未有结论时仍诚实落到 unverified', () => {
    const { loginStatusTransition } = loadAccountManager()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: undefined, nowMs: NOW })).toBe('unverified')
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'unverified', lastValidated: iso(NOW), nowMs: NOW })).toBe('unverified')
    // 历史脏值（如 inactive/offline）不得被当作「已有结论」而保持
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'inactive', lastValidated: iso(NOW), nowMs: NOW })).toBe('unverified')
  })

  it('宽限期可配置；非法值回落默认 7 天（不得出现零宽限或永不降级）', () => {
    const { loginStatusTransition } = loadAccountManager()
    const at20Days = { result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW - 20 * DAY), nowMs: NOW }
    process.env.MP_LOGIN_STATE_GRACE_DAYS = '30'
    expect(loginStatusTransition(at20Days)).toBeNull()
    process.env.MP_LOGIN_STATE_GRACE_DAYS = '1'
    expect(loginStatusTransition(at20Days)).toBe('unverified')
    for (const bad of ['0', '-5', 'abc', '']) {
      process.env.MP_LOGIN_STATE_GRACE_DAYS = bad
      expect(loginStatusTransition({ ...at20Days, lastValidated: iso(NOW - 6 * DAY) })).toBeNull()
    }
  })

  it('纯函数：不得读全局时钟以外的状态，也不得发起 I/O', () => {
    const accountManager = loadAccountManager()
    const pythonBridge = require('../services/python-bridge')
    const spy = vi.spyOn(pythonBridge, 'requestBackend')
    accountManager.loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW), nowMs: NOW })
    accountManager.loginStatusTransition({ result: OK, currentStatus: 'active', nowMs: NOW })
    expect(spy, '判定函数不得打后端').not.toHaveBeenCalled()
  })
})
