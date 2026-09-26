// @ts-check
/**
 * RpaViewManager API-first 凭证兜底集成契约（D1 回归，kuaishou-w3-live-fix）
 *
 * 活体根因（live-verdict-20260926 D1）：rpa_vm 路由下 authData.cookies 为空
 * （快手登录态只在 Electron auth 分区），API-first 分支拼出空串 → adapter
 * fail-closed，九步链 0 步未跑。本套件钉：空凭证时经 auth-partition 兜底取串。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

__enableElectronMock()

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
__registerMock('./logger', log)

const supportsApi = vi.fn()
const shouldUseApi = vi.fn()
const publishViaApi = vi.fn()
__registerMock('@multi-publish/api-publish-engine', {
  supportsApi,
  publishViaApi,
  apiRouter: { shouldUseApi },
})

const collectAuthPartitionCookies = vi.fn()
__registerMock('./auth-partition', {
  collectAuthPartitionCookies,
  findAuthPartitionDir: vi.fn(),
})

let RpaViewManager

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  const module = await import('./rpa-view-manager.js')
  RpaViewManager = module.default || module
})

describe('RpaViewManager API-first 凭证分区兜底（D1）', () => {
  it('store cookie 为空时从 auth 分区取串并走 API（D1 主场景）', async () => {
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    collectAuthPartitionCookies.mockResolvedValue({
      cookieString: 'kuaishou.web.cp.api_st=sess; userId=u1', partition: 'account-a4505f45', count: 2,
    })
    publishViaApi.mockResolvedValue({ success: true, publishId: 'api-d1' })
    const manager = new RpaViewManager()

    await expect(manager.publish(
      'kuaishou',
      { title: 't', accountId: 'a4505f45' },
      { cookies: [] },
      1000,
    )).resolves.toMatchObject({ success: true })

    expect(collectAuthPartitionCookies).toHaveBeenCalledWith('kuaishou', 'a4505f45')
    expect(publishViaApi).toHaveBeenCalledTimes(1)
    expect(publishViaApi.mock.calls[0][2]).toBe('kuaishou.web.cp.api_st=sess; userId=u1')
  })

  it('store 与分区双空时保持空串 fail-closed 现状（降级 DOM）', async () => {
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    collectAuthPartitionCookies.mockResolvedValue({ cookieString: '', partition: null, count: 0 })
    publishViaApi.mockResolvedValue({ success: false, error: 'kuaishou: 账号信息缺失' })
    const manager = new RpaViewManager()
    const win = { destroy: vi.fn() }
    vi.spyOn(manager, '_createWindow').mockReturnValue(win)
    vi.spyOn(manager, '_publish_generic').mockResolvedValue({ success: true, platform: 'kuaishou' })

    await manager.publish('kuaishou', { accountId: 'a4505f45' }, { cookies: [] }, 1000)

    expect(publishViaApi).toHaveBeenCalledTimes(1)
    expect(publishViaApi.mock.calls[0][2]).toBe('')
  })

  it('store cookie 非空时不触发分区读取（douyin 等既由路径零变化）', async () => {
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    publishViaApi.mockResolvedValue({ success: true })
    const manager = new RpaViewManager()

    await manager.publish(
      'douyin',
      { accountId: 'acc-1' },
      { cookies: [{ name: 'sessionid', value: 'v' }] },
      1000,
    )

    expect(collectAuthPartitionCookies).not.toHaveBeenCalled()
    expect(publishViaApi.mock.calls[0][2]).toBe('sessionid=v')
  })

  it('authData.cookies 为字符串（既由形态）非空时同样不读分区', async () => {
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    publishViaApi.mockResolvedValue({ success: true })
    const manager = new RpaViewManager()

    await manager.publish('douyin', { accountId: 'acc-2' }, { cookies: 'a=1; b=2' }, 1000)

    expect(collectAuthPartitionCookies).not.toHaveBeenCalled()
    expect(publishViaApi.mock.calls[0][2]).toBe('a=1; b=2')
  })

  it('分区兜底抛错不得炸主链：空串继续交由 adapter fail-closed', async () => {
    shouldUseApi.mockReturnValue(true)
    supportsApi.mockReturnValue(true)
    collectAuthPartitionCookies.mockRejectedValue(new Error('partition boom'))
    publishViaApi.mockResolvedValue({ success: false, error: '账号信息缺失' })
    const manager = new RpaViewManager()
    const win = { destroy: vi.fn() }
    vi.spyOn(manager, '_createWindow').mockReturnValue(win)
    vi.spyOn(manager, '_publish_generic').mockResolvedValue({ success: true, platform: 'kuaishou' })

    // 主实现内部已兑错，mock 抛错是更严苛的防御面：publish 外层 catch 呷住后仍须降级 DOM 成功
    await expect(manager.publish('kuaishou', { accountId: 'a1' }, { cookies: [] }, 1000))
      .resolves.toMatchObject({ success: true, platform: 'kuaishou' })

    // API 分支被调用时 cookie 为 undefined/空均不得阻断降级；若压根未进入 API 分支也符合预期
    if (publishViaApi.mock.calls.length > 0) expect(publishViaApi.mock.calls[0][2]).toBeFalsy()
  })
})
