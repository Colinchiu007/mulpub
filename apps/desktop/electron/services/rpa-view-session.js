// @ts-check
/**
 * RpaViewManager session mixin — 窗口/会话管理
 *
 * 拆分自 rpa-view-manager.js (2026-07-16 架构重构)
 * 通过 Object.assign 注入 RpaViewManager.prototype，方法内通过 this.* 访问
 * 其他 mixin 提供的方法。
 *
 * 依赖：BrowserWindow / session / path / log
 */
const { BrowserWindow, session, app } = require('electron')
const path = require('path')
const log = require('./logger')
const { normalizeProxyConfig, toElectronProxyRules } = require('./proxy-config')
const { PLATFORM_LOGIN_URLS, PLATFORM_COOKIE_DOMAINS } = require('@multi-publish/shared-utils/src/platform-definitions')
const { restoreLocalStorage, restoreIndexedDB } = require('./auth-view-session')
const { findAuthPartitionDir } = require('./auth-partition')

// 平台默认域名：无 domain/url 的 cookie 按平台补 url（Electron cookies.set 要求 url）
function defaultCookieUrl (platform, cookie) {
  const domains = PLATFORM_COOKIE_DOMAINS[platform] || []
  const domain = domains[0]
  if (!domain) return ''
  const secure = cookie && typeof cookie.secure === 'boolean' ? cookie.secure : true
  return (secure ? 'https' : 'http') + '://' + String(domain).replace(/^\./, '') + '/'
}

