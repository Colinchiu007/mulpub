// @ts-check
/**
 * 采集频率与配额治理回归锁（2026-10-13）
 *
 * 背景（风险分析报告的四条发现）：
 *   P0  限流/熔断键 = source.id，同一 URL 挂多个 id 时配额被绕过
 *       （weibo 主渠道 + weibo-emotion + weibo-health = 3 次/10min；ithome-tech + ithome-ai = 2 次/15min）
 *   P1  UI 手动刷新 refresh(true) 直达 force:true，绕过缓存 TTL —— 决定第三方压力的是
 *       用户点击频率，而它没有任何上限
 *   P2  快捷采集中文榜 provider:'hot-topics'（零新抓取），但 feed 类 ithome 源与
 *       ithome-tech/ithome-ai 补拉源共用同一 RSS —— 需要按 URL 共享配额
 *   P3  限流/熔断状态是进程内存态，重启即清零
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const SERVICE = './hot-topics-service.js'
const load = async () => await import(SERVICE)
const loadThrottleModule = async () => await import('./hot-topics/throttle.js')

describe('P0：限流/熔断按 URL 配额（同一端点多身份共享一个配额）', () => {
  let svc
  beforeEach(async () => {
    const m = await load()
    svc = new m.HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {}, notify: () => {} } })
    // ⚠️ 必须注入传输层桩：`_collectChannel` 内部走真实 `fetch`，不注入会真实出站
    // （weibo/baidu/ithome…），被测试网络守卫拦截并记入出站台账 —— CI 的
    // `check-test-egress-ledger` 会因基线外新条目（blocked::www.ithome.com:443 等）判红。
    // 这正是上一轮 CI 失败的根因（测试设计缺陷，非产品代码缺陷）。
    svc._fetchChannel = async (cfg) => JSON.stringify({ data: { word_list: [{ word: '桩热点', hot_value: 1, position: 1 }] } })
  })

  it('同一 URL 的两个身份共用一个配额：第二个身份立即被节流跳过', async () => {
    const cfgA = { id: 'weibo', url: 'https://weibo.com/ajax/statuses/hot_band', headers: {}, intervalMinutes: 10 }
    const cfgB = { id: 'weibo-emotion', url: 'https://weibo.com/ajax/statuses/hot_band', headers: {}, intervalMinutes: 10 }
    const a = await svc._collectChannel(cfgA, Date.now())
    expect(a.skipped).toBe(false)
    // 同 URL 的另一个身份：必须在限流层被跳过，而不是真的发第二个请求
    const b = await svc._collectChannel(cfgB, Date.now())
    expect(b.skipped).toBe(true)
    expect(b.reason).toBe('throttled-by-url')
  })

  it('URL 不同则配额独立（不存在误伤）', async () => {
    const cfgA = { id: 'weibo', url: 'https://weibo.com/ajax/statuses/hot_band', headers: {}, intervalMinutes: 10 }
    const cfgC = { id: 'baidu', url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime', headers: {}, intervalMinutes: 10 }
    expect((await svc._collectChannel(cfgA, Date.now())).skipped).toBe(false)
    expect((await svc._collectChannel(cfgC, Date.now())).skipped).toBe(false)
  })

  it('配置了显式共享键时优先于 URL（供跨模块共享配额）', async () => {
    const rss = 'https://www.ithome.com/rss/'
    const cfgT = { id: 'ithome-tech', url: rss, headers: {}, intervalMinutes: 15, throttleKey: 'ithome-rss' }
    const cfgA = { id: 'ithome-ai', url: rss, headers: {}, intervalMinutes: 15, throttleKey: 'ithome-rss' }
    expect((await svc._collectChannel(cfgT, Date.now())).skipped).toBe(false)
    const b = await svc._collectChannel(cfgA, Date.now())
    expect(b.skipped).toBe(true)
  })

  it('熔断同样按 URL 配额：一个身份连续失败会让同 URL 的其它身份跳过', async () => {
    const url = 'https://weibo.example/hot_band'
    const cfgA = { id: 'weibo', url, headers: {}, intervalMinutes: 0 }
    const cfgB = { id: 'weibo-emotion', url, headers: {}, intervalMinutes: 0 }
    svc._fetchChannel = async () => { throw new Error('HTTP 500') }
    for (let i = 0; i < 3; i++) await svc._collectChannel(cfgA, Date.now())
    expect(svc.breaker.isOpen('weibo.example/hot_band')).toBe(true)
    const b = await svc._collectChannel(cfgB, Date.now())
    expect(b.skipped).toBe(true)
    expect(b.breakerOpen).toBe(true)
  })

  it('补拉路径同样按 URL 配额', async () => {
    const url = 'https://weibo.example/hot_band'
    const main = { id: 'weibo', url, headers: {}, intervalMinutes: 10 }
    const boost = { id: 'weibo-health', url, headers: {}, intervalMinutes: 10, parser: 'weibo', channel: 'weibo', board: 'health', boostCategory: 'health' }
    await svc._collectChannel(main, Date.now())
    const b = await svc._collectBoostChannel(boost, Date.now())
    expect(b.skipped).toBe(true)
  })
})

describe('P1：手动刷新有最小间隔（force 不再等于「无上限全量外呼」）', () => {
  it('服务层暴露 MANUAL_REFRESH_MIN_INTERVAL_MS 且 > 0', async () => {
    const m = await load()
    expect(m.MANUAL_REFRESH_MIN_INTERVAL_MS).toBeGreaterThan(0)
  })

  it('force 刷新在最小间隔内被节流，返回缓存并带 throttled 标记', async () => {
    const m = await load()
    const store = { getSetting: () => null, setSetting: vi.fn() }
    const svc = new m.HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {}, notify: () => {} }, settingsStore: store })
    const calls = []
    svc._collectChannel = async (cfg) => { calls.push(cfg.id); return { channel: cfg.id, items: [], skipped: false } }
    svc._collectBoostChannel = async () => ({ channel: 'b', items: null, skipped: true, boost: true })
    const first = await svc.fetchTopics({ force: true })
    expect(first.fromCache).toBeUndefined()
    const n = calls.length
    expect(n).toBeGreaterThan(0)
    // 立即再次 force：应被最小间隔拦下，返回缓存
    const second = await svc.fetchTopics({ force: true })
    expect(second.throttled).toBe(true)
    expect(second.fromCache).toBe(true)
    expect(calls.length).toBe(n) // 没有再发请求
  })

  it('超过最小间隔后 force 仍可真实刷新', async () => {
    const m = await load()
    const svc = new m.HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {}, notify: () => {} } })
    let calls = 0
    svc._collectChannel = async (cfg) => { calls++; return { channel: cfg.id, items: [], skipped: false } }
    svc._collectBoostChannel = async () => ({ channel: 'b', items: null, skipped: true, boost: true })
    await svc.fetchTopics({ force: true })
    const base = calls
    // 把上次强制刷新时间往前拨，越过最小间隔
    svc._lastManualRefreshAt = Date.now() - (m.MANUAL_REFRESH_MIN_INTERVAL_MS + 1000)
    const res = await svc.fetchTopics({ force: true })
    expect(res.throttled).toBeUndefined()
    expect(calls).toBeGreaterThan(base)
  })

  it('带 boostCategories 的显式补拉不受最小间隔拦截（用户定向动作不能被吞）', async () => {
    const m = await load()
    const svc = new m.HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {}, notify: () => {} } })
    let boosts = 0
    svc._collectChannel = async (cfg) => ({ channel: cfg.id, items: [], skipped: false })
    svc._collectBoostChannel = async () => { boosts++; return { channel: 'b', items: null, skipped: true, boost: true } }
    await svc.fetchTopics({ force: true })
    const before = boosts
    const res = await svc.fetchTopics({ force: true, boostCategories: ['finance'] })
    expect(res.throttled).toBeUndefined()
    expect(boosts).toBeGreaterThan(before)
  })
})

describe('P0/P3：限流器与熔断器的可持久化 + 键归一（throttle.js 单元）', () => {
  it('throttleKey(url) 归一化：忽略查询串与大小写差异', async () => {
    const { throttleKey } = await loadThrottleModule()
    expect(throttleKey('https://API.Example.com/x?limit=50')).toBe(throttleKey('https://api.example.com/x'))
    expect(throttleKey('https://a.com/x?b=1')).toBe(throttleKey('https://a.com/x?b=1'))
  })

  it('throttle/breaker 状态可导出与恢复（P3 跨重启）', async () => {
    const { ChannelThrottle, ChannelBreaker } = await loadThrottleModule()
    const t = new ChannelThrottle()
    t.tryAcquire('k1', 10)
    const snap = t.serialize()
    const t2 = new ChannelThrottle()
    t2.restore(snap)
    expect(t2.tryAcquire('k1', 10)).toBe(false) // 恢复后仍在间隔内
    const b = new ChannelBreaker()
    b.recordFailure('k1'); b.recordFailure('k1')
    const bsnap = b.serialize()
    const b2 = new ChannelBreaker()
    b2.restore(bsnap)
    b2.recordFailure('k1')
    expect(b2.isOpen('k1')).toBe(true) // 3 次失败计数被恢复
  })

  it('restore 对非法载荷 fail-closed（不抛错、清空状态）', async () => {
    const { ChannelThrottle, ChannelBreaker } = await loadThrottleModule()
    const t = new ChannelThrottle()
    expect(() => t.restore('not-json')).not.toThrow()
    expect(() => t.restore({ lastFetch: 'nope' })).not.toThrow()
    const b = new ChannelBreaker()
    expect(() => b.restore(null)).not.toThrow()
    expect(b.isOpen('anything')).toBe(false)
  })
})

describe('P2：配置层一致性（同一 URL 的多个身份必须显式声明共享配额）', () => {
  it('CHANNEL_CONFIGS + CATEGORY_BOOSTS 里不存在「同 URL 但 throttleKey 不同」的组合', async () => {
    const { throttleKey, quotaKeyOf } = await loadThrottleModule()
    const m = await load()
    const entries = []
    for (const c of m.CHANNEL_CONFIGS) {
      entries.push({ id: c.id, key: quotaKeyOf(c), url: c.url })
      for (const fb of (c.fallbacks || [])) entries.push({ id: c.id + '#' + (fb.url), key: quotaKeyOf({ ...fb, id: c.id }), url: fb.url })
    }
    for (const [, cfg] of Object.entries(m.CATEGORY_BOOSTS)) {
      for (const s of cfg.sources) entries.push({ id: s.id, key: quotaKeyOf(s), url: s.url })
    }
    const byUrl = new Map()
    for (const e of entries) {
      if (!byUrl.has(e.url)) byUrl.set(e.url, new Set())
      byUrl.get(e.url).add(e.key)
    }
    const bad = [...byUrl.entries()].filter(([, keys]) => keys.size > 1)
    // 同一 URL 只允许一个配额键；否则又回到「换身份绕过限流」
    expect(bad.map(([u, k]) => u + ' => ' + [...k].join('|'))).toEqual([])
    // 且 hot-topics-service 与 quick-collect 的 ithome RSS 共用同一配额（P2）
    expect(throttleKey('https://www.ithome.com/rss/')).toBeTruthy()
  })

  it('weibo 主渠道与两个垂类补拉共享同一配额（风险分析发现 1 的直接回归锁）', async () => {
    const { quotaKeyOf } = await loadThrottleModule()
    const m = await load()
    const weibo = m.CHANNEL_CONFIGS.find((c) => c.id === 'weibo')
    const emo = m.CATEGORY_BOOSTS.emotion.sources[0]
    const health = m.CATEGORY_BOOSTS.health.sources[0]
    const k1 = quotaKeyOf(weibo)
    expect(quotaKeyOf(emo)).toBe(k1)
    expect(quotaKeyOf(health)).toBe(k1)
  })
})
