// @ts-check
/**
 * 新增数据源契约测试（2026-10-12 调研落地）
 *
 * 覆盖：抖音三端点同构解析、小红书 App 热搜、凤凰网两个出口、今日头条字段修正，
 * 以及 service 层的两条新合同 ——「空列表视为失败」「fallback 顺序降级」。
 * 所有端点/字段路径均来自 `01-docs/research/hot-topics-sources-*.md` 的实测记录。
 */
import { describe, it, expect, vi } from 'vitest'
import { CHANNEL_CONFIGS } from './hot-topics-service.js'
import { HotTopicsService } from './hot-topics-service.js'
import {
  parseCnNumber,
  parseDouyin,
  parseToutiao,
  parseXiaohongshu,
  parseIfeng,
  parseIfengInline,
  extractIfengAllData,
} from './hot-topics/channels.js'

describe('parseCnNumber：中文/缩写数量字符串', () => {
  it('w / 万 后缀按 10000 计，纯数字原样', () => {
    expect(parseCnNumber('947.5w')).toBe(9475000)
    expect(parseCnNumber('1.2万')).toBe(12000)
    expect(parseCnNumber('8850')).toBe(8850)
    expect(parseCnNumber('')).toBeNull()
    expect(parseCnNumber(null)).toBeNull()
    expect(parseCnNumber('热')).toBeNull()
  })
})

describe('parseDouyin：web / snssdk / iesdouyin 三端点共用一个解析器', () => {
  it('web 形态：data.word_list + data.trending_list 合并去重，position 优先做 rank', () => {
    const json = {
      data: {
        word_list: [
          { word: '热点甲', hot_value: 8888888, position: 1, sentence_id: 's1' },
          { word: '热点乙', hot_value: 100, position: 2 },
        ],
        trending_list: [
          { word: '热点乙', hot_value: 0, position: 1 }, // 与主榜重复 → 丢弃
          { word: '上升热点丙', hot_value: 0, position: 1, sentence_id: 's3' },
        ],
      },
    }
    const items = parseDouyin(json)
    expect(items.map(x => x.topic)).toEqual(['热点甲', '热点乙', '上升热点丙'])
    expect(items[0]).toMatchObject({ rank: 1, hotValue: 8888888, url: 'https://www.douyin.com/hot/s1' })
    expect(items[1]).toMatchObject({ rank: 2, hotValue: 100 })
    // 上升热点带原生标记，url 缺失时为 null
    expect(items[2]).toMatchObject({ rawCategory: '上升热点' })
  })

  it('iesdouyin 形态：顶层 word_list（无 data 包裹）', () => {
    const json = { word_list: [{ word: '旧端点热点', hot_value: 12 }], status_code: 0 }
    const items = parseDouyin(json)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ channel: 'douyin', topic: '旧端点热点', hotValue: 12 })
  })

  it('空 word_list 返回空数组（由 service 层判失败）', () => {
    expect(parseDouyin({ data: { word_list: [] } })).toEqual([])
    expect(parseDouyin(null)).toEqual([])
  })
})

describe('parseXiaohongshu：App 端热搜（免登录，需静态 shield 头）', () => {
  it('data.items[].title / score / word_type，rank 按数组序（接口无 rank 字段）', () => {
    const json = {
      code: 0,
      data: {
        title: '小红书实时热点',
        items: [
          { title: '秋冬穿搭指南', score: '947.5w', word_type: '热', id: 'a' },
          { title: '通勤妆教程', score: '1200', word_type: '无', id: 'b' },
        ],
      },
    }
    const items = parseXiaohongshu(json)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ channel: 'xiaohongshu', rank: 1, hotValue: 9475000, rawCategory: '热' })
    expect(items[0].url).toContain('https://www.xiaohongshu.com/search_result?keyword=')
    expect(items[1].hotValue).toBe(1200)
  })

  it('结构缺失 / 空 items → 空数组，不抛错', () => {
    expect(parseXiaohongshu({ data: {} })).toEqual([])
    expect(parseXiaohongshu({ data: { items: [] } })).toEqual([])
    expect(parseXiaohongshu(null)).toEqual([])
  })
})

