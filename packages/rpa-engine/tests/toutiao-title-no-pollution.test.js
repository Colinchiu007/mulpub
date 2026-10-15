// @ts-nocheck
// TDD —— 头条标题污染回归锁（2026-10-15 真机事故，BUGFIX-TOUTIAO-TITLE-SUFFIX-2026-10-15）
//
// 事故：用户原标题「DeepSeek崩了」经本应用发布到头条号后，标题变成「DeepSeek崩了 1935」。
// 根因（第一性）：`publishViaPageXhr` 的「触发自动保存」步骤把标题改成
//   `原标题.slice(0,26) + ' ' + Date.now().toString().slice(-4)`
// 写进页面标题框后**从不还原** —— 页面据此自动保存，重放的 body 里就带着这串数字。
// 「1935」正是当时的 epoch 毫秒数后 4 位（扰动值是「触发保存的手段」，
// 却被当成了「发布的内容」）。
//
// 本文件锁四条：
//   A) 扰动脚本的**净效果**：页面标题框最终值 === 原标题（一个字符都不多），
//      且 React 侧「最后一次 onChange」携带的也是原标题（自动保存因此发出正确内容）。
//   B) 扰动确实发生过（保留原机制的触发能力，不得用「不触发」换取「不污染」）。
//   C) 重放 body 的 `title=` 字段必须是正确标题 —— 即便被 hook 捕获的 body 已带扰动值
//      （兜底真源，防保存请求抢跑）。
//   D) 结构锁：扰动脚本不得再出现 `Date.now` / 取后 4 位这类会把时钟漏进内容的写法。

// vitest.config.js 已开 globals: true —— 与同目录 toutiao-schedule-intent.test.js 一致，
// 直接使用全局 describe/it/expect（require('vitest') 在 CJS 下会被上游拒绝）。
const {
  buildTitleBumpScript,
  overrideBodyTitle,
  publishViaPageXhr,
} = require('../src/toutiao-direct-bridge')

// ─── 假页面：模拟头条编辑器标题框 + React 的 onChange 语义 ───────────────────
//
// React 的判据（inputValueTracking）：只有当「本次 input 事件时的值」与
// 「上一次 React 见过的值」不同，才派发 onChange。扰动机制正是靠这个差异
// 触发自动保存的；还原后必须再制造一次差异，让最后一次 onChange 携带原标题。
function makeFakePage (initialTitle) {
  const changes = []
  const titleEl = {
    tagName: 'TEXTAREA',
    placeholder: '请输入文章标题（2～30个字）',
    __v: initialTitle,
    __seen: initialTitle,
    dispatchEvent (ev) {
      if (ev && ev.type === 'input' && this.__v !== this.__seen) {
        this.__seen = this.__v
        changes.push(this.__v)
      }
      return true
    },
  }
  // 与真实 DOM 一致：value 访问器定义在 prototype 上，脚本经
  // `Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')` 拿 setter
  const proto = {}
  Object.defineProperty(proto, 'value', {
    get () { return this.__v },
    set (v) { this.__v = v },
    configurable: true,
  })
  Object.setPrototypeOf(titleEl, proto)
  class FakeEvent {
    constructor (type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles) }
  }
  const sandbox = {
    document: { querySelectorAll: (sel) => (String(sel).includes('textarea') ? [titleEl] : []) },
    window: { HTMLTextAreaElement: { prototype: proto } },
    Event: FakeEvent,
    XMLHttpRequest: class {},
    JSON,
    encodeURIComponent,
  }
  return { sandbox, titleEl, changes }
}

function runScript (script, sandbox) {
  // 脚本形如 `(function(){...})()`，作为表达式求值。
  // 沙箱需提供页面全局：真实页面里这些是全局对象；hook 与重放脚本都会用到
  // XMLHttpRequest / JSON / encodeURIComponent。
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'Event', 'XMLHttpRequest', 'JSON', 'encodeURIComponent', 'return ' + script)(
    sandbox.window, sandbox.document, sandbox.Event, sandbox.XMLHttpRequest, sandbox.JSON, sandbox.encodeURIComponent)
}

const ORIGINAL_TITLE = 'DeepSeek崩了'

