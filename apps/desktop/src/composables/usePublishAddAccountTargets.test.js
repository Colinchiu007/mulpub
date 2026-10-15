import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { usePublishAddAccountTargets } from './usePublishAddAccountTargets'

vi.mock('@/stores/tab', () => ({
  useTabStore: () => ({ createTab: vi.fn().mockResolvedValue('btab-1') }),
}))

vi.mock('@/features/publish/usePublishAddAccount', () => ({
  usePublishAddAccount: vi.fn(() => ({
    refreshing: ref(false),
    openLoginForPlatform: vi.fn().mockResolvedValue({ ok: true, tabId: 'btab-1' }),
    refreshAccounts: vi.fn().mockResolvedValue({ ok: true }),
  })),
}))

function makeDeps (overrides = {}) {
  return {
    accountStore: { ensureLoaded: vi.fn().mockResolvedValue(undefined) },
    platformStore: { getLabel: (id) => ({ zhihu: '知乎' }[id] || id) },
    isPublishing: () => false,
    notifyError: vi.fn(),
    notifyWarning: vi.fn(),
    ...overrides,
  }
}

describe('usePublishAddAccountTargets', () => {
  beforeEach(() => vi.clearAllMocks())

  it('把 tabStore / accountStore / platformStore 接到 usePublishAddAccount，并透出 v-bind 绑定的三个键', async () => {
    const { usePublishAddAccount } = await import('@/features/publish/usePublishAddAccount')
    const deps = makeDeps()
    const out = usePublishAddAccountTargets(deps)

    expect(usePublishAddAccount).toHaveBeenCalledTimes(1)
    const arg = usePublishAddAccount.mock.calls[0][0]
    expect(arg.accountStore).toBe(deps.accountStore)
    expect(arg.notifyError).toBe(deps.notifyError)
    expect(arg.notifyWarning).toBe(deps.notifyWarning)
    expect(arg.tabStore).toBeDefined()
    // 平台显示名解析：与 Accounts.vue 同口径（getLabel(id) || id）
    expect(arg.platformLabel('zhihu')).toBe('知乎')
    expect(arg.platformLabel('unknown-p')).toBe('unknown-p')

    // 键名是 v-bind 合同的一部分：驼峰 on* 形态才能命中 emit('add-account') / emit('refresh-accounts')
    expect(Object.keys(out.addAccountBindings).sort()).toEqual(['onAddAccount', 'onRefreshAccounts', 'refreshingAccounts'])
    expect(out.addAccountBindings.refreshingAccounts.value).toBe(false)
  })

  it('onAddAccount 在**调用时**读 isPublishing()，不是 setup 时捕获', async () => {
    const { usePublishAddAccount } = await import('@/features/publish/usePublishAddAccount')
    const openLogin = vi.fn().mockResolvedValue({ ok: true })
    usePublishAddAccount.mockReturnValueOnce({
      refreshing: ref(false),
      openLoginForPlatform: openLogin,
      refreshAccounts: vi.fn(),
    })

    let publishing = false
    const { addAccountBindings } = usePublishAddAccountTargets(makeDeps({ isPublishing: () => publishing }))
    await addAccountBindings.onAddAccount('zhihu')
    expect(openLogin).toHaveBeenCalledWith('zhihu', { busy: false })

    publishing = true
    await addAccountBindings.onAddAccount('zhihu')
    expect(openLogin).toHaveBeenLastCalledWith('zhihu', { busy: true })
  })

  it('onRefreshAccounts 触发刷新', async () => {
    const { usePublishAddAccount } = await import('@/features/publish/usePublishAddAccount')
    const refreshAccounts = vi.fn().mockResolvedValue({ ok: true })
    usePublishAddAccount.mockReturnValueOnce({
      refreshing: ref(false),
      openLoginForPlatform: vi.fn(),
      refreshAccounts,
    })

    const { addAccountBindings } = usePublishAddAccountTargets(makeDeps())
    await addAccountBindings.onRefreshAccounts()
    expect(refreshAccounts).toHaveBeenCalledTimes(1)
  })

  it('loadAccounts 走 ensureLoaded（原 Publish.vue 内联实现的等价搬迁）', async () => {
    const deps = makeDeps()
    const { loadAccounts } = usePublishAddAccountTargets(deps)

    await loadAccounts()

    expect(deps.accountStore.ensureLoaded).toHaveBeenCalledTimes(1)
  })
})
