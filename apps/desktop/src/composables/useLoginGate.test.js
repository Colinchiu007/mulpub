import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockNotifyWarning, mockNotifyConfirm } = vi.hoisted(() => ({
  mockNotifyWarning: vi.fn(),
  mockNotifyConfirm: vi.fn(async () => true),
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({
    notify: vi.fn(),
    notifyError: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: mockNotifyWarning,
    notifyInfo: vi.fn(),
    notifyConfirm: mockNotifyConfirm,
  }),
}))

let mockStore
vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => mockStore,
}))

const { useLoginGate } = await import('./useLoginGate')

function makeStore (overrides = {}) {
  return {
    status: 'signed_out',
    isAuthenticated: false,
    signIn: vi.fn(async () => true),
    signInOrSwitch: vi.fn(async () => true),
    ...overrides,
  }
}

describe('useLoginGate 主动操作登录门', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore = makeStore()
    mockNotifyConfirm.mockResolvedValue(true)
  })

  afterEach(() => {
    mockStore = null
  })

  it('已登录：直接放行，不弹确认、不调 signIn', async () => {
    mockStore = makeStore({ status: 'authenticated', isAuthenticated: true })
    const { ensureLogin } = useLoginGate()
    await expect(ensureLogin()).resolves.toBe(true)
    expect(mockNotifyConfirm).not.toHaveBeenCalled()
    expect(mockStore.signInOrSwitch).not.toHaveBeenCalled()
  })

  it('未登录：确认后调 signIn，登录成功且 authenticated → 放行', async () => {
    const { ensureLogin } = useLoginGate()
    const result = ensureLogin({ message: '发布功能需要登录后使用，是否立即登录？' })
    expect(mockNotifyConfirm).toHaveBeenCalledWith(
      'loginGate.defaultMessage',
      expect.objectContaining({
        message: '发布功能需要登录后使用，是否立即登录？',
        confirmButtonText: '立即登录',
      }),
    )
    mockStore.signInOrSwitch.mockImplementation(async () => {
      mockStore.status = 'authenticated'
      mockStore.isAuthenticated = true
      return true
    })
    await expect(result).resolves.toBe(true)
    expect(mockStore.signInOrSwitch).toHaveBeenCalledTimes(1)
  })

  it('未登录：确认框取消 → 拒绝且不调 signIn', async () => {
    mockNotifyConfirm.mockResolvedValue(false)
    const { ensureLogin } = useLoginGate()
    await expect(ensureLogin()).resolves.toBe(false)
    expect(mockStore.signInOrSwitch).not.toHaveBeenCalled()
  })

  it('未登录：signIn 失败 → 提示并拒绝', async () => {
    const { ensureLogin } = useLoginGate()
    mockStore.signInOrSwitch.mockResolvedValue(false)
    await expect(ensureLogin()).resolves.toBe(false)
    expect(mockNotifyWarning).toHaveBeenCalledWith('loginGate.loginIncomplete', expect.any(Object))
  })

  it('身份服务不可用（disabled）→ 提示并拒绝，不弹确认', async () => {
    mockStore = makeStore({ status: 'disabled' })
    const { ensureLogin } = useLoginGate()
    await expect(ensureLogin()).resolves.toBe(false)
    expect(mockNotifyConfirm).not.toHaveBeenCalled()
    expect(mockNotifyWarning).toHaveBeenCalledWith('loginGate.disabledMessage', expect.any(Object))
  })

  it('并发触发：signIn 只调一次（单例防重入）', async () => {
    const { ensureLogin } = useLoginGate()
    mockStore.signInOrSwitch.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 20))
      mockStore.status = 'authenticated'
      mockStore.isAuthenticated = true
      return true
    })
    const [a, b] = await Promise.all([ensureLogin(), ensureLogin()])
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(mockStore.signInOrSwitch).toHaveBeenCalledTimes(1)
  })

  it('requireLogin：登录成功后执行 action 并返回其结果', async () => {
    mockStore.signInOrSwitch.mockImplementation(async () => {
      mockStore.status = 'authenticated'
      mockStore.isAuthenticated = true
      return true
    })
    const { requireLogin } = useLoginGate()
    const action = vi.fn(async () => 'done')
    await expect(requireLogin(action)).resolves.toBe('done')
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('requireLogin：取消登录时不执行 action', async () => {
    mockNotifyConfirm.mockResolvedValue(false)
    const { requireLogin } = useLoginGate()
    const action = vi.fn(async () => 'done')
    await expect(requireLogin(action)).resolves.toBe(false)
    expect(action).not.toHaveBeenCalled()
  })
})