const sessionMixin = {
  // ========== Window management ==========
  _createWindow(partition) {
    const win = new BrowserWindow({ show:false, width:1280, height:800, webPreferences:{ session:session.fromPartition(partition,{cache:true}), contextIsolation:true, nodeIntegration:false, sandbox:true, backgroundThrottling:false,preload:path.join(__dirname,'../stealth-preload.js') } })
    win.webContents.on('did-fail-load',function(e,code,desc){log.warn('RpaView','load fail: '+desc+' ('+code+')')})
    // 渲染进程 console 转发（logging-coverage-audit：此前空处理器吞掉页面 JS 报错）
    win.webContents.on('console-message', function (e, _level, message, line, sourceId) {
      // 只转发 warning 及以上，避免页面正常日志刷屏；sourceId/line 帮助定位页面报错
      if (_level >= 2) log.warn('RpaView', 'page console: ' + String(message).slice(0, 300) + ' (' + String(sourceId).slice(0, 120) + ':' + line + ')')
    })
    // 渲染进程崩溃/无响应（logging-coverage-audit：此前完全静默）
    win.webContents.on('render-process-gone', function (e, details) {
      log.error('RpaView', 'render process gone: reason=' + (details && details.reason) + ' exitCode=' + (details && details.exitCode))
    })
    win.webContents.on('unresponsive', function () {
      log.warn('RpaView', 'page unresponsive')
    })
    // anti-detection: inject stealth on every navigation
     
    // stealth injected via preload script
    return win
  },
  _windowKey(platform, accountId) { return 'rpa-'+platform+'-'+(accountId||'default')+'-'+(this._nextId++) },

  async _configureProxy(win, proxy) {
    const config = normalizeProxyConfig(proxy)
    if (!config) return function () {}
    const proxySession = win?.webContents?.session
    if (!proxySession || typeof proxySession.setProxy !== 'function') {
      throw new Error('浏览器会话不支持代理配置')
    }

    await proxySession.setProxy({ proxyRules: toElectronProxyRules(config) })
    log.info('RpaView', `Proxy configured (${config.type})`)

    if (!config.username) return function () {}
    if (!app || typeof app.on !== 'function' || typeof app.removeListener !== 'function') {
      throw new Error('当前运行环境不支持代理认证')
    }

    const loginHandler = (event, webContents, _details, authInfo, callback) => {
      if (webContents !== win.webContents || !authInfo?.isProxy || typeof callback !== 'function') return
      event.preventDefault()
      callback(config.username, config.password)
    }
    app.on('login', loginHandler)
    return () => app.removeListener('login', loginHandler)
  },

  // ========== Cookie / browser storage restore ==========
  async _restoreCookies(win, cookies, platform) {
    if (!cookies||!cookies.length) return
    let restored = 0
    // eslint-disable-next-line no-unused-vars
    for (let ci=0;ci<cookies.length;ci++) {
      const c = cookies[ci] || {}
      try {
        const setArgs = { name: c.name, value: c.value, path: c.path || '/' }
        if (typeof c.secure === 'boolean') setArgs.secure = c.secure
        if (typeof c.httpOnly === 'boolean') setArgs.httpOnly = c.httpOnly
        if (typeof c.expirationDate === 'number' && Number.isFinite(c.expirationDate)) setArgs.expirationDate = c.expirationDate
        if (typeof c.sameSite === 'string' && c.sameSite) setArgs.sameSite = c.sameSite
        if (typeof c.url === 'string' && c.url) {
          setArgs.url = c.url
        } else if (typeof c.domain === 'string' && c.domain) {
          // Electron cookies.set requires url (v40+); keep domain to preserve domain-scoped cookie
          setArgs.url = (c.secure ? 'https' : 'http') + '://' + c.domain.replace(/^\./, '') + '/'
          setArgs.domain = c.domain
        } else {
          // 无 domain 且无 url 的 cookie：按平台默认域名补 url，避免静默丢弃
          const fallbackUrl = defaultCookieUrl(platform, c)
          if (!fallbackUrl) continue
          setArgs.url = fallbackUrl
        }
        await win.webContents.session.cookies.set(setArgs)
        restored += 1
      } catch (e) { log.warn('RpaView', 'cookie restore failed name=' + (c && c.name) + ' err=' + (e && e.message)) }
    }
    log.info('RpaView','Restored '+restored+'/'+cookies.length+' cookies')
    if (restored === 0 && cookies && cookies.length > 0) {
      log.warn('RpaView','[' + (platform || 'unknown') + '] cookie restore failed: 0/' + cookies.length + ' cookies restored')
    }
  },

  // 从最新登录分区补充完整 cookie（登录会话是最权威来源，可补回凭证过滤丢掉的父域 cookie 如 BDUSS）
  async _restoreAuthPartitionCookies(win, platform, accountId) {
    try {
      // 分区定位收敛到 auth-partition.findAuthPartitionDir 单一实现（kuaishou-w3-live-fix：防两处前缀规则漂移）
      const partitionName = findAuthPartitionDir(platform, accountId)
      if (!partitionName) {
        log.warn('RpaView', '[' + platform + '] no auth partition to supplement cookies')
        return 0
      }
      const authSession = session.fromPartition('persist:' + partitionName)
      const cookies = await authSession.cookies.get({})
      let restored = 0
      for (let ci = 0; ci < cookies.length; ci++) {
        const c = cookies[ci] || {}
        try {
          const setArgs = { name: c.name, value: c.value, path: c.path || '/' }
          if (typeof c.secure === 'boolean') setArgs.secure = c.secure
          if (typeof c.httpOnly === 'boolean') setArgs.httpOnly = c.httpOnly
          if (typeof c.expirationDate === 'number' && Number.isFinite(c.expirationDate)) setArgs.expirationDate = c.expirationDate
          if (typeof c.sameSite === 'string' && c.sameSite) setArgs.sameSite = c.sameSite
          setArgs.url = (c.secure ? 'https' : 'http') + '://' + c.domain.replace(/^\./, '') + '/'
          setArgs.domain = c.domain
          await win.webContents.session.cookies.set(setArgs)
          restored += 1
        } catch (e) { log.warn('RpaView', 'auth partition cookie restore failed name=' + (c && c.name) + ' err=' + (e && e.message)) }
      }
      log.info('RpaView', '[' + platform + '] supplemented ' + restored + '/' + cookies.length + ' cookies from auth partition ' + partitionName)
      if (restored === 0 && cookies && cookies.length > 0) {
        log.warn('RpaView', '[' + platform + '] auth partition ' + partitionName + ' had ' + cookies.length + ' cookies but none could be restored')
      }
      return restored
    } catch (e) {
      log.warn('RpaView', '[' + platform + '] auth partition cookie supplement failed: ' + e.message)
      return 0
    }
  },
  async _restoreBrowserStorage(win, platform, authData) {
    const localStorage = authData?.localStorage
    const indexedDB = authData?.indexedDB
    const hasLocalStorage = Boolean(localStorage && typeof localStorage === 'object' && !Array.isArray(localStorage) && Object.keys(localStorage).length > 0)
    const hasIndexedDB = Boolean(indexedDB && typeof indexedDB === 'object' && !Array.isArray(indexedDB) && Object.keys(indexedDB).length > 0)
    if (!hasLocalStorage && !hasIndexedDB) return

    const restoreUrl = PLATFORM_LOGIN_URLS[platform]
    if (!restoreUrl || !win?.webContents || typeof win.webContents.loadURL !== 'function') {
      log.warn('RpaView', 'browser storage restore skipped: missing platform auth URL')
      return
    }

    const view = { webContents: win.webContents }
    const restorations = []
    if (hasLocalStorage) restorations.push(restoreLocalStorage(view, localStorage))
    if (hasIndexedDB) restorations.push(restoreIndexedDB(view, indexedDB))
    try {
      await win.webContents.loadURL(restoreUrl)
      await Promise.all(restorations)
      log.info('RpaView', 'browser storage restored')
    } catch (e) {
      log.warn('RpaView', 'browser storage restore: ' + e.message)
    }
  },
}

module.exports = sessionMixin
