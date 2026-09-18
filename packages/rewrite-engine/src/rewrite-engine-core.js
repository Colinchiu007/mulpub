/**
 * Rewrite Engine Core — 改写引擎核心
 *
 * 编排改写流程：模式路由 → 策略匹配 → Prompt 构建 → LLM 调用 → 后处理 → 返回结果
 */

const { StrategyManager } = require('./strategy-manager')
const { StrategyMatcher } = require('./strategy-matcher')
const { AITasteRemover } = require('./ai-taste-remover')
const { KnowledgeBase } = require('./knowledge-base')
const { RewriteQualityEvaluator } = require('./rewrite-quality-evaluator')
const { KnowledgeContextBuilder } = require('./knowledge-context-builder')
// 极简 logger（与 api-publish-engine/logger 同接口；logging-coverage-audit）
const logger = require('./logger-fallback')

// 无显式字数控制时的默认输出上限（3000 字以下）
const DEFAULT_MAX_OUTPUT_LENGTH = 3000

class RewriteEngine {
  /**
   * @param {object} options
   * @param {object} options.llmClient - LLM 调用客户端 { chat(systemPrompt, userPrompt): Promise<string> }
   * @param {object} options.sensitiveFilter - 敏感词过滤器 { detect(text): object, filter(text): string }
   * @param {object} options.knowledgeBase - 知识库实例
   * @param {object} options.strategyManager - 策略管理器实例（可选）
   * @param {object} options.qualityEvaluator - 改写质量评估器实例（可选）
   * @param {function} [options.viralScorer] - 爆款潜力评分器 async (text) => { score: number(0-100), mode: string }（可选，viral-rewrite-integration）
   */
  constructor(options = {}) {
    this._llmClient = options.llmClient || null
    this._sensitiveFilter = options.sensitiveFilter || null
    this._knowledgeBase = options.knowledgeBase || new KnowledgeBase()
    this._strategyManager = options.strategyManager || new StrategyManager()
    this._strategyManager.loadBuiltins()
    this._qualityEvaluator = options.qualityEvaluator || new RewriteQualityEvaluator()
    // 三层知识库 Prompt 构建器（用户偏好 + 爆款库 + 个人知识库）
    this._knowledgeLibrary = options.knowledgeLibrary || null
    // 爆款潜力评分器（可选注入；失败 fail-open 不阻塞改写）
    this._viralScorer = options.viralScorer || null
    this._logger = options.logger || logger
  }

