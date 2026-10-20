/**
 * segment-rewriter.js — 长文分段编排（rewrite-segment-and-finish-reason 第二刀）
 *
 * 为什么独立成模块：`rewrite-engine-core.js` 已接近仓库 max-lines 门禁的登记基线
 * （超基线即红：`check-max-lines.js` 的 LEDGER_GREW）。分段编排是**独立能力**
 * （切分 → 逐段改写 → 合并 → 全篇后处理），搬出来既不增加核心文件体积，
 * 也让「分段」与「单次」两条路径的边界更清楚。
 *
 * 设计取舍：本模块**不持有状态**，由调用方传入 engine 实例并在其上调用
 * `_rewriteOnce` / `_postProcess` / `_sensitiveCheck` / `_qualityEvaluator` /
 * `_generateTitle` / `_assembleResult` / `_logger` —— 复用而非复制核心逻辑
 * （复制会形成第二份 prompt 构建/后处理实现，正是本仓反复踩过的双实现漂移）。
 *
 * 语义（proposal §第二刀）：
 *   - 任一段失败 ⇒ 整篇失败：errorCode 保留底层稳定码 + `segmentIndex`/`segmentCount`
 *     结构化字段（段号**不**编进 errorCode 字符串，便于 UI 按稳定码映射）；
 *     已成功段**不入库、不返回**（不返回半成品，避免用户误用残缺稿）；
 *   - 用户显式 wordCountRange 按**全篇**语义解释：每段 clamp 到「区间 ÷ 段数」份额，
 *     各段上限之和 ≤ 全篇上限（否则 5 段 × ratio 推导会让合并结果必被砍尾，
 *     把「为避免截断而分段」变成「分段反而制造截断」）；
 *   - 知识库 recordFeedback 与 viralScorer 在全篇结果上**只执行一次**（由 rewrite() 负责）。
 */

const { splitSegments } = require('./segment-splitter')

/**
 * 计算段级字数区间（用户显式区间优先，按份额分配）。
 * @param {{min:number,max:number}|undefined|null} userRange - 用户全篇区间
 * @param {number} segmentCount
 * @returns {{min:number,max:number}|undefined} undefined = 不注入字数指令
 */
function deriveSegmentRange (userRange, segmentCount) {
  if (!userRange || typeof userRange.max !== 'number' || userRange.max <= 0 || segmentCount <= 0) {
    return undefined
  }
  const max = Math.max(1, Math.floor(userRange.max / segmentCount))
  const min = (typeof userRange.min === 'number' && userRange.min > 0)
    ? Math.min(userRange.min, max)
    : 0
  return { min, max }
}

/**
 * 执行长文分段改写。
 *
 * @param {object} engine - RewriteEngine 实例（提供 _rewriteOnce 等内部方法）
 * @param {object} params - 原始 rewrite 参数
 * @param {object} ctx - { strategy, preCheck }（全篇级，已由 rewrite() 完成）
 * @returns {Promise<object>} 与 rewrite() 同形状的结果（含 segmented 元数据）
 */
async function rewriteSegmented (engine, params, ctx) {
  const { mode = 'imitate', content = '', userSettings = {} } = params
  const { strategy, preCheck } = ctx

  const { segments, totalChars, segmentCount } = splitSegments(content)
  engine._logger.info('rewrite-engine', 'segment rewrite start', { totalChars, segmentCount })

  const segmentRange = deriveSegmentRange(userSettings.wordCountRange, segmentCount)
  const segmentUserSettings = segmentRange
    ? { ...userSettings, wordCountRange: segmentRange }
    : { ...userSettings, wordCountRange: undefined }

  const segmentTexts = []
  for (const seg of segments) {
    const segParams = {
      ...params,
      content: seg.text,
      // 标题参考 / 爆款信号按全篇构建一次后随每段复用（避免每段各自清洗出不同信号，
      // 那会让术语与人称漂移被放大：proposal §第二刀-8）
      titleHint: params.titleHint,
      viralAngles: params.viralAngles,
      viralKeywords: params.viralKeywords,
      engagement: params.engagement,
      userSettings: segmentUserSettings,
    }
    const once = await engine._rewriteOnce(segParams, {
      strategy,
      preCheck,
      segmentContext: { index: seg.index, count: segmentCount },
    })
    if (!once.success) {
      // 整篇失败 + 结构化段号；结果体不含 result（无半成品）
      return {
        ...once,
        segmentIndex: seg.index,
        segmentCount,
        error: `第 ${seg.index + 1}/${segmentCount} 段改写失败，前面段的进度未保留`,
      }
    }
    segmentTexts.push(once.result)
  }

  // 合并 + 全篇后处理（复用 _postProcess：AI 味去除/截断/结构标题剥离/截断契约
  // 全部走既有路径，不新造第三条截断语义）
  const merged = segmentTexts.join('\n\n')
  const { text: processed, truncatedAt } = engine._postProcess(merged, strategy, userSettings.wordCountRange)
  const postCheck = engine._sensitiveCheck(processed, 'post')

  let quality
  try {
    quality = await engine._qualityEvaluator.evaluateAsync(content, processed, { mode })
  } catch {
    try {
      quality = engine._qualityEvaluator.evaluate(content, processed, { mode })
    } catch {
      quality = null
    }
  }

  return engine._assembleResult({
    success: true,
    result: processed,
    title: engine._generateTitle(processed),
    postCheckHits: postCheck.hits,
    quality,
    outputTruncated: truncatedAt != null,
    outputLength: [...processed].length,
    // 合并结果不携带单段的 finishReason（每段各自是否被模型截断已在段内体现，
    // 合并后无法归属到「这一整篇被截断」，故不置位以免误导）
    modelTruncated: false,
    strategy: {
      id: strategy.id,
      name: strategy.name,
      category: strategy.category
    },
    segmented: { enabled: true, segmentCount, totalChars },
  }, { strategy, preCheck, mode, content, userSettings, viral: undefined })
}

module.exports = { rewriteSegmented, deriveSegmentRange }
