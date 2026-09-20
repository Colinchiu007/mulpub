// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HotTopicsService, CACHE_KEY, CHANNEL_CONFIGS } from './hot-topics-service.js'
import { classifyTopic } from './hot-topics/classifier.js'
import { parseZhihu, parseToutiao, parseTencent, parseBilibili, parseDouyin, parseBaidu, parseTophub, parseWeibo } from './hot-topics/channels.js'

// ── 分类器 ──
describe('hot-topics classifier', () => {
  it('maps toutiao raw category to 10-category system', () => {
    expect(classifyTopic('财经', 'toutiao', '任意文本')).toBe('finance')
    expect(classifyTopic('科技', 'toutiao', '任意文本')).toBe('tech')
  })
  it('falls back to keyword rules when raw category unmapped', () => {
    expect(classifyTopic('未知分类', 'toutiao', 'A股大涨沪指重返3000点')).toBe('finance')
    expect(classifyTopic(null, 'zhihu', 'AI大模型最新突破')).toBe('tech')
    expect(classifyTopic(null, 'bilibili', '国足世界杯预选赛')).toBe('sports')
  })
  it('falls back to general when nothing matches', () => {
    expect(classifyTopic(null, 'zhihu', '完全无关文本')).toBe('general')
  })
  it('maps weibo native category to 10-category system', () => {
    expect(classifyTopic('数码', 'weibo', '任意文本')).toBe('tech')
    expect(classifyTopic('民生新闻', 'weibo', '任意文本')).toBe('society')
    expect(classifyTopic('健康医疗', 'weibo', '任意文本')).toBe('health')
    // 未命中微博分类 → 关键词兜底
    expect(classifyTopic('未知微博分类', 'weibo', 'A股大涨')).toBe('finance')
  })
  it('maps bilibili tname to 10-category system', () => {
    expect(classifyTopic('手机游戏', 'bilibili', '任意文本')).toBe('entertainment')
    expect(classifyTopic('科学科普', 'bilibili', '任意文本')).toBe('tech')
    expect(classifyTopic('校园学习', 'bilibili', '任意文本')).toBe('education')
    // 未命中 B站分区 → 关键词兜底
    expect(classifyTopic('未知分区', 'bilibili', 'A股大涨')).toBe('finance')
  })
})

