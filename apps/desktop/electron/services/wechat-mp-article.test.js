// @ts-check
/**
 * wechat-mp-article.test.js — 微信公众号图文「正文 + 封面」注入契约（回归锁）
 *
 * 缺陷背景（2026-10-12 用户报障）：同一条文案发到快手有正文有封面，
 * 发到微信公众号草稿箱**只有标题**。两处根因：
 *  ① 封面：`_publish_wechat_mp` 从头到尾没有封面上传这一步（对照 `_publish_generic` 有）；
 *  ② 正文：注入走 `_setElementContentSafe` 的 `el.innerHTML = ...` 直写 DOM ——
 *     新后台正文是 ProseMirror，本仓 2026-09-29 已为知乎 Draft.js 确立
 *     「受控组件的『内容在 DOM 里』不等于『进了框架 state』」，直写不被模型接受；
 *     该 Helper 还**无论是否生效都返回成功**。
 *
 * 本文件锁的判据（按「通道保真度降级 + 每步回读校验」）：
 *  - 正文：JSAPI `mp_editor_set_content`（HTML）→ 合成 paste → CDP `insertText` → innerHTML 兜底；
 *    每一步都回读，回读为 0 才降级；全部失败即 fail-closed。
 *  - 封面：入口 → 菜单 → 弹层 file input → 下一步/确认 → **生效证据**；
 *    ⛔ 生效证据**不得以「容器内 img 数」为主判据**（新版封面预览是 background-image 的 div，
 *    常常一个 img 都不加；用它会把成功判成失败，直接把公众号发布打死）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  fillWechatMpContent,
  fillWechatMpTitleEditor,
  hasHtmlTags,
  toParagraphHtml,
} = require('./wechat-mp-article')
const {
  uploadWechatMpCover,
  isCoverApplied,
} = require('./wechat-mp-cover')

const TMP_DIR = path.join(os.tmpdir(), 'multi-publish-wechat-mp-article-test')

function makeTinyPng (name) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const p = path.join(TMP_DIR, name)
  fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return p
}

const NO_COVER_STATE = { preview: false, hasCdn: false, bgUsable: false, imgCount: 0 }

/**
 * 造一个可控的 fake window：按脚本内标记分派返回值。
 * @param {object} plan
 */
function makeWindow (plan = {}) {
  const calls = { clear: 0, read: 0, jsapi: 0, paste: 0, coverState: 0, inject: 0, entry: 0, menu: 0, next: 0, inputs: 0, titleEditor: 0 }
  const queue = (value) => (Array.isArray(value) ? value.slice() : null)
  const plans = {
    coverState: queue(plan.coverState),
    read: queue(plan.read),
  }
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('/*mpwc-clear*/')) { calls.clear += 1; return typeof plan.clear === 'function' ? plan.clear(s) : (plan.clear === undefined ? null : plan.clear) }
    if (s.includes('/*mpwc-read*/')) { calls.read += 1; if (plans.read) return plans.read.shift(); return plan.read === undefined ? 0 : plan.read }
    if (s.includes('/*mpwc-jsapi*/')) { calls.jsapi += 1; return plan.jsapi === undefined ? { ok: false, detail: 'no-jsapi' } : plan.jsapi }
    if (s.includes('/*mpwc-paste*/')) { calls.paste += 1; return plan.paste === undefined ? { ok: false, detail: 'no-editor' } : plan.paste }
    if (s.includes('/*mpwc-cover-entry*/')) { calls.entry += 1; return plan.entry === undefined ? { ok: false, detail: 'no-entry' } : plan.entry }
    if (s.includes('/*mpwc-cover-menu*/')) { calls.menu += 1; return plan.menu === undefined ? { ok: false, detail: 'no-menu-item' } : plan.menu }
    if (s.includes('/*mpwc-cover-inputs*/')) { calls.inputs += 1; return plan.inputs === undefined ? 1 : plan.inputs }
    if (s.includes('/*mpwc-cover-inject*/')) { calls.inject += 1; return plan.inject === undefined ? true : plan.inject }
    if (s.includes('/*mpwc-cover-next*/')) { calls.next += 1; return plan.next === undefined ? { ok: false } : plan.next }
    if (s.includes('/*mpwc-cover-state*/')) {
      calls.coverState += 1
      if (plans.coverState && plans.coverState.length) return plans.coverState.shift()
      return plan.state === undefined ? NO_COVER_STATE : plan.state
    }
    if (s.includes('.title-editor__input')) { calls.titleEditor += 1; return plan.titleEditor === undefined ? false : plan.titleEditor }
    return true
  })
  return {
    win: { webContents: { getURL: vi.fn().mockReturnValue('https://mp.weixin.qq.com/cgi-bin/appmsg?appmsgid=1&token=1'), getTitle: vi.fn().mockReturnValue(''), executeJavaScript } },
    executeJavaScript,
    calls,
  }
}