  /**
   * 执行改写
   * @param {object} params
   * @param {string} params.mode - 'imitate' | 'expand' | 'create'
   * @param {string} params.content - 用户输入文案
   * @param {object} params.userSettings - { industry, purpose, tone, platform, targetLength, wordCountRange: {min, max} }
   * @param {string} params.strategyId - 手动指定策略 ID（可选，为空则自动匹配）
   * @returns {Promise<object>} { success, result, strategy, warnings, sensitiveHits }
   */
  async rewrite(params = {}) {
    const { mode = 'imitate', content = '', userSettings = {}, strategyId = null, knowledgeOptions = null } = params
    // P2 反馈闭环：每次改写重置知识引用记录
    this._lastKnowledgeRefs = []

    // 合并 knowledgeOptions：优先 userSettings.knowledgeOptions，其次顶层 params.knowledgeOptions
    const effectiveKnowledgeOptions = (userSettings.knowledgeOptions && typeof userSettings.knowledgeOptions === 'object')
      ? { ...knowledgeOptions, ...userSettings.knowledgeOptions }
      : (knowledgeOptions || null)
    // 将合并后的 knowledgeOptions 写回 userSettings 便于后续方法消费
    userSettings.knowledgeOptions = effectiveKnowledgeOptions

    // 1. 输入校验
    const validation = this._validate(content)
    if (!validation.valid) {
      return { success: false, error: validation.error, errorCode: validation.errorCode }
    }

    // 2. 敏感词前置检测
    const preCheck = this._sensitiveCheck(content, 'pre')
    if (preCheck.blocked) {
      return {
        success: false,
        error: '内容包含敏感词，无法改写',
        errorCode: 'SENSITIVE_CONTENT',
        sensitiveHits: preCheck.hits
      }
    }

    // 3. 策略匹配
    const strategy = this._resolveStrategy(strategyId, userSettings)
    if (!strategy) {
      return { success: false, error: '未找到合适的改写策略', errorCode: 'NO_STRATEGY' }
    }

    // 3.5 标题参考 + 爆款信号（viral-rewrite-integration）：软约束注入 Prompt
    const titleHint = this._sanitizeTitleHint(params.titleHint)
    const viralAngles = this._sanitizeStringList(params.viralAngles, 6, 60)
    const viralKeywords = this._sanitizeStringList(params.viralKeywords, 6, 60)

    // 4. 构建 Prompt（内部含三层知识库上下文，P0 后为 async——LLM 关键词兜底）
    const { systemPrompt, userPrompt } = await this._buildPrompt(strategy, content, mode, userSettings, knowledgeOptions, titleHint, viralAngles, viralKeywords)

    // 5. LLM 推理
    if (!this._llmClient) {
      return { success: false, error: 'LLM 客户端未配置', errorCode: 'NO_LLM_CLIENT' }
    }

    let result
    try {
      result = await this._llmClient.chat(systemPrompt, userPrompt)
    } catch (e) {
      this._logger.error('rewrite-engine', 'LLM call failed', { strategyId: strategy && strategy.id, mode, error: e.message })
      return { success: false, error: `LLM 调用失败: ${e.message}`, errorCode: 'LLM_ERROR' }
    }

    if (!result || !result.trim()) {
      return { success: false, error: 'LLM 返回空结果', errorCode: 'EMPTY_RESULT' }
    }

    // 6. 后处理（wordCountRange.max 优先于策略 postProcess.maxLength）
    const processed = this._postProcess(result, strategy, userSettings.wordCountRange)

    // 7. 敏感词后置检测
    const postCheck = this._sensitiveCheck(processed, 'post')

    // 8. 改写质量评估（优先 embedding 语义 → 回退 SimHash/Jaccard 本地算法）
    // BUGFIX-REWRITE-QUALITY-UX：把改写模式透传给评估器——选题创作(create) 的输入是主题种子，
    // 语义保持度天然偏低，不能套用智能仿写(imitate) 的"偏离原意 → 不合格"判据。
    let quality
    try {
      quality = await this._qualityEvaluator.evaluateAsync(content, processed, { mode })
    } catch {
      try {
        quality = this._qualityEvaluator.evaluate(content, processed, { mode })
      } catch {
        quality = null
      }
    }

    // 8.5 爆款潜力对比（viral-rewrite-integration 第 4 评估维度）：改写前 vs 改写后
    //     viralScorer 可选注入；抛错/返回无效值 fail-open —— 不产生 result.viral、不阻塞主流程
    let viral
    if (this._viralScorer) {
      try {
        const [vOrig, vNew] = await Promise.all([
          this._viralScorer(content),
          this._viralScorer(processed),
        ])
        if (
          vOrig && vNew &&
          typeof vOrig.score === 'number' && Number.isFinite(vOrig.score) &&
          typeof vNew.score === 'number' && Number.isFinite(vNew.score)
        ) {
          // 双模型评审 W-2：original/rewritten 必须同模式（orchestrator vs local-fallback 量纲不同），
          // 跨模式 delta 无可比性 → fail-open 丢弃，不输出误导性对比
          const modeA = (vOrig && vOrig.mode) || 'unknown'
          const modeB = (vNew && vNew.mode) || 'unknown'
          if (modeA === modeB) {
            viral = {
              original: Math.round(vOrig.score * 10) / 10,
              rewritten: Math.round(vNew.score * 10) / 10,
              delta: Math.round((vNew.score - vOrig.score) * 10) / 10,
              mode: modeB,
            }
          } else {
            this._logger.warn('rewrite-engine', 'viral scorer mode mismatch, drop viral result', { modeA, modeB })
          }
        }
      } catch (e) {
        this._logger.warn('rewrite-engine', 'viral scorer failed, fail-open', { error: (e && e.message) || 'unknown' })
      }
    }

    // 9. 记录到知识库（持久化失败不影响主流程）
    if (preCheck.hits.length === 0 && postCheck.hits.length === 0) {
      try {
        this._knowledgeBase.recordFeedback({
          action: 'generated',
          strategyId: strategy.id,
          resultContent: processed,
          userSettings
        })
      } catch { /* 知识库持久化失败不阻塞主流程 */ }
    }

    return {
      success: true,
      result: processed,
      strategy: {
        id: strategy.id,
        name: strategy.name,
        category: strategy.category
      },
      warnings: postCheck.hits.length > 0 ? ['改写结果可能包含敏感内容，请人工审核'] : [],
      sensitiveHits: postCheck.hits,
      quality,
      // 爆款潜力对比（viral-rewrite-integration）：仅 viralScorer 注入且评分有效时存在
      viral,
      // P2 反馈闭环：本次改写引用的知识条目（供前端采纳/拒绝时驱动 feedbackBoost）
      knowledgeRefs: this._lastKnowledgeRefs || [],
      metadata: {
        mode,
        originalLength: content.length,
        resultLength: processed.length,
        aiTasteLevel: this._getAITasteLevel(processed, strategy)
      }
    }
  }

