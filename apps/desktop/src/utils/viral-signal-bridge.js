// @ts-check
/**
 * viral-signal-bridge — 爆款分析信号「分析页 → 改写页」跨页中转 + 定量强度聚合（P2-a）
 *
 * 为什么走 sessionStorage 而不是继续扩 URL query：
 * 信号快照含角度/关键词/定量互动均值，拼进 query 有超长与转义风险；sessionStorage
 * 一次性交接（读取即清除）配合 /rewrite?titleHint= 标志，改写页挂载后取回快照注入软约束。
 * 与 Pinia store 并存：store 兜底同窗口直接读取，handoff 保证「读后即焚」的确定性语义（AC-P2-2）。
 */

const VIRAL_SIGNAL_HANDOFF_KEY = 'mp-viral-signal'

/**
 * 写入信号快照（一次性）。
 * @param {object} signal - { topic, angles, keywords, engagement }
 * @returns {boolean} 成功 true；非对象/sessionStorage 不可用或超额时 false
 */
export function setViralSignalHandoff (signal) {
  if (!signal || typeof signal !== 'object') return false
  try {
    sessionStorage.setItem(VIRAL_SIGNAL_HANDOFF_KEY, JSON.stringify(signal))
    return true
  } catch {
    return false
  }
}

/**
 * 取出并清除信号快照（一次性语义：读后即焚，避免二次进入改写页重复注入）。
 * @returns {object|null} 快照；不存在或解析失败返回 null
 */
export function takeViralSignalHandoff () {
  try {
    const raw = sessionStorage.getItem(VIRAL_SIGNAL_HANDOFF_KEY)
    if (!raw) return null
    sessionStorage.removeItem(VIRAL_SIGNAL_HANDOFF_KEY)
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 供测试/清理使用：移除交接键 */
export function clearViralSignalHandoff () {
  try { sessionStorage.removeItem(VIRAL_SIGNAL_HANDOFF_KEY) } catch { /* noop */ }
}

/** P0 契约：null/undefined/'' 视为「未知」，不当作 0；其余转有限数，非有限 → null */
function toFiniteOrNull (v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 从分析样本聚合定量强度（P2-a）。
 * sampleCount = 至少有一项有限互动的样本数；avgLikes/avgComments 各按自身有效样本求均值；
 * 无有效样本（或点赞/评论任一全缺）→ null（宁缺毋滥，交给引擎侧 <3 门槛二次把关）。
 * @param {Array<{like_count:*, comment_count:*}>} articles
 * @returns {{sampleCount:number,avgLikes:number,avgComments:number}|null}
 */
export function computeEngagement (articles) {
  if (!Array.isArray(articles) || articles.length === 0) return null
  const likes = []
  const comments = []
  let sampleCount = 0
  for (const a of articles) {
    if (!a || typeof a !== 'object') continue
    const l = toFiniteOrNull(a.like_count)
    const c = toFiniteOrNull(a.comment_count)
    if (l === null && c === null) continue
    sampleCount++
    if (l !== null) likes.push(l)
    if (c !== null) comments.push(c)
  }
  if (sampleCount === 0 || likes.length === 0 || comments.length === 0) return null
  const avg = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length
  return { sampleCount, avgLikes: avg(likes), avgComments: avg(comments) }
}

/**
 * 定量强度信号生效门槛（P2-a 跨层契约）：与引擎侧
 * packages/rewrite-engine/src/rewrite-engine-core.js#_sanitizeEngagement 严格同门槛
 * （样本数 ≥3 且点赞/评论均值均为有限数）。修改任一侧必须同步另一侧，
 * 两侧测试互为锚点（bridge.test / rewrite-engine-core.test 各有 sampleCount=2 vs 3 边界用例）。
 * 渲染层用它过滤徽标显示与 params 透传，避免「显示已带入但引擎实际未注入」的口径错位。
 */
export const MIN_ENGAGEMENT_SAMPLES = 3

/**
 * 判定定量强度信号是否达到可注入门槛（呈现与注入单一事实源）。
 * @param {unknown} engagement - { sampleCount, avgLikes, avgComments }
 * @returns {boolean} 达到门槛 true；弱信号/非对象 false
 */
export function hasActionableEngagement (engagement) {
  if (!engagement || typeof engagement !== "object") return false
  const sampleCount = Number(engagement.sampleCount)
  if (!Number.isFinite(sampleCount) || sampleCount < MIN_ENGAGEMENT_SAMPLES) return false
  const avgLikes = Number(engagement.avgLikes)
  const avgComments = Number(engagement.avgComments)
  return Number.isFinite(avgLikes) && Number.isFinite(avgComments)
}
