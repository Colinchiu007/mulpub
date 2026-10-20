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
var { SensitiveFilter } = require('../src/sensitive-filter')

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
  // rewrite-segment-and-finish-reason：chat 返回 object 形态（含 finishReason）的 mock
  function mockLlmClientObject(text, finishReason) {
    return { chat: async function () { return finishReason === undefined ? { text } : { text, finishReason } } }
  }
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

  // ── rewrite-segment-and-finish-reason 第二刀：>50000 分段改写 ──

  test('S1 50001 字输入 ⇒ 走分段改写（不报 TOO_LONG）且带 segmented 元数据', async function () {
    var longText = '甲'.repeat(13000) + '\n\n' + '乙'.repeat(13000) + '\n\n' + '丙'.repeat(13000) + '\n\n' + '丁'.repeat(13000)
    var calls = []
    var engine = new RewriteEngine({
      llmClient: { chat: async function (sys, user) { calls.push(user); return '段改写结果' } },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.segmented.enabled).toBe(true)
    expect(result.segmented.segmentCount).toBeGreaterThanOrEqual(2)
    expect(result.segmented.totalChars).toBe([...longText].length)
    // 每段一次 LLM 调用（4 段）
    expect(calls.length).toBe(result.segmented.segmentCount)
    // 合并结果含各段输出
    expect(result.result).toContain('段改写结果')
  })

  test('S2 分段 prompt 注入「长文分片 i/n」上下文', async function () {
    // 6 段 × 10000 = 60000 码点 > MAX_INPUT_CHARS(50000) ⇒ 走分段；
    // 每段 10000 ≤ SEGMENT_SIZE(12000)，贪心合并会超限 ⇒ 各成一段 = 6 段
    var longText = ['甲', '乙', '丙', '丁', '戊', '己'].map(function (c) { return c.repeat(10000) }).join('\n\n')
    var prompts = []
    var engine = new RewriteEngine({
      llmClient: { chat: async function (sys, user) { prompts.push({ sys, user }); return '段结果' } },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {} })
    expect(r.segmented.segmentCount).toBe(6)
    expect(prompts.length).toBe(6)
    // 每段 prompt 都带分片标记（含段号与总段数）
    prompts.forEach(function (p, i) {
      expect(p.sys).toContain('长文分片')
      expect(p.sys).toContain('第 ' + (i + 1) + '/6 片')
    })
  })

  test('S3 任一段 LLM 失败 ⇒ 整篇失败 + segmentIndex 结构化字段（无半成品）', async function () {
    var longText = ['甲', '乙', '丙', '丁', '戊', '己'].map(function (c) { return c.repeat(10000) }).join('\n\n')
    var n = 0
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { n++; if (n === 2) throw new Error('provider down'); return '段结果' } },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {} })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('LLM_ERROR')
    expect(result.segmentIndex).toBe(1) // 第二段（0-based）
    expect(result.segmentCount).toBe(6)
    expect(result.error).toContain('第 2/6 段')
    expect(result.result).toBeUndefined() // 不返回半成品
  })

  test('S4 用户显式 wordCountRange ⇒ 每段 clamp 到「区间 ÷ 段数」份额', async function () {
    // 5 段 × 11000 = 55000 > 50000；每段 11000 ≤ 12000 ⇒ 各成一段 = 5 段
    var longText = ['甲', '乙', '丙', '丁', '戊'].map(function (c) { return c.repeat(11000) }).join('\n\n')
    var prompts = []
    var engine = new RewriteEngine({
      llmClient: { chat: async function (sys) { prompts.push(sys); return 'x'.repeat(2000) } },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: { wordCountRange: { min: 800, max: 50000 } } })
    expect(r.segmented.segmentCount).toBe(5)
    // 5 段 ⇒ 每段上限 floor(50000/5)=10000；prompt 注入的区间必须是 10000 而非 50000
    var segInstruction = prompts[0].match(/【字数要求】改写后的文本长度必须控制在 (\d+) 到 (\d+) 字之间/)
    expect(segInstruction).toBeTruthy()
    expect(Number(segInstruction[2])).toBe(10000)
  })

  test('S5 全篇级副作用只执行一次（KB 写入与 viralScorer 调用计数）', async function () {
    var longText = '甲'.repeat(13000) + '\n\n' + '乙'.repeat(13000) + '\n\n' + '丙'.repeat(13000)
    var viralCalls = 0
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '段结果' } },
      knowledgeBase: new KnowledgeBase(),
      viralScorer: async function () { viralCalls++; return { score: 50, mode: 'orchestrator' } },
    })
    wireStrategy(engine)
    var recordSpy = []
    engine._knowledgeBase.recordFeedback = function (rec) { recordSpy.push(rec) }
    await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {} })
    // viralScorer 只对全篇调用两次（原文 + 合并结果），不是每段两次
    expect(viralCalls).toBe(2)
    // KB recordFeedback 只写一条（一篇一次）
    expect(recordSpy.length).toBe(1)
  })

  // ── rewrite-cancel-and-truncation-summary：段级截断汇总（A）──
  // 历史缺陷：segment-rewriter 丢弃每段的 modelTruncated 并硬写 false，
  // 导致「5 段里第 3 段被模型截断」在界面上完全不可见（静默截断换到分段路径重现）。

  test('T1 任一段被模型截断 ⇒ 全篇 modelTruncated=true 且 truncatedSegments 记录 1-based 段号', async function () {
    // 5 段 × 11000 = 55000 > 50000，每段 ≤ SEGMENT_SIZE ⇒ 精确 5 段
    var longText = ['甲', '乙', '丙', '丁', '戊'].map(function (c) { return c.repeat(11000) }).join('\n\n')
    var n = 0
    var engine = new RewriteEngine({
      // 第 3 段（index 2）报 length；其余正常
      llmClient: {
        chat: async function () {
          n++
          return n === 3 ? { text: '第三段结果', finishReason: 'length' } : { text: '正常段结果', finishReason: 'stop' }
        }
      },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.segmented.segmentCount).toBe(5)
    expect(r.modelTruncated).toBe(true)
    expect(r.truncatedSegments).toEqual([3])
  })

  test('T2 全部段正常结束 ⇒ modelTruncated=false 且 truncatedSegments 为空数组', async function () {
    var longText = ['甲', '乙', '丙', '丁', '戊'].map(function (c) { return c.repeat(11000) }).join('\n\n')
    var engine = new RewriteEngine({
      llmClient: mockLlmClientObject('正常段结果', 'stop'),
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {} })
    expect(r.segmented.segmentCount).toBe(5)
    expect(r.modelTruncated).toBe(false)
    expect(r.truncatedSegments).toEqual([])
  })

  test('T3 Anthropic 系 max_tokens 与 OpenAI 系 length 同样计入截断', async function () {
    var longText = '甲'.repeat(55000)
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return { text: '段结果', finishReason: 'max_tokens' } } },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.modelTruncated).toBe(true)
    expect(r.truncatedSegments.length).toBeGreaterThan(0)
  })

  test('T4 单次路径（未分段）不出现 truncatedSegments 字段（纯增量，不改旧形状）', async function () {
    var engine = new RewriteEngine({
      llmClient: mockLlmClientObject('单次结果', 'length'),
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: '短文内容', userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.modelTruncated).toBe(true)
    expect('truncatedSegments' in r).toBe(false)
  })

  // ── rewrite-cancel-and-truncation-summary：协作式取消（B）──
  // 取消在段边界生效（in-flight HTTP 不中断，见 proposal §2.1）。

  test('C1 第 2 段开始前已取消 ⇒ CANCELLED + completedSegments，且不返回半成品', async function () {
    var longText = ['甲', '乙', '丙', '丁', '戊'].map(function (c) { return c.repeat(11000) }).join('\n\n')
    var signal = { cancelled: false }
    var calls = 0
    var engine = new RewriteEngine({
      llmClient: {
        chat: async function () {
          calls++
          // 第 1 段完成后由「用户」触发取消 ⇒ 第 2 段开始前应被拦截
          if (calls === 1) signal.cancelled = true
          return '段结果'
        }
      },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {}, signal: signal })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('CANCELLED')
    expect(r.cancelled).toBe(true)
    expect(r.segmentCount).toBe(5)
    expect(r.cancelledAtSegment).toBe(2) // 1-based：第 2 段被拦
    expect(r.completedSegments).toBe(1)
    expect(r.result).toBeUndefined()
    expect(calls).toBe(1) // 只有第 1 段真正调用了 LLM
  })

  test('C2 入口即取消 ⇒ 一次 LLM 都不调用', async function () {
    var longText = '甲'.repeat(55000)
    var calls = 0
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { calls++; return '段结果' } },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({
      mode: 'imitate', content: longText, userSettings: {}, signal: { cancelled: true },
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('CANCELLED')
    expect(r.completedSegments).toBe(0)
    expect(calls).toBe(0)
  })

  test('C3 无 signal ⇒ 行为与改动前完全一致（老调用方零影响）', async function () {
    var longText = ['甲', '乙', '丙', '丁', '戊'].map(function (c) { return c.repeat(11000) }).join('\n\n')
    var engine = new RewriteEngine({
      llmClient: mockLlmClientObject('段结果', 'stop'),
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: longText, userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.segmented.segmentCount).toBe(5)
    expect(r.cancelled).toBeUndefined()
  })

  test('C4 取消不写知识库反馈（KB recordFeedback 调用 0 次）', async function () {
    var longText = ['甲', '乙', '丙', '丁', '戊'].map(function (c) { return c.repeat(11000) }).join('\n\n')
    var recordCalls = 0
    var engine = new RewriteEngine({
      llmClient: mockLlmClientObject('段结果', 'stop'),
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    engine._knowledgeBase.recordFeedback = function () { recordCalls++ }
    var r = await engine.rewrite({
      mode: 'imitate', content: longText, userSettings: {}, signal: { cancelled: true },
    })
    expect(r.errorCode).toBe('CANCELLED')
    expect(recordCalls).toBe(0)
  })

  test('W3 超长内容仍被拒绝（TOO_LONG, >MAX_INPUT_CHARS=50000）', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('x'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    // rewrite-segment-and-finish-reason 第二刀：50001 起走分段而非 TOO_LONG；
    // 只有分段阈值内不可分段（单段即超 SEGMENT_SIZE 的兜底硬切也保证可切）——
    // TOO_LONG 分支保留给「输入为空」之外的未来硬上限场景，当前由 _validate 兜底。
    var ok = await engine.rewrite({ mode: 'imitate', content: 'a'.repeat(6001), userSettings: {} })
    expect(ok.success).toBe(true)
    var segmented = await engine.rewrite({ mode: 'imitate', content: 'a'.repeat(50001), userSettings: {} })
    expect(segmented.success).toBe(true)
    expect(segmented.segmented.enabled).toBe(true)
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

  // ── collect-rewrite-wordcount（2026-10-20）：min=0 的「无下限」语义 ──
  // 事故：用户在采集页把字数区间设成 0-6000，引擎收到的区间若写成「0 到 6000 字之间」，
  // 模型会照着下限写，把改写做成摘要（实测 3515 字原文 → 1229 字摘要，且用户看不出异常）。
  // min=0 的合法含义是「不设下限，只要不超过上限」，因此指令必须给上限 + 与原文相当的目标篇幅。

  test('W7 min=0 ⇒ 指令给「不超过上限 + 目标篇幅」，不再出现「0 到 N 字之间」', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = { sys, user }; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    await engine.rewrite({ mode: 'imitate', content: '字'.repeat(1200), userSettings: { wordCountRange: { min: 0, max: 6000 } } })
    expect(captured.sys).toContain('字数要求')
    expect(captured.sys).toContain('6000')
    // 坏指令形态必须消失：「0 到 6000」把「无下限」说成「可以任意短」
    expect(captured.sys).not.toContain('0 到 6000')
    expect(captured.sys).toContain('不得超过')
  })

  test('W8 min=0 且原文短于上限 ⇒ 目标篇幅 = 原文长度（与原文相当，不压缩成摘要）', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = { sys, user }; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    await engine.rewrite({ mode: 'imitate', content: '字'.repeat(1200), userSettings: { wordCountRange: { min: 0, max: 6000 } } })
    expect(captured.sys).toContain('1200')
    expect(captured.sys).toContain('不要把原文压缩成摘要')
  })

  test('W9 min=0 且上限低于原文长度 ⇒ 目标篇幅取上限（不得与「不得超过」自相矛盾）', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = { sys, user }; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    await engine.rewrite({ mode: 'imitate', content: '字'.repeat(3000), userSettings: { wordCountRange: { min: 0, max: 2000 } } })
    // 目标篇幅 = min(原文 3000, 上限 2000) = 2000；不得出现 3000（那会让模型写出超限稿）
    expect(captured.sys).toContain('2000')
    expect(captured.sys).not.toMatch(/目标篇幅约 3000/)
  })

  test('W10 min>0 ⇒ 指令格式仍是「min 到 max 字之间」（既有契约不变）', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = { sys, user }; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    await engine.rewrite({ mode: 'imitate', content: '字'.repeat(1200), userSettings: { wordCountRange: { min: 800, max: 2000 } } })
    expect(captured.sys).toContain('800 到 2000 字之间')
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

  // ── rewrite-limits-50000（2026-10-19）：截断可见化 + 上限 50000 ──
  test('L1 截断可见化：默认 3000 兜底砍尾 ⇒ outputTruncated=true 且 outputLength=实际字数', async function () {
    var longText = 'x'.repeat(3500)
    var strategy = sampleStrategy()
    strategy.postProcess = { removeAITaste: false }
    var engine = new RewriteEngine({ llmClient: mockLlmClient(longText), knowledgeBase: new KnowledgeBase() })
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.outputTruncated).toBe(true)
    expect(result.outputLength).toBe(3000)
  })

  test('L2 截断可见化：未截断 ⇒ outputTruncated=false', async function () {
    var strategy = sampleStrategy()
    strategy.postProcess = { removeAITaste: false }
    var engine = new RewriteEngine({ llmClient: mockLlmClient('短结果'), knowledgeBase: new KnowledgeBase() })
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.outputTruncated).toBe(false)
    expect(result.outputLength).toBe(3)
  })

  test('L3 截断可见化：wordCountRange.max 砍尾同样置 outputTruncated，且上限 50000 生效', async function () {
    // 6001 字输出在旧上限（6000）会被砍，新上限下若区间给到 50000 则不截
    var longText = 'x'.repeat(6001)
    var strategy = sampleStrategy()
    strategy.postProcess = { removeAITaste: false }
    var engine = new RewriteEngine({ llmClient: mockLlmClient(longText), knowledgeBase: new KnowledgeBase() })
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    var notTrimmed = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 100, max: 50000 } } })
    expect(notTrimmed.outputTruncated).toBe(false)
    var trimmed = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 100, max: 6000 } } })
    expect(trimmed.outputTruncated).toBe(true)
    expect(trimmed.outputLength).toBe(6000)
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

  // ── rewrite-segment-and-finish-reason 第一刀：finish_reason 归一化 + modelTruncated ──

  test('L4 chat 返回 object（无 finishReason）⇒ 正常改写且 modelTruncated=false', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClientObject('改写结果'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.result).toBe('改写结果')
    expect(result.modelTruncated).toBe(false)
  })

  test('L5 chat 返回 {text, finishReason:"length"} ⇒ modelTruncated=true', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClientObject('被模型截断的结果', 'length'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.modelTruncated).toBe(true)
    // 引擎侧未截断 ⇒ outputTruncated 保持 false（两个字段分型，不混）
    expect(result.outputTruncated).toBe(false)
  })

  test('L6 Anthropic stop_reason=max_tokens 归一化 ⇒ modelTruncated=true', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClientObject('结果', 'max_tokens'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.modelTruncated).toBe(true)
  })

  test('L7 finishReason=stop ⇒ modelTruncated=false（非截断语义不误报）', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClientObject('结果', 'stop'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.modelTruncated).toBe(false)
  })

  test('L8 chat 返回 {text:""} ⇒ 仍走 EMPTY_RESULT（新 shape 不漏判空）', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClientObject(''), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('EMPTY_RESULT')
  })

  test('L9 chat 返回旧 shape string ⇒ 行为不变（保形抽取回归）', async function () {
    var engine = new RewriteEngine({ llmClient: mockLlmClient('旧 shape 结果'), knowledgeBase: new KnowledgeBase() })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.result).toBe('旧 shape 结果')
    expect(result.modelTruncated).toBe(false)
  })

  test('L10 chat 抛错 ⇒ LLM_ERROR（契约变更不吞既有错误路径）', async function () {
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { throw new Error('provider down') } },
      knowledgeBase: new KnowledgeBase()
    })
    wireStrategy(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: {} })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('LLM_ERROR')
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
    // 9999 在 rewrite-limits-50000 后是合法 max（原 6000 上限）；越界上界改为 50001
    await engine.rewrite({ mode: 'imitate', content: '任意内容', userSettings: { wordCountRange: { min: 100, max: 50001 } } })
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

