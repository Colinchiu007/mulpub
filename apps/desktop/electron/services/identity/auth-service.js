const { IdentityError, toIdentityError } = require('./identity-errors')
const {
  claimsExpired,
  isNetworkError,
  isSessionRejected,
  logIdentityFailure,
} = require('./auth-diagnostics')

class AuthService {
  constructor(options = {}) {
    if (!options.client) throw new IdentityError('IDENTITY_CONFIG_INVALID', '缺少 Logto client')
    if (!options.tokenStorage) throw new IdentityError('IDENTITY_CONFIG_INVALID', '缺少安全会话存储')
    this._client = options.client
    this._tokenStorage = options.tokenStorage
    this._entitlementService = options.entitlementService || null
    this._resource = options.resource
    this._callbackServerFactory = options.callbackServerFactory
    this._redirectUri = options.redirectUri
    this._now = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000)
    /** 诊断日志（可注入；默认由工厂注入 electron/services/logger）。 */
    this._logger = options.logger || null
    this._offlineGraceSeconds = Number.isFinite(options.offlineGraceSeconds)
      ? Math.max(0, options.offlineGraceSeconds)
      : 7 * 24 * 60 * 60
    this._state = { status: 'signed_out', user: null, entitlement: null, error: null }
    this._accessTokenPromise = null
    this._signInPromise = null
    this._signOutPromise = null
    this._switchAccountPromise = null
    this._activeCallbackServer = null
    this._operationId = 0
    this._sessionMutationQueue = Promise.resolve()
    this._listeners = new Set()
  }

  getState() {
    return JSON.parse(JSON.stringify(this._state))
  }

  onStateChanged(listener) {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  _setState(next) {
    this._state = { ...this._state, ...next }
    const state = this.getState()
    for (const listener of this._listeners) {
      try {
        listener(state)
      } catch { /* ignore */ }
    }
  }

  _queueSessionMutation(task) {
    const queued = this._sessionMutationQueue.then(task, task)
    this._sessionMutationQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  /**
   * 诊断日志（scope + code + 完整 cause 链），实现见 auth-diagnostics.js。
   * @param {string} scope
   * @param {unknown} error
   * @param {Record<string, unknown>} [extra]
   */
  _logFailure(scope, error, extra = {}) {
    logIdentityFailure(this._logger, scope, error, extra)
  }

  async getAccessToken(options = {}) {
    if (this._accessTokenPromise) return this._accessTokenPromise
    const operationId = this._operationId
    this._accessTokenPromise = Promise.resolve()
      .then(async () => {
        if (options.forceRefresh && typeof this._client.clearAccessToken === 'function') {
          await this._client.clearAccessToken()
        }
        const token = await this._client.getAccessToken(this._resource)
        if (operationId !== this._operationId) {
          throw new IdentityError('IDENTITY_SESSION_EXPIRED', '登录会话已失效，请重新登录')
        }
        return token
      })
      .catch(async (error) => {
        if (isNetworkError(error)) {
          this._logFailure('getAccessToken.network', error)
          if (operationId === this._operationId && this._state.user) {
            this._setState({ status: 'offline_authenticated', error: null })
          }
          throw new IdentityError('IDENTITY_NETWORK_UNAVAILABLE', '网络暂时不可用', error)
        }
        if (isSessionRejected(error)) {
          this._logFailure('getAccessToken.sessionRejected', error)
          const cleanupError = await this._clearLocalSessionOrSetError(undefined, operationId)
          if (cleanupError) throw cleanupError
          throw new IdentityError('IDENTITY_SESSION_EXPIRED', '登录会话已失效，请重新登录', error)
        }
        const identityError = toIdentityError(error, 'IDENTITY_TOKEN_UNAVAILABLE')
        this._logFailure('getAccessToken', identityError)
        if (operationId === this._operationId) {
          this._setState({
            status: 'error',
            error: { code: identityError.code, message: '暂时无法获取访问凭证，请稍后重试' },
          })
        }
        throw identityError
      })
      .finally(() => { this._accessTokenPromise = null })
    return this._accessTokenPromise
  }

  async _clearLocalSession(operationId = null) {
    return this._queueSessionMutation(async () => {
      if (operationId !== null && operationId !== this._operationId) return false
      let clearError = null
      try {
        await this._tokenStorage.clear()
      } catch (error) {
        // 关键诊断点：这里拿到的是「删除/清空本地会话」的原始错误（可能不带 .code，
        // 例如宿主安全删除 shim 的 fail-closed 错误）。必须落盘，否则只能看到上层
        // 被包装后的 IDENTITY_SESSION_CLEAR_FAILED，无法定位真实原因。
        clearError = error
        this._logFailure('tokenStorage.clear', error)
      }
      if (operationId !== null && operationId !== this._operationId) return false
      if (this._entitlementService && typeof this._entitlementService.clear === 'function') {
        try {
          await this._entitlementService.clear()
        } catch (error) {
          if (!clearError) clearError = error
        }
      }
      if (operationId !== null && operationId !== this._operationId) return false
      if (clearError) throw toIdentityError(clearError, 'IDENTITY_SESSION_CLEAR_FAILED')
      this._setState({ status: 'signed_out', user: null, entitlement: null, error: null })
      return true
    })
  }

  async _clearLocalSessionOrSetError(message = '无法安全清理本地登录信息，请重试', operationId = null) {
    try {
      await this._clearLocalSession(operationId)
      return null
    } catch (error) {
      if (operationId !== null && operationId !== this._operationId) return null
      const identityError = toIdentityError(error, 'IDENTITY_SESSION_CLEAR_FAILED')
      this._logFailure('clearLocalSession', identityError, { message })
      this._setState({ status: 'error', error: { code: identityError.code, message } })
      return identityError
    }
  }

  /**
   * 登录失败后的本地清理（不改写 state，只回报清理结果）。
   *
   * 与 `_clearLocalSessionOrSetError` 的关键区别：清理失败不是本次操作的**主错误**，
   * 因此不得覆盖真正的登录失败原因（2026-09-14 事故根因之一：
   * `throw cleanupError || identityError` 让「清理失败」抢占了主错误码，
   * 前端于是把「点登录失败」显示成「退出失败」）。
   *
   * @param {number|null} operationId
   * @returns {Promise<import('./identity-errors').IdentityError | null>}
   */
  async _clearLocalSessionAfterSignInFailure(operationId) {
    try {
      await this._clearLocalSession(operationId)
      return null
    } catch (error) {
      if (operationId !== null && operationId !== this._operationId) return null
      return toIdentityError(error, 'IDENTITY_SESSION_CLEAR_FAILED')
    }
  }

  async _clearSignInWindowSessionOrSetError() {
    if (typeof this._client.clearSignInWindowSession !== 'function') return null
    try {
      await this._client.clearSignInWindowSession()
      return null
    } catch (error) {
      const identityError = toIdentityError(error, 'IDENTITY_AUTH_WINDOW_SESSION_CLEAR_FAILED')
      this._logFailure('clearSignInWindowSession', identityError)
      this._setState({
        status: 'error',
        error: { code: identityError.code, message: '退出失败，认证窗口会话未能清理，请重试' },
      })
      return identityError
    }
  }

  async _syncEntitlement(user) {
    if (!this._entitlementService || typeof this._entitlementService.sync !== 'function') return null
    const accessToken = await this.getAccessToken()
    return this._entitlementService.sync({ subject: user.sub, accessToken })
  }

  async _restoreEntitlement(subject) {
    if (!this._entitlementService || typeof this._entitlementService.restore !== 'function') return null
    return this._entitlementService.restore(subject)
  }

  _withinOfflineGrace(claims) {
    return Boolean(claims && Number.isFinite(claims.exp) && this._now() <= claims.exp + this._offlineGraceSeconds)
  }

  async restore() {
    const operationId = this._operationId
    const isCurrentOperation = () => operationId === this._operationId
    let claims
    let user
    try {
      const authenticated = await this._client.isAuthenticated()
      if (!isCurrentOperation()) return this.getState()
      if (!authenticated) {
        await this._clearLocalSessionOrSetError(undefined, operationId)
        return this.getState()
      }
      claims = await this._client.getIdTokenClaims()
      if (!isCurrentOperation()) return this.getState()
      user = sanitizeClaims(claims)
      if (claimsExpired(claims, this._now())) {
        try {
          if (typeof this._client.clearAccessToken === 'function') await this._client.clearAccessToken()
          await this._client.getAccessToken(this._resource)
          if (!isCurrentOperation()) return this.getState()
          claims = await this._client.getIdTokenClaims()
          if (!isCurrentOperation()) return this.getState()
          user = sanitizeClaims(claims)
        } catch (error) {
          if (!isCurrentOperation()) return this.getState()
          if (isNetworkError(error) && this._withinOfflineGrace(claims)) {
            const entitlement = await this._restoreEntitlement(user.sub)
            if (!isCurrentOperation()) return this.getState()
            this._setState({ status: 'offline_authenticated', user, entitlement, error: null })
            return this.getState()
          }
          await this._clearLocalSessionOrSetError(undefined, operationId)
          return this.getState()
        }
      }
      const entitlement = await this._restoreEntitlement(user.sub)
      if (!isCurrentOperation()) return this.getState()
      this._setState({ status: 'authenticated', user, entitlement, error: null })
      return this.getState()
    } catch (error) {
      if (!isCurrentOperation()) return this.getState()
      if (isNetworkError(error) || (error && error.code === 'IDENTITY_SECURE_STORAGE_UNAVAILABLE')) {
        this._logFailure('restore', error)
        const code = error && error.code === 'IDENTITY_SECURE_STORAGE_UNAVAILABLE'
          ? error.code
          : 'IDENTITY_NETWORK_UNAVAILABLE'
        this._setState({
          status: 'error',
          error: {
            code,
            message: code === 'IDENTITY_SECURE_STORAGE_UNAVAILABLE'
              ? '系统安全存储暂时不可用，已保留本地登录信息'
              : '网络暂时不可用，已保留本地登录信息',
          },
        })
        return this.getState()
      }
      await this._clearLocalSessionOrSetError(undefined, operationId)
      return this.getState()
    }
  }

  signIn() {
    return this._beginSignIn(false)
  }

  async _beginSignIn(fromAccountSwitch) {
    if (this._switchAccountPromise && !fromAccountSwitch) {
      throw new IdentityError('IDENTITY_OPERATION_IN_PROGRESS', '账号切换正在进行中，请稍后重试')
    }
    if (this._signInPromise || this._state.status === 'signing_in') {
      throw new IdentityError('IDENTITY_SIGN_IN_IN_PROGRESS', '登录已经在进行中')
    }
    if (this._signOutPromise || this._state.status === 'signing_out') {
      throw new IdentityError('IDENTITY_OPERATION_IN_PROGRESS', '退出正在进行中，请稍后重试')
    }
    if (typeof this._callbackServerFactory !== 'function' || !this._redirectUri) {
      throw new IdentityError('IDENTITY_CONFIG_INVALID', '缺少登录回调配置')
    }
    if (!fromAccountSwitch && this._state.user && typeof this._state.user.sub === 'string') {
      throw new IdentityError('IDENTITY_ACCOUNT_SWITCH_REQUIRED', '请使用切换账号入口登录其他账号')
    }
    const operationId = ++this._operationId
    this._setState({ status: 'signing_in', error: null })
    const task = this._performSignIn(operationId)
    this._signInPromise = task
    try {
      return await task
    } finally {
      if (this._signInPromise === task) this._signInPromise = null
    }
  }

  switchAccount() {
    if (this._switchAccountPromise) return this._switchAccountPromise
    const task = Promise.resolve().then(async () => {
      if (this._state.user && typeof this._state.user.sub === 'string') await this.signOut()
      return this._beginSignIn(true)
    })
    this._switchAccountPromise = task
    return task.finally(() => {
      if (this._switchAccountPromise === task) this._switchAccountPromise = null
    })
  }

  async _performSignIn(operationId) {
    if (typeof this._client.prepareSignInState !== 'function') {
      throw new IdentityError('IDENTITY_SDK_INVALID', 'Logto client 不支持回调 state 预绑定')
    }
    const expectedState = await this._client.prepareSignInState()
    if (typeof expectedState !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/.test(expectedState)) {
      throw new IdentityError('IDENTITY_CALLBACK_STATE_INVALID', '登录回调 state 无效')
    }
    const callbackServer = this._callbackServerFactory({ expectedState })
    this._activeCallbackServer = callbackServer
    try {
      await callbackServer.start()
      const callbackPromise = callbackServer.waitForCallback()
      // L2 秒开：先弹出本地加载窗（不等 OIDC discovery），把窗口出现从 discovery 之后提前到点击瞬间；
      // 加载窗失败绝不能阻断登录主流程，降级为原有「URL 就绪再开窗」。
      try { await this._client.openSignInWindow?.() } catch { /* best-effort：忽略加载窗异常 */ }
      await this._client.signIn({ redirectUri: this._redirectUri })
      let callbackUri
      if (typeof this._client.waitForSignInWindowClosed === 'function') {
        const result = await Promise.race([
          callbackPromise.then((uri) => ({ type: 'callback', uri })),
          this._client.waitForSignInWindowClosed().then(() => ({ type: 'window-closed' })),
        ])
        if (result.type === 'window-closed') {
          throw new IdentityError('IDENTITY_SIGN_IN_CANCELLED', '登录窗口已关闭')
        }
        callbackUri = result.uri
      } else {
        callbackUri = await callbackPromise
      }
      await this._queueSessionMutation(async () => {
        if (operationId !== this._operationId) {
          throw new IdentityError('IDENTITY_SIGN_IN_CANCELLED', '登录已取消')
        }
        await this._client.handleSignInCallback(callbackUri)
        if (operationId !== this._operationId) {
          throw new IdentityError('IDENTITY_SIGN_IN_CANCELLED', '登录已取消')
        }
      })
      const claims = await this._client.getIdTokenClaims()
      if (operationId !== this._operationId) {
        throw new IdentityError('IDENTITY_SIGN_IN_CANCELLED', '登录已取消')
      }
      const user = sanitizeClaims(claims)
      const entitlement = await this._syncEntitlement(user)
      if (operationId !== this._operationId) {
        throw new IdentityError('IDENTITY_SIGN_IN_CANCELLED', '登录已取消')
      }
      this._setState({ status: 'authenticated', user, entitlement, error: null })
      return this.getState()
    } catch (error) {
      const identityError = toIdentityError(error, 'IDENTITY_SIGN_IN_FAILED')
      this._logFailure('signIn', identityError)
      const cleanupError = await this._clearLocalSessionAfterSignInFailure(operationId)
      if (operationId === this._operationId) {
        this._setState({
          status: 'error',
          error: {
            code: identityError.code,
            message: '登录失败，请重试',
            ...(cleanupError ? { cleanup: { code: cleanupError.code } } : {}),
          },
        })
      }
      if (cleanupError) {
        // 主错误优先：清理失败降级为附加信息，避免掩盖真正的登录失败原因。
        identityError.cleanupCode = cleanupError.code
        this._logFailure('signInCleanup', cleanupError, { primaryCode: identityError.code })
      }
      throw identityError
    } finally {
      if (this._activeCallbackServer === callbackServer) this._activeCallbackServer = null
      if (typeof this._client.closeSignInWindow === 'function') {
        try { await this._client.closeSignInWindow() } catch { /* ignore */ }
      }
      await callbackServer.stop()
    }
  }

  signOut() {
    if (this._signOutPromise) return this._signOutPromise
    const task = this._performSignOut()
    this._signOutPromise = task
    return task.finally(() => {
      if (this._signOutPromise === task) this._signOutPromise = null
    })
  }

  async _performSignOut() {
    ++this._operationId
    this._setState({ status: 'signing_out', error: null })
    const activeCallbackServer = this._activeCallbackServer
    if (activeCallbackServer && typeof activeCallbackServer.cancel === 'function') {
      await activeCallbackServer.cancel()
    }
    const activeSignIn = this._signInPromise
    if (activeSignIn) await activeSignIn.catch(() => {})
    const activeAccessToken = this._accessTokenPromise
    if (activeAccessToken) await activeAccessToken.catch(() => {})
    let warning = null
    try {
      await this._client.signOut()
    } catch (error) {
      warning = toIdentityError(error).code
      this._logFailure('signOut.remote', error, { warning })
    }
    const authWindowCleanupError = await this._clearSignInWindowSessionOrSetError()
    if (authWindowCleanupError) throw authWindowCleanupError
    const cleanupError = await this._clearLocalSessionOrSetError('退出失败，本地登录信息未能清理，请重试')
    if (cleanupError) throw cleanupError
    return warning ? { ...this.getState(), warning } : this.getState()
  }

  async dispose() {
    ++this._operationId
    const callbackServer = this._activeCallbackServer
    const activeSignIn = this._signInPromise
    let disposeError = null
    if (callbackServer && typeof callbackServer.cancel === 'function') {
      try {
        await callbackServer.cancel()
      } catch (error) {
        disposeError = error
      }
    }
    if (typeof this._client.closeSignInWindow === 'function') {
      try {
        await this._client.closeSignInWindow()
      } catch (error) {
        if (!disposeError) disposeError = error
      }
    }
    if (activeSignIn) {
      try {
        await activeSignIn
      } catch { /* ignore */ }
    }
    this._listeners.clear()
    if (disposeError) throw toIdentityError(disposeError, 'IDENTITY_DISPOSE_FAILED')
  }

  async requireEntitlement(feature, options = {}) {
    const statusAllowed = this._state.status === 'authenticated' ||
      (this._state.status === 'offline_authenticated' && !options.onlineOnly)
    if (typeof feature !== 'string' || !feature || !statusAllowed ||
        !this._state.user || typeof this._state.user.sub !== 'string' || !this._state.user.sub) {
      throw new IdentityError('ENTITLEMENT_REQUIRED', '当前账号没有所需权益')
    }
    if (!this._entitlementService) throw new IdentityError('ENTITLEMENT_REQUIRED', '当前账号没有所需权益')
    if (options.onlineOnly && typeof this._entitlementService.sync === 'function') {
      const operationId = this._operationId
      const subject = this._state.user.sub
      let entitlement
      try {
        entitlement = await this._syncEntitlement(this._state.user)
      } catch (error) {
        if (operationId !== this._operationId) {
          throw new IdentityError('ENTITLEMENT_REQUIRED', '当前账号没有所需权益', error)
        }
        throw error
      }
      if (operationId !== this._operationId || this._state.status !== 'authenticated' ||
          !this._state.user || this._state.user.sub !== subject) {
        throw new IdentityError('ENTITLEMENT_REQUIRED', '当前账号没有所需权益')
      }
      this._setState({ entitlement })
    }
    const hasFeature = typeof this._entitlementService.hasFeature === 'function'
      ? this._entitlementService.hasFeature(feature, { onlineOnly: Boolean(options.onlineOnly) })
      : Boolean(this._state.entitlement && this._state.entitlement.features.includes(feature))
    if (!hasFeature) throw new IdentityError('ENTITLEMENT_REQUIRED', '当前账号没有所需权益')
    return true
  }
}

function sanitizeClaims(claims = {}) {
  if (!claims || typeof claims.sub !== 'string' || !claims.sub.trim()) {
    throw new IdentityError('IDENTITY_SESSION_INVALID', '登录会话缺少用户标识')
  }
  return {
    sub: claims.sub,
    name: typeof claims.name === 'string' ? claims.name : '',
    username: typeof claims.username === 'string' ? claims.username : '',
    picture: typeof claims.picture === 'string' ? claims.picture : '',
  }
}

module.exports = { AuthService, sanitizeClaims, claimsExpired, isNetworkError, isSessionRejected }