describe('A) 标题扰动脚本的净效果：还原为原标题，一个字符都不多', () => {
  it('普通中文标题：扰动后最终值 === 原标题', () => {
    const page = makeFakePage(ORIGINAL_TITLE)
    const ret = runScript(buildTitleBumpScript(), page.sandbox)
    expect(page.titleEl.__v).toBe(ORIGINAL_TITLE)
    expect(ret).toBe('RESTORED')
  })

  it('React 最后一次 onChange 携带的是原标题（自动保存发出正确内容）', () => {
    const page = makeFakePage(ORIGINAL_TITLE)
    runScript(buildTitleBumpScript(), page.sandbox)
    expect(page.changes.length).toBeGreaterThanOrEqual(2)
    expect(page.changes[page.changes.length - 1]).toBe(ORIGINAL_TITLE)
  })

  it('空标题：扰动后仍为空（不产出任何字符）', () => {
    const page = makeFakePage('')
    const ret = runScript(buildTitleBumpScript(), page.sandbox)
    expect(page.titleEl.__v).toBe('')
    expect(ret).toBe('RESTORED')
  })

  it('超 26 字标题：旧实现的 slice(0,26) 截断形态不得复现', () => {
    const long = '这是一个非常非常长的标题用来验证旧实现的二十六字截断行为不会复活abcdefg'
    expect(long.length).toBeGreaterThan(26)
    const page = makeFakePage(long)
    runScript(buildTitleBumpScript(), page.sandbox)
    expect(page.titleEl.__v).toBe(long)
    expect(page.titleEl.__v.length).toBe(long.length)
  })

  it('含 HTML/尖括号/表情的标题：原样还原（转义与截断都不发生）', () => {
    const tricky = '价格 <100 元 & 兼容 😀 <stdio.h>'
    const page = makeFakePage(tricky)
    runScript(buildTitleBumpScript(), page.sandbox)
    expect(page.titleEl.__v).toBe(tricky)
  })

  it('找不到标题框时返回 NO_TITLE（不抛错，不影响后续流程）', () => {
    const page = makeFakePage(ORIGINAL_TITLE)
    page.sandbox.document.querySelectorAll = () => []
    expect(runScript(buildTitleBumpScript(), page.sandbox)).toBe('NO_TITLE')
  })
})

describe('B) 触发能力保留：扰动必须真的发生（不得用「不触发」换「不污染」）', () => {
  it('扰动值与原值不同 ⇒ React 能感知变化', () => {
    const page = makeFakePage(ORIGINAL_TITLE)
    runScript(buildTitleBumpScript(), page.sandbox)
    // 第一次 onChange 是扰动值（与原标题不同），证明「触发自动保存」的机制仍在
    expect(page.changes.length).toBeGreaterThanOrEqual(2)
    expect(page.changes[0]).not.toBe(ORIGINAL_TITLE)
    expect(page.changes[0]).toContain(ORIGINAL_TITLE)
  })

  it('扰动值不可见且非数字（即便保存请求抢跑也不会把可见数字带进标题）', () => {
    const page = makeFakePage(ORIGINAL_TITLE)
    runScript(buildTitleBumpScript(), page.sandbox)
    const transient = page.changes[0]
    // 去掉原标题后剩下的就是扰动标记：必须是零宽字符，不能是数字/年份
    const marker = transient.slice(ORIGINAL_TITLE.length)
    expect(marker).toBe('\u200b')
    expect(marker).not.toMatch(/\d/)
  })
})

