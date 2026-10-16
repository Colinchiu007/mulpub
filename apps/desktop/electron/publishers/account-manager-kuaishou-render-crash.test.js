// @ts-check
/**
 * 复现并回归 2026-10-16 事故（白名单机制第五例）：
 * kuaishou（快手）账号有 Cookie 但 HTTP 登录检测不确定时，旧实现 fallthrough 到隐藏
 * sandbox 窗口 DOM 检测，加载 https://cp.kuaishou.com/ 触发原生渲染崩溃
 * （Electron 主进程 exit code 4294930435 = 0xC0000135 STATUS_DLL_NOT_FOUND，
 * crashpad not connected），vite 连带被杀 ⇒ 应用空白。
 *
 * 日志取证（同一实例的两轮，断在同一处）：
 *   21:29:58.632Z `checkLoginStatus: start kuaishou:a4505f45` → 无后续行
 *   22:20:58.567Z `checkLoginStatus: start kuaishou:a4505f45` → 22:21:00.504Z electron-exit code=4294930435
 * 第二轮尤其关键：该实例**已带** fix-hidden-window-render-crash 的成因侧修复（不再下发
 * `--no-sandbox`），第一轮 kuaishou 检测通过、30 分钟后的第二轮仍在同一处崩溃 ⇒
 * 「隐藏窗口加载该站点」这条路径本身必须切断，不能只靠启动参数调概率。
 *
 * 处置（与 toutiao / wechat_mp / baijiahao / zhihu 同族第五例，同一机制同一处置）：
 * kuaishou 纳入 RENDER_CRASH_PRONE_OPEN_PLATFORMS —— HTTP 不确定时判未确认
 * （INCONCLUSIVE），绝不开隐藏浏览器。
 *
 * 已知边界（如实）：本刀只切断隐藏窗口，**不给** kuaishou 补 checkHtml（zhihu 那例的第二半），
 * 故 kuaishou 在 HTTP 判定不足时会长期显示「未确认」。要恢复确定性结论，须先取得
 * cp.kuaishou.com 真机的登录页/已登录页形态证据，再按 zhihu 模式补 checkHtml。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const modulePath = './account-manager'

function loadAccountManager () {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

describe('checkLoginStatus 渲染崩溃保护（kuaishou 隐藏窗口原生崩溃 0xC0000135）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('kuaishou 有 Cookie 且 HTTP 检测不确定时，不开隐藏浏览器、不返回浏览器判定的成功', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualPlaywrightManager = require(playwrightPath)
    const actualHttpChecker = require(httpCheckerPath)

    // getContext 若被调用即代表走了会崩溃的隐藏窗口路径；用抛错实现来暴露它。
    const getContext = vi.fn(() => { throw new Error('RENDER_CRASH_PRONE: hidden browser must not be opened for kuaishou') })
    global.__registerMock(playwrightPath, { getContext })
    // 模拟 HTTP 检测不确定（返回 null），迫使代码在「降级浏览器」与「判未确认」间二选一。
    global.__registerMock(httpCheckerPath, { tryHttpLoginCheck: vi.fn().mockResolvedValue(null) })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'kuaishou',
        cookies: [{ name: 'kuaishou_sid', value: 'ks-secret', domain: '.kuaishou.com' }],
        localStorage: { token: 'active' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      const result = await accountManager.checkLoginStatus('kuaishou', 'kuaishou-crash-acc')

      // 核心安全不变量：绝不打开会崩溃的隐藏窗口
      expect(getContext).not.toHaveBeenCalled()
      // 且不得返回由浏览器 DOM 检测判定的成功
      expect(result.code).not.toBe('CHECK_LOGIN_SUCCESS')
      // 与 toutiao/wechat_mp/baijiahao/zhihu 同处置：判「未确认」而非「失效」
      expect(result.code).toBe('CHECK_LOGIN_INCONCLUSIVE')
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })
})
