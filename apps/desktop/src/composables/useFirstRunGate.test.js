// @ts-check
/**
 * 首运判定合同（阶段 1.4 / audit-4）
 *
 * 核心不是"能跳向导"，而是**不该跳的时候绝不跳**：
 * `firstRunCheck()` 在桥接缺失时返回 `{code:0,data:{setupDone:false}}`，
 * 照字面判 `!setupDone` 就会把开发态与 IPC 抖动都推进向导。
 * 每条用例断言一个具体的不动理由。
 */
import { describe, it, expect, vi } from 'vitest'

import { evaluateFirstRunGate } from './useFirstRunGate'

function apiReturning (impl) {
  return { firstRunCheck: vi.fn(impl) }
}

describe('evaluateFirstRunGate', () => {
  it('桥接不存在时不动（浏览器开发态不得被推进向导）', async () => {
    expect(await evaluateFirstRunGate({ api: undefined })).toEqual({ navigate: false, reason: 'BRIDGE_UNAVAILABLE' })
    expect(await evaluateFirstRunGate({ api: {} })).toEqual({ navigate: false, reason: 'BRIDGE_UNAVAILABLE' })
  })

  it('读取抛错时不动，且不去猜"未引导"', async () => {
    const res = await evaluateFirstRunGate({ api: apiReturning(() => Promise.reject(new Error('ipc down'))) })
    expect(res).toEqual({ navigate: false, reason: 'READ_FAILED' })
  })

  it('非成功码 / 空 data 都不算证据，不得据此导航', async () => {
    const cases = [
      { code: 1, data: { setupDone: false } },
      { code: 0, data: null },
      { code: 0 },
      null,
    ]
    for (const payload of cases) {
      const res = await evaluateFirstRunGate({ api: apiReturning(() => Promise.resolve(payload)) })
      expect(res.navigate, `payload=${JSON.stringify(payload)} 不得导航`).toBe(false)
      expect(res.reason).toBe('NO_EVIDENCE')
    }
  })

  it('已引导过（setupDone=true）时不动', async () => {
    const res = await evaluateFirstRunGate({
      api: apiReturning(() => Promise.resolve({ code: 0, data: { setupDone: true } })),
    })
    expect(res).toEqual({ navigate: false, reason: 'ALREADY_DONE' })
  })

  it('setupDone 字段形状不认识时不动（不得把 undefined 当 false）', async () => {
    const res = await evaluateFirstRunGate({
      api: apiReturning(() => Promise.resolve({ code: 0, data: { } })),
    })
    expect(res).toEqual({ navigate: false, reason: 'UNKNOWN_SHAPE' })
  })

  it('确认未引导才导航；已在向导页时不重复跳（避免 replace 自环）', async () => {
    const api = apiReturning(() => Promise.resolve({ code: 0, data: { setupDone: false } }))
    expect(await evaluateFirstRunGate({ api, currentPath: '/' })).toEqual({ navigate: true, reason: 'PENDING' })
    expect(await evaluateFirstRunGate({ api, currentPath: '/publish' })).toEqual({ navigate: true, reason: 'PENDING' })
    expect(await evaluateFirstRunGate({ api, currentPath: '/first-run' }))
      .toEqual({ navigate: false, reason: 'ALREADY_ON_WIZARD' })
  })
})
