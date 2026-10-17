/**
 * 逐平台「同账号最小发布间隔」（v5，change: publish-frequency-per-platform-intervals）
 *
 * 为什么单独一个文件：策略模块 `publish-frequency-policy.js` 超过了逐文件行数门禁的上界，
 * 而这一维恰好可以独立内聚（默认表 + env 解析 + 五级优先级链 + 设置页校验）。
 * 依赖一律由工厂参数注入，**本模块不 require 策略模块** —— 否则成环，
 * 而策略模块的账号档正是由本模块提供。
 * 对外仍从策略模块**同名再导出**，公开面与调用点零变化（回归锁一律走原入口）。
 *
 * 取值依据与"暂定"标注的纪律见 01-docs/PRD-PUBLISH-FREQUENCY-V5-2026-10-16.md §2。
 */

const MIN = 60 * 1000

/**
 * 同账号最小发布间隔的**逐平台默认表**（毫秒）—— 该维度唯一的数值真源（v5）。
 *
 * 为什么从「按档位派生」改成「逐平台字面量」：档位把 15 个平台压成三档，于是「只想收紧视频号」
 * 要么连带改整档、要么在代码里写平台分支 —— 后者正是本模块要消灭的「同一个量抄成多份」。
 * 差异化从此只落在这张表里：**任何平台收紧或放宽＝改这一行数据，不动分类器、不动控制流。**
 * 档位仍承载 platformMinMs 与 accountDailyMax（这两维确实没有逐平台差异需求）。
 *
 * 取值依据如实标注：
 *   - 公开渠道**没有**任何平台给出「两次发布必须间隔 N 分钟」的量化规则；
 *   - 视频号 60 分钟是**产品决策**，依据是公开运营口径的「日发上限按粉丝量分级
 *     （千粉 1 条／万粉 2 条／万粉以上 ≤5 条）、超出限制直接限流」，不是平台公布的阈值；
 *   - 其余 14 个平台 = 各自档位现行值，**行为零变化**，由回归锁
 *     「偏离集合恰好等于 [tencent_video]」钉住，防止顺手调数值混进同一次改动。
 */
const PLATFORM_ACCOUNT_MIN_INTERVAL_MS = Object.freeze({
  tencent_video: 60 * MIN, // 视频号：唯一偏离档位的平台（60 分钟，产品决策）
  wechat_mp: 5 * MIN, // 以下均为暂定：沿用各自档位现行值，未取到官方量化口径
  zhihu: 5 * MIN,
  baijiahao: 5 * MIN,
  toutiao: 5 * MIN,
  douyin: 3 * MIN,
  kuaishou: 3 * MIN,
  xiaohongshu: 3 * MIN,
  bilibili: 3 * MIN,
  youtube: 3 * MIN,
  tiktok: 3 * MIN,
  instagram: 3 * MIN,
  facebook: 3 * MIN,
  weibo: 1 * MIN,
  twitter: 1 * MIN,
})

/** 逐平台账号间隔的 env 覆盖入口：一条 JSON，不设 15 个变量（PRD v5 §4）。 */
const ENV_ACCOUNT_MIN_INTERVAL_JSON = 'MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON'

/**
 * 账号间隔的解析器工厂。依赖由策略模块注入：
 * 函数依赖靠声明提升可在定义之前拿到；基线值用 getter 传，避开模块加载期的暂时性死区。
 *
 * @param {{isKnownPlatform: Function, pick: Function, parseEnvInterval: Function, warnSink: Function,
 *          MAX_INTERVAL_MS: number, ENV_ACCOUNT_MIN_INTERVAL: string,
 *          getBaselineAccountMinMs: () => number}} deps
 */