  /**
   * 获取推荐策略列表
   * @param {object} userSettings
   * @returns {Array}
   */
  getRecommendedStrategies(userSettings = {}) {
    const strategies = this._strategyManager.listEnabled()
    const matcher = new StrategyMatcher({
      userSettings,
      userHistory: this._knowledgeBase.getUserHistory(),
      topN: 3
    })
    return matcher.recommend(strategies)
  }

  /**
   * 获取所有可用策略
   * @returns {Array}
   */
  listStrategies() {
    return this._strategyManager.listEnabled()
  }

  /**
   * 合并远程策略
   * @param {Array} remoteStrategies
   */
  mergeRemoteStrategies(remoteStrategies) {
    this._strategyManager.mergeRemote(remoteStrategies)
  }

  // ===== 内部方法 =====

  _validate(content) {
    if (!content || !content.trim()) {
      return { valid: false, error: '内容不能为空', errorCode: 'EMPTY_CONTENT' }
    }
    const len = [...content].length // Unicode code point 计数
    if (len > 6000) {
      return { valid: false, error: '内容过长，最多 6000 字', errorCode: 'TOO_LONG' }
    }
    return { valid: true }
  }

  _sensitiveCheck(text, stage) {
    if (!this._sensitiveFilter) return { blocked: false, hits: [] }
    try {
      const result = this._sensitiveFilter.detect(text)
      return {
        blocked: stage === 'pre' && result.hits && result.hits.length > 0,
        hits: result.hits || []
      }
    } catch (e) {
      // 敏感词检测异常 fail-open 放行（logging-coverage-audit：必须留痕）
      this._logger.error('rewrite-engine', 'sensitive check failed, fail-open', { stage, error: (e && e.message) || 'unknown' })
      return { blocked: false, hits: [] }
    }
  }

  _resolveStrategy(strategyId, userSettings) {
    if (strategyId) {
      return this._strategyManager.get(strategyId)
    }
    // 自动匹配
    const recommended = this.getRecommendedStrategies(userSettings)
    return recommended.length > 0 ? recommended[0] : null
  }

