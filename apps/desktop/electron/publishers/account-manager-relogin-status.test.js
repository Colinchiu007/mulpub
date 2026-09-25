// @ts-check
/**
 * account-manager — updateCapturedAccount 重新登录状态回写回归
 * （登录态检测口径统一修复 2026-09-22）
 *
 * 缺陷背景：批量登录标签点「保存账号」→ saveAccountTabCredentials →
 * updateCapturedAccount 只 PATCH 元数据和 last_validated，不把后端 status
 * 从 expired 改回 active。而 toPublicAccount 的 backendExpiredFresh 逻辑
 * （DB status=expired 且 last_validated 在 2 小时内 → 尊重 expired）使账号页
 * 在保存凭证后仍显示失效——用户实测"打开头条号确认已登录，但账号页状态没更新"。
 *
 * 契约：凭证保存成功 = 一次成功的主动验证，必须同步回写 status=active +
 * last_validated，让所有读取方（账号页列表 / 首页横幅 / login-status-monitor）
 * 看到同一份最新状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const modulePath = './account-manager'

function loadAccountManager() {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

describe('updateCapturedAccount — 保存凭证即回写 status=active', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    global.__electronMock.app.getPath = function () { return 'C:/test-user-data' }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('PATCH 后端元数据携带 status=active 与 last_validated（重新登录成功语义）', async () => {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'acc-1', platform: 'toutiao', status: 'expired' } })
      .mockResolvedValueOnce({ code: 0, data: {} })
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)

    const saved = await accountManager.updateCapturedAccount(
      'toutiao',
      { cookies: [{ name: 'sid_tt', value: 'fresh', domain: '.toutiao.com' }], name: '头条号' },
      'acc-1'
    )

    const patchCall = requestBackend.mock.calls.find(call => call[0] === 'PATCH')
    expect(patchCall, 'updateCapturedAccount 必须 PATCH /api/accounts/:id').toBeDefined()
    expect(patchCall[1]).toMatch(/\/api\/accounts\//)
    expect(patchCall[2]).toMatchObject({ status: 'active' })
    expect(typeof patchCall[2].last_validated).toBe('string')
    // 返回对象也要携带 active 状态，供调用方（auth:open-login / 保存标签）直接复用
    expect(saved.status).toBe('active')
  })

  it('凭证文件更新失败时抛错且不得回写 active（防止半成功状态）', async () => {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'acc-2', platform: 'toutiao', status: 'expired' } })
      .mockResolvedValueOnce({ code: 0, data: {} })
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(false)

    await expect(accountManager.updateCapturedAccount(
      'toutiao',
      { cookies: [{ name: 'sid_tt', value: 'fresh', domain: '.toutiao.com' }] },
      'acc-2'
    )).rejects.toThrow('加密凭证更新失败')

    // 凭证未落盘 → 不允许把 DB status 置为 active（PATCH 只能不存在，或不含 active）
    const patchCall = requestBackend.mock.calls.find(call => call[0] === 'PATCH')
    if (patchCall) expect(patchCall[2] && patchCall[2].status).not.toBe('active')
  })
})

/**
 * saveCapturedAccount（新登录创建路径）—— 登录态固化同族契约回归
 * （新增账号显示「未确认」Bug 修复 2026-09-25）
 *
 * 缺陷背景：创建路径 POST /api/accounts 不下发 status，后端 create_account 以
 * DEFAULT_ACCOUNT_STATUS='unverified' 落库；主进程保存凭证成功后不做任何登录态
 * 固化，于是「刚在登录窗口里登录成功并捕获凭证」的新账号在账号页一律显示「未确认」，
 * 必须再手动点一次检测才变「已登录」。updateCapturedAccount 早在 #2205 就按
 * 「凭证落盘 = 一次成功的主动登录」回写 active，但契约只锁住了那一条同族路径。
 *
 * 契约：任何成功捕获并落盘凭证的入口都必须固化 status=active + last_validated，
 * 且顺序不可颠倒——凭证未落盘时不允许把真源置为 active（防半成功状态）。
 */
describe('saveCapturedAccount — 新建账号保存凭证即回写 status=active', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    global.__electronMock.app.getPath = function () { return 'C:/test-user-data' }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POST 创建 + 凭证落盘成功后 PATCH status=active，返回值同样携带 active', async () => {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'acc-new', platform: 'douyin', status: 'unverified' } })
      .mockResolvedValueOnce({ code: 0, data: {} })
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)

    const saved = await accountManager.saveCapturedAccount(
      'douyin',
      { cookies: [{ name: 'sessionid', value: 'fresh', domain: '.douyin.com' }], name: '抖音创作者中心' }
    )

    const patchCall = requestBackend.mock.calls.find(call => call[0] === 'PATCH')
    expect(patchCall, 'saveCapturedAccount 必须在凭证落盘后 PATCH /api/accounts/:id 固化登录态').toBeDefined()
    expect(patchCall[1]).toMatch(/\/api\/accounts\/acc-new$/)
    expect(patchCall[2]).toMatchObject({ status: 'active' })
    expect(typeof patchCall[2].last_validated).toBe('string')
    // 返回值携带 active：auth:open-login 把该对象直接交给 toPublicAccount 渲染，
    // 缺它则「新增成功」的那一帧仍显示未确认。
    expect(saved.status).toBe('active')
    expect(typeof saved.last_validated).toBe('string')
  })

  it('固化顺序：凭证落盘成功在前，PATCH status=active 在后', async () => {
    const accountManager = loadAccountManager()
    const order = []
    const saveCredentialSpy = vi.spyOn(accountManager.credentialStore, 'saveCredential')
      .mockImplementation(() => { order.push('credential'); return true })
    vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockImplementation(async (method) => {
        order.push(method)
        if (method === 'POST') return { code: 0, data: { id: 'acc-order', platform: 'douyin' } }
        return { code: 0, data: {} }
      })
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)

    await accountManager.saveCapturedAccount('douyin', {
      cookies: [{ name: 'sessionid', value: 'fresh', domain: '.douyin.com' }]
    })

    expect(order.slice(0, 3)).toEqual(['POST', 'credential', 'PATCH'])
    expect(saveCredentialSpy).toHaveBeenCalledTimes(1)
  })

  it('凭证落盘失败时回滚账号且不得出现 status=active（防半成功）', async () => {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'acc-bad', platform: 'douyin' } })
      .mockResolvedValueOnce({ code: 0, data: {} })
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(false)

    await expect(accountManager.saveCapturedAccount('douyin', {
      cookies: [{ name: 'sessionid', value: 'fresh', domain: '.douyin.com' }]
    })).rejects.toThrow('加密凭证保存失败，账号创建已回滚')

    const activePatch = requestBackend.mock.calls
      .filter(call => call[0] === 'PATCH')
      .find(call => call[2] && call[2].status === 'active')
    expect(activePatch, '凭证未落盘时不允许把真源置为 active').toBeUndefined()
  })
})
