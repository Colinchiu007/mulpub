/**
 * Test: publish-frequency-policy.js — 发布频率策略单一真源（v3）
 *
 * 覆盖：15 平台三维度全覆盖、未知平台回落最严档 + fallback 标记、数值下调、
 * 三档日配额 env、抖动比例、回滚退避、紧急放行上限、0 = 显式关闭、非法值回落并出声。
 *
 * v3（change: publish-frequency-policy-v3）新增的判据面：
 *   - 账号档再下调一档（长文 20′→5′ / 短视频图文 10′→3′ / 短内容 3′→1′）
 *   - 平台档由「统一 2′」改为**按档分级**（3′/2′/1′），并新增「档间单调」与
 *     「platformMinMs ≤ accountMinMs 且档位差不得反向」两条形状判据
 *   - 日配额取 10 倍（3/5/20 → 30/50/200），且**恰好** 10 倍（钉成数据表，防止"顺手改宽"）
 */
const {
  resolveIntervals,
  resolveJitterRatio,
  resolveReleaseGraceMs,
  resolveEmergencyMaxPerDay,
  resolvePolicyOverrides,
  isKnownPlatform,
  BASELINE_INTERVALS,
  PLATFORM_FREQUENCY_POLICY,
  SUPPORTED_PLATFORMS,
  MAX_INTERVAL_MS,
  DEFAULT_JITTER_RATIO,
  MIN_RELEASE_GRACE_MS,
  ENV_ACCOUNT_MIN_INTERVAL,
  ENV_PLATFORM_MIN_INTERVAL,
  ENV_DAILY_MAX_LONG,
  ENV_DAILY_MAX_CLIP,
  ENV_DAILY_MAX_SHORT,
  ENV_ACCOUNT_DAILY_MAX,
  ENV_JITTER_RATIO,
  ENV_RELEASE_GRACE_MS,
  ENV_EMERGENCY_MAX_PER_DAY,
  TIER_LONG,
  TIER_CLIP,
  TIER_SHORT,
} = require('../src/publish-frequency-policy')

const MIN = 60 * 1000

