// @ts-check
/**
 * account-rename.js — 显示名改名通道契约测试
 *
 * 要钉住的核心不是「返回码对不对」，而是**这条通道必须写后端真源**：
 * 改名此前走 `accountUpdate` → `store:update-account` → Electron SQLite，而账号列表读
 * python-backend `accounts.json`，于是改名是空操作（openspec: add-account-name-source）。
 * 因此除行为用例外，本文件还断言 AccountManager.renameAccount 收到的参数里带
 * `name_source='manual'` —— 缺了它，展示层就会把用户起的名字当抓取噪声藏掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// withSenderCheck 通过 require('electron').app.isPackaged 判定是否信任 dev localhost，
// 因此必须先把 electron mock 打开并置为「未打包」，否则可信来源用例会拿到 -3。
__enableElectronMock()

const { registerAccountRenameHandler } = require('./account-rename')

let originalIsPackaged

beforeEach(() => {
  originalIsPackaged = __electronMock.app.isPackaged
  __electronMock.app.isPackaged = false
})

afterEach(() => {
  __electronMock.app.isPackaged = originalIsPackaged
  vi.restoreAllMocks()
})

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    on: vi.fn(),
    _get: (channel) => handlers[channel],
  }
}

function createDeps (overrides = {}) {
  return {
    AccountManager: { renameAccount: vi.fn(async () => ({ ok: true, account: { id: 'a1' } })) },
    getOwnerSubject: vi.fn(() => 'sub-a'),
    ipcLog: vi.fn(),
    isSafePathSegment: vi.fn((s) => typeof s === 'string' && /^[A-Za-z0-9_.-]+$/.test(s)),
    ...overrides,
  }
}

const TRUSTED = { senderFrame: { url: 'http://localhost:5174/' } }
const UNTRUSTED = { senderFrame: { url: 'https://evil.example/' } }

function register (deps) {
  const ipcMain = createMockIpcMain()
  registerAccountRenameHandler(ipcMain, deps)
  return ipcMain._get('account:rename')
}

describe('account:rename', () => {
  it('可信来源改名：转交 AccountManager 并回传结果', async () => {
    const deps = createDeps()
    const handler = register(deps)

    const result = await handler(TRUSTED, { accountId: 'a1', platform: 'toutiao', name: '阿飞 - 自由职业' })

    expect(result.code).toBe(0)
    expect(deps.AccountManager.renameAccount).toHaveBeenCalledWith('a1', 'toutiao', '阿飞 - 自由职业')
  })

  it('拒绝外部网页调用（写通道不得被内嵌第三方页面触发）', async () => {
    const deps = createDeps()
    const handler = register(deps)

    const result = await handler(UNTRUSTED, { accountId: 'a1', platform: 'toutiao', name: 'x' })

    expect(result.code).toBe(-3)
    expect(deps.AccountManager.renameAccount).not.toHaveBeenCalled()
  })

  it.each([
    ['空串', ''],
    ['纯空白', '   '],
    ['非字符串', 123],
    ['缺失', undefined],
    ['超长（>100 字）', '名'.repeat(101)],
  ])('%s 名称必须被拒且不落库', async (_label, name) => {
    const deps = createDeps()
    const handler = register(deps)

    const result = await handler(TRUSTED, { accountId: 'a1', platform: 'toutiao', name })

    expect(result.code).not.toBe(0)
    expect(deps.AccountManager.renameAccount).not.toHaveBeenCalled()
  })

  it.each([
    ['accountId 缺失', { platform: 'toutiao', name: 'x' }],
    ['platform 缺失', { accountId: 'a1', name: 'x' }],
    ['accountId 含路径穿越', { accountId: '../etc', platform: 'toutiao', name: 'x' }],
    ['参数非对象', 'a1'],
  ])('非法参数一律拒绝：%s', async (_label, arg) => {
    const deps = createDeps()
    const handler = register(deps)

    const result = await handler(TRUSTED, arg)

    expect(result.code).not.toBe(0)
    expect(deps.AccountManager.renameAccount).not.toHaveBeenCalled()
  })

  it('未登录时不得写库', async () => {
    const deps = createDeps({ getOwnerSubject: vi.fn(() => null) })
    const handler = register(deps)

    const result = await handler(TRUSTED, { accountId: 'a1', platform: 'toutiao', name: 'x' })

    expect(result.code).not.toBe(0)
    expect(deps.AccountManager.renameAccount).not.toHaveBeenCalled()
  })

  it('主进程写失败必须透传失败码，不得伪装成功（否则界面显示新名而真源仍是旧名）', async () => {
    const deps = createDeps({
      AccountManager: { renameAccount: vi.fn(async () => ({ ok: false, reason: 'backend-error', code: 500, message: '后端不可用' })) },
    })
    const handler = register(deps)

    const result = await handler(TRUSTED, { accountId: 'a1', platform: 'toutiao', name: 'x' })

    expect(result.code).toBe(500)
    expect(result.message).toBe('后端不可用')
  })

  it('AccountManager 抛异常时返回失败而不是 unhandled rejection', async () => {
    const deps = createDeps({
      AccountManager: { renameAccount: vi.fn(async () => { throw new Error('boom') }) },
    })
    const handler = register(deps)

    await expect(handler(TRUSTED, { accountId: 'a1', platform: 'toutiao', name: 'x' })).resolves.toMatchObject({
      message: 'boom',
    })
  })
})

describe('AccountManager.renameAccount 写入语义', () => {
  const MODULE = '../publishers/account-manager'

  function loadManager () {
    delete require.cache[require.resolve(MODULE)]
    return require(MODULE)
  }

  it('PATCH 必须同时带 account_name 与 name_source=manual', async () => {
    const accountManager = loadManager()
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({ code: 0, data: { id: 'a1' } })

    const res = await accountManager.renameAccount('a1', 'toutiao', '阿飞 - 自由职业')

    expect(res.ok).toBe(true)
    expect(requestBackend).toHaveBeenCalledWith('PATCH', '/api/accounts/a1', {
      account_name: '阿飞 - 自由职业',
      name_source: 'manual',
    })
  })

  it('空名与非法 accountId 不得发出任何后端请求', async () => {
    const accountManager = loadManager()
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')

    await expect(accountManager.renameAccount('a1', 'toutiao', '   ')).resolves.toMatchObject({ ok: false })
    await expect(accountManager.renameAccount('../etc', 'toutiao', '名字')).resolves.toMatchObject({ ok: false })
    expect(requestBackend).not.toHaveBeenCalled()
  })
})
