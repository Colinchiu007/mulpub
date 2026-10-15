/**
 * Test: publish-interval-guard.js — 发布频率控制（v3）
 *
 * 覆盖：两档间隔、日配额、抖动、release 回滚（乐观并发 / prev 缺失 / 防风上限）、
 * key 构造、未登记平台出声、跨日边界、计数读回容错、可插拔存储。
 *
 * ⚠️ v2 起守卫**默认开启抖动**（ratio=0.4，保守方向：宁多等不少等），
 *    断言精确 remainingMs 的用例必须显式传 `jitterRatio: 0`。
 * ⚠️ v3 起「每账号每日回滚次数」的上限取 `max(2, dailyMax)` 与独立封顶
 *    `MAX_ROLLBACK_PER_DAY` 的**较小值**：日配额被放大时，回滚许可不得跟着放大。
 */

const PublishIntervalGuard = require('../src/publish-interval-guard')
const { buildKey, InMemoryDailyStore } = require('../src/publish-interval-guard')

const MIN_INTERVAL = 5 * 60 * 1000
const T0 = 1_700_000_000_000
const DAY1 = '2026-10-10'
const DAY2 = '2026-10-11'

/** 精确值断言用的守卫工厂：抖动默认关闭 */
function exactGuard (options = {}) {
  return new PublishIntervalGuard({ jitterRatio: 0, ...options })
}

