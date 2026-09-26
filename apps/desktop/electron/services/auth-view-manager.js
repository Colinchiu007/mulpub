// @ts-check
/**
 * AuthViewManager — WebContentsView 内嵌浏览器登录管理器
 *
 * 架构：
 *   Login:   WebContentsView (内嵌，体验好)
 *   Publish: Playwright (保留，RPA 自动化)
 *   Cookie 桥接: WebContentsView 提取 → Python API 保存 → Playwright 加载
 */
// eslint-disable-next-line no-unused-vars
const { BrowserWindow, WebContentsView, session, ipcMain } = require('electron')
const path = require('path')
const log = require('./logger')
const {
  PLATFORM_LOGIN_URLS,
  hasPlatformSessionCookie,
  isPlatformCookieDomain,
  isPlatformLoginSuccessUrl,
} = require('@multi-publish/shared-utils/src/platform-definitions')
// 账号资料（昵称/头像/平台ID）采集器：登录成功那一刻随凭证一起产出（PRD-ACCOUNT-PROFILE-INFO-2026-09-23）
const accountProfile = require('@multi-publish/shared-utils/src/account-profile')
const { attachCdpDetection } = require('./auth-view-cdp')
// 会话级网络诊断：iframe 内的二维码请求失败不会触发外层 webContents 的 did-fail-load，
// 不挂它就等于对「二维码刷很久」完全无感知
const { attachLoginNetworkDiagnostics, attachAuthResponseDiagnostics } = require('./login-network-diagnostics')
const { createSession, setCookies, restoreLocalStorage, restoreIndexedDB, createAuthView } = require('./auth-view-session')
// 内嵌视图定位唯一来源：必须用「客户区」尺寸，禁用 getBounds() 外框尺寸（见 view-bounds.js）
const { computeEmbeddedViewBounds, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } = require('./view-bounds')
// auth-window.js 独立窗口工厂已不再需要（认证视图改为内嵌主窗口全屏标签）

// 左侧导航栏宽度（与前端 MpSidebar 的 CSS 变量 --mp-sidebar-width 保持一致）
const SIDEBAR_WIDTH_DEFAULT = 200
const MAX_INDEXED_DB_SNAPSHOT_BYTES = 524288

// 说明：独立登录窗口尺寸常量（1180×820 / 最小 900×640）已随统一迁移移交
// auth-window.js 工厂默认值，此处不再重复定义。

function normalizeIndexedDBSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  try {
    const serialized = JSON.stringify(value)
    if (!serialized || serialized.length > MAX_INDEXED_DB_SNAPSHOT_BYTES) return {}
    const normalized = JSON.parse(serialized)
    return normalized && typeof normalized === 'object' && !Array.isArray(normalized) ? normalized : {}
  } catch (_) {
    return {}
  }
}

function hasCapturedCredentials(authData, platform) {
  if (!authData || typeof authData !== 'object' || Array.isArray(authData)) return false
  // 平台声明了会话标记时，「采集到任何东西」不再足够：登录页同样会写入埋点 Cookie 与
  // localStorage（快手实测登录页即有 9 个 Cookie），必须命中真实登录态标记才算登录完成。
  if (!hasPlatformSessionCookie(platform, authData.cookies)) return false
  const hasCookies = Array.isArray(authData.cookies) && authData.cookies.length > 0
  const hasLocalStorage = Boolean(
    authData.localStorage &&
    typeof authData.localStorage === 'object' &&
    !Array.isArray(authData.localStorage) &&
    Object.keys(authData.localStorage).length > 0,
  )
  const hasIndexedDB = Boolean(
    authData.indexedDB &&
    typeof authData.indexedDB === 'object' &&
    !Array.isArray(authData.indexedDB) &&
    Object.keys(authData.indexedDB).length > 0,
  )
  return hasCookies || hasLocalStorage || hasIndexedDB
}

