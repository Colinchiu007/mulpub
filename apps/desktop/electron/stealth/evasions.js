// @ts-check
/**
 * stealth/evasions.js — 主世界反检测源码（单一真源）
 *
 * ⚠️ 本模块只**生成**要注入页面主世界的源码字符串，自身不接触 DOM；注入通道见 `./inject.js`。
 *
 * ## 为什么不能沿用旧 `stealth-preload.js` 的补丁集
 *
 * 旧文件的 5 项补丁有两个独立问题，其中第二个更严重：
 *   ① 执行位置错误——`contextIsolation:true + sandbox:true` 下 preload 在隔离世界运行，
 *      改的是隔离世界的 `navigator`，主世界毫无感觉（存量缺陷，见 PRD-OSS-RPA-HARDENING §3.1 E4b）。
 *   ② **补丁内容本身会加重破绽**。2026-10-15 用真实 Electron 43 与真实 Chrome 155
 *      （同机、同 GPU）逐项对照实测：
 *        - `navigator.plugins`：Electron 已是 5 项且**名称与真实 Chrome 逐字相同**
 *          （PDF Viewer / Chrome PDF Viewer / Chromium PDF Viewer / Microsoft Edge PDF Viewer /
 *          WebKit built-in PDF），而旧文件硬塞 3 项含 `Native Client` 的假插件——
 *          现代 Chrome 早已没有 Native Client，造它等于自曝。
 *        - `navigator.webdriver`：Electron 已是 `false`，与真实 Chrome 相同，无需处理。
 *        - `chrome.runtime`：真实 Chrome 在普通网页上也是 `undefined`，旧文件凭空造它同样自曝。
 *      故本模块**只修实测确认不一致的项**，且每项都写明实测值对照。
 *
 * ## 实测对照表（Electron 43.7.7 vs Chrome 155，2026-10-15，同机 Windows）
 *
 * | 信号 | Electron 实测 | 真实 Chrome 实测 | 本模块 |
 * |------|--------------|-----------------|--------|
 * | `navigator.webdriver` | `false` | `false` | 不处理（本就一致） |
 * | `navigator.plugins` | 5 项，名称逐字相同 | 5 项 | 不处理（本就一致） |
 * | `navigator.mimeTypes` | 2 | 2 | 不处理 |
 * | `navigator.vendor` | `Google Inc.` | `Google Inc.` | 不处理 |
 * | `navigator.hardwareConcurrency` | 12 | 12 | 不处理 |
 * | `navigator.deviceMemory` | 32 | 32 | 不处理 |
 * | WebGL vendor/renderer | 同机同值 | 同机同值 | 不处理（伪造反而制造矛盾） |
 * | `chrome.runtime` | `undefined` | **`undefined`** | 不处理 |
 * | **`Object.keys(window.chrome)`** | **`[]`（空）** | **`['loadTimes','csi','app']`** | ✅ 补 |
 * | **`navigator.userAgentData.brands`** | 缺 `Google Chrome` | 含 `Google Chrome` | ✅ 补 |
 * | **`Notification.permission`** | **`granted`** | **`default`** | ✅ 修 |
 * | **`permissions.query(任意)`** | **`granted`** | **`prompt`** | ✅ 修 |
 * | `navigator.languages` | `['zh-CN','zh-Hans-CN']` | `['zh-CN','zh']` | ⛔ 不处理（见下） |
 *
 * `navigator.languages` 刻意不处理：它与请求头 `Accept-Language` 必须自洽，只改 JS 读数会制造
 * 「读数与请求头不一致」这一**新**破绽；而正确取值取决于本机语言配置，属未取证项。
 * 同理 `userAgentData` 的 GREASE 品牌（`Not;A=Brand` 及其版本号）由内核按版本生成，
 * 本模块**只补缺失的 `Google Chrome` 一条**，不重建整个列表。
 *
 * @see apps/desktop/scripts/probe-main-world-injection.js — 复现上表的真机 harness
 */

/** 注入源码在页面主世界登记的标记对象名（三态观测用，见 ./inject.js） */
const MARKER_KEY = '__mpStealthInj'

/** 源码版本：写进主世界标记，便于排障时确认"页面上跑的是哪一版 evasion 集" */
const SOURCE_VERSION = '2026-10-15.1'

