/**
 * quick-collect-cn-sources — S1 跨模块行为锁：中文榜单源接入快捷采集
 *
 * 这一份测的不是单个函数的形状，而是**接起来之后仍然成立**的四件事：
 *   ① 榜单素材没有发布时间 ⇒ 用 `observedAt` 走窗口、素材与提示词都如实标注；
 *   ② 域名判据只对 trend 源生效（search 源的条目本来就外链到第三方站点）；
 *   ③ search / trend 两分支分流且**旧指令行为不变**（trendFn 不被调用）；
 *   ④ trendFn 缺席或抛错时**降级不中断**，并把失败归因到 `sourceStats`。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'

beforeAll(() => { __enableElectronMock() })

const NOW = Date.parse('2026-10-11T04:00:00.000Z')
const hoursAgo = (h) => Math.floor((NOW - h * 3600 * 1000) / 1000)

async function materialsMod () { return import('../services/quick-collect-materials') }
async function promptMod () { return import('../services/quick-collect-prompt') }
async function engineMod () { return import('../services/quick-collect-engine') }
async function presetsMod () { return import('../services/quick-collect-presets') }
async function sourcesMod () { return import('../services/quick-collect-sources') }

/** 榜单源素材（来自微博热搜第 3 名，无发布时间，只有抓取时刻） */
function trendItem (over = {}) {
  return {
    url: 'https://s.weibo.com/weibo?q=test',
    urlKind: 'item',
    title: '某条热搜',
    source: 'weibo',
    sourceType: 'hottest',
    timeKind: 'observed',
    observedAt: hoursAgo(1),
    rank: 3,
    hotValue: 1200000,
    engagement: 1200000,
    ...over,
  }
}

const COMMAND = {
  id: 'qc-trend-1',
  title: '热点选题雷达',
  prompt: '请检索最近 48 小时内技术圈在热议什么，输出 5 条可写选题。',
  keywords: [],
  windowHours: 48,
  sources: ['weibo', 'zhihu'],
  builtin: false,
}

describe('S1/素材：榜单类素材的时间语义', () => {
  it('observed 素材按抓取时刻通过窗口，并带 rank/timeKind', async () => {
    const { normalizeMaterial } = await materialsMod()
    const r = normalizeMaterial(trendItem(), { windowHours: 48, now: NOW })
    expect(r.ok).toBe(true)
    expect(r.material.timeKind).toBe('observed')
    expect(r.material.observedAt).toBe(hoursAgo(1))
    expect(r.material.rank).toBe(3)
    expect(r.material.sourceType).toBe('hottest')
    expect(r.material.createdUtc).toBe(null)
  })

  it('observed 缺 observedAt → missing_time；超窗 → out_of_window；未来 → future_time', async () => {
    const { normalizeMaterial } = await materialsMod()
    expect(normalizeMaterial(trendItem({ observedAt: undefined }), { windowHours: 48, now: NOW }).reason).toBe('missing_time')
    expect(normalizeMaterial(trendItem({ observedAt: hoursAgo(49) }), { windowHours: 48, now: NOW }).reason).toBe('out_of_window')
    expect(normalizeMaterial(trendItem({ observedAt: Math.floor(NOW / 1000) + 3 * 86400 }), { windowHours: 48, now: NOW }).reason).toBe('future_time')
  })

  it('published 素材继续用 created_utc（snake_case，防回归：content-intelligence 的字段名）', async () => {
    const { normalizeMaterial } = await materialsMod()
    const r = normalizeMaterial({ url: 'https://example.com/a', title: 't', source: 'hackernews', created_utc: hoursAgo(2) }, { windowHours: 48, now: NOW })
    expect(r.ok).toBe(true)
    expect(r.material.timeKind).toBe('published')
    expect(r.material.createdUtc).toBe(hoursAgo(2))
  })
})

