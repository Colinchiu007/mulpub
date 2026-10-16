'use strict'
/**
 * probe-main-world-injection.js — 主世界注入通道 + 指纹取证 harness（真实 Electron，非单测）
 *
 * 为什么必须有真机 harness：「页面主世界是否真的被改到」无法用 jsdom 或假 preload 证明。
 * 本仓已有同族教训——`stealth-preload.js` 的 patch 在 `contextIsolation:true + sandbox:true`
 * 下改的是隔离世界的 navigator，主世界毫无感觉，而单测（手搓 navigator 夹具）全绿；
 * 且同一文件里的「3 个假插件」若真生效，反而会**加重**指纹异常（现代 Chrome 无 Native Client）。
 *
 * 用法（需已安装 electron 二进制）：
 *   cd apps/desktop
 *   # ⚠ 必须清掉 ELECTRON_RUN_AS_NODE —— 该变量会让 electron 退化成纯 Node，
 *   #   表现为 `require('electron')` 返回可执行文件路径字符串、`app` 为 undefined。
 *   Remove-Item Env:\ELECTRON_RUN_AS_NODE
 *   ../node_modules/electron/dist/electron.exe scripts/probe-main-world-injection.js
 *
 * 输出：一行 `PROBE_MAIN_WORLD_RESULT:{...}` JSON：
 *   - preload      相对 require / webFrame 可用性（同步观测）
 *   - mainWorld    主世界逐项指纹取值 + 注入标记
 *   - isoMarkerVisibleInMain  隔离世界标记是否泄漏到主世界（应为 "undefined"）
 *   - page         页面脚本自己看到的主世界取值（证明「注入早于页面脚本」）
 */
const http = require('http')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { app, BrowserWindow } = require('electron')
const { configureUserAgentFallback } = require('../electron/startup-compat')

const RESULT_PREFIX = 'PROBE_MAIN_WORLD_RESULT:'

// 是否套用生产 UA 净化（`main.js:19` 的真实调用）。可由 argv 关闭以便做 A/B 对照：
//   --probe-no-ua-sanitize
// 对照的意义：只有「净化前带 Electron 标记、净化后不带」才算这条链路被证实，
// 单看净化后的值无法排除「本来就没有 Electron 标记」这种平凡解释。
const APPLY_UA_SANITIZE = !process.argv.includes('--probe-no-ua-sanitize')

// 权限处理器实验：Electron 默认把**所有**权限都报成 `granted`（实测：notifications/geolocation/
// camera/microphone/clipboard-read 全是 granted），而真实 Chrome 在未授权站点上是
// `Notification.permission=default` + `permissions.query=prompt`。
// 本开关用来判定「主进程 setPermissionCheckHandler 返回 false 后，Electron 原生报什么状态」——
// 若原生能报出非 granted，就优先用宿主 API 修（行为与上报一致），而不是只改 JS 读数。
//   --probe-deny-permissions
const DENY_PERMISSIONS = process.argv.includes('--probe-deny-permissions')

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title></head>
<body>
<script>
  window.__probePage = {
    sawInjectedProbe: typeof window.__probe,
    injectedDone: window.__probe ? window.__probe.done : null,
    webdriverSeenByPage: String(navigator.webdriver),
    pluginsSeenByPage: navigator.plugins ? navigator.plugins.length : -1,
    isoMarkerVisibleInMain: typeof window.__probeIsoWorldMarker
  };
</script>
</body></html>`

let server = null
let win = null
let denyHandlers = null

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

/**
 * 读主世界全局。主进程 `executeJavaScript` 默认就在主世界执行，因此：
 *   - `window.__probe`（注入源码自己写的）能读到 ⇒ 注入确实落在主世界；
 *   - `window.__mpProbeSync`（contextBridge 暴露的 preload 侧观测）能读到 ⇒ 上报通道成立。
 * 注意 `window.__probeIsoWorldMarker` 应恒为 undefined——它只在隔离世界存在。
 */
function readMainWorld (expression) {
  return win.webContents.executeJavaScript(`JSON.stringify(${expression})`, true)
}

/**
 * 权限状态取证（异步）：`Notification.permission` 与 `permissions.query(...)` 必须与真实
 * Chrome 的「未授权即 default」一致，且**两者互相一致**——只改一处会造出新的矛盾指纹。
 */
function readPermissions () {
  return win.webContents.executeJavaScript(`
    (async () => {
      const names = ['notifications', 'geolocation', 'camera', 'microphone', 'clipboard-read']
      const out = { notificationPermission: (() => { try { return String(Notification.permission) } catch (e) { return 'ERR' } })() }
      for (const name of names) {
        try {
          const status = await navigator.permissions.query({ name })
          out[name] = status && status.state
        } catch (error) {
          out[name] = 'ERR:' + String(error && error.message)
        }
      }
      return JSON.stringify(out)
    })()
  `, true)
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mp-probe-mainworld-')))

app.on('before-quit', closeServer)
app.on('window-all-closed', () => app.quit())

app.whenReady()
  .then(async () => {
    // UA 净化必须在建窗之前调用（与 main.js 的启动顺序一致：净化是进程级默认值）
    const uaSanitize = APPLY_UA_SANITIZE
      ? configureUserAgentFallback({ app })
      : { configured: false, skipped: true }
    const url = await listen()
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'probe-injection-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    win.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error('probe preload 加载失败：', preloadPath, error)
    })
    if (DENY_PERMISSIONS) {
      const ses = win.webContents.session
      let checkHandlerInstalled = false
      let requestHandlerInstalled = false
      try {
        ses.setPermissionCheckHandler(() => false)
        checkHandlerInstalled = true
      } catch (error) {
        console.error('setPermissionCheckHandler 安装失败：', error)
      }
      try {
        ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
        requestHandlerInstalled = true
      } catch (error) {
        console.error('setPermissionRequestHandler 安装失败：', error)
      }
      denyHandlers = { checkHandlerInstalled, requestHandlerInstalled }
    }
    await win.loadURL(url)
    // 沉降窗口：异步回读是 promise 链，给它一个稳定的完成窗口
    await new Promise((resolve) => setTimeout(resolve, 600))

    const result = {
      uaSanitize: { applied: APPLY_UA_SANITIZE, result: uaSanitize, appUserAgentFallback: app.userAgentFallback },
      denyPermissions: { requested: DENY_PERMISSIONS, handlers: denyHandlers },
      preloadSync: await readMainWorld('window.__mpProbeSync || null'),
      readBack: await readMainWorld('window.__mpProbeReadBack || null'),
      mainWorldFingerprint: await readMainWorld('window.__probe || null'),
      isoMarkerVisibleInMain: await readMainWorld('typeof window.__probeIsoWorldMarker'),
      permissions: await readPermissions(),
      page: await readMainWorld('window.__probePage || null'),
    }
    process.stdout.write(RESULT_PREFIX + JSON.stringify(result) + '\n')
    app.quit()
  })
  .catch((error) => {
    console.error('probe harness 启动失败：', error)
    app.exit(1)
  })
