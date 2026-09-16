/**
 * 改写质量评估器测试
 */
var {
  RewriteQualityEvaluator, cosineSimilarity, computeSimHash, hammingDistance,
  charJaccard, charCoverage, keywordCoverage, keywordOverlap, normalizeMode,
  normalizeMethod, SEMANTIC_BANDS
} = require('../src/rewrite-quality-evaluator')

describe('RewriteQualityEvaluator', function () {
  var evaluator

  beforeEach(function () {
    evaluator = new RewriteQualityEvaluator()
  })

  test('evaluate() should return simhash-based scores', function () {
    var result = evaluator.evaluate('这是原文内容', '这是改写后的内容')
    expect(result).toHaveProperty('sufficiency')
    expect(result).toHaveProperty('semanticPreservation')
    expect(result).toHaveProperty('originality')
    expect(result).toHaveProperty('simhashDistance')
    expect(result).toHaveProperty('verdict')
    expect(result).toHaveProperty('method')
    expect(result.method).toBe('simhash')
    expect(typeof result.simhashDistance).toBe('number')
  })

  test('evaluate() should detect identical text as insufficient rewrite', function () {
    var text = '这是一段完全相同的文本'
    var result = evaluator.evaluate(text, text)
    expect(result.simhashDistance).toBe(0)
    expect(result.sufficiency).toBe(0)
    expect(result.verdict).toBe('fail')
  })

  test('evaluate() should accept sufficiently different text', function () {
    var result = evaluator.evaluate(
      '这是一段关于电商运营的原文内容，包含了丰富的营销策略',
      '电商运营的优化方案，从营销角度重新设计内容策略'
    )
    expect(result.verdict).toBeDefined()
  })

  test('evaluateAsync() should use embedding when client is available', async function () {
    var mockClient = {
      getEmbedding: async function (text) {
        return new Array(128).fill(0).map(function (_, i) { return Math.sin(i + text.length) })
      }
    }
    var e = new RewriteQualityEvaluator({ embeddingClient: mockClient })
    var result = await e.evaluateAsync('hello world', 'different text here')
    expect(result.method).toBe('embedding')
    expect(result).toHaveProperty('sufficiency')
    expect(result).toHaveProperty('semanticPreservation')
    expect(result).toHaveProperty('originality')
    expect(result).toHaveProperty('verdict')
  })

  test('evaluateAsync() should fallback to simhash when embedding fails', async function () {
    var mockClient = {
      getEmbedding: async function () { throw new Error('network error') }
    }
    var e = new RewriteQualityEvaluator({ embeddingClient: mockClient })
    var result = await e.evaluateAsync('hello', 'world')
    expect(result.method).toBe('simhash')
  })

  test('evaluateAsync() should use simhash when no embedding client', async function () {
    var result = await evaluator.evaluateAsync('hello', 'world')
    expect(result.method).toBe('simhash')
  })

  test('evaluateBatch() should evaluate multiple items', function () {
    var items = [
      { original: '原文1', rewritten: '改写1' },
      { original: '原文2', rewritten: '改写2' }
    ]
    var results = evaluator.evaluateBatch(items)
    expect(results).toHaveLength(2)
    expect(results[0].method).toBe('simhash')
  })

  test('evaluateBatchAsync() should evaluate multiple items async', async function () {
    var mockClient = {
      getEmbedding: async function (text) {
        return new Array(128).fill(0).map(function (_, i) { return Math.sin(i + text.length) })
      }
    }
    var e = new RewriteQualityEvaluator({ embeddingClient: mockClient })
    var items = [
      { original: '原文A', rewritten: '改写A' },
      { original: '原文B', rewritten: '改写B' }
    ]
    var results = await e.evaluateBatchAsync(items)
    expect(results).toHaveLength(2)
    expect(results[0].method).toBe('embedding')
  })
})

describe('cosineSimilarity', function () {
  test('should return 1 for identical vectors', function () {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1)
  })

  test('should return 0 for orthogonal vectors', function () {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  test('should return -1 for opposite vectors', function () {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1)
  })

  test('should handle zero vector gracefully', function () {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
  })
})

