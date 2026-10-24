// @ts-check
/**
 * governor-queue-snapshot.js — 把本地限流器的排队状态聚合成「用户可见的排队快照」
 *
 * 背景：桌面端的模型调用受本地 governor 限流（并发槽 + RPM 时间槽 + 429 冷却）。
 * 排队期间界面**完全没有反馈**——用户只看到"卡住了"，几十秒后突然失败，
 * 不知道是排队、是网络、还是服务商挂了。本模块把 governor 内部状态转成可展示的结构。
 *
 * 为什么是**聚合**快照而不是「我排第几位」：
 *  - governor 是**单机进程内**的，它的 `_state` 只知道自己这台机器上的等待者；
 *  - 跨用户的全局位次需要**服务端集中准入**才能算（见 01-docs 的服务端闸门方案）。
 *  ⇒ 本模块只承诺**本机**视角：此刻有几个请求在等、还要等多久。
 *    「排在第几位（全局）」在本期**做不到**，文案与 PRD 都不能承诺（见下方"不许说的话"）。
 *
 * 设计约束：
 *  - **纯函数**：只吃 `(stateMap, now)`，不依赖 governor 实例 ⇒ 可单测、可复用。
 *  - **不解析 key 里的 providerId**：key 形如 `providerId:type:model`，
 *    而 providerId 本身可能含 ':' ⇒ 拆分有歧义。**只透出 key 原文**：
 *    用户关心"还要等多久"，不关心是哪个 provider（P5：显式优于巧妙）。
 *  - **ETA 诚实在前**：并发槽有人排队时，真实等待 = 前面几个槽释放 + 自己的 RPM 槽，
 *    而槽释放时间**不可知** ⇒ 此时**只报位次、不报时间**（宁可少说，不可说错）。
 *  - **零外部依赖**：本仓 `changes` job 无 Install deps，
 *    落进该 job 的锁只允许 require node 内置模块（见 AGENTS.md / spec-mirror-wiring-gate）。
 *
 * @module services/governor-queue-snapshot
 */

'use strict'

/** 排队原因枚举（渲染层据此决定文案形态） */
const QUEUE_REASON = Object.freeze({
  /** 并发槽被占满：有请求在等空闲槽位（此时 ETA 不可知） */
  CONCURRENCY: 'concurrency',
  /** RPM 时间槽：按当前节奏，下一次调用最早能发出去的时间（预约制 ⇒ 精确值） */
  RPM: 'rpm',
})

/** ETA 置信度枚举 */
const ETA_CONFIDENCE = Object.freeze({
  /** 并发槽排队：不知道还要多久 */
  LOW: 'low',
  /** RPM 槽预约：等待量由时间槽公式直接算出 */
  HIGH: 'high',
})

/**
 * 从单个 key 的 governor 状态推导排队条目。
 * @param {string} key governor 的状态键（`providerId:type:model`）
 * @param {object} st 该 key 的内部状态
 * @param {number} now 当前时间戳（毫秒）
 * @returns {{key:string, queued:number, etaMs:number|null, etaConfidence:string, reason:string}|null}
 *   不处于排队状态时返回 null
 */
function describeQueueEntry (key, st, now) {
  if (!st || typeof st !== 'object') return null

  // 并发槽等待者：waiters 是「还没拿到槽、正在等」的请求
  const waiters = Array.isArray(st.waiters) ? st.waiters : null
  const queued = waiters ? waiters.length : 0

  // RPM 时间槽：nextSlotAt 是「下一个槽位的时间」。
  // _pace 里 base = max(now, nextSlotAt)、waitMs = base - now
  // ⇒ 这次调用的真实等待量就是 nextSlotAt - now（预约制 ⇒ 精确值，不是估计）
  const nextSlotAt = Number(st.nextSlotAt)
  const slotWaitMs = Number.isFinite(nextSlotAt) && nextSlotAt > now ? nextSlotAt - now : 0

  if (queued > 0) {
    // 并发槽排队：前面还有人在等槽，真实等待不可知 ⇒ 不给 ETA
    return {
      key: String(key),
      queued,
      etaMs: null,
      etaConfidence: ETA_CONFIDENCE.LOW,
      reason: QUEUE_REASON.CONCURRENCY,
    }
  }

  if (slotWaitMs > 0) {
    // RPM 槽排队：本次调用要等到 nextSlotAt 那个槽（本次调用自己算 1 个在等）
    return {
      key: String(key),
      queued: 1,
      etaMs: slotWaitMs,
      etaConfidence: ETA_CONFIDENCE.HIGH,
      reason: QUEUE_REASON.RPM,
    }
  }

  return null
}

/**
 * 聚合 governor 的全部 key，得到「用户可见的排队快照」。
 *
 * @param {Map<string, object>|{ [key: string]: object }|null|undefined} stateMap governor 的 `_state`
 * @param {number} [now] 当前时间戳（毫秒），缺省取 Date.now()
 * @returns {{ totalQueued: number, entries: Array<{key:string, queued:number, etaMs:number|null, etaConfidence:string, reason:string}> }}
 */
function buildQueueSnapshot (stateMap, now) {
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const entries = []

  if (!stateMap) return { totalQueued: 0, entries }

  const visit = (key, st) => {
    const entry = describeQueueEntry(key, st, at)
    if (entry) entries.push(entry)
  }

  if (typeof stateMap.forEach === 'function' && typeof stateMap.get === 'function') {
    // Map（governor 的 this._state 就是 Map）
    stateMap.forEach((st, key) => visit(key, st))
  } else if (typeof stateMap === 'object') {
    // 普通对象（容错，便于测试与将来换成别的存储）
    for (const key of Object.keys(stateMap)) visit(key, stateMap[key])
  }

  // 排序：并发排队优先（更严重、用户更没准备），其次按等待时间升序（最急的排前面）
  entries.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === QUEUE_REASON.CONCURRENCY ? -1 : 1
    if (a.etaMs === null && b.etaMs === null) return 0
    if (a.etaMs === null) return 1
    if (b.etaMs === null) return -1
    return a.etaMs - b.etaMs
  })

  const totalQueued = entries.reduce((sum, e) => sum + (Number(e.queued) || 0), 0)
  return { totalQueued, entries }
}

module.exports = {
  QUEUE_REASON,
  ETA_CONFIDENCE,
  describeQueueEntry,
  buildQueueSnapshot,
}
