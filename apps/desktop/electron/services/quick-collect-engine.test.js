/**
 * quick-collect-engine — 编排（依赖注入，零出网）
 *
 * 覆盖六类现场：成功 / 无素材 / 无关键词 / 检索失败 / 模型未配置 / 模型异常 / 空输出，
 * 以及进度序列、参数透传、正文截断与校验前置（校验不通过时一次外呼都不许发生）。
 */
import { describe, it, expect, vi } from 'vitest'

const NOW = Date.parse('2026-10-11T04:00:00.000Z')
const hoursAgo = (h) => Math.floor((NOW - h * 3600 * 1000) / 1000)

const COMMAND = {
  id: 'builtin-ai-trends',
  title: 'AI 领域动向',
  prompt: '请检索过去48小时内AI与新技术领域的真实动态，输出 3 条建议关注。',
  keywords: ['LLM release', 'AI model'],
  windowHours: 48,
  sources: ['reddit', 'hackernews'],
  builtin: true,
}

function material (over = {}) {
  return {
    url: 'https://example.com/a',
    title: '素材 A',
    source: 'hackernews',
    snippet: '摘要',
    engagement: 1,
    created_utc: hoursAgo(2),
    ...over,
  }
}

async function engineWith (deps) {
  const { createQuickCollectEngine } = await import('../services/quick-collect-engine')
  return createQuickCollectEngine({ now: () => NOW, ...deps })
}

describe('quick-collect-engine/成功路径', () => {
  it('检索 → 生成 → 归一为采集条目，并带上溯源字段', async () => {
    const searchFn = vi.fn(async () => ({ results: [material({ url: 'https://example.com/low', engagement: 1 }), material({ url: 'https://example.com/high', engagement: 9 })] }))
    const llmFn = vi.fn(async () => '## 建议关注\n1. 某事件')
    const engine = await engineWith({ searchFn, llmFn })
    const progress = []
    const res = await engine.run(COMMAND, { onProgress: (p) => progress.push(p.stage) })

    expect(res.code).toBe(0)
    expect(res.data.title).toBe('AI 领域动向 · 2026-10-11')
    expect(res.data.content).toBe('## 建议关注\n1. 某事件')
    expect(res.data.source).toBe('AI 领域动向')
    expect(res.data.sourceUrl).toBe('https://example.com/high')
    expect(res.data.wordCount).toBe(res.data.content.length)
    expect(res.data.id).toMatch(/^qc-item-/)
    expect(res.data.quickCollect).toMatchObject({
      commandId: 'builtin-ai-trends',
      commandTitle: 'AI 领域动向',
      builtin: true,
      windowHours: 48,
      sources: ['reddit', 'hackernews'],
      materialCount: 2,
      retrieval: 'ok',
      generatedAt: '2026-10-11T04:00:00.000Z',
    })
    expect(progress).toEqual(['retrieving', 'summarizing', 'done'])
  })

  it('检索参数与提示词透传正确（noCache / relevanceOn / 指令逐字 / 素材链接）', async () => {
    const searchFn = vi.fn(async () => ({ results: [material({ url: 'https://example.com/a' })] }))
    const llmFn = vi.fn(async () => '正文')
    const engine = await engineWith({ searchFn, llmFn })
    await engine.run(COMMAND, {})

    expect(searchFn).toHaveBeenCalledTimes(2)
    const [query, opts] = searchFn.mock.calls[0]
    expect(query).toBe('LLM release')
    expect(opts).toMatchObject({ sources: ['reddit', 'hackernews'], limit: 8, noCache: true, relevanceOn: ['title', 'snippet'] })

    const arg = llmFn.mock.calls[0][0]
    expect(arg.messages[1].content).toContain(COMMAND.prompt)
    expect(arg.messages[1].content).toContain('链接=https://example.com/a')
    expect(arg.temperature).toBe(0.3)
    expect(arg.max_tokens).toBe(1600)
  })

  it('关键词超过 3 个时只检索前 3 个（不放大外呼）', async () => {
    const searchFn = vi.fn(async () => ({ results: [material()] }))
    const engine = await engineWith({ searchFn, llmFn: vi.fn(async () => '正文') })
    const res = await engine.run({ ...COMMAND, keywords: ['a', 'b', 'c', 'd', 'e'] }, {})
    expect(res.code).toBe(0)
    expect(searchFn).toHaveBeenCalledTimes(3)
    expect(searchFn.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
  })
})

describe('quick-collect-engine/无素材与未检索', () => {
  it('检索为空 → retrieval=empty，正文首行是引擎声明行', async () => {
    const searchFn = vi.fn(async () => ({ results: [] }))
    const engine = await engineWith({ searchFn, llmFn: vi.fn(async () => '我没有找到相关信息。') })
    const res = await engine.run(COMMAND, {})
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.retrieval).toBe('empty')
    expect(res.data.quickCollect.materialCount).toBe(0)
    expect(res.data.sourceUrl).toBe('')
    expect(res.data.content.startsWith('> 本次未检索到最近 48 小时内的可核对素材')).toBe(true)
    expect(res.data.content).toContain('我没有找到相关信息。')
  })

  it('模型已自述"未检索到"时不重复插入声明行', async () => {
    const engine = await engineWith({ searchFn: vi.fn(async () => ({ results: [] })), llmFn: vi.fn(async () => '本次未检索到任何可靠信息。') })
    const res = await engine.run(COMMAND, {})
    expect(res.data.content).toBe('本次未检索到任何可靠信息。')
  })

  it('无关键词 → retrieval=skipped，检索函数一次都不调用', async () => {
    const searchFn = vi.fn(async () => ({ results: [material()] }))
    const engine = await engineWith({ searchFn, llmFn: vi.fn(async () => '正文') })
    const res = await engine.run({ ...COMMAND, keywords: [] }, {})
    expect(res.code).toBe(0)
    expect(searchFn).not.toHaveBeenCalled()
    expect(res.data.quickCollect.retrieval).toBe('skipped')
    expect(res.data.content.startsWith('> 本指令未配置检索关键词')).toBe(true)
  })

  it('单个关键词检索抛错 → 另一个仍参与，retrieval=partial（且不因异常中断）', async () => {
    const searchFn = vi.fn(async (q) => {
      if (q === 'LLM release') throw new Error('ETIMEDOUT')
      return { results: [material()] }
    })
    const engine = await engineWith({ searchFn, llmFn: vi.fn(async () => '正文') })
    const res = await engine.run(COMMAND, {})
    expect(res.code).toBe(0)
    expect(res.data.quickCollect.retrieval).toBe('partial')
    expect(res.data.quickCollect.materialCount).toBe(1)
  })
})

