// @ts-check
/**
 * gyread.com（AI 情报日报）接入契约测试
 *
 * 覆盖：search-index.json 索引解析、单期日报 HTML 的原文链接抽取（双版式兼容）、
 * CATEGORY_BOOSTS.ai 的 gyread 补拉源、enrichWithEdition 增强语义、
 * scorer 渠道权重、分类器 AI 词表扩充。
 *
 * 全部端点/字段路径/版式特征均来自 `01-docs/research/hot-topics-sources-gyread.md` 的实测记录。
 * 合规边界：本接入用途是「检索/引用」（用户点回原文），**不是**模型训练语料 ——
 * 站点 robots.txt 对训练类 UA 全站 Disallow，响应头带 `x-robots-tag: noai, noimageai`。
 */
import { describe, it, expect, vi } from 'vitest'
import { CHANNEL_CONFIGS, CATEGORY_BOOSTS, HotTopicsService } from './hot-topics-service.js'
import { parseGyreadIndex, parseGyreadEdition } from './hot-topics/channels.js'
import { CHANNEL_WEIGHTS } from './hot-topics/scorer.js'
import { classifyTopic, classifyTopicMulti } from './hot-topics/classifier.js'

/** 真实形态的索引样本（字段与线上一致，条目为抽样） */
function sampleIndex () {
  return {
    generated: '2026-10-17T18:46:43+08:00',
    pages: 140,
    count: 1421,
    items: [
      {
        u: '2026-10/2026-10-17.html', d: '2026-10-17', c: '头版', g: '',
        t: 'NASA 罗曼望远镜升空 48 天：暗能量告别猜想，宇宙学第一次有了逐帧的测量',
        s: '罗曼空间望远镜升空第 48 天，被《时代周刊》评为 2026 年度最佳发明之一。',
      },
      {
        u: '2026-10/2026-10-17.html', d: '2026-10-17', c: '开源前线', g: '',
        t: 'Meta 正式开源 816B 参数巨兽 Muse Spark Open，42B 激活专家混合架构横扫开权重评测',
        s: 'Meta AI 团队今日正式开源旗下全新权重旗舰模型 Muse Spark Open。',
      },
      {
        u: '2026-10/2026-10-16.html', d: '2026-10-16', c: '前线', g: '',
        t: 'OpenAI 宣布面向学术实验室开放生化推理模型 GPT-Rosalind',
        s: 'OpenAI 今日正式推出专为生命科学研究设立的 Rosalind 学术计划。',
      },
    ],
  }
}

describe('parseGyreadIndex：search-index.json 索引解析', () => {
  it('字段映射：channel/rank/topic/rawCategory/hotValue/url', () => {
    const items = parseGyreadIndex(sampleIndex(), { date: '2026-10-17' })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      channel: 'gyread',
      rank: 1,
      topic: 'NASA 罗曼望远镜升空 48 天：暗能量告别猜想，宇宙学第一次有了逐帧的测量',
      rawCategory: '头版',
      hotValue: null,
    })
    expect(items[0].url).toBe('https://gyread.com/news/2026-10/2026-10-17.html')
  })

  it('date 过滤：只取指定日期', () => {
    const items = parseGyreadIndex(sampleIndex(), { date: '2026-10-16' })
    expect(items).toHaveLength(1)
    expect(items[0].rawCategory).toBe('前线')
    // rank 在过滤后重新连续编号（避免跨日期名次断层）
    expect(items[0].rank).toBe(1)
  })

  it('days 过滤：取最近 N 个日期（含边界）', () => {
    const items = parseGyreadIndex(sampleIndex(), { days: 2 })
    expect(items).toHaveLength(3)
    const dates = new Set(items.map(x => x.rawDate))
    expect(dates.size).toBe(2)
  })

  it('同一日期多条目时 rank 连续唯一', () => {
    const items = parseGyreadIndex(sampleIndex(), { date: '2026-10-17' })
    expect(items.map(x => x.rank)).toEqual([1, 2])
  })

  it('空结构与畸形输入一律返回空数组，不抛错', () => {
    expect(parseGyreadIndex(null, { date: '2026-10-17' })).toEqual([])
    expect(parseGyreadIndex({}, { date: '2026-10-17' })).toEqual([])
    expect(parseGyreadIndex({ items: [] }, { date: '2026-10-17' })).toEqual([])
    expect(parseGyreadIndex({ items: 'not-array' }, { date: '2026-10-17' })).toEqual([])
  })

  it('缺 t/u 的条目被丢弃（无标题则无选题）', () => {
    const json = {
      items: [
        { u: '2026-10/x.html', d: '2026-10-17', c: '头版', t: '', s: 'no title' },
        { u: '2026-10/x.html', d: '2026-10-17', c: '头版', t: '有标题', s: 'ok' },
        { d: '2026-10-17', c: '头版', t: '无 url', s: 'ok' },
      ],
    }
    const items = parseGyreadIndex(json, { date: '2026-10-17' })
    expect(items).toHaveLength(1)
    expect(items[0].topic).toBe('有标题')
  })

  it('不传过滤参数时取全部（调用方自行截断）', () => {
    expect(parseGyreadIndex(sampleIndex())).toHaveLength(3)
  })
})

