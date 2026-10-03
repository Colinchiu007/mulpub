/**
 * Test: publish-frequency-policy.js — 发布最小间隔策略单一真源
 *
 * 覆盖：15 平台两档全覆盖、未知平台回落最严档（不得为 0）、环境变量覆盖、
 * 0 = 显式关闭、非法值回落并出声。
 */
const {
  resolveIntervals,
  BASELINE_INTERVALS,
  PLATFORM_FREQUENCY_POLICY,
  ENV_ACCOUNT_MIN_INTERVAL,
  ENV_PLATFORM_MIN_INTERVAL,
  SUPPORTED_PLATFORMS,
} = require('../src/publish-frequency-policy')

const MIN = 60 * 1000

describe('publish-frequency-policy', () => {
  describe('平台覆盖', () => {
    it('15 个支持平台全部登记，且两档均为正数', () => {
      // Array.prototype.sort 按 UTF-16 码元序：'wechat_mp' < 'weibo'（'c' < 'i'）
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
      }
    })

    it('三组代表平台逐档精确等于策略表', () => {
      // 长文低频
      expect(resolveIntervals('wechat_mp', { env: {} })).toEqual({
        accountMinMs: 60 * MIN, platformMinMs: 5 * MIN,
      })
      // 短视频/图文社区
      expect(resolveIntervals('douyin', { env: {} })).toEqual({
        accountMinMs: 30 * MIN, platformMinMs: 3 * MIN,
      })
      // 短内容高频容忍
      expect(resolveIntervals('weibo', { env: {} })).toEqual({
        accountMinMs: 10 * MIN, platformMinMs: 1 * MIN,
      })
    })

    it('未知平台回落基线最严档，绝不为 0', () => {
      const r = resolveIntervals('some_future_platform', { env: {} })
      expect(r).toEqual(BASELINE_INTERVALS)
      expect(r.accountMinMs).toBeGreaterThan(0)
      expect(r.platformMinMs).toBeGreaterThan(0)

      // 空/非字符串同样按未知处理（不得抛、不得放行）
      for (const bad of [undefined, null, '', 123, {}]) {
        expect(resolveIntervals(bad, { env: {} })).toEqual(BASELINE_INTERVALS)
      }
    })

    it('策略表里每个平台的 platformMinMs 不得大于 accountMinMs', () => {
      for (const [platform, p] of Object.entries(PLATFORM_FREQUENCY_POLICY)) {
        expect(p.platformMinMs, `${platform}`).toBeLessThanOrEqual(p.accountMinMs)
      }
    })
  })

  describe('环境变量覆盖', () => {
    it('合法值覆盖所有平台的两档', () => {
      const env = { [ENV_ACCOUNT_MIN_INTERVAL]: '45000', [ENV_PLATFORM_MIN_INTERVAL]: '9000' }
      expect(resolveIntervals('douyin', { env })).toEqual({
        accountMinMs: 45000, platformMinMs: 9000,
      })
      expect(resolveIntervals('unknown_x', { env })).toEqual({
        accountMinMs: 45000, platformMinMs: 9000,
      })
    })

    it('0 表示该档显式关闭，且不得触发告警', () => {
      const warns = []
      const env = { [ENV_ACCOUNT_MIN_INTERVAL]: '0' }
      expect(resolveIntervals('weibo', { env, warn: (m) => warns.push(m) })).toEqual({
        accountMinMs: 0, platformMinMs: 1 * MIN,
      })
      expect(warns).toEqual([])
    })

    it('非法值回落策略表并逐条出声告警（禁止静默当 0）', () => {
      for (const bad of ['abc', '-1', 'NaN', 'Infinity', '12x']) {
        const warns = []
        const env = { [ENV_ACCOUNT_MIN_INTERVAL]: bad }
        const r = resolveIntervals('douyin', { env, warn: (m) => warns.push(m) })
        expect(r.accountMinMs, `bad=${JSON.stringify(bad)}`).toBe(30 * MIN)
        expect(warns.length, `bad=${JSON.stringify(bad)} 必须出声`).toBe(1)
        expect(warns[0]).toContain(ENV_ACCOUNT_MIN_INTERVAL)
        expect(warns[0]).toContain(String(bad))
      }
    })

    it('空白值也回落并出声（回显空白原值无诊断价值，只点名变量与默认值）', () => {
      const warns = []
      const env = { [ENV_ACCOUNT_MIN_INTERVAL]: '   ' }
      const r = resolveIntervals('douyin', { env, warn: (m) => warns.push(m) })
      expect(r.accountMinMs).toBe(30 * MIN)
      expect(warns.length).toBe(1)
      expect(warns[0]).toContain(ENV_ACCOUNT_MIN_INTERVAL)
      expect(warns[0]).toContain(String(30 * MIN))
    })

    it('未设置环境变量时回落策略表且不告警', () => {
      const warns = []
      const r = resolveIntervals('zhihu', { env: {}, warn: (m) => warns.push(m) })
      expect(r).toEqual({ accountMinMs: 60 * MIN, platformMinMs: 5 * MIN })
      expect(warns).toEqual([])
    })

    it('只覆盖一档时另一档仍取策略表', () => {
      const env = { [ENV_PLATFORM_MIN_INTERVAL]: '1000' }
      expect(resolveIntervals('douyin', { env })).toEqual({
        accountMinMs: 30 * MIN, platformMinMs: 1000,
      })
    })
  })

  describe('默认 env 来源', () => {
    it('不传 env 时读 process.env，且不会因缺省而抛', () => {
      const saved = process.env[ENV_ACCOUNT_MIN_INTERVAL]
      delete process.env[ENV_ACCOUNT_MIN_INTERVAL]
      try {
        const r = resolveIntervals('douyin')
        expect(r.accountMinMs).toBe(30 * MIN)
      } finally {
        if (saved !== undefined) process.env[ENV_ACCOUNT_MIN_INTERVAL] = saved
      }
    })
  })
})
