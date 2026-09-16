// @ts-check
/**
 * ViralEngine.scoreText 单元测试（viral-rewrite-integration）
 *
 * 覆盖：
 * - orchestrator 成功路径：透传 score/mode
 * - orchestrator 失败：回退本地启发式（mode=local-fallback）
 * - 分数越界：clamp 到 0-100
 * - 非法分数（NaN）：回退本地
 * - 空/非字符串输入：返回 null
 * - 独立短超时（8s）：不拖慢改写主流程（双模型评审 W-1）
 */
const ViralEngine = require('./viral-engine')

describe('ViralEngine.scoreText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function wireEngine(callApiMock) {
    const engine = new ViralEngine()
    engine._callApi = callApiMock
    return engine
  }

  it('orchestrator success passes through score and mode', async () => {
    const engine = wireEngine(vi.fn().mockResolvedValue({ code: 0, data: { overall_score: 66.6, mode: 'orchestrator' } }))
    const r = await engine.scoreText('一篇关于 AI 工具的文章')
    expect(r).toEqual({ score: 66.6, mode: 'orchestrator' })
    expect(engine._callApi).toHaveBeenCalledWith(
      'post',
      '/api/viral/analyze',
      expect.objectContaining({ articles: expect.any(Array), topic: '' }),
      8000,
    )
  })

  it('orchestrator failure falls back to local heuristic', async () => {
    const engine = wireEngine(vi.fn().mockResolvedValue({ code: -1, message: 'conn refused' }))
    const r = await engine.scoreText('一篇关于 AI 工具的文章')
    expect(r.mode).toBe('local-fallback')
    expect(typeof r.score).toBe('number')
    expect(Number.isFinite(r.score)).toBe(true)
  })

  it('out-of-range score is clamped to 0-100', async () => {
    const engine = wireEngine(vi.fn().mockResolvedValue({ code: 0, data: { overall_score: 250 } }))
    const r = await engine.scoreText('文本')
    expect(r.score).toBe(100)
  })

  it('NaN score falls back to local', async () => {
    const engine = wireEngine(vi.fn().mockResolvedValue({ code: 0, data: { overall_score: NaN } }))
    const r = await engine.scoreText('文本')
    expect(r.mode).toBe('local-fallback')
  })

  it('null/empty/whitespace/non-string input returns null', async () => {
    const engine = wireEngine(vi.fn())
    expect(await engine.scoreText('')).toBeNull()
    expect(await engine.scoreText('   ')).toBeNull()
    expect(await engine.scoreText(null)).toBeNull()
    expect(await engine.scoreText(42)).toBeNull()
    expect(engine._callApi).not.toHaveBeenCalled()
  })

  it('uses short 8s timeout independent of analyze (review W-1)', async () => {
    const engine = wireEngine(vi.fn().mockResolvedValue({ code: 0, data: { overall_score: 50 } }))
    await engine.scoreText('文本')
    const timeoutArg = engine._callApi.mock.calls[0][3]
    expect(timeoutArg).toBe(8000)
  })
})