/** 旧版日报 HTML（实测 ≤2026-10-16）：dateline + 「出处：」前缀单链接 src-line */
function legacyEditionHtml () {
  return [
    '<div class="item">',
    '<div class="dateline">CNBC · 华尔街金融防线 · 独家</div>',
    '<div class="item-title"><span class="accent">摩根大通</span>封禁外部自主 AI 智能体直接访问账户</div>',
    '<div class="body"><p>全球体量最大的商业银行今日宣布正式切断权限。</p></div>',
    '<div class="src-line">出处：<a href="https://www.cnbc.com/2026/10/13/jpmorgan-ai-agents-account-access.html" target="_blank">CNBC 官方报道 ↗</a></div>',
    '</div>',
    '<div class="item">',
    '<div class="dateline">The Verge · 实体安全与司法调查</div>',
    '<div class="item-title">OpenAI 核心高管会议室查获物理录音窃听设备</div>',
    '<div class="body"><p>加州联邦执法部门与旧金山警方今日证实。</p></div>',
    '<div class="src-line">出处：<a href="https://www.theverge.com/ai-artificial-intelligence/1010642/openai-employee-arrested-recording-device" target="_blank">The Verge 报道 ↗</a></div>',
    '</div>',
  ].join('\n')
}

/** 新版日报 HTML（实测 2026-10-17 起）：item-meta + 多链接 src-line */
function modernEditionHtml () {
  return [
    '<div class="item">',
    '<div class="item-title">NASA 罗曼望远镜升空 48 天：暗能量告别猜想</div>',
    '<div class="item-meta"><span class="meta-source">NASA / STScI</span><span class="meta-sep">·</span><span class="meta-topic">深空巡天与计算天文学</span></div>',
    '<div class="body"><p>罗曼空间望远镜升空第 48 天。</p></div>',
    '<div class="src-line"><a href="https://science.nasa.gov/mission/roman-space-telescope/">NASA 罗曼任务官方页面 ↗</a> · <a href="https://www.quantamagazine.org/nasas-roman-telescope-begins-its-dark-energy-survey-20261016/">Quanta Magazine 深度解读 ↗</a></div>',
    '</div>',
    '<div class="item">',
    '<div class="item-title">智谱开源法律垂直大模型 GLM-Legal</div>',
    '<div class="item-meta"><span class="meta-source">BigModel</span><span class="meta-sep">·</span><span class="meta-topic">法律垂直基座模型</span></div>',
    '<div class="body"><p>智谱正式开源法律专用基座。</p></div>',
    '<div class="src-line"><a href="https://www.bigmodel.cn/glm-legal">BigModel 官方 ↗</a></div>',
    '</div>',
  ].join('\n')
}

describe('parseGyreadEdition：旧版版式（dateline + 单链接 src-line）', () => {
  it('抽出标题、来源文本与单个原文 URL', () => {
    const items = parseGyreadEdition(legacyEditionHtml())
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      channel: 'gyread',
      topic: '摩根大通封禁外部自主 AI 智能体直接访问账户',
      sourceText: 'CNBC · 华尔街金融防线 · 独家',
    })
    expect(items[0].sourceUrls).toEqual(['https://www.cnbc.com/2026/10/13/jpmorgan-ai-agents-account-access.html'])
    expect(items[1].sourceUrls).toHaveLength(1)
  })

  it('标题内的 span 标签被剥掉（只留纯文本）', () => {
    const items = parseGyreadEdition(legacyEditionHtml())
    expect(items[0].topic).not.toContain('<span')
    expect(items[0].topic).toContain('摩根大通')
  })
})

