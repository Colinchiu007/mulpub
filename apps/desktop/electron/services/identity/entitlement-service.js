const { IdentityError } = require('./identity-errors')
const { normalizeClockTolerance, verifyEntitlementToken } = require('./entitlement')

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function normalizeApiUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch (error) {
    throw new IdentityError('ENTITLEMENT_CONFIG_INVALID', '业务 API 地址无效', error)
  }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)))) {
    throw new IdentityError('ENTITLEMENT_CONFIG_INVALID', '业务 API 必须使用 HTTPS（本机开发可使用回环 HTTP）')
  }
  return url.toString().replace(/\/+$/, '')
}

function normalizeEntitlement(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    plan: typeof source.plan === 'string' && source.plan ? source.plan : 'free',
    features: Array.from(new Set(Array.isArray(source.features)
      ? source.features.filter((feature) => typeof feature === 'string' && feature.length <= 100)
      : [])),
    ...(source.quota && typeof source.quota === 'object' && !Array.isArray(source.quota)
      ? { quota: JSON.parse(JSON.stringify(source.quota)) } : {}),
  }
}

class EntitlementService {
  constructor(options = {}) {
    this._apiUrl = normalizeApiUrl(options.apiUrl)
    this._deviceId = String(options.deviceId || '')
    if (!this._deviceId || this._deviceId.length > 200) throw new IdentityError('ENTITLEMENT_CONFIG_INVALID', '设备标识无效')
    this._publicKeys = options.publicKeys || {}
    this._storage = options.storage || null
    this._fetcher = options.fetcher || globalThis.fetch
    this._now = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000)
    this._clockTolerance = normalizeClockTolerance(options.clockTolerance)
    if (typeof this._fetcher !== 'function') throw new IdentityError('ENTITLEMENT_FETCH_UNAVAILABLE', '系统缺少 fetch')
    this._current = null
    this._generation = 0
    this._storageQueue = Promise.resolve()
  }

  getState() {
    return this._current ? JSON.parse(JSON.stringify(this._current)) : null
  }

  _queueStorageTask(task) {
    const queued = this._storageQueue.then(task, task)
    this._storageQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  _beginOperation() {
    return this._queueStorageTask(async () => ++this._generation)
  }

  _isCurrentGeneration(generation) {
    return generation === this._generation
  }

  async _clearForGeneration(generation) {
    if (!this._isCurrentGeneration(generation)) return false
    this._current = null
    return this._queueStorageTask(async () => {
      if (!this._isCurrentGeneration(generation)) return false
      if (this._storage && typeof this._storage.clear === 'function') await this._storage.clear()
      return true
    })
  }

  async sync({ subject, accessToken } = {}) {
    if (typeof subject !== 'string' || !subject || typeof accessToken !== 'string' || !accessToken) {
      throw new IdentityError('ENTITLEMENT_REQUEST_INVALID', '同步权益参数无效')
    }
    const generation = await this._beginOperation()
    if (this._current && this._current.subject !== subject) this._current = null
    let response
    try {
      response = await this._fetcher(`${this._apiUrl}/api/v1/me`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-Device-Id': this._deviceId },
      })
    } catch (error) {
      throw new IdentityError('ENTITLEMENT_SYNC_FAILED', '权益服务暂时不可用', error)
    }
    if (!response || response.ok !== true || typeof response.json !== 'function') {
      await this._clearForGeneration(generation)
      throw new IdentityError('ENTITLEMENT_SYNC_FAILED', '权益服务拒绝请求')
    }
    let body
    try { body = await response.json() } catch (error) {
      await this._clearForGeneration(generation)
      throw new IdentityError('ENTITLEMENT_SYNC_FAILED', '权益响应格式无效', error)
    }
    if (body && body.user && body.user.status && body.user.status !== 'active') {
      await this._clearForGeneration(generation)
      throw new IdentityError('ENTITLEMENT_USER_INACTIVE', '当前账号不可用')
    }
    const entitlement = normalizeEntitlement(body && body.entitlement)
    const snapshotValue = body && body.entitlementSnapshot
    const token = typeof snapshotValue === 'string' ? snapshotValue : snapshotValue && snapshotValue.token
    let snapshot = null
    if (token && Object.keys(this._publicKeys).length > 0) {
      snapshot = verifyEntitlementToken(token, {
        publicKeys: this._publicKeys, subject, deviceId: this._deviceId,
        now: this._now(), clockTolerance: this._clockTolerance,
      })
      await this._queueStorageTask(async () => {
        if (!this._isCurrentGeneration(generation)) return false
        await this._storage?.save({ token })
        return true
      })
    } else if (this._storage) {
      await this._queueStorageTask(async () => {
        if (!this._isCurrentGeneration(generation)) return false
        await this._storage.clear()
        return true
      })
    }
    if (!this._isCurrentGeneration(generation)) return null
    this._current = {
      ...entitlement,
      subject,
      deviceId: this._deviceId,
      source: 'online',
      ...(snapshot ? { expiresAt: snapshot.exp } : {}),
    }
    return this.getState()
  }

  async restore(subject) {
    if (!this._storage || typeof subject !== 'string' || !subject || Object.keys(this._publicKeys).length === 0) return null
    const generation = await this._beginOperation()
    try {
      const cached = await this._storage.load()
      if (!this._isCurrentGeneration(generation)) return null
      if (!cached || typeof cached.token !== 'string') return null
      const snapshot = verifyEntitlementToken(cached.token, {
        publicKeys: this._publicKeys, subject, deviceId: this._deviceId,
        now: this._now(), clockTolerance: this._clockTolerance,
      })
      if (!this._isCurrentGeneration(generation)) return null
      this._current = {
        ...normalizeEntitlement(snapshot), subject, deviceId: this._deviceId, source: 'offline', expiresAt: snapshot.exp,
      }
      return this.getState()
    } catch (_) {
      await this._clearForGeneration(generation)
      return null
    }
  }

  /** 受控请求原语（仅供 member-api-service 白名单路径使用，不暴露内部状态）。 */
  get fetcher() { return this._fetcher }

  get deviceId() { return this._deviceId }

  get apiUrl() { return this._apiUrl }

  /** subject 与当前权益会话一致才放行（sign-out/换账号后旧 subject 即拒绝）。 */
  canReadMembership(subject) {
    return Boolean(this._current && subject && this._current.subject === subject)
  }

  hasFeature(feature, { onlineOnly = false } = {}) {
    return Boolean(this._current && (!onlineOnly || this._current.source === 'online') && this._current.features.includes(feature))
  }

  async clear() {
    await this._queueStorageTask(async () => {
      const generation = ++this._generation
      this._current = null
      if (this._storage && typeof this._storage.clear === 'function') await this._storage.clear()
      return generation
    })
  }
}

module.exports = { EntitlementService, normalizeApiUrl, normalizeEntitlement }
