// @ts-check
/**
 * useExpiredAccountsBanner — 登录态真源与三态契约回归
 * （登录态口径统一修复 2026-09-22）
 *
 * 契约（与首页/账号页一致，全部由后端 accounts.json 单一真源驱动）：
 *  1. 横幅不得再自行 accountUpdate(status) 回写：那条链路写的是 Electron 本地
 *     SQLite（store:update-account），而读取端是后端 accounts.json —— 双写不同库
 *     是「一键检测结论不固化」的根因。持久化是主进程单一写者的职责。
 *  2. 三态：只有 valid === false 计入失效；valid === undefined（未确认）
 *     既不计失效、也不冒充已登录。
 *  3. 主进程回写失败（persisted.ok === false）必须通过 reportError 暴露，
 *     不得静默。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  onAuthCompleted: vi.fn(() => vi.fn()),
  onAccountStatusChanged: vi.fn(() => vi.fn()),
  accountBatchCheckLogin: vi.fn(),
  accountUpdate: vi.fn().mockResolvedValue({ code: 0 }),
}))

const reportErrorMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/publisher', () => api)
vi.mock('@/utils/report-error', () => ({ reportError: reportErrorMock }))

import { useExpiredAccountsBanner } from './useExpiredAccountsBanner'

function createAccountStore (accounts) {
  return { accounts, load: vi.fn().mockResolvedValue() }
}

describe('useExpiredAccountsBanner — 登录态真源与三态', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.accountUpdate.mockResolvedValue({ code: 0 })
  })

  it('只把 valid === false 的账号计入失效横幅', async () => {
    const store = createAccountStore([
      { id: 'a1', platform: 'toutiao' },
      { id: 'a2', platform: 'wechat_mp' },
      { id: 'a3', platform: 'douyin' },
    ])
    api.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        checkedAt: '2026-09-22T08:00:00.000Z',
        results: [
          { accountId: 'a1', valid: true, code: 'CHECK_LOGIN_SUCCESS', persisted: { ok: true, status: 'active' } },
          { accountId: 'a2', valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED', persisted: { ok: true, status: 'expired' } },
          { accountId: 'a3', valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED', persisted: { ok: true, status: 'expired' } },
        ],
      },
    })

    const banner = useExpiredAccountsBanner(store)
    await banner.refresh()

    expect(banner.expiredAccountCount.value).toBe(2)
    expect(banner.expiredAccounts.value.map(a => a.id)).toEqual(['a2', 'a3'])
    expect(banner.showExpiredBanner.value).toBe(true)
  })

  it('valid === undefined（未确认）不计入失效，也不冒充已登录', async () => {
    const store = createAccountStore([
      { id: 'tv', platform: 'tencent_video' },
      { id: 'bad', platform: 'toutiao' },
    ])
    api.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        checkedAt: '2026-09-22T08:00:00.000Z',
        results: [
          { accountId: 'tv', code: 'CHECK_LOGIN_INCONCLUSIVE', persisted: { ok: true, status: 'unverified' } },
          { accountId: 'bad', valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED', persisted: { ok: true, status: 'expired' } },
        ],
      },
    })

    const banner = useExpiredAccountsBanner(store)
    await banner.refresh()

    expect(banner.expiredAccountCount.value).toBe(1)
    expect(banner.expiredAccounts.value.map(a => a.id)).toEqual(['bad'])
  })

  it('渲染层不再回写 status —— 登录态由主进程唯一写者固化', async () => {
    const store = createAccountStore([{ id: 'a1', platform: 'toutiao' }])
    api.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        checkedAt: '2026-09-22T08:00:00.000Z',
        results: [{ accountId: 'a1', valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED', persisted: { ok: true, status: 'expired' } }],
      },
    })

    const banner = useExpiredAccountsBanner(store)
    await banner.refresh()

    expect(api.accountUpdate).not.toHaveBeenCalled()
  })

  it('主进程固化失败必须上报（不静默丢失持久化）', async () => {
    const store = createAccountStore([{ id: 'a1', platform: 'toutiao' }])
    api.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        checkedAt: '2026-09-22T08:00:00.000Z',
        results: [{ accountId: 'a1', valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED', persisted: { ok: false, reason: 'backend-error' } }],
      },
    })

    const banner = useExpiredAccountsBanner(store)
    await banner.refresh()

    expect(reportErrorMock).toHaveBeenCalledTimes(1)
    const [title, err] = reportErrorMock.mock.calls[0]
    expect(String(title)).toContain('1')
    expect(String(err && err.message)).toContain('a1:backend-error')
    // 横幅仍按检测结果更新，不被持久化失败阻断
    expect(banner.expiredAccountCount.value).toBe(1)
  })

  it('检测响应失败（code≠0）时不改动横幅', async () => {
    const store = createAccountStore([{ id: 'a1', platform: 'toutiao' }])
    api.accountBatchCheckLogin.mockResolvedValue({ code: -1, message: 'boom' })

    const banner = useExpiredAccountsBanner(store)
    await banner.refresh()

    expect(api.accountUpdate).not.toHaveBeenCalled()
    expect(banner.showExpiredBanner.value).toBe(false)
  })
})
