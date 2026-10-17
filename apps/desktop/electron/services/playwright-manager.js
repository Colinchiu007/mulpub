// @ts-check
/**
 * Playwright 兼容层（Electron 原生替代）
 *
 * 提供 Playwright 兼容的 getContext() 接口，底层使用 Electron BrowserWindow。
 * 仅用于维持 account-manager 向后兼容，新代码请使用 AuthViewManager。
 *
 * 文件位置: apps/desktop/electron/playwright-manager.js
 * 状态: 已废弃（P2-E 迁移过渡留底）
 */

const { BrowserWindow, session } = require('electron')
const crypto = require('crypto')
const log = require('./logger')

function delay (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function normalizeSameSiteForElectron (sameSite) {
  const normalized = String(sameSite || 'Lax').toLowerCase()
  if (normalized === 'none' || normalized === 'no_restriction') return 'no_restriction'
  if (normalized === 'strict') return 'strict'
  return 'lax'
}

function normalizeSameSiteForPlaywright (sameSite) {
  const normalized = String(sameSite || 'lax').toLowerCase()
  if (normalized === 'none' || normalized === 'no_restriction') return 'None'
  if (normalized === 'strict') return 'Strict'
  return 'Lax'
}

function normalizeExpiration (value) {
  if (value === undefined || value === null || value === '' || value === -1) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value > 100000000000 ? value / 1000 : value)
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return Math.floor(numeric > 100000000000 ? numeric / 1000 : numeric)
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined
}

function createElectronCookie (cookie, fallbackUrl) {
  const path = typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/'
  const domain = typeof cookie.domain === 'string' ? cookie.domain : undefined
  const host = domain ? domain.replace(/^\.+/, '') : ''
  const secure = Boolean(cookie.secure)
  const url = cookie.url || (host ? `${secure ? 'https' : 'http'}://${host}${path}` : fallbackUrl)
  if (!url) throw new Error(`Cookie ${cookie.name || '<unknown>'} 缺少 url 或 domain`)

  const result = {
    url,
    name: cookie.name,
    value: cookie.value,
    ...(domain ? { domain } : {}),
    path,
    secure,
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: normalizeSameSiteForElectron(cookie.sameSite),
  }
  const expirationDate = normalizeExpiration(cookie.expires ?? cookie.expirationDate)
  if (expirationDate !== undefined) result.expirationDate = expirationDate
  return result
}

function createPlaywrightCookie (cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: normalizeSameSiteForPlaywright(cookie.sameSite),
    expires: normalizeExpiration(cookie.expirationDate ?? cookie.expires) ?? -1,
  }
}

function createContextAdapter (isolatedSession, getFallbackUrl = () => '') {
  return {
    async addCookies (cookies) {
      for (const cookie of cookies || []) {
        try {
          const fallbackUrl = cookie?.url || cookie?.domain ? '' : getFallbackUrl()
          await isolatedSession.cookies.set(createElectronCookie(cookie, fallbackUrl))
        } catch (e) {
          log.warn('playwright-manager', `setCookie failed for ${cookie?.name || '<unknown>'}: ${e.message}`)
        }
      }
    },
    async cookies () {
      const cookies = await isolatedSession.cookies.get({})
      return cookies.map(createPlaywrightCookie)
    },
  }
}

function buildEvaluationScript (fn, args = []) {
  if (typeof fn === 'string') return fn
  return `(${fn.toString()})(...${JSON.stringify(args)})`
}

/**
 * 创建一个与 Playwright Page 兼容的包装对象
 * @param {object} isolatedSession Electron 隔离会话
 * @param {{ show?: boolean }} [options] 窗口选项
 * @returns {object} page-like wrapper
 */