describe('parseGyreadEdition：新版版式（item-meta + 多链接 src-line）', () => {
  it('多出处以数组返回（长度 >= 2）', () => {
    const items = parseGyreadEdition(modernEditionHtml())
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      channel: 'gyread',
      topic: 'NASA 罗曼望远镜升空 48 天：暗能量告别猜想',
      sourceText: 'NASA / STScI · 深空巡天与计算天文学',
    })
    expect(items[0].sourceUrls).toEqual([
      'https://science.nasa.gov/mission/roman-space-telescope/',
      'https://www.quantamagazine.org/nasas-roman-telescope-begins-its-dark-energy-survey-20261016/',
    ])
  })

  it('单出处也走数组形态（契约一致，调用方无需分支）', () => {
    const items = parseGyreadEdition(modernEditionHtml())
    expect(items[1].sourceUrls).toEqual(['https://www.bigmodel.cn/glm-legal'])
  })
})

describe('parseGyreadEdition：两版混存与 fail-open', () => {
  it('同一 HTML 内新旧结构并存时各自按对应版式抽取', () => {
    const items = parseGyreadEdition(legacyEditionHtml() + '\n' + modernEditionHtml())
    expect(items).toHaveLength(4)
    // 旧版两条：来源取自 dateline
    expect(items[0].sourceText).toBe('CNBC · 华尔街金融防线 · 独家')
    expect(items[0].sourceUrls).toHaveLength(1)
    // 新版两条：来源取自 item-meta，且第一条是多出处
    expect(items[2].sourceText).toBe('NASA / STScI · 深空巡天与计算天文学')
    expect(items[2].sourceUrls).toHaveLength(2)
  })

  it('无 src-line 时不抛错，条目仍存在但无链接', () => {
    const html = '<div class="item"><div class="item-title">没有出处的条目</div><div class="body"><p>x</p></div></div>'
    const items = parseGyreadEdition(html)
    expect(items).toHaveLength(1)
    expect(items[0].topic).toBe('没有出处的条目')
    expect(items[0].sourceUrls).toEqual([])
  })

  it('空 / null / 无 item-title → 空数组', () => {
    expect(parseGyreadEdition('')).toEqual([])
    expect(parseGyreadEdition(null)).toEqual([])
    expect(parseGyreadEdition('<html><body>没有结构</body></html>')).toEqual([])
  })

  it('非 https 链接被安全 URL 过滤掉', () => {
    const html = '<div class="item"><div class="item-title">题</div>' +
      '<div class="src-line"><a href="javascript:alert(1)">坏链</a> · <a href="https://ok.example.com/a">好链</a></div></div>'
    const items = parseGyreadEdition(html)
    expect(items[0].sourceUrls).toEqual(['https://ok.example.com/a'])
  })
})

describe('CATEGORY_BOOSTS.ai：gyread 补拉源', () => {
  const gyread = () => CATEGORY_BOOSTS.ai.sources.find(s => s.id === 'gyread-ai')

  it('配置字段完整且符合规格', () => {
    const s = gyread()
    expect(s).toBeTruthy()
    expect(s.channel).toBe('gyread')
    expect(s.board).toBe('ai')
    expect(s.boostCategory).toBe('ai')
    expect(s.parser).toBe('gyread_index')
    expect(s.onlyCategory).toBe('ai')
    expect(s.throttleKey).toBe('gyread-index')
    expect(s.intervalMinutes).toBeGreaterThanOrEqual(30)
    expect(s.riskLevel).toBe('medium')
    expect(s.enrichWithEdition).toBe(true)
    expect(s.entryUrl).toBe('https://gyread.com/news/')
  })

  it('与既有 ithome-ai 并存（两源互补）', () => {
    const ids = CATEGORY_BOOSTS.ai.sources.map(s => s.id)
    expect(ids).toContain('ithome-ai')
    expect(ids).toContain('gyread-ai')
    expect(CATEGORY_BOOSTS.ai.sources.length).toBeGreaterThanOrEqual(2)
  })

  it('gyread MUST NOT 作为主渠道（日报非热度榜，会污染 sourceBonus）', () => {
    expect(CHANNEL_CONFIGS).toHaveLength(10)
    expect(CHANNEL_CONFIGS.map(c => c.id)).not.toContain('gyread')
  })
})

describe('scorer：gyread 渠道权重', () => {
  it('权重在 [0.5, 0.85] 且低于国民级综合榜 1.0', () => {
    const w = CHANNEL_WEIGHTS.gyread
    expect(w).toBeGreaterThanOrEqual(0.5)
    expect(w).toBeLessThanOrEqual(0.85)
    for (const ch of ['weibo', 'baidu', 'douyin', 'toutiao', 'zhihu']) {
      expect(w).toBeLessThan(CHANNEL_WEIGHTS[ch])
    }
  })
})

