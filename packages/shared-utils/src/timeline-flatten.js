/**
 * timeline-flatten — 时间轴「绝对时间拍平」中间表示
 * 定位：把「多轨（画/字/音）+ 转场重叠」编排成**单一扁平秒制时间表**。
 * 本仓已有两处同构实现（remotion-composer/scene-builder.ts 的 cuts[]、
 * story2video-engine/segment.ts 的 SubtitleTimelineItem），字段名与能力不同。
 * 本层提供统一中间表示，两处逐步收敛到它（收敛不在本次范围）。
 * ⛔ 单位约定（唯一，不可协商）：
 *   - **内部一切时间字段是秒（number，浮点）**
 *   - 毫秒只出现在**边界**：平台/编码器/竞品接口的入参出参
 *   - 边界转换只经 toMilliseconds() / fromMilliseconds()，**禁止**其他任何地方写 *1000 或 /1000
 *   理由：竞品把「秒为主、出参 ×1000」散落在 6 处调用点（报告 §6.2），
 *   任何新增出参都可能漏乘；收敛到两个函数后，「漏乘」变成可测问题。
 *
 * ## 为什么存冗余 `durationSeconds` 与 `stopSeconds`
 *
 *   ① `stopSeconds` 是**二分索引**，不预计算就得每次遍历（竞品用线性查找，O(n) 每 tick）；
 *   ② `durationSeconds` 冗余让消费方**不必做减法**（减法在多处出现会有浮点误差累积）；
 *   ③ `validateTimeline()` 断言三字段互相一致 —— **冗余 + 自检**比「单一字段 + 到处算」更安全。
 *
 * **`stopSeconds` 是累计最大值而非简单累加** —— 转场重叠会让 `endSeconds` 非严格单调，
 * 用累计最大值才能保证 `stopSeconds` 单调不减（二分查找的前提）。
 *
 * ## ⚠️ 与 `scene-builder.ts` 的一处刻意差异（既有行为，不得在无证据下改）
 *
 * `scene-builder` 的 `durationInFrames` 是 `ceil((lastOut + 1) * FPS)` —— **末尾多加 1 秒**
 * （给收尾留余量）。本模块**不加**这 1 秒（只描述素材占用的时间）。
 * 收敛时由调用方决定是否 +1。
 */
'use strict'

const DEFAULT_OVERLAP_SECONDS = 0.5
const DEFAULT_FPS = 30

/** 条目种类（多轨编排的最小集合） */
const KINDS = Object.freeze(['visual', 'text', 'audio'])

/** 唯一的 ×1000 发生地 */
function toMilliseconds (seconds) {
  return Number(seconds) * 1000
}

/** 唯一的 ÷1000 发生地 */
function fromMilliseconds (ms) {
  return Number(ms) / 1000
}

/**
 * 把条目列表拍平成绝对时间表。
 *
 * 重叠公式（泛化自 `scene-builder` 的 `in = i*(sps-overlap)` / `out = (i+1)*sps - i*overlap`）：
 *   `start_i = Σ(d_0..d_{i-1}) − i × overlap`
 *   `end_i   = start_i + d_i`
 * 即**每条与前一条重叠 overlap 秒**（首条不重叠）。
 *
 * @param {Array<{id: string, kind?: string, durationSeconds: number, payload?: any}>} items
 * @param {{transitionOverlapSeconds?: number, fps?: number, clampOverlap?: boolean}} [options]
 * @returns {{entries: Array<object>, totalSeconds: number, fps: number, durationInFrames: number, warnings: string[]}}
 * @throws {TypeError} `items` 非数组；或某条 `durationSeconds` 非有限正数（**不跳过、不补默认**）
 */
function flattenTimeline (items, options) {
  const opts = options || {}

  if (!Array.isArray(items)) {
    throw new TypeError('flattenTimeline: items 必须是数组，收到 ' + Object.prototype.toString.call(items))
  }

  const fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : DEFAULT_FPS
  const warnings = []

  let overlap = Number.isFinite(opts.transitionOverlapSeconds) && opts.transitionOverlapSeconds >= 0
    ? opts.transitionOverlapSeconds
    : DEFAULT_OVERLAP_SECONDS
  const clampOverlap = opts.clampOverlap !== false

  // 逐条校验时长：**不跳过、不补默认** —— 静默补 0 会让「编排错」变成「少一段且不报错」
  const durations = items.map((it, i) => {
    const d = it && it.durationSeconds
    if (!Number.isFinite(d) || d <= 0) {
      throw new TypeError(
        `flattenTimeline: items[${i}] 的 durationSeconds 必须是有限正数，收到 ${JSON.stringify(d)}`
      )
    }
    return d
  })

  // 重叠不得超过最短时长（否则 start 会倒退，时间表失去意义）
  if (clampOverlap && durations.length > 1) {
    const minDuration = Math.min(...durations)
    if (overlap > minDuration) {
      warnings.push(
        `transitionOverlapSeconds=${overlap} 超过最短时长 ${minDuration}，已收敛为 ${minDuration}`
      )
      overlap = minDuration
    }
  }

  const n = items.length
  const source = n === 0 ? [] : items
  const entries = []
  let cursor = 0 // Σ d_i（不含重叠扣减）
  let stopSeconds = 0 // 累计最大值
  let maxEnd = 0

  for (let i = 0; i < source.length; i++) {
    const it = source[i]
    const kind = KINDS.includes(it && it.kind) ? it.kind : 'visual'
    const startSeconds = cursor - i * overlap
    const endSeconds = startSeconds + durations[i]
    // ★ 累计最大值而非简单取 endSeconds：重叠会让 endSeconds 非严格单调，
    //   而二分查找要求 stopSeconds 单调不减
    stopSeconds = Math.max(stopSeconds, endSeconds)
    maxEnd = Math.max(maxEnd, endSeconds)

    entries.push({
      id: it && it.id !== undefined ? it.id : `item-${i}`,
      kind,
      startSeconds,
      endSeconds,
      durationSeconds: durations[i],
      stopSeconds,
      order: i,
      ...(it && it.payload !== undefined ? { payload: it.payload } : {}),
    })

    cursor += durations[i]
  }

  const totalSeconds = maxEnd
  return {
    entries,
    totalSeconds,
    fps,
    // ⚠️ 只算素材占用时长，**不加** scene-builder 那 1 秒（见头注）
    durationInFrames: Math.ceil(totalSeconds * fps),
    warnings,
  }
}

