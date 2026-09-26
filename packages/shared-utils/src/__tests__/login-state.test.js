/**
 * 登录态单向证据规则 —— 规则表在**唯一真源**处直接断言。
 * （openspec/changes/fix-login-state-oscillation；QM-6 双模型评审 I2）
 *
 * 为什么测这一层而不是通过 account-manager 转发：本模块存在的理由就是「一份规则、三处 import」。
 * 此前同一映射被抄成三份（account-manager / ipc-handlers/account.js / login-status-monitor），
 * 任何一处的修正都不会自动传导到另外两处 —— 振荡正是这样活下来的。若在转发层测规则表，
 * 就又把「规则」和「某一次的转发」绑在了一起，等于给第四份映射留了门。
 *
 * 契约：
 *   1) valid === true  → 'active'
 *   2) valid === false → 'expired'
 *   3) 无定论 / 检测异常 + 现状 expired → null（不翻案）
 *   4) 无定论 + 现状 active 且在宽限期内 → null（保持）
 *   5) 无定论 + 现状 active 但超龄 / 定论时间缺失或非法 → 'unverified'（防僵尸绿灯）
 *   6) 无定论 + 现状缺失、已是 unverified 或历史脏值 → 'unverified'（从未有结论仍诚实）
 * 返回 null 是显式的「本轮不改写真源」语义，不得用 'unverified' 兼职表达。
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-26T00:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()

const INCONCLUSIVE = { valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
const OK = { valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' }
const DEAD = { valid: false, code: 'CHECK_LOGIN_EXPIRED' }

const ENV_KEY = 'MP_LOGIN_STATE_GRACE_DAYS'

function loadRule () {
  delete require.cache[require.resolve('../login-state')]
  return require('../login-state')
}

describe('loginStatusTransition — 登录态只被正/负证据改写', () => {
  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('规则 1/2：明确结论一律改写，且不受现状与定论时间影响', () => {
    const { loginStatusTransition } = loadRule()
    expect(loginStatusTransition({ result: OK, currentStatus: 'expired', lastValidated: iso(NOW - 999 * DAY), nowMs: NOW }))
      .toBe('active')
    expect(loginStatusTransition({ result: DEAD, currentStatus: 'active', lastValidated: iso(NOW), nowMs: NOW }))
      .toBe('expired')
    // 超龄账号一旦拿到正向证据即恢复 active，不得被宽限期逻辑拦住
    expect(loginStatusTransition({ result: OK, currentStatus: 'active', lastValidated: undefined, nowMs: NOW }))
      .toBe('active')
  })

  it('规则 3：无定论不得把 expired 翻案（与监控既有粘滞一致）', () => {
    const { loginStatusTransition } = loadRule()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'expired', lastValidated: iso(NOW - DAY), nowMs: NOW }))
      .toBeNull()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'expired', lastValidated: undefined, nowMs: NOW }))
      .toBeNull()
    // 检测自身抛异常（含硬超时）同属「无证据」，与无定论同权
    expect(loginStatusTransition({ result: null, checkError: '检测超时（>60000ms）', currentStatus: 'expired', lastValidated: iso(NOW - DAY), nowMs: NOW }))
      .toBeNull()
  })

  it('规则 4：无定论 + active 在宽限期内保持原状', () => {
    const { loginStatusTransition } = loadRule()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW - 6 * DAY), nowMs: NOW }))
      .toBeNull()
    // 边界：恰好等于宽限期不算超龄（严格 > 才降级）
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW - 7 * DAY), nowMs: NOW }))
      .toBeNull()
  })

  it('规则 5：无定论 + active 超龄则降级，防僵尸绿灯', () => {
    const { loginStatusTransition } = loadRule()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW - 8 * DAY), nowMs: NOW }))
      .toBe('unverified')
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: undefined, nowMs: NOW }))
      .toBe('unverified')
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: '不是时间戳', nowMs: NOW }))
      .toBe('unverified')
  })

  it('规则 6：从未有结论时仍诚实落到 unverified', () => {
    const { loginStatusTransition } = loadRule()
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: undefined, nowMs: NOW })).toBe('unverified')
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'unverified', lastValidated: iso(NOW), nowMs: NOW })).toBe('unverified')
    // 历史脏值（如 inactive/online）不得被当作「已有结论」而保持
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'inactive', lastValidated: iso(NOW), nowMs: NOW })).toBe('unverified')
    expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'online', lastValidated: iso(NOW), nowMs: NOW })).toBe('unverified')
  })

  it('正向/负向证据优先于现状：valid 与 checkError 同时存在时以异常为准（不臆断）', () => {
    const { loginStatusTransition } = loadRule()
    expect(loginStatusTransition({ result: OK, checkError: 'aborted', currentStatus: 'unverified', nowMs: NOW })).toBe('unverified')
  })

  it('宽限期可配置；非法值回落默认 7 天（不得出现零宽限或永不降级）', () => {
    const { loginStatusTransition, DEFAULT_GRACE_DAYS } = loadRule()
    expect(DEFAULT_GRACE_DAYS).toBe(7)
    const at20Days = { result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW - 20 * DAY), nowMs: NOW }
    process.env[ENV_KEY] = '30'
    expect(loginStatusTransition(at20Days)).toBeNull()
    process.env[ENV_KEY] = '1'
    expect(loginStatusTransition(at20Days)).toBe('unverified')
    for (const bad of ['0', '-5', 'abc', '', 'Infinity']) {
      process.env[ENV_KEY] = bad
      expect(loginStatusTransition({ ...at20Days, lastValidated: iso(NOW - 6 * DAY) })).toBeNull()
    }
    // 直接注入 graceMs 时优先于环境变量（调用方显式覆盖）
    expect(loginStatusTransition({ ...at20Days, graceMs: 30 * DAY })).toBeNull()
  })

  it('纯函数：只吃入参与时钟，不做任何 I/O', () => {
    const fs = require('fs')
    const { loginStatusTransition } = loadRule()
    const spies = [
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('规则函数不得读文件') }),
      vi.spyOn(fs, 'existsSync').mockImplementation(() => { throw new Error('规则函数不得探测文件') }),
    ]
    try {
      expect(loginStatusTransition({ result: INCONCLUSIVE, currentStatus: 'active', lastValidated: iso(NOW), nowMs: NOW })).toBeNull()
      expect(loginStatusTransition({ result: OK, currentStatus: 'active', nowMs: NOW })).toBe('active')
      expect(loginStatusTransition({})).toBe('unverified')
    } finally {
      for (const s of spies) s.mockRestore()
    }
  })

  it('导出面收口：三态常量与规则函数缺一不可', () => {
    const mod = loadRule()
    expect(Object.keys(mod).sort()).toEqual(['DEFAULT_GRACE_DAYS', 'LOGIN_STATUSES', 'loginStatusTransition', 'resolveLoginGraceMs'])
    expect(mod.LOGIN_STATUSES).toEqual(['active', 'expired', 'unverified'])
  })
})
