'use strict'
/**
 * probe-injection-preload.js — 主世界注入通道 + 指纹取证探针（sandbox preload）
 *
 * 本文件**只服务探针 harness**（scripts/probe-main-world-injection.js），不是生产代码。
 *
 * 回答四类必须先取证、否则实现就会写错的问题：
 *
 *  Q1 sandbox preload 能否 `require` 相对路径的兄弟文件？
 *     ——能 ⇒ 反检测源码可做成单一真源模块（无需 esbuild 打包）；
 *     ——不能 ⇒ 必须走 build-preload 的 bundle 通道（与 home-shell-preload 同策略）。
 *  Q2 `require('electron').webFrame` 在 sandbox 下是否可用？
 *  Q3 `webFrame.executeJavaScriptInIsolatedWorld(0, [{code}], true)` 是否把代码注入
 *     **页面主世界**、且**早于页面脚本**？worldId=0 的语义必须实测，不能按文档想象。
 *  Q4 Electron 与真实 Chrome 的**候选指纹逐项取值**——决定「哪些项该补、哪些项本就正常」。
 *     本仓教训（`stealth-preload.js` 里的 3 个假插件）正是「没取证就补，补出更明显的破绽」：
 *     现代 Chrome 无 `Native Client` 插件，凭空造它等于自曝。
 *
 * 上报通道：document-start 时 `document.documentElement` 尚不存在（首版探针用 <meta> 承载，
 * 实测两次都读到 null），故 preload 侧观测改经 contextBridge 暴露给主世界读取。
 */
const { webFrame, contextBridge } = require('electron')

const sync = {
  relativeRequire: 'not-attempted',
  webFrameAvailable: typeof webFrame === 'object' && webFrame !== null,
  isolatedWorldSupported: typeof webFrame?.executeJavaScriptInIsolatedWorld === 'function',
  contextBridgeAvailable: typeof contextBridge === 'object' && contextBridge !== null,
}

// Q1：相对 require（失败必须被记录成观测值，而不是让 preload 整体崩掉）
try {
  const target = require('./probe-require-target.js')
  sync.relativeRequire = target && target.REQUIRED_FROM_SIBLING === true ? 'ok' : 'wrong-shape'
} catch (error) {
  sync.relativeRequire = 'failed: ' + (error && error.message ? error.message : String(error))
}

// 隔离世界（preload 自身所在 world）对照：主世界**不应**看到这个标记。
try {
  globalThis.__probeIsoWorldMarker = 'isolated-world-only'
} catch (_error) { /* 观测失败不影响探针 */ }

// Q3 + Q4：主世界取证源码（首行写 start、末行写 done，其余逐项采集候选指纹）
const MAIN_WORLD_SOURCE = [
  '(function () {',
  '  var out = { start: 1, done: 0 };',
  '  window.__probe = out;',
  '  function safe(fn) { try { return fn() } catch (e) { return "ERR:" + String(e && e.message) } }',
  '  out.webdriver = safe(function () { return String(navigator.webdriver) });',
  '  out.pluginsLength = safe(function () { return navigator.plugins.length });',
  '  out.pluginNames = safe(function () { return Array.prototype.map.call(navigator.plugins, function (p) { return p.name }) });',
  '  out.mimeTypesLength = safe(function () { return navigator.mimeTypes.length });',
  '  out.pdfViewerEnabled = safe(function () { return String(navigator.pdfViewerEnabled) });',
  '  out.languages = safe(function () { return navigator.languages });',
  '  out.language = safe(function () { return navigator.language });',
  '  out.platform = safe(function () { return navigator.platform });',
  '  out.vendor = safe(function () { return navigator.vendor });',
  '  out.hardwareConcurrency = safe(function () { return navigator.hardwareConcurrency });',
  '  out.deviceMemory = safe(function () { return String(navigator.deviceMemory) });',
  '  out.userAgent = safe(function () { return navigator.userAgent });',
  '  out.userAgentDataBrands = safe(function () { return navigator.userAgentData ? navigator.userAgentData.brands : "absent" });',
  '  out.userAgentDataMobile = safe(function () { return navigator.userAgentData ? String(navigator.userAgentData.mobile) : "absent" });',
  '  out.chromeTypeof = safe(function () { return typeof window.chrome });',
  '  out.chromeKeys = safe(function () { return window.chrome ? Object.keys(window.chrome) : "absent" });',
  '  out.chromeRuntimeTypeof = safe(function () { return typeof (window.chrome && window.chrome.runtime) });',
  '  out.outerWidth = safe(function () { return window.outerWidth });',
  '  out.outerHeight = safe(function () { return window.outerHeight });',
  '  out.innerWidth = safe(function () { return window.innerWidth });',
  '  out.innerHeight = safe(function () { return window.innerHeight });',
  '  out.screenWidth = safe(function () { return screen.width });',
  '  out.screenHeight = safe(function () { return screen.height });',
  '  out.devicePixelRatio = safe(function () { return window.devicePixelRatio });',
  '  out.notificationPermission = safe(function () { return String(Notification.permission) });',
  '  out.permissionsQueryType = safe(function () { return typeof navigator.permissions.query });',
  '  out.webgl = safe(function () {',
  '    var c = document.createElement("canvas");',
  '    var gl = c.getContext("webgl") || c.getContext("experimental-webgl");',
  '    if (!gl) return "no-webgl-context";',
  '    var ext = gl.getExtension("WEBGL_debug_renderer_info");',
  '    if (!ext) return "no-debug-renderer-info";',
  '    return { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };',
  '  });',
  '  out.done = 1;',
  '})();',
].join('\n')

let injectionState = 'not-attempted'
let injectionHandle = null
try {
  injectionHandle = webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: MAIN_WORLD_SOURCE }], true)
  injectionState = 'dispatched'
} catch (error) {
  injectionState = 'threw: ' + (error && error.message ? error.message : String(error))
}

sync.injectionState = injectionState

// preload 侧观测经 contextBridge 暴露（document-start 无 DOM 可承载）
try {
  contextBridge.exposeInMainWorld('__mpProbeSync', sync)
} catch (error) {
  sync.exposeError = String(error && error.message)
}

// 异步回读主世界：证「注入真的落到主世界」而不是只落到隔离世界
Promise.resolve(injectionHandle)
  .then(() => webFrame.executeJavaScriptInIsolatedWorld(0, [{
    code: 'JSON.stringify({ probePresent: !!window.__probe, isoMarkerVisibleInMain: typeof window.__probeIsoWorldMarker })',
  }], true))
  .then((raw) => contextBridge.exposeInMainWorld('__mpProbeReadBack', { ok: true, raw }))
  .catch((error) => {
    try {
      contextBridge.exposeInMainWorld('__mpProbeReadBack', { ok: false, error: String(error && error.message) })
    } catch (_error) { /* 上报失败不影响被测行为 */ }
  })
