/**
 * 发布频率策略 — 单一真源（v4）
 *
 * 三个维度：
 *   accountMinMs    —— 同一账号在同一平台两次发布的最小间隔（键 platform:accountId）
 *   platformMinMs   —— 同一平台任意两次发布的最小间隔（键 platform:*）。v4 起三档统一 1 分钟，
 *                      且恒 ≤ 各档 accountMinMs ⇒ **同账号时永远由账号档决定，跨账号时由本档兜底**；
 *                      它只防一件事：同一台机器/同一出口 IP 下不同号在同一平台并行被关联。
 *   accountDailyMax —— 同一账号在同一平台的每日提交上限（本机运营日，见 guard）
 *
 * ⚠️ 下表数值是**工程保守默认**，不是平台官方规则，本工具不声称符合任何平台官方规定。
 * 依据与自认弱点见 01-docs/PRD-PUBLISH-FREQUENCY-V4-2026-10-15.md §3–§5。
 * 平台若调整节奏，改这一处；禁止在调用方另抄一份。
 * 未登记的平台回落 BASELINE_INTERVALS（最严档），不得回落 0。
 *
 * v4 相对 v3 的变更（change: publish-frequency-policy-v4）：
 *   - 平台档三级 **统一成 1′**（3′/2′/1′ → 1′）：分级撤掉，机制保留 —— 删掉整条会撤掉
 *     唯一防"同机多号被平台关联"的闸，而那种故障本地无任何信号（表现为莫名掉登录/发不出去）。
 *   - 日配额 30/50/200 → **200/350/500**（用户口径"最低 200、最高 500"，档间单调保持）。
 *     长文由 30 抬到 200，是 6.7× 放松 —— 因此"节奏仍分档"这件事此后**只由 accountMinMs 承载**。
 *   - 回滚硬顶不变：`min(max(2, dailyMax), MAX_ROLLBACK_PER_DAY=5)` 在三档下均为 5
 *     （由行为锁实测，不从公式推断）。
 *
 * v3 相对 v2 的变更（change: publish-frequency-policy-v3）：
 *   - 账号档再下调：长文 20′→5′ / 短视频·图文社区 10′→3′ / 短内容 3′→1′
 *   - 平台档由「统一 2′」改为**按档分级** 3′/2′/1′（v4 又统一回 1′，见上）
 *   - 日配额取 10 倍：3/5/20 → 30/50/200（用户运营量级实测后放开，见 PRD §3）
 *   - 连带项：**「未提交失败回滚」的每日许可数不再随日配额放大**（守卫侧封顶
 *     MAX_ROLLBACK_PER_DAY）；以及 D1 —— 超时/中止竞态输掉时禁止回滚窗口。
 *     这两条不是可选优化：间隔从 20′ 收到 5′/3′/1′ 后，D1 的触发窗口提前了一个量级，
 *     而回滚许可若跟着 ×10 就等于把「防风闸」的额度写成了「配额」的函数。
 *
 * v2 相对 v1 的变更（change: publish-frequency-policy-v2）：
 *   - 数值下调：账号档 60/30/10 → 20/10/3 分钟；平台档 5/3/1 → 统一 2 分钟
 *   - 新增 tier 与 accountDailyMax（日配额维度；tier 复用既有分组，不新增分类器）
 *   - 间隔源声明上界 7 天（越界钳位并出声）：避免含抖动系数后逼近 setTimeout 上限
 *   - 未登记平台由「静默回落」改为「回落 + fallback 标记」（由守卫出声，进程内去重）
 */

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** 间隔源上界：7 天。超过它会让 wait × (1 + jitterRatio) 逼近 2^31-1（setTimeout 上限） */
const MAX_INTERVAL_MS = 7 * DAY

/** 日配额分档名（与账号档/平台档同表，避免第二套分类器） */
const TIER_LONG = 'long'
const TIER_CLIP = 'clip'
const TIER_SHORT = 'short'

/** 抖动比例默认值（合法域 [0,1)） */
const DEFAULT_JITTER_RATIO = 0.4
/** 回滚后最小退避默认值与下界（下界防「回滚即零等待」的重试风暴） */
const DEFAULT_RELEASE_GRACE_MS = 60 * 1000
const MIN_RELEASE_GRACE_MS = 10 * 1000
/** 紧急放行每日每账号上限默认值与合法域上界 */
const DEFAULT_EMERGENCY_MAX_PER_DAY = 1
const MAX_EMERGENCY_MAX_PER_DAY = 10

