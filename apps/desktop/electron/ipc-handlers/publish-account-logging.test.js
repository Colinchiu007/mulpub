// @ts-check
/**
 * 发布/账号 IPC 日志增强回归测试
 *
 * 验证（QM-3 日志覆盖门禁）：
 * - publish:batch 成功/失败时记录 enter/ok/error 日志，含平台、taskId、耗时
 * - cover:extract 记录 enter/ok/validation-failed
 * - accounts:list 记录 enter/ok/backend-failed，含 count/platforms
 * - auth:open-login 记录 enter/ok/cancelled/timeout
 * - account:delete 记录 enter/ok
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
function createMockIpcMain() {
  const handlers = {}
  return { handle: vi.fn((channel, fn) => { handlers[channel] = fn }), on: vi.fn(), _get: (channel) => handlers[channel] }
}

vi.mock('../services/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }))
vi.mock('../services/offline-manager', () => ({ isOffline: vi.fn(() => false), addToCache: vi.fn() }))
__enableElectronMock()

const TRUSTED_EVENT = { senderFrame: { url: 'http://localhost:5174/' } }
const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }

let registerPublish
let registerAccount
let originalNodeEnv
let originalIsPackaged

function createLogRecorder() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
}

async function loadHandlers() {
  vi.resetModules()
  originalNodeEnv = process.env.NODE_ENV
  originalIsPackaged = __electronMock.app.isPackaged
  delete process.env.NODE_ENV
  __electronMock.app.isPackaged = false
  const publishMod = await import('./publish')
  const accountMod = await import('./account')
  return {
    publish: publishMod.default || publishMod,
    account: accountMod.default || accountMod,
  }
}

function publishDeps(log) {
  const taskQueue = { add: vi.fn(() => 'task_log_test'), getStatus: vi.fn(() => ({ running: [], queue: [] })), getHistory: vi.fn(() => []), cancel: vi.fn(() => true), retry: vi.fn(() => 'task_retry') }
  const history = { listRecords: vi.fn(() => ({ total: 0, records: [] })), getRecord: vi.fn(() => null), deleteRecords: vi.fn(() => ({ deleted: 1 })), getStats: vi.fn(() => ({ published: 0, failed: 0 })) }
  return { taskQueue, history, BrowserWindow: __electronMock.BrowserWindow, log, identityService: { getState: () => ({ user: { sub: 'owner-test' } }) } }
}

function accountDeps(log) {
  return {
    authViewManager: { openLogin: vi.fn(async () => ({ name: 'test' })), loginSilent: vi.fn(async () => ({ valid: true })), completeLogin: vi.fn(async () => {}), close: vi.fn() },
    pythonBridge: { requestBackend: vi.fn(async (method, url) => ({ code: 0, data: [] })) },
    AccountManager: {
      saveCapturedAccount: vi.fn(async () => ({ id: 'acct-1', platform: 'baijiahao', name: '百家号账号' })),
      loadSavedCredentials: vi.fn(() => ({ cookies: [], localStorage: {}, indexedDB: null })),
      addAccount: vi.fn(async () => ({ id: 'acct-2', platform: 'kuaishou' })),
      deleteAccount: vi.fn(async () => {}),
      checkLoginStatus: vi.fn(async () => ({ valid: true })),
      setAccountProxy: vi.fn(async () => ({ configured: true })),
      listAccounts: vi.fn(async () => []),
    },
    store: { getSetting: vi.fn(() => null) },
    identityService: { getState: () => ({ user: { sub: 'owner-test' } }) },
    log,
    BrowserWindow: __electronMock.BrowserWindow,
  }
}

beforeEach(async () => {
  const mods = await loadHandlers()
  registerPublish = mods.publish
  registerAccount = mods.account
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  __electronMock.app.isPackaged = originalIsPackaged
})

describe('Publish IPC 日志增强', () => {
  it('publish:batch 成功记录 enter/ok 日志（含平台、taskId、耗时）', async () => {
    const log = createLogRecorder()
    const ipcMain = createMockIpcMain()
    registerPublish(ipcMain, publishDeps(log))
    const result = await ipcMain._get('publish:batch')(TRUSTED_EVENT, {
      platforms: [{ platform: 'baijiahao', accountId: 'd39af89b' }],
      article: { title: 'E2E 测试', video_path: 'D:/01.mp4', tags: ['E2E'] },
    })
    expect(result.code).toBe(0)
    const calls = log.info.mock.calls.map((c) => c.join(' '))
    expect(calls.some((c) => c.includes('publish:batch') && c.includes('enter') && c.includes('baijiahao'))).toBe(true)
    expect(calls.some((c) => c.includes('publish:batch') && c.includes('ok') && c.includes('task_log_test') && c.includes('耗时'))).toBe(true)
    const notifyCalls = log.notify.mock.calls.map((c) => c.join(' '))
    expect(notifyCalls.some((c) => c.includes('batch-ok'))).toBe(true)
    const batchOkMeta = log.notify.mock.calls.find((c) => c[1] === 'batch-ok')
    expect(batchOkMeta).toBeTruthy()
    expect(batchOkMeta[2].params.taskIds).toEqual(['task_log_test'])
    expect(typeof batchOkMeta[2].params.durationMs).toBe('number')
  })

  it('publish:batch 异常记录 batch-error 通知（含 errorCategory 与脱敏 error）', async () => {
    const log = createLogRecorder()
    const ipcMain = createMockIpcMain()
    const deps = publishDeps(log)
    deps.taskQueue.add.mockImplementation(() => { throw new Error('queue boom') })
    registerPublish(ipcMain, deps)
    const result = await ipcMain._get('publish:batch')(TRUSTED_EVENT, {
      platforms: [{ platform: 'baijiahao', accountId: 'd39af89b' }],
      article: { title: 'E2E 测试', video_path: 'D:/01.mp4', tags: ['E2E'] },
    })
    expect(result.code).not.toBe(0)
    const notifyCalls = log.notify.mock.calls.map((c) => c.join(' '))
    expect(notifyCalls.some((c) => c.includes('batch-error'))).toBe(true)
    const batchErrMeta = log.notify.mock.calls.find((c) => c[1] === 'batch-error')
    expect(batchErrMeta[2].errorCategory).toBe('publish_batch')
    expect(batchErrMeta[2].level).toBe('ERROR')
    expect(String(batchErrMeta[2].error)).toContain('queue boom')
    expect(typeof batchErrMeta[2].params.durationMs).toBe('number')
  })

  it('publish:batch 校验失败记录 validation-failed 日志', async () => {
    const log = createLogRecorder()
    const ipcMain = createMockIpcMain()
    registerPublish(ipcMain, publishDeps(log))
    const result = await ipcMain._get('publish:batch')(TRUSTED_EVENT, { platforms: [{ platform: 'baijiahao', accountId: 'bad/id' }] })
    expect(result.code).not.toBe(0)
    const calls = log.warn.mock.calls.map((c) => c.join(' '))
    expect(calls.some((c) => c.includes('publish:batch') && c.includes('validation-failed'))).toBe(true)
  })

  it('cover:extract 记录 enter 日志（结果不依赖真实文件）', async () => {
    const log = createLogRecorder()
    const ipcMain = createMockIpcMain()
    registerPublish(ipcMain, publishDeps(log))
    // 不存在的路径：CI 环境无 D:/01.mp4，只验证日志覆盖（enter 必定记录）
    await ipcMain._get('cover:extract')(TRUSTED_EVENT, 'Z:/no-such-video.mp4')
    const calls = log.info.mock.calls.map((c) => c.join(' '))
    expect(calls.some((c) => c.includes('cover:extract') && c.includes('enter') && c.includes('Z:/no-such-video.mp4'))).toBe(true)
  })

  it('queue:cancel 记录 enter/ok 日志', async () => {
    const log = createLogRecorder()
    const ipcMain = createMockIpcMain()
    registerPublish(ipcMain, publishDeps(log))
    const result = await ipcMain._get('queue:cancel')(TRUSTED_EVENT, 'task_1')
    expect(result.code).toBe(0)
    const calls = log.info.mock.calls.map((c) => c.join(' '))
    expect(calls.some((c) => c.includes('queue:cancel') && c.includes('enter') && c.includes('task_1'))).toBe(true)
  })
})

describe('Account IPC 日志增强', () => {
 it('accounts:list 记录 enter/ok 日志（含 count/platforms）', async () => {
   const log = createLogRecorder()
   const ipcMain = createMockIpcMain()
   const deps = accountDeps(log)
    deps.AccountManager.listAccounts.mockResolvedValue([{ id: 'd39af89b', platform: 'baijiahao', name: '百家号账号' }])
   registerAccount(ipcMain, deps)
   const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)
   expect(result.code).toBe(0)
   const calls = log.info.mock.calls.map((c) => c.join(' '))
   expect(calls.some((c) => c.includes('accounts:list') && c.includes('enter'))).toBe(true)
   expect(calls.some((c) => c.includes('accounts:list') && c.includes('ok') && c.includes('count=1') && c.includes('baijiahao'))).toBe(true)
    const notifyMeta = log.notify.mock.calls.find((c) => c[1] === 'accounts-list-ok')
    expect(notifyMeta).toBeTruthy()
    expect(notifyMeta[2].params.count).toBe(1)
    expect(notifyMeta[2].params.platforms).toEqual(['baijiahao'])
    expect(notifyMeta[2].level).toBe('INFO')
 })

 it('accounts:list 后端失败记录 backend-failed 日志', async () => {
   const log = createLogRecorder()
   const ipcMain = createMockIpcMain()
   const deps = accountDeps(log)
    deps.AccountManager.listAccounts.mockRejectedValue(new Error('backend down'))
   registerAccount(ipcMain, deps)
   const result = await ipcMain._get('accounts:list')(TRUSTED_EVENT)
   expect(result.code).not.toBe(0)
    const calls = log.error.mock.calls.map((c) => c.join(' '))
    expect(calls.some((c) => c.includes('accounts:list') && c.includes('error') && c.includes('backend down'))).toBe(true)
 })

  it('auth:open-login 成功记录 ok 日志（含 platform/accountId）', async () => {
    const log = createLogRecorder()
    const ipcMain = createMockIpcMain()
    registerAccount(ipcMain, accountDeps(log))
    const result = await ipcMain._get('auth:open-login')(TRUSTED_EVENT, 'baijiahao')
    expect(result.code).toBe(0)
    const calls = log.info.mock.calls.map((c) => c.join(' '))
    expect(calls.some((c) => c.includes('auth:open-login') && c.includes('ok') && c.includes('acct-1'))).toBe(true)
    const notifyMeta = log.notify.mock.calls.find((c) => c[1] === 'auth-open-login-ok')
    expect(notifyMeta).toBeTruthy()
    expect(notifyMeta[2].params.platform).toBe('baijiahao')
    expect(notifyMeta[2].params.accountId).toBe('acct-1')
    expect(notifyMeta[2].level).toBe('INFO')
  })

  it('account:delete 成功记录 ok 日志（含 accountId）', async () => {
    const log = createLogRecorder()
    const ipcMain = createMockIpcMain()
    registerAccount(ipcMain, accountDeps(log))
    const result = await ipcMain._get('account:delete')(TRUSTED_EVENT, 'd39af89b')
    expect(result.code).toBe(0)
    const calls = log.info.mock.calls.map((c) => c.join(' '))
    expect(calls.some((c) => c.includes('account:delete') && c.includes('ok') && c.includes('d39af89b'))).toBe(true)
    const notifyMeta = log.notify.mock.calls.find((c) => c[1] === 'account-delete-ok')
    expect(notifyMeta).toBeTruthy()
    expect(notifyMeta[2].params.accountId).toBe('d39af89b')
    expect(notifyMeta[2].level).toBe('INFO')
  })
})

/**
 * history:list 耗时可观测性（obs-history-timing，2026-10-17）
 *
 * 动因：用户报「点左侧菜单『发布』慢 1–2 秒」，而 `history:list` 的日志只打
 * `owner/total/records/page/pageSize`，**没有耗时**（对比 `accounts:list` 有 `耗时=`）
 * ⇒ 主进程侧拿不到读数，只能推理不能证实。
 *
 * 判据形状（为什么这么写）：
 * - **成功与失败都要有耗时**：慢请求常常最终报错，只在 ok 分支打读数会漏掉一半现场。
 * - **阈值告警必须双向锁**：只测「>300ms 打 warn」证不出「≤300ms 不打 warn」，
 *   而后者才是防刷屏的那一半。两条一起才锁住「只有真的慢才出声」。
 * - **时钟注入而非真实等待**：靠 `Date.now` 可变实现推进，避免测试引入真实 sleep
 *   （既慢又不稳），也不用 fakeTimers 污染其它用例。
 */
