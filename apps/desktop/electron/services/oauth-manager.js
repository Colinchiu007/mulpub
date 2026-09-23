// @ts-check
/**
 * OAuthManager — OAuth 2.0 认证管理器
 *
 * 支持平台：YouTube、TikTok、微博、抖音等使用 OAuth 2.0 的 API 模式
 *
 * 流程：
 *   1. 打开 WebContentsView 显示平台的 OAuth 授权页
 *   2. 用户登录并授权
 *   3. 平台重定向到回调 URL（含 authorization_code）
 *   4. 主进程捕获 code，交换 access_token + refresh_token
 *   5. 存储到 Store，通知渲染进程
 *
 * 回调端点：http://127.0.0.1:16521/oauth/callback
 */
const { WebContentsView, session } = require('electron')
const path = require('path')
const http = require('http')
const log = require('./logger')
const { config: appConfig } = require('../config/app-config')
// eslint-disable-next-line no-unused-vars
const Store = require('./store')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')
// 内嵌视图定位唯一来源：必须用「客户区」尺寸，禁用 getBounds() 外框尺寸（见 view-bounds.js）
const { computeEmbeddedViewBounds } = require('./view-bounds')
// 独立窗口已不再需要（改为内嵌主窗口）

// OAuth 平台配置
const OAUTH_CONFIGS = {
  youtube: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    clientId: '',   // 需用户在设置页面填写
    redirectPort: 16522,
  },
  tiktok: {
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.upload', 'video.publish'],
    clientId: '',
    redirectPort: 16523,
  },
  weibo: {
    authorizeUrl: 'https://api.weibo.com/oauth2/authorize',
    tokenUrl: 'https://api.weibo.com/oauth2/access_token',
    scopes: ['all'],
    clientId: '',
    redirectPort: 16524,
  },
  douyin: {
    authorizeUrl: 'https://open.douyin.com/platform/oauth/connect',
    tokenUrl: 'https://open.douyin.com/oauth/access_token/',
    scopes: ['user_info', 'video.create', 'video.upload'],
    clientId: '',
    redirectPort: 16525,
  },
}

class OAuthManager {
  constructor (store) {
    this.mainWindow = null
    this.store = store
    this.currentView = null
    // 独立窗口字段已移除（改为内嵌主窗口全屏标签）
    this.currentPlatform = null
    this._resolveAuth = null
    this._rejectAuth = null
    this._callbackServer = null
    this._loginTimeout = null
  }

  setMainWindow (win) {
    this.mainWindow = win
  }

  /**
   * 授权视图布局（TabBar+NavBar 下方、侧边栏右侧），与其他内嵌视图一致。
   * 修复：startAuth 曾调用不存在的 this._positionView(...)，导致 OAuth 内嵌链路
   * 一进入就抛 "this._positionView is not a function"。
   * 尺寸来源必须是窗口客户区（见 view-bounds.js）。
   */
  _positionView () {
    if (!this.currentView || !this.mainWindow) return
    this.currentView.setBounds(computeEmbeddedViewBounds(this.mainWindow))
  }

