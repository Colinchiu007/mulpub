// @ts-check
/**
 * accounts:batch-check-login — 进度可见性与并发合同测试
 * （一键检测进度卡顿修复 2026-09-22）
 *
 * 缺陷背景：进度广播只发生在「账号检测完成之后」（broadcastProgress 位于
 * await checkLoginStatus 之后），因此计数等于已完成数，正在检测的账号完全
 * 不可见。单个慢账号（浏览器降级检测：隐藏窗口 + 页面加载 + 选择器超时）
 * 会让遮罩上的「检测中 0/7」静止数十秒，用户无法区分「卡死」与「正在检测」，
 * 表现为"一直 0/7，过一会直接跳完成"。
 *
 * 契约：
 * 1. 每个账号在开始检测之前必须广播 phase:'start'，完成后广播 phase:'done'；
 *    首个 start 不得等待任何账号完成。
 * 2. 检测以有限并发执行（默认上限 3），峰值并发不得超过上限，
 *    且确实并行（>1），用于压缩整体墙钟时间。
 * 3. results 顺序与账号输入顺序一致（乱序完成不得错位配对回写）。
 * 4. 单账号超过硬超时计入失效，code 为 CHECK_LOGIN_TIMEOUT，
 *    且不阻断其余账号；超时后原检测迟到的 reject 不得产生 unhandledRejection。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

__enableElectronMock()

let registerHandlers

const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    on: vi.fn(),
    _get: (channel) => handlers[channel],
  }
}

/** 可控完成的 deferred，用于精确编排并发时序 */
function createDeferred () {
  /** @type {{promise: Promise<any>, resolve: Function, reject: Function}} */
  const box = { promise: null, resolve: null, reject: null }
  box.promise = new Promise((resolve, reject) => {
    box.resolve = resolve
    box.reject = reject
  })
  return box
}

