'use strict'

/**
 * 头条 CSRF 令牌抓取（2026-10-24 抓包实证）
 *
 * 背景：
 * - 平台写请求带 `x-secsdk-csrf-token`（92 字符），由 secsdk 运行时生成；
 * - 该值**不在 cookie、不在 localStorage/sessionStorage**（已逐一比对长度，零命中）；
 * - 我方 API 链此前用 `x-csrf-token`（猜的）⇒ 平台恒定回 "missing csrf token"。
 *
 * 做法：用账号自己的 persist 分区开一个**隐藏窗口**，打开头条创作页，
 * 监听它自己发出的任意请求，从请求头里把 `x-secsdk-csrf-token` 取出来。
 * 只返回值，不打印值（令牌纪律：日志/文档/提交里不得出现令牌明文）。
 */

/**
 * @param {string} accountId 账号 id（决定 persist 分区）
 * @param {{log?: object, timeoutMs?: number, url?: string}} [opts]
 * @returns {Promise<string>} 令牌；抓不到返回空串（调用方自行降级）
 */
async function grabToutiaoCsrf (accountId, opts) {
  const o = opts || {}
  const log = o.log
  const timeoutMs = Number(o.timeoutMs) || 25000
  const url = o.url || 'https://mp.toutiao.com/profile_v4/xigua/upload-video'
  if (!accountId) return ''

  let BrowserWindow
  let session
  try {
    const electron = require('electron')
    BrowserWindow = electron.BrowserWindow
    session = electron.session
  } catch (e) {
    if (log) log.warn('RpaView', 'grabToutiaoCsrf: electron unavailable')
    return ''
  }
  if (!BrowserWindow || !session) return ''

  let win = null
  let dbg = null
  let token = ''
  try {
    const ses = session.fromPartition('persist:account-' + accountId)
    win = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false },
    })
    dbg = win.webContents.debugger
    if (!dbg.isAttached()) dbg.attach('1.3')
    dbg.on('message', function (_evt, method, params) {
      if (method !== 'Network.requestWillBeSent' || token) return
      const hs = (params && params.request && params.request.headers) || {}
      const v = hs['x-secsdk-csrf-token']
      if (v) token = String(v)
    })
    await dbg.sendCommand('Network.enable')
    // 隐藏窗口自己导航（失败不阻塞：只要页面发出任意请求就能拿到头）
    win.loadURL(url).catch(function () {})
    const deadline = Date.now() + timeoutMs
    while (!token && Date.now() < deadline) {
      await new Promise(function (r) { setTimeout(r, 1000) })
    }
    if (log) {
      log.info('RpaView', 'grabToutiaoCsrf: ' + (token ? 'ok len=' + token.length : 'not-found within ' + timeoutMs + 'ms'))
    }
  } catch (e) {
    if (log) log.warn('RpaView', 'grabToutiaoCsrf failed: ' + String((e && e.message) || '').slice(0, 80))
  } finally {
    try { if (dbg) dbg.detach() } catch (_e1) {}
    try { if (win && !win.isDestroyed()) win.destroy() } catch (_e2) {}
  }
  return token
}

module.exports = { grabToutiaoCsrf }
