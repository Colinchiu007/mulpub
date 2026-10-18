// @ts-check
/**
 * OAuthManager 布局混入 —— 内嵌授权视图的定位与侧栏状态同步。
 *
 * 拆分动因（2026-10-18）：`oauth-manager.js` 因补全侧栏同步职责涨到 506 行，
 * 撞上 check-max-lines 的 500 行门禁（"新代码不得引入超大文件，按既有
 * mixin/composable 范式拆分"）。本目录按 `webview-manager/layout.js` 的同款模式
 * 用 Object.assign 混入，`OAuthManager` 对外接口（setMainWindow /
 * setSidebarWidth / setSidebarCollapsed / _positionView）完全不变。
 *
 * 职责边界：只回答「授权视图该定位到哪里、侧栏状态变化后怎么重排」；
 * OAuth 授权流程、回调服务器、凭证交换仍在 oauth-manager.js。
 */
const log = require('../logger')
const {
  computeEmbeddedViewBounds,
  SIDEBAR_WIDTH_DEFAULT,
  isValidSidebarWidth,
} = require('../view-bounds')

module.exports = {
  /**
   * 绑定主窗口。
   *
   * 两件事：① 记引用供 _positionView 用；② 注册窗口 resize 监听 —— OAuth 视图是
   * 内嵌原生图层，授权过程中拖动窗口若不重排，右侧滚动条与底部内容会被窗口边框
   * 裁掉（view-bounds.js 头部所述 2026-09-13 同形态 Bug）。
   * 换绑前先解绑旧监听：clearMainWindowBindings 会把 win 置 null 后重建窗口，
   * 不先解绑会跨窗口累积。
   */
  setMainWindow (win) {
    if (this._unsubscribeWindowResize) {
      try { this._unsubscribeWindowResize() } catch (_e) { /* 解绑失败不影响换绑 */ }
      this._unsubscribeWindowResize = null
    }
    this.mainWindow = win
    if (win && typeof win.on === 'function') {
      const onResize = () => this._positionView()
      win.on('resize', onResize)
      this._unsubscribeWindowResize = () => {
        try { if (typeof win.off === 'function') win.off('resize', onResize) } catch (_e) { /* 窗口已销毁 */ }
      }
    }
  },

  /**
   * 设置左侧导航栏宽度（由 WebviewManager 同步）。
   * 守卫取 view-bounds.isValidSidebarWidth 单一真源（含 NaN —— NaN 的所有比较都是
   * false，四份各自手写的 `width < MIN || width > MAX` 都拦不住它）。0 与负值会让
   * 视图 x 落到 0、覆盖 x=0 的 MpSidebar 并拦截其全部点击（2026-09-15 同类 Bug）。
   */
  setSidebarWidth (width) {
    if (!isValidSidebarWidth(width)) {
      log.warn('OAuthManager', 'Invalid sidebar width ignored: ' + width)
      return
    }
    if (this._sidebarWidth === width) return
    this._sidebarWidth = width
    this._positionView()
  },

  /**
   * 设置左侧导航栏是否收起（由 WebviewManager 同步）。
   * 收起是用户显式意图：侧边栏 display:none 后视图必须 x=0 全宽，不能用 width=0
   * 表达（那条路有刻意保留的守卫，会被拒绝并回落 200）。
   */
  setSidebarCollapsed (collapsed) {
    if (typeof collapsed !== 'boolean') {
      log.warn('OAuthManager', 'Invalid sidebar collapsed flag ignored: ' + collapsed)
      return
    }
    if (this._sidebarCollapsed === collapsed) return
    this._sidebarCollapsed = collapsed
    this._positionView()
  },

  /**
   * 授权视图布局（TabBar+NavBar 下方、侧边栏右侧），与其他内嵌视图一致。
   * 修复：startAuth 曾调用不存在的 this._positionView(...)，导致 OAuth 内嵌链路
   * 一进入就抛 "this._positionView is not a function"。
   * 尺寸来源必须是窗口客户区（见 view-bounds.js）。
   * 必须传满 4 参：只传 win 会让 sidebarWidth 回落默认 200、collapsed 恒为 false，
   * 收起态下左侧留 200px 死区且视图盖住侧边栏（2026-10-18 回归）。
   */
  _positionView () {
    if (!this.currentView || !this.mainWindow) return
    this.currentView.setBounds(computeEmbeddedViewBounds(
      this.mainWindow,
      this._sidebarWidth || SIDEBAR_WIDTH_DEFAULT,
      undefined,
      this._sidebarCollapsed,
    ))
  },
}