// ── 渠道解析器（fixture 驱动） ──
describe('hot-topics channel parsers', () => {
  it('parses zhihu json', () => {
    const json = { data: [{ target: { title: '知乎话题A', url: 'https://zhihu.com/q/1' } }, { detail_text: '1234 万热度', target: { title: '知乎话题B' } }] }
    const items = parseZhihu(json)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ channel: 'zhihu', rank: 1, topic: '知乎话题A', url: 'https://zhihu.com/q/1' })
    expect(items[1].hotValue).toBe(1234)
  })
  it('parses toutiao json with Category', () => {
    const json = { data: [{ Title: '头条标题', HotValue: '456789', Url: 'https://toutiao.com/x', Category: '财经' }] }
    const items = parseToutiao(json)
    expect(items[0]).toMatchObject({ channel: 'toutiao', topic: '头条标题', hotValue: 456789, rawCategory: '财经' })
  })
  it('parses tencent json (idlist newslist shape) and filters ad placeholder', () => {
    const json = { idlist: [{ newslist: [
      { title: '腾讯新闻用户最关注的热点，每10分钟更新一次', articletype: '560' },
      { title: '腾讯标题 &amp; 测试', url: 'https://news.qq.com/a', articletype: '0' },
    ] }] }
    const items = parseTencent(json)
    expect(items).toHaveLength(1)
    expect(items[0].topic).toBe('腾讯标题 & 测试')
    expect(items[0].url).toBe('https://news.qq.com/a')
  })
  it('parses bilibili json', () => {
    const json = { data: { list: [{ title: 'B站视频', bvid: 'BV1xx', tname: '手机游戏', stat: { view: 99999 } }] } }
    const items = parseBilibili(json)
    expect(items[0]).toMatchObject({ channel: 'bilibili', topic: 'B站视频', hotValue: 99999, url: 'https://www.bilibili.com/video/BV1xx' })
    expect(items[0].rawCategory).toBe('手机游戏')
  })
  it('parses douyin json', () => {
    const json = { data: { word_list: [{ word: '抖音热点词', hot_value: 8888888 }] } }
    const items = parseDouyin(json)
    expect(items[0]).toMatchObject({ channel: 'douyin', topic: '抖音热点词', hotValue: 8888888 })
  })
  it('parses baidu official json api (nested content)', () => {
    const json = { data: { cards: [{ content: [{ content: [
      { index: 1, word: '百度热搜词&amp;测试', url: 'https://baidu.com/s?wd=1', newHotName: '热' },
    ] }] }] } }
    const items = parseBaidu(json)
    expect(items[0].topic).toBe('百度热搜词&测试')
    expect(items[0].rank).toBe(1)
    expect(items[0].url).toBe('https://baidu.com/s?wd=1')
  })
  it('parseBaidu skips isTop pinned item to keep rank unique (real 51-item shape)', () => {
    // 真实载荷形状：首条 isTop 置顶（无 index）+ 正式条目 index 1..50
    // 若不过滤置顶条，其 rank 回退 i+1=1 与正式榜首 index=1 重复 → id 'baidu:1' 冲突
    const json = { data: { cards: [{ content: [{ content: [
      { isTop: true, word: '置顶推广位', url: 'https://baidu.com/s?wd=top' },
      { index: 1, word: '正式榜首', url: 'https://baidu.com/s?wd=1' },
      { index: 2, word: '正式第二条', url: 'https://baidu.com/s?wd=2' },
    ] }] }] } }
    const items = parseBaidu(json)
    expect(items).toHaveLength(2)
    expect(items.map(x => x.rank)).toEqual([1, 2])
    const ids = items.map(x => 'baidu:' + x.rank)
    expect(new Set(ids).size).toBe(ids.length) // id 唯一性
    expect(items[0].topic).toBe('正式榜首')
  })
  it('parseBaidu returns empty on missing/flat cards (defensive)', () => {
    expect(parseBaidu({ data: {} })).toHaveLength(0)
    expect(parseBaidu({ data: { cards: [{ content: [] }] } })).toHaveLength(0)
    expect(parseBaidu(null)).toHaveLength(0)
    // 顶层 cards 回退路径（无 data 包装）
    const flat = { cards: [{ content: [{ content: [{ index: 1, word: '顶层回退', url: 'https://baidu.com/s?wd=f' }] }] }] }
    expect(parseBaidu(flat)).toHaveLength(1)
    expect(parseBaidu(flat)[0].topic).toBe('顶层回退')
  })
  it('parses weibo hot_band json with native category', () => {
    const json = { data: { band_list: [
      { word: '微博热搜词', num: 972888, realpos: 1, category: '数码', label_name: '热' },
      { word: '第二条', num: 500000, realpos: 2, category: '民生新闻' },
    ] } }
    const items = parseWeibo(json)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ channel: 'weibo', rank: 1, topic: '微博热搜词', hotValue: 972888, rawCategory: '数码' })
    // rank 用数组序（realpos 偶发稀疏 null，回退会撞号）——realpos 缺失时仍连续唯一
    expect(items[1].rank).toBe(2)
    expect(items[0].url).toContain('https://s.weibo.com/weibo?q=')
    expect(items[1].rawCategory).toBe('民生新闻')
  })
  it('parses tophub weibo node page html', () => {
    const html = '<tbody> <tr> <td align="center">1.</td> <td><a href="https://s.weibo.com/weibo?q=%E6%B5%8B%E8%AF%95" target="_blank" rel="nofollow" itemid="1">男子编造停捐遭威胁事件被抓</a></td> <td class="ws">125万</td> </tr></tbody>'
    const items = parseTophub(html)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ channel: 'tophub', topic: '男子编造停捐遭威胁事件被抓', hotValue: 1250000 })
  })
  it('sanitizeUrl rejects non-http protocols', async () => {
    const { sanitizeUrl } = await import('./hot-topics/channels.js')
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeUrl('https://ok.com')).toBe('https://ok.com')
  })
})

