// @ts-check
/**
 * login-status-monitor 回归测试（PRD F1.3 登录态定期检测）
 *
 * 锁定三条契约（对应「一键检测结论不固化」根因 RC-A）：
 *  1. 账号来源必须是 AccountManager.listAccounts()（后端 accounts.json 真源），
 *     而不是 Electron 本地 SQLite store —— 两者 accountId 不互通，读错等于没检测；
 *  2. 检测结论只能由 AccountManager.persistLoginState() 回写（登录态唯一写者），
 *     禁止 store.updateAccount()；
 *  3. checkLoginStatus 的第三态（valid === undefined）必须落 unverified，
 *     既不得冒充 expired（今日头条假阴性），也不得冒充 active（视频号假阳性）。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

__enableElectronMock()

let createLoginStatusMonitor
let accountManager
let loggerMock

function createLoggerMock () {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createMonitor (overrides = {}) {
  const store = { _ready: true, listAccounts: vi.fn(() => [{ id: 'legacy-row', platform: 'toutiao', status: 'active' }]), updateAccount: vi.fn(), ...overrides.store }
  const getMainWin = overrides.getMainWin || vi.fn(() => null)
  return createLoginStatusMonitor({
    store,
    accountManager,
    intervalMs: 30 * 60 * 1000,
    getMainWin,
  })
}

beforeEach(async () => {
  vi.resetModules()
  __resetElectronMock()
  loggerMock = createLoggerMock()
  __registerMock('./logger', loggerMock)
  accountManager = {
    listAccounts: vi.fn(async () => []),
    checkLoginStatus: vi.fn(async () => ({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })),
    persistLoginState: vi.fn(async () => ({ ok: true })),
    loginStatusFromCheckResult: vi.fn((r) => (r && r.valid === true ? 'active' : r && r.valid === false ? 'expired' : 'unverified')),
  }
  const mod = await import('./login-status-monitor.js')
  createLoginStatusMonitor = mod.createLoginStatusMonitor
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('login-status-monitor 账号真源与唯一写者', () => {
  it('从 AccountManager.listAccounts() 读取账号，不读本地 SQLite store', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-1', platform: 'toutiao', name: '头条号', status: 'active' },
    ])
    // 本地 SQLite 里存在的陈旧孤儿行（id 与后端不互通）必须被忽略
    const store = { _ready: true, listAccounts: vi.fn(() => [{ id: 'legacy-row', platform: 'toutiao', status: 'active' }]), updateAccount: vi.fn() }
    const monitor = createMonitor({ store })

    await monitor._runOnce()

    expect(accountManager.listAccounts).toHaveBeenCalled()
    expect(accountManager.checkLoginStatus).toHaveBeenCalledWith('toutiao', 'acc-1')
    expect(accountManager.checkLoginStatus).not.toHaveBeenCalledWith('toutiao', 'legacy-row')
  })

  it('检测判定失效时通过 persistLoginState 固化 expired（不写本地 store）', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-1', platform: 'toutiao', status: 'active' },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    const store = { _ready: true, listAccounts: vi.fn(() => []), updateAccount: vi.fn() }
    const monitor = createMonitor({ store })

    await monitor._runOnce()

    expect(accountManager.persistLoginState).toHaveBeenCalledTimes(1)
    const [accountId, platform, status, validatedAt] = accountManager.persistLoginState.mock.calls[0]
    expect([accountId, platform, status]).toEqual(['acc-1', 'toutiao', 'expired'])
    expect(Number.isNaN(new Date(validatedAt).getTime())).toBe(false)
    expect(store.updateAccount).not.toHaveBeenCalled()
  })

  // 单向证据规则（openspec/changes/fix-login-state-oscillation）：无定论既不是正向也不是
  // 负向证据，MUST NOT 覆盖既有结论 —— 下面两条取代旧的「无法判定即固化 unverified」单条用例。
  it('无定论 + 现状 active 且宽限期内有定论 → 不回写也不广播（终结 active↔unverified 振荡）', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-tv', platform: 'tencent_video', status: 'active', last_validated: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE', reason: 'http-check-inconclusive' })
    const sends = []
    const monitor = createMonitor({ getMainWin: () => ({ isDestroyed: () => false, webContents: { send: (...a) => sends.push(a) } }) })

    await monitor._runOnce()

    expect(accountManager.persistLoginState, '没有新证据就不该动真源').not.toHaveBeenCalled()
    expect(sends, '没有变化就不该广播').toHaveLength(0)
  })

  it('无定论 + 现状 active 但定论时间缺失 → 按超龄降级 unverified（不做无限期绿灯）', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-tv', platform: 'tencent_video', status: 'active' },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE', reason: 'http-check-inconclusive' })
    const monitor = createMonitor()

    await monitor._runOnce()

    expect(accountManager.persistLoginState).toHaveBeenCalledWith('acc-tv', 'tencent_video', 'unverified', expect.any(String))
  })

  it('无定论 + 现状 expired → 保持 expired（与既有粘滞一致，不得被翻成未确认）', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-dead', platform: 'toutiao', status: 'expired', last_validated: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    const monitor = createMonitor()

    await monitor._runOnce()

    expect(accountManager.persistLoginState).not.toHaveBeenCalled()
  })

  it('active 定论已超过宽限期后仍无定论 → 降级并广播（僵尸绿灯兜底）', async () => {
    process.env.MP_LOGIN_STATE_GRACE_DAYS = '7'
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-old', platform: 'douyin', status: 'active', last_validated: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' })
    const sends = []
    const monitor = createMonitor({ getMainWin: () => ({ isDestroyed: () => false, webContents: { send: (...a) => sends.push(a) } }) })

    await monitor._runOnce()

    expect(accountManager.persistLoginState).toHaveBeenCalledWith('acc-old', 'douyin', 'unverified', expect.any(String))
    expect(sends.map((s) => s[0])).toContain('account:status-changed')
    delete process.env.MP_LOGIN_STATE_GRACE_DAYS
  })

  it('检测有效时固化 active（覆盖此前遗留的 expired）', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-1', platform: 'toutiao', status: 'unverified' },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })
    const monitor = createMonitor()

    await monitor._runOnce()

    expect(accountManager.persistLoginState).toHaveBeenCalledWith('acc-1', 'toutiao', 'active', expect.any(String))
  })

  it('结论与后端一致时不回写，避免每 30 分钟无意义 PATCH', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-1', platform: 'toutiao', status: 'active' },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })
    const monitor = createMonitor()

    await monitor._runOnce()

    expect(accountManager.persistLoginState).not.toHaveBeenCalled()
  })

  it('已 expired 的账号跳过自动检测（粘滞，需重新登录或手动检测清除）', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-1', platform: 'toutiao', status: 'expired' },
    ])
    const monitor = createMonitor()

    await monitor._runOnce()

    expect(accountManager.checkLoginStatus).not.toHaveBeenCalled()
  })

  it('回写失败必须可见（落 warn 日志，不静默丢失固化）', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-1', platform: 'toutiao', status: 'active' },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    accountManager.persistLoginState.mockResolvedValue({ ok: false, reason: 'backend-error' })
    const monitor = createMonitor()

    await expect(monitor._runOnce()).resolves.toBeUndefined()

    const all = loggerMock.warn.mock.calls.map((c) => String(c[1] || c[0]))
    expect(all.some((line) => line.includes('acc-1') && line.includes('backend-error'))).toBe(true)
    // 固化失败时不得通知渲染层「已刷新」
    expect(accountManager.persistLoginState).toHaveBeenCalledTimes(1)
  })

  it('状态发生变化后通知渲染层刷新（含恢复为 active 的情况）', async () => {
    const send = vi.fn()
    const getMainWin = vi.fn(() => ({ isDestroyed: () => false, webContents: { send } }))
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-1', platform: 'toutiao', status: 'active' },
    ])
    accountManager.checkLoginStatus.mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    const monitor = createMonitor({ getMainWin })

    await monitor._runOnce()

    expect(send).toHaveBeenCalledWith('account:status-changed', expect.objectContaining({ expiredCount: 1, changedCount: 1 }))
  })

  it('无账号或 store 未就绪时直接返回', async () => {
    const monitor = createMonitor()
    await monitor._runOnce()
    expect(accountManager.persistLoginState).not.toHaveBeenCalled()

    accountManager.listAccounts.mockClear()
    const notReady = createLoginStatusMonitor({ store: { _ready: false }, accountManager, getMainWin: () => null })
    await notReady._runOnce()
    expect(accountManager.listAccounts).not.toHaveBeenCalled()
  })

  it('单账号检测抛异常不阻断整轮循环', async () => {
    accountManager.listAccounts.mockResolvedValue([
      { id: 'acc-bad', platform: 'toutiao', status: 'active' },
      { id: 'acc-ok', platform: 'baijiahao', status: 'active' },
    ])
    accountManager.checkLoginStatus.mockImplementation(async (platform, accountId) => {
      if (accountId === 'acc-bad') throw new Error('net down')
      return { valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
    })
    const monitor = createMonitor()

    await monitor._runOnce()

    expect(accountManager.persistLoginState).toHaveBeenCalledTimes(1)
    expect(accountManager.persistLoginState).toHaveBeenCalledWith('acc-ok', 'baijiahao', 'expired', expect.any(String))
  })
})
