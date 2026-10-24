// @ts-check
/**
 * auth-login-slot — 登录槽位模块自身的单测
 *
 * 为什么独立成文件（CCG 外部评审 i3）：槽位规则是「命名 / 豁免 / 清理 / 导航前清理」四处共用的
 * 单一真源，此前它的断言全部寄生在 `auth-partition-reclaim.test.js` 里（那儿测的是回收面），
 * 槽位模块自己的契约（命名、豁免、超时预算、返回契约、防御性断言）没有自己的落点。
 */
import { describe, expect, it, vi } from 'vitest'

const mod = require('./auth-login-slot.js')

describe('auth-login-slot — 命名与豁免', () => {
  it('槽位 accountId 与目录名按平台固定', () => {
    expect(mod.loginSlotAccountIdOf('toutiao')).toBe('auth-toutiao-slot')
    expect(mod.loginSlotPartitionNameOf('toutiao')).toBe('auth-auth-toutiao-slot')
    expect(mod.loginSlotPartitionNameOf('toutiao')).not.toBe(mod.loginSlotPartitionNameOf('kuaishou'))
  })

  it('平台非法时返回 null（不拼出脏目录名）', () => {
    expect(mod.loginSlotAccountIdOf(null)).toBe(null)
    expect(mod.loginSlotAccountIdOf('')).toBe(null)
    expect(mod.loginSlotPartitionNameOf(undefined)).toBe(null)
  })

  it('豁免判定只认「auth-auth- 前缀 + -slot 后缀」', () => {
    expect(mod.isLoginSlotPartitionName('auth-auth-toutiao-slot')).toBe(true)
    expect(mod.isLoginSlotPartitionName('auth-auth-toutiao-1790000000000')).toBe(false)
    expect(mod.isLoginSlotPartitionName('account-abc')).toBe(false)
    expect(mod.isLoginSlotPartitionName(null)).toBe(false)
  })
})

describe('auth-login-slot — 超时预算', () => {
  it('默认 1200ms；非法环境变量回落默认；合法值生效且封顶', () => {
    expect(mod.resolveSlotWipeTimeoutMs({}, undefined)).toBe(1200)
    expect(mod.resolveSlotWipeTimeoutMs({ MP_LOGIN_SLOT_WIPE_TIMEOUT_MS: 'abc' }, undefined)).toBe(1200)
    expect(mod.resolveSlotWipeTimeoutMs({ MP_LOGIN_SLOT_WIPE_TIMEOUT_MS: '-5' }, undefined)).toBe(1200)
    expect(mod.resolveSlotWipeTimeoutMs({ MP_LOGIN_SLOT_WIPE_TIMEOUT_MS: '1500' }, undefined)).toBe(1500)
    expect(mod.resolveSlotWipeTimeoutMs({ MP_LOGIN_SLOT_WIPE_TIMEOUT_MS: '999999' }, undefined)).toBe(60000)
    expect(mod.resolveSlotWipeTimeoutMs({}, 300)).toBe(300)
  })
})

describe('auth-login-slot — 清理的返回契约（CCG 外部评审 i1）', () => {
  it('resolve 成 true ⇒ wiped', async () => {
    expect(await mod.withSlotWipeTimeout(Promise.resolve(true), 1000)).toEqual({ wiped: true, reason: 'wiped' })
  })

  it('resolve 成 false ⇒ failed', async () => {
    expect(await mod.withSlotWipeTimeout(Promise.resolve(false), 1000)).toEqual({ wiped: false, reason: 'failed' })
  })

  it('resolve 成非布尔（契约被破坏）⇒ 抛错，不得被静默读成失败', async () => {
    // 这正是「有人把 .then(() => true) 那层去掉」的现场：clearStorageData resolve 的是 undefined。
    // 静默当失败 ⇒ 「清成功」被读成「清失败」，而上层又把失败当「不阻断」吞掉 ⇒ 隔离悄悄失效。
    // 故必须抛（上层 catch 成 WARN，生产不崩；测试当场红）。
    await expect(mod.withSlotWipeTimeout(Promise.resolve(undefined), 1000)).rejects.toThrow(/必须 resolve 成布尔值/)
  })

  it('超时 ⇒ timeout（不得当成清成功）', async () => {
    const r = await mod.withSlotWipeTimeout(new Promise(function () {}), 20)
    expect(r).toEqual({ wiped: false, reason: 'timeout' })
  })
})