// ── P: 改写结果分段保留（2026-10-03 Bug 修复，段落压平回归锁）──
// 用户反馈：改写后文案是一整段没有正常分段。根因是 AITasteRemover Pass 3
// _mergeUniformSentences 全文切句重组丢换行；本组用例锁死「后处理不改变分段结构」。
describe('RewriteEngine 结果分段保留', function () {
  var multiParagraphLlmOutput = [
    '这台机器性能确实很强。续航表现也让人满意。',
    '',
    '外观设计走的是简约路线。价格在同类里也算实惠。',
    '',
    '拍照效果属于第一梯队。系统流畅度没什么可挑的。'
  ].join('\n')

  function wireMultiPara(engine) {
    var strategy = {
      id: 'para-keep-v1', name: 'para-keep', category: 'imitate',
      systemPrompt: 'assistant.', userPromptTemplate: 'rewrite: {content}',
      industry: ['generic'], tone: ['casual'], platforms: ['generic'],
      postProcess: { removeAITaste: true, maxLength: 6000 }
    }
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    engine._strategyManager.clearRemote = function () {}
    engine._strategyManager.mergeRemote = function () {}
  }

  test('P1 多段 LLM 输出经后处理仍保留空行分段（真实策略链）', async function () {
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return multiParagraphLlmOutput } },
      knowledgeBase: new KnowledgeBase()
    })
    wireMultiPara(engine)
    var result = await engine.rewrite({ mode: 'imitate', content: '任意原文内容', userSettings: {} })
    expect(result.success).toBe(true)
    expect(result.result).toContain('\n\n')
  })

  test('P2 内置默认硬约束含分段约束（空行分隔）', async function () {
    var captured = null
    var llm = { chat: async function (sys, user) { captured = sys; return '结果' } }
    var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
    wireMultiPara(engine)
    await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(captured).toContain('空行分隔')
  })

  test('P3 模式指令含分段输出要求（三模式）', async function () {
    for (var mode of ['imitate', 'expand', 'create']) {
      var captured = null
      var llm = { chat: async function (sys, user) { captured = sys; return '结果' } }
      var engine = new RewriteEngine({ llmClient: llm, knowledgeBase: new KnowledgeBase() })
      wireMultiPara(engine)
      await engine.rewrite({ mode: mode, content: '原始内容', userSettings: {} })
      expect(captured).toContain('分段输出要求')
    }
  })
})

