// @ts-check
/**
 * WebviewManager 布局管理模块
 * 窗口大小调整、侧边栏宽度、壳态互斥、弹窗互斥挂起
 */
const log = require('../logger')
// 宽度守卫用共享的 isValidSidebarWidth：各自手写比较拦不住 NaN（所有比较都是 false）。
const { computeEmbeddedViewBounds, isValidSidebarWidth } = require('../view-bounds')
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
    // 用共享守卫 isValidSidebarWidth（单一真源）：NaN 能穿过手写的 `width < MIN || width > MAX`。
    if (!isValidSidebarWidth(width)) {
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
      // OAuth 授权视图同为内嵌原生图层（2026-10-18 回归修复：此前漏同步，
      // 收起态下左侧留 200px 死区、跨 900px 断点后仍按 200 布局）
      if (this._oauthManager && typeof this._oauthManager.setSidebarWidth === 'function') {
        this._oauthManager.setSidebarWidth(width)
      }
      this._repositionAll()
    }
  },

  /**
   * 设置左侧导航栏是否收起（全局折叠按钮 → 内嵌 WebContentsView 全宽）。
   *
   * 为什么不能复用 setSidebarWidth(0)：那条路径有**刻意保留**的守卫 —— width<=0 会让视图
   * x 落到 0 并覆盖 x=0 的侧边栏（2026-09-15 Bug）。收起是显式状态，视图**应该** x=0，
   * 所以用独立布尔位表达，守卫与功能互不借用。
   *
   * @param {boolean} collapsed true = 收起；非布尔值忽略（IPC 合同只接受 boolean）
   */
  setSidebarCollapsed (collapsed) {
    if (typeof collapsed !== 'boolean') {
      log.warn('WebviewManager', 'Invalid sidebar collapsed flag ignored: ' + collapsed)
      return
    }
    if (this._sidebarCollapsed === collapsed) return
    this._sidebarCollapsed = collapsed
    // 登录视图 / 扫码登录视图也是内嵌原生图层，必须同步，否则同样留死区
    if (this._authViewManager && typeof this._authViewManager.setSidebarCollapsed === 'function') {
      this._authViewManager.setSidebarCollapsed(collapsed)
    }
    if (this._qrCodeLogin && typeof this._qrCodeLogin.setSidebarCollapsed === 'function') {
      this._qrCodeLogin.setSidebarCollapsed(collapsed)
    }
    // OAuth 授权视图同样必须同步（2026-10-18 回归修复：此前漏同步）
    if (this._oauthManager && typeof this._oauthManager.setSidebarCollapsed === 'function') {
      this._oauthManager.setSidebarCollapsed(collapsed)
    }
    this._repositionAll()
    // 多窗口同步：把新状态推给所有窗口的渲染进程（含发起窗口自身，幂等短路）
    this.broadcastSidebarCollapsed()
  },

  /** 左侧导航栏当前是否收起（供 IPC 回执与测试断言） */
  isSidebarCollapsed () {
    return this._sidebarCollapsed === true
  },

  /**
   * 把折叠状态广播到所有窗口的渲染进程（多窗口同步）。
   *
   * 为什么必须广播：_sidebarCollapsed 是应用级唯一真源，任一窗口点击后这里会把
   * 全部内嵌视图重排成 x=0 全宽；但其它窗口的渲染进程各持一份 ref 副本，不通知
   * 的话它们的 DOM 侧栏还显示着、却被原生视图盖住 ⇒ 侧栏看得见却点不动。
   *
   * 为什么不担心回环：渲染层 applyRemoteCollapsed 只改本地 ref，不写 localStorage、
   * 不回调本 IPC；且它有「同值即短路」，第二波广播到不了主进程。
   *
   * @param {{ getAllWindows?: () => Array<{ isDestroyed?: () => boolean, webContents?: { isDestroyed?: () => boolean, send: Function } }> }} [browserWindowCtor]
   *   可注入的 BrowserWindow（测试用；生产由调用方传 require('electron').BrowserWindow）。
   *   未注入时延迟 require —— 单测环境没有 electron 运行时，不得在模块顶层依赖它。
   * @returns {{ sent: number }} 实际送达的窗口数（静默跳过已销毁/发送失败的窗口）
   */
  broadcastSidebarCollapsed (browserWindowCtor) {
    let ctor = browserWindowCtor
    if (!ctor) {
      try {
        ctor = require('electron').BrowserWindow
      } catch {
        return { sent: 0 }
      }
    }
    if (!ctor || typeof ctor.getAllWindows !== 'function') return { sent: 0 }

    const collapsed = this._sidebarCollapsed === true
    let sent = 0
    for (const win of ctor.getAllWindows()) {
      try {
        if (!win || win.isDestroyed?.()) continue
        const wc = win.webContents
        if (!wc || wc.isDestroyed?.()) continue
        wc.send('page-manager:sidebar-collapsed-changed', { data: { collapsed } })
        sent++
      } catch {
        // 单个窗口发送失败（已销毁 / 竞态）不得中断其它窗口
      }
    }
    return { sent }
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
      // 左侧导航栏为固定区域，WebContentsView 应定位在右侧主体区域；
      // 侧栏收起时改由 computeEmbeddedViewBounds 的 collapsed 参数给出 x=0 全宽。
      var activeView = this._tabViews.get(this._activeTabId)
      if (activeView) {
        activeView.setBounds(computeEmbeddedViewBounds(this.mainWindow, sidebarWidth, undefined, this._sidebarCollapsed))
        activeView.setVisible(true)
      }
    }
  }
}
