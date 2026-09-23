// @ts-check
/**
 * QrCodeLogin — 二维码扫码登录管理器
 *
 * 基于 WebviewManager/WebContentsView，扩展扫码登录流程：
 *   1. 打开平台登录页
 *   2. 自动检测页面中的二维码元素
 *   3. 提取二维码图片 → 发送到渲染进程展示
 *   4. 检测登录完成 → 提取凭证 → 保存
 *
 * 适用平台：微信公众号、视频号等微信生态（仅支持扫码登录的平台）
 *
 * 技术方案：
 *   使用 executeJavaScript 周期性扫描页面 DOM，
 *   检测 <img> 元素中带 QR/scan/qrcode 特征或大于 100x100 的图片
 */
const { WebContentsView, session } = require('electron')
const path = require('path')
const log = require('./logger')
// eslint-disable-next-line no-unused-vars
const {
  PLATFORM_LOGIN_URLS,
  QR_CODE_PLATFORMS,
  isPlatformCookieDomain,
  isPlatformLoginSuccessUrl,
} = require('@multi-publish/shared-utils/src/platform-definitions')
// 账号资料采集器（昵称/头像/平台ID）——扫码登录成功时随凭证一起产出
const accountProfile = require('@multi-publish/shared-utils/src/account-profile')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')
// 内嵌视图定位唯一来源：必须用「客户区」尺寸，禁用 getBounds() 外框尺寸（见 view-bounds.js）
const { computeEmbeddedViewBounds, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } = require('./view-bounds')
// 独立窗口已不再需要（改为内嵌主窗口）

// 各平台登录页 URL → @multi-publish/shared-utils/src/platform-definitions
// 支持二维码登录的平台由 QR_CODE_PLATFORMS 定义

// QR 码检测间隔
const QR_SCAN_INTERVAL_MS = 2000
// eslint-disable-next-line no-unused-vars
const QR_REFRESH_INTERVAL_MS = 30000  // 微信码 30s 过期刷新
// 说明：原 LOGIN_VIEW_TOP(76) / SIDEBAR_WIDTH_DEFAULT 内嵌布局常量已随"独立窗口
// 承载"迁移移除（内嵌浮层坐标与真实页面布局不符，会导致顶部多层内容重叠）。
// _sidebarWidth 字段与 setSidebarWidth() 保留仅为签名兼容。

class QrCodeLogin {
  constructor (options = {}) {
    this.mainWindow = null
    this.accountManager = options.accountManager || null
    this.currentView = null
    this.currentPlatform = null
    this.currentAccountId = null
    this._resolveLogin = null
    this._rejectLogin = null
    this._scanTimer = null
    this._lastQrHash = null
    this._activeSession = null
    this._sessionSequence = 0
    /** @type {((info: { platform: string, accountId: string, url: string }) => void) | null} */
    this.onOpened = null
    /** @type {(() => void) | null} */
    this.onClosed = null
    /** @type {number} 左侧导航栏宽度（签名兼容保留；独立窗口承载后不再参与布局） */
    this._sidebarWidth = 200
  }

  setMainWindow (win) {
    this.mainWindow = win
  }

  setAccountManager (accountManager) {
    this.accountManager = accountManager
  }

  /** 虚拟登录标签切换回来时显示扫码视图。 */
  show () {
    if (this._activeSession?.view) this._activeSession.view.setVisible(true)
  }

  /** 切换到其他标签时隐藏扫码视图，保持扫码会话继续运行。 */
  hide () {
    if (this._activeSession?.view) this._activeSession.view.setVisible(false)
  }

  _fireOpened (info) {
    if (typeof this.onOpened === 'function') this.onOpened(info)
  }

  _fireClosed () {
    if (typeof this.onClosed === 'function') this.onClosed()
  }

