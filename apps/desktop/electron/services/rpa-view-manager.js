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
const { buildApiTaskData } = require('./api-task-data')
const { bindSignerCookie } = require('../signer/provider')

// 桥接 api-publish-engine 的 CancelToken（参考产品复用：阶段级可恢复取消）
const { CancelToken } = require('@multi-publish/api-publish-engine/src/base-adapter')

const helpersMixin = require('./rpa-view-helpers')
const sessionMixin = require('./rpa-view-session')
const platformsMixin = require('./rpa-view-platforms')
// 海外平台（YouTube/TikTok/X/IG/FB）专属发布链放独立目录：
// rpa-view-platforms.js 在本仓「点名还账」清单内（零增长容差），往里加行会顶穿熔断门禁。
const overseasMixin = require('./rpa-overseas')

class RpaViewManager {
  // C 方案：池参数解析静态暴露（测试断言默认值/覆盖行为）
  static resolvePoolSize = sessionMixin.resolvePoolSize
  static resolvePoolTtlMs = sessionMixin.resolvePoolTtlMs

  constructor() {
    this.mainWindow = null; this.windows = {}; this._nextId = 1
    this._progressCallback = null; this._responseListeners = {}
    // 每个发布会话配一个独立的 CancelToken（参考产品模式：阶段级可恢复取消）
    this._activeTokens = {}
    // C 方案（publish-throughput-optimization）：窗口池（session mixin 提供 acquire/release/drain）
    this._pool = null
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
    // C 方案：publishHealthy 是 RPA 轨归池判据（API 轨无窗口不涉及）；在 try 外声明供 finally 读。
    // 不带初始化值——所有执行路径（try 内赋值/catch 赋值）都会在 finally 读取前先赋值。
    let publishHealthy
    log.info('RpaView','publish start platform='+platform+' hasTitle='+Boolean(article&&article.title)+' hasVideo='+Boolean(article&&article.video_path)+' timeoutMs='+timeout)
    // API-first: if we have an API adapter for this platform, use it (no browser needed)
    const hasAccountProxy = Boolean(authData?.proxy)
    // 闸门须读**三态总闸** publishMode（§5.1），而不是只读 has_api 派生的
    // shouldUseApi。两者不一致的平台实测存在：youtube / twitter / facebook 配了
    // publishMode=dom-only 却 has_api=true，此前本路径仍会进 API 轨——配置写的
    // 「只用 DOM」被完全绕过。getMode 不可用时退回 shouldUseApi（老行为）。
    // ★ CCG 第八轮 i2（upheld）复审：必须传 { safe: true }。
    //   默认（不带 safe）对非法 publishMode 是 **fail-closed 抛错**的，会让整条发布中止；
    //   而同一份坏配置下 shouldUseApi 走的是 fail-safe（告警 + false ⇒ DOM 轨）——
    //   不传 safe 就是「同一份配置两个读者结论相反」，正是本 PR 要消灭的判据分叉。
    //   传 safe 后坏配置 ⇒ 告警 + 'dom-only'，与 shouldUseApi 的 false 同结论。
    const mode = !hasAccountProxy && apiRouter && typeof apiRouter.getPublishMode === 'function'
      ? apiRouter.getPublishMode(platform, { safe: true })
      : null
    const apiEnabled = !hasAccountProxy && apiRouter && typeof apiRouter.shouldUseApi === 'function'
      ? (mode != null ? mode !== 'dom-only' : apiRouter.shouldUseApi(platform))
      : false
    if (mode != null && mode === 'dom-only' && apiRouter.shouldUseApi(platform)) {
      log.warn('RpaView', 'publish-mode-overrides-has-api', {
        platform,
        publishMode: mode,
        note: 'publishMode=dom-only 但 has_api=true，按 publishMode 走 DOM 轨',
      })
    }
    if (apiEnabled && supportsApi(platform)) {
      // 每次进入 API 轨前清掉上一次的诊断残留（避免跨任务/跨平台污染）
      this._lastApiFailure = null
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
        //
        // D2 补充兜底（video-publish-4，2026-10-18）：**签名材料不齐时也补一轮**。
        // 真机日志：抖音 API 轨 Step 0 fail-closed「账号信息缺失」，而 store 里其实有 19 条
        // cookie（非空）⇒ 旧判据 `if (!cookie)` 不会触发兜底。缺的是安全 SDK 在**页面 JS 运行时**
        // 才写进分区的 `__security_mc_<N>_s_sdk_sign_data_key_web_protect` /
        // `s_sdk_crypt_sdk` 两条——它们是登录快照**之后**才出现的，store 里永远没有。
        // 因此判据从「cookie 为空」升级为「cookie 为空**或**签名材料不齐」；
        // 命中后把分区 cookie **合并**进 store cookie（分区值优先，store 值兜底），
        // 而不是整体替换——避免为了补两条 SDK cookie 丢掉 store 里更全的其余字段。
        let cookieFromPartition = null
        // i6（CCG 自扮演裁决，crypto 域）：判据模块加载失败时**不得静默返回 false** ——
        // 那会把「依赖失效」伪装成「材料已齐」，与 D2 要修的「静默」同型。
        // 改为：出声告警 + 仍返回 false（保持不盲目兜底），但运维能看到通道已断。
        const needsMaterialFallback = () => {
          if (!cookie) return true
          if (platform !== 'douyin') return false
          try {
            const { hasSecurityMaterials } = require('@multi-publish/api-publish-engine/src/signer/douyin-ticket-guard')
            return !hasSecurityMaterials(cookie)
          } catch (e) {
            log.warn('RpaView', 'douyin 签名材料判据不可用（模块加载失败），本次不做材料兜底: '
              + String((e && e.message) || e).slice(0, 160))
            return false
          }
        }
        if (needsMaterialFallback()) {
          const acctId = (article && article.accountId) || (authData && authData.accountId) || null
          const fallback = await collectAuthPartitionCookies(platform, acctId)
          if (fallback.cookieString) {
            if (cookie) {
              // 合并：分区优先（更新），store 兜底（更全）
              // i3（CCG 自扮演裁决）：cookie 值**可以含 '='**（base64 padding、JWT），
              // 因此必须用 indexOf('=') 取**第一个** '=' 作分隔（旧写法 split('=')[1] 会截断值）。
              // 另：'name=value' 段内的 ';' 只可能是段分隔符（RFC 6265 禁止 cookie 值含 ';'），
              // 故 split(';') 是安全的；真正危险的是 split('=')，已由 indexOf 修掉。
              const merged = new Map()
              const absorb = (str) => {
                for (const seg of String(str).split(';')) {
                  const i = seg.indexOf('=')
                  if (i > 0) merged.set(seg.slice(0, i).trim(), seg.slice(i + 1).trim())
                }
              }
              absorb(cookie)
              absorb(fallback.cookieString)
              cookieFromPartition = Array.from(merged.entries()).map(([k, v]) => k + '=' + v).join('; ')
              log.info('RpaView', 'API publish cookie material-fallback merged from auth partition ' + fallback.partition
                + ' (partition=' + fallback.count + ' cookies, store+partition merged) platform=' + platform)
            } else {
              cookieFromPartition = fallback.cookieString
              log.info('RpaView', 'API publish cookie fallback from auth partition ' + fallback.partition + ' (' + fallback.count + ' cookies) platform=' + platform)
            }
            if (cookieFromPartition) cookie = cookieFromPartition
          } else {
            log.warn('RpaView', 'API publish cookie fallback empty: reason=' + fallback.reason + ' probed='
              + ((fallback.probed || []).length) + ' platform=' + platform + ' accountId=' + (acctId || '(none)'))
          }
        }
        // 形状翻译（2026-09-28 活体残余①修复）：适配器契约要求 taskData.video.path
        // （嵌套）而 article 是扁平 video_path——裸 article 直传会让 kuaishou/bilibili
        // 等视频平台 API 轨全部 fail-closed（taskData.video.path required）。
        // 与 publisher-router 共用单一翻译实现（api-task-data.js）。
        const taskData = buildApiTaskData(article)
        // 签名页多账号隔离（2026-09-28 活体 6.3 第六层）：sessionKey=accountId 必须
        // 随 opts 下传（链 payload.accountId → 装配 ctx.sessionKey，缺则 fail-closed
        // 「missing sessionKey」）；且求签前 bindSignerCookie 预绑账号 cookie
        // （in-proc，cookie 明文不经 renderer IPC 往返——provider.js 契约）。
        const signerAccountId = (article && article.accountId) || (authData && authData.accountId) || null
        if (signerAccountId && cookie) {
          try {
            bindSignerCookie(platform, signerAccountId, cookie)
          } catch (e) {
            log.warn('RpaView', 'signer cookie bind failed platform=' + platform + ' accountId=' + signerAccountId + ' err=' + e.message)
          }
        }
        const apiResult = await Promise.race([
          publishViaApi(platform, taskData, cookie, {
            onProgress: (pct, msg) => this._emitProgress(platform, msg, pct),
            accountId: signerAccountId || undefined,
          }),
          new Promise(function(_, rj) { const _t = setTimeout(function() { rj(new Error('API timeout (' + (timeout/1000) + 's)')) }, timeout); if (_t && _t.unref) _t.unref() })
        ]);
        // 统一结果日志：API 失败分支此前无日志（logging-coverage-audit）
        if (apiResult && apiResult.success) log.info('RpaView','publish done via API platform='+platform)
        else log.warn('RpaView','API publish returned failure platform='+platform+' error='+(apiResult&&apiResult.error))
        return apiResult;
      } catch(e) {
        log.error('RpaView', 'API publish ' + platform + ': ' + e.message);
        // 三态总闸（§5.1）：api-only 的契约是「任何非成功结果都停报，不降级」。
        // 此前此处**无条件**降级 DOM，与契约相反——更糟的是降级时后台仍挂着
        // 一次 API 发布（Promise.race 超时后并未取消），可能重复发稿。
        // api-then-dom 保留原降级行为；dom-only 根本进不到这里。
        if (mode === 'api-only') {
          log.error('RpaView', 'API publish failed under api-only, NOT falling back to RPA for ' + platform);
          return { success: false, error: e.message, code: e.code, platform: platform, stoppedBy: 'api-only' };
        }
        log.warn('RpaView', 'API failed, falling back to RPA for ' + platform);
        // 2026-10-21（douyin-e2e-timeout-debug）：把 API 轨失败原因**写进 result**，
        // 让它随 DOM 轨终态一起进发布历史。此前只有 log.warn，历史里查不到
        // 「是否走过 API 轨、其失败原因」，抖音 E2E 的 publish timeout 只能靠日志反推。
        // 兜底记录：若 DOM 轨最终也失败，这个字段就是唯一定位依据。
        this._lastApiFailure = { platform: platform, error: String(e && e.message || e), code: e && e.code, at: Date.now() };
      }
    }
    // RPA path (existing)
    // C 方案（publish-throughput-optimization）：窗口池化——池键按逻辑会话（平台+账号），
    // 池命中复用（保留持久 partition 登录态，跳过三段恢复）；未命中新建并做全量恢复。
    const { win, reused } = this._acquireWindow(platform, article && article.accountId)
    // 活动会话键保留自增 id（同一账号并发发布时各会话独立命名）
    const key = this._windowKey(platform, article&&article.accountId)
    // 为本次 RPA 会话建立独立的 CancelToken
    const token = new CancelToken()
    this._activeTokens[key] = token
    this._emitProgress(platform, reused ? 'reusing browser session...' : 'starting browser...',0)
    this.windows[key] = win
    let removeProxyAuthHandler = function () {}
    try {
      if (hasAccountProxy) removeProxyAuthHandler = await this._configureProxy(win, authData.proxy)
      // 登录态恢复只在新建窗口时执行：池内复用窗口的 cookie/localStorage 已在 partition 层，
      // 重复恢复是纯浪费（C 方案收益来源之一）。
      if (!reused) {
        if (authData&&authData.cookies) { await this._restoreCookies(win,authData.cookies,platform); this._emitProgress(platform,'cookies restored',2) }
        await this._restoreAuthPartitionCookies(win, platform, article&&article.accountId)
        await this._restoreBrowserStorage(win, platform, authData)
      }
      // 每个操作前检查取消令牌
      token.throwIfCancelled()
      const mn = '_publish_'+platform
      const publishFn = typeof this[mn]==='function'
        ? this[mn](win,article)
        : this._publish_generic(win,article,platform,this._getPlatformConfig(platform,article))
      const result = await Promise.race([
        publishFn,
        new Promise(function(_,rj){const _t=setTimeout(function(){rj(new Error('timeout ('+(timeout/1000)+'s)'))},timeout);if(_t&&_t.unref)_t.unref()})
      ])
      if (token.isCancelled) { publishHealthy = false; return { success: false, error: 'Cancelled', code: -999, platform: platform } }
      publishHealthy = Boolean(result && result.success)
      // 统一结果日志：RPA 失败分支此前完全无日志（logging-coverage-audit 根因修复）
      if (result && result.success) {
        log.info('RpaView','publish done platform='+platform+' url='+(result.url||'')+(result.draft?' draft=true':''))
      } else {
        log.warn('RpaView','publish failed platform='+platform+' error='+(result&&result.error)+' url='+(result&&result.url||''))
      }
      // 2026-10-21（douyin-e2e-timeout-debug）：把本次 API 轨失败诊断并入返回，
      // 让 DOM 轨终态带上"之前走过 API 轨且失败"这一事实（历史据此可定位）。
      // 同时补 `track`（实际使用的轨）与 `apiTrackAttempted`（是否走过 API 轨）——
      // 这是 PRD §16.19.4 埋点清单的 ①「分轨切换原因」：没有这两个字段，
      // 历史无法回答"这次到底用了哪条轨"，只能看到终态 error。
      const out = (result && typeof result === 'object') ? { ...result } : { success: !!result, platform: platform }
      if (apiEnabled) out.apiTrackAttempted = true
      out.track = apiEnabled ? 'api-then-dom' : 'dom'
      if (this._lastApiFailure && this._lastApiFailure.platform === platform) {
        out.apiTrackFailed = this._lastApiFailure
      }
      return out
    } catch(e) {
      publishHealthy = false
      if (e && e.isCanceled) { log.info('RpaView','publish '+platform+': cancelled'); return { success:false, error:'Cancelled', code:-999, platform:platform } }
      log.error('RpaView','publish '+platform+': '+e.message+(e.stack?' | stack='+String(e.stack).split('\n').slice(0,3).join(' <- '):''))
      const out = { success:false, error:e.message, platform:platform }
      if (apiEnabled) out.apiTrackAttempted = true
      out.track = apiEnabled ? 'api-then-dom' : 'dom'
      if (this._lastApiFailure && this._lastApiFailure.platform === platform) out.apiTrackFailed = this._lastApiFailure
      return out
    }
    // eslint-disable-next-line no-unused-vars
    finally {
      try { removeProxyAuthHandler() } catch (e) { /* ignore */ }
      // C 方案：成功归池（导航 about:blank 后复用），失败/取消立即销毁（状态污染兜底）。
      delete this.windows[key]; delete this._activeTokens[key]
      try { await this._releaseWindow(platform, article && article.accountId, win, publishHealthy) } catch (_e) { try { if (!win.isDestroyed()) win.destroy() } catch (_) { /* ignore */ } }
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
    // C 方案：cleanup 同步清空窗口池（应用退出路径）
    try { this._drainWindowPool() } catch (e) { /* ignore */ }
    log.info('RpaView','cleaned up')
  }
}

// 把 4 个 mixin 方法注入 RpaViewManager.prototype
// ⚠️ overseasMixin 必须排在 platformsMixin **之后**：同名方法（如 _publish_youtube）由海外实现覆盖。
Object.assign(RpaViewManager.prototype, helpersMixin, sessionMixin, platformsMixin, overseasMixin)

module.exports = RpaViewManager
module.exports.ProgressThrottle = ProgressThrottle
module.exports.FieldRetryState = FieldRetryState