/**
 * 二分查找：`stopSeconds` 是单调不减的，故可取第一个 `stop > seconds`。
 *
 * 区间语义为**半开** `[startSeconds, endSeconds)`，因此：
 *   · `entryAt(t, 某条 endSeconds)` ⇒ 返回**后一条**（前一条已在 t 处结束）
 *   · 落在重叠区时返回**先开始的那条**（播放语义：那一刻刚结束的是它）
 *   · 早于首条起点或晚于末尾 ⇒ `null`
 *
 * @param {{entries: Array<object>}} timeline
 * @param {number} seconds
 * @returns {object|null}
 */
function entryAt (timeline, seconds) {
  const entries = timeline && Array.isArray(timeline.entries) ? timeline.entries : []
  if (entries.length === 0 || !Number.isFinite(seconds)) return null
  if (seconds < entries[0].startSeconds) return null
  if (seconds >= entries[entries.length - 1].stopSeconds) return null

  let lo = 0
  let hi = entries.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (entries[mid].stopSeconds > seconds) hi = mid
    else lo = mid + 1
  }
  return entries[lo]
}

/**
 * 「跳到 t」的局部时间换算：返回命中的条目与它内部的局部秒数。
 *
 * @param {{entries: Array<object>}} timeline
 * @param {number} seconds
 * @returns {{entry: object, localSeconds: number}|null}
 */
function locate (timeline, seconds) {
  const entry = entryAt(timeline, seconds)
  if (!entry) return null
  return { entry, localSeconds: seconds - entry.startSeconds }
}

/**
 * 结构自检。返回问题清单（空数组 = 通过）。**不抛** —— 便于调用方收集全部问题后一次报告。
 *
 * @param {{entries: Array<object>, totalSeconds?: number}} timeline
 * @returns {string[]}
 */
function validateTimeline (timeline) {
  const problems = []
  const entries = timeline && Array.isArray(timeline.entries) ? timeline.entries : null
  if (!entries) return ['timeline.entries 必须是数组']

  let prevStop = -Infinity
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] || {}
    const where = `entries[${i}]`

    for (const k of ['startSeconds', 'endSeconds', 'durationSeconds', 'stopSeconds']) {
      if (!Number.isFinite(e[k])) problems.push(`${where}.${k} 不是有限数：${JSON.stringify(e[k])}`)
    }
    if (problems.length > 0 && !Number.isFinite(e.startSeconds)) continue // 数都不可用，后续比较无意义

    if (e.endSeconds < e.startSeconds) {
      problems.push(`${where}.endSeconds(${e.endSeconds}) < startSeconds(${e.startSeconds})`)
    }
    // 冗余字段必须自洽（这是冗余的价值所在）
    const sum = e.startSeconds + e.durationSeconds
    if (Number.isFinite(sum) && Math.abs(e.endSeconds - sum) > 1e-9) {
      problems.push(`${where}: durationSeconds 与 end-start 不一致（${e.durationSeconds} vs ${e.endSeconds - e.startSeconds}）`)
    }
    // 单调不减（二分查找的前提）
    if (e.stopSeconds < prevStop) {
      problems.push(`${where}.stopSeconds(${e.stopSeconds}) 比前一条(${prevStop})小 —— 破坏二分前提`)
    }
    prevStop = e.stopSeconds
    if (e.stopSeconds < e.endSeconds) {
      problems.push(`${where}.stopSeconds(${e.stopSeconds}) < endSeconds(${e.endSeconds}) —— 累计最大值算错`)
    }
  }

  if (entries.length > 0 && Number.isFinite(timeline.totalSeconds)) {
    const last = entries[entries.length - 1]
    if (Math.abs(timeline.totalSeconds - last.stopSeconds) > 1e-9) {
      problems.push(`totalSeconds(${timeline.totalSeconds}) 与末条 stopSeconds(${last.stopSeconds}) 不一致`)
    }
  }

  return problems
}

module.exports = {
  flattenTimeline,
  entryAt,
  locate,
  toMilliseconds,
  fromMilliseconds,
  validateTimeline,
  KINDS,
  DEFAULT_OVERLAP_SECONDS,
  DEFAULT_FPS,
}
