// @ts-check
/**
 * 复现并回归 2026-09 事故：toutiao（今日头条）账号有 Cookie 但 HTTP 登录检测不确定时，
 * 旧实现 fallthrough 到隐藏 sandbox 窗口 DOM 检测，mp.toutiao.com 触发原生渲染崩溃
 * （crashpad not connected，Electron 主进程 exit code 0xFFFF7003）导致整个应用退出。
 * 代码里 RENDER_CRASH_PRONE_PLATFORMS 机制正是为拦截这类「隐藏窗口原生崩溃」而存在，
 * 但只覆盖了 tencent_video。修复：不并进前置黑名单（那会绕过 toutiao 的无 Cookie 快速路径，
 * 回归既有测试），改在「即将开隐藏浏览器」这一步前加独立守卫，HTTP 不确定时判未确认（INCONCLUSIVE）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const modulePath = './account-manager'

function loadAccountManager () {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

describe('checkLoginStatus 渲染崩溃保护（toutiao 隐藏窗口原生崩溃）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('toutiao 有 Cookie 且 HTTP 检测不确定时，不开隐藏浏览器、不返回浏览器判定的成功', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualPlaywrightManager = require(playwrightPath)
    const actualHttpChecker = require(httpCheckerPath)

    // getContext 若被调用即代表走了会崩溃的隐藏窗口路径；用抛错实现来暴露它。
    const getContext = vi.fn(() => { throw new Error('RENDER_CRASH_PRONE: hidden browser must not be opened for toutiao') })
    global.__registerMock(playwrightPath, { getContext })
    // 模拟 HTTP 检测不确定（返回 null），迫使代码在「降级浏览器」与「判未确认」间二选一。
    global.__registerMock(httpCheckerPath, { tryHttpLoginCheck: vi.fn().mockResolvedValue(null) })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'toutiao',
        cookies: [{ name: 'sessionid', value: 's3cr3t', domain: '.toutiao.com' }],
        localStorage: { token: 'active' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      const result = await accountManager.checkLoginStatus('toutiao', 'toutiao-crash-acc')

      // 核心安全不变量：绝不打开会崩溃的隐藏窗口
      expect(getContext).not.toHaveBeenCalled()
      // 且不得返回由浏览器 DOM 检测判定的成功
      expect(result.code).not.toBe('CHECK_LOGIN_SUCCESS')
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('toutiao 走 HTTP 检测确定有效时，返回 HTTP 结果且不开隐藏浏览器', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualPlaywrightManager = require(playwrightPath)
    const actualHttpChecker = require(httpCheckerPath)

    const getContext = vi.fn(() => { throw new Error('RENDER_CRASH_PRONE: hidden browser must not be opened for toutiao') })
    global.__registerMock(playwrightPath, { getContext })
    global.__registerMock(httpCheckerPath, { tryHttpLoginCheck: vi.fn().mockResolvedValue({ valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' }) })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'toutiao',
        cookies: [{ name: 'sessionid', value: 's3cr3t', domain: '.toutiao.com' }],
        localStorage: {},
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      await expect(accountManager.checkLoginStatus('toutiao', 'toutiao-http-acc'))
        .resolves.toEqual({ valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
      expect(getContext).not.toHaveBeenCalled()
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })
})
