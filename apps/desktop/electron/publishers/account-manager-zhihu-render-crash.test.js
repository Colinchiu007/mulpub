// @ts-check
/**
 * 复现并回归 2026-10-16 事故：zhihu（知乎）账号有 Cookie 但 HTTP 登录检测不确定时，
 * 旧实现 fallthrough 到隐藏 sandbox 窗口 DOM 检测，加载 https://www.zhihu.com/signin
 * 触发原生渲染崩溃（Electron 主进程 exit code 4294930435 = 0xC0000409
 * STATUS_STACK_BUFFER_OVERRUN，crashpad not connected），vite 连带被杀 ⇒ 应用空白。
 * 日志取证：08:47:13.465Z `checkLoginStatus: start zhihu:e10a1715 url=https://www.zhihu.com/signin`
 * 之后 9 秒 `08:47:22.379Z electron-exit pid=38720 code=4294930435`。
 *
 * 修复（与 toutiao / wechat_mp / baijiahao 同族第四例，同一机制同一处置）：
 * ① zhihu 纳入 RENDER_CRASH_PRONE_OPEN_PLATFORMS —— HTTP 不确定时判未确认（INCONCLUSIVE），
 *    绝不开隐藏浏览器；② zhihu 条目补 checkHtml（登录页/已登录页黑名单语义），
 *    让 HTTP 快速路径在打开任何窗口之前就能给出确定结论。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const modulePath = './account-manager'

function loadAccountManager () {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

describe('checkLoginStatus 渲染崩溃保护（zhihu 隐藏窗口原生崩溃 0xC0000409）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('zhihu 有 Cookie 且 HTTP 检测不确定时，不开隐藏浏览器、不返回浏览器判定的成功', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualPlaywrightManager = require(playwrightPath)
    const actualHttpChecker = require(httpCheckerPath)

    // getContext 若被调用即代表走了会崩溃的隐藏窗口路径；用抛错实现来暴露它。
    const getContext = vi.fn(() => { throw new Error('RENDER_CRASH_PRONE: hidden browser must not be opened for zhihu') })
    global.__registerMock(playwrightPath, { getContext })
    // 模拟 HTTP 检测不确定（返回 null），迫使代码在「降级浏览器」与「判未确认」间二选一。
    global.__registerMock(httpCheckerPath, { tryHttpLoginCheck: vi.fn().mockResolvedValue(null) })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'zhihu',
        cookies: [{ name: 'z_c0', value: 's3cr3t', domain: '.zhihu.com' }],
        localStorage: { token: 'active' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      const result = await accountManager.checkLoginStatus('zhihu', 'zhihu-crash-acc')

      // 核心安全不变量：绝不打开会崩溃的隐藏窗口
      expect(getContext).not.toHaveBeenCalled()
      // 且不得返回由浏览器 DOM 检测判定的成功
      expect(result.code).not.toBe('CHECK_LOGIN_SUCCESS')
      // 与 toutiao/wechat_mp/baijiahao 同处置：判「未确认」而非「失效」
      expect(result.code).toBe('CHECK_LOGIN_INCONCLUSIVE')
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('zhihu 必须在 HTTP_CHECK_APIS 里登记 checkHtml（登录检测能力锁）', () => {
    const httpChecker = require('./http-login-checker')
    const api = httpChecker.HTTP_CHECK_APIS.zhihu
    expect(api).toBeDefined()
    expect(typeof api.checkHtml).toBe('function')
    // 登录检测能力必须成立（hasLoginCheck 私有，但 isHttpCheckSupported 是其唯一出口）
    expect(httpChecker.isHttpCheckSupported('zhihu')).toBe(true)
  })
})

describe('zhihu checkHtml 黑名单语义（登录页标记 vs 已登录身份导航）', () => {
  const checkerPath = './http-login-checker'
  const real = require(checkerPath)
  const checkHtml = real.HTTP_CHECK_APIS.zhihu.checkHtml

  it('未登录登录页形态（SignFlow 登录容器、无身份导航）→ false（明确未登录）', () => {
    const html = '<!DOCTYPE html><html><body><div class="SignFlow HomepageSignFlow"><button>登录/注册</button></div><script>window.__INITIAL_STATE__={"signFlow":{}}</script></body></html>'
    expect(checkHtml(html)).toBe(false)
  })

  it('已登录首页形态（AppHeader 身份导航、无登录容器）→ true', () => {
    const html = '<!DOCTYPE html><html><body><header class="AppHeader"><img class="AppHeader-profileAvatar" src="x.jpg"><div class="ProfileHeader">张三</div></header><div id="js-initialData">{}</div></body></html>'
    expect(checkHtml(html)).toBe(true)
  })

  it('风控/空响应/结构变更（两者皆无）→ undefined（降级，由白名单判未确认）', () => {
    expect(checkHtml('')).toBe(undefined)
    expect(checkHtml(null)).toBe(undefined)
    expect(checkHtml('<html><body>请完成验证</body></html>')).toBe(undefined)
  })

  it('登录容器与身份导航同时出现（异常页面）→ undefined（不冒险）', () => {
    const html = '<div class="SignFlow">登录</div><img class="AppHeader-profileAvatar">'
    expect(checkHtml(html)).toBe(undefined)
  })
})