describe('quick-collect-engine/错误码', () => {
  it('非法指令 → -2 且一次外呼都不发生', async () => {
    const searchFn = vi.fn()
    const llmFn = vi.fn()
    const engine = await engineWith({ searchFn, llmFn })
    const res = await engine.run({ ...COMMAND, title: 'x'.repeat(41) }, {})
    expect(res).toEqual({ code: -2, message: 'QC_TITLE_TOO_LONG' })
    expect(searchFn).not.toHaveBeenCalled()
    expect(llmFn).not.toHaveBeenCalled()
  })

  it('模型未配置（llmFn 缺席）→ -101', async () => {
    const engine = await engineWith({ searchFn: vi.fn(async () => ({ results: [material()] })) })
    const res = await engine.run(COMMAND, {})
    expect(res).toEqual({ code: -101, message: 'QC_LLM_NOT_CONFIGURED' })
  })

  it('模型抛"未配置默认 provider" → -101（按文案归类）', async () => {
    const engine = await engineWith({
      searchFn: vi.fn(async () => ({ results: [material()] })),
      llmFn: vi.fn(async () => { throw new Error('No configured default provider available for type: llm') }),
    })
    expect((await engine.run(COMMAND, {})).code).toBe(-101)
  })

  it('模型抛显式标注 → -101；其它错误 → -102 且 message 透传', async () => {
    const tagged = new Error('whatever')
    tagged.quickCollectCode = 'QC_LLM_NOT_CONFIGURED'
    const engine1 = await engineWith({ searchFn: vi.fn(async () => ({ results: [material()] })), llmFn: vi.fn(async () => { throw tagged }) })
    expect((await engine1.run(COMMAND, {})).code).toBe(-101)

    const engine2 = await engineWith({ searchFn: vi.fn(async () => ({ results: [material()] })), llmFn: vi.fn(async () => { throw new Error('429 too many requests') }) })
    const res2 = await engine2.run(COMMAND, {})
    expect(res2.code).toBe(-102)
    expect(res2.message).toBe('429 too many requests')
  })

  it('模型返回空串或非字符串 → -103（不落空条目）', async () => {
    for (const ret of ['', '   ', null, 42, { content: '' }]) {
      const engine = await engineWith({ searchFn: vi.fn(async () => ({ results: [material()] })), llmFn: vi.fn(async () => ret) })
      const res = await engine.run(COMMAND, {})
      expect(res.code, JSON.stringify(ret)).toBe(-103)
      expect(res.data).toBeUndefined()
    }
  })

  it('兼容 { content } 形状（AIGenerator.generateWithDefault 的返回）', async () => {
    const engine = await engineWith({ searchFn: vi.fn(async () => ({ results: [material()] })), llmFn: vi.fn(async () => ({ content: '对象里的正文' })) })
    const res = await engine.run(COMMAND, {})
    expect(res.code).toBe(0)
    expect(res.data.content).toBe('对象里的正文')
  })
})

