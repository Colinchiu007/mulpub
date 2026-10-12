// @ts-check
/**
 * wechat-mp-article.js — 微信公众号图文「正文 + 标题」注入（2026-10-12 修复）
 *
 * ## 修的是什么
 *
 * 用户报障：同一条文案发到快手有正文有封面，发到微信公众号草稿箱**只有标题**。
 * 正文这一半的根因是：`_publish_wechat_mp` 用 `_setElementContentSafe(win, sel, content)`
 * 填正文，其默认分支是 `el.innerHTML = tmp.innerHTML`。新版后台（`appmsg_edit_v2`）
 * 正文是 **ProseMirror** —— 本仓 2026-09-29 为知乎 Draft.js 已确立结论：
 * 「受控组件的『内容在 DOM 里』不等于『进了框架 state』」，直写 DOM 不进模型；
 * 而该 Helper **无论是否生效都返回成功**，于是「界面一度有字 → 保存后正文为空」被记成 success。
 *
 * ## 通道按保真度降级，每步都回读校验
 *
 * A. 平台自带 `__MP_Editor_JSAPI__.mp_editor_set_content`（HTML 全保真；生产工具 doocs/md 在用）
 * B. 合成 `paste`（`text/html` DataTransfer；走编辑器自己的粘贴处理链，格式才留得住）
 * C. CDP `Input.insertText`（纯文本；本仓为 Draft.js/ProseMirror 确立的可信通道）
 * D. `innerHTML` 直写（仅旧版 ueditor 才认；标记 `unverified`）
 * E. 旧版 `iframe#ueditor_0`
 *
 * 每一步注入后都**清空 + 注入 + 静置 + 回读**，回读 > 0 才算进模型；全部失败即 fail-closed。
 * 判据一律「页面真实读回」，不落在 Helper 的返回值上（这是本仓踩过的坑：
 * `_fillInput` 的注释原文「旧实现无论是否生效都返回 true，导致填充未生效被当成成功」）。
 *
 * ## 真机边界
 *
 * 选择器取自多个第三方公众号自动化项目的一致用法（无第一手抓取）：正文新编辑器
 * `#js_editor .ProseMirror` / `.rich_media_content .ProseMirror`；旧版 `iframe#ueditor_0`。
 * 这是**候选表**而非定论——返回值里带命中的是哪个候选，一次真机失败即可定位。
 */
const log = require('./logger')

/** 注入后的静置时间（等编辑器把事件并入内部模型再回读） */
const SETTLE_MS = 800
/** JSAPI set_content 的回调等待上限 */
const JSAPI_TIMEOUT_MS = 3000

/** 正文编辑器候选（新版 ProseMirror 优先，`#js_editor_content` 为旧版 ueditor 兼容项） */
const CONTENT_SELECTORS = [
  '#js_editor .ProseMirror',
  '.rich_media_content .ProseMirror',
  '#js_editor_content',
  '.ProseMirror',
  '.ql-editor',
  '[data-lexical-editor="true"]',
  '[contenteditable="true"]',
]

/** 旧版后台把编辑器放在 iframe 内（ueditor） */
const CONTENT_IFRAME_SELECTORS = ['iframe#ueditor_0', 'iframe[src*="ueditor"]']

/** 新版标题也是一个 ProseMirror（隐藏的 `#title` textarea 仍存在） */
const TITLE_EDITOR_SELECTOR = '.title-editor__input .ProseMirror'

const MARKER = {
  clear: '/*mpwc-clear*/',
  read: '/*mpwc-read*/',
  jsapiSet: '/*mpwc-jsapi*/',
  pasteHtml: '/*mpwc-paste*/',
  titleProbe: '/*mpwc-title-probe*/',
}

function jsString (value) {
  return JSON.stringify(value == null ? '' : String(value))
}

/** 只保留真标签：`<100 元` 这类数学比较不得被当标签吞掉（与 stripHtmlToPlainText 同款判据） */
function stripTagsLoose (html) {
  return String(html == null ? '' : html).replace(/<(?=[a-zA-Z/!?])[^>]*>/g, '')
}

