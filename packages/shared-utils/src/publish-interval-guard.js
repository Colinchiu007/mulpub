/**
 * 发布频率控制 — 间隔 + 日配额守卫（v3）
 *
 * 三个维度（数值由 publish-frequency-policy 单一持有，本文件不抄数值）：
 *   account  档：键 `platform:accountId`  —— 同一账号在同一平台连发
 *   platform 档：键 `platform:*`           —— 同一平台任意两次发布（账号档恒 ≥ 本档 ⇒
 *                                            同账号由账号档决定，跨账号由本档兜底）
 *   daily    档：键 `platform:accountId`   —— 同一账号在同一平台的每日提交上限（本机运营日）
 * accountId 缺席时账号档与日配额跳过、平台档仍生效：「没有账号身份」不等于「没有发布行为」。
 *
 * v3（change: publish-frequency-policy-v3）：`release()` 的防风上限改为
 *   `min(max(2, dailyMax), MAX_ROLLBACK_PER_DAY)` —— 日配额被放大 10 倍时，「每日可回滚次数」
 *   不得跟着放大（那等于把防重试风暴的闸写成配额的函数；方向恒为"多等"）。
 * v2（change: publish-frequency-policy-v2）：新增日配额维度（`bucket:'daily'`/`reason`/`daily`）、
 *   只增不减的抖动（可注入随机源，ratio=0 退化为 v1）、`release()`（乐观并发 + 防风上限）与
 *   `recordPublish()` 回传占位前值；key 一律经 `buildKey()`（percent-encode）；未登记平台回落出声。
 */
const { resolveIntervals, isKnownPlatform, DEFAULT_JITTER_RATIO, MIN_RELEASE_GRACE_MS } = require('./publish-frequency-policy')

/** 平台档桶的哨兵 accountId；导出供装配与测试引用，禁止各处手抄 '*' */
const PLATFORM_BUCKET_ACCOUNT_ID = '*'
/** setTimeout 上限（2^31-1）；抖动结果在此之下留余量，避免溢出被钳成 1ms 形成忙循环 */
const TIMER_MAX_MS = 2147483647
const TIMER_SAFE_MS = TIMER_MAX_MS - 2000
/** release 的合法原因 */
const REASON_INTERVAL = 'interval'
const REASON_DAILY_QUOTA = 'daily_quota'
/** 「未提交失败回滚」每账号每日许可数的**硬顶**（v3）；与日配额解耦，见 `_rollbackCap` */
const MAX_ROLLBACK_PER_DAY = 5

class InMemoryStore {
  constructor () {
    this._data = new Map()
  }

  get (key) {
    return this._data.get(key) ?? null
  }

  set (key, value) {
    this._data.set(key, value)
  }

  /** 返回所有存储的 key（用于调试/测试） */
  keys () {
    return Array.from(this._data.keys())
  }
}

/** 内存日计数存储（仅测试与无 DB 场景；桌面端注入 SQLite 实现） */
class InMemoryDailyStore {
  constructor () {
    this._data = new Map()
  }

  _key (key, dayKey) {
    return `${key}|${dayKey}`
  }

  _row (key, dayKey) {
    const k = this._key(key, dayKey)
    if (!this._data.has(k)) this._data.set(k, { count: 0, rollbackCount: 0 })
    return this._data.get(k)
  }

  getDay (key, dayKey) {
    return this._data.get(this._key(key, dayKey)) || { count: 0, rollbackCount: 0 }
  }

  incrDay (key, dayKey, field = 'count', delta = 1) {
    const row = this._row(key, dayKey)
    const name = field === 'rollback_count' || field === 'rollbackCount' ? 'rollbackCount' : 'count'
    row[name] = Math.max(0, row[name] + delta)
    return row[name]
  }

  decrDay (key, dayKey, field = 'count') {
    return this.incrDay(key, dayKey, field, -1)
  }
}

function normalizeAccountId (accountId) {
  if (typeof accountId !== 'string') return null
  const trimmed = accountId.trim()
  return trimmed || null
}

/**
 * 唯一 key 构造函数（I8：禁止任何地方裸拼接 key）。
 * 平台段与账号段分别 percent-encode；平台档哨兵 `*` 以字面量追加、**不参与编码**
 * （否则会分裂出 `%2A` 与 `*` 两种形态的同义键）。
 *
 * @param {string} platform
 * @param {string|null|undefined} accountId - 缺席/空 ⇒ 平台档哨兵
 * @returns {string}
 */
