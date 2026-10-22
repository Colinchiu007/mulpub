// @ts-check
/**
 * AccountManager 创建路径的资料兜底（fix-account-profile-fallback）
 *
 * 从 account-manager.test.js 拆出。机械动因是 CI 逐文件行数门禁 `TEST_LEDGER_GREW`：
 * 本组用例加进原文件后，该文件较登记值膨胀 353 行（容差 200），门禁要求
 * 「按被测模块/场景分文件，别再堆成一个」。按场景拆符合该指引——这里只承载
 * 「DOM 采集没拿到真昵称时用平台 API 补字段」这一组。
 *
  * 被测入口：`AccountManager.saveCapturedAccount` + `account-profile-refresh.fillProfileFromHttpApi`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const modulePath = './account-manager'

function loadAccountManager() {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

describe('account-manager — 创建路径资料兜底（HTTP API 补昵称/ID/粉丝）', () => {
  beforeEach(() => {
    global.__enableElectronMock()
    global.__resetElectronMock()
    global.__electronMock.app.getPath = function () { return '/tmp/test-electron-path' }
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── DOM 采集失败时的 HTTP API 兜底（fix-account-profile-fallback） ───────────
  // 现场（2026-10-21 用户实测）：头条号后台 profile_v4 是 SPA，AuthView 的
  // _scheduleAutoCompletion 在 URL 命中后 3000ms 就 _extractAuthData，而日志里
  // 「login page finished after 56295ms」说明页面渲染持续了 56 秒 —— 3 秒时昵称
  // 节点根本还没出现，collectWithWebContents 跑在空 DOM 上返回 {}，于是
  // account_name 回落 name（=平台名「今日头条」）、avatar 空、platform_account_id 空。
  // 而用户点「保存账号」时 attempt 已被 _settleLogin 消费并 close()，completeLogin
  // 静默返回 true —— 那一下根本没有重新采集。
  //
  // 兜底判据：profile.account_name 回落成了 name（即没有真昵称）且 avatar 为空
  // ⇒ DOM 采集实质失败 ⇒ 用已捕获的 Cookie 调平台创作者 API 补字段。
  const TOUTIAO_COOKIE = [{ name: 'sessionid', value: 'x', domain: '.toutiao.com' }]

  function stubHttpInfo (info) {
    const checker = require('./http-login-checker')
    if (info instanceof Error) {
      // 传 Error 实例 ⇒ 「调用时抛错」。刻意不用 Promise.reject(...)：那个 promise
      // 对象在参数求值时就已 reject，mockImplementation 只是延迟返回它，unhandled
      // rejection 照样发生（vitest 会报 false positive）。
      return vi.spyOn(checker, 'fetchAccountInfoViaHttpApi').mockRejectedValue(info)
    }
    return vi.spyOn(checker, 'fetchAccountInfoViaHttpApi').mockResolvedValue(info)
  }

  it('DOM 采集失败（昵称回落平台名 + 头像空）时用 HTTP API 补真实昵称/ID/粉丝', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'tt-2', platform: 'toutiao', name: '今日头条' },
    })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    const fetch = stubHttpInfo({
      supported: true,
      nickname: '观四方的第二个号',
      followers: 1234,
      platformAccountId: '1342958645023753',
    })

    // captured.name = 平台名（SPA 未渲染出昵称时的真实形态），accountInfo = {}
    await accountManager.saveCapturedAccount('toutiao', {
      cookies: TOUTIAO_COOKIE,
      name: '今日头条',
      accountInfo: {},
    })

    expect(fetch).toHaveBeenCalledWith('toutiao', TOUTIAO_COOKIE)
    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('POST', '/api/accounts', {
      platform: 'toutiao',
      name: '今日头条',
      account_name: '观四方的第二个号',
      platform_account_id: '1342958645023753',
      followers: 1234,
      avatar: '',
    })
  })

  it('DOM 采集成功时不调 HTTP API（不为已拿到的字段多发一次网络请求）', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'tt-1', platform: 'toutiao', name: '今日头条' },
    })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    const fetch = stubHttpInfo({ supported: true, nickname: 'HTTP 昵称' })

    await accountManager.saveCapturedAccount('toutiao', {
      cookies: TOUTIAO_COOKIE,
      name: '今日头条',
      accountInfo: { nickName: '观四方', avatar: 'https://example.com/a.png' },
    })

    expect(fetch).not.toHaveBeenCalled()
    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('POST', '/api/accounts', {
      platform: 'toutiao',
      name: '今日头条',
      account_name: '观四方',
      platform_account_id: '',
      followers: null,
      avatar: 'https://example.com/a.png',
    })
  })

  it('HTTP 兜底只补 DOM 没拿到的字段，不覆盖已命中的昵称', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'tt-3', platform: 'toutiao', name: '今日头条' },
    })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    // DOM 只拿到头像、没拿到昵称 ⇒ 触发兜底，但昵称不得被 HTTP 的空值覆盖
    stubHttpInfo({ supported: true, followers: 99, platformAccountId: 'uid-9' })

    await accountManager.saveCapturedAccount('toutiao', {
      cookies: TOUTIAO_COOKIE,
      name: '今日头条',
      accountInfo: { avatar: 'https://example.com/a.png' },
    })

    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('POST', '/api/accounts', {
      platform: 'toutiao',
      name: '今日头条',
      account_name: '今日头条',     // 兜底没拿到昵称 ⇒ 保持回落值，不被清空
      platform_account_id: 'uid-9', // 兜底补上
      followers: 99,                // 兜底补上
      avatar: 'https://example.com/a.png',
    })
  })

  it('判据不依赖两个模块的归一化细节：name 已 trim 过，trimText(name) 恒等于 name', async () => {
    // CCG 深度审查 i1：判据 `profile.account_name === name` 依赖 profileForCreate 的
    // trimText(fallbackName) 与 resolveCapturedDisplayName 的结果一致。逐行核实：
    //   resolveCapturedDisplayName 返回 `rawName.trim()` 或 `getPlatformName(platform)`；
    //   profileForCreate 用 `trimText(fallbackName)`，而 trimText(v) === v.trim()。
    // 两条路径都不改大小写/标点，只去首尾空白，且 name 传入前已 trim ⇒ 恒等。
    // 本用例把这个恒等关系钉住：喂带首尾空白的 document.title，name 与 account_name
    // 必须同值，兜底因此仍能触发（而不是因归一化差异漏调 = 假阴性）。
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'tt-5', platform: 'toutiao', name: '今日头条' },
    })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    const fetch = stubHttpInfo({ supported: true, nickname: '真实昵称' })

    // captured.name 带首尾空白（真实页面 title 常见形态）
    await accountManager.saveCapturedAccount('toutiao', {
      cookies: TOUTIAO_COOKIE,
      name: '  今日头条  ',
      accountInfo: {},
    })

    // 兜底必须仍然触发（证明 trimText(name) === name 这条恒等关系成立）
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('POST', '/api/accounts', {
      platform: 'toutiao',
      name: '今日头条',
      account_name: '真实昵称',
      platform_account_id: '',
      followers: null,
      avatar: '',
    })
  })

  it('DOM 采到的昵称恰等于平台名时按「无真昵称」处理（假阳性无害：只多发一次请求）', async () => {
    // 已知边界（CCG i1）：真昵称与平台名同字时判据会误判为未采到，触发一次 HTTP 兜底。
    // 后果仅为多发一个请求——HTTP 结果仍按「逐个判空补位」写入，且此时两者同值，
    // 不会把数据写坏。反向的假阴性（应兜底却漏调）不可能发生。
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'tt-6', platform: 'toutiao', name: '今日头条' },
    })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)
    const fetch = stubHttpInfo({ supported: true, nickname: '今日头条' })

    await accountManager.saveCapturedAccount('toutiao', {
      cookies: TOUTIAO_COOKIE,
      name: '今日头条',
      accountInfo: { nickName: '今日头条' },  // 真昵称恰好与平台名同字
    })

    // 确实多发了请求（假阳性），但写入值不变，数据正确
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(pythonBridge.requestBackend).toHaveBeenCalledWith('POST', '/api/accounts', {
      platform: 'toutiao',
      name: '今日头条',
      account_name: '今日头条',
      platform_account_id: '',
      followers: null,
      avatar: '',
    })
  })

  it('兜底是纯函数：不就地修改传入的 profile（CCG 深度审查 i2）', async () => {
    // 就地修改会让「调用方拿 filled.profile」依赖一个看不见的副作用；一旦 profileForCreate
    // 的结果被复用/缓存/并行传递，别名污染不可控。此处直接对模块级函数断言引用不变。
    const refresh = require('./account-profile-refresh')
    const checker = require('./http-login-checker')
    vi.spyOn(checker, 'fetchAccountInfoViaHttpApi').mockResolvedValue({
      supported: true, nickname: 'API 昵称', platformAccountId: 'uid-1', followers: 5,
    })
    const input = { account_name: '今日头条', platform_account_id: '', followers: null, avatar: '' }
    const snapshot = JSON.stringify(input)

    const out = await refresh.fillProfileFromHttpApi('toutiao', TOUTIAO_COOKIE, input, '今日头条')

    expect(out.used).toBe(true)
    expect(out.profile).not.toBe(input)                 // 返回新对象
    expect(JSON.stringify(input)).toBe(snapshot)        // 入参逐字节未变
    expect(out.profile.account_name).toBe('API 昵称')   // 新对象拿到补位值
    expect(out.profile.platform_account_id).toBe('uid-1')
    expect(out.profile.followers).toBe(5)
  })

  it('HTTP 兜底失败（supported:false / 抛错）时不阻断账号创建', async () => {
    const pythonBridge = require('../services/python-bridge')
    vi.spyOn(pythonBridge, 'requestBackend').mockResolvedValue({
      code: 0,
      data: { id: 'tt-4', platform: 'toutiao', name: '今日头条' },
    })
    const accountManager = loadAccountManager()
    vi.spyOn(accountManager.accountStateRestorer, 'saveAccountRecord').mockReturnValue(true)
    const saveCredential = vi.spyOn(accountManager.credentialStore, 'saveCredential').mockReturnValue(true)

    // supported:false（平台未注册 extract）⇒ 原样创建，字段全空但不报错
    stubHttpInfo({ supported: false })
    const ok = await accountManager.saveCapturedAccount('toutiao', {
      cookies: TOUTIAO_COOKIE,
      name: '今日头条',
      accountInfo: {},
    })
    expect(ok).toMatchObject({ id: 'tt-4' })

    // 抛错同样不阻断：资料是增强信息，绝不能把一次登录保存变成失败
    stubHttpInfo(new Error('network down'))
    const ok2 = await accountManager.saveCapturedAccount('toutiao', {
      cookies: TOUTIAO_COOKIE,
      name: '今日头条',
      accountInfo: {},
    })
    expect(ok2).toMatchObject({ id: 'tt-4' })
    expect(saveCredential).toHaveBeenCalledTimes(2)
  })
})
