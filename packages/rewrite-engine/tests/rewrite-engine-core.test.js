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
    // 断言用【字数要求】指令段标记（硬约束冲突裁决声明中含"字数要求"字样，不构成指令段）
    await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: -5, max: 3000 } } })
    expect(captured.sys).not.toContain('【字数要求】')
    await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 100, max: 9999 } } })
    expect(captured.sys).not.toContain('【字数要求】')
    await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 2000, max: 100 } } })
    expect(captured.sys).not.toContain('【字数要求】')
  })

  // ───────────────────────────────────────────────────────────────────────────
  // BUGFIX-REWRITE-QUALITY-UX 集成层回归（2026-09-16）
  //
  // 事故：评估器判定与改写模式无关，导致「选题创作」的短种子→长成文被判 fail。
  // 修复分两处：① 评估器按 mode 分档；② 本文件被测的 rewrite() 把 params.mode 透传给评估器。
  // 独立复核指出此前**集成层无任何覆盖**该透传链，故补以下用例。
  // ───────────────────────────────────────────────────────────────────────────

  test('M1 rewrite() 把 mode 透传给 evaluateAsync（选题创作）', async function () {
    var captured = null
    var ev = {
      evaluateAsync: async function (original, rewritten, opts) {
        captured = { original: original, opts: opts }
        return { method: 'embedding', verdict: 'pass' }
      },
      evaluate: function () { return { method: 'simhash', verdict: 'pass' } }
    }
    var engine = new RewriteEngine({ llmClient: mockLlmClient('rewritten'), qualityEvaluator: ev, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'create', content: '秋天来了', userSettings: {} })
    expect(result.success).toBe(true)
    expect(captured).not.toBeNull()
    expect(captured.opts).toEqual({ mode: 'create' })
    expect(captured.original).toBe('秋天来了')
  })

  test('M2 embedding 失败回退 evaluate 时同样透传 mode', async function () {
    var captured = null
    var ev = {
      evaluateAsync: async function () { throw new Error('embedding unavailable') },
      evaluate: function (original, rewritten, opts) {
        captured = opts
        return { method: 'simhash', verdict: 'pass' }
      }
    }
    var engine = new RewriteEngine({ llmClient: mockLlmClient('rewritten'), qualityEvaluator: ev, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'create', content: '秋天来了', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.quality.method).toBe('simhash')
    expect(captured).toEqual({ mode: 'create' })
  })

  test('M3 端到端：选题创作「短种子 → 长成文」不再判 fail（真实事故回归）', async function () {
    var seed = '秋天来了'
    // 约 320 字的成文，包含种子的全部字符（模拟"主题种子 → 成文"）
    var article = '秋天来了。窗外的树叶一片一片往下掉，风吹过的时候，它们打着旋儿落在人行道上。'.repeat(8)
    var engine = new RewriteEngine({ llmClient: mockLlmClient(article), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'create', content: seed, userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.quality.mode).toBe('create')
    // 覆盖率口径下种子内容被完整保留 → 不得判 fail（修复前此处为 fail）
    expect(result.quality.semanticPreservation).toBeGreaterThan(60)
    expect(result.quality.verdict).not.toBe('fail')
    // 措辞不得暗示"偏离原意"而使用户怀疑引擎
    expect(result.quality.suggestions.join('')).not.toContain('偏离原意')
    expect(result.quality.suggestions.join('')).not.toContain('不合格')
  })

  test('M4 端到端：智能仿写模式仍按原严格度判定（未被放松）', async function () {
    var text = '这是一段关于电商运营的原文内容，包含了丰富的营销策略与增长方法'
    var engine = new RewriteEngine({ llmClient: mockLlmClient(text), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    // 返回与原文几乎完全相同 → 仍应判 fail（近似重复）
    var result = await engine.rewrite({ mode: 'imitate', content: text, userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.quality.mode).toBe('imitate')
    expect(result.quality.verdict).toBe('fail')
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

// ── E: P1-E 爆款信号注入（viralAngles/viralKeywords 软约束）──
describe('RewriteEngine viral signal injection', function () {
  function wireStrategy4(engine) {
    var strategy = {
      id: 'signal-v1', name: 'signal-test', category: 'imitate',
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

  // ── F: 改写结果纯文案约束 + 标题生成 + 结构标题剥离（2026-09-18）──
  function mockLlmClient(t) { return { chat: async function () { return t } } }

  function wireStrategy5(engine) {
    var strategy = {
      id: 'pure-copy-v1', name: 'pure-copy', category: 'imitate',
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

  test('F1 纯文案输出约束：未注入回退内置默认，注入后覆盖为自定义版本', async function () {
    var capturedSys = null
    var llm = { chat: async function (sys, user) { capturedSys = sys; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy5(engine)
    // 未注入 → 回退内置默认（审查 M1：纯文案约束仍在 systemPrompt 最前）
    await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(capturedSys.indexOf('【改写硬约束')).toBe(0)
    expect(capturedSys).toContain('只输出改写后的文案本身')
    // 注入自定义硬约束（运营中心下发版本）→ 覆盖内置默认
    engine.setHardConstraints('自定义规则甲。自定义规则乙。')
    await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(capturedSys.indexOf('【改写硬约束')).toBe(0)
    expect(capturedSys).toContain('自定义规则甲')
    expect(capturedSys).not.toContain('只输出改写后的文案本身')
  })

  test('F2 改写结果剥离结构标题行（开头/中间/结尾等小节标题）', async function () {
    var raw = '## 开头（悬念钩子）\n昨天半夜我被热醒了。\n\n**中间（情感转折）**\n说实话，我对夏天的感情很复杂。\n\n**结尾（共鸣与号召）**\n所以夏天来了。'
    var engine = new RewriteEngine({ llmClient: mockLlmClient(raw), knowledgeBase: new KnowledgeBase() })
    wireStrategy5(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '夏天来了', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.result).not.toContain('开头（悬念钩子）')
    expect(result.result).not.toContain('中间（情感转折）')
    expect(result.result).not.toContain('结尾（共鸣与号召）')
    expect(result.result).toContain('昨天半夜我被热醒了')
    expect(result.result).toContain('所以夏天来了')
  })

  test('F2b 普通句子含关键词不被误删（标题位匹配回归保护）', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('x'), knowledgeBase: new KnowledgeBase() })
    wireStrategy5(engine)
    // 关键词在句中/句尾 → 保留；关键词在行首且带结构标记 → 剥离
    expect(engine._stripStructureHeadings('故事的结尾不需要太多解释。')).toBe('故事的结尾不需要太多解释。')
    expect(engine._stripStructureHeadings('我们中间出了叛徒。')).toBe('我们中间出了叛徒。')
    expect(engine._stripStructureHeadings('引发共鸣，才有传播。')).toBe('引发共鸣，才有传播。')
    expect(engine._stripStructureHeadings('要号召大家一起行动。')).toBe('要号召大家一起行动。')
    expect(engine._stripStructureHeadings('结尾要有反转。')).toBe('结尾要有反转。')
    // 行首结构标题 → 剥离
    expect(engine._stripStructureHeadings('开头（悬念钩子）\n正文内容')).toBe('正文内容')
    expect(engine._stripStructureHeadings('**中间（情感转折）**\n正文内容')).toBe('正文内容')
    expect(engine._stripStructureHeadings('## 结尾（共鸣与号召）\n正文内容')).toBe('正文内容')
  })

  test('F3 改写结果返回 title 字段（≤20 字）', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('改写后的完整文案内容，用于测试标题生成。'), knowledgeBase: new KnowledgeBase() })
    wireStrategy5(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(typeof result.title).toBe('string')
    expect(result.title.length).toBeGreaterThan(0)
    expect(result.title.length).toBeLessThanOrEqual(20)
  })

  test('F4 标题生成在结果过短时回退为空串', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('改写后的完整文案内容，用于测试标题生成。'), knowledgeBase: new KnowledgeBase() })
    wireStrategy5(engine)
    expect(engine._generateTitle('   ')).toBe('')
    expect(engine._generateTitle('')).toBe('')
  })

  test('E1 viralAngles/viralKeywords 注入 userPrompt 信号段', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = user; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy4(engine)
    var result = await engine.rewrite({
      mode: 'imitate', content: '原始内容',
      viralAngles: ['深度解析', '避坑指南'], viralKeywords: ['AI 效率'],
      userSettings: {},
    })
    expect(result.success).toBe(true)
    expect(captured).toContain('深度解析')
    expect(captured).toContain('避坑指南')
    expect(captured).toContain('AI 效率')
  })

  test('E2 非字符串/空数组/超量清洗：≤6 条、每条 ≤60 字符', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = user; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy4(engine)
    var angles = []
    for (var i = 0; i < 10; i++) angles.push('角度' + i + ' ' + 'x'.repeat(80))
    await engine.rewrite({ mode: 'imitate', content: '原始内容', viralAngles: angles.concat([42, null, '  ']), viralKeywords: [], userSettings: {} })
    var kept = ['角度0','角度1','角度2','角度3','角度4','角度5','角度6','角度7','角度8','角度9'].filter(function (a) { return captured.indexOf(a) !== -1 }).length
    expect(kept).toBe(6)
    expect(captured).not.toContain('x'.repeat(70))
    // 空数组 → 无信号段
    var captured2 = null
    var llm2 = { chat: async function (sys, user) { captured2 = user; return '结果' } }
    var engine2 = new RewriteEngine({ llmClient: llm2, knowledgeBase: new KnowledgeBase() })
    wireStrategy4(engine2)
    await engine2.rewrite({ mode: 'imitate', content: '原始内容', viralAngles: [], viralKeywords: [], userSettings: {} })
    expect(captured2).not.toContain('信号')
  })

  test('E3 titleHint 与信号同时存在 → 两段并存', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = user; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy4(engine)
    await engine.rewrite({ mode: 'imitate', content: '原始内容', titleHint: '标题X', viralAngles: ['角度A'], userSettings: {} })
    expect(captured).toContain('标题参考')
    expect(captured).toContain('标题X')
    expect(captured).toContain('爆款信号')
    expect(captured).toContain('角度A')
  })

  test('E4 未传信号 → 行为不变（回归）', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = user; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy4(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(captured).not.toContain('爆款信号')
  })
})

// ── P2-a: 爆款强度定量信号注入（engagement 软约束）──
describe('RewriteEngine viral strength injection', function () {
  function wireS(engine) {
    var strategy = {
      id: 'strength-v1', name: 'strength-test', category: 'imitate',
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
  function engEngine() {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = user; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireS(engine)
    return { engine: engine, getCaptured: function () { return captured } }
  }

  test('P2a-1 有效 engagement 注入强度段，avgLikes 取整百', async function () {
    var e = engEngine()
    await e.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {},
      engagement: { sampleCount: 5, avgLikes: 1234, avgComments: 56.7 } })
    expect(e.getCaptured()).toContain('爆款强度参考')
    expect(e.getCaptured()).toContain('5 条')
    expect(e.getCaptured()).toContain('点赞 ~1200')
    expect(e.getCaptured()).toContain('评论 ~57')
    expect(e.getCaptured()).not.toContain('1234')
  })

  test('P2a-2 样本数 <3 → 不注入（统计无意义，宁缺毋滥）', async function () {
    var e = engEngine()
    await e.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {},
      engagement: { sampleCount: 2, avgLikes: 1234, avgComments: 56 } })
    expect(e.getCaptured()).not.toContain('爆款强度参考')
  })

  test('P2a-3 均值非有限数（NaN/undefined）→ 不注入', async function () {
    var e = engEngine()
    await e.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {},
      engagement: { sampleCount: 8, avgLikes: NaN, avgComments: 56 } })
    expect(e.getCaptured()).not.toContain('爆款强度参考')
  })

  test('P2a-4 engagement 非对象/null → 不注入', async function () {
    var e = engEngine()
    await e.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {}, engagement: 'x' })
    expect(e.getCaptured()).not.toContain('爆款强度参考')
    var e2 = engEngine()
    await e2.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {}, engagement: null })
    expect(e2.getCaptured()).not.toContain('爆款强度参考')
  })

  test('P2a-5 未携带 engagement → 行为逐字节不变（回归锁）', async function () {
    var e = engEngine()
    await e.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(e.getCaptured()).not.toContain('强度')
    expect(e.getCaptured()).toBe('rewrite: 原始内容')
  })

  test('P2a-6 engagement 与 viralAngles 同存 → 两段并存', async function () {
    var e = engEngine()
    await e.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {},
      viralAngles: ['深度解析'], engagement: { sampleCount: 4, avgLikes: 900, avgComments: 20 } })
    expect(e.getCaptured()).toContain('爆款信号参考')
    expect(e.getCaptured()).toContain('爆款强度参考')
    expect(e.getCaptured()).toContain('深度解析')
  })
})

