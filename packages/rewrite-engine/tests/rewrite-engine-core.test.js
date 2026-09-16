/**
 * RewriteEngine core regression tests
 *
 * Regression coverage:
 * - P1: rewrite() must include quality field (historical TDZ bug)
 * - P2: knowledge-base persistence failure must not block main flow
 * - P3: evaluateAsync preferred -> evaluate fallback
 */
var { RewriteEngine } = require('../src/rewrite-engine-core')
var { KnowledgeBase } = require('../src/knowledge-base')

describe('RewriteEngine', function () {
  function sampleStrategy() {
    return {
      id: 'test-imitate-v1',
      name: 'test-rewrite',
      category: 'imitate',
      systemPrompt: 'professional rewrite assistant.',
      userPromptTemplate: 'rewrite: {content}',
      industry: ['generic'],
      tone: ['casual'],
      platforms: ['generic'],
      postProcess: { removeAITaste: false, maxLength: 6000 }
    }
  }
  function mockLlmClient(t) { return { chat: async function () { return t } } }
  function wireStrategy(engine) {
    engine._strategyManager._strategies = [sampleStrategy()]
    engine._strategyManager.listEnabled = function () { return [sampleStrategy()] }
    engine._strategyManager.get = function () { return sampleStrategy() }
    engine._strategyManager.clearRemote = function () {}
    engine._strategyManager.mergeRemote = function () {}
  }

  test('P1 rewrite() returns quality field', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('rewritten content completely different'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: 'this is original article content long enough to pass validation', userSettings: { industry: 'ecommerce', tone: 'casual' } })
    expect(result.success).toBe(true)
    expect(result.quality).not.toBeUndefined()
    expect(result.quality).toHaveProperty('sufficiency')
    expect(result.quality).toHaveProperty('semanticPreservation')
    expect(result.quality).toHaveProperty('originality')
    expect(result.quality).toHaveProperty('verdict')
    expect(result.quality).toHaveProperty('method')
  })

  test('P2 rewrite() returns normally when KB persistence fails', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('rewritten content different from original'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    engine._knowledgeBase.recordFeedback = function () { throw new Error('DB write failure') }
    var result = await engine.rewrite({ mode: 'imitate', content: 'test original text long enough to pass validation', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.quality).not.toBeUndefined()
    expect(result.quality.verdict).toBeDefined()
  })

  test('P3a evaluateAsync preferred (embedding path)', async function () {
    var a = false, b = false
    var ev = {
      evaluateAsync: async function () { a = true; return { method: 'embedding', verdict: 'pass' } },
      evaluate: function () { b = true; return { method: 'simhash', verdict: 'pass' } }
    }
    var engine = new RewriteEngine({ llmClient: mockLlmClient('rewritten'), qualityEvaluator: ev, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: 'test original text long enough', userSettings: {} })
    expect(result.success).toBe(true)
    expect(a).toBe(true)
    expect(b).toBe(false)
    expect(result.quality.method).toBe('embedding')
  })

  test('P3b evaluateAsync failure falls back to evaluate', async function () {
    var b = false
    var ev = {
      evaluateAsync: async function () { throw new Error('Embedding unavailable') },
      evaluate: function () { b = true; return { method: 'simhash', verdict: 'pass' } }
    }
    var engine = new RewriteEngine({ llmClient: mockLlmClient('rewritten'), qualityEvaluator: ev, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: 'test original text long enough', userSettings: {} })
    expect(result.success).toBe(true)
    expect(b).toBe(true)
    expect(result.quality.method).toBe('simhash')
  })

  // ── 字数区间控制（2026-09-12）：移除 20 字下限 + wordCountRange + 2500 默认输出上限 ──

  test('W1 短内容（<20 字）不再被拒绝', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('改写结果'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '短文案', userSettings: {} })
    expect(result.success).toBe(true)
  })

  test('W2 空内容仍被拒绝（EMPTY_CONTENT）', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('x'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '   ', userSettings: {} })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('EMPTY_CONTENT')
  })

  test('W3 超长内容仍被拒绝（TOO_LONG, >6000）', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('x'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: 'a'.repeat(6001), userSettings: {} })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('TOO_LONG')
  })

  test('W4 wordCountRange 注入 prompt 字数区间指令', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = { sys, user }; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 800, max: 2000 } } })
    expect(captured.sys).toContain('800')
    expect(captured.sys).toContain('2000')
    expect(captured.sys).toContain('字数要求')
  })

  test('W5 无字数控制时 postProcess 默认上限 3000', async function () {
    var longText = 'x'.repeat(3500)
    var strategy = sampleStrategy()
    strategy.postProcess = { removeAITaste: false }
    var engine = new RewriteEngine({ llmClient: mockLlmClient(longText), knowledgeBase: new KnowledgeBase() })
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.result.length).toBeLessThanOrEqual(3000)
  })

  test('W6 wordCountRange.max 覆盖 postProcess 上限', async function () {
    var longText = 'x'.repeat(3000)
    var strategy = sampleStrategy()
    strategy.postProcess = { removeAITaste: false }
    var engine = new RewriteEngine({ llmClient: mockLlmClient(longText), knowledgeBase: new KnowledgeBase() })
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 100, max: 2000 } } })
    expect(result.result.length).toBeLessThanOrEqual(2000)
  })

  test('W7 截断按 Unicode 码点计数（emoji 不被切断）', async function () {
    // 3 个 emoji（各占 2 个 UTF-16 单元）+ 4997 个 ASCII = 5000 码点 / 5003 UTF-16 单元
    var longText = '😀😀😀' + 'a'.repeat(4997)
    var strategy = sampleStrategy()
    strategy.postProcess = { removeAITaste: false }
    var engine = new RewriteEngine({ llmClient: mockLlmClient(longText), knowledgeBase: new KnowledgeBase() })
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 100, max: 2500 } } })
    // 码点截断后 ≤ 2500 码点，且不产生代理对被切断的乱码（无 U+FFFD/孤立高位代理）
    expect([...result.result].length).toBeLessThanOrEqual(2500)
    expect(result.result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  test('W8 无效字数区间（负数/越界/max<min）不注入 prompt', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = { sys, user }; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: -5, max: 3000 } } })
    expect(captured.sys).not.toContain('字数要求')
    await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 100, max: 9999 } } })
    expect(captured.sys).not.toContain('字数要求')
    await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 2000, max: 100 } } })
    expect(captured.sys).not.toContain('字数要求')
  })
})