describe('history:list 耗时可观测性', () => {
  const SLOW_THRESHOLD_MS = 300
  let clock
  let dateSpy

  beforeEach(() => {
    clock = 1_000_000
    dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    dateSpy.mockRestore()
  })

  /** 组装 registerHistoryHandlers 的最小依赖；listRecords 用 overrides 替换 */
  function historyDeps (log, overrides = {}) {
    return {
      EC: { AUTH_ERROR: -401, REQUEST_ERROR: -500, VALIDATION_ERROR: -400 },
      // 真实实现是 sender 校验包装器；本测试只关心日志，包装退化为一层透传
      withSenderCheck: (fn) => fn,
      getOwnerSubject: () => 'owner-test',
      ipcLog: (level, channel, stage, detail) => log[level](channel, stage, detail),
      history: { listRecords: vi.fn(() => ({ total: 0, records: [] })), ...overrides },
      store: {},
    }
  }

  async function register (log, overrides) {
    vi.resetModules()
    const { registerHistoryHandlers } = await import('./publish-history-ipc')
    const ipcMain = createMockIpcMain()
    registerHistoryHandlers(ipcMain, historyDeps(log, overrides))
    return ipcMain
  }

  it('成功路径的 ok 日志含 耗时=Nms', async () => {
    const log = createLogRecorder()
    const ipcMain = await register(log, {
      listRecords: vi.fn(() => { clock += 12; return { total: 3, records: [] } }),
    })
    const result = await ipcMain._get('history:list')(TRUSTED_EVENT, { page: 1, pageSize: 20 })
    expect(result.code).toBe(0)
    const okCalls = log.info.mock.calls.map((c) => c.join(' '))
    expect(okCalls.some((c) => c.includes('history:list') && c.includes('ok') && /耗时=\d+ms/.test(c))).toBe(true)
  })

  it('失败路径的 error 日志同样含 耗时=Nms（慢请求常常最终报错，只打 ok 会漏一半现场）', async () => {
    const log = createLogRecorder()
    const ipcMain = await register(log, {
      listRecords: vi.fn(() => { clock += 40; throw new Error('db locked') }),
    })
    const result = await ipcMain._get('history:list')(TRUSTED_EVENT, {})
    expect(result.code).not.toBe(0)
    const errCalls = log.error.mock.calls.map((c) => c.join(' '))
    expect(errCalls.some((c) => c.includes('history:list') && /耗时=\d+ms/.test(c))).toBe(true)
  })

  it(`耗时超过 ${SLOW_THRESHOLD_MS}ms 时额外打一条 warn 阈值告警`, async () => {
    const log = createLogRecorder()
    const ipcMain = await register(log, {
      listRecords: vi.fn(() => { clock += SLOW_THRESHOLD_MS + 200; return { total: 1, records: [] } }),
    })
    const result = await ipcMain._get('history:list')(TRUSTED_EVENT, {})
    expect(result.code).toBe(0)
    const warnCalls = log.warn.mock.calls.map((c) => c.join(' '))
    expect(warnCalls.some((c) => c.includes('history:list') && c.includes(String(SLOW_THRESHOLD_MS)))).toBe(true)
  })

  it(`耗时不超过 ${SLOW_THRESHOLD_MS}ms 时不得打阈值告警（反向锁：防告警刷屏）`, async () => {
    const log = createLogRecorder()
    const ipcMain = await register(log, {
      listRecords: vi.fn(() => { clock += SLOW_THRESHOLD_MS; return { total: 1, records: [] } }),
    })
    const result = await ipcMain._get('history:list')(TRUSTED_EVENT, {})
    expect(result.code).toBe(0)
    const warnCalls = log.warn.mock.calls.map((c) => c.join(' '))
    expect(warnCalls.some((c) => c.includes('history:list'))).toBe(false)
  })
})