  /**
   * 打开扫码登录
   * @param {string} platform
   * @param {number} timeout - 超时(ms)，默认 5 分钟
   * @returns {Promise<{platform: string, accountId: string, accountName: string}>}
   */
  openLogin (platform, timeout = 300000) {
    return new Promise((resolve, reject) => {
      if (!this.mainWindow) {
        reject(new Error('主窗口未初始化'))
        return
      }

      if (!QR_CODE_PLATFORMS.includes(platform)) {
        reject(new Error(`不支持扫码登录的平台: ${platform}`))
        return
      }

      const loginUrl = PLATFORM_LOGIN_URLS[platform]
      if (!loginUrl) {
        reject(new Error(`不支持的平台: ${platform}`))
        return
      }

      if (this._activeSession) {
        this._closeSession(this._activeSession, {
          notifyRenderer: false,
          reason: new Error('扫码登录已被新的登录会话替代'),
        })
      }

      const accountId = `auth-${platform}-${Date.now()}-${++this._sessionSequence}`
      const loginSession = {
        accountId,
        platform,
        view: null,
        // 独立窗口字段已移除（改为内嵌主窗口全屏标签模式）
        resolve,
        reject,
        settled: false,
        cancelled: false,
        cleaned: false,
        phase: 'waiting',
        // 登录页首次加载完成前（初始 URL 自身的重定向链）不可能是登录成功信号。
        initialRedirectPhase: true,
        scanTimer: null,
        loginTimeout: null,
        extractTimer: null,
        prepareTimer: null,
        lastQrHash: null,
      }
      this._activeSession = loginSession
      this.currentPlatform = platform
      this.currentAccountId = accountId
      this._resolveLogin = resolve
      this._rejectLogin = reject
      this._lastQrHash = null

      // 创建隔离 Session
      const authSession = session.fromPartition(`persist:auth-${accountId}`, { cache: true })

      // 创建 WebContentsView
      const view = new WebContentsView({
        webPreferences: {
          session: authSession,
          preload: path.join(__dirname, '..', 'auth-qrcode-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        }
      })
      loginSession.view = view
      this.currentView = view

      // 认证页内嵌主窗口全屏标签（参照 AuthViewManager 内嵌迁移）
      this.mainWindow.contentView.addChildView(view)
      this._positionView()
      view.setVisible(true)
      this._fireOpened({ platform, accountId, url: loginUrl })

      // 导航到登录页
      // R49 修复：loadURL 返回 Promise，必须 .catch()
      view.webContents.loadURL(loginUrl).catch(function () { /* ignore nav errors */ })

      // 页面加载后开始检测 QR 码
      view.webContents.on('did-finish-load', () => {
        if (!this._isSessionActive(loginSession)) return
        // 初始重定向链结束，此后导航才可能是用户登录成功的信号
        loginSession.initialRedirectPhase = false
        log.info('QrCodeLogin', `Page loaded for ${platform}, starting QR detection`)
        // 快手 passport 默认可能落在密码登录或已失效二维码页；先把页面切到
        // 可扫码状态，再由轮询负责捕获新的二维码图像。
        this._startQrPagePreparation(loginSession)
        this._startQrDetection(loginSession)
      })

      // 监听导航检测登录完成（初始加载完成前的重定向链不判定登录成功）
      view.webContents.on('did-navigate', (event, url) => {
        if (loginSession.initialRedirectPhase) return
        this._checkLoginCompleted(url, loginSession)
      })

      // 监听同页面内导航
      view.webContents.on('did-navigate-in-page', (event, url) => {
        // SPA 应用通常只触发页内导航；仍需经过同一可信域名/路径校验。
        log.debug('QrCodeLogin', `In-page nav: ${url}`)
        if (!loginSession.initialRedirectPhase) this._checkLoginCompleted(url, loginSession)
      })

      // 超时
      if (timeout > 0) {
        loginSession.loginTimeout = setTimeout(() => {
          this._closeSession(loginSession, {
            reason: new Error(`${platform} 扫码登录超时（${Math.round(timeout / 1000 / 60)} 分钟）`),
          })
        }, timeout)
        this._loginTimeout = loginSession.loginTimeout
        // R28 修复：unref 让定时器不阻止进程退出
        if (loginSession.loginTimeout.unref) loginSession.loginTimeout.unref()
      }

      // 通知渲染进程
      this.mainWindow.webContents.send('qrcode:opened', { platform, accountId })

      log.info('QrCodeLogin', `Opened QR login for ${platform} (${accountId})`)
    })
  }

  // 说明：内嵌定位由 _positionView() 完成（定位到 TabBar+NavBar 下方、侧边栏右侧，
  // 尺寸取自窗口客户区，见 view-bounds.js）——认证视图以全屏标签形式内嵌主窗口。

  /**
   * 启动 QR 码定时检测
   */
  _startQrDetection (loginSession = this._activeSession) {
    if (!this._isSessionActive(loginSession)) return
    this._stopQrDetection(loginSession)
    loginSession.scanTimer = setInterval(() => {
      this._detectQrCodeOnce(loginSession)
    }, QR_SCAN_INTERVAL_MS)
    this._scanTimer = loginSession.scanTimer
    // R28 修复：unref 让定时器不阻止进程退出
    if (loginSession.scanTimer.unref) loginSession.scanTimer.unref()
  }

  _stopQrDetection (loginSession = this._activeSession) {
    if (loginSession?.scanTimer) {
      clearInterval(loginSession.scanTimer)
      loginSession.scanTimer = null
      if (this._activeSession === loginSession) this._scanTimer = null
    }
  }

  _startQrPagePreparation (loginSession = this._activeSession) {
    if (!this._isSessionActive(loginSession)) return
    this._stopQrPagePreparation(loginSession)
    const deadline = Date.now() + 10000
    const attempt = async () => {
      if (!this._isSessionActive(loginSession)) return
      try {
        const result = await this._prepareQrPage(loginSession)
        if (result?.hasQr || Date.now() >= deadline) {
          this._stopQrPagePreparation(loginSession)
          return
        }
      } catch (error) {
        if (this._isSessionActive(loginSession)) {
          log.debug('QrCodeLogin', 'QR page preparation skipped: ' + error.message)
        }
        if (Date.now() >= deadline) {
          this._stopQrPagePreparation(loginSession)
          return
        }
      }
      if (!this._isSessionActive(loginSession)) return
      loginSession.prepareTimer = setTimeout(attempt, 500)
      if (loginSession.prepareTimer.unref) loginSession.prepareTimer.unref()
    }
    attempt()
  }

  _stopQrPagePreparation (loginSession = this._activeSession) {
    if (loginSession?.prepareTimer) {
      clearTimeout(loginSession.prepareTimer)
      loginSession.prepareTimer = null
    }
  }

  /**
   * 将平台登录页准备为可扫码状态。只处理已知的快手 passport DOM，
   * 不依赖易变的打包 class 名称，也不向页面注入凭证或业务数据。
   */
  async _prepareQrPage (loginSession = this._activeSession) {
    const view = loginSession?.view
    if (loginSession?.platform !== 'kuaishou' || !view || view.webContents.isDestroyed()) return null

    return view.webContents.executeJavaScript(`
      (function() {
        const bodyText = document.body?.innerText || '';
        const expired = /二维码已失效|点击刷新/.test(bodyText);
        const refresh = document.querySelector(
          '.qrcode-status-timeout, [class*="qrcode-status"], [data-testid*="qrcode-refresh" i]'
        );
        if (expired && refresh && typeof refresh.click === 'function') {
          refresh.click();
          return { action: 'refresh', hasQr: false };
        }

        const qr = document.querySelector(
          'img[alt*="qrcode" i], img[class*="qrcode" i], img[data-testid*="qrcode" i], img[id*="qrcode" i]'
        );
        if (!qr) {
          const switcher = document.querySelector('.platform-switch, [data-testid="platform-switch"]');
          if (switcher && typeof switcher.click === 'function') {
            switcher.click();
            return { action: 'switch', hasQr: false };
          }
        }
        return { action: 'ready', hasQr: Boolean(qr) };
      })()
    `)
  }

  /**
   * 通过 executeJavaScript 检测页面中的二维码
   */
  async _detectQrCodeOnce (loginSession = this._activeSession) {
    const view = loginSession?.view
    if (!this._isSessionActive(loginSession) || !view || view.webContents.isDestroyed()) return

    try {
      const result = await view.webContents.executeJavaScript(`
        (function() {
          // 策略1: 优先使用平台提供的稳定二维码语义属性。
          let semanticImgs = document.querySelectorAll(
            'img[alt*="qrcode" i], img[class*="qrcode" i], img[data-testid*="qrcode" i], img[id*="qrcode" i], img[aria-label*="qr" i]'
          );
          for (let i = 0; i < semanticImgs.length; i++) {
            let width = semanticImgs[i].naturalWidth || semanticImgs[i].width || 0;
            let height = semanticImgs[i].naturalHeight || semanticImgs[i].height || 0;
            if (width > 80 && height > 80 && semanticImgs[i].src) {
              return { type: 'img', src: semanticImgs[i].src, width, height };
            }
          }

          // 策略2: 找包含 QR/qrcode/scan 关键字的 <img> URL
          let imgs = document.querySelectorAll('img');
          for (let i = 0; i < imgs.length; i++) {
            let src = (imgs[i].src || '').toLowerCase();
            if (
              src.indexOf('qrcode') !== -1 ||
              src.indexOf('qr_') !== -1 ||
              src.indexOf('/qr/') !== -1 ||
              src.indexOf('scan') !== -1 ||
              src.indexOf('login_qr') !== -1
            ) {
              if (imgs[i].naturalWidth > 80 && imgs[i].naturalHeight > 80) {
                return { type: 'img', src: imgs[i].src, width: imgs[i].naturalWidth, height: imgs[i].naturalHeight };
              }
            }
          }

          // 策略3: 找页面中最大的 <img>（登录页通常中间的二维码最大）
          let largest = null;
          let maxArea = 0;
          for (let i = 0; i < imgs.length; i++) {
            let w = imgs[i].naturalWidth || imgs[i].width || 0;
            let h = imgs[i].naturalHeight || imgs[i].height || 0;
            let area = w * h;
            if (area > maxArea && area > 5000) {  // > 70x70
              maxArea = area;
              largest = { type: 'img', src: imgs[i].src, width: w, height: h };
            }
          }

          // 策略4: 找 canvas 元素（有些平台通过 canvas 绘制二维码）
          let canvases = document.querySelectorAll('canvas');
          for (let i = 0; i < canvases.length; i++) {
            if (canvases[i].width > 80 && canvases[i].height > 80) {
              try {
                let dataUrl = canvases[i].toDataURL('image/png');
                return { type: 'canvas', src: dataUrl, width: canvases[i].width, height: canvases[i].height };
              } catch (e) { /* ignore */ }
            }
          }

          return largest ? largest : null;
        })()
      `)

      if (!this._isSessionActive(loginSession)) return
      if (result && result.src) {
        // 去重（相同 URL 不重复发送）
        const hash = result.src.slice(0, 100)
        if (hash !== loginSession.lastQrHash) {
          loginSession.lastQrHash = hash
          this._lastQrHash = hash
          // 通知渲染进程展示二维码
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('qrcode:detected', {
              platform: loginSession.platform,
              accountId: loginSession.accountId,
              image: result,
              timestamp: Date.now(),
            })
          }
          log.info('QrCodeLogin', `QR code detected for ${loginSession.platform}: ${result.type} ${result.width}x${result.height}`)
        }
      }
    } catch (e) {
      // executeJavaScript 可能因页面跳转失败，静默忽略
      if (this._isSessionActive(loginSession)) {
        log.debug('QrCodeLogin', `QR detection error: ${e.message}`)
      }
    }
  }

  /**
   * 检测登录是否完成
   */
  _checkLoginCompleted (url, loginSession = this._activeSession) {
    if (!this._isSessionActive(loginSession) || loginSession.phase !== 'waiting') return
    if (!isPlatformLoginSuccessUrl(loginSession.platform, url)) return

    loginSession.phase = 'extract-pending'
    log.info('QrCodeLogin', `Login completed for ${loginSession.platform}: ${url}`)

    this._stopQrDetection(loginSession)

    // 等待页面稳定后提取凭证
    loginSession.extractTimer = setTimeout(async () => {
      loginSession.extractTimer = null
      if (!this._isSessionActive(loginSession)) return
      loginSession.phase = 'extracting'
      try {
        const authData = await this._extractAuthData(loginSession)
        if (!this._isSessionActive(loginSession)) return
        await this._onLoginSuccess(authData, loginSession)
      } catch (e) {
        if (!this._isSessionActive(loginSession)) return
        log.error('QrCodeLogin', `Extract auth failed: ${e.message}`)
        this._closeSession(loginSession, { reason: e })
      }
    }, 2000)
    this._extractTimer = loginSession.extractTimer
    // R28 修复：unref 让定时器不阻止进程退出
    if (loginSession.extractTimer.unref) loginSession.extractTimer.unref()
  }

  /**
   * 提取登录凭证
   */
  async _extractAuthData (loginSession = this._activeSession) {
    const view = loginSession?.view
    if (!this._isSessionActive(loginSession) || !view || view.webContents.isDestroyed()) {
      throw new Error('浏览器已关闭')
    }

    // Cookie
    const allCookies = await view.webContents.session.cookies.get({})
    const cookies = allCookies.filter(cookie => isPlatformCookieDomain(loginSession.platform, cookie?.domain))
    if (!this._isSessionActive(loginSession)) throw new Error('扫码登录已取消')

    // localStorage
    let localStorage = {}
    try {
      localStorage = await view.webContents.executeJavaScript(`
        (function() {
          let result = {};
          for (let i = 0; i < localStorage.length; i++) {
            let key = localStorage.key(i);
            if (key.startsWith('__') || key === 'devtools') continue;
            try { result[key] = localStorage.getItem(key); } catch (e) { /* ignore */ }
          }
          return result;
        })()
      `)
    } catch (e) {
      if (!this._isSessionActive(loginSession)) throw new Error('扫码登录已取消', { cause: e })
      log.warn('QrCodeLogin', `localStorage extract failed: ${e.message}`)
    }
    if (!this._isSessionActive(loginSession)) throw new Error('扫码登录已取消')

    // 账号名称
    let accountName = loginSession.platform
    try {
      const title = await view.webContents.getTitle()
      if (title) accountName = `${loginSession.platform} (${title.slice(0, 20)})`
    // eslint-disable-next-line no-unused-vars
    } catch (e) { /* ignore */ }
    if (!this._isSessionActive(loginSession)) throw new Error('扫码登录已取消')

    // 昵称/头像：扫码成功即采集一次；未命中字段由下游按「缺席 = 不修改」处理，不清空真源
    const accountInfo = await accountProfile.collectWithWebContents(view.webContents, loginSession.platform)
    return { cookies, localStorage, accountName, accountInfo }
  }

  /**
   * 登录成功处理
   */
  async _onLoginSuccess (authData, loginSession = this._activeSession) {
    if (!this._isSessionActive(loginSession)) throw new Error('扫码登录已取消')
    if (loginSession.loginTimeout) {
      clearTimeout(loginSession.loginTimeout)
      loginSession.loginTimeout = null
      this._loginTimeout = null
    }

    const { cookies, localStorage, accountName, accountInfo } = authData
    log.info('QrCodeLogin', `Login success: ${cookies.length} cookies, account: ${accountName}`)

    if (!this.accountManager || typeof this.accountManager.saveCapturedAccount !== 'function') {
      throw new Error('账号持久化服务未初始化')
    }
    loginSession.phase = 'saving'
    const platform = loginSession.platform
    const account = await this.accountManager.saveCapturedAccount(platform, {
      cookies,
      localStorage,
      name: accountName,
      accountInfo,
    })
    const savedAccountId = account.id || account.accountId
    if (!this._isSessionActive(loginSession)) {
      if (savedAccountId && typeof this.accountManager.deleteAccount === 'function') {
        try {
          await this.accountManager.deleteAccount(savedAccountId)
        } catch (e) {
          log.error('QrCodeLogin', `回滚已取消的扫码账号失败: ${e.message}`)
        }
      }
      return null
    }
    const completed = {
      platform,
      accountId: savedAccountId,
      accountName: account.name || accountName,
    }
    if (!completed.accountId) throw new Error('保存账号后未返回账号 ID')

    // 只发送脱敏后的账号元数据，Cookie/localStorage 不跨越主进程边界。
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('qrcode:completed', completed)
    }

    // resolve
    loginSession.settled = true
    loginSession.resolve(completed)
    this._closeSession(loginSession, { notifyRenderer: false })
    return completed
  }

