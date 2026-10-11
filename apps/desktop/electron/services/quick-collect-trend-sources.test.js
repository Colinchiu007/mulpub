/**
 * quick-collect-trend-sources — S2 抓取与解析
 *
 * 五条不可省：
 *   ① 时间解析三种形态（RFC2822 / ISO / HuggingFace 的 `MM/DD/YYYY HH:mm:ss`）——
 *      最后一种错解析会把 10/07/2026 读成 2026-07-10，必须单独锁；
 *   ② 解析不出时间返回 **null**（不得退化成"现在"，那是把旧闻伪装成新闻）；
 *   ③ 字节上限与条数上限：超大 feed 必须截断，且截断落在完整条目边界；
 *   ④ 计划性空榜（arXiv `skipDays`）与源故障必须可区分；
 *   ⑤ 节流与缓存：只有真正放行去抓的请求才消耗 interval；TTL 内不重复抓。
 */
import { describe, it, expect, vi } from 'vitest'

async function mod () { return import('../services/quick-collect-trend-sources') }

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Solidot</title>
<item><title><![CDATA[AI &amp; 芯片：某公司发布新模型]]></title><link>https://www.solidot.org/story?sid=1</link><pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate></item>
<item><title>第二条</title><link>https://www.solidot.org/story?sid=2</link><pubDate>Sat, 10 Oct 2026 02:00:00 +0000</pubDate></item>
<item><title>没有链接的条目</title><pubDate>Sat, 10 Oct 2026 03:00:00 +0000</pubDate></item>
<item><title>没有时间的条目</title><link>https://www.solidot.org/story?sid=4</link></item>
</channel></rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>arXiv</title>
<entry><title>Paper A</title><link href="https://arxiv.org/abs/2610.00001"/><published>2026-10-11T01:00:00Z</published></entry>
<entry><title>Paper B</title><link href="https://arxiv.org/abs/2610.00002"/><updated>2026-10-10T01:00:00Z</updated></entry>
</feed>`

const ARXIV_EMPTY = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>cs.AI updates on arXiv.org</title>
<lastBuildDate>Sun, 11 Oct 2026 04:00:00 +0000</lastBuildDate>
<skipDays><day>Saturday</day><day>Sunday</day></skipDays>
</channel></rss>`

function jsonRes (obj) {
  const text = JSON.stringify(obj)
  return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer, text: async () => text }
}
function textRes (text, { status = 200, ok = true } = {}) {
  return { ok, status, arrayBuffer: async () => new TextEncoder().encode(text).buffer, text: async () => text }
}

describe('S2/时间解析', () => {
  it('RFC2822 / ISO / HuggingFace 美国格式都能解析；非法输入返回 null（不退化成 now）', async () => {
    const { parseTime } = await mod()
    expect(parseTime('Sun, 11 Oct 2026 02:00:00 +0000')).toBe(Math.floor(Date.parse('2026-10-11T02:00:00Z') / 1000))
    expect(parseTime('2026-10-11T01:00:00Z')).toBe(Math.floor(Date.parse('2026-10-11T01:00:00Z') / 1000))
    // HF 的 `10/07/2026 20:00:00` 必须是 10 月 7 日（美式月/日/年），不是 7 月 10 日
    expect(parseTime('10/07/2026 20:00:00')).toBe(Math.floor(Date.UTC(2026, 9, 7, 20, 0, 0) / 1000))
    expect(parseTime('')).toBe(null)
    expect(parseTime(null)).toBe(null)
    expect(parseTime('昨天')).toBe(null)
  })
})

describe('S2/RSS 与 Atom 解析', () => {
  it('RSS：解 CDATA 与实体、缺链接的条目 url 为空、缺时间的条目 publishedAt=null', async () => {
    const { parseFeedItems } = await mod()
    const items = parseFeedItems(RSS)
    // 纯解析器不做"要不要这条"的判定：缺链接的条目照样产出（url 为空），
    // 由 fetchTrendSource 统一过滤——职责分开，测试也分开断言。
    expect(items.map((x) => x.title)).toEqual(['AI & 芯片：某公司发布新模型', '第二条', '没有链接的条目', '没有时间的条目'])
    expect(items[0].url).toBe('https://www.solidot.org/story?sid=1')
    expect(items[0].publishedAt).toBe(Math.floor(Date.parse('2026-10-11T02:00:00Z') / 1000))
    expect(items[2].url).toBe('')
    expect(items[3].publishedAt).toBe(null)
  })

  it('Atom：用 link href 与 published/updated', async () => {
    const { parseFeedItems } = await mod()
    const items = parseFeedItems(ATOM)
    expect(items).toHaveLength(2)
    expect(items[0].url).toBe('https://arxiv.org/abs/2610.00001')
    expect(items[1].publishedAt).toBe(Math.floor(Date.parse('2026-10-10T01:00:00Z') / 1000))
  })

  it('条数上限：limit 之外不产出', async () => {
    const { parseFeedItems } = await mod()
    const many = '<rss>' + Array.from({ length: 30 }, (_, i) => `<item><title>t${i}</title><link>https://a.com/${i}</link><pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate></item>`).join('') + '</rss>'
    expect(parseFeedItems(many, { limit: 5 })).toHaveLength(5)
  })

  it('字节上限：截断到 MAX_BYTES 且半个条目不被产出', async () => {
    const { readCapped, parseFeedItems, MAX_BYTES } = await mod()
    // 造一个远超上限的 feed：前两条完整，第三条被截断
    const head = '<rss>' + Array.from({ length: 2 }, (_, i) => `<item><title>ok${i}</title><link>https://a.com/${i}</link><pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate></item>`).join('')
    const filler = 'x'.repeat(MAX_BYTES + 5000)
    const res = { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(head + '<item><title>cut</title><link>https://a.com/cut</link><desc>' + filler).buffer }
    const { text, truncated } = await readCapped(res)
    expect(truncated).toBe(true)
    expect(text.length).toBeLessThanOrEqual(MAX_BYTES)
    const items = parseFeedItems(text)
    expect(items.map((x) => x.title)).toEqual(['ok0', 'ok1']) // 被截断的条目不得产出
  })
})

