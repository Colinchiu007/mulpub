import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted：mock 工厂被提升，顶层变量需用 hoisted 定义
const mocks = vi.hoisted(() => ({
  // 真实桥的 ElMessage **既可调用也带四个命名方法**（`MessageFn` + `success/info/warning/error`，
  // d.ts:174-179）。夹具必须两态都给：只给命名方法会让"出口改用泛化调用"的实现
  // 在这里静默不计数，只给可调用会让"出口改用命名方法"的实现同样静默不计数（本仓「mock 要对齐语义不只对齐形状」）。
  elMessage: Object.assign(vi.fn(), {
    success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(),
  }),
  elMessageBox: { confirm: vi.fn() },
}))

// Mock element-plus 展示层
vi.mock('element-plus', () => ({
  ElMessage: mocks.elMessage,
  ElMessageBox: mocks.elMessageBox,
}))

// Mock electron-bridge（避免真实 IPC）
vi.mock('@/api/electron-bridge', () => ({
  invoke: vi.fn(),
}))

import { ElMessage, ElMessageBox } from 'element-plus'
import { invoke } from '@/api/electron-bridge'
import { useNotify } from './useNotify'
import { TOAST_MAX_DURATION_MS } from '@/utils/toast-policy'

// 出口形态是 `ElMessage[type]({ message, duration, grouping })`：档位由命名方法承载、策略由 options 承载。
// 观察面必须按"用户实际看到的四档"取数，而不是绑死某一种调用写法 —— 这样下一次换写法时，
// 红的是"没弹出来 / 档不对"，而不是"我没猜中你怎么写"。
const MSG_TYPES = ['success', 'info', 'warning', 'error']
const msgCalls = () => MSG_TYPES.flatMap((t) => ElMessage[t].mock.calls.map((c) => ({ type: t, opt: c[0] })))

describe('useNotify — 导出完整性（QM-3）', () => {
  it('导出全部方法', () => {
    const n = useNotify()
    expect(n).toHaveProperty('notify')
    expect(n).toHaveProperty('notifyError')
    expect(n).toHaveProperty('notifySuccess')
    expect(n).toHaveProperty('notifyWarning')
    expect(n).toHaveProperty('notifyInfo')
    expect(n).toHaveProperty('notifyConfirm')
  })
})

describe('useNotify — 通知展示', () => {
  let n

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ code: 0, data: true })
    n = useNotify()
  })

  it('notify 命中 key → ElMessage 展示 + 日志上报', async () => {
    const text = n.notify('story2video.quota_exceeded', { module: 'm', level: 'error' })
    expect(text.length).toBeGreaterThan(0)
    expect(msgCalls().length).toBe(1)
    expect(msgCalls()[0]).toEqual({ type: 'error', opt: expect.objectContaining({ message: text }) })
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith('notifyLog', expect.objectContaining({ messageKey: 'story2video.quota_exceeded' }))
  })

  it('level 映射到对应 ElMessage 方法', () => {
    n.notifySuccess('story2video.export_completed')
    n.notifyWarning('story2video.rate_limited')
    n.notifyInfo('story2video.path_copied')
    // 命名方法的调用序列就是"用户看到哪一档"的直接证据 ⇒ 断言档位序列（不是断言某一种写法）
    // 注：msgCalls() 按档位分组取数，不保留跨方法的绝对时间序（四个 mock 各记各的 calls）。
    // 所以这里逐档断言"哪个方法被调了一次"，而不是断言四者的先后——后者需要共享计数器，代价不值。
    expect(msgCalls().map((c) => c.type).sort()).toEqual(['info', 'success', 'warning'])
  })

  it('未命中 key + error 级 + fallback → ElMessage.error(fallback)', async () => {
    const text = n.notifyError('nonexistent.key', { fallback: '自定义错误' })
    expect(text).toBe('自定义错误')
    expect(msgCalls()[0].opt).toEqual(expect.objectContaining({
      message: '自定义错误', duration: 6000, grouping: true,
    }))
    await Promise.resolve()
    expect(invoke).toHaveBeenCalled()
  })

  it('未命中 key + 非 error 级 → 静默（不展示不抛错）', () => {
    const text = n.notify('nonexistent.key', { level: 'info' })
    expect(text).toBe('')
    expect(msgCalls().length).toBe(0)
  })

  it('options.message 直接传文案（绕过 messageKey 解析）', () => {
    const text = n.notifyWarning('nonexistent.key', { message: '动态拼接的警告文案' })
    expect(text).toBe('动态拼接的警告文案')
    expect(msgCalls()[0].opt).toEqual(expect.objectContaining({
      message: '动态拼接的警告文案', duration: 4000, grouping: true,
    }))
  })

  it('options.message 为 i18n 原始 key 时拦截，不直出（防泄漏）', () => {
    const text = n.notifyWarning('nonexistent.key', { message: 'accountsPage.loginExpiredHint' })
    expect(text).toBe('')
    expect(msgCalls().length).toBe(0)
  })
})