  _isSessionActive (loginSession) {
    return Boolean(
      loginSession &&
      this._activeSession === loginSession &&
      !loginSession.cancelled &&
      !loginSession.cleaned &&
      !loginSession.settled
    )
  }

  /**
   * 主窗口大小变化回调（保留签名，window.js 的 resize 挂钩会调用）。
   * 认证页改由独立窗口承载后，布局同步由 auth-window 的 resize 监听完成，
   * 主窗口大小变化不再影响认证窗口。
   */
  _onWindowResize () {
    if (!this.mainWindow || !this.currentView) return
    this._positionView()
  }

  /**
   * 设置左侧导航栏宽度（由 WebviewManager 同步）。
   * @param {number} width - 像素宽度
   */
  setSidebarWidth (width) {
    // 与 WebviewManager.setSidebarWidth 对齐：宽度必须严格 > 0（见 view-bounds MIN_SIDEBAR_WIDTH），
    // 拒绝 0 与负值，避免内嵌扫码登录视图 x 落到 0 覆盖侧边栏。
    if (typeof width !== 'number' || width < MIN_SIDEBAR_WIDTH || width > MAX_SIDEBAR_WIDTH) return
    this._sidebarWidth = width
    if (this.mainWindow && this.currentView) {
      this._positionView()
    }
  }