describe('S2/JSON 源', () => {
  it('V2EX hot.json：created 为 unix 秒', async () => {
    const { parseV2exHot } = await mod()
    const out = parseV2exHot([{ title: '话题', url: 'https://www.v2ex.com/t/1', created: 1791694999, replies: 12 }])
    expect(out[0]).toEqual({ title: '话题', url: 'https://www.v2ex.com/t/1', publishedAt: 1791694999, replies: 12 })
  })

  it('HuggingFace daily_papers：用 paper.id 组装链接、解析美式时间', async () => {
    const { parseHfDailyPapers } = await mod()
    const out = parseHfDailyPapers([{ title: 'Paper X', publishedAt: '10/07/2026 20:00:00', paper: { id: '2610.00001', upvotes: 42 } }])
    expect(out[0].url).toBe('https://huggingface.co/papers/2610.00001')
    expect(out[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 9, 7, 20, 0, 0) / 1000))
    expect(out[0].upvotes).toBe(42)
  })
})

describe('S2/fetchTrendSource', () => {
  it('成功：published 源产出 createdUtc 且不写 observedAt', async () => {
    const { fetchTrendSource } = await mod()
    const { getSource } = await import('../services/quick-collect-sources')
    const res = await fetchTrendSource(getSource('solidot'), { fetchFn: async () => textRes(RSS) })
    expect(res.state).toBe('ok')
    expect(res.items.length).toBe(3)
    expect(res.items[0]).toMatchObject({ source: 'solidot', sourceType: 'realtime', timeKind: 'published' })
    expect(res.items[0].createdUtc).toBe(Math.floor(Date.parse('2026-10-11T02:00:00Z') / 1000))
    expect(res.items[0].observedAt).toBe(null)
  })

  it('HTTP 非 2xx → failed（不抛错）', async () => {
    const { fetchTrendSource } = await mod()
    const { getSource } = await import('../services/quick-collect-sources')
    const res = await fetchTrendSource(getSource('solidot'), { fetchFn: async () => textRes('nope', { status: 503, ok: false }) })
    expect(res.state).toBe('failed')
    expect(res.items).toEqual([])
  })

  it('arXiv 周末空榜 → emptyBySchedule（不是故障）', async () => {
    const { fetchTrendSource } = await mod()
    const { getSource } = await import('../services/quick-collect-sources')
    const res = await fetchTrendSource(getSource('arxiv_cs_ai'), { fetchFn: async () => textRes(ARXIV_EMPTY) })
    expect(res.state).toBe('ok')
    expect(res.items).toEqual([])
    expect(res.emptyBySchedule).toBe(true)
  })

  it('JSON 源（hf_papers）走 JSON 解析器', async () => {
    const { fetchTrendSource } = await mod()
    const { getSource } = await import('../services/quick-collect-sources')
    const res = await fetchTrendSource(getSource('hf_papers'), { fetchFn: async () => jsonRes([{ title: 'P', publishedAt: '10/11/2026 01:00:00', paper: { id: 'x', upvotes: 3 } }]) })
    expect(res.state).toBe('ok')
    expect(res.items[0].url).toBe('https://huggingface.co/papers/x')
    expect(res.items[0].hotValue).toBe(3)
  })
})

describe('S2/createFeedTrendFetcher：节流与缓存', () => {
  it('只处理 provider=feed 的源；TTL 内复用缓存；interval 内跳过（force 可绕过）', async () => {
    const { createFeedTrendFetcher } = await mod()
    let clock = 1_000_000
    const fetchFn = vi.fn(async () => textRes(RSS))
    const fn = createFeedTrendFetcher({ fetchFn, now: () => clock, ttlMs: 60_000 })
    const first = await fn(['solidot', 'weibo'])
    expect(fetchFn).toHaveBeenCalledTimes(1) // weibo 是 hot-topics provider，不归 feed
    expect(first.sourceStats.solidot).toBe('ok')
    expect(first.sourceStats.weibo).toBeUndefined()
    // TTL 内：缓存命中，不再抓
    const second = await fn(['solidot'])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(second.items.length).toBe(first.items.length)
    // 越过 TTL 但在 interval（solidot=30 分钟）内：节流跳过
    clock += 120_000
    const third = await fn(['solidot'])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(third.sourceStats.solidot).toBe('skipped')
    // force 绕过节流与缓存
    const forced = await fn(['solidot'], { force: true })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(forced.sourceStats.solidot).toBe('ok')
  })
})
