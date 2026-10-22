// @ts-check
/**
 * auth-view-saved-account — 「打开已保存账号」的内嵌登录视图
 *
 * 为什么从 `auth-view-manager.js` 平移出来（2026-10-21）：
 * ① 行数门禁（`.github/scripts/check-max-lines.js`）：`auth-view-manager.js` 的登记值 553 行、
 *    容差 200 行，本刀（登录槽位）把文件推到 771 行 ⇒ 超出容差 18 行 ⇒ 必须拆分；
 * ② 关注点不同：「打开已保存账号」是**恢复既有凭证**的路径（注入 Cookie / localStorage /
 *    IndexedDB 后直接进后台页），与「打开登录页让用户登录」是两条路，混在一个类里谁都不好读。
 *
 * 平移纪律（`openspec/specs/desktop/spec.md`「纯平移重构必须先有特征测试并有反证」）：
 * 行为**逐字不变**，特征测试见 `auth-view-saved-account.test.js`（平移前后同一套用例都必须绿）。
 *
 * 与登录槽位的关系：这里**刻意不用**槽位 —— 本路径要注入指定账号的凭证，
 * 若复用按平台复用的槽位，就会把「上一个账号的会话」与「本次注入的凭证」混在同一分区里。
 * 故沿用一次性分区 `auth-saved-<platform>-<ts>`（用完由回收端按窗口回收）。
 */
const { session } = require('electron')
const { PLATFORM_LOGIN_URLS, isPlatformCookieDomain } = require('@multi-publish/shared-utils/src/platform-definitions')
const { createSession, setCookies, restoreLocalStorage, restoreIndexedDB, createAuthView } = require('./auth-view-session')

/**
 * 打开已保存账号（恢复登录状态）的内嵌登录视图。
 *
 * @param {any} ctx AuthViewManager 实例（需要 mainWindow / currentView / _positionView / close 等）
 * @param {string} platform
 * @param {any[]} cookies
 * @param {Record<string, string>} [localStorage]
 * @param {Record<string, Record<string, Record<string, unknown>>>} [indexedDB]
 * @returns {Promise<void>}
 */
async function openSavedAccount (ctx, platform, cookies, localStorage, indexedDB) {
  const loginUrl = /** @type {Record<string, string>} */ (PLATFORM_LOGIN_URLS)[platform]
  if (!loginUrl) return
  if (!ctx.mainWindow) return

  const accountId = `auth-saved-${platform}-${Date.now()}`
  ctx.currentPlatform = platform
  ctx.currentAccountId = accountId

  const authSession = createSession(accountId, session)
  await setCookies(authSession, (cookies || []).filter(cookie => isPlatformCookieDomain(platform, cookie && cookie.domain)))

  const view = createAuthView(accountId, ctx._getPreloadPath(), authSession)
  ctx.currentView = view

  ctx._positionView()
  ctx.mainWindow.contentView.addChildView(view)
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
      if (ctx._resolveLogin) {
        ctx._resolveLogin({ cancelled: true })
        ctx._resolveLogin = null
      }
      ctx.close()
    }
  }
  view.webContents.on('before-input-event', escHandler)
  ctx._escHandler = escHandler
  ctx._escView = view

  if (restorations.length > 0) {
    void Promise.all(restorations).catch(() => {})
  }

  ctx.mainWindow.webContents.send('auth:view-opened', { platform, accountId })
  ctx._fireOpened({ platform, accountId, url: loginUrl })
}

module.exports = { openSavedAccount }
