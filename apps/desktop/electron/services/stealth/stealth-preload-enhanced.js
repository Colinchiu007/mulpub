/**
 * stealth-preload-enhanced.js — RPA 窗口增强反检测 preload（sandbox:true 兼容）
 *
 * 契约（PRD v1.1 §3.1，2026-10-14 实现期设计修正 + spike 实证）：
 *
 * **为什么必须走 executeJavaScriptInIsolatedWorld(0)**：
 * 本 preload 自身运行在 contextIsolation 的**隔离世界**（spike E4b 实证：其 window 属性与
 * navigator patch 主世界不可见——现有 stealth-preload.js 的全部 patch 因此无效）。唯一
 * 能在 document_start 前把代码送进**主世界**的通道是 sandbox preload 暴露的
 * `require('electron').webFrame.executeJavaScriptInIsolatedWorld(0, …)`（spike E5/E6
 * 实证：sandbox:true 下 webFrame 可用、注入早于页面脚本）。
 *
 * **注入顺序（评审 F1 的暴露面最小化）**：
 *   ① 首片 = 最小 navigator patch + inj-start marker（主世界）
 *   ② 逐条 evasions（每条独立 try/catch，单条失败不阻断其余）
 *   ③ 末片 = inj-done marker（主世界）
 *
 * **三态读回（主进程 webContents.executeJavaScript 读主世界）**：
 *   - 无 `__mpStealthInjStart` ⇒ 通道未通（preload 未挂 / webFrame 不可用）
 *   - `__mpStealthInjStart === 'first-failed:*'` ⇒ 首片运行但 patch 抛错
 *   - 有 start 无 `__mpStealthInjDone` ⇒ evasions 阶段有失败
 *   - start+done 齐全 ⇒ 注入成功
 *   marker 是**观测不是预防**（PRD 诚实边界）：注入缺失时页面已读原生 navigator 的
 *   损害发生在 marker 之前。
 *
 * **通道失败观测**：webFrame 整体不可用 → console.error（主进程 console-message 事件
 * 已由 rpa-view-session 捕获）。
 */
;(function () {
  'use strict'

  var INJ_START = '(function(){try{Object.defineProperty(navigator,\'webdriver\',{get:function(){return false},configurable:true});window.__mpStealthInjStart=true}catch(e){try{window.__mpStealthInjStart=\'first-failed:\'+(e&&e.message)}catch(_e){}}})()'
  var INJ_DONE = '(function(){try{window.__mpStealthInjDone=true}catch(_e){}})()'

  function logErr (msg) {
    try { console.error('[stealth-preload-enhanced] ' + msg) } catch (_e) { /* 隔离世界无 console 时静默 */ }
  }

  function getWebFrame () {
    try {
      var electron = require('electron')
      return (electron && electron.webFrame) || null
    } catch (e) {
      return null
    }
  }

  function inject (webFrame, code) {
    return webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: code }], true)
  }

  function main () {
    var webFrame = getWebFrame()
    if (!webFrame || typeof webFrame.executeJavaScriptInIsolatedWorld !== 'function') {
      logErr('webFrame unavailable in sandbox preload; stealth injection skipped')
      return
    }

    // ① 首片：最小 patch + start marker（同步调用，早于页面脚本）
    try {
      inject(webFrame, INJ_START)
    } catch (e) {
      logErr('first-slice injection failed: ' + (e && e.message))
      return
    }

    // ② 逐条 evasions（单项容错）
    var bundle
    try {
      bundle = require('./evasions-bundle.js')
    } catch (e) {
      logErr('evasions bundle require failed: ' + (e && e.message))
      bundle = null
    }
    if (bundle && bundle.evasions) {
      var names = Object.keys(bundle.evasions)
      for (var i = 0; i < names.length; i++) {
        var entry = bundle.evasions[names[i]]
        if (!entry || typeof entry.code !== 'string') continue
        try {
          inject(webFrame, entry.code)
        } catch (e) {
          logErr('evasion injection failed (' + names[i] + '): ' + (e && e.message))
        }
      }
    }

    // ③ 末片：done marker
    try {
      inject(webFrame, INJ_DONE)
    } catch (e) {
      logErr('done-slice injection failed: ' + (e && e.message))
    }
  }

  main()
})()
