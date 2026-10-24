/**
 * queue-hint.js — 从「本地排队快照」推导用户可见的排队提示（纯函数，无 i18n 依赖）
 *
 * 与主进程侧的 `apps/desktop/electron/services/governor-queue-snapshot.js` 的分工：
 *  - 主进程模块：决定**哪些 key 在排队、排队几个、还要等多久**（唯一真源，读 governor 状态）
 *  - 本模块：把那份快照翻译成**「该显示哪种提示」**（纯判定，便于单测，且不绑 i18n）
 *
 * 口径纪律（两条，都来自实测结论）：
 *  1. **并发槽排队不报时间**。真实等待 = 前面几个槽释放 + 自己的 RPM 槽，
 *     而槽释放时间不可知 ⇒ 只报「有几个在等」。宁可少说，不可说错。
 *  2. **小于 1 秒不算排队**。那种等待用户几乎察觉不到，提示反而是噪音。
 *
 * ⚠️ 「排在第几位（全局）」**做不到**：governor 是单机进程内的，只知道自己这台机器。
 *     跨用户位次需要服务端集中准入（见 01-docs 的服务端闸门方案），本期不承诺。
 */

/** 提示种类 */
export const QUEUE_HINT_KIND = Object.freeze({
  /** 有请求在等空闲并发槽：只报数量 */
  WAITING: 'waiting',
  /** 按 RPM 时间槽预约制等待：报精确 ETA */
  ETA: 'eta',
})

/**
 * 推导排队提示。
 *
 * @param {{ entries?: Array<object> } | null | undefined} queue 本地排队快照
 * @returns {{ kind: string, count?: number, etaMs?: number } | null}
 *   null 表示**无排队**（不显示任何提示）
 */
export function buildQueueHint (queue) {
  if (!queue || typeof queue !== 'object' || !Array.isArray(queue.entries) || queue.entries.length === 0) {
    return null
  }
  const entry = queue.entries[0]
  if (!entry || typeof entry !== 'object') return null

  if (entry.reason === 'concurrency') {
    const count = Number(entry.queued)
    if (!Number.isFinite(count) || count <= 0) return null
    return { kind: QUEUE_HINT_KIND.WAITING, count: Math.floor(count) }
  }

  const etaMs = Number(entry.etaMs)
  if (!Number.isFinite(etaMs) || etaMs < 1000) return null
  return { kind: QUEUE_HINT_KIND.ETA, etaMs: Math.floor(etaMs) }
}
