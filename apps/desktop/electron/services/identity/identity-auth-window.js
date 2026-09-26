const { IdentityError } = require('./identity-errors')

const DEFAULT_PARTITION = 'persist:logto-identity'

const AUTH_WINDOW_BG = '#faf6f8'

// L2 加载页：本地内联 HTML（居中品牌 spinner + 「正在打开登录...」），零远端资源依赖。
// 以 data: URL 加载，不引用任何外部 JS/CSS，主进程渲染、非 renderer locale 扫描范围。
const LOADING_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>登录</title><style>'
  + 'html,body{margin:0;height:100%;background:' + AUTH_WINDOW_BG + ';}'
  + 'body{display:flex;flex-direction:column;align-items:center;justify-content:center;'
  + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#707080;}'
  + '.spinner{width:34px;height:34px;border-radius:50%;border:3px solid rgba(99,91,195,.22);'
  + 'border-top-color:#5149e8;animation:spin .8s linear infinite;}'
  + '.label{margin-top:14px;font-size:13px;}'
  + '@keyframes spin{to{transform:rotate(360deg)}}'
  + '</style></head><body><div class="spinner" role="status" aria-label="正在打开登录"></div>'
  + '<div class="label">正在打开登录...</div></body></html>'
const LOADING_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML)

function parseUrl(value, code = 'IDENTITY_AUTH_WINDOW_URL_INVALID') {
  try {
    return new URL(value)
  } catch (error) {
    throw new IdentityError(code, '认证窗口地址无效', error)
  }
}

class IdentityAuthWindow {
  constructor(options = {}) {
    this._endpoint = parseUrl(options.endpoint, 'IDENTITY_CONFIG_INVALID')
    this._redirectUri = parseUrl(options.redirectUri, 'IDENTITY_CONFIG_INVALID')
    const electron = options.BrowserWindow && options.session
      ? null
      : require('electron')
    this._BrowserWindow = options.BrowserWindow || electron.BrowserWindow
    this._session = options.session || electron.session
    this._shell = options.shell || (electron && electron.shell) || require('electron').shell
    this._getParentWindow = options.getParentWindow || (() => null)
    this._partition = options.partition || DEFAULT_PARTITION
    this._showFallbackTimeout = Number.isFinite(options.showFallbackTimeout) && options.showFallbackTimeout > 0
      ? options.showFallbackTimeout : 3000
    this._window = null
    this._authorizationUrl = null
    this._pendingLoading = false
    this._closedPromise = Promise.resolve()
    this._closeHandler = null
    this._authSession = null
    this._denyDownload = null
    this._permissionHandler = null
  }

  _isAllowedNavigation(value) {
    let target
    try {
      target = new URL(value)
    } catch {
      return false
    }
    if (target.origin === this._endpoint.origin) return true
    return target.origin === this._redirectUri.origin &&
      target.pathname === this._redirectUri.pathname
  }

  _fallbackToSystemBrowser(authorizationUrl = this._authorizationUrl) {
    if (!authorizationUrl) return
    Promise.resolve(this._shell.openExternal(authorizationUrl)).catch(() => {})
  }

  _handleClosed(window, resolveClosed) {
    if (this._window === window) {
      this._window = null
      this._pendingLoading = false
    }
    if (this._closeHandler?.window === window) this._closeHandler = null
    resolveClosed()
  }

  _settleWindowClosed(window) {
    if (this._closeHandler?.window === window) this._closeHandler.settle()
  }

  _getAuthSession() {
    const authSession = this._session.fromPartition(this._partition, { cache: true })
    if (this._authSession === authSession) return authSession

    this._releaseAuthSession()
    this._authSession = authSession
    this._denyDownload = (event) => event.preventDefault()
    this._permissionHandler = (_webContents, _permission, callback) => callback(false)
    authSession.on('will-download', this._denyDownload)
    authSession.setPermissionRequestHandler(this._permissionHandler)
    return authSession
  }

  _releaseAuthSession() {
    const authSession = this._authSession
    const denyDownload = this._denyDownload
    this._authSession = null
    this._denyDownload = null
    this._permissionHandler = null
    if (!authSession) return
    if (denyDownload) {
      try { authSession.removeListener('will-download', denyDownload) } catch { /* ignore */ }
    }
    try { authSession.setPermissionRequestHandler(null) } catch { /* ignore */ }
  }

  _createWindow() {
    const parent = this._getParentWindow()
    const authSession = this._getAuthSession()
    const window = new this._BrowserWindow({
      width: 520,
      height: 720,
      minWidth: 420,
      minHeight: 620,
      show: false,
      modal: Boolean(parent),
      parent: parent || undefined,
      resizable: true,
      autoHideMenuBar: true,
      backgroundColor: AUTH_WINDOW_BG,
      title: '登录 Multi-Publish',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: authSession,
        backgroundThrottling: false, // 展示前一直是 show:false，授权页 JS 不该被后台节流拖慢
      },
    })
    this._window = window
    let resolveClosed
    const closedPromise = new Promise((resolve) => { resolveClosed = resolve })
    this._closedPromise = closedPromise
    let settled = false
    const settleClosed = () => {
      if (settled) return
      settled = true
      this._handleClosed(window, resolveClosed)
    }
    this._closeHandler = { window, settle: settleClosed }

