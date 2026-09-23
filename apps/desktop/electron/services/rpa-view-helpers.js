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
    return await win.webContents.executeJavaScript('(function(){var _fn=new Function("return " + ' + JSON.stringify(resolveJs) + ');let el=_fn();if(!el)throw new Error("input not found");if(el.getAttribute("contenteditable")==="true"){try{el.focus();var _r=document.createRange();_r.selectNodeContents(el);var _s=window.getSelection();_s.removeAllRanges();_s.addRange(_r);document.execCommand("delete");document.execCommand("insertText",false,'+sv+');el.dispatchEvent(new Event("input",{bubbles:true}));return true}catch(_e){let tmp=document.createElement("div");tmp.innerHTML='+sv+';tmp.querySelectorAll("script, iframe, object, embed").forEach(function(n){n.remove()});tmp.querySelectorAll("*").forEach(function(n){[].forEach.call(n.attributes,function(a){if(a.name.toLowerCase().indexOf("on")===0)n.removeAttribute(a.name)})});el.innerHTML=tmp.innerHTML;el.dispatchEvent(new Event("input",{bubbles:true}));return true}}let ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")?.set||Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value")?.set;if(ns)ns.call(el,'+sv+');else el.value='+sv+';el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return true})()')
  },
  async _click(win, sel) {
    const resolveJs = buildResolveElementCode(sel)
    return await win.webContents.executeJavaScript('(function(){let el=(function(){return ' + resolveJs + '})() ;if(!el)throw new Error("not found: "+' + JSON.stringify(sel) + ');el.click();return true})()')
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
      log.info('RpaView','CDP file: '+path.basename(filePath)); return true
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
