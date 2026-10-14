// @ts-check
/**
 * RpaViewManager helpers mixin — DOM 操作与等待工具
 *
 * 拆分自 rpa-view-manager.js (2026-07-16 架构重构)
 * 通过 Object.assign 注入 RpaViewManager.prototype，方法内通过 this.* 访问
 * 其他 mixin 提供的方法。
 *
 * 依赖：fs / path / log（模块级 _guessMimeType 函数被 _setFileInputViaJs 使用）
 */
const fs = require('fs')
const path = require('path')
const log = require('./logger')
const { buildResolveElementCode } = require('./rpa-selector-utils')
// B1（oss-b1-rpa-hardening）：行为层引擎 + CDP 传输 + 隔离世界求值通道
const { planClickSequence, planType } = require('./stealth/behavior-engine')
const { createCdpInput } = require('./stealth/cdp-input')
const { createIsolatedEvaluator } = require('./stealth/isolated-world')

/**
 * 行为层逐字打字阈值（PRD §3.2 节拍耗时预算）：超过此长度的填值直接走原生
 * value-set（setter + input/change 合成）——逐字节拍按 ~30-120ms/键估算，
 * 40 字符 ≈ 5s 均值 / 7.5s 最坏；content/digest 等长文本自然走原生路径。
 * 环境开关 MP_RPA_DRIVER=native 可整体关闭行为层（排障回退通道）。
 */
const BEHAVIOR_TYPE_MAX_CHARS = 40

/**
 * per-webContents 隔离世界求值器缓存（evaluator 内部另有模块级 WeakMap 缓存
 * contextId；导航失效由 isolated-world 自身的 did-navigate 监听处理）。
 * @type {WeakMap<object, (code: string) => Promise<any>>}
 */
const _isoEvaluators = new WeakMap()

/**
 * 行为层驱动开关（env 纪律）：behavior（默认，走行为层 + isolated 通道）|
 * native（整体回退旧行为：原生合成 click / value-set）。非法值回落默认
 * 并**出声告警**——静默吞掉会让排障者以为行为层生效而实际没有。
 * @returns {'behavior'|'native'}
 */
function resolveRpaDriver () {
  const raw = process.env.MP_RPA_DRIVER
  if (raw == null || raw === '') return 'behavior'
  const v = String(raw).trim().toLowerCase()
  if (v === 'behavior' || v === 'native') return v
  log.warn('RpaView', 'MP_RPA_DRIVER 非法值 "' + String(raw).slice(0, 20) + '"，回落默认 behavior')
  return 'behavior'
}

// session.webRequest.onCompleted 是「会话级单例」拦截器：同一 session 后一次注册会
// 直接覆盖前一次，且前一次的 cleanup 会把它置 null。并发调用 _waitForResponse 时，
// 表现为先发起的那次永远等不到回调（只能靠超时兜底）。用 WeakMap 按 session 串行化。
const _responseWaitChains = new WeakMap()

// PRD F10.8: 文件 MIME 类型推断（JS File API 回退用）
function _guessMimeType (fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    pdf: 'application/pdf', txt: 'text/plain', json: 'application/json',
  }
  return map[ext] || 'application/octet-stream'
}

function _sanitizeCaptureEndpoint (url) {
  try {
    const parsed = new URL(String(url || ''))
    return parsed.origin + parsed.pathname
  } catch (_) {
    return ''
  }
}

