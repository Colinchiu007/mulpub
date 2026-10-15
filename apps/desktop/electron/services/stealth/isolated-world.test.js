// @ts-check
/**
 * isolated-world.test.js — F2 isolated world 执行通道契约（PRD §3.3，tasks 4.1-4.3 + 11.3 + 11.4）
 *
 * spike 实测支撑（2026-10-14，f2-spike.js / f2-spike2.js）：
 * - 不调 Page.enable 时 Page.getFrameTree / Page.createIsolatedWorld / Runtime.evaluate 均可用
 *   （故实现省略 PRD §3.3 原计划的 Page.enable 步骤——文档记偏差）
 * - Page.Frame 无 documentId 字段 → 双键第二键用 loaderId（跨导航更替、同文档 hash 跳转保持）
 * - 同 worldName 二次 createIsolatedWorld 幂等返回同 contextId；contextId 跨文档可被回收复用
 * - 导航后旧 contextId：Runtime.evaluate **命令级 reject**（Cannot find context with specified id）
 * - 页面代码抛错时 Runtime.evaluate **resolve 带 exceptionDetails**（不 reject）→ 必须显式检查
 *
 * 契约：
 * 1. 首次调用序列：attach → getFrameTree → createIsolatedWorld → 写 nonce → probe → expression → detach
 * 2. expression 参数必须 returnByValue:true + awaitPromise:true（对齐 executeJavaScript 语义）
 * 3. 双键缓存（frameId+loaderId）命中 → 不重复 createIsolatedWorld；每次执行仍探活（nonce probe）
 * 4. did-navigate / did-navigate-in-page 置 stale → 即使双键相同也强制重建
 * 5. loaderId 变化（跨导航）→ 重建
 * 6. probe nonce 不匹配（contextId 被回收错位）→ 重建
 * 7. expression 命令级 reject（context gone）→ 重建重试一次
 * 8. exceptionDetails → 抛错（禁吞成 undefined）→ 主世界回落 + warn
 * 9. attach 失败 / 超时 → 主世界 executeJavaScript 回落 + warn（禁静默）
 * 10. top-frame 范围：childFrames 忽略，createIsolatedWorld 只用 top frame id
 * 11. BINDING_ISOLATED_ALLOWLIST 空表 + assertIsolatedBindingAllowed 外部调用必抛
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 构造假 webContents：debugger mock + 事件 + 主世界 executeJavaScript
 * nonce 流向 mock：写入表达式提取 nonce 存档，probe 时回读（可注入错值模拟回收）
 */
function makeWc ({ sendImpl, attachImpl, execImpl, probeValue } = {}) {
  const sent = []
  const executed = []
  const events = {}
  let writtenNonce = null
  const wc = {
    debugger: {
      attach: vi.fn(attachImpl || (async () => {})),
      detach: vi.fn(async () => {}),
      isAttached: vi.fn(() => false),
      sendCommand: vi.fn(async (method, params) => {
        sent.push({ method, params })
        if (sendImpl) {
          const r = sendImpl(method, params, { sent, writtenNonce: () => writtenNonce })
          if (r !== undefined) return r
        }
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'F1', loaderId: 'L1' }, childFrames: [] } }
        }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 3 }
        if (method === 'Runtime.evaluate') {
          const expr = params.expression
          if (expr.includes('return window.__mpIsoNonce')) {
            return { result: { type: 'string', value: probeValue !== undefined ? probeValue : writtenNonce } }
          }
          const m = expr.match(/__mpIsoNonce=(".*?")/)
          if (m) {
            writtenNonce = JSON.parse(m[1])
            return { result: { type: 'string', value: null } }
          }
          return { result: { type: 'string', value: 'RET' } }
        }
        return {}
      }),
    },
    executeJavaScript: vi.fn(async (code) => {
      executed.push(code)
      if (execImpl) return execImpl(code)
      return 'MAIN'
    }),
    on: vi.fn((ev, cb) => {
      if (!events[ev]) events[ev] = []
      events[ev].push(cb)
    }),
    emit: (ev) => (events[ev] || []).forEach((cb) => cb()),
  }
  return { wc, sent, executed }
}

