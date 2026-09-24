// @vitest-environment node
/**
 * risk-suspended-tracker — 纯 DI 逻辑单测（node 环境，无 DOM）。
 * 覆盖：合规红线（默认不自动恢复）、权威清单整体替换、平台级/细粒度挂起判定、
 *       恢复成功/失败/取消三分支、start 初次 refresh、订阅生命周期幂等。
 */
import { createRiskSuspendedTracker } from './risk-suspended-tracker'

function fakeSubscribe() {
  const state = { cb: null }
  const onRiskSuspended = (cb) => { state.cb = cb; return () => { state.cb = null } }
  return { state, onRiskSuspended }
}

describe('createRiskSuspendedTracker', () => {
  it('缺少 onRiskSuspended / notify 时抛 TypeError', () => {
    expect(() => createRiskSuspendedTracker({ notify: vi.fn() })).toThrow(/onRiskSuspended/)
    expect(() => createRiskSuspendedTracker({ onRiskSuspended: vi.fn() })).toThrow(/notify/)
  })

  it('handle 整体替换清单并在非空时 notify suspended', () => {
    const { onRiskSuspended } = fakeSubscribe()
    const notify = vi.fn()
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify })
    const out = t.handle({ suspended: [{ platform: 'weixin', accountId: 'a1', reason: 'risk_blocked' }] })
    expect(out).toEqual([{ platform: 'weixin', accountId: 'a1', reason: 'risk_blocked', at: null }])
    expect(t.list()).toHaveLength(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'suspended', count: 1 }))
  })

  it('空清单广播替换后不触发 suspended 提示', () => {
    const { onRiskSuspended } = fakeSubscribe()
    const notify = vi.fn()
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify })
    t.handle({ suspended: [{ platform: 'weixin' }] })
    notify.mockClear()
    t.handle({ suspended: [] })
    expect(t.list()).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it('规整脏记录：过滤无 platform，accountId 缺省归一为 null', () => {
    const { onRiskSuspended } = fakeSubscribe()
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn() })
    const out = t.handle({ suspended: [{ platform: 'weixin' }, { accountId: 'x' }, null, 'str'] })
    expect(out).toEqual([{ platform: 'weixin', accountId: null, reason: '', at: null }])
  })

  it('isSuspended：平台级覆盖所有账号，细粒度仅命中该账号', () => {
    const { onRiskSuspended } = fakeSubscribe()
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn() })
    t.handle({ suspended: [{ platform: 'weixin' }] })
    expect(t.isSuspended('weixin', 'anyone')).toBe(true)
    expect(t.isSuspended('weixin')).toBe(true)
    expect(t.isSuspended('bilibili', 'x')).toBe(false)

    const t2 = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn() })
    t2.handle({ suspended: [{ platform: 'weixin', accountId: 'a1' }] })
    expect(t2.isSuspended('weixin', 'a1')).toBe(true)
    expect(t2.isSuspended('weixin', 'a2')).toBe(false)
  })

  it('resume：未经确认（confirm 默认 false）不自动恢复 —— 合规红线', async () => {
    const { onRiskSuspended } = fakeSubscribe()
    const resumeRisk = vi.fn()
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn(), resumeRisk })
    const res = await t.resume('weixin', 'a1')
    expect(res).toEqual({ ok: false, reason: 'cancelled' })
    expect(resumeRisk).not.toHaveBeenCalled()
  })

  it('resume：确认后调用 resumeRisk，成功回传最新清单并提示 resumed', async () => {
    const { onRiskSuspended } = fakeSubscribe()
    const notify = vi.fn()
    const resumeRisk = vi.fn(async () => ({ code: 0, data: { changed: true, suspended: [] } }))
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify, resumeRisk, confirm: async () => true })
    t.handle({ suspended: [{ platform: 'weixin', accountId: 'a1' }] })
    const res = await t.resume('weixin', 'a1')
    expect(resumeRisk).toHaveBeenCalledWith({ platform: 'weixin', accountId: 'a1' })
    expect(res).toEqual({ ok: true, changed: true })
    expect(t.list()).toEqual([])
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'resumed', platform: 'weixin', accountId: 'a1' }))
  })

  it('resume：主进程返回非零 code → resumeFailed，清单不变', async () => {
    const { onRiskSuspended } = fakeSubscribe()
    const notify = vi.fn()
    const resumeRisk = vi.fn(async () => ({ code: -2, message: '参数非法' }))
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify, resumeRisk, confirm: () => true })
    t.handle({ suspended: [{ platform: 'weixin', accountId: 'a1' }] })
    const res = await t.resume('weixin', 'a1')
    expect(res).toEqual({ ok: false, reason: 'error', message: '参数非法' })
    expect(t.list()).toHaveLength(1)
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'resumeFailed', message: '参数非法' }))
  })

  it('resume：resumeRisk 抛错 → resumeFailed 不崩溃', async () => {
    const { onRiskSuspended } = fakeSubscribe()
    const notify = vi.fn()
    const resumeRisk = vi.fn(async () => { throw new Error('ipc down') })
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify, resumeRisk, confirm: () => true })
    const res = await t.resume('weixin')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('error')
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'resumeFailed', message: 'ipc down' }))
  })

  it('resume：platform 非法直接 invalid，不弹确认', async () => {
    const { onRiskSuspended } = fakeSubscribe()
    const confirm = vi.fn()
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn(), confirm })
    expect(await t.resume('')).toEqual({ ok: false, reason: 'invalid' })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('confirm 抛错按未确认处理，不触碰 resumeRisk', async () => {
    const { onRiskSuspended } = fakeSubscribe()
    const resumeRisk = vi.fn()
    const t = createRiskSuspendedTracker({
      onRiskSuspended, notify: vi.fn(), resumeRisk,
      confirm: async () => { throw new Error('dialog fail') },
    })
    expect(await t.resume('weixin', 'a1')).toEqual({ ok: false, reason: 'cancelled' })
    expect(resumeRisk).not.toHaveBeenCalled()
  })

  it('start 初次 refresh 拉取权威清单（envelope {code,data}）', async () => {
    const { state, onRiskSuspended } = fakeSubscribe()
    const listSuspended = vi.fn(async () => ({ code: 0, data: [{ platform: 'bilibili', accountId: 'b1' }] }))
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn(), listSuspended })
    t.start()
    await Promise.resolve()
    expect(listSuspended).toHaveBeenCalledTimes(1)
    expect(t.isSuspended('bilibili', 'b1')).toBe(true)
    // 幂等：重复 start 不重复订阅
    t.start()
    expect(typeof state.cb).toBe('function')
  })

  it('refresh 拉取失败保留上次清单', async () => {
    const { onRiskSuspended } = fakeSubscribe()
    let fail = false
    const listSuspended = vi.fn(async () => { if (fail) throw new Error('net'); return { code: 0, data: [{ platform: 'weixin' }] } })
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn(), listSuspended })
    await t.refresh()
    expect(t.list()).toHaveLength(1)
    fail = true
    await t.refresh()
    expect(t.list()).toHaveLength(1)
  })

  it('stop 取消订阅后可重新 start', () => {
    const { state, onRiskSuspended } = fakeSubscribe()
    const t = createRiskSuspendedTracker({ onRiskSuspended, notify: vi.fn() })
    t.start()
    t.stop()
    expect(state.cb).toBeNull()
    t.start()
    expect(typeof state.cb).toBe('function')
  })
})
