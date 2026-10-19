/**
 * Strategy Matcher — 策略自动匹配算法
 *
 * 根据用户设置（行业、目的、平台、风格）和历史评分，
 * 为所有启用的策略打分，返回 Top N 推荐。
 */

/**
 * 无有效信号时的保真型兜底策略 id。
 *
 * ⚠ CCG 深度审查 i4：原先写死在 _heuristicScore 内部，与「策略 id」这一 ops 可运营数据
 * 硬耦合 —— ops 侧新增/改名/重排策略会静默改变默认选中，桌面端不可见。
 * 现提升为模块常量并允许调用方注入（options.fidelityStrategyIds），
 * 使耦合显式、可测、可配置；默认值与历史行为一致。
 */
const DEFAULT_FIDELITY_STRATEGY_IDS = ['strategy-knowledge-dry']

/**
 * 保真优先的内容判定阈值（码点）。≥ 此长度视为成稿型长文，默认走保真策略。
 */
const FIDELITY_MIN_LENGTH = 600

/**
 * 信息密度特征：命中任一即视为「事实/数据密集型」，保真优先。
 * 覆盖技术评测、参数规模、代码片段、百分比与基准名等客观事实载体。
 */
const INFO_DENSITY_PATTERNS = [
  /SWE-bench|MMLU|HumanEval|GSM8K|AIME|GPQA|MATH\b|LiveCodeBench/i,
  /\d+(\.\d+)?\s*B\s*(参数|params|Param)/i,
  /\bfunction\s*\(|=>|const\s+\w+\s*=|def\s+\w+\s*\(|class\s+\w+/,
  /\d+(\.\d+)?\s*%/,
  /\d{3,}/,
]

class StrategyMatcher {
  /**
   * @param {object} options
   * @param {object} options.userSettings - { industry, purpose, platform, tone }
   * @param {object} options.userHistory - { preferredStrategies, strategyRatings }
   * @param {number} options.topN - 返回 Top N 推荐，默认 3
   * @param {string} [options.content] - 待改写原文（无有效信号时驱动内容特征启发式兜底）
   * @param {string[]} [options.fidelityStrategyIds] - 保真型兜底策略 id（默认 DEFAULT_FIDELITY_STRATEGY_IDS）
   */
  constructor(options = {}) {
    this._userSettings = options.userSettings || {}
    this._userHistory = options.userHistory || {}
    this._topN = options.topN || 3
    this._content = typeof options.content === 'string' ? options.content : ''
    this._fidelityIds = Array.isArray(options.fidelityStrategyIds) && options.fidelityStrategyIds.length > 0
      ? options.fidelityStrategyIds
      : DEFAULT_FIDELITY_STRATEGY_IDS
  }

  /**
   * 计算所有策略的匹配分数并排序
   * @param {Array} strategies
   * @returns {Array} 排序后的策略数组，每项附加 score 字段
   */
  rank(strategies) {
    if (!Array.isArray(strategies) || strategies.length === 0) return []

    // 预计算：用户给出的任一设置值是否命中过至少一个候选策略。
    // 这是启发式资格判定（_isFidelityEligible）的全局事实，逐策略算不出来。
    this._signalHitAny = this._computeSignalHitAny(strategies)

    const scored = strategies.map(s => ({
      ...s,
      score: this._score(s),
      // 真命中维度数：用于有信号组的并列破平（命中越多越贴合用户明确意图）
      _hits: this._hits(s),
      // 无有效信号兜底（rewrite-default-strategy-fix，2026-10-19）：
      // 启发式建议分单独携带，不并入 score —— score 仍严格是「用户设置维度匹配分」，
      // 语义单一可测；启发式只在并列破平时被读取。
      _heuristic: this._heuristicScore(s),
      // 平台专精度：仅当用户点名平台且本策略支持它时 >0（见 _specificity）
      _specificity: this._specificity(s)
    }))

    // 三级排序：① 用户设置维度分；② 内容特征启发式；③ id 字典序（确定性兜底）。
    //
    // ⚠ 第 ③ 级**只在无信号组启用**（CCG 深度审查 i1，Critical）：
    //   若对所有并列一律按 id 排序，platform=wechat_mp 下五策略并列 44 分时会恒选
    //   strategy-douyin-viral（d 在 k/v/x 之前）⇒ 公众号场景选到抖音爆款策略。
    //   那是用「确定性」换掉了「正确性」，比修复前的数组首项更荒谬 —— 原本的缺陷
    //   正是「用户信号被静默覆盖」，不能换个姿势重犯。
    //
    // ⚠ 第 ③ 级**只在无信号组启用**（CCG 深度审查 i1，Critical）：
    //   若对所有并列一律按 id 排序，platform=wechat_mp 下五策略并列 44 分时会恒选
    //   strategy-douyin-viral（d 在 k/v/x 之前）⇒ 公众号场景选到抖音爆款策略。
    //   那是用「确定性」换掉了「正确性」，比修复前的数组首项更荒谬 —— 原本的缺陷
    //   正是「用户信号被静默覆盖」，不能换个姿势重犯。
    //
    // ⚠ 但「不动」也不够（i1 修复后的自评发现）：有信号组并列时若保持原顺序，
    //   platform=douyin 会拿到数组首项 storytelling 而不是真正命中抖音的
    //   strategy-douyin-viral —— 同样是用户信号被覆盖，只是换了掩盖方式。
    //   故有信号组用 **_hits（真命中维度数）** 破平：命中维度越多越贴合用户意图。
    //   这不用内容特征（那是无信号时的兜底），只用「用户给了几个信号、命中几个」。
    // ⚠ 第 ④ 级（自评发现，i1 修复后）：前三级仍可能全并列 ——
    //   实测 platform=douyin 时 storytelling / ecommerce / douyin-viral **都声明支持
    //   douyin**，三条同为 44 分、hits 同为 1，无法区分。
    //   此时按**平台专精度**破平：声明平台越少越专注该平台（douyin-viral 只声明 douyin，
    //   而 storytelling 声明了三个平台）。专精策略才该在用户点名某平台时胜出。
    //   无平台信号时该项为 0，不影响其它场景。
    // 第 ⑤ 级 id 字典序：在「无信号组」与「有信号但零命中组」（CCG 二轮 i2）启用 ——
    //   这两类都是「匹配器未产生有效区分」的场景，必须有确定性次序且不得依赖数组顺序。
    //   用户信号已真正命中的组（_signalHitAny=true）保持稳定排序：
    //   此时并列是用户意图导致，继续补充维度是用户的事，替他猜反而覆盖意图（i1）。
    const idTiebreakAllowed = !this._signalHitAny
    scored.sort((a, b) => (
      (b.score - a.score) ||
      (b._hits - a._hits) ||
      (b._heuristic - a._heuristic) ||
      (b._specificity - a._specificity) ||
      (idTiebreakAllowed ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : 0)
    ))
    return scored.map(({ _heuristic, _hits, _specificity, ...rest }) => rest)
  }

  /**
   * 用户给出的任一设置值是否命中过至少一个候选策略。
   *
   * 「零命中」的判定域是**四个设置维 × 全部候选**：任一维的值在任何候选的
   * 对应声明列表里出现过，就算有命中。全 0 才是零命中。
   * @param {Array} strategies - 本轮候选（rank() 的入参）
   * @returns {boolean} true=至少一维命中过；false=有信号但全零命中；无信号也为 false
   */
  _computeSignalHitAny(strategies) {
    const s = this._userSettings || {}
    const dims = [
      { value: s.industry, key: 'industry' },
      { value: s.purpose, key: 'purpose' },
      { value: s.platform, key: 'platforms' },
      { value: s.tone, key: 'tone' },
    ]
    for (let i = 0; i < dims.length; i++) {
      const v = dims[i].value
      if (typeof v !== 'string' || !v.trim()) continue
      for (let j = 0; j < strategies.length; j++) {
        const declared = strategies[j][dims[i].key] || []
        if (this._dimensionHit(v, declared)) return true
      }
    }
    return false
  }

  /**
   * 平台专精度：用户点名了平台、且该策略声明支持它时，声明的平台数越少分越高。
   *
   * 为什么需要：内置策略的平台声明高度重叠（storytelling 与 ecommerce 都声明
   * douyin/xiaohongshu/wechat_mp 三个平台，与只声明 douyin 的 douyin-viral 同为 hits=1），
   * 靠 hits 分不开。「专注该平台」正是用户点名平台时想表达的意思。
   *
   * @param {object} strategy
   * @returns {number} 0 表示无平台信号或不命中；否则为 1/声明平台数（越大越专精）
   */
  _specificity(strategy) {
    const want = this._userSettings && this._userSettings.platform
    if (!want) return 0
    const platforms = strategy.platforms || []
    if (platforms.length === 0) return 0
    if (!this._dimensionHit(want, platforms)) return 0
    return 1 / platforms.length
  }

  /**
   * 统计该策略真正命中的用户设置维度数（0-4）。
   *
   * 与 score 的区别：score 里未命中的维度也给 30% 基础分，所以「命中 1 个高权维度」
   * 与「命中 3 个低权维度」可能同分。_hits 只看**命中个数**，用于并列时判断
   * 哪个策略贴合了更多用户明确表达的意图。
   * @param {object} strategy
   * @returns {number}
   */
  _hits(strategy) {
    const s = this._userSettings || {}
    let n = 0
    if (this._dimensionHit(s.industry, strategy.industry)) n++
    if (this._dimensionHit(s.purpose, strategy.purpose)) n++
    if (this._dimensionHit(s.platform, strategy.platforms)) n++
    if (this._dimensionHit(s.tone, strategy.tone)) n++
    return n
  }

  /**
   * 单个维度是否真正命中（不给基础分那一档）。
   * @param {string} userValue
   * @param {Array} strategyValues
   * @returns {boolean}
   */
  _dimensionHit(userValue, strategyValues) {
    if (!userValue || !strategyValues || strategyValues.length === 0) return false
    const normalizedUser = String(userValue).toLowerCase().trim()
    if (!normalizedUser) return false
    return strategyValues.some(v => {
      const nv = String(v).toLowerCase().trim()
      return nv === normalizedUser || nv.includes(normalizedUser) || normalizedUser.includes(nv)
    })
  }

  /**
   * 返回 Top N 推荐策略
   * @param {Array} strategies
   * @returns {Array}
   */
  recommend(strategies) {
    return this.rank(strategies).slice(0, this._topN)
  }

  /**
   * 计算单个策略的匹配分数
   * @param {object} strategy
   * @returns {number} 0-100
   */
  _score(strategy) {
    const weights = {
      industry: 30,
      purpose: 25,
      platform: 20,
      tone: 15,
      history: 10
    }

    let score = 0

    // 行业匹配 (30%)
    score += this._matchDimension(
      this._userSettings.industry,
      strategy.industry || [],
      weights.industry
    )

    // 目的匹配 (25%)
    score += this._matchDimension(
      this._userSettings.purpose,
      strategy.purpose || [],
      weights.purpose
    )

    // 平台匹配 (20%)
    score += this._matchDimension(
      this._userSettings.platform,
      strategy.platforms || [],
      weights.platform
    )

    // 风格匹配 (15%)
    score += this._matchDimension(
      this._userSettings.tone,
      strategy.tone || [],
      weights.tone
    )

    // 历史评分 (10%)
    score += this._historyScore(strategy.id, weights.history)

    return Math.round(score * 100) / 100
  }

  /**
   * 内容特征启发式得分（无有效信号时的破平依据）。
   *
   * 为什么需要：userSettings/userHistory 全空时五维全部只拿 30% 基础分 ⇒ 所有策略同分，
   * 稳定排序退化为「取内置表第一项」（strategy-viral-storytelling，短视频编剧人设）。
   * 实测把一篇科技深度报道改成了电商带货腔文案。
   *
   * 设计约束（三条，缺一不可）：
   * 1. 不改变「用户显式命中优先」的既有语义 —— 仅当 score 并列时才被读取。
   * 2. 且该并列必须发生在「用户未给出任何有效信号」的组里（见 _isNoSignalGroup）。
   *    反例：platform=douyin 时 douyin-viral 与 knowledge-dry 同为 44 分，
   *    但那是平台维真命中导致的并列，启发式不得插手覆盖用户选择。
   * 3. 结果永远不依赖入参数组顺序 —— 前两级全并列时按 id 字典序破平（确定性）。
   *
   * 兜底取向：信息密集型长文或无 content ⇒ 保真型（strategy-knowledge-dry）。
   * 理由：丢事实的代价远高于文风不够抓人；营销腔可事后调，丢掉的事实回不来。
   *
   * @param {object} strategy
   * @returns {number} 启发式得分（仅用于并列破平）
   */
  _heuristicScore(strategy) {
    if (!this._isFidelityEligible()) return 0
    return this._fidelityIds.indexOf(strategy.id) !== -1 ? 1 : 0
  }

  /**
   * 启发式是否有资格介入（破平失败后的最终兜底）。
   *
   * 两类场景允许（CCG 二轮 i1/i2 实测确立）：
   * 1. 无信号组（用户什么都没填）——原 P0-1 场景。
   * 2. **有信号但零命中**（用户填了值，但没有任何策略声明匹配它）——此时
   *    score/hits/specificity 全并列，且 id 破平被 i1 收窄关掉 ⇒ 稳定排序
   *    回退数组首项（实测 industry=zxyx ⇒ storytelling）。用户表达了意图
   *    但意图无法映射到任何策略，同样属于「匹配器未产生有效区分」，
   *    应降级保真兜底而不是靠数组顺序猜。
   *
   * 反例仍然禁止（用户意图已真正命中）：
   *   platform=douyin ⇒ douyin-viral 与 knowledge-dry 同 44 分，但那是真命中
   *   导致的并列，_signalHitAny=true 说明信号已生效，破平交给 hits/specificity。
   *
   * @returns {boolean}
   */
  _isFidelityEligible() {
    // 无信号组：直接有资格
    if (this._isNoSignalGroup()) return true
    // 有信号但全部零命中：信号存在但无法映射任何候选 ⇒ 有资格（读 rank() 缓存）
    return this._signalHitAny === false
  }

  /**
   * 本轮是否「用户未给出任何有效信号」。
   *
   * 只有四个设置维全部为空/未命中、且历史无评分无偏好时，才属于无信号。
   * 此时并列是「基础分相同」造成的伪并列，启发式才允许介入。
   * 任一维有值即视为用户表达了意图 —— 哪怕该值最终未命中任何策略。
   * @returns {boolean}
   */
  _isNoSignalGroup() {
    const s = this._userSettings || {}
    const dims = ['industry', 'purpose', 'platform', 'tone']
    for (let i = 0; i < dims.length; i++) {
      const v = s[dims[i]]
      if (typeof v === 'string' && v.trim()) return false
    }
    const h = this._userHistory || {}
    const ratings = h.strategyRatings || {}
    if (Object.keys(ratings).length > 0) return false
    const preferred = h.preferredStrategies
    if (Array.isArray(preferred) && preferred.length > 0) return false
    return true
  }

  /**
   * 是否应优先保真型策略。
   *
   * 依据原文形态判定：
   * - 无 content：没有任何内容信号 ⇒ 保真（最安全的默认）
   * - 长文（≥600 码点）或信息密集（评测基准/参数量/代码/数据特征）：保真
   * - 短文且无信息密度特征：无强信号 ⇒ 不保真（交由 id 字典序确定性破平）
   * @returns {boolean}
   */
  _isFidelityPreferred() {
    const content = this._content
    if (!content || !content.trim()) return true
    const codePoints = [...content].length
    if (codePoints >= FIDELITY_MIN_LENGTH) return true
    for (let i = 0; i < INFO_DENSITY_PATTERNS.length; i++) {
      if (INFO_DENSITY_PATTERNS[i].test(content)) return true
    }
    return false
  }

  /**
   * 计算单个维度匹配度
   * @param {string} userValue
   * @param {Array} strategyValues
   * @param {number} weight
   * @returns {number}
   */
  _matchDimension(userValue, strategyValues, weight) {
    if (!userValue || !strategyValues || strategyValues.length === 0) {
      return weight * 0.3 // 无法匹配时给 30% 基础分
    }
    const normalizedUser = userValue.toLowerCase().trim()
    const match = strategyValues.some(v => {
      const nv = String(v).toLowerCase().trim()
      return nv === normalizedUser || nv.includes(normalizedUser) || normalizedUser.includes(nv)
    })
    return match ? weight : 0
  }

  /**
   * 历史评分贡献
   * @param {string} strategyId
   * @param {number} weight
   * @returns {number}
   */
  _historyScore(strategyId, weight) {
    const ratings = this._userHistory.strategyRatings || {}
    const rating = ratings[strategyId]
    if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
      return (rating / 5) * weight
    }
    // 偏好策略给 60% 基础分
    const preferred = this._userHistory.preferredStrategies || []
    if (preferred.includes(strategyId)) {
      return weight * 0.6
    }
    return weight * 0.3 // 无历史数据给 30% 基础分
  }
}

module.exports = { StrategyMatcher }
