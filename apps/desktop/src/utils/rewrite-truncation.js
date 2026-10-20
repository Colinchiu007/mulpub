/**
 * 改写结果元信息派生（纯函数）——rewrite-cancel-and-truncation-summary 抽出。
 *
 * 为什么独立：`RewriteView.vue` 已接近 max-lines 登记容差，而这几个派生都是
 * 「信封字段 → 展示模型」的无副作用映射，放在视图里既撑行数又只能通过组件挂载来测。
 * 抽成纯函数后可单测，且视图只剩三行赋值。
 */

/**
 * 引擎按字数区间砍尾（outputTruncated）。
 * @param {object} data - aiRewrite 信封的 data
 * @param {number} fallbackMax - data 未携带上限时的展示兜底（当前字数控制上限）
 * @returns {{length:number,max:number|null}|null}
 */
export function deriveOutputTruncatedInfo (data, fallbackMax) {
  if (!data || data.outputTruncated !== true) return null
  const length = Number(data.outputLength)
  if (!Number.isFinite(length)) return null
  const max = Number(fallbackMax)
  return { length, max: Number.isFinite(max) && max > 0 ? max : null }
}

/**
 * 模型侧截断（provider finish_reason=length|max_tokens）。
 *
 * `truncatedSegments`（1-based 段号）仅在分段路径出现：它让 UI 能点名「哪一段被截」，
 * 而不是笼统说整篇残缺。非法/缺失一律归一为空数组（按「整篇被截」形态展示）。
 * @param {object} data
 * @returns {{length:number,truncatedSegments:number[]}|null}
 */
export function deriveModelTruncatedInfo (data) {
  if (!data || data.modelTruncated !== true) return null
  const length = Number(data.outputLength)
  if (!Number.isFinite(length)) return null
  const raw = Array.isArray(data.truncatedSegments) ? data.truncatedSegments : []
  const truncatedSegments = raw.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
  return { length, truncatedSegments }
}

/**
 * 分段段数（>1 才展示「分段改写 ×N」；未分段/单段返回 0 表示不展示）。
 * @param {object} data
 * @returns {number}
 */
export function deriveSegmentedCount (data) {
  if (!data || !data.segmented || data.segmented.enabled !== true) return 0
  const n = Number(data.segmented.segmentCount)
  return Number.isFinite(n) && n > 1 ? n : 0
}
