// @ts-check
/**
 * AccountManager 回归测试
 *
 * 覆盖 Electron app.getPath 不可用时的本地凭证目录 fallback。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const modulePath = './account-manager'

function loadAccountManager() {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

describe('account-manager — userData fallback', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })

  afterEach(() => {
    global.__electronMock.app.getPath = function () { return '/tmp/test-electron-path' }
    vi.restoreAllMocks()
  })

  it('app.getPath 失败时使用用户主目录下的 .multi-publish，避免递归崩溃', () => {
    global.__electronMock.app.getPath = function () {
      throw new Error('electron app path unavailable')
    }

    const accountManager = loadAccountManager()
    const expectedDir = path.join(os.homedir(), '.multi-publish')
    const hasCredential = vi
      .spyOn(accountManager.credentialStore, 'hasCredential')
      .mockReturnValue(false)
    expect(accountManager.checkLocalCredentials('wechat_mp', 'account-1')).toBe(false)
    expect(hasCredential).toHaveBeenCalledWith('account-1', expectedDir)
  })
})

describe('checkLocalCredentials session 分区 Cookie 备选检测', () => {
  it('加密凭据缺失但 session 分区 Cookie 文件存在且非空 → 视为有效', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(false)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue(null)
    // 模拟 persist:account-{accountId} 分区下的 Network/Cookies 文件存在
    const fs = require('fs')
    const existsSync = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.includes('Partitions') && normalized.endsWith('Network/Cookies')
    })
    const statSync = vi.spyOn(fs, 'statSync').mockReturnValue({ size: 20480 })

    try {
      const result = accountManager.checkLocalCredentials('douyin', 'acc-1')
      expect(result).toBe(true)
    } finally {
      existsSync.mockRestore()
      statSync.mockRestore()
    }
  })

  it('加密凭据缺失 + session Cookie 文件为空 → 视为无效', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(false)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue(null)
    const fs = require('fs')
    const existsSync = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const normalized = String(p).replace(/\\/g, '/')
      return normalized.includes('Partitions') && normalized.endsWith('Network/Cookies')
    })
    const statSync = vi.spyOn(fs, 'statSync').mockReturnValue({ size: 0 })

    try {
      const result = accountManager.checkLocalCredentials('douyin', 'acc-2')
      expect(result).toBe(false)
    } finally {
      existsSync.mockRestore()
      statSync.mockRestore()
    }
  })

  it('加密凭据缺失 + 无 session 分区 Cookie 文件 → 视为无效', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(false)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue(null)
    // 默认：fs.existsSync 返回 false（测试 tmp 目录下无 Partitions）

    const result = accountManager.checkLocalCredentials('douyin', 'acc-3')
    expect(result).toBe(false)
  })
})

describe('account-manager — Logto owner 隔离', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    global.__electronMock.app.getPath = function () { return 'C:/test-user-data' }
  })

  afterEach(() => {
    global.__electronMock.app.getPath = function () { return '/tmp/test-electron-path' }
    vi.restoreAllMocks()
  })

  it('添加账号时把当前用户 sub 写入状态与加密凭证命名空间', async () => {
    const accountManager = loadAccountManager()
    accountManager.setOwnerSubjectProvider(() => 'user-a')

    const page = {
      addInitScript: vi.fn(async () => {}),
      goto: vi.fn(async () => {}),
      waitForSelector: vi.fn(async () => {}),
      $: vi.fn(async () => null),
      evaluate: vi.fn()
        .mockResolvedValueOnce({ token: 'local-token' })
        .mockResolvedValueOnce({ platformAccountId: 'platform-user-a' }),
      close: vi.fn(async () => {}),
    }
    const context = {
      newPage: vi.fn(async () => page),
      cookies: vi.fn(async () => [{ name: 'sid', value: 'cookie-a' }]),
    }
    vi.spyOn(require('../services/playwright-manager'), 'getContext').mockResolvedValue(context)
    vi.spyOn(require('../services/python-bridge'), 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'account-a' },
    })
    const saveRecord = vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord')
      .mockImplementation(() => {})
    const saveCredential = vi.spyOn(accountManager.credentialStore, 'saveCredential')
      .mockReturnValue(true)

    await accountManager.addAccount('wechat_mp')

    expect(saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-a', platform: 'wechat_mp' }),
      'user-a',
      'C:/test-user-data',
    )
    expect(saveCredential).toHaveBeenCalledWith(
      'account-a',
      expect.objectContaining({ platform: 'wechat_mp' }),
      'C:/test-user-data',
      'user-a',
    )
  })

  it('删除账号时同时清理当前 owner 的加密凭证和状态记录', async () => {
    const accountManager = loadAccountManager()
    accountManager.setOwnerSubjectProvider(() => 'user-a')
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'account-a', platform: 'douyin' } })
      .mockResolvedValueOnce({ code: 0 })
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential')
      .mockReturnValue(true)
    const deleteRecord = vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecord')
      .mockImplementation(() => {})

    await expect(accountManager.deleteAccount('account-a')).resolves.toBe(true)

    expect(requestBackend).toHaveBeenNthCalledWith(1, 'GET', '/api/accounts/account-a')
    expect(requestBackend).toHaveBeenNthCalledWith(2, 'DELETE', '/api/accounts/account-a')
    expect(deleteCredential).toHaveBeenCalledWith('account-a', 'C:/test-user-data', 'user-a')
    expect(deleteRecord).toHaveBeenCalledWith('douyin', 'account-a', 'user-a', 'C:/test-user-data')
  })
  it('删除账号时加密凭据删除失败不阻断主流程', async () => {
    const accountManager = loadAccountManager()
    accountManager.setOwnerSubjectProvider(() => 'user-a')
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'account-a', platform: 'douyin' } })
      .mockResolvedValueOnce({ code: 0 })
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential')
      .mockReturnValue(false)  // 模拟删除失败
    const hasCredential = vi.spyOn(accountManager.credentialStore, 'hasCredential')
      .mockReturnValue(true)  // 文件存在
    const deleteRecord = vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecord')
      .mockImplementation(() => {})

    // 凭据删除失败不应抛出异常，账号元数据已删除
    await expect(accountManager.deleteAccount('account-a')).resolves.toBe(true)

    expect(requestBackend).toHaveBeenNthCalledWith(2, 'DELETE', '/api/accounts/account-a')
    expect(deleteRecord).toHaveBeenCalled()
  })

  it('删除账号时凭据不存在则正常完成', async () => {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'account-a', platform: 'douyin' } })
      .mockResolvedValueOnce({ code: 0 })
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential')
      .mockReturnValue(false)  // 文件不存在
    const hasCredential = vi.spyOn(accountManager.credentialStore, 'hasCredential')
      .mockReturnValue(false)  // 文件不存在

    await expect(accountManager.deleteAccount('account-a')).resolves.toBe(true)

    expect(deleteCredential).toHaveBeenCalled()
  })

  it('恢复账号时只读取当前 owner，并恢复 Cookie 与 localStorage', async () => {
    const accountManager = loadAccountManager()
    accountManager.setOwnerSubjectProvider(() => 'user-a')
    const loadCredential = vi.spyOn(accountManager.credentialStore, 'loadCredential')
      .mockReturnValue({
        platform: 'douyin',
        cookies: [{ name: 'sid', value: 'cookie-a', domain: '.douyin.com' }],
        localStorage: { token: 'local-token' },
        accountInfo: { nickName: '用户 A' },
      })
    const getRecord = vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord')
      .mockReturnValue({ platform: 'douyin', accountId: 'account-a' })
    const session = { cookies: { set: vi.fn(async () => {}) } }
    const webContents = { executeJavaScript: vi.fn(async () => {}) }

    const result = await accountManager.openSavedAccount('account-a', 'douyin', {
      session,
      webContents,
    })

    expect(result.isLoggedIn).toBe(true)
    expect(loadCredential).toHaveBeenCalledWith('account-a', 'C:/test-user-data', 'user-a')
    expect(getRecord).toHaveBeenCalledWith('douyin', 'account-a', 'user-a', 'C:/test-user-data')
    expect(session.cookies.set).toHaveBeenCalled()
    expect(webContents.executeJavaScript).toHaveBeenCalled()
  })

  it('平台不匹配或身份服务缺少 sub 时拒绝使用本地凭证', () => {
    const accountManager = loadAccountManager()
    accountManager.setOwnerSubjectProvider(() => 'user-a')
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'wechat_mp',
      localStorage: { token: 'secret' },
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

    expect(accountManager.checkLocalCredentials('douyin', 'account-a')).toBe(false)

    accountManager.setOwnerSubjectProvider(() => null)
    expect(() => accountManager.checkLocalCredentials('douyin', 'account-a'))
      .toThrow('登录会话缺少用户标识')
  })
})

describe('account-manager — 捕获凭证持久化', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })

  it('只在主进程内合并账号状态与加密凭证', () => {
    const accountManager = loadAccountManager()
    const loadCredential = vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      cookies: [{ name: 'session', value: 'secret', domain: '.mp.weixin.qq.com' }],
      localStorage: { token: 'private' },
      indexedDB: { secure: { token: 'indexed' } },
      accountInfo: { nickname: '公众号' },
    })
    const getAccountRecord = vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue({
      accountId: 'account-1',
      platform: 'wechat_mp',
      accountInfo: { nickname: '旧元数据' },
    })

    expect(typeof accountManager.loadSavedCredentials).toBe('function')
    const result = accountManager.loadSavedCredentials('account-1', 'wechat_mp')

    expect(loadCredential).toHaveBeenCalledWith('account-1', '/tmp/test-electron-path')
    expect(getAccountRecord).toHaveBeenCalledWith('wechat_mp', 'account-1')
    expect(result).toEqual({
      cookies: [{ name: 'session', value: 'secret', domain: '.mp.weixin.qq.com' }],
      localStorage: { token: 'private' },
      indexedDB: { secure: { token: 'indexed' } },
      accountInfo: { nickname: '公众号' },
    })
  })

  it('账号代理仅写入加密凭证，公开状态不含认证信息', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'wechat_mp',
      cookies: [{ name: 'session', value: 'secret', domain: '.mp.weixin.qq.com' }],
      localStorage: { token: 'private' },
      accountInfo: {},
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue({
      accountId: 'account-proxy',
      platform: 'wechat_mp',
    })
    const saveCredential = vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)

    expect(accountManager.setAccountProxy('account-proxy', 'wechat_mp', {
      host: '10.0.0.8',
      port: 1080,
      type: 'socks5',
      username: 'account',
      password: 'secret',
    })).toEqual({
      configured: true,
      type: 'socks5',
      hostMasked: '10.0.*.*',
      port: 1080,
      hasAuthentication: true,
    })
    expect(saveCredential).toHaveBeenCalledWith(
      'account-proxy',
      expect.objectContaining({
        proxy: {
          host: '10.0.0.8',
          port: 1080,
          type: 'socks5',
          username: 'account',
          password: 'secret',
        },
      }),
      '/tmp/test-electron-path',
    )

    const publicStatus = accountManager.getAccountProxyStatus('account-proxy', 'wechat_mp')
    expect(JSON.stringify(publicStatus)).not.toContain('account')
    expect(JSON.stringify(publicStatus)).not.toContain('secret')
  })

  it('拒绝与请求平台不匹配的加密凭证，避免跨平台 Cookie 注入', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'wechat_mp',
      cookies: [{ name: 'session', value: 'secret', domain: '.mp.weixin.qq.com' }],
      localStorage: {},
      indexedDB: {},
      accountInfo: {},
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue({
      accountId: 'account-1',
      platform: 'wechat_mp',
    })

    expect(accountManager.loadSavedCredentials('account-1', 'zhihu')).toBeNull()
  })

  it('拒绝没有可信平台归属的旧凭证', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: {},
      indexedDB: {},
      accountInfo: {},
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

    expect(accountManager.loadSavedCredentials('legacy-unbound', 'wechat_mp')).toBeNull()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('后端只写公开元数据，完整凭证只进入加密存储', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'account-1', platform: 'wechat_mp', name: '公众号' },
    })
    const accountManager = loadAccountManager()
    const saveRecord = vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    const saveCredential = vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    const cookies = [{ name: 'session', value: 'secret', domain: '.mp.weixin.qq.com' }]
    const localStorage = { token: 'private' }

    const result = await accountManager.saveCapturedAccount('wechat_mp', {
      cookies,
      localStorage,
      name: '公众号',
      accountInfo: { platformAccountId: 'wx-1' },
    })

    // 创建路径返回真源 + 本次固化的登录态（新增账号立刻显示「已登录」，不必再手动检测）
    // 注：返回值是后端 POST 的原样回显（name 仍为传入的 '公众号'），昵称守卫作用在下方 POST 请求体上。
    expect(result).toEqual({
      id: 'account-1',
      platform: 'wechat_mp',
      name: '公众号',
      status: 'active',
      last_validated: expect.any(String),
    })
    expect(pythonBridge.requestBackend).toHaveBeenCalledWith(
      'PATCH',
      '/api/accounts/account-1',
      { status: 'active', last_validated: expect.any(String) }
    )
    // '公众号' 是 account-name-guard 的 KNOWN_PAGE_TITLES 成员（微信公众平台首页的 document.title
    // 就是这个），而 captured.name 同时是 account_name 的兜底 —— 未过守卫就会把站点名写进真源。
    // 现由 resolveAccountDisplayName 在唯一入口处拦截并回落平台显示名。
    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('POST', '/api/accounts', {
      platform: 'wechat_mp',
      name: '微信公众号',
      account_name: '微信公众号',
      platform_account_id: 'wx-1',
      followers: null,
      avatar: '',
    })
    expect(saveRecord).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      platform: 'wechat_mp',
    }))
    expect(saveRecord.mock.calls[0][0]).not.toHaveProperty('cookies')
    expect(saveRecord.mock.calls[0][0]).not.toHaveProperty('localStorage')
    expect(saveCredential).toHaveBeenCalledWith(
      'account-1',
      { platform: 'wechat_mp', cookies, localStorage, indexedDB: {}, accountInfo: { platformAccountId: 'wx-1' } },
      '/tmp/test-electron-path',
    )
  })

  it('没有有效 Cookie 时拒绝创建空登录账号', async () => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
    const accountManager = loadAccountManager()

    await expect(accountManager.saveCapturedAccount('wechat_mp', {
      cookies: [],
      localStorage: {},
      name: '公众号',
    })).rejects.toThrow('未捕获到有效登录凭证')
    expect(requestBackend).not.toHaveBeenCalled()
  })

  it('没有 Cookie 但包含 localStorage token 时仍可保存账号', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'account-local-token', platform: 'zhihu', name: '知乎账号' },
    })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)

    await expect(accountManager.saveCapturedAccount('zhihu', {
      cookies: [],
      localStorage: { access_token: 'private-token' },
      name: '知乎账号',
    })).resolves.toEqual({
      id: 'account-local-token',
      platform: 'zhihu',
      name: '知乎账号',
      status: 'active',
      last_validated: expect.any(String),
    })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('POST', '/api/accounts', {
      platform: 'zhihu',
      name: '知乎账号',
      account_name: '知乎账号',
      platform_account_id: '',
      followers: null,
      avatar: '',
    })
  })

  it('归一化无效凭证字段，并允许仅凭 IndexedDB 保存账号', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { accountId: 'account-indexed-db', platform: 'wechat_mp' },
    })
    const accountManager = loadAccountManager()
    const saveRecord = vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    const saveCredential = vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)

    await expect(accountManager.saveCapturedAccount('wechat_mp', {
      cookies: 'invalid',
      localStorage: [],
      indexedDB: { auth: { token: 'private' } },
      name: '   ',
      accountInfo: [],
    })).resolves.toEqual({
      accountId: 'account-indexed-db',
      platform: 'wechat_mp',
      status: 'active',
      last_validated: expect.any(String),
    })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('POST', '/api/accounts', {
      platform: 'wechat_mp',
      name: accountManager.PLATFORM_NAMES.wechat_mp,
      account_name: accountManager.PLATFORM_NAMES.wechat_mp,
      platform_account_id: '',
      followers: null,
      avatar: '',
    })
    expect(saveRecord).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-indexed-db',
      platformAccountId: '',
      accountInfo: {},
    }))
    expect(saveCredential).toHaveBeenCalledWith(
      'account-indexed-db',
      { platform: 'wechat_mp', cookies: [], localStorage: {}, indexedDB: { auth: { token: 'private' } }, accountInfo: {} },
      '/tmp/test-electron-path',
    )
  })

  it.each([
    null,
    undefined,
    'invalid',
    { cookies: {}, localStorage: [], indexedDB: [] },
  ])('拒绝归一化后仍为空的凭证: %j', async captured => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
    const accountManager = loadAccountManager()

    await expect(accountManager.saveCapturedAccount('wechat_mp', captured))
      .rejects.toThrow('未捕获到有效登录凭证')
    expect(requestBackend).not.toHaveBeenCalled()
  })

  it('后端保存失败或未返回账号 ID 时不写入本地凭证', async () => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
      .mockResolvedValueOnce({ code: 1, message: '后端拒绝保存' })
      .mockResolvedValueOnce({ code: 0, data: {} })
    const accountManager = loadAccountManager()
    const saveRecord = vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord')
    const saveCredential = vi.spyOn(accountManager.credentialStore, 'saveCredential')
    const captured = { cookies: [{ name: 'session', value: 'secret', domain: '.mp.weixin.qq.com' }] }

    await expect(accountManager.saveCapturedAccount('wechat_mp', captured))
      .rejects.toThrow('后端拒绝保存')
    await expect(accountManager.saveCapturedAccount('wechat_mp', captured))
      .rejects.toThrow('保存账号后未返回账号 ID')
    expect(saveRecord).not.toHaveBeenCalled()
    expect(saveCredential).not.toHaveBeenCalled()
  })

  it('加密凭证写入失败时回滚后端账号并拒绝返回成功', async () => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'account-rollback', platform: 'wechat_mp' } })
      .mockResolvedValueOnce({ code: 0, data: true })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(false)
    const saveRecord = vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord')

    await expect(accountManager.saveCapturedAccount('wechat_mp', {
      cookies: [{ name: 'session', value: 'secret', domain: '.mp.weixin.qq.com' }],
    })).rejects.toThrow('加密凭证保存失败')

    expect(requestBackend).toHaveBeenNthCalledWith(2, 'DELETE', '/api/accounts/account-rollback')
    expect(saveRecord).not.toHaveBeenCalled()
  })

  it.each(['', null, undefined, 'a/b', 'id!', 'id\n'])('删除前拒绝非法账号 ID: %j', async accountId => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
    const accountManager = loadAccountManager()

    await expect(accountManager.deleteAccount(accountId)).rejects.toThrow('缺少或非法账号 ID')
    expect(requestBackend).not.toHaveBeenCalled()
  })

  it('后端删除失败时保留本地状态和加密凭证', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { platform: 'wechat_mp' } })
      .mockResolvedValueOnce({ code: 1, message: '删除被拒绝' })
    const accountManager = loadAccountManager()
    const deleteRecord = vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecord')
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential')

    await expect(accountManager.deleteAccount('account-1')).rejects.toThrow('删除被拒绝')
    expect(deleteRecord).not.toHaveBeenCalled()
    expect(deleteCredential).not.toHaveBeenCalled()
  })

  it('后端查询账号失败时仍按账号 ID 清理全部本地状态', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend')
      .mockRejectedValueOnce(new Error('查询失败'))
      .mockResolvedValueOnce({ code: 0, data: true })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.accountStateRestorer, 'listLoggedInAccounts').mockReturnValue([
      { accountId: 'account-1', platform: 'zhihu' },
    ])
    const deleteRecords = vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecordsById').mockReturnValue(true)
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential').mockReturnValue(true)

    await expect(accountManager.deleteAccount('account-1')).resolves.toBe(true)
    expect(deleteRecords).toHaveBeenCalledWith('account-1')
    expect(deleteCredential).toHaveBeenCalledWith('account-1', '/tmp/test-electron-path')
  })

  it('只从加密存储恢复凭证，账号状态仅补充公开元数据', () => {
    const accountManager = loadAccountManager()
    const loadCredential = vi.spyOn(accountManager.credentialStore, 'loadCredential')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({
        platform: 'wechat_mp',
        cookies: [{ name: 'session', value: 'encrypted-cookie', domain: '.mp.weixin.qq.com' }],
        localStorage: { token: 'encrypted' },
        indexedDB: { secure: true },
        accountInfo: { id: 'encrypted' },
      })
      .mockReturnValueOnce(null)
    const getAccountRecord = vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord')
      .mockReturnValueOnce({
        accountInfo: { id: 'record' },
      })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)

    expect(accountManager.loadSavedCredentials('record-only', 'wechat_mp')).toBeNull()
    expect(accountManager.loadSavedCredentials('encrypted-only', 'wechat_mp')).toEqual({
      cookies: [{ name: 'session', value: 'encrypted-cookie', domain: '.mp.weixin.qq.com' }],
      localStorage: { token: 'encrypted' },
      indexedDB: { secure: true },
      accountInfo: { id: 'encrypted' },
    })
    expect(accountManager.loadSavedCredentials('missing', 'wechat_mp')).toBeNull()
  })

  it('本地凭证检查只认可加密存储，公开状态记录不能伪装为登录态', () => {
    const accountManager = loadAccountManager()
    const hasCredential = vi.spyOn(accountManager.credentialStore, 'hasCredential')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'wechat_mp',
      cookies: [{ name: 'session', value: 'encrypted-cookie', domain: '.mp.weixin.qq.com' }],
      localStorage: {},
      accountInfo: {},
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue({ platform: 'wechat_mp' })

    expect(accountManager.checkLocalCredentials('wechat_mp', 'encrypted-only')).toBe(true)
    expect(accountManager.checkLocalCredentials('wechat_mp', 'record-only')).toBe(false)
    expect(hasCredential).toHaveBeenCalledTimes(2)
  })

  it('假保存凭证（cookies 为空且 localStorage 无平台会话标记）不得判定为有效凭证', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    const dirtyLs = { 'UvFirstReportLocalKey': '1', '__ml::aid': 'x', 'finder_route_meta': '{}' }
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockImplementation(function (accountId) {
      return accountId === 'ls-empty-acc'
        ? { platform: 'tencent_video', cookies: [], localStorage: {}, accountInfo: {} }
        : { platform: 'tencent_video', cookies: [], localStorage: dirtyLs, accountInfo: {} }
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue({ platform: 'tencent_video' })

    // 存量假保存快照（cookies=0 + 仅埋点脏键）与空凭证都必须判 false，
    // 让账号页收敛到「需重新登录」，而不是伪装可用后把用户送进登录页回环。
    expect(accountManager.checkLocalCredentials('tencent_video', 'fake-saved-acc')).toBe(false)
    expect(accountManager.checkLocalCredentials('tencent_video', 'ls-empty-acc')).toBe(false)
  })

  it('纯 localStorage 会话标记（视频号 finder_username）不被加严判定误伤', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'tencent_video',
      cookies: [],
      localStorage: { finder_username: 'v2_060000231003b20fa' },
      accountInfo: {},
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue({ platform: 'tencent_video' })

    expect(accountManager.checkLocalCredentials('tencent_video', 'ls-marker-acc')).toBe(true)
  })

  it('cookies 非空的正常凭证不受加严判定影响', () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'tencent_video',
      cookies: [{ name: 'sessionid', value: 's3cr3t', domain: '.channels.weixin.qq.com' }],
      localStorage: {},
      accountInfo: {},
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue({ platform: 'tencent_video' })

    expect(accountManager.checkLocalCredentials('tencent_video', 'normal-acc')).toBe(true)
  })

  it('删除账号后同步清理本地状态和加密凭证', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'account-1', platform: 'wechat_mp' } })
      .mockResolvedValueOnce({ code: 0, data: true })
    const accountManager = loadAccountManager()
    const deleteRecords = vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecordsById').mockReturnValue(true)
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential').mockReturnValue(true)

    await expect(accountManager.deleteAccount('account-1')).resolves.toBe(true)

    expect(deleteRecords).toHaveBeenCalledWith('account-1')
    expect(deleteCredential).toHaveBeenCalledWith('account-1', '/tmp/test-electron-path')
  })

  it('后端删除成功后本地状态清理异常不改变删除结果，并继续清理其他凭证', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'account-1', platform: 'wechat_mp' } })
      .mockResolvedValueOnce({ code: 0, data: true })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecordsById').mockImplementation(() => {
      throw new Error('state file locked')
    })
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential').mockReturnValue(true)

    await expect(accountManager.deleteAccount('account-1')).resolves.toBe(true)
    expect(deleteCredential).toHaveBeenCalledWith('account-1', '/tmp/test-electron-path')
  })

  it('加密凭据文件存在但删除失败时不阻断删除并记录 warn 日志', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { id: 'account-1', platform: 'wechat_mp' } })
      .mockResolvedValueOnce({ code: 0, data: true })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'deleteCredential').mockReturnValue(false)
    const deleteRecords = vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecordsById')

    // 修复目标：凭据文件删除失败不阻断账号删除，账号元数据已删除，状态索引继续清理
    await expect(accountManager.deleteAccount('account-1')).resolves.toBe(true)
    expect(deleteRecords).toHaveBeenCalledWith('account-1')
  })

  it('后端账号已不存在时仍重试本地凭据和状态清理', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend')
      .mockResolvedValueOnce({ detail: '账号不存在' })
      .mockResolvedValueOnce({ detail: '账号不存在' })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential').mockReturnValue(true)
    const deleteRecords = vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecordsById').mockReturnValue(true)

    await expect(accountManager.deleteAccount('account-1')).resolves.toBe(true)
    expect(deleteCredential).toHaveBeenCalledWith('account-1', '/tmp/test-electron-path')
    expect(deleteRecords).toHaveBeenCalledWith('account-1')
  })

  it('后端 404 被 pythonBridge 归一化后（code:-404）仍清理本地凭据', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend')
      .mockResolvedValueOnce({ code: -404, status: 404, detail: '账号不存在', message: '账号不存在' })
      .mockResolvedValueOnce({ code: -404, status: 404, detail: '账号不存在', message: '账号不存在' })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    const deleteCredential = vi.spyOn(accountManager.credentialStore, 'deleteCredential').mockReturnValue(true)
    const deleteRecords = vi.spyOn(accountManager.accountStateRestorer, 'deleteAccountRecordsById').mockReturnValue(true)

    await expect(accountManager.deleteAccount('account-1')).resolves.toBe(true)
    expect(deleteCredential).toHaveBeenCalledWith('account-1', '/tmp/test-electron-path')
    expect(deleteRecords).toHaveBeenCalledWith('account-1')
  })

  it.each([
    ['../wechat_mp', 'account-1'],
    ['wechat_mp', '../account-1'],
    ['wechat_mp', 'account?other=1'],
  ])('检查登录状态前纵深拒绝非法路径段: %s / %s', async (platform, accountId) => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
    const accountManager = loadAccountManager()

    await expect(accountManager.checkLoginStatus(platform, accountId))
      .resolves.toEqual({ valid: false, code: 'CHECK_LOGIN_INVALID_PARAMS' })
    expect(requestBackend).not.toHaveBeenCalled()
  })

  it('仅有 localStorage 凭证时仍使用隐藏页面检查登录状态', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const actualPlaywrightManager = require(playwrightPath)
    const page = {
      context: () => ({ addCookies: vi.fn() }),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue('https://mp.weixin.qq.com/cgi-bin/home'),
    }
    const getContext = vi.fn().mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) })
    global.__registerMock(playwrightPath, { getContext })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'wechat_mp',
        cookies: [],
        localStorage: { accessToken: 'secret' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      await expect(accountManager.checkLoginStatus('wechat_mp', 'account-storage'))
        .resolves.toEqual({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })
      expect(getContext).toHaveBeenCalledWith({ show: false })
      expect(page.addInitScript).toHaveBeenCalledTimes(1)
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
    }
  })
})

describe('checkLoginStatus 多选择器回归（数组选择器逐个尝试）', () => {
  it('waitForSelector 收到数组选择器时逐一尝试，匹配到任一个即返回 true', async () => {
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
      url: vi.fn().mockReturnValue('https://creator.douyin.com'),
    }
    const getContext = vi.fn().mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) })
    global.__registerMock(playwrightPath, { getContext })
    // douyin 走 HTTP API 快速路径，mock 为 null（不适用）以走浏览器检测路径
    global.__registerMock(httpCheckerPath, { tryHttpLoginCheck: vi.fn().mockResolvedValue(null) })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'douyin',
        cookies: [{ name: 'sid', value: 'v1', domain: '.douyin.com' }],
        localStorage: { token: 'active' },
        accountInfo: {},
      })

      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      await expect(accountManager.checkLoginStatus('douyin', 'acc-1'))
        .resolves.toEqual({ valid: true, code: 'CHECK_LOGIN_SUCCESS' })
      const selectorArg = page.waitForSelector.mock.calls[0][0]
      expect(Array.isArray(selectorArg)).toBe(true)
      expect(selectorArg).toEqual(['.user-info', '.account-info', '.creator-header'])
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('selector 超时但 URL 在仪表盘域名下仍判为有效', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const actualPlaywrightManager = require(playwrightPath)
    const page = {
      context: () => ({ addCookies: vi.fn() }),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout')),
      close: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue('https://cp.kuaishou.com/article/publish/video'),
    }
    const getContext = vi.fn().mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) })
    global.__registerMock(playwrightPath, { getContext })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'kuaishou',
        cookies: [{ name: 'kuaishou_sid', value: 'active', domain: '.kuaishou.com' }],
        localStorage: { token: 'valid' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      await expect(accountManager.checkLoginStatus('kuaishou', 'acc-1'))
        .resolves.toMatchObject({ valid: true })
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
    }
  })

  it('公众号登录页与后台同域：URL 含 login 特征必须判失效（回归：域名兜底先于 login 检查导致恒真）', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const actualPlaywrightManager = require(playwrightPath)
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualHttpChecker = require(httpCheckerPath)
    const page = {
      context: () => ({ addCookies: vi.fn() }),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout')),
      close: vi.fn().mockResolvedValue(undefined),
      // 公众号登出后的真实重定向：登录页与后台同 host（mp.weixin.qq.com）
      url: vi.fn().mockReturnValue('https://mp.weixin.qq.com/cgi-bin/loginpage?t=login&lang=zh_CN'),
    }
    const getContext = vi.fn().mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) })
    global.__registerMock(playwrightPath, { getContext })
    // 公众号已注册 HTTP 检测；此测试聚焦浏览器 URL login 判定，故 mock HTTP 检测不适用
    global.__registerMock(httpCheckerPath, { tryHttpLoginCheck: vi.fn(() => null) })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'wechat_mp',
        cookies: [{ name: 'slave_sid', value: 'expired-24h', domain: '.weixin.qq.com' }],
        localStorage: { token: 'stale' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      await expect(accountManager.checkLoginStatus('wechat_mp', 'acc-wx'))
        .resolves.toMatchObject({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('公众号 Cookie 过期：HTTP 检测识别 302 到 loginpage → 判失效（回归：DOM 骨架误判有效）', async () => {
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualHttpChecker = require(httpCheckerPath)
    // 公众号 HTTP 检测：302 到 loginpage → expired
    global.__registerMock(httpCheckerPath, {
      tryHttpLoginCheck: vi.fn().mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }),
    })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'wechat_mp',
        cookies: [{ name: 'slave_sid', value: 'expired-24h', domain: '.weixin.qq.com' }],
        localStorage: { token: 'stale' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      await expect(accountManager.checkLoginStatus('wechat_mp', 'acc-wx-http'))
        .resolves.toMatchObject({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    } finally {
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('selector 超时 + URL 仍在 login 特征中 → 判定过期', async () => {
    const playwrightPath = require.resolve('../services/playwright-manager')
    const actualPlaywrightManager = require(playwrightPath)
    const page = {
      context: () => ({ addCookies: vi.fn() }),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout')),
      close: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue('https://passport.bilibili.com/login?returnUrl=...'),
    }
    const getContext = vi.fn().mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) })
    global.__registerMock(playwrightPath, { getContext })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'bilibili',
        cookies: [{ name: 'expired', value: '1', domain: '.bilibili.com' }],
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      await expect(accountManager.checkLoginStatus('bilibili', 'acc-1'))
        .resolves.toMatchObject({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    } finally {
      global.__registerMock(playwrightPath, actualPlaywrightManager)
    }
  })
})

describe('checkLoginStatus 渲染崩溃平台降级', () => {
  it('tencent_video 有 Cookie 时优先 HTTP 检测：302 到登录页 → 判失效（回归：本地凭证文件仍在但 Cookie 已过期）', async () => {
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualHttpChecker = require(httpCheckerPath)
    // 视频号 HTTP 检测：访问后台首页 302 到登录页 → expired
    global.__registerMock(httpCheckerPath, {
      tryHttpLoginCheck: vi.fn().mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }),
    })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'tencent_video',
        cookies: [{ name: 'sessionid', value: 'expired', domain: '.weixin.qq.com' }],
        localStorage: { token: 'stale' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      const result = await accountManager.checkLoginStatus('tencent_video', 'acc-tv')
      expect(result).toEqual({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    } finally {
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('tencent_video HTTP 检测有效 → 判有效（不降级到浏览器 DOM 检测）', async () => {
    const httpCheckerPath = require.resolve('./http-login-checker')
    const actualHttpChecker = require(httpCheckerPath)
    global.__registerMock(httpCheckerPath, {
      tryHttpLoginCheck: vi.fn().mockResolvedValue({ valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' }),
    })

    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'tencent_video',
        cookies: [{ name: 'sessionid', value: 'valid', domain: '.weixin.qq.com' }],
        localStorage: { token: 'valid' },
        accountInfo: {},
      })
      vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

      const result = await accountManager.checkLoginStatus('tencent_video', 'acc-tv-valid')
      expect(result).toEqual({ valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    } finally {
      global.__registerMock(httpCheckerPath, actualHttpChecker)
    }
  })

  it('tencent_video 假保存快照（无 Cookie 且 LS 无会话标记）→ 判无凭证需重新登录（2026-09-24 加严）', async () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'tencent_video',
      cookies: [],
      localStorage: { token: 'valid' },
      accountInfo: {},
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

    const result = await accountManager.checkLoginStatus('tencent_video', 'acc-tv')
    // ⚠️ 契约变更（2026-09-24）：旧断言 INCONCLUSIVE 让假保存快照（cookies=0 + 仅非
    // 会话键）继续伪装「未确认」。加严后 checkLocalCredentials 判其无凭证证据
    // → NO_CREDENTIAL，账号页收敛为「需重新登录」而非灰色待确认。
    expect(result).toEqual({ valid: false, code: 'CHECK_LOGIN_NO_CREDENTIAL' })
  })

  it('tencent_video 无 Cookie 但 localStorage 有会话标记且无 HTTP 证据 → 判未确认（INCONCLUSIVE 仅留真存疑态）', async () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'tencent_video',
      cookies: [],
      localStorage: { finder_username: 'v2_060000231003b20fa' },
      accountInfo: {},
    })
    vi.spyOn(accountManager.accountStateRestorer, 'getAccountRecord').mockReturnValue(null)

    const result = await accountManager.checkLoginStatus('tencent_video', 'acc-tv-marker')
    // 纯 localStorage 登录态（视频号 finder_username）是真实凭证证据，不得收紧为
    // NO_CREDENTIAL；无 HTTP 复核证据时保持三态中的「未确认」。
    expect(result.valid).toBeUndefined()
    expect(result.code).toBe('CHECK_LOGIN_INCONCLUSIVE')
  })

  it('tencent_video 无 Cookie 且无本地凭证时返回 NO_CREDENTIAL', async () => {
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(false)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue(null)

    const result = await accountManager.checkLoginStatus('tencent_video', 'acc-tv-none')
    expect(result).toEqual({ valid: false, code: 'CHECK_LOGIN_NO_CREDENTIAL' })
  })
})


describe('checkLoginStatus session 分区 Cookie 合并（回归：加密凭证 cookies 恒 0）', () => {
  const httpCheckerPath = () => require.resolve('./http-login-checker')

  function setPartitionCookies (cookies) {
    global.__electronMock.session = {
      fromPartition: vi.fn(() => ({ cookies: { get: vi.fn(() => Promise.resolve(cookies)) } })),
    }
  }

  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })

  afterEach(() => {
    delete global.__electronMock.session
    vi.restoreAllMocks()
  })

  it('加密凭证无 Cookie 但分区有 → 检测使用分区 Cookie（不再空输入降级）', async () => {
    setPartitionCookies([{ name: 'sessionid', value: 'partition-sid', domain: '.weixin.qq.com' }])
    const actual = require(httpCheckerPath())
    const spy = vi.fn().mockResolvedValue({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    global.__registerMock(httpCheckerPath(), { tryHttpLoginCheck: spy })
    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'tencent_video', cookies: [], localStorage: {}, accountInfo: {},
      })

      const result = await accountManager.checkLoginStatus('tencent_video', 'acc-tv-part')

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][1]).toEqual([
        expect.objectContaining({ name: 'sessionid', value: 'partition-sid' }),
      ])
      expect(result).toEqual({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
    } finally {
      global.__registerMock(httpCheckerPath(), actual)
    }
  })

  it('toutiao 分区有 Cookie 时不再走 NO_COOKIE 硬判失效（回归：今日头条实际已登录却显示失效）', async () => {
    setPartitionCookies([{ name: 'sessionid', value: 'tt-sid', domain: '.toutiao.com' }])
    const actual = require(httpCheckerPath())
    global.__registerMock(httpCheckerPath(), {
      tryHttpLoginCheck: vi.fn().mockResolvedValue({ valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' }),
    })
    try {
      const accountManager = loadAccountManager()
      vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
      vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
        platform: 'toutiao', cookies: [], localStorage: { sso: 'v' }, accountInfo: {},
      })

      const result = await accountManager.checkLoginStatus('toutiao', 'acc-tt')
      expect(result).toEqual({ valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })
    } finally {
      global.__registerMock(httpCheckerPath(), actual)
    }
  })

  it('toutiao 无任何 Cookie 但有 localStorage → 仍走 NO_COOKIE 快速路径判失效', async () => {
    setPartitionCookies([])
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue({
      platform: 'toutiao', cookies: [], localStorage: { sso: 'v' }, accountInfo: {},
    })

    const result = await accountManager.checkLoginStatus('toutiao', 'acc-tt-empty')
    expect(result).toEqual({ valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' })
  })

  it('完全无凭证（加密文件与分区 Cookie 均空）→ 确定失效，不需检测手段', async () => {
    setPartitionCookies([])
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.credentialStore, 'hasCredential').mockReturnValue(false)
    vi.spyOn(accountManager.credentialStore, 'loadCredential').mockReturnValue(null)

    const result = await accountManager.checkLoginStatus('kuaishou', 'acc-ks-none')
    expect(result).toEqual({ valid: false, code: 'CHECK_LOGIN_NO_CREDENTIAL' })
  })

  it('getAccountPartitionCookies 按平台域名过滤，session 不可用时返回空数组', async () => {
    const accountManager = loadAccountManager()
    setPartitionCookies([
      { name: 'sessionid', value: 'v', domain: '.toutiao.com' },
      { name: 'other', value: 'v', domain: '.example.com' },
    ])
    expect(await accountManager.getAccountPartitionCookies('toutiao', 'acc-x'))
      .toEqual([{ name: 'sessionid', value: 'v', domain: '.toutiao.com' }])

    delete global.__electronMock.session
    expect(await accountManager.getAccountPartitionCookies('toutiao', 'acc-x')).toEqual([])
    // 非法 accountId 必须被拒绝（不得拼进 fromPartition）
    setPartitionCookies([{ name: 'a', value: 'b', domain: '.toutiao.com' }])
    expect(await accountManager.getAccountPartitionCookies('toutiao', '../etc')).toEqual([])
  })

  it('mergeCookies 按 name+domain 去重且前者优先', () => {
    const accountManager = loadAccountManager()
    const merged = accountManager.mergeCookies(
      [{ name: 'sid', value: 'enc', domain: '.x.com' }],
      [{ name: 'sid', value: 'part', domain: '.x.com' }, { name: 'uid', value: 'p2', domain: '.x.com' }],
    )
    expect(merged).toEqual([
      { name: 'sid', value: 'enc', domain: '.x.com' },
      { name: 'uid', value: 'p2', domain: '.x.com' },
    ])
  })
})

describe('persistLoginState 登录态唯一写者', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([['active'], ['expired'], ['unverified']])('status=%s 写回后端真源', async (status) => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({ code: 0, data: {} })
    const accountManager = loadAccountManager()

    const result = await accountManager.persistLoginState('acc-1', 'douyin', status, '2026-09-22T15:38:27.000Z')

    expect(result).toEqual({ ok: true, status })
    expect(requestBackend).toHaveBeenCalledWith('PATCH', '/api/accounts/acc-1', {
      status, last_validated: '2026-09-22T15:38:27.000Z',
    })
  })

  it('非法 status 不发起请求（避免脏写真源）', async () => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
    const accountManager = loadAccountManager()

    const result = await accountManager.persistLoginState('acc-1', 'douyin', 'logged_in')

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid-status')
    expect(requestBackend).not.toHaveBeenCalled()
  })

  it('后端写回失败必须可见（返回 ok=false，不静默）', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({ code: 404, message: '账号不存在' })
    const accountManager = loadAccountManager()

    const result = await accountManager.persistLoginState('acc-missing', 'douyin', 'expired')

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('backend-error')
    expect(result.code).toBe(404)
  })

})

describe('account-manager — listAccounts 错误透传', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('后端返回非零 code 时抛出携带 errorCode 与 status 的错误', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: -503,
      status: 503,
      errorCode: 'AUTH_JWKS_UNAVAILABLE',
      message: 'AUTH_JWKS_UNAVAILABLE',
      data: [],
    })
    const accountManager = loadAccountManager()

    const error = await accountManager.listAccounts().catch((e) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error.errorCode).toBe('AUTH_JWKS_UNAVAILABLE')
    expect(error.status).toBe(503)
  })

  it('后端返回无错误码的失败时仍抛出原始 message', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({ code: 1, message: 'boom' })
    const accountManager = loadAccountManager()

    await expect(accountManager.listAccounts()).rejects.toThrow('boom')
  })
})

describe('setAccountActive 启用态唯一写者（与登录态正交）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([[true], [false]])('is_active=%s 只 PATCH 启用态，绝不附带登录态字段', async (isActive) => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({ code: 0, data: {} })
    const accountManager = loadAccountManager()

    const result = await accountManager.setAccountActive('acc-1', 'douyin', isActive)

    expect(result).toEqual({ ok: true, is_active: isActive })
    expect(requestBackend).toHaveBeenCalledTimes(1)
    const [method, url, body] = requestBackend.mock.calls[0]
    expect(method).toBe('PATCH')
    expect(url).toBe('/api/accounts/acc-1')
    expect(body).toEqual({ is_active: isActive })
    // 正交性铁律：写启用态不得顺手改登录态或校验时间，否则「停用」会被伪装成一次登录检测。
    expect(body).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('last_validated')
  })

  it('非布尔 isActive 不发起请求（宽松类型会静默改写账号发布能力）', async () => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
    const accountManager = loadAccountManager()

    for (const dirty of ['false', 'true', 0, 1, null, undefined, {}, []]) {
      const result = await accountManager.setAccountActive('acc-1', 'douyin', dirty)
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid-is-active')
    }
    expect(requestBackend).not.toHaveBeenCalled()
  })

  it('非法 accountId 不发起请求（防路径段注入）', async () => {
    const pythonBridge = require('../services/python-bridge')
    const requestBackend = vi.spyOn(pythonBridge, 'requestBackend')
    const accountManager = loadAccountManager()

    const result = await accountManager.setAccountActive('../etc/passwd', 'douyin', false)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid-account-id')
    expect(requestBackend).not.toHaveBeenCalled()
  })

  it('后端写回失败必须可见（返回 ok=false，不静默）', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({ code: 404, message: '账号不存在' })
    const accountManager = loadAccountManager()

    const result = await accountManager.setAccountActive('acc-missing', 'douyin', false)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('backend-error')
    expect(result.code).toBe(404)
  })

  it('后端异常必须可见且不外抛', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockRejectedValue(new Error('connection refused'))
    const accountManager = loadAccountManager()

    const result = await accountManager.setAccountActive('acc-1', 'douyin', true)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('exception')
    expect(result.error).toContain('connection refused')
  })
})

describe('captureCookies 登录完成判据与会话凭证门禁（第 4 个入库入口）', () => {
  // 2026-09-26 CCG 评审 Warning 2：captureCookies 的「方式 2」只判 window.location.host
  // 是否偏离 PLATFORM_LOGIN_URLS 的 host。快手登录入口 cp.kuaishou.com 会被前端带到
  // passport.kuaishou.com 登录页 —— host 已变，于是用户还没登录就被判「登录完成」，
  // 采到的全是埋点 Cookie，再经 addAccount → saveCapturedAccount 直接入库。
  // 同日后续项把语义改写为：①导航必须落在平台可信域且不是登录页（isPlatformLeftLoginPage）；
  // ②同域平台（快手登录前后都在 cp.kuaishou.com）只能靠已声明的会话凭证标记判定完成。
  const LOGIN_TIMEOUT_MS = 500

  function mockPlaywrightPage ({ cookies = [], urls = [], selectorHits = false, urlThrows = 0 } = {}) {
    let urlIndex = 0
    let throwsLeft = urlThrows
    const page = {
      addInitScript: vi.fn(async () => {}),
      goto: vi.fn(async () => {}),
      url: vi.fn(() => {
        if (throwsLeft > 0) {
          throwsLeft--
          throw new Error('navigation in flight')
        }
        return urls[Math.min(urlIndex++, urls.length - 1)] || ''
      }),
      waitForSelector: vi.fn((selector, opts) => {
        if (selectorHits) return Promise.resolve(true)
        // 只有「等待用户登录」那一次用的是调用方传入的 timeout；真实浏览器里选择器
        // 始终不出现时它会一直悬着。预检（5s）与 smartWait（3s）按未命中处理。
        return (opts && opts.timeout === LOGIN_TIMEOUT_MS)
          ? new Promise(() => {})
          : Promise.reject(new Error('selector not found'))
      }),
      // 陷阱：页面内 host 比较已从实现中移除，任何人改回去都会在这里炸出明确原因。
      waitForFunction: vi.fn(async () => {
        throw new Error('legacy 方式2（页面内 host 比较）不得再被调用')
      }),
      evaluate: vi.fn(async () => ({})),
      $: vi.fn(async () => null),
      close: vi.fn(async () => {}),
    }
    const playwrightManager = require('../services/playwright-manager')
    vi.spyOn(playwrightManager, 'getContext').mockResolvedValue({
      newPage: async () => page,
      cookies: async () => cookies,
    })
    return page
  }

  // 轮询间隔可经环境变量收紧，避免单测真等 5 分钟（与实现里的硬超时同一预算）
  beforeEach(() => { process.env.MP_ACCOUNT_LOGIN_POLL_MS = '5' })
  afterEach(() => { delete process.env.MP_ACCOUNT_LOGIN_POLL_MS })

  it('快手只采到埋点 Cookie 时抛错，不返回可入库凭证', async () => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    const accountManager = loadAccountManager()
    // 选择器命中 = 正向证据，但埋点 Cookie 不构成会话证据，门禁仍必须拦住
    mockPlaywrightPage({
      selectorHits: true,
      cookies: [
        { name: 'did', value: 'anon' },
        { name: 'wid', value: 'anon' },
        { name: 'kwssectoken', value: 'anon' },
      ],
    })

    await expect(accountManager.captureCookies('kuaishou', LOGIN_TIMEOUT_MS)).rejects.toThrow('未检测到登录态')
  })

  it('跳到 passport 登录页不再算登录完成（方式2 语义收口）', async () => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    const accountManager = loadAccountManager()
    const page = mockPlaywrightPage({
      urls: ['https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api&callback=https%3A%2F%2Fcp.kuaishou.com%2Frest%2Finfra%2Fsts'],
      cookies: [{ name: 'did', value: 'anon' }],
    })

    await expect(accountManager.captureCookies('kuaishou', LOGIN_TIMEOUT_MS)).rejects.toThrow('登录超时')
    expect(page.waitForFunction).not.toHaveBeenCalled()
  })

  it('同域平台靠会话票据出现即完成（不需要选择器命中）', async () => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    const accountManager = loadAccountManager()
    // 登录前后 URL 都是 cp.kuaishou.com，URL 判定本质上不可区分；
    // 快手登录页 DOM 也不一定命中选择器，必须由会话凭证标记把「已登录」测出来。
    mockPlaywrightPage({
      urls: ['https://cp.kuaishou.com/profile'],
      cookies: [
        { name: 'did', value: 'anon' },
        { name: 'kuaishou.web.cp.api_st', value: 'ST-real' },
      ],
    })

    const result = await accountManager.captureCookies('kuaishou', LOGIN_TIMEOUT_MS)

    expect(result.cookies.map(c => c.name)).toContain('kuaishou.web.cp.api_st')
    expect(result.loginVerified).toBe(false) // 票据只证明可入库，不证明正向证据
  })

  it('page.url() 瞬态抛错不得提前放弃方式2（QM-6 Info 3）', async () => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    const accountManager = loadAccountManager()
    // 真实 Playwright 在导航进行中读 url() 可能瞬态抛错；一旦据此结束整个方式2，
    // 同域平台就退回到「只能靠选择器」，用户白等一次超时。
    mockPlaywrightPage({
      urlThrows: 1,
      urls: ['https://cp.kuaishou.com/profile'],
      cookies: [{ name: 'userId', value: '42' }],
    })

    const result = await accountManager.captureCookies('kuaishou', LOGIN_TIMEOUT_MS)

    expect(result.cookies.map(c => c.name)).toContain('userId')
  })

  it('命中会话票据后正常返回凭证（防空门禁把流程锁死）', async () => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    const accountManager = loadAccountManager()
    mockPlaywrightPage({
      selectorHits: true,
      cookies: [
        { name: 'did', value: 'anon' },
        { name: 'kuaishou.web.cp.api_st', value: 'ST-1' },
      ],
    })

    const result = await accountManager.captureCookies('kuaishou', LOGIN_TIMEOUT_MS)

    expect(result.cookies.map(c => c.name)).toContain('kuaishou.web.cp.api_st')
  })

  it('未声明会话标记的平台沿用既有行为', async () => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    const accountManager = loadAccountManager()
    // wechat_mp 登录页与后台同域且未声明标记：只能由选择器判定，行为与改动前一致
    mockPlaywrightPage({
      selectorHits: true,
      cookies: [{ name: 'session', value: 'x' }],
    })

    await expect(accountManager.captureCookies('wechat_mp', LOGIN_TIMEOUT_MS)).resolves.toMatchObject({
      cookies: [{ name: 'session', value: 'x' }],
    })
  })

  it('未声明标记的平台不会因「有 Cookie」被方式2 提前判定完成', async () => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    const accountManager = loadAccountManager()
    const page = mockPlaywrightPage({
      urls: ['https://mp.weixin.qq.com/'],
      cookies: [{ name: 'anything', value: 'v' }],
    })

    // fail-open 的 hasPlatformSessionCookie 不得被当成登录证据，否则会立刻假成功
    await expect(accountManager.captureCookies('wechat_mp', LOGIN_TIMEOUT_MS)).rejects.toThrow('登录超时')
    expect(page.waitForFunction).not.toHaveBeenCalled()
  })
})
