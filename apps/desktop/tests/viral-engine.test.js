/**
 * ViralEngine — Unit Tests (PRD §9.3 爆款分析)
 *
 * 测试本地 fallback 分析逻辑（orchestrator 不可用时）：
 *   - _extractKeywordsLocal — 中英文关键词提取
 *   - _localAnalyze — 启发式爆款因子分析
 *   - _localGenerate — 模板标题生成
 *   - _localTrending — 趋势聚合
 *
 * 注意：用 __registerMock 替代 vi.mock，与 content-intelligence.test.js 一致
 */
__enableElectronMock()

__registerMock('./logger', {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
})

const ViralEngine = require('../electron/services/viral-engine')

describe('ViralEngine', () => {
  let engine

  beforeEach(() => {
    engine = new ViralEngine()
  })

  describe('构造与接口', () => {
    it('应导出 ViralEngine 类', () => {
      expect(typeof ViralEngine).toBe('function')
    })

    it('实例应有所有核心方法', () => {
      expect(typeof engine.analyze).toBe('function')
      expect(typeof engine.generate).toBe('function')
      expect(typeof engine.trending).toBe('function')
      expect(typeof engine._localAnalyze).toBe('function')
      expect(typeof engine._localGenerate).toBe('function')
      expect(typeof engine._localTrending).toBe('function')
      expect(typeof engine._extractKeywordsLocal).toBe('function')
      expect(typeof engine.registerIpcHandlers).toBe('function')
    })
  })

  describe('_extractKeywordsLocal', () => {
    it('中文文本提取关键词', () => {
      const kws = engine._extractKeywordsLocal('AI工具推荐与实用技巧', 5)
      expect(Array.isArray(kws)).toBe(true)
      expect(kws.length).toBeGreaterThan(0)
    })

    it('英文文本提取关键词', () => {
      const kws = engine._extractKeywordsLocal('machine learning tutorial for beginners', 5)
      expect(kws).toContain('machine')
      expect(kws).toContain('learning')
      expect(kws).toContain('tutorial')
      expect(kws).toContain('beginners')
    })

    it('停用词被过滤', () => {
      const kws = engine._extractKeywordsLocal('the best is here', 5)
      expect(kws).not.toContain('the')
      expect(kws).toContain('best')
      expect(kws).toContain('here')
    })

    it('空输入返回空数组', () => {
      expect(engine._extractKeywordsLocal('', 5)).toEqual([])
      expect(engine._extractKeywordsLocal(null, 5)).toEqual([])
      expect(engine._extractKeywordsLocal(undefined, 5)).toEqual([])
    })
  })

  describe('_localAnalyze', () => {
    it('返回完整分析结构', () => {
      const result = engine._localAnalyze(
        [{ title: 'AI工具推荐', like_count: 1500, comment_count: 120 }],
        'AI工具'
      )
      expect(result.success).toBe(true)
      expect(result.mode).toBe('local-fallback')
      expect(typeof result.overall_score).toBe('number')
      expect(result.overall_score).toBeGreaterThanOrEqual(0)
      expect(result.overall_score).toBeLessThanOrEqual(100)
      expect(result.trend_direction).toBeDefined()
      expect(Array.isArray(result.suggested_angles)).toBe(true)
      expect(Array.isArray(result.factors)).toBe(true)
      expect(result.factors.length).toBe(4)
    })

    it('高互动数据 → rising 趋势', () => {
      const result = engine._localAnalyze(
        [{ title: '爆款内容', like_count: 5000, comment_count: 800 }],
        '爆款'
      )
      expect(result.trend_direction).toBe('rising')
      expect(result.overall_score).toBeGreaterThan(50)
    })

    it('空文章列表不崩溃', () => {
      const result = engine._localAnalyze([], 'test')
      expect(result.success).toBe(true)
      expect(result.overall_score).toBeGreaterThanOrEqual(0)
      expect(result.sample_size).toBe(0)
    })

    it('factors 分数在 0-1 范围内', () => {
      const result = engine._localAnalyze(
        [{ title: '测试标题', like_count: 100, comment_count: 10 }],
        '测试'
      )
      for (const f of result.factors) {
        expect(f.score).toBeGreaterThanOrEqual(0)
        expect(f.score).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('_localGenerate', () => {
    it('titles 任务返回标题数组', () => {
      const result = engine._localGenerate({ topic: 'AI工具', task: 'titles', count: 5 })
      expect(result.success).toBe(true)
      expect(result.mode).toBe('local-fallback')
      expect(result.task).toBe('titles')
      expect(Array.isArray(result.titles)).toBe(true)
      expect(result.titles.length).toBe(5)
      // 标题应包含关键词
      expect(result.titles.some(t => t.includes('AI') || t.includes('工具'))).toBe(true)
    })

    it('hooks 任务返回 hook 数组', () => {
      const result = engine._localGenerate({ topic: 'AI工具', task: 'hooks', count: 3 })
      expect(result.success).toBe(true)
      expect(result.task).toBe('hooks')
      expect(Array.isArray(result.hooks)).toBe(true)
      expect(result.hooks.length).toBe(3)
    })

    it('未知任务返回 fallback 消息', () => {
      const result = engine._localGenerate({ topic: 'AI', task: 'rewrite', count: 3 })
      expect(result.success).toBe(true)
      expect(result.message).toContain('本地 fallback')
    })

    it('空 topic 使用默认关键词', () => {
      const result = engine._localGenerate({ topic: '', task: 'titles', count: 3 })
      expect(result.titles.length).toBe(3)
    })
  })

  describe('_localTrending', () => {
    it('按平台聚合数据', () => {
      const result = engine._localTrending([
        { title: 'a', like_count: 100, comment_count: 10, platform_code: 'douyin' },
        { title: 'b', like_count: 200, comment_count: 20, platform_code: 'douyin' },
        { title: 'c', like_count: 50, comment_count: 5, platform_code: 'xiaohongshu' },
      ])
      expect(result.success).toBe(true)
      expect(result.mode).toBe('local-fallback')
      expect(result.total_articles).toBe(3)
      expect(result.total_likes).toBe(350)
      expect(result.total_comments).toBe(35)
      expect(result.by_platform.length).toBe(2)
      // douyin avg_likes = 150, xiaohongshu avg_likes = 50 → douyin 排前
      expect(result.by_platform[0].platform).toBe('douyin')
      expect(result.by_platform[0].avg_likes).toBe(150)
    })

    it('空列表不崩溃', () => {
      const result = engine._localTrending([])
      expect(result.success).toBe(true)
      expect(result.total_articles).toBe(0)
      expect(result.by_platform).toEqual([])
    })
  })
})