function createMockDeps ({ accounts, checkLoginStatus, sends }) {
  const win = { isDestroyed: () => false, webContents: { send: (...args) => sends.push(args) } }
  return {
    authViewManager: { openLogin: vi.fn(), completeLogin: vi.fn(), loginSilent: vi.fn(), close: vi.fn() },
    pythonBridge: { requestBackend: vi.fn() },
    AccountManager: {
      listAccounts: vi.fn(async () => accounts),
      checkLoginStatus: vi.fn(checkLoginStatus),
    },
    BACKEND_PLATFORMS: new Set(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    BrowserWindow: { getAllWindows: vi.fn(() => [win]) },
    store: { getSetting: vi.fn(), setSetting: vi.fn() },
  }
}

/** 从 send 记录中取出进度事件（过滤非进度通道） */
function progressEvents (sends) {
  return sends
    .filter(([channel]) => channel === 'accounts:batch-check-progress')
    .map(([, payload]) => payload)
}

async function invokeBatch (deps, accountIds) {
  const ipcMain = createMockIpcMain()
  registerHandlers(ipcMain, deps)
  return await ipcMain._get('accounts:batch-check-login')(
    TRUSTED_EVENT,
    { accountIds: accountIds || undefined },
  )
}

const ACCOUNTS = [
  { id: 'a1', platform: 'douyin' },
  { id: 'a2', platform: 'kuaishou' },
  { id: 'a3', platform: 'xiaohongshu' },
  { id: 'a4', platform: 'wechat_mp' },
  { id: 'a5', platform: 'toutiao' },
  { id: 'a6', platform: 'bilibili' },
  { id: 'a7', platform: 'zhihu' },
]

beforeEach(async () => {
  vi.resetModules()
  delete process.env.NODE_ENV
  delete process.env.MP_BATCH_CHECK_CONCURRENCY
  delete process.env.MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS
  __electronMock.app.isPackaged = false
  const mod = await import('./account')
  registerHandlers = mod.default || mod
})

afterEach(() => {
  delete process.env.MP_BATCH_CHECK_CONCURRENCY
  delete process.env.MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS
})

describe('accounts:batch-check-login 进度边界', () => {
  it('每个账号在检测开始前广播 start，完成后广播 done', async () => {
    // 串行模式下事件序列唯一，用于钉住「start 早于检测体、done 晚于检测体」的边界；
    // 并发模式下的交错序由并发用例断言。
    process.env.MP_BATCH_CHECK_CONCURRENCY = '1'
    const sends = []
    const order = []
    const deps = createMockDeps({
      accounts: ACCOUNTS.slice(0, 2),
      sends,
      checkLoginStatus: async (platform, accountId) => {
        // start 必须已在本账号检测体执行之前抵达渲染层
        const phases = progressEvents(sends).filter(e => e.accountId === accountId).map(e => e.phase)
        order.push(`${accountId}:${phases.join('>')}@enter`)
        return { valid: true, code: 'CHECK_LOGIN_SUCCESS' }
      },
    })

    await invokeBatch(deps, ['a1', 'a2'])

    // 进入第 1 个账号检测时，它的 start 已经发出（此刻无任何 done）
    expect(order[0]).toBe('a1:start@enter')
    // 进入第 2 个账号时：它自己的 start 已发出（它的 done 还没到）
    expect(order[1]).toBe('a2:start@enter')
    const events = progressEvents(sends)
    expect(events.map(e => `${e.accountId}:${e.phase}`)).toEqual([
      'a1:start', 'a1:done', 'a2:start', 'a2:done',
    ])
    const done = events.filter(e => e.phase === 'done')
    expect(done.map(e => e.checked)).toEqual([1, 2])
    expect(done.every(e => e.total === 2)).toBe(true)
  })

  it('start 事件携带 total 与平台，供遮罩立即展示「正在检测哪个账号」', async () => {
    const sends = []
    const deps = createMockDeps({
      accounts: ACCOUNTS.slice(0, 1),
      sends,
      checkLoginStatus: async () => ({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }),
    })

    await invokeBatch(deps, ['a1'])

    const start = progressEvents(sends).find(e => e.phase === 'start')
    expect(start).toMatchObject({ platform: 'douyin', accountId: 'a1', total: 1, checked: 0 })
    const done = progressEvents(sends).find(e => e.phase === 'done')
    expect(done).toMatchObject({ checked: 1, total: 1, valid: false, platform: 'douyin' })
    expect(typeof done.elapsedMs).toBe('number')
  })
})

describe('accounts:batch-check-login 并发', () => {
  it('并发受限且确实并行：峰值 > 1 且不超过上限 3', async () => {
    const sends = []
    let inFlight = 0
    let peak = 0
    const deferreds = new Map()
    const deps = createMockDeps({
      accounts: ACCOUNTS,
      sends,
      checkLoginStatus: (platform, accountId) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        const d = createDeferred()
        deferreds.set(accountId, d)
        // 让出一次微任务，使所有并发 worker 都有机会进入
        return d.promise.then(() => {
          inFlight--
          return { valid: true, code: 'CHECK_LOGIN_SUCCESS' }
        })
      },
    })

    const handlerPromise = invokeBatch(deps, ACCOUNTS.map(a => a.id))
    // 逐个放行，观察进入顺序受并发上限约束
    for (const acc of ACCOUNTS) {
      await vi.waitFor(() => {
        expect(deferreds.has(acc.id), `${acc.id} 未启动`).toBe(true)
      }, { timeout: 3000, interval: 5 })
      expect(inFlight).toBeLessThanOrEqual(3)
      deferreds.get(acc.id).resolve({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })
      // 放行后让事件循环推进，下一个账号才可能启动
      await new Promise(r => setTimeout(r, 0))
    }
    const result = await handlerPromise

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(3)
    // 首个账号尚未完成时，后续账号的 start 已经发出 → 单个慢账号不再让进度静止
    const events = progressEvents(sends)
    const firstDone = events.findIndex(e => e.phase === 'done')
    expect(events.slice(0, firstDone).filter(e => e.phase === 'start').length).toBeGreaterThan(1)
    expect(result.data.results).toHaveLength(7)
    expect(result.data.results.every(r => r.valid === true)).toBe(true)
    expect(progressEvents(sends).filter(e => e.phase === 'done').map(e => e.checked)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('结果顺序与账号输入顺序一致（乱序完成不错位）', async () => {
    const sends = []
    const deferreds = new Map()
    const deps = createMockDeps({
      accounts: ACCOUNTS.slice(0, 2),
      sends,
      checkLoginStatus: (platform, accountId) => {
        const d = createDeferred()
        deferreds.set(accountId, d)
        return d.promise
      },
    })

    const handlerPromise = invokeBatch(deps, ['a1', 'a2'])
    await vi.waitFor(() => expect(deferreds.size).toBe(2), { timeout: 3000, interval: 5 })
    // 后启动的先完成
    deferreds.get('a2').resolve({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    deferreds.get('a1').resolve({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })
    const result = await handlerPromise

    expect(result.data.results.map(r => r.accountId)).toEqual(['a1', 'a2'])
    expect(result.data.results.map(r => r.valid)).toEqual([true, false])
  })

  it('MP_BATCH_CHECK_CONCURRENCY=1 时退化为串行（可用于排查并发风险）', async () => {
    process.env.MP_BATCH_CHECK_CONCURRENCY = '1'
    const sends = []
    let inFlight = 0
    let peak = 0
    const deps = createMockDeps({
      accounts: ACCOUNTS.slice(0, 3),
      sends,
      checkLoginStatus: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise(r => setTimeout(r, 1))
        inFlight--
        return { valid: true, code: 'CHECK_LOGIN_SUCCESS' }
      },
    })

    await invokeBatch(deps, ['a1', 'a2', 'a3'])

    expect(peak).toBe(1)
  })
})

describe('accounts:batch-check-login 单账号超时', () => {
  it('超过硬超时计入失效并标记 CHECK_LOGIN_TIMEOUT，不阻断其余账号', async () => {
    process.env.MP_BATCH_CHECK_CONCURRENCY = '1'
    process.env.MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS = '60'
    const sends = []
    const deps = createMockDeps({
      accounts: ACCOUNTS.slice(0, 2),
      sends,
      checkLoginStatus: async (platform, accountId) => {
        if (accountId === 'a1') {
          // 模拟浏览器降级检测挂死：远超超时预算才返回
          await new Promise(r => setTimeout(r, 500))
          return { valid: true, code: 'CHECK_LOGIN_SUCCESS' }
        }
        return { valid: true, code: 'CHECK_LOGIN_SUCCESS' }
      },
    })

    const started = Date.now()
    const result = await invokeBatch(deps, ['a1', 'a2'])
    expect(Date.now() - started).toBeLessThan(450)

    expect(result.code).toBe(0)
    expect(result.data.results[0]).toMatchObject({
      accountId: 'a1', platform: 'douyin', valid: false, code: 'CHECK_LOGIN_TIMEOUT',
    })
    expect(typeof result.data.results[0].error).toBe('string')
    expect(result.data.results[1]).toMatchObject({ accountId: 'a2', valid: true })
    const done = progressEvents(sends).filter(e => e.phase === 'done')
    expect(done.map(e => e.accountId)).toEqual(['a1', 'a2'])
    expect(done[0].valid).toBe(false)
  })

  it('超时后原检测迟到的 reject 不产生 unhandledRejection', async () => {
    process.env.MP_BATCH_CHECK_CONCURRENCY = '1'
    process.env.MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS = '40'
    const sends = []
    const rejections = []
    const onRejection = (err) => rejections.push(err)
    process.on('unhandledRejection', onRejection)
    try {
      const deps = createMockDeps({
        accounts: ACCOUNTS.slice(0, 1),
        sends,
        checkLoginStatus: async () => {
          await new Promise(r => setTimeout(r, 120))
          throw new Error('late browser failure')
        },
      })

      const result = await invokeBatch(deps, ['a1'])
      expect(result.data.results[0]).toMatchObject({ valid: false, code: 'CHECK_LOGIN_TIMEOUT' })
      // 等迟到的 reject 真正落地后再断言
      await new Promise(r => setTimeout(r, 220))
      await new Promise(r => process.nextTick(r))
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })
})