// ---- 正文形态单一实现收敛（converge-article-body-helpers，2026-10-12）----
// `hasHtmlTags` / `toParagraphHtml` 委托 `api-publish-engine/src/content-formatter.js`
// 的同名语义（**标签名白名单**判据）。此前本文件的宽判据（`<` 后跟字母）会把技术正文
// 里的 `#include <stdio.h>`、`vector<int>` 误判成 HTML ⇒ 走「已是 HTML」分支原样注入，
// 代码尖括号被编辑器当未知标签吞掉。导出名与签名不变，调用点零改动。

const {
  hasHtmlTags,
  textToParagraphHtml: toParagraphHtml,
} = require('@multi-publish/api-publish-engine/src/content-formatter')

/** Node 侧 HTML→纯文本：复用仓库既有单一实现（头条链同款），失败时退化到宽松剥离 */
function toPlainText (raw) {
  try {
    return require('./rpa-view-navigation-helpers').stripHtmlToPlainText(raw)
  } catch (_) {
    return stripTagsLoose(raw)
  }
}

/** 焦点 + 全选 + 清空 + 读回注入前基线（一次 JS 往返） */
function clearEditorScript (selector) {
  return '(function(){' + MARKER.clear
    + 'var el=document.querySelector(' + jsString(selector) + ');'
    + 'if(!el)return null;'
    + 'var target=el;'
    + 'if(el.getAttribute("contenteditable")!=="true"){'
    + 'var inner=el.querySelector(\'[contenteditable="true"]\');if(inner)target=inner}'
    + 'try{target.focus()}catch(e){}'
    + 'var before=String(target.innerText||"").replace(/\\s+/g,"").length;'
    + 'try{document.execCommand("selectAll");document.execCommand("delete")}catch(e){}'
    + 'var cleared=String(target.innerText||"").replace(/\\s+/g,"").length;'
    + 'return {found:true,before:before,cleared:cleared}})()'
}

/** 读回编辑器可见文本长度（去空白） */
function readEditorScript (selector) {
  return '(function(){' + MARKER.read
    + 'var el=document.querySelector(' + jsString(selector) + ');if(!el)return -1;'
    + 'return String(el.innerText||"").replace(/\\s+/g,"").length})()'
}

/** HTML 净化（与 `_setElementContentSafe` 同口径）+ `mp_editor_set_content` */
function jsapiSetContentScript (html) {
  return '(function(){' + MARKER.jsapiSet
    + 'var api=window.__MP_Editor_JSAPI__;'
    + 'if(!api||typeof api.invoke!=="function")return Promise.resolve({ok:false,detail:"no-jsapi"});'
    + 'var tmp=document.createElement("div");tmp.innerHTML=' + jsString(html) + ';'
    + 'tmp.querySelectorAll("script,iframe,object,embed,link[rel=import]").forEach(function(n){n.remove()});'
    + 'tmp.querySelectorAll("*").forEach(function(n){[].forEach.call(n.attributes,function(a){'
    + 'if(a.name.toLowerCase().indexOf("on")===0)n.removeAttribute(a.name)})});'
    + 'var content=tmp.innerHTML;'
    + 'return new Promise(function(resolve){'
    + 'var settled=false;var finish=function(v){if(settled)return;settled=true;resolve(v)};'
    + 'setTimeout(function(){finish({ok:false,detail:"jsapi-timeout"})},' + JSAPI_TIMEOUT_MS + ');'
    + 'try{api.invoke({apiName:"mp_editor_set_content",apiParam:{content:content},'
    + 'sucCb:function(){finish({ok:true})},errCb:function(){finish({ok:false,detail:"jsapi-err"})}})}'
    + 'catch(e){finish({ok:false,detail:"jsapi-throw"})}})})()'
}

/** 合成 paste（text/html DataTransfer）：走编辑器自己接的处理链，格式才留得住 */
function pasteHtmlScript (selector, html) {
  return '(function(){' + MARKER.pasteHtml
    + 'var el=document.querySelector(' + jsString(selector) + ');if(!el)return {ok:false,detail:"no-editor"};'
    + 'try{el.focus()}catch(e){}'
    + 'var dt=new DataTransfer();dt.setData("text/html",' + jsString(html) + ');'
    + 'dt.setData("text/plain",' + jsString(stripTagsLoose(html)) + ');'
    + 'var ev;try{ev=new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true})}'
    + 'catch(e){ev=document.createEvent("Event");ev.initEvent("paste",true,true);ev.clipboardData=dt}'
    + 'el.dispatchEvent(ev);return {ok:true}})()'
}

