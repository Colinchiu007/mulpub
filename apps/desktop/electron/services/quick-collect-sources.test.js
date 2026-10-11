/**
 * quick-collect-sources — 源注册表（唯一真源）
 *
 * 六条不可省：① 闭集不重叠且顺序稳定；② 未知 id 判定；③ splitSources 按 kind 分流
 * 且未知 id 落 unknown；④ 域名判据（精确/子域/大小写/末尾点/非法 URL）；
 * ⑤ 每条源都声明完整字段（缺一条就是接线时才会发现的坑）；
 * ⑥ 合规：注册表里不得存在需要登录态的源（公众号/小红书直采不在册）。
 */
import { describe, it, expect } from 'vitest'

async function mod () {
  return import('../services/quick-collect-sources')
}

describe('quick-collect-sources/注册表', () => {
  it('闭集不重叠、顺序稳定、id 唯一', async () => {
    const m = await mod()
    const all = [...m.ALL_SOURCE_IDS]
    expect(all.length).toBeGreaterThan(0)
    expect(new Set(all).size).toBe(all.length)
    // 两类 source 集合互斥且并集等于全闭集
    const union = [...m.SEARCH_SOURCE_IDS, ...m.TREND_SOURCE_IDS]
    expect(new Set(union).size).toBe(union.length)
    expect([...union].sort()).toEqual([...all].sort())
    // search 类仍是既有三源（行为兼容的锚点）
    expect([...m.SEARCH_SOURCE_IDS]).toEqual(['reddit', 'hackernews', 'github'])
    // 中文榜单源全部是 trend
    for (const id of ['weibo', 'zhihu', 'douyin', 'bilibili', 'baidu', 'toutiao', 'tencent', 'tophub']) {
      expect(m.TREND_SOURCE_IDS, id).toContain(id)
      expect(m.getSource(id).kind, id).toBe('trend')
      expect(m.getSource(id).timeKind, id).toBe('observed')
    }
  })

  it('每条源都声明完整字段，且中文榜单源标 observed（没有发布时间）', async () => {
    const m = await mod()
    for (const s of m.SOURCES) {
      expect(typeof s.id, s.id).toBe('string')
      expect(typeof s.label, s.id).toBe('string')
      expect(['search', 'trend'], s.id).toContain(s.kind)
      expect(['hottest', 'realtime'], s.id).toContain(s.sourceType)
      expect(['published', 'observed'], s.id).toContain(s.timeKind)
      expect(m.SOURCE_GROUPS, s.id).toContain(s.group)
      expect(Array.isArray(s.expectedDomains), s.id).toBe(true)
      expect(s.expectedDomains.length, s.id).toBeGreaterThan(0)
      expect(Number.isFinite(s.intervalMinutes), s.id).toBe(true)
      expect(typeof s.homeUrl, s.id).toBe('string')
      expect(s.homeUrl.startsWith('https://'), s.id).toBe(true)
    }
    // 不变量（S2 起按 provider 判，而不是按 sourceType）：
    //   - **只有拿不到原生发布时间的源**才允许标 observed；
    //   - hot-topics provider 的中文榜单全部没有发布时间 ⇒ 必须 observed；
    //   - feed provider 的时间线/JSON 源一律有原生发布时间 ⇒ 必须 published。
    // （v2ex_hot 是榜单形态但每条自带 created，故它是 hottest + published：有原生时间就用原生时间。）
    for (const s of m.SOURCES) {
      if (s.timeKind === 'observed') expect(s.provider, s.id).toBe('hot-topics')
      if (s.provider === 'hot-topics') expect(s.timeKind, s.id).toBe('observed')
      if (s.provider === 'feed') {
        expect(s.timeKind, s.id).toBe('published')
        expect(typeof s.feedUrl, s.id).toBe('string')
        expect(s.feedUrl.startsWith('https://'), s.id).toBe(true)
      }
    }
  })

  it('合规：不存在需要登录态的源（公众号/小红书直采不在册）', async () => {
    const m = await mod()
    const ids = [...m.ALL_SOURCE_IDS]
    for (const forbidden of ['weixin-mp', 'wechat', 'mp', 'xiaohongshu', 'xhs', 'kuaishou']) {
      expect(ids, forbidden).not.toContain(forbidden)
    }
    // 注册表不得声明任何 cookie/登录态字段（结构锁：出现即红）
    for (const s of m.SOURCES) {
      const keys = Object.keys(s)
      for (const k of ['cookie', 'cookies', 'needsLogin', 'needsAuth', 'token']) {
        expect(keys, s.id + '.' + k).not.toContain(k)
      }
    }
  })

  it('getSource / isKnownSource', async () => {
    const m = await mod()
    expect(m.getSource('weibo').label).toBe('微博热搜')
    expect(m.getSource('  weibo  ').id).toBe('weibo')
    expect(m.getSource('nope')).toBe(null)
    expect(m.getSource('')).toBe(null)
    expect(m.getSource(null)).toBe(null)
    expect(m.isKnownSource('zhihu')).toBe(true)
    expect(m.isKnownSource('weixin-mp')).toBe(false)
  })
})

describe('quick-collect-sources/splitSources', () => {
  it('按 kind 分流、去重、保持闭集顺序、未知 id 落 unknown', async () => {
    const m = await mod()
    const r = m.splitSources(['zhihu', 'reddit', 'reddit', 'weibo', 'nope', 42, ''])
    expect(r.search).toEqual(['reddit'])
    expect(r.trend).toEqual(['weibo', 'zhihu'])
    expect(r.unknown).toEqual(['nope'])
  })

  it('非数组/空数组 → 三类都空（不抛错）', async () => {
    const m = await mod()
    for (const input of [undefined, null, 'reddit', 3, []]) {
      const r = m.splitSources(input)
      expect(r.search).toEqual([])
      expect(r.trend).toEqual([])
      expect(r.unknown).toEqual([])
    }
  })
})

describe('quick-collect-sources/hostAllowed', () => {
  it('精确域、子域、大小写与末尾点都按等价处理', async () => {
    const { hostAllowed } = await mod()
    expect(hostAllowed('https://weibo.com/a', ['weibo.com'])).toBe(true)
    expect(hostAllowed('https://s.weibo.com/a', ['weibo.com'])).toBe(true)
    expect(hostAllowed('https://WEIBO.com./a', ['weibo.com'])).toBe(true)
    expect(hostAllowed('https://weibo.com/a', ['.weibo.com'])).toBe(true)
    expect(hostAllowed('https://weibo.com.evil.com/a', ['weibo.com'])).toBe(false)
    expect(hostAllowed('https://example.com/a', ['weibo.com'])).toBe(false)
  })

  it('空清单 = 不做该判据；非法 URL 一律 false', async () => {
    const { hostAllowed } = await mod()
    expect(hostAllowed('https://anything.example/a', [])).toBe(true)
    expect(hostAllowed('not-a-url', ['weibo.com'])).toBe(false)
    expect(hostAllowed('', ['weibo.com'])).toBe(false)
  })
})
