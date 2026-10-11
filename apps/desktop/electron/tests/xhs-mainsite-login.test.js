// @ts-check
/**
 * 小红书二段式登录（主站会话补抓）契约测试——TDD 红灯先行。
 *
 * 背景（xhs-note-align 执行记录遗留）：edith note API 需要主站 web_session cookie，
 * 而登录窗 URL 是 creator.xiaohongshu.com——用户在该页登录后 web_session 从未被设置，
 * 凭据快照里永远缺它（-100 无登录信息的根因）。
 *
 * 方案：登录窗检测到 creator 域登录成功后，**自动补跳主站** www.xiaohongshu.com（带凭据
 * 请求主站会话），等主站完成跳转再抓凭据快照。
 *
 * 契约（auth-view-manager）：
 *  C1 PLATFORM_LOGIN_URLS.xiaohongshu 不变（仍 creator 域，登录体验一致）
 *  C2 新增 PLATFORM_POST_LOGIN_REDIRECT.xiaohongshu = 'https://www.xiaohongshu.com/'
 *     —— 登录成功后登录窗应 loadURL 该地址再等待抓取
 *  C3 二段式只对配置了 redirect 的平台生效；未配置平台零回归（仍直接抓取）
 *  C4 主站抓取超时兜底：redirect 后 15s 内未就绪则按现有快照继续（不阻断登录）
 *
 * 结构锁 + 行为锁并存：manager 源码级字符串锁防「忘了接线」，行为锁（makeStubs +
 * runAutoCompletion）锁真实控制流——redirect 只对配置平台触发、超时兜底不阻断。
 */
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const defs = require('@multi-publish/shared-utils/src/platform-definitions')
// 用 __dirname 解析：readFileSync 相对路径是相对 cwd（apps/desktop）的，直接写仓库根相对路径会拼出双重路径
const managerSrc = readFileSync(
  path.resolve(__dirname, '../services/auth-view-manager.js'), 'utf8')
// 二段式逻辑自包含于独立模块（auth-view-manager 在逐文件行数门禁挂账，膨胀超容差必须拆分）
const redirectMod = require('../services/auth-post-login-redirect')
const redirectModSrc = readFileSync(
  path.resolve(__dirname, '../services/auth-post-login-redirect.js'), 'utf8')

// ─── 行为锁公共设施 ───────────────────────────────
// AuthViewManager 构造函数无副作用（只置空字段），但 require 本体时会连带 require
// electron / logger / auth-view-session 等主进程模块。vitest deps.inline 含 electron，
// 主进程 require 链在测试环境可加载（既有 account-manager 等测试同款做法）。
const AuthViewManager = require('../services/auth-view-manager')

const XHS = 'xiaohongshu'
const ZHIHU = 'zhihu' // 未配置 redirect 的对照平台

/**
 * 构造一个只桩掉二段式会碰到的成员的 manager 实例。
 *
 * CCG 评审 i5：改走真实构造函数（constructor 只置空字段，无副作用），
 * 不再 Object.create(prototype) 手工补 20 个实例字段——字段更名/构造逻辑变更
 * 时测试静默漂移的风险消掉，桩面收敛到「二段式真正碰到的成员」。
 *
 * CCG 评审 i4：_extractAuthData 不再无条件返回含 web_session 的快照——它按
 * session.cookies.get 桩的返回实时投影，二段式是否真把主站会话补进快照，
 * 由用例对快照 cookies 断言（锁结果而非锁调用）。
 *
 * @param {{ redirect?: boolean, loadURL?: (url: string) => Promise<void>,
 *           sessionCookies?: Array<{name: string, value?: string, domain?: string}> }} opts
 */
function makeManager (opts = {}) {
  const inst = new AuthViewManager()
  // 会话 cookie 桩：补跳前后可变（用例里往里 push web_session 模拟主站种 cookie）
  const sessionCookies = opts.sessionCookies || [
    // creator 会话标记（登录页本身产出，标记名取自 PLATFORM_SESSION_COOKIE_MARKERS）
    { name: 'access-token-creator.xiaohongshu.com', value: 'x', domain: '.xiaohongshu.com' },
  ]
  inst.mainWindow = null
  inst.currentView = {
    webContents: {
      loadURL: opts.loadURL || vi.fn(async () => {}),
      // CCG 评审 i6 的 stop() 落点：真实 WebContents 恒有该方法
      stop: vi.fn(),
      session: { cookies: { get: async () => sessionCookies.slice() } },
    },
  }
  inst.currentPlatform = opts.redirect === false ? ZHIHU : XHS
  inst.currentAccountId = 'auth-test'
  // _createLoginAttempt 要求三者齐备（view/platform/resolveLogin），resolveLogin 缺席会返回 null
  inst._resolveLogin = vi.fn()
  inst._rejectLogin = vi.fn()
  inst._extractAuthData = vi.fn(async (view) => ({
    // 实时投影会话 cookie 桩：快照内容 = 会话状态，用例可断言 web_session 是否补进快照
    cookies: sessionCookies.slice(),
    name: 't', localStorage: {}, indexedDB: {}, accountInfo: {},
  }))
  inst.close = vi.fn()
  inst.__sessionCookies = sessionCookies
  return inst
}