// ── Service：缓存 fail-closed / 去重 / 限流 / 熔断 ──
describe('HotTopicsService', () => {
  function makeService(overrides = {}) {
    const svc = new HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {} }, ...overrides })
    // 单测隔离：方案B 定向补拉与方案C LLM 兜底默认不触网（专项行为见 Plan B/D、Plan C 用例）
    svc._collectBoostChannel = async (src) => ({ channel: src.id, items: null, skipped: true, boost: true })
    return svc
  }

  it('getCache fail-closed on corrupt persisted data', () => {
    const store = { getSetting: () => 'not-json{{{', setSetting: vi.fn() }
    const svc = makeService({ settingsStore: store })
    expect(svc.getCache()).toEqual({ topics: [], fetchedAt: 0, channelStats: {} })
  })

  it('getCache returns persisted cache', () => {
    const persisted = { topics: [{ id: 'zhihu:1', topic: 't' }], fetchedAt: 123, channelStats: {} }
    const store = { getSetting: () => JSON.stringify(persisted), setSetting: vi.fn() }
    const svc = makeService({ settingsStore: store })
    expect(svc.getCache()).toEqual(persisted)
  })

  it('fetchTopics serves fresh cache without network', async () => {
    const svc = makeService()
    svc.memCache = { topics: [{ id: 'a' }], fetchedAt: Date.now(), channelStats: {} }
    const spy = vi.spyOn(svc, '_collectChannel')
    const res = await svc.fetchTopics()
    expect(res.fromCache).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('fetchTopics dedupes cross-channel topics and merges mergedFrom', async () => {
    const svc = makeService()
    const item = (ch, rank, topic) => ({ channel: ch, rank, topic, hotValue: null, url: null, rawCategory: null })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => {
      if (cfg.id === 'zhihu') return { channel: 'zhihu', items: [item('zhihu', 1, '重复选题')], skipped: false }
      if (cfg.id === 'toutiao') return { channel: 'toutiao', items: [item('toutiao', 1, '重复选题'), item('toutiao', 2, '唯一选题')], skipped: false }
      return { channel: cfg.id, items: null, skipped: true }
    })
    const res = await svc.fetchTopics({ force: true })
    expect(res.topics).toHaveLength(2)
    const dup = res.topics.find(x => x.topic === '重复选题')
    expect(dup.channel).toBe('zhihu')
    expect(dup.mergedFrom).toContain('toutiao')
  })

  it('channel failure does not block other channels and counts toward breaker', async () => {
    const svc = makeService()
    let failCount = 0
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => {
      if (cfg.id === 'douyin') {
        failCount++
        return { channel: 'douyin', items: null, skipped: false, error: 'HTTP 432' }
      }
      return { channel: cfg.id, items: [], skipped: false }
    })
    const res = await svc.fetchTopics({ force: true })
    expect(res.channelStats.douyin.ok).toBe(false)
    expect(res.channelStats.douyin.error).toBe('HTTP 432')
    expect(res.channelStats.zhihu.ok).toBe(true)
  })

  it('throttle blocks refetch within interval', () => {
    const svc = makeService()
    expect(svc.throttle.tryAcquire('zhihu', 5)).toBe(true)
    expect(svc.throttle.tryAcquire('zhihu', 5)).toBe(false)
  })

  it('breaker opens after 3 consecutive failures and recovers after cooldown', () => {
    const svc = makeService()
    const opts = { threshold: 3, cooldownMs: 10 }
    expect(svc.breaker.isOpen('x', opts)).toBe(false)
    svc.breaker.recordFailure('x', opts)
    svc.breaker.recordFailure('x', opts)
    expect(svc.breaker.isOpen('x', opts)).toBe(false)
    svc.breaker.recordFailure('x', opts)
    expect(svc.breaker.isOpen('x', opts)).toBe(true)
    // 冷却 10ms 后 HALF_OPEN 放行
    return new Promise(resolve => setTimeout(() => {
      expect(svc.breaker.isOpen('x', opts)).toBe(false)
      resolve()
    }, 30))
  })

  it('writes cache to settings store after fetch', async () => {
    const store = { getSetting: () => null, setSetting: vi.fn() }
    const svc = makeService({ settingsStore: store })
    vi.spyOn(svc, '_collectChannel').mockResolvedValue({ channel: 'zhihu', items: [], skipped: false })
    await svc.fetchTopics({ force: true })
    expect(store.setSetting).toHaveBeenCalledWith(CACHE_KEY, expect.stringContaining('"topics"'))
  })

  // ── 缓存保护：全渠道失败不得清空已有选题（2026-09-14 缺陷回归保护）──
  // 缺陷现象：一次网络抖动（8 渠道并发抓取 10s 超时全部 abort）后 topics=[]，
  // 旧实现直接 `_writeCache({ topics: [] })` 覆盖掉用户已抓到的选题，
  // UI 掉进「暂无热门选题」空态且不会自愈（需手动刷新且网络恢复）。
  it('全渠道失败时保留上一次的非空缓存，不用空列表覆盖', async () => {
    const previousTopics = [
      { id: 'zhihu:1', topic: 'A', channel: 'zhihu', rank: 1 },
      { id: 'zhihu:2', topic: 'B', channel: 'zhihu', rank: 2 },
    ]
    const store = { getSetting: () => null, setSetting: vi.fn() }
    const svc = makeService({ settingsStore: store })
    svc.memCache = { topics: previousTopics, fetchedAt: 1700000000000, channelStats: {} }
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id, items: null, skipped: false, error: 'This operation was aborted',
    }))

    const res = await svc.fetchTopics({ force: true })

    expect(res.topics).toHaveLength(2)
    expect(res.topics.map(t => t.topic)).toEqual(['A', 'B'])
    expect(res.fetchedAt).toBe(1700000000000) // 保留陈旧 fetchedAt → 下次调用仍会重试网络
    expect(res.preservedStaleCache).toBe(true)
    // 落盘的必须是保留后的缓存，而不是空列表
    const lastCall = store.setSetting.mock.calls[store.setSetting.mock.calls.length - 1]
    const persisted = JSON.parse(lastCall[1])
    expect(persisted.topics).toHaveLength(2)
    expect(persisted.preservedStaleCache).toBe(true)
    // 失败原因仍需如实上报，供 UI 展示「部分渠道获取失败」
    expect(res.channelStats.zhihu.ok).toBe(false)
    expect(res.channelStats.zhihu.error).toBe('This operation was aborted')
  })

  it('缓存本就为空时，全渠道失败仍写入空结果（不产生伪标记）', async () => {
    const store = { getSetting: () => null, setSetting: vi.fn() }
    const svc = makeService({ settingsStore: store })
    svc.memCache = { topics: [], fetchedAt: 0, channelStats: {} }
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id, items: null, skipped: false, error: 'HTTP 500',
    }))

    const res = await svc.fetchTopics({ force: true })

    expect(res.topics).toEqual([])
    expect(res.preservedStaleCache).toBeUndefined()
    expect(res.fetchedAt).toBeGreaterThan(0)
  })

  it('部分渠道成功时正常覆盖缓存（保留新结果，不加保留标记）', async () => {
    const store = { getSetting: () => null, setSetting: vi.fn() }
    const svc = makeService({ settingsStore: store })
    svc.memCache = { topics: [{ id: 'old:1', topic: '旧选题' }], fetchedAt: 1700000000000, channelStats: {} }
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => {
      if (cfg.id === 'zhihu') {
        return {
          channel: 'zhihu',
          skipped: false,
          items: [{ channel: 'zhihu', rank: 1, topic: '新选题', hotValue: null, url: null, rawCategory: null }],
        }
      }
      return { channel: cfg.id, items: null, skipped: false, error: 'HTTP 500' }
    })

    const res = await svc.fetchTopics({ force: true })

    expect(res.topics).toHaveLength(1)
    expect(res.topics[0].topic).toBe('新选题')
    expect(res.preservedStaleCache).toBeUndefined()
  })

  it('全渠道被限流/熔断跳过时同样保留旧缓存（skipped 不等于成功抓取）', async () => {
    const svc = makeService()
    svc.memCache = { topics: [{ id: 'zhihu:1', topic: '保留我' }], fetchedAt: 1700000000000, channelStats: {} }
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id, items: null, skipped: true,
    }))

    const res = await svc.fetchTopics({ force: true })

    expect(res.topics).toHaveLength(1)
    expect(res.preservedStaleCache).toBe(true)
  })

  it('container wiring shape: settingsStore adapter maps to store.getSetting/setSetting', () => {
    // 验证 container.setup.js 的注入形态（不启动完整 container，只验证适配器映射）
    const calls = []
    const fakeStore = {
      getSetting: (k) => { calls.push(['get', k]); return null },
      setSetting: (k, v) => { calls.push(['set', k]) },
    }
    const adapter = {
      getSetting: (k) => fakeStore.getSetting(k),
      setSetting: (k, v) => fakeStore.setSetting(k, v),
    }
    const svc = makeService({ settingsStore: adapter })
    svc.getCache()
    svc._writeCache({ topics: [], fetchedAt: 1, channelStats: {} })
    expect(calls.some(c => c[0] === 'get')).toBe(true)
    expect(calls.some(c => c[0] === 'set')).toBe(true)
  })

  it('has 8 channel configs with interval >= 5 minutes', () => {
    expect(CHANNEL_CONFIGS).toHaveLength(8)
    const ids = CHANNEL_CONFIGS.map(c => c.id)
    expect(ids).toContain('weibo')
    expect(ids).toContain('baidu')
    for (const cfg of CHANNEL_CONFIGS) {
      expect(cfg.intervalMinutes).toBeGreaterThanOrEqual(5)
      expect(cfg.url.startsWith('https://')).toBe(true)
    }
  })
  it('baidu channel uses official JSON api (no HTML parsing)', () => {
    const baidu = CHANNEL_CONFIGS.find(c => c.id === 'baidu')
    expect(baidu.url).toBe('https://top.baidu.com/api/board?platform=wise&tab=realtime')
    expect(baidu.riskLevel).toBe('low')
  })
  it('weibo channel config has Referer header', () => {
    const weibo = CHANNEL_CONFIGS.find(c => c.id === 'weibo')
    expect(weibo.headers.Referer).toBe('https://weibo.com/')
    expect(weibo.riskLevel).toBe('medium')
  })
})

