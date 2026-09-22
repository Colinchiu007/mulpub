// @ts-check
/**
 * WebviewManager — 应用内浏览器标签页管理
 *
 * 每个 tab 独立 WebContentsView，独立 session 分区，Cookie 互不干扰。
 *
 * 功能：
 *   创建/关闭/切换标签页，前进后退刷新，URL 导航，搜索跳转
 *   虚拟登录标签（AuthViewManager / QrCodeLogin 托管全屏登录）
 *   左侧导航栏宽度同步
 */
const { EventEmitter } = require('events')
const { app, WebContentsView, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const log = require('./logger')
const credentialStore = require('./credential-store')
const { getPlatformName, isPlatformLoginSuccessUrl } = require('@multi-publish/shared-utils/src/platform-definitions')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')
// 内嵌视图定位唯一来源：必须用「客户区」尺寸，禁用 getBounds() 外框尺寸（详见模块注释）
const { computeEmbeddedViewBounds, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } = require('./view-bounds')
// 登录页会话级网络诊断（iframe 内部请求失败不触发 did-fail-load，详见模块注释）
const { attachLoginNetworkDiagnostics } = require('./login-network-diagnostics')
// 内嵌主页标签（home-shell）的开发态地址与主窗口加载源保持同一配置（DEV_SERVER_HOST/PORT）
const { config, getUrl } = require('../config/app-config')

// 左侧导航栏宽度（与前端 MpSidebar 的 CSS 变量 --mp-sidebar-width 保持一致）
// 默认 200px，窄屏（≤900px）时 68px；由渲染进程通过 IPC 动态同步
const SIDEBAR_WIDTH_DEFAULT = 200

// 账号级持久会话分区标识校验（与 comment-manager 保持一致）
const SAFE_IDENTIFIER = /^[a-zA-Z0-9_-]+$/

// 方案一（治本）：账号标签登录成功后自动回写凭证的去抖窗口（毫秒）。
// 稳定后再保存，避免把加载中间态的半截导航误判为登录成功（对齐 auth-view-manager 的 3s 自动完成，此处略短）。
const AUTO_SAVE_DEBOUNCE_MS = 1500

function _getUserDataDir () {
  try { return app.getPath('userData') } catch (e) { return path.join(os.homedir(), '.multi-publish') }
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

// 固定首页标签 ID（对齐参考产品：第 1 个标签永远是应用主页，不可关闭，不占用真实 WebContentsView）
const HOME_TAB_ID = 'home'

// 虚拟登录标签 ID（对齐参考产品：登录页以全屏标签形式呈现在 TabBar 中）
const AUTH_TAB_ID = 'auth-login'

// ─── 内嵌主页标签（home-shell，PRD-TAB-INDEPENDENT-HOME-2026-09-22）───
// 壳态参数：渲染层据此识别「本窗口是 + 新标签中的独立 SPA 实例」，跳过标签系统
// 订阅并按首页壳渲染；home-shell-preload 的双判据安全校验（主进程注入
// --mp-home-shell-url + 文档同源且参数仍在）以其为 electronAPI 暴露面闸门。
const HOME_SHELL_PARAM = 'mp-home-shell=1'

/**
 * 内嵌主页标签加载的本应用主页地址。
 * 打包态：file:// dist/index.html（与主窗口同一入口）；开发态：devServer 地址（与主窗口同源）。
 * hash 路由（createWebHashHistory）下 search 先于 hash，固定为 /?mp-home-shell=1 形态，SPA 路由从 '#/' 起始。
 * @returns {string}
 */
function _homeShellUrl () {
  return app.isPackaged
    ? pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href + '?' + HOME_SHELL_PARAM
    : getUrl(config.devServer) + '/?' + HOME_SHELL_PARAM
}

/**
 * 解析内嵌主页标签的 preload：优先 esbuild 产物 bundle（与主窗口 index.bundle.js 同策略，
 * sandbox 下由 Electron 内部机制加载），bundle 不存在（未跑 build:preload 的测试/裸环境）回退源文件。
 * @returns {string}
 */
function _homeShellPreloadPath () {
  const base = path.join(__dirname, '..', 'home-shell-preload')
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

// 各平台创作者中心/后台 URL → @multi-publish/shared-utils/src/platform-definitions

class WebviewManager extends EventEmitter {
  constructor () {
    super()
    this.mainWindow = null

    // ─── 浏览器标签页系统 ──────────────────────
    /** @type {Map<string, WebContentsView>} */
    this._tabViews = new Map()
    /** @type {Map<string, {url: string, title: string, loading: boolean, canGoBack: boolean, canGoForward: boolean}>} */
    this._tabStates = new Map()
    this._activeTabId = HOME_TAB_ID
    this._homeTabId = HOME_TAB_ID
    this._tabIdCounter = 0
    /** @type {Set<string>} */
    this._subscribers = new Set()

    // ─── 虚拟登录标签（对齐参考产品全屏登录体验）──────────
    /** @type {import('./auth-view-manager')|null} */
    this._authViewManager = null
    /** @type {import('./qrcode-login')|null} */
    this._qrCodeLogin = null
    /** @type {{tabId: string, url: string, title: string, platform: string, isLogin: boolean, manager?: object}|null} */
    this._authTabInfo = null
    /** @type {string|null} 打开登录标签前的活动标签，用于关闭后回退 */
    this._authPrevTabId = null

    // AccountManager 持有当前身份 owner_subject，并负责从加密凭证库读取账号会话。
    // 不在此处直接读取 credential-store，避免绕过身份命名空间。
    this._accountManager = null

    // 左侧导航栏当前宽度（由渲染进程通过 IPC 同步，默认 200px）
    this._sidebarWidth = SIDEBAR_WIDTH_DEFAULT
    // 壳态（T0-6b）：'browser'（浏览器壳，默认）| 'workbench'（工作台壳态，内嵌视图互斥隐藏）
    this._shellMode = 'browser'
  }

  // ─── 虚拟登录标签集成 ──────────────────────────

  /**
   * 挂载 AuthViewManager，接管登录视图的标签化呈现
   * @param {Object} authViewManager
   */
  attachAuthViewManager (authViewManager) {
    var self = this
    this._authViewManager = authViewManager
    authViewManager.onOpened = function (info) { self._onAuthViewOpened(info, authViewManager) }
    authViewManager.onClosed = function () { self._onAuthViewClosed(authViewManager) }
  }

  /**
   * 挂载二维码登录管理器，使扫码页与普通网页登录共用虚拟登录标签生命周期。
   * @param {Object} qrCodeLogin
   */
  attachQrCodeLogin (qrCodeLogin) {
    if (!qrCodeLogin) return
    var self = this
    this._qrCodeLogin = qrCodeLogin
    qrCodeLogin.onOpened = function (info) { self._onAuthViewOpened(info, qrCodeLogin) }
    qrCodeLogin.onClosed = function () { self._onAuthViewClosed(qrCodeLogin) }
  }

  /**
   * 登录视图打开 → 注入虚拟登录标签并切换为活动标签
   * @param {{platform: string, accountId: string|null, url: string}} info
   */
  _onAuthViewOpened (info, viewManager) {
    var self = this
    if (!info) return

    // 同一时刻只保留一个登录标签，避免两个 WebContentsView 叠在页面上。
    if (self._authTabInfo) {
      if (self._authTabInfo.manager === viewManager) return
      var previousLoginManager = self._authTabInfo.manager
      if (previousLoginManager && typeof previousLoginManager.close === 'function') {
        previousLoginManager.close()
      }
      if (self._authTabInfo) return
    }

    var platform = info.platform || ''
    var title = getPlatformName(platform) + '登录'
    self._authTabInfo = {
      tabId: AUTH_TAB_ID,
      url: info.url || '',
      title: title,
      platform: platform,
      isLogin: true,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      manager: viewManager || self._authViewManager
    }
    // 记录回退目标并隐藏所有浏览器标签
    self._authPrevTabId = self._activeTabId
    self._hideAllTabs()
    self._activeTabId = AUTH_TAB_ID

    self._broadcast('tab-created', { tabId: AUTH_TAB_ID, url: self._authTabInfo.url, isLogin: true })
    self._broadcast('tab-switched', {
      tabId: AUTH_TAB_ID,
      url: self._authTabInfo.url,
      title: title,
      isLogin: true
    })
    log.info('WebviewManager', 'Auth login tab opened: ' + platform)
  }

  /**
   * 登录视图关闭 → 移除虚拟登录标签并回退到之前的标签
   */
  _onAuthViewClosed (viewManager) {
    var self = this
    if (!self._authTabInfo) return
    if (viewManager && self._authTabInfo.manager && self._authTabInfo.manager !== viewManager) return

    // 用户在登录期间可能已经主动切到另一个标签。此时仅移除虚拟登录标签，
    // 不应以"恢复原标签"覆盖用户当前的显式选择。
    var authTabWasActive = self._activeTabId === AUTH_TAB_ID
    self._authTabInfo = null
    var prevTabId = self._authPrevTabId
    self._authPrevTabId = null
    self._broadcast('tab-closed', { tabId: AUTH_TAB_ID })
    if (!authTabWasActive) return

    // 回退：优先恢复之前的浏览器标签，否则回到首页（仅重置 activeTabId，不广播 tab-switched）
    if (prevTabId && self._tabViews.has(prevTabId)) {
      self.switchToTab(prevTabId)
    } else {
      self._hideAllTabs()
      self._activeTabId = self._homeTabId
    }
  }


  /**
   * 获取虚拟登录标签信息（含活动状态）
   * @returns {Object|null}
   */
  _getAuthTab () {
    if (!this._authTabInfo) return null
    var info = this._authTabInfo
    return {
      tabId: info.tabId,
      url: info.url,
      title: info.title,
      platform: info.platform,
      isLogin: true,
      loading: info.loading,
      canGoBack: false,
      canGoForward: false,
      isActive: this._activeTabId === AUTH_TAB_ID,
      isHome: false
    }
  }

  setMainWindow (win) {
    this.mainWindow = win
  }

  _getActiveLoginViewManager () {
    if (this._authTabInfo && this._authTabInfo.manager) return this._authTabInfo.manager
    return this._authViewManager
  }

  _hideActiveLoginView () {
    var loginViewManager = this._getActiveLoginViewManager()
    if (loginViewManager && typeof loginViewManager.hide === 'function') loginViewManager.hide()
  }

  /**
   * 注入账号凭证读取器。启动阶段由 bootstrap 接线，运行时 owner_subject
   * 由 AccountManager 的身份提供器解析。
   * @param {object|null} accountManager
   */
  setAccountManager (accountManager) {
    this._accountManager = accountManager || null
  }

  // ─── 浏览器标签页管理 ──────────────────────────

  /**
   * 检测新标签页系统是否有活动窗口
   * @returns {boolean}
   */
  _mainWindowAvailable () {
    return !!(this.mainWindow && this._tabViews && this._tabViews.size > 0)
  }

  // ─── 新标签页（浏览器式）──────────────────────

  /**
   * 创建新的浏览器标签页
   * @param {Object} [opts]
   * @param {string} [opts.url] - 初始 URL（默认 about:blank）
   * @param {Array} [opts.cookies] - 需要恢复的 Cookie 数组
   * @param {string} [opts.accountId] - 账号 ID（使用按账号持久分区并从加密凭证恢复登录态）
   * @returns {string|null} tabId
   */
  createNewTabPage (opts) {
    if (!this.mainWindow) return null

    var self = this
    var tabId = 'btab-' + (++this._tabIdCounter)
    var platform = (opts && opts.platform) || ''
    // 「+」新标签语义（PRD-TAB-INDEPENDENT-HOME F1/F2）：默认内容为应用主页的独立 SPA 实例；
    // 显式 homeShell，或 url 缺省/about:blank 一律等价降级为 home-shell，不再产生可见空白标签。
    var requestedUrl = (opts && typeof opts.url === 'string') ? opts.url.trim() : ''
    var homeShell = Boolean((opts && opts.homeShell === true) || !requestedUrl || requestedUrl === 'about:blank')
    var initialUrl = homeShell ? _homeShellUrl() : requestedUrl
    // 账号级标签使用按账号持久化的 session 分区，保持创作者中心登录态。
    // home-shell 与账号会话互斥：主页实例走独立 browse 分区，不读凭证 / 不挂登录诊断。
    var accountId = homeShell ? null : ((opts && opts.accountId) || null)
    var useAccountSession = typeof accountId === 'string' && SAFE_IDENTIFIER.test(accountId)
    var partition = useAccountSession
      ? 'persist:account-' + accountId
      : 'persist:browse-' + tabId
    var viewSession = session.fromPartition(partition, { cache: true })
    var cookieRestorations = []

    // 账号 session 挂接登录网络诊断：webRequest 能观察到登录页 iframe 内部
    // 请求（二维码 mpqrconnect 等）的失败，弥补 did-fail-load 不触发的盲区。
    // 仅对 account 分区挂接，home/普通浏览标签不挂；模块内幂等，复用同分区不翻倍。
    if (useAccountSession) {
      try {
        attachLoginNetworkDiagnostics(viewSession, { platform: platform || 'unknown', accountId: accountId || 'unknown' })
      } catch (e) { log.warn('WebviewManager', 'login network diag attach failed: ' + ((e && e.message) || 'unknown')) }
    }

    // 从当前身份命名空间的加密凭证恢复账号会话。旧版本没有 AccountManager
    // 接线时回退到 legacy credential-store，兼容已有本地账号。
    //
    // ⚠️ cleanSession（cleanSession:true，批量登录/失效账号打开登录页传入）：
    // 跳过凭证恢复并清空分区残留 Cookie。根因（2026-09-16 微信公众号实测）：
    // 失效账号的旧身份 Cookie（wxuin/ua_id 等）被恢复进登录页 session 后，
    // 微信服务端校验身份与登录态不符，在 getqrcode 环节返回 200 空体，
    // 页面显示「二维码加载失败」。登录页必须以干净身份加载。
    // 详见 01-docs/BUGFIX-LOGIN-QR-STALE-COOKIE-2026-09-16.md。
    var cleanSession = Boolean(useAccountSession && opts && opts.cleanSession === true)
    var accountCredential = null
    if (useAccountSession) {
      try {
        if (this._accountManager && typeof this._accountManager.loadSavedCredentials === 'function') {
          accountCredential = this._accountManager.loadSavedCredentials(accountId, platform)
        } else {
          accountCredential = credentialStore.loadCredential(accountId, _getUserDataDir())
        }
      } catch (e) {
        log.warn('WebviewManager', 'loadSavedCredentials failed ' + platform + ':' + accountId + ' err=' + ((e && e.message) || 'unknown'))
        accountCredential = null
      }
      if (!cleanSession) {
        var credCookies = (accountCredential && Array.isArray(accountCredential.cookies)) ? accountCredential.cookies : []
        var initialUrlForCookies = initialUrl === 'about:blank' ? '' : initialUrl
        for (var ci = 0; ci < credCookies.length; ci++) {
          var cookieToSet = normalizeElectronCookie(credCookies[ci], initialUrlForCookies)
          if (!cookieToSet) continue
          try {
            cookieRestorations.push(Promise.resolve(viewSession.cookies.set(cookieToSet)).catch(function (e2) {
              log.warn('WebviewManager', 'credential cookie restore failed name=' + (cookieToSet.name || '') + ' err=' + ((e2 && e2.message) || 'unknown'))
            }))
          } catch (e) { log.warn('WebviewManager', 'credential cookie restore threw name=' + (cookieToSet.name || '') + ' err=' + ((e && e.message) || 'unknown')) }
        }
      } else {
        // 清空持久分区里的残留 Cookie（可能是上次打开时恢复/写入的失效身份 Cookie），
        // 必须在首个导航请求前完成，故挂入 cookieRestorations 由 navigateAfterCookies 等待。
        cookieRestorations.push(viewSession.cookies.get({}).then(function (existing) {
          var stale = existing || []
          var removals = stale.map(function (c) {
            var removeUrl = (c.secure ? 'https' : 'http') + '://' + String(c.domain || '').replace(/^\./, '') + (c.path || '/')
            return Promise.resolve(viewSession.cookies.remove(removeUrl, c.name)).catch(function () {})
          })
          return Promise.all(removals).then(function () {
            log.info('WebviewManager', '[' + (platform || 'unknown') + ':' + (accountId || '') + '] clean login session: skipped credential restore, cleared ' + stale.length + ' stale cookies')
          })
        }).catch(function (e) {
          log.warn('WebviewManager', 'clean session clear failed ' + (platform || '') + ':' + (accountId || '') + ' err=' + ((e && e.message) || 'unknown'))
        }))
      }
    }

    // 恢复调用方明确传入的 Cookie；与账号凭证一样必须等待设置完成。
    if (opts && opts.cookies && opts.cookies.length > 0) {
      var cookies = opts.cookies
      for (var i = 0; i < cookies.length; i++) {
        var suppliedCookie = normalizeElectronCookie(cookies[i], initialUrl === 'about:blank' ? '' : initialUrl)
        if (!suppliedCookie) continue
        try {
          cookieRestorations.push(Promise.resolve(viewSession.cookies.set(suppliedCookie)).catch(function (e2) {
            log.warn('WebviewManager', 'supplied cookie restore failed name=' + (suppliedCookie.name || '') + ' err=' + ((e2 && e2.message) || 'unknown'))
          }))
        } catch (e) { log.warn('WebviewManager', 'supplied cookie restore threw name=' + (suppliedCookie.name || '') + ' err=' + ((e && e.message) || 'unknown')) }
      }
    }

    // 内嵌主页标签挂受守护的 home-shell preload（双判据后才暴露完整 electronAPI），
    // 并通过 additionalArguments 注入期望地址（判据①）；普通标签维持 monitor 桥。
    var viewWebPreferences = {
      session: viewSession,
      preload: path.join(__dirname, '..', 'monitor-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
    if (homeShell) {
      viewWebPreferences.preload = _homeShellPreloadPath()
      viewWebPreferences.additionalArguments = ['--mp-home-shell-url=' + initialUrl]
    }
    var view = new WebContentsView({ webPreferences: viewWebPreferences })

    // 隐藏其他标签页，显示当前
    self._hideAllTabs()
    view.setVisible(true)
    self.mainWindow.contentView.addChildView(view)

    // 设置初始状态
    self._tabViews.set(tabId, view)
    // 支持调用方传入标签页标题（创作者中心等场景需在标签栏显示账号专属标题）
    var initialTitle = (opts && typeof opts.title === 'string' && opts.title.trim())
      ? opts.title.trim()
      : (homeShell ? '新标签页' : 'New Tab')
    self._tabStates.set(tabId, {
        // home-shell 标签对外展示地址恒为空（与首页虚拟标签一致），真实主页地址不灌进地址栏
        url: homeShell ? '' : initialUrl,
        title: initialTitle,
        homeShell: homeShell,
        titleLocked: Boolean(opts && typeof opts.title === 'string' && opts.title.trim()),
        loading: false,
        canGoBack: false,
        canGoForward: false
        // 账号标签标识：关闭标签时用于自动把 session 分区 Cookie 回写加密凭证库
        // （首页批量登录等普通标签场景没有 auth-view-manager 的 CDP 捕获链路，
        // 关闭前回写可让下次 checkLocalCredentials 命中加密文件主路径）
        ,
        accountId: useAccountSession ? accountId : null,
        platform: platform || null,
        // 凭证保存态（三方案共享原语）：批量登录/失效账号重新登录以干净会话打开，登录态尚未回写
        // 加密凭证库时为 'unsaved'；成功回写后置 'saved'；非「待保存」语义标签为 null。
        credentialSaveState: (useAccountSession && cleanSession) ? 'unsaved' : null,
        // 初始重定向守卫：登录页首帧加载完成前的跳转链不视为登录成功（对齐 auth-view-manager）。
        initialRedirectPhase: useAccountSession === true,
        _autoSaveTimer: null
      })
    self._activeTabId = tabId

    // 设置导航监听
    self._setupNav(tabId, view)

    // 页面加载后恢复账号 localStorage（与 createNewTabPage 的凭证恢复模式一致）
    // cleanSession 模式下跳过：失效账号的旧 localStorage 同样可能让平台按已登录态走异常流程
    var credLocalStorage = (!cleanSession && accountCredential && accountCredential.localStorage && typeof accountCredential.localStorage === 'object')
      ? accountCredential.localStorage
      : null
    if (credLocalStorage && Object.keys(credLocalStorage).length > 0) {
      var credLsData = JSON.stringify(credLocalStorage)
      var localStorageRestored = false
      view.webContents.on('did-finish-load', function () {
        if (localStorageRestored) return
        localStorageRestored = true
        Promise.resolve(view.webContents.executeJavaScript(
          '(function() {\n' +
          '  var data = ' + credLsData + ';\n' +
          '  Object.keys(data).forEach(function(k) {\n' +
          '    try { localStorage.setItem(k, data[k]); } catch (e) { /* ignore */ }\n' +
          '  });\n' +
          '})()'
        )).then(function () {
          // 首次页面可能已按“未登录”状态渲染；写入 token 后重新请求目标页，
          // 让平台在首个有效应用请求中读取到 localStorage。
          if (initialUrl && initialUrl !== 'about:blank') {
            return view.webContents.loadURL(initialUrl).catch(function () {})
          }
        }, function () {})
      })
    }

    // Cookie 必须在首个导航请求前完成。否则平台会先收到无凭证请求并把标签
    // 重定向到登录页，随后才写入 Cookie，用户看到的就是“账号已添加但未登录”。
    var navigateAfterCookies = function () {
      if (initialUrl && initialUrl !== 'about:blank') {
        view.webContents.loadURL(initialUrl).catch(function (e) { log.warn('WebviewManager', 'nav failed url=' + String(initialUrl).slice(0, 200) + ' err=' + ((e && e.message) || 'unknown')) })
      }
    }
    if (cookieRestorations.length > 0 || useAccountSession) {
      Promise.all(cookieRestorations).then(navigateAfterCookies, navigateAfterCookies)
    } else {
      navigateAfterCookies()
    }

    // 调整位置
    self._repositionAll()
    self._broadcast('tab-created', { tabId: tabId, url: homeShell ? '' : initialUrl })

    log.info('WebviewManager', 'Created new tab: ' + tabId)
    return tabId
  }

  /**
   * 关闭指定标签页
   * @param {string} tabId
   * @returns {boolean}
   */
  closeTab (tabId) {
    var self = this

    // Home tab 不可关闭
    if (tabId === self._homeTabId) return false

    // 虚拟登录标签：关闭即结束登录会话（触发 onClosed 钩子完成标签清理）
    if (tabId === AUTH_TAB_ID) {
      var loginViewManager = self._getActiveLoginViewManager()
      if (loginViewManager && typeof loginViewManager.close === 'function') {
        loginViewManager.close()
        return true
      }
      return false
    }

    // 处理新浏览器标签
    if (self._tabViews.has(tabId)) {
      var view = self._tabViews.get(tabId)
      // 关闭前清理未触发的自动保存计时器，避免对已销毁 view 执行回写。
      var closingState = self._tabStates.get(tabId)
      if (closingState && closingState._autoSaveTimer) { clearTimeout(closingState._autoSaveTimer); closingState._autoSaveTimer = null }
      self._tabViews.delete(tabId)
      self._tabStates.delete(tabId)

      try {
        if (self.mainWindow && self.mainWindow.contentView) {
          self.mainWindow.contentView.removeChildView(view)
        }
        view.webContents.close()
      } catch (e) { /* ignore */ }

      // 切换到下一个标签
      if (self._activeTabId === tabId) {
        self._activeTabId = null
        var tabIds = Array.from(self._tabViews.keys())
        if (tabIds.length > 0) {
          self.switchToTab(tabIds[0])
        } else {
          self._broadcast('all-tabs-closed', {})
        }
      }

      self._broadcast('tab-closed', { tabId: tabId })
      log.info('WebviewManager', 'Closed tab: ' + tabId)
      return true
    }

    return false
  }

  /**
   * 切换到指定标签页
   * @param {string} tabId
   * @returns {boolean}
   */
  switchToTab (tabId) {
    var self = this

    // Home tab：隐藏所有 WebContentsView，显示 router-view
    if (tabId === self._homeTabId) {
      if (self._activeTabId === AUTH_TAB_ID) {
        self._hideActiveLoginView()
      }
      self._hideAllTabs()
      self._activeTabId = tabId
      self._broadcast('tab-switched', {
        tabId: tabId,
        url: '',
        title: '首页'
      })
      return true
    }

    // 虚拟登录标签：显示登录视图，隐藏浏览器标签
    if (tabId === AUTH_TAB_ID) {
      var loginViewManager = self._getActiveLoginViewManager()
      if (!self._authTabInfo || !loginViewManager || typeof loginViewManager.show !== 'function') return false
      self._hideAllTabs()
      loginViewManager.show()
      self._activeTabId = tabId
      self._broadcast('tab-switched', {
        tabId: tabId,
        url: self._authTabInfo.url,
        title: self._authTabInfo.title,
        isLogin: true
      })
      return true
    }

    if (!self._tabViews.has(tabId)) return false

    // 离开登录标签时隐藏登录视图
    if (self._activeTabId === AUTH_TAB_ID) {
      self._hideActiveLoginView()
    }

    // 隐藏当前活动标签
    if (self._activeTabId && self._tabViews.has(self._activeTabId)) {
      self._tabViews.get(self._activeTabId).setVisible(false)
    }

    // 显示目标标签
    var targetView = self._tabViews.get(tabId)
    targetView.setVisible(true)
    self._activeTabId = tabId

    // 调整位置
    self._repositionAll()

    var state = self._tabStates.get(tabId)
    self._broadcast('tab-switched', {
      tabId: tabId,
      url: state ? state.url : '',
      title: state ? state.title : ''
    })

    return true
  }

  /**
   * 关闭所有浏览器标签页（保留 home tab）
   */
  closeAll () {
    var self = this
    var tabIds = Array.from(self._tabViews.keys())

    for (var i = 0; i < tabIds.length; i++) {
      var id = tabIds[i]
      if (id === self._homeTabId) continue

      var view = self._tabViews.get(id)
      self._tabViews.delete(id)
      self._tabStates.delete(id)

      try {
        if (self.mainWindow && self.mainWindow.contentView) {
          self.mainWindow.contentView.removeChildView(view)
        }
        view.webContents.close()
      } catch (e) { /* ignore */ }
    }

    self._activeTabId = self._homeTabId
    self._repositionAll()
    self._broadcast('all-tabs-closed', {})
    log.info('WebviewManager', 'All browser tabs closed')
  }

  /**
   * 获取所有标签页信息
   * @returns {Array}
   */
  getAllTabs () {
    var self = this
    var result = []
    // home 标签可能尚未物化（_tabStates 无记录），保证列表始终包含 home
    if (self._homeTabId && !self._tabStates.has(self._homeTabId)) {
      result.push({
        tabId: self._homeTabId,
        url: '',
        title: '首页',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        isActive: self._activeTabId === self._homeTabId,
        isHome: true
      })
    }
    self._tabStates.forEach(function (state, tabId) {
      result.push({
        tabId: tabId,
        url: state.url,
        title: state.title,
        loading: state.loading,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
        isActive: tabId === self._activeTabId,
        isHome: tabId === self._homeTabId,
        // 账号标签标识：渲染层据此显示「保存账号」按钮（批量登录标签无 isLogin）
        accountId: state.accountId || null,
        platform: state.platform || null,
        credentialSaveState: state.credentialSaveState || null
      })
    })
    // 虚拟登录标签（对齐参考产品全屏登录）
    var authTab = self._getAuthTab()
    if (authTab) result.push(authTab)
    return result
  }

  /**
   * 获取当前活动标签页
   * @returns {Object|null}
   */
  getActiveTab () {
    // 虚拟登录标签活动态
    if (this._activeTabId === AUTH_TAB_ID) return this._getAuthTab()
// Home tab：固定虚拟标签，不存在于 _tabStates
    if (this._activeTabId === this._homeTabId) {
      return {
        tabId: this._homeTabId,
        url: '',
        title: '首页',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        isHome: true
      }
    }
    if (!this._activeTabId || !this._tabStates.has(this._activeTabId)) return null
    var state = this._tabStates.get(this._activeTabId)
    return {
      tabId: this._activeTabId,
      url: state.url,
      title: state.title,
      loading: state.loading,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      isHome: this._activeTabId === this._homeTabId,
      accountId: state.accountId || null,
      platform: state.platform || null,
      credentialSaveState: state.credentialSaveState || null
    }
  }

  /**
   * 获取 home 标签页信息
   * @returns {Object|null}
   */
  getHomeTab () {
    if (!this._homeTabId) return null
    // Home tab 是固定虚拟标签，无 WebContentsView，返回静态信息
    if (this._homeTabId === HOME_TAB_ID) {
      return {
        tabId: this._homeTabId,
        url: '',
        title: '首页',
        loading: false,
        canGoBack: false,
        canGoForward: false
      }
    }
    if (!this._tabStates.has(this._homeTabId)) return null
    var state = this._tabStates.get(this._homeTabId)
    return {
      tabId: this._homeTabId,
      url: state.url,
      title: state.title,
      loading: state.loading,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward
    }
  }

  /**
   * 后退
   * @param {string} tabId
   * @returns {boolean}
   */
  goBack (tabId) {
    var self = this
    var view = self._tabViews.get(tabId)
    if (!view) return false
    if (view.webContents.canGoBack()) {
      view.webContents.goBack()
      return true
    }
    return false
  }

  /**
   * 前进
   * @param {string} tabId
   * @returns {boolean}
   */
  goForward (tabId) {
    var self = this
    var view = self._tabViews.get(tabId)
    if (!view) return false
    if (view.webContents.canGoForward()) {
      view.webContents.goForward()
      return true
    }
    return false
  }

  /**
   * 刷新
   * @param {string} tabId
   * @param {boolean} [ignoreCache]
   */
  reload (tabId, ignoreCache) {
    var view = this._tabViews.get(tabId)
    if (!view) return
    if (ignoreCache) {
      view.webContents.reloadIgnoringCache()
    } else {
      view.webContents.reload()
    }
  }

  /**
   * 导航到指定 URL
   * @param {string} tabId
   * @param {string} url
   * @returns {boolean}
   */
  navigateTab (tabId, url) {
    var self = this
    var view = self._tabViews.get(tabId)
    if (!view) return false

    // URL 协议校验
    try {
      var parsed = new URL(url)
      if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) {
        log.warn('WebviewManager', 'Blocked non-http(s/file) URL: ' + parsed.protocol)
        return false
      }
    } catch (e) {
      log.warn('WebviewManager', 'Invalid URL: ' + url)
      return false
    }

    view.webContents.loadURL(url).catch(function (e) { log.warn('WebviewManager', 'nav failed url=' + String(url).slice(0, 200) + ' err=' + ((e && e.message) || 'unknown')) })
    return true
  }

  /**
   * 搜索或导航（输入是 URL 则直接打开，否则 Bing 搜索）
   * @param {string} query
   * @param {string} tabId
   * @returns {boolean}
   */
  searchOrNavigate (query, tabId) {
    var self = this
    var targetTabId = tabId || self._activeTabId
    if (!targetTabId) return false

    // 判断是否为 URL
    var isUrl = false
    try {
      var parsed = new URL(query)
      if (['http:', 'https:', 'file:'].includes(parsed.protocol)) {
        isUrl = true
      }
    } catch (e) { /* not a URL */ }

    if (!isUrl) {
      // 检测不带协议的域名（如 example.com）
      if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(query)) {
        isUrl = true
        query = 'https://' + query
      }
    }

    if (isUrl) {
      return self.navigateTab(targetTabId, query)
    } else {
      return self.navigateTab(targetTabId, 'https://www.bing.com/search?q=' + encodeURIComponent(query))
    }
  }

  /**
   * 保存当前标签页 Cookie
   * @param {string} tabId
   */
  saveCookies (tabId) {
    var self = this
    var view = self._tabViews.get(tabId)
    if (!view) return

    self._extractTabCookies(view, tabId).then(function (cookies) {
      self.emit('tab-cookies-changed', { tabId: tabId, cookies: cookies })
    }).catch(function (e) {
      log.warn('WebviewManager', 'saveCookies: extract failed for ' + tabId + ': ' + ((e && e.message) || 'unknown'))
    })
  }

  /**
   * 提取标签页所在 session 分区的全部 Cookie。
   * ⚠️ Electron 的 Session.cookies 只提供 get/set/remove/flush，**没有 getAll**；
   * 误用 getAll 会抛 "is not a function"，若被上层 catch 吞掉，症状是「保存成功
   * 但 cookies=0」（2026-09-22 账号登录态误判事故根因）。这里集中一处并显式抛错。
   * @param {object} view WebContentsView
   * @param {string} tabId 仅用于日志
   * @returns {Promise<Array>}
   */
  async _extractTabCookies (view, tabId) {
    var viewSession = view && view.webContents && view.webContents.session
    if (!viewSession || !viewSession.cookies || typeof viewSession.cookies.get !== 'function') {
      throw new Error('session-cookies-unavailable')
    }
    var list = await viewSession.cookies.get({})
    return Array.isArray(list) ? list : []
  }

  /**
   * 保存账号浏览器标签的凭证到加密凭证库（批量登录标签的手动保存入口）。
   * 提取该标签 session 分区的 Cookie + localStorage，经 AccountManager
   * updateCapturedAccount 覆盖已有账号凭证（重新登录语义，不创建新账号）。
   * @param {string} tabId
   * @returns {Promise<{ok: boolean, reason?: string, accountId?: string, platform?: string}>}
   */
  async saveAccountTabCredentials (tabId) {
    var self = this
    var view = self._tabViews.get(tabId)
    var state = self._tabStates.get(tabId)
    if (!view || !state) return { ok: false, reason: 'tab-not-found' }
    var accountId = state.accountId
    var platform = state.platform
    if (!accountId || !platform) return { ok: false, reason: 'not-account-tab' }

    // 契约：Cookie 提取失败必须 fail-closed——不落盘、保持 unsaved、不广播 saved。
    // Electron session.cookies 只有 get([filter])，不存在 getAll；此前误用 getAll 使
    // TypeError 被吞后以 cookies=[] 继续保存（假成功），失效账号扫码重登后凭证库仍是
    // 0 Cookie，再开创作者中心弹回登录页（回归 2026-09-22）。
    var cookies
    try {
      cookies = await self._extractTabCookies(view, tabId)
    } catch (e) {
      var cookieExtractError = (e && e.message) ? e.message : String(e)
      log.warn('WebviewManager', 'saveAccountTabCredentials: cookies.get failed for ' + tabId + ', aborting save: ' + cookieExtractError)
      return { ok: false, reason: 'cookie-extract-failed', detail: cookieExtractError, accountId: accountId, platform: platform }
    }
    if (!Array.isArray(cookies)) cookies = []

    var localStorageData = {}
    try {
      var extracted = await view.webContents.executeJavaScript(
        '(function(){try{var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);o[k]=localStorage.getItem(k);}return o;}catch(e){return {};}})()'
      )
      if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) {
        for (var key of Object.keys(extracted)) {
          if (typeof key === 'string' && typeof extracted[key] === 'string') localStorageData[key] = extracted[key]
        }
      }
    } catch (e) { /* localStorage 提取失败不阻断 Cookie 保存 */ }

    if (!self._accountManager || typeof self._accountManager.updateCapturedAccount !== 'function') {
      return { ok: false, reason: 'account-manager-unavailable' }
    }
    if (cookies.length === 0) {
      log.warn('WebviewManager', 'saveAccountTabCredentials: 0 cookies extracted for ' + platform + ':' + accountId + '（可能未登录或分区不匹配）')
    }
    try {
      await self._accountManager.updateCapturedAccount(platform, {
        cookies: cookies,
        localStorage: localStorageData,
        name: state.title || ''
      }, accountId)
      state.credentialSaveState = 'saved'
      if (state._autoSaveTimer) { clearTimeout(state._autoSaveTimer); state._autoSaveTimer = null }
      self._broadcastCredentialState(tabId, 'saved')
      log.info('WebviewManager', 'saveAccountTabCredentials: saved ' + platform + ':' + accountId + ' cookies=' + cookies.length + ' lsKeys=' + Object.keys(localStorageData).length)
      return { ok: true, accountId: accountId, platform: platform }
    } catch (e) {
      log.warn('WebviewManager', 'saveAccountTabCredentials: updateCapturedAccount failed for ' + platform + ':' + accountId + ': ' + (e && e.message ? e.message : String(e)))
      return { ok: false, reason: (e && e.message) ? e.message : 'save-failed', accountId: accountId, platform: platform }
    }
  }

  /**
   * 方案一（治本）：账号标签导航时判定登录成功并去抖自动回写凭证。
   * 仅 credentialSaveState==='unsaved' 的账号标签参与；不在初始重定向阶段且 URL 命中平台登录
   * 成功模式时安排（重新安排）一次自动保存，未命中则取消待触发计时器（用户反复横跳时只在稳定后保存）。
   * @param {string} tabId
   * @param {object} [state]
   */
  _maybeScheduleAutoSave (tabId, state) {
    var self = this
    if (!state) state = self._tabStates.get(tabId)
    if (!state) return
    if (state.credentialSaveState !== 'unsaved') return
    if (!state.accountId || !state.platform) return
    if (state.initialRedirectPhase === true) return
    if (isPlatformLoginSuccessUrl(state.platform, state.url)) {
      if (state._autoSaveTimer) { clearTimeout(state._autoSaveTimer); state._autoSaveTimer = null }
      state._autoSaveTimer = setTimeout(function () {
        state._autoSaveTimer = null
        if (!self._tabStates.has(tabId)) return
        if (self._tabStates.get(tabId).credentialSaveState !== 'unsaved') return
        log.info('WebviewManager', 'auto-save triggered ' + state.platform + ':' + state.accountId)
        Promise.resolve(self.saveAccountTabCredentials(tabId)).then(function (result) {
          // saveAccountTabCredentials 内部已置 saved 并广播保存态；这里补发 auth:completed
          // 让渲染层刷新失效账号列表（对齐手动保存 IPC 成功链路）。失败保持 unsaved，等下次导航重试。
          if (result && result.ok) {
            var win = self.mainWindow
            if (win && !win.isDestroyed()) {
              win.webContents.send('auth:completed', { platform: result.platform, accountId: result.accountId })
            }
          }
        }).catch(function (e) {
          log.warn('WebviewManager', 'auto-save threw ' + ((e && e.message) || e))
        })
      }, AUTO_SAVE_DEBOUNCE_MS)
      if (state._autoSaveTimer && state._autoSaveTimer.unref) state._autoSaveTimer.unref()
    } else {
      if (state._autoSaveTimer) { clearTimeout(state._autoSaveTimer); state._autoSaveTimer = null }
    }
  }

  /**
   * 广播某标签的凭证保存态（渲染层角标 / 护栏实时刷新）。
   * @param {string} tabId
   * @param {string|null} [credentialSaveState] 省略时取当前 state 值
   */
  _broadcastCredentialState (tabId, credentialSaveState) {
    var state = this._tabStates.get(tabId)
    var resolved = credentialSaveState == null
      ? (state ? (state.credentialSaveState || null) : null)
      : credentialSaveState
    this._broadcast('tab-credential-state-changed', {
      tabId: tabId,
      credentialSaveState: resolved,
      accountId: state ? (state.accountId || null) : null,
      platform: state ? (state.platform || null) : null
    })
  }

  /**
   * 查询账号标签凭证保存态（方案二：关闭护栏查询入口）。
   * @param {string} tabId
   * @returns {{isAccountTab: boolean, credentialSaveState: (string|null), accountId: (string|null), platform: (string|null)}}
   */
  getAccountTabSaveState (tabId) {
    var state = this._tabStates.get(tabId)
    if (!state || !state.accountId || !state.platform) {
      return { isAccountTab: false, credentialSaveState: null, accountId: null, platform: null }
    }
    return {
      isAccountTab: true,
      credentialSaveState: state.credentialSaveState || null,
      accountId: state.accountId,
      platform: state.platform
    }
  }

  /**
   * 方案三：批量保存全部待保存（unsaved）账号标签。
   * @returns {Promise<{attempted: number, saved: number, failed: Array<{accountId: string, platform: string, reason: string}>}>}
   */
  async saveAllUnsavedAccounts () {
    var self = this
    var attempted = 0
    var saved = 0
    var failed = []
    var tabIds = Array.from(self._tabStates.keys())
    for (var i = 0; i < tabIds.length; i++) {
      var state = self._tabStates.get(tabIds[i])
      if (!state || state.credentialSaveState !== 'unsaved' || !state.accountId || !state.platform) continue
      attempted += 1
      try {
        var result = await self.saveAccountTabCredentials(tabIds[i])
        if (result && result.ok) { saved += 1 } else {
          failed.push({ accountId: state.accountId, platform: state.platform, reason: (result && result.reason) || 'save-failed' })
        }
      } catch (e) {
        failed.push({ accountId: state.accountId, platform: state.platform, reason: (e && e.message) || 'save-failed' })
      }
    }
    return { attempted: attempted, saved: saved, failed: failed }
  }

  // ─── 窗口事件 ──────────────────────────────────

  /** 窗口大小变化时重新排列 */
  resize () {
    this._repositionAll()
  }

  /**
   * 设置左侧导航栏宽度（由渲染进程同步 CSS 变量 --mp-sidebar-width）
   * 默认 200px；窄屏（≤900px）时渲染进程传入 68px
   * @param {number} width - 像素宽度
   */
  // ─── 壳态互斥（T0-6b，A1 决策）────────────────────────────────
  // 工作台壳态（首页虚拟标签，SPA 渲染）下浏览器壳与工作台不同时展示：
  // 所有内嵌 WebContentsView（浏览器标签/登录视图/扫码视图）隐藏；
  // 切回浏览器壳时恢复显示并按当前 bounds 重定位。
  setShellMode (mode) {
    const valid = mode === 'workbench' || mode === 'browser'
    if (!valid) {
      log.warn('WebviewManager', 'Invalid shell mode ignored: ' + mode)
      return
    }
    if (this._shellMode === mode) return
    this._shellMode = mode
    if (mode === 'workbench') {
      // 互斥：隐藏全部内嵌视图（浏览器标签 + 登录视图 + 扫码视图）
      this._hideAllTabs()
      if (this._authViewManager && typeof this._authViewManager.hide === 'function') {
        this._authViewManager.hide()
      }
      if (this._qrCodeLogin && typeof this._qrCodeLogin.hide === 'function') {
        this._qrCodeLogin.hide()
      }
    } else {
      // 浏览器壳：恢复显示（按当前活动标签/登录态重定位）
      this._repositionAll()
    }
  }

  isWorkbenchShell () {
    return this._shellMode === 'workbench'
  }

  setSidebarWidth (width) {
    // 守卫：宽度必须严格 > 0。width <= 0 会让内嵌视图 x 落到 0、覆盖 x=0 的 MpSidebar，
    // 拦截侧边栏全部点击（2026-09-15「平台链接浮层盖住侧边栏」同类 Bug 的防御层之一）。
    // 阈值统一取自 view-bounds.js 的 MIN_SIDEBAR_WIDTH / MAX_SIDEBAR_WIDTH 单一真源，避免漂移。
    if (typeof width !== 'number' || width < MIN_SIDEBAR_WIDTH || width > MAX_SIDEBAR_WIDTH) {
      log.warn('WebviewManager', 'Invalid sidebar width ignored: ' + width)
      return
    }
    if (this._sidebarWidth !== width) {
      this._sidebarWidth = width
      // 同步到 AuthViewManager（登录视图也需避开左侧导航栏）
      if (this._authViewManager && typeof this._authViewManager.setSidebarWidth === 'function') {
        this._authViewManager.setSidebarWidth(width)
      }
      if (this._qrCodeLogin && typeof this._qrCodeLogin.setSidebarWidth === 'function') {
        this._qrCodeLogin.setSidebarWidth(width)
      }
      this._repositionAll()
    }
  }

  // ─── 内部方法 ──────────────────────────────────

  /**
   * 隐藏所有浏览器标签页的视图
   */
  _hideAllTabs () {
    var self = this
    self._tabViews.forEach(function (view) {
      view.setVisible(false)
    })
  }

  /**
   * 设置浏览器标签页导航监听
   * @param {string} tabId
   * @param {WebContentsView} view
   */
  _setupNav (tabId, view) {
    var self = this

    view.webContents.on('did-start-loading', function () {
      if (!self._tabStates.has(tabId)) return
      var state = self._tabStates.get(tabId)
      state.loading = true
      state.canGoBack = view.webContents.canGoBack()
      state.canGoForward = view.webContents.canGoForward()
      self._broadcast('tab-loading', { tabId: tabId, url: state.url, loading: true })
    })

    view.webContents.on('did-finish-load', function () {
      if (!self._tabStates.has(tabId)) return
      var state = self._tabStates.get(tabId)
      state.loading = false
      state.canGoBack = view.webContents.canGoBack()
      state.canGoForward = view.webContents.canGoForward()
      self._broadcast('tab-finished-loading', { tabId: tabId, url: state.url, loading: false })
      // 初始重定向阶段结束：此后导航才可作为登录成功判定信号。
      if (state.initialRedirectPhase) state.initialRedirectPhase = false
      // 覆盖「首帧即已登录」情形：当前 URL 已是成功页时同样安排自动保存。
      self._maybeScheduleAutoSave(tabId, state)
    })

      view.webContents.on('page-title-updated', function (event, title) {
        if (!self._tabStates.has(tabId)) return
        var state = self._tabStates.get(tabId)
        if (state.titleLocked) {
          self._broadcast('tab-title-updated', { tabId: tabId, title: state.title })
          return
        }
        state.title = title
        self._broadcast('tab-title-updated', { tabId: tabId, title: title })
      })

    view.webContents.on('did-navigate', function (event, url) {
      if (!self._tabStates.has(tabId)) return
      var state = self._tabStates.get(tabId)
      // home-shell 壳态自然结束（PRD-TAB-INDEPENDENT-HOME F5 / §6.5）：内嵌主页标签发生
      // 文档级导航且新地址不再携带 mp-home-shell=1（用户从外层地址栏导航去外部站点）时，
      // 本标签转为普通网页标签：解除壳态标记、解锁标题（页面 <title> 接管）、地址栏显示真实 URL。
      // hash 路由内导航走 did-navigate-in-page（search 先于 hash，参数仍在），不触发此分支。
      if (state.homeShell && !_urlHasHomeShellParam(url)) {
        state.homeShell = false
        state.titleLocked = false
        state.url = url
        state.realUrl = url
      } else if (state.homeShell) {
        // 仍在壳态（主页自身加载/刷新）：真实地址只记内部字段，对外展示/广播恒为空串
        state.realUrl = url
        state.url = ''
      } else {
        state.url = url
      }
      state.canGoBack = view.webContents.canGoBack()
      state.canGoForward = view.webContents.canGoForward()
      self._broadcastNav(tabId)
      self._maybeScheduleAutoSave(tabId, state)
    })

   view.webContents.on('did-navigate-in-page', function (event, url) {
     if (!self._tabStates.has(tabId)) return
     var state = self._tabStates.get(tabId)
     if (state.homeShell) { state.realUrl = url } else { state.url = url }
     self._broadcastNav(tabId)
     self._maybeScheduleAutoSave(tabId, state)
   })

    // ─── window.open / target=_blank 拦截（对齐参考产品）─────────────
    // 平台创作者中心内点击"个人中心"等链接会触发 window.open 或 target=_blank，
    // 默认 Electron 会弹出独立 BrowserWindow。这里拦截并在当前 tab 内直接导航，
    // 与参考产品"本页打开"行为保持一致。
    if (typeof view.webContents.setWindowOpenHandler === 'function') {
      view.webContents.setWindowOpenHandler(function (details) {
        var targetUrl = details && details.url
        if (!targetUrl || typeof targetUrl !== 'string') return { action: 'deny' }
        try {
          var parsed = new URL(targetUrl)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { action: 'deny' }
          }
        } catch (e) {
          return { action: 'deny' }
        }
        // 明确请求独立窗口（window.open 带特定 features / shift+click）→ 拒绝并交默认行为
        if (details.disposition === 'new-window') {
          return { action: 'deny' }
        }
        // 其它 disposition（foreground-tab / background-tab / default / other）→ 当前 tab 内导航
        self.navigateTab(tabId, targetUrl)
        return { action: 'deny' }
      })
    }
  }

  /**
   * 重新调整所有视图位置
   * 浏览器标签页填满 TOP=76px 以下区域，分屏标签使用原布局
   */
  _repositionAll () {
    if (!this.mainWindow) return
    var sidebarWidth = this._sidebarWidth || SIDEBAR_WIDTH_DEFAULT

    // 登录标签活动态：登录视图由 AuthViewManager 自行定位（全屏 y=76），
    // 浏览器标签保持隐藏，不做布局
    if (this._activeTabId === AUTH_TAB_ID && this._authTabInfo) {
      var loginViewManager = this._getActiveLoginViewManager()
      if (loginViewManager && typeof loginViewManager._onWindowResize === 'function') {
        loginViewManager._onWindowResize()
      }
    } else if (this._tabViews.size > 0) {
      // 处理浏览器标签页
      // 左侧导航栏为固定区域，WebContentsView 应定位在右侧主体区域
      var activeView = this._tabViews.get(this._activeTabId)
      if (activeView) {
        activeView.setBounds(computeEmbeddedViewBounds(this.mainWindow, sidebarWidth))
        activeView.setVisible(true)
      }
    }
  }

  /**
   * 获取 URL 域名
   * @param {string} url
   * @returns {string}
   */
  _getDomain (url) {
    try { return new URL(url).hostname } catch (e) { return '' }
  }

  /**
   * 广播事件给所有订阅者
   * @param {string} event
   * @param {Object} data
   */
  _broadcast (event, data) {
    var self = this
    self._subscribers.forEach(function (subscriberId) {
      try {
        if (self.mainWindow && !self.mainWindow.isDestroyed()) {
          self.mainWindow.webContents.send('page-manager:' + event, {
            subscriberId: subscriberId,
            data: data
          })
        }
      } catch (e) { /* ignore */ }
    })
  }

  /**
   * 广播导航事件
   * @param {string} tabId
   */
  _broadcastNav (tabId) {
    var self = this
    var state = self._tabStates.get(tabId)
    if (!state) return
    self._broadcast('navigation-changed', {
      tabId: tabId,
      url: state.url,
      title: state.title,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward
    })
  }

  // ─── IPC 桥接 ──────────────────────────────────

  /**
   * 注册 IPC handlers（供 main.js 调用）
   */
  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] webview-manager registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）');
    }
    var ipcMain = injectedIpcMain;
    var self = this;

    // ─── page-manager: IPC handlers（新标签页系统）──

    ipcMain.handle('page-manager:create-new-tab-page', withSenderCheck(function (_, arg) {
      try {
        var tabId = self.createNewTabPage(arg || {})
        return tabId ? { code: 0, data: { tabId: tabId } } : { code: EC.REQUEST_ERROR, message: '创建标签页失败，请重试' }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:close-tab', withSenderCheck(function (_, tabId) {
      try {
        self.closeTab(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:switch-tab', withSenderCheck(function (_, tabId) {
      try {
        self.switchToTab(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:navigate', withSenderCheck(function (_, arg) {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: 'Missing args' }
      try {
        self.navigateTab(arg.tabId, arg.url)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:go-back', withSenderCheck(function (_, tabId) {
      try {
        self.goBack(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:go-forward', withSenderCheck(function (_, tabId) {
      try {
        self.goForward(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:reload', withSenderCheck(function (_, arg) {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: 'Missing args' }
      try {
        self.reload(arg.tabId, arg.ignoreCache)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:get-all-tabs', withSenderCheck(function () {
      try {
        return { code: 0, data: self.getAllTabs() }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
    }))

    ipcMain.handle('page-manager:get-active-tab', withSenderCheck(function () {
      try {
        return { code: 0, data: self.getActiveTab() }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message, data: null } }
    }))

    ipcMain.handle('page-manager:get-home-tab', withSenderCheck(function () {
      try {
        return { code: 0, data: self.getHomeTab() }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message, data: null } }
    }))

    ipcMain.handle('page-manager:search-or-navigate', withSenderCheck(function (_, arg) {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: 'Missing args' }
      try {
        self.searchOrNavigate(arg.query, arg.tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:subscribe-events', withSenderCheck(function (_, arg) {
      try {
        var subscriberId = (arg && arg.subscriberId) || 'default-' + Date.now()
        self._subscribers.add(subscriberId)
        return { code: 0, data: { subscriberId: subscriberId } }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:unsubscribe-events', withSenderCheck(function (_, arg) {
      try {
        var subscriberId = (arg && arg.subscriberId) || ''
        if (subscriberId) { self._subscribers.delete(subscriberId) } else { self._subscribers.clear() }
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:save-cookies', withSenderCheck(function (_, tabId) {
      try {
        self.saveCookies(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:save-account-tab-credentials', withSenderCheck(async function (_, tabId) {
      if (typeof tabId !== 'string' || !tabId) return { code: EC.VALIDATION_ERROR, message: '缺少 tabId' }
       try {
        const result = await self.saveAccountTabCredentials(tabId)
        if (result && result.ok) {
          const win = self.mainWindow
          if (win && !win.isDestroyed()) {
            win.webContents.send('auth:completed', { platform: result.platform, accountId: result.accountId })
          }
          return { code: 0, data: result }
        }
        return { code: EC.REQUEST_ERROR, message: result?.reason || 'save-failed', data: result }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:account-tab-save-state', withSenderCheck(function (_, tabId) {
      if (typeof tabId !== 'string' || !tabId) return { code: EC.VALIDATION_ERROR, message: '缺少 tabId' }
      try {
        return { code: 0, data: self.getAccountTabSaveState(tabId) }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:save-all-unsaved-accounts', withSenderCheck(async function () {
      try {
        const data = await self.saveAllUnsavedAccounts()
        return { code: 0, data: data }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    // ─── 左侧导航栏宽度同步 ──

    // ─── 壳态互斥（T0-6b）：渲染层上报壳态，主进程切换内嵌视图可见性 ───
    ipcMain.handle('page-manager:set-shell-mode', withSenderCheck(function (_, mode) {
      try {
        self.setShellMode(mode)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('page-manager:set-sidebar-width', withSenderCheck(function (_, width) {
      try {
        self.setSidebarWidth(width)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))
  }
}

module.exports = WebviewManager
module.exports.HOME_TAB_ID = HOME_TAB_ID
module.exports.AUTH_TAB_ID = AUTH_TAB_ID