describe('useNotify — 时长与同源合并策略（阶段 2.7）', () => {
  let n
  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ code: 0, data: true })
    n = useNotify()
  })

  it('缺省 duration ⇒ 用该 level 的策略默认值，并且 grouping 默认开', () => {
    n.notifyError('story2video.quota_exceeded')
    const opt = msgCalls()[0].opt
    expect(opt.duration).toBe(6000)  // error 档
    expect(opt.grouping).toBe(true)  // 默认合并：审计现场的"刷屏"就是同一句话堆成一片
  })

  it('调用点显式 duration 被上限夹住，并出声（不得静默改语义）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    n.notify('story2video.export_completed', { level: 'success', duration: 999999 })
    expect(msgCalls()[0].opt.duration).toBe(TOAST_MAX_DURATION_MS)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duration rejected by policy'))
    warn.mockRestore()
  })

  it('0 是合法值（常驻），不得被当成非法去回落默认', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    n.notify('story2video.export_completed', { level: 'success', duration: 0 })
    expect(msgCalls()[0].opt.duration).toBe(0)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('非法 duration（字符串 / 负数 / NaN）回落该档默认并出声', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    n.notify('story2video.rate_limited', { level: 'warning', duration: -5 })
    n.notify('story2video.rate_limited', { level: 'warning', duration: 'soon' })
    expect(msgCalls().map((c) => c.opt.duration)).toEqual([4000, 4000])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('显式 grouping:false 才各算一次（保留"必须各弹一次"的场景）', () => {
    n.notify('story2video.export_completed', { level: 'success', grouping: false })
    expect(msgCalls()[0].opt.grouping).toBe(false)
  })
})

describe('useNotify — 确认弹窗', () => {
  let n

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ code: 0, data: true })
    n = useNotify()
  })

  it('notifyConfirm 确认 → 返回 true', async () => {
    ElMessageBox.confirm.mockResolvedValue('confirm')
    const ok = await n.notifyConfirm('story2video.project_delete_confirm')
    expect(ok).toBe(true)
    expect(ElMessageBox.confirm).toHaveBeenCalled()
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledWith('notifyLog', expect.objectContaining({ level: 'info' }))
  })

  it('notifyConfirm 取消 → 返回 false', async () => {
    ElMessageBox.confirm.mockRejectedValue(new Error('cancel'))
    const ok = await n.notifyConfirm('story2video.project_delete_confirm')
    expect(ok).toBe(false)
  })

  it('notifyConfirm 未命中 key → 返回 false 不弹窗', async () => {
    const ok = await n.notifyConfirm('nonexistent.key')
    expect(ok).toBe(false)
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })

  it('notifyConfirm options.message 直接传文案', async () => {
    ElMessageBox.confirm.mockResolvedValue('confirm')
    const ok = await n.notifyConfirm('nonexistent.key', { message: '动态确认文案', title: '需要登录' })
    expect(ok).toBe(true)
    expect(ElMessageBox.confirm).toHaveBeenCalledWith('动态确认文案', '需要登录', expect.any(Object))
  })

  it('notifyConfirm 的 message/title/按钮为 i18n 原始 key 时拦截（防泄漏）', async () => {
    ElMessageBox.confirm.mockResolvedValue('confirm')
    const ok = await n.notifyConfirm('nonexistent.key', {
      message: 'accountsPage.loginExpiredHint',
      title: 'accountsPage.confirmTitle',
      confirmButtonText: 'accountsPage.goLogin',
      cancelButtonText: 'accountsPage.cancel',
    })
    expect(ok).toBe(false)
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })
})

describe('useNotify — 档位词表由策略层单点持有（本批实测过的收窄）', () => {
  let n
  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ code: 0, data: true })
    n = useNotify()
  })

  it("level:'warn' 必须渲染成 warning 档，不得掉成 info", () => {
    n.notify('story2video.rate_limited', { module: 'm', level: 'warn' })
    expect(msgCalls().length).toBe(1)
    // 时长一并验证：warn 与 warning 共用 4000 那一档（两张表成对，见 toast-policy.test.js 的键集锁）
    expect(msgCalls()).toEqual([{ type: 'warning', opt: expect.objectContaining({ duration: 4000 }) }])
  })

  it('未知 level 不抛错，落 info 档（与 resolveToastType 的兜底口径一致）', () => {
    n.notify('story2video.rate_limited', { module: 'm', level: 'totally-unknown' })
    expect(msgCalls().length).toBe(1)
    expect(msgCalls()).toEqual([{ type: 'info', opt: expect.objectContaining({ duration: 3000 }) }])
  })
})