  /**
   * 开始 OAuth 流程
   * @param {string} platform - youtube/tiktok/weibo/douyin
   * @param {object} credentials - { clientId, clientSecret }
   * @param {number} timeout - 超时(ms)
   */
  startAuth (platform, credentials, timeout = 300000) {
    return new Promise((resolve, reject) => {
      if (!this.mainWindow) {
        reject(new Error('主窗口未初始化'))
        return
      }

      const config = OAUTH_CONFIGS[platform]
      if (!config) {
        reject(new Error(`不支持的平台: ${platform}`))
        return
      }

      this._resolveAuth = resolve
      this._rejectAuth = reject
      this.currentPlatform = platform

      // 构造 OAuth 授权 URL
      const redirectUri = `http://127.0.0.1:${config.redirectPort}/oauth/callback`
      const clientId = credentials?.clientId || config.clientId || ''
      const state = Date.now().toString(36)

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: config.scopes.join(' '),
        state,
        access_type: 'offline',
        prompt: 'consent',
      })

      const authUrl = `${config.authorizeUrl}?${params.toString()}`

      // 启动临时回调服务器
      this._startCallbackServer(platform, config.redirectPort, state, credentials)

      // 创建隔离 Session 的 WebContentsView
      const viewSession = session.fromPartition(`persist:oauth-${platform}-${Date.now()}`, { cache: true })
      const view = new WebContentsView({
        webPreferences: {
          session: viewSession,
          preload: path.join(__dirname, '..', 'auth-qrcode-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        }
      })
      this.currentView = view

      // OAuth 授权页内嵌主窗口全屏标签（参照 AuthViewManager 内嵌迁移）
      this.mainWindow.contentView.addChildView(view)
      this._positionView()
      view.setVisible(true)
      // R49 修复：loadURL 返回 Promise，必须 .catch()
      view.webContents.loadURL(authUrl).catch(function () { /* ignore nav errors */ })

      // 通知渲染进程
      this.mainWindow.webContents.send('oauth:opened', { platform, authUrl })

      // 超时
      if (timeout > 0) {
        this._loginTimeout = setTimeout(() => {
          this.close()
          reject(new Error(`${platform} OAuth 授权超时（${Math.round(timeout / 1000 / 60)} 分钟）`))
        }, timeout)
        // R28 修复：unref 让定时器不阻止进程退出
        if (this._loginTimeout && this._loginTimeout.unref) this._loginTimeout.unref()
      }

      log.info('OAuthManager', `Started OAuth for ${platform}, redirect port ${config.redirectPort}`)
    })
  }