/**
 * 走一遍 CDP 自动完成路径（_scheduleAutoCompletion 的 3s 定时器回调）。
 * 用 fake timers 在各用例内推进时钟；这里只负责造 attempt。
 * @param {ReturnType<typeof makeManager>} inst
 */
function makeAttempt (inst) {
  const attempt = inst._createLoginAttempt()
  attempt.initialRedirectPhase = false
  return attempt
}

describe('小红书二段式登录（主站会话补抓）', () => {
  it('C2 平台定义导出 PLATFORM_POST_LOGIN_REDIRECT.xiaohongshu = www 主站', () => {
    expect(defs.PLATFORM_POST_LOGIN_REDIRECT).toBeDefined()
    expect(defs.PLATFORM_POST_LOGIN_REDIRECT.xiaohongshu).toBe('https://www.xiaohongshu.com/')
  })

  it('C1 登录 URL 表不变（creator 域，用户登录体验一致）', () => {
    expect(defs.PLATFORM_LOGIN_URLS.xiaohongshu).toBe('https://creator.xiaohongshu.com/')
  })

  it('C3a 结构锁：二段式模块接线 redirect 表与 15s 兜底常量，manager 接入该模块', () => {
    // 结构锁：逻辑在 auth-post-login-redirect.js，manager 里接进了登录完成路径。
    // 不锁 www.xiaohongshu.com 字面量——URL 该来自查表（PLATFORM_POST_LOGIN_REDIRECT），
    // 字面量耦合会逼「改表值必须同步改实现」的反向维护。
    expect(redirectModSrc).toContain('PLATFORM_POST_LOGIN_REDIRECT')
    expect(redirectModSrc).toMatch(/POST_LOGIN_REDIRECT_WAIT_MS/)
    expect(managerSrc).toContain('waitForPostLoginSession')
  })

  it('C3b 行为锁：配置了 redirect 的平台会 loadURL 主站，快照在主站会话落地后才产出', async () => {
    // 就绪判据 = 凭证轮询命中（r2-i1），不再依赖 loadURL resolve。
    // 会话桩在第 2s 种下 web_session（模拟主站 JS/XHR 异步种 cookie）——
    // CCG 评审 i4：断言快照**包含 web_session**（锁结果），而非只锁调用了 loadURL。
    const loadURL = vi.fn(async () => {})
    vi.useFakeTimers()
    try {
      const inst = makeManager({ redirect: true, loadURL })
      const attempt = makeAttempt(inst)
      inst._scheduleAutoCompletion('cdp', attempt)
      // 3s 自动完成定时器触发：应立即补跳主站（loadURL 只发起不等待）
      await vi.advanceTimersByTimeAsync(3100)
      expect(loadURL).toHaveBeenCalledWith(defs.PLATFORM_POST_LOGIN_REDIRECT[XHS])
      // 主站会话未落地时不能先 settle（否则抓到的还是缺 web_session 的 creator 快照）
      expect(inst._activeLoginAttempt).not.toBeNull()
      expect(inst._extractAuthData).not.toHaveBeenCalled()
      // 2s 时主站种下 web_session → 下一轮 500ms 轮询命中 → settle
      inst.__sessionCookies.push({ name: 'web_session', value: 'y', domain: '.xiaohongshu.com' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(inst._activeLoginAttempt).toBeNull()
      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
      expect(inst.close).toHaveBeenCalled()
      // 快照结果锁：主站会话必须真的进了凭据快照（否则 -100 根因没闭合）
      const snapshot = await inst._extractAuthData.mock.results[0].value
      expect(snapshot.cookies.map(c => c.name)).toContain('web_session')
    } finally {
      vi.useRealTimers()
    }
  })

  it('C3c 行为锁：未配置 redirect 的平台零回归（直接抓取，不 loadURL）', async () => {
    vi.useFakeTimers()
    try {
      const inst = makeManager({ redirect: false })
      const loadURL = vi.fn(async () => {})
      inst.currentView.webContents.loadURL = loadURL
      const attempt = makeAttempt(inst)
      inst._scheduleAutoCompletion('cdp', attempt)
      await vi.advanceTimersByTimeAsync(3100)
      expect(loadURL).not.toHaveBeenCalled()
      // 直接 settle：快照照常产出
      expect(inst._activeLoginAttempt).toBeNull()
      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('C3d 行为锁：会话已含 web_session 时短路补跳（省一次主站整页往返）', async () => {
    // CCG 评审 i2：早前登录已种下主站会话 → 不再补跳，直接抓快照 settle
    vi.useFakeTimers()
    try {
      const inst = makeManager({
        redirect: true,
        sessionCookies: [
          { name: 'access-token-creator.xiaohongshu.com', value: 'x', domain: '.xiaohongshu.com' },
          { name: 'web_session', value: 'already-here', domain: '.xiaohongshu.com' },
        ],
      })
      const loadURL = vi.fn(async () => {})
      inst.currentView.webContents.loadURL = loadURL
      const attempt = makeAttempt(inst)
      inst._scheduleAutoCompletion('cdp', attempt)
      await vi.advanceTimersByTimeAsync(3100)
      expect(loadURL).not.toHaveBeenCalled()
      expect(inst._activeLoginAttempt).toBeNull()
      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('C4 行为锁：主站 15s 兜底——超时后 stop 在途导航、短重试后按现有快照继续 settle，不阻断登录', async () => {
    // loadURL 永不 resolve 且凭证始终不出现：主站挂死/风控迟滞，兜底必须生效。
    // 计时（r2-i4）：等待预算从平台定义取（POST_LOGIN_REDIRECT_WAIT_MS=15s），
    // 预算耗尽后还有一次 2.5s 短重试（r2-i5），共 17.5s + 轮询余量。
    const WAIT_MS = defs.POST_LOGIN_REDIRECT_WAIT_MS
    const RETRY_MS = redirectMod.PROOF_RETRY_DELAY_MS
    const loadURL = vi.fn(() => new Promise(() => {}))
    vi.useFakeTimers()
    try {
      const inst = makeManager({ redirect: true, loadURL })
      const stop = inst.currentView.webContents.stop
      const attempt = makeAttempt(inst)
      inst._scheduleAutoCompletion('cdp', attempt)
      await vi.advanceTimersByTimeAsync(3100)
      expect(inst._activeLoginAttempt).not.toBeNull()
      // 兜底窗口耗尽：stop 在途导航（r1-i6 时序竞争防护），race 返回
      await vi.advanceTimersByTimeAsync(WAIT_MS + 100)
      expect(stop).toHaveBeenCalled()
      // 一次性短重试（r2-i5）：凭证仍不出现 → 最终校验留失败标记、按当前快照 settle
      await vi.advanceTimersByTimeAsync(RETRY_MS + 100)
      expect(inst._activeLoginAttempt).toBeNull()
      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
      expect(inst.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('C4b 行为锁：兜底窗口内凭证出现（轮询命中）→ 立即 settle，不等满预算', async () => {
    // r2-i1 就绪判据 = 凭证真出现：轮询 500ms 一次，会话桩在第 6s 种下 web_session，
    // settle 应发生在 ≈6s（远早于 15s 预算耗尽）。
    const WAIT_MS = defs.POST_LOGIN_REDIRECT_WAIT_MS
    const loadURL = vi.fn(async () => {})
    vi.useFakeTimers()
    try {
      const inst = makeManager({ redirect: true, loadURL })
      const attempt = makeAttempt(inst)
      inst._scheduleAutoCompletion('cdp', attempt)
      await vi.advanceTimersByTimeAsync(3100)
      // 6s 时主站种下会话（模拟 JS/XHR 异步种 cookie，晚于 did-finish-load）
      await vi.advanceTimersByTimeAsync(3000)
      inst.__sessionCookies.push({ name: 'web_session', value: 'late-but-arrived', domain: '.xiaohongshu.com' })
      await vi.advanceTimersByTimeAsync(3100)
      expect(inst._activeLoginAttempt).toBeNull()
      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
      // 快照锁：晚到的主站会话必须进了凭据快照
      const snapshot = await inst._extractAuthData.mock.results[0].value
      expect(snapshot.cookies.map(c => c.name)).toContain('web_session')
      expect(inst.close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