describe('S1/素材：域名判据只对 trend 源生效', () => {
  it('榜单源条目 host 不属于该源 → domain_mismatch', async () => {
    const { mergeMaterials } = await materialsMod()
    const out = mergeMaterials([trendItem({ url: 'https://example.com/x' })], { windowHours: 48, now: NOW })
    expect(out.materials).toHaveLength(0)
    expect(out.dropped.domain_mismatch).toBe(1)
  })

  it('榜单源子域通过；search 源外链第三方站点仍保留', async () => {
    const { mergeMaterials } = await materialsMod()
    const trend = mergeMaterials([trendItem({ url: 'https://s.weibo.com/a' })], { windowHours: 48, now: NOW })
    expect(trend.materials).toHaveLength(1)
    const search = mergeMaterials(
      [{ url: 'https://some-blog.dev/post', title: 'HN 外链', source: 'hackernews', created_utc: hoursAgo(1) }],
      { windowHours: 48, now: NOW },
    )
    expect(search.materials).toHaveLength(1)
    expect(search.dropped.domain_mismatch).toBeUndefined()
  })
})

describe('S1/提示词：时间语义与来源可归因', () => {
  it('system 含两条新硬约束（不得把抓取时刻写成发布时间）', async () => {
    const { SYSTEM_PROMPT } = await promptMod()
    expect(SYSTEM_PROMPT).toContain('榜单类素材（热搜/热榜/热门）**没有发布时间**')
    expect(SYSTEM_PROMPT).toContain('来源标签必须原样引用')
  })

  it('observed 行写「抓取时刻」且带名次；published 行写「发布」；board 链接写「来源页面」', async () => {
    const { formatMaterialLine } = await promptMod()
    const observedLine = formatMaterialLine({
      url: 'https://s.weibo.com/a', urlKind: 'item', title: '热搜条目', source: 'weibo',
      sourceType: 'hottest', timeKind: 'observed', observedAt: hoursAgo(1), rank: 3, hotValue: 1200, engagement: 1200,
    }, 0)
    expect(observedLine).toContain('来源=微博热搜#3')
    expect(observedLine).toContain('抓取时刻=')
    expect(observedLine).not.toContain('发布=')

    const publishedLine = formatMaterialLine({
      url: 'https://example.com/a', title: 'RSS 条目', source: 'hackernews',
      timeKind: 'published', createdUtc: hoursAgo(2), engagement: 5,
    }, 1)
    expect(publishedLine).toContain('发布=')
    expect(publishedLine).not.toContain('抓取时刻=')

    const boardLine = formatMaterialLine({
      url: 'https://www.douyin.com/hot', urlKind: 'board', title: '抖音热榜条目', source: 'douyin',
      sourceType: 'hottest', timeKind: 'observed', observedAt: hoursAgo(1), rank: 7, hotValue: null,
    }, 2)
    expect(boardLine).toContain('来源页面=https://www.douyin.com/hot')
    expect(boardLine).not.toContain('链接=https://www.douyin.com/hot')
  })
})

