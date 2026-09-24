// @ts-check
/**
 * WebviewManager 标签页查询与导航模块
 * 获取标签信息、前进后退刷新、URL 导航、搜索
 */
const log = require('../logger')
const { HOME_TAB_ID, AUTH_TAB_ID } = require('./constants')

module.exports = {
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
        credentialSaveState: state.credentialSaveState || null,
        homeShell: !!state.homeShell,
        spaRoute: state.spaRoute || ''
      })
    })
    // 虚拟登录标签（对齐参考产品全屏登录）
    var authTab = self._getAuthTab()
    if (authTab) result.push(authTab)
    return result
  },

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
      credentialSaveState: state.credentialSaveState || null,
      homeShell: !!state.homeShell,
      spaRoute: state.spaRoute || ''
    }
  },

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
  },

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
  },

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
  },

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
  },

  /**
   * 驱动「当前聚焦的内嵌主页标签（home-shell）」在其自身 SPA 内导航到给定的 hash 路由。
   * 共享左侧边栏始终只有一份（属主窗口 chrome），其 router-link 默认驱动首页虚拟标签；
   * 当用户聚焦的是 home-shell 新标签时，侧边栏点击改走本方法：主进程定向把路由指令
   * 只发给活动标签的 webContents，由该独立 SPA 实例自己 router.push（hash 导航，走
   * did-navigate-in-page，不触发壳态自然结束）。非 home-shell 活动标签返回 handled:false，
   * 渲染层回退为「切回首页标签 + 导航」，保证变化可见。
   * @param {string} path hash 路由（如 '/collection'）
   * @returns {{ handled: boolean }}
   */
  navigateActiveHomeShell (path) {
    var self = this
    if (typeof path !== 'string' || path.charAt(0) !== '/') return { handled: false }
    var tabId = self._activeTabId
    if (!tabId || !self._tabStates.has(tabId)) return { handled: false }
    var state = self._tabStates.get(tabId)
    if (!state.homeShell) return { handled: false }
    var view = self._tabViews.get(tabId)
    if (!view || !view.webContents || (typeof view.webContents.isDestroyed === 'function' && view.webContents.isDestroyed())) return { handled: false }
    try {
      view.webContents.send('page-manager:home-shell-navigate', { path: path })
      return { handled: true }
    } catch (e) {
      log.warn('WebviewManager', 'home-shell navigate send failed: ' + ((e && e.message) || e))
      return { handled: false }
    }
  },

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
  },

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
  },

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

    // 显示目标标签（弹窗互斥挂起期间保持隐藏，浮层关闭后由 _repositionAll 归位）
    var targetView = self._tabViews.get(tabId)
    targetView.setVisible(!self.isEmbeddedViewsSuspended())
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
  },

  /**
   * 获取 URL 域名
   * @param {string} url
   * @returns {string}
   */
  _getDomain (url) {
    try { return new URL(url).hostname } catch (e) { return '' }
  }
}
