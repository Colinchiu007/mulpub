// @ts-check
/**
 * upload-wait-strategy.js — 视频上传等待策略（纯逻辑，零 DOM/零 Electron 依赖）
 *
 * 取证来源（2026-10 抖音发布日志）：
 * - 909KB 小视频停在 `waiting upload...` 30% 达 15 分 25 秒（14:32:48 → 14:48:13），
 *   之后才打 "video upload-complete signal not detected (preview/url), continuing best-effort"。
 *   根因：旧判定是「负向信号不命中 && 正向信号命中」的**合取**，而抖音上传完成后页面
 *   残留可见 `[class*=progress]` 元素/「转码中」类文本 ⇒ `uploading` 恒为真 ⇒ 条件永不成立，
 *   白等满 900000ms 预算。
 *
 * 对齐方向（参考产品 4.0 逆向结论）：
 * - 它的进度来自 API 分片直传的**真实字节进度**（currentPart/totalParts，节流上报：
 *   大文件 5s 时间门控、小文件 10% 百分比门控），状态机边界
 *   （uploading→uploadSuccess→pushing→pushSuccess）由接口返回驱动，不猜 DOM。
 * - 我们暂无分片直传通道，故取三条可落地项：
 *   ① 等待期解析**页面自身上传百分比**做真实进度上报（30~49 波段）；
 *   ② 按**文件大小自适应**等待预算（小文件短预算，不再一律 15 分钟）；
 *   ③ **停滞检测**：页面百分比长时间不变且已有结构性信号时提前 best-effort 放行。
 *
 * 纪律：本模块不 import 任何 electron/DOM，便于单测；调用方（rpa-view-navigation-helpers）
 * 只负责取信号与本模块决策后的动作。
 */
'use strict'

/** 等待预算下界（ms）：再小的文件也给 90s（含服务端转码/落库时间） */
const MIN_BUDGET_MS = 90000
/** 等待预算上界（ms）：与旧默认一致（B站 96MB 上传实测超 10 分钟） */
const MAX_BUDGET_MS = 900000
/** 预算基线（ms）：固定开销（页面初始化/鉴权/建连） */
const BUDGET_BASE_MS = 60000
/** 每 MB 追加预算（ms）：1MB→70s（被下界抬到 90s），96MB→1020s（被上界压到 900s） */
const BUDGET_MS_PER_MB = 10000
const BYTES_PER_MB = 1048576

/** 稳定期（ms）：注入瞬间的 blob 本地预览不能算完成（smoke5/smoke6 实锤） */
const STABILIZE_MS = 25000
/** 停滞阈值（ms）：页面百分比连续不变超过该值且已有结构性信号 → 提前放行 */
const STALL_MS = 180000

/** 上报波段：页面上传百分比 0~100 映射到 30~49（抖音链路 30='waiting upload...'、50='video uploaded'） */
const REPORT_BASE_PERCENT = 30
const REPORT_SPAN_RATIO = 0.19
const REPORT_MAX_PERCENT = 49

function clamp (value, lo, hi) {
  if (value < lo) return lo
  if (value > hi) return hi
  return value
}

/**
 * 按视频体积计算上传等待预算（ms）。
 * 公式：clamp(60000 + MB * 10000, 90000, 900000)
 * - 1MB → 70000 → 抬到 90000；909KB → 约 68.7s → 90s
 * - 96MB（B站实测大文件） → 1020000 → 压到 900000（保持旧上限）
 * 无法取到体积（0/NaN/负数）时返回上界，行为与旧实现一致。
 * @param {number|null|undefined} fileBytes 视频字节数
 * @returns {number} 预算毫秒数
 */
/**
 * 平台级预算下界（ms）：某些平台的完成信号只在**服务端转码后**才出现，
 * 与文件体积无关 ⇒ 按体积算出来的 90s 下界不够，会先耗尽预算、把已完成的
 * 上传判成「未检测到完成信号」。
 *
 * 2026-10-21 头条实测：143.9KB / 12s 的视频，上传后 90s 内页面**仍无**
 * 「上传成功」文案（日志 15:49:48 开始上传 → 15:51:18 预算耗尽 best-effort），
 * 而同一页面上一次采样（更晚时刻）已显示「上传成功 + 视频时长 12s」⇒ 是转码延迟。
 * 预算只是**上界**：doneCopy 一旦命中就提前返回，放宽不会拖慢正常路径。
 */
const PLATFORM_MIN_BUDGET_MS = Object.freeze({ toutiao: 300000 })

/**
 * 按视频体积计算上传等待预算（ms）。
 * @param {number|null|undefined} fileBytes 视频字节数
 * @param {{ minMs?: number }} [opts] minMs：平台级下界（会再夹到 MAX 以内）
 * @returns {number} 预算毫秒数
 */
function computeBudgetMs (fileBytes, opts) {
  const floor = Number(opts && opts.minMs) > 0 ? Number(opts.minMs) : MIN_BUDGET_MS
  const bytes = Number(fileBytes)
  if (!Number.isFinite(bytes) || bytes <= 0) return MAX_BUDGET_MS
  const raw = BUDGET_BASE_MS + (bytes / BYTES_PER_MB) * BUDGET_MS_PER_MB
  return Math.round(clamp(raw, floor, MAX_BUDGET_MS))
}

/**
 * 页面上传百分比 → 上报进度（30~49 波段，向下取整）。
 * 非法/缺失（null）→ null（调用方不上报，保持既有 30 不变）。
 * @param {number|null|undefined} pagePercent 页面自报百分比（0-100）
 * @returns {number|null}
 */