describe('auth-login-slot — 开局清理', () => {
  it('清理成功 ⇒ 只清存储，不清 HTTP 缓存', async () => {
    const clearStorageData = vi.fn().mockResolvedValue(undefined)
    const clearCache = vi.fn().mockResolvedValue(undefined)
    const session = { clearStorageData, clearCache }
    const result = await mod.wipeLoginSlotCredentials(session, { notify: vi.fn() }, {})
    expect(result.wiped).toBe(true)
    expect(clearStorageData).toHaveBeenCalledTimes(1)
    // 缓存正是槽位存在的理由 —— 清掉等于每次登录都从零下载第三方资源
    expect(clearCache).not.toHaveBeenCalled()
  })

  it('清理失败 ⇒ 记 failed，不当成成功', async () => {
    const session = { clearStorageData: vi.fn().mockRejectedValue(new Error('boom')), clearCache: vi.fn() }
    const result = await mod.wipeLoginSlotCredentials(session, { notify: vi.fn() }, {})
    expect(result.wiped).toBe(false)
    expect(result.reason).toBe('failed')
  })

  it('宿主不支持 clearStorageData ⇒ unsupported（不抛）', async () => {
    const result = await mod.wipeLoginSlotCredentials({}, { notify: vi.fn() }, {})
    expect(result).toEqual({ wiped: false, reason: 'unsupported' })
  })
})

describe('auth-login-slot — 导航前清理（navigateAfterSlotCleanup）', () => {
  function fakeView () {
    return {
      setBounds: vi.fn(),
      webContents: { loadURL: vi.fn().mockResolvedValue(undefined), isDestroyed: () => false },
    }
  }

  it('清理完成后才导航，且顺序可断言', async () => {
    const order = []
    const view = fakeView()
    const session = {
      clearStorageData: vi.fn(async function () { order.push('wipe') }),
      clearCache: vi.fn(),
    }
    view.webContents.loadURL = vi.fn(function () { order.push('load'); return Promise.resolve() })
    mod.navigateAfterSlotCleanup({
      view,
      session,
      log: { warn: vi.fn(), notify: vi.fn() },
      isCurrent: () => true,
      navigate: () => { order.push('navigate'); view.webContents.loadURL('https://mp.toutiao.com/') }
    })
    await new Promise(function (r) { setTimeout(r, 10) })
    expect(order).toEqual(['wipe', 'navigate', 'load'])
  })

  it('会话已被替换 ⇒ 不导航', async () => {
    const view = fakeView()
    const session = { clearStorageData: vi.fn().mockResolvedValue(undefined), clearCache: vi.fn() }
    const navigate = vi.fn()
    mod.navigateAfterSlotCleanup({ view, session, log: { warn: vi.fn(), notify: vi.fn() }, isCurrent: () => false, navigate })
    await new Promise(function (r) { setTimeout(r, 10) })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('超时预算显式给出（不依赖进程环境变量）', async () => {
    const view = fakeView()
    const session = { clearStorageData: vi.fn(() => new Promise(function () {})), clearCache: vi.fn() }
    const navigate = vi.fn()
    mod.navigateAfterSlotCleanup({ view, session, log: { warn: vi.fn(), notify: vi.fn() }, isCurrent: () => true, navigate, timeoutMs: 30 })
    await new Promise(function (r) { setTimeout(r, 80) })
    // 超时后仍放行导航（清理是旁路）
    expect(navigate).toHaveBeenCalled()
  })
})
