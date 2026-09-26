// @ts-check
/**
 * RpaViewManager -- executeJavaScript RPA engine
 *
 * P2-B: Generic publish engine with config-driven platform support.
 *
 * 架构重构（2026-07-16）：按职责拆分为 3 个 mixin，通过 Object.assign 注入 prototype。
 *   - rpa-view-helpers.js   — DOM 操作与等待工具（14 个 helper + _guessMimeType）
 *   - rpa-view-session.js   — 窗口/会话管理（_createWindow / _windowKey / cookies / localStorage）
 *   - rpa-view-platforms.js — 平台发布逻辑（_publish_* / _getPlatformConfig / _execHook / _verifyPublishSuccess）
 *
 * 主文件保留 6 个核心方法：constructor / setMainWindow / onProgress / _emitProgress / publish / cleanup
 *
 * 与 store/index.js 的 mixin 模式一致，保证 require('./rpa-view-manager') 接口不变。
 */
const log = require('./logger')
const { supportsApi, publishViaApi, apiRouter } = require('@multi-publish/api-publish-engine')
const { ProgressThrottle } = require('./rpa-progress-throttle')
const { FieldRetryState } = require('./rpa-field-retry')
const { collectAuthPartitionCookies } = require('./auth-partition')

// 桥接 api-publish-engine 的 CancelToken（参考产品复用：阶段级可恢复取消）
const { CancelToken } = require('@multi-publish/api-publish-engine/src/base-adapter')

const helpersMixin = require('./rpa-view-helpers')
const sessionMixin = require('./rpa-view-session')
const platformsMixin = require('./rpa-view-platforms')

class RpaViewManager {
  constructor() {
    this.mainWindow = null; this.windows = {}; this._nextId = 1
    this._progressCallback = null; this._responseListeners = {}
    // 每个发布会话配一个独立的 CancelToken（参考产品模式：阶段级可恢复取消）
    this._activeTokens = {}
  }
  setMainWindow(win) { this.mainWindow = win }
  onProgress(cb) { this._progressCallback = cb }

