const { withSenderCheck, EC } = require('./helpers')

function safeError(error) {
  return error && typeof error.code === 'string' ? error.code : 'IDENTITY_OPERATION_FAILED'
}

function registerIdentityHandlers(ipcMain, deps = {}) {
  const authService = deps.authService
  ipcMain.handle('identity:get-state', withSenderCheck(async () => {
    if (!authService) return { code: 0, data: { status: 'disabled', user: null, error: null } }
    try {
      return { code: 0, data: authService.getState() }
    } catch (error) {
      return { code: EC.AUTH_ERROR, message: safeError(error) }
    }
  }))
  ipcMain.handle('identity:sign-in', withSenderCheck(async () => {
    if (!authService) return { code: EC.AUTH_ERROR, message: 'IDENTITY_NOT_CONFIGURED' }
    try {
      return { code: 0, data: await authService.signIn() }
    } catch (error) {
      return { code: EC.AUTH_ERROR, message: safeError(error) }
    }
  }))
  ipcMain.handle('identity:switch-account', withSenderCheck(async () => {
    if (!authService) return { code: EC.AUTH_ERROR, message: 'IDENTITY_NOT_CONFIGURED' }
    try {
      return { code: 0, data: await authService.switchAccount() }
    } catch (error) {
      return { code: EC.AUTH_ERROR, message: safeError(error) }
    }
  }))
  // --- B1/B2 会员侧通道（不进 PUBLIC_CHANNELS，登录态由 license-access-control 默认门禁保证） ---
  const MEMBER_API_CHANNELS = {
    'identity:sessions': '/api/v1/me/sessions',
    'identity:sessions-revoke-others': '/api/v1/me/sessions/revoke-others',
    'identity:notifications': '/api/v1/me/notifications',
    'identity:notifications-mark-read': '/api/v1/me/notifications/read',
  }
  const memberApiService = authService && authService.memberApiService
  for (const [channel, apiPath] of Object.entries(MEMBER_API_CHANNELS)) {
    ipcMain.handle(channel, withSenderCheck(async () => {
      if (!authService || !memberApiService || typeof memberApiService.request !== 'function') {
        return { code: EC.AUTH_ERROR, message: 'IDENTITY_NOT_CONFIGURED' }
      }
      try {
        const state = typeof authService.getState === 'function' ? authService.getState() : null
        const subject = state && state.user ? state.user.sub : null
        return { code: 0, data: await memberApiService.request({ subject, path: apiPath }) }
      } catch (error) {
        return { code: EC.AUTH_ERROR, message: safeError(error) }
      }
    }))
  }

  ipcMain.handle('identity:sign-out', withSenderCheck(async () => {
    if (!authService) return { code: 0, data: { status: 'signed_out', user: null } }
    try {
      return { code: 0, data: await authService.signOut() }
    } catch (error) {
      return { code: EC.AUTH_ERROR, message: safeError(error) }
    }
  }))
}

module.exports = registerIdentityHandlers
