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
const { selectAuthPartition } = require('./auth-partition')

// 平台默认域名：无 domain/url 的 cookie 按平台补 url（Electron cookies.set 要求 url）
function defaultCookieUrl (platform, cookie) {
  const domains = PLATFORM_COOKIE_DOMAINS[platform] || []
  const domain = domains[0]
  if (!domain) return ''
  const secure = cookie && typeof cookie.secure === 'boolean' ? cookie.secure : true
  return (secure ? 'https' : 'http') + '://' + String(domain).replace(/^\./, '') + '/'
}

/**
 * MP_RPA_POOL_SIZE 解析（C 方案，publish-throughput-optimization）。
 * 合法域 [1,10]，默认 6；非法/越界回落默认并出声告警（对齐 task-queue / publish-frequency-policy 纪律）。
 * @returns {number}
 */
function resolvePoolSize () {
  const DEFAULT = 6
  const raw = process.env.MP_RPA_POOL_SIZE
  if (raw === undefined || raw === '') return DEFAULT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    console.warn('[rpa-view] MP_RPA_POOL_SIZE 非法值 ' + JSON.stringify(raw) + '，回落默认 ' + DEFAULT + '（合法域 [1,10]）')
    return DEFAULT
  }
  return n
}

/** 池 TTL 默认 10 分钟（MP_RPA_POOL_TTL_MS 可覆盖，非法回落默认）。 */
function resolvePoolTtlMs () {
  const DEFAULT = 10 * 60 * 1000
  const raw = process.env.MP_RPA_POOL_TTL_MS
  if (raw === undefined || raw === '') return DEFAULT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) return DEFAULT
  return n
}

// 窗口池：键 = 'rpa-<platform>-<accountId|default>'（不含自增 id——池按逻辑会话复用，
// _windowKey 的自增 id 只用于「活动会话」命名，两者语义分离）。
// 值 = { win, lastUsedAt }。池化窗口保留持久 partition 的登录态（复用收益来源），
// 归池前导航 about:blank 释放页面 JS 状态。
function createPool () {
  return { map: new Map(), sweeper: null, size: resolvePoolSize(), ttlMs: resolvePoolTtlMs() }
}

/** 后台 TTL 清理（unref 定时器，不阻止进程退出）；无池窗口时自愈停止。 */
function startPoolSweeper (manager) {
  const pool = manager._pool
  if (pool.sweeper) return
  pool.sweeper = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of pool.map) {
      if (now - entry.lastUsedAt <= pool.ttlMs) continue
      pool.map.delete(key)
      try { if (!entry.win.isDestroyed()) entry.win.destroy() } catch (_) { /* ignore */ }
      log.info('RpaView', '[pool] TTL evict key=' + key)
    }
    if (pool.map.size === 0) { clearInterval(pool.sweeper); pool.sweeper = null }
  }, 60 * 1000)
  if (pool.sweeper && pool.sweeper.unref) pool.sweeper.unref()
}

/** 归还窗口到池（超限挤出最旧；健康检查失败的窗口直接销毁）。 */
function releaseToPool (manager, key, win) {
  const pool = manager._pool
  if (!pool || pool.map.has(key)) { try { if (!win.isDestroyed()) win.destroy() } catch (_) { /* ignore */ } return }
  if (pool.map.size >= pool.size) {
    // 挤出最旧（lastUsedAt 最小）
    let oldestKey = null; let oldestAt = Infinity
    for (const [k, e] of pool.map) {
      if (e.lastUsedAt < oldestAt) { oldestAt = e.lastUsedAt; oldestKey = k }
    }
    if (oldestKey !== null) {
      const oldest = pool.map.get(oldestKey)
      pool.map.delete(oldestKey)
      try { if (!oldest.win.isDestroyed()) oldest.win.destroy() } catch (_) { /* ignore */ }
    }
  }
  pool.map.set(key, { win, lastUsedAt: Date.now() })
  startPoolSweeper(manager)
}

/** 从池取窗口（命中则移出池并返回；未命中返回 null）。 */
function acquireFromPool (manager, key) {
  const pool = manager._pool
  if (!pool) return null
  const entry = pool.map.get(key)
  if (!entry) return null
  pool.map.delete(key)
  try {
    if (entry.win.isDestroyed()) return null
    return entry.win
  } catch (_) { return null }
}

/** 清空池（cleanup / shutdown 用）：销毁所有池内窗口。 */
function drainPool (manager) {
  const pool = manager._pool
  if (!pool) return
  if (pool.sweeper) { clearInterval(pool.sweeper); pool.sweeper = null }
  for (const [, entry] of pool.map) {
    try { if (!entry.win.isDestroyed()) entry.win.destroy() } catch (_) { /* ignore */ }
  }
  pool.map.clear()
}