  _emitProgress(platform, stage, percent) {
    const data = { platform: platform, stage: stage, percent: percent || 0 }
    // eslint-disable-next-line no-unused-vars
    if (this._progressCallback) { try { this._progressCallback(data) } catch (e) { /* ignore */ } }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // eslint-disable-next-line no-unused-vars
      try { this.mainWindow.webContents.send('rpa:progress', data) } catch (e) { /* ignore */ } }
    log.info('RpaView', '[' + platform + '] ' + stage)
  }

  // ========== Main publish entry ==========
  async publish(platform, article, authData, timeout) {
    timeout = timeout||120000
    log.info('RpaView','publish start platform='+platform+' hasTitle='+Boolean(article&&article.title)+' hasVideo='+Boolean(article&&article.video_path)+' timeoutMs='+timeout)
    // API-first: if we have an API adapter for this platform, use it (no browser needed)
    const hasAccountProxy = Boolean(authData?.proxy)
    const apiEnabled = !hasAccountProxy && apiRouter && typeof apiRouter.shouldUseApi === 'function'
      ? apiRouter.shouldUseApi(platform)
      : false
    if (apiEnabled && supportsApi(platform)) {
      this._emitProgress(platform,'using API publish engine...',5)
      try {
        let cookie = authData?.cookies
          ? (Array.isArray(authData.cookies)
            ? authData.cookies.map(c => c.name + '=' + c.value).join('; ')
            : authData.cookies)
          : '';
        // D1 兜底（kuaishou-w3-live-fix）：凭证 store 为空时只读登录态所在的 Electron auth 分区。
        // 根因：部分平台（如快手）登录 cookie 只落在 persist:* 分区、未同步进凭证 store，
        // 空串会被 adapter fail-closed，API 链 0 步未跑（live-verdict-20260926 D1）。
        // 纪律：仅只读补串，不写凭证 store；兜底后仍为空则保持既有 fail-closed 语义。
        if (!cookie) {
          const acctId = (article && article.accountId) || (authData && authData.accountId) || null
          const fallback = await collectAuthPartitionCookies(platform, acctId)
          if (fallback.cookieString) {
            cookie = fallback.cookieString
            log.info('RpaView', 'API publish cookie fallback from auth partition ' + fallback.partition + ' (' + fallback.count + ' cookies) platform=' + platform)
          } else {
            log.warn('RpaView', 'API publish cookie fallback empty (no platform cookies in auth partition) platform=' + platform + ' accountId=' + (acctId || '(none)'))
          }
        }
        const apiResult = await Promise.race([
          publishViaApi(platform, article, cookie, {
            onProgress: (pct, msg) => this._emitProgress(platform, msg, pct)
          }),
          new Promise(function(_, rj) { const _t = setTimeout(function() { rj(new Error('API timeout (' + (timeout/1000) + 's)')) }, timeout); if (_t && _t.unref) _t.unref() })
        ]);
        // 统一结果日志：API 失败分支此前无日志（logging-coverage-audit）
        if (apiResult && apiResult.success) log.info('RpaView','publish done via API platform='+platform)
        else log.warn('RpaView','API publish returned failure platform='+platform+' error='+(apiResult&&apiResult.error))
        return apiResult;
      } catch(e) {
        log.error('RpaView', 'API publish ' + platform + ': ' + e.message);
        // Fall back to RPA if API fails
        log.warn('RpaView', 'API failed, falling back to RPA for ' + platform);
      }
    }
    // RPA path (existing)
    const key = this._windowKey(platform, article&&article.accountId)
    const partition = 'persist:rpa-'+key
    // 为本次 RPA 会话建立独立的 CancelToken
    const token = new CancelToken()
    this._activeTokens[key] = token
    this._emitProgress(platform,'starting browser...',0)
    const win = this._createWindow(partition)
    this.windows[key] = win
    let removeProxyAuthHandler = function () {}
    try {
      if (hasAccountProxy) removeProxyAuthHandler = await this._configureProxy(win, authData.proxy)
      if (authData&&authData.cookies) { await this._restoreCookies(win,authData.cookies,platform); this._emitProgress(platform,'cookies restored',2) }
      await this._restoreAuthPartitionCookies(win, platform, article&&article.accountId)
      await this._restoreBrowserStorage(win, platform, authData)
      // 每个操作前检查取消令牌
      token.throwIfCancelled()
      const mn = '_publish_'+platform
      const publishFn = typeof this[mn]==='function'
        ? this[mn](win,article)
        : this._publish_generic(win,article,platform,this._getPlatformConfig(platform))
      const result = await Promise.race([
        publishFn,
        new Promise(function(_,rj){const _t=setTimeout(function(){rj(new Error('timeout ('+(timeout/1000)+'s)'))},timeout);if(_t&&_t.unref)_t.unref()})
      ])
      if (token.isCancelled) { return { success: false, error: 'Cancelled', code: -999, platform: platform } }
      // 统一结果日志：RPA 失败分支此前完全无日志（logging-coverage-audit 根因修复）
      if (result && result.success) {
        log.info('RpaView','publish done platform='+platform+' url='+(result.url||'')+(result.draft?' draft=true':''))
      } else {
        log.warn('RpaView','publish failed platform='+platform+' error='+(result&&result.error)+' url='+(result&&result.url||''))
      }
      return result
    } catch(e) {
      if (e && e.isCanceled) { log.info('RpaView','publish '+platform+': cancelled'); return { success:false, error:'Cancelled', code:-999, platform:platform } }
      log.error('RpaView','publish '+platform+': '+e.message+(e.stack?' | stack='+String(e.stack).split('\n').slice(0,3).join(' <- '):'')); return { success:false, error:e.message, platform:platform }
    }
    // eslint-disable-next-line no-unused-vars
    finally {
      try { removeProxyAuthHandler() } catch (e) { /* ignore */ }; try { win.destroy() } catch (e) { /* ignore */ }
      delete this.windows[key]; delete this._activeTokens[key]
    }
  }

  cancel(platform, accountId) {
    const key = this._windowKey(platform, accountId)
    const win = this.windows[key]
    // 优先用 CancelToken 信号取消（让 publish() 的 throwIfCancelled / isCancelled 生效）
    const token = this._activeTokens && this._activeTokens[key]
    if (token) { token.cancel(); return true }
    if (!win) return false
    try { win.destroy() } catch (e) { /* ignore */ }
    delete this.windows[key]
    delete this._activeTokens[key]
    return true
  }

  cleanup() {
    const ks = Object.keys(this.windows)
    // eslint-disable-next-line no-unused-vars
    for (let ki=0;ki<ks.length;ki++) { try { this.windows[ks[ki]].destroy() } catch (e) { /* ignore */ } }
    this.windows = {}; this._activeTokens = {}
    log.info('RpaView','cleaned up')
  }
}

// 把 3 个 mixin 方法注入 RpaViewManager.prototype
Object.assign(RpaViewManager.prototype, helpersMixin, sessionMixin, platformsMixin)

module.exports = RpaViewManager
module.exports.ProgressThrottle = ProgressThrottle
module.exports.FieldRetryState = FieldRetryState