describe('publish-frequency-policy v3', () => {
  describe('平台覆盖', () => {
    it('15 个支持平台全部登记，且三个维度均为正数', () => {
      expect([...SUPPORTED_PLATFORMS].sort()).toEqual([
        'baijiahao', 'bilibili', 'douyin', 'facebook', 'instagram', 'kuaishou',
        'tencent_video', 'tiktok', 'toutiao', 'twitter', 'wechat_mp', 'weibo',
        'xiaohongshu', 'youtube', 'zhihu',
      ])
      expect(SUPPORTED_PLATFORMS.length).toBe(15)

      for (const platform of SUPPORTED_PLATFORMS) {
        const r = resolveIntervals(platform, { env: {} })
        expect(r.accountMinMs, `${platform} accountMinMs`).toBeGreaterThan(0)
        expect(r.platformMinMs, `${platform} platformMinMs`).toBeGreaterThan(0)
        expect(r.accountDailyMax, `${platform} accountDailyMax`).toBeGreaterThan(0)
        expect(r.fallback, `${platform} fallback`).toBe(false)
      }
    })

    it('三组代表平台逐档精确等于策略表（v4 数值）', () => {
      // v4：平台间隔三档统一 1′（跨号仍错开，但不再按内容形态分级）；
      // 日配额改为 200 / 350 / 500 —— 间隔维度的档间单调保留，配额维度也仍单调（长文最少）。
      expect(resolveIntervals('wechat_mp', { env: {} })).toEqual({
        tier: TIER_LONG, accountMinMs: 5 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 200, fallback: false,
      })
      expect(resolveIntervals('douyin', { env: {} })).toEqual({
        tier: TIER_CLIP, accountMinMs: 3 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 350, fallback: false,
      })
      expect(resolveIntervals('weibo', { env: {} })).toEqual({
        tier: TIER_SHORT, accountMinMs: 1 * MIN, platformMinMs: 1 * MIN, accountDailyMax: 500, fallback: false,
      })
    })

    it('v3 账号档已再下调：全域不得超过 5 分钟（v2 的 20 分钟不得残留）', () => {
      for (const platform of SUPPORTED_PLATFORMS) {
        const { accountMinMs } = resolveIntervals(platform, { env: {} })
        expect(accountMinMs, `${platform} 应为 v3 值`).toBeLessThanOrEqual(5 * MIN)
      }
      // 逐档核对，防止"只改了代表平台"：整张表按 tier 收敛
      const byTier = {}
      for (const platform of SUPPORTED_PLATFORMS) {
        const r = resolveIntervals(platform, { env: {} })
        byTier[r.tier] = { account: r.accountMinMs, platform: r.platformMinMs, daily: r.accountDailyMax }
      }
      expect(byTier).toEqual({
        [TIER_LONG]: { account: 5 * MIN, platform: 1 * MIN, daily: 200 },
        [TIER_CLIP]: { account: 3 * MIN, platform: 1 * MIN, daily: 350 },
        [TIER_SHORT]: { account: 1 * MIN, platform: 1 * MIN, daily: 500 },
      })
    })

    it('v4：平台间隔三档统一 1′（机制在、分级撤了）', () => {
      // 平台桶只防"同机不同号在同一平台同时发"（同号并发由通道调度串行挡）。
      // v4 把它统一成 1′：**不得整条删除** —— 删掉后同平台多号零间隔并行，
      // 而"被平台侧关联成矩阵号"在本地没有任何可观测信号。
      const values = new Set(SUPPORTED_PLATFORMS.map((p) => resolveIntervals(p, { env: {} }).platformMinMs))
      expect([...values]).toEqual([1 * MIN])
      for (const platform of SUPPORTED_PLATFORMS) {
        expect(resolveIntervals(platform, { env: {} }).platformMinMs, platform).toBe(1 * MIN)
      }
    })

    it('档间单调：长文最慢、短内容最快（间隔与配额两个维度都不得反向）', () => {
      // 测试名刻意不含 ` > `：FAIL 行以 ` > ` 作 describe/test 分隔符，
      // 名字里带它会被任何按该分隔符解析日志的工具（含本次变异驱动）截成尾巴半句。
      const long = resolveIntervals('wechat_mp', { env: {} })
      const clip = resolveIntervals('douyin', { env: {} })
      const short = resolveIntervals('weibo', { env: {} })
      expect(long.accountMinMs).toBeGreaterThan(clip.accountMinMs)
      expect(clip.accountMinMs).toBeGreaterThan(short.accountMinMs)
      // 平台档已统一 ⇒ 这一维从"单调不高于"变成"三档相等"（相等不是退化，是 v4 的显式规则）
      expect(long.platformMinMs).toBe(clip.platformMinMs)
      expect(clip.platformMinMs).toBe(short.platformMinMs)
      expect(long.accountDailyMax).toBeLessThan(clip.accountDailyMax)
      expect(clip.accountDailyMax).toBeLessThan(short.accountDailyMax)
    })

    it('日配额钉成数据表 200 / 350 / 500（v2 3/5/20 → v3 ×10 → v4；不得"顺手改宽"到别值）', () => {
      const V4_DAILY = { [TIER_LONG]: 200, [TIER_CLIP]: 350, [TIER_SHORT]: 500 }
      for (const platform of SUPPORTED_PLATFORMS) {
        const r = resolveIntervals(platform, { env: {} })
        expect(r.accountDailyMax, `${platform}=${r.tier}`).toBe(V4_DAILY[r.tier])
      }
      // 未登记平台的回落基线配额不得比任何已登记平台更宽 ⇒ 取最严那档（= 最小值 200）
      expect(BASELINE_INTERVALS.accountDailyMax).toBe(V4_DAILY[TIER_LONG])
    })

    it('未知平台回落基线最严档并带 fallback 标记（供守卫出声）', () => {
      const r = resolveIntervals('some_future_platform', { env: {} })
      expect(r).toEqual({ ...BASELINE_INTERVALS, fallback: true })
      expect(r.accountMinMs).toBeGreaterThan(0)
      expect(r.platformMinMs).toBeGreaterThan(0)
      expect(r.accountDailyMax).toBeGreaterThan(0)

      for (const bad of [undefined, null, '', 123, {}]) {
        expect(resolveIntervals(bad, { env: {} }).fallback).toBe(true)
        expect(resolveIntervals(bad, { env: {} }).accountMinMs).toBe(BASELINE_INTERVALS.accountMinMs)
      }
    })

    it('isKnownPlatform 只认策略表内的字符串键', () => {
      expect(isKnownPlatform('douyin')).toBe(true)
      expect(isKnownPlatform('nope')).toBe(false)
      expect(isKnownPlatform(undefined)).toBe(false)
      expect(isKnownPlatform({})).toBe(false)
    })

    it('平台 → 档位归属逐平台钉住（QM-6 后端轴 B14：派生表的"谁在哪档"必须可见）', () => {
      // 数值收敛成派生后，新出现的风险面是「把某平台挪错档」：
      // 它不改任何档位值，所以「逐 tier 精确表」与「档间单调」两类锁**都照样绿**，
      // 而用户侧表现是"bilibili 怎么突然比抖音严"。归属必须单独钉。
      const EXPECTED_TIER = {
        baijiahao: TIER_LONG, toutiao: TIER_LONG, wechat_mp: TIER_LONG, zhihu: TIER_LONG,
        bilibili: TIER_CLIP, douyin: TIER_CLIP, facebook: TIER_CLIP, instagram: TIER_CLIP,
        kuaishou: TIER_CLIP, tencent_video: TIER_CLIP, tiktok: TIER_CLIP, xiaohongshu: TIER_CLIP,
        youtube: TIER_CLIP,
        twitter: TIER_SHORT, weibo: TIER_SHORT,
      }
      const actual = {}
      for (const platform of SUPPORTED_PLATFORMS) {
        actual[platform] = PLATFORM_FREQUENCY_POLICY[platform].tier
      }
      expect(actual).toEqual(EXPECTED_TIER)
      expect(Object.keys(EXPECTED_TIER).length).toBe(SUPPORTED_PLATFORMS.length)
    })

    it('回落基线不得弱于任何已登记平台（逐维度，QM-6 B7/Info-8）', () => {
      // 「BASELINE_INTERVALS 是独立常量」的理由是"回落必须是人为想清楚过的最严值"。
      // 但独立 = 不会被编译器/测试提醒。既有锁只写 `unknown.accountMinMs >= weibo.accountMinMs`
      // （对最短的那档比），v3 下 weibo=1′、基线=5′ 恒过 —— 它挡不住"把基线调得比 long 档还松"。
      // 正解是把"不弱于任何已登记平台"变成可执行约束，三个维度逐个比。
      for (const key of ['accountMinMs', 'platformMinMs']) {
        const maxRegistered = Math.max(...SUPPORTED_PLATFORMS.map((p) => PLATFORM_FREQUENCY_POLICY[p][key]))
        expect(BASELINE_INTERVALS[key], `${key} 必须 >= 已登记平台最大值`).toBeGreaterThanOrEqual(maxRegistered)
      }
      const minDaily = Math.min(...SUPPORTED_PLATFORMS.map((p) => PLATFORM_FREQUENCY_POLICY[p].accountDailyMax))
      // 配额维度的"更严"是**更小**（间隔维度是更大），所以这里取下界而不是上界
      expect(BASELINE_INTERVALS.accountDailyMax, '回落配额不得比任何已登记平台更宽').toBeLessThanOrEqual(minDaily)
    })

    it('策略表里每个平台的 platformMinMs 不得大于 accountMinMs', () => {
      for (const [platform, p] of Object.entries(PLATFORM_FREQUENCY_POLICY)) {
        expect(p.platformMinMs, `${platform}`).toBeLessThanOrEqual(p.accountMinMs)
      }
    })
  })

  describe('间隔环境变量覆盖', () => {
    it('合法值覆盖所有平台的两档', () => {
      const env = { [ENV_ACCOUNT_MIN_INTERVAL]: '45000', [ENV_PLATFORM_MIN_INTERVAL]: '9000' }
      const r = resolveIntervals('douyin', { env })
      expect(r.accountMinMs).toBe(45000)
      expect(r.platformMinMs).toBe(9000)
      expect(r.accountDailyMax, 'douyin 属 clip 档，日配额取 v4 值').toBe(350) // 日配额不受间隔 env 影响
    })

    it('0 表示该档显式关闭，且不得触发告警', () => {
      const warns = []
      const env = { [ENV_ACCOUNT_MIN_INTERVAL]: '0' }
      const r = resolveIntervals('weibo', { env, warn: (m) => warns.push(m) })
      expect(r.accountMinMs).toBe(0)
      expect(r.platformMinMs).toBe(1 * MIN)
      expect(warns).toEqual([])
    })

    it('非法值回落策略表并逐条出声告警（禁止静默当 0）', () => {
      for (const bad of ['abc', '-1', 'NaN', 'Infinity', '12x']) {
        const warns = []
        const env = { [ENV_ACCOUNT_MIN_INTERVAL]: bad }
        const r = resolveIntervals('douyin', { env, warn: (m) => warns.push(m) })
        expect(r.accountMinMs, `bad=${JSON.stringify(bad)}`).toBe(3 * MIN)
        expect(warns.length, `bad=${JSON.stringify(bad)} 必须出声`).toBe(1)
        expect(warns[0]).toContain(ENV_ACCOUNT_MIN_INTERVAL)
      }
    })

    it('超出 7 天上界的间隔被钳位并出声（防抖动后溢出 setTimeout）', () => {
      const warns = []
      const env = { [ENV_ACCOUNT_MIN_INTERVAL]: String(30 * 24 * 60 * MIN) }
      const r = resolveIntervals('douyin', { env, warn: (m) => warns.push(m) })
      expect(r.accountMinMs).toBe(MAX_INTERVAL_MS)
      expect(warns.length).toBe(1)
      expect(warns[0]).toContain('超出上界')
    })

    it('空白值也回落并出声', () => {
      const warns = []
      const r = resolveIntervals('douyin', { env: { [ENV_ACCOUNT_MIN_INTERVAL]: '   ' }, warn: (m) => warns.push(m) })
      expect(r.accountMinMs).toBe(3 * MIN)
      expect(warns.length).toBe(1)
    })
  })

  describe('日配额环境变量（三档 + 全局覆盖）', () => {
    it('三档各自独立覆盖，互不影响', () => {
      const env = {
        [ENV_DAILY_MAX_LONG]: '1',
        [ENV_DAILY_MAX_CLIP]: '7',
        [ENV_DAILY_MAX_SHORT]: '99',
      }
      expect(resolveIntervals('wechat_mp', { env }).accountDailyMax).toBe(1)
      expect(resolveIntervals('douyin', { env }).accountDailyMax).toBe(7)
      expect(resolveIntervals('weibo', { env }).accountDailyMax).toBe(99)
    })

    it('全局覆盖优先于三档 env', () => {
      const env = {
        [ENV_DAILY_MAX_LONG]: '1',
        [ENV_ACCOUNT_DAILY_MAX]: '4',
      }
      expect(resolveIntervals('wechat_mp', { env }).accountDailyMax).toBe(4)
      expect(resolveIntervals('douyin', { env }).accountDailyMax).toBe(4)
    })

    it('0 = 关闭该档配额（与平台档 0 语义一致），且不告警', () => {
      const warns = []
      const r = resolveIntervals('douyin', { env: { [ENV_ACCOUNT_DAILY_MAX]: '0' }, warn: (m) => warns.push(m) })
      expect(r.accountDailyMax).toBe(0)
      expect(warns).toEqual([])
    })

    it('非整数/负数回落并出声', () => {
      for (const bad of ['5.5', '-2', 'abc', '']) {
        const warns = []
        const r = resolveIntervals('douyin', { env: { [ENV_DAILY_MAX_CLIP]: bad }, warn: (m) => warns.push(m) })
        expect(r.accountDailyMax, `bad=${JSON.stringify(bad)}`).toBe(350)
        expect(warns.length, `bad=${JSON.stringify(bad)}`).toBe(1)
      }
    })

    it('设置页覆盖优先于 env', () => {
      const env = { [ENV_DAILY_MAX_CLIP]: '7' }
      const r = resolveIntervals('douyin', { env, overrides: { accountDailyMax: 2 } })
      expect(r.accountDailyMax).toBe(2)
    })
  })

  describe('抖动比例', () => {
    it('默认 0.4；合法值覆盖', () => {
      expect(resolveJitterRatio({ env: {} })).toBe(DEFAULT_JITTER_RATIO)
      expect(resolveJitterRatio({ env: { [ENV_JITTER_RATIO]: '0.2' } })).toBe(0.2)
    })

    it('0 = 关闭抖动且不告警', () => {
      const warns = []
      expect(resolveJitterRatio({ env: { [ENV_JITTER_RATIO]: '0' }, warn: (m) => warns.push(m) })).toBe(0)
      expect(warns).toEqual([])
    })

    it('越界（>=1 / 负数 / 非数 / 空白）回落默认并出声', () => {
      for (const bad of ['1', '-0.1', 'abc', '', '2']) {
        const warns = []
        const r = resolveJitterRatio({ env: { [ENV_JITTER_RATIO]: bad }, warn: (m) => warns.push(m) })
        expect(r, `bad=${JSON.stringify(bad)}`).toBe(DEFAULT_JITTER_RATIO)
        expect(warns.length, `bad=${JSON.stringify(bad)}`).toBe(1)
      }
    })
  })

  describe('回滚退避', () => {
    it('默认 60s；低于 10s 下界钳位并出声（防回滚即零等待的重试风暴）', () => {
      expect(resolveReleaseGraceMs({ env: {} })).toBe(60 * 1000)
      const warns = []
      expect(resolveReleaseGraceMs({ env: { [ENV_RELEASE_GRACE_MS]: '0' }, warn: (m) => warns.push(m) }))
        .toBe(MIN_RELEASE_GRACE_MS)
      expect(warns.length).toBe(1)
      expect(warns[0]).toContain('低于下界')
    })

    it('合法值直通；非整数回落并出声', () => {
      expect(resolveReleaseGraceMs({ env: { [ENV_RELEASE_GRACE_MS]: '30000' } })).toBe(30000)
      const warns = []
      expect(resolveReleaseGraceMs({ env: { [ENV_RELEASE_GRACE_MS]: '1.5' }, warn: (m) => warns.push(m) }))
        .toBe(60 * 1000)
      expect(warns.length).toBe(1)
    })
  })

  describe('紧急放行上限', () => {
    it('默认 1；0 = 关闭且不告警；超上界 10 钳位并出声', () => {
      expect(resolveEmergencyMaxPerDay({ env: {} })).toBe(1)

      const w0 = []
      expect(resolveEmergencyMaxPerDay({ env: { [ENV_EMERGENCY_MAX_PER_DAY]: '0' }, warn: (m) => w0.push(m) })).toBe(0)
      expect(w0).toEqual([])

      const w1 = []
      expect(resolveEmergencyMaxPerDay({ env: { [ENV_EMERGENCY_MAX_PER_DAY]: '99' }, warn: (m) => w1.push(m) })).toBe(10)
      expect(w1.length).toBe(1)
    })
  })

  describe('设置页覆盖解析（resolvePolicyOverrides，全有或全无）', () => {
    it('null/undefined ⇒ 无覆盖；非对象 ⇒ 丢弃并出声', () => {
      expect(resolvePolicyOverrides(null, { env: {} })).toBe(null)
      expect(resolvePolicyOverrides(undefined, {})).toBe(null)
      for (const bad of ['x', 5, [], true]) {
        const warns = []
        expect(resolvePolicyOverrides(bad, { warn: (m) => warns.push(m) })).toBe(null)
        expect(warns.length).toBe(1)
      }
    })

    it('合法字段逐项通过；未知字段忽略（前向兼容，不作废）', () => {
      const o = resolvePolicyOverrides({
        accountMinMs: 30000,
        platformMinMs: 0,
        dailyMax: { long: 2, clip: 6 },
        jitterRatio: 0.2,
        releaseGraceMs: 30000,
        emergencyMaxPerDay: 2,
        futureField: 'ignore-me',
      }, { warn: () => {} })
      expect(o).toEqual({
        accountMinMs: 30000,
        platformMinMs: 0,
        dailyMax: { long: 2, clip: 6 },
        jitterRatio: 0.2,
        releaseGraceMs: 30000,
        emergencyMaxPerDay: 2,
      })
    })

    it('任一字段非法 ⇒ 整个对象作废 + 出声（不半生效）', () => {
      const cases = [
        { accountMinMs: -1 },
        { accountMinMs: 'abc' },
        { platformMinMs: -5 },
        { dailyMax: { long: 1.5 } },
        { dailyMax: { clip: -1 } },
        { dailyMax: 3 },
        { jitterRatio: 1 },
        { jitterRatio: -0.1 },
        { releaseGraceMs: 1000 },
        { accountDailyMax: 2.5 },
        { emergencyMaxPerDay: 99 },
      ]
      for (const bad of cases) {
        const warns = []
        expect(resolvePolicyOverrides(bad, { warn: (m) => warns.push(m) }), JSON.stringify(bad)).toBe(null)
        expect(warns.length, JSON.stringify(bad)).toBe(1)
        expect(warns[0], JSON.stringify(bad)).toContain('已整体丢弃')
      }
    })

    it('合法但为空的对象 ⇒ 返回 null（不得返回空对象冒充覆盖）', () => {
      expect(resolvePolicyOverrides({}, { warn: () => {} })).toBe(null)
      expect(resolvePolicyOverrides({ dailyMax: {} }, { warn: () => {} })).toBe(null)
    })

    it('间隔字段超上界被钳位（不整体作废，与 env 的钳位语义一致）', () => {
      const warns = []
      const o = resolvePolicyOverrides({ accountMinMs: 60 * 24 * 60 * 60 * 1000 }, { warn: (m) => warns.push(m) })
      expect(o.accountMinMs).toBe(MAX_INTERVAL_MS)
      expect(warns).toEqual([])
    })

    it('overrides 参与 resolveIntervals：优先于 env 与策略表', () => {
      const env = { [ENV_DAILY_MAX_CLIP]: '9', [ENV_ACCOUNT_MIN_INTERVAL]: '999999' }
      const o = resolvePolicyOverrides({ accountMinMs: 12345, dailyMax: { clip: 2 } }, { warn: () => {} })
      const r = resolveIntervals('douyin', { env, overrides: o })
      expect(r.accountMinMs).toBe(12345)
      expect(r.accountDailyMax).toBe(2)
    })
  })

  describe('默认 env 来源', () => {
    it('不传 env 时读 process.env，且不会因缺省而抛', () => {
      const saved = process.env[ENV_ACCOUNT_MIN_INTERVAL]
      delete process.env[ENV_ACCOUNT_MIN_INTERVAL]
      try {
        expect(resolveIntervals('douyin').accountMinMs).toBe(3 * MIN)
      } finally {
        if (saved !== undefined) process.env[ENV_ACCOUNT_MIN_INTERVAL] = saved
      }
    })
  })
})