// ── 方案A：放宽抓取量 + 分类器修复（多标签/黑洞词/微博映射） ──
describe('Plan A: fetch limit & classifier fixes', () => {
  it('MAX_PER_CHANNEL=50, MAX_TOPICS=400', async () => {
    const m = await import('./hot-topics-service.js')
    expect(m.MAX_PER_CHANNEL).toBe(50)
    expect(m.MAX_TOPICS).toBe(400)
  })

  it('society 黑洞词修复：裸字判不再吞文本，判决等强词仍属 society', async () => {
    const { classifyTopic } = await import('./hot-topics/classifier.js')
    // v1 缺陷：'判定' 含单字 '判' → 误判 society
    expect(classifyTopic(null, 'zhihu', '科学实验判定新粒子存在')).not.toBe('society')
    expect(classifyTopic(null, 'zhihu', '法院一审判决被告赔偿')).toBe('society')
    // v1 缺陷：'卫健委通报疫情' 被 society '通报' 先到先得吞掉 → 应为 health
    expect(classifyTopic(null, 'baidu', '卫健委通报最新疫情数据')).toBe('health')
  })

  it('weibo 原生分类扩容：情感/艺人/汽车 映射生效', async () => {
    const { classifyTopic } = await import('./hot-topics/classifier.js')
    expect(classifyTopic('情感', 'weibo', '任意文本')).toBe('emotion')
    expect(classifyTopic('艺人', 'weibo', '任意文本')).toBe('entertainment')
    expect(classifyTopic('汽车', 'weibo', '任意文本')).toBe('tech')
  })

  it('classifyTopicMulti：多标签输出 {category, categories[]}', async () => {
    const { classifyTopicMulti } = await import('./hot-topics/classifier.js')
    const r = classifyTopicMulti(null, 'zhihu', '央行通报经济数据 GDP增速放缓')
    expect(r.category).toBe('finance')
    expect(r.categories).toContain('finance')
    expect(r.categories.length).toBeGreaterThanOrEqual(1)
    expect(r.categories.length).toBeLessThanOrEqual(3)
    const g = classifyTopicMulti(null, 'zhihu', '完全无关文本')
    expect(g.category).toBe('general')
    expect(Array.isArray(g.categories)).toBe(true)
    // 原生分类优先为主标签，关键词补充次标签
    const n = classifyTopicMulti('健康医疗', 'weibo', 'AI辅助诊断新药获批')
    expect(n.category).toBe('health')
    expect(n.categories).toContain('tech')
  })

  it('解析器放宽到 50 条（parseBaidu / parseTophub / parseToutiao）', async () => {
    const ch = await import('./hot-topics/channels.js')
    const rows = Array.from({ length: 55 }, (_, i) => ({ index: i + 1, word: '热搜' + i, url: 'https://baidu.com/s?wd=' + i }))
    expect(ch.parseBaidu({ data: { cards: [{ content: [{ content: rows }] }] } })).toHaveLength(50)
    const tt = { data: Array.from({ length: 55 }, (_, i) => ({ Title: 'T' + i, Url: 'https://t.com/' + i })) }
    expect(ch.parseToutiao(tt)).toHaveLength(50)
    const trs = Array.from({ length: 60 }, (_, i) =>
      '<tr><td align="center">' + (i + 1) + '.</td><td><a href="https://s.weibo.com/weibo?q=x' + i + '" target="_blank" rel="nofollow" itemid="' + (i + 1) + '">话题' + i + '</a></td><td class="ws">' + (i + 1) + '万</td></tr>').join(' ')
    expect(ch.parseTophub('<tbody>' + trs + '</tbody>')).toHaveLength(50)
  })

  it('weibo 解析器兼容两种载荷形态：data.band_list 与 data 数组', async () => {
    const ch = await import('./hot-topics/channels.js')
    const flat = { data: [{ word: '形态二热搜', num: 123, category: '情感' }] }
    const items = ch.parseWeibo(flat)
    expect(items).toHaveLength(1)
    expect(items[0].topic).toBe('形态二热搜')
    expect(items[0].rawCategory).toBe('情感')
  })
})

