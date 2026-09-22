// @ts-check
/**
 * 账号管理器
 * 负责通过 Playwright 捕获平台凭证；Python 后端只保存公开元数据，凭证保留在主进程加密存储。
 */
// eslint-disable-next-line no-unused-vars
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app } = require('electron')
const log = require('../services/logger')
const playwrightManager = require('../services/playwright-manager')
const { tryHttpLoginCheck } = require('./http-login-checker')
const pythonBridge = require('../services/python-bridge')
const accountStateRestorer = require('../services/account-state-restorer')
const credentialStore = require('../services/credential-store')
const { normalizeProxyConfig, toPublicProxyConfig } = require('../services/proxy-config')

// 安全：凭证写入路径使用 Electron userData 目录，而非当前工作目录
function getUserDataDir () {
  try { return app.getPath('userData') } catch { return path.join(os.homedir(), '.multi-publish') }
}

let ownerSubjectProvider = null

function normalizeOwnerSubject (ownerSubject) {
  if (typeof ownerSubject !== 'string' || !ownerSubject.trim()) {
    const error = new Error('登录会话缺少用户标识')
    error.isOwnerAuthError = true
    throw error
  }
  return ownerSubject.trim()
}

function setOwnerSubjectProvider (provider) {
  if (provider !== null && provider !== undefined && typeof provider !== 'function') {
    throw new TypeError('ownerSubjectProvider 必须是函数或 null')
  }
  ownerSubjectProvider = provider || null
}

function resolveOwnerSubject (explicitOwnerSubject) {
  if (explicitOwnerSubject !== undefined) return normalizeOwnerSubject(explicitOwnerSubject)
  if (!ownerSubjectProvider) return undefined
  return normalizeOwnerSubject(ownerSubjectProvider())
}

function isSafePathSegment (value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)
}
const {
  PLATFORM_LOGIN_URLS,
  PLATFORM_DASHBOARD_URLS,
  PLATFORM_NAMES,
  PLATFORM_LOGIN_SUCCESS_SELECTORS,
  PLATFORM_ACCOUNT_INFO_SELECTORS,
  getPlatformName,
  isPlatformCookieDomain,
} = require('@multi-publish/shared-utils/src/platform-definitions')

// 平台登录 URL / 名称 / 选择器 → @multi-publish/shared-utils/src/platform-definitions

/**
 * Smart wait: navigate to URL then wait for selector or timeout
 * @param {object} page
 * @param {string|null} successSelector
 * @param {number} fallbackMs
 * @returns {Promise<void>}
 */
async function smartWait (page, successSelector, fallbackMs = 3000) {
  if (successSelector) {
    try {
      await page.waitForSelector(successSelector, { timeout: fallbackMs })
    } catch {
      // Selector not found — just wait a bit
      await new Promise(r => setTimeout(r, fallbackMs))
    }
  } else {
    await new Promise(r => setTimeout(r, fallbackMs))
  }
}

/**
 * 打开 Playwright 页面，让用户登录平台，捕获 Cookie
 * @param {string} platform - 平台标识 (wechat_mp, zhihu, etc.)
 * @param {number} timeout - 等待登录超时时间（毫秒，默认 5 分钟）
 * @returns {Promise<{cookies: Array, name: string}>}
 */
async function captureCookies (platform, timeout = 300000) {
  if (!PLATFORM_LOGIN_URLS[platform]) {
    throw new Error(`不支持的平台: ${platform}`)
  }

  const loginUrl = PLATFORM_LOGIN_URLS[platform]
  const platformName = getPlatformName(platform)
  const successSelector = PLATFORM_LOGIN_SUCCESS_SELECTORS[platform]

  log.info('AccountManager', ` 开始捕获 ${platformName} Cookie`)
  log.info('AccountManager', ` 打开登录页面: ${loginUrl}`)

  // 获取 Playwright 上下文
  const context = await playwrightManager.getContext({ show: true })
  const page = await context.newPage()

  // 反检测
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
  })

  try {
    // 导航到登录页
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 })

    // 如果是公众号，先检查是否已经有登录态
    let loggedIn = false
    if (successSelector) {
      try {
        await page.waitForSelector(successSelector, { timeout: 5000 })
        loggedIn = true
        log.info('AccountManager', ` ${platformName} 已登录，直接捕获 Cookie`)
      } catch {
        log.info('AccountManager', ` 等待用户在 ${platformName} 登录...`)
      }
    }

    if (!loggedIn) {
      // 等待用户手动登录 — 检测到成功选择器或 Cookie 变化
      log.info('AccountManager', ` 请在弹出的浏览器窗口中登录 ${platformName}`)
      log.info('AccountManager', ` 超时时间: ${Math.round(timeout / 1000 / 60)} 分钟`)

      const loginDetected = await Promise.race([
        // 方式1: 等待成功选择器出现
        (async () => {
          if (successSelector) {
            try {
              await page.waitForSelector(successSelector, { timeout })
              return true
            } catch {
              return false
            }
          }
          return false
        })(),
        // 方式2: 等待 URL 变化（非登录页）
        (async () => {
          try {
            await page.waitForFunction(
              (loginHost) => window.location.host !== loginHost,
              new URL(loginUrl).host,
              { timeout, polling: 2000 }
            )
            return true
          } catch {
            return false
          }
        })(),
      ])

      if (!loginDetected) {
        throw new Error(`${platformName} 登录超时（${Math.round(timeout / 1000 / 60)} 分钟）`)
      }

      // 额外等待页面稳定
      await smartWait(page, successSelector, 3000)
    }

    // 获取所有 Cookie
    const cookies = await context.cookies()
    log.info('AccountManager', ` 捕获到 ${cookies.length} 个 Cookie`)

    // 尝试从页面获取账号名称
    let accountName = platformName
    try {
      if (platform === 'wechat_mp') {
        const nameEl = await page.$('.weui-desktop-account__name')
        if (nameEl) {
          accountName = await nameEl.textContent()
          accountName = accountName.trim() || platformName
        }
      }
    } catch {
      // 忽略名称获取失败
    }

    // Also extract localStorage and account info
    let localStorageData = {}
    let accountInfo = {}
    try {
      localStorageData = await page.evaluate(() => {
        const result = {}
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          result[key] = localStorage.getItem(key)
        }
        return result
      })
    } catch { /* ignore localStorage errors */ }

    try {
        accountInfo = await extractAccountInfo(page, platform)
    } catch { /* ignore account info errors */ }

    return { cookies, name: accountName, localStorage: localStorageData, accountInfo }
  } finally {
    // 关闭页面，但保留浏览器上下文（其他页面可能还在用）
    await page.close().catch(() => {})
  }
}

