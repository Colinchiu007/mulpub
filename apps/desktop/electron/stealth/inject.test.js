/**
 * inject.test.js — 主世界注入通道的契约锁
 *
 * 本文件的重点不是"注入函数返回了什么"，而是三条**极易静默失效**的时序/通道性质：
 *   ① 通道必须是 `executeJavaScriptInIsolatedWorld(0, …)`——worldId=0 即主世界。
 *      写成 `executeJavaScript` 或非 0 worldId，在隔离世界里"看起来也注入成功了"，
 *      但页面主世界读不到（这正是本仓存量缺陷的形态）。
 *   ② 必须在 **preload 顶层同步**发起。若包进 `.then()`/`setTimeout`，注入会晚于页面脚本，
 *      页面已经读过原生 `navigator` 了——功能上"做了"，效果上等于没做。
 *   ③ 任何失败都不得抛出：反检测是旁路，绝不能连带毁掉同文件里的真实功能（IPC 桥）。
 */
// 本仓 vitest 配置为 globals:true（describe/it/expect/vi 均为全局），CJS 测试文件
// 不得 `require('vitest')`。

const {
  DISABLE_VALUES,
  EVASION_IDS,
  resolveStealthEnabled,
  injectMainWorldEvasions,
  installMainWorldEvasions,
} = require('./inject')

/** 假 webFrame：记录每次调用，并允许脚本回读 */
function createFakeWebFrame ({ evalResult } = {}) {
  const calls = []
  return {
    calls,
    executeJavaScriptInIsolatedWorld: vi.fn((worldId, scripts, userGesture) => {
      calls.push({ worldId, scripts, userGesture })
      if (typeof evalResult === 'function') return Promise.resolve(evalResult(scripts[0] && scripts[0].code))
      return Promise.resolve(undefined)
    }),
  }
}

describe('stealth/inject — 开关解析', () => {
  it('未设环境变量时默认开启（定位是"还原正常浏览器环境"，关掉只会更糟）', () => {
    expect(resolveStealthEnabled({})).toEqual({ enabled: true, reason: 'default', rawValue: null })
    expect(resolveStealthEnabled({ MP_BROWSER_STEALTH: '  ' })).toEqual({ enabled: true, reason: 'default', rawValue: null })
  })

  it.each([...DISABLE_VALUES])('显式关闭值 %s 关闭反检测', (value) => {
    const result = resolveStealthEnabled({ MP_BROWSER_STEALTH: value })
    expect(result.enabled).toBe(false)
    expect(result.reason).toBe('explicit-disable')
  })

  it('大小写与空白归一后再判定（"OFF " 必须关闭，不得被当成未知值静默开启）', () => {
    expect(resolveStealthEnabled({ MP_BROWSER_STEALTH: 'OFF ' }).enabled).toBe(false)
  })

  it('未知值按开启处理并保留原值供日志（配置写错不得静默关掉反检测）', () => {
    const result = resolveStealthEnabled({ MP_BROWSER_STEALTH: 'maybe' })
    expect(result.enabled).toBe(true)
    expect(result.reason).toBe('explicit-enable')
    expect(result.rawValue).toBe('maybe')
  })
})

describe('stealth/inject — 注入通道契约', () => {
  it('走 worldId=0 的主世界通道，且带 userGesture', () => {
    const webFrame = createFakeWebFrame()
    const result = injectMainWorldEvasions({ webFrame, source: 'void 0' })
    expect(result.dispatched).toBe(true)
    expect(webFrame.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1)
    const { worldId, scripts, userGesture } = webFrame.calls[0]
    expect(worldId).toBe(0)
    expect(Array.isArray(scripts)).toBe(true)
    expect(typeof scripts[0].code).toBe('string')
    expect(userGesture).toBe(true)
  })

  it('未显式给源码时注入的是代码真源（含全部 evasion id），不是空串', () => {
    const webFrame = createFakeWebFrame()
    injectMainWorldEvasions({ webFrame })
    const code = webFrame.calls[0].scripts[0].code
    expect(code.length).toBeGreaterThan(500)
    for (const id of EVASION_IDS) expect(code).toContain(id)
  })

  it('同步发起：调用返回时注入命令已发出（包进 then/setTimeout 会晚于页面脚本，等于白做）', () => {
    const webFrame = createFakeWebFrame()
    injectMainWorldEvasions({ webFrame })
    // 未 await 任何东西即断言——这就是"顶层同步"的可观测含义
    expect(webFrame.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1)
  })

  it('webFrame 不可用时跳过并出声，不抛错（不阻断 preload 其余职责）', () => {
    const warn = vi.fn()
    const result = injectMainWorldEvasions({ webFrame: undefined, warn })
    expect(result.dispatched).toBe(false)
    expect(result.reason).toBe('webFrame-unavailable')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('webFrame')
  })

  it('宿主同步抛错时也不冒泡（preload 顶层不能有未捕获异常）', () => {
    const warn = vi.fn()
    const webFrame = {
      executeJavaScriptInIsolatedWorld: () => { throw new Error('boom') },
    }
    expect(() => injectMainWorldEvasions({ webFrame, warn })).not.toThrow()
    const result = injectMainWorldEvasions({ webFrame, warn })
    expect(result.dispatched).toBe(false)
    expect(result.reason).toContain('boom')
  })
})

