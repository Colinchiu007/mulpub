// @ts-check
/**
 * WebviewManager — 分屏监控管理器 + 浏览器标签页管理
 *
 * 蚁小二逆向工程 P0 功能：多平台同时监控
 * 每个 tab 独立 WebContentsView，独立 session分区，Cookie 互不干扰
 *
 * 浏览器标签页功能：
 *   创建/关闭/切换标签页，前进后退刷新，URL 导航，搜索跳转
 *
 * 布局方案:
 *   1: ████████████████  (全屏，默认)
 *   2: ███████│████████  (左右 50/50)
 *   3: ███████│████████  (2+1 布局)
 *      ████████████████
 *   4: ███████│████████  (2×2 网格)
 *      ███████│████████
 *   6: ███│████│██████  (3×2 网格)
 *      ███│████│██████
 */
const { EventEmitter } = require('events')
const { app, WebContentsView, session, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const log = require('./logger')
const credentialStore = require('./credential-store')
const { PLATFORM_DASHBOARD_URLS, getPlatformName } = require('@multi-publish/shared-utils/src/platform-definitions')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')
// 内嵌视图定位唯一来源：必须用「客户区」尺寸，禁用 getBounds() 外框尺寸（详见模块注释）
const { getContentSize, computeEmbeddedViewBounds } = require('./view-bounds')

// 左侧导航栏宽度（与前端 YixiaoerSidebar 的 CSS 变量 --yixiaoer-sidebar-width 保持一致）
// 默认 200px，窄屏（≤900px）时 68px；由渲染进程通过 IPC 动态同步
const SIDEBAR_WIDTH_DEFAULT = 200

// 账号级持久会话分区标识校验（与 comment-manager 保持一致）
const SAFE_IDENTIFIER = /^[a-zA-Z0-9_-]+$/

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

// 固定首页标签 ID（对齐蚁小二：第 1 个标签永远是应用主页，不可关闭，不占用真实 WebContentsView）
const HOME_TAB_ID = 'home'

// 虚拟登录标签 ID（对齐蚁小二：登录页以全屏标签形式呈现在 TabBar 中）
const AUTH_TAB_ID = 'auth-login'

// 各平台创作者中心/后台 URL → @multi-publish/shared-utils/src/platform-definitions

class WebviewManager extends EventEmitter {
  constructor () {
    super()
    this.mainWindow = null
    /** @type {Array<{id: string, platform: string, accountId: string|null, view: WebContentsView, label: string}>} */
    this.tabs = []
    this.layout = 1  // 当前布局数（1/2/3/4/6）
    this._nextTabId = 1

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

    // ─── 虚拟登录标签（对齐蚁小二全屏登录体验）──────────
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

  // ─── 布局控制 ──────────────────────────────────

  /**
   * 设置分屏布局
   * @param {number} count - 1/2/3/4/6
   */
  setLayout (count) {
    if (![1, 2, 3, 4, 6].includes(count)) return
    this.layout = count
    this._repositionAll()
    this._emit('webview:layout-changed', { layout: count, tabCount: this.tabs.length })
    log.info('WebviewManager', 'Layout set to ' + count)
  }

  // ─── 浏览器标签页管理 ──────────────────────────

  /**
   * 检测新标签页系统是否有活动窗口
   * @returns {boolean}
   */
  _mainWindowAvailable () {
    return !!(this.mainWindow && this._tabViews && this._tabViews.size > 0)
  }

  // ─── Tab 管理（分屏监控）─────────────────────────

  /**
   * 打开一个平台监控 tab
   * @param {string} platform - 平台标识
   * @param {string|null} [accountId] - 账号 ID（用于隔离 session）
   * @param {Array} [cookies] - 已保存的 Cookie 数组
   * @param {Object} [localStorage] - 已保存的 localStorage 数据
   * @param {string} [customUrl] - 自定义 URL（覆盖默认仪表盘 URL）
   * @returns {string|null} tabId
   */
  openTab (platform, accountId, cookies, localStorage, customUrl) {
    if (!this.mainWindow) return null

    const url = customUrl || PLATFORM_DASHBOARD_URLS[platform]
    if (!url) {
      log.warn('WebviewManager', 'No dashboard URL for platform: ' + platform)
      return null
    }

    // 安全：校验 URL 协议（防止 file:// / data:// 等 SSRF/信息泄露）
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        log.warn('WebviewManager', 'Blocked non-http(s) URL: ' + parsed.protocol)
        return null
      }
    } catch (e) {
      log.warn('WebviewManager', 'Invalid URL: ' + url)
      return null
    }

    const tabId = 'tab-' + this._nextTabId++
    const partition = 'persist:monitor-' + (accountId || (platform + '-' + tabId))
    const viewSession = session.fromPartition(partition, { cache: true })

    // 恢复已保存 Cookie（必须在 loadURL 之前）
    if (cookies && cookies.length > 0) {
      var _cookieFail = 0
      var _cookiePromises = []
      for (var i = 0; i < cookies.length; i++) {
        // eslint-disable-next-line no-unused-vars
        try {
          _cookiePromises.push(viewSession.cookies.set(cookies[i]).catch(function (e2) {
            _cookieFail += 1
            log.warn('WebviewManager', 'cookie restore failed: ' + ((e2 && e2.message) || 'unknown'))
          }))
        } catch (e) {
          _cookieFail += 1
          log.warn('WebviewManager', 'cookie restore threw: ' + ((e && e.message) || 'unknown'))
        }
      }
      // 审查修复：聚合日志必须等全部 set 完成后再判定（此前同步读取异步计数器恒为 0）
      Promise.all(_cookiePromises).then(function () {
        if (_cookieFail > 0) log.warn('WebviewManager', 'cookie restore: ' + _cookieFail + '/' + cookies.length + ' failed (openTab ' + platform + ')')
      })
    }

    // 创建 WebContentsView
    const view = new WebContentsView({
      webPreferences: {
        session: viewSession,
        preload: path.join(__dirname, '..', 'monitor-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      }
    })
    view.setVisible(true)
    this.mainWindow.contentView.addChildView(view)

    // 导航到平台页面
    // R49 修复：loadURL 返回 Promise，必须 .catch()
    view.webContents.loadURL(url).catch(function (e) {
      log.warn('WebviewManager', 'nav failed url=' + String(url).slice(0, 200) + ' err=' + ((e && e.message) || 'unknown'))
    })

    // 页面加载后恢复 localStorage
    if (localStorage && Object.keys(localStorage).length > 0) {
      var lsData = JSON.stringify(localStorage)
      view.webContents.on('did-finish-load', function () {
        view.webContents.executeJavaScript(
          '(function() {\n' +
          '  var data = ' + lsData + ';\n' +
          '  Object.keys(data).forEach(function(k) {\n' +
          '    try { localStorage.setItem(k, data[k]); } catch (e) { /* ignore */ }\n' +
          '  });\n' +
          '})()'
        ).catch(function () {})
      })
    }

    // 监听导航事件（检测登录状态变化）
    var self = this
    view.webContents.on('did-navigate', function (event, navUrl) {
      self._emit('webview:navigated', { tabId: tabId, platform: platform, url: navUrl })
    })

    var tab = { id: tabId, platform: platform, accountId: accountId, view: view, label: platform }
    this.tabs.push(tab)
    this._repositionAll()
    this._emit('webview:tab-opened', { tabId: tabId, platform: platform, accountId: accountId, tabCount: this.tabs.length })
    log.info('WebviewManager', 'Opened tab: ' + tabId + ' (' + platform + ')')
    return tabId
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
    var initialUrl = (opts && opts.url) || 'about:blank'
    // 账号级标签使用按账号持久化的 session 分区，保持创作者中心登录态
    var accountId = (opts && opts.accountId) || null
    var useAccountSession = typeof accountId === 'string' && SAFE_IDENTIFIER.test(accountId)
    var partition = useAccountSession
      ? 'persist:account-' + accountId
      : 'persist:browse-' + tabId
    var viewSession = session.fromPartition(partition, { cache: true })
    var cookieRestorations = []

    // 从当前身份命名空间的加密凭证恢复账号会话。旧版本没有 AccountManager
    // 接线时回退到 legacy credential-store，兼容已有本地账号。
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

    var view = new WebContentsView({
      webPreferences: {
        session: viewSession,
        preload: path.join(__dirname, '..', 'monitor-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })

    // 隐藏其他标签页，显示当前
    self._hideAllTabs()
    view.setVisible(true)
    self.mainWindow.contentView.addChildView(view)

    // 设置初始状态
    self._tabViews.set(tabId, view)
    // 支持调用方传入标签页标题（创作者中心等场景需在标签栏显示账号专属标题）
    var initialTitle = (opts && typeof opts.title === 'string' && opts.title.trim())
      ? opts.title.trim()
      : 'New Tab'
    self._tabStates.set(tabId, {
        url: initialUrl,
        title: initialTitle,
        titleLocked: Boolean(opts && typeof opts.title === 'string' && opts.title.trim()),
        loading: false,
        canGoBack: false,
        canGoForward: false
        // 账号标签标识：关闭标签时用于自动把 session 分区 Cookie 回写加密凭证库
        // （首页批量登录等普通标签场景没有 auth-view-manager 的 CDP 捕获链路，
        // 关闭前回写可让下次 checkLocalCredentials 命中加密文件主路径）
        ,
        accountId: useAccountSession ? accountId : null,
        platform: platform || null
      })
    self._activeTabId = tabId

    // 设置导航监听
    self._setupNav(tabId, view)

    // 页面加载后恢复账号 localStorage（与 openTab 的凭证恢复模式一致）
    var credLocalStorage = (accountCredential && accountCredential.localStorage && typeof accountCredential.localStorage === 'object')
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
    self._broadcast('tab-created', { tabId: tabId, url: initialUrl })

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

    // 处理旧分屏标签
    var idx = -1
    for (var i = 0; i < self.tabs.length; i++) {
      if (self.tabs[i].id === tabId) { idx = i; break }
    }
    if (idx === -1) return false

    var closedTab = self.tabs[idx]
    try {
      if (self.mainWindow && self.mainWindow.contentView) {
        self.mainWindow.contentView.removeChildView(closedTab.view)
      }
      closedTab.view.webContents.close()
    } catch (e) { /* ignore */ }
    self.tabs.splice(idx, 1)
    self._repositionAll()
    self._emit('webview:tab-closed', { tabId: tabId, tabCount: self.tabs.length })
    log.info('WebviewManager', 'Closed monitor tab: ' + tabId)
    return true
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
        platform: state.platform || null
      })
    })
    // 虚拟登录标签（对齐蚁小二全屏登录）
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
      platform: state.platform || null
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

    view.webContents.session.cookies.getAll({}).then(function (cookies) {
      self.emit('tab-cookies-changed', { tabId: tabId, cookies: cookies })
    }).catch(function () { /* ignore */ })
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

    var cookies = []
    try {
      cookies = await view.webContents.session.cookies.getAll({})
    } catch (e) {
      log.warn('WebviewManager', 'saveAccountTabCredentials: cookies.getAll failed for ' + tabId + ': ' + (e && e.message ? e.message : String(e)))
    }

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
    try {
      await self._accountManager.updateCapturedAccount(platform, {
        cookies: cookies,
        localStorage: localStorageData,
        name: state.title || ''
      }, accountId)
      log.info('WebviewManager', 'saveAccountTabCredentials: saved ' + platform + ':' + accountId + ' cookies=' + cookies.length + ' lsKeys=' + Object.keys(localStorageData).length)
      return { ok: true, accountId: accountId, platform: platform }
    } catch (e) {
      log.warn('WebviewManager', 'saveAccountTabCredentials: updateCapturedAccount failed for ' + platform + ':' + accountId + ': ' + (e && e.message ? e.message : String(e)))
      return { ok: false, reason: (e && e.message) ? e.message : 'save-failed', accountId: accountId, platform: platform }
    }
  }

  // ─── 关闭分屏监控标签 ──────────────────────────

  /**
   * 关闭指定分屏监控标签
   * @param {string} tabId
   */
  closeMonitorTab (tabId) {
    var idx = -1
    for (var i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i].id === tabId) { idx = i; break }
    }
    if (idx === -1) return

    var closedTab = this.tabs[idx]
    try {
      if (this.mainWindow && this.mainWindow.contentView) {
        this.mainWindow.contentView.removeChildView(closedTab.view)
      }
      closedTab.view.webContents.close()
    } catch (e) { /* ignore */ }
    this.tabs.splice(idx, 1)
    this._repositionAll()
    this._emit('webview:tab-closed', { tabId: tabId, tabCount: this.tabs.length })
    log.info('WebviewManager', 'Closed monitor tab: ' + tabId)
  }

  /**
   * 关闭所有分屏监控标签
   */
  closeAllMonitorTabs () {
    var self = this
    for (var i = self.tabs.length - 1; i >= 0; i--) {
      var tab = self.tabs[i]
      try {
        if (self.mainWindow && self.mainWindow.contentView) {
          self.mainWindow.contentView.removeChildView(tab.view)
        }
        tab.view.webContents.close()
      } catch (e) { /* ignore */ }
    }
    self.tabs = []
    self._repositionAll()
    self._emit('webview:all-tabs-closed', {})
    log.info('WebviewManager', 'All monitor tabs closed')
  }

  // ─── 窗口事件 ──────────────────────────────────

  /** 窗口大小变化时重新排列 */
  resize () {
    this._repositionAll()
  }

  /**
   * 设置左侧导航栏宽度（由渲染进程同步 CSS 变量 --yixiaoer-sidebar-width）
   * 默认 200px；窄屏（≤900px）时渲染进程传入 68px
   * @param {number} width - 像素宽度
   */
  setSidebarWidth (width) {
    if (typeof width !== 'number' || width < 0 || width > 600) {
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
      state.url = url
      state.canGoBack = view.webContents.canGoBack()
      state.canGoForward = view.webContents.canGoForward()
      self._broadcastNav(tabId)
    })

   view.webContents.on('did-navigate-in-page', function (event, url) {
     if (!self._tabStates.has(tabId)) return
     var state = self._tabStates.get(tabId)
     state.url = url
     self._broadcastNav(tabId)
   })

    // ─── window.open / target=_blank 拦截（对齐蚁小二）─────────────
    // 平台创作者中心内点击"个人中心"等链接会触发 window.open 或 target=_blank，
    // 默认 Electron 会弹出独立 BrowserWindow。这里拦截并在当前 tab 内直接导航，
    // 与蚁小二"本页打开"行为保持一致。
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
    // 内嵌视图的 setBounds 使用「客户区」坐标系，因此尺寸必须取客户区尺寸。
    // 若用 mainWindow.getBounds()（外框，含标题栏/菜单栏/边框），视图会宽出左右边框、
    // 高出标题栏+底边框，导致右侧垂直滚动条与底部内容被窗口裁掉（见 view-bounds.js）。
    var viewport = getContentSize(this.mainWindow)
    var sidebarWidth = this._sidebarWidth || SIDEBAR_WIDTH_DEFAULT

    // 登录标签活动态：登录视图由 AuthViewManager 自行定位（全屏 y=76），
    // 浏览器标签保持隐藏，不做布局
    if (this._activeTabId === AUTH_TAB_ID && this._authTabInfo) {
      var loginViewManager = this._getActiveLoginViewManager()
      if (loginViewManager && typeof loginViewManager._onWindowResize === 'function') {
        loginViewManager._onWindowResize()
      }
    } else if (this._tabViews.size > 0) {
      // 处理浏览器标签页（新系统）
      // 左侧导航栏为固定区域，WebContentsView 应定位在右侧主体区域
      var activeView = this._tabViews.get(this._activeTabId)
      if (activeView) {
        activeView.setBounds(computeEmbeddedViewBounds(this.mainWindow, sidebarWidth))
        activeView.setVisible(true)
      }
    }

    // 处理分屏监控标签（旧系统）
    if (this.tabs.length > 0) {
      var positions = this._calculatePositions(viewport)
      for (var i = 0; i < this.tabs.length; i++) {
        if (i < positions.length) {
          var pos = positions[i]
          this.tabs[i].view.setBounds({
            x: pos.x, y: pos.y,
            width: pos.width, height: pos.height,
          })
          this.tabs[i].view.setVisible(true)
        } else {
          // 超出当前布局容量 → 隐藏
          this.tabs[i].view.setVisible(false)
        }
      }
    }
  }

  /**
   * 根据当前布局和窗口大小计算各 view 的位置
   */
  _calculatePositions (bounds) {
    var NAV_HEIGHT = 56
    var GAP = 2
    var sidebarWidth = this._sidebarWidth || SIDEBAR_WIDTH_DEFAULT
    // 分屏区域应从左侧导航栏右侧开始，宽度也相应减少
    var W = bounds.width - sidebarWidth
    var H = bounds.height - NAV_HEIGHT
    var OFFSET_X = sidebarWidth
    var positions = []

    switch (this.layout) {
      case 1:
        positions.push({ x: OFFSET_X, y: NAV_HEIGHT, width: W, height: H })
        break
      case 2: {
        const hw = Math.floor((W - GAP) / 2)
        positions.push({ x: OFFSET_X, y: NAV_HEIGHT, width: hw, height: H })
        positions.push({ x: OFFSET_X + hw + GAP, y: NAV_HEIGHT, width: W - hw - GAP, height: H })
        break
      }
      case 3: {
        const hw = Math.floor((W - GAP) / 2)
        const hh = Math.floor((H - GAP) / 2)
        positions.push({ x: OFFSET_X, y: NAV_HEIGHT, width: hw, height: hh })
        positions.push({ x: OFFSET_X + hw + GAP, y: NAV_HEIGHT, width: W - hw - GAP, height: hh })
        positions.push({ x: OFFSET_X, y: NAV_HEIGHT + hh + GAP, width: W, height: H - hh - GAP })
        break
      }
      case 4: {
        const hw = Math.floor((W - GAP) / 2)
        const hh = Math.floor((H - GAP) / 2)
        const y1 = NAV_HEIGHT
        const y2 = NAV_HEIGHT + hh + GAP
        positions.push({ x: OFFSET_X, y: y1, width: hw, height: hh })
        positions.push({ x: OFFSET_X + hw + GAP, y: y1, width: W - hw - GAP, height: hh })
        positions.push({ x: OFFSET_X, y: y2, width: hw, height: H - hh - GAP })
        positions.push({ x: OFFSET_X + hw + GAP, y: y2, width: W - hw - GAP, height: H - hh - GAP })
        break
      }
      case 6: {
        const tw = Math.floor((W - 2 * GAP) / 3)
        const hh = Math.floor((H - GAP) / 2)
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            positions.push({
              x: OFFSET_X + c * (tw + GAP),
              y: NAV_HEIGHT + r * (hh + GAP),
              width: tw,
              height: hh,
            })
          }
        }
        break
      }
    }
    return positions
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
    var ipcMain = injectedIpcMain || require('electron').ipcMain;
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

    // ─── webview: IPC handlers（旧分屏系统，保持向后兼容）──

    ipcMain.handle('webview:set-layout', withSenderCheck(function (_, count) {
      try {
        self.setLayout(count)
        return { code: 0, data: { layout: count, tabCount: self.tabs.length } }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('webview:open-tab', withSenderCheck(function (_, arg) {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: 'Missing args object' }
      var platform = arg.platform, accountId = arg.accountId, cookies = arg.cookies, localStorage = arg.localStorage, url = arg.url
      try {
        var tabId = self.openTab(platform, accountId, cookies, localStorage, url)
        return tabId ? { code: 0, data: { tabId: tabId } } : { code: EC.REQUEST_ERROR, message: 'Cannot open ' + platform }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('webview:close-tab', withSenderCheck(function (_, tabId) {
      try {
        self.closeTab(tabId)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('webview:close-all', withSenderCheck(function () {
      try {
        self.closeAllMonitorTabs()
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))

    ipcMain.handle('webview:list-tabs', withSenderCheck(function () {
      try { return { code: 0, data: self.getTabsInfo() } }
      catch (e) { return { code: EC.REQUEST_ERROR, message: e.message, data: [] } }
    }))

    // ─── 左侧导航栏宽度同步 ──

    ipcMain.handle('page-manager:set-sidebar-width', withSenderCheck(function (_, width) {
      try {
        self.setSidebarWidth(width)
        return { code: 0 }
      } catch (e) { log.warn('WebviewManager', 'ipc handler error: ' + ((e && e.message) || e)); return { code: EC.REQUEST_ERROR, message: e.message } }
    }))
  }

  getTabsInfo () {
    return this.tabs.map(function (t) {
      return {
        id: t.id,
        platform: t.platform,
        accountId: t.accountId,
        label: t.label,
      }
    })
  }

  /** 安全发射 IPC 事件 */
  _emit (channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }
}

module.exports = WebviewManager
module.exports.HOME_TAB_ID = HOME_TAB_ID
module.exports.AUTH_TAB_ID = AUTH_TAB_ID