/**
 * 添加账号 — 通过 Playwright 捕获 Cookie 后调用 Python API 保存
 * @param {string} platform - 平台标识
 * @returns {Promise<Object>} 保存后的账号信息
 */
async function addAccount (platform, options = {}) {
  const ownerSubject = resolveOwnerSubject(options.ownerSubject)
  const { cookies, name, localStorage: localStorageData, accountInfo } = await captureCookies(platform)

  return saveCapturedAccount(platform, {
    cookies,
    name,
    localStorage: localStorageData,
    accountInfo,
  }, { ownerSubject })
}

/**
 * 保存已由浏览器或扫码流程捕获的账号凭证。
 * 凭证只在主进程流转，渲染进程只接收后端返回的脱敏账号信息。
 * @param {string} platform
 * @param {{cookies?: Array, name?: string, localStorage?: object, indexedDB?: object, accountInfo?: object}} captured
 * @returns {Promise<object>}
 */
async function saveCapturedAccount (platform, captured, options = {}) {
  if (!PLATFORM_LOGIN_URLS[platform]) throw new Error(`不支持的平台: ${platform}`)
  const ownerSubject = resolveOwnerSubject(options.ownerSubject)
  const userDataDir = getUserDataDir()
  const source = captured && typeof captured === 'object' ? captured : {}
  const cookies = Array.isArray(source.cookies)
    ? source.cookies.filter(cookie => isPlatformCookieDomain(platform, cookie?.domain))
    : []
  const localStorageData = source.localStorage && typeof source.localStorage === 'object' && !Array.isArray(source.localStorage)
    ? source.localStorage
    : {}
  const indexedDB = source.indexedDB && typeof source.indexedDB === 'object' && !Array.isArray(source.indexedDB)
    ? source.indexedDB
    : {}
  if (cookies.length === 0 && Object.keys(localStorageData).length === 0 && Object.keys(indexedDB).length === 0) {
    throw new Error('未捕获到有效登录凭证')
  }
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : getPlatformName(platform)
  const accountInfo = source.accountInfo && typeof source.accountInfo === 'object' && !Array.isArray(source.accountInfo)
    ? source.accountInfo
    : {}

  const accountName = typeof accountInfo.nickName === 'string' && accountInfo.nickName.trim()
    ? accountInfo.nickName.trim()
    : name
  const platformAccountId = typeof accountInfo.platformAccountId === 'string' && accountInfo.platformAccountId.trim()
    ? accountInfo.platformAccountId.trim()
    : ''
  const followers = Number.isFinite(Number(accountInfo.followers)) ? Number(accountInfo.followers) : null
  const avatar = typeof accountInfo.avatar === 'string' && accountInfo.avatar.trim()
    ? accountInfo.avatar.trim()
    : ''

  // 后端只保存公开元数据，避免在 accounts.json 中重复落盘凭证。
  const result = await pythonBridge.requestBackend('POST', '/api/accounts', {
    platform,
    name,
    account_name: accountName,
    platform_account_id: platformAccountId,
    followers,
    avatar,
  })

  if (result.code !== 0) {
    throw new Error(result.message || '保存账号失败')
  }

  const accountId = result.data?.accountId || result.data?.id
  if (!accountId) throw new Error('保存账号后未返回账号 ID')
  if (!isSafePathSegment(accountId)) throw new Error('保存账号后返回了非法账号 ID')

  const credentialSaved = credentialStore.saveCredential(accountId, {
    platform,
    cookies,
    localStorage: localStorageData,
    indexedDB,
    accountInfo,
  }, userDataDir, ...(ownerSubject === undefined ? [] : [ownerSubject]))
  if (!credentialSaved) {
    try { await pythonBridge.requestBackend('DELETE', `/api/accounts/${accountId}`) } catch (_) { /* 回滚失败由后端日志记录 */ }
    throw new Error('加密凭证保存失败，账号创建已回滚')
  }
  log.info('AccountManager', `Saved credential store for account ${accountId}`)

  // 状态记录仅含公开元数据，用于列表恢复和删除清理。
  try {
    const record = {
      accountId,
      platform,
      platformAccountId: accountInfo?.platformAccountId || '',
      accountInfo,
      timestamp: Date.now(),
    }
    const stateSaved = ownerSubject === undefined
      ? accountStateRestorer.saveAccountRecord(record)
      : accountStateRestorer.saveAccountRecord(record, ownerSubject, userDataDir)
    if (stateSaved) log.info('AccountManager', `Saved account state record for ${platform}:${accountId}`)
    else log.warn('AccountManager', `Failed to save account state record for ${platform}:${accountId}`)
  } catch (e) {
    log.warn('AccountManager', `Failed to save account state record: ${e.message}`)
  }

  log.info('AccountManager', ` 账号添加成功: ${name} (${platform})`)
  return result.data
}

/**
 * 删除账号
 * @param {string} accountId
 * @returns {Promise<boolean>}
 */
