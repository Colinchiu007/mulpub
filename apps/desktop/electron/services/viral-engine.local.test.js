// @ts-check
/**
 * ViralEngine 本地算法工程化单元测试（PRD-VIRAL-PAGE-FULL-UTILIZATION-2026-09-21, PR-1）
 *
 * 覆盖 Test Plan §11.3：
 * - UT-1 titles 互异性 + {title, structure, emotion, predicted_score} 契约 + 降序（S3/AC4.1/AC4.2）
 * - UT-2 分平台模板分桶（S3）
 * - UT-3 填槽清洗负例：不输出缺主语残句 / 占位符泄漏（T-4，关闭 T3 诊断）
 * - UT-4 打分 fail-open（AC4.3）
 * - UT-5 _localAnalyze 新字段合同（AC2.2，S2）
 * - UT-6 分词降级：extractSync 抛错回落滑窗（T-3）
 * - UT-7 hooks 本地契约（支撑 F1/AC1.1）
 * - UT-9 _localTrending keywords 供热门选题速选（F3/AC3.1 数据面）
 * - 确定性：同 topic 两次生成结果一致（无随机源）
 */
const ViralEngine = require('./viral-engine')

/** 编辑距离（测试内互异性判定用） */
function lev (a, b) {
  const m = a.length; const n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[m][n]
}

