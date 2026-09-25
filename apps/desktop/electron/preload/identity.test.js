describe('createIdentityApi', () => {
  it('只暴露状态/登录/切换/退出和状态监听，不暴露 Token', () => {
    const { createIdentityApi } = require('./identity')
    const listeners = {}
    const ipcRenderer = {
      invoke: vi.fn(async () => ({ code: 0, data: { status: 'signed_out' } })),
      on: vi.fn((channel, handler) => { listeners[channel] = handler }),
      removeListener: vi.fn(),
    }
    const api = createIdentityApi(ipcRenderer)
    expect(Object.keys(api)).toEqual(['identityGetState', 'identitySignIn', 'identitySwitchAccount', 'identitySignOut', 'identitySessions', 'identitySessionsRevokeOthers', 'identityNotifications', 'identityNotificationsMarkRead', 'onIdentityStateChanged'])
    expect(api).not.toHaveProperty('identityGetAccessToken')
    api.identityGetState()
    api.identitySignIn()
    api.identitySwitchAccount()
    api.identitySignOut()
    api.identitySessions()
    api.identitySessionsRevokeOthers()
    api.identityNotifications()
    api.identityNotificationsMarkRead()
    expect(ipcRenderer.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'identity:get-state', 'identity:sign-in', 'identity:switch-account', 'identity:sign-out',
      'identity:sessions', 'identity:sessions-revoke-others', 'identity:notifications', 'identity:notifications-mark-read',
    ])
    const callback = vi.fn()
    const dispose = api.onIdentityStateChanged(callback)
    listeners['identity:state-changed']({}, { status: 'authenticated' })
    expect(callback).toHaveBeenCalledWith({ status: 'authenticated' })
    dispose()
    expect(ipcRenderer.removeListener).toHaveBeenCalled()
  })
})