/**
 * 三档预设 —— 数值的**唯一**落点（v4）。
 * 平台表由本表派生，禁止再逐平台手抄数值：15 份字面量里改漏一份，
 * 表现是"某平台莫名其妙比别人严/松"，而策略表读起来每行都对。
 *
 * v4 相对 v3 的两处改动，各自的方向不同，不要当成一次统一下调：
 *   - `platformMinMs` 三档**统一 1 分钟**：机制保留、分级撤掉。它只作用在
 *     "同一平台、不同账号"这一种场景（同号并发由 TaskQueue 的通道调度串行挡住）。
 *   - `accountDailyMax` 提高并仍保持档间单调（长文最少）。间隔维度的单调没动，
 *     所以"长文比短内容慢"这条产品语义依然由 `accountMinMs` 承载，而不是配额。
 */
const TIER_PRESETS = Object.freeze({
  // 长文低频：一篇长文的运营代价高，节奏应最稳
  [TIER_LONG]: Object.freeze({ accountMinMs: 5 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 200 }),
  // 短视频 / 图文社区
  [TIER_CLIP]: Object.freeze({ accountMinMs: 3 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 350 }),
  // 短内容、高频容忍
  [TIER_SHORT]: Object.freeze({ accountMinMs: 1 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 500 }),
})

/** 平台 → 档位分组（复用 v2 的三档分类器，不新增第四档） */
const PLATFORM_TIER = Object.freeze({
  wechat_mp: TIER_LONG,
  zhihu: TIER_LONG,
  baijiahao: TIER_LONG,
  toutiao: TIER_LONG,

  douyin: TIER_CLIP,
  kuaishou: TIER_CLIP,
  tencent_video: TIER_CLIP,
  xiaohongshu: TIER_CLIP,
  bilibili: TIER_CLIP,
  youtube: TIER_CLIP,
  tiktok: TIER_CLIP,
  instagram: TIER_CLIP,
  facebook: TIER_CLIP,

  weibo: TIER_SHORT,
  twitter: TIER_SHORT,
})

const PLATFORM_FREQUENCY_POLICY = Object.freeze(
  Object.fromEntries(
    Object.entries(PLATFORM_TIER).map(([platform, tier]) => [
      platform,
      Object.freeze({ tier, ...TIER_PRESETS[tier] }),
    ])
  )
)

/**
 * 未登记平台回落的最严档（**独立常量，故意不从 TIER_PRESETS 派生**：
 * 改 long 档不应静默改变回落实质——回落必须是"人为想清楚过的最严值"）。
 * v4 下"最严"= 账号间隔取最大（5′）、平台间隔取唯一值（1′）、日配额取最小（200）；
 * 三个维度的"更严"方向不一致，回归锁 `回落基线不得弱于任何已登记平台` 逐维度分别取上/下界。
 */
const BASELINE_INTERVALS = Object.freeze({
  tier: TIER_LONG,
  accountMinMs: 5 * MIN,
  platformMinMs: 1 * MIN,
  accountDailyMax: 200,
})

const ENV_ACCOUNT_MIN_INTERVAL = 'MP_PUBLISH_MIN_INTERVAL_MS'
const ENV_PLATFORM_MIN_INTERVAL = 'MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS'
const ENV_DAILY_MAX_LONG = 'MP_PUBLISH_DAILY_MAX_LONG'
const ENV_DAILY_MAX_CLIP = 'MP_PUBLISH_DAILY_MAX_CLIP'
const ENV_DAILY_MAX_SHORT = 'MP_PUBLISH_DAILY_MAX_SHORT'
/** 全局覆盖三档日配额（设置该项即三档同值） */
const ENV_ACCOUNT_DAILY_MAX = 'MP_PUBLISH_ACCOUNT_DAILY_MAX'
const ENV_JITTER_RATIO = 'MP_PUBLISH_JITTER_RATIO'
const ENV_RELEASE_GRACE_MS = 'MP_PUBLISH_RELEASE_GRACE_MS'
const ENV_EMERGENCY_MAX_PER_DAY = 'MP_PUBLISH_EMERGENCY_MAX_PER_DAY'

const TIER_ENV = Object.freeze({
  [TIER_LONG]: ENV_DAILY_MAX_LONG,
  [TIER_CLIP]: ENV_DAILY_MAX_CLIP,
  [TIER_SHORT]: ENV_DAILY_MAX_SHORT,
})

const SUPPORTED_PLATFORMS = Object.freeze(Object.keys(PLATFORM_FREQUENCY_POLICY))

function isKnownPlatform (platform) {
  return typeof platform === 'string' && Object.prototype.hasOwnProperty.call(PLATFORM_FREQUENCY_POLICY, platform)
}