describe('S1/引擎：search 与 trend 分流', () => {
  it('纯榜单指令：trendFn 被调用一次、searchFn 不被调用、retrieval=ok 且元数据带 trendSources', async () => {
    const { createQuickCollectEngine } = await engineMod()
    const searchFn = vi.fn()
    const trendFn = vi.fn(async () => ({
      items: [trendItem(), trendItem({ url: 'https://www.zhihu.com/question/1', source: 'zhihu' })],
      sourceStats: { weibo: 'ok', zhihu: 'ok' },
    }))
    const llmFn = vi.fn(async () => ({ content: '## 选题\n1. 某事件' }))
    const engine = createQuickCollectEngine({ searchFn, trendFn, llmFn, log: { warn: () => {} }, now: () => NOW })
    const res = await engine.run({ ...COMMAND })
    expect(res.code).toBe(0)
    expect(searchFn).not.toHaveBeenCalled()
    expect(trendFn).toHaveBeenCalledTimes(1)
    expect(trendFn.mock.calls[0][0]).toEqual(['weibo', 'zhihu'])
    expect(res.data.quickCollect.retrieval).toBe('ok')
    expect(res.data.quickCollect.trendSources).toEqual(['weibo', 'zhihu'])
    expect(res.data.quickCollect.trendSourceCount).toBe(2)
    expect(res.data.quickCollect.timeKinds).toEqual(['observed'])
    expect(res.data.quickCollect.sourceStats).toEqual({ weibo: 'ok', zhihu: 'ok' })
  })

  it('旧指令（只含英文 search 源）行为不变：trendFn 一次都不调用', async () => {
    const { createQuickCollectEngine } = await engineMod()
    const searchFn = vi.fn(async () => ({ results: [{ url: 'https://example.com/a', title: 't', source: 'hackernews', created_utc: hoursAgo(1) }] }))
    const trendFn = vi.fn()
    const engine = createQuickCollectEngine({
      searchFn, trendFn, llmFn: async () => ({ content: '正文' }), log: { warn: () => {} }, now: () => NOW,
    })
    const res = await engine.run({ ...COMMAND, keywords: ['LLM release'], sources: ['reddit', 'hackernews', 'github'] })
    expect(res.code).toBe(0)
    expect(trendFn).not.toHaveBeenCalled()
    expect(searchFn).toHaveBeenCalledTimes(1)
    expect(res.data.quickCollect.trendSources).toEqual([])
    expect(res.data.quickCollect.trendSourceCount).toBe(0)
    expect(res.data.quickCollect.timeKinds).toEqual(['published'])
  })

  it('trendFn 缺席 → 降级不中断（无素材、正文带声明行）', async () => {
    const { createQuickCollectEngine } = await engineMod()
    const engine = createQuickCollectEngine({ llmFn: async () => ({ content: '模型正文' }), log: { warn: () => {} }, now: () => NOW })
    const res = await engine.run({ ...COMMAND })
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.trendSkipped).toBe(true)
    expect(res.data.quickCollect.sourceStats).toEqual({ weibo: 'skipped', zhihu: 'skipped' })
    expect(res.data.content).toContain('未检索到')
  })

  it('单个趋势源失败但有素材 → retrieval=partial 且失败源被点名', async () => {
    const { createQuickCollectEngine } = await engineMod()
    const trendFn = vi.fn(async () => ({ items: [trendItem()], sourceStats: { weibo: 'ok', zhihu: 'failed' } }))
    const engine = createQuickCollectEngine({ trendFn, llmFn: async () => ({ content: '正文' }), log: { warn: () => {} }, now: () => NOW })
    const res = await engine.run({ ...COMMAND })
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.retrieval).toBe('partial')
    expect(res.data.quickCollect.sourceStats.zhihu).toBe('failed')
  })

  it('trendFn 抛错 → 不中断，全部失败源归因 failed', async () => {
    const { createQuickCollectEngine } = await engineMod()
    const trendFn = vi.fn(async () => { throw new Error('network down') })
    const engine = createQuickCollectEngine({ trendFn, llmFn: async () => ({ content: '正文' }), log: { warn: () => {} }, now: () => NOW })
    const res = await engine.run({ ...COMMAND })
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.sourceStats).toEqual({ weibo: 'failed', zhihu: 'failed' })
    expect(res.data.quickCollect.retrieval).toBe('empty')
  })
})

describe('S1/内置词条：源必须是闭集子集', () => {
  it('所有内置词的 sources 都属闭集，且热点词条吃到中文榜单源', async () => {
    const { PRESET_COMMANDS } = await presetsMod()
    const { ALL_SOURCE_IDS } = await sourcesMod()
    for (const c of PRESET_COMMANDS) {
      for (const s of c.sources) expect(ALL_SOURCE_IDS, c.id + ':' + s).toContain(s)
    }
    const hot = PRESET_COMMANDS.find((c) => c.id === 'builtin-hot-topics')
    expect(hot.sources).toContain('weibo')
    expect(hot.sources).toContain('douyin')
    const howto = PRESET_COMMANDS.find((c) => c.id === 'builtin-ai-howto')
    expect(howto.sources).toContain('github')
    // AI 领域动向的提示词仍然逐字不动（用户需求原文）
    const ai = PRESET_COMMANDS.find((c) => c.id === 'builtin-ai-trends')
    expect(ai.prompt).toContain("请检索过去48小时内AI与新技术领域的真实动态")
  })
})