  /**
   * 启动临时回调服务器接收 OAuth 重定向
   */
  _startCallbackServer (platform, port, expectedState, credentials) {
    this._stopCallbackServer()

    this._callbackServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`)

      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code')
        // eslint-disable-next-line no-unused-vars
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          const safeError = String(error).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]))
          res.end('<h3>授权失败</h3><p>' + safeError + '</p><script>window.close()</script>')
          this._onAuthFailed(new Error(`OAuth error: ${error}`))
          return
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<h3>缺少授权码</h3><script>window.close()</script>')
          this._onAuthFailed(new Error('Missing authorization code'))
          return
        }

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h3>✅ 授权成功！请关闭此窗口</h3><script>window.close()</script>')

        // 用 code 换取 token
        this._exchangeCodeForToken(platform, code, credentials, url.href)
      } else {
        res.writeHead(404)
        res.end('Not Found')
      }
    })

    this._callbackServer.listen(port, appConfig.oauthServer.host, () => {
      log.debug('OAuthManager', `Callback server listening on port ${port}`)
    })
    this._callbackServer.on('error', (err) => {
      log.error('OAuthManager', `Callback server error: ${err.message}`)
    })
  }

  _stopCallbackServer () {
    if (this._callbackServer) {
      // eslint-disable-next-line no-unused-vars
      try { this._callbackServer.close() } catch (e) { /* ignore */ }
      this._callbackServer = null
    }
  }

  /**
   * 用 authorization_code 交换 access_token + refresh_token
   */
  async _exchangeCodeForToken (platform, code, credentials, redirectUri) {
    const config = OAUTH_CONFIGS[platform]
    if (!config) return

    const clientId = credentials?.clientId || ''
    const clientSecret = credentials?.clientSecret || ''

    try {
      const https = require('https')

      const postData = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString()

      const tokenUrl = new URL(config.tokenUrl)
      const options = {
        hostname: tokenUrl.hostname,
        port: 443,
        path: tokenUrl.pathname + tokenUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      }

      const tokenData = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => {
            // eslint-disable-next-line no-unused-vars
            try { resolve(JSON.parse(data)) } catch (e) { reject(new Error(`Token response: ${data.slice(0, 200)}`)) }
          })
        })
        // R28/R37：token 端点超时保护，避免 orchestrator/token 服务挂起导致 Promise 永久 pending
        req.setTimeout(30000, () => {
          req.destroy(new Error('Token exchange timed out after 30s'))
        })
        req.on('error', reject)
        req.write(postData)
        req.end()
      })

      if (tokenData.error) {
        this._onAuthFailed(new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error}`))
        return
      }

      const tokenRecord = {
        platform,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || '',
        expiresIn: tokenData.expires_in || 3600,
        scope: tokenData.scope || '',
        tokenType: tokenData.token_type || 'Bearer',
        createdAt: Date.now(),
      }

      // 保存到 Store
      const accountId = `oauth-${platform}-${Date.now()}`
      this.store.addAccount({
        id: accountId,
        platform,
        name: `${platform} (OAuth)`,
        cookies: [],
        localStorage: { oauth_token: JSON.stringify(tokenRecord) },
      })

      this._onAuthSuccess(accountId, platform, tokenRecord)
    } catch (e) {
      log.error('OAuthManager', `Token exchange failed for ${platform}: ${e.message}`)
      this._onAuthFailed(e)
    }
  }

  _onAuthSuccess (accountId, platform, tokenData) {
    if (this._loginTimeout) {
      clearTimeout(this._loginTimeout)
      this._loginTimeout = null
    }

    log.info('OAuthManager', `Auth success for ${platform}: ${accountId}`)

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:completed', {
        platform,
        accountId,
        tokenData: { type: tokenData.tokenType, scope: tokenData.scope, expiresIn: tokenData.expiresIn },
      })
    }

    if (this._resolveAuth) {
      this._resolveAuth({ accountId, platform, tokenData })
    }

    this._resolveAuth = null
    this._rejectAuth = null
    this.close()
  }

  _onAuthFailed (error) {
    log.error('OAuthManager', `Auth failed: ${error.message}`)

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:failed', { message: error.message })
    }

    if (this._rejectAuth) {
      this._rejectAuth(error)
    }

    this._resolveAuth = null
    this._rejectAuth = null
    this.close()
  }

  /**
   * 关闭
   */
  close () {
    this._stopCallbackServer()
    if (this._loginTimeout) {
      clearTimeout(this._loginTimeout)
      this._loginTimeout = null
    }

    // 认证页改回内嵌主窗口：从 contentView 移除视图
    if (this.currentView) {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed?.() && this.mainWindow.contentView) {
          try { this.mainWindow.contentView.removeChildView(this.currentView) } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      try { this.currentView.webContents.close() } catch (e) { /* ignore */ }
      try { this.currentView.webContents.destroy() } catch (e) { /* ignore */ }
      this.currentView = null
    }

    this.currentPlatform = null
    // 先 reject pending Promise 再置空（否则 startAuth 的 await 永久挂起）
    if (this._rejectAuth) {
      this._rejectAuth(new Error('OAuth window closed'))
    }
    this._resolveAuth = null
    this._rejectAuth = null

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('oauth:closed')
    }
    log.info('OAuthManager', 'Closed')
  }

  /**
   * 注册 IPC handlers
   */
  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] oauth-manager registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）');
    }
    const ipcMain = injectedIpcMain;
    ipcMain.handle('oauth:start', withSenderCheck(async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { platform, credentials } = arg
      try {
        const result = await this.startAuth(platform, credentials)
        return { code: 0, data: result, message: 'OAuth 授权成功' }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('oauth:close', withSenderCheck(() => {
      try {
        this.close()
        return { code: 0 }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('oauth:get-configs', () => {
      try {
        const list = Object.entries(OAUTH_CONFIGS).map(([platform, config]) => ({
          platform,
          scopes: config.scopes,
          hasClientId: !!config.clientId,
          redirectPort: config.redirectPort,
        }))
        return { code: 0, data: list }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
      }
    })
  }
}

module.exports = OAuthManager