async function deleteAccount (accountId, options = {}) {
  if (!accountId || typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(accountId)) {
    throw new Error('缺少或非法账号 ID')
  }
  const ownerSubject = resolveOwnerSubject(options.ownerSubject)
  const userDataDir = getUserDataDir()
  let platform = ''
  try {
    const current = await pythonBridge.requestBackend('GET', `/api/accounts/${accountId}`)
    if (current?.code === 0 && typeof current.data?.platform === 'string') platform = current.data.platform
  } catch (_) { /* 删除仍可继续，凭证清理使用本地记录回退 */ }

  const result = await pythonBridge.requestBackend('DELETE', `/api/accounts/${accountId}`)
  // pythonBridge.requestBackend 对 404 会归一化为 { code: -404, status, message }，
  // 因此不能依赖 code === undefined 判断「账号已不存在」，否则该分支在生产永远不生效。
  const alreadyDeleted = Boolean(result && result.detail === '账号不存在')
  if ((result?.code ?? -1) !== 0 && !alreadyDeleted) {
    throw new Error((result && result.message) || '删除账号失败')
  }
  if (!platform) {
    try {
      const records = ownerSubject === undefined
        ? accountStateRestorer.listLoggedInAccounts()
        : accountStateRestorer.listLoggedInAccounts(ownerSubject, userDataDir)
      const record = records.find(item => item.accountId === accountId)
      platform = record?.platform || ''
    } catch (e) {
      log.warn('AccountManager', `查找账号本地状态失败: ${e.message}`)
    }
  }
  try {
    const credentialArgs = ownerSubject === undefined
      ? [accountId, userDataDir]
      : [accountId, userDataDir, ownerSubject]
    const hadCredential = credentialStore.hasCredential(...credentialArgs)
    let deletedCredential = credentialStore.deleteCredential(...credentialArgs)
    if (hadCredential && !deletedCredential) {
      // 重试一次（文件可能被临时锁定）
      await new Promise(resolve => setTimeout(resolve, 500))
      deletedCredential = credentialStore.deleteCredential(...credentialArgs)
    }
    if (hadCredential && !deletedCredential) {
      log.warn('AccountManager', '加密凭据文件删除失败，账号元数据已删除，凭据文件将在下次清理时重试')
    }
  } catch (e) {
    log.warn('AccountManager', `清理本地加密凭据异常: ${e.message}`)
  }
  try {
    if (ownerSubject !== undefined && platform && typeof accountStateRestorer.deleteAccountRecord === 'function') {
      accountStateRestorer.deleteAccountRecord(platform, accountId, ownerSubject, userDataDir)
    } else if (typeof accountStateRestorer.deleteAccountRecordsById === 'function') {
      if (ownerSubject === undefined) accountStateRestorer.deleteAccountRecordsById(accountId)
      else accountStateRestorer.deleteAccountRecordsById(accountId, ownerSubject, userDataDir)
    } else if (platform && typeof accountStateRestorer.deleteAccountRecord === 'function') {
      accountStateRestorer.deleteAccountRecord(platform, accountId)
    }
  } catch (e) {
    log.warn('AccountManager', `清理账号本地状态失败: ${e.message}`)
  }
  log.info('AccountManager', ` 账号已删除: ${accountId}`)
  return true
}

/**
 * 获取账号列表
 * @returns {Promise<Array>}
 */