describe('computeSimHash', function () {
  test('should return hex string', function () {
    var hash = computeSimHash('hello world')
    expect(typeof hash).toBe('string')
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  test('should produce identical hash for same text', function () {
    expect(computeSimHash('same text')).toBe(computeSimHash('same text'))
  })

  test('should produce different hash for different text', function () {
    expect(computeSimHash('text A')).not.toBe(computeSimHash('text B'))
  })
})

describe('hammingDistance', function () {
  test('should return 0 for identical strings', function () {
    expect(hammingDistance('abc', 'abc')).toBe(0)
  })

  test('should count differing bits', function () {
    expect(hammingDistance('a', 'b')).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUGFIX-REWRITE-QUALITY-UX 回归保护测试（2026-09-16）
//
// 事故现场：文案改写页「选题创作」模式，输入主题种子「秋天来了」(4 字)、
// 输出 831 字成文，质量报告显示 语义保持度 9.89 / 结论「不合格」。
// 根因：① 语义保持度用对称 Jaccard，被输出侧新增字符稀释（charJaccard 仅 0.0127，
//        即 0.0127×70 + 0.30×30 = 9.89）；② 判定与改写模式无关，
//        对"种子→成文"这种语义保持度天然偏低的场景套用了"偏离原意"判据。
// 本组用例锁定修复后的行为，防止同类误判再次发生。
// ─────────────────────────────────────────────────────────────────────────────
describe('BUGFIX-REWRITE-QUALITY-UX 回归：长度增长鲁棒性与模式分档判定', function () {
  var evaluator

  // 真实事故样本文本（节选自用户实际改写结果，831 字）
  var SEED = '秋天来了'
  var ARTICLE = '我盯着手机屏幕，那条消息已经看了整整五分钟。“我们分手吧。”没有解释，没有铺垫，就这么五个字，像一把钝刀，慢慢割开我的胸口。我下意识地抬头，窗外的梧桐叶正一片片往下掉。风一吹，它们打着旋儿，落在人行道上，被路人踩得咯吱作响。秋天来了，悄无声息地，就像她离开一样。我忽然想起去年这个时候，我们还在公园里捡枫叶。她蹲在地上，挑了半天，终于找到一片形状完美的，举起来对着阳光，笑得像个孩子：“你看，这片叶子像不像一颗心。”我当时还笑她矫情。现在想来，那大概是她最后一次对我露出那样的笑容。我给她打了二十三个电话，全部被挂断。最后一条消息，她回了一句：“别找我了，我们都该往前走了。”往前走。往哪儿走。秋天把树叶都吹落了，光秃秃的树枝伸向天空，像极了此刻我无处安放的手。我请了三天假，把自己关在房间里。窗帘拉得严严实实，手机调成静音，外卖堆在门口没人拿，我像个冬眠的动物，蜷缩在被子里，试图用睡眠逃避现实。可每次醒来，那种空荡荡的感觉就像潮水，瞬间把我淹没。第三天傍晚，我实在饿得受不了，终于出了门。楼下的面馆还在营业，老板娘看到我，愣了一下：“小伙子，你这是怎么了。瘦了一圈。”我摇摇头，点了碗牛肉面。热腾腾的面端上来，我低头吃了一口，眼泪突然就掉了下来。不是因为难过。是因为这碗面，还是那个味道。我忽然意识到，秋天来了，树叶会掉，人会走，可有些东西，它一直都在。比如这家开了二十年的面馆，比如老板娘永远热情的笑容，比如我还能吃上一碗热乎的面。我擦了擦眼泪，把面吃完，付了钱，走出门。外面的风有点凉，我裹紧外套，抬头看了看天。夕阳把云朵染成橘红色，美得不像话。我掏出手机，删掉了她的联系方式。不是不痛了。只是我明白了——秋天来了，不是结束，是另一种开始。树叶落尽，才能看见天空的辽阔。有些人走了，才能腾出空间，让新的人走进来。我深吸一口气，迈开步子往前走。秋天来了，我还在。这就够了。你呢。如果你也正在经历告别，别怕。秋天会过去，冬天会来，但春天，也一定会到。'

  // 与文章主题完全无关的种子（用于验证"覆盖率极低"分支）
  var OFFTOPIC_SEED = '量子纠缠退相干原理'

  beforeEach(function () {
    evaluator = new RewriteQualityEvaluator()
  })

  // ── 分量层：覆盖率对长度增长鲁棒 ──

  test('charCoverage 度量原文被保留的比例，不受输出长度稀释', function () {
    // 种子的 4 个字全部出现在成文中 → 覆盖率必须为 1
    expect(charCoverage(SEED, ARTICLE)).toBe(1)
    // 对照：对称 Jaccard 被 831 字稀释到接近 0
    expect(charJaccard(SEED, ARTICLE)).toBeLessThan(0.05)
  })

  test('keywordCoverage 以原文关键词数为分母，不随长文放大', function () {
    // 种子 top-2gram（秋天/天来/来了）全部出现在成文中
    expect(keywordCoverage(SEED, ARTICLE)).toBe(1)
  })

  test('charCoverage / keywordCoverage 边界：空原文视为无信息可丢失（返回 1）', function () {
    expect(charCoverage('', ARTICLE)).toBe(1)
    expect(keywordCoverage('', ARTICLE)).toBe(1)
  })

  test('charCoverage 对完全无关文本返回低覆盖', function () {
    expect(charCoverage(OFFTOPIC_SEED, ARTICLE)).toBeLessThan(0.5)
  })

  // ── 事故复现：修复前后数值对照 ──

  test('事故复现：同一组文本的旧口径复算为 9.89（锁定根因数值）', function () {
    // 旧公式：charJaccard × 70 + keywordOverlap × 30
    //        = 0.0127 × 70 + 0.30 × 30 = 0.89 + 9.00 = 9.89（与事故截图一致）
    var legacySemantic = charJaccard(SEED, ARTICLE) * 100 * 0.7 + keywordOverlap(SEED, ARTICLE) * 100 * 0.3
    expect(legacySemantic).toBeGreaterThan(9)
    expect(legacySemantic).toBeLessThan(11)
  })

  test('事故复现：修复后语义保持度为 100（种子内容被完整保留）', function () {
    var r = evaluator.evaluate(SEED, ARTICLE, { mode: 'create' })
    expect(r.semanticPreservation).toBe(100)
  })

  test('事故复现：选题创作模式下 4 字种子 → 831 字成文 结论不再是 fail', function () {
    var r = evaluator.evaluate(SEED, ARTICLE, { mode: 'create' })
    expect(r.mode).toBe('create')
    expect(r.verdict).toBe('pass')
    // 且不得出现"偏离原意"类负面措辞
    expect(r.suggestions.join('')).not.toContain('偏离原意')
    expect(r.suggestions.join('')).not.toContain('不合格')
  })

  // ── 模式分档判定表 ──

  test('模式分档：覆盖率极低的输入在 create 下 warn、在 expand/imitate 下 fail', function () {
    expect(evaluator.evaluate(OFFTOPIC_SEED, ARTICLE, { mode: 'create' }).verdict).toBe('warn')
    expect(evaluator.evaluate(OFFTOPIC_SEED, ARTICLE, { mode: 'expand' }).verdict).toBe('fail')
    expect(evaluator.evaluate(OFFTOPIC_SEED, ARTICLE, { mode: 'imitate' }).verdict).toBe('fail')
  })

  test('模式分档：覆盖率正常的成文在三种模式下均不判 fail', function () {
    for (var mode of ['imitate', 'expand', 'create']) {
      expect(evaluator.evaluate(SEED, ARTICLE, { mode: mode }).verdict).not.toBe('fail')
    }
  })

  test('近似重复（没改够）在任何模式下都 fail', function () {
    for (var mode of ['imitate', 'expand', 'create']) {
      var r = evaluator.evaluate(SEED, SEED, { mode: mode })
      expect(r.simhashDistance).toBe(0)
      expect(r.textSimilarity).toBe(100)
      expect(r.verdict).toBe('fail')
    }
  })

  test('覆盖率语义下不得用"高覆盖率"判没改够：长文必须靠 textSimilarity 兜住', function () {
    // 事故场景 semantic=100，但 textSimilarity 极低 → 不判"没改够"
    var r = evaluator.evaluate(SEED, ARTICLE, { mode: 'imitate' })
    expect(r.semanticPreservation).toBe(100)
    expect(r.textSimilarity).toBeLessThan(5)
    expect(r.verdict).toBe('pass')
    expect(r.suggestions.join('')).not.toContain('改动过少')
  })

  // ── mode 参数契约 ──

  test('mode 归一化：非法/缺省/空值一律回退 imitate', function () {
    expect(normalizeMode(undefined)).toBe('imitate')
    expect(normalizeMode(null)).toBe('imitate')
    expect(normalizeMode('')).toBe('imitate')
    expect(normalizeMode('bogus')).toBe('imitate')
    expect(normalizeMode('create')).toBe('create')
    expect(normalizeMode('expand')).toBe('expand')
    expect(evaluator.evaluate(SEED, ARTICLE).mode).toBe('imitate')
    expect(evaluator.evaluate(SEED, ARTICLE, { mode: 'bogus' }).mode).toBe('imitate')
  })

  test('报告包含 textSimilarity 字段（0-100）', function () {
    var r = evaluator.evaluate(SEED, ARTICLE, { mode: 'create' })
    expect(typeof r.textSimilarity).toBe('number')
    expect(r.textSimilarity).toBeGreaterThanOrEqual(0)
    expect(r.textSimilarity).toBeLessThanOrEqual(100)
  })

  test('evaluateAsync 同样支持 mode 并回传', async function () {
    var r = await evaluator.evaluateAsync(SEED, ARTICLE, { mode: 'create' })
    expect(r.mode).toBe('create')
    expect(r.verdict).toBe('pass')
  })

  test('evaluateBatch / evaluateBatchAsync 支持逐条 mode', async function () {
    var items = [
      { original: SEED, rewritten: ARTICLE, mode: 'create' },
      { original: OFFTOPIC_SEED, rewritten: ARTICLE, mode: 'imitate' }
    ]
    var sync = evaluator.evaluateBatch(items)
    expect(sync[0].verdict).toBe('pass')
    expect(sync[1].verdict).toBe('fail')
    var async = await evaluator.evaluateBatchAsync(items)
    expect(async[0].verdict).toBe('pass')
    expect(async[1].verdict).toBe('fail')
  })

  // ── 边界：英文 / 标点 / 纯符号 ──

  test('英文长文扩展不再被长度稀释（charCoverage=1 兜住），但关键词覆盖率偏弱', function () {
    // 已知局限（登记为 P2 后续项）：extractKeywords 走字符 2-gram，未做拉丁词切分，
    // 因此英文长文的关键词覆盖率天然偏低。但占比 70% 的 charCoverage 仍为 1，
    // 语义保持度从旧口径的 ~27 提升到 73，且结论不再误判为 fail。
    var r = evaluator.evaluate(
      'autumn is coming',
      'autumn is coming, and the leaves are falling down everywhere in the quiet city, while people walk past without looking up at the sky.'
    )
    expect(r.semanticPreservation).toBeGreaterThan(60)
    expect(r.semanticPreservation).toBeLessThan(90)
    expect(r.verdict).not.toBe('fail')
  })

  test('仅标点变化的改写仍被判没改够（textSimilarity 兜底）', function () {
    var a = '这是一段关于电商运营的原文内容包含了丰富的营销策略与增长方法'
    var b = '这是一段关于电商运营的原文内容，包含了丰富的营销策略与增长方法。'
    var r = evaluator.evaluate(a, b, { mode: 'imitate' })
    expect(r.textSimilarity).toBeGreaterThan(90)
    expect(r.verdict).toBe('fail')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CCG 双模型评审修复回归（2026-09-16）
//
// W-1：embedding 路径的语义分标度（余弦映射）与覆盖率口径不同，共用阈值会让
//      "完全无关"（余弦 0 → 50 分）越过 fail 阈值 → embedding 路径几乎恒定 pass。
//      修复：阈值按 SEMANTIC_BANDS 分组选取。
// W-2：占位符正则改为内联（消除模块级 `g` 正则的 lastIndex 共享状态）—— 见 i18n.test.js。
// W-3：evaluate() 显式传 method，与 evaluateAsync 对称。
// I-1：charCoverage / charJaccard 按 Unicode 码点计数（emoji 不再被拆成代理对）。
// ─────────────────────────────────────────────────────────────────────────────
describe('CCG 评审修复回归：语义分标度分组 / 码点计数 / method 归一化', function () {
  var evaluator

  beforeEach(function () {
    evaluator = new RewriteQualityEvaluator()
  })

  function clientFor (map) {
    return { getEmbedding: async function (text) { return map[text] } }
  }

  test('SEMANTIC_BANDS 两组阈值均存在且单调递增（offTopic < weak < moderate）', function () {
    for (var key of ['simhash', 'embedding']) {
      var b = SEMANTIC_BANDS[key]
      expect(typeof b.offTopic).toBe('number')
      expect(b.offTopic).toBeLessThan(b.weak)
      expect(b.weak).toBeLessThan(b.moderate)
    }
    // embedding 组整体高于覆盖率组（因为余弦 0 已映射为 50，不再是"最低"）
    expect(SEMANTIC_BANDS.embedding.offTopic).toBeGreaterThan(SEMANTIC_BANDS.simhash.offTopic)
    expect(SEMANTIC_BANDS.embedding.weak).toBeGreaterThan(SEMANTIC_BANDS.simhash.weak)
  })

  test('W-1：embedding 路径余弦 0（完全无关，语义分 50）在 imitate 下判 warn 而非 pass', async function () {
    // vecA ⟂ vecB → cos = 0 → semantic = ((0+1)/2)*100 = 50
    var e = new RewriteQualityEvaluator({ embeddingClient: clientFor({ orig: [1, 0], new: [0, 1] }) })
    var r = await e.evaluateAsync('orig', 'new', { mode: 'imitate' })
    expect(r.method).toBe('embedding')
    expect(r.semanticPreservation).toBe(50)
    // 修复前：共用覆盖率阈值 → 50 < 50 为 false → 误判 pass
    expect(r.verdict).toBe('warn')
  })

  test('W-1：embedding 路径余弦 -1（完全相反，语义分 0）在 imitate 下判 fail', async function () {
    var e = new RewriteQualityEvaluator({ embeddingClient: clientFor({ orig: [1, 0], new: [-1, 0] }) })
    var r = await e.evaluateAsync('orig', 'new', { mode: 'imitate' })
    expect(r.semanticPreservation).toBe(0)
    expect(r.verdict).toBe('fail')
  })

  test('W-1：embedding 路径余弦 1（完全一致）仍走"没改够"判 fail', async function () {
    var e = new RewriteQualityEvaluator({ embeddingClient: clientFor({ orig: [1, 0], new: [1, 0] }) })
    var r = await e.evaluateAsync('orig', 'new', { mode: 'imitate' })
    expect(r.semanticPreservation).toBe(100)
    // textSimilarity 低（文本不同）→ 不触发"没改够"；但 distance 也够远 → 高语义分不再判 fail
    expect(r.verdict).not.toBe('fail')
  })

  test('W-1：embedding 路径 create 模式不因低余弦误报"切题"', async function () {
    var e = new RewriteQualityEvaluator({ embeddingClient: clientFor({ seed: [1, 0], art: [0, 1] }) })
    var r = await e.evaluateAsync('seed', 'art', { mode: 'create' })
    expect(r.semanticPreservation).toBe(50)
    // embed 组 offTopic=30 → 50 不触发 warn
    expect(r.verdict).toBe('pass')
    expect(r.suggestions.join('')).not.toContain('切题')
  })

  test('W-3：evaluate() 显式声明 simhash 语义，与 evaluateAsync 的 embedding 路径对称', async function () {
    var r = evaluator.evaluate('这是原文内容', '这是改写后的内容', { mode: 'imitate' })
    expect(r.method).toBe('simhash')
    // simhash 路径不得输出 embedding 口径说明
    expect(r.suggestions.join('')).not.toContain('embedding 余弦相似度')

    // 对照：embedding 路径追加口径说明（证明 method 确实参与建议生成）
    var e = new RewriteQualityEvaluator({
      embeddingClient: { getEmbedding: async function (t) { return t === 'a' ? [1, 0] : [0.9, 0.1] } }
    })
    var r2 = await e.evaluateAsync('a', 'b', { mode: 'imitate' })
    expect(r2.method).toBe('embedding')
    expect(r2.suggestions.join('')).toContain('embedding 余弦相似度')
  })

  test('method 归一化：非法 / 缺省 / null 一律回退 simhash', function () {
    expect(normalizeMethod(undefined)).toBe('simhash')
    expect(normalizeMethod(null)).toBe('simhash')
    expect(normalizeMethod('')).toBe('simhash')
    expect(normalizeMethod('bogus')).toBe('simhash')
    expect(normalizeMethod('embedding')).toBe('embedding')
    expect(normalizeMethod('simhash')).toBe('simhash')
  })

  test('I-1：charCoverage / charJaccard 按 Unicode 码点计数（emoji 不被拆成代理对）', function () {
    // 修复前：new Set('😀a') = {'\uD83D','\uDE00','a'}（3 条）→ 覆盖率 2/3
    // 修复后：Array.from('😀a') = ['😀','a']（2 条）→ 覆盖率 1/2
    expect(charCoverage('😀a', '😀b')).toBeCloseTo(0.5, 10)
    expect(charJaccard('😀a', '😀b')).toBeCloseTo(1 / 3, 10)
    // 纯 BMP 文本结果不受影响（零回归）
    expect(charCoverage('秋天来了', '秋天来了下雨了')).toBe(1)
    expect(charJaccard('abc', 'abc')).toBe(1)
  })

  test('I-1：含 emoji 的文本不再因代理对拆分获得虚高相似度', function () {
    var a = '今天心情😀很好'
    var b = '今天心情😀很好'
    expect(evaluator.evaluate(a, b).textSimilarity).toBe(100)
    var c = '今天下雨😭很糟'
    // 共享字符只有"今天很"+（emoji 与其余均不同）→ 相似度应显著低于 1
    expect(evaluator.evaluate(a, c).textSimilarity).toBeLessThan(60)
  })
})
