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

    // ② 主世界还原补丁：**只应用实测确认与真实 Chrome 不一致的项**（2026-10-15 收敛）
    //
    // ⛔ 本段原先是"无条件遍历 evasions-bundle 的全部 7 条"。那个 bundle 是第三方插件
    //    （puppeteer-extra-plugin-stealth@2.11.2）的逐字提取快照，它描述的是"通用自动化规避清单"，
    //    **不是**"本应用与真实 Chrome 的差异清单"。两者不是一回事——照抄前者会把"本来正常的项"
    //    主动改坏。同机真机对照（Electron 43.7.7 vs Chrome 155，同 GPU、同时段；raw 产物见
    //    01-docs/evidence/zhihu-stealth-mainworld-2026-10-15/）逐项实测后，那 7 条全部不成立：
    //      navigator.webdriver   两边都是 false ⇒ 无可修
    //      chrome.runtime        真实 Chrome 的普通网页上**也是 undefined** ⇒ 凭空造反而自曝
    //      navigator.plugins     Electron 已是与 Chrome **逐字相同的 5 项**；换成含 Native Client 的
    //                            假列表（现代 Chrome 早已移除 Native Client）比原状更明显
    //      navigator.languages   只改 JS 读数会与请求头 Accept-Language 不一致 ⇒ 制造新破绽
    //      iframe.contentWindow  对照中未见差异 ⇒ 无实测依据
    //      window.outerdimensions Chrome 无头态报 0/0，**不可比** ⇒ 无实测依据
    //      navigator.permissions 方向对、取值错（vendored 默认按"已授权"写），且与下方实测清单
    //                            会打架 ⇒ 统一交给实测清单接管
    //    ⇒ 全部停用。**停用不是删代码**：vendored bundle 仍作为哈希快照留在仓里（evasions.test.js
    //      锁它），只是不再被应用；将来若要重新评估某一条，必须补同机对照证据。
    var DISABLED_VENDORED_EVASIONS = [
      'navigator.webdriver', 'chrome.runtime', 'navigator.plugins', 'navigator.languages',
      'iframe.contentWindow', 'window.outerdimensions', 'navigator.permissions'
    ]
    if (DISABLED_VENDORED_EVASIONS.length > 0) {
      logErr('vendored evasions disabled by measurement (' + DISABLED_VENDORED_EVASIONS.length + '): ' +
        DISABLED_VENDORED_EVASIONS.join(','))
    }

    // 实测清单（单一真源：electron/stealth/evasions.js，与浏览/账号标签的 monitor-preload 共用同一份，
    // 避免两条承载各写一套取值）。本文件经 esbuild 打包，故这里的相对 require 会被内联——
    // sandbox preload 直接 require 相对路径文件是**失败**的（真机实测 module not found）。
    try {
      var measured = require('../../stealth')
      var measuredSource = measured.buildEvasionSource()
      if (typeof measuredSource === 'string' && measuredSource) {
        inject(webFrame, measuredSource)
      } else {
        logErr('measured evasion source empty; main-world evasion skipped')
      }
    } catch (e) {
      // fail-open：反检测是旁路，绝不能连带毁掉发布流程（与本文件既有的逐项容错同因）
      logErr('measured evasion source unavailable: ' + (e && e.message))
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