async function listAccounts () {
  const result = await pythonBridge.requestBackend('GET', '/api/accounts')
  if (result.code !== 0) {
    // errorCode/status 随异常一起上抛：渲染层要能区分「上游瞬时不可用」和「确实没有账号」
    throw Object.assign(new Error(result.message || '获取账号列表失败'), {
      ...(typeof result.errorCode === 'string' && result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(typeof result.status === 'number' ? { status: result.status } : {}),
    })
  }
  const accounts = result.data || []
  // 每次拉取账号列表时清理孤儿凭据文件（对应账号已不存在的加密凭据）
  try {
    const ownerSubject = resolveOwnerSubject(undefined)
    const userDataDir = getUserDataDir()
    const knownIds = accounts.map(a => a?.id || a?.accountId || a?.account_id).filter(Boolean)
    if (typeof credentialStore.cleanOrphanCredentials === 'function') {
      if (ownerSubject === undefined) {
        credentialStore.cleanOrphanCredentials(knownIds, userDataDir)
      } else {
        credentialStore.cleanOrphanCredentials(knownIds, userDataDir, ownerSubject)
      }
    }
  } catch (e) {
    log.warn('AccountManager', '清理孤儿凭据失败: ' + (e && e.message ? e.message : String(e)))
  }
  return accounts.map(account => {
    const accountId = account?.id || account?.accountId || account?.account_id
    const platform = account?.platform
    if (!isSafePathSegment(accountId) || !isSafePathSegment(platform)) return account
    try {
      return { ...account, proxy: getAccountProxyStatus(accountId, platform) }
    } catch (_) {
      return { ...account, proxy: { configured: false } }
    }
  })
}

/**
 * 检查账号登录状态 — 通过加载 Cookie 并访问平台主页来判断
 * @param {string} platform - 平台标识
 * @param {string} accountId - 账号 ID
 * @returns {Promise<{valid: boolean, code?: string, error?: string}>}
 */
async function checkLoginStatus (platform, accountId) {
  if (!isSafePathSegment(platform) || !isSafePathSegment(accountId)) {
    return { valid: false, code: 'CHECK_LOGIN_INVALID_PARAMS' }
  }

  const loginUrl = PLATFORM_LOGIN_URLS[platform]
  const dashboardUrl = PLATFORM_DASHBOARD_URLS[platform]
  const successSelector = PLATFORM_LOGIN_SUCCESS_SELECTORS[platform]
  if (!loginUrl) return { valid: false, code: 'CHECK_LOGIN_UNSUPPORTED_PLATFORM' }

  // 渲染崩溃保护：视频号等平台在隐藏 sandbox 窗口中触发原生渲染崩溃
  // （crashpad not connected）导致整个应用退出，禁止走浏览器 DOM 检测。
  // 但本地凭证文件存在 ≠ Cookie 有效（视频号 Cookie 过期后文件仍在，
  // 仅查本地文件会把失效账号误判为已登录）。因此先尝试 HTTP API 检测
  // （http-login-checker 已注册 tencent_video，访问后台首页看是否 302 到
  // 登录页），HTTP 结果不确定或无 Cookie 时再回退本地凭证检查。
  const RENDER_CRASH_PRONE_PLATFORMS = new Set(['tencent_video'])
  if (RENDER_CRASH_PRONE_PLATFORMS.has(platform)) {
    const credentials = loadSavedCredentials(accountId, platform)
    const cookies = Array.isArray(credentials?.cookies) ? credentials.cookies : []
    if (cookies.length > 0) {
      const httpResult = await tryHttpLoginCheck(platform, cookies, accountId)
      if (httpResult) {
        log.info('AccountManager', 'checkLoginStatus: render-crash-prone platform ' + platform + ':' + accountId + ' http-check valid=' + httpResult.valid + ' code=' + httpResult.code)
        return httpResult
      }
      log.info('AccountManager', 'checkLoginStatus: render-crash-prone platform ' + platform + ':' + accountId + ' http-check inconclusive → local fallback')
    } else {
      log.info('AccountManager', 'checkLoginStatus: render-crash-prone platform ' + platform + ':' + accountId + ' no cookies → local fallback')
    }
    const hasLocal = checkLocalCredentials(platform, accountId)
    log.info('AccountManager', 'checkLoginStatus: render-crash-prone platform ' + platform + ':' + accountId + ' local-credential-only valid=' + hasLocal)
    return hasLocal
      ? { valid: true, code: 'CHECK_LOGIN_SUCCESS_LOCAL_ONLY' }
      : { valid: false, code: 'CHECK_LOGIN_NO_CREDENTIAL' }
  }

  try {
    const credentials = loadSavedCredentials(accountId, platform)
    const cookies = Array.isArray(credentials?.cookies) ? credentials.cookies : []
    const localStorageData = credentials?.localStorage && typeof credentials.localStorage === 'object' && !Array.isArray(credentials.localStorage)
      ? credentials.localStorage
      : {}
    if (!credentials || (cookies.length === 0 && Object.keys(localStorageData).length === 0)) {
      // 加密凭据文件缺失/为空时，回退到 checkLocalCredentials 的 session cookie
      // 分区备选路径（对齐 toPublicAccount 的凭证检测逻辑，消除两套路径不一致
      // 导致的假阳性过期判定）。
      const hasSessionCred = checkLocalCredentials(platform, accountId)
      log.info('AccountManager', 'checkLoginStatus: NO_ENCRYPTED_CREDENTIAL ' + platform + ':' + accountId + ' cookies=' + cookies.length + ' lsKeys=' + Object.keys(localStorageData).length + ' hasSessionCred=' + hasSessionCred)
      if (hasSessionCred) {
        // 有 session cookie 但无加密凭据 → 判为有效（用户通过内嵌浏览器标签
        // 登录后 Cookie 落在 Electron session 分区，未同步到加密文件）
        return { valid: true, code: 'CHECK_LOGIN_SUCCESS_SESSION_ONLY' }
      }
      return { valid: false, code: 'CHECK_LOGIN_NO_CREDENTIAL' }
    }

    // 快速路径：头条/百家号登录态完全由 Cookie 维持，无 Cookie 时跳过
    // 浏览器窗口检测（E2E 实测 toutiao 无 Cookie 浏览器检测耗时 19.2s）。
    const COOKIE_REQUIRED_PLATFORMS = new Set(['toutiao', 'baijiahao'])
    if (cookies.length === 0 && COOKIE_REQUIRED_PLATFORMS.has(platform)) {
      log.info('AccountManager', 'checkLoginStatus: NO_COOKIE fast-path ' + platform + ':' + accountId + ' lsKeys=' + Object.keys(localStorageData).length)
      return { valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
    }

    // HTTP API 快速路径（参考同类产品）：Cookie 直接调平台 API，<1s/平台。
    const httpResult = await tryHttpLoginCheck(platform, cookies, accountId)
    if (httpResult) return httpResult

    log.info('AccountManager', 'checkLoginStatus: start ' + platform + ':' + accountId + ' url=' + loginUrl + ' cookies=' + cookies.length + ' lsKeys=' + Object.keys(localStorageData).length + ' selectors=' + (Array.isArray(successSelector) ? '[' + successSelector.length + ' candidates]' : (successSelector ? '1' : '0')))

    // 创建临时 context 加载 Cookie 进行验证
    const browser = await playwrightManager.getContext({ show: false })
    const page = await browser.newPage()

    try {
      // 注入 Cookie
      if (cookies.length > 0) await page.context().addCookies(cookies)
      if (Object.keys(localStorageData).length > 0) {
        await page.addInitScript(buildLocalStorageRestoreScript(localStorageData))
      }

      // 访问平台页面 — 使用 domcontentloaded 代替 networkidle 以显著提速。
      // 15s→8s：登录检测只需要重定向链完成后的最终 URL 和基本 DOM，
      // 不需要完整加载页面资源。B 站等重定向链长的平台 8s 足够。
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 8000 })

      // 额外等待页面 JS 完成初始渲染（SPA 可能需要额外时间加载组件）。
      // 2s→500ms：domcontentloaded 后 SPA 框架通常已挂载，选择器等待本身
      // 有轮询重试，过长固定 sleep 是批量检测耗时主因（B 站 12.7s 中占 2s）。
      await new Promise(resolve => setTimeout(resolve, 500))

      // 检查登录状态选择器（支持数组选择器：PLATFORM_LOGIN_SUCCESS_SELECTORS 配置
      // 每个平台多个备选 CSS 选择器，playwright-manager 的 waitForSelector 会逐一尝试）
      let selectorMatched = false
      if (successSelector) {
        try {
          // 10s→3s：选择器不匹配时等满超时才降级 URL 检查，是批量检测
          // 耗时主因（B 站选择器全部过时，10s 全浪费）。3s 足够 SPA 渲染。
          await page.waitForSelector(successSelector, { timeout: 3000 })
          selectorMatched = true
          return { valid: true, code: "CHECK_LOGIN_SUCCESS" }
        } catch {
          // 选择器超时不一定意味着失效：某些平台的选择器可能因 DOM 变更而失效
          // 不立即判为过期，继续走 URL 检查逻辑
          log.info('AccountManager', 'checkLoginStatus: selector timeout ' + platform + ':' + accountId + ' selector=' + (Array.isArray(successSelector) ? successSelector.join(',').slice(0, 200) : String(successSelector).slice(0, 200)) + ' — 降级 URL 检查')
        }
      }

      // 检查 URL 是否跳离登录页
      const currentUrl = page.url()

      // 登录页 URL 特征检查必须先于仪表盘域名兜底：
      // 微信公众号等平台的登录页与后台同域（mp.weixin.qq.com/cgi-bin/loginpage
      // 与 mp.weixin.qq.com/ 同 host），若先做域名兜底会恒真，把已登出账号
      // 误判为已登录（公众号会话仅 24h，登出后 30 分钟定时检测也永远报 valid）。
      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        log.info('AccountManager', 'checkLoginStatus: URL hit login/signin marker ' + platform + ':' + accountId + ' url=' + currentUrl)
        return { valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED" }
      }

      // 选择器超时但 URL 不含登录特征，且在仪表盘/创作者中心域名下，
      // 说明实际上已登录（平台选择器因 DOM 变更而过时，但 Cookie 有效）
      if (successSelector && !selectorMatched && dashboardUrl) {
        try {
          const dashboardHost = new URL(dashboardUrl).hostname
          const currentHost = new URL(currentUrl).hostname
          if (currentHost === dashboardHost || currentHost.endsWith('.' + dashboardHost)) {
            log.info('AccountManager', 'checkLoginStatus: dashboard-host fallback valid ' + platform + ':' + accountId + ' currentHost=' + currentHost + ' dashboardHost=' + dashboardHost + ' selectorMatched=false')
            return { valid: true, code: "CHECK_LOGIN_SUCCESS" }
          }
        } catch (_) { /* URL 解析失败时继续走原有逻辑 */ }
      }

      // 兜底判定日志：选择器超时 + URL 无登录特征 + 非仪表盘域名时无条件判 valid，
      // 是假阳性盲区（logging-coverage-audit：必须留判定证据）
      log.warn('AccountManager', 'checkLoginStatus: fallback valid (no selector match, no login URL marker, no dashboard host) ' + platform + ':' + accountId + ' url=' + currentUrl + ' selectorMatched=' + selectorMatched)
      return { valid: true, code: "CHECK_LOGIN_SUCCESS" }
   } finally {
     await page.close().catch(() => {})
   }
  } catch (e) {
   // 隐藏浏览器检测失败时（平台反爬超时/阻断/导航失败），回退到本地凭证
   // 检测。对齐 toPublicAccount 的 checkLocalCredentials 逻辑，避免
   // 有效 session cookie 因浏览器检测不稳定而被误判过期。
   const hasLocal = checkLocalCredentials(platform, accountId)
   log.warn('AccountManager', 'checkLoginStatus: browser-check failed for ' + platform + ':' + accountId + ' error=' + (e && e.message ? e.message : String(e)) + ' hasLocalCred=' + hasLocal + ' — 回退本地凭证检测')
   return hasLocal
     ? { valid: true, code: 'CHECK_LOGIN_SUCCESS_LOCAL_ONLY' }
     : { valid: false, code: "CHECK_LOGIN_FAILED", error: e.message }
  }
}

