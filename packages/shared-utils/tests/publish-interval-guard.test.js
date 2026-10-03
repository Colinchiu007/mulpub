/**
 * Test: publish-interval-guard.js — 发布频率控制
 * 测试: 同账号发布间隔检测、记录、等待时间
 */

const PublishIntervalGuard = require('../src/publish-interval-guard')

// 5 分钟 = 300000ms
const MIN_INTERVAL = 5 * 60 * 1000

describe('PublishIntervalGuard', () => {
  describe('canPublish', () => {
    test('无发布记录时返回 true', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(true)
    })

    test('上次发布不足 5 分钟时返回 false', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(false)
    })

    test('上次发布超过 5 分钟后返回 true', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      // mock: 记录 6 分钟前的时间
      guard.recordPublish('wechat_mp', 'acc_001', Date.now() - MIN_INTERVAL - 60000)
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(true)
    })

    test('同平台不同账号受平台档互相约束（D2 决策：跨账号也要错开）', () => {
      // 本用例断言的是 2026-10-02 之后的语义。旧断言「不同账号同一平台互不影响」把
      // 单档模型钉成了产品规则，而平台风控常按设备/平台聚合，同平台连换多号连发同样危险。
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      expect(guard.canPublish('wechat_mp', 'acc_002')).toBe(false)
      // 换平台不受影响
      expect(guard.canPublish('zhihu', 'acc_002')).toBe(true)
    })

    test('同一账号不同平台互不影响', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      expect(guard.canPublish('zhihu', 'acc_001')).toBe(true)
    })

    test('边界情况：恰好 5 分钟时返回 true', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001', Date.now() - MIN_INTERVAL)
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(true)
    })
  })

  describe('recordPublish', () => {
    test('记录发布后存储时间戳', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      const remaining = guard.getRemainingWait('wechat_mp', 'acc_001')
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThanOrEqual(MIN_INTERVAL)
    })

    test('私有 key 不暴露', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001')
      // 检查不能通过直接访问对象属性找到存储的时间
      const keys = Object.keys(guard)
      expect(keys).not.toContain('wechat_mp:acc_001')
    })
  })

  describe('getRemainingWait', () => {
    test('无发布记录时返回 0', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      expect(guard.getRemainingWait('wechat_mp', 'acc_001')).toBe(0)
    })

    test('发布后返回正确剩余等待时间', () => {
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL })
      guard.recordPublish('wechat_mp', 'acc_001', Date.now() - 60000) // 1 分钟前
      const remaining = guard.getRemainingWait('wechat_mp', 'acc_001')
      // 应剩余约 4 分钟 (240000ms)，允许 100ms 误差
      expect(remaining).toBeGreaterThan(230000)
      expect(remaining).toBeLessThanOrEqual(240000)
    })
  })

  describe('自定义 minInterval', () => {
    test('支持构造函数传入自定义间隔', () => {
      const guard = new PublishIntervalGuard({ minInterval: 10000 }) // 10 秒
      guard.recordPublish('wechat_mp', 'acc_001')
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(false)
      // 1 秒后还在间隔内
      guard.recordPublish('wechat_mp', 'acc_001', Date.now() - 5000) // 5 秒前
      expect(guard.canPublish('wechat_mp', 'acc_001')).toBe(false)
    })
  })

  describe('可插拔存储', () => {
    test('支持外部 store 实现', () => {
      const externalStore = new Map()
      const store = {
        get: (key) => externalStore.get(key) ?? null,
        set: (key, value) => { externalStore.set(key, value) }
      }
      const guard = new PublishIntervalGuard({ minInterval: MIN_INTERVAL, store })
      guard.recordPublish('wechat_mp', 'acc_001')
      // 数据应存储在外部的 store 中
      const storedKey = [...externalStore.keys()].find(k => k.startsWith('wechat_mp'))
      expect(storedKey).toBeTruthy()
      expect(externalStore.get(storedKey)).toBeGreaterThan(0)
    })
  })

  describe('两档策略（policy 模式，生产装配路径）', () => {
    const ACCOUNT_MIN = 30 * 60 * 1000
    const PLATFORM_MIN = 3 * 60 * 1000
    const T0 = 1_700_000_000_000

    function makeGuard (overrides = {}) {
      const store = new Map()
      const guard = new PublishIntervalGuard({
        policy: () => ({ accountMinMs: ACCOUNT_MIN, platformMinMs: PLATFORM_MIN }),
        store: {
          get: (k) => (store.has(k) ? store.get(k) : null),
          set: (k, v) => { store.set(k, v) },
        },
        now: () => T0,
        ...overrides,
      })
      return { guard, store }
    }

    test('check 返回形状精确（allowed/remainingMs/bucket）', () => {
      const { guard } = makeGuard()
      expect(guard.check('douyin', 'acc_1')).toEqual({
        allowed: true, remainingMs: 0, bucket: null,
      })
    })

    test('账号档未满时 bucket=account，等待取账号档', () => {
      const { guard } = makeGuard()
      // 20 分钟前发布过同账号 → 账号档(30min)未满、平台档(3min)已满
      guard.recordPublish('douyin', 'acc_1', T0 - 20 * 60 * 1000)
      const r = guard.check('douyin', 'acc_1')
      expect(r).toEqual({ allowed: false, remainingMs: 10 * 60 * 1000, bucket: 'account' })
    })

    test('只有平台档未满时 bucket=platform（同平台换号连发的形态）', () => {
      const { guard } = makeGuard()
      guard.recordPublish('douyin', 'acc_1', T0 - 2 * 60 * 1000)
      const r = guard.check('douyin', 'acc_2')
      expect(r).toEqual({ allowed: false, remainingMs: 1 * 60 * 1000, bucket: 'platform' })
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

    test('缺席账号之间也互相占用平台档窗口', () => {
      const { guard } = makeGuard()
      guard.recordPublish('douyin', 'acc_1')
      expect(guard.check('douyin', null).allowed).toBe(false)
      expect(guard.check('douyin', null).bucket).toBe('platform')
    })

    test('档位为 0 表示显式关闭，恒放行', () => {
      const { guard } = makeGuard({
        policy: () => ({ accountMinMs: 0, platformMinMs: 0 }),
      })
      guard.recordPublish('douyin', 'acc_1', T0)
      expect(guard.check('douyin', 'acc_1')).toEqual({ allowed: true, remainingMs: 0, bucket: null })
    })

    test('policy 按平台差异化取值（未知平台不得被放行）', () => {
      const table = {
        douyin: { accountMinMs: 1000, platformMinMs: 500 },
      }
      const store = new Map()
      const guard = new PublishIntervalGuard({
        policy: (p) => table[p] || { accountMinMs: 9999, platformMinMs: 8888 },
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
      })
      guard.recordPublish('douyin', 'a', T0 - 600)
      expect(guard.check('douyin', 'a').remainingMs).toBe(400)
      // 未登记平台回落调用方给的最严档，而不是 0
      guard.recordPublish('mystery', 'a', T0 - 600)
      expect(guard.check('mystery', 'a').allowed).toBe(false)
      expect(guard.check('mystery', 'a').remainingMs).toBe(9999 - 600)
    })

    test('recordPublish 一次写两档，两个键都落 store', () => {
      const { guard, store } = makeGuard()
      guard.recordPublish('douyin', 'acc_1')
      expect([...store.keys()].sort()).toEqual(['douyin:*', 'douyin:acc_1'])
    })

    test('minInterval 兼容模式下两档同值（现存测试语义保持）', () => {
      const store = new Map()
      const guard = new PublishIntervalGuard({
        minInterval: 1000,
        store: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => { store.set(k, v) } },
        now: () => T0,
      })
      guard.recordPublish('douyin', 'acc_1', T0 - 400)
      expect(guard.check('douyin', 'acc_1')).toEqual({ allowed: false, remainingMs: 600, bucket: 'account' })
      expect(guard.check('douyin', 'acc_2')).toEqual({ allowed: false, remainingMs: 600, bucket: 'platform' })
    })
  })
})