function computeReportPercent (pagePercent) {
  // null/undefined 必须先拦：Number(null) === 0 会被误当作「页面报 0%」
  if (pagePercent === null || pagePercent === undefined) return null
  const pct = Number(pagePercent)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null
  const mapped = Math.floor(REPORT_BASE_PERCENT + pct * REPORT_SPAN_RATIO)
  return Math.round(clamp(mapped, REPORT_BASE_PERCENT, REPORT_MAX_PERCENT))
}

/**
 * 上传等待决策（纯函数）。
 *
 * 判据优先级（自上而下短路）：
 *  P1 稳定期（elapsedMs < 25s）→ wait。
 *     取证：smoke5 blob 预览在注入瞬间即存在；smoke6 快手 25s 误判完成（页内 https 广告 video）。
 *  P2 elapsedMs ≥ budgetMs（按文件大小自适应）→ besteffort。
 *     **必须早于百分比分支**：否则页面百分比冻结在 <100 时会永远卡在 P3 的 wait，
 *     预算形同虚设（这正是旧版白等满 15 分钟的形态）。
 *  P3 页面自报百分比存在且 < 100 → 链路仍在上行：
 *     停滞（stableSinceMs ≥ 180s）且（正向信号 || 结构性信号 || 负向信号已消失）→ besteffort；
 *     否则 wait（比 P2 更早放行）。
 *     取证：抖音「上传中/转码中」文本与残留 progress 元素会让负向信号恒真（15 分钟空等）。
 *  P4 负向信号消失 && 正向结构信号命中（https 视频预览/编辑器输入/post-video URL）→ done。
 *     取证：这是旧版唯一成功出口，保留其语义但去掉「负向信号必须不命中」的前置死结。
 *  P5 其余 → wait。
 *
 * @param {object} input
 * @param {number} [input.elapsedMs] 本轮距等待起点已耗时（ms）
 * @param {number} [input.budgetMs] 等待预算（ms，见 computeBudgetMs）
 * @param {number|null} [input.pagePercent] 页面自报上传百分比（0-100，无则 null）
 * @param {number|null} [input.prevPagePercent] 上一轮页面百分比（用于停滞判定）
 * @param {boolean} [input.uploading] 负向信号（上传中文本/可见进度元素/百分比<100）
 * @param {boolean} [input.positiveSignal] 正向结构信号（https 视频 || 编辑器输入 || post/video URL）
 * @param {boolean} [input.structuralSignal] 弱结构信号（任意可见 video 元素 || 编辑器输入 || 上传完成类文案）
 * @param {number} [input.stableSinceMs] 页面百分比保持不变已持续多久（ms）
 * @returns {{action:'wait'|'done'|'besteffort', reportPercent:(number|null)}}
 */
function decideUploadWait (input) {
  const opts = input || {}
  const elapsedMs = Number(opts.elapsedMs) || 0
  const budgetMs = Number(opts.budgetMs) > 0 ? Number(opts.budgetMs) : MAX_BUDGET_MS
  const pagePercent = opts.pagePercent === null || opts.pagePercent === undefined ? null : Number(opts.pagePercent)
  const prevPagePercent = opts.prevPagePercent === null || opts.prevPagePercent === undefined ? null : Number(opts.prevPagePercent)
  const uploading = Boolean(opts.uploading)
  const positiveSignal = Boolean(opts.positiveSignal)
  const structuralSignal = Boolean(opts.structuralSignal)
  const stableSinceMs = Number(opts.stableSinceMs) || 0

  const reportPercent = computeReportPercent(pagePercent)

  // P1 稳定期：任何信号都不采信（历史纪律，防 blob 预览/广告 video 误判）
  if (elapsedMs < STABILIZE_MS) return { action: 'wait', reportPercent }

  // P2 预算耗尽 → best-effort 放行（小文件不再干等 15 分钟；且保证循环必然终止）
  if (elapsedMs >= budgetMs) return { action: 'besteffort', reportPercent }

  // P3 页面自报未到 100：仍在上行，只在长时间停滞且有结构性证据时提前放行
  if (pagePercent !== null && pagePercent < 100) {
    const stalled = prevPagePercent !== null
      && pagePercent === prevPagePercent
      && stableSinceMs >= STALL_MS
    if (stalled && (positiveSignal || structuralSignal || !uploading)) {
      return { action: 'besteffort', reportPercent }
    }
    return { action: 'wait', reportPercent }
  }

  // P3.5：**强完成文案 + 无上传中文案 ⇒ 真完成**（2026-10-22）。
  // 排在 P4 之前的原因：uploading 含 pv>0（可见的 [class*=progress]/[class*=percent] 元素）这类
  // 弱 DOM 形状判据，容器类名即可命中 ⇒ 上传完成后仍为 true，P4 永不成立（抖音实测过同型：
  // 残留 progress 元素导致白等满 15 分钟）。强完成文案是语义证据，弱形状不得否决它。
  if (Boolean(opts.doneStrong) && !Boolean(opts.uploadingText)) return { action: 'done', reportPercent }

  // P4 负向信号消失 + 正向结构信号命中 → 真完成
  if (positiveSignal && !uploading) return { action: 'done', reportPercent }

  // P5 其余继续等
  return { action: 'wait', reportPercent }
}

module.exports = {
  MIN_BUDGET_MS,
  MAX_BUDGET_MS,
  BUDGET_BASE_MS,
  BUDGET_MS_PER_MB,
  STABILIZE_MS,
  STALL_MS,
  REPORT_BASE_PERCENT,
  REPORT_SPAN_RATIO,
  REPORT_MAX_PERCENT,
  computeBudgetMs,
  PLATFORM_MIN_BUDGET_MS,
  computeReportPercent,
  decideUploadWait,
}
