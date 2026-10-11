// @ts-check
/**
 * WebviewManager 工具函数
 * 从 webview-manager.js 提取。多数为纯函数；例外是 `_injectLocalStorageAtDocumentStart`
 * （走 CDP）与 `_partitionRestoreTimeoutMs` / `_gateRestoreWithTimeout`（读环境变量、起定时器）——
 * 归入本模块的口径是「不持有实例状态、只依赖入参与常量」，不是「无副作用」。
 * 两个恢复护栏放在这里而不是 tab-lifecycle.js，是因为后者已贴近逐文件 500 行上限。
 */
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const { config, getUrl } = require('../../config/app-config')
const { HOME_SHELL_PARAM } = require('./constants')
const { LS_INJECTION_TIMEOUT_MS, PARTITION_COOKIE_RESTORE_TIMEOUT_MS, PAGE_TARGET_BOOTSTRAP_URL } = require('./constants')

function _getUserDataDir () {
  try { return app.getPath('userData') } catch (e) { return path.join(os.homedir(), '.multi-publish') }
}

/**
 * 全新 WebContentsView（从未导航）上渲染进程与 Page 目标尚未建立：`debugger.attach()`
 * 本身会成功，但 **Page 域命令会永久挂起**（2026-10-11 真机探针：`Page.enable` 与
 * `addScriptToEvaluateOnNewDocument` 在 6s 内都拿不到响应）。此时先发一个 about:blank
 * 把 Page 目标带起来，命令随即在 150–300ms 内返回（同场景 3/3 复现，见
 * `01-docs/BUGFIX-ACCOUNT-TAB-FIRST-PAINT-LOGIN-2026-10-11.md` §4）。
 *
 * 刻意**不等待** loadURL 的 did-finish-load：Page 目标就绪的唯一可靠信号就是
 * 「CDP 命令本身能返回」，所以这里只发出导航，就绪判定交给调用方的命令超时护栏——
 * 少一个可挂起的等待点，也少一处死锁面。
 *
 * 副作用：会在该 webContents 的历史里插入一条 about:blank，调用方须在首个真实导航
 * 提交后用 `_removeBootstrapBlankHistoryEntry` 移除（否则返回键多一格空白页）。
 *
 * @param {any} view WebContentsView
 * @returns {boolean} 是否真的发出了引导导航
 */
function _primePageTargetWithBlankDocument (view) {
  const log = require('../logger')
  try {
    var wc = view && view.webContents
    if (!wc || typeof wc.loadURL !== 'function') return false
    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return false
    Promise.resolve(wc.loadURL(PAGE_TARGET_BOOTSTRAP_URL)).then(function () {
      log.info('WebviewManager', 'blank bootstrap document requested for CDP Page target')
    }, function (e) {
      log.warn('WebviewManager', 'blank bootstrap navigation failed: ' + ((e && e.message) || 'unknown'))
    })
    return true
  } catch (e) {
    log.warn('WebviewManager', 'blank bootstrap navigation threw: ' + ((e && e.message) || 'unknown'))
    return false
  }
}

/**
 * 移除 `_primePageTargetWithBlankDocument` 插入的引导历史项。
 * 只在首个真实导航**提交后**调用：此刻引导项位于 index 0 且不是 active entry
 * （NavigationHistory 禁止移除 active entry）。真实 Electron 实测：
 * 引导后 `histLen 2 / canGoBack true` → 移除后 `histLen 1 / canGoBack false`。
 *
 * @param {any} view WebContentsView
 * @returns {boolean} 是否真的移除了引导项
 */