function createAccountIntervalApi (deps) {
  const isKnownPlatform = deps.isKnownPlatform
  const pick = deps.pick
  const parseEnvInterval = deps.parseEnvInterval
  const warnSink = deps.warnSink
  const MAX_INTERVAL_MS = deps.MAX_INTERVAL_MS
  const ENV_ACCOUNT_MIN_INTERVAL = deps.ENV_ACCOUNT_MIN_INTERVAL
  const getBaselineAccountMinMs = deps.getBaselineAccountMinMs

  /**
   * 解析逐平台账号间隔的 env JSON 覆盖（`MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON`）。
   *
   * 两档严格度（PRD v5 §4，刻意不同口径）：
   *   - **值非法**（非有限数 / <0）⇒ 整条作废并出声：不做「一半生效」，
   *     否则用户会看到「改了 A 却影响了 B」这种不可解释的行为；
   *   - **平台键未知** ⇒ 忽略该键 + `warn` 点名：不得因此作废整条
   *     （拼错一个平台名不该让其他 14 个平台失去配置）。
   *   超上界按既有间隔语义**钳位**并出声（钳位不作废）。
   * 未设置 / 空串 / 全部键被忽略 ⇒ 返回 null（视为缺席，落到下一级），绝不抛错打断发布链。
   *
   * @param {Record<string, string|undefined>} env
   * @param {(msg: string) => void} warn
   * @returns {Record<string, number> | null}
   */
  function parseAccountMinIntervalEnv (env, warn) {
    const raw = env[ENV_ACCOUNT_MIN_INTERVAL_JSON]
    if (raw === undefined || raw === null) return null
    const text = String(raw).trim()
    if (!text) return null
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 不是合法 JSON，整条作废、全部平台回落默认表：' + (err && err.message ? err.message : err))
      return null
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 需对象 { "<platform>": ms }，整条作废、全部平台回落默认表')
      return null
    }
    const map = {}
    let ignoredUnknown = 0
    for (const entry of Object.entries(parsed)) {
      const platform = entry[0]
      const value = entry[1]
      if (value === undefined || value === null) continue
      if (!isKnownPlatform(platform)) {
        ignoredUnknown += 1
        warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 含未知平台 ' + JSON.stringify(platform) + '，已忽略该键')
        continue
      }
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) {
        warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 的 ' + platform + '=' + JSON.stringify(value) + ' 非法（需 >=0 的有限数），整条作废、全部平台回落默认表')
        return null
      }
      if (n > MAX_INTERVAL_MS) {
        warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 的 ' + platform + '=' + n + ' 超出上界 ' + MAX_INTERVAL_MS + '，已钳位到上界')
        map[platform] = MAX_INTERVAL_MS
        continue
      }
      map[platform] = Math.floor(n)
    }
    if (Object.keys(map).length === 0) {
      if (ignoredUnknown > 0) {
        warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 的全部键都不是已支持平台，视为未配置')
      }
      return null
    }
    return map
  }

  /**
   * 解析「同一账号在同一平台的最小发布间隔」—— v5 起这是**逐平台**维度，不再由档位派生。
   *
   * 优先级链（细粒度必须赢粗粒度，PRD v5 §3）：
   *   1. 设置页平台专属覆盖  overrides.accountMinMsByPlatform[platform]
   *   2. 设置页全局覆盖      overrides.accountMinMs
   *   3. env 平台专属        MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON[platform]
   *   4. env 全局            MP_PUBLISH_MIN_INTERVAL_MS
   *   5. 逐平台表默认        PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform]（未登记平台回落基线）
   *
   * ⛔ 本函数**不得**调用 resolveIntervals：resolveIntervals 的账号档正是由本函数提供，
   *    互相调用即无限递归（回归锁「两个解析函数不得互相调用」以 RangeError 形式抓住）。
   *
   * @param {string} platform
   * @param {{env?: object, warn?: Function, overrides?: object}} [options]
   * @returns {number} 毫秒；0 = 显式关闭该档
   */
  function resolveAccountMinIntervalMs (platform, options = {}) {
    const env = options.env || process.env
    const warn = warnSink(options)
    const ov = options.overrides || {}
    const known = isKnownPlatform(platform)
    const tableDefault = known ? PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform] : getBaselineAccountMinMs()

    // 1 设置页平台专属：值已由 resolvePolicyOverrides 校验过，这里只按「键是否存在」取用。
    //    键存在但值非法（上游作废后不该出现）时出声并继续走链，不得静默吞成 tableDefault。
    const byPlatform = ov.accountMinMsByPlatform
    if (byPlatform && typeof byPlatform === 'object' &&
        Object.prototype.hasOwnProperty.call(byPlatform, platform) &&
        byPlatform[platform] !== undefined && byPlatform[platform] !== null) {
      const n = Number(byPlatform[platform])
      if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), MAX_INTERVAL_MS)
      warn('[PublishFrequency] 设置页账号间隔覆盖 ' + platform + '=' + JSON.stringify(byPlatform[platform]) + ' 非法，已忽略该覆盖')
    }

    // 3 env 平台专属 赢 4 env 全局（同一条 env 内部优先），但两者都让位于 2 设置页全局覆盖。
    const envJson = parseAccountMinIntervalEnv(env, warn)
    const envPlatform = envJson ? envJson[platform] : undefined
    const globalRaw = pick(ov.accountMinMs, envPlatform, env[ENV_ACCOUNT_MIN_INTERVAL])
    return parseEnvInterval(globalRaw, ENV_ACCOUNT_MIN_INTERVAL, tableDefault, warn)
  }

  return { parseAccountMinIntervalEnv, resolveAccountMinIntervalMs }
}

