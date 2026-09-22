// @ts-check
import { describe, it, expect } from 'vitest'
import {
  scoreTopics,
  markTrend,
  logNorm,
  clamp01,
  CHANNEL_WEIGHTS,
} from './scorer.js'

const NOW = 1_700_000_000_000
const fresh = (o) => ({ fetchedAt: NOW, ...o })

describe('hot-topics scorer primitives', () => {
  it('logNorm compresses and guards non-positive/NaN', () => {
    expect(logNorm(0)).toBe(0)
    expect(logNorm(-5)).toBe(0)
    expect(logNorm(null)).toBe(0)
    expect(logNorm('abc')).toBe(0)
    expect(logNorm(999)).toBeCloseTo(Math.log10(1000), 6)
  })
  it('clamp01 bounds and NaN-safe', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(NaN)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
  })
})

describe('scoreTopics: cross-channel heat ranking (P0)', () => {
  it('returns [] for empty/non-array', () => {
    expect(scoreTopics([])).toEqual([])
    expect(scoreTopics(null)).toEqual([])
  })

  it('normalizes hotValue within channel so head items beat tail items', () => {
    const topics = [
      fresh({ id: 'weibo:1', channel: 'weibo', rank: 1, hotValue: 1_000_000 }),
      fresh({ id: 'weibo:50', channel: 'weibo', rank: 50, hotValue: 10_000 }),
    ]
    const out = scoreTopics(topics, { now: NOW })
    expect(out[0].id).toBe('weibo:1')
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })

  it('a head item of a lower-tier list is not outranked by a tail item of a bigger list once weights apply', () => {
    // 微博榜首(权重1.0, heatNorm满分) 应排在 B站尾条(权重0.85) 之前
    const topics = [
      fresh({ id: 'bilibili:50', channel: 'bilibili', rank: 50, hotValue: 5000 }),
      fresh({ id: 'weibo:1', channel: 'weibo', rank: 1, hotValue: 999_999 }),
    ]
    const out = scoreTopics(topics, { now: NOW })
    expect(out[0].id).toBe('weibo:1')
  })

  it('missing hotValue falls back to rank (RSS-style lists not zeroed)', () => {
    const topics = [
      fresh({ id: 'ithome_tech:1', channel: 'ithome_tech', rank: 1, hotValue: null }),
      fresh({ id: 'ithome_tech:10', channel: 'ithome_tech', rank: 10, hotValue: null }),
    ]
    const out = scoreTopics(topics, { now: NOW })
    expect(out[0].id).toBe('ithome_tech:1')
    expect(out[0].score).toBeGreaterThan(0)
    expect(out[1].score).toBeLessThan(out[0].score)
  })

  it('multi-source topics get a bonus (mergedFrom raises score)', () => {
    const single = fresh({ id: 'zhihu:3', channel: 'zhihu', rank: 3, hotValue: 500_000 })
    const multi = fresh({ id: 'weibo:8', channel: 'weibo', rank: 8, hotValue: 500_000, mergedFrom: ['zhihu', 'baidu'] })
    // 归一后同渠道不同条热度不同，直接比较 score 与 sourceCount
    const out = scoreTopics([single, multi], { now: NOW })
    const m = out.find(t => t.id === 'weibo:8')
    const s = out.find(t => t.id === 'zhihu:3')
    expect(m.sourceCount).toBe(3)
    expect(s.sourceCount).toBe(1)
    // 同为各渠道榜首（base 满分），多榜项因 sourceBonus 更高（weibo 来 3 源 vs zhihu 单源）
    expect(m.score).toBeGreaterThan(s.score)
  })

  it('assigns viewRank 1..N in score order', () => {
    const topics = [
      fresh({ id: 'a', channel: 'weibo', rank: 5, hotValue: 100 }),
      fresh({ id: 'b', channel: 'weibo', rank: 1, hotValue: 1_000_000 }),
      fresh({ id: 'c', channel: 'weibo', rank: 3, hotValue: 10_000 }),
    ]
    const out = scoreTopics(topics, { now: NOW })
    expect(out.map(t => t.viewRank)).toEqual([1, 2, 3])
    expect(out[0].id).toBe('b')
  })

  it('stable deterministic order for identical scores (rank asc, then channel, then id)', () => {
    const topics = [
      fresh({ id: 'z', channel: 'zhihu', rank: 1, hotValue: 500 }),
      fresh({ id: 'w', channel: 'weibo', rank: 1, hotValue: 500 }),
    ]
    // 两渠道各一条榜首、同 hotValue → 归一各满分、权重 weibo(1.0)>zhihu(1.0) 相同
    const out = scoreTopics(topics, { now: NOW })
    const out2 = scoreTopics(topics.slice().reverse(), { now: NOW })
    expect(out.map(t => t.id)).toEqual(out2.map(t => t.id)) // 输入顺序不影响结果
  })
})

