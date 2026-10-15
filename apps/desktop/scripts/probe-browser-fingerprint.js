'use strict'
/**
 * probe-browser-fingerprint.js — 内嵌浏览器（账号标签同构）指纹验收 harness
 *
 * 定位：`probe-main-world-injection.js` 证明的是**注入通道**可用；本 harness 证明的是
 * **生产 preload 真的把指纹改成了与真实 Chrome 一致的值**——两者不能互相替代。
 *
 * 同构性：webPreferences 与 `webview-manager/tab-lifecycle.js` 的浏览/账号标签一致
 * （`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true` /
 * `backgroundThrottling:false` / preload 取生产 bundle 路径）。
 *
 * 用法（A/B 对照，必须两个都跑）：
 *   cd apps/desktop
 *   Remove-Item Env:\ELECTRON_RUN_AS_NODE    # 否则 electron 退化成纯 Node
 *   $exe = "..\node_modules\electron\dist\electron.exe"
 *   $env:MP_BROWSER_STEALTH = "0"; & $exe scripts/probe-browser-fingerprint.js   # 基线（反检测关）
 *   Remove-Item Env:\MP_BROWSER_STEALTH;     & $exe scripts/probe-browser-fingerprint.js   # 修复后
 *
 * 输出一行 `PROBE_BROWSER_FP:{...}`，与真实 Chrome 基线（同机 Chrome 155 实测）逐项对照：
 *   chromeKeys      Chrome=['loadTimes','csi','app']     Electron 修复前=[]
 *   uaDataBrands    含 'Google Chrome'                   修复前缺
 *   notificationPerm Chrome='default'                     修复前='granted'
 *   permissions     全部 'prompt'                         修复前全 'granted'
 */
const http = require('http')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { app, BrowserWindow } = require('electron')
const { resolveBundledPreloadPath } = require('../electron/core/preload-path')
const { resolveStealthEnabled } = require('../electron/stealth/inject')

const RESULT_PREFIX = 'PROBE_BROWSER_FP:'

// 与真实页面同形的采集脚本：作为**页面自身脚本**运行（不是注入脚本），
// 这样读到的是页面视角的真实值——注入若晚于页面脚本，这里就会读到未修复的值。
const COLLECTOR = `
window.__fpReady = (async function () {
  function safe (fn) { try { return fn() } catch (e) { return 'ERR:' + String(e && e.message) } }
  var out = {}
  out.userAgent = safe(function () { return navigator.userAgent })
  out.chromeKeys = safe(function () { return window.chrome ? Object.keys(window.chrome) : 'absent' })
  out.chromeAppTypeof = safe(function () { return typeof (window.chrome && window.chrome.app) })
  out.chromeCsiTypeof = safe(function () { return typeof (window.chrome && window.chrome.csi) })
  out.chromeLoadTimesTypeof = safe(function () { return typeof (window.chrome && window.chrome.loadTimes) })
  out.uaDataBrands = safe(function () { return navigator.userAgentData ? navigator.userAgentData.brands : 'absent' })
  out.uaDataMobile = safe(function () { return navigator.userAgentData ? navigator.userAgentData.mobile : 'absent' })
  out.uaDataHighEntropyBrands = await (async function () {
    try {
      if (!navigator.userAgentData || typeof navigator.userAgentData.getHighEntropyValues !== 'function') return 'absent'
      var v = await navigator.userAgentData.getHighEntropyValues(['brands', 'platform'])
      return v && v.brands ? v.brands : 'absent'
    } catch (e) { return 'ERR:' + String(e && e.message) }
  })()
  out.notificationPermission = safe(function () { return String(Notification.permission) })
  var names = ['notifications', 'geolocation', 'camera', 'microphone', 'clipboard-read']
  out.permissions = {}
  for (var i = 0; i < names.length; i++) {
    try {
      var st = await navigator.permissions.query({ name: names[i] })
      out.permissions[names[i]] = st && st.state
    } catch (e) { out.permissions[names[i]] = 'ERR:' + String(e && e.message) }
  }
  out.permissionStatusInstanceof = await (async function () {
    try {
      var st = await navigator.permissions.query({ name: 'geolocation' })
      return window.PermissionStatus ? (st instanceof window.PermissionStatus) : 'no-ctor'
    } catch (e) { return 'ERR' }
  })()
  // 注入标记（证注入可见；未开启反检测时不存在）
  out.stealthMarker = safe(function () { return window.__mpStealthInj ? { done: window.__mpStealthInj.done, version: window.__mpStealthInj.version, applied: window.__mpStealthInj.applied, failed: window.__mpStealthInj.failed } : null })
  // 隔离世界对照（恒应为 'undefined'）
  out.isoMarkerVisibleInMain = safe(function () { return typeof window.__probeIsoWorldMarker })
  // 与真实 Chrome 逐项一致的"本就正常"项——本片刻意不碰，采下来防止后人误改
  out.pluginsLength = safe(function () { return navigator.plugins.length })
  out.pluginNames = safe(function () { return Array.prototype.map.call(navigator.plugins, function (p) { return p.name }) })
  out.mimeTypesLength = safe(function () { return navigator.mimeTypes.length })
  out.webdriver = safe(function () { return String(navigator.webdriver) })
  out.vendor = safe(function () { return navigator.vendor })
  out.chromeRuntimeTypeof = safe(function () { return typeof (window.chrome && window.chrome.runtime) })
  return out
})()
`

const PAGE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>fp</title></head><body><script>' +
  COLLECTOR + '</script></body></html>'

let server = null
let win = null

function listen () {
  return new Promise((resolve, reject) => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(PAGE_HTML)
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(`http://127.0.0.1:${server.address().port}/`)
    })
  })
}

function closeServer () {
  if (!server) return
  const current = server
  server = null
  current.close()
  current.closeAllConnections?.()
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mp-probe-browser-fp-')))

app.on('before-quit', closeServer)
app.on('window-all-closed', () => app.quit())

app.whenReady()
  .then(async () => {
    const gate = resolveStealthEnabled()
    const preload = resolveBundledPreloadPath(path.join(__dirname, '..', 'electron', 'monitor-preload'))
    const url = await listen()
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        // 与 tab-lifecycle.js 的浏览/账号标签同构
        preload: preload.path,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error('生产 preload 加载失败：', preloadPath, error)
    })
    await win.loadURL(url)
    const raw = await win.webContents.executeJavaScript(
      'window.__fpReady.then(function (o) { return JSON.stringify(o) })',
      true,
    )
    let fingerprint = null
    try {
      fingerprint = JSON.parse(raw)
    } catch (error) {
      fingerprint = { parseError: String(error && error.message), raw }
    }
    const result = {
      stealthGate: gate,
      preload: { path: preload.path, bundled: preload.bundled },
      fingerprint,
    }
    process.stdout.write(RESULT_PREFIX + JSON.stringify(result) + '\n')
    app.quit()
  })
  .catch((error) => {
    console.error('probe harness 启动失败：', error)
    app.exit(1)
  })