function warnSink (options) {
  return typeof options.warn === 'function' ? options.warn : (msg) => console.warn(msg)
}

/** 取第一个「已设置」的值（`0` 是合法值，不得用 || 兜底） */
function pick (...values) {
  for (const v of values) {
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/**
 * 解析一个环境变量数值。
 * 未设置 → 回落 fallback；`0` → 显式关闭/归零；非法（非有限数 / 负数 / 空白 / 非整数）
 * → 回落 fallback **并出声**（静默当 0 等于把配置写错变成关掉门禁）；超上界 → 钳位并出声。
 *
 * @param {string|number|undefined|null} raw
 * @param {string} envName
 * @param {number} fallback
 * @param {(msg: string) => void} warn
 * @param {{ integer?: boolean, max?: number }} [bounds]
 */
function parseEnvNumber (raw, envName, fallback, warn, bounds = {}) {
  if (raw === undefined || raw === null) return fallback
  const text = String(raw).trim()
  if (!text) {
    warn(`[PublishFrequency] 环境变量 ${envName} 为空白值，回落默认 ${fallback}`)
    return fallback
  }
  const num = Number(text)
  if (!Number.isFinite(num) || num < 0) {
    warn(`[PublishFrequency] 环境变量 ${envName}="${raw}" 非法（需 >=0 的有限数），回落默认 ${fallback}`)
    return fallback
  }
  if (bounds.integer && !Number.isInteger(num)) {
    warn(`[PublishFrequency] 环境变量 ${envName}="${raw}" 非法（需整数），回落默认 ${fallback}`)
    return fallback
  }
  if (bounds.max !== undefined && num > bounds.max) {
    warn(`[PublishFrequency] 环境变量 ${envName}="${raw}" 超出上界 ${bounds.max}，已钳位到上界`)
    return bounds.max
  }
  return bounds.integer ? num : Math.floor(num)
}

/** 兼容旧名：间隔解析（非整数按 floor，与 v1 语义一致；带上界钳位） */
function parseEnvInterval (raw, envName, fallback, warn) {
  return parseEnvNumber(raw, envName, fallback, warn, { max: MAX_INTERVAL_MS })
}

/**
 * 解析某平台的完整策略。
 *
 * 优先级：设置页覆盖 > 环境变量 > 策略表；未登记平台回落最严基线并置 `fallback: true`
 * （由守卫出声告警，进程内按平台去重）。
 *
 * @param {string} platform - 平台标识；未登记或非法值一律回落最严基线
 * @param {{env?: Record<string,string|undefined>, warn?: (msg: string) => void, overrides?: object}} [options]
 * @returns {{tier: string, accountMinMs: number, platformMinMs: number, accountDailyMax: number, fallback: boolean}}
 */
function resolveIntervals (platform, options = {}) {
  const env = options.env || process.env
  const warn = warnSink(options)
  const fallback = !isKnownPlatform(platform)
  const base = fallback ? BASELINE_INTERVALS : PLATFORM_FREQUENCY_POLICY[platform]
  const ov = options.overrides || {}

  const accountMinMs = parseEnvInterval(
    pick(ov.accountMinMs, env[ENV_ACCOUNT_MIN_INTERVAL]), ENV_ACCOUNT_MIN_INTERVAL, base.accountMinMs, warn
  )
  const platformMinMs = parseEnvInterval(
    pick(ov.platformMinMs, env[ENV_PLATFORM_MIN_INTERVAL]), ENV_PLATFORM_MIN_INTERVAL, base.platformMinMs, warn
  )

  // 日配额：全局覆盖 > 设置页覆盖 > 本档 env > 策略表
  const tier = base.tier
  const globalRaw = pick(ov.accountDailyMax, env[ENV_ACCOUNT_DAILY_MAX])
  const useGlobal = globalRaw !== undefined
  const tierEnvName = TIER_ENV[tier]
  const raw = useGlobal ? globalRaw : pick(ov.dailyMax && ov.dailyMax[tier], env[tierEnvName])
  const accountDailyMax = parseEnvNumber(
    raw,
    useGlobal ? ENV_ACCOUNT_DAILY_MAX : tierEnvName,
    base.accountDailyMax,
    warn,
    { integer: true }
  )

  return { tier, accountMinMs, platformMinMs, accountDailyMax, fallback }
}

/**
 * 解析抖动比例：`[0, 1)` 有限数；`0` = 关闭抖动（严格退化为 v1 行为）。
 * @param {{env?: object, warn?: Function, overrides?: object}} [options]
 */
function resolveJitterRatio (options = {}) {
  const env = options.env || process.env
  const warn = warnSink(options)
  const ov = options.overrides || {}
  const raw = pick(ov.jitterRatio, env[ENV_JITTER_RATIO])
  if (raw === undefined) return DEFAULT_JITTER_RATIO
  const text = String(raw).trim()
  if (!text) {
    warn(`[PublishFrequency] 环境变量 ${ENV_JITTER_RATIO} 为空白值，回落默认 ${DEFAULT_JITTER_RATIO}`)
    return DEFAULT_JITTER_RATIO
  }
  const num = Number(text)
  if (!Number.isFinite(num) || num < 0 || num >= 1) {
    warn(`[PublishFrequency] 环境变量 ${ENV_JITTER_RATIO}="${raw}" 非法（需 [0,1) 的有限数），回落默认 ${DEFAULT_JITTER_RATIO}`)
    return DEFAULT_JITTER_RATIO
  }
  return num
}

/**
 * 解析回滚后最小退避：整数；低于下界 10s 钳位并出声（防回滚即零等待的重试风暴）。
 * @param {{env?: object, warn?: Function, overrides?: object}} [options]
 */
function resolveReleaseGraceMs (options = {}) {
  const env = options.env || process.env
  const warn = warnSink(options)
  const ov = options.overrides || {}
  const raw = pick(ov.releaseGraceMs, env[ENV_RELEASE_GRACE_MS])
  if (raw === undefined) return DEFAULT_RELEASE_GRACE_MS
  const text = String(raw).trim()
  if (!text) {
    warn(`[PublishFrequency] 环境变量 ${ENV_RELEASE_GRACE_MS} 为空白值，回落默认 ${DEFAULT_RELEASE_GRACE_MS}`)
    return DEFAULT_RELEASE_GRACE_MS
  }
  const num = Number(text)
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
    warn(`[PublishFrequency] 环境变量 ${ENV_RELEASE_GRACE_MS}="${raw}" 非法（需 >=0 整数），回落默认 ${DEFAULT_RELEASE_GRACE_MS}`)
    return DEFAULT_RELEASE_GRACE_MS
  }
  if (num < MIN_RELEASE_GRACE_MS) {
    warn(`[PublishFrequency] 环境变量 ${ENV_RELEASE_GRACE_MS}="${raw}" 低于下界 ${MIN_RELEASE_GRACE_MS}，已钳位到该下界`)
    return MIN_RELEASE_GRACE_MS
  }
  return num
}

/**
 * 解析紧急放行每日每账号上限：整数 `[0, 10]`；`0` = 关闭该入口。
 * @param {{env?: object, warn?: Function, overrides?: object}} [options]
 */
function resolveEmergencyMaxPerDay (options = {}) {
  const env = options.env || process.env
  const warn = warnSink(options)
  const ov = options.overrides || {}
  const raw = pick(ov.emergencyMaxPerDay, env[ENV_EMERGENCY_MAX_PER_DAY])
  return parseEnvNumber(raw, ENV_EMERGENCY_MAX_PER_DAY, DEFAULT_EMERGENCY_MAX_PER_DAY, warn, {
    integer: true,
    max: MAX_EMERGENCY_MAX_PER_DAY,
  })
}

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

  const intKeys = [
    ['accountDailyMax', 0, undefined],
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
      if (!Number.isInteger(n) || n < 0) {
        bad(`dailyMax.${tier}`, v, '需 >=0 的整数')
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

module.exports = {
  resolveIntervals,
  resolveJitterRatio,
  resolveReleaseGraceMs,
  resolveEmergencyMaxPerDay,
  resolvePolicyOverrides,
  isKnownPlatform,
  parseEnvNumber,
  PLATFORM_FREQUENCY_POLICY,
  BASELINE_INTERVALS,
  SUPPORTED_PLATFORMS,
  MAX_INTERVAL_MS,
  DEFAULT_JITTER_RATIO,
  DEFAULT_RELEASE_GRACE_MS,
  MIN_RELEASE_GRACE_MS,
  DEFAULT_EMERGENCY_MAX_PER_DAY,
  MAX_EMERGENCY_MAX_PER_DAY,
  TIER_LONG,
  TIER_CLIP,
  TIER_SHORT,
  ENV_ACCOUNT_MIN_INTERVAL,
  ENV_PLATFORM_MIN_INTERVAL,
  ENV_DAILY_MAX_LONG,
  ENV_DAILY_MAX_CLIP,
  ENV_DAILY_MAX_SHORT,
  ENV_ACCOUNT_DAILY_MAX,
  ENV_JITTER_RATIO,
  ENV_RELEASE_GRACE_MS,
  ENV_EMERGENCY_MAX_PER_DAY,
}
