// @ts-check
/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{
 *   authViewManager: import('../services/auth-view-manager'),
 *   pythonBridge: import('../services/python-bridge'),
 *   AccountManager: any,
 *   store?: { getSetting?: (key: string) => unknown },
 *   identityService?: { getState: () => unknown },
 *   log: { info: Function, warn: Function, error: Function },
 *   BrowserWindow: typeof import('electron').BrowserWindow
 * }} deps
 */
function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { toPublicProxyConfig } = require('../services/proxy-config')
  const { PLATFORM_LOGIN_URLS } = require('@multi-publish/shared-utils/src/platform-definitions')
  const { loginStatusTransition } = require('@multi-publish/shared-utils/src/login-state')
  const { authViewManager, pythonBridge, AccountManager, log, BrowserWindow, store, identityService } = deps

  function getOwnerSubject () {
    if (!identityService) return undefined
    try {
      const state = identityService.getState()
      if (state && typeof state === 'object' && state.user && typeof state.user.sub === 'string' && state.user.sub.trim()) {
        return state.user.sub.trim()
      }
    } catch (_) { /* fail closed below */ }
    return null
  }

  // 统一 IPC 日志：账号管理路径（模块 AccountIPC），含平台/账号/耗时，敏感字段经 toPublicErrorValue 脱敏
  function ipcLog(level, channel, stage, detail) {
    if (log && typeof log[level] === 'function') {
      log[level]('AccountIPC', `${channel} ${stage}${detail ? ' :: ' + detail : ''}`)
    }
  }

  function safeAccountSummary(account) {
    if (!account || typeof account !== 'object') return 'account=<缺失>'
    const parts = []
    if (typeof account.id === 'string' && account.id) parts.push(`id=${account.id}`)
    if (typeof account.accountId === 'string' && account.accountId) parts.push(`accountId=${account.accountId}`)
    if (typeof account.platform === 'string' && account.platform) parts.push(`platform=${account.platform}`)
    if (typeof account.name === 'string' && account.name) parts.push(`name="${account.name.slice(0, 30)}"`)
    if (!parts.length) parts.push('无关键字段')
    return parts.join(' | ')
  }

  // R51 P1 修复：URL 路径段白名单校验，防止路径注入
  // 仅允许字母/数字/下划线/短横线，拒绝 / ? # .. 等路径操纵字符
  function _isSafePathSegment(s) {
    if (!s || typeof s !== 'string') return false
    return /^[a-zA-Z0-9_-]+$/.test(s)
  }

  const LOGIN_STATUSES = ['active', 'expired', 'unverified']

  /**
   * 检测结论 → 应写入真源的登录态；返回 null = 本轮无新证据，不改写。
   * 判定唯一来源是 @multi-publish/shared-utils/src/login-state —— 本层与监控层曾各自
   * 持一份映射、都把无定论算成 unverified，才是 active ↔ unverified 振荡的源头。
   */
  function loginStatusFromCheck (status, checkError, account, nowMs) {
    const next = loginStatusTransition({
      result: status,
      checkError,
      currentStatus: account && account.status,
      lastValidated: account && account.last_validated,
      nowMs,
    })
    // 规则函数只允许返回三态或 null；出现意外值时按「无结论」处理，绝不臆断为已登录
    return next === null || LOGIN_STATUSES.indexOf(next) >= 0 ? next : 'unverified'
  }

  /** 读真源现状，只为「无定论要不要保持」这一判定服务；失败返回 null，按未定论处理。 */
  async function readAccountSnapshot (accountId) {
    try {
      const res = await pythonBridge.requestBackend('GET', '/api/accounts/' + accountId)
      if (res && res.code === 0 && res.data && typeof res.data === 'object') return res.data
    } catch (e) {
      ipcLog('warn', 'account:persist-outcome', 'snapshot-failed', `accountId=${accountId} message=${e instanceof Error ? e.message : String(e)}`)
    }
    return null
  }

  /** 把一次检测结论落进真源，并如实回报本轮到底改没改。 */
  async function persistCheckOutcome (platform, accountId, status, checkError, account, checkedAt) {
    let snapshot = account
    const definitive = !checkError && status && (status.valid === true || status.valid === false)
    if (!definitive && !snapshot) snapshot = await readAccountSnapshot(accountId)
    const next = loginStatusFromCheck(status, checkError, snapshot, Date.parse(checkedAt))
    if (next === null) {
      const keptStatus = (snapshot && snapshot.status) || 'unverified'
      ipcLog('info', 'account:persist-outcome', 'kept', `platform=${platform} accountId=${accountId} reason=${checkError ? 'check-error' : (status && status.code) || 'inconclusive'} keptStatus=${keptStatus}`)
      return { ok: true, status: null, changed: false, keptStatus }
    }
    const persisted = await persistLoginStatus(platform, accountId, next, checkedAt)
    return { ...persisted, changed: true, status: next, keptStatus: next }
  }

  /**
   * 登录态唯一写者：检测结果一律由主进程回写后端 accounts.json（status + last_validated）。
   * 渲染层禁止再自行 accountUpdate(status)，否则会出现「双写 + 写错库」的口径分裂。
   * 失败必须可见（返回 reason 并落日志），不得 .catch(() => {}) 静默吞掉。
   */
  async function persistLoginStatus (platform, accountId, status, validatedAt) {
    if (LOGIN_STATUSES.indexOf(status) < 0) {
      ipcLog('warn', 'account:persist-login-status', 'skipped', `platform=${platform} accountId=${accountId} illegal-status=${status}`)
      return { ok: false, status, reason: 'invalid-status' }
    }
    if (typeof AccountManager.persistLoginState !== 'function') {
      ipcLog('warn', 'account:persist-login-status', 'unavailable', `platform=${platform} accountId=${accountId}`)
      return { ok: false, status, reason: 'persistLoginState-unavailable' }
    }
    try {
      const res = await AccountManager.persistLoginState(accountId, platform, status, validatedAt)
      const ok = Boolean(res && res.ok)
      if (!ok) {
        ipcLog('warn', 'account:persist-login-status', 'failed', `platform=${platform} accountId=${accountId} status=${status} reason=${(res && res.reason) || 'unknown'} code=${(res && res.code) || '-'}`)
      }
      return { ok, status, ...(!ok && res && res.reason ? { reason: res.reason } : {}) }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      ipcLog('warn', 'account:persist-login-status', 'threw', `platform=${platform} accountId=${accountId} status=${status} message=${message}`)
      return { ok: false, status, reason: 'persist-threw', message }
    }
  }

  // ── 一键检测的并发与超时预算（进度卡顿修复 2026-09-22）──
  // checkLoginStatus 走浏览器降级检测时要开独立隐藏窗口并等待选择器，
  // 串行执行下单个慢账号即可让进度静止数十秒（用户看到「检测中 0/7」不动）。
  // 改为有限并发 + 单账号硬超时；超时按失效计入（与检测失败同口径），
  // 避免一个挂死的账号拖住整批检测。
  // 环境变量为运维调优旋钮：MP_BATCH_CHECK_CONCURRENCY（1..4）、
  // MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS（毫秒，非正数视为使用默认值）。
  const BATCH_CHECK_DEFAULT_CONCURRENCY = 3
  const BATCH_CHECK_MAX_CONCURRENCY = 4
  const BATCH_CHECK_DEFAULT_TIMEOUT_MS = 60000

  function resolveBatchCheckConcurrency() {
    const raw = Number(process.env.MP_BATCH_CHECK_CONCURRENCY)
    if (!Number.isFinite(raw) || raw < 1) return BATCH_CHECK_DEFAULT_CONCURRENCY
    return Math.min(BATCH_CHECK_MAX_CONCURRENCY, Math.floor(raw))
  }

  function resolveBatchCheckTimeoutMs() {
    const raw = Number(process.env.MP_BATCH_CHECK_ACCOUNT_TIMEOUT_MS)
    if (!Number.isFinite(raw) || raw <= 0) return BATCH_CHECK_DEFAULT_TIMEOUT_MS
    return Math.floor(raw)
  }

  // 固定数量 worker 抢任务：单线程下 cursor 自增无竞态，峰值并发不超过 limit。
  async function runWithConcurrency(items, limit, worker) {
    let cursor = 0
    const width = Math.max(1, Math.min(limit, items.length))
    const runners = Array.from({ length: width }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        await worker(items[index], index)
      }
    })
    await Promise.all(runners)
  }

  // 注意：Promise.race 会订阅原 promise，超时后原检测迟到的 reject 不会成为
  // unhandledRejection（挂死的隐藏窗口由其自身清理逻辑关闭，不阻断本批结果）。
  function withHardTimeout(promise, ms, label) {
    let timer = null
    const guard = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const err = new Error(label)
        err.__batchCheckTimeout = true
        reject(err)
      }, ms)
    })
    return Promise.race([Promise.resolve(promise), guard]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  const publicAccountFields = [
    'id', 'platform', 'name', 'account_name', 'platform_account_id', 'avatar', 'avatar_url',
    'status', 'status_source', 'is_active', 'is_default', 'has_cookies', 'cookie_count',
    'has_auth_data', 'last_validated', 'created_at', 'updated_at', 'last_used_at', 'auth_method',
    'followers', 'owner', 'publisher', 'last_login_check_at', 'login_check_error', 'status_reason',
  ]

  const publicAccountAliases = {
    followers: ['followers', 'follower_count', 'followers_count', 'fans', 'fans_count', 'fansCount', '粉丝数'],
    owner: ['owner', 'owner_name', 'ownerName', 'account_owner', 'accountOwner', '负责人'],
    publisher: ['publisher', 'publisher_name', 'publisherName', 'publishers', 'publisher_list', 'operator', 'operator_name', 'operatorName', '运营人', '发布人'],
    last_login_check_at: ['last_login_check_at', 'lastLoginCheckAt', 'login_checked_at', 'loginCheckedAt', 'last_checked_at', 'lastCheckedAt', 'checked_at', 'checkedAt'],
    login_check_error: ['login_check_error', 'loginCheckError', 'last_login_error', 'lastLoginError'],
    status_reason: ['status_reason', 'statusReason'],
    last_used_at: ['last_used_at', 'lastUsedAt', 'last_used', 'lastUsed'],
  }
  const publicErrorFields = new Set(['login_check_error', 'status_reason'])

  function toPublicMetadataValue(value) {
    if (value === null || value === undefined) return undefined
    if (Array.isArray(value)) {
      const items = value.map(toPublicMetadataValue).filter(item => item !== undefined)
      return items.length ? items : undefined
    }
    if (typeof value === 'string') return value.trim() || undefined
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (typeof value === 'boolean') return value
    if (!value || typeof value !== 'object') return undefined
    for (const key of ['name', 'label', 'nickname', 'value', 'count', 'text']) {
      const nested = toPublicMetadataValue(value[key])
      if (nested !== undefined) return nested
    }
    return undefined
  }

  function toPublicErrorValue(value) {
    const normalized = toPublicMetadataValue(value)
    if (Array.isArray(normalized)) return normalized.map(item => toPublicErrorValue(item))
    if (typeof normalized !== 'string') return normalized
    return normalized
      .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|access[_-]?key|app[_-]?secret|session(?:[_-]?id)?|pwd|passwd|token|cookie|password|secret|authorization|令牌|密钥|密码)\s*[:=：]\s*)(?:Bearer\s+)?[^\s,;]+(?:,[^\s,;]+)*/gi, '$1***')
      .replace(/\bBearer\s+[A-Za-z0-9._~-]+(?:,[A-Za-z0-9._~-]+)*/gi, 'Bearer ***')
      .slice(0, 240)
  }

  function normalizePortValue(port) {
    if (typeof port === 'number') {
      const value = Number.isInteger(port) ? port : undefined
      return value !== undefined && value >= 1 && value <= 65535 ? value : undefined
    }
    if (typeof port === 'string' && /^\d+$/.test(port)) {
      const value = Number(port)
      return value >= 1 && value <= 65535 ? value : undefined
    }
    return undefined
  }

  function copyPublicMetadataAliases(source) {
    const normalized = { ...source }
    for (const [canonicalKey, aliases] of Object.entries(publicAccountAliases)) {
      for (const alias of aliases) {
        const value = publicErrorFields.has(canonicalKey)
          ? toPublicErrorValue(source[alias])
          : toPublicMetadataValue(source[alias])
        if (value !== undefined) {
          normalized[canonicalKey] = value
          break
        }
      }
    }
    return normalized
  }

  function toPublicAccount(account) {
    const raw = account && typeof account === 'object' ? account : {}
    // 统一映射后再经过字段白名单，避免把原始响应透传给渲染层。
    const source = copyPublicMetadataAliases({
      ...raw,
      id: raw.id ?? raw.account_id,
    })
    const safeAccount = {}
    for (const key of publicAccountFields) {
      if (source[key] !== undefined) safeAccount[key] = source[key]
    }
    const defaultAccountKey = `default_account:${safeAccount.platform}`
    // 已接入身份服务的 Store 必须只读取当前用户命名空间，不能回退到 legacy 全局值。
    const defaultId = store && typeof store.getUserSetting === 'function'
      ? store.getUserSetting(defaultAccountKey)
      : store && typeof store.getSetting === 'function'
        ? store.getSetting(defaultAccountKey)
        : null
    // 实际检测本地加密凭证是否存在，避免仅凭 is_active 误报"已登录"。
    // checkLocalCredentials 依赖主进程装配的 ownerSubjectProvider；缺方法或抛错时
    // fail-closed 为 has_cookies=false，不阻断账号列表。
    let hasCred = false
    let credCheckReason = ''
    if (safeAccount.platform && safeAccount.id && typeof AccountManager.checkLocalCredentials === 'function') {
      try {
        hasCred = Boolean(AccountManager.checkLocalCredentials(safeAccount.platform, safeAccount.id))
        if (!hasCred) credCheckReason = 'no-credential-file-or-load-failed'
      } catch (_) { hasCred = false; credCheckReason = 'checkLocalCredentials-threw' }
    } else {
      credCheckReason = AccountManager.checkLocalCredentials ? 'missing-platform-or-id' : 'checkLocalCredentials-not-function'
    }
    // 登录态判定口径（与 PRD「登录态三态模型」一致，真源 = 后端 accounts.json.status）：
    //   1) 本地无加密凭证 → expired：既无法自动恢复、也无法证明仍登录，不允许沿用后端 active；
    //   2) 后端 status ∈ {active, expired, unverified} → 原样采用（粘滞）：
    //      「expired」只能被一次成功的主动检测、或重新登录并保存凭证清除，
    //      不再按 last_validated 的 2 小时窗口过期、也不再被「本地存在凭证文件」推翻
    //      （凭证文件存在 ≠ Cookie 有效，这正是视频号假阳性的来源）；
    //   3) 后端无 status（历史数据缺字段）→ 兜底 unverified，绝不由 is_active 派生登录态。
    const backendStatus = LOGIN_STATUSES.indexOf(safeAccount.status) >= 0 ? safeAccount.status : 'absent'
    let effectiveStatus
    let statusSource
    if (!hasCred) {
      effectiveStatus = 'expired'
      statusSource = 'no-local-credential'
    } else if (backendStatus !== 'absent') {
      effectiveStatus = backendStatus
      statusSource = 'backend'
    } else {
      // 启用态与登录态正交：is_active 只回答「能不能用于发布」，不能证明登录与否。
      // 历史上这里把 is_active 派生成 active/inactive，既让「停用」被误显示成「未登录」，
      // 又让后端的脏 status 被 is_active 掩盖，因此缺 status 一律降级为诚实的未知态。
      effectiveStatus = 'unverified'
      statusSource = 'absent-fallback'
    }
    ipcLog('info', 'account:status-derive',
      'id=' + safeAccount.id + ' platform=' + safeAccount.platform + ' name=' + (safeAccount.account_name || safeAccount.name || '?') + ' hasCred=' + hasCred + ' backendStatus=' + backendStatus +
      ' effectiveStatus=' + effectiveStatus + ' statusSource=' + statusSource +
      (credCheckReason ? ' reason=' + credCheckReason : ''))

    const publicAccount = {
      ...safeAccount,
      has_cookies: hasCred,
      cookie_count: hasCred ? 1 : 0,
      account_name: safeAccount.account_name || safeAccount.name || '',
      status: effectiveStatus,
      status_source: statusSource,
      is_default: Boolean(safeAccount.is_default) || String(defaultId) === String(safeAccount.id),
    }
    if (raw.proxy !== undefined) {
      if (raw.proxy && typeof raw.proxy === 'object' && typeof raw.proxy.configured === 'boolean') {
        publicAccount.proxy = {
          configured: raw.proxy.configured,
          ...(typeof raw.proxy.type === 'string' ? { type: raw.proxy.type } : {}),
          ...(typeof raw.proxy.hostMasked === 'string' ? { hostMasked: raw.proxy.hostMasked } : {}),
          ...(() => { const port = normalizePortValue(raw.proxy.port); return port !== undefined ? { port } : {} })(),
          ...(raw.proxy.hasAuthentication === true ? { hasAuthentication: true } : {}),
          ...(raw.proxy.invalid === true ? { invalid: true } : {}),
        }
      } else {
        try { publicAccount.proxy = toPublicProxyConfig(raw.proxy) }
        catch (_) { publicAccount.proxy = { configured: true, invalid: true } }
      }
    }
    return publicAccount
  }

  // 后端稳定错误码 + HTTP 状态透传给渲染层：瞬时失败（5xx / AUTH_JWKS_*）才能与「无数据」区分
  const ipcFailureDetail = (e) => ({
    ...(e && typeof e.errorCode === 'string' && e.errorCode ? { errorCode: e.errorCode } : {}),
    ...(e && typeof e.status === 'number' ? { status: e.status } : {}),
  })

  ipcMain.handle('accounts:list', withSenderCheck(async () => {
    const startedAt = Date.now()
    ipcLog('info', 'accounts:list', 'enter', `owner=${getOwnerSubject() ?? '<未登录>'}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'accounts:list', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: [] }
      }
      // 通过 AccountManager.listAccounts() 获取账号列表（内含孤儿凭据清理）
      const accounts = await AccountManager.listAccounts()
      const data = Array.isArray(accounts) ? accounts.map(toPublicAccount) : []
      const expiredCount = data.filter(a => a.status === 'expired').length
      const activeCount = data.filter(a => a.status === 'active' || a.status === 'online').length
      ipcLog('info', 'accounts:list', 'ok', `count=${data.length} active=${activeCount} expired=${expiredCount} platforms=[${data.map((a) => a.platform).filter((v, i, arr) => arr.indexOf(v) === i).join(',')}] 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data }
    } catch (e) {
      ipcLog('error', 'accounts:list', 'error', `message=${e instanceof Error ? e.message : String(e)} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e), data: [], ...ipcFailureDetail(e) }
    }
  }))

  ipcMain.handle('auth:open-login', withSenderCheck(async (event, arg) => {
    // 兼容旧调用：仅传 platform 字符串；新调用：{platform, accountId?}
    const raw = (arg && typeof arg === 'object' && !Array.isArray(arg) && !(typeof arg === 'string' && arg)) ? arg : { platform: arg }
    const platform = raw.platform
    const accountId = raw.accountId
    const startedAt = Date.now()
    ipcLog('info', 'auth:open-login', 'enter', `platform=${platform} accountId=${accountId || '<none>'}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'auth:open-login', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      // R51 P1：platform 用于 URL 拼接，必须校验
      if (!_isSafePathSegment(platform)) {
        ipcLog('warn', 'auth:open-login', 'validation-failed', `platform=${platform}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 platform 参数' }
      }
      // accountId 为可选参数，仅重新登录时传递；若提供则必须校验
      if (accountId !== undefined && accountId !== null && !_isSafePathSegment(accountId)) {
        ipcLog('warn', 'auth:open-login', 'validation-failed', `accountId=${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 accountId 参数' }
      }
      const result = await authViewManager.openLogin(platform)
      // 用户关闭登录页签/Esc 取消：控制信号而非凭证数据，不得进入保存流程，也不得弹错误
      if (result && typeof result === 'object' && result.cancelled === true) {
        ipcLog('info', 'auth:open-login', 'cancelled', `platform=${platform} 耗时=${Date.now() - startedAt}ms`)
        return { code: 0, cancelled: true, data: { cancelled: true }, message: '登录已取消' }
      }
      // 登录等待超时：返回明确超时错误，不保存凭证
      if (result && typeof result === 'object' && result.timeout === true) {
        ipcLog('warn', 'auth:open-login', 'timeout', `platform=${platform} 耗时=${Date.now() - startedAt}ms`)
        return { code: EC.TIMEOUT_ERROR, message: '登录超时，请重试' }
      }
      let savedAccount, savedAccountId
      if (accountId) {
        // 重新登录：覆盖已有账号凭证，不创建新账号
        savedAccount = await AccountManager.updateCapturedAccount(platform, result, accountId)
        savedAccountId = accountId
      } else {
        // 新登录：创建新账号
        savedAccount = await AccountManager.saveCapturedAccount(platform, result)
        savedAccountId = savedAccount?.id || savedAccount?.accountId
      }
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed() && savedAccountId) {
        win.webContents.send('auth:completed', { platform, accountId: savedAccountId })
      }
      ipcLog('info', 'auth:open-login', 'ok', `platform=${platform} accountId=${savedAccountId} 耗时=${Date.now() - startedAt}ms`)
      return {
        code: 0,
        data: toPublicAccount({
          ...(savedAccount && typeof savedAccount === 'object' ? savedAccount : {}),
          platform,
          name: result.name,
        }),
        message: accountId ? '账号重新登录成功' : '账号添加成功',
      }
    } catch (e) {
      ipcLog('error', 'auth:open-login', 'error', `platform=${platform} message=${e instanceof Error ? e.message : String(e)} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  ipcMain.handle('auth:login-silent', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    ipcLog('info', 'auth:login-silent', 'enter', `platform=${arg?.platform} accountId=${arg?.accountId}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'auth:login-silent', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      if (!arg || typeof arg !== 'object') {
        ipcLog('warn', 'auth:login-silent', 'validation-failed', '缺少参数对象')
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const { platform, accountId } = arg
      if (!_isSafePathSegment(platform) || !_isSafePathSegment(accountId)) {
        ipcLog('warn', 'auth:login-silent', 'validation-failed', `platform=${platform} accountId=${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 platform/accountId 参数' }
      }
      if (Object.prototype.hasOwnProperty.call(arg, 'cookies') || Object.prototype.hasOwnProperty.call(arg, 'localStorage')) {
        ipcLog('warn', 'auth:login-silent', 'validation-failed', '禁止从渲染进程传递账号凭证')
        return { code: EC.VALIDATION_ERROR, message: '禁止从渲染进程传递账号凭证' }
      }
      const credentials = AccountManager.loadSavedCredentials(accountId, platform)
      if (!credentials) {
        ipcLog('warn', 'auth:login-silent', 'no-credentials', `platform=${platform} accountId=${accountId} 耗时=${Date.now() - startedAt}ms`)
        return { code: 0, data: { valid: false, accountName: null } }
      }
      const result = await authViewManager.loginSilent(
        platform,
        credentials.cookies,
        credentials.localStorage,
        credentials.indexedDB,
      )
      ipcLog('info', 'auth:login-silent', 'ok', `platform=${platform} accountId=${accountId} valid=${result?.valid} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: result }
    } catch (e) {
      ipcLog('error', 'auth:login-silent', 'error', `platform=${arg?.platform} accountId=${arg?.accountId} message=${e instanceof Error ? e.message : String(e)}`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e), data: { valid: false, accountName: null } }
    }
  }))

  ipcMain.handle('auth:complete-login', withSenderCheck(async () => {
    const startedAt = Date.now()
    ipcLog('info', 'auth:complete-login', 'enter', '')
    try {
      await authViewManager.completeLogin()
      ipcLog('info', 'auth:complete-login', 'ok', `耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: true, message: '正在保存账号' }
    } catch (e) {
      ipcLog('error', 'auth:complete-login', 'error', `message=${e instanceof Error ? e.message : String(e)}`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  ipcMain.handle('auth:close', withSenderCheck(async () => {
    const startedAt = Date.now()
    ipcLog('info', 'auth:close', 'enter', '')
    try {
      authViewManager.close()
      ipcLog('info', 'auth:close', 'ok', `耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: true }
    } catch (e) {
      ipcLog('error', 'auth:close', 'error', `message=${e instanceof Error ? e.message : String(e)}`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  ipcMain.handle('account:add', withSenderCheck(async (event, platform) => {
    const startedAt = Date.now()
    ipcLog('info', 'account:add', 'enter', `platform=${platform}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'account:add', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      if (!_isSafePathSegment(platform)) {
        ipcLog('warn', 'account:add', 'validation-failed', `platform=${platform}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 platform 参数' }
      }
      const account = await AccountManager.addAccount(platform)
      ipcLog('info', 'account:add', 'ok', `${safeAccountSummary(account)} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: toPublicAccount(account), message: '账号添加成功' }
    } catch (e) { ipcLog('error', 'account:add', 'error', `platform=${platform} message=${e instanceof Error ? e.message : String(e)}`); return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) } }
  }))

  ipcMain.handle('account:delete', withSenderCheck(async (event, accountId) => {
    const startedAt = Date.now()
    ipcLog('info', 'account:delete', 'enter', `accountId=${accountId}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'account:delete', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      // R51 P1：accountId 用于 URL 拼接，必须校验
      if (!_isSafePathSegment(accountId)) {
        ipcLog('warn', 'account:delete', 'validation-failed', `accountId=${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 accountId 参数' }
      }
      await AccountManager.deleteAccount(accountId)
      ipcLog('info', 'account:delete', 'ok', `accountId=${accountId} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: true, message: '账号已删除' }
    }
    catch (e) { ipcLog('error', 'account:delete', 'error', `accountId=${accountId} message=${e instanceof Error ? e.message : String(e)}`); return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) } }
  }))

  ipcMain.handle('account:check-login', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    ipcLog('info', 'account:check-login', 'enter', `platform=${arg?.platform} accountId=${arg?.accountId}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'account:check-login', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: { valid: false } }
      }
      // R51 P1：解构保护 + platform 用于 URL 拼接必须校验
      if (!arg || typeof arg !== 'object') {
        ipcLog('warn', 'account:check-login', 'validation-failed', '缺少参数对象')
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const { platform, accountId } = arg
      if (!_isSafePathSegment(platform) || !_isSafePathSegment(accountId)) {
        ipcLog('warn', 'account:check-login', 'validation-failed', `platform=${platform} accountId=${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 platform/accountId 参数' }
      }
      const status = await AccountManager.checkLoginStatus(platform, accountId)
      const checkedAt = new Date().toISOString()
      const outcome = await persistCheckOutcome(platform, accountId, status, '', null, checkedAt)
      ipcLog('info', 'account:check-login', 'ok', `platform=${platform} accountId=${accountId} valid=${status?.valid} loginStatus=${outcome.status || outcome.keptStatus} changed=${outcome.changed} persisted=${outcome.ok} 耗时=${Date.now() - startedAt}ms`)
      // data 仍是检测三态原样返回（向后兼容）；是否改写了真源由 statusChanged 表达
      return { code: 0, data: { ...status, loginStatus: outcome.status || outcome.keptStatus, statusChanged: outcome.changed } }
    } catch (e) { ipcLog('error', 'account:check-login', 'error', `platform=${arg?.platform} accountId=${arg?.accountId} message=${e instanceof Error ? e.message : String(e)}`); return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e), data: { valid: false } } }
  }))

  ipcMain.handle('accounts:batch-check-login', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    const requestedIds = Array.isArray(arg?.accountIds) ? arg.accountIds.filter((id) => typeof id === 'string' && id) : []
    ipcLog('info', 'accounts:batch-check-login', 'enter', `requested=${requestedIds.length}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'accounts:batch-check-login', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: { results: [], checkedAt: new Date().toISOString() } }
      }
      const accounts = await AccountManager.listAccounts()
      const candidates = Array.isArray(accounts) ? accounts.filter((a) => a && typeof a === 'object' && a.platform && a.id) : []
      const targets = requestedIds.length
        ? candidates.filter((a) => requestedIds.includes(a.id))
        : candidates
      const total = targets.length
      const limit = resolveBatchCheckConcurrency()
      const timeoutMs = resolveBatchCheckTimeoutMs()
      // 进度广播：每个账号「开始检测前」推 phase:'start'、「检测完成后」推
      // phase:'done'。只在使用完成边界时，计数等于已完成数，正在检测的账号
      // 完全不可见，单个慢账号会让遮罩静止数十秒，看起来等同卡死。
      // checked 恒为已完成数（0..total），渲染层据此推算「正在检测哪些平台」。
      const broadcastProgress = (payload) => {
        try {
          const win = BrowserWindow.getAllWindows()[0]
          if (win && !win.isDestroyed()) {
            win.webContents.send('accounts:batch-check-progress', payload)
          }
        } catch (_) { /* 广播失败不阻断检测 */ }
      }
      const checkedAt = new Date().toISOString()
      let persistedCount = 0
      // 结果按输入顺序落位：并发完成顺序不定，但回写配对必须稳定
      const slots = new Array(total).fill(null)
      let doneCount = 0
      await runWithConcurrency(targets, limit, async (account, index) => {
        const platform = account.platform
        const accountId = account.id
        broadcastProgress({ phase: 'start', checked: doneCount, total, platform, accountId })
        const accountStartedAt = Date.now()
        let status = null
        let checkError = ''
        let timeoutCode = ''
        try {
          status = await withHardTimeout(
            AccountManager.checkLoginStatus(platform, accountId),
            timeoutMs,
            `检测超时（>${timeoutMs}ms）`,
          )
        } catch (e) {
          checkError = e instanceof Error ? e.message : String(e)
          if (e && e.__batchCheckTimeout) timeoutCode = 'CHECK_LOGIN_TIMEOUT'
        }
        // 三态透传：valid 只能是 true / false / undefined（未确认）。
        // 历史实现用 Boolean(status?.valid) 把 undefined 压成 false，
        // 导致「无法判定」被渲染成「已失效」（今日头条假阴性根因之一）。
        let valid
        let code
        if (checkError) {
          valid = undefined
          code = timeoutCode || 'CHECK_LOGIN_ERROR'
        } else if (status && status.valid === true) {
          valid = true
          code = status.code || 'CHECK_LOGIN_SUCCESS'
        } else if (status && status.valid === false) {
          valid = false
          code = status.code || 'CHECK_LOGIN_FAILED'
        } else {
          valid = undefined
          code = (status && status.code) || 'CHECK_LOGIN_INCONCLUSIVE'
        }
        // 单向证据规则：无定论时保持真源原状，不抹掉既有正/负结论
        const outcome = await persistCheckOutcome(platform, accountId, status, checkError, account, checkedAt)
        const loginStatus = outcome.status || outcome.keptStatus
        if (outcome.ok && outcome.changed) persistedCount++
        const persisted = {
          ok: outcome.ok,
          ...(outcome.status ? { status: outcome.status } : {}),
          ...(outcome.changed ? {} : { kept: true }),
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        }
        const item = {
          platform,
          accountId,
          valid,
          code,
          loginStatus,
          statusChanged: outcome.changed,
          last_validated: outcome.changed ? checkedAt : (account && account.last_validated),
          persisted,
        }
        if (checkError) item.error = checkError
        else if (status && status.error) item.error = status.error
        slots[index] = item
        doneCount++
        const elapsedMs = Date.now() - accountStartedAt
        broadcastProgress({
          phase: 'done', checked: doneCount, total, platform, accountId,
          valid: item.valid, code: item.code, loginStatus: item.loginStatus,
          persisted: item.persisted.ok, elapsedMs,
        })
        ipcLog('info', 'accounts:batch-check-login', 'account', `${platform}:${accountId} valid=${item.valid} loginStatus=${item.loginStatus} persisted=${persisted.ok} code=${item.code} 耗时=${elapsedMs}ms`)
      })
      const results = slots.filter(Boolean)
      const data = { results, checkedAt }
      ipcLog('info', 'accounts:batch-check-login', 'ok', `count=${results.length} 并发=${limit} persisted=${persistedCount} inconclusive=${results.filter((r) => r.valid === undefined).length} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data }
    } catch (e) {
      ipcLog('error', 'accounts:batch-check-login', 'error', `message=${e instanceof Error ? e.message : String(e)} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e), data: { results: [], checkedAt: new Date().toISOString() } }
    }
  }))

  ipcMain.handle('accounts:batch-open-login', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    const requestedIds = Array.isArray(arg?.accountIds) ? arg.accountIds.filter((id) => typeof id === 'string' && id) : []
    ipcLog('info', 'accounts:batch-open-login', 'enter', `requested=${requestedIds.length}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'accounts:batch-open-login', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: { items: [] } }
      }
      // R51 P1：accountId 用于 URL 拼接，必须校验为安全路径段
      for (const id of requestedIds) {
        if (!_isSafePathSegment(id)) {
          ipcLog('warn', 'accounts:batch-open-login', 'validation-failed', `accountId=${id}`)
          return { code: EC.VALIDATION_ERROR, message: '缺少或非法 accountId 参数', data: { items: [] } }
        }
      }
      const accounts = await AccountManager.listAccounts()
      const candidates = Array.isArray(accounts) ? accounts.filter((a) => a && typeof a === 'object' && a.platform) : []
      const targets = candidates.filter((a) => requestedIds.includes(a.id))
      const items = []
      for (const account of targets) {
        const platform = account.platform
        const loginUrl = PLATFORM_LOGIN_URLS[platform]
        if (!loginUrl) continue
        items.push({
          accountId: account.id,
          platform,
          name: account.name || account.account_name || '',
          loginUrl,
        })
      }
      ipcLog('info', 'accounts:batch-open-login', 'ok', `count=${items.length} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { items } }
    } catch (e) {
      ipcLog('error', 'accounts:batch-open-login', 'error', `message=${e instanceof Error ? e.message : String(e)} 耗时=${Date.now() - startedAt}ms`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e), data: { items: [] } }
    }
  }))

  ipcMain.handle('account:set-proxy', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    ipcLog('info', 'account:set-proxy', 'enter', `platform=${arg?.platform} accountId=${arg?.accountId}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'account:set-proxy', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      if (!arg || typeof arg !== 'object') {
        ipcLog('warn', 'account:set-proxy', 'validation-failed', '缺少参数对象')
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const { accountId, platform, proxy } = arg
      if (!_isSafePathSegment(accountId) || !_isSafePathSegment(platform)) {
        ipcLog('warn', 'account:set-proxy', 'validation-failed', `platform=${platform} accountId=${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 accountId/platform 参数' }
      }
      const status = await AccountManager.setAccountProxy(accountId, platform, proxy)
      const proxyConfigured = status?.configured === true
      if (!status || typeof status !== 'object') {
        ipcLog('warn', 'account:set-proxy', 'invalid-status', `platform=${platform} accountId=${accountId}`)
        return { code: EC.REQUEST_ERROR, message: '代理状态无效' }
      }
      ipcLog('info', 'account:set-proxy', 'ok', `platform=${platform} accountId=${accountId} configured=${proxyConfigured} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: status, message: proxyConfigured ? '账号代理已保存' : '账号代理已清除' }
    } catch (e) {
      ipcLog('error', 'account:set-proxy', 'error', `platform=${arg?.platform} accountId=${arg?.accountId} message=${e instanceof Error ? e.message : String(e)}`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))

  // 启用态写入通道单独成文件（./account-active.js）：它与登录态属于不同关注点，
  // 而 account.js 已在行数挂账清单上（登记值 571，main 实测 728），继续往里堆会撞
  // check-max-lines 的膨胀容差。这里只把本模块已有的上下文闭包注入进去，判定口径不复制第二份。
  require('./account-active').registerAccountActiveHandler(ipcMain, {
    AccountManager, getOwnerSubject, ipcLog, isSafePathSegment: _isSafePathSegment
  })

  ipcMain.handle('account:list', withSenderCheck(async () => {
    const startedAt = Date.now()
    ipcLog('info', 'account:list', 'enter', `owner=${getOwnerSubject() ?? '<未登录>'}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'account:list', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: [] }
      }
      const accounts = await AccountManager.listAccounts()
      const data = Array.isArray(accounts) ? accounts.map(toPublicAccount) : []
      ipcLog('info', 'account:list', 'ok', `count=${data.length} platforms=[${data.map((a) => a.platform).filter((v, i, arr) => arr.indexOf(v) === i).join(',')}] 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data }
    }
    catch (e) { ipcLog('error', 'account:list', 'error', `message=${e instanceof Error ? e.message : String(e)}`); return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e), data: [] } }
  }))
}

module.exports = registerHandlers