// ── AI 味定制注入（ai-taste-ops-center，2026-10-03）──
describe('RewriteEngine AI 味定制注入', function () {
  function wireTaste(engine) {
    var strategy = {
      id: 'taste-v1', name: 'taste', category: 'imitate',
      systemPrompt: 'assistant.', userPromptTemplate: 'rewrite: {content}',
      industry: ['generic'], tone: ['casual'], platforms: ['generic'],
      postProcess: { removeAITaste: true, maxLength: 6000 }
    }
    engine._strategyManager._strategies = [strategy]
    engine._strategyManager.listEnabled = function () { return [strategy] }
    engine._strategyManager.get = function () { return strategy }
    engine._strategyManager.clearRemote = function () {}
    engine._strategyManager.mergeRemote = function () {}
  }

  test('C1 setAiTasteCustomization 空对象行为不变', async function () {
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '综上所述，结果很好。' } },
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    var r1 = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    engine.setAiTasteCustomization({})
    var r2 = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(r2.result).toBe(r1.result)
    expect(r2.result).not.toContain('综上所述')
  })

  test('C2 自定义词端到端生效（覆盖内置替换方向）', async function () {
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '综上所述，结果很好。' } },
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    engine.setAiTasteCustomization({ phraseMap: { '综上所述': '归根结底' } })
    var r = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(r.result).toContain('归根结底')
    expect(r.result).not.toContain('说到底')
  })

  test('C3 策略 postProcess.aiTasteIntensity=1 消费（跳 Pass 3）', async function () {
    var llmOut = '性能很强。续航也很顶。拍照很清晰。充电速度很快。'
    var engine = new RewriteEngine({ llmClient: { chat: async function () { return llmOut } }, knowledgeBase: new KnowledgeBase() })
    wireTaste(engine)
    engine._strategyManager._strategies[0].postProcess.aiTasteIntensity = 1
    var r = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(r.result).toBe(llmOut)
  })

  test('C4 非法 aiTasteIntensity 回 2（0/4/字符串/null）', async function () {
    var llmOut = '性能很强。续航也很顶。拍照很清晰。充电速度很快。'
    for (var bad of [0, 4, 'x', null]) {
      var engine = new RewriteEngine({ llmClient: { chat: async function () { return llmOut } }, knowledgeBase: new KnowledgeBase() })
      wireTaste(engine)
      engine._strategyManager._strategies[0].postProcess.aiTasteIntensity = bad
      var r = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
      expect(r.result).not.toBe(llmOut)
    }
  })

  test('C5 未注入时 getAiTasteCustomization 为空且引擎行为不变', async function () {
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '综上所述，结果很好。' } },
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    expect(engine.getAiTasteCustomization()).toEqual({})
    var r = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(r.result).toContain('说到底')
  })

  // ── 敏感词前置拦截放宽（rewrite-sensitive-precheck-relax，2026-10-20）──
  //
  // 背景：真实长文（历史/时政类素材）常因一两个日常词汇（如「爆炸」「走私」）被
  // 内置词库整篇拦截，用户无法改写。用户确认的取舍：**前置拦截（针对用户输入的
  // 原文）关闭，后置检测（针对改写结果）保留**——前者挡用户自己的输入且无申诉
  // 渠道，后者作为「引擎给你的提醒」仍然有价值。
  //
  // 回归保护：三个维度必须同时锁住——
  //   ① 前置不再 blocked（不返回 SENSITIVE_CONTENT）；
  //   ② 后置仍检测（hits 仍上报、warnings 仍生成）；
  //   ③ 知识库回写的「双零命中」条件不被破坏（仍要求前置后置都零命中）。

  test('X1 前置敏感词不再拦截改写（含日常词汇的长文可正常改写）', async function () {
    var llmOut = '工厂发生了爆炸，随后起火。'
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return llmOut } },
      sensitiveFilter: { detect: function () { return { hasSensitive: true, hits: [{ word: '爆炸', index: 4, length: 2, category: '暴力' }] } } },
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: '工厂发生了爆炸，随后起火。', userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.errorCode).toBeUndefined()
    expect(r.result).toBe(llmOut)
  })

  test('X2 后置检测保留：改写结果命中敏感词仍进 warnings + sensitiveHits', async function () {
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '结果里有爆炸二字' } },
      sensitiveFilter: { detect: function () { return { hasSensitive: true, hits: [{ word: '爆炸', index: 4, length: 2, category: '暴力' }] } } },
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.warnings[0]).toContain('敏感')
    expect(r.sensitiveHits).toHaveLength(1)
    expect(r.sensitiveHits[0].word).toBe('爆炸')
  })

  test('X3 检测异常仍 fail-open（不因放宽而引入新的失败面）', async function () {
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '改写结果' } },
      sensitiveFilter: { detect: function () { throw new Error('detect boom') } },
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.result).toBe('改写结果')
    expect(r.warnings).toEqual([])
  })

  test('X4 未注入敏感词过滤器时行为不变（不检测、不拦截）', async function () {
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '改写结果' } },
      sensitiveFilter: null,
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: '工厂发生了爆炸', userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.sensitiveHits).toEqual([])
    expect(r.warnings).toEqual([])
  })

  test('X5 前置拦截放宽不破坏知识库「双零命中」条件：前置或后置任一命中即不写 KB', async function () {
    // detect 按文本区分前置/后置：原文含「爆炸」⇒ 只前置命中；LLM 输出含「杀人」
    // ⇒ 只后置命中。两者必须可区分，否则「任一命中即不写」与「只看后置」
    // 在断言上完全等价（实测：不区分时削弱 KB 条件的变异能让本测试假绿）。
    function makeEngine (llmOut) {
      var engine = new RewriteEngine({
        llmClient: { chat: async function () { return llmOut } },
        sensitiveFilter: {
          detect: function (text) {
            var hits = []
            if (text.indexOf('爆炸') !== -1) hits.push({ word: '爆炸', index: 0, length: 2, category: '暴力' })
            if (text.indexOf('杀人') !== -1) hits.push({ word: '杀人', index: 0, length: 2, category: '暴力' })
            return { hasSensitive: hits.length > 0, hits: hits }
          }
        },
        knowledgeBase: new KnowledgeBase()
      })
      wireTaste(engine)
      var recordSpy = []
      engine._knowledgeBase.recordFeedback = function (rec) { recordSpy.push(rec) }
      return { engine: engine, recordSpy: recordSpy }
    }

    // 仅前置命中：原文含「爆炸」，LLM 输出干净
    var pre = makeEngine('干净的输出')
    var rPre = await pre.engine.rewrite({ mode: 'imitate', content: '工厂发生了爆炸', userSettings: {} })
    expect(rPre.success).toBe(true)
    expect(rPre.sensitiveHits).toEqual([])
    expect(pre.recordSpy.length).toBe(0)

    // 仅后置命中：原文干净，LLM 输出含「杀人」
    var post = makeEngine('结果里有杀人二字')
    var rPost = await post.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(rPost.success).toBe(true)
    expect(rPost.sensitiveHits).toHaveLength(1)
    expect(rPost.sensitiveHits[0].word).toBe('杀人')
    expect(post.recordSpy.length).toBe(0)

    // 前后置均零命中 ⇒ 正常写 KB 一条
    var clean = makeEngine('干净的输出')
    var rClean = await clean.engine.rewrite({ mode: 'imitate', content: '原始内容', userSettings: {} })
    expect(rClean.success).toBe(true)
    expect(clean.recordSpy.length).toBe(1)
  })

  // X1-X5 全部用手写 detect 桩，因此「内置词库能否识别词 → 引擎是否放行」这条
  // **用户报障的真实链路**是零覆盖的：若有人改坏 sensitive-filter.js 的 BUILTIN 词库
  // （手滑删掉「暴力」分类等），X1-X5 会全绿而用户故障复发。本例用真过滤器钉住它。
  test('X6 真内置词库 + 含「爆炸」的长文 ⇒ 放行（用户报障链路的回归锁）', async function () {
    // 与生产接线一致：apps/desktop/electron/services/rewrite-engine.js 注入 new SensitiveFilter()
    var realFilter = new SensitiveFilter()
    // 前提自证：这个词确实在词库里且确实被识别（否则本测试会在错误的前提下通过）
    expect(realFilter.detect('石油加工厂发生爆炸和火灾').hasSensitive).toBe(true)
    expect(realFilter.detect('石油加工厂发生爆炸和火灾').hits[0].word).toBe('爆炸')

    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '工厂事故的经过与后续。' } },
      sensitiveFilter: realFilter,
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    // 用户原文的实质内容：历史类长文，命中词是日常词汇「爆炸」
    var r = await engine.rewrite({
      mode: 'imitate',
      content: '2010年12月，俄罗斯后贝加尔斯克一家石油加工厂发生爆炸和火灾，五人死亡，设备与厂房被炸毁。',
      userSettings: {}
    })
    expect(r.success).toBe(true)
    expect(r.errorCode).toBeUndefined()
    expect(r.result).toBe('工厂事故的经过与后续。')
    // 前置命中不再拦截，但也不该把命中塞进用户可见的 warnings（那是后置的职责）
    expect(r.sensitiveHits).toEqual([])
    expect(r.warnings).toEqual([])
  })

  // 与 X6 配对：同一真过滤器下，改写**结果**含命中词时仍要出声（否则「保留后置」落空）。
  test('X7 真内置词库：改写结果含命中词 ⇒ 仍进 warnings + sensitiveHits', async function () {
    var realFilter = new SensitiveFilter()
    var engine = new RewriteEngine({
      llmClient: { chat: async function () { return '现场发生了爆炸，造成多人伤亡。' } },
      sensitiveFilter: realFilter,
      knowledgeBase: new KnowledgeBase()
    })
    wireTaste(engine)
    var r = await engine.rewrite({ mode: 'imitate', content: '一篇干净的原文，没有任何敏感内容。', userSettings: {} })
    expect(r.success).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.sensitiveHits.map(function (h) { return h.word })).toContain('爆炸')
  })
})
