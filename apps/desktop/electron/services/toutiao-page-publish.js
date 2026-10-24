'use strict'

/**
 * 头条「页面内执行 API 请求」（2026-10-24 实证）
 *
 * 背景（PRD 8.31 / Round 164 抓包）：
 * - 我方从主进程直接 POST `/xigua/api/upload/PublishVideo`，即使带上了
 *   `x-secsdk-csrf-token`（92 字符、头名正确）仍被拒：
 *   `403 {"code":403,"msg":"missing csrf token"}`
 * - ⇒ 该令牌是 secsdk 针对**单次请求**签名的，不能跨进程复用。
 * - 竞品的逆向文档只列端点、不写 CSRF 处理，推断他们同样让请求跑在页面里。
 *
 * 做法：用账号 persist 分区开隐藏窗口打开创作页（secsdk 在此初始化），
 * 在页面上下文里 fetch 同一个端点、同一个 JSON body —— 由页面 secsdk 自动签名。
 * 返回 { status, body }，不含任何令牌明文。
 */

const PAGE_URL = 'https://mp.toutiao.com/profile_v4/xigua/upload-video'

function sleep (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

/**
 * @param {string} accountId
 * @param {string} path 例如 '/xigua/api/upload/PublishVideo'
 * @param {string} bodyJson 已序列化的 JSON 字符串
 * @param {{log?: object, timeoutMs?: number}} [opts]
 * @returns {Promise<{status:number, body:string}|null>}
 */
async function publishViaPage (accountId, path, bodyJson, opts) {
  const o = opts || {}
  const log = o.log
  if (!accountId || !path) return null
  let BrowserWindow
  let session
  try {
    const electron = require('electron')
    BrowserWindow = electron.BrowserWindow
    session = electron.session
  } catch (e) { return null }

  let win = null
  try {
    const ses = session.fromPartition('persist:account-' + accountId)
    win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false },
    })
    await win.loadURL(PAGE_URL)
    // 等 secsdk 初始化（页面自身的请求会带 csrf 头是初始化完成的标志，这里给固定等待）
    await sleep(Number(o.warmupMs) || 15000) // 2026-10-24：5s 时页面 secsdk 尚未完成签名初始化（实测 403 invalid csrf token）
    // xhr-first（2026-10-24）：字节 secsdk 主要拦 XMLHttpRequest；用 fetch 时头没被签名 ⇒ 403 invalid csrf token。
    const code = '(function(){return new Promise(function(resolve){try{' +
      'var x=new XMLHttpRequest();x.open("POST",' + JSON.stringify(path) + ',true);' +
      'x.withCredentials=true;x.setRequestHeader("Content-Type","application/json");' +
      'x.setRequestHeader("Accept","application/json");' +
      'x.onload=function(){resolve(JSON.stringify({status:x.status,body:String(x.responseText||"").slice(0,2000)}))};' +
      'x.onerror=function(){resolve(JSON.stringify({status:0,body:"XHR_ERROR"}))};' +
      'x.send(' + JSON.stringify(bodyJson) + ')' +
      '}catch(e){resolve(JSON.stringify({status:0,body:"ERR:"+e.message}))}}})})()'
    const raw = await win.webContents.executeJavaScript(code, true)
    const out = JSON.parse(String(raw))
    if (log) log.info('RpaView', 'toutiao page-publish status=' + out.status)
    return out
  } catch (e) {
    if (log) log.warn('RpaView', 'toutiao page-publish failed: ' + String((e && e.message) || '').slice(0, 80))
    return null
  } finally {
    try { if (win && !win.isDestroyed()) win.destroy() } catch (_e) {}
  }
}

module.exports = { publishViaPage }
