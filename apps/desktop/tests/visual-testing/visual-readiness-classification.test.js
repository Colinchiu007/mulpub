// 就绪故障与像素故障必须分流（change: visual-readiness-gate，2026-10-11）
//
// 为什么存在：Gate 7 用 `pnpm.cmd run test:visual || views_exit=$?` 捕获退出码**却从不判定**，
// 于是 `film-engineering` 因选择器指向 Hub 的非默认标签节点（`.film-canvas-view`，
// 在 `v-if="isMounted('canvas')"` 后面）而每次都抛「就绪超时」，同一步结尾却照打
// `[GATE-7] All visual tests passed`（main push run 38104148726 / job 114366028731 现场）。
//
// 分类一律按 test-runner 抛出的**错误码**（`ERR_VISUAL_READY_SELECTOR_TIMEOUT` /
// `ERR_VISUAL_APP_READY_TIMEOUT`），不按消息文本 —— 文本是可改的，码才是合同。
//
// 本文件不放 views/ 目录：vitest.config.js 的 exclude 里有 'tests/visual-testing/views/**'，
// 放那儿等于写一条永不执行的测试（见 AGENTS.md「测试文件必须显式接进 CI」）。
//
// 运行：cd apps/desktop && pnpm exec vitest run tests/visual-testing/visual-readiness-classification.test.js

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const suite = require(path.join(here, 'views/all-views.visual.test.js'))
const rc = require(path.join(here, 'ready-classification.js'))

const READY_CODE = 'ERR_VISUAL_READY_SELECTOR_TIMEOUT'
const APP_READY_CODE = 'ERR_VISUAL_APP_READY_TIMEOUT'

function makeRunner(failures = {}, opt = {}) {
  const results = []
  return {
    results,
    launches: 0,
    closes: 0,
    async launch() { this.launches++ },
    async close() {
      this.closes++
      if (opt.closeThrows) throw new Error('close 炸了')
    },
    async aiVisionTest(name) {
      const f = failures[name]
      if (f) {
        results.push({ test: name, route: '/x', status: 'ERROR', error: f.message })
        throw f
      }
      results.push({ test: name, route: '/x', status: 'PASSED' })
    },
  }
}

function timeoutErr(name, code = READY_CODE) {
  const e = new Error(`视觉测试就绪超时（15000ms）：stage=业务选择器(.film-canvas-view)；视图=${name}`)
  e.name = 'TimeoutError'
  e.code = code
  return e
}

function view(name) { return { name, route: '/' + name, checks: [{ name: '标题', selector: '.x' }] } }

describe('视图套件的就绪故障分类', () => {
  it('就绪超时 ⇒ code=ERR_VISUAL_NOT_READY，并逐个点名从未渲染出来的视图', async () => {
    const runner = makeRunner({ 'film-engineering': timeoutErr('film-engineering') })
    let err = null
    try {
      await suite.runViewSuite([view('film-engineering'), view('accounts')], { runner })
    } catch (e) { err = e }
    expect(err, '必须抛错').toBeTruthy()
    expect(err.code).toBe('ERR_VISUAL_NOT_READY')
    expect(err.message).toMatch(/从未渲染出来/)
    expect(err.message).toContain('film-engineering')
    expect(err.neverReady.map(x => x.test)).toEqual(['film-engineering'])
  })

  it('像素/校验类失败不得被升级成就绪故障（否则会把抖动变成全仓阻断）', async () => {
    const pixel = new Error('像素差异 3.2% 超过阈值')
    pixel.code = 'ERR_VISUAL_PIXEL_DIFF'
    const runner = makeRunner({ accounts: pixel })
    let err = null
    try { await suite.runViewSuite([view('accounts')], { runner }) } catch (e) { err = e }
    expect(err.code).toBe('ERR_VISUAL_SUITE_FAILED', '不是就绪问题就必须保持原码')
    expect(err.neverReady || []).toEqual([])
  })

  it('两类同时出现时按就绪归类，但两类计数都可见', async () => {
    const pixel = new Error('像素差异')
    const runner = makeRunner({
      a: timeoutErr('a', APP_READY_CODE),
      b: pixel,
    })
    let err = null
    try { await suite.runViewSuite([view('a'), view('b')], { runner }) } catch (e) { err = e }
    expect(err.code).toBe('ERR_VISUAL_NOT_READY')
    expect(err.neverReady.map(x => x.test)).toEqual(['a'])
    expect(err.otherFailures.map(x => x.test)).toEqual(['b'])
    expect(err.message).toMatch(/另有 1 个/)
  })

  it('全通过 ⇒ 不抛错，返回 total/passed', async () => {
    const runner = makeRunner({})
    const r = await suite.runViewSuite([view('a'), view('b')], { runner })
    expect(r).toMatchObject({ total: 2, passed: 2 })
    expect(runner.closes).toBe(1, 'close 必须成对执行')
  })

  it('close() 自身抛错时原样上抛，不得被误分类为就绪故障', async () => {
    const runner = makeRunner({}, { closeThrows: true })
    let err = null
    try { await suite.runViewSuite([view('a')], { runner }) } catch (e) { err = e }
    expect(err.message).toBe('close 炸了')
    expect(err.code).toBeUndefined()
  })

  it('假 runner 已有 FAILED 记录时不重复追加（保持既有 alreadyRecorded 语义）', async () => {
    const runner = makeRunner({ a: timeoutErr('a') })
    runner.results = [{ test: 'a', route: '/a', status: 'FAILED', error: 'x' }]
    // aiVisionTest 已 push 过 → alreadyRecorded 命中，长度不得变成 2
    try { await suite.runViewSuite([view('a')], { runner }) } catch (e) { /* expected */ }
    expect(runner.results.filter(r => r.test === 'a')).toHaveLength(1)
  })
})