  /**
   * 登录视图布局（TabBar+NavBar 下方），与浏览器标签定位一致。
   * 尺寸来源必须是窗口客户区（getContentBounds），不能用 getBounds() 外框尺寸，
   * 否则视图右侧滚动条与底部内容会被窗口边框裁掉（见 view-bounds.js）。
   */
  _positionView () {
    if (!this.currentView || !this.mainWindow) return
    this.currentView.setBounds(computeEmbeddedViewBounds(this.mainWindow, this._sidebarWidth))
  }

  /**
   * 清理指定会话。所有异步回调都持有自己的会话引用，因此旧会话不能关闭新视图。
   */
  _closeSession (loginSession, options = {}) {
    if (!loginSession || loginSession.cleaned) return
    const notifyRenderer = options.notifyRenderer !== false
    const wasActive = this._activeSession === loginSession
    loginSession.cancelled = true
    this._stopQrDetection(loginSession)
    this._stopQrPagePreparation(loginSession)
    if (loginSession.loginTimeout) {
      clearTimeout(loginSession.loginTimeout)
      loginSession.loginTimeout = null
    }
    if (loginSession.extractTimer) {
      clearTimeout(loginSession.extractTimer)
      loginSession.extractTimer = null
    }

    if (loginSession.view) {
      // eslint-disable-next-line no-unused-vars
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed?.() && this.mainWindow.contentView) {
          try { this.mainWindow.contentView.removeChildView(loginSession.view) } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      try { loginSession.view.webContents.close() } catch (e) { /* ignore */ }
      try { loginSession.view.webContents.destroy() } catch (e) { /* ignore */ }
      loginSession.view = null
    }

    if (!loginSession.settled) {
      loginSession.settled = true
      loginSession.reject(options.reason || new Error('扫码登录窗口已关闭'))
    }
    loginSession.cleaned = true

    if (wasActive) {
      this._activeSession = null
      this.currentView = null
      this.currentPlatform = null
      this.currentAccountId = null
      this._resolveLogin = null
      this._rejectLogin = null
      this._scanTimer = null
      this._loginTimeout = null
      this._extractTimer = null
      this._lastQrHash = null
      this._fireClosed()
    }

    if (notifyRenderer && wasActive && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('qrcode:closed')
    }
    log.info('QrCodeLogin', 'Closed')
  }

  /**
   * 关闭当前扫码登录会话。
   */
  close (options = {}) {
    this._closeSession(this._activeSession, options)
  }

  /**
   * 注册 IPC handlers
   */
  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] qrcode-login registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）');
    }
    const ipcMain = injectedIpcMain;
    ipcMain.handle('auth:open-qrcode-login', withSenderCheck(async (event, platform) => {
      try {
        const result = await this.openLogin(platform)
        return { code: 0, data: result, message: '扫码登录成功' }
      } catch (e) {
        log.error('QrCodeLogin', `Login failed: ${e.message}`)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('auth:qrcode-close', withSenderCheck(() => {
      try {
        this.close()
        return { code: 0 }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))
  }
}

module.exports = QrCodeLogin
