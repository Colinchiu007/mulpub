/**
 * 发布最小间隔策略 — 单一真源
 *
 * 两档维度：
 *   accountMinMs  —— 同一账号在同一平台两次发布的最小间隔（键 platform:accountId）
 *   platformMinMs —— 同一平台任意两次发布的最小间隔（键 platform:*，跨账号）
 *
 * ⚠️ 下表数值是**工程保守默认**（宁慢不险），不是平台官方规则。
 * 平台若调整节奏，改这一处；禁止在调用方另抄一份。
 * 未登记的平台回落 BASELINE_INTERVALS（最严档），不得回落 0。
 */

const MIN = 60 * 1000

const PLATFORM_FREQUENCY_POLICY = Object.freeze({
  // 长文低频：一天几条即属异常
  wechat_mp: Object.freeze({ accountMinMs: 60 * MIN, platformMinMs: 5 * MIN }),
  zhihu: Object.freeze({ accountMinMs: 60 * MIN, platformMinMs: 5 * MIN }),
  baijiahao: Object.freeze({ accountMinMs: 60 * MIN, platformMinMs: 5 * MIN }),
  toutiao: Object.freeze({ accountMinMs: 60 * MIN, platformMinMs: 5 * MIN }),

  // 短视频 / 图文社区
  douyin: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),
  kuaishou: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),
  tencent_video: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),
  xiaohongshu: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),
  bilibili: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),
  youtube: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),
  tiktok: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),
  instagram: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),
  facebook: Object.freeze({ accountMinMs: 30 * MIN, platformMinMs: 3 * MIN }),

  // 短内容、高频容忍
  weibo: Object.freeze({ accountMinMs: 10 * MIN, platformMinMs: 1 * MIN }),
  twitter: Object.freeze({ accountMinMs: 10 * MIN, platformMinMs: 1 * MIN }),
})

const BASELINE_INTERVALS = Object.freeze({
  accountMinMs: 60 * MIN,
  platformMinMs: 5 * MIN,
})

const ENV_ACCOUNT_MIN_INTERVAL = 'MP_PUBLISH_MIN_INTERVAL_MS'
const ENV_PLATFORM_MIN_INTERVAL = 'MP_PUBLISH_PLATFORM_MIN_INTERVAL_MS'

const SUPPORTED_PLATFORMS = Object.freeze(Object.keys(PLATFORM_FREQUENCY_POLICY))

/**
 * 解析一个环境变量间隔值。
 * 未设置 → 回落 fallback；`0` → 显式关闭该档；非法（非有限数 / 负数 / 空白）
 * → 回落 fallback **并出声**（静默当 0 等于把配置写错变成关掉门禁）。
 */
function parseEnvInterval (raw, envName, fallback, warn) {
  if (raw === undefined || raw === null) return fallback
  const text = String(raw).trim()
  if (!text) {
    warn(`[PublishFrequency] 环境变量 ${envName} 为空白值，回落默认 ${fallback}ms`)
    return fallback
  }
  const num = Number(text)
  if (!Number.isFinite(num) || num < 0) {
    warn(`[PublishFrequency] 环境变量 ${envName}="${raw}" 非法（需 >=0 的有限数），回落默认 ${fallback}ms`)
    return fallback
  }
  return Math.floor(num)
}

/**
 * @param {string} platform - 平台标识；未登记或非法值一律回落最严基线
 * @param {{env?: Record<string,string|undefined>, warn?: (msg: string) => void}} [options]
 * @returns {{accountMinMs: number, platformMinMs: number}}
 */
function resolveIntervals (platform, options = {}) {
  const env = options.env || process.env
  const warn = typeof options.warn === 'function' ? options.warn : (msg) => console.warn(msg)
  const base = PLATFORM_FREQUENCY_POLICY[platform] || BASELINE_INTERVALS
  return {
    accountMinMs: parseEnvInterval(env[ENV_ACCOUNT_MIN_INTERVAL], ENV_ACCOUNT_MIN_INTERVAL, base.accountMinMs, warn),
    platformMinMs: parseEnvInterval(env[ENV_PLATFORM_MIN_INTERVAL], ENV_PLATFORM_MIN_INTERVAL, base.platformMinMs, warn),
  }
}

module.exports = {
  resolveIntervals,
  PLATFORM_FREQUENCY_POLICY,
  BASELINE_INTERVALS,
  SUPPORTED_PLATFORMS,
  ENV_ACCOUNT_MIN_INTERVAL,
  ENV_PLATFORM_MIN_INTERVAL,
}
