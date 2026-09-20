const { IdentityError } = require('./identity-errors')

const DEFAULT_PARTITION = 'persist:logto-identity'

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
    if (this._window === window) this._window = null
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

  async open(url) {
    if (!this._isAllowedNavigation(url)) {
      throw new IdentityError('IDENTITY_AUTH_WINDOW_NAVIGATION_BLOCKED', '认证地址不属于已配置的 Logto 服务')
    }
    const previousClosed = this._closedPromise
    this.close()
    await previousClosed
    const authorizationUrl = new URL(url).toString()
    this._authorizationUrl = authorizationUrl

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
      backgroundColor: '#ffffff',
      title: '登录 Multi-Publish',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: authSession,
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

    // 兜底展示：ready-to-show 依赖远端授权页完成首帧，网络缓慢时可能长时间不触发，
    // 导致「点击登录却毫无反应」。dom-ready / did-finish-load 提前展示，
    // 并在最长等待后强制展示，保证用户始终能看到登录窗口。
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

    const guardNavigation = (event, targetUrl) => {
      if (this._isAllowedNavigation(targetUrl)) return
      event.preventDefault()
      if (this._window === window) this._fallbackToSystemBrowser(authorizationUrl)
    }
    window.webContents.on('will-navigate', guardNavigation)
    window.webContents.on('will-redirect', guardNavigation)
    window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (!this._isAllowedNavigation(targetUrl) && this._window === window) {
        this._fallbackToSystemBrowser(authorizationUrl)
      }
      return { action: 'deny' }
    })

    const loadResult = await Promise.race([
      window.webContents.loadURL(url).then(
        () => ({ type: 'loaded' }),
        (error) => ({ type: 'failed', error }),
      ),
      closedPromise.then(() => ({ type: 'closed' })),
    ])
    if (loadResult.type === 'failed') {
      if (this._window === window) this.close()
      throw new IdentityError('IDENTITY_AUTH_WINDOW_LOAD_FAILED', '登录页面加载失败', loadResult.error)
    }
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
