/**
 * Strategy Matcher — 策略自动匹配算法
 *
 * 根据用户设置（行业、目的、平台、风格）和历史评分，
 * 为所有启用的策略打分，返回 Top N 推荐。
 */

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
   */
  constructor(options = {}) {
    this._userSettings = options.userSettings || {}
    this._userHistory = options.userHistory || {}
    this._topN = options.topN || 3
    this._content = typeof options.content === 'string' ? options.content : ''
  }

  /**
   * 计算所有策略的匹配分数并排序
   * @param {Array} strategies
   * @returns {Array} 排序后的策略数组，每项附加 score 字段
   */
  rank(strategies) {
    if (!Array.isArray(strategies) || strategies.length === 0) return []

    const scored = strategies.map(s => ({
      ...s,
      score: this._score(s),
      // 无有效信号兜底（rewrite-default-strategy-fix，2026-10-19）：
      // 启发式建议分单独携带，不并入 score —— score 仍严格是「用户设置维度匹配分」，
      // 语义单一可测；启发式只在并列破平时被读取。
      _heuristic: this._heuristicScore(s)
    }))

    // 三级排序：① 用户设置维度分；② 内容特征启发式；③ id 字典序（确定性兜底）。
    // 第 ③ 级是「不依赖入参数组顺序」的硬保证：即便前两级全并列，结果也由策略 id
    // 唯一确定，不会因 BUILTIN_STRATEGIES 数组重排而静默改变默认选择。
    scored.sort((a, b) => (
      (b.score - a.score) ||
      (b._heuristic - a._heuristic) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    ))
    return scored.map(({ _heuristic, ...rest }) => rest)
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
    if (!this._isNoSignalGroup()) return 0
    const fidelityIds = ['strategy-knowledge-dry']
    if (this._isFidelityPreferred()) {
      return fidelityIds.indexOf(strategy.id) !== -1 ? 1 : 0
    }
    return 0
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
