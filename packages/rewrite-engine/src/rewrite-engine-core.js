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
const { normalizeChatResult, isTruncatedFinishReason } = require('./llm-result')
const { rewriteSegmented } = require('./segment-rewriter')
// 敏感词检测的单一实现（rewrite-sensitive-precheck-relax 收尾，2026-10-21 拆出）：
// 见文件顶部注释——拆出是为把这条活跃语义的解释文字移出 core 的行数预算。
const { sensitiveCheck } = require('./sensitive-check')
// 字数区间指令的措辞（独立模块，collect-rewrite-wordcount）：核心文件的行数挂账只剩几行余量，
// 而区间**校验**必须留在本文件（渲染层结构锁要求 `range.max <= MAX_OUTPUT_CHARS` 逐字在此）。
const { buildWordCountInstruction } = require('./word-count-instruction')
// 结构标题剥离（独立模块，collect-rewrite-wordcount 拆分）：核心文件的行数挂账只剩几行余量
const { stripStructureHeadings } = require('./structure-headings')
// 输出上限判定（用户区间 / 统一上限 / 策略形态上限 / 兜底）抽到 ./output-cap.js：
// 核心文件贴近 max-lines 容差上限，这条规则有三种输入形态（详见该文件头注释）。
const { resolveOutputCap } = require('./output-cap')

// 无显式字数控制时的默认输出上限（3000 字以下）。
// 注意：这只是「用户没给任何字数意图」时的保守兜底；用户显式 wordCountRange.max
// 永远优先（rewrite-limits-50000，2026-10-19）。
const DEFAULT_MAX_OUTPUT_LENGTH = 3000

// 单次改写输入上限（Unicode 码点）。渲染层
// `apps/desktop/src/utils/rewrite-engine-limits.js` 的 REWRITE_ENGINE_MAX_INPUT_CHARS
// 必须与此一致（结构锁：`rewrite-engine-limits.test.js`）——渲染层截到 A、引擎拒收于 B
// 会让「一键改写」在长文上静默失败（2026-10-19 事故形态）。
// 2026-10-19 6000 → 50000（rewrite-limits-50000）：知乎/公众号/视频转写长文 >6000 是常态，
// 现代模型 128K+ 上下文下 50000 字（约 75K tokens）在成本与质量均可控范围；50000 以上
// 应走分段改写（rewrite-segment-plan），不在此处放宽。
const MAX_INPUT_CHARS = 50000

// wordCountRange 显式区间的合法域（码点）。UI 校验（useWordCountValidation）与
// _getWordCountInstruction 的范围防御都以此为真源上界。
const MAX_OUTPUT_CHARS = 50000

