// @ts-check
/**
 * 登录态判定收敛到 HTTP 单轨（2026-10-16）——行为锁 + 结构锁。
 *
 * 背景（真机事故，见 01-docs/BUGFIX-LOGIN-CHECK-HTTP-ONLY-2026-10-16.md）：
 * `checkLoginStatus` 在 HTTP/本地证据不足时会开**隐藏 sandbox 窗口**加载平台页面抓 DOM
 * 判登录态。该支路自 2026-09 起按平台逐个触发**原生渲染崩溃**（toutiao → wechat_mp →
 * 知乎(#3726) → kuaishou），现场为「应用日志戛然而止 + crashpad not connected + 主进程
 * 退出 0xC0000135」，用户视角就是应用突然关闭。既有的 `RENDER_CRASH_PRONE_OPEN_PLATFORMS`
 * 是**枚举式白名单**（把已知会崩的平台挑出来），因此默认值始终留在崩的那一侧——换个平台
 * 就再崩一次。
 *
 * 本变更把默认翻过来：只有显式登记在 `DOM_LOGIN_CHECK_ALLOWED_PLATFORMS` 的平台才允许
 * 开隐藏窗口，且该集合**默认为空**；`RENDER_CRASH_PRONE_OPEN_PLATFORMS` 保留为硬否决，
 * 并**先于**允许集判定（否决永远赢）。
 *
 * 参考产品实证：参考产品A（Electron 版）（Electron v4.14.20）`--no-sandbox`/`swiftshader`/GPU 开关命中
 * 均为 0、`loginStatus`/`isLogin`/`loginState` 标识符全 0，登录走**可见** BrowserView +
 * Cookie 提取、判定与发布走 HTTP API ⇒ 它根本没有"隐藏窗口抓 DOM 判登录"这条路。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const modulePath = './account-manager'

function loadAccountManager () {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

describe('checkLoginStatus：隐藏窗口兜底默认关闭（HTTP 单轨）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('既不在允许集也不在否决集的平台 + HTTP 不确定 ⇒ 绝不开隐藏窗口，判未确认', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualPlaywrightManager = require(playwrightPath)
    const actualHttpChecker = require(httpCheckerPath)

    // getContext 一旦被调用即代表走了会崩的隐藏窗口路径；用抛错实现把它暴露出来。
    const getContext = vi.fn(() => { throw new Error('HIDDEN_BROWSER: must not be opened by default') })
    global.__registerMock(playwrightPath, { getContext })
    // HTTP 检测返回 null（不确定），迫使代码在「降级隐藏窗口」与「判未确认」间二选一。
    global.__registerMock(httpCheckerPath, { tryHttpLoginCheck: vi.fn().mockResolvedValue(null) })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'bilibili',
        cookies: [{ name: 'SESSDATA', value: 'x', domain: '.bilibili.com' }],
        localStorage: { token: 'active' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      const result = await accountManager.checkLoginStatus('bilibili', 'http-only-acc')

      // 安全不变量：默认路径绝不触碰隐藏窗口
      expect(getContext).not.toHaveBeenCalled()
      // 结论必须是「未确认」，而不是由浏览器 DOM 判定的成功
      expect(result.code).toBe('CHECK_LOGIN_INCONCLUSIVE')
      expect(result.code).not.toBe('CHECK_LOGIN_SUCCESS')
      expect(result.reason).toBe('hidden-browser-disabled-default')
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('显式注入缝生效（正向控制）：注入 bilibili 后才允许开窗', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualPlaywrightManager = require(playwrightPath)
    const actualHttpChecker = require(httpCheckerPath)
    const page = {
      context: () => ({ addCookies: vi.fn() }),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue('https://www.bilibili.com/account/home'),
    }
    const getContext = vi.fn().mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) })
    global.__registerMock(playwrightPath, { getContext })
    global.__registerMock(httpCheckerPath, { tryHttpLoginCheck: vi.fn().mockResolvedValue(null) })
    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'bilibili',
        cookies: [{ name: 'SESSDATA', value: 'x', domain: '.bilibili.com' }],
        localStorage: { token: 'active' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)
      // 正向控制：只有显式注入才开窗 ⇒ 证明上一条用例的「零开窗」是被**默认空集**挡住的，
      // 而不是隐藏窗口路径整体死了（否则那条断言会退化成永真）。
      await accountManager.checkLoginStatus('bilibili', 'http-only-acc', { domLoginCheckAllowed: ['bilibili'] })
      expect(getContext).toHaveBeenCalled()
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('允许集默认为空集，且否决判定必须先于允许判定（结构锁）', () => {
    const fs = require('fs')
    const src = fs.readFileSync(require.resolve('./account-manager.js'), 'utf8')

    // ① 允许集必须存在且默认为空 —— 空集是"默认不开窗"这条不变量的载体
    expect(src).toMatch(/DOM_LOGIN_CHECK_ALLOWED_PLATFORMS\s*=\s*new Set\(\s*\[\s*\]\s*\)/)

    // ② 否决优先于允许：即使有人把某平台加进允许集，硬否决仍然赢
    const denyIdx = src.indexOf('RENDER_CRASH_PRONE_OPEN_PLATFORMS.has(platform)')
    const allowIdx = src.indexOf('(domLoginCheckAllowed instanceof Set')
    expect(denyIdx).toBeGreaterThan(-1)
    expect(allowIdx).toBeGreaterThan(-1)
    expect(denyIdx).toBeLessThan(allowIdx)
  })
  it('生产代码不得触碰策略注入面（_internals / domLoginCheckAllowed）', () => {
    // 允许集/否决集是**产品不变量**，不能变成"运行时可改的开关"：一旦生产代码
    // 读取 `_internals`，就等于给了一条无留痕改判定策略的路（本轮事故的上游形态
    // 正是"策略藏在默认值里、没人能一句话说清它是什么"）。这里做机械拦截。
    const fs = require('fs')
    const path = require('path')
    const root = path.resolve(require.resolve('./account-manager.js'), '..')
    const electronRoot = path.resolve(root, '..')
    const offenders = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue }
        if (!entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) continue
        const src = fs.readFileSync(full, 'utf8')
        // 除 account-manager.js 自身（注入缝的实现处）外，生产代码既不得读 _internals，
        // 也不得触碰注入面 —— 后者会把「默认不开窗」变成某个调用点的私有策略。
        //
        // 判据取**片段级**而非整名：第二轮外部复核指出「字面量扫描漏掉动态构造」
        // （例：`const k = 'domLoginCheck' + 'Allowed'; o[k] = ['bilibili']`）。
        // 片段 `domLoginCheck`（大小写不敏感）在拼接写法里**依然出现**，故能拦住该例；
        // 仍不可机械拦截的是「把属性名切成互不相邻的片段再拼」（如 ['dom','Login'].join('')），
        // 这类代码同时绕过本仓所有命名约定，属通用边界，如实登记而不假装闭合。
        if (path.basename(full) === 'account-manager.js') continue
        const forbidden = [/\._internals\b/, /domLoginCheck/i, /DOM_LOGIN_CHECK_ALLOWED/]
        if (forbidden.some((re) => re.test(src))) offenders.push(path.relative(electronRoot, full))
      }
    }
    walk(electronRoot)
    expect(offenders).toEqual([])
  })
})