// ── H: 改写硬约束（最高优先级，运营中心可自定义，2026-09-18）──
describe('RewriteEngine hard constraints', function () {
  function wireStrategyH(engine) {
    var strategy = {
      id: 'hard-constraint-v1', name: 'hard-constraint', category: 'imitate',
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

  test('H1 setHardConstraints 注入 systemPrompt 最前置（优先级高于策略）', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = sys; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategyH(engine)
    engine.setHardConstraints('禁止输出英文。禁止使用列表格式。')
    await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    // 硬约束段在 systemPrompt 最前（段标题在位置 0，内容紧随其后）
    expect(captured.indexOf('【改写硬约束')).toBe(0)
    expect(captured.indexOf('禁止输出英文')).toBeGreaterThan(0)
    expect(captured.indexOf('禁止输出英文')).toBeLessThan(captured.indexOf('assistant.'))
    // 冲突声明存在
    expect(captured).toContain('冲突')
  })

  test('H2 未注入硬约束 → 回退引擎内置默认（审查 M1：独立/离线桌面仍有约束）', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = sys; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategyH(engine)
    await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    // 内置回退：硬约束段仍在最前（纯文案约束），位于策略 systemPrompt 之前
    expect(captured.indexOf('【改写硬约束')).toBe(0)
    expect(captured).toContain('只输出改写后的文案本身')
    expect(captured.indexOf('只输出改写后的文案本身')).toBeLessThan(captured.indexOf('assistant.'))
  })

  test('H3 setHardConstraints 传非法值 → 忽略并回退内置默认', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = sys; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategyH(engine)
    engine.setHardConstraints('   ')
    await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(captured.indexOf('【改写硬约束')).toBe(0)
    // 非字符串/数字均忽略（getHardConstraints 返回空串，注入回退内置）
    engine.setHardConstraints(123)
    expect(engine.getHardConstraints()).toBe('')
    await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(captured.indexOf('【改写硬约束')).toBe(0)
  })

  test('H4 getHardConstraints 返回当前硬约束（含清洗）', async function () {
    var engine = new RewriteEngine({ llmClient: { chat: async function () { return 'x' } }, knowledgeBase: new KnowledgeBase() })
    wireStrategyH(engine)
    expect(engine.getHardConstraints()).toBe('')
    engine.setHardConstraints('  规则A  ')
    expect(engine.getHardConstraints()).toBe('规则A')
  })
})
