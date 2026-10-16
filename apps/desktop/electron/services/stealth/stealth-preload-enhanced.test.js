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
  // shim：'electron' → 假 webFrame；'../../stealth' → **真实的实测清单模块**
  // （2026-10-15 收敛：本 preload 不再 require vendored 的 evasions-bundle，改 require
  //  electron/stealth 这份按真机对照写的单一真源；esbuild 打包时它会被内联）
  const requireShim = (name) => {
    if (name === 'electron') return { webFrame: fakeWebFrame }
    if (name === '../../stealth') return require(path.join(__dirname, '..', '..', 'stealth'))
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

  it('注入内容 = 实测清单（4 项），且**不得**含 vendored 的有害项（2026-10-15 收敛锁）', () => {
    const { evalCalls } = loadPreload({})
    const all = evalCalls.flatMap((c) => c.scripts.map((s) => s.code)).join('\n')
    expect(all.length).toBeGreaterThan(1000)
    // ⚠️ 反向锁只看**实测清单那一片**（evalCalls[1]），不看第一片：第一片是 main 既有的
    // 「最小 navigator patch + start marker」，其 webdriver 赋值在本仓是**空操作**（两边本就都是
    // false），且被 stealth-preload-enhanced.test.js 首片契约锁着——不属本次收敛范围。
    const measured = evalCalls[1].scripts[0].code
    // ① 实测确认不一致的 4 项必须在场
    expect(measured).toMatch(/loadTimes/)          // chrome.keys：补 chrome.csi / chrome.app / chrome.loadTimes
    expect(measured).toMatch(/Google Chrome/)      // userAgentData.brands 补自家品牌
    expect(measured).toMatch(/Notification/)       // Notification.permission granted → default
    expect(measured).toMatch(/permissions/)        // permissions.query → prompt
    // ② 反向锁：vendored 那套"通用规避清单"里被实测证伪的项**一律不得出现**。
    //    这是本次收敛的核心断言——没有它，后人"顺手把 bundle 挂回去"不会被任何测试拦住。
    expect(measured, '不得伪造插件列表（真机对照：Electron 已是与 Chrome 逐字相同的 5 项）').not.toMatch(/Native Client/)
    expect(measured, '不得凭空造 chrome.runtime（真实 Chrome 普通网页上也是 undefined）').not.toMatch(/chrome\.runtime/)
    expect(measured, '不得强改 navigator.languages（会与请求头 Accept-Language 不一致）').not.toMatch(/defineProperty\(\s*navigator\s*,\s*['"]languages['"]/)
    expect(measured, '不得改 window.outerdimensions（Chrome 无头态 0/0，不可比）').not.toMatch(/outerdimensions/)
    expect(measured, '不得改 iframe.contentWindow（同机对照未见差异）').not.toMatch(/contentWindow/)
    expect(measured, '不得 patch navigator.webdriver（两边都是 false）').not.toMatch(/webdriver/)
  })

  it('单项容错下沉到实测源码内部：一条失败不影响其余条与 done 标记', () => {
    const { evalCalls } = loadPreload({})
    // 现在的注入片固定为 3 片（start / 实测清单 / done）——逐项容错在**源码内部**实现
    expect(evalCalls.length).toBe(3)
    const measured = evalCalls[1].scripts[0].code
    // 源码自带逐项 try/catch 与 applied/failed 记账（失败项可观测，不静默）
    expect(measured).toMatch(/try\s*\{/)
    expect(measured).toMatch(/catch/)
    expect(measured).toMatch(/applied/)
    expect(measured).toMatch(/failed/)
    const last = evalCalls[evalCalls.length - 1].scripts[0].code
    expect(last).toMatch(/__mpStealthInjDone/)
  })

  it('实测清单模块不可用时 fail-open：出声但不抛，start/done 仍成立', () => {
    const evalCalls = []
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'stealth-preload-enhanced.js'), 'utf8')
    const fn = new Function('require', 'module', 'exports', 'navigator', 'window', src)
    const shim = (name) => {
      if (name === 'electron') {
        return { webFrame: { executeJavaScriptInIsolatedWorld: (w, s) => { evalCalls.push({ w, s }); return Promise.resolve() } } }
      }
      if (name === '../../stealth') throw new Error('module not found')
      throw new Error(`unexpected require: ${name}`)
    }
    expect(() => fn(shim, { exports: {} }, {}, { webdriver: true }, {})).not.toThrow()
    // 反检测是旁路：源码取不到也不能连带毁掉发布流程（fail-open，与用户可见行为一致）
    expect(evalCalls.length).toBe(2)
    expect(consoleErr).toHaveBeenCalled()
  })

  it('通道整体不可用：不抛、console.error 出声（主进程 console-message 可观测）', () => {
    const { evalCalls, consoleErr } = loadPreload({ webFrameThrows: true })
    expect(evalCalls.length).toBe(0)
    expect(consoleErr).toHaveBeenCalled()
  })
})