describe('ViralEngine 本地算法工程化（PR-1）', () => {
  /** @type {ViralEngine} */
  let engine
  beforeEach(() => { engine = new ViralEngine() })

  describe('UT-1 _localGenerate titles 契约', () => {
    it('同 topic 通用平台生成 5 条：互异（编辑距离≥5）且字段完整', () => {
      const r = engine._localGenerate({ topic: 'AI工具推荐', platform: '通用', task: 'titles', count: 5 })
      expect(r.success).toBe(true)
      expect(r.task).toBe('titles')
      expect(r.data.titles.length).toBe(5)
      const texts = r.data.titles.map(t => t.title)
      expect(new Set(texts).size).toBe(5)
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          expect(lev(texts[i], texts[j])).toBeGreaterThanOrEqual(5)
        }
      }
      for (const t of r.data.titles) {
        expect(typeof t.structure).toBe('string')
        expect(typeof t.emotion).toBe('string')
        expect(Number.isInteger(t.predicted_score)).toBe(true)
        expect(t.predicted_score).toBeGreaterThanOrEqual(0)
        expect(t.predicted_score).toBeLessThanOrEqual(100)
      }
    })

    it('结果按 predicted_score 降序排列（AC4.2）', () => {
      const r = engine._localGenerate({ topic: '城市漫步', platform: '通用', task: 'titles', count: 5 })
      const scores = r.data.titles.map(t => t.predicted_score)
      const sorted = [...scores].sort((a, b) => b - a)
      expect(scores).toEqual(sorted)
    })

    it('同一 topic 两次生成结果一致（确定性，无随机源）', () => {
      const a = engine._localGenerate({ topic: '露营装备', platform: '通用', task: 'titles', count: 5 })
      const b = engine._localGenerate({ topic: '露营装备', platform: '通用', task: 'titles', count: 5 })
      expect(a.data.titles).toEqual(b.data.titles)
    })
  })

  describe('UT-2 分平台模板分桶（T-1）', () => {
    it('同 topic 不同平台产出集合不完全相同', () => {
      const base = { topic: 'AI工具推荐', task: 'titles', count: 5 }
      const gen = engine._localGenerate({ ...base, platform: '通用' })
      const xhs = engine._localGenerate({ ...base, platform: '小红书' })
      const gzh = engine._localGenerate({ ...base, platform: '公众号' })
      const genTexts = gen.data.titles.map(t => t.title)
      const xhsTexts = xhs.data.titles.map(t => t.title)
      const gzhTexts = gzh.data.titles.map(t => t.title)
      expect(xhsTexts).not.toEqual(genTexts)
      expect(gzhTexts).not.toEqual(genTexts)
      expect(xhsTexts).not.toEqual(gzhTexts)
    })
  })

  describe('UT-3 填槽清洗与残句防御（T-4）', () => {
    const nastyTopics = ['!!!', '12345', '———', 'hello', 'a', '   ', '。。。']
    for (const topic of nastyTopics) {
      it(`topic=「${topic}」不产生占位符泄漏/残句`, () => {
        const r = engine._localGenerate({ topic, platform: '通用', task: 'titles', count: 5 })
        expect(r.data.titles.length).toBe(5)
        for (const t of r.data.titles) {
          expect(t.title).not.toMatch(/\$\{/)          // 模板占位符泄漏
          expect(t.title.length).toBeGreaterThanOrEqual(6)
          expect(t.title).not.toMatch(/^[，。、？！：]/)   // 缺主语残句（以标点开头）
          expect(t.title).toMatch(/[\u4e00-\u9fa5a-zA-Z0-9]/) // 至少含实义字符
        }
      })
    }
  })

  describe('UT-4 打分 fail-open（AC4.3）', () => {
    it('_scoreTitleLocal 抛错时生成仍成功，缺分但条数与顺序稳定', () => {
      engine._scoreTitleLocal = () => { throw new Error('scoring boom') }
      const r = engine._localGenerate({ topic: 'AI工具推荐', platform: '通用', task: 'titles', count: 5 })
      expect(r.success).toBe(true)
      expect(r.data.titles.length).toBe(5)
      for (const t of r.data.titles) {
        expect(t.predicted_score).toBeUndefined()
        expect(typeof t.title).toBe('string')
      }
    })
  })

  describe('UT-5 _localAnalyze 新字段合同（F2）', () => {
    it('本地分析返回 rising_keywords / suggested_structures / platform_scores', () => {
      const r = engine._localAnalyze(
        [{ title: 'AI工具推荐合集', like_count: 1500, comment_count: 120 },
         { title: 'AI工具评测避坑', like_count: 800, comment_count: 60 }],
        'AI工具'
      )
      expect(Array.isArray(r.rising_keywords)).toBe(true)
      expect(r.rising_keywords.length).toBeGreaterThan(0)
      for (const k of r.rising_keywords) {
        expect(typeof k.word).toBe('string')
        expect(k.word.length).toBeGreaterThan(0)
      }
      expect(Array.isArray(r.suggested_structures)).toBe(true)
      expect(r.suggested_structures.length).toBeGreaterThanOrEqual(2)
      for (const s of r.suggested_structures) {
        expect(typeof s.structure).toBe('string')
        expect(typeof s.expected_lift).toBe('number')
        expect(Number.isFinite(s.expected_lift)).toBe(true)
      }
      expect(typeof r.platform_scores).toBe('object')
      const vals = Object.values(r.platform_scores)
      expect(vals.length).toBeGreaterThanOrEqual(3)
      for (const v of vals) {
        expect(typeof v).toBe('number')
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      }
    })

    it('空文章列表时新字段仍返回合法形态（不崩溃）', () => {
      const r = engine._localAnalyze([], '测试')
      expect(Array.isArray(r.rising_keywords)).toBe(true)
      expect(Array.isArray(r.suggested_structures)).toBe(true)
      expect(typeof r.platform_scores).toBe('object')
    })
  })

  describe('UT-6 分词降级（T-3）', () => {
    it('外部 extractSync 抛错时回落本地滑窗，结果非空', () => {
      engine._extractKeywordsExternal = () => { throw new Error('module boom') }
      const kws = engine._extractKeywords('新媒体运营方法论分享', 5)
      expect(Array.isArray(kws)).toBe(true)
      expect(kws.length).toBeGreaterThan(0)
    })
    it('外部 extractSync 正常时优先使用外部结果', () => {
      engine._extractKeywordsExternal = () => ['外部词一', '外部词二']
      const kws = engine._extractKeywords('新媒体运营方法论分享', 5)
      expect(kws).toContain('外部词一')
    })
  })

  describe('UT-7 hooks 本地契约（F1 数据面）', () => {
    it('task=hooks 返回 ≥4 条 {hook, technique} 且无占位符泄漏', () => {
      const r = engine._localGenerate({ topic: 'AI工具推荐', platform: '通用', task: 'hooks', count: 5 })
      expect(r.task).toBe('hooks')
      expect(r.data.hooks.length).toBeGreaterThanOrEqual(4)
      for (const h of r.data.hooks) {
        expect(typeof h.hook).toBe('string')
        expect(h.hook.length).toBeGreaterThan(0)
        expect(typeof h.technique).toBe('string')
        expect(h.hook).not.toMatch(/\$\{/)
      }
      const hookTexts = r.data.hooks.map(h => h.hook)
      expect(new Set(hookTexts).size).toBe(hookTexts.length)
    })
  })

  describe('UT-9 _localTrending keywords 输出（F3 数据面）', () => {
    it('聚合文章标题产出 keywords [{word, count}] 按热度降序', () => {
      const r = engine._localTrending([
        { title: 'AI工具推荐第一期', like_count: 100, comment_count: 10, platform_code: 'xiaohongshu' },
        { title: 'AI工具推荐第二期', like_count: 200, comment_count: 20, platform_code: 'xiaohongshu' },
        { title: '露营装备清仓', like_count: 50, comment_count: 5, platform_code: 'douyin' },
      ])
      expect(Array.isArray(r.keywords)).toBe(true)
      expect(r.keywords.length).toBeGreaterThan(0)
      for (const k of r.keywords) {
        expect(typeof k.word).toBe('string')
        expect(typeof k.count).toBe('number')
      }
      const counts = r.keywords.map(k => k.count)
      expect(counts).toEqual([...counts].sort((a, b) => b - a))
    })
    it('空列表时 keywords 为空数组不崩溃', () => {
      const r = engine._localTrending([])
      expect(r.keywords).toEqual([])
    })
  })

  // ── PR-2：T-6 模式卡片驱动模板桶权重 + F6 structure 套用合同 ──
  describe('UT-8 T-6 模式卡片驱动模板桶权重（F6/T-6）', () => {
    it('无 provider（冷启动）时 _patternStructureCounts 返回 {}，产出与 PR-1 基线逐位一致', () => {
      expect(engine._patternStructureCounts()).toEqual({})
      const base = { topic: 'AI工具推荐', platform: '通用', task: 'titles', count: 5 }
      const a = engine._localGenerate(base)
      engine.setPatternProvider(() => ({ items: [] }))
      const b = engine._localGenerate(base)
      expect(b.data.titles).toEqual(a.data.titles)
    })

    it('provider 返回卡片行时按 STRUCTURE_BY_NARRATIVE 聚合计数（未知枚举忽略）', () => {
      engine.setPatternProvider(() => ({
        items: [
          { narrative_structure: 'list' },
          { narrative_structure: 'list' },
          { narrative_structure: 'contrast' },
          { narrative_structure: '不存在的枚举' },
          { narrative_structure: null },
        ],
      }))
      expect(engine._patternStructureCounts()).toEqual({ '数字盘点': 2, '对比评测': 1 })
    })

    it('provider 直接返回数组形态也可聚合', () => {
      engine.setPatternProvider(() => [{ narrative_structure: 'problem_solution' }])
      expect(engine._patternStructureCounts()).toEqual({ '避坑警示': 1 })
    })

    it('provider 抛错时 fail-open 返回 {}（不炸生成主流程）', () => {
      engine.setPatternProvider(() => { throw new Error('db locked') })
      expect(engine._patternStructureCounts()).toEqual({})
      const r = engine._localGenerate({ topic: 'AI工具推荐', platform: '通用', task: 'titles', count: 5 })
      expect(r.success).toBe(true)
      expect(r.data.titles.length).toBe(5)
    })

    it('高表现 structure 模板置顶：首位产出 structure 为被 boost 的结构', () => {
      engine.setPatternProvider(() => ({ items: [{ narrative_structure: 'list', status: 'done' }] }))
      engine._patternStructureCounts = () => ({ '数字盘点': 8 })
      const r = engine._localGenerate({ topic: '城市漫步', platform: '通用', task: 'titles', count: 5 })
      expect(r.data.titles[0].structure).toBe('数字盘点')
      // 非 boost 结构不得排到 boost 结构之前（稳定排序主键为样本量）
      const counts = r.data.titles.map(t => (t.structure === '数字盘点' ? 8 : 0))
      expect(counts).toEqual([...counts].sort((a, b) => b - a))
    })
  })

  describe('F6 structure 套用合同（AC6.2）', () => {
    it('opts.structure=叙事枚举 list → 全部结果 structure 为「数字盘点」', () => {
      const r = engine._localGenerate({ topic: 'AI工具推荐', platform: '通用', task: 'titles', count: 3, structure: 'list' })
      expect(r.data.titles.length).toBeGreaterThanOrEqual(1)
      for (const t of r.data.titles) expect(t.structure).toBe('数字盘点')
    })

    it('opts.structure=中文标签（深度长文）直滤生效，平台桶无该结构时回落全表', () => {
      const r = engine._localGenerate({ topic: '新媒体运营', platform: '小红书', task: 'titles', count: 2, structure: '深度长文' })
      expect(r.data.titles.length).toBeGreaterThanOrEqual(1)
      for (const t of r.data.titles) expect(t.structure).toBe('深度长文')
    })

    it('opts.structure 非法/未知时忽略过滤（fail-open，输出与不带 structure 一致）', () => {
      const base = { topic: 'AI工具推荐', platform: '通用', task: 'titles', count: 5 }
      const withBad = engine._localGenerate({ ...base, structure: '不存在的结构' })
      const without = engine._localGenerate(base)
      expect(withBad.data.titles).toEqual(without.data.titles)
    })

    it('structure 过滤时跳过 pattern boost（单一结构无需再排序）', () => {
      engine._patternStructureCounts = () => ({ '避坑警示': 100 })
      const r = engine._localGenerate({ topic: 'AI工具推荐', platform: '通用', task: 'titles', count: 3, structure: 'list' })
      for (const t of r.data.titles) expect(t.structure).toBe('数字盘点')
    })
  })
})
