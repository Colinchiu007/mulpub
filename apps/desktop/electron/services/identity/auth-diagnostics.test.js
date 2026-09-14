const {
  claimsExpired,
  describeErrorChain,
  isNetworkError,
  isSessionRejected,
  logIdentityFailure,
} = require('./auth-diagnostics')

describe('auth-diagnostics', () => {
  it('网络类错误判定穿透 cause 链', () => {
    const error = new Error('wrapper')
    error.cause = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' })
    expect(isNetworkError(error)).toBe(true)
    expect(isNetworkError(new Error('upstream 503'))).toBe(false)
  })

  it('会话被拒判定穿透 cause 链', () => {
    const error = new Error('wrapper')
    error.cause = Object.assign(new Error('token revoked'), { code: 'invalid_grant' })
    expect(isSessionRejected(error)).toBe(true)
    expect(isSessionRejected(new Error('unlink denied'))).toBe(false)
  })

  it('claimsExpired 仅在 exp 有效且已过期时为真', () => {
    expect(claimsExpired({ exp: 100 }, 200)).toBe(true)
    expect(claimsExpired({ exp: 300 }, 200)).toBe(false)
    expect(claimsExpired({}, 200)).toBe(false)
    expect(claimsExpired(null, 200)).toBe(false)
  })

  it('describeErrorChain 输出 code: message 链', () => {
    const error = Object.assign(new Error('登录失败'), { code: 'IDENTITY_SIGN_IN_FAILED' })
    error.cause = new Error('unlink denied')
    expect(describeErrorChain(error)).toBe('IDENTITY_SIGN_IN_FAILED: 登录失败 <- Error: unlink denied')
    expect(describeErrorChain(null)).toBe('')
  })

  it('logIdentityFailure 记录 scope 与 cause 链，且日志异常不外抛', () => {
    const warn = vi.fn()
    logIdentityFailure({ warn }, 'tokenStorage.clear', Object.assign(new Error('unlink denied'), { code: 'EPERM' }))
    expect(warn).toHaveBeenCalledWith('Identity', 'tokenStorage.clear failed: EPERM: unlink denied', {})
    expect(warn).toHaveBeenCalledTimes(1)

    expect(() => logIdentityFailure(null, 'signIn', new Error('ignored'))).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)

    const throwing = { warn: vi.fn(() => { throw new Error('logger down') }) }
    expect(() => logIdentityFailure(throwing, 'signIn', new Error('boom'))).not.toThrow()
    expect(throwing.warn).toHaveBeenCalledTimes(1)
  })
})
