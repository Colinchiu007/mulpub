'use strict'

/**
 * 头条「页面内执行 API 请求」（2026-10-24 实证）
 *
 * 背景（PRD 8.31 / 8.35）：
 * - 主进程直接 POST /xigua/api/upload/PublishVideo 会 403：
 *   抓包显示真实请求带 ?msToken=…&a_bogus=… 与 x-secsdk-csrf-token，
 *   这些由页面 secsdk 在 XHR 层注入，跨进程无法复用。
 * - ⇒ 请求必须跑在真实的西瓜发布页里（secsdk 已初始化）。
 *
 * 两种用法：
 *   1) 传入 opts.webContents（推荐）：复用 RPA 已打开的真实发布页，零预热、签名可用。
 *   2) 不传：新开隐藏窗口打开发布页并预热（历史实现，secsdk 初始化常不完整，易 403）。
 */

const PAGE_URL = 'https://mp.toutiao.com/profile_v4/xigua/upload-video'

function sleep (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

async function publishViaPage (accountId, path, bodyJson, opts) {
  const o = opts || {}
  const log = o.log
  if (!accountId || !path) return null

  const reuse = o.webContents || (o.win && o.win.webContents) || null

  let BrowserWindow
  let session
  try {
    const electron = require('electron')
    BrowserWindow = electron.BrowserWindow
    session = electron.session
  } catch (e) { return null }

  let win = null
  try {
    if (!reuse) {
      const ses = session.fromPartition('persist:account-' + accountId)
      win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 900,
        webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false },
      })
      await win.loadURL(PAGE_URL)
      await sleep(Number(o.warmupMs) || 15000)
    }

    const code = '(function(){return new Promise(function(resolve){try{' +
      'var x=new XMLHttpRequest();x.open("POST",' + JSON.stringify(path) + ',true);' +
      'x.withCredentials=true;x.setRequestHeader("Content-Type","application/json");' +
      'x.setRequestHeader("Accept","application/json");' +
      'x.onload=function(){resolve(JSON.stringify({status:x.status,body:String(x.responseText||"").slice(0,2000)}))};' +
      'x.onerror=function(){resolve(JSON.stringify({status:0,body:"XHR_ERROR"}))};' +
      'x.send(' + JSON.stringify(bodyJson) + ')' +
      '}catch(e){resolve(JSON.stringify({status:0,body:"ERR:"+e.message}))}}})})()'

    const wc = reuse || win.webContents
    const raw = await wc.executeJavaScript(code, true)
    const out = JSON.parse(String(raw))
    if (log) log.info('RpaView', 'toutiao page-publish status=' + out.status + (reuse ? ' (reused page)' : ' (new window)'))
    return out
  } catch (e) {
    if (log) log.warn('RpaView', 'toutiao page-publish failed: ' + String((e && e.message) || '').slice(0, 80))
    return null
  } finally {
    try { if (win && !win.isDestroyed()) win.destroy() } catch (_e) {}
  }
}

module.exports = { publishViaPage }