class AuthViewManager {
  constructor() {
    /** @type {import('electron').BrowserWindow | null} */
    this.mainWindow = null
    /** @type {import('electron').WebContentsView | null} */
    this.currentView = null
    /** @type {string | null} */
    this.currentPlatform = null
    /** @type {string | null} */
    this.currentAccountId = null
    /** @type {((data: any) => void) | null} */
    this._resolveLogin = null
    /** @type {((err: Error) => void) | null} */
    this._rejectLogin = null
    /** @type {Function | null} */
    this._escHandler = null
    /** @type {import('electron').WebContentsView | null} */
    this._escView = null
    /** @type {{ id: number, view: import('electron').WebContentsView, platform: string, resolveLogin: (data: any) => void } | null} */
    this._activeLoginAttempt = null
    /** @type {number} */
    this._loginAttemptSequence = 0
    /** @type {number | null} */
    this._autoCompletionAttemptId = null
    /** @type {number} 左侧导航栏当前宽度（由渲染进程同步，默认 200px） */
    this._sidebarWidth = SIDEBAR_WIDTH_DEFAULT
    /** @type {(() => void) | null} 保留签名兼容（window.js resize 挂钩） */
    this._loginWindowResizeCleanup = null
    /** @type {(() => void) | null} 保留签名兼容（auth-window factory 已不再使用） */
    this._syncLoginViewBounds = null
  }

  /**
   * @param {import('electron').BrowserWindow} win
   */
  setMainWindow(win) { this.mainWindow = win }

  _getPreloadPath() {
    return path.join(__dirname, '..', 'auth-preload.js')
  }

  /**
   * 登录视图全屏布局（TabBar+NavBar 下方），对齐参考产品全屏标签体验。
   * 尺寸来源必须是窗口客户区（getContentBounds），不能用 getBounds() 外框尺寸，
   * 否则视图右侧滚动条与底部内容会被窗口边框裁掉（见 view-bounds.js）。
   */
  _positionView() {
    if (!this.currentView || !this.mainWindow) return
    // 左侧导航栏为固定区域，登录视图应定位在右侧主体区域
    this.currentView.setBounds(computeEmbeddedViewBounds(this.mainWindow, this._sidebarWidth || SIDEBAR_WIDTH_DEFAULT))
  }

  /** 显示登录视图（虚拟标签切换回来时调用） */
  show() {
    if (this.currentView) {
      this.currentView.setVisible(true)
      this._logVisibilityChange(true)
    }
  }

  /** 隐藏登录视图（切换到其他标签时调用） */
  hide() {
    if (this.currentView) {
      this.currentView.setVisible(false)
      this._logVisibilityChange(false)
    }
  }

  /**
   * 读两个宿主真字段用于归因：视图是否被绘制（View.getVisible）、后台节流是否开启
   * （WebContents.getBackgroundThrottling）。
   * d.ts 明示 getVisible 是"应否绘制"，不等于屏幕可见（仍可能被遮挡或移出视野），
   * 二者与节流开关共同决定二维码 iframe 的定时器/重绘是否被 Chromium 推迟。
   * @param {import('electron').WebContentsView | null} view
   * @returns {string}
   */
  _throttleProbeOf(view) {
    try {
      return 'drawn=' + view.getVisible() +
        ' bgThrottle=' + view.webContents.getBackgroundThrottling()
    } catch (_e) {
      // 视图可能已销毁；此值仅用于日志定位，不参与登录判定
      return 'drawn=unknown bgThrottle=unknown'
    }
  }

  /**
   * 出码窗口若整体落在未绘制时段，Chromium 的后台节流会推迟二维码 iframe 的定时器与重绘
   *（本视图未设 backgroundThrottling:false，而账号标签路径 tab-lifecycle.js 显式关了它）。
   * 因此必须留下切换时刻，否则「刷很久」无法与节流对上。
   */
  _logVisibilityChange(shown) {
    log.info('AuthView', 'login view setVisible=' + shown +
      ' platform=' + this.currentPlatform +
      ' ' + this._throttleProbeOf(this.currentView))
  }

