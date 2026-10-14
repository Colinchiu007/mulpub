// @ts-check
/**
 * stealth-preload-enhanced.test.js — 增强 preload 的契约锁
 *
 * 契约（PRD v1.1 §3.1 / 评审 F1，含 2026-10-14 实现期设计修正）：
 * 0. **marker 必须注入主世界**：preload 自身运行在隔离世界（spike E4b：其 window 属性
 *    主世界不可见），因此 start/done marker 与 navigator patch 必须**同路**经
 *    executeJavaScriptInIsolatedWorld(0) 注入主世界，主进程 executeJavaScript 才读得到
 * 1. **同步注入**：模块加载即注入（禁 setTimeout/异步——页面脚本不等）
 * 2. **首片优先**：第一片 = 最小 navigator patch + inj-start marker（patch 在 start 之前，
 *    patch 抛错时 start 降级为 'first-failed:<msg>'，仍可分辨「通道未通」与「首片失败」）
 * 3. **末片 done**：全部 evasions 后注入 done marker
 * 4. **单项容错**：单条 evasion 注入抛错不阻断其余（每条独立 try/catch）
 * 5. **通道失败的观测**：webFrame 整体不可用时 console.error（主进程 console-message 可收）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const MODULE = './stealth-preload-enhanced.js'

function loadPreload ({ webFrameThrows = false } = {}) {
  const evalCalls = []
  const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
  const fakeWebFrame = webFrameThrows
    ? { executeJavaScriptInIsolatedWorld: () => { throw new Error('boom') } }
    : {
        executeJavaScriptInIsolatedWorld: (worldId, scripts, userGesture) => {
          evalCalls.push({ worldId, scripts, userGesture })
          return Promise.resolve()
        },
      }
  const fs = require('node:fs')
  const path = require('node:path')
  // shim：'electron' → 假 webFrame；'./evasions-bundle.js' → 真实产物（相对于本模块目录解析）
  const requireShim = (name) => {
    if (name === 'electron') return { webFrame: fakeWebFrame }
    if (name === './evasions-bundle.js') {
      const bundlePath = path.join(__dirname, 'evasions-bundle.js')
      return require(bundlePath)
    }
    throw new Error(`unexpected require: ${name}`)
  }
  const navigatorObj = { webdriver: true }
  const windowObj = {}
  const module_ = { exports: {} }
  const src = fs.readFileSync(path.join(__dirname, 'stealth-preload-enhanced.js'), 'utf8')
  const fn = new Function('require', 'module', 'exports', 'navigator', 'window', src)
  fn(requireShim, module_, module_.exports, navigatorObj, windowObj)
  return { evalCalls, navigatorObj, windowObj, consoleErr }
}

describe('stealth-preload-enhanced 契约（PRD v1.1 §3.1）', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('模块加载即同步注入（禁延迟——页面脚本不等）', () => {
    const { evalCalls } = loadPreload({})
    expect(evalCalls.length).toBeGreaterThan(0)
  })

  it('全部注入目标是 main world（worldId 0）', () => {
    const { evalCalls } = loadPreload({})
    for (const c of evalCalls) {
      expect(c.worldId).toBe(0)
      for (const s of c.scripts) expect(typeof s.code).toBe('string')
    }
  })

  it('首片 = 最小 navigator patch + inj-start（patch 在 start 之前，主世界可读）', () => {
    const { evalCalls } = loadPreload({})
    const first = evalCalls[0].scripts[0].code
    expect(first).toMatch(/defineProperty/)
    expect(first).toMatch(/navigator/)
    expect(first).toMatch(/__mpStealthInjStart/)
    // patch 代码须出现在 start 赋值之前（顺序即优先级：先修指纹再记账）
    expect(first.indexOf('defineProperty')).toBeLessThan(first.indexOf('__mpStealthInjStart'))
  })

  it('末片 = inj-done（全部 evasions 之后）', () => {
    const { evalCalls } = loadPreload({})
    const last = evalCalls[evalCalls.length - 1].scripts[0].code
    expect(last).toMatch(/__mpStealthInjDone/)
  })

  it('注入内容含 evasions bundle 的最小集（逐条精确包含）', () => {
    const bundle = require(require('node:path').join(__dirname, 'evasions-bundle.js'))
    const { evalCalls } = loadPreload({})
    const all = evalCalls.flatMap((c) => c.scripts.map((s) => s.code)).join('\n')
    expect(all).toMatch(/webdriver/)
    expect(all.length).toBeGreaterThan(1000)
    // 逐条精确包含：bundle 里每项 code 都必须被注入（防「只注了首片」类部分注入）
    for (const [name, entry] of Object.entries(bundle.evasions)) {
      expect(all, `evasion 未注入: ${name}`).toContain(entry.code)
    }
  })

  it('单项容错：一条注入抛错不阻断后续条与 done', () => {
    const evalCalls = []
    let n = 0
    const flaky = {
      executeJavaScriptInIsolatedWorld: (worldId, scripts) => {
        evalCalls.push({ worldId, scripts })
        n++
        if (n === 2) throw new Error('transient') // 第二条挂
        return Promise.resolve()
      },
    }
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'stealth-preload-enhanced.js'), 'utf8')
    const fn = new Function('require', 'module', 'exports', 'navigator', 'window', src)
    const shim = (name) => {
      if (name === 'electron') return { webFrame: flaky }
      if (name === './evasions-bundle.js') return require(path.join(__dirname, 'evasions-bundle.js'))
      throw new Error(`unexpected require: ${name}`)
    }
    fn(shim, { exports: {} }, {}, { webdriver: true }, {})
    // 首片 + 7 evasions + done = 9 条调用都应发生（第二条抛错被吞）
    expect(evalCalls.length).toBe(9)
    const last = evalCalls[evalCalls.length - 1].scripts[0].code
    expect(last).toMatch(/__mpStealthInjDone/)
  })

  it('通道整体不可用：不抛、console.error 出声（主进程 console-message 可观测）', () => {
    const { evalCalls, consoleErr } = loadPreload({ webFrameThrows: true })
    expect(evalCalls.length).toBe(0)
    expect(consoleErr).toHaveBeenCalled()
  })
})
