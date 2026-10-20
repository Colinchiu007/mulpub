// B1（oss-b1-rpa-hardening）：RPA 行为层 mixin —— 自研节拍点击/填值 + 隔离世界求值通道
// 本模块自 rpa-view-helpers.js 拆出。拆分动因是 debt-guard「新代码阻断」门禁
// （.github/scripts/check-max-lines.js）：rpa-view-helpers.js 在 origin/main 已贴近
// 500 行上限，B1 行为层任一新增都会直接越线，故按既有 mixin 范式把整层下沉为独立
// 模块，由 rpa-view-helpers 通过 ...behaviorMixin 合入（this 指向不变，行为不变）。
// 对外另导出驱动开关与阈值常量——`_fillInput`/`_click` 的读回/探针判据仍留在
// helpers 侧，这里只负责「取值通道」本身。
const log = require('../logger')
const { buildResolveElementCode } = require('../rpa-selector-utils')
const { planClickSequence, planType } = require('./behavior-engine')
const { resolveInputDriver } = require('./input-driver')
const { createIsolatedEvaluator } = require('./isolated-world')

/**
 * 行为层逐字打字阈值（PRD §3.2 节拍耗时预算）：超过此长度的填值直接走原生
 * value-set（setter + input/change 合成）——逐字节拍按 ~30-120ms/键估算，
 * 40 字符 ≈ 5s 均值 / 7.5s 最坏；content/digest 等长文本自然走原生路径。
 * 环境开关 MP_RPA_DRIVER=native 可整体关闭行为层（排障回退通道）。
 */
const BEHAVIOR_TYPE_MAX_CHARS = 40