// ── V: 爆款集成（viral-rewrite-integration）──
// V1-V3: titleHint 参数注入 userPrompt（来自爆款文案生成的标题参考）
// V4-V6: viralScorer 注入 → result.viral（改写前后爆款潜力对比，第 4 评估维度）
describe('RewriteEngine viral integration', function () {
  function sampleStrategy2() {
    return {
      id: 'viral-imitate-v1',
      name: 'viral-test-rewrite',
      category: 'imitate',
      systemPrompt: 'professional rewrite assistant.',
      userPromptTemplate: 'rewrite: {content}',
      industry: ['generic'],
      tone: ['casual'],
      platforms: ['generic'],
      postProcess: { removeAITaste: false, maxLength: 6000 }
    }
  }
  function wireStrategy2(engine) {
    var strategy = sampleStrategy2()
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    engine._strategyManager.clearRemote = function () {}
    engine._strategyManager.mergeRemote = function () {}
  }

  test('V1 titleHint 注入 userPrompt（空白折叠后完整出现）', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = user; return '结果内容' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy2(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始内容', titleHint: '  AI工具  10个技巧  \n', userSettings: {} })
    expect(result.success).toBe(true)
    expect(captured).toContain('AI工具 10个技巧')
    expect(captured).toContain('rewrite: 原始内容') // 模板正文不受影响
  })

  test('V2 titleHint 超过 200 字符被截断', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = user; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy2(engine)
    var longHint = 'x'.repeat(300)
    await engine.rewrite({ mode: 'imitate', content: '原始内容', titleHint: longHint, userSettings: {} })
    expect(captured).toContain('x'.repeat(200))
    expect(captured).not.toContain('x'.repeat(201))
  })

  test('V3 titleHint 非字符串/空白被忽略', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = user; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy2(engine)
    await engine.rewrite({ mode: 'imitate', content: '原始内容', titleHint: 42, userSettings: {} })
    await engine.rewrite({ mode: 'imitate', content: '原始内容', titleHint: '   ', userSettings: {} })
    await engine.rewrite({ mode: 'imitate', content: '原始内容', titleHint: null, userSettings: {} })
    expect(captured).not.toContain('titleHint')
    // 三次调用均无 hint 标记段
    expect(captured.split('##').length).toBeLessThanOrEqual(2)
  })

  test('V4 viralScorer 注入 → result.viral 含 original/rewritten/delta/mode', async function () {
    var calls = []
    var scorer = async function (text) {
      calls.push(text)
      return calls.length === 1 ? { score: 62.5, mode: 'local-fallback' } : { score: 78.34, mode: 'local-fallback' }
    }
    var engine = new RewriteEngine({ llmClient: { chat: async function () { return '改写后的内容' } }, viralScorer: scorer, knowledgeBase: new KnowledgeBase() })
    wireStrategy2(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始文章内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(calls).toEqual(['原始文章内容', '改写后的内容'])
    expect(result.viral).toBeDefined()
    expect(result.viral.original).toBe(62.5)
    expect(result.viral.rewritten).toBe(78.3)
    expect(result.viral.delta).toBe(15.8)
    expect(result.viral.mode).toBe('local-fallback')
    // 原有质量维度不受影响
    expect(result.quality).toBeDefined()
    expect(result.quality.verdict).toBeDefined()
  })

  test('V5 viralScorer 抛错不阻塞改写主流程（fail-open）', async function () {
    var scorer = async function () { throw new Error('scorer unavailable') }
    var engine = new RewriteEngine({ llmClient: { chat: async function () { return '改写结果' } }, viralScorer: scorer, knowledgeBase: new KnowledgeBase() })
    wireStrategy2(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.viral).toBeUndefined()
    expect(result.quality).toBeDefined()
  })

  test('V6 viralScorer 返回无效值（缺 score）不产生 result.viral', async function () {
    var scorer = async function () { return { mode: 'local-fallback' } }
    var engine = new RewriteEngine({ llmClient: { chat: async function () { return '改写结果' } }, viralScorer: scorer, knowledgeBase: new KnowledgeBase() })
    wireStrategy2(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.viral).toBeUndefined()
  })

  test('V7 未注入 viralScorer → 无 result.viral（回归保护）', async function () {
    var engine = new RewriteEngine({ llmClient: { chat: async function () { return '改写结果' } }, knowledgeBase: new KnowledgeBase() })
    wireStrategy2(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.viral).toBeUndefined()
  })
})

