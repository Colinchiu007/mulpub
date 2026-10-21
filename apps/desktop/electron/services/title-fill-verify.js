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
  await ctx._fillInput(win, sel, value)
  let got = (await readValue(win, sel)).trim()
  let retried = false
  if (want && got !== want) {
    retried = true
    if (log && typeof log.warn === "function") {
      log.warn("RpaView", "[" + platform + "] title readback mismatch (got=\"" + got.slice(0, 40) + "\", want=\"" + want.slice(0, 40) + "\") -> refill")
    }
    try { await ctx._fillInput(win, sel, value) } catch (_e) { /* 重填失败保留首次结果，由下方如实返回 */ }
    got = (await readValue(win, sel)).trim()
  }
  if (want && got !== want && log && typeof log.warn === "function") {
    log.warn("RpaView", "[" + platform + "] title still mismatched after refill (got=\"" + got.slice(0, 40) + "\")")
  }
  return { ok: true, readback: got.slice(0, 80), retried: retried }
}

module.exports = { readValue, fillAndVerifyTitle }