describe('S1/IPC：hotTopicsService → 统一素材的映射', () => {
  /** 可信来源事件（与既有 IPC 合同测试同口径：开发态 localhost:5174） */
  const TRUSTED_EVENT = { sender: { id: 1 }, senderFrame: { url: 'http://localhost:5174/' } }

  function makeIpcMain () {
    const handlers = {}
    return { handlers, handle: (channel, fn) => { handlers[channel] = fn } }
  }

  function baseDeps (over = {}) {
    const win = { webContents: { send: vi.fn() }, isDestroyed: () => false }
    return {
      BrowserWindow: { fromWebContents: () => win },
      aiGenerator: { generateWithDefault: vi.fn(async () => ({ content: '生成的正文' })) },
      log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      // 走 IPC 的用例必须自己钉时钟：本文件的条目时间戳是绝对的（NOW / 固定 pubDate），
      // 而引擎缺省回落真实 Date.now() ⇒ 不注入就是一根 windowHours 长的引信
      // （实测 2026-10-13T04:00Z 起 3 条用例同时红）。
      now: () => NOW,
      ...over,
    }
  }

  async function runOnce (deps, command = COMMAND) {
    const { default: registerHandlers } = await import('../ipc-handlers/quick-collect')
    const ipc = makeIpcMain()
    registerHandlers(ipc, deps)
    return ipc.handlers['quick-collect:run'](TRUSTED_EVENT, { command: { ...command } })
  }

  it('注入热榜服务：榜单条目映射为 observed 素材（抖音无链接 → 源主页 + 「来源页面」）', async () => {
    const hotTopicsService = {
      fetchTopics: vi.fn(async () => ({
        fetchedAt: NOW,
        channelStats: { weibo: { items: [] }, douyin: { items: [] }, zhihu: { items: [] } },
        topics: [
          { channel: 'weibo', topic: '微博热搜条目', rank: 2, hotValue: 999, url: 'https://s.weibo.com/weibo?q=x', fetchedAt: NOW },
          { channel: 'douyin', topic: '抖音热点条目', rank: 5, hotValue: 888, url: null, fetchedAt: NOW },
          { channel: 'zhihu', topic: '未被请求的源不得进素材', rank: 1, hotValue: 5000, url: 'https://www.zhihu.com/question/1', fetchedAt: NOW },
        ],
      })),
    }
    const deps = baseDeps({ hotTopicsService })
    const res = await runOnce(deps, { ...COMMAND, sources: ['weibo', 'douyin'] })
    expect(res.code).toBe(0)
    expect(hotTopicsService.fetchTopics).toHaveBeenCalledTimes(1)
    expect(res.data.quickCollect.trendSourceCount).toBe(2)
    expect(res.data.quickCollect.timeKinds).toEqual(['observed'])
    expect(res.data.quickCollect.sourceStats).toEqual({ weibo: 'ok', douyin: 'ok' })
    // 未请求的 zhihu 不得进素材；抖音条目用源主页兜底（不伪造条目链接）
    const user = deps.aiGenerator.generateWithDefault.mock.calls[0][1].messages[1].content
    expect(user).toContain('微博热搜#2')
    expect(user).toContain('抓取时刻=')
    expect(user).toContain('来源页面=https://www.douyin.com/hot')
    expect(user).toContain('抖音热点条目')
    expect(user).not.toContain('未被请求的源不得进素材')
    expect(res.data.sourceUrl).toContain('weibo.com')
  })

  it('S1 补遗：垂类信道（sina_finance）能进素材，时间语义与主榜一致（observed）', async () => {
    const hotTopicsService = {
      fetchTopics: vi.fn(async () => ({
        fetchedAt: NOW,
        channelStats: { sina_finance: { items: [] } },
        topics: [
          { channel: 'sina_finance', topic: '财经垂类条目', rank: 7, hotValue: null, url: 'https://finance.sina.com.cn/x', fetchedAt: NOW },
        ],
      })),
    }
    const deps = baseDeps({ hotTopicsService })
    const res = await runOnce(deps, { ...COMMAND, sources: ['sina_finance'] })
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.sourceStats).toEqual({ sina_finance: 'ok' })
    expect(res.data.quickCollect.timeKinds).toEqual(['observed'])
    const user = deps.aiGenerator.generateWithDefault.mock.calls[0][1].messages[1].content
    expect(user).toContain('新浪财经滚动#7')
    expect(user).toContain('抓取时刻=')
    expect(user).not.toContain('发布=')
  })

  it('未注入热榜服务 → 不报错（该源归因 skipped，模型仍被调用）', async () => {
    const res = await runOnce(baseDeps())
    expect(res.code).toBe(0)
    // S2 起 trendFn 恒存在（feed provider 可在无热榜服务时工作），因此不再是"整体跳过"，
    // 而是**逐源归因**：未接线的那两个源 skipped、attempted 仍然记上 ⇒ retrieval=empty。
    expect(res.data.quickCollect.sourceStats).toEqual({ weibo: 'skipped', zhihu: 'skipped' })
    expect(res.data.quickCollect.retrieval).toBe('empty')
    expect(res.data.content).toBeTruthy()
  })

  it('S2：注入 fetchFn 后 feed 源（solidot）能进素材，时间语义为 published', async () => {
    const rss = '<?xml version="1.0"?><rss><channel>'
      + '<item><title>Solidot 条目</title><link>https://www.solidot.org/story?sid=9</link><pubDate>Sun, 11 Oct 2026 02:00:00 +0000</pubDate></item>'
      + '</channel></rss>'
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(rss).buffer,
    }))
    const deps = baseDeps({ fetchFn })
    const res = await runOnce(deps, { ...COMMAND, sources: ['solidot'] })
    expect(res.code).toBe(0)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(res.data.quickCollect.trendSourceCount).toBe(1)
    expect(res.data.quickCollect.timeKinds).toEqual(['published'])
    expect(res.data.quickCollect.sourceStats).toEqual({ solidot: 'ok' })
    const user = deps.aiGenerator.generateWithDefault.mock.calls[0][1].messages[1].content
    expect(user).toContain('来源=Solidot')
    expect(user).toContain('发布=')
    expect(user).not.toContain('抓取时刻=')
  })
})

