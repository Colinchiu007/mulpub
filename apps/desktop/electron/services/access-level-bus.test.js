import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  createAccessLevelInvalidator,
  bindAccessLevelInvalidator,
  emitAccessLevelInvalidated,
  _resetAccessLevelInvalidator,
} = require('./access-level-bus')
const { ACCESS_LEVEL_INVALIDATE_EVENT } = require('../core/access-level')

function makeWin ({ destroyed = false, sendImpl = null, noWebContents = false } = {}) {
  const sent = []
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: noWebContents ? null : {
      isDestroyed: () => false,
      send: sendImpl || ((channel, payload) => sent.push({ channel, payload })),
    },
  }
}

describe('访问级别失效广播总线（审计 P2·性能税）', () => {
  afterEach(() => _resetAccessLevelInvalidator())

  it('向所有存活窗口投递失效事件，并带上诊断原因', () => {
    const a = makeWin()
    const b = makeWin()
    const broadcast = createAccessLevelInvalidator({ getAllWindows: () => [a, b] })

    expect(broadcast('license-activate')).toBe(2)
    for (const win of [a, b]) {
      expect(win.sent).toHaveLength(1)
      expect(win.sent[0].channel).toBe(ACCESS_LEVEL_INVALIDATE_EVENT)
      expect(win.sent[0].payload).toEqual({ reason: 'license-activate' })
    }
  })

  it('缺省原因写 unspecified（留痕不允许出现 undefined 文案）', () => {
    const a = makeWin()
    createAccessLevelInvalidator({ getAllWindows: () => [a] })()
    expect(a.sent[0].payload).toEqual({ reason: 'unspecified' })
  })

  it('跳过已销毁窗口与无 webContents 的窗口', () => {
    const dead = makeWin({ destroyed: true })
    const noWc = makeWin({ noWebContents: true })
    const alive = makeWin()

    expect(createAccessLevelInvalidator({ getAllWindows: () => [dead, noWc, alive] })('x')).toBe(1)
    expect(dead.sent).toHaveLength(0)
    expect(alive.sent).toHaveLength(1)
  })

  it('单窗口投递失败不阻断其他窗口，且必须留痕（有意降级 ≠ 静默）', () => {
    const warn = vi.fn()
    const boom = makeWin({ sendImpl: () => { throw new Error('窗口正在销毁') } })
    const ok = makeWin()
    const broadcast = createAccessLevelInvalidator({ getAllWindows: () => [boom, ok] }, { warn })

    expect(() => broadcast('identity-state-changed')).not.toThrow()
    expect(broadcast('identity-state-changed')).toBe(1)
    expect(ok.sent).toHaveLength(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[access-level]'))
    expect(warn.mock.calls[0][0]).toContain('窗口正在销毁')
  })

  it('枚举窗口失败退化为「仅 TTL 兜底」：返回 0 且不抛', () => {
    const warn = vi.fn()
    const broadcast = createAccessLevelInvalidator(
      { getAllWindows: () => { throw new Error('app 未 ready') } },
      { warn },
    )
    expect(() => broadcast('license-deactivate')).not.toThrow()
    expect(broadcast('license-deactivate')).toBe(0)
    expect(warn).toHaveBeenCalled()
  })

  it('BrowserWindow 缺失（如单测/异常注入）时安全返回 0', () => {
    expect(createAccessLevelInvalidator(undefined)('x')).toBe(0)
    expect(createAccessLevelInvalidator({})('x')).toBe(0)
    expect(createAccessLevelInvalidator({ getAllWindows: () => null })('x')).toBe(0)
  })

  it('未绑定实现时 emit 返回 -1（调用方据此知道只剩 TTL 兜底）', () => {
    expect(emitAccessLevelInvalidated('license-activate')).toBe(-1)
  })

  it('绑定后 emit 透传原因并返回投递数；解绑后回到 -1', () => {
    const a = makeWin()
    const unbind = bindAccessLevelInvalidator(createAccessLevelInvalidator({ getAllWindows: () => [a] }))
    expect(emitAccessLevelInvalidated('license-activate-trial')).toBe(1)
    expect(a.sent[0].payload).toEqual({ reason: 'license-activate-trial' })
    unbind()
    expect(emitAccessLevelInvalidated('license-activate')).toBe(-1)
    expect(a.sent).toHaveLength(1)
  })

  it('绑定的实现抛异常时 emit 返回 -1 而不外泄（业务动作已生效，不得被推送失败打断）', () => {
    bindAccessLevelInvalidator(() => { throw new Error('广播炸了') })
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => emitAccessLevelInvalidated('x')).not.toThrow()
    expect(emitAccessLevelInvalidated('x')).toBe(-1)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('广播炸了'))
    spy.mockRestore()
  })

  it('绑定非函数直接报错（配置错误要早暴露，不允许静默退化）', () => {
    expect(() => bindAccessLevelInvalidator(null)).toThrow(TypeError)
    expect(() => bindAccessLevelInvalidator('nope')).toThrow(/需要一个函数/)
  })
})