/**
 * 从页面提取账号信息（昵称、头像、平台ID、粉丝数）。
 * 优先使用平台专用选择器（PLATFORM_ACCOUNT_INFO_SELECTORS），
 * 未命中时回退通用选择器。
 * @param {object} page - Playwright page
 * @param {string} [platform] - 平台标识（可选）
 */
async function extractAccountInfo (page, platform = '') {
  try {
    const platformSelectors = (platform && PLATFORM_ACCOUNT_INFO_SELECTORS[platform]) || null
    return await page.evaluate(({ platformSelectors }) => {
      const info = {}
      const trySelectors = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel)
          if (el) {
            const text = (el.textContent || '').trim()
            if (text) return text
          }
        }
        return null
      }
      const tryAttrSelectors = (selectors, attr) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel)
          if (el && el.getAttribute(attr)) return el.getAttribute(attr).trim()
        }
        return null
      }

      // 昵称：优先平台专用，后通用 → 多层回退
      const nickSelectors = platformSelectors && platformSelectors.nickname
        ? platformSelectors.nickname
        : [
          '[class*="nickname"]', '[class*="username"]', '[class*="user-name"]',
          '.user-info', '.profile-name', '#nickname', '#username',
          '[data-user-name]', '[class*="profile"] h1', '[class*="profile"] strong',
          '[class*="creator"] h1', '[class*="creator"] span',
        ]
      info.nickName = trySelectors(nickSelectors) || ''

      // 昵称回退：meta 标签 og:title / twitter:title
      if (!info.nickName) {
        const metaTitle = document.querySelector('meta[property="og:title"]')
        if (metaTitle) {
          const content = (metaTitle.getAttribute('content') || '').trim()
          if (content && content.length < 50) info.nickName = content
        }
      }
      if (!info.nickName) {
        const twitterTitle = document.querySelector('meta[name="twitter:title"]')
        if (twitterTitle) {
          const content = (twitterTitle.getAttribute('content') || '').trim()
          if (content && content.length < 50) info.nickName = content
        }
      }
      // 昵称最终回退：document.title 去掉后缀（如 " - 哔哩哔哩"）
      if (!info.nickName) {
        const rawTitle = (document.title || '').trim()
        if (rawTitle) {
          // 去掉常见平台后缀
          info.nickName = rawTitle.replace(/\s*[-–—|·]\s*(.+)$/, '').trim() || rawTitle
        }
      }

      // 头像：多层回退（img src → 背景图 → meta og:image）
      const avatarEl = document.querySelector(
        '[class*="avatar"] img, .avatar img, [class*="avatar-img"], ' +
        'img[class*="avatar"], img[class*="profile"], img[class*="portrait"], ' +
        '[class*="avatar"] [style*="background"], [class*="user-icon"] img'
      )
      if (avatarEl) {
        info.avatar = avatarEl.src || avatarEl.getAttribute('data-src') || avatarEl.getAttribute('data-original') || ''
        // 背景图回退
        if (!info.avatar && avatarEl.style && avatarEl.style.backgroundImage) {
          const bgMatch = String(avatarEl.style.backgroundImage).match(/url\(["']?([^"')]+)["']?\)/)
          if (bgMatch) info.avatar = bgMatch[1]
        }
      }
      // meta og:image 回退
      if (!info.avatar) {
        const metaImg = document.querySelector('meta[property="og:image"]')
        if (metaImg) info.avatar = (metaImg.getAttribute('content') || '').trim()
      }

      // 平台用户ID
      const idSelectors = platformSelectors && platformSelectors.platformAccountId
        ? platformSelectors.platformAccountId
        : ['[data-user-id]', '[data-account-id]', '[data-user]']
      info.platformAccountId = tryAttrSelectors(idSelectors, 'data-user-id') || tryAttrSelectors(idSelectors, 'data-account-id') || ''

      // 粉丝数：优先平台专用，后通用
      const followerSelectors = platformSelectors && platformSelectors.followers
        ? platformSelectors.followers
        : ['[class*="fans"]', '[class*="follower"]', '[class*="fan-count"]', '[class*="followers-count"]']
      const followerText = trySelectors(followerSelectors)
      if (followerText) {
        const match = followerText.match(/([\d.,]+)\s*(万|w|W)?/)
        if (match) {
          const num = Number(String(match[1]).replace(/,/g, ''))
          if (Number.isFinite(num)) {
            const suffix = (match[2] || '').toLowerCase()
            info.followers = num * (suffix === '万' || suffix === 'w' ? 10000 : 1)
          }
        }
      }
      return info
    }, { platformSelectors })
  } catch {
    return {}
  }
}