describe('scoreTopics: decay & weights config (P2)', () => {
  it('older items decay below fresher equal-heat items', () => {
    const topics = [
      { id: 'old', channel: 'weibo', rank: 1, hotValue: 500_000, fetchedAt: NOW - 12 * 3600_000 },
      { id: 'new', channel: 'weibo', rank: 1, hotValue: 500_000, fetchedAt: NOW },
    ]
    const out = scoreTopics(topics, { now: NOW, halfLifeMs: 6 * 3600_000 })
    expect(out[0].id).toBe('new')
  })

  it('channelWeights override is honored', () => {
    const topics = [
      fresh({ id: 'x', channel: 'custom', rank: 1, hotValue: 100 }),
      fresh({ id: 'y', channel: 'weibo', rank: 1, hotValue: 100 }),
    ]
    // 给 custom 极高权重，使其压过 weibo
    const out = scoreTopics(topics, { now: NOW, channelWeights: { custom: 1.0, weibo: 0.1 } })
    expect(out[0].id).toBe('x')
  })

  it('unknown channel uses default weight (no crash)', () => {
    const out = scoreTopics([fresh({ id: 'k', channel: 'nope', rank: 1, hotValue: 10 })], { now: NOW })
    expect(out[0].score).toBeGreaterThan(0)
    expect(out[0].score).toBeLessThanOrEqual(1)
  })
})

describe('markTrend (P1)', () => {
  it('marks new/rising/falling against previous order', () => {
    const prev = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    const sorted = [
      { id: 'e', viewRank: 1 }, // 上轮第5→本轮第1，升
      { id: 'a', viewRank: 2 }, // 上轮第1→本轮第2，基本持平
      { id: 'new1', viewRank: 3 }, // 新增
    ]
    markTrend(sorted, prev)
    expect(sorted[0].trend).toBe('up')
    expect(sorted[1].trend).toBe('flat')
    expect(sorted[2].trend).toBe('new')
  })

  it('no previous topics → trend null (first run silent)', () => {
    const sorted = [{ id: 'a', viewRank: 1 }]
    markTrend(sorted, [])
    expect(sorted[0].trend).toBeNull()
  })
})

describe('CHANNEL_WEIGHTS sanity', () => {
  it('main comprehensive lists weigh >= vertical/mirror lists', () => {
    expect(CHANNEL_WEIGHTS.weibo).toBeGreaterThanOrEqual(CHANNEL_WEIGHTS.bilibili)
    expect(CHANNEL_WEIGHTS.weibo).toBeGreaterThan(CHANNEL_WEIGHTS.tophub)
  })
})

describe('scoreTopics: lone-item channel fallback (review regression)', () => {
  it('a lone tail item loses to a lone head item of an equal-weight channel', () => {
    const topics = [
      fresh({ id: 'b:40', channel: 'tophub', rank: 40, hotValue: 500 }),
      fresh({ id: 'a:1', channel: 'weibo', rank: 1, hotValue: 500 }),
    ]
    const out = scoreTopics(topics, { now: NOW })
    expect(out[0].id).toBe('a:1')
    // 单条渠道热度无分布信息 → 名次兜底：榜首 base≈1，榜尾 base≈0.025，差距显著
    expect(out[0].score - out[1].score).toBeGreaterThan(0.3)
  })

  it('all-equal hotValue inside a multi-item channel still ranks by position', () => {
    const topics = [
      fresh({ id: 'w:2', channel: 'weibo', rank: 2, hotValue: 700 }),
      fresh({ id: 'w:1', channel: 'weibo', rank: 1, hotValue: 700 }),
    ]
    const out = scoreTopics(topics, { now: NOW })
    expect(out[0].id).toBe('w:1')
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })
})

describe('scoreTopics: weights override merge semantics (review m-1)', () => {
  it('unlisted channels keep built-in weights instead of DEFAULT (merges with defaults)', () => {
    const topics = [
      fresh({ id: 't:1', channel: 'tencent', rank: 1, hotValue: 500 }),
      fresh({ id: 'd:1', channel: 'douyin', rank: 1, hotValue: 500 }),
    ]
    // 只覆盖 weibo：tencent(0.95)/douyin(1.0) 应仍按内置值区分，而非双双回退 DEFAULT 0.9
    const out = scoreTopics(topics, { now: NOW, channelWeights: { weibo: 0.01 } })
    const t = out.find((x) => x.id === 't:1')
    const d = out.find((x) => x.id === 'd:1')
    expect(t.score).toBeCloseTo(d.score * 0.95, 6)
  })

  it('non-finite/non-positive override entries are dropped per-key', () => {
    const topics = [fresh({ id: 'w:1', channel: 'weibo', rank: 1, hotValue: 500 })]
    const out = scoreTopics(topics, { now: NOW, channelWeights: { weibo: -3 } })
    expect(out[0].score).toBeCloseTo(0.9, 6) // 非法值丢弃 → 内置 1.0 生效
  })
})
