/**
 * KnowledgeContextBuilder — 三层知识库 Prompt 构建器
 *
 * 组合用户偏好知识库（v2 Ebbinghaus + RRF）+ 爆款库 + 个人知识库，
 * 生成结构化的 {knowledgeContext} 注入改写 Prompt。
 *
 * P0 检索修复（2026-09-12）：buildFullContext 变更为 async。查询文本先经
 * keyword-extractor 规则提取关键词；产出为 0 个时触发 llmKeywords 兜底（阈值 >= 1 跳过 LLM）。
 * 检索接口（viralLibrary.search / personalKnowledgeBase.search）契约：
 * 接受关键词拼接字符串，返回条目数组（store 层内部再做关键词化检索）。
 */
const { extractSync } = require('./keyword-extractor')

class KnowledgeContextBuilder {
  /**
   * @param {object} opts
   * @param {object} opts.knowledgeBase - 原有用户偏好知识库（提供 getContextSummary()）
   * @param {object} [opts.viralLibrary] - 爆款库（提供 search(query, limit): Array）
   * @param {object} [opts.personalKnowledgeBase] - 个人知识库（提供 search(query, limit): Array）
   * @param {function} [opts.llmKeywords] - async (text, topN) => string[] LLM 关键词兜底
   * @param {object} [opts.patternCards] - 模式卡片（提供 get(viralItemId): card|null）
   */
  constructor(opts = {}) {
    this._kb = opts.knowledgeBase || null
    this._viral = opts.viralLibrary || null
    this._personal = opts.personalKnowledgeBase || null
    this._llmKeywords = opts.llmKeywords || null
    this._patternCards = opts.patternCards || null
    // P2 反馈闭环：记录本次 buildFullContext 检索命中的知识条目（table + id），
    // 供改写引擎在用户采纳/拒绝时驱动 feedbackBoost 置信度更新。
    this._touchedItems = []
  }

  /**
   * 构建三层融合上下文
   * @param {string} userContent - 用户输入的原文
   * @param {object} [options]
   * @param {boolean} [options.useViralLibrary] - 是否结合爆款库
   * @param {boolean} [options.usePersonalKnowledge] - 是否结合个人经历
   * @returns {Promise<string>} 合并后的 knowledgeContext
   */
  async buildFullContext(userContent, options = {}) {
    const parts = []
    // 每次构建前清空 touched 记录，避免跨调用累积
    this._touchedItems = []

    // 第1层：原有用户偏好（始终注入）
    if (this._kb) parts.push(this._kb.getContextSummary())

    // 关键词只解析一次，两层共享（审查 W-50：避免双重 extractSync/LLM 兜底）
    let resolvedKeywords = null
    const resolveKeywordsOnce = async () => {
      if (resolvedKeywords === null) resolvedKeywords = await this._resolveKeywords(userContent)
      return resolvedKeywords
    }

    // 第2层：爆款风格参考
    if (options.useViralLibrary && this._viral) {
      // 关键词提取在开关守卫之后：未勾选任何知识库时零 LLM 调用、零分词开销
      const vc = this.buildViralContext(await resolveKeywordsOnce())
      if (vc) parts.push(vc)
    }

    // 第3层：个人素材参考
    if (options.usePersonalKnowledge && this._personal) {
      const pc = this.buildPersonalContext(await resolveKeywordsOnce())
      if (pc) parts.push(pc)
    }

    return parts.filter(Boolean).join('\n\n')
  }

  /**
   * 关键词解析：规则提取 >= 1 个直接用；否则 LLM 兜底（可选注入）；
   * LLM 失败/未注入返回规则结果（可能为空数组，此时检索自然为空）。
   * @param {string} userContent
   * @returns {Promise<string[]>}
   */
  async _resolveKeywords(userContent) {
    const ruleKeywords = extractSync(userContent, 8)
    if (ruleKeywords.length >= 1) return ruleKeywords
    if (this._llmKeywords && typeof this._llmKeywords === 'function') {
      try {
        const llmKw = await this._llmKeywords(userContent, 8)
        if (Array.isArray(llmKw) && llmKw.length > 0) return llmKw
      } catch { /* LLM 兜底失败静默降级为规则结果 */ }
    }
    return ruleKeywords
  }

