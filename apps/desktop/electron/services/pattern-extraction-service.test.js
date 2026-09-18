// @ts-check
/**
 * PatternExtractionService 单元测试
 *
 * 覆盖：
 * - LLM 正常提取路径（原行为回归）
 * - LLM 失败 2 次 → 本地规则预填兜底（P1-D：卡片不再进 failed 终态）
 * - 本地规则分类正确性（hook/cta/emotion/narrative/title_formula）
 * - attempts < 2 时不预填
 * - 源内容缺失 → failed（原行为回归）
 */
const PatternExtractionService = require('./pattern-extraction-service')

function makeFakeStore(cards) {
  // cards: { [viralItemId]: card }
  const store = {
    _cards: cards,
    updates: [],
    listPendingPatternCards() {
      return Object.values(cards).filter(c => c.status === 'pending')
    },
    getViralItem(id) {
      const card = cards[id]
      return card ? { title: card._title || '', platform: 'douyin', content: card._content || '' } : null
    },
    getPatternCard(id) {
      return cards[id] || null
    },
    updatePatternCard(id, updates) {
      store.updates.push({ id, updates })
      Object.assign(cards[id], updates)
      return true
    },
    recordPatternAttempt(id, msg) {
      const card = cards[id]
      if (!card) return false
      card.attempts = (Number(card.attempts) || 0) + 1
      if (card.attempts >= 3) card.status = 'failed'
      card.last_error = msg || ''
      return true
    },
  }
  return store
}

function makeFailingLlm() {
  return { generateWithDefault: vi.fn(async () => { throw new Error('provider down') }) }
}

function makeGoodLlm(payload) {
  return {
    generateWithDefault: vi.fn(async () => ({
      content: JSON.stringify(payload),
    })),
  }
}

const GOOD_PAYLOAD = {
  hook_type: 'suspense',
  hook_analysis: '开头设置悬念',
  emotion_curve: 'wave',
  narrative_structure: 'total_subtotal',
  cta_style: 'comment',
  golden_quotes: ['金句一'],
  title_formula: '{年龄}岁那年我明白了{道理}',
}

describe('PatternExtractionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('LLM 正常路径：提取成功 → done + 字段写入（回归）', async () => {
    const cards = {
      v1: { viral_item_id: 'v1', status: 'pending', attempts: 0, _title: '标题A', _content: '正文内容' },
    }
    const store = makeFakeStore(cards)
    const svc = new PatternExtractionService({ store, aiGenerator: makeGoodLlm(GOOD_PAYLOAD) })
    await svc.processQueue()
    expect(cards.v1.status).toBe('done')
    expect(cards.v1.hook_type).toBe('suspense')
    expect(cards.v1.title_formula).toContain('{年龄}')
    expect(cards.v1.golden_quotes).toEqual(['金句一'])
    expect(store.updates.some(u => u.updates.hook_analysis === '开头设置悬念')).toBe(true)
  })

  it('P1-D：LLM 失败 2 次 → 本地规则预填 status=done（不进 failed 终态）', async () => {
    const cards = {
      v1: { viral_item_id: 'v1', status: 'pending', attempts: 1, _title: '为什么越来越多的人开始跑步？', _content: '聊聊跑步这件事。\n但是坚持很难。\n总之，跑起来就对了。' },
    }
    const store = makeFakeStore(cards)
    const svc = new PatternExtractionService({ store, aiGenerator: makeFailingLlm() })
    await svc.processQueue()
    // 第 2 次失败 → attempts=2 → 预填
    expect(cards.v1.status).toBe('done')
    expect(cards.v1.last_error).toContain('local-rules prefill')
    expect(cards.v1.hook_type).toBe('question')
    expect(cards.v1.hook_analysis).toContain('本地规则预填')
    expect(cards.v1.title_formula.length).toBeGreaterThan(0)
    // 预填后卡片不再是 pending，LLM 不会再重试
    expect(store.listPendingPatternCards().length).toBe(0)
  })

  it('P1-D：attempts=1（首次失败）不预填，留给 LLM 重试', async () => {
    const cards = {
      v1: { viral_item_id: 'v1', status: 'pending', attempts: 0, _title: '任意标题', _content: '正文' },
    }
    const store = makeFakeStore(cards)
    const svc = new PatternExtractionService({ store, aiGenerator: makeFailingLlm() })
    await svc.processQueue()
    expect(cards.v1.attempts).toBe(1)
    expect(cards.v1.status).toBe('pending')
  })

  it('本地规则：问号标题 → question；数字标题 → data；反常识词 → counterintuitive', async () => {
    const svc = new PatternExtractionService({ store: makeFakeStore({}), aiGenerator: makeFailingLlm() })
    expect(svc._localClassify({ title: '为什么年轻人都不结婚？', content: '讨论' }).hook_type).toBe('question')
    expect(svc._localClassify({ title: '30 岁存了 100 万', content: '理财心得分享' }).hook_type).toBe('data')
    expect(svc._localClassify({ title: '万万没想到真相竟然是这样', content: '展开讲讲' }).hook_type).toBe('counterintuitive')
  })

  it('本地规则：尾部 CTA 信号 → comment/follow/resource；无信号 → 空（不稀释聚合统计）', () => {
    const svc = new PatternExtractionService({ store: makeFakeStore({}), aiGenerator: makeFailingLlm() })
    expect(svc._localClassify({ title: 'T', content: '正文。评论区告诉我你的看法' }).cta_style).toBe('comment')
    expect(svc._localClassify({ title: 'T', content: '正文。喜欢的话点个关注' }).cta_style).toBe('follow')
    expect(svc._localClassify({ title: 'T', content: '纯正文，没有任何行动号召' }).cta_style).toBe('')
  })

  it('本地规则：title_formula 数字占位符化；无占位符回退原标题', () => {
    const svc = new PatternExtractionService({ store: makeFakeStore({}), aiGenerator: makeFailingLlm() })
    expect(svc._localClassify({ title: '30 岁存了 100 万', content: 'x' }).title_formula).toContain('{N}')
    // 评审 I-1：单位保留（「个月」不被「个」截胡）
    expect(svc._localClassify({ title: '3个月涨了30万粉', content: 'x' }).title_formula).toContain('{N}个月')
    const noNum = svc._localClassify({ title: '纯文字标题没有数字', content: 'x' })
    expect(noNum.title_formula).toBe('纯文字标题没有数字')
  })

  it('源内容缺失 → failed 终态（原行为回归）', async () => {
    const cards = {
      v1: { viral_item_id: 'v1', status: 'pending', attempts: 0, _title: '', _content: '' },
    }
    const store = makeFakeStore(cards)
    // getViralItem 模拟源已删除
    store.getViralItem = () => null
    const svc = new PatternExtractionService({ store, aiGenerator: makeGoodLlm(GOOD_PAYLOAD) })
    await svc.processQueue()
    expect(cards.v1.status).toBe('failed')
    expect(cards.v1.last_error).toBe('source content missing')
  })
})
