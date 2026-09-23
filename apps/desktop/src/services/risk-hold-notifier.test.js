// @vitest-environment node
/**
 * risk-hold-notifier — 纯 DI 逻辑单测（node 环境，无 DOM）。
 */
import { describe, it, expect, vi } from 'vitest'
import { createRiskHoldNotifier } from './risk-hold-notifier'

function fakeSubscribe () {
  const state = { handler: null, unsubscribed: 0 }
  const onRiskHold = (cb) => {
    state.handler = cb
    return () => { state.unsubscribed += 1 }
  }
  return { state, onRiskHold }
}

describe('createRiskHoldNotifier', () => {
  it('缺少 onRiskHold / notify 时抛 TypeError', () => {
    expect(() => createRiskHoldNotifier({ notify: vi.fn() })).toThrow(/onRiskHold/)
    expect(() => createRiskHoldNotifier({ onRiskHold: vi.fn() })).toThrow(/notify/)
  })

  it('start 订阅一次；每条事件规整后交 notify 并计入 list', () => {
    const { state, onRiskHold } = fakeSubscribe()
    const notify = vi.fn()
    const n = createRiskHoldNotifier({ onRiskHold, notify, now: () => 123 })
    n.start()
    expect(typeof state.handler).toBe('function')
    state.handler({ platform: 'wechat', accountId: 'a1', taskId: 't1', error: '触发风控' })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({ platform: 'wechat', accountId: 'a1', taskId: 't1', error: '触发风控', at: 123 })
    expect(n.list()).toHaveLength(1)
  })

  it('payload 缺字段时安全规整为空串 / null', () => {
    const { state, onRiskHold } = fakeSubscribe()
    const notify = vi.fn()
    const n = createRiskHoldNotifier({ onRiskHold, notify, now: () => 1 })
    n.start()
    state.handler({})
    expect(notify).toHaveBeenCalledWith({ platform: '', accountId: null, taskId: null, error: '', at: 1 })
  })

  it('start 幂等：重复调用不重复订阅', () => {
    const { state, onRiskHold } = fakeSubscribe()
    const spy = vi.fn(onRiskHold)
    const n = createRiskHoldNotifier({ onRiskHold: spy, notify: vi.fn() })
    n.start()
    n.start()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(typeof state.handler).toBe('function')
  })

  it('stop 取消订阅并清空状态，list 保留历史；stop 后可再 start', () => {
    const { state, onRiskHold } = fakeSubscribe()
    const n = createRiskHoldNotifier({ onRiskHold, notify: vi.fn() })
    n.start()
    state.handler({ platform: 'x' })
    n.stop()
    expect(state.unsubscribed).toBe(1)
    expect(n.list()).toHaveLength(1)
    n.start()
    expect(typeof state.handler).toBe('function')
  })

  it('近端列表按 maxRecent 截断，仅保留最近若干条', () => {
    const { state, onRiskHold } = fakeSubscribe()
    const n = createRiskHoldNotifier({ onRiskHold, notify: vi.fn(), now: () => 0, maxRecent: 2 })
    n.start()
    state.handler({ platform: 'a' })
    state.handler({ platform: 'b' })
    state.handler({ platform: 'c' })
    expect(n.list().map((e) => e.platform)).toEqual(['b', 'c'])
  })
})