  /**
   * 获取本次 buildFullContext 检索命中的知识条目引用
   * @returns {Array<{table: string, id: string}>}
   */
  getTouchedItems() {
    return this._touchedItems.slice()
  }

  _recordTouched(table, items) {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (item && item.id) {
        this._touchedItems.push({ table, id: String(item.id) })
      }
    }
  }

  /**
   * 构建爆款风格分析 Prompt Block
   * 从 Top 3 爆款内容中提取：标题模式、开头钩子、高频标签
   * @param {string[]} keywords - 检索关键词数组
   */
  buildViralContext(keywords) {
    if (!this._viral) return ''
    // 关键词数组直传（store 层支持数组契约，避免 join 后被二次分词稀释——LLM 兜底场景关键）
    const query = Array.isArray(keywords) ? keywords : (keywords ? [String(keywords)] : [])
    const items = this._viral.search(query, 3)
    if (!items || !Array.isArray(items) || items.length === 0) return ''
    this._recordTouched('viral_library', items)

    // P1 模式卡片：收集 done 状态卡片 + item→lift 映射（P2-b 排序用）
    const cards = []
    const liftByItem = new Map()
    if (this._patternCards && typeof this._patternCards.get === 'function') {
      for (const item of items) {
        if (!item || !item.id) continue
        try {
          const card = this._patternCards.get(item.id)
          if (card && card.status === 'done') {
            cards.push(card)
            const l = Number(card.expected_lift)
            liftByItem.set(String(item.id), Number.isFinite(l) ? l : null)
          }
        } catch { /* 卡片读取失败视为缺失 */ }
      }
    }

    // P2-b：带 done 卡片的条目按 expected_lift 降序优先采样，NULL lift / 无卡片项不丢弃、排后
    const orderedItems = this._orderItemsByLift(items, liftByItem)
    const orderedCards = this._orderCardsByLift(cards)

    // 有卡片时输出聚合风格指导；无卡片（或全部缺失/failed）回退浅层特征
    if (orderedCards.length > 0) {
      const patternBlock = this._buildPatternGuidance(orderedCards, orderedItems.length)
      // 卡片全字段为空时指导块无实际内容——回退浅层（审查 W-3）
      if (!patternBlock) return this._buildShallowViral(orderedItems)
      const shallowBlock = this._buildShallowViral(orderedItems)
      return patternBlock + (shallowBlock ? '\n' + shallowBlock : '')
    }
    return this._buildShallowViral(orderedItems)
  }

  /**
   * P2-b：按 done 卡片 expected_lift 降序重排爆款条目（AC-P2-4）。
   * 排序键依次：有 done 卡片 > 无卡片；lift 已知 > lift 为 NULL；lift 值降序；原始下标稳定。
   * 无卡片 / NULL lift 一律保留（不丢弃），仅排到最后。
   * @param {Array} items - 检索命中的爆款条目
   * @param {Map<string, number|null>} liftByItem - item.id → 有限 lift 或 null（NULL lift）
   * @returns {Array} 重排后的条目（长度与入参一致）
   */
  _orderItemsByLift(items, liftByItem) {
    return items
      .map((item, idx) => {
        const key = item && item.id ? String(item.id) : null
        const has = key !== null && liftByItem.has(key)
        const raw = has ? liftByItem.get(key) : null
        const known = raw !== null && raw !== undefined
        return { item: item, idx: idx, hasCard: has ? 1 : 0, known: known ? 1 : 0, lift: known ? raw : 0 }
      })
      .sort(function (a, b) { return (b.hasCard - a.hasCard) || (b.known - a.known) || (b.lift - a.lift) || (a.idx - b.idx) })
      .map(function (x) { return x.item })
  }

  /**
   * P2-b：模式卡片按 expected_lift 降序（NULL 排后、原序稳定），使聚合指导的「首个标题公式/钩子原理」取最高 lift 卡片。
   * @param {Array} cards - done 状态卡片
   * @returns {Array} 重排后的卡片
   */
  _orderCardsByLift(cards) {
    return cards
      .map(function (c, i) {
        const l = Number(c && c.expected_lift)
        const known = Number.isFinite(l)
        return { c: c, i: i, known: known ? 1 : 0, lift: known ? l : 0 }
      })
      .sort(function (a, b) { return (b.known - a.known) || (b.lift - a.lift) || (a.i - b.i) })
      .map(function (x) { return x.c })
  }

  /**
   * 聚合模式卡片为「本次风格指导」（Q10=B：聚合视图注入，非原始数据罗列）
   * @param {Array} cards - done 状态的模式卡片
   * @param {number} totalItems - 本次检索命中的爆款总数（用于「N 条中 M 条采用」表述）
   */
  _buildPatternGuidance(cards, totalItems) {
    const HOOK_LABELS = {
      suspense: '悬念式', conflict: '冲突式', counterintuitive: '反常识', question: '提问式',
      story: '故事式', data: '数据式', empathy: '共情式', other: '其他',
    }
    const CURVE_LABELS = {
      rise: '逐步升温', fall: '逐步下沉', rise_fall: '先扬后抑', fall_rise: '先抑后扬',
      wave: '波浪起伏', flat: '平铺直叙',
    }
    const NARRATIVE_LABELS = {
      total_subtotal: '总分总', problem_solution: '问题-方案', chronological: '时间线',
      contrast: '对比', list: '清单', story_lesson: '故事+道理',
    }
    const CTA_LABELS = {
      question: '提问式互动', challenge: '挑战式', resource: '资源引导', follow: '关注引导',
      comment: '评论引导', none: '无 CTA',
    }

    function tally(field) {
      const freq = {}
      for (const c of cards) {
        const v = c[field]
        if (v) freq[v] = (freq[v] || 0) + 1
      }
      return Object.entries(freq).sort((a, b) => b[1] - a[1])
    }
    function topLabel(field, labels) {
      const ranked = tally(field)
      if (ranked.length === 0) return ''
      const [value, count] = ranked[0]
      const label = labels[value] || value
      return label + '（' + count + '/' + totalItems + ' 条采用）'
    }

    // 预检：所有卡片的所有维度字段均为空 → 返回空串触发上层回退（审查 W-3）
    const hasAnyField = cards.some(c =>
      c.hook_type || c.emotion_curve || c.narrative_structure || c.cta_style
      || (Array.isArray(c.golden_quotes) && c.golden_quotes.length > 0)
    )
    if (!hasAnyField) return ''

    let block = '## 爆款风格指导（基于 ' + totalItems + ' 条同主题爆款模式分析）\n'
    block += '请按以下被验证有效的表达模式进行改写（学习模式，不复制具体内容）：\n\n'

    const hook = topLabel('hook_type', HOOK_LABELS)
    if (hook) {
      block += '- 开头钩子：优先「' + hook + '」'
      const formulas = cards.map(c => c.title_formula).filter(f => f && /\{[^}]+\}/.test(f))
      if (formulas.length > 0) block += '——标题公式参考「' + formulas[0] + '」'
      const analyses = cards.map(c => c.hook_analysis).filter(a => a)
      if (analyses.length > 0) block += '\n  钩子原理：' + analyses[0]
      block += '\n'
    }

    const curve = topLabel('emotion_curve', CURVE_LABELS)
    if (curve) block += '- 情绪曲线：建议「' + curve + '」\n'

    const narrative = topLabel('narrative_structure', NARRATIVE_LABELS)
    if (narrative) block += '- 叙事结构：建议「' + narrative + '」\n'

    const cta = topLabel('cta_style', CTA_LABELS)
    if (cta) block += '- CTA：建议「' + cta + '」\n'

    const quotes = []
    for (const c of cards) {
      if (Array.isArray(c.golden_quotes)) quotes.push(...c.golden_quotes)
    }
    if (quotes.length > 0) {
      block += '- 金句风格参考（学习句式，不复制）：' + quotes.slice(0, 3).map(q => '「' + q + '」').join(' ') + '\n'
    }

    return block
  }

  /**
   * 浅层特征块（原 P0 行为：标题模式 + 开头钩子 + 标签）
   */
  _buildShallowViral(items) {
    if (!items || items.length === 0) return ''
    const titlePatterns = []
    const hookPatterns = []
    const allTags = {}

    for (const item of items) {
      // 标题模式
      const title = (item && item.title) || ''
      if (title) {
        const len = title.length
        const hasQuestion = /[？?]/.test(title)
        const hasExclamation = /[！!]/.test(title)
        const hasDigit = /\d/.test(title)
        let pattern = '标题：' + title.slice(0, 80)
        if (title.length > 80) pattern += '...'
        const features = []
        if (len >= 15 && len <= 35) features.push('15-35字（最佳长度）')
        if (hasQuestion) features.push('含问句')
        if (hasExclamation) features.push('含感叹')
        if (hasDigit) features.push('含数字')
        if (features.length) pattern += ' [' + features.join('、') + ']'
        titlePatterns.push(pattern)
      }

      // 开头钩子（前100字）
      const content = (item && item.content) || ''
      if (content) {
        const first100 = content.slice(0, 100).replace(/[\n\r]+/g, ' ').trim()
        if (first100.length > 20) hookPatterns.push(first100 + (content.length > 100 ? '...' : ''))
      }

      // 收集标签
      let tags = (item && item.tags) || []
      if (typeof tags === 'string') {
        try { tags = JSON.parse(tags) } catch { tags = [tags] }
      }
      if (Array.isArray(tags)) {
        for (const t of tags) {
          if (typeof t === 'string' && t.trim()) {
            const key = t.trim().toLowerCase()
            allTags[key] = (allTags[key] || 0) + 1
          }
        }
      }
    }

    const sortedTags = Object.entries(allTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => '#' + k)

    let block = '## 爆款风格参考\n'
    block += '请参考以下爆款内容的风格特征进行改写（参考风格模式，不是复制具体内容）：\n\n'

    if (titlePatterns.length) {
      block += '### 标题模式\n'
      block += titlePatterns.map((p, i) => (i + 1) + '. ' + p).join('\n') + '\n\n'
    }

    if (hookPatterns.length) {
      block += '### 开头钩子参考\n'
      block += hookPatterns.map((p, i) => (i + 1) + '. ' + p).join('\n') + '\n\n'
    }

    if (sortedTags.length) {
      block += '### 热门话题\n' + sortedTags.join(' ') + '\n'
    }

    return block
  }

  /**
   * 构建个人素材 Prompt Block
   * 按类别作用类型分4组：约束型 / 素材型 / 立场型 / 权威型
   * @param {string[]} keywords - 检索关键词数组
   */
  buildPersonalContext(keywords) {
    if (!this._personal) return ''
    const query = Array.isArray(keywords) ? keywords : (keywords ? [String(keywords)] : [])
    const items = this._personal.search(query, 5)
    if (!items || !Array.isArray(items) || items.length === 0) return ''
    this._recordTouched('personal_knowledge', items)

    const groups = {
      constraint: [],
      material: [],
      stance: [],
      authority: [],
    }

    const CATEGORY_MAP = {
      personal_ip_persona: 'constraint',
      personal_background: 'material',
      personal_stories: 'material',
      growth_experience: 'material',
      emotional_experience: 'material',
      work_experience: 'authority',
      project_experience: 'authority',
      personal_opinions: 'stance',
      family_stories: 'material',
    }

    for (const item of items) {
      const cat = (item && item.category) || ''
      const group = CATEGORY_MAP[cat] || 'material'
      if (item && item.content) {
        groups[group].push(item.content)
      }
    }

    let block = '## 个人素材参考\n'
    let hasContent = false
    let hasHardConstraint = false

    if (groups.constraint.length) {
      block += '### 人设一致性约束\n改写结果必须符合以下人设特征：\n'
      block += groups.constraint.map(c => '- ' + c).join('\n') + '\n\n'
      hasContent = true
      hasHardConstraint = true
    }

    if (groups.stance.length) {
      block += '### 观点立场\n改写不能违背以下已有观点：\n'
      block += groups.stance.map(s => '- ' + s).join('\n') + '\n\n'
      hasContent = true
      hasHardConstraint = true
    }

    if (groups.authority.length) {
      block += '### 专业背景\n你可以用以下专业背景来提升文章可信度：\n'
      block += groups.authority.map(a => '- ' + a).join('\n') + '\n\n'
      hasContent = true
    }

    if (groups.material.length) {
      block += '### 可引用素材\n以下真实经历可作为改写中的素材引用：\n'
      block += groups.material.map(m => '- ' + m).join('\n') + '\n\n'
      hasContent = true
    }

    if (!hasContent) return ''

    if (hasHardConstraint) {
      block += '⚠️ 重要：以上“人设一致性约束”和“观点立场”必须遵守，不能违背。“专业背景”和“可引用素材”可以灵活运用。\n'
    }

    return block
  }
}

module.exports = { KnowledgeContextBuilder }

