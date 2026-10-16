/**
 * 设置页策略覆盖的校验（v2 起就有的一块，v5 因策略模块触发行数门禁而搬出）。
 *
 * 语义一行未改：**任一字段非法 ⇒ 整个覆盖对象作废**（返回 null）并出声，不允许部分生效；
 * 未知字段忽略（前向兼容）。v5 的逐平台账号间隔校验委托给 publish-frequency-account-interval.js，
 * 使同一维度的判据只有一份实现。
 *
 * 依赖全部由工厂参数注入：本模块不 require 策略模块（避免成环），
 * 策略模块 `publish-frequency-policy.js` 建好实例后**同名再导出** `resolvePolicyOverrides`。
 */

/**
 * @param {{warnSink: Function, MAX_INTERVAL_MS: number, MAX_DAILY_QUOTA: number,
 *          MAX_EMERGENCY_MAX_PER_DAY: number, MIN_RELEASE_GRACE_MS: number,
 *          TIER_LONG: string, TIER_CLIP: string, TIER_SHORT: string,
 *          isKnownPlatform: Function, validateAccountMinMsOverride: Function}} deps
 */
function createOverridesApi (deps) {
  const warnSink = deps.warnSink
  const MAX_INTERVAL_MS = deps.MAX_INTERVAL_MS
  const MAX_DAILY_QUOTA = deps.MAX_DAILY_QUOTA
  const MAX_EMERGENCY_MAX_PER_DAY = deps.MAX_EMERGENCY_MAX_PER_DAY
  const MIN_RELEASE_GRACE_MS = deps.MIN_RELEASE_GRACE_MS
  const TIER_LONG = deps.TIER_LONG
  const TIER_CLIP = deps.TIER_CLIP
  const TIER_SHORT = deps.TIER_SHORT
  const isKnownPlatform = deps.isKnownPlatform
  const validateAccountMinMsOverride = deps.validateAccountMinMsOverride

  /**
   * 校验设置页下发的策略覆盖对象（PRD §7.2）。
   *
   * 语义是**全有或全无**：任一字段非法 ⇒ **整个覆盖对象作废**（返回 null）并出声，
   * 不允许部分生效 —— 半生效态会让「我改了 A 却影响了 B」变成不可解释的行为。
   * 未知字段一律忽略（前向兼容：旧版本读到新字段不应整体作废）。
   *
   * @param {unknown} raw - 从 store 读回的对象（可能是 null / 字符串 / 数组 / 损坏值）
   * @param {{warn?: (msg: string) => void}} [options]
   * @returns {{accountMinMs?: number, platformMinMs?: number, accountDailyMax?: number,
   *            dailyMax?: {long?: number, clip?: number, short?: number},
   *            jitterRatio?: number, releaseGraceMs?: number, emergencyMaxPerDay?: number} | null}
   */
  function resolvePolicyOverrides (raw, options = {}) {
    const warn = warnSink(options)
    if (raw === undefined || raw === null) return null
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      warn(`[PublishFrequency] 设置页策略覆盖不是对象（${typeof raw}），已整体丢弃`)
      return null
    }

    const out = {}
    const bad = (name, value, why) => {
      warn(`[PublishFrequency] 设置页策略覆盖字段 ${name}=${JSON.stringify(value)} 非法（${why}），已整体丢弃`)
    }

    const intervalKeys = ['accountMinMs', 'platformMinMs']
    for (const key of intervalKeys) {
      if (raw[key] === undefined || raw[key] === null) continue
      const n = Number(raw[key])
      if (!Number.isFinite(n) || n < 0) {
        bad(key, raw[key], '需 >=0 的有限数')
        return null
      }
      out[key] = Math.min(Math.floor(n), MAX_INTERVAL_MS)
    }

    // v5 逐平台账号间隔覆盖：判据住 publish-frequency-account-interval.js（同一维度只一份实现），
    // 这里只负责把它交回的"该报什么错"沿用了既有 bad() 文案口径 —— 值非法整体作废、未知键只忽略。
    if (raw.accountMinMsByPlatform !== undefined && raw.accountMinMsByPlatform !== null) {
      const checked = validateAccountMinMsOverride(raw.accountMinMsByPlatform, {
        isKnownPlatform, MAX_INTERVAL_MS, warn,
      })
      if (!checked.ok) {
        bad(checked.name, checked.value, checked.why)
        return null
      }
      if (checked.map) out.accountMinMsByPlatform = checked.map
    }
    const intKeys = [
      ['accountDailyMax', 0, MAX_DAILY_QUOTA],
      ['emergencyMaxPerDay', 0, MAX_EMERGENCY_MAX_PER_DAY],
    ]
    for (const [key, min, max] of intKeys) {
      if (raw[key] === undefined || raw[key] === null) continue
      const n = Number(raw[key])
      if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
        bad(key, raw[key], max === undefined ? `需 >=${min} 的整数` : `需 [${min},${max}] 的整数`)
        return null
      }
      out[key] = n
    }

    if (raw.dailyMax !== undefined && raw.dailyMax !== null) {
      if (typeof raw.dailyMax !== 'object' || Array.isArray(raw.dailyMax)) {
        bad('dailyMax', raw.dailyMax, '需对象 {long, clip, short}')
        return null
      }
      const daily = {}
      for (const tier of [TIER_LONG, TIER_CLIP, TIER_SHORT]) {
        const v = raw.dailyMax[tier]
        if (v === undefined || v === null) continue
        const n = Number(v)
        if (!Number.isInteger(n) || n < 0 || n > MAX_DAILY_QUOTA) {
          bad(`dailyMax.${tier}`, v, `需 [0,${MAX_DAILY_QUOTA}] 的整数`)
          return null
        }
        daily[tier] = n
      }
      if (Object.keys(daily).length > 0) out.dailyMax = daily
    }

    if (raw.jitterRatio !== undefined && raw.jitterRatio !== null) {
      const n = Number(raw.jitterRatio)
      if (!Number.isFinite(n) || n < 0 || n >= 1) {
        bad('jitterRatio', raw.jitterRatio, '需 [0,1) 的有限数')
        return null
      }
      out.jitterRatio = n
    }

    if (raw.releaseGraceMs !== undefined && raw.releaseGraceMs !== null) {
      const n = Number(raw.releaseGraceMs)
      if (!Number.isInteger(n) || n < MIN_RELEASE_GRACE_MS) {
        bad('releaseGraceMs', raw.releaseGraceMs, `需 >=${MIN_RELEASE_GRACE_MS} 的整数`)
        return null
      }
      out.releaseGraceMs = n
    }

    return Object.keys(out).length > 0 ? out : null
  }

  return { resolvePolicyOverrides }
}

module.exports = { createOverridesApi }