describe('退出码映射与注册表真值', () => {
  function exitCodeOf(err) { return suite.exitCodeForError(err) }

  it('ERR_VISUAL_NOT_READY ⇒ 3；其余 ⇒ 1（3 是 Gate 7 唯一阻断的那一档）', () => {
    expect(exitCodeOf({ code: 'ERR_VISUAL_NOT_READY' })).toBe(3)
    expect(exitCodeOf({ code: 'ERR_VISUAL_SUITE_FAILED' })).toBe(1)
    expect(exitCodeOf({})).toBe(1)
    expect(exitCodeOf(null)).toBe(1)
  })

  it('film-engineering 的就绪锚点必须是其路由组件必然渲染的节点', () => {
    const t = suite.viewTests.find(v => v.name === 'film-engineering')
    expect(t, '注册表里必须仍有 film-engineering').toBeTruthy()
    const router = fs.readFileSync(path.join(here, '../../src/router/index.js'), 'utf8')
    const line = router.split('\n').find(l => l.includes("path: '/film-engineering'"))
    expect(line, '/film-engineering 路由必须存在').toBeTruthy()
    const comp = (line.match(/name:\s*'([A-Za-z]+)'/) || [])[1]
    const compName = (line.match(/import\('@\/views\/([^']+)\.vue'\)/) || [])[1]
    expect(compName, '路由必须指向一个 views 组件：' + comp).toBeTruthy()
    const src = fs.readFileSync(path.join(here, '../../src/views/' + compName + '.vue'), 'utf8')
    const rootClass = (src.match(/<template>[\s\S]{0,160}?class="([a-z0-9-]+)/i) || [])[1]
    expect(rootClass, 'Hub 根类名要能取到').toBeTruthy()
    // 关键：锚点的**首段**必须是该路由组件的根节点，而不是藏在某个非默认标签里的子组件
    expect(t.waitFor.startsWith('.' + rootClass), `waitFor=${t.waitFor} 应以 .${rootClass} 开头`).toBe(true)
    // 旧写法必须被这条锁抓住：canvas 在 Hub 里是懒挂载的标签页
    expect(src).toMatch(/v-if="isMounted\('canvas'\)"/)
    expect(t.waitFor).not.toContain('film-canvas-view')
  })
})

// 补充视图套件有**自己的一份** runViewSuite（两份实现，两份聚合循环），
// 但「什么叫这一页根本没渲染出来」必须只有一个口径 —— 否则 Gate 7 里
// `views-supplement` 那条 `= 3` 判定永远点不到火，是一道装饰性门禁。
describe('两套 runViewSuite 共用同一份就绪分类', () => {
  const supp = require(path.join(here, 'views/supplementary-views.visual.test.js'))

  // 真 VisualTestRunner 的替身：就绪超时在真实链路里从 _navigateToRoute 抛出
  function suppRunner(throwErr, opt = {}) {
    return {
      url: 'http://127.0.0.1:5174',
      screenshotDir: 'X',
      consoleErrors: [],
      pageErrors: [],
      results: [],
      page: {
        click: async () => {
          if (opt.clickErr) throw opt.clickErr
        },
        waitForSelector: async () => {},
        screenshot: async () => {},
        locator: () => ({ first: () => ({ isVisible: async () => (opt.visible ?? true) }) }),
      },
      async launch() {},
      async close() {},
      async _navigateToRoute() {
        if (throwErr) throw throwErr
      },
      _throwOnRuntimeErrors() {},
    }
  }
  const sv = name => ({ name, route: '/' + name, checks: [{ name: '标题', selector: '.x' }] })
  const svTrigger = name => ({
    name, route: '/' + name, trigger: '[data-testid="x"]', afterTrigger: '.dialog',
    checks: [{ name: '弹窗', selector: '.dialog' }],
  })

  it('补充套件：就绪超时 ⇒ ERR_VISUAL_NOT_READY ⇒ 退出码 3', async () => {
    let err = null
    try {
      await supp.runViewSuite([sv('a')], { runner: suppRunner(timeoutErr('a')) })
    } catch (e) { err = e }
    expect(err, '必须抛错').toBeTruthy()
    expect(err.code).toBe('ERR_VISUAL_NOT_READY')
    expect(err.neverReady.map(x => x.test)).toEqual(['a'])
    expect(supp.exitCodeForError(err)).toBe(3)
  })

  it('补充套件：断言失败（校验类）保持 ERR_VISUAL_SUITE_FAILED ⇒ 退出码 1', async () => {
    let err = null
    try {
      await supp.runViewSuite([sv('a')], { runner: suppRunner(null, { visible: false }) })
    } catch (e) { err = e }
    expect(err.code).toBe('ERR_VISUAL_SUITE_FAILED')
    expect(err.neverReady).toEqual([])
    expect(supp.exitCodeForError(err)).toBe(1)
  })

  // R12：QM-6 后端评审命中的 Critical（2026-10-11，替代通道 opencode/nemotron-3-ultra-free）。
  // 分类一度按 `error.name === 'TimeoutError'` 兜底。补充套件 19 个视图里**有 4 个带
  // trigger/afterTrigger**（`user-menu-upgrade-entry` 与三个 model-provider 弹窗），
  // 走 `page.click(..., {timeout:5000})` 与 `page.waitForSelector(..., {timeout:10000})`，
  // 其中 `button:has-text("添加服务商")` 这类文案锚点本就可能在校验层失败；
  // `page.goto` 的 15s 超时同样是裸 TimeoutError（冷 Vite 首次依赖优化就能超）。
  // 把它们升成就绪故障 = 绕过 Gate 7b 的两轮甄别，正是本分档要防止的「把抖动变成常量红」。
  it('裸 TimeoutError（trigger 点击超时）不得升级成就绪故障', async () => {
    const clickTimeout = new Error('Timeout 5000ms exceeded.')
    clickTimeout.name = 'TimeoutError' // Playwright 原生形状：有 name、没有我们的 code
    let err = null
    try {
      await supp.runViewSuite([svTrigger('model-provider-add-dialog')], {
        runner: suppRunner(null, { clickErr: clickTimeout }),
      })
    } catch (e) { err = e }
    expect(err, '校验类失败仍必须抛错').toBeTruthy()
    expect(err.code).toBe('ERR_VISUAL_SUITE_FAILED')
    expect(err.neverReady).toEqual([])
    expect(supp.exitCodeForError(err)).toBe(1, '不得编成 3，否则 Gate 7 会拦掉一次可被两轮甄别放行的抖动')
  })

  // R13：判据本身也要锁 —— 否则下一个调用点把兜底重抄回去，只有真浏览器 run 才会发现。
  it('共享分类对裸 TimeoutError 判否、对 runner 的两个就绪码判是', () => {
    const gotoTimeout = new Error('Timeout 15000ms exceeded.')
    gotoTimeout.name = 'TimeoutError'
    expect(rc.isReadyFailure(gotoTimeout), 'goto/click 超时不算就绪').toBe(false)
    expect(rc.classifyFailures([{ test: 'a', error: gotoTimeout }]).neverReady).toEqual([])
    expect(rc.isReadyFailure(timeoutErr('a', READY_CODE))).toBe(true)
    expect(rc.isReadyFailure(timeoutErr('a', APP_READY_CODE))).toBe(true)
    expect(rc.isReadyFailure({ code: 'ERR_VISUAL_NOT_READY' })).toBe(true)
    expect(rc.isReadyFailure(null)).toBe(false)
  })

  it('分类判据只有一份实现：两个套件都只 require，不得各自定义', () => {
    const bodies = {
      'views/all-views.visual.test.js': fs.readFileSync(path.join(here, 'views/all-views.visual.test.js'), 'utf8'),
      'views/supplementary-views.visual.test.js': fs.readFileSync(path.join(here, 'views/supplementary-views.visual.test.js'), 'utf8'),
    }
    const shared = fs.readFileSync(path.join(here, 'ready-classification.js'), 'utf8')
    for (const [name, src] of Object.entries(bodies)) {
      expect(src.includes("require('../ready-classification')"), name + ' 必须引用共享实现').toBe(true)
      // 定义性写法出现即口径分裂（两份必然漂移）
      expect(/function\s+(isReadyFailure|exitCodeForError|classifyFailures)\s*\(/.test(src), name + ' 不得自带分类实现').toBe(false)
      expect(src.includes('const READY_TIMEOUT_CODES'), name + ' 不得自带就绪码表').toBe(false)
    }
    // 共享实现必须真的持有码表与两个判据（否则上面的锁在扫两个空文件）
    expect(shared.includes('const READY_TIMEOUT_CODES')).toBe(true)
    expect(['isReadyFailure', 'exitCodeForError', 'classifyFailures']
      .map(fn => (shared.match(new RegExp('function ' + fn + '\\(')) || []).length))
      .toEqual([1, 1, 1])
  })
})
