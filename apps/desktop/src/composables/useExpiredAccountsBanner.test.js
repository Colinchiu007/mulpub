// @ts-check
/**
 * useExpiredAccountsBanner — 检测结果统一回写回归
 * （登录态检测口径统一修复 2026-09-22）
 *
 * 缺陷背景：首页「登录失效提醒」与账号页「一键检测」各自独立调用
 * accounts:batch-check-login，但账号页检测后会 accountUpdate 回写
 * status + last_validated，首页横幅只读不回写。两处检测时间不同、结果
 * 不持久化，用户看到"主页显示 5 个失效，账号页一键检测只有 2 个"的不一致。
 *
 * 契约：任何一处批量检测完成后，都必须以同一口径回写检测结果
 * （valid → status=active，invalid → status=expired，附 last_validated），
 * 使两处读取到同一份持久化状态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  onAuthCompleted: vi.fn(() => vi.fn()),
  onAccountStatusChanged: vi.fn(() => vi.fn()),
  accountBatchCheckLogin: vi.fn(),
  accountUpdate: vi.fn().mockResolvedValue({ code: 0 }),
}))

vi.mock('@/api/publisher', () => api)
vi.mock('@/utils/report-error', () => ({ reportError: vi.fn() }))

import { useExpiredAccountsBanner } from './useExpiredAccountsBanner'

function createAccountStore (accounts) {
  return { accounts, load: vi.fn().mockResolvedValue() }
}

describe('useExpiredAccountsBanner — 检测结果统一回写', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.accountUpdate.mockResolvedValue({ code: 0 })
  })

  it('批量检测完成后逐账号回写 status 与 last_validated（与账号页一键检测同口径）', async () => {
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
          { accountId: 'a1', valid: true, code: 'CHECK_LOGIN_SUCCESS' },
          { accountId: 'a2', valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' },
          { accountId: 'a3', valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' },
        ],
      },
    })

    const banner = useExpiredAccountsBanner(store)
    await banner.refresh()

    expect(banner.expiredAccountCount.value).toBe(2)
    expect(banner.showExpiredBanner.value).toBe(true)
    expect(api.accountUpdate).toHaveBeenCalledWith('a1', expect.objectContaining({
      status: 'active', last_validated: '2026-09-22T08:00:00.000Z',
    }))
    expect(api.accountUpdate).toHaveBeenCalledWith('a2', expect.objectContaining({
      status: 'expired', last_validated: '2026-09-22T08:00:00.000Z',
    }))
    expect(api.accountUpdate).toHaveBeenCalledWith('a3', expect.objectContaining({
      status: 'expired', last_validated: '2026-09-22T08:00:00.000Z',
    }))
  })

  it('检测响应失败（code≠0）时不回写，保留上次口径', async () => {
    const store = createAccountStore([{ id: 'a1', platform: 'toutiao' }])
    api.accountBatchCheckLogin.mockResolvedValue({ code: -1, message: 'boom' })

    const banner = useExpiredAccountsBanner(store)
    await banner.refresh()

    expect(api.accountUpdate).not.toHaveBeenCalled()
    expect(banner.showExpiredBanner.value).toBe(false)
  })

  it('单个账号回写失败不阻断横幅状态更新', async () => {
    const store = createAccountStore([
      { id: 'a1', platform: 'toutiao' },
      { id: 'a2', platform: 'douyin' },
    ])
    api.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        checkedAt: '2026-09-22T08:00:00.000Z',
        results: [
          { accountId: 'a1', valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' },
          { accountId: 'a2', valid: true, code: 'CHECK_LOGIN_SUCCESS' },
        ],
      },
    })
    api.accountUpdate.mockRejectedValueOnce(new Error('update failed'))

    const banner = useExpiredAccountsBanner(store)
    await banner.refresh()

    expect(banner.expiredAccountCount.value).toBe(1)
    expect(banner.expiredAccounts.value.map(a => a.id)).toEqual(['a1'])
  })
})
