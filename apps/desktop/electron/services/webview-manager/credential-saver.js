// @ts-check
/**
 * WebviewManager 账号凭证保存模块
 * Cookie/localStorage 提取、自动保存、批量保存
 */
const log = require('../logger')
const { hasPlatformSessionCookie, isPlatformLoginSuccessUrl } = require('@multi-publish/shared-utils/src/platform-definitions')
const accountProfile = require('@multi-publish/shared-utils/src/account-profile')
const { AUTO_SAVE_DEBOUNCE_MS } = require('./constants')

module.exports = {
  /**
   * 保存当前标签页 Cookie
   * @param {string} tabId
   */
  saveCookies (tabId) {
    var self = this
    var view = self._tabViews.get(tabId)
    if (!view) return

    self._extractTabCookies(view, tabId).then(function (cookies) {
      self.emit('tab-cookies-changed', { tabId: tabId, cookies: cookies })
    }).catch(function (e) {
      log.warn('WebviewManager', 'saveCookies: extract failed for ' + tabId + ': ' + ((e && e.message) || 'unknown'))
    })
  },

  /**
   * 提取标签页所在 session 分区的全部 Cookie。
   * ⚠️ Electron 的 Session.cookies 只提供 get/set/remove/flush，**没有 getAll**；
   * 误用 getAll 会抛 "is not a function"，若被上层 catch 吞掉，症状是「保存成功
   * 但 cookies=0」（2026-09-22 账号登录态误判事故根因）。这里集中一处并显式抛错。
   * @param {object} view WebContentsView
   * @param {string} tabId 仅用于日志
   * @returns {Promise<Array>}
   */
  async _extractTabCookies (view, tabId) {
    var viewSession = view && view.webContents && view.webContents.session
    if (!viewSession || !viewSession.cookies || typeof viewSession.cookies.get !== 'function') {
      throw new Error('session-cookies-unavailable')
    }
    var list = await viewSession.cookies.get({})
    return Array.isArray(list) ? list : []
  },

  /**
   * 保存账号浏览器标签的凭证到加密凭证库（批量登录标签的手动保存入口）。
   * 提取该标签 session 分区的 Cookie + localStorage，经 AccountManager
   * updateCapturedAccount 覆盖已有账号凭证（重新登录语义，不创建新账号）。
   * @param {string} tabId
   * @returns {Promise<{ok: boolean, reason?: string, accountId?: string, platform?: string}>}
   */
  async saveAccountTabCredentials (tabId) {
    var self = this
    var view = self._tabViews.get(tabId)
    var state = self._tabStates.get(tabId)
    if (!view || !state) return { ok: false, reason: 'tab-not-found' }
    var accountId = state.accountId
    var platform = state.platform
    if (!accountId || !platform) return { ok: false, reason: 'not-account-tab' }

    // 契约：Cookie 提取失败必须 fail-closed——不落盘、保持 unsaved、不广播 saved。
    // Electron session.cookies 只有 get([filter])，不存在 getAll；此前误用 getAll 使
    // TypeError 被吞后以 cookies=[] 继续保存（假成功），失效账号扫码重登后凭证库仍是
    // 0 Cookie，再开创作者中心弹回登录页（回归 2026-09-22）。
    var cookies
    try {
      cookies = await self._extractTabCookies(view, tabId)
    } catch (e) {
      var cookieExtractError = (e && e.message) ? e.message : String(e)
      log.warn('WebviewManager', 'saveAccountTabCredentials: cookies.get failed for ' + tabId + ', aborting save: ' + cookieExtractError)
      return { ok: false, reason: 'cookie-extract-failed', detail: cookieExtractError, accountId: accountId, platform: platform }
    }
    if (!Array.isArray(cookies)) cookies = []

    var localStorageData = {}
    try {
      var extracted = await view.webContents.executeJavaScript(
        '(function(){try{var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);o[k]=localStorage.getItem(k);}return o;}catch(e){return {};}})()'
      )
      if (extracted && typeof extracted === 'object' && !Array.isArray(extracted)) {
        for (var key of Object.keys(extracted)) {
          if (typeof key === 'string' && typeof extracted[key] === 'string') localStorageData[key] = extracted[key]
        }
      }
    } catch (e) { /* localStorage 提取失败不阻断 Cookie 保存 */ }

    if (!self._accountManager || typeof self._accountManager.updateCapturedAccount !== 'function') {
      return { ok: false, reason: 'account-manager-unavailable' }
    }
    if (cookies.length === 0) {
      log.warn('WebviewManager', 'saveAccountTabCredentials: 0 cookies extracted for ' + platform + ':' + accountId + '（可能未登录或分区不匹配）')
    }
    // 契约：平台声明了会话标记时，未命中非空标记一律不入库、保持 unsaved。
    // 登录页也会写入埋点 Cookie（2026-09-25 快手假成功），"有 Cookie"不等于"已登录"。
    if (!hasPlatformSessionCookie(platform, cookies)) {
      log.warn('WebviewManager', 'saveAccountTabCredentials: session evidence missing for ' + platform + ':' + accountId + ' cookies=' + cookies.length + '，保持 unsaved')
      return { ok: false, reason: 'session-evidence-missing', accountId: accountId, platform: platform }
    }
    try {
      // 昵称/头像随重新登录一起采集（此前该入口只下发 name=标签标题，资料恒空）
      var accountInfo = await accountProfile.collectWithWebContents(view.webContents, platform)
      await self._accountManager.updateCapturedAccount(platform, {
        cookies: cookies,
        localStorage: localStorageData,
        name: state.title || '',
        accountInfo: accountInfo
      }, accountId)
      state.credentialSaveState = 'saved'
      if (state._autoSaveTimer) { clearTimeout(state._autoSaveTimer); state._autoSaveTimer = null }
      self._broadcastCredentialState(tabId, 'saved')
      log.info('WebviewManager', 'saveAccountTabCredentials: saved ' + platform + ':' + accountId + ' cookies=' + cookies.length + ' lsKeys=' + Object.keys(localStorageData).length)
      return { ok: true, accountId: accountId, platform: platform }
    } catch (e) {
      log.warn('WebviewManager', 'saveAccountTabCredentials: updateCapturedAccount failed for ' + platform + ':' + accountId + ': ' + (e && e.message ? e.message : String(e)))
      return { ok: false, reason: (e && e.message) ? e.message : 'save-failed', accountId: accountId, platform: platform }
    }
  },

  /**
   * 方案一（治本）：账号标签导航时判定登录成功并去抖自动回写凭证。
   * 仅 credentialSaveState==='unsaved' 的账号标签参与；不在初始重定向阶段且 URL 命中平台登录
   * 成功模式时安排（重新安排）一次自动保存，未命中则取消待触发计时器（用户反复横跳时只在稳定后保存）。
   * @param {string} tabId
   * @param {object} [state]
   */
  _maybeScheduleAutoSave (tabId, state) {
    var self = this
    if (!state) state = self._tabStates.get(tabId)
    if (!state) return
    if (state.credentialSaveState !== 'unsaved') return
    if (!state.accountId || !state.platform) return
    if (state.initialRedirectPhase === true) return
    if (isPlatformLoginSuccessUrl(state.platform, state.url)) {
      if (state._autoSaveTimer) { clearTimeout(state._autoSaveTimer); state._autoSaveTimer = null }
      state._autoSaveTimer = setTimeout(function () {
        state._autoSaveTimer = null
        if (!self._tabStates.has(tabId)) return
        if (self._tabStates.get(tabId).credentialSaveState !== 'unsaved') return
        log.info('WebviewManager', 'auto-save triggered ' + state.platform + ':' + state.accountId)
        Promise.resolve(self.saveAccountTabCredentials(tabId)).then(function (result) {
          // saveAccountTabCredentials 内部已置 saved 并广播保存态；这里补发 auth:completed
          // 让渲染层刷新失效账号列表（对齐手动保存 IPC 成功链路）。失败保持 unsaved，等下次导航重试。
          if (result && result.ok) {
            var win = self.mainWindow
            if (win && !win.isDestroyed()) {
              win.webContents.send('auth:completed', { platform: result.platform, accountId: result.accountId })
            }
          }
        }).catch(function (e) {
          log.warn('WebviewManager', 'auto-save threw ' + ((e && e.message) || e))
        })
      }, AUTO_SAVE_DEBOUNCE_MS)
      if (state._autoSaveTimer && state._autoSaveTimer.unref) state._autoSaveTimer.unref()
    } else {
      if (state._autoSaveTimer) { clearTimeout(state._autoSaveTimer); state._autoSaveTimer = null }
    }
  },

  /**
   * 广播某标签的凭证保存态（渲染层角标 / 护栏实时刷新）。
   * @param {string} tabId
   * @param {string|null} [credentialSaveState] 省略时取当前 state 值
   */
  _broadcastCredentialState (tabId, credentialSaveState) {
    var state = this._tabStates.get(tabId)
    var resolved = credentialSaveState == null
      ? (state ? (state.credentialSaveState || null) : null)
      : credentialSaveState
    this._broadcast('tab-credential-state-changed', {
      tabId: tabId,
      credentialSaveState: resolved,
      accountId: state ? (state.accountId || null) : null,
      platform: state ? (state.platform || null) : null
    })
  },

  /**
   * 查询账号标签凭证保存态（方案二：关闭护栏查询入口）。
   * @param {string} tabId
   * @returns {{isAccountTab: boolean, credentialSaveState: (string|null), accountId: (string|null), platform: (string|null)}}
   */
  getAccountTabSaveState (tabId) {
    var state = this._tabStates.get(tabId)
    if (!state || !state.accountId || !state.platform) {
      return { isAccountTab: false, credentialSaveState: null, accountId: null, platform: null }
    }
    return {
      isAccountTab: true,
      credentialSaveState: state.credentialSaveState || null,
      accountId: state.accountId,
      platform: state.platform
    }
  },

  /**
   * 方案三：批量保存全部待保存（unsaved）账号标签。
   * @returns {Promise<{attempted: number, saved: number, failed: Array<{accountId: string, platform: string, reason: string}>}>}
   */
  async saveAllUnsavedAccounts () {
    var self = this
    var attempted = 0
    var saved = 0
    var failed = []
    var tabIds = Array.from(self._tabStates.keys())
    for (var i = 0; i < tabIds.length; i++) {
      var state = self._tabStates.get(tabIds[i])
      if (!state || state.credentialSaveState !== 'unsaved' || !state.accountId || !state.platform) continue
      attempted += 1
      try {
        var result = await self.saveAccountTabCredentials(tabIds[i])
        if (result && result.ok) { saved += 1 } else {
          failed.push({ accountId: state.accountId, platform: state.platform, reason: (result && result.reason) || 'save-failed' })
        }
      } catch (e) {
        failed.push({ accountId: state.accountId, platform: state.platform, reason: (e && e.message) || 'save-failed' })
      }
    }
    return { attempted: attempted, saved: saved, failed: failed }
  }
}