/** 新版标题编辑器是否存在（存在才补第二次写入） */
function titleProbeScript () {
  return '(function(){' + MARKER.titleProbe + 'return !!document.querySelector('
    + jsString(TITLE_EDITOR_SELECTOR) + ')})()'
}

async function safeExec (win, script, fallback = null) {
  try {
    const r = await win.webContents.executeJavaScript(script)
    return r === undefined ? fallback : r
  } catch (e) {
    log.warn('RpaView', '[wechat_mp] exec failed: ' + (e && e.message))
    return fallback
  }
}

/** CDP 可信注入：不可用时（替身/异常）返回 false，由调用方降级 */
async function insertPlainTextTrusted (host, win, plain) {
  try {
    if (typeof host._insertTextTrusted !== 'function') return false
    return (await host._insertTextTrusted(win, plain)) === true
  } catch (e) {
    log.warn('RpaView', '[wechat_mp] trusted insert failed: ' + (e && e.message))
    return false
  }
}

/**
 * 注入公众号正文（多做一步「清空 + 回读」以取得可信判据）。
 *
 * @param {object} host RpaViewManager 混入对象
 * @param {object} win BrowserWindow
 * @param {string} content 文章正文（HTML 或纯文本）
 * @returns {Promise<{ok: boolean, skipped?: boolean, strategy?: string, selector?: string, readBack?: number, unverified?: boolean, detail?: string}>}
 */
async function fillWechatMpContent (host, win, content) {
  const raw = String(content == null ? '' : content)
  if (!raw.trim()) return { ok: true, skipped: true, detail: 'empty' }

  const plain = toPlainText(raw).trim() || stripTagsLoose(raw).trim()
  if (!plain) return { ok: true, skipped: true, detail: 'empty-after-strip' }
  const html = hasHtmlTags(raw) ? raw : toParagraphHtml(plain)

  // 编辑器挂载等待：新版后台是 SPA，编辑区挂载晚于导航完成。等待失败不在此处判负——
  // 下面按候选逐个探测才是判据。
  try {
    if (typeof host._waitForElement === 'function') {
      await host._waitForElement(win, CONTENT_SELECTORS.slice(0, 4).join(', '), 15000)
    }
  } catch (_) { /* 等待异常由候选循环判定 */ }

  for (const selector of CONTENT_SELECTORS) {
    const prep = await safeExec(win, clearEditorScript(selector), null)
    if (!prep || prep.found !== true) continue

    // A. 平台 JSAPI（HTML 全保真）
    const jsapi = await safeExec(win, jsapiSetContentScript(html), { ok: false, detail: 'unavailable' })
    if (jsapi && jsapi.ok === true) {
      await host._sleep(SETTLE_MS)
      const readBack = Number(await safeExec(win, readEditorScript(selector), 0))
      if (readBack > 0) {
        log.info('RpaView', '[wechat_mp] content via mp_editor_set_content selector=' + selector + ' chars=' + readBack)
        return { ok: true, strategy: 'jsapi-set_content', selector, readBack }
      }
      log.warn('RpaView', '[wechat_mp] jsapi set_content readback=0 selector=' + selector)
    }

    // B. 合成 paste（HTML，走编辑器自己的粘贴处理链）
    const pasted = await safeExec(win, pasteHtmlScript(selector, html), { ok: false })
    if (pasted && pasted.ok === true) {
      await host._sleep(SETTLE_MS)
      const readBack = Number(await safeExec(win, readEditorScript(selector), 0))
      if (readBack > 0) {
        log.info('RpaView', '[wechat_mp] content via paste-html selector=' + selector + ' chars=' + readBack)
        return { ok: true, strategy: 'paste-html', selector, readBack }
      }
      log.warn('RpaView', '[wechat_mp] paste-html readback=0 selector=' + selector)
    }

    // C. CDP 可信注入（纯文本）
    if (await insertPlainTextTrusted(host, win, plain)) {
      await host._sleep(SETTLE_MS)
      const readBack = Number(await safeExec(win, readEditorScript(selector), 0))
      if (readBack > 0) {
        log.info('RpaView', '[wechat_mp] content via cdp-insertText selector=' + selector + ' chars=' + readBack)
        return { ok: true, strategy: 'cdp-insertText', selector, readBack }
      }
      log.warn('RpaView', '[wechat_mp] cdp-insertText readback=0 selector=' + selector + '（模型未接受）')
    }

    // D. innerHTML 直写（旧版 ueditor 才接受）。无法证明模型已接受，故标 unverified。
    try {
      await host._setElementContentSafe(win, selector, plain)
    } catch (e) {
      log.warn('RpaView', '[wechat_mp] innerHTML fallback failed: ' + (e && e.message))
    }
    await host._sleep(SETTLE_MS)
    const fallbackRead = Number(await safeExec(win, readEditorScript(selector), 0))
    if (fallbackRead > 0) {
      log.warn('RpaView', '[wechat_mp] content via innerHTML-fallback（未验证模型）selector=' + selector
        + ' chars=' + fallbackRead + ' clearedBefore=' + String(prep.cleared))
      return { ok: true, strategy: 'innerHTML-fallback', selector, readBack: fallbackRead, unverified: true }
    }
    log.warn('RpaView', '[wechat_mp] content readback=0 after all strategies selector=' + selector)
    return { ok: false, detail: 'readback-zero', selector }
  }

  // E. 旧版 iframe 编辑器（ueditor）：iframe body 的 innerHTML 自持，直写即可持久化。
  if (typeof host._fillInFrame === 'function') {
    for (const iframeSelector of CONTENT_IFRAME_SELECTORS) {
      const ready = await (async () => {
        try { return await host._waitForElement(win, iframeSelector, 3000) === true } catch (_) { return false }
      })()
      if (!ready) continue
      try {
        await host._fillInFrame(win, iframeSelector, '#js_editor_content, [contenteditable="true"]', plain)
        log.warn('RpaView', '[wechat_mp] content via iframe-legacy（旧版编辑器，未验证）selector=' + iframeSelector)
        return { ok: true, strategy: 'iframe-legacy', selector: iframeSelector, unverified: true }
      } catch (e) {
        log.warn('RpaView', '[wechat_mp] iframe content failed: ' + (e && e.message))
      }
    }
  }

  return { ok: false, detail: 'editor-not-found' }
}

