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
 * v5 相对 v4 的变更（change: publish-frequency-per-platform-intervals）：
 *   - **账号档改为逐平台**：新增 PLATFORM_ACCOUNT_MIN_INTERVAL_MS 作为该维度唯一数值真源，
 *     档位只管 platformMinMs 与 accountDailyMax。动机是各平台对连发的容忍度不同（视频号最严），
 *     而「为一个平台开第四档 / 写 if 分支」都会把差异化从数据面赶进控制流。
 *   - 视频号 3′ → **60′**（产品决策，非平台公布值；公开渠道没有任何平台给出量化间隔）。
 *     其余 14 个平台生效值逐字节不变，由「偏离集合 == [tencent_video]」锁钉住。
 *   - 新增覆盖入口：设置页 accountMinMsByPlatform（对象）与 env
 *     MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON（一条 JSON，不设 15 个变量）。
 *     优先级：设置页平台专属 > 设置页全局 > env 平台专属 > env 全局 > 逐平台表默认。
 * * v4 相对 v3 的变更（change: publish-frequency-policy-v4）：
 *   - 平台档三级 **统一成 1′**（3′/2′/1′ → 1′）：分级撤掉，机制保留 —— 删掉整条会撤掉
 *     唯一防"同机多号被平台关联"的闸，而那种故障本地无任何信号（表现为莫名掉登录/发不出去）。
 *   - 日配额 30/50/200 → **200/350/500**（用户口径"最低 200、最高 500"，档间单调保持）。
 *     长文由 30 抬到 200，是 6.7× 放松 —— 因此"节奏仍分档"这件事此后**只由 accountMinMs 承载**。
 *   - 回滚硬顶不变：`min(max(2, dailyMax), MAX_ROLLBACK_PER_DAY=5)` 在三档下均为 5
 *     （由行为锁实测，不从公式推断）。
 *
 * 本次（change: publish-frequency-unwired-surfaces）新增 **日配额上界 `MAX_DAILY_QUOTA`**：
 *   此前 env 与设置页覆盖两条路径都**没有上界**，而设置页输入框硬编码 `:max="999"` ——
 *   同一个量在三条路径上各有各的合法域，于是「UI 填不进去的值 env 能填进去」且
 *   「env 填了个荒谬值没人说界在哪」。上界从此只在本模块定义一处，三条路径与 UI 共用它
 *   （沿用 `MAX_INTERVAL_MS` 的形态：env 超界钳位并出声，设置页覆盖超界按既有语义整体丢弃）。
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

/**
 * 日配额上界：env、设置页覆盖、设置页输入框**共用**的同一个界（此前三条路径各有其界）。
 * 取 5000 = v4 最大档（short 500）× 10 的余量；再高就与"关掉配额"（0）在运营上无从区分，
 * 而"关掉"已有 0 这个显式语义，不需要靠填一个天文数字来表达。
 * 必须**严格大于**最大默认值：写成刚好等于时，下一次上调默认值会撞上界并被静默钳位。
 */
const MAX_DAILY_QUOTA = 5000

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

/**
 * 同账号最小发布间隔的**逐平台默认表**（毫秒）—— 该维度唯一的数值真源（v5）。
 *
 * 为什么从「按档位派生」改成「逐平台字面量」（change: publish-frequency-per-platform-intervals）：
 * 档位把 15 个平台压成三档，于是「只想收紧视频号」要么连带改整档、要么在代码里写
 * if (platform === tencent_video) 分支 —— 后者正是本模块要消灭的「同一个量抄成多份」。
 * 现在差异化只落在这张表里：**以后任何平台收紧或放宽，改这一行数据，不动分类器、不动控制流。**
 * 档位仍承载 platformMinMs 与 accountDailyMax（这两个维度确实没有逐平台差异需求）。
 *
 * 取值依据如实标注（详见 01-docs/PRD-PUBLISH-FREQUENCY-V5-2026-10-16.md §2）：
 *   - 公开渠道**没有**任何平台给出「两次发布必须间隔 N 分钟」的量化规则；
 *   - 视频号 60 分钟是**产品决策**，依据是公开运营口径的「日发上限按粉丝量分级
 *     （千粉 1 条／万粉 2 条／万粉以上 ≤5 条）、超出限制直接限流」，不是平台公布的阈值；
 *   - 其余 14 个平台 = 各自档位现行值，**行为零变化**，由回归锁
 *     「偏离集合 == [tencent_video]」钉住，防止顺手调数值混进同一次改动。
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

/** 逐平台账号间隔的 env 覆盖入口：一条 JSON，不设 15 个独立变量（PRD v5 §4）。 */
const ENV_ACCOUNT_MIN_INTERVAL_JSON = 'MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON'