  /**
   * @param {{ platform: string, accountId: string, url?: string }} info
   */
  _fireOpened(info) {
    if (typeof this.onOpened === 'function') this.onOpened(info)
  }

  _fireClosed() {
    if (typeof this.onClosed === 'function') this.onClosed()
  }

  /**
   * 主窗口大小变化时重新定位当前登录视图。
   * window.js 的 resize 回调会调用此方法，缺失会导致未捕获异常。
   */
  _onWindowResize() {
    if (!this.mainWindow || !this.currentView) return
    this._positionView()
  }

  /**
   * 设置左侧导航栏宽度（由 WebviewManager 同步）
   * @param {number} width - 像素宽度
   */
  setSidebarWidth(width) {
    // 与 WebviewManager.setSidebarWidth 对齐：宽度必须严格 > 0（见 view-bounds MIN_SIDEBAR_WIDTH），
    // 拒绝 0 与负值，避免内嵌登录视图 x 落到 0 覆盖侧边栏。
    if (typeof width !== 'number' || width < MIN_SIDEBAR_WIDTH || width > MAX_SIDEBAR_WIDTH) return
    if (this._sidebarWidth !== width) {
      this._sidebarWidth = width
      if (this.mainWindow && this.currentView) {
        this._positionView()
      }
    }
  }

  _createLoginAttempt() {
    if (!this.currentView || !this.currentPlatform || !this._resolveLogin) return null
    this._activeLoginAttempt = {
      id: ++this._loginAttemptSequence,
      view: this.currentView,
      platform: this.currentPlatform,
      resolveLogin: this._resolveLogin,
      // 登录视图首次加载完成前（初始 URL 自身的重定向链）不可能是登录成功信号。
      initialRedirectPhase: true,
    }
    this._autoCompletionAttemptId = null
    return this._activeLoginAttempt
  }

  _getLoginAttempt() {
    const attempt = this._activeLoginAttempt
    if (
      attempt &&
      attempt.view === this.currentView &&
      attempt.platform === this.currentPlatform &&
      attempt.resolveLogin === this._resolveLogin
    ) return attempt
    return this._createLoginAttempt()
  }

  _isCurrentLoginAttempt(attempt) {
    return Boolean(
      attempt &&
      this._activeLoginAttempt === attempt &&
      this.currentView === attempt.view &&
      this.currentPlatform === attempt.platform &&
      this._resolveLogin === attempt.resolveLogin
    )
  }

  _settleLogin(attempt, result) {
    if (!this._isCurrentLoginAttempt(attempt)) return false
    this._activeLoginAttempt = null
    this._autoCompletionAttemptId = null
    this._resolveLogin = null
    attempt.resolveLogin(result)
    this.close()
    return true
  }

  _scheduleAutoCompletion(source, attempt = this._getLoginAttempt()) {
    if (!attempt || !this._isCurrentLoginAttempt(attempt) || this._autoCompletionAttemptId === attempt.id) return
    this._autoCompletionAttemptId = attempt.id

    const timerKey = source === 'cdp' ? '_cdpExtractTimer' : '_urlExtractTimer'
    const timer = setTimeout(async () => {
      try {
        if (!this._isCurrentLoginAttempt(attempt)) return
        const authData = await this._extractAuthData(attempt.view, attempt.platform)
        if (!hasCapturedCredentials(authData, attempt.platform)) {
          // 静默跳过会让「为什么没自动完成」无从排查，这里必须留下判定依据。
          log.warn('AuthView', `auto-completion skipped (no session evidence): ${attempt.platform} cookies=${authData && Array.isArray(authData.cookies) ? authData.cookies.length : 'n/a'}`)
          if (this._isCurrentLoginAttempt(attempt)) this._autoCompletionAttemptId = null
          return
        }
        this._settleLogin(attempt, authData)
      } catch (e) {
        log.warn('AuthView', 'Failed to extract auth data: ' + (e instanceof Error ? e.message : String(e)))
        if (this._isCurrentLoginAttempt(attempt)) this._autoCompletionAttemptId = null
      } finally {
        if (this[timerKey] === timer) this[timerKey] = null
      }
    }, 3000)
    this[timerKey] = timer
    if (this[timerKey] && this[timerKey].unref) this[timerKey].unref()
  }

