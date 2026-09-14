import {
  IDENTITY_ERROR_FALLBACK_KEY,
  IDENTITY_ERROR_MESSAGE_KEYS,
  resolveIdentityErrorMessageKey,
  resolveIdentityStatusNoteKey,
} from './identity-error-messages'

describe('identity-error-messages', () => {
  it('登录失败类错误码不再映射到「退出失败」文案', () => {
    expect(resolveIdentityErrorMessageKey('IDENTITY_SIGN_IN_FAILED')).toBe('memberCenter.loginFailed')
    expect(resolveIdentityErrorMessageKey('IDENTITY_SIGN_IN_CANCELLED')).toBe('memberCenter.loginCancelled')
    expect(resolveIdentityErrorMessageKey('IDENTITY_CALLBACK_TIMEOUT')).toBe('memberCenter.loginTimeout')
    expect(resolveIdentityErrorMessageKey('IDENTITY_CALLBACK_PORT_UNAVAILABLE')).toBe('memberCenter.loginCallbackFailed')
    expect(resolveIdentityErrorMessageKey('IDENTITY_AUTH_WINDOW_LOAD_FAILED')).toBe('memberCenter.loginWindowFailed')
  })

  it('只有退出类错误码映射到「退出失败」文案', () => {
    const signOutKeys = Object.entries(IDENTITY_ERROR_MESSAGE_KEYS)
      .filter(([, key]) => key === 'memberCenter.signOutFailed')
      .map(([code]) => code)
    expect(signOutKeys).toEqual(['IDENTITY_SIGN_OUT_FAILED'])
  })

  it('会话存储类错误映射到可操作提示', () => {
    expect(resolveIdentityErrorMessageKey('IDENTITY_SESSION_CLEAR_FAILED')).toBe('memberCenter.sessionStoreBlocked')
    expect(resolveIdentityErrorMessageKey('IDENTITY_SECURE_STORAGE_UNAVAILABLE')).toBe('memberCenter.secureStorageUnavailable')
  })

  it('仅在退出类错误上使用「退出失败」文案', () => {
    expect(resolveIdentityErrorMessageKey('IDENTITY_SIGN_OUT_FAILED')).toBe('memberCenter.signOutFailed')
    expect(resolveIdentityErrorMessageKey('IDENTITY_ACCOUNT_SWITCH_FAILED')).toBe('memberCenter.switchFailed')
  })

  it('未知/空错误码回落到中性文案', () => {
    expect(resolveIdentityErrorMessageKey('SOMETHING_UNKNOWN')).toBe(IDENTITY_ERROR_FALLBACK_KEY)
    expect(resolveIdentityErrorMessageKey('')).toBe(IDENTITY_ERROR_FALLBACK_KEY)
    expect(resolveIdentityErrorMessageKey(undefined)).toBe(IDENTITY_ERROR_FALLBACK_KEY)
    expect(resolveIdentityErrorMessageKey(123)).toBe(IDENTITY_ERROR_FALLBACK_KEY)
    expect(IDENTITY_ERROR_FALLBACK_KEY).toBe('memberCenter.operationFailed')
  })

  it('未登录态副标题按状态区分，error 不与详细原因重复', () => {
    expect(resolveIdentityStatusNoteKey('disabled')).toBe('memberCenter.identityDisabledHint')
    expect(resolveIdentityStatusNoteKey('expired')).toBe('memberCenter.statusExpired')
    expect(resolveIdentityStatusNoteKey('error')).toBe('memberCenter.retryHint')
    expect(resolveIdentityStatusNoteKey('signed_out')).toBe('memberCenter.notLoggedInHint')
    expect(resolveIdentityStatusNoteKey(undefined)).toBe('memberCenter.notLoggedInHint')
  })
})
