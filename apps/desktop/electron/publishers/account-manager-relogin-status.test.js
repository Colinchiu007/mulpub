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
