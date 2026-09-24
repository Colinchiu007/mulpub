// @ts-check
/**
 * WebviewManager 工具函数
 * 纯函数，无状态，从 webview-manager.js 提取
 */
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const { config, getUrl } = require('../../config/app-config')
const { HOME_SHELL_PARAM } = require('./constants')
const { LS_INJECTION_TIMEOUT_MS } = require('./constants')

function _getUserDataDir () {
  try { return app.getPath('userData') } catch (e) { return path.join(os.homedir(), '.multi-publish') }
}

/**
 * 通过 CDP 在文档 document-start（主世界首帧之前）注入凭证 localStorage。
 * 根因（2026-09-24 视频号）：平台 SPA 不做服务端 302，由前端自判未登录主动弹回登录页；
 * did-finish-load 之后再注入，首个导航到达时凭证尚未写入，二段导航同样被弹回。
 * addScriptToEvaluateOnNewDocument 让脚本先于页面任何脚本执行，保证首个导航即已登录态。
 * 返回 Promise<boolean>：true=早期注入成功（无需事后补注入/二段导航）；
 * false=debugger 缺失/attach 被占/sendCommand 失败，调用方降级旧路径（fail-open，不阻断导航）。
 * 成功时保持 attach——注入须存活到首个导航提交；did-navigate 后 detach（注入已落在页面世界）。
 * @param {any} view
 * @param {string} script
 * @returns {Promise<boolean>}
 */
function _injectLocalStorageAtDocumentStart (view, script) {
  const log = require('../logger')
  return Promise.resolve().then(function () {
    var dbg = view && view.webContents && view.webContents.debugger
    if (!dbg || typeof dbg.attach !== 'function' || typeof dbg.sendCommand !== 'function') return false
    try {
      dbg.attach()
    } catch (e) {
      log.warn('WebviewManager', 'debugger attach failed, LS early injection fallback: ' + ((e && e.message) || 'unknown'))
      return false
    }
    var pending = Promise.resolve(dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script }))
    // 挂起防护：sendCommand 可能永不 resolve/reject（2026-09-24 头条事故），用超时
    // 竞态封顶首个导航的阻塞时长。迟到的成功仍会让注入对后续导航生效（localStorage
    // 写入幂等，无害）；迟到的失败已在下方收敛为 outcome，不外溢 unhandled rejection。
    var settled = new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve('timeout') }, LS_INJECTION_TIMEOUT_MS)
      if (timer && typeof timer.unref === 'function') timer.unref()
      pending.then(function () { clearTimeout(timer); resolve('ok') },
        function (e) { clearTimeout(timer); resolve({ error: e }) })
    })
    return settled.then(function (outcome) {
      if (outcome === 'ok') {
        try {
          view.webContents.once('did-navigate', function () {
            try { dbg.detach() } catch (_) { /* already detached */ }
          })
        } catch (_) { /* once 不可用时保持 attach，webContents 销毁会一并释放 */ }
        return true
      }
      if (outcome === 'timeout') {
        log.warn('WebviewManager', 'addScriptToEvaluateOnNewDocument timed out after ' + LS_INJECTION_TIMEOUT_MS + 'ms (hung CDP command), LS early injection fallback')
      } else {
        log.warn('WebviewManager', 'addScriptToEvaluateOnNewDocument failed, LS early injection fallback: ' + ((outcome && outcome.error && outcome.error.message) || 'unknown'))
      }
      try { dbg.detach() } catch (_) { /* ignore（命令仍挂起时 detach 可能抛错，降级路径不依赖它） */ }
      return false
    })
  })
}

/**
 * 将 Playwright 捕获的 Cookie 转成 Electron session.cookies.set 接受的格式。
 * Playwright 使用 expires / PascalCase sameSite，而 Electron 使用
 * expirationDate / 小写 sameSite；格式不转换时 cookies.set 会失败并被静默吞掉。
 * @param {object} cookie
 * @param {string} fallbackUrl
 * @returns {object|null}
 */
