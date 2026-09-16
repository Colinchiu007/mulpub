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