const helpersMixin = {
  // ========== P2-D: Execute JavaScript in iframe context ==========
  async _execInFrame(win, frameSelector, jsCode) {
    const fs = JSON.stringify(frameSelector)
    return await win.webContents.executeJavaScript([
      '(function() {',
      '  let frame = document.querySelector(' + fs + ');',
      '  if (!frame) throw new Error("iframe not found");',
      '  let doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);',
      '  if (!doc) throw new Error("iframe cross-origin");',
      '  return (function() { ' + jsCode + ' }).call(doc);',
      '})()',
    ].join('\n'))
  },

  // ========== P2-D: Fill content inside iframe ==========
  async _fillInFrame(win, frameSelector, innerSelector, content) {
    // eslint-disable-next-line no-unused-vars
    const fs = JSON.stringify(frameSelector)
    const is_ = JSON.stringify(innerSelector)
    const sc = JSON.stringify(content)
    // 安全修复（2026-07-16）：iframe 内 innerHTML 也需净化，移除 script/on*= 事件
    return await this._execInFrame(win, frameSelector, [
      'let el = document.querySelector(' + is_ + ');',
      'if (!el) throw new Error("element not found in iframe");',
      'if (el.getAttribute("contenteditable") === "true") {',
      '  let tmp = document.createElement("div");',
      '  tmp.innerHTML = ' + sc + ';',
      '  tmp.querySelectorAll("script, iframe, object, embed").forEach(function(n){n.remove()});',
      '  tmp.querySelectorAll("*").forEach(function(n){[].forEach.call(n.attributes, function(a){if(a.name.toLowerCase().indexOf("on")===0)n.removeAttribute(a.name)})});',
      '  el.innerHTML = tmp.innerHTML;',
      '} else {',
      '  el.value = ' + sc + ';',
      '}',
      'el.dispatchEvent(new Event("input", { bubbles: true }));',
      'el.dispatchEvent(new Event("change", { bubbles: true }));',
      'return true;',
    ].join(' '))
  },

  // ========== 安全 DOM 操作 helper ==========
  /**
   * 安全设置元素 innerHTML 或 value — 统一用 JSON.stringify 转义参数
   * 避免 3 处重复的字符串拼接模式，确保内容中的引号/特殊字符被正确转义
   * 安全修复（2026-07-16）：innerHTML 模式下添加 HTML 净化，移除 <script>/<iframe>/on*= 事件处理器
   * @param {BrowserWindow} win
   * @param {string} selector - CSS 选择器
   * @param {string} content - 要设置的内容
   * @param {object} [opts] - { useInnerHTML: true 默认, dispatchEvents: true 默认 }
   */
  async _setElementContentSafe(win, selector, content, opts) {
    const useInnerHTML = !opts || opts.useInnerHTML !== false
    const dispatchEvents = !opts || opts.dispatchEvents !== false
    const sel = JSON.stringify(selector)
    const ct = JSON.stringify(content)
    const lines = [
      'let el = document.querySelector(' + sel + ');',
      'if (!el) return false;',
    ]
    if (useInnerHTML) {
      // 净化 HTML：移除 script/iframe/object/embed，移除所有 on*= 事件属性
      lines.push(
        'let tmp = document.createElement("div");',
        'tmp.innerHTML = ' + ct + ';',
        'tmp.querySelectorAll("script, iframe, object, embed, link[rel=import]").forEach(function(n){n.remove()});',
        'tmp.querySelectorAll("*").forEach(function(n){' +
          '[].forEach.call(n.attributes, function(a){ if(a.name.toLowerCase().indexOf("on")===0) n.removeAttribute(a.name) });' +
        '});',
        'el.innerHTML = tmp.innerHTML;'
      )
    } else {
      lines.push('el.value = ' + ct + ';')
    }
    if (dispatchEvents) {
      lines.push('el.dispatchEvent(new Event("input", { bubbles: true }));')
      lines.push('el.dispatchEvent(new Event("change", { bubbles: true }));')
    }
    lines.push('return true;')
    return await win.webContents.executeJavaScript('(function(){' + lines.join(' ') + '})()')
  },

  // ========== executeJavaScript utilities ==========
  async _waitForElement(win, sel, timeout) {
    timeout = timeout||30000
    const resolveJs = buildResolveElementCode(sel)
    let _curUrl = ''
    try { _curUrl = win.webContents.getURL() } catch (_) { /* 窗口可能已销毁 */ }
    // eslint-disable-next-line no-unused-vars
    try {
      const found = await win.webContents.executeJavaScript('(function(){var _fn=new Function("return " + ' + JSON.stringify(resolveJs) + ');return new Promise(function(r){let e=_fn();if(e){r(true);return}let o=new MutationObserver(function(){let f=_fn();if(f){o.disconnect();r(true)}});o.observe(document.body,{childList:true,subtree:true});setTimeout(function(){o.disconnect();r(false)},'+timeout+')})})()')
      // 审查修复：降为 info——重试窗口内的正常超时很常见，warn 会刷屏；
      // 真正的失败由调用方（publish 出口/平台分支）记 warn。
      if (!found) log.info('RpaView', 'waitForElement timeout sel=' + String(sel).slice(0, 160) + ' timeoutMs=' + timeout + ' url=' + String(_curUrl).slice(0, 200))
      return found
    } catch(e) {
      log.warn('RpaView', 'waitForElement error sel=' + String(sel).slice(0, 160) + ' err=' + (e && e.message) + ' url=' + String(_curUrl).slice(0, 200))
      return false
    }
  },
  async _waitForCondition(win, fn, timeout, interval) {
    // R75 防护：fn 必须是硬编码函数字面量字符串，禁止拼接用户输入
    if (typeof fn !== 'string' || fn.length === 0) return false
    timeout=timeout||30000; interval=interval||500
    // eslint-disable-next-line no-unused-vars
    try { return await win.webContents.executeJavaScript('(function(){let c='+fn+';return new Promise(function(r){if(c()){r(true);return}let ch=setInterval(function(){if(c()){clearInterval(ch);clearTimeout(t);r(true)}},'+interval+');let t=setTimeout(function(){clearInterval(ch);r(false)},'+timeout+')})})()') } catch(e) { return false }
  },
  // 安全修复（2026-07-16）：condition-based-waiting helper，替代硬编码 setTimeout 纯等待
  // 轮询条件函数直到满足或超时，避免 waitForTimeout 反模式
  async _waitForFn(win, fn, timeout, interval) {
    if (typeof fn !== 'string' || fn.length === 0) return false
    timeout = timeout || 3000; interval = interval || 300
    return await this._waitForCondition(win, fn, timeout, interval)
  },
  // 统一的 sleep helper（标记需要后续改为 condition-based-waiting 的点）
  _sleep(ms) {
    return new Promise(function(r){const t=setTimeout(r,ms);if(t&&t.unref)t.unref()})
  },
  async _fillInput(win, sel, val) {
    const sv=JSON.stringify(val)
    const resolveJs = buildResolveElementCode(sel)
    // 安全修复（2026-07-16）：contenteditable 元素 innerHTML 净化，移除 script/on*= 事件
    // 2026-09-29 Illegal invocation 修复：value setter 必须按元素 tagName 选原型——
    // 旧写法「Input 原型?.set || Textarea 原型?.set」两个 descriptor 都存在、恒取 Input 的，
    // 对 TEXTAREA（公众号 v2 编辑器 #title 实测）调用 Input 原型 setter 直接抛 Illegal invocation。
    // 2026-09-30 读回校验：本函数此前**无论是否生效都返回 true**，导致「填充未生效」被当成成功
    // （头条实测：走完整个流程后页面「共 0 字」，而日志毫无异常）。现在返回**页面真实读回长度**，
    // 由调用方据此判定；读回为 0 且待填值非空时打印告警（判据落在页面值上，不落在返回值上）。
    // B1 行为层接线（tasks 3.4）：短文本走行为层（focus+全选 → planType 节拍逐字
    // insertText 走真实输入管线 → change 兜底 + 读回）；超阈值/行为层失败一律回落
    // 原生 value-set 并**出声告警**（静默回落会让排障者误判行为层已生效）。
    const driver = resolveRpaDriver()
    const text = String(val == null ? '' : val)
    let r = null
    let usedBehavior = false
    if (driver === 'behavior' && text.length > 0 && text.length <= BEHAVIOR_TYPE_MAX_CHARS) {
      r = await this._behaviorFill(win, sel, val)
      usedBehavior = r != null
      if (!usedBehavior) log.warn('RpaView', '[fillInput] 行为层填值失败，回落原生 value-set sel=' + String(sel).slice(0, 70))
    } else if (driver === 'behavior' && text.length > BEHAVIOR_TYPE_MAX_CHARS) {
      log.warn('RpaView', '[fillInput] 文本超行为层阈值(' + BEHAVIOR_TYPE_MAX_CHARS + ')，走原生 value-set len=' + text.length + ' sel=' + String(sel).slice(0, 70))
    }
    if (!usedBehavior) {
      r = await this._isoEval(win, '(function(){var _fn=new Function("return " + ' + JSON.stringify(resolveJs) + ');let el=_fn();if(!el)throw new Error("input not found");var _ce=el.getAttribute("contenteditable")==="true";if(_ce){try{el.focus();var _r=document.createRange();_r.selectNodeContents(el);var _s=window.getSelection();_s.removeAllRanges();_s.addRange(_r);document.execCommand("delete");document.execCommand("insertText",false,'+sv+');el.dispatchEvent(new Event("input",{bubbles:true}))}catch(_e){let tmp=document.createElement("div");tmp.innerHTML='+sv+';tmp.querySelectorAll("script, iframe, object, embed").forEach(function(n){n.remove()});tmp.querySelectorAll("*").forEach(function(n){[].forEach.call(n.attributes,function(a){if(a.name.toLowerCase().indexOf("on")===0)n.removeAttribute(a.name)})});el.innerHTML=tmp.innerHTML;el.dispatchEvent(new Event("input",{bubbles:true}))}}else{var _proto=el.tagName==="TEXTAREA"?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;let ns=Object.getOwnPropertyDescriptor(_proto,"value")?.set;if(ns)ns.call(el,'+sv+');else el.value='+sv+';el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}))}var _rb=_ce?String(el.innerText||"").replace(/\\s+/g,"").length:String(el.value||"").length;return {ok:true,readBack:_rb,ce:_ce}})()')
    }
    const readBack = r && typeof r.readBack === 'number' ? r.readBack : -1
    // 2026-09-30 外审 finding #2：读回校验**内建**于此（此前调用点忽略返回值并无条件 markDone，
    // 导致「填充未生效」照样进发布）。读回 0 且待填值非空即**抛错**，由调用方 catch 走重试。
    // （`readBack === -1` 表示元素缺失/取值异常，由上方 `input not found` 等路径另行处理，不在此判负。）
    if (readBack === 0 && String(val == null ? '' : val).trim().length > 0) {
      log.warn('RpaView', '[fillInput] 读回为空（填充未生效）sel=' + String(sel).slice(0, 70))
      throw new Error('fill not applied (readback=0): ' + String(sel).slice(0, 50))
    }
    return readBack
  },
  async _click(win, sel) {
    const resolveJs = buildResolveElementCode(sel)
    // B1 行为层接线（tasks 3.4）：默认走行为层（getBounds → planClickSequence →
    // CDP 可信事件 + 9 字段合成事件），行为层失败/MP_RPA_DRIVER=native 回落
    // 原生合成 click——经 isolated 通道执行（tasks 4.3），失败 warn 出声。
    const driver = resolveRpaDriver()
    let d = null
    if (driver === 'behavior') {
      d = await this._behaviorClick(win, sel)
      if (d == null) log.warn('RpaView', '[click] 行为层失败，回落原生合成 click sel=' + String(sel).slice(0, 60))
    }
    if (d == null) {
      d = await this._isoEval(win, '(function(){let el=(function(){return ' + resolveJs + '})() ;if(!el)throw new Error("not found: "+' + JSON.stringify(sel) + ');var d=el.tagName+"|"+String(el.className||"").slice(0,26)+"|"+String(el.innerText||"").replace(/\\s+/g,"").slice(0,10);el.click();return d})()')
    }
    // 2026-10-01：点击后等一拍再回读业务探针（onClick/doPublish 记录），判断异步流程走到哪一步。
    await this._sleep(2500)
    const oc = await this._probeClickState(win)
    log.info('RpaView', '[click] ' + String(sel).slice(0, 36) + ' -> ' + String(d).slice(0, 70) + ' probe=' + String(oc).slice(0, 220)); return true
  },

  // ========== B1（oss-b1-rpa-hardening）：isolated 通道与行为层执行 ==========

  /**
   * 隔离世界求值通道（tasks 4.3）：per-webContents 复用 createIsolatedEvaluator
   * （内部另做 contextId 缓存 + 导航失效 + 探活）。isolated 与主世界回落**都**
   * 失败时（top-frame isolated v1 不覆盖 iframe 内部——iframe 元素由
   * _execInFrame 路径负责；或选择器本身无命中），点名排障方向后 rethrow，
   * 语义与旧 executeJavaScript 裸调一致（失败即抛，由调用方 catch）。
   */
  _isoEval(win, code) {
    const wc = win.webContents
    let fn = _isoEvaluators.get(wc)
    if (!fn) {
      fn = createIsolatedEvaluator(wc, { logger: log })
      _isoEvaluators.set(wc, fn)
    }
    return fn(code).catch((e) => {
      log.warn('RpaView', '[isoEval] 主世界回落仍失败（top-frame isolated v1 不覆盖 iframe 内部，或选择器无命中）: ' + (e && e.message))
      throw e
    })
  },

  /**
   * 行为层点击（B1 F1-a/b，tasks 3.4）：getBounds → planClickSequence（贝塞尔
   * 接近 + 异种子异节拍）→ performClickSequence（CDP 可信 mouse 事件 + 9 字段
   * 合成事件）。返回描述串（供 _click 日志）；元素未命中/行为层异常返回 null，
   * 由调用方回落原生合成 click（不直接抛——行为层是增强，不是硬依赖）。
   */
  async _behaviorClick(win, sel) {
    try {
      const input = createCdpInput(win)
      const bounds = await input.getBounds(sel)
      if (!bounds) return null
      const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
      const seq = planClickSequence(bounds.x, bounds.y, { seed })
      await input.performClickSequence(seq)
      const d = 'BEHAVIOR@' + Math.round(bounds.x) + ',' + Math.round(bounds.y)
      log.info('RpaView', '[clickBehavior] ' + String(sel).slice(0, 28) + ' -> ' + d)
      return d
    } catch (e) {
      log.warn('RpaView', '[clickBehavior] 行为层点击失败: ' + (e && e.message) + ' sel=' + String(sel).slice(0, 50))
      return null
    }
  },

  /**
   * 点击后业务探针（tasks 4.4 范围声明：**留主世界**）：window.__ocLog/__dpLog/
   * __appReq 是页面侧 JS 挂载状态——spike 实证隔离世界 window 属性相互隔离，
   * 迁过去读到的恒 undefined（死探针）。此方法是迁移清单的显式豁免项，
   * 由结构锁（rpa-view-helpers.test.js）钉住其 executeJavaScript + __ocLog 同在。
   */
  async _probeClickState(win) {
    return await win.webContents.executeJavaScript('(function(){try{return JSON.stringify({ocLog:(window.__ocLog||[]).slice(-2),dpLog:(window.__dpLog||[]).slice(-4),appReq:(window.__appReq||[]).filter(function(x){return /publish|article/i.test(x)}).slice(-4),appReqN:(window.__appReq||[]).length})}catch(e){return "{}"}})()').catch(() => '{}')
  },

  /**
   * 行为层填值（B1 F1-a/b，tasks 3.4）：① focus + 全选（帧级状态，两世界一致，
   * 经 isolated 通道）→ ② planType 节拍逐字 typeText（CDP Input.insertText 走
   * 浏览器输入管线，框架收到真实 beforeinput/input，非合成 value-set）→
   * ③ change 兜底（原生契约：原实现显式 dispatch change；真实打字的 change 在
   * blur 时才触发，此处补齐避免调用方监听 change 的分支静默收不到）+ 读回。
   * 返回 {ok, readBack, ce}；任何一步失败返回 null（调用方回落原生 value-set——
   * 注意回落是**全量 set 覆盖**，已打的一半字符会被整体替换，最终值仍正确）。
   */
  async _behaviorFill(win, sel, val) {
    const resolveJs = buildResolveElementCode(sel)
    const text = String(val == null ? '' : val)
    try {
      const focused = await this._isoEval(win, '(function(){var _fn=new Function("return " + ' + JSON.stringify(resolveJs) + ');var el=_fn();if(!el)return false;try{el.focus()}catch(e){return false};if(el.getAttribute("contenteditable")==="true"){try{var r=document.createRange();r.selectNodeContents(el);var s=window.getSelection();s.removeAllRanges();s.addRange(r)}catch(e){return false}}else if(typeof el.select==="function"){el.select()}return true})()')
      if (focused !== true) return null
      const input = createCdpInput(win)
      const plan = planType(text, { seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 })
      for (const ev of plan.events) {
        if (ev.delayMs) await this._sleep(ev.delayMs)
        const ok = await input.typeText(ev.char)
        if (!ok) return null
      }
      const rb = await this._isoEval(win, '(function(){var _fn=new Function("return " + ' + JSON.stringify(resolveJs) + ');var el=_fn();if(!el)return null;var _ce=el.getAttribute("contenteditable")==="true";try{el.dispatchEvent(new Event("change",{bubbles:true}))}catch(e){}var _rb=_ce?String(el.innerText||"").replace(/\\s+/g,"").length:String(el.value||"").length;return {ok:true,readBack:_rb,ce:_ce}})()')
      if (!rb || typeof rb.readBack !== 'number') return null
      return rb
    } catch (e) {
      log.warn('RpaView', '[fillBehavior] 行为层填值异常: ' + (e && e.message) + ' sel=' + String(sel).slice(0, 60))
      return null
    }
  },

  // 2026-10-01：CDP 真实鼠标点击前**先临时移除中心点的遮挡层** —— 头条发布按钮实测 5 个采样点
  // 全部被浮层覆盖（topHit=DIV），真实点击物理上到不了；而合成 click 又会被 onClick 闭包门控吞掉。
  async _clickViaCdp(win, sel) {
    const dbg = win.webContents.debugger
    try { await dbg.attach('1.3') } catch (_) { /* 已附加 */ }
    try {
      const expr = '(function(){var el=(function(){return ' + buildResolveElementCode(sel) + '})();if(!el)return "";'
        + 'el.scrollIntoView({block:"center"});var r=el.getBoundingClientRect();var cx=Math.round(r.left+r.width/2),cy=Math.round(r.top+r.height/2);'
        + 'var es=[];try{es=document.elementsFromPoint(cx,cy)}catch(e){}'
        + 'window.__mpPe=[];es.forEach(function(b){try{if(b!==el&&!el.contains(b)&&!b.contains(el)){window.__mpPe.push([b,b.style.pointerEvents]);b.style.pointerEvents="none"}}catch(e){}});'
        + 'return cx+","+cy})()'
      const r = await dbg.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false })
      const pos = String((r && r.result && r.result.value) || '')
      if (!pos || pos.indexOf(',') < 0) { log.warn('RpaView', '[clickTrusted] 元素未找到: ' + String(sel).slice(0, 30)); return 'NOT_FOUND' }
      const x = Number(pos.split(',')[0]); const y = Number(pos.split(',')[1])
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
      log.info('RpaView', '[clickTrusted] ' + String(sel).slice(0, 28) + ' -> TRUSTED@' + x + ',' + y)
      return 'TRUSTED_CLICK'
    } catch (e) {
      log.warn('RpaView', '[clickTrusted] ' + e.message); return null
    } finally { try { await dbg.detach() } catch (_) { /* ignore */ } }
  },

  // 2026-10-01：头条发布按钮 onClick 为 `function(e){var n=t.props,r=n.loading,o=n.onClick;!r&&o&&o(e)}` ——
  // loading 为真时点击被静默吞掉。loading 真源是 fiber 的 `memoizedProps.loading`（包装层的 `t.props.loading`），
  // 不是 `__reactEventHandlers$*` 上的同名属性；旧实现读错位置且"读不到就放行"，等于没等。点击走 CDP。
  async _clickStable(win, sel) {
    const probe = '(function(){try{var el=(function(){return ' + buildResolveElementCode(sel) + '})();if(!el)return false;'
      + 'var fk=Object.keys(el).filter(function(k){return k.indexOf("__reactInternalInstance$")===0})[0];var f=fk?el[fk]:null;'
      + 'for(var d=0;f&&d<12;d++){var mp=f.memoizedProps;if(mp&&("loading" in mp))return mp.loading!==true;f=f.return}'
      + 'return el.isConnected!==false}catch(e){return null}})()'
    const viaCdp = async () => {
      const r = await this._clickViaCdp(win, sel).catch(() => null)
      return (r && r !== 'NOT_FOUND') ? true : await this._click(win, sel)
    }
    for (let i = 0; i < 20; i++) {
      const a = await win.webContents.executeJavaScript(probe).catch(() => null)
      if (a === true) {
        await this._sleep(500)
        const b = await win.webContents.executeJavaScript(probe).catch(() => null)
        if (b === true) return await viaCdp()
      }
      await this._sleep(500)
    }
    log.warn('RpaView', '[clickStable] 按钮未就绪（可能 loading 未结束），直接点击: ' + String(sel).slice(0, 40))
    return await viaCdp()
  },

  // ========== CDP trusted text insertion ==========
  // 2026-09-29 实测（知乎写页取证，evidence 见 01-docs/PRD-ARTICLE-PUBLISH-FIX-2026-09-29.md）：
  // Draft.js/ProseMirror 类框架编辑器不接受 innerHTML 直写（框架状态为空、发布空文），
  // execCommand 合成事件也不被框架状态接受；唯一可信注入通道是 CDP Input.insertText
  // （走浏览器输入管线，框架收到真实 beforeinput/input 并入状态）。
  // 边界：本机 Electron WebContentsView 上 Input.dispatchKeyEvent 不可达（document 级
  // 监听 0 事件，2026-09-29 实测），键盘模拟一律不用；段落分隔以 \n 保留在块内
  // （contenteditable pre-wrap 渲染为换行）。调用方须先 JS focus 目标编辑器。
  async _insertTextTrusted(win, text) {
    const value = String(text == null ? '' : text)
    if (!value) return false
    const dbg = win.webContents.debugger
    // eslint-disable-next-line no-unused-vars
    try { await dbg.attach('1.3') } catch (e) { /* ignore（已附加） */ }
    try {
      await dbg.sendCommand('Input.insertText', { text: value })
      log.info('RpaView', 'CDP insertText: ' + value.length + ' chars')
      return true
    } catch (e) {
      log.warn('RpaView', 'CDP insertText failed: ' + (e && e.message))
      return false
    } finally { try { await dbg.detach() } catch (e) { /* ignore */ } }
  },

  // ========== CDP file upload ==========
  async _setFileInput(win, filePath, fileSelector) {
    fileSelector = fileSelector || 'input[type="file"]'
    if (!fs.existsSync(filePath)) throw new Error('File not found: '+filePath)
    const dbg = win.webContents.debugger
    // eslint-disable-next-line no-unused-vars
    try { await dbg.attach('1.3') } catch (e) { /* ignore */ }
    try {
      // Resolve the node through the DOM domain. Runtime.evaluate returns a
      // remote object only for the current execution context; on creator SPAs
      // that object can be released before DOM.requestNode runs. DOM.querySelector
      // keeps the lookup and file assignment in the same renderer DOM snapshot.
      await dbg.sendCommand('DOM.enable')
      const documentResult = await dbg.sendCommand('DOM.getDocument',{depth:-1,pierce:true})
      const rootNodeId = documentResult?.root?.nodeId
      if (!rootNodeId) throw new Error('DOM document unavailable')
      const queryResult = await dbg.sendCommand('DOM.querySelector',{
        nodeId: rootNodeId,
        selector: fileSelector,
      })
      if (!queryResult?.nodeId) throw new Error('No file input found')
      await dbg.sendCommand('DOM.setFileInputFiles',{
        files:[path.resolve(filePath)],
        nodeId:queryResult.nodeId,
      })
      // 注入结果校验（2026-09-30 快手实测）：部分平台（快手图文上传区）的 input 是
      // React 受控组件，CDP 的 DOM.setFileInputFiles **不抛错但文件被框架清空**
      // （实测注入后 input.files.length === 0，页面停在上传区、不进入编辑态）。
      // 语义区分（抖音实测补强）：input **已从 DOM 消失**（返回 -1）通常是页面已切到
      // 编辑态 = 上传被接受，不能判失败（否则会误触发回退，而回退也找不到 input → 抛错）；
      // 只有 input 仍在但 files 为 0 才是真静默失败，此时回退 DataTransfer 注入。
      const accepted = await win.webContents.executeJavaScript(
        '(function(){var i=document.querySelector(' + JSON.stringify(fileSelector) + ');if(!i)return -1;return i.files?i.files.length:0})()'
      ).catch(() => -1)
      if (accepted === 0) {
        log.warn('RpaView', 'CDP setFileInputFiles 静默失败（files=0），回退 DataTransfer 注入：' + path.basename(filePath))
        return await this._setFileInputViaJs(win, filePath, fileSelector)
      }
      log.info('RpaView','CDP file: '+path.basename(filePath)+' (files='+accepted+')'); return true
    // eslint-disable-next-line no-unused-vars
    } catch (cdpErr) {
      // PRD F10.8: CDP 失败时回退到 JS File API / DataTransfer
      log.warn('RpaView', 'CDP upload failed, fallback to JS File API: ' + cdpErr.message)
      return await this._setFileInputViaJs(win, filePath, fileSelector)
    } finally { try { await dbg.detach() } catch (e) { /* ignore */ } }
  },

  // PRD F10.8: JS File API 回退 — 读取文件为 Buffer，通过 DataTransfer 构造 File 并 dispatch change
  async _setFileInputViaJs(win, filePath, fileSelector) {
    fileSelector = fileSelector || 'input[type="file"]'
    const fsSync = require('fs')
    const buf = fsSync.readFileSync(filePath)
    const base64 = buf.toString('base64')
    const fileName = path.basename(filePath)
    const mimeType = _guessMimeType(fileName)
    // 在渲染进程内构造 File 并触发 input.change
    const js = '(function(){' +
      'var b64=' + JSON.stringify(base64) + ';' +
      'var name=' + JSON.stringify(fileName) + ';' +
      'var mime=' + JSON.stringify(mimeType) + ';' +
      'var bin=atob(b64);var n=bin.length;var bytes=new Uint8Array(n);' +
      'for(var i=0;i<n;i++)bytes[i]=bin.charCodeAt(i);' +
      'var file=new File([bytes],name,{type:mime});' +
      'var input=document.querySelector('+JSON.stringify(fileSelector)+');' +
      'if(!input)throw new Error("No file input found (JS fallback)");' +
      'var dt=new DataTransfer();dt.items.add(file);input.files=dt.files;' +
      'input.dispatchEvent(new Event("change",{bubbles:true}));' +
      'input.dispatchEvent(new Event("input",{bubbles:true}));' +
      'return true})()'
    await win.webContents.executeJavaScript(js)
    log.info('RpaView', 'JS File API fallback: ' + fileName)
    return true
  },

  // 拖拽区上传（2026-09-30，参考产品取证）：部分平台（快手图文）的 `input[type=file]`
  // **两条注入路径都失效**——CDP DOM.setFileInputFiles 不抛错但文件被框架清空、直接给
  // input.files 赋 DataTransfer 也立即归零（实测 files.length===0，页面停在上传区）。
  // 正确通道是把文件构造进 DataTransfer 后派发 `DragEvent('drop')` 到**拖拽容器**：
  // 实测 `#rc-tabs-0-panel-2 div[class^="_dragger-content_"]` 收到 drop 后立刻进入图文
  // 编辑态（出现 `#work-description-edit` 与「编辑图片 1/31」）。参考产品 renderImage 同款。
  // 选择器默认取**可见的** dragger-content（视频/图文 tab 各有一个，隐藏的那个不能收事件）。
  async _dropFilesToDragArea(win, filePath, dragSelector) {
    filePath = path.resolve(filePath)
    if (!fs.existsSync(filePath)) throw new Error('File not found: ' + filePath)
    const base64 = fs.readFileSync(filePath).toString('base64')
    const fileName = path.basename(filePath)
    const mimeType = _guessMimeType(fileName)
    const js = '(function(){' +
      'var sel=' + JSON.stringify(dragSelector || 'div[class*="dragger-content"]') + ';' +
      'var cands=[...document.querySelectorAll(sel)].filter(function(e){return e.getClientRects().length>0});' +
      'var w=cands[cands.length-1]||document.querySelector(sel);' +
      'if(!w)return "NO_DRAGGER";' +
      'var b64=' + JSON.stringify(base64) + ';' +
      'var bin=atob(b64);var n=bin.length;var bytes=new Uint8Array(n);' +
      'for(var i=0;i<n;i++)bytes[i]=bin.charCodeAt(i);' +
      'var file=new File([bytes],' + JSON.stringify(fileName) + ',{type:' + JSON.stringify(mimeType) + '});' +
      'var dt=new DataTransfer();dt.items.add(file);' +
      'w.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));' +
      'return "DROPPED"})()'
    const result = await win.webContents.executeJavaScript(js)
    if (result === 'DROPPED') {
      log.info('RpaView', 'drag-area drop: ' + fileName)
      return true
    }
    log.warn('RpaView', 'drag-area drop unavailable: ' + String(result))
    return false
  },

  // 发布点击后的网络证据采集。只在点击发布前短时开启，避免影响页面其它请求。
  // 原始响应体只在 parseResponseBody 回调的局部作用域内使用，禁止写入 records、日志或 IPC 结果。
  async _startPublishNetworkCapture(win, options = {}) {
    const dbg = win.webContents.debugger
    const records = []
    const evidence = []
    const responseByRequestId = new Map()
    const pendingBodies = new Set()
    const parseResponseBody = typeof options.parseResponseBody === 'function' ? options.parseResponseBody : null
    const relevant = (url) => /(?:publish|submit|create|article|content|media|video|clue|work)/i.test(url || '')
    let stopped = false
    const onMessage = async (_event, method, params) => {
      try {
        if (stopped) return
        if (method === 'Network.responseReceived' && relevant(params?.response?.url)) {
          const record = {
            endpoint: _sanitizeCaptureEndpoint(params.response.url),
            status: params.response.status,
            mimeType: String(params.response.mimeType || '').slice(0, 160),
          }
          records.push(record)
          responseByRequestId.set(params.requestId, record)
        }
        if (method !== 'Network.loadingFinished') return
        const response = responseByRequestId.get(params.requestId)
        if (!response || !parseResponseBody) return
        const bodyPromise = dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId })
          .then(async result => {
            const body = result?.base64Encoded
              ? Buffer.from(result.body || '', 'base64').toString('utf8')
              : String(result?.body || '')
            const parsedEvidence = await parseResponseBody(body.slice(0, 200 * 1024), { ...response })
            if (parsedEvidence && typeof parsedEvidence === 'object') evidence.push(parsedEvidence)
          })
          .catch(() => {})
        pendingBodies.add(bodyPromise)
        await bodyPromise
        pendingBodies.delete(bodyPromise)
      } catch (_) { /* 页面导航/窗口销毁时网络证据可为空 */ }
    }
    try {
      try { await dbg.attach('1.3') } catch (_) { /* 已附加时继续 */ }
      dbg.on('message', onMessage)
      await dbg.sendCommand('Network.enable')
    } catch (error) {
      try { dbg.removeListener('message', onMessage) } catch (_) { /* ignore */ }
      try { await dbg.detach() } catch (_) { /* ignore */ }
      log.warn('RpaView', 'publish network capture unavailable: ' + error.message)
      return null
    }
    return {
      records,
      evidence,
      async stop () {
        if (stopped) return records.map(record => ({ ...record }))
        stopped = true
        await Promise.allSettled([...pendingBodies])
        try { await dbg.sendCommand('Network.disable') } catch (_) { /* ignore */ }
        try { dbg.removeListener('message', onMessage) } catch (_) { /* ignore */ }
        try { await dbg.detach() } catch (_) { /* ignore */ }
        responseByRequestId.clear()
        return records.map(record => ({ ...record }))
      },
    }
  },

  // ========== Network response monitor ==========
  async _waitForResponse(win, patterns, timeout) {
    const session = win.webContents.session
    const prev = _responseWaitChains.get(session) || Promise.resolve()
    const run = prev.then(function () { return this._waitForResponseExclusive(win, patterns, timeout) }.bind(this))
    // 链上只挂「永不 reject」的尾巴，避免一次失败毒化后续所有等待者；
    // 尾巴本身即「本次已结束」信号，无需额外的 deferred（原 settledSignal 无人 await，属死代码）。
    _responseWaitChains.set(session, run.catch(function () {}))
    return run
  },

  async _waitForResponseExclusive(win, patterns, timeout) {
    timeout = timeout||60000
    const session = win.webContents.session
    return new Promise(function(resolve) {
      let settled = false
      const t = setTimeout(function(){ cleanup(); resolve(null) }, timeout)
      if (t && t.unref) t.unref()
      const matched = []
      function cleanup() {
        try { session.webRequest.onCompleted({urls:['<all_urls>']}, null) } catch(e) { /* session may be destroyed */ }
      }
      session.webRequest.onCompleted({urls:['<all_urls>']}, function(d) {
        if (settled) return
        const url = d.url||''
        let hit = false
        for (let pi=0;pi<patterns.length;pi++){if(url.includes(patterns[pi])){hit=true;break}}
        if (!hit) return
        matched.push({url:url,statusCode:d.statusCode})
        if (d.statusCode===200) { settled=true; clearTimeout(t); cleanup(); resolve({url:url,statusCode:d.statusCode,matchedUrls:matched}) }
      })
      const fallbackTimer = setTimeout(function(){ if(!settled && matched.length>0){ settled=true; cleanup(); resolve({url:matched[0].url,statusCode:matched[0].statusCode,matchedUrls:matched}) } }, timeout+1000)
      if (fallbackTimer && fallbackTimer.unref) fallbackTimer.unref()
    })
  },

  // ========== Navigation ==========
  async _navigateAndWait(win, url, stabilizeMs) {
    stabilizeMs = stabilizeMs||3000
    return new Promise(function(resolve,reject) {
      const t = setTimeout(function(){reject(new Error('nav timeout: '+url))},45000)
      if (t && t.unref) t.unref()
      // 防销毁：回调触发时窗口可能已被销毁（应用退出/任务取消），
      // 此时静默 resolve，避免 "Object has been destroyed" 未捕获异常。
      const safeResolve = function(value) { if (t && !t._called) { clearTimeout(t); t._called = true; resolve(value) } }
      const safeReject = function(err) { if (t && !t._called) { clearTimeout(t); t._called = true; reject(err) } }
      win.webContents.once('did-finish-load',function(){
        setTimeout(function(){
          if (win.isDestroyed && win.isDestroyed()) { safeResolve(undefined); return }
          const wc = win.webContents
          if (!wc || (wc.isDestroyed && wc.isDestroyed())) { safeResolve(undefined); return }
          wc.executeJavaScript('void(0)').then(safeResolve).catch(function(){ safeResolve(undefined) })
        },stabilizeMs)
      })
      win.webContents.once('did-fail-load',function(e,code,desc){log.warn('RpaView','nav failed url='+String(url).slice(0,200)+' code='+code+' desc='+desc);safeResolve(undefined)})
      // R49 修复：loadURL 返回 Promise，必须 .catch() 否则导航失败产生 unhandledRejection
      win.webContents.loadURL(url).catch(function (e) { safeReject(e) })
    })
  },
}

module.exports = helpersMixin
module.exports._guessMimeType = _guessMimeType
// B1：测试与调用方引用的阈值单一来源（改阈值必须同步 PRD §3.2 耗时预算）
module.exports.BEHAVIOR_TYPE_MAX_CHARS = BEHAVIOR_TYPE_MAX_CHARS
