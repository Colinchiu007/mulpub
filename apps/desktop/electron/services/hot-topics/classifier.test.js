// @ts-check
/**
 * classifier v3 契约测试（TDD 红灯先行）
 *
 * 锁死三类行为：
 *   A. 新增 ai 分类与 tech 的边界（本次需求「类别中再增加一个 AI 分类」）；
 *   B. 「科技类混入不沾边内容」的机制级回归锁（根因逐条反证）；
 *   C. general 兜底的语义收窄（无信号才 general，不因弱命中乱挂）。
 */
import { describe, it, expect } from 'vitest'
import {
  CATEGORY_KEYS,
  KEYWORD_RULES,
  classifyTopic,
  classifyTopicMulti,
  MIN_SCORE,
} from './classifier.js'
import { DEFAULT_CATEGORY_KEYS as RENDERER_DEFAULT_KEYS } from '../../../src/features/content/content-categories.js'

describe('classifier v3 分类体系', () => {
  it('CATEGORY_KEYS 共 11 类且 ai 紧随 tech（UI 排序契约）', () => {
    expect(CATEGORY_KEYS).toHaveLength(11)
    expect(CATEGORY_KEYS).toContain('ai')
    expect(CATEGORY_KEYS.indexOf('ai')).toBe(CATEGORY_KEYS.indexOf('tech') + 1)
    expect(new Set(CATEGORY_KEYS).size).toBe(CATEGORY_KEYS.length)
  })

  it('渲染层内置类别 key 与分类器 CATEGORY_KEYS 完全一致（跨端契约，顺序也一致）', () => {
    expect([...RENDERER_DEFAULT_KEYS]).toEqual([...CATEGORY_KEYS])
  })

  it('KEYWORD_RULES 覆盖除 general 外的全部类别，且每条规则都有 strong/weak 数组', () => {
    const ruleCats = KEYWORD_RULES.map((r) => r.category)
    for (const key of CATEGORY_KEYS) {
      if (key === 'general') continue
      expect(ruleCats).toContain(key)
    }
    for (const r of KEYWORD_RULES) {
      expect(Array.isArray(r.strong)).toBe(true)
      expect(Array.isArray(r.weak)).toBe(true)
      expect(r.strong.length).toBeGreaterThan(0)
    }
  })

  it('关键词规则内不得出现裸单字（无词边界的中文单字必然误伤）', () => {
    for (const r of KEYWORD_RULES) {
      for (const kw of [...r.strong, ...r.weak]) {
        const isCjkOnly = /^[\u4e00-\u9fff]+$/.test(kw)
        if (isCjkOnly) expect(kw.length).toBeGreaterThanOrEqual(2)
        // 拉丁词一律走词边界匹配，长度≥2 才有判别力
        expect(kw.length).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

describe('AI 分类与科技分类的边界（新增类别）', () => {
  it('大模型/AIGC/智能体等强词 → ai', () => {
    expect(classifyTopic(null, 'zhihu', '国产大模型发布新版本')).toBe('ai')
    expect(classifyTopic(null, 'zhihu', 'AIGC 生成内容监管新规')).toBe('ai')
    expect(classifyTopic(null, 'zhihu', '智能体 Agent 商业化提速')).toBe('ai')
    expect(classifyTopic(null, 'zhihu', '多模态大模型开源')).toBe('ai')
  })

  it('AI 硬件仍归 ai（AI 芯片/算力），纯硬件归 tech', () => {
    expect(classifyTopic(null, 'zhihu', 'AI芯片算力需求暴涨')).toBe('ai')
    expect(classifyTopic(null, 'zhihu', '国产芯片半导体产业链突破')).toBe('tech')
    expect(classifyTopic(null, 'zhihu', '光刻机出口管制升级')).toBe('tech')
  })

  it('英文缩写走词边界：Air / said 等不得命中 AI', () => {
    expect(classifyTopic(null, 'zhihu', 'Air Jordan 复刻发售')).not.toBe('ai')
    expect(classifyTopic(null, 'zhihu', 'He said nothing about the market')).not.toBe('ai')
    // 真实 AI 仍命中
    expect(classifyTopic(null, 'zhihu', 'AI 应用落地加速')).toBe('ai')
  })

  it('域级泛称「科技」+ AI 主题 → AI 为主标签（泛称不参与裁决）', () => {
    const r = classifyTopicMulti('科技', 'toutiao', '人工智能大模型集中发布')
    expect(r.category).toBe('ai')
  })

  it('AI 原生分类（若渠道下发）直挂 ai', () => {
    expect(classifyTopic('AI', 'weibo', '任意文本')).toBe('ai')
    expect(classifyTopic('人工智能', 'weibo', '任意文本')).toBe('ai')
  })
})

describe('根因回归锁：科技分类不再混入不沾边内容', () => {
  it('根因①B站「知识」分区是泛知识（历史/法律/职场），不得整批挂 tech', () => {
    expect(classifyTopic('知识', 'bilibili', '任意文本')).not.toBe('tech')
    // 但真有科技信号时仍由关键词判 tech
    expect(classifyTopic('知识', 'bilibili', '半导体产业链科普')).toBe('tech')
  })

  it('根因②「科学科普」是跨学科泛科普（恐龙/地质/生物），不再整批挂 tech', () => {
    // v3 行为变更（v2 契约曾是「科学科普 → tech」）：该桶跨学科混装，整体映射必然错配，
    // 故降级为「弱原生 → 综合」，真有科技信号时由关键词判 tech。
    expect(classifyTopic('科学科普', 'weibo', '恐龙化石最新发现')).toBe('general')
    expect(classifyTopic('科学科普', 'bilibili', '任意文本')).toBe('general')
    expect(classifyTopic('科学科普', 'bilibili', '量子计算最新进展')).toBe('tech')
  })

  it('根因③「汽车」不是科技（无 auto 分类时归综合）', () => {
    expect(classifyTopic('汽车', 'weibo', '任意文本')).toBe('general')
    expect(classifyTopic('汽车', 'toutiao', '任意文本')).toBe('general')
    expect(classifyTopic('汽车', 'weibo', '新款车型上市销量翻倍')).not.toBe('tech')
  })

  it('根因④可信原生分类仍优先，但「域级泛称」不再提供原生信息', () => {
    expect(classifyTopic('财经', 'toutiao', '任意文本')).toBe('finance')
    // 「数码」是内容域明确的原生分类 → 仍是可信原生
    expect(classifyTopic('数码', 'weibo', '任意文本')).toBe('tech')
    expect(classifyTopic('软件应用', 'bilibili', '任意文本')).toBe('tech')
    // 「科技」是栏目名而非单条定性（用户在科技类下看到不沾边内容的第一症状）：
    // v3 起它不参与裁决，零信号时落 general，有科技信号时仍由关键词判 tech
    expect(classifyTopic('科技', 'toutiao', '任意文本')).toBe('general')
    expect(classifyTopic('科技', 'toutiao', '今晚吃什么')).toBe('general')
    expect(classifyTopic('科技', 'toutiao', '芯片产业新突破')).toBe('tech')
  })

  it('根因⑤弱命中不单独成类（低于 MIN_SCORE 不分类）', () => {
    expect(MIN_SCORE).toBeGreaterThanOrEqual(3)
    // '消费'（弱词，长度2）单词命中不足以判 finance
    expect(classifyTopic(null, 'zhihu', '消费')).toBe('general')
    // 两个弱词叠加则足以判别
    expect(classifyTopic(null, 'zhihu', '消费 投资')).not.toBe('general')
  })

  it('根因⑥国家名是弱信号：美国男篮夺冠属于体育而非国际', () => {
    expect(classifyTopic(null, 'zhihu', '美国男篮夺冠')).toBe('sports')
    expect(classifyTopic(null, 'zhihu', '外交部回应美国制裁')).toBe('international')
  })
})

describe('分类质量抽查（不得回归为 general 黑洞）', () => {
  const cases = [
    [null, 'zhihu', 'A股大涨沪指重返3000点', 'finance'],
    [null, 'zhihu', '国足世界杯预选赛', 'sports'],
    [null, 'zhihu', '法院一审判决被告赔偿', 'society'],
    [null, 'baidu', '卫健委通报最新疫情数据', 'health'],
    [null, 'zhihu', '高考录取分数线公布', 'education'],
    [null, 'zhihu', '明星演唱会门票秒空', 'entertainment'],
    [null, 'zhihu', '恋爱婚姻情感话题引热议', 'emotion'],
    [null, 'zhihu', '完全无关文本', 'general'],
  ]
  for (const [raw, ch, text, expected] of cases) {
    it(`「${text}」→ ${expected}`, () => {
      expect(classifyTopic(raw, ch, text)).toBe(expected)
    })
  }
})

describe('classifyTopicMulti v3', () => {
  it('strong 原生优先为主标签，关键词补次标签（最多 3 个）', () => {
    const r = classifyTopicMulti('健康医疗', 'weibo', 'AI辅助诊断新药获批')
    expect(r.category).toBe('health')
    expect(r.categories[0]).toBe('health')
    expect(r.categories).toContain('ai')
    expect(r.categories.length).toBeLessThanOrEqual(3)
  })

  it('弱原生分类不覆盖关键词主标签', () => {
    const r = classifyTopicMulti('知识', 'bilibili', '央行降息利好股市')
    expect(r.category).toBe('finance')
  })

  it('无任何信号 → general 且 categories 非空', () => {
    const r = classifyTopicMulti(null, 'zhihu', '完全无关文本')
    expect(r.category).toBe('general')
    expect(r.categories).toEqual(['general'])
  })

  it('general 是「无信号」专属：一旦有真实分类就不得与 general 混排', () => {
    // 弱原生兜底为 general，但关键词给出真实分类 ⇒ 结果里不能残留 general
    const r = classifyTopicMulti('知识', 'bilibili', '央行降息利好股市')
    expect(r.categories).not.toContain('general')
    const r2 = classifyTopicMulti(null, 'zhihu', 'AI大模型最新突破')
    expect(r2.categories).not.toContain('general')
  })
})

describe('词表修补回归（调研报告 B7/B8/B13 实测反例）', () => {
  it('跨域复合题不被长词带偏：和 AI 聊天机器人谈恋爱 → 情感', () => {
    expect(classifyTopic(null, 'zhihu', '和 AI 聊天机器人谈恋爱')).toBe('emotion')
  })

  it('漏判面补词：折叠屏手机 → 科技', () => {
    expect(classifyTopic(null, 'zhihu', '华为发布折叠屏手机')).toBe('tech')
  })

  it('漏判面补词：猪肉价格 + CPI → 财经', () => {
    expect(classifyTopic(null, 'zhihu', '猪肉价格连跌 CPI 走低')).toBe('finance')
  })

  it('泛化词降级：「上市」不再单独把汽车/消费品新闻判成财经', () => {
    expect(classifyTopic(null, 'zhihu', '新款车型上市')).not.toBe('finance')
    // 但真实资本市场语义仍判财经（新股 / 上市公司）
    expect(classifyTopic(null, 'zhihu', '新股上市首日大涨')).toBe('finance')
    expect(classifyTopic(null, 'zhihu', '新股申购中签率公布')).toBe('finance')
  })

  it('全角拉丁词可命中（ＡＩ → ai）', () => {
    expect(classifyTopic(null, 'zhihu', 'ＡＩ 应用落地加速')).toBe('ai')
  })
})