// ── 方案B/D：稀疏分类定向补拉 ──
describe('Plan B/D: category boost channels', () => {
  it('CATEGORY_BOOSTS：稀疏分类阈值补拉配置（finance/tech 有专属源）', async () => {
    const m = await import('./hot-topics-service.js')
    expect(m.CATEGORY_BOOSTS).toBeDefined()
    for (const cat of ['finance', 'tech', 'emotion', 'health', 'education', 'international']) {
      expect(m.CATEGORY_BOOSTS[cat]).toBeDefined()
      expect(m.CATEGORY_BOOSTS[cat].threshold).toBeGreaterThan(0)
      expect(Array.isArray(m.CATEGORY_BOOSTS[cat].sources)).toBe(true)
    }
    // 实测可用端点：财经（百度tab+新浪）、科技（IT之家）
    expect(m.CATEGORY_BOOSTS.finance.sources.length).toBeGreaterThanOrEqual(2)
    expect(m.CATEGORY_BOOSTS.tech.sources.length).toBeGreaterThanOrEqual(1)
    for (const s of [...m.CATEGORY_BOOSTS.finance.sources, ...m.CATEGORY_BOOSTS.tech.sources]) {
      expect(s.url.startsWith('https://')).toBe(true)
      expect(s.boostCategory).toBeTruthy()
      expect(s.board).toBeTruthy()
    }
  })

  it('低于阈值的分类自动触发 _collectBoostChannel，补拉条目直挂分类且 id 含 board 段', async () => {
    const { HotTopicsService } = await import('./hot-topics-service.js')
    const svc = new HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {} } })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id,
      items: [{ id: cfg.id + ':1', channel: cfg.id, rank: 1, topic: cfg.id + '普通话题', category: 'general', categories: ['general'], hotValue: null, url: null }],
      skipped: false,
    }))
    vi.spyOn(svc, '_collectBoostChannel').mockImplementation(async (src, fetchedAt) => ({
      channel: src.id,
      items: [{ id: src.channel + ':' + src.board + ':1', channel: src.channel, rank: 1, topic: '财经补拉题', category: src.boostCategory, categories: [src.boostCategory], hotValue: null, url: null }],
      skipped: false,
    }))
    const res = await svc.fetchTopics({ force: true })
    expect(svc._collectBoostChannel).toHaveBeenCalled()
    const boosted = res.topics.find(t => t.topic === '财经补拉题')
    expect(boosted).toBeTruthy()
    expect(boosted.category).toBe('finance')
    // 显式 boostCategories 指定的分类必须被拉取
    const cats = svc._collectBoostChannel.mock.calls.map(c => c[0].boostCategory)
    expect(cats).toContain('finance')
    expect(cats).toContain('tech')
  })

  it('显式 boostCategories=[emotion] 时即使计数充足也补拉该分类（空分类补拉按钮契约）', async () => {
    const { HotTopicsService } = await import('./hot-topics-service.js')
    const svc = new HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {} } })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id,
      items: [{ id: cfg.id + ':1', channel: cfg.id, rank: 1, topic: '话题' + cfg.id, category: 'general', categories: ['general'], hotValue: null, url: null }],
      skipped: false,
    }))
    const seenBoost = []
    vi.spyOn(svc, '_collectBoostChannel').mockImplementation(async (src) => {
      seenBoost.push(src.boostCategory)
      return { channel: src.id, items: null, skipped: true }
    })
    await svc.fetchTopics({ force: true, boostCategories: ['emotion'] })
    expect(seenBoost).toContain('emotion')
  })

  it('方案D 专属渠道解析器：parseSinaFinance / parseIthomeRSS', async () => {
    const ch = await import('./hot-topics/channels.js')
    const sina = { result: { data: [{ title: '新浪财经标题', url: 'https://finance.sina.com.cn/x' }, { title: '第二条' }] } }
    const items = ch.parseSinaFinance(sina)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ channel: 'sina_finance', rank: 1, topic: '新浪财经标题', rawCategory: '财经' })
    const xml = '<?xml version="1.0"?><rss><channel><item><title><![CDATA[IT之家标题]]></title><link>https://www.ithome.com/0/123.htm</link></item><item><title>第二条 &amp; 测试</title><link>https://www.ithome.com/0/124.htm</link></item></channel></rss>'
    const rss = ch.parseIthomeRSS(xml)
    expect(rss).toHaveLength(2)
    expect(rss[0]).toMatchObject({ channel: 'ithome_tech', topic: 'IT之家标题' })
    expect(rss[0].url).toBe('https://www.ithome.com/0/123.htm')
    expect(rss[1].topic).toBe('第二条 & 测试')
    expect(ch.parseIthomeRSS(null)).toEqual([])
  })
})