function normalizeElectronCookie (cookie, fallbackUrl) {
  if (!cookie || typeof cookie !== 'object' || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') return null

  var normalized = Object.assign({}, cookie)
  if (!normalized.url && !normalized.domain && fallbackUrl) {
    normalized.url = fallbackUrl
  } else if (!normalized.url && normalized.domain) {
    normalized.url = (normalized.secure === false ? 'http' : 'https') + '://' + String(normalized.domain).replace(/^\.+/, '') + '/'
  }
  if (!normalized.url) return null

  if (!Number.isFinite(Number(normalized.expirationDate)) && Number.isFinite(Number(normalized.expires)) && Number(normalized.expires) > 0) {
    normalized.expirationDate = Number(normalized.expires)
  }
  delete normalized.expires

  if (typeof normalized.sameSite === 'string') {
    var sameSite = normalized.sameSite.toLowerCase()
    normalized.sameSite = sameSite === 'none' ? 'no_restriction' :
      sameSite === 'strict' ? 'strict' :
        sameSite === 'lax' ? 'lax' : 'unspecified'
  }
  return normalized
}

/**
 * 内嵌主页标签加载的本应用主页地址。
 * 打包态：file:// dist/index.html（与主窗口同一入口）；开发态：devServer 地址（与主窗口同源）。
 * hash 路由（createWebHashHistory）下 search 先于 hash，固定为 /?mp-home-shell=1 形态，SPA 路由从 '#/' 起始。
 * @returns {string}
 */
function _homeShellUrl () {
  return app.isPackaged
    ? pathToFileURL(path.join(__dirname, '..', '..', 'dist', 'index.html')).href + '?' + HOME_SHELL_PARAM
    : getUrl(config.devServer) + '/?' + HOME_SHELL_PARAM
}

/**
 * 解析内嵌主页标签的 preload：优先 esbuild 产物 bundle（与主窗口 index.bundle.js 同策略，
 * sandbox 下由 Electron 内部机制加载），bundle 不存在（未跑 build:preload 的测试/裸环境）回退源文件。
 * @returns {string}
 */
function _homeShellPreloadPath () {
  const base = path.join(__dirname, '..', '..', 'home-shell-preload')
  const bundle = base + '.bundle.js'
  try { if (fs.existsSync(bundle)) return bundle } catch (e) { /* ignore */ }
  return base + '.js'
}

/**
 * 判定一个导航后的 URL 是否仍处于内嵌主页壳态（search 严格含 mp-home-shell=1）。
 * 先去前导 query（按 '?' 切）再按 '#' 取 query 段，兼容 hash 路由形态。
 * @param {string} url
 * @returns {boolean}
 */
function _urlHasHomeShellParam (url) {
  if (typeof url !== 'string' || !url) return false
  const qsStart = url.indexOf('?')
  if (qsStart === -1) return false
  const query = url.slice(qsStart + 1).split('#')[0]
  try {
    return new URLSearchParams(query).get('mp-home-shell') === '1'
  } catch (e) {
    return false
  }
}

/**
 * 从内嵌主页标签（home-shell）hash 路由 URL 中提取 SPA 路由路径（'#' 之后、'?' 之前）。
 * hash 历史形态：.../index.html?mp-home-shell=1#/collection?tab=x -> '/collection'。
 * 无 hash / 异常回落 '/'。用于共享左侧边栏高亮跟随当前聚焦标签的真实页面。
 * @param {string} url
 * @returns {string}
 */
function _parseHashRoute (url) {
  if (typeof url !== 'string') return '/'
  const hashIdx = url.indexOf('#')
  if (hashIdx === -1) return '/'
  let route = url.slice(hashIdx + 1)
  const qIdx = route.indexOf('?')
  if (qIdx !== -1) route = route.slice(0, qIdx)
  if (!route) route = '/'
  if (route.charAt(0) !== '/') route = '/' + route
  return route
}

module.exports = {
  _getUserDataDir,
  _injectLocalStorageAtDocumentStart,
  normalizeElectronCookie,
  _homeShellUrl,
  _homeShellPreloadPath,
  _urlHasHomeShellParam,
  _parseHashRoute
}