/**
 * 设置页 `accountMinMsByPlatform` 的校验。合法域与 env 侧**刻意不同**：
 * 这里要求整数毫秒且不钳位（界外即整体作废），沿用策略模块「全有或全无」纪律。
 *
 * 未知平台键只忽略不作废；全部键都未知 ⇒ 视为无效（不得留下空 map 被下游读成「覆盖了但值为空」）。
 * 返回值把「该报什么错」一并交回调用方，让策略模块沿用既有 `bad(name, value, why)` 文案口径。
 *
 * @param {unknown} value 原始字段值
 * @param {{isKnownPlatform: Function, MAX_INTERVAL_MS: number, warn: (msg: string) => void}} deps
 * @returns {{ok: true, map: object|null} | {ok: false, name: string, value: unknown, why: string}}
 */
function validateAccountMinMsOverride (value, deps) {
  const isKnownPlatform = deps.isKnownPlatform
  const MAX_INTERVAL_MS = deps.MAX_INTERVAL_MS
  const warn = deps.warn
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, name: 'accountMinMsByPlatform', value, why: '需对象 { <platform>: ms }' }
  }
  const map = {}
  let ignoredUnknown = 0
  for (const entry of Object.entries(value)) {
    const platform = entry[0]
    const item = entry[1]
    if (item === undefined || item === null) continue
    if (!isKnownPlatform(platform)) {
      ignoredUnknown += 1
      warn('[PublishFrequency] 设置页账号间隔覆盖含未知平台 ' + JSON.stringify(platform) + '，已忽略该键')
      continue
    }
    const n = Number(item)
    if (!Number.isInteger(n) || n < 0 || n > MAX_INTERVAL_MS) {
      return { ok: false, name: 'accountMinMsByPlatform.' + platform, value: item, why: '需 [0,' + MAX_INTERVAL_MS + '] 的整数毫秒' }
    }
    map[platform] = n
  }
  if (Object.keys(map).length === 0) {
    if (ignoredUnknown > 0) {
      return { ok: false, name: 'accountMinMsByPlatform', value, why: '全部键都不是已支持平台' }
    }
    return { ok: true, map: null }
  }
  return { ok: true, map }
}

module.exports = {
  PLATFORM_ACCOUNT_MIN_INTERVAL_MS,
  ENV_ACCOUNT_MIN_INTERVAL_JSON,
  createAccountIntervalApi,
  validateAccountMinMsOverride,
}
