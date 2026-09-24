// @ts-check
/**
 * WebviewManager 虚拟登录标签模块
 * AuthViewManager / QrCodeLogin 托管的全屏登录标签生命周期
 */
const log = require('../logger')
const { getPlatformName } = require('@multi-publish/shared-utils/src/platform-definitions')
const { AUTH_TAB_ID } = require('./constants')

module.exports = {
  /**
   * 挂载 AuthViewManager，接管登录视图的标签化呈现
   * @param {Object} authViewManager
   */
  attachAuthViewManager (authViewManager) {
    var self = this
    this._authViewManager = authViewManager
    authViewManager.onOpened = function (info) { self._onAuthViewOpened(info, authViewManager) }
    authViewManager.onClosed = function () { self._onAuthViewClosed(authViewManager) }
  },

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
  },

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
  },

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
  },

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
  },

  _getActiveLoginViewManager () {
    if (this._authTabInfo && this._authTabInfo.manager) return this._authTabInfo.manager
    return this._authViewManager
  },

  _hideActiveLoginView () {
    var loginViewManager = this._getActiveLoginViewManager()
    if (loginViewManager && typeof loginViewManager.hide === 'function') loginViewManager.hide()
  }
}