describe('stealth/inject — 三态读回', () => {
  function makeFakeWithReadBack (markerJson) {
    return createFakeWebFrame({
      evalResult: (code) => (code.includes('JSON.stringify') ? markerJson : undefined),
    })
  }

  it('三态 ok：applied 全覆盖且 failed 为空时不告警', async () => {
    const marker = JSON.stringify({ state: 'ok', version: 'v', applied: [...EVASION_IDS], failed: [] })
    const webFrame = makeFakeWithReadBack(marker)
    const warn = vi.fn()
    const result = injectMainWorldEvasions({ webFrame, source: 'void 0', warn })
    await expect(result.readBack()).resolves.toMatchObject({ state: 'ok' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('三态 no-marker：源码根本没执行 ⇒ 告警（而不是静默认为已注入）', async () => {
    const webFrame = makeFakeWithReadBack(JSON.stringify({ state: 'preload-not-run' }))
    const warn = vi.fn()
    const result = injectMainWorldEvasions({ webFrame, source: 'void 0', warn })
    await result.readBack()
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toContain('preload-not-run')
  })

  it('三态 partial：有标记无 done ⇒ 告警并点名 state', async () => {
    const webFrame = makeFakeWithReadBack(JSON.stringify({ state: 'partial-first-line-failed' }))
    const warn = vi.fn()
    const result = injectMainWorldEvasions({ webFrame, source: 'void 0', warn })
    await result.readBack()
    expect(warn.mock.calls[0][0]).toContain('partial-first-line-failed')
  })

  it('done 但个别项失败 ⇒ 告警列出失败项（部分失败同样必须可见）', async () => {
    const webFrame = makeFakeWithReadBack(JSON.stringify({ state: 'ok', applied: ['chrome.keys'], failed: ['permissions.query:x'] }))
    const warn = vi.fn()
    const result = injectMainWorldEvasions({ webFrame, source: 'void 0', warn })
    await result.readBack()
    expect(warn.mock.calls[0][0]).toContain('permissions.query:x')
  })

  it('读回失败与"注入失败"措辞必须区分（前者只是观测不可用）', async () => {
    // 只在**读回**那次调用抛错：首次（注入）必须成功，否则走的是另一条分支
    let callCount = 0
    const webFrame = {
      executeJavaScriptInIsolatedWorld: () => {
        callCount += 1
        if (callCount === 1) return Promise.resolve(undefined)
        throw new Error('cdp down')
      },
    }
    const warn = vi.fn()
    const result = injectMainWorldEvasions({ webFrame, source: 'void 0', warn })
    expect(result.dispatched).toBe(true)
    const outcome = await result.readBack()
    expect(outcome.state).toBe('readback-failed')
    expect(warn.mock.calls[0][0]).toContain('未知')
  })

  it('注入命令本身同步抛错时，读回不得谎报"未注入"以外的结论', async () => {
    const webFrame = { executeJavaScriptInIsolatedWorld: () => { throw new Error('boom') } }
    const result = injectMainWorldEvasions({ webFrame, warn: vi.fn() })
    expect(result.dispatched).toBe(false)
    await expect(result.readBack()).resolves.toMatchObject({ state: 'preload-not-run' })
  })

  it('读回结果不可解析时不抛错（观测面不能反过来成为故障源）', async () => {
    const webFrame = makeFakeWithReadBack('not-json')
    const result = injectMainWorldEvasions({ webFrame, source: 'void 0', warn: vi.fn() })
    await expect(result.readBack()).resolves.toMatchObject({ state: 'unreadable' })
  })
})

describe('stealth/inject — installMainWorldEvasions 门面', () => {
  it('默认开启时注入并挂读回', () => {
    const webFrame = createFakeWebFrame()
    const result = installMainWorldEvasions({ webFrame, env: {} })
    expect(result).toMatchObject({ enabled: true, dispatched: true, reason: 'ok' })
    expect(webFrame.executeJavaScriptInIsolatedWorld).toHaveBeenCalled()
  })

  it('显式关闭时不注入，并出声告警（关闭会让风控误判率上升，不能静默）', () => {
    const webFrame = createFakeWebFrame()
    const warn = vi.fn()
    const result = installMainWorldEvasions({ webFrame, env: { MP_BROWSER_STEALTH: '0' }, warn })
    expect(result.enabled).toBe(false)
    expect(webFrame.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toContain('MP_BROWSER_STEALTH')
  })

  it('宿主不可用时门面自身不抛错（页面功能优先）', () => {
    expect(() => installMainWorldEvasions({ webFrame: null, env: {}, warn: vi.fn() })).not.toThrow()
  })
})