  async _buildPrompt(strategy, content, mode, userSettings, knowledgeOptions, titleHint, viralAngles, viralKeywords) {
    // 三层知识库上下文：优先使用 KnowledgeContextBuilder，缺省回退到用户偏好摘要
    const effectiveKnowledgeOptions = knowledgeOptions || userSettings.knowledgeOptions || null
    const kbContext = await this._buildKnowledgeContext(content, effectiveKnowledgeOptions)

    // 模式特定的系统提示补充
    const modeInstructions = this._getModeInstructions(mode, userSettings)
    // 字数区间指令（wordCountRange 优先于 targetLength 三档）
    const wordCountInstruction = this._getWordCountInstruction(userSettings)

    const systemPrompt = [strategy.systemPrompt, modeInstructions, wordCountInstruction].filter(Boolean).join('\n\n')

    // 单遍正则替换（审查 W-51：顺序 .replace 会被 content 中的 {industry} 等字面量二次注入）
    const vars = {
      content,
      industry: userSettings.industry || strategy.industry?.[0] || '通用',
      purpose: userSettings.purpose || strategy.purpose?.[0] || '通用',
      tone: userSettings.tone || strategy.tone?.[0] || '口语化',
      platform: userSettings.platform || strategy.platforms?.[0] || '通用',
      knowledgeContext: kbContext,
      mode,
      targetLength: userSettings.targetLength || 'medium',
    }
    let userPrompt = strategy.userPromptTemplate.replace(/\{(\w+)\}/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
    ))

    // 标题参考约束（viral-rewrite-integration）：模板替换后追加，避免 hint 中 {placeholder} 被二次展开
    if (titleHint) {
      userPrompt += `\n\n## 标题参考（来自爆款文案生成，软约束）\n改写结果的主题方向、关键词与开头钩子应与以下标题保持一致（学习其结构与关键词，不要逐字复制）：\n「${titleHint}」`
    }

    // 爆款信号参考（P1-E）：推荐角度 + 上升关键词软约束（模板替换后追加，同 titleHint 防二次展开；
    // 条目「」包裹限定语义边界，阻断自然语言指令级注入，评审 I-3）
    if ((viralAngles && viralAngles.length) || (viralKeywords && viralKeywords.length)) {
      const signalParts = []
      if (viralAngles && viralAngles.length) signalParts.push('推荐写作角度：' + viralAngles.map(a => '「' + a + '」').join(' | '))
      if (viralKeywords && viralKeywords.length) signalParts.push('上升关键词：' + viralKeywords.map(k => '「' + k + '」').join(' | '))
      userPrompt += `\n\n## 爆款信号参考（来自爆款分析，软约束）\n改写结果应体现以下爆款分析信号（择优融入，不必全部覆盖）：\n${signalParts.join('\n')}`
    }

