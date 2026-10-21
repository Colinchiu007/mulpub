const { IdentityError } = require('./identity-errors')
const { normalizeClockTolerance, verifyEntitlementToken } = require('./entitlement')

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * 权益宽限期（design §6.3）：覆盖「周五晚断连 → 周一才发现」的最长常见周期。
 * 判据必须是「没拿到有效响应」而非「请求失败」—— 见 sync() 里的 fetch catch 分支。
 */
const ENTITLEMENT_GRACE_SECONDS = 72 * 60 * 60

/**
 * 从未验证的令牌里只读一个数值字段（当前只用 exp）。
 * 用途是给 verifyEntitlementToken 选一个「该令牌视为有效」的判定时刻，让过期令牌
 * 仍能走完**同一套**绑定 + 签名校验（不在本文件复制任何验签逻辑）；
 * 真正的过期与 72h 宽限判定由调用方用真实时钟做，伪造不出权益。
 */
function readTokenExp (token) {
  try {
    const encoded = String(token || '').split('.')[0]
    const snapshot = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return Number.isFinite(snapshot.exp) ? snapshot.exp : null
  } catch (_) { return null }
}

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
    // v2.0 机制 C1.3 / G6：limits 是发布页平台数与日发校验的唯一数据源。
    // 此前被整段丢弃 ⇒「5 平台 / 50 篇日发」在客户端连内存态都进不去，只是服务端的一句承诺。
    ...(source.limits && typeof source.limits === 'object' && !Array.isArray(source.limits)
      ? { limits: JSON.parse(JSON.stringify(source.limits)) } : {}),
    // v2.0 机制 C9.2：到期宽限（只读/收尾期）与上一档位，用于会员中心横幅与升级引导。
    ...(typeof source.graceUntil === 'string' && source.graceUntil ? { graceUntil: source.graceUntil } : {}),
    ...(typeof source.previousPlan === 'string' && source.previousPlan ? { previousPlan: source.previousPlan } : {}),
  }
}

/**
 * 到期宽限的**客户端判活投影**（PRD §12 N10）。
 *
 * 服务端只在 `/me` 与权益提供器的读取端剔除过期 `graceUntil`（见
 * `PostgresEntitlementProvider.getForUser`），但客户端还持有**缓存/签名快照**两条离线路径：
 * 断网期间那条缓存不会经过服务端投影，于是「宽限中」横幅会一直显示到快照本身过期为止。
 * 因此凡是装配 entitlement 的三条路（在线 / 离线 / 宽限快照）都必须过这一层。
 *
 * @param {object} entitlement `normalizeEntitlement` 的产物
 * @param {number} nowSeconds 秒级时钟（与服务内 `_now` 同源，便于测试注入）
 * @returns {object} 同一对象（就地删除已过期/不可解析的宽限字段）
 */
function applyGraceWindow(entitlement, nowSeconds) {
  if (!entitlement || typeof entitlement !== 'object') return entitlement
  if (!entitlement.graceUntil) return entitlement
  const deadlineMs = Date.parse(entitlement.graceUntil)
  const nowMs = Number.isFinite(nowSeconds) ? nowSeconds * 1000 : Date.now()
  if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs) {
    delete entitlement.graceUntil
    delete entitlement.previousPlan
  }
  return entitlement
}