/**
 * 恢复 Cookie 到 Electron session
 * 基于参考产品逆向分析 restoreCookies
 */
function restoreCookies (session, cookies, baseUrl) {
  let _restoreFailed = 0
  const promises = cookies.map(cookie => {
    try {
      const { name, value, domain, path, secure, httpOnly, expirationDate, sameSite } = cookie
      return session.cookies.set({
        url: baseUrl || `https://${domain || 'localhost'}`,
        name: name || '',
        value: value || '',
        domain: domain || undefined,
        path: path || '/',
        secure: secure !== false,
        httpOnly: httpOnly || false,
        expirationDate: expirationDate || undefined,
        sameSite: sameSite || 'Unspecified',
      }).catch(e => {
        _restoreFailed += 1
        log.warn('AccountManager', 'restoreCookies: cookie set failed name=' + (name || '') + ' err=' + (e && e.message))
      })
    } catch {
      return Promise.resolve()
    }
  })
  return Promise.all(promises).then(results => {
    if (_restoreFailed > 0) log.warn('AccountManager', 'restoreCookies: ' + _restoreFailed + '/' + cookies.length + ' cookies failed to restore')
    return results
  })
}

/**
 * 恢复 localStorage 到 webContents
 * 基于参考产品逆向分析 restoreLocalStorage
 */
function restoreLocalStorage (webContents, localStorageObj) {
  if (!localStorageObj || typeof localStorageObj !== 'object') return Promise.resolve()
  
  const items = Object.entries(localStorageObj)
  if (items.length === 0) return Promise.resolve()

  // 安全修复：原 escape 顺序错误（先替换单引号导致 \'; 注入）
  // 改用 JSON.stringify 整体序列化，杜绝字符串拼接注入
  const script = buildLocalStorageRestoreScript(Object.fromEntries(items))

  return webContents.executeJavaScript(script).catch(() => {})
}

function buildLocalStorageRestoreScript (localStorageObj) {
  const json = JSON.stringify(localStorageObj || {})
  return `(function(){var d=${json};Object.keys(d).forEach(function(k){try{localStorage.setItem(k,d[k])}catch(e){}})})()`
}

/**
 * 从主进程本地存储读取账号凭证，禁止通过 preload 暴露给渲染进程。
 * @param {string} accountId
 * @param {string} platform
 * @returns {{cookies: Array, localStorage: object, indexedDB: object, accountInfo: object}|null}
 */
function loadSavedCredentials (accountId, platform, options = {}) {
  const ownerSubject = resolveOwnerSubject(options.ownerSubject)
  const userDataDir = getUserDataDir()
  const credentialData = ownerSubject === undefined
    ? credentialStore.loadCredential(accountId, userDataDir)
    : credentialStore.loadCredential(accountId, userDataDir, ownerSubject)
  const accountRecord = ownerSubject === undefined
    ? accountStateRestorer.getAccountRecord(platform, accountId)
    : accountStateRestorer.getAccountRecord(platform, accountId, ownerSubject, userDataDir)
  if (!credentialData) return null
  const credentialPlatform = typeof credentialData.platform === 'string' ? credentialData.platform : ''
  const recordPlatform = typeof accountRecord?.platform === 'string' ? accountRecord.platform : ''
  if (credentialPlatform && credentialPlatform !== platform) return null
  if (recordPlatform && recordPlatform !== platform) return null
  if (!credentialPlatform && !recordPlatform) return null

  const credentials = {
    cookies: Array.isArray(credentialData.cookies)
      ? credentialData.cookies.filter(cookie => isPlatformCookieDomain(platform, cookie?.domain))
      : [],
    localStorage: credentialData.localStorage || {},
    indexedDB: credentialData.indexedDB || {},
    accountInfo: credentialData.accountInfo || accountRecord?.accountInfo || {},
  }
  if (credentialData.proxy !== undefined) credentials.proxy = credentialData.proxy
  return credentials
}