// ── 方案C：LLM 分类兜底 ──
describe('Plan C: LLM classify fallback', () => {
  it('deps.llmClassify 对 general 条目批量分类并应用到结果', async () => {
    const { HotTopicsService } = await import('./hot-topics-service.js')
    const llmClassify = vi.fn().mockResolvedValue({ '普通话题zhihu': 'tech' })
    const svc = new HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {} }, llmClassify })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id,
      items: [{ id: cfg.id + ':1', channel: cfg.id, rank: 1, topic: '普通话题' + cfg.id, category: 'general', categories: ['general'], hotValue: null, url: null }],
      skipped: false,
    }))
    vi.spyOn(svc, '_collectBoostChannel').mockResolvedValue({ channel: 'boost', items: null, skipped: true })
    const res = await svc.fetchTopics({ force: true })
    expect(llmClassify).toHaveBeenCalled()
    const t = res.topics.find(x => x.topic === '普通话题zhihu')
    expect(t.category).toBe('tech')
    expect(t.categories).toContain('tech')
  })

  it('LLM 标签落盘缓存：已缓存条目不再请求 llmClassify', async () => {
    const { HotTopicsService, LLM_LABELS_KEY } = await import('./hot-topics-service.js')
    const persisted = { '已缓存选题': 'finance' }
    const store = { getSetting: (k) => (k === LLM_LABELS_KEY ? JSON.stringify(persisted) : null), setSetting: vi.fn() }
    const llmClassify = vi.fn().mockResolvedValue({ '新选题': 'health' })
    const svc = new HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {} }, settingsStore: store, llmClassify })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id,
      items: [
        { id: 'zhihu:1', channel: 'zhihu', rank: 1, topic: '已缓存选题', category: 'general', categories: ['general'], hotValue: null, url: null },
        { id: 'zhihu:2', channel: 'zhihu', rank: 2, topic: '新选题', category: 'general', categories: ['general'], hotValue: null, url: null },
      ].filter(x => cfg.id === 'zhihu' ? true : x.topic === '话题非zhihu'),
      skipped: false,
    }))
    vi.spyOn(svc, '_collectBoostChannel').mockResolvedValue({ channel: 'boost', items: null, skipped: true })
    const res = await svc.fetchTopics({ force: true })
    expect(res.topics.find(x => x.topic === '已缓存选题').category).toBe('finance')
    expect(res.topics.find(x => x.topic === '新选题').category).toBe('health')
    // llmClassify 只收到未缓存的条目
    const asked = llmClassify.mock.calls[0][0]
    expect(asked).toContain('新选题')
    expect(asked).not.toContain('已缓存选题')
    // 新标签落盘
    const saved = store.setSetting.mock.calls.find(c => c[0] === LLM_LABELS_KEY)
    expect(saved).toBeTruthy()
    expect(JSON.parse(saved[1])['新选题']).toBe('health')
  })

  it('llmClassify 抛错时静默降级：general 保持不变且不影响返回', async () => {
    const { HotTopicsService } = await import('./hot-topics-service.js')
    const svc = new HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {} }, llmClassify: async () => { throw new Error('llm down') } })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id,
      items: [{ id: cfg.id + ':1', channel: cfg.id, rank: 1, topic: '普通话题X', category: 'general', categories: ['general'], hotValue: null, url: null }],
      skipped: false,
    }))
    vi.spyOn(svc, '_collectBoostChannel').mockResolvedValue({ channel: 'boost', items: null, skipped: true })
    const res = await svc.fetchTopics({ force: true })
    expect(res.topics.find(x => x.topic === '普通话题X').category).toBe('general')
  })

  it('未注入 llmClassify（未配置模型）时完全跳过，不调用网络', async () => {
    const { HotTopicsService } = await import('./hot-topics-service.js')
    const svc = new HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {} } })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id, items: [], skipped: false,
    }))
    vi.spyOn(svc, '_collectBoostChannel').mockResolvedValue({ channel: 'boost', items: null, skipped: true })
    const res = await svc.fetchTopics({ force: true })
    expect(res.topics).toEqual([])
  })

  it('llmClassify 返回非法分类被忽略（合同校验）', async () => {
    const { HotTopicsService } = await import('./hot-topics-service.js')
    const svc = new HotTopicsService({ log: { info: () => {}, warn: () => {}, error: () => {} }, llmClassify: async () => ({ '话题Y': 'nonsense' }) })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({
      channel: cfg.id,
      items: [{ id: cfg.id + ':1', channel: cfg.id, rank: 1, topic: '话题Y', category: 'general', categories: ['general'], hotValue: null, url: null }],
      skipped: false,
    }))
    vi.spyOn(svc, '_collectBoostChannel').mockResolvedValue({ channel: 'boost', items: null, skipped: true })
    const res = await svc.fetchTopics({ force: true })
    expect(res.topics.find(x => x.topic === '话题Y').category).toBe('general')
  })
})

