/**
 * 发布频率控制 — 两档最小间隔守卫
 *
 * 两档维度（间隔值由 publish-frequency-policy 单一持有，本文件不抄数值）：
 *   account  档：键 `${platform}:${accountId}`   —— 同一账号在同一平台连发
 *   platform 档：键 `${platform}:*`              —— 同一平台任意两次发布（跨账号）
 *
 * accountId 缺席时账号档跳过、平台档仍生效：「没有账号身份」不等于「没有发布行为」。
 * 可插拔存储（默认 InMemoryStore，桌面端替换为 SQLite publish_timeline）。
 */
const { resolveIntervals } = require('./publish-frequency-policy')

/** 平台档桶的哨兵 accountId；导出供装配与测试引用，禁止各处手抄 '*' */
const PLATFORM_BUCKET_ACCOUNT_ID = '*'

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

function normalizeAccountId (accountId) {
  if (typeof accountId !== 'string') return null
  const trimmed = accountId.trim()
  return trimmed || null
}

class PublishIntervalGuard {
  /**
   * @param {object} [options]
   * @param {number} [options.minInterval] - 两档统一覆盖（主要供测试与旧调用方使用）
   * @param {(platform: string) => {accountMinMs: number, platformMinMs: number}} [options.policy]
   *   按平台解析间隔；缺省用 publish-frequency-policy
   * @param {object} [options.store] - 外部存储 { get(key), set(key, value) }
   * @param {() => number} [options.now] - 时钟注入，便于确定性测试
   */
  constructor (options = {}) {
    this._minInterval = Number.isFinite(options.minInterval) && options.minInterval >= 0
      ? options.minInterval
      : null
    this._policy = typeof options.policy === 'function' ? options.policy : resolveIntervals
    this._store = options.store || new InMemoryStore()
    this._now = typeof options.now === 'function' ? options.now : () => Date.now()
  }

  /**
   * 内部 key：platform + accountId 组合
   */
  _key (platform, accountId) {
    return `${platform}:${accountId}`
  }

  _intervals (platform) {
    if (this._minInterval !== null) {
      return { accountMinMs: this._minInterval, platformMinMs: this._minInterval }
    }
    const resolved = this._policy(platform) || {}
    return {
      accountMinMs: Number(resolved.accountMinMs) || 0,
      platformMinMs: Number(resolved.platformMinMs) || 0,
    }
  }

  _remaining (key, minInterval, now) {
    if (!(minInterval > 0)) return 0
    const lastTime = this._store.get(key)
    if (!lastTime) return 0
    return Math.max(0, minInterval - (now - lastTime))
  }

  /**
   * 评估两档间隔，返回被更严一档决定的等待时间。
   * @returns {{allowed: boolean, remainingMs: number, bucket: ('account'|'platform'|null)}}
   */
  check (platform, accountId) {
    const now = this._now()
    const { accountMinMs, platformMinMs } = this._intervals(platform)
    const normalizedAccount = normalizeAccountId(accountId)

    let remainingMs = 0
    let bucket = null

    if (normalizedAccount) {
      const r = this._remaining(this._key(platform, normalizedAccount), accountMinMs, now)
      if (r > 0) {
        remainingMs = r
        bucket = 'account'
      }
    }

    const platformRemaining = this._remaining(
      this._key(platform, PLATFORM_BUCKET_ACCOUNT_ID), platformMinMs, now
    )
    if (platformRemaining > remainingMs) {
      remainingMs = platformRemaining
      bucket = 'platform'
    }

    return { allowed: remainingMs <= 0, remainingMs, bucket }
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
   * 获取还需等待时间
   * @param {string} platform - 平台标识
   * @param {string} [accountId] - 账号 ID
   * @returns {number} 剩余等待时间 (ms)，0 表示可以发布
   */
  getRemainingWait (platform, accountId) {
    return this.check(platform, accountId).remainingMs
  }

  /**
   * 记录一次发布：两档同时占位。
   *
   * 必须在**提交给执行器之前**调用。平台侧限流窗口按「请求已发生」计时，
   * 若只在成功路径记账，则「已发到平台但应用判失败/超时」不占窗口，
   * 重试会重复发布且下一次提交不受限。
   *
   * @param {string} platform - 平台标识
   * @param {string} [accountId] - 账号 ID
   * @param {number} [timestamp] - 时间戳 (ms)，默认取注入时钟
   */
  recordPublish (platform, accountId, timestamp) {
    const at = timestamp ?? this._now()
    const normalizedAccount = normalizeAccountId(accountId)
    if (normalizedAccount) {
      this._store.set(this._key(platform, normalizedAccount), at)
    }
    this._store.set(this._key(platform, PLATFORM_BUCKET_ACCOUNT_ID), at)
  }
}

PublishIntervalGuard.InMemoryStore = InMemoryStore
PublishIntervalGuard.PLATFORM_BUCKET_ACCOUNT_ID = PLATFORM_BUCKET_ACCOUNT_ID
module.exports = PublishIntervalGuard
