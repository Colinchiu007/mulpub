/**
 * pubfail-diagnose-hook.test.js — P0-8 挂钩点契约（proposal-v3 §2/§5.2）
 *
 * 锁定两条硬合同：
 *  1. governor 治理链出口 catch-rethrow：rate/quota 错误原样传播（identity/message/code 不变），
 *     诊断在后台 fire-and-forget 触发（覆盖 _pace/冷却/排队超时/retry429/额度 6 出口中的可构造者）；
 *  2. 诊断模块内部异常绝不改变 run() 的 reject 语义（永不抛合同在挂钩层的体现）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { ApiUsageGovernor } = require('./api-usage-governor')
const pubfail = require('./pubfail-diagnose')
const { ProviderError, ERROR_CODES } = require('./adapters/_base/provider-error')

beforeEach(() => {
  vi.useFakeTimers()
  pubfail.__resetDiagnoseState()
})

afterEach(() => {
  vi.useRealTimers()
  pubfail.__resetDiagnoseState()
})

function enableWithFakeSelfCheck () {
  const lines = []
  const selfCalls = []
  let resolveNext = null
  pubfail.setDiagnoseDeps({
    log: { notify: (m, k, meta) => lines.push({ m, k, meta }), info: () => {}, warn: () => {}, error: () => {} },
    app: { on: () => {} },
    runSelfCheck: (p) => { selfCalls.push(p); return new Promise((r) => { resolveNext = r }) },
  })
  pubfail.setEnabled(true)
  return { lines, selfCalls, finish: () => { const r = resolveNext; if (r) r({ engine: 'real-governor', metrics: { total_duration_ms: 100 }, assertions: [{ name: 'a', pass: true }], timeline: [] }) } }
}

describe('governor 治理链出口挂钩（单点覆盖多出口）', () => {
  it('_pace 频率上限错误：原样 rethrow + 诊断在后台触发', async () => {
    const s = enableWithFakeSelfCheck()
    const g = new ApiUsageGovernor({ maxPaceWaitMs: 10 })
    g.setLimits('p:llm:m', { maxConcurrent: 8, rpm: 1, cooldownMs: 1000, retry429: 3 })
    const p1 = g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => 'a')
    const p2 = g.run({ type: 'llm', providerId: 'p', model: 'm' }, async () => 'b')
    await p1
    await expect(p2).rejects.toThrow('当前请求频率已达上限')
    expect(s.selfCalls.length).toBe(1)
  })

  it('run() reject 的错误对象 identity 不变（code/message 零改动）', async () => {
    enableWithFakeSelfCheck()
    const g = new ApiUsageGovernor({})
    const injected = new ProviderError(ERROR_CODES.RATE_LIMITED, '上游 429', { providerId: 'x' })
    let settledErr = null
    const done = g.run({ type: 'llm', providerId: 'x', model: 'm' }, async () => { throw injected })
      .catch((e) => { settledErr = e })
    await vi.advanceTimersByTimeAsync(600000) // 走完 retry429 退避（fake timers）
    await done
    expect(settledErr).toBe(injected) // identity 严格相等：错误对象未被包装/复制
    expect(settledErr.code).toBe(ERROR_CODES.RATE_LIMITED)
    expect(settledErr.message).toBe('上游 429')
  })

  it('非限流错误：传播不变且诊断不触发', async () => {
    const s = enableWithFakeSelfCheck()
    const g = new ApiUsageGovernor({})
    const err = await g.run({ type: 'llm', providerId: 'y', model: 'm' }, async () => { throw new Error('参数非法') }).catch((e) => e)
    expect(err.message).toBe('参数非法')
    await vi.advanceTimersByTimeAsync(0)
    expect(s.selfCalls.length).toBe(0)
  })

  it('诊断自检完成后结论恰好一行（码来自触发时刻）', async () => {
    const s = enableWithFakeSelfCheck()
    const g = new ApiUsageGovernor({ maxPaceWaitMs: 10 })
    g.setLimits('z:llm:m', { maxConcurrent: 8, rpm: 1, cooldownMs: 1000, retry429: 3 })
    const p1 = g.run({ type: 'llm', providerId: 'z', model: 'm' }, async () => 'a')
    const p2 = g.run({ type: 'llm', providerId: 'z', model: 'm' }, async () => 'b')
    await p1
    await p2.catch(() => {})
    s.finish()
    await vi.advanceTimersByTimeAsync(0)
    const results = s.lines.filter((l) => l.k === 'publish.diagnose_result')
    expect(results.length).toBe(1)
    expect(results[0].meta.code).toMatch(/^D-[0-9a-z]{6}$/)
    expect(results[0].meta.source).toBe('governor')
  })
})

describe('batch-manager 挂钩（payload diagnoseCode 预留字段）', () => {
  // _emitProgress 合同经 batch-manager.test.js 的 electron mock 基建覆盖（见该文件扩展用例）；
  // 此处锁定纯函数适配层：命中限流 message → 返回挂码后的 payload 副本；不命中 → 原对象字段不变。
  it('pubfail.augmentBatchFailure：rate message 挂 diagnoseCode，其余字段不动', () => {
    enableWithFakeSelfCheck()
    const payload = { kind: 'task-complete', ok: false, message: '发布失败：429 Too Many Requests', timestamp: 1 }
    const out = pubfail.augmentBatchFailure(payload)
    expect(out.diagnoseCode).toMatch(/^D-[0-9a-z]{6}$/)
    expect(out.kind).toBe(payload.kind)
    expect(out.ok).toBe(false)
    expect(out.message).toBe(payload.message)
  })

  it('成功/非限流 payload 原样返回（无新字段）', () => {
    enableWithFakeSelfCheck()
    const okPayload = { kind: 'task-complete', ok: true, message: '发布成功', timestamp: 2 }
    expect(pubfail.augmentBatchFailure(okPayload)).toBe(okPayload)
    const otherErr = { kind: 'task-complete', ok: false, message: '账号未登录', timestamp: 3 }
    expect(pubfail.augmentBatchFailure(otherErr)).toBe(otherErr)
  })
})