describe('C) 重放 body 的 title= 字段兜底覆盖（防保存请求抢跑）', () => {
  const POLLUTED_BODY = 'title=' + encodeURIComponent(ORIGINAL_TITLE + ' 1935')
    + '&save=0&content=' + encodeURIComponent('<p>正文第一段</p>').padEnd(600, 'x')
    + '&title_id=abc123&pgc_id=456&article_ad_type=2'

  it('已带扰动值的 body：title= 被覆盖为正确标题', () => {
    const fixed = overrideBodyTitle(POLLUTED_BODY, ORIGINAL_TITLE)
    expect(fixed).toContain('title=' + encodeURIComponent(ORIGINAL_TITLE) + '&')
    expect(fixed).not.toContain('1935')
  })

  it('不误伤邻键 title_id（判据要求 title 后紧跟 =）', () => {
    const fixed = overrideBodyTitle(POLLUTED_BODY, ORIGINAL_TITLE)
    expect(fixed).toContain('title_id=abc123')
    expect(fixed).toContain('pgc_id=456')
    expect(fixed).toContain('article_ad_type=2')
  })

  it('title= 位于 body 首位（^ 形态）同样命中', () => {
    const fixed = overrideBodyTitle(POLLUTED_BODY, ORIGINAL_TITLE)
    expect(fixed.startsWith('title=' + encodeURIComponent(ORIGINAL_TITLE))).toBe(true)
  })

  it('body 无 title= 字段时追加，不丢原有字段', () => {
    const noTitle = 'save=0&content=' + 'y'.repeat(600) + '&pgc_id=1'
    const fixed = overrideBodyTitle(noTitle, ORIGINAL_TITLE)
    expect(fixed.endsWith('&title=' + encodeURIComponent(ORIGINAL_TITLE))).toBe(true)
    expect(fixed).toContain('pgc_id=1')
    expect(fixed).toContain('save=0')
  })

  it('幂等：对已正确的内容再次调用不变', () => {
    const once = overrideBodyTitle(POLLUTED_BODY, ORIGINAL_TITLE)
    const twice = overrideBodyTitle(once, ORIGINAL_TITLE)
    expect(twice).toBe(once)
  })

  it('空标题不覆盖（fail-safe：不拿空值破坏页面已生成的标题）', () => {
    const fixed = overrideBodyTitle(POLLUTED_BODY, '')
    expect(fixed).toBe(POLLUTED_BODY)
    const fixedNull = overrideBodyTitle(POLLUTED_BODY, null)
    expect(fixedNull).toBe(POLLUTED_BODY)
  })
})

describe('D) 结构锁：扰动脚本不得把时钟漏进用户内容', () => {
  it('脚本内不出现 Date.now', () => {
    expect(buildTitleBumpScript()).not.toMatch(/Date\.now/)
  })

  it('脚本内不出现「取后 4 位」这类数字后缀写法', () => {
    expect(buildTitleBumpScript()).not.toMatch(/slice\(-\d+\)/)
    expect(buildTitleBumpScript()).not.toMatch(/\d{4}/)
  })

  it('脚本内不对标题值做 slice 截断', () => {
    const script = buildTitleBumpScript()
    expect(script).not.toMatch(/\.slice\(0\s*,/)
    expect(script).not.toMatch(/value\).slice/)
  })
})