/**
 * 平台分支调用口：把「进度 + 失败文案」也收在这里，使 `rpa-view-platforms.js`
 * （逐文件行数门禁点名还账、零增长容差）只留两行接线。
 *
 * @returns {Promise<{ok: boolean, skipped?: boolean, error?: string, strategy?: string}>}
 */
async function applyWechatMpContent (host, win, article) {
  const content = article && article.content
  if (!String(content == null ? '' : content).trim()) return { ok: true, skipped: true }
  try { if (host._emitProgress) host._emitProgress('wechat_mp', 'filling content...', 40) } catch (_) { /* 旁路 */ }
  const fill = await fillWechatMpContent(host, win, content)
  if (!fill.ok) {
    log.warn('RpaView', '[wechat_mp] content not injected detail=' + fill.detail + ' selector=' + (fill.selector || ''))
    return { ok: false, error: '微信公众号正文未写入编辑器，已中止保存', detail: fill.detail }
  }
  if (fill.unverified) {
    log.warn('RpaView', '[wechat_mp] content injected via unverified path strategy=' + fill.strategy)
  }
  return { ok: true, strategy: fill.strategy }
}

/**
 * 新版标题也是 ProseMirror：隐藏的 `#title` textarea 可能写不进去，补一次可信注入。
 * 编辑器不存在时跳过（不新增阻断）。
 */
async function fillWechatMpTitleEditor (host, win, title) {
  const value = String(title == null ? '' : title).trim()
  if (!value) return { ok: true, skipped: true }
  const exists = await safeExec(win, titleProbeScript(), false)
  if (exists !== true) return { ok: true, skipped: true, detail: 'no-title-editor' }
  try {
    await host._insertTextTrusted(win, value)
    log.info('RpaView', '[wechat_mp] title via title-editor trusted insert')
    return { ok: true }
  } catch (e) {
    log.warn('RpaView', '[wechat_mp] title editor fill failed: ' + (e && e.message))
    return { ok: false, detail: 'title-insert-failed' }
  }
}

module.exports = {
  fillWechatMpContent,
  applyWechatMpContent,
  fillWechatMpTitleEditor,
  CONTENT_SELECTORS,
  CONTENT_IFRAME_SELECTORS,
  TITLE_EDITOR_SELECTOR,
  MARKER,
  stripTagsLoose,
  hasHtmlTags,
  toParagraphHtml,
}
