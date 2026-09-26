// @ts-check
/**
 * Account IPC handlers 合同测试
 *
 * 验证写操作的 sender 来源校验（withSenderCheck）：
 * - auth:open-login / auth:login-silent / account:add / account:delete / account:check-login / account:list
 *
 * 公开账号列表通过字段白名单脱敏；触发浏览器检查和旧列表通道必须校验来源。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock logger 防止真实日志污染
vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

// 启用 electron mock，withSenderCheck 通过 require('electron').app 读取 isPackaged
__enableElectronMock()

let registerHandlers
let originalNodeEnv
let originalIsPackaged

beforeEach(async () => {
  vi.resetModules()
  // 信任 dev localhost:5174 — 模拟未打包开发模式
  originalNodeEnv = process.env.NODE_ENV
  originalIsPackaged = __electronMock.app.isPackaged
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const mod = await import('./account')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  __electronMock.app.isPackaged = originalIsPackaged
})

function createMockIpcMain() {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    on: vi.fn(),
    _get: (channel) => handlers[channel],
  }
}

function createMockDeps(overrides = {}) {
  return {
    authViewManager: { openLogin: vi.fn(), completeLogin: vi.fn(), loginSilent: vi.fn(), close: vi.fn() },
    pythonBridge: { requestBackend: vi.fn() },
    AccountManager: {
      addAccount: vi.fn(),
      saveCapturedAccount: vi.fn(),
      deleteAccount: vi.fn(),
      listAccounts: vi.fn(),
      checkLoginStatus: vi.fn(),
      loadSavedCredentials: vi.fn(),
      setAccountProxy: vi.fn(),
      getAccountProxyStatus: vi.fn(() => ({ configured: false })),
      checkLocalCredentials: vi.fn(() => false),
      persistLoginState: vi.fn(async () => ({ ok: true })),
      loginStatusFromCheckResult: vi.fn((r) => (r && r.valid === true ? 'active' : r && r.valid === false ? 'expired' : 'unverified')),
    },
    BACKEND_PLATFORMS: new Set(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    store: { getSetting: vi.fn(), setSetting: vi.fn() },
    ...overrides,
  }
}

async function ipcMain_and_call(deps, channel, arg) {
  const ipcMain = createMockIpcMain()
  registerHandlers(ipcMain, deps)
  return ipcMain._get(channel)(TRUSTED_EVENT, arg)
}

// 不可信来源（外部网页）
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
// 可信来源（dev localhost）
const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

describe('account IPC 写操作 sender 校验', () => {
  it('auth:open-login 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('auth:open-login')

    const result = await handler(UNTRUSTED_EVENT, 'wechat')

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('auth:login-silent 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('auth:login-silent')

    const result = await handler(UNTRUSTED_EVENT, { platform: 'wechat', cookies: [] })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it.each([
    ['auth:open-login', async (handler) => handler(TRUSTED_EVENT, 'wechat_mp')],
    ['auth:login-silent', async (handler) => handler(TRUSTED_EVENT, { platform: 'wechat_mp', accountId: 'acc-1' })],
  ])('%s 在身份服务存在但 sub 缺失时 fail-closed', async (channel, invoke) => {
    const deps = createMockDeps({
      identityService: { getState: vi.fn(() => ({ status: 'authenticated', user: null })) },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await invoke(ipcMain._get(channel))

    expect(result).toEqual({ code: -3, message: '无法识别当前用户' })
    expect(deps.authViewManager.openLogin).not.toHaveBeenCalled()
    expect(deps.AccountManager.saveCapturedAccount).not.toHaveBeenCalled()
    expect(deps.AccountManager.loadSavedCredentials).not.toHaveBeenCalled()
  })

  it.each([
    ['accounts:list', async (handler) => handler(TRUSTED_EVENT), { code: -3, message: '无法识别当前用户', data: [] }],
    ['account:add', async (handler) => handler(TRUSTED_EVENT, 'wechat_mp'), { code: -3, message: '无法识别当前用户' }],
    ['account:delete', async (handler) => handler(TRUSTED_EVENT, 'acc-1'), { code: -3, message: '无法识别当前用户' }],
    ['account:check-login', async (handler) => handler(TRUSTED_EVENT, { platform: 'wechat_mp', accountId: 'acc-1' }), { code: -3, message: '无法识别当前用户', data: { valid: false } }],
    ['account:set-proxy', async (handler) => handler(TRUSTED_EVENT, { accountId: 'acc-1', platform: 'wechat_mp', proxy: { host: '127.0.0.1', port: 8080, type: 'http' } }), { code: -3, message: '无法识别当前用户' }],
    ['account:list', async (handler) => handler(TRUSTED_EVENT), { code: -3, message: '无法识别当前用户', data: [] }],
  ])('%s 在身份服务存在但 sub 缺失时拒绝访问账号数据', async (channel, invoke, expected) => {
    const deps = createMockDeps({
      identityService: { getState: vi.fn(() => ({ status: 'authenticated', user: null })) },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    await expect(invoke(ipcMain._get(channel))).resolves.toEqual(expected)
    expect(deps.pythonBridge.requestBackend).not.toHaveBeenCalled()
    expect(deps.AccountManager.addAccount).not.toHaveBeenCalled()
    expect(deps.AccountManager.deleteAccount).not.toHaveBeenCalled()
    expect(deps.AccountManager.checkLoginStatus).not.toHaveBeenCalled()
    expect(deps.AccountManager.setAccountProxy).not.toHaveBeenCalled()
    expect(deps.AccountManager.listAccounts).not.toHaveBeenCalled()
  })

  it('account:add 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('account:add')

    const result = await handler(UNTRUSTED_EVENT, 'wechat')

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('account:delete 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('account:delete')

    const result = await handler(UNTRUSTED_EVENT, 'acc-1')

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('auth:complete-login 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    const deps = createMockDeps()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:complete-login')(UNTRUSTED_EVENT)

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(deps.authViewManager.completeLogin).not.toHaveBeenCalled()
  })

  it('auth:close 拒绝外部网页调用', async () => {
    const ipcMain = createMockIpcMain()
    const deps = createMockDeps()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:close')(UNTRUSTED_EVENT)

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(deps.authViewManager.close).not.toHaveBeenCalled()
  })

  it('account:check-login 拒绝外部网页触发账号验证', async () => {
    const ipcMain = createMockIpcMain()
    const deps = createMockDeps()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('account:check-login')(UNTRUSTED_EVENT, {
      platform: 'wechat_mp',
      accountId: 'acc-1',
    })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(deps.AccountManager.checkLoginStatus).not.toHaveBeenCalled()
  })

  it('account:set-proxy 拒绝外部网页写入代理凭证', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())

    await expect(ipcMain._get('account:set-proxy')(UNTRUSTED_EVENT, {
      accountId: 'acc-1',
      platform: 'wechat_mp',
      proxy: { host: '127.0.0.1', port: 8080, type: 'http', password: 'secret' },
    })).resolves.toEqual({ code: -3, message: '未授权的调用来源' })
  })

  it('不再注册允许渲染层提交敏感凭证的 auth:save-credentials', () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())

    expect(ipcMain._get('auth:save-credentials')).toBeUndefined()
  })
})

describe('account IPC 可信来源正常工作', () => {
  it('accounts:list 规范化账号状态、合并默认账号并移除敏感字段', async () => {
    const deps = createMockDeps()
    deps.AccountManager.checkLocalCredentials.mockReturnValue(true)
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-1',
      platform: 'wechat_mp',
      name: '公众号',
      is_active: true,
      cookies: [{ name: 'session', value: 'secret' }],
      auth_data: { local_storage: { token: 'private' } },
      access_token: '不得暴露',
      refresh_token: '不得暴露',
    }])
    deps.store.getSetting.mockReturnValue('acc-1')
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const denied = await ipcMain._get('accounts:list')(UNTRUSTED_EVENT)
    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(denied).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(result).toEqual({
      code: 0,
      data: [{
        id: 'acc-1',
        platform: 'wechat_mp',
        name: '公众号',
        account_name: '公众号',
        is_active: true,
        status: 'unverified',
        status_source: 'absent-fallback',
        is_default: true,
        has_cookies: true,
        cookie_count: 1,
      }],
    })
  })

  it('accounts:list 把后端 errorCode/status 透传给渲染层（瞬时失败可判定）', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockRejectedValue(
      Object.assign(new Error('AUTH_JWKS_UNAVAILABLE'), { errorCode: 'AUTH_JWKS_UNAVAILABLE', status: 503 }),
    )
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(result).toEqual(expect.objectContaining({
      code: -1,
      message: 'AUTH_JWKS_UNAVAILABLE',
      data: [],
      errorCode: 'AUTH_JWKS_UNAVAILABLE',
      status: 503,
    }))
  })

  it('accounts:list 普通异常不带 errorCode/status 字段', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockRejectedValue(new Error('disk full'))
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(result).toEqual({ code: -1, message: 'disk full', data: [] })
  })

  it('accounts:list 本地无加密凭证时标记 has_cookies=false 且 status=expired', async () => {
    const deps = createMockDeps()
    deps.AccountManager.checkLocalCredentials.mockReturnValue(false)
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-no-cred',
      platform: 'baijiahao',
      name: '百家号账号',
      is_active: true,
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(deps.AccountManager.checkLocalCredentials).toHaveBeenCalledWith('baijiahao', 'acc-no-cred')
    expect(result.data[0]).toEqual(expect.objectContaining({
      has_cookies: false,
      cookie_count: 0,
      status: 'expired',
    }))
  })

  it('accounts:list 尊重后端写回的 expired（一键检测结论固化）', async () => {
    const deps = createMockDeps()
    // 本地有凭证（hasCred=true），但后端 status=expired 是上一次主动检测写回的
    deps.AccountManager.checkLocalCredentials.mockReturnValue(true)
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-fresh-expired',
      platform: 'wechat_mp',
      name: '公众号',
      status: 'expired',
      last_validated: new Date().toISOString(),
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    // 后端是真源：检测结论必须跨页面、跨重启保持一致
    expect(result.data[0].status).toBe('expired')
    expect(result.data[0].status_source).toBe('backend')
  })

  it('accounts:list expired 粘滞 —— 陈旧 expired 不再被本地凭证文件推翻为 active', async () => {
    const deps = createMockDeps()
    deps.AccountManager.checkLocalCredentials.mockReturnValue(true)
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-stale-expired',
      platform: 'wechat_mp',
      name: '公众号',
      status: 'expired',
      last_validated: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    // 凭证文件存在 ≠ 登录有效（视频号假阳性根因）；expired 只能由新的检测/重新登录清除
    expect(result.data[0].status).toBe('expired')
    expect(result.data[0].status_source).toBe('backend')
  })

  it('accounts:list 后端 unverified（未确认）原样透传，不冒充已登录也不计入失效', async () => {
    const deps = createMockDeps()
    deps.AccountManager.checkLocalCredentials.mockReturnValue(true)
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-unverified',
      platform: 'tencent_video',
      name: '视频号',
      status: 'unverified',
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(result.data[0].status).toBe('unverified')
    expect(result.data[0].status_source).toBe('backend')
  })

  it('accounts:list 后端 status 非法（历史脏值）时兜底 unverified，不再由 is_active 派生登录态', async () => {
    const deps = createMockDeps()
    deps.AccountManager.checkLocalCredentials.mockReturnValue(true)
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-dirty',
      platform: 'toutiao',
      name: '头条号',
      status: 'LOGIN_OK',
      is_active: true,
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(result.data[0].status).toBe('unverified')
    expect(result.data[0].status_source).toBe('absent-fallback')
  })

  it('accounts:list 本地无凭证时后端 active 也被判为 expired（无法自证登录）', async () => {
    const deps = createMockDeps()
    deps.AccountManager.checkLocalCredentials.mockReturnValue(false)
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-cred-missing',
      platform: 'toutiao',
      name: '头条号',
      status: 'active',
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(result.data[0].status).toBe('expired')
    expect(result.data[0].status_source).toBe('no-local-credential')
  })

  it('accounts:batch-check-login 三态透传并把结论固化到后端（唯一写者）', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue([
      { id: 'acc-ok', platform: 'wechat_mp' },
      { id: 'acc-bad', platform: 'toutiao' },
      { id: 'acc-unknown', platform: 'tencent_video' },
    ])
    deps.AccountManager.checkLoginStatus.mockImplementation(async (platform, accountId) => {
      if (accountId === 'acc-ok') return { valid: true, code: 'CHECK_LOGIN_SUCCESS' }
      if (accountId === 'acc-bad') return { valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
      return { valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE', reason: 'http-check-inconclusive' }
    })

    const result = await ipcMain_and_call(deps, 'accounts:batch-check-login', {})

    expect(result.code).toBe(0)
    const byId = {}
    for (const item of result.data.results) byId[item.accountId] = item
    expect(byId['acc-ok'].valid).toBe(true)
    expect(byId['acc-ok'].loginStatus).toBe('active')
    expect(byId['acc-bad'].valid).toBe(false)
    expect(byId['acc-bad'].loginStatus).toBe('expired')
    // 未确认不得被压成 false（否则渲染成「已失效」）
    expect('valid' in byId['acc-unknown']).toBe(true)
    expect(byId['acc-unknown'].valid).toBeUndefined()
    expect(byId['acc-unknown'].code).toBe('CHECK_LOGIN_INCONCLUSIVE')
    expect(byId['acc-unknown'].loginStatus).toBe('unverified')
    expect(deps.AccountManager.persistLoginState).toHaveBeenCalledWith('acc-ok', 'wechat_mp', 'active', result.data.checkedAt)
    expect(deps.AccountManager.persistLoginState).toHaveBeenCalledWith('acc-bad', 'toutiao', 'expired', result.data.checkedAt)
    expect(deps.AccountManager.persistLoginState).toHaveBeenCalledWith('acc-unknown', 'tencent_video', 'unverified', result.data.checkedAt)
    expect(result.data.results.every((r) => r.persisted.ok === true)).toBe(true)
  })

  it('accounts:batch-check-login 检测抛异常记为 unverified 而非 expired', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue([{ id: 'acc-throw', platform: 'toutiao' }])
    deps.AccountManager.checkLoginStatus.mockRejectedValue(new Error('net down'))

    const result = await ipcMain_and_call(deps, 'accounts:batch-check-login', {})

    const item = result.data.results[0]
    expect(item.valid).toBeUndefined()
    expect(item.code).toBe('CHECK_LOGIN_ERROR')
    expect(item.loginStatus).toBe('unverified')
    expect(item.error).toBe('net down')
    expect(deps.AccountManager.persistLoginState).toHaveBeenCalledWith('acc-throw', 'toutiao', 'unverified', expect.any(String))
  })

  it('accounts:batch-check-login 单账号硬超时记为 unverified（非 expired）', async () => {
    // A hard timeout is not evidence of an expired login: it must not be
    // folded into 'expired' (that was the false-negative class this PR fixes).
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue([{ id: 'acc-slow', platform: 'toutiao' }])
    deps.AccountManager.checkLoginStatus.mockImplementation(() => new Promise(() => {}))
    deps.AccountManager.persistLoginState.mockResolvedValue({ ok: true, status: 'unverified' })
    process.env.MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS = '20'
    let result
    try {
      result = await ipcMain_and_call(deps, 'accounts:batch-check-login', {})
    } finally {
      delete process.env.MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS
    }

    const item = result.data.results[0]
    expect(item.code).toBe('CHECK_LOGIN_TIMEOUT')
    expect(item.valid).toBeUndefined()
    expect(item.loginStatus).toBe('unverified')
    expect(deps.AccountManager.persistLoginState).toHaveBeenCalledWith(
      'acc-slow', 'toutiao', 'unverified', expect.any(String))
  })

  it('accounts:batch-check-login 后端写回失败时结果可见（不静默丢失固化）', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue([{ id: 'acc-p', platform: 'toutiao' }])
    deps.AccountManager.checkLoginStatus.mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    deps.AccountManager.persistLoginState.mockResolvedValue({ ok: false, reason: 'backend-error', code: -1 })

    const result = await ipcMain_and_call(deps, 'accounts:batch-check-login', {})

    expect(result.data.results[0].persisted).toEqual({ ok: false, status: 'expired', reason: 'backend-error' })
  })

  it('account:check-login 单账号检测同样固化登录态', async () => {
    const deps = createMockDeps()
    deps.AccountManager.checkLoginStatus.mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('account:check-login')(TRUSTED_EVENT, { platform: 'toutiao', accountId: 'acc-1' })

    expect(result).toEqual({ code: 0, data: { valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' } })
    expect(deps.AccountManager.persistLoginState).toHaveBeenCalledWith('acc-1', 'toutiao', 'expired', expect.any(String))
  })

  it('accounts:list 优先使用当前用户的默认账号设置，不能读取 legacy 全局默认值', async () => {
    const scopedStore = {
      getUserSetting: vi.fn(() => 'other-account'),
      getSetting: vi.fn(() => 'acc-1'),
    }
    const deps = createMockDeps({ store: scopedStore })
    deps.AccountManager.listAccounts.mockResolvedValue([{ id: 'acc-1', platform: 'wechat_mp', name: '当前用户账号' }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(result.data[0].is_default).toBe(false)
    expect(scopedStore.getUserSetting).toHaveBeenCalledWith('default_account:wechat_mp')
    expect(scopedStore.getSetting).not.toHaveBeenCalled()
  })

  it('accounts:list 保留账号卡片所需的公开元数据并剥离未知字段', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-meta',
      platform: 'wechat_mp',
      name: '认知账号',
      follower_count: 2048,
      owner_name: { name: '团队甲', email: 'private@example.com' },
      operatorName: '秋叔',
      checkedAt: '2026-08-04T08:00:00.000Z',
      statusReason: `token=private-token Cookie 已过期 ${'x'.repeat(300)}`,
      lastUsedAt: '2026-08-04T09:00:00.000Z',
      unknown_metadata: '不得透传',
      cookies: [{ name: 'session', value: 'secret' }],
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    expect(result.data[0]).toEqual(expect.objectContaining({
      followers: 2048,
      owner: '团队甲',
      publisher: '秋叔',
      last_login_check_at: '2026-08-04T08:00:00.000Z',
      status_reason: expect.stringMatching(/^token=\*\*\* Cookie 已过期/),
      last_used_at: '2026-08-04T09:00:00.000Z',
    }))
    expect(result.data[0]).not.toHaveProperty('unknown_metadata')
    expect(result.data[0]).not.toHaveProperty('cookies')
    expect(JSON.stringify(result)).not.toContain('private@example.com')
    expect(JSON.stringify(result)).not.toContain('private-token')
    expect(result.data[0].status_reason.length).toBeLessThanOrEqual(240)

  })
  it('accounts:list 对下划线/驼峰/中文/组合键敏感字段全部脱敏且不泄漏值', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-redact',
      platform: 'wechat_mp',
      name: '公众号',
      statusReason: 'access_token=abc refreshToken=def api_key=xyz 密码：secret session=expired user_token=comb client_secret=xyz2 loginPassword=psw token=first,second Bearer abc123 普通描述 无密钥',
    }, {
      id: 'acc-arr',
      platform: 'zhihu',
      name: '知乎',
      login_check_error: ['access_token=arr-secret 失败', '普通消息'],
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)

    const text = result.data[0].status_reason
    expect(text).toContain('access_token=***')
    expect(text).toContain('refreshToken=***')
    expect(text).toContain('api_key=***')
    expect(text).toContain('密码：***')
    expect(text).toContain('session=***')
    expect(text).toContain('user_token=***')
    expect(text).toContain('client_secret=***')
    expect(text).toContain('loginPassword=***')
    expect(text).toContain('token=***')
    expect(text).toContain('Bearer ***')
    expect(text).toContain('普通描述 无密钥')
    expect(text).not.toContain('abc')
    expect(text).not.toContain('def')
    expect(text).not.toContain('second')
    expect(text).not.toContain('xyz')
    expect(text).not.toContain('xyz2')
    expect(text).not.toContain('comb')
    expect(text).not.toContain('psw')

    expect(result.data[1].login_check_error).toEqual(['access_token=*** 失败', '普通消息'])
  })

  it('account:list 与 accounts:list 双路径返回一致的公开字段形状', async () => {
    const rawAccount = {
      id: 'acc-dual',
      platform: 'zhihu',
      name: '知乎账号',
      follower_count: 1024,
      ownerName: '团队乙',
      publishers: ['秋叔', '小明'],
      checkedAt: '2026-08-06T08:00:00.000Z',
      statusReason: 'accessToken=hidden-token 已过期',
      unknown_metadata: '不得透传',
      cookies: [{ name: 'session', value: 'secret' }],
    }
    const backendDeps = createMockDeps()
    backendDeps.AccountManager.listAccounts.mockResolvedValue([rawAccount])
    const localDeps = createMockDeps()
    localDeps.AccountManager.listAccounts.mockResolvedValue([rawAccount])
    const backendIpc = createMockIpcMain()
    const localIpc = createMockIpcMain()
    registerHandlers(backendIpc, backendDeps)
    registerHandlers(localIpc, localDeps)

    const fromBackend = await backendIpc._get('accounts:list')(TRUSTED_EVENT)
    const fromLocal = await localIpc._get('account:list')(TRUSTED_EVENT)

    expect(fromBackend.code).toBe(0)
    expect(fromLocal.code).toBe(0)
    expect(fromBackend.data).toEqual(fromLocal.data)
    expect(fromLocal.data[0]).toEqual(expect.objectContaining({
      id: 'acc-dual',
      platform: 'zhihu',
      name: '知乎账号',
      followers: 1024,
      owner: '团队乙',
      publisher: ['秋叔', '小明'],
      last_login_check_at: '2026-08-06T08:00:00.000Z',
      status_reason: expect.stringMatching(/^accessToken=\*\*\* 已过期/),
    }))
    expect(JSON.stringify(fromLocal.data)).not.toContain('hidden-token')
    expect(JSON.stringify(fromLocal.data)).not.toContain('secret')
    expect(fromLocal.data[0]).not.toHaveProperty('unknown_metadata')
    expect(fromLocal.data[0]).not.toHaveProperty('cookies')
  })

  it('account:list 对字符串代理端口归一化并拒绝非法端口', async () => {
    const deps = createMockDeps()
    deps.AccountManager.listAccounts.mockResolvedValue([{
      id: 'acc-proxy',
      platform: 'wechat_mp',
      name: '公众号',
      proxy: { configured: true, type: 'http', hostMasked: '10.0.*.*', port: '8080' },
    }])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('account:list')(TRUSTED_EVENT)

    expect(result.data[0].proxy.port).toBe(8080)
  })

  it('account:set-proxy 等待异步持久化并把拒绝转换为 IPC 错误', async () => {
    const deps = createMockDeps()
    let resolveSave
    deps.AccountManager.setAccountProxy.mockImplementation(() => new Promise(resolve => { resolveSave = resolve }))
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const pending = ipcMain._get('account:set-proxy')(TRUSTED_EVENT, {
      accountId: 'acc-1',
      platform: 'wechat_mp',
      proxy: { host: '127.0.0.1', port: 8080, type: 'http' },
    })
    let settled = false
    pending.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveSave({ configured: true, type: 'http', hostMasked: '127.0.*.*', port: 8080 })
    await expect(pending).resolves.toEqual({
      code: 0,
      data: { configured: true, type: 'http', hostMasked: '127.0.*.*', port: 8080 },
      message: '账号代理已保存',
    })

    deps.AccountManager.setAccountProxy.mockRejectedValueOnce(new Error('保存失败'))
    await expect(ipcMain._get('account:set-proxy')(TRUSTED_EVENT, {
      accountId: 'acc-1',
      platform: 'wechat_mp',
      proxy: null,
    })).resolves.toEqual({ code: -1, message: '保存失败' })
  })

  it('auth:open-login 可信来源缺参返回校验错误', async () => {
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, createMockDeps())
    const handler = ipcMain._get('auth:open-login')

    const result = await handler(TRUSTED_EVENT, undefined)

    // platform 为 undefined，_isSafePathSegment 返回 false
    expect(result.code).toBe(-2)
    expect(result.message).toMatch(/platform/)
  })

  it('auth:open-login 对旧后端平台也走本地授权视图并只返回脱敏账号字段', async () => {
    const send = vi.fn()
    const deps = createMockDeps({
      BACKEND_PLATFORMS: new Set(['youtube']),
      BrowserWindow: {
        getAllWindows: vi.fn(() => [{
          isDestroyed: vi.fn(() => false),
          webContents: { send },
        }]),
      },
    })
    const captured = {
      name: '频道账号',
      cookies: [{ name: 'session', value: 'secret', domain: '.youtube.com' }],
      localStorage: { access_token: 'private-token' },
      indexedDB: { auth: { token: 'private-token' } },
    }
    deps.authViewManager.openLogin.mockResolvedValue(captured)
    // 真实 saveCapturedAccount 凭证落盘后会固化登录态并把 active 带回返回值
    deps.AccountManager.saveCapturedAccount.mockResolvedValue({
      id: 'yt-1',
      platform: 'youtube',
      name: '频道账号',
      status: 'active',
      last_validated: '2026-09-25T15:00:00.000Z',
    })
    deps.AccountManager.checkLocalCredentials.mockReturnValue(true)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:open-login')(TRUSTED_EVENT, 'youtube')

    expect(result).toEqual({
      code: 0,
      data: {
        id: 'yt-1',
        platform: 'youtube',
        name: '频道账号',
        account_name: '频道账号',
        status: 'active',
        status_source: 'backend',
        last_validated: '2026-09-25T15:00:00.000Z',
        is_default: false,
        has_cookies: true,
        cookie_count: 1,
      },
      message: '账号添加成功',
    })
    expect(deps.authViewManager.openLogin).toHaveBeenCalledWith('youtube')
    expect(deps.AccountManager.saveCapturedAccount).toHaveBeenCalledWith('youtube', captured)
    expect(deps.pythonBridge.requestBackend).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('private-token')
    expect(send).toHaveBeenCalledWith('auth:completed', { platform: 'youtube', accountId: 'yt-1' })
  })

  it('auth:open-login 捕获的浏览器凭据只交给主进程加密存储', async () => {
    const captured = {
      name: '公众号',
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: { token: 'private' },
      indexedDB: { auth: { token: 'private' } },
    }
    const deps = createMockDeps()
    const send = vi.fn()
    deps.BrowserWindow.getAllWindows.mockReturnValue([{
      isDestroyed: vi.fn(() => false),
      webContents: { send },
    }])
    deps.authViewManager.openLogin.mockResolvedValue(captured)
    deps.AccountManager.saveCapturedAccount.mockResolvedValue({
      id: 'account-1',
      platform: 'wechat_mp',
      name: '公众号',
      cookies: captured.cookies,
      status: 'active',
      last_validated: '2026-09-25T15:00:00.000Z',
    })
    deps.AccountManager.checkLocalCredentials.mockReturnValue(true)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:open-login')(TRUSTED_EVENT, 'wechat_mp')

    expect(deps.AccountManager.saveCapturedAccount).toHaveBeenCalledWith('wechat_mp', captured)
    expect(deps.pythonBridge.requestBackend).not.toHaveBeenCalled()
    expect(result).toEqual({
      code: 0,
      data: {
        id: 'account-1',
        platform: 'wechat_mp',
        name: '公众号',
        account_name: '公众号',
        status: 'active',
        status_source: 'backend',
        last_validated: '2026-09-25T15:00:00.000Z',
        is_default: false,
        has_cookies: true,
        cookie_count: 1,
      },
      message: '账号添加成功',
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('private')
    expect(send).toHaveBeenCalledWith('auth:completed', { platform: 'wechat_mp', accountId: 'account-1' })
  })

  it('auth:open-login 用户关闭登录页签返回取消且不保存凭证', async () => {
    const deps = createMockDeps()
    deps.authViewManager.openLogin.mockResolvedValue({ cancelled: true })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:open-login')(TRUSTED_EVENT, 'wechat_mp')

    expect(result).toEqual({ code: 0, cancelled: true, data: { cancelled: true }, message: '登录已取消' })
    expect(deps.AccountManager.saveCapturedAccount).not.toHaveBeenCalled()
  })

  it('auth:open-login 登录等待超时返回超时错误且不保存凭证', async () => {
    const deps = createMockDeps()
    deps.authViewManager.openLogin.mockResolvedValue({ timeout: true })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:open-login')(TRUSTED_EVENT, 'wechat_mp')

    expect(result.code).toBe(-11)
    expect(result.message).toMatch(/超时/)
    expect(deps.AccountManager.saveCapturedAccount).not.toHaveBeenCalled()
  })

  it('auth:complete-login 只触发主进程提取，不接收渲染层凭证', async () => {
    const deps = createMockDeps()
    deps.authViewManager.completeLogin.mockResolvedValue(true)
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:complete-login')(TRUSTED_EVENT)

    expect(deps.authViewManager.completeLogin).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ code: 0, data: true, message: '正在保存账号' })
  })

  it('auth:login-silent 只接收账号标识，并从主进程凭证库读取登录数据', async () => {
    const credentials = {
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: { token: 'private' },
    }
    const deps = createMockDeps()
    deps.AccountManager.loadSavedCredentials.mockReturnValue(credentials)
    deps.authViewManager.loginSilent.mockResolvedValue({ valid: true, accountName: '公众号' })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:login-silent')(TRUSTED_EVENT, {
      platform: 'wechat_mp',
      accountId: 'acc-1',
    })

    expect(deps.AccountManager.loadSavedCredentials).toHaveBeenCalledWith('acc-1', 'wechat_mp')
    expect(deps.authViewManager.loginSilent).toHaveBeenCalledWith(
      'wechat_mp',
      credentials.cookies,
      credentials.localStorage,
      credentials.indexedDB,
    )
    expect(result).toEqual({ code: 0, data: { valid: true, accountName: '公众号' } })
  })

  it('auth:login-silent 拒绝渲染层夹带凭证或非法账号路径段', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:login-silent')(TRUSTED_EVENT, {
      platform: 'wechat_mp',
      accountId: '../acc-1',
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: { token: 'private' },
    })

    expect(result.code).toBe(-2)
    expect(deps.AccountManager.loadSavedCredentials).not.toHaveBeenCalled()
    expect(deps.authViewManager.loginSilent).not.toHaveBeenCalled()
  })

  it('account:check-login 在所有分支统一拒绝非法 platform 和 accountId', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('account:check-login')

    const badPlatform = await handler(TRUSTED_EVENT, { platform: '../wechat_mp', accountId: 'acc-1' })
    const badAccount = await handler(TRUSTED_EVENT, { platform: 'wechat_mp', accountId: 'acc/1' })

    expect(badPlatform.code).toBe(-2)
    expect(badAccount.code).toBe(-2)
    expect(deps.AccountManager.checkLoginStatus).not.toHaveBeenCalled()
    expect(deps.pythonBridge.requestBackend).not.toHaveBeenCalled()
  })

  it('account:check-login 对后端平台也按 accountId 检查指定账号', async () => {
    const deps = createMockDeps({ BACKEND_PLATFORMS: new Set(['youtube']) })
    deps.AccountManager.checkLoginStatus.mockResolvedValue({ valid: true, message: '登录有效' })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('account:check-login')(TRUSTED_EVENT, {
      platform: 'youtube',
      accountId: 'yt-2',
    })

    expect(deps.AccountManager.checkLoginStatus).toHaveBeenCalledWith('youtube', 'yt-2')
    expect(deps.pythonBridge.requestBackend).not.toHaveBeenCalled()
    expect(result).toEqual({ code: 0, data: { valid: true, message: '登录有效' } })
  })

  it('auth:open-login 固化失败时如实返回 unverified，不冒充已登录', async () => {
    const deps = createMockDeps()
    deps.authViewManager.openLogin.mockResolvedValue({
      name: '频道账号',
      cookies: [{ name: 'session', value: 'secret', domain: '.youtube.com' }],
    })
    // 真源没写成功 → saveCapturedAccount 如实透传后端原值
    deps.AccountManager.saveCapturedAccount.mockResolvedValue({
      id: 'yt-9',
      platform: 'youtube',
      name: '频道账号',
      status: 'unverified',
    })
    deps.AccountManager.checkLocalCredentials.mockReturnValue(true)
    deps.BrowserWindow.getAllWindows.mockReturnValue([])
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('auth:open-login')(TRUSTED_EVENT, 'youtube')

    expect(result.code).toBe(0)
    expect(result.data.status).toBe('unverified')
    expect(result.data.status_source).toBe('backend')
  })

  it('account:add 可信来源正常调用 AccountManager', async () => {
    const mockAccount = {
      id: 'acc-1',
      platform: 'wechat',
      name: '公众号',
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: { token: 'private' },
    }
    const deps = createMockDeps({
      AccountManager: {
        addAccount: vi.fn().mockResolvedValue(mockAccount),
        checkLocalCredentials: vi.fn(() => true),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('account:add')

    const result = await handler(TRUSTED_EVENT, 'wechat')

    expect(result).toEqual({
      code: 0,
      data: {
        id: 'acc-1',
        platform: 'wechat',
        name: '公众号',
        account_name: '公众号',
        status: 'unverified',
        status_source: 'absent-fallback',
        is_default: false,
        has_cookies: true,
        cookie_count: 1,
      },
      message: '账号添加成功',
    })
    expect(deps.AccountManager.addAccount).toHaveBeenCalledWith('wechat')
  })

  it('account:add 拒绝非法平台路径段', async () => {
    const deps = createMockDeps()
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('account:add')(TRUSTED_EVENT, '../wechat')

    expect(result).toEqual({ code: -2, message: '缺少或非法 platform 参数' })
    expect(deps.AccountManager.addAccount).not.toHaveBeenCalled()
  })

  it('account:list 拒绝外部来源，可信来源只返回脱敏字段', async () => {
    const deps = createMockDeps({
      AccountManager: {
        listAccounts: vi.fn().mockResolvedValue([{
          id: 'acc-1',
          platform: 'wechat_mp',
          name: '公众号',
          cookies: [{ name: 'session', value: 'secret' }],
          access_token: 'private',
        }]),
        checkLocalCredentials: vi.fn(() => true),
      },
    })
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)
    const handler = ipcMain._get('account:list')

    const denied = await handler(UNTRUSTED_EVENT)
    const result = await handler(TRUSTED_EVENT)

    expect(denied).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(result).toEqual({ code: 0, data: [{
      id: 'acc-1',
      platform: 'wechat_mp',
      name: '公众号',
      account_name: '公众号',
      status: 'unverified',
      status_source: 'absent-fallback',
      is_default: false,
      has_cookies: true,
      cookie_count: 1,
    }] })
  })
})

describe('account:set-active 启用态写入通道', () => {
  it('未登录（identityService 存在但 sub 缺失）fail-closed，不写后端', async () => {
    const deps = createMockDeps({
      AccountManager: {
        ...createMockDeps().AccountManager,
        setAccountActive: vi.fn(async () => ({ ok: true, is_active: false })),
      },
      identityService: { getState: vi.fn(() => ({ status: 'authenticated', user: null })) },
    })

    const result = await ipcMain_and_call(deps, 'account:set-active', {
      accountId: 'acc-1', platform: 'toutiao', isActive: false,
    })

    expect(result).toEqual({ code: -3, message: '无法识别当前用户' })
    expect(deps.AccountManager.setAccountActive).not.toHaveBeenCalled()
  })

  it('不可信来源一律拒绝', async () => {
    const deps = createMockDeps()
    deps.AccountManager.setAccountActive = vi.fn(async () => ({ ok: true, is_active: false }))
    const ipcMain = createMockIpcMain()
    registerHandlers(ipcMain, deps)

    const result = await ipcMain._get('account:set-active')(
      UNTRUSTED_EVENT, { accountId: 'acc-1', platform: 'toutiao', isActive: false })

    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
    expect(deps.AccountManager.setAccountActive).not.toHaveBeenCalled()
  })

  it.each([
    ['缺少参数对象', null],
    ['accountId 缺失', { platform: 'toutiao', isActive: false }],
    ['accountId 含路径段', { accountId: '../x', platform: 'toutiao', isActive: false }],
    ['platform 非法', { accountId: 'acc-1', platform: '../x', isActive: false }],
    ['isActive 是字符串', { accountId: 'acc-1', platform: 'toutiao', isActive: 'false' }],
    ['isActive 缺失', { accountId: 'acc-1', platform: 'toutiao' }],
  ])('%s → 校验失败且不写后端', async (_label, arg) => {
    const deps = createMockDeps()
    deps.AccountManager.setAccountActive = vi.fn(async () => ({ ok: true, is_active: false }))

    const result = await ipcMain_and_call(deps, 'account:set-active', arg)

    expect(result.code).toBe(-2)
    expect(deps.AccountManager.setAccountActive).not.toHaveBeenCalled()
  })

  it('合法请求把布尔原样交给唯一写者', async () => {
    const deps = createMockDeps()
    deps.AccountManager.setAccountActive = vi.fn(async () => ({ ok: true, is_active: false }))

    const result = await ipcMain_and_call(deps, 'account:set-active', {
      accountId: 'acc-1', platform: 'toutiao', isActive: false,
    })

    expect(deps.AccountManager.setAccountActive).toHaveBeenCalledWith('acc-1', 'toutiao', false)
    expect(result.code).toBe(0)
  })

  it('写者返回失败时 IPC 不得报成功', async () => {
    const deps = createMockDeps()
    deps.AccountManager.setAccountActive = vi.fn(async () => ({ ok: false, reason: 'backend-error', code: 404 }))

    const result = await ipcMain_and_call(deps, 'account:set-active', {
      accountId: 'acc-1', platform: 'toutiao', isActive: true,
    })

    expect(result.code).not.toBe(0)
    expect(result.message).toContain('backend-error')
  })
})

describe('登录态判定不得由 is_active 派生（正交性回归）', () => {
  function listDeps(source) {
    return createMockDeps({
      AccountManager: {
        listAccounts: vi.fn().mockResolvedValue([source]),
        checkLocalCredentials: vi.fn(() => true),
      },
    })
  }

  it.each([
    ['is_active=false', false],
    ['is_active=true', true],
    ['is_active 缺失', undefined],
  ])('后端无 status 且 %s → unverified / absent-fallback', async (_label, isActive) => {
    const source = { id: 'acc-1', platform: 'toutiao', name: '号' }
    if (isActive !== undefined) source.is_active = isActive

    const result = await ipcMain_and_call(listDeps(source), 'account:list')

    expect(result.data[0].status).toBe('unverified')
    expect(result.data[0].status_source).toBe('absent-fallback')
  })

  it('is_active 必须原样透传给渲染层（停用标记的唯一数据源）', async () => {
    const source = { id: 'acc-1', platform: 'toutiao', name: '号', status: 'active', is_active: false }

    const result = await ipcMain_and_call(listDeps(source), 'account:list')

    // 登录态来自后端，启用态来自后端，两者互不覆写。
    expect(result.data[0].status).toBe('active')
    expect(result.data[0].status_source).toBe('backend')
    expect(result.data[0].is_active).toBe(false)
  })
})