describe('enrichWithEdition：原文链接增强（fail-open）', () => {
  function makeService (logs = []) {
    return new HotTopicsService({
      log: { info: () => {}, warn: (m) => logs.push(String(m)), error: () => {}, notify: () => {} },
    })
  }

  const src = CATEGORY_BOOSTS.ai.sources.find(s => s.id === 'gyread-ai')

  it('增强成功：条目带 sourceUrls 数组与 entryUrl', async () => {
    const svc = makeService()
    svc._fetchChannel = async (c) => {
      if (c.url.includes('search-index.json')) {
        return JSON.stringify(sampleIndex())
      }
      // edition 页：返回新版 HTML（多出处）
      return modernEditionHtml()
    }
    const res = await svc._collectBoostChannel(src, Date.now())
    expect(res.items).not.toBeNull()
    expect(res.items.length).toBeGreaterThan(0)
    const withUrls = res.items.filter(x => Array.isArray(x.sourceUrls) && x.sourceUrls.length)
    expect(withUrls.length).toBeGreaterThan(0)
    expect(withUrls[0].entryUrl).toBe('https://gyread.com/news/')
  })

  it('edition 抓取失败：条目仍在、无 sourceUrls、不记渠道失败', async () => {
    const svc = makeService()
    svc._fetchChannel = async (c) => {
      if (c.url.includes('search-index.json')) return JSON.stringify(sampleIndex())
      throw new Error('HTTP 503')
    }
    const res = await svc._collectBoostChannel(src, Date.now())
    expect(res.error).toBeFalsy()
    expect(res.items.length).toBeGreaterThan(0)
    for (const it of res.items) {
      expect(it.sourceUrls === undefined || it.sourceUrls.length === 0).toBe(true)
    }
  })

  it('edition 返回空 HTML：同样 fail-open（不丢条目）', async () => {
    const svc = makeService()
    svc._fetchChannel = async (c) => {
      if (c.url.includes('search-index.json')) return JSON.stringify(sampleIndex())
      return '<html>no structure</html>'
    }
    const res = await svc._collectBoostChannel(src, Date.now())
    expect(res.error).toBeFalsy()
    expect(res.items.length).toBeGreaterThan(0)
  })

  it('索引本身失败：整渠道记失败（既有合同不放松）', async () => {
    const svc = makeService()
    svc._fetchChannel = async () => { throw new Error('HTTP 404') }
    const res = await svc._collectBoostChannel(src, Date.now())
    expect(res.items).toBeNull()
    expect(res.error).toContain('404')
  })
})

describe('classifier：AI 词表扩充（跨语料通用术语）', () => {
  it('新增 AI 正例全部判 ai', () => {
    expect(classifyTopic(null, 'gyread', '多智能体协作框架正式开源')).toBe('ai')
    expect(classifyTopic(null, 'gyread', '强化学习训练成本大幅下降')).toBe('ai')
    expect(classifyTopic(null, 'gyread', '模型对齐问题引发行业热议')).toBe('ai')
    expect(classifyTopic(null, 'gyread', '世界模型空间推理能力突破')).toBe('ai')
    expect(classifyTopic(null, 'gyread', '端侧推理速度提升三倍')).toBe('ai')
    expect(classifyTopic(null, 'gyread', '开源权重模型追平闭源旗舰')).toBe('ai')
  })

  it('gyread 栏目名（全是域级泛称）不提供原生分类信息', () => {
    // 该站栏目名：头版/前线/开源前线/创造/视觉/投资与资金流向/声音/小结
    // 其中「资讯」「热点」已在 DOMAIN_LEVEL_RAW；其余名称本就不在任何映射表里
    expect(classifyTopic('头版', 'gyread', '今晚吃什么')).toBe('general')
    expect(classifyTopic('前线', 'gyread', '今晚吃什么')).toBe('general')
    expect(classifyTopic('小结', 'gyread', '今晚吃什么')).toBe('general')
  })

  it('栏目名 + AI 关键词 → 由关键词裁决为 ai', () => {
    expect(classifyTopic('开源前线', 'gyread', 'Meta 开源 816B 参数大模型')).toBe('ai')
  })

  it('不为单站私活用语开词表（无判别力的词不得进表）', () => {
    expect(classifyTopic(null, 'gyread', '今日情报日报发布')).not.toBe('ai')
    expect(classifyTopic(null, 'gyread', '前沿信号流更新')).not.toBe('ai')
  })

  it('多标签：AI + 财经交叉时不丢 AI 标签', () => {
    const r = classifyTopicMulti(null, 'gyread', 'AI 公司完成 10 亿美元融资，估值翻倍')
    expect(r.categories).toContain('ai')
    expect(r.categories).toContain('finance')
  })
})
