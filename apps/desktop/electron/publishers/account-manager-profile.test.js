// @ts-check
/**
 * account-manager-profile.test.js — 账号资料写回与回填（PRD-ACCOUNT-PROFILE-INFO-2026-09-23，T8/T9 + 接线守卫）
 *
 * 两类必须被钉住的退化：
 * 1. 反向覆写：提取失败时把未命中字段算成空串 PATCH 下去，清空上一次已获取的昵称/头像。
 *    后端 PATCH 的语义是「字段缺席 = 不修改」（`... | None = None` + `is not None` 才赋值），
 *    因此主进程只能下发命中字段。
 * 2. 装饰性链路：采集能力存在但没有任何入口调用（历史上发生过三次）。故除行为测试外，
 *    本文件对四个接线点做源码守卫断言——能力与调用点必须同时存在，缺一即红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fs = require('fs')
const modulePath = './account-manager'

function loadAccountManager () {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

const TOUTIAO_COOKIE = [{ name: 'sid_tt', value: 'fresh', domain: '.toutiao.com' }]
const CURRENT_ACCOUNT = {
  id: 'acc-1',
  platform: 'toutiao',
  status: 'active',
  name: '今日头条',
  account_name: '老昵称',
  avatar: 'https://cdn/old.png',
  platform_account_id: 'uid-old',
  followers: 100,
}

describe('updateCapturedAccount — PATCH 只下发命中字段（T8）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    global.__electronMock.app.getPath = function () { return 'C:/test-user-data' }
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function runUpdate (accountInfo, current) {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: current ? { ...CURRENT_ACCOUNT, ...current } : { ...CURRENT_ACCOUNT } })
      .mockResolvedValueOnce({ code: 0, data: {} })
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    const captured = { cookies: TOUTIAO_COOKIE, name: '头条号 - 个人中心' }
    if (accountInfo !== undefined) captured.accountInfo = accountInfo
    const saved = await accountManager.updateCapturedAccount('toutiao', captured, 'acc-1')
    const patchCall = requestBackend.mock.calls.find(call => call[0] === 'PATCH')
    return { patchBody: patchCall && patchCall[2], saved }
  }

  it('提取全失败：请求体不得出现空串的昵称/头像/平台ID/粉丝（不反向覆写真源）', async () => {
    const { patchBody, saved } = await runUpdate(undefined)
    expect(patchBody).toBeTruthy()
    for (const key of ['account_name', 'avatar', 'platform_account_id', 'followers']) {
      expect(patchBody, '字段 ' + key + ' 未命中必须缺席（缺席=不修改）').not.toHaveProperty(key)
    }
    // 任何字段都不得以空串下发（空串在后端语义里是「清空」而不是「不改」）
    expect(Object.keys(patchBody).filter((k) => patchBody[k] === '')).toEqual([])
    // 登录态回写与资料字段互不夹带
    expect(patchBody.status).toBe('active')
    expect(typeof patchBody.last_validated).toBe('string')
    // 返回给调用方的对象沿用真源旧值，而不是空串
    expect(saved.account_name).toBe('老昵称')
    expect(saved.avatar).toBe('https://cdn/old.png')
  })

  it('提取命中：只下发与真源不同的字段', async () => {
    const { patchBody } = await runUpdate({ nickName: '新昵称', avatar: 'https://cdn/old.png', followers: 100 })
    expect(patchBody.account_name).toBe('新昵称')
    expect(patchBody).not.toHaveProperty('avatar')
    expect(patchBody).not.toHaveProperty('followers')
  })

  it('昵称命中时禁止用网页标题冒充昵称', async () => {
    const { patchBody } = await runUpdate({})
    expect(patchBody).not.toHaveProperty('account_name')
  })

  // auth-view-manager 的 source.name 取的就是 document.title，它既直接 PATCH 回真源的
  // name 字段，又是创建路径 profileForCreate 的昵称兜底 —— 兜底不过守卫等于给网页标题
  // 留一条绕过口（2026-09-26 生产库的「小红书创作服务平台」等即此路径产物）。
  it('更新路径：PATCH 的 name 同样不得是命中噪声的网页标题，回落平台名', async () => {
    const { patchBody } = await runUpdate({})
    // captured.name = '头条号 - 个人中心'（A - B 是页面标题指纹）
    expect(patchBody.name).toBe('今日头条')
  })

  // AGENTS.md「登录态固化契约覆盖全部『凭证落盘』同族路径」：三条入口必须过同一个守卫。
  // 本条在修前是沉默缺陷 —— 前两条 refreshProfile* 都过了 guardProfilePatchBySource，
  // 唯独重新登录这条直接 ...profilePatch，于是 manual 名被抓取脏值覆盖后 name_source
  // 仍留在 manual，之后再没有任何一道会过滤它（正好反转本 change 的核心不变量）。
  it('manual 命名不得被重新登录抓取到的昵称覆盖（第三条凭证落盘路径同守卫）', async () => {
    const { patchBody } = await runUpdate(
      { nickName: '重新登录抓到的昵称' },
      { account_name: '阿飞 - 自由职业', name_source: 'manual' },
    )
    expect(patchBody).not.toHaveProperty('account_name')
    // 保护住昵称的请求也不得顺带把来源降级
    expect(patchBody).not.toHaveProperty('name_source')
    // 登录态回写不受影响：守卫只管资料字段
    expect(patchBody.status).toBe('active')
  })

  it('现网名为 auto 时，重新登录抓到的昵称照常覆盖并同步来源为 auto', async () => {
    const { patchBody } = await runUpdate(
      { nickName: '重新登录抓到的昵称' },
      { account_name: '老自动昵称', name_source: 'auto' },
    )
    expect(patchBody.account_name).toBe('重新登录抓到的昵称')
    expect(patchBody.name_source).toBe('auto')
  })
})

describe('回填保护必须按 name_source 判定，不得再靠文本形态猜', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    global.__electronMock.app.getPath = function () { return 'C:/test-user-data' }
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function runHttp (current, nickname) {
    // 顺序是承重的：account-manager.js:13 在 require 期就把 fetchAccountInfoViaHttpApi
    // 解构成本地绑定，:704 调的是那个绑定而不是模块属性。所以必须先给（仍被 require.cache
    // 保留的）http-login-checker 装好 spy，再清掉 account-manager 缓存重新 require，
    // 解构才会拿到被替换后的引用。反过来写会静默调用真实实现并让断言假绿。
    const checker = require('./http-login-checker')
    vi.spyOn(checker, 'fetchAccountInfoViaHttpApi').mockResolvedValue({
      supported: true, nickname, followers: 777,
    })
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { ...CURRENT_ACCOUNT, ...current } })
      .mockResolvedValueOnce({ code: 0, data: {} })

    const ok = await accountManager.refreshProfileFromHttpApi('toutiao', 'acc-1', TOUTIAO_COOKIE)
    const patchCall = requestBackend.mock.calls.find(call => call[0] === 'PATCH')
    return { patchBody: patchCall && patchCall[2], ok }
  }

  // 这条是「猜」与「读意图」的唯一分水岭：旧实现见到非噪声的现网名就一律保护，
  // 于是机器抓来的旧昵称永远无法被更好的抓取结果更新；而它并不是用户手写的。
  it('现网名为 auto 且非噪声时，必须允许被抓取结果覆盖', async () => {
    const { patchBody } = await runHttp(
      { account_name: '老自动昵称', name_source: 'auto' },
      '新自动昵称',
    )
    expect(patchBody.account_name).toBe('新自动昵称')
  })

  it('现网名为 manual 时一律不得覆盖，即使抓取值完全合格', async () => {
    const { patchBody } = await runHttp(
      { account_name: '阿飞 - 自由职业', name_source: 'manual' },
      '平台返回的昵称',
    )
    expect(patchBody).not.toHaveProperty('account_name')
    // 粉丝等增量字段照常回填，不得因昵称受保护而一起丢掉
    expect(patchBody.followers).toBe(777)
  })

  it('manual 的行不得被回填顺带降级为 auto', async () => {
    const { patchBody } = await runHttp(
      { account_name: '阿飞 - 自由职业', name_source: 'manual' },
      '平台返回的昵称',
    )
    expect(patchBody).not.toHaveProperty('name_source')
  })

  it('实际写入昵称时必须同时把来源标为 auto', async () => {
    const { patchBody } = await runHttp(
      { account_name: '', name_source: 'auto' },
      '新自动昵称',
    )
    expect(patchBody.account_name).toBe('新自动昵称')
    expect(patchBody.name_source).toBe('auto')
  })

  it('抓取值为噪声时不得写入，也不得改动来源标记', async () => {
    const { patchBody } = await runHttp(
      { account_name: '', name_source: 'auto' },
      '小红书创作服务平台',
    )
    expect(patchBody).not.toHaveProperty('account_name')
    expect(patchBody).not.toHaveProperty('name_source')
  })
})

describe('saveCapturedAccount — 创建路径（POST）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    global.__electronMock.app.getPath = function () { return 'C:/test-user-data' }
  })
  afterEach(() => { vi.restoreAllMocks() })

  async function runCreate (accountInfo, sourceName = '头条号') {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { accountId: 'acc-new' } })
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    await accountManager.saveCapturedAccount('toutiao', {
      cookies: TOUTIAO_COOKIE, name: sourceName, accountInfo,
    })
    const posts = requestBackend.mock.calls.filter(call => call[0] === 'POST')
    return posts.length ? posts[posts.length - 1][2] : undefined
  }

  // 旧断言 `runCreate({}).account_name === '头条号'` 把网页标题写进 account_name 钉成了契约
  // （'头条号' 本身就是 KNOWN_PAGE_TITLES 成员）。昵称未命中时兜底必须过同一份噪声守卫。
  it('昵称命中写昵称；未命中时显示名兜底过守卫，命中噪声回落平台名', async () => {
    expect((await runCreate({ nickName: '真名', avatar: 'https://x/a.png' })).account_name).toBe('真名')
    const polluted = await runCreate({})
    expect(polluted.account_name).toBe('今日头条')
    expect(polluted.name).toBe('今日头条')
    // 干净的真实昵称形态仍作为显示名保留，不得一律降级成平台名
    const clean = await runCreate({}, '数字生命丘丘')
    expect(clean.account_name).toBe('数字生命丘丘')
    expect(clean.name).toBe('数字生命丘丘')
  })
})

describe('refreshProfileFromPage — 检测成功时回填存量账号（T9）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    global.__electronMock.app.getPath = function () { return 'C:/test-user-data' }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('DOM 提取命中 → 只 PATCH 差异资料字段，绝不夹带登录态字段', async () => {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
      .mockResolvedValueOnce({ code: 0, data: { ...CURRENT_ACCOUNT, account_name: '', avatar: '' } })
      .mockResolvedValueOnce({ code: 0, data: {} })
    const page = { evaluate: vi.fn(async (fn, arg) => ({ nickName: '回填昵称', avatar: 'https://cdn/new.png', __fn: typeof fn, __arg: arg })) }

    await expect(accountManager.refreshProfileFromPage(page, 'toutiao', 'acc-1')).resolves.toBe(true)
    const patchCall = requestBackend.mock.calls.find(call => call[0] === 'PATCH')
    // 实际写入昵称时必须同时声明来源，否则下一次回填又只能靠猜文本形态。
    expect(patchCall[2]).toEqual({ account_name: '回填昵称', name_source: 'auto', avatar: 'https://cdn/new.png' })
    expect(patchCall[2]).not.toHaveProperty('status')
    expect(patchCall[2]).not.toHaveProperty('last_validated')
  })

  it('提取失败/无差异/账号查不到 → 不发 PATCH、不抛错（资料增强不得影响登录态结论）', async () => {
    const accountManager = loadAccountManager()
    const requestBackend = vi.spyOn(require('../services/python-bridge'), 'requestBackend')
    await expect(accountManager.refreshProfileFromPage(
      { evaluate: vi.fn(async () => { throw new Error('page gone') }) }, 'toutiao', 'acc-1',
    )).resolves.toBe(false)
    await expect(accountManager.refreshProfileFromPage({ evaluate: vi.fn(async () => ({})) }, 'toutiao', 'acc-1'))
      .resolves.toBe(false)
    expect(requestBackend.mock.calls.filter(c => c[0] === 'PATCH')).toHaveLength(0)

    requestBackend
      .mockResolvedValueOnce({ code: 0, data: { ...CURRENT_ACCOUNT } })
      .mockResolvedValueOnce({ code: 0, data: {} })
    await expect(accountManager.refreshProfileFromPage(
      { evaluate: vi.fn(async () => ({ nickName: '老昵称', avatar: CURRENT_ACCOUNT.avatar })) }, 'toutiao', 'acc-1',
    )).resolves.toBe(false)
    expect(requestBackend.mock.calls.filter(c => c[0] === 'PATCH')).toHaveLength(0)
  })
})

describe('接线守卫：采集能力必须被真实入口调用（防装饰性链路第四次复发）', () => {
  const read = (p) => fs.readFileSync(require.resolve(p), 'utf8')

  it('account-manager：登录态判定为有效的两处 DOM 出口都回填资料', () => {
    const src = read(modulePath)
    const body = src.slice(src.indexOf('async function checkLoginStatus'), src.indexOf('async function extractAccountInfo'))
    const calls = body.match(/refreshProfileFromPage\(/g) || []
    expect(calls.length, 'checkLoginStatus 的 DOM valid 出口必须调用回填（发现 2 处）').toBeGreaterThanOrEqual(2)
    expect(src).toContain('module.exports')
    expect(src).toMatch(/refreshProfileFromPage[\s\S]{0,200}module.exports|module\.exports[\s\S]{0,4000}refreshProfileFromPage/)
  })

  it('三条真实登录入口都产出 accountInfo（不再是零调用的 account:add 死通道）', () => {
    // webview-manager 拆分后账号资料采集调用落在 credential-saver.js 子模块
    const webviewManagerSrc = read('../services/webview-manager/credential-saver')
    for (const p of ['../services/auth-view-manager', '../services/qrcode-login']) {
      const src = read(p)
      expect(src, p + ' 必须调用账号资料采集器').toMatch(/collectWithWebContents|extractAccountInfoFromWebContents/)
      expect(src, p + ' 必须把采集结果随凭证一起落库').toMatch(/accountInfo/)
    }
    expect(webviewManagerSrc, 'webview-manager 必须调用账号资料采集器').toMatch(/collectWithWebContents|extractAccountInfoFromWebContents/)
    expect(webviewManagerSrc, 'webview-manager 必须把采集结果随凭证一起落库').toMatch(/accountInfo/)
  })

  it('采集实现单一来源：主进程与三个服务不得各自复制一份 DOM 采集', () => {
    const src = read(modulePath)
    expect((src.match(/og:image/g) || []).length, 'DOM 采集只允许存在于 shared-utils').toBeLessThanOrEqual(0)
    expect((read('../services/auth-view-manager').match(/og:image/g) || []).length).toBe(0)
    expect((read('../services/webview-manager/credential-saver').match(/og:image/g) || []).length).toBe(0)
  })
})