    // 兜底展示：ready-to-show 依赖页面完成首帧，本地加载页近瞬时触发；
    // 远端授权页网络缓慢时 dom-ready / did-finish-load 与超时兜底保证窗口始终可见。
    let shown = false
    let fallbackTimer = null
    const revealWindow = () => {
      if (shown) return
      if (this._window !== window || window.isDestroyed?.()) return
      shown = true
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
      window.show()
    }
    window.once('ready-to-show', revealWindow)
    window.webContents.on('dom-ready', revealWindow)
    window.webContents.on('did-finish-load', revealWindow)
    fallbackTimer = setTimeout(revealWindow, this._showFallbackTimeout)
    window.once('closed', () => {
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
      settleClosed()
    })

    // 导航安全：仅放行 Logto issuer 与固定回调地址；加载窗阶段 _authorizationUrl 为空，
    // 回退调用自然为 no-op，不会误开系统浏览器。
    const guardNavigation = (event, targetUrl) => {
      if (this._isAllowedNavigation(targetUrl)) return
      event.preventDefault()
      if (this._window === window) this._fallbackToSystemBrowser()
    }
    window.webContents.on('will-navigate', guardNavigation)
    window.webContents.on('will-redirect', guardNavigation)
    window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (!this._isAllowedNavigation(targetUrl) && this._window === window) {
        this._fallbackToSystemBrowser()
      }
      return { action: 'deny' }
    })
    return window
  }

  async _loadIntoExisting(window, url) {
    const loadResult = await Promise.race([
      window.webContents.loadURL(url).then(
        () => ({ type: 'loaded' }),
        (error) => ({ type: 'failed', error }),
      ),
      this._closedPromise.then(() => ({ type: 'closed' })),
    ])
    if (loadResult.type === 'failed') {
      if (this._window === window) this.close()
      throw new IdentityError('IDENTITY_AUTH_WINDOW_LOAD_FAILED', '登录页面加载失败', loadResult.error)
    }
  }

  // L2 秒开：点击瞬间即创建并展示本地加载窗（内置 spinner，零网络依赖），
  // discovery 就绪后由 open() 把真实授权 URL 载入这个已显示的窗口。幂等：窗口存活则复用。
  async openLoading() {
    if (this._window && !this._window.isDestroyed?.()) {
      this._pendingLoading = true
      return
    }
    const window = this._createWindow()
    this._pendingLoading = true
    try {
      await window.webContents.loadURL(LOADING_URL)
    } catch {
      // 本地加载页失败不阻断登录：open() 仍会向同一窗口载入真实授权地址。
    }
  }

  async open(url) {
    if (!this._isAllowedNavigation(url)) {
      throw new IdentityError('IDENTITY_AUTH_WINDOW_NAVIGATION_BLOCKED', '认证地址不属于已配置的 Logto 服务')
    }
    const authorizationUrl = new URL(url).toString()
    this._authorizationUrl = authorizationUrl

    // 快速路径：加载窗已就绪 → 复用同一已显示窗口，仅替换为真实授权地址（不重复建窗）。
    if (this._pendingLoading && this._window && !this._window.isDestroyed?.()) {
      this._pendingLoading = false
      await this._loadIntoExisting(this._window, url)
      return
    }

    // 常规/降级路径：关闭旧窗，新建窗口并加载真实授权地址（openLoading 未执行时行为与原逻辑一致）。
    this._pendingLoading = false
    const previousClosed = this._closedPromise
    this.close()
    await previousClosed
    this._createWindow()
    await this._loadIntoExisting(this._window, url)
  }

  waitForClosed() {
    return this._closedPromise
  }

  close() {
    const window = this._window
    if (!window) return
    if (typeof window.isDestroyed === 'function' && window.isDestroyed()) {
      this._settleWindowClosed(window)
      return
    }
    if (typeof window.destroy === 'function') window.destroy()
    else window.close()
    if (typeof window.isDestroyed === 'function' && window.isDestroyed()) {
      this._settleWindowClosed(window)
    }
  }

  async clearSession() {
    const previousClosed = this._closedPromise
    this.close()
    await previousClosed
    try {
      const authSession = this._authSession || this._session.fromPartition(this._partition, { cache: true })
      if (!authSession || typeof authSession.clearStorageData !== 'function') {
        throw new Error('Electron session 不支持清理认证存储')
      }
      await authSession.clearStorageData()
      if (this._authSession === authSession) this._releaseAuthSession()
    } catch (error) {
      throw new IdentityError('IDENTITY_AUTH_WINDOW_SESSION_CLEAR_FAILED', '认证窗口会话清理失败', error)
    }
  }
}

module.exports = { IdentityAuthWindow, DEFAULT_PARTITION }