describe('PublishIntervalGuard v2', () => {
  describe('canPublish / 基础两档', () => {
    test('无发布记录时返回 true', () => {
      const guard = exactGuard({ minInterval: MIN_INTERVAL })
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(true)
    })

    test('上次发布不足 5 分钟时返回 false', () => {
      const guard = exactGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(false)
    })

    test('上次发布超过 5 分钟后返回 true', () => {
      const guard = exactGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001', Date.now() - MIN_INTERVAL - 60000)
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(true)
    })

    test('同平台不同账号受平台档互相约束（跨账号也要错开）', () => {
      const guard = exactGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      expect(guard.canPublish('wechat_mp', 'acc_002')).toBe(false)
      expect(guard.canPublish('zhihu', 'acc_002')).toBe(true)
    })

    test('同一账号不同平台互不影响', () => {
      const guard = exactGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      expect(guard.canPublish('zhihu', 'acc_001')).toBe(true)
    })

    test('边界情况：恰好 5 分钟时返回 true', () => {
      const guard = exactGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001', Date.now() - MIN_INTERVAL)
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(true)
    })
  })

  describe('getRemainingWait / 可插拔存储', () => {
    test('发布后返回正确剩余等待时间（抖动关闭）', () => {
      const guard = exactGuard({ minInterval: MIN_INTERVAL, now: () => T0 })
      guard.recordPublish('wechat_mp', 'acc_001', T0 - 60000)
      expect(guard.getRemainingWait('wechat_mp', 'acc_001')).toBe(240000)
    })

    test('支持外部 store 实现', () => {
      const externalStore = new Map()
      const store = {
        get: (key) => externalStore.get(key) ?? null,
        set: (key, value) => { externalStore.set(key, value) },
      }
      const guard = exactGuard({ minInterval: MIN_INTERVAL, store })
      guard.recordPublish('wechat_mp', 'acc_001')
      const storedKey = [...externalStore.keys()].find(k => k.startsWith('wechat_mp'))
      expect(storedKey).toBeTruthy()
      expect(externalStore.get(storedKey)).toBeGreaterThan(0)
    })

    test('私有 key 不暴露为实例属性', () => {
      const guard = exactGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      expect(Object.keys(guard)).not.toContain('wechat_mp:acc_001')
    })
  })

  describe('key 构造（buildKey）', () => {
    test('平台段与账号段分别 percent-encode，分隔符不产生碰撞', () => {
      expect(buildKey('weibo', 'a:b')).toBe('weibo:a%3Ab')
      expect(buildKey('weibo', 'a#b')).toBe('weibo:a%23b')
      // 分隔符被编码 ⇒ 两段不同组合不会撞成同一 key
      expect(buildKey('weibo', 'a:b')).not.toBe(buildKey('weibo:a', 'b'))
    })

    test('账号缺席/空白 ⇒ 平台档哨兵 *，以字面量追加（不参与编码）', () => {
      for (const missing of [undefined, null, '', '   ']) {
        expect(buildKey('weibo', missing)).toBe('weibo:*')
      }
    })

    test('守卫内部一律用 buildKey（recordPublish 落键与之一致）', () => {
      const store = new Map()
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 1000, platformMinMs: 500 }),
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
      })
      guard.recordPublish('douyin', 'a:b', T0)
      expect([...store.keys()].sort()).toEqual(['douyin:*', 'douyin:a%3Ab'])
    })
  })

  describe('两档策略（policy 模式，生产装配路径）', () => {
    const ACCOUNT_MIN = 30 * 60 * 1000
    const PLATFORM_MIN = 3 * 60 * 1000

    function makeGuard (overrides = {}) {
      const store = new Map()
      const guard = exactGuard({
        policy: () => ({ accountMinMs: ACCOUNT_MIN, platformMinMs: PLATFORM_MIN, accountDailyMax: 0 }),
        store: {
          get: (k) => (store.has(k) ? store.get(k) : null),
          set: (k, v) => { store.set(k, v) },
        },
        now: () => T0,
        ...overrides,
      })
      return { guard, store }
    }

    test('check 返回形状精确（含 v2 新增字段 reason/daily）', () => {
      const { guard } = makeGuard()
      expect(guard.check('douyin', 'acc_1')).toEqual({
        allowed: true, remainingMs: 0, bucket: null, reason: null, daily: null,
      })
    })

    test('账号档未满时 bucket=account，等待取账号档', () => {
      const { guard } = makeGuard()
      guard.recordPublish('douyin', 'acc_1', T0 - 20 * 60 * 1000)
      expect(guard.check('douyin', 'acc_1')).toEqual({
        allowed: false, remainingMs: 10 * 60 * 1000, bucket: 'account', reason: 'interval', daily: null,
      })
    })

    test('只有平台档未满时 bucket=platform（同平台换号连发的形态）', () => {
      const { guard } = makeGuard()
      guard.recordPublish('douyin', 'acc_1', T0 - 2 * 60 * 1000)
      expect(guard.check('douyin', 'acc_2')).toEqual({
        allowed: false, remainingMs: 1 * 60 * 1000, bucket: 'platform', reason: 'interval', daily: null,
      })
    })

    test('两档同时未满时取较大的等待时间，并报告更严的那一档', () => {
      const { guard } = makeGuard()
      guard.recordPublish('douyin', 'acc_1', T0 - 25 * 60 * 1000)
      const r = guard.check('douyin', 'acc_1')
      expect(r.allowed).toBe(false)
      expect(r.remainingMs).toBe(5 * 60 * 1000)
      expect(r.bucket).toBe('account')
    })

    test('accountId 缺席不得绕过门禁：账号档跳过、平台档仍生效', () => {
      for (const missing of [undefined, null, '', '   ']) {
        const { guard } = makeGuard()
        expect(guard.check('douyin', missing).allowed).toBe(true)
        guard.recordPublish('douyin', missing, T0 - 60 * 1000)
        const r = guard.check('douyin', missing)
        expect(r.allowed, `missing=${String(missing)}`).toBe(false)
        expect(r.bucket, `missing=${String(missing)}`).toBe('platform')
        expect(r.remainingMs).toBe(2 * 60 * 1000)
      }
    })

    test('档位为 0 表示显式关闭，恒放行', () => {
      const { guard } = makeGuard({
        policy: () => ({ accountMinMs: 0, platformMinMs: 0, accountDailyMax: 0 }),
      })
      guard.recordPublish('douyin', 'acc_1', T0)
      expect(guard.check('douyin', 'acc_1')).toEqual({
        allowed: true, remainingMs: 0, bucket: null, reason: null, daily: null,
      })
    })

    test('policy 按平台差异化取值（未知平台不得被放行）', () => {
      const table = { douyin: { accountMinMs: 1000, platformMinMs: 500 } }
      const store = new Map()
      const guard = exactGuard({
        policy: (p) => table[p] || { accountMinMs: 9999, platformMinMs: 8888 },
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
      })
      guard.recordPublish('douyin', 'a', T0 - 600)
      expect(guard.check('douyin', 'a').remainingMs).toBe(400)
      guard.recordPublish('mystery', 'a', T0 - 600)
      expect(guard.check('mystery', 'a').allowed).toBe(false)
      expect(guard.check('mystery', 'a').remainingMs).toBe(9999 - 600)
    })

    test('recordPublish 一次写两档，两个键都落 store', () => {
      const { guard, store } = makeGuard()
      guard.recordPublish('douyin', 'acc_1')
      expect([...store.keys()].sort()).toEqual(['douyin:*', 'douyin:acc_1'])
    })

    test('minInterval 兼容模式下两档同值', () => {
      const store = new Map()
      const guard = exactGuard({
        minInterval: 1000,
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
      })
      guard.recordPublish('douyin', 'acc_1', T0 - 400)
      expect(guard.check('douyin', 'acc_1').remainingMs).toBe(600)
      expect(guard.check('douyin', 'acc_1').bucket).toBe('account')
      expect(guard.check('douyin', 'acc_2').remainingMs).toBe(600)
      expect(guard.check('douyin', 'acc_2').bucket).toBe('platform')
    })
  })

  describe('日配额（v2 新维度）', () => {
    function makeDailyGuard (opts = {}) {
      const store = new Map()
      const dailyStore = new InMemoryDailyStore()
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 0, platformMinMs: 0, accountDailyMax: 3 }),
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        dailyStore,
        now: () => T0,
        today: () => DAY1,
        ...opts,
      })
      return { guard, dailyStore, store }
    }

    test('未达上限时放行，并回报当日用量', () => {
      const { guard } = makeDailyGuard()
      const r = guard.check('douyin', 'acc_1')
      expect(r.allowed).toBe(true)
      expect(r.daily).toEqual({ used: 0, max: 3, dayKey: DAY1 })
    })

    test('达到上限 ⇒ 独立否决：bucket=daily、remainingMs=0、reason=daily_quota', () => {
      const { guard } = makeDailyGuard()
      for (let i = 0; i < 3; i++) guard.recordPublish('douyin', 'acc_1')
      const r = guard.check('douyin', 'acc_1')
      expect(r.allowed).toBe(false)
      expect(r.bucket).toBe('daily')
      expect(r.reason).toBe('daily_quota')
      expect(r.remainingMs).toBe(0)
      expect(r.daily).toEqual({ used: 3, max: 3, dayKey: DAY1 })
    })

    test('日配额优先于间隔（同时命中时报 daily，因为它决定的是「改期」而非「等待」）', () => {
      const store = new Map()
      const dailyStore = new InMemoryDailyStore()
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 10 * 60 * 1000, platformMinMs: 0, accountDailyMax: 1 }),
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        dailyStore,
        now: () => T0,
        today: () => DAY1,
      })
      guard.recordPublish('douyin', 'acc_1')
      const r = guard.check('douyin', 'acc_1')
      expect(r.bucket).toBe('daily')
      expect(r.reason).toBe('daily_quota')
    })

    test('跨日自动重置（day_key 变化即重新计数）', () => {
      let day = DAY1
      const { guard } = makeDailyGuard({ today: () => day })
      for (let i = 0; i < 3; i++) guard.recordPublish('douyin', 'acc_1')
      expect(guard.check('douyin', 'acc_1').allowed).toBe(false)
      day = DAY2
      const r = guard.check('douyin', 'acc_1')
      expect(r.allowed).toBe(true)
      expect(r.daily).toEqual({ used: 0, max: 3, dayKey: DAY2 })
    })

    test('日配额 0 = 关闭该档（不得误判为「已达上限」）', () => {
      const { guard } = makeDailyGuard({
        policy: () => ({ accountMinMs: 0, platformMinMs: 0, accountDailyMax: 0 }),
      })
      for (let i = 0; i < 10; i++) guard.recordPublish('douyin', 'acc_1')
      expect(guard.check('douyin', 'acc_1').allowed).toBe(true)
      expect(guard.check('douyin', 'acc_1').daily).toBe(null)
    })

    test('accountId 缺席 ⇒ 日配额跳过（无身份即无账号维度配额）', () => {
      const { guard } = makeDailyGuard()
      for (let i = 0; i < 5; i++) guard.recordPublish('douyin', null)
      expect(guard.check('douyin', null).allowed).toBe(true)
    })

    test('计数读回容错：TEXT 亲和带回 .0 / 非法值按 0', () => {
      const dailyStore = {
        getDay: () => ({ count: '3.0', rollback_count: '0.0' }),
        incrDay: () => 0,
        decrDay: () => 0,
      }
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 0, platformMinMs: 0, accountDailyMax: 3 }),
        dailyStore,
        now: () => T0,
        today: () => DAY1,
      })
      expect(guard.check('douyin', 'acc_1').bucket).toBe('daily')

      const badStore = {
        getDay: () => ({ count: 'abc', rollback_count: null }),
        incrDay: () => 0,
        decrDay: () => 0,
      }
      const g2 = exactGuard({
        policy: () => ({ accountMinMs: 0, platformMinMs: 0, accountDailyMax: 3 }),
        dailyStore: badStore,
        now: () => T0,
        today: () => DAY1,
      })
      expect(g2.check('douyin', 'acc_1').allowed).toBe(true)
    })

    test('dailyStore 抛错时 fail-open 到「无配额信息」并出声（不阻断发布）', () => {
      const warns = []
      const dailyStore = {
        getDay: () => { throw new Error('boom') },
        incrDay: () => 0,
        decrDay: () => 0,
      }
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 0, platformMinMs: 0, accountDailyMax: 3 }),
        dailyStore,
        now: () => T0,
        today: () => DAY1,
        warn: (m) => warns.push(m),
      })
      expect(guard.check('douyin', 'acc_1').allowed).toBe(true)
      expect(warns.length).toBe(1)
    })
  })

  describe('抖动（v2 新维度）', () => {
    test('默认开启 0.4：等待落在 [base, base×1.4) 且只增不减', () => {
      const guard = new PublishIntervalGuard({
        policy: () => ({ accountMinMs: 100000, platformMinMs: 0, accountDailyMax: 0 }),
        now: () => T0,
      })
      expect(guard.jitterRatio).toBe(0.4)
      guard.recordPublish('douyin', 'acc_1', T0 - 50000) // base = 50000
      const base = 50000
      for (let i = 0; i < 200; i++) {
        const r = guard.check('douyin', 'acc_1').remainingMs
        expect(r).toBeGreaterThanOrEqual(base)
        expect(r).toBeLessThan(base * 1.4)
      }
    })

    test('ratio=0 严格退化为 v1 行为（逐值相等）', () => {
      const store = new Map()
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 100000, platformMinMs: 0, accountDailyMax: 0 }),
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
      })
      guard.recordPublish('douyin', 'acc_1', T0 - 50000)
      for (let i = 0; i < 20; i++) {
        expect(guard.check('douyin', 'acc_1').remainingMs).toBe(50000)
      }
    })

    test('确定性随机源：random=1 采样上界内，random=0 取下界', () => {
      const mk = (rand) => {
        const store = new Map()
        const g = new PublishIntervalGuard({
          policy: () => ({ accountMinMs: 100000, platformMinMs: 0, accountDailyMax: 0 }),
          store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
          now: () => T0,
          random: () => rand,
          jitterRatio: 0.4,
        })
        g.recordPublish('douyin', 'acc_1', T0 - 50000)
        return g.check('douyin', 'acc_1').remainingMs
      }
      expect(mk(0)).toBe(50000)
      expect(mk(0.999999)).toBe(70000)
    })

    test('含抖动系数后仍被钳在 setTimeout 安全值内（防溢出被钳成 1ms 忙循环）', () => {
      const store = new Map()
      const guard = new PublishIntervalGuard({
        policy: () => ({ accountMinMs: 1_800_000_000, platformMinMs: 0, accountDailyMax: 0 }),
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
        random: () => 0.999999,
        jitterRatio: 0.4,
      })
      guard.recordPublish('douyin', 'acc_1', T0 - 1)
      const r = guard.check('douyin', 'acc_1').remainingMs
      expect(r).toBeLessThanOrEqual(PublishIntervalGuard.TIMER_SAFE_MS)
      expect(r).toBeGreaterThan(0)
    })
  })

  describe('release 回滚（P0-1 核心）', () => {
    function makeReleaseGuard (opts = {}) {
      const store = new Map()
      const dailyStore = new InMemoryDailyStore()
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 10 * 60 * 1000, platformMinMs: 2 * 60 * 1000, accountDailyMax: 3 }),
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        dailyStore,
        now: () => T0,
        today: () => DAY1,
        ...opts,
      })
      return { guard, store, dailyStore }
    }

    test('回滚未提交尝试：窗口还原 + 配额回补 + 回滚计数 +1', () => {
      const { guard, dailyStore } = makeReleaseGuard()
      const hold = guard.recordPublish('douyin', 'acc_1')
      expect(guard.check('douyin', 'acc_1').allowed).toBe(false)
      expect(dailyStore.getDay('douyin:acc_1', DAY1).count).toBe(1)

      const r = guard.release('douyin', 'acc_1', hold)
      expect(r).toEqual({ released: true, reason: null })
      expect(guard.check('douyin', 'acc_1').allowed).toBe(true)
      expect(dailyStore.getDay('douyin:acc_1', DAY1).count).toBe(0)
      expect(dailyStore.getDay('douyin:acc_1', DAY1).rollbackCount).toBe(1)
    })

    test('幂等：同一 hold 重复 release 只回补一次', () => {
      const { guard, dailyStore } = makeReleaseGuard()
      const hold = guard.recordPublish('douyin', 'acc_1')
      expect(guard.release('douyin', 'acc_1', hold).released).toBe(true)
      const again = guard.release('douyin', 'acc_1', hold)
      expect(again.released).toBe(false)
      expect(again.reason).toBe('window_taken')
      expect(dailyStore.getDay('douyin:acc_1', DAY1).count).toBe(0)
      expect(dailyStore.getDay('douyin:acc_1', DAY1).rollbackCount).toBe(1)
    })

    test('窗口已被后续提交覆盖 ⇒ 不回滚（绝不回滚他人窗口）', () => {
      const { guard, dailyStore } = makeReleaseGuard()
      const hold = guard.recordPublish('douyin', 'acc_1', T0 - 1000)
      guard.recordPublish('douyin', 'acc_1', T0) // 后续提交覆盖
      const r = guard.release('douyin', 'acc_1', hold)
      expect(r.released).toBe(false)
      expect(r.reason).toBe('window_taken')
      expect(guard.check('douyin', 'acc_1').allowed).toBe(false)
      // 计数不得被错误回补
      expect(dailyStore.getDay('douyin:acc_1', DAY1).count).toBe(2)
    })

    test('prev 缺失/错配 ⇒ no-op 并出声（方向恒为多等）', () => {
      const warns = []
      const { guard } = makeReleaseGuard({ warn: (m) => warns.push(m) })
      guard.recordPublish('douyin', 'acc_1')
      expect(guard.release('douyin', 'acc_1', undefined)).toEqual({ released: false, reason: 'prev_missing' })
      expect(guard.release('douyin', 'acc_1', { at: 'not-a-number' }).released).toBe(false)
      expect(warns.length).toBe(2)
      expect(guard.check('douyin', 'acc_1').allowed).toBe(false)
    })

    test('防风上限：每账号每日回滚次数达 max(2, dailyMax) 后拒绝回滚', () => {
      const warns = []
      const { guard } = makeReleaseGuard({ warn: (m) => warns.push(m) })
      // dailyMax = 3 ⇒ 上限 3
      for (let i = 0; i < 3; i++) {
        const hold = guard.recordPublish('douyin', 'acc_1')
        expect(guard.release('douyin', 'acc_1', hold).released).toBe(true)
      }
      const hold = guard.recordPublish('douyin', 'acc_1')
      const r = guard.release('douyin', 'acc_1', hold)
      expect(r.released).toBe(false)
      expect(r.reason).toBe('rollback_cap')
      expect(warns.some(m => m.includes('回滚已达上限'))).toBe(true)
      expect(guard.check('douyin', 'acc_1').allowed).toBe(false)
    })

    test('防风上限有硬顶：日配额被放大（v3 的 ×10）不得把回滚许可一起放大', () => {
      // 耦合点：v3 把 accountDailyMax 取成 v2 的 10 倍（short 档 20→200）。
      // 若上限仍按 max(2, dailyMax) 单点推导，短内容档的"每日可回滚次数"会跟着变成 200，
      // 防风闸形同撤销——方向必须是"多等"，所以封顶取独立常量。
      const warns = []
      const { guard } = makeReleaseGuard({
        policy: () => ({ accountMinMs: 60 * 1000, platformMinMs: 60 * 1000, accountDailyMax: 200 }),
        warn: (m) => warns.push(m),
      })
      for (let i = 0; i < 5; i++) {
        const hold = guard.recordPublish('weibo', 'acc_1')
        expect(guard.release('weibo', 'acc_1', hold).released, `第 ${i + 1} 次`)
          .toBe(true)
      }
      const hold6 = guard.recordPublish('weibo', 'acc_1')
      expect(guard.release('weibo', 'acc_1', hold6)).toEqual({ released: false, reason: 'rollback_cap' })
      expect(warns.some(m => m.includes('回滚已达上限'))).toBe(true)
      // 真表读数必须**大于**封顶，否则这条锁测的是"封顶从不生效"的死支路。
      // QM-6 后端轴 B9：逐 tier 都要过，只测 weibo 一档等于给其余两档留了"封顶是否活着的盲区"。
      const policyModule = require('../src/publish-frequency-policy')
      for (const platform of policyModule.SUPPORTED_PLATFORMS) {
        const r = policyModule.resolveIntervals(platform, { env: {} })
        expect(r.accountDailyMax, `${platform}=${r.tier}`)
          .toBeGreaterThan(PublishIntervalGuard.MAX_ROLLBACK_PER_DAY)
      }
    })

    test('v4：三档真实日配额下回滚许可仍恒等于封顶（配额抬高不得放大许可）', () => {
      // 上一条锁测的是"真表读数 > 封顶"这个**前提**；这条测前提成立后的**结果**：
      // 直接把真实策略接进守卫，逐档读 `_rollbackCap`，防止有人把公式改回 `max(2, dailyMax)`
      // —— v4 下那会长成 200/350/500，而用户看到的是"每天能发 500 条"，
      // 不是"每天能撤销 500 次窗口"。两者混为一谈正是 v3 立这条硬顶的理由。
      const policyModule = require('../src/publish-frequency-policy')
      const guard = exactGuard({
        policy: (p) => policyModule.resolveIntervals(p, { env: {} }),
      })
      const BY_TIER = { long: 'wechat_mp', clip: 'douyin', short: 'weibo' }
      for (const [tier, platform] of Object.entries(BY_TIER)) {
        const dailyMax = policyModule.resolveIntervals(platform, { env: {} }).accountDailyMax
        expect(guard._rollbackCap(platform), `${tier}=${platform} dailyMax=${dailyMax}`)
          .toBe(PublishIntervalGuard.MAX_ROLLBACK_PER_DAY)
      }
      // 封顶本身也得钉住：它是"许可"的唯一上界，改它等于改这道闸的强度
      expect(PublishIntervalGuard.MAX_ROLLBACK_PER_DAY).toBe(5)
    })

    test('_intervals 必须回传 tier —— 设置页按档位分组显示（QM-6 前端轴 C2）', () => {
      // 现场缺陷：`ipc-handlers/publish-frequency.js` 把 `_intervals(p)` 的返回原样发给渲染层，
      // 而 `PublishFrequencySettings.vue::currentTierText` 读 `v.tier` 拼文案。
      // 返回形状里没有 tier ⇒ 用户屏幕上每组都是「undefined（4 个平台，如 wechat_mp）：…」。
      // 测试桩当时**注入了生产不存在的 tier**，所以四层测试全绿而 100% 复现（测试替身补字段）。
      const guard = exactGuard({ policy: (p) => require('../src/publish-frequency-policy').resolveIntervals(p, { env: {} }) })
      expect(guard._intervals('wechat_mp')).toEqual({
        // v4：账号档 5′ 不变，平台档统一 1′，长文日配额由 30 抬到 200
        tier: 'long', accountMinMs: 5 * 60 * 1000, platformMinMs: 1 * 60 * 1000, accountDailyMax: 200,
      })
      // 未登记平台：tier 取回落档名（不是 undefined），否则同一屏再次出现脏字
      const unknown = guard._intervals('not_registered')
      expect(unknown.tier).toBe('long')
    })

    test('minInterval 兼容模式下 tier 仍须来自策略解析（不得缺键）', () => {
      const guard = exactGuard({
        minInterval: 60 * 1000,
        policy: () => ({ tier: 'clip', accountMinMs: 3 * 60 * 1000, platformMinMs: 2 * 60 * 1000, accountDailyMax: 50 }),
      })
      const r = guard._intervals('douyin')
      expect(r.accountMinMs).toBe(60 * 1000)
      expect(r.tier, '兼容分支也必须给出档位标签').toBe('clip')
    })

    test('平台键独立判定：账号键已被覆盖但平台键仍是本次 ⇒ 仍释放平台键', () => {
      const { guard, store } = makeReleaseGuard()
      const hold = guard.recordPublish('douyin', 'acc_1') // 写 acc_1 与 *
      // 另一次发布覆盖账号键（不同时刻），平台键也被覆盖 ⇒ 整体不释放
      guard.recordPublish('douyin', 'acc_1', T0 + 1)
      expect(guard.release('douyin', 'acc_1', hold).released).toBe(false)
      // 直接构造：仅平台键匹配
      store.set('douyin:*', hold.at)
      store.set('douyin:acc_1', hold.at + 5)
      const r = guard.release('douyin', 'acc_1', hold)
      expect(r.released).toBe(true)
    })

    test('dailyStore 缺失时 release 不抛（失败路径上抛错会吞掉原错误）', () => {
      const store = new Map()
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 1000, platformMinMs: 0, accountDailyMax: 3 }),
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
      })
      const hold = guard.recordPublish('douyin', 'acc_1')
      expect(() => guard.release('douyin', 'acc_1', hold)).not.toThrow()
      expect(guard.release('douyin', 'acc_1', hold).released).toBe(false)
    })
  })

  describe('clearWindow 人为清窗（紧急放行专用）', () => {
    function makeClearGuard () {
      const store = new Map()
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 10 * 60 * 1000, platformMinMs: 2 * 60 * 1000, accountDailyMax: 3 }),
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
        today: () => DAY1,
      })
      return { guard, store }
    }

    test('同时清掉账号键与平台键，并回报清掉了哪些键', () => {
      const { guard } = makeClearGuard()
      guard.recordPublish('douyin', 'acc_1')
      expect(guard.check('douyin', 'acc_1').allowed).toBe(false)

      const r = guard.clearWindow('douyin', 'acc_1')
      expect(r.cleared).toBe(true)
      expect(r.clearedKeys.sort()).toEqual(['douyin:*', 'douyin:acc_1'])
      expect(guard.check('douyin', 'acc_1').allowed).toBe(true)
      // 副作用如实：同平台其他账号也不再被平台键拦住（代价由每日上限+冷却+审计约束）
      expect(guard.check('douyin', 'acc_2').allowed).toBe(true)
    })

    test('无窗口可清时返回 cleared=false（不得谎报成功）', () => {
      const { guard } = makeClearGuard()
      const r = guard.clearWindow('douyin', 'acc_1')
      expect(r).toEqual({ cleared: false, clearedKeys: [] })
    })

    test('不影响其他平台', () => {
      const { guard } = makeClearGuard()
      guard.recordPublish('douyin', 'acc_1')
      guard.recordPublish('kuaishou', 'acc_1')
      guard.clearWindow('douyin', 'acc_1')
      expect(guard.check('douyin', 'acc_1').allowed).toBe(true)
      expect(guard.check('kuaishou', 'acc_1').allowed).toBe(false)
    })

    test('accountId 缺席时只清平台键', () => {
      const { guard, store } = makeClearGuard()
      guard.recordPublish('douyin', null)
      const r = guard.clearWindow('douyin', null)
      expect(r.clearedKeys).toEqual(['douyin:*'])
      expect(store.get('douyin:*')).toBe(null)
    })
  })

  describe('未登记平台出声（v2 变更：由静默改为一次告警）', () => {
    test('同平台只出声一次，且内容含平台名与档位', () => {
      const warns = []
      const guard = exactGuard({
        policy: (p) => (p === 'douyin'
          ? { accountMinMs: 1000, platformMinMs: 500, accountDailyMax: 1, fallback: false }
          : { accountMinMs: 2000, platformMinMs: 1000, accountDailyMax: 2, fallback: true }),
        now: () => T0,
        warn: (m) => warns.push(m),
      })
      guard.check('mystery', 'a')
      guard.check('mystery', 'a')
      guard.check('mystery', 'a')
      expect(warns.length).toBe(1)
      expect(warns[0]).toContain('mystery')
      expect(warns[0]).toContain('未登记')

      // 另一个未登记平台各自出声一次
      guard.check('mystery2', 'a')
      expect(warns.length).toBe(2)
    })

    test('已登记平台不出声', () => {
      const warns = []
      const guard = exactGuard({
        policy: () => ({ accountMinMs: 1000, platformMinMs: 500, accountDailyMax: 1, fallback: false }),
        now: () => T0,
        warn: (m) => warns.push(m),
      })
      guard.check('douyin', 'a')
      expect(warns).toEqual([])
    })
  })

  describe('本机运营日边界与同源时钟', () => {
    test('msUntilNextDay 与 today() 共用注入时钟', () => {
      const t = new Date('2026-10-10T23:00:00').getTime()
      const guard = exactGuard({ now: () => t, jitterRatio: 0 })
      expect(guard.today()).toBe('2026-10-10')
      // 距次日 00:00:05 = 1 小时 5 秒
      expect(guard.msUntilNextDay()).toBe(60 * 60 * 1000 + 5000)
    })

    test('默认 today() 由 now() 推导（不读真实系统时钟）', () => {
      const t = new Date('2026-01-02T10:00:00').getTime()
      const guard = exactGuard({ now: () => t })
      expect(guard.today()).toBe('2026-01-02')
    })
  })
})