/** 本源码派生的上游（许可与版本基线） */
const PROVENANCE = {
  /** 上游包名（apps/desktop 的 dependencies 之一，作为 evasion 技术的参照实现） */
  package: 'puppeteer-extra-plugin-stealth',
  /** 上游版本——**必须与已安装版本一致**，由 evasions.test.js 机械核对 */
  version: '2.11.2',
  license: 'MIT',
  /** 本模块并非上游代码的逐字移植：上游 evasion 依赖 puppeteer 的 page 对象，无法在 Electron
   *  preload 中直接复用。此处仅参照其技术路线（chrome.app/csi/loadTimes、permissions），
   *  取值与判定条件全部按本仓真机实测重写。 */
  relationship: 'technique-reference',
}

/**
 * 每一项 evasion 的 id（与源码内 `apply(id, ...)` 调用一一对应，由测试锁死）
 * 顺序即源码内的执行顺序。
 */
const EVASION_IDS = [
  'chrome.keys',
  'navigator.userAgentData.brands',
  'notification.permission',
  'permissions.query',
]

/**
 * 生成注入主世界的源码字符串。
 *
 * 结构契约（`inject.js` 与测试都依赖）：
 *   - 首个语句即写标记 `window[MARKER_KEY] = { start, done: 0, ... }`；
 *     未写标记 ⇒ 源码根本没执行（而非"执行了但失败"）。
 *   - 末个语句置 `done = 1`；有 start 无 done ⇒ 执行中途异常。
 *   - 每项 evasion 独立 try/catch，互不阻断；结果分别进 `applied` / `failed`。
 *   - 全程不使用 `require`/`import`（主世界无模块系统）。
 *
 * 实现取「函数序列化 + 立即调用传参」而非字符串拼接：拼接要在多引号/转义里手写出整段
 * 逻辑，易错且无法被 lint 覆盖；序列化形态下源码本体是可读、可审、可被测试直接执行的
 * 普通函数（`buildMainWorldFn`）。传参保证主世界不依赖任何闭包变量。
 *
 * @returns {string} 可交给 `webFrame.executeJavaScriptInIsolatedWorld(0, [{code}])` 的源码
 */
function buildEvasionSource () {
  return '(' + String(buildMainWorldFn) + ')(' +
    JSON.stringify(MARKER_KEY) + ', ' +
    JSON.stringify(EVASION_IDS) + ', ' +
    JSON.stringify(SOURCE_VERSION) +
    ');'
}

/**
 * 主世界源码本体。
 *
 * 说明：本函数**从不在 Node 侧被调用**——它只被 `String()` 序列化后注入页面执行。
 * 写成函数而非模板字符串，是为了让源码本身可被 lint 与人工审阅（字符串拼接易漏转义）。
 * 注意：函数体内不得引用外部变量（无闭包），也不要使用箭头函数/可选链等需要转译的语法。
 * @param {string} markerKey
 * @param {string[]} evasionIds
 * @param {string} version
 */
