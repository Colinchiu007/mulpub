/**
 * Test: 逐平台「同账号最小发布间隔」（v5，change: publish-frequency-per-platform-intervals）
 *
 * 为什么单独一个文件而不是塞进 publish-frequency-policy.test.js：
 * 那把既有文件里所有断言的参照物是"档位"，本片把账号档的真源换成"逐平台表"，
 * 两代判据混在一个文件里会让"哪条锁的是哪一维"重新变模糊。
 *
 * 锁的面：表覆盖 / 优先级链 5 级 / env JSON 两档严格度 / 设置页覆盖校验 / 兜底不绕过解析器 / 不得互相递归。
 */
const {
  resolveIntervals,
  resolvePolicyOverrides,
  PLATFORM_FREQUENCY_POLICY,
  PLATFORM_ACCOUNT_MIN_INTERVAL_MS,
  resolveAccountMinIntervalMs,
  BASELINE_INTERVALS,
  SUPPORTED_PLATFORMS,
  MAX_INTERVAL_MS,
  ENV_ACCOUNT_MIN_INTERVAL,
  ENV_ACCOUNT_MIN_INTERVAL_JSON,
  TIER_LONG,
  TIER_CLIP,
  TIER_SHORT,
} = require('../src/publish-frequency-policy')

const MIN = 60 * 1000

/** 档位账号档代表值由测试自己写出（不从实现导入，否则是实现自证）。出处：PRD v4 §2。 */
const TIER_PRESET_ACCOUNT = { [TIER_LONG]: 5 * MIN, [TIER_CLIP]: 3 * MIN, [TIER_SHORT]: 1 * MIN }
/** 另两维的档位参照值同样由测试写出：v5 的差异化只发生在账号档，这两维必须仍按档。 */
const TIER_PRESET_PLATFORM = { [TIER_LONG]: 1 * MIN, [TIER_CLIP]: 1 * MIN, [TIER_SHORT]: 1 * MIN }
const TIER_PRESET_DAILY = { [TIER_LONG]: 200, [TIER_CLIP]: 350, [TIER_SHORT]: 500 }

/** 夹具与真实 env 同形：只给要测的那几条键，其余缺席。 */
function envWith (extra) {
  return Object.assign({}, extra)
}

