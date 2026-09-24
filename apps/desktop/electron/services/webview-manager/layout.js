// @ts-check
/**
 * WebviewManager 布局管理模块
 * 窗口大小调整、侧边栏宽度、壳态互斥、弹窗互斥挂起
 */
const log = require('../logger')
const { computeEmbeddedViewBounds, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } = require('../view-bounds')
const { SIDEBAR_WIDTH_DEFAULT, AUTH_TAB_ID } = require('./constants')

module.exports = {
  /** 窗口大小变化时重新排列 */
  resize () {
    this._repositionAll()
  },

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
  },

  isWorkbenchShell () {
    return this._shellMode === 'workbench'
  },

  // ─── 弹窗互斥（内嵌视图挂起，2026-09-23 Bug 修复）────────────────
  // 应用级模态浮层打开期间隐藏全部内嵌视图（浏览器标签 + 登录视图 + 扫码视图），
  // 关闭后恢复。ref-count 语义：多个浮层叠加挂起时，最后一个释放才恢复，
  // 避免先关闭的浮层把仍被上层浮层压住的内嵌视图错误恢复。

  isEmbeddedViewsSuspended () {
    return this._overlaySuspensions.size > 0
  },

  /**
   * 浮层打开 → 挂起内嵌视图。
   * @param {string} owner 浮层标识（如 'settings-dialog'），重复挂起幂等
   * @returns {boolean} 是否新增了挂起（false = owner 非法或已在挂起集合中）
   */
  suspendEmbeddedViewsForOverlay (owner) {
    if (typeof owner !== 'string' || !owner) {
      log.warn('WebviewManager', 'Invalid overlay suspend owner ignored')
      return false
    }
    if (this._overlaySuspensions.has(owner)) return false
    const first = this._overlaySuspensions.size === 0
    this._overlaySuspensions.add(owner)
    if (first) {
      this._hideAllTabs()
      if (this._authViewManager && typeof this._authViewManager.hide === 'function') {
        this._authViewManager.hide()
      }
      if (this._qrCodeLogin && typeof this._qrCodeLogin.hide === 'function') {
        this._qrCodeLogin.hide()
      }
      log.info('WebviewManager', 'Embedded views suspended for overlay: ' + owner)
    }
    return true
  },

  /**
   * 浮层关闭 → 释放挂起；计数归零且处于浏览器壳时恢复显示并重定位。
   * 未知 owner 释放无效（防计数漂移）；workbench 壳态下不恢复（由 setShellMode 驱动）。
   * @param {string} owner
   * @returns {boolean} 是否真正恢复了内嵌视图
   */
  releaseEmbeddedViewsForOverlay (owner) {
    if (typeof owner !== 'string' || !this._overlaySuspensions.has(owner)) {
      log.warn('WebviewManager', 'Unknown overlay release ignored: ' + owner)
      return false
    }
    this._overlaySuspensions.delete(owner)
    if (this._overlaySuspensions.size > 0) return false
    if (this._shellMode !== 'workbench') {
      // 登录标签活动时恢复登录视图（挂起期间它被 hide 掉了，_repositionAll 不接管其可见性）
      if (this._activeTabId === AUTH_TAB_ID && this._authTabInfo) {
        const loginViewManager = this._getActiveLoginViewManager()
        if (loginViewManager && typeof loginViewManager.show === 'function') loginViewManager.show()
      }
      this._repositionAll()
    }
    log.info('WebviewManager', 'Embedded views resumed after overlay: ' + owner)
    return true
  },

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
  },

  /**
   * 重新调整所有视图位置
   * 浏览器标签页填满 TOP=76px 以下区域，分屏标签使用原布局
   */
  _repositionAll () {
    if (!this.mainWindow) return
    // 弹窗互斥：浮层挂起期间只允许调整位置不允许恢复可见性（2026-09-23 Bug 修复），
    // 挂起态由 releaseEmbeddedViewsForOverlay / setShellMode('browser') 归位时恢复。
    if (this.isEmbeddedViewsSuspended()) {
      this._hideAllTabs()
      return
    }
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
}