// 双模型评审 W-2：跨模式（orchestrator vs local-fallback）delta 量纲不可比 → fail-open 丢弃
describe('RewriteEngine viral integration (review fixes)', function () {
  function wireStrategy3(engine) {
    var strategy = {
      id: 'viral-fix-v1', name: 'viral-fix', category: 'imitate',
      systemPrompt: 'assistant.', userPromptTemplate: 'rewrite: {content}',
      industry: ['generic'], tone: ['casual'], platforms: ['generic'],
      postProcess: { removeAITaste: false, maxLength: 6000 }
    }
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    engine._strategyManager.clearRemote = function () {}
    engine._strategyManager.mergeRemote = function () {}
  }

  test('V8 mode mismatch drops viral result', async function () {
    var calls = 0
    var scorer = async function () {
      calls++
      return calls === 1 ? { score: 60, mode: 'orchestrator' } : { score: 20, mode: 'local-fallback' }
    }
    var engine = new RewriteEngine({ llmClient: { chat: async function () { return '改写结果' } }, viralScorer: scorer, knowledgeBase: new KnowledgeBase() })
    wireStrategy3(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.viral).toBeUndefined()
  })

  test('V9 NaN/Infinity score is dropped', async function () {
    var calls = 0
    var scorer = async function () {
      calls++
      return { score: calls === 1 ? NaN : 80, mode: 'local-fallback' }
    }
    var engine = new RewriteEngine({ llmClient: { chat: async function () { return '改写结果' } }, viralScorer: scorer, knowledgeBase: new KnowledgeBase() })
    wireStrategy3(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.viral).toBeUndefined()
  })
})