describe('quick-collect-engine/边界与健壮性', () => {
  it('超长正文截断到 CONTENT_MAX', async () => {
    const { CONTENT_MAX } = await import('../services/quick-collect-engine')
    const engine = await engineWith({ searchFn: vi.fn(async () => ({ results: [material()] })), llmFn: vi.fn(async () => 'x'.repeat(CONTENT_MAX + 500)) })
    const res = await engine.run(COMMAND, {})
    expect(res.data.content.length).toBe(CONTENT_MAX)
  })

  it('进度回调抛错不影响主流程', async () => {
    const engine = await engineWith({ searchFn: vi.fn(async () => ({ results: [material()] })), llmFn: vi.fn(async () => '正文') })
    const res = await engine.run(COMMAND, { onProgress: () => { throw new Error('boom') } })
    expect(res.code).toBe(0)
  })

  it('非法 url 素材被丢弃，sourceUrl 不取到它（AC-8）', async () => {
    const engine = await engineWith({
      searchFn: vi.fn(async () => ({ results: [material({ url: 'javascript:alert(1)', engagement: 99 }), material({ url: 'https://example.com/ok', engagement: 1 })] })),
      llmFn: vi.fn(async () => '正文'),
    })
    const res = await engine.run(COMMAND, {})
    expect(res.data.sourceUrl).toBe('https://example.com/ok')
    expect(res.data.quickCollect.materialCount).toBe(1)
    expect(res.data.quickCollect.droppedMaterials).toBe(1)
  })

  it('窗口外的素材不参与（AC-9）', async () => {
    const engine = await engineWith({
      searchFn: vi.fn(async () => ({ results: [material({ url: 'https://example.com/old', created_utc: hoursAgo(72), engagement: 50 })] })),
      llmFn: vi.fn(async () => '正文'),
    })
    const res = await engine.run(COMMAND, {})
    expect(res.data.quickCollect.retrieval).toBe('empty')
    expect(res.data.quickCollect.materialCount).toBe(0)
  })
})

describe('quick-collect-engine/classifyLlmFailure', () => {
  it('优先显式标注，其次文案，其余按调用失败（fail closed）', async () => {
    const { classifyLlmFailure } = await import('../services/quick-collect-engine')
    const tagged = new Error('x')
    tagged.quickCollectCode = 'QC_LLM_NOT_CONFIGURED'
    expect(classifyLlmFailure(tagged)).toBe('QC_LLM_NOT_CONFIGURED')
    expect(classifyLlmFailure(new Error('Model provider manager not available'))).toBe('QC_LLM_NOT_CONFIGURED')
    expect(classifyLlmFailure(new Error('socket hang up'))).toBe('QC_LLM_FAILED')
    expect(classifyLlmFailure(null)).toBe('QC_LLM_FAILED')
  })
})
