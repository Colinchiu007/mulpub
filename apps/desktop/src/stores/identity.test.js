import { createPinia, setActivePinia } from 'pinia'

describe('identity store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.electronAPI = {
      identityGetState: vi.fn().mockResolvedValue({ code: 0, data: { status: 'signed_out', user: null } }),
      identitySignIn: vi.fn().mockResolvedValue({ code: 0, data: { status: 'authenticated', user: { sub: 'sub-1' } } }),
      identitySwitchAccount: vi.fn().mockResolvedValue({ code: 0, data: { status: 'authenticated', user: { sub: 'sub-2' } } }),
      identitySignOut: vi.fn().mockResolvedValue({ code: 0, data: { status: 'signed_out', user: null } }),
      onIdentityStateChanged: vi.fn(() => () => {}),
    }
  })

  it('账号切换使用独立 IPC，并替换当前用户与权益上下文', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: { status: 'authenticated', user: { sub: 'sub-1' }, entitlement: { plan: 'pro', features: ['cloud_publish'] } },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await store.load()

    await expect(store.switchAccount()).resolves.toBe(true)
    expect(window.electronAPI.identitySwitchAccount).toHaveBeenCalledTimes(1)
    expect(store.subject).toBe('sub-2')
    expect(store.entitlement).toBeNull()
  })

  it('signInOrSwitch: signIn 成功 → 直接返回，不触发切换账号', async () => {
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await expect(store.signInOrSwitch()).resolves.toBe(true)
    expect(window.electronAPI.identitySwitchAccount).not.toHaveBeenCalled()
  })

  it('signInOrSwitch: 被拒（残留旧会话）→ 自动降级 switchAccount 完成登录', async () => {
    window.electronAPI.identitySignIn.mockResolvedValue({
      code: -3,
      message: 'IDENTITY_ACCOUNT_SWITCH_REQUIRED',
      data: { status: 'error', user: null },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await expect(store.signInOrSwitch()).resolves.toBe(true)
    expect(window.electronAPI.identitySwitchAccount).toHaveBeenCalledTimes(1)
    expect(store.status).toBe('authenticated')
    expect(store.subject).toBe('sub-2')
  })

  it('signInOrSwitch: 其他登录错误 → 不降级，返回 false', async () => {
    window.electronAPI.identitySignIn.mockResolvedValue({
      code: -1,
      message: 'IDENTITY_API_UNAVAILABLE',
      data: { status: 'disabled', user: null },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await expect(store.signInOrSwitch()).resolves.toBe(false)
    expect(window.electronAPI.identitySwitchAccount).not.toHaveBeenCalled()
  })

  it('恢复、登录和退出状态，并保持错误可见', async () => {
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await store.load()
    expect(store.status).toBe('signed_out')
    await store.signIn()
    expect(store.isAuthenticated).toBe(true)
    expect(store.subject).toBe('sub-1')
    await store.signOut()
    expect(store.isAuthenticated).toBe(false)
  })

  it('API 不可用时回退到 disabled，不抛出渲染错误', async () => {
    window.electronAPI = null
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await expect(store.load()).resolves.toBe(false)
    expect(store.status).toBe('disabled')
  })

  it('保留主进程验证后的 entitlement 状态', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: {
        status: 'authenticated',
        user: { sub: 'sub-1' },
        entitlement: { plan: 'pro', features: ['cloud_publish'], source: 'online' },
      },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    await store.load()

    expect(store.entitlement).toEqual({ plan: 'pro', features: ['cloud_publish'], source: 'online' })
  })

  it('退出失败时保留当前身份并暴露错误状态', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: { status: 'authenticated', user: { sub: 'sub-1', name: '用户甲' } },
    })
    window.electronAPI.identitySignOut.mockResolvedValue({ code: -1, message: 'IDENTITY_SIGN_OUT_FAILED' })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await store.load()

    await expect(store.signOut()).resolves.toBe(false)
    expect(store.status).toBe('error')
    expect(store.subject).toBe('sub-1')
    expect(store.isAuthenticated).toBe(false)
    expect(store.error).toEqual({ code: 'IDENTITY_SIGN_OUT_FAILED', message: '' })
  })

  it.each(['error', 'signing_out'])('身份状态 %s 即使保留用户也不能通过已认证门控', async (state) => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: { status: state, user: { sub: 'sub-1', name: '用户甲' } },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    await store.load()

    expect(store.subject).toBe('sub-1')
    expect(store.isAuthenticated).toBe(false)
  })

  it('刷新 Token 期间保持已登录语义', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: { status: 'refreshing', user: { sub: 'sub-1', name: '用户甲' } },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    await store.load()

    expect(store.isAuthenticated).toBe(true)
    expect(store.displayName).toBe('用户甲')
  })

  it('身份 API 不可用时登录状态为 disabled', async () => {
    window.electronAPI.identitySignIn.mockResolvedValue({ code: -1, message: 'IDENTITY_API_UNAVAILABLE' })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    await expect(store.signIn()).resolves.toBe(false)
    expect(store.status).toBe('disabled')
  })

  it('身份服务未配置时登录和切换账号都保持 disabled', async () => {
    window.electronAPI.identitySignIn.mockResolvedValue({ code: -1, message: 'IDENTITY_NOT_CONFIGURED' })
    window.electronAPI.identitySwitchAccount.mockResolvedValue({ code: -1, message: 'IDENTITY_NOT_CONFIGURED' })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    await expect(store.signIn()).resolves.toBe(false)
    expect(store.status).toBe('disabled')
    await expect(store.switchAccount()).resolves.toBe(false)
    expect(store.status).toBe('disabled')
  })

  it('保留 expired 状态并要求重新登录', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: { status: 'expired', user: { sub: 'sub-1', name: '用户甲' } },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    await store.load()

    expect(store.status).toBe('expired')
    expect(store.isAuthenticated).toBe(false)
    expect(store.displayName).toBe('用户甲')
  })

  it('身份操作进行中拒绝并发命令，避免旧响应覆盖新状态', async () => {
    let finishSignIn
    const signInResponse = new Promise((resolve) => {
      finishSignIn = resolve
    })
    window.electronAPI.identitySignIn.mockReturnValue(signInResponse)
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    const first = store.signIn()
    const second = store.signIn()
    await Promise.resolve()
    finishSignIn({ code: 0, data: { status: 'authenticated', user: { sub: 'sub-1' } } })
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
    expect(window.electronAPI.identitySignIn).toHaveBeenCalledTimes(1)
  })

  it('归一化主进程错误时保留 cleanup 附加信息（登录失败 + 清理失败）', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: {
        status: 'error',
        user: null,
        error: {
          code: 'IDENTITY_SIGN_IN_FAILED',
          message: '',
          cleanup: { code: 'IDENTITY_SESSION_CLEAR_FAILED' },
        },
      },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    await store.load()

    expect(store.status).toBe('error')
    expect(store.error).toEqual({
      code: 'IDENTITY_SIGN_IN_FAILED',
      message: '',
      cleanup: { code: 'IDENTITY_SESSION_CLEAR_FAILED' },
    })
  })

  it('无 cleanup 字段时错误对象保持原形（不产生多余键）', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: { status: 'error', user: null, error: { code: 'IDENTITY_SIGN_IN_FAILED', message: '' } },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()

    await store.load()

    expect(store.error).toEqual({ code: 'IDENTITY_SIGN_IN_FAILED', message: '' })
    expect(store.error).not.toHaveProperty('cleanup')
  })

  it('dispose 会注销主进程状态监听器', async () => {
    const unsubscribe = vi.fn()
    window.electronAPI.onIdentityStateChanged.mockReturnValue(unsubscribe)
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await store.load()

    store.dispose()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('透传主进程验证后的 entitlement.quota', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: {
        status: 'authenticated',
        user: { sub: 'sub-1' },
        entitlement: { plan: 'pro', features: ['cloud_publish'], source: 'online', quota: { credits: 100, used: 20 } },
      },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await store.load()
    expect(store.entitlement.quota).toEqual({ credits: 100, used: 20 })
  })

  it('非法 quota 形状被丢弃，不污染 store', async () => {
    window.electronAPI.identityGetState.mockResolvedValue({
      code: 0,
      data: {
        status: 'authenticated',
        user: { sub: 'sub-1' },
        entitlement: { plan: 'free', features: [], quota: 'oops' },
      },
    })
    const { useIdentityStore } = await import('./identity')
    const store = useIdentityStore()
    await store.load()
    expect(store.entitlement.quota).toBeUndefined()
  })
})