describe('parseIfeng / parseIfengInline：同一榜单的两个出口，字段名不同', () => {
  it('JSON 出口用 link.url（顶层无 url 字段）', () => {
    const json = {
      code: 0,
      data: {
        list: [
          { title: '凤凰热榜甲', link: { url: 'https://news.ifeng.com/a/1' }, commentsCount: 42, type: 'doc' },
          { title: '凤凰热榜乙&amp;测试', link: { url: 'https://news.ifeng.com/a/2' } },
        ],
      },
    }
    const items = parseIfeng(json)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ channel: 'ifeng', rank: 1, hotValue: 42, rawCategory: 'doc' })
    expect(items[0].url).toBe('https://news.ifeng.com/a/1')
    expect(items[1].topic).toBe('凤凰热榜乙&测试')
    expect(items[1].hotValue).toBeNull()
  })

  it('内联出口用顶层 url，并必须做花括号配对（多行 JSON 惰性正则会截断）', () => {
    // 故意构造：多行 + 字符串里含 `}` + 嵌套对象 → 惰性正则会在第一个 `}` 处截断
    const html = [
      '<html><script>',
      'var allData = {',
      '  "hotRankData": {',
      '    "update_time": "2026-10-12 07:52:20",',
      '    "data": [',
      '      {"base62Id":"x1","title":"含右括号}的标题","url":"https://i.ifeng.com/1","newsTime":"2026-10-11 23:33:34"},',
      '      {"base62Id":"x2","title":"第二条","url":"https://i.ifeng.com/2"}',
      '    ]',
      '  }',
      '};',
      '</script></html>',
    ].join('\n')
    const all = extractIfengAllData(html)
    expect(all).not.toBeNull()
    expect(all.hotRankData.update_time).toBe('2026-10-12 07:52:20')
    const items = parseIfengInline(html)
    expect(items).toHaveLength(2)
    expect(items[0].topic).toBe('含右括号}的标题')
    expect(items[0].url).toBe('https://i.ifeng.com/1')
  })

  it('无 allData / 结构不符 → 空数组，不抛错', () => {
    expect(extractIfengAllData('<html>no data</html>')).toBeNull()
    expect(parseIfengInline('<html>no data</html>')).toEqual([])
    expect(parseIfengInline(null)).toEqual([])
  })
})

describe('parseToutiao：字段修正（无 Category，用 InterestCategory[0]）', () => {
  it('优先 InterestCategory，回退历史 Category，HotValue 字符串可转数字', () => {
    const json = {
      data: [
        { Title: '头条甲', HotValue: '123456', InterestCategory: ['科技'], ClusterIdStr: '999' },
        { Title: '头条乙', HotValue: '100', Category: '财经' },
      ],
    }
    const items = parseToutiao(json)
    expect(items[0]).toMatchObject({ hotValue: 123456, rawCategory: '科技', url: 'https://www.toutiao.com/trending/999/' })
    expect(items[1].rawCategory).toBe('财经')
  })
})

describe('CHANNEL_CONFIGS：新增小红书与凤凰网，抖音带顺序降级链', () => {
  it('共 10 个渠道，全部 intervalMinutes >= 5 且 https', () => {
    expect(CHANNEL_CONFIGS).toHaveLength(10)
    for (const cfg of CHANNEL_CONFIGS) {
      expect(cfg.intervalMinutes).toBeGreaterThanOrEqual(5)
      expect(cfg.url.startsWith('https://')).toBe(true)
    }
    const ids = CHANNEL_CONFIGS.map(c => c.id)
    expect(ids).toContain('xiaohongshu')
    expect(ids).toContain('ifeng')
  })

  it('小红书渠道带齐固定头六项（缺任一 xy-* 或 shield 即 406）', () => {
    const xhs = CHANNEL_CONFIGS.find(c => c.id === 'xiaohongshu')
    expect(xhs.url).toBe('https://edith.xiaohongshu.com/api/sns/v1/search/hot_list')
    for (const h of ['User-Agent', 'referer', 'xy-direction', 'shield', 'xy-platform-info', 'xy-common-params']) {
      expect(xhs.headers[h]).toBeTruthy()
    }
    expect(xhs.riskLevel).toBe('high')
  })

  it('抖音 fallback 链是「同源顺序降级」，不是并列渠道（避免 sourceBonus 灌水）', () => {
    const douyin = CHANNEL_CONFIGS.find(c => c.id === 'douyin')
    expect(douyin.fallbacks).toHaveLength(2)
    expect(douyin.fallbacks[0].url).toContain('aweme-lq.snssdk.com')
    expect(douyin.fallbacks[1].url).toContain('iesdouyin.com')
    // 兜底端点不得作为独立渠道出现（否则同源条目会被算成「多榜同现」）
    const ids = CHANNEL_CONFIGS.map(c => c.id)
    expect(ids).not.toContain('douyin_app')
    expect(ids).not.toContain('douyin_ies')
  })

  it('凤凰网 fallback 使用 ifeng_inline 解析器（字段名与主端点不同）', () => {
    const ifeng = CHANNEL_CONFIGS.find(c => c.id === 'ifeng')
    expect(ifeng.fallbacks).toHaveLength(1)
    expect(ifeng.fallbacks[0].parser).toBe('ifeng_inline')
  })
})