// 引擎内置默认硬约束（rewrite-hard-constraints 审查 M1）：
// 运营中心未配置/未同步/离线场景的回退，保证独立部署桌面端仍有提示词级纯文案约束。
// 内容与运营中心种子 hard-constraint-default-v1 一致（单一事实源在运营中心，此处仅为缺失回退）。
const BUILTIN_DEFAULT_HARD_CONSTRAINTS = [
  '1. 只输出改写后的文案本身，不要包含任何小节标题（如「开头」「中间」「结尾」「悬念钩子」「情感转折」「共鸣与号召」等）、结构说明、写作指导或 Markdown 标题。',
  '2. 文案内部如需分段，使用空行分隔即可；除口播快节奏短文案外，成品应有 2-5 个自然段，禁止整篇压成一段。',
  '3. 不要输出任何与文案内容无关的说明、注释或元信息。',
].join('\n')

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
    // 改写硬约束（最高优先级，运营中心可自定义）：systemPrompt 最前置注入，
    // 与策略/模式指令冲突时以此为准。未注入时引擎行为不变。
    this._hardConstraints = ''
    // AI 味定制（ai-taste-ops-center，运营中心词库运营）：词表覆盖层/禁用表/严重度表。
    // 未注入或空对象时行为与历史逐字节一致（AITasteRemover 缺省回内置常量）。
    this._aiTasteCustomization = {}
  }

  /**
   * 设置 AI 味定制（运营中心词库运营下发）。
   *
   * 与 setHardConstraints 同构的注入入口；全缺省/空对象 = 引擎行为不变。
   * @param {object} [customization] - { phraseMap?: Object<string,string>, disabledWords?: string[], severityMap?: Object<string,string> }
   *   phraseMap：词表覆盖层（叠加 + 键覆盖内置 128 条）；disabledWords：禁用替换的词（含内置词）；severityMap：自定义词严重度覆盖。
   *   非对象输入被忽略（保持现状）。
   */
  setAiTasteCustomization(customization) {
    if (!customization || typeof customization !== 'object') return
    const out = {}
    if (customization.phraseMap && typeof customization.phraseMap === 'object' && !Array.isArray(customization.phraseMap)) {
      out.phraseMap = customization.phraseMap
    }
    if (Array.isArray(customization.disabledWords)) {
      out.disabledWords = customization.disabledWords.filter(w => typeof w === 'string' && w)
    }
    if (customization.severityMap && typeof customization.severityMap === 'object' && !Array.isArray(customization.severityMap)) {
      out.severityMap = customization.severityMap
    }
    this._aiTasteCustomization = out
  }

  /**
   * 获取当前 AI 味定制（未注入/空注入返回空对象）。
   * @returns {object}
   */
  getAiTasteCustomization() {
    return this._aiTasteCustomization
  }

  /**
   * 设置改写硬约束（最高优先级）。
   *
   * 无论选什么改写模式和改写策略都强制生效，注入 systemPrompt 最前置段落，
   * 并显式声明「与后续任何指令冲突时，以本段为准」。
   * 非字符串/空白输入被忽略（不注入，保持引擎默认行为）。
   * @param {string} text - 硬约束内容（已由调用方清洗；引擎侧再防御性 trim）
   */
  setHardConstraints(text) {
    this._hardConstraints = (typeof text === 'string' && text.trim()) ? text.trim() : ''
  }

  /**
   * 获取当前硬约束内容（清洗后；未注入返回空串）。
   * @returns {string}
   */
  getHardConstraints() {
    return this._hardConstraints
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

    // 1. 输入校验（rewrite-segment-and-finish-reason 第二刀：长度分支后移到分流判定——
    //    _validate 只保留空内容校验，超长输入由下面的分段阈值判定接管，
    //    否则 >50000 会在分段路径触发前被 TOO_LONG 硬拒）
    const validation = this._validate(content)
    if (!validation.valid) {
      return { success: false, error: validation.error, errorCode: validation.errorCode }
    }

    // 2. 敏感词检测（全篇一次；分段路径下也在全篇执行，逐段不重复）
    //    rewrite-sensitive-precheck-relax（2026-10-20）：前置**不再拦截**，
    //    preCheck.hits 仍会算出（供知识库「双零命中」条件使用），因此下面的
    //    blocked 分支当前是死路径——保留它是为了将来若恢复拦截只需改
    //    _sensitiveCheck 一处，不必回来改调用点。用户可见的提醒走后置 warnings。
    const preCheck = this._sensitiveCheck(content, 'pre')
    if (preCheck.blocked) {
      return {
        success: false,
        error: '内容包含敏感词，无法改写',
        errorCode: 'SENSITIVE_CONTENT',
        sensitiveHits: preCheck.hits
      }
    }

    // 3. 策略匹配（全篇一次；分段路径下所有段复用同一策略，保证术语/风格一致）
    const strategy = this._resolveStrategy(strategyId, userSettings, content)
    if (!strategy) {
      return { success: false, error: '未找到合适的改写策略', errorCode: 'NO_STRATEGY' }
    }

    // 3.5 长文分流（rewrite-segment-and-finish-reason 第二刀）：输入码点超过
    // MAX_INPUT_CHARS（分段阈值）⇒ 走分段改写路径；否则走单次路径。
    // 分段编排在 segment-rewriter.js（独立模块，避免核心文件撞 max-lines 基线）
    if ([...content].length > MAX_INPUT_CHARS) {
      return await rewriteSegmented(this, params, { strategy, preCheck })
    }

    // 3.6 单次路径的取消前检查（rewrite-cancel-and-truncation-summary）：单次调用只需
    // 数秒，取消价值低，但「入口即取消」不应白调一次 LLM（计费）。调用开始后不可中断
    // （in-flight 中止需给全部 LLM 调用加信号通路，proposal §2.1 明确不做）。
    const entrySignal = params.signal
    if (entrySignal && entrySignal.cancelled === true) {
      return {
        success: false,
        cancelled: true,
        errorCode: 'CANCELLED',
        error: '改写已取消（尚未调用模型），未产生费用',
        completedSegments: 0,
      }
    }

    // 4. 单次改写主体（rewrite-segment-and-finish-reason 抽取：分段路径复用同一函数；
    //    内部保留 prompt 构建/LLM/后处理/质量评估，知识库写入与 viralScorer 已上移）
    const once = await this._rewriteOnce(params, { strategy, preCheck, segmentContext: null })

    // 5. 全篇级副作用（只执行一次；分段路径由此天然获得「一篇一次」语义）
    if (once.success) {
      // 5a. 爆款潜力对比（viral-rewrite-integration）：改写前 vs 改写后各一次
      const viral = this._viralScorer
        ? await this._scoreViral(content, once.result)
        : undefined
      // 5b. 记录到知识库（持久化失败不影响主流程；前后置双零命中才写）
      if (preCheck.hits.length === 0 && once.postCheckHits.length === 0) {
        try {
          this._knowledgeBase.recordFeedback({
            action: 'generated',
            strategyId: strategy.id,
            resultContent: once.result,
            userSettings
          })
        } catch { /* 知识库持久化失败不阻塞主流程 */ }
      }
      return this._assembleResult(once, { strategy, preCheck, mode, content, userSettings, viral })
    }
    return once
  }

  /**
   * 单次改写主体（rewrite-segment-and-finish-reason 第一刀从 rewrite() 抽取）。
   *
   * 职责边界（保形抽取，副作用已上移到 rewrite()）：
   *   - 保留：prompt 构建（含知识库上下文）→ LLM 调用（归一化 + modelTruncated）→
   *     后处理（outputTruncated）→ 敏感词后置 → 质量评估 → 标题提炼；
   *   - 移除：知识库 recordFeedback 写入、viralScorer 调用（全篇级，rewrite() 负责）。
   *
   * @param {object} params - 原始 rewrite 参数
   * @param {object} ctx - { strategy, preCheck, segmentContext }
   * @returns {Promise<object>} 成功 {success:true, result, title, postCheckHits, quality, outputTruncated, outputLength, modelTruncated, strategy}；失败 {success:false, errorCode, error, segmentIndex?}
   */
  async _rewriteOnce(params, ctx) {
    const { mode = 'imitate', content = '', userSettings = {} } = params
    const { strategy, preCheck, segmentContext = null } = ctx || {}

    // 3.5 标题参考 + 爆款信号（viral-rewrite-integration）：软约束注入 Prompt
    const titleHint = this._sanitizeTitleHint(params.titleHint)
    const viralAngles = this._sanitizeStringList(params.viralAngles, 6, 60)
    const viralKeywords = this._sanitizeStringList(params.viralKeywords, 6, 60)
    // P2-a：爆款强度定量信号（样本数/均值），引擎侧清洗后作为软约束注入
    const engagement = this._sanitizeEngagement(params.engagement)

    // 4. 构建 Prompt（内部含三层知识库上下文，P0 后为 async——LLM 关键词兜底）
    const { systemPrompt, userPrompt } = await this._buildPrompt(strategy, content, mode, userSettings, null, titleHint, viralAngles, viralKeywords, engagement)

    // 4.5 长文分片上下文（rewrite-segment-and-finish-reason 第二刀）：分段路径下每段
    // prompt 必须明确「这是第 i/n 片、只改本片、不总结不续写」，否则模型会把分片当全文
    // 重新起承转合（段间结构性漂移）。单次路径 segmentContext=null 时零注入。
    const effectiveSystemPrompt = segmentContext
      ? `${systemPrompt}\n\n【长文分片改写】本次输入是长文第 ${segmentContext.index + 1}/${segmentContext.count} 片。` +
        '仅改写本片段内容；不要总结全文、不要续写其他片段、不要添加原文没有的过渡段；保留本片段的段落边界。'
      : systemPrompt

    // 5. LLM 推理
    if (!this._llmClient) {
      return { success: false, error: 'LLM 客户端未配置', errorCode: 'NO_LLM_CLIENT' }
    }

    let chatRaw
    try {
      chatRaw = await this._llmClient.chat(effectiveSystemPrompt, userPrompt)
    } catch (e) {
      this._logger.error('rewrite-engine', 'LLM call failed', { strategyId: strategy && strategy.id, mode, error: e.message })
      return { success: false, error: `LLM 调用失败: ${e.message}`, errorCode: 'LLM_ERROR' }
    }

    // finish_reason 归一化（rewrite-segment-and-finish-reason）：chat 契约允许返回
    // string（旧实现）或 {text, finishReason}（新实现）；单点归一化后取 text。
    const { text: result, finishReason } = normalizeChatResult(chatRaw)

    // 归一化之后才判空（空 text 仍走 EMPTY_RESULT——旧行为不因新 shape 漏判）
    if (!result || !result.trim()) {
      return { success: false, error: 'LLM 返回空结果', errorCode: 'EMPTY_RESULT' }
    }

    // 6. 后处理（wordCountRange.max 优先于策略 postProcess.maxLength）
    // rewrite-limits-50000（2026-10-19）：截断必须可见——旧行为把超限输出静默砍尾，
    // 用户拿到的稿子不完整且不知道（比 TOO_LONG 更隐蔽的缺陷）。截断事实经
    // _postProcess 返回值进入 result.outputTruncated / result.outputLength。
    const { text: processed, truncatedAt } = this._postProcess(result, strategy, userSettings.wordCountRange, userSettings.freeformOutput === true)

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

    return {
      success: true,
      result: processed,
      title: this._generateTitle(processed),
      postCheckHits: postCheck.hits,
      quality,
      // 输出截断可见化（rewrite-limits-50000）
      outputTruncated: truncatedAt != null ? true : false,
      outputLength: [...processed].length,
      // 模型侧截断可见化（rewrite-segment-and-finish-reason）：provider finish_reason
      // 表示输出被自身上限截断时置 true；纯增量字段，UI 与 outputTruncated 分型展示。
      modelTruncated: isTruncatedFinishReason(finishReason),
      strategy: {
        id: strategy.id,
        name: strategy.name,
        category: strategy.category
      },
      // 分段上下文回显（segmentContext 为 null 时不出现在结果里）
      ...(segmentContext ? { segmentIndex: segmentContext.index, segmentCount: segmentContext.count } : {})
    }
  }


  /**
   * 爆款潜力评分（rewrite() 全篇级副作用；从原 rewrite() 内联块原样搬出）。
   * @param {string} content - 原文
   * @param {string} processed - 改写结果
   * @returns {Promise<object|undefined>} { original, rewritten, delta, mode } 或 undefined
   */
  async _scoreViral(content, processed) {
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
          return {
            original: Math.round(vOrig.score * 10) / 10,
            rewritten: Math.round(vNew.score * 10) / 10,
            delta: Math.round((vNew.score - vOrig.score) * 10) / 10,
            mode: modeB,
          }
        }
        this._logger.warn('rewrite-engine', 'viral scorer mode mismatch, drop viral result', { modeA, modeB })
      }
    } catch (e) {
      this._logger.warn('rewrite-engine', 'viral scorer failed, fail-open', { error: (e && e.message) || 'unknown' })
    }
    return undefined
  }

  /**
   * 组装 rewrite() 最终返回体（从原 rewrite() 返回块搬出，字段逐一保持）。
   */
  _assembleResult(once, { strategy, preCheck, mode, content, userSettings, viral }) {
    const processed = once.result
    return {
      success: true,
      result: processed,
      // 改写结果标题（≤20 字，2026-09-18）：从改写结果首段提炼；失败回退空串
      title: once.title,
      strategy: once.strategy,
      warnings: once.postCheckHits.length > 0 ? ['改写结果可能包含敏感内容，请人工审核'] : [],
      sensitiveHits: once.postCheckHits,
      quality: once.quality,
      // 输出截断可见化（rewrite-limits-50000）
      outputTruncated: once.outputTruncated,
      outputLength: once.outputLength,
      // 模型侧截断可见化（rewrite-segment-and-finish-reason）
      modelTruncated: once.modelTruncated,
      // 分段改写元数据（rewrite-segment-and-finish-reason 第二刀；仅分段路径有）
      ...(once.segmented ? { segmented: once.segmented } : {}),
      // 段级截断段号（rewrite-cancel-and-truncation-summary；仅分段路径且确有截断时出现）
      ...(once.truncatedSegments ? { truncatedSegments: once.truncatedSegments } : {}),
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
   * @param {string} [content] - 待改写原文（无有效信号时驱动保真优先兜底）
   * @returns {Array}
   */
  getRecommendedStrategies(userSettings = {}, content = '') {
    const strategies = this._strategyManager.listEnabled()
    const matcher = new StrategyMatcher({
      userSettings,
      userHistory: this._knowledgeBase.getUserHistory(),
      topN: 3,
      // 无有效信号兜底（rewrite-default-strategy-fix）：原文形态驱动保真优先。
      // 缺省空串 ⇒ 启发式退化为「保真兜底」（_isFidelityPreferred 对空内容返回 true）。
      content,
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
    // 长度硬拒已移交 rewrite() 的长文分流（rewrite-segment-and-finish-reason 第二刀）：
    // >MAX_INPUT_CHARS 走分段改写，不再返回 TOO_LONG。这里只保留空内容校验。
    // （保留 MAX_INPUT_CHARS 导入是因为分流点在同文件使用它作阈值。）
    return { valid: true }
  }

  /**
   * 敏感词检测（委托给 sensitive-check.js）。
   *
   * 本体连解释一起搬去了独立模块（rewrite-sensitive-precheck-relax 收尾，2026-10-21）：
   * 本文件当时离 max-lines 上限只差约 29 行，而敏感词语义是会被反复改动的活跃面
   * ——2026-10-20 改它时注释一厚就超限 4 行、被 CI 判 LEDGER_GREW。拆开后
   * core 的行数不再被这条语义的解释文字推着走。
   *
   * 语义要点（详情见 sensitive-check.js 顶部）：
   *   - 前置（pre）不拦截，只记录命中；后置（post）上报 hits 给 _assembleResult 转 warnings。
   *   - KB「双零命中」条件不变：preCheck.hits 与 postCheckHits 均零才 recordFeedback。
   *   - 检测异常 fail-open 并留痕。
   *
   * @param {string} text
   * @param {'pre'|'post'} stage - 仅用于异常留痕；不参与 blocked 判断。恢复拦截时
   *   在 sensitive-check.js 重新引入 stage 判断即可，调用点无需改。
   * @returns {{blocked: boolean, hits: Array}}
   */
  _sensitiveCheck(text, stage) {
    return sensitiveCheck({ filter: this._sensitiveFilter, logger: this._logger }, text, stage)
  }

  _resolveStrategy(strategyId, userSettings, content = '') {
    if (strategyId) {
      return this._strategyManager.get(strategyId)
    }
    // 自动匹配（原文形态参与无有效信号时的兜底取向）
    const recommended = this.getRecommendedStrategies(userSettings, content)
    return recommended.length > 0 ? recommended[0] : null
  }

  async _buildPrompt(strategy, content, mode, userSettings, knowledgeOptions, titleHint, viralAngles, viralKeywords, engagement) {
    // 三层知识库上下文：优先使用 KnowledgeContextBuilder，缺省回退到用户偏好摘要
    const effectiveKnowledgeOptions = knowledgeOptions || userSettings.knowledgeOptions || null
    const kbContext = await this._buildKnowledgeContext(content, effectiveKnowledgeOptions)

    // 模式特定的系统提示补充
    const modeInstructions = this._getModeInstructions(mode, userSettings)
    // 字数区间指令（wordCountRange 优先于 targetLength 三档）
    // 传入原文长度：min=0 时用它推导「与原文相当」的目标篇幅（见 _getWordCountInstruction 注释）
    const wordCountInstruction = this._getWordCountInstruction(userSettings, [...content].length)

    // 改写硬约束（最高优先级）：注入 systemPrompt 最前置段落，位于策略 systemPrompt 之前。
    // 显式声明冲突裁决规则——与后续任何策略/模式指令冲突时，以硬约束为准。
    // 运营中心未下发时回退引擎内置默认（审查 M1：独立/离线桌面仍有提示词级约束）
    const effectiveHardConstraints = this._hardConstraints || BUILTIN_DEFAULT_HARD_CONSTRAINTS
    const hardConstraintPrompt = `【改写硬约束（最高优先级，冲突时以此为准）】\n${effectiveHardConstraints}\n以上硬约束优先级最高：无论后续的策略要求、模式指令或字数要求与本段有何冲突或矛盾，一律以本段为准。`

    const systemPrompt = [hardConstraintPrompt, strategy.systemPrompt, modeInstructions, wordCountInstruction].filter(Boolean).join('\n\n')

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

    // 爆款强度参考（P2-a）：定量软约束（模板替换后追加，同 titleHint/信号段防二次展开；
    // 数值取整百/取整，防精确计数被模型原样抄进正文）
    if (engagement) {
      userPrompt += `\n\n## 爆款强度参考（软约束）\n同题材参考样本（${engagement.sampleCount} 条）平均互动：点赞 ~${engagement.avgLikes}、评论 ~${engagement.avgComments}。\n生成内容的信息密度与钩子强度应向头部样本（前 25% 分位）对齐；不要虚构具体数字写入正文。`
    }

    // 纯文案输出约束已升级为运营中心可维护的硬约束（rewrite-hard-constraints，2026-09-18）：
    // 引擎不再硬编码该约束，由桌面端从运营中心同步默认版本并经 setHardConstraints 注入。
    // 硬约束缺失时引擎行为不变（structure-headings 模块的后处理兜底仍保留）。

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

  /**
   * 清洗爆款强度信号（P2-a）：非对象 / 样本数 <3 / 均值非有限数 → null
   * （样本太少均值无统计意义，宁缺毋滥——同 mode 一致性校验原则）。
   * avgLikes 展示取整百（防精确数被模型原样抄进文案），avgComments 取整。
   * @param {unknown} engagement - { avgLikes, avgComments, sampleCount }
   * @returns {{sampleCount:number,avgLikes:number,avgComments:number}|null} 清洗后强度信号（无效时 null）
   */
  _sanitizeEngagement(engagement) {
    if (!engagement || typeof engagement !== 'object') return null
    const sampleCount = Number(engagement.sampleCount)
    if (!Number.isFinite(sampleCount) || sampleCount < 3) return null
    const avgLikes = Number(engagement.avgLikes)
    const avgComments = Number(engagement.avgComments)
    if (!Number.isFinite(avgLikes) || !Number.isFinite(avgComments)) return null
    return {
      sampleCount: Math.floor(sampleCount),
      avgLikes: Math.round(avgLikes / 100) * 100,
      avgComments: Math.round(avgComments),
    }
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
5. 可以改变叙述视角（如从第一人称改为第三人称）
6. 分段输出要求：按内容逻辑划分自然段，段与段之间用空行分隔（抖音口播类短文案除外）`

      case 'expand':
        return `【改写模式：扩写爆款】
核心要求：
1. 基于原文的核心思想进行深度扩展
2. 增加背景介绍、原因分析、案例支撑、数据引用
3. 从 What → Why → How → So What 四个层次递进
4. 目标长度：${userSettings.targetLength === 'short' ? '约500字' : userSettings.targetLength === 'long' ? '约2000字' : '约1000字'}
5. 保证扩写不是"注水"，而是增加有价值的信息增量
6. 分段输出要求：按 What/Why/How/So What 等逻辑层次划分自然段，段与段之间用空行分隔（抖音口播类短文案除外）`

      case 'create':
        return `【改写模式：选题创作】
核心要求：
1. 基于用户提供的选题，创作一篇全新的完整文案
2. 先分析选题确定内容类型，再生成结构化大纲
3. 每段按写作指导独立生成，最后统一风格
4. 自动注入爆款要素：钩子、情绪转折、金句、互动引导
5. 目标长度：${userSettings.targetLength === 'short' ? '约500字' : userSettings.targetLength === 'long' ? '约2000字' : '约1000字'}
6. 分段输出要求：按大纲结构划分自然段，段与段之间用空行分隔（抖音口播类短文案除外）`

      default:
        return ''
    }
  }

  /**
   * 构建字数区间指令：wordCountRange {min,max} 优先；未提供时不注入（由后处理默认上限兜底）。
   * 区间**校验留在本文件**（渲染层结构锁要求 `range.max <= MAX_OUTPUT_CHARS` 逐字在此），
   * 措辞在 `word-count-instruction.js`。整数性守在这里：引擎是共享契约点，非 UI 调用方
   * （Python 链路 / 插件 / 未来新入口）可能送来 1.5 这样的值——「1.5 到 6000 字之间」是坏指令。
   * @param {object} userSettings
   * @param {number} [originalLength] - 原文码点数（用于推导「与原文相当」的目标篇幅）
   * @returns {string}
   */
  _getWordCountInstruction(userSettings, originalLength) {
    const range = userSettings && userSettings.wordCountRange
    if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') return ''
    if (!Number.isInteger(range.min) || !Number.isInteger(range.max)) return ''
    if (!(range.min >= 0 && range.min <= MAX_OUTPUT_CHARS - 1) || !(range.max >= 1 && range.max <= MAX_OUTPUT_CHARS) || range.max < range.min) return ''
    return buildWordCountInstruction(range, originalLength)
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

  _postProcess(text, strategy, wordCountRange, freeformOutput) {
    let result = text

    // 去 AI 味
    const postProcess = strategy.postProcess || {}
    if (postProcess.removeAITaste !== false) {
      // 强度语义（ai-taste-ops-center Q4）：策略 postProcess.aiTasteIntensity（1-3）优先，
      // 非法值回 2（与历史行为一致）。1=仅词级替换（跳 Pass 3 句长修复）；3=追加 casual 口语化。
      const rawIntensity = postProcess.aiTasteIntensity
      const intensity = (rawIntensity === 1 || rawIntensity === 2 || rawIntensity === 3) ? rawIntensity : 2
      const cust = this._aiTasteCustomization || {}
      const remover = new AITasteRemover({
        enabled: true,
        intensity,
        tone: strategy.tone?.[0] || 'casual',
        phraseMap: cust.phraseMap,
        disabledWords: cust.disabledWords,
        severityMap: cust.severityMap
      })
      result = remover.process(result)
    }

    // 长度限制（Unicode 码点计数，与 _validate 一致；避免代理对被切断产生乱码）
    // 上限取谁（用户区间 / 统一上限 / 策略形态上限 / 兜底）见 ./output-cap.js 的优先级说明；
    // 截断必须可见：truncatedAt = 截断后的长度（码点）；未截断为 null。
    const maxLength = resolveOutputCap(wordCountRange, postProcess.maxLength, freeformOutput, MAX_OUTPUT_CHARS, DEFAULT_MAX_OUTPUT_LENGTH)
    let truncatedAt = null
    const codePoints = [...result]
    if (codePoints.length > maxLength) {
      truncatedAt = maxLength
      result = codePoints.slice(0, maxLength).join('')
    }

    // 结构标题剥离兜底（2026-09-18）：即使提示词已约束输出格式，模型仍可能输出
    // 「开头（悬念钩子）」「**中间（情感转折）**」「## 结尾」等小节标题行。
    // 逐行识别结构标题行并移除（仅剥离标题行本身，不触碰正文内容）。
    result = stripStructureHeadings(result)

    return { text: result.trim(), truncatedAt }
  }

  /**
   * 生成改写结果标题（≤20 字）。
   *
   * 策略：优先从改写结果中提取核心句（首段第一句，截断到 20 字）；
   * 结果为空/过短时回退为空串（不阻塞主流程）。
   * @param {string} text - 改写后的文案
   * @returns {string} 标题（≤20 字，可能为空串）
   */
  _generateTitle(text) {
    if (typeof text !== 'string' || !text.trim()) return ''
    const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) || ''
    // 取第一句（。！？…结尾），无标点则取整行
    const sentenceMatch = firstLine.match(/^[^。！？…]*[。！？…]/)
    const sentence = sentenceMatch ? sentenceMatch[0] : firstLine
    const title = sentence.replace(/[。！？…\s]+$/, '').trim()
    if (!title) return ''
    // 截断到 20 字（Unicode 码点）
    return [...title].slice(0, 20).join('')
  }

  _getAITasteLevel(text, strategy) {
    if (!strategy.postProcess || strategy.postProcess.removeAITaste === false) return null
    const remover = new AITasteRemover({ enabled: true })
    return remover.detectAITasteLevel(text)
  }
}

module.exports = { RewriteEngine, MAX_INPUT_CHARS, MAX_OUTPUT_CHARS }