function makeHost (overrides = {}) {
  return {
    _emitProgress: vi.fn(),
    _sleep: vi.fn().mockResolvedValue(undefined),
    _waitForElement: vi.fn().mockResolvedValue(true),
    _click: vi.fn().mockResolvedValue(true),
    _insertTextTrusted: vi.fn().mockResolvedValue(true),
    _setElementContentSafe: vi.fn().mockResolvedValue(true),
    _fillInFrame: vi.fn().mockResolvedValue(undefined),
    _setFileInput: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('wechat-mp-article — 正文注入', () => {
  it('无正文（空白）时跳过注入且不算失败', async () => {
    const { win, calls } = makeWindow()
    const host = makeHost()
    for (const content of ['', '   ', '\n\n', null, undefined]) {
      expect(await fillWechatMpContent(host, win, content)).toEqual(expect.objectContaining({ ok: true, skipped: true }))
    }
    expect(calls.clear).toBe(0)
    expect(host._insertTextTrusted).not.toHaveBeenCalled()
  })

  it('优先走平台 JSAPI（mp_editor_set_content，HTML 保真），回读通过即成功', async () => {
    const { win, calls } = makeWindow({ clear: { found: true, before: 0, cleared: 0 }, read: 12, jsapi: { ok: true } })
    const host = makeHost()

    const r = await fillWechatMpContent(host, win, '<p>第一段</p><p>第二段</p>')

    expect(r).toEqual(expect.objectContaining({ ok: true, strategy: 'jsapi-set_content', readBack: 12 }))
    expect(calls.jsapi).toBe(1)
    expect(calls.paste).toBe(0)
    expect(host._insertTextTrusted).not.toHaveBeenCalled()
    // 注入面必须带 HTML 净化（script/iframe/on*=）
    const jsapiScript = win.webContents.executeJavaScript.mock.calls.map(([s]) => String(s)).find(s => s.includes('/*mpwc-jsapi*/'))
    expect(jsapiScript).toContain('__MP_Editor_JSAPI__')
    expect(jsapiScript).toContain('mp_editor_set_content')
    expect(jsapiScript).toContain('script,iframe,object,embed')
  })

  it('JSAPI 不可用时降级到合成 paste（text/html DataTransfer），仍带 HTML', async () => {
    const { win, calls } = makeWindow({ clear: { found: true, before: 0, cleared: 0 }, read: 9, paste: { ok: true } })
    const host = makeHost()

    const r = await fillWechatMpContent(host, win, '<p>段落</p>')

    expect(r).toEqual(expect.objectContaining({ ok: true, strategy: 'paste-html' }))
    expect(calls.paste).toBe(1)
    const pasteScript = win.webContents.executeJavaScript.mock.calls.map(([s]) => String(s)).find(s => s.includes('/*mpwc-paste*/'))
    expect(pasteScript).toContain('text/html')
    expect(pasteScript).toContain('ClipboardEvent')
  })

  it('JSAPI 与 paste 都无效时降级到 CDP 可信注入（纯文本）', async () => {
    const { win } = makeWindow({ clear: { found: true, before: 0, cleared: 0 }, read: 5 })
    const host = makeHost()

    const r = await fillWechatMpContent(host, win, '<p>正文内容</p>')

    expect(r).toEqual(expect.objectContaining({ ok: true, strategy: 'cdp-insertText' }))
    expect(host._insertTextTrusted).toHaveBeenCalledWith(win, '正文内容')
  })

  it('🔴 全部通道回读为 0 即 fail-closed（不得把「没写进去」当成功）', async () => {
    const { win } = makeWindow({ clear: { found: true, before: 0, cleared: 0 }, read: 0 })
    const host = makeHost()

    const r = await fillWechatMpContent(host, win, '正文内容')

    expect(r.ok).toBe(false)
    expect(r.detail).toBe('readback-zero')
  })

  it('可信注入与 JSAPI/paste 都失败时回退 innerHTML，回读非 0 仍算成功但标记未验证', async () => {
    const { win } = makeWindow({ clear: { found: true, before: 0, cleared: 0 }, read: 7 })
    const host = makeHost({ _insertTextTrusted: vi.fn().mockResolvedValue(false) })

    const r = await fillWechatMpContent(host, win, '回退内容')

    expect(r).toEqual(expect.objectContaining({ ok: true, strategy: 'innerHTML-fallback', unverified: true }))
    expect(host._setElementContentSafe).toHaveBeenCalled()
  })

  it('主编辑器全部失配时走旧版 iframe 兜底（标记未验证）', async () => {
    const { win, calls } = makeWindow({ clear: null, read: 0 })
    const host = makeHost()

    const r = await fillWechatMpContent(host, win, '旧版正文')

    expect(r).toEqual(expect.objectContaining({ ok: true, strategy: 'iframe-legacy' }))
    expect(host._fillInFrame).toHaveBeenCalled()
    expect(calls.clear).toBeGreaterThan(0)
  })

  it('主编辑器与 iframe 都找不到时失败（不静默成功）', async () => {
    const { win } = makeWindow({ clear: null, read: 0 })
    const host = makeHost({ _waitForElement: vi.fn().mockResolvedValue(false) })

    const r = await fillWechatMpContent(host, win, '正文')

    expect(r.ok).toBe(false)
    expect(r.detail).toBe('editor-not-found')
  })

  it('编辑器候选按优先级尝试：`#js_editor .ProseMirror` 优先于宽泛的 `[contenteditable]`', async () => {
    const { win } = makeWindow({
      clear: (s) => (s.includes('.rich_media_content .ProseMirror') ? { found: true, before: 0, cleared: 0 } : null),
      read: 5,
      jsapi: { ok: true },
    })
    const host = makeHost()

    const r = await fillWechatMpContent(host, win, '正文')

    expect(r.ok).toBe(true)
    expect(r.selector).toBe('.rich_media_content .ProseMirror')
  })
})

describe('wechat-mp-article — HTML 归一', () => {
  it('hasHtmlTags 认得真标签，不把数学比较当标签', () => {
    expect(hasHtmlTags('<p>a</p>')).toBe(true)
    expect(hasHtmlTags('价格 <100 元')).toBe(false)
    expect(hasHtmlTags('纯文本')).toBe(false)
  })

  it('纯文本按行转段落并转义（不制造标签注入面）', () => {
    expect(toParagraphHtml('第一行\n\n第二行')).toBe('<p>第一行</p><p>第二行</p>')
    expect(toParagraphHtml('a<b & c')).toBe('<p>a&lt;b &amp; c</p>')
  })
})

describe('wechat-mp-article — 标题第二写入口', () => {
  it('页面没有 .title-editor__input 时跳过（不新增阻断）', async () => {
    const { win } = makeWindow({ titleEditor: false })
    const host = makeHost()

    const r = await fillWechatMpTitleEditor(host, win, '标题')

    expect(r.skipped).toBe(true)
    expect(host._insertTextTrusted).not.toHaveBeenCalled()
  })

  it('新版标题编辑器存在时用可信注入写入', async () => {
    const { win } = makeWindow({ titleEditor: true })
    const host = makeHost()

    const r = await fillWechatMpTitleEditor(host, win, '标题')

    expect(r.ok).toBe(true)
    expect(host._insertTextTrusted).toHaveBeenCalledWith(win, '标题')
  })
})

describe('wechat-mp-article — 封面生效判据', () => {
  it('🔴 封面 CDN 链接是强判据（img 数没变也算生效）', () => {
    expect(isCoverApplied({ preview: false, hasCdn: true, bgUsable: false, imgCount: 0 }, 0)).toBe('cdn')
  })

  it('🔴 预览节点是 background-image 时算生效 —— 不得要求 img 数增加', () => {
    // 这是本模块最容易写错的一条：新版封面预览是 background-image 的 div，
    // 常常一个 img 都不加；用 img 数当主判据会把成功判成失败、把公众号发布打死。
    expect(isCoverApplied({ preview: true, hasCdn: false, bgUsable: true, imgCount: 0 }, 0)).toBe('preview-bg')
  })

  it('img 数递增只作最弱兜底', () => {
    expect(isCoverApplied({ preview: false, hasCdn: false, bgUsable: false, imgCount: 3 }, 2)).toBe('img-delta')
    expect(isCoverApplied({ preview: false, hasCdn: false, bgUsable: false, imgCount: 2 }, 2)).toBe('')
  })

  it('什么都没有时不算生效', () => {
    expect(isCoverApplied({ preview: true, hasCdn: false, bgUsable: false, imgCount: 0 }, 0)).toBe('')
    expect(isCoverApplied({ preview: true, hasCdn: false, bgUsable: true, imgCount: 0 }, -1)).toBe('preview-bg')
  })
})

describe('wechat-mp-article — 封面上传', () => {
  it('未提供封面时跳过（不得因封面阻断发布）', async () => {
    const { win, calls } = makeWindow()
    const host = makeHost()

    const r = await uploadWechatMpCover(host, win, '')

    expect(r).toEqual(expect.objectContaining({ ok: true, skipped: true }))
    expect(calls.coverState).toBe(0)
    expect(host._click).not.toHaveBeenCalled()
  })

  it('封面文件不存在时失败并给出文件名（不打印完整目录）', async () => {
    const { win } = makeWindow()
    const host = makeHost()
    const missing = path.join(TMP_DIR, 'definitely-missing-cover.png')

    const r = await uploadWechatMpCover(host, win, missing)

    expect(r.ok).toBe(false)
    expect(r.detail).toBe('not-found')
    expect(r.fileName).toBe('definitely-missing-cover.png')
    expect(JSON.stringify(r)).not.toContain(TMP_DIR.replace(/\\/g, '\\\\'))
  })

  it('封面是网络地址时给出 not-a-local-file（DOM 轨只能注入本地文件）', async () => {
    const { win, calls } = makeWindow()
    const host = makeHost()

    const r = await uploadWechatMpCover(host, win, 'https://example.com/remote-cover.png')

    expect(r).toEqual(expect.objectContaining({ ok: false, detail: 'not-a-local-file' }))
    expect(host._click).not.toHaveBeenCalled()
    expect(calls.coverState).toBe(0)
  })

  it('封面超过 2MB 时失败（与公众号媒体上传上限同口径）', async () => {
    fs.mkdirSync(TMP_DIR, { recursive: true })
    const big = path.join(TMP_DIR, 'too-big.png')
    fs.writeFileSync(big, Buffer.alloc(2 * 1024 * 1024 + 1))
    const { win, calls } = makeWindow()
    const host = makeHost()

    const r = await uploadWechatMpCover(host, win, big)

    expect(r).toEqual(expect.objectContaining({ ok: false, detail: 'too-large' }))
    expect(host._click).not.toHaveBeenCalled()
    expect(calls.coverState).toBe(0)
  })

  it('入口找不到时失败（entry-not-found）', async () => {
    const cover = makeTinyPng('entry-missing.png')
    const { win } = makeWindow()
    const host = makeHost({ _click: vi.fn().mockResolvedValue(false) })

    const r = await uploadWechatMpCover(host, win, cover)

    expect(r).toEqual(expect.objectContaining({ ok: false, detail: 'entry-not-found' }))
  })

  it('入口按候选表点击，先点 `#js_cover_area .js_cover_btn_area`', async () => {
    const cover = makeTinyPng('entry-order.png')
    const { win } = makeWindow({ coverState: [NO_COVER_STATE, { preview: true, hasCdn: true, bgUsable: true, imgCount: 0 }] })
    const clicked = []
    const host = makeHost({ _click: vi.fn(async (_w, sel) => { clicked.push(String(sel)); return true }) })

    const r = await uploadWechatMpCover(host, win, cover)

    expect(r.ok).toBe(true)
    expect(clicked[0]).toBe('#js_cover_area .js_cover_btn_area')
  })

  it('上传后会点「下一步/确认」并等生效证据', async () => {
    const cover = makeTinyPng('confirm.png')
    const { win, calls } = makeWindow({
      coverState: [NO_COVER_STATE, { preview: true, hasCdn: true, bgUsable: true, imgCount: 0 }],
      next: { ok: true, label: '确认' },
    })
    const host = makeHost()

    const r = await uploadWechatMpCover(host, win, cover)

    expect(r).toEqual(expect.objectContaining({ ok: true, detail: 'OK_0', evidence: 'cdn' }))
    expect(calls.inject).toBeGreaterThan(0)
    expect(calls.next).toBeGreaterThan(0)
    // 注入走 DataTransfer + change 事件（与 _uploadToutiaoCover 同款通道）
    const injectScript = win.webContents.executeJavaScript.mock.calls.map(([s]) => String(s)).find(s => s.includes('/*mpwc-cover-inject*/'))
    expect(injectScript).toContain('DataTransfer')
    expect(injectScript).toContain("new Event('change'")
  })

  it('🔴 拿不到任何生效证据即 fail-closed（不得把「图没上去」当成功）', async () => {
    const cover = makeTinyPng('no-evidence.png')
    const { win, calls } = makeWindow({ state: NO_COVER_STATE })
    const host = makeHost()

    const r = await uploadWechatMpCover(host, win, cover)

    expect(r).toEqual(expect.objectContaining({ ok: false, detail: 'cover-not-applied' }))
    expect(calls.inject).toBeGreaterThan(0)
  })

  it('DataTransfer 被受控组件拒绝时回退 CDP 文件注入', async () => {
    const cover = makeTinyPng('cdp-fallback.png')
    const { win } = makeWindow({
      inject: false,
      coverState: [NO_COVER_STATE, { preview: true, hasCdn: true, bgUsable: true, imgCount: 0 }],
      next: { ok: true, label: '确认' },
    })
    const host = makeHost()

    const r = await uploadWechatMpCover(host, win, cover)

    expect(r.ok).toBe(true)
    expect(host._setFileInput).toHaveBeenCalled()
    expect(host._setFileInput.mock.calls[0][1]).toBe(cover)
  })
})