function _removeBootstrapBlankHistoryEntry (view) {
  const log = require('../logger')
  try {
    var wc = view && view.webContents
    var nh = wc && wc.navigationHistory
    if (!nh || typeof nh.getEntryAtIndex !== 'function' || typeof nh.removeEntryAtIndex !== 'function') return false
    var first = nh.getEntryAtIndex(0)
    if (!first || first.url !== PAGE_TARGET_BOOTSTRAP_URL) return false
    if (typeof nh.getActiveIndex === 'function' && nh.getActiveIndex() === 0) return false
    var removed = nh.removeEntryAtIndex(0) === true
    if (removed) log.info('WebviewManager', 'removed bootstrap about:blank history entry after first real navigation')
    return removed
  } catch (e) {
    // 清理失败只影响返回键多一格空白页，绝不影响登录态与导航主流程
    log.warn('WebviewManager', 'bootstrap history cleanup failed: ' + ((e && e.message) || 'unknown'))
    return false
  }
}

/**
 * 当前文档是否为 CDP Page 目标引导用的 about:blank（见 PAGE_TARGET_BOOTSTRAP_URL）。
 * 真实 Electron 上 `getURL()` 恒可用；夹具缺失该 API 时按「非引导文档」处理（fail-open：
 * 宁愿多走一次自动保存判定，也不要因为探针缺失把真实文档事件吞掉）。
 * @param {any} view
 * @returns {boolean}
 */
function _isBootstrapBlankDocument (view) {
  try {
    var wc = view && view.webContents
    if (!wc || typeof wc.getURL !== 'function') return false
    return wc.getURL() === PAGE_TARGET_BOOTSTRAP_URL
  } catch (e) { return false }
}

/**
 * 通过 CDP 在文档 document-start（主世界首帧之前）注入凭证 localStorage。
 * 根因（2026-09-24 视频号）：平台 SPA 不做服务端 302，由前端自判未登录主动弹回登录页；
 * did-finish-load 之后再注入，首个导航到达时凭证尚未写入，二段导航同样被弹回。
 * addScriptToEvaluateOnNewDocument 让脚本先于页面任何脚本执行，保证首个导航即已登录态。
 *
 * 两次真机探针（2026-10-11，见 `01-docs/BUGFIX-ACCOUNT-TAB-FIRST-PAINT-LOGIN-2026-10-11.md` §4）
 * 定死了本函数的两个前置动作，缺一即静默失效：
 * ① 先 `_primePageTargetWithBlankDocument`：全新 view 上 Page 域命令会挂起，旧实现因此
 *    必然走到 2500ms 超时 → 首个导航无凭证 → 平台弹登录页 → 补注入二次导航（用户看到的
 *    「先登录页、刷新一下、再变成已登录」）；
 * ② 必须 `Page.enable`：实测不 enable 时 `addScriptToEvaluateOnNewDocument` 会正常返回
 *    `{ identifier }` 但脚本**永不执行**（静默 no-op）——那种情况下本函数会误报成功，
 *    调用方不再走补注入，凭证会在首个文档上永久缺失。
 *
 * 成功时保持 attach——注入须存活到首个导航提交；did-navigate 后 detach（注入已落在页面世界）。
 *
 * @param {any} view
 * @param {string} script
 * @returns {Promise<{injected: boolean, blankBootstrapped: boolean}>}
 *   injected=true 表示后续新建文档会带上凭证（无需事后补注入/二段导航）；
 *   blankBootstrapped=true 表示本函数为建立 Page 目标插入过 about:blank，调用方须在首个
 *   真实导航提交后移除该历史项。
 */