describe('_collectChannel 新合同：空列表视为失败 + fallback 顺序降级 + 406 专项告警', () => {
  function makeService (logs = []) {
    return new HotTopicsService({
      log: {
        info: () => {},
        warn: (m) => logs.push(String(m)),
        error: () => {},
        notify: () => {},
      },
    })
  }

  const cfg = {
    id: 'synthetic',
    name: '合成渠道',
    url: 'https://primary.invalid/',
    headers: {},
    intervalMinutes: 10,
    riskLevel: 'low',
    parser: 'douyin', // fallback 默认继承主端点解析器（除非自己声明 parser）
    fallbacks: [{ url: 'https://fallback.invalid/', headers: {} }],
  }

  it('主端点返回空列表 → 视为失败，继续尝试 fallback 并成功恢复', async () => {
    const svc = makeService()
    const seen = []
    svc._fetchChannel = async (c) => {
      seen.push(c.url)
      if (c.url.includes('primary')) return JSON.stringify({ data: { word_list: [] } })
      return JSON.stringify({ data: { word_list: [{ word: '兜底热点', hot_value: 5, position: 1 }] } })
    }
    const res = await svc._collectChannel(cfg, Date.now())
    expect(seen).toEqual(['https://primary.invalid/', 'https://fallback.invalid/'])
    expect(res.items).toHaveLength(1)
    expect(res.items[0].topic).toBe('兜底热点')
    expect(res.viaFallback).toBe(1)
  })

  it('全部尝试都返回空列表 → 记失败并带明确 error（不得记成功，否则熔断永不打开）', async () => {
    const logs = []
    const svc = makeService(logs)
    svc._fetchChannel = async () => JSON.stringify({ data: { word_list: [] } })
    const res = await svc._collectChannel(cfg, Date.now())
    expect(res.items).toBeNull()
    expect(res.error).toContain('empty list')
    expect(svc.breaker.failures.get('synthetic')).toBe(1)
    expect(logs.some(m => m.includes('empty list'))).toBe(true)
  })

  it('406 单独告警并点出 shield 失效（唯一需要人工介入的形态）', async () => {
    const logs = []
    const svc = makeService(logs)
    svc._fetchChannel = async () => { throw new Error('HTTP 406') }
    const res = await svc._collectChannel({ id: 'xiaohongshu', url: 'https://x.invalid/', headers: {}, intervalMinutes: 30, parser: 'xiaohongshu' }, Date.now())
    expect(res.error).toContain('406')
    expect(logs.some(m => m.includes('406') && m.includes('shield'))).toBe(true)
  })

  it('主端点异常（非空）也走 fallback，最终成功不记失败', async () => {
    const svc = makeService()
    svc._fetchChannel = async (c) => {
      if (c.url.includes('primary')) throw new Error('HTTP 500')
      return JSON.stringify({ data: { word_list: [{ word: '兜底乙', hot_value: 1, position: 1 }] } })
    }
    const res = await svc._collectChannel(cfg, Date.now())
    expect(res.items[0].topic).toBe('兜底乙')
    expect(svc.breaker.failures.get('synthetic') || 0).toBe(0)
  })
})