  // _createLoginWindow 已删除。认证视图改回内嵌主窗口全屏标签模式
  //（参照参考产品 isAuth 模式：认证就是普通标签，不需要独立窗口）。

  /**
   * @param {string} platform
   * @param {number} [timeout]
   */
  openLogin(platform, timeout = 300000) {
    return new Promise((resolve, reject) => {
      if (!this.mainWindow) { reject(new Error("主窗口未初始化")); return }

      const loginUrl = /** @type {Record<string, string>} */ (PLATFORM_LOGIN_URLS)[platform]
      if (!loginUrl) { reject(new Error(`不支持的平台: ${platform}`)); return }

      if (this.currentView || this._resolveLogin) this.close()

      const accountId = `auth-${platform}-${Date.now()}`
      this.currentPlatform = platform
      this.currentAccountId = accountId
      this._resolveLogin = resolve
      this._rejectLogin = reject

      const authSession = createSession(accountId, session)
      // 补齐 #1887 §7 遗留项：诊断此前只挂在 persist:account-*，
      // 而「添加账号」用的是每次新建的 persist:auth-* 分区，出码链路完全无日志。
      // 旁路观测，挂接失败只告警，不得让可观测性变成新的故障点。
      try {
        attachLoginNetworkDiagnostics(authSession, { platform, accountId })
      } catch (e) {
        log.warn('AuthView', 'login network diag attach failed: ' + ((e && e.message) || 'unknown'))
      }
      const view = createAuthView(accountId, this._getPreloadPath(), authSession)
      this.currentView = view
      const attempt = this._createLoginAttempt()

      // 认证视图内嵌主窗口全屏标签（参照参考产品 isAuth 模式：
      // 认证就是普通标签，不需要独立窗口。重叠问题由 App.vue 隐藏 router-view 解决）
      // 注意：必须先 addChildView 再 setBounds——Electron 要求视图挂载后才能设置坐标
      this.mainWindow.contentView.addChildView(view)
      this._positionView()
      view.setVisible(true)
      // R49 修复：loadURL 返回 Promise，必须 .catch()
      const loadStartedAt = Date.now()
      view.webContents.loadURL(loginUrl).catch(function () { /* ignore nav errors */ })

      // 通知渲染进程：登录视图已打开（触发虚拟登录标签显示）
      const loginUrl_forHook = /** @type {Record<string, string>} */ (PLATFORM_LOGIN_URLS)[platform]
      this.mainWindow.webContents.send('auth:view-opened', { platform, accountId })
      this._fireOpened({ platform, accountId, url: loginUrl_forHook })

      // Escape 键关闭
      /**
       * @param {import('electron').Event} event
       * @param {{ type: string, key: string }} input
       */
      const escHandler = (event, input) => {
        if (input && input.type === 'keyDown' && input.key === 'Escape') {
          if (attempt) this._settleLogin(attempt, { cancelled: true })
        }
      }
      view.webContents.on("before-input-event", escHandler)
      this._escHandler = escHandler
      this._escView = view

      // URL 检测（备用）— 初始加载完成前不判定登录成功（防止平台登录页自身的
      // 重定向链被误判，如百家号 /pcui/register/index、/builder/theme/bjh/login）
      view.webContents.on('did-navigate', (/** @type {any} */ _, /** @type {string} */ url) => this._handleNavigation(url, attempt))
      // 注：若登录页加载失败（只有 did-fail-load），phase 保持 true，本会话退化为
      // 手动“我已完成登录”/CDP 完成，属 fail-closed 的可接受行为。
      view.webContents.on('did-finish-load', () => {
        // 首屏耗时 + 当时的页面可见性：与 LoginNetDiag 的 qr response 计时对照，
        // 就能分清「首屏本身就慢」与「首屏快但出码迟到」两类完全不同的根因
        log.info('AuthView', 'login page finished after ' + (Date.now() - loadStartedAt) +
          'ms platform=' + platform + ' ' + this._throttleProbeOf(view))
        if (attempt && attempt.initialRedirectPhase) attempt.initialRedirectPhase = false
      })

      // CDP 检测（主检测方式）— 与 URL 路径一致：初始加载完成前不判定登录成功
      attachCdpDetection(view, () => {
        if (!attempt || attempt.initialRedirectPhase) return
        log.info('AuthView', 'CDP detected login success')
        this._scheduleAutoCompletion('cdp', attempt)
      })

      // 登录被平台风控拒绝时（知乎「客户端异常」类症状）把拒绝原因写进日志；
      // 复用上面 attachCdpDetection 已 attach 的 debugger，不新增第二个 attach。
      attachAuthResponseDiagnostics(view.webContents.debugger, { platform, accountId })

      // 超时
      if (timeout > 0) {
        // 安全修复：保存 timer 句柄，close() 中清理（R15 对齐 oauth-manager/qrcode-login）
        this._loginTimeout = setTimeout(() => {
          if (attempt) this._settleLogin(attempt, { timeout: true })
        }, timeout)
        // R28 修复：unref 让定时器不阻止进程退出
        if (this._loginTimeout && this._loginTimeout.unref) this._loginTimeout.unref()
      }
    })
  }