describe('逐平台同账号发布间隔（v5）', () => {
  it('表覆盖全部支持平台，视频号是唯一偏离档位默认的平台', () => {
    expect(Object.keys(PLATFORM_ACCOUNT_MIN_INTERVAL_MS).sort())
      .toEqual([...SUPPORTED_PLATFORMS].sort())
    expect(PLATFORM_ACCOUNT_MIN_INTERVAL_MS.tencent_video).toBe(60 * MIN)
    const deviations = SUPPORTED_PLATFORMS
      .filter((p) => PLATFORM_ACCOUNT_MIN_INTERVAL_MS[p] !== TIER_PRESET_ACCOUNT[PLATFORM_FREQUENCY_POLICY[p].tier])
      .sort()
    // 新增偏离必须同时改本行与 PRD v5 §2 的依据列；空偏离集合也要能读出"确实比过了 15 个平台"
    expect(deviations).toEqual(['tencent_video'])
    expect(SUPPORTED_PLATFORMS.length).toBe(15)
  })

  it('优先级：平台专属覆盖 > 全局覆盖 > env 平台 > env 全局 > 表默认', () => {
    const warn = () => {}
    const table = PLATFORM_ACCOUNT_MIN_INTERVAL_MS.douyin
    // 5 表默认
    expect(resolveAccountMinIntervalMs('douyin', { env: envWith({}), warn })).toBe(table)
    // 4 env 全局
    expect(resolveAccountMinIntervalMs('douyin', {
      env: envWith({ [ENV_ACCOUNT_MIN_INTERVAL]: String(2 * MIN) }), warn,
    })).toBe(2 * MIN)
    // 3 env 平台专属 赢 4 env 全局
    expect(resolveAccountMinIntervalMs('douyin', {
      env: envWith({
        [ENV_ACCOUNT_MIN_INTERVAL]: String(2 * MIN),
        [ENV_ACCOUNT_MIN_INTERVAL_JSON]: JSON.stringify({ douyin: 4 * MIN }),
      }), warn,
    })).toBe(4 * MIN)
    // 2 设置页全局覆盖 赢 3/4（这条锁的是"env 会不会抹掉用户在界面上填的值"）
    expect(resolveAccountMinIntervalMs('douyin', {
      overrides: { accountMinMs: 7 * MIN },
      env: envWith({
        [ENV_ACCOUNT_MIN_INTERVAL]: String(2 * MIN),
        [ENV_ACCOUNT_MIN_INTERVAL_JSON]: JSON.stringify({ douyin: 4 * MIN }),
      }), warn,
    })).toBe(7 * MIN)
    // 1 设置页平台专属覆盖 赢一切
    expect(resolveAccountMinIntervalMs('douyin', {
      overrides: { accountMinMs: 7 * MIN, accountMinMsByPlatform: { douyin: 9 * MIN } },
      env: envWith({
        [ENV_ACCOUNT_MIN_INTERVAL]: String(2 * MIN),
        [ENV_ACCOUNT_MIN_INTERVAL_JSON]: JSON.stringify({ douyin: 4 * MIN }),
      }), warn,
    })).toBe(9 * MIN)
    // 只覆盖别的平台不得串到本平台（逐平台 map 的键隔离）
    expect(resolveAccountMinIntervalMs('douyin', {
      overrides: { accountMinMsByPlatform: { weibo: 9 * MIN } }, env: envWith({}), warn,
    })).toBe(table)
  })

  it('resolveIntervals 的账号档真的经过解析器（不是只加表不改链）', () => {
    const r = resolveIntervals('douyin', {
      env: envWith({}),
      overrides: { accountMinMsByPlatform: { douyin: 11 * MIN } },
    })
    expect(r.accountMinMs).toBe(11 * MIN)
    // 另两维不受影响：账号档改动不得顺手把平台档/配额带跑
    expect(r.platformMinMs).toBe(1 * MIN)
    expect(r.accountDailyMax).toBe(350)
    expect(r.tier).toBe(TIER_CLIP)
  })

  it('env JSON：值非法整条作废（好键也不生效）；未知平台只忽略该键', () => {
    const seen = []
    const warn = (m) => seen.push(String(m))
    // 正常两条
    expect(resolveAccountMinIntervalMs('douyin', {
      env: envWith({ [ENV_ACCOUNT_MIN_INTERVAL_JSON]: JSON.stringify({ douyin: 30 * MIN, weibo: 2 * MIN }) }), warn,
    })).toBe(30 * MIN)
    // 一个值坏 ⇒ 同一条 env 里的好键一起失效（"一半生效"不可解释）
    seen.length = 0
    expect(resolveAccountMinIntervalMs('douyin', {
      env: envWith({ [ENV_ACCOUNT_MIN_INTERVAL_JSON]: JSON.stringify({ douyin: 30 * MIN, weibo: -5 }) }), warn,
    })).toBe(PLATFORM_ACCOUNT_MIN_INTERVAL_MS.douyin)
    expect(seen.join('\n')).toContain('整条作废')
    // 未知平台名 ⇒ 忽略它、其余照常，且点名
    seen.length = 0
    expect(resolveAccountMinIntervalMs('douyin', {
      env: envWith({ [ENV_ACCOUNT_MIN_INTERVAL_JSON]: JSON.stringify({ douyin: 30 * MIN, made_up: 1 }) }), warn,
    })).toBe(30 * MIN)
    expect(seen.join('\n')).toContain('未知平台')
    // 坏 JSON / 非对象 ⇒ 整条作废 + 出声，绝不抛错打断发布链
    seen.length = 0
    expect(resolveAccountMinIntervalMs('douyin', { env: envWith({ [ENV_ACCOUNT_MIN_INTERVAL_JSON]: '{ 坏' }), warn }))
      .toBe(PLATFORM_ACCOUNT_MIN_INTERVAL_MS.douyin)
    expect(resolveAccountMinIntervalMs('douyin', { env: envWith({ [ENV_ACCOUNT_MIN_INTERVAL_JSON]: '[1,2]' }), warn }))
      .toBe(PLATFORM_ACCOUNT_MIN_INTERVAL_MS.douyin)
    expect(seen.length, '两条非法都必须出声').toBeGreaterThanOrEqual(2)
    // 超上界 ⇒ 钳位（与间隔维度既有语义一致：钳位不作废）
    expect(resolveAccountMinIntervalMs('douyin', {
      env: envWith({ [ENV_ACCOUNT_MIN_INTERVAL_JSON]: JSON.stringify({ douyin: MAX_INTERVAL_MS + 10 * MIN }) }), warn,
    })).toBe(MAX_INTERVAL_MS)
  })

  it('设置页 accountMinMsByPlatform：合法保留、值非法整体作废、未知平台忽略但不作废', () => {
    const warn = () => {}
    expect(resolvePolicyOverrides({ accountMinMsByPlatform: { douyin: 30 * MIN } }, { warn }))
      .toEqual({ accountMinMsByPlatform: { douyin: 30 * MIN } })
    // 与同文件"全有或全无"那组同口径：任一非法 ⇒ 整个覆盖对象作废（连其他合法字段一起失效）
    for (const v of [-1, 1.5, MAX_INTERVAL_MS + 1, 'x']) {
      expect(resolvePolicyOverrides(
        { accountMinMsByPlatform: { douyin: v }, jitterRatio: 0.2 }, { warn }),
      JSON.stringify(v)).toBe(null)
    }
    expect(resolvePolicyOverrides({ accountMinMsByPlatform: '不是对象' }, { warn })).toBe(null)
    expect(resolvePolicyOverrides({ accountMinMsByPlatform: [1] }, { warn })).toBe(null)
    // 未知平台键：忽略它，其余字段照常生效（拼错平台名不该抹掉用户其他配置）
    expect(resolvePolicyOverrides(
      { accountMinMsByPlatform: { made_up: 5, douyin: 4 }, jitterRatio: 0.3 }, { warn }))
      .toEqual({ accountMinMsByPlatform: { douyin: 4 }, jitterRatio: 0.3 })
    // 全是未知键 ⇒ 整个对象视为无效（不得留下"空 map"被下游误读成"覆盖了但值为空"）
    expect(resolvePolicyOverrides({ accountMinMsByPlatform: { made_up: 5 } }, { warn })).toBe(null)
    // null = 清空该维度（与既有 accountMinMs 的 null 语义一致，不得报错）
    expect(resolvePolicyOverrides({ jitterRatio: 0.2, accountMinMsByPlatform: null }, { warn }))
      .toEqual({ jitterRatio: 0.2 })
  })

  it('未登记平台：账号档落基线值，且 env 仍生效（兜底不得绕过解析器）', () => {
    // 这一条是"守卫/策略兜底"与"逐平台真源"接缝上的锁：兜底分支若直接返回基线常量，
    // env 与设置页覆盖会被整条绕过——那正是本仓反复登记的"接上了但走的是另一份值"。
    expect(resolveAccountMinIntervalMs('some_future_platform', { env: envWith({}), warn: () => {} }))
      .toBe(BASELINE_INTERVALS.accountMinMs)
    expect(resolveIntervals('some_future_platform', {
      env: envWith({ [ENV_ACCOUNT_MIN_INTERVAL]: String(4 * MIN) }), warn: () => {},
    }).accountMinMs).toBe(4 * MIN)
    expect(resolveIntervals('some_future_platform', {
      env: envWith({}), warn: () => {},
    }).accountMinMs).toBe(BASELINE_INTERVALS.accountMinMs)
  })

  it('派生表与逐平台表必须是同一个账号档（两张表各存一份 = 第二份真源）', () => {
    // resolveIntervals 走逐平台表，而 checkBaselineStrength / calibrate 脚本 / 任何直接读
    // PLATFORM_FREQUENCY_POLICY 的消费者走派生表。若派生表仍留在档位值，同一平台在两张表里
    // 有两个账号档，而"谁读哪张"取决于调用点——正是本模块立项要消灭的形态。
    for (const platform of SUPPORTED_PLATFORMS) {
      expect(PLATFORM_FREQUENCY_POLICY[platform].accountMinMs, `${platform} 派生表账号档`)
        .toBe(PLATFORM_ACCOUNT_MIN_INTERVAL_MS[platform])
      // 另两维仍必须按档（差异化只发生在账号档这一维）；参照值由测试自己写出
      expect(PLATFORM_FREQUENCY_POLICY[platform].platformMinMs, `${platform} 平台档仍按档`)
        .toBe(TIER_PRESET_PLATFORM[PLATFORM_FREQUENCY_POLICY[platform].tier])
      expect(PLATFORM_FREQUENCY_POLICY[platform].accountDailyMax, `${platform} 日配额仍按档`)
        .toBe(TIER_PRESET_DAILY[PLATFORM_FREQUENCY_POLICY[platform].tier])
    }
    expect(SUPPORTED_PLATFORMS.length).toBe(15)
  })

  it('两个解析函数不得互相调用（曾构成无限递归，本条以 RangeError 形式抓住）', () => {
    // resolveIntervals 的账号档由 resolveAccountMinIntervalMs 提供；后者若回头调前者即栈爆。
    // 未知平台那一支最容易写成递归（表里没有它 ⇒ "那就问 resolveIntervals 要基线"）。
    expect(() => resolveAccountMinIntervalMs('some_future_platform', { env: envWith({}) })).not.toThrow()
    expect(() => resolveAccountMinIntervalMs('douyin', { env: envWith({}) })).not.toThrow()
    expect(() => resolveIntervals('some_future_platform', { env: envWith({}) })).not.toThrow()
    // 基线值本身也要是"想清楚过的最严值"：不得低于任何已登记平台（含 60′ 的视频号）
    const maxRegistered = Math.max(...SUPPORTED_PLATFORMS.map((p) => PLATFORM_ACCOUNT_MIN_INTERVAL_MS[p]))
    expect(BASELINE_INTERVALS.accountMinMs).toBeGreaterThanOrEqual(maxRegistered)
  })
})
