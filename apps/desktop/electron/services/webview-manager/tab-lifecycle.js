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
const { SAFE_IDENTIFIER, AUTH_TAB_ID, PAGE_TARGET_BOOTSTRAP_URL } = require('./constants')
const { _getUserDataDir, _injectLocalStorageAtDocumentStart, _removeBootstrapBlankHistoryEntry, _isBootstrapBlankDocument, normalizeElectronCookie, _homeShellUrl, _homeShellPreloadPath, _monitorPreloadPath, _urlHasHomeShellParam, _parseHashRoute, _gateRestoreWithTimeout } = require('./utils')

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
        // 分区优先、快照仅补缺（2026-10-09 账号标签开卡跳登录页修复）：
        // 账号分区的 Cookie 是平台持续轮换的实时会话态；加密快照是上次显式保存时的
        // 冻结值——普通账号标签的会话轮换不回写快照，快照必然越放越旧。旧实现把快照
        // 无条件覆盖式写入分区，会把分区里更新鲜的同 name+domain Cookie 打回旧值：
        // 首开被判未登录，一次失败导航后被平台 Set-Cookie 静默修补，表现为「第一次
        // 打开是登录页、之后又正常」。现改为仅注入分区缺失的 Cookie，分区已有同
        // name+domain 的一律不覆盖。判据与 mergeCookies 同构，同样只在快照条目带 domain 时命中。
        // 读分区失败（罕见：磁盘锁/会话异常）回退旧行为（全量注入），保证「清空后首次
        // 恢复」能力不回退；整个「读 + 写」聚合为一个门控 promise，导航仍等注入完成，
        // 但该 promise 有硬超时且永不 reject（见 utils.js 的 _gateRestoreWithTimeout）——门控首个导航
        // 的异步 promise 必须是「最多等一会儿」，不能是「等它回来」，否则会话命令挂起
        // 时页面直接白屏（2026-09-24 头条事故同族）。
        var setCookieForRestore = function (cookieToSet) {
          try {
            return Promise.resolve(viewSession.cookies.set(cookieToSet)).catch(function (e2) {
              log.warn('WebviewManager', 'credential cookie restore failed name=' + (cookieToSet.name || '') + ' err=' + ((e2 && e2.message) || 'unknown'))
            })
          } catch (e) {
            log.warn('WebviewManager', 'credential cookie restore threw name=' + (cookieToSet.name || '') + ' err=' + ((e && e.message) || 'unknown'))
            return Promise.resolve()
          }
        }
        var restoreFromCredential = function (existingKeys) {
          var pending = []
          var skipped = 0
          for (var ci = 0; ci < credCookies.length; ci++) {
            var cookieToSet = normalizeElectronCookie(credCookies[ci], initialUrlForCookies)
            if (!cookieToSet) continue
            if (existingKeys && existingKeys.has(cookieToSet.name + '@' + String(cookieToSet.domain || ''))) { skipped++; continue }
            pending.push(setCookieForRestore(cookieToSet))
          }
          return Promise.all(pending).then(function () {
            log.info('WebviewManager', '[' + (platform || 'unknown') + ':' + (accountId || '') + '] credential restore (partition-first): injected=' + pending.length + ' skipped-existing=' + skipped)
          })
        }
        // 快照一条可用 Cookie 都没有时不发起分区读：那是一次纯开销的无界 IPC，且在导航前。
        if (credCookies.length > 0) {
          var readExistingKeys = function () {
            // cookies.get 是异步 API，但 Promise.resolve() 求值前就会执行它——同步抛错
            // 必须转成 reject，否则「读失败回退全量注入」这条护栏对同步失效形态失明。
            try {
              return Promise.resolve(viewSession.cookies.get({}))
            } catch (e) {
              return Promise.reject(e)
            }
          }
          var restoreChain = readExistingKeys().then(function (existing) {
            var existingKeys = new Set()
            for (var ei = 0; ei < (existing ? existing.length : 0); ei++) {
              var ec = existing[ei]
              if (ec && typeof ec.name === 'string') existingKeys.add(ec.name + '@' + String(ec.domain || ''))
            }
            return restoreFromCredential(existingKeys)
          }, function (e) {
            log.warn('WebviewManager', 'partition cookie read failed, fallback to full credential restore ' + (platform || '') + ':' + (accountId || '') + ' err=' + ((e && e.message) || 'unknown'))
            return restoreFromCredential(null)
          })
          cookieRestorations.push(_gateRestoreWithTimeout(restoreChain, (platform || 'unknown') + ':' + (accountId || '')))
        }
      } else {
        cookieRestorations.push(_gateRestoreWithTimeout(Promise.resolve().then(function () { return viewSession.cookies.get({}) }).then(function (existing) {
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
        }), 'clean-session:' + (platform || 'unknown') + ':' + (accountId || '')))
      }
    }

    if (opts && opts.cookies && opts.cookies.length > 0) {
      var cookies = opts.cookies
      for (var i = 0; i < cookies.length; i++) {
        var suppliedCookie = normalizeElectronCookie(cookies[i], initialUrl === 'about:blank' ? '' : initialUrl)
        if (!suppliedCookie) continue
        try {
          cookieRestorations.push(_gateRestoreWithTimeout(Promise.resolve(viewSession.cookies.set(suppliedCookie)).catch(function (e2) {
            log.warn('WebviewManager', 'supplied cookie restore failed name=' + (suppliedCookie.name || '') + ' err=' + ((e2 && e2.message) || 'unknown'))
          }), 'supplied-cookie:' + (platform || 'unknown') + ':' + (accountId || '')))
        } catch (e) { log.warn('WebviewManager', 'supplied cookie restore threw name=' + (suppliedCookie.name || '') + ' err=' + ((e && e.message) || 'unknown')) }
      }
    }

    // 预加载脚本承担两项职责：主世界反检测注入（browse 标签）/ 内嵌主页壳守卫（homeShell 标签）。
    // browse 标签必须用 bundle 路径——sandbox preload 无法 require 相对路径文件（真机实测），
    // 而反检测源码在 electron/stealth/ 下需被打包内联；见 utils.js 的 _monitorPreloadPath。
    // ⛔ preload 必须**按分支各取各的**，不得"先写一个再覆盖"：home-shell 标签用不到 monitor preload，
    // 急切求值会①替它白跑一次存在性探测、并可能在缺 bundle 时刷出与它无关的告警；②逼得 home-shell
    // 相关测试去 mock 一个它根本不消费的导出（home-shell-title.test.js 的 utils mock 即此形态，
    // 漏项时表现为 8 条用例全红 `_monitorPreloadPath is not a function`）。
    var viewWebPreferences = {
      session: viewSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
    if (homeShell) {
      viewWebPreferences.preload = _homeShellPreloadPath()
      viewWebPreferences.additionalArguments = ['--mp-home-shell-url=' + initialUrl]
    } else {
      viewWebPreferences.preload = _monitorPreloadPath()
    }
    var view = new WebContentsView({ webPreferences: viewWebPreferences })

    self._hideAllTabs()
    view.setVisible(!self.isEmbeddedViewsSuspended())
    self.mainWindow.contentView.addChildView(view)

    self._tabViews.set(tabId, view)
    var initialTitle = (opts && typeof opts.title === 'string' && opts.title.trim())
      ? opts.title.trim()
      : (homeShell ? '新标签页' : 'New Tab')
    // 凭证 localStorage 与 CDP 能力判定必须早于标签状态建立：`blankBootstrapPending`
    // 要在任何导航事件（含引导 about:blank）到达之前就位（2026-10-11）。
    var credLocalStorage = (!cleanSession && accountCredential && accountCredential.localStorage && typeof accountCredential.localStorage === 'object')
      ? accountCredential.localStorage
      : null
    var lsRestoreNeeded = Boolean(credLocalStorage && Object.keys(credLocalStorage).length > 0)
    var dbgApiForLs = view.webContents.debugger
    var lsCdpUsable = Boolean(dbgApiForLs)
      && typeof dbgApiForLs.attach === 'function'
      && typeof dbgApiForLs.sendCommand === 'function'
    // 引导 about:blank 的记号：为把 CDP Page 目标带起来而插入的文档，既不是用户可见导航
    // （did-navigate 不得改写标签 URL），也不是凭证采集对象（did-finish-load 不得结束
    // initialRedirectPhase）；其历史项在首个真实导航提交后由 _removeBootstrapBlankHistoryEntry 摘除。
    // 取值是「可能发生」的上界：attach 失败/复用已有文档时无引导项，摘除逻辑按实际历史项自查，
    // 不会误删真实条目。三个出口见下方 clearBlankBootstrapFlag 处的注释（QM-6 评审 i4）。
    var blankBootstrapExpected = lsRestoreNeeded && lsCdpUsable
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
        blankBootstrapPending: blankBootstrapExpected,
        _autoSaveTimer: null
      })
    self._activeTabId = tabId

    self._setupNav(tabId, view)

    var lsInjection = null
    if (lsRestoreNeeded) {
      var credLsScript = buildEvalScript(
        'data',
        [credLocalStorage],
        '  Object.keys(data).forEach(function(k) {\n' +
        '    try { localStorage.setItem(k, data[k]); } catch (e) { /* ignore */ }\n' +
        '  })'
      )
      var registerLsFallback = function () {
        // 异步门控解除时标签可能已关闭：webContents 已销毁则静默跳过补注入
        if (!view.webContents) return
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
      // `blankBootstrapPending` 有三个**出口**，条件各不相同（QM-6 评审 i4 要求逐处写明）：
      //   ① 这里（CDP 回报「本次没插引导文档」/ CDP 链路整体失败）——收敛创建期的上界估计；
      //   ② `did-navigate` 收到首个**真实** URL —— 引导期正常结束，并摘掉引导历史项；
      //   ③ （不变式）任何时刻它都只影响「about:blank 事件是否被屏蔽 / 历史项是否要摘」，
      //      绝不影响凭证注入与真实导航；因此版本内不拆成两个字段（拆分会把一个瞬时窗口
      //      变成两个可分别漂移的状态，收益小于风险）。
      var clearBlankBootstrapFlag = function () {
        var stateForLs = self._tabStates.get(tabId)
        if (stateForLs) stateForLs.blankBootstrapPending = false
      }
      if (lsCdpUsable) {
        lsInjection = _injectLocalStorageAtDocumentStart(view, credLsScript).then(function (result) {
          // ①-收敛：该实现实际是否插入了引导文档（复用已有文档时不会）
          if (!result || result.blankBootstrapped !== true) clearBlankBootstrapFlag()
          if (!result || result.injected !== true) registerLsFallback()
        }, function () {
          clearBlankBootstrapFlag()
          registerLsFallback()
        })
      } else {
        clearBlankBootstrapFlag()
        registerLsFallback()
      }
    }

    var navigateAfterCookies = function () {
      if (!initialUrl || initialUrl === 'about:blank') return
      // 异步门控（Cookie 恢复 / LS 早期注入含超时竞态）解除时标签可能已被用户关闭：
      // 真实 Electron 中 webContents 销毁后属性不复存在，直接调 loadURL 会抛出
      // TypeError 并作为未处理拒绝外溢（2026-09-24 头条事故日志实锤）。
      if (!view.webContents || (typeof view.webContents.isDestroyed === 'function' && view.webContents.isDestroyed())) return
      view.webContents.loadURL(initialUrl).catch(function (e) { log.warn('WebviewManager', 'nav failed url=' + String(initialUrl).slice(0, 200) + ' err=' + ((e && e.message) || 'unknown')) })
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

    // 标签转圈的官方配对事件：electron.d.ts 把本事件注释为
    // "Corresponds to the points in time when the spinner of the tab stopped spinning"，
    // 与 did-start-loading 成对；导航失败/被中止时同样会触发，因此是唯一完备的收口点。
    view.webContents.on('did-stop-loading', function () {
      if (!self._tabStates.has(tabId)) return
      var state = self._tabStates.get(tabId)
      state.loading = false
      state.canGoBack = view.webContents.canGoBack()
      state.canGoForward = view.webContents.canGoForward()
      self._broadcast('tab-finished-loading', { tabId: tabId, url: state.url, loading: false })
    })

    // did-finish-load 只在主框架「成功」加载时触发，失败/中止路径永不调发，
    // 因此不得在此收口 loading（否则徽标永久转圈）；此处只保留与加载指示无关的职责。
    view.webContents.on('did-finish-load', function () {
      if (!self._tabStates.has(tabId)) return
      var state = self._tabStates.get(tabId)
      // 引导 about:blank 的完成事件不是「首个真实文档已就绪」：不得提前结束初始重定向阶段
      // （自动保存据此防把登录页误判为登录成功），也不得触发该阶段的凭证采集。
      if (state.blankBootstrapPending === true && _isBootstrapBlankDocument(view)) return
      if (state.initialRedirectPhase) state.initialRedirectPhase = false
      self._maybeScheduleAutoSave(tabId, state)
    })

    // 渲染进程消失后再不会有任何加载事件，必须就地收口。
    view.webContents.on('render-process-gone', function () {
      if (!self._tabStates.has(tabId)) return
      var state = self._tabStates.get(tabId)
      if (!state.loading) return
      state.loading = false
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
      // ① 引导文档自身的提交：不改写标签 URL/历史态、不广播导航（它从未对用户可见）
      if (state.blankBootstrapPending === true && url === PAGE_TARGET_BOOTSTRAP_URL) return
      // ② 首个真实文档提交：引导期结束，先摘掉 about:blank 历史项再读 canGoBack，
      //    否则返回键会多出一格空白页（真机实测 histLen 2 → canGoBack=true）
      if (state.blankBootstrapPending === true) {
        state.blankBootstrapPending = false
        _removeBootstrapBlankHistoryEntry(view)
      }
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