// ─── E) 集成：publishViaPageXhr 实际发出的 body 标题必须正确 ──────────────────
//
// 这是本次事故的**端到端回归**：假页面里 __lastSaveBody 已经是「带扰动值」的
// 形态（复刻真机被 hook 捕获到的 body），走完整 publishViaPageXhr 后，
// 真正 POST 出去的 body 里 title= 必须是原标题。
describe('E) 集成：publishViaPageXhr 发出的 body 标题 === 原标题', () => {
  function makeWin (pollutedBody) {
    const sent = []
    const changes = []
    const sandbox = {}

    class FakeEvent {
      constructor (type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles) }
    }
    // 页面侧 XMLHttpRequest：`send` 即「页面发出的请求」。
    // 对 article/publish 请求，本仓 hook 会把它捕获进 window.__lastSaveBody ——
    // 这里如实模拟该副作用（否则重放脚本永远拿不到 body）。
    class FakeXhr {
      constructor () { this.__u = '' }
      open (m, u) { this.__u = String(u) }
      setRequestHeader () {}
      send (b) {
        const u = String(this.__u || '')
        const body = String(b)
        if (u.indexOf('article/publish') >= 0 && body) {
          sandbox.window.__lastSaveBody = body
          const m2 = body.match(/title_id=([^&]+)/)
          if (m2) sandbox.window.__titleId = m2[1]
        }
        sent.push({ url: this.__u, body })
        this.responseText = JSON.stringify({ code: 0, message: '提交成功', data: { pgc_id: '777' } })
      }
    }
    const titleEl = {
      tagName: 'TEXTAREA',
      placeholder: '请输入文章标题（2～30个字）',
      __v: ORIGINAL_TITLE,
      __seen: ORIGINAL_TITLE,
      dispatchEvent (ev) {
        if (ev && ev.type === 'input' && this.__v !== this.__seen) {
          this.__seen = this.__v
          changes.push(this.__v)
          // 真机语义：React 感知到变化后异步发出「自动保存」请求，请求体按标题框
          // **当前值**构造 —— 这正是污染得以传播的通道（抢跑即污染）。
          queueMicrotask(() => {
            const x = new FakeXhr()
            x.open('POST', '/mp/agw/article/publish?source=mp&type=article&aid=1231&mp_publish_ab_val=0')
            x.send('title=' + encodeURIComponent(this.__v)
              + '&save=0&content=' + encodeURIComponent('<p>正文</p>').padEnd(600, 'x')
              + '&title_id=tid1&pgc_id=999')
          })
        }
        return true
      },
    }
    const proto = {}
    Object.defineProperty(proto, 'value', {
      get () { return this.__v },
      set (v) { this.__v = v },
      configurable: true,
    })
    Object.setPrototypeOf(titleEl, proto)

    sandbox.document = { querySelectorAll: (sel) => (String(sel).includes('textarea') ? [titleEl] : []) }
    sandbox.window = {
      HTMLTextAreaElement: { prototype: proto },
      __lastSaveBody: pollutedBody,
      __titleId: '',
    }
    sandbox.XMLHttpRequest = FakeXhr
    sandbox.Event = FakeEvent
    sandbox.JSON = JSON
    sandbox.encodeURIComponent = encodeURIComponent

    // executeJavaScript：把脚本当表达式在沙箱里求值（与 Electron returnByValue 语义一致）
    const executeJavaScript = async (script) => runScript(script, sandbox)
    return { sent, changes, titleEl, webContents: { executeJavaScript } }
  }

  it('带扰动值的 __lastSaveBody → 发出的 body 标题正确，且扰动仍触发过', async () => {
    const polluted = 'title=' + encodeURIComponent(ORIGINAL_TITLE + ' 1935')
      + '&save=0&content=' + encodeURIComponent('<p>正文</p>').padEnd(600, 'x')
      + '&title_id=tid1&pgc_id=999'
    const win = makeWin(polluted)
    const log = { info: () => {}, warn: () => {} }

    const result = await publishViaPageXhr({ win, title: ORIGINAL_TITLE, log })

    expect(result.success).toBe(true)
    expect(result.pgcId).toBe('777')
    // 真正「发布」的那一次是最后一次请求（前面的都是页面自动保存）
    expect(win.sent.length).toBeGreaterThanOrEqual(1)
    const body = win.sent[win.sent.length - 1].body
    expect(body).toContain('title=' + encodeURIComponent(ORIGINAL_TITLE) + '&')
    expect(body).not.toContain('1935')
    // save=1（真发布）与 title_id 上下文都被保留
    expect(body).toContain('save=1')
    expect(body).toContain('title_id=tid1')
    // 扰动机制仍在（自动保存触发器没被修复顺手关掉）
    expect(win.changes.length).toBeGreaterThanOrEqual(2)
    expect(win.changes[win.changes.length - 1]).toBe(ORIGINAL_TITLE)
    // 抢跑兜底生效：页面**任何一次**自动保存发出的 title 都不是污染值
    for (const req of win.sent) {
      const t = String(req.body).match(/(^|&)title=([^&]*)/)
      if (t) expect(decodeURIComponent(t[2])).toBe(ORIGINAL_TITLE)
    }
  })

  it('页面标题框被扰动后，最终 DOM 值仍是原标题', async () => {
    const polluted = 'title=' + encodeURIComponent(ORIGINAL_TITLE + ' 1935')
      + '&save=0&content=' + 'z'.repeat(600) + '&pgc_id=1'
    const win = makeWin(polluted)
    const log = { info: () => {}, warn: () => {} }

    await publishViaPageXhr({ win, title: ORIGINAL_TITLE, log })

    expect(win.titleEl.__v).toBe(ORIGINAL_TITLE)
  })
})
