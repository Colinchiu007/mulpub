import { describe, expect, it } from 'vitest'
import { isAuthGateResult } from './auth-gate'

describe('isAuthGateResult', () => {
  it('AUTH_REQUIRED / NOT_SIGNED_IN 判定为登录门禁', () => {
    expect(isAuthGateResult({ code: -3, errorCode: 'AUTH_REQUIRED' })).toBe(true)
    expect(isAuthGateResult({ code: -3, errorCode: 'NOT_SIGNED_IN' })).toBe(true)
  })

  it('ENTITLEMENT_REQUIRED 不判定为登录门禁（同为 code:-3，必须按 errorCode 区分）', () => {
    expect(isAuthGateResult({ code: -3, errorCode: 'ENTITLEMENT_REQUIRED' })).toBe(false)
  })

  it('无 errorCode 的遗留 code:-3 形态兜底判定为门禁', () => {
    expect(isAuthGateResult({ code: -3, message: 'legacy' })).toBe(true)
  })

  it('成功与其他业务错误不判定为门禁', () => {
    expect(isAuthGateResult({ code: 0, data: {} })).toBe(false)
    expect(isAuthGateResult({ code: -1, message: 'boom' })).toBe(false)
    expect(isAuthGateResult({ code: -10, errorCode: 'NOT_FOUND' })).toBe(false)
  })

  it('非法输入返回 false', () => {
    expect(isAuthGateResult(null)).toBe(false)
    expect(isAuthGateResult(undefined)).toBe(false)
    expect(isAuthGateResult('error')).toBe(false)
    expect(isAuthGateResult(42)).toBe(false)
  })
})