function _injectLocalStorageAtDocumentStart (view, script) {
  const log = require('../logger')
  return Promise.resolve().then(function () {
    var result = { injected: false, blankBootstrapped: false }
    var dbg = view && view.webContents && view.webContents.debugger
    if (!dbg || typeof dbg.attach !== 'function' || typeof dbg.sendCommand !== 'function') return result
    try {
      dbg.attach()
    } catch (e) {
      log.warn('WebviewManager', 'debugger attach failed, LS early injection fallback: ' + ((e && e.message) || 'unknown'))
      return result
    }
    // 已有文档（复用 view / 已导航过）时无需引导，避免多余导航与历史项
    var currentUrl
    try { currentUrl = (typeof view.webContents.getURL === 'function' && view.webContents.getURL()) || '' } catch (e) { currentUrl = '' }
    if (!currentUrl) result.blankBootstrapped = _primePageTargetWithBlankDocument(view)

    var pending = Promise.resolve()
      .then(function () { return dbg.sendCommand('Page.enable', {}) })
      .then(function () { return dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script }) })
    // 挂起防护：命令可能永不 resolve/reject（2026-09-24 头条事故），用超时
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
        result.injected = true
        return result
      }
      if (outcome === 'timeout') {
        log.warn('WebviewManager', 'document-start LS injection timed out after ' + LS_INJECTION_TIMEOUT_MS + 'ms (hung CDP command), LS early injection fallback')
      } else {
        log.warn('WebviewManager', 'document-start LS injection failed, LS early injection fallback: ' + ((outcome && outcome.error && outcome.error.message) || 'unknown'))
      }
      try { dbg.detach() } catch (_) { /* ignore（命令仍挂起时 detach 可能抛错，降级路径不依赖它） */ }
      return result
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
        sameSite === 'lax' ? 'lax' : sameSite === 'no_restriction' ? 'no_restriction' : 'unspecified'
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

// 门控首个导航的凭证恢复时限（每次调用现读，便于排障时不改代码临时收紧/放宽）。
// 非法值回落默认并出声——静默吞掉配置错误会让下一次「导航不发生」又变成无痕迹故障。
function _partitionRestoreTimeoutMs () {
  const log = require('../logger')
  var raw = process.env.MP_COOKIE_RESTORE_TIMEOUT_MS
  if (raw === undefined || String(raw).trim() === '') return PARTITION_COOKIE_RESTORE_TIMEOUT_MS
  var parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log.warn('WebviewManager', 'invalid MP_COOKIE_RESTORE_TIMEOUT_MS=' + raw + ', fallback to ' + PARTITION_COOKIE_RESTORE_TIMEOUT_MS)
    return PARTITION_COOKIE_RESTORE_TIMEOUT_MS
  }
  return parsed
}

/**
 * 给「门控首个导航」的恢复链套上硬超时与永不 reject 的出口。
 * 超时/失败一律 resolve（放行导航）：注入留在后台自行结束，绝不阻塞窗口显示。
 * @param {Promise} chain
 * @param {string} label 平台:账号 ID，仅用于日志定位
 */
function _gateRestoreWithTimeout (chain, label) {
  const log = require('../logger')
  var timeoutMs = _partitionRestoreTimeoutMs()
  return new Promise(function (resolve) {
    var settled = false
    var settle = function (fn) {
      if (settled) return
      settled = true
      fn()
    }
    var timer = setTimeout(function () {
      settle(function () {
        log.warn('WebviewManager', 'credential restore gate timed out after ' + timeoutMs + 'ms, navigation not blocked: ' + label)
        resolve()
      })
    }, timeoutMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
    Promise.resolve(chain).then(function () {
      settle(function () { clearTimeout(timer); resolve() })
    }, function (e) {
      settle(function () {
        clearTimeout(timer)
        log.warn('WebviewManager', 'credential restore gate failed, navigation not blocked: ' + label + ' err=' + ((e && e.message) || 'unknown'))
        resolve()
      })
    })
  })
}

module.exports = {
  _getUserDataDir,
  _injectLocalStorageAtDocumentStart,
  _primePageTargetWithBlankDocument,
  _removeBootstrapBlankHistoryEntry,
  _isBootstrapBlankDocument,
  normalizeElectronCookie,
  _homeShellUrl,
  _homeShellPreloadPath,
  _urlHasHomeShellParam,
  _parseHashRoute,
  _partitionRestoreTimeoutMs,
  _gateRestoreWithTimeout
}