    return { systemPrompt, userPrompt }
  }

  /**
   * 清洗标题参考（viral-rewrite-integration）：
   * 非字符串 → null；空白折叠；trim 后为空 → null；超过 200 字符截断。
   * @param {unknown} hint - 待清洗的标题参考
   * @returns {string|null} 清洗后的标题参考（无效时 null）
   */
  _sanitizeTitleHint(hint) {
    if (typeof hint !== 'string') return null
    const collapsed = hint.replace(/\s+/g, ' ').trim()
    if (!collapsed) return null
    return collapsed.slice(0, 200)
  }

  /**
   * 清洗字符串列表（P1-E 爆款信号）：非数组 → []；过滤非字符串/空白；
   * 每条空白折叠 + 截断 maxLen；最多保留 maxCount 条。
   * @param {unknown} list - 待清洗列表
   * @param {number} maxCount - 最大条数
   * @param {number} maxLen - 单条最大长度
   * @returns {string[]} 清洗后的字符串列表
   */
  _sanitizeStringList(list, maxCount, maxLen) {
    if (!Array.isArray(list)) return []
    return list
      .filter(s => typeof s === 'string' && s.trim())
      // 评审 I-3：过滤控制字符（含换行），阻断跨行注入
.map(s => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLen))
      .slice(0, maxCount)
  }

  _getModeInstructions(mode, userSettings) {
    switch (mode) {
      case 'imitate':
        return `【改写模式：智能仿写】
核心要求：
1. 保留原文的核心观点和信息，但彻底重新组织表达方式
2. 更换段落结构、句式、案例、修辞手法
3. 确保改写后的文本与原文的相似度低于 40%
4. 不要使用原文中的标志性短语和独特表达
5. 可以改变叙述视角（如从第一人称改为第三人称）`

      case 'expand':
        return `【改写模式：扩写爆款】
核心要求：
1. 基于原文的核心思想进行深度扩展
2. 增加背景介绍、原因分析、案例支撑、数据引用
3. 从 What → Why → How → So What 四个层次递进
4. 目标长度：${userSettings.targetLength === 'short' ? '约500字' : userSettings.targetLength === 'long' ? '约2000字' : '约1000字'}
5. 保证扩写不是"注水"，而是增加有价值的信息增量`

      case 'create':
        return `【改写模式：选题创作】
核心要求：
1. 基于用户提供的选题，创作一篇全新的完整文案
2. 先分析选题确定内容类型，再生成结构化大纲
3. 每段按写作指导独立生成，最后统一风格
4. 自动注入爆款要素：钩子、情绪转折、金句、互动引导
5. 目标长度：${userSettings.targetLength === 'short' ? '约500字' : userSettings.targetLength === 'long' ? '约2000字' : '约1000字'}`

      default:
        return ''
    }
  }

  /**
   * 构建字数区间指令：wordCountRange {min,max} 优先；未提供时不注入（由后处理默认上限兜底）
   * @param {object} userSettings
   * @returns {string}
   */
  _getWordCountInstruction(userSettings) {
    const range = userSettings && userSettings.wordCountRange
    if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') return ''
    // 范围防御：与前端/PRD 契约一致（min 0-5999、max 1-6000、max >= min），无效区间不注入
    if (!(range.min >= 0 && range.min <= 5999) || !(range.max >= 1 && range.max <= 6000) || range.max < range.min) return ''
    return `【字数要求】改写后的文本长度必须控制在 ${range.min} 到 ${range.max} 字之间。`
  }

  /**
   * 构建三层知识库上下文（用户偏好 + 爆款库 + 个人知识库）
   * @param {string} content
   * @param {object|null} knowledgeOptions
   * @returns {Promise<string>}
   */
  async _buildKnowledgeContext(content, knowledgeOptions) {
    if (this._knowledgeLibrary) {
      const ctx = await this._knowledgeLibrary.buildFullContext(content, knowledgeOptions || {})
      // P2 反馈闭环：收集本次检索命中的知识条目引用，供用户采纳/拒绝时驱动 feedbackBoost
      if (typeof this._knowledgeLibrary.getTouchedItems === 'function') {
        this._lastKnowledgeRefs = this._knowledgeLibrary.getTouchedItems()
      }
      return ctx
    }
    // 向后兼容：无 knowledgeLibrary 时使用原有单层知识库
    this._lastKnowledgeRefs = []
    return this._knowledgeBase.getContextSummary()
  }

  _postProcess(text, strategy, wordCountRange) {
    let result = text

    // 去 AI 味
    const postProcess = strategy.postProcess || {}
    if (postProcess.removeAITaste !== false) {
      const remover = new AITasteRemover({
        enabled: true,
        intensity: 2,
        tone: strategy.tone?.[0] || 'casual'
      })
      result = remover.process(result)
    }

    // 长度限制（Unicode 码点计数，与 _validate 一致；避免代理对被切断产生乱码）
    // 优先级：wordCountRange.max > 策略 postProcess.maxLength > 默认 2500
    const maxLength = (wordCountRange && typeof wordCountRange.max === 'number' && wordCountRange.max > 0)
      ? wordCountRange.max
      : (postProcess.maxLength || DEFAULT_MAX_OUTPUT_LENGTH)
    const codePoints = [...result]
    if (codePoints.length > maxLength) {
      result = codePoints.slice(0, maxLength).join('')
    }

    return result.trim()
  }

  _getAITasteLevel(text, strategy) {
    if (!strategy.postProcess || strategy.postProcess.removeAITaste === false) return null
    const remover = new AITasteRemover({ enabled: true })
    return remover.detectAITasteLevel(text)
  }
}

module.exports = { RewriteEngine }