// 单条套餐的规范化：id 必填字符串，价格必须是**非负整数（单位：分）**。
// 价格用整数分而非元，避免浮点误差；非整数（如字符串 '2900'）一律判非法，
// 宁可丢弃该条也不要显示错价。
function normalizePlanEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const { id, label, currency, priceMonthlyCents, priceYearlyCents } = entry
  if (typeof id !== 'string' || !id) return null
  if (!Number.isInteger(priceMonthlyCents) || priceMonthlyCents < 0) return null
  if (!Number.isInteger(priceYearlyCents) || priceYearlyCents < 0) return null
  return {
    id,
    label: typeof label === 'string' && label ? label : id,
    currency: typeof currency === 'string' && currency ? currency : 'CNY',
    priceMonthlyCents,
    priceYearlyCents,
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

  /**
   * 网络层异常的宽限判定（design §6.1/§6.2）——本 change 唯一改动的失败路径。
   *
   * 为什么只放宽这一条：`_clearForGeneration` 存在的理由是对的（响应结构非法 /
   * 账号被停用时必须清权）。「网络抖一下付费用户被降级 free」是**唯一**需要修的误伤，
   * 其余三条失败路径一律保持 fail-closed。
   *
   * 有本地快照才宽限：快照本身就是上次成功认证的证据；无快照时无法区分
   * 「正版付费用户」与「未付费用户」，fail-open 等于让所有人白嫖。
   * 过期 ≤72h 仍授权读但禁写（source='grace' 使 onlineOnly 写通道自动拒绝）。
   */
  async _applyGrace(generation, subject) {
    const token = await this._queueStorageTask(async () => {
      if (!this._isCurrentGeneration(generation)) return null
      if (!this._storage || typeof this._storage.load !== 'function') return null
      const cached = await this._storage.load()
      return cached && typeof cached.token === 'string' ? cached.token : null
    })
    if (!token) return null
    const verifyAt = (now) => verifyEntitlementToken(token, {
      publicKeys: this._publicKeys, subject, deviceId: this._deviceId, now, clockTolerance: this._clockTolerance,
    })
    // 先按正常口径验一遍：未过期的快照直接通过（iat/签名/绑定/过期判定全部沿用既有实现）
    let snapshot
    try { snapshot = verifyAt(this._now()) } catch (_) { snapshot = null }
    if (!snapshot) {
      // 再按「该令牌视为有效」的判定时刻验一遍：仍要过绑定与签名校验，只是允许已过期。
      // 任何一步失败（格式 / key / 绑定 / 签名）都落到 fail-closed，绝不放宽。
      const exp = readTokenExp(token)
      if (exp === null) return null
      try { snapshot = verifyAt(exp - 1) } catch (_) { return null }
      if (this._now() - exp > ENTITLEMENT_GRACE_SECONDS) return null // 宽限期耗尽 → 降级 free
    }
    if (!this._isCurrentGeneration(generation)) return null
    // N10（PRD §12）：`graceUntil` 是**服务端到期宽限**的截止时刻，与上面那条离线宽限
    // （ENTITLEMENT_GRACE_SECONDS，管断网）语义不同、不得合并。快照可能缓存了已经过期的
    // graceUntil（服务端只在读取端做投影），离线期间客户端必须自己按本地时钟判活，
    // 否则「宽限中」横幅会在到期 7 天后继续显示。
    this._current = {
      ...applyGraceWindow(normalizeEntitlement(snapshot), this._now()),
      subject,
      deviceId: this._deviceId,
      source: 'grace',
      expiresAt: snapshot.exp,
      graceExpiresAt: snapshot.exp + ENTITLEMENT_GRACE_SECONDS,
    }
    return this.getState()
  }

  /**
   * 取服务端价目目录（`GET /api/v1/plans`，需 `profile:read`）。
   *
   * 2026-10-07 新增：此前 UI 完全不显示价格，营销文档里的金额是手写的。
   * 「凭记忆写死价格」与「从服务端取价」在测试视角下等价，因此没有测试覆盖
   * 价格的来源——这是本方法要消除的盲区。`plan-matrix.js` 是定价唯一真源。
   *
   * 契约（**故意不返回空数组**）：任何失败（网络/非 2xx/结构非法）都抛错，
   * 由调用方（`plans-catalog.js`）降级为 `null`。返回 `[]` 会让 UI 渲染出
   * 「无套餐」的空目录，与「取价失败」混淆。只丢弃单条非法条目并保留其余，
   * 全部非法时抛错。
   */
  async fetchPlans({ accessToken } = {}) {
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new IdentityError('ENTITLEMENT_REQUEST_INVALID', '获取价目目录参数无效')
    }
    let response
    try {
      response = await this._fetcher(`${this._apiUrl}/api/v1/plans`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-Device-Id': this._deviceId },
      })
    } catch (error) {
      throw new IdentityError('ENTITLEMENT_PLANS_FAILED', '价目服务暂时不可用', error)
    }
    if (!response || response.ok !== true) {
      throw new IdentityError('ENTITLEMENT_PLANS_FAILED', '价目服务拒绝请求')
    }
    let body
    try { body = await response.json() } catch (error) {
      throw new IdentityError('ENTITLEMENT_PLANS_FAILED', '价目响应格式无效', error)
    }
    if (!body || !Array.isArray(body.plans)) {
      throw new IdentityError('ENTITLEMENT_PLANS_FAILED', '价目响应缺少 plans 列表')
    }
    const plans = body.plans.map(normalizePlanEntry).filter(Boolean)
    if (plans.length === 0) {
      throw new IdentityError('ENTITLEMENT_PLANS_FAILED', '价目响应无有效套餐')
    }
    return plans
  }

  async sync({ subject, accessToken } = {}) {
    if (typeof subject !== 'string' || !subject || typeof accessToken !== 'string' || !accessToken) {
      throw new IdentityError('ENTITLEMENT_REQUEST_INVALID', '同步权益参数无效')
    }
    const generation = await this._beginOperation()
    // 换账号时清空既有权益：宽限路径也要按新 subject 重新校验绑定，
    // 否则旧账号的快照会被拿来给新账号授权
    if (this._current && this._current.subject !== subject) this._current = null
    let response
    try {
      response = await this._fetcher(`${this._apiUrl}/api/v1/me`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-Device-Id': this._deviceId },
      })
    } catch (error) {
      // 网络层异常（超时/DNS/断网）→ 唯一进入宽限期的分支
      const grace = await this._applyGrace(generation, subject)
      if (grace) return grace
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
    const entitlement = applyGraceWindow(normalizeEntitlement(body && body.entitlement), this._now())
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
        ...applyGraceWindow(normalizeEntitlement(snapshot), this._now()), subject, deviceId: this._deviceId, source: 'offline', expiresAt: snapshot.exp,
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
