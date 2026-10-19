/**
 * 改写页默认参数推导（rewrite-default-strategy-fix，2026-10-19）
 *
 * 背景（实测，非推断）：
 * - 改写页默认 mode 曾写死 'create'（选题创作 = 重新写一篇），而用户贴的往往是一篇成稿。
 *   实测把 5000 字科技深度报道改写成 800 字电商带货腔，事实密度几乎全丢。
 *   根因之一是 create 模式授权模型「重新创作」而非「保留原文」。
 * - 字数区间写死 800-2000，5000 字原文被硬截到 2000（压缩 60%），
 *   且引擎只截 max、从不校验 min ⇒ 写短了没有任何补救。
 *
 * 本模块把这两条默认值改为「按输入形态推导」，并抽成纯函数以便单测与复用。
 */

/**
 * 判定输入形态：成稿（draft）还是选题种子（topic）。
 *
 * 判据（按优先级）：
 * 1. 含句号等终止标点 ⇒ 成稿（选题标题通常无句末标点）
 * 2. 长度 ≥ DRAFT_MIN_LENGTH ⇒ 成稿
 * 3. 换行数 ≥ 1（多段）⇒ 成稿
 * 其余视为选题种子。
 *
 * @param {string} text - 待判定文本（应为已 trim 的正文）
 * @returns {'draft'|'topic'}
 */
export function classifyInputShape(text) {
  if (typeof text !== 'string' || !text.trim()) return 'topic'
  const s = text.trim()
  if (/[。！？.!?]/.test(s)) return 'draft'
  if ([...s].length >= 80) return 'draft'
  if (s.split('\n').length > 1) return 'draft'
  return 'topic'
}

/**
 * 按输入形态推导默认改写模式。
 *
 * 成稿 → imitate（智能仿写，保留原文核心观点）
 * 选题 → create（选题创作，从种子生全文）
 *
 * @param {string} text - 待改写正文
 * @returns {'imitate'|'create'}
 */
export function deriveDefaultMode(text) {
  return classifyInputShape(text) === 'draft' ? 'imitate' : 'create'
}

/**
 * 按原文长度推导默认字数区间。
 *
 * 设计原则：默认区间必须容纳原文，不能让长文被硬压。
 * - 短文：沿用既有 800-2000 手感（下限兜住「别写太少」）
 * - 中长文：上限抬到原文长度的 ADAPTIVE_MAX_RATIO，下限按 ADAPTIVE_MIN_RATIO
 * - 结果夹在 [200, 6000] 内（6000 为引擎输入上限，见 rewrite-engine-core._validate）
 *
 * @param {string} text - 原文
 * @returns {{min:number, max:number}}
 */
export function deriveWordCountRange(text) {
  const len = typeof text === 'string' ? [...text.trim()].length : 0
  if (len < ADAPTIVE_THRESHOLD) return { min: 800, max: 2000 }
  // 先各自取整到百位，再统一夹到 [MIN_CAP, MAX_CAP]，最后保证 min<=max。
  // 顺序不可颠倒：先夹再比大小会把 12000 字这类超长输入算出 min==max 的退化区间。
  const rawMin = Math.round(len * ADAPTIVE_MIN_RATIO / 100) * 100
  const rawMax = Math.round(len * ADAPTIVE_MAX_RATIO / 100) * 100
  const min = Math.min(MAX_CAP, Math.max(MIN_CAP, rawMin))
  const max = Math.min(MAX_CAP, Math.max(MIN_CAP, rawMax))
  return { min: Math.min(min, max), max: Math.max(min, max) }
}

/** 低于此长度沿用固定默认区间（码点） */
const ADAPTIVE_THRESHOLD = 2000
/** 自适应下限占原文长度比例 */
const ADAPTIVE_MIN_RATIO = 0.6
/** 自适应上限占原文长度比例（>1，给扩写留余量；不得小于 1 否则必然截断） */
const ADAPTIVE_MAX_RATIO = 1.2
/** 区间下界（码点）：低于此值「别写太少」失去意义 */
const MIN_CAP = 200
/** 区间上界（码点）：引擎输入与输出上限，见 rewrite-engine-core._validate */
const MAX_CAP = 6000
