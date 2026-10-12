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
  const memberApiService = authService && authService.memberApiService
  const memberApiHandler = (apiPath, method, options = {}) => withSenderCheck(async (_event, payload) => {
    if (!authService || !memberApiService || typeof memberApiService.request !== 'function') {
      return { code: EC.AUTH_ERROR, message: 'IDENTITY_NOT_CONFIGURED' }
    }
    try {
      const state = typeof authService.getState === 'function' ? authService.getState() : null
      const subject = state && state.user ? state.user.sub : null
      // 写操作（核销）在本地就短路未登录：激活码是一次性资源，让未登录请求
      // 走到服务端只会白跑一趟再拿 BUSINESS_USER_REQUIRED。只对写通道启用，
      // 读通道维持原有行为，避免顺带改变既有语义。
      if (options.requireSubject && !subject) {
        return { code: EC.AUTH_ERROR, message: 'BUSINESS_USER_REQUIRED' }
      }
      // body 白名单：renderer 只能贡献 `code` 这一个字符串字段，其余键一律丢弃。
      // ME_API_PATHS 已经锁死路径与方法，这里再锁 body 形状——两层都要有，
      // 因为 renderer 是不可信输入源，将来加字段时也不该顺手把整包透传上去。
      const body = method && method !== 'GET'
        ? { code: payload && typeof payload.code === 'string' ? payload.code : '' }
        : undefined
      return { code: 0, data: await memberApiService.request({ subject, path: apiPath, method, body }) }
    } catch (error) {
      return { code: EC.AUTH_ERROR, message: safeError(error) }
    }
  })
  // 通道名必须以字面量出现在 ipcMain.handle( 中：tests/ipc-contract.test.js 按字面量静态扫描 preload↔handler 合同，循环变量注册不可见。
  ipcMain.handle('identity:sessions', memberApiHandler('/api/v1/me/sessions'))
  ipcMain.handle('identity:sessions-revoke-others', memberApiHandler('/api/v1/me/sessions/revoke-others'))
  ipcMain.handle('identity:notifications', memberApiHandler('/api/v1/me/notifications'))
  ipcMain.handle('identity:notifications-mark-read', memberApiHandler('/api/v1/me/notifications/read'))
  // 激活码核销。成功响应里的 idempotent / plan / periodEnd 必须原样回传渲染层：
  // 服务端在「同码重放且订阅已过期」时返回 subscription:null，那不是失败，
  // 渲染层要能区分它与真正的开通成功，不能只看 code===0 就说「兑换成功」。
  ipcMain.handle('identity:redeem-code', memberApiHandler('/api/v1/redeem', 'POST', { requireSubject: true }))

  ipcMain.handle('identity:sign-out', withSenderCheck(async () => {
    if (!authService) return { code: 0, data: { status: 'signed_out', user: null } }
    try {
      return { code: 0, data: await authService.signOut() }
    } catch (error) {
      return { code: EC.AUTH_ERROR, message: safeError(error) }
    }
  }))

  // 诊断报告：供用户在登录/连接失败时一键复制。
  // 报告在主进程组装并脱敏（auth-diagnostics.buildDiagnosticReport），
  // 渲染进程拿不到原始 error 对象，也拿不到未脱敏的 cause 链。
  ipcMain.handle('identity:diagnostic-report', withSenderCheck(async () => {
    if (!authService) return { code: 0, data: { text: '', fields: [] } }
    const { buildDiagnosticReport } = require('../services/identity/auth-diagnostics')
    const state = typeof authService.getState === 'function' ? authService.getState() : null
    // 优先用原始 error（含 cause 链，TLS 特征码只存在于链上），
    // 回落到 state.error（无原始错误时的兜底）。
    const lastError = typeof authService.getLastError === 'function' ? authService.getLastError() : null
    return {
      code: 0,
      data: buildDiagnosticReport({
        error: lastError || (state && state.error ? state.error : null),
        status: state && state.status ? state.status : '',
        env: {
          appVersion: deps.appVersion || process.env.npm_package_version || '',
          platform: process.platform,
          arch: process.arch,
          ...(deps.env || {}),
        },
      }),
    }
  }))
}

module.exports = registerIdentityHandlers
