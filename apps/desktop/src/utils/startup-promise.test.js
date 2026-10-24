/**
 * 首屏启动链的 promise 收口原语（UX 审计 1.2 家族 / Unhandled Rejection 收敛）
 *
 * 判据本体见 utils/startup-promise.js 的头注释。这里的每一条都必须"摘掉实现即红"，
 * 不得用源码字符串断言代替真跑。
 */
import { describe, it, expect, vi } from 'vitest'
import { terminateStartupPromise } from './startup-promise.js'

describe('terminateStartupPromise — 浮空 promise 收口原语', () => {
  it('拒绝的 promise 必须被就地吃掉并出声：warn 收到带标签与原因的一句话', async () => {
    const warn = vi.fn()
    terminateStartupPromise('account-groups', Promise.reject(new Error('bridge exploded')), warn)
    await new Promise((r) => setTimeout(r, 0))
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0][0])
    expect(msg).toContain('account-groups')
    expect(msg).toContain('bridge exploded')
  })

  it('成功的 promise 不得产生任何噪音（不许为了"看起来有日志"恒打一行）', async () => {
    const warn = vi.fn()
    terminateStartupPromise('accounts', Promise.resolve({ ok: true }), warn)
    await new Promise((r) => setTimeout(r, 0))
    expect(warn).not.toHaveBeenCalled()
  })

  it('原因不是 Error 时也要出声（字符串/undefined/对象都得留下一条痕迹）', async () => {
    const cases = [
      { reason: 'plain string reason', want: 'plain string reason' },
      { reason: undefined, want: 'undefined' },
      { reason: null, want: 'null' },
      { reason: { code: 42 }, want: '[object Object]' },
    ]
    for (const c of cases) {
      const warn = vi.fn()
      terminateStartupPromise('weird', Promise.reject(c.reason), warn)
      await new Promise((r) => setTimeout(r, 0))
      expect(warn, `原因类型=${typeof c.reason} 时必须出声`).toHaveBeenCalledTimes(1)
      // 「出声」的内容判据也必须钉住：只断"打过一次"对"日志里丢掉原因"这一格免疫
      // （反证 B4 实测：去掉原因后本文件其余四条红，唯独这条当时抓不到）。
      expect(String(warn.mock.calls[0][0]), `原因必须进日志（${typeof c.reason}）`).toContain(c.want)
    }
  })

  // 这一格是本原语存在的理由：调用点是 `f()` 直接丢弃返回值，
  // 只要有一条路径逃逸，进程级就会是 unhandledRejection（本仓已把它列为独立缺陷家族）。
  it('任何输入形态都不得把 rejection 留给进程（含 then 链里抛错、非 promise 入参）', async () => {
    const escapes = []
    const onUnhandled = (reason) => escapes.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      terminateStartupPromise('a', Promise.reject(new Error('boom-a')))
      terminateStartupPromise('b', Promise.reject('boom-b'))
      terminateStartupPromise('c', Promise.resolve().then(() => { throw new Error('boom-c') }))
      terminateStartupPromise('d', undefined)
      terminateStartupPromise('e', 'not a promise')
      // 同步求值的调用点：`f()` 里的 throw 发生在实参求值阶段，原语根本看不到它。
      // 所以原语必须接受 thunk —— 调用点写 () => f() 才能把同步抛错也纳入收口。
      terminateStartupPromise('f', () => { throw new Error('boom-f-sync') })
      // 让 Node 有机会把未处理的 rejection 报到进程级（至少两个宏任务）
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(escapes, `逃逸到进程级的 rejection：${escapes.map(String).join(' | ')}`).toEqual([])
  })

  it('thunk 形态的同步抛错必须被就地接住并出声（不得逃出调用方）', () => {
    const warn = vi.fn()
    expect(() => {
      terminateStartupPromise('g', () => { throw new Error('boom-g') }, warn)
    }).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('boom-g')
  })

  it('默认 warn 必须是真 console.warn —— 默认 noop 会让"生产接线不传 warn"这一格静默', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      terminateStartupPromise('default-sink', Promise.reject(new Error('boom-default')))
      await new Promise((r) => setTimeout(r, 0))
      expect(spy, '不传 warn 时必须仍然出声').toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain('boom-default')
    } finally {
      spy.mockRestore()
    }
  })
})
