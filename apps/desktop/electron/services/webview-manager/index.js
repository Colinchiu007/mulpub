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
 *
 * 拆分说明：本模块由 webview-manager.js (1735行) 拆分为多个职责单一的子模块，
 * 通过 Object.assign 合并到 WebviewManager.prototype，保持对外接口完全不变。
 */
const { EventEmitter } = require('events')
const { HOME_TAB_ID, AUTH_TAB_ID } = require('./constants')
const { SIDEBAR_WIDTH_DEFAULT } = require('./constants')

// 导入各功能模块
const eventBus = require('./event-bus')
const layout = require('./layout')
const authTab = require('./auth-tab')
const credentialSaver = require('./credential-saver')
const tabQuery = require('./tab-query')
const tabLifecycle = require('./tab-lifecycle')
const ipcHandlers = require('./ipc-handlers')

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
    // 订阅 id 自增序号：保证同一毫秒内多次订阅也互不相同
    this._subscriberSeq = 0
    // 渲染进程 webContents → 该实例名下的订阅 id 集合。注销不再全清，
    // 因此崩溃/被杀而未走 dispose 的实例必须由 webContents destroyed 回收。
    /** @type {Map<any, Set<string>>} */
    this._senderSubscribers = new Map()

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
    // 弹窗互斥（2026-09-23 Bug 修复）：活动浮层 owner 集合。WebContentsView 是原生图层，
    // 永远压在主窗口 DOM 之上（z-index 无效）；应用级模态浮层（设置弹窗/升级弹窗/关闭
    // 确认框）打开期间必须挂起全部内嵌视图，否则浮层被外部网页整块盖住——用户看到的是
    // 「点设置后屏幕闪一下、弹窗没出现」。
    /** @type {Set<string>} */
    this._overlaySuspensions = new Set()
  }

  // ─── 基础方法（保留在基类）─────────────────────────

  setMainWindow (win) {
    this.mainWindow = win
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
}

// 合并各模块方法到 prototype
Object.assign(WebviewManager.prototype, eventBus)
Object.assign(WebviewManager.prototype, layout)
Object.assign(WebviewManager.prototype, authTab)
Object.assign(WebviewManager.prototype, credentialSaver)
Object.assign(WebviewManager.prototype, tabQuery)
Object.assign(WebviewManager.prototype, tabLifecycle)
Object.assign(WebviewManager.prototype, ipcHandlers)

module.exports = WebviewManager
module.exports.HOME_TAB_ID = HOME_TAB_ID
module.exports.AUTH_TAB_ID = AUTH_TAB_ID
