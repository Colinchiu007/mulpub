// @ts-check
/**
 * notify-handler.test.js — notify:log IPC handler 回归
 *
 * 回归（2026-09-14，no-undef）：catch 分支曾引用未导入的 `EC`（实际导出为 `ERROR`），
 * 导致「写日志失败」这条兜底路径自身抛 ReferenceError，IPC 拿不到干净错误封包。
 */
import { describe, it, expect, vi } from 'vitest'

// vitest ESM interop：notify.js 是「函数 + 挂载属性」型 CJS 导出，命名空间下函数落在 default
const notifyModule = require('../ipc-handlers/notify')
const registerHandlers = typeof notifyModule === 'function' ? notifyModule : notifyModule.default
const { isKnownMessageKey } = notifyModule
const { ERROR } = require('../core/error-codes')

function setup (log) {
  const handlers = new Map()
  registerHandlers({ handle: (channel, fn) => handlers.set(channel, fn) }, { log })
  return handlers.get('notify:log')
}

describe('notify:log handler', () => {
  it('log.notify 抛异常时返回干净错误封包（不向 renderer 抛 ReferenceError）', () => {
    const handler = setup({
      info: vi.fn(),
      notify: vi.fn(() => { throw new Error('disk full') }),
    })
    const res = handler({}, { messageKey: 'userErrors.test', module: 'test', level: 'error' })
    expect(res).toEqual({ code: ERROR.REQUEST_ERROR, message: 'disk full' })
    expect(res.code).toBe(-1)
  })

  it('未知 messageKey 静默 drop', () => {
    const notify = vi.fn()
    const handler = setup({ info: vi.fn(), notify })
    const res = handler({}, { messageKey: 'unknown.key', module: 'test', level: 'info' })
    expect(res).toEqual({ code: 0, data: { dropped: true } })
    expect(notify).not.toHaveBeenCalled()
  })

  it('白名单 key 正常写日志', () => {
    const notify = vi.fn()
    const handler = setup({ info: vi.fn(), notify })
    const res = handler({}, { messageKey: 'userErrors.test', module: 'test', level: 'warn' })
    expect(res).toEqual({ code: 0, data: true })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('isKnownMessageKey 前缀匹配', () => {
    expect(isKnownMessageKey('story2video.composeFailed')).toBe(true)
    expect(isKnownMessageKey('')).toBe(false)
    expect(isKnownMessageKey(42)).toBe(false)
  })
})
