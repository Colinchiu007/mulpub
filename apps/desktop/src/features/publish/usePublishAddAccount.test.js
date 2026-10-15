import { describe, expect, it, vi, beforeEach } from 'vitest'
import { usePublishAddAccount } from './usePublishAddAccount'

/**
 * usePublishAddAccount — 发布页「请先添加账号」空态出口的接线层。
 *
 * 本文件的锁与 PRD §八 的 L1-L6 一一对应。三条最容易被"顺手优化"掉的语义：
 *   1. 打开登录页必须带合法 accountId 占位值（否则主进程落临时分区，凭证无法保存）；
 *   2. cleanSession 必须显式为 true（否则 NavBar 不显示「保存账号」）；
 *   3. 刷新必须走 load() 而不是 ensureLoaded()（后者幂等，已加载即 no-op）。
 */
function makeDeps (overrides = {}) {
  return {
    tabStore: { createTab: vi.fn().mockResolvedValue('btab-1') },
    accountStore: { load: vi.fn().mockResolvedValue(undefined) },
    notifyError: vi.fn(),
    notifyWarning: vi.fn(),
    platformLabel: (id) => ({ zhihu: '知乎', wechat_mp: '微信公众号' }[id] || id),
    ...overrides,
  }
}

describe('usePublishAddAccount', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('openLoginForPlatform（L1/L2/L3）', () => {
    it('为已知平台打开登录页，并带持久分区所需的 accountId 占位值 + cleanSession', async () => {
      const deps = makeDeps()
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      const result = await openLoginForPlatform('zhihu')

      expect(result).toEqual({ ok: true, tabId: 'btab-1' })
      expect(deps.tabStore.createTab).toHaveBeenCalledTimes(1)
      expect(deps.tabStore.createTab).toHaveBeenCalledWith({
        url: 'https://www.zhihu.com/signin',
        platform: 'zhihu',
        accountId: 'mp-new-zhihu',
        cleanSession: true,
        title: '知乎登录页',
      })
    })

    it('不同平台的 accountId 占位值互不相同（复用同一平台则复用同一分区）', async () => {
      const deps = makeDeps()
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      await openLoginForPlatform('zhihu')
      await openLoginForPlatform('wechat_mp')

      const ids = deps.tabStore.createTab.mock.calls.map(c => c[0].accountId)
      expect(ids).toEqual(['mp-new-zhihu', 'mp-new-wechat_mp'])
    })

    it('标签标题与告警文案里的平台名走注入的 platformLabel（Accounts.vue:591-593 同口径）', async () => {
      const deps = makeDeps()
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      await openLoginForPlatform('zhihu')
      expect(deps.tabStore.createTab.mock.calls[0][0].title).toBe('知乎登录页')

      await openLoginForPlatform('no-such-platform')
      const warning = deps.notifyWarning.mock.calls[0]
      expect(warning[1].message).toContain('no-such-platform')
    })

    it('未注入 platformLabel 时回退平台 id（不因可选依赖缺失而崩）', async () => {
      const deps = makeDeps({ platformLabel: undefined })
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      const result = await openLoginForPlatform('zhihu')

      expect(result.ok).toBe(true)
      expect(deps.tabStore.createTab.mock.calls[0][0].title).toBe('zhihu登录页')
    })

    it('平台为空或非字符串：不打开标签，返回 unsupported（L1）', async () => {
      const deps = makeDeps()
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      expect(await openLoginForPlatform('')).toEqual({ ok: false, reason: 'unsupported' })
      expect(await openLoginForPlatform(null)).toEqual({ ok: false, reason: 'unsupported' })
      expect(await openLoginForPlatform(undefined)).toEqual({ ok: false, reason: 'unsupported' })
      expect(deps.tabStore.createTab).not.toHaveBeenCalled()
      expect(deps.notifyWarning).not.toHaveBeenCalled()
    })

    it('注册表里没有登录 URL 的平台：不打开标签，告警并返回 unsupported（L1）', async () => {
      const deps = makeDeps()
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      const result = await openLoginForPlatform('no-such-platform')

      expect(result).toEqual({ ok: false, reason: 'unsupported' })
      expect(deps.tabStore.createTab).not.toHaveBeenCalled()
      expect(deps.notifyWarning).toHaveBeenCalledTimes(1)
      expect(deps.notifyWarning.mock.calls[0][0]).toBe('publishPage.addAccount.loginUnsupported')
    })

    it('createTab 返回 null（IPC 失败）：报错且不外溢异常（L3）', async () => {
      const deps = makeDeps({ tabStore: { createTab: vi.fn().mockResolvedValue(null) } })
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      const result = await openLoginForPlatform('zhihu')

      expect(result).toEqual({ ok: false, reason: 'open-failed' })
      expect(deps.notifyError).toHaveBeenCalledTimes(1)
      expect(deps.notifyError.mock.calls[0][0]).toBe('publishPage.addAccount.openFailed')
    })

    it('createTab 抛错：被捕获并转为 open-failed（L3）', async () => {
      const deps = makeDeps({ tabStore: { createTab: vi.fn().mockRejectedValue(new Error('bridge down')) } })
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      await expect(openLoginForPlatform('zhihu')).resolves.toEqual({ ok: false, reason: 'open-failed' })
      expect(deps.notifyError).toHaveBeenCalledTimes(1)
    })

    it('发布进行中（busy）时不打开标签', async () => {
      const deps = makeDeps()
      const { openLoginForPlatform } = usePublishAddAccount(deps)

      const result = await openLoginForPlatform('zhihu', { busy: true })

      expect(result).toEqual({ ok: false, reason: 'busy' })
      expect(deps.tabStore.createTab).not.toHaveBeenCalled()
    })
  })

  describe('refreshAccounts（L4/L5/L6）', () => {
    it('刷新走 accountStore.load() 而不是 ensureLoaded()（L4，本刀核心坑）', async () => {
      const deps = makeDeps({
        accountStore: { load: vi.fn().mockResolvedValue(undefined), ensureLoaded: vi.fn() },
      })
      const { refreshAccounts } = usePublishAddAccount(deps)

      await refreshAccounts()

      expect(deps.accountStore.load).toHaveBeenCalledTimes(1)
      expect(deps.accountStore.ensureLoaded).not.toHaveBeenCalled()
    })

    it('刷新期间重复调用被忽略，load 只发生一次（L5）', async () => {
      let resolveLoad
      const deps = makeDeps({
        accountStore: { load: vi.fn(() => new Promise(resolve => { resolveLoad = resolve })) },
      })
      const { refreshAccounts, refreshing } = usePublishAddAccount(deps)

      const first = refreshAccounts()
      const second = refreshAccounts()
      expect(refreshing.value).toBe(true)

      resolveLoad()
      await Promise.all([first, second])

      expect(deps.accountStore.load).toHaveBeenCalledTimes(1)
      expect(refreshing.value).toBe(false)
    })

    it('load 成功后 refreshing 复位且不弹任何提示（界面变化即反馈）', async () => {
      const deps = makeDeps()
      const { refreshAccounts, refreshing } = usePublishAddAccount(deps)

      await refreshAccounts()

      expect(refreshing.value).toBe(false)
      expect(deps.notifyError).not.toHaveBeenCalled()
      expect(deps.notifyWarning).not.toHaveBeenCalled()
    })

    it('load 失败：报错、refreshing 复位、不外溢异常（L6）', async () => {
      const deps = makeDeps({ accountStore: { load: vi.fn().mockRejectedValue(new Error('offline')) } })
      const { refreshAccounts, refreshing } = usePublishAddAccount(deps)

      await expect(refreshAccounts()).resolves.toEqual({ ok: false, reason: 'load-failed' })
      expect(refreshing.value).toBe(false)
      expect(deps.notifyError).toHaveBeenCalledTimes(1)
      expect(deps.notifyError.mock.calls[0][0]).toBe('accountsPage.loadFailed')
    })

    it('刷新后仍无账号时不清空账号列表（空态原样保留，不假装"没有账号"）', async () => {
      const deps = makeDeps()
      const { refreshAccounts } = usePublishAddAccount(deps)

      await refreshAccounts()

      // 只允许调用 load()；不得自行写 accounts.value（那会把"刷新失败"显示成"没有账号"）
      expect(deps.accountStore.load).toHaveBeenCalledTimes(1)
      expect(Object.keys(deps.accountStore)).toEqual(['load'])
    })
  })
})
