import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

__enableElectronMock()

let AuthViewManager
let base
let reclaimCjs

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  __resetElectronMock()
  // 端到端：把 electron mock 的 userData 指到真实临时目录，回收动作直接在盘上验，
  // 不靠模块 spy（manager 用 CJS require 拿依赖，import() 得到的实例拦不到）。
  base = fs.mkdtempSync(path.join(os.tmpdir(), `mp-auth-wire-${process.pid}-`))
  fs.mkdirSync(path.join(base, 'session', 'Partitions'), { recursive: true })
  __electronMock.app.getPath = vi.fn(() => base)
  const module = await import('./auth-view-manager.js')
  AuthViewManager = module.default || module
  // 登记表是模块级状态：断言它必须用生产真正拿到的那一份实例（CJS require）
  reclaimCjs = require('./auth-partition-reclaim.js')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  try { fs.rmSync(base, { recursive: true, force: true }) } catch (_e) { /* 临时目录清不掉不影响结论 */ }
})

function mkPartitionDirs (names) {
  const root = path.join(base, 'session', 'Partitions')
  for (const n of names) fs.mkdirSync(path.join(root, n), { recursive: true })
}

function listed () {
  return fs.readdirSync(path.join(base, 'session', 'Partitions')).sort()
}

function createView (cookies = []) {
  const session = {
    cookies: { get: vi.fn().mockResolvedValue(cookies) },
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
  }
  return {
    session,
    view: {
      setBounds: vi.fn(),
      setZoomFactor: vi.fn(),
      setVisible: vi.fn(),
      webContents: {
        session,
        isDestroyed: () => false,
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        executeJavaScript: vi.fn().mockResolvedValue(''),
        getURL: vi.fn().mockReturnValue('https://mp.weixin.qq.com/'),
        close: vi.fn(),
        debugger: { attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn().mockResolvedValue({}), on: vi.fn() },
      },
    },
  }
}

function createMainWindow () {
  return {
    getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  }
}

function arrange (cookies = []) {
  const { view, session } = createView(cookies)
  __electronMock.WebContentsView = vi.fn(function () { return view })
  __electronMock.session.fromPartition = vi.fn(function () { return session })
  const manager = new AuthViewManager()
  manager.setMainWindow(createMainWindow())
  return { manager, view, session }
}

const WECHAT_COOKIE = [{ name: 'slave_user', value: 'u1', domain: '.mp.weixin.qq.com' }]