const PLATFORM_FREQUENCY_POLICY = Object.freeze(
  Object.fromEntries(
    Object.entries(PLATFORM_TIER).map(([platform, tier]) => [
      platform,
      // 账号档自 v5 起取逐平台表；档位值只作为「表里没登记该平台」时的兜底来源。
      Object.freeze({ tier, ...TIER_PRESETS[tier], accountMinMs: PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform] }),
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
  // 基线的定义是「人为想清楚过的最严值」。v5 起已登记里最严的是视频号 60 分钟，
  // 故账号档**引用逐平台表**而不是另写一个数字——两个数字必然有一天漂移。
  accountMinMs: PLATFORM_ACCOUNT_MIN_INTERVAL_MS.tencent_video,
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

/**
 * 回落基线不得弱于任何已登记平台 —— **运行期**自检（QM-6 后端轴 C1/W1）。
 *
 * 为什么还要一道运行期的：`BASELINE_INTERVALS` 刻意不从 `TIER_PRESETS` 派生（回落必须是
 * "人为想清楚过的最严值"），于是"改档忘改基线"只能靠测试发现 —— 测试一旦被绕过
 * （跳过、--no-verify、只跑子集）语义就静默反转。这里把同一判据在模块加载时再跑一遍并**出声**。
 * 只出声不抛错：抛错会让整条发布链起不来，而这属于"配置写错"级别，不是"安全门失效"级别。
 *
 * 表可由参数注入 ⇒ "基线被调宽"这一格在测试里可表示（默认读真实表，不造第二份判据）。
 * @param {{warn?: (msg: string) => void, policyTable?: object, baseline?: object}} [options]
 * @returns {string[]} 违规描述数组（空＝通过）
 */
function checkBaselineStrength (options = {}) {
  const warn = typeof options.warn === 'function' ? options.warn : (msg) => console.warn(msg)
  const table = options.policyTable || PLATFORM_FREQUENCY_POLICY
  const baseline = options.baseline || BASELINE_INTERVALS
  const platforms = Object.keys(table)

  if (platforms.length === 0) {
    // 空表会让"零个违规"读起来像通过 —— 自检必须报告自己没测到东西
    warn('[PublishFrequency] 策略表为空，回落基线无法比对（本次自检未生效）')
    return ['策略表为空，自检未生效']
  }

  const problems = []
  for (const key of ['accountMinMs', 'platformMinMs']) {
    const maxRegistered = Math.max(...platforms.map((p) => Number(table[p][key]) || 0))
    if (!(Number(baseline[key]) >= maxRegistered)) {
      problems.push(`${key} 基线 ${baseline[key]} < 已登记最大 ${maxRegistered}`)
    }
  }
  // 配额维度的"更严"是**更小**（与间隔维度方向相反），所以比的是下界
  const minDaily = Math.min(...platforms.map((p) => Number(table[p].accountDailyMax) || 0))
  if (!(Number(baseline.accountDailyMax) <= minDaily)) {
    problems.push(`accountDailyMax 基线 ${baseline.accountDailyMax} > 已登记最小 ${minDaily}`)
  }

  if (problems.length) warn(`[PublishFrequency] 回落基线弱于已登记平台：${problems.join('；')}`)
  return problems
}

// 加载即自检：正常配置下静默；只在"改了档位忘了改基线"时出声一次
checkBaselineStrength()

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
 * 解析逐平台账号间隔的 env JSON 覆盖（`MP_PUBLISH_ACCOUNT_MIN_INTERVAL_MS_JSON`）。
 *
 * 两档严格度（PRD v5 §4，刻意不同口径）：
 *   - **值非法**（非有限数 / <0）⇒ 整条作废并出声：不做「一半生效」，
 *     否则用户会看到「改了 A 却影响了 B」这种不可解释的行为；
 *   - **平台键未知** ⇒ 只忽略该键并点名：拼错一个平台名不该抹掉其余 14 个平台的配置。
 *   超上界按既有间隔语义**钳位**（不作废）——与 parseEnvInterval 同口径。
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
    warn('[PublishFrequency] 环境变量 ' + ENV_ACCOUNT_MIN_INTERVAL_JSON + ' 需对象 { <platform>: ms }，整条作废、全部平台回落默认表')
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
 *   5. 逐平台表默认        PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform]（未登记平台回落 BASELINE_INTERVALS）
 *
 * ⛔ 本函数**不得**调用 resolveIntervals：resolveIntervals 的账号档正是由本函数提供，
 *    互相调用即无限递归（回归锁「两个解析函数不得互相调用」以 RangeError 形式抓住）。
 *
 * @param {string} platform
 * @param {{env?: Record<string,string|undefined>, warn?: (msg: string) => void, overrides?: object}} [options]
 * @returns {number} 毫秒；0 = 显式关闭该档
 */
function resolveAccountMinIntervalMs (platform, options = {}) {
  const env = options.env || process.env
  const warn = warnSink(options)
  const ov = options.overrides || {}
  const known = isKnownPlatform(platform)
  const tableDefault = known ? PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform] : BASELINE_INTERVALS.accountMinMs

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

  // 账号档不再由档位派生：真源是 PLATFORM_ACCOUNT_MIN_INTERVAL_MS（逐平台表），
  // 优先级链与 env JSON 覆盖一并交给 resolveAccountMinIntervalMs（它不会回调本函数）。
  const accountMinMs = resolveAccountMinIntervalMs(platform, { overrides: ov, env, warn })
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
    { integer: true, max: MAX_DAILY_QUOTA }
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

  // 逐平台账号间隔覆盖：对象，键必须 ∈ SUPPORTED_PLATFORMS，值 [0, MAX_INTERVAL_MS] 整数毫秒。
  // 值非法 ⇒ **整个覆盖对象作废**（与同函数其余字段的「全有或全无」纪律一致）；
  // 未知平台键 ⇒ 忽略该键但不作废（拼错一个平台名不该抹掉用户其余配置）；
  // 全部键都未知 ⇒ 视为无效（不得留下空 map 被下游读成「覆盖了但值为空」）。
  if (raw.accountMinMsByPlatform !== undefined && raw.accountMinMsByPlatform !== null) {
    const byPlatform = raw.accountMinMsByPlatform
    if (typeof byPlatform !== 'object' || Array.isArray(byPlatform)) {
      bad('accountMinMsByPlatform', byPlatform, '需对象 { <platform>: ms }')
      return null
    }
    const map = {}
    let ignoredUnknown = 0
    for (const entry of Object.entries(byPlatform)) {
      const platform = entry[0]
      const value = entry[1]
      if (value === undefined || value === null) continue
      if (!isKnownPlatform(platform)) {
        ignoredUnknown += 1
        warn('[PublishFrequency] 设置页账号间隔覆盖含未知平台 ' + JSON.stringify(platform) + '，已忽略该键')
        continue
      }
      const n = Number(value)
      if (!Number.isInteger(n) || n < 0 || n > MAX_INTERVAL_MS) {
        bad('accountMinMsByPlatform.' + platform, value, '需 [0,' + MAX_INTERVAL_MS + '] 的整数毫秒')
        return null
      }
      map[platform] = n
    }
    if (Object.keys(map).length === 0) {
      if (ignoredUnknown > 0) {
        bad('accountMinMsByPlatform', raw.accountMinMsByPlatform, '全部键都不是已支持平台')
        return null
      }
    } else {
      out.accountMinMsByPlatform = map
    }
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

module.exports = {
  resolveIntervals,
  resolveJitterRatio,
  resolveReleaseGraceMs,
  resolveEmergencyMaxPerDay,
  resolvePolicyOverrides,
  isKnownPlatform,
  checkBaselineStrength,
  parseEnvNumber,
  PLATFORM_FREQUENCY_POLICY,
  BASELINE_INTERVALS,
  SUPPORTED_PLATFORMS,
  MAX_INTERVAL_MS,
  MAX_DAILY_QUOTA,
  DEFAULT_JITTER_RATIO,
  DEFAULT_RELEASE_GRACE_MS,
  MIN_RELEASE_GRACE_MS,
  DEFAULT_EMERGENCY_MAX_PER_DAY,
  MAX_EMERGENCY_MAX_PER_DAY,
  TIER_LONG,
  TIER_CLIP,
  TIER_SHORT,
  ENV_ACCOUNT_MIN_INTERVAL,
  ENV_ACCOUNT_MIN_INTERVAL_JSON,
  PLATFORM_ACCOUNT_MIN_INTERVAL_MS,
  resolveAccountMinIntervalMs,
  ENV_PLATFORM_MIN_INTERVAL,
  ENV_DAILY_MAX_LONG,
  ENV_DAILY_MAX_CLIP,
  ENV_DAILY_MAX_SHORT,
  ENV_ACCOUNT_DAILY_MAX,
  ENV_JITTER_RATIO,
  ENV_RELEASE_GRACE_MS,
  ENV_EMERGENCY_MAX_PER_DAY,
}