  /**
   * @param {import('electron').WebContentsView} view
   */
  async _extractAuthData(view, platform = this.currentPlatform) {
    const allCookies = await view.webContents.session.cookies.get({})
    const cookies = allCookies.filter(cookie => isPlatformCookieDomain(platform, cookie?.domain))
    let localStorage = {}
    try {
      const extracted = await view.webContents.executeJavaScript(
        'window.__auth_helper__ && typeof window.__auth_helper__.getLocalStorage === "function" ? window.__auth_helper__.getLocalStorage() : {}',
      )
      if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) {
        localStorage = Object.fromEntries(
          Object.entries(extracted).filter(([key, value]) => typeof key === 'string' && typeof value === 'string'),
        )
      }
    } catch (_e) { /* 页面未加载完成时没有 localStorage 也可继续检查 Cookie */ }
    let indexedDB = {}
    try {
      const extracted = await view.webContents.executeJavaScript(
        'window.__auth_helper__ && typeof window.__auth_helper__.getIndexedDB === "function" ? window.__auth_helper__.getIndexedDB() : {}',
      )
      indexedDB = normalizeIndexedDBSnapshot(extracted)
    } catch (_e) { /* IndexedDB 不可用时仍可使用 Cookie 或 localStorage 完成登录 */ }
    let name = ''
    try { name = await view.webContents.executeJavaScript('document.title || ""') } catch (_e) { /* ignore */ }
    // 昵称/头像必须在这一刻采集：name 取的是网页标题，直接当昵称会让账号页显示成「XX - 登录页」。
    // 采集失败返回 {}，下游按「字段缺席 = 不修改」处理，不会清空真源里的旧昵称/旧头像。
    const accountInfo = await accountProfile.collectWithWebContents(view.webContents, platform)
    return { cookies, name, localStorage, indexedDB, accountInfo }
  }

  /**
   * 用户确认平台登录完成后，立即由主进程提取当前隔离视图的凭证。
   * 渲染进程只触发动作，不接触 Cookie/localStorage。
   */
  async completeLogin() {
    const attempt = this._getLoginAttempt()
    // CDP 自动检测已保存凭证、会话已关闭 → 静默返回成功
    if (!attempt) return true

    const authData = await this._extractAuthData(attempt.view, attempt.platform)
    if (!hasCapturedCredentials(authData, attempt.platform)) {
      throw new Error('未检测到登录凭证，请先在平台页面完成登录')
    }
    if (!this._settleLogin(attempt, authData)) {
      // 会话已结束（CDP 自动完成或超时取消了）→ 静默返回
      return true
    }
    return true
  }

  /**
   * 处理登录视图导航。初始加载完成前的重定向链是登录页自身的跳转，
   * 不可能是用户登录成功的信号，直接忽略。
   * @param {string} url
   * @param {any} attempt
   */
  _handleNavigation(url, attempt) {
    if (!attempt || !this._isCurrentLoginAttempt(attempt)) return
    if (attempt.initialRedirectPhase) return
    this._checkLoginCompleted(url, attempt)
  }

  /**
   * @param {string} url
   */
  _checkLoginCompleted(url, attempt = this._getLoginAttempt()) {
    if (!attempt || !this._isCurrentLoginAttempt(attempt)) return
    if (isPlatformLoginSuccessUrl(attempt.platform, url)) {
      // URL 必须入日志：2026-09-25 快手「登录页被误判为登录成功」只能靠误存账号名
      // （网页标题）反推命中地址，就是因为这里只打了平台名。logger.redact 已对
      // access_token/Bearer/JWT 形态的值脱敏，可安全打印完整 URL。
      log.info('AuthView', `URL pattern detected login success: ${attempt.platform} ${url}`)
      this._scheduleAutoCompletion('url', attempt)
    }
  }

  close() {
    this._activeLoginAttempt = null
    this._autoCompletionAttemptId = null
    // 安全修复：清理所有 timer（R15 对齐 oauth-manager/qrcode-login）
    if (this._loginTimeout) { clearTimeout(this._loginTimeout); this._loginTimeout = null }
    if (this._cdpExtractTimer) { clearTimeout(this._cdpExtractTimer); this._cdpExtractTimer = null }
    if (this._urlExtractTimer) { clearTimeout(this._urlExtractTimer); this._urlExtractTimer = null }
    if (this.currentView) {
      try {
        if (this._escHandler && this._escView) {
          // @ts-expect-error Electron types missing before-input-event
          this._escView.webContents.removeListener("before-input-event", this._escHandler)
        }
        if (this.mainWindow && !this.mainWindow.isDestroyed?.() && this.mainWindow.contentView) {
          try { this.mainWindow.contentView.removeChildView(this.currentView) } catch (_e) { /* ignore */ }
        }
        this.currentView.webContents.close()
      } catch (_e) { /* ignore */ }
    }
    this.currentView = null

    this._loginWindowResizeCleanup = null
    this._syncLoginViewBounds = null
    
    if (this._resolveLogin) {
      const resolveLogin = this._resolveLogin
      this._resolveLogin = null
      resolveLogin({ cancelled: true })
    }
    const hadActiveView = Boolean(this.currentView || this.currentPlatform)
    this.currentPlatform = null
    this.currentAccountId = null
    this._rejectLogin = null
    if (hadActiveView) this._fireClosed()
    if (
      hadActiveView &&
      this.mainWindow &&
      !this.mainWindow.isDestroyed?.() &&
      typeof this.mainWindow.webContents?.send === 'function'
    ) {
      this.mainWindow.webContents.send('auth:view-closed')
    }
  }

  /**
   * @param {string} platform
   * @param {any[]} cookies
   * @param {Record<string, string>} [localStorage]
   * @param {Record<string, Record<string, Record<string, unknown>>>} [indexedDB]
   */
  async openSavedAccount(platform, cookies, localStorage, indexedDB) {
    const loginUrl = /** @type {Record<string, string>} */ (PLATFORM_LOGIN_URLS)[platform]
    if (!loginUrl) return
    if (!this.mainWindow) return

    const accountId = `auth-saved-${platform}-${Date.now()}`
    this.currentPlatform = platform
    this.currentAccountId = accountId

    const authSession = createSession(accountId, session)
    await setCookies(authSession, (cookies || []).filter(cookie => isPlatformCookieDomain(platform, cookie?.domain)))

    const view = createAuthView(accountId, this._getPreloadPath(), authSession)
    this.currentView = view

    this._positionView()
    this.mainWindow.contentView.addChildView(view)
    view.setVisible(true)
    const restorations = []
    if (localStorage && Object.keys(localStorage).length > 0) {
      restorations.push(restoreLocalStorage(view, localStorage))
    }
    if (indexedDB && typeof indexedDB === 'object' && Object.keys(indexedDB).length > 0) {
      restorations.push(restoreIndexedDB(view, indexedDB))
    }
    // R49 修复：loadURL 返回 Promise，必须 .catch()
    view.webContents.loadURL(loginUrl).catch(function () { /* ignore nav errors */ })

    /**
     * @param {import('electron').Event} event
     * @param {{ type: string, key: string }} input
     */
    const escHandler = (event, input) => {
      if (input && input.type === 'keyDown' && input.key === 'Escape') {
        // 先 resolve 再 close（close 会置空 _resolveLogin，导致 Promise 永久泄漏）
        if (this._resolveLogin) {
          this._resolveLogin({ cancelled: true })
          this._resolveLogin = null
        }
        this.close()
      }
    }
    view.webContents.on("before-input-event", escHandler)
    this._escHandler = escHandler
    this._escView = view

    if (restorations.length > 0) {
      void Promise.all(restorations).catch(() => {})
    }

    this.mainWindow.webContents.send('auth:view-opened', { platform, accountId })
    this._fireOpened({ platform, accountId, url: loginUrl })
    log.info('AuthView', `Opened saved account ${accountId}`)
  }

  /**
   * @param {string} platform
   * @param {any[]} [cookies]
   * @param {Record<string, string>} [localStorage]
   * @param {Record<string, Record<string, Record<string, unknown>>>} [indexedDB]
   */
  async loginSilent(platform, cookies, localStorage, indexedDB) {
    const loginUrl = /** @type {Record<string, string>} */ (PLATFORM_LOGIN_URLS)[platform]
    if (!loginUrl) return { valid: false, accountName: null }

    const win = new BrowserWindow({
      show: false,
      width: 1024, height: 768,
      webPreferences: {
        session: session.fromPartition(`persist:silent-auth-${platform}-${Date.now()}`, { cache: true }),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, // 该窗全程 show:false，隐藏页会被降频定时器并停掉 rAF
      },
    })

    try {
      if (cookies && cookies.length > 0) {
        for (const c of cookies.filter(cookie => isPlatformCookieDomain(platform, cookie?.domain))) {
          try { await win.webContents.session.cookies.set(c) } catch (_e) { /* skip */ }
        }
      }

      const restorationView = { webContents: win.webContents }
      const restorations = []
      if (localStorage && Object.keys(localStorage).length > 0) {
        restorations.push(restoreLocalStorage(restorationView, localStorage))
      }
      if (indexedDB && typeof indexedDB === 'object' && Object.keys(indexedDB).length > 0) {
        restorations.push(restoreIndexedDB(restorationView, indexedDB))
      }

      await win.webContents.loadURL(loginUrl)
      await new Promise(r => setTimeout(r, 3000))

      if (restorations.length > 0) {
        await Promise.all(restorations)
      }

      await new Promise(r => setTimeout(r, 2000))

      const currentUrl = win.webContents.getURL()
      // URL 判定对「登录页与后台同 URL」的平台不成立（快手两种状态都在 /profile）。
      // 静默校验必须同时确认已存凭证里有真实会话标记，否则本修复之前入库的假账号会
      // 永远报「有效」，把问题掩盖成后端状态异常（2026-09-26 CCG 评审 Warning 3）。
      const isValid = isPlatformLoginSuccessUrl(platform, currentUrl) &&
        hasPlatformSessionCookie(platform, cookies)

      let accountName = null
      try { accountName = await win.webContents.getTitle() } catch (_e) { /* ignore */ }

      return { valid: isValid, accountName }
    } catch (e) {
      log.warn('AuthView', `Silent login failed for ${platform}: ${e instanceof Error ? e.message : String(e)}`)
      return { valid: false, accountName: null }
    } finally {
      try { win.destroy() } catch (_e) { /* ignore */ }
    }
  }
}

module.exports = AuthViewManager