function createPage (
  isolatedSession = session.fromPartition(`auth-check-${crypto.randomUUID()}`, { cache: false }),
  options = {},
) {
  const { show = true } = options
  const win = new BrowserWindow({
    show,
    width: 1200,
    height: 800,
    webPreferences: {
      session: isolatedSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      // 一个永不显示的窗口不需要合成表面。隐藏窗口加载平台页面时触发原生渲染崩溃
      // （2026-09-16 toutiao / 2026-10-06 wechat_mp / 2026-10-16 kuaishou），既有对策是
      // 逐平台加进 account-manager 的 RENDER_CRASH_PRONE_OPEN_PLATFORMS 白名单（第四例 =
      // 知乎 #3726）——那是打地鼠：名单外的平台一开隐藏窗就再崩一次（2026-10-16 现场：
      // 应用日志停在 `checkLoginStatus: start kuaishou`，随后 crashpad not connected，
      // 全部 electron 进程消失）。这里从成因侧拆掉「隐藏窗口仍建表面、仍走合成」，
      // 隐藏上下文不产生可绘制表面；可见窗口保持默认 true，否则主界面画不出来。
      paintWhenInitiallyHidden: show,
    }
  })

  // 捕获 closed 状态
  let _closed = false
  win.on('closed', () => { _closed = true })

  // 渲染崩溃证据：隐藏窗口崩溃时旧行为是「日志戛然而止 + 全部 electron 进程消失」，
  // 无 minidump、crashpad 也连不上，现场无法归因。这里把事件登记下来：
  // ① 打日志（原因 / 退出码）② 让调用方 fail-fast，而不是在已死的 renderer 上继续
  // 轮询到超时——那会把「崩溃」伪装成「登录态不确定」，属同一族假绿。
  let _rendererGone = null
  function assertRendererAlive () {
    if (_rendererGone) {
      throw new Error('Renderer gone (' + _rendererGone + '): hidden window unusable')
    }
  }

  // 存储待注入的 Cookie
  const _initScripts = []
  const contextAdapter = createContextAdapter(isolatedSession, () => win.webContents.getURL())

  if (typeof win.webContents.on === 'function') {
    win.webContents.on('render-process-gone', (_event, details) => {
      _rendererGone = (details && details.reason) || 'unknown'
      const exitCode = (details && details.exitCode !== undefined) ? details.exitCode : 'n/a'
      log.error('playwright-manager', 'renderer gone: reason=' + _rendererGone + ' exitCode=' + exitCode)
    })
    win.webContents.on('dom-ready', () => {
      for (const code of _initScripts) {
        win.webContents.executeJavaScript(code).catch(e => {
          log.warn('playwright-manager', `init script failed: ${e.message}`)
        })
      }
    })
  }

  const page = {
    _win: win,

    /**
     * 导航到 URL
     * @param {string} url
     * @param {{ waitUntil?: string, timeout?: number }} [options]
     */
    async goto (url, options = {}) {
      // eslint-disable-next-line no-unused-vars
      const { timeout = 30000 } = options
      if (_closed) throw new Error('Page already closed')
      assertRendererAlive()
      await win.loadURL(url)
    },

    /**
     * 等待 DOM 选择器出现
     * @param {string} selector CSS 选择器
     * @param {{ timeout?: number }} [options]
     */
   async waitForSelector (selector, options = {}) {
      // 支持数组选择器：为每个候选 CSS 选择器依次尝试，匹配到任一个即返回
      const selectors = Array.isArray(selector) ? selector : [selector]
      const { timeout = 30000 } = options
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (_closed) throw new Error('Page closed while waiting')
        assertRendererAlive()
        try {
          const found = await win.webContents.executeJavaScript(
            `(function(){var s=${JSON.stringify(selectors)};for(var i=0;i<s.length;i++){if(document.querySelector(s[i]))return true;}return false;})()`
          )
          if (found) return true
        // eslint-disable-next-line no-unused-vars
        } catch (e) {
          // 页面可能还在加载，重试
        }
        await new Promise(r => setTimeout(r, 500))
      }
      throw new Error(`Timeout waiting for selectors: ${JSON.stringify(selectors)}`)
    },

    /**
     * 注入初始化脚本
     * @param {Function|string} fn
     */
    async addInitScript (fn) {
      if (_closed) return
      const code = typeof fn === 'function' ? `(${fn.toString()})()` : fn
      _initScripts.push(code)
    },

    /** 在页面主世界执行函数并返回可序列化结果 */
    async evaluate (fn, ...args) {
      if (_closed) throw new Error('Page already closed')
      return win.webContents.executeJavaScript(buildEvaluationScript(fn, args))
    },

    /** 等待页面函数返回真值 */
    async waitForFunction (fn, arg, options = {}) {
      const { timeout = 30000, polling = 100 } = options
      const interval = typeof polling === 'number' ? Math.max(1, polling) : 100
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (_closed) throw new Error('Page closed while waiting')
        assertRendererAlive()
        try {
          if (await win.webContents.executeJavaScript(buildEvaluationScript(fn, [arg]))) return true
        } catch (_e) {
          // 页面导航期间执行可能失败，继续轮询。
        }
        await delay(interval)
      }
      throw new Error('Timeout waiting for function')
    },

    /** 查询单个元素，返回兼容的最小 ElementHandle */
    async $ (selector) {
      if (_closed) throw new Error('Page already closed')
      const selectorJson = JSON.stringify(selector)
      const found = await win.webContents.executeJavaScript(`document.querySelector(${selectorJson}) !== null`)
      if (!found) return null
      return {
        textContent: () => win.webContents.executeJavaScript(
          `document.querySelector(${selectorJson})?.textContent ?? null`
        ),
      }
    },

    /** 当前页面 URL */
    url () {
      if (_closed) return ''
      return win.webContents.getURL()
    },

    /**
     * 返回 Cookie 上下文兼容对象
     */
    context () {
      return contextAdapter
    },

    /** 关闭页面 */
    async close () {
      if (!_closed && !win.isDestroyed()) {
        win.close()
      }
    }
  }

  return page
}

/**
 * 获取浏览器上下文（与 Playwright 兼容）
 * @param {{ show?: boolean }} [options]
 * @returns {Promise<{ newPage: Function }>}
 */
async function getContext (options = {}) {
  const isolatedSession = session.fromPartition(`auth-check-${crypto.randomUUID()}`, { cache: false })
  const contextAdapter = createContextAdapter(isolatedSession)
  return {
    newPage: () => createPage(isolatedSession, options),
    cookies: () => contextAdapter.cookies(),
  }
}

module.exports = {
  getContext,
  // ── 已废弃方法（仅占位防崩溃） ──
  launchBrowser: async () => {
    log.warn('playwright-manager', 'launchBrowser 已废弃（P2-E），请使用 getContext')
    return { newPage: createPage }
  },
  closeBrowser: async () => {
    log.warn('playwright-manager', 'closeBrowser 已废弃（P2-E）')
  },
  newPage: () => createPage(),
}
