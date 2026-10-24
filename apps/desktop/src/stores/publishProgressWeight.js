/**
 * publishProgressWeight.js — 发布聚合进度的「软权重」纯逻辑（UX 审计 2.5 / audit-14）
 *
 * 被修的形态：`aggregate.done` 只在 success/failed/cancelled 累加，进度条与 `aria-valuenow`
 * 直接取 `done/total` ⇒ 发 1 篇要 3 分钟时，头部显示「成功 0/1」而进度条**恒定 0%**，
 * 用户判断不了「在跑」还是「卡了」。
 *
 * 三条口径（不可只留一条）：
 * ① 运行中的任务按**自身进度**贡献小数权重：优先用主进程事件带下来的 `percent`
 *    （它是该任务真实阶段完成度），缺席时退回 `stageKey` 的阶段软权重表；
 * ② 运行中的任务**永远不得贡献满权重**（上限 `RUNNING_CEILING`）——「条满了但还没成功」
 *    比「条不动」更糟，前者会让人以为发布已完成；同理整体百分比在还有非终态任务时
 *    封顶 99（见 `percent`），终态齐了才到 100；
 * ③ 排序语义：权重只用于**比例**，不改变 `done/succeeded/failed/cancelled` 的既有口径
 *    （汇总行的「成功 N」仍是终态计数，不得被软权重污染 —— 那是用户核对结果的依据）。
 *
 * 本模块是零依赖纯函数：store 只负责把「按会话顺序摊平的任务数组」交给它。
 */

/** 终态相位集合（与 store 的 TERMINAL_PHASES 同口径；此处按字符串集自持以免循环依赖） */
export const TERMINAL_PHASE_SET = new Set(['success', 'failed', 'cancelled'])

/** 运行中任务的权重上限：任何非终态任务都不得独自撑满一格 */
export const RUNNING_CEILING = 0.95

/** 还有非终态任务时，整体百分比的封顶值（100 只属于"全部终态"） */
export const RUNNING_PERCENT_CEILING = 99

/**
 * 阶段软权重：主进程 `publish:progress` 未带 percent 时的兜底口径。
 * 取值理由 = 「用户此刻离结果还有多远」的单调刻度，不是阶段数量占比；
 * `waiting`/`released` 靠后是因为它们发生在提交之后（频控等待、验证码放行）。
 */
export const STAGE_WEIGHTS = {
  prepare: 0.05,
  detail: 0.1,
  upload: 0.35,
  fill: 0.55,
  submit: 0.8,
  verify: 0.85,
  waiting: 0.9,
  released: 0.92,
  done: 1,
  failed: 1,
}

/** 未知 stageKey 的基础权重：给一个大于 0 小于 1 的中位值，避免"新阶段=条不动" */
export const UNKNOWN_STAGE_WEIGHT = 0.3

/**
 * 单个任务的权重（0..1）。
 * @param {{phase?: string, stageKey?: string, percent?: number|null}|null|undefined} task
 * @returns {number}
 */
export function taskWeight (task) {
  if (!task || typeof task !== 'object') return 0
  if (TERMINAL_PHASE_SET.has(task.phase)) return 1
  if (task.phase === 'queued') return 0
  // ① 优先用事件带下来的 percent（0..100；store 已把非法值归一为 null）
  if (typeof task.percent === 'number' && Number.isFinite(task.percent)) {
    const clamped = Math.min(Math.max(task.percent, 0), 100) / 100
    return Math.min(clamped, RUNNING_CEILING)
  }
  // ② 退回阶段软权重
  const w = STAGE_WEIGHTS[task.stageKey]
  return Math.min(typeof w === 'number' ? w : UNKNOWN_STAGE_WEIGHT, RUNNING_CEILING)
}

/**
 * 汇总一组**已按会话顺序摊平**的任务。
 * @param {Array<{taskId?: string, phase?: string, stageKey?: string, percent?: number|null}>} tasks
 * @returns {{total:number, done:number, succeeded:number, failed:number, cancelled:number,
 *            running:number, weighted:number, percent:number, currentIndex:number}}
 */
export function summarize (tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  let done = 0
  let succeeded = 0
  let failed = 0
  let cancelled = 0
  let running = 0
  let weighted = 0
  let currentIndex = 0
  list.forEach((task, i) => {
    const phase = task && task.phase
    if (phase === 'success') { done += 1; succeeded += 1 } else if (phase === 'failed') { done += 1; failed += 1 } else if (phase === 'cancelled') { done += 1; cancelled += 1 } else running += 1
    weighted += taskWeight(task)
    // ③ 「第 N」取第一个非终态任务（含 queued：它已在队列里，用户关心的是"排到第几个"）
    if (currentIndex === 0 && !TERMINAL_PHASE_SET.has(phase)) currentIndex = i + 1
  })
  const total = list.length
  let percent
  if (total === 0) percent = 0
  else if (running === 0) percent = 100
  else percent = Math.min(RUNNING_PERCENT_CEILING, Math.round((weighted / total) * 100))
  return {
    total,
    done,
    succeeded,
    failed,
    cancelled,
    running,
    weighted: Math.round(weighted * 1000) / 1000,
    percent,
    currentIndex,
  }
}
