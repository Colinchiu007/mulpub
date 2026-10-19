/**
 * publish-progress-aggregate — 聚合进度的**纯计算**（从 stores/publishProgress.js 抽出）
 *
 * 抽出的直接动因是行数门禁（该 store 越过 check-max-lines 的 500 行上限），
 * 但抽出来本身是对的：这一段只吃「任务列表」这一种数据，不碰 pinia、不碰 IPC，
 * 因此可以脱离 store 夹具单独测每一种口径（排队 / 在跑 / 无百分比 / 非法百分比 / 终态）。
 *
 * 三条不可破的语义（与 audit-14 / 阶段 2.5 同源）：
 * ① `done` 是**终态口径**——「已完成 N/共 M」里的 N 必须是真完成数，不许被软权重污染；
 * ② 软权重上限 < 1：跑到 100% 但还没落终态时条子不得贴满，否则"卡在 100%"看起来像完成；
 * ③ percent 缺失/非法 ⇒ 只给"确实开始了"的最小可见量，绝不按 0 处理，也不反推成 100。
 *
 * `terminalPhases` 由调用方传入：相位枚举的归属在 store（PRD-OSS-RPA-HARDENING 的
 * 「三处同步」判据钉的是 emitter/store 两侧），本模块不得自立第二份相位真源。
 */

const RUNNING_WEIGHT_CAP = 0.95
const STARTED_WEIGHT = 0.05

function taskSoftWeight (task, terminalPhases) {
  if (terminalPhases.has(task.phase)) return 1
  if (task.phase === 'queued') return 0
  const p = Number(task.percent)
  if (!Number.isFinite(p) || p <= 0) return STARTED_WEIGHT
  return Math.min(RUNNING_WEIGHT_CAP, p / 100)
}

/**
 * @param {Array<object>} sessions store 的会话数组（每项含 tasks 字典）
 * @param {{terminalPhases: Set<string>}} deps
 * @returns {{total:number,done:number,succeeded:number,failed:number,cancelled:number,running:number,step:number,softDone:number,progressPercent:number}}
 */
export function reduceAggregate (sessions, { terminalPhases }) {
  let total = 0
  let done = 0
  let succeeded = 0
  let failed = 0
  let cancelled = 0
  let soft = 0
  let running = 0
  for (const s of sessions) {
    for (const id of Object.keys(s.tasks)) {
      const task = s.tasks[id]
      total += 1
      if (task.phase === 'success') { done += 1; succeeded += 1 } else if (task.phase === 'failed') { done += 1; failed += 1 } else if (task.phase === 'cancelled') { done += 1; cancelled += 1 } else if (task.phase !== 'queued') { running += 1 }
      soft += taskSoftWeight(task, terminalPhases)
    }
  }
  // 「第 N / 共 M 项」：N = 已完成数 +（有在跑的项就再 +1，即当前那一项）。
  // 这一句是**计数**而不是百分比，percent 缺失的链路也说得清走到哪一步。
  const step = Math.min(total, done + (running > 0 ? 1 : 0))
  return {
    total,
    done,
    succeeded,
    failed,
    cancelled,
    running,
    step,
    softDone: soft,
    progressPercent: total > 0 ? Math.min(100, Math.round((soft / total) * 100)) : 0
  }
}