// ── 评审回归（MAJOR-1，2026-09-20）：显式补拉不被主渠道限流的 preserve 早退吞掉 ──
describe('Review regression: explicit boost vs throttled main channels', () => {
  const silentLog = { info: () => {}, warn: () => {}, error: () => {} }

  it('主渠道全被限流跳过时，显式 boostCategories 仍执行补拉并合并结果（不触发 preservedStaleCache）', async () => {
    const svc = new HotTopicsService({ log: silentLog })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({ channel: cfg.id, items: null, skipped: true }))
    svc._collectBoostChannel = async (src) => ({
      channel: src.id, skipped: false, boost: true,
      items: [{
        id: src.channel + ':' + src.board + ':1', topic: '央行宣布降准', channel: src.channel,
        category: src.boostCategory, categories: [src.boostCategory], rank: 1, hotValue: null, url: null, fetchedAt: Date.now(),
      }],
    })
    svc.memCache = {
      topics: [{ id: 'zhihu:1', topic: '旧选题', category: 'society', categories: ['society'], fetchedAt: 1 }],
      fetchedAt: 1700000000000, channelStats: {},
    }
    const res = await svc.fetchTopics({ force: true, boostCategories: ['finance'] })
    expect(res.preservedStaleCache).toBeUndefined()
    const finance = res.topics.filter(t => (Array.isArray(t.categories) ? t.categories : [t.category]).includes('finance'))
    expect(finance.length).toBeGreaterThan(0)
    // 两个 finance 源都被触发（跨渠道同文本经 _aggregate 去重）
    expect(res.channelStats['baidu-finance']).toBeTruthy()
    expect(res.channelStats['sina-finance']).toBeTruthy()
  })

  it('主渠道与补拉源全部无结果时，仍保留旧缓存（preserve 语义不破坏）', async () => {
    const svc = new HotTopicsService({ log: silentLog })
    vi.spyOn(svc, '_collectChannel').mockImplementation(async (cfg) => ({ channel: cfg.id, items: null, skipped: true }))
    svc._collectBoostChannel = async (src) => ({ channel: src.id, items: null, skipped: true, boost: true })
    svc.memCache = {
      topics: [{ id: 'zhihu:1', topic: '保留我', category: 'society', categories: ['society'], fetchedAt: 1 }],
      fetchedAt: 1700000000000, channelStats: {},
    }
    const res = await svc.fetchTopics({ force: true, boostCategories: ['finance'] })
    expect(res.preservedStaleCache).toBe(true)
    expect(res.topics.map(t => t.topic)).toEqual(['保留我'])
  })
})
