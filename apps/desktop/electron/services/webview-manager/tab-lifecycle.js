// @ts-check
/**
 * WebviewManager 标签页生命周期模块
 * 创建/关闭标签页、导航监听、window.open 拦截
 */
const { WebContentsView, session } = require('electron')
const path = require('path')
const log = require('../logger')
const credentialStore = require('../credential-store')
const { attachLoginNetworkDiagnostics } = require('../login-network-diagnostics')
const { buildEvalScript } = require('../../core/js-eval-payload')
const { SAFE_IDENTIFIER, AUTH_TAB_ID } = require('./constants')
const { _getUserDataDir, _injectLocalStorageAtDocumentStart, normalizeElectronCookie, _homeShellUrl, _homeShellPreloadPath, _urlHasHomeShellParam, _parseHashRoute } = require('./utils')

module.exports = {
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
    var requestedUrl = (opts && typeof opts.url === 'string') ? opts.url.trim() : ''
    var homeShell = Boolean((opts && opts.homeShell === true) || !requestedUrl || requestedUrl === 'about:blank')
    var initialUrl = homeShell ? _homeShellUrl() : requestedUrl
    var accountId = homeShell ? null : ((opts && opts.accountId) || null)
    var useAccountSession = typeof accountId === 'string' && SAFE_IDENTIFIER.test(accountId)
    var partition = useAccountSession
      ? 'persist:account-' + accountId
      : 'persist:browse-' + tabId
    var viewSession = session.fromPartition(partition, { cache: true })
    var cookieRestorations = []

    if (useAccountSession) {
      try {
        attachLoginNetworkDiagnostics(viewSession, { platform: platform || 'unknown', accountId: accountId || 'unknown' })
      } catch (e) { log.warn('WebviewManager', 'login network diag attach failed: ' + ((e && e.message) || 'unknown')) }
    }

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

    self._hideAllTabs()
    view.setVisible(!self.isEmbeddedViewsSuspended())
    self.mainWindow.contentView.addChildView(view)

    self._tabViews.set(tabId, view)
    var initialTitle = (opts && typeof opts.title === 'string' && opts.title.trim())
      ? opts.title.trim()
      : (homeShell ? '新标签页' : 'New Tab')
    self._tabStates.set(tabId, {
        url: homeShell ? '' : initialUrl,
        title: initialTitle,
        homeShell: homeShell,
        spaRoute: homeShell ? '/' : '',
        titleLocked: Boolean(opts && typeof opts.title === 'string' && opts.title.trim()),
        loading: false,
        canGoBack: false,
        canGoForward: false
        ,
        accountId: useAccountSession ? accountId : null,
        platform: platform || null,
        credentialSaveState: (useAccountSession && cleanSession) ? 'unsaved' : null,
        initialRedirectPhase: useAccountSession === true,
        _autoSaveTimer: null
      })
    self._activeTabId = tabId

    self._setupNav(tabId, view)

    var credLocalStorage = (!cleanSession && accountCredential && accountCredential.localStorage && typeof accountCredential.localStorage === 'object')
      ? accountCredential.localStorage
      : null
    var lsInjection = null
    if (credLocalStorage && Object.keys(credLocalStorage).length > 0) {
      var credLsScript = buildEvalScript(
        'data',
        [credLocalStorage],
        '  Object.keys(data).forEach(function(k) {\n' +
        '    try { localStorage.setItem(k, data[k]); } catch (e) { /* ignore */ }\n' +
        '  })'
      )
      var registerLsFallback = function () {
        var localStorageRestored = false
        view.webContents.on('did-finish-load', function () {
          if (localStorageRestored) return
          localStorageRestored = true
          Promise.resolve(view.webContents.executeJavaScript(credLsScript)).then(function () {
            if (initialUrl && initialUrl !== 'about:blank') {
              return view.webContents.loadURL(initialUrl).catch(function () {})
            }
          }, function () {})
        })
      }
      var dbgApi = view.webContents.debugger
      var dbgUsable = Boolean(dbgApi)
        && typeof dbgApi.attach === 'function'
        && typeof dbgApi.sendCommand === 'function'
      if (dbgUsable) {
        lsInjection = _injectLocalStorageAtDocumentStart(view, credLsScript).then(function (injected) {
          if (!injected) registerLsFallback()
        }, function () { registerLsFallback() })
      } else {
        registerLsFallback()
      }
    }

    var navigateAfterCookies = function () {
      if (initialUrl && initialUrl !== 'about:blank') {
        view.webContents.loadURL(initialUrl).catch(function (e) { log.warn('WebviewManager', 'nav failed url=' + String(initialUrl).slice(0, 200) + ' err=' + ((e && e.message) || 'unknown')) })
      }
    }
    var preNavPromises = cookieRestorations.slice()
    if (lsInjection) preNavPromises.push(lsInjection)
    if (preNavPromises.length > 0 || useAccountSession) {
      Promise.all(preNavPromises).then(navigateAfterCookies, navigateAfterCookies)
    } else {
      navigateAfterCookies()
    }

    self._repositionAll()
    self._broadcast('tab-created', { tabId: tabId, url: homeShell ? '' : initialUrl })

    log.info('WebviewManager', 'Created new tab: ' + tabId)
    return tabId
  },

  /**
   * 关闭指定标签页
   * @param {string} tabId
   * @returns {boolean}
   */
  closeTab (tabId) {
    var self = this

    if (tabId === self._homeTabId) return false

    if (tabId === AUTH_TAB_ID) {
      var loginViewManager = self._getActiveLoginViewManager()
      if (loginViewManager && typeof loginViewManager.close === 'function') {
        loginViewManager.close()
        return true
      }
      return false
    }

    if (self._tabViews.has(tabId)) {
      var view = self._tabViews.get(tabId)
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
  },

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
  },

  /**
   * 隐藏所有浏览器标签页的视图
   */
  _hideAllTabs () {
    var self = this
    self._tabViews.forEach(function (view) {
      view.setVisible(false)
    })
  },

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
      if (state.initialRedirectPhase) state.initialRedirectPhase = false
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
      if (state.homeShell && !_urlHasHomeShellParam(url)) {
        state.homeShell = false
        state.titleLocked = false
        state.url = url
        state.realUrl = url
        state.spaRoute = ''
      } else if (state.homeShell) {
        state.realUrl = url
        state.url = ''
        state.spaRoute = _parseHashRoute(url)
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
     if (state.homeShell) { state.realUrl = url; state.spaRoute = _parseHashRoute(url) } else { state.url = url }
     self._broadcastNav(tabId)
     self._maybeScheduleAutoSave(tabId, state)
   })

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
        if (details.disposition === 'new-window') {
          return { action: 'deny' }
        }
        self.navigateTab(tabId, targetUrl)
        return { action: 'deny' }
      })
    }
  }
}