function getAccountProxyStatus (accountId, platform, options = {}) {
  const credentials = loadSavedCredentials(accountId, platform, options)
  if (!credentials || credentials.proxy === undefined || credentials.proxy === null) {
    return { configured: false }
  }
  try {
    return toPublicProxyConfig(credentials.proxy)
  } catch (_) {
    return { configured: true, invalid: true }
  }
}

function setAccountProxy (accountId, platform, proxy, options = {}) {
  if (!isSafePathSegment(accountId) || !isSafePathSegment(platform) || !PLATFORM_LOGIN_URLS[platform]) {
    throw new Error('缺少或非法 accountId/platform 参数')
  }
  const ownerSubject = resolveOwnerSubject(options.ownerSubject)
  const credentials = loadSavedCredentials(accountId, platform, { ownerSubject })
  if (!credentials) throw new Error('账号不存在或本地凭证不可用')
  const normalizedProxy = normalizeProxyConfig(proxy)
  const userDataDir = getUserDataDir()
  const payload = {
    platform,
    cookies: credentials.cookies,
    localStorage: credentials.localStorage,
    indexedDB: credentials.indexedDB,
    accountInfo: credentials.accountInfo,
  }
  if (normalizedProxy) payload.proxy = normalizedProxy
  const saveArgs = ownerSubject === undefined
    ? [accountId, payload, userDataDir]
    : [accountId, payload, userDataDir, ownerSubject]
  if (!credentialStore.saveCredential(...saveArgs)) throw new Error('加密代理配置保存失败')
  return toPublicProxyConfig(normalizedProxy)
}

/**
 * 打开已保存的账号（恢复登录状态）
 * 基于参考产品逆向分析 openSavedAccount
 * 
 * @param {string} accountId - 账号ID
 * @param {string} platform - 平台
 * @param {object} opts - { mainWindow?, session? }
 * @returns {Promise<{view?, isLoggedIn: boolean}>}
 */
async function openSavedAccount (accountId, platform, opts = {}) {
  // eslint-disable-next-line no-unused-vars
  const { mainWindow, session } = opts
  const ownerSubject = resolveOwnerSubject(opts.ownerSubject)
  
  // 从本地存储加载完整凭证
  const credentials = loadSavedCredentials(accountId, platform, { ownerSubject })

  if (!credentials) {
    log.info('AccountManager', `No saved credentials for ${platform}:${accountId}`)
    return { isLoggedIn: false }
  }

  const { localStorage: localStorageData, cookies, accountInfo } = credentials
  const baseUrl = PLATFORM_LOGIN_URLS[platform] || ''
  
  if (!session) {
    log.info('AccountManager', `Restoring credentials for ${platform}:${accountId}`)
    return { isLoggedIn: true, accountInfo, localStorageData }
  }
  
  // 有 session 时恢复 cookies
  try {
    await restoreCookies(session, cookies, baseUrl)
  } catch (e) {
    log.warn('AccountManager', `restoreCookies failed: ${e.message}`)
  }
  
  const webContents = opts.webContents || mainWindow?.webContents
  if (webContents && Object.keys(localStorageData).length > 0) {
    await restoreLocalStorage(webContents, localStorageData)
  }
  return { isLoggedIn: true, accountInfo, localStorageData }
}

/**
 * 检查本地是否有账号凭证
 */
function checkLocalCredentials (platform, accountId, options = {}) {
  const ownerSubject = resolveOwnerSubject(options.ownerSubject)
  const userDataDir = getUserDataDir()
  const args = ownerSubject === undefined
    ? [accountId, userDataDir]
    : [accountId, userDataDir, ownerSubject]
  const hasEncrypted = credentialStore.hasCredential(...args)
  if (hasEncrypted) {
    const loaded = loadSavedCredentials(accountId, platform, { ownerSubject })
    if (!loaded) {
      log.info('AccountManager', 'checkLocalCredentials: file exists but loadSavedCredentials null for ' + platform + ':' + accountId + (ownerSubject ? ' (owner=' + ownerSubject + ')' : ' (legacy)'))
      // 加密文件损坏：仍检查 session 分区作为备选
    } else {
      log.info('AccountManager', 'checkLocalCredentials: OK encrypted ' + platform + ':' + accountId + ' cookies=' + (loaded.cookies ? loaded.cookies.length : 0) + ' lsKeys=' + Object.keys(loaded.localStorage || {}).length)
      return true
    }
  }

  // 备选：Electron session 分区 Cookie（persist:account-{accountId}）
  // 用户通过浏览器标签登录后，Electron 自动持久化 Cookie 到 session 分区。
  // 加密凭据文件可能因 saveCapturedAccount 未成功而未创建，但浏览器的
  // persist:account-{accountId} 分区 Cookie 仍然有效（创作者中心显示已登录）。
  // 此备选路径让 checkLocalCredentials 把 session Cookie 文件的存在也视为有效凭证。
  if (isSafePathSegment(accountId)) {
    try {
      // sessionData 路径被 startup-compat.js 重定向到 userDataDir/session，
      // 因此账号级 persist:account-{id} 分区的 Cookie 实际落在
      // userDataDir/session/Partitions/account-{id}/Network/Cookies。
      // 旧版本落在 userDataDir/Partitions/...；两处都检查，兼容历史数据。
      const sessionCookieCandidates = [
        path.join(userDataDir, 'session', 'Partitions', 'account-' + accountId, 'Network', 'Cookies'),
        path.join(userDataDir, 'Partitions', 'account-' + accountId, 'Network', 'Cookies'),
      ]
      for (const sessionCookiePath of sessionCookieCandidates) {
        if (fs.existsSync(sessionCookiePath)) {
          const cookieStats = fs.statSync(sessionCookiePath)
          if (cookieStats.size > 0) {
            log.info('AccountManager', 'checkLocalCredentials: OK session-cookie ' + platform + ':' + accountId + ' size=' + cookieStats.size + 'B path=' + sessionCookiePath + ' (fallback from missing encrypted file)')
            return true
          }
          log.info('AccountManager', 'checkLocalCredentials: session cookie file empty for ' + platform + ':' + accountId + ' path=' + sessionCookiePath)
        }
      }
    } catch (e) {
      log.warn('AccountManager', 'checkLocalCredentials: session cookie check error for ' + platform + ':' + accountId + ' ' + (e && e.message ? e.message : String(e)))
    }
  }

  log.info('AccountManager', 'checkLocalCredentials: NO credential for ' + platform + ':' + accountId + ' (no encrypted file, no session cookie file)' + (ownerSubject ? ' (owner=' + ownerSubject + ')' : ' (legacy)'))
  return false
}

