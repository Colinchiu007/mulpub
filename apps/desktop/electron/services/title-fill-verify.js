'use strict'
/**
 * title-fill-verify — 标题填充的**等值回读**校验（2026-10-22）
 *
 * ## 修的是什么
 * `_fillInput` 内建的回读只判「读回值非 0」：
 *   · 读回空 ⇒ 抛错（正确）
 *   · 读回 **非空但不等于期望值** ⇒ 判成功（**漏判**）
 *
 * 真机现场（头条/西瓜上传页，`toutiao-verify-*.png`）：
 *   标题输入框里是 **`dy-small`（= 视频文件名）**，而我们的期望值是文章标题；
 *   日志只有 `filling title...`，没有任何回读痕迹 ⇒ 两种可能无法区分：
 *     (a) 我们没写进去；(b) 写进去后被平台「按文件名自动填充」覆盖。
 *
 * ## 判据
 * 填充后**按值比对**（trim 后），不一致 → 再填一次并留日志；仍不一致则只告警不失败，
 * 但把 `readback` 写进 fillReport，让上层与历史可查（**不静默**）。
 * 为什么"只告警不失败"：标题被平台改写属于平台行为，硬失败会把一次本可成功的发布判死；
 * 但必须可见，否则用户会看到文件名当标题而无人知道。
 */


/**
 * 把「第一个**可见**匹配元素」打上临时属性并返回唯一选择器。
 *
 * 为什么需要：`_fillViaDriver` 内部按 `document.querySelector(sel)` 取**第一个**匹配元素。
 * 西瓜上传页实测有**两个** `input.xigua-input`（一个隐藏副本），写第一个不影响可见框，
 * 于是「填了但页面没变」，回读永远是平台自动填的文件名。
 * 这里先挑可见的那个、打 `data-mp-title-target` 标记，用唯一选择器去填；填完清掉标记。
 * 找不到任何匹配时返回空串，调用方回退到原选择器（不改变既有行为）。
 * @param {object} win BrowserWindow
 * @param {string} sel 原始选择器
 * @returns {Promise<string>} 唯一选择器或空串
 */
async function pickVisibleTarget (win, sel) {
  const code = '(function(){'
    + 'var all=[];try{all=[].slice.call(document.querySelectorAll(' + JSON.stringify(String(sel)) + '))}catch(e){return ""}'
    + 'if(!all.length)return "";'
    + 'var vis=all.filter(function(e){return e.getClientRects().length>0 && !e.disabled});'
    + 'var t=(vis.length?vis:all)[0];'
    + 'try{[].slice.call(document.querySelectorAll("[data-mp-title-target]")).forEach(function(e){e.removeAttribute("data-mp-title-target")})}catch(e){}'
    + 't.setAttribute("data-mp-title-target","1");'
    + 'return "[data-mp-title-target=\\\"1\\\"]"'
    + '})()'
  try { return String(await win.webContents.executeJavaScript(code) || "") } catch (_e) { return "" }
}

/** 清掉临时标记（尽力而为，失败不影响主链）。 */
async function clearTarget (win) {
  try { await win.webContents.executeJavaScript('(function(){try{[].slice.call(document.querySelectorAll("[data-mp-title-target]")).forEach(function(e){e.removeAttribute("data-mp-title-target")})}catch(e){}})()') } catch (_e) { /* ignore */ }
}
/**
 * 读取元素当前值（input.value 或文本）。
 * @param {object} win BrowserWindow
 * @param {string} sel CSS 选择器
 * @returns {Promise<string>}
 */
async function readValue (win, sel) {
  const code = '(function(){var el=document.querySelector(' + JSON.stringify(String(sel)) + ');'
    + 'return el ? String(el.value !== undefined && el.value !== null ? el.value : (el.textContent || "")) : ""})()'
  try { return String(await win.webContents.executeJavaScript(code) || "") } catch (_e) { return "" }
}

/**
 * 填标题并做等值回读；不一致重填一次。
 * @param {object} ctx 提供 _fillInput 的宿主（RpaViewManager 实例）
 * @param {object} win BrowserWindow
 * @param {string} sel 目标选择器
 * @param {string} value 期望标题
 * @param {{ log?: object, platform?: string }} [opts]
 * @returns {Promise<{ ok: boolean, readback: string, retried: boolean }>}
 */
async function fillAndVerifyTitle (ctx, win, sel, value, opts) {
  const o = opts || {}
  const log = o.log
  const platform = o.platform || ""
  const want = String(value === undefined || value === null ? "" : value).trim()
  // 先挑「可见」的那个（页面可能有隐藏的同名副本），失败则回退原选择器。
  const target = (await pickVisibleTarget(win, sel)) || sel
  await ctx._fillInput(win, target, value)
  let got = (await readValue(win, target)).trim()
  let retried = false
  if (want && got !== want) {
    retried = true
    if (log && typeof log.warn === "function") {
      log.warn("RpaView", "[" + platform + "] title readback mismatch (got=\"" + got.slice(0, 40) + "\", want=\"" + want.slice(0, 40) + "\") -> refill")
    }
    try { await ctx._fillInput(win, target, value) } catch (_e) { /* 重填失败保留首次结果，由下方如实返回 */ }
    got = (await readValue(win, target)).trim()
  }
  if (want && got !== want && log && typeof log.warn === "function") {
    log.warn("RpaView", "[" + platform + "] title still mismatched after refill (got=\"" + got.slice(0, 40) + "\")")
  }
  try { await clearTarget(win) } catch (_e) { /* ignore */ }
  return { ok: true, readback: got.slice(0, 80), retried: retried }
}

module.exports = { readValue, fillAndVerifyTitle, pickVisibleTarget }