// C2 修复后，close() 的清空要走「先探 Cookie 再决定」的异步链；断言前必须排空微任务
async function flush () {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

describe('AuthViewManager ↔ 登录槽位（2026-10-21：同平台复用分区，缓存跨次留存）', () => {
  it('openLogin 落到按平台复用的稳定分区目录（同一平台两次登录同一目录）', async () => {
    const { manager } = arrange()
    manager.openLogin('toutiao', 0)
    await flush()
    const partitions = __electronMock.session.fromPartition.mock.calls.map((c) => c[0])
    expect(partitions).toContain('persist:auth-auth-toutiao-slot')

    manager.close()
    await flush()

    const { manager: manager2 } = arrange()
    manager2.openLogin('toutiao', 0)
    await flush()
    const partitions2 = __electronMock.session.fromPartition.mock.calls.map((c) => c[0])
    expect(partitions2).toContain('persist:auth-auth-toutiao-slot')
    manager2.close()
    await flush()
  })

  it('槽位目录名不含时间戳 —— 每次登录都是同一个目录，缓存才能跨次留存', async () => {
    const { manager } = arrange()
    manager.openLogin('toutiao', 0)
    await flush()
    const slotNames = __electronMock.session.fromPartition.mock.calls
      .map((c) => c[0])
      .filter((p) => p.includes('toutiao'))
    expect(slotNames.length).toBeGreaterThan(0)
    for (const p of slotNames) {
      expect(p).not.toMatch(/-\d{10,}$/)
    }
    manager.close()
    await flush()
  })

  it('导航前先清掉槽位里的旧凭证：loadURL 必须发生在清理之后', async () => {
    const { manager, view, session } = arrange(WECHAT_COOKIE)
    const order = []
    session.clearStorageData.mockImplementation(function () { order.push('wipe'); return Promise.resolve(undefined) })
    view.webContents.loadURL.mockImplementation(function () { order.push('load'); return Promise.resolve(undefined) })
    manager.openLogin('wechat_mp', 0)
    await flush()
    // 复用槽位后凭证隔离靠这一步：不清就会带着上一个账号的登录态直接进已登录页
    expect(order).toEqual(['wipe', 'load'])
    manager.close()
    await flush()
  })

  it('槽位里没有旧凭证时也照样清理（隔离不靠「有没有 Cookie」判定）', async () => {
    const { manager, view, session } = arrange([])
    const order = []
    session.clearStorageData.mockImplementation(function () { order.push('wipe'); return Promise.resolve(undefined) })
    view.webContents.loadURL.mockImplementation(function () { order.push('load'); return Promise.resolve(undefined) })
    manager.openLogin('wechat_mp', 0)
    await flush()
    expect(order).toEqual(['wipe', 'load'])
    manager.close()
    await flush()
  })

  it('清理失败不阻断登录：导航照常发生（清理是旁路）', async () => {
    const { manager, view, session } = arrange(WECHAT_COOKIE)
    session.clearStorageData.mockRejectedValue(new Error('wipe boom'))
    manager.openLogin('wechat_mp', 0)
    await flush()
    expect(view.webContents.loadURL).toHaveBeenCalled()
    manager.close()
    await flush()
  })
})

describe('AuthViewManager ↔ 分区回收接线（#2701，端到端落在真目录上）', () => {
  it('openLogin 开局回收上一轮遗留：非最新删除、最新与账号分区保留', async () => {
    mkPartitionDirs([
      'auth-auth-wechat_mp-1790000000001',
      'auth-auth-wechat_mp-1790000000002',
      'auth-auth-wechat_mp-1790000000003',
      'auth-auth-wechat_mp-1790000000004',
      'auth-auth-wechat_mp-1790000000005',
      'auth-auth-wechat_mp-1790000000006',
      'auth-auth-wechat_mp-1790000000007',
      'account-18c23d34',
      'logto-identity',
    ])
    const { manager } = arrange()
    manager.openLogin('wechat_mp', 0)
    vi.runAllTimers()
    const left = listed()
    // 本次会话的分区在 mock 下不落盘。#2734 起回收端保留「最近 PROBE_LIMIT 份」而不是末位一份：
    // 7 份夹具 ⇒ 删最旧 2 份、留最近 5 份。
    expect(left.filter(n => n.startsWith('auth-auth-wechat_mp-'))).toEqual([
      'auth-auth-wechat_mp-1790000000003',
      'auth-auth-wechat_mp-1790000000004',
      'auth-auth-wechat_mp-1790000000005',
      'auth-auth-wechat_mp-1790000000006',
      'auth-auth-wechat_mp-1790000000007',
    ])
    expect(left).toContain('account-18c23d34')
    expect(left).toContain('logto-identity')
    // 兜底读取的中性现在按「候选集」判，而不是按「末位那一份」判：回收后候选集必须就是留下的这 5 份，
    // 且顺序从新到旧（定位端与回收端共用同一条窗口边界）。
    const { listAuthPartitionCandidates } = await import('./auth-partition.js')
    expect(listAuthPartitionCandidates('wechat_mp', null, base)).toEqual([
      'auth-auth-wechat_mp-1790000000007',
      'auth-auth-wechat_mp-1790000000006',
      'auth-auth-wechat_mp-1790000000005',
      'auth-auth-wechat_mp-1790000000004',
      'auth-auth-wechat_mp-1790000000003',
    ])
    manager.close()
  })

  it('close() 后本次会话真正持有的 session 被清空（递错句柄等于没清）', async () => {
    const { manager, session } = arrange([])
    manager.openLogin('douyin', 0)
    // 开局清理（登录槽位：一律清理）先落定，再看关闭时的行为
    await flush()
    session.clearStorageData.mockClear()
    manager.close()
    await flush()
    expect(session.clearStorageData).toHaveBeenCalledTimes(1)
    // 登录槽位要跨多次登录存活（HTTP 缓存就在里面）⇒ 清存储但**不清缓存**。
    // 少了这条断言，"顺手把缓存也清了"这种回退会静默通过。
    expect(session.clearCache).not.toHaveBeenCalled()
  })

  it('取到凭证入库的会话不得被清空——发布链的磁盘兜底要看它', async () => {
    const { manager, session } = arrange(WECHAT_COOKIE)
    manager.openLogin('wechat_mp', 0)
    // 开局清理（登录槽位：复用分区 ⇒ 必须先清掉上一轮的凭证）先落定，再看关闭时的行为
    await flush()
    session.clearStorageData.mockClear()
    await manager.completeLogin()
    await flush()
    expect(session.clearStorageData).not.toHaveBeenCalled()
  })

  it('超时终态的会话同样走回收（timeout 不是「留着不管」的出口）', async () => {
    const { manager, session } = arrange([])
    manager.openLogin('wechat_mp', 5000)
    await flush()
    session.clearStorageData.mockClear()
    const attempt = manager._activeLoginAttempt
    manager._settleLogin(attempt, { timeout: true })
    await flush()
    expect(session.clearStorageData).toHaveBeenCalledTimes(1)
  })

  it('取消但页面里已有该平台 Cookie 的会话不得被清（C2：取消 ≠ 没有可用登录态）', async () => {
    const { manager, session } = arrange(WECHAT_COOKIE)
    manager.openLogin('wechat_mp', 0)
    await flush()
    session.clearStorageData.mockClear()
    manager.close()
    await flush()
    expect(session.clearStorageData).not.toHaveBeenCalled()
  })

  it('同一会话成功取证后，后续未取证的会话仍会被清（跨会话不串）', async () => {
    const ok = arrange(WECHAT_COOKIE)
    ok.manager.openLogin('wechat_mp', 0)
    await ok.manager.completeLogin()
    // 假时钟下 Date.now() 冻结 ⇒ 两次登录会拿到同一 accountId，推进 5ms 才是生产形态
    vi.advanceTimersByTime(5)
    const bad = arrange([])
    bad.manager.openLogin('wechat_mp', 0)
    await flush()
    bad.session.clearStorageData.mockClear()
    bad.manager.close()
    await flush()
    expect(bad.session.clearStorageData).toHaveBeenCalledTimes(1)
  })

  it('loginSilent 用完即清自己的 silent-auth 分区并回收目录', async () => {
    // 7 份同组目录：回收保留最近 5 份（PROBE_LIMIT），删最旧 2 份 —— 「回收确实执行了」仍被测量
    mkPartitionDirs([
      'silent-auth-zhihu-1790000000001',
      'silent-auth-zhihu-1790000000002',
      'silent-auth-zhihu-1790000000003',
      'silent-auth-zhihu-1790000000004',
      'silent-auth-zhihu-1790000000005',
      'silent-auth-zhihu-1790000000006',
      'silent-auth-zhihu-1790000000007',
    ])
    const { manager, session } = arrange([])
    __electronMock.BrowserWindow.mockImplementation(function () {
      this.webContents = session && {
        session,
        isDestroyed: () => false,
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
        loadURL: vi.fn().mockRejectedValue(new Error('nav boom')),
        executeJavaScript: vi.fn().mockResolvedValue(''),
        getURL: vi.fn().mockReturnValue(''),
        getTitle: vi.fn().mockResolvedValue(''),
        debugger: { attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn(), on: vi.fn() },
      }
      this.destroy = vi.fn()
      this.show = vi.fn()
      this.isDestroyed = () => false
    })
    session.clearStorageData.mockClear()
    const result = await manager.loginSilent('wechat_mp', [], {}, {})
    vi.runAllTimers()
    expect(result.valid).toBe(false)
    expect(session.clearStorageData).toHaveBeenCalledTimes(1)
    expect(listed().filter(n => n.startsWith('silent-auth-zhihu-'))).toEqual([
      'silent-auth-zhihu-1790000000003',
      'silent-auth-zhihu-1790000000004',
      'silent-auth-zhihu-1790000000005',
      'silent-auth-zhihu-1790000000006',
      'silent-auth-zhihu-1790000000007',
    ])
    // 交给 fromPartition 的名字必须同步登记：同一轮里若发生回收，未登记的目录会被 unlink，
    // 而那正是 Chromium 仍持有的存储目录。
    const persistName = String(__electronMock.session.fromPartition.mock.calls.slice(-1)[0][0])
    expect(persistName.startsWith('persist:silent-auth-')).toBe(true)
    expect(reclaimCjs.livePartitionNames()).toContain(persistName.slice('persist:'.length))
  })
})

describe('auth-partition-reclaim：登录会话级动作', () => {
  // reclaimMod 与生产同实例（外层 beforeEach 的 CJS require），否则登记表断言会假失败
  const reclaimMod = () => reclaimCjs

  it('captured=true 时不清存储，但仍调度目录回收', () => {
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    const session = { clearStorageData: vi.fn(), clearCache: vi.fn(), cookies: { get: vi.fn().mockResolvedValue([]) } }
    reclaimMod().reclaimLoginSession({ accountId: 'auth-x-1', session, captured: true, log })
    expect(session.clearStorageData).not.toHaveBeenCalled()
    expect(reclaimMod().partitionNameOf('auth-x-1')).toBe('auth-auth-x-1')
  })

  it('未取证且分区里没有该平台 Cookie ⇒ 清存储（真残留）', async () => {
    const session = {
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      cookies: { get: vi.fn().mockResolvedValue([{ name: 'x', value: '1', domain: '.someone-else.example' }]) },
    }
    reclaimMod().reclaimLoginSession({ accountId: 'auth-x-2', session, platform: 'wechat_mp' })
    await flush()
    expect(session.clearStorageData).toHaveBeenCalledTimes(1)
  })

  it('未取证但分区里有该平台 Cookie ⇒ 一律不清（它是发布兜底唯一可读的那份）', async () => {
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    const session = {
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      cookies: { get: vi.fn().mockResolvedValue([{ name: 'slave_user', value: 'u', domain: '.mp.weixin.qq.com' }]) },
    }
    reclaimMod().reclaimLoginSession({ accountId: 'auth-x-3', session, platform: 'wechat_mp', log })
    await flush()
    expect(session.clearStorageData).not.toHaveBeenCalled()
    expect(log.notify).toHaveBeenCalledWith('AuthReclaim', 'kept-as-publish-fallback', expect.objectContaining({ params: expect.objectContaining({ platform: 'wechat_mp' }) }))
  })

  it('Cookie 探测失败时**保留**分区（不确定时不销毁可能唯一的凭证副本）', async () => {
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    const boom = {
      clearStorageData: vi.fn(),
      cookies: { get: vi.fn().mockRejectedValue(new Error('probe boom')) },
    }
    const absent = { clearStorageData: vi.fn() }
    reclaimMod().reclaimLoginSession({ accountId: 'auth-x-4', session: boom, platform: 'zhihu', log })
    reclaimMod().reclaimLoginSession({ accountId: 'auth-x-5', session: absent, platform: 'zhihu', log })
    await flush()
    expect(boom.clearStorageData).not.toHaveBeenCalled()
    expect(absent.clearStorageData).not.toHaveBeenCalled()
    expect(log.notify).toHaveBeenCalledWith('AuthReclaim', 'cookie-probe-failed-kept', expect.objectContaining({ error: expect.stringContaining('probe boom') }))
    expect(log.notify).toHaveBeenCalledWith('AuthReclaim', 'cookie-probe-failed-kept', expect.objectContaining({ error: expect.stringContaining('cookies.get 不可用') }))
  })

  it('已标记取证的分区名不再被清（跨会话不串）', () => {
    reclaimMod().markCaptured('auth-y-1')
    const session = {
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
      cookies: { get: vi.fn().mockResolvedValue([]) },
    }
    reclaimMod().reclaimLoginSession({ accountId: 'auth-y-1', session })
    expect(session.clearStorageData).not.toHaveBeenCalled()
  })

  it('缺 accountId 时如实留痕，不静默当成「没有要回收的」', () => {
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    expect(reclaimMod().partitionNameOf(null)).toBe(null)
    reclaimMod().reclaimLoginSession({ accountId: null, session: null, log })
    expect(log.notify).toHaveBeenCalledWith('AuthReclaim', 'no-partition-to-reclaim', { level: 'WARN' })
  })

  it('分区名单一来源：createSession 与回收端用同一个名字', async () => {
    const sessionMod = await import('./auth-view-session.js')
    let seen = null
    sessionMod.createSession('auth-wechat_mp-123', { fromPartition: function (p) { seen = p; return {} } })
    expect(seen).toBe('persist:' + reclaimMod().partitionNameOf('auth-wechat_mp-123'))
    expect(reclaimMod().partitionNameOf('auth-wechat_mp-123')).toBe('auth-auth-wechat_mp-123')
  })

  it('createSession 造的分区进入登记表，非末位也不得被删（Session 进程内不销毁）', () => {
    const sessionMod = require('./auth-view-session.js')
    mkPartitionDirs(['auth-auth-w-1', 'auth-auth-w-2', 'auth-auth-w-3', 'auth-auth-w-4', 'auth-auth-w-5', 'auth-auth-w-6', 'auth-auth-w-7'])
    // 模拟本轮刚创建的正是最旧那一份（批量登录并发 / 读侧兜底都会造成这种形状）
    sessionMod.createSession('auth-w-1', { fromPartition: () => ({}) })
    expect(reclaimCjs.livePartitionNames()).toContain('auth-auth-w-1')
    const summary = reclaimCjs.reclaimStaleAuthPartitions({ userDataPath: base })
    expect(summary.removed).toEqual(['auth-auth-w-2'])
    const root = path.join(base, 'session', 'Partitions')
    expect(fs.existsSync(path.join(root, 'auth-auth-w-1'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'auth-auth-w-3'))).toBe(true)
  })

  it('发布兜底只读过的分区也必须登记（read 会实例化 Session）', async () => {
    const authPartition = require('./auth-partition.js')
    mkPartitionDirs(['auth-auth-zhihu-1'])
    __electronMock.session.fromPartition = vi.fn(() => ({ cookies: { get: vi.fn().mockResolvedValue([]) } }))
    await authPartition.collectAuthPartitionCookies('zhihu', null)
    expect(reclaimCjs.livePartitionNames()).toContain('auth-auth-zhihu-1')
    const summary = reclaimCjs.reclaimStaleAuthPartitions({ userDataPath: base })
    expect(summary.removed).toEqual([])
    expect(fs.existsSync(path.join(base, 'session', 'Partitions', 'auth-auth-zhihu-1'))).toBe(true)
  })

  it('分区名单一来源：createSession 与回收端用同一个名字', () => {
    const sessionMod = require('./auth-view-session.js')
    let seen = null
    sessionMod.createSession('auth-wechat_mp-123', { fromPartition: function (p) { seen = p; return {} } })
    expect(seen).toBe('persist:' + reclaimMod().partitionNameOf('auth-wechat_mp-123'))
    expect(reclaimMod().partitionNameOf('auth-wechat_mp-123')).toBe('auth-auth-wechat_mp-123')
  })
})