/**
 * 更新已有账号凭证（重新登录场景）。
 * 覆盖 credentialStore 中的加密凭据，并通过 Python 后端更新公开元数据。
 * @param {string} platform
 * @param {{cookies?: Array, name?: string, localStorage?: object, indexedDB?: object, accountInfo?: object}} captured
 * @param {string} accountId - 已有账号 ID
 * @returns {Promise<object>}
 */
async function updateCapturedAccount (platform, captured, accountId) {
  if (!PLATFORM_LOGIN_URLS[platform]) throw new Error('不支持的平台: ' + platform)
  if (!accountId || typeof accountId !== 'string' || !isSafePathSegment(accountId)) throw new Error('缺少或非法账号 ID')
  const ownerSubject = resolveOwnerSubject(undefined)
  const userDataDir = getUserDataDir()
  const source = captured && typeof captured === 'object' ? captured : {}
  const cookies = Array.isArray(source.cookies)
    ? source.cookies.filter(cookie => isPlatformCookieDomain(platform, cookie?.domain))
    : []
  const localStorageData = source.localStorage && typeof source.localStorage === 'object' && !Array.isArray(source.localStorage)
    ? source.localStorage
    : {}
  const indexedDB = source.indexedDB && typeof source.indexedDB === 'object' && !Array.isArray(source.indexedDB)
    ? source.indexedDB
    : {}
  if (cookies.length === 0 && Object.keys(localStorageData).length === 0 && Object.keys(indexedDB).length === 0) {
    throw new Error('未捕获到有效登录凭证')
  }
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : getPlatformName(platform)
  const accountInfo = source.accountInfo && typeof source.accountInfo === 'object' && !Array.isArray(source.accountInfo)
    ? source.accountInfo
    : {}
  const accountName = typeof accountInfo.nickName === 'string' && accountInfo.nickName.trim()
    ? accountInfo.nickName.trim()
    : name
  const platformAccountId = typeof accountInfo.platformAccountId === 'string' && accountInfo.platformAccountId.trim()
    ? accountInfo.platformAccountId.trim()
    : ''
  const followers = Number.isFinite(Number(accountInfo.followers)) ? Number(accountInfo.followers) : null
  const avatar = typeof accountInfo.avatar === 'string' && accountInfo.avatar.trim()
    ? accountInfo.avatar.trim()
    : ''

  // 验证账号存在且平台匹配
  let account
  try {
    const result = await pythonBridge.requestBackend('GET', '/api/accounts/' + accountId)
    if (result.code !== 0) throw new Error('账号不存在')
    account = result.data
    if (account.platform !== platform) throw new Error('账号平台不匹配')
  } catch (e) {
    throw new Error('账号不存在或平台不匹配: ' + e.message, { cause: e })
  }

  // 更新后端公开元数据（PATCH）
  try {
    const metaResult = await pythonBridge.requestBackend('PATCH', '/api/accounts/' + accountId, {
      name,
      account_name: accountName,
      platform_account_id: platformAccountId,
      followers,
      avatar,
      last_validated: new Date().toISOString(),
    })
    if (metaResult.code !== 0) {
      log.warn('AccountManager', '更新后端账号元数据失败: ' + accountId)
    }
  } catch (e) {
    log.warn('AccountManager', '更新后端账号元数据异常: ' + e.message)
  }

  // 覆盖凭证存储（原子写入，自动覆盖旧文件）
  const credentialSaved = credentialStore.saveCredential(accountId, {
    platform,
    cookies,
    localStorage: localStorageData,
    indexedDB,
    accountInfo,
  }, userDataDir, ...(ownerSubject === undefined ? [] : [ownerSubject]))
  if (!credentialSaved) {
    throw new Error('加密凭证更新失败')
  }
  log.info('AccountManager', 'Updated credential store for account ' + accountId)

  // 更新本地状态记录
  try {
    const record = {
      accountId,
      platform,
      platformAccountId: accountInfo?.platformAccountId || '',
      accountInfo,
      timestamp: Date.now(),
    }
    const stateSaved = ownerSubject === undefined
      ? accountStateRestorer.saveAccountRecord(record)
      : accountStateRestorer.saveAccountRecord(record, ownerSubject, userDataDir)
    if (stateSaved) log.info('AccountManager', 'Updated account state record for ' + platform + ':' + accountId)
    else log.warn('AccountManager', 'Failed to update account state record for ' + platform + ':' + accountId)
  } catch (e) {
    log.warn('AccountManager', 'Failed to update account state record: ' + e.message)
  }

  log.info('AccountManager', '账号凭证已更新: ' + name + ' (' + platform + ', ' + accountId + ')')
  return { ...account, name, account_name: accountName, platform_account_id: platformAccountId, followers, avatar, last_validated: new Date().toISOString() }
}

module.exports = {
  addAccount,
  saveCapturedAccount,
  updateCapturedAccount,
  deleteAccount,
  listAccounts,
  checkLoginStatus,
  captureCookies,
  PLATFORM_LOGIN_URLS,
  PLATFORM_NAMES,
  PLATFORM_LOGIN_SUCCESS_SELECTORS,
  extractAccountInfo,
  restoreCookies,
  restoreLocalStorage,
  loadSavedCredentials,
  getAccountProxyStatus,
  setAccountProxy,
  openSavedAccount,
  checkLocalCredentials,
  setOwnerSubjectProvider,
  accountStateRestorer,
  credentialStore,
}