const sessionMixin = {
  // C 方案：池解析函数静态暴露（测试与 container 层可读默认值）
  static: { resolvePoolSize, resolvePoolTtlMs },

  // ========== Window pool（C 方案 publish-throughput-optimization）==========
  /** 池键：按逻辑会话（平台+账号）复用，不含 _windowKey 的自增 id。 */
  _poolKey (platform, accountId) {
    return 'rpa-' + platform + '-' + (accountId || 'default')
  },
  /** 取窗口：池命中复用（跳过登录态恢复）；未命中新建。返回 { win, reused }。 */
  _acquireWindow (platform, accountId) {
    if (!this._pool) this._pool = createPool()
    const key = this._poolKey(platform, accountId)
    const hit = acquireFromPool(this, key)
    if (hit) {
      log.info('RpaView', '[pool] reuse window key=' + key)
      return { win: hit, reused: true }
    }
    const partition = 'persist:' + key
    // 2026-10-14 oss-b1 接线断点修复：必须透传 platform，否则 _resolvePreloadPath(undefined)
    // 恒选 baseline 变体，增强 preload（douyin/xiaohongshu/shipinhao 主世界注入）静默永不生效
    return { win: this._createWindow(partition, platform), reused: false }
  },
  /** 归还窗口：healthy=true 入池（先导航 about:blank 释放页面状态），false 立即销毁。 */
  async _releaseWindow (platform, accountId, win, healthy) {
    if (!this._pool) this._pool = createPool()
    const key = this._poolKey(platform, accountId)
    if (!healthy) {
      try { if (!win.isDestroyed()) win.destroy() } catch (_) { /* ignore */ }
      return
    }
    try {
      if (!win.isDestroyed()) {
        // 窗口级 loadURL 优先（语义等同 webContents.loadURL），兜底 webContents 路径
        if (typeof win.loadURL === 'function') await win.loadURL('about:blank')
        else await win.webContents.loadURL('about:blank')
      }
    } catch (_) { /* 导航失败仍入池（登录态在 session 层，不在页面层） */ }
    releaseToPool(this, key, win)
  },
  /** 清空池（cleanup 用）。 */
  _drainWindowPool () {
    if (this._pool) drainPool(this)
  },

  // ========== Window management ==========
  _createWindow(partition, platform) {
    const win = new BrowserWindow({ show:false, width:1280, height:800, webPreferences:{ session:session.fromPartition(partition,{cache:true}), contextIsolation:true, nodeIntegration:false, sandbox:true, backgroundThrottling:false,preload:this._resolvePreloadPath(platform) } })
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
  /**
   * oss-b1-rpa-hardening（2026-10-14）：按平台风控映射选 stealth preload 变体。
   * enhanced = 主世界 evasions 注入（高风控平台）；baseline = 现状。
   * 映射表单一真源 = packages/shared-utils/src/publish-capabilities.json riskControl。
   * 加载失败/未知平台一律回落 baseline（fail-closed 到现状，禁静默升级）。
   */
  _resolvePreloadPath(platform) {
    let variant = 'baseline'
    try {
      const { getPreloadVariant } = require('@multi-publish/shared-utils/src/publish-capabilities')
      variant = getPreloadVariant(platform) === 'enhanced' ? 'enhanced' : 'baseline'
    } catch (e) {
      this._logPreloadFallback(platform, e)
      variant = 'baseline'
    }
    const file = variant === 'enhanced' ? path.join('stealth', 'stealth-preload-enhanced.js') : 'stealth-preload.js'
    return path.join(__dirname, '..', file)
  },
  _logPreloadFallback(platform, e) {
    try { log.warn('RpaView', 'preload variant resolve failed, fallback baseline: ' + platform + ' ' + (e && e.message)) } catch (_e) { /* ignore */ }
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
      // 选址收敛到 auth-partition.selectAuthPartition 单一实现：kuaishou-w3-live-fix 防前缀规则漂移，
      // #2734 再防「按名字择新」被失败登录留下的空壳分区遮断（同组从新到旧按内容探，上限 PROBE_LIMIT）。
      const sel = await selectAuthPartition(platform, accountId, { log })
      const partitionName = sel.partition
      const cookies = sel.cookies || []
      if (!partitionName) {
        log.warn('RpaView', '[' + platform + '] no usable auth partition to supplement cookies: reason='
          + sel.reason + ' probed=' + sel.probed.length
          + (sel.probed.length ? ' [' + sel.probed.join(', ') + ']' : ''))
        return 0
      }
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
module.exports.resolvePoolSize = resolvePoolSize
module.exports.resolvePoolTtlMs = resolvePoolTtlMs