function buildMainWorldFn (markerKey, evasionIds, version) {
  var MARKER_KEY = markerKey
  var EVASION_IDS = evasionIds
  var VERSION = version

  var state = {
    start: Date.now(),
    done: 0,
    version: VERSION,
    applied: [],
    failed: [],
  }
  try {
    window[MARKER_KEY] = state
  } catch (_e) {
    return
  }

  /** 每项独立执行：单项失败不得阻断其余项（失败进 failed 供三态观测） */
  function apply (id, fn) {
    try {
      fn()
      state.applied.push(id)
    } catch (e) {
      state.failed.push(id + ':' + (e && e.message ? e.message : String(e)))
    }
  }

  // ── 1. window.chrome 的三个遗留属性 ────────────────────────────────────────
  // 实测：Electron 的 `window.chrome` 存在但 `Object.keys()` 为空数组，
  // 真实 Chrome 为 ['loadTimes','csi','app']。这三个是 Chrome 历史遗留 API，
  // 真实站点仍会读它们；缺失比"值略有偏差"更显眼，故按 performance.timing 派生真实值。
  apply('chrome.keys', function () {
    var chromeObj = window.chrome
    if (!chromeObj || typeof chromeObj !== 'object') return
    var timing = window.performance && window.performance.timing ? window.performance.timing : null
    var navStart = timing && timing.navigationStart ? timing.navigationStart : Date.now()
    /** performance.timing 是毫秒时间戳，chrome.* 返回秒（浮点） */
    function toSeconds (ms) {
      return ms ? ms / 1000 : 0
    }

    if (!chromeObj.app) {
      chromeObj.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: function () { return null },
        getIsInstalled: function () { return false },
        runningState: function () { return 'cannot_run' },
      }
    }

    if (!chromeObj.csi) {
      chromeObj.csi = function () {
        return {
          onloadT: timing ? timing.domContentLoadedEventEnd : 0,
          startE: navStart,
          pageT: Date.now() - navStart,
          tran: 15,
        }
      }
    }

    if (!chromeObj.loadTimes) {
      chromeObj.loadTimes = function () {
        var t = timing || {}
        var firstPaint = 0
        try {
          var paints = window.performance.getEntriesByType ? window.performance.getEntriesByType('paint') : []
          for (var i = 0; i < paints.length; i++) {
            if (paints[i].name === 'first-paint') firstPaint = navStart + paints[i].startTime
          }
        } catch (_e) { /* paint 计时不可用时留 0（与 about:blank 上的真实行为一致） */ }
        return {
          requestTime: toSeconds(t.navigationStart),
          startLoadTime: toSeconds(t.navigationStart),
          commitLoadTime: toSeconds(t.responseStart),
          finishDocumentLoadTime: toSeconds(t.domContentLoadedEventEnd),
          finishLoadTime: toSeconds(t.loadEventEnd),
          firstPaintTime: firstPaint ? firstPaint / 1000 : 0,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnProtocol: 'h2',
          connectionInfo: 'h2',
          wasAlternateProtocolAvailable: false,
        }
      }
    }
  })

  // ── 2. navigator.userAgentData.brands 补 Google Chrome ────────────────────
  // 实测：Electron 报 [{Not;A=Brand,8},{Chromium,150}]；真实 Chrome 报
  // [{Google Chrome,155},{Chromium,155},{Not(A:Brand,24}]。
  // 唯一系统性差异是**缺 Google Chrome 品牌**——这等于直接宣告"我不是 Chrome"。
  // GREASE 品牌名与版本由内核按版本生成，这里**原样保留**，只插入缺失的那一条，
  // 版本号取自 UA 的 Chrome 主版本以保证自洽。
  apply('navigator.userAgentData.brands', function () {
    var uad = navigator.userAgentData
    if (!uad || !uad.brands || typeof uad.brands.length !== 'number') return

    var match = /Chrome\/(\d+)/.exec(navigator.userAgent || '')
    var major = match ? match[1] : ''
    if (!major) return

    var i
    for (i = 0; i < uad.brands.length; i++) {
      if (uad.brands[i] && uad.brands[i].brand === 'Google Chrome') return
    }

    var brands = [{ brand: 'Google Chrome', version: major }]
    for (i = 0; i < uad.brands.length; i++) brands.push(uad.brands[i])

    // ⚠️ 这里的字段必须是**值**而不是取值函数：Proxy 的 get 直接返回 `impl[prop]`，
    // 若写成函数，`navigator.userAgentData.brands` 会返回函数本身。这不是假想——
    // 首版就是这么写的，真机 A/B 实测时该字段在 JSON 序列化中整个消失（函数被丢弃），
    // 页面读到 undefined，而单元测试若只断言"brands 里含 Google Chrome"仍会全绿。
    var impl = {
      brands: brands,
      mobile: uad.mobile,
      platform: uad.platform,
      getHighEntropyValues: function (hints) {
        if (typeof uad.getHighEntropyValues !== 'function') return Promise.reject(new Error('not supported'))
        return Promise.resolve(uad.getHighEntropyValues(hints)).then(function (values) {
          if (!values || typeof values !== 'object') return values
          // 高熵值里也带 brands，必须同源；否则"低熵报 Chrome、高熵报 Chromium"自相矛盾
          var copy = {}
          for (var key in values) {
            if (Object.prototype.hasOwnProperty.call(values, key)) copy[key] = values[key]
          }
          copy.brands = brands
          return copy
        })
      },
    }
    var proxy = new Proxy(uad, {
      get: function (target, prop) {
        if (Object.prototype.hasOwnProperty.call(impl, prop)) return impl[prop]
        var value = target[prop]
        return typeof value === 'function' ? value.bind(target) : value
      },
      has: function (target, prop) {
        return Object.prototype.hasOwnProperty.call(impl, prop) || prop in target
      },
    })
    Object.defineProperty(navigator, 'userAgentData', { get: function () { return proxy }, configurable: true })
  })

  // ── 3. Notification.permission 与 4. permissions.query 的报告状态 ──────────
  // 实测：Electron 对 notifications/geolocation/camera/microphone/clipboard-read
  // **一律返回 granted**（`Notification.permission` 也是 granted）；真实 Chrome 在
  // 未授权站点上是 `Notification.permission=default` + `permissions.query=prompt`。
  // 「所有权限都已授予」在任何真实浏览器上都不可能对全新站点出现，属系统性异常。
  //
  // 语义边界（如实声明，不假装完全等价）：本模块只改**报告值**，使被动指纹读取与
  // 真实 Chrome 一致。**实际能力授予未被本模块改变**——Electron 在未安装权限处理器时
  // 对请求一律放行（实测 `setPermissionRequestHandler` 未设即 granted），因此
  // 「报告 prompt、真去要就拿到」这一残留矛盾只在**页面主动请求并比较返回值**时可观测，
  // 属未闭合项而非已修项：把能力也收紧需要按权限名逐项白名单（fullscreen / pointerLock
  // 等若被一并拒绝会真实破坏站点功能），是独立于指纹修复的另一处变更，见
  // `01-docs/INVESTIGATE-ZHIHU-RISK-CONTROL-2026-10-15.md` §5.4 的后续项。
  var FRESH_SITE_PERMISSION_STATE = 'prompt'
  var FRESH_SITE_NOTIFICATION_PERMISSION = 'default'

  apply('notification.permission', function () {
    var descriptor = Object.getOwnPropertyDescriptor(Notification, 'permission')
    if (!descriptor || typeof descriptor.get !== 'function') return
    var nativeGet = descriptor.get
    Object.defineProperty(Notification, 'permission', {
      get: function () {
        var actual = nativeGet.call(Notification)
        // 只把"内核默认授予"这一非用户决策改回全新站点态；保留真实的 denied 语义
        return actual === 'granted' ? FRESH_SITE_NOTIFICATION_PERMISSION : actual
      },
      configurable: true,
    })
    if (typeof Notification.requestPermission === 'function') {
      var nativeRequest = Notification.requestPermission.bind(Notification)
      Notification.requestPermission = function (callback) {
        var result = Promise.resolve(nativeRequest()).then(function (value) {
          return value === 'granted' ? FRESH_SITE_NOTIFICATION_PERMISSION : value
        })
        if (typeof callback === 'function') result.then(function (value) { callback(value) })
        return result
      }
    }
  })

  apply('permissions.query', function () {
    var permissionsProto = window.Permissions && window.Permissions.prototype
    if (!permissionsProto || typeof permissionsProto.query !== 'function') return
    var nativeQuery = permissionsProto.query
    // 只覆盖实测确认被 Electron 报成 granted 的集合；其余权限原样透传（未知权限不猜）
    var COVERED = ['notifications', 'geolocation', 'camera', 'microphone', 'clipboard-read']
    permissionsProto.query = function (descriptor) {
      var result = nativeQuery.apply(this, arguments)
      var name = descriptor && descriptor.name
      if (COVERED.indexOf(name) === -1) return result
      return Promise.resolve(result).then(function (status) {
        if (!status || status.state !== 'granted') return status
        var replacement = { state: FRESH_SITE_PERMISSION_STATE, onchange: null }
        // 保 `instanceof PermissionStatus`：直接换普通对象会被一行 `instanceof` 识破
        try {
          if (window.PermissionStatus) Object.setPrototypeOf(replacement, window.PermissionStatus.prototype)
        } catch (_e) { /* 原型不可设时退化为普通对象，观测值仍正确 */ }
        return replacement
      })
    }
  })

  state.done = 1
}

/** `inject.js` 与测试共用的契约常量 */
const CONTRACT = {
  MARKER_KEY,
  /** 三态观测取值 */
  STATE_NO_MARKER: 'preload-not-run',
  STATE_NO_DONE: 'partial-first-line-failed',
  STATE_DONE: 'ok',
  /**
   * 三项 chrome 遗留属性（真实 Chrome 的 `Object.keys(window.chrome)` 恰为此三项，顺序即实测顺序）
   */
  CHROME_LEGACY_KEYS: ['loadTimes', 'csi', 'app'],
  FRESH_SITE_PERMISSION_STATE: 'prompt',
  FRESH_SITE_NOTIFICATION_PERMISSION: 'default',
}

module.exports = {
  MARKER_KEY,
  SOURCE_VERSION,
  PROVENANCE,
  EVASION_IDS,
  CONTRACT,
  buildEvasionSource,
  // 导出本体供测试直接以假 window 执行（比只断言字符串更能发现逻辑错误）
  buildMainWorldFn,
}