function buildKey (platform, accountId) {
  const p = encodeURIComponent(String(platform == null ? '' : platform))
  const a = normalizeAccountId(accountId)
  return a ? `${p}:${encodeURIComponent(a)}` : `${p}:${PLATFORM_BUCKET_ACCOUNT_ID}`
}

/** 计数读回：TEXT 亲和会带回 '.0'；非有限一律 0（并出声由调用方决定） */
function readCount (raw) {
  const n = Number.parseInt(String(raw == null ? '' : raw), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

class PublishIntervalGuard {
  /**
   * @param {object} [options]
   * @param {number} [options.minInterval] - 两档统一覆盖（主要供测试与旧调用方使用）
   * @param {(platform: string) => {accountMinMs: number, platformMinMs: number, accountDailyMax: number, fallback?: boolean}} [options.policy]
   *   按平台解析策略；缺省用 publish-frequency-policy
   * @param {object} [options.store] - 间隔存储 { get(key), set(key, value) }
   * @param {object} [options.dailyStore] - 日计数存储 { getDay(key, dayKey), incrDay(key, dayKey, field, delta), decrDay(key, dayKey, field) }
   * @param {() => number} [options.now] - 时钟注入（与 today / 次日边界同源）
   * @param {() => string} [options.today] - 本机运营日注入；缺省由 now() 推导
   * @param {() => number} [options.random] - 随机源注入（抖动用）
   * @param {number} [options.jitterRatio] - 抖动比例 [0,1)；0 = 关闭
   * @param {number} [options.releaseGraceMs] - 回滚后最小退避（防风上限的伴随项；下界 10s）
   * @param {(msg: string) => void} [options.warn]
   */
  constructor (options = {}) {
    this._minInterval = Number.isFinite(options.minInterval) && options.minInterval >= 0
      ? options.minInterval
      : null
    this._policy = typeof options.policy === 'function' ? options.policy : resolveIntervals
    this._isKnownPlatform = typeof options.isKnownPlatform === 'function' ? options.isKnownPlatform : isKnownPlatform
    this._store = options.store || new InMemoryStore()
    this._dailyStore = options.dailyStore || null
    this._now = typeof options.now === 'function' ? options.now : () => Date.now()
    this._today = typeof options.today === 'function'
      ? options.today
      : () => new Date(this._now()).toLocaleDateString('sv-SE')
    this._random = typeof options.random === 'function' ? options.random : Math.random
    this._jitterRatio = Number.isFinite(options.jitterRatio) && options.jitterRatio >= 0 && options.jitterRatio < 1
      ? options.jitterRatio
      : DEFAULT_JITTER_RATIO
    this._releaseGraceMs = Number.isFinite(options.releaseGraceMs) && options.releaseGraceMs >= MIN_RELEASE_GRACE_MS
      ? options.releaseGraceMs
      : MIN_RELEASE_GRACE_MS
    this._warn = typeof options.warn === 'function' ? options.warn : (msg) => console.warn(msg)
    /** 未登记平台告警去重（进程内） */
    this._warnedFallback = new Set()
  }

  get jitterRatio () {
    return this._jitterRatio
  }

  get releaseGraceMs () {
    return this._releaseGraceMs
  }

  /**
   * 运行期更新抖动比例（设置页改动即时生效，无需重启）。非法值 no-op 并出声，
   * 绝不让「设置页写了个非法值」把已生效的保守配置降级成 0（那等于静默关掉抖动）。
   * @param {number} n
   * @returns {boolean} 是否已应用
   */
  setJitterRatio (n) {
    if (!Number.isFinite(n) || n < 0 || n >= 1) {
      this._warn(`[PublishFrequency] 拒绝应用非法抖动比例 ${JSON.stringify(n)}（需 [0,1) 的有限数），保持 ${this._jitterRatio}`)
      return false
    }
    this._jitterRatio = n
    return true
  }

  /**
   * 运行期更新回滚退避（下界 10s 钳位，与 env 同纪律）。
   * @param {number} n
   * @returns {boolean} 是否已应用
   */
  setReleaseGraceMs (n) {
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      this._warn(`[PublishFrequency] 拒绝应用非法回滚退避 ${JSON.stringify(n)}（需 >=0 整数），保持 ${this._releaseGraceMs}`)
      return false
    }
    this._releaseGraceMs = Math.max(MIN_RELEASE_GRACE_MS, n)
    return true
  }

  /** 今天（本机运营日） */
  today () {
    return this._today()
  }

  /**
   * 距下一个本机运营日边界（次日 00:00:05）的毫秒数；与 today() 共用同一注入时钟。
   * @returns {number}
   */
  msUntilNextDay () {
    const base = new Date(this._now())
    const next = new Date(base.getTime())
    next.setHours(24, 0, 5, 0)
    return Math.max(1, next.getTime() - base.getTime())
  }

  _key (platform, accountId) {
    return buildKey(platform, accountId)
  }

  _intervals (platform) {
    // tier 一并回传：`ipc-handlers/publish-frequency.js` 把本返回原样发给渲染层，设置页「当前档位」
    // 按 tier 分组显示 —— 缺键时屏幕上每组都是 `undefined（4 个平台…）`（QM-6 前端轴 C2）
    if (this._minInterval !== null) {
      const resolved = this._policy(platform) || {}
      return {
        tier: resolved.tier ?? null,
        accountMinMs: this._minInterval,
        platformMinMs: this._minInterval,
        accountDailyMax: Number(resolved.accountDailyMax) || 0,
      }
    }
    const resolved = this._policy(platform) || {}
    if (resolved.fallback && !this._warnedFallback.has(platform)) {
      this._warnedFallback.add(platform)
      this._warn(
        `[PublishFrequency] 平台 "${platform}" 未登记频率策略，回落最严基线`
        + `（账号 ${Math.round((Number(resolved.accountMinMs) || 0) / 60000)} 分钟 / `
        + `日配额 ${Number(resolved.accountDailyMax) || 0} 条）；请登记到 PLATFORM_FREQUENCY_POLICY`
      )
    }
    return {
      tier: resolved.tier ?? null,
      accountMinMs: Number(resolved.accountMinMs) || 0,
      platformMinMs: Number(resolved.platformMinMs) || 0,
      accountDailyMax: Number(resolved.accountDailyMax) || 0,
    }
  }

  /** 抖动：只增不减；含抖动系数后仍钳在 setTimeout 安全值内 */
  _jitter (ms) {
    if (!(ms > 0)) return 0
    if (!(this._jitterRatio > 0)) return ms
    const jittered = Math.round(ms * (1 + this._jitterRatio * this._random()))
    return jittered > TIMER_SAFE_MS ? TIMER_SAFE_MS : jittered
  }

  _remaining (key, minInterval, now) {
    if (!(minInterval > 0)) return 0
    const lastTime = this._store.get(key)
    if (!lastTime) return 0
    return Math.max(0, minInterval - (now - Number(lastTime)))
  }

  _readDaily (key, dayKey) {
    if (!this._dailyStore) return { count: 0, rollbackCount: 0 }
    let row = null
    try {
      row = this._dailyStore.getDay(key, dayKey)
    } catch (e) {
      this._warn(`[PublishFrequency] 日计数读取失败（按 0 处理）：${e && e.message}`)
      return { count: 0, rollbackCount: 0 }
    }
    if (!row) return { count: 0, rollbackCount: 0 }
    const count = readCount(row.count)
    const rollbackCount = readCount(row.rollback_count !== undefined ? row.rollback_count : row.rollbackCount)
    return { count, rollbackCount }
  }

  _incrDaily (key, dayKey, field, delta) {
    if (!this._dailyStore) return 0
    try {
      const fn = delta < 0 ? this._dailyStore.decrDay : this._dailyStore.incrDay
      if (typeof fn === 'function') return fn.call(this._dailyStore, key, dayKey, field, Math.abs(delta))
      if (delta < 0 && typeof this._dailyStore.incrDay === 'function') {
        return this._dailyStore.incrDay(key, dayKey, field, delta)
      }
    } catch (e) {
      this._warn(`[PublishFrequency] 日计数写入失败（已忽略，不回滚）：${e && e.message}`)
    }
    return 0
  }

  /**
   * 评估两档间隔与日配额，返回被更严一项决定的等待时间。
   * 日配额是**独立否决项**：命中时 remainingMs 恒为 0（它是「今天到此为止」，不是「等一会儿」）。
   *
   * @returns {{allowed: boolean, remainingMs: number, bucket: ('account'|'platform'|'daily'|null),
   *            reason: (null|'interval'|'daily_quota'), daily: (null|{used: number, max: number, dayKey: string})}}
   */
  check (platform, accountId) {
    const now = this._now()
    const dayKey = this.today()
    const { accountMinMs, platformMinMs, accountDailyMax } = this._intervals(platform)
    const normalizedAccount = normalizeAccountId(accountId)
    const accountKey = normalizedAccount ? this._key(platform, normalizedAccount) : null

    // ① 日配额（独立否决项，先判：它比「等一会儿」更强，用户可行动性也不同——改期而非等待）
    let daily = null
    if (accountKey && accountDailyMax > 0 && this._dailyStore) {
      const row = this._readDaily(accountKey, dayKey)
      daily = { used: row.count, max: accountDailyMax, dayKey }
      if (row.count >= accountDailyMax) {
        return { allowed: false, remainingMs: 0, bucket: 'daily', reason: REASON_DAILY_QUOTA, daily }
      }
    }

    // ② 两档间隔取更严
    let remainingMs = 0
    let bucket = null

    if (accountKey && accountMinMs > 0) {
      const r = this._remaining(accountKey, accountMinMs, now)
      if (r > 0) {
        remainingMs = r
        bucket = 'account'
      }
    }

    const platformRemaining = this._remaining(
      this._key(platform, null), platformMinMs, now
    )
    if (platformRemaining > remainingMs) {
      remainingMs = platformRemaining
      bucket = 'platform'
    }

    if (remainingMs > 0) {
      return { allowed: false, remainingMs: this._jitter(remainingMs), bucket, reason: REASON_INTERVAL, daily }
    }
    return { allowed: true, remainingMs: 0, bucket: null, reason: null, daily }
  }

  /**
   * 检查是否允许发布
   * @param {string} platform - 平台标识
   * @param {string} [accountId] - 账号 ID；缺席时只受平台档约束
   * @returns {boolean}
   */
  canPublish (platform, accountId) {
    return this.check(platform, accountId).allowed
  }

  /**
   * 获取还需等待时间（已含抖动；日配额命中时为 0，应改用 msUntilNextDay()）
   * @returns {number} 剩余等待时间 (ms)，0 表示可以发布
   */
  getRemainingWait (platform, accountId) {
    return this.check(platform, accountId).remainingMs
  }

  /**
   * 记录一次发布：两档同时占位 + 日计数递增。
   *
   * 必须在**提交给执行器之前**调用。平台侧限流窗口按「请求已发生」计时，
   * 若只在成功路径记账，则「已发到平台但应用判失败/超时」不占窗口，
   * 重试会重复发布且下一次提交不受限。
   *
   * @param {string} platform
   * @param {string} [accountId]
   * @param {number} [timestamp] - 时间戳 (ms)，默认取注入时钟
   * @returns {{at: number, accountKey: (string|null), platformKey: string,
   *            accountPrev: (number|null), platformPrev: (number|null),
   *            dailyPrev: (number|null), dayKey: string}}
   *   占位前值必须保存并回传给 release()（结构锁断言其被消费）
   */
  recordPublish (platform, accountId, timestamp) {
    const at = timestamp ?? this._now()
    const dayKey = this.today()
    const normalizedAccount = normalizeAccountId(accountId)
    const platformKey = this._key(platform, null)
    const accountKey = normalizedAccount ? this._key(platform, normalizedAccount) : null

    const platformPrev = this._store.get(platformKey)
    const accountPrev = accountKey ? this._store.get(accountKey) : null
    let dailyPrev = null

    if (accountKey) {
      this._store.set(accountKey, at)
      const row = this._readDaily(accountKey, dayKey)
      dailyPrev = row.count
      this._incrDaily(accountKey, dayKey, 'count', 1)
    }
    this._store.set(platformKey, at)

    return { at, accountKey, platformKey, accountPrev, platformPrev, dailyPrev, dayKey }
  }

  /**
   * 回滚一次**未提交**尝试所占的窗口与配额（P0-1）。三条纪律任一不成立即 no-op，方向恒为「多等」：
   *   ① 乐观并发：仅当 store.get(key) === hold.at 才回滚该键 —— 绝不回滚他人窗口；
   *   ② hold 必须由 recordPublish() 返回并回传；缺失/错配 ⇒ no-op + 出声；
   *   ③ 防风上限：当日回滚次数 >= `_rollbackCap()` 时拒绝（该上限带硬顶，不随日配额放大）。
   * 副作用：配额计数幂等回补（下限 0）；回滚计数只增不减。
   * @returns {{released: boolean, reason: (null|'prev_missing'|'window_taken'|'rollback_cap')}}
   */
  release (platform, accountId, hold) {
    const dayKey = this.today()
    const normalizedAccount = normalizeAccountId(accountId)
    const accountKey = normalizedAccount ? this._key(platform, normalizedAccount) : null
    const platformKey = this._key(platform, null)

    if (!hold || typeof hold.at !== 'number') {
      this._warn('[PublishFrequency] release 缺少 recordPublish 返回的 hold，已忽略（窗口保持占用）')
      return { released: false, reason: 'prev_missing' }
    }

    // ③ 防风上限（回滚计数只增不减）
    if (accountKey && this._dailyStore) {
      const cap = this._rollbackCap(platform)
      const row = this._readDaily(accountKey, dayKey)
      if (cap > 0 && row.rollbackCount >= cap) {
        this._warn(
          `[PublishFrequency] 账号 ${accountKey} 当日回滚已达上限 ${cap}，本次不回滚（窗口保持占用）`
        )
        return { released: false, reason: 'rollback_cap' }
      }
    }

    let released = false

    // ① 账号键
    if (accountKey && hold.accountKey === accountKey) {
      if (this._store.get(accountKey) === hold.at) {
        this._store.set(accountKey, hold.accountPrev ?? null)
        released = true
      }
    }

    // ① 平台键（独立判定：可能已被后续提交覆盖）
    if (this._store.get(platformKey) === hold.at) {
      this._store.set(platformKey, hold.platformPrev ?? null)
      released = true
    }

    if (!released) {
      return { released: false, reason: 'window_taken' }
    }

    // ② 配额回补（幂等：只在真正回滚后执行）+ 回滚计数只增
    if (accountKey && this._dailyStore) {
      this._incrDaily(accountKey, dayKey, 'count', -1)
      this._incrDaily(accountKey, dayKey, 'rollback_count', 1)
    }

    return { released: true, reason: null }
  }

  /**
   * 人为清空某平台当前占用的间隔窗口（**紧急放行专用**，唯一调用方是 task-queue 的
   * emergencyRelease，且必须已经过每日上限 + 冷却 + 审计三道闸）。
   *
   * ⚠️ 副作用范围：会同时清掉**平台键**（`platform:*`），即该平台**其他账号**的跨账号
   * 保护也会随之失效一次。这是刻意的：只清账号键的话，平台键仍会把本次紧急放行挡住，
   * 功能等于没实现。代价由「每账号每日 1 次 + 冷却 + 追加式审计」共同约束。
   *
   * @param {string} platform
   * @param {string} [accountId]
   * @returns {{cleared: boolean, clearedKeys: string[]}}
   */
  clearWindow (platform, accountId) {
    const normalizedAccount = normalizeAccountId(accountId)
    const accountKey = normalizedAccount ? this._key(platform, normalizedAccount) : null
    const platformKey = this._key(platform, null)
    const clearedKeys = []

    if (accountKey && this._store.get(accountKey) != null) {
      this._store.set(accountKey, null)
      clearedKeys.push(accountKey)
    }
    if (this._store.get(platformKey) != null) {
      this._store.set(platformKey, null)
      clearedKeys.push(platformKey)
    }

    return { cleared: clearedKeys.length > 0, clearedKeys }
  }

  /** 回滚许可上限：`max(2, …)` 让低配额平台至少纠错两次，`min(…, 硬顶)` 让日配额被放大时
   *  许可数不跟着放大（方向恒为"多等"）；`dailyMax=0` 时结果仍是 2。 */
  _rollbackCap (platform) {
    const { accountDailyMax } = this._intervals(platform)
    return Math.min(Math.max(2, accountDailyMax), MAX_ROLLBACK_PER_DAY)
  }
}

PublishIntervalGuard.InMemoryStore = InMemoryStore
PublishIntervalGuard.InMemoryDailyStore = InMemoryDailyStore
PublishIntervalGuard.PLATFORM_BUCKET_ACCOUNT_ID = PLATFORM_BUCKET_ACCOUNT_ID
PublishIntervalGuard.buildKey = buildKey
PublishIntervalGuard.TIMER_SAFE_MS = TIMER_SAFE_MS
PublishIntervalGuard.MAX_ROLLBACK_PER_DAY = MAX_ROLLBACK_PER_DAY

module.exports = PublishIntervalGuard
module.exports.buildKey = buildKey
module.exports.normalizeAccountId = normalizeAccountId
module.exports.InMemoryStore = InMemoryStore
module.exports.InMemoryDailyStore = InMemoryDailyStore
module.exports.PLATFORM_BUCKET_ACCOUNT_ID = PLATFORM_BUCKET_ACCOUNT_ID
module.exports.MAX_ROLLBACK_PER_DAY = MAX_ROLLBACK_PER_DAY
// 曾导出 PLATFORM_BUCKET_DAILY_KEY_PREFIX = 'platform-daily'（v2 起的"平台级日配额"设想）。
// 该前缀**从未被任何代码路径产出**（日计数只在 `if (accountKey)` 分支里写），平台级配额也
// 无数值来源、无 env 名、无设置页入口 ⇒ 已删除；留着只会让下一个会话以为存在这条通道并照着接线。
// 回归锁见 `tests/publish-interval-guard.test.js` 的「没有『平台级日配额』这回事」。