describe('S2/引擎与内置词条', () => {
  it('计划性空榜（arXiv 周末）随元数据回传，与失败源分开', async () => {
    const { createQuickCollectEngine } = await engineMod()
    const trendFn = vi.fn(async () => ({ items: [], sourceStats: { arxiv_cs_ai: 'ok' }, emptyBySchedule: ['arxiv_cs_ai'] }))
    const engine = createQuickCollectEngine({ trendFn, llmFn: async () => ({ content: '正文' }), log: { warn: () => {} }, now: () => NOW })
    const res = await engine.run({ ...COMMAND, sources: ['arxiv_cs_ai'] })
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.emptyBySchedule).toEqual(['arxiv_cs_ai'])
    expect(res.data.quickCollect.sourceStats.arxiv_cs_ai).toBe('ok')
    expect(res.data.quickCollect.retrieval).toBe('empty')
  })

  it('builtin-ai-trends 增补了 AI/技术时间线源，但提示词仍逐字不动', async () => {
    const { PRESET_COMMANDS } = await presetsMod()
    const ai = PRESET_COMMANDS.find((c) => c.id === 'builtin-ai-trends')
    expect(ai.sources).toContain('arxiv_cs_ai')
    expect(ai.sources).toContain('hf_papers')
    expect(ai.sources).toContain('qbitai')
    expect(ai.sources).toContain('github')
    expect(ai.prompt).toContain('请检索过去48小时内AI与新技术领域的真实动态')
    expect(ai.prompt).toContain('不要编造，找不到可靠信息就如实说')
  })
})