/**
 * per-webContents 隔离世界求值器缓存（key 为 win.webContents；evaluator 内部另做
 * contextId 缓存 + 导航失效 + 探活）。
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

const behaviorMixin = {

  // ========== isolated 通道与行为层执行 ==========

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
      const input = resolveInputDriver(win, this._sidecarEndpoint)
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
      const input = resolveInputDriver(win, this._sidecarEndpoint)
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

  /**
   * 填值主通道（B1 tasks 3.4，自 helpers._fillInput 下沉）：短文本走行为层
   * （focus+全选 → planType 节拍逐字 insertText 走真实输入管线），超阈值/行为层
   * 失败一律回落原生 value-set 并**出声告警**（静默回落会让排障者误判行为层已生效）。
   *
   * 安全修复（2026-07-16）：contenteditable 元素 innerHTML 净化，移除 script/on*= 事件
   * 2026-09-29 Illegal invocation 修复：value setter 必须按元素 tagName 选原型——
   * 旧写法「Input 原型?.set || Textarea 原型?.set」两个 descriptor 都存在、恒取 Input 的，
   * 对 TEXTAREA（公众号 v2 编辑器 #title 实测）调用 Input 原型 setter 直接抛 Illegal invocation。
   *
   * @param {Electron.WebContents} win
   * @param {string} sel
   * @param {string} val
   * @returns {Promise<{ok:boolean, readBack:number, ce:boolean}>} 页面真实读回结果
   */
  async _fillViaDriver(win, sel, val) {
    const sv = JSON.stringify(val)
    const resolveJs = buildResolveElementCode(sel)
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
    return r
  },

  /**
   * 点击主通道（B1 tasks 3.4，自 helpers._click 下沉）。分流（2026-10-20 wechat-save-click 后）：
   *   - 纯 CSS 选择器：行为层（getBounds → planClickSequence → CDP 可信事件）→ 失败回落合成 click；
   *   - 含文本谓词（`:has-text` / `text=`）：行为层必失败（DOM.querySelector 不认伪类），
   *     直接走 CDP 可信点击 → 可信通道不可用才回落合成 click。
   * 合成 click（`el.click()`）没有 isTrusted，React 版后台会静默吞掉，故只在可信通道
   * 确实不可用时才用它兜底。
   * @param {Electron.WebContents} win
   * @param {string} sel
   * @returns {Promise<string|null>} 'TRUSTED_CLICK' / 'NOT_FOUND' / 页面描述串 / null
   */
  async _clickViaDriver(win, sel) {
    const resolveJs = buildResolveElementCode(sel)
    const driver = resolveRpaDriver()
    // 2026-10-20（wechat-save-click）：文本谓词（:has-text / text=）不是合法 CSS，
    // 行为层的 getBounds 走 CDP `DOM.querySelector`，遇到它必然抛错、被 catch 吞成
    // null（连 warn 都没有，日志里只剩「行为层失败」一行）⇒ 对这类选择器行为层
    // 是**必然失败**而非可能失败，跳过这次空转。
    const hasTextPredicate = /:has-text\(/.test(String(sel)) || /^text=/.test(String(sel))
    let d = null
    if (driver === 'behavior' && !hasTextPredicate) {
      d = await this._behaviorClick(win, sel)
      if (d == null) log.warn('RpaView', '[click] 行为层失败，回落可信点击 sel=' + String(sel).slice(0, 60))
    }
    if (d == null && hasTextPredicate && driver !== 'native') {
      // 可信点击必须优先于合成 click：`el.click()` 没有 isTrusted，React 版后台
      // （公众号 appmsg_edit_v2 的「保存为草稿」）会静默吞掉——真机表现是按钮
      // 命中（tagName/文案都对）、但页面一个请求都不发（probe appReqN=0，
      // 30s 后判「缺少媒体 ID」）。这里发 CDP 真鼠标事件，让 click 带 isTrusted。
      const trusted = await this._clickViaCdp(win, sel)
      if (trusted === 'TRUSTED_CLICK') return trusted
      if (trusted === 'NOT_FOUND') {
        log.warn('RpaView', '[click] 元素未找到（含文本谓词） sel=' + String(sel).slice(0, 60))
        return 'NOT_FOUND'
      }
      // 可信通道本身不可用（debugger 冲突等）：仍回落合成 click，保持既有兜底。
    }
    if (d == null) {
      d = await this._isoEval(win, '(function(){let el=(function(){return ' + resolveJs + '})() ;if(!el)throw new Error("not found: "+' + JSON.stringify(sel) + ');var d=el.tagName+"|"+String(el.className||"").slice(0,26)+"|"+String(el.innerText||"").replace(/\\s+/g,"").slice(0,10);el.click();return d})()')
    }
    return d
  },

  /**
   * CDP 真实鼠标点击（B1 F1-c，tasks 3.4）：先 scrollIntoView 取中心点，再**临时移除
   * 中心点的遮挡层**后发可信 Input.dispatchMouseEvent。
   * 2026-10-01：头条发布按钮实测 5 个采样点全部被浮层覆盖（topHit=DIV），真实点击
   * 物理上到不了；而合成 click 又会被 onClick 闭包门控吞掉。
   *
   * 2026-10-20（wechat-save-click）两处修正：
   *   ① **owned-detach**：此前无条件 detach，他方（`_waitForResponse` 的网络取证、
   *      上传路径）已附着时会把别人的 CDP 通道拆掉。公众号保存草稿正是「先起响应监听、
   *      再点按钮」——拆掉后响应体通道直接失效。
   *   ② **遮挡层必须还原**：`window.__mpPe` 此前没有任何消费方（注释所称「页面侧还原
   *      逻辑」并不存在），一次可信点击就把被点位置的其他元素 pointerEvents 永久置
   *      none，后续「确定 / 发表」可能整片点不动。点击完成即还原。
   * @returns {Promise<string|null>} 'TRUSTED_CLICK' / 'NOT_FOUND' / null
   */
  async _clickViaCdp(win, sel) {
    const dbg = win.webContents.debugger
    let owned = false
    try {
      if (!(typeof dbg.isAttached === 'function' && dbg.isAttached())) {
        await dbg.attach('1.3')
        owned = true
      }
    } catch (_) { /* attach 被拒（他方刚附着）：复用现状，owned=false 不拆别人的会话 */ }
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
    } finally {
      // 遮挡层还原放在 detach 之前：detach 后再 evaluate 就没有通道了。
      // 他方持有时走主世界 executeJavaScript（window.__mpPe 在主世界，两世界同名属性互不影响）。
      const restore = '(function(){var a=window.__mpPe||[];a.forEach(function(p){try{p[0].style.pointerEvents=p[1]||""}catch(e){}});window.__mpPe=[];return a.length})()'
      try {
        if (owned) await dbg.sendCommand('Runtime.evaluate', { expression: restore, returnByValue: true })
        else await win.webContents.executeJavaScript(restore)
      } catch (_) { /* 还原失败不得掩盖点击结果 */ }
      if (owned) { try { await dbg.detach() } catch (_) { /* ignore */ } }
    }
  },
}

module.exports = { behaviorMixin, resolveRpaDriver, BEHAVIOR_TYPE_MAX_CHARS }