describe('isolated-world 执行通道（PRD §3.3 / tasks 4.1-4.3 + 11.3 + 11.4）', () => {
  let mod
  beforeEach(async () => {
    vi.resetModules()
    mod = await import('./isolated-world.js')
  })

  it('契约1+2：首次调用序列（attach→getFrameTree→create→写nonce→probe→expression→detach）且 expression 带 returnByValue+awaitPromise', async () => {
    const { wc, sent } = makeWc()
    const evaluate = mod.createIsolatedEvaluator(wc)
    const r = await evaluate('1+1')
    expect(r).toBe('RET')
    const methods = sent.map((s) => s.method)
    expect(methods).toEqual([
      'Page.getFrameTree',
      'Page.createIsolatedWorld',
      'Runtime.evaluate', // 写 nonce
      'Runtime.evaluate', // probe
      'Runtime.evaluate', // expression
    ])
    expect(wc.debugger.attach).toHaveBeenCalledWith('1.3')
    expect(wc.debugger.detach).toHaveBeenCalledTimes(1)
    const exprCall = sent.find((s) => s.method === 'Runtime.evaluate' && s.params.expression === '1+1')
    expect(exprCall).toBeTruthy()
    expect(exprCall.params.contextId).toBe(3)
    expect(exprCall.params.returnByValue).toBe(true)
    expect(exprCall.params.awaitPromise).toBe(true)
  })

  it('契约3：双键缓存命中 → 不重复 createIsolatedWorld，但每次执行仍 nonce 探活', async () => {
    const { wc, sent } = makeWc()
    const evaluate = mod.createIsolatedEvaluator(wc)
    await evaluate('a')
    const before = sent.filter((s) => s.method === 'Page.createIsolatedWorld').length
    await evaluate('b')
    const after = sent.filter((s) => s.method === 'Page.createIsolatedWorld').length
    expect(before).toBe(1)
    expect(after).toBe(1) // 缓存命中不重建
    // 仍有 getFrameTree（取双键）+ probe（每次执行前探活）
    expect(sent.filter((s) => s.method === 'Page.getFrameTree').length).toBe(2)
    expect(sent.filter((s) => s.params && s.params.expression && String(s.params.expression).includes('return window.__mpIsoNonce')).length).toBe(2)
  })

  it('契约4：did-navigate 置 stale → 即使双键相同也强制重建（RED 锁 events 层）', async () => {
    const { wc, sent } = makeWc()
    const evaluate = mod.createIsolatedEvaluator(wc)
    await evaluate('a')
    expect(wc.on).toHaveBeenCalledWith('did-navigate', expect.any(Function))
    expect(wc.on).toHaveBeenCalledWith('did-navigate-in-page', expect.any(Function))
    wc.emit('did-navigate')
    await evaluate('b')
    expect(sent.filter((s) => s.method === 'Page.createIsolatedWorld').length).toBe(2)
  })

  it('契约5：loaderId 变化（跨导航）→ 双键不符重建', async () => {
    let n = 0
    const { wc, sent } = makeWc({
      sendImpl: (method) => {
        if (method === 'Page.getFrameTree') {
          n += 1
          return { frameTree: { frame: { id: 'F1', loaderId: 'L' + n } } }
        }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 10 + n }
        return undefined
      },
    })
    const evaluate = mod.createIsolatedEvaluator(wc)
    await evaluate('a')
    await evaluate('b')
    expect(sent.filter((s) => s.method === 'Page.createIsolatedWorld').length).toBe(2)
  })

  it('契约6：probe nonce 不匹配（contextId 被回收错位）→ 重建后再表达式', async () => {
    // 首次 probe 返回错值 RECYCLED（模拟 contextId 被回收给别的文档）→ 重建 → 第二次 probe 返回最新写入 nonce → 通过
    let stored = null
    let probeCalls = 0
    const { wc, sent } = makeWc({
      sendImpl: (method, params) => {
        if (method === 'Runtime.evaluate') {
          const expr = params.expression
          const m = expr.match(/__mpIsoNonce=(".*?")/)
          if (m) {
            stored = JSON.parse(m[1])
            return { result: { type: 'string', value: null } }
          }
          if (expr.includes('return window.__mpIsoNonce')) {
            probeCalls += 1
            return { result: { type: 'string', value: probeCalls === 1 ? 'RECYCLED' : stored } }
          }
        }
        return undefined
      },
    })
    const evaluate = mod.createIsolatedEvaluator(wc)
    const r = await evaluate('x')
    expect(sent.filter((s) => s.method === 'Page.createIsolatedWorld').length).toBe(2)
    expect(r).toBe('RET')
  })

  it('契约7：expression 命令级 reject（Cannot find context）→ 清缓存重建重试一次成功', async () => {
    let evalCount = 0
    const { wc, sent } = makeWc({
      sendImpl: (method, params) => {
        if (method === 'Runtime.evaluate' && params.expression === 'boom') {
          evalCount += 1
          if (evalCount === 1) throw new Error('Cannot find context with specified id')
          return { result: { type: 'string', value: 'RETRY_OK' } }
        }
        return undefined
      },
    })
    const evaluate = mod.createIsolatedEvaluator(wc)
    const r = await evaluate('boom')
    expect(r).toBe('RETRY_OK')
    expect(wc.executeJavaScript).not.toHaveBeenCalled() // 重试成功不回落
    expect(sent.filter((s) => s.method === 'Page.createIsolatedWorld').length).toBe(2)
  })

  it('契约8：exceptionDetails → 抛错不吞 → 主世界回落 + warn（executeJavaScript 收到同 code）', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    const { wc, executed } = makeWc({
      sendImpl: (method, params) => {
        if (method === 'Runtime.evaluate' && params.expression === 'throwy') {
          return { result: {}, exceptionDetails: { exception: { description: 'Error: 页面代码炸了' } } }
        }
        return undefined
      },
    })
    const evaluate = mod.createIsolatedEvaluator(wc, { logger })
    const r = await evaluate('throwy')
    expect(r).toBe('MAIN')
    expect(executed).toEqual(['throwy'])
    expect(logger.warn).toHaveBeenCalled()
    expect(String(logger.warn.mock.calls[0][1])).toMatch(/isolated|回落|fallback/i)
  })

  it('契约9a：attach 失败 → 主世界回落 + warn（禁静默）', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    const { wc, executed } = makeWc({ attachImpl: async () => { throw new Error('Another debugger is already attached') } })
    // isAttached false 且 attach 抛 → 附加失败走回落
    const evaluate = mod.createIsolatedEvaluator(wc, { logger })
    const r = await evaluate('code-a')
    expect(r).toBe('MAIN')
    expect(executed).toEqual(['code-a'])
    expect(logger.warn).toHaveBeenCalled()
  })

  it('契约9b：CDP 链超时 → 主世界回落 + warn（防发布流挂死）', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() }
    const { wc, executed } = makeWc({
      sendImpl: (method) => {
        if (method === 'Page.getFrameTree') return new Promise(() => {}) // 永挂
        return undefined
      },
    })
    const evaluate = mod.createIsolatedEvaluator(wc, { logger, timeoutMs: 40 })
    const r = await evaluate('code-t')
    expect(r).toBe('MAIN')
    expect(executed).toEqual(['code-t'])
    expect(logger.warn).toHaveBeenCalled()
  })

  it('契约10：top-frame 范围——childFrames 被忽略，createIsolatedWorld 只用 top frame id', async () => {
    const { wc, sent } = makeWc({
      sendImpl: (method) => {
        if (method === 'Page.getFrameTree') {
          return {
            frameTree: {
              frame: { id: 'TOP', loaderId: 'L1' },
              childFrames: [{ frame: { id: 'CHILD-1', loaderId: 'LC' } }],
            },
          }
        }
        return undefined
      },
    })
    const evaluate = mod.createIsolatedEvaluator(wc)
    await evaluate('x')
    const create = sent.find((s) => s.method === 'Page.createIsolatedWorld')
    expect(create.params.frameId).toBe('TOP')
    expect(create.params.worldName).toBe(mod.ISOLATED_WORLD_NAME)
  })

  it('契约11：BINDING_ISOLATED_ALLOWLIST 空表 + allowlist 外调用必抛 ISOLATED_BINDING_NOT_ALLOWED', () => {
    expect(mod.BINDING_ISOLATED_ALLOWLIST).toEqual([])
    expect(() => mod.assertIsolatedBindingAllowed('exposeInMainWorld')).toThrow(/ISOLATED_BINDING_NOT_ALLOWED:exposeInMainWorld/)
    expect(() => mod.assertIsolatedBindingAllowed('ipcRenderer')).toThrow(/ISOLATED_BINDING_NOT_ALLOWED:ipcRenderer/)
  })
})
