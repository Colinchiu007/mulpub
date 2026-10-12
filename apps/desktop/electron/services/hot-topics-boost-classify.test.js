// @ts-check
/**
 * 定向补拉（CATEGORY_BOOSTS）分类归属契约测试。
 *
 * 背景（用户反馈「科技类别下有时候存在和科技不沾边的内容」）：
 * `_collectBoostChannel` v2 无条件把补拉条目的 `category` 硬写成 `source.boostCategory`，
 * 分类器完全不参与。于是任何垂类端点里夹带的异质条目（垂类 RSS 的广告位、垂类榜单的
 * 跨界条目）都会被强行挂到目标分类下 —— 这是「科技类混入不沾边内容」的机制级根因之一。
 *
 * v3 契约：补拉条目先走分类器；只有分类器判不出东西（general）时才用垂类榜的
 * `boostCategory` 兜底（垂类榜本身即该分类的定向供给，兜底是合理的）。
 */
import { describe, it, expect } from 'vitest'
import { HotTopicsService, CATEGORY_BOOSTS } from './hot-topics-service.js'

function makeService () {
  return new HotTopicsService({
    log: { info: () => {}, warn: () => {}, error: () => {}, notify: () => {} },
  })
}

/** 构造一条「预算中的科技垂类源」+ 一份夹带异质条目的载荷 */
function weiboPayload () {
  return JSON.stringify({
    data: [
      { word: '财经专题：A股大涨沪指重返3000点', num: 900000, category: '财经' },
      { word: '全新旗舰手机发布 芯片性能翻倍', num: 800000, category: '数码' },
      { word: '今天天气不错适合出门走走', num: 100000, category: null },
    ],
  })
}

describe('CATEGORY_BOOSTS 补拉条目的分类归属（v3）', () => {
  const source = {
    id: 'synthetic-tech-boost',
    name: '合成科技垂类源',
    url: 'https://example.invalid/boost',
    parser: 'weibo',
    channel: 'weibo',
    board: 'tech',
    boostCategory: 'tech',
    headers: {},
    intervalMinutes: 10,
    riskLevel: 'low',
  }

  it('垂类源里的异质条目按分类器真实分类，不被硬挂到 boostCategory', async () => {
    const svc = makeService()
    svc._fetchChannel = async () => weiboPayload()
    const res = await svc._collectBoostChannel(source, Date.now())
    expect(res.items).toBeTruthy()
    const byTopic = Object.fromEntries(res.items.map((x) => [x.topic, x]))
    // 原生分类「财经」→ finance，不得被硬挂成 tech
    expect(byTopic['财经专题：A股大涨沪指重返3000点'].category).toBe('finance')
    expect(byTopic['财经专题：A股大涨沪指重返3000点'].categories).not.toContain('tech')
    // 真科技条目仍归 tech
    expect(byTopic['全新旗舰手机发布 芯片性能翻倍'].category).toBe('tech')
  })

  it('分类器无信号时仍用 boostCategory 兜底（保供语义不丢）', async () => {
    const svc = makeService()
    svc._fetchChannel = async () => weiboPayload()
    const res = await svc._collectBoostChannel(source, Date.now())
    const vague = res.items.find((x) => x.topic === '今天天气不错适合出门走走')
    expect(vague).toBeTruthy()
    expect(vague.category).toBe('tech')
  })

  it('补拉条目 id 仍带 board 段（与主榜不撞号）', async () => {
    const svc = makeService()
    svc._fetchChannel = async () => weiboPayload()
    const res = await svc._collectBoostChannel(source, Date.now())
    const ids = res.items.map((x) => x.id)
    expect(ids.every((id) => id.startsWith('weibo:tech:'))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('解析器报错时走熔断记账且不产出条目（fail-closed）', async () => {
    const svc = makeService()
    svc._fetchChannel = async () => { throw new Error('HTTP 500') }
    const res = await svc._collectBoostChannel(source, Date.now())
    expect(res.items).toBeNull()
    expect(res.error).toContain('HTTP 500')
  })
})

describe('新增 AI 分类的补拉供给（调研 B4：ai chip 补拉不得静默无反应）', () => {
  it('CATEGORY_BOOSTS.ai 存在且 sources 非空，boostCategory 为 ai', () => {
    expect(CATEGORY_BOOSTS.ai).toBeDefined()
    expect(CATEGORY_BOOSTS.ai.threshold).toBeGreaterThan(0)
    expect(CATEGORY_BOOSTS.ai.sources.length).toBeGreaterThanOrEqual(1)
    for (const s of CATEGORY_BOOSTS.ai.sources) {
      expect(s.boostCategory).toBe('ai')
      expect(s.board).toBe('ai')
    }
  })

  it('onlyCategory 用分类器筛条目：AI 题保留、非 AI 题剔除', async () => {
    const svc = makeService()
    const src = CATEGORY_BOOSTS.ai.sources[0]
    // IT之家 RSS 夹具：两条 AI 题 + 一条非 AI 题
    const xml = [
      '<item><title><![CDATA[国产大模型发布新版本 算力需求翻倍]]></title><link>https://www.ithome.com/a1</link></item>',
      '<item><title><![CDATA[某地暴雨橙色预警 多条道路积水]]></title><link>https://www.ithome.com/a2</link></item>',
      '<item><title><![CDATA[AI 智能体产品开放公测]]></title><link>https://www.ithome.com/a3</link></item>',
    ].join('')
    svc._fetchChannel = async () => xml
    const res = await svc._collectBoostChannel(src, Date.now())
    const topics = res.items.map((x) => x.topic)
    expect(topics).toHaveLength(2)
    expect(topics.some((t) => t.includes('大模型'))).toBe(true)
    expect(topics.some((t) => t.includes('智能体'))).toBe(true)
    // 非 AI 条目被 onlyCategory 剔除
    expect(topics.some((t) => t.includes('暴雨'))).toBe(false)
    // 命中条目主分类为 ai
    expect(res.items.every((x) => x.category === 'ai')).toBe(true)
    // id 带 board=ai 段，与主榜及 tech 补拉不撞号
    expect(res.items.every((x) => x.id.startsWith('ithome_tech:ai:'))).toBe(true)
  })
})
